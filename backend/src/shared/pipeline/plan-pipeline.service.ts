import { Injectable } from '@nestjs/common';
import { PlanFailure, PlanRequest, PipelineSuccess, PipelineRangeSuccess, Round, Degraded, CandidatePool, PlanSuccess, StrategyResult, PipelineRequest } from '../contracts';
import { BUDGET_RANGE, EngineService } from '../../engine/engine.service';
import { RuntimeConfigService } from '../../config/runtime-config.service';
import { BriefService } from '../../analysis/brief.service';
import { StrategyAnalysis, StrategyService } from '../../analysis/strategy.service';
import { CopyService } from '../../analysis/copy.service';
import { VerifyService } from '../../analysis/verify.service';
import { ContentScanService } from '../../analysis/content-scan.service';
import { failureReason } from '../../analysis/llm.client';
import { templateCopy } from '../../analysis/copy.service';
import { InventoryService } from '../../inventory/inventory.service';
import { KIND_LABELS, SOURCE_LABELS, type KindInventory } from '../../inventory/resolution';

export const PLAN_STAGES = ['brief', 'inventory', 'candidates', 'strategy', 'engine', 'copy', 'verify'] as const;
export const PLAN_STAGE_STATUSES = ['running', 'done', 'skipped', 'degraded', 'failed'] as const;
export interface PlanStageUpdate {
  key: typeof PLAN_STAGES[number];
  status: typeof PLAN_STAGE_STATUSES[number];
  detail: string;
}
const stockSource = (kind: KindInventory) => `${SOURCE_LABELS[kind.source]}${kind.reason ? `（${kind.reason}）` : ''}`;

