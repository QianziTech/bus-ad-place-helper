import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createApplication } from '../src/main';
import { PipelineSuccess } from '../src/shared/contracts';

let app: NestExpressApplication;
let base: string;
const temporary = mkdtempSync(resolve(tmpdir(), 'bus-placead-api-'));
const previousConfig = process.env.LLM_CONFIG_PATH;
const previousMode = process.env.ANALYSIS_MODE;
const request = { industry: 'food', budgetYuan: 2000000, media: ['bus', 'metro'], startDate: '2027-06-01', endDate: '2027-06-30' };
async function api(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as any };
}
before(async () => {
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
  rmSync(temporary, { recursive: true, force: true });
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

test('HTTP validates real dates, nested fields and invalid requests; missing windows remain business responses', async () => {
  for (const change of [{ budgetYuan: 999999 }, { budgetYuan: '2000000' }, { media: ['bus', 'bus'] }, { startDate: '2027-02-30' },
    { startDate: '2026-06-01' }, { endDate: '2027-01-01' }, { campaignOverride: { realName: 'wrong' } }, { briefText: 'a'.repeat(2001) }, { extra: true }]) {
    assert.equal((await api('/plan/generate', { ...request, ...change })).status, 400, JSON.stringify(change));
  }
  const missing = await api('/plan', { ...request, startDate: '2027-07-01', endDate: '2027-07-31' });
  assert.equal(missing.status, 200);
  assert.equal(missing.body.status, 'missing_window');
  assert.equal((await api('/plan/copy', { plan: {}, campaign: {} })).status, 400);
  assert.equal((await api('/plan/verify', { plan: { status: 'ok' }, campaign: {} })).status, 400);
  assert.equal((await api('/plan', { ...request, briefText: '成交价 4.6 万元每辆' })).status, 400);
});

test('configuration switches immediately, masks keys and reports unavailable live without blocking plans', async () => {
  const changed = await api('/config', { mode: 'off', llm: { apiKey: 'integration-secret-1234' } }, 'PUT');
  assert.equal(changed.status, 200);
  assert.equal(changed.body.llm.hasKey, true);
  assert.equal(changed.body.llm.keyPreview, '****1234');
  assert.equal(JSON.stringify(changed.body).includes('integration-secret'), false);
  assert.equal(JSON.parse(readFileSync(resolve(temporary, 'runtime.json'), 'utf8')).mode, 'off');
  const ignoredPreference = (await api('/plan', { ...request, strategyPreferences: [{ mediaKey: 'unknown', reason: 'should not be applied when off', evidenceRefs: ['unknown'] }] })).body;
  assert.deepEqual(ignoredPreference.strategyPreferences ?? [], []);
  assert.ok(ignoredPreference.lines.every((line: any) => !line.preferredByAi));
  for (const invalid of [{ mode: null }, { llm: null }, { llm: { model: null } }, { includeHistoricalProfiles: null }]) {
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

test('OpenAPI discovers eleven stable operations and failure states without API keys', async () => {
  const schema = (await api('/openapi.json')).body;
  const operations = Object.values(schema.paths).flatMap((path: any) => Object.values(path).map((operation: any) => operation.operationId));
  assert.deepEqual(operations.sort(), ['getMeta', 'generatePlan', 'generatePlanPipeline', 'parseBrief', 'recommendStrategy', 'verifyPlan', 'composeCopy', 'getBriefSamples', 'getConfig', 'putConfig', 'testConfig'].sort());
  assert.equal(schema.paths['/api/plan'].post.responses['200'].content['application/json'].schema.oneOf.length, 5);
  assert.equal(schema.paths['/api/plan/generate'].post.responses['200'].content['application/json'].schema.oneOf.length, 5);
  assert.ok(schema.paths['/api/brief/parse'].post.responses['200'].content['application/json'].schema.oneOf.length >= 3);
  assert.equal(JSON.stringify(schema).includes('"apiKey"'), false);
  assert.ok(Object.keys(schema.components.schemas.CreatePlanDto.properties).includes('campaignOverride'));
  assert.equal((await fetch(base + '/docs')).status, 200);
  assert.equal((await fetch(base + '/docs/swagger-ui-bundle.js')).status, 200);
});
