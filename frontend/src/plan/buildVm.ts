/** 视图模型：把后端响应换算成 renderPlan 直接可用的结构，回退规则集中在这里。 */
import type {
  Anchor, Campaign, Client, PlanAnchor, PlanCopy, PlanFailure, PlanLine, PlanSuccess,
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
}

export interface PlanVmAnchor {
  id: string
  areaName: string
  station: string
  role: string
  rationale: string
  busCount: number
  metroCount: number
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
  startDate: string
  endDate: string
  queriedAt: string
  schedule: Schedule
  totalMediaFeeYuan: number
  totalProductionYuan: number
  shares: { kind: 'bus' | 'metro'; label: string; yuan: number; pct: number; productionYuan: number; productionPct: number }[]
  assumptions: string[]
  notices: string[]
  checks: Check[]
  rounds: Round[]
  degraded: Degraded[]
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
const plainYuan = (yuan: number) => `¥${yuan.toLocaleString('zh-CN')}`
const wanRange = (low: number, high: number) => `${Math.round(low / 1000) / 10}–${Math.round(high / 1000) / 10} 万`

export function windowText(start: string, end: string): string {
  if (!start || !end) return '—'
  return start === end ? start : `${start} ~ ${end.slice(5)}`
}

export function industryName(meta: { industries: MetaIndustry[] } | null, id: string): string {
  return meta?.industries.find(item => item.id === id)?.name || id
}

function anchorFromMeta(metaIndustry: MetaIndustry | undefined, anchorsById: Record<string, Anchor> | undefined) {
  const list: PlanVmAnchor[] = []
  for (const ref of metaIndustry?.anchors || []) {
    const full = anchorsById?.[ref.id]
    list.push({
      id: ref.id,
      areaName: ref.areaName || full?.areaName || ref.id,
      station: ref.station || full?.station || '',
      role: ref.role || full?.role || 'businessArea',
      rationale: ref.rationale || '',
      busCount: ref.candidateCounts?.bus ?? 0,
      metroCount: ref.candidateCounts?.metro ?? 0,
      selectedCount: ref.selectedCount ?? 0,
      coord: full?.coord ? { lng: full.coord.lng, lat: full.coord.lat, exit: full.coord.exit } : undefined,
    })
  }
  return list
}

function fallbackAnchors(plan: PlanSuccess): PlanVmAnchor[] {
  const map = new Map<string, PlanVmAnchor>()
  for (const line of plan.lines) {
    for (const reason of line.reasons) {
      const matched = reason.match(/^([^：:]+?)：/)
      if (!matched) continue
      const name = matched[1].trim()
      if (!name || name.length > 40) continue
      const entry = map.get(name) || {
        id: name, areaName: name, station: '', role: 'businessArea', rationale: '',
        busCount: 0, metroCount: 0, selectedCount: 0,
      }
      entry.selectedCount += 1
      map.set(name, entry)
    }
  }
  return [...map.values()]
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
    }))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'metro' ? -1 : 1) || b.lineTotalYuan - a.lineTotalYuan)
}

export function buildVm(input: {
  plan: PipelineSuccess
  meta: { industries: MetaIndustry[] } | null
  anchorsById?: Record<string, Anchor>
  mode: 'off' | 'mock' | 'live'
}): PlanVm {
  const { plan, meta, mode } = input
  const copy = plan.copy
  const lines = normalizeLines(plan.lines)
  const metaIndustry = meta?.industries.find(item => item.id === plan.request.industry)
  let anchors = anchorFromMeta(metaIndustry, input.anchorsById)
  if (!anchors.length) anchors = fallbackAnchors(plan)
  const planAnchors: PlanAnchor[] = plan.anchors || []
  if (planAnchors.length) {
    anchors = planAnchors.map(item => ({
      id: item.id,
      areaName: item.areaName,
      station: item.station,
      role: item.role,
      rationale: item.rationale,
      busCount: item.candidateCounts?.bus ?? 0,
      metroCount: item.candidateCounts?.metro ?? 0,
      selectedCount: item.selectedCount ?? 0,
      coord: input.anchorsById?.[item.id]?.coord
        ? { lng: input.anchorsById[item.id].coord.lng, lat: input.anchorsById[item.id].coord.lat, exit: input.anchorsById[item.id].coord.exit }
        : undefined,
    }))
  }
  for (const anchor of anchors) {
    anchor.selectedCount = plan.lines.filter(line => line.reasons.some(reason => reason.startsWith(anchor.areaName))).length || anchor.selectedCount
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
    brandContextSource: copy.source === 'llm' ? '背景由 AI 生成（live）' : copy.source === 'mock' ? 'AI 回放（mock）' : '模板生成',
    strategySource:
      mode === 'off'
        ? '本次取舍 基础分配（确定性规则）'
        : `本次取舍 AI 参与（${mode === 'mock' ? 'mock 回放' : 'live'}）· ${plan.rounds.length} 轮 · ${plan.rounds.reduce((sum, item) => sum + item.acceptedCount, 0)} 条偏好被采纳 / ${plan.rounds.reduce((sum, item) => sum + item.rejected.length, 0)} 条被拒`,
    lines,
    anchors,
    anchorNotice: planAnchors.length || metaIndustry?.anchors?.length ? null : '本轮未提供锚点元数据，锚点卡按入选理由归类。',
    busLines,
    metroLines,
    quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    busLineCount: busLines.length,
    metroPointCount: metroLines.reduce((sum, line) => sum + line.quantity, 0),
    total: { yuan: plan.totalYuan, text: yuanText(plan.totalYuan) },
    remaining: { yuan: plan.remainingYuan, text: yuanText(plan.remainingYuan) },
    billingMonths: plan.billingMonths,
    startDate: plan.request.startDate,
    endDate: plan.request.endDate,
    queriedAt: plan.queriedAt,
    schedule: plan.schedule,
    totalMediaFeeYuan: mediaFee,
    totalProductionYuan: productionFee,
    shares,
    assumptions: plan.assumptions || [],
    notices: plan.notices || [],
    checks: plan.checks || [],
    rounds: plan.rounds || [],
    degraded: plan.degraded || [],
    trace: (plan.trace || []).map(step => ({ step: step.step, message: step.message, elapsedMs: step.elapsedMs })),
    mode,
    exportAllowed: plan.exportAllowed !== false && !(plan.checks || []).some(check => check.blocking && check.status === 'fail'),
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
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
