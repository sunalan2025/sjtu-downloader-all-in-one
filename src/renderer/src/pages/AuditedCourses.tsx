import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { useAppStore, useDownloadStats, useEffectiveProgress } from '../store/app'
import { useShallow } from 'zustand/shallow'
import { Spinner } from '../components/Spinner'
import { useDownloadCompletion } from '../hooks/useSharedBrowserHooks'
import { submitDownloadBatch } from '../download/submit'
import { auditedTaskId } from '../download/taskIds'
import { computeBatchStats } from '../download/progress'
import type {
  AuditCourseDetail,
  AuditCourseItem,
  AuditCourseVideo,
  Course,
  DownloadTaskSpec,
  VideoTask
} from '@shared/types'
import {
  GlobalCtrlButton,
  ProgressBar,
  NetdiskViewModeSwitch,
  TaskCtrlButtons,
  TriCheckbox,
  triStateFromCount
} from '../components/DownloadUI'
import {
  NetdiskCourseExplorer,
  type NetdiskNavState,
  type NetdiskCourseItem,
  type NetdiskCategoryItem,
  type NetdiskFileItem
} from '../components/NetdiskCourseExplorer'

// 稳定空数组：避免 tasksByCourse[id] 缺失时每次渲染都生成新 [] 引用，破坏子组件 memo
const EMPTY_TASKS: VideoTask[] = []

const AuditedItemProgress = memo(function AuditedItemProgress({
  tid,
  onPauseTask,
  onCancelTask,
  onResumeTask
}: {
  tid: string
  onPauseTask: (id: string) => void
  onCancelTask: (id: string) => void
  onResumeTask: (id: string) => void
}) {
  const p = useEffectiveProgress(tid)
  if (!p || (p.state !== 'downloading' && p.state !== 'pending' && p.state !== 'error' && p.state !== 'paused')) {
    return null
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-[80px]">
        <ProgressBar p={p} />
      </div>
      <TaskCtrlButtons
        state={p.state}
        onPause={() => onPauseTask(tid)}
        onCancel={() => onCancelTask(tid)}
        onResume={() => onResumeTask(tid)}
      />
    </div>
  )
})

