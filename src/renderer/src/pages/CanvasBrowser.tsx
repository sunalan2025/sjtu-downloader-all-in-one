import { useCallback, useEffect, useMemo, useRef, useState, memo, type ReactNode } from 'react'
import { useAppStore, useEffectiveProgress } from '../store/app'
import { useShallow } from 'zustand/shallow'
import { Spinner } from '../components/Spinner'
import { prefetchCanvasCourses } from '../services/prefetch'
import {
  TriCheckbox,
  ProgressBar,
  DropdownSelect,
  NetdiskViewModeSwitch,
  GlobalCtrlButton,
  TaskCtrlButtons,
  formatBytes,
  type TriState
} from '../components/DownloadUI'
import {
  NetdiskCourseExplorer,
  type NetdiskNavState,
  type NetdiskCourseItem,
  type NetdiskCategoryItem,
  type NetdiskFileItem
} from '../components/NetdiskCourseExplorer'
import type {
  CanvasAssignmentItem,
  CanvasCourse,
  CanvasDownloadTaskSpec,
  CanvasFileItem,
  CanvasLectureDownloadItem,
  CanvasLectureGroup
} from '@shared/types'
import { sanitizeFsName } from '@shared/utils'
import { applyVideoPerspectivePreference } from '../download/perspective'
import {
  canvasFileTaskId as fileTaskId,
  canvasAssignmentTaskId as assignmentTaskId,
  canvasLectureTaskId as lectureStreamTaskId,
  canvasPptItemTaskId as pptPdfTaskId,
  canvasPptPdfBatchTaskId,
  canvasAssignBatchTaskId,
  canvasTranscriptBatchTaskId,
  canvasMvidTaskId,
  canvasExtToolTaskId as extToolVideoTaskId,
  canvasExtUrlTaskId as extUrlVideoTaskId,
  collectCourseIds
} from '../download/taskIds'
import { computeBatchStats } from '../download/progress'
import { submitDownloadBatch } from '../download/submit'

export interface CourseData {
  files: CanvasFileItem[]
  folderMap: Record<number, string>
  moduleFiles: CanvasFileItem[]
  syllabusFiles: CanvasFileItem[]
  assignments?: CanvasAssignmentItem[]
}

// ─── Task ID 生成 ──────────────────────────────────────────────
// [Phase 1] 全部收口到 download/taskIds.ts 工厂（别名导入），此处不再各自拼接。
// pptPdfTaskId 保持 re-export 兼容（DownloadUI.test 动态 import 此符号）。
export { pptPdfTaskId }

/**
 * 构建课程各讲次的 PPT 课件 (PDF) 文件列表项。
 * 注：每个单讲项的 onToggle 联动整门课的 catSel?.pptPdf 意图，
 * 因为主进程 PPT 下载引擎是以全课切片合并为 PDF 的聚合批量任务。
 */
export function buildPptPdfItems(
  courseName: string,
  courseId: number,
  lectures: CanvasLectureGroup[] | undefined,
  isSelected: boolean,
  onToggle: () => void,
  renderExtra?: ReactNode
): NetdiskFileItem[] {
  if (!lectures) return []
  return lectures
    .filter(l => !!l.teacher)
    .map(l => ({
      id: pptPdfTaskId(courseId, l.lectureNum),
      name: `${courseName} - 第${l.lectureNum}讲 PPT课件 (PDF)`,
      date: l.date,
      type: 'PDF',
      selected: isSelected,
      onToggle,
      renderExtra
    }))
}

// 模块视频 baseName / iframe taskId。sanitize 保证 taskId 稳定、落盘文件名合法。
// 三类来源的 taskId 前缀对齐 main 端 orchestrator 的产 spec 方案（工厂见 download/taskIds.ts）：
//   iframe(HLS) → canvas_mvid_ / extTool(直接MP4) → canvas_exttool_ / extUrl → canvas_exturl_

function iframeVideoTaskId(courseId: number, pageTitle: string): string {
  return canvasMvidTaskId(courseId, pageTitle, sanitizeFsName)
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
  assignments?: CanvasAssignmentItem[]
}): CourseData {
  const folderMap: Record<number, string> = { ...(r.folderMap ?? {}) }
  if ((r.syllabusFiles?.length ?? 0) > 0) folderMap[SYLLABUS_FOLDER_ID] = '大纲'
  return {
    files: r.files ?? [],
    folderMap,
    moduleFiles: r.moduleFiles ?? [],
    syllabusFiles: r.syllabusFiles ?? [],
    assignments: r.assignments ?? []
  }
}

// ─── 三态纯函数（不依赖任何独立布尔，消除 selectedCourseIds 冲突） ───
//
// 模型：selected 是真值（已解析任务实际勾选）；categorySelections 是
// 未解析分类的勾选意图占位。三态显示完全由这两者派生。
//
// 分类态：有已解析任务 → 看 selected 聚合；无 → 看意图。
// 课程态：五分类态聚合（全 all→all，全 none→none，否则 some）。

/** 单个分类的选中态 */
function catStateOf(ids: string[], selected: Set<string>, intent?: boolean): TriState {
  if (ids.length === 0) return intent ? 'all' : 'none' // 未解析 → 意图决定
  const sel = ids.reduce((n, id) => n + (selected.has(id) ? 1 : 0), 0)
  return sel === ids.length ? 'all' : sel > 0 ? 'some' : 'none'
}

