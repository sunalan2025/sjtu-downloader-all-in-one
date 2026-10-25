# 阶段三设计规范：安全隔离、凭据存储与并发队列 (A14 ~ A18)

**设计日期**：2026-10-25  
**目标版本**：2.5.3-concurrency-hardening  
**关联审查报告**：[2026-10-24-review.md](file:///D:/SJTU/编程/sjtu-downloader-all-in-one/docs/audits/2026-10-24-review.md)（问题编号：A14、A15、A16、A17、A18）

---

## 1. 架构目标与阶段范围

阶段三聚焦于系统的**纵深安全边界、凭据保密性、服务级资源弹性与高频状态性能优化**：
1. **A14（Worker 密钥安全持久化）**：废弃在渲染进程 `localStorage` 中明文持久化 `authToken` 的做法。改为在 Electron 主进程通过平台级 `safeStorage` 加密存储，渲染端仅保留掩码或脱敏状态；禁止在 URL Query 中明文传递 Token；在 `server_local` 派发时不传递无意义的 `cloudUserToken`。
2. **A15（高权限 IPC 发送方与参数防御）**：在所有高权限 IPC（凭据读写、文件路径打开、临时清理）入口增加 `validateIpcSender` 校验，限定仅主窗口顶层主 frame（且必须为可信 `file://` 或开发态 `ELECTRON_RENDERER_URL`）可调用，阻断嵌套 iframe/webview 越权；对传入的参数执行严格的运行时类型与路径边界检查。
3. **A16（Worker 服务级并发与有界队列）**：在独立 Worker 守护进程中引入服务级流量控制，设置最大并发下载数（`MAX_CONCURRENCY = 5`）、最大排队数（`MAX_QUEUE = 100`，超额返回 HTTP 429），以及终态任务 Map 的 TTL（1 小时过期自动清理，最多保留 200 条），防止多客户端或大批量提交耗尽文件描述符与内存。
4. **A17（safeFetch 超时彻底中止底层请求）**：在 `safeFetch` 中构建与超时计时器绑定的 `AbortController`，并将信号贯穿传入底层 `ses.fetch` 与重试退避定时器，确保超时触发时底层连接真正被 `abort()` 并释放，杜绝幽灵网络连接。
5. **A18（高频进度与配置持久化解耦）**：在 Zustand `persist` 存储层实现序列化脏检查守卫（若 `partialize` 偏好设置未变化则跳过 `localStorage.setItem`），从根本上消除高频进度更新引发的持续写盘问题（解决 1000 次进度更新触发 1000 次存储写入的缺陷）。

---

## 2. 拟修改词汇与规范化对照表

| 原表述 / 待定表述 | 拟规范化表述 | 修改考量与用户体验收益 |
| :--- | :--- | :--- |
| Worker Token 明文保存在浏览器本地存储 | 凭据由系统安全保险箱 (safeStorage) 加密保管，前端界面仅展示掩码占位符 `••••••••` | 消除纯文本暴露风险，保障师生私有中转机认证安全 |
| Worker 超载时连接超时或无响应 | `中转服务器过载：当前排队任务已达上限 (100)，请稍后再试` | 动词先行、表意清晰，明确告知排队状态，杜绝误报网络错误 |
| safeFetch 超时静默挂起底层连接 | `请求超时（已自动中止并释放底层网络连接）` | 准确指示网络连接已被及时释放，杜绝幽灵重发与并发耗尽 |
| IPC 调用被非法来源 frame 拦截 | `安全拦截：拒绝来自未受信任来源的高权限系统调用` | 遵循最小特权原则，明确系统防护日志表意 |

---

## 3. 详细设计与实现方案

### 3.1 A14 · Worker 密钥安全持久化与最小特权传递
- **根因**：`app.ts:244` 将 `privateWorkerConfig` 全量写入 `localStorage`，包含明文 `authToken`；派发到 `server_local` 时无条件携带 `cloudUserToken`。
- **重构设计**：
  1. **主进程 safeStorage 加密管理**：
     - 在 `src/main/credentials-vault.ts` 中新增 Worker 密钥存储支持，或通过 `safeStorage.encryptString` / `decryptString` 管理私有 Worker Token。
     - 渲染进程通过 IPC `worker:get-config` 与 `worker:save-config` 与主进程交互，`localStorage` 中的 `privateWorkerConfig` 仅持久化端点地址、运行模式，`authToken` 字段在持久化前置空或仅存掩码标识。
  2. **最小特权凭据派发**：
     - 在 `src/main/download-engine/worker-dispatch.ts` 构造 payload 时：
       ```typescript
       if (payload.storageMode === 'server_local') {
         delete payload.cloudUserToken
       }
       ```
       杜绝本地落盘模式泄露用户的交大云盘 Token。

### 3.2 A15 · 高权限 IPC 发送方验证与参数边界防守
- **根因**：凭据读写、`open-path`、清理等 IPC Handler 仅依赖编译期 TS 类型，未校验 `event.senderFrame` 及其参数真实性。
- **重构设计**：
  1. **发送方校验函数**：
     ```typescript
     export function validateIpcSender(event: Electron.IpcMainInvokeEvent): boolean {
       if (!event.senderFrame) return false
       // 仅允许顶层 frame 调用，严禁 iframe 或子 frame 越权
       if (event.senderFrame.parent !== null) return false
       const url = event.senderFrame.url || ''
       if (url.startsWith('file://')) return true
       if (process.env['ELECTRON_RENDERER_URL'] && url.startsWith(process.env['ELECTRON_RENDERER_URL'])) return true
       return false
     }
     ```
  2. **守卫高权限端点**：
     - 对 `credentials:*`、`app:open-path`、`app:cleanup-stale-downloads` 入口首先执行 `if (!validateIpcSender(e)) throw new Error('安全拦截：拒绝来自未受信任来源的高权限系统调用')`。
     - `app:open-path` 对 `fullPath` 进行严格校验：必须为字符串且不得包含非法控制字符或可执行协议。

### 3.3 A16 · Worker 服务级并发与有界队列
- **根因**：Worker 守护进程对所有任务无上限直接启动，终态 Map 持续累积。
- **重构设计**：
  1. **有界队列与并发池**：
     ```javascript
     const MAX_CONCURRENT_TASKS = 5
     const MAX_QUEUE_SIZE = 100
     const taskQueue = []
     let runningCount = 0

     function scheduleWorkerQueue() {
       while (runningCount < MAX_CONCURRENT_TASKS && taskQueue.length > 0) {
         const next = taskQueue.shift()
         runningCount++
         executeTaskAsync(next.task, next.payload).finally(() => {
           runningCount--
           scheduleWorkerQueue()
         })
       }
     }
     ```
  2. 若 `taskQueue.length >= MAX_QUEUE_SIZE`，新请求返回 HTTP 429：
     `{ ok: false, error: '中转服务器过载：当前排队任务已达上限 (100)，请稍后再试' }`。
  3. **终态任务 Map TTL**：
     - 记录任务完成时间戳 `completedAt`。
     - 定时器每 10 分钟或在任务添加时清理超过 3600 秒（1小时）的已完成/失败任务；若任务总量超过 200，优先淘汰最老的已结束任务。

### 3.4 A17 · safeFetch 超时彻底中止底层请求
- **根因**：`Promise.race` 超时后未向 `ses.fetch` 注入 `AbortSignal`，底层网络请求在超时后继续消耗资源。
- **重构设计**：
  1. 在 `safeFetch` 内部构建超时 `AbortController`：
     ```typescript
     const controller = new AbortController()
     // 若调用方传入了自定义 signal，联动中止
     if (init?.signal) {
       init.signal.addEventListener('abort', () => controller.abort(), { once: true })
     }
     ```
  2. 将 `controller.signal` 传入 `ses.fetch(url, { ...init, signal: controller.signal })`。
  3. 在超时计时器触发时调用 `controller.abort()`：
     ```typescript
     const timer = setTimeout(() => {
       controller.abort()
       reject(new Error(`请求超时 (${Math.round(timeoutMs / 1000)}s): ${sanitizeForLog(url)}`))
     }, timeoutMs)
     ```
  4. 无论是头部超时还是后续网络阻塞，均能切实向底层发送中止信号。

### 3.5 A18 · 高频进度与配置持久化解耦
- **根因**：Zustand 的 `persist` 中间件在每次 `set()` 触发时均执行 `storage.setItem`，高频进度事件导致持久化存储写盘极其频繁（1000 次进度触发 1000 次写盘）。
- **重构设计**：
  1. **存储适配器脏检查优化**：
     在 `src/renderer/src/store/app.ts` 的 `createJSONStorage` 包装层增加序列化比对：
     ```typescript
     let lastSerialized = ''
     const smartStorage = {
       getItem: (name) => localStorage.getItem(name),
       setItem: (name, value) => {
         // 若当前序列化后的字符串与上一次完全一致，说明持久化偏好未变，跳过实际写入
         if (value === lastSerialized) return
         lastSerialized = value
         localStorage.setItem(name, value)
       },
       removeItem: (name) => localStorage.removeItem(name)
     }
     ```
  2. 结合此机制，当仅更新 `state.progress` 时，`partialize` 产出的偏好对象字符串保持恒定，从而彻底避免重复写盘（持久化写入次数降为 0）。
  3. 同时在主进程 `src/main/download-engine/progress.ts` 保持约 50ms 的批量节流合并，减少 IPC 消息频率。

---

## 4. 验证与门禁标准

阶段三实施完毕后，必须顺序通过以下严格门禁：

1. **隔离复现脚本验收**：
   - 运行 `node docs/audits/2026-10-24-reproduce.mjs`，断言：
     - `P2-timeout-without-abort`: `receivedAbortSignal === true`，底层请求被真正中止；
     - `P4-persist-writes-on-runtime-updates`: `progressUpdates: 1000` 时，`persistentStorageWrites === 0`，偏好未变时完全无磁盘写开销。
2. **自动化测试套件**：
   - 补充针对 A14~A18 的单元与安全测试用例。
   - `npm test` 100% 通过（全量测试用例数突破 1100+）。
3. **全链路工程门禁**：
   - `npm run typecheck`（0 errors）。
   - `npm run lint`（0 errors, 0 warnings）。
