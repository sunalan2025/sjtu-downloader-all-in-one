import type React from 'react'
import { type TriState } from '../../components/DownloadUI'
import type { CourseViewMode } from '../../store/app'
import type { DownloadMode } from '@shared/types'
import { type VideoPerspective } from '../../components/FloatingCommandIsland'

export type IslandChipKey = 'files' | 'videos' | 'assignments' | 'pptPdf'

// ─────────────────────────────────────────────────────────────
// Netdisk Navigation Interfaces
// ─────────────────────────────────────────────────────────────

export interface NetdiskNavState {
  level: 'root' | 'course' | 'category'
  courseId?: number | string
  categoryId?: string
}

export interface AssignmentItemMeta {
  hasSubmission: boolean
  submittedAt?: string
  submissionScore?: number
  submissionGrade?: string
  pointsPossible?: number
  dueAt?: string
  teacherAttachmentCount: number
  submissionFileCount: number
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
  details?: string
  assignmentMeta?: AssignmentItemMeta
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
  itemUnit?: string
  isLoading?: boolean
  loadingMessage?: string
  emptyMessage?: string
  onEnter?: () => void
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
  if (
    id.includes('ppt_pdf') ||
    id.includes('ppt-pdf') ||
    name.includes('讲义') ||
    (id.includes('ppt') && !name.includes('视频') && !name.includes('实录'))
  )
    return 'pptPdf'
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
  onVisible?: () => void
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
  downloadMode?: DownloadMode
  onViewModeChange?: (mode: CourseViewMode) => void
}
