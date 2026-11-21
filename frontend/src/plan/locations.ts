/** 把后端扫描的 JSON 路径转成可读位置，导出阻断清单与核验面板共用。 */
const fieldLabels: Record<string, string> = {
  businessGoal: '生意目标',
  name: '活动名称',
  audience: '目标人群',
  primaryGoal: '主目标',
  successMetric: '成功衡量',
  constraints: '行业约束',
  headline: '卷首标题',
  brandContext: '品牌背景',
  strategyLine: '策略句',
  selectionRationale: '选点理由',
  assumptionEcho: '假设书回应',
}

export function humanLocation(location?: string): string {
  if (!location) return '方案文案'
  const cleaned = location.replace(/^output\./, '')
  for (const [field, label] of Object.entries(fieldLabels)) {
    if (cleaned.endsWith(`.${field}`)) {
      if (cleaned.startsWith('copy.')) return `AI 文案 · ${label}`
      if (cleaned.includes('campaignOverride')) return `需求细节 · ${label}`
      if (cleaned.startsWith('plan.') || cleaned.startsWith('campaign.')) return `本次需求 · ${label}`
      return label
    }
  }
  if (cleaned.startsWith('copy')) return 'AI 文案'
  if (cleaned.startsWith('plan.') || cleaned.startsWith('campaign.')) return '投放需求'
  return cleaned
}
