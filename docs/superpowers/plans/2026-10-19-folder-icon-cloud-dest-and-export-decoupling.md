# 课程卡片文件夹高清立体化、交大云盘保存目录自定义与导出项细粒度解耦实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底修复课程卡片 macOS 文件夹图标显示不全问题（消除全局 ID 渐变失效缺陷，打造高保真纯矢量立体天蓝文件夹）；支持在初始向导和设置中心中让用户自主配置交大云盘保存根目录；全面解耦 AI 语音逐字稿（.srt 外挂字幕 与 .md 复习笔记）及 Canvas 作业归档（说明文档、题目附件、提交原件）的独立导出配置与持久化。

**Architecture:**
1. **视图层渲染纯净性与鲁棒性**：重构 `MacOSFolderIcon`，采用纯矢量分层绘制（天蓝前盖、深蓝背板、白蓝内衬、高光倒角），彻底摆脱脆弱的 `<linearGradient id="...">` 全局引用，确保在 Electron/Chromium 各类单页路由、缩放比与深浅色模式下 100% 清晰呈现；
2. **全局状态与持久化体系**：在 `useAppStore` 中新增 `cloudDestRoot`、`canvasExportSrt`、`canvasExportMarkdown`、`canvasAssignmentOptions`，纳入 `localStorage` 持久化，防止页签切换或应用重启后配置丢失；
3. **向导与设置中心交互统一性**：遵循 UI 交互出口唯一性原则与标准网格流向，在向导第 2 步与设置中心“存储与路径”中增加交大云盘保存目录配置卡片（预设 `/SJTU课程备份`、`云盘根目录 /`、`/我的课程` 快捷胶囊与可编辑路径输入框，带层级实时面包屑预览）；在向导第 4 步升级为独立的「.srt 外挂字幕」与「.md 复习笔记」双卡片；在设置中心增加 Canvas 作业归档细粒度导出选项；
4. **主进程调度与下载引擎透传**：`cloudRemotePath` 与 `cloudFolderSegments` 支持用户配置的 `cloudDestRoot`；`downloadLectureTranscript` 与 `downloadAssignmentArchive` 严格按细粒度布尔选项过滤下载内容。

**Tech Stack:** React 19, Zustand, TypeScript 5.7, Electron 34, Tailwind CSS, Vitest.

**Spec / Requirements Alignment:**
- 依据用户在 `/grill-me` 互动面试中的三项确认：
  - 决策 1：云盘保存目录采用“预设标准目录 + 快速切换胶囊 + 自定义路径输入框”，默认 `/SJTU课程备份`；
  - 决策 2：全面解耦，AI 字幕/笔记双独立开关，作业归档说明/附件/提交原件三独立开关；
  - 决策 3：经典 Apple macOS 天蓝立体质感文件夹，纯矢量分层绘制。
- 遵循 `RULE[d:\SJTU\编程\sjtu-downloader-all-in-one\GEMINI.md]` 词汇规范化要求。

## Global Constraints
- 严格遵循 `RULE[d:\SJTU\编程\sjtu-downloader-all-in-one\GEMINI.md]`：禁止界面多重竞争按钮，通用逻辑收口至 `src/shared/utils.ts`，严禁重复造轮子；
- 静态文案遵循《拟修改词汇与规范化对照表》，简洁得体，适配 UI 紧凑空间；
- 全链路门禁要求：`npm run typecheck`、`npm run lint`、`npm test` 全绿通过。

---

## 《拟修改词汇与规范化对照表》（GEMINI.md 强制门禁）

