import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { Campaign, Candidate, CandidatePool, Client, Industry, InventoryWindow, MediaKind, PlanAnchor, PlanFailure, PlanLine, PlanRequest, PlanResult, RejectionReason, StrategyPreference, TraceStep } from '../shared/contracts';
import { PlanDataService } from '../shared/data/plan-data.service';
import { ScheduleService } from './schedule.service';

const kinds: MediaKind[] = ['bus', 'metro'];
const labels = { bus: '公交', metro: '地铁' };
export interface EngineOptions { premiumRatio?: number }
const unique = <T>(values: T[]) => [...new Set(values)];
const keyOrder = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const baseOrder = (a: Candidate, b: Candidate) => b.anchorIds.length - a.anchorIds.length || a.unitEstimateYuan - b.unitEstimateYuan || keyOrder(a.mediaKey, b.mediaKey);
interface Evidence { anchorIds: string[]; evidenceRefs: string[]; reasons: string[]; sources: string[] }

function publicClient(client: Client): Client {
  return { code: client.code, alias: client.alias, category: client.category, scale: client.scale, ...(client.channelNote === undefined ? {} : { channelNote: client.channelNote }) };
}
function failure(status: PlanFailure['status'], message: string, suggestions: string[] = []): PlanFailure { return { status, message, suggestions }; }

@Injectable()
export class EngineService {
  private readonly premiumLimit: number;
  constructor(private readonly planData: PlanDataService, private readonly schedule: ScheduleService,
    @Optional() @Inject('ENGINE_OPTIONS') options: EngineOptions = {}) {
    this.premiumLimit = options.premiumRatio ?? Number(process.env.STRATEGY_PREMIUM_RATIO ?? 0.1);
    if (!Number.isFinite(this.premiumLimit) || this.premiumLimit < 0) throw new Error('策略溢价上限必须为非负数值');
  }

  getMeta() {
    const data = this.planData.data;
    const windows = new Map<string, { startDate: string; endDate: string }>();
    for (const kind of kinds) for (const window of data[kind].windows) windows.set(`${window.startDate}/${window.endDate}`, { startDate: window.startDate, endDate: window.endDate });
    return {
      industries: data.briefs.industries.map(item => ({ id: item.id, name: item.name, client: publicClient(item.client), campaign: structuredClone(item.campaign), anchors: this.summarizeAnchors(item.anchors) })),
      media: kinds, budget: { minYuan: 1000000, maxYuan: 5000000, presetsYuan: [1000000, 2000000, 5000000] },
      windows: [...windows.values()].sort((a, b) => keyOrder(a.startDate, b.startDate) || keyOrder(a.endDate, b.endDate)),
    };
  }

  // Anchor metadata is read-only: counts describe the coverage module, not current stock.
  private summarizeAnchors(refs: { id: string; rationale: string }[]) {
    const data = this.planData.data;
    return refs.map(ref => {
      const anchor = data.coverage.anchorsById[ref.id];
      const counts = { bus: 0, metro: 0 };
      for (const candidate of anchor.candidates) counts[data.bus.mediaByKey[candidate.mediaKey] ? 'bus' : 'metro']++;
      return { id: ref.id, areaName: anchor.areaName, station: anchor.station, role: anchor.role, rationale: ref.rationale, candidateCounts: counts };
    });
  }

  private campaign(industry: Industry, request: PlanRequest): Campaign {
    const campaign = structuredClone(industry.campaign);
    const override = request.campaignOverride;
    if (override) {
      for (const field of ['name', 'businessGoal', 'primaryGoal', 'audience', 'window', 'budgetHintYuan', 'mediaScope', 'mediaBias', 'successMetric', 'constraints'] as const) {
        if (override[field] !== undefined) Object.assign(campaign, { [field]: structuredClone(override[field]) });
      }
    }
    return campaign;
  }

