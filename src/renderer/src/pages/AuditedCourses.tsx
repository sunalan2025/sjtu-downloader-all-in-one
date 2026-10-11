import { useCallback, useEffect, useMemo, useRef, useState, memo, type MouseEvent } from 'react'
import { useAppStore, useDownloadStats, useEffectiveProgress } from '../store/app'
import { useShallow } from 'zustand/shallow'
import { Spinner } from '../components/Spinner'
import { useDownloadCompletion } from '../hooks/useSharedBrowserHooks'
import type {
  AuditCourseDetail,
  AuditCourseItem,
  AuditCourseVideo,
  Course,
  DownloadMode,
  DownloadTaskSpec,
  VideoTask
} from '@shared/types'
import {
  Chevron,
  CourseProgressSummary,
  GlobalCtrlButton,
  ProgressBar,
  SmallCheck,
  ItemCheckbox,
  FileTypeBadge,
  FolderIcon,
  LayoutModeSwitch,
  TaskCtrlButtons,
  TriCheckbox,
  triStateFromCount,
  formatBytes,
  type TriState
} from '../components/DownloadUI'

// 稳定空数组：避免 tasksByCourse[id] 缺失时每次渲染都生成新 [] 引用，破坏子组件 memo
const EMPTY_TASKS: VideoTask[] = []

