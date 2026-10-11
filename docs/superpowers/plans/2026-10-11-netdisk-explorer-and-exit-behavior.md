# Netdisk Explorer, Three View Modes & Window Exit Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建夸克网盘式课程资源浏览器（支持网格大图标、详细列表、分栏并列三重视图与下钻导航，初始收起所有课程），修复登录跳转设置缺陷，去除状态统计的伪按钮外框，并实现系统退出与下载保护设置。

**Architecture:** 
1. 状态层（Zustand Store）：增加 `courseViewMode`（`grid` \| `list` \| `column`）、`windowCloseAction` 与 `exitWhenDownloading` 持久化，强化 `activeTab` 启动过滤；
2. 导航层（Netdisk Navigation）：新增 `BreadcrumbBar` 面包屑与 `ViewModeSwitch` 三态切换器；
3. 展示层（NetdiskCourseExplorer）：封装通用的网盘式文件与课程多级视图，驱动 Canvas / 旁听课 / 好大学在线的资源展示与复选下载；
4. 窗口交互层（Window IPC）：打通设置与主进程，支持最小化到托盘/任务栏、有任务时的防误触保护。

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Zustand, Electron IPC, Vitest

**Spec:** [docs/superpowers/specs/2026-10-11-netdisk-explorer-and-exit-behavior-design.md](file:///d:/SJTU/编程/sjtu-downloader-all-in-one/docs/superpowers/specs/2026-10-11-netdisk-explorer-and-exit-behavior-design.md)

## Global Constraints

- LaTeX 数学公式严禁未转义的 `$` 符号，正文中所有美元符号必须转义为 `\$` 或包裹在行内代码块中。
- 所有文件链接使用标准 Markdown 超链接（`[filename](file:///...)`）且斜杠统一为正斜杠。
- 保留现存所有 422 项自动化测试持续全部 PASS，`npm run typecheck` 保持零错误。
- 保证无任何 TBD/TODO 占位符，每一项变更均提供直接可执行的代码块。

---

### Task 1: 登录跳转修复与状态信息标签样式纠偏

**Files:**
- Modify: `src/renderer/src/store/app.ts:705-726`
- Modify: `src/renderer/src/pages/Login.tsx:640-685`
- Modify: `src/renderer/src/pages/Welcome.tsx:15-20`
- Modify: `src/renderer/src/pages/CanvasBrowser.tsx:1088-1095`
- Modify: `src/renderer/src/pages/AuditedCourses.tsx:410-418`
- Modify: `src/renderer/src/pages/CnmoocBrowser.tsx:318-326`
- Test: `test/e2e/auth-session.test.ts`

**Interfaces:**
- Consumes: `useAppStore`
- Produces: 启动与登录自动回正至课程主页；状态标签纯文本渲染无按钮外框。

- [ ] **Step 1: 在测试中编写 activeTab 持久化脱敏校验**

```ts
// test/e2e/auth-session.test.ts 增加断言
it('should sanitize activeTab when persisted state contains settings or transfer', () => {
  const rawState = { activeTab: 'settings', lastCourseTab: 'canvas' }
  const sanitizedTab = (rawState.activeTab === 'settings' || rawState.activeTab === 'transfer')
    ? (rawState.lastCourseTab || 'canvas')
    : rawState.activeTab
  expect(sanitizedTab).toBe('canvas')
})
```

- [ ] **Step 2: 运行测试验证**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: 修改 store/app.ts 中的 partialize 与初始化过滤**

在 `src/renderer/src/store/app.ts` 的 `partialize` 中：
```ts
partialize: state => ({
  theme: state.theme,
  activeTab: (state.activeTab === 'settings' || state.activeTab === 'transfer')
    ? (state.lastCourseTab || 'canvas')
    : state.activeTab,
  ...
})
```
并在初始 state 读取时校验，若读取到的 `activeTab` 为 `'settings'` 或 `'transfer'`，重置为 `lastCourseTab || 'canvas'`。

- [ ] **Step 4: 修复三页操作栏的已选统计标签，去除伪按钮外框与阴影**

在 `CanvasBrowser.tsx`、`AuditedCourses.tsx`、`CnmoocBrowser.tsx` 中，将：
```tsx
<div className="flex h-10 items-center gap-1.5 rounded-xl border border-bd bg-surface-2 px-3 text-xs font-medium text-text-2 shadow-2xs">
```
替换为非按钮、纯信息展示胶囊：
```tsx
<div className="flex items-center gap-1.5 text-xs font-medium text-text-2">
  <span className="text-accent font-bold">☑</span>
  <span>已选 {selectedStats.totalCount} 项{selectedStats.totalBytes > 0 ? ` (${formatBytes(selectedStats.totalBytes)})` : ''}</span>
</div>
```

- [ ] **Step 5: 运行类型检查与测试**

Run: `npm run typecheck && npm test`
Expected: 0 errors, 422 passed.

---

### Task 2: 窗口退出行为与下载保护策略（Store 与设置面板）

**Files:**
- Modify: `src/renderer/src/store/app.ts`
- Modify: `src/renderer/src/pages/Settings.tsx`
- Modify: `src/renderer/src/components/WindowConfirmModal.tsx`
- Modify: `src/main/window.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Produces: `windowCloseAction: 'tray' | 'taskbar' | 'quit'`，`exitWhenDownloading: 'prompt' | 'background' | 'pause_quit'`，`setWindowCloseAction`，`setExitWhenDownloading`。

- [ ] **Step 1: 编写窗口策略状态变更的单元测试**

在 `src/renderer/src/components/DownloadUI.test.ts` 中增加窗口策略初始值测试：
```ts
it('has correct default window exit preferences', () => {
  const store = useAppStore.getState()
  expect(store.windowCloseAction).toBe('tray')
  expect(store.exitWhenDownloading).toBe('prompt')
})
```

- [ ] **Step 2: 扩展 store/app.ts 增加偏好定义与持久化**

定义：
```ts
export type WindowCloseAction = 'tray' | 'taskbar' | 'quit'
export type ExitWhenDownloadingPolicy = 'prompt' | 'background' | 'pause_quit'
```
并在 `AppState` 中加入对应的状态字段、setter 函数及持久化导出。

- [ ] **Step 3: 在 Settings.tsx「外观与通用」中增加卡片选项行**

使用 `Segmented` 分段控制器渲染：
- 关闭主窗口动作：`[ 最小化到系统托盘 (推荐) | 最小化到任务栏 | 彻底退出应用 ]`
- 正在下载时关闭策略：`[ 始终弹窗询问确认 (推荐) | 自动转入托盘继续下载 | 自动暂停任务并退出应用 ]`

- [ ] **Step 4: 在 WindowConfirmModal.tsx 中结合用户配置分流处理**

读取 `useAppStore.getState().windowCloseAction` 与 `exitWhenDownloading`：
- 无下载任务：按 `windowCloseAction` 执行相应操作（`tray` -> `minimize()`, `taskbar` -> `minimizeToTaskbar()`, `quit` -> `quit()`）；
- 有下载任务：按 `exitWhenDownloading` 执行（`prompt` 弹窗、`background` 静默入托盘、`pause_quit` 自动暂停并退出）。

- [ ] **Step 5: 验证并运行测试**

Run: `npm run typecheck && npm test`
Expected: PASS

---

### Task 3: 网盘式导航核心组件（面包屑导航与三态视图切换器）

**Files:**
- Create: `src/renderer/src/components/BreadcrumbBar.tsx`
- Modify: `src/renderer/src/components/DownloadUI.tsx`
- Modify: `src/renderer/src/store/app.ts`

**Interfaces:**
- Produces: 
  - `courseViewMode: 'grid' | 'list' | 'column'`
  - `<NetdiskViewModeSwitch mode={mode} onChange={setMode} />`
  - `<BreadcrumbBar items={items} onNavigate={onNavigate} />`

- [ ] **Step 1: 在 store/app.ts 中引入 courseViewMode**

```ts
export type CourseViewMode = 'grid' | 'list' | 'column'
```
默认值为 `'grid'`（网格大图标）。

- [ ] **Step 2: 创建 BreadcrumbBar.tsx 组件**

实现支持点击回退、带有图标与分割符的现代网盘面包屑条：
```tsx
export interface BreadcrumbItem {
  id: string
  label: string
  icon?: React.ReactNode
}

export function BreadcrumbBar({
  items,
  onNavigate
}: {
  items: BreadcrumbItem[]
  onNavigate: (id: string) => void
}) {
  return (
    <nav className="flex items-center gap-1.5 py-1.5 text-xs text-text-3 font-medium select-none">
      {items.map((it, idx) => {
        const isLast = idx === items.length - 1
        return (
          <div key={it.id} className="flex items-center gap-1.5">
            {idx > 0 && <span className="text-text-4 font-mono">/</span>}
            <button
              type="button"
              disabled={isLast}
              onClick={() => onNavigate(it.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors ${
                isLast
                  ? 'font-bold text-text-1 cursor-default'
                  : 'text-text-3 hover:bg-surface-2 hover:text-text-1 cursor-pointer'
              }`}
            >
              {it.icon}
              <span className="truncate max-w-[200px]">{it.label}</span>
            </button>
          </div>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 3: 在 DownloadUI.tsx 中实现 NetdiskViewModeSwitch**

支持分栏 `◫`、列表 `☰`、网格 `⊞` 三种图标与激活状态：
```tsx
export function NetdiskViewModeSwitch({
  mode,
  onChange
}: {
  mode: CourseViewMode
  onChange: (m: CourseViewMode) => void
}) {
  return (
    <div className="flex h-10 items-center rounded-xl border border-bd bg-surface-2 p-1 shadow-2xs">
      <button
        type="button"
        onClick={() => onChange('column')}
        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors cursor-pointer ${
          mode === 'column' ? 'bg-surface-1 text-accent shadow-2xs font-semibold' : 'text-text-3 hover:text-text-1'
        }`}
        title="分栏多级并列视图 (Column)"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="5.5" height="18" rx="1" />
          <rect x="10.5" y="3" width="5.5" height="18" rx="1" />
          <rect x="18" y="3" width="3" height="18" rx="0.5" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onChange('list')}
        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors cursor-pointer ${
          mode === 'list' ? 'bg-surface-1 text-accent shadow-2xs font-semibold' : 'text-text-3 hover:text-text-1'
        }`}
        title="详细列表视图 (List)"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" strokeWidth="3" />
          <line x1="3" y1="12" x2="3.01" y2="12" strokeWidth="3" />
          <line x1="3" y1="18" x2="3.01" y2="18" strokeWidth="3" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onChange('grid')}
        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors cursor-pointer ${
          mode === 'grid' ? 'bg-surface-1 text-accent shadow-2xs font-semibold' : 'text-text-3 hover:text-text-1'
        }`}
        title="网格大图标视图 (Grid)"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      </button>
    </div>
  )
}
```

- [ ] **Step 4: 编译检查**

Run: `npm run typecheck`
Expected: 0 errors.

---

### Task 4: NetdiskCourseExplorer 核心实现与三重视图接入

**Files:**
- Create: `src/renderer/src/components/NetdiskCourseExplorer.tsx`
- Modify: `src/renderer/src/pages/CanvasBrowser.tsx`
- Modify: `src/renderer/src/pages/AuditedCourses.tsx`
- Modify: `src/renderer/src/pages/CnmoocBrowser.tsx`

**Interfaces:**
- Produces: 
  - 默认全部收起，根目录展示整洁课程文件夹；
  - 单击/双击进入课程（下钻），面包屑更新；
  - 网格视图：大文件夹卡片；
  - 列表视图：带大小、类型的详细表格；
  - 分栏视图：macOS Finder 级多栏并列联动展开。

- [ ] **Step 1: 构建 NetdiskCourseExplorer.tsx 组件**

实现统一的层级导航状态机：
```tsx
export interface NetdiskNavState {
  level: 'root' | 'course' | 'category'
  courseId?: number | string
  categoryId?: string
}
```
并且提供针对 `grid`、`list`、`column` 三种排版模式的高效渲染。

- [ ] **Step 2: 改造 CanvasBrowser.tsx 接入网盘浏览器**

- 删除旧版的 `autoExpandedRef.current = true` 强制全量展开逻辑；
- 接入 `BreadcrumbBar` 与 `NetdiskViewModeSwitch`；
- 默认展示当前学期课程文件夹阵列；点击课程文件夹下钻进入，查看课件与视频；
- 保留外层一键勾选整门课程与内层单选文件的完整联动。

- [ ] **Step 3: 改造 AuditedCourses.tsx 与 CnmoocBrowser.tsx 接入网盘浏览器**

旁听课程与好大学在线统一接入网盘式浏览器，获得一致的网格、列表、分栏三重视图和面包屑导航体验。

- [ ] **Step 4: 运行自动化测试与类型检查**

Run: `npm run typecheck && npm test`
Expected: 422 passed, 0 errors.

---

### Task 5: 全链路回归与生产环境打包验证

**Files:**
- Test: 全量单元与 E2E 测试集
- Build: Electron 应用生产包

- [ ] **Step 1: 执行 TypeScript 全量检查**
Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 2: 执行全量自动化测试**
Run: `npm test`
Expected: 17 个测试套件，422+ 项测试全部 PASS

- [ ] **Step 3: 执行生产打包编译**
Run: `node scripts/run-electron-vite.mjs build`
Expected: main, preload, renderer 全部成功构建，输出产物正常。
