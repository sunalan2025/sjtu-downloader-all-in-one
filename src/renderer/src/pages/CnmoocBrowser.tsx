import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { useShallow } from 'zustand/shallow'
import { useAppStore, useDownloadStats, useEffectiveProgress } from '../store/app'
import {
  useDownloadCompletion
} from '../hooks/useSharedBrowserHooks'
import { prefetchCnmoocCourses } from '../services/prefetch'
import {
  GlobalCtrlButton,
  NetdiskViewModeSwitch,
  ProgressBar,
  ResourceTypeSegmented,
  TaskCtrlButtons,
  triStateFromCount
} from '../components/DownloadUI'
import {
  NetdiskCourseExplorer,
  type NetdiskNavState,
  type NetdiskCourseItem,
  type NetdiskCategoryItem,
  type NetdiskFileItem
} from '../components/NetdiskCourseExplorer'
import { Spinner } from '../components/Spinner'
import { submitDownloadBatch } from '../download/submit'
import { cnmoocTaskId as makeTid } from '../download/taskIds'
import { computeBatchStats } from '../download/progress'
import type {
  CnmoocChapter,
  CnmoocCourse,
  CnmoocSelectedItem,
  DownloadTaskSpec
} from '@shared/types'

const EMPTY_CHAPTERS: CnmoocChapter[] = []