@Injectable()
export class PlanPipelineService {
  constructor(private readonly engine: EngineService, private readonly config: RuntimeConfigService, private readonly brief: BriefService,
    private readonly strategy: StrategyService, private readonly copy: CopyService, private readonly verify: VerifyService, private readonly scan: ContentScanService,
    private readonly inventory: InventoryService) {}
  async generate(input: PlanRequest, onProgress?: (update: PlanStageUpdate) => void): Promise<PipelineSuccess | PlanFailure>;
  async generate(input: PipelineRequest, onProgress?: (update: PlanStageUpdate) => void): Promise<PipelineSuccess | PipelineRangeSuccess | PlanFailure>;
  async generate(input: PipelineRequest, onProgress?: (update: PlanStageUpdate) => void): Promise<PipelineSuccess | PipelineRangeSuccess | PlanFailure> {
    const report = (key: PlanStageUpdate['key'], status: PlanStageUpdate['status'], detail: string) => onProgress?.({ key, status, detail });
    const context = this.config.context();
    const request = structuredClone(input) as PipelineRequest;
    const explicitBudget = request.budgetYuan;
    const rounds: Round[] = [];
    const degraded: Degraded[] = [];
    if (request.briefText) this.scan.assertInput(request.briefText);
    if (request.campaignOverride) this.scan.assertInput(JSON.stringify(request.campaignOverride));
    if (context.mode === 'off') degraded.push({ stage: 'strategy', reason: 'skipped' }, { stage: 'copy', reason: 'skipped' });
    if (request.briefText && context.mode !== 'off') {
      report('brief', 'running', '提取活动目标、人群与约束');
      try {
        const parsed = await this.brief.parse(request.briefText, request.industry, context);
        request.campaignOverride = { ...parsed.campaignDraft, ...request.campaignOverride };
        if (parsed.status === 'unavailable') degraded.push({ stage: 'brief', reason: parsed.trace.at(-1)?.message || '需求拆解不可用' });
      } catch (error) { degraded.push({ stage: 'brief', reason: failureReason(error) }); }
      const fallback = degraded.find(item => item.stage === 'brief');
      report('brief', fallback ? 'degraded' : 'done', fallback ? `继续使用可提取的需求与现有设置 · ${fallback.reason}` : '需求已提取');
    } else {
      report('brief', 'skipped', request.briefText ? '分析已关闭' : '未填写补充需求');
    }
    // Raw text is consumed once; it is never sent with subsequent model calls.
    delete request.briefText;
    // 一轮请求只解析一次库存，两轮候选共用同一批整段库存与查询时间。
    const candidateRequest = { ...request, budgetYuan: explicitBudget ?? BUDGET_RANGE.maxYuan };
    const dateRange = `${request.startDate} 至 ${request.endDate}`;
    const stockProgress = new Map(request.media.map(kind => [kind, this.inventory.online ? '查询红豆库存中' : '读取本地库存中']));
    const reportStock = () => report('inventory', 'running', `${dateRange} · ${[...stockProgress].map(([kind, detail]) => `${KIND_LABELS[kind]} ${detail}`).join(' / ')}`);
    reportStock();
    const resolution = await this.inventory.resolve(candidateRequest, kind => {
      stockProgress.set(kind.kind, stockSource(kind));
      reportStock();
    });
    const stockDetail = resolution.kinds.map(kind => `${KIND_LABELS[kind.kind]} ${stockSource(kind)}`).join(' / ');
    report('inventory', resolution.kinds.some(kind => kind.source === 'missing') ? 'failed' :
      resolution.kinds.some(kind => kind.reason || kind.source === 'snapshot') ? 'degraded' : 'done', `${dateRange} · ${stockDetail}`);
    let pool: CandidatePool | undefined;
    let plan: PlanSuccess | undefined;
    let strategyOutput: Partial<Pick<StrategyResult, 'mediaObjective' | 'windowFit' | 'measurement'>> = {};
    for (let round = 1; round <= 2; round++) {
      const started = Date.now();
      report('candidates', 'running', `第 ${round} 轮 · 筛选有库存、刊例和覆盖依据的资源`);
      const candidateResult = this.engine.getCandidates(candidateRequest, round === 2, resolution);
      if (candidateResult.status !== 'ok') {
        if (pool) {
          report('candidates', 'degraded', `扩选失败，沿用首轮候选 · ${candidateResult.message}`);
          break;
        }
        report('candidates', 'failed', candidateResult.message);
        return candidateResult;
      }
      pool = candidateResult;
      report('candidates', 'done', `第 ${round} 轮 · ${pool.candidates.length} 条候选`);
      if (context.mode !== 'off') report('strategy', 'running', `第 ${round} 轮 · ${pool.candidates.length} 条候选`);
      const strategy: StrategyAnalysis = await this.strategy.recommend({ ...request, ...(explicitBudget === undefined ? {} : { budgetYuan: explicitBudget }) }, pool, context).catch(error => ({ status: 'unavailable' as const, strategyPreferences: [], mediaObjective: '', requestReplan: false, rejected: [], requestedCount: 0, reason: failureReason(error) }));
      if (strategy.status === 'unavailable' && !degraded.some(item => item.stage === 'strategy')) degraded.push({ stage: 'strategy', reason: strategy.reason || '媒体偏好不可用' });
      if (strategy.status === 'disabled') report('strategy', 'skipped', '使用规则分配');
      else if (strategy.status === 'unavailable') report('strategy', 'degraded', `第 ${round} 轮 · 使用规则分配 · ${strategy.reason || '媒体偏好不可用'}`);
      else report('strategy', 'done', `第 ${round} 轮 · 模型返回 ${strategy.requestedCount} 项推荐`);
      request.strategyPreferences = strategy.status === 'ok' ? strategy.strategyPreferences : [];
      strategyOutput = { mediaObjective: strategy.mediaObjective, ...(strategy.windowFit ? { windowFit: strategy.windowFit } : {}), ...(strategy.measurement ? { measurement: strategy.measurement } : {}) };
      // 全区间请求只需判断是否需要第二轮回环；单预算失败直接沿用现有响应。
      const probeRequest = { ...request, budgetYuan: explicitBudget ?? Math.max(BUDGET_RANGE.defaultYuan, pool.minimumEstimateYuan) };
      report('engine', 'running', `第 ${round} 轮 · 核算数量、报价与排期`);
      const probe = this.engine.generate(probeRequest, pool);
      if (probe.status !== 'ok' && explicitBudget !== undefined) {
        report('engine', 'failed', probe.message);
        return probe;
      }
      plan = probe.status === 'ok' ? probe : undefined;
      const planRejected = plan ? (plan.strategyPreferences || []).filter(item => item.disposition?.startsWith('rejected:')).map(item => ({ mediaKey: item.mediaKey, reason: item.disposition!.slice(9) as Round['rejected'][number]['reason'] })) : [];
      const rejected = [...strategy.rejected, ...planRejected];
      const shouldReplan = strategy.requestReplan || rejected.some(item => pool!.excluded.some(excluded => excluded.mediaKey === item.mediaKey && (excluded.reason === 'no_stock' || excluded.reason === 'invalid_evidence')));
      rounds.push({ round, candidateCount: pool.candidates.length, preferredCount: strategy.requestedCount,
        acceptedCount: plan ? (plan.strategyPreferences || []).filter(item => item.disposition === 'accepted').length : 0,
        rejected, requestReplan: shouldReplan, elapsedMs: Date.now() - started });
      if (!shouldReplan || context.mode === 'off' || context.modelTime.remainingMs < 100) break;
      if (round === 1) report('engine', 'done', '已完成首轮核算，继续扩选');
    }
    if (!pool) throw new Error('Pipeline did not produce a candidate pool');
    // 全区间：候选、策略已按本轮确定；逐档结果复用同一候选池，不增加模型调用。
    if (explicitBudget === undefined) report('engine', 'running', '按同一候选池计算各预算档');
    const range = explicitBudget === undefined ? await this.engine.generateRange(request, pool, onProgress && ((computed, total) => {
      report('engine', 'running', `已核算 ${computed}/${total} 个预算档`);
    })) : undefined;
    if (range && range.status !== 'ok') {
      report('engine', 'failed', range.message);
      return range;
    }
    if (!range && !plan) throw new Error('Pipeline did not produce a plan');
    // 文案与模型核验针对默认金额的成案；其他金额的清单、金额与预算分析由规则产出。
    const target = range ? range.defaultPlan : plan!;
    report('engine', 'done', range ? `${range.range.budgetOptions.filter(option => option.status === 'ok').length}/${range.range.budgetOptions.length} 个预算档可成案` : `${target.lines.length} 条媒体明细，合计 ${target.totalYuan.toLocaleString('zh-CN')} 元`);
    if (context.mode !== 'off') report('copy', 'running', '整理默认预算方案的文案');
    const copy = await this.copy.compose(target, target.campaign, [], context).catch(error => ({ status: 'unavailable' as const, copy: templateCopy(target), reason: failureReason(error) }));
    if (copy.status === 'unavailable' || (copy.status === 'ok' && copy.reason)) degraded.push({ stage: 'copy', reason: copy.reason || '文案不可用' });
    if (copy.status === 'disabled') report('copy', 'skipped', '使用模板文案');
    else if (copy.status === 'unavailable') report('copy', 'degraded', `使用模板文案 · ${copy.reason || '文案不可用'}`);
    else if (copy.reason) report('copy', 'degraded', copy.reason);
    else report('copy', 'done', '方案文案已完成');
    report('verify', 'running', context.mode === 'off' ? '执行规则核验' : '执行规则核验与模型复核');
    const verification = await this.verify.verify(target, target.campaign, copy.copy, undefined, context).catch(async error => {
      // Deterministic scanning stays available even if the model stage rejects unexpectedly.
      const result = await this.verify.verify(target, target.campaign, copy.copy, undefined, { ...context, mode: 'off' });
      return { ...result, status: 'unavailable' as const, reason: failureReason(error) };
    });
    if (verification.status === 'unavailable') degraded.push({ stage: 'verify', reason: verification.reason || '模型核验不可用' });
    const checkLabels = { pass: '通过', warn: '待确认', fail: '未通过' };
    const checkDetail = Object.entries(checkLabels).map(([status, label]) => `${verification.checks.filter(check => check.status === status).length} ${label}`).join(' · ');
    const reviewDetail = verification.status === 'unavailable' ? `仅完成规则核验 · ${verification.reason || '模型复核不可用'}` :
      verification.status === 'disabled' ? '规则核验' : '规则核验与模型复核';
    report('verify', !verification.exportAllowed ? 'failed' : verification.status === 'unavailable' ? 'degraded' : 'done', `${reviewDetail} · ${checkDetail}`);
    const trace = [...target.trace, ...rounds.map(round => ({ step: `analysis.round.${round.round}`, message: `候选 ${round.candidateCount}，偏好 ${round.preferredCount}，接受 ${round.acceptedCount}，拒绝 ${round.rejected.length}`, elapsedMs: round.elapsedMs })), ...verification.trace];
    const analysis = { ...(strategyOutput.mediaObjective ? { mediaObjective: strategyOutput.mediaObjective } : {}), ...(strategyOutput.windowFit ? { windowFit: strategyOutput.windowFit } : {}), ...(strategyOutput.measurement ? { measurement: strategyOutput.measurement } : {}) };
    const common = { ...analysis, copy: copy.copy, checks: verification.checks, rounds, degraded, exportAllowed: verification.exportAllowed, trace };
    if (!range) return { ...plan, ...common } as PipelineSuccess;
    return {
      ...range.range, request: { ...structuredClone(request) }, ...common,
      industryName: this.engine.getMeta().industries.find(item => item.id === request.industry)?.name ?? request.industry,
      defaultPlan: { ...range.defaultPlan, ...common },
    } as PipelineRangeSuccess;
  }
}
