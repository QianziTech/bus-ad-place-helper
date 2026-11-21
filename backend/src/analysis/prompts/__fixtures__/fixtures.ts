import { CampaignOverride, CandidatePool, Industry, IndustryId, PlanCopy, PlanSuccess, StrategyResult } from '../../../shared/contracts';

export const FIXTURE_INDUSTRIES: IndustryId[] = ['food', 'finance', 'health', 'hospital', 'park'];
const headlines: Record<IndustryId, string> = { food: '让清凉走进通勤日常', finance: '把金融服务带到身边', health: '让日常营养走近家庭', hospital: '让家庭健康服务更近', park: '让暑期出游从城市出发' };

export function briefSample(industry: Industry) {
  const c = industry.campaign;
  return { industry: industry.id, title: `${industry.name} · ${c.name}`,
    text: `客户：${industry.client.alias}；活动：${c.name}；生意目标：${c.businessGoal}；主目标：${c.primaryGoal}；人群：${c.audience}；档期：${c.window.start} 至 ${c.window.end}；预算：${c.budgetHintYuan} 元；媒体：${c.mediaScope.map(kind => kind === 'bus' ? '公交' : '地铁').join('、')}；KPI：${c.successMetric.kpi}；证明方式：${c.successMetric.proof}；约束：${c.constraints.join('、')}。` };
}

export function sampleDraft(industry: Industry): CampaignOverride {
  const { id: _id, ...campaign } = industry.campaign;
  return structuredClone(campaign);
}

export function strategyFixture(pool: CandidatePool): StrategyResult {
  const awareness = pool.campaign.primaryGoal === '认知';
  const candidates = [...pool.candidates].sort((a, b) => awareness
    ? Number(!!b.trafficReference) - Number(!!a.trafficReference) || a.mediaKey.localeCompare(b.mediaKey)
    : b.anchorIds.length - a.anchorIds.length || a.mediaKey.localeCompare(b.mediaKey));
  const anchors = new Set(pool.candidates.flatMap(candidate => candidate.anchorIds));
  const requestReplan = candidates.length > 0 && anchors.size === 1;
  return { status: 'ok', mediaObjective: awareness ? '结合有证据的历史人群参考扩大认知，覆盖关系另行核对' : '围绕已核对目的地覆盖，支持活动转化',
    strategyPreferences: candidates.slice(0, 12).map(candidate => ({ mediaKey: candidate.mediaKey,
      reason: awareness && candidate.trafficReference ? `历史画像可作为认知人群匹配参考，时期为 ${candidate.trafficReference.period}` : '已核对的锚点覆盖支持活动目的地触达',
      evidenceRefs: [...candidate.evidenceRefs.filter(ref => awareness || !ref.startsWith('traffic:')), `campaign:${pool.campaign.id}:primaryGoal`] })),
    requestReplan, ...(requestReplan ? { replanReason: '本轮候选集中在同一锚点，请在已有数据内扩展有证据的相邻候选' } : {}),
    windowFit: { status: pool.request.startDate > pool.campaign.window.start ? 'risk' : 'aligned', reason: '请求档期与活动窗口按日期核对，实际发布起算日以成案排期为准', evidenceRefs: [`campaign:${pool.campaign.id}:window`] },
    measurement: { ...pool.campaign.successMetric } };
}

export function copyFixture(plan: PlanSuccess): PlanCopy {
  return { headline: headlines[plan.request.industry], brandContext: `${plan.client.alias}面向${plan.campaign.audience}。本次以${plan.campaign.primaryGoal}为主目标，服务于${plan.campaign.businessGoal}。`,
    strategyLine: plan.request.media.length === 2 ? '地铁承接重点场景，公交补充城市动线覆盖。' : plan.request.media[0] === 'bus' ? '公交沿通勤动线承接场景认知与活动响应。' : '地铁围绕已核对目的地承接活动响应。',
    selectionRationale: '按成案媒体已有的覆盖与人群证据说明选择理由。历史参考仅用于人群判断，不能替代地理覆盖。', source: 'mock' };
}
