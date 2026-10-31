import { Fragment } from 'react'
import { TriCheckbox, ItemCheckbox, FileTypeBadge, MacOSFolderIcon, formatBytes } from '../../components/DownloadUI'
import type { DownloadMode } from '@shared/types'
import { type VideoPerspective } from '../../components/FloatingCommandIsland'
import { NetdiskCourseItem, NetdiskNavState, NetdiskCategoryItem, NetdiskFileItem } from './model'
import { useCategoryViewLogic, getTermTriState, toggleTermCourses, CategoryIcon, CategoryLevelHeader } from './shared'
import { CourseSelectionSurface, selectableCourses, selectableCategories, selectableFiles } from './Selection'

// ─────────────────────────────────────────────────────────────
// 2. ListView (详细列表视图)
// ─────────────────────────────────────────────────────────────

export function CourseRow({ course, onNavigate }: { course: NetdiskCourseItem; onNavigate: (next: NetdiskNavState) => void }) {
  const c = course
  return (
    <tr
      key={c.id}
      data-selection-id={String(c.id)}
      data-course-id={String(c.id)}
      tabIndex={-1}
      onDoubleClick={() => {
        c.onEnter?.()
        onNavigate({ level: 'course', courseId: c.id, categoryId: c.categories[0]?.id })
      }}
      onMouseEnter={() => {
        c.onHover?.()
      }}
      className={`h-[var(--row-height)] hover:bg-surface-2/60 transition-colors cursor-pointer ${c.state !== 'none' ? 'bg-accent/10' : ''}`}
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
          <MacOSFolderIcon size={24} />
          <span className="font-semibold text-text-1 truncate max-w-sm" title={c.name}>
            {c.name}
          </span>
        </div>
      </td>
      <td className="py-2.5 px-4 text-text-3 font-mono">{c.term || c.teacher || '—'}</td>
      <td className="py-2.5 px-4 text-text-3 font-mono">{c.itemCount > 0 ? c.itemCount : '—'}</td>
      <td className="py-2.5 px-4 text-text-3 font-mono">{c.totalBytes ? formatBytes(c.totalBytes) : '—'}</td>
      <td className="py-2.5 px-4 text-right">
        <button type="button" onClick={event => { event.stopPropagation(); c.onEnter?.(); onNavigate({ level: 'course', courseId: c.id }) }} className="text-accent hover:underline font-medium">
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
  onInspectFile,
  onDownloadCourse: _onDownloadCourse,
  perspective,
  onPerspectiveChange,
  showToast,
  hasSelection,
  downloadMode
}: {
  courses: NetdiskCourseItem[]
  currentCourse?: NetdiskCourseItem
  currentCategory?: NetdiskCategoryItem
  navState: NetdiskNavState
  onNavigate: (next: NetdiskNavState) => void
  groupByTerm?: boolean
  onDownloadSingle?: (item: NetdiskFileItem, course?: NetdiskCourseItem, category?: NetdiskCategoryItem) => void
  onInspectFile?: (item: NetdiskFileItem) => void
  onDownloadCourse?: (course: NetdiskCourseItem) => void
  perspective?: VideoPerspective
  onPerspectiveChange?: (perspective: VideoPerspective) => void
  showToast?: (text: string, type?: 'success' | 'info') => void
  hasSelection?: boolean
  downloadMode?: DownloadMode
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
    handleSingleDownload,
    actionLabels
  } = useCategoryViewLogic({
    courses,
    currentCourse,
    currentCategory,
    groupByTerm,
    hasSelection,
    onDownloadSingle,
    perspective,
    onPerspectiveChange,
    showToast,
    downloadMode
  })

  // 根目录列表
  if (navState.level === 'root' || !currentCourse) {
    return (
      <CourseSelectionSurface key={courses.map(course => course.id).join(',')} label="课程列表" items={selectableCourses(termGroups ? termGroups.flatMap(group => group.items) : courses)}
        onOpen={id => { const course = courses.find(c => String(c.id) === id); if (course) { course.onEnter?.(); onNavigate({ level: 'course', courseId: course.id }) } }}
        className={`h-full overflow-y-auto rounded-xl bg-surface-1 ${isSelected ? 'pb-28' : ''}`}>
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
          <tbody className="divide-y divide-bd">
            {termGroups
              ? termGroups.map(group => {
                  const termState = getTermTriState(group.items)
                  return (
                    <Fragment key={group.term}>
                      <tr className="bg-surface-2/70 font-semibold text-text-2">
                        <td colSpan={5} className="py-2 px-4 border-y border-bd">
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
              : courses.map(c => <CourseRow key={c.id} course={c} onNavigate={onNavigate} />)}
          </tbody>
        </table>
      </CourseSelectionSurface>
    )
  }

  // 课程分类列表（已彻底移除专属操作白板）
  if (navState.level === 'course' || !currentCategory) {
    return (
      <CourseSelectionSurface label="课程分类列表" items={selectableCategories(currentCourse.categories)}
        onOpen={id => onNavigate({ level: 'category', courseId: currentCourse.id, categoryId: id })}
        className={`h-full overflow-y-auto rounded-xl bg-surface-1 ${isSelected ? 'pb-28' : ''}`}>
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-surface-2 text-text-2 border-b border-bd z-10">
            <tr>
              <th className="py-2.5 px-4 font-semibold">分类名称</th>
              <th className="py-2.5 px-4 font-semibold">资源数量</th>
              <th className="py-2.5 px-4 font-semibold text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bd">
            {currentCourse.categories.map(cat => (
              <tr
                key={cat.id}
                data-selection-id={cat.id}
                tabIndex={-1}
                onDoubleClick={e => {
                  e.stopPropagation()
                  cat.onEnter?.()
                  onNavigate({ level: 'category', courseId: currentCourse.id, categoryId: cat.id })
                }}
                className={`hover:bg-surface-2/60 transition-colors cursor-pointer ${cat.state !== 'none' ? 'bg-accent/10' : ''}`}
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
                <td className="py-2.5 px-4 text-text-3 font-mono">{cat.items.length}</td>
                <td className="py-2.5 px-4 text-right">
                  <button type="button" onClick={event => { event.stopPropagation(); cat.onEnter?.(); onNavigate({ level: 'category', courseId: currentCourse.id, categoryId: cat.id }) }} className="text-accent hover:underline font-medium">
                    进入 ›
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CourseSelectionSurface>
    )
  }

  // 具体资源列表（顶部内嵌视角筛选器，支持单文件悬停极速下载）
  return (
    <CourseSelectionSurface label="课件列表" items={selectableFiles(displayedItems)}
      onOpen={id => { const item = displayedItems.find(item => item.id === id); if (item) onInspectFile?.(item) }}
      className={`h-full overflow-y-auto space-y-3 ${isSelected ? 'pb-28' : 'pb-4'}`}>
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
        <div className="py-12 text-center text-xs text-text-3">{currentCategory.emptyMessage || '该分类下暂无资源'}</div>
      ) : (
        <div className="rounded-xl bg-surface-1 overflow-hidden">
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
            <tbody className="divide-y divide-bd">
              {displayedItems.map(item => (
                <tr
                  key={item.id}
                  data-selection-id={item.id}
                  tabIndex={-1}
                  onClick={() => {
                    if (item.disabled) return
                    item.onToggle()
                  }}
                  className={`group transition-colors ${item.selected ? 'bg-accent/10' : ''} ${
                    item.disabled ? 'opacity-60 bg-surface-2/20 cursor-not-allowed' : 'hover:bg-surface-2/60 cursor-pointer'
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
                      {item.assignmentMeta && (
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium border font-sans ${
                          item.assignmentMeta.hasSubmission
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                        }`}>
                          {item.assignmentMeta.hasSubmission
                            ? (item.assignmentMeta.submissionScore !== undefined ? `已提交 · ${item.assignmentMeta.submissionScore}分` : '已提交待批改')
                            : '未提交'}
                        </span>
                      )}
                      {item.disabledReason && (
                        <span className="shrink-0 rounded bg-surface-3/80 px-1.5 py-0.2 text-2xs text-text-3 border border-bd font-sans">
                          {item.disabledReason}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-text-3 font-mono">
                    {item.assignmentMeta
                      ? `${item.assignmentMeta.submissionFileCount}原件 · ${item.assignmentMeta.teacherAttachmentCount}附件`
                      : (item.size ? formatBytes(item.size) : '—')}
                  </td>
                  <td className="py-2.5 px-4 text-text-3 font-mono uppercase">
                    {item.assignmentMeta ? '作业归档' : (item.type || 'FILE')}
                  </td>
                  <td className="py-2.5 px-4 text-text-3 font-mono">
                    {item.assignmentMeta?.dueAt
                      ? `截止: ${item.assignmentMeta.dueAt.slice(5, 16).replace('T', ' ')}`
                      : (item.assignmentMeta ? '无截止时间' : (item.date || '—'))}
                  </td>
                  <td className="py-2.5 px-4 text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      {!item.disabled && (onDownloadSingle || item.onDownloadSingle || item.onDownload) && (
                        <button
                          type="button"
                          data-testid="single-download-btn"
                          title={`${actionLabels.ctaPrefix} ${item.name}`}
                          onClick={e => {
                            e.stopPropagation()
                            handleSingleDownload(item)
                          }}
                          className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md border border-accent/20 bg-accent/10 px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent hover:text-white focus-visible:outline-accent cursor-pointer"
                        >
                          {actionLabels.iconType === 'upload' ? (
                            <svg
                              className="h-3 w-3"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M12 19V6m0 0l-4 4m4-4l4 4M4 3h16" />
                            </svg>
                          ) : actionLabels.iconType === 'both' ? (
                            <span className="text-[10px] leading-none">☁️⬇</span>
                          ) : (
                            <svg
                              className="h-3 w-3"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M12 3v13m0 0l-4-4m4 4l4-4M4 21h16" />
                            </svg>
                          )}
                          <span>{actionLabels.quickActionText}</span>
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
    </CourseSelectionSurface>
  )
}
