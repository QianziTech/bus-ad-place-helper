<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api, type HongdouConnection } from '../api/client'

const connection = ref<HongdouConnection | null>(null)
const form = reactive({ username: '', password: '' })
const busy = ref(false)
const error = ref('')

const canConnect = computed(() => Boolean(form.username.trim() && form.password.trim()))
const statusText = computed(() => {
  if (!connection.value) return busy.value ? '正在读取状态' : '状态读取失败'
  if (connection.value.forceOffline) return '服务器已关闭实时查询'
  if (connection.value.source === 'session') return 'OAuth 已登录'
  if (connection.value.source === 'environment') return '已配置服务器凭据'
  return '未登录'
})

async function updateConnection(action: () => Promise<HongdouConnection>) {
  busy.value = true
  error.value = ''
  try {
    connection.value = await action()
    form.password = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法连接红豆'
  } finally {
    busy.value = false
  }
}

function connect() {
  if (busy.value || !canConnect.value) return
  void updateConnection(() => api.connectHongdou({ ...form }))
}

onMounted(() => updateConnection(api.hongdouConnection))
</script>

<template>
  <section class="entry-card" aria-labelledby="hongdou-title">
    <div class="connection-heading">
      <h3 id="hongdou-title">红豆档期库存</h3>
      <a-tag :color="connection?.online ? 'green' : 'default'" role="status">{{ statusText }}</a-tag>
    </div>
    <p v-if="connection?.online">生成方案时按所选起止日查询实时库存，查询失败时读取同档期归档或展示周截面参考。</p>
    <p v-else-if="connection?.forceOffline">当前使用本地库存资料。</p>
    <p v-else-if="connection">当前使用本地库存资料。登录后，生成方案时会查询实时档期。</p>
    <div v-if="error" class="connection-error caption" role="alert">{{ error }}</div>
    <a-button v-if="!connection && !busy" @click="updateConnection(api.hongdouConnection)">重试读取状态</a-button>
    <template v-else-if="connection && !connection.forceOffline">
      <a-button v-if="connection.source === 'session'" :loading="busy" @click="updateConnection(api.disconnectHongdou)">退出红豆登录</a-button>
      <form v-else @submit.prevent="connect" autocomplete="off">
        <div class="connection-fields">
          <label class="caption">红豆账号<a-input v-model:value="form.username" autocomplete="username" :disabled="busy" /></label>
          <label class="caption">红豆密码<a-input-password v-model:value="form.password" autocomplete="current-password" :disabled="busy" /></label>
        </div>
        <div class="connection-actions">
          <a-button type="primary" html-type="submit" :disabled="!canConnect" :loading="busy">通过 OAuth 登录红豆</a-button>
          <span class="caption">后端重启后需重新登录。</span>
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
.connection-heading, .connection-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.connection-heading { margin-bottom: 6px; }
.connection-heading h3 { margin: 0; }
.connection-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  gap: 12px;
}
.connection-fields label { display: grid; gap: 4px; }
.connection-actions { margin-top: 12px; }
.connection-error { color: var(--danger); margin-bottom: 8px; }
</style>
