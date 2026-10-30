import {
  CANVAS_BASE_URL,
  V_SJTU_API,
  type ApiEnvelope,
  type AuditCourseDetail,
  type AuditCourseItem,
  type CanvasDownloadTaskSpec,
  type DownloadTaskSpec,
  type PageResult
} from '../../shared/types'
import type { BackupCandidate, BackupCourse, BackupSelection, BackupSource } from '../../shared/backup'
import { sanitizeFsName } from '../../shared/utils'
import { ensureCanvasLogin, scanCanvasClassVideos, scanCourse } from '../canvas/orchestrator'
import { fetchFileMeta, listCourses } from '../canvas/api'
import { ensureCnmoocLogin } from '../cnmooc/orchestrator'
import { fetchChapters, fetchCourses } from '../cnmooc/api'
import { ensureVsjtuLogin, vsjtuFetch } from '../auth'
import { sjtuSession } from '../session'
import { canRefreshSpec, digest } from './catalog'
import { currentBackupOwner } from './runtime'
import { isLegacyCanvasVideo } from '../../shared/canvas-video'

export async function listBackupCourses(source: BackupSource): Promise<BackupCourse[]> {
  if (source === 'canvas') {
    if (!(await ensureCanvasLogin())) throw Error('请先完成 Canvas 登录')
    return (await listCourses(sjtuSession())).map(c => ({
      key: `canvas:${c.courseId}`,
      source,
      id: String(c.courseId),
      name: c.name,
      term: c.term
    }))
  }
  if (source === 'cnmooc') {
    if (!(await ensureCnmoocLogin())) throw Error('请先完成好大学在线登录')
    return (await fetchCourses(sjtuSession())).map(c => ({ key: `cnmooc:${c.courseId}`, source, id: c.courseId, name: c.name }))
  }
  if (!(await ensureVsjtuLogin())) throw Error('请先完成旁听平台登录')
  const courses = new Map<string, BackupCourse>()
  for (let page = 1; page <= 100; page++) {
    const response = (await vsjtuFetch(V_SJTU_API.auditCourseMy, { method: 'POST', body: { pageNo: page, pageSize: 100 } })) as ApiEnvelope<
      PageResult<AuditCourseItem>
    >
    if (!response.success) throw Error(response.message || '旁听课程列表读取失败')
    const items = response.data.records || response.data.list || []
    for (const item of items) {
      if (Number(item.applyStatus) !== 1) continue
      for (const resource of item.auditCourseResources || []) {
        const id = String(resource.resourceId)
        courses.set(id, { key: `audited:${id}`, source, id, name: resource.courseName || item.subjName, term: item.acteTerm })
      }
    }
    if (page >= (response.data.totalPage || 1)) return [...courses.values()]
  }
  throw Error('旁听课程分页超过安全上限，请缩小课程范围')
}

function candidate(course: BackupCourse, spec: DownloadTaskSpec, revision: unknown, size?: number): BackupCandidate {
  const version = digest(JSON.stringify(revision))
  return { course, size, version, spec: { ...spec, backupCourse: course, resourceVersion: version, resourceSize: size } }
}

