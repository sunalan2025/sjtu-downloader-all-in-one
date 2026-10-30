# 阶段三实施计划：安全隔离、凭据存储与并发队列 (A14 ~ A18) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成审计报告中 A14~A18 的 5 项核心安全加固与性能优化，实现 Worker Token 操作系统级加密存储、高权限 IPC 发送方严格鉴权、Worker 服务级 5 并发与 100 队列限制、`safeFetch` 超时彻底中止底层网络连接，以及 Zustand persist 偏好脏检查消除高频写盘。

**Architecture:** 
1. 主进程 `credentials.ts` 提供 Worker Token 的 `safeStorage` 加密读写，渲染进程 store 仅在内存保存并在 `partialize` 中剥离持久化；`worker-dispatch.ts` 派发本地落盘模式时剔除 `cloudUserToken`；
2. `app-handlers.ts` 实现 `validateIpcSender` 守卫，仅允许主窗口顶层主 frame 调用高权限凭据与系统接口，并对文件路径等参数执行白名单与安全校验；
3. `scripts/private-worker-daemon.mjs` 引入并发调度池（最大并发 5、排队上限 100，超额 429），任务记录设置 1 小时过期 TTL 与 200 条容量淘汰；
4. `safe-fetch.ts` 深度集成 `AbortController`，超时计时器触发时中止底层 `ses.fetch` 并联动外部 signal；
5. 渲染进程自定义 `createDeduplicatedStorage`，当序列化内容未变更时跳过 `localStorage.setItem`。

**Tech Stack:** Electron 32, Node.js, TypeScript, Zustand, safeStorage, AES-256-GCM, Vitest.

