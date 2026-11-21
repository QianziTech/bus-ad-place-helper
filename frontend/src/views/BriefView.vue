<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { api, ApiError } from '../api/client'
import { state, workbench, industryMeta, setCampaignOverride, loadMeta } from '../state/workbench'
import { localScan } from '../plan/sanitize'
import { analysisModeText } from '../plan/buildVm'
import type { BriefResult, CampaignOverride, BriefSample, Check } from '../plan/types'

const samples = ref<BriefSample[]>([])
const selected = ref<string>('')
const text = ref('')
const parsing = ref(false)
const result = ref<BriefResult | null>(null)
const localHits = ref<string[]>([])
const scanHits = ref<Pick<Check, 'element' | 'message' | 'suggestion'>[]>([])
const missing = computed(() => result.value?.missing || [])
const draft = ref<CampaignOverride>({})

const industryOptions = computed(() => (state.meta?.industries || []).map(item => ({ value: item.id, label: item.name })))
const preset = computed(() => industryMeta()?.campaign)

async function loadSamples() {
  try {
    const response = await api.briefSamples()
    samples.value = response.samples.map(item => ({ industry: item.industry as BriefSample['industry'], title: item.title, text: item.text }))
    if (samples.value.length) selectSample(samples.value[0])
  } catch (error) {
    message.warning(error instanceof Error ? error.message : '无法读取参考需求')
  }
}

function selectSample(sample: BriefSample) {
  selected.value = sample.title
  text.value = sample.text
  workbench.industry = sample.industry
  runLocalScan()
}

/** 本地扫描只看成交价与单价形态；实名由服务端在提交时扫描（黑名单不进前端产物）。 */
function runLocalScan() {
  localHits.value = localScan(text.value)
  scanHits.value = []
}

watch(text, runLocalScan)

async function parse() {
  if (!text.value.trim()) {
    message.warning('请先粘贴或填写客户需求')
    return
  }
  if (localHits.value.length) {
    message.error('原文含需替换表述，请先修改')
    return
  }
  parsing.value = true
  scanHits.value = []
  try {
    const response = (await api.parseBrief({ text: text.value, industry: workbench.industry })) as unknown as BriefResult
    result.value = response
    draft.value = { ...(response.campaignDraft || {}) }
    if (response.status === 'disabled') message.info('当前未开启 AI，可使用行业参考需求')
    else if (response.status === 'unavailable') message.warning(response.reason || '暂时无法提取需求，可使用行业参考需求')
  } catch (error) {
    if (error instanceof ApiError && error.scanChecks.length) {
      // 入口拦截：服务端 400 附 checks[]，保留原文供修改。
      scanHits.value = error.scanChecks
      return
    }
    const detail = error instanceof Error ? error.message : '需求提取失败'
    message.error(detail)
  } finally {
    parsing.value = false
  }
}

const rows = computed(() => {
  const campaign = preset.value
  if (!campaign) return []
  const current = draft.value
  const source = (key: keyof CampaignOverride) => {
    if ((current as Record<string, unknown>)[key] !== undefined) return { text: '需求提取', color: 'green' }
    return { text: '行业预置', color: 'default' }
  }
  const items = [
    { key: 'name' as const, label: '③ 投放活动', value: current.name ?? campaign.name },
    { key: 'businessGoal' as const, label: '② 生意目标', value: current.businessGoal ?? campaign.businessGoal },
    { key: 'primaryGoal' as const, label: '③ 主目标', value: current.primaryGoal ?? campaign.primaryGoal },
    { key: 'audience' as const, label: '④ 人群', value: current.audience ?? campaign.audience },
    { key: 'window' as const, label: '⑤ 建议档期', value: `${(current.window ?? campaign.window).start} ~ ${(current.window ?? campaign.window).end}` },
    { key: 'budgetHintYuan' as const, label: '⑤ 建议预算', value: `${Math.round((current.budgetHintYuan ?? campaign.budgetHintYuan) / 10000)} 万` },
    { key: 'successMetric' as const, label: '⑦ 效果衡量', value: (() => { const metric = current.successMetric ?? campaign.successMetric; return `${metric.kpi}；${metric.proof}` })() },
  ]
  return items.map(item => ({ ...item, source: source(item.key) }))
})

