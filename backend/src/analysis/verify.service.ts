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
  const publish = plan.schedule.batches.at(-1)?.publishStartDate;
  const windowOk = !!publish && publish <= campaign.window.start && plan.request.endDate >= campaign.window.end;
  const mediaOk = plan.request.media.every(kind => plan.lines.some(line => line.kind === kind));
  return [
    { element: '①', status: plan.client.alias.startsWith('某') ? 'pass' : 'warn', message: '客户按代称、品类与规模呈现，真实身份不作为方案依据', evidenceRefs: [`client:${plan.client.code}`] },
    { element: '②', status: campaign.businessGoal.trim() ? 'pass' : 'warn', message: campaign.businessGoal ? '生意目标已记录为提案假设，尚不能证明实际业务增长' : '缺少生意目标', evidenceRefs: [campaignRef('businessGoal')] },
    { element: '③', status: campaign.primaryGoal ? 'pass' : 'warn', message: '活动主目标沿用当前确认的 Campaign', evidenceRefs: [campaignRef('primaryGoal')] },
    { element: '④', status: plan.lines.some(line => line.trafficReference) ? 'pass' : 'warn', message: plan.lines.some(line => line.trafficReference) ? '部分媒体有历史人群参考，不代表当前触达或精确客群覆盖' : '目标人群已描述，但所选媒体缺少独立历史人群参考', evidenceRefs: [campaignRef('audience'), ...lineRefs] },
    { element: '⑤', status: budgetOk && windowOk ? 'pass' : 'warn',
      message: !budgetOk ? !lineAmountsOk ? '行金额与单位估算乘数量不一致，请复核' : !remainingOk ? '预算余量与预算上限减成案总额不一致，请复核' : '成案预算、行金额合计或数量库存需复核' : !publish ? '成案缺少发布起算日，活动档期待确认' : !windowOk ? `实际发布起算日 ${publish}，活动开始 ${campaign.window.start}；请核对活动覆盖与结束日期` : '预算与库存受上限约束，成案发布期覆盖活动窗口',
      evidenceRefs: [`plan:budget:${plan.request.budgetYuan}:total:${plan.totalYuan}:remaining:${plan.remainingYuan}`, campaignRef('window'), ...lineRefs, ...plan.schedule.batches.map(batch => `schedule:${batch.no}:${batch.publishStartDate}:quantity:${batch.quantity}`), `data:${plan.queriedAt}`] },
    { element: '⑥', status: mediaOk ? 'pass' : 'warn', message: mediaOk ? '所选媒体类型均有成案明细与来源' : '请求的媒体范围未被完整覆盖', evidenceRefs: [campaignRef('mediaScope'), ...lineRefs] },
    { element: '⑦', status: campaign.successMetric.kpi && campaign.successMetric.proof ? 'pass' : 'warn', message: 'KPI 与交付取证分别记录，方案不承诺未验证的业绩', evidenceRefs: [campaignRef('successMetric')] },
  ];
}

@Injectable()
export class VerifyService {
  constructor(private readonly config: RuntimeConfigService, private readonly llm: LlmClient, private readonly scan: ContentScanService) {}
  async verify(plan: PlanSuccess, campaign: Campaign = plan.campaign, copy?: Partial<PlanCopy>, exportText?: string, context = this.config.context()): Promise<VerifyResult> {
    const scanned = this.scan.scan({ plan, campaign, copy, exportText }, 'output');
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
          if (!check || !['①', '②', '③', '④', '⑤', '⑥', '⑦'].includes(check.element) || typeof check.message !== 'string' || !Array.isArray(check.evidenceRefs)) continue;
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
