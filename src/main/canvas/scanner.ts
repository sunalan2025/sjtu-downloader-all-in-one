import type Electron from 'electron'
import type {
  CanvasAssignmentItem,
  CanvasFileItem,
  CanvasModule,
  CanvasTeacherSelection,
  CanvasVideoSession,
  CourseResourceSummary
} from '../../shared/types'
import { getSession } from './auth-sso'
import { emitScanProgress } from './events'
import { fetchCourseAssignments } from './assignment-download'
import {
  fetchFolderMap,
  fetchCourseFiles,
  fetchCourseModules,
  fetchSyllabusBody,
  extractCanvasFileIds,
  fetchCourseTabs,
  fetchFileMeta,
  isForbiddenError
} from './api'
import {
  extractLtiToken,
  fetchVodVideoList,
  extractLectureNum,
  isClassVideoTab,
  isLegacyClassVideoTab,
  isNewClassVideoTab,
  mergeAndDeduplicateLectures
} from './video-tokens'
import {
  extractLegacyLtiToken,
  LegacyLtiError,
  fetchLegacyVodVideoList
} from './legacy-video'

/** 获取缓存的 LTI token（由 classVideoScan 流程写入） */
let _cachedLtiToken: string | null = null

export function setCachedLtiToken(token: string | null): void {
  _cachedLtiToken = token
}

export function getCachedToken(): string | null {
  return _cachedLtiToken
}

/** 批量取文件 meta（并发 5），把补漏 fileId 列表转成完整 CanvasFileItem[] */
export async function fetchFileMetaBatch(
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
        updatedAt: r.value.updatedAt,
        folderId: folderIdOverride ?? r.value.folderId,
        locked: false
      })
    })
  }
  return results
}

export interface LectureGroup {
  lectureNum: number
  date: string
  teacher?: CanvasVideoSession
}

/** 将视频列表按讲次分组。每条记录 = 1 讲，内含教师+PPT 两路流 */
export function groupLectures(sessions: CanvasVideoSession[]): LectureGroup[] {
  const withNum = sessions.map(s => ({
    session: s,
    num: extractLectureNum(s.videoName)
  }))
  withNum.sort((a, b) => a.num - b.num || a.session.beginTime.localeCompare(b.session.beginTime))

  return withNum.map((item, idx) => ({
    lectureNum: idx + 1,
    date: item.session.beginTime.split(' ')[0] || 'unknown',
    teacher: item.session
  }))
}

/**
 * 扫描单个 Canvas 课程资源（含 403 文件 Tab 容错与模块/大纲附件补漏） (R2-F2)
 */
