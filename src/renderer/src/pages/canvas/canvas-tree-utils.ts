import type { ReactNode } from 'react'
import { isLegacyCanvasVideo } from '@shared/canvas-video'
import type { TriState } from '../../components/DownloadUI'
import type {
  NetdiskFileItem
} from '../../components/NetdiskCourseExplorer'
import type {
  CanvasAssignmentItem,
  CanvasFileItem,
  CanvasLectureGroup
} from '@shared/types'
import { sanitizeFsName } from '@shared/utils'
import {
  canvasPptItemTaskId as pptPdfTaskId,
  canvasMvidTaskId
} from '../../download/taskIds'

export interface CourseData {
  files: CanvasFileItem[]
  folderMap: Record<number, string>
  moduleFiles: CanvasFileItem[]
  syllabusFiles: CanvasFileItem[]
  assignments?: CanvasAssignmentItem[]
}

// ─── Task ID 生成 ──────────────────────────────────────────────
export { pptPdfTaskId }

/**
 * 构建课程各讲次的 PPT 课件 (PDF) 文件列表项。
 * 单讲使用独立 taskId；尚未扫描时的分类全选意图由调用方展开。
 */
export function buildPptPdfItems(
  courseName: string,
  courseId: number,
  lectures: CanvasLectureGroup[] | undefined,
  selection: ReadonlySet<string> | boolean,
  onToggle: (id: string) => void,
  renderExtra?: ReactNode
): NetdiskFileItem[] {
  if (!lectures) return []
  return lectures
    .filter(l => !!l.teacher && !isLegacyCanvasVideo(l.teacher))
    .map(l => ({
      id: pptPdfTaskId(courseId, l.lectureNum),
      name: `${courseName} - 第${l.lectureNum}讲 PPT课件`,
      date: l.date,
      type: 'PDF',
      selected: typeof selection === 'boolean' ? selection : selection.has(pptPdfTaskId(courseId, l.lectureNum)),
      onToggle: () => onToggle(pptPdfTaskId(courseId, l.lectureNum)),
      renderExtra
    }))
}

export function iframeVideoTaskId(courseId: number, pageTitle: string): string {
  return canvasMvidTaskId(courseId, pageTitle, sanitizeFsName)
}

export function moduleVideoBaseName(courseName: string, title: string): string {
  return sanitizeFsName(`${courseName}-${title}`)
}

export const SYLLABUS_FOLDER_ID = -3

export const EMPTY_TASK_IDS: string[] = []

/** 从 scanCourse 结果构建 CourseData，注入大纲补漏的哨兵文件夹映射。 */
export function buildCourseData(r: {
  files?: CanvasFileItem[]
  folderMap?: Record<number, string>
  moduleFiles?: CanvasFileItem[]
  syllabusFiles?: CanvasFileItem[]
  assignments?: CanvasAssignmentItem[]
}): CourseData {
  const folderMap: Record<number, string> = { ...(r.folderMap ?? {}) }
  if ((r.syllabusFiles?.length ?? 0) > 0) folderMap[SYLLABUS_FOLDER_ID] = '大纲'
  return {
    files: r.files ?? [],
    folderMap,
    moduleFiles: r.moduleFiles ?? [],
    syllabusFiles: r.syllabusFiles ?? [],
    assignments: r.assignments ?? []
  }
}

/** 单个分类的选中态 */
export function catStateOf(ids: string[], selected: Set<string>, intent?: boolean): TriState {
  if (ids.length === 0) return intent ? 'all' : 'none' // 未解析 → 意图决定
  const sel = ids.reduce((n, id) => n + (selected.has(id) ? 1 : 0), 0)
  return sel === ids.length ? 'all' : sel > 0 ? 'some' : 'none'
}

/** 课程级态 = 五个分类态的聚合 (files, teacher, ppt, moduleVideo, assignments) */
export function aggCourseState(f: TriState, t: TriState, p: TriState, m: TriState, a: TriState): TriState {
  if (f === 'all' && t === 'all' && p === 'all' && m === 'all' && a === 'all') return 'all'
  if (f === 'none' && t === 'none' && p === 'none' && m === 'none' && a === 'none') return 'none'
  return 'some'
}

/** 合并 PPT 逐讲选择及尚未扫描时的全选意图。 */
export function combinePptPdf(base: TriState, pptPdfOn: TriState | boolean | undefined): TriState {
  const state = typeof pptPdfOn === 'string' ? pptPdfOn : pptPdfOn ? 'all' : 'none'
  if (base === 'all' && state === 'all') return 'all'
  if (base === 'none' && state === 'none') return 'none'
  return 'some'
}