export function AuditedCourses() {
  // PERF: batch related primitive selectors with useShallow to reduce selector calls per render
  const {
    setAuth, setStage, scanState, scanMessage, courses, tasksByCourse, selected,
    expandedCourses, cloudUserToken, downloadMode, localDestRoot,
    cloudLinkedIds, downloading, setScan, setCourses, setTasksForCourse,
    resetScanResults, setSelected, toggleSelect, toggleSelectMany, toggleExpand,
    setCloudLinkedIds, setDownloading, applyProgress,
    courseLayoutMode, setCourseLayoutMode
  } = useAppStore(useShallow(s => ({
    setAuth: s.setAuth,
    setStage: s.setStage,
    scanState: s.scanState,
    scanMessage: s.scanMessage,
    courses: s.courses,
    tasksByCourse: s.tasksByCourse,
    selected: s.selected,
    expandedCourses: s.expandedCourses,
    cloudUserToken: s.cloudUserToken,
    downloadMode: s.downloadMode,
    localDestRoot: s.localDestRoot,
    cloudLinkedIds: s.cloudLinkedIds,
    downloading: s.downloading,
    setScan: s.setScan,
    setCourses: s.setCourses,
    setTasksForCourse: s.setTasksForCourse,
    resetScanResults: s.resetScanResults,
    setSelected: s.setSelected,
    toggleSelect: s.toggleSelect,
    toggleSelectMany: s.toggleSelectMany,
    toggleExpand: s.toggleExpand,
    setCloudLinkedIds: s.setCloudLinkedIds,
    setDownloading: s.setDownloading,
    applyProgress: s.applyProgress,
    courseLayoutMode: s.courseLayoutMode,
    setCourseLayoutMode: s.setCourseLayoutMode
  })))

  // ── 辅助：both 模式下判断单个任务是否完成 / 出错 ──
  const isBothMode = downloadMode === 'both' && Object.keys(cloudLinkedIds).length > 0
  const [searchQuery, setSearchQuery] = useState('')
  const autoExpandedRef = useRef(false)

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

  // 首次拉取课程后，默认将课程卡片平铺展开
  useEffect(() => {
    if (!autoExpandedRef.current && courses.length > 0) {
      autoExpandedRef.current = true
      for (const c of courses) {
        if (!expandedCourses.has(c.id)) {
          toggleExpand(c.id)
        }
      }
    }
  }, [courses, expandedCourses, toggleExpand])

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
    setScan('scanning', '正在拉取课程列表…')
    try {
      const env = await window.api.vsjtu.scanAudit(1, 100)
      if (!env?.success) {
        const msg = env?.message || '拉取课程列表失败'
        if (msg.includes('未登录') || msg.includes('登录已过期')) {
          // 登录态失效：先清空扫描结果（scanState→idle）再跳登录页。
          // 用户在登录页扫码成功后 Browser 重新挂载，scanState=idle 会自动触发
          // runScan 重新完整加载课程列表（=「确认登陆之后重新完整加载」）。
          setAuth({ loggedIn: false })
          resetScanResults()
          setStage('login')
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
    setTasksForCourse,
    setAuth,
    setStage
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

  // 扫描结束默认全选（只执行一次，避免用户手动取消全选后又被 effect 重新勾上）
  const autoSelectedRef = useRef(false)
  useEffect(() => {
    if (scanState === 'done' && total > 0 && !autoSelectedRef.current) {
      autoSelectedRef.current = true
      setSelected(new Set(allTasks.map(t => t.taskId)))
    }
  }, [scanState, total, allTasks, setSelected])

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
        applyProgress({
          taskId: t.taskId,
          state: 'pending',
          received: 0,
          total: 0,
          message: '等待解析直链…'
        })
        specs.push({
          taskId: t.taskId,
          url: '',
          courseName: t.courseName,
          fileName: t.fileName,
          refId: t.refId,
          angle: t.angle
        })
      }
    }

    if (specs.length === 0) return
    setDownloading(true)
    // 记入本轮提交集，供 OverallProgressBar 精准统计 total/active
    useAppStore.getState().addBatchTaskIds(specs.map(s => s.taskId))

    if (downloadMode === 'both') {
      const mapping: Record<string, string> = { ...cloudLinkedIds }
      for (const spec of specs) mapping[spec.taskId] = spec.taskId + '_cloud'
      setCloudLinkedIds(mapping)
    } else {
      setCloudLinkedIds({})
    }

    // BUG FIX: wrap IPC call in try/catch. If the main process throws or IPC fails,
    // the promise rejection would otherwise be unhandled, leaving downloading=true permanently.
    let result: { ok: boolean; error?: string }
    try {
      result = await window.api.download.start('', specs, {
        mode: downloadMode,
        conflictStrategy: useAppStore.getState().fileConflictStrategy,
        localDestRoot: downloadMode !== 'cloud' ? localDestRoot : undefined
      })
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : 'IPC 通信失败' }
    }
    if (!result.ok) {
      setDownloading(false)
      setCloudLinkedIds({})
      for (const spec of specs) {
        applyProgress({
          taskId: spec.taskId,
          state: 'error',
          received: 0,
          total: 0,
          message: result.error || '下载启动失败'
        })
      }
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

          <LayoutModeSwitch
            mode={courseLayoutMode}
            onChange={setCourseLayoutMode}
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
          <div className="flex h-10 items-center gap-1.5 rounded-xl border border-bd bg-surface-2 px-3 text-xs font-medium text-text-2 shadow-2xs">
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

      <div className="flex-1 overflow-y-auto p-6">
        {scanState === 'scanning' && courses.length === 0 && <ScanningHero msg={scanMessage} />}
        {scanState === 'error' && (
          <ErrorHero msg={scanMessage} onRetry={() => void runScan()} />
        )}
        {scanState === 'done' && courses.length === 0 && <EmptyHero />}
        {scanState === 'done' && courses.length > 0 && filteredCourses.length === 0 && (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
            <div className="text-base font-medium text-text-1">没有匹配的旁听课程</div>
            <div className="mt-2 text-sm text-text-3">请尝试更改搜索关键词</div>
          </div>
        )}
        {filteredCourses.length > 0 && (
          <div className={courseLayoutMode === 'deck' ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 items-start" : "flex flex-col gap-4 max-w-5xl mx-auto w-full"}>
            {filteredCourses.map((c, idx) => (
              <div
                key={c.id}
                className="animate-fadeInUp"
                style={{ animationDelay: `${Math.min(idx, 8) * 40}ms`, animationFillMode: 'backwards' }}
              >
                <CourseSection
                  course={c}
                  tasks={tasksByCourse[c.id] ?? EMPTY_TASKS}
                  selected={selected}
                  expanded={expandedCourses.has(c.id)}
                  onToggle={onToggle}
                  onToggleMany={onToggleMany}
                  onToggleExpand={toggleExpand}
                  onPauseTask={onPauseTask}
                  onCancelTask={onCancelTask}
                  onResumeTask={onResumeTask}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 顶栏
// ─────────────────────────────────────────────────────────────

// PERF: memoize TopBar — receives only primitive props, avoids re-render when course list changes
const TopBar = memo(function TopBar({
  scanState,
  scanMessage,
  courseCount,
  total,
  onRefresh
}: {
  scanState: 'idle' | 'scanning' | 'done' | 'error'
  scanMessage: string
  courseCount: number
  total: number
  onRefresh: () => void
}) {
  return (
    <div className="no-drag flex items-center gap-4 border-b border-bd px-6 py-3">
      <div className="min-w-0 flex-1 truncate text-sm text-text-2">
        {scanState === 'scanning' && (
          <span className="inline-flex items-center gap-2">
            <Spinner size={14} /> {scanMessage}
          </span>
        )}
        {scanState === 'done' && courseCount > 0 && (
          <span>
            扫描完成 · {courseCount} 门课 · 共 {total} 节视频流（含教师 / PPT 两路）
          </span>
        )}
        {scanState === 'error' && <span className="text-warning">{scanMessage}</span>}
      </div>
      {scanState === 'done' && courseCount > 0 && (
        <button
          type="button"
          onClick={onRefresh}
          title="重新校验登录态并完整重载课程列表"
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-text-3 transition-colors duration-150 hover:bg-surface-2 hover:text-text-1"
        >
          刷新 ↻
        </button>
      )}
    </div>
  )
})

// ─────────────────────────────────────────────────────────────
// 操作条 — 双行布局，第一行选择/云盘/目录，第二行模式/并发/控制/下载
// ─────────────────────────────────────────────────────────────

function ActionBar({
  selectedCount,
  total,
  cloudUserToken,
  downloadMode,
  localDestRoot,
  downloading,
  onToggleAll,
  onDownload,
  onPauseAll,
  onResumeAll,
  onCancelAll
}: {
  selectedCount: number
  total: number
  cloudUserToken: string | null
  downloadMode: DownloadMode
  localDestRoot: string
  downloading: boolean
  onToggleAll: () => void
  onDownload: () => void
  onPauseAll: () => void
  onResumeAll: () => void
  onCancelAll: () => void
}) {
  const triState = triStateFromCount(selectedCount, total)

  const needsCloud = downloadMode === 'cloud' || downloadMode === 'both'
  const needsLocal = downloadMode === 'local' || downloadMode === 'both'
  const canStart = selectedCount > 0
    && !downloading
    && (!needsCloud || !!cloudUserToken)
    && (!needsLocal || !!localDestRoot)

  return (
    <div className="sticky top-0 z-10 no-drag flex items-center justify-between border-b border-bd bg-surface-1/95 backdrop-blur px-6 py-3 shadow-sm">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onToggleAll}
          className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-text-1 transition-colors duration-150 hover:bg-surface-2"
        >
          <TriCheckbox state={triState} size="lg" />
          <span>全选</span>
        </button>
        
        <div className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
          已选 {selectedCount} / {total} 节视频
        </div>
        
        <div className="h-4 w-px bg-bd-strong mx-2" />
      </div>

      <div className="flex items-center gap-3">
        {downloading && (
          <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1 mr-2">
            <GlobalCtrlButton kind="pause" onClick={onPauseAll} title="暂停全部下载任务" />
            <GlobalCtrlButton kind="resume" onClick={onResumeAll} title="继续全部下载任务" />
            <GlobalCtrlButton kind="cancel" onClick={onCancelAll} title="取消全部下载任务" />
          </div>
        )}

        <button
          type="button"
          onClick={onDownload}
          disabled={!canStart}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-6 text-sm font-semibold text-white shadow-glow-sm transition-all duration-200 hover:scale-[1.02] hover:bg-accent-light hover:shadow-glow active:scale-[0.98] disabled:scale-100 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-4 disabled:shadow-none disabled:opacity-60"
        >
          {downloading ? '进行中…' : `立即下载 (${selectedCount})`}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 课程卡片（可折叠） + 一讲一行（教师+PPT 合并）
// ─────────────────────────────────────────────────────────────

interface Lecture {
  videoId: number
  lectureLabel: string
  lectureDate?: string
  sort: number
  teacher?: VideoTask
  ppt?: VideoTask
}

function groupByLecture(tasks: VideoTask[]): Lecture[] {
  const map = new Map<number, Lecture>()
  for (const t of tasks) {
    let lec = map.get(t.videoId)
    if (!lec) {
      lec = {
        videoId: t.videoId,
        lectureLabel: t.lectureLabel,
        lectureDate: t.lectureDate,
        sort: t.sort
      }
      map.set(t.videoId, lec)
    }
    if (t.angle === 0) lec.teacher = t
    else if (t.angle === 3) lec.ppt = t
  }
  return [...map.values()].sort((a, b) => a.sort - b.sort)
}

const CourseSection = memo(function CourseSection({
  course,
  tasks,
  selected,
  expanded,
  onToggle,
  onToggleMany,
  onToggleExpand,
  onPauseTask,
  onCancelTask,
  onResumeTask
}: {
  course: Course
  tasks: VideoTask[]
  selected: Set<string>
  expanded: boolean
  onToggle: (id: string) => void
  onToggleMany: (ids: string[], on: boolean) => void
  onToggleExpand: (id: number) => void
  onPauseTask: (id: string) => void
  onCancelTask: (id: string) => void
  onResumeTask: (id: string) => void
}) {
  const ids = tasks.map(t => t.taskId)
  const selCount = tasks.reduce((n, t) => n + (selected.has(t.taskId) ? 1 : 0), 0)
  const triState = triStateFromCount(selCount, ids.length)
  const [videosSectionOpen, setVideosSectionOpen] = useState(true)

  const courseStats = useAppStore(
    useShallow(s => {
      const isBoth = s.downloadMode === 'both'
      let done = 0, downloading = 0, errors = 0, inflight = 0
      for (const t of tasks) {
        const prog = s.progress[t.taskId]
        const st = prog?.state
        const localDone = st === 'done' || st === 'skipped'
        if (isBoth) {
          const cloudId = s.cloudLinkedIds[t.taskId]
          const cloudSt = cloudId ? s.progress[cloudId]?.state : undefined
          const cloudDone = cloudSt === 'done' || cloudSt === 'skipped' || cloudSt === 'cancelled'
          const isLocalFinal = localDone || st === 'error' || st === 'cancelled'
          const isCloudFinal = !cloudId || cloudDone || cloudSt === 'error'
          if (localDone && (cloudDone || !cloudId)) done++
          else if (!isLocalFinal || !isCloudFinal) {
            if (st === 'error' || cloudSt === 'error') errors++
            else {
              downloading++
              if (st === 'downloading' && prog && prog.total > 0) inflight += Math.min(1, prog.received / prog.total)
              else if (localDone) inflight += 1
            }
          }
        } else {
          if (localDone) done++
          else if (st !== 'cancelled') {
            if (st === 'error') errors++
            else {
              downloading++
              if (st === 'downloading' && prog && prog.total > 0) inflight += Math.min(1, prog.received / prog.total)
            }
          }
        }
      }
      return { done, downloading, errors, inflight }
    })
  )
  const { done: doneCount, downloading: downloadingCount, errors: errorCount, inflight: inflightCount } = courseStats
  const lectures = useMemo(() => groupByLecture(tasks), [tasks])

  return (
    <section className="overflow-hidden rounded-2xl border border-bd bg-surface-1 shadow-card transition-shadow hover:shadow-card-hover flex flex-col">
      {/* 卡片头部 */}
      <header
        className="flex cursor-pointer select-none items-center gap-2.5 px-4 py-3 bg-surface-2/40 hover:bg-surface-2 transition-colors border-b border-bd/40"
        onClick={() => onToggleExpand(course.id)}
      >
        <FolderIcon className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 truncate font-semibold text-text-1 text-sm" title={course.name}>
          {course.name}
        </span>
        <Chevron open={expanded} />
      </header>

      {/* 进度条 */}
      <CourseProgressSummary done={doneCount} downloading={downloadingCount} errors={errorCount} inflight={inflightCount} total={ids.length} />

      {expanded && (
        <div className="flex flex-col animate-fadeIn">
          {/* 子区：课程视频 */}
          <div
            className="flex items-center justify-between px-4 py-2 bg-surface-2/20 hover:bg-surface-2/40 cursor-pointer select-none transition-colors border-b border-bd/30"
            onClick={() => setVideosSectionOpen(o => !o)}
          >
            <div className="flex items-center gap-2.5">
              <ItemCheckbox
                checked={triState === 'all'}
                onChange={() => onToggleMany(ids, triState !== 'all')}
              />
              <span className="text-xs font-semibold text-text-1">课程视频</span>
              {tasks.length > 0 && <span className="text-[11px] text-text-3 font-mono">({tasks.length})</span>}
            </div>
            <Chevron open={videosSectionOpen} />
          </div>

          {videosSectionOpen && (
            <div>
              {lectures.length === 0 ? (
                <div className="py-4 text-center text-xs text-text-4">暂无可下载视频</div>
              ) : (
                <ul className="divide-y divide-bd/20 max-h-72 overflow-y-auto">
                  {lectures.map(lec => (
                    <div key={lec.videoId}>
                      {lec.teacher && (
                        <AuditedVideoItemRow
                          task={lec.teacher}
                          selected={selected}
                          onToggle={onToggle}
                          badgeType="MP4"
                          label={`第${lec.sort}讲 教师 (MP4)`}
                          onPause={onPauseTask}
                          onCancel={onCancelTask}
                          onResume={onResumeTask}
                        />
                      )}
                      {lec.ppt && (
                        <AuditedVideoItemRow
                          task={lec.ppt}
                          selected={selected}
                          onToggle={onToggle}
                          badgeType="PPT"
                          label={`第${lec.sort}讲 PPT (MP4)`}
                          onPause={onPauseTask}
                          onCancel={onCancelTask}
                          onResume={onResumeTask}
                        />
                      )}
                    </div>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
})

const AuditedVideoItemRow = memo(function AuditedVideoItemRow({
  task,
  selected,
  onToggle,
  badgeType,
  label,
  onPause,
  onCancel,
  onResume
}: {
  task: VideoTask
  selected: Set<string>
  onToggle: (id: string) => void
  badgeType: string
  label: string
  onPause: (id: string) => void
  onCancel: (id: string) => void
  onResume: (id: string) => void
}) {
  const isOn = selected.has(task.taskId)
  const p = useEffectiveProgress(task.taskId)
  return (
    <li className="flex flex-col px-4 py-1.5 hover:bg-surface-2/50 transition-colors">
      <div className="flex items-center gap-2.5">
        <ItemCheckbox checked={isOn} onChange={() => onToggle(task.taskId)} />
        <FileTypeBadge type={badgeType} />
        <span className="min-w-0 flex-1 truncate text-xs text-text-1" title={label}>
          {label}
        </span>
        {task.lectureDate && (
          <span className="shrink-0 font-mono text-[11px] text-text-3 tabular-nums">
            {task.lectureDate.slice(5)}
          </span>
        )}
        {p && (
          <TaskCtrlButtons
            state={p.state}
            onPause={() => onPause(task.taskId)}
            onCancel={() => onCancel(task.taskId)}
            onResume={() => onResume(task.taskId)}
          />
        )}
      </div>
      {p && (p.state === 'downloading' || p.state === 'pending' || p.state === 'error' || p.state === 'paused') && (
        <div className="pl-6.5 pr-1 pt-1 pb-0.5">
          <ProgressBar p={p} />
        </div>
      )}
    </li>
  )
})

const LectureRow = memo(function LectureRow({
  lecture,
  selected,
  onToggle,
  onToggleMany,
  onPauseTask,
  onCancelTask,
  onResumeTask
}: {
  lecture: Lecture
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleMany: (ids: string[], on: boolean) => void
  onPauseTask: (id: string) => void
  onCancelTask: (id: string) => void
  onResumeTask: (id: string) => void
}) {
  const { teacher, ppt, lectureLabel, lectureDate } = lecture
  const ids = [teacher?.taskId, ppt?.taskId].filter(Boolean) as string[]
  const selCount = ids.reduce((n, id) => n + (selected.has(id) ? 1 : 0), 0)
  const triState = triStateFromCount(selCount, ids.length)

  return (
    <li className="flex items-center gap-4 px-5 py-3 transition-colors duration-100 hover:bg-surface-2">
      <span
        role="checkbox"
        aria-checked={triState === 'some' ? 'mixed' : triState === 'all'}
        onClick={() => onToggleMany(ids, triState !== 'all')}
        className="shrink-0 cursor-pointer"
      >
        <TriCheckbox state={triState} size="lg" />
      </span>
      <div className="flex w-44 shrink-0 items-baseline gap-2">
        <span className="text-sm font-medium text-text-1">{lectureLabel}</span>
        {lectureDate && (
          <span className="font-mono text-xs text-text-4">{lectureDate}</span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <AngleCell
          task={teacher}
          selected={selected}
          onToggle={onToggle}
          onPauseTask={onPauseTask}
          onCancelTask={onCancelTask}
          onResumeTask={onResumeTask}
        />
        <div className="h-6 w-px shrink-0 bg-surface-2" />
        <AngleCell
          task={ppt}
          selected={selected}
          onToggle={onToggle}
          onPauseTask={onPauseTask}
          onCancelTask={onCancelTask}
          onResumeTask={onResumeTask}
        />
      </div>
    </li>
  )
})

const AngleCell = memo(function AngleCell({
  task,
  selected,
  onToggle,
  onPauseTask,
  onCancelTask,
  onResumeTask
}: {
  task?: VideoTask
  selected: Set<string>
  onToggle: (id: string) => void
  onPauseTask: (id: string) => void
  onCancelTask: (id: string) => void
  onResumeTask: (id: string) => void
}) {
  // 订阅本任务的进度（both 模式下自动聚合本地+云端状态）
  const p = useEffectiveProgress(task?.taskId ?? '')
  if (!task) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-text-4">
        无视频
      </div>
    )
  }
  const isOn = selected.has(task.taskId)
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <button
        type="button"
        onClick={() => onToggle(task.taskId)}
        title={task.angle === 0 ? '教师视角：录制教师讲课画面的视频' : 'PPT视角：录制投影/课件画面的视频'}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition-all duration-150 hover:scale-[1.03] ${
          isOn
            ? task.angle === 0
              ? 'bg-info-bg text-info ring-info-ring'
              : 'bg-warning-bg text-warning ring-warning-ring'
            : task.angle === 0
              ? 'bg-info-bg/50 text-info/70 ring-info-ring/50 hover:bg-info-bg'
              : 'bg-warning-bg/50 text-warning/70 ring-warning-ring/50 hover:bg-warning-bg'
        }`}
      >
        <SmallCheck on={isOn} />
        {task.viewLabel}
      </button>
      <div className="min-w-0 flex-1">
        {p ? <ProgressBar p={p} /> : <div className="h-2 rounded-full bg-surface-3" />}
      </div>
      {p && (
        <TaskCtrlButtons
          state={p.state}
          onPause={() => onPauseTask(task.taskId)}
          onCancel={() => onCancelTask(task.taskId)}
          onResume={() => onResumeTask(task.taskId)}
        />
      )}
    </div>
  )
})

// PERF: memoize BatchAngleButton — receives only primitives + stable callback, avoids re-render on unrelated state changes
const BatchAngleButton = memo(function BatchAngleButton({
  label,
  state,
  selCount,
  total,
  onClick,
  accent
}: {
  label: string
  state: TriState
  selCount: number
  total: number
  onClick: (e: MouseEvent) => void
  accent: 'sky' | 'amber'
}) {
  const ring =
    accent === 'sky'
      ? state === 'none'
        ? 'ring-info-ring hover:ring-info text-info/70 hover:text-info'
        : 'ring-info text-info bg-info-bg'
      : state === 'none'
        ? 'ring-warning-ring hover:ring-warning text-warning/70 hover:text-warning'
        : 'ring-warning text-warning bg-warning-bg'
  const dot = accent === 'sky' ? 'bg-info' : 'bg-warning'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition-all duration-150 hover:scale-[1.03] ${ring}`}
      title={accent === 'sky' ? '批量选择/取消教师视角视频' : '批量选择/取消PPT视角视频'}
    >
      <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-current/40">
        {state === 'all' && (
          <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {state === 'some' && <span className="h-[2px] w-2 rounded-full bg-current" />}
      </span>
      <span>{label}</span>
      <span className="ml-0.5 inline-flex items-center gap-1 text-current/60">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="font-mono text-xs">
          {selCount}/{total}
        </span>
      </span>
    </button>
  )
})

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
        正在拉取你旁听的每门课程的视频列表，稍等几秒
      </div>
    </div>
  )
})

// PERF: memoize ErrorHero — pure render with stable onRetry callback
const ErrorHero = memo(function ErrorHero({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="relative mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-hero-radial opacity-60 blur-2xl" />
      <svg className="h-12 w-12 text-warning/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      <div className="mt-4 max-w-sm rounded-xl bg-warning-bg px-4 py-2.5 text-sm font-medium text-warning ring-1 ring-warning-ring">
        {msg}
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-5 text-sm font-semibold text-white shadow-glow-sm transition-all duration-200 hover:scale-[1.02] hover:bg-accent-light hover:shadow-glow active:scale-[0.98]"
      >
        重试扫描
      </button>
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
        taskId: `${course.id}_${e.id}_${angle}`,
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