/** Authenticated sessions only; the background scanner never opens a login window. */
export async function scanBackupCourse(
  course: BackupCourse,
  selection: BackupSelection
): Promise<{ items: BackupCandidate[]; warning?: string }> {
  const items: BackupCandidate[] = []
  const courseName = sanitizeFsName(course.name)
  if (course.source === 'canvas') {
    const courseId = Number(course.id)
    if (selection.files) {
      const result = await scanCourse(sjtuSession(), courseId)
      if (!result.ok) throw Error(result.error || '课件扫描失败')
      const seen = new Set<number>()
      for (const file of [...result.files, ...result.moduleFiles, ...result.syllabusFiles]) {
        if (file.locked || seen.has(file.fileId)) continue
        seen.add(file.fileId)
        const dir = result.folderMap[file.folderId ?? -1] || ''
        const spec: CanvasDownloadTaskSpec = {
          taskId: `canvas_file_${courseId}_${file.fileId}`,
          url: '',
          source: 'canvas-files',
          rawFileId: file.fileId,
          canvasCourseId: courseId,
          courseId,
          category: 'files',
          term: course.term,
          courseName: `${courseName}/files${dir ? '/' + dir : ''}`,
          canvasRelPath: dir,
          fileName: sanitizeFsName(file.displayName)
        }
        items.push(candidate(course, spec, [file.fileId, file.updatedAt || '', file.size, file.displayName], file.size))
      }
    }
    if (selection.videos) {
      const result = await scanCanvasClassVideos(courseId)
      if (!result.ok) throw Error(result.error || '录播扫描失败')
      const streams = selection.perspective === 'all' ? [0, 1] : [selection.perspective === 'ppt' ? 1 : 0]
      for (const session of result.sessions || []) {
        for (const stream of streams) {
          const legacy = isLegacyCanvasVideo(session)
          const label = stream === 1 ? 'PPT' : '教师'
          const spec: CanvasDownloadTaskSpec = {
            taskId: `backup_canvas_${courseId}_${session.videoId}_${stream}`,
            url: '',
            source: legacy ? 'canvas-video' : 'canvas-class-video',
            canvasCourseId: courseId,
            canvasVideoId: session.videoId,
            canvasVideoToken: result.token,
            canvasStreamIdx: stream,
            category: 'videos',
            term: course.term,
            courseName: `${courseName}/videos/课堂视频`,
            fileName: `${sanitizeFsName(session.videoName || session.beginTime || session.videoId)}-${label}.mp4`,
            isHls: false // The actual channel URL determines MP4 versus HLS at dispatch.
          }
          items.push(candidate(course, spec, [session.videoId, stream, session.videoName, session.beginTime, session.endTime]))
        }
      }
    }
    return { items, warning: '订阅范围：可访问课件与课堂录播；模块嵌入视频、作业归档、字幕和 PPT 导出仍从课程页发起。' }
  }
  if (course.source === 'cnmooc') {
    const chapters = await fetchChapters(sjtuSession(), course.id)
    for (const chapter of chapters) {
      for (const item of chapter.items) {
        const spec: CanvasDownloadTaskSpec = {
          taskId: `cnmooc_${course.id}_${item.itemId}`,
          url: '',
          source: 'cnmooc',
          cnmoocItemId: item.itemId,
          cnmoocItemType: item.itemType,
          cnmoocChapter: sanitizeFsName(chapter.chapter),
          cnmoocResourceFilter: selection.files && selection.videos ? 'all' : selection.videos ? 'video' : 'document',
          courseName: `${courseName}/${sanitizeFsName(chapter.chapter)}`,
          fileName: sanitizeFsName(item.title)
        }
        items.push(candidate(course, spec, [item.itemId, item.title, item.itemType]))
      }
    }
    return {
      items,
      warning: '好大学在线未提供可靠的内容版本时间：可检测新增、标题变化；同一条目内部替换文件可能无法发现。类型在下载解析时确认。'
    }
  }
  const response = (await vsjtuFetch(V_SJTU_API.auditCourseDetail, {
    method: 'POST',
    body: { resourceId: Number(course.id) }
  })) as ApiEnvelope<AuditCourseDetail>
  if (!response.success || !response.data) throw Error(response.message || '旁听课程读取失败')
  const angles: (0 | 3)[] = selection.perspective === 'all' ? [0, 3] : [selection.perspective === 'ppt' ? 3 : 0]
  for (const video of response.data.videos || []) {
    if (!video.refId) continue
    for (const angle of angles) {
      const spec: DownloadTaskSpec = {
        taskId: `backup_audited_${course.id}_${video.refId}_${angle}`,
        url: '',
        refId: video.refId,
        angle,
        source: 'audited',
        courseId: Number(course.id),
        courseName,
        term: course.term,
        category: 'videos',
        fileName: `${sanitizeFsName(video.videoName || String(video.refId))}-${angle === 3 ? 'PPT' : '教师'}.mp4`
      }
      items.push(candidate(course, spec, [video.refId, angle, video.videoName, video.courEndTime]))
    }
  }
  return { items, warning: '旁听订阅包含已获授权课程的视频；源站未提供内容指纹，同 ID 视频内部替换可能无法发现。' }
}

const classTokens = new Map<string, { token: string; expires: number }>()
export async function refreshBackupSpec(spec: DownloadTaskSpec): Promise<DownloadTaskSpec> {
  const next = { ...spec } as CanvasDownloadTaskSpec
  if (canRefreshSpec(next)) next.url = ''
  if (next.source === 'canvas-files') {
    const fileId =
      next.rawFileId ||
      Number(
        next.taskId
          .replace(/_cloud$/, '')
          .split('_')
          .at(-1)
      )
    if (!fileId) throw Error('课件缺少文件 ID，请重新扫描课程')
    next.rawFileId = fileId
    next.url = `${CANVAS_BASE_URL}/files/${fileId}/download?download_frd=1`
  }
  if (next.source === 'canvas-class-video' && next.canvasCourseId) {
    const key = `${currentBackupOwner()}:${next.canvasCourseId}`
    let cached = classTokens.get(key)
    if (!cached || cached.expires < Date.now()) {
      const result = await scanCanvasClassVideos(next.canvasCourseId)
      if (!result.ok || !result.token) throw Error(result.error || '录播认证已过期，请重新登录')
      cached = { token: result.token, expires: Date.now() + 120_000 }
      classTokens.set(key, cached)
    }
    next.canvasVideoToken = cached.token
  }
  return next
}

export async function canvasVersionStillMatches(spec: DownloadTaskSpec): Promise<boolean> {
  if (spec.source !== 'canvas-files' || !spec.rawFileId || !spec.resourceVersion) return false
  const meta = await fetchFileMeta(sjtuSession(), spec.rawFileId)
  if (!meta) throw Error('原始课件已不存在')
  return digest(JSON.stringify([spec.rawFileId, meta.updatedAt || '', meta.size, meta.displayName])) === spec.resourceVersion
}

export function clearBackupSourceCaches(): void {
  classTokens.clear()
}
