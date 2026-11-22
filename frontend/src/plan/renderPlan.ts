/**
 * 唯一渲染器：预览、全屏演示与导出 HTML 都调用这里。
 * HTML 内嵌样式、预算数据及 ECharts 覆盖图资源，打开时无需网络请求。
 * 预算相关的动态区块全部由 `buildSlots` 产出；同一函数会被内联进导出文件，
 * 滑块切换时在浏览器里重跑，因此切换后的内容与首次渲染完全一致。
 */
import { PLAN_CSS } from './plan.css'
import { escapeHtml as h, copyText } from './sanitize'
import { analysisModeText, windowText, type PlanVm } from './buildVm'
import { buildSlots, type RangeData, type SlotName } from './slots'
import coverageMapScript from 'virtual:offline-coverage-map'

export interface RenderOptions {
  /** 预览时的高亮 mediaKey，导出为空。 */
  highlight?: string | null
  /** 是否追加生成记录附录（导出开启）。 */
  appendix?: boolean
  /** 演示模式：隐藏页眉右侧的版本行。 */
  fullscreen?: boolean
  /** 全区间：附带滑块与逐档内容，离线可切换。 */
  range?: RangeData
  /** 滑块初始金额（元）。 */
  budgetYuan?: number
}

const SLOTS: SlotName[] = ['strategy', 'selection', 'chips', 'kpis', 'note', 's2window', 's2anchors', 's3table', 's4', 's5', 's6', 'analysis', 'map', 's65', 's66']
const inlineScript = (code: string) => code.replace(/<\/script/gi, '<\\/script')

const STEP_LABELS: Record<string, string> = {
  candidates: '候选核对', minimum: '最低组合', preference: '偏好采纳', preference_rejected: '偏好未采用',
  pricing: '计价', schedule: '排期', 'verify.scan': '合规扫描', 'verify.analysis': '模型复核',
}
const REASON_LABELS: Record<string, string> = {
  over_budget: '超预算', no_stock: '无库存', premium_exceeded: '溢价超限', invalid_evidence: '证据无效', unknown_media: '未知媒体',
}
/** 附录面向客户：内部键与英文步骤名换成可读说明，媒体键按线路名回填。 */
function traceText(vm: PlanVm, message: string): string {
  const names = new Map(vm.lines.map(line => [line.mediaKey, `${line.kind === 'bus' ? '公交' : '地铁'} ${line.name}`]))
  return message
    .replace(/[a-z]+\|\d+\|[^\s，；、：:]+/g, key => names.get(key) ?? (key.startsWith('bus|') ? '公交候选' : '地铁候选'))
    .replace(/\b(over_budget|no_stock|premium_exceeded|invalid_evidence|unknown_media)\b/g, key => REASON_LABELS[key] || key)
    // 与自己比价没有信息量：同一资源作为基准时只说明按基准价分配。
    .replace(/([^，；。]+?) 相对同类基准 \1 的单位价差 0 元，未超过 [\d.]+% 溢价上限，本次分配 (\d+) 单位。/g, '按同类基准价分配 $2 单位。')
}

