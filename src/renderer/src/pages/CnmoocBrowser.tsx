import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { useShallow } from 'zustand/shallow'
import { useAppStore, useDownloadStats, useEffectiveProgress } from '../store/app'
import {
  useDownloadCompletion
} from '../hooks/useSharedBrowserHooks'
import { prefetchCnmoocCourses } from '../services/prefetch'
import {
  Chevron,
  CourseProgressSummary,
  FileTypeBadge,
  FolderIcon,
  GlobalCtrlButton,
  ItemCheckbox,
  LayoutModeSwitch,
  ProgressBar,
  ResourceTypeSegmented,
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
  CnmoocSelectedItem,
  DownloadTaskSpec
} from '@shared/types'

// cnmooc 任务 taskId 模板：`cnmooc_{courseId}_{itemId}`（courseId/itemId 均为字符串）
const makeTid = (courseId: string, itemId: string): string => `cnmooc_${courseId}_${itemId}`

const EMPTY_CHAPTERS: CnmoocChapter[] = []

export function CnmoocBrowser() {
  const {
    courses,
    scanState,
    scanMessage,
    courseData,
    expanded,
    selected,
    cloudUserToken,
    downloadMode,
    localDestRoot,
    resourceFilter,
    downloading,
    toggleExpand,
    setSelected,
    toggleSelect,
    toggleSelectMany,
    setResourceFilter,
    setDownloading,
    setCloudLinkedIds,
    resetCnmoocScanResults,
    courseLayoutMode,
    setCourseLayoutMode
  } = useAppStore(
    useShallow(s => ({
      courses: s.cnmoocCourses,
      scanState: s.cnmoocScanState,
      scanMessage: s.cnmoocScanMessage,
      courseData: s.cnmoocCourseData,
      expanded: s.cnmoocExpandedCourses,
      selected: s.selected,
      cloudUserToken: s.cloudUserToken,
      downloadMode: s.downloadMode,
      localDestRoot: s.localDestRoot,
      resourceFilter: s.cnmoocResourceFilter,
      downloading: s.downloading,
      toggleExpand: s.toggleCnmoocExpand,
      setSelected: s.setSelected,
      toggleSelect: s.toggleSelect,
      toggleSelectMany: s.toggleSelectMany,
      setResourceFilter: s.setCnmoocResourceFilter,
      setDownloading: s.setDownloading,
      setCloudLinkedIds: s.setCloudLinkedIds,
      resetCnmoocScanResults: s.resetCnmoocScanResults,
      courseLayoutMode: s.courseLayoutMode,
      setCourseLayoutMode: s.setCourseLayoutMode
    }))
  )

  const [searchQuery, setSearchQuery] = useState('')

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
  const scanStartedRef = useRef(false)
  const runScan = useCallback(async (): Promise<void> => {
    resetCnmoocScanResults()
    await prefetchCnmoocCourses()
  }, [resetCnmoocScanResults])

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

  // 默认平铺展开所有课程卡片
  const autoExpandedRef = useRef(false)
  useEffect(() => {
    if (!autoExpandedRef.current && courses.length > 0 && scanState === 'done') {
      autoExpandedRef.current = true
      for (const c of courses) {
        if (!expanded.has(c.courseId)) {
          toggleExpand(c.courseId)
        }
      }
    }
  }, [courses, scanState, expanded, toggleExpand])

  // 搜索过滤课程
  const filteredCourses = useMemo(() => {
    if (!searchQuery.trim()) return courses
    const q = searchQuery.trim().toLowerCase()
    return courses.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.courseId.toLowerCase().includes(q) ||
      (courseData[c.courseId]?.chapters ?? []).some(ch =>
        ch.chapter.toLowerCase().includes(q) ||
        ch.items.some(it => it.title.toLowerCase().includes(q))
      )
    )
  }, [courses, searchQuery, courseData])

  // 全部任务到终态时收尾（单源扁平列表，复用 hook 形式）
  useDownloadCompletion(selectedTaskIds, stats.active, true, stats.done, stats.failed)

  // 下载进行中锁定选择
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

    // 按课程分组选中条目
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

    useAppStore.getState().resetBatchTaskIds()

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
    useAppStore.getState().addBatchTaskIds(specs.map(s => s.taskId))
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
        applyProgress({ taskId: spec.taskId, state: 'error', received: 0, total: 0, message: result.error || '下载启动失败' })
      }
    }
  }, [selectedCount, downloading, courses, courseData, selected, resourceFilter, downloadMode, localDestRoot, setDownloading, setCloudLinkedIds, applyProgress])

  // 单任务 / 全局 控制
  const onPauseTask = useCallback((id: string) => { window.api.download.pause(id).catch(() => undefined) }, [])
  const onCancelTask = useCallback((id: string) => { window.api.download.cancel(id).catch(() => undefined) }, [])
  const onResumeTask = useCallback((id: string) => { window.api.download.resume(id).catch(() => undefined) }, [])
  const onPauseAll = useCallback(() => { window.api.download.pauseAll().catch(() => undefined) }, [])
  const onResumeAll = useCallback(() => { window.api.download.resumeAll().catch(() => undefined) }, [])
  const onCancelAll = useCallback(() => {
    window.api.download.cancelAll().catch(() => undefined)
    useAppStore.getState().markBatchPendingCancelled()
  }, [])

  const needsCloud = downloadMode === 'cloud' || downloadMode === 'both'
  const needsLocal = downloadMode === 'local' || downloadMode === 'both'
  const canStart = selectedCount > 0
    && !downloading
    && (!needsCloud || !!cloudUserToken)
    && (!needsLocal || !!localDestRoot)

  return (
    <div className="flex h-full w-full flex-col">
      {/* 顶部单行置顶操作栏 (对齐设计图：搜索框 + 资源类型筛选 + 统计 + 全选 + 立即下载) */}
      <div className="sticky top-0 z-10 no-drag flex flex-wrap items-center justify-between gap-3 border-b border-bd bg-surface-1 px-6 py-2.5 shadow-xs">
        {/* 左侧：搜索框 + 资源类型筛选胶囊 + 刷新 */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center">
            <svg className="pointer-events-none absolute left-3 h-4 w-4 text-text-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索课程/章节/课件..."
              className="h-10 w-48 rounded-xl border border-bd bg-surface-2 pl-9 pr-3 text-xs text-text-1 placeholder:text-text-4 shadow-2xs hover:border-bd-strong focus:w-60 focus:border-accent focus:outline-none transition-all duration-200"
            />
          </div>

          <div className="flex items-center gap-2">
            <ResourceTypeSegmented value={resourceFilter} onChange={setResourceFilter} />
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
              onClick={() => void runScan()}
              title="重新扫描好大学在线课程"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-bd bg-surface-2 text-text-3 hover:border-bd-strong hover:bg-surface-1 hover:text-text-1 transition-all shadow-2xs cursor-pointer text-sm"
            >
              ↻
            </button>
          )}
        </div>

        {/* 右侧：已选统计 + 已选全部 + 全局下载控制 + 立即下载 */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-2">
            <span className="text-accent font-bold">☑</span>
            <span>已选 {selectedCount} / {total} 项</span>
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
            onClick={() => void onDownload()}
            disabled={!canStart}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-5 text-xs font-semibold text-white shadow-glow-sm transition-all hover:scale-[1.02] hover:bg-accent-light active:scale-[0.98] disabled:scale-100 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-4 disabled:shadow-none disabled:opacity-60 cursor-pointer"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v13m0 0l-4-4m4 4l4-4M4 21h16" />
            </svg>
            <span>{downloading ? '进行中…' : `立即下载 (${selectedCount})`}</span>
          </button>
        </div>
      </div>

      {/* 课程列表：多列网格流 (Deck) 或 紧凑列表流 (List) */}
      <div className="flex-1 overflow-y-auto p-6">
        {scanState === 'scanning' && courses.length === 0 && <ScanningHero msg={scanMessage} />}
        {scanState === 'error' && <ErrorHero msg={scanMessage} onRetry={() => void runScan()} />}
        {scanState === 'done' && courses.length === 0 && <EmptyHero />}
        {scanState === 'done' && courses.length > 0 && filteredCourses.length === 0 && (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
            <div className="text-base font-medium text-text-1">没有匹配的好大学课程</div>
            <div className="mt-2 text-sm text-text-3">请尝试更改搜索关键词</div>
          </div>
        )}
        {filteredCourses.length > 0 && (
          <div className={courseLayoutMode === 'deck' ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 items-start" : "flex flex-col gap-4 max-w-5xl mx-auto w-full"}>
            {filteredCourses.map((c, idx) => (
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
// 课程卡片（Deck 样式，对齐设计图：文件夹图标 + 章节/资源分组）
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
  const ids = useMemo(() => {
    const out: string[] = []
    for (const ch of chapters) for (const it of ch.items) out.push(makeTid(course.courseId, it.itemId))
    return out
  }, [chapters, course.courseId])
  const selCount = ids.filter(id => selected.has(id)).length
  const triState = triStateFromCount(selCount, ids.length)

  // 课程级聚合进度
  const courseStats = useAppStore(
    useShallow(s => {
      let done = 0, downloading = 0, errors = 0, inflight = 0
      for (const id of ids) {
        const prog = s.progress[id]
        const st = prog?.state
        const cloudId = s.cloudLinkedIds[id]
        const cloudProg = cloudId ? s.progress[cloudId] : undefined
        const cloudSt = cloudProg?.state
        if (st === 'error' || cloudSt === 'error') errors++
        const localDone = st === 'done' || st === 'skipped'
        const cloudDone = !cloudId || cloudSt === 'done' || cloudSt === 'skipped' || cloudSt === 'cancelled'
        if (localDone && cloudDone) done++
        else if (st === 'downloading' || st === 'pending' || cloudSt === 'downloading' || cloudSt === 'pending') {
          downloading++
          if (st === 'downloading' && prog && prog.total > 0) inflight += Math.min(1, prog.received / prog.total)
          else if (localDone) inflight += 1
        }
      }
      return { done, downloading, errors, inflight }
    })
  )
  const { done: doneCount, downloading: downloadingCount, errors: errorCount, inflight: inflightCount } = courseStats

  return (
    <section className="overflow-hidden rounded-2xl border border-bd bg-surface-1 shadow-card transition-shadow duration-200 hover:shadow-card-hover flex flex-col">
      <header
        className="flex cursor-pointer select-none items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-surface-2/60 border-b border-bd/60"
        onClick={() => onToggleExpand(course.courseId)}
      >
        <FolderIcon className="h-5 w-5 text-amber-500 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-text-1" title={course.name}>{course.name}</div>
          <div className="flex items-center gap-2 text-[11px] text-text-3">
            <span className="font-mono text-text-2">{course.courseId}</span>
            <span>·</span>
            <span>{chapters.length} 章节 · {ids.length} 资源</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
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
            <TriCheckbox state={triState} size="sm" />
          </span>
          <Chevron open={expanded} />
        </div>
      </header>

      <CourseProgressSummary done={doneCount} downloading={downloadingCount} errors={errorCount} inflight={inflightCount} total={ids.length} />

      {expanded && (
        <div className="animate-fadeIn origin-top divide-y divide-bd/60">
          {chapters.length === 0 ? (
            <div className="px-4 py-4 text-center text-xs text-text-3">该课程暂无可下载资源</div>
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
  const [open, setOpen] = useState(true)
  const ids = useMemo(() => chapter.items.map(it => makeTid(courseId, it.itemId)), [chapter, courseId])
  const selCount = ids.filter(id => selected.has(id)).length
  const tri: TriState = triStateFromCount(selCount, ids.length)

  return (
    <div className="bg-surface-2/20">
      <div
        className="flex cursor-pointer select-none items-center gap-2.5 px-4 py-2 hover:bg-surface-2/50 transition-colors"
        onClick={() => setOpen(prev => !prev)}
      >
        <span
          role="checkbox"
          aria-checked={tri === 'some' ? 'mixed' : tri === 'all'}
          tabIndex={0}
          onClick={e => {
            e.stopPropagation()
            onToggleMany(ids, tri !== 'all')
          }}
          onKeyDown={e => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation()
              onToggleMany(ids, tri !== 'all')
            }
          }}
          className="shrink-0"
        >
          <TriCheckbox state={tri} size="sm" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-2" title={chapter.chapter}>
          {chapter.chapter}
        </span>
        <span className="shrink-0 text-[11px] font-mono text-text-4">
          {selCount} / {ids.length}
        </span>
        <Chevron open={open} />
      </div>
      {open && (
        <ul className="divide-y divide-bd/40 border-t border-bd/40 bg-surface-1">
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
      )}
    </div>
  )
})

// ─────────────────────────────────────────────────────────────
// 单个条目行（彩色徽标 + 标题 + 进度/控制）
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
    <li className="flex items-center gap-2.5 px-4 py-2 transition-colors duration-100 hover:bg-surface-2/40">
      <ItemCheckbox
        checked={isOn}
        onChange={() => onToggle(tid)}
      />
      <FileTypeBadge
        filename={item.title}
        type={item.itemType === '10' ? 'MP4' : undefined}
      />
      <span className="min-w-0 flex-1 truncate text-xs text-text-1" title={item.title}>
        {item.title}
      </span>
      {p && (
        <div className="w-24 shrink-0">
          <ProgressBar p={p} />
        </div>
      )}
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
