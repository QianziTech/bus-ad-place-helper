/** 工作台状态：参数、meta、本轮全区间结果、当前金额、失败、五阶段与降级。所有请求走同一 composable。 */
import { computed, reactive, ref } from 'vue'
import { api, ApiError, type ScanHit } from '../api/client'
import type {
  CampaignOverride, IndustryId, MediaKind, Meta, MetaIndustry, PipelineResponse, PipelineRangeSuccess, PipelineSuccess,
  PlanSuccess, PlanFailure,
} from '../plan/types'
import { diffLines, failureTitle, type DiffEntry } from '../plan/buildVm'
import { initialBudget, planForBudget } from '../plan/range'

export interface StageState {
  key: 'candidates' | 'strategy' | 'engine' | 'copy' | 'verify'
  label: string
  status: 'idle' | 'running' | 'done' | 'skipped' | 'failed'
  detail: string
}

const stageDefaults: StageState[] = [
  { key: 'candidates', label: '查找资源', status: 'idle', detail: '' },
  { key: 'strategy', label: '选择资源', status: 'idle', detail: '' },
  { key: 'engine', label: '核算数量与报价', status: 'idle', detail: '' },
  { key: 'copy', label: '整理方案', status: 'idle', detail: '' },
  { key: 'verify', label: '检查方案', status: 'idle', detail: '' },
]

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
  stages: stageDefaults.map(item => ({ ...item })) as StageState[],
  diff: [] as DiffEntry[],
  showBaseline: false,
  baseline: null as PlanSuccess | null,
  generatedAt: 0,
  configLoaded: false,
})

let controller: AbortController | null = null

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

export function windowVerified(start = workbench.startDate, end = workbench.endDate): boolean {
  return Boolean(state.meta?.windows.some(item => item.startDate === start && item.endDate === end))
}

export async function loadMeta() {
  try {
    const meta = await api.meta()
    state.meta = meta
    state.metaError = ''
    const defaultIndustry = meta.industries.find(item => item.id === workbench.industry) || meta.industries[0]
    if (defaultIndustry) {
      workbench.industry = defaultIndustry.id
      if (!workbench.startDate) {
        const first = meta.windows[0]
        workbench.startDate = first?.startDate || defaultIndustry.campaign.window.start
        workbench.endDate = first?.endDate || defaultIndustry.campaign.window.end
      }
    }
    if (!meta.windows.length && !workbench.startDate) {
      workbench.startDate = defaultIndustry?.campaign.window.start || '2027-07-01'
      workbench.endDate = defaultIndustry?.campaign.window.end || '2027-07-31'
    }
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

function resetStages() {
  state.stages = stageDefaults.map(item => ({ ...item }))
}

function markStage(key: StageState['key'], status: StageState['status'], detail = '') {
  const stage = state.stages.find(item => item.key === key)
  if (stage) {
    stage.status = status
    stage.detail = detail
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

function fillStageDetails(result: PipelineResponse) {
  if (result.status !== 'ok') {
    markStage('engine', 'failed', failureTitle(result.status))
    return
  }
  const range = 'budgetOptions' in result ? result : null
  const current = currentSuccess.value
  const rounds = result.rounds || []
  const first = rounds[0]
  const busCount = current?.lines.filter(line => line.kind === 'bus').length ?? 0
  const metroCount = current?.lines.filter(line => line.kind === 'metro').length ?? 0
  markStage('candidates', 'done', `${first?.candidateCount ?? (current?.lines.length ?? 0)} 条候选（公交 ${busCount} · 地铁 ${metroCount}）`)
  const skipped = result.degraded?.some(item => item.stage === 'strategy')
  if (state.mode === 'off') markStage('strategy', 'skipped', '使用规则推荐')
  else if (skipped) markStage('strategy', 'failed', `已使用基础方案：${result.degraded?.find(item => item.stage === 'strategy')?.reason || 'AI 暂不可用'}`)
  else markStage('strategy', 'done', `采用 ${rounds.reduce((sum, item) => sum + item.acceptedCount, 0)} 项推荐 · ${rounds.reduce((sum, item) => sum + item.rejected.length, 0)} 项未采用`)
  markStage('engine', 'done', range
    ? `已生成 ${range.budgetOptions.filter(option => option.status === 'ok').length}/${range.budgetOptions.length} 个金额档 · 当前 ${(state.selectedYuan / 10000).toFixed(0)} 万（余量 ${((current?.remainingYuan ?? 0) / 10000).toFixed(1)} 万）`
    : `${current?.lines.reduce((sum, line) => sum + line.quantity, 0) ?? 0} 台/个 · ${((current?.totalYuan ?? 0) / 10000).toFixed(1)} 万（余量 ${((current?.remainingYuan ?? 0) / 10000).toFixed(1)} 万）`)
  if (state.mode === 'off') markStage('copy', 'skipped', '使用模板文案')
  else if (result.degraded?.some(item => item.stage === 'copy')) markStage('copy', 'failed', `已使用模板文案：${result.degraded.find(item => item.stage === 'copy')?.reason}`)
  else markStage('copy', 'done', result.copy?.source === 'template' ? '模板文案' : '方案文案已完成')
  const pass = result.checks.filter(item => item.status === 'pass').length
  const warn = result.checks.filter(item => item.status === 'warn').length
  const fail = result.checks.filter(item => item.status === 'fail').length
  markStage('verify', fail ? 'failed' : 'done', `${pass} 通过 · ${warn} 待确认 · ${fail} 未通过`)
}

export async function generate() {
  if (!workbench.media.length) return
  controller?.abort()
  const requestController = new AbortController()
  controller = requestController
  state.loading = true
  state.networkError = ''
  state.scanHits = []
  resetStages()
  markStage('candidates', 'running', '正在后台生成方案…')
  const started = performance.now()
  try {
    const result = await api.generate(buildRequest(), requestController.signal)
    if (requestController.signal.aborted) return
    const elapsed = Math.round(performance.now() - started)
    state.lastQueryMs = elapsed
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
      state.diff = []
    }
    fillStageDetails(result)
  } catch (error) {
    if (requestController.signal.aborted) return
    if (error instanceof ApiError && error.scanChecks.length) {
      // 入口拦截：原文命中实名或成交价，展示替换建议并保留原文供修改。
      state.scanHits = error.scanChecks
      markStage('candidates', 'failed', '原文含需替换表述')
      state.stages.filter(stage => stage.status === 'idle').forEach(stage => { stage.status = 'skipped' })
      return
    }
    state.networkError = error instanceof ApiError ? error.message : error instanceof Error ? error.message : '请求失败'
    markStage('candidates', 'failed', state.networkError)
    state.stages.filter(stage => stage.status === 'idle').forEach(stage => { stage.status = 'skipped' })
  } finally {
    if (controller === requestController) {
      controller = null
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
    const request = { ...buildRequest(), budgetYuan: state.selectedYuan }
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