<script setup lang="ts">
import { computed } from 'vue'
import type { PipelineSuccess, StrategyPreference, RejectionReason } from '../plan/types'

const props = defineProps<{ result: PipelineSuccess | null; mode: 'off' | 'mock' | 'live' }>()
const emit = defineEmits<{ (event: 'baseline'): void; (event: 'restore'): void }>()

const reasonText: Record<RejectionReason, string> = {
  unknown_media: '未知媒体',
  no_stock: '无库存',
  over_budget: '超预算',
  premium_exceeded: '溢价超限',
  invalid_evidence: '证据无效',
}

const prefs = computed<StrategyPreference[]>(() => props.result?.strategyPreferences || [])
const rejectedCount = computed(() => prefs.value.filter(item => item.disposition?.startsWith('rejected:')).length)
const rounds = computed(() => props.result?.rounds || [])
const windowFitLabel: Record<string, string> = { aligned: '对齐', risk: '风险', unknown: '待确认' }
const title = computed(() => {
  if (!props.result) return 'AI 决策'
  const roundsText = rounds.value.length > 1 ? ` · ${rounds.value.length} 轮` : ''
  const status = props.mode === 'off' ? '未开启' : props.mode === 'mock' ? '回放' : '已参与'
  return `AI 决策 · ${props.mode}${roundsText} · ${status}`
})
</script>

<template>
  <a-collapse ghost size="small">
    <a-collapse-panel key="ai" :header="title">
      <template v-if="mode === 'off'">
        <p class="caption">当前模式未开启 AI 分析，方案为基础分配 + 模板文案。</p>
      </template>
      <template v-else-if="!result">
        <p class="caption">生成本轮方案后显示偏好与处置。</p>
      </template>
      <template v-else>
        <p v-if="result.mediaObjective" style="font-size: 13px; margin: 0 0 8px"><b>媒体任务</b> {{ result.mediaObjective }}</p>
        <div class="caption" style="margin-bottom: 4px">偏好排序 · 被拒 {{ rejectedCount }}</div>
        <div v-for="(item, index) in prefs" :key="item.mediaKey" class="ai-pref">
          <span class="idx">{{ index + 1 }}</span>
          <span style="flex: 1; min-width: 0">
            <span style="display: block">{{ item.reason }}</span>
            <span class="key">{{ item.mediaKey }} · 证据 {{ item.evidenceRefs.length }}</span>
          </span>
          <span class="disp" :class="item.disposition === 'accepted' ? 'ok' : 'no'">
            {{ item.disposition === 'accepted' ? '✓ 已分配' : item.disposition?.startsWith('rejected:') ? `✗ ${reasonText[item.disposition.slice(9) as RejectionReason] || '已拒'}` : '— 未采纳' }}
          </span>
        </div>
        <p v-if="!prefs.length" class="caption">本轮没有有效偏好，引擎按基础顺序分配。</p>

        <div v-if="result.windowFit" class="caption" style="margin-top: 10px">
          <b>档期贴合</b>
          <a-tag :color="result.windowFit.status === 'risk' ? 'orange' : result.windowFit.status === 'aligned' ? 'green' : 'default'" style="margin-left: 6px">{{ windowFitLabel[result.windowFit.status] || result.windowFit.status }}</a-tag>
          {{ result.windowFit.reason }}
        </div>
        <div v-if="result.measurement" class="caption" style="margin-top: 6px">
          <b>衡量建议</b> {{ result.measurement.kpi }}；{{ result.measurement.proof }}
        </div>

        <div v-if="rounds.length > 1" class="caption" style="margin-top: 10px">
          <b>回环记录</b>
          <div v-for="round in rounds" :key="round.round">
            第 {{ round.round }} 轮 · 候选 {{ round.candidateCount }} · 采纳 {{ round.acceptedCount }} · {{ Math.round(round.elapsedMs) }} ms{{ round.requestReplan ? ' · 触发重排' : ' · 收敛' }}
          </div>
        </div>

        <a-space style="margin-top: 12px" wrap>
          <a-button size="small" @click="emit('baseline')">只看基础分配</a-button>
          <a-button size="small" type="link" @click="emit('restore')">恢复 AI 方案</a-button>
        </a-space>
      </template>
    </a-collapse-panel>
  </a-collapse>
</template>