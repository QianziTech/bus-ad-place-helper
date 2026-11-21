 <script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { api } from '../api/client'
import { state } from '../state/workbench'
import type { PublicConfig } from '../plan/types'

const config = ref<PublicConfig | null>(null)
const form = ref({
  mode: 'mock' as PublicConfig['mode'],
  provider: 'compatible',
  baseUrl: '',
  model: '',
  timeoutMs: 8000,
  retries: 1,
  temperature: 0.2,
  apiKey: '',
  includeHistoricalProfiles: true,
})
const testing = ref(false)
const testResult = ref<{ ok: boolean; summary: string } | null>(null)
const saving = ref(false)
const loadError = ref('')

function applyConfig(next: PublicConfig) {
  config.value = next
  state.mode = next.mode
  form.value = {
    mode: next.mode,
    provider: next.llm.provider,
    baseUrl: next.llm.baseUrl,
    model: next.llm.model,
    timeoutMs: next.llm.timeoutMs,
    retries: next.llm.retries,
    temperature: next.llm.temperature,
    apiKey: '',
    includeHistoricalProfiles: next.includeHistoricalProfiles,
  }
}

onMounted(async () => {
  try {
    applyConfig(await api.config())
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '无法读取配置'
  }
})

const keyPreview = computed(() => {
  if (form.value.apiKey) return `将写入新 Key（当前末 4 位 ${config.value?.llm.keyPreview || '—'}）`
  return config.value?.llm.hasKey ? `已配置 · ${config.value.llm.keyPreview}` : '未配置密钥'
})

async function save() {
  saving.value = true
  try {
    const payload: Record<string, unknown> = {
      mode: form.value.mode,
      includeHistoricalProfiles: form.value.includeHistoricalProfiles,
      llm: {
        provider: form.value.provider,
        baseUrl: form.value.baseUrl,
        model: form.value.model,
        timeoutMs: form.value.timeoutMs,
        retries: form.value.retries,
        temperature: form.value.temperature,
        ...(form.value.apiKey ? { apiKey: form.value.apiKey } : {}),
      },
    }
    const next = await api.putConfig(payload)
    applyConfig(next)
    testResult.value = null
    message.success('已保存并热应用：下一次生成生效')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function test() {
  testing.value = true
  try {
    const result = await api.testConfig()
    if (result.ok && result.fixtures) {
      const fixtures = result.fixtures as { covered: number; total: number }
      testResult.value = { ok: true, summary: `回放覆盖 ${fixtures.covered}/${fixtures.total} 行业` }
    } else if (result.ok) {
      testResult.value = { ok: true, summary: `ok · ${result.latencyMs} ms · 模型回显 ${result.modelEcho || '—'}` }
    } else {
      testResult.value = { ok: false, summary: `${result.code || '失败'} · ${result.message || ''}` }
    }
  } catch (error) {
    testResult.value = { ok: false, summary: error instanceof Error ? error.message : '测试失败' }
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="app-page">
    <div class="page-narrow">
      <div class="page-head">
        <h2>运行配置</h2>
        <p>分析模式与模型连接持久化在服务端 data/config/runtime.json，保存即时热应用。API Key 只写不读。</p>
      </div>
      <div v-if="loadError" class="status-bar error">{{ loadError }}</div>
      <div class="entry-card">
        <h3>分析模式</h3>
        <a-radio-group v-model:value="form.mode">
          <a-radio value="off">off</a-radio>
          <a-radio value="mock">mock</a-radio>
          <a-radio value="live">live</a-radio>
        </a-radio-group>
        <p class="caption">off：仅确定性引擎与导出扫描 · mock：离线回放 · live：真实调用模型</p>
        <p v-if="form.mode === 'live'" class="caption" style="color: var(--warn)">当前为真实调用，会产生外部请求与费用。</p>
      </div>

      <div class="entry-card" style="margin-top: 14px">
        <h3>LLM 连接</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
          <label class="caption">Provider<a-input v-model:value="form.provider" size="small" /></label>
          <label class="caption">Model<a-input v-model:value="form.model" size="small" placeholder="claude-sonnet-5-5" /></label>
          <label class="caption" style="grid-column: 1 / -1">Base URL<a-input v-model:value="form.baseUrl" size="small" /></label>
          <label class="caption" style="grid-column: 1 / -1">API Key<a-input v-model:value="form.apiKey" size="small" password :placeholder="keyPreview" /></label>
          <label class="caption">超时（ms）<a-input-number v-model:value="form.timeoutMs" :min="100" :max="8000" size="small" style="width: 100%" /></label>
          <label class="caption">重试<a-input-number v-model:value="form.retries" :min="0" :max="1" size="small" style="width: 100%" /></label>
          <label class="caption">温度<a-input-number v-model:value="form.temperature" :min="0" :max="2" :step="0.1" size="small" style="width: 100%" /></label>
          <label class="caption" style="display: flex; align-items: end; gap: 8px">
            <a-checkbox v-model:checked="form.includeHistoricalProfiles">历史画像进上下文</a-checkbox>
          </label>
        </div>
        <a-space style="margin-top: 12px">
          <a-button :loading="testing" @click="test">测试连接</a-button>
          <span class="caption" :style="{ color: testResult?.ok === false ? 'var(--danger)' : 'var(--ink-3)' }">
            {{ testResult ? (testResult.ok ? '上次：' : '失败：') + testResult.summary : '尚未测试' }}
          </span>
        </a-space>
      </div>

      <div class="entry-card" style="margin-top: 14px">
        <h3>上下文边界</h3>
        <ul class="caption" style="margin: 0; padding-left: 18px; line-height: 1.9">
          <li>注入：客户代称、campaign 七要素、候选证据、本次四项输入。</li>
          <li>不注入：真实企业名与门店、API Key、其它行业数据、成交价。</li>
          <li>历史画像开关只控制该项是否进上下文；其余三项恒开。</li>
        </ul>
        <p class="caption" style="margin-top: 8px">来源：{{ config?.source || '—' }} · 更新时间 {{ config ? new Date(config.updatedAt).toLocaleString('zh-CN') : '—' }}</p>
      </div>

      <a-space style="margin-top: 14px">
        <a-button type="primary" :loading="saving" @click="save">保存</a-button>
        <a-button @click="() => { form.mode = 'mock'; form.includeHistoricalProfiles = true }">恢复环境变量默认</a-button>
      </a-space>
    </div>
  </div>
</template>
