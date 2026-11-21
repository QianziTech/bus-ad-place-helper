import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Campaign, INDUSTRIES, MediaData, PlanData, PlanRequest, SnapshotData } from '../src/shared/contracts';
import { PlanDataService } from '../src/shared/data/plan-data.service';
import { ScheduleService } from '../src/engine/schedule.service';
import { EngineService } from '../src/engine/engine.service';
import { HongdouInventoryService } from '../src/inventory/hongdou.client';
import { InventoryService } from '../src/inventory/inventory.service';
import { billingMonthsFor, finalizeResolution, offlineResolution } from '../src/inventory/resolution';

const dates = { startDate: '2027-07-01', endDate: '2027-07-31' };
const bus = 'bus|1|车身';
const busSnapshotOnly = 'bus|2|车身';
const metro = 'metro|4|1号口';

function mediaData(kind: 'bus' | 'metro'): MediaData {
  return kind === 'bus'
    ? { mediaByKey: { [bus]: { kind, resourceId: 1, lineName: '1 路', levelName: 'A+', mediaForm: '车身' }, [busSnapshotOnly]: { kind, resourceId: 2, lineName: '2 路', levelName: 'A+', mediaForm: '车身' } }, windows: [] }
    : { mediaByKey: { [metro]: { kind, resourceId: 4, lineName: '示例站', levelName: 'A+', exit: '1号口' } }, windows: [] };
}

function snapshots(): SnapshotData {
  // 两个周一：07-05 与 07-12；bus|2 在 07-12 缺样。
  return { dates: ['2027-07-05', '2027-07-12'], freeByKey: { [bus]: [3, 1], [busSnapshotOnly]: [5, null], [metro]: [2, 0] } };
}

function data(overrides: Partial<PlanData> = {}): PlanData {
  const campaign: Campaign = { id: 'F1-C1', name: '测试认知活动', businessGoal: '提升新品认知', primaryGoal: '认知', audience: '通勤人群',
    window: { start: dates.startDate, end: dates.endDate }, budgetHintYuan: 1000000, mediaScope: ['bus'], mediaBias: { bus: 1, metro: 1 },
    successMetric: { kpi: '扫码量', proof: '上下刊照片' }, constraints: [] };
  return {
    bus: mediaData('bus'), metro: mediaData('metro'),
    pricing: { pricesByMediaKey: { [bus]: { monthlyLowYuan: 40000, monthlyHighYuan: 50000, productionYuan: 5000, source: '测试刊例', assumptions: [] },
      [busSnapshotOnly]: { monthlyLowYuan: 40000, monthlyHighYuan: 50000, productionYuan: 5000, source: '测试刊例', assumptions: [] },
      [metro]: { monthlyLowYuan: 190000, monthlyHighYuan: 208000, productionYuan: 1000, source: '测试刊例', assumptions: [] } } },
    briefs: { industries: [{ id: 'food', name: '食品饮料', client: { code: 'F1', alias: '某品牌', category: '饮料', scale: '全国' }, campaign, anchors: [{ id: 'a1', rationale: '通勤场景' }] }] },
    coverage: { anchorsById: { a1: { areaName: '示例商圈', station: '示例站', role: 'businessArea', coord: { lng: 121, lat: 31, exit: '1号口', source: 'test' },
      candidates: [{ mediaKey: bus, relation: '公交覆盖', source: 'test' }, { mediaKey: busSnapshotOnly, relation: '公交覆盖', source: 'test' }, { mediaKey: metro, relation: '站点匹配', source: 'test' }] } } },
    traffic: { byMediaKey: {} },
    trajectories: { crs: 'GCJ02', source: 'test', byLineName: {} },
    snapshots: snapshots(),
    ...overrides,
  };
}

function request(extra: Partial<PlanRequest> = {}): PlanRequest { return { industry: 'food', budgetYuan: 1000000, media: ['bus'], ...dates, ...extra }; }
function service(input: PlanData, online = false) {
  return new InventoryService({ data: input } as PlanDataService, new HongdouInventoryService(), { online, timeoutMs: 500 });
}

test('整月档期按自然月计费，短于一个月、跨月和非整月都需确认', () => {
  assert.equal(billingMonthsFor('2027-07-01', '2027-07-31'), 1);
  assert.equal(billingMonthsFor('2027-07-01', '2027-09-30'), 3);
  assert.equal(billingMonthsFor('2027-02-01', '2027-02-28'), 1);
  // 非整月、跨月不齐、跨年、倒序都返回待确认
  for (const [start, end] of [['2027-07-05', '2027-07-31'], ['2027-06-15', '2027-08-31'], ['2027-12-15', '2028-01-31'], ['2027-07-31', '2027-07-01']]) {
    assert.equal(billingMonthsFor(start, end), null, `${start}~${end}`);
  }
});

