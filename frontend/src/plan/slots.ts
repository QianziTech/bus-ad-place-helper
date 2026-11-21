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

export type SlotName = 'chips' | 'kpis' | 'note' | 's2anchors' | 's3table' | 's4' | 's5' | 's6' | 'analysis' | 'map' | 's65' | 's66'

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
  const empty: Record<SlotName, string> = { chips: '', kpis: '', note: '', s2anchors: '', s3table: '', s4: '', s5: '', s6: '', analysis: '', map: '', s65: '', s66: '' }
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
      freeCount: source.freeCount, monthlyLowYuan: source.monthlyLowYuan, monthlyHighYuan: source.monthlyHighYuan,
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
    const details = [
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
    <td><details><summary>${star}${esc(line.name)}</summary>${details}</details></td>
    <td>${esc(variant(line))}</td>
    <td>${esc(levelLabel(line.levelName))}</td>
    <td class="num" data-src="${esc(`本档期可售 ${line.freeCount}${line.total !== undefined ? ` / 总量 ${line.total}` : ''}`)}">${line.freeCount}</td>
    <td class="num">${line.quantity}</td>
    <td class="num">${wanRange(line.monthlyLowYuan, line.monthlyHighYuan)}</td>
    <td class="num">${esc(`¥${line.productionYuan.toLocaleString('zh-CN')}`)}</td>
    <td class="num"><b>${esc(wanMoney(line.lineTotalYuan))}</b></td>
  </tr>`
  }
  const table = (subset: typeof lines) => subset.length
    ? `<table class="data"><thead><tr><th>线路 / 站点</th><th>形式 / 出口</th><th>等级</th><th class="num">可售</th><th class="num">数量</th><th class="num">月价（区间）</th><th class="num">制作费</th><th class="num">行合计</th></tr></thead><tbody>${subset.map(row).join('')}</tbody></table>`
    : '<p class="muted">本次没有该类媒体入选。</p>'

  const chips = `<span class="chip on">${esc(data.industryName)}</span>
    <span class="chip">预算上限 ${esc(`${budgetYuan / 10000} 万`)}</span>
    <span class="chip">${esc(data.campaign.mediaScope.map(kind => (kind === 'bus' ? '公交车身' : '地铁出入口')).join(' + '))}</span>
    <span class="chip">${esc(windowText(data.inventory.startDate, data.inventory.endDate))}</span>`
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
  const s3table = `<table class="data"><thead><tr><th>商圈</th><th>站点</th><th class="num">公交候选</th><th class="num">地铁候选</th><th class="num">已选资源</th></tr></thead><tbody>${anchors.map(anchor => `<tr><td>${esc(anchor.areaName)}</td><td>${esc(anchor.station || '—')}</td><td class="num">${anchor.candidateCounts ? anchor.candidateCounts.bus : '—'}</td><td class="num">${anchor.candidateCounts ? anchor.candidateCounts.metro : '—'}</td><td class="num">${anchor.selectedCount}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">暂无商圈资料。</td></tr>'}</tbody></table>`
  const s4 = `<h3 style="margin-top:20px">公交车身（${busLines.length} 条线路 · ${busLines.reduce((sum, line) => sum + line.quantity, 0)} 台）</h3>
  ${table(busLines)}
  <h3 style="margin-top:32px">地铁出入口（${metroLines.length} 个出口 · ${metroLines.reduce((sum, line) => sum + line.quantity, 0)} 个）</h3>
  ${table(metroLines)}
  <p class="note" style="margin-top:12px">建议数量不超过所选档期可售量；报价仅包含表内资源。${lines.some(line => line.preferredByAi) ? '<span class="star">★</span> 表示 AI 推荐资源。' : ''}</p>`
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
  <p class="note" style="margin-top:10px">报价一节保留两位小数，便于按「数量 × 单位估算 = 行合计」「Σ 行合计 = 估算总额」逐项验算；其余章节按一位小数显示。</p>
  <div class="split" style="margin-top:24px"><div>
      <table class="summary-table">
        <tr><td>媒体费小计</td><td class="num">${esc(money2(totalMedia))}</td></tr>
        <tr><td>制作费小计</td><td class="num">${esc(money2(totalProduction))}</td></tr>
        <tr><td><b>估算总额</b></td><td class="num"><b>${esc(money2(total))}</b></td></tr>
        <tr><td>预算上限</td><td class="num">${esc(money2(budgetYuan))}</td></tr>
        <tr><td>余量</td><td class="num">${esc(money2(remaining))}</td></tr>
      </table>
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
    ? `<div class="cards" style="grid-template-columns:repeat(2,1fr)">${busLines.slice(0, 4).map(line => `<div class="card"><h3>${esc(line.name)}</h3><small>${line.traffic && line.traffic.coveragePv !== undefined ? `2023-05 历史覆盖 ${line.traffic.coveragePv.toLocaleString('zh-CN')} 人次` : '暂无数据'}${line.traffic && line.traffic.ageGroups && line.traffic.ageGroups.length ? `<br>${line.traffic.ageGroups.map(group => `${esc(group.label)} ${group.percent}%`).join(' · ')}` : ''}</small></div>`).join('')}</div>
      <p class="note" style="margin-top:10px">不同线路的历史覆盖人次按平台 250 米网格口径分别统计，不可相加，本方案不以该数作为触达承诺。来源：${esc((busLines.filter(line => line.traffic)[0] || { traffic: { source: '可视化平台 2023-05 历史数据' } }).traffic!.source)}。</p>`
    : '<p class="muted">本次未选公交，地铁暂无对应历史覆盖数据。</p>'

  const risks = data.assumptions.slice(0, 5)
  const s66 = `${schedule.status === 'capacity_short' ? `<div class="risk">档期产能不足：${esc(schedule.notes[0] || '请延长档期或减少数量')}</div>` : ''}
  <div class="two-col"><div><h3>执行安排（待确认）</h3><ul class="col-list">
        <li>${schedule.batches.length} 批夜间施工，单晚上限 ${schedule.singleNightCap} 台 / 口</li>
        <li>预留 ${schedule.rainBufferNights} 个雨天顺延夜</li>
        <li>误一补二预留 ${schedule.compensationBufferQty} 台（依 4A 框架）</li>
        ${schedule.status === 'capacity_short' ? `<li>产能不足：需延长档期或减少 ${Math.max(1, quantity - schedule.batches.reduce((sum, batch) => sum + batch.quantity, 0))} 台</li>` : ''}
        <li>上刊当日报照片（带报头日期），下刊 5 个工作日报照片</li></ul></div>
    <div><h3>费用与效果说明</h3><ul class="col-list">
        ${(risks.length ? risks : ['不承诺当期曝光与人流', '不承诺转化率与到店量']).map(item => `<li>${esc(item)}</li>`).join('')}
        <li>不含素材制作与创意，折扣与税票按客户协议另议</li></ul></div></div>
  <div class="two-col" style="margin-top:24px"><div><h3>行业约束</h3>
      <ul class="col-list">${data.campaign.constraints.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div></div>`

  return { chips, kpis, note, s2anchors, s3table, s4, s5, s6, analysis, map, s65, s66 }
}
