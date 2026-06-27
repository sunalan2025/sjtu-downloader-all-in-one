import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, session, shell, Tray } from 'electron'
import { electronApp, is } from '@electron-toolkit/utils'
import {
  createWriteStream,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type WriteStream
} from 'node:fs'
import { freemem, totalmem } from 'node:os'
import { join } from 'node:path'
import { request as httpsRequest } from 'node:https'
import type { ClientRequest, IncomingMessage } from 'node:http'
import {
  SJTU_PARTITION,
  V_SJTU_API,
  V_SJTU_API_BASE,
  V_SJTU_ORIGIN,
  CANVAS_BASE_URL,
  CNMOOC_BASE_URL,
  type DownloadMode,
  type FileConflictStrategy,
  type DownloadProgress,
  type DownloadState,
  type DownloadTaskSpec,
  type VodInfoData
} from '../shared/types'
import {
  getCachedUserToken,
  setCachedUserToken,
  clearCachedCredentials,
  validateUserToken,
  getSpaceInfo,
  ensureFolderPath,
  startChunkedUpload,
  resumeChunkedUpload,
  deleteCloudFile,
  setSession,
  FileExistsError,
  type ChunkedUploader,
  type UploadSessionState
} from './cloudpan'
import {
  setCanvasSession,
  setCanvasEmitter,
  setConcurrencyProvider,
  setHlsActiveReporter,
  registerCanvasHandlers,
  notifyConcurrencySlotAvailable
} from './canvas/orchestrator'
import { killAllFfmpeg } from './canvas/hls-download'
import { sanitizeForLog } from './canvas/safe-fetch'
import { getVodChannelsCached, clearVodChannelsCache, clearExtToolTokenCache, getExtToolToken, fetchExtToolVodUrl, fetchVsharePlayUrl } from './canvas/video-tokens'
import {
  fetchFileMeta,
  sanitizeFsName
} from './canvas/api'
import type { CanvasDownloadTaskSpec, UpdateCheckResult } from '../shared/types'
import {
  registerCnmoocHandlers,
  setCnmoocSession,
  setCnmoocEmitter
} from './cnmooc/orchestrator'
import { fetchCnmoocResourceUrl, inferCnmoocExt } from './cnmooc/api'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

// ─── 新版本检查配置 ───
const UPDATE_REPO = 'sunalan2025/sjtu-downloader-all-in-one'
const UPDATE_CHECK_TTL = 60 * 60 * 1000 // 1h 节流，避免触发 GitHub 未认证 60 次/h 限流
let _updateCache: { result: UpdateCheckResult; ts: number } | null = null

/** 语义版本比较：latest > current 返回 true。不引 semver 依赖，仅按 a.b.c 数字逐段比。
 *  非 semver 字符串（解析失败）视为非新版，保守返回 false。 */
function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.split('.').map(Number)
  const b = current.split('.').map(Number)
  if (a.some(n => Number.isNaN(n)) || b.some(n => Number.isNaN(n))) return false
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    if (ai > bi) return true
    if (ai < bi) return false
  }
  return false
}

/** v.sjtu 的 jwt-token，由 renderer 在登录回跳后从 webview localStorage 抽取并推过来。
 *  只放在内存里，进程退出即丢；下次启动需要重新登录拿。 */
let jwtToken: string | null = null

/** 当前已登录用户的显示名和学号。由 getAuthInfo 登录成功时写入；
 *  登出/未登录时置 null。供托盘右键菜单、auth:status 读取。 */
let accountName: string | null = null
let studentId: string | null = null

/** 从 /cloud-rbac/authority/me 的 result 中取用户显示名和学号。
 *  API 结构: { result: { user: { name: "真实姓名", username: "学号", code: "学号" } } } */
function pickAccountInfo(result: unknown): { name?: string; studentId?: string } {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    if (r.user && typeof r.user === 'object') {
      const u = r.user as Record<string, unknown>
      const name = typeof u.name === 'string' && u.name.trim() ? u.name.trim() : undefined
      const studentId = typeof u.username === 'string' && u.username.trim() ? u.username.trim()
        : typeof u.code === 'string' && u.code.trim() ? u.code.trim() : undefined
      return { name, studentId }
    }
  }
  return {}
}



/** 应用窗口图标路径。dev 下从项目 build/icons 解析；打包后从 extraResources(icons) 解析。
 *  PNG 跨平台可用；Windows 打包后任务栏图标取自 exe (win.icon)，此处主要用于
 *  开发期窗口图标与 Linux 窗口装饰。 */
