import type { Meta, PlanFailure, PipelineResult, PublicConfig } from '../plan/types'

export class ApiError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) {
    super(message)
  }
}

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
  generate(body: Record<string, unknown>, signal?: AbortSignal) {
    return request<PipelineResult | PlanFailure>('/plan/generate', { method: 'POST', body: JSON.stringify(body) }, signal)
  },
  plan(body: Record<string, unknown>, signal?: AbortSignal) {
    return request<PipelineResult | PlanFailure>('/plan', { method: 'POST', body: JSON.stringify(body) }, signal)
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