| 原表述 / 待定表述 | 拟规范化表述 | 修改考量与用户体验收益 |
| :--- | :--- | :--- |
| `写死 /SJTU课程备份 无配置` | **交大云盘保存目录**（默认: `/SJTU课程备份`） | 赋予用户自主规划交大云盘目录结构的权力，防止默认写入污染云盘根目录 |
| `SJTU Canvas课程` (固定前缀) | **自定义目标目录**（快捷支持 `/SJTU课程备份`、`云盘根目录 /`、`/我的课程`） | 语义清晰通俗，提供一键快捷切换与自定义自由度，并配有面包屑实时预览 |
| `AI语音逐字稿导出`（捆绑导出 .srt 与 .md） | **导出外挂字幕 (.srt)** 与 **导出复习笔记 (.md)**（双独立开关） | 彻底解耦字幕与笔记，满足只需要双击播放器字幕或离线复习笔记的不同用户群体需求 |
| `作业全量归档`（捆绑说明、附件与提交） | **Canvas 作业导出偏好**：`作业说明文档 (.md)` / `题目附件与资料` / `本人提交历史` | 避免无差别下载过大或重复的作业附件，大幅节省本地与云盘存储空间 |

---

### Task 1: 纯矢量高保真 Apple macOS 天蓝立体文件夹图标重构与测试

**Files:**
- Modify: `src/renderer/src/components/DownloadUI.tsx:860-915`
- Test: `src/renderer/src/components/DownloadUI.test.ts`

**Interfaces:**
- Consumes: `{ size?: number; className?: string }`
- Produces: `export function MacOSFolderIcon({ size, className }: { size?: number; className?: string }): JSX.Element`

- [ ] **Step 1: 编写/更新针对 MacOSFolderIcon 纯矢量分层结构与属性的测试用例**

在 `src/renderer/src/components/DownloadUI.test.ts` 中更新 `MacOSFolderIcon` 的渲染断言，确保它包含：
1. 具有正确的 `viewBox="0 0 100 80"` 与宽高尺寸；
2. 彻底移除了导致全局冲突与透明失效的脆弱 `<defs><linearGradient id="macFolder...`；
3. 包含背板、内衬、前盖与立体高光矢量图层，且颜色填充均为内联有效色彩代码（如 `#2563EB`, `#3B82F6`）。

- [ ] **Step 2: 运行测试验证当前实现或失败**

运行: `npm test -- src/renderer/src/components/DownloadUI.test.ts`

- [ ] **Step 3: 重构 `MacOSFolderIcon` 纯矢量分层实现**

在 `src/renderer/src/components/DownloadUI.tsx` 中重构 `MacOSFolderIcon`：
```tsx
export function MacOSFolderIcon({
  size = 64,
  className = ''
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`drop-shadow-sm select-none shrink-0 ${className}`}
    >
      {/* 1. 文件夹深蓝背板与上方 Tab */}
      <path
        d="M6 14C6 9.58172 9.58172 6 14 6H34.5C37.5 6 40.2 7.8 41.5 10.5L43.8 15H86C90.4183 15 94 18.5817 94 23V68C94 72.4183 90.4183 76 86 76H14C9.58172 76 6 72.4183 6 68V14Z"
        fill="#2563EB"
      />
      {/* 2. 文件夹开口暗色内衬 */}
      <rect x="10" y="17" width="80" height="15" rx="3" fill="#1D4ED8" />
      {/* 3. 文件夹露出纸张微白横条（提供细腻物理拟物感） */}
      <rect x="16" y="14" width="68" height="6" rx="2" fill="#DBEAFE" fillOpacity="0.9" />
      {/* 4. 文件夹主前盖（经典 Apple macOS 天蓝色） */}
      <path
        d="M6 26C6 22.6863 8.68629 20 12 20H88C91.3137 20 94 22.6863 94 26V68C94 72.4183 90.4183 76 86 76H14C9.58172 76 6 72.4183 6 68V26Z"
        fill="#3B82F6"
      />
      {/* 5. 前盖顶部高光微凸倒角 */}
      <path
        d="M6 26C6 22.6863 8.68629 20 12 20H88C91.3137 20 94 22.6863 94 26V28H6V26Z"
        fill="#93C5FD"
        fillOpacity="0.8"
      />
      {/* 6. 前盖底缘微妙投影衬底 */}
      <path
        d="M14 76H86C90.4183 76 94 72.4183 94 68V70C94 74.4183 90.4183 78 86 78H14C9.58172 78 6 74.4183 6 70V68C6 72.4183 9.58172 76 14 76Z"
        fill="#1D4ED8"
        fillOpacity="0.5"
      />
    </svg>
  )
}
```