**Spec:** [docs/superpowers/specs/2026-10-25-phase-3-security-isolation-and-concurrency-design.md](file:///D:/SJTU/编程/sjtu-downloader-all-in-one/docs/superpowers/specs/2026-10-25-phase-3-security-isolation-and-concurrency-design.md)

## Global Constraints

- **UI Copywriting Alignment**: 涉及界面文本修改必须遵循《拟修改词汇与规范化对照表》，严禁未经确认私自更改用户可见术语。
- **Strict Verification Gate**: 任何改动提交前必须顺序通过：`npm run typecheck` (0 errors) -> `npm run lint` (0 errors, 0 warnings) -> `npm test` (100% pass)。
- **LaTeX Math Rules**: 行内公式使用 `\( ... \)` 或 `$ ... $`；块级公式使用独立成行的 `$$ ... $$`；严禁正文中出现未转义的 `$`（必须转义为 `\$` 或用代码块包裹）。
- **Clickable Links**: 所有提及的文件路径使用 GitHub markdown 链接 `[basename](file:///absolute/path/to/file)`。

---

### Task 1: Worker 凭据 safeStorage 加密存储与派发最小特权 (A14)

**Files:**
- Modify: `src/main/credentials.ts:180-264`
- Modify: `src/main/ipc/app-handlers.ts:276-295`
- Modify: `src/main/download-engine/worker-dispatch.ts:320-370`
- Modify: `src/main/private-worker.ts:57-76`
- Modify: `src/renderer/src/store/app.ts:240-248`
- Test: `test/unit/worker-token-vault.test.ts`

**Interfaces:**
- Consumes: `safeStorage` / `fallbackEncrypt` from `src/main/credentials.ts`.
- Produces: `saveWorkerAuthToken(token: string): Promise<void>`, `getWorkerAuthToken(): Promise<string>`, IPC `credentials:get-worker-token`, `credentials:save-worker-token`.

- [ ] **Step 1: Write the failing test for worker token vault and dispatch payload sanitization**
  - Create `test/unit/worker-token-vault.test.ts`.
  - Assert that `saveWorkerAuthToken` and `getWorkerAuthToken` correctly encrypt and retrieve the worker token.
  - Assert that when `storageMode === 'server_local'`, dispatch payload does not contain `cloudUserToken`.
  - Assert that `wrapWorkerProxyUrl` does not embed `&token=` in the query string.
- [ ] **Step 2: Run test to make sure it fails**
  - Run `npx vitest run test/unit/worker-token-vault.test.ts`.
- [ ] **Step 3: Implement worker token safe storage in credentials.ts and IPC handlers**
  - In `src/main/credentials.ts`: implement `saveWorkerAuthToken(token: string)` and `getWorkerAuthToken()`. Save encrypted token into `userData/credentials/worker.enc.json`.
  - In `src/main/ipc/app-handlers.ts`: register `credentials:get-worker-token` and `credentials:save-worker-token`.
  - In `src/main/download-engine/worker-dispatch.ts`: sanitize payload for `server_local` by removing `cloudUserToken`, and read encrypted token if not present in memory.
  - In `src/main/private-worker.ts`: remove `&token=` from `wrapWorkerProxyUrl` (proxies must use headers).
  - In `src/renderer/src/store/app.ts`: sanitize `privateWorkerConfig` in `partialize` so `authToken` is never written to `localStorage`.
- [ ] **Step 4: Run test to make sure it passes**
  - Run `npx vitest run test/unit/worker-token-vault.test.ts`.
- [ ] **Step 5: Run lint and typecheck**
  - Run `npm run typecheck` and `npm run lint`.
- [ ] **Step 6: Commit**
  - `git add ...; git commit -m "feat(security): encrypt worker token via safeStorage and enforce least-privilege dispatch (A14)"`

---

### Task 2: 高权限 IPC 发送方 validateIpcSender 守卫与参数防御 (A15)

**Files:**
- Modify: `src/main/ipc/app-handlers.ts`
- Test: `test/unit/ipc-sender-guard.test.ts`

**Interfaces:**
- Consumes: Electron IPC events `Electron.IpcMainInvokeEvent`.
- Produces: `validateIpcSender(event: Electron.IpcMainInvokeEvent): boolean`, parameter schema checks.

- [ ] **Step 1: Write the failing test for IPC sender guard**
  - Create `test/unit/ipc-sender-guard.test.ts`.
  - Test valid top-frame sender from `file://` or dev server URL returns true.
  - Test nested iframe (`senderFrame.parent !== null`) is rejected.
  - Test untrusted origin URL is rejected.
  - Test `app:open-path` rejects invalid types and path injection.
- [ ] **Step 2: Run test to make sure it fails**
  - Run `npx vitest run test/unit/ipc-sender-guard.test.ts`.
- [ ] **Step 3: Implement validateIpcSender and guard high-privilege IPC endpoints**
  - In `src/main/ipc/app-handlers.ts`:
    - Export `validateIpcSender(event: Electron.IpcMainInvokeEvent): boolean`.
    - Apply `validateIpcSender` guard to `credentials:*`, `app:cleanup-stale-downloads`, `app:open-path`, `app:show-in-folder`, `ssh-tunnel:*`, `private-worker:*`.
    - Validate `fullPath` in `app:open-path`: must be non-empty string, no null bytes, must resolve to existing directory/file within safe scope.
- [ ] **Step 4: Run test to make sure it passes**
  - Run `npx vitest run test/unit/ipc-sender-guard.test.ts`.
- [ ] **Step 5: Run lint and typecheck**
  - Run `npm run typecheck` and `npm run lint`.
- [ ] **Step 6: Commit**
  - `git add ...; git commit -m "feat(security): guard high-privilege IPC endpoints with validateIpcSender and sanitize arguments (A15)"`

---

### Task 3: Worker 服务级 5 并发、100 排队上限与 1h TTL 内存清理 (A16)

**Files:**
- Modify: `scripts/private-worker-daemon.mjs`
- Test: `test/unit/private-worker-concurrency.test.ts`

**Interfaces:**
- Consumes: Worker daemon request handling in `scripts/private-worker-daemon.mjs`.
- Produces: `MAX_CONCURRENT_TASKS = 5`, `MAX_QUEUE_SIZE = 100`, 429 Too Many Requests response, TTL prune for task records.

- [ ] **Step 1: Write the failing test for worker concurrency and bounded queue**
  - Create `test/unit/private-worker-concurrency.test.ts`.
  - Assert that queue allows up to 100 pending tasks.
  - Assert that 101st task receives HTTP 429 with `{ ok: false, error: '中转服务器过载：当前排队任务已达上限 (100)，请稍后再试' }`.
  - Assert that at most 5 tasks run concurrently.
  - Assert that tasks older than 3600s or exceeding 200 items are cleaned up.
- [ ] **Step 2: Run test to make sure it fails**
  - Run `npx vitest run test/unit/private-worker-concurrency.test.ts`.
- [ ] **Step 3: Implement concurrency pool, queue limits, and TTL in daemon**
  - In `scripts/private-worker-daemon.mjs`:
    - Implement `taskQueue = []`, `runningCount = 0`, `MAX_CONCURRENT_TASKS = 5`, `MAX_QUEUE_SIZE = 100`.
    - Implement `scheduleWorkerQueue()`.
    - When `/api/tasks` POST arrives, check queue limit before enqueuing.
    - Set `completedAt: Date.now()` on terminal state, implement prune routine (TTL 1 hour, max 200 items).
- [ ] **Step 4: Run test to make sure it passes**
  - Run `npx vitest run test/unit/private-worker-concurrency.test.ts`.
- [ ] **Step 5: Run lint and typecheck**
  - Run `npm run typecheck` and `npm run lint`.
- [ ] **Step 6: Commit**
  - `git add ...; git commit -m "feat(worker): enforce 5-concurrency pool, 100-queue limit and 1h memory TTL (A16)"`

---

### Task 4: safeFetch 超时深度注入 AbortController 中止底层连接 (A17)

**Files:**
- Modify: `src/main/canvas/safe-fetch.ts`
- Test: `test/unit/safe-fetch-abort.test.ts`

**Interfaces:**
- Consumes: `ses.fetch(url, init)` from Electron session.
- Produces: `safeFetch(ses, url, init, maxRetries, timeoutMs)`.

- [ ] **Step 1: Write the failing test for safeFetch timeout abort**
  - Create `test/unit/safe-fetch-abort.test.ts`.
  - Verify that `ses.fetch` receives an `AbortSignal`.
  - Verify that when `timeoutMs` triggers, the passed `signal.aborted` becomes `true`.
  - Verify that when caller passes `init.signal`, aborting caller signal also aborts underlying fetch.
- [ ] **Step 2: Run test to make sure it fails**
  - Run `npx vitest run test/unit/safe-fetch-abort.test.ts`.
- [ ] **Step 3: Implement AbortController binding in safeFetch**
  - In `src/main/canvas/safe-fetch.ts`:
    - For each fetch attempt, create an internal `AbortController`.
    - If `init?.signal` is provided, bridge it to the internal controller.
    - Pass `controller.signal` in `{ ...init, signal: controller.signal }` to `ses.fetch`.
    - In `timeoutPromise` timer callback, call `controller.abort()` before rejecting.
    - Ensure timer is cleared on both resolve and reject.
- [ ] **Step 4: Run test to make sure it passes**
  - Run `npx vitest run test/unit/safe-fetch-abort.test.ts`.
- [ ] **Step 5: Run lint and typecheck**
  - Run `npm run typecheck` and `npm run lint`.
- [ ] **Step 6: Commit**
  - `git add ...; git commit -m "fix(canvas): inject AbortController into safeFetch to cancel underlying connection on timeout (A17)"`

---

### Task 5: Zustand persist 脏检查比对与高频进度防写盘 (A18)

**Files:**
- Create: `src/renderer/src/store/dedup-storage.ts`
- Modify: `src/renderer/src/store/app.ts:240-248`
- Test: `test/unit/dedup-storage.test.ts`

**Interfaces:**
- Consumes: Zustand `StateStorage` interface.
- Produces: `createDeduplicatedStorage(underlyingStorage?: StateStorage): StateStorage`.

- [ ] **Step 1: Write the failing test for deduplicated storage**
  - Create `test/unit/dedup-storage.test.ts`.
  - Test that calling `setItem` with identical serialized strings only calls underlying storage once.
  - Test that store state updates that only modify non-persisted fields (e.g., `progress`) trigger 0 storage writes after initial save.
- [ ] **Step 2: Run test to make sure it fails**
  - Run `npx vitest run test/unit/dedup-storage.test.ts`.
- [ ] **Step 3: Implement createDeduplicatedStorage and integrate into app.ts**
  - Create `src/renderer/src/store/dedup-storage.ts`.
  - Wrap `localStorage` with `createDeduplicatedStorage` in `src/renderer/src/store/app.ts`.
- [ ] **Step 4: Run test to make sure it passes**
  - Run `npx vitest run test/unit/dedup-storage.test.ts`.
- [ ] **Step 5: Run lint and typecheck**
  - Run `npm run typecheck` and `npm run lint`.
- [ ] **Step 6: Commit**
  - `git add ...; git commit -m "perf(store): add deduplicated persist storage to eliminate disk writes on progress updates (A18)"`

---

### Task 6: 门禁断言升级与全量测试套件验证

**Files:**
- Modify: `docs/audits/2026-10-24-reproduce.mjs:150-160,210-220`
- Test: All unit and E2E tests

- [ ] **Step 1: Update reproduce.mjs with strict assertions for P2 and P4**
  - In `docs/audits/2026-10-24-reproduce.mjs`:
    - For `P2-timeout-without-abort`, assert `receivedAbortSignal === true`.
    - For `P4-persist-writes-on-runtime-updates`, import or use `createDeduplicatedStorage` pattern to assert `persistentStorageWrites === 0`.
  - Run `node docs/audits/2026-10-24-reproduce.mjs` and confirm output.
- [ ] **Step 2: Run full test suite**
  - Run `npm test`.
- [ ] **Step 3: Run full typecheck and lint**
  - Run `npm run typecheck` and `npm run lint`.
- [ ] **Step 4: Commit**
  - `git add ...; git commit -m "test(audit): update reproduce script with Phase 3 green assertions (P2, P4)"`
