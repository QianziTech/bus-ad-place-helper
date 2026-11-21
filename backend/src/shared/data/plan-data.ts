import { PlanData, INDUSTRIES, MediaKind } from '../contracts';

export function isPlanDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^2027-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function requireValue(condition: unknown, path: string, message: string): asserts condition {
  if (!condition) throw new Error(`数据校验失败：${path} ${message}`);
}
function object(value: unknown, path: string): asserts value is Record<string, any> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), path, '必须是对象');
}
function text(value: unknown, path: string, allowEmpty = false): asserts value is string {
  requireValue(typeof value === 'string' && (allowEmpty || value.trim().length > 0), path, '必须是字符串');
}
function number(value: unknown, path: string, integer = true, min = 0): asserts value is number {
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= min && (!integer || Number.isSafeInteger(value)), path, `必须是大于等于 ${min} 的${integer ? '安全整数' : '数值'}`);
}
function strings(value: unknown, path: string) {
  requireValue(Array.isArray(value), path, '必须是数组');
  value.forEach((item, index) => text(item, `${path}[${index}]`));
}
function scope(value: unknown, path: string) {
  requireValue(Array.isArray(value) && value.length > 0 && value.every(item => item === 'bus' || item === 'metro') && new Set(value).size === value.length, path, '必须是非空且不重复的媒体数组');
}

