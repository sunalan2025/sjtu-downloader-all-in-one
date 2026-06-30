/**
 * Canvas 下载编排器 — 注册 IPC 处理器，协调扫描 / 下载流程
 *
 * 对应 Python main.py 的 _run_course_pipeline 以及各 downloader 模块的调用入口。
 * 所有 Canvas IPC handler 在这里集中注册。
 */
import {
  BrowserWindow,
  ipcMain
} from 'electron'
import type Electron from 'electron'
import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  CANVAS_BASE_URL,
  type CanvasDownloadTaskSpec,
  type CanvasFileItem,
  type CanvasLectureDownloadItem,
  type CanvasTeacherSelection,
  type CanvasVideoSession
} from '../../shared/types'
import {
  listCourses,
  fetchFolderMap,
  fetchCourseFiles,
  fetchCourseModules,
  fetchSyllabusBody,
  extractCanvasFileIds,
  fetchCourseTabs,
  fetchPageBody,
  extractVideoIframes,
  extractVshareLinks,
  fetchFileMeta,
  sanitizeFsName
} from './api'
import {
  extractLtiToken,
  fetchVodVideoList,
  buildClassVideoFileName,
  extractLectureNum,
  resolveIvsVideoId
} from './video-tokens'
import { downloadModuleVideo } from './hls-download'
import { cloudFileExists, uploadLocalFileToCloud } from '../cloudpan'

let ses: Electron.Session | null = null

export function setCanvasSession(session: Electron.Session): void {
  ses = session
}

function getSession(): Electron.Session {
  if (!ses) throw new Error('Canvas session not initialized')
  return ses
}

/** 构建 Canvas 课程路径（含学期层）：学期/课程名-教师 或 课程名-教师 */
function canvasCoursePath(courseName: string, term?: string): string {
  const sanitized = sanitizeFsName(courseName)
  return term ? `${sanitizeFsName(term)}/${sanitized}` : sanitized
}

// ─── 扫描进度事件 ─────────────────────────────────────────────

/** 轻量事件发送回调，由 index.ts 注入。
 *  [2.7] Removed dead `scalar` parameter — no caller ever passed it.
 *  canvas 模块只依赖此接口，不再直接持有 BrowserWindow 引用。 */
type CanvasEmitter = (channel: string, data?: unknown) => void

let _emit: CanvasEmitter | null = null

/** [Bug 37 Fix] 并发容量提供者：由 index.ts 注入，让 HLS 下载遵守全局并发限制 */
type ConcurrencyProvider = () => { active: number; concurrency: number }
let _concurrencyProvider: ConcurrencyProvider | null = null

export function setConcurrencyProvider(provider: ConcurrencyProvider): void {
  _concurrencyProvider = provider
}

/** [Bug Fix] HLS 活跃计数回调：由 index.ts 注入。orchestrator 在获取槽位后增、
 *  下载结束后减，让主进程的 sharedActiveCount 把正在跑的 HLS 任务算进去，
 *  调度器才不会在 HLS 进行时继续超发本地/云任务。 */
type HlsActiveReporter = (delta: number) => void
let _hlsActiveReporter: HlsActiveReporter | null = null

export function setHlsActiveReporter(reporter: HlsActiveReporter): void {
  _hlsActiveReporter = reporter
}

// PERF: event-based concurrency slot wait — when a slot frees, the next
// waitForConcurrencySlot() loop iteration resolves promptly. The 10s timeout
// below is the correctness backstop: it re-checks the provider even if no
// notification fires.
//
// [Bug Fix] 原实现只有单个 concurrencyResolve 槽位，N 个 HLS 任务同时等待时
// 一个槽位释放只能唤醒最后注册的那个，其余要等到 10s 超时兜底才重新检查，
// 高并发扫描时唤醒延迟明显。改为 resolver 集合：notify 时唤醒所有等待者，
// 它们各自重新检查 active<concurrency，抢到即走、抢不到继续等。
const concurrencyResolvers = new Set<() => void>()

/** 由 index.ts 的 scheduleNext / cloudScheduleNext 在任务结束时调用，
 *  立即唤醒所有正在等待槽位的 HLS 下载。 */
export function notifyConcurrencySlotAvailable(): void {
  if (concurrencyResolvers.size === 0) return
  const waiters = Array.from(concurrencyResolvers)
  concurrencyResolvers.clear()
  for (const r of waiters) r()
}

async function waitForConcurrencySlot(): Promise<void> {
  if (!_concurrencyProvider) return
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const { active, concurrency } = _concurrencyProvider()
    if (active < concurrency) return
    // 等待事件通知（slot 打开时由 notifyConcurrencySlotAvailable 唤醒所有等待者）
    let resolver!: () => void
    const slotPromise = new Promise<void>(r => { resolver = r })
    concurrencyResolvers.add(resolver)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        slotPromise,
        // 超时兜底：避免永久挂起；同时让等待者周期性重新检查 provider
        new Promise<void>(r => { timer = setTimeout(r, 10_000) })
      ])
    } finally {
      // 无论事件唤醒还是超时，都把自身 resolver 移除，避免集合累积陈旧项
      concurrencyResolvers.delete(resolver)
      if (timer) clearTimeout(timer)
    }
  }
}

export function setCanvasEmitter(emitter: CanvasEmitter): void {
  _emit = emitter
}

function emitToRenderer(channel: string, data?: unknown): void {
  _emit?.(channel, data)
}

function emitScanProgress(courseId: number, phase: string, message: string): void {
  emitToRenderer('canvas:scan-progress', { courseId, phase, message })
}

// ─── Canvas 登录检查 ──────────────────────────────────────────

/** SSO 是否已成功过（避免每次 API 调用都重新走 SSO） */
let _canvasSsoDone = false

