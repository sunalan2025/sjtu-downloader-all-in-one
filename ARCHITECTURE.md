# SJTU 课程下载器 — 架构文档

本文档详细描述项目的技术架构、模块职责、数据流、安全模型和性能设计。

---

## 1. 整体架构

项目采用 Electron 三层架构，主进程、预加载脚本、渲染进程严格隔离。

```
┌─────────────────────────────────────────────────────────────────────┐
│  渲染进程 (Chromium)                                                │
│  src/renderer/src/                                                  │
│    App.tsx → pages/ → components/ → store/app.ts                    │
│    hooks/useSharedBrowserHooks.ts                                   │
│  技术栈: React 19 + Zustand + Tailwind CSS                          │
├─────────────────────────── contextBridge ────────────────────────────┤
│  预加载脚本                                                          │
│  src/preload/index.ts                                               │
│    window.api = { auth, vsjtu, download, cloudpan, canvas, ppt }    │
│    contextIsolation: true, nodeIntegration: false                    │
├─────────────────────────── IPC invoke/on ────────────────────────────┤
│  主进程 (Node.js)                                                   │
│  src/main/index.ts          ← 下载引擎 + 云盘上传 + 窗口管理 + IPC   │
│  src/main/cloudpan.ts       ← 交大云盘 API                          │
│  src/main/canvas/api.ts     ← Canvas REST API                       │
│  src/main/canvas/orchestrator.ts ← Canvas IPC handler + 编排        │
│  src/main/canvas/video-tokens.ts ← LTI token + vod API + 缓存      │
│  src/main/canvas/hls-download.ts ← HLS 下载 + ffmpeg remux（内置 ffmpeg-static 二进制）│
│  src/main/canvas/ppt-download.ts ← PPT 课件图片下载 + PDF 合并      │
├─────────────────────────── 共享类型 ─────────────────────────────────┤
│  src/shared/types.ts                                                │
└─────────────────────────────────────────────────────────────────────┘
```

### 安全边界

- `contextIsolation: true` — 渲染进程无法直接访问 Node.js API
- `nodeIntegration: false` — 渲染进程无法 require 任何模块
- `sandbox: false` — 仅因 `webviewTag: true` 需要，已在代码中注释说明
- CSP 在 `index.html` 中配置：`default-src 'self'`，`connect-src` 限制到 SJTU 域名
- webview 导航白名单限制到 `sjtu.edu.cn` 相关域名
- 所有新窗口请求通过 `setWindowOpenHandler` 重定向到 `shell.openExternal`

---

## 2. 模块详解

### 2.1 主进程 — `src/main/index.ts`

约 2540 行，是项目的核心模块，承担以下职责：

| 区域 | 行范围（约） | 职责 |
|------|-------------|------|
| 窗口管理 | 62-103 | BrowserWindow 创建、CSP、webviewTag 配置 |
| 认证 | 113-175 | `isLoggedIn()`（含 5 分钟缓存）、`vsjtuFetch()`、JWT token 管理 |
| 下载引擎 | 177-700 | 任务注册表、惰性任务物化、并发调度器、HTTP 流式下载（cookie 注入 + 限流重试）、断点续传 |
| 云盘上传引擎 | 700-1640 | CDN→COS 边下载边分片上传（`settled` 守卫）、凭证 renew、断点续传会话、overwrite 删远端 |
| AIMD 并发控制 | 263-420 | 加性增乘性减、吞吐增益反馈、瓶颈冷却、自适应评估周期 |
| Canvas 直链解析 | 1070-1230 | `resolveDirectUrl()`、Canvas cookie 注入、429/403 限流重试 |
| IPC 注册 | 2140-2540 | `download:*`、`auth:*`、`vsjtu:*`、`cloudpan:*`、`app:*` handler（含 `app:notify`） |
| 安全退出 | 2090-2110 | `cleanupOnQuit()`、`uncaughtException` handler |

**关键设计模式：**

