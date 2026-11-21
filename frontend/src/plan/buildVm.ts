/** 视图模型：把后端响应换算成 renderPlan 直接可用的结构，回退规则集中在这里。 */
import type {
  Anchor, Campaign, Client, InventoryDetail, PlanAnchor, PlanCopy, PlanFailure, PlanLine, PlanSuccess,
  PipelineSuccess, PlanRequest, Schedule, TrafficReference, MetaIndustry, Check, Round, Degraded,
} from './types'

export interface Money {
  yuan: number
  text: string
}

export interface PlanVmLine {
  mediaKey: string
  kind: 'bus' | 'metro'
  name: string
  variant: string
  levelName: string
  freeCount: number
  total?: number
  contractCount?: number
  reservedCount?: number
  quantity: number
  monthlyLowYuan: number
  monthlyHighYuan: number
  productionYuan: number
  lineTotalYuan: number
  mediaFeeYuan: number
  reasons: string[]
  sources: string[]
  preferredByAi: boolean
  anchorIds: string[]
  traffic?: TrafficReference
  /** 线路走向；同一线路多种媒体形式共用一份。 */
  trajectory?: { crs?: string; lengthKm?: number; polyline: [number, number][] }
}

export interface PlanVmAnchor {
  id: string
  areaName: string
  station: string
  role: string
  rationale: string
  /** 周边候选数与「本方案选中数」；后端未提供候选元数据时为 null，界面显示「—」。 */
  busCount: number | null
  metroCount: number | null
  selectedCount: number
  coord?: { lng: number; lat: number; exit: string }
}

export interface PlanVm {
  industryName: string
  client: Client
  campaign: Campaign
  request: PlanRequest
  chips: { industry: string; budget: string; media: string; window: string }[]
  headlineTemplate: string
  headline: string
  headlineSource: 'llm' | 'mock' | 'template'
  copy: PlanCopy
  brandContextSource: string
  strategySource: string
  lines: PlanVmLine[]
  anchors: PlanVmAnchor[]
  anchorNotice: string | null
  busLines: PlanVmLine[]
  metroLines: PlanVmLine[]
  quantity: number
  busLineCount: number
  metroPointCount: number
  total: Money
  remaining: Money
  billingMonths: number
  billingPending: boolean
  inventory: InventoryDetail | null
  startDate: string
  endDate: string
  queriedAt: string
  queriedAtText: string
  schedule: Schedule
  totalMediaFeeYuan: number
  totalProductionYuan: number
  shares: { kind: 'bus' | 'metro'; label: string; yuan: number; pct: number; productionYuan: number; productionPct: number }[]
  assumptions: string[]
  notices: string[]
  checks: Check[]
  rounds: Round[]
  degraded: Degraded[]
  /** 策略阶段给出的衡量建议；S6.5 与 campaign 口径并列展示，campaign 为最终口径。 */
  measurement?: { kpi: string; proof: string }
  trace: { step: string; message: string; elapsedMs?: number }[]
  mode: 'off' | 'mock' | 'live'
  exportAllowed: boolean
  generatedAt: string
}

const busFormLabel: Record<string, string> = {
  车身三侧: '车身三侧',
  大三侧: '大三侧',
  全色车: '全色车',
}
const levelLabel = (level: string) => (level === '观光' ? '观光车（双层/都市观光）' : level)

export function yuanText(yuan: number): string {
  if (!Number.isFinite(yuan)) return '—'
  const wan = yuan / 10000
  return `¥${(Math.round(wan * 10) / 10).toFixed(1)} 万`
}
export function analysisModeText(mode: 'off' | 'mock' | 'live'): string {
  return { off: '规则生成', mock: '离线演示', live: '在线 AI' }[mode]
}
const plainYuan = (yuan: number) => `¥${yuan.toLocaleString('zh-CN')}`
const wanRange = (low: number, high: number) => `${Math.round(low / 1000) / 10}–${Math.round(high / 1000) / 10} 万`

export function windowText(start: string, end: string): string {
  if (!start || !end) return '—'
  return start === end ? start : `${start} ~ ${end.slice(5)}`
}

