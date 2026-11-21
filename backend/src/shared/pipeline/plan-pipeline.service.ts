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

@Injectable()
export class PlanPipelineService {
  constructor(private readonly engine: EngineService, private readonly config: RuntimeConfigService, private readonly brief: BriefService,
    private readonly strategy: StrategyService, private readonly copy: CopyService, private readonly verify: VerifyService, private readonly scan: ContentScanService,
    private readonly inventory: InventoryService) {}
  async generate(input: PlanRequest): Promise<PipelineSuccess | PlanFailure>;
  async generate(input: PipelineRequest): Promise<PipelineSuccess | PipelineRangeSuccess | PlanFailure>;
  async generate(input: PipelineRequest): Promise<PipelineSuccess | PipelineRangeSuccess | PlanFailure> {
    const context = this.config.context();
    const request = structuredClone(input) as PipelineRequest;
    const explicitBudget = request.budgetYuan;
    const rounds: Round[] = [];
    const degraded: Degraded[] = [];
    if (request.briefText) this.scan.assertInput(request.briefText);
    if (request.campaignOverride) this.scan.assertInput(JSON.stringify(request.campaignOverride));
    if (context.mode === 'off') degraded.push({ stage: 'strategy', reason: 'skipped' }, { stage: 'copy', reason: 'skipped' });
    if (request.briefText && context.mode !== 'off') {
      try {
        const parsed = await this.brief.parse(request.briefText, request.industry, context);
        request.campaignOverride = { ...parsed.campaignDraft, ...request.campaignOverride };
        if (parsed.status === 'unavailable') degraded.push({ stage: 'brief', reason: parsed.trace.at(-1)?.message || '需求拆解不可用' });
      } catch (error) { degraded.push({ stage: 'brief', reason: failureReason(error) }); }
    }
    // Raw text is consumed once; it is never sent with subsequent model calls.
    delete request.briefText;
    // 一轮请求只解析一次库存，两轮候选共用同一批整段库存与查询时间。
    const resolution = await this.inventory.resolve({ ...request, budgetYuan: explicitBudget ?? BUDGET_RANGE.minYuan });
    let pool: CandidatePool | undefined;
    let plan: PlanSuccess | undefined;
    let strategyOutput: Partial<Pick<StrategyResult, 'mediaObjective' | 'windowFit' | 'measurement'>> = {};
    for (let round = 1; round <= 2; round++) {
      const started = Date.now();
      const candidateResult = this.engine.getCandidates({ ...request, budgetYuan: explicitBudget ?? BUDGET_RANGE.minYuan }, round === 2, resolution);
      if (candidateResult.status !== 'ok') {
        if (pool) break;
        return candidateResult;
      }
      pool = candidateResult;
      const strategy: StrategyAnalysis = await this.strategy.recommend({ ...request, ...(explicitBudget === undefined ? {} : { budgetYuan: explicitBudget }) }, pool, context).catch(error => ({ status: 'unavailable' as const, strategyPreferences: [], mediaObjective: '', requestReplan: false, rejected: [], requestedCount: 0, reason: failureReason(error) }));
      if (strategy.status === 'unavailable' && !degraded.some(item => item.stage === 'strategy')) degraded.push({ stage: 'strategy', reason: strategy.reason || '媒体偏好不可用' });
      request.strategyPreferences = strategy.status === 'ok' ? strategy.strategyPreferences : [];
      strategyOutput = { mediaObjective: strategy.mediaObjective, ...(strategy.windowFit ? { windowFit: strategy.windowFit } : {}), ...(strategy.measurement ? { measurement: strategy.measurement } : {}) };
      // 全区间请求只需判断是否需要第二轮回环；单预算失败直接沿用现有响应。
      const probeRequest = explicitBudget !== undefined ? request as PlanRequest : { ...request, budgetYuan: BUDGET_RANGE.defaultYuan };
      const probe = this.engine.generate(probeRequest, pool);
      if (probe.status !== 'ok' && explicitBudget !== undefined) return probe;
      plan = probe.status === 'ok' ? probe : undefined;
      const planRejected = plan ? (plan.strategyPreferences || []).filter(item => item.disposition?.startsWith('rejected:')).map(item => ({ mediaKey: item.mediaKey, reason: item.disposition!.slice(9) as Round['rejected'][number]['reason'] })) : [];
      const rejected = [...strategy.rejected, ...planRejected];
      const shouldReplan = strategy.requestReplan || rejected.some(item => pool!.excluded.some(excluded => excluded.mediaKey === item.mediaKey && (excluded.reason === 'no_stock' || excluded.reason === 'invalid_evidence')));
      rounds.push({ round, candidateCount: pool.candidates.length, preferredCount: strategy.requestedCount,
        acceptedCount: plan ? (plan.strategyPreferences || []).filter(item => item.disposition === 'accepted').length : 0,
        rejected, requestReplan: shouldReplan, elapsedMs: Date.now() - started });
      if (!shouldReplan || context.mode === 'off' || context.deadline - Date.now() < 100) break;
    }
    if (!pool) throw new Error('Pipeline did not produce a candidate pool');
    // 全区间：候选、策略已按本轮确定；逐档结果复用同一候选池，不增加模型调用。
    const range = explicitBudget === undefined ? this.engine.generateRange(request, pool) : undefined;
    if (range && range.status !== 'ok') return range;
    if (!range && !plan) throw new Error('Pipeline did not produce a plan');
    // 文案与模型核验针对默认金额的成案；其他金额的清单、金额与预算分析由规则产出。
    const target = range ? range.defaultPlan : plan!;
    const copy = await this.copy.compose(target, target.campaign, [], context).catch(error => ({ status: 'unavailable' as const, copy: templateCopy(target), reason: failureReason(error) }));
    if (copy.status === 'unavailable' || (copy.status === 'ok' && copy.reason)) degraded.push({ stage: 'copy', reason: copy.reason || '文案不可用' });
    const verification = await this.verify.verify(target, target.campaign, copy.copy, undefined, context).catch(async error => {
      // Deterministic scanning stays available even if the model stage rejects unexpectedly.
      const result = await this.verify.verify(target, target.campaign, copy.copy, undefined, { ...context, mode: 'off' });
      return { ...result, status: 'unavailable' as const, reason: failureReason(error) };
    });
    if (verification.status === 'unavailable') degraded.push({ stage: 'verify', reason: verification.reason || '模型核验不可用' });
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
