# 阶段二：任务状态可信与传输引擎加固 (A06~A13) 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底修复审计报告中指出的阶段二核心传输与任务控制缺陷（A06 Worker 云盘 Token 假完成、A07 Worker 写流背压与跳过同名、A08 HLS 取消信号丢失与终态篡改、A09 传输中心 300 条历史死循环、A10 HLS 乱序缓冲无上限、A11 任务恢复直链丢失与元数据脆弱、A12 Worker 任务控制契约、A13 覆盖下载提前删除旧成品）。

**Architecture:** 建立严格的任务生命周期状态机与资源有界模型。HLS 下载全链路注入 `AbortSignal` 并实施滑动窗口（最大超前 5 分片/50MB 内存）；覆盖下载使用临时文件校验通过后原子重命名替换；传输中心解耦历史同步反应式循环；Worker 严格校验 Token、遵守跳过策略并处理背压；任务恢复通过 Spec 显式元数据重建直链。

**Tech Stack:** TypeScript, Node.js (fs, path, stream, http, https), Electron, React, Zustand, Vitest.

**Spec:** [docs/superpowers/specs/2026-10-25-phase-2-task-integrity-and-engine-hardening-design.md](file:///D:/SJTU/编程/sjtu-downloader-all-in-one/docs/superpowers/specs/2026-10-25-phase-2-task-integrity-and-engine-hardening-design.md)

## Global Constraints

- 严禁未经用户对齐确认变更界面文案，文案严格遵循《拟修改词汇与规范化对照表》。
- 界面操作出口唯一性：Worker 任务明确不支持断点暂停，禁用对应按钮并提供准确提示。
- 严禁重复造轮子：通用计算与校验逻辑统一收口至 `src/shared/utils.ts`。
- 全链路严格验证门禁：每一项改动均需依次通过 `npm run typecheck`、`npm run lint`、`npm test` 且测试 100% 通过。
- 严禁在同一自然段中出现两个未转义的 `$`，公式使用标准 KaTeX 语法。

---

### Task 1: A06 & A07 Worker 云盘凭据强制校验、写流背压、冲突跳过与原子写盘

**Files:**
- Modify: `scripts/private-worker-daemon.mjs:210-230, 530-590`
- Create: `test/unit/private-worker-daemon-integrity.test.ts`

**Interfaces:**
- Consumes: `executeTaskAsync`, `uploadToCloudPanAsync` in `scripts/private-worker-daemon.mjs`
- Produces:
  - `cloudpan` 模式下若 `!payload.cloudUserToken` 立即置 `task.status = 'error'` 并抛出结构化错误，严禁标记完成
  - `server_local` 模式下若 `payload.conflictStrategy === 'skip'` 且目标已存在，置 `task.status = 'skipped'`，0 字节写入
  - 单文件写流写入 `.part` 临时文件，支持 `drain` 背压处理，监听 `finish` 与 `error`，成功后 `fs.renameSync` 原子发布

- [ ] **Step 1: 编写失败的单元测试 `test/unit/private-worker-daemon-integrity.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'

describe('A06 & A07 Worker Integrity Suite', () => {
  function createTestDaemon(fetchImpl = async () => new Response('data'), fsMock = {}) {
    const source = fs.readFileSync(path.join(process.cwd(), 'scripts/private-worker-daemon.mjs'), 'utf8')
      .replace(/^import .*$/gm, '')
    const context = vm.createContext({
      http: { createServer: () => ({ listen: () => {}, close: () => {} }) },
      fs: {
        mkdirSync() {},
        writeFileSync() {},
        existsSync: () => false,
        renameSync() {},
        unlinkSync() {},
        ...fsMock
      },
      path,
      os: { homedir: () => '/mock/home' },
      process: { env: {}, argv: [], on() {}, uptime: () => 1, memoryUsage: () => ({ rss: 0 }) },
      fetch: fetchImpl,
      console: { log() {}, warn() {}, error() {}, debug() {} },
      Buffer, URL, AbortController, setTimeout, clearTimeout
    })
    vm.runInContext(source, context)
    return context
  }

  it('A06: 缺少 cloudUserToken 时，uploadToCloudPanAsync 抛错并将任务置为 error，绝不标记 completed', async () => {
    const ctx = createTestDaemon()
    ctx.auditTask = { storageMode: 'cloudpan' }
    ctx.auditPayload = { url: 'https://oc.sjtu.edu.cn/fixture', storageMode: 'cloudpan' }
    await expect(vm.runInContext('executeTaskAsync(auditTask, auditPayload)', ctx)).rejects.toThrow()
    expect(ctx.auditTask.status).toBe('error')
    expect(ctx.auditTask.error).toContain('缺少有效的交大云盘授权凭据')
  })

  it('A07: 当 conflictStrategy 为 skip 且目标文件已存在时，直接置为 skipped，不发生写流与网络拉取', async () => {
    let writeStreamCreated = false
    const ctx = createTestDaemon(async () => new Response('data'), {
      existsSync: () => true,
      createWriteStream: () => {
        writeStreamCreated = true
        return new EventEmitter()
      }
    })
    ctx.auditTask = { storageMode: 'server_local', resolvedPath: '/mock/home/downloads/existing.pdf' }
    ctx.auditPayload = {
      url: 'https://oc.sjtu.edu.cn/fixture',
      fileName: 'existing.pdf',
      conflictStrategy: 'skip'
    }
    await vm.runInContext('executeTaskAsync(auditTask, auditPayload)', ctx)
    expect(ctx.auditTask.status).toBe('skipped')
    expect(writeStreamCreated).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test test/unit/private-worker-daemon-integrity.test.ts`  
预期：FAIL，A06 任务变为 `completed`，A07 仍然尝试创建写流。

- [ ] **Step 3: 实现 A06 与 A07 修复**

在 `scripts/private-worker-daemon.mjs` 中：
1. `uploadToCloudPanAsync`：
   ```javascript
   if (!payload.cloudUserToken || typeof payload.cloudUserToken !== 'string' || !payload.cloudUserToken.trim()) {
     task.status = 'error'
     task.error = '云盘转存失败：缺少有效的交大云盘授权凭据，请在设置中重新登录云盘'
     throw new Error(task.error)
   }
   ```
2. `executeTaskAsync` 的 `server_local` 分支：
   - 前置判断：
     ```javascript
     if (payload.conflictStrategy === 'skip' && fs.existsSync(task.resolvedPath)) {
       task.status = 'skipped'
       task.completedAt = Date.now()
       task.speed = 0
       task.receivedBytes = 0
       return
     }
     ```
   - 单文件写流写入 `const partPath = task.resolvedPath + '.part'`：
     - 背压支持：
       ```javascript
       if (!fileStream.write(Buffer.from(value))) {
         await new Promise(resolve => fileStream.once('drain', resolve))
       }
       ```
     - 监听 `finish` 与 `error` 事件：
       ```javascript
       await new Promise((resolve, reject) => {
         fileStream.on('finish', resolve)
         fileStream.on('error', reject)
         fileStream.end()
       })
       fs.renameSync(partPath, task.resolvedPath)
       ```
     - 异常处理清理 `partPath` 并置 `task.status = 'error'`。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test test/unit/private-worker-daemon-integrity.test.ts`  
预期：PASS。

- [ ] **Step 5: 提交更改**

```bash
git add scripts/private-worker-daemon.mjs test/unit/private-worker-daemon-integrity.test.ts
git commit -m "fix(worker): enforce cloud token check, conflict skip, backpressure, and atomic write (A06, A07)"
```

---

### Task 2: A08 HLS 取消信号全链路贯穿与终态防篡改

**Files:**
- Modify: `src/main/download-engine/local.ts:150-190, 485-530`
- Modify: `src/main/canvas/hls-download.ts:200-265, 580-640`
- Create: `test/unit/hls-cancellation.test.ts`

**Interfaces:**
- Consumes: `downloadHlsVideo` in `src/main/canvas/hls-download.ts`
- Produces:
  - `downloadHlsVideo` 接收 `signal?: AbortSignal`，在 playlist、分片抓取与 ffmpeg 执行时严格监听并在中止时退出
  - `runTask` 在 HLS 完成后校验 `if (t.state === 'cancelled' || t.state === 'paused') return`，终态不可逆

- [ ] **Step 1: 编写失败的单元测试 `test/unit/hls-cancellation.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { downloadHlsVideo } from '../../src/main/canvas/hls-download'

describe('A08 HLS Cancellation Suite', () => {
  it('当传入已 aborted 的 AbortSignal 时，downloadHlsVideo 立即抛出 AbortError 并清理', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(downloadHlsVideo('https://example.com/live.m3u8', '/tmp/out.mp4', {
      signal: controller.signal
    } as any)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test test/unit/hls-cancellation.test.ts`  
预期：FAIL。

- [ ] **Step 3: 实现 HLS 信号贯穿与终态守卫**

1. 在 `src/main/canvas/hls-download.ts`：
   - `HlsDownloadOptions` 新增 `signal?: AbortSignal`。
   - `downloadHlsVideo` 首行检测 `if (opts?.signal?.aborted) throw new Error('AbortError')`。
   - 分片拉取与等待时响应 `signal`。
   - FFmpeg 合并子进程绑定 `opts.signal.addEventListener('abort', () => child.kill())`。
2. 在 `src/main/download-engine/local.ts`：
   - 维护 HLS 任务的 `activeControllers.set(t.spec.taskId, abortController)`。
   - 传递 `signal: abortController.signal` 给 `downloadHlsVideo`。
   - `await downloadHlsVideo(...)` 返回后：
     ```typescript
     if (t.state === 'cancelled' || t.state === 'paused') {
       return
     }
     t.state = 'done'
     ```

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test test/unit/hls-cancellation.test.ts`  
预期：PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/main/download-engine/local.ts src/main/canvas/hls-download.ts test/unit/hls-cancellation.test.ts
git commit -m "fix(hls): propagate abort signal to segments/ffmpeg and guard terminal states (A08)"
```

---

### Task 3: A09 传输中心 300 条完成任务死循环重算修复

**Files:**
- Modify: `src/renderer/src/pages/TransferCenter.tsx:90-125`
- Create: `test/unit/transfer-center-loop.test.ts`

**Interfaces:**
- Consumes: `useAppStore` in `src/renderer/src/store/app.ts`
- Produces: `TransferCenter` 历史同步不再依赖 `history`，通过 `syncedTaskIdsRef` 幂等记录，彻底杜绝死循环

- [ ] **Step 1: 编写失败的单元测试 `test/unit/transfer-center-loop.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

describe('A09 TransferCenter Feedback Loop Suite', () => {
  it('301 个已完成任务连续触发 render 时，storeUpdates 在首轮后必须迅速收敛为 0，杜绝死循环', () => {
    // 模拟 TransferCenter 组件渲染与 useEffect 触发
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test test/unit/transfer-center-loop.test.ts`  
预期：FAIL。

- [ ] **Step 3: 优化 `src/renderer/src/pages/TransferCenter.tsx`**

1. 引入 `const syncedTaskIdsRef = useRef<Set<string>>(new Set())`。
2. 从 `useEffect` 依赖数组中剔除 `history`，仅保留 `[logicalTasks, progress, cloudLinkedIds]`。
3. 补入逻辑：
   ```typescript
   for (const item of finishedLogical) {
     const baseId = item.taskId.replace(/_cloud$/, '')
     if (syncedTaskIdsRef.current.has(baseId)) continue
     syncedTaskIdsRef.current.add(baseId)
     // ... 仅未同步过的任务调用 addDownloadHistory
   }
   ```

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test test/unit/transfer-center-loop.test.ts`  
预期：PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/renderer/src/pages/TransferCenter.tsx test/unit/transfer-center-loop.test.ts
git commit -m "fix(transfer-center): eliminate history feedback loop with idempotent sync set (A09)"
```

---

### Task 4: A10 HLS 乱序缓冲滑动窗口与内存预算控制

**Files:**
- Modify: `src/main/canvas/hls-download.ts:230-265`
- Create: `test/unit/hls-sliding-window.test.ts`

**Interfaces:**
- Consumes: `downloadHlsM3u8ToTs` in `src/main/canvas/hls-download.ts`
- Produces: 乱序缓冲滑动窗口控制，`idx - writeIdx <= 5` 且总缓存字节数受限

- [ ] **Step 1: 编写失败的单元测试 `test/unit/hls-sliding-window.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { downloadHlsM3u8ToTs } from '../../src/main/canvas/hls-download'

describe('A10 HLS Sliding Window Suite', () => {
  it('首片阻塞时，超前下载分片数被严格限制在滑动窗口上限内 (<= 5)', async () => {
    // 模拟首片延迟，验证后续分片下载不无限超前
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test test/unit/hls-sliding-window.test.ts`  
预期：FAIL。

- [ ] **Step 3: 实现滑动窗口与字节预算门禁**

在 `src/main/canvas/hls-download.ts` 的分片抓取循环中：
```typescript
const MAX_AHEAD_SEGMENTS = 5
const MAX_BUFFERED_BYTES = 50 * 1024 * 1024

const getBufferedBytes = (): number => {
  let sum = 0
  for (const buf of pendingWrites.values()) sum += buf.length
  return sum
}

while (idx < segments.length) {
  while (idx - writeIdx >= MAX_AHEAD_SEGMENTS || getBufferedBytes() >= MAX_BUFFERED_BYTES) {
    if (aborted || writeError) return
    await new Promise(r => setTimeout(r, 40))
  }
  const i = idx++
  // 执行抓取...
}
```

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test test/unit/hls-sliding-window.test.ts`  
预期：PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/main/canvas/hls-download.ts test/unit/hls-sliding-window.test.ts
git commit -m "fix(hls): bound segment reorder buffer with sliding window and memory budget (A10)"
```

---

### Task 5: A11 任务恢复元数据保留与直链重新解析

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/download-engine/shared.ts:250-280`
- Modify: `src/main/download-engine/local.ts:470-490`
- Create: `test/unit/download-recovery-url.test.ts`

**Interfaces:**
- Consumes: `CanvasDownloadTaskSpec` in `src/shared/types.ts`
- Produces: 显式 `rawFileId`、`courseId`、`cloudRemotePath`，避免依靠 `taskId` 分割导致 `NaN`，仅对支持动态刷新的来源清空 URL

- [ ] **Step 1: 编写失败的单元测试 `test/unit/download-recovery-url.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { resolveDirectUrl } from '../../src/main/download-engine/shared'

describe('A11 Task Resume Metadata Suite', () => {
  it('带 _cloud 后缀的 Canvas 文件在恢复并清空 URL 后，能通过 rawFileId 准确重新生成端点', async () => {
    const taskCtx: any = {
      spec: {
        taskId: 'file_12345_cloud',
        source: 'canvas-files',
        rawFileId: 12345,
        url: ''
      }
    }
    await resolveDirectUrl(taskCtx, false)
    expect(taskCtx.spec.url).toContain('/files/12345/download')
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test test/unit/download-recovery-url.test.ts`  
预期：FAIL。

- [ ] **Step 3: 实现显式元数据存储与直链重构**

1. 在 `src/shared/types.ts` 中为 `DownloadTaskSpec` 增加 `rawFileId?: number`, `courseId?: number`, `cloudRemotePath?: string`。
2. 在 `src/main/download-engine/shared.ts` 中：
   ```typescript
   if (src === 'canvas-files' && !t.spec.url) {
     const fileId = t.spec.rawFileId || (() => {
       const parts = t.spec.taskId.replace(/_cloud$/, '').split('_')
       return Number(parts[parts.length - 1])
     })()
     if (fileId > 0) {
       t.spec.url = `${CANVAS_BASE_URL}/files/${fileId}/download?download_frd=1`
     }
   }
   ```
3. 在 `src/main/download-engine/local.ts` 的 `reEnqueueLocal` 中，仅对 `src === 'canvas-files'` 或其他具备动态刷新器的来源清空 URL。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test test/unit/download-recovery-url.test.ts`  
预期：PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/shared/types.ts src/main/download-engine/shared.ts src/main/download-engine/local.ts test/unit/download-recovery-url.test.ts
git commit -m "fix(download): preserve explicit file metadata and fix resume direct link resolution (A11)"
```

---

### Task 6: A12 & A13 Worker 任务控制契约与覆盖下载原子替换

**Files:**
- Modify: `src/main/download-engine/local.ts:100-140`
- Modify: `src/main/ipc/download-handlers.ts:220-250`
- Create: `test/unit/atomic-overwrite.test.ts`

**Interfaces:**
- Consumes: `runTask` in `src/main/download-engine/local.ts`
- Produces:
  - 覆盖模式在网络完成前严禁删除旧文件，先写 `.part` 验证通过后原子替换
  - Worker 任务 pause 显式禁用或标记，取消状态真实反映为 cancelled

- [ ] **Step 1: 编写失败的单元测试 `test/unit/atomic-overwrite.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('A13 Atomic Overwrite Suite', () => {
  it('覆盖下载发生错误时，原有已存在的成品文件保持完好，绝不被提前删除', async () => {
    // 模拟已有文件，模拟下载异常，断言已有文件依然存在
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test test/unit/atomic-overwrite.test.ts`  
预期：FAIL。

- [ ] **Step 3: 实现原子替换与控制契约**

1. 在 `src/main/download-engine/local.ts` 的 `runTask` 中：
   - 彻底移除下载前 `if (strategy === 'overwrite') try { unlinkSync(t.filePath) }`。
   - 所有下载统一落地 `t.partPath`。
   - 下载流完成并校验 `assertDownloadIntegrity` 后：
     ```typescript
     fs.renameSync(t.partPath, t.filePath)
     ```
   - 发生错误时不触碰 `t.filePath`，仅删除 `t.partPath`。
2. 在 `src/main/ipc/download-handlers.ts`：
   - Worker 任务取消与暂停语义隔离，避免将取消误置为暂停。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test test/unit/atomic-overwrite.test.ts`  
预期：PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/main/download-engine/local.ts src/main/ipc/download-handlers.ts test/unit/atomic-overwrite.test.ts
git commit -m "fix(download): implement atomic overwrite replacement and unify task control contracts (A12, A13)"
```

---

### Task 7: 阶段二全链路门禁验证与隔离复现回归脚本断言升级

**Files:**
- Modify: `docs/audits/2026-10-24-reproduce.mjs`

**Interfaces:**
- Consumes: 阶段二全部代码改动
- Produces:
  - 运行 `node docs/audits/2026-10-24-reproduce.mjs`，L1, L2, L4, L5, P1, P3 全部收敛
  - `npm run typecheck` 0 错误
  - `npm run lint` 0 错误
  - `npm test` 100% 全绿

- [ ] **Step 1: 运行隔离复现脚本并升级断言**

检查输出：
- `L1-cloud-success-without-token`: status === 'error'
- `L2-worker-skip-and-flush`: writesDespiteSkip === 0, finish === true
- `L4-hls-completes-after-cancel`: states 终止于 cancelled，绝无 done
- `L5-resume-loses-resource`: 重建后直链不为空
- `P1-history-feedback-loop`: storeUpdates 收敛为 0
- `P3-hls-unbounded-reorder-buffer`: segmentsBufferedBeforeFirst <= 5

- [ ] **Step 2: 顺序执行全链路三道门禁**

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`

- [ ] **Step 3: 提交全链路验证更新**

```bash
git add docs/audits/2026-10-24-reproduce.mjs
git commit -m "test(audit): update reproduction assertions for Phase 2 engine hardening"
```
