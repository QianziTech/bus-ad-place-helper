<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PlanVm } from '../plan/buildVm'
import { renderPlan } from '../plan/renderPlan'
import { initialBudget, rangeData } from '../plan/range'
import { selectBudget, state } from '../state/workbench'

const props = defineProps<{ vm: PlanVm | null; highlight: string | null }>()
const zoom = ref<'fit' | '100'>('fit')
/** 文档内的当前金额；切换由 iframe 自己完成，外层不重建 srcdoc，避免拖动时整页重载。 */
const documentBudget = ref(state.selectedYuan)
/** 最近一次由 iframe 上报的金额；外层同步时用它避免回环。 */
let iframeBudget = state.selectedYuan

function frameWindow() {
  return document.querySelector<HTMLIFrameElement>('iframe.preview')?.contentWindow || null
}

// 新一代结果或初始金额变化时才重建文档；文档内拖动不触发。
watch(() => state.range, range => { documentBudget.value = range ? initialBudget(range) : state.selectedYuan; iframeBudget = documentBudget.value })
watch(() => state.selectedYuan, next => {
  if (next === iframeBudget) return
  iframeBudget = next
  // 外层（侧栏建议、基础方案切换）改金额：让文档自己切，不重载。
  const win = frameWindow()
  if (win && state.range) win.postMessage({ type: 'plan-set-budget', budgetYuan: next }, '*')
  else documentBudget.value = next
})

function onMessage(event: MessageEvent) {
  if (event.data?.type !== 'plan-budget' || typeof event.data.budgetYuan !== 'number') return
  if (event.source !== frameWindow()) return
  iframeBudget = event.data.budgetYuan
  // 文档内切换后也记录当前金额，外层若因此重建文档（重生成等）能从同一档位继续。
  documentBudget.value = event.data.budgetYuan
  selectBudget(event.data.budgetYuan)
}

onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))

/** 全区间结果把每一档的内容内嵌进 iframe，预览里也能直接拖滑块，与导出文件同一套交互。 */
const html = computed(() => {
  if (!props.vm) return ''
  return renderPlan(props.vm, {
    highlight: props.highlight,
    appendix: false,
    ...(state.range ? { range: rangeData(state.range, state.mode), budgetYuan: documentBudget.value } : {}),
  })
})

function scrollToSection(id: string) {
  const win = frameWindow()
  if (!win) return
  win.document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const sections = [
  ['s1', '1'], ['s2', '2'], ['s3', '3'], ['s4', '4'], ['s5', '5'], ['s6', '6'], ['s7map', '7'],
] as const
</script>

<template>
  <div class="preview-toolbar">
    <span class="caption">缩放</span>
    <a-radio-group v-model:value="zoom" size="small" button-style="solid">
      <a-radio-button value="fit">适配</a-radio-button>
      <a-radio-button value="100">100%</a-radio-button>
    </a-radio-group>
    <span class="caption">章节</span>
    <a-space size="small">
      <a-button v-for="[id, label] in sections" :key="id" size="small" @click="scrollToSection(id)">{{ label }}</a-button>
    </a-space>
    <span class="spacer" style="flex: 1" />
  </div>
  <div class="preview-frame">
    <div v-if="!vm" class="empty-state">
      <span class="mark">▤</span>
      <div>设置投放条件，生成推荐方案</div>
      <small>查看推荐资源、排期和估算报价</small>
    </div>
    <div v-else class="doc-scale" :style="zoom === '100' ? { width: '1600px' } : { width: '100%' }" style="height: 100%">
      <!-- 内容是本地生成的方案文档（文案已转义），放行脚本只为预算滑块交互。 -->
      <iframe class="preview" :srcdoc="html" title="方案预览" sandbox="allow-same-origin allow-scripts" />
    </div>
  </div>
</template>