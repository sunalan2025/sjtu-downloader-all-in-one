# P1 架构模块化解耦与核心安全/性能加固实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 彻底消除架构审计中确认的 P1 级架构臃肿、安全脆弱与性能阻塞缺陷：解耦 1250 行单体 `index.ts` 为独立 IPC 领域模块（M-1）、强化凭据保险库回退秘钥以杜绝环境变量可预测性（M-2）、消除开发工作机代理 SSRF 风险与 Cookie 泄露（M-3）、异步化云盘切片读取杜绝主事件循环阻塞（M-5），并保持全量测试与静态检查 100% 全绿。

**Architecture:** 
1. **主进程 IPC 领域解耦 (M-1)**：沿袭 Canvas / Cnmooc / Schedule 已验证的优雅注册器模式，新建 `src/main/ipc/` 目录，拆分 `download-handlers.ts`、`cloudpan-handlers.ts`、`auth-handlers.ts` 与 `app-handlers.ts`，主入口 `index.ts` 纯粹收口应用生命周期、单实例锁、托盘与窗口组装（精简至 ~180 行）。
2. **凭据保险库秘钥加固 (M-2)**：废弃基于 `COMPUTERNAME+USERNAME` 的弱秘钥派生，改用 256 位加密随机生成的独立秘钥文件（`.fallback.key`）并施加本地文件权限限制。
3. **工作机代理 SSRF 熔断 (M-3)**：在内置开发中转节点的 `/api/proxy` 端点中强制接入 `isAllowedSjtuUrl` 域名白名单守卫，同时阻断 Cookie 跨域透传。
4. **云盘切片异步 I/O (M-5)**：将 `cloudpan.ts` 中的 `fs.readSync` 改造为 `node:fs/promises` 的异步 `fileHandle.read`，使多兆分片读取完全在 libuv 线程池中异步进行，释放主事件循环。

**Tech Stack:** Node.js Crypto, Node.js `fs/promises`, Electron IPC, TypeScript, Vitest.

**Spec / Baseline Document:** `C:\Users\MINISUNSHINE\.gemini\antigravity\brain\eb7ff9be-e088-407c-b547-f2221adaf548\architecture-review.md`

## Global Constraints

- **Strict DRY & Single Source of Truth**: 领域边界清晰，各 IPC 模块仅负责自身通道的参数解析与结果分发，底层核心计算和调度保持在对应领域模块中。
- **Zero API Breaking Changes**: 预加载脚本与渲染端契约（`window.api`）保持 100% 兼容，不改变任何 IPC 通道名与数据结构。
- **Mandatory Complete Verification Gate**: 任何改动必须依次全绿通过 `npm run typecheck`、`npm run lint` 与 `npm test`（100% 通过且无回归）。

---

## Tasks

### Task 1: M-2 凭据保险库回退秘钥强化 (Hardened Fallback Key)

**Files:**
- Modify: `src/main/credentials.ts:8-38`
- Test: `test/e2e/credentials.test.ts`

**Interfaces:**
- Consumes: `app.getPath('userData')`, `crypto.randomBytes(32)`
- Produces: `getFallbackKey(): Buffer` 读取或自动生成高熵 256 位密钥，废除环境变量派生。

- [x] **Step 1: 编写针对高熵随机回退秘钥持久化与解密的测试用例**

在 `test/e2e/credentials.test.ts` 中补充测试：
1. 验证在 `safeStorage.isEncryptionAvailable() === false` 时，秘钥文件 `.fallback.key` 能正确创建且长度为 32 字节高熵随机数；
2. 验证多次调用 `encryptPassword` / `decryptPassword` 能稳定解密且秘钥保持一致；
3. 验证秘钥不受 `process.env.COMPUTERNAME` 或 `process.env.USERNAME` 篡改影响。

- [x] **Step 2: 运行测试验证**

运行: `npx vitest run test/e2e/credentials.test.ts`  
预期: 运行并通过或明确现有测试覆盖。

- [x] **Step 3: 改造 `credentials.ts` 中的回退秘钥机制**

1. 修改 `getFallbackKey()`：
   - 秘钥文件路径为 `join(app.getPath('userData'), 'credentials', '.fallback.key')`；
   - 若文件存在且长度为 32 字节，直接读取返回；
   - 若文件不存在，使用 `randomBytes(32)` 生成高熵秘钥，并以只读/受限权限安全落盘后返回；
   - 消除硬编码 `FALLBACK_SALT` 与环境变量拼接。

