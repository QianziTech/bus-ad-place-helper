<script setup lang="ts">
import { computed, onMounted } from 'vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import { loadConfig, loadMeta, industryMeta, state } from './state/workbench'
import { useRoute } from './router'
import { analysisModeText, dateTimeText } from './plan/buildVm'
import WorkbenchView from './views/WorkbenchView.vue'
import BriefView from './views/BriefView.vue'
import SettingsView from './views/SettingsView.vue'
import ToolsView from './views/ToolsView.vue'

const theme = {
  token: {
    colorPrimary: '#0e5c63',
    colorInfo: '#0e5c63',
    colorWarning: '#a8751a',
    colorError: '#a6382e',
    colorSuccess: '#2f7a4f',
    colorText: '#1a1d21',
    colorTextSecondary: '#5b6470',
    colorBorder: '#e3e6ea',
    borderRadius: 6,
    fontFamily: '"PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
    fontSize: 14,
    controlHeight: 40,
  },
  components: {
    Button: { primaryShadow: 'none' },
    Slider: { railSize: 4 },
  },
}

const { path } = useRoute()
const modeColor = computed(() => (state.mode === 'off' ? 'default' : state.mode === 'mock' ? 'blue' : 'green'))

onMounted(async () => {
  await Promise.all([loadMeta(), loadConfig()])
})

const tabs = [
  { key: '/', label: '工作台' },
  { key: '/brief', label: '客户需求' },
  { key: '/settings', label: '运行配置' },
  { key: '/api-tools', label: '接口说明' },
] as const
const go = (key: string) => { location.hash = key }
</script>

<template>
  <a-config-provider :locale="zhCN" :theme="theme">
    <div class="app-shell">
      <a class="visually-hidden" href="#s1">跳到方案内容</a>
      <header class="app-bar">
        <span class="brand">动线运筹 · 提案工作台</span>
        <span class="meta-line">
          {{ industryMeta()?.name || '' }}<template v-if="state.result && state.result.status === 'ok'"> · 已生成 · 库存核对 {{ dateTimeText(state.result.queriedAt) }}</template>
        </span>
        <span class="spacer" />
        <a-space size="middle">
          <a-button v-for="tab in tabs" :key="tab.key" type="link" size="small"
            :style="{ fontWeight: path === tab.key ? 650 : 400, color: path === tab.key ? 'var(--primary)' : 'var(--ink-3)' }"
            @click="go(tab.key)">{{ tab.label }}</a-button>
          <a-tag :color="modeColor" style="cursor: pointer" @click="go('/settings')">{{ analysisModeText(state.mode) }}</a-tag>
        </a-space>
      </header>
      <div class="app-body">
        <WorkbenchView v-if="path === '/'" />
        <BriefView v-else-if="path === '/brief'" />
        <SettingsView v-else-if="path === '/settings'" />
        <ToolsView v-else />
      </div>
    </div>
  </a-config-provider>
</template>
