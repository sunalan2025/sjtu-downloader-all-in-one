import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { electronApp, is } from '@electron-toolkit/utils'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type WriteStream
} from 'node:fs'
import { join } from 'node:path'
import { request as httpsRequest } from 'node:https'
import type { ClientRequest, IncomingMessage } from 'node:http'
import {
  SJTU_PARTITION,
  V_SJTU_API,
  V_SJTU_API_BASE,
  V_SJTU_ORIGIN,
  type DownloadMode,
  type DownloadProgress,
  type DownloadState,
  type DownloadTaskSpec
} from '../shared/types'
import {
  getCachedUserToken,
  clearCachedCredentials,
  validateUserToken,
  getSpaceInfo,
  ensureFolderPath,
  startChunkedUpload,
  resumeChunkedUpload,
  setSession,
  FileExistsError,
  type ChunkedUploader,
  type UploadSessionState
} from './cloudpan'

let mainWindow: BrowserWindow | null = null

/** v.sjtu 的 jwt-token，由 renderer 在登录回跳后从 webview localStorage 抽取并推过来。
 *  只放在内存里，进程退出即丢；下次启动需要重新登录拿。 */
let jwtToken: string | null = null

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    show: true,
    center: true,
    autoHideMenuBar: true,
    backgroundColor: '#0e1430',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0e1430', symbolColor: '#E2E8F0', height: 36 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
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

  mainWindow.on('closed', () => { mainWindow = null })
}

const sjtuSession = (): Electron.Session => session.fromPartition(SJTU_PARTITION)

async function clearSjtuSession(): Promise<void> {
  await sjtuSession().clearStorageData({
    storages: ['cookies', 'localstorage', 'cachestorage', 'serviceworkers', 'indexdb']
  })
}

/** 登录判定：先看 sjtu cookie，再用 jwt 敲 /authority/me 验真。
 *  cloud-rbac 单接受 cookie 即可，但拿到 jwt 才能调 resmgr 系列。 */
async function isLoggedIn(): Promise<boolean> {
  const cookies = await sjtuSession().cookies.get({ domain: 'sjtu.edu.cn' })
  if (cookies.length === 0) return false
  try {
    const resp = await sjtuSession().fetch(`${V_SJTU_ORIGIN}/cloud-rbac/authority/me`, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
        Origin: V_SJTU_ORIGIN,
        Referer: `${V_SJTU_ORIGIN}/jy-application-resmgr-ui/`,
        ...(jwtToken ? { 'jwt-token': jwtToken } : {})
      }
    })
    const text = await resp.text()
    if (!resp.ok) return false
    const json = JSON.parse(text) as { code?: string; result?: unknown }
    return json?.code === '0'
  } catch {
    return false
  }
}

async function vsjtuFetch(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    Origin: V_SJTU_ORIGIN,
    Referer: `${V_SJTU_ORIGIN}/jy-application-resmgr-ui/`
  }
  if (jwtToken) headers['jwt-token'] = jwtToken
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json;charset=UTF-8'
  const resp = await sjtuSession().fetch(`${V_SJTU_API_BASE}${path}`, {
    method: init?.method || 'GET',
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined
  })
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

function sanitizeFsName(name: string): string {
  // Windows 非法字符: <>:"/\|?* + 控制字符 + 末尾点/空格
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
  return cleaned.slice(0, 180) || '未命名'
}

function emitProgress(p: DownloadProgress): void {
  mainWindow?.webContents.send('download:progress', p)
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
}

const tasks = new Map<string, TaskRuntime>()
const queue: string[] = []
const active = new Set<string>()
let concurrency = 3

// ─── 网络健康监测：当活跃任务频繁出错时暂停调度新任务，优先重试已开始的任务 ──

let networkErrorStreak = 0
let networkResumeTimer: ReturnType<typeof setTimeout> | undefined
const NETWORK_BACKOFF_MS = 30_000

function noteNetworkError(): void {
  networkErrorStreak++
  if (networkResumeTimer) { clearTimeout(networkResumeTimer); networkResumeTimer = undefined }
}

function noteNetworkRecovery(): void {
  networkErrorStreak = 0
  if (networkResumeTimer) { clearTimeout(networkResumeTimer); networkResumeTimer = undefined }
}

function isNetworkHealthy(): boolean {
  return networkErrorStreak < 3
}