export function AuditedCourses() {
  // PERF: batch related primitive selectors with useShallow to reduce selector calls per render
  const {
    setAuth, setStage, scanState, scanMessage, courses, tasksByCourse, selected,
    downloadMode,
    cloudLinkedIds, downloading, setScan, setCourses, setTasksForCourse,
    resetScanResults, setSelected, toggleSelect, toggleSelectMany,
    setDownloading,
    courseViewMode, setCourseViewMode,
    videoQualityOption
  } = useAppStore(useShallow(s => ({
    setAuth: s.setAuth,
    setStage: s.setStage,
    scanState: s.scanState,
    scanMessage: s.scanMessage,
    courses: s.courses,
    tasksByCourse: s.tasksByCourse,
    selected: s.selected,
    downloadMode: s.downloadMode,
    cloudLinkedIds: s.cloudLinkedIds,
    downloading: s.downloading,
    setScan: s.setScan,
    setCourses: s.setCourses,
    setTasksForCourse: s.setTasksForCourse,
    resetScanResults: s.resetScanResults,
    setSelected: s.setSelected,
    toggleSelect: s.toggleSelect,
    toggleSelectMany: s.toggleSelectMany,
    setDownloading: s.setDownloading,
    courseViewMode: s.courseViewMode,
    setCourseViewMode: s.setCourseViewMode,
    videoQualityOption: s.videoQualityOption
  })))

  // ── 辅助：both 模式下判断单个任务是否完成 / 出错 ──
  const isBothMode = downloadMode === 'both' && Object.keys(cloudLinkedIds).length > 0
  const [searchQuery, setSearchQuery] = useState('')
  const [navState, setNavState] = useState<NetdiskNavState>({ level: 'root' })

  // ── 搜索筛选 ──
  const filteredCourses = useMemo(() => {
    if (!searchQuery.trim()) return courses
    const q = searchQuery.trim().toLowerCase()
    return courses.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.courseCode && c.courseCode.toLowerCase().includes(q)) ||
      (c.teacher && c.teacher.toLowerCase().includes(q))
    )
  }, [courses, searchQuery])

  // PERF: stable key that only changes when the actual task arrays change (not just
  // the tasksByCourse object reference). This prevents allTasks from recomputing
  // when course A's tasks update but courses B/C/D's arrays are unchanged.
  const tasksKey = useMemo(() => {
    return courses.map(c => `${c.id}:${tasksByCourse[c.id]?.length ?? 0}`).join(',')
  }, [courses, tasksByCourse])
  // 把当前所有任务摊平一下，方便全选 / 计数
  const allTasks = useMemo(() => {
    const out: VideoTask[] = []
    for (const c of courses) out.push(...(tasksByCourse[c.id] ?? []))
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksKey])
  const total = allTasks.length
  const selectedCount = selected.size

  // 选中任务的 id 列表 —— 喂给 useDownloadStats 做编码统计，
  // 避免顶层订阅整个 progress map 导致每 2s 进度回调都重渲染 Browser + ActionBar
  const selectedTaskIds = useMemo(
    () => allTasks.filter(t => selected.has(t.taskId)).map(t => t.taskId),
    [allTasks, selected]
  )
  const stats = useDownloadStats(selectedTaskIds, isBothMode)

  // 进入页面自动扫描，防止 strict-mode 双调用用 ref 锁一下
  const scanStartedRef = useRef(false)
  const runScan = useCallback(async (): Promise<void> => {
    resetScanResults()
    setScan('scanning', '正在获取课程列表…')
    try {
      const env = await window.api.vsjtu.scanAudit(1, 100)
      if (!env?.success) {
        const msg = env?.message || (env as any)?.code || '获取课程列表失败'
        const isExpired =
          msg.includes('未登录') ||
          msg.includes('登录已过期') ||
          msg.includes('expired') ||
          (env as any)?.code === 'auth.authz.jwt.expired' ||
          (env as any)?.code === '401'

        if (isExpired) {
          setScan('error', '旁听课程认证凭据已失效，请重试或重新授权登录')
        } else {
          setScan('error', msg)
        }
        return
      }
      const rawList = (env.data as any)?.records ?? env.data?.list ?? []
      const records: AuditCourseItem[] = Array.isArray(rawList) ? rawList : []
      const approved = records.filter(r => r.applyStatus === 1)
      // 同一门课多次申请按 resourceId 去重，保留最近一条
      const dedup = new Map<number, Course>()
      for (const r of approved) {
        const res = (r.auditCourseResources && r.auditCourseResources[0]) || {}
        const rid = res.resourceId || r.id
        if (!rid) continue
        dedup.set(rid, {
          id: rid,
          applyId: r.id,
          name: r.subjName || res.courseName || '未命名课程',
          courseCode: r.subjCode,
          teacher: r.teacName,
          term: r.acteTerm,
          org: r.orgaName
        })
      }
      const list = Array.from(dedup.values())
      setCourses(list)

      if (list.length === 0) {
        setScan('done', '没有找到已批准的旁听课程')
        return
      }

      setScan('scanning', `正在扫描视频…0 / ${list.length}`)
      let done = 0
      // [R5] 课程详情分批控制并发（每批 5 个），避免瞬时并发击穿或触发 429
      const BATCH_SIZE = 5
      for (let i = 0; i < list.length; i += BATCH_SIZE) {
        const batch = list.slice(i, i + BATCH_SIZE)
        await Promise.all(
          batch.map(async c => {
            try {
              const det = await window.api.vsjtu.auditCourseDetail(c.id)
              if (det?.success && det.data) {
                const tasks = buildTasksForCourse(c, det.data)
                setTasksForCourse(c.id, tasks)
              } else {
                setTasksForCourse(c.id, [])
              }
            } catch {
              setTasksForCourse(c.id, [])
            } finally {
              done += 1
              setScan('scanning', `正在扫描视频…${done} / ${list.length}`)
            }
          })
        )
      }
      setScan('done')
    } catch (err) {
      setScan('error', '扫描出错：' + String(err))
    }
  }, [
    resetScanResults,
    setScan,
    setCourses,
    setTasksForCourse
  ])

  useEffect(() => {
    if (scanStartedRef.current) return
    if (scanState !== 'idle') return
    scanStartedRef.current = true
    void runScan()
  }, [runScan, scanState])

  // 刷新键（与好大学在线页一致）：重走 runScan。
  // scanAudit 调用即登录校验 —— 已登录则直接重载课程列表；
  // 登录态失效则 runScan 内部跳登录页，登录成功后回到本页自动重扫（见上方 resetScanResults 注释）。
  const onRefresh = useCallback((): void => {
    void runScan()
  }, [runScan])


  // 全任务都到 final 状态时收尾（使用共享 hook）
  // [Bug 29 Fix] 传入 skipWhenEmpty=true：当 selectedTaskIds 为空时不要立即判定完成，
  // 因为 main 进程中的任务可能仍在运行（用户取消全选不会取消已开始的任务）。
  useDownloadCompletion(selectedTaskIds, stats.active, true, stats.done, stats.failed)

  // [Bug Fix] 下载进行中锁定选择：selectedTaskIds 派生自实时 selected，若下载开始后
  // 用户取消勾选部分任务，selectedTaskIds 缩小，剩余选中项跑完就 active===0 →
  // useDownloadCompletion 提前把 downloading 置 false，而被取消勾选的任务仍在 main 里跑，
  // 随后还能再点开始触发与上一批 taskId 重叠的二次提交。下载期间禁用勾选即可根治。
  const onToggle = useCallback((id: string) => {
    if (downloading) return
    toggleSelect(id)
  }, [downloading, toggleSelect])
  const onToggleMany = useCallback((ids: string[], on: boolean) => {
    if (downloading) return
    toggleSelectMany(ids, on)
  }, [downloading, toggleSelectMany])

  const onToggleAll = (): void => {
    if (downloading) return
    if (selectedCount === total && total > 0) setSelected(new Set())
    else setSelected(new Set(allTasks.map(t => t.taskId)))
  }


  const onDownload = async (): Promise<void> => {
    if (selectedCount === 0 || downloading) return

    const chosen = allTasks.filter(t => selected.has(t.taskId))

    // 清空上一轮 batchTaskIds（不动 progress——progress 的 done 态用于下方跳过已完成），
    // 防 OverallProgressBar total 跨批次累积。
    useAppStore.getState().resetBatchTaskIds()

    // 按 lecture (videoId) 分组：一次 vod-info 同时解出教师 + PPT 两路
    const byLecture = new Map<number, VideoTask[]>()
    for (const t of chosen) {
      const arr = byLecture.get(t.videoId) ?? []
      arr.push(t)
      byLecture.set(t.videoId, arr)
    }

    // 构建需要处理的任务 spec：跳过已完全完成的（本地 done 且云端 done）
    const curProgress = useAppStore.getState().progress
    const specs: DownloadTaskSpec[] = []
    for (const items of byLecture.values()) {
      for (const t of items) {
        const localDone = curProgress[t.taskId]?.state === 'done' || curProgress[t.taskId]?.state === 'skipped'
        const cloudId = cloudLinkedIds[t.taskId]
        const cloudDone = !cloudId
          || curProgress[cloudId]?.state === 'done'
          || curProgress[cloudId]?.state === 'skipped'
        if (localDone && cloudDone) continue
        const isAudioOnly = useAppStore.getState().videoQualityOption === 'audio_only'
        // 在仅提取音频模式下，自动跳过无声/重复的 PPT 视角 (angle=3)，只保留教师视角 (angle=0)！
        if (isAudioOnly && t.angle === 3) continue
        const finalFileName = isAudioOnly ? t.fileName.replace(/\.mp4$/, '.m4a') : t.fileName

        specs.push({
          taskId: t.taskId,
          url: '',
          courseName: t.courseName,
          fileName: finalFileName,
          refId: t.refId,
          angle: t.angle,
          extractAudio: isAudioOnly
        })
      }
    }

    if (specs.length === 0) return
    setDownloading(true)

    // [Phase 1] 提交编排收口到领域层 submitDownloadBatch：占位 pending、
    // batchTaskIds、both 镜像、IPC 启动与失败回滚统一处理。
    const result = await submitDownloadBatch(specs, {
      isBothMode: downloadMode === 'both',
      existingCloudLinkedIds: cloudLinkedIds
    })
    if (!result.ok) {
      setDownloading(false)
    }
  }

  // 单任务 / 全局 控制
  const onPauseTask = useCallback((id: string) => {
    window.api.download.pause(id).catch(() => undefined)
  }, [])
  const onCancelTask = useCallback((id: string) => {
    window.api.download.cancel(id).catch(() => undefined)
  }, [])
  const onResumeTask = useCallback((id: string) => {
    window.api.download.resume(id).catch(() => undefined)
  }, [])
  const onPauseAll = useCallback(() => {
    window.api.download.pauseAll().catch(() => undefined)
  }, [])
  const onCancelAll = useCallback(() => {
    window.api.download.cancelAll().catch(() => undefined)
    // 幽灵兜底：cancelAll 后立即把本轮提交的非终态任务标 cancelled，兜底主进程漏发终态，
    // 让 useDownloadCompletion 的 activeCount 归零、downloading 解除。
    useAppStore.getState().markBatchPendingCancelled()
  }, [])
  const onResumeAll = useCallback(() => {
    window.api.download.resumeAll().catch(() => undefined)
  }, [])

  // completed/failed 直接取自 useDownloadStats 的编码结果，
  // 不再订阅整个 progress map（避免每 2s 进度回调重算 + 重渲染 ActionBar）
  // 下载进度统计改由 OverallProgressBar（订阅全局 progress map）统一展示

  const progressMap = useAppStore(s => s.progress)

  const netdiskCourses = useMemo<NetdiskCourseItem[]>(() => {
    return filteredCourses.map(c => {
      const tasks = tasksByCourse[c.id] ?? EMPTY_TASKS
      const taskIds = tasks.map(t => t.taskId)
      const selCount = tasks.filter(t => selected.has(t.taskId)).length
      const triState = triStateFromCount(selCount, tasks.length)

      // 教师实录与 PPT 画面
      const isAudioOnly = videoQualityOption === 'audio_only'
      const teacherTasks = tasks.filter(t => t.angle === 0)
      const pptTasks = tasks.filter(t => t.angle === 3)

      const teacherItems: NetdiskFileItem[] = teacherTasks.map(t => ({
        id: t.taskId,
        name: isAudioOnly
          ? `${c.name} - ${t.lectureLabel} (教师音频 M4A)`
          : `${c.name} - ${t.lectureLabel} (教师 MP4)`,
        type: isAudioOnly ? 'M4A' : 'MP4',
        date: t.lectureDate,
        selected: selected.has(t.taskId),
        onToggle: () => onToggle(t.taskId),
        renderExtra: (
          <AuditedItemProgress
            tid={t.taskId}
            onPauseTask={onPauseTask}
            onCancelTask={onCancelTask}
            onResumeTask={onResumeTask}
          />
        )
      }))

      const pptItems: NetdiskFileItem[] = pptTasks.map(t => ({
        id: t.taskId,
        name: isAudioOnly
          ? `${c.name} - ${t.lectureLabel} (PPT 纯画面/无独立音频)`
          : `${c.name} - ${t.lectureLabel} (PPT MP4)`,
        type: isAudioOnly ? 'DISABLED' : 'PPT',
        disabled: isAudioOnly,
        disabledReason: isAudioOnly ? '无独立音频流' : undefined,
        date: t.lectureDate,
        selected: isAudioOnly ? false : selected.has(t.taskId),
        onToggle: () => {
          if (isAudioOnly) return
          onToggle(t.taskId)
        },
        renderExtra: (
          <AuditedItemProgress
            tid={t.taskId}
            onPauseTask={onPauseTask}
            onCancelTask={onCancelTask}
            onResumeTask={onResumeTask}
          />
        )
      }))

      const teacherSelCount = teacherTasks.filter(t => selected.has(t.taskId)).length
      const pptSelCount = pptTasks.filter(t => selected.has(t.taskId)).length

      const categories: NetdiskCategoryItem[] = [
        {
          id: 'teacher',
          name: isAudioOnly ? '🎵 教师原声音频 (M4A)' : '👨‍🏫 教师实录 (MP4)',
          icon: isAudioOnly ? 'audio' : 'video',
          state: triStateFromCount(teacherSelCount, teacherTasks.length),
          onToggle: () => {
            const isAll = teacherSelCount === teacherTasks.length
            toggleSelectMany(teacherTasks.map(t => t.taskId), !isAll)
          },
          items: teacherItems,
          emptyMessage: isAudioOnly ? '暂无教师音频录像' : '暂无教师视角录像'
        },
        {
          id: 'ppt',
          name: isAudioOnly ? '📑 课堂PPT实录 (无独立音频)' : '📑 课堂PPT实录 (MP4)',
          icon: 'presentation',
          state: isAudioOnly ? 'none' : triStateFromCount(pptSelCount, pptTasks.length),
          disabled: isAudioOnly,
          disabledReason: isAudioOnly ? '无独立音频流' : undefined,
          onToggle: () => {
            if (isAudioOnly) return
            const isAll = pptSelCount === pptTasks.length
            toggleSelectMany(pptTasks.map(t => t.taskId), !isAll)
          },
          items: pptItems,
          emptyMessage: '暂无课堂PPT视角录像'
        }
      ]

      // 统计进度（[Phase 1] 收口到领域层 computeBatchStats，消除与 Canvas/Cnmooc 的三份手抄）
      let stats: ReturnType<typeof computeBatchStats> | undefined
      if (tasks.length > 0) {
        stats = computeBatchStats(
          tasks.map(t => t.taskId),
          progressMap,
          isBothMode ? cloudLinkedIds : {},
          isBothMode
        )
        // 未进入下载队列的任务不计入任何进度（与原实现语义一致：无进度条目的任务静默）
        const started = tasks.some(t => progressMap[t.taskId] !== undefined
          || (isBothMode && cloudLinkedIds[t.taskId] && progressMap[cloudLinkedIds[t.taskId]] !== undefined))
        if (!started) stats = undefined
      }

      return {
        id: c.id,
        name: c.name,
        code: c.courseCode,
        teacher: c.teacher,
        term: c.term,
        state: triState,
        itemCount: tasks.length,
        categories,
        onToggle: () => {
          onToggleMany(taskIds, triState !== 'all')
        },
        summary: stats && (stats.done > 0 || stats.active > 0 || stats.failed > 0)
          ? { done: stats.done, downloading: stats.active, errors: stats.failed, inflight: stats.inflight, total: stats.total }
          : undefined
      }
    })
  }, [
    filteredCourses, tasksByCourse, selected, progressMap, isBothMode,
    cloudLinkedIds, onToggleMany, onToggle, toggleSelectMany, onPauseTask, onCancelTask, onResumeTask,
    videoQualityOption
  ])

  const handleRelogin = useCallback(() => {
    setAuth({ loggedIn: false, expired: true })
    resetScanResults()
    setStage('login')
  }, [setAuth, resetScanResults, setStage])

  return (
    <div className="flex h-full w-full flex-col">
      {/* 顶部粘性操作栏 (搜索 + 刷新 + 已选统计 + 全选 + 立即下载) */}
      <div className="sticky top-0 z-10 no-drag flex flex-wrap items-center justify-between gap-3 border-b border-bd bg-surface-1 px-6 py-2.5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center">
            <svg className="pointer-events-none absolute left-3 h-4 w-4 text-text-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索旁听课程/教师..."
              className="h-10 w-48 rounded-xl border border-bd bg-surface-2 pl-9 pr-3 text-xs text-text-1 placeholder:text-text-4 shadow-2xs hover:border-bd-strong focus:w-60 focus:border-accent focus:outline-none transition-all duration-200"
            />
          </div>

          <NetdiskViewModeSwitch
            mode={courseViewMode}
            onChange={setCourseViewMode}
          />

          {scanState === 'scanning' && (
            <span className="inline-flex items-center gap-1.5 text-xs text-text-2">
              <Spinner size={12} /> {scanMessage}
            </span>
          )}

          {scanState === 'done' && courses.length > 0 && (
            <button
              type="button"
              onClick={onRefresh}
              title="重新校验登录态并完整重载课程列表"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-bd bg-surface-2 text-text-3 hover:border-bd-strong hover:bg-surface-1 hover:text-text-1 transition-all shadow-2xs cursor-pointer text-sm"
            >
              ↻
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-2">
            <span className="text-accent font-bold">☑</span>
            <span>已选 {selectedCount} / {total} 节视频</span>
          </div>

          <button
            type="button"
            onClick={onToggleAll}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-bd bg-surface-2 px-3.5 text-xs font-medium text-text-1 hover:border-bd-strong hover:bg-surface-1 transition-all shadow-2xs cursor-pointer"
          >
            <TriCheckbox state={triStateFromCount(selectedCount, total)} size="sm" />
            <span>已选全部</span>
          </button>

          {downloading && (
            <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
              <GlobalCtrlButton kind="pause" onClick={onPauseAll} title="暂停全部下载任务" />
              <GlobalCtrlButton kind="resume" onClick={onResumeAll} title="继续全部下载任务" />
              <GlobalCtrlButton kind="cancel" onClick={onCancelAll} title="取消全部下载任务" />
            </div>
          )}

          <button
            type="button"
            onClick={onDownload}
            disabled={selectedCount === 0 || downloading}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-5 text-xs font-semibold text-white shadow-glow-sm transition-all hover:scale-[1.02] hover:bg-accent-light active:scale-[0.98] disabled:scale-100 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-4 disabled:shadow-none disabled:opacity-60 cursor-pointer"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v13m0 0l-4-4m4 4l4-4M4 21h16" />
            </svg>
            <span>{downloading ? '进行中…' : `立即下载 (${selectedCount})`}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {scanState === 'scanning' && courses.length === 0 && <ScanningHero msg={scanMessage} />}
        {scanState === 'error' && (
          <ErrorHero msg={scanMessage} onRetry={() => void runScan()} onRelogin={handleRelogin} />
        )}
        {scanState === 'done' && courses.length === 0 && <EmptyHero />}
        {scanState === 'done' && courses.length > 0 && filteredCourses.length === 0 && (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center p-6">
            <div className="text-base font-medium text-text-1">没有匹配的旁听课程</div>
            <div className="mt-2 text-sm text-text-3">请尝试更改搜索关键词</div>
          </div>
        )}
        {filteredCourses.length > 0 && (
          <NetdiskCourseExplorer
            courses={netdiskCourses}
            viewMode={courseViewMode}
            navState={navState}
            onNavigate={setNavState}
            onStartDownload={() => void onDownload()}
          />
        )}
      </div>
    </div>
  )
}



// ─────────────────────────────────────────────────────────────
// Hero 占位
// ─────────────────────────────────────────────────────────────

// PERF: memoize ScanningHero — pure render, no state dependencies
const ScanningHero = memo(function ScanningHero({ msg }: { msg: string }) {
  return (
    <div className="relative mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-hero-radial opacity-70 blur-2xl" />
      <div className="relative">
        <Spinner size={32} />
      </div>
      <div className="mt-5 text-base font-medium text-text-1">{msg || '正在扫描…'}</div>
      <div className="mt-2 max-w-xs text-sm leading-relaxed text-text-3">
        正在获取你旁听的每门课程的视频列表，稍等几秒
      </div>
    </div>
  )
})

// PERF: memoize ErrorHero — pure render with stable onRetry callback
const ErrorHero = memo(function ErrorHero({
  msg,
  onRetry,
  onRelogin
}: {
  msg: string
  onRetry: () => void
  onRelogin?: () => void
}) {
  const isAuthIssue = msg.includes('失效') || msg.includes('过期') || msg.includes('登录')
  return (
    <div className="relative mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-hero-radial opacity-60 blur-2xl" />
      <svg className="h-12 w-12 text-warning/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      <div className="mt-4 max-w-sm rounded-xl bg-warning-bg px-4 py-2.5 text-sm font-medium text-warning ring-1 ring-warning-ring">
        {msg}
      </div>
      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-5 text-sm font-semibold text-white shadow-glow-sm transition-all duration-200 hover:scale-[1.02] hover:bg-accent-light hover:shadow-glow active:scale-[0.98] cursor-pointer"
        >
          重试扫描
        </button>
        {isAuthIssue && onRelogin && (
          <button
            type="button"
            onClick={onRelogin}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-bd bg-surface-2 px-4 text-sm font-medium text-text-1 shadow-2xs transition-all duration-200 hover:bg-surface-1 hover:border-bd-strong active:scale-[0.98] cursor-pointer"
          >
            重新登录授权
          </button>
        )}
      </div>
    </div>
  )
})

// PERF: memoize EmptyHero — zero props, prevents unnecessary subtree diffing
const EmptyHero = memo(function EmptyHero() {
  return (
    <div className="relative mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-hero-radial opacity-50 blur-2xl" />
      <svg className="h-12 w-12 text-text-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
        <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
      </svg>
      <div className="mt-4 text-xl font-bold text-text-1">没有找到旁听课程</div>
      <div className="mt-3 max-w-xs text-sm leading-relaxed text-text-3">
        请确认你已成功旁听了至少一门课程，且申请已通过审核。
      </div>
    </div>
  )
})



// ─────────────────────────────────────────────────────────────
// 数据处理
// ─────────────────────────────────────────────────────────────

/** 从 audit-course-detail 的 videos[] 生成任务列表：
 *  每节课产 2 条（教师 angle=0 + PPT angle=3）。
 *  按 (sortTime, sort, id) 时间顺序重排后重新编号为 第1讲...第N讲，
 *  原始 sort 经常有错乱（同一门课的"第11讲"出现两次但日期不同），
 *  统一按时间序号显示能消除歧义并保持稳定。 */
function buildTasksForCourse(course: Course, detail: AuditCourseDetail): VideoTask[] {
  const entries: AuditCourseVideo[] = Array.isArray(detail.videos) ? detail.videos : []
  const released = entries.filter(e => e.releaseStatus === undefined || e.releaseStatus === 1)

  const sorted = [...released].sort((a, b) => {
    const ta = a.sortTime ?? ''
    const tb = b.sortTime ?? ''
    if (ta !== tb) return ta.localeCompare(tb)
    const sa = a.sort ?? 0
    const sb = b.sort ?? 0
    if (sa !== sb) return sa - sb
    return (a.id ?? 0) - (b.id ?? 0)
  })

  const out: VideoTask[] = []
  sorted.forEach((e, idx) => {
    const lectureNo = idx + 1
    const lectureLabel = `第${lectureNo}讲`
    const lectureDate = e.sortTime
    for (const [angle, viewLabel] of [
      [0, '教师'],
      [3, 'PPT']
    ] as const) {
      out.push({
        // [Phase 1] taskId 生成收口到领域层工厂（原字符串拼接的 1/12 处）
        taskId: auditedTaskId(course.id, e.id, angle),
        courseId: course.id,
        videoId: e.id,
        refId: e.refId,
        angle,
        viewLabel,
        lectureLabel,
        lectureDate,
        sort: lectureNo,
        sortTime: e.sortTime,
        fileName: buildFileName(lectureLabel, viewLabel),
        courseName: [course.name, course.teacher || '未署名'].filter(Boolean).join('-'),
        teacher: course.teacher || '',
        term: course.term || ''
      })
    }
  })
  return out
}

/** 文件夹名规则：课程名-教师-学期（在 buildTasksForCourse 中设置） */
/** 文件名规则：第N讲-视角.mp4 */
function buildFileName(lectureLabel: string, viewLabel: '教师' | 'PPT'): string {
  return `${lectureLabel}-${viewLabel}.mp4`
}

export { AuditedCourses as Browser }

