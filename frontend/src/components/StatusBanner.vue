<script setup lang="ts">
import { computed } from 'vue'
import { state, workbench, generate, selectBudget } from '../state/workbench'
import type { PlanFailure } from '../plan/types'
import { failureTitle } from '../plan/buildVm'
import InventoryStatus from './InventoryStatus.vue'

const props = defineProps<{ failure: PlanFailure | null }>()

const fallbackText = {
  brief: '需求提取暂不可用，已沿用现有需求。',
  strategy: 'AI 推荐暂不可用，已使用基础方案。',
  copy: 'AI 文案暂不可用，已使用模板文案。',
  verify: 'AI 检查暂不可用，已完成规则检查。',
}

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
    // 预算建议直接切到本轮已生成的档位，不重新请求。
    if (budget && state.range) {
      selectBudget(Math.round(Number(budget[1])) * 10000)
      return
    }
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
    <InventoryStatus :inventory="props.failure?.inventory" />
  </div>
  <!-- off 模式下策略与成稿按设计跳过，不算降级告警。 -->
  <div v-else-if="state.result && state.result.status === 'ok' && state.result.inventory?.billingStatus === 'pending'" class="status-bar warning">
    <a-tag color="orange">计费待确认</a-tag>
    库存已取得，但该区间计费月数尚未确认；报价按 1 个计费月参考估算，确认统一口径后再核算。
    <InventoryStatus :inventory="state.result.inventory" compact />
  </div>
  <div v-else-if="state.result && state.result.status === 'ok' && state.mode !== 'off' && state.result.degraded?.length" class="status-bar warning">
    <span v-for="item in state.result.degraded" :key="item.stage">{{ fallbackText[item.stage] }}　</span>
    <details class="caption">
      <summary>查看原因</summary>
      <div v-for="item in state.result.degraded" :key="item.stage">{{ item.reason }}</div>
    </details>
  </div>
</template>
