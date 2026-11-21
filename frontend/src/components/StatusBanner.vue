<script setup lang="ts">
import { computed } from 'vue'
import { state, workbench, generate } from '../state/workbench'
import type { PlanFailure } from '../plan/types'
import { failureTitle } from '../plan/buildVm'

defineProps<{ failure: PlanFailure | null }>()

const alertType = computed(() => {
  if (state.networkError) return 'error'
  const status = state.result && state.result.status !== 'ok' ? state.result.status : null
  return status === 'over_budget' ? 'error' : 'warning'
})

/** 建议按钮按关键字映射到参数，例如「改为仅地铁」「提高预算上限至 X 万」。 */
function applySuggestion(text: string) {
  if (/仅地铁|只投地铁/.test(text)) {
    workbench.media = ['metro']
  } else if (/仅公交|只投公交|单一公交/.test(text)) {
    workbench.media = ['bus']
  } else {
    const budget = text.match(/(\d+(?:\.\d+)?)\s*万/)
    if (budget) workbench.budgetWan = Math.round(Number(budget[1]))
  }
  if (state.meta?.windows[0]) {
    workbench.startDate = state.meta.windows[0].startDate
    workbench.endDate = state.meta.windows[0].endDate
  }
  void generate()
}
</script>

<template>
  <div v-if="state.scanHits.length" class="status-bar error">
    <b>客户需求含需替换表述：</b>原文已保留，请按建议修改后重新生成。
    <div v-for="(hit, index) in state.scanHits" :key="index" style="margin-top: 4px">
      ✗ {{ hit.element }}｜{{ hit.message }}<template v-if="hit.suggestion">　建议：{{ hit.suggestion }}</template>
    </div>
  </div>
  <div v-else-if="state.networkError" class="status-bar error">
    <b>请求失败：</b>{{ state.networkError }}
    <div class="suggestions">
      <a-button size="small" @click="generate">重试</a-button>
    </div>
  </div>
  <div v-else-if="failure" class="status-bar" :class="alertType === 'error' ? 'error' : 'warning'">
    <b>{{ failureTitle(failure.status) }}：</b>{{ failure.message }}
    <div class="suggestions">
      <a-button v-for="suggestion in failure.suggestions" :key="suggestion" size="small" @click="applySuggestion(suggestion)">{{ suggestion }}</a-button>
      <a-tag v-for="win in state.meta?.windows || []" :key="`${win.startDate}${win.endDate}`" :bordered="false" style="cursor: pointer"
        @click="() => { workbench.startDate = win.startDate; workbench.endDate = win.endDate; generate() }">{{ win.startDate }} ~ {{ win.endDate }}</a-tag>
    </div>
  </div>
  <!-- off 模式下策略与成稿按设计跳过，不算降级告警。 -->
  <div v-else-if="state.result && state.result.status === 'ok' && state.mode !== 'off' && state.result.degraded?.length" class="status-bar warning">
    <a-tag color="orange">AI 已降级</a-tag>
    <span v-for="item in state.result.degraded" :key="item.stage">{{ item.stage }}：{{ item.reason }}　</span>
    <span class="caption">方案照常可读可导出。</span>
  </div>
</template>