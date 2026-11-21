import type { Meta, PipelineResponse, PublicConfig } from '../plan/types'

export class ApiError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) {
    super(message)
  }

  /** 入口拦截（HTTP 400）返回的确定性扫描结果：实名 / 成交价命中及替换建议。 */
  get scanChecks(): ScanHit[] {
    const body = this.body
    if (this.status !== 400 || !body || typeof body !== 'object' || !('checks' in body)) return []
    const checks = (body as { checks: unknown }).checks
    return Array.isArray(checks) ? (checks as ScanHit[]) : []
  }
}

export interface ScanHit {
  element: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  location?: string
  suggestion?: string
}

type PlanJob =
  | { status: 'running' }
  | { status: 'completed'; result: PipelineResponse }
  | { status: 'failed'; message: string }

async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    signal,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  const text = await response.text()
  let body: unknown = undefined
  if (text) {
    try { body = JSON.parse(text) } catch { body = text }
  }
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'message' in body ? String((body as { message: unknown }).message) : `HTTP ${response.status}`
    throw new ApiError(detail, response.status, body)
  }
  return body as T
}

export const api = {
  meta(signal?: AbortSignal) {
    return request<Meta>('/meta', { method: 'GET' }, signal)
  },
  async generate(body: Record<string, unknown>, signal?: AbortSignal): Promise<PipelineResponse> {
    const { id } = await request<{ id: string }>('/plan/jobs', { method: 'POST', body: JSON.stringify(body) }, signal)
    for (;;) {
      const job = await request<PlanJob>(`/plan/jobs/${encodeURIComponent(id)}`, {}, signal)
      if (job.status === 'completed') return job.result
      if (job.status === 'failed') throw new ApiError(job.message)
      await new Promise(resolve => window.setTimeout(resolve, 1000))
    }
  },
  plan(body: Record<string, unknown>, signal?: AbortSignal) {
    return request<PipelineResponse>('/plan', { method: 'POST', body: JSON.stringify(body) }, signal)
  },
  verify(body: Record<string, unknown>) {
    return request<{ status: string; checks: unknown[]; exportAllowed?: boolean }>('/plan/verify', { method: 'POST', body: JSON.stringify(body) })
  },
  config(signal?: AbortSignal) {
    return request<PublicConfig>('/config', { method: 'GET' }, signal)
  },
  putConfig(body: Record<string, unknown>) {
    return request<PublicConfig>('/config', { method: 'PUT', body: JSON.stringify(body) })
  },
  testConfig() {
    return request<Record<string, unknown>>('/config/test', { method: 'POST', body: '{}' })
  },
  briefSamples(signal?: AbortSignal) {
    return request<{ samples: { industry: string; title: string; text: string }[] }>('/brief/samples', { method: 'GET' }, signal)
  },
  parseBrief(body: { text: string; industry?: string }) {
    return request<Record<string, unknown>>('/brief/parse', { method: 'POST', body: JSON.stringify(body) })
  },
}
