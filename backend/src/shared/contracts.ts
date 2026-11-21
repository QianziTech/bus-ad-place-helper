export const INDUSTRIES = ['food', 'finance', 'health', 'hospital', 'park'] as const;
export type IndustryId = (typeof INDUSTRIES)[number];
export type MediaKind = 'bus' | 'metro';
export type AnalysisMode = 'off' | 'mock' | 'live';
export interface Client { code: string; alias: string; category: string; scale: string; channelNote?: string; selectionBasis?: string }
export interface Campaign {
  id: string; name: string; businessGoal: string; primaryGoal: '认知' | '到店' | '促销' | '拉新';
  audience: string; window: { start: string; end: string }; budgetHintYuan: number;
  mediaScope: MediaKind[]; mediaBias: { bus: number; metro: number };
  successMetric: { kpi: string; proof: string }; constraints: string[];
}
export type CampaignOverride = Partial<Omit<Campaign, 'id'>>;
export interface Industry { id: IndustryId; name: string; client: Client; campaign: Campaign; anchors: { id: string; rationale: string }[] }
export interface Media { kind: MediaKind; resourceId: number; lineName: string; levelName: string; total?: number; mediaForm?: string; exit?: string }
export interface Inventory { freeCount: number | null; contractCount?: number; reservedCount?: number }
export interface InventoryWindow { startDate: string; endDate: string; queriedAt: string; billingMonths: number; inventoryByKey: Record<string, Inventory> }
export interface MediaData { mediaByKey: Record<string, Media>; windows: InventoryWindow[] }
export type InventorySource = 'hongdou' | 'archive' | 'snapshot' | 'missing';
export interface InventoryKindStatus {
  kind: MediaKind;
  source: InventorySource;
  sourceLabel: string;
  queriedAt?: string;
  sampleDates?: string[];
  billingMonths: number | null;
  reason?: string;
}
/** 未成案时随响应返回的库存参考：整段查询失败的媒体按区间内周一截面给出参考空位。 */
export interface InventoryPreviewRow {
  mediaKey: string; kind: MediaKind; name: string; levelName: string;
  mediaForm?: string; exit?: string; freeCount: number | null; sampleDates?: string[];
}
export interface InventoryDetail {
  startDate: string; endDate: string;
  billingMonths: number | null;
  billingStatus: 'confirmed' | 'pending';
  kinds: InventoryKindStatus[];
  preview?: InventoryPreviewRow[];
}
export interface Price { monthlyLowYuan: number; monthlyHighYuan: number; productionYuan: number; source: string; assumptions: string[] }
export interface CoverageCandidate { mediaKey: string; relation: string; source: string; distanceM?: number }
export interface Anchor { areaName: string; station: string; role: 'businessArea' | 'landmark'; coord: { lng: number; lat: number; exit: string; source: string }; candidates: CoverageCandidate[] }
export interface TrafficReference { period: string; source: string; coveragePv?: number; ageGroups?: { label: string; percent: number }[] }
/** 线路走向：经度在前，GCJ02，已按 12 m 容差简化。同一线路的多种媒体形式共用一份。 */
export interface Trajectory { crs?: string; lengthKm?: number; bbox?: number[]; polyline: [number, number][] }
export interface TrajectorySet { crs: string; source: string; period?: string; note?: string; byLineName: Record<string, Trajectory> }
export interface AnchorSummary { id: string; areaName: string; station: string; role: 'businessArea' | 'landmark'; rationale: string; candidateCounts: { bus: number; metro: number } }
export interface PlanAnchor extends AnchorSummary { selectedCount: number }
/** 周截面参考：每期周一按 mediaKey 记录 freeCount，保持日期与数值同序。 */
export interface SnapshotData { dates: string[]; freeByKey: Record<string, (number | null)[]> }
export interface PlanData { bus: MediaData; metro: MediaData; pricing: { pricesByMediaKey: Record<string, Price> }; briefs: { industries: Industry[] }; coverage: { anchorsById: Record<string, Anchor> }; traffic: { byMediaKey: Record<string, TrafficReference> }; trajectories: TrajectorySet; snapshots?: SnapshotData }
export type RejectionReason = 'unknown_media' | 'no_stock' | 'over_budget' | 'premium_exceeded' | 'invalid_evidence';
export interface StrategyPreference { mediaKey: string; reason: string; evidenceRefs: string[]; disposition?: 'accepted' | `rejected:${RejectionReason}` }
export interface PlanRequest { industry: IndustryId; budgetYuan: number; media: MediaKind[]; startDate: string; endDate: string; campaignOverride?: CampaignOverride; strategyPreferences?: StrategyPreference[]; briefText?: string }
/** 流水线请求：省略 budgetYuan 时按滑块全区间生成。 */
export type PipelineRequest = Omit<PlanRequest, 'budgetYuan'> & { budgetYuan?: number };
export interface Candidate {
  mediaKey: string; kind: MediaKind; name: string; levelName: string; mediaForm?: string; exit?: string; total?: number;
  freeCount: number; contractCount?: number; reservedCount?: number;
  monthlyLowYuan: number; monthlyHighYuan: number; productionYuan: number; unitEstimateYuan: number;
  anchorIds: string[]; evidenceRefs: string[]; reasons: string[]; sources: string[]; assumptions: string[]; trafficReference?: TrafficReference; trajectory?: Trajectory;
}
export interface PlanFailure { status: 'missing_window' | 'missing_data' | 'no_inventory' | 'over_budget'; message: string; suggestions: string[]; inventory?: InventoryDetail }
export interface CandidatePool { status: 'ok'; request: PlanRequest; client: Client; campaign: Campaign; candidates: Candidate[]; anchors: AnchorSummary[]; billingMonths: number; queriedAt: string; notices: string[]; excluded: { mediaKey: string; reason: RejectionReason }[]; inventory: InventoryDetail }
export interface PlanLine extends Omit<Candidate, 'anchorIds' | 'assumptions'> { quantity: number; lineTotalYuan: number; preferredByAi?: boolean }
export interface ScheduleBatch { no: number; nightDate: string; mediaKeys: string[]; quantity: number; cumulative: number; publishStartDate: string; risk: string | null }
export interface Schedule { status: 'ok' | 'unavailable' | 'capacity_short'; singleNightCap: number; batches: ScheduleBatch[]; rainBufferNights: number; compensationBufferQty: number; notes: string[]; assumptions: string[] }
export interface TraceStep { step: string; message: string; evidenceRefs?: string[]; elapsedMs?: number }
export interface PlanSuccess { status: 'ok'; request: PlanRequest; client: Client; campaign: Campaign; lines: PlanLine[]; anchors: PlanAnchor[]; billingMonths: number; billingStatus: 'confirmed' | 'pending'; totalYuan: number; remainingYuan: number; queriedAt: string; schedule: Schedule; assumptions: string[]; notices: string[]; trace: TraceStep[]; strategyPreferences?: StrategyPreference[]; inventory: InventoryDetail }
export type PlanResult = PlanSuccess | PlanFailure;
export interface Check { element: string; status: 'pass' | 'warn' | 'fail'; message: string; evidenceRefs: string[]; blocking?: boolean; location?: string; suggestion?: string }
export interface PlanCopy { headline: string; brandContext: string; strategyLine: string; selectionRationale: string; assumptionEcho: string; source: 'llm' | 'mock' | 'template' }
export interface Round { round: number; candidateCount: number; preferredCount: number; acceptedCount: number; rejected: { mediaKey: string; reason: RejectionReason }[]; requestReplan: boolean; elapsedMs: number }
export interface Degraded { stage: 'brief' | 'strategy' | 'copy' | 'verify'; reason: string }
export interface PipelineSuccess extends PlanSuccess { copy: PlanCopy; checks: Check[]; rounds: Round[]; degraded: Degraded[]; exportAllowed: boolean; mediaObjective?: string; windowFit?: { status: 'aligned' | 'risk' | 'unknown'; reason: string; evidenceRefs: string[] }; measurement?: { kpi: string; proof: string } }
/** 预算滑块刻度与默认金额；100–500 万元按 1 万元步长。 */
export interface BudgetOptions { minYuan: number; maxYuan: number; stepYuan: number; presetsYuan: number[]; defaultYuan: number }
/** 跨档共用的媒体静态信息：线路、点位、报价依据、证据、轨迹与客流参考，不随预算变化。 */
export interface OptionMedia {
  mediaKey: string; kind: MediaKind; name: string; levelName: string; mediaForm?: string; exit?: string; total?: number;
  freeCount: number; contractCount?: number; reservedCount?: number;
  monthlyLowYuan: number; monthlyHighYuan: number; productionUnitYuan: number; unitEstimateYuan: number;
  anchorIds: string[]; evidenceRefs: string[]; reasons: string[]; sources: string[]; assumptions: string[]; trafficReference?: TrafficReference; trajectory?: Trajectory;
}
/** 单个预算上限下的成案行：数量与金额随预算变化，其余字段取 mediaByKey。 */
export interface OptionLine { mediaKey: string; quantity: number; lineTotalYuan: number; preferredByAi?: boolean }
/** 单个预算上限的成案结果；不可行时给出对应失败状态与原因。 */
export interface BudgetOption {
  budgetYuan: number;
  status: 'ok' | PlanFailure['status'];
  message?: string;
  suggestions?: string[];
  lines?: OptionLine[];
  /** 仅列出该金额下命中的锚点及其选中数。 */
  selectedAnchors?: { anchorId: string; selectedCount: number }[];
  schedule?: Schedule;
  totalYuan?: number;
  remainingYuan?: number;
  /** 该金额相对上一可行金额的线路增减、金额差异、批次变化与余量原因。 */
  analysis?: string[];
}
export interface RangeAnchor extends AnchorSummary { coord?: { lng: number; lat: number; exit: string; source: string } }
/** 引擎产出的全区间结果：共用客户、Campaign、库存与逐档结果。 */
export interface PlanRangeBase {
  status: 'ok'; request: PipelineRequest; client: Client; campaign: Campaign;
  billingMonths: number; billingStatus: 'confirmed' | 'pending'; inventory: InventoryDetail; queriedAt: string;
  anchors: RangeAnchor[]; budget: BudgetOptions; budgetOptions: BudgetOption[]; mediaByKey: Record<string, OptionMedia>;
  assumptions: string[]; notices: string[]; trace: TraceStep[]; strategyPreferences?: StrategyPreference[];
}
/** 省略 budgetYuan 时的流水线结果：默认金额的完整成案 + 逐档结果，一次生成后滑块切换不再请求。 */
export interface PipelineRangeSuccess extends Omit<PipelineSuccess, 'request' | 'lines' | 'anchors' | 'schedule' | 'totalYuan' | 'remainingYuan'>, Omit<PlanRangeBase, 'status'> {
  request: PipelineRequest;
  industryName: string;
  /** 默认金额对应的完整成案；滑块初始位置直接渲染它。 */
  defaultPlan: PipelineSuccess;
}
export interface AnalysisContext { mode: AnalysisMode; deadline: number; config: RuntimeConfig }
export interface RuntimeConfig { mode: AnalysisMode; llm: { provider: string; baseUrl: string; model: string; timeoutMs: number; retries: number; temperature: number; apiKey?: string }; includeHistoricalProfiles: boolean; updatedAt: string; source: 'file' | 'environment' }
export interface StrategyResult { status: 'ok' | 'disabled' | 'unavailable'; strategyPreferences: StrategyPreference[]; mediaObjective: string; requestReplan: boolean; replanReason?: string; windowFit?: { status: 'aligned' | 'risk' | 'unknown'; reason: string; evidenceRefs: string[] }; measurement?: { kpi: string; proof: string }; reason?: string }
export interface BriefResult { status: 'ok' | 'disabled' | 'unavailable'; campaignDraft: CampaignOverride; missing: string[]; confidence: number; trace: TraceStep[] }
export interface CopyResult { status: 'ok' | 'disabled' | 'unavailable'; copy: PlanCopy; reason?: string }
export interface VerifyResult { status: 'ok' | 'disabled' | 'unavailable'; checks: Check[]; summary: string; trace: TraceStep[]; exportAllowed: boolean; reason?: string }
