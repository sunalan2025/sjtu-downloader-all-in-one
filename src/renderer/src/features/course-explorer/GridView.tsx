import { TriCheckbox, formatBytes, MacOSFolderIcon, MacOSDocumentIcon, MacOSCircleCheckbox } from '../../components/DownloadUI'
import { Spinner } from '../../components/Spinner'
import type { DownloadMode } from '@shared/types'
import { type VideoPerspective } from '../../components/FloatingCommandIsland'
import { NetdiskCourseItem, NetdiskNavState, NetdiskCategoryItem, NetdiskFileItem } from './model'
import { useCategoryViewLogic, getTermTriState, toggleTermCourses, CategoryLevelHeader } from './shared'
import { CourseSelectionSurface, selectableCourses, selectableCategories, selectableFiles } from './Selection'

// ─────────────────────────────────────────────────────────────
// 1. GridView (网格大图标视图)
// ─────────────────────────────────────────────────────────────

export function CourseCard({ course, onNavigate }: { course: NetdiskCourseItem; onNavigate: (next: NetdiskNavState) => void }) {
  const c = course
  const isSelected = c.state !== 'none'
  return (
    <div
      key={c.id}
      data-selection-id={String(c.id)}
      data-course-id={String(c.id)}
      tabIndex={-1}
      onClick={() => c.onToggle()}
      onDoubleClick={e => {
        e.stopPropagation()
        c.onEnter?.()
        onNavigate({ level: 'course', courseId: c.id })
      }}
      onMouseEnter={() => {
        c.onHover?.()
      }}
      className={`group relative flex flex-col items-center justify-start rounded-xl p-2.5 transition-all duration-150 cursor-pointer select-none ${
        isSelected ? 'bg-accent/15 ring-1 ring-accent/40 shadow-xs' : 'hover:bg-surface-2/70 active:bg-surface-3/50'
      }`}
      title={`${c.name} · 单击切换全课勾选 · 双击进入查看`}
    >
      {/* macOS 风格圆圈复选框 (左上角) */}
      <div
        data-selection-ignore className="absolute top-2 left-2 z-10"
        onClick={e => {
          e.stopPropagation()
          c.onToggle()
        }}
      >
        <MacOSCircleCheckbox
          state={c.state}
          size="sm"
          className={isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}
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
          {c.teacher ? (c.itemCount > 0 ? `${c.teacher} · ${c.itemCount} 项` : c.teacher) : c.itemCount > 0 ? `${c.itemCount} 项` : ''}
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

  // 根目录：展示课程大文件夹网格
  if (navState.level === 'root' || !currentCourse) {
    return (
      <CourseSelectionSurface key={courses.map(course => course.id).join(',')} label="课程网格" items={selectableCourses(termGroups ? termGroups.flatMap(group => group.items) : courses)}
        onOpen={id => { const course = courses.find(c => String(c.id) === id); if (course) { course.onEnter?.(); onNavigate({ level: 'course', courseId: course.id }) } }}
        className={`h-full overflow-y-auto px-2 py-1.5 ${isSelected ? 'pb-28' : 'pb-6'}`}>
        {termGroups ? (
          <div className="space-y-6">
            {termGroups.map(group => {
              const termState = getTermTriState(group.items)
              return (
                <div key={group.term} className="space-y-3">
                  <div data-selection-ignore className="flex items-center justify-between border-b border-bd pb-2 px-1">
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
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3.5">
                    {group.items.map(c => (
                      <CourseCard key={c.id} course={c} onNavigate={onNavigate} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3.5">
            {courses.map(c => (
              <CourseCard key={c.id} course={c} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </CourseSelectionSurface>
    )
  }

  // 课程级目录：展示课程下二级分类文件夹网格（已彻底移除专属操作白板）
  if (navState.level === 'course' || !currentCategory) {
    return (
      <CourseSelectionSurface label="课程分类网格" items={selectableCategories(currentCourse.categories)}
        onOpen={id => onNavigate({ level: 'category', courseId: currentCourse.id, categoryId: id })}
        className={`h-full overflow-y-auto px-2 py-1.5 ${isSelected ? 'pb-28' : 'pb-4'}`}>
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
                {currentCourse.teacher ? `${currentCourse.teacher} · ` : ''}
                {currentCourse.term || ''}
                {!currentCourse.isLoading && currentCourse.itemCount > 0 ? ` · 共 ${currentCourse.itemCount} 项资源` : ''}
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
                data-selection-id={cat.id}
                tabIndex={-1}
                onClick={() => cat.onToggle()}
                onDoubleClick={e => {
                  e.stopPropagation()
                  cat.onEnter?.()
                  onNavigate({ level: 'category', courseId: currentCourse.id, categoryId: cat.id })
                }}
                className={`group relative flex flex-col items-center justify-start rounded-xl p-2.5 transition-all duration-150 cursor-pointer select-none ${
                  isCatSelected ? 'bg-accent/15 ring-1 ring-accent/40 shadow-xs' : 'hover:bg-surface-2/70 active:bg-surface-3/50'
                }`}
                title={`${cat.name} · 单击切换整章勾选 · 双击进入查看`}
              >
                {/* macOS 风格圆圈复选框 (左上角) */}
                <div
                  data-selection-ignore className="absolute top-2 left-2 z-10"
                  onClick={e => {
                    e.stopPropagation()
                    cat.onToggle()
                  }}
                >
                  <MacOSCircleCheckbox
                    state={cat.state}
                    size="sm"
                    className={isCatSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}
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
                    {cat.items.length} {cat.itemUnit || (cat.chipKey === 'videos' ? '讲视频' : cat.chipKey === 'assignments' ? '项作业' : '个文件')}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </CourseSelectionSurface>
    )
  }

  // 三级分类目录：展示具体文件/视频流（顶部内嵌视角筛选器，支持单文件悬停极速下载）
  return (
    <CourseSelectionSurface label="课件网格" items={selectableFiles(displayedItems)}
      onOpen={id => { const item = displayedItems.find(item => item.id === id); if (item) onInspectFile?.(item) }}
      className={`h-full overflow-y-auto px-2 py-1.5 ${isSelected ? 'pb-28' : 'pb-4'}`}>
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-3 pb-6 select-none p-1">
          {displayedItems.map(item => (
            <div
              key={item.id}
              data-selection-id={item.id}
              tabIndex={-1}
              onClick={() => {
                if (item.disabled) return
                item.onToggle()
              }}
              className={`group relative flex flex-col items-center justify-start rounded-xl p-2.5 transition-all duration-150 select-none ${
                item.disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : 'cursor-pointer ' +
                    (item.selected ? 'bg-accent/15 ring-1 ring-accent/40 shadow-xs' : 'hover:bg-surface-2/70 active:bg-surface-3/50')
              }`}
              title={
                item.disabled
                  ? item.disabledReason
                  : item.assignmentMeta
                    ? `${item.name}\n作业全量归档（含题目说明与评语.md、题目附件${item.assignmentMeta.teacherAttachmentCount > 0 ? ` [${item.assignmentMeta.teacherAttachmentCount}个]` : ''}、本人提交原件${item.assignmentMeta.submissionFileCount > 0 ? ` [${item.assignmentMeta.submissionFileCount}个]` : ''}）\n${item.assignmentMeta.hasSubmission ? (item.assignmentMeta.submissionScore !== undefined ? `得分: ${item.assignmentMeta.submissionScore}分` : '已提交待批改') : '未提交'}${item.assignmentMeta.dueAt ? `\n截止时间: ${item.assignmentMeta.dueAt.slice(0, 16).replace('T', ' ')}` : ''}`
                    : `${item.name} · 单击切换勾选 · 双击查看详情`
              }
            >
              {/* macOS 风格圆圈复选框 (左上角) */}
              <div
                data-selection-ignore className="absolute top-2 left-2 z-10"
                onClick={e => {
                  e.stopPropagation()
                  if (!item.disabled) item.onToggle()
                }}
              >
                <MacOSCircleCheckbox
                  checked={item.selected}
                  size="sm"
                  className={item.selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}
                />
              </div>

              {/* 悬停即现极速下载/上传按钮 (右上角) */}
              {!item.disabled && (
                <button
                  type="button"
                  data-testid="single-download-btn"
                  title={`${actionLabels.ctaPrefix} ${item.name}`}
                  onClick={e => {
                    e.stopPropagation()
                    handleSingleDownload(item)
                  }}
                  className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all absolute top-2 right-2 z-10 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-accent text-white text-[11px] font-medium shadow-sm hover:bg-accent-light active:scale-95 cursor-pointer"
                >
                  {actionLabels.iconType === 'upload' ? (
                    <svg
                      className="h-2.5 w-2.5"
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
                    <span className="text-[9px] leading-none">☁️⬇</span>
                  ) : (
                    <svg
                      className="h-2.5 w-2.5"
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
                {item.assignmentMeta ? (
                  <div className="mt-0.5 text-2xs flex flex-col items-center justify-center w-full px-0.5 font-sans tabular-nums leading-tight">
                    <span className={`truncate max-w-full font-medium ${item.assignmentMeta.hasSubmission ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {item.assignmentMeta.hasSubmission
                        ? (item.assignmentMeta.submissionScore !== undefined ? `已提交 · ${item.assignmentMeta.submissionScore}分` : '已提交待批改')
                        : '未提交'}
                    </span>
                    <span className="text-text-4 truncate max-w-full text-[10px] mt-0.5 scale-95">
                      {item.assignmentMeta.submissionFileCount}原件 · {item.assignmentMeta.teacherAttachmentCount}附件
                    </span>
                  </div>
                ) : (
                  <span className="mt-0.5 text-2xs text-text-4 truncate w-full px-1 font-sans tabular-nums h-4 flex items-center justify-center">
                    {item.disabledReason || (item.size ? formatBytes(item.size) : item.date || '文件')}
                  </span>
                )}
              </div>

              {item.renderExtra && (
                <div data-selection-ignore className="mt-1 w-full" onClick={e => e.stopPropagation()}>
                  {item.renderExtra}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </CourseSelectionSurface>
  )
}
