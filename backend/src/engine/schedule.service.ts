import { Inject, Injectable, Optional } from '@nestjs/common';
import { Campaign, PlanLine, PlanRequest, Schedule, ScheduleBatch } from '../shared/contracts';
import { isPlanDate } from '../shared/data/plan-data';

export interface ScheduleOptions { singleNightCap?: number; rainBufferNights?: number; compensationBufferQty?: number }
const dayMs = 24 * 60 * 60 * 1000;
function dateAt(day: number) { return new Date(day * dayMs).toISOString().slice(0, 10); }

@Injectable()
export class ScheduleService {
  private readonly cap: number;
  private readonly rain: number;
  private readonly compensation: number;
  constructor(@Optional() @Inject('SCHEDULE_OPTIONS') options: ScheduleOptions = {}) {
    this.cap = options.singleNightCap ?? Number(process.env.SINGLE_NIGHT_CAP ?? 40);
    this.rain = options.rainBufferNights ?? 2;
    this.compensation = options.compensationBufferQty ?? 2;
    if (!Number.isSafeInteger(this.cap) || this.cap < 1 || !Number.isSafeInteger(this.rain) || this.rain < 0 || !Number.isSafeInteger(this.compensation) || this.compensation < 0) throw new Error('排期产能和缓冲参数必须是有效整数');
  }

  generate(lines: PlanLine[], request: PlanRequest, campaign: Campaign, anchorCounts: Record<string, number> = {}): Schedule {
    const result: Schedule = {
      status: 'ok', singleNightCap: this.cap, batches: [], rainBufferNights: this.rain, compensationBufferQty: this.compensation,
      assumptions: [`单晚上刊上限 ${this.cap} 台，按资料 02 推断；实际产能待施工方确认。`, `预留 ${this.rain} 个雨天备用夜；按 4A 框架“误一补二”预留 ${this.compensation} 台补刊产能。`, '按直客合同，发布期以施工照次日 08:00 起算；本表为日期级施工估算。'],
      notes: [],
    };
    if (!lines.length || !isPlanDate(request.startDate) || !isPlanDate(request.endDate) || request.startDate > request.endDate) {
      result.status = 'unavailable';
      result.notes.push('没有可编排的数量或有效档期。');
      return result;
    }
    const start = Date.parse(`${request.startDate}T00:00:00Z`) / dayMs;
    const end = Date.parse(`${request.endDate}T00:00:00Z`) / dayMs;
    const compensationNights = Math.ceil(this.compensation / this.cap);
    const lastNight = end - 1 - this.rain - compensationNights;
    const availableNights = Math.max(0, lastNight - start + 1);
    const total = lines.reduce((sum, line) => sum + line.quantity, 0);
    const nights = Math.min(Math.ceil(total / this.cap), availableNights);
    const firstNight = Math.max(start, lastNight - nights + 1);
    // 同权重时地铁先上；随后优先覆盖核心锚点。
    const pending = lines.map(line => ({ ...line, remaining: line.quantity })).sort((a, b) =>
      campaign.mediaBias[b.kind] - campaign.mediaBias[a.kind]
      || (a.kind === b.kind ? 0 : a.kind === 'metro' ? -1 : 1)
      || (anchorCounts[b.mediaKey] ?? 0) - (anchorCounts[a.mediaKey] ?? 0)
      || a.mediaKey.localeCompare(b.mediaKey, 'en'));
    let index = 0;
    let cumulative = 0;
    for (let night = 0; night < nights; night++) {
      let remainingCapacity = this.cap;
      const batch: ScheduleBatch = { no: night + 1, nightDate: dateAt(firstNight + night), mediaKeys: [], quantity: 0, cumulative, publishStartDate: dateAt(firstNight + night + 1), risk: null };
      while (remainingCapacity > 0 && index < pending.length) {
        const current = pending[index];
        const quantity = Math.min(remainingCapacity, current.remaining);
        batch.mediaKeys.push(current.mediaKey);
        batch.quantity += quantity;
        remainingCapacity -= quantity;
        current.remaining -= quantity;
        if (current.remaining === 0) index++;
      }
      cumulative += batch.quantity;
      batch.cumulative = cumulative;
      result.batches.push(batch);
    }
    if (cumulative < total) {
      result.status = 'capacity_short';
      result.notes.push(`当前档期可排 ${cumulative} 台，共 ${total} 台，尚有 ${total - cumulative} 台未排；请延长档期或减少数量。`);
      for (const batch of result.batches) batch.risk = '档期产能不足，部分数量无法按期上线';
    }
    if (result.batches.length) {
      const publishDate = result.batches[result.batches.length - 1].publishStartDate;
      result.notes.push(`多批施工时，统一发布期以最后一批 ${publishDate} 08:00 起算；计费月数沿用已核对库存窗口，实际合同起算需确认。`);
    }
    result.notes.push('从档期结束日倒排施工夜，末尾保留雨天与补刊备用夜；备用产能不计入已选数量和报价。');
    return result;
  }
}
