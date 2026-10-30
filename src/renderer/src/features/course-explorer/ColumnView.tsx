import { useMemo, useEffect, useRef, useState, useCallback } from 'react'
import { TriCheckbox, ItemCheckbox, FileTypeBadge, MacOSFolderIcon, formatBytes } from '../../components/DownloadUI'
import { Spinner } from '../../components/Spinner'
import { EmptyState } from '../../components/ui'
import type { DownloadMode } from '@shared/types'
import { type VideoPerspective } from '../../components/FloatingCommandIsland'
import { NetdiskCourseItem, NetdiskCategoryItem, NetdiskFileItem } from './model'
import { groupCoursesByTerm, getTermTriState, toggleTermCourses, CategoryIcon } from './shared'
import { FileDetailInspector } from './Inspectors'
import { CourseSelectionSurface, selectableCourses, selectableCategories, selectableFiles } from './Selection'

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
  hasSelection?: boolean
  downloadMode?: DownloadMode
}

export function ColumnView({
  courses,
  activeCourse,
  activeCategory,
  onSelectCourse,
  onSelectCategory,
  groupByTerm = true,
  onDownloadSingle,
  onDownloadCourse: _onDownloadCourse,
  perspective: _perspective,
  onPerspectiveChange: _onPerspectiveChange,
  hasPptPdf: _hasPptPdf,
  onTogglePptPdf: _onTogglePptPdf,
  selectedFileItem: controlledSelectedFile,
  onSelectFileItem,
  hasSelection = false,
  downloadMode
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
    if (!selectedFileItem) return
    const exists = activeCategory?.items.some(it => it.id === selectedFileItem.id)
    if (!exists) {
      setSelectedFileItem(null)
    }
  }, [activeCategory, selectedFileItem, setSelectedFileItem])

  const scrollToRight = useCallback(() => {
    requestAnimationFrame(() => {
      if (containerRef.current) {
        containerRef.current.scrollTo({
          left: containerRef.current.scrollWidth,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
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
        data-selection-id={String(c.id)}
        data-course-id={String(c.id)}
        tabIndex={-1}
        onClick={() => {
          onSelectCourse(c)
          scrollToRight()
        }}
        onMouseEnter={() => {
          c.onHover?.()
        }}
        className={`group flex items-center justify-between px-3 py-2 transition-all cursor-pointer mx-2 my-0.5 rounded-xl ${
          isSelected ? 'bg-accent/10 text-accent font-semibold shadow-2xs' : 'hover:bg-surface-2/70 text-text-1'
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
          <MacOSFolderIcon size={24} />
          <span className="truncate text-xs min-w-0 flex-1" title={c.name}>
            {c.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-1.5">
          {c.itemCount > 0 ? <span className="text-[11px] font-mono opacity-70">{c.itemCount}</span> : null}
          <span
            className={`text-xs font-mono transition-transform ${isSelected ? 'text-accent font-bold translate-x-0.5' : 'text-text-4 group-hover:text-text-3'}`}
          >
            ›
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full flex-row overflow-x-auto divide-x divide-bd rounded-xl bg-surface-1 select-none scroll-smooth"
    >
      {/* 第 1 栏：课程列表（顶格起始，消除与上层面包屑重复） */}
      <div className="flex w-64 md:w-72 shrink-0 flex-col bg-surface-1/40 h-full">
        <CourseSelectionSurface key={courses.map(course => course.id).join(',')} label="分栏课程" column items={selectableCourses(termGroups ? termGroups.flatMap(group => group.items) : courses)}
          onOpen={id => { const course = courses.find(c => String(c.id) === id); if (course) { onSelectCourse(course); scrollToRight() } }}
          className={`min-h-0 flex-1 overflow-y-auto py-2 ${hasSelection ? 'pb-24' : 'pb-8'}`}>
          {termGroups
            ? termGroups.map(group => {
                const termState = getTermTriState(group.items)
                return (
                  <div key={group.term} className="mb-2">
                    <div data-selection-ignore className="sticky top-0 z-10 flex items-center justify-between border-y border-bd bg-surface-2/95 px-3 py-1 text-2xs font-semibold text-text-3 backdrop-blur-xs select-none">
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
                    <div className="pt-1">{group.items.map(c => renderColumnCourseItem(c))}</div>
                  </div>
                )
              })
            : courses.map(c => renderColumnCourseItem(c))}
        </CourseSelectionSurface>
      </div>

      {!activeCourse && (
        <EmptyState title={courses.length ? '选择课程查看资源' : '暂无可浏览的课程'}>
          {courses.length ? '从左侧选择课程，逐级查看分类、文件与详情。' : '请刷新课程列表或调整筛选条件。'}
        </EmptyState>
      )}

      {/* 第 2 栏：二级资源分类（顶格起始，消除与上层面包屑重复） */}
      {activeCourse && (
        <div className="flex w-64 md:w-72 shrink-0 flex-col bg-surface-1/40 h-full ui-column-enter">
          <CourseSelectionSurface key={String(activeCourse.id)} label="分栏分类" column items={selectableCategories(activeCourse.categories)}
            onOpen={id => { const category = activeCourse.categories.find(cat => cat.id === id); if (category) { category.onEnter?.(); onSelectCategory(category); scrollToRight() } }}
            className={`min-h-0 flex-1 overflow-y-auto py-2 ${hasSelection ? 'pb-24' : 'pb-8'}`}>
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
                  data-selection-id={cat.id}
                  tabIndex={-1}
                  onClick={() => {
                    cat.onEnter?.()
                    onSelectCategory(cat)
                    scrollToRight()
                  }}
                  className={`group flex items-center justify-between px-3 py-2 transition-all cursor-pointer mx-2 my-0.5 rounded-xl ${
                    isSelected ? 'bg-accent/10 text-accent font-semibold shadow-2xs' : 'hover:bg-surface-2/70 text-text-1'
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
                    <span className="text-[11px] font-mono opacity-70">{cat.items.length}</span>
                    <span
                      className={`text-xs font-mono transition-transform ${isSelected ? 'text-accent font-bold translate-x-0.5' : 'text-text-4 group-hover:text-text-3'}`}
                    >
                      ›
                    </span>
                  </div>
                </div>
              )
            })}
            {activeCourse.categories.length === 0 && !activeCourse.isLoading && (
              <div className="p-6 text-center text-xs text-text-4">未发现分类</div>
            )}
          </CourseSelectionSurface>
        </div>
      )}

      {/* 第 3 栏：选定分类内的文件流（顶格起始，消除与上层面包屑重复） */}
      {activeCourse && activeCategory && (
        <div className="flex w-72 md:w-80 shrink-0 flex-col bg-surface-1/40 h-full transition-all ui-column-enter">
          <CourseSelectionSurface key={`${activeCourse.id}/${activeCategory.id}`} label="分栏课件" column
            items={selectableFiles(activeCategory.items)}
            onOpen={id => { const item = activeCategory.items.find(item => item.id === id); if (item) { setSelectedFileItem(item); scrollToRight() } }}
            onActivate={id => { const item = activeCategory.items.find(item => item.id === id); if (item) { setSelectedFileItem(item); scrollToRight() } }}
            className={`min-h-0 flex-1 overflow-y-auto py-2 ${hasSelection ? 'pb-24' : 'pb-8'}`}>
            {activeCategory.isLoading && (
              <div className="flex items-center justify-center gap-2 p-6 text-xs text-text-3">
                <Spinner size={14} />
                <span>{activeCategory.loadingMessage || '加载中…'}</span>
              </div>
            )}
            {activeCategory.items.map(item => {
              const isActive = selectedFileItem?.id === item.id
              return (
                <div
                  key={item.id}
                  data-selection-id={item.id}
                  tabIndex={-1}
                  onClick={() => {
                    if (selectedFileItem?.id === item.id) {
                      setSelectedFileItem(null)
                    } else {
                      setSelectedFileItem(item)
                      scrollToRight()
                    }
                  }}
                  className={`group flex flex-col px-3 py-2 transition-all cursor-pointer mx-2 my-0.5 rounded-xl ${
                    isActive || item.selected
                      ? 'bg-accent/10 text-accent font-semibold shadow-2xs'
                      : item.disabled
                        ? 'opacity-60 hover:bg-surface-2/40'
                        : 'hover:bg-surface-2/70 text-text-1'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span onClick={e => e.stopPropagation()} className="shrink-0">
                        <ItemCheckbox
                          checked={item.selected}
                          disabled={item.disabled}
                          onChange={() => {
                            if (!item.disabled) item.onToggle()
                          }}
                        />
                      </span>
                      <FileTypeBadge filename={item.name} type={item.type} />
                      <span
                        className={`min-w-0 flex-1 truncate text-xs ${item.disabled ? 'text-text-3' : 'text-text-1'}`}
                        title={item.name}
                      >
                        {item.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-1.5">
                      {item.disabledReason ? (
                        <span className="rounded bg-surface-3/80 px-1.5 py-0.2 text-2xs text-text-3 border border-bd font-sans">
                          {item.disabledReason}
                        </span>
                      ) : item.size ? (
                        <span className="font-mono text-[11px] text-text-3 opacity-80">{formatBytes(item.size)}</span>
                      ) : null}
                      <span
                        className={`text-xs font-mono transition-transform ${isActive ? 'text-accent font-bold translate-x-0.5' : 'text-text-4 group-hover:text-text-3'}`}
                      >
                        ›
                      </span>
                    </div>
                  </div>
                  {item.renderExtra && (
                    <div data-selection-ignore className="mt-1 pl-6" onClick={e => e.stopPropagation()}>
                      {item.renderExtra}
                    </div>
                  )}
                </div>
              )
            })}

            {activeCategory.items.length === 0 && !activeCategory.isLoading && (
              <div className="py-16 text-center text-xs text-text-4">{activeCategory.emptyMessage || '该分类下暂无资源'}</div>
            )}
          </CourseSelectionSurface>
        </div>
      )}

      {/* 第 4 栏：课件详情与预览（仅在点击具体课件时滑出展示，无选定文件时保持纯净分栏） */}
      {activeCourse && selectedFileItem && (
        <FileDetailInspector
          item={activeCategory?.items.find(item => item.id === selectedFileItem.id) ?? selectedFileItem}
          course={activeCourse}
          category={activeCategory}
          onClose={() => setSelectedFileItem(null)}
          onDownloadSingle={onDownloadSingle}
          hasSelection={hasSelection}
          downloadMode={downloadMode}
        />
      )}
    </div>
  )
}