/** 后端返回带时区的 ISO 时间，页面统一显示为本机 `YYYY-MM-DD HH:mm`。 */
export function dateTimeText(value: string | number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value || '—')
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function industryName(meta: { industries: MetaIndustry[] } | null, id: string): string {
  return meta?.industries.find(item => item.id === id)?.name || id
}

function anchorIdParts(id: string) {
  const dash = id.indexOf('-')
  return dash < 0 ? { station: id, areaName: id } : { station: id.slice(dash + 1), areaName: id.slice(dash + 1) }
}

function anchorFromMeta(metaIndustry: MetaIndustry | undefined, anchorsById: Record<string, Anchor> | undefined): PlanVmAnchor[] {
  const list: PlanVmAnchor[] = []
  for (const ref of metaIndustry?.anchors || []) {
    const fallback = anchorIdParts(ref.id)
    const full = anchorsById?.[ref.id]
    list.push({
      id: ref.id,
      areaName: ref.areaName || full?.areaName || fallback.areaName,
      station: ref.station || full?.station || fallback.station,
      role: ref.role || full?.role || 'businessArea',
      rationale: ref.rationale || '',
      busCount: ref.candidateCounts?.bus ?? (full ? full.candidates.filter(item => item.mediaKey.startsWith('bus|')).length : null),
      metroCount: ref.candidateCounts?.metro ?? (full ? full.candidates.filter(item => item.mediaKey.startsWith('metro|')).length : null),
      selectedCount: ref.selectedCount ?? 0,
      coord: full?.coord ? { lng: full.coord.lng, lat: full.coord.lat, exit: full.coord.exit } : undefined,
    })
  }
  return list
}

function fallbackAnchors(plan: PlanSuccess): PlanVmAnchor[] {
  const map = new Map<string, PlanVmAnchor>()
  for (const line of plan.lines) {
    const ids = new Set<string>()
    for (const ref of line.evidenceRefs || []) {
      const matched = ref.match(/^coverage:([^:]+):/)
      if (matched) ids.add(matched[1])
    }
    for (const id of ids) {
      const station = id.includes('-') ? id.slice(id.indexOf('-') + 1) : id
      const areaPrefix = line.reasons
        .map(reason => reason.split(/[：:]/)[0].trim())
        .filter(prefix => prefix.length <= 24)
        .find(prefix => prefix.startsWith(station))
      const entry = map.get(id) || {
        id,
        areaName: areaPrefix || station,
        station,
        role: 'businessArea',
        rationale: '',
        busCount: null,
        metroCount: null,
        selectedCount: 0,
        coord: undefined,
      }
      if (areaPrefix && entry.areaName === entry.station) entry.areaName = areaPrefix
      entry.selectedCount += 1
      map.set(id, entry)
    }
  }
  return [...map.values()].sort((a, b) => b.selectedCount - a.selectedCount)
}

function normalizeLines(lines: PlanLine[]): PlanVmLine[] {
  return lines
    .map(line => ({
      mediaKey: line.mediaKey,
      kind: line.kind,
      name: line.name,
      variant: line.kind === 'bus' ? busFormLabel[line.mediaForm || ''] || line.mediaForm || '—' : line.exit || '—',
      levelName: levelLabel(line.levelName),
      freeCount: line.freeCount,
      total: line.total,
      contractCount: line.contractCount,
      reservedCount: line.reservedCount,
      quantity: line.quantity,
      monthlyLowYuan: line.monthlyLowYuan,
      monthlyHighYuan: line.monthlyHighYuan,
      productionYuan: line.productionYuan,
      lineTotalYuan: line.lineTotalYuan,
      mediaFeeYuan: line.lineTotalYuan - line.productionYuan,
      reasons: line.reasons || [],
      sources: line.sources || [],
      preferredByAi: Boolean(line.preferredByAi),
      anchorIds: [],
      traffic: line.trafficReference,
      ...(line.trajectory ? { trajectory: line.trajectory } : {}),
    }))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'metro' ? -1 : 1) || b.lineTotalYuan - a.lineTotalYuan)
}

export type RenderablePlan = PlanSuccess & Partial<Pick<PipelineSuccess, 'copy' | 'checks' | 'rounds' | 'degraded' | 'exportAllowed' | 'measurement'>>

