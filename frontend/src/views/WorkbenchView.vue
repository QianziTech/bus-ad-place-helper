<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { state, workbench, generate, currentSuccess, currentFailure, loadBaseline, restoreAi, clearCompare, setCampaignOverride } from '../state/workbench'
import { loadMeta, loadConfig } from '../state/workbench'
import { buildVm, failureTitle } from '../plan/buildVm'
import { rangeData } from '../plan/range'
import { downloadPlan, blockingItems, blockingItemsForRange, type BlockingItem } from '../export/download'
import { renderPlan } from '../plan/renderPlan'
import type { CampaignOverride, PipelineSuccess, PlanSuccess, PipelineRangeSuccess } from '../plan/types'
import ControlPanel from '../components/ControlPanel.vue'
import StageProgress from '../components/StageProgress.vue'
import StatusBanner from '../components/StatusBanner.vue'
import DiffPanel from '../components/DiffPanel.vue'
import AiDecisionPanel from '../components/AiDecisionPanel.vue'
import VerifyPanel from '../components/VerifyPanel.vue'
import PreviewFrame from '../components/PreviewFrame.vue'
import InventoryStatus from '../components/InventoryStatus.vue'

const highlight = ref<string | null>(null)
let highlightTimer: number | undefined
const fullscreen = ref(false)
const drawerOpen = ref(false)
const blocked = ref<BlockingItem[]>([])
const elapsed = ref(0)

const pipeline = computed<PipelineSuccess | null>(() => (state.result && state.result.status === 'ok' && 'lines' in state.result ? state.result as PipelineSuccess : null))
/** 侧栏面板用的当前成案：全区间时把共用分析字段与当前金额的清单拼在一起。 */
const panels = computed<PipelineSuccess | null>(() => {
  const base = range.value?.defaultPlan ?? pipeline.value
  const current = currentSuccess.value
  if (!base) return null
  if (!current || !range.value) return base
  return { ...base, request: current.request, lines: current.lines, anchors: current.anchors, schedule: current.schedule, totalYuan: current.totalYuan, remainingYuan: current.remainingYuan, trace: range.value.trace, strategyPreferences: current.strategyPreferences }
})
/** 成功时展示本次结果；失败时保留上一版用于对照，但库存状态与提示必须对应本次失败结果，不能沿用旧方案。 */
const vm = computed(() => {
  const plan = currentSuccess.value
  return plan ? buildVm({ plan, meta: state.meta, mode: state.mode }) : null
})
/** 全区间视图：预览、全屏、下载共用同一份内嵌数据，切换只读本轮结果。 */
const range = computed<PipelineRangeSuccess | null>(() => state.range)
const rangeMeta = computed(() => (!state.showBaseline && range.value ? rangeData(range.value, state.mode) : null))
const liveSuccess = computed<PlanSuccess | null>(() => (state.result && state.result.status === 'ok' && 'lines' in state.result ? state.result as PipelineSuccess : null))
const liveVm = computed(() => {
  const plan = liveSuccess.value
  return plan ? buildVm({ plan, meta: state.meta, mode: state.mode }) : null
})
/** 阻断项：全区间时扫描默认金额的核验结果（文案跨预算共用），任一命中即整份阻断。 */
const blockers = computed(() => (range.value && vm.value ? blockingItemsForRange([vm.value]) : vm.value ? blockingItems(vm.value) : []))
const downloadBlocked = computed(() => Boolean(vm.value && !vm.value.exportAllowed) || blockers.value.length > 0)
/** 成案后自动列出阻断项；收起提示后下载仍禁用。 */
watch(blockers, next => {
  blocked.value = next
})
const fullscreenHtml = computed(() => (vm.value ? renderPlan(vm.value, { appendix: false, fullscreen: true, ...(rangeMeta.value ? { range: rangeMeta.value, budgetYuan: state.selectedYuan } : {}) }) : ''))
/** 成功方案的库存来源行；失败时改由 StatusBanner 展示本次失败结果的库存状态。 */
const inventory = computed(() => liveVm.value?.inventory || range.value?.inventory || null)
const downloadTitle = computed(() => {
  if (!vm.value) return '未生成'
  if (!vm.value.exportAllowed || blockers.value.length) return '请先修改提示中的文案'
  return '下载后可离线查看与切换预算'
})

