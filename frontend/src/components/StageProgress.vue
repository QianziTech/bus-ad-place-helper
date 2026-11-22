<script setup lang="ts">
import type { StageState } from '../state/workbench'

defineProps<{ stages: StageState[] }>()

const icon = (status: StageState['status']) => {
  switch (status) {
    case 'done': return '✓'
    case 'running': return '◐'
    case 'failed': return '✗'
    case 'degraded': return '!'
    case 'skipped': return '·'
    default: return '○'
  }
}
</script>

<template>
  <div class="stage-list">
    <div v-for="stage in stages" :key="stage.key" class="stage-row" :class="stage.status">
      <span class="dot" aria-hidden="true">{{ icon(stage.status) }}</span>
      <span class="stage-label">{{ stage.label }}</span>
      <span class="detail">{{ stage.detail || '未执行' }}</span>
      <span v-if="stage.elapsedMs > 0" class="stage-time">{{ stage.elapsedMs < 100 ? '< 0.1' : (stage.elapsedMs / 1000).toFixed(1) }} 秒</span>
    </div>
  </div>
</template>
