<script setup lang="ts">
import type { DiffEntry } from '../plan/buildVm'

defineProps<{ diff: DiffEntry[]; mode?: 'regen' | 'baseline' }>()
const emit = defineEmits<{ (event: 'focus', key: string): void; (event: 'clear'): void }>()

const sign = (type: DiffEntry['type']) => (type === 'added' ? '+' : type === 'removed' ? '−' : '±')
const summary = (diff: DiffEntry[]) => ({
  added: diff.filter(item => item.type === 'added').length,
  removed: diff.filter(item => item.type === 'removed').length,
  changed: diff.filter(item => item.type === 'changed').length,
})
</script>

<template>
  <div>
    <div class="caption" v-if="diff.length">
      新增 {{ summary(diff).added }} · 移除 {{ summary(diff).removed }} · 数量变化 {{ summary(diff).changed }}
      <a style="float: right; cursor: pointer" @click="emit('clear')">清除对比</a>
    </div>
    <div class="diff-list">
      <div v-for="item in diff.slice(0, 10)" :key="item.mediaKey" class="diff-line" style="cursor: pointer"
        @click="emit('focus', item.mediaKey)">
        <span class="sign" :class="item.type">{{ sign(item.type) }}</span>
        <span class="name">{{ item.kind === 'bus' ? '公交' : '地铁' }} {{ item.name }} · {{ item.variant }} <span class="nums">{{ item.levelName }}</span></span>
        <span class="nums">{{ item.before }} → {{ item.after }}</span>
      </div>
    </div>
    <p v-if="diff.length > 10" class="caption">查看全部 {{ diff.length }} 项：切换到方案文档逐行核对。</p>
    <p v-if="!diff.length" class="caption">
      {{ mode === 'baseline' ? '本次 AI 偏好未改变任何一行的数量：AI 只做了媒体分工判断，分配仍按规则顺序。' : '本次与上一次成功结果没有差异。' }}
    </p>
  </div>
</template>