onMounted(async () => {
  if (!state.meta) await loadMeta()
  if (!state.configLoaded) await loadConfig()
})

function focusLine(key: string) {
  highlight.value = key
  window.clearTimeout(highlightTimer)
  highlightTimer = window.setTimeout(() => { highlight.value = null }, 1500)
  const frame = document.querySelector<HTMLIFrameElement>('iframe.preview')
  frame?.contentWindow?.document.querySelector(`tr[data-key="${key.replace(/"/g, '\\"')}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function focusRef(ref: string) {
  const key = ref.includes('|') ? ref.split(':').find(part => part.includes('|')) : undefined
  if (key) focusLine(key)
}

function create() {
  if (!workbench.media.length) {
    message.warning('请至少选择一种媒体')
    return
  }
  blocked.value = []
  const started = performance.now()
  void generate().finally(() => { elapsed.value = Math.round(performance.now() - started) })
}

function openFullscreen() {
  if (!vm.value) return
  fullscreen.value = true
}

function handleDownload() {
  if (!vm.value) return
  const result = downloadPlan(vm.value, rangeMeta.value && vm.value ? { range: rangeMeta.value, budgetYuan: state.selectedYuan, blocking: () => blockers.value } : undefined)
  if (result.ok) {
    blocked.value = []
    message.success(`已下载 ${result.fileName}`)
  } else {
    blocked.value = result.items
  }
}

const drawerAnchor = computed(() => state.meta?.industries.find(item => item.id === workbench.industry) || null)
const drawerDraft = ref<CampaignOverride>({})
const drawerPreset = computed(() => drawerAnchor.value?.campaign)

const campaignFields = computed(() => {
  const campaign = drawerPreset.value
  if (!campaign) return []
  const draft = drawerDraft.value
  return [
    { key: 'name', label: '③ 投放活动', value: draft.name ?? campaign.name, editable: true },
    { key: 'businessGoal', label: '② 生意目标', value: draft.businessGoal ?? campaign.businessGoal, editable: true },
    { key: 'audience', label: '④ 人群', value: draft.audience ?? campaign.audience, editable: true },
    { key: 'primaryGoal', label: '③ 主目标', value: draft.primaryGoal ?? campaign.primaryGoal, editable: false },
  ] as const
})

function openDrawer() {
  drawerDraft.value = { ...(workbench.campaignOverride || {}) }
  drawerOpen.value = true
}

function saveDrawer() {
  const merged: Record<string, unknown> = { ...(workbench.campaignOverride || {}), ...drawerDraft.value }
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined || merged[key] === '') delete merged[key]
  }
  setCampaignOverride(Object.keys(merged).length ? (merged as CampaignOverride) : undefined)
  drawerOpen.value = false
  message.info('需求已更新，请重新生成方案')
}

function resetDrawer() {
  drawerDraft.value = {}
}

const demoSections = ['s1', 's2', 's3', 's4', 's5', 's6'] as const

/** 演示模式章节跳转：文档在 iframe 里，直接操作它的 document。 */
function scrollDemo(target: 'next' | 'prev' | number) {
  const frame = document.querySelector<HTMLIFrameElement>('iframe.demo')
  const doc = frame?.contentWindow?.document
  const win = frame?.contentWindow
  if (!doc || !win) return
  const tops = demoSections.map(id => doc.getElementById(id)?.offsetTop ?? 0)
  const current = win.scrollY
  if (typeof target === 'number') {
    win.scrollTo({ top: tops[target] ?? 0, behavior: 'smooth' })
    return
  }
  const index = tops.reduce((best, top, i) => Math.abs(top - current) < Math.abs(tops[best] - current) ? i : best, 0)
  const nextIndex = target === 'next' ? Math.min(tops.length - 1, index + 1) : Math.max(0, index - 1)
  win.scrollTo({ top: tops[nextIndex], behavior: 'smooth' })
}

function onKey(event: KeyboardEvent) {
  if (!fullscreen.value) {
    if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return
    if (event.key.toLowerCase() === 'f' && vm.value) openFullscreen()
    return
  }
  if (event.key === 'Escape') fullscreen.value = false
  else if (event.key.toLowerCase() === 'd') handleDownload()
  else if (event.key >= '1' && event.key <= '6') scrollDemo(Number(event.key) - 1)
  else if (event.key === 'PageDown') { event.preventDefault(); scrollDemo('next') }
  else if (event.key === 'PageUp') { event.preventDefault(); scrollDemo('prev') }
}
onMounted(() => window.addEventListener('keydown', onKey))
</script>

<template>
  <div class="app-main">
    <div class="panel">
      <ControlPanel />
      <div class="panel-block">
        <a-button type="primary" block size="large" :loading="state.loading" @click="create">
          {{ state.loading ? '生成中…' : state.result && state.result.status === 'ok' ? '重新生成' : '生成方案' }}
        </a-button>
        <a-space style="margin-top: 8px" wrap>
          <a-button size="small" @click="openDrawer">需求细节</a-button>
          <a-button size="small" :disabled="!panels" @click="state.showBaseline ? restoreAi() : loadBaseline()">
            {{ state.showBaseline ? '返回 AI 方案' : '查看基础方案' }}
          </a-button>
        </a-space>
        <p class="caption" style="margin-top: 6px">修改投放条件后，请重新生成方案；预算在成品卷首拖动切换。</p>
      </div>

      <div class="panel-block">
        <p v-if="state.loading" class="caption" role="status">正在生成方案…</p>
        <a-collapse v-if="state.loading || state.result || state.networkError || state.scanHits.length" ghost size="small">
          <a-collapse-panel key="generation" header="生成记录">
            <StageProgress :stages="state.stages" />
            <p v-if="state.lastQueryMs" class="caption">上次生成用时 {{ (state.lastQueryMs / 1000).toFixed(1) }} 秒</p>
          </a-collapse-panel>
        </a-collapse>
      </div>

      <div class="panel-block" v-if="(panels && state.prevSuccess) || state.showBaseline">
        <h4>{{ state.showBaseline ? 'AI 方案 → 基础分配' : '本次变化' }}</h4>
        <DiffPanel :diff="state.diff" :mode="state.showBaseline ? 'baseline' : 'regen'" @focus="focusLine" @clear="clearCompare" />
      </div>

      <div class="panel-block">
        <AiDecisionPanel :result="panels" :mode="state.mode" @baseline="loadBaseline" @restore="restoreAi" />
      </div>

      <div v-if="panels" class="panel-block">
        <VerifyPanel :checks="panels.checks" :trace-count="panels.trace.length" @focus="focusRef" />
      </div>
    </div>

    <div class="preview-wrap">
      <StatusBanner :failure="currentFailure" />
      <div v-if="state.showBaseline" class="status-bar">
        <a-tag color="orange">基础方案</a-tag>
        当前方案未采用 AI 推荐。
        <a style="margin-left: 8px; cursor: pointer" @click="restoreAi">返回 AI 方案</a>
      </div>
      <div v-if="inventory" class="preview-toolbar inventory-bar">
        <InventoryStatus :inventory="inventory" compact />
      </div>
      <div class="preview-toolbar">
        <span class="spacer" style="flex: 1" />
        <a-space>
          <a-button size="small" :disabled="!vm" @click="openFullscreen">全屏演示（F）</a-button>
          <a-button type="primary" size="small" :disabled="!vm || downloadBlocked" :title="downloadTitle" @click="handleDownload">下载方案（HTML）</a-button>
        </a-space>
      </div>
      <div style="position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column">
        <PreviewFrame :vm="vm" :highlight="highlight" />
        <div v-if="currentFailure && vm" class="preview-stale" aria-hidden="true">
          <span>{{ failureTitle(currentFailure.status) }}，当前显示上次方案。请调整条件后重新生成。</span>
        </div>
        <div v-else-if="currentFailure && range" class="preview-stale" aria-hidden="true">
          <span>{{ failureTitle(currentFailure.status) }}：{{ currentFailure.message }}。拖动卷首滑块可查看其他金额的可行方案。</span>
        </div>
      </div>
    </div>

    <a-drawer v-model:open="drawerOpen" title="投放需求" width="520">
      <div v-if="drawerPreset" style="display: flex; flex-direction: column; gap: 14px">
        <div class="caption">① 客户（只读）：{{ drawerAnchor?.client.code }} · {{ drawerAnchor?.client.alias }}（{{ drawerAnchor?.client.category }}）</div>
        <div v-for="field in campaignFields" :key="field.key">
          <div class="caption">
            {{ field.label }}
            <a-tag v-if="(drawerDraft as Record<string, unknown>)[field.key]" color="blue" style="margin-left: 6px">人工</a-tag>
            <a-tag v-else style="margin-left: 6px">行业预置</a-tag>
          </div>
          <a-input v-if="field.key === 'name' || field.key === 'businessGoal' || field.key === 'audience'"
            :value="field.value as string"
            @update:value="(v: string) => { (drawerDraft as Record<string, unknown>)[field.key] = v }" />
          <a-select v-else
            :value="field.value as string"
            :options="['认知', '到店', '促销', '拉新'].map(v => ({ value: v, label: v }))"
            @update:value="(v: string) => { (drawerDraft as Record<string, unknown>)[field.key] = v }" />
        </div>
        <div class="caption">⑤ 时间与预算：活动窗口 {{ drawerPreset.window.start }} ~ {{ drawerPreset.window.end }}，建议 {{ Math.round(drawerPreset.budgetHintYuan / 10000) }} 万；成品默认展示最近可行金额，可在卷首滑块切换。</div>
        <div class="caption">⑥ 媒体范围：{{ drawerPreset.mediaScope.map(kind => kind === 'bus' ? '公交' : '地铁').join(' + ') }}</div>
        <div class="caption">⑦ 成功衡量：{{ drawerPreset.successMetric.kpi }}；{{ drawerPreset.successMetric.proof }}</div>
        <a-space>
          <a-button type="primary" @click="saveDrawer">应用</a-button>
          <a-button @click="resetDrawer">恢复行业预置</a-button>
        </a-space>
      </div>
      <p v-else class="caption">暂无行业参考需求。</p>
    </a-drawer>

    <div v-if="fullscreen" style="position: fixed; inset: 0; background: #fff; z-index: 20; display: flex; flex-direction: column">
      <iframe class="demo" :srcdoc="fullscreenHtml" style="flex: 1; width: 100%; border: none" title="全屏演示" sandbox="allow-same-origin allow-scripts" />
      <div style="position: fixed; left: 20px; bottom: 16px; font-size: 12px; color: var(--ink-3)">1–6 跳节 · PageDown/PageUp 翻节 · Esc 退出 · D 下载</div>
      <a-space style="position: fixed; right: 20px; bottom: 20px">
        <a-button @click="handleDownload" :disabled="!vm || downloadBlocked">下载（D）</a-button>
        <a-button @click="fullscreen = false">退出（Esc）</a-button>
      </a-space>
    </div>

    <div v-if="blocked.length" class="status-bar error" style="position: fixed; left: 400px; right: 0; bottom: 0; z-index: 15">
      <b>下载前需修改 {{ blocked.length }} 处文案</b>
      <div v-for="(item, index) in blocked" :key="index" style="margin-top: 4px">
        ✗ {{ item.element }}｜{{ item.location }}｜{{ item.message }}<template v-if="item.suggestion">　建议：{{ item.suggestion }}</template>
      </div>
      <a-space style="margin-top: 8px">
        <a-button size="small" @click="blocked = []">收起提示</a-button>
      </a-space>
    </div>
  </div>
</template>
