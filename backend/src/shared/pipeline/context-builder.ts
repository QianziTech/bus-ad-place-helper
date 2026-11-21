import { AnalysisContext, Campaign, CandidatePool, Client, PlanRequest, PlanSuccess } from '../contracts';

// Only explicitly selected presentation fields enter a model request.
export function buildContext(input: { client?: Client; campaign?: Campaign; request?: PlanRequest; pool?: CandidatePool; plan?: PlanSuccess; briefText?: string; copy?: Record<string, string>; checkRefs?: string[] }, context: AnalysisContext): string {
  const client = input.client || input.plan?.client || input.pool?.client;
  const campaign = input.campaign || input.plan?.campaign || input.pool?.campaign;
  const request = input.request || input.plan?.request || input.pool?.request;
  const candidates = input.pool?.candidates || input.plan?.lines || [];
  const customer = client ? { code: client.code, alias: client.alias, category: client.category, scale: client.scale, channelNote: client.channelNote } : {};
  const activity = campaign ? { id: campaign.id, name: campaign.name, businessGoal: campaign.businessGoal, primaryGoal: campaign.primaryGoal, audience: campaign.audience,
    window: { start: campaign.window.start, end: campaign.window.end }, budgetHintYuan: campaign.budgetHintYuan, mediaScope: campaign.mediaScope,
    mediaBias: { bus: campaign.mediaBias.bus, metro: campaign.mediaBias.metro }, successMetric: { kpi: campaign.successMetric.kpi, proof: campaign.successMetric.proof }, constraints: campaign.constraints } : {};
  const rows = candidates.map(item => JSON.stringify({ mediaKey: item.mediaKey, name: item.name, kind: item.kind, levelName: item.levelName,
    freeCount: item.freeCount, monthlyLowYuan: item.monthlyLowYuan, monthlyHighYuan: item.monthlyHighYuan,
    evidenceRefs: item.evidenceRefs.filter(ref => context.config.includeHistoricalProfiles || !ref.startsWith('traffic:')),
    reasons: item.reasons.filter(reason => context.config.includeHistoricalProfiles || !/历史画像|历史客流|历史人群/.test(reason)),
    ...(context.config.includeHistoricalProfiles && item.trafficReference ? { trafficReference: { period: item.trafficReference.period, source: item.trafficReference.source, coveragePv: item.trafficReference.coveragePv, ageGroups: item.trafficReference.ageGroups?.map(group => ({ label: group.label, percent: group.percent })) } } : {}),
    ...('quantity' in item ? { quantity: item.quantity, lineTotalYuan: item.lineTotalYuan } : {}) }));
  return `[客户]\n${JSON.stringify(customer)}\n[活动]\n${JSON.stringify({ ...activity, ...(input.briefText ? { briefText: input.briefText } : {}) })}\n[候选]\n${rows.join('\n')}\n[约束]\n${JSON.stringify({ budgetYuan: request?.budgetYuan, startDate: request?.startDate, endDate: request?.endDate, media: request?.media,
    ...(input.plan ? { totalYuan: input.plan.totalYuan, queriedAt: input.plan.queriedAt, publishStartDate: input.plan.schedule.batches.at(-1)?.publishStartDate } : {}),
    ...(input.copy ? { copy: input.copy } : {}), ...(input.checkRefs ? { allowedEvidenceRefs: input.checkRefs } : {}) })}`;
}
