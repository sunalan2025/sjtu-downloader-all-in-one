import { useAppStore } from '../../store/app'
import { isLegacyCanvasVideo } from '@shared/canvas-video'
import type {
  CanvasCourse,
  CanvasDownloadTaskSpec,
  CanvasFileItem,
  CanvasLectureDownloadItem,
  CanvasAssignmentItem
} from '@shared/types'
import {
  canvasFileTaskId as fileTaskId,
  canvasAssignmentTaskId as assignmentTaskId,
  canvasLectureTaskId as lectureStreamTaskId,
  canvasTranscriptBatchTaskId,
  canvasPptPdfBatchTaskId,
  canvasPptItemTaskId,
  canvasAssignBatchTaskId,
  canvasExtToolTaskId as extToolVideoTaskId,
  canvasExtUrlTaskId as extUrlVideoTaskId,
  collectCourseIds
} from '../../download/taskIds'
import { submitDownloadBatch } from '../../download/submit'
import { resolveLocalDestination } from '../../download/destination'
import {
  buildCourseData,
  iframeVideoTaskId,
  moduleVideoBaseName
} from './canvas-tree-utils'
import type {
  NetdiskFileItem,
  NetdiskCourseItem,
  NetdiskCategoryItem
} from '../../components/NetdiskCourseExplorer'

export function buildCanvasCourseName(c: CanvasCourse): string {
  const st = useAppStore.getState()
  const sel = st.canvasSelectedTeachers[c.courseId]
  const all = st.canvasTeachers[c.courseId]?.filter(t => t.selected).map(t => t.teacher)
  const teachers = sel?.length ? sel : (all?.length ? all : c.teachers)
  const teacherStr = teachers.length > 0 ? teachers.join('/') : ''
  return [c.name, teacherStr].filter(Boolean).join('-')
}