const CnmoocItemProgress = memo(function CnmoocItemProgress({
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

const QUIZ_TYPES = new Set(['30', '40', '50', '60', '70'])

/** 判断是否为无下载实体的练习题、测验、测试、作业、考试、问卷、讨论等项 */
export function isCnmoocQuizOrExercise(title: string, itemType?: string): boolean {
  if (itemType && QUIZ_TYPES.has(itemType)) return true
  if (itemType && /^(quiz|exercise|test|exam|discuss|homework|survey)$/i.test(itemType)) return true

  // 清洗尾部括号备注（支持中英文括号及方括号，如“（必做）”、“(选做)”、“[客观题]”）
  const cleanTitle = title.replace(/\s*[(（[][^)）\]]*[)）\]]\s*$/, '').trim()

  // 若带明确音视频/文档格式扩展名，则是真实文件
  if (/\.(mp4|flv|webm|mkv|avi|mov|wmv|pdf|ppt|pptx|doc|docx|xls|xlsx|zip|rar|7z|txt)$/i.test(cleanTitle)) {
    return false
  }

  // 若包含明确教学录像/讲座关键词（如“习题课/试卷讲评/讲解/答疑”），则是视频课件
  if (/(?:课|讲|讲解|讲评|答疑|点评|解析|串讲|导学|视频)$/i.test(cleanTitle)) {
    return false
  }
  if (/(?:习题课|复习课|试卷讲评|作业讲解|考试答疑)/i.test(cleanTitle)) {
    return false
  }

  // 纯在线练习题、测试题、测验、自测、小测、考试、作业、问卷、讨论
  const quizPattern = /(?:练习题?|测试题?|测验|自测|随堂测|小测|作业|课后习题|期[中末]考试?|考试|试卷|问卷|调查|互动讨论)$/i
  return quizPattern.test(cleanTitle)
}

export function classifyCnmoocItem(it: { title: string; itemType: string }, isAudioOnly = false): {
  isVideo: boolean
  type: string
  displayName: string
} {
  const rawTitle = it.title.trim()
  // 去除历史上或错误拼接的尾部 (MP4) / (M4A) / (音频 M4A) 标记
  const cleanTitle = rawTitle.replace(/\s*\((MP4|M4A|音频 M4A)\)\s*$/i, '').trim()
  const m = cleanTitle.match(/\.([a-zA-Z0-9]{2,5})$/)
  const ext = m ? m[1].toLowerCase() : ''

  const isDocExt = ['pdf', 'ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'zip', 'rar', '7z'].includes(ext)
  const isVideoExt = ['mp4', 'flv', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'm4v', 'ts'].includes(ext)

  let isVideo = false
  if (isVideoExt) {
    isVideo = true
  } else if (isDocExt) {
    isVideo = false
  } else if (it.itemType === '10') {
    if (/\((课件|文档|资料|PPT|PDF)\)/i.test(cleanTitle) || /课件|讲义|大纲/i.test(cleanTitle)) {
      isVideo = false
    } else {
      isVideo = true
    }
  } else {
    isVideo = false
  }

  let type: string
  if (isDocExt) {
    type = ext.toUpperCase()
  } else if (isVideo) {
    type = isAudioOnly ? 'M4A' : (ext ? ext.toUpperCase() : 'MP4')
  } else {
    if (/pdf/i.test(cleanTitle)) type = 'PDF'
    else if (/ppt/i.test(cleanTitle) || /课件/i.test(cleanTitle)) type = 'PPT'
    else type = 'DOC'
  }

  let displayName = cleanTitle
  if (isVideo && isAudioOnly) {
    if (cleanTitle.toLowerCase().endsWith('.mp4')) {
      displayName = cleanTitle.replace(/\.mp4$/i, '.m4a')
    } else if (!cleanTitle.includes('音频') && !cleanTitle.includes('M4A')) {
      displayName = `${cleanTitle} (音频 M4A)`
    }
  }

  return { isVideo, type, displayName }
}

export function CnmoocBrowser() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggleSelect = useCallback((taskId: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }, [])
  const toggleSelectMany = useCallback((taskIds: string[], on: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of taskIds) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }, [])

  const {
    courses,
    scanState,
    scanMessage,
    courseData,
    downloadMode,
    resourceFilter,
    downloading,
    setResourceFilter,
    setDownloading,
    resetCnmoocScanResults,
    courseViewMode,
    setCourseViewMode,
    videoQualityOption
  } = useAppStore(
    useShallow(s => ({
      courses: s.cnmoocCourses,
      scanState: s.cnmoocScanState,
      scanMessage: s.cnmoocScanMessage,
      courseData: s.cnmoocCourseData,
      downloadMode: s.downloadMode,
      resourceFilter: s.cnmoocResourceFilter,
      downloading: s.downloading,
      setResourceFilter: s.setCnmoocResourceFilter,
      setDownloading: s.setDownloading,
      resetCnmoocScanResults: s.resetCnmoocScanResults,
      courseViewMode: s.courseViewMode,
      setCourseViewMode: s.setCourseViewMode,
      videoQualityOption: s.videoQualityOption
    }))
  )

  const [searchQuery, setSearchQuery] = useState('')
  const [navState, setNavState] = useState<NetdiskNavState>({ level: 'root' })

  // 摊平所有条目的 taskId（用于全选 / 计数 / 统计）。
  const allTaskIds = useMemo(() => {
    const out: string[] = []
    const isAudioOnly = videoQualityOption === 'audio_only'
    for (const c of courses) {
      const chapters = courseData[c.courseId]?.chapters ?? EMPTY_CHAPTERS
      for (const ch of chapters) {
        for (const it of ch.items) {
          if (isCnmoocQuizOrExercise(it.title, it.itemType)) continue
          if (resourceFilter !== 'all') {
            const meta = classifyCnmoocItem(it, isAudioOnly)
            if (resourceFilter === 'video' && !meta.isVideo) continue
            if (resourceFilter === 'document' && meta.isVideo) continue
          }
          out.push(makeTid(c.courseId, it.itemId))
        }
      }
    }
    return out
  }, [courses, courseData, resourceFilter, videoQualityOption])
  const selectedCount = selected.size

  const selectedTaskIds = useMemo(
    () => allTaskIds.filter(id => selected.has(id)),
    [allTaskIds, selected]
  )
  const isBothMode = downloadMode === 'both'
  const stats = useDownloadStats(selectedTaskIds, isBothMode)

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

  // ─── 下载：收集选中条目 → build-specs（占位 url）→ download:start ───
  const onDownload = useCallback(async (): Promise<void> => {
    if (selectedCount === 0 || downloading) return

    const curProgress = useAppStore.getState().progress
    const curDownloadMode = useAppStore.getState().downloadMode
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
          // 跳过已完全完成的（本地+云端均 done/skipped）。
          // [Bug Fix] 仅 both 模式查镜像映射：cloudLinkedIds 残留历史批次的陈旧
          // 映射会让单模式批次误判 cloudDone、把未完成任务当成已完成而跳过
          const localDone = curProgress[tid]?.state === 'done' || curProgress[tid]?.state === 'skipped'
          const cloudId = curDownloadMode === 'both' ? curLinked[tid] : undefined
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

    const isAudioOnly = useAppStore.getState().videoQualityOption === 'audio_only'
    const specs: DownloadTaskSpec[] = []
    for (const { course, items } of byCourse.values()) {
      const r = await window.api.cnmooc.buildSpecs(course.name, course.courseId, items, resourceFilter)
      if (r.ok && r.specs) {
        for (const spec of r.specs) {
          if (isAudioOnly && (spec.fileName.endsWith('.mp4') || (spec as any).source === 'cnmooc-video')) {
            spec.fileName = spec.fileName.replace(/\.mp4$/, '.m4a')
            spec.extractAudio = true
          }
          specs.push(spec)
        }
      }
    }
    if (specs.length === 0) return

    setDownloading(true)

    // [Phase 1] 提交编排收口到领域层 submitDownloadBatch：占位 pending、batchTaskIds、
    // both 镜像、IPC 启动与失败回滚统一处理。
    const result = await submitDownloadBatch(specs, {
      isBothMode: downloadMode === 'both',
      existingCloudLinkedIds: curLinked
    })
    if (!result.ok) {
      setDownloading(false)
    }
  }, [selectedCount, downloading, courses, courseData, selected, resourceFilter, downloadMode, setDownloading])

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

  const progressMap = useAppStore(s => s.progress)
  const cloudLinkedIds = useAppStore(s => s.cloudLinkedIds)

  const netdiskCourses = useMemo<NetdiskCourseItem[]>(() => {
    return filteredCourses.map(c => {
      const isAudioOnly = videoQualityOption === 'audio_only'
      const chapters = courseData[c.courseId]?.chapters ?? EMPTY_CHAPTERS
      const allChapterItems = chapters.flatMap(ch => ch.items).filter(it => {
        if (isCnmoocQuizOrExercise(it.title, it.itemType)) return false
        if (resourceFilter === 'all') return true
        const meta = classifyCnmoocItem(it, isAudioOnly)
        return resourceFilter === 'video' ? meta.isVideo : !meta.isVideo
      })
      const ids: string[] = allChapterItems.map(it => makeTid(c.courseId, it.itemId))
      const selCount = ids.filter(id => selected.has(id)).length
      const triState = triStateFromCount(selCount, ids.length)

      const categories: NetdiskCategoryItem[] = chapters.map(ch => {
        const filteredChapterItems = ch.items.filter(it => {
          if (isCnmoocQuizOrExercise(it.title, it.itemType)) return false
          if (resourceFilter === 'all') return true
          const meta = classifyCnmoocItem(it, isAudioOnly)
          return resourceFilter === 'video' ? meta.isVideo : !meta.isVideo
        })
        const chIds = filteredChapterItems.map(it => makeTid(c.courseId, it.itemId))
        const chSelCount = chIds.filter(id => selected.has(id)).length
        const chTri = triStateFromCount(chSelCount, chIds.length)

        const items: NetdiskFileItem[] = filteredChapterItems.map(it => {
          const tid = makeTid(c.courseId, it.itemId)
          const meta = classifyCnmoocItem(it, isAudioOnly)
          return {
            id: tid,
            name: meta.displayName,
            type: meta.type,
            selected: selected.has(tid),
            onToggle: () => onToggle(tid),
            renderExtra: (
              <CnmoocItemProgress
                tid={tid}
                onPauseTask={onPauseTask}
                onCancelTask={onCancelTask}
                onResumeTask={onResumeTask}
              />
            )
          }
        })

        return {
          id: ch.chapter,
          name: ch.chapter,
          // [Bug Fix] 章节是混合容器（视频+课件混排），类型筛选由
          // ResourceTypeSegmented 表达；显式钉死 files，防章节名含
          // 「视频处理」「作业」等字样被 resolveCategoryChipKey 嗅探误归类、
          // 点芯片整章误勾/误退。
          chipKey: 'files',
          icon: 'folder',
          state: chTri,
          onToggle: () => {
            onToggleMany(chIds, chTri !== 'all')
          },
          items,
          emptyMessage: '该章节暂无可下载资源'
        }
      })

      // 课程级聚合进度（[Phase 1] 收口到领域层 computeBatchStats，消除三份手抄；
      //  与 Canvas/Audited 口径一致：无进度条目的任务静默不计）
      let stats: ReturnType<typeof computeBatchStats> | undefined
      if (ids.length > 0) {
        stats = computeBatchStats(ids, progressMap, cloudLinkedIds, true)
        const started = ids.some(id => progressMap[id] !== undefined
          || (cloudLinkedIds[id] && progressMap[cloudLinkedIds[id]] !== undefined))
        if (!started) stats = undefined
      }

      return {
        id: c.courseId,
        name: c.name,
        state: triState,
        itemCount: ids.length,
        categories,
        onToggle: () => {
          onToggleMany(ids, triState !== 'all')
        },
        onToggleCategory: (catId, on) => {
          const cd = courseData[c.courseId]
          if (!cd) return
          const matchedIds: string[] = []
          for (const ch of cd.chapters) {
            for (const it of ch.items) {
              if (isCnmoocQuizOrExercise(it.title, it.itemType)) continue
              const meta = classifyCnmoocItem(it, isAudioOnly)
              if (catId === 'videos' && meta.isVideo) {
                matchedIds.push(makeTid(c.courseId, it.itemId))
              } else if (catId === 'files' && !meta.isVideo) {
                matchedIds.push(makeTid(c.courseId, it.itemId))
              }
            }
          }
          if (matchedIds.length > 0) onToggleMany(matchedIds, on)
        },
        summary: stats && (stats.done > 0 || stats.active > 0 || stats.failed > 0)
          ? { done: stats.done, downloading: stats.active, errors: stats.failed, inflight: stats.inflight, total: stats.total }
          : undefined
      }
    })
  }, [
    filteredCourses, courseData, selected, progressMap, cloudLinkedIds,
    onToggleMany, onToggle, onPauseTask, onCancelTask, onResumeTask,
    videoQualityOption, resourceFilter
  ])

  return (
    <div className="flex h-full w-full flex-col">
      {/* 顶部单行置顶操作栏 (对齐设计图：搜索框 + 资源类型筛选 + 统计 + 全选 + 立即下载) */}
      <div className="sticky top-0 z-30 no-drag flex flex-wrap items-center justify-between gap-3 border-b border-bd bg-surface-1 dark:bg-[#1e1e22] px-6 py-2.5 shadow-xs">
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
              onClick={() => void runScan()}
              title="重新扫描好大学在线课程"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-bd bg-surface-2 text-text-3 hover:border-bd-strong hover:bg-surface-1 hover:text-text-1 transition-all shadow-2xs cursor-pointer text-sm"
            >
              ↻
            </button>
          )}
        </div>

        {/* 右侧：下载控制 */}
        <div className="flex items-center gap-3">
          {downloading && (
            <div className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
              <GlobalCtrlButton kind="pause" onClick={onPauseAll} title="暂停全部下载任务" />
              <GlobalCtrlButton kind="resume" onClick={onResumeAll} title="继续全部下载任务" />
              <GlobalCtrlButton kind="cancel" onClick={onCancelAll} title="取消全部下载任务" />
            </div>
          )}
        </div>
      </div>

      {/* 课程列表：网盘资源浏览器 */}
      <div className="flex-1 overflow-y-auto">
        {scanState === 'scanning' && courses.length === 0 && <ScanningHero msg={scanMessage} />}
        {scanState === 'error' && <ErrorHero msg={scanMessage} onRetry={() => void runScan()} />}
        {scanState === 'done' && courses.length === 0 && <EmptyHero />}
        {scanState === 'done' && courses.length > 0 && filteredCourses.length === 0 && (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center p-6">
            <div className="text-base font-medium text-text-1">没有匹配的好大学课程</div>
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