function resolveAppIcon(): string {
  return is.dev
    ? join(app.getAppPath(), 'build', 'icons', '256.png')
    : join(process.resourcesPath, 'icons', '256.png')
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    show: true,
    center: true,
    autoHideMenuBar: true,
    icon: resolveAppIcon(),
    backgroundColor: '#0e1430',
    // macOS 用 hiddenInset：保留原生交通灯（红黄绿）并 inset 进内容区，与自绘标题栏融合；
    // Win/Linux 用 hidden：无原生按钮，由 renderer 自绘 Mac 风格交通灯（CaptionButtons）。
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // [2.3] sandbox: false is required because webviewTag: true needs access to
      // Electron's webview internals which are blocked by the Chromium sandbox.
      // contextIsolation: true + nodeIntegration: false still protect the renderer.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  mainWindow.webContents.setWindowOpenHandler(d => {
    shell.openExternal(d.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // ─── 最小化/关闭到系统托盘 ───────────────────────────────────
  // 标题栏使用自定义按钮（见 TitleBar CaptionButtons）→ window:minimize/close IPC。
  // 原生 minimize 事件无法 preventDefault，故仅作为任务栏/Win+Down 的兜底：直接隐藏到托盘。
  // close 事件可 preventDefault，统一走 handleCloseAction（含下载中确认弹窗），覆盖 Alt+F4/任务栏关闭。
  let trayHintShown = false
  mainWindow.on('minimize', () => {
    mainWindow?.hide()
    if (!trayHintShown && tray && process.platform === 'win32') {
      trayHintShown = true
      tray.displayBalloon({
        iconType: 'info',
        title: 'SJTU 课程下载器',
        content: '已最小化到系统托盘，下载将继续在后台进行。点击托盘图标可恢复窗口。'
      })
    }
  })
  mainWindow.on('close', (e) => {
    // isQuitting 由托盘"退出"/window:quit/window:cancel-and-quit/before-quit 置位；否则拦截，
    // 发事件让 renderer 弹 Mac 风格确认窗，renderer 回调 window:minimize / window:cancel-and-quit / 不动。
    // 覆盖 Alt+F4 / 任务栏右键关闭。
    if (!isQuitting) {
      e.preventDefault()
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('window:close-requested')
      }
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ─── 系统托盘 ─────────────────────────────────────────────────

let tray: Tray | null = null

/** 托盘图标路径：dev 下从项目 build/icons 取 32.png；打包后从 extraResources(icons) 取。
 *  Electron Tray 在 Windows 上接受 PNG；32px 兼顾 HiDPI 清晰度。 */
function resolveTrayIcon(): string {
  return is.dev
    ? join(app.getAppPath(), 'build', 'icons', '32.png')
    : join(process.resourcesPath, 'icons', '32.png')
}

function showMainWindow(): void {
  if (isQuitting) return
  if (!mainWindow) createMainWindow()
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}

function createTray(): void {
  if (tray) return
  let img = nativeImage.createFromPath(resolveTrayIcon())
  if (img.isEmpty()) img = nativeImage.createFromPath(resolveAppIcon())
  // macOS 菜单栏规范：托盘图标应为 template image（纯黑+透明，系统按深/浅菜单栏自动反色）。
  // 彩色图标在深色菜单栏上不可见。Win/Linux 无此机制，保持原色。
  if (process.platform === 'darwin' && !img.isEmpty()) img.setTemplateImage(true)
  tray = new Tray(img)
  tray.setToolTip('SJTU 课程下载器')
  // 右键动态菜单：显示当前账号名 + 实时速度（取主进程 speedEma 当前值）。
  // 不用 setContextMenu（静态菜单无法反映实时速度/账号），改为 right-click 时构建并 popUp。
  tray.on('right-click', () => {
    if (!tray) return
    const menu = Menu.buildFromTemplate([
      { label: `账号：${accountName ?? '未登录'}${studentId ? ` (${studentId})` : ''}`, enabled: false },
      { label: `↓ ${formatBytes(speedDownEma)}/s   ↑ ${formatBytes(speedUpEma)}/s`, enabled: false },
      { type: 'separator' },
      { label: '显示主窗口', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
    tray.popUpContextMenu(menu)
  })
  // 单击/双击托盘图标恢复窗口（Windows 习惯：单击）
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
}

const sjtuSession = (): Electron.Session => session.fromPartition(SJTU_PARTITION)

async function clearSjtuSession(): Promise<void> {
  await sjtuSession().clearStorageData({
    storages: ['cookies', 'localstorage', 'cachestorage', 'serviceworkers', 'indexdb']
  })
}

/** 登录判定：先看 sjtu cookie，再用 jwt 敲 /authority/me 验真。
 *  cloud-rbac 单接受 cookie 即可，但拿到 jwt 才能调 resmgr 系列。
 *  PERF: cache auth result for 5 minutes to skip network round-trip on fast restarts.
 *  同时从 /authority/me 的 result.user 中抽取真实姓名和学号供 UI/托盘显示。 */
interface AuthInfo { loggedIn: boolean; accountName?: string; studentId?: string }
let _authCache: { result: AuthInfo; ts: number } | null = null
async function getAuthInfo(): Promise<AuthInfo> {
  if (_authCache && Date.now() - _authCache.ts < 300_000) return _authCache.result
  const cookies = await sjtuSession().cookies.get({ domain: 'sjtu.edu.cn' })
  if (cookies.length === 0) {
    _authCache = { result: { loggedIn: false }, ts: Date.now() }
    return _authCache.result
  }
  try {
    const resp = await sjtuSession().fetch(`${V_SJTU_ORIGIN}/cloud-rbac/authority/me`, {
      method: 'GET',
      headers: vsjtuHeaders()
    })
    const text = await resp.text()
    if (!resp.ok) {
      _authCache = { result: { loggedIn: false }, ts: Date.now() }
      return _authCache.result
    }
    const json = JSON.parse(text) as { code?: string; result?: unknown }
    const ok = json?.code === '0'
    const info = ok ? pickAccountInfo(json?.result) : {}
    _authCache = { result: { loggedIn: ok, accountName: info.name, studentId: info.studentId }, ts: Date.now() }
    return _authCache.result
  } catch {
    _authCache = { result: { loggedIn: false }, ts: Date.now() }
    return _authCache.result
  }
}

function vsjtuHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    Origin: V_SJTU_ORIGIN,
    Referer: `${V_SJTU_ORIGIN}/jy-application-resmgr-ui/`
  }
  if (jwtToken) headers['jwt-token'] = jwtToken
  return headers
}

async function vsjtuFetch(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<unknown> {
  const headers = vsjtuHeaders()
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json;charset=UTF-8'
  const url = `${V_SJTU_API_BASE}${path}`
  let resp: Response
  try {
    resp = await sjtuSession().fetch(url, {
      method: init?.method || 'GET',
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|net::/i.test(msg)) {
      throw new Error(`DNS 解析失败，无法连接到 v.sjtu.edu.cn，请检查网络连接`)
    }
    throw err
  }
  const text = await resp.text()
  try {
    return JSON.parse(text)
  } catch {
    return { __raw: text, __status: resp.status }
  }
}

// ─────────────────────────────────────────────────────────────
// 下载：任务注册表 + 动态调度器 + 断点续传
// ─────────────────────────────────────────────────────────────

// PERF: batch progress emissions on the main process side.
// Multiple concurrent tasks can each emit progress in the same event loop tick
// (e.g. 8 tasks at 2s intervals may drift into the same tick). Batching coalesces
// N IPC serializations into 1 per tick, reducing renderer re-render count.
let progressBatch: Map<string, DownloadProgress> | null = null
let progressScheduled = false
function emitProgress(p: DownloadProgress): void {
  if (!progressBatch) progressBatch = new Map()
  progressBatch.set(p.taskId, p)
  if (!progressScheduled) {
    progressScheduled = true
    setImmediate(() => {
      const batch = progressBatch!
      progressBatch = null
      progressScheduled = false
      for (const prog of batch.values()) {
        mainWindow?.webContents.send('download:progress', prog)
      }
    })
  }
}

interface TaskRuntime {
  spec: DownloadTaskSpec
  state: DownloadState
  /** 最终落盘文件（rename 目标） */
  filePath: string
  /** 下载过程中的文件 = filePath + '.part' */
  partPath: string
  received: number
  total: number
  req?: ClientRequest
  resp?: IncomingMessage
  ws?: WriteStream
  /** pause/cancel 时调用，强制 settle downloadStream 的 Promise（避免等 resp.destroy 异步触发 error） */
  cancel?: () => void
}

const tasks = new Map<string, TaskRuntime>()
const active = new Set<string>()
let concurrency = 3
let autoConcurrency = false

/** 同名文件冲突策略：taskId → 策略。download:start 入队时写入，
 *  runTask/cloudRunTask 临下载时读取。任务完成后由 scheduleCleanupTask 清理。
 *  覆盖 'overwrite' 时：本地先删已存在的目标文件，云盘先删已存在的远端文件再上传。 */
const conflictStrategyByTask = new Map<string, FileConflictStrategy>()

/** Canvas 文件下载所需的会话 cookie 头：taskId → "name=val; name2=val2"。
 *  resolveDirectUrl 在下载前从 sjtuSession 取 cookie 写入；downloadStream /
 *  cloudDownloadAndUpload 发 node:https 请求时注入。任务完成由 scheduleCleanupTask 清理。 */
const canvasCookiesByTask = new Map<string, string>()

/** Canvas HTML 站点主机名（oc.sjtu.edu.cn）。Cookie/Referer 只注入给这一跳；
 *  跟随 302 到 s3.jcloud 预签名直链时不带 Canvas cookie（签名直链自包含，无需 cookie）。 */
const CANVAS_HOST = new URL(CANVAS_BASE_URL).hostname

/** 好大学在线 (cnmooc.sjtu.cn) 文件下载所需的会话 cookie 头：taskId → "name=val; ..."。
 *  resolveDirectUrl 的 'cnmooc' 分支下载前从 sjtuSession 取 cookie 写入；downloadStream /
 *  cloudDownloadAndUpload 发 node:https 请求时仅对 cnmooc 域注入（视频 CDN 直链自包含，无需 cookie）。
 *  任务完成由 scheduleCleanupTask 清理。 */
const cnmoocCookiesByTask = new Map<string, string>()

/** cnmooc 会话 cookie 需注入的主机：cnmooc.sjtu.cn 及其子域（如 static.cnmooc.sjtu.cn 课件）。
 *  视频 flvUrl 多落在第三方 CDN，不在此列 → 不注入（避免把 cnmooc cookie 泄漏给无关域）。 */
function isCnmoocCookieHost(hostname: string): boolean {
  return hostname === 'cnmooc.sjtu.cn' || hostname.endsWith('.cnmooc.sjtu.cn')
}

/** Canvas 下载端点在高并发下偶发 403/429 限流，按指数退避重试。
 *  仅对 Canvas 站点（oc.sjtu.edu.cn）的 429/403 重试；S3 的 403（签名/权限）是永久错误，不重试。 */
const CANVAS_RL_MAX_RETRIES = 4
function canvasRlBackoffMs(retryAfter: string | undefined, attempt: number): number {
  if (retryAfter && /^\d+$/.test(retryAfter.trim())) return Math.min(Number(retryAfter.trim()) * 1000, 30_000)
  return Math.min(Math.pow(2, attempt) * 1000, 16_000)
}

// [Bug Fix] 正在运行的 HLS 下载（Canvas 课堂视频，由 canvas/orchestrator 发起）。
// 这些任务不在 tasks/cloudTasks 里，原先不计入 sharedActiveCount，导致调度器在
// HLS 下载进行时仍可继续拉本地/云任务到 concurrency 上限 → 实际并发超限。
// 由 orchestrator 在获取槽位后增、下载结束后减，纳入全局计数。
let hlsActive = 0

// ─── 待处理 / 暂停 spec 队列（惰性任务生成） ───────────────────
//
// download:start 不再为每条 spec 建 TaskRuntime（3000 条会常驻占内存），
// 而是把 spec 存进 pendingLocal/pendingCloud。调度器临下载才 shift 一个
// 出来 new TaskRuntime，完成后立即销毁 → 内存里同时仅 ≈ 并发数个 TaskRuntime。
//
// pendingSpec 比轻：无 req/resp/ws/uploader 句柄、无运行时状态机。
// paused 队列存被暂停的 pending spec（还没轮到下载就 pause 的），resume 时放回 pending。

interface PendingSpec {
  spec: DownloadTaskSpec
  /** 预算的落盘路径（纯字符串拼接，便宜）；本地模式用，云端为空 */
  filePath: string
  partPath: string
}
const pendingLocal: PendingSpec[] = []
const pausedLocal: PendingSpec[] = []
const pendingCloud: DownloadTaskSpec[] = []
const pausedCloud: DownloadTaskSpec[] = []
// PERF: O(1) duplicate-check index sets for pending/paused arrays.
// download:start previously scanned these arrays with .some() — O(n) per spec.
// With 3000+ specs per batch, that's O(n²) total. These Sets provide O(1) membership tests.
const pendingLocalIds = new Set<string>()
const pausedLocalIds = new Set<string>()
const pendingCloudIds = new Set<string>()
const pausedCloudIds = new Set<string>()
/** 云端任务 pause 时保存的 COS 会话状态（resume 续传用）；taskId → state。
 *  仅对已开始下载后 pause 的任务有意义；pending 任务 pause 无此状态。 */
const cloudPausedStates = new Map<string, UploadSessionState>()

// ─── 自动并发控制（双模式 AIMD：RTT/错误率/资源水位闭环） ─────
//
// 设计要点（参考"双模式动态并发转存执行方案"）：
//  · 指标采集：每周期采集平均 RTT（请求→首字节/响应）、任务错误率、
//    系统内存占用、磁盘写入吞吐四项核心指标。
//  · 快降慢升（AIMD）：
//      - 资源超限（内存>85% 或 磁盘>70%）→ ×0.7
//      - 重度拥塞（RTT 涨幅>50% 或 错误率>5% 或 429 限流 或 网络错误）→ ×0.6
//      - 轻度拥塞（RTT 涨幅 30%~50% 或 错误率 1%~5%）→ ×0.8
//      - 状态良好（错误率<1% 且 RTT 涨幅<20%，连续 2 周期）→ +1
//      - 否则维持当前并发。
//  · 硬边界：始终 AC_MIN ≤ concurrency ≤ AC_MAX。
//  · 调整间隔 ≥3s，升慢降快，避免震荡；定时器为兜底，任务完成事件为实时驱动。
//  · RTT 基线动态跟踪历史低值（只下不上），涨幅 = (avg - base) / base。
//  · 上下行速度独立计量，供 UI 实时显示（transfer:speed 事件）。

const AC_MIN = 2
const AC_MAX = 16
const AC_MIN_INTERVAL_MS = 3000     // 调整最小间隔（方案要求 ≥3s，含事件驱动路径）
const AC_EVAL_DEFAULT_MS = 3000
const AC_EVAL_FAST_MS = 3000        // 拥塞/资源超限时快速反应（仍受 ≥3s 下限约束）
const AC_EVAL_SLOW_MS = 5000        // 平稳/无流量时拉长周期减抖
const AC_THROUGHPUT_MIN = 64 * 1024 // 64KB/s 以下不算"有意义的传输"，避免慢网误判爬升
const AC_DISK_CEILING = 150 * 1024 * 1024 // 磁盘写入吞吐标称上限（150MB/s），用于估算磁盘利用率
const AC_MEM_HIGH = 0.85
const AC_DISK_HIGH = 0.70
const AC_RTT_RISE_HEAVY = 0.5
const AC_RTT_RISE_LIGHT = 0.3
const AC_ERR_HEAVY = 0.05
const AC_ERR_LIGHT = 0.01
const AC_GOOD_PERIODS_REQUIRED = 2  // 连续良好周期数达标后才加性增

let acTimer: ReturnType<typeof setTimeout> | undefined
let acBytesSnapshot = 0           // 上轮评估时的累计字节
let acNetErrSnapshot = 0          // 上轮评估时的累计网络错误数
let acTotalBytes = 0              // 全局累计下载+上传字节（AIMD 吞吐用）
let acDownloadBytes = 0           // 累计下载字节（速度显示用，单计不重复）
let acUploadBytes = 0             // 累计上传字节（速度显示用）
let acTotalErrors = 0             // 全局累计任务级错误（仅日志）
let acNetworkErrors = 0           // 全局累计网络类错误（驱动降并发）
let acPrevThroughput = 0          // 上一轮吞吐 (bytes/s)，仅日志参考
let acLastEvalMs = 0              // 上一轮评估时间戳
// 周期内重置的指标
let acRttSamples: number[] = []   // 周期内 RTT 样本（ms）
let acBaseRtt = 0                 // RTT 基线（动态跟踪低值）
let acTaskTotal = 0               // 周期内计入的任务尝试数
let acTaskErrors = 0              // 周期内失败的任务数
let acDiskBytesWritten = 0        // 周期内落盘字节数（本地模式）
let acRateLimited = false         // 周期内是否收到 429 限流
let acGoodPeriods = 0             // 连续"状态良好"周期计数

// ─── 速度计量（1s 推送，独立于 AIMD 3s 周期） ─────────────────
let speedTimer: ReturnType<typeof setInterval> | undefined
let speedLastMs = 0
let speedDownSnap = 0
let speedUpSnap = 0
let speedDownEma = 0
let speedUpEma = 0

/** 主进程版 bytes 格式化（托盘右键菜单速度显示用）。与 renderer DownloadUI.formatBytes 同义。 */
function formatBytes(n: number): string {
  if (!n || n < 1) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`
}

function noteDownloadBytes(bytes: number): void {
  acTotalBytes += bytes
  acDownloadBytes += bytes
}
function noteUploadBytes(bytes: number): void {
  acTotalBytes += bytes
  acUploadBytes += bytes
}
function noteDiskWrite(bytes: number): void {
  acDiskBytesWritten += bytes
}
function noteRttSample(ms: number): void {
  // 过滤明显异常值（暂停/续传后的首包抖动），保留合理范围
  if (ms > 0 && ms < 60_000) acRttSamples.push(ms)
}
function noteTaskResult(success: boolean): void {
  acTaskTotal++
  if (!success) acTaskErrors++
}
function noteRateLimited(): void {
  acRateLimited = true
}
function noteTaskError(): void {
  acTotalErrors++
}

/** 系统内存占用比例（0..1）。用 os.freemem/totalmem 近似整机内存压力。 */
function getMemUsage(): number {
  const total = totalmem()
  if (total <= 0) return 0
  return Math.max(0, Math.min(1, 1 - freemem() / total))
}

/** 磁盘 IO 利用率近似（0..1）。跨平台无法精确取系统级磁盘利用率，
 *  这里用本进程周期内的落盘吞吐占标称上限的比例近似 —— 仅本地下载模式下有意义，
 *  用来判断磁盘是否成为瓶颈。 */
function getDiskIoUsage(dtMs: number): number {
  const rate = acDiskBytesWritten / (Math.max(1, dtMs) / 1000) // bytes/s
  return Math.max(0, Math.min(1, rate / AC_DISK_CEILING))
}

/** 启动 1s 速度推送定时器（应用就绪后常驻，idle 时也推送 0 供 UI 显示）。 */
function startSpeedTicker(): void {
  if (speedTimer) return
  speedLastMs = Date.now()
  speedDownSnap = 0
  speedUpSnap = 0
  speedTimer = setInterval(emitTransferSpeed, 1000)
}

function stopSpeedTicker(): void {
  if (speedTimer) { clearInterval(speedTimer); speedTimer = undefined }
}

/** 计算 EMA 平滑后的下行/上行速度并推送给渲染端。 */
function emitTransferSpeed(): void {
  if (isQuitting) return
  const now = Date.now()
  const dt = Math.max(1, (now - speedLastMs) / 1000)
  const downInst = (acDownloadBytes - speedDownSnap) / dt
  const upInst = (acUploadBytes - speedUpSnap) / dt
  speedDownSnap = acDownloadBytes
  speedUpSnap = acUploadBytes
  speedLastMs = now
  speedDownEma = speedDownEma === 0 ? downInst : speedDownEma * 0.6 + downInst * 0.4
  speedUpEma = speedUpEma === 0 ? upInst : speedUpEma * 0.6 + upInst * 0.4
  mainWindow?.webContents.send('transfer:speed', {
    down: Math.round(speedDownEma),
    up: Math.round(speedUpEma)
  })
}

function startAutoConcurrency(): void {
  if (acTimer) return
  acBytesSnapshot = acTotalBytes
  acNetErrSnapshot = acNetworkErrors
  acRttSamples = []
  acTaskTotal = 0
  acTaskErrors = 0
  acDiskBytesWritten = 0
  acRateLimited = false
  acGoodPeriods = 0
  acPrevThroughput = 0
  acLastEvalMs = Date.now()
  acTimer = setTimeout(evalAutoConcurrency, AC_EVAL_DEFAULT_MS)
}

function stopAutoConcurrency(): void {
  if (acTimer) { clearTimeout(acTimer); acTimer = undefined }
}

function scheduleEval(ms: number): void {
  acLastEvalMs = Date.now()
  acTimer = setTimeout(evalAutoConcurrency, ms)
}

/** 核心 AIMD 决策：测量自上次评估以来的吞吐/RTT/错误率/资源水位，调整 concurrency。
 *  由定时器（兜底）和任务完成事件（事件驱动，更实时）共同调用。
 *  返回下一次评估建议间隔（ms）。不管理定时器本身，由调用方 scheduleEval。 */
function runConcurrencyEval(): number {
  const now = Date.now()
  const dt = Math.max(1, now - acLastEvalMs)
  const bytesDelta = acTotalBytes - acBytesSnapshot
  const netErrDelta = acNetworkErrors - acNetErrSnapshot
  const throughput = bytesDelta / (dt / 1000)  // bytes/s

  // ── 周期指标 ──
  const avgRtt = acRttSamples.length > 0
    ? acRttSamples.reduce((a, b) => a + b, 0) / acRttSamples.length
    : acBaseRtt
  const rttRise = acBaseRtt > 0 ? (avgRtt - acBaseRtt) / acBaseRtt : 0
  const errRate = acTaskTotal > 0 ? acTaskErrors / acTaskTotal : 0
  const memUse = getMemUsage()
  const diskUse = getDiskIoUsage(dt)
  const limited = acRateLimited

  // ── 重置周期计数 ──
  acBytesSnapshot = acTotalBytes
  acNetErrSnapshot = acNetworkErrors
  acRttSamples = []
  acTaskTotal = 0
  acTaskErrors = 0
  acDiskBytesWritten = 0
  acRateLimited = false

  // ── 动态更新 RTT 基线：只下不上（拥塞导致的升高不污染基线）──
  if (avgRtt > 0) {
    if (acBaseRtt <= 0) acBaseRtt = avgRtt
    else if (avgRtt < acBaseRtt) acBaseRtt = acBaseRtt * 0.7 + avgRtt * 0.3
  }
  if (acBaseRtt <= 0) acBaseRtt = 120 // 兜底默认

  const prev = concurrency
  let nextMs: number

  if (memUse > AC_MEM_HIGH || diskUse > AC_DISK_HIGH) {
    // ── 资源超限兜底 → ×0.7 ──
    concurrency = Math.max(AC_MIN, Math.floor(concurrency * 0.7))
    acGoodPeriods = 0
    nextMs = AC_EVAL_FAST_MS
  } else if (netErrDelta > 0 || limited || rttRise > AC_RTT_RISE_HEAVY || errRate > AC_ERR_HEAVY) {
    // ── 重度拥塞 / 限流 / 网络错误 → ×0.6 ──
    concurrency = Math.max(AC_MIN, Math.floor(concurrency * 0.6))
    acGoodPeriods = 0
    nextMs = AC_EVAL_FAST_MS
  } else if (rttRise > AC_RTT_RISE_LIGHT || errRate > AC_ERR_LIGHT) {
    // ── 轻度拥塞 → ×0.8 ──
    concurrency = Math.max(AC_MIN, Math.floor(concurrency * 0.8))
    acGoodPeriods = 0
    nextMs = AC_EVAL_DEFAULT_MS
  } else if (throughput > AC_THROUGHPUT_MIN && errRate < AC_ERR_LIGHT && rttRise < 0.2) {
    // ── 状态良好：连续 2 周期达标才加性增 +1 ──
    acGoodPeriods++
    if (acGoodPeriods >= AC_GOOD_PERIODS_REQUIRED) {
      concurrency = Math.min(AC_MAX, concurrency + 1)
      acGoodPeriods = 0
    }
    nextMs = AC_EVAL_DEFAULT_MS
  } else {
    // ── 几乎无流量 / 边界状态：维持并发，拉长周期 ──
    nextMs = AC_EVAL_SLOW_MS
  }

  acPrevThroughput = throughput

  if (concurrency !== prev) {
    console.log(
      `[auto-concurrency] ${prev} → ${concurrency} ` +
      `(rtt=${avgRtt.toFixed(0)}ms rise=${(rttRise * 100).toFixed(0)}% ` +
      `err=${(errRate * 100).toFixed(0)}% (${acTaskErrors}/${acTaskTotal}) ` +
      `mem=${(memUse * 100).toFixed(0)}% disk=${(diskUse * 100).toFixed(0)}% ` +
      `thr=${(throughput / 1024).toFixed(0)}KB/s netErr=${netErrDelta}${limited ? ' 429' : ''})`
    )
    mainWindow?.webContents.send('download:concurrency-changed', concurrency)
  }
  // 并发变化后立即调度，让新增槽位尽快被填充
  scheduleNext()
  cloudScheduleNext()
  return nextMs
}

function evalAutoConcurrency(): void {
  acTimer = undefined
  if (isQuitting) { stopAutoConcurrency(); return }
  // 所有队列和活跃集合为空 → 暂停定时器，等下次有任务时重启
  if (sharedActiveCount() === 0 && pendingLocal.length === 0 && pendingCloud.length === 0) {
    stopAutoConcurrency()
    return
  }
  const nextMs = runConcurrencyEval()
  scheduleEval(nextMs)
}

// ─── 事件驱动并发探测 ─────────────────────────────────────────
//
// 定时器评估是兜底；真正"实时"的信号是任务完成事件 —— 每完成一个文件/视频，
// 立刻测量这段时间窗口的吞吐/RTT/错误并做 AIMD 决策。相比固定 3-5s 定时器，
// 能在任务粒度上更快响应网络变化（尤其大文件下载期间定时器窗口太粗）。
// 方案要求调整间隔 ≥3s：事件驱动路径同样受 AC_MIN_INTERVAL_MS 约束，
// 距上次评估不足 3s 时跳过，由定时器兜底评估。

/** 由 runTask / cloudRunTask 的 .finally 在任务结束时调用。
 *  仅在自动并发模式下生效；距上次评估 ≥3s 才立即跑一次 AIMD 评估并重排定时器。 */
function onTaskCompleted(): void {
  if (!autoConcurrency || isQuitting) return
  const now = Date.now()
  if (now - acLastEvalMs < AC_MIN_INTERVAL_MS) return
  // 用最新窗口的吞吐/RTT/错误做决策，并按建议间隔重排定时器（定时器退居为无完成事件时的兜底）
  const nextMs = runConcurrencyEval()
  if (acTimer) { clearTimeout(acTimer); acTimer = undefined }
  scheduleEval(nextMs)
}

// ─── 终态任务清理：立即释放内存 ────────────────────────────────
//
// 终态（done/skipped/cancelled/error）任务不会再被 pause/resume/cancel 触发
// （这些函数开头就对终态 return），重试/恢复走 re-enqueue 新建 TaskRuntime，
// 不依赖旧的。故立即同步清理句柄与 map 项，让 spec/url/buffer 早回收，
// 不再延迟 8s 占内存。

function scheduleCleanupTask(taskId: string, isCloud: boolean): void {
  if (isQuitting) return
  if (isCloud) {
    const t = cloudTasks.get(taskId)
    if (t) {
      t.req = undefined; t.resp = undefined; t.uploader = undefined; t.cancel = undefined
      t.uploaderState = undefined
      cloudTasks.delete(taskId)
    }
  } else {
    const t = tasks.get(taskId)
    if (t) {
      t.req = undefined; t.resp = undefined; t.ws = undefined; t.cancel = undefined
      tasks.delete(taskId)
    }
  }
  conflictStrategyByTask.delete(taskId)
  canvasCookiesByTask.delete(taskId)
  cnmoocCookiesByTask.delete(taskId)
}

// ─── 网络健康监测 ─────────────────────────────────────────────

/** 判断错误是否为 DNS 解析失败（ENOTFOUND / ERR_NAME_NOT_RESOLVED） */
function isDnsError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/i.test(msg)) return true
  if ('code' in err && /^(ENOTFOUND|EAI_AGAIN)$/.test(String((err as Error & { code?: unknown }).code))) return true
  return false
}

let networkErrorStreak = 0
let networkResumeTimer: ReturnType<typeof setTimeout> | undefined
const NETWORK_BACKOFF_MS = 30_000

function noteNetworkError(): void {
  networkErrorStreak++
  acNetworkErrors++   // 驱动自动并发的乘性减
  if (networkResumeTimer) { clearTimeout(networkResumeTimer); networkResumeTimer = undefined }
}

function noteNetworkRecovery(): void {
  networkErrorStreak = 0
  if (networkResumeTimer) { clearTimeout(networkResumeTimer); networkResumeTimer = undefined }
}

function isNetworkHealthy(): boolean {
  return networkErrorStreak < 3
}

// [2.8] Combined active count for shared concurrency limit across local + cloud
function sharedActiveCount(): number {
  return active.size + cloudActive.size + hlsActive
}

/** 是否有进行中（含排队/暂停）的下载任务。用于判断点最小化/关闭时是否需要弹确认窗。
 *  paused 也计入：关闭会丢失暂停态（进度不持久化），故有暂停任务时同样提示。
 *  renderer 在弹出 Mac 风格确认窗前通过 window:has-ongoing-tasks IPC 查询此结果。 */
function hasOngoingTasks(): boolean {
  return active.size > 0
    || cloudActive.size > 0
    || hlsActive > 0
    || pendingLocal.length > 0
    || pendingCloud.length > 0
    || pausedLocal.length > 0
    || pausedCloud.length > 0
}

function scheduleNext(): void {
  if (isQuitting) return
  while (sharedActiveCount() < concurrency && pendingLocal.length > 0) {
    // 网络不佳时暂停拉取新任务，让活跃任务优先重试
    if (!isNetworkHealthy()) {
      // 设置兜底恢复定时器：避免所有活跃任务都失败后永久卡住
      if (!networkResumeTimer) {
        networkResumeTimer = setTimeout(() => {
          networkResumeTimer = undefined
          networkErrorStreak = 0
          scheduleNext()
          cloudScheduleNext()
        }, NETWORK_BACKOFF_MS)
      }
      break
    }
    // 惰性 materialization：临下载才从 pendingLocal 取 spec 建 TaskRuntime
    const { spec, filePath, partPath } = pendingLocal.shift()!
    pendingLocalIds.delete(spec.taskId)
    const existing = tasks.get(spec.taskId)
    if (existing && (existing.state === 'pending' || existing.state === 'downloading' || existing.state === 'paused')) {
      continue // 已在跑（重复入队防护）
    }
    const t: TaskRuntime = {
      spec: { ...spec, cloudUserToken: undefined },
      filePath, partPath,
      state: 'pending', received: 0, total: 0
    }
    tasks.set(spec.taskId, t)
    active.add(spec.taskId)
    void runTask(t).finally(() => {
      active.delete(spec.taskId)
      t.req = undefined
      t.resp = undefined
      t.ws = undefined
      t.cancel = undefined
      // 喂入 AIMD 错误率指标：仅计入真正发生传输的尝试（排除 paused/cancelled/skipped）
      const fs = t.state as DownloadState
      if (fs === 'done') noteTaskResult(true)
      else if (fs === 'error') noteTaskResult(false)
      notifyConcurrencySlotAvailable()
      scheduleNext()
      onTaskCompleted()  // 事件驱动并发探测
    })
  }
}

async function runTask(t: TaskRuntime): Promise<void> {
  const strategy = conflictStrategyByTask.get(t.spec.taskId) ?? 'skip'

  // 最终文件已存在 → 跳过 或 先删后下载（overwrite）
  if (strategy === 'overwrite') {
    // 替换模式：无需预检存在性，直接删，不存在则 ENOENT 自然忽略
    // （消除 existsSync/stat → unlink 的 TOCTOU 窗口）
    try { unlinkSync(t.filePath) } catch { /* 不存在则忽略 */ }
    try { unlinkSync(t.partPath) } catch { /* ignore */ }
  } else {
    // skip 策略：statSync(throwIfNoEntry:false) 单次调用判存在，之后仅 return 无文件操作
    if (statSync(t.filePath, { throwIfNoEntry: false })) {
      t.state = 'skipped'
      emitProgress({
        taskId: t.spec.taskId,
        state: 'skipped',
        received: 0,
        total: 0,
        filePath: t.filePath,
        message: '已存在，跳过'
      })
      scheduleCleanupTask(t.spec.taskId, false)
      return
    }
  }

  // 确保目标目录存在（惰性：临下载才建，避免一开始对 3000 条 spec 全 mkdir）
  try {
    mkdirSync(join(t.filePath, '..'), { recursive: true })
  } catch {
    /* ignore */
  }

  // 按需解析直链（lazy resolution，与 cloudRunTask 共用；含 cancel 竞态守卫）
  if (!await resolveDirectUrl(t, false)) return

  t.state = 'downloading'
  emitProgress({
    taskId: t.spec.taskId,
    state: 'downloading',
    received: t.received,
    total: t.total
  })

  try {
    // 本地下载自动重试：网络错误（socket hang up 等）时最多重试 3 次
    const MAX_DL_RETRIES = 3
    for (let attempt = 0; ; attempt++) {
      try {
        await downloadStream(t)
        noteNetworkRecovery()
        break
      } catch (retryErr) {
        if (t.state !== 'downloading') throw retryErr // 被 pause/cancel，不重试
        const msg = retryErr instanceof Error ? retryErr.message : ''
        const isNetErr =
          /socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timeout|EPIPE/i.test(msg) ||
          isDnsError(retryErr)
        const errLabel = isDnsError(retryErr) ? 'DNS 解析失败' : '网络中断'
        if (isNetErr && attempt < MAX_DL_RETRIES) {
          const delay = Math.pow(2, attempt + 1) * 1000
          noteNetworkError()
          console.warn(`[download] ${errLabel}，${delay / 1000}s 后重试 (${attempt + 1}/${MAX_DL_RETRIES}): ${sanitizeForLog(msg)}`)
          emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: t.received, total: t.total, message: `${errLabel}，${delay / 1000}s 后重试 (${attempt + 1}/${MAX_DL_RETRIES})` })
          await new Promise(r => setTimeout(r, delay))
          if (t.state !== 'downloading') throw retryErr // 等待期间被 pause/cancel
          continue
        }
        throw retryErr
      }
    }
    renameSync(t.partPath, t.filePath)
    t.state = 'done'
    // 下载字节已在 downloadStream 的 data 事件里逐块计入 noteDownloadBytes，此处不重复累计
    emitProgress({
      taskId: t.spec.taskId,
      state: 'done',
      received: t.received,
      total: t.total || t.received,
      filePath: t.filePath
    })
    scheduleCleanupTask(t.spec.taskId, false)
  } catch (err) {
    // 经过 await 后 pauseTask / cancelTask 可能已经把 state 改了；TS narrow 看不到，强转一下
    const finalState = t.state as DownloadState
    if (finalState === 'paused') {
      // .part 保留用于续传；用 destroy 立即释放文件句柄（end() 是异步的）
      try {
        t.ws?.destroy()
      } catch {
        /* ignore */
      }
      return
    }
    if (finalState === 'cancelled') {
      // 先 destroy 释放文件句柄，再删文件
      try {
        t.ws?.destroy()
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(t.partPath)
      } catch {
        /* ignore */
      }
      scheduleCleanupTask(t.spec.taskId, false)
      // cancelTask 已 emit
      return
    }
    // 真正的下载错误
    try {
      t.ws?.destroy()
    } catch {
      /* ignore */
    }
    t.state = 'error'
    noteTaskError()
    const msg = extractErrorMessage(err, '下载失败')
    emitProgress({
      taskId: t.spec.taskId,
      state: 'error',
      received: t.received,
      total: t.total,
      message: msg.slice(0, 240)
    })
    scheduleCleanupTask(t.spec.taskId, false)
  }
}

/** 真正的 HTTP 流式下载；支持手动重定向、Range 续传、写流 backpressure。
 *  完全绕开 Chromium 网络栈：之前用 sjtuSession.fetch / net.request 都被 Chromium
 *  按 cross-origin 直接 BLOCKED_BY_CLIENT。Node 的 https 不做 CORS 也不阻拦。 */
function downloadStream(t: TaskRuntime): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // 续传探测：part 文件已存在且 size>0 → 发 Range
    let resumeFrom = 0
    try {
      const partStat = statSync(t.partPath, { throwIfNoEntry: false })
      if (partStat && partStat.size > 0) resumeFrom = partStat.size
    } catch {
      /* ignore */
    }
    t.received = resumeFrom

    let settled = false
    // Canvas 下载端点限流重试计数（429/403，仅 oc.sjtu.edu.cn 这一跳）
    let rlRetries = 0
    const fail = (e: Error): void => {
      if (settled) return
      settled = true
      try { t.ws?.destroy() } catch { /* ignore */ }
      try { t.resp?.destroy() } catch { /* ignore */ }
      reject(e)
    }
    const ok = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    t.cancel = () => {
      if (settled) return
      settled = true
      try { t.ws?.destroy() } catch { /* ignore */ }
      try { t.resp?.destroy() } catch { /* ignore */ }
      reject(new Error('cancelled'))
    }

    const fetchOnce = (url: string, depth: number): void => {
      if (depth > 5) {
        fail(new Error(`重定向过多：${depth}`))
        return
      }
      const reqStart = Date.now()  // RTT 采样：请求发起 → 响应头到达（TTFB 近似）
      let u: URL
      try {
        u = new URL(url)
      } catch {
        fail(new Error(`URL 解析失败：${url.slice(0, 120)}`))
        return
      }
      const headers: Record<string, string> = {
        Accept: '*/*',
        // CDN 校验 Referer / UA — 没带会 403。
        Referer: `${V_SJTU_ORIGIN}/jy-application-resmgr-ui/`,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      }
      if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`
      // Canvas 文件：仅在 oc.sjtu.edu.cn 这一跳注入会话 cookie + oc.sjtu Referer，
      // 让 node:https 从 /files/{id}/download 跟随 302 到 s3 预签名直链。
      // 跟随到 s3.jcloud 时不带 cookie（签名直链自包含，且避免把 Canvas cookie 泄漏给第三方域）。
      const canvasCookie = canvasCookiesByTask.get(t.spec.taskId)
      if (canvasCookie && u.hostname === CANVAS_HOST) {
        headers.Cookie = canvasCookie
        headers.Referer = `${CANVAS_BASE_URL}/`
      }
      // 好大学在线：仅对 cnmooc.sjtu.cn 及其子域（含 static.cnmooc 课件）注入会话 cookie。
      // 与 Canvas 互斥（任务来源单一），视频 CDN 直链不在 cnmooc 域 → 不注入。
      const cnmoocCookie = cnmoocCookiesByTask.get(t.spec.taskId)
      if (cnmoocCookie && isCnmoocCookieHost(u.hostname)) {
        headers.Cookie = cnmoocCookie
        headers.Referer = `${CNMOOC_BASE_URL}/`
      }

      const req = httpsRequest(
        {
          method: 'GET',
          host: u.hostname,
          port: u.port || 443,
          path: `${u.pathname}${u.search}`,
          headers
        },
        (resp: IncomingMessage) => {
          t.resp = resp
          const status = resp.statusCode || 0
          // 跟随重定向
          if (status >= 300 && status < 400 && resp.headers.location) {
            resp.resume()
            const next = new URL(resp.headers.location, url).toString()
            fetchOnce(next, depth + 1)
            return
          }

          // CDN 不支持 range：把现有 .part 丢掉重头来
          if (resumeFrom > 0 && status === 200) {
            try {
              unlinkSync(t.partPath)
            } catch {
              /* ignore */
            }
            resumeFrom = 0
            t.received = 0
          }

          if (status < 200 || status >= 300) {
            if (status === 429) noteRateLimited()  // 限流信号 → AIMD ×0.6
            // Canvas 下载端点高并发下偶发 429/403 限流，指数退避重试（仅 oc.sjtu 这一跳；
            // S3 的 403 是签名/权限永久错误，不重试）
            const isCanvasRl = (status === 429 || status === 403) && u.hostname === CANVAS_HOST
            let bodyHead = ''
            resp.on('data', (c: Buffer) => {
              if (bodyHead.length < 200) bodyHead += c.toString('utf8', 0, 200)
            })
            resp.on('end', () => {
              if (isCanvasRl && rlRetries < CANVAS_RL_MAX_RETRIES && t.state === 'downloading') {
                rlRetries++
                const raHdr = resp.headers['retry-after']
                const raStr = Array.isArray(raHdr) ? raHdr[0] : raHdr
                const delay = canvasRlBackoffMs(raStr, rlRetries)
                emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: t.received, total: t.total, message: `文件下载被限流(${status})，${Math.round(delay / 1000)}s 后重试 (${rlRetries}/${CANVAS_RL_MAX_RETRIES})` })
                setTimeout(() => {
                  if (t.state === 'downloading') fetchOnce(url, depth)
                }, delay)
                return
              }
              fail(
                new Error(
                  `HTTP ${status} ${resp.statusMessage || ''} — ${bodyHead.slice(0, 200)}`.trim()
                )
              )
            })
            // BUG FIX: missing error handler on non-200 response body stream.
            // Without this, a network error during body collection would be an unhandled
            // 'error' event on the stream, crashing the process.
            resp.on('error', fail)
            return
          }

          // RTT 采样：响应头到达（含重定向/Range 协商后的最终 2xx）
          noteRttSample(Date.now() - reqStart)

          // 计算 total
          const lenHdr = resp.headers['content-length']
          const cl = Number(Array.isArray(lenHdr) ? lenHdr[0] : lenHdr) || 0
          if (status === 206) {
            // Content-Range: bytes start-end/total
            const cr = resp.headers['content-range']
            const crStr = Array.isArray(cr) ? cr[0] : cr
            const m = crStr ? /\/(\d+)$/.exec(crStr) : null
            t.total = m ? Number(m[1]) : resumeFrom + cl || 0
          } else {
            t.total = cl
          }

          emitProgress({
            taskId: t.spec.taskId,
            state: 'downloading',
            received: t.received,
            total: t.total
          })

          const ws = createWriteStream(
            t.partPath,
            status === 206 ? { flags: 'a' } : { flags: 'w' }
          )
          t.ws = ws
          ws.on('error', fail)

          let lastEmit = 0
          resp.on('data', (chunk: Buffer) => {
            // 用户已点 pause/cancel：req.destroy 异步生效前，缓冲区里的 data 事件
            // 还会继续触发。这里直接干掉 resp，避免把刚 emit 的 paused 状态覆盖回 downloading。
            const s = t.state as DownloadState
            if (s === 'paused' || s === 'cancelled') {
              try {
                resp.destroy()
              } catch {
                /* ignore */
              }
              return
            }
            t.received += chunk.length
            noteDownloadBytes(chunk.length)
            noteDiskWrite(chunk.length)  // 本地落盘 → 磁盘 IO 指标
            if (!ws.write(chunk)) {
              resp.pause()
              ws.once('drain', () => resp.resume())
            }
            const now = Date.now()
            if (now - lastEmit > 2000) {
              lastEmit = now
              emitProgress({
                taskId: t.spec.taskId,
                state: 'downloading',
                received: t.received,
                total: t.total
              })
            }
          })
          resp.on('end', () => {
            // resp 被 cancelTask/pauseTask destroy 后仍可能触发 end；
            // 此时 ok() 会导致 runTask 误走 renameSync 干扰新 TaskRuntime
            if (!resp.destroyed) ws.end(() => ok())
          })
          resp.on('error', fail)
        }
      )
      t.req = req
      req.setTimeout(60000, () => {
        req.destroy(new Error('请求超时（60s）'))
      })
      req.on('error', fail)
      req.end()
    }

    fetchOnce(t.spec.url, 0)
  })
}

// ─── 任务级控制 ─────────────────────────────────────────────────

/** 销毁本地下载任务的活跃连接/文件流并清引用，统一 pause/cancel/quit 三处重复逻辑 */
function destroyLocalHandles(t: TaskRuntime, reason: string): void {
  try { t.resp?.destroy() } catch { /* ignore */ }
  try { t.req?.destroy(new Error(reason)) } catch { /* ignore */ }
  try { t.ws?.destroy() } catch { /* ignore */ }
  try { t.cancel?.() } catch { /* ignore */ }
  t.req = undefined
  t.resp = undefined
  t.ws = undefined
  t.cancel = undefined
}

/** 销毁云上传任务的活跃连接并清引用（uploader 由调用方按语义处理） */
function destroyCloudHandles(t: CloudTaskRuntime, reason: string): void {
  try { t.resp?.destroy() } catch { /* ignore */ }
  try { t.req?.destroy(new Error(reason)) } catch { /* ignore */ }
  // 中止在途的 COS 分片上传，否则 pause/cancel 后上传仍会把整个文件传完
  try { t.uploader?.abort() } catch { /* ignore */ }
  try { t.cancel?.() } catch { /* ignore */ }
  t.req = undefined
  t.resp = undefined
  t.cancel = undefined
}

/** Canvas 任务 courseName 带 'Canvas课程/' 前缀，落盘/云端路径要剥掉避免重复 */
function effectiveCourseName(spec: DownloadTaskSpec): string {
  const raw = isCanvasSpec(spec) && spec.courseName.startsWith('Canvas课程/')
    ? spec.courseName.slice('Canvas课程/'.length)
    : spec.courseName
  return spec.term ? `${sanitizeFsName(spec.term)}/${raw}` : raw
}

/** 按需解析直链（Canvas 签名 URL + vod-info），runTask 与 cloudRunTask 共用。
 *  await 期间检查 cancel 竞态（统一了两处重复逻辑，并补上 runTask 原先缺失的 cancel 守卫）。
 *  返回 true=可继续下载，false=已被取消或解析失败（调用方直接 return）。 */
async function resolveDirectUrl(
  t: { spec: DownloadTaskSpec; state: DownloadState; total: number; filePath?: string; partPath?: string },
  isCloud: boolean
): Promise<boolean> {
  const src = (t.spec as CanvasDownloadTaskSpec).source

  // Canvas modules/syllabus 文件：先按 fileId 取文件元数据拿到 /files/{id}/download 链接
  if (src === 'canvas-modules' || src === 'canvas-syllabus') {
    const parts = t.spec.taskId.split('_')
    const fileId = Number(parts[parts.length - 1])
    if (fileId > 0) {
      if (t.state !== 'cancelled') {
        t.state = 'downloading'
        emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: 0, total: 0, message: '获取文件链接…' })
      }
      try {
        const meta = await fetchFileMeta(sjtuSession(), fileId)
        if (meta?.url) {
          t.spec.url = meta.url
          if (!t.spec.fileName) t.spec.fileName = meta.displayName
          if (meta.size > 0) t.total = meta.size
        } else {
          throw new Error('无法获取文件链接')
        }
      } catch (err) {
        if (t.state === 'cancelled') return false
        t.state = 'error'
        noteTaskError()
        const msg = err instanceof Error ? err.message : String(err)
        emitProgress({ taskId: t.spec.taskId, state: 'error', received: 0, total: 0, message: msg.slice(0, 240) })
        scheduleCleanupTask(t.spec.taskId, isCloud)
        return false
      }
    }
  }

  // canvas-files：url 可能在 resume 时被清空（reEnqueueLocal/Cloud 强制重解析），
  // 按 fileId 重建 /files/{id}/download 端点。
  if (src === 'canvas-files' && !t.spec.url) {
    const parts = t.spec.taskId.split('_')
    const fileId = Number(parts[parts.length - 1])
    if (fileId > 0) {
      t.spec.url = `${CANVAS_BASE_URL}/files/${fileId}/download?download_frd=1`
    }
  }

  // Canvas 文件（files / modules / syllabus）：t.spec.url 现在是 /files/{id}/download
  // 这个 HTML 端点。下载引擎用裸 node:https 不带 cookie，直接下载会被 302 到
  // /login/canvas（拿到 HTML 登录页存成课件 → 全部损坏）。
  // 这里把 Canvas 会话 cookie 取出来存进 canvasCookiesByTask，由 downloadStream /
  // cloudDownloadAndUpload 在发请求时注入 Cookie 头；node:https 的 fetchOnce 本就
  // 会手动跟随 302，带上 cookie 后能从 /files/{id}/download 跳到 s3.jcloud 预签名
  // 直链并直接下载，无需单独的 ses.fetch 解析步骤（那样会顺带下载文件体、cancel
  // 又无法可靠中止 S3 流，并发时幽灵下载会把真正的 node:https 下载拖死）。
  // 附带好处：HTML 端点每次访问都签发新 URL，暂停数小时后 resume 也不会因签名过期失败。
  if (
    (src === 'canvas-files' || src === 'canvas-modules' || src === 'canvas-syllabus') &&
    /\/files\/\d+\/download/.test(t.spec.url)
  ) {
    try {
      const cookies = await sjtuSession().cookies.get({ url: CANVAS_BASE_URL })
      const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
      if (!cookieHeader) throw new Error('Canvas 会话 cookie 为空，请重新登录后重试')
      canvasCookiesByTask.set(t.spec.taskId, cookieHeader)
    } catch (err) {
      if (t.state === 'cancelled') return false
      t.state = 'error'
      noteTaskError()
      const msg = err instanceof Error ? err.message : String(err)
      emitProgress({ taskId: t.spec.taskId, state: 'error', received: 0, total: 0, message: msg.slice(0, 240) })
      scheduleCleanupTask(t.spec.taskId, isCloud)
      return false
    }
  }

  // 好大学在线 (cnmooc)：注入会话 cookie（视频/课件直链下载用），url 为空时懒解析直链。
  // 扫描阶段不预探直链（用户选择「仅下载时懒解析」），build-specs 产 url:'' 占位 spec；
  // 此处逐任务 POST play.mooc+detail.mooc 取直链，按 cnmoocResourceFilter 过滤，并补全扩展名。
  // pause/resume 或 error 重试时 url 被清空（reEnqueueLocal/Cloud），会重新解析（防直链过期）。
  if (src === 'cnmooc') {
    // 注入 cnmooc 会话 cookie（无论 url 是否已填，下载请求都需要）
    try {
      const cookies = await sjtuSession().cookies.get({ url: CNMOOC_BASE_URL })
      const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
      if (cookieHeader) cnmoocCookiesByTask.set(t.spec.taskId, cookieHeader)
    } catch {
      /* cookie 拉取失败不致命：视频 CDN 直链可能本就不需要 cookie */
    }

    // 懒解析直链（url 已填则跳过）
    if (!t.spec.url) {
      const cs = t.spec as CanvasDownloadTaskSpec
      if (cs.cnmoocItemId) {
        if (t.state !== 'cancelled') {
          t.state = 'downloading'
          emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: 0, total: 0, message: '解析资源直链…' })
        }
        try {
          const r = await fetchCnmoocResourceUrl(sjtuSession(), {
            itemId: cs.cnmoocItemId,
            itemType: cs.cnmoocItemType ?? '10',
            title: t.spec.fileName
          })
          if (t.state === 'cancelled') return false
          if (!r?.url) throw new Error('未获取到资源直链')

          // 资源类型过滤：仅视频/仅课件时不匹配则标 skipped
          const filter = cs.cnmoocResourceFilter
          if (filter && filter !== 'all' && r.type !== filter) {
            t.state = 'skipped'
            emitProgress({
              taskId: t.spec.taskId,
              state: 'skipped',
              received: 0,
              total: 0,
              message: filter === 'video' ? '已按筛选条件跳过（仅视频）' : '已按筛选条件跳过（仅课件）'
            })
            scheduleCleanupTask(t.spec.taskId, isCloud)
            return false
          }

          t.spec.url = r.url

          // 补全扩展名：扫描阶段 fileName 无扩展名，按直链推断补上（.mp4/.pdf 等）。
          // 本地任务同步更新 filePath/partPath（download:start 时按无扩展名 fileName 算的）；
          // 云端无 filePath，cloudRemotePath 用更新后的 fileName 自动生效。
          const ext = inferCnmoocExt(r.url)
          if (ext && !t.spec.fileName.toLowerCase().endsWith(ext.toLowerCase())) {
            t.spec.fileName = t.spec.fileName + ext
            if (t.filePath && !t.filePath.toLowerCase().endsWith(ext.toLowerCase())) {
              t.filePath = t.filePath + ext
              t.partPath = t.filePath + '.part'
            }
          }
        } catch (err) {
          if (t.state === 'cancelled') return false
          t.state = 'error'
          noteTaskError()
          const msg = err instanceof Error ? err.message : String(err)
          emitProgress({ taskId: t.spec.taskId, state: 'error', received: 0, total: 0, message: msg.slice(0, 240) })
          scheduleCleanupTask(t.spec.taskId, isCloud)
          return false
        }
      }
    }
  }

  if (t.spec.url) return true

  // Canvas 课堂视频：按 videoId 解析流直链（带缓存，同 videoId 教师+PPT 共享一次解析）
  if (src === 'canvas-class-video') {
    const cs = t.spec as CanvasDownloadTaskSpec
    if (cs.canvasVideoId && cs.canvasVideoToken) {
      if (t.state !== 'cancelled') {
        t.state = 'downloading'
        emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: 0, total: 0, message: '解析视频流…' })
      }
      try {
        const channels = await getVodChannelsCached(sjtuSession(), cs.canvasVideoToken, cs.canvasVideoId)
        const ch = channels[cs.canvasStreamIdx ?? 0]
        if (!ch?.url) throw new Error(`未找到该路视频流（streamIdx=${cs.canvasStreamIdx ?? 0}）`)
        t.spec.url = ch.url
      } catch (err) {
        if (t.state === 'cancelled') return false
        t.state = 'error'
        noteTaskError()
        const msg = err instanceof Error ? err.message : String(err)
        emitProgress({ taskId: t.spec.taskId, state: 'error', received: 0, total: 0, message: msg.slice(0, 240) })
        scheduleCleanupTask(t.spec.taskId, isCloud)
        return false
      }
    }
  }

  // ExternalTool 模块视频：v.sjtu LTI（课程级 token 缓存）→ /file/{fileId} → S3 MP4 直链。
  // token 是课程级的，任选一个 ExternalTool 模块项跳转即服务全课所有 fileId，24h 内复用。
  // S3 直链（etv.sjtu.edu.cn）自包含签名，downloadStream 不需注入 cookie。
  if (src === 'canvas-exttool-video' && !t.spec.url) {
    const cs = t.spec as CanvasDownloadTaskSpec
    if (cs.canvasFileId && cs.canvasCourseId && cs.canvasModuleItemId) {
      if (t.state !== 'cancelled') {
        t.state = 'downloading'
        emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: 0, total: 0, message: 'LTI 解析视频…' })
      }
      try {
        const token = await getExtToolToken(sjtuSession(), cs.canvasCourseId, cs.canvasModuleItemId)
        const vod = await fetchExtToolVodUrl(sjtuSession(), cs.canvasCourseId, cs.canvasFileId, token)
        if (!vod.url) throw new Error('未获取到视频直链')
        t.spec.url = vod.url
        if (vod.fileSize > 0) t.total = vod.fileSize
      } catch (err) {
        if (t.state === 'cancelled') return false
        const msg = err instanceof Error ? err.message : String(err)
        // token 失效：fetchExtToolVodUrl 已清缓存，重试一次（重新 LTI 跳转换新 token）
        if (/登录信息无效|未登录|过期|无效的token|token已失效/.test(msg)) {
          try {
            const token2 = await getExtToolToken(sjtuSession(), cs.canvasCourseId, cs.canvasModuleItemId)
            const vod2 = await fetchExtToolVodUrl(sjtuSession(), cs.canvasCourseId, cs.canvasFileId, token2)
            if (vod2.url) {
              t.spec.url = vod2.url
              if (vod2.fileSize > 0) t.total = vod2.fileSize
            } else { throw new Error('重试仍未获取到视频直链') }
          } catch { /* 重试也失败，走下面的 error 路径 */ }
        }
        if (!t.spec.url) {
          t.state = 'error'
          noteTaskError()
          emitProgress({ taskId: t.spec.taskId, state: 'error', received: 0, total: 0, message: msg.slice(0, 240) })
          scheduleCleanupTask(t.spec.taskId, isCloud)
          return false
        }
      }
    }
  }

  // ExternalUrl 模块视频：vshare /api/video/play/{uuid}（带 vshare cookie）→ S3 MP4 直链。
  // vshare 经 jAccount SSO 登录，ses 已有 cookie；S3 直链自包含签名。
  if (src === 'canvas-exturl-video' && !t.spec.url) {
    const cs = t.spec as CanvasDownloadTaskSpec
    if (cs.canvasVshareUuid) {
      if (t.state !== 'cancelled') {
        t.state = 'downloading'
        emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: 0, total: 0, message: '解析 vshare 视频…' })
      }
      try {
        const vod = await fetchVsharePlayUrl(sjtuSession(), cs.canvasVshareUuid)
        if (!vod.url) throw new Error('未获取到视频直链')
        t.spec.url = vod.url
        if (vod.fileSize > 0) t.total = vod.fileSize
      } catch (err) {
        if (t.state === 'cancelled') return false
        t.state = 'error'
        noteTaskError()
        const msg = err instanceof Error ? err.message : String(err)
        emitProgress({ taskId: t.spec.taskId, state: 'error', received: 0, total: 0, message: msg.slice(0, 240) })
        scheduleCleanupTask(t.spec.taskId, isCloud)
        return false
      }
    }
  }

  if (!t.spec.url && t.spec.refId != null) {
    if (t.state !== 'cancelled') {
      t.state = 'downloading'
      emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: 0, total: 0, message: '解析直链…' })
    }
    try {
      const env = await vsjtuFetch(`${V_SJTU_API.vodInfoByCourseId}?courseId=${encodeURIComponent(t.spec.refId)}`) as { success?: boolean; message?: string; data?: VodInfoData }
      if (!env?.success) throw new Error(String(env?.message || '直链获取失败'))
      const data = env.data
      let found = false
      for (const info of data?.videoInfos ?? []) {
        if (info.angle === (t.spec.angle ?? 0)) {
          const url = info.extendPlayUrls?.[0]
          if (url) { t.spec.url = url; found = true }
          break
        }
      }
      if (!found) throw new Error(`该课次没有视角 ${t.spec.angle} 视频`)
    } catch (err) {
      if (t.state === 'cancelled') return false
      t.state = 'error'
      noteTaskError()
      const msg = err instanceof Error ? err.message : String(err)
      emitProgress({ taskId: t.spec.taskId, state: 'error', received: 0, total: 0, message: msg.slice(0, 240) })
      scheduleCleanupTask(t.spec.taskId, isCloud)
      return false
    }
  }

  // 被 pause/cancel 则中止（await 期间用户可能点了暂停/取消）
  return t.state !== 'paused' && t.state !== 'cancelled'
}

