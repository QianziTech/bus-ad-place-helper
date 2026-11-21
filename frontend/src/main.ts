import { createApp } from 'vue'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import App from './App.vue'
import { startRouter } from './router'
import './styles.css'

startRouter()
createApp(App).use(Antd).mount('#app')