export function buildVm(input: {
  plan: RenderablePlan
  meta: { industries: MetaIndustry[] } | null
  anchorsById?: Record<string, Anchor>
  mode: 'off' | 'mock' | 'live'
}): PlanVm {
  const { plan, meta, mode } = input
  // /api/plan 的基础分配没有 copy/checks/rounds/degraded，统一回退，保证同一渲染器可用。
  const copy = plan.copy || { headline: '', brandContext: '', strategyLine: '', selectionRationale: '', assumptionEcho: '', source: 'template' as const }
  const rounds = plan.rounds || []
  const degraded = plan.degraded || []
  const checks = plan.checks || []
  const lines = normalizeLines(plan.lines)
  const metaIndustry = meta?.industries.find(item => item.id === plan.request.industry)
  let anchors = anchorFromMeta(metaIndustry, input.anchorsById)
  if (!anchors.length) anchors = fallbackAnchors(plan)
  const planAnchors: PlanAnchor[] = plan.anchors || []
  if (planAnchors.length) {
    anchors = planAnchors.map(item => {
      // 全区间结果在锚点上直接带代表点；单预算结果从数据层补。
      const coord = (item as PlanAnchor & { coord?: { lng: number; lat: number; exit: string; source: string } }).coord
        ?? input.anchorsById?.[item.id]?.coord
      return {
        id: item.id,
        areaName: item.areaName,
        station: item.station,
        role: item.role,
        rationale: item.rationale,
        busCount: item.candidateCounts?.bus ?? null,
        metroCount: item.candidateCounts?.metro ?? null,
        selectedCount: item.selectedCount ?? 0,
        coord: coord ? { lng: coord.lng, lat: coord.lat, exit: coord.exit } : undefined,
      }
    })
  }
  // 选中数按覆盖证据（coverage:<anchorId>:<mediaKey>）归属，避免同名商圈误并。
  for (const anchor of anchors) {
    const matched = plan.lines.filter(line => (line.evidenceRefs || []).some(ref => ref.startsWith(`coverage:${anchor.id}:`)))
    if (matched.length) anchor.selectedCount = matched.length
  }
  const busLines = lines.filter(line => line.kind === 'bus')
  const metroLines = lines.filter(line => line.kind === 'metro')
  const mediaFee = lines.reduce((sum, line) => sum + line.mediaFeeYuan, 0)
  const productionFee = lines.reduce((sum, line) => sum + line.productionYuan, 0)
  const shares = (['bus', 'metro'] as const)
    .map(kind => {
      const subset = lines.filter(line => line.kind === kind)
      const yuan = subset.reduce((sum, line) => sum + line.mediaFeeYuan, 0)
      const prod = subset.reduce((sum, line) => sum + line.productionYuan, 0)
      return {
        kind,
        label: kind === 'bus' ? '公交车身' : '地铁出入口',
        yuan,
        pct: mediaFee ? Math.round((yuan / mediaFee) * 1000) / 10 : 0,
        productionYuan: prod,
        productionPct: productionFee ? Math.round((prod / productionFee) * 1000) / 10 : 0,
      }
    })
    .filter(item => item.yuan > 0 || item.productionYuan > 0)
  const firstAnchor = anchors[0]?.areaName || plan.campaign.mediaScope.map(kind => (kind === 'bus' ? '公交沿线' : '地铁站口')).slice(0, 1).join('')
  const headlineTemplate =
    copy.headline && copy.headline.trim()
      ? copy.headline.trim()
      : `在${firstAnchor || '目标商圈'}，把${plan.campaign.primaryGoal || '本次目标'}做成一次可执行的投放`
  const chips = [
    { industry: metaIndustry?.name || plan.request.industry, budget: `${Math.round(plan.request.budgetYuan / 10000)} 万`, media: plan.request.media.map(kind => (kind === 'bus' ? '公交车身' : '地铁出入口')).join(' + '), window: windowText(plan.request.startDate, plan.request.endDate) },
  ]
  const industryLabel = metaIndustry?.name || plan.request.industry
  return {
    industryName: industryLabel,
    client: plan.client,
    campaign: plan.campaign,
    request: plan.request,
    chips,
    headlineTemplate: `${plan.client.alias} · ${plan.campaign.name}`,
    headline: headlineTemplate,
    headlineSource: copy.source,
    copy,
    brandContextSource: copy.source === 'llm' ? 'AI 辅助整理' : copy.source === 'mock' ? '演示样例' : '模板文案',
    strategySource:
      mode === 'off'
        ? '本次资源按规则推荐。'
        : `${analysisModeText(mode)} · ${rounds.length} 轮推荐 · 采用 ${rounds.reduce((sum, item) => sum + item.acceptedCount, 0)} 项，未采用 ${rounds.reduce((sum, item) => sum + item.rejected.length, 0)} 项。`,
    lines,
    anchors,
    anchorNotice: anchors.some(anchor => anchor.busCount === null && anchor.metroCount === null) ? '部分商圈暂无候选数量，仅显示本方案已选资源。' : null,
    busLines,
    metroLines,
    quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    busLineCount: busLines.length,
    metroPointCount: metroLines.reduce((sum, line) => sum + line.quantity, 0),
    total: { yuan: plan.totalYuan, text: yuanText(plan.totalYuan) },
    remaining: { yuan: plan.remainingYuan, text: yuanText(plan.remainingYuan) },
    billingMonths: plan.billingMonths,
    billingPending: plan.billingStatus === 'pending' || plan.inventory?.billingStatus === 'pending',
    inventory: plan.inventory || null,
    startDate: plan.request.startDate,
    endDate: plan.request.endDate,
    queriedAt: plan.queriedAt,
    queriedAtText: dateTimeText(plan.queriedAt),
    schedule: plan.schedule,
    totalMediaFeeYuan: mediaFee,
    totalProductionYuan: productionFee,
    shares,
    assumptions: plan.assumptions || [],
    notices: plan.notices || [],
    checks,
    rounds,
    degraded,
    measurement: plan.measurement,
    trace: (plan.trace || []).map(step => ({ step: step.step, message: step.message, elapsedMs: step.elapsedMs })),
    mode,
    exportAllowed: plan.exportAllowed !== false && !(plan.checks || []).some(check => check.blocking && check.status === 'fail'),
    generatedAt: dateTimeText(Date.now()),
  }
}

