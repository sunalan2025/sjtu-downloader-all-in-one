import { memo, useMemo, useEffect, useRef } from 'react'
import type React from 'react'
import { BreadcrumbBar, type BreadcrumbItem } from './BreadcrumbBar'
import {
  TriCheckbox,
  ItemCheckbox,
  FileTypeBadge,
  FolderIcon,
  CourseProgressSummary,
  formatBytes,
  type TriState
} from './DownloadUI'
import { Spinner } from './Spinner'
import type { CourseViewMode } from '../store/app'

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
  renderExtra?: React.ReactNode
  disabled?: boolean
  disabledReason?: string
}

export interface NetdiskCategoryItem {
  id: string
  name: string
  icon?: 'folder' | 'video' | 'file' | 'presentation' | 'audio' | React.ReactNode
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
  onEnter?: () => void
  isLoading?: boolean
  loadingMessage?: string
  summary?: {
    done: number
    downloading: number
    errors: number
    inflight?: number
    total: number
  }
}

export interface NetdiskCourseExplorerProps {
  courses: NetdiskCourseItem[]
  viewMode: CourseViewMode
  navState: NetdiskNavState
  onNavigate: (next: NetdiskNavState) => void
  emptyPlaceholder?: React.ReactNode
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
  emptyPlaceholder
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

  // 在 Column 分栏视图下，当前活跃选中的课程与分类
  const columnActiveCourse = useMemo(() => {
    return currentCourse || courses[0]
  }, [currentCourse, courses])

  const columnActiveCategory = useMemo(() => {
    if (!columnActiveCourse) return undefined
    return (
      columnActiveCourse.categories.find(cat => cat.id === navState.categoryId) ||
      columnActiveCourse.categories[0]
    )
  }, [columnActiveCourse, navState.categoryId])

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
      return `${currentCourse.categories.length} 个分类 · ${currentCourse.itemCount} 项资源`
    }
    if (navState.level === 'category' && currentCategory) {
      return `共 ${currentCategory.items.length} 个文件`
    }
    return ''
  }, [viewMode, columnActiveCourse, columnActiveCategory, courses.length, navState.level, currentCourse, currentCategory])

  if (courses.length === 0) {
    return <div className="h-full w-full">{emptyPlaceholder}</div>
  }

  return (
    <div className="flex h-full w-full flex-col">
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
                  courseId: c.id,
                  categoryId: c.categories[0]?.id
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
            />
          ) : viewMode === 'list' ? (
            <ListView
              courses={courses}
              currentCourse={currentCourse}
              currentCategory={currentCategory}
              navState={navState}
              onNavigate={onNavigate}
            />
          ) : (
            <GridView
              courses={courses}
              currentCourse={currentCourse}
              currentCategory={currentCategory}
              navState={navState}
              onNavigate={onNavigate}
            />
          )}
        </div>
      </div>
    </div>
  )
})

// ─────────────────────────────────────────────────────────────
// 1. GridView (网格大图标视图)
// ─────────────────────────────────────────────────────────────