export async function scanCourse(
  session: Electron.Session,
  courseId: number
): Promise<CourseResourceSummary> {
  try {
    emitScanProgress(courseId, 'files', '正在扫描文件和模块…')

    const [folderMapRes, filesRes, modulesRes, syllabusRes, assignmentsRes] = await Promise.allSettled([
      fetchFolderMap(session, courseId),
      fetchCourseFiles(session, courseId),
      fetchCourseModules(session, courseId),
      fetchSyllabusBody(session, courseId),
      fetchCourseAssignments(session, courseId)
    ])

    let filesTabAccessible = true
    let files: CanvasFileItem[]
    let folderMap: Map<number, string>
    let warning: string | undefined

    if (filesRes.status === 'fulfilled') {
      files = filesRes.value
    } else {
      if (isForbiddenError(filesRes.reason)) {
        filesTabAccessible = false
        files = []
        warning = '教师已禁用文件列表，已自动从单元和大纲提取可用课件'
        console.warn(`[canvas] 课程 ${courseId} 文件 Tab 禁用 (403 Forbidden)，已降级至模块和大纲提取`)
      } else {
        throw filesRes.reason
      }
    }

    if (folderMapRes.status === 'fulfilled') {
      folderMap = folderMapRes.value
    } else {
      if (isForbiddenError(folderMapRes.reason) || !filesTabAccessible) {
        folderMap = new Map<number, string>()
      } else {
        console.warn(`[canvas] 课程 ${courseId} fetchFolderMap 失败:`, folderMapRes.reason)
        folderMap = new Map<number, string>()
      }
    }

    let modules: CanvasModule[] = []
    if (modulesRes.status === 'fulfilled') {
      modules = modulesRes.value
    } else {
      console.warn(`[canvas] 课程 ${courseId} fetchCourseModules 失败:`, modulesRes.reason)
      modules = []
    }

    let syllabusHtml = ''
    if (syllabusRes.status === 'fulfilled') {
      syllabusHtml = syllabusRes.value
    } else {
      console.warn(`[canvas] 课程 ${courseId} fetchSyllabusBody 失败:`, syllabusRes.reason)
      syllabusHtml = ''
    }

    let assignments: CanvasAssignmentItem[] = []
    if (assignmentsRes.status === 'fulfilled') {
      assignments = assignmentsRes.value
    } else {
      console.warn(`[canvas] 课程 ${courseId} fetchCourseAssignments 失败:`, assignmentsRes.reason)
      assignments = []
    }

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

    const moduleFiles = await fetchFileMetaBatch(session, moduleFileIds)
    const syllabusFiles = await fetchFileMetaBatch(session, syllabusFileIds, -3)

    emitScanProgress(courseId, 'done', '扫描完成')

    return {
      ok: true,
      filesTabAccessible,
      files: files.filter(f => f.url && !f.locked),
      folderMap: Object.fromEntries(folderMap),
      moduleFiles,
      syllabusFiles,
      assignments,
      warning
    }
  } catch (err) {
    return {
      ok: false,
      filesTabAccessible: false,
      files: [],
      folderMap: {},
      moduleFiles: [],
      syllabusFiles: [],
      assignments: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/** 扫描单个 Canvas 课程的课堂视频（新旧双轨融合） */
export async function scanCanvasClassVideos(courseId: number): Promise<{
  ok: boolean
  sessions?: CanvasVideoSession[]
  teachers?: CanvasTeacherSelection[]
  lectures?: LectureGroup[]
  token?: string
  canvasCourseId?: string
  legacyCourseId?: string
  warning?: string
  error?: string
}> {
  try {
    const session = getSession()

    emitScanProgress(courseId, 'class-video', '')
    const tabs = await fetchCourseTabs(session, courseId)
    const matchingTabs = tabs.filter(t => isClassVideoTab(t.label) || isLegacyClassVideoTab(t.label, t.htmlUrl) || isNewClassVideoTab(t.label, t.htmlUrl))
    if (matchingTabs.length === 0) return { ok: true, sessions: [], teachers: [], lectures: [] }

    const legacyTab = matchingTabs.find(t => isLegacyClassVideoTab(t.label, t.htmlUrl))
    const newTab = matchingTabs.find(t => isNewClassVideoTab(t.label, t.htmlUrl) && t !== legacyTab)

    let newSessions: CanvasVideoSession[] = []
    let tokenData: { token: string; canvasCourseId: string } | null = null
    const warnings: string[] = []
    let successfulSources = 0

    // 2. 扫描新版 Tab (Tool 8329 / v.sjtu.edu.cn)
    if (newTab) {
      try {
        tokenData = await extractLtiToken(session, newTab.htmlUrl)
        if (!tokenData) throw new Error('新版课堂视频登录失败')
        setCachedLtiToken(tokenData.token)
        newSessions = await fetchVodVideoList(session, tokenData.token, tokenData.canvasCourseId)
        successfulSources++
        console.log('[canvas] 新版课堂视频列表:', newSessions.length, '条记录')
      } catch {
        warnings.push('新版课堂视频读取失败，请刷新重试')
      }
    }

    // 3. 扫描旧版 Tab (Tool 18717 / courses.sjtu.edu.cn)
    let legacySessions: CanvasVideoSession[] = []
    let legacyTokenData: { canvasCourseId: string } | null = null

    if (legacyTab) {
      try {
        legacyTokenData = await extractLegacyLtiToken(session, legacyTab.htmlUrl)
        if (!legacyTokenData?.canvasCourseId) throw new Error('部分录播资源同步超时，请刷新重试')
        legacySessions = await fetchLegacyVodVideoList(session, legacyTokenData.canvasCourseId)
        successfulSources++
        console.log('[canvas] 旧版课堂视频列表:', legacySessions.length, '条记录')
      } catch (error) {
        // Only expose a fixed failure stage/status, never raw URLs or LTI credentials.
        warnings.push(error instanceof LegacyLtiError ? error.message : '部分录播资源同步超时，请刷新重试')
      }
    }

    if (successfulSources === 0) {
      emitScanProgress(courseId, 'class-video-done', '课堂视频扫描失败')
      return { ok: false, error: warnings.join('；') || '课堂视频读取失败' }
    }

    // 4. 双轨并集去重融合
    const mergedSessions = mergeAndDeduplicateLectures(newSessions, legacySessions)
    console.log('[canvas] 双轨融合完成:', mergedSessions.length, '条记录')

    // 5. 按讲次分组
    const lectures = groupLectures(mergedSessions)
    console.log('[canvas] 分组完成:', lectures.length, '讲')

    // 6. 统计教师
    const teacherMap = new Map<string, number>()
    for (const s of mergedSessions) {
      if (s.teacher) {
        teacherMap.set(s.teacher, (teacherMap.get(s.teacher) || 0) + 1)
      }
    }
    const teachers: CanvasTeacherSelection[] = [...teacherMap.entries()]
      .map(([teacher, count]) => ({ teacher, count, selected: teacherMap.size <= 1 }))
      .sort((a, b) => b.count - a.count)

    emitScanProgress(courseId, 'class-video-done', '课堂视频扫描完成')

    return {
      ok: true,
      sessions: mergedSessions,
      teachers,
      lectures,
      token: tokenData?.token || '',
      canvasCourseId: tokenData?.canvasCourseId || String(courseId),
      warning: warnings.length ? warnings.join('；') : undefined,
      legacyCourseId: legacyTokenData?.canvasCourseId || mergedSessions.find(s => s.legacyCourseId)?.legacyCourseId
    }
  } catch (err) {
    console.log('[canvas] 课堂视频扫描异常:', err)
    emitScanProgress(courseId, 'class-video-done', '课堂视频扫描失败')
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
