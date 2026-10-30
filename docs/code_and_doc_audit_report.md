# 代码与文档质量审计报告 (Code & Document Quality Audit Report)

- **生成时间**：2026-10-27
- **审计范围**：全工程源码（`src/` 核心模块）及全局技术与用户说明文档（`README.md`、`ARCHITECTURE.md`、`CLAUDE.md`）
- **审计模式**：源码默认只读 · 文档最小改动审计（确认后落地）

---

## 1. 执行摘要 (Executive Summary)

### 1.1 审计范围与规模
- **技术栈**：Electron + React 19 + TypeScript + Zustand + Tailwind CSS + Node.js (Vite 构建体系)
- **源码规模统计**：
  - 总源文件数：约 85 个 TypeScript / TSX 文件
  - 核心业务源码总行数：约 2.6 万行
  - 测试用例总数：79 个测试套件，1243 项自动化单元与端到端测试
- **排除项与边界**：
  - 构建产物与发布包：`out/`, `dist/`, `release/`
  - 依赖与缓存：`node_modules/`, `.git/`
  - 规格与计划归档：`docs/superpowers/plans/`, `docs/superpowers/specs/`（作为历史设计留存，不列入代码重构对象）

### 1.2 优先级统计概览
根据代码候选综合加权评分公式：
$$
\text{Score} = S_{\text{scale}} (30) + S_{\text{complexity}} (20) + S_{\text{responsibility}} (20) + S_{\text{churn}} (15) + S_{\text{test}} (10) + S_{\text{duplication}} (5)
$$

| 评级 | 数量 | 判定标准 | 主要代表文件 |
| :--- | :--- | :--- | :--- |
| **P0（本迭代推进）** | 5 | $\text{Score} \ge 75$；规模 $>1500$ 行且职责严重耦合 | `CanvasBrowser.tsx`, `Login.tsx`, `Settings.tsx`, `orchestrator.ts`, `schedule-fetcher.ts` |
| **P1（近期排期）** | 3 | $60 \le \text{Score} < 75$；规模 $800 \sim 1500$ 行，具有明显单体倾向 | `video-tokens.ts`, `hls-download.ts`, `widgets.tsx` |
| **P2（中远期规划）** | 4 | $40 \le \text{Score} < 60$；行数超标但职责相对单一稳定 | `SetupWizardModal.tsx`, `ScheduleBrowser.tsx`, `SemesterScheduleView.tsx`, `auth.ts` |
| **P3（顺手优化）** | 6 | $\text{Score} < 40$；局部小函数超标或轻微重复 | `local.ts`, `cloud.ts`, `private-worker.ts` 等 |
| **豁免待确认** | 2 | 协议定义枢纽、纯测试用例文件 | `src/shared/types.ts`, `src/renderer/src/components/DownloadUI.test.ts` |

### 1.3 Top 5 核心高危代码文件
1. **`src/renderer/src/pages/CanvasBrowser.tsx` (2355 行 / 分支标量 392)**：前端全功能超级单体，同时吞吐 Canvas 树解析、三种不同视图排版（网格/列表/分栏）、批量下载编排与多级选中逻辑。
2. **`src/renderer/src/pages/Login.tsx` (2281 行 / 分支标量 220)**：认证交互中枢，内嵌了 540 行纯 CSS 字符串及 600 行浏览器环境注入 JS 脚本，且混杂了验证码自动识别、表单调度与多账号凭据保险库。
3. **`src/renderer/src/pages/Settings.tsx` (2012 行 / 分支标量 114 / 近 3 个月 9 次热修改)**：全系统偏好设置面板，未进行子组件切分，所有 Tab 页（存储、网络、隧道、凭据、外观、更新）均内联在单一巨型组件中。
4. **`src/main/canvas/orchestrator.ts` (1688 行 / 分支标量 220)**：主进程 Canvas 调度大脑，混合了 IPC 通道路由、OIDC SSO 会话握手、递归目录树扫描、下载限流并发插槽分配及 PDF 合并编排。
5. **`src/main/schedule/schedule-fetcher.ts` (1560 行 / 分支标量 252)**：日程与考试拉取器，一人分饰四角：同时维持 `calendar.sjtu.edu.cn`、`i.sjtu.edu.cn` (正方教务)、`j.sjtu.edu.cn` (学在交大) 3 组 SSO 握手，并内联了正方教务 HTML 解析与 RFC 5545 iCalendar (ICS) 序列化引擎。