/** 单课件文件直下调度函数 */
export async function handleDownloadSingleFile(courseId: number, file: CanvasFileItem): Promise<void> {
  const st = useAppStore.getState()
  const c = st.canvasCourses.find(cc => cc.courseId === courseId)
  if (!c) return
  const needsLocal = st.downloadMode === 'local' || st.downloadMode === 'both'

  const tid = fileTaskId(courseId, file.fileId)
  st.applyProgress({ taskId: tid, state: 'pending', received: 0, total: file.size || 0, message: '准备下载…' })

  try {
    const localDestRoot = await resolveLocalDestination(st.downloadMode, st.localDestRoot)
    const cd = st.canvasCourseData[courseId]
    const folderMap = cd?.folderMap ?? {}
    const courseName = buildCanvasCourseName(c)

    const r = await window.api?.canvas?.buildDownloadSpecs(
      courseName,
      courseId,
      [file],
      folderMap,
      needsLocal ? localDestRoot : '',
      c.term || ''
    )
    const specs = r?.specs ?? []
    if (!r?.ok || specs.length === 0) throw new Error(r?.error || '没有可下载的课件文件')
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
}

/** 单录播视频文件直下调度函数 */
export async function handleDownloadSingleVideo(
  courseId: number,
  lectureNum: number,
  stream: 'teacher' | 'ppt'
): Promise<void> {
  const st = useAppStore.getState()
  const c = st.canvasCourses.find(cc => cc.courseId === courseId)
  if (!c) return
  const needsLocal = st.downloadMode === 'local' || st.downloadMode === 'both'

  const tid = lectureStreamTaskId(courseId, lectureNum, stream)
  st.applyProgress({ taskId: tid, state: 'pending', received: 0, total: 0, message: '准备下载视频…' })

  try {
    const localDestRoot = await resolveLocalDestination(st.downloadMode, st.localDestRoot)
    let lti = st.canvasLtiTokens[courseId]
    const lec = st.canvasLectures[courseId]?.find(l => l.lectureNum === lectureNum)
    if (!lec?.teacher) throw new Error('未找到所选讲次，请刷新课程')
    const needsToken = !isLegacyCanvasVideo(lec.teacher)
    if (!lti && needsToken && window.api?.canvas?.classVideoScan) {
      const scanRes = await window.api.canvas.classVideoScan(courseId)
      if (scanRes.ok && scanRes.token && scanRes.canvasCourseId) {
        lti = { token: scanRes.token, canvasCourseId: scanRes.canvasCourseId }
        st.setCanvasLtiToken(courseId, lti)
      }
    }
    if (!lti && needsToken) {
      st.applyProgress({ taskId: tid, state: 'error', received: 0, total: 0, message: '无法获取视频凭证' })
      return
    }

    const courseName = buildCanvasCourseName(c)
    const item: CanvasLectureDownloadItem = {
      lectureNum,
      teacher: stream === 'teacher' ? lec?.teacher : undefined,
      ppt: stream === 'ppt' ? lec?.teacher : undefined
    }

    const r = await window.api?.canvas?.downloadLectures(
      courseName,
      courseId,
      [item],
      lti?.token || '',
      needsLocal ? localDestRoot : '',
      st.fileConflictStrategy,
      c.term || '',
      st.videoQualityOption
    )
    const specs = r?.specs ?? []
    if (!r?.ok || specs.length === 0) throw new Error(r?.error || '所选视角暂无可下载的视频流')
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
}

/** 单个课程作业归档下载调度函数 */
export async function handleDownloadSingleAssignment(
  courseId: number,
  assignment: CanvasAssignmentItem
): Promise<void> {
  const st = useAppStore.getState()
  const c = st.canvasCourses.find(cc => cc.courseId === courseId)
  if (!c) return
  const needsLocal = st.downloadMode === 'local' || st.downloadMode === 'both'
  const needsCloud = st.downloadMode === 'cloud' || st.downloadMode === 'both'

  const tid = assignmentTaskId(courseId, assignment.id)
  const courseName = buildCanvasCourseName(c)
  st.applyProgress({
    taskId: tid,
    state: 'pending',
    received: 0,
    total: 1,
    fileName: assignment.name,
    courseName,
    message: '正在归档作业…'
  })

  try {
    const localDestRoot = needsLocal ? await resolveLocalDestination(st.downloadMode, st.localDestRoot) : ''

    const r = await window.api.canvas.downloadAssignments({
      taskId: tid,
      courseId,
      courseName,
      assignments: [assignment],
      destRoot: localDestRoot,
      term: c.term,
      conflictStrategy: st.fileConflictStrategy,
      options: st.canvasAssignmentOptions,
      cloudUserToken: needsCloud ? st.cloudUserToken ?? undefined : undefined,
      cloudDestRoot: st.cloudDestRoot
    })

    if (r.ok && r.results?.[0]?.ok) {
      const outPath = r.results[0].path
      st.applyProgress({
        taskId: tid,
        state: 'done',
        received: 1,
        total: 1,
        fileName: assignment.name,
        courseName,
        filePath: outPath,
        message: '归档完成'
      })
      window.api.notify('作业归档完成', `${assignment.name} 已归档`).catch(() => undefined)
    } else {
      st.applyProgress({
        taskId: tid,
        state: 'error',
        received: 0,
        total: 1,
        fileName: assignment.name,
        courseName,
        message: r.results?.[0]?.error || r.error || '作业归档失败'
      })
    }
  } catch (err) {
    st.applyProgress({
      taskId: tid,
      state: 'error',
      received: 0,
      total: 1,
      fileName: assignment.name,
      courseName,
      message: err instanceof Error ? err.message : '作业归档异常'
    })
  }
}

/** 通用单条目下载入口回调 */
export function handleDownloadSingle(
  item: NetdiskFileItem,
  _course?: NetdiskCourseItem,
  _category?: NetdiskCategoryItem
): void {
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
}

/** The backend already supports one lecture; keep the request scoped to that lecture. */
export async function handleDownloadSinglePpt(courseId: number, lectureNum: number): Promise<void> {
  const st = useAppStore.getState()
  const course = st.canvasCourses.find(c => c.courseId === courseId)
  const lecture = st.canvasLectures[courseId]?.find(l => l.lectureNum === lectureNum)
  if (!course || !lecture?.teacher) return
  const taskId = canvasPptItemTaskId(courseId, lectureNum)
  if (['pending', 'downloading', 'uploading'].includes(st.progress[taskId]?.state ?? '')) return
  const needsCloud = st.downloadMode !== 'local'
  const courseName = buildCanvasCourseName(course)
  st.addBatchTaskIds([taskId])
  st.applyProgress({ taskId, state: 'pending', received: 0, total: 0, courseName, fileName: `第${lectureNum}讲 PPT课件`, message: '准备提取单讲课件…' })
  try {
    const localDestRoot = await resolveLocalDestination(st.downloadMode, st.localDestRoot)
    if (needsCloud && !st.cloudUserToken) throw new Error('请先登录交大云盘')
    if (isLegacyCanvasVideo(lecture.teacher)) throw new Error('当前仅支持新版录播提取 PPT 课件')
    const r = await window.api.ppt.download({
      ltiToken: st.canvasLtiTokens[courseId]?.token,
      taskId, ivsVideoId: lecture.teacher.videoId, courseName, lectureName: `第${lectureNum}讲 ${lecture.date}`,
      destRoot: localDestRoot, cloudUserToken: needsCloud ? st.cloudUserToken ?? undefined : undefined,
      conflictStrategy: st.fileConflictStrategy, term: course.term, saveImages: st.pptSaveImages, cloudDestRoot: st.cloudDestRoot,
      videoSession: { beginTime: lecture.teacher.beginTime, teacher: lecture.teacher.teacher, classroom: lecture.teacher.classroom }
    })
    if (!r.ok) throw new Error(r.error || '单讲课件下载失败')
    st.applyProgress({ taskId, state: r.skipped ? 'skipped' : 'done', received: 1, total: 1, filePath: r.path, message: r.skipped ? '已存在，跳过' : '单讲课件已完成' })
  } catch (error) {
    st.applyProgress({ taskId, state: 'error', received: 0, total: 0, message: error instanceof Error ? error.message : '单讲课件下载失败' })
  }
}

/** 等待一门课的所有任务完成（done/skipped/error/cancelled） */
export function waitForCourseCompletion(taskIds: string[]): Promise<void> {
  return new Promise(resolve => {
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
}

/** 处理单门课程的全部已选资源并提交下载 */
export async function processCourse(
  courseId: number,
  selected: Set<string>,
  cancelRequestedRef: { current: boolean }
): Promise<{ started: boolean; taskIds: string[]; localOnlyTaskIds: string[] }> {
  const snap = useAppStore.getState()
  const st = { ...snap, localDestRoot: await resolveLocalDestination(snap.downloadMode, snap.localDestRoot) }
  const needsLocal = st.downloadMode === 'local' || st.downloadMode === 'both'
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

    if (!lectures || (!lti && lectures.some(l => l.teacher && !isLegacyCanvasVideo(l.teacher)))) {
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
    if (lectures?.length) {
      const isAudioOnly = snap.videoQualityOption === 'audio_only' || snap.videoPerspectivePreference === 'audio'
      const pref = snap.videoPerspectivePreference
      // 按角色携带意图：严格按设置或实际勾选
      const lectureItems: CanvasLectureDownloadItem[] = []
      for (const l of lectures) {
        if (!l.teacher) continue
        const teacherWanted = isAudioOnly
          ? (catSel?.teacher || catSel?.ppt || selected.has(lectureStreamTaskId(courseId, l.lectureNum, 'teacher')) || selected.has(lectureStreamTaskId(courseId, l.lectureNum, 'ppt')))
          : ((pref === 'teacher' || pref === 'all') && (catSel?.teacher || selected.has(lectureStreamTaskId(courseId, l.lectureNum, 'teacher'))))
        const pptWanted = isAudioOnly ? false : ((pref === 'ppt' || pref === 'all') && (catSel?.ppt || selected.has(lectureStreamTaskId(courseId, l.lectureNum, 'ppt'))))
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
          lti?.token || '',
          needsLocal ? st.localDestRoot : '',
          st.fileConflictStrategy,
          c.term || '',
          snap.videoQualityOption
        )
        if (r.ok && r.specs) courseSpecs.push(...r.specs)

        // AI 语音逐字稿与字幕导出 (.srt / .md)
        const exportSrt = snap.canvasExportSrt
        const exportMarkdown = snap.canvasExportMarkdown
        if ((exportSrt || exportMarkdown) && needsLocal) {
          const transcriptTaskId = canvasTranscriptBatchTaskId(courseId)
          snap.addBatchTaskIds([transcriptTaskId])
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
  const pptPdfWanted = catSel?.pptPdf || [...selected].some(id => id.startsWith(`canvas_ppt_item_${courseId}_`))
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
      const validLectures = pdfLectures.filter(l => l.teacher && !isLegacyCanvasVideo(l.teacher) && (catSel?.pptPdf || selected.has(canvasPptItemTaskId(courseId, l.lectureNum))))
      if (validLectures.length > 0) {
        const pptTaskId = canvasPptPdfBatchTaskId(courseId)
        const pptDestRoot = needsLocal ? st.localDestRoot : ''
        const needsCloudPpt = st.downloadMode === 'cloud' || st.downloadMode === 'both'
        const cloudToken = needsCloudPpt ? snap.cloudUserToken ?? undefined : undefined

        snap.addBatchTaskIds([pptTaskId])
        snap.applyProgress({
          taskId: pptTaskId,
          state: 'pending',
          received: 0,
          total: validLectures.length,
          fileName: `${courseName} · 课堂讲义 (PPT/PDF)`,
          courseName,
          message: `正在下载PPT课件 (${validLectures.length} 讲)…`
        })
        try {
          const r = await window.api.ppt.downloadBatch({
            ltiToken: pdfLti.token,
            taskId: pptTaskId,
            lectures: validLectures.map(l => ({
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
            saveImages: snap.pptSaveImages,
            cloudDestRoot: st.cloudDestRoot,
            privateWorker: st.privateWorkerConfig
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
            received: successCount,
            total: validLectures.length,
            fileName: `${courseName} · 课堂讲义 (PPT/PDF)`,
            courseName,
            message: `PPT: ${parts.join('，') || '无操作'}`
          })
          pptAggregateTaskId = pptTaskId
        } catch {
          snap.applyProgress({
            taskId: pptTaskId,
            state: 'error',
            received: 0,
            total: validLectures.length,
            fileName: `${courseName} · 课堂讲义 (PPT/PDF)`,
            courseName,
            message: 'PPT下载失败'
          })
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
        snap.addBatchTaskIds([assignTaskId])
        snap.applyProgress({
          taskId: assignTaskId,
          state: 'pending',
          received: 0,
          total: selAssignments.length,
          fileName: `${courseName} · 课程作业归档`,
          courseName,
          message: `正在归档作业 (${selAssignments.length} 项)…`
        })
        const assignmentOptions = snap.canvasAssignmentOptions
        try {
          const r = await window.api.canvas.downloadAssignments({
            taskId: assignTaskId,
            courseId,
            courseName,
            assignments: selAssignments,
            destRoot: needsLocal ? st.localDestRoot : '',
            term: c.term,
            conflictStrategy: st.fileConflictStrategy,
            options: assignmentOptions,
            cloudUserToken: (st.downloadMode === 'cloud' || st.downloadMode === 'both') ? snap.cloudUserToken ?? undefined : undefined,
            cloudDestRoot: st.cloudDestRoot
          })
          const successCount = r.results?.filter(x => x.ok).length ?? 0
          const failCount = (r.results?.length ?? 0) - successCount
          snap.applyProgress({
            taskId: assignTaskId,
            state: failCount > 0 ? 'error' : 'done',
            received: successCount,
            total: selAssignments.length,
            fileName: `${courseName} · 课程作业归档`,
            courseName,
            message: `作业: ${successCount}成功${failCount > 0 ? `，${failCount}失败` : ''}`
          })
          assignmentAggregateTaskId = assignTaskId
        } catch {
          snap.applyProgress({
            taskId: assignTaskId,
            state: 'error',
            received: 0,
            total: selAssignments.length,
            fileName: `${courseName} · 课程作业归档`,
            courseName,
            message: '作业归档失败'
          })
          assignmentAggregateTaskId = assignTaskId
        }
      }
    }
  }

  // 模块视频
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
      for (const t of mv.iframes) {
        const tid = iframeVideoTaskId(courseId, t.pageTitle)
        if (moduleVideoWanted || selected.has(tid)) {
          iframeTasks.push({ taskId: tid, iframeUrl: t.iframeUrl, baseName: moduleVideoBaseName(courseName, t.pageTitle) })
        }
      }
      const selExtTools = mv.extTools.filter(t => moduleVideoWanted || selected.has(extToolVideoTaskId(courseId, t.fileId)))
      const selExtUrls = mv.extUrls.filter(t => moduleVideoWanted || selected.has(extUrlVideoTaskId(courseId, t.uuid)))
      if (selExtTools.length > 0 || selExtUrls.length > 0) {
        try {
          const r = await window.api.canvas.moduleVideoDownload(courseName, courseId, selExtTools, selExtUrls, needsLocal ? st.localDestRoot : '', st.fileConflictStrategy, c.term || '')
          if (r.ok && r.specs) {
            const isAudioOnly = snap.videoQualityOption === 'audio_only'
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

  if (courseSpecs.length === 0 && iframeTasks.length === 0 && !pptAggregateTaskId && !assignmentAggregateTaskId && !transcriptAggregateTaskId) return { started: false, taskIds: [], localOnlyTaskIds: [] }
  if (cancelRequestedRef.current) return { started: false, taskIds: [], localOnlyTaskIds: [] }

  if (courseSpecs.length > 0) snap.addBatchTaskIds(courseSpecs.map(s => s.taskId))
  for (const spec of courseSpecs) {
    if (!snap.progress[spec.taskId]) {
      snap.applyProgress({ taskId: spec.taskId, state: 'pending', received: 0, total: 0 })
    }
  }

  if (iframeTasks.length > 0) snap.addBatchTaskIds(iframeTasks.map(m => m.taskId))
  for (const mvt of iframeTasks) {
    if (!snap.progress[mvt.taskId]) {
      snap.applyProgress({ taskId: mvt.taskId, state: 'pending', received: 0, total: 0, message: '排队中' })
    }
  }

  if (st.downloadMode === 'both') {
    const pairs: Record<string, string> = {}
    for (const spec of courseSpecs) pairs[spec.taskId] = spec.taskId + '_cloud'
    snap.setCloudLinkedIds(prev => ({ ...prev, ...pairs }))
  }

  let result: { ok: boolean; error?: string }
  try {
    const downloadOpts = {
      mode: st.downloadMode,
      conflictStrategy: st.fileConflictStrategy,
      localDestRoot: st.downloadMode !== 'cloud' ? st.localDestRoot : undefined,
      namingTemplate: st.namingTemplate,
      cloudDestRoot: st.cloudDestRoot,
      privateWorker: st.privateWorkerConfig
    }
    result = courseSpecs.length > 0
      ? await window.api.download.start(st.localDestRoot, courseSpecs, downloadOpts)
      : { ok: true }
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : 'IPC 通信失败' }
  }

  if (!result.ok) {
    snap.setCloudLinkedIds(prev => {
      const next = { ...prev }
      for (const spec of courseSpecs) delete next[spec.taskId]
      return next
    })
    for (const spec of courseSpecs) {
      snap.applyProgress({ taskId: spec.taskId, state: 'error', received: 0, total: 0, message: result.error || '启动失败' })
    }
    for (const mvt of iframeTasks) {
      snap.applyProgress({ taskId: mvt.taskId, state: 'cancelled', received: 0, total: 0, message: '本课程下载未启动' })
    }
    return { started: false, taskIds: [], localOnlyTaskIds: [] }
  }

  const localTaskIds = courseSpecs.filter(s => !s.taskId.endsWith('_cloud')).map(s => s.taskId)
  const localDestForIframe = st.downloadMode !== 'cloud' ? st.localDestRoot : ''

  for (const mvt of iframeTasks) {
    if (cancelRequestedRef.current) {
      snap.applyProgress({ taskId: mvt.taskId, state: 'cancelled', received: 0, total: 0, message: '已取消' })
      continue
    }
    const needsCloud = st.downloadMode === 'cloud' || st.downloadMode === 'both'
    const cloudToken = needsCloud ? snap.cloudUserToken ?? undefined : undefined
    try {
      const r = await window.api.canvas.downloadModuleVideoNow(
        courseName, mvt.iframeUrl, mvt.baseName, localDestForIframe, mvt.taskId,
        cloudToken, cloudToken ? st.fileConflictStrategy : undefined,
        snap.videoQualityOption,
        c.term || '',
        st.cloudDestRoot
      )
      if (r.ok) {
        if (r.skipped) {
          snap.applyProgress({ taskId: mvt.taskId, state: 'skipped', received: 0, total: 0, filePath: r.path, cloudPath: r.cloudPath, message: '已存在，跳过' })
        } else {
          snap.applyProgress({ taskId: mvt.taskId, state: 'done', received: 0, total: 0, filePath: r.path, cloudPath: r.cloudPath })
        }
      } else {
        snap.applyProgress({ taskId: mvt.taskId, state: 'error', received: 0, total: 0, message: r.error || 'HLS 下载失败' })
      }
    } catch (err) {
      snap.applyProgress({ taskId: mvt.taskId, state: 'error', received: 0, total: 0, message: err instanceof Error ? err.message : 'HLS 下载异常' })
    }
  }

  const iframeLocalOnly = (st.downloadMode === 'cloud') ? [] : iframeTasks.map(m => m.taskId)
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

/** 执行多课程批量下载主流程 */
export async function executeCanvasDownload(
  selected: Set<string>,
  cancelRequestedRef: { current: boolean }
): Promise<void> {
  const st = useAppStore.getState()
  if (st.downloading) return
  const hasCatSel = Object.values(st.canvasCourseCategorySelections).some(s => s && (s.files || s.teacher || s.ppt || s.moduleVideo || s.pptPdf || s.assignments))
  if (selected.size === 0 && !hasCatSel) return

  st.resetProgress()
  st.setDownloading(true)
  cancelRequestedRef.current = false

  const coursesToProcess = collectCourseIds(selected)
  for (const id of Object.keys(st.canvasCourseCategorySelections)) {
    const sel = st.canvasCourseCategorySelections[Number(id)]
    if (sel && (sel.files || sel.teacher || sel.ppt || sel.moduleVideo || sel.pptPdf || sel.assignments)) {
      coursesToProcess.add(Number(id))
    }
  }

  try {
    const allLocalTaskIds: string[] = []
    const allLocalOnlyTaskIds: string[] = []
    for (const id of coursesToProcess) {
      if (cancelRequestedRef.current) break
      const { started, taskIds, localOnlyTaskIds } = await processCourse(id, selected, cancelRequestedRef)
      if (cancelRequestedRef.current) break
      if (started && taskIds.length > 0) {
        allLocalTaskIds.push(...taskIds)
        allLocalOnlyTaskIds.push(...localOnlyTaskIds)
        useAppStore.getState().setCanvasCourseTaskIds(id, taskIds)

        const localOnlySet = new Set(localOnlyTaskIds)
        const queuedIds = taskIds.filter(t => !localOnlySet.has(t))
        const waitIds = st.downloadMode === 'both'
          ? [...queuedIds, ...queuedIds.map(t => t + '_cloud')]
          : queuedIds
        await waitForCourseCompletion(waitIds)
      }
      useAppStore.getState().deleteCanvasCourseData(id)
    }

    if (allLocalTaskIds.length > 0) {
      const progress = useAppStore.getState().progress
      const isBoth = useAppStore.getState().downloadMode === 'both'
      const localOnlySet = new Set(allLocalOnlyTaskIds)
      let done = 0
      let failed = 0
      for (const tid of allLocalTaskIds) {
        const localSt = progress[tid]?.state
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
  } catch (error) {
    const taskId = 'canvas_batch_error'
    st.addBatchTaskIds([taskId])
    st.applyProgress({ taskId, state: 'error', received: 0, total: 0, message: error instanceof Error ? error.message : '下载启动失败' })
  } finally {
    useAppStore.getState().markBatchPendingCancelled()
    useAppStore.getState().setDownloading(false)
    if (useAppStore.getState().downloadMode !== 'both') {
      useAppStore.getState().setCloudLinkedIds({})
    }
  }
}
