import { useCallback, useEffect, useMemo, useRef, memo, type MouseEvent } from 'react'
import { useAppStore, useDownloadStats, useEffectiveProgress } from '../store/app'
import { useShallow } from 'zustand/shallow'
import { Spinner } from '../components/Spinner'
import { useCachedCloudTokenValidation, useCloudConnection, useDownloadCompletion } from '../hooks/useSharedBrowserHooks'
import type {
  AuditCourseDetail,
  AuditCourseItem,
  AuditCourseVideo,
  Course,
  DownloadMode,
  DownloadTaskSpec,
  FileConflictStrategy,
  VideoTask
} from '@shared/types'
import {
  Chevron,
  ConflictStrategySegmented,
  CourseProgressSummary,
  GlobalCtrlButton,
  ModeSegmented,
  ProgressBar,
  SmallCheck,
  TaskCtrlButtons,
  TriCheckbox,
  triStateFromCount,
  type TriState
} from '../components/DownloadUI'

// 稳定空数组：避免 tasksByCourse[id] 缺失时每次渲染都生成新 [] 引用，破坏子组件 memo
const EMPTY_TASKS: VideoTask[] = []

export function Browser() {
  // PERF: batch related primitive selectors with useShallow to reduce selector calls per render
  const {
    setAuth, setStage, scanState, scanMessage, courses, tasksByCourse, selected,
    expandedCourses, cloudUserToken, cloudSpaceInfo, downloadMode, fileConflictStrategy, localDestRoot,
    cloudLinkedIds, downloading, setScan, setCourses, setTasksForCourse,
    resetScanResults, setSelected, toggleSelect, toggleSelectMany, toggleExpand,
    setDownloadMode, setFileConflictStrategy, setLocalDestRoot,
    setCloudLinkedIds, setDownloading, applyProgress
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
    cloudSpaceInfo: s.cloudSpaceInfo,
    downloadMode: s.downloadMode,
    fileConflictStrategy: s.fileConflictStrategy,
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
    setDownloadMode: s.setDownloadMode,
    setFileConflictStrategy: s.setFileConflictStrategy,
    setLocalDestRoot: s.setLocalDestRoot,
    setCloudLinkedIds: s.setCloudLinkedIds,
    setDownloading: s.setDownloading,
    applyProgress: s.applyProgress
  })))

  // ── 共享 hooks ──
  useCachedCloudTokenValidation()
  // [2.15] useDownloadProgressSubscription moved to App level — removed here
  const { cloudConn, onConnectCloud, onDisconnectCloud } = useCloudConnection()

  // ── 辅助：both 模式下判断单个任务是否完成 / 出错 ──
  const isBothMode = downloadMode === 'both' && Object.keys(cloudLinkedIds).length > 0

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
      const records: AuditCourseItem[] = env.data?.list ?? []
      const approved = records.filter(r => r.applyStatus === 1)
      // 同一门课多次申请按 resourceId 去重，保留最近一条
      const dedup = new Map<number, Course>()
      for (const r of approved) {
        const rid = r.auditCourseResources?.[0]?.resourceId
        if (!rid) continue
        dedup.set(rid, {
          id: rid,
          applyId: r.id,
          name: r.subjName || '未命名课程',
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
      // 课程详情可以并发拉，每完成一个就更新进度
      await Promise.all(
        list.map(async c => {
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

  const onSelectLocalFolder = async (): Promise<void> => {
    const path = await window.api.selectFolder()
    if (path) setLocalDestRoot(path)
  }

  const onDownload = async (): Promise<void> => {
    if (selectedCount === 0 || downloading) return

    const chosen = allTasks.filter(t => selected.has(t.taskId))

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
        conflictStrategy: fileConflictStrategy,
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
  }, [])
  const onResumeAll = useCallback(() => {
    window.api.download.resumeAll().catch(() => undefined)
  }, [])

  // completed/failed 直接取自 useDownloadStats 的编码结果，
  // 不再订阅整个 progress map（避免每 2s 进度回调重算 + 重渲染 ActionBar）
  const completed = stats.done
  const failed = stats.failed

  return (
    <div className="flex h-full w-full flex-col">
      <TopBar
        scanState={scanState}
        scanMessage={scanMessage}
        courseCount={courses.length}
        total={total}
        onRefresh={onRefresh}
      />

      {scanState === 'done' && total > 0 && (
        <ActionBar
          selectedCount={selectedCount}
          total={total}
          cloudUserToken={cloudUserToken}
          cloudSpaceInfo={cloudSpaceInfo}
          cloudConnecting={cloudConn.status === 'connecting'}
          cloudError={cloudConn.status === 'error' ? cloudConn.message : null}
          downloadMode={downloadMode}
          fileConflictStrategy={fileConflictStrategy}
          localDestRoot={localDestRoot}
          downloading={downloading}
          completed={completed}
          failed={failed}
          onToggleAll={onToggleAll}
          onConnectCloud={onConnectCloud}
          onDisconnectCloud={onDisconnectCloud}
          onDownload={onDownload}
          onSelectLocalFolder={onSelectLocalFolder}
          onModeChange={setDownloadMode}
          onConflictStrategyChange={setFileConflictStrategy}
          onPauseAll={onPauseAll}
          onResumeAll={onResumeAll}
          onCancelAll={onCancelAll}
        />
      )}

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {scanState === 'scanning' && <ScanningHero msg={scanMessage} />}
        {scanState === 'error' && (
          <ErrorHero msg={scanMessage} onRetry={() => void runScan()} />
        )}
        {scanState === 'done' && courses.length === 0 && <EmptyHero />}
        {scanState === 'done' && courses.length > 0 && (
          <div className="flex flex-col gap-4">
            {courses.map((c, idx) => (
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
  cloudSpaceInfo,
  cloudConnecting,
  cloudError,
  downloadMode,
  fileConflictStrategy,
  localDestRoot,
  downloading,
  completed,
  failed,
  onToggleAll,
  onConnectCloud,
  onDisconnectCloud,
  onDownload,
  onSelectLocalFolder,
  onModeChange,
  onConflictStrategyChange,
  onPauseAll,
  onResumeAll,
  onCancelAll
}: {
  selectedCount: number
  total: number
  cloudUserToken: string | null
  cloudSpaceInfo: import('@shared/types').CloudPanSpaceInfo | null
  cloudConnecting: boolean
  cloudError: string | null
  downloadMode: DownloadMode
  fileConflictStrategy: FileConflictStrategy
  localDestRoot: string
  downloading: boolean
  completed: number
  failed: number
  onToggleAll: () => void
  onConnectCloud: () => void
  onDisconnectCloud: () => void
  onDownload: () => void
  onSelectLocalFolder: () => void
  onModeChange: (m: DownloadMode) => void
  onConflictStrategyChange: (s: FileConflictStrategy) => void
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

  const btnLabel = downloading
    ? '进行中…'
    : downloadMode === 'local'
      ? `开始下载 ${selectedCount} 项`
      : downloadMode === 'cloud'
        ? `开始上传 ${selectedCount} 项`
        : `开始下载+上传 ${selectedCount} 项`

  return (
    <div className="no-drag border-b border-bd bg-surface-3 px-6 py-3">
      {/* 第一行：选择 + 云盘/目录 + 进度 + 模式/并发/帮助 */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onToggleAll}
          className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-text-1 transition-colors duration-150 hover:bg-surface-2 hover:text-text-1"
        >
          <TriCheckbox state={triState} size="lg" />
          <span>
            全选 <span className="text-text-3">({selectedCount} / {total})</span>
          </span>
        </button>

        <div className="h-4 w-px bg-bd-strong" />

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {needsCloud && cloudUserToken ? (
            <button
              type="button"
              onClick={onDisconnectCloud}
              className="inline-flex max-w-full items-center gap-2 rounded-lg border border-info-ring bg-info-bg px-3 py-1.5 text-xs font-medium text-info transition-all duration-150 hover:border-cloud-40 hover:text-cloud"
              title="点击断开云盘连接"
            >
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
          ) : needsCloud && cloudConnecting ? (
            <span className="inline-flex items-center gap-2 text-xs text-info">
              <Spinner size={14} />
              正在连接交大云盘…
            </span>
          ) : needsCloud ? (
            <button
              type="button"
              onClick={onConnectCloud}
              className="inline-flex max-w-full items-center gap-2 rounded-lg border border-bd-strong bg-surface-3 px-3 py-1.5 text-xs text-text-2 transition-all duration-150 hover:border-info-ring hover:text-info"
              title="通过 jAccount 单点登录连接交大云盘，用于上传视频文件"
            >
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
              </svg>
              <span>连接交大云盘</span>
            </button>
          ) : null}
          {cloudError && !cloudConnecting && !cloudUserToken && needsCloud && (
            <span className="text-xs text-warning">{cloudError}</span>
          )}

          {needsLocal && (
            <button
              type="button"
              onClick={onSelectLocalFolder}
              className="inline-flex max-w-full items-center gap-2 rounded-lg border border-bd-strong bg-surface-3 px-3 py-1.5 text-xs text-text-2 transition-all duration-150 hover:border-success-ring hover:text-success"
              title="选择视频保存的本地文件夹，未选择时使用系统默认下载目录"
            >
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span className="truncate max-w-[180px]">
                {localDestRoot || '选择下载目录'}
              </span>
            </button>
          )}

          {downloading && (
            <div className="flex items-center gap-3 rounded-lg bg-surface-3 px-3 py-1.5 text-xs">
              <span className="text-text-2">
                完成 <span className="font-medium text-success">{completed}</span> / {selectedCount}
              </span>
              {failed > 0 && (
                <span className="text-warning">失败 {failed}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ModeSegmented value={downloadMode} onChange={onModeChange} />
          <ConflictStrategySegmented value={fileConflictStrategy} onChange={onConflictStrategyChange} />
        </div>
      </div>

      {/* 第二行：全局控制 + 开始按钮（右对齐，与首行右侧对齐） */}
      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-3">
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
          disabled={!canStart}
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-white shadow-glow-sm transition-all duration-200 hover:scale-[1.02] hover:bg-accent-light hover:shadow-glow active:scale-[0.98] disabled:scale-100 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-4 disabled:shadow-none disabled:opacity-60"
        >
          {btnLabel}
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
  const teacherIds = tasks.filter(t => t.angle === 0).map(t => t.taskId)
  const pptIds = tasks.filter(t => t.angle === 3).map(t => t.taskId)
  const selCount = tasks.reduce((n, t) => n + (selected.has(t.taskId) ? 1 : 0), 0)
  const teacherSel = teacherIds.reduce((n, id) => n + (selected.has(id) ? 1 : 0), 0)
  const pptSel = pptIds.reduce((n, id) => n + (selected.has(id) ? 1 : 0), 0)
  const triState = triStateFromCount(selCount, ids.length)
  const teacherTri = triStateFromCount(teacherSel, teacherIds.length)
  const pptTri = triStateFromCount(pptSel, pptIds.length)
  // 单次遍历编码 done/dl/err 三个计数，避免两个 selector 各扫一遍 tasks
  const courseStats = useAppStore(s => {
    const isBoth = s.downloadMode === 'both'
    let done = 0, downloading = 0, errors = 0
    for (const t of tasks) {
      const st = s.progress[t.taskId]?.state
      const localDone = st === 'done' || st === 'skipped'
      if (isBoth) {
        const cloudId = s.cloudLinkedIds[t.taskId]
        const cloudSt = cloudId ? s.progress[cloudId]?.state : undefined
        const cloudDone = cloudSt === 'done' || cloudSt === 'skipped'
        const isLocalFinal = localDone || st === 'cancelled'
        const isCloudFinal = !cloudId || cloudDone || cloudSt === 'cancelled'
        if (localDone && (cloudDone || !cloudId)) done++
        else if (!isLocalFinal || !isCloudFinal) {
          if (st === 'error' || cloudSt === 'error') errors++
          else downloading++
        }
      } else {
        if (localDone) done++
        else if (st !== 'cancelled') {
          if (st === 'error') errors++
          else downloading++
        }
      }
    }
    return done * 1_000_000 + downloading * 1000 + errors
  })
  const doneCount = Math.floor(courseStats / 1_000_000)
  const downloadingCount = Math.floor(courseStats / 1000) % 1000
  const errorCount = courseStats % 1000
  const lectures = useMemo(() => groupByLecture(tasks), [tasks])

  return (
    <section className="overflow-hidden rounded-2xl border border-bd bg-surface-3 shadow-card transition-shadow duration-200 hover:shadow-card-hover">
      <header
        className="flex cursor-pointer select-none items-center gap-4 px-5 py-4 transition-colors duration-150 hover:bg-surface-2"
        onClick={() => onToggleExpand(course.id)}
      >
        <Chevron open={expanded} />
        <span
          role="checkbox"
          aria-checked={triState === 'some' ? 'mixed' : triState === 'all'}
          tabIndex={0}
          onClick={e => {
            e.stopPropagation()
            onToggleMany(ids, triState !== 'all')
          }}
          onKeyDown={e => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation()
              onToggleMany(ids, triState !== 'all')
            }
          }}
          className="shrink-0"
        >
          <TriCheckbox state={triState} size="lg" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="line-clamp-1 text-base font-semibold text-text-1">{course.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-3">
            {course.courseCode && (
              <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs text-text-2">
                {course.courseCode}
              </span>
            )}
            {course.teacher && <span>{course.teacher}</span>}
            {course.teacher && course.term && <span className="text-text-4">·</span>}
            {course.term && <span>{course.term}</span>}
          </div>
        </div>

        <div
          className="flex shrink-0 items-center gap-2"
          onClick={e => e.stopPropagation()}
        >
          {teacherIds.length > 0 && (
            <BatchAngleButton
              label="教师"
              state={teacherTri}
              selCount={teacherSel}
              total={teacherIds.length}
              accent="sky"
              onClick={() => onToggleMany(teacherIds, teacherTri !== 'all')}
            />
          )}
          {pptIds.length > 0 && (
            <BatchAngleButton
              label="PPT"
              state={pptTri}
              selCount={pptSel}
              total={pptIds.length}
              accent="amber"
              onClick={() => onToggleMany(pptIds, pptTri !== 'all')}
            />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 text-xs text-text-3">
          <span>
            {lectures.length} 讲 · 已选 <span className="font-medium text-text-1">{selCount}</span> /{' '}
            {ids.length}
          </span>
        </div>
      </header>

      <CourseProgressSummary done={doneCount} downloading={downloadingCount} errors={errorCount} total={ids.length} />

      {expanded && (
        <div className="animate-fadeIn origin-top">
        {lectures.length === 0 ? (
          <div className="border-t border-bd px-5 py-5 text-center text-sm text-text-3">
            该课程暂无可下载视频
          </div>
        ) : (
          <ul className="divide-y divide-bd border-t border-bd">
            {lectures.map(lec => (
              <LectureRow
                key={lec.videoId}
                lecture={lec}
                selected={selected}
                onToggle={onToggle}
                onToggleMany={onToggleMany}
                onPauseTask={onPauseTask}
                onCancelTask={onCancelTask}
                onResumeTask={onResumeTask}
              />
            ))}
          </ul>
        )}
        </div>
      )}
    </section>
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
        请确认你在 v.sjtu.edu.cn 已成功旁听了至少一门课程，且申请已通过审核。
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