- **惰性任务物化** — `download:start` 将 spec 存入 `pendingLocal` / `pendingCloud` 队列（`PendingSpec` 比 `TaskRuntime` 轻量），调度器 `scheduleNext()` / `cloudScheduleNext()` 临下载时才创建 `TaskRuntime`
- **O(1) 去重索引** — `pendingLocalIds` / `pausedLocalIds` 等 `Set<string>` 提供 O(1) 重复检测
- **IPC 进度批处理** — `emitProgress()` 使用 `setImmediate` 合并同一事件循环轮次内的多条进度，Map 按 taskId 去重仅保留最新值
- **AIMD 自适应并发** — 加性增（每轮 +1）+ 乘性减（网络错误砍半）+ 吞吐增益反馈（+1 后吞吐下降则冷却）+ 自适应评估周期（1-4s）
- **Canvas cookie 注入** — `canvasCookiesByTask` 存储 Canvas 会话 cookie，`downloadStream` / `cloudDownloadAndUpload` 的 `fetchOnce` 仅在 `oc.sjtu.edu.cn` 这一跳注入 Cookie + Referer，跟随 302 到 S3 后不带 Cookie
- **Canvas 端点限流重试** — 本地与云盘两条 `fetchOnce` 对 `oc.sjtu.edu.cn` 的 429/403 做指数退避重试（最多 4 次），S3 的 403（签名/权限，永久错误）不重试
- **COS 上传 abort** — `ChunkedUploader.abort()` 通过 `onReq` 回调暴露 `ClientRequest`，pause/cancel 时 `destroyCloudHandles` 调用 `t.uploader?.abort()` 立即中止在途分片 PUT，否则暂停后后台仍会把整个文件传完

### 2.2 云盘 API — `src/main/cloudpan.ts`

交大云盘 (pan.sjtu.edu.cn) API 封装：

- `validateUserToken()` — 验证 UserToken 有效性
- `getSpaceInfo()` — 查询个人空间容量
- `ensureFolderPath()` — 逐级创建文件夹（路径缓存 `createdFolderPaths` 避免重复 PUT）
- `startChunkedUpload()` / `resumeChunkedUpload()` — COS 分片上传（4MB 分片）
- `deleteCloudFile()` — `DELETE /api/v1/file/{lib}/{space}/{path}?permanent=0`，移入回收站（404 幂等成功），供"替换"策略上传前清同名文件
- `FileExistsError` — 文件已存在时抛出，用于智能跳过
- `ChunkedUploader.abort()` — 通过 `cosPutOnce` 的 `onReq` 回调暴露 `ClientRequest`，pause/cancel 时立即中止在途分片 PUT
- 凭证 renew 重试：401 自动 renew，连续两次 400 抛出明确错误

### 2.3 Canvas 模块 — `src/main/canvas/`

| 文件 | 职责 |
|------|------|
| `api.ts` | REST API 封装：`listCourses()`、`fetchFolderMap()`、`fetchCourseFiles()`、`fetchCourseModules()`、`fetchSyllabusBody()`、`fetchPageBody()`、`fetchFileMeta()` 等。支持自动翻页、并发模块页面批量获取（concurrency limit）。429 限流退避重试（读 `Retry-After`，缺省指数退避，最多 4 次）。 |
| `orchestrator.ts` | IPC handler 注册和流程编排：课程扫描、文件下载 spec 构建、课堂视频扫描（LTI token + vod API）、单元视频扫描（浏览器「单元」tab 三类来源）、讲次下载。事件驱动并发槽位等待（`waitForConcurrencySlot` + `notifyConcurrencySlotAvailable`）。视频 spec 生成接收 `conflictStrategy`（overwrite 不预跳过同名文件）和 `term`（学期名，作为上级文件夹层）。 |
| `video-tokens.ts` | LTI token 提取（`extractLtiToken`）、vod 视频列表获取（`fetchVodVideoList`）、视频通道缓存（TTL 5 分钟 + 上界 500 条目淘汰）。 |
| `hls-download.ts` | m3u8 捕获（`webRequest.onCompleted` 监听 `.m3u8` 请求）、HLS segment 下载（HTTPS keep-alive）、ffmpeg remux 为 MP4。ffmpeg 二进制由 [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) 提供，作为生产依赖打包进 `app.asar/node_modules` 并经 `build.asarUnpack` 解包到 `app.asar.unpacked/` 使其可执行（asar 内无法 exec native 二进制）；运行时 `require('ffmpeg-static')` 解析路径，缺失时回退系统 PATH 的 `ffmpeg`。 |
| `ppt-download.ts` | PPT 课件图片下载 + PDF 合并：调 `query-ppt-slice-es` API 获取幻灯片图片列表、`ses.fetch` 下载 S3 预签名图片、`pdf-lib` 合并为 16:9 PDF。落盘路径与课堂视频同目录（`videos/课堂视频/`）。 |

