import { PageHeader } from '../components/ui'
import { isLegacyCanvasVideo } from '@shared/canvas-video'
import { CanvasScanQueue } from '../services/canvas-scan-queue'
import { sortAcademicTerms } from '@shared/utils'
import { newestTermCourses } from '../services/canvas-scan-policy'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/app'
import { useShallow } from 'zustand/shallow'
import { Spinner } from '../components/Spinner'
import { prefetchCanvasCourses } from '../services/prefetch'
import {
  DropdownSelect,
  NetdiskViewModeSwitch,
  GlobalCtrlButton,
  SearchInput,
  type TriState
} from '../components/DownloadUI'
import {
  NetdiskCourseExplorer,
  type NetdiskNavState,
  type NetdiskCourseItem
} from '../components/NetdiskCourseExplorer'
import { applyVideoPerspectivePreference } from '../download/perspective'
import {
  canvasFileTaskId as fileTaskId,
  canvasAssignmentTaskId as assignmentTaskId,
  canvasLectureTaskId as lectureStreamTaskId,
  canvasPptItemTaskId as pptPdfTaskId,
  canvasExtToolTaskId as extToolVideoTaskId,
  canvasExtUrlTaskId as extUrlVideoTaskId,
  parseTaskId
} from '../download/taskIds'

import {
  type CourseData,
  buildCourseData,
  catStateOf,
  aggCourseState,
  combinePptPdf,
  buildPptPdfItems,
  iframeVideoTaskId
} from './canvas/canvas-tree-utils'

import {
  handleDownloadSingleFile,
  handleDownloadSingleVideo,
  handleDownloadSingle,
  executeCanvasDownload
} from './canvas/canvas-download-actions'

import { buildNetdiskCourses } from './canvas/canvas-course-mapper'

export type { CourseData }
export { pptPdfTaskId, buildPptPdfItems }

