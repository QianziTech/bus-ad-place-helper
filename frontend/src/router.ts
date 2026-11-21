/** 极简 hash 路由：#/ #/brief #/settings #/api-tools，不引入 vue-router。 */
import { ref, computed } from 'vue'

const routes = ['/', '/brief', '/settings', '/api-tools'] as const
export type RoutePath = (typeof routes)[number]

const current = ref<string>(normalize(location.hash))
const listeners = new Set<(path: string) => void>()

function normalize(hash: string): string {
  const path = hash.replace(/^#/, '') || '/'
  const base = path.split('?')[0]
  return routes.includes(base as RoutePath) ? base : '/'
}

export function useRoute() {
  const path = computed<RoutePath>(() => (routes.includes(current.value as RoutePath) ? (current.value as RoutePath) : '/'))
  return { path }
}

export function navigate(path: RoutePath) {
  if (location.hash === `#${path}`) return
  location.hash = path
}

function sync() {
  current.value = normalize(location.hash)
  for (const listener of listeners) listener(current.value)
}

export function startRouter() {
  window.addEventListener('hashchange', sync)
  if (!location.hash) history.replaceState(null, '', '#/')
  sync()
}

export function onRoute(listener: (path: string) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