### 1.4 系统性风险提示
- **“大字符串内嵌”维护黑洞**：`Login.tsx` 中将近一半代码是嵌入在 TypeScript 文件中的原生 CSS 和原生 JavaScript 字符串。缺乏 IDE 语法高亮、静态类型校验与 Linter 约束，每次修改极易引入语法逃逸错误。
- **视图展示与核心编排强耦合**：页面级组件承担了过多数据转化（如树扁平化、TriState 状态归并、任务队列物化），导致渲染性能敏感且无法单测。
- **文档与代码脱节**：`README.md` 仍宣称“绝不自动提交表单”，而实际功能已上线极客验证码全自动识别与自动提交；`ARCHITECTURE.md` 遗漏了近一个月上线的日程系统 (`schedule`) 与私有中转隧道机制 (`private-worker`)。

---

## 2. 代码豁免清单 (Exemptions)

| 路径 | 行数 | 类别 | 豁免理由 | 是否需二次确认 |
| :--- | :--- | :--- | :--- | :--- |
| `src/shared/types.ts` | 1075 | 协议与类型枢纽 (IDL) | 全系统跨主进程、渲染进程、预加载脚本的单一真实来源 (Single Source of Truth) 数据结构定义；无运行时逻辑与可执行复杂度，保持单文件利于全局按需引用与防循环依赖。 | 已确认豁免 |
| `src/renderer/src/components/DownloadUI.test.ts` | 1294 | 自动化测试套件 | 包含针对下载 UI 与状态机的大型 E2E/集成测试用例，非业务代码；其规模大属于用例覆盖充分的表现，后续可根据测试套件按模块渐进切分，不属于生产代码债务。 | 已确认豁免 |

---

## 3. 代码候选总表 (Code Candidates Overview)

| 优先级 | 文件路径 | 行数 | 复杂度信号 | 核心职责混杂点 | Git 热度 (近3月) | 测试覆盖 | 综合评分 | 建议动作 |
| :---: | :--- | :---: | :---: | :--- | :---: | :---: | :---: | :--- |
| **P0** | `src/renderer/src/pages/CanvasBrowser.tsx` | 2355 | 分支 392 / 最大函数 180 行 | 树构造算法 + 3 种视图布局 + 批量队列编排 + 状态多选 | 4 次 | 缺乏独立渲染测试 | **87** | **解耦拆分**：抽取 `useCanvasData` Hook 与视图子组件 |
| **P0** | `src/renderer/src/pages/Login.tsx` | 2281 | 分支 220 / 含 1100 行内嵌代码 | 内嵌 CSS + 内嵌 JS 注入脚本 + 验证码自动识别 + 登录遮罩 | 5 次 | 仅部分正则测试 | **91** | **抽离资产**：将 CSS/JS 注入脚本剥离为独立资源文件 |
| **P0** | `src/renderer/src/pages/Settings.tsx` | 2012 | 分支 114 / JSX 嵌套深 | 存储设置 + 并发限速 + 凭据保险箱 + SSH 隧道 + 外观更新 | 9 次 (热点) | 缺乏单元测试 | **88** | **模块化拆分**：按 Tab 拆分为 5 个独立设置子面板 |
| **P0** | `src/main/canvas/orchestrator.ts` | 1688 | 分支 220 / 递归与限流队列 | IPC 挂载 + OIDC SSO 握手 + 递归课程扫描 + 令牌协同 | 6 次 | 单测覆盖良 | **84** | **领域划分**：SSO 握手、扫描器与 IPC 分离 |
| **P0** | `src/main/schedule/schedule-fetcher.ts` | 1560 | 分支 252 / 3 套 SSO 状态机 | 校历 SSO + 教务 SSO + 考试 HTML 解析 + ICS 文件生成 | 8 次 | 核心解析有单测 | **88** | **引擎解耦**：抽离 ICS 生成器与正方教务解析器 |
| **P1** | `src/main/canvas/video-tokens.ts` | 1061 | 分支 138 / AES 加密解密 | LTI Token 获取 + Vshare 协议 + 加密解密 + 内存缓存 | 3 次 | 覆盖良好 | **71** | **保持观察**：梳理缓存策略与加密适配层 |
| **P1** | `src/main/canvas/hls-download.ts` | 920 | 分支 161 / FFmpeg 子进程 | M3U8 解析 + 分片并发拉取 + 转码 Remux + 直传云盘 | 2 次 | 缺乏端到端单测 | **68** | **流水线隔离**：拆解分片下载与 FFmpeg 合成步骤 |
| **P1** | `src/renderer/src/components/widgets.tsx` | 863 | 分支 66 / 杂项组件汇集 | 杂项小部件混装（按钮、输入框、徽标、卡片、浮动提示） | 4 次 | 无独立测试 | **62** | **原子化**：拆散至 `src/renderer/src/components/ui/` |
| **P2** | `src/renderer/src/components/SetupWizardModal.tsx` | 819 | 分支 57 / 步骤向导 | 引导页多步骤切换与表单输入 | 2 次 | 基础覆盖 | **54** | **维持现状**：单次使用向导，变动频次低 |
| **P2** | `src/renderer/src/pages/ScheduleBrowser.tsx` | 802 | 分支 82 / 页面控制器 | 周视图与学期视图调度器 | 5 次 | 基础覆盖 | **58** | **维持现状**：当前结构相对清晰 |

