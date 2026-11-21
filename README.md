# 动线运筹 · 提案工作台

面向公交车身和地铁出入口的投放提案工作台与离线 HTML 交付。规则引擎计算库存、组合、报价与施工批次；分析模块提供需求拆解、媒体偏好、文案和核验。所有报价使用区间刊例及预算估算，客户使用代称。

前端为 Vue 3 + Vite + Ant Design Vue，位于 `frontend/`；预览、全屏演示与下载文件共用 `frontend/src/plan/renderPlan.ts` 一个渲染器，输出纯原生 HTML + 内联 CSS，断网可双击打开、明细可展开。

```powershell
pnpm --dir frontend install
pnpm --dir frontend dev        # 开发：http://127.0.0.1:5173，/api 代理到 3000
pnpm --dir frontend build      # 产出 frontend/dist，后端会直接托管
```

页面入口：`#/` 工作台（四项输入 + 可选客户需求，一次生成跑完五阶段，右侧预览、全屏演示、下载）、`#/brief` Brief 拆解、`#/settings` 运行配置、`#/api-tools` 能力目录（只读 `GET /api/openapi.json`）。

## 启动后端

需要 Node.js 24、pnpm 10。以下命令在仓库根目录执行：

```powershell
pnpm --dir backend install --frozen-lockfile
pnpm --dir backend build
pnpm --dir backend start
```

默认监听 `127.0.0.1:3000`，首次启动为 `mock` 模式，离线即可生成。接口文档在 `http://127.0.0.1:3000/api/docs`，机器文档为 `/api/openapi.json`。前端开发服务可代理 `/api` 到本服务；若存在 `frontend/dist/index.html`，后端同时提供该目录的静态页面。

```powershell
pnpm --dir backend test
```

测试覆盖规则分配、数据校验、两轮分析、配置持久化、模型 HTTP 替身、API 参数、报价核算、导出扫描，以及真实六月库存的五行业 × 三种媒体 × 四档预算 × 两种离线模式组合。

## 第一个请求

当前真实完整档期为 **2027-06-01 至 2027-06-30**，计费月数为 1。使用下列请求即可生成公交与地铁组合；预算是上限，允许余量。

```powershell
$proposal = @{
  industry = 'food'
  budgetYuan = 2000000
  media = @('bus', 'metro')
  startDate = '2027-06-01'
  endDate = '2027-06-30'
} | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3000/api/plan/generate -Method Post -ContentType 'application/json' -Body $proposal
```

`/api/meta` 提供五个行业、建议 Campaign 和可用档期。`/api/plan` 提供基础方案，`/api/plan/generate` 同步返回成案明细及 `copy/checks/rounds/degraded/exportAllowed`。工作台通过 `POST /api/plan/jobs` 提交同样的请求，用返回的 `id` 轮询 `GET /api/plan/jobs/{id}`，完成后从 `result` 读取成案结果。任务存在当前后端进程内，完成后保留 5 分钟。Brief 拆解、策略、文案、核验均有独立接口，精确字段以 OpenAPI 为准。

合法请求的业务失败使用 HTTP 200：`missing_window`、`missing_data`、`no_inventory`、`over_budget`；非法输入为 HTTP 400。导出前用 `/api/plan/verify` 提交 `{plan, campaign, copy, exportText}`，前端须按 `exportAllowed` 阻止风险文案下载。

## 运行配置

