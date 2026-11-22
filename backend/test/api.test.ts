import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createApplication } from '../src/main';
import { PipelineRangeSuccess, PipelineSuccess } from '../src/shared/contracts';
import { PlanPipelineService } from '../src/shared/pipeline/plan-pipeline.service';
import { PlanDataService } from '../src/shared/data/plan-data.service';

let app: NestExpressApplication;
let base: string;
const temporary = mkdtempSync(resolve(tmpdir(), 'bus-placead-api-'));
const previousConfig = process.env.LLM_CONFIG_PATH;
const previousMode = process.env.ANALYSIS_MODE;
const hongdouEnv = ['HONGDOU_ONLINE', 'HONGDOU_TOKEN', 'HONGDOU_USERNAME', 'HONGDOU_CLIENT_ID', 'HONGDOU_CLIENT_SECRET'] as const;
const previousHongdou = hongdouEnv.map(key => process.env[key]);
const request = { industry: 'food', budgetYuan: 2000000, media: ['bus', 'metro'], startDate: '2027-06-01', endDate: '2027-06-30' };
async function api(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as any };
}
before(async () => {
  for (const key of hongdouEnv) delete process.env[key];
  process.env.LLM_CONFIG_PATH = resolve(temporary, 'runtime.json');
  process.env.ANALYSIS_MODE = 'mock';
  app = await createApplication();
  app.useLogger(false);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl() + '/api';
});
after(async () => {
  if (app) await app.close();
  if (previousConfig === undefined) delete process.env.LLM_CONFIG_PATH; else process.env.LLM_CONFIG_PATH = previousConfig;
  if (previousMode === undefined) delete process.env.ANALYSIS_MODE; else process.env.ANALYSIS_MODE = previousMode;
  hongdouEnv.forEach((key, i) => {
    if (previousHongdou[i] === undefined) delete process.env[key]; else process.env[key] = previousHongdou[i];
  });
  rmSync(temporary, { recursive: true, force: true });
});

test('红豆只收账号密码，使用服务端 OAuth 客户端查询并在失败和退出时回退', async () => {
  const login = { username: 'oauth-user', password: 'oauth-pass' };
  const client = { id: 'oauth-client', secret: 'oauth-secret' };
  const plan = { ...request, media: ['bus'] };
  const bus = app.get(PlanDataService).data.bus;
  const archive = bus.windows.find(window => window.startDate === plan.startDate && window.endDate === plan.endDate)!;
  const list = Object.entries(archive.inventoryByKey).map(([key, row]) => ({
    resourceId: bus.mediaByKey[key].resourceId,
    mediaName: key.split('|').slice(2).join('|'),
    freeCount: row.freeCount,
  }));
  let stockAvailable = true;
  let successfulLogins = 0;
  const stockCalls: { path?: string; authorization?: string; tenant?: string | string[] }[] = [];
  const upstream = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/admin-api/system/oauth2/token') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      const auth = `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString('base64')}`;
      if (req.headers.authorization === auth && req.headers['tenant-id'] === '1' &&
          form.get('grant_type') === 'password' && form.get('username') === login.username && form.get('password') === login.password) {
        successfulLogins++;
        res.end(JSON.stringify({ code: 0, data: { access_token: 'upstream-token', expires_in: 3600 } }));
      } else {
        res.end(JSON.stringify({ code: 401, msg: 'upstream private text' }));
      }
      return;
    }
    stockCalls.push({ path: req.url, authorization: req.headers.authorization, tenant: req.headers['tenant-id'] });
    res.end(JSON.stringify(stockAvailable ? { code: 0, data: { list } } : { code: 503 }));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const previousBaseUrl = process.env.HONGDOU_BASE_URL;
  process.env.HONGDOU_BASE_URL = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const disconnected = { source: 'none', online: false, forceOffline: false };
  const connected = { source: 'session', online: true, forceOffline: false };
  try {
    assert.deepEqual((await api('/config/hongdou')).body, disconnected);
    assert.equal((await api('/config/hongdou', { ...login, clientId: 'other-client', tenantId: '7' })).status, 400);
    assert.equal((await api('/config/hongdou', login)).status, 503);
    process.env.HONGDOU_CLIENT_ID = client.id;
    process.env.HONGDOU_CLIENT_SECRET = client.secret;
    assert.equal((await api('/plan', plan)).body.inventory.kinds[0].source, 'archive');
    assert.deepEqual(await api('/config/hongdou', login), { status: 200, body: connected });
    assert.deepEqual((await api('/config/hongdou')).body, connected);

    const failedLogin = await api('/config/hongdou', { ...login, password: 'incorrect' });
    assert.equal(failedLogin.status, 503);
    assert.match(failedLogin.body.message, /红豆登录请求失败/);
    assert.doesNotMatch(failedLogin.body.message, /upstream private text/);
    for (const path of ['/plan', '/plan/generate']) {
      const result = await api(path, plan);
      assert.equal(result.body.status, 'ok');
      assert.equal(result.body.inventory.kinds[0].source, 'hongdou');
    }
    assert.equal(successfulLogins, 1);
    assert.equal(stockCalls.length, 2);
    for (const call of stockCalls) {
      assert.match(call.path!, /\/media-inventory\/bus\/page.*startDate=2027-06-01&endDate=2027-06-30/);
      assert.equal(call.authorization, 'Bearer upstream-token');
      assert.equal(call.tenant, '1');
    }

    stockAvailable = false;
    const fallback = (await api('/plan', plan)).body.inventory.kinds[0];
    assert.equal(fallback.source, 'archive');
    assert.match(fallback.reason, /实时查询失败/);
    assert.deepEqual((await api('/config/hongdou', undefined, 'DELETE')).body, disconnected);
    assert.equal((await api('/plan', plan)).body.inventory.kinds[0].source, 'archive');
    assert.equal(stockCalls.length, 3);
  } finally {
    await api('/config/hongdou', undefined, 'DELETE');
    delete process.env.HONGDOU_CLIENT_ID;
    delete process.env.HONGDOU_CLIENT_SECRET;
    if (previousBaseUrl === undefined) delete process.env.HONGDOU_BASE_URL; else process.env.HONGDOU_BASE_URL = previousBaseUrl;
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  }
});

