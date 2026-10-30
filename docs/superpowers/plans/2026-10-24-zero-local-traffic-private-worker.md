# 彻底脱机中转（0 本机流量）与交大云盘远端直传实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底解决开启中转服务后客户端仍大幅消耗本机网络带宽的问题，在中转服务端（`scripts/private-worker-daemon.mjs`）原生实现直接流式上传交大云盘，客户端仅轮询状态心跳同步进度条，实现云盘模式下本机电脑 0 视频流量消耗。

**Architecture:** 
1. 远端中转服务端：扩展 `scripts/private-worker-daemon.mjs`，在 Node.js 原生环境下实现交大云盘个人空间认证（`getSpaceCred`）、多级目录递归创建（`ensureDirectory`）、腾讯云 COS 4MB 分片流式 PUT 上传及多切片 PPT 编译 PDF 上传；
2. 调度分流判定：更新 `src/main/private-worker.ts` 的 `isWorkerDelegated`，在 `mode === 'cloud'` 时一律全权委托给中转服务端执行（无论存储模式是 `server_local` 还是 `cloudpan`）；
3. 客户端长轮询调度引擎：重构 `src/main/download-engine/worker-dispatch.ts`，随任务载荷传递标准云盘目标路径 `cloudRemotePath(spec)` 及 `cloudUserToken`，启动轻量心跳轮询器（每秒请求一次 `/api/tasks/:taskId`），将服务端的真实传输字节与速率映射为客户端 `download:progress` 事件，直到任务完成。

**Tech Stack:** Node.js (http, https, fetch), Electron, TypeScript, Vitest.

---

## 拟修改词汇与规范化对照表 (UI Copywriting Alignment)

| 原表述 / 待定表述 | 拟规范化表述 | 修改考量与用户体验收益 |
| :--- | :--- | :--- |
| `中转代传至云盘中…` | `中转服务器转存云盘中…` | 明确说明执行主体是远端服务器，消除用户以为本机仍在上传的疑虑 |
| `中转工作机下载中…` | `中转服务器下载中…` | 与设置页面统一称谓“中转服务器”，通俗易懂，杜绝生硬黑话 |
| `中转节点处理失败` | `中转服务器处理失败` | 统一称谓，提升错误信息亲和力与可读性 |
| `已转存至交大云盘` | `已转存至交大云盘`（保持不变） | 用户熟悉的经典成功状态提示 |
| `已保存至中转服务器本地磁盘` | `已保存至中转服务器磁盘` | 精简文案，使通知气泡与下载历史列表更加紧凑整洁 |

---

## 全局约束与规范 (Global Constraints)
1. **0 本机大文件流量消耗**：在云端中转模式下，视频媒体流只能在远端中转机与腾讯云 COS / Canvas CDN 之间流转，禁止在客户端拉取流后再推流；
2. **零第三方依赖**：`scripts/private-worker-daemon.mjs` 运行于轻量服务器，严禁引入任何 npm 外部包，仅使用 Node.js 原生 API；
3. **严格遵守 GEMINI.md 门禁**：改动完成后必须顺序全绿通过 `npm run typecheck`、`npm run lint`、`npm test`；
4. **数学公式与 KaTeX 规范**：正文中凡非数学公式的美元符号一律转义为 `\$`。

---

## 任务拆解 (Task Decomposition)

### Task 1: 在中转守护进程 `scripts/private-worker-daemon.mjs` 中实现交大云盘原生流式直传

**Files:**
- Modify: `scripts/private-worker-daemon.mjs:125-225`
- Test: `test/unit/private-worker-client.test.ts`

**Interfaces:**
- Consumes: `payload.cloudUserToken`, `payload.destPath`, `payload.conflictStrategy`, `payload.url`, `payload.slices`
- Produces: 
  - `uploadToCloudPanAsync(task, payload)`
  - 更新 `task.status`: `'queued' | 'downloading' | 'uploading' | 'completed' | 'failed'`
  - 动态计算并更新 `task.receivedBytes`, `task.totalBytes`, `task.speed`

- [ ] **Step 1: 编写交大云盘基础协议函数（Space 凭证获取、目录确保、文件查重/删除）**
- [ ] **Step 2: 编写多切片 PPT 编译为 PDF 并直传云盘的核心逻辑**
- [ ] **Step 3: 编写单文件流式拉取（4MB 分片）并直传腾讯云 COS 的核心逻辑**
- [ ] **Step 4: 在 `test/unit/private-worker-client.test.ts` 中补充守护进程云盘直传协议模拟测试**
- [ ] **Step 5: 运行单测验证并提交 commit**

---

### Task 2: 在 `src/main/private-worker.ts` 中扩展任务查询与模拟引擎

**Files:**
- Modify: `src/main/private-worker.ts:30-70`, `src/main/private-worker.ts:130-220`, `src/main/private-worker.ts:300-360`
- Test: `test/unit/private-worker.test.ts`

**Interfaces:**
- Produces:
  - `export async function queryPrivateWorkerTask(workerUrl: string, taskId: string, token?: string, timeoutMs?: number)`
  - `isWorkerDelegated(mode, privateWorker)`: `mode === 'cloud'` 时统一返回 `true`
  - `startEmbeddedDevWorker`: 响应 `/api/tasks/:taskId` 查询并模拟真实完成状态

- [ ] **Step 1: 编写 `queryPrivateWorkerTask` 测试用例**
- [ ] **Step 2: 实现 `queryPrivateWorkerTask` 客户端查询函数**
- [ ] **Step 3: 更新 `isWorkerDelegated` 判定规则，支持云端模式全权委托**
- [ ] **Step 4: 为开发测试内置服务 `startEmbeddedDevWorker` 添加 `/api/tasks/:taskId` 查询路由支持**
- [ ] **Step 5: 运行单元测试验证并提交 commit**

---

### Task 3: 改造客户端调度引擎 `src/main/download-engine/worker-dispatch.ts` 接入心跳轮询与精准进度同步

**Files:**
- Modify: `src/main/download-engine/worker-dispatch.ts:50-167`
- Modify: `src/main/ipc/download-handlers.ts:90-110`
- Test: `test/unit/worker-dispatch.test.ts`

**Interfaces:**
- Consumes: `cloudRemotePath(spec)` from `../download-engine/cloud`, `queryPrivateWorkerTask` from `../private-worker`
- Produces: 
  - `dispatchWorkerBatch`: 派发任务带上 `cloudUserToken` 和 `destPath`，启动 1s 轮询心跳推流
  - 任务取消与暂停时的远端协同

- [ ] **Step 1: 编写 `worker-dispatch.test.ts` 轮询与进度事件推送的单元测试**
- [ ] **Step 2: 改造 `dispatchWorkerBatch`，派发完整目标云盘路径及凭据**
- [ ] **Step 3: 实现轻量异步轮询器 `pollWorkerTaskProgress`，精确推送下载/上传速率与字节**
- [ ] **Step 4: 在 `src/main/ipc/download-handlers.ts` 中校准 `both` 模式下的云端部分中转派发**
- [ ] **Step 5: 运行所有调度测试并提交 commit**

---

### Task 4: 全链路回归与三级门禁验证 (Verification Gate)

- [ ] **Step 1: 运行 `npm run typecheck` 确保 TypeScript 静态类型 0 错误**
- [ ] **Step 2: 运行 `npm run lint` 确保 ESLint 规范 0 错误 0 警告**
- [ ] **Step 3: 运行 `npm test` 确保 56 个测试套件 100% 全部通过**
- [ ] **Step 4: 输出最终验证报告向用户汇报**
