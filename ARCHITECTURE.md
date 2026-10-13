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
│    (CanvasBrowser / AuditedCourses / CnmoocBrowser /                │
│     TransferCenter / Settings / Welcome / Login)                    │
│    hooks/useSharedBrowserHooks.ts                                   │
│  技术栈: React 19 + Zustand + Tailwind CSS                          │
├─────────────────────────── contextBridge ────────────────────────────┤
│  预加载脚本                                                          │
│  src/preload/index.ts                                               │
│    window.api = { auth, vsjtu, download, cloudpan, canvas,          │
│                   cnmooc, ppt, updater }                            │
│    contextIsolation: true, nodeIntegration: false                    │
├─────────────────────────── IPC invoke/on ────────────────────────────┤
│  主进程 (Node.js)                                                   │
│  src/main/index.ts          ← 窗口管理 + IPC 通道路由 + 生命周期     │
│  src/main/download-engine/  ← 本地/云盘流式下载与并发调度引擎        │
│  src/main/concurrency.ts    ← 并发限制管理、网络健康监测与 EMA 平滑流速监控 │
│  src/main/cloudpan.ts       ← 交大云盘 REST / COS API               │
│  src/main/canvas/api.ts     ← Canvas REST API                       │
│  src/main/canvas/orchestrator.ts ← Canvas IPC handler + 编排        │
│  src/main/canvas/video-tokens.ts ← LTI token + vod API + 缓存       │
│  src/main/canvas/hls-download.ts ← HLS 下载 + ffmpeg remux          │
│  src/main/canvas/ppt-download.ts ← PPT 课件图片下载 + PDF 合并      │
│  src/main/cnmooc/api.ts     ← 好大学在线 REST API + cheerio 解析     │
│  src/main/cnmooc/orchestrator.ts ← 好大学在线 IPC + SSO 编排        │
│  src/main/updater.ts        ← 应用内静默更新引擎                    │
│  src/main/auth.ts           ← 会话恢复与 jAccount 认证状态校验       │
├─────────────────────────── 共享模块与类型 ──────────────────────────┤
│  src/shared/types.ts        ← 核心数据结构与 IPC 消息定义           │
│  src/shared/utils.ts        ← 统一路径清洗、格式化与安全过滤工具     │
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

### 2.1 主进程架构与下载引擎解耦

主进程采用模块化架构，将应用路由、窗口生命周期与核心下载调度清晰解耦：

| 模块文件 | 核心职责 |
|---------|---------|
| `src/main/index.ts` | 应用程序生命周期、单实例锁控制、主窗口与托盘协调、全模块 IPC 通道汇总挂载 |
| `src/main/download-engine/local.ts` | 本地 HTTP 流式下载：Range 断点续传、分块 backpressure、Canvas Cookie 注入、429/403 退避重试、哈希/非空校验 |
| `src/main/download-engine/cloud.ts` | 交大云盘直传：CDN→COS 边下载边分片上传、凭证自动 renew、断点续传会话、overwrite 远端清理、abort 熔断 |
| `src/main/download-engine/shared.ts` | 任务队列管理（pending/paused/active）、O(1) 去重索引、惰性任务物化、直链懒解析路由 |
| `src/main/download-engine/progress.ts`| IPC 进度批处理与防抖合并（`setImmediate` 轮次合并），保障渲染端流畅度 |
| `src/main/concurrency.ts` | 并发限制管理、网络健康监测（DNS 失败/连续错误识别与 30s 自动恢复定时器）与平滑流速监控（EMA） |
| `src/main/window.ts` | 主窗口生命周期管理、跨平台标题栏适配（Win/Linux 原生三键与 macOS 交通灯）、任务栏/托盘最小化策略与关闭拦截 |
| `src/main/auth.ts` | jAccount 会话持久化与恢复、登录态缓存校验、v.sjtu 请求代理 |
| `src/main/updater.ts` | 轻量化应用内静默更新机制：版本比对、断点续传下载安装包、三平台自适应安装与锁释放 |

**关键设计模式：**

