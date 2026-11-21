import { Injectable } from '@nestjs/common';
import { AnalysisContext, CandidatePool, PlanRequest, RejectionReason, StrategyPreference, StrategyResult } from '../shared/contracts';
import { EngineService } from '../engine/engine.service';
import { RuntimeConfigService } from '../config/runtime-config.service';
import { buildContext } from '../shared/pipeline/context-builder';
import { ContentScanService } from './content-scan.service';
import { LlmClient, failureReason, hasGeneratedPlanNumber } from './llm.client';
import { strategyFixture } from './prompts/__fixtures__/fixtures';

export interface StrategyAnalysis extends StrategyResult { rejected: { mediaKey: string; reason: RejectionReason }[]; requestedCount: number }
const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

@Injectable()
export class StrategyService {
  constructor(private readonly engine: EngineService, private readonly config: RuntimeConfigService, private readonly llm: LlmClient, private readonly scan: ContentScanService) {}
  async recommend(input: Omit<PlanRequest, 'budgetYuan'> & { budgetYuan?: number }, pool?: CandidatePool, context = this.config.context()): Promise<StrategyAnalysis> {
    const base = { strategyPreferences: [], mediaObjective: '', requestReplan: false, rejected: [], requestedCount: 0 };
    if (context.mode === 'off') return { ...base, status: 'disabled' };
    const configuredIndustry = this.engine.getMeta().industries.find(industry => industry.id === input.industry);
    const request: PlanRequest = { ...input, budgetYuan: input.budgetYuan ?? input.campaignOverride?.budgetHintYuan ?? configuredIndustry?.campaign.budgetHintYuan ?? 1000000 };
    const candidates = pool || this.engine.getCandidates(request);
    if (candidates.status !== 'ok') return { ...base, status: 'unavailable', reason: candidates.message };
    try {
      const payload = buildContext({ pool: candidates }, context);
      this.scan.assertPrompt(payload);
      const raw = await this.llm.complete<StrategyResult>('strategy.recommend', context, payload, () => strategyFixture(context.config.includeHistoricalProfiles ? candidates : {
        ...candidates, candidates: candidates.candidates.map(candidate => ({ ...candidate, trafficReference: undefined, evidenceRefs: candidate.evidenceRefs.filter(ref => !ref.startsWith('traffic:')) })).filter(candidate => candidate.evidenceRefs.length > 0),
      }));
      if (!raw || !Array.isArray(raw.strategyPreferences) || typeof raw.mediaObjective !== 'string' || typeof raw.requestReplan !== 'boolean') throw new Error('invalid');
      if (this.scan.scan({ mediaObjective: raw.mediaObjective, replanReason: raw.replanReason, windowFit: raw.windowFit?.reason, measurement: raw.measurement }).length) throw new Error('invalid');
      if ([raw.mediaObjective, raw.replanReason, raw.windowFit?.reason, raw.measurement?.kpi, raw.measurement?.proof].some(value => typeof value === 'string' && hasGeneratedPlanNumber(value))) throw new Error('invalid');
      const preferences: StrategyPreference[] = [];
      const rejected: StrategyAnalysis['rejected'] = [];
      const seen = new Set<string>();
      for (const preference of raw.strategyPreferences) {
        const mediaKey = typeof preference?.mediaKey === 'string' ? preference.mediaKey : '(missing)';
        const candidate = candidates.candidates.find(item => item.mediaKey === mediaKey);
        let reason: RejectionReason | undefined;
        if (!candidate) reason = candidates.excluded.find(item => item.mediaKey === mediaKey)?.reason || 'unknown_media';
        else if (seen.has(mediaKey) || !isString(preference.reason) || !Array.isArray(preference.evidenceRefs) || !preference.evidenceRefs.length) reason = 'invalid_evidence';
        else {
          const candidateRefs = candidate.evidenceRefs.filter(ref => context.config.includeHistoricalProfiles || !ref.startsWith('traffic:'));
          const allowed = new Set([...candidateRefs, ...Object.keys(candidates.campaign).map(field => `campaign:${candidates.campaign.id}:${field}`)]);
          const mediaEvidence = preference.evidenceRefs.some(ref => candidateRefs.includes(ref) && /^(coverage|traffic):/.test(ref));
          if (!mediaEvidence || preference.evidenceRefs.some(ref => !isString(ref) || !allowed.has(ref))) reason = 'invalid_evidence';
          else if (this.scan.scan(preference.reason).length || hasGeneratedPlanNumber(preference.reason)) reason = 'invalid_evidence';
        }
        seen.add(mediaKey);
        if (reason) rejected.push({ mediaKey, reason });
        else preferences.push({ mediaKey, reason: preference.reason, evidenceRefs: [...new Set(preference.evidenceRefs)] });
      }
      const validRefs = new Set([...candidates.candidates.flatMap(candidate => candidate.evidenceRefs), ...Object.keys(candidates.campaign).map(field => `campaign:${candidates.campaign.id}:${field}`)]);
      const windowFit = raw.windowFit && ['aligned', 'risk', 'unknown'].includes(raw.windowFit.status) && isString(raw.windowFit.reason) && Array.isArray(raw.windowFit.evidenceRefs)
        ? { ...raw.windowFit, evidenceRefs: raw.windowFit.evidenceRefs.filter(ref => validRefs.has(ref)) } : undefined;
      if (windowFit && !windowFit.evidenceRefs.length) windowFit.status = 'unknown';
      return { status: 'ok', strategyPreferences: preferences, mediaObjective: raw.mediaObjective, requestReplan: raw.requestReplan,
        ...(isString(raw.replanReason) ? { replanReason: raw.replanReason } : {}), ...(windowFit ? { windowFit } : {}),
        ...(raw.measurement && isString(raw.measurement.kpi) && isString(raw.measurement.proof) ? { measurement: { kpi: raw.measurement.kpi, proof: raw.measurement.proof } } : {}),
        rejected, requestedCount: raw.strategyPreferences.length };
    } catch (error) { return { ...base, status: 'unavailable', reason: failureReason(error) }; }
  }
}