**事件驱动并发槽位等待：**

```typescript
// orchestrator.ts
const concurrencyResolvers = new Set<() => void>()

export function notifyConcurrencySlotAvailable(): void {
  if (concurrencyResolvers.size === 0) return
  const waiters = Array.from(concurrencyResolvers)
  concurrencyResolvers.clear()
  for (const r of waiters) r()  // 唤醒所有等待者，各自重新检查抢占槽位
}

async function waitForConcurrencySlot(): Promise<void> {
  // Promise.race: 事件通知 vs 10s 超时兜底（重新检查 provider）
  // 外层 120s 截止防止永久挂起
}
```

由 `index.ts` 的 `scheduleNext()` / `cloudScheduleNext()` 在任务结束时调用 `notifyConcurrencySlotAvailable()`。

### 2.4 预加载 — `src/preload/index.ts`

通过 `contextBridge.exposeInMainWorld('api', api)` 将以下 API 暴露给渲染端：

| 命名空间 | 方法 |
|----------|------|
| `api.auth` | `status()`, `logout()`, `setJwtToken()` |
| `api.vsjtu` | `scanAudit()`, `auditCourseDetail()` |
| `api.download` | `start(destRoot, specs, {mode, conflictStrategy, localDestRoot})`, `pause()`, `cancel()`, `resume()`, `pauseAll()`, `cancelAll()`, `resumeAll()`, `setConcurrency()`, `onProgress()`, `onConcurrencyChanged()` |
| `api.cloudpan` | `getCachedToken()`, `validateToken()`, `spaceInfo()`, `directLogin()`, `logout()` |
| `api.canvas` | `listCourses()`, `scanCourse()`, `buildDownloadSpecs()`, `classVideoScan()`, `classVideoDownload(...,conflictStrategy?)`, `moduleVideoScan()`, `moduleVideoDownload(...,conflictStrategy?)`, `downloadModuleVideoNow()`, `downloadLectures(...,conflictStrategy?)`, `onScanProgress()`, `onHlsProgress()` |
| `api.ppt` | `download({ivsVideoId, courseName, lectureName, destRoot, term?, videoSession?})`, `downloadBatch({lectures, courseName, destRoot, term?})`, `onProgress()` |
| `api` | `setTheme()`, `selectFolder()`, `notify(title, body)` |

**安全设计：** `validateToken()` 和 `spaceInfo()` 不接收 token 参数，main 进程使用内部缓存的 USER_TOKEN。

### 2.5 共享类型 — `src/shared/types.ts`

定义跨层共享的 TypeScript 类型：

