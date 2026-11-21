import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AnalysisContext } from '../shared/contracts';

export type LlmStage = 'brief.parse' | 'strategy.recommend' | 'copy.compose' | 'plan.verify';
export class AnalysisUnavailable extends Error {}
export const failureReason = (error: unknown): string => error instanceof AnalysisUnavailable ? error.message : '分析响应无效';
export const hasGeneratedPlanNumber = (value: string): boolean => /(?:[￥¥]\s*\d|\d+(?:\.\d+)?\s*(?:万|千)?\s*(?:元|辆|台|块|批|夜)|[一二三四五六七八九十百千万]+\s*(?:辆|台|元|批|夜)|(?:预算|金额|报价|数量|单价|可售量)\s*[:：为是]?\s*\d)/.test(value);

@Injectable()
export class LlmClient {
  async complete<T>(stage: LlmStage, context: AnalysisContext, payload: string, mock: () => T): Promise<T> {
    if (context.mode === 'off') throw new AnalysisUnavailable('分析已关闭');
    if (context.mode === 'mock') return structuredClone(mock());
    if (!context.config.llm.model.trim()) throw new AnalysisUnavailable('尚未配置模型');
    const paths = [resolve(__dirname, 'prompts', `${stage}.md`), resolve(__dirname, '../../../src/analysis/prompts', `${stage}.md`)];
    const promptPath = paths.find(existsSync);
    if (!promptPath) throw new AnalysisUnavailable('提示词模板不可用');
    const system = readFileSync(promptPath, 'utf8');
    const { llm } = context.config;
    if (llm.apiKey && payload.includes(llm.apiKey)) throw new AnalysisUnavailable('上下文含配置密钥，已停止发送');
    const endpoint = llm.baseUrl.endsWith('/chat/completions') ? llm.baseUrl : `${llm.baseUrl}/chat/completions`;
    for (let attempt = 0; attempt <= llm.retries; attempt++) {
      const remaining = context.deadline - Date.now();
      if (remaining <= 5) throw new AnalysisUnavailable('分析总时限已到');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(llm.timeoutMs, remaining));
      try {
        const response = await fetch(endpoint, { method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...(llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {}) },
          body: JSON.stringify({ model: llm.model, temperature: llm.temperature, messages: [{ role: 'system', content: system }, { role: 'user', content: payload }] }),
        });
        if (!response.ok) {
          if (response.status >= 500 || response.status === 429) throw new Error('retryable');
          throw new AnalysisUnavailable(`模型接口返回 HTTP ${response.status}`);
        }
        const body = await response.json() as { choices?: { message?: { content?: unknown } }[] };
        const content = body.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new AnalysisUnavailable('模型未返回 JSON 文本');
        let result: T;
        try { result = JSON.parse(content.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')) as T; }
        catch { throw new AnalysisUnavailable('模型 JSON 无法解析'); }
        if (Date.now() >= context.deadline) throw new AnalysisUnavailable('分析总时限已到');
        return result;
      } catch (error) {
        if (error instanceof AnalysisUnavailable) throw error;
        if (attempt === llm.retries || context.deadline - Date.now() <= 5) throw new AnalysisUnavailable(controller.signal.aborted ? '模型请求超时' : '模型连接不可用');
      } finally { clearTimeout(timeout); }
    }
    throw new AnalysisUnavailable('模型连接不可用');
  }
}