/** 从 spec 数组移除指定 taskId 的项 */
function removeFromSpecArray<T extends { spec?: DownloadTaskSpec } | DownloadTaskSpec>(
  arr: T[], taskId: string
): T | undefined {
  const i = arr.findIndex(item => ('spec' in item ? item.spec?.taskId : (item as DownloadTaskSpec).taskId) === taskId)
  if (i < 0) return undefined
  return arr.splice(i, 1)[0]
}

/** 把一个 paused 的本地 spec 重新入待处理队列（resume 用） */
function reEnqueueLocal(p: PendingSpec): void {
  // [Bug Fix] 清掉已解析的直链，强制 resolveDirectUrl 重新解析。
  // Canvas 签名 URL / vod 流直链都有 TTL，任务暂停数小时或出错后恢复时，
  // 旧 url 往往已 403；若不清空，resolveDirectUrl 见 t.spec.url 非空直接 return，
  // 导致恢复后立即再次失败、永久卡在 error。
  p.spec.url = ''
  pendingLocal.push(p)
  pendingLocalIds.add(p.spec.taskId)
  pausedLocalIds.delete(p.spec.taskId)
  if (autoConcurrency) startAutoConcurrency()
  emitProgress({ taskId: p.spec.taskId, state: 'pending', received: 0, total: 0 })
}
/** 把一个 paused 的云端 spec 重新入待处理队列（resume 用） */
function reEnqueueCloud(spec: DownloadTaskSpec): void {
  // [Bug Fix] 同 reEnqueueLocal：清掉过期直链，cloudRunTask 会重新解析。
  spec.url = ''
  pendingCloud.push(spec)
  pendingCloudIds.add(spec.taskId)
  pausedCloudIds.delete(spec.taskId)
  if (autoConcurrency) startAutoConcurrency()
  emitProgress({ taskId: spec.taskId, state: 'pending', received: 0, total: 0 })
}

