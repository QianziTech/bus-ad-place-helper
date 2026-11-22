/** 全区间结果 → 某一金额的完整成案。滑块切换只读本轮结果，不再请求后端。 */
import type { BudgetOption, PipelineRangeSuccess, PipelineSuccess, OptionMedia, PlanLine } from './types'
import type { RangeData } from './slots'

export function optionAt(range: PipelineRangeSuccess, budgetYuan: number): BudgetOption | undefined {
  return range.budgetOptions.find(option => option.budgetYuan === budgetYuan)
}

function lineFrom(media: OptionMedia, line: NonNullable<BudgetOption['lines']>[number]): PlanLine {
  return {
    mediaKey: media.mediaKey,
    kind: media.kind,
    name: media.name,
    levelName: media.levelName,
    ...(media.mediaForm === undefined ? {} : { mediaForm: media.mediaForm }),
    ...(media.exit === undefined ? {} : { exit: media.exit }),
    ...(media.total === undefined ? {} : { total: media.total }),
    freeCount: media.freeCount,
    ...(media.contractCount === undefined ? {} : { contractCount: media.contractCount }),
    ...(media.reservedCount === undefined ? {} : { reservedCount: media.reservedCount }),
    monthlyLowYuan: media.monthlyLowYuan,
    monthlyHighYuan: media.monthlyHighYuan,
    productionYuan: media.productionUnitYuan * line.quantity,
    unitEstimateYuan: media.unitEstimateYuan,
    quantity: line.quantity,
    lineTotalYuan: line.lineTotalYuan,
    evidenceRefs: media.evidenceRefs,
    reasons: media.reasons,
    sources: media.sources,
    ...(media.trafficReference ? { trafficReference: media.trafficReference } : {}),
    ...(media.trajectory ? { trajectory: media.trajectory } : {}),
    ...(line.preferredByAi ? { preferredByAi: true } : {}),
  }
}

/** 该金额可行时返回完整成案；不可行返回 null，原因见 optionAt 的 status/message。 */
export function planForBudget(range: PipelineRangeSuccess, budgetYuan: number): PipelineSuccess | null {
  const option = optionAt(range, budgetYuan)
  if (!option || option.status !== 'ok' || !option.lines || !option.schedule) return null
  const lines = option.lines
    .map(line => (range.mediaByKey[line.mediaKey] ? lineFrom(range.mediaByKey[line.mediaKey], line) : null))
    .filter((line): line is PlanLine => line !== null)
  const selected = new Map((option.selectedAnchors || []).map(item => [item.anchorId, item.selectedCount]))
  return {
    status: 'ok',
    request: { ...range.request, budgetYuan },
    client: range.client,
    campaign: range.campaign,
    lines,
    anchors: range.anchors.map(anchor => ({ ...anchor, selectedCount: selected.get(anchor.id) ?? 0 })),
    billingMonths: range.billingMonths,
    billingStatus: range.billingStatus ?? 'confirmed',
    inventory: range.inventory,
    totalYuan: option.totalYuan ?? 0,
    remainingYuan: option.remainingYuan ?? 0,
    queriedAt: range.queriedAt,
    schedule: option.schedule,
    assumptions: range.assumptions,
    notices: range.notices,
    trace: range.trace,
    ...(range.strategyPreferences ? { strategyPreferences: range.strategyPreferences } : {}),
    // 文案与核验按默认金额生成、跨预算共用；清单、金额与预算取舍取当前档位。
    copy: range.copy,
    checks: range.checks,
    rounds: range.rounds,
    degraded: range.degraded,
    exportAllowed: range.exportAllowed,
    ...(range.mediaObjective ? { mediaObjective: range.mediaObjective } : {}),
    ...(range.windowFit ? { windowFit: range.windowFit } : {}),
    ...(range.measurement ? { measurement: range.measurement } : {}),
  }
}

/** 全区间结果 → 渲染器需要的 RangeData；与导出文件内嵌的是同一结构。 */
export function rangeData(range: PipelineRangeSuccess, mode: 'off' | 'mock' | 'live' = 'mock'): RangeData {
  return {
    budget: range.budget,
    minimumEstimateYuan: range.minimumEstimateYuan,
    budgetOptions: range.budgetOptions,
    mediaByKey: range.mediaByKey,
    anchors: range.anchors.map(anchor => ({
      id: anchor.id, areaName: anchor.areaName, station: anchor.station, role: anchor.role, rationale: anchor.rationale,
      candidateCounts: anchor.candidateCounts, selectedCount: anchor.selectedCount ?? 0, ...(anchor.coord ? { coord: anchor.coord } : {}),
    })),
    campaign: {
      name: range.campaign.name, businessGoal: range.campaign.businessGoal, primaryGoal: range.campaign.primaryGoal, audience: range.campaign.audience,
      window: range.campaign.window, budgetHintYuan: range.campaign.budgetHintYuan, mediaScope: range.campaign.mediaScope,
      successMetric: range.campaign.successMetric, constraints: range.campaign.constraints,
    },
    client: range.client,
    inventory: range.inventory
      ? {
        startDate: range.inventory.startDate, endDate: range.inventory.endDate, billingStatus: range.inventory.billingStatus,
        kinds: range.inventory.kinds,
      }
      : { startDate: range.request.startDate, endDate: range.request.endDate, billingStatus: range.billingStatus ?? 'confirmed', kinds: [] },
    queriedAt: range.queriedAt,
    billingMonths: range.billingMonths,
    billingStatus: range.billingStatus ?? 'confirmed',
    requestMedia: [...range.request.media],
    assumptions: range.assumptions,
    notices: range.notices,
    mode,
    industryName: range.industryName,
  }
}

/** 默认金额：后端给出 defaultYuan 时直接采用，否则取最近可行档。 */
export function initialBudget(range: PipelineRangeSuccess): number {
  const preferred = range.budget.defaultYuan
  if (optionAt(range, preferred)?.status === 'ok') return preferred
  const feasible = range.budgetOptions.filter(option => option.status === 'ok')
  if (!feasible.length) return preferred
  return feasible.reduce((best, option) => {
    const distance = Math.abs(option.budgetYuan - preferred)
    const bestDistance = Math.abs(best.budgetYuan - preferred)
    return distance < bestDistance || (distance === bestDistance && option.budgetYuan < best.budgetYuan) ? option : best
  }).budgetYuan
}