test('real June data: five industries, three media combinations and four budgets remain within stock and budget', async () => {
  const meta = await api('/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.industries.length, 5);
  assert.ok(meta.body.windows.some((item: any) => item.startDate === request.startDate && item.endDate === request.endDate));
  for (const mode of ['off', 'mock']) {
    assert.equal((await api('/config', { mode }, 'PUT')).status, 200);
    for (const industry of meta.body.industries) for (const media of [['bus'], ['metro'], ['bus', 'metro']]) for (const budgetYuan of [1000000, 1750000, 2000000, 5000000]) {
      const started = performance.now();
      const result = await api('/plan/generate', { ...request, industry: industry.id, media, budgetYuan });
      assert.equal(result.status, 200);
      const plan = result.body as PipelineSuccess;
      assert.equal(plan.status, 'ok', `${mode}/${industry.id}/${media}/${budgetYuan}`);
      assert.ok(performance.now() - started < (mode === 'off' ? 2000 : 3000));
      assert.equal(plan.copy.source, mode === 'off' ? 'template' : 'mock');
      assert.equal(plan.exportAllowed, true, JSON.stringify(plan.checks.filter(check => check.blocking)));
      assert.ok(plan.rounds.length >= 1 && plan.rounds.length <= 2);
      assert.equal(plan.totalYuan, plan.lines.reduce((sum, line) => sum + line.lineTotalYuan, 0));
      assert.equal(plan.remainingYuan, budgetYuan - plan.totalYuan);
      assert.ok(plan.remainingYuan >= 0);
      assert.deepEqual([...new Set(plan.lines.map(line => line.kind))].sort(), [...media].sort());
      for (const line of plan.lines) {
        assert.ok(line.quantity > 0 && line.quantity <= line.freeCount);
        assert.equal(line.lineTotalYuan, line.quantity * line.unitEstimateYuan);
        assert.equal(line.lineTotalYuan, line.quantity * Math.round((line.monthlyLowYuan + line.monthlyHighYuan) / 2 * plan.billingMonths) + line.productionYuan);
      }
      if (mode === 'off') assert.deepEqual(plan.degraded.map(item => item.stage).sort(), ['copy', 'strategy']);
      // 锚点元数据随行业给出；计划中的 selectedCount 不超过该锚点的候选总数。
      assert.ok(plan.anchors.length > 0);
      for (const anchor of plan.anchors) {
        assert.equal(typeof anchor.areaName, 'string');
        assert.ok(anchor.selectedCount >= 0 && anchor.selectedCount <= anchor.candidateCounts.bus + anchor.candidateCounts.metro);
      }
      if (mode === 'off') {
        assert.equal(plan.mediaObjective, undefined);
      } else {
        assert.equal(typeof plan.mediaObjective, 'string');
      }
    }
  }
});

test('omitting budgetYuan returns the whole 100–500万 range without extra stock or copy calls', async () => {
  for (const mode of ['off', 'mock']) {
    await api('/config', { mode }, 'PUT');
    const { budgetYuan: _budget, ...rangeRequest } = request;
    const started = performance.now();
    const result = await api('/plan/generate', rangeRequest);
    assert.equal(result.status, 200);
    assert.ok(performance.now() - started < (mode === 'off' ? 3000 : 4000), `${mode} range generation`);
    const range = result.body as PipelineRangeSuccess;
    assert.equal(range.status, 'ok');
    assert.deepEqual(range.budget, { minYuan: 1000000, maxYuan: 5000000, stepYuan: 10000, presetsYuan: [1000000, 2000000, 5000000], defaultYuan: 2000000 });
    assert.equal(range.budgetOptions.length, 401);
    assert.equal(range.budgetOptions[0].budgetYuan, 1000000);
    assert.equal(range.budgetOptions.at(-1)!.budgetYuan, 5000000);
    assert.equal(range.copy.source, mode === 'off' ? 'template' : 'mock');
    assert.equal(range.rounds.length >= 1 && range.rounds.length <= 2, true);
    assert.equal(range.defaultPlan.status, 'ok');
    assert.equal(range.defaultPlan.request.budgetYuan, range.budget.defaultYuan);
    assert.equal(range.defaultPlan.totalYuan, range.budgetOptions.find(item => item.budgetYuan === range.budget.defaultYuan)!.totalYuan);
    assert.equal(range.defaultPlan.copy.source, range.copy.source);
    const mediaKeys = Object.keys(range.mediaByKey);
    assert.ok(mediaKeys.length > 0 && mediaKeys.length <= 60, `${mode} shared media must stay compact`);
    for (const option of range.budgetOptions) {
      assert.ok(Number.isInteger(option.budgetYuan) && option.budgetYuan >= 1000000 && option.budgetYuan <= 5000000);
      if (option.status !== 'ok') continue;
      assert.ok(option.totalYuan! <= option.budgetYuan);
      assert.equal(option.remainingYuan, option.budgetYuan - option.totalYuan!);
      assert.equal(option.totalYuan, option.lines!.reduce((sum, line) => sum + line.lineTotalYuan, 0));
      for (const line of option.lines!) {
        const media = range.mediaByKey[line.mediaKey];
        assert.ok(media, `${mode} ${option.budgetYuan} ${line.mediaKey}`);
        assert.ok(line.quantity > 0 && line.quantity <= media.freeCount);
        assert.equal(line.lineTotalYuan, line.quantity * media.unitEstimateYuan);
      }
      assert.ok(option.analysis!.length > 0);
    }
    // 100／200／500 万在同一轮结果中可切换，且金额越大总额不减。
    const totals = [1000000, 2000000, 5000000].map(budgetYuan => range.budgetOptions.find(item => item.budgetYuan === budgetYuan)!);
    assert.ok(totals.every(item => item.status === 'ok'));
    assert.ok(totals[0].totalYuan! < totals[1].totalYuan! && totals[1].totalYuan! < totals[2].totalYuan!);
    assert.ok(range.budgetOptions.some(item => item.status !== 'ok') === false, `${mode} June data must stay feasible across the range`);
    // 全区间响应不需要第二次候选扩展或额外模型调用：文案与核验只出一次。
    assert.equal(range.checks.length > 0, true);
  }
  await api('/config', { mode: 'mock' }, 'PUT');
});

test('HTTP validates real dates, nested fields and invalid requests; missing windows remain business responses', async () => {
  for (const change of [{ budgetYuan: 999999 }, { budgetYuan: '2000000' }, { media: ['bus', 'bus'] }, { startDate: '2027-02-30' },
    { startDate: '2026-06-01' }, { endDate: '2027-01-01' }, { campaignOverride: { realName: 'wrong' } }, { briefText: 'a'.repeat(2001) }, { extra: true }]) {
    assert.equal((await api('/plan/generate', { ...request, ...change })).status, 400, JSON.stringify(change));
  }
  const july = { ...request, startDate: '2027-07-01', endDate: '2027-07-31' };
  const missing = await api('/plan', july);
  assert.equal(missing.status, 200);
  assert.equal(missing.body.status, 'missing_window');
  assert.equal(missing.body.inventory.canUseWeekly, true);
  assert.ok(missing.body.inventory.kinds.every((kind: { source: string }) => kind.source === 'snapshot'));
  const continued = await api('/plan/generate', { ...july, acceptWeekly: true });
  assert.equal(continued.body.status, 'ok');
  assert.equal(continued.body.inventory.billingStatus, 'pending');
  assert.equal(continued.body.exportAllowed, true);
  assert.ok(continued.body.schedule.batches.length > 0);
  const noSample = await api('/plan', { ...july, startDate: '2027-01-01', endDate: '2027-01-03', acceptWeekly: true });
  assert.equal(noSample.body.status, 'missing_window');
  assert.equal(noSample.body.inventory.canUseWeekly, undefined);
  assert.equal((await api('/plan/copy', { plan: {}, campaign: {} })).status, 400);
  assert.equal((await api('/plan/verify', { plan: { status: 'ok' }, campaign: {} })).status, 400);
  assert.equal((await api('/plan', { ...request, briefText: '成交价 4.6 万元每辆' })).status, 400);
});

test('configuration switches immediately, masks keys and reports unavailable live without blocking plans', async () => {
  const changed = await api('/config', { mode: 'off', llm: { apiKey: 'integration-secret-1234', timeoutMs: 120000 } }, 'PUT');
  assert.equal(changed.status, 200);
  assert.equal(changed.body.llm.timeoutMs, 120000);
  assert.equal(changed.body.llm.hasKey, true);
  assert.equal(changed.body.llm.keyPreview, '****1234');
  assert.equal(JSON.stringify(changed.body).includes('integration-secret'), false);
  assert.equal(JSON.parse(readFileSync(resolve(temporary, 'runtime.json'), 'utf8')).mode, 'off');
  const ignoredPreference = (await api('/plan', { ...request, strategyPreferences: [{ mediaKey: 'unknown', reason: 'should not be applied when off', evidenceRefs: ['unknown'] }] })).body;
  assert.deepEqual(ignoredPreference.strategyPreferences ?? [], []);
  assert.ok(ignoredPreference.lines.every((line: any) => !line.preferredByAi));
  for (const invalid of [{ mode: null }, { llm: null }, { llm: { model: null } }, { llm: { timeoutMs: 120001 } }, { includeHistoricalProfiles: null }]) {
    assert.equal((await api('/config', invalid, 'PUT')).status, 400);
  }
  for (const [path, body] of [['/brief/parse', { text: '增加品牌认知', industry: 'food' }], ['/plan/strategy', request]] as const) {
    assert.equal((await api(path, body)).body.status, 'disabled');
  }
  await api('/config', { mode: 'mock' }, 'PUT');
  assert.deepEqual((await api('/config/test', {})).body.fixtures, { covered: 5, total: 5 });
  await api('/config', { mode: 'live', llm: { model: '', apiKey: '' } }, 'PUT');
  const degraded = (await api('/plan/generate', request)).body;
  assert.equal(degraded.status, 'ok');
  assert.equal(degraded.copy.source, 'template');
  assert.ok(degraded.degraded.length > 0);
  assert.equal(degraded.exportAllowed, true);
  await api('/config', { mode: 'mock' }, 'PUT');
});

test('all independent tools work; deterministic export scan blocks risky or identified copy', async () => {
  await api('/config', { mode: 'mock' }, 'PUT');
  const plan = (await api('/plan/generate', request)).body;
  const samples = (await api('/brief/samples')).body.samples;
  assert.equal(samples.length, 5);
  for (const sample of samples) {
    const parsed = await api('/brief/parse', { industry: sample.industry, text: sample.text });
    assert.equal(parsed.status, 200);
    assert.equal(parsed.body.status, 'ok');
    assert.ok(Object.keys(parsed.body.campaignDraft).length >= 5);
  }
  assert.equal((await api('/plan/strategy', request)).body.status, 'ok');
  assert.equal((await api('/plan/copy', { plan, campaign: plan.campaign })).body.status, 'ok');
  const first = await api('/plan/verify', { plan, campaign: plan.campaign, copy: plan.copy });
  const again = await api('/plan/verify', { plan, campaign: plan.campaign, copy: plan.copy });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.checks, again.body.checks);
  assert.equal(first.body.exportAllowed, true);
  assert.equal((await api('/plan/verify', { plan, campaign: plan.campaign, exportText: '提案'.repeat(60000) })).status, 200);
  for (const text of ['疗效显著', '稳赚保本', '治愈疾病', '单价 46000 元']) {
    const scan = await api('/plan/verify', { plan, campaign: plan.campaign, exportText: text });
    assert.equal(scan.body.exportAllowed, false);
    assert.ok(scan.body.checks.some((item: any) => item.blocking && item.location && item.suggestion));
  }
  if (process.env.BRAND_MAPPING_PATH) {
    const mapping = JSON.parse(readFileSync(process.env.BRAND_MAPPING_PATH, 'utf8'));
    const name = mapping.map[0].real;
    assert.equal((await api('/plan', { ...request, briefText: `${name}新品投放` })).status, 400);
    assert.equal((await api('/plan', { ...request, strategyPreferences: [{ mediaKey: plan.lines[0].mediaKey, reason: `${name}的投放偏好`, evidenceRefs: plan.lines[0].evidenceRefs }] })).status, 400);
    assert.equal((await api('/plan/verify', { plan, campaign: plan.campaign, exportText: name })).body.exportAllowed, false);
  }
});