function applyDate() {
  const win = draft.value.window ?? preset.value?.window
  if (!win) return
  workbench.startDate = win.start
  workbench.endDate = win.end
  message.success('已采纳建议档期')
}

function applyBudget() {
  const budget = draft.value.budgetHintYuan ?? preset.value?.budgetHintYuan
  if (!budget) return
  workbench.budgetWan = Math.round(budget / 10000)
  message.success('已采纳建议预算')
}

function applyToWorkbench() {
  const merged: Record<string, unknown> = { ...draft.value }
  if (!Object.keys(merged).length) {
    setCampaignOverride(undefined)
  } else {
    setCampaignOverride(merged as CampaignOverride)
  }
  location.hash = '/'
  message.success('需求已应用，请生成方案')
}

onMounted(async () => {
  if (!state.meta) await loadMeta()
  await loadSamples()
})
</script>

<template>
  <div class="app-page">
    <div class="page-narrow">
      <div class="page-head">
        <h2>客户需求</h2>
        <p>从客户来信中提取投放目标、人群和活动要求。</p>
      </div>
      <div style="display: grid; grid-template-columns: 58fr 42fr; gap: 20px; align-items: start">
        <div class="entry-card">
          <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 10px">
            <span class="caption">行业</span>
            <a-select v-model:value="workbench.industry" :options="industryOptions" size="small" style="width: 140px" />
            <span class="caption">样本</span>
            <a-select :value="selected" :options="samples.map(item => ({ value: item.title, label: item.title }))" size="small" style="flex: 1"
              placeholder="选择参考需求" @update:value="(title: string) => { const s = samples.find(i => i.title === title); if (s) selectSample(s) }" />
            <a-button size="small" @click="() => { selected = '自拟'; text = '' }">自拟</a-button>
          </div>
          <a-textarea v-model:value="text" :rows="14" :maxlength="2000" show-count
            placeholder="粘贴客户来信，或填写投放需求" />
          <p class="caption" :style="scanHits.length ? 'color: var(--danger)' : ''">
            <template v-if="scanHits.length">
              请修改以下 {{ scanHits.length }} 处表述：
              <span v-for="(hit, index) in scanHits" :key="index" style="display:block">{{ hit.element }}：{{ hit.message }}<template v-if="hit.suggestion">，{{ hit.suggestion }}</template></span>
            </template>
            <template v-else-if="localHits.length">请修改以下表述后重试：{{ localHits.join('、') }}</template>
            <template v-else>请使用客户代称，勿填写真实成交价。</template>
          </p>
          <a-space style="margin-top: 8px">
            <a-button type="primary" :loading="parsing" @click="parse">提取需求</a-button>
            <a-tag color="blue">{{ analysisModeText(state.mode) }}</a-tag>
          </a-space>
        </div>

        <div class="entry-card">
          <h3>投放需求草稿</h3>
          <div v-for="row in rows" :key="row.key" style="padding: 8px 0; border-top: 1px solid var(--line)">
            <div class="caption">{{ row.label }} <a-tag :color="row.source.color" style="margin-left: 6px">{{ row.source.text }}</a-tag></div>
            <div style="font-size: 13px">{{ row.value }}</div>
          </div>
          <div v-if="rows.length" style="margin-top: 10px">
            <a-space wrap>
              <a-button size="small" @click="applyDate">使用建议档期</a-button>
              <a-button size="small" @click="applyBudget">使用建议预算</a-button>
            </a-space>
          </div>
          <p v-if="missing.length" class="caption" style="margin-top: 10px; color: var(--warn)">还差 {{ missing.length }} 项：{{ missing.join('、') }}（将沿用行业预置）</p>
          <p v-else-if="result" class="caption" style="margin-top: 10px; color: var(--ok)">七要素已覆盖，可直接应用到工作台。</p>
          <p v-if="!rows.length" class="caption">暂无行业参考需求。</p>
          <a-button block type="primary" style="margin-top: 14px" :disabled="!rows.length" @click="applyToWorkbench">应用到工作台 →</a-button>
          <p class="caption" style="margin-top: 8px">应用后可在工作台查看需求细节。预算与档期仅在点击上方按钮后更新。</p>
        </div>
      </div>
    </div>
  </div>
</template>