async function ensureCanvasLogin(): Promise<boolean> {
  if (_canvasSsoDone) return true

  const session = getSession()

  // 直接走 OIDC SSO：jAccount 有 cookies 时 ~1s 自动完成
  console.log('[canvas] 触发 OIDC SSO（隐藏窗口）…')
  const ok = await completeOidcSso(session, false)
  if (ok) { _canvasSsoDone = true; return true }

  // 隐藏窗口失败 → 弹出可见窗口（首次登录需用户扫码/授权）
  console.log('[canvas] 隐藏 SSO 失败，弹出可见窗口')
  const ok2 = await completeOidcSso(session, true)
  if (ok2) _canvasSsoDone = true
  return ok2
}

/** 通过 BrowserWindow 完成 Canvas OIDC SSO 流程。
 *  show=true 时弹出可见窗口（首次登录），show=false 时用隐藏窗口（复用 jAccount session）。 */
async function completeOidcSso(session: Electron.Session, show: boolean): Promise<boolean> {
  const win = new BrowserWindow({
    show,
    width: 800,
    height: 600,
    webPreferences: { session, nodeIntegration: false, contextIsolation: true }
  })

  try {
    // 关键：加载 /login/openid_connect 触发 OIDC SSO，不是 / （会到 /login/canvas 原生登录页）
    const ssoUrl = `${CANVAS_BASE_URL}/login/openid_connect`
    console.log('[canvas] 加载 SSO URL:', ssoUrl)
    await win.loadURL(ssoUrl)

    // 等待跳转到 Canvas dashboard（URL 含 login_success 或在 oc.sjtu.edu.cn 域且不在 /login）
    const timeoutMs = show ? 120_000 : 15_000
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500))
      const url = win.webContents.getURL()

      // SSO 成功标志：URL 包含 login_success 或回到 Canvas 主域
      if (isCanvasDashboardUrl(url)) {
        console.log('[canvas] SSO 完成:', url.slice(0, 100))
        // 等待 cookie 落盘
        await new Promise(r => setTimeout(r, 500))
        return true
      }
    }
    console.log('[canvas] SSO 超时，最后 URL:', win.webContents.getURL().slice(0, 120))
    return false
  } catch (e) {
    console.log('[canvas] SSO 异常:', e)
    return false
  } finally {
    win.destroy()
  }
}

/** 判断 URL 是否是 Canvas 主页面（非登录页、非 jAccount 页） */
function isCanvasDashboardUrl(url: string): boolean {
  if (!url) return false
  const lower = url.toLowerCase()
  if (!lower.startsWith(CANVAS_BASE_URL.toLowerCase())) return false
  // 排除 jAccount 和登录路径
  if (lower.includes('jaccount')) return false
  const path = lower.slice(CANVAS_BASE_URL.length).split('?')[0]
  if (path.startsWith('/login')) return false
  if (path.startsWith('/saml')) return false
  return true
}

// ─── 注册所有 Canvas IPC handler ──────────────────────────────