function scheduleNext(): void {
  while (active.size < concurrency && queue.length > 0) {
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
    const id = queue.shift()!
    const t = tasks.get(id)
    if (!t) continue
    if (t.state !== 'pending') continue // 期间被 pause/cancel
    active.add(id)
    void runTask(t).finally(() => {
      active.delete(id)
      t.req = undefined
      t.resp = undefined
      t.ws = undefined
      scheduleNext()
    })
  }
}

async function runTask(t: TaskRuntime): Promise<void> {
  // 最终文件已存在 → 跳过
  if (existsSync(t.filePath)) {
    t.state = 'skipped'
    emitProgress({
      taskId: t.spec.taskId,
      state: 'skipped',
      received: 0,
      total: 0,
      filePath: t.filePath,
      message: '已存在，跳过'
    })
    return
  }

  // 按需解析直链（lazy resolution）
  if (!t.spec.url && t.spec.refId != null) {
    t.state = 'downloading'
    emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: 0, total: 0, message: '解析直链…' })
    try {
      const env = await vsjtuFetch(`${V_SJTU_API.vodInfoByCourseId}?courseId=${encodeURIComponent(t.spec.refId)}`) as Record<string, unknown>
      if (!env?.success) throw new Error(String(env?.message || '直链获取失败'))
      const data = env.data as { videoInfos?: Array<{ angle: number; extendPlayUrls?: string[] }> }
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
      t.state = 'error'
      const msg = err instanceof Error ? err.message : String(err)
      emitProgress({ taskId: t.spec.taskId, state: 'error', received: 0, total: 0, message: msg.slice(0, 240) })
      return
    }
  }

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
        const isNetErr = /socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timeout|EPIPE/i.test(msg)
        if (isNetErr && attempt < MAX_DL_RETRIES) {
          const delay = Math.pow(2, attempt + 1) * 1000
          noteNetworkError()
          console.warn(`[download] 网络错误，${delay / 1000}s 后重试 (${attempt + 1}/${MAX_DL_RETRIES}): ${msg}`)
          emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: t.received, total: t.total, message: `网络中断，${delay / 1000}s 后重试 (${attempt + 1}/${MAX_DL_RETRIES})` })
          await new Promise(r => setTimeout(r, delay))
          if (t.state !== 'downloading') throw retryErr // 等待期间被 pause/cancel
          continue
        }
        throw retryErr
      }
    }
    renameSync(t.partPath, t.filePath)
    t.state = 'done'
    emitProgress({
      taskId: t.spec.taskId,
      state: 'done',
      received: t.received,
      total: t.total || t.received,
      filePath: t.filePath
    })
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
    const msg = err instanceof Error ? err.message : String(err || '下载失败')
    emitProgress({
      taskId: t.spec.taskId,
      state: 'error',
      received: t.received,
      total: t.total,
      message: msg.slice(0, 240)
    })
  }
}

/** 真正的 HTTP 流式下载；支持手动重定向、Range 续传、写流 backpressure。
 *  完全绕开 Chromium 网络栈：之前用 sjtuSession.fetch / net.request 都被 Chromium
 *  按 cross-origin 直接 BLOCKED_BY_CLIENT。Node 的 https 不做 CORS 也不阻拦。 */
function downloadStream(t: TaskRuntime): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // 续传探测：part 文件已存在且 size>0 → 发 Range
    let resumeFrom = 0
    if (existsSync(t.partPath)) {
      try {
        const st = statSync(t.partPath)
        if (st.size > 0) resumeFrom = st.size
      } catch {
        /* ignore */
      }
    }
    t.received = resumeFrom

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

    const fetchOnce = (url: string, depth: number): void => {
      if (depth > 5) {
        fail(new Error(`重定向过多：${depth}`))
        return
      }
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
            let bodyHead = ''
            resp.on('data', (c: Buffer) => {
              if (bodyHead.length < 200) bodyHead += c.toString('utf8', 0, 200)
            })
            resp.on('end', () =>
              fail(
                new Error(
                  `HTTP ${status} ${resp.statusMessage || ''} — ${bodyHead.slice(0, 200)}`.trim()
                )
              )
            )
            return
          }

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

