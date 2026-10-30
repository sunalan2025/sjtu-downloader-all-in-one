import type {
  CanvasCourse,
  CanvasFileItem,
  CanvasLectureGroup
} from '@shared/types'
import type {
  NetdiskCourseItem,
  NetdiskCategoryItem,
  NetdiskFileItem,
  VideoPerspective
} from '../../components/NetdiskCourseExplorer'
import type { TriState } from '../../components/DownloadUI'
import {
  canvasFileTaskId as fileTaskId,
  canvasAssignmentTaskId as assignmentTaskId,
  canvasLectureTaskId as lectureStreamTaskId,
  canvasExtToolTaskId as extToolVideoTaskId,
  canvasExtUrlTaskId as extUrlVideoTaskId
} from '../../download/taskIds'
import { computeBatchStats } from '../../download/progress'
import {
  type CourseData,
  buildPptPdfItems,
  iframeVideoTaskId,
  EMPTY_TASK_IDS
} from './canvas-tree-utils'
import {
  FileRowProgress,
  VideoRowProgress,
  PptPdfProgressRow,
  AssignmentProgressRow,
  VideoCategoryExtra
} from './canvas-progress-widgets'
import type { CanvasScanQueue } from '../../services/canvas-scan-queue'
import { handleDownloadSinglePpt, handleDownloadSingleAssignment } from './canvas-download-actions'

export interface BuildNetdiskCoursesOptions {
  filteredCourses: CanvasCourse[]
  canvasCourseData: Record<number, CourseData>
  canvasLectures: Record<number, CanvasLectureGroup[]>
  canvasModuleVideos: Record<number, {
    iframes: Array<{ moduleName: string; pageTitle: string; iframeUrl: string }>
    extTools: Array<{ moduleItemId: number; fileId: string; title: string }>
    extUrls: Array<{ uuid: string; title: string }>
  } | undefined>
  canvasCourseCategorySelections: Record<number, any>
  canvasCourseTaskIds: Record<number, string[] | undefined>
  progressMap: Record<string, any>
  downloadMode: string
  cloudLinkedIds: Record<string, string>
  videoQualityOption: string
  videoPerspectivePreference: VideoPerspective
  selected: Set<string>
  scanningCourseIds: Record<number, boolean>
  scanningVideoCourseIds: Record<number, boolean>
  courseStates: (courseId: number) => {
    files: TriState
    teacher: TriState
    ppt: TriState
    moduleVideo: TriState
    assignments: TriState
    pptPdf: TriState
    course: TriState
  }
  courseTaskIds: (courseId: number) => {
    files: string[]
    teacher: string[]
    ppt: string[]
    moduleVideo: string[]
    assignments: string[]
    all: string[]
  }
  toggleSelect: (id: string) => void
  togglePptItem?: (courseId: number, id: string) => void
  toggleSelectMany: (ids: string[], on: boolean) => void
  setCanvasCourseCategorySelection: (courseId: number, patch: any) => void
  toggleCourse: (courseId: number) => void
  toggleCourseCategory: (courseId: number, categoryId: string, on: boolean) => void
  handleVideoPerspective: (courseId: number, p: 'all' | 'teacher' | 'ppt' | 'none' | 'audio') => void
  handleDownloadSingleFile: (courseId: number, file: CanvasFileItem) => void
  handleDownloadSingleVideo: (courseId: number, lectureNum: number, stream: 'teacher' | 'ppt') => void
  onDownload: () => void
  doScanFiles: (courseId: number) => Promise<void>
  doClassVideoScan: (courseId: number) => Promise<void>
  scanQueue: CanvasScanQueue | null
  scannedFilesCourseIds: Set<number>
  scannedVideoCourseIds: Set<number>
}