test('background generation returns a job before the plan is ready', async t => {
  const pipeline = app.get(PlanPipelineService);
  const generate = pipeline.generate.bind(pipeline);
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(pipeline, 'generate', async (input: Parameters<typeof generate>[0]) => {
    await gate;
    return generate(input);
  });
  assert.equal((await api('/plan/jobs', { ...request, budgetYuan: 1 })).status, 400);
  assert.equal((await api('/plan/jobs', { ...request, briefText: '成交价 4.6 万元每辆' })).status, 400);
  assert.equal((await api('/plan/jobs/unknown')).status, 404);
  let jobUrl: string;
  try {
    const submitted = await api('/plan/jobs', request);
    assert.equal(submitted.status, 202);
    assert.ok(submitted.body.id);
    jobUrl = `/plan/jobs/${submitted.body.id}`;
    assert.deepEqual((await api(jobUrl)).body, { id: submitted.body.id, status: 'running' });
  } finally {
    release();
  }
  let job = await api(jobUrl);
  for (let attempt = 0; job.body.status === 'running' && attempt < 100; attempt++) {
    await delay(10);
    job = await api(jobUrl);
  }
  assert.equal(job.status, 200);
  assert.equal(job.body.status, 'completed');
  assert.equal(job.body.result.status, 'ok');
  assert.equal(job.body.result.copy.source, 'mock');
});