function enqueueTask(t: TaskRuntime): void {
  t.state = 'pending'
  queue.push(t.spec.taskId)
  emitProgress({
    taskId: t.spec.taskId,
    state: 'pending',
    received: t.received,
    total: t.total
  })
}

function pauseTask(id: string): void {
  const t = tasks.get(id)
  if (!t) return
  if (t.state !== 'downloading' && t.state !== 'pending') return
  t.state = 'paused'
  // 立即释放并发槽，不用等 runTask finally 异步执行
  active.delete(id)
  emitProgress({
    taskId: id,
    state: 'paused',
    received: t.received,
    total: t.total,
    message: '已暂停'
  })
  try {
    t.resp?.destroy()
  } catch {
    /* ignore */
  }
  try {
    t.req?.destroy(new Error('paused'))
  } catch {
    /* ignore */
  }
  try {
    t.ws?.destroy()
  } catch {
    /* ignore */
  }
  t.req = undefined
  t.resp = undefined
  t.ws = undefined
}

function cancelTask(id: string): void {
  const t = tasks.get(id)
  if (!t) return
  if (t.state === 'done' || t.state === 'cancelled' || t.state === 'skipped') return
  const wasActive = active.has(id)
  t.state = 'cancelled'
  // 立即释放并发槽，不用等 runTask finally 异步执行
  active.delete(id)
  emitProgress({
    taskId: id,
    state: 'cancelled',
    received: t.received,
    total: t.total,
    message: '已取消'
  })
  if (wasActive) {
    try {
      t.resp?.destroy()
    } catch {
      /* ignore */
    }
    try {
      t.req?.destroy(new Error('cancelled'))
    } catch {
      /* ignore */
    }
    try {
      t.ws?.destroy()
    } catch {
      /* ignore */
    }
    // 清掉引用，防止 runTask finally 延迟执行时误清新 TaskRuntime
    t.req = undefined
    t.resp = undefined
    t.ws = undefined
  } else {
    // pending 或 paused → 直接清掉磁盘 .part（如果存在）
    try {
      unlinkSync(t.partPath)
    } catch {
      /* ignore */
    }
  }
}

function resumeTask(id: string): void {
  const t = tasks.get(id)
  if (!t) return
  if (t.state !== 'paused' && t.state !== 'error') return
  enqueueTask(t)
  scheduleNext()
}

function pauseAll(): void {
  for (const id of [...tasks.keys()]) pauseTask(id)
}
function cancelAll(): void {
  for (const id of [...tasks.keys()]) cancelTask(id)
}
function resumeAll(): void {
  for (const id of [...tasks.keys()]) {
    const t = tasks.get(id)
    if (t && (t.state === 'paused' || t.state === 'error')) resumeTask(id)
  }
}

// ─────────────────────────────────────────────────────────────
// 云盘上传：从 v.sjtu CDN 边下载边分片上传到交大云盘
// ─────────────────────────────────────────────────────────────

const CHUNK_SIZE = 4 * 1024 * 1024 // 4 MB per COS part
const MAX_BUFFER_CHUNKS = 2 // 内存中最多缓冲 2 个 4MB 块 → 8MB
const CLOUD_ROOT_FOLDER = 'SJTU旁听课程'

interface CloudTaskRuntime {
  spec: DownloadTaskSpec
  state: DownloadState
  received: number
  total: number
  req?: ClientRequest
  resp?: IncomingMessage
  uploader?: ChunkedUploader
  /** 已进入 doFetch 流程（doFetch 入口会检查此标记避免覆盖 cancel 设置的终态） */
  startedUpload: boolean
  /** 暂停时保存的 COS 会话状态，恢复时用于断点续传 */
  uploaderState?: UploadSessionState
  /** pause/cancel 时调用，强制 settle cloudDownloadAndUpload 的 Promise */
  cancel?: () => void
}

const cloudTasks = new Map<string, CloudTaskRuntime>()
const cloudQueue: string[] = []
const cloudActive = new Set<string>()

function cloudEnqueue(t: CloudTaskRuntime): void {
  t.state = 'pending'
  cloudQueue.push(t.spec.taskId)
  emitProgress({ taskId: t.spec.taskId, state: 'pending', received: 0, total: 0 })
}

