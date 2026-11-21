<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { state, workbench, generate, currentSuccess, currentFailure, loadBaseline, restoreAi, clearCompare, setCampaignOverride } from '../state/workbench'
import { loadMeta, loadConfig } from '../state/workbench'
import { buildVm } from '../plan/buildVm'
import { downloadPlan, type BlockingItem } from '../export/download'
import { humanLocation } from '../plan/locations'
import { renderPlan } from '../plan/renderPlan'
import type { CampaignOverride, PipelineSuccess } from '../plan/types'
import ControlPanel from '../components/ControlPanel.vue'
import StageProgress from '../components/StageProgress.vue'
import StatusBanner from '../components/StatusBanner.vue'
import DiffPanel from '../components/DiffPanel.vue'
import AiDecisionPanel from '../components/AiDecisionPanel.vue'
import VerifyPanel from '../components/VerifyPanel.vue'
import PreviewFrame from '../components/PreviewFrame.vue'

const highlight = ref<string | null>(null)
let highlightTimer: number | undefined
const fullscreen = ref(false)
const drawerOpen = ref(false)
const blocked = ref<BlockingItem[]>([])
const elapsed = ref(0)

const pipeline = computed<PipelineSuccess | null>(() => (state.result && state.result.status === 'ok' ? state.result : null))
const vm = computed(() => {
  const plan = currentSuccess.value
  return plan ? buildVm({ plan, meta: state.meta, mode: state.mode }) : null
})
const fullscreenHtml = computed(() => (vm.value ? renderPlan(vm.value, { appendix: false, fullscreen: true }) : ''))
const downloadTitle = computed(() => {
  if (!vm.value) return '未生成'
  if (!vm.value.exportAllowed) return '存在阻断项，请先修改文案'
  return ''
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
    message.warning('至少保留一种媒体')
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
  const result = downloadPlan(vm.value)
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
    { key: 'name', label: '③ campaign', value: draft.name ?? campaign.name, editable: true },
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
  message.info('Campaign 已更新，请重新生成')
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
          <a-button size="small" :disabled="!pipeline" @click="state.showBaseline ? restoreAi() : loadBaseline()">
            {{ state.showBaseline ? '恢复 AI 方案' : '只看基础分配' }}
          </a-button>
        </a-space>
        <p class="caption" style="margin-top: 6px">
          上次生成耗时 {{ state.lastQueryMs }} ms<template v-if="state.showBaseline"> · 当前展示基础分配（未含 AI 偏好）</template>
        </p>
      </div>

      <div class="panel-block">
        <h4>生成过程</h4>
        <StageProgress :stages="state.stages" />
      </div>

      <div class="panel-block" v-if="pipeline && state.prevSuccess">
        <h4>本次变化</h4>
        <DiffPanel :diff="state.diff" @focus="focusLine" @clear="clearCompare" />
      </div>

      <div class="panel-block">
        <AiDecisionPanel :result="pipeline" :mode="state.mode" @baseline="loadBaseline" @restore="restoreAi" />
      </div>

      <div v-if="pipeline" class="panel-block">
        <VerifyPanel :checks="pipeline.checks" :trace-count="pipeline.trace.length" @focus="focusRef" />
      </div>
    </div>

    <div class="preview-wrap">
      <StatusBanner :failure="currentFailure" />
      <div v-if="state.showBaseline" class="status-bar">
        <a-tag color="orange">基础分配</a-tag>
        本次展示为基础分配（未含 AI 偏好），用于对照 AI 参与前后的取舍差异。
        <a style="margin-left: 8px; cursor: pointer" @click="restoreAi">恢复 AI 方案</a>
      </div>
      <div class="preview-toolbar">
        <span class="spacer" style="flex: 1" />
        <a-space>
          <a-button size="small" :disabled="!vm" @click="openFullscreen">全屏演示（F）</a-button>
          <a-button type="primary" size="small" :disabled="!vm" :title="downloadTitle" @click="handleDownload">下载 HTML</a-button>
        </a-space>
      </div>
      <PreviewFrame :vm="vm" :highlight="highlight" />
    </div>

    <a-drawer v-model:open="drawerOpen" title="Campaign 需求细节" width="520">
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
        <div class="caption">⑤ 时间与预算：活动窗口 {{ drawerPreset.window.start }} ~ {{ drawerPreset.window.end }}，建议 {{ Math.round(drawerPreset.budgetHintYuan / 10000) }} 万；本次以上限 {{ workbench.budgetWan }} 万为准。</div>
        <div class="caption">⑥ 媒体范围：{{ drawerPreset.mediaScope.map(kind => kind === 'bus' ? '公交' : '地铁').join(' + ') }}</div>
        <div class="caption">⑦ 成功衡量：{{ drawerPreset.successMetric.kpi }}；{{ drawerPreset.successMetric.proof }}</div>
        <a-space>
          <a-button type="primary" @click="saveDrawer">应用</a-button>
          <a-button @click="resetDrawer">恢复行业预置</a-button>
        </a-space>
      </div>
      <p v-else class="caption">尚无行业预置。</p>
    </a-drawer>

    <div v-if="fullscreen" style="position: fixed; inset: 0; background: #fff; z-index: 20; display: flex; flex-direction: column">
      <iframe class="demo" :srcdoc="fullscreenHtml" style="flex: 1; width: 100%; border: none" title="全屏演示" sandbox="allow-same-origin" />
      <div style="position: fixed; left: 20px; bottom: 16px; font-size: 12px; color: var(--ink-3)">1–6 跳节 · PageDown/PageUp 翻节 · Esc 退出 · D 下载</div>
      <a-space style="position: fixed; right: 20px; bottom: 20px">
        <a-button @click="handleDownload" :disabled="!vm">下载（D）</a-button>
        <a-button @click="fullscreen = false">退出（Esc）</a-button>
      </a-space>
    </div>

    <div v-if="blocked.length" class="status-bar error" style="position: fixed; left: 400px; right: 0; bottom: 0; z-index: 15">
      <b>导出被拦截 {{ blocked.length }} 处</b>
      <div v-for="(item, index) in blocked" :key="index" style="margin-top: 4px">
        ✗ {{ item.element }}｜{{ item.location }}｜{{ item.message }}<template v-if="item.suggestion">　建议：{{ item.suggestion }}</template>
      </div>
      <a-space style="margin-top: 8px">
        <a-button size="small" @click="blocked = []">返回修改</a-button>
      </a-space>
    </div>
  </div>
</template>