function appendixBlock(vm: PlanVm): string {
  const summary = `生成记录 · ${h(analysisModeText(vm.mode))} · ${vm.rounds.length} 轮`
  if (vm.mode === 'off') {
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
  rows.push(['计算记录', vm.trace.slice(0, 8).map(step => `${STEP_LABELS[step.step] || '计算'}：${copyText(traceText(vm, step.message), 90)}`).join('；') || '暂无计算记录。'])
  rows.push(['文案', `来源：${vm.brandContextSource}。数量与金额取自方案计算结果。`])
  rows.push(['方案检查', `共 ${vm.checks.length} 项，${vm.checks.filter(item => item.status === 'fail' && item.blocking).length} 项阻断；明细见工作台核验面板。`])
  // 来源路径属内部技术依据，交付件只留可读口径：来源类型 + 核对时间。
  const tagsOf = (line: PlanVm['lines'][number]) => {
    const joined = line.sources.join(' ')
    const tags: string[] = []
    if (/平台|覆盖|sopLabelPoints|matchCoverLines/.test(joined)) tags.push('平台覆盖分析')
    if (/红豆|归档|截面|bus\.json|metro\.json|库存/.test(joined)) tags.push('红豆库存')
    if (/pricing|刊例/.test(joined)) tags.push('刊例')
    tags.push('客流 2023-05')
    return tags.join(' · ')
  }
  const sourceRows = vm.lines.slice(0, 8).map(line => `${line.name}：${tagsOf(line)}`).join('\n')
  rows.push(['数据依据', sourceRows || '无'])
  rows.push(['备用处理', vm.degraded.length ? vm.degraded.map(item => `${item.stage}：${item.reason}`).join('；') : '无'])
  return `<details class="appendix"><summary>${summary}</summary>
    <table class="appendix-table">${rows.map(([key, value]) => `<tr><td class="k">${h(key)}</td><td>${h(value)}</td></tr>`).join('')}</table>
  </details>`
}

export function renderPlan(vm: PlanVm, options: RenderOptions = {}): string {
  const highlight = options.highlight ?? null
  const campaign = vm.campaign
  const nav = [
    ['s1', '1 概览'], ['s2', '2 需求'], ['s3', '3 推荐理由'], ['s4', '4 资源清单'], ['s5', '5 排期'], ['s6', '6 报价'], ['s7map', '7 覆盖图'], ['s65', '8 效果'],
  ]
  const head = options.fullscreen
    ? ''
    : `<header class="doc-head"><b>动线运筹 · 户外投放方案</b><span>${h(`${vm.startDate.slice(0, 4)}.${vm.startDate.slice(5, 7)} 版 · ${vm.industryName} · 生成于 ${vm.generatedAt}`)}</span></header>`

  const range = options.range
  const budgetYuan = options.budgetYuan ?? vm.request.budgetYuan
  const data = range ?? rangeDataFor(vm)
  const slots = buildSlots(data, budgetYuan, highlight)
  const hasMap = Object.values(data.mediaByKey).some(media => media.kind === 'bus' && (media.trajectory?.polyline.length ?? 0) >= 2)
  const slot = (name: SlotName) => `<div data-slot="${name}"${name === 'kpis' ? ' class="kpis"' : name === 'chips' ? ' class="chips"' : ''}>${slots[name]}</div>`

  /** 假设书⑥只写本次实际选择的媒体；与客户预设不同时括号注明预设。 */
  const mediaScopeText = () => {
    const label = (kind: string) => (kind === 'bus' ? '公交' : '地铁')
    const used = vm.request.media.length ? vm.request.media : campaign.mediaScope
    const same = used.length === campaign.mediaScope.length && used.every(kind => campaign.mediaScope.includes(kind))
    return same ? used.map(label).join(' + ') : `${used.map(label).join(' + ')}（客户预设：${campaign.mediaScope.map(label).join(' + ')}）`
  }

  const minimumBudgetNote = range?.minimumEstimateYuan !== undefined
    ? `<p class="note">本档期已核对的最低媒体组合估算为 ${h((range.minimumEstimateYuan / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 4 }))} 万元，最低可选预算档为 ${range.budget.minYuan / 10000} 万元。</p>`
    : ''
  const singleBudget = range && range.budget.minYuan === range.budget.maxYuan
  const slider = range
    ? `<div class="budget-slider" role="group" aria-label="预算推演">
    <div class="budget-head"><span class="caption">预算上限</span><b data-budget-label>${(budgetYuan / 10000).toFixed(0)} 万</b><span class="caption no-print">${singleBudget ? '本档期仅有这一预算档' : '拖动查看每个金额的清单与报价'}</span><span class="caption print-only" data-print-hint>本页为当前档位 ${(budgetYuan / 10000).toFixed(0)} 万的清单与报价</span></div>
    <input type="range" min="${range.budget.minYuan}" max="${range.budget.maxYuan}" step="${range.budget.stepYuan}" value="${budgetYuan}" aria-label="预算上限（元）" data-budget-range${singleBudget ? ' disabled' : ''}>
    <div class="budget-ticks">${range.budget.presetsYuan.map(preset => `<button type="button" class="tick" data-budget-tick="${preset}">${preset / 10000} 万</button>`).join('')}</div>
  </div>`
    : ''

  // 内嵌数据：把所有金额档位的内容一次性写进文件，滑块只做本地替换。
  const embedded = range ? JSON.stringify({ budget: range.budget, data: range }).replace(/</g, '\\u003c') : ''
  const script = range
    ? `<script id="budget-data" type="application/json">${embedded}</script>
<script>
(function () {
  var buildSlots = ${inlineScript(buildSlots.toString())};
  var payload = JSON.parse(document.getElementById('budget-data').textContent);
  var slots = ${JSON.stringify(SLOTS)};
  var current = ${budgetYuan};
  var range = document.querySelector('[data-budget-range]');
  var label = document.querySelector('[data-budget-label]');
  function apply(budget) {
    // 切到同一金额时不清空展开的明细与滚动位置。
    if (budget === current) return;
    current = budget;
    var next = buildSlots(payload.data, budget, null);
    slots.forEach(function (name) {
      var target = document.querySelector('[data-slot="' + name + '"]');
      if (target) target.innerHTML = next[name];
    });
    document.dispatchEvent(new Event('plan-map-update'));
    if (label) label.textContent = (budget / 10000) + ' 万';
    // 打印稿没有「拖动」，用同一处文案给出静态说明，跟着当前档位一起更新。
    var printHint = document.querySelector('[data-print-hint]');
    if (printHint) printHint.textContent = '本页为当前档位 ' + (budget / 10000) + ' 万的清单与报价';
    if (range && Number(range.value) !== budget) range.value = String(budget);
    // 预览内拖动时通知外层同步当前金额；导出文件没有外层，静默忽略。
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'plan-budget', budgetYuan: budget }, '*'); } catch (error) {}
  }
  if (range) range.addEventListener('input', function () { apply(Number(range.value)); });
  document.querySelectorAll('[data-budget-tick]').forEach(function (button) {
    button.addEventListener('click', function () { apply(Number(button.getAttribute('data-budget-tick'))); });
  });
  // 外层（工作台）主动切换金额时由这里响应，避免整个文档重载，保留展开状态与滚动位置。
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'plan-set-budget' && typeof event.data.budgetYuan === 'number') apply(event.data.budgetYuan);
  });
  window.__planApplyBudget = apply;
})();
</script>`
    : ''

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
  <p class="lede" data-slot="strategy">${slots.strategy}</p>
  ${slot('chips')}
  ${slot('kpis')}
  ${slot('note')}
  ${minimumBudgetNote}
  ${slider}
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
        <tr><th>③ 建议活动</th><td>${h(`${campaign.name}（主目标：${campaign.primaryGoal}）`)}</td></tr>
        <tr><th>④ 人群</th><td>${h(campaign.audience)}</td></tr>
        <tr><th>⑤ 时间与预算</th><td>${slot('s2window')}</td></tr>
        <tr><th>⑥ 媒体范围</th><td>${h(mediaScopeText())}</td></tr>
        <tr><th>⑦ 成功衡量</th><td>${h(`${campaign.successMetric.kpi}；${campaign.successMetric.proof}`)}</td></tr>
      </table>
      <p class="note" style="margin-top:12px">目标与人群见推荐理由，档期见投放排期，预算见估算报价。客户以代称呈现。</p>
    </div>
    ${slot('s2anchors')}
  </div>
</section>

<section id="s3">
  <h2>推荐理由</h2>
  <p data-slot="selection">${slots.selection}</p>
  <details><summary>查看推荐过程</summary><p>${h(vm.strategySource)}</p></details>
  <div class="split wide" style="margin-top:20px">
    <div>
      <h3>目标商圈与推荐资源</h3>
      ${slot('s3table')}
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
  ${slot('s4')}
</section>

<section id="s5">
  <h2>投放排期</h2>
  ${slot('s5')}
</section>

<section id="s6">
  <h2>估算报价</h2>
  ${slot('s6')}
  <div class="budget-panel">
    <h3>预算推演</h3>
    <p class="note">以下说明由同一轮规则计算结果生成，比较当前金额与上一档 1 万元金额的差异。</p>
    ${slot('analysis')}
  </div>
</section>

<section id="s7map">
  <h2>线路覆盖示意图</h2>
  ${hasMap ? `<div data-coverage-map hidden>
    <div class="map-controls">
      <label>底图 <select data-map-layer><option value="districts">上海行政区</option><option value="outline">上海轮廓</option></select></label>
      <label>范围 <select data-map-scope><option value="routes">入选线路</option><option value="city">上海全市</option></select></label>
    </div>
    <div class="offline-map" data-map-canvas role="img" aria-label="入选公交线路与关联商圈示意图"></div>
  </div>` : ''}
  ${slot('map')}
</section>

<section id="s65">
  <h2>历史客流参考与效果衡量</h2>
  <h3>历史覆盖参考</h3>
  ${slot('s65')}
  <div class="two-col" style="margin-top:24px">
    <div>
      <h3>效果指标</h3>
      <p>${h(campaign.successMetric.kpi)}</p>
      <p class="note">以客户假设书为准，AI 建议口径仅作参考。</p>
      ${vm.measurement ? `<p class="note">AI 建议口径：${h(copyText(vm.measurement.kpi, 160))}</p>` : ''}
    </div>
    <div>
      <h3>衡量方式</h3>
      <ul class="col-list">${campaign.successMetric.proof.split(/[+、；;，,]/).filter(Boolean).map(item => `<li>${h(item.trim())}</li>`).join('')}</ul>
    </div>
  </div>
</section>

<section id="s66">
  <h2>执行安排与待确认事项</h2>
  ${slot('s66')}
  ${vm.exportAllowed ? '' : '<div class="risk bad">下载前请先按检查提示修改文案。</div>'}
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
${script}
${hasMap ? `<script>${inlineScript(coverageMapScript)}</script>` : ''}
</body></html>`
}

/** 单预算（基础方案、旧接口）没有全区间数据时，用一个金额现场组装同样结构。 */
function rangeDataFor(vm: PlanVm): RangeData {
  const budgetYuan = vm.request.budgetYuan
  return {
    budget: { minYuan: budgetYuan, maxYuan: budgetYuan, stepYuan: 10000, presetsYuan: [budgetYuan], defaultYuan: budgetYuan },
    budgetOptions: [{
      budgetYuan, status: 'ok', totalYuan: vm.total.yuan, remainingYuan: vm.remaining.yuan,
      lines: vm.lines.map(line => ({ mediaKey: line.mediaKey, quantity: line.quantity, lineTotalYuan: line.lineTotalYuan, ...(line.preferredByAi ? { preferredByAi: true } : {}) })),
      schedule: vm.schedule,
      selectedAnchors: vm.anchors.filter(anchor => anchor.selectedCount > 0).map(anchor => ({ anchorId: anchor.id, selectedCount: anchor.selectedCount })),
      analysis: [],
    }],
    mediaByKey: Object.fromEntries(vm.lines.map(line => [line.mediaKey, {
      mediaKey: line.mediaKey, kind: line.kind, name: line.name, levelName: line.levelName,
      ...(line.variant && line.variant !== '—' ? (line.kind === 'bus' ? { mediaForm: line.variant } : { exit: line.variant }) : {}),
      ...(line.total === undefined ? {} : { total: line.total }), freeCount: line.freeCount, contractCount: line.contractCount, reservedCount: line.reservedCount,
      monthlyLowYuan: line.monthlyLowYuan, monthlyHighYuan: line.monthlyHighYuan,
      productionUnitYuan: line.quantity ? line.productionYuan / line.quantity : 0, unitEstimateYuan: line.quantity ? line.lineTotalYuan / line.quantity : 0,
      anchorIds: line.anchorIds, evidenceRefs: [], reasons: line.reasons, sources: line.sources, assumptions: vm.assumptions,
      ...(line.traffic ? { trafficReference: line.traffic } : {}),
      ...(line.trajectory ? { trajectory: line.trajectory } : {}),
    }])),
    anchors: vm.anchors.map(anchor => ({ id: anchor.id, areaName: anchor.areaName, station: anchor.station, role: anchor.role === 'landmark' ? 'landmark' as const : 'businessArea' as const, rationale: anchor.rationale,
      candidateCounts: { bus: anchor.busCount ?? 0, metro: anchor.metroCount ?? 0 }, selectedCount: anchor.selectedCount, ...(anchor.coord ? { coord: { ...anchor.coord, source: '' } } : {}) })),
    campaign: { name: vm.campaign.name, businessGoal: vm.campaign.businessGoal, primaryGoal: vm.campaign.primaryGoal, audience: vm.campaign.audience,
      window: vm.campaign.window, budgetHintYuan: vm.campaign.budgetHintYuan, mediaScope: vm.campaign.mediaScope,
      successMetric: vm.campaign.successMetric, constraints: vm.campaign.constraints },
    client: vm.client,
    inventory: vm.inventory ? { startDate: vm.inventory.startDate, endDate: vm.inventory.endDate, billingStatus: vm.inventory.billingStatus,
      kinds: vm.inventory.kinds }
      : { startDate: vm.startDate, endDate: vm.endDate, billingStatus: vm.billingPending ? 'pending' : 'confirmed', kinds: [] },
    queriedAt: vm.queriedAt,
    billingMonths: vm.billingMonths,
    billingStatus: vm.billingPending ? 'pending' : 'confirmed',
    requestMedia: [...vm.request.media],
    assumptions: vm.assumptions,
    notices: vm.notices,
    mode: vm.mode,
    industryName: vm.industryName,
  }
}

export function planFileName(vm: PlanVm): string {
  // 预算在成品内可切换，文件名固定按行业与起始日命名，不再写入预算金额。
  return `投放方案-${vm.industryName}-${vm.request.startDate}.html`
}