export function CanvasBrowser() {
  // PERF [split]: 3 separate subscriptions to minimize re-render scope
  // Group 1: rarely-changing state (courses, scan results, config)
  const {
    downloadMode, canvasCourses, canvasScanState, canvasScanMessage,
    canvasCourseData,
    canvasLectures, canvasModuleVideos, canvasCourseCategorySelections,
    courseViewMode, canvasGroupByTerm, cloudLinkedIds, videoQualityOption,
    videoPerspectivePreference
  } = useAppStore(useShallow(s => ({
    downloadMode: s.downloadMode,
    canvasCourses: s.canvasCourses,
    canvasScanState: s.canvasScanState,
    canvasScanMessage: s.canvasScanMessage,
    canvasCourseData: s.canvasCourseData,
    canvasLectures: s.canvasLectures,
    canvasModuleVideos: s.canvasModuleVideos,
    canvasCourseCategorySelections: s.canvasCourseCategorySelections,
    courseViewMode: s.courseViewMode,
    canvasGroupByTerm: s.canvasGroupByTerm,
    cloudLinkedIds: s.cloudLinkedIds,
    videoQualityOption: s.videoQualityOption,
    videoPerspectivePreference: s.videoPerspectivePreference,
    canvasExportAiTranscript: s.canvasExportAiTranscript
  })))
  const setCourseViewMode = useAppStore(s => s.setCourseViewMode)
  const setCanvasGroupByTerm = useAppStore(s => s.setCanvasGroupByTerm)
  // Group 2: frequently-changing (downloading flag — derived from progress)
  const downloading = useAppStore(s => s.downloading)
  // Group 3: stable action references
  const {
    setCanvasCourseData, setCanvasTeachers,
    setCanvasSelectedTeachers, setCanvasLtiToken, setCanvasLectures, setCanvasModuleVideos,
    setCanvasCourseCategorySelection,
    applyProgress
  } = useAppStore(useShallow(s => ({
    setCanvasCourseData: s.setCanvasCourseData,
    setCanvasTeachers: s.setCanvasTeachers,
    setCanvasSelectedTeachers: s.setCanvasSelectedTeachers,
    setCanvasLtiToken: s.setCanvasLtiToken,
    setCanvasLectures: s.setCanvasLectures,
    setCanvasModuleVideos: s.setCanvasModuleVideos,
    setCanvasCourseCategorySelection: s.setCanvasCourseCategorySelection,
    applyProgress: s.applyProgress
  })))

  const selectedTerm = useAppStore(s => s.canvasSelectedTerm)
  const setSelectedTerm = useAppStore(s => s.setCanvasSelectedTerm)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [navState, setNavState] = useState<NetdiskNavState>({ level: 'root' })
  const [scanningCourseIds, setScanningCourseIds] = useState<Record<number, boolean>>({})
  const [scanningVideoCourseIds, setScanningVideoCourseIds] = useState<Record<number, boolean>>({})
  const [videoScanWarnings, setVideoScanWarnings] = useState<Record<number, string>>({})

  const scanStartedRef = useRef(false)
  const scanningVideoInFlightRef = useRef<Set<number>>(new Set())
  const scannedVideoCourseIdsRef = useRef<Set<number>>(new Set())
  const scanningFilesInFlightRef = useRef<Set<number>>(new Set())
  const scannedFilesCourseIdsRef = useRef<Set<number>>(new Set())

  // 智能静默后台预扫描管线实例 (4并发秒级文件预扫, 2并发后台视频解析)
  const scanQueueRef = useRef<CanvasScanQueue | null>(null)
  if (!scanQueueRef.current) {
    scanQueueRef.current = new CanvasScanQueue(4, 30, 2)
  }

  // 卸载时清空后台队列
  useEffect(() => {
    return () => {
      scanQueueRef.current?.clear()
    }
  }, [])

  const doScanFiles = useCallback(async (courseId: number): Promise<void> => {
    if (canvasCourseData[courseId]) return
    if (scanningFilesInFlightRef.current.has(courseId) || scannedFilesCourseIdsRef.current.has(courseId)) return
    scanningFilesInFlightRef.current.add(courseId)
    setScanningCourseIds(prev => ({ ...prev, [courseId]: true }))
    try {
      const r = await window.api.canvas.scanCourse(courseId)
      if (r.ok && r.files) {
        setCanvasCourseData(courseId, buildCourseData(r))
      }
    } catch { /* ignore */ }
    finally {
      scanningFilesInFlightRef.current.delete(courseId)
      scannedFilesCourseIdsRef.current.add(courseId)
      setScanningCourseIds(prev => ({ ...prev, [courseId]: false }))
    }
  }, [canvasCourseData, setCanvasCourseData])

  const doClassVideoScan = useCallback(async (courseId: number, force = false): Promise<void> => {
    // Persisted empty/partial results are display caches, not proof that every
    // source succeeded. Revalidate once when this course enters the scan queue.
    if (scanningVideoInFlightRef.current.has(courseId) || (!force && scannedVideoCourseIdsRef.current.has(courseId))) return
    scanningVideoInFlightRef.current.add(courseId)
    setScanningVideoCourseIds(prev => ({ ...prev, [courseId]: true }))
    try {
      const r = await window.api.canvas.classVideoScan(courseId)
      setVideoScanWarnings(prev => ({ ...prev, [courseId]: r.warning || r.error || '' }))
      if (r.ok) {
        setCanvasLectures(courseId, r.lectures ?? [])
        setCanvasTeachers(courseId, r.teachers ?? [])
        if (r.token && r.canvasCourseId) setCanvasLtiToken(courseId, { token: r.token, canvasCourseId: r.canvasCourseId })
        const allTeachers = (r.teachers ?? []).filter(t => t.selected).map(t => t.teacher)
        if (allTeachers.length > 0) setCanvasSelectedTeachers(courseId, allTeachers)
      }
      const mv = await window.api.canvas.moduleVideoScan(courseId)
      if (mv.ok) {
        setCanvasModuleVideos(courseId, { iframes: mv.tasks ?? [], extTools: mv.extTools ?? [], extUrls: mv.extUrls ?? [] })
      }
    } catch {
      setVideoScanWarnings(prev => ({ ...prev, [courseId]: '课堂视频扫描失败，请刷新重试' }))
    } finally {
      scanningVideoInFlightRef.current.delete(courseId)
      scannedVideoCourseIdsRef.current.add(courseId)
      setScanningVideoCourseIds(prev => ({ ...prev, [courseId]: false }))
    }
  }, [setCanvasLectures, setCanvasTeachers, setCanvasLtiToken, setCanvasSelectedTeachers, setCanvasModuleVideos])

  const retryVideoScans = (): void => {
    const ids = navState.level === 'root'
      ? filteredCourses.filter(course => videoScanWarnings[course.courseId]).map(course => course.courseId)
      : [Number(navState.courseId)]
    for (const courseId of ids) {
      scanQueueRef.current?.retry({
        courseId, priority: 'high', scanFiles: async () => {},
        scanVideos: id => doClassVideoScan(id, true)
      })
    }
  }

  // ── 智能告警抑制（用户对齐决策 A1）：若已有讲次成功加载，不展示黄色警告 banner ──
  const currentCourseWarning = useMemo(() => {
    if (navState.level === 'root') return null
    const cId = Number(navState.courseId)
    const warn = videoScanWarnings[cId]
    if (!warn) return null
    const lecs = canvasLectures[cId]
    if (lecs && lecs.length > 0) return null
    return warn
  }, [navState, videoScanWarnings, canvasLectures])

  // ── 智能告警下沉：主页根目录不显示全局通栏告警；仅在课程内部且存在未解决警告时展示 ──
  const shouldShowWarningBanner = navState.level !== 'root' && Boolean(currentCourseWarning)

  // ── 学期列表 ──
  const terms = useMemo(() => {
    const set = new Set(canvasCourses.map(c => c.term || '未分学期'))
    return sortAcademicTerms([...set])
  }, [canvasCourses])

  const termOptions = useMemo(() => {
    return [
      { value: 'all', label: '全部学期', count: canvasCourses.length },
      ...terms.map(t => ({
        value: t,
        label: t,
        count: canvasCourses.filter(c => (c.term || '未分学期') === t).length
      }))
    ]
  }, [terms, canvasCourses])

  // ── 按学期与搜索关键词筛选课程 ──
  const filteredCourses = useMemo(() => {
    let list = canvasCourses
    if (selectedTerm !== 'all') {
      list = list.filter(c => (c.term || '未分学期') === selectedTerm)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.courseCode && c.courseCode.toLowerCase().includes(q))
      )
    }
    return list
  }, [canvasCourses, selectedTerm, searchQuery])

  const loadCourses = useCallback(async (): Promise<void> => {
    await prefetchCanvasCourses()
  }, [])

  useEffect(() => {
    if (scanStartedRef.current) return
    if (canvasScanState !== 'idle') return
    scanStartedRef.current = true
    void loadCourses()
  }, [loadCourses, canvasScanState])

  // Only the newest dated term is scanned in the background. Older courses enter
  // the priority queue when visible, opened or explicitly selected.
  useEffect(() => {
    if (canvasCourses.length === 0) return
    const queue = scanQueueRef.current
    if (!queue) return

    for (const c of newestTermCourses(canvasCourses)) {
        queue.enqueue({
          courseId: c.courseId,
          priority: 'low',
          scanFiles: doScanFiles,
          scanVideos: doClassVideoScan
        })
    }

  }, [canvasCourses, doScanFiles, doClassVideoScan])

  // ── HLS 模块视频进度订阅 ──
  const applyProgressRef = useRef(applyProgress)
  applyProgressRef.current = applyProgress
  useEffect(() => {
    const unsub = window.api.canvas.onHlsProgress(p => {
      if (!p.taskId) return
      const phaseLabel = p.phase === 'capturing' ? '捕获 m3u8…'
        : p.phase === 'remuxing' ? '转换 mp4…'
        : p.phase === 'downloading' ? `下载切片 ${p.segmentsDone}/${p.segmentsTotal}`
        : p.phase === 'transcoding' ? (p.message || '重编码中…')
        : p.phase === 'uploading' ? (p.message || '上传中…')
        : p.phase
      const postDownload = p.phase === 'remuxing' || p.phase === 'transcoding' || p.phase === 'uploading'
      applyProgressRef.current({
        taskId: p.taskId,
        state: 'downloading',
        received: postDownload ? 1 : p.segmentsDone,
        total: postDownload ? 1 : p.segmentsTotal,
        unit: 'count',
        message: p.message || phaseLabel
      })
    })
    return unsub
  }, [])

  // ── PPT 课件进度订阅 ──
  useEffect(() => {
    const unsub = window.api.ppt.onProgress(p => {
      if (!p.taskId) return
      const isFinished = p.total > 0 && p.current >= p.total
      applyProgressRef.current({
        taskId: p.taskId,
        state: isFinished ? 'done' : 'downloading',
        received: p.current,
        total: p.total,
        fileName: p.lectureName ? `${p.lectureName} · PPT课件` : undefined,
        message: p.phase
      })
    })
    return unsub
  }, [])

  // ── 作业归档进度订阅 ──
  useEffect(() => {
    const unsub = window.api.canvas.onAssignmentProgress(p => {
      if (!p.taskId) return
      const isFinished = p.total > 0 && p.current >= p.total
      applyProgressRef.current({
        taskId: p.taskId,
        state: isFinished ? 'done' : 'downloading',
        received: p.current,
        total: p.total,
        fileName: p.assignmentName || undefined,
        message: p.phase
      })
    })
    return unsub
  }, [])

  // ── AI 字幕与逐字稿笔记进度订阅 ──
  useEffect(() => {
    const unsub = window.api.canvas.onTranscriptProgress?.(p => {
      if (!p.taskId) return
      const isFinished = p.total > 0 && p.current >= p.total
      applyProgressRef.current({
        taskId: p.taskId,
        state: isFinished ? 'done' : 'downloading',
        received: p.current,
        total: p.total,
        message: p.phase
      })
    })
    return unsub
  }, [])

  // ── 选择操作 ──
  const toggleSelectMany = useCallback((ids: string[], on: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of ids) on ? next.add(id) : next.delete(id)
      return next
    })
  }, [])

  // ── 课程已解析任务 id 派生 ──
  const courseTaskIds = useCallback((courseId: number): {
    files: string[]; teacher: string[]; ppt: string[]; moduleVideo: string[]; assignments: string[]; pptPdf: string[]; all: string[]
  } => {
    const cd = canvasCourseData[courseId]
    const lec = canvasLectures[courseId]
    const mv = canvasModuleVideos[courseId]
    const files: string[] = []
    if (cd) {
      for (const f of cd.files) files.push(fileTaskId(courseId, f.fileId))
      for (const f of cd.moduleFiles) files.push(fileTaskId(courseId, f.fileId))
      for (const f of cd.syllabusFiles) files.push(fileTaskId(courseId, f.fileId))
    }
    const isAudioOnly = videoQualityOption === 'audio_only' || videoPerspectivePreference === 'audio'
    const teacher: string[] = []
    const ppt: string[] = []
    if (lec) for (const l of lec) {
      if (!l.teacher) continue
      if (isAudioOnly || videoPerspectivePreference === 'teacher' || videoPerspectivePreference === 'all') {
        teacher.push(lectureStreamTaskId(courseId, l.lectureNum, 'teacher'))
      }
      if (!isAudioOnly && (videoPerspectivePreference === 'ppt' || videoPerspectivePreference === 'all')) {
        ppt.push(lectureStreamTaskId(courseId, l.lectureNum, 'ppt'))
      }
    }
    const moduleVideo: string[] = []
    if (mv) {
      for (const t of mv.iframes) moduleVideo.push(iframeVideoTaskId(courseId, t.pageTitle))
      for (const t of mv.extTools) moduleVideo.push(extToolVideoTaskId(courseId, t.fileId))
      for (const t of mv.extUrls) moduleVideo.push(extUrlVideoTaskId(courseId, t.uuid))
    }
    const assignments: string[] = []
    if (cd?.assignments) {
      for (const a of cd.assignments) {
        assignments.push(assignmentTaskId(courseId, a.id))
      }
    }
    const pptPdf = (lec ?? []).filter(l => l.teacher && !isLegacyCanvasVideo(l.teacher)).map(l => pptPdfTaskId(courseId, l.lectureNum))
    return { files, teacher, ppt, moduleVideo, assignments, pptPdf, all: [...files, ...teacher, ...ppt, ...moduleVideo, ...assignments, ...pptPdf] }
  }, [canvasCourseData, canvasLectures, canvasModuleVideos, videoQualityOption, videoPerspectivePreference])

  const toggleSelect = useCallback((id: string) => {
    const parsed = parseTaskId(id)
    const category = parsed?.source === 'canvas-file' ? 'files'
      : parsed?.source === 'canvas-assignment' ? 'assignments'
        : parsed?.source === 'canvas-ppt-item' ? 'pptPdf'
          : parsed?.source === 'canvas-lecture' ? (parsed.rest[1] === 'ppt' ? 'ppt' : 'teacher')
            : parsed && ['canvas-mvid', 'canvas-exttool', 'canvas-exturl'].includes(parsed.source) ? 'moduleVideo' : null
    const wasAll = parsed && category ? useAppStore.getState().canvasCourseCategorySelections[parsed.courseId]?.[category] : false
    const ids = parsed && category ? courseTaskIds(parsed.courseId)[category] : []
    if (parsed && category) setCanvasCourseCategorySelection(parsed.courseId, { [category]: false })
    setSelected(previous => {
      const next = new Set(previous)
      if (wasAll) for (const taskId of ids) next.add(taskId)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [courseTaskIds, setCanvasCourseCategorySelection])

  const togglePptItem = useCallback((_courseId: number, id: string) => toggleSelect(id), [toggleSelect])

  /** 单课程的五分类态 + pptPdf + 课程级态 */
  const courseStates = useCallback((courseId: number) => {
    const { files, teacher, ppt, moduleVideo, assignments, pptPdf: pdfIds } = courseTaskIds(courseId)
    const sel = canvasCourseCategorySelections[courseId]
    const f = catStateOf(files, selected, sel?.files)
    const t = catStateOf(teacher, selected, sel?.teacher)
    const p = catStateOf(ppt, selected, sel?.ppt)
    const m = catStateOf(moduleVideo, selected, sel?.moduleVideo)
    const a = catStateOf(assignments, selected, sel?.assignments)
    const pptPdf: TriState = sel?.pptPdf ? 'all' : catStateOf(pdfIds, selected)
    const course = combinePptPdf(aggCourseState(f, t, p, m, a), pptPdf)
    return { files: f, teacher: t, ppt: p, moduleVideo: m, assignments: a, pptPdf, course }
  }, [courseTaskIds, canvasCourseCategorySelections, selected])

  const toggleCourseCategory = useCallback((courseId: number, categoryId: string, on: boolean) => {
    const { files, teacher, ppt, moduleVideo, assignments, pptPdf } = courseTaskIds(courseId)
    if (categoryId === 'files') {
      setCanvasCourseCategorySelection(courseId, { files: on })
      if (files.length > 0) toggleSelectMany(files, on)
    } else if (categoryId === 'videos') {
      setCanvasCourseCategorySelection(courseId, { teacher: on, ppt: on, moduleVideo: on })
      const vIds = [...teacher, ...ppt, ...moduleVideo]
      if (vIds.length > 0) toggleSelectMany(vIds, on)
    } else if (categoryId === 'pptPdf') {
      setCanvasCourseCategorySelection(courseId, { pptPdf: on })
      toggleSelectMany(pptPdf, on)
    } else if (categoryId === 'assignments') {
      setCanvasCourseCategorySelection(courseId, { assignments: on })
      if (assignments.length > 0) toggleSelectMany(assignments, on)
    }
  }, [courseTaskIds, setCanvasCourseCategorySelection, toggleSelectMany])

  const handleVideoPerspective = useCallback((courseId: number, p: 'all' | 'teacher' | 'ppt' | 'none' | 'audio') => {
    if (p === 'audio') {
      applyVideoPerspectivePreference('audio')
      const { teacher, ppt, moduleVideo } = courseTaskIds(courseId)
      setCanvasCourseCategorySelection(courseId, { teacher: true, ppt: false, moduleVideo: false })
      setSelected(prev => {
        const next = new Set(prev)
        for (const id of teacher) next.add(id)
        for (const id of [...ppt, ...moduleVideo]) next.delete(id)
        return next
      })
      return
    }
    applyVideoPerspectivePreference(p)
    const { teacher, ppt, moduleVideo } = courseTaskIds(courseId)
    if (p === 'all') {
      setCanvasCourseCategorySelection(courseId, { teacher: true, ppt: true, moduleVideo: true })
      setSelected(prev => {
        const next = new Set(prev)
        for (const id of [...teacher, ...ppt, ...moduleVideo]) next.add(id)
        return next
      })
    } else if (p === 'teacher') {
      setCanvasCourseCategorySelection(courseId, { teacher: true, ppt: false, moduleVideo: false })
      setSelected(prev => {
        const next = new Set(prev)
        for (const id of teacher) next.add(id)
        for (const id of [...ppt, ...moduleVideo]) next.delete(id)
        return next
      })
    } else if (p === 'ppt') {
      setCanvasCourseCategorySelection(courseId, { teacher: false, ppt: true, moduleVideo: false })
      setSelected(prev => {
        const next = new Set(prev)
        for (const id of ppt) next.add(id)
        for (const id of [...teacher, ...moduleVideo]) next.delete(id)
        return next
      })
    } else if (p === 'none') {
      setCanvasCourseCategorySelection(courseId, { teacher: false, ppt: false, moduleVideo: false })
      setSelected(prev => {
        const next = new Set(prev)
        for (const id of [...teacher, ...ppt, ...moduleVideo]) next.delete(id)
        return next
      })
    }
  }, [courseTaskIds, setCanvasCourseCategorySelection])

  const toggleCourse = useCallback((courseId: number) => {
    const st = courseStates(courseId)
    const { all } = courseTaskIds(courseId)
    if (st.course === 'none') {
      setCanvasCourseCategorySelection(courseId, { files: true, teacher: true, ppt: true, moduleVideo: true, pptPdf: true, assignments: true })
      setSelected(prev => {
        const next = new Set(prev)
        for (const id of all) next.add(id)
        return next
      })
    } else {
      setCanvasCourseCategorySelection(courseId, { files: false, teacher: false, ppt: false, moduleVideo: false, pptPdf: false, assignments: false })
      setSelected(prev => {
        const next = new Set(prev)
        for (const id of all) next.delete(id)
        return next
      })
    }
  }, [courseStates, courseTaskIds, setCanvasCourseCategorySelection])

  // ── 批量下载主触发 ──
  const cancelRequestedRef = useRef(false)

  const onDownload = useCallback(async () => {
    await executeCanvasDownload(selected, cancelRequestedRef)
  }, [selected])

  // ── 全局控制 ──
  const onPauseAll = useCallback(() => { window.api.download.pauseAll().catch(() => undefined) }, [])
  const onResumeAll = useCallback(() => { window.api.download.resumeAll().catch(() => undefined) }, [])
  const onCancelAll = useCallback(() => {
    cancelRequestedRef.current = true
    window.api.download.cancelAll().catch(() => undefined)
  }, [])

  const canvasCourseTaskIds = useAppStore(s => s.canvasCourseTaskIds)
  const progressMap = useAppStore(s => s.progress)

  // ── 导航与选择态解耦：进入子文件夹时自动清空该分类的全选态 ──
  const handleNavigate = useCallback((next: NetdiskNavState) => {
    if (next.level === 'category' && next.courseId && next.categoryId) {
      const cId = Number(next.courseId)
      const catKey = next.categoryId as 'files' | 'videos' | 'assignments' | 'pptPdf'
      const tIds = courseTaskIds(cId)
      const idsToRemove = catKey === 'files' ? tIds.files
        : catKey === 'videos' ? [...tIds.teacher, ...tIds.ppt, ...tIds.moduleVideo]
        : catKey === 'assignments' ? tIds.assignments
        : catKey === 'pptPdf' ? tIds.pptPdf : []

      if (catKey === 'videos') {
        setCanvasCourseCategorySelection(cId, { teacher: false, ppt: false, moduleVideo: false })
      } else {
        setCanvasCourseCategorySelection(cId, { [catKey]: false })
      }

      if (idsToRemove.length > 0) {
        setSelected(prev => {
          const nextSet = new Set(prev)
          for (const id of idsToRemove) nextSet.delete(id)
          return nextSet
        })
      }
    } else if (next.level === 'course' && next.courseId) {
      const cId = Number(next.courseId)
      setCanvasCourseCategorySelection(cId, {
        files: false, teacher: false, ppt: false, moduleVideo: false, assignments: false, pptPdf: false
      })
      const { all } = courseTaskIds(cId)
      if (all.length > 0) {
        setSelected(prev => {
          const nextSet = new Set(prev)
          for (const id of all) nextSet.delete(id)
          return nextSet
        })
      }
    }
    setNavState(next)
  }, [courseTaskIds, setCanvasCourseCategorySelection])

  // ── 进入分类目录时自动触发静默扫描（杜绝出现“点击扫描…”按钮） ──
  useEffect(() => {
    if (navState.level === 'category' && navState.courseId) {
      const cId = Number(navState.courseId)
      if (navState.categoryId === 'videos' && !canvasLectures[cId] && !scanningVideoCourseIds[cId]) {
        void doClassVideoScan(cId)
      } else if (navState.categoryId === 'files' && !canvasCourseData[cId] && !scanningCourseIds[cId]) {
        void doScanFiles(cId)
      } else if (navState.categoryId === 'assignments' && !canvasCourseData[cId] && !scanningCourseIds[cId]) {
        void doScanFiles(cId)
      }
    }
  }, [navState, canvasLectures, scanningVideoCourseIds, canvasCourseData, scanningCourseIds, doClassVideoScan, doScanFiles])

  const netdiskCourses = useMemo<NetdiskCourseItem[]>(() => {
    return buildNetdiskCourses({
      filteredCourses,
      canvasCourseData,
      canvasLectures,
      canvasModuleVideos,
      canvasCourseCategorySelections,
      canvasCourseTaskIds,
      progressMap,
      downloadMode,
      cloudLinkedIds,
      videoQualityOption,
      videoPerspectivePreference,
      selected,
      scanningCourseIds,
      scanningVideoCourseIds,
      courseStates,
      courseTaskIds,
      toggleSelect,
      togglePptItem,
      toggleSelectMany,
      setCanvasCourseCategorySelection,
      toggleCourse,
      toggleCourseCategory,
      handleVideoPerspective,
      handleDownloadSingleFile,
      handleDownloadSingleVideo,
      onDownload,
      doScanFiles,
      doClassVideoScan,
      scanQueue: scanQueueRef.current,
      scannedFilesCourseIds: scannedFilesCourseIdsRef.current,
      scannedVideoCourseIds: scannedVideoCourseIdsRef.current
    })
  }, [
    filteredCourses, canvasCourseData, canvasLectures, canvasModuleVideos,
    canvasCourseCategorySelections, courseStates, courseTaskIds, selected,
    toggleSelect, togglePptItem, toggleSelectMany, setCanvasCourseCategorySelection,
    scanningCourseIds, scanningVideoCourseIds, doScanFiles, doClassVideoScan,
    toggleCourse, toggleCourseCategory, handleVideoPerspective, canvasCourseTaskIds, progressMap, downloadMode, cloudLinkedIds,
    videoQualityOption, videoPerspectivePreference, onDownload
  ])

  return (
    <div className="ui-page">
      <PageHeader title="Canvas 课程" description="浏览课件与课堂录播，按课程组织下载" />
      {/* 顶部粘性操作栏：仅在根目录展示全局学期筛选、课程搜索与平铺/分组切换 */}
      {navState.level === 'root' && (
        <div className="ui-toolbar justify-between sticky top-0 z-30 no-drag">
          {/* 左侧：学期选择胶囊 + 搜索框 */}
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <DropdownSelect
              value={selectedTerm}
              options={termOptions}
              onChange={term => {
                setSelectedTerm(term)
                setNavState({ level: 'root' })
                setSelected(new Set())
                for (const courseId of Object.keys(canvasCourseCategorySelections)) {
                  setCanvasCourseCategorySelection(Number(courseId), { files: false, teacher: false, ppt: false, moduleVideo: false, assignments: false, pptPdf: false })
                }
              }}
              icon="📅"
            />

            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="搜索课程/代码..."
              className="h-9 w-44"
            />

            <button
              type="button"
              onClick={() => setCanvasGroupByTerm(!canvasGroupByTerm)}
              title={canvasGroupByTerm ? '当前为按学期分组展示，点击切换为平铺' : '当前为平铺展示，点击切换为按学期分组'}
              className={`inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-all shadow-2xs cursor-pointer select-none ${
                canvasGroupByTerm
                  ? 'border-accent/40 bg-accent/10 text-accent font-semibold'
                  : 'border-bd bg-surface-2 text-text-3 hover:border-bd-strong hover:bg-surface-1 hover:text-text-1'
              }`}
            >
              <span>{canvasGroupByTerm ? '按学期分组' : '平铺展示'}</span>
            </button>

            {canvasScanState === 'scanning' && (
              <span className="inline-flex items-center gap-1.5 text-xs text-text-2">
                <Spinner size={12} /> {canvasScanMessage}
              </span>
            )}
          </div>

          {/* 右侧：下载控制 + 视图切换 */}
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            {downloading && (
              <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
                <GlobalCtrlButton kind="pause" onClick={onPauseAll} title="暂停全部" />
                <GlobalCtrlButton kind="resume" onClick={onResumeAll} title="继续全部" />
                <GlobalCtrlButton kind="cancel" onClick={onCancelAll} title="取消全部" />
              </div>
            )}

            <NetdiskViewModeSwitch
              mode={courseViewMode}
              onChange={setCourseViewMode}
            />
          </div>
        </div>
      )}

      {/* 课程列表：网盘资源浏览器 */}
      {shouldShowWarningBanner && (
        <div role="status" className="mx-4 my-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-warning-bg px-4 py-2 text-sm text-warning">
          <span>{currentCourseWarning}</span>
          <button type="button" onClick={retryVideoScans}
            disabled={navState.level !== 'root' && !!scanningVideoCourseIds[Number(navState.courseId)]}
            className="rounded-lg border border-current/30 px-3 py-1 text-xs transition-colors hover:bg-warning/10 disabled:opacity-50">
            {scanningVideoCourseIds[Number(navState.courseId)] ? '正在重试…' : '重试本课程'}
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {canvasScanState === 'scanning' && canvasCourses.length === 0 && (
          <div className="relative mx-auto flex h-full max-w-md flex-col items-center justify-center text-center p-6">
            <div className="pointer-events-none absolute inset-0 -z-10 bg-hero-radial opacity-70 blur-2xl" />
            <Spinner size={32} />
            <div className="mt-5 text-base font-medium text-text-1">{canvasScanMessage || '正在扫描…'}</div>
          </div>
        )}
        {canvasScanState === 'error' && (
          <div className="relative mx-auto flex h-full max-w-md flex-col items-center justify-center text-center p-6">
            <div className="pointer-events-none absolute inset-0 -z-10 bg-hero-radial opacity-60 blur-2xl" />
            <svg className="h-12 w-12 text-warning/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <div className="mt-4 max-w-sm rounded-xl bg-warning-bg px-4 py-2.5 text-sm font-medium text-warning ring-1 ring-warning-ring">{canvasScanMessage}</div>
            <button type="button" onClick={() => void loadCourses()} className="mt-5 inline-flex h-10 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-white shadow-glow-sm transition-all hover:scale-[1.02] hover:bg-accent-light active:scale-[0.98]">重试</button>
          </div>
        )}
        {canvasScanState === 'done' && canvasCourses.length > 0 && filteredCourses.length === 0 && (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center p-6">
            <div className="text-base font-medium text-text-1">没有匹配的课程</div>
            <div className="mt-2 text-sm text-text-3">请尝试更改搜索关键词或学期</div>
          </div>
        )}
        {filteredCourses.length > 0 && (
          <NetdiskCourseExplorer
            courses={netdiskCourses}
            viewMode={courseViewMode}
            onViewModeChange={setCourseViewMode}
            navState={navState}
            onNavigate={handleNavigate}
            groupByTerm={canvasGroupByTerm}
            onDownloadSingle={handleDownloadSingle}
            onDownloadCourse={() => void onDownload()}
            onStartDownload={() => void onDownload()}
          />
        )}
      </div>
    </div>
  )
}
