<script setup lang="ts">
import { computed } from 'vue'
import type { Dayjs } from 'dayjs'
import { message } from 'ant-design-vue'
import { workbench, state, chooseIndustry } from '../state/workbench'
import { localScan } from '../plan/sanitize'

const industryItems = computed(() => state.meta?.industries || [])
const mediaList = computed(() => (state.meta?.media || ['bus', 'metro']).map(kind => ({
  value: kind,
  label: kind === 'bus' ? '公交车身' : '地铁出入口',
})))
const rangeValue = computed<[string, string] | undefined>(() =>
  workbench.startDate && workbench.endDate ? [workbench.startDate, workbench.endDate] : undefined)
const disabledDate = (current: Dayjs) => current.year() !== 2027
const briefHits = computed(() => localScan(workbench.briefText))
/** 服务端没加载内部品牌映射时，扫描命中恒为零，不能显示成「未检测到实名」。 */
const mappingMissing = computed(() => {
  const result = state.result
  if (!result || result.status !== 'ok') return false
  return result.checks.some(check => check.element === '实名扫描' && check.status === 'warn' && /品牌映射/.test(check.message))
})

function toggleMedia(checked: string[]) {
  if (!checked.length) {
    message.warning('请至少选择一种媒体')
    return
  }
  workbench.media = checked as ('bus' | 'metro')[]
}

function goBrief() {
  location.hash = '/brief'
}

function applyWindow(start: string, end: string) {
  workbench.startDate = start
  workbench.endDate = end
}

</script>

<template>
  <div class="param-body">
    <section>
      <h4>行业</h4>
      <div class="industry-grid">
        <div
          v-for="item in industryItems"
          :key="item.id"
          class="industry-card"
          :class="{ active: workbench.industry === item.id }"
          role="radio"
          :aria-checked="workbench.industry === item.id"
          :tabindex="0"
          @click="item.id !== workbench.industry && chooseIndustry(item.id)"
          @keydown.enter.prevent="item.id !== workbench.industry && chooseIndustry(item.id)"
        >
          <b>{{ item.name }}</b>
          <small>{{ item.client.alias }}</small>
        </div>
      </div>
      <p v-if="!industryItems.length" class="caption">{{ state.metaError ? '行业资料加载失败，请刷新重试。' : '正在加载行业资料…' }}</p>
    </section>

    <section>
      <h4>投放媒体</h4>
      <a-checkbox-group :value="workbench.media" :options="mediaList" @update:value="toggleMedia" />
      <p class="caption">预算在生成后于成品卷首拖动切换，100–500 万元按 1 万元推演。</p>
    </section>

    <section>
      <h4>投放档期</h4>
      <a-range-picker
        :value="rangeValue"
        value-format="YYYY-MM-DD"
        format="YYYY-MM-DD"
        :allow-clear="false"
        :disabled-date="disabledDate"
        style="width: 100%"
        :placeholder="['开始日期', '结束日期']"
        @update:value="(v: [string, string] | null) => v && applyWindow(v[0], v[1])"
      />
      <p class="caption">生成时按起止日期查询整段库存，可用本地周截面时会提示确认。</p>
    </section>

    <section>
      <h4>补充需求（可选）</h4>
      <a-textarea v-model:value="workbench.briefText" :rows="3" :maxlength="2000" show-count
        placeholder="例如：重点覆盖徐汇商圈，面向通勤人群" />
      <p class="caption" :style="briefHits.length ? 'color: var(--danger)' : ''">
        <template v-if="briefHits.length">请修改以下表述：{{ briefHits.join('、') }}。</template>
        <template v-else-if="state.scanHits.length">请按提示修改后重新生成。</template>
        <template v-else-if="mappingMissing">客户实名尚未完成检查，请使用客户代称。</template>
        <a style="cursor: pointer; margin-left: 4px" @click="goBrief">整理完整需求 →</a>
      </p>
    </section>
  </div>
</template>