  getCandidates(request: PlanRequest, expanded = false): CandidatePool | PlanFailure {
    const data = this.planData.data;
    const industry = data.briefs.industries.find(item => item.id === request.industry);
    if (!industry) return failure('missing_data', '所选行业没有已配置的客户需求。', ['选择已有行业或补充需求资料。']);
    const selectedKinds = kinds.filter(kind => request.media.includes(kind));
    if (!selectedKinds.length) throw new BadRequestException('至少选择一种投放媒体');
    const campaign = this.campaign(industry, request);
    const windows = new Map<MediaKind, InventoryWindow>();
    for (const kind of selectedKinds) {
      const window = data[kind].windows.find(item => item.startDate === request.startDate && item.endDate === request.endDate);
      if (window) windows.set(kind, window);
    }
    const missingWindows = selectedKinds.filter(kind => !windows.has(kind));
    if (missingWindows.length) return failure('missing_window', `${missingWindows.map(kind => labels[kind]).join('、')}缺少 ${request.startDate} 至 ${request.endDate} 的完整库存档期。`, ['选择已核对的完整档期。', '单选已有完整档期的媒体，或补充该档期库存。']);
    const billingMonths = windows.get(selectedKinds[0])!.billingMonths;
    const inconsistentBilling = [...windows.values()].some(window => window.billingMonths !== billingMonths);
    const queriedAt = [...windows.values()].sort((a, b) => Date.parse(a.queriedAt) - Date.parse(b.queriedAt))[0].queriedAt;
    const notices: string[] = [];
    const evidence = new Map<string, Evidence>();
    const add = (key: string, partial: Evidence) => {
      const previous = evidence.get(key) ?? { anchorIds: [], evidenceRefs: [], reasons: [], sources: [] };
      evidence.set(key, { anchorIds: unique([...previous.anchorIds, ...partial.anchorIds]), evidenceRefs: unique([...previous.evidenceRefs, ...partial.evidenceRefs]), reasons: unique([...previous.reasons, ...partial.reasons]), sources: unique([...previous.sources, ...partial.sources]) });
    };
    const areaLimits = campaign.constraints.filter(constraint => /仅限(?:投放)?|只在|仅在|限定投放区域/.test(constraint));
    const allowedAnchors = areaLimits.length ? industry.anchors.filter(ref => {
      const anchor = data.coverage.anchorsById[ref.id];
      return areaLimits.some(limit => [ref.id, anchor.areaName, anchor.station].some(name => limit.includes(name)));
    }) : industry.anchors;
    const unresolvedArea = areaLimits.length > 0 && allowedAnchors.length === 0;
    if (unresolvedArea) return failure('missing_data', '活动明确限定的投放区域无法对应已核对锚点，区域覆盖待核对。', ['补充该区域的独立覆盖依据，或调整区域约束后重算。']);
    const activeAnchors = allowedAnchors;
    for (const ref of activeAnchors) {
      const anchor = data.coverage.anchorsById[ref.id];
      for (const candidate of anchor.candidates) {
        add(candidate.mediaKey, {
          anchorIds: [ref.id], evidenceRefs: [`coverage:${ref.id}:${candidate.mediaKey}`],
          reasons: [`${anchor.areaName}：${candidate.relation}${candidate.distanceM === undefined ? '' : `（已核对距离 ${candidate.distanceM} 米）`}`, ref.rationale], sources: [candidate.source, anchor.coord.source],
        });
      }
    }
    for (const [key, reference] of Object.entries(data.traffic.byMediaKey)) {
      if (reference.coveragePv === undefined && !reference.ageGroups?.length) continue;
      // 明确的区域限定必须由覆盖关系支撑，画像本身不证明地理覆盖。
      if (areaLimits.length && !evidence.has(key)) continue;
      add(key, { anchorIds: [], evidenceRefs: [`traffic:${key}:${reference.period}`], reasons: [`${reference.period} 公交历史画像可支持人群匹配，不代表当前客流或目的地覆盖。`], sources: [reference.source] });
    }
    const allCandidates: Candidate[] = [];
    const excluded: CandidatePool['excluded'] = [];
    const blockers: { kind: MediaKind; status: 'missing_data' | 'no_inventory'; message: string }[] = [];
    let missingCouldChangeBudget = inconsistentBilling;
    if (inconsistentBilling) blockers.push({ kind: selectedKinds[0], status: 'missing_data', message: '公交与地铁完整档期的计费月数不一致' });
    for (const kind of selectedKinds) {
      const window = windows.get(kind)!;
      const entries = [...evidence.entries()].filter(([key]) => data[kind].mediaByKey[key]);
      let knownZero = 0;
      let missing = 0;
      let priced = 0;
      for (const [key, item] of entries) {
        const inventory = window.inventoryByKey[key];
        const price = data.pricing.pricesByMediaKey[key];
        if (inventory?.freeCount === 0) {
          knownZero++;
          excluded.push({ mediaKey: key, reason: 'no_stock' });
          continue;
        }
        if (inventory?.freeCount == null || !price) {
          missing++;
          missingCouldChangeBudget = true;
          excluded.push({ mediaKey: key, reason: 'invalid_evidence' });
          continue;
        }
        const unitEstimateYuan = Math.round((price.monthlyLowYuan + price.monthlyHighYuan) / 2 * billingMonths) + price.productionYuan;
        if (!Number.isSafeInteger(unitEstimateYuan) || unitEstimateYuan <= 0) {
          missing++;
          missingCouldChangeBudget = true;
          excluded.push({ mediaKey: key, reason: 'invalid_evidence' });
          continue;
        }
        const media = data[kind].mediaByKey[key];
        allCandidates.push({
          mediaKey: key, kind, name: media.lineName, levelName: media.levelName,
          ...(media.total === undefined ? {} : { total: media.total }), ...(media.mediaForm === undefined ? {} : { mediaForm: media.mediaForm }), ...(media.exit === undefined ? {} : { exit: media.exit }),
          freeCount: inventory.freeCount, ...(inventory.contractCount === undefined ? {} : { contractCount: inventory.contractCount }), ...(inventory.reservedCount === undefined ? {} : { reservedCount: inventory.reservedCount }),
          monthlyLowYuan: price.monthlyLowYuan, monthlyHighYuan: price.monthlyHighYuan, productionYuan: price.productionYuan, unitEstimateYuan,
          anchorIds: item.anchorIds, evidenceRefs: item.evidenceRefs, reasons: item.reasons,
          sources: unique([...item.sources, `${kind}.json：${request.startDate} 至 ${request.endDate} 完整档期，查询于 ${window.queriedAt}`, `pricing.json：${price.source}`]),
          assumptions: price.assumptions,
          ...(data.traffic.byMediaKey[key] ? { trafficReference: structuredClone(data.traffic.byMediaKey[key]) } : {}),
        });
        priced++;
      }
      if (!entries.length) blockers.push({ kind, status: 'missing_data', message: `${labels[kind]}缺少可关联的覆盖或画像候选` });
      else if (knownZero === entries.length) blockers.push({ kind, status: 'no_inventory', message: `${labels[kind]}所有有证据候选均已核对为零库存` });
      else if (!priced) blockers.push({ kind, status: 'missing_data', message: `${labels[kind]}缺少已核对库存或有效刊例，无法形成可报价候选` });
      if (missing && priced) notices.push(`${labels[kind]}有 ${missing} 个候选的库存或刊例待核对，当前报价仅采用已核对候选。`);
    }
    if (blockers.length) return failure(blockers.some(item => item.status === 'no_inventory') ? 'no_inventory' : 'missing_data', blockers.map(item => item.message).join('；') + '。', ['单选具备库存与刊例的媒体。', '调整档期，或补充缺失库存和刊例。']);
    const minimum = selectedKinds.reduce((sum, kind) => sum + Math.min(...allCandidates.filter(candidate => candidate.kind === kind).map(candidate => candidate.unitEstimateYuan)), 0);
    if (minimum > request.budgetYuan) return failure(missingCouldChangeBudget ? 'missing_data' : 'over_budget', missingCouldChangeBudget ? '已核对组合超过预算，但仍有库存或刊例待核对，暂不能断言最低组合超预算。' : `已核对的最低媒体组合估算为 ${minimum} 元，超过预算上限 ${request.budgetYuan} 元。`, ['提高预算上限，或改为单一媒体。', ...(missingCouldChangeBudget ? ['先补齐候选库存和刊例。'] : [])]);
    let candidates = allCandidates;
    if (!expanded) {
      const profiles = allCandidates.filter(candidate => candidate.anchorIds.length === 0).sort((a, b) => this.profileScore(b, campaign) - this.profileScore(a, campaign) || baseOrder(a, b));
      const initialProfiles = new Set(profiles.slice(0, 8).map(candidate => candidate.mediaKey));
      candidates = allCandidates.filter(candidate => candidate.anchorIds.length > 0 || initialProfiles.has(candidate.mediaKey));
      // 最低组合不能因首轮画像数量限制被隐藏。
      for (const kind of selectedKinds) {
        const cheapest = allCandidates.filter(candidate => candidate.kind === kind).sort((a, b) => a.unitEstimateYuan - b.unitEstimateYuan || baseOrder(a, b))[0];
        if (!candidates.some(candidate => candidate.mediaKey === cheapest.mediaKey)) candidates.push(cheapest);
      }
      if (profiles.length > initialProfiles.size) notices.push('首轮保留全部行业 POI 候选和匹配度靠前的 8 个圈外画像候选；扩选轮纳入其余有证据候选。');
    }
    if (candidates.some(candidate => candidate.trafficReference)) notices.push('公交历史画像按原月份展示，仅作人群参考；不同线路历史覆盖人次不相加为方案触达。');
    return { status: 'ok', request: structuredClone(request), client: publicClient(industry.client), campaign, candidates: candidates.sort(baseOrder), anchors: this.summarizeAnchors(activeAnchors), billingMonths, queriedAt, notices, excluded };
  }

