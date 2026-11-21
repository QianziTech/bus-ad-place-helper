/**
 * 成品内预算推演的动态区块渲染。
 * 这个函数会被原样内联进导出的 HTML（`buildSlots.toString()`），因此必须完全自包含：
 * 不引用模块作用域、不依赖任何外部资源，只使用参数对象和内置全局。
 * 预览与导出共用它，保证滑块切换后的内容与首次渲染一致。
 */
import type { BudgetOption, OptionMedia, RangeAnchor } from './types'

export interface RangeData {
  budget: { minYuan: number; maxYuan: number; stepYuan: number; presetsYuan: number[]; defaultYuan: number }
  budgetOptions: BudgetOption[]
  mediaByKey: Record<string, OptionMedia>
  anchors: RangeAnchor[]
  campaign: {
    name: string; businessGoal: string; primaryGoal: string; audience: string
    window: { start: string; end: string }; budgetHintYuan: number; mediaScope: ('bus' | 'metro')[]
    successMetric: { kpi: string; proof: string }; constraints: string[]
  }
  client: { code: string; alias: string; category: string; scale: string }
  inventory: { startDate: string; endDate: string; billingStatus: 'confirmed' | 'pending'; kinds: { kind: 'bus' | 'metro'; sourceLabel: string; queriedAt?: string; sampleDates?: string[] }[] }
  queriedAt: string
  billingMonths: number
  billingStatus: 'confirmed' | 'pending'
  assumptions: string[]
  notices: string[]
  mode: 'off' | 'mock' | 'live'
  industryName: string
}

export type SlotName = 'chips' | 'kpis' | 'note' | 's2window' | 's2anchors' | 's3table' | 's4' | 's5' | 's6' | 'analysis' | 'map' | 's65' | 's66'