- **惰性任务物化** — `download:start` 将 spec 存入 `pendingLocal` / `pendingCloud` 队列（`PendingSpec` 比 `TaskRuntime` 轻量），调度器 `scheduleNext()` / `cloudScheduleNext()` 临下载时才创建 `TaskRuntime`
- **O(1) 去重索引** — `pendingLocalIds` / `pausedLocalIds` 等 `Set<string>` 提供 O(1) 重复检测
- **IPC 进度批处理** — `emitProgress()` 使用 `setImmediate` 合并同一事件循环轮次内的多条进度，Map 按 taskId 去重仅保留最新值
- **并发控制与 EMA 测速** — 用户可在设置面板自由配置 1~16 线程（默认 3），EMA（指数移动平均）算法平滑输出每秒上下行传输速率并推送渲染端展示
- **网络健康监测与自动恢复** — 监测 DNS 解析异常与连续网络故障；发生断网时自动阻断新任务拉取并启动 30s 退避定时器，网络恢复后无缝重排队列
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
| `App.tsx` | 根组件：按 `stage` 切换页面（welcome → login → browser），顶栏解耦导航（三大课程源），支持从传输中心与设置页记录 `previousCourseTab` 上下文无缝回跳 |
| `Welcome.tsx` | 欢迎页：原生自适应双栏面板，左侧版本信息与特性，右侧流体居中认证操作区 |
| `Login.tsx` | 登录页：内嵌 jAccount 扫码 webview，域名白名单导航限制，JWT token 轮询提取 |
| `AuditedCourses.tsx` | 旁听课程页（原 Browser.tsx）：v.sjtu 旁听课程列表与双视角卡片、全选/单选、批量下载控制、实时进度与重载 |
| `CanvasBrowser.tsx` | Canvas 课程页：学期筛选、分类选择（课件/教师/PPT/单元视频/PPT课件）、串行课程处理（扫描→下载→等待→清理→下一门）、PPT 导出 PDF |
| `CnmoocBrowser.tsx` | 好大学在线页：章节折叠卡片、资源类型分段（全部/仅视频/仅课件）、懒解析下载、自动 SSO 会话保持与刷新重载 |
| `TransferCenter.tsx` | 独立传输中心：跨业务全局任务看板、实时下行/上行速率监控、活跃下载/上传队列管理、历史完成记录、一键返回前序课程上下文 |
| `Settings.tsx` | 全局设置页：专业双栏卡片布局，存储目标模式、保存目录、并发档位、视频视角偏好、PPT 导出、深浅外观等全选项化配置（零手动繁琐输入） |

#### 共享组件

| 组件 | 职责 |
|------|------|
| `TitleBar.tsx` | 自定义标题栏：业务课程源解耦切换（Canvas 课程、旁听课程、好大学在线）、右侧工具区常驻传输中心动态流速胶囊看板、云盘连接状态、全局设置入口、登出与自动更新提醒 |
| `DownloadUI.tsx` | 下载 UI 原子组件：进度条（EMA 速度）、三态复选框、全局/单任务控制按钮、下载模式选择器、同名文件冲突策略选择器（跳过/替换） |
| `Segmented.tsx` | 统一的「玻璃滑动指示器」分段选择器 |
| `Spinner.tsx` | 加载动画组件 |

---

## 3. 数据流

### 3.1 下载流程

```
用户选择任务 + 点击下载
    ↓
AuditedCourses.tsx / CanvasBrowser.tsx / CnmoocBrowser.tsx 构建 DownloadTaskSpec[]
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
- **动态并发与槽位管控** — 支持 1~16 线程配置，HLS 视频下载与文件流共用全局并发预算
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

## 7. 技术债务与重构审计

经过 2.4.0 版本的深度重构与代码清理，前期记录的关键架构债务已全部清零：

| 项目 | 状态 | 重构成果与说明 |
|------|------|----------------|
| `sanitizeFsName` 重复 | **已解决** | 已统一提取至 `src/shared/utils.ts` 并覆盖全套严苛测试（含特殊符号、控制字符与边界用例） |
| `safeFetch` 封装 | **已解决** | 已统一在 `src/main/canvas/safe-fetch.ts` 集中封装，提供 429 退避重试与网络错误韧性机制 |
| `main/index.ts` 庞大体量 | **已解决** | 下载与并发调度引擎已完全解耦至 `src/main/download-engine/` 及 `concurrency.ts`，主文件缩减至 1000 行纯粹的生命周期与 IPC 路由 |
| 传输中心与导航层级混乱 | **已解决** | 顶栏完成信息架构（IA）层级解耦：业务源（Canvas/旁听/好大学）与系统设施（传输中心看板/设置）彻底分离 |
| 临时测试与过程工件残留 | **已解决** | 清理所有临时测试脚本及协作工件，`.gitignore` 强化防护，维持 17 套（422 项）自动化测试全绿 |