/** 暂停核心：活跃任务销毁句柄；pending 任务移到 pausedLocal。不调度 */
function pauseTaskCore(id: string): void {
  // 已 materialize 的活跃/错误任务
  const t = tasks.get(id)
  if (t) {
    if (t.state !== 'downloading' && t.state !== 'pending' && t.state !== 'error') return
    const wasActive = active.has(id)
    t.state = 'paused'
    active.delete(id)
    emitProgress({ taskId: id, state: 'paused', received: t.received, total: t.total, message: '已暂停' })
    if (wasActive) {
      destroyLocalHandles(t, 'paused')
    }
    // 把 spec 移入 pausedLocal 待 resume（保留 filePath/partPath）
    pausedLocal.push({ spec: t.spec, filePath: t.filePath, partPath: t.partPath })
    pausedLocalIds.add(id)
    // paused 的 TaskRuntime 立即清理（spec 已转移到 pausedLocal）
    tasks.delete(id)
    return
  }
  // 还在 pendingLocal（没轮到下载）→ 移到 pausedLocal
  const p = removeFromSpecArray(pendingLocal, id)
  if (p) {
    emitProgress({ taskId: id, state: 'paused', received: 0, total: 0, message: '已暂停' })
    pausedLocal.push(p)
    pendingLocalIds.delete(id)
    pausedLocalIds.add(id)
  }
}