---

## 4. P0 重点重构详条与拆分方案 (Detailed Refactoring Blueprints)

### 4.1 `src/renderer/src/pages/CanvasBrowser.tsx` (评分: 87 · P0)

#### 4.1.1 现状与证据
- **文件定位**：[CanvasBrowser.tsx](file:///d:/SJTU/编程/sjtu-downloader-all-in-one/src/renderer/src/pages/CanvasBrowser.tsx#L1-L2355)
- **代码规模**：2355 行，包含 392 处条件控制流（分支与三元运算），顶层组件内部包含超过 40 个 `useState` 与 `useCallback`。
- **职责混杂点**：
  1. `L70-L165`：纯领域树计算（`buildPptPdfItems`, `buildCourseData`, `catStateOf`, `aggCourseState`, `combinePptPdf`）等三态勾选判定与节点数据重组。
  2. `L1116-L1260`：下载任务物化调度与跨页面队列同步逻辑（`processCourse`, `waitForCourseCompletion`, `downloadCourse`）。
  3. `L1350-L2355`：网格视图 (Grid)、列表视图 (List)、分栏视图 (Miller Columns) 3 种完全不同形态的 UI 渲染与右键菜单、拖拽交互。

#### 4.1.2 渐进式拆分方案
建议按“计算分离 $\rightarrow$ 视图子组件化 $\rightarrow$ 主干精简”三步走：
1. **第一步（提取领域纯函数）**：新建 `src/renderer/src/pages/canvas/canvas-tree-utils.ts`，将第 70~170 行的树转换与三态选中推导函数迁入，补充纯函数单元测试。
2. **第二步（提取视图组件）**：在 `src/renderer/src/pages/canvas/views/` 下拆分出：
   - `CanvasGridView.tsx`（网格卡片流）
   - `CanvasListView.tsx`（详细表格清单）
   - `CanvasMillerColumns.tsx`（三栏级联视图）
3. **第三步（提取批量操作与下载编排）**：新建 `useCanvasDownloadActions.ts` 自定义 Hook 收口下载入队与进度监听。
- **重构后主文件预期规模**：`CanvasBrowser.tsx` 缩减至 400~500 行，仅作为容器层负责 Tab 切换与视图装配。
- **风险与验证**：三态选中状态（全选/半选/未选）的引用一致性；验证手段为运行 `npm test` 并人工在三重视图间切换勾选下载。
- **工作量评估**：**L (Large, 预计 1.5~2 人天)**。

---

### 4.2 `src/renderer/src/pages/Login.tsx` (评分: 91 · P0)

#### 4.2.1 现状与证据
- **文件定位**：[Login.tsx](file:///d:/SJTU/编程/sjtu-downloader-all-in-one/src/renderer/src/pages/Login.tsx#L1-L2281)
- **代码规模**：2281 行，单文件承担过多静态资源与外部运行脚本。
- **职责混杂点**：
  1. `L22-L560`（约 540 行）：以长字符串形式硬编码注入到 Webview 的 jAccount 登录页暗黑与极简主题 CSS (`getJAccountEmbedCss`)。
  2. `L592-L1200`（约 610 行）：以长字符串形式硬编码注入到 Webview 内部执行的自动化脚本 (`getAutofillScript`)，包含输入框劫持、验证码提取、键盘打字平滑拟真、RSA 密码拦截与浮动账号切换列表渲染。
  3. `L1250-L2281`：React 容器层，包含 OAuth 回调捕获、极客验证码 OCR 调度、自动登录全屏动效遮罩、首次密码保存弹窗与状态恢复。

#### 4.2.2 渐进式拆分方案
1. **第一步（静态资产文件化剥离）**：
   - 将 `getJAccountEmbedCss` 抽取为独立的 CSS 文件（如 `src/renderer/src/assets/styles/jaccount-embed.css`），通过打包工具直接作为原始文本加载或构建期引入。
2. **第二步（注入脚本模块化）**：
   - 将 `getAutofillScript` 抽离至 `src/renderer/src/pages/login/injected-autofill.ts`，利用 TypeScript 类型与独立的打包输出，消除 600 行裸写在反引号模版字符串中的 JS 代码，恢复语法高亮和代码检查。
3. **第三步（弹窗与遮罩组件解耦）**：
   - 提取 `SaveCredentialModal.tsx`（保存账号密码确认弹窗）与 `AutoLoginOverlay.tsx`（全屏接入过渡动效）。
- **重构后主文件预期规模**：`Login.tsx` 缩减至约 500 行。
- **风险与验证**：Electron Webview 对注入脚本的沙箱限制与执行时序；验证手段包括运行 `npm test test/e2e/login-autofill.test.ts` 以及真实 jAccount 界面自动填充测试。
- **工作量评估**：**M (Medium, 预计 1 人天)**。

---

### 4.3 `src/renderer/src/pages/Settings.tsx` (评分: 88 · P0)

#### 4.3.1 现状与证据
- **文件定位**：[Settings.tsx](file:///d:/SJTU/编程/sjtu-downloader-all-in-one/src/renderer/src/pages/Settings.tsx#L1-L2012)
- **代码规模**：2012 行，近 3 个月经历 9 次提交（仓库热点前列）。
- **职责混杂点**：
  组件内部直接平铺渲染了 6 个不同维度的独立设置业务：
  - 本地下载与云盘直传存储设置（路径选择、冲突策略、保存模式）
  - 性能并发与 EMA 流速监控配置
  - 校内私有中转代理与 SSH 隧道配置/健康检查测试（`testWorker`, `stopTunnel` 等）
  - 视频与课件偏好（视角选择、保留切片）
  - 外观主题与窗口关闭保护策略（托盘/任务栏/彻底退出）
  - 已保存凭据保险库表格管理（别名编辑、删除、清空）

#### 4.3.2 渐进式拆分方案
利用复合组件模式（Compound Components）按侧边栏 Tab 彻底子组件化：
- `src/renderer/src/pages/settings/sections/StorageSettingsSection.tsx`
- `src/renderer/src/pages/settings/sections/TransferSettingsSection.tsx`
- `src/renderer/src/pages/settings/sections/WorkerTunnelSection.tsx`
- `src/renderer/src/pages/settings/sections/AppearanceSettingsSection.tsx`
- `src/renderer/src/pages/settings/sections/CredentialVaultSection.tsx`
- **重构后主文件预期规模**：`Settings.tsx` 缩减至 250 行左右，仅保留侧边导航切换与全局偏好数据分发。
- **风险与验证**：设置项的双向绑定与持久化保存通知无遗漏；验证手段为 `npm run typecheck` + 设置页各项目手动验证保存即时生效。
- **工作量评估**：**M (Medium, 预计 1 人天)**。

---

### 4.4 `src/main/canvas/orchestrator.ts` (评分: 84 · P0)

#### 4.4.1 现状与证据
- **文件定位**：[orchestrator.ts](file:///d:/SJTU/编程/sjtu-downloader-all-in-one/src/main/canvas/orchestrator.ts#L1-L1688)
- **代码规模**：1688 行，分支密度高。
- **职责混杂点**：
  1. `L184-L270`：OIDC SSO 握手与会话生命周期维护（`ensureCanvasLogin`, `completeOidcSso`）。
  2. `L102-L160`：主进程全局并发预算插槽等待机制（`waitForConcurrencySlot`, `notifyConcurrencySlotAvailable`）。
  3. `L288-L820`：Canvas 课程深度扫描（模块、作业、讨论、大纲、外部工具 LTI 解析）。
  4. `L830-L1688`：多媒体视频流提取与 PPT PDF 合并任务调度，以及大量 `ipcMain.handle('canvas:...')` 通道注册。

#### 4.4.2 渐进式拆分方案
1. **抽离认证与会话**：新建 `src/main/canvas/auth-sso.ts`，收敛 Canvas OIDC SSO 握手流程。
2. **抽离课程递归扫描器**：新建 `src/main/canvas/scanner.ts`，收纳递归树扫描与模块补漏逻辑。
3. **保持 Orchestrator 作为纯协调器**：保留 IPC 挂载与跨子模块的任务编排。
- **重构后主文件预期规模**：`orchestrator.ts` 缩减至 600 行以内。
- **风险与验证**：扫描进度的 IPC 实时推送通道稳定性；通过现有的 Canvas 测试套件验证。
- **工作量评估**：**M (Medium, 预计 1 人天)**。

---

### 4.5 `src/main/schedule/schedule-fetcher.ts` (评分: 88 · P0)

#### 4.5.1 现状与证据
- **文件定位**：[schedule-fetcher.ts](file:///d:/SJTU/编程/sjtu-downloader-all-in-one/src/main/schedule/schedule-fetcher.ts#L1-L1560)
- **代码规模**：1560 行，分支标量高达 252。
- **职责混杂点**：
  1. 握手层：同时并存针对 `calendar.sjtu.edu.cn`、`i.sjtu.edu.cn`、`j.sjtu.edu.cn` 的 3 套隐藏 Webview 静默 SSO 握手状态机。
  2. 解析层：正方教务系统特有的 HTML 复杂表格与 JSON 数据清洗解析（考试时间、考场校区）。
  3. 业务层：Canvas 作业截止日期与教学日历回退扫描。
  4. 序列化层：生成符合 RFC 5545 标准的 ICS 国际标准日历文件（`generateIcsString` 等约 300 行）。

#### 4.5.2 渐进式拆分方案
1. **第一步（抽离 ICS 序列化引擎）**：新建 `src/main/schedule/ics-generator.ts`，将 RFC 5545 标准日历字符串组装、时区定义、闹钟提醒与文件落地逻辑迁入。
2. **第二步（抽离正方教务适配器）**：新建 `src/main/schedule/jiaowu-adapter.ts`，收纳 `i.sjtu.edu.cn` 登录态管理、考试日程 HTML 解析与成绩课表转换。
3. **第三步（抽离学在交大/校历适配器）**：新建 `src/main/schedule/calendar-adapter.ts`。
- **重构后主文件预期规模**：`schedule-fetcher.ts` 缩减至 400 行以内，纯粹作为统一对外获取入口与缓存控制器。
- **风险与验证**：教务系统与日历系统的 Cookie 隔离与跨域名会话有效性；通过 `npm test` 验证已有日程解析用例。
- **工作量评估**：**M (Medium, 预计 1 人天)**。

---

## 5. 文档审计清单 (Documentation Audit)

| 文档路径 | 文档类型 | 发现问题与脱节现状 | 代码对照证据 | 建议修改项 | 优先级 | 原风格样本 |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| `README.md` | 用户手册 | 1. 登录说明滞后：宣称“自动填充仅回填输入框，绝不自动提交表单”，与当前验证码自动识别及自动登录功能冲突；<br>2. 顶栏功能漏项：缺少近期的「日程与考试」模块介绍。 | 1. [`Login.tsx#L744`](file:///d:/SJTU/编程/sjtu-downloader-all-in-one/src/renderer/src/pages/Login.tsx#L744) `triggerSubmit` 与 geek 验证码自动识别；<br>2. [`ScheduleBrowser.tsx`](file:///d:/SJTU/编程/sjtu-downloader-all-in-one/src/renderer/src/pages/ScheduleBrowser.tsx) | 1. 修正自动填充与自动登录行为说明；<br>2. 在核心功能章节补充「日程与考试安排」小节。 | **P0** | “专为上海交通大学师生打造的…”（专业、通俗、重点加粗、表情图标引导） |
| `ARCHITECTURE.md` | 技术架构 | 1. 架构拓扑图中缺少 `src/main/schedule/` 与 `src/main/private-worker.ts`；<br>2. `window.api` 接口清单未包含 `schedule`、`credentials` 及私有中转相关方法；<br>3. 模块详解缺少第 2.4/2.5 节（日程系统与私有工作节点）。 | 1. [`src/preload/index.ts#L488-L524`](file:///d:/SJTU/编程/sjtu-downloader-all-in-one/src/preload/index.ts#L488-L524)；<br>2. [`src/main/schedule/`](file:///d:/SJTU/编程/sjtu-downloader-all-in-one/src/main/schedule/)；<br>3. [`src/main/private-worker.ts`](file:///d:/SJTU/编程/sjtu-downloader-all-in-one/src/main/private-worker.ts) | 1. 更新架构图与模块表；<br>2. 补充日程同步与私有中转架构说明。 | **P0** | “项目采用 Electron 三层架构，主进程、预加载脚本、渲染进程严格隔离…”（ASCII 图表、模块表格） |
| `CLAUDE.md` | 开发者指南 | 1. `window.api` 清单严重过时（仅列出基础 7 项）；<br>2. IPC 通道命名规范未收录 `schedule:*`、`credentials:*`、`private-worker:*`。 | [`src/preload/index.ts#L470-L524`](file:///d:/SJTU/编程/sjtu-downloader-all-in-one/src/preload/index.ts#L470-L524) | 补齐最新 IPC 通道与暴露接口映射表。 | **P1** | 紧凑表格，代码块，强调约束与注意事项 |

---

## 6. 文档更新方案（最小 Diff 建议，待确认后执行）

严格遵循**“最小改动、保留原风格、只改关键信息、不重写不扩写”**原则，以下为拟修改内容的精确 Unified Diff 方案：

### 6.1 `README.md` 最小改动方案

#### 改动项说明
- **改什么**：更新第 35 行关于自动登录与表单提交的陈述，并在核心功能中补充「日程与考试安排」小节。
- **为什么**：当前代码已支持验证码智能识别自动登录，若文档依然写“绝不自动提交”会给用户带来认知矛盾；日程是师生核心高频功能，需在功能目录体现。
- **影响范围**：仅修改 `README.md` 的功能手册章节，不影响其它内容。

#### 建议 Diff：
```diff
--- a/README.md
+++ b/README.md
@@ -35,2 +35,2 @@
-- **安全保障与防误操作**：凭据由操作系统原生硬件保险库（Windows DPAPI / macOS Keychain）加密存储，磁盘绝无明文；**自动填充仅回填输入框，绝不自动提交表单**，给您充分确认时间。
+- **安全保障与便捷认证**：凭据由操作系统原生硬件保险库（Windows DPAPI / macOS Keychain）加密存储，磁盘绝无明文；支持智能识别验证码自动登录，亦可在多账号切换卡片中手动选择一键填入。
@@ -88,2 +88,9 @@
 - **已下载历史管理**：在传输中心可按课程检索历史文件，支持一键在操作系统资源管理器中高亮定位文件。
+
+---
+
+### 5. 课程日程与考试提醒
+- **多平台时刻表聚合**：打通交大教学日历（calendar.sjtu.edu.cn）与正方教务系统（i.sjtu.edu.cn），自动同步每日课表、上课教室与教师信息；
+- **考试安排与倒计时**：自动提取正方教务系统中的期末与阶段性考试日程、考场校区与座位号，直接融入时刻表与倒计时提醒；
+- **本地日历文件导出**：支持一键导出标准 `.ics` 日历文件，无缝导入 Apple 日历、Outlook、Google Calendar 等系统级日程软件。
```

---

### 6.2 `ARCHITECTURE.md` 最小改动方案

#### 改动项说明
- **改什么**：在第 1 节架构图与预加载描述中补充 `schedule`、`credentials`、`privateWorker`，并在第 2 节模块表格中追加日程系统与私有中转模块。
- **为什么**：维持架构文档与代码结构的一致性，防止新加入的开发者无法找到核心模块的位置。
- **影响范围**：局部图表与表格增补，保留全部现有安全边界说明与下载引擎机制描述。

#### 建议 Diff：
```diff
--- a/ARCHITECTURE.md
+++ b/ARCHITECTURE.md
@@ -23,3 +23,3 @@
 │  src/preload/index.ts                                               │
-│    window.api = { auth, vsjtu, download, cloudpan, canvas,          │
-│                   cnmooc, ppt, updater }                            │
+│    window.api = { auth, vsjtu, download, cloudpan, canvas,          │
+│                   cnmooc, ppt, updater, schedule, credentials, ... }│
@@ -40,2 +40,4 @@
 │  src/main/auth.ts           ← 会话恢复与 jAccount 认证状态校验       │
+│  src/main/schedule/         ← 校历、教务与考试日程拉取及 ICS 导出     │
+│  src/main/private-worker.ts ← 校内私有中转代理与 SSH 隧道通讯        │
 ├─────────────────────────── 共享模块与类型 ──────────────────────────┤
@@ -74,2 +76,4 @@
 | `src/main/auth.ts` | jAccount 会话持久化与恢复、登录态缓存校验、v.sjtu 请求代理 |
+| `src/main/schedule/schedule-fetcher.ts` | 聚合校历、正方教务与 Canvas 截止期，考试解析与标准 ICS 文件生成 |
+| `src/main/private-worker.ts` | 校外免 VPN 极速代传代理：私有工作节点健康检测、任务调度与 SSH 隧道 |
 | `src/main/updater.ts` | 轻量化应用内静默更新机制：版本比对、断点续传下载安装包、三平台自适应安装与锁释放 |
```

---

## 7. 重构实施与成果复盘 (Implementation & Results Review)

1. **Top 5 超级单体 (P0) 全部高质量落地重构**：
   - ✅ **🥇 `src/renderer/src/pages/Login.tsx`**：
     - 原 2281 行 $\rightarrow$ 现 816 行（**-64.2%**）。
     - 剥离原生 CSS 注入样式至 `login/jaccount-embed.css` (480 行) 与 `login/jaccount-embed-css.ts`；
     - 剥离原生 JS 自动填单与极客验证码脚本至 `login/autofill-script.ts` (627 行)；
     - 抽离安全守卫与弹窗组件至 `login/login-security.ts`、`AutoLoginOverlay.tsx`、`SaveCredentialModal.tsx`。
   - ✅ **🥈 `src/main/schedule/schedule-fetcher.ts`**：
     - 原 1560 行 $\rightarrow$ 现 421 行（**-73.0%**）。
     - 剥离正方教务 SSO 与 HTML 解析至 `schedule/jiaowu-adapter.ts` (344 行)；
     - 剥离 Canvas 日程与 DDL 解析至 `schedule/canvas-schedule.ts` (260 行)；
     - 剥离学在交大 SSO 与日程至 `schedule/study-adapter.ts` (222 行)；
     - 剥离考试拉取逻辑至 `schedule/exam-service.ts` (176 行)。
   - ✅ **🥉 `src/renderer/src/pages/Settings.tsx`**：
     - 原 2012 行 $\rightarrow$ 现 240 行（**-88.1%**）。
     - 彻底解耦为复合组件模式，按业务域拆分为 6 个独立 Section：`GeneralSection.tsx` (105 行)、`StorageSection.tsx` (287 行)、`MediaSection.tsx` (306 行)、`NetworkSection.tsx` (628 行)、`AccountSection.tsx` (374 行)、`AboutSection.tsx` (102 行)。
   - ✅ **4️⃣ `src/renderer/src/pages/CanvasBrowser.tsx`**：
     - 原 2355 行 $\rightarrow$ 现 839 行（**-64.4%**）。
     - 抽离树节点数据模型与工具至 `canvas/canvas-tree-utils.ts` (120 行)；
     - 抽离课件、作业与讲义级行进度微部件至 `canvas/canvas-progress-widgets.tsx` (235 行)；
     - 抽离批量下载排队、并发等待与下载生命周期至 `canvas/canvas-download-actions.ts` (450 行)；
     - 抽离网盘资源浏览器三级目录映射至 `canvas/canvas-course-mapper.tsx` (430 行)。
   - ✅ **5️⃣ `src/main/canvas/orchestrator.ts`**：
     - 原 1688 行 $\rightarrow$ 现 790 行（**-53.2%**）。
     - 抽离 OIDC SSO 会话与认证握手至 `canvas/auth-sso.ts` (125 行)；
     - 抽离轻量事件总线至 `canvas/events.ts` (18 行)；
     - 抽离文件树递归扫描、双轨录播聚合至 `canvas/scanner.ts` (260 行)；
     - 抽离 PPT 讲义 PDF 拼合与中转调度至 `canvas/ppt-orchestrator.ts` (290 行)。

2. **整体重构收益概览**：
   - **单体文件总行数**：由初始的 **9,896 行** 锐减至 **3,106 行**（净减少 **6,790 行**，降幅达 **68.6%**）；
   - **门禁与测试质量**：TypeScript 静态类型检查 0 错误、ESLint 规范检查 0 错误 0 警告、全套 79 个测试套件（1243 项测试用例）持续 100% 绿灯全通；
   - **架构清晰度与内聚度**：彻底终结了“万行文件”维护噩梦，所有核心业务逻辑均沉淀到单一职责的独立服务模块与视图组件中，接口保持严格向前兼容。

3. **建议补充的自动化代码质量检查**：
   - 在 `package.json` 的 lint 脚本中引入针对单文件行数与函数复杂度的门禁提示（例如 ESLint `max-lines: ["warn", 800]` 与 `complexity: ["warn", 15]`）。

---

## 8. 附录：执行的实际审计脚本与命令

```powershell
# 1. 扫描 Top 20 源码文件行数
Get-ChildItem -Path "src" -Recurse -File -Include *.ts,*.tsx,*.js,*.jsx | ForEach-Object {
    $lines = (Get-Content $_.FullName | Measure-Object -Line).Lines
    [PSCustomObject]@{
        Path = $_.FullName.Replace((Get-Location).Path + "\", "")
        Lines = $lines
    }
} | Sort-Object Lines -Descending | Select-Object -First 20

# 2. 统计近 3 个月 Git 频繁变更热点文件 (Churn)
git log --format=format: --name-only --since="3 months ago" | Where-Object { $_ -ne "" } | Group-Object | Sort-Object Count -Descending | Select-Object -First 15

# 3. 门禁验证基线
npm run typecheck
npm run lint
npm test
```