function cloudScheduleNext(): void {
  while (cloudActive.size < concurrency && cloudQueue.length > 0) {
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
    const id = cloudQueue.shift()!
    const t = cloudTasks.get(id)
    if (!t || t.state !== 'pending') continue
    cloudActive.add(id)
    void cloudRunTask(t).finally(() => {
      cloudActive.delete(id)
      t.req = undefined
      t.resp = undefined
      t.uploader = undefined
      cloudScheduleNext()
    })
  }
}

/** 根据任务 spec 计算云盘远端路径 */
function cloudRemotePath(spec: DownloadTaskSpec): string {
  return `${CLOUD_ROOT_FOLDER}/${sanitizeFsName(spec.courseName)}/${sanitizeFsName(spec.fileName)}`
}

async function cloudRunTask(t: CloudTaskRuntime): Promise<void> {
  t.state = 'downloading'

  // 按需解析直链（lazy resolution）
  // 注意：t.state 可被外部 cloudCancelTask 异步修改，TS 收窄不可靠，需 as DownloadState
  if (!t.spec.url && t.spec.refId != null) {
    if ((t.state as DownloadState) !== 'cancelled') emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: 0, total: 0, message: '解析直链…' })
    try {
      const env = await vsjtuFetch(`${V_SJTU_API.vodInfoByCourseId}?courseId=${encodeURIComponent(t.spec.refId)}`) as Record<string, unknown>
      if (!env?.success) throw new Error(String(env?.message || '直链获取失败'))
      const data = env.data as { videoInfos?: Array<{ angle: number; extendPlayUrls?: string[] }> }
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
      if ((t.state as DownloadState) === 'cancelled') return
      t.state = 'error'
      const msg = err instanceof Error ? err.message : String(err)
      emitProgress({ taskId: t.spec.taskId, state: 'error', received: 0, total: 0, message: msg.slice(0, 240) })
      return
    }
  }

  // 被取消 → 不再继续
  if ((t.state as DownloadState) === 'cancelled') return

  // 标记：从此刻起 doFetch 流程已启动，cancel 无法回退状态
  t.startedUpload = true

  // 断点续传：已传分片对应的 CDN 字节偏移
  const resumeFromByte = t.uploaderState
    ? (t.uploaderState.nextPart - 1) * CHUNK_SIZE
    : 0
  if ((t.state as DownloadState) !== 'cancelled') emitProgress({
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
    emitProgress({
      taskId: t.spec.taskId,
      state: 'done',
      received: t.received,
      total: t.total || t.received
    })
  } catch (err) {
    const finalState = t.state as DownloadState
    if (finalState === 'paused' || finalState === 'cancelled') return
    if (err instanceof FileExistsError) {
      t.state = 'skipped'
      emitProgress({
        taskId: t.spec.taskId,
        state: 'skipped',
        received: 0,
        total: 0,
        message: '云盘已存在，跳过'
      })
      return
    }
    t.state = 'error'
    if (t.uploader) {
      t.uploaderState = t.uploader.getState()
    }
    const msg = err instanceof Error ? err.message : String(err || '上传失败')
    emitProgress({
      taskId: t.spec.taskId,
      state: 'error',
      received: t.received,
      total: t.total,
      message: msg.slice(0, 240)
    })
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

    const doFetch = (): void => {
      // 按块收集，仅在拼满 CHUNK_SIZE 时才 Buffer.concat，避免 O(n²) 逐块复制
      let chunks: Buffer[] = []
      let chunksLen = 0
      let uploading = false
      let pendingEnd = false

      const flushToUpload = (): void => {
        if (chunksLen < CHUNK_SIZE) return
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
        void uploader.uploadChunk(uploadBuf).then(() => {
          uploading = false
          if (pendingEnd && chunksLen === 0) {
            void uploader.confirm().then(ok).catch(fail)
          } else {
            if (chunksLen < CHUNK_SIZE * MAX_BUFFER_CHUNKS && activeResp) {
              try { activeResp.resume() } catch { /* ignore */ }
            }
            flushToUpload()
          }
        }).catch(fail)
      }

      const fetchOnce = (url: string, depth: number): void => {
        if (depth > 5) { fail(new Error(`重定向过多：${depth}`)); return }
        let u: URL
        try { u = new URL(url) } catch { fail(new Error(`URL 解析失败：${url.slice(0, 120)}`)); return }

        const cdnOffset = uploader.bytesReceived
        const headers: Record<string, string> = {
          Accept: '*/*',
          Referer: `${V_SJTU_ORIGIN}/jy-application-resmgr-ui/`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
        }
        if (cdnOffset > 0) headers.Range = `bytes=${cdnOffset}-`

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
              let bodyHead = ''
              resp.on('data', (c: Buffer) => { if (bodyHead.length < 200) bodyHead += c.toString('utf8', 0, 200) })
              resp.on('end', () => {
                console.error(`[cloudpan:cdn] HTTP ${status}`)
                fail(new Error(`HTTP ${status} ${resp.statusMessage || ''} — ${bodyHead.slice(0, 200)}`.trim()))
              })
              return
            }

            // CDN 不支持 Range（返回 200 而非 206）：销毁旧请求，重建 uploader，重新开始
            if (cdnOffset > 0 && status === 200) {
              console.warn('[cloudpan:cdn] CDN 不支持 Range，从头重新上传')
              resp.resume()
              try { activeReq?.destroy() } catch { /* ignore */ }
              t.uploaderState = undefined
              chunks = []; chunksLen = 0
              void ensureFolderPath(userToken, CLOUD_ROOT_FOLDER, sanitizeFsName(t.spec.courseName))
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

              if (chunksLen >= CHUNK_SIZE * MAX_BUFFER_CHUNKS) {
                try { resp.pause() } catch { /* ignore */ }
              }

              flushToUpload()

              const now = Date.now()
              if (now - lastEmit > 2000) {
                lastEmit = now
                emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: uploader.bytesReceived, total: t.total })
              }
            })

            resp.on('end', () => {
              if (resp.destroyed) return
              if (chunksLen > 0) {
                const lastBuf = Buffer.concat(chunks)
                chunks = []; chunksLen = 0
                uploading = true
                void uploader.uploadChunk(lastBuf).then(() => {
                  uploading = false
                  void uploader.confirm().then(ok).catch(fail)
                }).catch(fail)
              } else if (!uploading) {
                void uploader.confirm().then(ok).catch(fail)
              } else {
                pendingEnd = true
              }
            })

            resp.on('error', (err: Error) => {
              if (retryCount < MAX_RETRIES && t.state === 'downloading') {
                retryCount++
                noteNetworkError()
                const delay = Math.pow(2, retryCount) * 1000
                console.warn(`[cloudpan:cdn] 网络错误，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES}): ${err.message}`)
                emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: uploader.bytesReceived, total: t.total, message: `网络中断，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES})` })
                setTimeout(() => {
                  if (t.state !== 'downloading') return
                  noteNetworkRecovery()
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
            retryCount++
            noteNetworkError()
            const delay = Math.pow(2, retryCount) * 1000
            console.warn(`[cloudpan:cdn] 请求超时，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES})`)
            emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: uploader.bytesReceived, total: t.total, message: `请求超时，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES})` })
            try { req.destroy() } catch { /* ignore */ }
            setTimeout(() => {
              if (settled || t.state !== 'downloading') return
              noteNetworkRecovery()
              doFetch()
            }, delay)
          } else {
            req.destroy(new Error('请求超时（60s）'))
          }
        })
        req.on('error', (err: Error) => {
          // socket hang up / ECONNRESET 等连接级错误：带重试
          // 注意：timeout handler 调用 req.destroy() 也会触发此事件，
          // 但 timeout 已经 increment 了 retryCount 并 schedule 了 doFetch，
          // 这里 retryCount 已经等于 MAX_RETRIES，会直接走 fail()。
          if (!settled && retryCount < MAX_RETRIES && t.state === 'downloading') {
            retryCount++
            noteNetworkError()
            const delay = Math.pow(2, retryCount) * 1000
            console.warn(`[cloudpan:cdn] 连接错误，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES}): ${err.message}`)
            emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: uploader.bytesReceived, total: t.total, message: `连接中断，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES})` })
            setTimeout(() => {
              if (settled || t.state !== 'downloading') return
              noteNetworkRecovery()
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
      : ensureFolderPath(userToken, CLOUD_ROOT_FOLDER, sanitizeFsName(t.spec.courseName)).then(() => startChunkedUpload(userToken, remotePath))

    uploaderPromise.then(u0 => {
      if (settled) return
      uploader = u0
      t.uploader = u0
      doFetch()
    }).catch(fail)
  })
}

