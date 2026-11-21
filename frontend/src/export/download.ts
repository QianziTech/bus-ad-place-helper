import { renderPlan, planFileName } from '../plan/renderPlan'
import type { PlanVm } from '../plan/buildVm'
import type { RangeData } from '../plan/slots'
import { humanLocation } from '../plan/locations'

export interface BlockingItem { element: string; message: string; location?: string; suggestion?: string }

/** 导出前校验：只拦实名 / 成交价 / 合规词三类，其余 warn 不阻断。 */
export function blockingItems(vm: PlanVm): BlockingItem[] {
  return collectBlocking(vm.checks)
}

/** 全区间导出：任一所选金额的嵌入文案命中阻断规则时，整份文件被阻断。 */
export function blockingItemsForRange(views: PlanVm[]): BlockingItem[] {
  return collectBlocking(views.flatMap(vm => vm.checks))
}

function collectBlocking(checks: PlanVm['checks']): BlockingItem[] {
  const seen = new Set<string>()
  return checks
    .filter(check => check.status === 'fail' && (check.blocking || check.element === '实名扫描' || check.element === '成交价扫描' || check.element === '合规扫描'))
    .map(check => ({ element: check.element, message: check.message, location: humanLocation(check.location), suggestion: check.suggestion }))
    .filter(item => {
      const key = `${item.element}|${item.message}|${item.location}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function downloadPlan(vm: PlanVm, range?: { range: RangeData; budgetYuan: number; blocking: () => BlockingItem[] }): { ok: true; fileName: string } | { ok: false; items: BlockingItem[] } {
  const items = range ? range.blocking() : blockingItems(vm)
  if (items.length) return { ok: false, items }
  // 全区间时把每档内容与滑块一起内嵌，断网打开仍可切换。
  const html = renderPlan(vm, { appendix: true, ...(range ? { range: range.range, budgetYuan: range.budgetYuan } : {}) })
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