- **v.sjtu API** — `ApiEnvelope<T>`、`PageResult<T>`、`AuditCourseItem`、`AuditCourseDetail`、`AuditCourseVideo`
- **业务模型** — `Course`、`VideoTask`、`AuthStatus`
- **下载** — `DownloadMode`、`FileConflictStrategy`（skip/overwrite）、`DownloadTaskSpec`、`DownloadState`、`DownloadProgress`
- **云盘** — `CloudPanSpaceCred`、`CloudPanUploadPart`、`CloudPanStartUploadResult`、`CloudPanConfirmResult`、`CloudPanSpaceInfo`
- **Canvas** — `CanvasCourse`、`CanvasFileItem`、`CanvasModule`、`CanvasVideoSession`、`CanvasClassVideoInfo`、`CanvasDownloadTaskSpec`、`CanvasTaskSource`、`CanvasTeacherSelection`、`CanvasLectureGroup`
- **PPT** — `PptSlice`（API 响应）、`PptDownloadOpts`（下载请求参数，含 `videoSession` 用于构建与视频一致的文件名）
- **常量** — `SJTU_PARTITION`、`V_SJTU_ORIGIN`、`V_SJTU_API_BASE`、`CANVAS_BASE_URL`、`CANVAS_API_BASE`

### 2.6 渲染端

#### 状态管理 — `store/app.ts`

Zustand store，使用 `persist` 中间件持久化用户偏好：

- **持久化字段** — `theme`、`activeTab`、`downloadMode`、`fileConflictStrategy`、`localDestRoot`、`cloudUserToken`、`concurrency`、`autoConcurrency`
- **运行时状态** — `stage`、`auth`、`scanState`、`courses`、`tasksByCourse`、`selected`、`canvasCourses`、`canvasCourseData`、下载进度 `progress`
- **性能优化** — `applyProgress` 使用 `queueMicrotask` 批处理；`useDownloadStats` 编码统计为单个 number；`useEffectiveProgress` 聚合 both 模式进度
- **云盘连接状态** — `cloudConnStatus` / `cloudConnMessage` 存储在 store 中，跨 tab 共享

#### 共享 Hooks — `hooks/useSharedBrowserHooks.ts`

Browser 与 CanvasBrowser 共享的 hooks：

| Hook | 职责 |
|------|------|
| `prefetchCloudConnection`（services/prefetch.ts） | 登录后自动隐式 SSO 连云盘（复用 jAccount 会话）；`useCloudConnection.onConnectCloud` 与 App.tsx 预加载共用 |
| `useCloudConnection` | 云盘连接/断开操作，状态从 zustand store 读取（跨 tab 共享） |
| `useDownloadProgressSubscription` | 订阅主进程进度事件，写入 store（App 级单次订阅） |
| `useDownloadCompletion` | 选中任务全部到达终态时自动将 `downloading` 置为 false；弹出系统通知汇报成功/失败数量（`notifiedRef` 保证每批次只通知一次） |

#### 页面组件

| 组件 | 职责 |
|------|------|
| `App.tsx` | 根组件：按 `stage` 切换页面（welcome → login → browser），顶部 Tab 导航（audited / canvas），App 级进度订阅 |
| `Welcome.tsx` | 欢迎页：功能介绍 + 登录入口 |
| `Login.tsx` | 登录页：内嵌 jAccount 扫码 webview，域名白名单导航限制，JWT token 轮询提取 |
| `Browser.tsx` | v.sjtu 旁听课程页：自动扫描、双视角卡片、全选/单选、下载控制、实时进度。使用 `memo` + `useShallow` + `tasksKey` 稳定化优化 |
| `CanvasBrowser.tsx` | Canvas 课程页：学期筛选、分类选择（课件/视频-教师/视频-PPT/单元视频）、串行课程处理（扫描→下载→等待→清理→下一门）。课堂视频每讲含「📄PPT」下载按钮 + 「下载全部PPT」批量按钮，PPT PDF 与视频同目录 |

#### 共享组件

| 组件 | 职责 |
|------|------|
| `TitleBar.tsx` | 自定义标题栏：并发滑块、自动并发 AIMD 按钮、主题切换、登出、帮助弹窗 |
| `DownloadUI.tsx` | 下载 UI 原子组件：进度条（EMA 速度）、三态复选框、全局/单任务控制按钮、下载模式选择器、同名文件冲突策略选择器（跳过/替换） |
| `Segmented.tsx` | 统一的「玻璃滑动指示器」分段选择器 |
| `Spinner.tsx` | 加载动画组件 |

