# Canvas 课程全量静默后台预扫描管线实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 Canvas 课程智能静默后台预扫描流水线（`CanvasScanQueue`），支持当前学期优先秒开、历史全量课程逆序排队、用户点击即时插队以及双阶段（REST 课件与轻量视频）低开销调度，彻底消除“待获取体积”与点击等待转圈，实现纯静默无感秒开。

**Architecture:** 
1. 新建 `src/renderer/src/services/canvas-scan-queue.ts`，实现带优先级的静默调度队列：
   - 具备 High/Low 双级优先级，支持根据当前学期自动设权与用户交互点击（`promote`）动态插队；
   - 限制后台并发度为 2，每个任务之间保留 100~200ms 防抖间隙，杜绝 Canvas 接口 429 与 CPU/网络风暴；
   - 双阶段解耦：Phase 1 纯 REST 请求毫秒级获取课件、作业与文件体积（无任何隐藏窗口，内存消耗仅数十 KB）；Phase 2 延时单路补充课堂视频；
2. 在 `CanvasBrowser.tsx` 中集成队列管理器：
   - 获取课程列表后自动启动管线，当前学期课程在 1~2 秒内瞬间全部就绪；
   - 顶栏无干扰静默运行，课程卡片从“待获取体积”平滑过度到真实体积与资源项数；
   - 用户在 Miller Columns 分栏视图或网格视图中点击任意未完成课程时，该课程瞬时最高优先级插队完成。
3. 补充完整单元与集成测试，通过全链路门禁。

**Tech Stack:** TypeScript, React 19, Zustand, Vitest, Canvas REST API, Electron IPC.

**Spec:** 由用户指令与 `/grill-me` 拍板的全量历史后台扫描、当前学期优先插队、双阶段低消耗与纯静默无感就绪规范。

## Global Constraints

- 绝不使用可见括号（界面文案无生硬括号）。
- 绝不卡顿、杜绝高内存与高 CPU 占用：Phase 1 必须保持纯 REST 请求，禁止并发开启多个隐藏 BrowserWindow。
- 门禁铁律：全改动顺序通过 `npm run typecheck`、`npm run lint` 与 `npm test`。

---

### Task 1: 构建核心调度器 `CanvasScanQueue` 并编写单元测试

**Files:**
- Create: `src/renderer/src/services/canvas-scan-queue.ts`
- Create: `test/unit/canvas-scan-queue.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ScanTaskOptions {
    courseId: number
    priority?: 'high' | 'normal' | 'low'
    scanFiles: (courseId: number) => Promise<void>
    scanVideos: (courseId: number) => Promise<void>
  }
  export class CanvasScanQueue {
    constructor(concurrency?: number, delayMs?: number)
    enqueue(task: ScanTaskOptions): void
    promote(courseId: number): void
    pause(): void
    resume(): void
    clear(): void
    isRunning(): boolean
    has(courseId: number): boolean
  }
  ```

- [ ] **Step 1: 编写 `test/unit/canvas-scan-queue.test.ts` 专项单元测试**
  - 测试高低优先级队列正常调度（high 优先于 normal 与 low 执行）；
  - 测试 `promote(courseId)` 成功将待处理任务插队至队列最前列；
  - 测试并发限制（最多 2 个并行）；
  - 测试已扫描或正在运行的任务防重保护；
  - 测试 `clear()` 与销毁逻辑。

- [ ] **Step 2: 运行测试验证失败**
  - `npx vitest run test/unit/canvas-scan-queue.test.ts`

- [ ] **Step 3: 实现 `src/renderer/src/services/canvas-scan-queue.ts`**
  - 双阶段并发执行：优先调用 `scanFiles` 获取基础数据与体积，之后异步调用 `scanVideos`；
  - 优先级堆栈：维护 `highQueue` 与 `lowQueue`，每次空闲 worker 优先弹出 highQueue 首项；
  - 提供 `promote(courseId)`：若任务仍在 lowQueue，移除并推入 highQueue 头部。

- [ ] **Step 4: 运行测试验证全绿**
  - `npx vitest run test/unit/canvas-scan-queue.test.ts`

- [ ] **Step 5: Git Commit**
  - `git commit -m "feat(canvas): build intelligent priority queue CanvasScanQueue with two-phase pipeline"`

---

### Task 2: 在 `CanvasBrowser.tsx` 中集成静默后台预扫描管线

**Files:**
- Modify: `src/renderer/src/pages/CanvasBrowser.tsx:455-570`
- Modify: `src/renderer/src/pages/CanvasBrowser.tsx:1915-1945`

**Interfaces:**
- Consumes: `CanvasScanQueue` from `../services/canvas-scan-queue`
- Enhances: `CanvasBrowser` auto-scanning behavior

- [ ] **Step 1: 实例化与生命周期绑定**
  - 在 `CanvasBrowser.tsx` 中通过 `useRef` 初始化 `CanvasScanQueue` 实例；
  - 组件卸载或点击「刷新」按钮（`onRefresh`）时调用 `queueRef.current.clear()` 清理队列。

- [ ] **Step 2: 课程列表加载完成后自动入队**
  - 当 `canvasCourses` 加载完毕后：
    - 属于当前学期（`selectedTerm` 或最新学期）的课程，以 `priority: 'high'` 立即入队；
    - 其余历年历史课程，按时间逆序以 `priority: 'low'` 静默排队；
    - 遇到已在 `canvasCourseData` 缓存中的课程直接跳过。

- [ ] **Step 3: 绑定用户交互即时插队（`promote`）**
  - 在卡片悬停、点击进入课程文件夹（`onEnter`）或在分栏视图第一栏选中时：
    - 触发 `queueRef.current.promote(courseId)`；
    - 确保用户当前想看的课程立即插队到最高优先级执行，无需任何转圈等待。

- [ ] **Step 4: 保持纯静默无感 UI**
  - 顶栏不添加任何全局阻塞提示或打扰胶囊；
  - 各卡片从「待获取体积」平滑过渡到真实体积与项数。

- [ ] **Step 5: Git Commit**
  - `git commit -m "feat(canvas): integrate silent background scan queue with immediate user promotion into CanvasBrowser"`

---

### Task 3: 编写端到端集成测试与门禁验证

**Files:**
- Create: `test/e2e/canvas-background-scan.test.ts`
- Run full gate checks

- [ ] **Step 1: 编写 `test/e2e/canvas-background-scan.test.ts`**
  - 模拟 8 门跨学期课程；
  - 验证当前学期课程优先被扫描；
  - 验证用户交互 promote 某门历史课程后该课程立即优先被处理；
  - 验证卡片体积与 FloatingCommandIsland 同步无感就绪。

- [ ] **Step 2: 运行新集成测试**
  - `npx vitest run test/e2e/canvas-background-scan.test.ts`

- [ ] **Step 3: 全链路严格门禁验证**
  - `npm run typecheck`（必须 0 错误）
  - `npm run lint`（必须 0 错误 0 警告）
  - `npm test`（必须 100% 绿灯）

- [ ] **Step 4: Git Commit 并汇报**
  - `git commit -m "test(canvas): add comprehensive e2e tests for background prescan queue and verify all gates"`