function pauseTask(id: string): void {
  pauseTaskCore(id)
  scheduleNext()
}

/** 取消核心：活跃任务销毁句柄/删 .part；pending/paused 任务从队列移除。不调度 */
function cancelTaskCore(id: string): void {
  const t = tasks.get(id)
  if (t) {
    if (t.state === 'done' || t.state === 'cancelled' || t.state === 'skipped') return
    const wasActive = active.has(id)
    t.state = 'cancelled'
    active.delete(id)
    emitProgress({ taskId: id, state: 'cancelled', received: t.received, total: t.total, message: '已取消' })
    if (wasActive) {
      destroyLocalHandles(t, 'cancelled')
    } else {
      try { unlinkSync(t.partPath) } catch { /* ignore */ }
    }
    tasks.delete(id)
    return
  }
  // pending 或 paused 队列里 → 移除
  const foundPending = removeFromSpecArray(pendingLocal, id)
  const foundPaused = removeFromSpecArray(pausedLocal, id)
  if (foundPending || foundPaused) {
    emitProgress({ taskId: id, state: 'cancelled', received: 0, total: 0, message: '已取消' })
    pendingLocalIds.delete(id)
    pausedLocalIds.delete(id)
  }
}

function cancelTask(id: string): void {
  cancelTaskCore(id)
  scheduleNext()
}

function resumeTask(id: string): void {
  // paused 队列里的 spec → 放回 pending
  const p = removeFromSpecArray(pausedLocal, id)
  if (p) {
    reEnqueueLocal(p)
    scheduleNext()
    return
  }
  // 已 materialize 但处于 error 的任务 → 重新入队
  const t = tasks.get(id)
  if (t && t.state === 'error') {
    reEnqueueLocal({ spec: t.spec, filePath: t.filePath, partPath: t.partPath })
    tasks.delete(id)
    scheduleNext()
  }
}

function pauseAll(): void {
  for (const id of [...tasks.keys()]) pauseTaskCore(id)
  // pendingLocal 全部移到 pausedLocal
  for (const p of pendingLocal) {
    emitProgress({ taskId: p.spec.taskId, state: 'paused', received: 0, total: 0, message: '已暂停' })
    pausedLocal.push(p)
    pausedLocalIds.add(p.spec.taskId)
  }
  pendingLocal.length = 0
  pendingLocalIds.clear()
  scheduleNext()
}
function cancelAll(): void {
  for (const id of [...tasks.keys()]) cancelTaskCore(id)
  for (const p of pendingLocal) {
    emitProgress({ taskId: p.spec.taskId, state: 'cancelled', received: 0, total: 0, message: '已取消' })
  }
  pendingLocal.length = 0
  pendingLocalIds.clear()
  for (const p of pausedLocal) {
    emitProgress({ taskId: p.spec.taskId, state: 'cancelled', received: 0, total: 0, message: '已取消' })
  }
  pausedLocal.length = 0
  pausedLocalIds.clear()
  scheduleNext()
}
function resumeAll(): void {
  // pausedLocal 全部放回 pendingLocal
  const paused = pausedLocal.splice(0)
  pausedLocalIds.clear()
  for (const p of paused) reEnqueueLocal(p)
  // error 态的 materialized 任务也恢复
  for (const [id, t] of tasks) {
    if (t.state === 'error') {
      reEnqueueLocal({ spec: t.spec, filePath: t.filePath, partPath: t.partPath })
      tasks.delete(id)
    }
  }
  scheduleNext()
}

// ─────────────────────────────────────────────────────────────
// 云盘上传：从 v.sjtu CDN 边下载边分片上传到交大云盘
// ─────────────────────────────────────────────────────────────

const CHUNK_SIZE = 4 * 1024 * 1024 // 4 MB per COS part
const MAX_BUFFER_CHUNKS = 2 // 内存中最多缓冲 2 个 4MB 块 → 8MB
const CLOUD_ROOT_FOLDER = 'SJTU旁听课程'
const CLOUD_CANVAS_ROOT_FOLDER = 'SJTU Canvas课程'
const CLOUD_CNMOOC_ROOT_FOLDER = 'SJTU好大学在线'
/** 好大学在线本地下载子目录名（destRoot 之下） */
const CNMOOC_LOCAL_DIR = '好大学在线'

/** 判断是否为 Canvas 任务 */
function isCanvasSpec(spec: DownloadTaskSpec): boolean {
  return !!(spec as CanvasDownloadTaskSpec).source?.startsWith?.('canvas')
}

/** 判断是否为好大学在线 (cnmooc) 任务 */
function isCnmoocSpec(spec: DownloadTaskSpec): boolean {
  return (spec as CanvasDownloadTaskSpec).source === 'cnmooc'
}

/** 提取错误消息字符串，统一处理 unknown 类型的 error 入参 */
function extractErrorMessage(err: unknown, fallback = '未知错误'): string {
  return err instanceof Error ? err.message : String(err || fallback)
}

interface CloudTaskRuntime {
  spec: DownloadTaskSpec
  state: DownloadState
  received: number
  total: number
  req?: ClientRequest
  resp?: IncomingMessage
  uploader?: ChunkedUploader
  /** 暂停时保存的 COS 会话状态，恢复时用于断点续传 */
  uploaderState?: UploadSessionState
  /** pause/cancel 时调用，强制 settle cloudDownloadAndUpload 的 Promise */
  cancel?: () => void
}

const cloudTasks = new Map<string, CloudTaskRuntime>()
const cloudActive = new Set<string>()

// ─── 云盘全量重试（网络瞬断兜底） ─────────────────────────────
//
// cloudDownloadAndUpload 内部已有分片/confirm 级重试；若仍失败（持续超时/断流），
// 不直接标 error 终止，而是把任务重新塞回 pendingCloud 排队、丢弃旧 COS 会话从头再来，
// 给网络恢复的时间。最多全量重试 CLOUD_MAX_FULL_RETRIES 次，仍失败才真正报错。
const cloudFullRetries = new Map<string, number>()
const CLOUD_MAX_FULL_RETRIES = 3

/** 判定云盘上传错误是否值得全量重试（网络/超时/服务端临时错误）。
 *  4xx 鉴权类（401/403）、会话逻辑错误不重试 —— 重试也无益。 */
function isTransientCloudError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '')
  if (/timeout|aborted|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/i.test(msg)) return true
  if (/HTTP 5\d\d/.test(msg)) return true
  if (/MultipartUploadIncomplete/i.test(msg)) return true
  return false
}

function cloudScheduleNext(): void {
  if (isQuitting) return
  while (sharedActiveCount() < concurrency && pendingCloud.length > 0) {
    // 网络不佳时暂停拉取新任务，让活跃任务优先重试
    if (!isNetworkHealthy()) {
      if (!networkResumeTimer) {
        networkResumeTimer = setTimeout(() => {
          networkResumeTimer = undefined
          networkErrorStreak = 0
          scheduleNext()
          cloudScheduleNext()
        }, NETWORK_BACKOFF_MS)
      }
      break
    }
    // 惰性 materialization：临下载才从 pendingCloud 取 spec 建 CloudTaskRuntime
    const spec = pendingCloud.shift()!
    pendingCloudIds.delete(spec.taskId)
    const existing = cloudTasks.get(spec.taskId)
    if (existing && (existing.state === 'pending' || existing.state === 'downloading' || existing.state === 'paused')) {
      continue
    }
    const t: CloudTaskRuntime = { spec, state: 'pending', received: 0, total: 0 }
    cloudTasks.set(spec.taskId, t)
    cloudActive.add(spec.taskId)
    void cloudRunTask(t).finally(() => {
      cloudActive.delete(spec.taskId)
      t.req = undefined
      t.resp = undefined
      t.uploader = undefined
      // 喂入 AIMD 错误率指标：仅计入真正发生传输的尝试（排除 paused/cancelled/skipped）
      const fs = t.state as DownloadState
      if (fs === 'done') noteTaskResult(true)
      else if (fs === 'error') noteTaskResult(false)
      notifyConcurrencySlotAvailable()
      cloudScheduleNext()
      onTaskCompleted()  // 事件驱动并发探测
    })
  }
}

/** 根据任务 spec 计算云盘远端路径 */
function cloudRemotePath(spec: DownloadTaskSpec): string {
  const root = isCnmoocSpec(spec) ? CLOUD_CNMOOC_ROOT_FOLDER
    : isCanvasSpec(spec) ? CLOUD_CANVAS_ROOT_FOLDER
    : CLOUD_ROOT_FOLDER
  // 逐段 sanitize，保留目录层级（Canvas courseName 的 "Canvas课程/" 前缀由 effectiveCourseName 剥掉）
  return [root, ...effectiveCourseName(spec).split('/'), spec.fileName]
    .map(sanitizeFsName)
    .join('/')
}

/** 计算 ensureFolderPath 的参数列表（逐级创建文件夹） */
function cloudFolderSegments(spec: DownloadTaskSpec): string[] {
  const root = isCnmoocSpec(spec) ? CLOUD_CNMOOC_ROOT_FOLDER
    : isCanvasSpec(spec) ? CLOUD_CANVAS_ROOT_FOLDER
    : CLOUD_ROOT_FOLDER
  return [root, ...effectiveCourseName(spec).split('/').map(sanitizeFsName)]
}