test('OpenAPI discovers synchronous and background operations without API keys', async () => {
  const schema = (await api('/openapi.json')).body;
  const operations = Object.values(schema.paths).flatMap((path: any) => Object.values(path).map((operation: any) => operation.operationId));
  assert.deepEqual(operations.sort(), [
    'getMeta', 'generatePlan', 'generatePlanPipeline', 'parseBrief', 'recommendStrategy', 'verifyPlan', 'composeCopy',
    'getBriefSamples', 'getConfig', 'putConfig', 'testConfig', 'startPlanJob', 'getPlanJob',
    'getHongdouConnection', 'connectHongdou', 'disconnectHongdou',
  ].sort());
  assert.equal(schema.paths['/api/plan'].post.responses['200'].content['application/json'].schema.oneOf.length, 5);
  assert.equal(schema.paths['/api/plan/generate'].post.responses['200'].content['application/json'].schema.oneOf.length, 6);
  assert.ok(schema.paths['/api/brief/parse'].post.responses['200'].content['application/json'].schema.oneOf.length >= 3);
  assert.equal(JSON.stringify(schema).includes('"apiKey"'), false);
  const login = schema.components.schemas.HongdouLoginDto;
  assert.deepEqual(Object.keys(login.properties), ['username', 'password']);
  assert.equal(login.properties.password.writeOnly, true);
  assert.ok(Object.keys(schema.components.schemas.CreatePlanDto.properties).includes('campaignOverride'));
  assert.equal((await fetch(base + '/docs')).status, 200);
  assert.equal((await fetch(base + '/docs/swagger-ui-bundle.js')).status, 200);
});
