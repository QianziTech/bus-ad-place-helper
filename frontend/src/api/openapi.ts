/** 能力目录只读 /api/openapi.json，不维护手写清单。 */
export interface ApiTool {
  operationId: string
  summary: string
  tags: string[]
  method: string
  path: string
  description?: string
  input: { name: string; type: string; required: boolean; enum?: string[] }[]
  outputs: { code: string; statuses: string[]; note?: string }[]
}

interface OpenApiDoc {
  paths: Record<string, Record<string, {
    operationId?: string
    summary?: string
    description?: string
    tags?: string[]
    requestBody?: { content?: Record<string, { schema?: SchemaLike }> }
    responses?: Record<string, { description?: string; content?: Record<string, { schema?: SchemaLike }> }>
  }>>
  components?: { schemas?: Record<string, SchemaLike> }
}

interface SchemaLike {
  $ref?: string
  type?: string
  enum?: string[]
  required?: string[]
  properties?: Record<string, SchemaLike>
  items?: SchemaLike
  oneOf?: SchemaLike[]
  allOf?: SchemaLike[]
}

function resolve(doc: OpenApiDoc, schema: SchemaLike | undefined, seen = 0): SchemaLike | undefined {
  if (!schema || seen > 6) return schema
  if (schema.$ref) {
    const name = schema.$ref.replace('#/components/schemas/', '')
    return resolve(doc, doc.components?.schemas?.[name], seen + 1)
  }
  if (schema.allOf) {
    const merged = schema.allOf.map(item => resolve(doc, item, seen + 1) || {})
    return { type: 'object', properties: Object.assign({}, ...merged.map(item => item.properties || {})) }
  }
  return schema
}

function statuses(doc: OpenApiDoc, schema: SchemaLike | undefined): string[] {
  const resolved = resolve(doc, schema)
  if (!resolved) return []
  if (resolved.enum) return resolved.enum
  if (resolved.oneOf) {
    return [...new Set(resolved.oneOf.flatMap(item => statuses(doc, item)))]
  }
  const status = resolved.properties?.status
  if (status) {
    const inner = resolve(doc, status)
    if (inner?.enum) return inner.enum
  }
  return []
}

export async function loadOpenApi(): Promise<ApiTool[]> {
  const response = await fetch('/api/openapi.json')
  if (!response.ok) throw new Error(`读取 /api/openapi.json 失败：HTTP ${response.status}`)
  const doc = (await response.json()) as OpenApiDoc
  const tools: ApiTool[] = []
  for (const [path, methods] of Object.entries(doc.paths || {})) {
    for (const [method, op] of Object.entries(methods || {})) {
      if (!method.match(/^(get|post|put|delete|patch)$/)) continue
      const schema = op.requestBody?.content?.['application/json']?.schema
      const body = resolve(doc, schema)
      const input = Object.entries(body?.properties || {}).map(([name, prop]) => {
        const resolved = resolve(doc, prop)
        return {
          name,
          type: resolved?.type || (resolved?.enum ? 'enum' : 'object'),
          required: (body?.required || []).includes(name),
          enum: resolved?.enum,
        }
      })
      const outputs = Object.entries(op.responses || {}).map(([code, info]) => ({
        code,
        statuses: statuses(doc, info.content?.['application/json']?.schema),
      }))
      tools.push({
        operationId: op.operationId || `${method}${path}`,
        summary: op.summary || path,
        description: op.description,
        tags: op.tags || [],
        method: method.toUpperCase(),
        path: path.startsWith('/api') ? path : `/api${path}`,
        input,
        outputs,
      })
    }
  }
  const order = ['engine', 'analysis', 'brief', 'config']
  return tools.sort((a, b) => {
    const ai = order.indexOf(a.tags[0] || '')
    const bi = order.indexOf(b.tags[0] || '')
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.path.localeCompare(b.path)
  })
}

export function toolsAsMarkdown(tools: ApiTool[]): string {
  const lines = ['| 能力 | 方法 | 用途 | 模式约束 |', '| --- | --- | --- | --- |']
  for (const tool of tools) {
    const constraint = tool.tags.includes('analysis') ? '关闭模式返回 disabled' : '始终可用'
    lines.push(`| ${tool.operationId} | ${tool.method} ${tool.path} | ${tool.summary} | ${constraint} |`)
  }
  return lines.join('\n')
}
