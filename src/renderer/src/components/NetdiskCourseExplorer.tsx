import { useToast } from '../hooks/useToast'
import { Toast } from './Toast'
import { memo, useMemo, useEffect, useRef, useState, useCallback, Fragment } from 'react'
import type React from 'react'
import { useShallow } from 'zustand/shallow'
import { BreadcrumbBar, type BreadcrumbItem } from './BreadcrumbBar'
import {
  TriCheckbox,
  ItemCheckbox,
  FileTypeBadge,
  FolderIcon,
  formatBytes,
  type TriState,
  MacOSFolderIcon,
  MacOSDocumentIcon,
  MacOSCircleCheckbox
} from './DownloadUI'
import { Spinner } from './Spinner'
import { useAppStore } from '../store/app'
import type { CourseViewMode } from '../store/app'
import {
  groupCoursesByTerm as sharedGroupCoursesByTerm,
  sortAcademicTerms,
  estimateResourceSize
} from '@shared/utils'
import {
  FloatingCommandIsland,
  type VideoPerspective,
  type CategorySelectionState
} from './FloatingCommandIsland'
import { applyVideoPerspectivePreference } from '../download/perspective'
import { computeBatchStats } from '../download/progress'
export type { VideoPerspective, CategorySelectionState }

export type IslandChipKey = 'files' | 'videos' | 'assignments' | 'pptPdf'

// ─────────────────────────────────────────────────────────────
// Netdisk Navigation Interfaces
// ─────────────────────────────────────────────────────────────

export interface NetdiskNavState {
  level: 'root' | 'course' | 'category'
  courseId?: number | string
  categoryId?: string
}

export interface NetdiskFileItem {
  id: string
  name: string
  size?: number
  type?: string
  date?: string
  selected: boolean
  onToggle: () => void
  onDownload?: () => void
  onDownloadSingle?: () => void
  renderExtra?: React.ReactNode
  disabled?: boolean
  disabledReason?: string
}

export type FileItem = NetdiskFileItem

export interface NetdiskCategoryItem {
  id: string
  name: string
  chipKey?: IslandChipKey
  icon?: 'folder' | 'video' | 'file' | 'presentation' | 'audio' | 'assignment' | React.ReactNode
  badge?: string
  state: TriState
  onToggle: () => void
  items: NetdiskFileItem[]
  isLoading?: boolean
  loadingMessage?: string
  emptyMessage?: string
  renderExtra?: React.ReactNode
  disabled?: boolean
  disabledReason?: string
}

/** 规范化解析分类所属的动作岛芯片（唯一事实来源，避免模糊嗅探错误分类） */
export function resolveCategoryChipKey(cat: NetdiskCategoryItem): IslandChipKey {
  if (cat.chipKey) return cat.chipKey
  const id = cat.id.toLowerCase()
  const name = cat.name.toLowerCase()
  if (id.includes('video') || name.includes('视频') || name.includes('音频') || id === 'teacher' || id === 'ppt') return 'videos'
  if (id.includes('assign') || name.includes('作业')) return 'assignments'
  if (id.includes('ppt_pdf') || id.includes('ppt-pdf') || name.includes('讲义') || (id.includes('ppt') && !name.includes('视频') && !name.includes('实录'))) return 'pptPdf'
  return 'files'
}

export interface NetdiskCourseItem {
  id: number | string
  name: string
  code?: string
  term?: string
  teacher?: string
  badge?: string
  state: TriState
  itemCount: number
  totalBytes?: number
  categories: NetdiskCategoryItem[]
  onToggle: () => void
  onToggleCategory?: (categoryId: string, on: boolean) => void
  onEnter?: () => void
  onHover?: () => void
  isLoading?: boolean
  loadingMessage?: string
  summary?: {
    done: number
    downloading: number
    errors: number
    inflight?: number
    total: number
  }
  perspective?: VideoPerspective
  onPerspectiveChange?: (perspective: VideoPerspective) => void
  hasPptPdf?: boolean
  onTogglePptPdf?: (enabled: boolean) => void
  onDownload?: () => void
}

export interface NetdiskCourseExplorerProps {
  courses: NetdiskCourseItem[]
  viewMode: CourseViewMode
  navState: NetdiskNavState
  onNavigate: (next: NetdiskNavState) => void
  emptyPlaceholder?: React.ReactNode
  groupByTerm?: boolean
  onDownloadSingle?: (item: NetdiskFileItem, course?: NetdiskCourseItem, category?: NetdiskCategoryItem) => void
  onDownloadCourse?: (course: NetdiskCourseItem) => void
  /** 页面级批量下载提交入口（悬浮岛「立即下载」主按钮）。
   *  [Bug Fix] 原先岛的按钮在旁听/好大学页无任何回调可走（onDownloadCourse 与
   *  course.onDownload 均未接线）→ 点击无反应。各页必须传入自己的提交函数
   *  （如 AuditedCourses.onDownload / CnmoocBrowser.onDownload）。 */
  onStartDownload?: () => void
  perspective?: VideoPerspective
  onPerspectiveChange?: (perspective: VideoPerspective) => void
  hasPptPdf?: boolean
  onTogglePptPdf?: (enabled: boolean) => void
}

// ─────────────────────────────────────────────────────────────
// Category Icon Renderer
// ─────────────────────────────────────────────────────────────