export function validatePlanData(value: unknown): asserts value is PlanData {
  object(value, 'data');
  const mediaKeys = new Set<string>();
  for (const kind of ['bus', 'metro'] as MediaKind[]) {
    const mediaData = value[kind];
    object(mediaData, kind);
    object(mediaData.mediaByKey, `${kind}.mediaByKey`);
    for (const [key, media] of Object.entries(mediaData.mediaByKey)) {
      const path = `${kind}.mediaByKey.${key}`;
      object(media, path);
      requireValue(media.kind === kind, path, '媒体类型与文件不一致');
      number(media.resourceId, `${path}.resourceId`);
      text(media.lineName, `${path}.lineName`);
      text(media.levelName, `${path}.levelName`, true);
      const variant = kind === 'bus' ? 'mediaForm' : 'exit';
      text(media[variant], `${path}.${variant}`);
      requireValue(key === `${kind}|${media.resourceId}|${media[variant]}`, path, 'mediaKey 与资源编号、媒体形式或出口不一致');
      if (media.total !== undefined) number(media.total, `${path}.total`);
      mediaKeys.add(key);
    }
    requireValue(Array.isArray(mediaData.windows), `${kind}.windows`, '必须是数组');
    const windows = new Set<string>();
    for (const [index, window] of mediaData.windows.entries()) {
      const path = `${kind}.windows[${index}]`;
      object(window, path);
      requireValue(isPlanDate(window.startDate) && isPlanDate(window.endDate) && window.startDate <= window.endDate, path, '档期必须为 2027 年内有效日期且起止有序');
      const key = `${window.startDate}/${window.endDate}`;
      requireValue(!windows.has(key), path, '档期重复');
      windows.add(key);
      text(window.queriedAt, `${path}.queriedAt`);
      requireValue(/(?:Z|[+-]\d{2}:\d{2})$/.test(window.queriedAt) && Number.isFinite(Date.parse(window.queriedAt)), `${path}.queriedAt`, '必须包含有效时间和时区');
      number(window.billingMonths, `${path}.billingMonths`, false, Number.MIN_VALUE);
      object(window.inventoryByKey, `${path}.inventoryByKey`);
      for (const [mediaKey, inventory] of Object.entries(window.inventoryByKey)) {
        object(inventory, `${path}.inventoryByKey.${mediaKey}`);
        requireValue(Object.hasOwn(mediaData.mediaByKey, mediaKey), path, `库存引用未知媒体 ${mediaKey}`);
        if (inventory.freeCount !== null && inventory.freeCount !== undefined) number(inventory.freeCount, `${path}.${mediaKey}.freeCount`);
        for (const field of ['contractCount', 'reservedCount']) {
          if (inventory[field] !== undefined) number(inventory[field], `${path}.${mediaKey}.${field}`);
        }
      }
    }
  }
  object(value.pricing, 'pricing');
  object(value.pricing.pricesByMediaKey, 'pricing.pricesByMediaKey');
  for (const [key, price] of Object.entries(value.pricing.pricesByMediaKey)) {
    const path = `pricing.pricesByMediaKey.${key}`;
    object(price, path);
    requireValue(mediaKeys.has(key), path, '引用未知媒体');
    for (const field of ['monthlyLowYuan', 'monthlyHighYuan', 'productionYuan']) number(price[field], `${path}.${field}`);
    requireValue(price.monthlyHighYuan >= price.monthlyLowYuan && price.monthlyHighYuan > 0, path, '刊例区间无效');
    text(price.source, `${path}.source`);
    strings(price.assumptions, `${path}.assumptions`);
  }
  object(value.coverage, 'coverage');
  object(value.coverage.anchorsById, 'coverage.anchorsById');
  for (const [id, anchor] of Object.entries(value.coverage.anchorsById)) {
    const path = `coverage.anchorsById.${id}`;
    object(anchor, path);
    text(anchor.areaName, `${path}.areaName`);
    text(anchor.station, `${path}.station`);
    requireValue(anchor.role === 'businessArea' || anchor.role === 'landmark', `${path}.role`, '类型无效');
    object(anchor.coord, `${path}.coord`);
    number(anchor.coord.lng, `${path}.coord.lng`, false, -180);
    number(anchor.coord.lat, `${path}.coord.lat`, false, -90);
    requireValue(anchor.coord.lng <= 180 && anchor.coord.lat <= 90, `${path}.coord`, '经纬度超出范围');
    text(anchor.coord.exit, `${path}.coord.exit`, true);
    text(anchor.coord.source, `${path}.coord.source`);
    requireValue(Array.isArray(anchor.candidates), `${path}.candidates`, '必须是数组');
    const seen = new Set<string>();
    for (const candidate of anchor.candidates) {
      object(candidate, `${path}.candidates`);
      requireValue(mediaKeys.has(candidate.mediaKey), path, `候选引用未知媒体 ${candidate.mediaKey}`);
      requireValue(!seen.has(candidate.mediaKey), path, `候选重复 ${candidate.mediaKey}`);
      seen.add(candidate.mediaKey);
      text(candidate.relation, `${path}.relation`);
      text(candidate.source, `${path}.source`);
      if (candidate.distanceM !== undefined) number(candidate.distanceM, `${path}.distanceM`, false);
    }
  }
  object(value.briefs, 'briefs');
  requireValue(Array.isArray(value.briefs.industries) && value.briefs.industries.length > 0, 'briefs.industries', '必须是非空数组');
  const industryIds = new Set<string>();
  const clientCodes = new Set<string>();
  for (const industry of value.briefs.industries) {
    object(industry, 'briefs.industries');
    const path = `briefs.industries.${industry.id}`;
    requireValue(INDUSTRIES.includes(industry.id) && !industryIds.has(industry.id), `${path}.id`, '行业无效或重复');
    industryIds.add(industry.id);
    text(industry.name, `${path}.name`);
    object(industry.client, `${path}.client`);
    for (const field of ['code', 'alias', 'category', 'scale']) text(industry.client[field], `${path}.client.${field}`);
    requireValue(/^某/.test(industry.client.alias), `${path}.client.alias`, '必须使用以“某”开头的客户代称');
    requireValue(!clientCodes.has(industry.client.code), `${path}.client.code`, '客户代号重复');
    clientCodes.add(industry.client.code);
    for (const field of ['channelNote', 'selectionBasis']) if (industry.client[field] !== undefined) text(industry.client[field], `${path}.client.${field}`);
    const campaign = industry.campaign;
    object(campaign, `${path}.campaign`);
    for (const field of ['id', 'name', 'businessGoal', 'audience']) text(campaign[field], `${path}.campaign.${field}`);
    requireValue(campaign.id.startsWith(`${industry.client.code}-`), `${path}.campaign.id`, '必须与客户代号绑定');
    requireValue(['认知', '到店', '促销', '拉新'].includes(campaign.primaryGoal), `${path}.campaign.primaryGoal`, '目标无效');
    object(campaign.window, `${path}.campaign.window`);
    requireValue(isPlanDate(campaign.window.start) && isPlanDate(campaign.window.end) && campaign.window.start <= campaign.window.end, `${path}.campaign.window`, '必须为 2027 年内有效日期且起止有序');
    number(campaign.budgetHintYuan, `${path}.campaign.budgetHintYuan`, true, 1);
    scope(campaign.mediaScope, `${path}.campaign.mediaScope`);
    object(campaign.mediaBias, `${path}.campaign.mediaBias`);
    for (const kind of ['bus', 'metro']) number(campaign.mediaBias[kind], `${path}.campaign.mediaBias.${kind}`, false);
    requireValue(campaign.mediaBias.bus + campaign.mediaBias.metro > 0, `${path}.campaign.mediaBias`, '权重之和必须大于 0');
    object(campaign.successMetric, `${path}.campaign.successMetric`);
    for (const field of ['kpi', 'proof']) text(campaign.successMetric[field], `${path}.campaign.successMetric.${field}`);
    strings(campaign.constraints, `${path}.campaign.constraints`);
    requireValue(Array.isArray(industry.anchors), `${path}.anchors`, '必须是数组');
    const seen = new Set<string>();
    for (const anchor of industry.anchors) {
      object(anchor, `${path}.anchors`);
      requireValue(Object.hasOwn(value.coverage.anchorsById, anchor.id) && !seen.has(anchor.id), `${path}.anchors`, '锚点未知或重复');
      seen.add(anchor.id);
      text(anchor.rationale, `${path}.anchors.${anchor.id}.rationale`);
    }
  }
  object(value.traffic, 'traffic');
  object(value.traffic.byMediaKey, 'traffic.byMediaKey');
  for (const [key, reference] of Object.entries(value.traffic.byMediaKey)) {
    const path = `traffic.byMediaKey.${key}`;
    object(reference, path);
    requireValue(Object.hasOwn(value.bus.mediaByKey, key), path, '必须引用已确定身份的公交媒体');
    requireValue(typeof reference.period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(reference.period), `${path}.period`, '必须是有效年月');
    text(reference.source, `${path}.source`);
    if (reference.coveragePv !== undefined) number(reference.coveragePv, `${path}.coveragePv`);
    if (reference.ageGroups !== undefined) {
      requireValue(Array.isArray(reference.ageGroups), `${path}.ageGroups`, '必须是数组');
      for (const group of reference.ageGroups) {
        object(group, `${path}.ageGroups`);
        text(group.label, `${path}.ageGroups.label`);
        number(group.percent, `${path}.ageGroups.percent`, false);
        requireValue(group.percent <= 100, `${path}.ageGroups.percent`, '百分比必须在 0 至 100 之间');
      }
    }
  }
}
