<script setup lang="ts">
import { computed } from 'vue'
import type { Check } from '../plan/types'

const props = defineProps<{ checks: Check[]; traceCount: number }>()
const emit = defineEmits<{ (event: 'focus', ref: string): void }>()

const counts = computed(() => ({
  pass: props.checks.filter(item => item.status === 'pass').length,
  warn: props.checks.filter(item => item.status === 'warn').length,
  fail: props.checks.filter(item => item.status === 'fail').length,
}))
const icon = (status: Check['status']) => (status === 'pass' ? '✓' : status === 'warn' ? '!' : '✗')
const blocking = computed(() => props.checks.some(item => item.status === 'fail' && item.blocking))
</script>

<template>
  <a-collapse ghost size="small">
    <a-collapse-panel key="verify" :header="`核验 · ${counts.pass} 通过 · ${counts.warn} 待看 · ${counts.fail} 已阻断`">
      <p v-if="!checks.length" class="caption">本阶段只执行确定性扫描，未返回核验项。</p>
      <div v-for="(check, index) in checks" :key="`${check.element}-${index}`" class="check-row"
        style="cursor: pointer" @click="check.evidenceRefs?.length && emit('focus', check.evidenceRefs[0])">
        <span class="mark" :class="check.status">{{ icon(check.status) }}</span>
        <span style="flex: 1">
          <b>{{ check.element }}</b> {{ check.message }}
          <div v-if="check.suggestion" class="caption">建议：{{ check.suggestion }}</div>
        </span>
        <span class="caption">{{ check.evidenceRefs?.length || 0 }} 证据</span>
      </div>
      <p v-if="blocking" class="caption" style="color: var(--danger)">存在阻断项，下载已禁用。</p>
      <p class="caption" style="margin-top: 8px">追溯 AI 决策：{{ traceCount }} 条 trace，详见导出附录 S7。</p>
    </a-collapse-panel>
  </a-collapse>
</template>