export function registerCanvasHandlers(): void {
  // ─── 列出课程 ───
  ipcMain.handle('canvas:list-courses', async () => {
    try {
      const loggedIn = await ensureCanvasLogin()
      if (!loggedIn) return { ok: false, error: 'Canvas 登录失败，请先登录 jAccount' }

      try {
        const courses = await listCourses(getSession())
        return { ok: true, courses }
      } catch (err) {
        // API 401 → session 可能过期，清除缓存重试一次
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('401') || msg.includes('未经身份验证')) {
          console.log('[canvas] API 401，清除 SSO 缓存重试')
          _canvasSsoDone = false
          const loggedIn2 = await ensureCanvasLogin()
          if (!loggedIn2) return { ok: false, error: 'Canvas 登录失败' }
          const courses = await listCourses(getSession())
          return { ok: true, courses }
        }
        throw err
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 扫描课程（文件 + modules + syllabus） ───
  ipcMain.handle('canvas:scan-course', async (_e, courseId: number) => {
    try {
      const session = getSession()
      emitScanProgress(courseId, 'files', '正在扫描文件和模块…')

      // PERF: 并行拉取四组独立 API（共享 courseId），扫描时间从 ~4s 降到 ~1s
      const [folderMap, files, modules, syllabusHtml] = await Promise.all([
        fetchFolderMap(session, courseId),
        fetchCourseFiles(session, courseId),
        fetchCourseModules(session, courseId),
        fetchSyllabusBody(session, courseId)
      ])

      const knownFileIds = new Set(files.filter(f => f.url).map(f => f.fileId))
      const moduleFileIds: number[] = []
      for (const m of modules) {
        for (const item of m.items) {
          if (item.type === 'File' && item.contentId && !knownFileIds.has(item.contentId)) {
            moduleFileIds.push(item.contentId)
            knownFileIds.add(item.contentId)
          }
        }
      }

      const syllabusFileIds = extractCanvasFileIds(syllabusHtml)
        .filter(id => !knownFileIds.has(id))

      // 补漏文件（模块/大纲里出现、但不在常规文件列表里的 File）取 meta，
      // 当作普通 Canvas 文件合并进 UI 的 files 列表，统一走 canvas-files 下载路径。
      // 模块补漏用真实 folderId（落真实 Canvas 文件夹，查不到兜底 files/ 根）；
      // 大纲补漏固定落 files/大纲/（对应浏览器「大纲」tab，其真实 folder 不在课程 folderMap 里）。
      const moduleFiles = await fetchFileMetaBatch(session, moduleFileIds)
      const syllabusFiles = await fetchFileMetaBatch(session, syllabusFileIds, -3)

      emitScanProgress(courseId, 'done', '扫描完成')

      return {
        ok: true,
        files: files.filter(f => f.url && !f.locked),
        folderMap: Object.fromEntries(folderMap),
        moduleFiles,
        syllabusFiles
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 构建下载任务 spec 列表 ───
  ipcMain.handle(
    'canvas:build-download-specs',
    async (
      _e,
      courseName: string,
      courseId: number,
      files: CanvasFileItem[],
      folderMap: Record<number, string>,
      destRoot: string,
      term?: string
    ) => {
      // 模块/大纲补漏文件在 scan-course 阶段已 fetchFileMetaBatch 取 meta、合并进 files
      // 列表（taskId = canvas_file_*，统一走 canvas-files cookie 注入路径），此处只处理常规文件。
      const specs: CanvasDownloadTaskSpec[] = []
      const cPath = canvasCoursePath(courseName, term)

      // Files
      for (const f of files) {
        const relDir = folderMap[f.folderId ?? -1] || ''
        specs.push({
          taskId: `canvas_file_${courseId}_${f.fileId}`,
          url: f.url,
          courseName: `Canvas课程/${cPath}/files${relDir ? '/' + relDir : ''}`,
          fileName: sanitizeFsName(f.displayName),
          source: 'canvas-files',
          canvasCourseId: courseId,
          canvasRelPath: relDir
        })
      }

      return { ok: true, specs }
    }
  )

  // ─── 获取单个 Canvas 文件 meta（用于 lazy resolution） ───
  ipcMain.handle('canvas:file-meta', async (_e, fileId: number) => {
    try {
      const meta = await fetchFileMeta(getSession(), fileId)
      return { ok: true, meta }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 课堂视频扫描 ───
  ipcMain.handle('canvas:class-video-scan', async (_e, courseId: number) => {
    try {
      const session = getSession()

      // 1. 找 tab
      emitScanProgress(courseId, 'class-video', '')
      const tabs = await fetchCourseTabs(session, courseId)
      const tab = tabs.find(t => t.label.includes('课堂视频new'))
      if (!tab) return { ok: true, sessions: [], teachers: [] }

      // 2. LTI token 提取（最耗时的步骤）
      const tokenData = await extractLtiToken(session, tab.htmlUrl)
      if (!tokenData) return { ok: false, error: 'LTI Token 提取失败，请检查课堂视频 tab 是否可访问' }
      // 缓存 token 供 PPT 下载等模块复用
      setCachedLtiToken(tokenData.token)

      // 3. 拉视频列表
      const sessions = await fetchVodVideoList(session, tokenData.token, tokenData.canvasCourseId)
      console.log('[canvas] 课堂视频列表:', sessions.length, '条记录')

      // 4. 按讲次分组（每条记录 = 1 讲，内含教师+PPT 两路流）
      const lectures = groupLectures(sessions)
      console.log('[canvas] 分组完成:', lectures.length, '讲')

      // 6. 统计教师
      const teacherMap = new Map<string, number>()
      for (const s of sessions) {
        teacherMap.set(s.teacher, (teacherMap.get(s.teacher) || 0) + 1)
      }
      const teachers: CanvasTeacherSelection[] = [...teacherMap.entries()]
        .map(([teacher, count]) => ({ teacher, count, selected: teacherMap.size <= 1 }))
        .sort((a, b) => b.count - a.count)

      // [Bug Fix] 扫描结束补发 'class-video-done' phase，让渲染端 useCanvasScanProgress
      // listener 把 scanningVideo 复位为 false。否则 PPT 下载等自动触发 classVideoScan 的路径
      // 会让课堂视频区块的转圈永远卡在 true（doClassVideoScan 的 finally 不在这些路径上执行）。
      // 用专属 'class-video-done' 而非 'done'，避免与 scan-course 文件扫描的 'done' phase 互相误复位。
      emitScanProgress(courseId, 'class-video-done', '课堂视频扫描完成')

      return { ok: true, sessions, teachers, lectures, token: tokenData.token, canvasCourseId: tokenData.canvasCourseId }
    } catch (err) {
      console.log('[canvas] 课堂视频扫描异常:', err)
      emitScanProgress(courseId, 'class-video-done', '课堂视频扫描失败')
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 课堂视频下载（懒解析：产占位 spec，直链推迟到下载前） ───
  ipcMain.handle(
    'canvas:class-video-download',
    async (
      _e,
      courseName: string,
      courseId: number,
      sessions: CanvasVideoSession[],
      selectedTeachers: string[],
      token: string,
      _canvasCourseId: string,
      destRoot: string,
      conflictStrategy?: 'skip' | 'overwrite',
      term?: string
    ) => {
      try {
        const cPath = canvasCoursePath(courseName, term)
        const videosDir = destRoot ? join(destRoot, 'Canvas课程', ...cPath.split('/'), 'videos', '课堂视频') : ''
        if (videosDir) mkdirSync(videosDir, { recursive: true })

        const overwrite = conflictStrategy === 'overwrite'
        const filtered = sessions.filter(s => selectedTeachers.includes(s.teacher))
        const specs: CanvasDownloadTaskSpec[] = []
        for (const s of filtered) {
          // 每讲最多 2 路（教师/PPT），占位 spec，下载前才解析
          for (let chIdx = 0; chIdx < 2; chIdx++) {
            const fileName = buildClassVideoFileName(courseName, s, chIdx)
            const destPath = videosDir ? join(videosDir, fileName) : ''
            // overwrite 模式不预跳过：交由 runTask 删旧文件后重下
            if (!overwrite && destPath && existsSync(destPath) && statSync(destPath).size > 0) {
              emitToRenderer('download:progress', {
                taskId: `canvas_cvid_${courseId}_${s.courId}_${chIdx}`, state: 'skipped', received: 0, total: 0, filePath: destPath, message: '已存在，跳过'
              })
              continue
            }
            specs.push({
              taskId: `canvas_cvid_${courseId}_${s.courId}_${chIdx}`,
              url: '', // 懒解析：下载前由 resolveDirectUrl 填入
              courseName: `Canvas课程/${cPath}/videos/课堂视频`,
              fileName,
              source: 'canvas-class-video',
              canvasCourseId: courseId,
              canvasVideoId: s.videoId,
              canvasVideoToken: token,
              canvasStreamIdx: chIdx
            })
          }
        }

        return { ok: true, specs }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ─── 按讲次下载课堂视频（接受明确的 teacher/ppt session） ───
  // 懒解析：只产带 videoId/token/streamIdx 的占位 spec（url 为空），
  // 直链解析推迟到 runTask/cloudRunTask 的 resolveDirectUrl，受并发控制。
  // 这样下载立即开始，解析量 ≈ 并发数，不再全量串行预解析。
  ipcMain.handle(
    'canvas:download-lectures',
    async (
      _e,
      courseName: string,
      courseId: number,
      lectureItems: CanvasLectureDownloadItem[],
      token: string,
      destRoot: string,
      conflictStrategy?: 'skip' | 'overwrite',
      term?: string
    ) => {
      try {
        const cPath = canvasCoursePath(courseName, term)
        const videosDir = destRoot ? join(destRoot, 'Canvas课程', ...cPath.split('/'), 'videos', '课堂视频') : ''
        if (videosDir) mkdirSync(videosDir, { recursive: true })

        const overwrite = conflictStrategy === 'overwrite'
        const specs: CanvasDownloadTaskSpec[] = []
        for (const item of lectureItems) {
          // teacher/ppt 指向同一 videoId；按用户实际勾选的角色产 spec，
          // 避免未勾选的一路被一并下载（修复「选教师/PPT 任一会两个都下」）
          const session = item.teacher ?? item.ppt
          if (!session) continue
          // 角色意图由 item.teacher / item.ppt 是否存在决定：可只产一路或两路
          const roles: Array<{ role: 'teacher' | 'ppt'; idx: number }> = []
          if (item.teacher) roles.push({ role: 'teacher', idx: 0 })
          if (item.ppt) roles.push({ role: 'ppt', idx: 1 })
          for (const { role: chRole, idx: chIdx } of roles) {
            const taskId = `canvas_lecture_${courseId}_${item.lectureNum}_${chRole}`
            const fileName = buildClassVideoFileName(courseName, session, chIdx)
            const destPath = videosDir ? join(videosDir, fileName) : ''
            // overwrite 模式不预跳过：交由 runTask 删旧文件后重下
            if (!overwrite && destPath && existsSync(destPath) && statSync(destPath).size > 0) {
              emitToRenderer('download:progress', {
                taskId, state: 'skipped', received: 0, total: 0, filePath: destPath, message: '已存在，跳过'
              })
              continue
            }
            specs.push({
              taskId,
              url: '', // 懒解析：下载前由 resolveDirectUrl 填入
              courseName: `Canvas课程/${cPath}/videos/课堂视频`,
              fileName,
              source: 'canvas-class-video',
              canvasCourseId: courseId,
              canvasVideoId: session.videoId,
              canvasVideoToken: token,
              canvasStreamIdx: chIdx
            })
          }
        }

        return { ok: true, specs }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
  ipcMain.handle('canvas:module-video-scan', async (_e, courseId: number) => {
    try {
      const session = getSession()
      // 拉全部模块 + items（含 ExternalTool/ExternalUrl/Page），不再只用 listModulePages
      const modules = await fetchCourseModules(session, courseId)

      // 三类视频来源
      const iframes: Array<{ moduleName: string; pageTitle: string; iframeUrl: string }> = []
      const extTools: Array<{ moduleItemId: number; fileId: string; title: string }> = []
      const extUrls: Array<{ uuid: string; title: string }> = []

      // ExternalTool: external_url = v.sjtu/.../#/playerPage/index?fileId=XXX
      const extToolRe = /playerPage\/index\?fileId=(\d+)/
      // ExternalUrl: vshare.sjtu.edu.cn/play/{uuid}
      const vshareRe = /vshare\.sjtu\.edu\.cn\/play\/([a-f0-9-]+)/i

      // 先收集 Page 项（需抓 body 找 iframe），同时收集 ExternalTool/ExternalUrl
      const knownVshareUuids = new Set<string>() // 用于 Page body vshare 去重
      const pageItems: Array<{ moduleName: string; pageTitle: string; pageUrl: string }> = []
      for (const m of modules) {
        for (const item of m.items) {
          if (item.type === 'ExternalTool' && item.externalUrl) {
            const m1 = extToolRe.exec(item.externalUrl)
            if (m1 && item.id) {
              extTools.push({ moduleItemId: item.id, fileId: m1[1], title: item.title })
            }
          } else if (item.type === 'ExternalUrl' && item.externalUrl) {
            const m2 = vshareRe.exec(item.externalUrl)
            if (m2) {
              extUrls.push({ uuid: m2[1], title: item.title })
              knownVshareUuids.add(m2[1])
            }
          } else if (item.type === 'Page' && item.pageUrl) {
            pageItems.push({ moduleName: m.name, pageTitle: item.title, pageUrl: item.pageUrl })
          }
        }
      }

      // PERF: 并行抓 Page body，每批 5 个，找 v.sjtu iframe embed
      const CONCURRENCY = 5
      for (let i = 0; i < pageItems.length; i += CONCURRENCY) {
        const batch = pageItems.slice(i, i + CONCURRENCY)
        const results = await Promise.allSettled(
          batch.map(async p => {
            const body = await fetchPageBody(session, courseId, p.pageUrl)
            return { page: p, body }
          })
        )
        for (let j = 0; j < results.length; j++) {
          const r = results[j]
          if (r.status !== 'fulfilled') {
            console.warn(`[canvas:module-video-scan] 页面抓取失败: ${batch[j].pageUrl}`, r.reason)
            continue
          }
          const found = extractVideoIframes(r.value.body)
          for (const url of found) {
            iframes.push({
              moduleName: r.value.page.moduleName,
              pageTitle: r.value.page.pageTitle,
              iframeUrl: url
            })
          }
          // Page body 中 <a href="vshare.../play/{uuid}"> 也作为 ExternalUrl 视频来源（去重）
          const vshareUuids = extractVshareLinks(r.value.body)
          for (const uuid of vshareUuids) {
            if (!knownVshareUuids.has(uuid)) {
              knownVshareUuids.add(uuid)
              extUrls.push({ uuid, title: r.value.page.pageTitle })
            }
          }
        }
      }

      console.log(`[canvas:module-video-scan] 课程 ${courseId}: iframe=${iframes.length} extTool=${extTools.length} extUrl=${extUrls.length}`)
      return { ok: true, tasks: iframes, extTools, extUrls }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 模块视频下载（ExternalTool / ExternalUrl 直接 MP4，走 download:start） ───
  // Page iframe HLS 不经此 handler，由渲染端调 download-module-video-now。
  ipcMain.handle(
    'canvas:module-video-download',
    async (
      _e,
      courseName: string,
      courseId: number,
      extTools: Array<{ moduleItemId: number; fileId: string; title: string }>,
      extUrls: Array<{ uuid: string; title: string }>,
      destRoot: string,
      conflictStrategy?: 'skip' | 'overwrite',
      term?: string
    ) => {
      try {
        const cPath = canvasCoursePath(courseName, term)
        const videosDir = destRoot ? join(destRoot, 'Canvas课程', ...cPath.split('/'), 'videos', '单元视频') : ''
        if (videosDir) mkdirSync(videosDir, { recursive: true })

        const overwrite = conflictStrategy === 'overwrite'
        const specs: CanvasDownloadTaskSpec[] = []
        const courseRel = `Canvas课程/${cPath}/videos/单元视频`

        // ExternalTool → v.sjtu LTI + /file/{id} → S3 MP4（懒解析，下载前由 resolveDirectUrl 填 url）
        for (const t of extTools) {
          const taskId = `canvas_exttool_${courseId}_${t.fileId}`
          const baseName = sanitizeFsName(`${courseName}-${t.title}`)
          const mp4Path = videosDir ? join(videosDir, `${baseName}.mp4`) : ''
          if (!overwrite && mp4Path && existsSync(mp4Path) && statSync(mp4Path).size > 0) {
            emitToRenderer('download:progress', { taskId, state: 'skipped', received: 0, total: 0, filePath: mp4Path, message: '已存在，跳过' })
            continue
          }
          specs.push({
            taskId,
            url: '',
            courseName: courseRel,
            fileName: `${baseName}.mp4`,
            source: 'canvas-exttool-video',
            canvasCourseId: courseId,
            canvasModuleItemId: t.moduleItemId,
            canvasFileId: t.fileId
          })
        }

        // ExternalUrl → vshare /api/video/play/{uuid} → S3 MP4（懒解析）
        for (const u of extUrls) {
          const taskId = `canvas_exturl_${courseId}_${u.uuid}`
          const baseName = sanitizeFsName(`${courseName}-${u.title}`)
          const mp4Path = videosDir ? join(videosDir, `${baseName}.mp4`) : ''
          if (!overwrite && mp4Path && existsSync(mp4Path) && statSync(mp4Path).size > 0) {
            emitToRenderer('download:progress', { taskId, state: 'skipped', received: 0, total: 0, filePath: mp4Path, message: '已存在，跳过' })
            continue
          }
          specs.push({
            taskId,
            url: '',
            courseName: courseRel,
            fileName: `${baseName}.mp4`,
            source: 'canvas-exturl-video',
            canvasCourseId: courseId,
            canvasVshareUuid: u.uuid
          })
        }

        return { ok: true, specs }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ─── 模块嵌入视频实时下载（HLS 流程，不走常规下载引擎） ───
  // [Bug 37 Fix] 等待全局并发槽位空闲，避免与主下载队列争抢带宽
  // [Conflict] 与 PPT 课件 / 常规文件一致的三层冲突检查：
  //   (1) cloud-only + skip：下载前先查云盘，已有则跳过整个下载（避免下完整视频再发现远端已存在）；
  //   (2) 本地：downloadModuleVideo 内部 existsSync 跳过（skip 复用已有 mp4；overwrite 由这里预先删旧）；
  //   (3) 上传：uploadLocalFileToCloud 内部 startChunkedUpload 的 HEAD 检查兜底，FileExistsError 视为跳过。
  ipcMain.handle(
    'canvas:download-module-video-now',
    async (
      _e,
      courseName: string,
      iframeUrl: string,
      baseName: string,
      destRoot: string,
      taskId: string,
      cloudUserToken?: string,
      conflictStrategy?: 'skip' | 'overwrite',
      transcodeMaxHeight?: number,
      term?: string
    ) => {
      try {
        const session = getSession()
        // cloud 模式渲染端传空 destRoot → 走跨平台临时目录兜底；local/both 传用户目录
        const localDest = destRoot || (process.platform === 'win32' ? 'C:/tmp' : '/tmp')
        const cPath = canvasCoursePath(courseName, term)
        const videosDir = join(localDest, 'Canvas课程', ...cPath.split('/'), 'videos', '单元视频')
        mkdirSync(videosDir, { recursive: true })

        const strategy = conflictStrategy ?? 'skip'
        // 云盘远端路径用 sanitizeFsName（与原行为一致）；本地 mp4/ts 用原始 baseName（downloadModuleVideo 内部如此）
        const remotePathBase = `SJTU Canvas课程/${cPath}/videos/单元视频/${sanitizeFsName(baseName)}`
        const localMp4 = join(videosDir, `${baseName}.mp4`)
        const localTs = join(videosDir, `${baseName}.ts`)

        // (1) cloud-only + skip：下载图片/切片前先查云盘是否已有该 mp4，已有则跳过整个下载。
        //     overwrite 不提前查（由 uploadLocalFileToCloud 内部 deleteCloudFile 处理）；
        //     both 模式本地需要 mp4，不提前查（云端 skip 由 uploadLocalFileToCloud 兜底）。
        if (cloudUserToken && !destRoot && strategy === 'skip') {
          if (await cloudFileExists(cloudUserToken, `${remotePathBase}.mp4`)) {
            console.log(`[hls] 云盘已存在，跳过: ${remotePathBase}.mp4`)
            return { ok: true, skipped: true, cloudPath: `${remotePathBase}.mp4` }
          }
        }

        // (2) overwrite：删本地旧 mp4/ts，强制重下（否则 downloadModuleVideo 的"已存在跳过"会跳过）
        if (strategy === 'overwrite') {
          try { if (existsSync(localMp4)) unlinkSync(localMp4) } catch { /* ignore */ }
          try { if (existsSync(localTs)) unlinkSync(localTs) } catch { /* ignore */ }
        }

        // 等待主下载队列有空闲并发槽位
        await waitForConcurrencySlot()

        // [Bug Fix] 占用一个全局活跃名额：让 sharedActiveCount 把正在跑的 HLS
        // 任务算进去，调度器才不会在 HLS 进行时继续拉本地/云任务到上限导致超发。
        // 必须在拿到槽位之后才 +1，否则等待期间会把自己也算进 active 反而更难拿到槽位。
        _hlsActiveReporter?.(1)
        let result
        try {
          result = await downloadModuleVideo(
            session,
            iframeUrl,
            videosDir,
            baseName,
            p => {
              emitToRenderer('canvas:hls-progress', {
                taskId,
                baseName,
                ...p
              })
            },
            transcodeMaxHeight
          )
        } finally {
          _hlsActiveReporter?.(-1)
        }

        // local 模式（无云盘目标）：不上传，按本地是否复用已有 mp4 标记 skipped
        if (!cloudUserToken) {
          return { ok: true, skipped: result.skipped, path: result.path, format: result.format }
        }

        // cloud/both 模式：下载完成后把 mp4 上传到云盘
        const remotePath = `${remotePathBase}.${result.format}`
        emitToRenderer('canvas:hls-progress', {
          taskId, baseName,
          phase: 'uploading', segmentsDone: 0, segmentsTotal: 0, bytesWritten: 0,
          message: '正在上传到云盘…'
        })
        try {
          const r = await uploadLocalFileToCloud(
            cloudUserToken,
            result.path,
            remotePath,
            strategy,
            (uploaded, total) => {
              emitToRenderer('canvas:hls-progress', {
                taskId, baseName,
                phase: 'uploading', segmentsDone: 0, segmentsTotal: 0,
                bytesWritten: uploaded,
                message: `上传中 ${Math.round(uploaded / 1048576)}/${Math.round(total / 1048576)}MB`
              })
            }
          )
          const cloudPath = r.path?.[0] ?? remotePath

          // cloud-only 模式（渲染端传空 destRoot → 走临时目录兜底）：
          // mp4 仅作上传中间产物，上传成功后清理避免长期累积。
          // local/both 模式 destRoot 非空（onDownload 守卫保证 localDestRoot 必填），
          // 文件是用户要的本地副本，保留不删。
          // 只删文件本身，不递归删目录——同目录可能有其他并发任务在写。
          if (!destRoot) {
            try { unlinkSync(result.path) } catch { /* ignore */ }
          }
          // 上传成功 = 云端有新产出，算成功（不标 skipped，即便本地是复用的已有 mp4）
          return { ok: true, path: result.path, format: result.format, cloudPath }
        } catch (err) {
          // skip 策略下远端已存在 → 跳过上传（云端无新产出，标 skipped，与 PPT 一致）
          if (err instanceof Error && err.name === 'FileExistsError') {
            if (!destRoot) {
              try { unlinkSync(result.path) } catch { /* ignore */ }
            }
            return { ok: true, skipped: true, cloudPath: remotePath }
          }
          // 上传失败：cloud-only 清理本地临时 mp4
          if (!destRoot) {
            try { unlinkSync(result.path) } catch { /* ignore */ }
          }
          const msg = err instanceof Error ? err.message : String(err)
          return { ok: false, path: result.path, error: `云盘上传失败: ${msg}` }
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ─── PPT 课件下载（图片 → PDF，可选云盘上传） ─────────────────
  //
  // 复用课堂视频扫描缓存的全课程级 LTI token（getCachedToken）。
  // 落盘目录与课堂视频一致：{destRoot}/Canvas课程/{term}/{course}/videos/课堂视频/{文件名}.pdf
  // cloud/both 模式：生成 PDF 后调 uploadLocalFileToCloud 上传到
  //   `SJTU Canvas课程/{cPath}/videos/课堂视频/{文件名}.pdf`
  // cloud-only（destRoot 空）：PDF 仅作上传中间产物，上传成功后删除本地副本。
  // 进度通过 canvas:ppt-progress 推送，带 taskId（讲次级 current/total + 图片进度进 phase）。

  /** 单讲 PPT：下载图片 → 合并 PDF → （可选）上传云盘 → 清理。
   *  返回 { ok, path, cloudPath, error }；skip 策略下云盘已存在视为跳过成功（cloudPath 仍返回）。
   *
   *  [PPT Fix] lecture.ivsVideoId 传的是加密串 videoId（前端原样传入，非 Number()），
   *  真实 PPT API 需要的 ivsVideoId = getVodVideoInfos 返回的 data.courId（数值）。
   *  这里用 resolveIvsVideoId 把加密串 videoId 解析成数值；解析失败（视频无流/未发布）跳过该讲。 */
  async function runPptLecture(
    session: Electron.Session,
    token: string,
    lecture: {
      ivsVideoId: string
      lectureName: string
      videoSession?: { beginTime: string; teacher: string; classroom: string }
    },
    baseOpts: { courseName: string; destRoot: string; term?: string },
    cloudOpts: { cloudUserToken?: string; conflictStrategy?: 'skip' | 'overwrite' },
    cPath: string,
    taskId: string | undefined,
    onLectureProgress: (imgCurrent: number, imgTotal: number, phase: string) => void
  ): Promise<{ ok: boolean; skipped?: boolean; path?: string; cloudPath?: string; error?: string }> {
    // lecture.ivsVideoId 是加密串 videoId（前端原样传入），用 resolveIvsVideoId 解析成
    // PPT API 真正需要的数值型 ivsVideoId（= getVodVideoInfos.data.courId）。
    const videoIdStr = lecture.ivsVideoId
    const realIvsVideoId = await resolveIvsVideoId(session, token, videoIdStr)
    if (!realIvsVideoId) {
      // 视频无流/未发布：跳过而非失败（自然也没有 PPT 课件可下）
      return { ok: true, skipped: true }
    }

    // 动态 import（懒加载 pdf-lib 等重依赖）
    const { downloadPptAsPdf, buildPptFileNameForLecture } = await import('./ppt-download')

    // cloud-only（destRoot 空）+ skip：下载图片前先查云盘是否已有该 PDF，已有则跳过整个下载，
    // 避免先下几十张图 + 合并 PDF 再发现远端已存在。overwrite 不提前查（由 uploadLocalFileToCloud
    // 内部 deleteCloudFile 处理）；both 模式本地需要 PDF，不提前查（云端 skip 由 uploadLocalFileToCloud 兜底）。
    if (cloudOpts.cloudUserToken && !baseOpts.destRoot && (cloudOpts.conflictStrategy ?? 'skip') === 'skip') {
      const fileName = buildPptFileNameForLecture(lecture.lectureName, lecture.videoSession)
      const remotePath = `SJTU Canvas课程/${cPath}/videos/课堂视频/${fileName}`
      if (await cloudFileExists(cloudOpts.cloudUserToken, remotePath)) {
        console.log(`[ppt] 云盘已存在，跳过: ${remotePath}`)
        return { ok: true, skipped: true, cloudPath: remotePath }
      }
    }

    const result = await downloadPptAsPdf(session, token, {
      ivsVideoId: realIvsVideoId,
      courseName: baseOpts.courseName,
      lectureName: lecture.lectureName,
      destRoot: baseOpts.destRoot,
      term: baseOpts.term,
      videoSession: lecture.videoSession,
      conflictStrategy: cloudOpts.conflictStrategy
    }, onLectureProgress)

    // 无 PPT 课件（skipped 且无 path）→ 跳过；本地已存在 PDF（skipped 但有 path）→ 继续走上传
    if (result.skipped && !result.path) {
      return { ok: true, skipped: true }
    }
    if (!result.ok || !result.path || !result.fileName) {
      return { ok: false, error: result.error }
    }

    // local 模式（无云盘目标）：不上传，保留 skipped 标记（本地是否跳过）
    if (!cloudOpts.cloudUserToken) {
      return { ok: true, skipped: result.skipped, path: result.path }
    }
    const remotePath = `SJTU Canvas课程/${cPath}/videos/课堂视频/${result.fileName}`
    if (taskId) {
      emitToRenderer('canvas:ppt-progress', {
        taskId, ivsVideoId: lecture.ivsVideoId,
        current: 0, total: 0, phase: `${lecture.lectureName} · 上传云盘…`
      })
    }
    try {
      const r = await uploadLocalFileToCloud(
        cloudOpts.cloudUserToken,
        result.path,
        remotePath,
        cloudOpts.conflictStrategy ?? 'skip'
      )
      const cloudPath = r.path?.[0] ?? remotePath
      // cloud-only（destRoot 空）：上传成功后清理本地临时 PDF，避免长期累积
      if (!baseOpts.destRoot) {
        try { unlinkSync(result.path) } catch { /* ignore */ }
      }
      // 上传成功 = 云端有新产出，算成功（不标 skipped，即便本地是跳过复用的已有 PDF）
      return { ok: true, path: result.path, cloudPath }
    } catch (err) {
      // skip 策略下远端已存在 → 跳过上传（云端无新产出，标 skipped）
      if (err instanceof Error && err.name === 'FileExistsError') {
        if (!baseOpts.destRoot) {
          try { unlinkSync(result.path) } catch { /* ignore */ }
        }
        return { ok: true, skipped: true, path: result.path, cloudPath: remotePath }
      }
      const msg = err instanceof Error ? err.message : String(err)
      // 上传失败：cloud-only 清理本地临时 PDF
      if (!baseOpts.destRoot) {
        try { unlinkSync(result.path) } catch { /* ignore */ }
      }
      return { ok: false, path: result.path, error: `云盘上传失败: ${msg}` }
    }
  }

  /** 下载单讲 PPT 课件图片并合并为 PDF（可选云盘上传） */
  ipcMain.handle('canvas:ppt-download', async (_event, opts: {
    taskId?: string
    ivsVideoId: string
    courseName: string
    lectureName: string
    destRoot: string
    cloudUserToken?: string
    conflictStrategy?: 'skip' | 'overwrite'
    term?: string
    videoSession?: { beginTime: string; teacher: string; classroom: string }
  }) => {
    try {
      const session = getSession()
      const token = getCachedToken()
      if (!token) {
        return { ok: false, error: '请先点击"课堂视频"扫描课程，以获取访问token' }
      }
      const cPath = canvasCoursePath(opts.courseName, opts.term)
      const result = await runPptLecture(
        session, token,
        { ivsVideoId: opts.ivsVideoId, lectureName: opts.lectureName, videoSession: opts.videoSession },
        { courseName: opts.courseName, destRoot: opts.destRoot, term: opts.term },
        { cloudUserToken: opts.cloudUserToken, conflictStrategy: opts.conflictStrategy },
        cPath, opts.taskId,
        (current, total, phase) => {
          emitToRenderer('canvas:ppt-progress', {
            taskId: opts.taskId, ivsVideoId: opts.ivsVideoId, current, total,
            phase: `${opts.lectureName} · ${phase}`, lectureName: opts.lectureName
          })
        }
      )
      return result
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /** 批量下载多讲 PPT 课件（可选云盘上传）。
   *  进度事件 canvas:ppt-progress 带 taskId：current/total 为讲次级（X/Y 讲），
   *  单讲内的图片下载进度折进 phase 文案，避免讲次级进度条跳动。 */
  ipcMain.handle('canvas:ppt-download-batch', async (_event, opts: {
    taskId?: string
    lectures: Array<{ ivsVideoId: string; lectureName: string; videoSession?: { beginTime: string; teacher: string; classroom: string } }>
    courseName: string
    destRoot: string
    cloudUserToken?: string
    conflictStrategy?: 'skip' | 'overwrite'
    term?: string
  }) => {
    try {
      const session = getSession()
      const token = getCachedToken()
      if (!token) {
        return { ok: false, error: '请先点击"课堂视频"扫描课程，以获取访问token' }
      }
      const cPath = canvasCoursePath(opts.courseName, opts.term)
      const taskId = opts.taskId
      const total = opts.lectures.length
      const results: Array<{ lectureName: string; ok: boolean; skipped?: boolean; path?: string; cloudPath?: string; error?: string }> = []

      if (taskId) {
        emitToRenderer('canvas:ppt-progress', { taskId, ivsVideoId: 0, current: 0, total, phase: '开始下载PPT课件…' })
      }

      for (let i = 0; i < opts.lectures.length; i++) {
        const lecture = opts.lectures[i]
        if (taskId) {
          emitToRenderer('canvas:ppt-progress', {
            taskId, ivsVideoId: lecture.ivsVideoId, current: i, total,
            phase: `下载 ${lecture.lectureName}…`, lectureName: lecture.lectureName
          })
        }
        const result = await runPptLecture(
          session, token, lecture,
          { courseName: opts.courseName, destRoot: opts.destRoot, term: opts.term },
          { cloudUserToken: opts.cloudUserToken, conflictStrategy: opts.conflictStrategy },
          cPath, taskId,
          (imgCurrent, imgTotal, phase) => {
            // 讲次级 current/total 不变，图片进度折进 phase
            if (!taskId) return
            emitToRenderer('canvas:ppt-progress', {
              taskId, ivsVideoId: lecture.ivsVideoId, current: i, total,
              phase: `${lecture.lectureName} · ${phase}`, lectureName: lecture.lectureName
            })
          }
        )
        results.push({ lectureName: lecture.lectureName, ...result })
        if (taskId) {
          emitToRenderer('canvas:ppt-progress', {
            taskId, ivsVideoId: lecture.ivsVideoId, current: i + 1, total,
            phase: result.skipped ? `${lecture.lectureName} 跳过` : (result.ok ? `${lecture.lectureName} 完成` : `${lecture.lectureName} 失败`),
            lectureName: lecture.lectureName
          })
        }
      }

      if (taskId) {
        emitToRenderer('canvas:ppt-progress', { taskId, ivsVideoId: 0, current: total, total, phase: '完成' })
      }
      return { ok: true, results }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

/** 获取缓存的 LTI token（由 classVideoScan 流程写入） */
let _cachedLtiToken: string | null = null

export function setCachedLtiToken(token: string | null): void {
  _cachedLtiToken = token
}

function getCachedToken(): string | null {
  return _cachedLtiToken
}

// ─── 讲次分组 ─────────────────────────────────────────────────

/** 批量取文件 meta（并发 5），把补漏 fileId 列表转成完整 CanvasFileItem[]。
 *  失败的单个文件被跳过（meta 拿不到就不显示，不影响其它文件）。
 *
 *  落盘目录策略（对齐浏览器「文件」tab 真实结构）：
 *  - 模块补漏（folderIdOverride 未传）：用 meta 返回的真实 folderId，folderMap 自动映射到真实目录；
 *    真实 folderId 查不到时兜底落 files/ 根。
 *  - 大纲补漏（folderIdOverride = -3）：固定映射到 files/大纲/，对应浏览器「大纲」tab 引用的文件
 *    （这类文件的真实 folder 通常不在课程 folderMap 里，「文件」tab 也看不到）。 */
async function fetchFileMetaBatch(
  session: Electron.Session,
  fileIds: number[],
  folderIdOverride?: number
): Promise<CanvasFileItem[]> {
  if (fileIds.length === 0) return []
  const CONCURRENCY = 5
  const results: CanvasFileItem[] = []
  for (let i = 0; i < fileIds.length; i += CONCURRENCY) {
    const batch = fileIds.slice(i, i + CONCURRENCY)
    const metas = await Promise.allSettled(batch.map(fid => fetchFileMeta(session, fid)))
    metas.forEach((r, idx) => {
      if (r.status !== 'fulfilled' || !r.value || !r.value.url) return
      const fid = batch[idx]
      results.push({
        fileId: fid,
        displayName: r.value.displayName,
        filename: r.value.displayName,
        url: r.value.url,
        size: r.value.size,
        folderId: folderIdOverride ?? r.value.folderId,
        locked: false
      })
    })
  }
  return results
}

interface LectureGroup {
  lectureNum: number
  date: string
  teacher?: CanvasVideoSession
}

/** 将视频列表按讲次分组。
 *  统一规则：每条记录 = 1 讲，内含教师+PPT 两路流（通过 getVodVideoInfos 获取）。 */
function groupLectures(sessions: CanvasVideoSession[]): LectureGroup[] {
  const withNum = sessions.map(s => ({
    session: s,
    num: extractLectureNum(s.videoName)
  }))
  withNum.sort((a, b) => a.num - b.num || a.session.beginTime.localeCompare(b.session.beginTime))

  return withNum.map((item, idx) => ({
    lectureNum: idx + 1,
    date: item.session.beginTime.split(' ')[0] || 'unknown',
    teacher: item.session   // getVodVideoInfos 会返回教师+PPT 两路流
  }))
}
