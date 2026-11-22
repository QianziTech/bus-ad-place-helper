/** 工作台状态：参数、当前方案与生成进度。 */
import { computed, reactive, ref } from 'vue'
import { api, ApiError, type PlanJobProgress, type ScanHit } from '../api/client'
import type {
  CampaignOverride, IndustryId, MediaKind, Meta, MetaIndustry, PipelineResponse, PipelineRangeSuccess, PipelineSuccess,
  PlanSuccess, PlanFailure,
} from '../plan/types'
import { diffLines, type DiffEntry } from '../plan/buildVm'
import { initialBudget, planForBudget } from '../plan/range'

export interface StageState extends Omit<PlanJobProgress, 'status'> {
  label: string
  status: PlanJobProgress['status'] | 'idle'
}

const stageLabels: Record<StageState['key'], string> = {
  brief: '提取补充需求',
  inventory: '查询档期库存',
  candidates: '筛选候选资源',
  strategy: '生成媒体策略',
  engine: '核算报价与排期',
  copy: '生成提案文案',
  verify: '核验方案',
}
const stageDefaults = (): StageState[] => (Object.keys(stageLabels) as StageState['key'][]).map(key => ({
  key, label: stageLabels[key], status: 'idle', detail: '', elapsedMs: 0,
}))

export const workbench = reactive({
  industry: 'food' as IndustryId,
  media: ['bus', 'metro'] as MediaKind[],
  startDate: '',
  endDate: '',
  briefText: '',
  campaignOverride: undefined as CampaignOverride | undefined,
})

export const state = reactive({
  meta: null as Meta | null,
  metaError: '',
  mode: 'mock' as 'off' | 'mock' | 'live',
  loading: false,
  result: null as PipelineResponse | null,
  /** 本轮全区间结果；成品内滑块只读它，不再发请求。 */
  range: null as PipelineRangeSuccess | null,
  /** 成品当前金额（元）；默认由建议预算归入区间后取最近可行值。 */
  selectedYuan: 2000000,
  prevSuccess: null as PlanSuccess | null,
  failure: null as PlanFailure | null,
  networkError: '',
  scanHits: [] as ScanHit[],
  lastQueryMs: 0,
  stages: stageDefaults(),
  diff: [] as DiffEntry[],
  showBaseline: false,
  baseline: null as PlanSuccess | null,
  generatedAt: 0,
  configLoaded: false,
})

let controller: AbortController | null = null
const weeklyRequest = ref('')

/** 本轮结果在当前金额下的完整成案；不可成案时为 null，原因由 currentOption 提供。 */
export const currentSuccess = computed<PlanSuccess | null>(() => {
  if (state.showBaseline && state.baseline) return state.baseline
  if (state.range) return planForBudget(state.range, state.selectedYuan)
  if (state.result && state.result.status === 'ok' && 'lines' in state.result) return state.result as PipelineSuccess
  // 失败时不清空上一版方案，只加遮罩提示，避免演示时白屏。
  return state.prevSuccess
})
/** 当前金额的档位结果；不可成案时带 status / message / suggestions。 */
export const currentOption = computed(() => state.range?.budgetOptions.find(option => option.budgetYuan === state.selectedYuan) || null)
export const currentFailure = computed<PlanFailure | null>(() => {
  if (state.showBaseline && state.baseline) return null
  if (state.range && currentOption.value && currentOption.value.status !== 'ok') {
    return { status: currentOption.value.status as PlanFailure['status'], message: currentOption.value.message || '该金额没有可行组合', suggestions: currentOption.value.suggestions || [] }
  }
  return state.result && state.result.status !== 'ok' ? state.result : null
})

export function industryMeta(): MetaIndustry | undefined {
  return state.meta?.industries.find(item => item.id === workbench.industry)
}

export function chooseIndustry(id: IndustryId) {
  if (workbench.industry !== id) workbench.campaignOverride = undefined
  workbench.industry = id
  const window = industryMeta()?.campaign.window
  if (!window) return
  const [year, month] = window.start.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const monthEnd = window.start.slice(0, 8) + lastDay
  workbench.startDate = window.start
  workbench.endDate = monthEnd < window.end ? monthEnd : window.end
}

export const canConfirmWeekly = computed(() => !state.loading && weeklyRequest.value === JSON.stringify(buildRequest()))

export function confirmWeekly() {
  if (canConfirmWeekly.value) return generate(true)
}

export async function loadMeta() {
  try {
    const meta = await api.meta()
    state.meta = meta
    state.metaError = ''
    const defaultIndustry = meta.industries.find(item => item.id === workbench.industry) || meta.industries[0]
    if (defaultIndustry && !workbench.startDate) chooseIndustry(defaultIndustry.id)
  } catch (error) {
    state.metaError = error instanceof Error ? error.message : '无法读取 /api/meta'
    if (!workbench.startDate) {
      workbench.startDate = '2027-07-01'
      workbench.endDate = '2027-07-31'
    }
  }
}

