/** 工作台状态：参数、meta、两次结果、失败、五阶段与降级。所有请求走同一 composable。 */
import { computed, reactive, ref } from 'vue'
import { api, ApiError } from '../api/client'
import type {
  CampaignOverride, IndustryId, MediaKind, Meta, MetaIndustry, PipelineResult, PlanSuccess, PlanFailure,
} from '../plan/types'
import { diffLines, failureTitle, type DiffEntry } from '../plan/buildVm'

export interface StageState {
  key: 'candidates' | 'strategy' | 'engine' | 'copy' | 'verify'
  label: string
  status: 'idle' | 'running' | 'done' | 'skipped' | 'failed'
  detail: string
}

const stageDefaults: StageState[] = [
  { key: 'candidates', label: '候选', status: 'idle', detail: '' },
  { key: 'strategy', label: 'AI 筛选', status: 'idle', detail: '' },
  { key: 'engine', label: '引擎复核', status: 'idle', detail: '' },
  { key: 'copy', label: '成稿', status: 'idle', detail: '' },
  { key: 'verify', label: '核验', status: 'idle', detail: '' },
]

export const workbench = reactive({
  industry: 'food' as IndustryId,
  budgetWan: 200,
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
  result: null as PipelineResult | null,
  prevSuccess: null as PlanSuccess | null,
  failure: null as PlanFailure | null,
  networkError: '',
  lastQueryMs: 0,
  stages: stageDefaults.map(item => ({ ...item })) as StageState[],
  diff: [] as DiffEntry[],
  showBaseline: false,
  baseline: null as PlanSuccess | null,
  generatedAt: 0,
  configLoaded: false,
})

let controller: AbortController | null = null

export const currentSuccess = computed<PlanSuccess | null>(() => {
  if (state.showBaseline && state.baseline) return state.baseline
  return state.result && state.result.status === 'ok' ? state.result : null
})
export const currentFailure = computed<PlanFailure | null>(() => {
  if (state.showBaseline && state.baseline) return null
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

function buildRequest() {
  const payload: Record<string, unknown> = {
    industry: workbench.industry,
    budgetYuan: Math.round(workbench.budgetWan) * 10000,
    media: [...workbench.media],
    startDate: workbench.startDate,
    endDate: workbench.endDate,
  }
  if (workbench.campaignOverride) payload.campaignOverride = workbench.campaignOverride
  if (workbench.briefText.trim()) payload.briefText = workbench.briefText.trim()
  return payload
}

function fillStageDetails(result: PipelineResult) {
  if (result.status !== 'ok') {
    markStage('engine', 'failed', failureTitle(result.status))
    return
  }
  const rounds = result.rounds || []
  const first = rounds[0]
  const busCount = result.lines.filter(line => line.kind === 'bus').length
  const metroCount = result.lines.filter(line => line.kind === 'metro').length
  markStage('candidates', 'done', `${first?.candidateCount ?? result.lines.length} 条候选（公交 ${busCount} · 地铁 ${metroCount}）`)
  const skipped = result.degraded?.some(item => item.stage === 'strategy')
  if (state.mode === 'off') markStage('strategy', 'skipped', '已跳过（模式 off）')
  else if (skipped) markStage('strategy', 'failed', `降级：${result.degraded?.find(item => item.stage === 'strategy')?.reason || '不可用'}`)
  else markStage('strategy', 'done', `采用 ${rounds.reduce((sum, item) => sum + item.acceptedCount, 0)} 条偏好 · ${rounds.reduce((sum, item) => sum + item.rejected.length, 0)} 项被拒`)
  markStage('engine', 'done', `${result.lines.reduce((sum, line) => sum + line.quantity, 0)} 台/个 · ${(result.totalYuan / 10000).toFixed(1)} 万（余量 ${(result.remainingYuan / 10000).toFixed(1)} 万）`)
  if (state.mode === 'off') markStage('copy', 'skipped', '已跳过（模式 off）')
  else if (result.degraded?.some(item => item.stage === 'copy')) markStage('copy', 'failed', `降级：${result.degraded.find(item => item.stage === 'copy')?.reason}`)
  else markStage('copy', result.copy?.source === 'template' ? 'done' : 'done', result.copy?.source === 'template' ? '模板文案' : '标题与 4 段文案')
  const pass = result.checks.filter(item => item.status === 'pass').length
  const warn = result.checks.filter(item => item.status === 'warn').length
  const fail = result.checks.filter(item => item.status === 'fail').length
  markStage('verify', fail ? 'failed' : 'done', `${pass} 通过 · ${warn} 待看 · ${fail} 已阻断`)
}

export async function generate() {
  if (!workbench.media.length) return
  controller?.abort()
  controller = new AbortController()
  state.loading = true
  state.networkError = ''
  resetStages()
  markStage('candidates', 'running', '读取档期库存与刊例…')
  const started = performance.now()
  try {
    const result = await api.generate(buildRequest(), controller.signal)
    const elapsed = Math.round(performance.now() - started)
    state.lastQueryMs = elapsed
    if (state.result && state.result.status === 'ok') state.prevSuccess = state.result
    state.result = result
    state.baseline = null
    state.showBaseline = false
    if (result.status === 'ok') {
      state.diff = diffLines(state.prevSuccess, result)
      state.failure = null
      state.generatedAt = Date.now()
    } else {
      state.failure = result
      state.diff = []
    }
    fillStageDetails(result)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    state.networkError = error instanceof ApiError ? error.message : error instanceof Error ? error.message : '请求失败'
    markStage('candidates', 'failed', state.networkError)
    state.stages.filter(stage => stage.status === 'idle').forEach(stage => { stage.status = 'skipped' })
  } finally {
    state.loading = false
  }
}

/** 「只看基础分配」：同一参数走 /api/plan（不带 strategyPreferences）。 */
export async function loadBaseline() {
  if (!state.result || state.result.status !== 'ok') return
  try {
    const request = { ...buildRequest() }
    const baseline = await api.plan(request)
    if (baseline.status === 'ok') {
      state.baseline = baseline
      state.showBaseline = true
      state.diff = diffLines(state.result, baseline)
    }
  } catch (error) {
    state.networkError = error instanceof Error ? error.message : '基础分配请求失败'
  }
}

export function restoreAi() {
  state.showBaseline = false
  state.baseline = null
  state.diff = diffLines(state.prevSuccess, state.result && state.result.status === 'ok' ? state.result : null)
}

export function clearCompare() {
  state.prevSuccess = state.result && state.result.status === 'ok' ? state.result : null
  state.diff = []
}

export function setCampaignOverride(override: CampaignOverride | undefined) {
  workbench.campaignOverride = override
}
