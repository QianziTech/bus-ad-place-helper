import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RuntimeConfigService } from '../src/config/runtime-config.service';
import { ConfigController } from '../src/config/config.controller';
import { PutConfigDto } from '../src/config/config.dto';
import { ContentScanService } from '../src/analysis/content-scan.service';
import { LlmClient } from '../src/analysis/llm.client';
import { BriefService } from '../src/analysis/brief.service';
import { StrategyService } from '../src/analysis/strategy.service';
import { CopyService } from '../src/analysis/copy.service';
import { VerifyService } from '../src/analysis/verify.service';
import { EngineService } from '../src/engine/engine.service';
import { ScheduleService } from '../src/engine/schedule.service';
import { PlanDataService } from '../src/shared/data/plan-data.service';
import { PlanPipelineService } from '../src/shared/pipeline/plan-pipeline.service';
import { AnalysisContext, Campaign, INDUSTRIES, PlanData, PlanRequest, PlanSuccess } from '../src/shared/contracts';
import { buildContext } from '../src/shared/pipeline/context-builder';
import { assertPlan } from '../src/analysis/analysis.controller';
import { HongdouInventoryService } from '../src/inventory/hongdou.client';
import { InventoryService } from '../src/inventory/inventory.service';

const request: PlanRequest = { industry: 'food', budgetYuan: 1000000, media: ['bus'], startDate: '2027-07-01', endDate: '2027-07-31' };
function testData(): PlanData {
  const campaign: Campaign = { id: 'F1-C1', name: '测试认知活动', businessGoal: '提升新品认知', primaryGoal: '认知', audience: '通勤人群',
    window: { start: '2027-07-01', end: '2027-07-31' }, budgetHintYuan: 1000000, mediaScope: ['bus'], mediaBias: { bus: 1, metro: 1 },
    successMetric: { kpi: '扫码量', proof: '上下刊照片' }, constraints: ['不承诺收益', '不出现疗效承诺'] };
  const data: PlanData = { bus: { mediaByKey: {}, windows: [{ startDate: request.startDate, endDate: request.endDate, queriedAt: '2026-11-21T00:00:00Z', billingMonths: 1, inventoryByKey: {} }] }, metro: { mediaByKey: {}, windows: [] },
    pricing: { pricesByMediaKey: {} }, briefs: { industries: INDUSTRIES.map((id, index) => ({ id, name: `${id} 测试行业`, client: { code: `T${index}`, alias: `某${id}客户`, category: `${id}品类`, scale: '测试规模' }, campaign: { ...structuredClone(campaign), id: `T${index}-C1` }, anchors: [{ id: 'anchor-one', rationale: '明确模拟覆盖' }] })) },
    coverage: { anchorsById: { 'anchor-one': { areaName: '模拟商圈', station: '模拟站', role: 'businessArea', coord: { lng: 121, lat: 31, exit: '1', source: 'test-only' }, candidates: [] } } }, traffic: { byMediaKey: {} }, trajectories: { crs: 'GCJ02', source: 'test-only', byLineName: {} } };
  for (let index = 0; index < 12; index++) {
    const key = `bus|${index}|车身`;
    data.bus.mediaByKey[key] = { kind: 'bus', resourceId: index, lineName: `模拟${index}路`, levelName: 'A+', mediaForm: '车身' };
    data.bus.windows[0].inventoryByKey[key] = { freeCount: 100 };
    data.pricing.pricesByMediaKey[key] = { monthlyLowYuan: 30000, monthlyHighYuan: 50000, productionYuan: 7500, source: 'test-only', assumptions: ['公交制作费按 7500 元/辆估算'] };
    if (index === 0) data.coverage.anchorsById['anchor-one'].candidates.push({ mediaKey: key, relation: '模拟覆盖', source: 'test-only' });
    else data.traffic.byMediaKey[key] = { period: '2023-05', source: 'test-only', coveragePv: index * 100, ageGroups: [{ label: '20-40', percent: 50 }] };
  }
  return data;
}
function setup(mode: 'off' | 'mock' | 'live' = 'mock', client = new LlmClient()) {
  const dir = mkdtempSync(join(tmpdir(), 'analysis-test-'));
  const previous = { path: process.env.LLM_CONFIG_PATH, mode: process.env.ANALYSIS_MODE, mapping: process.env.BRAND_MAPPING_PATH, key: process.env.LLM_API_KEY };
  process.env.LLM_CONFIG_PATH = join(dir, 'runtime.json'); process.env.ANALYSIS_MODE = mode;
  process.env.BRAND_MAPPING_PATH = join(dir, 'mapping.json'); delete process.env.LLM_API_KEY;
  writeFileSync(process.env.BRAND_MAPPING_PATH, JSON.stringify({ map: [{ real: '内部测试实名', alias: '某测试客户' }] }));
  const config = new RuntimeConfigService();
  const scan = new ContentScanService();
  for (const [name, value] of Object.entries({ LLM_CONFIG_PATH: previous.path, ANALYSIS_MODE: previous.mode, BRAND_MAPPING_PATH: previous.mapping, LLM_API_KEY: previous.key })) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  const data = { data: testData() } as PlanDataService;
  const engine = new EngineService(data, new ScheduleService());
  const brief = new BriefService(data, config, client, scan);
  const strategy = new StrategyService(engine, config, client, scan);
  const copy = new CopyService(config, client, scan);
  const verify = new VerifyService(config, client, scan);
  const inventory = new InventoryService(data, new HongdouInventoryService(), { online: false });
  const pipeline = new PlanPipelineService(engine, config, brief, strategy, copy, verify, scan, inventory);
  return { dir, config, scan, data, engine, brief, strategy, copy, verify, pipeline, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('runtime config hot applies, retains in-flight snapshots, masks key and persists', t => {
  const s = setup(); t.after(s.cleanup);
  const before = s.config.context();
  const result = s.config.update({ mode: 'off', llm: { apiKey: 'secret-testing-1234' }, includeHistoricalProfiles: false });
  assert.equal(before.mode, 'mock'); assert.equal(s.config.context().mode, 'off');
  assert.equal(result.llm.keyPreview, '****1234'); assert.equal(result.llm.hasKey, true);
  assert.ok(!JSON.stringify(result).includes('secret-testing-1234'));
  assert.equal(JSON.parse(readFileSync(s.config.path, 'utf8')).mode, 'off');
  const previousPath = process.env.LLM_CONFIG_PATH; process.env.LLM_CONFIG_PATH = s.config.path;
  const reloaded = new RuntimeConfigService();
  if (previousPath === undefined) delete process.env.LLM_CONFIG_PATH; else process.env.LLM_CONFIG_PATH = previousPath;
  assert.equal(reloaded.snapshot().mode, 'off'); assert.equal(reloaded.publicConfig().llm.keyPreview, '****1234');
  const originalLlm = s.config.snapshot().llm;
  s.config.update(plainToInstance(PutConfigDto, { mode: 'mock' }));
  assert.deepEqual(s.config.snapshot().llm, originalLlm); assert.equal(s.config.snapshot().includeHistoricalProfiles, false);
  s.config.update(plainToInstance(PutConfigDto, { llm: { model: 'changed-model' } }));
  assert.deepEqual(s.config.snapshot().llm, { ...originalLlm, model: 'changed-model' });
  for (const input of [{ mode: null }, { llm: null }, { includeHistoricalProfiles: null }, { llm: { apiKey: null } }, { llm: { retries: null } }]) {
    assert.ok(validateSync(plainToInstance(PutConfigDto, input)).length, JSON.stringify(input));
    assert.throws(() => s.config.update(input as unknown as PutConfigDto));
  }
  assert.throws(() => s.config.update({ llm: { retries: 2 } }));
  assert.throws(() => s.config.update({ llm: { baseUrl: 'https://user:secret@example.invalid/v1' } }));
  assert.equal(s.config.context().mode, 'mock');
});

test('same-source samples cover five industries; custom brief never borrows absent fields', async t => {
  const s = setup(); t.after(s.cleanup);
  const samples = s.brief.samples().samples; assert.equal(samples.length, 5);
  for (const sample of samples) { const parsed = await s.brief.parse(sample.text, sample.industry); assert.equal(parsed.status, 'ok'); assert.equal(parsed.missing.length, 0); }
  const custom = await s.brief.parse('希望提升新品认知，投放公交。', 'food');
  assert.equal(custom.campaignDraft.primaryGoal, '认知'); assert.deepEqual(custom.campaignDraft.mediaScope, ['bus']);
  assert.equal(custom.campaignDraft.budgetHintYuan, undefined); assert.equal(custom.campaignDraft.audience, undefined); assert.equal(custom.campaignDraft.window, undefined);
  assert.ok(custom.missing.includes('⑤ 时间与预算')); assert.ok(custom.missing.includes('① 客户'));
  const testConfig = await new ConfigController(s.config, new LlmClient()).test();
  assert.deepEqual(testConfig, { ok: true, fixtures: { covered: 5, total: 5 } });
});

test('mock pipeline expands once and recalculates numbers from the engine for changed budget', async t => {
  const s = setup(); t.after(s.cleanup);
  const first = await s.pipeline.generate(request); assert.equal(first.status, 'ok'); if (first.status !== 'ok') return;
  const larger = await s.pipeline.generate({ ...request, budgetYuan: 2000000 }); assert.equal(larger.status, 'ok'); if (larger.status !== 'ok') return;
  assert.equal(first.rounds.length, 2); assert.ok(first.rounds[1].candidateCount > first.rounds[0].candidateCount);
  assert.equal(first.copy.source, 'mock'); assert.equal(first.exportAllowed, true); assert.deepEqual(first.degraded, []);
  assert.ok(larger.totalYuan > first.totalYuan); assert.ok(larger.totalYuan <= 2000000);
  const expected = s.engine.generate(larger.request, s.engine.getCandidates(larger.request, true) as Exclude<ReturnType<EngineService['getCandidates']>, { status: Exclude<string, 'ok'> }>);
  assert.equal(expected.status, 'ok'); if (expected.status === 'ok') assert.deepEqual(larger.lines, expected.lines);
  assert.ok(first.rounds.every(round => round.rejected.every(item => ['unknown_media', 'no_stock', 'over_budget', 'premium_exceeded', 'invalid_evidence'].includes(item.reason))));
});

test('off mode returns template and deterministic checks; verification changes refs with quantity', async t => {
  const s = setup('off'); t.after(s.cleanup);
  const result = await s.pipeline.generate(request); assert.equal(result.status, 'ok'); if (result.status !== 'ok') return;
  assert.equal(result.copy.source, 'template'); assert.equal(result.exportAllowed, true); assert.equal(result.rounds.length, 1); assert.deepEqual(result.degraded, [{ stage: 'strategy', reason: 'skipped' }, { stage: 'copy', reason: 'skipped' }]);
  const before = await s.verify.verify(result); const again = await s.verify.verify(result);
  assert.deepEqual(before, again); assert.equal(before.status, 'disabled');
  const changed = structuredClone(result); changed.lines[0].quantity += 1;
  const after = await s.verify.verify(changed);
  assert.notDeepEqual(before.checks.find(check => check.element === '⑤')?.evidenceRefs, after.checks.find(check => check.element === '⑤')?.evidenceRefs);
  assert.match(after.checks.find(check => check.element === '⑤')!.message, /行金额与单位估算乘数量不一致/); assert.equal(after.exportAllowed, true);
  const wrongRemaining = structuredClone(result); wrongRemaining.remainingYuan += 1;
  const remainingCheck = (await s.verify.verify(wrongRemaining)).checks.find(check => check.element === '⑤')!;
  assert.equal(remainingCheck.status, 'warn'); assert.match(remainingCheck.message, /预算余量/);
  assert.notDeepEqual(before.checks.find(check => check.element === '⑤')?.evidenceRefs, remainingCheck.evidenceRefs);
  assertPlan(result);
  assert.throws(() => assertPlan({ ...result, schedule: undefined } as unknown as PlanSuccess));
});

test('independent verification scans copy and export text, allowing negative constraints and production assumptions', async t => {
  const s = setup('off'); t.after(s.cleanup);
  const plan = s.engine.generate(request); assert.equal(plan.status, 'ok'); if (plan.status !== 'ok') return;
  assert.equal(s.scan.scan('不承诺收益；不出现疗效承诺；禁止保本；不得治愈宣传').length, 0);
  assert.equal(s.scan.scan('公交制作费按 7500 元/辆估算').length, 0);
  for (const text of ['有疗效', '保本', '治愈', '内部测试实名', '实付 4.6 万/辆', '单价 50000 元']) {
    const result = await s.verify.verify(plan, plan.campaign, { headline: text }); assert.equal(result.exportAllowed, false, text);
    assert.ok(result.checks.some(check => check.status === 'fail' && check.blocking));
  }
  assert.equal((await s.verify.verify(plan, plan.campaign, undefined, '<h1>保本投资</h1>')).exportAllowed, false);
  assert.equal((await s.verify.verify(plan, plan.campaign, { headline: '刊例为 3–5 万元/辆，按中值估算' })).exportAllowed, true);
  await assert.rejects(() => s.brief.parse('内部测试实名希望投放广告', 'food'));
});

test('verification reports each finding once instead of repeating merged campaignOverrides', async t => {
  const s = setup('off'); t.after(s.cleanup);
  const text = '实付 4.6 万/辆';
  const base = s.engine.generate(request); assert.equal(base.status, 'ok'); if (base.status !== 'ok') return;
  const once = await s.verify.verify(base, base.campaign);
  assert.equal(once.checks.filter(check => check.location && check.message.includes('成交价')).length, 0);
  const overridden = s.engine.generate({ ...request, campaignOverride: { businessGoal: text } }); assert.equal(overridden.status, 'ok'); if (overridden.status !== 'ok') return;
  const repeated = await s.verify.verify(overridden, overridden.campaign);
  const hits = repeated.checks.filter(check => check.location && check.message.includes('成交价'));
  assert.equal(hits.length, 1);
  assert.ok(hits[0].location!.startsWith('output.plan.campaign.businessGoal'), hits[0].location);
  // An independently supplied campaign is still scanned.
  const other = await s.verify.verify(base, { ...base.campaign, businessGoal: text });
  assert.equal(other.checks.filter(check => check.location && check.message.includes('成交价')).length, 1);
});

test('invalid and duplicate model preferences are rejected with evidence reasons', async t => {
  class InvalidClient extends LlmClient {
    override async complete<T>(): Promise<T> { return { strategyPreferences: [
      { mediaKey: 'bus|0|车身', reason: '有覆盖', evidenceRefs: ['coverage:anchor-one:bus|0|车身'] },
      { mediaKey: 'bus|0|车身', reason: '重复', evidenceRefs: ['coverage:anchor-one:bus|0|车身'] },
      { mediaKey: 'bus|11|车身', reason: '无媒体证据', evidenceRefs: ['campaign:T0-C1:primaryGoal'] },
      { mediaKey: 'unknown', reason: '不存在', evidenceRefs: ['invented'] }], mediaObjective: '测试', requestReplan: false } as T; }
  }
  const s = setup('mock', new InvalidClient()); t.after(s.cleanup);
  const result = await s.strategy.recommend(request);
  assert.equal(result.strategyPreferences.length, 1);
  assert.deepEqual(result.rejected.map(item => item.reason), ['invalid_evidence', 'invalid_evidence', 'unknown_media']);
});

test('white-list context omits secrets, other industries, trace and disabled historical profiles', t => {
  const s = setup(); t.after(s.cleanup);
  const pool = s.engine.getCandidates(request); assert.equal(pool.status, 'ok'); if (pool.status !== 'ok') return;
  s.config.update({ llm: { apiKey: 'never-in-prompt' }, includeHistoricalProfiles: false });
  const context = buildContext({ pool }, s.config.context());
  assert.ok(context.includes('[客户]') && context.includes('[活动]') && context.includes('[候选]') && context.includes('[约束]'));
  for (const absent of ['never-in-prompt', '某finance客户', 'trafficReference', 'traffic:', 'apiKey', 'trace']) assert.ok(!context.includes(absent), absent);
});

test('live compatible endpoint receives header key only, malformed slots fall back and time budget includes retries', async t => {
  const bodies: { body: string; key?: string }[] = [];
  let slow = false;
  let sendHeadersFirst = false;
  const server = createServer((req, res) => {
    let body = ''; req.on('data', chunk => { body += String(chunk); });
    req.on('end', () => { bodies.push({ body, key: req.headers.authorization });
      const answer = () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ headline: '测试场景主标题', brandContext: '', strategyLine: '共投放 999 台', selectionRationale: '依据已核对覆盖解释', assumptionEcho: '业务目标为提案假设' }) } }] })); };
      if (sendHeadersFirst) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.flushHeaders();
        setTimeout(() => res.end('{}'), 500);
      } else if (slow) setTimeout(answer, 500); else answer();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const s = setup('live'); t.after(s.cleanup);
  s.config.update({ llm: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'test-model', apiKey: 'header-only-secret', timeoutMs: 100, retries: 1 } });
  const plan = s.engine.generate(request); assert.equal(plan.status, 'ok'); if (plan.status !== 'ok') return;
  const result = await s.copy.compose(plan); assert.equal(result.status, 'ok'); assert.equal(result.copy.headline, '测试场景主标题'); assert.equal(result.copy.source, 'template');
  assert.ok(!result.copy.strategyLine.includes('999')); assert.equal(bodies[0].key, 'Bearer header-only-secret'); assert.ok(!bodies[0].body.includes('header-only-secret'));
  slow = true;
  const context: AnalysisContext = { ...s.config.context(), modelTime: { remainingMs: 150 } };
  const started = Date.now();
  await assert.rejects(() => new LlmClient().complete('brief.parse', context, '[客户] {} [活动] {} [候选] [] [约束] {}', () => ({})), /等待模型响应头超时.*共享时限剩余.*第 2 次尝试.*输入/);
  assert.ok(Date.now() - started < 350, 'remaining shared deadline must cap the retry');
  assert.ok(bodies.length <= 3);
  const attempts = bodies.length;
  await assert.rejects(() => new LlmClient().complete('brief.parse', context, '{}', () => ({})), /本环节未发起模型请求/);
  assert.equal(bodies.length, attempts);
  sendHeadersFirst = true;
  s.config.update({ llm: { retries: 0 } });
  await assert.rejects(() => new LlmClient().complete('brief.parse', s.config.context(), '{}', () => ({})), /读取模型响应正文超时.*单次请求上限.*第 1 次尝试/);
});