function cloudPauseTask(id: string): void {
  const t = cloudTasks.get(id)
  if (!t || (t.state !== 'downloading' && t.state !== 'pending')) return
  t.state = 'paused'
  cloudActive.delete(id)
  emitProgress({ taskId: id, state: 'paused', received: t.received, total: t.total, message: '已暂停' })
  try { t.resp?.destroy() } catch { /* ignore */ }
  try { t.req?.destroy(new Error('paused')) } catch { /* ignore */ }
  // 保存 COS 会话状态，用于恢复时断点续传
  if (t.uploader) {
    t.uploaderState = t.uploader.getState()
  }
  try { t.cancel?.() } catch { /* ignore */ }
  t.req = undefined
  t.resp = undefined
  t.uploader = undefined
  t.cancel = undefined
}

function cloudCancelTask(id: string): void {
  const t = cloudTasks.get(id)
  if (!t || t.state === 'done' || t.state === 'cancelled' || t.state === 'skipped') return
  t.state = 'cancelled'
  cloudActive.delete(id)
  emitProgress({ taskId: id, state: 'cancelled', received: t.received, total: t.total, message: '已取消' })
  try { t.resp?.destroy() } catch { /* ignore */ }
  try { t.req?.destroy(new Error('cancelled')) } catch { /* ignore */ }
  try { t.cancel?.() } catch { /* ignore */ }
  t.req = undefined
  t.resp = undefined
  t.uploader = undefined
  t.uploaderState = undefined // 取消时丢弃会话，不保留
  t.cancel = undefined
}

