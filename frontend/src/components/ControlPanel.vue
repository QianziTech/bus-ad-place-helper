<script setup lang="ts">
import { computed } from 'vue'
import dayjs, { type Dayjs } from 'dayjs'
import { message } from 'ant-design-vue'
import { workbench, state, windowVerified } from '../state/workbench'
import { localScan } from '../plan/sanitize'

const industryItems = computed(() => state.meta?.industries || [])
const presets = computed(() => state.meta?.budget.presetsYuan || [1000000, 2000000, 5000000])
const budgetWan = computed({
  get: () => workbench.budgetWan,
  set: (value: number) => { workbench.budgetWan = value },
})
const minWan = computed(() => Math.round((state.meta?.budget.minYuan || 1000000) / 10000))
const maxWan = computed(() => Math.round((state.meta?.budget.maxYuan || 5000000) / 10000))
const mediaList = computed(() => (state.meta?.media || ['bus', 'metro']).map(kind => ({
  value: kind,
  label: kind === 'bus' ? '公交车身' : '地铁出入口',
})))
const windows = computed(() => state.meta?.windows || [])
const rangeValue = computed(() => [dayjs(workbench.startDate), dayjs(workbench.endDate)])
/** 只允许在 2027 年内选日期；能选不等于能报，非已核对区间照样提交并如实返回 missing_window。 */
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
    message.warning('至少保留一种媒体')
    return
  }
  workbench.media = checked as ('bus' | 'metro')[]
}

function setBudgetWan(value: number) {
  workbench.budgetWan = Math.min(maxWan.value, Math.max(minWan.value, Math.round(value)))
}

const windowTag = computed(() => {
  if (!workbench.startDate || !workbench.endDate) return { text: '未选', color: 'default' }
  return windowVerified()
    ? { text: '已核对', color: 'success' as const }
    : { text: '待核对', color: 'warning' as const }
})

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
          @click="workbench.industry = item.id"
          @keydown.enter.prevent="workbench.industry = item.id"
        >
          <b>{{ item.name }}</b>
          <small>{{ item.client.alias }}</small>
        </div>
      </div>
      <p v-if="!industryItems.length" class="caption">{{ state.metaError || '尚无行业预置，等待后端 /api/meta。' }}</p>
      <p v-else class="caption">切换行业只改参数，不自动重算。</p>
    </section>

    <section>
      <h4>投放对象</h4>
      <a-checkbox-group :value="workbench.media" :options="mediaList" @update:value="toggleMedia" />
      <p class="caption">至少选择一种。取消最后一项会保留原值并提示。</p>
    </section>

    <section>
      <h4>预算上限</h4>
      <div class="chips">
        <span
          v-for="preset in presets"
          :key="preset"
          class="chip-btn"
          :class="{ active: budgetWan === Math.round(preset / 10000) }"
          @click="setBudgetWan(preset / 10000)"
        >{{ Math.round(preset / 10000) }} 万</span>
      </div>
      <div class="budget-row">
        <a-input-number
          v-model:value="budgetWan"
          :min="minWan"
          :max="maxWan"
          :precision="0"
          :step="5"
          addon-after="万元"
          style="width: 150px"
        />
        <a-slider
          :value="budgetWan"
          :min="minWan"
          :max="maxWan"
          :step="5"
          style="flex: 1"
          @update:value="setBudgetWan"
        />
      </div>
      <p class="caption">语义为上限：成案总额只需 ≤ 该值，允许有余量；{{ minWan }}–{{ maxWan }} 万元。</p>
    </section>

    <section>
      <h4>档期</h4>
      <div class="chips">
        <span
          v-for="win in windows"
          :key="`${win.startDate}-${win.endDate}`"
          class="chip-btn"
          :class="{ active: workbench.startDate === win.startDate && workbench.endDate === win.endDate }"
          @click="applyWindow(win.startDate, win.endDate)"
        >{{ win.startDate }} ~ {{ win.endDate.slice(5) }}（已核对）</span>
      </div>
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
      <p class="caption" style="display: flex; gap: 8px; align-items: center">
        <a-tag :color="windowTag.color">{{ windowTag.text }}</a-tag>
        <span v-if="windows.length === 0">暂无已核对完整档期的窗口，仍可提交以验证失败语义。</span>
        <span v-else>与档期完全相等才算已核对，其余标待核对。</span>
      </p>
    </section>

    <section>
      <h4>客户需求（可选）</h4>
      <a-textarea v-model:value="workbench.briefText" :rows="3" :maxlength="2000" show-count
        placeholder="粘贴 4A 邮件或一句话需求，例如「6–8 月在徐汇、静安做新品试饮」" />
      <p class="caption" :style="briefHits.length ? 'color: var(--danger)' : ''">
        <template v-if="briefHits.length">● 检测到{{ briefHits.join('、') }}，命中原文不会进入方案</template>
        <template v-else-if="state.scanHits.length">● 服务端已拦截：{{ state.scanHits.map(hit => hit.message).join('；') }}</template>
        <template v-else-if="mappingMissing">● 服务端未加载内部品牌映射，实名无法校验，请勿视为已通过</template>
        <template v-else-if="workbench.briefText.trim()">● 未检测到成交价形态；实名由服务端在提交时判定</template>
        <template v-else>有内容时随生成一起提交，仅影响 Campaign。</template>
        <a style="cursor: pointer; margin-left: 4px" @click="goBrief">去 Brief 页 →</a>
      </p>
    </section>

    <div class="caption" style="margin-top: 14px">
      库存口径：红豆 freeCount；价格口径：资料包 07 区间中值；预算为上限，允许余量。
    </div>
  </div>
</template>
