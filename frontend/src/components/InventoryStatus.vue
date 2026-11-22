<script setup lang="ts">
/** 档期库存状态：来源、查询时间、周截面参考与计费口径。工作台与失败提示共用。 */
import { computed } from 'vue'
import type { InventoryDetail } from '../plan/types'
import { dateTimeText, windowText } from '../plan/buildVm'

const props = defineProps<{ inventory: InventoryDetail | null | undefined; compact?: boolean }>()

const kindLabel = (kind: string) => (kind === 'bus' ? '公交' : '地铁')
const sourceColor: Record<string, string> = { hongdou: 'green', archive: 'blue', snapshot: 'orange', missing: 'red' }
const billingText = computed(() => {
  const detail = props.inventory
  if (!detail) return ''
  if (detail.billingStatus === 'pending') return '计费口径待确认'
  return `${detail.billingMonths ?? '—'} 个计费月`
})
const previewRows = computed(() => props.inventory?.preview || [])
const hasSnapshot = computed(() => Boolean(props.inventory?.kinds.some(item => item.source === 'snapshot')))
</script>

<template>
  <div v-if="inventory" class="inventory-status" :class="{ compact }">
    <div class="inventory-line">
      <b>{{ windowText(inventory.startDate, inventory.endDate) }}</b>
      <span class="caption">{{ billingText }}</span>
      <a-tag v-if="hasSnapshot" color="orange">周截面参考 · 整段库存待核对</a-tag>
    </div>
    <div v-for="kind in inventory.kinds" :key="kind.kind" class="inventory-kind">
      <a-tag :color="sourceColor[kind.source] || 'default'">{{ kindLabel(kind.kind) }} · {{ kind.sourceLabel }}</a-tag>
      <span v-if="kind.queriedAt" class="caption">查询于 {{ dateTimeText(kind.queriedAt) }}</span>
      <span v-else-if="kind.sampleDates?.length" class="caption">采样日 {{ kind.sampleDates.join('、') }}</span>
      <span v-if="kind.reason" class="caption inventory-reason">{{ kind.reason }}</span>
    </div>
    <table v-if="previewRows.length && !compact" class="inventory-preview">
      <thead><tr><th>媒体</th><th>类别</th><th class="num">参考空位</th><th>采样日</th></tr></thead>
      <tbody>
        <tr v-for="row in previewRows" :key="row.mediaKey">
          <td>{{ row.name }}<template v-if="row.mediaForm || row.exit"> · {{ row.mediaForm || row.exit }}</template></td>
          <td>{{ kindLabel(row.kind) }}</td>
          <td class="num">{{ row.freeCount === null ? '缺样' : row.freeCount }}</td>
          <td class="caption">{{ row.sampleDates?.length ? row.sampleDates.join('、') : '无有效采样' }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="hasSnapshot && !compact" class="caption">
      周截面来自周一采样，用于参考排期。各周实际空位及计费需在签约前核对。
    </p>
  </div>
</template>
