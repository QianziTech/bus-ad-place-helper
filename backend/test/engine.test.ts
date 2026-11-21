import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { EngineService } from '../src/engine/engine.service';
import { ScheduleService } from '../src/engine/schedule.service';
import { CreatePlanDto } from '../src/engine/dto/create-plan.dto';
import { PlanData, PlanRequest, PlanSuccess, StrategyPreference } from '../src/shared/contracts';
import { isPlanDate, validatePlanData } from '../src/shared/data/plan-data';
import { PlanDataService } from '../src/shared/data/plan-data.service';

const bus = 'bus|1|车身';
const preferred = 'bus|2|车身';
const expensive = 'bus|3|车身';
const metro = 'metro|4|1号口';
const dates = { startDate: '2027-07-01', endDate: '2027-07-31' };
function data(): PlanData {
  const window = { ...dates, queriedAt: '2026-11-21T08:00:00+08:00', billingMonths: 1 };
  return {
    bus: { mediaByKey: {
      [bus]: { kind: 'bus', resourceId: 1, lineName: '1 路', levelName: 'A+', mediaForm: '车身', total: 200 },
      [preferred]: { kind: 'bus', resourceId: 2, lineName: '2 路', levelName: 'A+', mediaForm: '车身', total: 200 },
      [expensive]: { kind: 'bus', resourceId: 3, lineName: '3 路', levelName: 'A+', mediaForm: '车身', total: 200 },
    }, windows: [{ ...window, inventoryByKey: { [bus]: { freeCount: 100, contractCount: 3, reservedCount: 2 }, [preferred]: { freeCount: 100 }, [expensive]: { freeCount: 100 } } }] },
    metro: { mediaByKey: { [metro]: { kind: 'metro', resourceId: 4, lineName: '示例站', levelName: 'A+', exit: '1号口', total: 3 } }, windows: [{ ...window, queriedAt: '2026-11-21T09:00:00+08:00', inventoryByKey: { [metro]: { freeCount: 2 } } }] },
    pricing: { pricesByMediaKey: {
      [bus]: { monthlyLowYuan: 40000, monthlyHighYuan: 50000, productionYuan: 5000, source: '示例月刊例', assumptions: ['单位一次性制作费为 5000 元估算'] },
      [preferred]: { monthlyLowYuan: 44000, monthlyHighYuan: 54000, productionYuan: 5000, source: '示例月刊例', assumptions: [] },
      [expensive]: { monthlyLowYuan: 55000, monthlyHighYuan: 65000, productionYuan: 5000, source: '示例月刊例', assumptions: [] },
      [metro]: { monthlyLowYuan: 190000, monthlyHighYuan: 208000, productionYuan: 1000, source: '示例月刊例', assumptions: ['面积为估算'] },
    } },
    briefs: { industries: [{ id: 'food', name: '食品饮料', client: { code: 'F1', alias: '某全国性饮用水品牌', category: '饮用水', scale: '全国性', channelNote: '便利店', selectionBasis: '仅内部解释' }, campaign: { id: 'F1-C1', name: '夏季新品认知', businessGoal: '增加新品认知', primaryGoal: '认知', audience: '18–40 岁通勤人群', window: { start: dates.startDate, end: dates.endDate }, budgetHintYuan: 2000000, mediaScope: ['bus', 'metro'], mediaBias: { bus: 0.5, metro: 0.5 }, successMetric: { kpi: '扫码量', proof: '上下刊照片' }, constraints: [] }, anchors: [{ id: 'a1', rationale: '通勤场景' }, { id: 'a2', rationale: '零售场景' }] }] },
    coverage: { anchorsById: {
      a1: { areaName: '示例商圈', station: '示例站', role: 'businessArea', coord: { lng: 121, lat: 31, exit: '1号口', source: '平台代表出口' }, candidates: [{ mediaKey: bus, relation: '公交线路覆盖', source: '平台覆盖', distanceM: 300 }, { mediaKey: metro, relation: '站点精确匹配', source: '站点目录' }] },
      a2: { areaName: '另一商圈', station: '另一站', role: 'businessArea', coord: { lng: 121.1, lat: 31.1, exit: '1号口', source: '平台代表出口' }, candidates: [{ mediaKey: bus, relation: '公交线路覆盖', source: '独立覆盖核对', distanceM: 500 }] },
    } },
    traffic: { byMediaKey: {
      [bus]: { period: '2023-05', source: '公交历史参考', coveragePv: 10000 },
      [preferred]: { period: '2023-05', source: '公交历史参考', coveragePv: 20000, ageGroups: [{ label: '18-40', percent: 80 }] },
      [expensive]: { period: '2023-05', source: '公交历史参考', coveragePv: 15000 },
    } },
  };
}
function engine(input = data(), schedule = new ScheduleService()) { return new EngineService({ data: input } as PlanDataService, schedule); }
function request(extra: Partial<PlanRequest> = {}): PlanRequest { return { industry: 'food', budgetYuan: 1000000, media: ['bus', 'metro'], ...dates, ...extra }; }
function pref(key: string, refs = [`traffic:${key}:2023-05`]): StrategyPreference { return { mediaKey: key, reason: '画像匹配活动人群', evidenceRefs: refs }; }
function ok(result: ReturnType<EngineService['generate']>): asserts result is PlanSuccess { assert.equal(result.status, 'ok'); }