test('time spent on inventory and rule calculation does not consume the model request budget', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const calls: string[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const prompt = JSON.parse(body).messages[0].content as string;
    let content: object;
    if (prompt.includes('strategyPreferences')) {
      calls.push('strategy');
      content = { strategyPreferences: [], mediaObjective: '以认知为主', requestReplan: false };
    } else if (prompt.includes('headline')) {
      calls.push('copy');
      content = { headline: '通勤场景', brandContext: '围绕认知目标', strategyLine: '聚焦通勤覆盖', selectionRationale: '使用已核对的覆盖依据' };
    } else {
      calls.push('verify');
      content = { checks: [] };
    }
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const s = setup('live'); t.after(s.cleanup);
  s.config.update({ llm: { baseUrl: `http://127.0.0.1:${address.port}`, model: 'test-model' } });
  const { budgetYuan: _budget, ...rangeRequest } = request;
  const budgetProgress: string[] = [];
  const result = await s.pipeline.generate(rangeRequest, stage => {
    if (stage.status === 'running' && (stage.key === 'inventory' || stage.key === 'engine')) now += 180_000;
    if (stage.key === 'engine' && stage.detail.startsWith('已核算')) budgetProgress.push(stage.detail);
  });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(calls, ['strategy', 'copy', 'verify']);
  assert.deepEqual(result.degraded, []);
  assert.equal(budgetProgress[0], '已核算 0/401 个预算档');
  assert.equal(budgetProgress.at(-1), '已核算 400/401 个预算档');
});