- [ ] **Step 4: 运行测试并确保通过**

运行: `npm test -- src/renderer/src/components/DownloadUI.test.ts`
预期: PASS

---

### Task 2: 全局状态管理扩展、持久化与类型定义

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/store/app.ts`
- Test: `test/renderer/store.test.ts` (或在已有状态机测试中补充)

**Interfaces:**
- Produces:
  - `cloudDestRoot: string` (默认: `'/SJTU课程备份'`)
  - `setCloudDestRoot: (path: string) => void`
  - `canvasExportSrt: boolean` (默认: `true`)
  - `setCanvasExportSrt: (on: boolean) => void`
  - `canvasExportMarkdown: boolean` (默认: `true`)
  - `setCanvasExportMarkdown: (on: boolean) => void`
  - `canvasAssignmentOptions: CanvasAssignmentExportOptions` (默认: `{ exportMarkdown: true, downloadAttachments: true, downloadSubmissions: true }`)
  - `setCanvasAssignmentOptions: (opts: Partial<CanvasAssignmentExportOptions>) => void`
  - 保留 `canvasExportAiTranscript` 为兼容字段 (`canvasExportSrt || canvasExportMarkdown`)

- [ ] **Step 1: 在 `src/shared/types.ts` 中补充类型定义**

```ts
export interface CanvasAssignmentExportOptions {
  exportMarkdown: boolean
  downloadAttachments: boolean
  downloadSubmissions: boolean
}
```

- [ ] **Step 2: 在 `src/renderer/src/store/app.ts` 中增加状态、Setter 与 LocalStorage 持久化**

1. 在 `AppState` 中增加上述字段与 setter 签名；
2. 在 `create<AppState>()` 初始值中配置默认值：
   - `cloudDestRoot: '/SJTU课程备份'`
   - `canvasExportSrt: true`
   - `canvasExportMarkdown: true`
   - `canvasAssignmentOptions: { exportMarkdown: true, downloadAttachments: true, downloadSubmissions: true }`
3. 在 `partialize` 中添加这些字段的持久化，保证跨页签切换与重启自动还原；
4. 保留并适配 `canvasExportAiTranscript` 的 setter 以向下兼容向导和旧逻辑。

- [ ] **Step 3: 运行静态类型检查**

运行: `npm run typecheck`
预期: 0 错误

---

### Task 3: 改造初始向导 `SetupWizardModal.tsx`

**Files:**
- Modify: `src/renderer/src/components/SetupWizardModal.tsx`

**Interfaces:**
- Consumes: `cloudDestRoot`, `setCloudDestRoot`, `canvasExportSrt`, `setCanvasExportSrt`, `canvasExportMarkdown`, `setCanvasExportMarkdown`

- [ ] **Step 1: 向导第 2 步（下载与保存偏好）增加“交大云盘保存目录”设置卡片**

1. 在本地下载目录下方增加交大云盘保存目录卡片；
2. 提供 3 个快捷预设胶囊按钮：
   - `[ /SJTU课程备份 (默认) ]`
   - `[ 云盘根目录 (/) ]`
   - `[ /我的课程 ]`
3. 提供自定义路径输入框，支持直接修改；
4. 实时显示路径层级面包屑预览：`交大云盘 > [用户设定目录] > [学期] > [课程名称] > ...`。

- [ ] **Step 2: 向导第 4 步（AI 语音逐字稿与字幕）升级为双卡片独立勾选**

1. 将原单选开关卡片重构为两张独立的勾选配置卡片：
   - 卡片 1: `导出外挂字幕 (.srt)` — 配以播放器徽标与说明文案；
   - 卡片 2: `导出复习笔记 (.md)` — 配以 Markdown 讲义笔记徽标与说明文案；
2. 用户可按需任选一项、两项全选或全不选。

---

### Task 4: 改造设置中心 `Settings.tsx`

**Files:**
- Modify: `src/renderer/src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `cloudDestRoot`, `setCloudDestRoot`, `canvasExportSrt`, `setCanvasExportSrt`, `canvasExportMarkdown`, `setCanvasExportMarkdown`, `canvasAssignmentOptions`, `setCanvasAssignmentOptions`

