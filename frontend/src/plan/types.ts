/**
 * 与 backend/src/shared/contracts.ts 对齐的前端类型。
 * 只读契约，不在这里新增后端没有的字段；可选字段用 ? 表示，缺失时页面按回退规则渲染。
 */
export type IndustryId = 'food' | 'finance' | 'health' | 'hospital' | 'park'
export type MediaKind = 'bus' | 'metro'
export type AnalysisMode = 'off' | 'mock' | 'live'
export type PrimaryGoal = '认知' | '到店' | '促销' | '拉新'

export interface Client {
  code: string
  alias: string
  category: string
  scale: string
  channelNote?: string
  selectionBasis?: string
}

export interface Campaign {
  id: string
  name: string
  businessGoal: string
  primaryGoal: PrimaryGoal
  audience: string
  window: { start: string; end: string }
  budgetHintYuan: number
  mediaScope: MediaKind[]
  mediaBias: { bus: number; metro: number }
  successMetric: { kpi: string; proof: string }
  constraints: string[]
}

export type CampaignOverride = Partial<Omit<Campaign, 'id'>>

export interface Media {
  kind: MediaKind
  resourceId: number
  lineName: string
  levelName: string
  total?: number
  mediaForm?: string
  exit?: string
}

export interface Inventory {
  freeCount: number | null
  contractCount?: number
  reservedCount?: number
}

export interface InventoryWindow {
  startDate: string
  endDate: string
  queriedAt: string
  billingMonths: number
  inventoryByKey: Record<string, Inventory>
}

export interface Price {
  monthlyLowYuan: number
  monthlyHighYuan: number
  productionYuan: number
  source: string
  assumptions: string[]
}

export interface CoverageCandidate {
  mediaKey: string
  relation: string
  source: string
  distanceM?: number
}

export interface Anchor {
  areaName: string
  station: string
  role: 'businessArea' | 'landmark'
  coord: { lng: number; lat: number; exit: string; source: string }
  candidates: CoverageCandidate[]
}

export interface TrafficReference {
  period: string
  source: string
  coveragePv?: number
  ageGroups?: { label: string; percent: number }[]
}

export type RejectionReason = 'unknown_media' | 'no_stock' | 'over_budget' | 'premium_exceeded' | 'invalid_evidence'

export interface StrategyPreference {
  mediaKey: string
  reason: string
  evidenceRefs: string[]
  disposition?: 'accepted' | `rejected:${RejectionReason}`
}

export interface PlanRequest {
  industry: IndustryId
  budgetYuan: number
  media: MediaKind[]
  startDate: string
  endDate: string
  acceptWeekly?: boolean
  campaignOverride?: CampaignOverride
  strategyPreferences?: StrategyPreference[]
  briefText?: string
}

/** 流水线请求：省略 budgetYuan 时由后端生成档期内可成案的预算区间。 */
export type PipelineRequest = Omit<PlanRequest, 'budgetYuan'> & { budgetYuan?: number }

export interface Candidate {
  mediaKey: string
  kind: MediaKind
  name: string
  levelName: string
  mediaForm?: string
  exit?: string
  total?: number
  freeCount: number
  contractCount?: number
  reservedCount?: number
  monthlyLowYuan: number
  monthlyHighYuan: number
  productionYuan: number
  unitEstimateYuan: number
  anchorIds: string[]
  evidenceRefs: string[]
  reasons: string[]
  sources: string[]
  assumptions: string[]
  trafficReference?: TrafficReference
  /** 线路走向；同一线路多种媒体形式共用一份。后端有数据时才返回。 */
  trajectory?: { crs?: string; lengthKm?: number; bbox?: number[]; polyline: [number, number][] }
}

export interface PlanLine extends Omit<Candidate, 'anchorIds' | 'assumptions'> {
  quantity: number
  lineTotalYuan: number
  preferredByAi?: boolean
}

export interface ScheduleBatch {
  no: number
  nightDate: string
  mediaKeys: string[]
  quantity: number
  kindQuantities?: Partial<Record<MediaKind, number>>
  cumulative: number
  publishStartDate: string
  risk: string | null
}

export interface Schedule {
  status: 'ok' | 'unavailable' | 'capacity_short'
  singleNightCap: number
  batches: ScheduleBatch[]
  rainBufferNights: number
  compensationBufferQty: number
  notes: string[]
  assumptions: string[]
}

export interface TraceStep {
  step: string
  message: string
  evidenceRefs?: string[]
  elapsedMs?: number
}

export type PlanStatus = 'missing_window' | 'missing_data' | 'no_inventory' | 'over_budget'
export type InventorySource = 'hongdou' | 'archive' | 'snapshot' | 'missing'

export interface InventoryKindStatus {
  kind: MediaKind
  source: InventorySource
  sourceLabel: string
  queriedAt?: string
  sampleDates?: string[]
  billingMonths: number | null
  reason?: string
}

export interface InventoryPreviewRow {
  mediaKey: string
  kind: MediaKind
  name: string
  levelName: string
  mediaForm?: string
  exit?: string
  freeCount: number | null
  sampleDates?: string[]
}

export interface InventoryDetail {
  startDate: string
  endDate: string
  billingMonths: number | null
  billingStatus: 'confirmed' | 'pending'
  kinds: InventoryKindStatus[]
  canUseWeekly?: boolean
  preview?: InventoryPreviewRow[]
}

