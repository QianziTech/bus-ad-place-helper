/**
 * 方案文档样式：原生 CSS 字符串，导出时内联。
 * 只依赖系统字体，不含任何外部资源或组件库运行时。
 */
export const PLAN_CSS = `
:root{color-scheme:light;--ink:#1a1d21;--ink-2:#5b6470;--ink-3:#8a929c;--line:#e3e6ea;--bg:#fff;--canvas:#f4f5f6;--primary:#0e5c63;--primary-wash:#eaf2f2;--accent:#c4562e;--warn:#a8751a;--danger:#a6382e;--ok:#2f7a4f;--radius:6px}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.75 "PingFang SC","Microsoft YaHei UI","Microsoft YaHei","Noto Sans SC",sans-serif;font-variant-numeric:tabular-nums}
.doc{width:1600px;max-width:100%;margin:0 auto;padding:0 80px 64px}
header.doc-head{display:flex;align-items:baseline;justify-content:space-between;gap:24px;border-bottom:1px solid var(--line);padding:24px 80px;position:sticky;top:0;background:var(--bg);z-index:5}
header.doc-head b{font-size:15px;letter-spacing:.06em;color:var(--primary)}
header.doc-head span{font-size:13px;color:var(--ink-3)}
nav.sections{display:flex;flex-wrap:wrap;gap:20px;padding:16px 80px;font-size:13px;border-bottom:1px solid var(--line);background:var(--bg);position:sticky;top:73px;z-index:4}
nav.sections a{color:var(--ink-3);text-decoration:none;padding-bottom:2px;border-bottom:2px solid transparent}
nav.sections a:hover{color:var(--primary);border-bottom-color:var(--primary-wash)}
nav.sections a.on{color:var(--primary);border-bottom-color:var(--primary)}
section{padding:56px 0;border-bottom:1px solid var(--line);scroll-margin-top:120px}
section:last-of-type{border-bottom:none}
h1{font:600 44px/1.2 "PingFang SC","Microsoft YaHei UI",sans-serif;letter-spacing:-.02em;margin:0 0 10px}
h2{font-size:28px;line-height:1.3;font-weight:600;margin:0 0 8px}
h3{font-size:20px;line-height:1.4;font-weight:600;margin:0 0 8px}
p{margin:0 0 12px}
small,.note{font-size:13px;line-height:1.6;color:var(--ink-3)}
.kicker{font-size:13px;letter-spacing:.08em;color:var(--ink-3);text-transform:uppercase}
.lede{font-size:17px;color:var(--ink-2);max-width:52em}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 0}
.chip{border:1px solid var(--line);border-radius:var(--radius);padding:5px 10px;font-size:13px;color:var(--ink-2);background:var(--canvas)}
.chip.on{border-color:var(--primary);color:var(--primary);background:var(--primary-wash)}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;margin:28px 0 0}
.kpi{background:var(--bg);padding:18px 20px}
.kpi b{display:block;font:600 56px/1.1 "PingFang SC","Microsoft YaHei UI",sans-serif;letter-spacing:-.02em}
.kpi b em{font-style:normal;font-size:16px;font-weight:400;margin-left:4px;color:var(--ink-2)}
.kpi small{display:block;margin-top:4px}
.split{display:grid;grid-template-columns:1fr 1fr;gap:48px}
.split.wide{grid-template-columns:3fr 2fr}
.card{border:1px solid var(--line);border-radius:var(--radius);padding:16px 18px;background:var(--bg)}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:20px 0 0}
.cards .card h3{font-size:16px;margin-bottom:4px}
.cards .card small{display:block}
.brief{width:100%;border-collapse:collapse;font-size:15px}
.brief th{width:8em;text-align:left;vertical-align:top;padding:10px 12px 10px 0;color:var(--ink-2);font-weight:600;border-top:1px solid var(--line)}
.brief td{padding:10px 0;border-top:1px solid var(--line)}
table.data{width:100%;border-collapse:collapse;font-size:15px}
table.data th{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);background:var(--canvas);font-size:13px;color:var(--ink-2);font-weight:600;position:sticky;top:0}
table.data td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
table.data td.num,table.data th.num{text-align:right;white-space:nowrap;font-weight:500}
table.data tr.tot td{border-top:2px solid var(--ink);font-weight:600}
.star{color:var(--accent);font-weight:600}
details{margin:4px 0}
details summary{cursor:pointer;color:var(--primary);font-size:13px;padding:2px 0}
details p{margin:6px 0 0;font-size:13px;line-height:1.6;color:var(--ink-2)}
details ul{margin:6px 0 0;padding-left:18px;font-size:13px;color:var(--ink-2)}
.pill{display:inline-block;font-size:12px;padding:1px 7px;border-radius:10px;background:var(--primary-wash);color:var(--primary);margin-left:6px}
.pill.warn{background:#fdf3e3;color:var(--warn)}
.pill.bad{background:#fbeceb;color:var(--danger)}
.pill.ok{background:#e9f4ee;color:var(--ok)}
.bar{display:grid;grid-template-columns:110px 1fr 190px;align-items:center;gap:12px;font-size:13px;margin:8px 0}
.bar .track{height:8px;background:var(--canvas);border-radius:3px;overflow:hidden}
.bar .fill{height:100%;background:var(--primary)}
.bar .fill.alt{background:var(--ink-3)}
.summary-table{max-width:640px;margin-top:16px;font-size:15px}
.summary-table td{padding:4px 0;border:none}
.summary-table td.num{text-align:right}
.batch td{font-size:14px}
.tl{border-left:2px solid var(--primary-wash);padding:2px 0 2px 18px;margin:16px 0}
.tl b{font-size:15px}
.risk{background:#fdf7ef;border-left:3px solid var(--warn);padding:10px 14px;margin:16px 0;font-size:14px;color:#6b4a12}
.risk.bad{background:#fbeceb;border-left-color:var(--danger);color:#7a2a23}
.ok-block{background:#eef5f1;border-left:3px solid var(--ok);padding:10px 14px;margin:16px 0;font-size:14px;color:#26543a}
.checks{list-style:none;margin:12px 0 0;padding:0}
.checks li{display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:14px;align-items:baseline}
.checks li .mark{width:1.2em;flex:none;font-weight:600}
.checks li .mark.pass{color:var(--ok)}
.checks li .mark.warn{color:var(--warn)}
.checks li .mark.fail{color:var(--danger)}
.checks li small{margin-left:auto;text-align:right}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:16px}
.col-list{padding-left:18px;margin:0;font-size:14px;line-height:1.9}
.muted{color:var(--ink-3)}
.quote{border-left:3px solid var(--primary);padding:2px 0 2px 14px;margin:14px 0;color:var(--ink-2);font-size:15px}
footer.doc-foot{border-top:1px solid var(--line);padding:28px 0 8px;font-size:13px;line-height:1.7;color:var(--ink-3)}
footer.doc-foot p{margin:0 0 6px}
.appendix{margin-top:20px}
table.appendix-table{width:100%;border-collapse:collapse;font-size:13px}
table.appendix-table td{padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}
table.appendix-table td.k{width:7em;color:var(--ink-2);font-weight:600}
[data-src]{position:relative}
[data-src]::after{content:attr(data-src);position:absolute;left:0;bottom:100%;background:#1a1d21;color:#fff;font-size:12px;font-weight:400;padding:3px 7px;border-radius:4px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .12s;z-index:9}
[data-src]:hover::after{opacity:1}
@media (hover:none){[data-src]::after{display:none}}
.load{display:inline-block;margin-left:8px;font-size:11px;font-weight:600;color:var(--accent)}
.tag{display:inline-block;font-size:12px;padding:1px 7px;border-radius:10px;background:var(--primary-wash);color:var(--primary);margin:0 4px 0 0}
.win{line-height:1.7}
.win b{font-size:15px}
.win span{color:var(--ink-2);font-size:13px}
.win small{display:block;color:var(--ink-3)}
.hl{outline:2px solid var(--accent);outline-offset:2px;background:#fdf0e9}
.budget-slider{border:1px solid var(--line);border-radius:var(--radius);padding:14px 18px 12px;margin-top:20px;background:var(--canvas)}
.budget-head{display:flex;align-items:baseline;gap:12px;margin-bottom:8px}
.budget-head b{font-size:28px;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.budget-slider input[type=range]{width:100%;accent-color:var(--primary);height:24px;cursor:pointer}
.budget-ticks{display:flex;justify-content:space-between;margin-top:2px}
.budget-ticks .tick{border:none;background:none;padding:2px 4px;font:inherit;font-size:13px;color:var(--primary);cursor:pointer;text-decoration:underline dotted}
.budget-ticks .tick:hover{color:var(--accent)}
.budget-panel{margin-top:28px;border-top:1px solid var(--line);padding-top:18px}
.budget-analysis{margin-top:8px}
.offline-map{width:100%;height:auto;border:1px solid var(--line);border-radius:var(--radius);display:block}
.map-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:13px;color:var(--ink-2);margin-top:8px}
.map-legend .legend-item{display:inline-flex;align-items:center;gap:6px}
.map-legend i{width:14px;height:4px;border-radius:2px;display:inline-block}
@media (max-width:1500px){.doc{padding:0 48px}header.doc-head,nav.sections{padding-left:48px;padding-right:48px}}
@media (max-width:1100px){.split,.split.wide,.cards,.two-col{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(4,1fr)}.kpi{padding:12px 10px}.kpi b{font-size:30px}header.doc-head,nav.sections{padding-left:24px;padding-right:24px}.doc{padding:0 24px 40px}}
/* ---- 打印：A4 纵向，headless Chromium 与手动打印共用 ---- */
@page{size:A4 portrait;margin:14mm 12mm}
@media print{
  .doc{width:auto;max-width:none;padding:0}
  header.doc-head{position:static;padding:0 0 10px}
  nav.sections{display:none}
  table.data{font-size:10.5pt}
  table.data th{position:static;background:#f2f3f4}
  thead{display:table-header-group}
  tr,.card,.kpi,.risk,.ok-block{break-inside:avoid}
  h2,h3{break-after:avoid}
  section{padding:16px 0;break-inside:auto}
  details>*{display:block!important}
  /* 关闭态的 details 内容被 content-visibility 隐藏，只改子元素 display 会溢出到后续行。 */
  details::details-content{content-visibility:visible!important;display:block!important}
  details summary{list-style:none}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
/* ---- 移动端：页眉导航不再常驻，表格转卡片 ---- */
@media (max-width:760px){
  header.doc-head{position:static;padding:14px 16px;flex-direction:column;align-items:flex-start;gap:4px}
  nav.sections{position:static;padding:10px 16px;flex-wrap:nowrap;overflow-x:auto;gap:16px}
  nav.sections a{white-space:nowrap;padding:8px 0;min-height:44px;display:inline-flex;align-items:center}
  .doc{padding:0 16px 40px}
  h1{font-size:28px} h2{font-size:22px}
  .lede{font-size:15px}
  .kpis{grid-template-columns:1fr 1fr}
  .kpi{padding:12px 14px} .kpi b{font-size:26px}
  details summary{min-height:44px;display:flex;align-items:center;padding:2px 0}
  table.data,table.data tbody,table.data tr,table.data td{display:block;width:auto}
  table.data thead{display:none}
  table.data tr{border:1px solid var(--line);border-radius:var(--radius);padding:10px 12px;margin:0 0 12px}
  table.data td{border:none;padding:3px 0;display:flex;gap:10px;font-size:14px}
  table.data td::before{content:attr(data-label);flex:none;width:6.8em;color:var(--ink-3);font-size:12px}
  table.data td:first-child{display:block;font-size:17px;font-weight:600;padding-bottom:6px}
  table.data td:first-child::before{display:none}
  table.data td.num{text-align:left}
}
/* ---- 桌面：表头偏移到粘性页眉之下 + 投屏放大 ---- */
:root{--head-h:127px}
table.data th{top:var(--head-h)}
@media (min-width:1700px){.kpi b{font-size:64px}}
`