test('data loader reads five required files, allows optional traffic and validates cross references', () => {
  const fixture = data();
  validatePlanData(fixture);
  const directory = mkdtempSync(join(tmpdir(), 'plan-engine-'));
  try {
    for (const name of ['bus', 'metro', 'pricing', 'briefs', 'coverage'] as const) writeFileSync(join(directory, `${name}.json`), JSON.stringify(fixture[name]));
    const loaded = new PlanDataService(directory);
    assert.deepEqual(loaded.data.traffic, { byMediaKey: {} });
    const broken = data();
    broken.coverage.anchorsById.a1.candidates[0].mediaKey = 'bus|999|车身';
    assert.throws(() => validatePlanData(broken), /未知媒体/);
    broken.coverage.anchorsById.a1.candidates[0].mediaKey = bus;
    broken.pricing.pricesByMediaKey[bus].productionYuan = 1.5;
    assert.throws(() => validatePlanData(broken), /安全整数/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('request DTO rejects invalid calendar dates, years, budgets, duplicate media and nested unknown fields', () => {
  const validate = (value: unknown) => validateSync(plainToInstance(CreatePlanDto, value), { whitelist: true, forbidNonWhitelisted: true });
  assert.equal(validate(request()).length, 0);
  assert.equal(isPlanDate('2027-02-29'), false);
  for (const update of [
    { startDate: '2027-02-29' }, { startDate: '2028-01-01' }, { endDate: '2027-06-30' }, { budgetYuan: 999999 }, { budgetYuan: 5000001 }, { budgetYuan: 1000000.5 },
    { media: [] }, { media: ['bus', 'bus'] }, { campaignOverride: null }, { campaignOverride: { id: 'other' } },
    { campaignOverride: { mediaBias: { bus: 0, metro: 0 } } }, { campaignOverride: { window: { start: '2027-07-01', end: '2027-02-30' } } },
    { campaignOverride: { successMetric: { kpi: '扫码' } } }, { briefText: '字'.repeat(2001) },
  ]) assert.ok(validate({ ...request(), ...update }).length > 0, JSON.stringify(update));
  assert.equal(validate(request({ campaignOverride: { primaryGoal: '到店', mediaBias: { bus: 0, metro: 1 } } })).length, 0);
});

test('metadata deduplicates windows and exposes only public client fields', () => {
  const result = engine().getMeta();
  assert.deepEqual(result.windows, [dates]);
  assert.equal(result.industries[0].client.selectionBasis, undefined);
  assert.equal(result.budget.maxYuan, 5000000);
});

test('anchors expose coverage counts from metadata and selected counts from the plan', () => {
  const meta = engine().getMeta();
  assert.deepEqual(meta.industries[0].anchors, [
    { id: 'a1', areaName: '示例商圈', station: '示例站', role: 'businessArea', rationale: '通勤场景', candidateCounts: { bus: 1, metro: 1 } },
    { id: 'a2', areaName: '另一商圈', station: '另一站', role: 'businessArea', rationale: '零售场景', candidateCounts: { bus: 1, metro: 0 } },
  ]);
  const plan = engine().generate(request());
  ok(plan);
  // 同一公交媒体命中两个锚点，各锚点分别计数，不跨锚点求和。
  assert.deepEqual(plan.anchors.map(anchor => [anchor.id, anchor.candidateCounts, anchor.selectedCount]), [
    ['a1', { bus: 1, metro: 1 }, 2],
    ['a2', { bus: 1, metro: 0 }, 1],
  ]);
});

test('exact full windows are mandatory for each selected media; queriedAt is the older timestamp', () => {
  const fixture = data();
  fixture.metro.windows[0].endDate = '2027-07-30';
  assert.equal(engine(fixture).generate(request()).status, 'missing_window');
  assert.equal(engine(fixture).generate(request({ media: ['bus'] })).status, 'ok');
  const result = engine().generate(request());
  ok(result);
  assert.equal(result.queriedAt, '2026-11-21T08:00:00+08:00');
});

test('no_inventory takes precedence over missing_data while unknown inventory never becomes zero', () => {
  const fixture = data();
  for (const inventory of Object.values(fixture.bus.windows[0].inventoryByKey)) inventory.freeCount = 0;
  fixture.metro.windows[0].inventoryByKey[metro].freeCount = null;
  const result = engine(fixture).generate(request());
  assert.equal(result.status, 'no_inventory');
  assert.match('message' in result ? result.message : '', /公交.*零库存.*地铁.*缺少/);
  fixture.bus.windows[0].inventoryByKey[bus].freeCount = null;
  assert.equal(engine(fixture).generate(request()).status, 'missing_data');
  fixture.bus.windows[0].inventoryByKey[bus].freeCount = 1;
  fixture.metro.windows[0].inventoryByKey[metro].freeCount = 1;
  fixture.metro.windows[0].billingMonths = 2;
  assert.equal(engine(fixture).generate(request()).status, 'missing_data');
});

test('over_budget requires complete information that cannot conceal a cheaper combination', () => {
  const fixture = data();
  for (const price of Object.values(fixture.pricing.pricesByMediaKey)) { price.monthlyLowYuan = 600000; price.monthlyHighYuan = 600000; }
  assert.equal(engine(fixture).generate(request()).status, 'over_budget');
  delete fixture.pricing.pricesByMediaKey[preferred];
  assert.equal(engine(fixture).generate(request()).status, 'missing_data');
  fixture.bus.windows[0].inventoryByKey[preferred].freeCount = 0;
  assert.equal(engine(fixture).generate(request()).status, 'over_budget');
});

test('merged POI and profile evidence share one stock count; amounts and production units are exact', () => {
  const fixture = data();
  fixture.bus.windows[0].inventoryByKey[bus].freeCount = 2;
  const service = engine(fixture);
  const pool = service.getCandidates(request());
  assert.equal(pool.status, 'ok');
  if (pool.status !== 'ok') return;
  const candidate = pool.candidates.find(item => item.mediaKey === bus)!;
  assert.equal(candidate.anchorIds.length, 2);
  assert.equal(candidate.evidenceRefs.length, 3);
  assert.equal(candidate.productionYuan, 5000);
  const result = service.generate(request(), pool);
  ok(result);
  assert.equal(result.lines.find(line => line.mediaKey === bus)!.quantity, 2);
  for (const line of result.lines) {
    assert.ok(line.quantity <= line.freeCount);
    assert.equal(line.lineTotalYuan, line.unitEstimateYuan * line.quantity);
    assert.equal(line.productionYuan, fixture.pricing.pricesByMediaKey[line.mediaKey].productionYuan * line.quantity);
  }
  assert.equal(result.totalYuan, result.lines.reduce((sum, line) => sum + line.lineTotalYuan, 0));
  assert.equal(result.remainingYuan, result.request.budgetYuan - result.totalYuan);
  assert.ok(result.remainingYuan >= 0);
  assert.deepEqual(service.generate(request(), pool), result);
});

test('month interval midpoint is rounded once and production is charged once per unit', () => {
  const fixture = data();
  fixture.bus.windows[0].billingMonths = 1.5;
  fixture.pricing.pricesByMediaKey[bus] = { monthlyLowYuan: 40001, monthlyHighYuan: 50000, productionYuan: 5000, source: '核对刊例', assumptions: [] };
  const result = engine(fixture).generate(request({ media: ['bus'] }));
  ok(result);
  assert.equal(result.lines.find(line => line.mediaKey === bus)!.unitEstimateYuan, Math.round(45000.5 * 1.5) + 5000);
});

test('valid profile-only preference changes allocation within 10 percent and preserves the cheapest media combination', () => {
  const service = engine();
  const base = service.generate(request());
  const result = service.generate(request({ strategyPreferences: [pref(preferred)] }));
  ok(base); ok(result);
  assert.equal(base.lines.some(line => line.mediaKey === preferred), false);
  assert.ok(result.lines.some(line => line.mediaKey === preferred && line.preferredByAi));
  assert.ok(result.lines.some(line => line.mediaKey === bus));
  assert.ok(result.lines.some(line => line.mediaKey === metro));
  assert.equal(result.strategyPreferences?.[0].disposition, 'accepted');
  assert.ok(result.trace.some(step => step.message.includes('4000 元')));
});

test('preference validation exposes premium, stock, budget, unknown and evidence rejections', () => {
  const fixture = data();
  fixture.bus.windows[0].inventoryByKey[preferred].freeCount = 0;
  const result = engine(fixture).generate(request({ strategyPreferences: [
    pref(expensive), pref(preferred), pref('bus|999|车身'), pref(bus, ['campaign:F1-C1:audience']), pref(bus),
  ] }));
  ok(result);
  assert.deepEqual(result.strategyPreferences?.map(item => item.disposition), ['rejected:premium_exceeded', 'rejected:no_stock', 'rejected:unknown_media', 'rejected:invalid_evidence', 'rejected:invalid_evidence']);
  const costly = data();
  costly.pricing.pricesByMediaKey[preferred].monthlyLowYuan = 2000000;
  costly.pricing.pricesByMediaKey[preferred].monthlyHighYuan = 2000000;
  const over = engine(costly).generate(request({ strategyPreferences: [pref(preferred)] }));
  ok(over);
  assert.equal(over.strategyPreferences?.[0].disposition, 'rejected:over_budget');
});

test('configured premium ceiling changes preference acceptance without changing inventory or pricing', () => {
  const fixture = data();
  const service = new EngineService({ data: fixture } as PlanDataService, new ScheduleService(), { premiumRatio: 0.05 });
  const result = service.generate(request({ strategyPreferences: [pref(preferred)] }));
  ok(result);
  assert.equal(result.strategyPreferences?.[0].disposition, 'rejected:premium_exceeded');
  assert.ok(result.lines.every(line => line.mediaKey !== preferred));
  assert.throws(() => new EngineService({ data: fixture } as PlanDataService, new ScheduleService(), { premiumRatio: -1 }), /溢价/);
});

test('the same preference recalculates at 1, 2 and 5 million without exceeding inventory or budget', () => {
  const service = engine();
  const strategyPreferences = [pref(preferred)];
  const totals = [1000000, 2000000, 5000000].map(budgetYuan => {
    const result = service.generate(request({ budgetYuan, strategyPreferences }));
    ok(result);
    assert.ok(result.totalYuan <= budgetYuan);
    assert.ok(result.lines.every(line => line.quantity <= line.freeCount));
    assert.equal(result.strategyPreferences?.[0].disposition, 'accepted');
    return result.totalYuan;
  });
  assert.ok(totals[0] < totals[1] && totals[1] < totals[2]);
  assert.equal(strategyPreferences[0].disposition, undefined);
});

test('the second round expands to remaining evidenced profiles using unchanged local stock and prices', () => {
  const fixture = data();
  for (let id = 5; id <= 16; id++) {
    const key = `bus|${id}|车身`;
    fixture.bus.mediaByKey[key] = { kind: 'bus', resourceId: id, lineName: `${id} 路`, levelName: 'A+', mediaForm: '车身' };
    fixture.bus.windows[0].inventoryByKey[key] = { freeCount: id };
    fixture.pricing.pricesByMediaKey[key] = structuredClone(fixture.pricing.pricesByMediaKey[preferred]);
    fixture.traffic.byMediaKey[key] = { period: '2023-05', source: '历史画像', coveragePv: id * 1000 };
  }
  const service = engine(fixture);
  const first = service.getCandidates(request());
  const second = service.getCandidates(request(), true);
  assert.equal(first.status, 'ok'); assert.equal(second.status, 'ok');
  if (first.status !== 'ok' || second.status !== 'ok') return;
  assert.ok(first.candidates.length < second.candidates.length);
  for (const candidate of first.candidates) assert.deepEqual(second.candidates.find(item => item.mediaKey === candidate.mediaKey), candidate);
});

test('known campaign area constraints require geographic evidence and do not treat profiles as coverage', () => {
  const result = engine().getCandidates(request({ campaignOverride: { constraints: ['仅限示例商圈投放'] } }), true);
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.deepEqual(result.candidates.map(item => item.mediaKey).sort(), [bus, metro].sort());
  const unknownArea = engine().getCandidates(request({ campaignOverride: { constraints: ['仅限未核对园区投放'] } }), true);
  assert.equal(unknownArea.status, 'missing_data');
});

test('schedules allocate all quantities with nightly caps, cumulative totals and next-day publishing', () => {
  const result = engine(data(), new ScheduleService({ singleNightCap: 4 })).generate(request());
  ok(result);
  assert.equal(result.schedule.status, 'ok');
  assert.ok(result.schedule.batches.every(batch => batch.quantity <= 4));
  assert.equal(result.schedule.batches.reduce((sum, batch) => sum + batch.quantity, 0), result.lines.reduce((sum, line) => sum + line.quantity, 0));
  let cumulative = 0;
  for (const batch of result.schedule.batches) {
    cumulative += batch.quantity;
    assert.equal(batch.cumulative, cumulative);
    assert.equal(Date.parse(batch.publishStartDate) - Date.parse(batch.nightDate), 86400000);
    assert.ok(batch.nightDate >= dates.startDate && batch.publishStartDate <= dates.endDate);
  }
  assert.equal(result.schedule.batches[0].mediaKeys[0], metro);
  assert.equal(result.schedule.rainBufferNights, 2);
  assert.equal(result.schedule.compensationBufferQty, 2);
});

test('capacity shortages remain successful plans and identify unallocated construction quantities', () => {
  const fixture = data();
  for (const kind of ['bus', 'metro'] as const) fixture[kind].windows[0].endDate = '2027-07-04';
  const result = engine(fixture, new ScheduleService({ singleNightCap: 1 })).generate(request({ endDate: '2027-07-04' }));
  ok(result);
  assert.equal(result.schedule.status, 'capacity_short');
  assert.ok(result.schedule.notes.some(note => note.includes('尚有')));
  assert.ok(result.totalYuan > 0);
});
