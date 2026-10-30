/**
 * Canvas 下载编排器 — 注册 IPC 处理器，协调扫描 / 下载流程
 *
 * 对应 Python main.py 的 _run_course_pipeline 以及各 downloader 模块的调用入口。
 * 所有 Canvas IPC handler 在这里集中注册。
 */
import { ipcMain } from 'electron'
import { validateIpcSender, DEFAULT_UNTRUSTED_IPC_ERROR } from '../utils/ipc-guard'
import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { digest } from '../backup/catalog'
import type {
  CanvasAssignmentItem,
  CanvasDownloadTaskSpec,
  CanvasFileItem,
  CanvasLectureDownloadItem,
  CanvasVideoSession,
  VideoQualityOption,
  CanvasAssignmentExportOptions
} from '../../shared/types'
import { buildCloudRemoteSegments } from '../../shared/utils'
import { downloadAssignmentArchive } from './assignment-download'
import { downloadLectureTranscript } from './transcript-download'
import {
  listCourses,
  fetchCourseModules,
  fetchPageBody,
  extractVideoIframes,
  extractVshareLinks,
  fetchFileMeta,
  sanitizeFsName
} from './api'
import {
  buildClassVideoFileName,
  extractLectureNum
} from './video-tokens'
import { fetchLegacyVodStreamUrls } from './legacy-video'
import { isLegacyCanvasVideo } from '../../shared/canvas-video'
import { downloadModuleVideo } from './hls-download'
import { cloudFileExists, uploadLocalFileToCloud } from '../cloudpan'

import {
  setCanvasSession,
  getSession,
  invalidateCanvasLogin,
  ensureCanvasLogin
} from './auth-sso'
import {
  setCanvasEmitter,
  emitToRenderer
} from './events'
import {
  scanCourse,
  scanCanvasClassVideos,
  setCachedLtiToken,
  getCachedToken
} from './scanner'
import {
  canvasCoursePath,
  handlePptDownload,
  handlePptDownloadBatch
} from './ppt-orchestrator'

export {
  setCanvasSession,
  invalidateCanvasLogin,
  ensureCanvasLogin,
  setCanvasEmitter,
  scanCourse,
  scanCanvasClassVideos,
  setCachedLtiToken
}

// ─── 并发槽位控制 ─────────────────────────────────────────────

type ConcurrencyProvider = () => { active: number; concurrency: number }
let _concurrencyProvider: ConcurrencyProvider | null = null

export function setConcurrencyProvider(provider: ConcurrencyProvider): void {
  _concurrencyProvider = provider
}

type HlsActiveReporter = (delta: number) => void
let _hlsActiveReporter: HlsActiveReporter | null = null

export function setHlsActiveReporter(reporter: HlsActiveReporter): void {
  _hlsActiveReporter = reporter
}

const concurrencyResolvers = new Set<() => void>()

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
    let resolver!: () => void
    const slotPromise = new Promise<void>(r => { resolver = r })
    concurrencyResolvers.add(resolver)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        slotPromise,
        new Promise<void>(r => { timer = setTimeout(r, 10_000) })
      ])
    } finally {
      concurrencyResolvers.delete(resolver)
      if (timer) clearTimeout(timer)
    }
  }
}

// ─── 注册所有 Canvas IPC handler ──────────────────────────────

