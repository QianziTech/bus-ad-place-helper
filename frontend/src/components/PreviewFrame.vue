<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PlanVm } from '../plan/buildVm'
import { buildVm } from '../plan/buildVm'
import { renderPlan } from '../plan/renderPlan'
import { rangeData } from '../plan/range'
import { selectBudget, state } from '../state/workbench'

const props = defineProps<{ vm: PlanVm | null; highlight: string | null }>()
const zoom = ref<'fit' | '100'>('fit')
const previewRange = computed(() => state.showBaseline ? null : state.range)
/** 记录 iframe 的金额。普通预算变动通过消息同步，保留地图设置与滚动位置。 */
let iframeBudget = state.selectedYuan

function frameWindow() {
  return document.querySelector<HTMLIFrameElement>('iframe.preview')?.contentWindow || null
}

watch(previewRange, () => { iframeBudget = state.selectedYuan })
watch(() => state.selectedYuan, next => {
  if (next === iframeBudget) return
  iframeBudget = next
  const win = frameWindow()
  if (win && previewRange.value) win.postMessage({ type: 'plan-set-budget', budgetYuan: next }, '*')
})

function onMessage(event: MessageEvent) {
  if (event.data?.type !== 'plan-budget' || typeof event.data.budgetYuan !== 'number') return
  if (event.source !== frameWindow()) return
  iframeBudget = event.data.budgetYuan
  selectBudget(event.data.budgetYuan)
}

onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))

/** 全区间结果把每一档的内容内嵌进 iframe，预览里也能直接拖滑块，与导出文件同一套交互。 */
const html = computed(() => {
  const range = previewRange.value
  const vm = range ? buildVm({ plan: range.defaultPlan, meta: state.meta, mode: state.mode }) : props.vm
  if (!vm) return ''
  return renderPlan(vm, {
    highlight: props.highlight,
    appendix: false,
    ...(range ? { range: rangeData(range, state.mode), budgetYuan: iframeBudget } : {}),
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
    <div v-if="!html" class="empty-state">
      <span class="mark">▤</span>
      <div>设置投放条件，生成推荐方案</div>
      <small>查看推荐资源、排期和估算报价</small>
    </div>
    <div v-else class="doc-scale" :style="zoom === '100' ? { width: '1600px' } : { width: '100%' }" style="height: 100%">
      <!-- 本地生成的方案文档，脚本用于预算切换与离线地图。 -->
      <iframe class="preview" :srcdoc="html" title="方案预览" sandbox="allow-same-origin allow-scripts" />
    </div>
  </div>
</template>