async function cloudRunTask(t: CloudTaskRuntime): Promise<void> {
  t.state = 'downloading'

  // 恢复 pause 时保存的 COS 会话状态（惰性模型下 uploaderState 不随 spec 传输，存于 cloudPausedStates）
  if (!t.uploaderState) {
    const saved = cloudPausedStates.get(t.spec.taskId)
    if (saved) {
      t.uploaderState = saved
      cloudPausedStates.delete(t.spec.taskId)
    }
  }

  // 按需解析直链（lazy resolution，与 runTask 共用；含 cancel 竞态守卫）
  if (!await resolveDirectUrl(t, true)) return

  // 替换模式：上传前先删除云盘上已存在的同名文件，避免 startChunkedUpload
  // 的 HEAD 检查抛 FileExistsError。断点续传（uploaderState 非空）时跳过——
  // 那是上次未完成的上传，应继续而非删了重来。
  const strategy = conflictStrategyByTask.get(t.spec.taskId) ?? 'skip'
  if (strategy === 'overwrite' && !t.uploaderState && t.spec.cloudUserToken) {
    try {
      await deleteCloudFile(t.spec.cloudUserToken, cloudRemotePath(t.spec))
    } catch (err) {
      // 删除失败不致命：仍尝试上传，由 startChunkedUpload 的冲突判定兜底
      console.warn('[cloudpan] 替换模式删除旧文件失败，继续尝试上传:', sanitizeForLog(err instanceof Error ? err.message : err))
    }
  }

  // 断点续传：已传分片对应的 CDN 字节偏移
  const resumeFromByte = t.uploaderState
    ? (t.uploaderState.nextPart - 1) * CHUNK_SIZE
    : 0
  // 启动期间（resolveDirectUrl / deleteCloudFile 的 await）用户可能点了暂停/取消：
  // 此时 t.cancel 尚未挂载（在 cloudDownloadAndUpload 内才设置），destroyCloudHandles
  // 无法中止。这里显式检查状态，避免暂停后又把 CDN 拉流和 COS 上传会话建起来。
  if ((t.state as DownloadState) === 'paused' || (t.state as DownloadState) === 'cancelled') return
  emitProgress({
    taskId: t.spec.taskId,
    state: 'downloading',
    received: resumeFromByte,
    total: t.total
  })

  try {
    await cloudDownloadAndUpload(t, resumeFromByte)
    if ((t.state as DownloadState) === 'cancelled') return
    t.state = 'done'
    t.uploaderState = undefined
    cloudPausedStates.delete(t.spec.taskId)
    cloudFullRetries.delete(t.spec.taskId)  // 成功 → 清掉全量重试计数
    // CDN 下载字节已在 cloudDownloadAndUpload 的 data 事件里逐块计入 noteDownloadBytes，此处不重复累计
    emitProgress({
      taskId: t.spec.taskId,
      state: 'done',
      received: t.received,
      total: t.total || t.received
    })
    scheduleCleanupTask(t.spec.taskId, true)
  } catch (err) {
    const finalState = t.state as DownloadState
    if (finalState === 'paused' || finalState === 'cancelled') return
    if (err instanceof FileExistsError) {
      t.state = 'skipped'
      cloudFullRetries.delete(t.spec.taskId)
      emitProgress({
        taskId: t.spec.taskId,
        state: 'skipped',
        received: 0,
        total: 0,
        message: '云盘已存在，跳过'
      })
      scheduleCleanupTask(t.spec.taskId, true)
      return
    }

    // [网络鲁棒性] 瞬时网络错误（超时/断流/5xx/分片未整合）且未超全量重试上限 →
    // 丢弃旧 COS 会话、从头重新入队，给网络恢复时间，而非直接报错终止。
    const retries = cloudFullRetries.get(t.spec.taskId) ?? 0
    if (!isQuitting && isTransientCloudError(err) && retries < CLOUD_MAX_FULL_RETRIES) {
      cloudFullRetries.set(t.spec.taskId, retries + 1)
      noteNetworkError()  // 喂入网络健康门，触发 30s 冷却再拉新任务
      // 丢弃旧上传会话（可能已损坏），下次从头建新会话
      t.uploaderState = undefined
      cloudPausedStates.delete(t.spec.taskId)
      // 从 cloudTasks 移除旧 runtime，让 cloudScheduleNext 重新物化出干净的 runtime
      cloudTasks.delete(t.spec.taskId)
      // 重新入待处理队列
      pendingCloud.push(t.spec)
      pendingCloudIds.add(t.spec.taskId)
      const msg = err instanceof Error ? err.message : String(err)
      emitProgress({
        taskId: t.spec.taskId,
        state: 'pending',
        received: 0,
        total: 0,
        message: `网络中断（${msg.slice(0, 60)}），重新排队重试 (${retries + 1}/${CLOUD_MAX_FULL_RETRIES})`
      })
      // 不调 scheduleCleanupTask —— 任务仍在（换了 runtime）。
      // finally 会 cloudScheduleNext() 把它重新拉起；网络不健康时由 30s 冷却门兜底等待。
      return
    }

    t.state = 'error'
    noteTaskError()
    cloudFullRetries.delete(t.spec.taskId)  // 到此为永久失败，清计数
    if (t.uploader) {
      t.uploaderState = t.uploader.getState()
    }
    const msg = err instanceof Error ? err.message : String(err || '上传失败')
    emitProgress({
      taskId: t.spec.taskId,
      state: 'error',
      received: t.received,
      total: t.total,
      message: retries >= CLOUD_MAX_FULL_RETRIES
        ? `重试 ${CLOUD_MAX_FULL_RETRIES} 次仍失败：${msg.slice(0, 180)}`
        : msg.slice(0, 240)
    })
    scheduleCleanupTask(t.spec.taskId, true)
  }
}

/** 从 CDN 流式下载视频，每积满 4MB 就上传一个 COS 分片。
 *  resumeFromByte > 0 时发送 Range header 断点续传。
 *  uploader 是外层闭包变量，CDN 200 回退时可就地替换，避免旧 handler 引用过期 session。 */
function cloudDownloadAndUpload(t: CloudTaskRuntime, resumeFromByte: number): Promise<void> {
  const userToken = t.spec.cloudUserToken
  if (!userToken) return Promise.reject(new Error('cloudUserToken is required'))

  return new Promise<void>((resolve, reject) => {
    let settled = false
    const fail = (e: Error): void => {
      if (settled) return
      settled = true
      reject(e)
    }
    const ok = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    t.cancel = () => {
      if (settled) return
      settled = true
      reject(new Error('cancelled'))
    }

    const remotePath = cloudRemotePath(t.spec)
    const startUrl = t.spec.url

    // 外层闭包变量：所有 handler 通过引用访问，CDN 200 回退时就地替换
    let uploader: ChunkedUploader
    let activeReq: ClientRequest | undefined
    let activeResp: IncomingMessage | undefined
    let retryCount = 0
    const MAX_RETRIES = 3
    // Canvas 下载端点限流重试计数（429/403，仅 oc.sjtu.edu.cn 这一跳）
    let rlRetries = 0

    const doFetch = (): void => {
      // 按块收集，仅在拼满 CHUNK_SIZE 时才 Buffer.concat，避免 O(n²) 逐块复制
      let chunks: Buffer[] = []
      let chunksLen = 0
      let uploading = false
      let ended = false
      let timedOut = false  // 防止 timeout + error 双重重试

      // 串行上传：同一时刻只有一个分片在传（含末尾 confirm）。
      // [Bug Fix] 原 flushToUpload 未检查 uploading，数据到达快时多个分片并发上传，
      // 并发 uploadChunk 会竞争共享的 parts/expiration 凭证状态（renewWithRetry 就地重写），
      // 导致取到过期/缺失凭证 → COS PUT 400 → 最终 confirm 报 MultipartUploadIncomplete。
      // 网络越差上传越慢、缓冲堆积越多、并发竞争越频繁，故"网络不好时上传末段 400"。
      // 串行化后凭证不再竞争；.then 回调里递归调用本函数排空后续分片或触发 confirm。
      const tryUploadNext = (): void => {
        if (settled) return  // 已 pause/cancel/完成 → 不再启动新的分片上传或 confirm
        if (uploading) return
        // resp 已结束且无残留 → 全部分片已上传，confirm 收尾
        if (ended && chunksLen === 0) {
          uploading = true
          void uploader.confirm().then(ok).catch(fail)
          return
        }
        // 攒满一片，或已结束但还有不足一片的尾段 → 上传
        if (chunksLen >= CHUNK_SIZE || (ended && chunksLen > 0)) {
          const sendBuf = Buffer.concat(chunks)
          chunks = []
          chunksLen = 0
          const uploadBuf = sendBuf.subarray(0, CHUNK_SIZE)
          const remainder = sendBuf.subarray(CHUNK_SIZE)
          if (remainder.length > 0) {
            chunks.push(remainder)
            chunksLen = remainder.length
          }
          uploading = true
          const upStart = Date.now()  // 上传 RTT 采样起点
          void uploader.uploadChunk(uploadBuf).then(() => {
            // 上传字节计入速度指标 + 上传 RTT 样本
            noteUploadBytes(uploadBuf.length)
            noteRttSample(Date.now() - upStart)
            uploading = false
            // [Bug Fix] 一片上传成功即重置 CDN 拉流重试计数。
            // 原 retryCount 作用于整个 cloudDownloadAndUpload，长任务累计 3 次独立
            // 网络抖动（即便每次都恢复）就会整体 fail，把传到 99% 的大文件放弃掉。
            // 按"成功推进即清零"的滑动口径，只有连续失败才计入上限。
            retryCount = 0
            // 背压解除：缓冲降下来后恢复 CDN 拉流
            if (!ended && chunksLen < CHUNK_SIZE * MAX_BUFFER_CHUNKS && activeResp) {
              try { activeResp.resume() } catch { /* ignore */ }
            }
            tryUploadNext()  // 排空下一片，或进入 confirm
          }).catch((e: Error) => {
            // COS 429 限流 → 喂入 AIMD 重度拥塞信号
            if (e?.message?.includes('429')) noteRateLimited()
            fail(e)
          })
        }
        // 否则：数据不足一片且未结束，等待更多 data 到达
      }

      const fetchOnce = (url: string, depth: number): void => {
        if (depth > 5) { fail(new Error(`重定向过多：${depth}`)); return }
        const reqStart = Date.now()  // RTT 采样：请求发起 → 响应头到达
        let u: URL
        try { u = new URL(url) } catch { fail(new Error(`URL 解析失败：${url.slice(0, 120)}`)); return }

        const cdnOffset = uploader.bytesReceived
        const headers: Record<string, string> = {
          Accept: '*/*',
          Referer: `${V_SJTU_ORIGIN}/jy-application-resmgr-ui/`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
        }
        if (cdnOffset > 0) headers.Range = `bytes=${cdnOffset}-`
        // Canvas 文件：仅在 oc.sjtu.edu.cn 这一跳注入会话 cookie + oc.sjtu Referer，
        // 让 node:https 从 /files/{id}/download 跟随 302 到 s3 预签名直链后流式上传到云盘。
        // 跟随到 s3.jcloud 时不带 cookie（签名直链自包含，避免泄漏 Canvas cookie 给第三方域）。
        const canvasCookie = canvasCookiesByTask.get(t.spec.taskId)
        if (canvasCookie && u.hostname === CANVAS_HOST) {
          headers.Cookie = canvasCookie
          headers.Referer = `${CANVAS_BASE_URL}/`
        }
        // 好大学在线：仅对 cnmooc.sjtu.cn 及其子域注入会话 cookie（与 Canvas 互斥）。
        const cnmoocCookie = cnmoocCookiesByTask.get(t.spec.taskId)
        if (cnmoocCookie && isCnmoocCookieHost(u.hostname)) {
          headers.Cookie = cnmoocCookie
          headers.Referer = `${CNMOOC_BASE_URL}/`
        }

        const req = httpsRequest(
          {
            method: 'GET',
            host: u.hostname,
            port: u.port || 443,
            path: `${u.pathname}${u.search}`,
            headers
          },
          (resp: IncomingMessage) => {
            activeResp = resp
            t.resp = resp
            const status = resp.statusCode || 0

            if (status >= 300 && status < 400 && resp.headers.location) {
              resp.resume()
              fetchOnce(new URL(resp.headers.location, url).toString(), depth + 1)
              return
            }

            if (status < 200 || status >= 300) {
              if (status === 429) noteRateLimited()  // 限流信号 → AIMD ×0.6
              // Canvas 下载端点高并发下偶发 429/403 限流，指数退避重试（仅 oc.sjtu 这一跳）
              const isCanvasRl = (status === 429 || status === 403) && u.hostname === CANVAS_HOST
              let bodyHead = ''
              resp.on('data', (c: Buffer) => { if (bodyHead.length < 200) bodyHead += c.toString('utf8', 0, 200) })
              resp.on('end', () => {
                if (isCanvasRl && rlRetries < CANVAS_RL_MAX_RETRIES && t.state === 'downloading') {
                  rlRetries++
                  const raHdr = resp.headers['retry-after']
                  const raStr = Array.isArray(raHdr) ? raHdr[0] : raHdr
                  const delay = canvasRlBackoffMs(raStr, rlRetries)
                  emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: t.received, total: t.total, message: `文件下载被限流(${status})，${Math.round(delay / 1000)}s 后重试 (${rlRetries}/${CANVAS_RL_MAX_RETRIES})` })
                  setTimeout(() => {
                    if (t.state === 'downloading') fetchOnce(url, depth)
                  }, delay)
                  return
                }
                console.error(`[cloudpan:cdn] HTTP ${status}`)
                fail(new Error(`HTTP ${status} ${resp.statusMessage || ''} — ${bodyHead.slice(0, 200)}`.trim()))
              })
              // BUG FIX: missing error handler on non-200 response body stream.
              // Without this, a network error during body collection is an unhandled
              // 'error' event, crashing the process.
              resp.on('error', fail)
              return
            }

            // RTT 采样：CDN 响应头到达
            noteRttSample(Date.now() - reqStart)

            // CDN 不支持 Range（返回 200 而非 206）：销毁旧请求，重建 uploader，重新开始
            // [Bug 33 Fix] 先移除旧 resp 上的监听器，防止旧流的 data/end 事件干扰新会话
            if (cdnOffset > 0 && status === 200) {
              console.warn('[cloudpan:cdn] CDN 不支持 Range，从头重新上传')
              resp.removeAllListeners()
              resp.resume()
              try { activeReq?.destroy() } catch { /* ignore */ }
              t.uploaderState = undefined
              chunks = []; chunksLen = 0
              uploading = false; ended = false
              void ensureFolderPath(userToken, ...cloudFolderSegments(t.spec))
                .then(() => startChunkedUpload(userToken, remotePath))
                .then(u2 => {
                  if (settled) return
                  uploader = u2  // 就地替换，所有 handler 引用同一个变量
                  t.uploader = u2
                  retryCount = 0
                  doFetch()      // 全新 fetch 会话
                }).catch(fail)
              return
            }

            // 计算 total
            noteNetworkRecovery()
            const lenHdr = resp.headers['content-length']
            const cl = Number(Array.isArray(lenHdr) ? lenHdr[0] : lenHdr) || 0
            if (status === 206) {
              const cr = resp.headers['content-range']
              const crStr = Array.isArray(cr) ? cr[0] : cr
              const m = crStr ? /\/(\d+)$/.exec(crStr) : null
              t.total = m ? Number(m[1]) : cdnOffset + cl || 0
            } else {
              t.total = cl
            }

            if (!settled) emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: uploader.bytesReceived, total: t.total })
            let lastEmit = 0

            resp.on('data', (chunk: Buffer) => {
              if (settled) { try { resp.destroy() } catch { /* ignore */ } ; return }
              const s = t.state as DownloadState
              if (s === 'paused' || s === 'cancelled') {
                try { resp.destroy() } catch { /* ignore */ }
                return
              }

              chunks.push(chunk)
              chunksLen += chunk.length
              t.received += chunk.length
              noteDownloadBytes(chunk.length)  // CDN 下载字节（上传字节在 uploadChunk 完成时计入 noteUploadBytes）

              if (chunksLen >= CHUNK_SIZE * MAX_BUFFER_CHUNKS) {
                try { resp.pause() } catch { /* ignore */ }
              }

              tryUploadNext()

              const now = Date.now()
              if (now - lastEmit > 2000) {
                lastEmit = now
                emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: uploader.bytesReceived, total: t.total })
              }
            })

            resp.on('end', () => {
              if (resp.destroyed) return
              ended = true
              // 上传剩余不足一片的尾段；无残留则直接 confirm
              tryUploadNext()
            })

            resp.on('error', (err: Error) => {
              if (retryCount < MAX_RETRIES && t.state === 'downloading') {
                retryCount++
                noteNetworkError()
                const delay = Math.pow(2, retryCount) * 1000
                const label = isDnsError(err) ? 'DNS 解析失败' : '网络错误'
                console.warn(`[cloudpan:cdn] ${label}，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES}): ${err.message}`)
                emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: uploader.bytesReceived, total: t.total, message: `${label}，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES})` })
                setTimeout(() => {
                  if (t.state !== 'downloading') return
                  doFetch()
                }, delay)
              } else {
                fail(err)
              }
            })
          }
        )
        activeReq = req
        t.req = req
        req.setTimeout(60_000, () => {
          if (retryCount < MAX_RETRIES && t.state === 'downloading') {
            timedOut = true
            retryCount++
            noteNetworkError()
            const delay = Math.pow(2, retryCount) * 1000
            console.warn(`[cloudpan:cdn] 请求超时，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES})`)
            emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: uploader.bytesReceived, total: t.total, message: `请求超时，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES})` })
            try { req.destroy() } catch { /* ignore */ }
            setTimeout(() => {
              if (settled || t.state !== 'downloading') return
              doFetch()
            }, delay)
          } else {
            req.destroy(new Error('请求超时（60s）'))
          }
        })
        req.on('error', (err: Error) => {
          // timeout handler 已处理重试，跳过
          if (timedOut) return
          if (!settled && retryCount < MAX_RETRIES && t.state === 'downloading') {
            retryCount++
            noteNetworkError()
            const delay = Math.pow(2, retryCount) * 1000
            const label = isDnsError(err) ? 'DNS 解析失败' : '连接错误'
            console.warn(`[cloudpan:cdn] ${label}，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES}): ${err.message}`)
            emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: uploader.bytesReceived, total: t.total, message: `${label}，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES})` })
            setTimeout(() => {
              if (settled || t.state !== 'downloading') return
              doFetch()
            }, delay)
          } else if (!settled) {
            fail(err)
          }
        })
        req.end()
      }

      fetchOnce(startUrl, 0)
    }

    // 初始化 uploader，然后开始下载
    const uploaderPromise = t.uploaderState
      ? resumeChunkedUpload(userToken, t.uploaderState)
      : ensureFolderPath(userToken, ...cloudFolderSegments(t.spec)).then(() => startChunkedUpload(userToken, remotePath))

    uploaderPromise.then(u0 => {
      if (settled) return
      uploader = u0
      t.uploader = u0
      doFetch()
    }).catch(fail)
  })
}