---

## 3. 数据流

### 3.1 下载流程

```
用户选择任务 + 点击下载
    ↓
Browser.tsx / CanvasBrowser.tsx 构建 DownloadTaskSpec[]
    ↓
window.api.download.start(destRoot, specs, { mode, conflictStrategy, localDestRoot })
    ↓
preload: ipcRenderer.invoke('download:start', ...)
    ↓
index.ts: download:start handler
  ├─ 输入验证（非空、上限 5000、taskId/fileName 存在）
  ├─ 按 mode 分发到 pendingLocal / pendingCloud 队列
  ├─ O(1) 去重检查（pendingLocalIds Set）
  ├─ conflictStrategy 写入 conflictStrategyByTask（taskId → skip/overwrite）
  └─ scheduleNext() / cloudScheduleNext()
       ├─ 从 pending 队列 shift spec
       ├─ 懒创建 TaskRuntime
       ├─ resolveDirectUrl()
       │    ├─ Canvas 文件：取 session cookie 写入 canvasCookiesByTask
       │    ├─ Canvas 课堂视频：解析 vod 直链
       │    └─ v.sjtu 旁听课程：解析视频 CDN 直链
       ├─ overwrite 时：本地 unlinkSync 旧文件 / 云盘 deleteCloudFile 删远端
       ├─ downloadStream() / cloudDownloadAndUpload()
       │    ├─ Cookie 注入（仅 oc.sjtu.edu.cn 这一跳）
       │    ├─ 429/403 Canvas 限流退避重试（最多 4 次）
       │    ├─ HTTP 流式下载 + 进度回调
       │    ├─ 断点续传（Range header + .part 文件）
       │    └─ emitProgress() → setImmediate 批处理 → IPC
       ├─ 终态处理：释放句柄、从 Map 移除、清理 conflictStrategyByTask/canvasCookiesByTask
       └─ notifyConcurrencySlotAvailable()
```

### 3.1.1 Canvas 文件直链解析

```
Canvas 文件 API 返回: url = https://oc.sjtu.edu.cn/files/{id}/download?download_frd=1
                                                          ↓ (302, 需要 session cookie)
resolveDirectUrl: sjtuSession().cookies.get({ url: CANVAS_BASE_URL })
     → canvasCookiesByTask.set(taskId, "name=val; name2=val2")
                                                          ↓
downloadStream / cloudDownloadAndUpload:
  fetchOnce → Cookie 注入 + Referer: oc.sjtu.edu.cn (仅此一跳)
     → node:https GET /files/{id}/download?download_frd=1  (带 Cookie)
     → 302 → https://s3.jcloud.sjtu.edu.cn/...?X-Amz-Signature=...
     → fetchOnce 跟随，Clean headers（不带 Cookie）
     → S3 200 → 流式下载到 .part 文件
```

### 3.2 进度推送链路

```
downloadStream() / cloudDownloadAndUpload()
    ↓ emitProgress({ taskId, state, received, total })
    ↓
setImmediate 合并（主进程侧，同 tick 多条合并为 1 次 IPC send）
    ↓ mainWindow.webContents.send('download:progress', prog)
    ↓
ipcRenderer.on → applyProgress(p)
    ↓
queueMicrotask 合并（渲染端侧，同 tick 多条合并为 1 次 store.set()）
    ↓
Zustand store 更新 → selector 触发重渲染
    ↓
useDownloadStats (编码 number) / useEffectiveProgress (both 模式聚合)
    ↓
memo 组件按需重渲染
```

### 3.3 Canvas 课程串行处理

```
CanvasBrowser: 用户选择课程 + 点击下载
    ↓
逐门课程串行处理：
  1. scanCourse(courseId) → files, folderMap, moduleFileIds, syllabusFileIds
  2. buildDownloadSpecs() → CanvasDownloadTaskSpec[]
  3. download.start() → 提交到主进程队列
  4. 等待该课程所有任务完成（useDownloadCompletion）
  5. 清理该课程的内存数据（canvasCourseData[courseId] = undefined）
  6. 处理下一门课程
```

