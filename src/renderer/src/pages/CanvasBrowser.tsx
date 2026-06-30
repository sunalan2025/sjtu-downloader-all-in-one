import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { useAppStore, useEffectiveProgress, type LectureGroup } from '../store/app'
import { useShallow } from 'zustand/shallow'
import { Spinner } from '../components/Spinner'
import { useCloudConnection } from '../hooks/useSharedBrowserHooks'
import { prefetchCanvasCourses } from '../services/prefetch'
import { Chevron, TriCheckbox, ProgressBar, SmallCheck, GlobalCtrlButton, ModeSegmented, ConflictStrategySegmented, HlsTranscodeSegmented, TaskCtrlButtons, CourseProgressSummary, OverallProgressBar, formatBytes, type TriState } from '../components/DownloadUI'
import type {
  CanvasCourse,
  CanvasDownloadTaskSpec,
  CanvasFileItem,
  CanvasLectureDownloadItem,
  CanvasTeacherSelection,
  CanvasVideoSession,
  FileConflictStrategy
} from '@shared/types'

// ─── 共享 canvas:scan-progress 监听器 ─────────────────────────

type ScanProgressCb = (p: { courseId: number; phase: string; message: string }) => void
let scanProgressListeners: Set<ScanProgressCb> | null = null
let scanProgressUnsub: (() => void) | null = null

function subscribeCanvasScanProgress(cb: ScanProgressCb): () => void {
  if (!scanProgressListeners) {
    scanProgressListeners = new Set()
    scanProgressUnsub = window.api.canvas.onScanProgress((p) => {
      for (const fn of scanProgressListeners!) fn(p)
    })
  }
  scanProgressListeners.add(cb)
  return () => {
    scanProgressListeners!.delete(cb)
    if (scanProgressListeners!.size === 0 && scanProgressUnsub) {
      scanProgressUnsub()
      scanProgressUnsub = null
      scanProgressListeners = null
    }
  }
}

