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
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  CANVAS_BASE_URL,
  type CanvasDownloadTaskSpec,
  type CanvasFileItem,
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
  listModulePages,
  fetchFileMeta,
  sanitizeFsName
} from './api'
import {
  extractLtiToken,
  fetchVodVideoList,
  buildClassVideoFileName,
  extractLectureNum
} from './video-tokens'
import { downloadModuleVideo } from './hls-download'

let ses: Electron.Session | null = null

export function setCanvasSession(session: Electron.Session): void {
  ses = session
}

function getSession(): Electron.Session {
  if (!ses) throw new Error('Canvas session not initialized')
  return ses
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

      emitScanProgress(courseId, 'done', '扫描完成')

      return {
        ok: true,
        files: files.filter(f => f.url && !f.locked),
        folderMap: Object.fromEntries(folderMap),
        moduleFileIds,
        syllabusFileIds
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
      moduleFileIds: number[],
      syllabusFileIds: number[],
      destRoot: string
    ) => {
      const specs: CanvasDownloadTaskSpec[] = []

      // Files
      for (const f of files) {
        const relDir = folderMap[f.folderId ?? -1] || ''
        specs.push({
          taskId: `canvas_file_${courseId}_${f.fileId}`,
          url: f.url,
          courseName: `Canvas课程/${sanitizeFsName(courseName)}/files${relDir ? '/' + relDir : ''}`,
          fileName: sanitizeFsName(f.displayName),
          source: 'canvas-files',
          canvasCourseId: courseId,
          canvasRelPath: relDir
        })
      }

      // Module 补漏
      for (const fid of moduleFileIds) {
        specs.push({
          taskId: `canvas_mod_${courseId}_${fid}`,
          url: '', // lazy: 需要先获取 meta
          courseName: `Canvas课程/${sanitizeFsName(courseName)}/files/_from_modules`,
          fileName: '',
          source: 'canvas-modules',
          canvasCourseId: courseId
        })
      }

      // Syllabus 补漏
      for (const fid of syllabusFileIds) {
        specs.push({
          taskId: `canvas_syl_${courseId}_${fid}`,
          url: '',
          courseName: `Canvas课程/${sanitizeFsName(courseName)}/files/_from_syllabus`,
          fileName: '',
          source: 'canvas-syllabus',
          canvasCourseId: courseId
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

      return { ok: true, sessions, teachers, lectures, token: tokenData.token, canvasCourseId: tokenData.canvasCourseId }
    } catch (err) {
      console.log('[canvas] 课堂视频扫描异常:', err)
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
      conflictStrategy?: 'skip' | 'overwrite'
    ) => {
      try {
        const videosDir = destRoot ? join(destRoot, 'Canvas课程', sanitizeFsName(courseName), 'videos') : ''
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
              courseName: `Canvas课程/${sanitizeFsName(courseName)}/videos`,
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
      lectureItems: Array<{ lectureNum: number; teacher?: CanvasVideoSession; ppt?: CanvasVideoSession }>,
      token: string,
      destRoot: string,
      conflictStrategy?: 'skip' | 'overwrite'
    ) => {
      try {
        const videosDir = destRoot ? join(destRoot, 'Canvas课程', sanitizeFsName(courseName), 'videos') : ''
        if (videosDir) mkdirSync(videosDir, { recursive: true })

        const overwrite = conflictStrategy === 'overwrite'
        const specs: CanvasDownloadTaskSpec[] = []
        for (const item of lectureItems) {
          // teacher/ppt 指向同一 videoId；每讲产 2 个占位 spec，下载时各自解析对应 streamIdx
          const session = item.teacher ?? item.ppt
          if (!session) continue
          for (let chIdx = 0; chIdx < 2; chIdx++) {
            const chRole = chIdx === 0 ? 'teacher' : 'ppt'
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
              courseName: `Canvas课程/${sanitizeFsName(courseName)}/videos`,
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
      const pages = await listModulePages(session, courseId)
      const tasks: Array<{
        moduleName: string
        pageTitle: string
        iframeUrl: string
      }> = []

      // PERF: 并行抓取页面 body，每批最多 5 个并发，避免串行等待 30 个页面
      const CONCURRENCY = 5
      for (let i = 0; i < pages.length; i += CONCURRENCY) {
        const batch = pages.slice(i, i + CONCURRENCY)
        const results = await Promise.allSettled(
          batch.map(async p => {
            const body = await fetchPageBody(session, courseId, p.pageUrl)
            return { page: p, body }
          })
        )
        for (const r of results) {
          if (r.status !== 'fulfilled') continue
          const iframes = extractVideoIframes(r.value.body)
          for (const url of iframes) {
            tasks.push({
              moduleName: r.value.page.moduleName,
              pageTitle: r.value.page.pageTitle,
              iframeUrl: url
            })
          }
        }
      }

      return { ok: true, tasks }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 模块嵌入视频下载 ───
  ipcMain.handle(
    'canvas:module-video-download',
    async (
      _e,
      courseName: string,
      courseId: number,
      tasks: Array<{ moduleName: string; pageTitle: string; iframeUrl: string }>,
      destRoot: string,
      conflictStrategy?: 'skip' | 'overwrite'
    ) => {
      try {
        const videosDir = destRoot ? join(destRoot, 'Canvas课程', sanitizeFsName(courseName), 'videos') : ''
        if (videosDir) mkdirSync(videosDir, { recursive: true })

        const overwrite = conflictStrategy === 'overwrite'
        const specs: CanvasDownloadTaskSpec[] = []
        for (const t of tasks) {
          const baseName = sanitizeFsName(`${courseName}-${t.pageTitle}`)
          const mp4Path = videosDir ? join(videosDir, `${baseName}.mp4`) : ''
          // overwrite 模式不预跳过：交由 runTask 删旧文件后重下
          if (!overwrite && mp4Path && existsSync(mp4Path) && statSync(mp4Path).size > 0) {
            emitToRenderer('download:progress', {
              taskId: `canvas_mvid_${courseId}_${sanitizeFsName(t.pageTitle)}`, state: 'skipped', received: 0, total: 0, filePath: mp4Path, message: '已存在，跳过'
            })
            continue
          }

          specs.push({
            taskId: `canvas_mvid_${courseId}_${sanitizeFsName(t.pageTitle)}`,
            url: t.iframeUrl,
            courseName: `Canvas课程/${sanitizeFsName(courseName)}/videos`,
            fileName: `${baseName}.mp4`,
            source: 'canvas-module-video',
            canvasCourseId: courseId
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
  ipcMain.handle(
    'canvas:download-module-video-now',
    async (
      _e,
      courseName: string,
      iframeUrl: string,
      baseName: string,
      destRoot: string
    ) => {
      try {
        const session = getSession()
        const videosDir = join(destRoot, 'Canvas课程', sanitizeFsName(courseName), 'videos')
        mkdirSync(videosDir, { recursive: true })

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
                baseName,
                ...p
              })
            }
          )
        } finally {
          _hlsActiveReporter?.(-1)
        }

        return { ok: true, path: result.path, format: result.format }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}

// ─── 讲次分组 ─────────────────────────────────────────────────

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
