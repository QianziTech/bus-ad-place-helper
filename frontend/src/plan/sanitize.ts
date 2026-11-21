/** LLM 文案纯文本化 + HTML 转义。所有插入到文档的字符串都必须走这里。 */
const ENTITIES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ENTITIES[char])
}

/** 去掉模型可能带回的 HTML 标签与脚本痕迹，只留纯文本。 */
export function plainText(value: unknown): string {
  const text = String(value ?? '')
  const stripped = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return stripDashes(stripped)
}

/** 模型爱用「——」「–」，统一换成中文破折号之外的安全表述，避免与价格区间混淆。 */
function stripDashes(text: string): string {
  return text.replace(/\s*——+\s*/g, '，').replace(/[–—]{1,2}/g, '-')
}

export function copyText(value: unknown, maxLen = 400): string {
  const text = plainText(value)
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text
}

/**
 * 客户需求的本地扫描：只查成交价与点位单价形态，不内置任何企业名——实名黑名单只在服务端
 * （`data/internal/brand_mapping.json`），前端打包产物不得包含真实客户名。
 */
const PRICE_PATTERN = /(成交价|实付|折后价|到手价|优惠价|折扣价)\s*[:：]?\s*\d+|\d+(?:\.\d+)?\s*(?:万|千)?\s*元?\s*[/／每]\s*(?:辆|台|块|口|月)/
export function localScan(text: string): string[] {
  if (!text || !text.trim()) return []
  return PRICE_PATTERN.test(text) ? ['疑似成交价或非区间单价'] : []
}
