# 阶段五实施计划：性能度量、按需加载与信息呈现打磨 (A25) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成审计报告中 A25 的性能、构建与呈现优化，实现次级页面的按需分块加载以缩减首屏体积、解除构建器模块循环导入告警、并在传输中心清晰呈现“本机保存 / 远端服务器 / 交大云盘”三种目标并彻底防御服务器远端路径在本地系统中的非法打开。

**Architecture:**
1. `src/renderer/src/App.tsx` 使用 `React.lazy` 与 `Suspense` 对设置页、传输中心、云盘资源管理器、日程课表等非首屏路由实施动态导入，拆解单一庞大首包；
2. `src/main/ssh-tunnel.ts` 与 `src/main/private-worker.ts` 通过注入解耦停止嵌入式开发节点的逻辑，解除 Vite/Rollup 循环导入警告；
3. `src/renderer/src/pages/TransferCenter.tsx` 区分三种目标标识（本机、交大云盘、私有服务器），针对 `server_local` 任务提供远端路径复制，不向本地系统 Shell 传递远端路径。

**Tech Stack:** React 18, React.lazy, Suspense, TypeScript, Vite, Tailwind CSS, Vitest.

**Spec:** [docs/superpowers/specs/2026-10-25-phase-5-performance-code-splitting-and-ux-design.md](file:///D:/SJTU/编程/sjtu-downloader-all-in-one/docs/superpowers/specs/2026-10-25-phase-5-performance-code-splitting-and-ux-design.md)

## Global Constraints

- **UI Copywriting Alignment**: 严格遵照《拟修改词汇与规范化对照表》，明确区分“交大云盘”与“私有服务器”。
- **Verification Gate**: 任何改动提交前必须顺序通过：`npm run typecheck` (0 errors) -> `npm run lint` (0 errors, 0 warnings) -> `npm test` (100% pass)。
- **LaTeX Math Rules**: 行内公式使用 `\( ... \)` 或 `$ ... $`；块级公式使用独立成行的 `$$ ... $$`；严禁正文中出现未转义的 `$`（必须转义为 `\$` 或用代码块包裹）。
- **Clickable Links**: 所有提及的文件路径使用 GitHub markdown 链接 `[basename](file:///absolute/path/to/file)`。

---

### Task 1: 次级页面按需加载与代码分块优化 (A25)

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Test: `test/unit/code-splitting.test.ts`

**Interfaces:**
- Consumes: Page components.
- Produces: Lazy loaded modules with Suspense fallback skeleton.

- [x] **Step 1: Write test for code-splitting and lazy components in App.tsx**
  - Create `test/unit/code-splitting.test.ts`.
  - Assert that secondary pages (`Settings`, `TransferCenter`, `CloudPanExplorer`, `ScheduleBrowser`, `ResourceLibrary`, `AuditedCourses`, `CnmoocBrowser`) are lazy-loaded.
- [x] **Step 2: Run test to make sure it fails**
  - Run `npx vitest run test/unit/code-splitting.test.ts`.
- [x] **Step 3: Implement lazy loading in App.tsx**
  - In `src/renderer/src/App.tsx`:
    - Keep `Welcome`, `Login`, `CanvasBrowser` statically loaded.
    - Wrap `Settings`, `TransferCenter`, `CloudPanExplorer`, `ScheduleBrowser`, `ResourceLibrary`, `AuditedCourses`, `CnmoocBrowser` with `React.lazy`.
    - Provide a smooth `<Suspense>` wrapper with skeleton/spinner fallback.
- [x] **Step 4: Run test to make sure it passes**
  - Run `npx vitest run test/unit/code-splitting.test.ts`.
- [x] **Step 5: Run lint and typecheck**
  - Run `npm run typecheck` and `npm run lint`.
- [x] **Step 6: Commit**
  - `git add ...; git commit -m "perf(renderer): code-split secondary views with React.lazy and Suspense (A25)"`

---

### Task 2: 解除 private-worker 与 ssh-tunnel 循环导入警告 (A25)

**Files:**
- Modify: `src/main/ssh-tunnel.ts`
- Modify: `src/main/private-worker.ts`
- Test: `test/unit/ssh-tunnel.test.ts`

**Interfaces:**
- Consumes: Worker stop lifecycle callbacks.
- Produces: Acyclic import graph (`private-worker` -> `ssh-tunnel`).

- [x] **Step 1: Write test for dev worker cleanup callback registration**
  - Check `test/unit/ssh-tunnel.test.ts`.
- [x] **Step 2: Implement decoupling callback in ssh-tunnel.ts**
  - In `src/main/ssh-tunnel.ts`:
    - Remove `await import('./private-worker')`.
    - Provide `registerDevWorkerCleanupHook(fn: () => Promise<void>)` or invoke via clean callback.
    - In `src/main/private-worker.ts`: register `stopEmbeddedDevWorker` hook on startup.
- [x] **Step 3: Run test to make sure it passes**
  - Run `npx vitest run test/unit/ssh-tunnel.test.ts`.
- [x] **Step 4: Run lint and typecheck**
  - Run `npm run typecheck` and `npm run lint`.
- [x] **Step 5: Commit**
  - `git add ...; git commit -m "refactor(main): eliminate circular import between ssh-tunnel and private-worker (A25)"`

---

### Task 3: 任务保存位置区分（本机 / 远端服务器 / 云盘）与路径安全打开防错 (A25)

**Files:**
- Modify: `src/renderer/src/pages/TransferCenter.tsx`
- Test: `test/unit/transfer-storage-modes.test.ts`

**Interfaces:**
- Consumes: `DownloadSnapshotItem` storageMode / filePath / cloudPath.
- Produces: Distinct badges ("本机保存" / "交大云盘" / "私有服务器") and safe action buttons.

- [x] **Step 1: Write the failing test for transfer storage modes and actions**
  - Create `test/unit/transfer-storage-modes.test.ts`.
  - Assert that when `storageMode === 'server_local'`:
    - Badge shows `私有服务器`.
    - Does NOT render `在文件夹中显示` button (or calls copy path instead).
  - Assert that when `storageMode === 'cloudpan'`:
    - Badge shows `交大云盘`.
  - Assert that local task:
    - Badge shows `本机保存`.
    - Renders `在文件夹中显示`.
- [x] **Step 2: Run test to make sure it fails**
  - Run `npx vitest run test/unit/transfer-storage-modes.test.ts`.
- [x] **Step 3: Implement storage mode indicators in TransferCenter.tsx**
  - In `src/renderer/src/pages/TransferCenter.tsx`:
    - Render distinct badges for all three storage modes.
    - For `server_local` tasks, show remote path and copy button, do not invoke local `showInFolder`.
- [x] **Step 4: Run test to make sure it passes**
  - Run `npx vitest run test/unit/transfer-storage-modes.test.ts`.
- [x] **Step 5: Run lint and typecheck**
  - Run `npm run typecheck` and `npm run lint`.
- [x] **Step 6: Commit**
  - `git add ...; git commit -m "feat(ui): distinguish local, server and cloud storage modes with safe path handling (A25)"`

---

### Task 4: 全阶段全量门禁与收官验收

**Files:**
- Test: All tests across the entire repository

- [x] **Step 1: Run full test suite and audit script**
  - Run `npm test`.
  - Run `npm --prefix website test`.
  - Run `npm --prefix website run check`.
  - Run `node docs/audits/2026-10-24-reproduce.mjs`.
- [x] **Step 2: Run full typecheck and lint**
  - Run `npm run typecheck` and `npm run lint`.
- [x] **Step 3: Verify build**
  - Run `node scripts/run-electron-vite.mjs build`.
- [x] **Step 4: Commit**
  - `git add ...; git commit -m "chore(audit): complete Phase 5 and final verification gate (A25)"`
