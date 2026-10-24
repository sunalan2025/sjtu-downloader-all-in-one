# 课程下载现代交互重构与多视图组件融合实施计划 (Redesign Course Download UX & Floating Command Island)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底移除课程二级目录下方突兀且割裂的“专属操作”长条白板面板；针对三种视图（分栏、网格、列表）各归其位重构——分栏视图配备「第 4 栏动态检查器 (Inspector)」，网格与列表视图配备「底栏智能指挥动作岛 (Floating Command Island)」，全视图文件行配备「悬停即现 ⬇ 极速下载」，实现 0 模态打断、0 页面割裂、0 内容区污染的现代下载体验。

**Architecture:**
- **彻底净化内容区 (Clean Viewport)**：在 `NetdiskCourseExplorer.tsx` 中彻底废除 `renderExtra` 底部长条横幅倾倒逻辑，恢复 100% 纯净的 macOS HIG 文件夹网格与列表。
- **底栏智能动作岛 (Floating Command Island)**：创建独立的悬浮毛玻璃组件 `FloatingCommandIsland.tsx`。多选时从底部平滑浮出，动态计算已选课程/文件项数与预估字节容量，内嵌交互式分类芯片（`[📘 课件]`、`[🎬 视频 ▾ (机位微调)]`、`[📝 作业]`、`[📑 PPT讲义]`）与立即下载主按钮。
- **分栏视图第 4 栏动态检查器 (Column Inspector)**：将 ColumnView 第 4 栏由“仅限单文件预览”升级为“三级动态检查器”（课程概览、分类偏好、文件预览），承载单门课程的机位偏好、板书切片、存储结构与单课下载。
- **单文件极速获取 (Zero-Friction Hover Action)**：在三级文件列表卡片与行中加入悬停即现的 `⬇` 下载按钮，1 步就地加入下载队列。
- **响应式容量预估 (Reactive Size Engine)**：在 `src/shared/utils.ts` 中沉淀纯函数，根据已选文件和视频机位毫秒级动态重算预估体积。

**Tech Stack:**
- React 19 + TypeScript + Tailwind CSS (v3) + Zustand
- Lucide-style SVG icons + Framer-motion/Tailwind transition classes
- Vitest

---

## Global Constraints & Terminology Alignment (GEMINI.md Guardrail)

### 《拟修改词汇与规范化对照表》
| 原表述 / 待定表述 | 拟规范化表述 | 修改考量与用户体验收益 |
| :--- | :--- | :--- |
| `课程作业与提交 专属操作` / `课堂视频 专属操作` / `PPT课件 (PDF) 专属操作` | **彻底移除长条面板**，功能收拢至底栏动作岛与分栏检查器 | 消除割裂半成品感的冗余横条，恢复 100% 纯净文件夹网格 |
| `视角筛选` 散落横排按钮组 | `[ 🎬 视频 (仅教师) ▾ ]`（动作岛下拉）+ `全部 (28) · 仅教师 (14) · 仅PPT (14)`（分段胶囊） | 动词属性弱化为直观选项，减少视觉杂乱 |
| `开始下载 (X)` 单调按钮 | `[ 立即下载 42 项 (约 3.1 GB) ⏎ ]` | 带来确定性与容量预知感，清楚感知消耗空间 |
| `专属机位选择` | `视频录播机位` / `机位画面` | 通俗化表达，避免“机位选择”等内部黑话 |
| 无单文件下载按钮（需先勾选再找底栏） | `[ ⬇ 下载 ]`（悬停即现操作） | 1 步就地直接触发，零摩擦获取单讲课件与视频 |

### 门禁铁律 (Verification Gate)
- 任何代码改动必须通过：
  1. `npm run typecheck` (0 错误)
  2. `npm run lint` (0 错误 0 警告)
  3. `npm test` (100% 通过全套测试)

---

## Task Decomposition

### Task 1: 沉淀响应式体积预估引擎与单文件直下调度逻辑 (`utils.ts` & `CanvasBrowser.tsx`)

**Files:**
- Modify: `src/shared/utils.ts`
- Modify: `src/shared/types.ts`
- Test: `test/unit/resource-size-engine.test.ts`

**Interfaces:**
- Produces: `estimateResourceSize(params: { fileBytes: number; videoCount: number; perspective: 'all' | 'teacher' | 'ppt' | 'audio'; hasAssignments: boolean; hasPptPdf: boolean }): { totalBytes: number; formattedSize: string }`
- Produces: `downloadSingleCanvasItem(item: { id: string; type: 'file' | 'video' | 'assignment'; name: string; courseId: number; url?: string; localPath?: string }): void`

- [ ] **Step 1: 编写 `test/unit/resource-size-engine.test.ts` 失败测试**
  覆盖文件字节累加、视频不同机位加权预估（教师 450MB/讲，双机位 650MB/讲，音频 45MB/讲）、PPT 切片增量计算与友好格式化。
- [ ] **Step 2: 运行测试验证失败**
  `npm test -- test/unit/resource-size-engine.test.ts`
- [ ] **Step 3: 在 `src/shared/utils.ts` 中实现 `estimateResourceSize`**
  实现精准求和与智能加权预估，返回字节数与人类可读字符串（如 `约 3.1 GB`）。
- [ ] **Step 4: 运行测试验证通过**
  `npm test -- test/unit/resource-size-engine.test.ts`
- [ ] **Step 5: Commit**
  `git commit -m "feat(utils): add reactive resource size estimation engine"`

---

### Task 2: 构建底栏智能指挥动作岛组件 (`FloatingCommandIsland.tsx`)

**Files:**
- Create: `src/renderer/src/components/FloatingCommandIsland.tsx`
- Test: `test/unit/floating-command-island.test.ts`

