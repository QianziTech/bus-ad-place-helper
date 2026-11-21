<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { loadOpenApi, toolsAsMarkdown, type ApiTool } from '../api/openapi'
import { state } from '../state/workbench'
import { analysisModeText } from '../plan/buildVm'

const tools = ref<ApiTool[]>([])
const error = ref('')
const loading = ref(false)
const copied = ref(false)

async function load() {
  loading.value = true
  try {
    tools.value = await loadOpenApi()
    error.value = ''
  } catch (reason) {
    tools.value = []
    error.value = reason instanceof Error ? reason.message : '无法读取 /api/openapi.json'
  } finally {
    loading.value = false
  }
}

onMounted(load)

const groups = computed(() => {
  const order = ['engine', 'analysis', 'brief', 'config', 'docs']
  const byTag = new Map<string, ApiTool[]>()
  for (const tool of tools.value) {
    const tag = tool.tags[0] || 'docs'
    byTag.set(tag, [...(byTag.get(tag) || []), tool])
  }
  return [...byTag.entries()].sort((a, b) => {
    const ai = order.indexOf(a[0]); const bi = order.indexOf(b[0])
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
  })
})

const tagLabel: Record<string, string> = { engine: '引擎', analysis: '分析', brief: '需求', config: '配置', docs: '文档' }

function disabledAnalysis(tool: ApiTool) {
  return tool.tags.includes('analysis') && state.mode === 'off'
}

async function copyMarkdown() {
  try {
    await navigator.clipboard.writeText(toolsAsMarkdown(tools.value))
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    copied.value = false
  }
}

function openDocs() {
  window.open('/api/docs', '_blank')
}

function statusSummary(tool: ApiTool) {
  const all = tool.outputs.flatMap(item => item.statuses)
  return all.length ? `${all.join(' / ')}` : '按响应 schema 返回'
}
</script>

<template>
  <div class="app-page">
    <div class="page-narrow">
      <div class="page-head">
        <h2>接口说明</h2>
        <p>查看可用接口、输入参数和返回结果。当前：{{ analysisModeText(state.mode) }}。</p>
      </div>
      <div v-if="loading" class="caption">正在加载接口说明…</div>
      <div v-else-if="error" class="status-bar error">
        接口说明加载失败：{{ error }}
        <div class="suggestions"><a-button size="small" @click="load">重试</a-button></div>
      </div>
      <template v-else>
        <a-space style="margin-bottom: 14px">
          <a-button size="small" @click="copyMarkdown">{{ copied ? '已复制' : '复制接口清单' }}</a-button>
          <a-button size="small" @click="openDocs">在线调试</a-button>
        </a-space>
        <div v-for="[tag, list] in groups" :key="tag" class="entry-card" style="margin-bottom: 14px">
          <h3>{{ tagLabel[tag] || tag }}（{{ list.length }}）</h3>
          <a-table size="small" :data-source="list" :pagination="false" row-key="operationId"
            :columns="[
              { title: '工具名', dataIndex: 'operationId', key: 'operationId' },
              { title: '方法 + 路径', key: 'path' },
              { title: '用途', dataIndex: 'summary', key: 'summary' },
              { title: '模式约束 / 输出', key: 'mode' },
            ]">
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'path'">
                <span class="ai-pref key">{{ record.method }} {{ record.path }}</span>
              </template>
              <template v-else-if="column.key === 'mode'">
                <span :style="disabledAnalysis(record) ? 'color: var(--ink-3)' : ''">
                  {{ disabledAnalysis(record) ? '当前模式返回 disabled' : statusSummary(record) }}
                </span>
                <template v-if="record.input.length">
                  <div class="caption">输入：{{ record.input.map((field: { name: string; required: boolean; enum?: string[] }) => field.name + (field.required ? '*' : '')).join(' · ') }}</div>
                </template>
              </template>
            </template>
          </a-table>
        </div>
      </template>
    </div>
  </div>
</template>