`GET /api/config` 读取配置；`PUT /api/config` 支持部分更新，下一次请求生效；`POST /api/config/test` 测试连接或 mock 覆盖。运行配置保存至 `data/config/runtime.json`，不进 Git。文件存在时优先于环境变量；`runtime.example.json` 提供不含密钥的示例。

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/config -Method Put -ContentType 'application/json' -Body '{"mode":"off"}'
```

- `off`：规则引擎、模板文案及确定性扫描；`degraded` 记录跳过的策略与成稿阶段。
- `mock`：五行业同源离线样例，最多两轮扩选。
- `live` 使用兼容 `chat/completions` 的模型 HTTP 服务，需要配置 `llm.baseUrl/model/apiKey`。整条流水线共享 120 秒，单次请求和最多一次重试都受剩余时间限制。新配置的单次超时默认为 120 秒，已有配置可在设置页调整 `timeoutMs`。分析阶段失败时逐阶段降级。

API Key 仅用于写入，读取只返回 `hasKey/keyPreview`，不进入 OpenAPI、提示词或方案。自动化测试使用本地 HTTP 替身。

可用环境变量：`PORT`、`HOST`、`CORS_ORIGIN`（逗号分隔）、`PLAN_DATA_DIR`、`LLM_CONFIG_PATH`、`ANALYSIS_MODE`、`LLM_PROVIDER`、`LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY`、`LLM_TIMEOUT_MS`、`SINGLE_NIGHT_CAP`、`STRATEGY_PREMIUM_RATIO`（默认 `0.1`，即 10%）。`.env.example` 只作说明，启动不会自动读取 `.env`。

红豆库存模块（`backend/src/inventory/`）使用 `HONGDOU_TOKEN`，或 `HONGDOU_USERNAME / HONGDOU_PASSWORD / HONGDOU_CLIENT_ID / HONGDOU_CLIENT_SECRET` 登录；`HONGDOU_TENANT_ID`（默认 `1`）、`HONGDOU_BASE_URL`、`HONGDOU_TIMEOUT_MS`（默认 `4000`）可选，`HONGDOU_ONLINE=off` 强制只读本地数据。未配置账号时不发起外网请求，`/api/plan` 与 `/api/plan/generate` 都回退到同区间归档；只有区间内周一截面时返回 `missing_window` 并附参考空位与采样日。

实名扫描通过 `BRAND_MAPPING_PATH` 读取内部 `{map:[{real,alias}]}`。当前工作区也会自动发现仓库相邻的 `../data/internal/brand_mapping.json`。该映射不进入交付仓库；独立部署需在本机配置。映射缺失时响应明确提示无法完成实名核验，不应将其当作已通过实名检查。

## 数据来源与重建

`data/` 包含 431 条公交媒体、861 个地铁出口、29 个商圈锚点、1,285 条刊例估算、397 条公交历史画像。POI 可关联 149 个公交键和 87 个地铁出口；同一媒体的覆盖与画像证据合并后共用库存。

六月整月库存通过比赛账号 OAuth2 与红豆完整起止日接口取得，两类媒体保留各自带时区的查询时间。原始归档在相邻工作区 `../data/raw/hongdou/windows/`，运行包只含必要字段。52 个周一单日截面收在 `data/snapshots.json`，只用于整段库存查不到时的库存参考，不参与成案、报价或排期。

```powershell
python -X utf8 scripts/data/build_data.py --source ../data --output data
```

脚本从已有 `processed/media_index.json`、`seed/industries.json`、`raw/geo/candidates.json`、可选 `processed/traffic.json` 及完整档期归档生成六份 JSON。未匹配或歧义线路记录在 `data/data-notes.json`，不能自动当成已核对媒体。

需要更新完整档期时，设置 `HONGDOU_TOKEN`，或同时设置 `HONGDOU_USERNAME/HONGDOU_PASSWORD/HONGDOU_CLIENT_ID/HONGDOU_CLIENT_SECRET`；凭证不写入脚本、归档或日志。然后执行：

```powershell
python -X utf8 scripts/data/fetch_window.py --start 2027-06-01 --end 2027-06-30 --billing-months 1
python -X utf8 scripts/data/build_data.py
```

价格采用资料包 07：公交按 S/A++/A+ 月刊例区间；制作费以区间中值估算。地铁实际面积未核对，A++/A+ 分别按 12/8 ㎡估算制作费，方案会披露。未配价的特殊媒体不进入报价。历史画像为 **2023-05**，不同线路的覆盖人次不能相加当作当前方案触达。

排期按任务约定从档期末倒排，默认每夜 40 台、2 个雨天备用夜、2 台补刊产能，均标为待施工方确认的假设。发布起算与 Campaign 冲突会显示核验提示；不把施工估算当作已确认履约。
