import { Injectable } from '@nestjs/common';
import { Campaign, Check, CopyResult, PlanCopy, PlanSuccess } from '../shared/contracts';
import { RuntimeConfigService } from '../config/runtime-config.service';
import { buildContext } from '../shared/pipeline/context-builder';
import { ContentScanService } from './content-scan.service';
import { LlmClient, failureReason } from './llm.client';
import { copyFixture } from './prompts/__fixtures__/fixtures';

export function templateCopy(plan: PlanSuccess, campaign = plan.campaign): PlanCopy {
  return { headline: `${campaign.primaryGoal}场景媒体提案`, brandContext: `${plan.client.alias}的本次方案围绕${campaign.primaryGoal}目标展开。客户背景与活动目标为提案假设。`,
    strategyLine: '按活动目标与已核对证据安排媒体分工，库存与预算由规则引擎核算。',
    selectionRationale: '优先采用有覆盖或历史人群依据的候选，具体选择与来源见成案明细。',
    assumptionEcho: '客户、生意目标、活动目标、人群、时间预算、媒体与衡量方法按当前假设书逐项回应，缺少依据处需补充确认。', source: 'template' };
}

@Injectable()
export class CopyService {
  constructor(private readonly config: RuntimeConfigService, private readonly llm: LlmClient, private readonly scan: ContentScanService) {}
  async compose(plan: PlanSuccess, campaign: Campaign = plan.campaign, _checks: Check[] = [], context = this.config.context()): Promise<CopyResult> {
    const fallback = templateCopy(plan, campaign);
    if (context.mode === 'off') return { status: 'disabled', copy: fallback };
    try {
      const payload = buildContext({ plan, campaign }, context);
      this.scan.assertPrompt(payload);
      const raw = await this.llm.complete<Partial<PlanCopy>>('copy.compose', context, payload, () => copyFixture({ ...plan, campaign }));
      if (!raw || typeof raw !== 'object') throw new Error('invalid');
      const copy = { ...fallback };
      const missing: string[] = [];
      for (const slot of ['headline', 'brandContext', 'strategyLine', 'selectionRationale', 'assumptionEcho'] as const) {
        const value = raw[slot];
        if (typeof value !== 'string' || !value.trim() || value.length > (slot === 'headline' ? 18 : 800) || (context.mode === 'live' && /\d|[一二三四五六七八九十百千万]+\s*(?:辆|台|元|批|夜)/.test(value))) { missing.push(slot); continue; }
        copy[slot] = value.trim();
      }
      copy.source = missing.length ? 'template' : context.mode === 'mock' ? 'mock' : 'llm';
      return { status: 'ok', copy, ...(missing.length ? { reason: `以下文案槽位已使用模板：${missing.join('、')}` } : {}) };
    } catch (error) { return { status: 'unavailable', copy: fallback, reason: failureReason(error) }; }
  }
}
