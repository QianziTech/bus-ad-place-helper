import { Inject, Injectable, Optional } from '@nestjs/common';
import { MediaKind, PlanData, PlanRequest } from '../shared/contracts';
import { PlanDataService } from '../shared/data/plan-data.service';
import { HongdouInventoryService, InventoryUnavailable } from './hongdou.client';
import { archiveKind, billingMonthsFor, catalogCovered, finalizeResolution, KIND_LABELS, KINDS, missingKind, offlineResolution, snapshotKind, type InventoryResolution, type KindInventory } from './resolution';

export interface InventoryOptions { timeoutMs?: number; online?: boolean }

@Injectable()
export class InventoryService {
  private readonly timeoutMs: number;
  private readonly forceOffline: boolean;
  constructor(private readonly planData: PlanDataService, private readonly hongdou: HongdouInventoryService,
    @Optional() @Inject('INVENTORY_OPTIONS') options: InventoryOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? Number(process.env.HONGDOU_TIMEOUT_MS ?? 4000);
    this.forceOffline = options.online === false || process.env.HONGDOU_ONLINE === 'off';
  }

  /** 实时可用性：未配置账号或显式关闭时只走本地回退，不发起外网请求。 */
  get online(): boolean { return this.hongdou.enabled && !this.forceOffline; }

  /** 解析一次请求的所选媒体库存。本地已有同区间归档的媒体直接复用，不重复查询。 */
  async resolve(request: PlanRequest): Promise<InventoryResolution> {
    const data = this.planData.data;
    const selected = KINDS.filter(kind => request.media.includes(kind));
    if (!this.online) return offlineResolution(data, selected, request);
    const billingMonths = billingMonthsFor(request.startDate, request.endDate);
    const deadline = Date.now() + this.timeoutMs;
    const kinds = await Promise.all(selected.map(kind => this.resolveKind(data, kind, request, billingMonths, deadline)));
    return finalizeResolution(request, kinds);
  }

  private async resolveKind(data: PlanData, kind: MediaKind, request: PlanRequest, billingMonths: number | null, deadline: number): Promise<KindInventory> {
    const archived = archiveKind(kind, data[kind], request.startDate, request.endDate);
    if (archived) return archived;
    try {
      const live = await this.hongdou.query(kind, request.startDate, request.endDate, deadline, Object.keys(data[kind].mediaByKey).length);
      if (!catalogCovered(data[kind], live.inventoryByKey)) throw new InventoryUnavailable(`${KIND_LABELS[kind]}返回的媒体与本地目录不一致`);
      return { kind, source: 'hongdou', queriedAt: live.queriedAt, billingMonths, inventoryByKey: live.inventoryByKey };
    } catch (error) {
      const reason = `实时查询失败：${error instanceof InventoryUnavailable ? error.message : '未知错误'}`;
      const fallback = snapshotKind(kind, data[kind], data.snapshots ?? { dates: [], freeByKey: {} }, request.startDate, request.endDate);
      return fallback.source === 'missing' ? missingKind(kind, `${reason}；${fallback.reason ?? '区间内无有效截面'}`) : { ...fallback, reason };
    }
  }
}