export interface PlanSuccess {
  status: 'ok'
  request: PlanRequest
  client: Client
  campaign: Campaign
  lines: PlanLine[]
  billingMonths: number
  /** 计费口径未确认时为 pending，金额只是参考估算。 */
  billingStatus?: 'confirmed' | 'pending'
  inventory?: InventoryDetail
  totalYuan: number
  remainingYuan: number
  queriedAt: string
  schedule: Schedule
  assumptions: string[]
  notices: string[]
  trace: TraceStep[]
  strategyPreferences?: StrategyPreference[]
  /** 本轮参与选点的锚点；后端可选提供，缺失时页面按 evidenceRefs 推断。 */
  anchors?: PlanAnchor[]
}

export interface PlanAnchor {
  id: string
  areaName: string
  station: string
  role: 'businessArea' | 'landmark'
  rationale: string
  candidateCounts: { bus: number; metro: number }
  selectedCount: number
}

export interface PlanFailure {
  status: PlanStatus
  message: string
  suggestions: string[]
  inventory?: InventoryDetail
}

export type PlanResult = PlanSuccess | PlanFailure

export interface Check {
  element: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  evidenceRefs: string[]
  blocking?: boolean
  location?: string
  suggestion?: string
}

export interface PlanCopy {
  headline: string
  brandContext: string
  strategyLine: string
  selectionRationale: string
  /** 已停用：后端不再生成，交付件不渲染。 */
  assumptionEcho?: string
  source: 'llm' | 'mock' | 'template'
}

export interface Round {
  round: number
  candidateCount: number
  preferredCount: number
  acceptedCount: number
  rejected: { mediaKey: string; reason: RejectionReason }[]
  requestReplan: boolean
  elapsedMs: number
}

export interface Degraded {
  stage: 'brief' | 'strategy' | 'copy' | 'verify'
  reason: string
}

export interface PipelineSuccess extends PlanSuccess {
  copy: PlanCopy
  checks: Check[]
  rounds: Round[]
  degraded: Degraded[]
  exportAllowed: boolean
  /** 可选：策略面板需要的对照信息，后端提供时才展示。 */
  mediaObjective?: string
  windowFit?: { status: 'aligned' | 'risk' | 'unknown'; reason: string; evidenceRefs: string[] }
  measurement?: { kpi: string; proof: string }
}

export type PipelineResult = PipelineSuccess | PlanFailure

/** 预算滑块刻度：100–500 万元，步长 1 万元，100／200／500 万为直达刻度。 */
export interface BudgetOptions { minYuan: number; maxYuan: number; stepYuan: number; presetsYuan: number[]; defaultYuan: number }

export interface OptionMedia {
  mediaKey: string
  kind: MediaKind
  name: string
  levelName: string
  mediaForm?: string
  exit?: string
  total?: number
  freeCount: number
  contractCount?: number
  reservedCount?: number
  monthlyLowYuan: number
  monthlyHighYuan: number
  productionUnitYuan: number
  unitEstimateYuan: number
  anchorIds: string[]
  evidenceRefs: string[]
  reasons: string[]
  sources: string[]
  assumptions: string[]
  trafficReference?: TrafficReference
  trajectory?: { crs?: string; lengthKm?: number; bbox?: number[]; polyline: [number, number][] }
}

export interface OptionLine { mediaKey: string; quantity: number; lineTotalYuan: number; preferredByAi?: boolean }

export interface BudgetOption {
  budgetYuan: number
  status: 'ok' | PlanStatus
  message?: string
  suggestions?: string[]
  lines?: OptionLine[]
  selectedAnchors?: { anchorId: string; selectedCount: number }[]
  schedule?: Schedule
  totalYuan?: number
  remainingYuan?: number
  analysis?: string[]
}

/** 全区间结果里的锚点：后端只给摘要与代表点，selectedCount 由当前档位推出。 */
export interface RangeAnchor extends Omit<PlanAnchor, 'selectedCount'> {
  selectedCount: number
  coord?: { lng: number; lat: number; exit: string; source: string }
}

/** 省略 budgetYuan 的全区间结果：共用字段 + defaultPlan 完整成案 + 逐档结果。 */
export interface PipelineRangeSuccess extends Omit<PipelineSuccess, 'request' | 'lines' | 'totalYuan' | 'remainingYuan' | 'schedule'> {
  request: PipelineRequest
  industryName: string
  budget: BudgetOptions
  minimumEstimateYuan?: number
  budgetOptions: BudgetOption[]
  mediaByKey: Record<string, OptionMedia>
  anchors: RangeAnchor[]
  defaultPlan: PipelineSuccess
}

export type PipelineResponse = PipelineSuccess | PipelineRangeSuccess | PlanFailure

export interface MetaIndustry {
  id: IndustryId
  name: string
  client: Client
  campaign: Campaign
  /** 后端可选提供；缺失时锚点卡降级为「本轮未提供锚点元数据」。 */
  anchors?: PlanAnchor[]
}

export interface Meta {
  industries: MetaIndustry[]
  media: MediaKind[]
  budget: { minYuan: number; maxYuan: number; presetsYuan: number[] }
  windows: { startDate: string; endDate: string }[]
}

export interface PublicConfig {
  mode: AnalysisMode
  llm: {
    provider: string
    baseUrl: string
    model: string
    timeoutMs: number
    retries: number
    temperature: number
    hasKey: boolean
    keyPreview: string
  }
  includeHistoricalProfiles: boolean
  updatedAt: string
  source: 'file' | 'environment'
}

export interface BriefSample { industry: IndustryId; title: string; text: string }

export interface BriefResult {
  status: 'ok' | 'disabled' | 'unavailable'
  campaignDraft: CampaignOverride
  missing: string[]
  confidence: number
  trace: TraceStep[]
  reason?: string
}

export interface VerifyResult {
  status: 'ok' | 'disabled' | 'unavailable'
  checks: Check[]
  summary: string
  trace: TraceStep[]
  exportAllowed: boolean
  reason?: string
}
