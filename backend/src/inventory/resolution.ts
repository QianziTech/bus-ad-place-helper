import { Inventory, InventoryKindStatus, InventoryPreviewRow, InventorySource, MediaData, MediaKind, PlanData, PlanRequest, SnapshotData } from '../shared/contracts';

export const KIND_LABELS: Record<MediaKind, string> = { bus: '公交', metro: '地铁' };
export const SOURCE_LABELS: Record<InventorySource, string> = { hongdou: '红豆实时查询', archive: '离线完整档期', snapshot: '周截面参考', missing: '档期库存待核对' };
export const KINDS: MediaKind[] = ['bus', 'metro'];
const emptySnapshots: SnapshotData = { dates: [], freeByKey: {} };

/** 整月档期（每月 1 日至月末）按自然月数计费；短于一个月、跨月或非整月需人工确认口径。 */
export function billingMonthsFor(start: string, end: string): number | null {
  if (!/^2027-\d{2}-\d{2}$/.test(start) || !/^2027-\d{2}-\d{2}$/.test(end) || start > end) return null;
  const [startYear, startMonth, startDay] = start.split('-').map(Number);
  const [endYear, endMonth, endDay] = end.split('-').map(Number);
  if (startDay !== 1) return null;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  if (endDay !== lastDay || endYear < startYear || (endYear === startYear && endMonth < startMonth)) return null;
  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
}

export interface KindInventory {
  kind: MediaKind;
  source: InventorySource;
  queriedAt?: string;
  billingMonths: number | null;
  /** 完整档期库存；周截面参考时为各采样日最小空位数，缺样键为 null。 */
  inventoryByKey: Record<string, Inventory>;
  /** 周截面参考实际参与取数的日期与各键的可用采样日。 */
  sampleDates?: string[];
  sampleByKey?: Record<string, string[]>;
  reason?: string;
}

export interface InventoryResolution {
  startDate: string;
  endDate: string;
  billingMonths: number | null;
  billingStatus: 'confirmed' | 'pending';
  billingMismatch: boolean;
  complete: boolean;
  kinds: KindInventory[];
}

export function catalogCovered(data: MediaData, inventoryByKey: Record<string, Inventory>): boolean {
  return Object.keys(data.mediaByKey).every(key => {
    const value = inventoryByKey[key]?.freeCount;
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  });
}

/** 起止日完全匹配的已归档完整档期。 */
export function archiveKind(kind: MediaKind, data: MediaData, startDate: string, endDate: string): KindInventory | undefined {
  const window = data.windows.find(item => item.startDate === startDate && item.endDate === endDate);
  if (!window) return undefined;
  return { kind, source: 'archive', queriedAt: window.queriedAt, billingMonths: window.billingMonths, inventoryByKey: structuredClone(window.inventoryByKey) };
}

/** 区间内周一单日截面的最小值；每个媒体标出实际可用的采样日。 */
export function snapshotKind(kind: MediaKind, data: MediaData, snapshots: SnapshotData, startDate: string, endDate: string): KindInventory {
  const dates = snapshots.dates.filter(date => date >= startDate && date <= endDate);
  const empty = (reason: string): KindInventory => ({ kind, source: 'missing', billingMonths: null, inventoryByKey: {}, reason });
  if (!dates.length) return empty('区间内没有可用的周一单日截面');
  const indexes = dates.map(date => snapshots.dates.indexOf(date));
  const inventoryByKey: Record<string, Inventory> = {};
  const sampleByKey: Record<string, string[]> = {};
  let sampled = 0;
  for (const key of Object.keys(data.mediaByKey)) {
    const values: number[] = [];
    const samples: string[] = [];
    for (const [position, index] of indexes.entries()) {
      const value = snapshots.freeByKey[key]?.[index];
      if (!Number.isSafeInteger(value) || (value as number) < 0) continue;
      values.push(value as number);
      samples.push(dates[position]);
    }
    sampleByKey[key] = samples;
    inventoryByKey[key] = { freeCount: values.length ? Math.min(...values) : null };
    if (values.length) sampled++;
  }
  if (!sampled) return empty('区间内的周一截面没有匹配到可用媒体');
  return { kind, source: 'snapshot', billingMonths: null, inventoryByKey, sampleDates: dates, sampleByKey };
}

export function missingKind(kind: MediaKind, reason: string): KindInventory {
  return { kind, source: 'missing', billingMonths: null, inventoryByKey: {}, reason };
}

/** 离线解析：优先同区间完整归档，其次区间内周一截面，最后待核对。 */
export function offlineResolution(data: PlanData, selected: MediaKind[], request: PlanRequest): InventoryResolution {
  const snapshots = data.snapshots ?? emptySnapshots;
  const kinds = selected.map(kind => archiveKind(kind, data[kind], request.startDate, request.endDate)
    ?? snapshotKind(kind, data[kind], snapshots, request.startDate, request.endDate));
  return finalizeResolution(request, kinds);
}

export function finalizeResolution(request: PlanRequest, kinds: KindInventory[]): InventoryResolution {
  const complete = kinds.every(kind => (kind.source === 'hongdou' || kind.source === 'archive'));
  const months = complete ? kinds.map(kind => kind.billingMonths) : [];
  const billingMismatch = months.some(month => month !== months[0]);
  const billingMonths = complete && !billingMismatch ? months[0] ?? null : null;
  const billingStatus: InventoryResolution['billingStatus'] = billingMonths !== null && billingMonths > 0 && Number.isSafeInteger(billingMonths) ? 'confirmed' : 'pending';
  return { startDate: request.startDate, endDate: request.endDate, billingMonths, billingStatus, billingMismatch, complete, kinds };
}

export function kindStatus(kind: KindInventory): InventoryKindStatus {
  return { kind: kind.kind, source: kind.source, sourceLabel: SOURCE_LABELS[kind.source], ...(kind.queriedAt ? { queriedAt: kind.queriedAt } : {}),
    ...(kind.sampleDates?.length ? { sampleDates: kind.sampleDates } : {}), billingMonths: kind.billingMonths, ...(kind.reason ? { reason: kind.reason } : {}) };
}

/** 周截面参考行：只保留有证据候选的媒体，并标注每个媒体实际可用的采样日。 */
export function previewRows(data: PlanData, resolution: InventoryResolution, keys: string[]): InventoryPreviewRow[] {
  const rows: InventoryPreviewRow[] = [];
  for (const kind of resolution.kinds) {
    if (kind.source !== 'snapshot') continue;
    for (const key of keys) {
      const media = data[kind.kind].mediaByKey[key];
      if (!media) continue;
      rows.push({ mediaKey: key, kind: kind.kind, name: media.lineName, levelName: media.levelName,
        ...(media.mediaForm === undefined ? {} : { mediaForm: media.mediaForm }),
        ...(media.exit === undefined ? {} : { exit: media.exit }),
        freeCount: kind.inventoryByKey[key]?.freeCount ?? null,
        ...(kind.sampleByKey?.[key]?.length ? { sampleDates: kind.sampleByKey[key] } : {}) });
    }
  }
  return rows;
}