/** 课程级态 = 五个分类态的聚合 (files, teacher, ppt, moduleVideo, assignments) */
function aggCourseState(f: TriState, t: TriState, p: TriState, m: TriState, a: TriState): TriState {
  if (f === 'all' && t === 'all' && p === 'all' && m === 'all' && a === 'all') return 'all'
  if (f === 'none' && t === 'none' && p === 'none' && m === 'none' && a === 'none') return 'none'
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

const FileRowProgress = memo(function FileRowProgress({ tid }: { tid: string }) {
  const p = useEffectiveProgress(tid)
  if (!p || (p.state !== 'downloading' && p.state !== 'pending' && p.state !== 'error' && p.state !== 'paused')) {
    return null
  }
  return <ProgressBar p={p} />
})

const VideoRowProgress = memo(function VideoRowProgress({ tid, controllable }: { tid: string; controllable: boolean }) {
  const p = useEffectiveProgress(tid)
  if (!p || (p.state !== 'downloading' && p.state !== 'pending' && p.state !== 'error' && p.state !== 'paused')) {
    return null
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-[80px]">
        <ProgressBar p={p} />
      </div>
      {controllable && (
        <TaskCtrlButtons
          state={p.state}
          onPause={() => window.api.download.pause(tid).catch(() => undefined)}
          onCancel={() => window.api.download.cancel(tid).catch(() => undefined)}
          onResume={() => window.api.download.resume(tid).catch(() => undefined)}
        />
      )}
    </div>
  )
})

/** PPT 课件 PDF 的课程级聚合进度：current/total 为讲次级（X/Y 讲），
 *  单讲内的图片下载进度折进 message。进度由 canvas:ppt-progress → applyProgress 写入。 */
const PptPdfProgressRow = memo(function PptPdfProgressRow({ courseId }: { courseId: number }) {
  const tid = canvasPptPdfBatchTaskId(courseId)
  const p = useEffectiveProgress(tid)
  const isSelected = useAppStore(s => !!s.canvasCourseCategorySelections[courseId]?.pptPdf)
  if (!p) {
    return (
      <div className="py-1.5 text-xs text-text-4">
        {isSelected ? '已选择，点击「开始下载」生成 PPT 课件 PDF' : '未勾选：勾选后可在下载时自动提取板书与幻灯片并导出为 PDF 讲义'}
      </div>
    )
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

/** 作业全量归档的课程级聚合进度：current/total 为作业数（X/Y 项） */
const AssignmentProgressRow = memo(function AssignmentProgressRow({
  courseId,
  hasCd,
  isLoading,
  onScan
}: {
  courseId: number
  hasCd: boolean
  isLoading: boolean
  onScan: () => void
}) {
  const tid = canvasAssignBatchTaskId(courseId)
  const p = useEffectiveProgress(tid)
  const isSelected = useAppStore(s => !!s.canvasCourseCategorySelections[courseId]?.assignments)

  if (!hasCd && !isLoading) {
    return (
      <div className="py-2 text-center">
        <button
          type="button"
          onClick={onScan}
          className="text-xs text-accent hover:underline cursor-pointer"
        >
          点击扫描作业与课件
        </button>
      </div>
    )
  }

  if (!p) {
    return (
      <div className="py-1.5 text-xs text-text-4">
        {isSelected ? '已选择，点击「开始下载」归档作业题干、附件与提交记录' : '勾选后归档作业要求、老师附件、本人提交原件与评语'}
      </div>
    )
  }

  const isDone = p.state === 'done' || p.state === 'skipped'
  const isErr = p.state === 'error'
  const isDl = p.state === 'downloading' || p.state === 'pending'
  const pct = p.total > 0 ? Math.round((p.received / p.total) * 100) : (isDone ? 100 : 0)
  const barWidth = isDl ? Math.max(pct, 3) : pct
  const fill = isErr ? 'bg-warning'
    : isDone ? 'bg-success'
    : 'bg-gradient-to-r from-accent to-accent-light'
  const text = isErr ? (p.message || '作业归档失败')
    : isDone ? (p.message || '作业归档完成')
    : isDl ? (p.total > 0 ? `${p.received}/${p.total} 项` : '归档中…') + (p.message ? ` · ${p.message}` : '')
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

/** 课堂视频/音频分类的快捷扫描入口与 AI 逐字稿导出进度 */
const VideoCategoryExtra = memo(function VideoCategoryExtra({
  courseId,
  hasLectures,
  isLoading,
  isAudioOnly,
  onScan,
  onSelectPerspective
}: {
  courseId: number
  hasLectures: boolean
  isLoading: boolean
  isAudioOnly: boolean
  onScan: () => void
  onSelectPerspective?: (p: 'all' | 'teacher' | 'ppt' | 'none' | 'audio') => void
}) {
  const tid = canvasTranscriptBatchTaskId(courseId)
  const p = useEffectiveProgress(tid)

  if (!hasLectures && !isLoading) {
    return (
      <div className="py-1 text-center">
        <button
          type="button"
          onClick={onScan}
          className="text-xs text-accent hover:underline cursor-pointer"
        >
          {isAudioOnly ? '点击扫描课堂音频' : '点击扫描课堂视频'}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {hasLectures && onSelectPerspective && !isAudioOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2/60 px-2.5 py-1.5 border border-bd/40 text-xs select-none">
          <span className="text-2xs font-semibold text-text-3">🎬 视角筛选</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onSelectPerspective('all')}
              className="rounded-md border border-bd/60 bg-surface-1 px-2 py-0.5 text-2xs text-text-2 hover:border-accent hover:text-accent transition-colors cursor-pointer"
              title="同时勾选教师视角与 PPT 投屏"
            >
              全选
            </button>
            <button
              type="button"
              onClick={() => onSelectPerspective('teacher')}
              className="rounded-md border border-bd/60 bg-surface-1 px-2 py-0.5 text-2xs text-text-2 hover:border-accent hover:text-accent transition-colors cursor-pointer"
              title="仅勾选教师机位画面与音频"
            >
              仅教师
            </button>
            <button
              type="button"
              onClick={() => onSelectPerspective('ppt')}
              className="rounded-md border border-bd/60 bg-surface-1 px-2 py-0.5 text-2xs text-text-2 hover:border-accent hover:text-accent transition-colors cursor-pointer"
              title="仅勾选 PPT 幻灯片屏幕投屏"
            >
              仅 PPT
            </button>
            {/* [Bug Fix] audio 档接入：同步全局画质偏好为纯音频（M4A），PPT 路无独立音频流自动只选教师路 */}
            <button
              type="button"
              onClick={() => onSelectPerspective('audio')}
              className="rounded-md border border-bd/60 bg-surface-1 px-2 py-0.5 text-2xs text-text-2 hover:border-accent hover:text-accent transition-colors cursor-pointer"
              title="切换为仅提取原声音频 (M4A)：自动只选教师视角，PPT 投屏无独立音频流将被禁用"
            >
              仅音频
            </button>
            <button
              type="button"
              onClick={() => onSelectPerspective('none')}
              className="rounded-md border border-bd/60 bg-surface-1 px-2 py-0.5 text-2xs text-warning/80 hover:border-warning hover:text-warning transition-colors cursor-pointer"
              title="取消该课程全部视频勾选"
            >
              清空
            </button>
          </div>
        </div>
      )}
      {p && (
        <div className="space-y-1">
          <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${
                p.state === 'error' ? 'bg-warning' : p.state === 'done' ? 'bg-success' : 'bg-gradient-to-r from-accent to-accent-light'
              }`}
              style={{ width: `${p.total > 0 ? Math.round((p.received / p.total) * 100) : (p.state === 'done' ? 100 : 0)}%` }}
            />
          </div>
          <div className={`truncate text-2xs tabular-nums ${p.state === 'error' ? 'text-warning' : p.state === 'done' ? 'text-success' : 'text-text-3'}`}>
            {p.message || (p.state === 'done' ? 'AI 字幕导出完成' : '导出中…')}
          </div>
        </div>
      )}
    </div>
  )
})

// ─── 主组件 ──────────────────────────────────────────────────

export function CanvasBrowser() {
  // PERF [split]: 3 separate subscriptions to minimize re-render scope
  // Group 1: rarely-changing state (courses, scan results, config)
  const {
    downloadMode, canvasCourses, canvasScanState, canvasScanMessage,
    canvasCourseData,
    canvasLectures, canvasModuleVideos, canvasCourseCategorySelections,
    courseViewMode, canvasGroupByTerm, cloudLinkedIds, videoQualityOption
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
    canvasExportAiTranscript: s.canvasExportAiTranscript
  })))
  const setCourseViewMode = useAppStore(s => s.setCourseViewMode)
  const setCanvasGroupByTerm = useAppStore(s => s.setCanvasGroupByTerm)
  // Group 2: frequently-changing (downloading flag — derived from progress)
  const downloading = useAppStore(s => s.downloading)
  // Group 3: stable action references (setters are stable, but grouped for clarity)
  const {
    setCanvasCourseData, setCanvasTeachers,
    setCanvasSelectedTeachers, setCanvasLtiToken, setCanvasLectures, setCanvasModuleVideos,
    setCanvasCourseCategorySelection, setAllCanvasCourseCategorySelections,
    resetCanvasScanResults,
    setDownloading, resetProgress, applyProgress,
    setCloudLinkedIds
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
    setDownloading: s.setDownloading,
    resetProgress: s.resetProgress,
    applyProgress: s.applyProgress,
    setCloudLinkedIds: s.setCloudLinkedIds
  })))

  const selectedTerm = useAppStore(s => s.canvasSelectedTerm)
  const setSelectedTerm = useAppStore(s => s.setCanvasSelectedTerm)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [navState, setNavState] = useState<NetdiskNavState>({ level: 'root' })
  const [scanningCourseIds, setScanningCourseIds] = useState<Record<number, boolean>>({})
  const [scanningVideoCourseIds, setScanningVideoCourseIds] = useState<Record<number, boolean>>({})
  const [batchMenuOpen, setBatchMenuOpen] = useState(false)
  const batchMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!batchMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (batchMenuRef.current && !batchMenuRef.current.contains(e.target as Node)) {
        setBatchMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBatchMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [batchMenuOpen])

  const scanStartedRef = useRef(false)
  const scanningVideoInFlightRef = useRef<Set<number>>(new Set())
  const scannedVideoCourseIdsRef = useRef<Set<number>>(new Set())
  const scanningFilesInFlightRef = useRef<Set<number>>(new Set())
  const scannedFilesCourseIdsRef = useRef<Set<number>>(new Set())

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

  const doClassVideoScan = useCallback(async (courseId: number): Promise<void> => {
    if (canvasLectures[courseId]) return
    if (scanningVideoInFlightRef.current.has(courseId) || scannedVideoCourseIdsRef.current.has(courseId)) return
    scanningVideoInFlightRef.current.add(courseId)
    setScanningVideoCourseIds(prev => ({ ...prev, [courseId]: true }))
    try {
      const r = await window.api.canvas.classVideoScan(courseId)
      if (r.ok) {
        setCanvasLectures(courseId, r.lectures ?? [])
        setCanvasTeachers(courseId, r.teachers ?? [])
        if (r.token && r.canvasCourseId) setCanvasLtiToken(courseId, { token: r.token, canvasCourseId: r.canvasCourseId })
        const allTeachers = (r.teachers ?? []).filter(t => t.selected).map(t => t.teacher)
        if (allTeachers.length > 0) setCanvasSelectedTeachers(courseId, allTeachers)
      } else {
        setCanvasLectures(courseId, [])
      }
      const mv = await window.api.canvas.moduleVideoScan(courseId)
      if (mv.ok) {
        setCanvasModuleVideos(courseId, { iframes: mv.tasks ?? [], extTools: mv.extTools ?? [], extUrls: mv.extUrls ?? [] })
      }
    } catch {
      setCanvasLectures(courseId, [])
    } finally {
      scanningVideoInFlightRef.current.delete(courseId)
      scannedVideoCourseIdsRef.current.add(courseId)
      setScanningVideoCourseIds(prev => ({ ...prev, [courseId]: false }))
    }
  }, [canvasLectures, setCanvasLectures, setCanvasTeachers, setCanvasLtiToken, setCanvasSelectedTeachers, setCanvasModuleVideos])

  // ── 学期列表 ──
  const terms = useMemo(() => {
    const set = new Set(canvasCourses.map(c => c.term || '(无学期)'))
    return [...set].sort().reverse()
  }, [canvasCourses])

  const termOptions = useMemo(() => {
    return [
      { value: 'all', label: '全部学期', count: canvasCourses.length },
      ...terms.map(t => ({
        value: t,
        label: t,
        count: canvasCourses.filter(c => (c.term || '(无学期)') === t).length
      }))
    ]
  }, [terms, canvasCourses])

  // ── 按学期与搜索关键词筛选课程 ──
  const filteredCourses = useMemo(() => {
    let list = canvasCourses
    if (selectedTerm !== 'all') {
      list = list.filter(c => (c.term || '(无学期)') === selectedTerm)
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

  // 计算已选任务条数与总预估大小
  const selectedStats = useMemo(() => {
    let count = 0
    let totalBytes = 0
    for (const c of canvasCourses) {
      const cd = canvasCourseData[c.courseId]
      if (cd) {
        for (const f of cd.files) {
          if (selected.has(fileTaskId(c.courseId, f.fileId))) {
            count++
            totalBytes += (f.size || 0)
          }
        }
        for (const f of cd.moduleFiles) {
          if (selected.has(fileTaskId(c.courseId, f.fileId))) {
            count++
            totalBytes += (f.size || 0)
          }
        }
        for (const f of cd.syllabusFiles) {
          if (selected.has(fileTaskId(c.courseId, f.fileId))) {
            count++
            totalBytes += (f.size || 0)
          }
        }
      }
    }
    const totalCount = Math.max(count, selected.size)
    return { totalCount, totalBytes }
  }, [canvasCourses, canvasCourseData, selected])

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
    scanningVideoInFlightRef.current.clear()
    scannedVideoCourseIdsRef.current.clear()
    scanningFilesInFlightRef.current.clear()
    scannedFilesCourseIdsRef.current.clear()
    // 4. 清空本地勾选与学期筛选
    setSelected(new Set())
    setSelectedTerm('all')
    // 5. 重新拉取课程列表
    await loadCourses()
  }, [resetProgress, setCloudLinkedIds, setDownloading, resetCanvasScanResults, setSelectedTerm, loadCourses])

  // ── 共享 hooks ──
  // [2.15] useDownloadProgressSubscription moved to App level — removed here
  // useCachedCloudTokenValidation 已移除：云盘 token 不再持久化，登录后由
  // App.tsx 的 prefetchCloudConnection 自动重新连接，无需启动恢复路径。

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

  // ── 作业归档进度订阅：把 canvas:assignment-progress 落到 store.progress ──
  useEffect(() => {
    const unsub = window.api.canvas.onAssignmentProgress(p => {
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

  // ── AI 字幕与逐字稿笔记进度订阅 ──
  useEffect(() => {
    const unsub = window.api.canvas.onTranscriptProgress?.(p => {
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

  // ── 课程已解析任务 id 派生（files / teacher / ppt / moduleVideo / assignments 五类） ──
  // 顶层复用：onToggleAll / toggleCourse / toggleAllCategory / 三态判定 / onDownload
  const courseTaskIds = useCallback((courseId: number): {
    files: string[]; teacher: string[]; ppt: string[]; moduleVideo: string[]; assignments: string[]; all: string[]
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
    const assignments: string[] = []
    if (cd?.assignments) {
      for (const a of cd.assignments) {
        assignments.push(assignmentTaskId(courseId, a.id))
      }
    }
    return { files, teacher, ppt, moduleVideo, assignments, all: [...files, ...teacher, ...ppt, ...moduleVideo, ...assignments] }
  }, [canvasCourseData, canvasLectures, canvasModuleVideos])

  /** 单课程的五分类态 + pptPdf + 课程级态（纯派生，不依赖 selectedCourseIds） */
  const courseStates = useCallback((courseId: number) => {
    const { files, teacher, ppt, moduleVideo, assignments } = courseTaskIds(courseId)
    const sel = canvasCourseCategorySelections[courseId]
    const f = catStateOf(files, selected, sel?.files)
    const t = catStateOf(teacher, selected, sel?.teacher)
    const p = catStateOf(ppt, selected, sel?.ppt)
    const m = catStateOf(moduleVideo, selected, sel?.moduleVideo)
    const a = catStateOf(assignments, selected, sel?.assignments)
    const pptPdf: TriState = sel?.pptPdf ? 'all' : 'none'
    const course = combinePptPdf(aggCourseState(f, t, p, m, a), sel?.pptPdf)
    return { files: f, teacher: t, ppt: p, moduleVideo: m, assignments: a, pptPdf, course }
  }, [courseTaskIds, canvasCourseCategorySelections, selected])

  type CategoryPreset = 'all' | 'files_only' | 'videos_only' | 'videos_teacher_only' | 'videos_ppt_only' | 'ppt_only' | 'assignments_only' | 'clear'

  const applyCategoryPreset = useCallback((preset: CategoryPreset) => {
    if (filteredCourses.length === 0) return
    const courseIds = filteredCourses.map(c => c.courseId)

    if (preset === 'clear') {
      setAllCanvasCourseCategorySelections(
        courseIds,
        { files: false, teacher: false, ppt: false, moduleVideo: false, pptPdf: false, assignments: false }
      )
      setSelected(prev => {
        const next = new Set(prev)
        for (const c of filteredCourses) {
          for (const id of courseTaskIds(c.courseId).all) next.delete(id)
        }
        return next
      })
      return
    }

    const selIntent = {
      files: preset === 'all' || preset === 'files_only',
      teacher: preset === 'all' || preset === 'videos_only' || preset === 'videos_teacher_only',
      ppt: preset === 'all' || preset === 'videos_only' || preset === 'videos_ppt_only',
      moduleVideo: preset === 'all' || preset === 'videos_only',
      pptPdf: preset === 'all' || preset === 'ppt_only',
      assignments: preset === 'all' || preset === 'assignments_only'
    }

    setAllCanvasCourseCategorySelections(courseIds, selIntent)

    setSelected(prev => {
      const next = new Set(prev)
      for (const c of filteredCourses) {
        const { files, teacher, ppt, moduleVideo, assignments } = courseTaskIds(c.courseId)
        for (const id of files) {
          selIntent.files ? next.add(id) : next.delete(id)
        }
        for (const id of teacher) {
          selIntent.teacher ? next.add(id) : next.delete(id)
        }
        for (const id of ppt) {
          selIntent.ppt ? next.add(id) : next.delete(id)
        }
        for (const id of moduleVideo) {
          selIntent.moduleVideo ? next.add(id) : next.delete(id)
        }
        for (const id of assignments) {
          selIntent.assignments ? next.add(id) : next.delete(id)
        }
      }
      return next
    })
  }, [filteredCourses, courseTaskIds, setAllCanvasCourseCategorySelections])

  // ── 课程级全选（顶层，作用于 filteredCourses） ──
  const onToggleAll = useCallback(() => {
    if (filteredCourses.length === 0) return
    const allFull = filteredCourses.every(c => courseStates(c.courseId).course === 'all')
    if (allFull) {
      applyCategoryPreset('clear')
    } else {
      applyCategoryPreset('all')
    }
  }, [filteredCourses, courseStates, applyCategoryPreset])

  const toggleCourseCategory = useCallback((courseId: number, categoryId: string, on: boolean) => {
    const { files, teacher, ppt, moduleVideo, assignments } = courseTaskIds(courseId)
    if (categoryId === 'files') {
      setCanvasCourseCategorySelection(courseId, { files: on })
      if (files.length > 0) toggleSelectMany(files, on)
    } else if (categoryId === 'videos') {
      setCanvasCourseCategorySelection(courseId, { teacher: on, ppt: on, moduleVideo: on })
      const vIds = [...teacher, ...ppt, ...moduleVideo]
      if (vIds.length > 0) toggleSelectMany(vIds, on)
    } else if (categoryId === 'pptPdf') {
      setCanvasCourseCategorySelection(courseId, { pptPdf: on })
    } else if (categoryId === 'assignments') {
      setCanvasCourseCategorySelection(courseId, { assignments: on })
      if (assignments.length > 0) toggleSelectMany(assignments, on)
    }
  }, [courseTaskIds, setCanvasCourseCategorySelection, toggleSelectMany])

  /** 单门课程视频多流快捷视角调度：全选 / 仅教师视角 / 仅 PPT 投屏 / 清空。
   *  [Bug Fix] audio 档原为 no-op（p as any 强转后被忽略）。现统一经
   *  applyVideoPerspectivePreference 同步全局画质偏好（audio_only ↔ 机位互斥），
   *  同时按教师视角勾选（纯音频模式下 PPT 路无独立音频流，自动只选教师路）。 */
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

  /** 单课程级复选框切换：all/some→全清，none→全选 */
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

  /** 单课件文件直下调度函数 */
  const handleDownloadSingleFile = useCallback(async (courseId: number, file: CanvasFileItem) => {
    const st = useAppStore.getState()
    const c = st.canvasCourses.find(cc => cc.courseId === courseId)
    if (!c) return
    const needsLocal = st.downloadMode === 'local' || st.downloadMode === 'both'
    const localDestRoot = st.localDestRoot || ''
    if (needsLocal && !localDestRoot) return

    const tid = fileTaskId(courseId, file.fileId)
    st.applyProgress({ taskId: tid, state: 'pending', received: 0, total: file.size || 0, message: '准备下载…' })

    try {
      const cd = st.canvasCourseData[courseId]
      const folderMap = cd?.folderMap ?? {}
      const selTeachers = st.canvasSelectedTeachers[courseId]
      const allTeachers = st.canvasTeachers[courseId]?.filter(t => t.selected).map(t => t.teacher)
      const teachers = selTeachers?.length ? selTeachers : (allTeachers?.length ? allTeachers : c.teachers)
      const teacherStr = teachers.length > 0 ? teachers.join('/') : ''
      const courseName = [c.name, teacherStr].filter(Boolean).join('-')

      const r = await window.api?.canvas?.buildDownloadSpecs(
        courseName,
        courseId,
        [file],
        folderMap,
        needsLocal ? localDestRoot : '',
        c.term || ''
      )
      const specs = r?.specs ?? []
      if (specs.length > 0) {
        specs[0].taskId = tid
        await submitDownloadBatch(specs, {
          isBothMode: st.downloadMode === 'both',
          existingCloudLinkedIds: st.cloudLinkedIds
        })
      }
    } catch (err) {
      st.applyProgress({
        taskId: tid,
        state: 'error',
        received: 0,
        total: 0,
        message: err instanceof Error ? err.message : '下载启动失败'
      })
    }
  }, [])

  /** 单录播视频文件直下调度函数 */
  const handleDownloadSingleVideo = useCallback(async (
    courseId: number,
    lectureNum: number,
    stream: 'teacher' | 'ppt'
  ) => {
    const st = useAppStore.getState()
    const c = st.canvasCourses.find(cc => cc.courseId === courseId)
    if (!c) return
    const needsLocal = st.downloadMode === 'local' || st.downloadMode === 'both'
    const localDestRoot = st.localDestRoot || ''
    if (needsLocal && !localDestRoot) return

    const tid = lectureStreamTaskId(courseId, lectureNum, stream)
    st.applyProgress({ taskId: tid, state: 'pending', received: 0, total: 0, message: '准备下载视频…' })

    try {
      let lti = st.canvasLtiTokens[courseId]
      if (!lti && window.api?.canvas?.classVideoScan) {
        const scanRes = await window.api.canvas.classVideoScan(courseId)
        if (scanRes.ok && scanRes.token && scanRes.canvasCourseId) {
          lti = { token: scanRes.token, canvasCourseId: scanRes.canvasCourseId }
          st.setCanvasLtiToken(courseId, lti)
        }
      }
      if (!lti) {
        st.applyProgress({ taskId: tid, state: 'error', received: 0, total: 0, message: '无法获取视频凭证' })
        return
      }

      const selTeachers = st.canvasSelectedTeachers[courseId]
      const allTeachers = st.canvasTeachers[courseId]?.filter(t => t.selected).map(t => t.teacher)
      const teachers = selTeachers?.length ? selTeachers : (allTeachers?.length ? allTeachers : c.teachers)
      const teacherStr = teachers.length > 0 ? teachers.join('/') : ''
      const courseName = [c.name, teacherStr].filter(Boolean).join('-')

      const lec = st.canvasLectures[courseId]?.find(l => l.lectureNum === lectureNum)
      const item: CanvasLectureDownloadItem = {
        lectureNum,
        teacher: stream === 'teacher' ? lec?.teacher : undefined,
        ppt: stream === 'ppt' ? lec?.teacher : undefined
      }

      const r = await window.api?.canvas?.downloadLectures(
        courseName,
        courseId,
        [item],
        lti.token,
        needsLocal ? localDestRoot : '',
        st.fileConflictStrategy,
        c.term || '',
        st.videoQualityOption
      )
      const specs = r?.specs ?? []
      if (specs.length > 0) {
        specs[0].taskId = tid
        await submitDownloadBatch(specs, {
          isBothMode: st.downloadMode === 'both',
          existingCloudLinkedIds: st.cloudLinkedIds
        })
      }
    } catch (err) {
      st.applyProgress({
        taskId: tid,
        state: 'error',
        received: 0,
        total: 0,
        message: err instanceof Error ? err.message : '下载启动失败'
      })
    }
  }, [])

  /** 通用单条目下载入口回调 */
  const handleDownloadSingle = useCallback((
    item: NetdiskFileItem,
    _course?: NetdiskCourseItem,
    _category?: NetdiskCategoryItem
  ) => {
    if (item.onDownloadSingle) {
      item.onDownloadSingle()
      return
    }
    if (item.onDownload) {
      item.onDownload()
      return
    }
    if (!item.selected) {
      item.onToggle()
    }
  }, [])

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
    const hasCatSel = Object.values(st.canvasCourseCategorySelections).some(s => s && (s.files || s.teacher || s.ppt || s.moduleVideo || s.pptPdf || s.assignments))
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
    // [Phase 1] 正则反解收口到领域层 collectCourseIds（parseTaskId 唯一解析入口）
    const coursesToProcess = collectCourseIds(selected)
    for (const id of Object.keys(st.canvasCourseCategorySelections)) {
      const sel = st.canvasCourseCategorySelections[Number(id)]
      if (sel && (sel.files || sel.teacher || sel.ppt || sel.moduleVideo || sel.pptPdf || sel.assignments)) coursesToProcess.add(Number(id))
    }

    const downloadOpts = {
      mode: st.downloadMode,
      conflictStrategy: st.fileConflictStrategy,
      localDestRoot: st.downloadMode !== 'cloud' ? st.localDestRoot : undefined,
      namingTemplate: st.namingTemplate,
      cloudDestRoot: st.cloudDestRoot
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
      // 作业归档聚合任务 id（batch 已 await 完成，无云端镜像 → localOnly）
      let assignmentAggregateTaskId: string | undefined
      // AI 逐字稿/字幕聚合任务 id（batch 已 await 完成，无云端镜像 → localOnly）
      let transcriptAggregateTaskId: string | undefined

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
          const isAudioOnly = useAppStore.getState().videoQualityOption === 'audio_only'
          // 按角色携带意图：只下用户实际勾选的一路（teacher 或 ppt）。
          // 若为仅提取音频模式，按用户确认的设计：自动跳过无声/重复的 PPT 视角，仅下载教师视角！
          const lectureItems: CanvasLectureDownloadItem[] = []
          for (const l of lectures) {
            if (!l.teacher) continue
            const teacherWanted = isAudioOnly
              ? (catSel?.teacher || catSel?.ppt || selected.has(lectureStreamTaskId(courseId, l.lectureNum, 'teacher')) || selected.has(lectureStreamTaskId(courseId, l.lectureNum, 'ppt')))
              : (catSel?.teacher || selected.has(lectureStreamTaskId(courseId, l.lectureNum, 'teacher')))
            const pptWanted = isAudioOnly ? false : (catSel?.ppt || selected.has(lectureStreamTaskId(courseId, l.lectureNum, 'ppt')))
            if (!teacherWanted && !pptWanted) continue
            lectureItems.push({
              lectureNum: l.lectureNum,
              teacher: teacherWanted ? l.teacher : undefined,
              ppt: pptWanted ? l.teacher : undefined
            })
          }
          if (lectureItems.length > 0) {
            const r = await window.api.canvas.downloadLectures(
              courseName,
              courseId,
              lectureItems,
              lti.token,
              needsLocal ? st.localDestRoot : '',
              st.fileConflictStrategy,
              c.term || '',
              useAppStore.getState().videoQualityOption
            )
            if (r.ok && r.specs) courseSpecs.push(...r.specs)

            // AI 语音逐字稿与字幕导出 (.srt / .md)
            const exportSrt = useAppStore.getState().canvasExportSrt
            const exportMarkdown = useAppStore.getState().canvasExportMarkdown
            if ((exportSrt || exportMarkdown) && needsLocal) {
              const transcriptTaskId = canvasTranscriptBatchTaskId(courseId)
              useAppStore.getState().addBatchTaskIds([transcriptTaskId])
              snap.applyProgress({
                taskId: transcriptTaskId,
                state: 'pending',
                received: 0,
                total: lectureItems.length,
                message: `正在导出 AI 字幕与逐字稿 (${lectureItems.length} 讲)…`
              })
              try {
                const trRes = await window.api.canvas.downloadTranscriptBatch({
                  taskId: transcriptTaskId,
                  courseName,
                  term: c.term,
                  destRoot: st.localDestRoot,
                  exportSrt,
                  exportMarkdown,
                  lectures: lectureItems.map(l => ({
                    lectureName: `第${l.lectureNum}讲 ${l.teacher?.videoName || ''}`.trim(),
                    videoBaseName: `${l.teacher?.beginTime.split(' ')[0] || ''}-${l.teacher?.teacher || ''}-${l.teacher?.classroom || ''}-第${l.lectureNum}讲`,
                    courseId: l.teacher?.courId || courseId,
                    videoSession: l.teacher ? {
                      beginTime: l.teacher.beginTime,
                      teacher: l.teacher.teacher,
                      classroom: l.teacher.classroom
                    } : undefined
                  }))
                })
                const successCount = trRes.results?.filter(x => x.ok).length ?? 0
                snap.applyProgress({
                  taskId: transcriptTaskId,
                  state: 'done',
                  received: successCount,
                  total: lectureItems.length,
                  message: `AI 字幕: ${successCount}讲完成`
                })
                transcriptAggregateTaskId = transcriptTaskId
              } catch {
                snap.applyProgress({
                  taskId: transcriptTaskId,
                  state: 'error',
                  received: 0,
                  total: lectureItems.length,
                  message: '字幕导出异常'
                })
                transcriptAggregateTaskId = transcriptTaskId
              }
            }
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
            const pptTaskId = canvasPptPdfBatchTaskId(courseId)
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
                term: c.term,
                saveImages: useAppStore.getState().pptSaveImages,
                cloudDestRoot: st.cloudDestRoot
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

      // 课程作业与提交归档 (Assignments & Submissions)
      const assignmentsWanted = catSel?.assignments
      if (assignmentsWanted || [...selected].some(id => id.startsWith(`canvas_assignment_${courseId}_`))) {
        let cd = snap.canvasCourseData[courseId]
        if (!cd) {
          try {
            snap.applyProgress({ taskId: `canvas_course_scan_${courseId}`, state: 'pending', received: 0, total: 0, message: `正在扫描 ${c.name} 作业与课件…` })
            const r = await window.api.canvas.scanCourse(courseId)
            if (r.ok && r.files) {
              cd = buildCourseData(r)
              snap.setCanvasCourseData(courseId, cd)
            }
          } catch { /* skip */ }
          snap.applyProgress({ taskId: `canvas_course_scan_${courseId}`, state: 'done', received: 0, total: 0 })
        }
        if (cancelRequestedRef.current) return { started: false, taskIds: [], localOnlyTaskIds: [] }
        if (cd?.assignments?.length) {
          const selAssignments = assignmentsWanted
            ? cd.assignments
            : cd.assignments.filter(a => selected.has(assignmentTaskId(courseId, a.id)))
          if (selAssignments.length > 0) {
            const assignTaskId = canvasAssignBatchTaskId(courseId)
            useAppStore.getState().addBatchTaskIds([assignTaskId])
            snap.applyProgress({ taskId: assignTaskId, state: 'pending', received: 0, total: selAssignments.length, message: `正在归档作业 (${selAssignments.length} 项)…` })
            const assignmentOptions = useAppStore.getState().canvasAssignmentOptions
            try {
              const r = await window.api.canvas.downloadAssignments({
                taskId: assignTaskId,
                courseId,
                courseName,
                assignments: selAssignments,
                destRoot: needsLocal ? st.localDestRoot : '',
                term: c.term,
                conflictStrategy: st.fileConflictStrategy,
                options: assignmentOptions
              })
              const successCount = r.results?.filter(x => x.ok).length ?? 0
              const failCount = (r.results?.length ?? 0) - successCount
              snap.applyProgress({
                taskId: assignTaskId,
                state: failCount > 0 ? 'error' : 'done',
                received: successCount, total: selAssignments.length,
                message: `作业: ${successCount}成功${failCount > 0 ? `，${failCount}失败` : ''}`
              })
              assignmentAggregateTaskId = assignTaskId
            } catch {
              snap.applyProgress({ taskId: assignTaskId, state: 'error', received: 0, total: selAssignments.length, message: '作业归档失败' })
              assignmentAggregateTaskId = assignTaskId
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
              if (r.ok && r.specs) {
                const isAudioOnly = useAppStore.getState().videoQualityOption === 'audio_only'
                if (isAudioOnly) {
                  for (const s of r.specs) {
                    s.fileName = s.fileName.replace(/\.mp4$/, '.m4a')
                    s.extractAudio = true
                  }
                }
                courseSpecs.push(...r.specs)
              }
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
            useAppStore.getState().videoQualityOption,
            c.term || '',
            st.cloudDestRoot
          )
          if (r.ok) {
            if (r.skipped) {
              useAppStore.getState().applyProgress({ taskId: mvt.taskId, state: 'skipped', received: 0, total: 0, filePath: r.path, cloudPath: r.cloudPath, message: '已存在，跳过' })
            } else {
              useAppStore.getState().applyProgress({ taskId: mvt.taskId, state: 'done', received: 0, total: 0, filePath: r.path, cloudPath: r.cloudPath })
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
      if (assignmentAggregateTaskId) {
        taskIds.push(assignmentAggregateTaskId)
        localOnlyIds.push(assignmentAggregateTaskId)
      }
      if (transcriptAggregateTaskId) {
        taskIds.push(transcriptAggregateTaskId)
        localOnlyIds.push(transcriptAggregateTaskId)
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


  const canvasCourseTaskIds = useAppStore(s => s.canvasCourseTaskIds)
  const progressMap = useAppStore(s => s.progress)

  const netdiskCourses = useMemo<NetdiskCourseItem[]>(() => {
    return filteredCourses.map(c => {
      const cd = canvasCourseData[c.courseId]
      const lec = canvasLectures[c.courseId]
      const mv = canvasModuleVideos[c.courseId]
      const catSel = canvasCourseCategorySelections[c.courseId]
      const cStates = courseStates(c.courseId)
      const tIds = courseTaskIds(c.courseId)

      // 课件项
      const fileItems: NetdiskFileItem[] = []
      let totalFilesBytes = 0
      if (cd) {
        const allFiles = [...cd.files, ...cd.moduleFiles, ...cd.syllabusFiles]
        for (const f of allFiles) {
          const tid = fileTaskId(c.courseId, f.fileId)
          totalFilesBytes += f.size || 0
          fileItems.push({
            id: tid,
            name: f.displayName,
            size: f.size,
            type: f.displayName.includes('.') ? f.displayName.split('.').pop()?.toUpperCase() : 'FILE',
            selected: selected.has(tid),
            onToggle: () => toggleSelect(tid),
            onDownloadSingle: () => void handleDownloadSingleFile(c.courseId, f),
            renderExtra: <FileRowProgress tid={tid} />
          })
        }
      }

      // 视频/音频项
      const isAudioOnly = videoQualityOption === 'audio_only'
      const videoItems: NetdiskFileItem[] = []
      if (lec) {
        for (const l of lec) {
          if (l.teacher) {
            const tTid = lectureStreamTaskId(c.courseId, l.lectureNum, 'teacher')
            videoItems.push({
              id: tTid,
              name: isAudioOnly
                ? `${c.name} - 第${l.lectureNum}讲 教师视角 (音频 M4A)`
                : `${c.name} - 第${l.lectureNum}讲 教师视角 (MP4)`,
              date: l.date,
              type: isAudioOnly ? 'M4A' : 'MP4',
              selected: selected.has(tTid),
              onToggle: () => toggleSelect(tTid),
              onDownloadSingle: () => void handleDownloadSingleVideo(c.courseId, l.lectureNum, 'teacher'),
              renderExtra: <VideoRowProgress tid={tTid} controllable={true} />
            })
            const pTid = lectureStreamTaskId(c.courseId, l.lectureNum, 'ppt')
            videoItems.push({
              id: pTid,
              name: isAudioOnly
                ? `${c.name} - 第${l.lectureNum}讲 PPT投影视角 (无独立音频流)`
                : `${c.name} - 第${l.lectureNum}讲 PPT投影视角 (MP4)`,
              date: l.date,
              type: isAudioOnly ? 'DISABLED' : 'MP4',
              disabled: isAudioOnly,
              disabledReason: isAudioOnly ? '无独立音频流' : undefined,
              selected: isAudioOnly ? false : selected.has(pTid),
              onToggle: () => {
                if (isAudioOnly) return
                toggleSelect(pTid)
              },
              onDownloadSingle: isAudioOnly ? undefined : () => void handleDownloadSingleVideo(c.courseId, l.lectureNum, 'ppt'),
              renderExtra: <VideoRowProgress tid={pTid} controllable={true} />
            })
          }
        }
      }

      // PPT 课件 (PDF) 逐讲明细
      const pptPdfItems = buildPptPdfItems(
        c.name,
        c.courseId,
        lec,
        !!catSel?.pptPdf,
        () => setCanvasCourseCategorySelection(c.courseId, { pptPdf: !catSel?.pptPdf })
      )
      if (mv) {
        for (const t of mv.iframes) {
          const tid = iframeVideoTaskId(c.courseId, t.pageTitle)
          videoItems.push({
            id: tid,
            name: isAudioOnly ? `${t.pageTitle} (音频 M4A)` : `${t.pageTitle} (MP4)`,
            type: isAudioOnly ? 'M4A' : 'MP4',
            selected: selected.has(tid),
            onToggle: () => toggleSelect(tid),
            renderExtra: <VideoRowProgress tid={tid} controllable={false} />
          })
        }
        for (const t of mv.extTools) {
          const tid = extToolVideoTaskId(c.courseId, t.fileId)
          videoItems.push({
            id: tid,
            name: isAudioOnly ? `${t.title} (音频 M4A)` : `${t.title} (MP4)`,
            type: isAudioOnly ? 'M4A' : 'MP4',
            selected: selected.has(tid),
            onToggle: () => toggleSelect(tid),
            renderExtra: <VideoRowProgress tid={tid} controllable={true} />
          })
        }
        for (const t of mv.extUrls) {
          const tid = extUrlVideoTaskId(c.courseId, t.uuid)
          videoItems.push({
            id: tid,
            name: isAudioOnly ? `${t.title} (音频 M4A)` : `${t.title} (MP4)`,
            type: isAudioOnly ? 'M4A' : 'MP4',
            selected: selected.has(tid),
            onToggle: () => toggleSelect(tid),
            renderExtra: <VideoRowProgress tid={tid} controllable={true} />
          })
        }
      }

      // 进度统计（[Phase 1] 收口到领域层 computeBatchStats，消除三页手抄；
      //  progressIds 含聚合任务（PPT/作业/逐字稿），无进度条目的任务静默不计）
      const committedTaskIds = canvasCourseTaskIds[c.courseId] ?? EMPTY_TASK_IDS
      const progressIds = tIds.all.length > 0 ? tIds.all : committedTaskIds
      const isBoth = downloadMode === 'both'
      let courseStats: ReturnType<typeof computeBatchStats> | undefined
      if (progressIds.length > 0) {
        courseStats = computeBatchStats(progressIds, progressMap, isBoth ? cloudLinkedIds : {}, isBoth)
        const started = progressIds.some(id => progressMap[id] !== undefined
          || (isBoth && cloudLinkedIds[id] && progressMap[cloudLinkedIds[id]] !== undefined))
        if (!started) courseStats = undefined
      }

      // 课程作业与提交项
      const assignmentItems: NetdiskFileItem[] = (cd?.assignments ?? []).map(a => {
        const tid = assignmentTaskId(c.courseId, a.id)
        const isSel = selected.has(tid)
        const ddlStr = a.dueAt ? `DDL: ${a.dueAt.slice(0, 16).replace('T', ' ')}` : '无截止时间'
        const scoreStr = a.submissionScore !== undefined ? `得分: ${a.submissionScore}分` : (a.hasSubmission ? '已提交(未评分)' : '未提交')
        const attCount = a.teacherAttachments.length
        const subCount = a.submissionFiles.length
        const detailParts: string[] = [ddlStr, scoreStr]
        if (attCount > 0) detailParts.push(`${attCount}个附件`)
        if (subCount > 0) detailParts.push(`${subCount}个原件`)

        return {
          id: tid,
          name: a.name,
          extension: 'md',
          details: detailParts.join(' · '),
          selected: isSel,
          onToggle: () => toggleSelect(tid),
          renderExtra: <FileRowProgress tid={tid} />
        }
      })

      const categories: NetdiskCategoryItem[] = [
        {
          id: 'files',
          chipKey: 'files',
          name: '课件资料',
          icon: 'file',
          state: cStates.files,
          onToggle: () => {
            const newOn = cStates.files !== 'all'
            setCanvasCourseCategorySelection(c.courseId, { files: newOn })
            if (tIds.files.length > 0) toggleSelectMany(tIds.files, newOn)
          },
          items: fileItems,
          isLoading: scanningCourseIds[c.courseId],
          loadingMessage: '正在扫描课程课件…',
          emptyMessage: cd ? '该课程无课件文件' : '点击扫描课件',
          renderExtra: !cd && !scanningCourseIds[c.courseId] ? (
            <div className="py-2 text-center">
              <button
                type="button"
                onClick={() => void doScanFiles(c.courseId)}
                className="text-xs text-accent hover:underline cursor-pointer"
              >
                点击扫描课件文件
              </button>
            </div>
          ) : undefined
        },
        {
          id: 'assignments',
          chipKey: 'assignments',
          name: '📝 课程作业与提交',
          icon: 'assignment',
          badge: cd?.assignments?.length ? `${cd.assignments.length}` : undefined,
          state: cStates.assignments,
          onToggle: () => {
            const newOn = cStates.assignments !== 'all'
            setCanvasCourseCategorySelection(c.courseId, { assignments: newOn })
            if (tIds.assignments.length > 0) toggleSelectMany(tIds.assignments, newOn)
          },
          items: assignmentItems,
          isLoading: scanningCourseIds[c.courseId],
          loadingMessage: '正在扫描课程作业…',
          emptyMessage: cd ? '该课程无作业任务' : '点击扫描作业与课件',
          renderExtra: (
            <AssignmentProgressRow
              courseId={c.courseId}
              hasCd={!!cd}
              isLoading={!!scanningCourseIds[c.courseId]}
              onScan={() => void doScanFiles(c.courseId)}
            />
          )
        },
        {
          id: 'videos',
          chipKey: 'videos',
          name: isAudioOnly ? '🎵 课堂原声音频 (M4A)' : '🎬 课堂视频',
          icon: isAudioOnly ? 'audio' : 'video',
          state: (cStates.teacher === 'all' && cStates.ppt === 'all' && cStates.moduleVideo === 'all')
            ? 'all'
            : (cStates.teacher === 'none' && cStates.ppt === 'none' && cStates.moduleVideo === 'none')
              ? 'none'
              : 'some',
          onToggle: () => {
            const isAll = cStates.teacher === 'all' && cStates.ppt === 'all' && cStates.moduleVideo === 'all'
            const newOn = !isAll
            setCanvasCourseCategorySelection(c.courseId, { teacher: newOn, ppt: newOn, moduleVideo: newOn })
            const vIds = [...tIds.teacher, ...tIds.ppt, ...tIds.moduleVideo]
            if (vIds.length > 0) toggleSelectMany(vIds, newOn)
          },
          items: videoItems,
          isLoading: scanningVideoCourseIds[c.courseId],
          loadingMessage: isAudioOnly ? '正在扫描课堂音频…' : '正在扫描课堂视频…',
          emptyMessage: lec
            ? (isAudioOnly ? '该课程未发现课堂音频' : '该课程未发现课堂视频')
            : (isAudioOnly ? '点击扫描课堂音频' : '点击扫描课堂视频'),
          renderExtra: (
            <VideoCategoryExtra
              courseId={c.courseId}
              hasLectures={!!lec}
              isLoading={!!scanningVideoCourseIds[c.courseId]}
              isAudioOnly={isAudioOnly}
              onScan={() => void doClassVideoScan(c.courseId)}
              onSelectPerspective={p => handleVideoPerspective(c.courseId, p)}
            />
          )
        },
        {
          id: 'pptPdf',
          chipKey: 'pptPdf',
          name: '📑 PPT课件 (PDF)',
          icon: 'presentation',
          state: catSel?.pptPdf ? 'all' : 'none',
          onToggle: () => setCanvasCourseCategorySelection(c.courseId, { pptPdf: !catSel?.pptPdf }),
          items: pptPdfItems,
          emptyMessage: !catSel?.pptPdf
            ? '点击勾选本分类，可在下载时自动提取课堂视频演示画面并合并导出为高清 PDF 讲义'
            : '已勾选：点击「开始下载」将自动提取板书与幻灯片并导出为 PDF 讲义',
          renderExtra: <PptPdfProgressRow courseId={c.courseId} />
        }
      ]

      return {
        id: c.courseId,
        name: c.name,
        code: c.courseCode,
        term: c.term,
        state: cStates.course,
        itemCount: tIds.all.length,
        totalBytes: totalFilesBytes > 0 ? totalFilesBytes : undefined,
        categories,
        onToggle: () => toggleCourse(c.courseId),
        onToggleCategory: (catId, on) => toggleCourseCategory(c.courseId, catId, on),
        onEnter: () => {
          if (!canvasCourseData[c.courseId] && !scannedFilesCourseIdsRef.current.has(c.courseId)) void doScanFiles(c.courseId)
          if (!canvasLectures[c.courseId] && !scannedVideoCourseIdsRef.current.has(c.courseId)) void doClassVideoScan(c.courseId)
        },
        isLoading: scanningCourseIds[c.courseId] || scanningVideoCourseIds[c.courseId],
        summary: courseStats && (courseStats.done > 0 || courseStats.active > 0 || courseStats.failed > 0)
          ? { done: courseStats.done, downloading: courseStats.active, errors: courseStats.failed, inflight: courseStats.inflight, total: courseStats.total }
          : undefined,
        perspective: catSel?.teacher && !catSel?.ppt ? 'teacher' : (!catSel?.teacher && catSel?.ppt ? 'ppt' : 'all'),
        onPerspectiveChange: p => handleVideoPerspective(c.courseId, p),
        onDownload: () => void onDownload()
      }
    })
  }, [
    filteredCourses, canvasCourseData, canvasLectures, canvasModuleVideos,
    canvasCourseCategorySelections, courseStates, courseTaskIds, selected,
    toggleSelect, toggleSelectMany, setCanvasCourseCategorySelection,
    scanningCourseIds, scanningVideoCourseIds, doScanFiles, doClassVideoScan,
    toggleCourse, toggleCourseCategory, handleVideoPerspective, canvasCourseTaskIds, progressMap, downloadMode, cloudLinkedIds,
    videoQualityOption, handleDownloadSingleFile, handleDownloadSingleVideo, onDownload
  ])

  return (
    <div className="flex h-full w-full flex-col">
      {/* 顶部粘性操作栏 (对齐设计图：学期下拉 + 搜索框 + 已选统计 + 全选 + 立即下载) */}
      <div className="sticky top-0 z-10 no-drag flex flex-wrap items-center justify-between gap-3 border-b border-bd bg-surface-1 px-6 py-2.5 shadow-xs">
        {/* 左侧：学期选择胶囊 + 搜索框 */}
        <div className="flex items-center gap-3">
          <DropdownSelect
            value={selectedTerm}
            options={termOptions}
            onChange={setSelectedTerm}
            icon="📅"
          />

          <div className="relative flex items-center">
            <svg className="pointer-events-none absolute left-3 h-4 w-4 text-text-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索课程/代码..."
              className="h-10 w-44 rounded-xl border border-bd bg-surface-2 pl-9 pr-3 text-xs text-text-1 placeholder:text-text-4 shadow-2xs hover:border-bd-strong focus:w-56 focus:border-accent focus:bg-surface-1 focus:outline-none transition-all duration-200"
            />
          </div>

          <NetdiskViewModeSwitch
            mode={courseViewMode}
            onChange={setCourseViewMode}
          />

          {/* 按学期分栏 / 平铺切换按钮 */}
          <button
            type="button"
            onClick={() => setCanvasGroupByTerm(!canvasGroupByTerm)}
            title={canvasGroupByTerm ? '当前为按学期分栏展示，点击切换为平铺不分栏' : '当前为平铺展示，点击切换为按学期分栏'}
            className={`inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-all shadow-2xs cursor-pointer select-none ${
              canvasGroupByTerm
                ? 'border-accent/40 bg-accent/10 text-accent font-semibold'
                : 'border-bd bg-surface-2 text-text-3 hover:border-bd-strong hover:bg-surface-1 hover:text-text-1'
            }`}
          >
            <span>{canvasGroupByTerm ? '📑 学期分栏' : '📄 平铺展示'}</span>
          </button>

          {canvasScanState === 'scanning' && (
            <span className="inline-flex items-center gap-1.5 text-xs text-text-2">
              <Spinner size={12} /> {canvasScanMessage}
            </span>
          )}

          <button
            type="button"
            onClick={() => void onRefresh()}
            title="刷新课程列表"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-bd bg-surface-2 text-text-3 hover:border-bd-strong hover:bg-surface-1 hover:text-text-1 transition-all shadow-2xs cursor-pointer text-sm"
          >
            ↻
          </button>
        </div>

        {/* 右侧：已选统计 + 已选全部 + 立即下载 */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-2">
            <span className="text-accent font-bold">☑</span>
            <span>已选 {selectedStats.totalCount} 项{selectedStats.totalBytes > 0 ? ` (${formatBytes(selectedStats.totalBytes)})` : ''}</span>
          </div>

          {/* 分体全选/分类批量预设选择下拉菜单 */}
          <div ref={batchMenuRef} className="relative inline-flex items-center rounded-xl border border-bd bg-surface-2 shadow-2xs hover:border-bd-strong transition-all">
            <button
              type="button"
              onClick={onToggleAll}
              className="inline-flex h-10 items-center gap-2 px-3.5 text-xs font-medium text-text-1 hover:bg-surface-1 rounded-l-xl transition-all cursor-pointer select-none"
              title="全选 / 取消当前筛选范围内的所有资源"
            >
              <TriCheckbox state={courseTriState} size="sm" />
              <span>已选全部</span>
            </button>
            <div className="h-4 w-px bg-bd/70" />
            <button
              type="button"
              onClick={() => setBatchMenuOpen(prev => !prev)}
              className="inline-flex h-10 w-8 items-center justify-center text-xs text-text-3 hover:text-text-1 hover:bg-surface-1 rounded-r-xl transition-all cursor-pointer"
              title="快捷分类选择（仅选课件/仅选视频/仅选PPT/清空）"
            >
              <svg className={`h-3.5 w-3.5 transition-transform duration-200 ${batchMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </button>

            {batchMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-2xl border border-bd bg-surface-1 p-1.5 shadow-xl animate-fadeIn text-xs">
                <div className="px-2.5 py-1.5 text-2xs font-semibold text-text-3 border-b border-bd/40 mb-1">
                  当前筛选范围批量选择 ({filteredCourses.length} 门课程)
                </div>
                <button
                  type="button"
                  onClick={() => {
                    applyCategoryPreset('all')
                    setBatchMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-text-1 hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <span className="text-sm">☑️</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-xs">全选所有资源</div>
                    <div className="text-2xs text-text-3">课件 + 作业 + 视频 + PPT 讲义</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    applyCategoryPreset('files_only')
                    setBatchMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-text-1 hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <span className="text-sm">📄</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-xs text-accent">仅选课件文档</div>
                    <div className="text-2xs text-text-3">勾选所有课件资料，取消视频与作业</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    applyCategoryPreset('assignments_only')
                    setBatchMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-text-1 hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <span className="text-sm">📝</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-xs text-purple-600 dark:text-purple-400">仅选作业与提交</div>
                    <div className="text-2xs text-text-3">勾选全部作业要求、附件与提交原件</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    applyCategoryPreset('videos_only')
                    setBatchMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-text-1 hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <span className="text-sm">🎬</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-xs text-info">全部视频</div>
                    <div className="text-2xs text-text-3">双流全选（教师机位与 PPT）</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    applyCategoryPreset('videos_teacher_only')
                    setBatchMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-text-1 hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <span className="text-sm">👨‍🏫</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-xs text-info">仅教师视频</div>
                    <div className="text-2xs text-text-3">仅勾选教师机位画面与音频</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    applyCategoryPreset('videos_ppt_only')
                    setBatchMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-text-1 hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <span className="text-sm">💻</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-xs text-info">仅 PPT 视频</div>
                    <div className="text-2xs text-text-3">仅勾选幻灯片屏幕投屏画面</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    applyCategoryPreset('ppt_only')
                    setBatchMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-text-1 hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <span className="text-sm">📑</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-xs">仅选 PPT 课件 (PDF)</div>
                    <div className="text-2xs text-text-3">勾选演示幻灯片讲义</div>
                  </div>
                </button>
                <div className="my-1 border-t border-bd/40" />
                <button
                  type="button"
                  onClick={() => {
                    applyCategoryPreset('clear')
                    setBatchMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-warning hover:bg-warning/10 transition-colors cursor-pointer"
                >
                  <span>✕</span>
                  <span className="font-medium text-xs">清空当前选择</span>
                </button>
              </div>
            )}
          </div>

          {downloading && (
            <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
              <GlobalCtrlButton kind="pause" onClick={onPauseAll} title="暂停全部" />
              <GlobalCtrlButton kind="resume" onClick={onResumeAll} title="继续全部" />
              <GlobalCtrlButton kind="cancel" onClick={onCancelAll} title="取消全部" />
            </div>
          )}

        </div>
      </div>

      {/* 课程列表：网盘资源浏览器 */}
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
            navState={navState}
            onNavigate={setNavState}
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

