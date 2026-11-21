import { Injectable } from '@nestjs/common';
import { AnalysisContext, BriefResult, CampaignOverride, IndustryId } from '../shared/contracts';
import { PlanDataService } from '../shared/data/plan-data.service';
import { buildContext } from '../shared/pipeline/context-builder';
import { RuntimeConfigService } from '../config/runtime-config.service';
import { LlmClient, failureReason } from './llm.client';
import { ContentScanService } from './content-scan.service';
import { briefSample, sampleDraft } from './prompts/__fixtures__/fixtures';

const labels = ['① 客户', '② 生意目标', '③ 活动目标', '④ 人群', '⑤ 时间与预算', '⑥ 媒体范围', '⑦ 成功衡量'];
const take = (text: string, label: string) => text.match(new RegExp(`(?:^|[；;。\\n])\\s*(?:${label})\\s*[:：]\\s*([^；;。\\n]+)`))?.[1]?.trim();
const validDate = (value: string) => /^2027-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function extractBrief(text: string): CampaignOverride {
  const draft: CampaignOverride = {};
  const name = take(text, '活动|战役|Campaign');
  const business = take(text, '生意目标|业务目标|生意问题');
  const audience = take(text, '人群|目标人群|客群');
  if (name) draft.name = name;
  if (business) draft.businessGoal = business;
  if (audience) draft.audience = audience;
  const goal = take(text, '主目标|目标');
  const explicit = (['认知', '到店', '促销', '拉新'] as const).find(value => goal?.includes(value));
  if (explicit) draft.primaryGoal = explicit;
  else if (/新品认知|品牌认知|提升知名度/.test(text)) draft.primaryGoal = '认知';
  else if (/试饮|促销/.test(text)) draft.primaryGoal = '促销';
  else if (/到店|到园|预约/.test(text)) draft.primaryGoal = '到店';
  else if (/拉新|新客|开户/.test(text)) draft.primaryGoal = '拉新';
  const dates = text.match(/2027-\d{2}-\d{2}/g) || [];
  const [start, end] = dates;
  if (typeof start === 'string' && typeof end === 'string' && validDate(start) && validDate(end) && start <= end) draft.window = { start, end };
  const budget = text.match(/预算(?:上限)?\s*[:：为是]?\s*(\d+(?:\.\d+)?)\s*(万|百万)?\s*元?/);
  if (budget) { const yuan = Number(budget[1]) * (budget[2] === '万' ? 10000 : budget[2] === '百万' ? 1000000 : 1); if (Number.isSafeInteger(yuan) && yuan > 0) draft.budgetHintYuan = yuan; }
  const media: ('bus' | 'metro')[] = [];
  if (/公交|bus\b/i.test(text)) media.push('bus');
  if (/地铁|metro\b/i.test(text)) media.push('metro');
  if (media.length) draft.mediaScope = media;
  const kpi = take(text, 'KPI|指标|成功衡量');
  const proof = take(text, '证明方式|取证方式|证明');
  if (kpi && proof) draft.successMetric = { kpi, proof };
  const constraints = take(text, '约束|合规约束');
  if (constraints) draft.constraints = constraints.split('、').filter(Boolean);
  return draft;
}

@Injectable()
export class BriefService {
  constructor(private readonly data: PlanDataService, private readonly config: RuntimeConfigService, private readonly llm: LlmClient, private readonly scan: ContentScanService) {}
  samples() { return { samples: this.data.data.briefs.industries.map(briefSample) }; }
  async parse(text: string, industryId?: IndustryId, context = this.config.context()): Promise<BriefResult> {
    this.scan.assertInput(text);
    const industry = this.data.data.briefs.industries.find(item => item.id === industryId);
    if (context.mode === 'off') return { status: 'disabled', campaignDraft: {}, missing: [...labels], confidence: 0, trace: [] };
    const exactSample = industry && briefSample(industry).text === text;
    const extracted = exactSample ? sampleDraft(industry) : extractBrief(text);
    let draft = extracted;
    let status: BriefResult['status'] = 'ok';
    const trace: BriefResult['trace'] = [];
    try {
      const payload = buildContext({ client: industry?.client, briefText: text }, context);
      this.scan.assertPrompt(payload);
      const result = await this.llm.complete<{ campaignDraft?: Record<string, unknown>; evidence?: Record<string, unknown> }>('brief.parse', context, payload, () => ({ campaignDraft: extracted as Record<string, unknown> }));
      if (!result || typeof result !== 'object' || !result.campaignDraft || typeof result.campaignDraft !== 'object') throw new Error('invalid');
      // Live text fields are accepted only when copied from the user's actual text.
      if (context.mode === 'live') {
        draft = { ...extracted };
        for (const field of ['name', 'businessGoal', 'audience'] as const) {
          const value = result.campaignDraft[field];
          if (typeof value === 'string' && value.trim() && text.includes(value)) draft[field] = value;
        }
      }
      trace.push({ step: 'brief', message: exactSample ? '按同源参考需求拆解；仍属提案假设' : '只保留需求原文明示的字段，未提供内容列入待补充', evidenceRefs: ['brief:user-text'] });
    } catch (error) { status = 'unavailable'; trace.push({ step: 'brief', message: failureReason(error), evidenceRefs: ['rule:brief-fallback'] }); }
    const covered = [!!take(text, '客户|广告主') || !!industry?.client.alias && text.includes(industry.client.alias), !!draft.businessGoal, !!draft.primaryGoal,
      !!draft.audience, !!draft.window && !!draft.budgetHintYuan, !!draft.mediaScope?.length, !!draft.successMetric?.kpi && !!draft.successMetric?.proof];
    return { status, campaignDraft: draft, missing: labels.filter((_value, index) => !covered[index]), confidence: Number((covered.filter(Boolean).length / labels.length).toFixed(2)), trace };
  }
}
