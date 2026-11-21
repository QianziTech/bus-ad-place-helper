<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PlanVm } from '../plan/buildVm'
import { renderPlan } from '../plan/renderPlan'

const props = defineProps<{ vm: PlanVm | null; highlight: string | null }>()
const zoom = ref<'fit' | '100'>('fit')

const html = computed(() => {
  if (!props.vm) return ''
  return renderPlan(props.vm, { highlight: props.highlight, appendix: false })
})

function scrollToSection(id: string) {
  const frame = document.querySelector<HTMLIFrameElement>('iframe.preview')
  const win = frame?.contentWindow
  if (!win) return
  win.document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const sections = [
  ['s1', '1'], ['s2', '2'], ['s3', '3'], ['s4', '4'], ['s5', '5'], ['s6', '6'],
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
      <iframe class="preview" :srcdoc="html" title="方案预览" sandbox="allow-same-origin" />
    </div>
  </div>
</template>
