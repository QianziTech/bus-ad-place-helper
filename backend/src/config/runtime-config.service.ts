import { BadRequestException, Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AnalysisContext, RuntimeConfig } from '../shared/contracts';
import { ANALYSIS_TIMEOUT_MS } from './analysis-timeout';

export type ConfigInput = Partial<Omit<RuntimeConfig, 'llm' | 'updatedAt' | 'source'>> & { llm?: Partial<RuntimeConfig['llm']> };

@Injectable()
export class RuntimeConfigService {
  private current: RuntimeConfig;
  readonly path: string;

  constructor() {
    const root = existsSync(resolve(process.cwd(), 'backend')) ? process.cwd() : resolve(process.cwd(), '..');
    this.path = process.env.LLM_CONFIG_PATH || resolve(root, 'data/config/runtime.json');
    const seeded: RuntimeConfig = {
      mode: (process.env.ANALYSIS_MODE || 'mock') as RuntimeConfig['mode'],
      llm: { provider: process.env.LLM_PROVIDER || 'compatible', baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
        model: process.env.LLM_MODEL || '', timeoutMs: Number(process.env.LLM_TIMEOUT_MS || ANALYSIS_TIMEOUT_MS), retries: 1,
        temperature: 0.2, ...(process.env.LLM_API_KEY ? { apiKey: process.env.LLM_API_KEY } : {}) },
      includeHistoricalProfiles: true, updatedAt: new Date().toISOString(), source: 'environment',
    };
    this.current = this.validate(existsSync(this.path) ? { ...JSON.parse(readFileSync(this.path, 'utf8')), source: 'file' } : seeded);
    if (!existsSync(this.path)) this.persist(this.current);
  }

  snapshot(): RuntimeConfig { return structuredClone(this.current); }
  context(): AnalysisContext { const config = this.snapshot(); return { mode: config.mode, config, deadline: Date.now() + ANALYSIS_TIMEOUT_MS }; }
  publicConfig() {
    const { apiKey, ...llm } = this.current.llm;
    return { ...this.current, llm: { ...llm, hasKey: !!apiKey, keyPreview: apiKey ? `****${apiKey.slice(-4)}` : '' } };
  }
  update(input: ConfigInput) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || (input.llm !== undefined && (!input.llm || typeof input.llm !== 'object' || Array.isArray(input.llm)))) throw new BadRequestException('运行配置格式无效');
    const supplied = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    const llm = Object.fromEntries(Object.entries(input.llm || {}).filter(([, value]) => value !== undefined));
    const next = this.validate({ ...this.current, ...supplied, llm: { ...this.current.llm, ...llm }, updatedAt: new Date().toISOString(), source: 'file' });
    this.persist(next);
    this.current = next;
    return this.publicConfig();
  }
  private validate(config: RuntimeConfig): RuntimeConfig {
    if (!['off', 'mock', 'live'].includes(config.mode) || typeof config.includeHistoricalProfiles !== 'boolean' || !config.llm) throw new BadRequestException('运行配置格式无效');
    const llm = config.llm;
    let url: URL;
    try { url = new URL(llm.baseUrl); } catch { throw new BadRequestException('baseUrl 必须为 HTTP(S) 地址'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new BadRequestException('baseUrl 不能包含认证信息、查询参数或片段');
    if (typeof llm.provider !== 'string' || !llm.provider.trim() || typeof llm.model !== 'string' || (llm.apiKey !== undefined && typeof llm.apiKey !== 'string') ||
        !Number.isInteger(llm.timeoutMs) || llm.timeoutMs < 100 || llm.timeoutMs > ANALYSIS_TIMEOUT_MS || !Number.isInteger(llm.retries) || llm.retries < 0 || llm.retries > 1 ||
        !Number.isFinite(llm.temperature) || llm.temperature < 0 || llm.temperature > 2) throw new BadRequestException('模型配置参数无效');
    return { mode: config.mode, llm: { provider: llm.provider, baseUrl: llm.baseUrl.replace(/\/+$/, ''), model: llm.model, timeoutMs: llm.timeoutMs, retries: llm.retries, temperature: llm.temperature, ...(llm.apiKey ? { apiKey: llm.apiKey } : {}) }, includeHistoricalProfiles: config.includeHistoricalProfiles, updatedAt: config.updatedAt, source: config.source };
  }
  private persist(config: RuntimeConfig) {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    try { writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 }); renameSync(temporary, this.path); }
    catch (error) { if (existsSync(temporary)) unlinkSync(temporary); throw error; }
  }
}
