import { Injectable } from '@nestjs/common';
import { PlanFailure, PlanRequest, PipelineSuccess, Round, Degraded, CandidatePool, PlanSuccess, StrategyResult } from '../contracts';
import { EngineService } from '../../engine/engine.service';
import { RuntimeConfigService } from '../../config/runtime-config.service';
import { BriefService } from '../../analysis/brief.service';
import { StrategyAnalysis, StrategyService } from '../../analysis/strategy.service';
import { CopyService } from '../../analysis/copy.service';
import { VerifyService } from '../../analysis/verify.service';
import { ContentScanService } from '../../analysis/content-scan.service';
import { failureReason } from '../../analysis/llm.client';
import { templateCopy } from '../../analysis/copy.service';

@Injectable()
export class PlanPipelineService {
  constructor(private readonly engine: EngineService, private readonly config: RuntimeConfigService, private readonly brief: BriefService,
    private readonly strategy: StrategyService, private readonly copy: CopyService, private readonly verify: VerifyService, private readonly scan: ContentScanService) {}
  async generate(input: PlanRequest): Promise<PipelineSuccess | PlanFailure> {
    const context = this.config.context();
    const request = structuredClone(input);
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
    let pool: CandidatePool | undefined;
    let plan: PlanSuccess | undefined;
    let strategyOutput: Partial<Pick<StrategyResult, 'mediaObjective' | 'windowFit' | 'measurement'>> = {};
    for (let round = 1; round <= 2; round++) {
      const started = Date.now();
      const candidateResult = this.engine.getCandidates(request, round === 2);
      if (candidateResult.status !== 'ok') {
        if (plan) break;
        return candidateResult;
      }
      pool = candidateResult;
      const strategy: StrategyAnalysis = await this.strategy.recommend(request, pool, context).catch(error => ({ status: 'unavailable' as const, strategyPreferences: [], mediaObjective: '', requestReplan: false, rejected: [], requestedCount: 0, reason: failureReason(error) }));
      if (strategy.status === 'unavailable' && !degraded.some(item => item.stage === 'strategy')) degraded.push({ stage: 'strategy', reason: strategy.reason || '媒体偏好不可用' });
      request.strategyPreferences = strategy.status === 'ok' ? strategy.strategyPreferences : [];
      strategyOutput = { mediaObjective: strategy.mediaObjective, ...(strategy.windowFit ? { windowFit: strategy.windowFit } : {}), ...(strategy.measurement ? { measurement: strategy.measurement } : {}) };
      const result = this.engine.generate(request, pool);
      if (result.status !== 'ok') return result;
      plan = result;
      const rejected = [...strategy.rejected, ...(plan.strategyPreferences || []).filter(item => item.disposition?.startsWith('rejected:')).map(item => ({ mediaKey: item.mediaKey, reason: item.disposition!.slice(9) as Round['rejected'][number]['reason'] }))];
      const shouldReplan = strategy.requestReplan || rejected.some(item => pool!.excluded.some(excluded => excluded.mediaKey === item.mediaKey && (excluded.reason === 'no_stock' || excluded.reason === 'invalid_evidence')));
      rounds.push({ round, candidateCount: pool.candidates.length, preferredCount: strategy.requestedCount,
        acceptedCount: (plan.strategyPreferences || []).filter(item => item.disposition === 'accepted').length,
        rejected, requestReplan: shouldReplan, elapsedMs: Date.now() - started });
      if (!shouldReplan || context.mode === 'off' || context.deadline - Date.now() < 100) break;
    }
    if (!plan) throw new Error('Pipeline did not produce a plan');
    const copy = await this.copy.compose(plan, plan.campaign, [], context).catch(error => ({ status: 'unavailable' as const, copy: templateCopy(plan!), reason: failureReason(error) }));
    if (copy.status === 'unavailable' || (copy.status === 'ok' && copy.reason)) degraded.push({ stage: 'copy', reason: copy.reason || '文案不可用' });
    const verification = await this.verify.verify(plan, plan.campaign, copy.copy, undefined, context).catch(async error => {
      // Deterministic scanning stays available even if the model stage rejects unexpectedly.
      const result = await this.verify.verify(plan!, plan!.campaign, copy.copy, undefined, { ...context, mode: 'off' });
      return { ...result, status: 'unavailable' as const, reason: failureReason(error) };
    });
    if (verification.status === 'unavailable') degraded.push({ stage: 'verify', reason: verification.reason || '模型核验不可用' });
    return { ...plan, ...(strategyOutput.mediaObjective ? { mediaObjective: strategyOutput.mediaObjective } : {}), ...(strategyOutput.windowFit ? { windowFit: strategyOutput.windowFit } : {}), ...(strategyOutput.measurement ? { measurement: strategyOutput.measurement } : {}),
      copy: copy.copy, checks: verification.checks, rounds, degraded, exportAllowed: verification.exportAllowed,
      trace: [...plan.trace, ...rounds.map(round => ({ step: `analysis.round.${round.round}`, message: `候选 ${round.candidateCount}，偏好 ${round.preferredCount}，接受 ${round.acceptedCount}，拒绝 ${round.rejected.length}`, elapsedMs: round.elapsedMs })), ...verification.trace] };
  }
}
