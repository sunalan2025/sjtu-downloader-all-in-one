import { useMemo, useState, useCallback } from 'react'
import { TriCheckbox, FolderIcon, type TriState } from '../../components/DownloadUI'
import { Spinner } from '../../components/Spinner'
import { useAppStore } from '../../store/app'
import type { DownloadMode } from '@shared/types'
import { groupCoursesByTerm as sharedGroupCoursesByTerm, sortAcademicTerms, getDownloadActionLabels } from '@shared/utils'
import { type VideoPerspective } from '../../components/FloatingCommandIsland'
import { applyVideoPerspectivePreference } from '../../download/perspective'
import { NetdiskCategoryItem, NetdiskCourseItem, NetdiskFileItem } from './model'

// ─────────────────────────────────────────────────────────────
// Category Icon Renderer
// ─────────────────────────────────────────────────────────────

export function CategoryIcon({ icon, size = 'md' }: { icon?: NetdiskCategoryItem['icon']; size?: 'sm' | 'md' | 'lg' }) {
  if (typeof icon === 'object' && icon !== null) {
    return <>{icon}</>
  }

  const boxSize = size === 'lg' ? 'h-10 w-10 rounded-xl' : size === 'sm' ? 'h-5 w-5 rounded-md' : 'h-7 w-7 rounded-lg'
  const svgSize = size === 'lg' ? 'h-5 w-5' : size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'

  if (icon === 'audio') {
    return (
      <div
        className={`flex ${boxSize} shrink-0 items-center justify-center bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm ring-1 ring-emerald-400/20`}
      >
        <svg
          className={`${svgSize} fill-none stroke-current drop-shadow-2xs`}
          viewBox="0 0 24 24"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </div>
    )
  }
  if (icon === 'video') {
    return (
      <div
        className={`flex ${boxSize} shrink-0 items-center justify-center bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-sm ring-1 ring-sky-400/20`}
      >
        <svg className={`${svgSize} fill-current drop-shadow-2xs`} viewBox="0 0 24 24">
          <path d="M8 5.14v13.72a1 1 0 0 0 1.55.83l11-6.86a1 1 0 0 0 0-1.66l-11-6.86A1 1 0 0 0 8 5.14z" />
        </svg>
      </div>
    )
  }
  if (icon === 'presentation') {
    return (
      <div
        className={`flex ${boxSize} shrink-0 items-center justify-center bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-sm ring-1 ring-amber-400/20`}
      >
        <svg
          className={`${svgSize} fill-none stroke-current drop-shadow-2xs`}
          viewBox="0 0 24 24"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
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
      <div
        className={`flex ${boxSize} shrink-0 items-center justify-center bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm ring-1 ring-indigo-400/20`}
      >
        <svg
          className={`${svgSize} fill-none stroke-current drop-shadow-2xs`}
          viewBox="0 0 24 24"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
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
      <div
        className={`flex ${boxSize} shrink-0 items-center justify-center bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-sm ring-1 ring-violet-400/20`}
      >
        <svg
          className={`${svgSize} fill-none stroke-current drop-shadow-2xs`}
          viewBox="0 0 24 24"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
          <path d="M9 14l2 2 4-4" />
        </svg>
      </div>
    )
  }
  return (
    <div
      className={`flex ${boxSize} shrink-0 items-center justify-center bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-sm ring-1 ring-amber-400/20`}
    >
      <FolderIcon className={`${svgSize} text-white`} />
    </div>
  )
}

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

export function groupCoursesByTerm(courses: NetdiskCourseItem[]) {
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
  return id === 'videos' || category.icon === 'video' || category.icon === 'audio' || name.includes('视频') || name.includes('音频')
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
  downloadMode?: DownloadMode
}

export function useCategoryViewLogic(params: CategoryViewLogicParams) {
  const {
    courses,
    currentCourse,
    currentCategory,
    groupByTerm = true,
    hasSelection,
    onDownloadSingle,
    perspective,
    onPerspectiveChange,
    showToast
  } = params

  const isSelected =
    hasSelection ??
    (courses.some(c => c.state !== 'none') || currentCourse?.state !== 'none' || currentCategory?.items.some(i => i.selected) || false)

  const termGroups = useMemo(() => {
    if (!groupByTerm) return null
    return groupCoursesByTerm(courses)
  }, [courses, groupByTerm])

  const globalPerspective = useAppStore(s => s.videoPerspectivePreference)
  const globalVideoQuality = useAppStore(s => s.videoQualityOption)
  const isAudioOnly = globalVideoQuality === 'audio_only' || globalPerspective === 'audio'
  const storeDownloadMode = useAppStore(s => s.downloadMode)
  const effectiveStoreMode = typeof useAppStore.getState === 'function' ? useAppStore.getState().downloadMode : storeDownloadMode
  const activeDownloadMode = params.downloadMode ?? effectiveStoreMode ?? storeDownloadMode ?? 'local'
  const actionLabels = getDownloadActionLabels(activeDownloadMode)
  const isVideoCat = isVideoCategory(currentCategory)
  const [internalPerspective, setInternalPerspective] = useState<VideoPerspective>('all')
  const activePerspective = isAudioOnly ? 'audio' : (perspective ?? currentCourse?.perspective ?? globalPerspective ?? internalPerspective)

  const handleFilterPerspectiveChange = useCallback(
    (nextPerspective: VideoPerspective) => {
      setInternalPerspective(nextPerspective)
      onPerspectiveChange?.(nextPerspective)
      currentCourse?.onPerspectiveChange?.(nextPerspective)
      // [Bug Fix] audio 档原先被忽略（no-op）。机位含 audio 语义时同步全局画质偏好；
      // 纯音频模式下 PPT 路无独立音频流，按教师视角过滤（与 onDownload 的 angle===3 跳过一致）。
      applyVideoPerspectivePreference(nextPerspective)

      if (currentCategory) {
        const filterPerspective: VideoPerspective = nextPerspective === 'audio' ? 'teacher' : nextPerspective
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
    },
    [onPerspectiveChange, currentCourse, currentCategory]
  )

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

  const handleSingleDownload = useCallback(
    (item: NetdiskFileItem) => {
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
        showToast?.(actionLabels.toastPromptMessage(item.name), 'info')
        return
      }
      showToast?.(actionLabels.toastMessage(item.name), 'success')
    },
    [onDownloadSingle, currentCourse, currentCategory, showToast, actionLabels]
  )

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
    handleSingleDownload,
    actionLabels
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
      className="inline-flex items-center rounded-lg border border-bd bg-surface-2/60 p-0.5 text-xs select-none shadow-2xs"
    >
      <button
        type="button"
        role="radio"
        aria-checked={perspective === 'all'}
        onClick={() => onChange('all')}
        className={`px-2.5 py-1 rounded-md transition-all cursor-pointer font-sans ${
          perspective === 'all' ? 'bg-accent text-white font-medium shadow-xs' : 'text-text-2 hover:text-text-1 hover:bg-surface-1'
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
          perspective === 'teacher' ? 'bg-accent text-white font-medium shadow-xs' : 'text-text-2 hover:text-text-1 hover:bg-surface-1'
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
          perspective === 'ppt' ? 'bg-accent text-white font-medium shadow-xs' : 'text-text-2 hover:text-text-1 hover:bg-surface-1'
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
  if (category.items.length === 0) return null

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
          <div className="text-xs text-text-3">
            共 {displayedCount} {category.itemUnit || (category.chipKey === 'videos' ? '讲视频' : category.chipKey === 'assignments' ? '项作业' : '个文件')}
          </div>
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