/** 返回某金额下的全部动态区块；金额不可成案时只有 note（原因）有内容。 */
export function buildSlots(data: RangeData, budgetYuan: number, highlight?: string | null): Record<SlotName, string> {
  const esc = (value: unknown) => String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string))
  const copyText = (value: unknown, maxLen: number) => {
    const text = String(value === undefined || value === null ? '' : value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text
  }
  const wanMoney = (yuan: number) => `¥${(Math.round((yuan / 10000) * 10) / 10).toFixed(1)} 万`
  const money2 = (yuan: number) => `¥${(Math.round(yuan / 100) / 100).toFixed(2)} 万`
  const wan = (yuan: number) => `${(Math.round(yuan / 1000) / 10).toFixed(1)} 万`
  const wanRange = (low: number, high: number) => `${Math.round(low / 1000) / 10}–${Math.round(high / 1000) / 10} 万`
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateTimeText = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value || '—'
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  const windowText = (start: string, end: string) => (!start || !end ? '—' : start === end ? start : `${start} ~ ${end.slice(5)}`)
  const mediaLabel = (kind: string) => (kind === 'bus' ? '公交车身' : '地铁出入口')
  const empty: Record<SlotName, string> = { chips: '', kpis: '', note: '', s2window: '', s2anchors: '', s3table: '', s4: '', s5: '', s6: '', analysis: '', map: '', s65: '', s66: '' }
  const option = data.budgetOptions.filter(item => item.budgetYuan === budgetYuan)[0]
  if (!option) return empty
  if (option.status !== 'ok' || !option.lines || !option.schedule) {
    return { ...empty, note: `<div class="risk bad"><b>${budgetYuan / 10000} 万不可成案：</b>${esc(option.message || '该金额没有可行组合')}${option.suggestions && option.suggestions.length ? `　建议：${esc(option.suggestions.join('；'))}` : ''}</div>` }
  }
  const media = (key: string) => data.mediaByKey[key]
  const lineOf = (key: string) => {
    const item = option.lines!.filter(line => line.mediaKey === key)[0]
    const source = media(key)
    if (!item || !source) return null
    return { mediaKey: key, kind: source.kind, name: source.name, levelName: source.levelName, mediaForm: source.mediaForm, exit: source.exit, total: source.total,
      freeCount: source.freeCount, contractCount: source.contractCount, reservedCount: source.reservedCount, monthlyLowYuan: source.monthlyLowYuan, monthlyHighYuan: source.monthlyHighYuan,
      productionYuan: source.productionUnitYuan * item.quantity, unitEstimateYuan: source.unitEstimateYuan,
      quantity: item.quantity, lineTotalYuan: item.lineTotalYuan, reasons: source.reasons || [], sources: source.sources || [],
      anchorIds: source.anchorIds || [], traffic: source.trafficReference, trajectory: source.trajectory, preferredByAi: Boolean(item.preferredByAi) }
  }
  const lines = option.lines.map(line => lineOf(line.mediaKey)).filter((line): line is NonNullable<ReturnType<typeof lineOf>> => Boolean(line))
  const busLines = lines.filter(line => line.kind === 'bus')
  const metroLines = lines.filter(line => line.kind === 'metro')
  const selected = new Map((option.selectedAnchors || []).map(item => [item.anchorId, item.selectedCount]))
  const anchors = data.anchors.map(anchor => ({ ...anchor, selectedCount: selected.get(anchor.id) || 0 }))
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0)
  const total = option.totalYuan || 0
  const remaining = option.remainingYuan || 0
  const totalMedia = lines.reduce((sum, line) => sum + (line.lineTotalYuan - line.productionYuan), 0)
  const totalProduction = lines.reduce((sum, line) => sum + line.productionYuan, 0)
  const variant = (line: NonNullable<ReturnType<typeof lineOf>>) => (line.kind === 'bus' ? line.mediaForm || '—' : line.exit || '—')
  const levelLabel = (level: string) => (level === '观光' ? '观光车（双层/都市观光）' : level)

  const row = (line: NonNullable<ReturnType<typeof lineOf>>) => {
    const star = line.preferredByAi ? '<span class="star" title="AI 推荐资源">★ </span>' : ''
    const anchorNames = anchors.filter(anchor => anchor.selectedCount > 0 && line.anchorIds.indexOf(anchor.id) >= 0).map(anchor => anchor.areaName)
    // 库存四态写进展开区：手机上没有 hover，关键数字必须有一处落点。
    const stockLine = `可售 ${line.freeCount}${line.contractCount !== undefined ? ` · 合同 ${line.contractCount}` : ''}${line.reservedCount !== undefined ? ` · 预定 ${line.reservedCount}` : ''}${line.total !== undefined ? ` · 总量 ${line.total}` : ''}`
    const leftOver = line.total !== undefined ? line.total - line.quantity : undefined
    const leftNote = leftOver !== undefined && leftOver > 0 ? `本方案采用 ${line.quantity}，其余 ${leftOver} 台未订，留作同档期的替换与备损缓冲。` : ''
    const pct = option.totalYuan ? Math.round((line.lineTotalYuan / option.totalYuan) * 1000) / 10 : 0
    const load = pct >= 30 ? `<span class="load">主承重 ${pct}%</span>` : ''
    const details = [
      `<p><b>库存</b>　${esc(stockLine)}${leftNote ? `<br><span class="muted">${esc(leftNote)}</span>` : ''}</p>`,
      line.reasons.length ? `<p><b>入选理由</b></p><ul>${line.reasons.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '',
      line.sources.length ? `<p><b>来源</b></p><ul>${line.sources.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '',
      anchorNames.length ? `<p>关联商圈：${esc(anchorNames.join('、'))}</p>` : '',
      line.kind === 'bus'
        ? line.traffic
          ? `<p><b>2023-05 历史覆盖 ${line.traffic.coveragePv !== undefined ? line.traffic.coveragePv.toLocaleString('zh-CN') : '暂无数据'} 人次</b>${line.traffic.ageGroups && line.traffic.ageGroups.length ? `<br>年龄分布 ${line.traffic.ageGroups.map(group => `${esc(group.label)} ${group.percent}%`).join(' · ')}` : ''}<br><span class="muted">${esc(line.traffic.source)} · 仅作人群参考，不与其它线路相加</span></p>`
          : '<p class="muted">暂无数据：该线路未取得 2023-05 历史覆盖与年龄画像。</p>'
        : '<p class="muted">地铁暂无对应历史覆盖数据。</p>',
    ].filter(Boolean).join('')
    const cls = highlight === line.mediaKey ? ' class="hl"' : ''
    return `<tr${cls} data-key="${esc(line.mediaKey)}">
    <td data-label="线路 / 站点"><details><summary>${star}${esc(line.name)}</summary>${details}</details></td>
    <td data-label="形式 / 出口">${esc(variant(line))}</td>
    <td data-label="等级">${esc(levelLabel(line.levelName))}</td>
    <td class="num" data-label="可售 / 总量" data-src="${esc(stockLine)}">${line.freeCount}${line.total !== undefined ? ` / ${line.total}` : ''}</td>
    <td class="num" data-label="数量">${line.quantity}</td>
    <td class="num" data-label="月价（区间）">${wanRange(line.monthlyLowYuan, line.monthlyHighYuan)}</td>
    <td class="num" data-label="制作费">${esc(`¥${line.productionYuan.toLocaleString('zh-CN')}`)}</td>
    <td class="num" data-label="行合计"><b>${esc(wanMoney(line.lineTotalYuan))}</b>${load}</td>
  </tr>`
  }
  const table = (subset: typeof lines) => subset.length
    ? `<table class="data"><thead><tr><th>线路 / 站点</th><th>形式 / 出口</th><th>等级</th><th class="num">可售 / 总量</th><th class="num">数量</th><th class="num">月价（区间）</th><th class="num">制作费</th><th class="num">行合计</th></tr></thead><tbody>${subset.map(row).join('')}</tbody></table>`
    : '<p class="muted">本次没有该类媒体入选。</p>'

  const chips = `<span class="chip on">${esc(data.industryName)}</span>
    <span class="chip">预算上限 ${esc(`${budgetYuan / 10000} 万`)}</span>
    <span class="chip">${esc(data.campaign.mediaScope.map(kind => (kind === 'bus' ? '公交车身' : '地铁出入口')).join(' + '))}</span>
    <span class="chip">${esc(windowText(data.inventory.startDate, data.inventory.endDate))}</span>`
  // 假设书⑤：本次档期以实际核对档期为准；与建议窗口不同时补一行接续说明与月度成本。
  const start = data.inventory.startDate || ''
  const end = data.inventory.endDate || ''
  const suggested = data.campaign.window
  const months = Math.max(1, data.billingMonths || 1)
  const monthlyCost = total / months
  const differs = suggested && (suggested.start !== start || suggested.end !== end)
  const monthCount = (from: string, to: string) => {
    const a = new Date(`${from}T00:00:00`), b = new Date(`${to}T00:00:00`)
    return Math.max(1, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1)
  }
  const restMonths = differs ? Math.max(0, monthCount(suggested.start, suggested.end) - months) : 0
  const s2window = `<div class="win"><b>${esc(start && end ? `${start} ~ ${end}` : '档期待确认')}</b><span>${esc(data.billingStatus === 'pending' ? '计费口径待确认' : `${months} 个投放月`)} · 上限 ${esc(`${budgetYuan / 10000} 万`)}</span>${differs ? `<br><small>建议窗口 ${esc(`${suggested.start} ~ ${suggested.end}`)}；本次先投 ${esc(`${start} ~ ${end}`)}${restMonths ? `，余下 ${restMonths} 个月可续投，按本档单价约 ${esc(wanMoney(monthlyCost))}／月` : ''}</small>` : ''}</div>`
  const kpis = `<div class="kpi"><b>${quantity}<em>台 / 个</em></b><small>媒体单位</small></div>
    <div class="kpi"><b>${busLines.length + metroLines.length}<em>条 / 个</em></b><small>公交线路 · 地铁出口</small></div>
    <div class="kpi"><b>${esc(wanMoney(total))}</b><small>估算总额</small></div>
    <div class="kpi"><b>${esc(wanMoney(remaining))}</b><small>预算余量</small></div>`
  const note = `<p class="note" style="margin-top:16px">${data.mode === 'mock' ? '演示方案 · ' : ''}报价按刊例区间中值估算，详见报价明细。</p>`
  const anchorWork = anchors.slice(0, 6)
  const s2anchors = anchorWork.length
    ? `<div class="cards" style="grid-template-columns:1fr 1fr">${anchorWork.map(anchor => {
      const coord = anchor.coord ? `<details><summary>查看坐标</summary><p>${anchor.coord.lng.toFixed(6)}, ${anchor.coord.lat.toFixed(6)}${anchor.coord.exit ? ` · ${esc(anchor.coord.exit)}` : ''}</p></details>` : ''
      return `<div class="card"><h3>${esc(anchor.areaName)}</h3><small>${anchor.station ? `站点 ${esc(anchor.station)} · ` : ''}${anchor.role === 'landmark' ? '地标' : '业务区'}</small>
        <p style="margin:8px 0 0;font-size:14px">周边候选 公交 ${anchor.candidateCounts ? anchor.candidateCounts.bus : '—'} · 地铁 ${anchor.candidateCounts ? anchor.candidateCounts.metro : '—'}<br><span class="muted">本方案选中 ${anchor.selectedCount} 项</span></p>
        ${anchor.rationale ? `<p class="note" style="margin-top:6px">${esc(copyText(anchor.rationale, 120))}</p>` : ''}${coord}</div>`
    }).join('')}</div>`
    : '<div class="card"><p class="muted">暂无商圈资料。</p></div>'
  const s3table = `<table class="data"><thead><tr><th>商圈</th><th>站点</th><th class="num">公交候选</th><th class="num">地铁候选</th><th class="num">已选资源</th></tr></thead><tbody>${anchors.map(anchor => `<tr><td data-label="商圈">${esc(anchor.areaName)}</td><td data-label="站点">${esc(anchor.station || '—')}</td><td class="num" data-label="公交候选">${anchor.candidateCounts ? anchor.candidateCounts.bus : '—'}</td><td class="num" data-label="地铁候选">${anchor.candidateCounts ? anchor.candidateCounts.metro : '—'}</td><td class="num" data-label="已选资源">${anchor.selectedCount}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">暂无商圈资料。</td></tr>'}</tbody></table>`
  const s4 = `<h3 style="margin-top:20px">公交车身（${busLines.length} 条线路 · ${busLines.reduce((sum, line) => sum + line.quantity, 0)} 台）</h3>
  ${table(busLines)}
  <h3 style="margin-top:32px">地铁出入口（${metroLines.length} 个出口 · ${metroLines.reduce((sum, line) => sum + line.quantity, 0)} 个）</h3>
  ${table(metroLines)}
  <p class="note" style="margin-top:12px">数量不超过该档期可售量；未订到的空位留在同一档期内，可作替换与备损。行合计占总额 30% 以上的资源标为「主承重」，单点延误影响较大。${lines.some(line => line.preferredByAi) ? '<span class="star">★</span> 表示 AI 推荐资源。' : ''}</p>`
  const schedule = option.schedule
  const inventoryLine = data.inventory.kinds.map(item => {
    const label = item.kind === 'bus' ? '公交' : '地铁'
    if (item.queriedAt) return `${label} ${item.sourceLabel}，查询于 ${dateTimeText(item.queriedAt)}`
    if (item.sampleDates && item.sampleDates.length) return `${label} ${item.sourceLabel}，采样 ${item.sampleDates.join('、')}`
    return `${label} ${item.sourceLabel}`
  }).join(' · ') || `库存核对 ${dateTimeText(data.queriedAt)}`
  const scheduleRows = schedule.batches.map(batch => {
    const names = batch.mediaKeys.map(key => lines.filter(line => line.mediaKey === key)[0]).filter(Boolean).map(line => `${line!.kind === 'metro' ? '地铁' : '公交'} ${line!.name}${line!.kind === 'metro' ? ` · ${variant(line!)}` : ''}`).join('、')
    return `<tr><td>${batch.no}</td><td>${esc(batch.nightDate.slice(5))} 夜</td><td>${esc(names)}</td><td class="num">${batch.quantity}</td><td class="num">${batch.cumulative}</td><td>${esc(`${batch.publishStartDate} 08:00`)}</td></tr>`
  }).join('')
  const neededNights = Math.ceil(quantity / Math.max(1, schedule.singleNightCap))
  const capacity = schedule.status === 'capacity_short'
    ? `<div class="risk">当前产能 ${schedule.batches.length} 夜 < 所需 ${neededNights} 夜：请延长档期或减少 ${Math.max(1, quantity - schedule.batches.reduce((sum, batch) => sum + batch.quantity, 0))} 台。</div>`
    : ''
  const s5 = `<div class="tl"><b>${esc(windowText(data.inventory.startDate, data.inventory.endDate))}</b><br><small>${data.billingStatus === 'pending' ? '计费口径待确认（报价按 1 个计费月参考估算）' : `${data.billingMonths} 个计费月`} · ${esc(inventoryLine)}</small></div>
  <h3 style="margin-top:12px">上线批次（夜间施工，单晚上限 ${schedule.singleNightCap} 台 / 口）</h3>
  ${schedule.batches.length ? `<table class="data batch"><thead><tr><th>批次</th><th>施工夜</th><th>主要线路 / 点位</th><th class="num">数量</th><th class="num">累计</th><th>发布期起算</th></tr></thead><tbody>${scheduleRows}</tbody></table>` : '<p class="muted">本次没有可编排的施工批次。</p>'}
  <p class="note" style="margin-top:12px">首批 ${schedule.batches.length ? schedule.batches[0].nightDate : '—'} 夜间施工，${schedule.batches.length ? schedule.batches[0].publishStartDate : '—'} 08:00 起算；已预留 ${schedule.rainBufferNights} 个雨天顺延夜在档期内 · 误一补二预留 ${schedule.compensationBufferQty} 台。本方案计划 ${schedule.batches.length} 批。</p>
  <p class="note">本方案展示计划投放档期；实际施工与上刊由签约后的执行流程确认。</p>${capacity}`

  // 预算使用率与加投弹性：余量对比最低单位价，告诉客户还能不能再加一个单位。
  const cheapest = lines.reduce((min, line) => (line.unitEstimateYuan < min ? line.unitEstimateYuan : min), Number.POSITIVE_INFINITY)
  const usage = budgetYuan ? Math.round((total / budgetYuan) * 1000) / 10 : 0
  const addable = Number.isFinite(cheapest) && cheapest > 0 ? Math.floor(remaining / cheapest) : 0
  const usageLine = `已用 ${usage}%，余量 ${wanMoney(remaining)}` + (addable > 0
    ? `，还可加 ${addable} 个最低单位（${wanMoney(cheapest)}／单位）。`
    : `，低于最低单位价（${Number.isFinite(cheapest) ? wanMoney(cheapest) : '—'}），当前金额下无可加投单位。`)
  const methodRows = lines.map(line => {
    const unitEstimate = line.lineTotalYuan / line.quantity
    const monthlyMid = Math.round((line.monthlyLowYuan + line.monthlyHighYuan) / 2)
    const detail = `${wanRange(line.monthlyLowYuan, line.monthlyHighYuan)} × ${data.billingMonths} 月 + 制作`
    return `<tr><td>${esc(line.name)}</td><td>${esc(line.kind === 'bus' ? '公交车身' : '地铁出入口')}</td><td>${esc(variant(line))}</td><td class="num">${line.quantity}</td><td class="num" data-src="${esc(`月刊例中值 ${wanMoney(monthlyMid)} × ${data.billingMonths} 月 + 制作费 ${wanMoney(line.productionYuan)}`)}">${esc(money2(unitEstimate))}<br><small>${esc(detail)}</small></td><td class="num">${esc(money2(line.lineTotalYuan))}</td></tr>`
  }).join('')
  // 占比按行合计（含制作）求，才是客户理解的「占总预算」；括号内另注媒体费与制作费。
  const shares = (['bus', 'metro'] as const).map(kind => {
    const subset = lines.filter(line => line.kind === kind)
    const total = subset.reduce((sum, line) => sum + line.lineTotalYuan, 0)
    const fee = subset.reduce((sum, line) => sum + (line.lineTotalYuan - line.productionYuan), 0)
    const production = total - fee
    return { kind, label: kind === 'bus' ? '公交车身' : '地铁出入口', total, fee, production, pct: option.totalYuan ? Math.round((total / option.totalYuan!) * 1000) / 10 : 0 }
  }).filter(item => item.total > 0).map(item => `<div class="bar"><span>${esc(item.label)}</span><span class="track"><span class="fill${item.kind === 'metro' ? ' alt' : ''}" style="display:block;width:${Math.max(2, item.pct)}%;height:100%"></span></span><span>${esc(wanMoney(item.total))} · ${item.pct}%（含制作 ${esc(wanMoney(item.production))}）</span></div>`).join('')
  const s6 = `<table class="data"><thead><tr><th>线路 / 点位</th><th>媒体类别</th><th>形式 / 出口</th><th class="num">数量</th><th class="num">单位估算（含制作）</th><th class="num">行合计</th></tr></thead><tbody>${methodRows}</tbody></table>
  <p class="note" style="margin-top:10px">单位估算 = 月刊例区间中值 × 计费月数 + 单位制作费，报价一节保留两位小数，便于按「数量 × 单位估算 = 行合计」「Σ 行合计 = 估算总额」逐项验算；其余章节按一位小数显示。因计入制作费，同一预算下可购台数略低于只按媒体费的测算。</p>
  <div class="split" style="margin-top:24px"><div>
      <table class="summary-table">
        <tr><td>媒体费小计</td><td class="num">${esc(money2(totalMedia))}</td></tr>
        <tr><td>制作费小计</td><td class="num">${esc(money2(totalProduction))}</td></tr>
        <tr><td><b>估算总额</b></td><td class="num"><b>${esc(money2(total))}</b></td></tr>
        <tr><td>预算上限</td><td class="num">${esc(money2(budgetYuan))}</td></tr>
        <tr><td>余量</td><td class="num">${esc(money2(remaining))}</td></tr>
      </table>
      <p class="note" style="margin-top:8px">${esc(usageLine)}</p>
      <h3 style="margin-top:24px">媒体占比（按行合计，含制作）</h3>
      ${shares || '<p class="muted">本方案没有计入媒体费的行。</p>'}
    </div><div class="card"><h3>计费假设</h3>
      <ul class="col-list">${data.assumptions.map(item => `<li>${esc(item)}</li>`).join('') || '<li>暂无额外假设。</li>'}</ul>
      <p class="note" style="margin-top:10px">金额为按刊例区间中值的估算，最终以合同为准。</p></div></div>`

  const analysis = (option.analysis || []).length ? `<ul class="col-list budget-analysis">${(option.analysis || []).map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''

  const drawn = busLines.filter(line => line.trajectory && line.trajectory.polyline.length)
  const missing = busLines.filter(line => !line.trajectory || !line.trajectory.polyline.length)
  const pois = anchors.filter(anchor => anchor.selectedCount > 0 && anchor.coord)
  const map = (() => {
    if (!drawn.length) return `<p class="muted">本轮入选公交线路暂无可绘制轨迹${missing.length ? `（缺轨迹：${missing.map(line => line.name).join('、')}）` : ''}；清单与报价不受影响。</p>`
    const points = drawn.reduce((list, line) => list.concat(line.trajectory!.polyline), [] as [number, number][])
    const lngs = points.map(point => point[0]).concat(pois.map(anchor => anchor.coord!.lng))
    const lats = points.map(point => point[1]).concat(pois.map(anchor => anchor.coord!.lat))
    const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs)
    const minLat = Math.min(...lats); const maxLat = Math.max(...lats)
    const width = 640; const height = 360; const gap = 28
    const scale = Math.min((width - gap * 2) / Math.max(maxLng - minLng, 1e-3), (height - gap * 2) / Math.max(maxLat - minLat, 1e-3))
    const offsetX = (width - (maxLng - minLng) * scale) / 2
    const offsetY = (height - (maxLat - minLat) * scale) / 2
    const project = (lng: number, lat: number) => [offsetX + (lng - minLng) * scale, height - (offsetY + (lat - minLat) * scale)]
    const paths = drawn.map((line, index) => {
      const d = line.trajectory!.polyline.map(point => project(point[0], point[1]).map(value => value.toFixed(1)).join(',')).join(' ')
      return `<polyline points="${d}" fill="none" stroke="hsl(${(index * 47) % 360} 46% 42%)" stroke-width="${Math.min(6, 2 + Math.ceil(line.quantity / 3))}" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"><title>${esc(line.name)} ×${line.quantity}</title></polyline>`
    }).join('')
    const dots = pois.map(anchor => {
      const projected = project(anchor.coord!.lng, anchor.coord!.lat)
      return `<g><circle cx="${projected[0].toFixed(1)}" cy="${projected[1].toFixed(1)}" r="4" fill="#c4562e"><title>${esc(anchor.areaName)}</title></circle><text x="${(projected[0] + 7).toFixed(1)}" y="${(projected[1] + 4).toFixed(1)}" font-size="11" fill="#5b6470">${esc(anchor.areaName)}</text></g>`
    }).join('')
    const legend = drawn.slice(0, 8).map((line, index) => `<span class="legend-item"><i style="background:hsl(${(index * 47) % 360} 46% 42%)"></i>${esc(line.name)} ×${line.quantity}</span>`).join('')
    return `<svg class="offline-map" viewBox="0 0 ${width} ${height}" role="img" aria-label="入选公交线路与关联商圈示意图" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${width}" height="${height}" fill="#f4f5f6" rx="6"/>${paths}${dots}</svg>
    <p class="note">示意图按本轮数据内嵌的线路轨迹（GCJ-02，简化至约 12 m）等比绘制，不用于测距；圆点为当前金额入选资源命中的商圈。${missing.length ? `缺轨迹：${missing.map(line => line.name).join('、')}。` : ''}</p>
    <p class="map-legend">${legend}</p>`
  })()

  const s65 = busLines.length
    ? `${(() => {
      const perLine = busLines.map(line => {
        const cov = line.traffic && line.traffic.coveragePv
        // 覆盖是整条线路口径，因此成本也用该行合计（本档期全部台数）来除，才是可比的千人成本。
        return { line, cov, cpm: cov ? Math.round((line.lineTotalYuan * 1000 / cov) * 10) / 10 : undefined }
      })
      const cards = perLine.slice(0, 6).map(item => `<div class="card"><h3>${esc(item.line.name)}</h3><small>${item.cov ? `2023-05 历史覆盖 ${item.cov.toLocaleString('zh-CN')} 人次` : '暂无历史覆盖数据'}${item.line.traffic && item.line.traffic.ageGroups && item.line.traffic.ageGroups.length ? `<br>${item.line.traffic.ageGroups.map(group => `${esc(group.label)} ${group.percent}%`).join(' · ')}` : ''}${item.cpm ? `<br><b>单线 CPM 约 ${item.cpm} 元 / 千次</b>` : ''}</small></div>`).join('')
      return `<div class="cards" style="grid-template-columns:repeat(2,1fr)">${cards}</div>
      <p class="note" style="margin-top:10px">单线 CPM = 该线 2023-05 历史覆盖 ÷ 该行行合计成本，衡量「多少钱买一次千次覆盖」，只作量级参考，不可跨线相加或用方案合计求 CPM。不同线路的历史覆盖人次按平台 250 米网格口径分别统计，不构成触达承诺。来源：${esc((busLines.filter(line => line.traffic)[0] || { traffic: { source: '可视化平台 2023-05 历史数据' } }).traffic!.source)}。</p>`
    })()}`
    : '<p class="muted">本次未选公交，地铁暂无对应历史覆盖数据。</p>'

  const risks = data.assumptions.slice(0, 5)
  // 行业约束里的内部合规清单不外泄：只把「不得 X」类条款翻成一句正面承诺，原句留在工作台核验面板。
  const compliance = data.campaign.constraints
    .filter(item => /不得|禁止|须/.test(item))
    .map(item => item.replace(/；|;|。/g, '，').replace(/不得使用/g, '不使用').replace(/不得出现/g, '不出现').replace(/不得涉及/g, '不涉及').replace(/不得承诺/g, '不承诺').replace(/不得(?:使用|出现|涉及|承诺)?/g, '不').replace(/禁止/g, '不').replace(/须/g, '附带').replace(/^，|，$/g, '').trim())
    .filter(Boolean)
  const complianceLine = compliance.length ? `本方案按行业合规要求处理：${esc(compliance.join('；'))}。` : ''
  const s66 = `${schedule.status === 'capacity_short' ? `<div class="risk">档期产能不足：${esc(schedule.notes[0] || '请延长档期或减少数量')}</div>` : ''}
  <div class="two-col"><div><h3>执行安排（待确认）</h3><ul class="col-list">
        <li>${schedule.batches.length} 批夜间施工，单晚上限 ${schedule.singleNightCap} 台 / 口</li>
        <li>预留 ${schedule.rainBufferNights} 个雨天顺延夜</li>
        <li>误一补二预留 ${schedule.compensationBufferQty} 台（依 4A 框架）</li>
        ${schedule.status === 'capacity_short' ? `<li>产能不足：需延长档期或减少 ${Math.max(1, quantity - schedule.batches.reduce((sum, batch) => sum + batch.quantity, 0))} 台</li>` : ''}
        <li>上刊当日报照片（带报头日期），下刊 5 个工作日报照片</li></ul></div>
    <div><h3>费用与效果说明</h3><ul class="col-list">
        ${(risks.length ? risks : ['不承诺当期曝光与人流', '不承诺转化率与到店量']).map(item => `<li>${esc(item)}</li>`).join('')}
        <li>不含素材制作与创意，折扣与票税按客户协议另议</li></ul></div></div>
  ${complianceLine ? `<p class="note" style="margin-top:16px">${complianceLine}</p>` : ''}`

  return { chips, kpis, note, s2window, s2anchors, s3table, s4, s5, s6, analysis, map, s65, s66 }
}