- [x] **Step 4: 运行测试验证通过**

运行: `npx vitest run test/e2e/credentials.test.ts`  
预期: PASS

- [x] **Step 5: 提交改动**

```bash
git add src/main/credentials.ts test/e2e/credentials.test.ts
git commit -m "security: harden fallback encryption key with isolated high-entropy keyfile (M-2)"
```

---

### Task 2: M-3 私有中转服务代理白名单与 SSRF 防护

**Files:**
- Modify: `src/main/private-worker.ts:162-198`
- Test: `test/unit/worker-proxy-stream.test.ts`

**Interfaces:**
- Consumes: `isAllowedSjtuUrl(url: string)` from `src/main/download-engine/domain-guard.ts`
- Produces: 具有白名单拦截与 Cookie 隔离的 `/api/proxy` 端点。

- [x] **Step 1: 编写针对 `/api/proxy` SSRF 拦截与 Cookie 隔离的单元测试**

在 `test/unit/worker-proxy-stream.test.ts` 中新增测试：
1. 验证请求非法目标（如 `http://192.168.1.1/admin` 或非交大外部域名）时，端点返回 HTTP 403 / 400 阻断；
2. 验证合法交大域名（如 `https://v.sjtu.edu.cn/...`）正常放行；
3. 验证客户端发来的 `Cookie` 请求头被安全剥离，绝不向目标上游透传。

- [x] **Step 2: 运行测试验证失败**

运行: `npx vitest run test/unit/worker-proxy-stream.test.ts`  
预期: FAIL（当前代码无域名白名单校验，直接透传 Cookie）。

- [x] **Step 3: 在 `private-worker.ts` 中接入域名校验并剥离 Cookie**

1. 引入 `isAllowedSjtuUrl`：
   ```typescript
   import { isAllowedSjtuUrl } from './download-engine/domain-guard'
   ```
2. 在 `/api/proxy` 请求处理中增加校验：
   ```typescript
   if (!isAllowedSjtuUrl(targetUrl, { allowLocalhost: false })) {
     res.writeHead(403, { 'Content-Type': 'application/json' })
     return res.end(JSON.stringify({ ok: false, error: '安全拦截：仅允许代理交大官方域名' }))
   }
   ```
3. 移除 `forwardHeaders['Cookie'] = req.headers.cookie`，彻底杜绝凭据泄漏。

- [x] **Step 4: 运行测试验证通过**

运行: `npx vitest run test/unit/worker-proxy-stream.test.ts`  
预期: PASS

- [x] **Step 5: 提交改动**

```bash
git add src/main/private-worker.ts test/unit/worker-proxy-stream.test.ts
git commit -m "security: enforce official domain guard and strip cookies in dev worker proxy (M-3)"
```

---

### Task 3: M-5 云盘切片上传异步 I/O 改造

**Files:**
- Modify: `src/main/cloudpan.ts:660-692`
- Test: `test/e2e/vsjtu-cloudpan-cnmooc.test.ts`

**Interfaces:**
- Consumes: `import { open } from 'node:fs/promises'`
- Produces: `uploadLocalFileToCloud(userToken: string, localPath: string, remotePath: string[], conflictStrategy?: FileConflictStrategy, onProgress?: ...): Promise<CloudPanConfirmResult>` 全异步非阻塞实现。

- [x] **Step 1: 编写切片上传异步读操作验证测试**

在 `test/e2e/vsjtu-cloudpan-cnmooc.test.ts` 中验证大文件分片上传时进度回调、分片上传与 confirm 闭环完整，且无任何同步 fs 调用。

- [x] **Step 2: 重构 `uploadLocalFileToCloud` 为异步 `fs.promises.open`**

1. 替换 `openSync` / `fstatSync` / `readSync` / `closeSync` 为异步 API：
   ```typescript
   import { open } from 'node:fs/promises'
   // ...
   const fileHandle = await open(localPath, 'r')
   try {
     const stat = await fileHandle.stat()
     const total = stat.size
     const chunkSize = getDynamicChunkSize(total)
     let uploaded = 0
     while (uploaded < total) {
       const buf = Buffer.allocUnsafe(chunkSize)
       const { bytesRead } = await fileHandle.read(buf, 0, chunkSize, uploaded)
       if (bytesRead <= 0) break
       const chunk = bytesRead < chunkSize ? buf.subarray(0, bytesRead) : buf
       await uploader.uploadChunk(chunk)
       uploaded += bytesRead
       onProgress?.(uploaded, total)
     }
   } finally {
     await fileHandle.close()
   }
   ```

