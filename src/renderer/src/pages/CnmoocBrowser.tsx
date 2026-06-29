import { useCallback, useEffect, useMemo, useRef, memo } from 'react'
import { useShallow } from 'zustand/shallow'
import { useAppStore, useDownloadStats, useEffectiveProgress } from '../store/app'
import {
  useCloudConnection,
  useDownloadCompletion
} from '../hooks/useSharedBrowserHooks'
import { prefetchCnmoocCourses } from '../services/prefetch'
import {
  Chevron,
  ConflictStrategySegmented,
  CourseProgressSummary,
  GlobalCtrlButton,
  ModeSegmented,
  ProgressBar,
  ResourceTypeSegmented,
  SmallCheck,
  TaskCtrlButtons,
  TriCheckbox,
  triStateFromCount,
  type TriState
} from '../components/DownloadUI'
import { Spinner } from '../components/Spinner'
import type {
  CnmoocChapter,
  CnmoocCourse,
  CnmoocItem,
  CnmoocResourceFilter,
  CnmoocSelectedItem,
  DownloadMode,
  DownloadTaskSpec,
  FileConflictStrategy
} from '@shared/types'

// cnmooc 任务 taskId 模板：`cnmooc_{courseId}_{itemId}`（courseId/itemId 均为字符串）
const makeTid = (courseId: string, itemId: string): string => `cnmooc_${courseId}_${itemId}`

const EMPTY_CHAPTERS: CnmoocChapter[] = []