export function registerCanvasHandlers(): void {
  const handle: typeof ipcMain.handle = (channel, listener) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!validateIpcSender(event)) {
        return { ok: false, error: DEFAULT_UNTRUSTED_IPC_ERROR }
      }
      return listener(event, ...args)
    })

  // ─── 列出课程 ───
  handle('canvas:list-courses', async () => {
    try {
      const loggedIn = await ensureCanvasLogin()
      if (!loggedIn) return { ok: false, error: 'Canvas 登录失败，请先登录 jAccount' }

      try {
        const courses = await listCourses(getSession())
        return { ok: true, courses }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('401') || msg.includes('未经身份验证')) {
          console.log('[canvas] API 401，清除 SSO 缓存重试')
          invalidateCanvasLogin()
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
  handle('canvas:scan-course', async (_e, courseId: number) => {
    return scanCourse(getSession(), courseId)
  })

  // ─── 构建下载任务 spec 列表 ───
  handle(
    'canvas:build-download-specs',
    async (
      _e,
      courseName: string,
      courseId: number,
      files: CanvasFileItem[],
      folderMap: Record<number, string>,
      _destRoot: string,
      term?: string
    ) => {
      const specs: CanvasDownloadTaskSpec[] = []
      const cPath = canvasCoursePath(courseName, term)

      for (const f of files) {
        const relDir = folderMap[f.folderId ?? -1] || ''
        specs.push({
          taskId: `canvas_file_${courseId}_${f.fileId}`,
          url: f.url,
          courseName: `Canvas课程/${cPath}/files${relDir ? '/' + relDir : ''}`,
          fileName: sanitizeFsName(f.displayName),
          source: 'canvas-files',
          rawFileId: f.fileId,
          resourceSize: f.size,
          resourceVersion: digest(JSON.stringify([f.fileId, f.updatedAt || '', f.size, f.displayName])),
          backupCourse: { key: `canvas:${courseId}`, source: 'canvas', id: String(courseId), name: courseName, term },
          canvasCourseId: courseId,
          canvasRelPath: relDir
        })
      }

      return { ok: true, specs }
    }
  )

  // ─── 获取单个 Canvas 文件 meta（用于 lazy resolution） ───
  handle('canvas:file-meta', async (_e, fileId: number) => {
    try {
      const meta = await fetchFileMeta(getSession(), fileId)
      return { ok: true, meta }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 课堂视频扫描 ───
  handle('canvas:class-video-scan', (_e, courseId: number) => scanCanvasClassVideos(courseId))

  // ─── 课堂视频下载 ───
  handle(
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
        const session = getSession()
        const cPath = canvasCoursePath(courseName, term)
        const videosDir = destRoot ? join(destRoot, 'Canvas课程', ...cPath.split('/'), 'videos', '课堂视频') : ''
        if (videosDir) mkdirSync(videosDir, { recursive: true })

        const overwrite = conflictStrategy === 'overwrite'
        const filtered = sessions.filter(s => selectedTeachers.includes(s.teacher))
        const specs: CanvasDownloadTaskSpec[] = []

        for (let idx = 0; idx < filtered.length; idx++) {
          const s = filtered[idx]
          const isLegacy = isLegacyCanvasVideo(s)
          if (isLegacy) {
            const streamUrls = await fetchLegacyVodStreamUrls(session, s.videoId)
            const lecNum = extractLectureNum(s.videoName) || (idx + 1)
            if (streamUrls.teacherUrl) {
              const fileName = `${sanitizeFsName(courseName)} - 第${lecNum}讲 教师视角 (MP4).mp4`
              const destPath = videosDir ? join(videosDir, fileName) : ''
              const taskId = `canvas_legacy_vid_${courseId}_${s.videoId}_0`
              if (!overwrite && destPath && existsSync(destPath) && statSync(destPath).size > 0) {
                emitToRenderer('download:progress', {
                  taskId, state: 'skipped', received: 0, total: 0, filePath: destPath, message: '已存在，跳过'
                })
              } else {
                specs.push({
                  taskId,
                  url: streamUrls.teacherUrl,
                  courseName: `Canvas课程/${cPath}/videos/课堂视频`,
                  fileName,
                  source: 'canvas-video',
                  canvasCourseId: courseId,
                  canvasVideoId: s.videoId,
                  canvasStreamIdx: 0,
                  isHls: false
                })
              }
            }
            if (streamUrls.pptUrl) {
              const fileName = `${sanitizeFsName(courseName)} - 第${lecNum}讲 PPT投影视角 (MP4).mp4`
              const destPath = videosDir ? join(videosDir, fileName) : ''
              const taskId = `canvas_legacy_vid_${courseId}_${s.videoId}_1`
              if (!overwrite && destPath && existsSync(destPath) && statSync(destPath).size > 0) {
                emitToRenderer('download:progress', {
                  taskId, state: 'skipped', received: 0, total: 0, filePath: destPath, message: '已存在，跳过'
                })
              } else {
                specs.push({
                  taskId,
                  url: streamUrls.pptUrl,
                  courseName: `Canvas课程/${cPath}/videos/课堂视频`,
                  fileName,
                  source: 'canvas-video',
                  canvasCourseId: courseId,
                  canvasVideoId: s.videoId,
                  canvasStreamIdx: 1,
                  isHls: false
                })
              }
            }
          } else {
            for (let chIdx = 0; chIdx < 2; chIdx++) {
              const fileName = buildClassVideoFileName(courseName, s, chIdx)
              const destPath = videosDir ? join(videosDir, fileName) : ''
              const taskId = `canvas_cvid_${courseId}_${s.courId}_${chIdx}`
              if (!overwrite && destPath && existsSync(destPath) && statSync(destPath).size > 0) {
                emitToRenderer('download:progress', {
                  taskId, state: 'skipped', received: 0, total: 0, filePath: destPath, message: '已存在，跳过'
                })
                continue
              }
              specs.push({
                taskId,
                url: '',
                courseName: `Canvas课程/${cPath}/videos/课堂视频`,
                fileName,
                source: 'canvas-class-video',
                canvasCourseId: courseId,
                canvasVideoId: s.videoId,
                canvasVideoToken: token,
                canvasStreamIdx: chIdx,
                isHls: true
              })
            }
          }
        }

        return { ok: true, specs }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ─── 按讲次下载课堂视频 ───
  handle(
    'canvas:download-lectures',
    async (
      _e,
      courseName: string,
      courseId: number,
      lectureItems: CanvasLectureDownloadItem[],
      token: string,
      destRoot: string,
      conflictStrategy?: 'skip' | 'overwrite',
      term?: string,
      qualityOption?: VideoQualityOption
    ) => {
      try {
        const cPath = canvasCoursePath(courseName, term)
        const videosDir = destRoot ? join(destRoot, 'Canvas课程', ...cPath.split('/'), 'videos', '课堂视频') : ''
        if (videosDir) mkdirSync(videosDir, { recursive: true })

        const overwrite = conflictStrategy === 'overwrite'
        const isAudioOnly = qualityOption === 'audio_only'
        const specs: CanvasDownloadTaskSpec[] = []
        for (const item of lectureItems) {
          const session = item.teacher ?? item.ppt
          if (!session) continue
          const isLegacy = isLegacyCanvasVideo(session)

          if (isLegacy) {
            const streamUrls = await fetchLegacyVodStreamUrls(getSession(), session.videoId)
            if (item.teacher && streamUrls.teacherUrl) {
              const rawFileName = `${sanitizeFsName(courseName)} - 第${item.lectureNum}讲 教师视角 (MP4).mp4`
              const fileName = isAudioOnly ? rawFileName.replace(/\.mp4$/, '.m4a') : rawFileName
              const destPath = videosDir ? join(videosDir, fileName) : ''
              const taskId = `canvas_lecture_${courseId}_${item.lectureNum}_teacher`
              if (!overwrite && destPath && existsSync(destPath) && statSync(destPath).size > 0) {
                emitToRenderer('download:progress', {
                  taskId, state: 'skipped', received: 0, total: 0, filePath: destPath, message: '已存在，跳过'
                })
              } else {
                specs.push({
                  taskId,
                  url: streamUrls.teacherUrl,
                  courseName: `Canvas课程/${cPath}/videos/课堂视频`,
                  fileName,
                  source: 'canvas-video',
                  canvasCourseId: courseId,
                  canvasVideoId: session.videoId,
                  canvasStreamIdx: 0,
                  isHls: false,
                  extractAudio: isAudioOnly
                })
              }
            }
            if (item.ppt && !isAudioOnly && streamUrls.pptUrl) {
              const fileName = `${sanitizeFsName(courseName)} - 第${item.lectureNum}讲 PPT投影视角 (MP4).mp4`
              const destPath = videosDir ? join(videosDir, fileName) : ''
              const taskId = `canvas_lecture_${courseId}_${item.lectureNum}_ppt`
              if (!overwrite && destPath && existsSync(destPath) && statSync(destPath).size > 0) {
                emitToRenderer('download:progress', {
                  taskId, state: 'skipped', received: 0, total: 0, filePath: destPath, message: '已存在，跳过'
                })
              } else {
                specs.push({
                  taskId,
                  url: streamUrls.pptUrl,
                  courseName: `Canvas课程/${cPath}/videos/课堂视频`,
                  fileName,
                  source: 'canvas-video',
                  canvasCourseId: courseId,
                  canvasVideoId: session.videoId,
                  canvasStreamIdx: 1,
                  isHls: false
                })
              }
            }
          } else {
            const roles: Array<{ role: 'teacher' | 'ppt'; idx: number }> = []
            if (item.teacher) roles.push({ role: 'teacher', idx: 0 })
            if (item.ppt && !isAudioOnly) roles.push({ role: 'ppt', idx: 1 })
            for (const { role: chRole, idx: chIdx } of roles) {
              const taskId = `canvas_lecture_${courseId}_${item.lectureNum}_${chRole}`
              const rawFileName = buildClassVideoFileName(courseName, session, chIdx)
              const fileName = isAudioOnly ? rawFileName.replace(/\.mp4$/, '.m4a') : rawFileName
              const destPath = videosDir ? join(videosDir, fileName) : ''
              if (!overwrite && destPath && existsSync(destPath) && statSync(destPath).size > 0) {
                emitToRenderer('download:progress', {
                  taskId, state: 'skipped', received: 0, total: 0, filePath: destPath, message: '已存在，跳过'
                })
                continue
              }
              specs.push({
                taskId,
                url: '',
                courseName: `Canvas课程/${cPath}/videos/课堂视频`,
                fileName,
                source: 'canvas-class-video',
                canvasCourseId: courseId,
                canvasVideoId: session.videoId,
                canvasVideoToken: token,
                canvasStreamIdx: chIdx,
                isHls: true,
                extractAudio: isAudioOnly
              })
            }
          }
        }

        return { ok: true, specs }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ─── 模块视频扫描 ───
  handle('canvas:module-video-scan', async (_e, courseId: number) => {
    try {
      const session = getSession()
      const modules = await fetchCourseModules(session, courseId)

      const iframes: Array<{ moduleName: string; pageTitle: string; iframeUrl: string }> = []
      const extTools: Array<{ moduleItemId: number; fileId: string; title: string }> = []
      const extUrls: Array<{ uuid: string; title: string }> = []

      const extToolRe = /playerPage\/index\?fileId=(\d+)/
      const vshareRe = /vshare\.sjtu\.edu\.cn\/play\/([a-f0-9-]+)/i

      const knownVshareUuids = new Set<string>()
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

  // ─── 模块视频下载（直接 MP4，走 download:start） ───
  handle(
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

  // ─── 模块嵌入视频实时下载（HLS 流程） ───
  handle(
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
      qualityOption?: number | string,
      term?: string,
      cloudDestRoot?: string
    ) => {
      try {
        const session = getSession()
        const localDest = destRoot || (process.platform === 'win32' ? 'C:/tmp' : '/tmp')
        const cPath = canvasCoursePath(courseName, term)
        const videosDir = join(localDest, 'Canvas课程', ...cPath.split('/'), 'videos', '单元视频')
        mkdirSync(videosDir, { recursive: true })

        const strategy = conflictStrategy ?? 'skip'
        const remotePathBase = buildCloudRemoteSegments(
          cloudDestRoot,
          [...cPath.split('/'), 'videos', '单元视频', sanitizeFsName(baseName)],
          'SJTU Canvas课程'
        ).join('/')
        const localMp4 = join(videosDir, `${baseName}.mp4`)
        const localTs = join(videosDir, `${baseName}.ts`)

        if (cloudUserToken && !destRoot && strategy === 'skip') {
          if (await cloudFileExists(cloudUserToken, `${remotePathBase}.mp4`)) {
            console.log(`[hls] 云盘已存在，跳过: ${remotePathBase}.mp4`)
            return { ok: true, skipped: true, cloudPath: `${remotePathBase}.mp4` }
          }
        }

        if (strategy === 'overwrite') {
          try { if (existsSync(localMp4)) unlinkSync(localMp4) } catch { /* ignore */ }
          try { if (existsSync(localTs)) unlinkSync(localTs) } catch { /* ignore */ }
        }

        await waitForConcurrencySlot()

        _hlsActiveReporter?.(1)
        const isAudioOnly = qualityOption === 'audio_only'
        const maxHeight = typeof qualityOption === 'number' ? qualityOption : (qualityOption === '720p' ? 720 : qualityOption === '1080p' ? 1080 : undefined)

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
            maxHeight,
            isAudioOnly
          )
        } finally {
          _hlsActiveReporter?.(-1)
        }

        if (!cloudUserToken) {
          return { ok: true, skipped: result.skipped, path: result.path, format: result.format }
        }

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

          if (!destRoot) {
            try { unlinkSync(result.path) } catch { /* ignore */ }
          }
          return { ok: true, path: result.path, format: result.format, cloudPath }
        } catch (err) {
          if (err instanceof Error && err.name === 'FileExistsError') {
            if (!destRoot) {
              try { unlinkSync(result.path) } catch { /* ignore */ }
            }
            return { ok: true, skipped: true, cloudPath: remotePath }
          }
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

  // ─── PPT 课件单讲 / 批量下载 ───
  handle('canvas:ppt-download', async (_event, opts) => handlePptDownload(opts))
  handle('canvas:ppt-download-batch', async (_event, opts) => handlePptDownloadBatch(opts))

  // ─── 批量下载课程作业 (Assignments & Submissions) ───
  handle('canvas:assignment-download-batch', async (_event, opts: {
    taskId?: string
    courseId: number
    courseName: string
    assignments: CanvasAssignmentItem[]
    destRoot: string
    term?: string
    conflictStrategy?: 'skip' | 'overwrite'
    options?: CanvasAssignmentExportOptions
    cloudUserToken?: string
    cloudDestRoot?: string
  }) => {
    try {
      const session = getSession()
      const taskId = opts.taskId
      const total = opts.assignments.length
      const results: Array<{ assignmentName: string; ok: boolean; path?: string; error?: string }> = []

      if (taskId) {
        emitToRenderer('canvas:assignment-progress', { taskId, current: 0, total, phase: '开始归档课程作业…' })
      }

      for (let i = 0; i < opts.assignments.length; i++) {
        const assignment = opts.assignments[i]
        if (taskId) {
          emitToRenderer('canvas:assignment-progress', {
            taskId, current: i, total,
            phase: `正在归档 ${assignment.name}…`,
            assignmentName: assignment.name
          })
        }

        const res = await downloadAssignmentArchive(
          session,
          {
            courseName: opts.courseName,
            courseId: opts.courseId,
            assignment,
            destRoot: opts.destRoot,
            term: opts.term,
            conflictStrategy: opts.conflictStrategy,
            options: opts.options,
            cloudUserToken: opts.cloudUserToken,
            cloudDestRoot: opts.cloudDestRoot
          },
          (phase) => {
            if (!taskId) return
            emitToRenderer('canvas:assignment-progress', {
              taskId, current: i, total,
              phase,
              assignmentName: assignment.name
            })
          }
        )

        results.push({ assignmentName: assignment.name, ok: res.ok, path: res.path, error: res.error })

        if (taskId) {
          emitToRenderer('canvas:assignment-progress', {
            taskId, current: i + 1, total,
            phase: res.ok ? `${assignment.name} 归档完成` : `${assignment.name} 归档失败`,
            assignmentName: assignment.name
          })
        }
      }

      if (taskId) {
        emitToRenderer('canvas:assignment-progress', { taskId, current: total, total, phase: '完成' })
      }

      return { ok: true, results }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 导出单讲课堂视频 AI 语音逐字稿与字幕 (.srt / .md) ───
  handle('canvas:transcript-download', async (_event, opts: {
    courseName: string
    term?: string
    lectureName: string
    videoBaseName: string
    videoSession?: { beginTime: string; teacher: string; classroom: string }
    destRoot: string
    courseId: string | number
    exportSrt?: boolean
    exportMarkdown?: boolean
  }) => {
    try {
      const session = getSession()
      const token = getCachedToken()
      if (!token) return { ok: false, error: '请先扫描课程获取课堂视频凭据' }
      return await downloadLectureTranscript(session, { ...opts, token })
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 批量导出多讲课堂实录 AI 语音逐字稿与字幕 ───
  handle('canvas:transcript-download-batch', async (_event, opts: {
    taskId?: string
    courseName: string
    term?: string
    destRoot: string
    lectures: Array<{
      lectureName: string
      videoBaseName: string
      courseId: string | number
      videoSession?: { beginTime: string; teacher: string; classroom: string }
    }>
    exportSrt?: boolean
    exportMarkdown?: boolean
  }) => {
    try {
      const session = getSession()
      const token = getCachedToken()
      if (!token) return { ok: false, error: '请先扫描课程获取课堂视频凭据' }

      const total = opts.lectures.length
      const results: Array<{ lectureName: string; ok: boolean; srtPath?: string; mdPath?: string; count?: number; error?: string }> = []

      if (opts.taskId) {
        emitToRenderer('canvas:transcript-progress', { taskId: opts.taskId, current: 0, total, phase: '开始导出语音逐字稿…' })
      }

      for (let i = 0; i < total; i++) {
        const lec = opts.lectures[i]
        if (opts.taskId) {
          emitToRenderer('canvas:transcript-progress', {
            taskId: opts.taskId,
            current: i,
            total,
            phase: `正在处理 ${lec.lectureName}…`
          })
        }

        const r = await downloadLectureTranscript(session, {
          courseName: opts.courseName,
          term: opts.term,
          lectureName: lec.lectureName,
          videoBaseName: lec.videoBaseName,
          videoSession: lec.videoSession,
          destRoot: opts.destRoot,
          courseId: lec.courseId,
          token,
          exportSrt: opts.exportSrt ?? true,
          exportMarkdown: opts.exportMarkdown ?? true
        })

        results.push({ lectureName: lec.lectureName, ...r })

        if (opts.taskId) {
          emitToRenderer('canvas:transcript-progress', {
            taskId: opts.taskId,
            current: i + 1,
            total,
            phase: r.ok ? `${lec.lectureName} 字幕已导出` : `${lec.lectureName} 导出失败`
          })
        }
      }

      if (opts.taskId) {
        emitToRenderer('canvas:transcript-progress', { taskId: opts.taskId, current: total, total, phase: '完成' })
      }

      return { ok: true, results }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