/** 暂停核心：活跃任务保存 COS 会话 + 销毁句柄；pending 任务移到 pausedCloud。不调度 */
function cloudPauseTaskCore(id: string): void {
  const t = cloudTasks.get(id)
  if (t) {
    if (t.state !== 'downloading' && t.state !== 'pending' && t.state !== 'error') return
    t.state = 'paused'
    cloudActive.delete(id)
    emitProgress({ taskId: id, state: 'paused', received: t.received, total: t.total, message: '已暂停' })
    // 保存 COS 会话状态，用于恢复时断点续传（先存再 destroy，getState 同步安全）
    if (t.uploader) t.uploaderState = t.uploader.getState()
    if (t.uploaderState) cloudPausedStates.set(id, t.uploaderState)
    destroyCloudHandles(t, 'paused')
    t.uploader = undefined
    // spec 移入 pausedCloud 待 resume
    pausedCloud.push(t.spec)
    pausedCloudIds.add(id)
    cloudTasks.delete(id)
    return
  }
  // 还在 pendingCloud → 移到 pausedCloud
  const spec = removeFromSpecArray(pendingCloud, id)
  if (spec) {
    emitProgress({ taskId: id, state: 'paused', received: 0, total: 0, message: '已暂停' })
    pausedCloud.push(spec)
    pendingCloudIds.delete(id)
    pausedCloudIds.add(id)
  }
}

function cloudPauseTask(id: string): void {
  cloudPauseTaskCore(id)
  cloudScheduleNext()
}

/** 取消核心：活跃任务销毁句柄 + 丢弃会话；pending/paused 任务从队列移除。不调度 */
function cloudCancelTaskCore(id: string): void {
  const t = cloudTasks.get(id)
  if (t) {
    if (t.state === 'done' || t.state === 'cancelled' || t.state === 'skipped') return
    t.state = 'cancelled'
    cloudActive.delete(id)
    emitProgress({ taskId: id, state: 'cancelled', received: t.received, total: t.total, message: '已取消' })
    destroyCloudHandles(t, 'cancelled')
    t.uploader = undefined
    t.uploaderState = undefined
    cloudTasks.delete(id)
    cloudPausedStates.delete(id)
    return
  }
  if (removeFromSpecArray(pendingCloud, id) || removeFromSpecArray(pausedCloud, id)) {
    emitProgress({ taskId: id, state: 'cancelled', received: 0, total: 0, message: '已取消' })
    cloudPausedStates.delete(id)
    pendingCloudIds.delete(id)
    pausedCloudIds.delete(id)
  }
}

function cloudCancelTask(id: string): void {
  cloudCancelTaskCore(id)
  cloudScheduleNext()
}

function cloudResumeTask(id: string): void {
  const spec = removeFromSpecArray(pausedCloud, id)
  if (spec) {
    reEnqueueCloud(spec) // cloudRunTask 会从 cloudPausedStates 取 uploaderState 续传
    cloudScheduleNext()
    return
  }
  const t = cloudTasks.get(id)
  if (t && t.state === 'error') {
    cloudFullRetries.delete(id)  // 手动恢复 → 重置全量重试计数，给满额度
    reEnqueueCloud(t.spec)
    cloudTasks.delete(id)
    cloudScheduleNext()
  }
}

function cloudPauseAll(): void {
  for (const id of [...cloudTasks.keys()]) cloudPauseTaskCore(id)
  for (const spec of pendingCloud) {
    emitProgress({ taskId: spec.taskId, state: 'paused', received: 0, total: 0, message: '已暂停' })
    pausedCloud.push(spec)
    pausedCloudIds.add(spec.taskId)
  }
  pendingCloud.length = 0
  pendingCloudIds.clear()
  cloudScheduleNext()
}
function cloudCancelAll(): void {
  for (const id of [...cloudTasks.keys()]) cloudCancelTaskCore(id)
  for (const spec of pendingCloud) {
    emitProgress({ taskId: spec.taskId, state: 'cancelled', received: 0, total: 0, message: '已取消' })
  }
  pendingCloud.length = 0
  pendingCloudIds.clear()
  for (const spec of pausedCloud) {
    emitProgress({ taskId: spec.taskId, state: 'cancelled', received: 0, total: 0, message: '已取消' })
  }
  pausedCloud.length = 0
  pausedCloudIds.clear()
  cloudPausedStates.clear()
  cloudFullRetries.clear()  // 全部取消 → 丢弃重试计数
  cloudScheduleNext()
}
function cloudResumeAll(): void {
  const paused = pausedCloud.splice(0)
  pausedCloudIds.clear()
  for (const spec of paused) reEnqueueCloud(spec)
  for (const [id, t] of cloudTasks) {
    if (t.state === 'error') {
      reEnqueueCloud(t.spec)
      cloudTasks.delete(id)
    }
  }
  cloudScheduleNext()
}