test('离线解析优先同区间归档，其次区间内周一截面，无有效截面则待核对', () => {
  const fixture = data();
  assert.equal(offlineResolution(fixture, ['bus', 'metro'], request()).kinds.every(item => item.source === 'snapshot'), true);

  fixture.bus.windows.push({ ...dates, queriedAt: '2026-11-21T08:00:00+08:00', billingMonths: 1, inventoryByKey: { [bus]: { freeCount: 2 }, [busSnapshotOnly]: { freeCount: 0 } } });
  const resolution = offlineResolution(fixture, ['bus', 'metro'], request());
  assert.deepEqual(resolution.kinds.map(item => item.source), ['archive', 'snapshot']);
  // 组合模式：一类有归档、另一类只有截面，仍视为不完整，但计费口径按归档确认。
  assert.equal(resolution.complete, false);

  const archived = offlineResolution(fixture, ['bus'], request());
  assert.equal(archived.complete, true);
  assert.equal(archived.billingMonths, 1);
  assert.equal(archived.billingStatus, 'confirmed');

  const outside = offlineResolution(fixture, ['bus'], { ...request(), startDate: '2027-01-01', endDate: '2027-01-31' });
  assert.equal(outside.kinds[0].source, 'missing');
});

test('周截面按可用采样日取最小空位，缺样保持 null 并标注采样日', () => {
  const resolution = offlineResolution(data(), ['bus', 'metro'], request());
  const busKind = resolution.kinds.find(item => item.kind === 'bus')!;
  const metroKind = resolution.kinds.find(item => item.kind === 'metro')!;
  assert.equal(busKind.inventoryByKey[bus].freeCount, 1);
  assert.deepEqual(busKind.sampleByKey?.[bus], ['2027-07-05', '2027-07-12']);
  assert.equal(busKind.inventoryByKey[busSnapshotOnly].freeCount, 5);
  assert.deepEqual(busKind.sampleByKey?.[busSnapshotOnly], ['2027-07-05']);
  // 明确 0 是零库存，不能当成缺样
  assert.equal(metroKind.inventoryByKey[metro].freeCount, 0);
  assert.equal(resolution.billingMonths, null);
  assert.equal(resolution.billingStatus, 'pending');
});

test('缺失整段库存时保留原请求并返回逐类来源与周截面参考', () => {
  const fixture = data();
  const engine = new EngineService({ data: fixture } as PlanDataService, new ScheduleService());
  const result = engine.getCandidates(request({ media: ['bus', 'metro'] }), false, offlineResolution(fixture, ['bus', 'metro'], request()));
  assert.equal(result.status, 'missing_window');
  if (result.status !== 'missing_window') return;
  assert.match(result.message, /周截面/);
  assert.equal(result.inventory?.startDate, dates.startDate);
  assert.equal(result.inventory?.endDate, dates.endDate);
  assert.equal(result.inventory?.billingStatus, 'pending');
  assert.deepEqual(result.inventory?.kinds.map(item => item.source), ['snapshot', 'snapshot']);
  const preview = result.inventory?.preview || [];
  assert.equal(preview.length, 3);
  assert.equal(preview.find(row => row.mediaKey === bus)?.freeCount, 1);
  assert.deepEqual(preview.find(row => row.mediaKey === bus)?.sampleDates, ['2027-07-05', '2027-07-12']);
  assert.equal(preview.find(row => row.mediaKey === busSnapshotOnly)?.freeCount, 5);
});

