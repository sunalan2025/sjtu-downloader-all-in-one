import type { ScheduleEvent, JiaowuCourseItem } from '@shared/types'

/** 交大官方 6 大标准教学时段定义 */
export interface TimeSlotDef {
  id: number
  periodHint: string
  slotLabel: string
  timeRange: string
  matchPeriod: (startMinutes: number) => boolean
}

/** 跨时段范围信息定义 */
export interface SlotRangeInfo {
  startSlot: number
  endSlot: number
  span: number
  badge?: string
  isLabOrLongSession: boolean
}

/** 放置到网格中的排课与活动事件（携带时段跨度与视觉标签） */
export interface PlacedEvent extends ScheduleEvent {
  dayIndex: number
  startSlot: number
  endSlot: number
  span: number
  badge?: string
  isLabOrLongSession: boolean
  xf?: string
  jxbmc?: string
}

/** 同一天内有时间重叠的课程/活动聚类簇 */
export interface DayEventCluster {
  startSlot: number
  endSlot: number
  span: number
  events: PlacedEvent[]
}

/** 课表学期课程详情弹窗数据模型 */
export interface SemesterCourseDetail {
  courseName: string
  titleEn?: string
  kch?: string
  kcbj?: string
  xf?: string
  kclbmc?: string
  jxbmc?: string
  teachers: string
  locations: string
  periodAndWeeks: string
  scheduleSessions: Array<{
    dateStr?: string
    timeStr: string
    location?: string
    teacher?: string
    weekHint?: string
  }>
  assignments?: ScheduleEvent[]
  exams?: ScheduleEvent[]
}

/** 教务去重课程聚合项 */
export interface UniqueJiaowuCourse {
  name: string
  kch?: string
  xf?: string
  kcbj?: string
  kclbmc?: string
  jxbmc?: string
  teachers: string
  locations: string
  periodAndWeeks: string
  items: JiaowuCourseItem[]
}

/** 学期课程清单卡片项 */
export interface SemesterCourseCardItem {
  courseName: string
  titleEn?: string
  teacher?: string
  locationsList: string[]
  assignments: ScheduleEvent[]
  events: ScheduleEvent[]
}

/** 教务总览指标概要 */
export interface JiaowuOverviewSummary {
  uniqueCourses: UniqueJiaowuCourse[]
  totalCredits: number
  uniqueTeachers: string[]
}

