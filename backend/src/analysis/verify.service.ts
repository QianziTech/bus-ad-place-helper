import { Injectable } from '@nestjs/common';
import { Campaign, Check, PlanCopy, PlanSuccess, VerifyResult } from '../shared/contracts';
import { RuntimeConfigService } from '../config/runtime-config.service';
import { buildContext } from '../shared/pipeline/context-builder';
import { ContentScanService } from './content-scan.service';
import { LlmClient, failureReason } from './llm.client';

export function planEvidence(plan: PlanSuccess): string[] {
  return [`data:${plan.queriedAt}`, `plan:budget:${plan.request.budgetYuan}:total:${plan.totalYuan}:remaining:${plan.remainingYuan}`,
    ...plan.lines.flatMap(line => [line.mediaKey, ...line.evidenceRefs, `plan:${line.mediaKey}:quantity:${line.quantity}:free:${line.freeCount}:unit:${line.unitEstimateYuan}:total:${line.lineTotalYuan}`]),
    ...plan.schedule.batches.map(batch => `schedule:${batch.no}:${batch.publishStartDate}:quantity:${batch.quantity}`),
    ...Object.keys(plan.campaign).map(field => `campaign:${plan.campaign.id}:${field}`)];
}

export function deterministicChecks(plan: PlanSuccess, campaign: Campaign): Check[] {
  const campaignRef = (field: string) => `campaign:${campaign.id}:${field}`;
  const lineRefs = plan.lines.flatMap(line => [line.mediaKey, ...line.evidenceRefs, `plan:${line.mediaKey}:quantity:${line.quantity}:free:${line.freeCount}:unit:${line.unitEstimateYuan}:total:${line.lineTotalYuan}`]);
  const inventoryOk = plan.lines.every(line => line.quantity > 0 && Number.isInteger(line.quantity) && line.quantity <= line.freeCount);
  const lineTotal = plan.lines.reduce((sum, line) => sum + line.lineTotalYuan, 0);
  const lineAmountsOk = plan.lines.every(line => line.lineTotalYuan === line.unitEstimateYuan * line.quantity);
  const remainingOk = plan.remainingYuan === plan.request.budgetYuan - plan.totalYuan;
  const budgetOk = lineTotal === plan.totalYuan && plan.totalYuan <= plan.request.budgetYuan && inventoryOk && lineAmountsOk && remainingOk;
  const first = plan.schedule.batches[0]?.publishStartDate;
  const last = plan.schedule.batches.at(-1)?.publishStartDate;
  const windowDiffers = campaign.window.start !== plan.request.startDate || campaign.window.end !== plan.request.endDate;
  const weekly = plan.inventory?.kinds.some(kind => kind.source === 'snapshot');
  const pendingBilling = plan.billingStatus === 'pending';
  const dateAfterEnd = new Date(plan.request.endDate + 'T00:00:00Z');
  dateAfterEnd.setUTCDate(dateAfterEnd.getUTCDate() + 1);
  const next = dateAfterEnd.toISOString().slice(0, 10);
  const remainingStart = campaign.window.start > next ? campaign.window.start : next;
  const timing = [
    !lineAmountsOk && '行金额与单位估算乘数量不一致，请复核',
    !remainingOk && '预算余量与预算上限减成案总额不一致，请复核',
    !budgetOk && lineAmountsOk && remainingOk && '成案总额或库存数量需复核',
    !first ? '尚无已排施工批次' : first > plan.request.startDate ? `首批计划于 ${first} 上线，晚于档期首日` :
      last && last > plan.request.startDate ? `首批于 ${first} 上线，其余资源分批上线至 ${last}` : '',
    plan.schedule.status === 'capacity_short' && '部分资源尚未排入施工批次',
    weekly && '本地周截面仅支持参考排期，实际库存待复核',
    pendingBilling && '计费口径待确认',
    windowDiffers && `本次档期 ${plan.request.startDate} 至 ${plan.request.endDate}；建议窗口 ${campaign.window.start} 至 ${campaign.window.end}`,
    remainingStart <= campaign.window.end && `后续可另行核对 ${remainingStart} 至 ${campaign.window.end} 的库存和报价`,
  ].filter(Boolean);
  const mediaOk = plan.request.media.every(kind => plan.lines.some(line => line.kind === kind));
  return [
    { element: '①', status: plan.client.alias.startsWith('某') ? 'pass' : 'warn', message: '客户按代称、品类与规模呈现，真实身份不作为方案依据', evidenceRefs: [`client:${plan.client.code}`] },
    { element: '②', status: campaign.businessGoal.trim() ? 'pass' : 'warn', message: campaign.businessGoal ? '生意目标已记录为提案假设，尚不能证明实际业务增长' : '缺少生意目标', evidenceRefs: [campaignRef('businessGoal')] },
    { element: '③', status: campaign.primaryGoal ? 'pass' : 'warn', message: '活动主目标沿用当前确认的 Campaign', evidenceRefs: [campaignRef('primaryGoal')] },
    { element: '④', status: plan.lines.some(line => line.trafficReference) ? 'pass' : 'warn', message: plan.lines.some(line => line.trafficReference) ? '部分媒体有历史人群参考，不代表当前触达或精确客群覆盖' : '目标人群已描述，但所选媒体缺少独立历史人群参考', evidenceRefs: [campaignRef('audience'), ...lineRefs] },
    { element: '⑤', status: timing.length ? 'warn' : 'pass',
      message: timing.join('；') || '预算与库存受上限约束，已排首日上线',
      evidenceRefs: [`plan:budget:${plan.request.budgetYuan}:total:${plan.totalYuan}:remaining:${plan.remainingYuan}`, campaignRef('window'), ...lineRefs, ...plan.schedule.batches.map(batch => `schedule:${batch.no}:${batch.publishStartDate}:quantity:${batch.quantity}`), `data:${plan.queriedAt}`] },
    { element: '⑥', status: mediaOk ? 'pass' : 'warn', message: mediaOk ? '所选媒体类型均有成案明细与来源' : '请求的媒体范围未被完整覆盖', evidenceRefs: [campaignRef('mediaScope'), ...lineRefs] },
    { element: '⑦', status: campaign.successMetric.kpi && campaign.successMetric.proof ? 'pass' : 'warn', message: 'KPI 与交付取证分别记录，方案不承诺未验证的业绩', evidenceRefs: [campaignRef('successMetric')] },
  ];
}

