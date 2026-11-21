<script setup lang="ts">
import type { StageState } from '../state/workbench'

defineProps<{ stages: StageState[] }>()

const icon = (status: StageState['status']) => {
  switch (status) {
    case 'done': return '✓'
    case 'running': return '◐'
    case 'failed': return '✗'
    case 'skipped': return '·'
    default: return '○'
  }
}
</script>

<template>
  <div class="stage-list">
    <div v-for="stage in stages" :key="stage.key" class="stage-row" :class="stage.status">
      <span class="dot">{{ icon(stage.status) }}</span>
      <span>{{ stage.label }}</span>
      <span class="detail">{{ stage.detail }}</span>
    </div>
  </div>
</template>