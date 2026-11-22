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
    const started = Date.now();
    const modelTime = context.modelTime;
    const deadline = started + modelTime.remainingMs;
    for (let attempt = 0; attempt <= llm.retries; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 5) throw new AnalysisUnavailable(attempt === 0 ? '共享分析时限已用完，本环节未发起模型请求' : '共享分析时限已用完，未能重试模型请求');
      const controller = new AbortController();
      const sharedLimit = remaining <= llm.timeoutMs;
      const limitMs = Math.min(llm.timeoutMs, remaining);
      const timeout = setTimeout(() => controller.abort(), limitMs);
      let phase = '等待模型响应头';
      try {
        const response = await fetch(endpoint, { method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...(llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {}) },
          body: JSON.stringify({ model: llm.model, temperature: llm.temperature, messages: [{ role: 'system', content: system }, { role: 'user', content: payload }] }),
        });
        phase = '读取模型响应正文';
        if (!response.ok) {
          const retryable = response.status >= 500 || response.status === 429;
          if (retryable && attempt < llm.retries && deadline - Date.now() > 5) {
            await response.body?.cancel();
            continue;
          }
          throw new AnalysisUnavailable(`模型接口返回 HTTP ${response.status}`);
        }
        const body = await response.json().catch(error => {
          if (error instanceof SyntaxError) throw new AnalysisUnavailable('模型接口响应正文不是 JSON');
          throw error;
        }) as { choices?: { message?: { content?: unknown } }[] } | null;
        const content = body?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new AnalysisUnavailable('模型未返回 JSON 文本');
        let result: T;
        try { result = JSON.parse(content.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')) as T; }
        catch { throw new AnalysisUnavailable('模型 JSON 无法解析'); }
        if (Date.now() >= deadline) throw new AnalysisUnavailable('收到模型结果时，共享分析时限已用完');
        return result;
      } catch (error) {
        if (error instanceof AnalysisUnavailable) throw error;
        if (attempt === llm.retries || deadline - Date.now() <= 5) {
          const elapsed = ((Date.now() - started) / 1000).toFixed(1);
          const diagnostic = `第 ${attempt + 1} 次尝试，累计 ${elapsed} 秒，输入 ${(system.length + payload.length).toLocaleString('zh-CN')} 字符`;
          if (controller.signal.aborted) {
            const limit = sharedLimit ? '共享时限剩余' : '单次请求上限';
            throw new AnalysisUnavailable(`${phase}超时（${limit} ${(limitMs / 1000).toFixed(1)} 秒，${diagnostic}）`);
          }
          const cause = error instanceof Error ? error.cause as { code?: unknown } | undefined : undefined;
          const code = typeof cause?.code === 'string' && /^[A-Z_][A-Z_\d]*$/.test(cause.code) ? `，${cause.code}` : '';
          throw new AnalysisUnavailable(`${phase}失败（${diagnostic}${code}）`);
        }
      } finally {
        clearTimeout(timeout);
        modelTime.remainingMs = Math.max(0, deadline - Date.now());
      }
    }
    throw new AnalysisUnavailable('模型连接不可用');
  }
}