test('实时接口取到完整库存后按原起止日成案；令牌只取一次并在内存复用', async () => {
  const calls: { path: string; auth?: string; body?: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      calls.push({ path: req.url || '', auth: String(req.headers.authorization || ''), body });
      res.setHeader('content-type', 'application/json');
      if (req.url?.startsWith('/admin-api/system/oauth2/token')) {
        res.end(JSON.stringify({ code: 0, data: { access_token: 'test-token', expires_in: 3600 } }));
        return;
      }
      if (req.url?.includes('/bus/page')) {
        res.end(JSON.stringify({ code: 0, data: { list: [
          { resourceId: 1, mediaName: '车身', freeCount: 2, contractCount: 1, reservationCount: 3 },
          { resourceId: 2, mediaName: '车身', freeCount: 0 },
        ] } }));
        return;
      }
      res.end(JSON.stringify({ code: 0, data: { list: [] } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const previous = { base: process.env.HONGDOU_BASE_URL, user: process.env.HONGDOU_USERNAME, password: process.env.HONGDOU_PASSWORD,
    clientId: process.env.HONGDOU_CLIENT_ID, secret: process.env.HONGDOU_CLIENT_SECRET, token: process.env.HONGDOU_TOKEN, expected: process.env.HONGDOU_EXPECTED };
  process.env.HONGDOU_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.HONGDOU_USERNAME = 'user'; process.env.HONGDOU_PASSWORD = 'pass'; process.env.HONGDOU_CLIENT_ID = 'client'; process.env.HONGDOU_CLIENT_SECRET = 'secret';
  delete process.env.HONGDOU_TOKEN;
  try {
    const fixture = data();
    // 测试替身按目录返回，目录行数与接口行数一致才接受。
    fixture.bus.windows = [];
    const client = new HongdouInventoryService();
    assert.equal(client.enabled, true);
    const deadline = Date.now() + 2000;
    const first = await client.query('bus', dates.startDate, dates.endDate, deadline, 2);
    assert.equal(first.inventoryByKey[bus].freeCount, 2);
    assert.equal(first.inventoryByKey[bus].reservedCount, 3);
    assert.equal(first.inventoryByKey[busSnapshotOnly].freeCount, 0);
    await client.query('bus', '2027-08-01', '2027-08-31', deadline, 2);
    const tokenCalls = calls.filter(call => call.path.startsWith('/admin-api/system/oauth2/token'));
    assert.equal(tokenCalls.length, 1);
    const page = calls.find(call => call.path.includes('/bus/page'))!;
    assert.match(page.path, /startDate=2027-07-01/);
    assert.match(page.path, /endDate=2027-07-31/);
    assert.equal(page.auth, 'Bearer test-token');
  } finally {
    if (previous.base === undefined) delete process.env.HONGDOU_BASE_URL; else process.env.HONGDOU_BASE_URL = previous.base;
    if (previous.user === undefined) delete process.env.HONGDOU_USERNAME; else process.env.HONGDOU_USERNAME = previous.user;
    if (previous.password === undefined) delete process.env.HONGDOU_PASSWORD; else process.env.HONGDOU_PASSWORD = previous.password;
    if (previous.clientId === undefined) delete process.env.HONGDOU_CLIENT_ID; else process.env.HONGDOU_CLIENT_ID = previous.clientId;
    if (previous.secret === undefined) delete process.env.HONGDOU_CLIENT_SECRET; else process.env.HONGDOU_CLIENT_SECRET = previous.secret;
    if (previous.token === undefined) delete process.env.HONGDOU_TOKEN; else process.env.HONGDOU_TOKEN = previous.token;
    if (previous.expected === undefined) delete process.env.HONGDOU_EXPECTED; else process.env.HONGDOU_EXPECTED = previous.expected;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('实时失败或缺一类媒体时组合模式逐类回退到同区间归档', async () => {
  const fixture = data();
  fixture.bus.windows.push({ ...dates, queriedAt: '2026-11-21T08:00:00+08:00', billingMonths: 1, inventoryByKey: { [bus]: { freeCount: 2 }, [busSnapshotOnly]: { freeCount: 1 } } });
  // 未配置账号时走离线解析：公交用归档、地铁只有周截面。
  const resolution = await service(fixture).resolve(request({ media: ['bus', 'metro'] }));
  assert.deepEqual(resolution.kinds.map(item => [item.kind, item.source]), [['bus', 'archive'], ['metro', 'snapshot']]);
  const engine = new EngineService({ data: fixture } as PlanDataService, new ScheduleService());
  const covered = engine.getCandidates(request(), false, await service(fixture).resolve(request()));
  assert.equal(covered.status, 'ok');
  if (covered.status !== 'ok') return;
  assert.equal(covered.inventory.kinds[0].source, 'archive');
  assert.equal(covered.queriedAt, '2026-11-21T08:00:00+08:00');
  assert.equal(covered.inventory.billingStatus, 'confirmed');
});

test('非整月实时库存可展示，但计费口径未确认时只给参考金额', () => {
  const fixture = data();
  // 实时查询整段库存，但 2027-07-05~07-20 不是自然整月，派生计费月数为 null。
  const window = { startDate: '2027-07-05', endDate: '2027-07-20' };
  const resolution = finalizeResolution({ ...request(), ...window }, [
    { kind: 'bus', source: 'hongdou', queriedAt: '2026-11-21T08:00:00+08:00', billingMonths: null, inventoryByKey: { [bus]: { freeCount: 2 }, [busSnapshotOnly]: { freeCount: 2 } } },
  ]);
  assert.equal(resolution.billingStatus, 'pending');
  const engine = new EngineService({ data: fixture } as PlanDataService, new ScheduleService());
  const result = engine.generate({ ...request(), ...window }, engine.getCandidates({ ...request(), ...window }, false, resolution) as any);
  assert.notEqual(result.status, 'missing_window');
  if (result.status !== 'ok') return;
  assert.equal(result.billingStatus, 'pending');
  // 口径未确认时按 1 个计费月给参考估算，不直接当作已确认月数。
  assert.equal(result.billingMonths, 1);
  assert.ok(result.notices.some(note => note.includes('计费')));
  const archived = data();
  archived.bus.windows.push({ ...window, queriedAt: '2026-11-21T08:00:00+08:00', billingMonths: 1, inventoryByKey: { [bus]: { freeCount: 2 }, [busSnapshotOnly]: { freeCount: 1 } } });
  const archivedResolution = offlineResolution(archived, ['bus'], { ...request(), ...window });
  // 归档在拉取时已记录计费月数，按该口径视为已确认。
  assert.equal(archivedResolution.billingStatus, 'confirmed');
});