- [ ] **Step 1: 在“存储与路径”分栏新增“交大云盘保存目录”卡片**

1. 包含当前路径展示与输入框；
2. 包含快捷切换胶囊（`/SJTU课程备份`、`云盘根目录 /`、`/我的课程`）；
3. 规范化输入：自动处理首尾空格、清理非法字符、规范化斜杠格式。

- [ ] **Step 2: 在“Canvas 课程与高级设置”分栏分别放置字幕与笔记独立开关**

1. `导出外挂字幕 (.srt)` 独立开关；
2. `导出时间轴笔记 (.md)` 独立开关。

- [ ] **Step 3: 在“Canvas 课程与高级设置”分栏新增“Canvas 作业导出偏好”独立复选组**

提供 3 个细粒度开关：
1. `作业说明文档 (.md)`（题目要求与作业评语）；
2. `题目附件与资料`（教师发布的作业附件材料）；
3. `本人提交原件历史`（过往已提交的作业附件原件）。

---

### Task 5: 渲染进程调度与主进程下载引擎全面对接

**Files:**
- Modify: `src/renderer/src/pages/CanvasBrowser.tsx`
- Modify: `src/main/canvas/orchestrator.ts`
- Modify: `src/main/canvas/assignment-download.ts`
- Modify: `src/main/download-engine/cloud.ts`
- Modify: `src/main/download-engine/shared.ts`

- [ ] **Step 1: `CanvasBrowser.tsx` 对接细粒度导出选项**

1. 视频逐字稿导出：根据 `canvasExportSrt || canvasExportMarkdown` 决定是否触发批量导出任务，并将具体的 `exportSrt` 与 `exportMarkdown` 布尔值透传给 `window.api.canvas.downloadTranscriptBatch`；
2. 作业归档导出：在调用 `window.api.canvas.downloadAssignmentArchive` 时透传 `canvasAssignmentOptions`。

- [ ] **Step 2: `assignment-download.ts` 对接细粒度选项**

在 `downloadAssignmentArchive` 中按传入的 `exportMarkdown`、`downloadAttachments`、`downloadSubmissions` 选项分别执行生成，未勾选的项目直接跳过。

- [ ] **Step 3: 云盘路径计算与创建对接 `cloudDestRoot`**

1. 在 `cloudRemotePath` 与 `cloudFolderSegments` 中读取配置的 `cloudDestRoot`（若为空或 `'/'` 则直属根目录；若为 `/SJTU课程备份` 则作为顶层目录层级）；
2. 确保各级目录 `ensureFolderPath` 正常递归创建。

---

### Task 6: 自动化测试补充与全链路门禁验证

**Files:**
- Modify / Create: `test/e2e/export-decoupling.test.ts`
- Test: All suites

- [ ] **Step 1: 编写解耦导出与云盘路径计算的自动化测试**

验证：
1. `downloadLectureTranscript` 当 `exportSrt=false, exportMarkdown=true` 时仅产出 `.md`；
2. 当 `exportSrt=true, exportMarkdown=false` 时仅产出 `.srt`；
3. `downloadAssignmentArchive` 仅按选项下载对应产物；
4. `cloudRemotePath` 正确支持自定义 `cloudDestRoot`。

- [ ] **Step 2: 顺序运行三项门禁命令**

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`

确保全绿通过，0 错误 0 警告。