export function CnmoocBrowser() {
  const { onConnectCloud, onDisconnectCloud } = useCloudConnection()

  const {
    courses,
    scanState,
    scanMessage,
    courseData,
    expanded,
    selected,
    cloudUserToken,
    cloudSpaceInfo,
    cloudConnStatus,
    cloudConnMessage,
    downloadMode,
    fileConflictStrategy,
    localDestRoot,
    resourceFilter,
    downloading,
    toggleExpand,
    setSelected,
    toggleSelect,
    toggleSelectMany,
    setDownloadMode,
    setFileConflictStrategy,
    setResourceFilter,
    setLocalDestRoot,
    setDownloading,
    setCloudLinkedIds,
    resetProgress
  } = useAppStore(
    useShallow(s => ({
      courses: s.cnmoocCourses,
      scanState: s.cnmoocScanState,
      scanMessage: s.cnmoocScanMessage,
      courseData: s.cnmoocCourseData,
      expanded: s.cnmoocExpandedCourses,
      selected: s.selected,
      cloudUserToken: s.cloudUserToken,
      cloudSpaceInfo: s.cloudSpaceInfo,
      cloudConnStatus: s.cloudConnStatus,
      cloudConnMessage: s.cloudConnMessage,
      downloadMode: s.downloadMode,
      fileConflictStrategy: s.fileConflictStrategy,
      localDestRoot: s.localDestRoot,
      resourceFilter: s.cnmoocResourceFilter,
      downloading: s.downloading,
      toggleExpand: s.toggleCnmoocExpand,
      setSelected: s.setSelected,
      toggleSelect: s.toggleSelect,
      toggleSelectMany: s.toggleSelectMany,
      setDownloadMode: s.setDownloadMode,
      setFileConflictStrategy: s.setFileConflictStrategy,
      setResourceFilter: s.setCnmoocResourceFilter,
      setLocalDestRoot: s.setLocalDestRoot,
      setDownloading: s.setDownloading,
      setCloudLinkedIds: s.setCloudLinkedIds,
      resetProgress: s.resetProgress
    }))
  )

  // 摊平所有条目的 taskId（用于全选 / 计数 / 统计）。依赖 courses + courseData 引用。
  const dataKey = useMemo(
    () => courses.map(c => `${c.courseId}:${courseData[c.courseId]?.chapters.length ?? 0}`).join(','),
    [courses, courseData]
  )
  const allTaskIds = useMemo(() => {
    const out: string[] = []
    for (const c of courses) {
      const chapters = courseData[c.courseId]?.chapters ?? EMPTY_CHAPTERS
      for (const ch of chapters) for (const it of ch.items) out.push(makeTid(c.courseId, it.itemId))
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey])
  const total = allTaskIds.length
  const selectedCount = selected.size

  const selectedTaskIds = useMemo(
    () => allTaskIds.filter(id => selected.has(id)),
    [allTaskIds, selected]
  )
  const isBothMode = downloadMode === 'both'
  const stats = useDownloadStats(selectedTaskIds, isBothMode)
  const applyProgress = useAppStore(s => s.applyProgress)

  // ─── 扫描：课程列表 + 并行拉取每门课章节（仅 HTML，不预探直链） ───
  // 逻辑提取到 services/prefetch.ts，登录后 App.tsx 也会调它预加载。
  // 刷新时前置 resetProgress 清进度；登录预加载（无进度）由 prefetch 内部不调 resetProgress。
  const scanStartedRef = useRef(false)
  const runScan = useCallback(async (): Promise<void> => {
    resetProgress()
    await prefetchCnmoocCourses()
  }, [resetProgress])

  useEffect(() => {
    if (scanStartedRef.current) return
    if (scanState !== 'idle') return
    scanStartedRef.current = true
    void runScan()
  }, [runScan, scanState])

  // 扫描结束默认全选（只执行一次）
  const autoSelectedRef = useRef(false)
  useEffect(() => {
    if (scanState === 'done' && total > 0 && !autoSelectedRef.current) {
      autoSelectedRef.current = true
      setSelected(new Set(allTaskIds))
    }
  }, [scanState, total, allTaskIds, setSelected])

  // 全部任务到终态时收尾（单源扁平列表，复用 hook 形式）
  useDownloadCompletion(selectedTaskIds, stats.active, true, stats.done, stats.failed)

  // 下载进行中锁定选择（同 Browser：避免取消勾选导致 completion 误判）
  const onToggle = useCallback((id: string) => {
    if (useAppStore.getState().downloading) return
    toggleSelect(id)
  }, [toggleSelect])
  const onToggleMany = useCallback((ids: string[], on: boolean) => {
    if (useAppStore.getState().downloading) return
    toggleSelectMany(ids, on)
  }, [toggleSelectMany])

  const onToggleAll = useCallback(() => {
    onToggleMany(allTaskIds, selectedCount !== allTaskIds.length)
  }, [allTaskIds, selectedCount, onToggleMany])

  // ─── 下载：收集选中条目 → build-specs（占位 url）→ download:start ───
  const onDownload = useCallback(async (): Promise<void> => {
    if (selectedCount === 0 || downloading) return

    const curProgress = useAppStore.getState().progress
    const curLinked = useAppStore.getState().cloudLinkedIds

    // 按课程分组选中条目（build-specs 按课程产 spec，落盘子目录含课程名/章节）
    const byCourse = new Map<string, { course: CnmoocCourse; items: CnmoocSelectedItem[] }>()
    for (const c of courses) {
      const chapters = courseData[c.courseId]?.chapters ?? EMPTY_CHAPTERS
      const picked: CnmoocSelectedItem[] = []
      for (const ch of chapters) {
        for (const it of ch.items) {
          const tid = makeTid(c.courseId, it.itemId)
          if (!selected.has(tid)) continue
          // 跳过已完全完成的（本地+云端均 done/skipped）
          const localDone = curProgress[tid]?.state === 'done' || curProgress[tid]?.state === 'skipped'
          const cloudId = curLinked[tid]
          const cloudDone = !cloudId
            || curProgress[cloudId]?.state === 'done'
            || curProgress[cloudId]?.state === 'skipped'
          if (localDone && cloudDone) continue
          picked.push({ itemId: it.itemId, itemType: it.itemType, title: it.title, chapter: ch.chapter })
        }
      }
      if (picked.length > 0) byCourse.set(c.courseId, { course: c, items: picked })
    }

    if (byCourse.size === 0) return

    const specs: DownloadTaskSpec[] = []
    for (const { course, items } of byCourse.values()) {
      const r = await window.api.cnmooc.buildSpecs(course.name, course.courseId, items, resourceFilter)
      if (r.ok && r.specs) {
        for (const spec of r.specs) {
          applyProgress({ taskId: spec.taskId, state: 'pending', received: 0, total: 0, message: '等待解析直链…' })
          specs.push(spec)
        }
      }
    }
    if (specs.length === 0) return

    setDownloading(true)
    if (downloadMode === 'both') {
      const mapping: Record<string, string> = { ...curLinked }
      for (const spec of specs) mapping[spec.taskId] = spec.taskId + '_cloud'
      setCloudLinkedIds(mapping)
    } else {
      setCloudLinkedIds({})
    }

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
        applyProgress({ taskId: spec.taskId, state: 'error', received: 0, total: 0, message: result.error || '下载启动失败' })
      }
    }
  }, [selectedCount, downloading, courses, courseData, selected, resourceFilter, downloadMode, fileConflictStrategy, localDestRoot, setDownloading, setCloudLinkedIds, applyProgress])

  // 单任务 / 全局 控制
  const onPauseTask = useCallback((id: string) => { window.api.download.pause(id).catch(() => undefined) }, [])
  const onCancelTask = useCallback((id: string) => { window.api.download.cancel(id).catch(() => undefined) }, [])
  const onResumeTask = useCallback((id: string) => { window.api.download.resume(id).catch(() => undefined) }, [])
  const onPauseAll = useCallback(() => { window.api.download.pauseAll().catch(() => undefined) }, [])
  const onResumeAll = useCallback(() => { window.api.download.resumeAll().catch(() => undefined) }, [])
  const onCancelAll = useCallback(() => { window.api.download.cancelAll().catch(() => undefined) }, [])

  const onSelectLocalFolder = useCallback(async (): Promise<void> => {
    const p = await window.api.selectFolder()
    if (p) setLocalDestRoot(p)
  }, [setLocalDestRoot])

  const completed = stats.done
  const failed = stats.failed

  return (
    <div className="flex h-full w-full flex-col">
      <CnmoocTopBar
        scanState={scanState}
        scanMessage={scanMessage}
        courseCount={courses.length}
        total={total}
        onRefresh={() => void runScan()}
      />

      {scanState === 'done' && total > 0 && (
        <CnmoocActionBar
          selectedCount={selectedCount}
          total={total}
          cloudUserToken={cloudUserToken}
          cloudSpaceInfo={cloudSpaceInfo}
          cloudConnecting={cloudConnStatus === 'connecting'}
          cloudError={cloudConnStatus === 'error' ? cloudConnMessage : null}
          downloadMode={downloadMode}
          fileConflictStrategy={fileConflictStrategy}
          resourceFilter={resourceFilter}
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
          onResourceFilterChange={setResourceFilter}
          onPauseAll={onPauseAll}
          onResumeAll={onResumeAll}
          onCancelAll={onCancelAll}
        />
      )}

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {scanState === 'scanning' && <ScanningHero msg={scanMessage} />}
        {scanState === 'error' && <ErrorHero msg={scanMessage} onRetry={() => void runScan()} />}
        {scanState === 'done' && courses.length === 0 && <EmptyHero />}
        {scanState === 'done' && courses.length > 0 && (
          <div className="flex flex-col gap-4">
            {courses.map((c, idx) => (
              <div
                key={c.courseId}
                className="animate-fadeInUp"
                style={{ animationDelay: `${Math.min(idx, 8) * 40}ms`, animationFillMode: 'backwards' }}
              >
                <CnmoocCourseCard
                  course={c}
                  chapters={courseData[c.courseId]?.chapters ?? EMPTY_CHAPTERS}
                  expanded={expanded.has(c.courseId)}
                  selected={selected}
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

const CnmoocTopBar = memo(function CnmoocTopBar({
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
          <span>扫描完成 · {courseCount} 门课 · 共 {total} 个资源条目</span>
        )}
        {scanState === 'error' && <span className="text-warning">{scanMessage}</span>}
      </div>
      {scanState === 'done' && courseCount > 0 && (
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-text-3 transition-colors duration-150 hover:bg-surface-2 hover:text-text-1"
        >
          刷新 ↻
        </button>
      )}
    </div>
  )
})

// ─────────────────────────────────────────────────────────────
// 操作条 — 资源类型 + 模式 + 冲突策略 + 云盘/目录 + 下载
// ─────────────────────────────────────────────────────────────

function CnmoocActionBar({
  selectedCount,
  total,
  cloudUserToken,
  cloudSpaceInfo,
  cloudConnecting,
  cloudError,
  downloadMode,
  fileConflictStrategy,
  resourceFilter,
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
  onResourceFilterChange,
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
  resourceFilter: CnmoocResourceFilter
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
  onResourceFilterChange: (f: CnmoocResourceFilter) => void
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
      {/* 第一行：全选 + 云盘/目录 + 进度 */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onToggleAll}
          className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-text-1 transition-colors duration-150 hover:bg-surface-2 hover:text-text-1"
        >
          <TriCheckbox state={triState} size="lg" />
          <span>全选 <span className="text-text-3">({selectedCount} / {total})</span></span>
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
              <Spinner size={14} /> 正在连接交大云盘…
            </span>
          ) : needsCloud ? (
            <button
              type="button"
              onClick={onConnectCloud}
              className="inline-flex max-w-full items-center gap-2 rounded-lg border border-bd-strong bg-surface-3 px-3 py-1.5 text-xs text-text-2 transition-all duration-150 hover:border-info-ring hover:text-info"
              title="通过 jAccount 单点登录连接交大云盘，用于上传文件"
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
              title="选择文件保存的本地文件夹"
            >
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span className="truncate max-w-[180px]">{localDestRoot || '选择下载目录'}</span>
            </button>
          )}

          {downloading && (
            <div className="flex items-center gap-3 rounded-lg bg-surface-3 px-3 py-1.5 text-xs">
              <span className="text-text-2">
                完成 <span className="font-medium text-success">{completed}</span> / {selectedCount}
              </span>
              {failed > 0 && <span className="text-warning">失败 {failed}</span>}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ResourceTypeSegmented value={resourceFilter} onChange={onResourceFilterChange} />
          <ModeSegmented value={downloadMode} onChange={onModeChange} />
          <ConflictStrategySegmented value={fileConflictStrategy} onChange={onConflictStrategyChange} />
        </div>
      </div>

      {/* 第二行：全局控制 + 开始按钮 */}
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
// 课程卡片（可折叠） — 内含章节块，每章节块为带三态勾选的标题 + 条目列表
// ─────────────────────────────────────────────────────────────

const CnmoocCourseCard = memo(function CnmoocCourseCard({
  course,
  chapters,
  expanded,
  selected,
  onToggle,
  onToggleMany,
  onToggleExpand,
  onPauseTask,
  onCancelTask,
  onResumeTask
}: {
  course: CnmoocCourse
  chapters: CnmoocChapter[]
  expanded: boolean
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleMany: (ids: string[], on: boolean) => void
  onToggleExpand: (courseId: string) => void
  onPauseTask: (id: string) => void
  onCancelTask: (id: string) => void
  onResumeTask: (id: string) => void
}) {
  // 该课程所有条目 taskId
  const ids = useMemo(() => {
    const out: string[] = []
    for (const ch of chapters) for (const it of ch.items) out.push(makeTid(course.courseId, it.itemId))
    return out
  }, [chapters, course.courseId])
  const selCount = ids.filter(id => selected.has(id)).length
  const triState = triStateFromCount(selCount, ids.length)

  // 课程级聚合进度（编码为单 number，避免每条进度都重渲染卡片）
  const courseStats = useAppStore(s => {
    let done = 0, downloading = 0, errors = 0
    for (const id of ids) {
      const st = s.progress[id]?.state
      // both 模式计云端镜像
      const cloudId = s.cloudLinkedIds[id]
      const cloudSt = cloudId ? s.progress[cloudId]?.state : undefined
      if (st === 'error' || cloudSt === 'error') errors++
      const localDone = st === 'done' || st === 'skipped'
      const cloudDone = !cloudId || cloudSt === 'done' || cloudSt === 'skipped'
      if (localDone && cloudDone) done++
      else if (st === 'downloading' || st === 'pending' || cloudSt === 'downloading' || cloudSt === 'pending') downloading++
    }
    return done * 1_000_000 + downloading * 1000 + errors
  })
  const doneCount = Math.floor(courseStats / 1_000_000)
  const downloadingCount = Math.floor(courseStats / 1000) % 1000
  const errorCount = courseStats % 1000

  return (
    <section className="overflow-hidden rounded-2xl border border-bd bg-surface-3 shadow-card transition-shadow duration-200 hover:shadow-card-hover">
      <header
        className="flex cursor-pointer select-none items-center gap-4 px-5 py-4 transition-colors duration-150 hover:bg-surface-2"
        onClick={() => onToggleExpand(course.courseId)}
      >
        <Chevron open={expanded} />
        <span
          role="checkbox"
          aria-checked={triState === 'some' ? 'mixed' : triState === 'all'}
          tabIndex={0}
          onClick={e => { e.stopPropagation(); onToggleMany(ids, triState !== 'all') }}
          onKeyDown={e => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault(); e.stopPropagation(); onToggleMany(ids, triState !== 'all')
            }
          }}
          className="shrink-0"
        >
          <TriCheckbox state={triState} size="lg" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="line-clamp-1 text-base font-semibold text-text-1">{course.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-3">
            <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs text-text-2">{course.courseId}</span>
            <span>{chapters.length} 章 · {ids.length} 个资源</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 text-xs text-text-3">
          <span>已选 <span className="font-medium text-text-1">{selCount}</span> / {ids.length}</span>
        </div>
      </header>

      <CourseProgressSummary done={doneCount} downloading={downloadingCount} errors={errorCount} total={ids.length} />

      {expanded && (
        <div className="animate-fadeIn origin-top border-t border-bd">
          {chapters.length === 0 ? (
            <div className="px-5 py-5 text-center text-sm text-text-3">该课程暂无可下载资源</div>
          ) : (
            chapters.map((ch, chi) => (
              <CnmoocChapterBlock
                key={`${course.courseId}-${chi}-${ch.chapter}`}
                courseId={course.courseId}
                chapter={ch}
                selected={selected}
                onToggle={onToggle}
                onToggleMany={onToggleMany}
                onPauseTask={onPauseTask}
                onCancelTask={onCancelTask}
                onResumeTask={onResumeTask}
              />
            ))
          )}
        </div>
      )}
    </section>
  )
})

// ─────────────────────────────────────────────────────────────
// 章节块（带三态勾选的子标题 + 条目列表）
// ─────────────────────────────────────────────────────────────

const CnmoocChapterBlock = memo(function CnmoocChapterBlock({
  courseId,
  chapter,
  selected,
  onToggle,
  onToggleMany,
  onPauseTask,
  onCancelTask,
  onResumeTask
}: {
  courseId: string
  chapter: CnmoocChapter
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleMany: (ids: string[], on: boolean) => void
  onPauseTask: (id: string) => void
  onCancelTask: (id: string) => void
  onResumeTask: (id: string) => void
}) {
  const ids = useMemo(() => chapter.items.map(it => makeTid(courseId, it.itemId)), [chapter, courseId])
  const selCount = ids.filter(id => selected.has(id)).length
  const tri: TriState = triStateFromCount(selCount, ids.length)

  return (
    <div className="border-b border-bd last:border-b-0">
      <div className="flex items-center gap-3 bg-surface-2/40 px-5 py-2.5">
        <span
          role="checkbox"
          aria-checked={tri === 'some' ? 'mixed' : tri === 'all'}
          tabIndex={0}
          onClick={() => onToggleMany(ids, tri !== 'all')}
          onKeyDown={e => {
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggleMany(ids, tri !== 'all') }
          }}
          className="shrink-0 cursor-pointer"
        >
          <TriCheckbox state={tri} size="sm" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-1">{chapter.chapter}</span>
        <span className="shrink-0 text-xs text-text-3">{selCount} / {ids.length}</span>
      </div>
      <ul className="divide-y divide-bd">
        {chapter.items.map(it => (
          <CnmoocItemRow
            key={`${courseId}-${it.itemId}`}
            courseId={courseId}
            item={it}
            isOn={selected.has(makeTid(courseId, it.itemId))}
            onToggle={onToggle}
            onPauseTask={onPauseTask}
            onCancelTask={onCancelTask}
            onResumeTask={onResumeTask}
          />
        ))}
      </ul>
    </div>
  )
})

// ─────────────────────────────────────────────────────────────
// 单个条目行
// ─────────────────────────────────────────────────────────────

const CnmoocItemRow = memo(function CnmoocItemRow({
  courseId,
  item,
  isOn,
  onToggle,
  onPauseTask,
  onCancelTask,
  onResumeTask
}: {
  courseId: string
  item: CnmoocItem
  isOn: boolean
  onToggle: (id: string) => void
  onPauseTask: (id: string) => void
  onCancelTask: (id: string) => void
  onResumeTask: (id: string) => void
}) {
  const tid = makeTid(courseId, item.itemId)
  const p = useEffectiveProgress(tid)

  return (
    <li className="flex items-center gap-3 px-5 py-2.5 transition-colors duration-100 hover:bg-surface-2">
      <button
        type="button"
        onClick={() => onToggle(tid)}
        title={item.title}
        className="shrink-0 text-text-3 hover:text-accent"
      >
        <SmallCheck on={isOn} />
      </button>
      <span className="min-w-0 flex-1 truncate text-sm text-text-2" title={item.title}>{item.title}</span>
      <div className="w-64 shrink-0">
        {p ? <ProgressBar p={p} /> : <div className="h-2 rounded-full bg-surface-2" />}
      </div>
      {p && (
        <TaskCtrlButtons
          state={p.state}
          onPause={() => onPauseTask(tid)}
          onCancel={() => onCancelTask(tid)}
          onResume={() => onResumeTask(tid)}
        />
      )}
    </li>
  )
})

// ─────────────────────────────────────────────────────────────
// Hero 占位
// ─────────────────────────────────────────────────────────────

const ScanningHero = memo(function ScanningHero({ msg }: { msg: string }) {
  return (
    <div className="relative mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-hero-radial opacity-70 blur-2xl" />
      <div className="relative"><Spinner size={32} /></div>
      <div className="mt-5 text-base font-medium text-text-1">{msg || '正在扫描…'}</div>
      <div className="mt-2 max-w-xs text-sm leading-relaxed text-text-3">
        正在连接好大学在线并解析课程章节，稍等几秒
      </div>
    </div>
  )
})

const ErrorHero = memo(function ErrorHero({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="relative mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-hero-radial opacity-60 blur-2xl" />
      <svg className="h-12 w-12 text-warning/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      <div className="mt-4 max-w-sm rounded-xl bg-warning-bg px-4 py-2.5 text-sm font-medium text-warning ring-1 ring-warning-ring">{msg}</div>
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

const EmptyHero = memo(function EmptyHero() {
  return (
    <div className="relative mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-hero-radial opacity-50 blur-2xl" />
      <svg className="h-12 w-12 text-text-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
        <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
      </svg>
      <div className="mt-4 text-xl font-bold text-text-1">没有找到好大学在线课程</div>
      <div className="mt-3 max-w-xs text-sm leading-relaxed text-text-3">
        请确认你在 cnmooc.sjtu.cn（好大学在线）有「正在学习」的课程。
      </div>
    </div>
  )
})