- [x] **Step 3: 运行测试验证通过**

运行: `npx vitest run test/e2e/vsjtu-cloudpan-cnmooc.test.ts`  
预期: PASS

- [x] **Step 4: 提交改动**

```bash
git add src/main/cloudpan.ts test/e2e/vsjtu-cloudpan-cnmooc.test.ts
git commit -m "perf: convert cloud chunked upload disk read to non-blocking async I/O (M-5)"
```

---

### Task 4: M-1 主进程 IPC 模块化分层解耦

**Files:**
- Create: `src/main/ipc/download-handlers.ts`
- Create: `src/main/ipc/cloudpan-handlers.ts`
- Create: `src/main/ipc/auth-handlers.ts`
- Create: `src/main/ipc/app-handlers.ts`
- Modify: `src/main/index.ts`
- Test: 全量已有测试

**Interfaces:**
- Produces:
  - `registerDownloadHandlers()`
  - `registerCloudpanHandlers()`
  - `registerAuthHandlers()`
  - `registerAppHandlers(options)`
- `src/main/index.ts` 缩减为 ~180 行应用装配器。

- [x] **Step 1: 建立 `src/main/ipc/` 目录结构并抽离 `download-handlers.ts`**

将 `download:start`、`download:pause`、`download:cancel`、`download:resume`、`download:get-snapshot`、`download:clear-finished-snapshots`、`download:delete-snapshot`、`download:pause-all`、`download:cancel-all`、`download:resume-all`、`download:set-concurrency`、`download:set-speed-limit` 封装入 `registerDownloadHandlers()`。

- [x] **Step 2: 抽离 `cloudpan-handlers.ts`**

将 `cloudpan:*` 14 个 IPC 通道（含 `direct-login` 85 行 SSO 自动化流程、目录操作、下载与上传文件调度）封装入 `registerCloudpanHandlers()`。

- [x] **Step 3: 抽离 `auth-handlers.ts`**

将 `auth:set-jwt-token`、`auth:logout`、`auth:clear`、`auth:status`、`auth:exchange-code` 与 `vsjtu:scan-audit`、`vsjtu:audit-course-detail` 封装入 `registerAuthHandlers()`。

- [x] **Step 4: 抽离 `app-handlers.ts`**

将窗口控制（`window:*`）、系统工具与目录选择（`app:*`）、自动更新调用（`app:check-update`, `app:download-update` 等）、凭据管理（`credentials:*`）、SSH 隧道（`ssh-tunnel:*`）与工作机探测（`private-worker:*`）封装入 `registerAppHandlers()`。

- [x] **Step 5: 重构 `src/main/index.ts` 纯粹组装各个 handler**

在 `app.whenReady()` 中按序调用：
```typescript
registerAppHandlers({ getMainWindow, showMainWindow, hideToTray, minimizeToTaskbar, setIsQuitting, getIsQuitting })
registerAuthHandlers()
registerDownloadHandlers()
registerCloudpanHandlers()
registerCanvasHandlers()
registerCnmoocHandlers()
registerScheduleHandlers(sjtuSession(), getMainWindow)
```
清理多余无用引用，确保 `index.ts` 结构极其清爽。

- [x] **Step 6: 运行测试验证**

运行: `npm test`  
预期: 全部测试用例无缝通过。

- [x] **Step 7: 提交改动**

```bash
git add src/main/ipc/ src/main/index.ts
git commit -m "refactor: decompose monolithic index.ts IPC handlers into domain modules (M-1)"
```

---

### Task 5: 全链路门禁检验与收尾

- [x] **Step 1: 静态类型检查**
运行: `npm run typecheck`  
预期: 0 错误

- [x] **Step 2: 代码规范检查**
运行: `npm run lint`  
预期: 0 错误 0 警告

- [x] **Step 3: 全套自动化测试**
运行: `npm test`  
预期: 57 套测试 100% 全绿

- [x] **Step 4: 最终提交与计划归档**
```bash
git commit --allow-empty -m "chore: complete P1 architecture modularization and hardening"
```