---

## 4. 安全模型

| 层面 | 措施 |
|------|------|
| 进程隔离 | contextIsolation: true, nodeIntegration: false |
| CSP | default-src 'self', connect-src 限制到 SJTU 域名 |
| webview 导航 | ALLOWED_NAV_DOMAINS 白名单：sjtu.edu.cn, jaccount.sjtu.edu.cn, oc.sjtu.edu.cn |
| 窗口打开 | setWindowOpenHandler deny + shell.openExternal，web-contents-created 全局注入 |
| IPC 验证 | download:start 验证 specs 类型/大小/字段；云盘 token 不经 IPC 传输 |
| Token 管理 | JWT 仅在内存中；云盘 UserToken 由 main 进程缓存，renderer 不持有权威副本 |
| Canvas cookie | `canvasCookiesByTask` 仅在 `oc.sjtu.edu.cn` 这一跳注入；跟随 302 到 S3 后不带 Cookie（签名直链自包含，不泄漏 Canvas 会话给第三方域） |

---

## 5. 性能设计

### 5.1 下载引擎

- **惰性任务物化** — 内存 O(并发数) 而非 O(任务数)
- **O(1) 去重** — Set 替代 .some() 扫描
- **AIMD 自适应并发** — 自动探测最优并发数，无需手动调整
- **HTTPS keep-alive** — 复用 TLS 连接减少握手开销
- **Buffer chunk 收集** — 避免 O(n^2) 拼接
- **IPC 进度批处理** — 主进程 setImmediate + 渲染端 queueMicrotask 双重合并

### 5.2 渲染端

- **编码 selector** — `useDownloadStats` 将多个计数编码为单个 number，仅当计数变化时触发重渲染
- **useShallow** — 批量 primitive selector 合并
- **memo** — 所有纯叶子组件包裹
- **tasksKey 稳定化** — 仅在任务数组长度变化时触发 allTasks 重算
- **App 级进度订阅** — 单次订阅替代 per-page 重复订阅

### 5.3 Canvas 模块

- **视频通道缓存** — TTL 5 分钟 + 上界 500 条目，同 videoId 的教师+PPT 共享解析结果
- **事件驱动并发槽位** — Promise 事件通知替代 2 秒轮询
- **串行课程处理** — 避免同时持有所有课程的文件数据
- **并发模块页面获取** — concurrency limit 批量获取

---

## 6. 构建系统

项目使用 electron-vite，配置位于 `electron.vite.config.ts`：

| 构建目标 | 入口 | 输出 |
|----------|------|------|
| main | `src/main/index.ts` | `out/main/` |
| preload | `src/preload/index.ts` | `out/preload/` |
| renderer | `src/renderer/index.html` | `out/renderer/` |

路径别名：`@renderer` → `src/renderer/src`，`@shared` → `src/shared`

打包使用 electron-builder，配置在 `package.json` 的 `build` 字段中。

---

## 7. 已知技术债务

| 项目 | 严重度 | 说明 |
|------|--------|------|
| `sanitizeFsName` 三处重复 | LOW | `index.ts:173`, `canvas/api.ts:105`, `canvas/video-tokens.ts:316`，建议提取到共享模块 |
| `extractLectureNum` 两处重复 | LOW | `canvas/orchestrator.ts:579`, `canvas/video-tokens.ts:329` |
| `safeFetch` 两处重复 | LOW | `canvas/api.ts:21`, `canvas/video-tokens.ts:19` |
| `main/index.ts` 体量 | LOW | ~2540 行，可考虑拆分下载引擎为独立模块 |
| `mainWindowRef` 已废弃 | LOW | `orchestrator.ts:62` 标记 `@deprecated`，`emitToRenderer` 回退路径为死代码 |