export function buildNetdiskCourses(opts: BuildNetdiskCoursesOptions): NetdiskCourseItem[] {
  const {
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
    scanQueue,
    scannedFilesCourseIds,
    scannedVideoCourseIds
  } = opts

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
    const isAudioOnly = videoQualityOption === 'audio_only' || videoPerspectivePreference === 'audio'
    const videoItems: NetdiskFileItem[] = []
    if (lec) {
      for (const l of lec) {
        if (l.teacher) {
          if (isAudioOnly) {
            const tTid = lectureStreamTaskId(c.courseId, l.lectureNum, 'teacher')
            videoItems.push({
              id: tTid,
              name: `${c.name} - 第${l.lectureNum}讲 原声音频`,
              date: l.date,
              type: 'M4A',
              selected: selected.has(tTid),
              onToggle: () => toggleSelect(tTid),
              onDownloadSingle: () => void handleDownloadSingleVideo(c.courseId, l.lectureNum, 'teacher'),
              renderExtra: <VideoRowProgress tid={tTid} controllable={true} />
            })
          } else {
            if (videoPerspectivePreference === 'teacher' || videoPerspectivePreference === 'all') {
              const tTid = lectureStreamTaskId(c.courseId, l.lectureNum, 'teacher')
              videoItems.push({
                id: tTid,
                name: `${c.name} - 第${l.lectureNum}讲 教师视角`,
                date: l.date,
                type: 'MP4',
                selected: selected.has(tTid),
                onToggle: () => toggleSelect(tTid),
                onDownloadSingle: () => void handleDownloadSingleVideo(c.courseId, l.lectureNum, 'teacher'),
                renderExtra: <VideoRowProgress tid={tTid} controllable={true} />
              })
            }
            if (videoPerspectivePreference === 'ppt' || videoPerspectivePreference === 'all') {
              const pTid = lectureStreamTaskId(c.courseId, l.lectureNum, 'ppt')
              videoItems.push({
                id: pTid,
                name: `${c.name} - 第${l.lectureNum}讲 PPT投影视角`,
                date: l.date,
                type: 'MP4',
                selected: selected.has(pTid),
                onToggle: () => toggleSelect(pTid),
                onDownloadSingle: () => void handleDownloadSingleVideo(c.courseId, l.lectureNum, 'ppt'),
                renderExtra: <VideoRowProgress tid={pTid} controllable={true} />
              })
            }
          }
        }
      }
    }

    // PPT 课件 (PDF) 逐讲明细
    const pptPdfItems = buildPptPdfItems(
      c.name,
      c.courseId,
      lec,
      catSel?.pptPdf ? true : selected,
      id => opts.togglePptItem ? opts.togglePptItem(c.courseId, id) : toggleSelect(id)
    )
    for (const item of pptPdfItems) {
      const lectureNum = Number(item.id.split('_').at(-1))
      item.onDownloadSingle = () => { void handleDownloadSinglePpt(c.courseId, lectureNum) }
    }
    if (mv) {
      for (const t of mv.iframes) {
        const tid = iframeVideoTaskId(c.courseId, t.pageTitle)
        videoItems.push({
          id: tid,
          name: isAudioOnly ? `${t.pageTitle} 音频` : t.pageTitle,
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
          name: isAudioOnly ? `${t.title} 音频` : t.title,
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
          name: isAudioOnly ? `${t.title} 音频` : t.title,
          type: isAudioOnly ? 'M4A' : 'MP4',
          selected: selected.has(tid),
          onToggle: () => toggleSelect(tid),
          renderExtra: <VideoRowProgress tid={tid} controllable={true} />
        })
      }
    }

    // 进度统计
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
      const scoreStr = a.submissionScore !== undefined ? `得分: ${a.submissionScore}分` : (a.hasSubmission ? '已提交未评分' : '未提交')
      const attCount = a.teacherAttachments.length
      const subCount = a.submissionFiles.length
      const detailParts: string[] = [ddlStr, scoreStr]
      if (attCount > 0) detailParts.push(`${attCount}个附件`)
      if (subCount > 0) detailParts.push(`${subCount}个原件`)

      const prog = progressMap[tid]
      const isDone = prog?.state === 'done' || prog?.state === 'skipped'

      return {
        id: tid,
        name: a.name,
        type: 'assignment',
        details: detailParts.join(' · '),
        assignmentMeta: {
          hasSubmission: a.hasSubmission,
          submittedAt: a.submittedAt,
          submissionScore: a.submissionScore,
          submissionGrade: a.submissionGrade,
          pointsPossible: a.pointsPossible,
          dueAt: a.dueAt,
          teacherAttachmentCount: attCount,
          submissionFileCount: subCount
        },
        selected: isSel,
        onToggle: () => toggleSelect(tid),
        onDownloadSingle: () => {
          if (isDone && prog?.filePath) {
            void window.api.openPath(prog.filePath)
          } else {
            void handleDownloadSingleAssignment(c.courseId, a)
          }
        },
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
        emptyMessage: cd ? '该课程无课件文件' : (scanningCourseIds[c.courseId] ? '正在获取课程课件…' : '当前课程暂无课件文件'),
        onEnter: () => {
          if (!cd && !scanningCourseIds[c.courseId]) void doScanFiles(c.courseId)
        }
      },
      {
        id: 'assignments',
        chipKey: 'assignments',
        name: '📝 课程作业与提交',
        icon: 'assignment',
        itemUnit: '项作业',
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
        emptyMessage: cd ? '该课程无作业任务' : (scanningCourseIds[c.courseId] ? '正在获取课程作业…' : '当前课程暂无作业任务'),
        onEnter: () => {
          if (!cd && !scanningCourseIds[c.courseId]) void doScanFiles(c.courseId)
        },
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
        name: isAudioOnly ? '🎵 课堂原声音频' : '🎬 课堂视频',
        icon: isAudioOnly ? 'audio' : 'video',
        state: (() => {
          const activeStates: TriState[] = []
          if (isAudioOnly || videoPerspectivePreference === 'teacher' || videoPerspectivePreference === 'all') {
            activeStates.push(cStates.teacher)
          }
          if (!isAudioOnly && (videoPerspectivePreference === 'ppt' || videoPerspectivePreference === 'all')) {
            activeStates.push(cStates.ppt)
          }
          if (tIds.moduleVideo.length > 0) {
            activeStates.push(cStates.moduleVideo)
          }
          if (activeStates.length === 0) return 'none'
          if (activeStates.every(s => s === 'all')) return 'all'
          if (activeStates.every(s => s === 'none')) return 'none'
          return 'some'
        })(),
        onToggle: () => {
          const activeStates: TriState[] = []
          if (isAudioOnly || videoPerspectivePreference === 'teacher' || videoPerspectivePreference === 'all') {
            activeStates.push(cStates.teacher)
          }
          if (!isAudioOnly && (videoPerspectivePreference === 'ppt' || videoPerspectivePreference === 'all')) {
            activeStates.push(cStates.ppt)
          }
          if (tIds.moduleVideo.length > 0) {
            activeStates.push(cStates.moduleVideo)
          }
          const isAll = activeStates.length > 0 && activeStates.every(s => s === 'all')
          const newOn = !isAll
          setCanvasCourseCategorySelection(c.courseId, {
            teacher: (isAudioOnly || videoPerspectivePreference === 'teacher' || videoPerspectivePreference === 'all') ? newOn : false,
            ppt: (!isAudioOnly && (videoPerspectivePreference === 'ppt' || videoPerspectivePreference === 'all')) ? newOn : false,
            moduleVideo: newOn
          })
          const vIds = [...tIds.teacher, ...tIds.ppt, ...tIds.moduleVideo]
          if (vIds.length > 0) toggleSelectMany(vIds, newOn)
        },
        items: videoItems,
        isLoading: scanningVideoCourseIds[c.courseId],
        loadingMessage: isAudioOnly ? '正在扫描课堂音频…' : '正在扫描课堂视频…',
        emptyMessage: scanningVideoCourseIds[c.courseId]
          ? (isAudioOnly ? '正在获取课程音频…' : '正在获取课程录播…')
          : (lec ? (isAudioOnly ? '当前课程暂无课堂音频' : '当前课程暂无课堂录播') : (isAudioOnly ? '正在获取课程音频…' : '正在获取课程录播…')),
        onEnter: () => {
          if (!lec && !scanningVideoCourseIds[c.courseId]) void doClassVideoScan(c.courseId)
        },
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
        name: '📑 PPT课件',
        icon: 'presentation',
        state: cStates.pptPdf,
        onToggle: () => toggleCourseCategory(c.courseId, 'pptPdf', cStates.pptPdf !== 'all'),
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
      onToggle: () => {
        if (cStates.course === 'none') requestScan()
        toggleCourse(c.courseId)
      },
      onToggleCategory: (catId, on) => toggleCourseCategory(c.courseId, catId, on),
      onEnter: requestScan,
      onVisible: requestScan,
      isLoading: scanningCourseIds[c.courseId] || scanningVideoCourseIds[c.courseId],
      summary: courseStats && (courseStats.done > 0 || courseStats.active > 0 || courseStats.failed > 0)
        ? { done: courseStats.done, downloading: courseStats.active, errors: courseStats.failed, inflight: courseStats.inflight, total: courseStats.total }
        : undefined,
      perspective: isAudioOnly ? 'audio' : videoPerspectivePreference,
      onPerspectiveChange: p => handleVideoPerspective(c.courseId, p),
      onDownload: () => void onDownload()
    }

    function requestScan() {
      if (scanQueue) {
        scanQueue.enqueue({ courseId: c.courseId, priority: 'high', scanFiles: doScanFiles, scanVideos: doClassVideoScan })
        scanQueue.promote(c.courseId)
      } else {
        if (!canvasCourseData[c.courseId] && !scannedFilesCourseIds.has(c.courseId)) void doScanFiles(c.courseId)
        if (!canvasLectures[c.courseId] && !scannedVideoCourseIds.has(c.courseId)) void doClassVideoScan(c.courseId)
      }
    }
  })
}