function CategoryIcon({
  icon,
  size = 'md'
}: {
  icon?: NetdiskCategoryItem['icon']
  size?: 'sm' | 'md' | 'lg'
}) {
  if (typeof icon === 'object' && icon !== null) {
    return <>{icon}</>
  }

  const boxSize = size === 'lg' ? 'h-10 w-10 rounded-xl' : size === 'sm' ? 'h-5 w-5 rounded-md' : 'h-7 w-7 rounded-lg'
  const svgSize = size === 'lg' ? 'h-5 w-5' : size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'

  if (icon === 'audio') {
    return (
      <div className={`flex ${boxSize} shrink-0 items-center justify-center bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm ring-1 ring-emerald-400/20`}>
        <svg className={`${svgSize} fill-none stroke-current drop-shadow-2xs`} viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </div>
    )
  }
  if (icon === 'video') {
    return (
      <div className={`flex ${boxSize} shrink-0 items-center justify-center bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-sm ring-1 ring-sky-400/20`}>
        <svg className={`${svgSize} fill-current drop-shadow-2xs`} viewBox="0 0 24 24">
          <path d="M8 5.14v13.72a1 1 0 0 0 1.55.83l11-6.86a1 1 0 0 0 0-1.66l-11-6.86A1 1 0 0 0 8 5.14z" />
        </svg>
      </div>
    )
  }
  if (icon === 'presentation') {
    return (
      <div className={`flex ${boxSize} shrink-0 items-center justify-center bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-sm ring-1 ring-amber-400/20`}>
        <svg className={`${svgSize} fill-none stroke-current drop-shadow-2xs`} viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="13" rx="2" />
          <path d="M8 21l4-5 4 5" />
          <path d="M12 16v5" />
          <line x1="7" y1="8" x2="17" y2="8" />
          <line x1="7" y1="11" x2="13" y2="11" />
        </svg>
      </div>
    )
  }
  if (icon === 'file') {
    return (
      <div className={`flex ${boxSize} shrink-0 items-center justify-center bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm ring-1 ring-indigo-400/20`}>
        <svg className={`${svgSize} fill-none stroke-current drop-shadow-2xs`} viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      </div>
    )
  }
  if (icon === 'assignment') {
    return (
      <div className={`flex ${boxSize} shrink-0 items-center justify-center bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-sm ring-1 ring-violet-400/20`}>
        <svg className={`${svgSize} fill-none stroke-current drop-shadow-2xs`} viewBox="0 0 24 24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
          <path d="M9 14l2 2 4-4" />
        </svg>
      </div>
    )
  }
  return (
    <div className={`flex ${boxSize} shrink-0 items-center justify-center bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-sm ring-1 ring-amber-400/20`}>
      <FolderIcon className={`${svgSize} text-white`} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// NetdiskCourseExplorer Component
// ─────────────────────────────────────────────────────────────

export const NetdiskCourseExplorer = memo(function NetdiskCourseExplorer({
  courses,
  viewMode,
  navState,
  onNavigate,
  emptyPlaceholder,
  groupByTerm = true,
  onDownloadSingle,
  onDownloadCourse,
  onStartDownload,
  perspective,
  onPerspectiveChange,
  hasPptPdf,
  onTogglePptPdf
}: NetdiskCourseExplorerProps) {
  // 当前处于的课程对象
  const currentCourse = useMemo(() => {
    if (!navState.courseId) return undefined
    return courses.find(c => String(c.id) === String(navState.courseId))
  }, [courses, navState.courseId])

  // 当前处于的分类对象
  const currentCategory = useMemo(() => {
    if (!currentCourse || !navState.categoryId) return undefined
    return currentCourse.categories.find(cat => cat.id === navState.categoryId)
  }, [currentCourse, navState.categoryId])

  // 在 Column 分栏视图下，当前活跃选中的课程与分类（严格单层步进，未点击时不默认预选 courses[0]）
  const columnActiveCourse = useMemo(() => {
    return currentCourse
  }, [currentCourse])

  const columnActiveCategory = useMemo(() => {
    if (!columnActiveCourse || !navState.categoryId) return undefined
    return columnActiveCourse.categories.find(cat => cat.id === navState.categoryId)
  }, [columnActiveCourse, navState.categoryId])

  const [sharedPerspective, setSharedPerspective] = useState<VideoPerspective>('teacher')
  const lastEnteredCourseIdRef = useRef<number | string | null>(null)

  // Column 模式下仅在选中的课程 ID 变化时触发进入加载（阻断每帧重新触发的死循环）
  useEffect(() => {
    if (viewMode === 'column' && columnActiveCourse?.id) {
      if (lastEnteredCourseIdRef.current !== columnActiveCourse.id) {
        lastEnteredCourseIdRef.current = columnActiveCourse.id
        columnActiveCourse.onEnter?.()
      }
    } else if (viewMode !== 'column') {
      lastEnteredCourseIdRef.current = null
    }
  }, [viewMode, columnActiveCourse])

  // 构造面包屑项目
  const breadcrumbItems = useMemo<BreadcrumbItem[]>(() => {
    const items: BreadcrumbItem[] = [
      {
        id: 'root',
        label: '全部课程',
        icon: (
          <svg className="h-3.5 w-3.5 text-accent" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z" />
          </svg>
        )
      }
    ]

    const targetCourse = viewMode === 'column' ? columnActiveCourse : currentCourse
    const targetCategory = viewMode === 'column' ? columnActiveCategory : currentCategory

    if (targetCourse) {
      items.push({
        id: 'course',
        label: targetCourse.name,
        icon: <FolderIcon className="h-3.5 w-3.5 text-amber-500" />
      })
    }

    if (targetCategory && (viewMode === 'column' || navState.level === 'category')) {
      items.push({
        id: 'category',
        label: targetCategory.name,
        icon: (
          <span className="scale-75 origin-center inline-block">
            <CategoryIcon icon={targetCategory.icon} />
          </span>
        )
      })
    }

    return items
  }, [viewMode, columnActiveCourse, currentCourse, columnActiveCategory, currentCategory, navState.level])

  const handleBreadcrumbNavigate = (id: string) => {
    if (id === 'root') {
      onNavigate({ level: 'root' })
    } else if (id === 'course') {
      const courseId = (viewMode === 'column' ? columnActiveCourse?.id : currentCourse?.id) ?? navState.courseId
      onNavigate({ level: 'course', courseId })
    }
  }

  // 统计信息文本
  const statsLabel = useMemo(() => {
    if (viewMode === 'column') {
      if (!columnActiveCourse) return `共 ${courses.length} 门课程`
      if (!columnActiveCategory) return `${columnActiveCourse.categories.length} 个分类`
      return `${columnActiveCategory.items.length} 个文件`
    }
    if (navState.level === 'root') {
      return `共 ${courses.length} 门课程`
    }
    if (navState.level === 'course' && currentCourse) {
      return `${currentCourse.categories.length} 个分类${!currentCourse.isLoading && currentCourse.itemCount > 0 ? ` · ${currentCourse.itemCount} 项资源` : ''}`
    }
    if (navState.level === 'category' && currentCategory) {
      return `共 ${currentCategory.items.length} 个文件`
    }
    return ''
  }, [viewMode, columnActiveCourse, columnActiveCategory, courses.length, navState.level, currentCourse, currentCategory])

  // 全局 Toast 提示状态（统一收口至 useToast）
  const { toast, showToast, hideToast } = useToast(2500)

  const isSingleCourse = navState.level !== 'root' && !!currentCourse

  // 动作岛统计汇总与体积估算
  const selectedStats = useMemo(() => {
    let courseCount = 0
    let categoryCount = 0
    let totalItems = 0
    let filesCount = 0
    let videoCount = 0
    let assignCount = 0
    let pptCount = 0
    let fileBytes = 0

    // 统计选中课程数
    for (const c of courses) {
      if (c.state === 'all' || c.state === 'some') {
        courseCount++
      }
    }

    // 统计当前课程内选中的分类数
    if (currentCourse) {
      for (const cat of currentCourse.categories) {
        if (cat.state === 'all' || cat.state === 'some') {
          categoryCount++
        }
      }
    }

    const relevantCourses = isSingleCourse ? [currentCourse!] : courses
    for (const c of relevantCourses) {
      for (const cat of c.categories) {
        const chipKey = resolveCategoryChipKey(cat)

        for (const item of cat.items) {
          if (item.selected) {
            totalItems++
            if (chipKey === 'files') {
              filesCount++
              fileBytes += item.size || 0
            } else if (chipKey === 'videos') {
              videoCount++
            } else if (chipKey === 'assignments') {
              assignCount++
            } else if (chipKey === 'pptPdf') {
              pptCount++
            }
          }
        }

        // 未展开/未扫描分类兜底：若勾选了该分类但尚未拉取具体 items，计入 1 项
        if (cat.items.length === 0 && (cat.state === 'all' || cat.state === 'some')) {
          totalItems++
          if (chipKey === 'files') filesCount++
          else if (chipKey === 'videos') videoCount++
          else if (chipKey === 'assignments') assignCount++
          else if (chipKey === 'pptPdf') pptCount++
        }
      }

      // 未扫描课程兜底
      if (c.categories.length === 0 && (c.state === 'all' || c.state === 'some')) {
        totalItems += c.itemCount || 1
        fileBytes += c.totalBytes || 0
        filesCount += c.itemCount || 1
      }
    }

    const estimated = estimateResourceSize({
      fileBytes,
      videoCount,
      perspective: perspective ?? currentCourse?.perspective ?? 'teacher',
      hasAssignments: assignCount > 0,
      assignmentCount: assignCount,
      hasPptPdf: pptCount > 0,
      pptPdfCount: pptCount
    })

    return {
      courseCount,
      categoryCount,
      totalItems,
      formattedSize: estimated.formattedSize,
      totalBytes: estimated.totalBytes,
      filesCount,
      videoCount,
      assignCount,
      pptCount,
      isSingleCourse
    }
  }, [courses, isSingleCourse, currentCourse, perspective])

  // 动作岛分类过滤芯片勾选状态
  const categorySelectionState = useMemo<CategorySelectionState>(() => {
    const targetCourses = isSingleCourse ? [currentCourse!] : courses
    let hasFiles = false
    let hasVideos = false
    let hasAssignments = false
    let hasPptPdf = false

    for (const c of targetCourses) {
      for (const cat of c.categories) {
        if (cat.state !== 'none') {
          const chipKey = resolveCategoryChipKey(cat)
          if (chipKey === 'files') hasFiles = true
          else if (chipKey === 'videos') hasVideos = true
          else if (chipKey === 'assignments') hasAssignments = true
          else if (chipKey === 'pptPdf') hasPptPdf = true
        }
      }
    }

    return {
      files: hasFiles,
      videos: hasVideos,
      assignments: hasAssignments,
      pptPdf: hasPptPdf
    }
  }, [courses, isSingleCourse, currentCourse])

  const handleToggleIslandCategory = useCallback((catKey: 'files' | 'videos' | 'assignments' | 'pptPdf') => {
    const targetCourses = isSingleCourse ? [currentCourse!] : courses
    for (const c of targetCourses) {
      const matchedCategories = c.categories.filter(k => resolveCategoryChipKey(k) === catKey)
      if (matchedCategories.length > 0) {
        for (const cat of matchedCategories) cat.onToggle()
      } else if (c.onToggleCategory) {
        c.onToggleCategory(catKey, true)
      }
    }
  }, [isSingleCourse, currentCourse, courses])

  const handleClearSelection = useCallback(() => {
    if (isSingleCourse && currentCourse) {
      if (currentCourse.state !== 'none') currentCourse.onToggle()
    } else {
      for (const c of courses) {
        if (c.state !== 'none') c.onToggle()
      }
    }
  }, [isSingleCourse, currentCourse, courses])

  // ── 本轮批量下载进度（供岛的进度环）：复用领域层 computeBatchStats 统一口径 ──
  const storeDownloading = useAppStore(s => s.downloading)
  const batchProgress = useAppStore(
    useShallow(s => {
      if (!s.downloading || s.batchTaskIds.length === 0) return undefined
      const isBoth = s.downloadMode === 'both'
      return computeBatchStats(s.batchTaskIds, s.progress, s.cloudLinkedIds, isBoth)
    })
  )

  const handleStartDownload = useCallback(() => {
    // [Bug Fix] 原兜底链 course.onDownload → onDownloadCourse → courses[0].onDownload
    // 在旁听/好大学页三环皆空 → 岛的主按钮点击无任何反应。改为优先走页面级
    // onStartDownload 提交函数（各页 onDownload），仅 Column 视图 inspector 走
    // onDownloadCourse / course.onDownload（那两个视图不挂岛）。
    if (onStartDownload) {
      onStartDownload()
      return
    }
    if (isSingleCourse && currentCourse?.onDownload) {
      currentCourse.onDownload()
    } else if (onDownloadCourse && currentCourse) {
      onDownloadCourse(currentCourse)
    } else {
      const selCourses = courses.filter(c => c.state !== 'none')
      if (selCourses.length === 1 && selCourses[0].onDownload) {
        selCourses[0].onDownload()
      } else if (onDownloadCourse && selCourses.length > 0) {
        onDownloadCourse(selCourses[0])
      }
      // 兜底链末环（courses[0]?.onDownload?.()）删除：单课程下载是 inspector 的职责，
      // 岛是批量提交入口，无回调可用时保持静默而非随机下载列表第一门课。
    }
  }, [onStartDownload, isSingleCourse, currentCourse, onDownloadCourse, courses])

  if (courses.length === 0) {
    return <div className="h-full w-full">{emptyPlaceholder}</div>
  }

  return (
    <div className="flex h-full w-full flex-col relative">
      {/* 顶部面包屑与层级回退条 */}
      <div className="flex items-center justify-between border-b border-bd/70 bg-surface-1/60 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-3">
          {viewMode !== 'column' && navState.level !== 'root' && (
            <button
              type="button"
              onClick={() => {
                if (navState.level === 'category') {
                  onNavigate({ level: 'course', courseId: navState.courseId })
                } else {
                  onNavigate({ level: 'root' })
                }
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-bd bg-surface-2 px-2 py-1 text-xs text-text-2 hover:bg-surface-1 hover:text-text-1 transition-colors cursor-pointer"
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              <span>返回上一级</span>
            </button>
          )}
          <BreadcrumbBar items={breadcrumbItems} onNavigate={handleBreadcrumbNavigate} />
        </div>

        <div className="text-xs text-text-3 font-mono">
          {statsLabel}
        </div>
      </div>

      {/* 核心视图区域：依据 viewMode 呈现（带平滑渐入微缩放过渡动效） */}
      <div className="flex-1 overflow-hidden p-4">
        <div key={viewMode} className="h-full w-full animate-fadeIn">
          {viewMode === 'column' ? (
            <ColumnView
              courses={courses}
              activeCourse={columnActiveCourse}
              activeCategory={columnActiveCategory}
              onSelectCourse={c => {
                if (lastEnteredCourseIdRef.current !== c.id) {
                  lastEnteredCourseIdRef.current = c.id
                  c.onEnter?.()
                }
                onNavigate({
                  level: 'course',
                  courseId: c.id
                })
              }}
              onSelectCategory={cat => {
                if (columnActiveCourse) {
                  onNavigate({
                    level: 'category',
                    courseId: columnActiveCourse.id,
                    categoryId: cat.id
                  })
                }
              }}
              groupByTerm={groupByTerm}
              onDownloadSingle={onDownloadSingle}
              onDownloadCourse={onDownloadCourse}
              perspective={perspective}
              onPerspectiveChange={onPerspectiveChange}
              hasPptPdf={hasPptPdf}
              onTogglePptPdf={onTogglePptPdf}
            />
          ) : viewMode === 'list' ? (
            <ListView
              courses={courses}
              currentCourse={currentCourse}
              currentCategory={currentCategory}
              navState={navState}
              onNavigate={onNavigate}
              groupByTerm={groupByTerm}
              onDownloadSingle={onDownloadSingle}
              onDownloadCourse={onDownloadCourse}
              perspective={perspective}
              onPerspectiveChange={onPerspectiveChange}
              showToast={showToast}
              hasSelection={selectedStats.totalItems > 0}
            />
          ) : (
            <GridView
              courses={courses}
              currentCourse={currentCourse}
              currentCategory={currentCategory}
              navState={navState}
              onNavigate={onNavigate}
              groupByTerm={groupByTerm}
              onDownloadSingle={onDownloadSingle}
              onDownloadCourse={onDownloadCourse}
              perspective={perspective}
              onPerspectiveChange={onPerspectiveChange}
              showToast={showToast}
              hasSelection={selectedStats.totalItems > 0}
            />
          )}
        </div>
      </div>

      {/* 底部浮动命令动作岛 (非分栏视图下挂载：选中项 > 0 或本轮批量下载进行中)。
          batchProgress 复用已死的 OverallProgressBar 的 batchTaskIds 统计口径
          （both 模式区分下载中/上传中），让批量进度在岛上以进度环实时可见。 */}
      {viewMode !== 'column' && (selectedStats.totalItems > 0 || storeDownloading) && (
        <FloatingCommandIsland
          selectedSummary={{
            courseCount: selectedStats.courseCount,
            categoryCount: selectedStats.categoryCount,
            totalItems: selectedStats.totalItems,
            formattedSize: selectedStats.formattedSize,
            filesCount: selectedStats.filesCount,
            videoCount: selectedStats.videoCount,
            assignCount: selectedStats.assignCount,
            pptCount: selectedStats.pptCount
          }}
          isSingleCourse={selectedStats.isSingleCourse}
          categorySelection={categorySelectionState}
          onToggleCategory={handleToggleIslandCategory}
          perspective={perspective ?? currentCourse?.perspective ?? sharedPerspective}
          onPerspectiveChange={p => {
            setSharedPerspective(p)
            onPerspectiveChange?.(p)
            if (currentCourse) {
              currentCourse.onPerspectiveChange?.(p)
            } else {
              const targetCourses = courses.filter(c => c.state !== 'none')
              const broadcastList = targetCourses.length > 0 ? targetCourses : courses
              broadcastList.forEach(c => c.onPerspectiveChange?.(p))
            }
          }}
          onStartDownload={handleStartDownload}
          onClearSelection={handleClearSelection}
          batchProgress={batchProgress}
        />
      )}

      {/* Toast 提示浮条 */}
      <Toast toast={toast} onClose={hideToast} />
    </div>
  )
})

// ─────────────────────────────────────────────────────────────
// 学期分组与批量选择辅助函数 (复用 @shared/utils 消除重复造轮子)
// ─────────────────────────────────────────────────────────────

export function getTermTriState(courses: NetdiskCourseItem[]): TriState {
  if (courses.length === 0) return 'none'
  const allCount = courses.filter(c => c.state === 'all').length
  const noneCount = courses.filter(c => c.state === 'none').length
  if (allCount === courses.length) return 'all'
  if (noneCount === courses.length) return 'none'
  return 'some'
}

export function toggleTermCourses(courses: NetdiskCourseItem[], currentState: TriState) {
  const shouldSelectAll = currentState !== 'all'
  for (const c of courses) {
    if (shouldSelectAll) {
      if (c.state !== 'all') c.onToggle()
    } else {
      if (c.state !== 'none') c.onToggle()
    }
  }
}

export function toggleTermCategory(courses: NetdiskCourseItem[], categoryId: string, on: boolean) {
  for (const c of courses) {
    if (c.onToggleCategory) {
      c.onToggleCategory(categoryId, on)
    } else {
      const cat = c.categories.find(k => k.id === categoryId)
      if (cat) {
        const isAll = cat.state === 'all'
        if (on && !isAll) cat.onToggle()
        else if (!on && cat.state !== 'none') cat.onToggle()
      }
    }
  }
}

function groupCoursesByTerm(courses: NetdiskCourseItem[]) {
  const grouped = sharedGroupCoursesByTerm(courses)
  const sortedTerms = sortAcademicTerms(Object.keys(grouped))
  return sortedTerms.map(term => ({
    term,
    items: grouped[term] || []
  }))
}

// ─────────────────────────────────────────────────────────────
// 辅助判断与视频分类视角筛选组件
// ─────────────────────────────────────────────────────────────

export function isVideoCategory(category?: NetdiskCategoryItem): boolean {
  if (!category) return false
  const id = category.id.toLowerCase()
  const name = category.name.toLowerCase()
  return (
    id === 'videos' ||
    category.icon === 'video' ||
    category.icon === 'audio' ||
    name.includes('视频') ||
    name.includes('音频')
  )
}

export function isPptPerspectiveItem(item: NetdiskFileItem): boolean {
  const id = item.id.toLowerCase()
  const name = item.name.toLowerCase()
  return id.includes('_ppt') || name.includes('ppt') || name.includes('投屏') || name.includes('影视角')
}

export function isTeacherPerspectiveItem(item: NetdiskFileItem): boolean {
  const id = item.id.toLowerCase()
  const name = item.name.toLowerCase()
  if (id.includes('_teacher') || name.includes('教师')) return true
  if (isPptPerspectiveItem(item)) return false
  return true
}

// ─── useCategoryViewLogic：GridView / ListView 共用的分类视图逻辑 ───
//
// [Phase 3 去重] 两个视图组件各自手抄了同一套 ~130 行分类视图逻辑：选中态判定、
// 学期分组、视角筛选（audio 档映射教师视角 + 同步全局画质偏好 + 按机位勾选）、
// 教师/PPT 计数、displayedItems 过滤、单文件直下调度（含假成功 toast 禁令）。
// 布局（网格卡片 vs 表格行）真正不同，留在各视图组件里。

export interface CategoryViewLogicParams {
  courses: NetdiskCourseItem[]
  currentCourse?: NetdiskCourseItem
  currentCategory?: NetdiskCategoryItem
  groupByTerm?: boolean
  hasSelection?: boolean
  onDownloadSingle?: (item: NetdiskFileItem, course?: NetdiskCourseItem, category?: NetdiskCategoryItem) => void
  perspective?: VideoPerspective
  onPerspectiveChange?: (perspective: VideoPerspective) => void
  showToast?: (text: string, type?: 'success' | 'info') => void
}

export function useCategoryViewLogic(params: CategoryViewLogicParams) {
  const { courses, currentCourse, currentCategory, groupByTerm = true, hasSelection, onDownloadSingle, perspective, onPerspectiveChange, showToast } = params

  const isSelected =
    hasSelection ??
    (courses.some(c => c.state !== 'none') ||
      currentCourse?.state !== 'none' ||
      currentCategory?.items.some(i => i.selected) ||
      false)

  const termGroups = useMemo(() => {
    if (!groupByTerm) return null
    return groupCoursesByTerm(courses)
  }, [courses, groupByTerm])

  const isVideoCat = isVideoCategory(currentCategory)
  const [internalPerspective, setInternalPerspective] = useState<VideoPerspective>('all')
  const activePerspective = perspective ?? currentCourse?.perspective ?? internalPerspective

  const handleFilterPerspectiveChange = useCallback((nextPerspective: VideoPerspective) => {
    setInternalPerspective(nextPerspective)
    onPerspectiveChange?.(nextPerspective)
    currentCourse?.onPerspectiveChange?.(nextPerspective)
    // [Bug Fix] audio 档原先被忽略（no-op）。机位含 audio 语义时同步全局画质偏好；
    // 纯音频模式下 PPT 路无独立音频流，按教师视角过滤（与 onDownload 的 angle===3 跳过一致）。
    applyVideoPerspectivePreference(nextPerspective)

    if (currentCategory) {
      const filterPerspective: VideoPerspective =
        nextPerspective === 'audio' ? 'teacher' : nextPerspective
      for (const item of currentCategory.items) {
        if (item.disabled) continue
        const isTeacher = isTeacherPerspectiveItem(item)
        const isPpt = isPptPerspectiveItem(item)

        if (filterPerspective === 'all') {
          if (!item.selected) item.onToggle()
        } else if (filterPerspective === 'teacher') {
          if (isTeacher && !item.selected) item.onToggle()
          if (!isTeacher && item.selected) item.onToggle()
        } else if (filterPerspective === 'ppt') {
          if (isPpt && !item.selected) item.onToggle()
          if (!isPpt && item.selected) item.onToggle()
        }
      }
    }
  }, [onPerspectiveChange, currentCourse, currentCategory])

  const { totalCount, teacherCount, pptCount } = useMemo(() => {
    if (!currentCategory) return { totalCount: 0, teacherCount: 0, pptCount: 0 }
    let teacher = 0
    let ppt = 0
    for (const item of currentCategory.items) {
      if (isTeacherPerspectiveItem(item)) teacher++
      if (isPptPerspectiveItem(item)) ppt++
    }
    if (teacher === 0 && ppt === 0) {
      teacher = currentCategory.items.length
    }
    return {
      totalCount: currentCategory.items.length,
      teacherCount: teacher,
      pptCount: ppt
    }
  }, [currentCategory])

  const displayedItems = useMemo(() => {
    if (!currentCategory) return []
    if (!isVideoCat) return currentCategory.items
    // audio 档在文件列表维度按教师视角展示（纯音频只有教师路）
    const filterPerspective: VideoPerspective = activePerspective === 'audio' ? 'teacher' : activePerspective
    if (filterPerspective === 'teacher') {
      return currentCategory.items.filter(isTeacherPerspectiveItem)
    }
    if (filterPerspective === 'ppt') {
      return currentCategory.items.filter(isPptPerspectiveItem)
    }
    return currentCategory.items
  }, [currentCategory, isVideoCat, activePerspective])

  const handleSingleDownload = useCallback((item: NetdiskFileItem) => {
    if (item.disabled) return
    // 直下必须存在真实回调（页面级 onDownloadSingle 或条目级 onDownloadSingle/onDownload）。
    // [Bug Fix] 原实现兜底"未勾选则 onToggle + toast 已开始下载"——在旁听/好大学等
    // 未接单文件直下的页面上，点击"下载"只做了勾选却谎报下载开始。禁止假成功提示：
    // 无真实回调时回退为勾选并提示需点主按钮，不冒充下载已启动。
    if (onDownloadSingle) {
      onDownloadSingle(item, currentCourse, currentCategory)
    } else if (item.onDownloadSingle) {
      item.onDownloadSingle()
    } else if (item.onDownload) {
      item.onDownload()
    } else {
      if (!item.selected) item.onToggle()
      showToast?.(`已勾选 "${item.name}"，点击「立即下载」开始传输`, 'info')
      return
    }
    showToast?.(`已开始下载 "${item.name}"`, 'success')
  }, [onDownloadSingle, currentCourse, currentCategory, showToast])

  return {
    isSelected,
    termGroups,
    isVideoCat,
    activePerspective,
    handleFilterPerspectiveChange,
    totalCount,
    teacherCount,
    pptCount,
    displayedItems,
    handleSingleDownload
  }
}

export interface VideoPerspectiveFilterPillsProps {
  perspective: VideoPerspective
  totalCount: number
  teacherCount: number
  pptCount: number
  onChange: (perspective: VideoPerspective) => void
}

export function VideoPerspectiveFilterPills({
  perspective,
  totalCount,
  teacherCount,
  pptCount,
  onChange
}: VideoPerspectiveFilterPillsProps) {
  return (
    <div
      role="radiogroup"
      aria-label="视频视角筛选"
      data-testid="video-filter-pills"
      className="inline-flex items-center rounded-lg border border-bd/80 bg-surface-2/60 p-0.5 text-xs select-none shadow-2xs"
    >
      <button
        type="button"
        role="radio"
        aria-checked={perspective === 'all'}
        onClick={() => onChange('all')}
        className={`px-2.5 py-1 rounded-md transition-all cursor-pointer font-sans ${
          perspective === 'all'
            ? 'bg-accent text-white font-medium shadow-xs'
            : 'text-text-2 hover:text-text-1 hover:bg-surface-1'
        }`}
      >
        全部视频 {totalCount}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={perspective === 'teacher'}
        onClick={() => onChange('teacher')}
        className={`px-2.5 py-1 rounded-md transition-all cursor-pointer font-sans ${
          perspective === 'teacher'
            ? 'bg-accent text-white font-medium shadow-xs'
            : 'text-text-2 hover:text-text-1 hover:bg-surface-1'
        }`}
      >
        仅教师视角 {teacherCount}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={perspective === 'ppt'}
        onClick={() => onChange('ppt')}
        className={`px-2.5 py-1 rounded-md transition-all cursor-pointer font-sans ${
          perspective === 'ppt'
            ? 'bg-accent text-white font-medium shadow-xs'
            : 'text-text-2 hover:text-text-1 hover:bg-surface-1'
        }`}
      >
        仅PPT投屏 {pptCount}
      </button>
    </div>
  )
}

export interface CategoryLevelHeaderProps {
  category: NetdiskCategoryItem
  displayedCount: number
  isVideoCategory: boolean
  perspective: VideoPerspective
  totalCount: number
  teacherCount: number
  pptCount: number
  onPerspectiveChange: (p: VideoPerspective) => void
}

export function CategoryLevelHeader({
  category,
  displayedCount,
  isVideoCategory: isVideo,
  perspective,
  totalCount,
  teacherCount,
  pptCount,
  onPerspectiveChange
}: CategoryLevelHeaderProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bd bg-surface-1 p-3">
      <div className="flex items-center gap-3">
        <span
          role="checkbox"
          aria-checked={category.state === 'all'}
          tabIndex={0}
          onClick={() => category.onToggle()}
          className="cursor-pointer"
        >
          <TriCheckbox state={category.state} size="sm" />
        </span>
        <div>
          <h2 className="text-sm font-bold text-text-1">{category.name}</h2>
          <div className="text-xs text-text-3">共 {displayedCount} 个文件</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {isVideo && (
          <VideoPerspectiveFilterPills
            perspective={perspective}
            totalCount={totalCount}
            teacherCount={teacherCount}
            pptCount={pptCount}
            onChange={onPerspectiveChange}
          />
        )}
        {category.isLoading && (
          <div className="flex items-center gap-2 text-xs text-text-2">
            <Spinner size={14} />
            <span>{category.loadingMessage || '正在加载文件…'}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 1. GridView (网格大图标视图)
// ─────────────────────────────────────────────────────────────

function CourseCard({
  course,
  onNavigate
}: {
  course: NetdiskCourseItem
  onNavigate: (next: NetdiskNavState) => void
}) {
  const c = course
  const isSelected = c.state !== 'none'
  return (
    <div
      key={c.id}
      onClick={() => c.onToggle()}
      onDoubleClick={() => {
        c.onEnter?.()
        onNavigate({ level: 'course', courseId: c.id })
      }}
      onMouseEnter={() => {
        c.onHover?.()
      }}
      className={`group relative flex flex-col items-center justify-start rounded-xl p-2.5 transition-all duration-150 cursor-pointer select-none ${
        isSelected
          ? 'bg-accent/15 ring-1 ring-accent/40 shadow-xs'
          : 'hover:bg-surface-2/70 active:bg-surface-3/50'
      }`}
      title={`${c.name} · 双击查看内容`}
    >
      {/* macOS 风格圆圈复选框 (左上角) */}
      <div
        className="absolute top-2 left-2 z-10"
        onClick={e => {
          e.stopPropagation()
          c.onToggle()
        }}
      >
        <MacOSCircleCheckbox
          state={c.state}
          size="sm"
          className={isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
        />
      </div>

      {/* 居中 macOS 风格大文件夹 (64px) */}
      <div className="my-1 flex h-16 w-16 items-center justify-center transition-transform duration-150 group-hover:scale-105 shrink-0">
        <MacOSFolderIcon size={64} />
      </div>

      {/* 居中标题与副标 (严格顶部对齐与固定基线) */}
      <div className="w-full flex flex-col items-center text-center mt-1.5">
        <h3
          className={`text-xs font-medium line-clamp-2 break-all leading-snug w-full px-1 h-9 flex items-start justify-center ${
            isSelected ? 'text-accent font-semibold' : 'text-text-1'
          }`}
          title={c.name}
        >
          {c.name}
        </h3>
        <div className="mt-0.5 text-2xs text-text-4 truncate w-full px-1 font-sans tabular-nums h-4 flex items-center justify-center">
          {c.teacher
            ? c.itemCount > 0
              ? `${c.teacher} · ${c.itemCount} 项`
              : c.teacher
            : c.itemCount > 0
              ? `${c.itemCount} 项`
              : ''}
        </div>
      </div>
    </div>
  )
}

export function GridView({
  courses,
  currentCourse,
  currentCategory,
  navState,
  onNavigate,
  groupByTerm = true,
  onDownloadSingle,
  onDownloadCourse: _onDownloadCourse,
  perspective,
  onPerspectiveChange,
  showToast,
  hasSelection
}: {
  courses: NetdiskCourseItem[]
  currentCourse?: NetdiskCourseItem
  currentCategory?: NetdiskCategoryItem
  navState: NetdiskNavState
  onNavigate: (next: NetdiskNavState) => void
  groupByTerm?: boolean
  onDownloadSingle?: (item: NetdiskFileItem, course?: NetdiskCourseItem, category?: NetdiskCategoryItem) => void
  onDownloadCourse?: (course: NetdiskCourseItem) => void
  perspective?: VideoPerspective
  onPerspectiveChange?: (perspective: VideoPerspective) => void
  showToast?: (text: string, type?: 'success' | 'info') => void
  hasSelection?: boolean
}) {
  const {
    isSelected,
    termGroups,
    isVideoCat,
    activePerspective,
    handleFilterPerspectiveChange,
    totalCount,
    teacherCount,
    pptCount,
    displayedItems,
    handleSingleDownload
  } = useCategoryViewLogic({
    courses,
    currentCourse,
    currentCategory,
    groupByTerm,
    hasSelection,
    onDownloadSingle,
    perspective,
    onPerspectiveChange,
    showToast
  })

  // 根目录：展示课程大文件夹网格
  if (navState.level === 'root' || !currentCourse) {
    return (
      <div className={`h-full overflow-y-auto p-1.5 ${isSelected ? 'pb-28' : 'pb-6'}`}>
        {termGroups ? (
          <div className="space-y-6">
            {termGroups.map(group => {
              const termState = getTermTriState(group.items)
              return (
                <div key={group.term} className="space-y-3">
                  <div className="flex items-center justify-between border-b border-bd/60 pb-2 px-1">
                    <div className="flex items-center gap-2.5">
                      <span
                        role="checkbox"
                        aria-checked={termState === 'all'}
                        tabIndex={0}
                        onClick={() => toggleTermCourses(group.items, termState)}
                        className="cursor-pointer shrink-0"
                        title={termState === 'all' ? '取消本学期全选' : '全选本学期课程'}
                      >
                        <TriCheckbox state={termState} size="sm" />
                      </span>
                      <span className="text-sm">📅</span>
                      <h3 className="text-xs font-bold text-text-1">{group.term}</h3>
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-2xs font-semibold text-accent">
                        {group.items.length} 门课程
                      </span>
                    </div>
                    <div className="flex items-center gap-2 select-none">
                      <button
                        type="button"
                        onClick={() => toggleTermCourses(group.items, termState)}
                        className="text-2xs text-text-3 hover:text-accent font-medium transition-colors cursor-pointer"
                      >
                        {termState === 'all' ? '取消全选' : '全选本学期'}
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3.5">
                    {group.items.map(c => (
                      <CourseCard key={c.id} course={c} onNavigate={onNavigate} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-3.5">
            {courses.map(c => (
              <CourseCard key={c.id} course={c} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>
    )
  }

  // 课程级目录：展示课程下二级分类文件夹网格（已彻底移除专属操作白板）
  if (navState.level === 'course' || !currentCategory) {
    return (
      <div className={`h-full overflow-y-auto p-1.5 ${isSelected ? 'pb-28' : 'pb-4'}`}>
        <div className="mb-4 flex items-center justify-between rounded-xl border border-bd bg-surface-1 p-3">
          <div className="flex items-center gap-3">
            <span
              role="checkbox"
              aria-checked={currentCourse.state === 'all'}
              tabIndex={0}
              onClick={() => currentCourse.onToggle()}
              className="cursor-pointer"
            >
              <TriCheckbox state={currentCourse.state} size="sm" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-text-1">{currentCourse.name}</h2>
              <div className="text-xs text-text-3">
                {currentCourse.teacher ? `${currentCourse.teacher} · ` : ''}{currentCourse.term || ''}{!currentCourse.isLoading && currentCourse.itemCount > 0 ? ` · 共 ${currentCourse.itemCount} 项资源` : ''}
              </div>
            </div>
          </div>
          {currentCourse.isLoading && (
            <div className="flex items-center gap-2 text-xs text-text-2">
              <Spinner size={14} />
              <span>{currentCourse.loadingMessage || '正在扫描内容…'}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3.5 pb-6">
          {currentCourse.categories.map(cat => {
            const isCatSelected = cat.state !== 'none'
            return (
              <div
                key={cat.id}
                onClick={() => cat.onToggle()}
                onDoubleClick={() => onNavigate({ level: 'category', courseId: currentCourse.id, categoryId: cat.id })}
                className={`group relative flex flex-col items-center justify-start rounded-xl p-2.5 transition-all duration-150 cursor-pointer select-none ${
                  isCatSelected
                    ? 'bg-accent/15 ring-1 ring-accent/40 shadow-xs'
                    : 'hover:bg-surface-2/70 active:bg-surface-3/50'
                }`}
                title={`${cat.name} · 双击查看内容`}
              >
                {/* macOS 风格圆圈复选框 (左上角) */}
                <div
                  className="absolute top-2 left-2 z-10"
                  onClick={e => {
                    e.stopPropagation()
                    cat.onToggle()
                  }}
                >
                  <MacOSCircleCheckbox
                    state={cat.state}
                    size="sm"
                    className={isCatSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                  />
                </div>

                {/* 居中大文件夹图标 (64px) */}
                <div className="my-1 flex h-16 w-16 items-center justify-center transition-transform duration-150 group-hover:scale-105 shrink-0">
                  <MacOSFolderIcon size={64} />
                </div>

                {/* 居中标题与副标 (严格顶部对齐与固定基线) */}
                <div className="w-full flex flex-col items-center text-center mt-1.5">
                  <h4
                    className={`text-xs font-medium line-clamp-2 break-all leading-snug w-full px-1 h-9 flex items-start justify-center ${
                      isCatSelected ? 'text-accent font-semibold' : 'text-text-1'
                    }`}
                  >
                    {cat.name}
                  </h4>
                  <div className="mt-0.5 text-2xs text-text-4 truncate w-full px-1 font-sans tabular-nums h-4 flex items-center justify-center">
                    {cat.items.length} 个文件
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // 三级分类目录：展示具体文件/视频流（顶部内嵌视角筛选器，支持单文件悬停极速下载）
  return (
    <div className={`h-full overflow-y-auto ${isSelected ? 'pb-28' : 'pb-4'}`}>
      <CategoryLevelHeader
        category={currentCategory}
        displayedCount={displayedItems.length}
        isVideoCategory={isVideoCat}
        perspective={activePerspective}
        totalCount={totalCount}
        teacherCount={teacherCount}
        pptCount={pptCount}
        onPerspectiveChange={handleFilterPerspectiveChange}
      />

      {displayedItems.length === 0 ? (
        <div className="py-12 text-center text-xs text-text-3">
          {currentCategory.emptyMessage || '该分类下暂无资源'}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-3 pb-6 select-none">
          {displayedItems.map(item => (
            <div
              key={item.id}
              onClick={() => {
                if (item.disabled) return
                item.onToggle()
              }}
              className={`group relative flex flex-col items-center justify-start rounded-xl p-2.5 transition-all duration-150 select-none ${
                item.disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : 'cursor-pointer ' + (item.selected ? 'bg-accent/15 ring-1 ring-accent/40 shadow-xs' : 'hover:bg-surface-2/70 active:bg-surface-3/50')
              }`}
              title={item.disabled ? item.disabledReason : `${item.name} · 点击勾选`}
            >
              {/* macOS 风格圆圈复选框 (左上角) */}
              <div
                className="absolute top-2 left-2 z-10"
                onClick={e => {
                  e.stopPropagation()
                  if (!item.disabled) item.onToggle()
                }}
              >
                <MacOSCircleCheckbox
                  checked={item.selected}
                  size="sm"
                  className={item.selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                />
              </div>

              {/* 悬停即现极速下载按钮 (右上角) */}
              {!item.disabled && (
                <button
                  type="button"
                  data-testid="single-download-btn"
                  title={`立即下载 ${item.name}`}
                  onClick={e => {
                    e.stopPropagation()
                    handleSingleDownload(item)
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-all absolute top-2 right-2 z-10 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-accent text-white text-[11px] font-medium shadow-sm hover:bg-accent-light active:scale-95 cursor-pointer"
                >
                  <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v13m0 0l-4-4m4 4l4-4M4 21h16" />
                  </svg>
                  <span>下载</span>
                </button>
              )}

              {/* 居中大文档图标 (58px) */}
              <div className="my-1 flex h-16 w-16 items-center justify-center transition-transform duration-150 group-hover:scale-105 shrink-0">
                <MacOSDocumentIcon filename={item.name} type={item.type} size={58} />
              </div>

              {/* 居中文件名与副标 (严格顶部对齐与固定基线) */}
              <div className="w-full flex flex-col items-center text-center mt-1.5">
                <span
                  className={`text-xs font-medium line-clamp-2 break-all leading-snug w-full px-1 h-9 flex items-start justify-center ${
                    item.disabled ? 'text-text-3' : item.selected ? 'text-accent font-semibold' : 'text-text-1'
                  }`}
                  title={item.name}
                >
                  {item.name}
                </span>
                <span className="mt-0.5 text-2xs text-text-4 truncate w-full px-1 font-sans tabular-nums h-4 flex items-center justify-center">
                  {item.disabledReason || (item.size ? formatBytes(item.size) : item.date || '文件')}
                </span>
              </div>

              {item.renderExtra && (
                <div className="mt-1 w-full" onClick={e => e.stopPropagation()}>
                  {item.renderExtra}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 2. ListView (详细列表视图)
// ─────────────────────────────────────────────────────────────

function CourseRow({
  course,
  onNavigate
}: {
  course: NetdiskCourseItem
  onNavigate: (next: NetdiskNavState) => void
}) {
  const c = course
  return (
    <tr
      key={c.id}
      onClick={() => {
        c.onEnter?.()
        onNavigate({ level: 'course', courseId: c.id, categoryId: c.categories[0]?.id })
      }}
      onMouseEnter={() => {
        c.onHover?.()
      }}
      className="hover:bg-surface-2/60 transition-colors cursor-pointer"
    >
      <td className="py-2.5 px-4">
        <div className="flex items-center gap-2.5">
          <span
            role="checkbox"
            aria-checked={c.state === 'all'}
            tabIndex={0}
            onClick={e => {
              e.stopPropagation()
              c.onToggle()
            }}
            className="cursor-pointer"
          >
            <TriCheckbox state={c.state} size="sm" />
          </span>
          <FolderIcon className="h-4 w-4 text-accent shrink-0" />
          <span className="font-semibold text-text-1 truncate max-w-sm" title={c.name}>
            {c.name}
          </span>
        </div>
      </td>
      <td className="py-2.5 px-4 text-text-3 font-mono">
        {c.term || c.teacher || '—'}
      </td>
      <td className="py-2.5 px-4 text-text-3 font-mono">
        {c.itemCount > 0 ? c.itemCount : '—'}
      </td>
      <td className="py-2.5 px-4 text-text-3 font-mono">
        {c.totalBytes ? formatBytes(c.totalBytes) : '—'}
      </td>
      <td className="py-2.5 px-4 text-right">
        <button
          type="button"
          className="text-accent hover:underline font-medium"
        >
          查看内容 ›
        </button>
      </td>
    </tr>
  )
}

export function ListView({
  courses,
  currentCourse,
  currentCategory,
  navState,
  onNavigate,
  groupByTerm = true,
  onDownloadSingle,
  onDownloadCourse: _onDownloadCourse,
  perspective,
  onPerspectiveChange,
  showToast,
  hasSelection
}: {
  courses: NetdiskCourseItem[]
  currentCourse?: NetdiskCourseItem
  currentCategory?: NetdiskCategoryItem
  navState: NetdiskNavState
  onNavigate: (next: NetdiskNavState) => void
  groupByTerm?: boolean
  onDownloadSingle?: (item: NetdiskFileItem, course?: NetdiskCourseItem, category?: NetdiskCategoryItem) => void
  onDownloadCourse?: (course: NetdiskCourseItem) => void
  perspective?: VideoPerspective
  onPerspectiveChange?: (perspective: VideoPerspective) => void
  showToast?: (text: string, type?: 'success' | 'info') => void
  hasSelection?: boolean
}) {
  const {
    isSelected,
    termGroups,
    isVideoCat,
    activePerspective,
    handleFilterPerspectiveChange,
    totalCount,
    teacherCount,
    pptCount,
    displayedItems,
    handleSingleDownload
  } = useCategoryViewLogic({
    courses,
    currentCourse,
    currentCategory,
    groupByTerm,
    hasSelection,
    onDownloadSingle,
    perspective,
    onPerspectiveChange,
    showToast
  })

  // 根目录列表
  if (navState.level === 'root' || !currentCourse) {
    return (
      <div className={`h-full overflow-y-auto rounded-xl border border-bd bg-surface-1 shadow-2xs ${isSelected ? 'pb-28' : ''}`}>
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-surface-2 text-text-2 border-b border-bd z-10">
            <tr>
              <th className="py-2.5 px-4 font-semibold">课程名称</th>
              <th className="py-2.5 px-4 font-semibold">学期 / 教师</th>
              <th className="py-2.5 px-4 font-semibold">资源数量</th>
              <th className="py-2.5 px-4 font-semibold">大小</th>
              <th className="py-2.5 px-4 font-semibold text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bd/50">
            {termGroups ? (
              termGroups.map(group => {
                const termState = getTermTriState(group.items)
                return (
                  <Fragment key={group.term}>
                    <tr className="bg-surface-2/70 font-semibold text-text-2">
                      <td colSpan={5} className="py-2 px-4 border-y border-bd/40">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <span
                              role="checkbox"
                              aria-checked={termState === 'all'}
                              tabIndex={0}
                              onClick={e => {
                                e.stopPropagation()
                                toggleTermCourses(group.items, termState)
                              }}
                              className="cursor-pointer shrink-0"
                              title={termState === 'all' ? '取消本学期全选' : '全选本学期课程'}
                            >
                              <TriCheckbox state={termState} size="sm" />
                            </span>
                            <span>📅</span>
                            <span>{group.term}</span>
                            <span className="text-2xs text-text-3 font-normal">{group.items.length} 门课程</span>
                          </div>
                          <div className="flex items-center gap-2 select-none">
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation()
                                toggleTermCourses(group.items, termState)
                              }}
                              className="text-2xs text-accent hover:underline font-normal cursor-pointer"
                            >
                              {termState === 'all' ? '取消全选' : '全选本学期'}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                    {group.items.map(c => (
                      <CourseRow key={c.id} course={c} onNavigate={onNavigate} />
                    ))}
                  </Fragment>
                )
              })
            ) : (
              courses.map(c => (
                <CourseRow key={c.id} course={c} onNavigate={onNavigate} />
              ))
            )}
          </tbody>
        </table>
      </div>
    )
  }

  // 课程分类列表（已彻底移除专属操作白板）
  if (navState.level === 'course' || !currentCategory) {
    return (
      <div className={`h-full overflow-y-auto rounded-xl border border-bd bg-surface-1 shadow-2xs ${isSelected ? 'pb-28' : ''}`}>
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-surface-2 text-text-2 border-b border-bd z-10">
            <tr>
              <th className="py-2.5 px-4 font-semibold">分类名称</th>
              <th className="py-2.5 px-4 font-semibold">资源数量</th>
              <th className="py-2.5 px-4 font-semibold text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bd/50">
            {currentCourse.categories.map(cat => (
              <tr
                key={cat.id}
                onClick={() => onNavigate({ level: 'category', courseId: currentCourse.id, categoryId: cat.id })}
                className="hover:bg-surface-2/60 transition-colors cursor-pointer"
              >
                <td className="py-2.5 px-4">
                  <div className="flex items-center gap-2.5">
                    <span
                      role="checkbox"
                      aria-checked={cat.state === 'all'}
                      tabIndex={0}
                      onClick={e => {
                        e.stopPropagation()
                        cat.onToggle()
                      }}
                      className="cursor-pointer"
                    >
                      <TriCheckbox state={cat.state} size="sm" />
                    </span>
                    <CategoryIcon icon={cat.icon} />
                    <span className="font-semibold text-text-1">{cat.name}</span>
                  </div>
                </td>
                <td className="py-2.5 px-4 text-text-3 font-mono">
                  {cat.items.length}
                </td>
                <td className="py-2.5 px-4 text-right">
                  <button type="button" className="text-accent hover:underline font-medium">
                    进入 ›
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // 具体资源列表（顶部内嵌视角筛选器，支持单文件悬停极速下载）
  return (
    <div className={`h-full overflow-y-auto space-y-3 ${isSelected ? 'pb-28' : 'pb-4'}`}>
      <CategoryLevelHeader
        category={currentCategory}
        displayedCount={displayedItems.length}
        isVideoCategory={isVideoCat}
        perspective={activePerspective}
        totalCount={totalCount}
        teacherCount={teacherCount}
        pptCount={pptCount}
        onPerspectiveChange={handleFilterPerspectiveChange}
      />

      {displayedItems.length === 0 ? (
        <div className="py-12 text-center text-xs text-text-3">
          {currentCategory.emptyMessage || '该分类下暂无资源'}
        </div>
      ) : (
        <div className="rounded-xl border border-bd bg-surface-1 shadow-2xs overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface-2 text-text-2 border-b border-bd z-10">
              <tr>
                <th className="py-2.5 px-4 font-semibold">文件名 / 标题</th>
                <th className="py-2.5 px-4 font-semibold">大小</th>
                <th className="py-2.5 px-4 font-semibold">类型</th>
                <th className="py-2.5 px-4 font-semibold">日期</th>
                <th className="py-2.5 px-4 font-semibold text-right">状态 / 操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bd/50">
              {displayedItems.map(item => (
                <tr
                  key={item.id}
                  onClick={() => {
                    if (item.disabled) return
                    item.onToggle()
                  }}
                  className={`group transition-colors ${
                    item.disabled
                      ? 'opacity-60 bg-surface-2/20 cursor-not-allowed'
                      : 'hover:bg-surface-2/60 cursor-pointer'
                  }`}
                >
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2.5">
                      <span className="shrink-0" onClick={e => e.stopPropagation()}>
                        <ItemCheckbox
                          checked={item.selected}
                          disabled={item.disabled}
                          onChange={() => {
                            if (item.disabled) return
                            item.onToggle()
                          }}
                        />
                      </span>
                      <FileTypeBadge filename={item.name} type={item.type} />
                      <span className={`font-medium truncate max-w-md ${item.disabled ? 'text-text-3' : 'text-text-1'}`} title={item.name}>
                        {item.name}
                      </span>
                      {item.disabledReason && (
                        <span className="shrink-0 rounded bg-surface-3/80 px-1.5 py-0.2 text-2xs text-text-3 border border-bd/40 font-sans">
                          {item.disabledReason}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-text-3 font-mono">
                    {item.size ? formatBytes(item.size) : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-text-3 font-mono uppercase">
                    {item.type || 'FILE'}
                  </td>
                  <td className="py-2.5 px-4 text-text-3 font-mono">
                    {item.date || '—'}
                  </td>
                  <td className="py-2.5 px-4 text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      {!item.disabled && (
                        <button
                          type="button"
                          data-testid="single-download-btn"
                          title={`立即下载 ${item.name}`}
                          onClick={e => {
                            e.stopPropagation()
                            handleSingleDownload(item)
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-all inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent text-white text-[11px] font-medium shadow-xs hover:bg-accent-light active:scale-95 cursor-pointer"
                        >
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 3v13m0 0l-4-4m4 4l4-4M4 21h16" />
                          </svg>
                          <span>下载</span>
                        </button>
                      )}
                      {item.renderExtra || (
                        <span className={`text-text-4 font-mono ${!item.disabled ? 'group-hover:hidden' : ''}`}>待下载</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 3. ColumnView (分栏多级并列视图 / macOS Miller Columns)
// ─────────────────────────────────────────────────────────────

export interface CourseResourceBreakdown {
  filesCount: number
  fileBytes: number
  videoCount: number
  assignmentCount: number
  hasVideos: boolean
  hasAssignments: boolean
  pptPdfAvailable: boolean
}

export function getCourseResourceBreakdown(course: NetdiskCourseItem): CourseResourceBreakdown {
  let filesCount = 0
  let fileBytes = 0
  let videoCount = 0
  let assignmentCount = 0
  let pptPdfAvailable = false

  for (const cat of course.categories) {
    const isVideoCat = cat.icon === 'video' || cat.icon === 'audio' || cat.id === 'videos' || cat.id === 'teacher'
    const isAssignCat = cat.icon === 'assignment' || cat.id === 'assignments'
    const isPptPdfCat = cat.id === 'pptPdf' || cat.id === 'ppt-pdf'

    if (isPptPdfCat) {
      pptPdfAvailable = true
      continue
    }

    if (isAssignCat) {
      assignmentCount += cat.items.length
      continue
    }

    if (isVideoCat) {
      videoCount = Math.max(videoCount, cat.items.length)
      continue
    }

    if (cat.id === 'ppt') {
      videoCount = Math.max(videoCount, cat.items.length)
      continue
    }

    for (const it of cat.items) {
      const ext = it.name.split('.').pop()?.toLowerCase() || ''
      const isVideoItem =
        it.type === 'MP4' ||
        it.type === 'M4A' ||
        it.type === 'video' ||
        ['mp4', 'mkv', 'mov', 'flv', 'ts', 'webm', 'mp3', 'm4a'].includes(ext)
      if (isVideoItem) {
        videoCount++
      } else {
        filesCount++
        fileBytes += it.size || 0
      }
    }
  }

  if (fileBytes === 0 && course.totalBytes) {
    fileBytes = course.totalBytes
  }

  if (filesCount === 0 && videoCount === 0 && assignmentCount === 0 && course.itemCount > 0) {
    filesCount = course.itemCount
  }

  const hasVideos =
    videoCount > 0 ||
    course.categories.some(c => c.icon === 'video' || c.icon === 'audio' || c.id === 'videos' || c.id === 'teacher')

  return {
    filesCount,
    fileBytes,
    videoCount,
    assignmentCount,
    hasVideos,
    hasAssignments: assignmentCount > 0,
    pptPdfAvailable: pptPdfAvailable || hasVideos
  }
}

export interface CourseOverviewInspectorProps {
  course: NetdiskCourseItem
  category?: NetdiskCategoryItem
  perspective?: VideoPerspective
  onPerspectiveChange?: (perspective: VideoPerspective) => void
  hasPptPdf?: boolean
  onTogglePptPdf?: (enabled: boolean) => void
  onDownloadCourse?: (course: NetdiskCourseItem) => void
}

export function CourseOverviewInspector({
  course,
  category,
  perspective,
  onPerspectiveChange,
  hasPptPdf,
  onTogglePptPdf,
  onDownloadCourse
}: CourseOverviewInspectorProps) {
  const [internalPerspective, setInternalPerspective] = useState<VideoPerspective>('teacher')
  const activePerspective: VideoPerspective = perspective ?? course.perspective ?? internalPerspective

  const pptCat = course.categories.find(c => c.id === 'pptPdf' || c.id === 'ppt-pdf')
  const defaultPptPdf = pptCat ? pptCat.state === 'all' : false
  const [internalPptPdf, setInternalPptPdf] = useState<boolean>(defaultPptPdf)
  const isPptPdfOn = hasPptPdf ?? course.hasPptPdf ?? (pptCat ? pptCat.state === 'all' : internalPptPdf)

  const { toast, showToast, hideToast } = useToast(2500)

  const breakdown = useMemo(() => getCourseResourceBreakdown(course), [course])

  const estimated = useMemo(() => {
    return estimateResourceSize({
      fileBytes: breakdown.fileBytes,
      videoCount: breakdown.videoCount,
      perspective: activePerspective,
      hasAssignments: breakdown.hasAssignments,
      assignmentCount: breakdown.assignmentCount,
      hasPptPdf: isPptPdfOn,
      pptPdfCount: breakdown.videoCount > 0 ? breakdown.videoCount : 1
    })
  }, [breakdown, activePerspective, isPptPdfOn])

  const handlePerspectiveSelect = (p: VideoPerspective) => {
    setInternalPerspective(p)
    // [Bug Fix] audio 档原先被忽略（no-op）。同步全局画质偏好（audio_only ↔ 机位互斥）
    applyVideoPerspectivePreference(p)
    onPerspectiveChange?.(p)
    course.onPerspectiveChange?.(p)
  }

  const handleTogglePptPdf = () => {
    const nextVal = !isPptPdfOn
    setInternalPptPdf(nextVal)
    if (pptCat) {
      pptCat.onToggle()
    }
    onTogglePptPdf?.(nextVal)
    course.onTogglePptPdf?.(nextVal)
  }

  const handleDownloadCourse = () => {
    // [Bug Fix] 原实现兜底"未全选则 onToggle + toast 已开始下载全部资源"——在未接
    // 页面级提交回调（onDownloadCourse / course.onDownload）的页面上是死按钮 + 假成功。
    // 无真实回调时改为切换整课勾选态并如实提示，禁止谎报"已开始下载"。
    if (onDownloadCourse) {
      onDownloadCourse(course)
    } else if (course.onDownload) {
      course.onDownload()
    } else {
      course.onToggle()
      showToast(
        course.state === 'all'
          ? `已取消勾选 "${course.name}"`
          : `已勾选 "${course.name}"，点击「立即下载」开始传输`,
        'info'
      )
      return
    }
    showToast(`已开始下载课程 "${course.name}" 全部资源`, 'success')
  }

  const perspectiveOptions: Array<{ key: VideoPerspective; label: string }> = [
    { key: 'all', label: '双机位' },
    { key: 'teacher', label: '仅教师' },
    { key: 'ppt', label: '仅PPT' },
    { key: 'audio', label: '仅音频' }
  ]

  return (
    <div
      data-testid="course-overview-inspector"
      className="flex w-80 md:w-96 shrink-0 flex-col bg-surface-1 p-5 overflow-y-auto border-l border-bd/60 select-none h-full relative animate-fadeIn"
    >
      {/* 顶部标题区 */}
      <div className="pb-3 border-b border-bd/60 shrink-0">
        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
          <span className="text-2xs font-semibold text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/20">
            {category ? '分类与课程概览' : '课程概览'}
          </span>
          {course.term && (
            <span className="text-2xs font-mono text-text-3 bg-surface-2 px-1.5 py-0.5 rounded border border-bd/40">
              {course.term}
            </span>
          )}
          {course.code && (
            <span className="text-2xs font-mono text-text-3 bg-surface-2 px-1.5 py-0.5 rounded border border-bd/40">
              {course.code}
            </span>
          )}
          {course.teacher && (
            <span className="text-2xs text-text-3 bg-surface-2 px-1.5 py-0.5 rounded border border-bd/40">
              👨‍🏫 {course.teacher}
            </span>
          )}
          {course.badge && (
            <span className="text-2xs font-semibold text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
              {course.badge}
            </span>
          )}
        </div>
        <h2 className="text-sm font-bold text-text-1 leading-snug break-words" title={course.name}>
          {course.name}
        </h2>
        {category && (
          <div className="mt-1 flex items-center gap-1 text-2xs text-text-3">
            <span>当前浏览分类:</span>
            <span className="font-semibold text-text-2">{category.name}</span>
            <span className="font-mono text-text-4">({category.items.length})</span>
          </div>
        )}
      </div>

      {/* 资源结构与容量预估卡片 */}
      <div className="my-3 rounded-xl border border-bd/80 bg-surface-2/60 p-3.5 space-y-2 shrink-0 shadow-2xs">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-3 font-medium">预估总容量</span>
          <span className="font-mono text-sm font-bold text-accent" data-testid="course-estimated-size">
            {estimated.formattedSize}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-bd/40 text-xs">
          <div className="flex flex-col">
            <span className="text-text-4 text-2xs">课件资料</span>
            <span className="text-text-1 font-mono font-semibold">
              {breakdown.filesCount} 项{breakdown.fileBytes > 0 ? ` · ${formatBytes(breakdown.fileBytes)}` : ''}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-text-4 text-2xs">课堂录播</span>
            <span className="text-text-1 font-mono font-semibold">
              {breakdown.videoCount > 0 ? `${breakdown.videoCount} 讲` : '无录播'}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-text-4 text-2xs">课程作业</span>
            <span className="text-text-1 font-mono font-semibold">
              {breakdown.assignmentCount > 0 ? `${breakdown.assignmentCount} 项` : '无作业'}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-text-4 text-2xs">PPT 讲义 PDF</span>
            <span className="text-text-1 font-mono font-semibold">
              {isPptPdfOn ? (breakdown.videoCount > 0 ? `预估 ${breakdown.videoCount} 份` : '已开启') : '未开启'}
            </span>
          </div>
        </div>
      </div>

      {/* 录播机位下载偏好单选组（仅当有录播时渲染） */}
      {breakdown.hasVideos && (
        <div className="my-2 rounded-xl border border-bd/80 bg-surface-2/40 p-3 shrink-0" data-testid="video-perspective-selector">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-text-2">录播机位偏好</span>
            <span className="text-2xs text-text-4">已选择: {perspectiveOptions.find(o => o.key === activePerspective)?.label}</span>
          </div>
          <div className="grid grid-cols-4 gap-1 p-0.5 rounded-lg bg-surface-3/60 border border-bd/40" role="radiogroup" aria-label="录播机位偏好">
            {perspectiveOptions.map(opt => {
              const isSelected = activePerspective === opt.key
              return (
                <button
                  key={opt.key}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  data-perspective={opt.key}
                  onClick={() => handlePerspectiveSelect(opt.key)}
                  className={`py-1.5 px-1 text-center text-xs rounded-md transition-all cursor-pointer font-medium ${
                    isSelected
                      ? 'bg-accent text-white shadow-xs font-semibold'
                      : 'text-text-2 hover:text-text-1 hover:bg-surface-2'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 增值导出快速开关：提取并生成 PPT 讲义 */}
      <div className="my-2 rounded-xl border border-bd/80 bg-surface-2/40 p-3 flex items-center justify-between gap-3 shrink-0">
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-xs font-semibold text-text-2 flex items-center gap-1.5">
            <span>📑</span>
            <span>提取并生成 PPT 讲义</span>
          </span>
          <span className="text-2xs text-text-4 mt-0.5 truncate">
            从视频画面自动去重合成高清 PDF 讲义
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isPptPdfOn}
          aria-label="提取并生成 PPT 讲义"
          onClick={handleTogglePptPdf}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
            isPptPdfOn ? 'bg-accent' : 'bg-surface-4'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
              isPptPdfOn ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* 勾选状态指示 */}
      <div className="mt-2 mb-1 flex items-center justify-between text-xs text-text-3 px-1 shrink-0">
        <span>课程勾选状态</span>
        <span className={`font-semibold ${course.state === 'all' ? 'text-accent' : course.state === 'some' ? 'text-warning' : 'text-text-4'}`}>
          {course.state === 'all' ? '已全选' : course.state === 'some' ? '部分已选' : '未勾选'}
        </span>
      </div>

      {/* Toast 提示浮条 */}
      <Toast toast={toast} onClose={hideToast} position="bottom-wide" />

      {/* 底部主执行按钮 */}
      <div className="mt-auto pt-3 shrink-0">
        <button
          type="button"
          data-testid="course-download-cta"
          onClick={handleDownloadCourse}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-white shadow-glow-sm hover:bg-accent-light active:scale-[0.98] transition-all cursor-pointer"
        >
          <span>⬇ 立即下载本门课程全部资源 · {estimated.formattedSize}</span>
        </button>
      </div>
    </div>
  )
}

export interface FileDetailInspectorProps {
  item: NetdiskFileItem
  course?: NetdiskCourseItem
  category?: NetdiskCategoryItem
  onClose: () => void
  onDownloadSingle?: (item: NetdiskFileItem, course?: NetdiskCourseItem, category?: NetdiskCategoryItem) => void
}

export function FileDetailInspector({
  item,
  course,
  category,
  onClose,
  onDownloadSingle
}: FileDetailInspectorProps) {
  const { toast, showToast, hideToast } = useToast(2500)

  const handleDownloadSingle = () => {
    if (item.disabled) return
    // [Bug Fix] 同 Grid/ListView：无真实直下回调时禁止假"已开始下载"toast
    if (onDownloadSingle) {
      onDownloadSingle(item, course, category)
    } else if (item.onDownload) {
      item.onDownload()
    } else if (item.onDownloadSingle) {
      item.onDownloadSingle()
    } else {
      if (!item.selected) {
        item.onToggle()
      }
      showToast(`已勾选 "${item.name}"，点击「立即下载」开始传输`, 'info')
      return
    }
    showToast(`已开始下载 "${item.name}"`, 'success')
  }

  const ext = item.name.split('.').pop()?.toLowerCase() || ''
  const isVideo = ['mp4', 'mkv', 'mov', 'flv', 'ts', 'webm'].includes(ext) || item.type === 'MP4'
  const isAudio = ['mp3', 'm4a', 'wav', 'aac', 'flac'].includes(ext) || item.type === 'M4A'

  return (
    <div
      data-testid="file-detail-inspector"
      className="flex w-80 md:w-96 shrink-0 flex-col bg-surface-1 p-5 overflow-y-auto border-l border-bd/60 select-none h-full relative animate-fadeIn"
    >
      {/* 顶部标题区与关闭按钮 */}
      <div className="flex items-center justify-between pb-3 border-b border-bd/60 shrink-0">
        <span className="text-xs font-bold text-text-2">课件详情与预览</span>
        <button
          type="button"
          onClick={onClose}
          className="text-text-4 hover:text-text-1 text-xs p-1 rounded-md hover:bg-surface-3 transition-colors cursor-pointer"
          title="关闭详情面板"
          aria-label="关闭详情面板"
        >
          ✕
        </button>
      </div>

      {/* 缩略图与大图标预览 */}
      <div className="my-4 shrink-0">
        {isVideo ? (
          <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black flex items-center justify-center shadow-md">
            <div className="flex flex-col items-center justify-center text-white/90 gap-2 p-4 text-center">
              <span className="text-4xl">🎬</span>
              <span className="text-xs font-semibold">课堂视频 / 录播课件</span>
              <span className="text-2xs text-white/60">可直接点击下方按钮即时单文件下载</span>
            </div>
          </div>
        ) : isAudio ? (
          <div className="w-full rounded-xl bg-surface-2 p-5 flex flex-col items-center border border-bd/60 shadow-xs">
            <div className="h-16 w-16 rounded-2xl bg-cyan-500/10 text-cyan-500 flex items-center justify-center text-3xl mb-2 shadow-inner">
              🎵
            </div>
            <span className="text-xs font-medium text-text-2">音频课件</span>
          </div>
        ) : (
          <div className="w-full rounded-xl bg-surface-2/60 p-6 flex flex-col items-center justify-center border border-bd/60 shadow-xs">
            <div className="scale-125 mb-2">
              <FileTypeBadge filename={item.name} type={item.type} />
            </div>
            <span className="text-2xs font-mono font-bold text-text-3 uppercase tracking-wider mt-2">
              {ext || item.type || 'DOCUMENT'}
            </span>
          </div>
        )}
      </div>

      {/* 文件名 */}
      <h3 className="text-sm font-bold text-text-1 break-all select-text leading-snug mb-3 shrink-0" title={item.name}>
        {item.name}
      </h3>

      {/* 详细元数据表 */}
      <div className="w-full rounded-xl border border-bd/80 bg-surface-2/60 p-3.5 text-left text-xs divide-y divide-bd/40 space-y-2 mb-4 shrink-0 shadow-2xs">
        {course?.name && (
          <div className="flex justify-between py-1">
            <span className="text-text-3">所属课程</span>
            <span className="font-semibold text-text-1 text-2xs truncate max-w-[180px]" title={course.name}>
              {course.name}
            </span>
          </div>
        )}
        {category?.name && (
          <div className="flex justify-between py-1">
            <span className="text-text-3">所属分类</span>
            <span className="font-semibold text-text-1 text-2xs">
              {category.name}
            </span>
          </div>
        )}
        <div className="flex justify-between py-1">
          <span className="text-text-3">文件大小</span>
          <span className="font-mono font-bold text-accent">
            {item.size ? formatBytes(item.size) : '未知'}
          </span>
        </div>
        {item.date && (
          <div className="flex justify-between py-1">
            <span className="text-text-3">讲次/时间</span>
            <span className="font-mono text-text-2 text-2xs">
              {item.date}
            </span>
          </div>
        )}
        <div className="flex justify-between py-1">
          <span className="text-text-3">状态</span>
          <span className={`text-2xs font-medium ${item.disabled ? 'text-warning' : item.selected ? 'text-accent' : 'text-text-3'}`}>
            {item.disabled ? (item.disabledReason || '不可用') : item.selected ? '已加入清单' : '未选择'}
          </span>
        </div>
      </div>

      {item.renderExtra && (
        <div className="w-full mb-4 p-3 rounded-xl bg-surface-2/50 border border-bd/50 text-xs shrink-0">
          <div className="text-2xs font-semibold text-text-3 mb-1.5 uppercase tracking-wider">资源属性</div>
          {item.renderExtra}
        </div>
      )}

      {/* Toast 提示浮条 */}
      <Toast toast={toast} onClose={hideToast} position="bottom-wide" />

      {/* 底部双按钮操作区 */}
      <div className="flex flex-col gap-2 mt-auto shrink-0 pt-2">
        <button
          type="button"
          data-testid="file-download-btn"
          disabled={item.disabled}
          onClick={handleDownloadSingle}
          className={`w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
            item.disabled
              ? 'bg-surface-3 text-text-4 cursor-not-allowed opacity-60'
              : 'bg-accent text-white shadow-glow-sm hover:bg-accent-light active:scale-[0.98]'
          }`}
        >
          <span>⬇ 立即下载此文件</span>
        </button>

        <button
          type="button"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return
            item.onToggle()
          }}
          className={`w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-medium border transition-all cursor-pointer ${
            item.disabled
              ? 'border-bd/40 bg-surface-2 text-text-4 cursor-not-allowed opacity-60'
              : item.selected
              ? 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20'
              : 'border-bd bg-surface-2 text-text-2 hover:bg-surface-3 hover:text-text-1'
          }`}
        >
          <span>{item.selected ? '✓ 已加入清单 · 点击取消' : '+ 勾选此文件加入清单'}</span>
        </button>
      </div>
    </div>
  )
}

export interface ColumnViewProps {
  courses: NetdiskCourseItem[]
  activeCourse?: NetdiskCourseItem
  activeCategory?: NetdiskCategoryItem
  onSelectCourse: (c: NetdiskCourseItem) => void
  onSelectCategory: (cat: NetdiskCategoryItem) => void
  groupByTerm?: boolean
  onDownloadSingle?: (item: NetdiskFileItem, course?: NetdiskCourseItem, category?: NetdiskCategoryItem) => void
  onDownloadCourse?: (course: NetdiskCourseItem) => void
  perspective?: VideoPerspective
  onPerspectiveChange?: (perspective: VideoPerspective) => void
  hasPptPdf?: boolean
  onTogglePptPdf?: (enabled: boolean) => void
  selectedFileItem?: NetdiskFileItem | null
  onSelectFileItem?: (item: NetdiskFileItem | null) => void
}

export function ColumnView({
  courses,
  activeCourse,
  activeCategory,
  onSelectCourse,
  onSelectCategory,
  groupByTerm = true,
  onDownloadSingle,
  onDownloadCourse,
  perspective,
  onPerspectiveChange,
  hasPptPdf,
  onTogglePptPdf,
  selectedFileItem: controlledSelectedFile,
  onSelectFileItem
}: ColumnViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [internalSelectedFile, setInternalSelectedFile] = useState<NetdiskFileItem | null>(null)

  const selectedFileItem = controlledSelectedFile !== undefined ? controlledSelectedFile : internalSelectedFile
  const setSelectedFileItem = useCallback(
    (item: NetdiskFileItem | null) => {
      setInternalSelectedFile(item)
      onSelectFileItem?.(item)
    },
    [onSelectFileItem]
  )

  // 当切换课程或分类时，如果已选文件不在新分类中，则自动清空预览状态
  useEffect(() => {
    if (!activeCategory || !selectedFileItem) return
    const exists = activeCategory.items.some(it => it.id === selectedFileItem.id)
    if (!exists) {
      setSelectedFileItem(null)
    }
  }, [activeCategory, selectedFileItem, setSelectedFileItem])

  const scrollToRight = useCallback(() => {
    requestAnimationFrame(() => {
      if (containerRef.current) {
        containerRef.current.scrollTo({
          left: containerRef.current.scrollWidth,
          behavior: 'smooth'
        })
      }
    })
  }, [])

  const termGroups = useMemo(() => {
    if (!groupByTerm) return null
    return groupCoursesByTerm(courses)
  }, [courses, groupByTerm])

  const renderColumnCourseItem = (c: NetdiskCourseItem) => {
    const isSelected = activeCourse?.id === c.id
    return (
      <div
        key={c.id}
        onClick={() => {
          onSelectCourse(c)
          scrollToRight()
        }}
        onMouseEnter={() => {
          c.onHover?.()
        }}
        className={`group flex items-center justify-between px-3 py-2 transition-all cursor-pointer mx-2 my-0.5 rounded-xl ${
          isSelected
            ? 'bg-accent/10 text-accent font-semibold shadow-2xs'
            : 'hover:bg-surface-2/70 text-text-1'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span
            role="checkbox"
            aria-checked={c.state === 'all'}
            tabIndex={0}
            onClick={e => {
              e.stopPropagation()
              c.onToggle()
            }}
            className="cursor-pointer shrink-0"
          >
            <TriCheckbox state={c.state} size="sm" />
          </span>
          <FolderIcon className={`h-4 w-4 shrink-0 ${isSelected ? 'text-accent' : 'text-amber-500'}`} />
          <span className="truncate text-xs min-w-0 flex-1" title={c.name}>
            {c.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-1.5">
          {c.itemCount > 0 ? (
            <span className="text-[11px] font-mono opacity-70">
              {c.itemCount}
            </span>
          ) : null}
          <span className={`text-xs font-mono transition-transform ${isSelected ? 'text-accent font-bold translate-x-0.5' : 'text-text-4 group-hover:text-text-3'}`}>
            ›
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full flex-row overflow-x-auto divide-x divide-bd/60 rounded-2xl border border-bd bg-surface-1 shadow-card select-none scroll-smooth"
    >
      {/* 第 1 栏：课程列表 */}
      <div className="flex w-64 md:w-72 shrink-0 flex-col bg-surface-1/40 h-full">
        <div className="flex h-10 items-center justify-between border-b border-bd/60 bg-surface-2/30 px-4 text-xs font-semibold text-text-2 select-none shrink-0">
          <span>全部课程 · {courses.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {termGroups ? (
            termGroups.map(group => {
              const termState = getTermTriState(group.items)
              return (
                <div key={group.term} className="mb-2">
                  <div className="sticky top-0 z-10 flex items-center justify-between border-y border-bd/40 bg-surface-2/95 px-3 py-1 text-2xs font-semibold text-text-3 backdrop-blur-xs select-none">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        role="checkbox"
                        aria-checked={termState === 'all'}
                        tabIndex={0}
                        onClick={() => toggleTermCourses(group.items, termState)}
                        className="cursor-pointer shrink-0"
                        title={termState === 'all' ? '取消本学期全选' : '全选本学期课程'}
                      >
                        <TriCheckbox state={termState} size="sm" />
                      </span>
                      <span className="truncate">📅 {group.term}</span>
                    </div>
                    <span className="font-mono text-text-4 shrink-0">{group.items.length}</span>
                  </div>
                  <div className="pt-1">
                    {group.items.map(c => renderColumnCourseItem(c))}
                  </div>
                </div>
              )
            })
          ) : (
            courses.map(c => renderColumnCourseItem(c))
          )}
        </div>
      </div>

      {/* 第 2 栏：二级资源分类（严格单层步进：仅在选定课程后滑出展示） */}
      {activeCourse && (
        <div className="flex w-64 md:w-72 shrink-0 flex-col bg-surface-1/40 h-full animate-fadeIn">
          <div className="flex h-10 items-center justify-between border-b border-bd/60 bg-surface-2/30 px-4 text-xs font-semibold text-text-2 select-none shrink-0">
            <span className="truncate">{activeCourse.name} · 分类</span>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {activeCourse.isLoading && (
              <div className="flex items-center justify-center gap-2 p-6 text-xs text-text-3">
                <Spinner size={14} />
                <span>{activeCourse.loadingMessage || '扫描中…'}</span>
              </div>
            )}
            {activeCourse.categories.map(cat => {
              const isSelected = activeCategory?.id === cat.id
              return (
                <div
                  key={cat.id}
                  onClick={() => {
                    onSelectCategory(cat)
                    scrollToRight()
                  }}
                  className={`group flex items-center justify-between px-3 py-2 transition-all cursor-pointer mx-2 my-0.5 rounded-xl ${
                    isSelected
                      ? 'bg-accent/10 text-accent font-semibold shadow-2xs'
                      : 'hover:bg-surface-2/70 text-text-1'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span
                      role="checkbox"
                      aria-checked={cat.state === 'all'}
                      tabIndex={0}
                      onClick={e => {
                        e.stopPropagation()
                        cat.onToggle()
                      }}
                      className="cursor-pointer shrink-0"
                    >
                      <TriCheckbox state={cat.state} size="sm" />
                    </span>
                    <CategoryIcon icon={cat.icon} />
                    <span className="truncate text-xs min-w-0 flex-1">{cat.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-1.5">
                    <span className="text-[11px] font-mono opacity-70">
                      {cat.items.length}
                    </span>
                    <span className={`text-xs font-mono transition-transform ${isSelected ? 'text-accent font-bold translate-x-0.5' : 'text-text-4 group-hover:text-text-3'}`}>
                      ›
                    </span>
                  </div>
                </div>
              )
            })}
            {activeCourse.categories.length === 0 && !activeCourse.isLoading && (
              <div className="p-6 text-center text-xs text-text-4">
                未发现分类
              </div>
            )}
          </div>
        </div>
      )}

      {/* 第 3 栏：选定分类内的文件流（已彻底移除顶部侵入性 renderExtra） */}
      {activeCourse && activeCategory && (
        <div className="flex w-72 md:w-80 shrink-0 flex-col bg-surface-1/40 h-full transition-all animate-fadeIn">
          <div className="flex h-10 items-center justify-between border-b border-bd/60 bg-surface-2/30 px-4 text-xs font-semibold text-text-2 select-none shrink-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span
                role="checkbox"
                aria-checked={activeCategory.state === 'all'}
                tabIndex={0}
                onClick={() => activeCategory.onToggle()}
                className="cursor-pointer shrink-0"
              >
                <TriCheckbox state={activeCategory.state} size="sm" />
              </span>
              <span className="truncate">{activeCategory.name} ({activeCategory.items.length})</span>
            </div>
            {activeCategory.isLoading && (
              <div className="flex items-center gap-1.5 text-[11px] text-text-3 shrink-0 ml-2">
                <Spinner size={12} />
                <span>{activeCategory.loadingMessage || '加载中…'}</span>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {activeCategory.items.map(item => {
              const isActive = selectedFileItem?.id === item.id
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    setSelectedFileItem(item)
                    scrollToRight()
                  }}
                  className={`group flex flex-col px-3 py-2 transition-all cursor-pointer mx-2 my-0.5 rounded-xl ${
                    isActive
                      ? 'bg-accent/10 text-accent font-semibold shadow-2xs'
                      : item.disabled
                      ? 'opacity-60 hover:bg-surface-2/40'
                      : 'hover:bg-surface-2/70 text-text-1'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span
                        role="checkbox"
                        aria-checked={item.selected}
                        tabIndex={0}
                        onClick={e => {
                          e.stopPropagation()
                          if (!item.disabled) item.onToggle()
                        }}
                        className="cursor-pointer shrink-0"
                      >
                        <ItemCheckbox
                          checked={item.selected}
                          disabled={item.disabled}
                          onChange={() => {
                            if (!item.disabled) item.onToggle()
                          }}
                        />
                      </span>
                      <FileTypeBadge filename={item.name} type={item.type} />
                      <span className={`min-w-0 flex-1 truncate text-xs ${item.disabled ? 'text-text-3' : 'text-text-1'}`} title={item.name}>
                        {item.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-1.5">
                      {item.disabledReason ? (
                        <span className="rounded bg-surface-3/80 px-1.5 py-0.2 text-2xs text-text-3 border border-bd/40 font-sans">
                          {item.disabledReason}
                        </span>
                      ) : item.size ? (
                        <span className="font-mono text-[11px] text-text-3 opacity-80">
                          {formatBytes(item.size)}
                        </span>
                      ) : null}
                      <span className={`text-xs font-mono transition-transform ${isActive ? 'text-accent font-bold translate-x-0.5' : 'text-text-4 group-hover:text-text-3'}`}>
                        ›
                      </span>
                    </div>
                  </div>
                  {item.renderExtra && (
                    <div className="mt-1 pl-6" onClick={e => e.stopPropagation()}>
                      {item.renderExtra}
                    </div>
                  )}
                </div>
              )
            })}

            {activeCategory.items.length === 0 && !activeCategory.isLoading && (
              <div className="py-16 text-center text-xs text-text-4">
                {activeCategory.emptyMessage || '该分类下暂无资源'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 第 4 栏：自适应动态检查器 (Inspector) */}
      {activeCourse && (
        selectedFileItem ? (
          <FileDetailInspector
            item={selectedFileItem}
            course={activeCourse}
            category={activeCategory}
            onClose={() => setSelectedFileItem(null)}
            onDownloadSingle={onDownloadSingle}
          />
        ) : (
          <CourseOverviewInspector
            course={activeCourse}
            category={activeCategory}
            perspective={perspective}
            onPerspectiveChange={onPerspectiveChange}
            hasPptPdf={hasPptPdf}
            onTogglePptPdf={onTogglePptPdf}
            onDownloadCourse={onDownloadCourse}
          />
        )
      )}
    </div>
  )
}