export async function loadConfig() {
  try {
    const config = await api.config()
    state.mode = config.mode
    state.configLoaded = true
  } catch {
    state.configLoaded = false
  }
}

/** 生成请求不再带预算：后端一次返回 100–500 万元全区间。 */
function buildRequest() {
  const payload: Record<string, unknown> = {
    industry: workbench.industry,
    media: [...workbench.media],
    startDate: workbench.startDate,
    endDate: workbench.endDate,
  }
  if (workbench.campaignOverride) payload.campaignOverride = workbench.campaignOverride
  if (workbench.briefText.trim()) payload.briefText = workbench.briefText.trim()
  return payload
}

export async function generate(acceptWeekly = false) {
  if (!workbench.media.length) return
  controller?.abort()
  const requestController = new AbortController()
  controller = requestController
  const payload = buildRequest()
  weeklyRequest.value = ''
  state.loading = true
  state.networkError = ''
  state.scanHits = []
  state.lastQueryMs = 0
  state.stages = stageDefaults()
  const started = performance.now()
  try {
    const result = await api.generate(acceptWeekly ? { ...payload, acceptWeekly: true } : payload, requestController.signal, progress => {
      if (requestController.signal.aborted) return
      for (const update of progress) {
        const stage = state.stages.find(item => item.key === update.key)
        if (stage) Object.assign(stage, update)
      }
    })
    if (requestController.signal.aborted) return
    if (currentSuccess.value) state.prevSuccess = currentSuccess.value
    state.result = result
    state.range = result.status === 'ok' && 'budgetOptions' in result ? result : null
    if (state.range) state.selectedYuan = initialBudget(state.range)
    state.baseline = null
    state.showBaseline = false
    if (result.status === 'ok') {
      state.diff = diffLines(state.prevSuccess, currentSuccess.value)
      state.failure = null
      state.generatedAt = Date.now()
    } else {
      state.failure = result
      if (result.inventory?.canUseWeekly) weeklyRequest.value = JSON.stringify(payload)
      state.diff = []
    }
  } catch (error) {
    if (requestController.signal.aborted) return
    if (error instanceof ApiError && error.scanChecks.length) {
      // 入口拦截：原文命中实名或成交价，展示替换建议并保留原文供修改。
      state.scanHits = error.scanChecks
      state.networkError = '补充需求含需修改的表述，请按提示替换后重新生成。'
      return
    }
    state.networkError = error instanceof ApiError ? error.message : error instanceof Error ? error.message : '请求失败'
    const active = state.stages.find(stage => stage.status === 'running')
    if (active) Object.assign(active, { status: 'failed', detail: `进度查询中断 · ${state.networkError}` })
  } finally {
    if (controller === requestController) {
      controller = null
      state.lastQueryMs = Math.round(performance.now() - started)
      state.loading = false
    }
  }
}

/** 成品内切换金额：只读本轮结果，不发请求、不重算。 */
export function selectBudget(budgetYuan: number) {
  if (!state.range) return
  const option = state.range.budgetOptions.find(item => item.budgetYuan === budgetYuan)
  if (!option) return
  state.selectedYuan = budgetYuan
  state.showBaseline = false
  state.baseline = null
  state.diff = diffLines(state.prevSuccess, planForBudget(state.range, budgetYuan))
  state.failure = option.status === 'ok' ? null : { status: option.status as PlanFailure['status'], message: option.message || '该金额没有可行组合', suggestions: option.suggestions || [] }
}

/** 「只看基础分配」：同一参数走 /api/plan（不带 strategyPreferences），预算取当前金额。 */
export async function loadBaseline() {
  if (!currentSuccess.value) return
  try {
    const { strategyPreferences: _preferences, ...parameters } = currentSuccess.value.request
    const request = { ...parameters, budgetYuan: state.selectedYuan }
    const baseline = await api.plan(request)
    if (baseline.status === 'ok' && 'lines' in baseline) {
      state.baseline = baseline as PlanSuccess
      state.showBaseline = true
      state.diff = diffLines(currentSuccess.value, state.baseline)
    }
  } catch (error) {
    state.networkError = error instanceof Error ? error.message : '基础分配请求失败'
  }
}

export function restoreAi() {
  state.showBaseline = false
  state.baseline = null
  state.diff = diffLines(state.prevSuccess, state.range ? planForBudget(state.range, state.selectedYuan) : null)
}

export function clearCompare() {
  state.prevSuccess = state.range ? planForBudget(state.range, state.selectedYuan) : (state.result && state.result.status === 'ok' && 'lines' in state.result ? state.result as PipelineSuccess : null)
  state.diff = []
}

export function setCampaignOverride(override: CampaignOverride | undefined) {
  workbench.campaignOverride = override
}
