/**
 * 唯一渲染器：预览、全屏演示与导出 HTML 都调用这里。
 * 只输出原生 HTML + 内联 CSS，不引入任何组件库，不发起任何网络请求。
 */
import { PLAN_CSS } from './plan.css'
import { escapeHtml as h, copyText } from './sanitize'
import { analysisModeText, wanRange, yuanText, windowText, type PlanVm, type PlanVmAnchor, type PlanVmLine } from './buildVm'

const w = (yuan: number) => yuanText(yuan)
const wan = (yuan: number) => `${Math.round(yuan / 1000) / 10} 万`

export interface RenderOptions {
  /** 预览时的高亮 mediaKey，导出为空。 */
  highlight?: string | null
  /** 是否追加 trace 附录（导出开启）。 */
  appendix?: boolean
  /** 演示模式：隐藏页眉右侧的版本行。 */
  fullscreen?: boolean
}

function anchorCard(anchor: PlanVmAnchor) {
  const coord = anchor.coord
    ? `<details><summary>查看坐标</summary><p>${anchor.coord.lng.toFixed(6)}, ${anchor.coord.lat.toFixed(6)}${anchor.coord.exit ? ` · ${h(anchor.coord.exit)}` : ''}</p></details>`
    : ''
  return `<div class="card">
    <h3>${h(anchor.areaName)}</h3>
    <small>${anchor.station ? `站点 ${h(anchor.station)} · ` : ''}${anchor.role === 'landmark' ? '地标' : '业务区'}</small>
    <p style="margin:8px 0 0;font-size:14px">${anchor.busCount === null && anchor.metroCount === null ? '周边候选暂无数据' : `周边候选 公交 ${anchor.busCount ?? '—'} · 地铁 ${anchor.metroCount ?? '—'}`}<br><span class="muted">本方案选中 ${anchor.selectedCount} 项</span></p>
    ${anchor.rationale ? `<p class="note" style="margin-top:6px">${h(copyText(anchor.rationale, 120))}</p>` : ''}
    ${coord}
  </div>`
}

function lineRow(line: PlanVmLine, anchorNames: string[], highlight: string | null) {
  const star = line.preferredByAi ? '<span class="star" title="AI 推荐资源">★ </span>' : ''
  const src = `本档期可售 ${line.freeCount}${line.total !== undefined ? ` / 总量 ${line.total}` : ''}`
  const details = [
    line.reasons.length ? `<p><b>入选理由</b></p><ul>${line.reasons.map(item => `<li>${h(item)}</li>`).join('')}</ul>` : '',
    line.sources.length ? `<p><b>来源</b></p><ul>${line.sources.map(item => `<li>${h(item)}</li>`).join('')}</ul>` : '',
    anchorNames.length ? `<p>关联商圈：${h(anchorNames.join('、'))}</p>` : '',
    line.kind === 'bus'
      ? line.traffic
        ? `<p><b>2023-05 历史覆盖 ${line.traffic.coveragePv !== undefined ? line.traffic.coveragePv.toLocaleString('zh-CN') : '暂无数据'} 人次</b>${line.traffic.ageGroups?.length ? `<br>年龄分布 ${line.traffic.ageGroups.map(group => `${h(group.label)} ${group.percent}%`).join(' · ')}` : ''}<br><span class="muted">${h(line.traffic.source)} · 仅作人群参考，不与其它线路相加</span></p>`
        : '<p class="muted">暂无数据：该线路未取得 2023-05 历史覆盖与年龄画像。</p>'
      : '<p class="muted">地铁暂无对应历史覆盖数据。</p>',
  ].filter(Boolean).join('')
  const cls = highlight === line.mediaKey ? ' class="hl"' : ''
  return `<tr${cls} data-key="${h(line.mediaKey)}">
    <td><details><summary>${star}${h(line.name)}</summary>${details}</details></td>
    <td>${h(line.variant)}</td>
    <td>${h(line.levelName)}</td>
    <td class="num" data-src="${h(src)}">${line.freeCount}</td>
    <td class="num">${line.quantity}</td>
    <td class="num">${wanRange(line.monthlyLowYuan, line.monthlyHighYuan)}</td>
    <td class="num">${h(`¥${line.productionYuan.toLocaleString('zh-CN')}`)}</td>
    <td class="num"><b>${h(w(line.lineTotalYuan))}</b></td>
  </tr>`
}