@Injectable()
export class VerifyService {
  constructor(private readonly config: RuntimeConfigService, private readonly llm: LlmClient, private readonly scan: ContentScanService) {}
  async verify(plan: PlanSuccess, campaign: Campaign = plan.campaign, copy?: Partial<PlanCopy>, exportText?: string, context = this.config.context()): Promise<VerifyResult> {
    // campaignOverride is merged into plan.campaign, so scanning it again would repeat the same finding.
    const payload = plan.request?.campaignOverride ? { ...plan, request: { ...plan.request, campaignOverride: undefined } } : plan;
    const targets: Record<string, unknown> = { plan: payload };
    // A distinct campaign argument carries text the merged plan does not; an identical one is already covered.
    if (campaign && JSON.stringify(campaign) !== JSON.stringify(plan.campaign)) targets.campaign = campaign;
    const scanned = this.scan.scan({ ...targets, copy, exportText }, 'output');
    const checks = [...deterministicChecks(plan, campaign), ...(scanned.some(check => check.element === '实名扫描') ? [] : [this.scan.mappingCheck()]), ...scanned];
    const trace: VerifyResult['trace'] = [{ step: 'verify.scan', message: '已执行确定性实名、成交价形态与合规扫描', evidenceRefs: ['rule:real-name', 'rule:price-wording', 'rule:compliance'] }];
    let status: VerifyResult['status'] = context.mode === 'off' ? 'disabled' : 'ok';
    let reason: string | undefined;
    if (context.mode !== 'off') {
      try {
        const refs = [...new Set([...planEvidence(plan), ...checks.flatMap(check => check.evidenceRefs)])];
        const safeCopy = copy ? Object.fromEntries(['headline', 'brandContext', 'strategyLine', 'selectionRationale', 'assumptionEcho'].filter(key => typeof copy[key as keyof PlanCopy] === 'string').map(key => [key, copy[key as keyof PlanCopy] as string])) : undefined;
        const payload = buildContext({ plan, campaign, copy: safeCopy, checkRefs: refs }, context);
        this.scan.assertPrompt(payload);
        const raw = await this.llm.complete<{ checks: Check[] }>('plan.verify', context, payload, () => ({ checks: [{ element: '③', status: 'pass', message: '同源 mock 复核：媒体任务应围绕当前主目标解释', evidenceRefs: [`campaign:${campaign.id}:primaryGoal`] }] }));
        if (!raw || !Array.isArray(raw.checks)) throw new Error('invalid');
        const allowed = new Set(refs);
        for (const check of raw.checks) {
          if (!check || !['①', '②', '③', '④', '⑦'].includes(check.element) || typeof check.message !== 'string' || !Array.isArray(check.evidenceRefs)) continue;
          if (/\d|[一二三四五六七八九十百千万]+\s*(?:辆|台|元|批|夜)/.test(check.message)) continue;
          const evidenceRefs = check.evidenceRefs.filter(ref => typeof ref === 'string' && allowed.has(ref));
          // Model observations never override deterministic results or grant export permission.
          checks.push({ element: check.element, status: check.status === 'pass' && evidenceRefs.length === check.evidenceRefs.length && evidenceRefs.length > 0 ? 'pass' : 'warn',
            message: check.message, evidenceRefs, blocking: false });
          checks.push(...this.scan.scan(check.message, 'modelChecks.message'));
        }
        trace.push({ step: 'verify.analysis', message: context.mode === 'mock' ? '已完成同源 mock 复核' : '已完成模型非阻断复核', evidenceRefs: [`campaign:${campaign.id}:primaryGoal`] });
      } catch (error) { status = 'unavailable'; reason = failureReason(error); trace.push({ step: 'verify.analysis', message: reason, evidenceRefs: ['rule:verify-fallback'] }); }
    }
    const exportAllowed = !checks.some(check => check.blocking && check.status === 'fail');
    return { status, checks, summary: exportAllowed ? '确定性扫描未发现阻断项；请阅读待确认提示' : '存在阻断项，修改后重新核验才能导出', trace, exportAllowed, ...(reason ? { reason } : {}) };
  }
}