export interface DiffEntry {
  mediaKey: string
  name: string
  kind: 'bus' | 'metro'
  variant: string
  levelName: string
  before: number
  after: number
  type: 'added' | 'removed' | 'changed'
}

export function diffLines(prev: PlanSuccess | null, next: PlanSuccess | null): DiffEntry[] {
  if (!prev || !next) return []
  const before = new Map(prev.lines.map(line => [line.mediaKey, line]))
  const after = new Map(next.lines.map(line => [line.mediaKey, line]))
  const entries: DiffEntry[] = []
  for (const [key, line] of after) {
    const old = before.get(key)
    const base = {
      mediaKey: key,
      name: line.name,
      kind: line.kind,
      variant: line.kind === 'bus' ? line.mediaForm || '—' : line.exit || '—',
      levelName: levelLabel(line.levelName),
      before: old?.quantity ?? 0,
      after: line.quantity,
    }
    if (!old) entries.push({ ...base, type: 'added' })
    else if (old.quantity !== line.quantity) entries.push({ ...base, type: 'changed' })
  }
  for (const [key, line] of before) {
    if (after.has(key)) continue
    entries.push({
      mediaKey: key,
      name: line.name,
      kind: line.kind,
      variant: line.kind === 'bus' ? line.mediaForm || '—' : line.exit || '—',
      levelName: levelLabel(line.levelName),
      before: line.quantity,
      after: 0,
      type: 'removed',
    })
  }
  const order = { added: 0, changed: 1, removed: 2 }
  return entries.sort((a, b) => order[a.type] - order[b.type] || a.name.localeCompare(b.name, 'zh-CN'))
}

export function failureTitle(status: PlanFailure['status']): string {
  switch (status) {
    case 'missing_window': return '该档期没有完整库存核对结果'
    case 'missing_data': return '候选数据或计价依据不足'
    case 'no_inventory': return '所选媒体在该档期已无空位'
    case 'over_budget': return '最低可报价组合超过预算上限'
    default: return '本次未能成案'
  }
}

export { plainYuan, wanRange }