function GridView({
  courses,
  currentCourse,
  currentCategory,
  navState,
  onNavigate
}: {
  courses: NetdiskCourseItem[]
  currentCourse?: NetdiskCourseItem
  currentCategory?: NetdiskCategoryItem
  navState: NetdiskNavState
  onNavigate: (next: NetdiskNavState) => void
}) {
  // 根目录：展示课程大文件夹网格
  if (navState.level === 'root' || !currentCourse) {
    return (
      <div className="h-full overflow-y-auto p-1.5 pb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {courses.map(c => (
            <div
              key={c.id}
              onClick={() => {
                c.onEnter?.()
                onNavigate({ level: 'course', courseId: c.id, categoryId: c.categories[0]?.id })
              }}
              className="group relative flex flex-col justify-between rounded-2xl border border-bd bg-surface-1 p-4 shadow-card hover:border-accent hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 cursor-pointer select-none"
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  role="checkbox"
                  aria-checked={c.state === 'all'}
                  tabIndex={0}
                  onClick={e => {
                    e.stopPropagation()
                    c.onToggle()
                  }}
                  onKeyDown={e => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault()
                      e.stopPropagation()
                      c.onToggle()
                    }
                  }}
                  className="p-1 -m-1 rounded-md hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <TriCheckbox state={c.state} size="sm" />
                </span>
                {c.term && (
                  <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-mono text-text-3 leading-normal inline-flex items-center">
                    {c.term}
                  </span>
                )}
              </div>

              <div className="my-2.5 flex flex-col items-center text-center">
                <div className="relative mb-2 transition-transform duration-200 group-hover:scale-105">
                  <FolderIcon className="h-9 w-9 text-amber-500 group-hover:text-accent transition-colors duration-200" />
                </div>
                <h3 className="line-clamp-2 text-sm font-bold text-text-1 group-hover:text-accent transition-colors" title={c.name}>
                  {c.name}
                </h3>
                <div className="mt-1 text-xs text-text-3 truncate max-w-full">
                  {c.teacher ? `${c.teacher} · ` : ''}{c.code || ''}
                </div>
              </div>

              <div className="border-t border-bd/40 pt-2.5">
                {c.summary && (
                  <div className="mb-2">
                    <CourseProgressSummary
                      done={c.summary.done}
                      downloading={c.summary.downloading}
                      errors={c.summary.errors}
                      inflight={c.summary.inflight}
                      total={c.summary.total}
                    />
                  </div>
                )}
                <div className="flex items-center justify-between text-[11px] text-text-3">
                  <span className="font-mono">
                    {c.itemCount} 资源{c.totalBytes ? ` · ${formatBytes(c.totalBytes)}` : ''}
                  </span>
                  <span className="text-accent font-medium group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                    进入 ›
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // 课程级目录：展示课程下二级分类文件夹网格
  if (navState.level === 'course' || !currentCategory) {
    return (
      <div className="h-full overflow-y-auto p-1.5 pb-4">
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
                {currentCourse.teacher ? `${currentCourse.teacher} · ` : ''}{currentCourse.term || ''} · 共 {currentCourse.itemCount} 项资源
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

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {currentCourse.categories.map(cat => (
            <div
              key={cat.id}
              onClick={() => onNavigate({ level: 'category', courseId: currentCourse.id, categoryId: cat.id })}
              className="group relative flex flex-col justify-between rounded-2xl border border-bd bg-surface-1 p-4 shadow-card hover:border-accent hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 cursor-pointer select-none"
            >
              <div className="flex items-start justify-between">
                <span
                  role="checkbox"
                  aria-checked={cat.state === 'all'}
                  tabIndex={0}
                  onClick={e => {
                    e.stopPropagation()
                    cat.onToggle()
                  }}
                  className="p-1 -m-1 rounded-md hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <TriCheckbox state={cat.state} size="sm" />
                </span>
                <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-mono text-text-3 leading-normal inline-flex items-center">
                  {cat.items.length} 文件
                </span>
              </div>

              <div className="my-2.5 flex flex-col items-center text-center">
                <div className="mb-2 transition-transform duration-200 group-hover:scale-105">
                  <CategoryIcon icon={cat.icon} size="lg" />
                </div>
                <h4 className="text-sm font-bold text-text-1 group-hover:text-accent transition-colors">
                  {cat.name}
                </h4>
                {cat.isLoading && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-text-3">
                    <Spinner size={12} />
                    <span>{cat.loadingMessage || '扫描中…'}</span>
                  </div>
                )}
              </div>

              <div className="border-t border-bd/40 pt-2 flex items-center justify-between text-[11px] text-text-3">
                <span>点击进入查看文件</span>
                <span className="text-accent font-medium group-hover:translate-x-0.5 transition-transform">
                  进入 ›
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* 渲染分类扩展组件，如 PPT PDF 进度行或教师筛选 */}
        {currentCourse.categories.some(cat => !!cat.renderExtra) && (
          <div className="mt-6 space-y-3">
            {currentCourse.categories.map(cat => cat.renderExtra ? (
              <div key={`extra-${cat.id}`} className="rounded-xl border border-bd bg-surface-1 p-3">
                <div className="text-xs font-semibold text-text-2 mb-2">{cat.name} 专属操作</div>
                {cat.renderExtra}
              </div>
            ) : null)}
          </div>
        )}
      </div>
    )
  }

  // 三级分类目录：展示具体文件/视频流
  return (
    <div className="h-full overflow-y-auto">
      <div className="mb-4 flex items-center justify-between rounded-xl border border-bd bg-surface-1 p-3">
        <div className="flex items-center gap-3">
          <span
            role="checkbox"
            aria-checked={currentCategory.state === 'all'}
            tabIndex={0}
            onClick={() => currentCategory.onToggle()}
            className="cursor-pointer"
          >
            <TriCheckbox state={currentCategory.state} size="sm" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-text-1">{currentCategory.name}</h2>
            <div className="text-xs text-text-3">共 {currentCategory.items.length} 个文件</div>
          </div>
        </div>
        {currentCategory.isLoading && (
          <div className="flex items-center gap-2 text-xs text-text-2">
            <Spinner size={14} />
            <span>{currentCategory.loadingMessage || '正在加载文件…'}</span>
          </div>
        )}
      </div>

      {currentCategory.renderExtra && (
        <div className="mb-4 rounded-xl border border-bd bg-surface-1 p-3">
          {currentCategory.renderExtra}
        </div>
      )}

      {currentCategory.items.length === 0 ? (
        <div className="py-12 text-center text-xs text-text-3">
          {currentCategory.emptyMessage || '该分类下暂无资源'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {currentCategory.items.map(item => (
            <div
              key={item.id}
              onClick={() => {
                if (item.disabled) return
                item.onToggle()
              }}
              className={`flex flex-col justify-between rounded-xl border p-3 shadow-2xs transition-colors select-none ${
                item.disabled
                  ? 'border-bd/40 bg-surface-2/30 opacity-60 cursor-not-allowed'
                  : 'border-bd bg-surface-1 hover:border-bd-strong hover:bg-surface-2/40 cursor-pointer'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <span className="shrink-0 mt-0.5">
                  <ItemCheckbox
                    checked={item.selected}
                    disabled={item.disabled}
                    onChange={() => {
                      if (item.disabled) return
                      item.onToggle()
                    }}
                  />
                </span>
                <span className="shrink-0">
                  <FileTypeBadge filename={item.name} type={item.type} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-xs font-medium line-clamp-2 ${item.disabled ? 'text-text-3' : 'text-text-1'}`} title={item.name}>
                    {item.name}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-text-3">
                    {item.disabledReason ? (
                      <span className="rounded bg-surface-3/80 px-1 py-0.2 text-2xs text-text-3 border border-bd/40 font-sans">
                        {item.disabledReason}
                      </span>
                    ) : null}
                    {item.size ? <span>{formatBytes(item.size)}</span> : null}
                    {item.date ? <span>{item.date}</span> : null}
                  </div>
                </div>
              </div>
              {item.renderExtra && (
                <div className="mt-2 border-t border-bd/30 pt-2" onClick={e => e.stopPropagation()}>
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

function ListView({
  courses,
  currentCourse,
  currentCategory,
  navState,
  onNavigate
}: {
  courses: NetdiskCourseItem[]
  currentCourse?: NetdiskCourseItem
  currentCategory?: NetdiskCategoryItem
  navState: NetdiskNavState
  onNavigate: (next: NetdiskNavState) => void
}) {
  // 根目录列表
  if (navState.level === 'root' || !currentCourse) {
    return (
      <div className="h-full overflow-y-auto rounded-xl border border-bd bg-surface-1 shadow-2xs">
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
            {courses.map(c => (
              <tr
                key={c.id}
                onClick={() => {
                  c.onEnter?.()
                  onNavigate({ level: 'course', courseId: c.id, categoryId: c.categories[0]?.id })
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
                  {c.itemCount}
                </td>
                <td className="py-2.5 px-4 text-text-3 font-mono">
                  {c.totalBytes ? formatBytes(c.totalBytes) : '—'}
                </td>
                <td className="py-2.5 px-4 text-right">
                  <button
                    type="button"
                    className="text-accent hover:underline font-medium"
                  >
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

  // 课程分类列表
  if (navState.level === 'course' || !currentCategory) {
    return (
      <div className="h-full overflow-y-auto rounded-xl border border-bd bg-surface-1 shadow-2xs">
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

  // 具体资源列表
  return (
    <div className="h-full overflow-y-auto rounded-xl border border-bd bg-surface-1 shadow-2xs">
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
          {currentCategory.items.map(item => (
            <tr
              key={item.id}
              onClick={() => {
                if (item.disabled) return
                item.onToggle()
              }}
              className={`transition-colors ${
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
                {item.renderExtra || (
                  <span className="text-text-4 font-mono">待下载</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 3. ColumnView (分栏多级并列视图 / macOS Miller Columns)
// ─────────────────────────────────────────────────────────────

function ColumnView({
  courses,
  activeCourse,
  activeCategory,
  onSelectCourse,
  onSelectCategory
}: {
  courses: NetdiskCourseItem[]
  activeCourse?: NetdiskCourseItem
  activeCategory?: NetdiskCategoryItem
  onSelectCourse: (c: NetdiskCourseItem) => void
  onSelectCategory: (cat: NetdiskCategoryItem) => void
}) {
  return (
    <div className="flex h-full w-full divide-x divide-bd rounded-2xl border border-bd bg-surface-1 shadow-card overflow-hidden">
      {/* 第 1 栏：课程列表 */}
      <div className="flex w-72 shrink-0 flex-col bg-surface-1">
        <div className="flex h-10 items-center justify-between border-b border-bd bg-surface-2/40 px-4 text-xs font-semibold text-text-2 select-none">
          <span>全部课程 ({courses.length})</span>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-bd/30">
          {courses.map(c => {
            const isSelected = activeCourse?.id === c.id
            return (
              <div
                key={c.id}
                onClick={() => onSelectCourse(c)}
                className={`flex items-center justify-between px-3.5 py-2.5 transition-colors cursor-pointer select-none ${
                  isSelected
                    ? 'bg-accent/10 border-l-4 border-accent text-accent font-semibold'
                    : 'hover:bg-surface-2/60 text-text-1'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
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
                  <span className="truncate text-xs" title={c.name}>
                    {c.name}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <span className="text-[11px] font-mono opacity-70">
                    {c.itemCount}
                  </span>
                  <span className="text-text-4">›</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 第 2 栏：二级资源分类 */}
      <div className="flex w-64 shrink-0 flex-col bg-surface-1/50">
        <div className="flex h-10 items-center justify-between border-b border-bd bg-surface-2/40 px-4 text-xs font-semibold text-text-2 select-none">
          <span className="truncate">{activeCourse?.name ? `${activeCourse.name} · 分类` : '资源分类'}</span>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-bd/30">
          {activeCourse?.isLoading && (
            <div className="flex items-center justify-center gap-2 p-6 text-xs text-text-3">
              <Spinner size={14} />
              <span>{activeCourse.loadingMessage || '扫描中…'}</span>
            </div>
          )}
          {activeCourse?.categories.map(cat => {
            const isSelected = activeCategory?.id === cat.id
            return (
              <div
                key={cat.id}
                onClick={() => onSelectCategory(cat)}
                className={`flex items-center justify-between px-3.5 py-2.5 transition-colors cursor-pointer select-none ${
                  isSelected
                    ? 'bg-accent/10 border-l-4 border-accent text-accent font-semibold'
                    : 'hover:bg-surface-2/60 text-text-1'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
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
                  <span className="truncate text-xs">{cat.name}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <span className="text-[11px] font-mono opacity-70">
                    {cat.items.length}
                  </span>
                  <span className="text-text-4">›</span>
                </div>
              </div>
            )
          })}
          {activeCourse && activeCourse.categories.length === 0 && !activeCourse.isLoading && (
            <div className="p-6 text-center text-xs text-text-4">
              未发现分类
            </div>
          )}
        </div>
      </div>

      {/* 第 3 栏：选定分类内的文件流 */}
      <div className="flex flex-1 min-w-[340px] flex-col bg-surface-1">
        <div className="flex h-10 items-center justify-between border-b border-bd bg-surface-2/40 px-4 text-xs font-semibold text-text-2 select-none">
          <div className="flex items-center gap-2">
            {activeCategory && (
              <span
                role="checkbox"
                aria-checked={activeCategory.state === 'all'}
                tabIndex={0}
                onClick={() => activeCategory.onToggle()}
                className="cursor-pointer"
              >
                <TriCheckbox state={activeCategory.state} size="sm" />
              </span>
            )}
            <span>{activeCategory?.name || '具体文件流'} ({activeCategory?.items.length || 0})</span>
          </div>
          {activeCategory?.isLoading && (
            <div className="flex items-center gap-1.5 text-[11px] text-text-3">
              <Spinner size={12} />
              <span>{activeCategory.loadingMessage || '加载中…'}</span>
            </div>
          )}
        </div>

        {activeCategory?.renderExtra && (
          <div className="border-b border-bd p-2.5 bg-surface-2/20">
            {activeCategory.renderExtra}
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-bd/30">
          {activeCategory?.items.map(item => (
            <div
              key={item.id}
              onClick={() => {
                if (item.disabled) return
                item.onToggle()
              }}
              className={`flex flex-col px-4 py-2 transition-colors select-none ${
                item.disabled
                  ? 'opacity-60 bg-surface-2/20 cursor-not-allowed'
                  : 'hover:bg-surface-2/40 cursor-pointer'
              }`}
            >
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
                <span className={`min-w-0 flex-1 truncate text-xs ${item.disabled ? 'text-text-3' : 'text-text-1'}`} title={item.name}>
                  {item.name}
                </span>
                {item.disabledReason && (
                  <span className="shrink-0 rounded bg-surface-3/80 px-1.5 py-0.2 text-2xs text-text-3 border border-bd/40 font-sans">
                    {item.disabledReason}
                  </span>
                )}
                {item.size ? (
                  <span className="shrink-0 font-mono text-[11px] text-text-3">
                    {formatBytes(item.size)}
                  </span>
                ) : null}
                {item.date ? (
                  <span className="shrink-0 font-mono text-[11px] text-text-4">
                    {item.date}
                  </span>
                ) : null}
              </div>
              {item.renderExtra && (
                <div className="mt-1 pl-6" onClick={e => e.stopPropagation()}>
                  {item.renderExtra}
                </div>
              )}
            </div>
          ))}

          {activeCategory && activeCategory.items.length === 0 && !activeCategory.isLoading && (
            <div className="py-16 text-center text-xs text-text-4">
              {activeCategory.emptyMessage || '该分类下暂无资源'}
            </div>
          )}

          {!activeCategory && (
            <div className="py-16 text-center text-xs text-text-4">
              请在左侧选择课程与分类以查看资源
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
