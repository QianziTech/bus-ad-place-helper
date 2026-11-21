import { renderPlan, planFileName } from '../plan/renderPlan'
import type { PlanVm } from '../plan/buildVm'
import { humanLocation } from '../plan/locations'

export interface BlockingItem { element: string; message: string; location?: string; suggestion?: string }

/** 导出前校验：只拦实名 / 成交价 / 合规词三类，其余 warn 不阻断。
 *  同一段文案会出现在请求、生效 Campaign 与导出正文里，按「项 + 结论 + 可读位置」去重后只报一次。 */
export function blockingItems(vm: PlanVm): BlockingItem[] {
  const seen = new Set<string>()
  return vm.checks
    .filter(check => check.status === 'fail' && (check.blocking || check.element === '实名扫描' || check.element === '成交价扫描' || check.element === '合规扫描'))
    .map(check => ({ element: check.element, message: check.message, location: humanLocation(check.location), suggestion: check.suggestion }))
    .filter(item => {
      const key = `${item.element}|${item.message}|${item.location}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function downloadPlan(vm: PlanVm): { ok: true; fileName: string } | { ok: false; items: BlockingItem[] } {
  const items = blockingItems(vm)
  if (items.length) return { ok: false, items }
  const html = renderPlan(vm, { appendix: true })
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = planFileName(vm)
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return { ok: true, fileName: planFileName(vm) }
}