function useCanvasScanProgress(courseId: number, cb: ScanProgressCb): void {
  const cbRef = useRef(cb)
  cbRef.current = cb
  useEffect(() => {
    const wrapped: ScanProgressCb = (p) => cbRef.current(p)
    return subscribeCanvasScanProgress(wrapped)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

// ─── Task ID 生成 ──────────────────────────────────────────────

function fileTaskId(courseId: number, fileId: number): string {
  return `canvas_file_${courseId}_${fileId}`
}

function lectureStreamTaskId(courseId: number, lectureNum: number, role: 'teacher' | 'ppt'): string {
  return `canvas_lecture_${courseId}_${lectureNum}_${role}`
}

// 模块视频 taskId / baseName。sanitize 保证 taskId 稳定、落盘文件名合法。
// 三类来源的 taskId 前缀对齐 main 端 orchestrator 的产 spec 方案：
//   iframe(HLS) → canvas_mvid_ / extTool(直接MP4) → canvas_exttool_ / extUrl → canvas_exturl_
function sanitizeFsName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
  return cleaned.slice(0, 180) || '未命名'
}

function iframeVideoTaskId(courseId: number, pageTitle: string): string {
  return `canvas_mvid_${courseId}_${sanitizeFsName(pageTitle)}`
}

function extToolVideoTaskId(courseId: number, fileId: string): string {
  return `canvas_exttool_${courseId}_${fileId}`
}

function extUrlVideoTaskId(courseId: number, uuid: string): string {
  return `canvas_exturl_${courseId}_${uuid}`
}

function moduleVideoBaseName(courseName: string, title: string): string {
  return sanitizeFsName(`${courseName}-${title}`)
}

// 哨兵 folderId：大纲补漏文件的真实 folder 不在课程 folderMap 里（「文件」tab 也看不到），
// 用 -3 占位，配合 folderMap 映射到 files/大纲/ 子目录，对应浏览器「大纲」tab。
// 模块补漏文件已带真实 folderId（由 fetchFileMeta 返回），folderMap 自动映射到真实 Canvas 文件夹，
// 真实 folderId 查不到时兜底落 files/ 根。
const SYLLABUS_FOLDER_ID = -3

// 空数组常量：zustand selector 兜底用，返回稳定引用避免无限重渲染（?? [] 每次新建数组会触发白屏）。
const EMPTY_TASK_IDS: string[] = []

/** 从 scanCourse 结果构建 CourseData，注入大纲补漏的哨兵文件夹映射。 */
function buildCourseData(r: {
  files?: CanvasFileItem[]
  folderMap?: Record<number, string>
  moduleFiles?: CanvasFileItem[]
  syllabusFiles?: CanvasFileItem[]
}): CourseData {
  const folderMap: Record<number, string> = { ...(r.folderMap ?? {}) }
  if ((r.syllabusFiles?.length ?? 0) > 0) folderMap[SYLLABUS_FOLDER_ID] = '大纲'
  return {
    files: r.files ?? [],
    folderMap,
    moduleFiles: r.moduleFiles ?? [],
    syllabusFiles: r.syllabusFiles ?? []
  }
}

// ─── 三态纯函数（不依赖任何独立布尔，消除 selectedCourseIds 冲突） ───
//
// 模型：selected 是真值（已解析任务实际勾选）；categorySelections 是
// 未解析分类的勾选意图占位。三态显示完全由这两者派生。
//
// 分类态：有已解析任务 → 看 selected 聚合；无 → 看意图。
// 课程态：三分类态聚合（全 all→all，全 none→none，否则 some）。

/** 单个分类的选中态 */
function catStateOf(ids: string[], selected: Set<string>, intent?: boolean): TriState {
  if (ids.length === 0) return intent ? 'all' : 'none' // 未解析 → 意图决定
  const sel = ids.reduce((n, id) => n + (selected.has(id) ? 1 : 0), 0)
  return sel === ids.length ? 'all' : sel > 0 ? 'some' : 'none'
}

/** 课程级态 = 四个分类态的聚合 */
function aggCourseState(f: TriState, t: TriState, p: TriState, m: TriState): TriState {
  if (f === 'all' && t === 'all' && p === 'all' && m === 'all') return 'all'
  if (f === 'none' && t === 'none' && p === 'none' && m === 'none') return 'none'
  return 'some'
}

/** 把 PPT课件（pptPdf，二元分类 none/all）并入课程级态。
 *  四分类全 all + pptPdf 选中 → all；四分类全 none + pptPdf 未选 → none；否则 some。
 *  pptPdf 是课程级聚合任务（非逐讲 taskId），故无 'some' 中间态。 */
function combinePptPdf(base: TriState, pptPdfOn: boolean | undefined): TriState {
  if (base === 'all' && pptPdfOn) return 'all'
  if (base === 'none' && !pptPdfOn) return 'none'
  return 'some'
}

// ─── 主组件 ──────────────────────────────────────────────────

export function CanvasBrowser() {
  // PERF [split]: 3 separate subscriptions to minimize re-render scope
  // Group 1: rarely-changing state (courses, scan results, config)
  const {
    localDestRoot, cloudUserToken, cloudSpaceInfo,
    downloadMode, fileConflictStrategy, hlsTranscodeMaxHeight, cloudLinkedIds, canvasCourses, canvasScanState, canvasScanMessage,
    canvasExpandedCourses, canvasCourseData, canvasTeachers, canvasSelectedTeachers,
    canvasLectures, canvasModuleVideos, canvasCourseCategorySelections
  } = useAppStore(useShallow(s => ({
    localDestRoot: s.localDestRoot,
    cloudUserToken: s.cloudUserToken,
    cloudSpaceInfo: s.cloudSpaceInfo,
    downloadMode: s.downloadMode,
    fileConflictStrategy: s.fileConflictStrategy,
    hlsTranscodeMaxHeight: s.hlsTranscodeMaxHeight,
    cloudLinkedIds: s.cloudLinkedIds,
    canvasCourses: s.canvasCourses,
    canvasScanState: s.canvasScanState,
    canvasScanMessage: s.canvasScanMessage,
    canvasExpandedCourses: s.canvasExpandedCourses,
    canvasCourseData: s.canvasCourseData,
    canvasTeachers: s.canvasTeachers,
    canvasSelectedTeachers: s.canvasSelectedTeachers,
    canvasLectures: s.canvasLectures,
    canvasModuleVideos: s.canvasModuleVideos,
    canvasCourseCategorySelections: s.canvasCourseCategorySelections
  })))
  // Group 2: frequently-changing (downloading flag — derived from progress)
  const downloading = useAppStore(s => s.downloading)
  // Group 3: stable action references (setters are stable, but grouped for clarity)
  const {
    setCanvasCourseData, setCanvasTeachers,
    setCanvasSelectedTeachers, setCanvasLtiToken, setCanvasLectures, setCanvasModuleVideos,
    setCanvasCourseCategorySelection, setAllCanvasCourseCategorySelections,
    resetCanvasScanResults, toggleCanvasExpand,
    setLocalDestRoot, setDownloading, resetProgress, applyProgress,
    setDownloadMode, setFileConflictStrategy, setHlsTranscodeMaxHeight, setCloudLinkedIds
  } = useAppStore(useShallow(s => ({
    setCanvasCourseData: s.setCanvasCourseData,
    setCanvasTeachers: s.setCanvasTeachers,
    setCanvasSelectedTeachers: s.setCanvasSelectedTeachers,
    setCanvasLtiToken: s.setCanvasLtiToken,
    setCanvasLectures: s.setCanvasLectures,
    setCanvasModuleVideos: s.setCanvasModuleVideos,
    setCanvasCourseCategorySelection: s.setCanvasCourseCategorySelection,
    setAllCanvasCourseCategorySelections: s.setAllCanvasCourseCategorySelections,
    resetCanvasScanResults: s.resetCanvasScanResults,
    toggleCanvasExpand: s.toggleCanvasExpand,
    setLocalDestRoot: s.setLocalDestRoot,
    setDownloading: s.setDownloading,
    resetProgress: s.resetProgress,
    applyProgress: s.applyProgress,
    setDownloadMode: s.setDownloadMode,
    setFileConflictStrategy: s.setFileConflictStrategy,
    setHlsTranscodeMaxHeight: s.setHlsTranscodeMaxHeight,
    setCloudLinkedIds: s.setCloudLinkedIds
  })))

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedTerm, setSelectedTerm] = useState<string>('all')

  const scanStartedRef = useRef(false)

  // ── 学期列表 ──
  const terms = useMemo(() => {
    const set = new Set(canvasCourses.map(c => c.term || '(无学期)'))
    return [...set].sort().reverse()
  }, [canvasCourses])

  // ── 按学期筛选课程 ──
  const filteredCourses = useMemo(() => {
    if (selectedTerm === 'all') return canvasCourses
    return canvasCourses.filter(c => (c.term || '(无学期)') === selectedTerm)
  }, [canvasCourses, selectedTerm])

  // ── 拉取课程列表（刷新时保留下载进度和已有扫描数据） ──
  // 逻辑提取到 services/prefetch.ts，登录后 App.tsx 也会调它预加载。
  const loadCourses = useCallback(async (): Promise<void> => {
    await prefetchCanvasCourses()
  }, [])

  useEffect(() => {
    if (scanStartedRef.current) return
    if (canvasScanState !== 'idle') return
    scanStartedRef.current = true
    void loadCourses()
  }, [loadCourses, canvasScanState])

  // ── 完整刷新：停止下载 + 释放已解析链接/选择/扫描数据，重新加载课程列表 ──
  // 与原 loadCourses（仅重拉列表、保留状态）不同，这里把页面回到"最初状态"。
  const onRefresh = useCallback(async (): Promise<void> => {
    // 1. 停止所有正在进行的下载任务（释放活跃连接与已解析直链）
    try { await window.api.download.cancelAll() } catch { /* ignore */ }
    // 2. 清空下载进度、both 模式映射、下载中标记
    resetProgress()
    setCloudLinkedIds({})
    setDownloading(false)
    // 3. 清空所有 Canvas 扫描数据 / 分类选中 / 展开 / 教师 / LTI token / 讲次
    resetCanvasScanResults()
    // 4. 清空本地勾选与学期筛选
    setSelected(new Set())
    setSelectedTerm('all')
    // 5. 重新拉取课程列表
    await loadCourses()
  }, [resetProgress, setCloudLinkedIds, setDownloading, resetCanvasScanResults, loadCourses])

  // ── 共享 hooks ──
  // [2.15] useDownloadProgressSubscription moved to App level — removed here
  // useCachedCloudTokenValidation 已移除：云盘 token 不再持久化，登录后由
  // App.tsx 的 prefetchCloudConnection 自动重新连接，无需启动恢复路径。
  const { cloudConn, onConnectCloud, onDisconnectCloud } = useCloudConnection()

  // ── HLS 模块视频进度订阅：把 canvas:hls-progress 落到 store.progress ──
  // 模块视频不走 download:start 队列，进度由 main 端 downloadModuleVideo 通过
  // canvas:hls-progress 推送；这里映射成 DownloadProgress 喂给 applyProgress，
  // 让 UI 进度条、waitForCourseCompletion、完成统计都能感知。
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
      // 后处理阶段（remux/transcode/upload）主进程把 segmentsTotal 清零，且 transcode 期间无进度回调；
      // 此时切片下载实际已完成 → received/total 置 1/1 让 pct 保持 100%，message 承载阶段文案，
      // 避免条从 100% 跌回 0% 误显"卡住"。
      const postDownload = p.phase === 'remuxing' || p.phase === 'transcoding' || p.phase === 'uploading'
      applyProgressRef.current({
        taskId: p.taskId,
        state: 'downloading',
        received: postDownload ? 1 : p.segmentsDone,
        total: postDownload ? 1 : p.segmentsTotal,
        unit: 'count',                 // 切片数非字节：不格式化为字节、不计算速度
        message: p.message || phaseLabel
      })
    })
    return unsub
  }, [])

  // ── PPT 课件进度订阅：把 canvas:ppt-progress 落到 store.progress ──
  // PPT 课件不走 download:start 队列，进度由 main 端 runPptLecture 通过
  // canvas:ppt-progress 推送（带 taskId，current/total 为讲次级 X/Y）；这里映射成
  // DownloadProgress 喂给 applyProgress，让 PPT课件 区块的进度条能实时显示。
  useEffect(() => {
    const unsub = window.api.ppt.onProgress(p => {
      if (!p.taskId) return
      applyProgressRef.current({
        taskId: p.taskId,
        state: 'downloading',
        received: p.current,
        total: p.total,
        message: p.phase
      })
    })
    return unsub
  }, [])

  // ── downloading 生命周期由 onDownload 的循环自行管理 ──
  // [Bug Fix] 不再使用 useDownloadCompletion(selectedArr, stats.active, true)。
  // 该 hook 只看当前页 selected 集合里的 taskId，但 Canvas 多课程下载是按课程串行
  // 处理的，且"全选/分类勾选"会把未扫描课程纳入 coursesToProcess 而其 taskId 不在
  // selected 中。当 selectedArr 里的课程全部完成、循环还在处理其余课程时，hook 会
  // 误判 activeCount===0 并提前 setDownloading(false)，导致 UI 退回"开始上传"而
  // 下方仍在下载。改为在 onDownload 循环的 finally 中统一收尾，并让等待逻辑覆盖
  // both 模式的云端镜像任务。

  // ── 选择操作 ──
  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])
  const toggleSelectMany = useCallback((ids: string[], on: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of ids) on ? next.add(id) : next.delete(id)
      return next
    })
  }, [])

  // ── 课程已解析任务 id 派生（files / teacher / ppt / moduleVideo 四类） ──
  // 顶层复用：onToggleAll / toggleCourse / toggleAllCategory / 三态判定 / onDownload
  const courseTaskIds = useCallback((courseId: number): {
    files: string[]; teacher: string[]; ppt: string[]; moduleVideo: string[]; all: string[]
  } => {
    const cd = canvasCourseData[courseId]
    const lec = canvasLectures[courseId]
    const mv = canvasModuleVideos[courseId]
    // 课件 = 常规文件 + 模块补漏 + 大纲补漏（统一 canvas_file_* taskId）
    const files: string[] = []
    if (cd) {
      for (const f of cd.files) files.push(fileTaskId(courseId, f.fileId))
      for (const f of cd.moduleFiles) files.push(fileTaskId(courseId, f.fileId))
      for (const f of cd.syllabusFiles) files.push(fileTaskId(courseId, f.fileId))
    }
    const teacher: string[] = []
    const ppt: string[] = []
    if (lec) for (const l of lec) {
      if (!l.teacher) continue
      teacher.push(lectureStreamTaskId(courseId, l.lectureNum, 'teacher'))
      ppt.push(lectureStreamTaskId(courseId, l.lectureNum, 'ppt'))
    }
    const moduleVideo: string[] = []
    if (mv) {
      for (const t of mv.iframes) moduleVideo.push(iframeVideoTaskId(courseId, t.pageTitle))
      for (const t of mv.extTools) moduleVideo.push(extToolVideoTaskId(courseId, t.fileId))
      for (const t of mv.extUrls) moduleVideo.push(extUrlVideoTaskId(courseId, t.uuid))
    }
    return { files, teacher, ppt, moduleVideo, all: [...files, ...teacher, ...ppt, ...moduleVideo] }
  }, [canvasCourseData, canvasLectures, canvasModuleVideos])

  /** 单课程的四分类态 + pptPdf + 课程级态（纯派生，不依赖 selectedCourseIds） */
  const courseStates = useCallback((courseId: number) => {
    const { files, teacher, ppt, moduleVideo } = courseTaskIds(courseId)
    const sel = canvasCourseCategorySelections[courseId]
    const f = catStateOf(files, selected, sel?.files)
    const t = catStateOf(teacher, selected, sel?.teacher)
    const p = catStateOf(ppt, selected, sel?.ppt)
    const m = catStateOf(moduleVideo, selected, sel?.moduleVideo)
    const pptPdf: TriState = sel?.pptPdf ? 'all' : 'none'
    const course = combinePptPdf(aggCourseState(f, t, p, m), sel?.pptPdf)
    return { files: f, teacher: t, ppt: p, moduleVideo: m, pptPdf, course }
  }, [courseTaskIds, canvasCourseCategorySelections, selected])

  // ── 课程级全选（顶层，作用于 filteredCourses） ──
  const onToggleAll = useCallback(() => {
    if (filteredCourses.length === 0) return
    const allFull = filteredCourses.every(c => courseStates(c.courseId).course === 'all')
    if (allFull) {
      // 全清：五分类意图 false + 所有已解析任务从 selected 删除
      setAllCanvasCourseCategorySelections(
        filteredCourses.map(c => c.courseId),
        { files: false, teacher: false, ppt: false, moduleVideo: false, pptPdf: false }
      )
      setSelected(prev => {
        const next = new Set(prev)
        for (const c of filteredCourses) {
          for (const id of courseTaskIds(c.courseId).all) next.delete(id)
        }
        return next
      })
    } else {
      // 全选：五分类意图 true + 所有已解析任务加入 selected
      setAllCanvasCourseCategorySelections(
        filteredCourses.map(c => c.courseId),
        { files: true, teacher: true, ppt: true, moduleVideo: true, pptPdf: true }
      )
      setSelected(prev => {
        const next = new Set(prev)
        for (const c of filteredCourses) {
          for (const id of courseTaskIds(c.courseId).all) next.add(id)
        }
        return next
      })
    }
  }, [filteredCourses, courseStates, courseTaskIds, setAllCanvasCourseCategorySelections])

  /** 单课程级复选框切换：all/some→全清，none→全选 */
  const toggleCourse = useCallback((courseId: number) => {
    const st = courseStates(courseId)
    const { all } = courseTaskIds(courseId)
    if (st.course === 'none') {
      setCanvasCourseCategorySelection(courseId, { files: true, teacher: true, ppt: true, moduleVideo: true, pptPdf: true })
      setSelected(prev => {
        const next = new Set(prev)
        for (const id of all) next.add(id)
        return next
      })
    } else {
      setCanvasCourseCategorySelection(courseId, { files: false, teacher: false, ppt: false, moduleVideo: false, pptPdf: false })
      setSelected(prev => {
        const next = new Set(prev)
        for (const id of all) next.delete(id)
        return next
      })
    }
  }, [courseStates, courseTaskIds, setCanvasCourseCategorySelection])

  // ── 顶层分类全选/全取消（作用于 filteredCourses 的某一分类） ──
  const toggleAllCategory = useCallback((cat: 'files' | 'teacher' | 'ppt' | 'moduleVideo' | 'pptPdf') => {
    if (filteredCourses.length === 0) return
    // pptPdf 是课程级聚合任务（无逐讲 taskId），只切换意图，不操作 selected
    if (cat === 'pptPdf') {
      const allOn = filteredCourses.every(c => canvasCourseCategorySelections[c.courseId]?.pptPdf)
      setAllCanvasCourseCategorySelections(
        filteredCourses.map(c => c.courseId),
        { pptPdf: !allOn }
      )
      return
    }
    const allOn = filteredCourses.every(c => courseStates(c.courseId)[cat] === 'all')
    setAllCanvasCourseCategorySelections(
      filteredCourses.map(c => c.courseId),
      { [cat]: !allOn }
    )
    setSelected(prev => {
      const next = new Set(prev)
      for (const c of filteredCourses) {
        const ids = courseTaskIds(c.courseId)[cat]
        for (const id of ids) allOn ? next.delete(id) : next.add(id)
      }
      return next
    })
  }, [filteredCourses, courseStates, courseTaskIds, canvasCourseCategorySelections, setAllCanvasCourseCategorySelections])

  const onSelectFolder = useCallback(async () => {
    const p = await window.api.selectFolder()
    if (p) setLocalDestRoot(p)
  }, [setLocalDestRoot])

  // ── 下载（按课程分批提交，解析一门立即开始下载） ──
  // PERF: read volatile store values via useAppStore.getState() inside the function body
  // instead of closures, so the dependency array only contains stable setter references.
  // [Bug Fix] 取消标志：onCancelAll 置 true，onDownload 串行循环据此中断，
  // 避免取消后循环继续为后续课程 scan→buildDownloadSpecs→download:start 重新入队。
  // 多门课程框选批量下载时，cancelAll 只清主进程队列，渲染端循环仍在跑会重新入队 → 表现为"取消无效"。
  const cancelRequestedRef = useRef(false)

  const onDownload = useCallback(async () => {
    const st = useAppStore.getState()
    if (st.downloading) return
    const needsLocal = st.downloadMode === 'local' || st.downloadMode === 'both'
    if (needsLocal && !st.localDestRoot) return
    const hasCatSel = Object.values(st.canvasCourseCategorySelections).some(s => s && (s.files || s.teacher || s.ppt || s.moduleVideo || s.pptPdf))
    if (selected.size === 0 && !hasCatSel) return
    st.resetProgress()
    st.setDownloading(true)
    cancelRequestedRef.current = false

    const buildCanvasCourseName = (c: CanvasCourse): string => {
      const sel = st.canvasSelectedTeachers[c.courseId]
      const all = st.canvasTeachers[c.courseId]?.filter(t => t.selected).map(t => t.teacher)
      const teachers = sel?.length ? sel : (all?.length ? all : c.teachers)
      const teacherStr = teachers.length > 0 ? teachers.join('/') : ''
      return [c.name, teacherStr].filter(Boolean).join('-')
    }

    // 待处理课程 = selected 解析出的 courseId ∪ 任一分类意图为 true 的 courseId
    const coursesToProcess = new Set<number>()
    for (const id of selected) {
      const m = id.match(/^canvas_(?:file|lecture|mvid|exttool|exturl)_(\d+)_/)
      if (m) coursesToProcess.add(Number(m[1]))
    }
    for (const id of Object.keys(st.canvasCourseCategorySelections)) {
      const sel = st.canvasCourseCategorySelections[Number(id)]
      // [Bug Fix] 漏了 sel.pptPdf：只勾「PPT课件」分类时该课程不进队列，
      // processCourse 的 pptPdf 分支(639-709行)不会执行 → 点击下载毫无反应。
      // pptPdf 是课程级聚合意图（无逐讲 taskId），不会从前面的 selected 正则解析出 courseId，
      // 必须在这里显式纳入。其他分类(files/teacher/ppt/moduleVideo)也由 selected 解析兜底，故补充 pptPdf 不影响它们。
      if (sel && (sel.files || sel.teacher || sel.ppt || sel.moduleVideo || sel.pptPdf)) coursesToProcess.add(Number(id))
    }

    const downloadOpts = {
      mode: st.downloadMode,
      conflictStrategy: st.fileConflictStrategy,
      localDestRoot: st.downloadMode !== 'cloud' ? st.localDestRoot : undefined
    }

    // ── 等待一门课的所有任务完成（done/skipped/error/cancelled） ──
    const waitForCourseCompletion = (taskIds: string[]): Promise<void> =>
      new Promise(resolve => {
        if (taskIds.length === 0) { resolve(); return }
        const remaining = new Set(taskIds)
        let done = false

        const curProgress = useAppStore.getState().progress
        for (const id of taskIds) {
          const s = curProgress[id]?.state
          if (s === 'done' || s === 'skipped' || s === 'error' || s === 'cancelled') {
            remaining.delete(id)
          }
        }
        if (remaining.size === 0) { resolve(); return }

        let timer: ReturnType<typeof setTimeout> | null = null
        const finish = (): void => {
          if (done) return
          done = true
          unsub()
          if (timer) clearTimeout(timer)
          resolve()
        }
        const unsub = window.api.download.onProgress(p => {
          if (done || !remaining.has(p.taskId)) return
          const terminal = p.state === 'done' || p.state === 'skipped' || p.state === 'error' || p.state === 'cancelled'
          if (terminal) {
            remaining.delete(p.taskId)
            if (remaining.size === 0) finish()
          }
        })
        timer = setTimeout(finish, 2 * 60 * 60 * 1000)
      })

    const processCourse = async (courseId: number): Promise<{ started: boolean; taskIds: string[]; localOnlyTaskIds: string[] }> => {
      const snap = useAppStore.getState() // fresh snapshot after awaits
      const c = snap.canvasCourses.find(cc => cc.courseId === courseId)
      if (!c) return { started: false, taskIds: [], localOnlyTaskIds: [] }
      const courseName = buildCanvasCourseName(c)
      const catSel = snap.canvasCourseCategorySelections[courseId]
      const courseSpecs: CanvasDownloadTaskSpec[] = []
      // Page iframe 模块视频（HLS，本地Only，不走 download:start 队列）
      const iframeTasks: Array<{ taskId: string; iframeUrl: string; baseName: string }> = []
      // PPT 课件聚合任务 id（batch 已 await 完成，计入返回用于完成统计；无云端镜像 → localOnly）
      let pptAggregateTaskId: string | undefined

      // 课件文件
      const filesWanted = catSel?.files
      if (filesWanted || [...selected].some(id => id.startsWith(`canvas_file_${courseId}_`))) {
        let cd = snap.canvasCourseData[courseId]
        if (!cd) {
          try {
            snap.applyProgress({ taskId: `canvas_course_scan_${courseId}`, state: 'pending', received: 0, total: 0, message: `正在扫描 ${c.name}…` })
            const r = await window.api.canvas.scanCourse(courseId)
            if (r.ok && r.files) {
              cd = buildCourseData(r)
              snap.setCanvasCourseData(courseId, cd)
            }
          } catch { /* skip */ }
          snap.applyProgress({ taskId: `canvas_course_scan_${courseId}`, state: 'done', received: 0, total: 0 })
        }
        if (cancelRequestedRef.current) return { started: false, taskIds: [], localOnlyTaskIds: [] }
        if (cd) {
          // 合并常规文件 + 模块补漏 + 大纲补漏，统一走 canvas-files 下载路径
          const allFiles = [...cd.files, ...cd.moduleFiles, ...cd.syllabusFiles]
          const selFiles = catSel?.files ? allFiles : allFiles.filter(f => selected.has(fileTaskId(courseId, f.fileId)))
          if (selFiles.length > 0) {
            const r = await window.api.canvas.buildDownloadSpecs(courseName, courseId, selFiles, cd.folderMap, needsLocal ? st.localDestRoot : '', c.term || '')
            for (const spec of r.specs ?? []) {
              const origFile = selFiles.find(f => spec.taskId.includes(String(f.fileId)))
              if (origFile) spec.taskId = fileTaskId(courseId, origFile.fileId)
            }
            courseSpecs.push(...(r.specs ?? []))
          }
        }
      }

      // 课堂视频
      const videoWanted = catSel?.teacher || catSel?.ppt
      if (videoWanted || [...selected].some(id => id.startsWith(`canvas_lecture_${courseId}_`))) {
        let lectures = snap.canvasLectures[courseId]
        let lti = snap.canvasLtiTokens[courseId]

        if (!lectures || !lti) {
          try {
            snap.applyProgress({ taskId: `canvas_video_scan_${courseId}`, state: 'pending', received: 0, total: 0, message: `正在扫描 ${c.name} 课堂视频…` })
            const r = await window.api.canvas.classVideoScan(courseId)
            if (r.ok) {
              if (!lectures) {
                lectures = r.lectures ?? []
                snap.setCanvasLectures(courseId, lectures)
                snap.setCanvasTeachers(courseId, r.teachers ?? [])
                const allTeachers = (r.teachers ?? []).filter(t => t.selected).map(t => t.teacher)
                if (allTeachers.length > 0) snap.setCanvasSelectedTeachers(courseId, allTeachers)
              }
              if (!lti && r.token && r.canvasCourseId) {
                lti = { token: r.token, canvasCourseId: r.canvasCourseId }
                snap.setCanvasLtiToken(courseId, lti)
              }
            }
          } catch { /* skip */ }
          snap.applyProgress({ taskId: `canvas_video_scan_${courseId}`, state: 'done', received: 0, total: 0 })
        }

        if (cancelRequestedRef.current) return { started: false, taskIds: [], localOnlyTaskIds: [] }
        if (lectures?.length && lti) {
          // 按角色携带意图：只下用户实际勾选的一路（teacher 或 ppt），
          // 避免每讲无脑产 2 路 spec 把未勾选的一路也下载（修复「选教师/PPT 任一会两个都下」）
          const lectureItems: CanvasLectureDownloadItem[] = []
          for (const l of lectures) {
            if (!l.teacher) continue
            const teacherWanted = catSel?.teacher || selected.has(lectureStreamTaskId(courseId, l.lectureNum, 'teacher'))
            const pptWanted = catSel?.ppt || selected.has(lectureStreamTaskId(courseId, l.lectureNum, 'ppt'))
            if (!teacherWanted && !pptWanted) continue
            lectureItems.push({
              lectureNum: l.lectureNum,
              teacher: teacherWanted ? l.teacher : undefined,
              ppt: pptWanted ? l.teacher : undefined
            })
          }
          if (lectureItems.length > 0) {
            const r = await window.api.canvas.downloadLectures(courseName, courseId, lectureItems, lti.token, needsLocal ? st.localDestRoot : '', st.fileConflictStrategy, c.term || '')
            if (r.ok && r.specs) courseSpecs.push(...r.specs)
          }
        }
      }

      // PPT 课件 PDF（需要课堂视频的 LTI token + 讲次列表）
      // 支持 local/cloud/both：cloud/both 模式生成 PDF 后由主进程上传云盘；
      // cloud-only（destRoot 空）PDF 仅作中间产物，上传后主进程清理。
      const pptPdfWanted = catSel?.pptPdf
      if (pptPdfWanted) {
        let pdfLectures = snap.canvasLectures[courseId]
        let pdfLti = snap.canvasLtiTokens[courseId]

        // 若课堂视频未扫描，自动触发扫描获取 LTI token
        if (!pdfLectures || !pdfLti) {
          try {
            snap.applyProgress({ taskId: `canvas_ppt_scan_${courseId}`, state: 'pending', received: 0, total: 0, message: `正在扫描 ${c.name} 课堂视频（PPT）…` })
            const r = await window.api.canvas.classVideoScan(courseId)
            if (r.ok) {
              if (!pdfLectures) {
                pdfLectures = r.lectures ?? []
                snap.setCanvasLectures(courseId, pdfLectures)
                snap.setCanvasTeachers(courseId, r.teachers ?? [])
                const allTeachers = (r.teachers ?? []).filter(t => t.selected).map(t => t.teacher)
                if (allTeachers.length > 0) snap.setCanvasSelectedTeachers(courseId, allTeachers)
              }
              if (!pdfLti && r.token && r.canvasCourseId) {
                pdfLti = { token: r.token, canvasCourseId: r.canvasCourseId }
                snap.setCanvasLtiToken(courseId, pdfLti)
              }
            }
          } catch { /* skip */ }
          snap.applyProgress({ taskId: `canvas_ppt_scan_${courseId}`, state: 'done', received: 0, total: 0 })
        }

        if (cancelRequestedRef.current) return { started: false, taskIds: [], localOnlyTaskIds: [] }
        if (pdfLectures?.length && pdfLti) {
          const validLectures = pdfLectures.filter(l => l.teacher)
          if (validLectures.length > 0) {
            const pptTaskId = `canvas_ppt_pdf_${courseId}`
            // local/both 用用户目录；cloud-only 传空串，主进程走系统临时目录兜底
            const pptDestRoot = needsLocal ? st.localDestRoot : ''
            const needsCloudPpt = st.downloadMode === 'cloud' || st.downloadMode === 'both'
            const cloudToken = needsCloudPpt ? useAppStore.getState().cloudUserToken ?? undefined : undefined
            // PPT 聚合任务进 batchTaskIds：在写 pending 时即计入，让 OverallProgressBar
            // 能实时反映 PPT 下载进度（processCourse 内同步 await，若返回后才 add 会错过整个下载过程）
            useAppStore.getState().addBatchTaskIds([pptTaskId])
            snap.applyProgress({ taskId: pptTaskId, state: 'pending', received: 0, total: validLectures.length, message: `正在下载PPT课件 (${validLectures.length} 讲)…` })
            try {
              const r = await window.api.ppt.downloadBatch({
                taskId: pptTaskId,
                lectures: validLectures.map(l => ({
                  // 传加密串 videoId 原值（不是 Number()，那会变 NaN）。
                  // 主进程 runPptLecture 用 resolveIvsVideoId 把它解析成 PPT API 需要的数值型 ivsVideoId。
                  ivsVideoId: l.teacher!.videoId,
                  lectureName: `第${l.lectureNum}讲 ${l.date}`,
                  videoSession: {
                    beginTime: l.teacher!.beginTime,
                    teacher: l.teacher!.teacher,
                    classroom: l.teacher!.classroom
                  }
                })),
                courseName,
                destRoot: pptDestRoot,
                cloudUserToken: cloudToken,
                conflictStrategy: st.fileConflictStrategy,
                term: c.term
              })
              const successCount = r.results?.filter(x => x.ok && !x.skipped).length ?? 0
              const skippedCount = r.results?.filter(x => x.skipped).length ?? 0
              const failCount = (r.results?.length ?? 0) - successCount - skippedCount
              const parts: string[] = []
              if (successCount > 0) parts.push(`${successCount}成功`)
              if (skippedCount > 0) parts.push(`${skippedCount}跳过`)
              if (failCount > 0) parts.push(`${failCount}失败`)
              snap.applyProgress({
                taskId: pptTaskId,
                state: failCount > 0 ? 'error' : 'done',
                received: successCount, total: validLectures.length,
                message: `PPT: ${parts.join('，') || '无操作'}`
              })
              pptAggregateTaskId = pptTaskId
            } catch {
              snap.applyProgress({ taskId: pptTaskId, state: 'error', received: 0, total: validLectures.length, message: 'PPT下载失败' })
              pptAggregateTaskId = pptTaskId
            }
          }
        }
      }

      // 模块视频：三类来源。
      //   iframe(Page HLS) — 通过 downloadModuleVideoNow（可选云盘上传）
      //   extTool/ExternalUrl(直接MP4) — 走 download:start，支持 cloud/both
      const moduleVideoWanted = catSel?.moduleVideo
      const hasMvSelection = [...selected].some(id =>
        id.startsWith(`canvas_mvid_${courseId}_`) ||
        id.startsWith(`canvas_exttool_${courseId}_`) ||
        id.startsWith(`canvas_exturl_${courseId}_`)
      )
      if (moduleVideoWanted || hasMvSelection) {
        let mv = snap.canvasModuleVideos[courseId]
        if (!mv) {
          try {
            snap.applyProgress({ taskId: `canvas_mvid_scan_${courseId}`, state: 'pending', received: 0, total: 0, message: `正在扫描 ${c.name} 单元视频…` })
            const r = await window.api.canvas.moduleVideoScan(courseId)
            if (r.ok) {
              mv = { iframes: r.tasks ?? [], extTools: r.extTools ?? [], extUrls: r.extUrls ?? [] }
              snap.setCanvasModuleVideos(courseId, mv)
            }
          } catch { /* skip */ }
          snap.applyProgress({ taskId: `canvas_mvid_scan_${courseId}`, state: 'done', received: 0, total: 0 })
        }
        if (cancelRequestedRef.current) return { started: false, taskIds: [], localOnlyTaskIds: [] }

        if (mv) {
          // iframe HLS：支持 cloud/both 模式（下载完自动上传云盘）。
          // downloadModuleVideoNow 需要本地目录做中间存储（localDestRoot 或 tmpdir），
          // 因此 cloud-only 模式下如果 localDestRoot 为空也允许（主进程侧用 os.tmpdir）。
          for (const t of mv.iframes) {
            const tid = iframeVideoTaskId(courseId, t.pageTitle)
            if (moduleVideoWanted || selected.has(tid)) {
              iframeTasks.push({ taskId: tid, iframeUrl: t.iframeUrl, baseName: moduleVideoBaseName(courseName, t.pageTitle) })
            }
          }
          // extTool/extUrl 直接 MP4：走 download:start（支持 cloud/both）
          const selExtTools = mv.extTools.filter(t => moduleVideoWanted || selected.has(extToolVideoTaskId(courseId, t.fileId)))
          const selExtUrls = mv.extUrls.filter(t => moduleVideoWanted || selected.has(extUrlVideoTaskId(courseId, t.uuid)))
          if (selExtTools.length > 0 || selExtUrls.length > 0) {
            try {
              const r = await window.api.canvas.moduleVideoDownload(courseName, courseId, selExtTools, selExtUrls, needsLocal ? st.localDestRoot : '', st.fileConflictStrategy, c.term || '')
              if (r.ok && r.specs) courseSpecs.push(...r.specs)
            } catch { /* skip */ }
          }
        }
      }

      if (courseSpecs.length === 0 && iframeTasks.length === 0 && !pptAggregateTaskId) return { started: false, taskIds: [], localOnlyTaskIds: [] }
      // [Bug Fix] 取消后不再 download:start 入队，避免主进程清空队列后又重新入队
      if (cancelRequestedRef.current) return { started: false, taskIds: [], localOnlyTaskIds: [] }
      // 常规 specs 进 batchTaskIds：写 pending 时即计入（processCourse 返回后才 add 会
      // 错过 download:start 后的解析/下载过程，OverallProgressBar 看不到这批在进行）
      if (courseSpecs.length > 0) useAppStore.getState().addBatchTaskIds(courseSpecs.map(s => s.taskId))
      for (const spec of courseSpecs) {
        if (!useAppStore.getState().progress[spec.taskId]) {
          useAppStore.getState().applyProgress({ taskId: spec.taskId, state: 'pending', received: 0, total: 0 })
        }
      }
      // iframe HLS：进入 pending，随后在 download.start 之后串行跑
      if (iframeTasks.length > 0) useAppStore.getState().addBatchTaskIds(iframeTasks.map(m => m.taskId))
      for (const mvt of iframeTasks) {
        if (!useAppStore.getState().progress[mvt.taskId]) {
          useAppStore.getState().applyProgress({ taskId: mvt.taskId, state: 'pending', received: 0, total: 0, message: '排队中' })
        }
      }
      if (st.downloadMode === 'both') {
        const pairs: Record<string, string> = {}
        for (const spec of courseSpecs) pairs[spec.taskId] = spec.taskId + '_cloud'
        useAppStore.getState().setCloudLinkedIds(prev => ({ ...prev, ...pairs }))
      }
      let result: { ok: boolean; error?: string }
      try {
        result = courseSpecs.length > 0
          ? await window.api.download.start(st.localDestRoot, courseSpecs, downloadOpts)
          : { ok: true }
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : 'IPC 通信失败' }
      }
      if (!result.ok) {
        useAppStore.getState().setCloudLinkedIds(prev => {
          const next = { ...prev }
          for (const spec of courseSpecs) delete next[spec.taskId]
          return next
        })
        for (const spec of courseSpecs) {
          useAppStore.getState().applyProgress({ taskId: spec.taskId, state: 'error', received: 0, total: 0, message: result.error || '启动失败' })
        }
        // 常规启动失败也把 iframe HLS 标记为取消，避免悬空 pending
        for (const mvt of iframeTasks) {
          useAppStore.getState().applyProgress({ taskId: mvt.taskId, state: 'cancelled', received: 0, total: 0, message: '本课程下载未启动' })
        }
        return { started: false, taskIds: [], localOnlyTaskIds: [] }
      }
      const localTaskIds = courseSpecs.filter(s => !s.taskId.endsWith('_cloud')).map(s => s.taskId)

      // iframe HLS 串行下载。download.start 已立即返回，常规下载在主进程异步跑，
      // 这里并行处理 iframe HLS。每个完成后 applyProgress 落终态，waitForCourseCompletion
      // 据此推进。取消后不再启动后续（当前在跑的那个跑完才停）。
      // iframe HLS：下载完 mp4 后可选上传云盘。
      // 与 downloadOpts.localDestRoot 对齐：cloud 模式传空串，主进程走跨平台临时目录兜底
      // 并在上传成功后清理；local/both 模式 localDestRoot 必非空（onDownload 守卫），作本地副本目录。
      const localDestForIframe = st.downloadMode !== 'cloud' ? st.localDestRoot : ''
      for (const mvt of iframeTasks) {
        if (cancelRequestedRef.current) {
          useAppStore.getState().applyProgress({ taskId: mvt.taskId, state: 'cancelled', received: 0, total: 0, message: '已取消' })
          continue
        }
        // cloud/both 模式：传 cloudUserToken 让主进程下载完 mp4 后自动上传云盘
        const needsCloud = st.downloadMode === 'cloud' || st.downloadMode === 'both'
        const cloudToken = needsCloud ? useAppStore.getState().cloudUserToken ?? undefined : undefined
        try {
          const r = await window.api.canvas.downloadModuleVideoNow(
            courseName, mvt.iframeUrl, mvt.baseName, localDestForIframe, mvt.taskId,
            cloudToken, cloudToken ? st.fileConflictStrategy : undefined,
            useAppStore.getState().hlsTranscodeMaxHeight,
            c.term || ''
          )
          if (r.ok) {
            if (r.skipped) {
              useAppStore.getState().applyProgress({ taskId: mvt.taskId, state: 'skipped', received: 0, total: 0, filePath: r.path, message: '已存在，跳过' })
            } else {
              useAppStore.getState().applyProgress({ taskId: mvt.taskId, state: 'done', received: 0, total: 0, filePath: r.path })
            }
          } else {
            useAppStore.getState().applyProgress({ taskId: mvt.taskId, state: 'error', received: 0, total: 0, message: r.error || 'HLS 下载失败' })
          }
        } catch (err) {
          useAppStore.getState().applyProgress({ taskId: mvt.taskId, state: 'error', received: 0, total: 0, message: err instanceof Error ? err.message : 'HLS 下载异常' })
        }
      }

      // cloud 模式下 iframe HLS 也传了云盘，不再是 localOnly
      const iframeLocalOnly = (st.downloadMode === 'cloud') ? [] : iframeTasks.map(m => m.taskId)
      // PPT 聚合任务：batch 已 await 到终态，计入 taskIds 用于完成统计；
      // 无云端镜像（上传在主进程内部完成），both 模式下也归入 localOnly 不等 _cloud
      const taskIds = [...localTaskIds, ...iframeTasks.map(m => m.taskId)]
      const localOnlyIds = [...iframeLocalOnly]
      if (pptAggregateTaskId) {
        taskIds.push(pptAggregateTaskId)
        localOnlyIds.push(pptAggregateTaskId)
      }
      return { started: true, taskIds, localOnlyTaskIds: localOnlyIds }
    }

    try {
      const allLocalTaskIds: string[] = []  // 累积所有已提交任务的本地 taskId，完成后用于统计通知
      // localOnlyTaskIds = 模块视频（HLS，无云盘镜像）；both 模式下不加 _cloud 等待/统计
      const allLocalOnlyTaskIds: string[] = []
      for (const id of coursesToProcess) {
        // [Bug Fix] 取消后立即停止处理后续课程，不再 scan/入队
        if (cancelRequestedRef.current) break
        const { started, taskIds, localOnlyTaskIds } = await processCourse(id)
        if (cancelRequestedRef.current) break
        if (started && taskIds.length > 0) {
          allLocalTaskIds.push(...taskIds)
          // batchTaskIds 已在 processCourse 内各 pending 写入点追加（常规/iframe/PPT），
          // 此处不再重复 add（addBatchTaskIds 去重不会错，但入队点追加语义更准、且让 PPT/iframe
          // 下载过程即被 OverallProgressBar 计入，而非仅完成态）。
          allLocalOnlyTaskIds.push(...localOnlyTaskIds)
          // 记录该课程已提交的 taskIds，供 CourseProgressSummary 在扫描数据
          // 被 deleteCanvasCourseData 清掉后仍能统计 done/total（下载完成后进度条不消失）。
          useAppStore.getState().setCanvasCourseTaskIds(id, taskIds)
          // 模块视频（localOnly）在 processCourse 内已 await 到终态，且不发 download:progress
          // IPC，故不纳入 waitForCourseCompletion 的等待集，只等常规任务（含 both 模式 _cloud 镜像）。
          const localOnlySet = new Set(localOnlyTaskIds)
          const queuedIds = taskIds.filter(t => !localOnlySet.has(t))
          const waitIds = st.downloadMode === 'both'
            ? [...queuedIds, ...queuedIds.map(t => t + '_cloud')]
            : queuedIds
          await waitForCourseCompletion(waitIds)
        }
        useAppStore.getState().deleteCanvasCourseData(id)
      }
      // 下载全部收尾 → 统计成功/失败，弹系统通知
      if (allLocalTaskIds.length > 0) {
        const progress = useAppStore.getState().progress
        const isBoth = useAppStore.getState().downloadMode === 'both'
        const localOnlySet = new Set(allLocalOnlyTaskIds)
        let done = 0
        let failed = 0
        for (const tid of allLocalTaskIds) {
          const localSt = progress[tid]?.state
          // 模块视频（localOnly）无云盘镜像：只看本地态
          if (isBoth && !localOnlySet.has(tid)) {
            const cloudId = tid + '_cloud'
            const cloudSt = progress[cloudId]?.state
            if (localSt === 'error' || cloudSt === 'error') failed++
            else if ((localSt === 'done' || localSt === 'skipped') && (!cloudId || cloudSt === 'done' || cloudSt === 'skipped')) done++
          } else {
            if (localSt === 'done' || localSt === 'skipped') done++
            else if (localSt === 'error') failed++
          }
        }
        if (done > 0 || failed > 0) {
          const body = failed > 0 ? `成功 ${done} 项，失败 ${failed} 项` : `全部 ${done} 项完成`
          window.api.notify('下载完成', body).catch(() => undefined)
        }
      }
    } finally {
      // [Bug Fix] downloading 生命周期由循环统一收尾：只要循环还在跑（含解析下一门课
      // 的空档、或 both 模式云端上传尾巴），就保持 downloading=true，避免提前退回
      // "开始上传"。循环结束意味着所有提交的任务都已到达终态。
      // 幽灵兜底：残留（主进程漏发终态 / cancel 边角）统一标 cancelled，确保
      // OverallProgressBar active 归零，不再"每课剩一个在转"。
      useAppStore.getState().markBatchPendingCancelled()
      useAppStore.getState().setDownloading(false)
      // [Bug Fix] 读最新的 downloadMode，而非循环开始时捕获的 st.downloadMode：
      // 用户可能在漫长的下载过程中通过 ModeSegmented 切换模式，用陈旧值会错误地
      // 保留或清空 cloudLinkedIds（both→local 切换后仍不清空 → 陈旧镜像泄漏）。
      if (useAppStore.getState().downloadMode !== 'both') useAppStore.getState().setCloudLinkedIds({})
    }
  }, [selected]) // only `selected` is captured as closure — all store values read via getState()


  // ── 全局控制 ──
  const onPauseAll = useCallback(() => { window.api.download.pauseAll().catch(() => undefined) }, [])
  const onResumeAll = useCallback(() => { window.api.download.resumeAll().catch(() => undefined) }, [])
  const onCancelAll = useCallback(() => {
    // [Bug Fix] 先置取消标志，中断 onDownload 串行循环，再调主进程 cancelAll 清队列。
    // 否则循环会继续为后续课程 download:start 重新入队，表现为"取消无效"。
    cancelRequestedRef.current = true
    window.api.download.cancelAll().catch(() => undefined)
  }, [])

  // PERF [useMemo]: wrap tri-state computations to avoid re-running on every render
  const filteredCourseIds = useMemo(() => filteredCourses.map(c => c.courseId), [filteredCourses])
  const courseTriState: TriState = useMemo(() => {
    if (filteredCourseIds.length === 0) return 'none'
    const states = filteredCourseIds.map(id => courseStates(id).course)
    if (states.every(s => s === 'all')) return 'all'
    return states.some(s => s !== 'none') ? 'some' : 'none'
  }, [filteredCourseIds, courseStates])

  const categoryTriState = useCallback((cat: 'files' | 'teacher' | 'ppt' | 'moduleVideo' | 'pptPdf'): TriState => {
    if (filteredCourseIds.length === 0) return 'none'
    const states = filteredCourseIds.map(id => courseStates(id)[cat])
    if (states.every(s => s === 'all')) return 'all'
    return states.some(s => s !== 'none') ? 'some' : 'none'
  }, [filteredCourseIds, courseStates])

  // ── 统计（mode-aware） ──
  const needsCloud = downloadMode === 'cloud' || downloadMode === 'both'
  const needsLocal = downloadMode === 'local' || downloadMode === 'both'

  // 任一分类选中或 selected 里有任务 → 该课程可下载
  const isCourseDownloadable = (id: number): boolean => courseStates(id).course !== 'none'
  const canStart = (filteredCourseIds.some(isCourseDownloadable) || selected.size > 0)
    && !downloading
    && (!needsCloud || !!cloudUserToken)
    && (!needsLocal || !!localDestRoot)
  const pendingCourseCount = filteredCourseIds.filter(isCourseDownloadable).length

  return (
    <div className="flex h-full w-full flex-col">
      {/* 顶栏 */}
      <div className="no-drag flex items-center gap-4 border-b border-bd px-6 py-3">
        {canvasScanState === 'scanning' && (
          <span className="inline-flex items-center gap-2 text-sm text-text-2"><Spinner size={14} /> {canvasScanMessage}</span>
        )}
        {canvasScanState === 'done' && (
          <span className="text-sm text-text-2">{canvasCourses.length} 门 Canvas 课程{selectedTerm !== 'all' && <span className="text-text-3"> · {selectedTerm}</span>}</span>
        )}
        {canvasScanState === 'error' && <span className="text-sm text-warning">{canvasScanMessage}</span>}
        <div className="flex-1" />
        {canvasScanState === 'done' && canvasCourses.length > 0 && (
          <button type="button" onClick={() => void onRefresh()} className="rounded-lg px-3 py-1.5 text-xs text-text-3 hover:bg-surface-2 hover:text-text-1">刷新</button>
        )}
      </div>

      {/* 学期筛选 */}
      {canvasScanState === 'done' && terms.length > 1 && (
        <div className="no-drag flex items-center gap-2 border-b border-bd bg-surface-3 px-6 py-2">
          <span className="text-xs text-text-3">学期：</span>
          <TermPill label="全部" active={selectedTerm === 'all'} count={canvasCourses.length} onClick={() => setSelectedTerm('all')} />
          {terms.map(t => {
            const count = canvasCourses.filter(c => (c.term || '(无学期)') === t).length
            return <TermPill key={t} label={t} active={selectedTerm === t} count={count} onClick={() => setSelectedTerm(t)} />
          })}
        </div>
      )}

      {/* 操作栏 */}
      {canvasScanState === 'done' && canvasCourses.length > 0 && (
        <div className="no-drag border-b border-bd bg-surface-3 px-6 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={onToggleAll} className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-text-1 transition-colors hover:bg-surface-2">
              <TriCheckbox state={courseTriState} size="lg" />
              <span>选择课程 <span className="text-text-3">({pendingCourseCount} / {filteredCourses.length})</span></span>
            </button>
            <div className="h-4 w-px bg-bd-strong" />
            <TopCategoryBtn label="课件" icon="file" state={categoryTriState('files')} color="violet" onClick={() => toggleAllCategory('files')} />
            <TopCategoryBtn label="视频-教师" icon="user" state={categoryTriState('teacher')} color="blue" onClick={() => toggleAllCategory('teacher')} />
            <TopCategoryBtn label="视频-PPT" icon="screen" state={categoryTriState('ppt')} color="green" onClick={() => toggleAllCategory('ppt')} />
            <TopCategoryBtn label="PPT课件PDF" icon="file" state={categoryTriState('pptPdf')} color="green" onClick={() => toggleAllCategory('pptPdf')} />
            <TopCategoryBtn label="单元视频" icon="screen" state={categoryTriState('moduleVideo')} color="violet" onClick={() => toggleAllCategory('moduleVideo')} />
            <div className="h-4 w-px bg-bd-strong" />
            {/* 云盘连接 */}
            {needsCloud && cloudUserToken ? (
              <button type="button" onClick={onDisconnectCloud}
                className="inline-flex max-w-full items-center gap-2 rounded-lg border border-info-ring bg-info-bg px-3 py-1.5 text-xs font-medium text-info transition-all hover:border-cloud-40 hover:text-cloud"
                title="点击断开云盘连接">
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                  <path d="M12 13v5m-3-3l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="truncate">
                  交大云盘已连接
                  {cloudSpaceInfo && (
                    <span className="ml-1.5 text-text-muted">
                      {(Number(cloudSpaceInfo.size) / (1024 ** 3)).toFixed(1)}GB / {(Number(cloudSpaceInfo.capacity) / (1024 ** 3)).toFixed(0)}GB
                    </span>
                  )}
                </span>
              </button>
            ) : needsCloud && cloudConn.status === 'connecting' ? (
              <span className="inline-flex items-center gap-2 text-xs text-info"><Spinner size={14} /> 正在连接交大云盘…</span>
            ) : needsCloud ? (
              <button type="button" onClick={() => void onConnectCloud()}
                className="inline-flex max-w-full items-center gap-2 rounded-lg border border-bd-strong bg-surface-3 px-3 py-1.5 text-xs text-text-2 transition-all hover:border-info-ring hover:text-info"
                title="通过 jAccount 单点登录连接交大云盘">
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                </svg>
                <span>连接交大云盘</span>
              </button>
            ) : null}
            {cloudConn.status === 'error' && !cloudUserToken && needsCloud && (
              <span className="text-xs text-warning">{cloudConn.message}</span>
            )}
            {/* 本地目录 */}
            {needsLocal && (
              <button type="button" onClick={onSelectFolder} className="inline-flex max-w-[200px] items-center gap-2 rounded-lg border border-bd-strong bg-surface-3 px-3 py-1.5 text-xs text-text-2 transition-all hover:border-success-ring hover:text-success">
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
                <span className="truncate">{localDestRoot || '选择下载目录'}</span>
              </button>
            )}
            {downloading && <OverallProgressBar />}
            <div className="flex-1" />
          </div>
          {/* 第二行：模式 + 冲突策略 + 视频质量（全部右对齐）。
              视频质量仅对网页嵌入(HLS)类单元视频生效，未勾选单元视频时隐藏避免误导。 */}
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <div className="flex-1" />
            <ModeSegmented value={downloadMode} onChange={setDownloadMode} />
            <ConflictStrategySegmented value={fileConflictStrategy} onChange={setFileConflictStrategy} />
            {categoryTriState('moduleVideo') !== 'none' && (
              <HlsTranscodeSegmented value={hlsTranscodeMaxHeight} onChange={setHlsTranscodeMaxHeight} />
            )}
          </div>
          {/* 第三行：全局控制 + 开始下载（右对齐） */}
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <div className="flex-1" />
            {downloading && (
              <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
                <GlobalCtrlButton kind="pause" onClick={onPauseAll} title="暂停全部" />
                <GlobalCtrlButton kind="resume" onClick={onResumeAll} title="继续全部" />
                <GlobalCtrlButton kind="cancel" onClick={onCancelAll} title="取消全部" />
              </div>
            )}
            <button type="button" onClick={() => void onDownload()} disabled={!canStart}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-white shadow-glow-sm transition-all hover:scale-[1.02] hover:bg-accent-light active:scale-[0.98] disabled:scale-100 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-4 disabled:shadow-none disabled:opacity-60">
              {downloading ? '进行中…'
                : downloadMode === 'local' ? `开始下载 ${pendingCourseCount} 项`
                : downloadMode === 'cloud' ? `开始上传 ${pendingCourseCount} 项`
                : `开始下载+上传 ${pendingCourseCount} 项`}
            </button>
          </div>
        </div>
      )}

      {/* 课程列表 */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {canvasScanState === 'scanning' && (
          <div className="relative mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
            <div className="pointer-events-none absolute inset-0 -z-10 bg-hero-radial opacity-70 blur-2xl" />
            <Spinner size={32} />
            <div className="mt-5 text-base font-medium text-text-1">{canvasScanMessage || '正在扫描…'}</div>
          </div>
        )}
        {canvasScanState === 'error' && (
          <div className="relative mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
            <div className="pointer-events-none absolute inset-0 -z-10 bg-hero-radial opacity-60 blur-2xl" />
            <svg className="h-12 w-12 text-warning/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <div className="mt-4 max-w-sm rounded-xl bg-warning-bg px-4 py-2.5 text-sm font-medium text-warning ring-1 ring-warning-ring">{canvasScanMessage}</div>
            <button type="button" onClick={() => void loadCourses()} className="mt-5 inline-flex h-10 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-white shadow-glow-sm transition-all hover:scale-[1.02] hover:bg-accent-light active:scale-[0.98]">重试</button>
          </div>
        )}
        {canvasScanState === 'done' && canvasCourses.length > 0 && filteredCourses.length === 0 && (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
            <div className="text-base font-medium text-text-1">该学期没有课程</div>
            <div className="mt-2 text-sm text-text-3">请选择其他学期或"全部"</div>
          </div>
        )}
        {canvasScanState === 'done' && filteredCourses.length > 0 && (
          <div className="flex flex-col gap-4">
            {filteredCourses.map((c, idx) => (
              <div
                key={c.courseId}
                className="animate-fadeInUp"
                style={{ animationDelay: `${Math.min(idx, 8) * 40}ms`, animationFillMode: 'backwards' }}
              >
              <CanvasCourseCard
                course={c}
                expanded={canvasExpandedCourses.has(c.courseId)}
                courseData={canvasCourseData[c.courseId]}
                lectures={canvasLectures[c.courseId]}
                teachers={canvasTeachers[c.courseId]}
                selectedTeachers={canvasSelectedTeachers[c.courseId]}
                moduleVideos={canvasModuleVideos[c.courseId]}
                categorySelections={canvasCourseCategorySelections[c.courseId]}
                selected={selected}
                onToggleExpand={() => toggleCanvasExpand(c.courseId)}
                onSetCourseData={data => setCanvasCourseData(c.courseId, data)}
                onSetLectures={l => setCanvasLectures(c.courseId, l)}
                onSetTeachers={t => setCanvasTeachers(c.courseId, t)}
                onSetSelectedTeachers={t => setCanvasSelectedTeachers(c.courseId, t)}
                onSetLtiToken={d => setCanvasLtiToken(c.courseId, d)}
                onSetModuleVideos={v => setCanvasModuleVideos(c.courseId, v)}
                onSetCategorySelection={sel => setCanvasCourseCategorySelection(c.courseId, sel)}
                toggleSelect={toggleSelect}
                toggleSelectMany={toggleSelectMany}
                onToggleCourseSelect={() => toggleCourse(c.courseId)}
              />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 课程卡片 ────────────────────────────────────────────────

interface CourseData {
  files: CanvasFileItem[]
  folderMap: Record<number, string>
  moduleFiles: CanvasFileItem[]
  syllabusFiles: CanvasFileItem[]
}

const CanvasCourseCard = memo(function CanvasCourseCard({
  course, expanded, courseData, lectures, teachers, selectedTeachers,
  moduleVideos, categorySelections, selected,
  onToggleExpand, onSetCourseData, onSetLectures, onSetTeachers, onSetSelectedTeachers, onSetLtiToken,
  onSetModuleVideos, onSetCategorySelection, toggleSelect, toggleSelectMany, onToggleCourseSelect
}: {
  course: CanvasCourse
  expanded: boolean
  courseData?: CourseData
  lectures?: LectureGroup[]
  teachers?: CanvasTeacherSelection[]
  selectedTeachers?: string[]
  moduleVideos?: {
    iframes: Array<{ moduleName: string; pageTitle: string; iframeUrl: string }>
    extTools: Array<{ moduleItemId: number; fileId: string; title: string }>
    extUrls: Array<{ uuid: string; title: string }>
  }
  categorySelections?: { files: boolean; teacher: boolean; ppt: boolean; moduleVideo: boolean; pptPdf: boolean }
  selected: Set<string>
  onToggleExpand: () => void
  onSetCourseData: (d: CourseData) => void
  onSetLectures: (l: LectureGroup[]) => void
  onSetTeachers: (t: CanvasTeacherSelection[]) => void
  onSetSelectedTeachers: (t: string[]) => void
  onSetLtiToken: (d: { token: string; canvasCourseId: string }) => void
  onSetModuleVideos: (v: {
    iframes: Array<{ moduleName: string; pageTitle: string; iframeUrl: string }>
    extTools: Array<{ moduleItemId: number; fileId: string; title: string }>
    extUrls: Array<{ uuid: string; title: string }>
  }) => void
  onSetCategorySelection: (sel: Partial<{ files: boolean; teacher: boolean; ppt: boolean; moduleVideo: boolean; pptPdf: boolean }>) => void
  toggleSelect: (id: string) => void
  toggleSelectMany: (ids: string[], on: boolean) => void
  onToggleCourseSelect: () => void
}) {
  const [scanning, setScanning] = useState(false)
  const [scanPhase, setScanPhase] = useState('')
  const [scanningVideo, setScanningVideo] = useState(false)

  // 共享订阅课堂视频扫描进度
  // [Bug Fix] 之前只在 phase==='class-video' 时置 true，从不复位 → PPT 下载等自动触发
  // classVideoScan 的路径会让课堂视频区块转圈永远卡住（doClassVideoScan 的 finally 不在这些路径上执行）。
  // 现在收到该课程的 'class-video-done' phase（classVideoScan 主进程补发）时复位为 false。
  useCanvasScanProgress(course.courseId, (p) => {
    if (p.courseId !== course.courseId) return
    if (p.phase === 'class-video') setScanningVideo(true)
    else if (p.phase === 'class-video-done') setScanningVideo(false)
  })

  // ── 扫描数据首次到达后，按分类意图落地到 selected（仅一次） ──
  // 设计：意图(catSel)代表「想要全选该分类」。当某分类任务首次从 0→N 解析出来、
  // 且意图为 true 时，把这些任务加入 selected。用 ref 记录已落地过的分类签名，
  // 避免重复 add，也避免用户手动取消个别后被 effect 再补回。
  // 意图为 false 时不 add；意图从 false→true 的切换由点击 handler 直接落地。
  const landedRef = useRef<{ files: boolean; teacher: boolean; ppt: boolean; moduleVideo: boolean; pptPdf: boolean }>({
    files: false, teacher: false, ppt: false, moduleVideo: false, pptPdf: false
  })
  useEffect(() => {
    const catSel = categorySelections
    if (!catSel) return
    const idsToAdd: string[] = []
    // 课件：首次有文件且意图 true → 落地（含模块/大纲补漏）
    if (!landedRef.current.files && courseData && courseData.files.length + courseData.moduleFiles.length + courseData.syllabusFiles.length > 0) {
      landedRef.current.files = true
      if (catSel.files) {
        for (const f of courseData.files) idsToAdd.push(fileTaskId(course.courseId, f.fileId))
        for (const f of courseData.moduleFiles) idsToAdd.push(fileTaskId(course.courseId, f.fileId))
        for (const f of courseData.syllabusFiles) idsToAdd.push(fileTaskId(course.courseId, f.fileId))
      }
    }
    // 课堂视频：首次有讲次且意图 true → 落地 teacher/ppt
    if (!landedRef.current.teacher && lectures && lectures.length > 0) {
      landedRef.current.teacher = true
      landedRef.current.ppt = true
      for (const l of lectures) {
        if (!l.teacher) continue
        if (catSel.teacher) idsToAdd.push(lectureStreamTaskId(course.courseId, l.lectureNum, 'teacher'))
        if (catSel.ppt) idsToAdd.push(lectureStreamTaskId(course.courseId, l.lectureNum, 'ppt'))
      }
    }
    // 模块视频：首次有列表且意图 true → 落地（三类来源）
    if (!landedRef.current.moduleVideo && moduleVideos && (moduleVideos.iframes.length + moduleVideos.extTools.length + moduleVideos.extUrls.length) > 0) {
      landedRef.current.moduleVideo = true
      if (catSel.moduleVideo) {
        for (const t of moduleVideos.iframes) idsToAdd.push(iframeVideoTaskId(course.courseId, t.pageTitle))
        for (const t of moduleVideos.extTools) idsToAdd.push(extToolVideoTaskId(course.courseId, t.fileId))
        for (const t of moduleVideos.extUrls) idsToAdd.push(extUrlVideoTaskId(course.courseId, t.uuid))
      }
    }
    if (idsToAdd.length > 0) toggleSelectMany(idsToAdd, true)
  }, [courseData, lectures, moduleVideos, categorySelections, course.courseId, toggleSelectMany])

  // 展开时自动扫描文件
  const scannedRef = useRef(false)
  useEffect(() => {
    if (!expanded || scannedRef.current || courseData) return
    scannedRef.current = true
    void doScan()
  }, [expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  const doScan = async (): Promise<void> => {
    setScanning(true); setScanPhase('files')
    try {
      const r = await window.api.canvas.scanCourse(course.courseId)
      if (r.ok && r.files) {
        onSetCourseData(buildCourseData(r))
      }
    } catch { /* ignore */ }
    setScanning(false); setScanPhase('')
  }

  const doClassVideoScan = async (): Promise<void> => {
    setScanningVideo(true)
    try {
      const r = await window.api.canvas.classVideoScan(course.courseId)
      if (r.ok) {
        onSetLectures(r.lectures ?? [])
        onSetTeachers(r.teachers ?? [])
        if (r.token && r.canvasCourseId) onSetLtiToken({ token: r.token, canvasCourseId: r.canvasCourseId })
        const allTeachers = (r.teachers ?? []).filter(t => t.selected).map(t => t.teacher)
        if (allTeachers.length > 0) onSetSelectedTeachers(allTeachers)
      }
    } catch { /* ignore */ }
    setScanningVideo(false)
  }

  const [scanningModuleVideo, setScanningModuleVideo] = useState(false)
  const doModuleVideoScan = async (): Promise<void> => {
    setScanningModuleVideo(true)
    try {
      const r = await window.api.canvas.moduleVideoScan(course.courseId)
      if (r.ok) onSetModuleVideos({ iframes: r.tasks ?? [], extTools: r.extTools ?? [], extUrls: r.extUrls ?? [] })
    } catch { /* ignore */ }
    setScanningModuleVideo(false)
  }

  // 本课程的所有可选 ID
  const courseIds = useMemo(() => {
    const ids: string[] = []
    if (courseData) {
      for (const f of courseData.files) ids.push(fileTaskId(course.courseId, f.fileId))
      for (const f of courseData.moduleFiles) ids.push(fileTaskId(course.courseId, f.fileId))
      for (const f of courseData.syllabusFiles) ids.push(fileTaskId(course.courseId, f.fileId))
    }
    if (lectures) for (const l of lectures) {
      if (l.teacher) {
        ids.push(lectureStreamTaskId(course.courseId, l.lectureNum, 'teacher'))
        ids.push(lectureStreamTaskId(course.courseId, l.lectureNum, 'ppt'))
      }
    }
    if (moduleVideos) {
      for (const t of moduleVideos.iframes) ids.push(iframeVideoTaskId(course.courseId, t.pageTitle))
      for (const t of moduleVideos.extTools) ids.push(extToolVideoTaskId(course.courseId, t.fileId))
      for (const t of moduleVideos.extUrls) ids.push(extUrlVideoTaskId(course.courseId, t.uuid))
    }
    return ids
  }, [course.courseId, courseData, lectures, moduleVideos])
  const selCount = courseIds.reduce((n, id) => n + (selected.has(id) ? 1 : 0), 0)

  // [Bug Fix] 下载完成后 deleteCanvasCourseData 清掉扫描数据 → courseIds 变空 → 进度条消失。
  // 回退用 store 里该课程已提交的 taskIds（processCourse 写入，不被 delete 清），让进度条继续显示。
  // 注意 selector 必须返回稳定引用：?? [] 每次新建数组会让 zustand 判定 state 变化 → 无限重渲染 → 白屏。
  // 用模块级 EMPTY_TASK_IDS 常量兜底，命中时返回同一引用。
  const committedTaskIds = useAppStore(s => s.canvasCourseTaskIds[course.courseId] ?? EMPTY_TASK_IDS)
  const progressIds = courseIds.length > 0 ? courseIds : committedTaskIds

  const catSel = categorySelections

  // 课件分类 = 常规文件 + 模块补漏 + 大纲补漏
  const fileIds = useMemo(() => {
    if (!courseData) return []
    return [
      ...courseData.files.map(f => fileTaskId(course.courseId, f.fileId)),
      ...courseData.moduleFiles.map(f => fileTaskId(course.courseId, f.fileId)),
      ...courseData.syllabusFiles.map(f => fileTaskId(course.courseId, f.fileId))
    ]
  }, [course.courseId, courseData])

  const teacherIds = useMemo(() => {
    if (!lectures) return []
    return lectures.flatMap(l => l.teacher ? [lectureStreamTaskId(course.courseId, l.lectureNum, 'teacher')] : [])
  }, [course.courseId, lectures])
  const pptIds = useMemo(() => {
    if (!lectures) return []
    return lectures.flatMap(l => l.teacher ? [lectureStreamTaskId(course.courseId, l.lectureNum, 'ppt')] : [])
  }, [course.courseId, lectures])

  const moduleVideoIds = useMemo(() => {
    if (!moduleVideos) return []
    return [
      ...moduleVideos.iframes.map(t => iframeVideoTaskId(course.courseId, t.pageTitle)),
      ...moduleVideos.extTools.map(t => extToolVideoTaskId(course.courseId, t.fileId)),
      ...moduleVideos.extUrls.map(t => extUrlVideoTaskId(course.courseId, t.uuid))
    ]
  }, [course.courseId, moduleVideos])

  // ── 三态：纯派生自 selected 聚合 + 未解析意图，不再依赖 courseSelected ──
  const filesTriState: TriState = catStateOf(fileIds, selected, catSel?.files)
  const teacherTriState: TriState = catStateOf(teacherIds, selected, catSel?.teacher)
  const pptTriState: TriState = catStateOf(pptIds, selected, catSel?.ppt)
  const moduleVideoTriState: TriState = catStateOf(moduleVideoIds, selected, catSel?.moduleVideo)
  // PPT课件（pptPdf）并入课程级态：四分类全 all + pptPdf 选中 → all，否则按 combinePptPdf
  const courseTriState: TriState = combinePptPdf(aggCourseState(filesTriState, teacherTriState, pptTriState, moduleVideoTriState), catSel?.pptPdf)

  // ── 回调：点分类只动该分类，绝不联动整课 ──
  const onToggleFiles = useCallback(() => {
    const newOn = filesTriState !== 'all'
    onSetCategorySelection({ files: newOn })
    if (fileIds.length > 0) toggleSelectMany(fileIds, newOn)
  }, [fileIds, filesTriState, onSetCategorySelection, toggleSelectMany])

  const onToggleTeacher = useCallback(() => {
    const newOn = teacherTriState !== 'all'
    onSetCategorySelection({ teacher: newOn })
    if (teacherIds.length > 0) toggleSelectMany(teacherIds, newOn)
  }, [teacherIds, teacherTriState, onSetCategorySelection, toggleSelectMany])
  const onTogglePpt = useCallback(() => {
    const newOn = pptTriState !== 'all'
    onSetCategorySelection({ ppt: newOn })
    if (pptIds.length > 0) toggleSelectMany(pptIds, newOn)
  }, [pptIds, pptTriState, onSetCategorySelection, toggleSelectMany])
  const onToggleModuleVideo = useCallback(() => {
    const newOn = moduleVideoTriState !== 'all'
    onSetCategorySelection({ moduleVideo: newOn })
    if (moduleVideoIds.length > 0) toggleSelectMany(moduleVideoIds, newOn)
  }, [moduleVideoIds, moduleVideoTriState, onSetCategorySelection, toggleSelectMany])

  // PERF: subscribe to progress stats from store with encoding trick,
  // avoiding the entire progress map as a prop (which defeats memo every 2s tick).
  // useShallow 返回对象，inactive 课程（inflight=0 不变）不触发重渲，仅活跃课程卡每 tick 重渲。
  // both 模式按 local+cloud 合并态统计（与 useEffectiveProgress 一致），inflight 含本地完成·云端上传中。
  const progressStats = useAppStore(
    useShallow(s => {
      const isBoth = s.downloadMode === 'both'
      let done = 0, dl = 0, err = 0, inflight = 0
      for (const id of progressIds) {
        const prog = s.progress[id]
        const st = prog?.state
        if (isBoth) {
          const cloudId = s.cloudLinkedIds[id]
          const cloudSt = cloudId ? s.progress[cloudId]?.state : undefined
          const localDone = st === 'done' || st === 'skipped'
          const cloudDone = !cloudId || cloudSt === 'done' || cloudSt === 'skipped' || cloudSt === 'cancelled'
          const localFinal = localDone || st === 'error' || st === 'cancelled'
          const cloudFinal = !cloudId || cloudDone || cloudSt === 'error'
          if (st === 'error' || cloudSt === 'error') err++
          else if (localDone && cloudDone) done++
          else if (!(localFinal && cloudFinal)) {
            dl++
            if (st === 'downloading' && prog && prog.total > 0) inflight += Math.min(1, prog.received / prog.total)
            else if (localDone) inflight += 1   // 本地完成·云端上传中：本地部分满
          }
        } else {
          if (st === 'done' || st === 'skipped') done++
          else if (st === 'error') err++
          else if (st === 'downloading' || st === 'pending') {
            dl++
            if (st === 'downloading' && prog && prog.total > 0) inflight += Math.min(1, prog.received / prog.total)
          }
        }
      }
      return { done, dl, err, inflight }
    })
  )
  const { done: doneCount, dl: dlCount, err: errCount, inflight: inflightCount } = progressStats

  const totalFiles = courseData ? courseData.files.length + courseData.moduleFiles.length + courseData.syllabusFiles.length : 0

  return (
    <section className="overflow-hidden rounded-2xl border border-bd bg-surface-3 shadow-card transition-shadow hover:shadow-card-hover">
      <header className="flex cursor-pointer select-none items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2" onClick={onToggleExpand}>
        <Chevron open={expanded} />
        <span role="checkbox" aria-checked={courseTriState === 'some' ? 'mixed' : courseTriState === 'all'} tabIndex={0}
          onClick={e => { e.stopPropagation(); onToggleCourseSelect() }}
          onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onToggleCourseSelect() } }}
          className="shrink-0">
          <TriCheckbox state={courseTriState} size="lg" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-1 text-base font-semibold text-text-1">{course.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-3">
            {course.courseCode && <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs text-text-2">{course.courseCode}</span>}
            <span>{course.term || '(无学期)'}</span>
            <span className="rounded bg-info-bg px-1.5 py-0.5 text-info">{course.enrollmentState}</span>
          </div>
        </div>
        {scanning && (
          <span className="inline-flex items-center gap-2 text-xs text-text-3">
            <Spinner size={12} /> {scanPhase === 'files' ? '扫描文件…' : scanPhase === 'modules' ? '扫描模块…' : scanPhase === 'syllabus' ? '扫描大纲…' : '扫描中…'}
          </span>
        )}
        {/* 分类复选框：课件 | 视频-教师 | 视频-PPT | PPT课件PDF | 单元视频 */}
        <div className="flex shrink-0 items-center gap-2" onClick={e => e.stopPropagation()}>
          <CategoryCheckBtn label="课件" state={filesTriState} color="violet" onClick={onToggleFiles} />
          <CategoryCheckBtn label="视频-教师" state={teacherTriState} color="blue" onClick={onToggleTeacher} />
          <CategoryCheckBtn label="视频-PPT" state={pptTriState} color="green" onClick={onTogglePpt} />
          <CategoryCheckBtn label="PPT课件PDF" state={catSel?.pptPdf ? 'all' : 'none'} color="green" onClick={() => onSetCategorySelection({ pptPdf: !catSel?.pptPdf })} />
          <CategoryCheckBtn label="单元视频" state={moduleVideoTriState} color="violet" onClick={onToggleModuleVideo} />
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-text-3">
          {/* 扫描数据在时显示讲次/已选；被清（下载完成释放内存）但有已提交任务时回退显示完成统计 */}
          <span>{courseIds.length > 0
            ? <>{lectures?.length ?? 0} 讲 · 已选 <span className="font-medium text-text-1">{selCount}</span> / {courseIds.length}</>
            : courseData ? `${totalFiles} 个文件`
            : committedTaskIds.length > 0 ? <>已完成 <span className="font-medium text-success">{doneCount}</span> / {committedTaskIds.length}</> : ''}</span>
        </div>
      </header>

      {/* 进度条 */}
      <CourseProgressSummary done={doneCount} downloading={dlCount} errors={errCount} inflight={inflightCount} total={progressIds.length} />

      {expanded && (
        <div className="animate-fadeIn origin-top border-t border-bd">
          {scanning && !courseData && (
            <div className="flex items-center justify-center gap-3 px-5 py-8"><Spinner size={20} /><span className="text-sm text-text-3">正在扫描课程内容…</span></div>
          )}

          {/* 课件文件 */}
          {courseData && totalFiles > 0 && (
            <div className="px-5 py-4">
              <div className="mb-2 text-sm font-medium text-text-1">
                课件文件 ({courseData.files.length}
                {courseData.moduleFiles.length > 0 && <span className="text-text-3"> + {courseData.moduleFiles.length} 模块</span>}
                {courseData.syllabusFiles.length > 0 && <span className="text-text-3"> + {courseData.syllabusFiles.length} 大纲</span>})
              </div>
              <ul className="divide-y divide-bd">
                {courseData.files.map(f => (
                  <FileRow key={f.fileId} courseId={course.courseId} file={f} folderMap={courseData.folderMap} selected={selected} onToggle={toggleSelect} />
                ))}
                {courseData.moduleFiles.length > 0 && (
                  <li className="bg-surface-2/40 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-text-4">模块文件</li>
                )}
                {courseData.moduleFiles.map(f => (
                  <FileRow key={`m_${f.fileId}`} courseId={course.courseId} file={f} folderMap={courseData.folderMap} selected={selected} onToggle={toggleSelect} />
                ))}
                {courseData.syllabusFiles.length > 0 && (
                  <li className="bg-surface-2/40 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-text-4">大纲嵌入</li>
                )}
                {courseData.syllabusFiles.map(f => (
                  <FileRow key={`s_${f.fileId}`} courseId={course.courseId} file={f} folderMap={courseData.folderMap} selected={selected} onToggle={toggleSelect} />
                ))}
                {totalFiles > 20 && (
                  <li className="py-1.5 text-center text-xs text-accent">共 {totalFiles} 个文件</li>
                )}
              </ul>
            </div>
          )}

          {/* 课堂视频 */}
          <div className="border-t border-bd px-5 py-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium text-text-1">
                课堂视频{lectures && <span className="ml-2 text-text-3">({lectures.length} 讲)</span>}
              </div>
              <div className="flex items-center gap-2">
                {!lectures && !scanningVideo && (
                  <button type="button" onClick={() => void doClassVideoScan()} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-bd-strong bg-surface-3 px-3 text-xs text-text-2 transition-all hover:border-info-ring hover:text-info">扫描课堂视频</button>
                )}
                {scanningVideo && <Spinner size={12} />}
              </div>
            </div>
            {lectures && lectures.length > 0 && (
              <ul className="divide-y divide-bd">
                {lectures.map(l => (
                  <LectureRow key={l.lectureNum} courseId={course.courseId} lecture={l} selected={selected} onToggle={toggleSelect} />
                ))}
              </ul>
            )}
            {lectures && lectures.length === 0 && !scanningVideo && (
              <div className="py-3 text-center text-xs text-text-4">该课程未发现课堂视频</div>
            )}
          </div>

          {/* PPT 课件（PDF）—— 选了 pptPdf 分类时显示，进度条由 canvas:ppt-progress 驱动 */}
          {catSel?.pptPdf && (
            <div className="border-t border-bd px-5 py-4">
              <div className="mb-2 text-sm font-medium text-text-1">
                PPT课件（PDF）
                {lectures && <span className="ml-2 text-text-3">({lectures.filter(l => l.teacher).length} 讲)</span>}
              </div>
              <PptPdfProgressRow courseId={course.courseId} />
            </div>
          )}

          {/* 单元视频（来自浏览器「单元」tab，三类来源：Page iframe HLS / ExternalTool 直接MP4 / ExternalUrl 直接MP4） */}
          <div className="border-t border-bd px-5 py-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium text-text-1">
                单元视频{moduleVideos && <span className="ml-2 text-text-3">({moduleVideos.iframes.length + moduleVideos.extTools.length + moduleVideos.extUrls.length} 个)</span>}
              </div>
              {!moduleVideos && !scanningModuleVideo && (
                <button type="button" onClick={() => void doModuleVideoScan()} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-bd-strong bg-surface-3 px-3 text-xs text-text-2 transition-all hover:border-info-ring hover:text-info">扫描单元视频</button>
              )}
              {scanningModuleVideo && <Spinner size={12} />}
            </div>
            {moduleVideos && (moduleVideos.iframes.length + moduleVideos.extTools.length + moduleVideos.extUrls.length) > 0 && (
              <ul className="divide-y divide-bd">
                {moduleVideos.iframes.length > 0 && (
                  <li className="bg-surface-2/40 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-text-4">网页嵌入视频（HLS）</li>
                )}
                {moduleVideos.iframes.map(t => (
                  <ModuleVideoRow key={`if_${t.iframeUrl}`} title={t.pageTitle} subTitle={t.moduleName} taskId={iframeVideoTaskId(course.courseId, t.pageTitle)} selected={selected} onToggle={toggleSelect} />
                ))}
                {moduleVideos.extTools.length > 0 && (
                  <li className="bg-surface-2/40 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-text-4">v.sjtu 嵌入视频</li>
                )}
                {moduleVideos.extTools.map(t => (
                  <ModuleVideoRow key={`et_${t.fileId}`} title={t.title} taskId={extToolVideoTaskId(course.courseId, t.fileId)} selected={selected} onToggle={toggleSelect} />
                ))}
                {moduleVideos.extUrls.length > 0 && (
                  <li className="bg-surface-2/40 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-text-4">vshare 嵌入视频</li>
                )}
                {moduleVideos.extUrls.map(t => (
                  <ModuleVideoRow key={`eu_${t.uuid}`} title={t.title} taskId={extUrlVideoTaskId(course.courseId, t.uuid)} selected={selected} onToggle={toggleSelect} />
                ))}
              </ul>
            )}
            {moduleVideos && (moduleVideos.iframes.length + moduleVideos.extTools.length + moduleVideos.extUrls.length) === 0 && !scanningModuleVideo && (
              <div className="py-3 text-center text-xs text-text-4">该课程未发现单元视频</div>
            )}
          </div>
        </div>
      )}
    </section>
  )
})

// ─── 文件行（使用 useEffectiveProgress 支持 both 模式） ────────

const FileRow = memo(function FileRow({ courseId, file, folderMap, selected, onToggle }: {
  courseId: number; file: CanvasFileItem; folderMap: Record<number, string>; selected: Set<string>; onToggle: (id: string) => void
}) {
  const tid = fileTaskId(courseId, file.fileId)
  const isOn = selected.has(tid)
  const p = useEffectiveProgress(tid)
  const relDir = folderMap[file.folderId ?? -1] || ''
  return (
    <li className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-2">
      <button type="button" onClick={() => onToggle(tid)} className="shrink-0">
        <SmallCheck on={isOn} />
      </button>
      <svg className="h-3.5 w-3.5 shrink-0 text-text-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>
      <span className="min-w-0 flex-1 truncate text-xs text-text-2">
        {relDir && <span className="text-text-4">{relDir}/</span>}
        {file.displayName}
      </span>
      <span className="shrink-0 text-xs text-text-4">{formatBytes(file.size)}</span>
      <div className="min-w-[5rem] flex-1 shrink-0">
        {p ? <ProgressBar p={p} /> : <div className="h-2 rounded-full bg-surface-3" />}
      </div>
    </li>
  )
})

// ─── 讲次行（教师 + PPT 两路） ──────────────────────────────

const ModuleVideoRow = memo(function ModuleVideoRow({ title, subTitle, taskId, selected, onToggle }: {
  title: string; subTitle?: string; taskId: string; selected: Set<string>; onToggle: (id: string) => void
}) {
  const isOn = selected.has(taskId)
  const p = useEffectiveProgress(taskId)
  // iframe HLS（canvas_mvid_）不可中断/暂停，不显示控制按钮；exttool/exturl 走主队列可控
  const controllable = !taskId.startsWith('canvas_mvid_')
  return (
    <li className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-2">
      <button type="button" onClick={() => onToggle(taskId)} className="shrink-0">
        <SmallCheck on={isOn} />
      </button>
      <svg className="h-3.5 w-3.5 shrink-0 text-text-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
      <span className="min-w-0 flex-1 truncate text-xs text-text-2">
        {subTitle && <span className="text-text-4">{subTitle}/</span>}
        {title}
      </span>
      <div className="min-w-[5rem] flex-1 shrink-0">
        {p ? <ProgressBar p={p} /> : <div className="h-2 rounded-full bg-surface-3" />}
      </div>
      {controllable && p && (
        <TaskCtrlButtons
          state={p.state}
          onPause={() => window.api.download.pause(taskId).catch(() => undefined)}
          onCancel={() => window.api.download.cancel(taskId).catch(() => undefined)}
          onResume={() => window.api.download.resume(taskId).catch(() => undefined)}
        />
      )}
    </li>
  )
})

const LectureRow = memo(function LectureRow({ courseId, lecture, selected, onToggle }: {
  courseId: number; lecture: LectureGroup; selected: Set<string>; onToggle: (id: string) => void
}) {
  const { lectureNum, date, teacher } = lecture
  if (!teacher) return null
  return (
    <li className="flex items-center gap-4 px-3 py-3 transition-colors hover:bg-surface-2">
      <div className="flex w-24 shrink-0 items-baseline gap-2">
        <span className="text-sm font-medium text-text-1">第{lectureNum}讲</span>
        <span className="font-mono text-xs text-text-4">{date.slice(5)}</span>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <VideoStreamCell label="教师" taskId={lectureStreamTaskId(courseId, lectureNum, 'teacher')} session={teacher} selected={selected} onToggle={onToggle} color="blue" />
        <div className="h-6 w-px shrink-0 bg-surface-2" />
        <VideoStreamCell label="PPT" taskId={lectureStreamTaskId(courseId, lectureNum, 'ppt')} session={teacher} selected={selected} onToggle={onToggle} color="green" />
      </div>
    </li>
  )
})

// PERF: memoize VideoStreamCell — each cell subscribes to its own progress via useEffectiveProgress;
// memo prevents sibling cell re-renders when only one task's progress changes
const VideoStreamCell = memo(function VideoStreamCell({ label, taskId, session, selected, onToggle, color }: {
  label: string; taskId: string; session?: CanvasVideoSession; selected: Set<string>; onToggle: (id: string) => void; color: 'blue' | 'green'
}) {
  const p = useEffectiveProgress(taskId)
  if (!session) {
    return <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-text-4">无{label}</div>
  }
  const isOn = selected.has(taskId)
  const colorClasses = color === 'blue'
    ? (isOn ? 'bg-info-bg text-info ring-info-ring' : 'bg-info-bg/50 text-info/70 ring-info-ring/50 hover:bg-info-bg')
    : (isOn ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20' : 'bg-emerald-500/5 text-emerald-400/70 ring-emerald-500/10 hover:bg-emerald-500/10')
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <button type="button" onClick={() => onToggle(taskId)} className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition-all hover:scale-[1.03] ${colorClasses}`}>
        <SmallCheck on={isOn} />{label}
      </button>
      <div className="min-w-[5rem] flex-1 shrink-0">{p ? <ProgressBar p={p} /> : <div className="h-2 rounded-full bg-surface-3" />}</div>
      {p && (
        <TaskCtrlButtons
          state={p.state}
          onPause={() => window.api.download.pause(taskId).catch(() => undefined)}
          onCancel={() => window.api.download.cancel(taskId).catch(() => undefined)}
          onResume={() => window.api.download.resume(taskId).catch(() => undefined)}
        />
      )}
    </div>
  )
})

// ─── PPT 课件聚合进度行（讲次级 X/Y，不走 ProgressBar 的字节显示） ────

/** PPT 课件 PDF 的课程级聚合进度：current/total 为讲次级（X/Y 讲），
 *  单讲内的图片下载进度折进 message。进度由 canvas:ppt-progress → applyProgress 写入。 */
const PptPdfProgressRow = memo(function PptPdfProgressRow({ courseId }: { courseId: number }) {
  const tid = `canvas_ppt_pdf_${courseId}`
  const p = useEffectiveProgress(tid)
  if (!p) {
    return <div className="py-1.5 text-xs text-text-4">已选择，点击「开始下载」生成 PPT 课件 PDF</div>
  }
  const isDone = p.state === 'done' || p.state === 'skipped'
  const isErr = p.state === 'error'
  const isDl = p.state === 'downloading' || p.state === 'pending'
  const pct = p.total > 0 ? Math.round((p.received / p.total) * 100) : (isDone ? 100 : 0)
  const barWidth = isDl ? Math.max(pct, 3) : pct
  const fill = isErr ? 'bg-warning'
    : isDone ? 'bg-success'
    : 'bg-gradient-to-r from-accent to-accent-light'
  const text = isErr ? (p.message || '失败')
    : isDone ? (p.message || '完成')
    : isDl ? (p.total > 0 ? `${p.received}/${p.total} 讲` : '下载中…') + (p.message ? ` · ${p.message}` : '')
    : '等待中'
  const textColor = isErr ? 'text-warning' : isDone ? 'text-success' : 'text-text-2'
  return (
    <div className="space-y-1.5">
      <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full transition-[width] duration-300 ${fill}`} style={{ width: `${barWidth}%` }} />
      </div>
      <div className={`truncate text-xs tabular-nums ${textColor}`} title={text}>{text}</div>
    </div>
  )
})

// ─── 顶层分类按钮 ────────────────────────────────────────────

function TopCategoryBtn({ label, icon, state, color, onClick }: {
  label: string; icon: 'file' | 'user' | 'screen'; state: TriState; color: 'violet' | 'blue' | 'green'; onClick: () => void
}) {
  const colors = {
    violet: state === 'none' ? 'ring-violet-500/30 hover:ring-violet-500/60 text-violet-400/70 hover:text-violet-300' : 'ring-violet-500 text-violet-300 bg-violet-500/10',
    blue: state === 'none' ? 'ring-info-ring hover:ring-info text-info/70 hover:text-info' : 'ring-info text-info bg-info-bg',
    green: state === 'none' ? 'ring-emerald-500/30 hover:ring-emerald-500/60 text-emerald-400/70 hover:text-emerald-400' : 'ring-emerald-500 text-emerald-400 bg-emerald-500/10'
  }
  const iconSvg = icon === 'file'
    ? <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>
    : icon === 'user'
      ? <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
      : <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition-all hover:scale-[1.03] ${colors[color]}`}>
      <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-current/40">
        {state === 'all' && <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3"><path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        {state === 'some' && <span className="h-[2px] w-2 rounded-full bg-current" />}
      </span>
      {iconSvg}
      <span>{label}</span>
    </button>
  )
}

// ─── 课程级分类复选按钮 ──────────────────────────────────────

function CategoryCheckBtn({ label, state, color, onClick }: {
  label: string; state: TriState; color: 'violet' | 'blue' | 'green'; onClick: () => void
}) {
  const colors = {
    violet: state !== 'none' ? 'bg-violet-500/10 text-violet-300 ring-violet-500/40' : 'bg-surface-2 text-text-4 ring-bd hover:text-violet-300 hover:ring-violet-500/30',
    blue: state !== 'none' ? 'bg-info-bg text-info ring-info-ring' : 'bg-surface-2 text-text-4 ring-bd hover:text-info hover:ring-info-ring/50',
    green: state !== 'none' ? 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20' : 'bg-surface-2 text-text-4 ring-bd hover:text-emerald-400 hover:ring-emerald-500/30'
  }
  return (
    <button type="button" onClick={onClick} title={`${label} ${state === 'all' ? '已全选' : state === 'some' ? '部分选中' : '未选中'}`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium ring-1 transition-all hover:scale-[1.03] ${colors[color]}`}>
      <TriCheckbox state={state} size="sm" />
      {label}
    </button>
  )
}

// ─── 学期选择标签 ────────────────────────────────────────────

function TermPill({ label, active, count, onClick }: {
  label: string; active: boolean; count: number; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium ring-1 transition-all ${
        active
          ? 'bg-accent/10 text-accent ring-accent/30'
          : 'bg-surface-2 text-text-3 ring-bd hover:text-text-1 hover:ring-bd-strong'
      }`}
    >
      <span>{label}</span>
      <span className={`font-mono text-xs ${active ? 'text-accent/70' : 'text-text-4'}`}>{count}</span>
    </button>
  )
}