function listTable(lines: PlanVmLine[], anchors: PlanVmAnchor[], highlight: string | null) {
  if (!lines.length) return '<p class="muted">本次没有该类媒体入选。</p>'
  const rows = lines
    .map(line => {
      const names = anchors
        .filter(anchor => line.reasons.some(reason => reason.startsWith(anchor.areaName)))
        .map(anchor => anchor.areaName)
      return lineRow(line, names, highlight)
    })
    .join('')
  return `<table class="data">
    <thead><tr><th>线路 / 站点</th><th>形式 / 出口</th><th>等级</th><th class="num">可售</th><th class="num">数量</th><th class="num">月价（区间）</th><th class="num">制作费</th><th class="num">行合计</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

function scheduleBlock(vm: PlanVm) {
  const schedule = vm.schedule
  if (!schedule || schedule.status === 'unavailable' || !schedule.batches.length) {
    return `<p class="muted">本次没有可编排的施工批次。</p>`
  }
  const rows = schedule.batches
    .map(batch => {
      const names = batch.mediaKeys
        .map(key => vm.lines.find(line => line.mediaKey === key))
        .filter(Boolean)
        .map(line => `${line!.kind === 'metro' ? '地铁' : '公交'} ${line!.name}${line!.kind === 'metro' ? ` · ${line!.variant}` : ''}`)
        .join('、')
      return `<tr><td>${batch.no}</td><td>${h(batch.nightDate.slice(5))} 夜</td><td>${h(names)}</td><td class="num">${batch.quantity}</td><td class="num">${batch.cumulative}</td><td>${h(`${batch.publishStartDate} 08:00`)}</td></tr>`
    })
    .join('')
  const neededNights = Math.ceil(vm.quantity / Math.max(1, schedule.singleNightCap))
  const capacity = schedule.status === 'capacity_short'
    ? `<div class="risk">当前产能 ${schedule.batches.length} 夜 < 所需 ${neededNights} 夜：请延长档期或减少 ${Math.max(1, vm.quantity - schedule.batches.reduce((sum, batch) => sum + batch.quantity, 0))} 台。</div>`
    : ''
  return `${capacity}
  <table class="data batch">
    <thead><tr><th>批次</th><th>施工夜</th><th>主要线路 / 点位</th><th class="num">数量</th><th class="num">累计</th><th>发布期起算</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="note" style="margin-top:12px">已预留 ${schedule.rainBufferNights} 个雨天顺延夜 · 误一补二预留 ${schedule.compensationBufferQty} 台。多批施工时，发布期以最后一批施工照的次日 08:00 起算；本方案计划 ${schedule.batches.length} 批，计费起算按最晚一批提示。</p>`
}

function checksBlock(vm: PlanVm) {
  if (!vm.checks.length) return '<p class="muted">本次未返回核验结果。</p>'
  const icon = { pass: '✓', warn: '!', fail: '✗' } as const
  const items = vm.checks
    .map(check => {
      const refs = check.evidenceRefs?.length ? `<small class="muted">证据 ${h(check.evidenceRefs.slice(0, 3).join(' · '))}</small>` : ''
      const fix = check.suggestion ? `<br><span class="muted">建议：${h(check.suggestion)}</span>` : ''
      return `<li><span class="mark ${check.status}">${icon[check.status]}</span><span>${h(check.element)} ${h(check.message)}${fix}</span>${refs}</li>`
    })
    .join('')
  const pass = vm.checks.filter(item => item.status === 'pass').length
  const warn = vm.checks.filter(item => item.status === 'warn').length
  const fail = vm.checks.filter(item => item.status === 'fail').length
  return `<p class="note">方案检查：${pass} 通过 · ${warn} 待确认 · ${fail} 未通过</p><ul class="checks">${items}</ul>`
}

function appendixBlock(vm: PlanVm) {
  const offLine = vm.mode === 'off'
  const summary = `生成记录 · ${h(analysisModeText(vm.mode))} · ${vm.rounds.length} 轮`
  if (offLine) {
    return `<details class="appendix"><summary>${summary}</summary>
    <p>本次按库存和预算规则生成方案，使用模板文案，未使用 AI 分析。</p>
  </details>`
  }
  const briefText = vm.request.briefText?.trim()
  const rows: [string, string][] = []
  rows.push(['客户需求', briefText ? `已采用补充需求（${briefText.length} 字），未提及的内容沿用行业预置。` : '使用行业预置需求。'])
  rows.push(['策略', vm.rounds.length
    ? vm.rounds.map(round => `第 ${round.round} 轮：候选 ${round.candidateCount}，推荐 ${round.preferredCount}，采用 ${round.acceptedCount}，未采用 ${round.rejected.length}${round.requestReplan ? '（继续调整）' : ''}`).join('；')
    : '本次未返回分轮记录。'])
  rows.push(['计算记录', vm.trace.slice(0, 8).map(step => `${step.step}：${copyText(step.message, 90)}`).join('；') || '暂无计算记录。'])
  rows.push(['文案', `来源：${vm.brandContextSource}。数量与金额取自方案计算结果。`])
  rows.push(['方案检查', `共 ${vm.checks.length} 项检查，${vm.checks.filter(item => item.status === 'fail').length} 项未通过。`])
  rows.push(['备用处理', vm.degraded.length ? vm.degraded.map(item => `${item.stage}：${item.reason}`).join('；') : '无'])
  return `<details class="appendix"><summary>${summary}</summary>
    <table class="appendix-table">${rows.map(([key, value]) => `<tr><td class="k">${h(key)}</td><td>${h(value)}</td></tr>`).join('')}</table>
  </details>`
}

export function renderPlan(vm: PlanVm, options: RenderOptions = {}): string {
  const highlight = options.highlight ?? null
  const chips = vm.chips[0]
  const campaign = vm.campaign
  const anchorWork = vm.anchors.slice(0, 6)
  const risks = vm.assumptions.slice(0, 5)
  const nav = [
    ['s1', '1 概览'], ['s2', '2 需求'], ['s3', '3 推荐理由'], ['s4', '4 资源清单'], ['s5', '5 排期'], ['s6', '6 报价'],
  ]
  const head = options.fullscreen
    ? ''
    : `<header class="doc-head"><b>动线运筹 · 户外投放方案</b><span>${h(`${vm.startDate.slice(0, 4)}.${vm.startDate.slice(5, 7)} 版 · ${vm.industryName} · 生成于 ${vm.generatedAt}`)}</span></header>`

  const shares = vm.shares
    .map(item => `<div class="bar"><span>${h(item.label)}</span><span class="track"><span class="fill${item.kind === 'metro' ? ' alt' : ''}" style="display:block;width:${Math.max(2, item.pct)}%;height:100%"></span></span><span>${h(w(item.yuan))} · ${item.pct}%</span></div>`)
    .join('')

  const checkSummary = vm.exportAllowed ? '' : '<div class="risk bad">下载前请先按检查提示修改文案。</div>'

  const s65Traffic = vm.busLines.length
    ? `<div class="cards" style="grid-template-columns:repeat(2,1fr)">${vm.busLines.slice(0, 4).map(line => `<div class="card"><h3>${h(line.name)}</h3><small>${line.traffic?.coveragePv !== undefined ? `2023-05 历史覆盖 ${line.traffic.coveragePv.toLocaleString('zh-CN')} 人次` : '暂无数据'}${line.traffic?.ageGroups?.length ? `<br>${line.traffic.ageGroups.map(group => `${h(group.label)} ${group.percent}%`).join(' · ')}` : ''}</small></div>`).join('')}</div>
      <p class="note" style="margin-top:10px">不同线路的历史覆盖人次按平台 250 米网格口径分别统计，不可相加，本方案不以该数作为触达承诺。来源：${h(vm.busLines.find(line => line.traffic)?.traffic?.source || '可视化平台 2023-05 历史数据')}。</p>`
    : '<p class="muted">本次未选公交，地铁暂无对应历史覆盖数据。</p>'

  // 行金额 = 数量 × 单位估算；单位估算 = 月刊例中值 × 计费月数 + 行内制作费 / 数量。
  // 报价一节统一保留两位，保证「数量 × 单位估算 = 行合计」「Σ行合计 = 估算总额」现场可直接验算。
  const money2 = (yuan: number) => `¥${(Math.round(yuan / 100) / 100).toFixed(2)} 万`
  const methodRows = vm.lines
    .map(line => {
      const unitEstimate = line.lineTotalYuan / line.quantity
      const monthlyMid = Math.round((line.monthlyLowYuan + line.monthlyHighYuan) / 2)
      const detail = `${wanRange(line.monthlyLowYuan, line.monthlyHighYuan)} × ${vm.billingMonths} 月 + 制作`
      return `<tr><td>${h(line.name)}</td><td>${h(line.kind === 'bus' ? '公交车身' : '地铁出入口')}</td><td>${h(line.variant)}</td><td class="num">${line.quantity}</td><td class="num" data-src="${h(`月刊例中值 ${w(monthlyMid)} × ${vm.billingMonths} 月 + 制作费 ${w(line.productionYuan)}`)}">${h(money2(unitEstimate))}<br><small>${h(detail)}</small></td><td class="num">${h(money2(line.lineTotalYuan))}</td></tr>`
    })
    .join('')

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(`${vm.headlineTemplate} · 动线运筹`)}</title>
<style>${PLAN_CSS}</style></head>
<body>
${head}
<nav class="sections" aria-label="方案章节">${nav.map(([id, label]) => `<a href="#${id}">${h(label)}</a>`).join('')}</nav>
<main class="doc">
<section id="s1">
  <p class="kicker">户外投放方案</p>
  <p class="kicker" style="margin-top:10px">${h(vm.headlineTemplate)}</p>
  <h1>${h(vm.headline)}</h1>
  <p class="lede">${h(copyText(vm.copy.strategyLine, 160) || `${chips.industry} · ${chips.media} · ${chips.window}`)}</p>
  <div class="chips">
    <span class="chip on">${h(chips.industry)}</span>
    <span class="chip">预算上限 ${h(chips.budget)}</span>
    <span class="chip">${h(chips.media)}</span>
    <span class="chip">${h(chips.window)}</span>
  </div>
  <div class="kpis">
    <div class="kpi"><b>${vm.quantity}<em>台 / 个</em></b><small>媒体单位</small></div>
    <div class="kpi"><b>${vm.busLineCount + vm.metroLines.length}<em>条 / 个</em></b><small>公交线路 · 地铁出口</small></div>
    <div class="kpi"><b>${h(vm.total.text)}</b><small>估算总额</small></div>
    <div class="kpi"><b>${h(vm.remaining.text)}</b><small>预算余量</small></div>
  </div>
  <p class="note" style="margin-top:16px">${vm.mode === 'mock' ? '演示方案 · ' : ''}报价按刊例区间中值估算，详见报价明细。</p>
</section>

<section id="s2">
  <h2>投放需求</h2>
  <p class="note">Campaign 假设书</p>
  <div class="split">
    <div>
      <p>${h(copyText(vm.copy.brandContext, 320) || '客户背景与活动目标为提案假设，需与客户确认。')}</p>
      <table class="brief">
        <tr><th>① 客户</th><td>${h(`${vm.client.code} · ${vm.client.alias}`)}<br><small>${h(`${vm.client.category} · ${vm.client.scale}`)}</small></td></tr>
        <tr><th>② 生意目标</th><td>${h(campaign.businessGoal)}</td></tr>
        <tr><th>③ 投放活动</th><td>${h(`${campaign.name}（主目标：${campaign.primaryGoal}）`)}</td></tr>
        <tr><th>④ 人群</th><td>${h(campaign.audience)}</td></tr>
        <tr><th>⑤ 时间与预算</th><td>${h(`${campaign.window.start} ~ ${campaign.window.end} · 建议 ${Math.round(campaign.budgetHintYuan / 10000)} 万（本次上限 ${chips.budget}）`)}</td></tr>
        <tr><th>⑥ 媒体范围</th><td>${h(campaign.mediaScope.map(kind => (kind === 'bus' ? '公交' : '地铁')).join(' + '))}${vm.copy.strategyLine ? ` · ${h(copyText(vm.copy.strategyLine, 60))}` : ''}</td></tr>
        <tr><th>⑦ 成功衡量</th><td>${h(`${campaign.successMetric.kpi}；${campaign.successMetric.proof}`)}</td></tr>
      </table>
      <p class="note" style="margin-top:12px">目标与人群见推荐理由，档期见投放排期，预算见估算报价。客户以代称呈现。</p>
    </div>
    <div>
      ${anchorWork.length ? `<div class="cards" style="grid-template-columns:1fr 1fr">${anchorWork.map(anchorCard).join('')}</div>` : `<div class="card"><p class="muted">${h(vm.anchorNotice || '暂无商圈资料。')}</p></div>`}
    </div>
  </div>
</section>

<section id="s3">
  <h2>推荐理由</h2>
  <p>${h(copyText(vm.copy.selectionRationale, 300) || '公交承担面覆盖与补量，地铁集中核心商圈出入口；具体取舍见清单与来源。')}</p>
  <details><summary>查看推荐过程</summary><p>${h(vm.strategySource)}</p></details>
  <div class="split wide" style="margin-top:20px">
    <div>
      <h3>目标商圈与推荐资源</h3>
      <table class="data">
        <thead><tr><th>商圈</th><th>站点</th><th class="num">公交候选</th><th class="num">地铁候选</th><th class="num">已选资源</th></tr></thead>
        <tbody>${vm.anchors.map(anchor => `<tr><td>${h(anchor.areaName)}</td><td>${h(anchor.station || '—')}</td><td class="num">${anchor.busCount ?? '—'}</td><td class="num">${anchor.metroCount ?? '—'}</td><td class="num">${anchor.selectedCount}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">暂无商圈资料。</td></tr>'}</tbody>
      </table>
      <p class="note" style="margin-top:10px">候选来自周边 1.2 km 覆盖分析，不代表可售数量。同一资源可能关联多个商圈，各商圈数量不可直接相加。</p>
    </div>
    <div class="card">
      <h3>资源与库存来源</h3>
      <p style="font-size:14px;margin-bottom:6px"><b>周边线路</b><br><span class="muted">可视化平台 1.2 km 覆盖分析，回答「附近有哪些线路」。</span></p>
      <p style="font-size:14px;margin:0"><b>可售量</b><br><span class="muted">红豆媒体库，核对档期 ${h(windowText(vm.startDate, vm.endDate))}，查询于 ${h(vm.queriedAtText)}。</span></p>
      <p class="note" style="margin-top:10px">所选资源同时具备推荐依据与档期库存。</p>
    </div>
  </div>
</section>

<section id="s4">
  <h2>线路与点位清单</h2>
  <h3 style="margin-top:20px">公交车身（${vm.busLines.length} 条线路 · ${vm.busLines.reduce((sum, line) => sum + line.quantity, 0)} 台）</h3>
  ${listTable(vm.busLines, vm.anchors, highlight)}
  <h3 style="margin-top:32px">地铁出入口（${vm.metroLines.length} 个出口 · ${vm.metroPointCount} 个）</h3>
  ${listTable(vm.metroLines, vm.anchors, highlight)}
  <p class="note" style="margin-top:12px">建议数量不超过所选档期可售量；报价仅包含表内资源。${vm.lines.some(line => line.preferredByAi) ? '<span class="star">★</span> 表示 AI 推荐资源。' : ''}</p>
</section>

<section id="s5">
  <h2>投放排期</h2>
  <div class="tl"><b>${h(windowText(vm.startDate, vm.endDate))}</b><br><small>${vm.billingMonths} 个计费月 · 库存核对于 ${h(vm.queriedAtText)}</small></div>
  <h3 style="margin-top:12px">上线批次（夜间施工，单晚上限 ${vm.schedule.singleNightCap} 台 / 口）</h3>
  ${scheduleBlock(vm)}
  <p class="note">本方案展示计划投放档期；实际施工与上刊由签约后的执行流程确认。</p>
</section>

<section id="s6">
  <h2>估算报价</h2>
  <table class="data">
    <thead><tr><th>线路 / 点位</th><th>媒体类别</th><th>形式 / 出口</th><th class="num">数量</th><th class="num">单位估算（含制作）</th><th class="num">行合计</th></tr></thead>
    <tbody>${methodRows}</tbody>
  </table>
  <p class="note" style="margin-top:10px">报价一节保留两位小数，便于按「数量 × 单位估算 = 行合计」「Σ 行合计 = 估算总额」逐项验算；其余章节按一位小数显示。</p>
  <div class="split" style="margin-top:24px">
    <div>
      <table class="summary-table">
        <tr><td>媒体费小计</td><td class="num">${h(money2(vm.totalMediaFeeYuan))}</td></tr>
        <tr><td>制作费小计</td><td class="num">${h(money2(vm.totalProductionYuan))}</td></tr>
        <tr><td><b>估算总额</b></td><td class="num"><b>${h(money2(vm.total.yuan))}</b></td></tr>
        <tr><td>预算上限</td><td class="num">${h(money2(vm.request.budgetYuan))}</td></tr>
        <tr><td>余量</td><td class="num">${h(money2(vm.remaining.yuan))}</td></tr>
      </table>
      <h3 style="margin-top:24px">媒体占比</h3>
      ${shares || '<p class="muted">本方案没有计入媒体费的行。</p>'}
    </div>
    <div class="card">
      <h3>计费假设</h3>
      <ul class="col-list">${vm.assumptions.map(item => `<li>${h(item)}</li>`).join('') || '<li>暂无额外假设。</li>'}</ul>
      <p class="note" style="margin-top:10px">金额为按刊例区间中值的估算，最终以合同为准。</p>
    </div>
  </div>
</section>

<section id="s65">
  <h2>历史客流参考与效果衡量</h2>
  <h3>历史覆盖参考</h3>
  ${s65Traffic}
  <div class="two-col" style="margin-top:24px">
    <div>
      <h3>效果指标</h3>
      <p>${h(campaign.successMetric.kpi)}</p>
      <p class="note">以客户假设书为准，AI 建议口径仅作参考。</p>
      ${vm.measurement ? `<p class="note">AI 建议口径：${h(copyText(vm.measurement.kpi, 160))}</p>` : ''}
      ${vm.copy.assumptionEcho ? `<p class="note">假设书回应：${h(copyText(vm.copy.assumptionEcho, 200))}</p>` : ''}
    </div>
    <div>
      <h3>衡量方式</h3>
      <ul class="col-list">${campaign.successMetric.proof.split(/[+、；;，,]/).filter(Boolean).map(item => `<li>${h(item.trim())}</li>`).join('')}</ul>
    </div>
  </div>
</section>

<section id="s66">
  <h2>执行安排与待确认事项</h2>
  ${vm.schedule?.status === 'capacity_short' ? `<div class="risk">档期产能不足：${h(vm.schedule.notes[0] || '请延长档期或减少数量')}</div>` : ''}
  <div class="two-col">
    <div>
      <h3>执行安排（待确认）</h3>
      <ul class="col-list">
        <li>${vm.schedule.batches.length} 批夜间施工，单晚上限 ${vm.schedule.singleNightCap} 台 / 口</li>
        <li>预留 ${vm.schedule.rainBufferNights} 个雨天顺延夜</li>
        <li>误一补二预留 ${vm.schedule.compensationBufferQty} 台（依 4A 框架）</li>
        ${vm.schedule.status === 'capacity_short' ? `<li>产能不足：需延长档期或减少 ${Math.max(1, vm.quantity - vm.schedule.batches.reduce((sum, batch) => sum + batch.quantity, 0))} 台</li>` : ''}
        <li>上刊当日报照片（带报头日期），下刊 5 个工作日报照片</li>
      </ul>
    </div>
    <div>
      <h3>费用与效果说明</h3>
      <ul class="col-list">
        ${(risks.length ? risks : ['不承诺当期曝光与人流', '不承诺转化率与到店量']).map(item => `<li>${h(item)}</li>`).join('')}
        <li>不含素材制作与创意，折扣与税票按客户协议另议</li>
      </ul>
    </div>
  </div>
  <div class="two-col" style="margin-top:24px">
    <div>
      <h3>方案检查</h3>
      ${checksBlock(vm)}
    </div>
    <div>
      <h3>行业约束</h3>
      <ul class="col-list">${campaign.constraints.map(item => `<li>${h(item)}</li>`).join('')}</ul>
    </div>
  </div>
  ${checkSummary}
</section>

<section id="s7">
  <h2>数据声明</h2>
  <p>库存来源：红豆媒体库。本方案核对档期 ${h(vm.startDate)} 至 ${h(vm.endDate)}，查询日期 ${h(vm.queriedAtText)}，占用随合同变化。</p>
  <p>商圈与周边线路依据可视化平台，站点与可售量依据红豆媒体库。</p>
  <p>客户背景与活动目标为我方提案假设，非客户指定。</p>
  ${vm.notices.length ? `<ul class="col-list" style="margin-top:12px">${vm.notices.map(item => `<li>${h(item)}</li>`).join('')}</ul>` : ''}
  ${options.appendix ? appendixBlock(vm) : ''}
</section>

<footer class="doc-foot">
  <p>动线运筹 v1.0 · 生成于 ${h(vm.generatedAt)} · 数据核对 ${h(vm.queriedAtText)}</p>
  <p>客户一律以代称呈现；报价为刊例区间中值估算，不含真实成交价。</p>
  <p>推荐依据见「推荐理由」，数据来源可展开资源明细查看。</p>
</footer>
</main>
</body></html>`
}

export function planFileName(vm: PlanVm): string {
  const budget = Math.round(vm.request.budgetYuan / 10000)
  return `投放方案-${vm.industryName}-${budget}万-${vm.request.startDate}.html`
}