function cloudResumeTask(id: string): void {
  const t = cloudTasks.get(id)
  if (!t || (t.state !== 'paused' && t.state !== 'error')) return
  cloudEnqueue(t)
  cloudScheduleNext()
}

function cloudPauseAll(): void { for (const id of [...cloudTasks.keys()]) cloudPauseTask(id) }
function cloudCancelAll(): void { for (const id of [...cloudTasks.keys()]) cloudCancelTask(id) }
function cloudResumeAll(): void {
  for (const id of [...cloudTasks.keys()]) {
    const t = cloudTasks.get(id)
    if (t && (t.state === 'paused' || t.state === 'error')) cloudResumeTask(id)
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('edu.sjtu.audited-downloader')

  // webview 内任何 window.open 都走外部浏览器
  app.on('web-contents-created', (_, contents) => {
    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(d => {
        shell.openExternal(d.url)
        return { action: 'deny' }
      })
    }
  })

  sjtuSession() // 预热持久化 session
  setSession(sjtuSession()) // 云盘 API 使用 Electron session（走系统代理）

  // 标题栏按钮颜色跟随主题
  ipcMain.handle('app:set-theme', (_e, theme: 'dark' | 'light') => {
    if (!mainWindow) return
    if (theme === 'light') {
      mainWindow.setTitleBarOverlay({ color: '#FFFFFF', symbolColor: '#1D2129', height: 36 })
    } else {
      mainWindow.setTitleBarOverlay({ color: '#121212', symbolColor: '#F5F5F5', height: 36 })
    }
    return { ok: true }
  })

  ipcMain.handle('app:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择本地下载目录'
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle('auth:set-jwt-token', (_e, token: string | null) => {
    jwtToken = token && token.length > 20 ? token : null
    return { ok: true }
  })
  ipcMain.handle('auth:logout', async () => {
    jwtToken = null
    await clearSjtuSession()
    return { loggedIn: false, checkedAt: new Date().toISOString() }
  })
  ipcMain.handle('auth:status', async () => ({
    loggedIn: await isLoggedIn(),
    checkedAt: new Date().toISOString()
  }))

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
      options?: { mode?: DownloadMode; localDestRoot?: string }
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const mode: DownloadMode = options?.mode
          ?? (specs.some(s => s.cloudUserToken) ? 'cloud' : 'local')

        const cloudToken = getCachedUserToken()

        // ─── 本地下载 ───
        if (mode === 'local' || mode === 'both') {
          const root = options?.localDestRoot || destRoot
          if (!root) throw new Error('请先选择本地下载目录')
          const localBase = join(root, CLOUD_ROOT_FOLDER)
          mkdirSync(localBase, { recursive: true })
          // 首次下载时在总目录写入说明文件
          const readmePath = join(localBase, '下载说明.txt')
          if (!existsSync(readmePath)) {
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
            ].join('\n'), 'utf-8')
          }
          for (const spec of specs) {
            const courseDir = join(localBase, sanitizeFsName(spec.courseName))
            mkdirSync(courseDir, { recursive: true })
            const filePath = join(courseDir, sanitizeFsName(spec.fileName))
            const partPath = filePath + '.part'
            const existing = tasks.get(spec.taskId)
            if (existing && (existing.state === 'pending' || existing.state === 'downloading' || existing.state === 'paused')) {
              continue
            }
            const localSpec = { ...spec, cloudUserToken: undefined }
            const t: TaskRuntime = { spec: localSpec, filePath, partPath, state: 'pending', received: 0, total: 0 }
            tasks.set(spec.taskId, t)
            enqueueTask(t)
          }
          scheduleNext()
        }

        // ─── 云盘上传 ───
        if ((mode === 'cloud' || mode === 'both') && cloudToken) {
          const cloudSpecs = mode === 'both'
            ? specs.map(s => ({ ...s, taskId: s.taskId + '_cloud', cloudUserToken: cloudToken }))
            : specs.map(s => ({ ...s, cloudUserToken: cloudToken }))
          for (const spec of cloudSpecs) {
            const existing = cloudTasks.get(spec.taskId)
            if (existing && (existing.state === 'pending' || existing.state === 'downloading' || existing.state === 'paused')) {
              continue
            }
            const t: CloudTaskRuntime = { spec, state: 'pending', received: 0, total: 0, startedUpload: false }
            cloudTasks.set(spec.taskId, t)
            cloudEnqueue(t)
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
    if (cloudTasks.has(id)) cloudPauseTask(id)
    else pauseTask(id)
    return { ok: true }
  })
  ipcMain.handle('download:cancel', (_e, id: string) => {
    if (cloudTasks.has(id)) cloudCancelTask(id)
    else cancelTask(id)
    return { ok: true }
  })
  ipcMain.handle('download:resume', (_e, id: string) => {
    if (cloudTasks.has(id)) cloudResumeTask(id)
    else resumeTask(id)
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
    concurrency = Math.max(2, Math.min(16, Math.floor(Number(n)) || 3))
    scheduleNext()
    cloudScheduleNext()
    return { ok: true, concurrency }
  })

  // ─── 交大云盘 (pan.sjtu.edu.cn) 认证 ────────────────────────

  ipcMain.handle('cloudpan:get-cached-token', () => getCachedUserToken())

  ipcMain.handle('cloudpan:validate-token', async (_e, userToken: string) => {
    return validateUserToken(userToken)
  })

  ipcMain.handle('cloudpan:space-info', async (_e, userToken: string) => {
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
          if (ut) return { ok: true, userToken: ut.value }
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

/** 退出前清理：销毁所有活跃的 HTTP 请求、文件流、定时器。
 *  同时将任务状态置为 cancelled，确保重试定时器回调时能正确退出。 */
function cleanupOnQuit(): void {
  // 清除网络恢复定时器
  if (networkResumeTimer) {
    clearTimeout(networkResumeTimer)
    networkResumeTimer = undefined
  }

  // 销毁所有本地下载任务的活跃连接和文件流
  for (const [, t] of tasks) {
    if (t.state === 'downloading' || t.state === 'pending') {
      t.state = 'cancelled'
      try { t.resp?.destroy() } catch { /* ignore */ }
      try { t.req?.destroy(new Error('app quit')) } catch { /* ignore */ }
      try { t.ws?.destroy() } catch { /* ignore */ }
      t.req = undefined
      t.resp = undefined
      t.ws = undefined
    }
  }

  // 销毁所有云盘上传任务的活跃连接
  for (const [, t] of cloudTasks) {
    if (t.state === 'downloading' || t.state === 'pending') {
      t.state = 'cancelled'
      try { t.resp?.destroy() } catch { /* ignore */ }
      try { t.req?.destroy(new Error('app quit')) } catch { /* ignore */ }
      try { t.cancel?.() } catch { /* ignore */ }
      t.req = undefined
      t.resp = undefined
      t.uploader = undefined
      t.cancel = undefined
    }
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  cleanupOnQuit()
})
