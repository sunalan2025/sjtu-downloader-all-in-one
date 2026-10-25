# 阶段二设计规范：任务状态可信与传输引擎加固 (A06 ~ A13)

**设计日期**：2026-10-25  
**目标版本**：2.5.2-engine-hardening  
**关联审查报告**：[2026-10-24-review.md](file:///D:/SJTU/编程/sjtu-downloader-all-in-one/docs/audits/2026-10-24-review.md)（问题编号：A06、A07、A08、A09、A10、A11、A12、A13）

---

## 1. 架构目标与阶段范围

阶段二聚焦于保证核心下载与转存引擎的**状态真实性、资源边界有界性与数据操作幂等性**：
1. **A06（Worker 云盘凭据真实校验）**：杜绝无凭据时的假成功。缺少有效 `cloudUserToken` 时立即返回结构化错误并终止任务，严禁标记完成。
2. **A07（Worker 写流背压与原子落盘）**：遵守 `conflictStrategy: 'skip'`，写流处理背压（`drain` 事件等待），写至 `.part` 临时文件，等待 `finish` 与校验后原子发布。
3. **A08（HLS 取消贯穿与终态防篡改）**：将 `AbortSignal` 贯穿 playlist 解析、分片拉取、重试等待与 FFmpeg 合并子进程；下载完成后强校验任务终态，已取消/暂停的任务绝对不可被覆盖为 `done`。
4. **A09（传输中心死循环重构）**：切断 `TransferCenter` 页面 `useEffect` 与 `downloadHistory` 之间的无限同步反馈回路，历史记录迁移采用幂等过滤。
5. **A10（HLS 乱序缓冲滑动窗口）**：设置最大超前下载分片窗口（`MAX_AHEAD_SEGMENTS = 5`）与内存预算（`MAX_BUFFER_BYTES = 50MB`），解决首片慢导致的全量视频内存积压问题。
6. **A11（任务恢复与直链重新解析）**：在任务 Spec 中固化 `fileId`、`courseId`、`cloudRemotePath` 等显式元数据；去除依靠任务 ID 后缀分割解析数字 ID 的脆弱实现；只有支持重新获取直链的来源才在恢复时清空临时 URL。
7. **A12（Worker 与云盘任务生命周期契约）**：统一 Worker 与手动云盘上传的任务控制，禁用不支持断点暂停的任务的“暂停”操作，明确取消与暂停语义。
8. **A13（覆盖下载原子安全落盘）**：覆盖模式（`overwrite`）在网络请求与校验完成前完好保留用户旧成品；新文件先写临时 `.part`，验证成功后再原子替换（`atomic rename`）。

---

## 2. 拟修改词汇与规范化对照表

| 原表述 / 待定表述 | 拟规范化表述 | 修改考量与用户体验收益 |
| :--- | :--- | :--- |
| 无云盘凭据静默标记“完成” | `云盘转存失败：缺少有效的交大云盘授权凭据，请在设置中重新登录云盘` | 动词先行，杜绝将失败/未上传任务谎报为“完成”，明确指示用户需要在设置中登录云盘 |
| HLS 取消后变为 `下载完成` | `任务已取消（临时切片已清理）` | 杜绝用户误以为半截切片是完整视频，消除状态倒退，确保终态可信 |
| Worker 任务显示暂停按钮，点击后远端取消但前端显示“已暂停”且无法恢复 | `中转任务不支持断点暂停，仅支持取消`（禁用该项暂停按钮，展示明确提示） | 交互出口唯一且真实，杜绝用户陷入“暂停但实际丢失且无法恢复”的误导 |
| 覆盖下载开始前直接删除旧文件 | `正在下载新版本（旧文件安全保留中）` $\to$ 验证通过后提示 `文件已更新覆盖` | 杜绝网络异常或鉴权失败导致用户旧文件被提前抹除，保障数据安全 |

---

## 3. 详细设计与实现方案

### 3.1 A06 · Worker 云盘 Token 校验与假完成消除
- **根因**：`scripts/private-worker-daemon.mjs:211` 判断 `if (!payload.cloudUserToken)` 时直接标记 `task.status = 'completed'`。
- **重构设计**：
  1. 在 `uploadToCloudPanAsync` 入口：
     ```javascript
     if (!payload.cloudUserToken || typeof payload.cloudUserToken !== 'string' || !payload.cloudUserToken.trim()) {
       task.status = 'error'
       task.error = '云盘转存失败：缺少有效的交大云盘授权凭据，请在设置中重新登录云盘'
       throw new Error(task.error)
     }
     ```
  2. 主进程派发逻辑 `src/main/download-engine/worker-dispatch.ts`：在提交 `cloudpan` 模式任务前，先验证凭据缓存；若无有效凭据，直接向前端推送 `error` 进度，不再派发至 Worker。

### 3.2 A07 · Worker 写入背压、跳过同名与原子写盘
- **根因**：直接 `createWriteStream(task.resolvedPath)`，未处理同名跳过；忽略 `write()` 返回的背压布尔值；`end()` 后未监听 `finish` 和 `error`。
- **重构设计**：
  1. **冲突策略前置处理**：
     ```javascript
     if (task.storageMode === 'server_local' && task.resolvedPath) {
       if (payload.conflictStrategy === 'skip' && fs.existsSync(task.resolvedPath)) {
         task.status = 'skipped'
         task.completedAt = Date.now()
         task.speed = 0
         task.receivedBytes = 0
         console.log(`[worker] 文件已存在且策略为 skip，跳过下载: ${task.resolvedPath}`)
         return
       }
     }
     ```
  2. **背压与写流事件等待**：
     - 下载时写入临时路径 `const tmpPath = task.resolvedPath + '.part'`。
     - 循环拉取 body 数据并处理背压：
       ```javascript
       if (!fileStream.write(chunk)) {
         await new Promise(resolve => fileStream.once('drain', resolve))
       }
       ```
     - 监听流的 `finish` 与 `error` 事件：
       ```javascript
       await new Promise((resolve, reject) => {
         fileStream.on('finish', resolve)
         fileStream.on('error', reject)
         fileStream.end()
       })
       ```
     - 校验实际写入大小，验证通过后原子重命名：`fs.renameSync(tmpPath, task.resolvedPath)`。
     - 发生异常时清理 `.part` 临时文件，并置 `task.status = 'error'`。

### 3.3 A08 · HLS 取消信号全链路贯穿与终态防篡改
- **根因**：`local.ts` 未向 `downloadHlsVideo` 传入 `AbortSignal`；`onProgress` 虽跳过取消态 UI 更新，但底层持续下载并在 `await` 返回后无条件置 `t.state = 'done'`。
- **重构设计**：
  1. 在 `local.ts` 中维护每个 HLS 任务的 `AbortController`，并将其信号贯穿传入 `downloadHlsVideo`：
     ```typescript
     const controller = new AbortController()
     activeControllers.set(t.spec.taskId, controller)
     ```
  2. `downloadHlsVideo` 接收 `signal: controller.signal`：
     - 在 m3u8 playlist 下载、分片下载（`fetchSegment`）中传入 `signal`。
     - 在每次循环或等待重试时检查 `if (signal.aborted) throw new Error('AbortError')`。
     - 若启动了 FFmpeg 合并转封装子进程，监听 `signal.onabort = () => child.kill('SIGTERM')`，并在退出时清理临时分片。
  3. **终态守卫（Terminal Guard）**：
     在 `local.ts` 的 `await downloadHlsVideo(...)` 之后：
     ```typescript
     if (t.state === 'cancelled' || t.state === 'paused') {
       console.log(`[local:hls] 任务已处于 ${t.state} 态，忽略已完成事件`)
       return
     }
     t.state = 'done'
     ```
     杜绝终态被后续异步回调非法篡改。

### 3.4 A09 · 传输中心 300 条历史死循环重构
- **根因**：`TransferCenter.tsx` 的 `useEffect` 监听 `[logicalTasks, history, ...]`，历史条目上限为 300；当完成任务达到 301 条时，补入第 301 条导致第 1 条被挤掉，进而触发下一轮补入，形成死循环。
- **重构设计**：
  1. **切断反应式循环依赖**：
     - 在组件级维护已补入历史的任务 ID 集合：`const syncedTaskIdsRef = useRef(new Set<string>())`。
     - 从 `useEffect` 的依赖项中移除 `history`。
     - 仅当某任务从未被记录过且处于终态时，单向一次性记录到 `syncedTaskIdsRef`，并调用 `addDownloadHistory`。
  2. **在 Store 层进行幂等写入**：
     - `addDownloadHistory` 内部以 `taskId` 为主键去重，避免重复追加。

### 3.5 A10 · HLS 乱序缓冲滑动窗口与内存预算
- **根因**：分片下载工作者无上限拉取后续分片，若第 0 片慢，其余 39 片全量缓存在 `pendingWrites` 内存 Map 中。
- **重构设计**：
  1. **双重流量控制限制**：
     - 定义最大超前窗口：`const MAX_AHEAD = 5`。
     - 定义最大内存预算：`const MAX_BUFFER_BYTES = 50 * 1024 * 1024`（50MB）。
  2. **工作者领取分片门禁**：
     在 worker 循环中：
     ```typescript
     while (idx < segments.length) {
       // 当未写入分片差值过大或当前内存积压超过预算时，挂起等待
       while (idx - writeIdx >= MAX_AHEAD || getBufferedBytes() >= MAX_BUFFER_BYTES) {
         if (aborted || writeError) return
         await new Promise(resolve => setTimeout(resolve, 50))
       }
       const i = idx++
       // 拉取分片...
     }
     ```
  3. 一旦写入磁盘释放缓存，等待的工作者立即恢复拉取，确保内存占用严格有界。

### 3.6 A11 · 任务恢复元数据保留与直链重新解析
- **根因**：`reEnqueueLocal` 暴力将 `p.spec.url = ''`；解析端通过 `taskId.split('_')` 取最后一段为数字 ID，遇到 `_cloud` 等后缀时解析为 `NaN`；云盘任务清空后无法重建下载 URL。
- **重构设计**：
  1. 在 `CanvasDownloadTaskSpec` 中显式扩展元数据字段：
     ```typescript
     export interface CanvasDownloadTaskSpec {
       // ...
       rawFileId?: number
       courseId?: number
       cloudRemotePath?: string
     }
     ```
  2. `resolveDirectUrl` 优先使用显式 `rawFileId` 或 `courseId`，不再依赖脆弱的字符串 split。
  3. 在 `reEnqueueLocal` 中，仅对支持动态刷新的来源（如 `canvas-files`、`cloudpan`）清空临时预签名 URL；对于静态一次性直链，保留其 URL。

### 3.7 A12 · 统一任务注册与 Worker/云盘任务控制契约
- **根因**：Worker 任务由 `dispatchWorkerBatch` 单独派发，未注册到全局 `activeTasks`；暂停被映射为远端取消但在前端显示为暂停，恢复操作不存在。
- **重构设计**：
  1. Worker 任务派发时在主进程任务中心注册任务句柄，并将其能力标记为 `canPause: false`。
  2. 前端界面：对于 Worker 任务或不支持断点暂停的任务，禁用其“暂停”按钮，悬浮提示 `中转任务不支持断点暂停，仅支持取消`。
  3. 取消 Worker 任务时，状态真实变更为 `cancelled`，不再误报为 `paused`。

### 3.8 A13 · 覆盖下载原子安全替换
- **根因**：`runTask` 中 `strategy === 'overwrite'` 在发起下载前就调用 `unlinkSync(t.filePath)`，一旦后续网络中断或鉴权失败，用户旧成品文件丢失。
- **重构设计**：
  1. 下载前**严禁删除** `t.filePath`。
  2. 统一先下载至临时文件 `t.partPath`（或随机临时路径）。
  3. 当且仅当下载流完整结束、大小与完整性校验通过后，使用原子重命名替换：
     ```typescript
     fs.renameSync(t.partPath, t.filePath)
     ```
  4. 若下载失败、取消或校验不合格，仅删除临时文件 `t.partPath`，已有文件 `t.filePath` 毫发无损。

---

## 4. 验证与门禁标准

阶段二实施完毕后，必须顺序通过以下严格门禁：

1. **隔离复现脚本验收**：
   - 运行 `node docs/audits/2026-10-24-reproduce.mjs`，断言：
     - `L1-cloud-success-without-token`: 缺少 Token 状态为 `error`，不可为 `completed`；
     - `L2-worker-skip-and-flush`: `writesDespiteSkip` 为 0，`finish` 为 true；
     - `L4-hls-completes-after-cancel`: 状态链终止于 `cancelled`，绝不出现 `done`；
     - `L5-resume-loses-resource`: 恢复后 URL 或元数据正确重建，不再为空；
     - `P1-history-feedback-loop`: 连续轮次 storeUpdates 快速收敛为 0，杜绝死循环；
     - `P3-hls-unbounded-reorder-buffer`: `segmentsBufferedBeforeFirst <= 5`（滑动窗口有界生效）。
2. **自动化测试套件**：
   - 补充针对 A06~A13 的单元与集成测试用例。
   - `npm test` 100% 通过（测试数增至 1080+）。
3. **全链路工程门禁**：
   - `npm run typecheck`（0 errors）。
   - `npm run lint`（0 errors, 0 warnings）。