  private profileScore(candidate: Candidate, campaign: Campaign) {
    const ageRange = campaign.audience.match(/(\d{1,2})\s*[-–—至~]\s*(\d{1,2})/);
    if (ageRange && candidate.trafficReference?.ageGroups?.length) {
      return candidate.trafficReference.ageGroups.reduce((sum, group) => {
        const bounds = group.label.match(/(\d{1,2})\s*[-–—至~]\s*(\d{1,2})/);
        return sum + (bounds && Number(bounds[2]) >= Number(ageRange[1]) && Number(bounds[1]) <= Number(ageRange[2]) ? group.percent : 0);
      }, 0);
    }
    return candidate.trafficReference?.coveragePv ?? 0;
  }

  generate(request: PlanRequest, pool?: CandidatePool): PlanResult {
    const resolved = pool ?? this.getCandidates(request);
    if (resolved.status !== 'ok') return resolved;
    const candidates = [...resolved.candidates].sort(baseOrder);
    const selectedKinds = kinds.filter(kind => request.media.includes(kind));
    const quantities = new Map<string, number>();
    const byKey = new Map(candidates.map(candidate => [candidate.mediaKey, candidate]));
    const preferences: StrategyPreference[] = (request.strategyPreferences ?? []).map(preference => ({ mediaKey: preference.mediaKey, reason: preference.reason, evidenceRefs: [...preference.evidenceRefs] }));
    const valid: { preference: StrategyPreference; candidate: Candidate; index: number }[] = [];
    const seen = new Set<string>();
    const pendingRejections = new Map<string, RejectionReason>();
    const trace: TraceStep[] = [{ step: 'candidates', message: `已核对 ${candidates.length} 个候选；同一媒体键合并覆盖与画像证据，并共用档期库存。` }];
    const campaignRefs = new Set(Object.keys(resolved.campaign).map(field => `campaign:${resolved.campaign.id}:${field}`));
    for (const [index, preference] of preferences.entries()) {
      const candidate = byKey.get(preference.mediaKey);
      let rejected: RejectionReason | undefined;
      if (seen.has(preference.mediaKey)) rejected = 'invalid_evidence';
      else if (!candidate) rejected = resolved.excluded.find(item => item.mediaKey === preference.mediaKey)?.reason ?? 'unknown_media';
      else if (!preference.evidenceRefs.length || !preference.evidenceRefs.some(ref => candidate.evidenceRefs.includes(ref)) || preference.evidenceRefs.some(ref => !candidate.evidenceRefs.includes(ref) && !campaignRefs.has(ref))) rejected = 'invalid_evidence';
      seen.add(preference.mediaKey);
      if (rejected) preference.disposition = `rejected:${rejected}`;
      else valid.push({ preference, candidate: candidate!, index });
    }
    let remaining = request.budgetYuan;
    for (const kind of selectedKinds) {
      const cheapest = candidates.filter(candidate => candidate.kind === kind).sort((a, b) => a.unitEstimateYuan - b.unitEstimateYuan || baseOrder(a, b))[0];
      if (!cheapest) return failure('missing_data', `${labels[kind]}没有可报价候选。`, ['补齐所选媒体数据。']);
      quantities.set(cheapest.mediaKey, 1);
      remaining -= cheapest.unitEstimateYuan;
    }
    if (remaining < 0) return failure('over_budget', '最低媒体组合超过当前预算上限。', ['提高预算上限或选择单一媒体。']);
    trace.push({ step: 'minimum', message: `先保留每种所选媒体一单位，最低组合 ${request.budgetYuan - remaining} 元。` });
    const available = (candidate: Candidate) => (quantities.get(candidate.mediaKey) ?? 0) < candidate.freeCount;
    const preferredKeys = new Set<string>();
    while (true) {
      const base = candidates.find(candidate => available(candidate) && candidate.unitEstimateYuan <= remaining);
      if (!base) break;
      let choice = base;
      let accepted: typeof valid[number] | undefined;
      const baselineRank = valid.find(item => item.candidate.mediaKey === base.mediaKey)?.index ?? Infinity;
      for (const item of valid) {
        if (item.candidate.kind !== base.kind || !available(item.candidate) || item.index > baselineRank) continue;
        if (item.candidate.unitEstimateYuan > remaining) {
          if (!pendingRejections.has(item.candidate.mediaKey)) pendingRejections.set(item.candidate.mediaKey, 'over_budget');
          continue;
        }
        if (item.candidate.unitEstimateYuan - base.unitEstimateYuan > base.unitEstimateYuan * this.premiumLimit) {
          pendingRejections.set(item.candidate.mediaKey, 'premium_exceeded');
          continue;
        }
        choice = item.candidate;
        accepted = item;
        break;
      }
      const count = Math.min(choice.freeCount - (quantities.get(choice.mediaKey) ?? 0), Math.floor(remaining / choice.unitEstimateYuan));
      quantities.set(choice.mediaKey, (quantities.get(choice.mediaKey) ?? 0) + count);
      remaining -= count * choice.unitEstimateYuan;
      if (accepted) {
        accepted.preference.disposition = 'accepted';
        preferredKeys.add(choice.mediaKey);
        trace.push({ step: 'preference', message: `${choice.mediaKey} 相对同类基准 ${base.mediaKey} 的单位价差 ${choice.unitEstimateYuan - base.unitEstimateYuan} 元，未超过 ${this.premiumLimit * 100}% 溢价上限，本次分配 ${count} 单位。`, evidenceRefs: accepted.preference.evidenceRefs });
      }
    }
    for (const item of valid) {
      if (item.preference.disposition === 'accepted') continue;
      if ((quantities.get(item.candidate.mediaKey) ?? 0) > 0) {
        item.preference.disposition = 'accepted';
        preferredKeys.add(item.candidate.mediaKey);
      } else item.preference.disposition = `rejected:${pendingRejections.get(item.candidate.mediaKey) ?? (item.candidate.unitEstimateYuan > remaining ? 'over_budget' : 'premium_exceeded')}`;
    }
    for (const preference of preferences) if (preference.disposition?.startsWith('rejected:')) trace.push({ step: 'preference_rejected', message: `${preference.mediaKey}：${preference.disposition.slice(9)}`, evidenceRefs: preference.evidenceRefs });
    const lines: PlanLine[] = candidates.filter(candidate => quantities.has(candidate.mediaKey)).map(candidate => {
      const { anchorIds: _anchorIds, assumptions: _assumptions, ...line } = candidate;
      const quantity = quantities.get(candidate.mediaKey)!;
      const preference = valid.find(item => item.candidate.mediaKey === candidate.mediaKey && item.preference.disposition === 'accepted')?.preference;
      return { ...line, quantity, productionYuan: candidate.productionYuan * quantity, lineTotalYuan: candidate.unitEstimateYuan * quantity, reasons: preference ? unique([...candidate.reasons, `策略偏好：${preference.reason}`]) : candidate.reasons, ...(preferredKeys.has(candidate.mediaKey) ? { preferredByAi: true } : {}) };
    });
    const totalYuan = lines.reduce((sum, line) => sum + line.lineTotalYuan, 0);
    const schedule = this.schedule.generate(lines, request, resolved.campaign, Object.fromEntries(candidates.map(candidate => [candidate.mediaKey, candidate.anchorIds.length])));
    const selectedKeys = new Set(lines.map(line => line.mediaKey));
    // 同一 mediaKey 被多锚点命中时，每个锚点各自计一次，不做跨锚点求和。
    const anchors: PlanAnchor[] = resolved.anchors.map(anchor => ({
      ...anchor,
      selectedCount: candidates.filter(candidate => selectedKeys.has(candidate.mediaKey) && candidate.anchorIds.includes(anchor.id)).length,
    }));
    trace.push({ step: 'pricing', message: `单位估算 = 月刊例中值 × ${resolved.billingMonths} 个计费月（四舍五入）+ 单位制作费；共 ${totalYuan} 元，余量 ${remaining} 元。` });
    trace.push({ step: 'schedule', message: `按最终数量编排 ${schedule.batches.length} 批，排期状态 ${schedule.status}。` });
    return {
      status: 'ok', request: structuredClone(request), client: resolved.client, campaign: resolved.campaign, lines, anchors, billingMonths: resolved.billingMonths,
      totalYuan, remainingYuan: request.budgetYuan - totalYuan, queriedAt: resolved.queriedAt, schedule,
      assumptions: unique(['客户为代称，客户背景与 Campaign 均为提案假设。', '报价采用刊例区间中值估算，单位制作费仅计一次；不含客户折扣、税费及真实成交价。', ...candidates.filter(candidate => quantities.has(candidate.mediaKey)).flatMap(candidate => candidate.assumptions)]),
      notices: resolved.notices, trace, ...(preferences.length ? { strategyPreferences: preferences } : {}),
    };
  }
}