app.whenReady().then(async () => {
  // ─── 全局兜底：防止未捕获的 promise rejection 导致任务卡在 downloading 永不结束 ───
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason)
  })
  process.on('uncaughtException', (err) => {
    // [2.6] Log the error, then attempt graceful shutdown.
    // Silently swallowing uncaughtException leaves the app in an undefined state.
    console.error('[uncaughtException]', err)
    cleanupOnQuit()
    app.quit()
  })

  electronApp.setAppUserModelId('edu.sjtu.audited-downloader')

  // 移除默认应用菜单（File/Edit/View/Window/Help，含开发者工具入口）。
  // autoHideMenuBar 仍可按 Alt 呼出，setApplicationMenu(null) 彻底移除，避免用户误触。
  Menu.setApplicationMenu(null)

  // webview 内任何 window.open 都走外部浏览器
  app.on('web-contents-created', (_, contents) => {
    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(d => {
        shell.openExternal(d.url)
        return { action: 'deny' }
      })
    }
  })

  // ─── 启动即清登录凭证：无论如何，每次打开 APP 都强制重新扫码登录 ───
  // 在预热 session 之前抹掉 persist:sjtu 的 cookies/localStorage 等持久化凭证，
  // 并重置内存态 jwt token / auth 缓存。渲染端 auth:status 必返回未登录 → 停在 welcome，
  // 用户必须重新扫码。避免上次会话的 jAccount / 云盘 token 残留带来过期态或串号风险。
  // 清理失败也不阻塞启动（最多凭证残留，用户可手动登出）。
  jwtToken = null
  _authCache = null
  accountName = null
  studentId = null
  try {
    await clearSjtuSession()
  } catch (e) {
    console.error('[startup] 清理登录凭证失败（不阻塞启动）:', e)
  }

  sjtuSession() // 预热持久化 session
  setSession(sjtuSession()) // 云盘 API 使用 Electron session（走系统代理）

  // Canvas 使用同一个持久化 session（共享 jAccount 登录态）
  setCanvasSession(sjtuSession())
  // [2.7] Simplified emitter callback — removed dead `scalar` parameter
  setCanvasEmitter((channel, data) => {
    if (!mainWindow) return
    mainWindow.webContents.send(channel, data)
  })
  // [Bug 37 Fix] 注入并发容量提供者，让 HLS 下载遵守全局并发限制
  setConcurrencyProvider(() => ({ active: sharedActiveCount(), concurrency }))
  // [Bug Fix] 注入 HLS 活跃计数回调：orchestrator 在获取槽位后增、下载结束后减，
  // 让 sharedActiveCount 把正在跑的 HLS 任务算进去，调度器才不会超发并发。
  setHlsActiveReporter((delta: number) => { hlsActive += delta; if (hlsActive < 0) hlsActive = 0 })
  registerCanvasHandlers()

  // 好大学在线 (cnmooc.sjtu.cn) — 复用同一 persist:sjtu session（共享 jAccount 登录态）
  setCnmoocSession(sjtuSession())
  setCnmoocEmitter((channel, data) => {
    if (!mainWindow) return
    mainWindow.webContents.send(channel, data)
  })
  registerCnmoocHandlers()

  // 标题栏按钮颜色跟随主题
  ipcMain.handle('app:set-theme', (_e, theme: 'dark' | 'light') => {
    // 标题栏已改用自绘按钮（无 titleBarOverlay），setTitleBarOverlay 在无 overlay 时无效；
    // 保留 try/catch 以防旧版/其他平台行为差异。
    try {
      if (mainWindow && theme === 'light') {
        mainWindow.setTitleBarOverlay({ color: '#FFFFFF', symbolColor: '#1D2129', height: 36 })
      } else if (mainWindow) {
        mainWindow.setTitleBarOverlay({ color: '#121212', symbolColor: '#F5F5F5', height: 36 })
      }
    } catch { /* no titleBarOverlay configured — ignore */ }
    return { ok: true }
  })

  // ─── 自定义标题栏窗口控制（Mac 交通灯按钮 + renderer 自绘确认弹窗） ───
  // 弹窗逻辑在 renderer（Mac 风格 HTML modal），主进程只提供原子动作。
  // 原生 minimize 事件无法 preventDefault，故任务栏/Win+Down 最小化仍直接隐藏到托盘。
  // close 事件可 preventDefault：发 window:close-requested 给 renderer 弹确认窗，
  // renderer 选择后回调 window:minimize / window:cancel-and-quit / 不动。
  ipcMain.handle('window:minimize', () => { mainWindow?.hide(); return { ok: true } })
  /** 直接退出（无下载时用）：不取消下载，cleanupOnQuit 统一回收句柄 */
  ipcMain.handle('window:quit', () => { isQuitting = true; app.quit(); return { ok: true } })
  /** 取消所有下载并退出（有下载时用户选"取消下载并退出"） */
  ipcMain.handle('window:cancel-and-quit', () => {
    cancelAll()
    cloudCancelAll()
    isQuitting = true
    app.quit()
    return { ok: true }
  })
  /** 查询是否有进行中任务（renderer 据此决定是否弹确认窗） */
  ipcMain.handle('window:has-ongoing-tasks', () => ({ ongoing: hasOngoingTasks() }))
  ipcMain.handle('window:toggle-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize()
      else mainWindow.maximize()
    }
    return { ok: true }
  })
  ipcMain.handle('window:is-maximized', () => ({ maximized: !!mainWindow?.isMaximized() }))

  ipcMain.handle('app:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择本地下载目录'
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  /** 弹出系统通知（下载完成提醒）。
   *  Windows 下 Notification 自带应用名，icon 用应用图标增强辨识度。
   *  点击通知聚焦主窗口（最小化到托盘时尤其有用）。 */
  ipcMain.handle(
    'app:notify',
    async (_e, payload: { title: string; body: string }): Promise<{ ok: boolean }> => {
      try {
        const n = new Notification({
          title: payload.title,
          body: payload.body,
          icon: nativeImage.createFromPath(resolveAppIcon()),
          silent: false
        })
        n.on('click', () => showMainWindow())
        n.show()
        return { ok: true }
      } catch {
        return { ok: false }
      }
    }
  )

  // ─── 新版本检查（主进程请求 GitHub，绕开渲染端 CSP 限制） ───
  // 渲染端 CSP connect-src 只允许 SJTU 域名，无法直连 api.github.com，
  // 故由主进程用 node:https 拉取 releases/latest，结果经 IPC 给渲染端 TitleBar 徽章。
  ipcMain.handle('app:check-update', async (): Promise<UpdateCheckResult> => {
    const current = app.getVersion()
    // 1h 节流：避免每次 TitleBar mount 都打 GitHub API（限流 60 次/h 未认证）
    if (_updateCache && Date.now() - _updateCache.ts < UPDATE_CHECK_TTL) {
      return _updateCache.result
    }
    const fail = (error: string): UpdateCheckResult => ({
      hasUpdate: false, currentVersion: current, latestVersion: null, releaseUrl: null, releaseNotes: null, error
    })
    try {
      const json = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const req = httpsRequest(
          {
            method: 'GET',
            hostname: 'api.github.com',
            path: `/repos/${UPDATE_REPO}/releases/latest`,
            headers: {
              'User-Agent': `sjtu-downloader/${current}`,
              Accept: 'application/vnd.github+json'
            },
            timeout: 5000
          },
          resp => {
            if (resp.statusCode !== 200) {
              reject(new Error(`HTTP ${resp.statusCode}`))
              resp.resume()
              return
            }
            let body = ''
            resp.setEncoding('utf8')
            resp.on('data', (chunk: string) => { body += chunk })
            resp.on('end', () => {
              try { resolve(JSON.parse(body) as Record<string, unknown>) }
              catch { reject(new Error('JSON 解析失败')) }
            })
          }
        )
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(new Error('timeout')) })
        req.end()
      })
      const tag = typeof json.tag_name === 'string' ? json.tag_name.replace(/^v/, '') : ''
      if (!tag) {
        const r = fail('响应缺少 tag_name')
        _updateCache = { result: r, ts: Date.now() }
        return r
      }
      const result: UpdateCheckResult = {
        hasUpdate: isNewerVersion(tag, current),
        currentVersion: current,
        latestVersion: tag,
        releaseUrl: typeof json.html_url === 'string' ? json.html_url : `https://github.com/${UPDATE_REPO}/releases/latest`,
        releaseNotes: typeof json.body === 'string' ? json.body.slice(0, 500) : null
      }
      _updateCache = { result, ts: Date.now() }
      return result
    } catch (err) {
      // 网络失败静默返回 hasUpdate:false，不打扰用户
      const r = fail(err instanceof Error ? err.message : String(err))
      _updateCache = { result: r, ts: Date.now() }
      return r
    }
  })

  // ─── 打开外部 URL（限于 GitHub 域，防任意 URL 打开） ───
  ipcMain.handle('app:open-external', (_e, url: string): { ok: boolean } => {
    if (typeof url !== 'string' || !url.startsWith('https://github.com/')) {
      return { ok: false }
    }
    void shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.handle('auth:set-jwt-token', (_e, token: string | null) => {
    jwtToken = token && token.length > 20 ? token : null
    _authCache = null // JWT 变化后必须重新验证登录态
    return { ok: true }
  })
  ipcMain.handle('auth:logout', async () => {
    jwtToken = null
    _authCache = null
    accountName = null
    studentId = null
    await clearSjtuSession()
    return { loggedIn: false, checkedAt: new Date().toISOString() }
  })
  ipcMain.handle('auth:status', async () => {
    const info = await getAuthInfo()
    accountName = info.accountName ?? null
    studentId = info.studentId ?? null
    return { loggedIn: info.loggedIn, accountName: info.accountName, studentId: info.studentId, checkedAt: new Date().toISOString() }
  })

  ipcMain.handle('vsjtu:scan-audit', async (_e, pageNo = 1, pageSize = 100) => {
    const r = await vsjtuFetch(V_SJTU_API.auditCourseMy, {
      method: 'POST',
      body: { pageNo, pageSize }
    })
    return r
  })

  ipcMain.handle('vsjtu:audit-course-detail', async (_e, resourceId: number) => {
    const r = await vsjtuFetch(V_SJTU_API.auditCourseDetail, {
      method: 'POST',
      body: { resourceId }
    })
    return r
  })


  ipcMain.handle(
    'download:start',
    async (
      _e,
      destRoot: string,
      specs: DownloadTaskSpec[],
      options?: { mode?: DownloadMode; localDestRoot?: string; conflictStrategy?: FileConflictStrategy }
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        // [2.1] IPC input validation: bound batch size, validate spec array
        const MAX_SPECS_PER_BATCH = 5000
        if (!Array.isArray(specs) || specs.length === 0) {
          return { ok: false, error: 'specs 不能为空' }
        }
        if (specs.length > MAX_SPECS_PER_BATCH) {
          return { ok: false, error: `specs 数量超出上限（${MAX_SPECS_PER_BATCH}）` }
        }
        for (const spec of specs) {
          if (!spec.taskId || !spec.fileName) {
            return { ok: false, error: 'spec 缺少 taskId 或 fileName' }
          }
        }

        const mode: DownloadMode = options?.mode
          ?? (specs.some(s => s.cloudUserToken) ? 'cloud' : 'local')

        const cloudToken = getCachedUserToken()

        // [Bug Fix] 前置校验：所选下载模式的前置条件必须满足，否则明确报错。
        // 原先 mode='cloud' 且未连云盘时，本地分支因 mode 不匹配跳过、云端分支因
        // `&& cloudToken` 跳过，导致 0 入队却返回 {ok:true}，渲染端 spec 永远停在 pending。
        if ((mode === 'cloud' || mode === 'both') && !cloudToken) {
          return {
            ok: false,
            error: mode === 'both'
              ? '当前为「本地 + 云盘」模式，但未连接交大云盘，请先连接云盘或切换为仅本地下载'
              : '当前为云盘模式，但未连接交大云盘，请先连接云盘或切换为本地下载'
          }
        }
        if ((mode === 'local' || mode === 'both') && !(options?.localDestRoot || destRoot)) {
          return { ok: false, error: '请先选择本地下载目录' }
        }

        // ─── 本地下载 ───
        if (mode === 'local' || mode === 'both') {
          const root = options?.localDestRoot || destRoot
          if (!root) throw new Error('请先选择本地下载目录')

          // 区分 Canvas 课程 / 好大学在线 / 旁听课程的下载路径
          const isCanvas = specs.some(s => isCanvasSpec(s))
          const isCnmooc = specs.some(s => isCnmoocSpec(s))
          const localBase = isCnmooc ? join(root, CNMOOC_LOCAL_DIR)
            : isCanvas ? join(root, 'Canvas课程')
            : join(root, CLOUD_ROOT_FOLDER)
          mkdirSync(localBase, { recursive: true })

          // 首次下载时在目录写入说明文件
          // 用 'wx' 独占创建：已存在则 EEXIST 忽略，消除 existsSync→writeFileSync 的 TOCTOU
          const readmePath = join(localBase, '下载说明.txt')
          try {
            writeFileSync(readmePath, [
              '下载说明',
              '========',
              '',
              '本目录下的 .part 文件是下载过程中的临时文件，用于支持断点续传。',
              '如果下载中断（网络断开、程序关闭等），下次重新下载同一视频时会自动从断点处继续，无需从头开始。',
              '',
              '所有视频下载完成后，.part 文件会被自动删除。',
              '如果你想手动清理，可以安全删除任意 .part 文件，不会影响已下载完成的 .mp4 视频。',
              '',
              '—— SJTU 旁听课程下载器',
              ''
            ].join('\n'), { encoding: 'utf-8', flag: 'wx' })
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
          }
          for (const spec of specs) {
            // PERF: O(1) duplicate-check via index Sets instead of O(n) .some() scans
            if (tasks.has(spec.taskId)) {
              const st = tasks.get(spec.taskId)!.state
              if (st === 'pending' || st === 'downloading' || st === 'paused') continue
            }
            if (pendingLocalIds.has(spec.taskId)) continue
            if (pausedLocalIds.has(spec.taskId)) continue
            // 算落盘路径（纯字符串拼接，便宜）；目录创建延迟到 runTask 临下载时
            const courseDir = join(localBase, ...effectiveCourseName(spec).split('/').map(sanitizeFsName))
            const filePath = join(courseDir, sanitizeFsName(spec.fileName))
            const partPath = filePath + '.part'
            pendingLocal.push({ spec: { ...spec, cloudUserToken: undefined }, filePath, partPath })
            pendingLocalIds.add(spec.taskId)
            if (options?.conflictStrategy) conflictStrategyByTask.set(spec.taskId, options.conflictStrategy)
            if (autoConcurrency) startAutoConcurrency()
            emitProgress({ taskId: spec.taskId, state: 'pending', received: 0, total: 0 })
          }
          scheduleNext()
        }

        // ─── 云盘上传 ───
        if ((mode === 'cloud' || mode === 'both') && cloudToken) {
          const cloudSpecs = mode === 'both'
            ? specs.map(s => ({ ...s, taskId: s.taskId + '_cloud', cloudUserToken: cloudToken }))
            : specs.map(s => ({ ...s, cloudUserToken: cloudToken }))
          for (const spec of cloudSpecs) {
            // PERF: O(1) duplicate-check via index Sets instead of O(n) .some() scans
            if (cloudTasks.has(spec.taskId)) {
              const st = cloudTasks.get(spec.taskId)!.state
              if (st === 'pending' || st === 'downloading' || st === 'paused') continue
            }
            if (pendingCloudIds.has(spec.taskId)) continue
            if (pausedCloudIds.has(spec.taskId)) continue
            pendingCloud.push(spec)
            pendingCloudIds.add(spec.taskId)
            if (options?.conflictStrategy) conflictStrategyByTask.set(spec.taskId, options.conflictStrategy)
            if (autoConcurrency) startAutoConcurrency()
            emitProgress({ taskId: spec.taskId, state: 'pending', received: 0, total: 0 })
          }
          cloudScheduleNext()
        }

        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: msg.slice(0, 300) }
      }
    }
  )

  ipcMain.handle('download:pause', (_e, id: string) => {
    // 任务可能在本地或云端任一队列（pending/paused/active），两端都尝试，各自对找不到的 id 安全 return
    pauseTask(id)
    cloudPauseTask(id)
    return { ok: true }
  })
  ipcMain.handle('download:cancel', (_e, id: string) => {
    cancelTask(id)
    cloudCancelTask(id)
    return { ok: true }
  })
  ipcMain.handle('download:resume', (_e, id: string) => {
    resumeTask(id)
    cloudResumeTask(id)
    return { ok: true }
  })
  ipcMain.handle('download:pause-all', () => {
    pauseAll(); cloudPauseAll()
    return { ok: true }
  })
  ipcMain.handle('download:cancel-all', () => {
    cancelAll(); cloudCancelAll()
    return { ok: true }
  })
  ipcMain.handle('download:resume-all', () => {
    resumeAll(); cloudResumeAll()
    return { ok: true }
  })
  ipcMain.handle('download:set-concurrency', (_e, n: number) => {
    if (n === 0) {
      // 自动并发模式
      autoConcurrency = true
      concurrency = 3
      startAutoConcurrency()
    } else {
      autoConcurrency = false
      stopAutoConcurrency()
      concurrency = Math.max(2, Math.min(16, Math.floor(Number(n)) || 3))
    }
    scheduleNext()
    cloudScheduleNext()
    return { ok: true, concurrency, auto: autoConcurrency }
  })

  // ─── 交大云盘 (pan.sjtu.edu.cn) 认证 ────────────────────────

  ipcMain.handle('cloudpan:get-cached-token', () => getCachedUserToken())

  // [Bug Fix] 启动恢复：渲染端把 localStorage 持久化的 UserToken 同步给 main 缓存。
  // main 的 cachedToken 是内存变量、重启即丢；不同步会导致 UI 显示"已连接"但下载时
  // getCachedUserToken() 返回 null。与 auth:set-jwt-token 同模式，token 由 main 持有。
  ipcMain.handle('cloudpan:set-cached-token', (_e, token: string | null) => {
    setCachedUserToken(token)
    return { ok: true }
  })

  // [2.2] validate-token and space-info use main-process cached token only.
  // The renderer should not send the raw token — we use getCachedUserToken() instead.
  ipcMain.handle('cloudpan:validate-token', async () => {
    const userToken = getCachedUserToken()
    if (!userToken) return { ok: false, error: '未登录云盘' }
    return validateUserToken(userToken)
  })

  ipcMain.handle('cloudpan:space-info', async () => {
    const userToken = getCachedUserToken()
    if (!userToken) return { ok: false, error: '未登录云盘' }
    try {
      const info = await getSpaceInfo(userToken)
      return { ok: true, info }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '获取空间信息失败' }
    }
  })

  ipcMain.handle('cloudpan:logout', () => {
    clearCachedCredentials()
    return { ok: true }
  })

  /** 利用已有的 jAccount session 直接完成 pan SSO 登录。
   *  用隐藏 BrowserWindow 加载 pan → 点击"jAccount登录" → SSO 自动跳转 → 拿 UserToken cookie。 */
  ipcMain.handle('cloudpan:direct-login', async () => {
    const ses = sjtuSession()
    try {
      const jaCookies = await ses.cookies.get({ domain: 'jaccount.sjtu.edu.cn' })
      if (jaCookies.length === 0) {
        return { ok: false, error: 'jAccount 未登录，请先登录 v.sjtu' }
      }

      const win = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true }
      })

      try {
        await win.loadURL('https://pan.sjtu.edu.cn')
        await new Promise(r => setTimeout(r, 2000))

        // 点击"jAccount登录"按钮触发 SSO
        await win.webContents.executeJavaScript(`
          (function() {
            var btns = document.querySelectorAll('button');
            for (var i = 0; i < btns.length; i++) {
              if (btns[i].textContent.includes('jAccount')) { btns[i].click(); return; }
            }
          })()
        `)

        // 轮询 USER_TOKEN cookie
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 500))
          const cookies = await ses.cookies.get({ domain: 'sjtu.edu.cn' })
          const ut = cookies.find(c => c.name === 'USER_TOKEN' && c.value.length >= 64)
          if (ut) {
            // [Bug Fix] SSO 拿到 token 后立即写入 main 缓存，否则后续 spaceInfo / download:start
            // 调 getCachedUserToken() 仍返回 null，导致"已连接却下不了"。
            setCachedUserToken(ut.value)
            return { ok: true, userToken: ut.value }
          }
        }

        return { ok: false, error: 'SSO 超时' }
      } finally {
        win.destroy()
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '登录失败' }
    }
  })

  createMainWindow()
  createTray()
  startSpeedTicker()

  app.on('activate', () => {
    // macOS dock 点击：有窗口则显示，无则重建
    showMainWindow()
  })
})

/** 退出前清理：销毁所有活跃的 HTTP 请求、文件流、定时器。
 *  同时将任务状态置为 cancelled，确保重试定时器回调时能正确退出。 */
function cleanupOnQuit(): void {
  isQuitting = true

  // 杀死所有 ffmpeg 子进程，防止残留
  killAllFfmpeg()

  // 清除 vod channels 缓存（释放内存、丢弃 token 关联结果）
  clearVodChannelsCache()

  // 清除 ExternalTool 模块视频的课程级 LTI token 缓存
  clearExtToolTokenCache()

  // 清除 cnmooc 会话 cookie 缓存（释放内存）
  cnmoocCookiesByTask.clear()

  // 清除云盘全量重试计数（释放内存）
  cloudFullRetries.clear()

  // 清除自动并发定时器
  stopAutoConcurrency()

  // 清除速度推送定时器
  stopSpeedTicker()

  // 销毁系统托盘
  if (tray) { tray.destroy(); tray = null }

  // 清除网络恢复定时器
  if (networkResumeTimer) {
    clearTimeout(networkResumeTimer)
    networkResumeTimer = undefined
  }

  // 销毁所有本地下载任务的活跃连接和文件流
  for (const [, t] of tasks) {
    if (t.state === 'downloading' || t.state === 'pending') {
      t.state = 'cancelled'
      destroyLocalHandles(t, 'app quit')
      // [Bug Fix] 推送 cancelled 进度，避免渲染端残留"下载中"陈旧态。
      // 退出时 mainWindow 可能已销毁，emitProgress 内部对 mainWindow 为空做 no-op，安全。
      emitProgress({ taskId: t.spec.taskId, state: 'cancelled', received: t.received, total: t.total, message: '应用退出' })
    }
  }

  // 销毁所有云盘上传任务的活跃连接
  for (const [, t] of cloudTasks) {
    if (t.state === 'downloading' || t.state === 'pending') {
      t.state = 'cancelled'
      destroyCloudHandles(t, 'app quit')
      t.uploader = undefined
      emitProgress({ taskId: t.spec.taskId, state: 'cancelled', received: t.received, total: t.total, message: '应用退出' })
    }
  }

  // 释放所有任务引用与待处理队列，允许 GC 回收
  tasks.clear()
  active.clear()
  pendingLocal.length = 0
  pausedLocal.length = 0
  pendingLocalIds.clear()
  pausedLocalIds.clear()
  cloudTasks.clear()
  cloudActive.clear()
  pendingCloud.length = 0
  pausedCloud.length = 0
  pendingCloudIds.clear()
  pausedCloudIds.clear()
  cloudPausedStates.clear()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  cleanupOnQuit()
})