**Interfaces:**
- Consumes: `useAppStore`, `estimateResourceSize`
- Produces: `<FloatingCommandIsland selectedSummary={...} onPerspectiveChange={...} onToggleCategory={...} onDownload={...} />`

- [ ] **Step 1: 编写组件单元测试**
  测试当选中项 > 0 时浮现，测试分类芯片（课件、视频机位下拉、作业、PPT）点击事件与状态反转，测试容量实时变动。
- [ ] **Step 2: 实现 `FloatingCommandIsland.tsx`**
  - 使用 Tailwind 弹性毛玻璃样式（`fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-surface-1/90 backdrop-blur-xl border border-bd/80 shadow-2xl rounded-2xl p-2`）；
  - 左侧：信息汇聚胶囊（已选 X 门课 · Y 项资源 · 预估 Z GB）；
  - 中间：交互式芯片组（`[📘 课件]`、`[🎬 视频 ▾]` 带浮动菜单、`[📝 作业]`、`[📑 PPT讲义]`）；
  - 右侧：存储目标切换 + `[ 立即下载 Z (⏎) ]`。
- [ ] **Step 3: 运行测试并确保通过**
  `npm test -- test/unit/floating-command-island.test.ts`
- [ ] **Step 4: Commit**
  `git commit -m "feat(ui): create FloatingCommandIsland component with chips and real-time size meter"`

---

### Task 3: 升级分栏视图第 4 栏动态检查器 (`NetdiskCourseExplorer.tsx` ColumnView)

**Files:**
- Modify: `src/renderer/src/components/NetdiskCourseExplorer.tsx`
- Test: `test/unit/column-inspector.test.ts`

**Interfaces:**
- 依据当前分栏选中的焦点（课程 / 分类 / 文件）：
  - 选中课程时：呈现课程概览卡片、各分类资源占比、机位切换控件、PPT讲义开关、一键下载整门课大按钮；
  - 选中分类时：呈现分类描述与批量归档快捷按钮；
  - 选中文件时：维持文件预览与单文件下载按钮。

- [ ] **Step 1: 编写分栏第 4 栏检查器测试**
  断言选中课程、分类和单文件时第 4 栏分别呈现正确的标题与控制项。
- [ ] **Step 2: 重构 `ColumnView` 中的第 4 栏渲染逻辑**
  抽取出 `CourseOverviewInspector` 与 `FileDetailInspector`，支持优雅自适应切换。
- [ ] **Step 3: 运行测试并确保通过**
  `npm test -- test/unit/column-inspector.test.ts`
- [ ] **Step 4: Commit**
  `git commit -m "feat(column): enhance 4th column as dynamic course and category inspector"`

---

### Task 4: 彻底移除课程内容区长条白板并集成悬停极速下载 (`NetdiskCourseExplorer.tsx`)

**Files:**
- Modify: `src/renderer/src/components/NetdiskCourseExplorer.tsx`
- Modify: `src/renderer/src/pages/CanvasBrowser.tsx`
- Test: `test/e2e/netdisk-explorer-ux.test.ts`

**Exact Requirements:**
1. **彻底删除白板**：
   - 彻底删除 `NetdiskCourseExplorer.tsx` 中 `currentCourse.categories.some(cat => !!cat.renderExtra)` 生成的 `{cat.name} 专属操作` 容器；
   - 彻底删除 `ListView` 与 `ColumnView` 中突兀的 `renderExtra` 顶条；
   - 课程主页（二级目录）只保留 4 个原汁原味的纯净文件夹卡片！
2. **三级目录顶部内嵌视角筛选器**：
   - 进入 `课堂视频` 分类时，在列表顶栏内嵌优雅的 Filter Pills 胶囊分段器：
     `[ 全部视频 (28) | 仅教师视角 (14) | 仅PPT投屏 (14) ]`；
3. **单文件悬停即现操作**：
   - 在每个课件行与视频行右侧，鼠标悬停时平滑浮现轻量 `[ ⬇ 下载 ]` 按钮；
   - 点击该按钮直接将该单项压入下载队列，不强迫勾选多选框，并弹出轻量 Toast 反馈。
4. **集成 `FloatingCommandIsland`**：
   - 在网格视图与列表视图底部挂载 `FloatingCommandIsland`，与 Zustand 全局状态双向同步。

- [ ] **Step 1: 编写 E2E/集成测试 `test/e2e/netdisk-explorer-ux.test.ts`**
  - 断言二级目录中不再存在任何包含 `专属操作` 的 DOM 节点；
  - 断言单文件悬停具有独立的下载动作出口；
  - 断言底栏动作岛在选中项变化时正确浮现与消失。
- [ ] **Step 2: 修改 `NetdiskCourseExplorer.tsx` 与 `CanvasBrowser.tsx`**
  彻底清理 `renderExtra` 逻辑，内嵌顶部筛选器，集成悬停按钮与动作岛。
- [ ] **Step 3: 运行测试验证通过**
  `npm test -- test/e2e/netdisk-explorer-ux.test.ts`
- [ ] **Step 4: Commit**
  `git commit -m "feat(ux): clean in-content banners and integrate floating island with hover download"`

---

### Task 5: 全套自动化测试补充与全链路门禁终验

**Files:**
- Run: `npm run typecheck`
- Run: `npm run lint`
- Run: `npm test`

- [ ] **Step 1: 运行 TypeScript 静态检查**
  `npm run typecheck` 确保 0 errors。
- [ ] **Step 2: 运行 ESLint 规范检查**
  `npm run lint` 确保 0 errors, 0 warnings。
- [ ] **Step 3: 运行全量测试套件**
  `npm test` 确保全量套件 100% 绿灯。
- [ ] **Step 4: Commit**
  `git commit -m "chore: verify all gates pass after download UX overhaul"`