test('failed live stages degrade without losing a valid deterministic plan', async t => {
  const s = setup('live'); t.after(s.cleanup);
  const result = await s.pipeline.generate(request); assert.equal(result.status, 'ok'); if (result.status !== 'ok') return;
  assert.equal(result.copy.source, 'template'); assert.equal(result.exportAllowed, true);
  assert.deepEqual(result.degraded.map(item => item.stage), ['strategy', 'copy', 'verify']);
});

test('excluded unpriced preference triggers the second round even without model replan flag', async t => {
  class MissingPriceClient extends LlmClient {
    override async complete<T>(stage: Parameters<LlmClient['complete']>[0], _context: AnalysisContext, _payload: string, mock: () => T): Promise<T> {
      if (stage !== 'strategy.recommend') return mock();
      return { strategyPreferences: [{ mediaKey: 'bus|11|车身', reason: '历史人群匹配', evidenceRefs: ['traffic:bus|11|车身:2023-05'] }], mediaObjective: '人群认知', requestReplan: false } as T;
    }
  }
  const s = setup('mock', new MissingPriceClient()); t.after(s.cleanup);
  delete s.data.data.pricing.pricesByMediaKey['bus|11|车身'];
  const result = await s.pipeline.generate(request); assert.equal(result.status, 'ok'); if (result.status !== 'ok') return;
  assert.equal(result.rounds.length, 2); assert.ok(result.rounds[0].requestReplan);
  assert.deepEqual(result.rounds[0].rejected, [{ mediaKey: 'bus|11|车身', reason: 'invalid_evidence' }]);
});

test('pipeline catches unexpected brief and strategy failures; one config snapshot spans the chain', async t => {
  const s = setup(); t.after(s.cleanup);
  const contexts: AnalysisContext[] = [];
  s.brief.parse = async () => { throw new Error('invalid fixture'); };
  s.strategy.recommend = async (_request, _pool, context) => { contexts.push(context!); s.config.update({ mode: 'off' }); throw new Error('unexpected response'); };
  const originalCompose = s.copy.compose.bind(s.copy);
  s.copy.compose = async (plan, campaign, checks, context) => { contexts.push(context!); return originalCompose(plan, campaign, checks, context); };
  const result = await s.pipeline.generate({ ...request, briefText: '希望提升新品认知，投放公交。' });
  assert.equal(result.status, 'ok'); if (result.status !== 'ok') return;
  assert.deepEqual(result.degraded.map(item => item.stage), ['brief', 'strategy']);
  assert.equal(result.copy.source, 'mock'); assert.equal(s.config.context().mode, 'off');
  assert.ok(contexts.length >= 2 && contexts.every(context => context === contexts[0]));
});
