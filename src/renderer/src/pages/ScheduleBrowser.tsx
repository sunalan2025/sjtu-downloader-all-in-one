import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useAppStore } from '../store/app'
import { Spinner } from '../components/Spinner'
import type {
  ScheduleEvent,
  ScheduleWeek,
  IcsExportOptions,
  JiaowuCourseItem,
  JiaowuScheduleResult
} from '@shared/types'

/** 交大官方 6 大标准教学时段定义 */
export interface TimeSlotDef {
  id: number
  periodHint: string
  slotLabel: string
  timeRange: string
  matchPeriod: (startMinutes: number) => boolean
}

export const SJTU_TIME_SLOTS: TimeSlotDef[] = [
  {
    id: 1,
    periodHint: '上午',
    slotLabel: '第 1-2 节',
    timeRange: '08:00 - 09:40',
    matchPeriod: m => m >= 7 * 60 && m < 9 * 60 + 50
  },
  {
    id: 2,
    periodHint: '上午',
    slotLabel: '第 3-4 节',
    timeRange: '10:00 - 11:40',
    matchPeriod: m => m >= 9 * 60 + 50 && m < 11 * 60 + 50
  },
  {
    id: 3,
    periodHint: '中午',
    slotLabel: '第 5-6 节',
    timeRange: '12:00 - 13:40',
    matchPeriod: m => m >= 11 * 60 + 50 && m < 12 * 60 + 50
  },
  {
    id: 4,
    periodHint: '下午',
    slotLabel: '第 7-8 节',
    timeRange: '14:00 - 15:40',
    matchPeriod: m => m >= 12 * 60 + 50 && m < 15 * 60 + 50
  },
  {
    id: 5,
    periodHint: '下午',
    slotLabel: '第 9-10 节',
    timeRange: '16:00 - 17:40',
    matchPeriod: m => m >= 15 * 60 + 50 && m < 17 * 60 + 50
  },
  {
    id: 6,
    periodHint: '晚间',
    slotLabel: '第 11-14 节',
    timeRange: '18:00 - 21:30',
    matchPeriod: m => m >= 17 * 60 + 50
  }
]

/** 跨时段范围信息定义 */
export interface SlotRangeInfo {
  startSlot: number
  endSlot: number
  span: number
  badge?: string
  isLabOrLongSession: boolean
}

/** 将官方节次数字映射为 6 大时段编号 (1..6) */
export function periodToSlot(p: number): number {
  if (p <= 2) return 1
  if (p <= 4) return 2
  if (p <= 6) return 3
  if (p <= 8) return 4
  if (p <= 10) return 5
  return 6
}

/** 从教务节次描述（如 "1-2节", "5-10节", "6-8节", "6-9节"）计算其覆盖的标准时段范围与跨行数 */
export function getSlotRangeFromJc(jc: string): SlotRangeInfo {
  if (!jc) return { startSlot: 1, endSlot: 1, span: 1, isLabOrLongSession: false }
  const clean = jc.replace(/节/g, '').trim()
  const m = clean.match(/^(\d+)(?:-(\d+))?/)
  if (!m) return { startSlot: 1, endSlot: 1, span: 1, isLabOrLongSession: false }

  const startP = parseInt(m[1], 10)
  const endP = m[2] ? parseInt(m[2], 10) : startP

  // 1. 特殊超长实验课判定 (如周一下午 5-10 节有机化学实验，横跨 12:00~17:40 整整一个下午)
  if (startP === 5 && endP >= 9) {
    return {
      startSlot: 3,
      endSlot: 5,
      span: 3,
      badge: `${startP}-${endP}节大实验 (12:00 ~ 17:40 · ${endP - startP + 1}节连堂)`,
      isLabOrLongSession: true
    }
  }

  // 2. 6-9 节大实验 (如周四 ET 创新实验 / 周一无机化学实验，12:55~16:45 跨 3 个时段)
  if (startP === 6 && endP >= 9) {
    return {
      startSlot: 3,
      endSlot: 5,
      span: 3,
      badge: `${startP}-${endP}节实验 (12:55 ~ 16:45 · ${endP - startP + 1}节连堂)`,
      isLabOrLongSession: true
    }
  }

  // 3. 6-8 节思政大课 (12:55~15:40，从中午 12:55 跨越至下午 15:40)
  if (startP === 6 && endP === 8) {
    return {
      startSlot: 3,
      endSlot: 4,
      span: 2,
      badge: '6-8节大课 (12:55 ~ 15:40)',
      isLabOrLongSession: false
    }
  }

  // 4. 7-10 节下午长实验 (14:00~17:40)
  if (startP === 7 && endP >= 10) {
    return {
      startSlot: 4,
      endSlot: 5,
      span: 2,
      badge: `${startP}-${endP}节实验 (14:00 ~ 17:40)`,
      isLabOrLongSession: true
    }
  }

  const startSlot = periodToSlot(startP)
  const endSlot = periodToSlot(endP)
  const span = Math.max(1, endSlot - startSlot + 1)
  const isLab = endP - startP + 1 >= 4 || clean.includes('实验')

  let badge: string | undefined
  if (startSlot === 6 && endP >= 13) {
    badge = `${startP}-${endP}节 (${endP === 14 ? '18:00 ~ 21:30' : '18:00 ~ 20:25'})`
  } else if (span > 1) {
    badge = `${startP}-${endP}节 (${endP - startP + 1}节连堂)`
  }

  return {
    startSlot,
    endSlot,
    span,
    badge,
    isLabOrLongSession: isLab
  }
}

/** 辅助获取节次起始时段编号 (兼容调用) */
export function getSlotIdFromJc(jc: string): number {
  return getSlotRangeFromJc(jc).startSlot
}

/** 从时间时刻 HH:mm 计算其覆盖的标准时段范围与跨行数 */
export function getSlotRangeFromTime(startTime: string, endTime?: string): SlotRangeInfo {
  if (!startTime) return { startSlot: 1, endSlot: 1, span: 1, isLabOrLongSession: false }

  // 1. 若为思政大课
  if (startTime.includes('12:55') || startTime.includes('6-8')) {
    return {
      startSlot: 3,
      endSlot: 4,
      span: 2,
      badge: '6-8节大课 (12:55 ~ 15:40)',
      isLabOrLongSession: false
    }
  }

  const parseMinutes = (tStr: string): number | null => {
    const m = tStr.match(/(\d{1,2}):(\d{2})/)
    if (!m) return null
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
  }

  const sMin = parseMinutes(startTime)
  if (sMin === null) return { startSlot: 1, endSlot: 1, span: 1, isLabOrLongSession: false }

  const eMin = endTime ? parseMinutes(endTime) : null

  const minToSlot = (m: number): number => {
    if (m < 9 * 60 + 50) return 1 // 08:00 - 09:40
    if (m < 11 * 60 + 50) return 2 // 10:00 - 11:40
    if (m < 13 * 60 + 50) return 3 // 12:00 - 13:40
    if (m < 15 * 60 + 50) return 4 // 14:00 - 15:40
    if (m < 17 * 60 + 50) return 5 // 16:00 - 17:40
    return 6 // 18:00 - 21:30
  }

  const startSlot = minToSlot(sMin)
  let endSlot = startSlot

  if (eMin !== null && eMin > sMin) {
    // 减去 5 分钟容差，避免刚好下课时刻越界到下一槽位
    endSlot = minToSlot(eMin - 5)
    if (endSlot < startSlot) endSlot = startSlot
  }

  const span = Math.max(1, endSlot - startSlot + 1)
  const durationMins = eMin !== null ? eMin - sMin : 0
  const isLab = durationMins >= 180

  let badge: string | undefined
  if (span > 1) {
    badge = `${span}时段连堂 (${formatEventTime(startTime)} ~ ${endTime ? formatEventTime(endTime) : ''})`
  }

  return {
    startSlot,
    endSlot,
    span,
    badge,
    isLabOrLongSession: isLab
  }
}

/** 从时间字符串 HH:mm 匹配标准时段编号 1..6 */
export function getSlotIdFromTime(timeStr: string): number {
  return getSlotRangeFromTime(timeStr).startSlot
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

/** 将同一天内的事件按时段重叠区间进行分组聚类，避免 CSS Grid 重叠遮挡 */
export function clusterDayEvents(events: PlacedEvent[]): DayEventCluster[] {
  if (events.length === 0) return []
  const sorted = [...events].sort((a, b) => a.startSlot - b.startSlot || b.span - a.span)
  const clusters: DayEventCluster[] = []
  let currentCluster: PlacedEvent[] = [sorted[0]]
  let clusterStart = sorted[0].startSlot
  let clusterEnd = sorted[0].endSlot

  for (let i = 1; i < sorted.length; i++) {
    const ev = sorted[i]
    if (ev.startSlot <= clusterEnd) {
      currentCluster.push(ev)
      clusterEnd = Math.max(clusterEnd, ev.endSlot)
    } else {
      clusters.push({
        startSlot: clusterStart,
        endSlot: clusterEnd,
        span: Math.max(1, clusterEnd - clusterStart + 1),
        events: currentCluster
      })
      currentCluster = [ev]
      clusterStart = ev.startSlot
      clusterEnd = ev.endSlot
    }
  }
  clusters.push({
    startSlot: clusterStart,
    endSlot: clusterEnd,
    span: Math.max(1, clusterEnd - clusterStart + 1),
    events: currentCluster
  })
  return clusters
}

/** 判定给定教学周是否落在周次描述字符串中（如 "1-16周", "1-15周(单)", "2-16周(双)", "第12周"） */
export function isWeekInZcd(weekNum: number, zcd: string): boolean {
  if (!zcd) return true
  const parts = zcd.split(',')
  for (const rawPart of parts) {
    const part = rawPart.trim()
    if (!part) continue

    if (part.includes('(单)')) {
      const m = part.match(/(\d+)-(\d+)/)
      if (m) {
        const start = parseInt(m[1], 10)
        const end = parseInt(m[2], 10)
        if (weekNum >= start && weekNum <= end && weekNum % 2 === 1) return true
      }
      continue
    }

    if (part.includes('(双)')) {
      const m = part.match(/(\d+)-(\d+)/)
      if (m) {
        const start = parseInt(m[1], 10)
        const end = parseInt(m[2], 10)
        if (weekNum >= start && weekNum <= end && weekNum % 2 === 0) return true
      }
      continue
    }

    const rangeMatch = part.match(/(\d+)-(\d+)/)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10)
      const end = parseInt(rangeMatch[2], 10)
      if (weekNum >= start && weekNum <= end) return true
      continue
    }

    const singleMatch = part.match(/(?:第)?(\d+)周?/)
    if (singleMatch) {
      const w = parseInt(singleMatch[1], 10)
      if (weekNum === w) return true
    }
  }
  return false
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
}

/** 辅助从周次文本或英文解析阿拉伯数字周次 (如 "第五周", "Week 5" -> 5) */
export function parseWeekNumber(weekStr: string, weekEn?: string): number | null {
  if (weekEn) {
    const m = weekEn.match(/\d+/)
    if (m) return parseInt(m[0], 10)
  }
  const digitMatch = weekStr.match(/\d+/)
  if (digitMatch) return parseInt(digitMatch[0], 10)

  // 先提取 "第X周" 中的中文字符
  const chMatch = weekStr.match(/第([一二三四五六七八九十]+)周/)
  const token = chMatch ? chMatch[1] : weekStr

  // 按照字符串长度倒序排列，确保 "十六" 优先于 "六" 和 "十" 匹配
  const chMap: Record<string, number> = {
    二十: 20, 十九: 19, 十八: 18, 十七: 17, 十六: 16, 十五: 15, 十四: 14, 十三: 13, 十二: 12, 十一: 11,
    十: 10, 九: 9, 八: 8, 七: 7, 六: 6, 五: 5, 四: 4, 三: 3, 二: 2, 一: 1
  }

  if (token && chMap[token]) {
    return chMap[token]
  }

  for (const [ch, num] of Object.entries(chMap)) {
    if (weekStr.includes(`第${ch}周`) || weekStr.includes(ch)) return num
  }
  return null
}

/** 将周次数组聚合格式化为交大标准周次描述 (如 [1..16] -> "1-16周", [1,3,5..] -> "1-15周(单)") */
export function formatWeeksRange(rawWeeks: number[]): string {
  const weeks = Array.from(new Set(rawWeeks)).sort((a, b) => a - b)
  if (weeks.length === 0) return ''
  if (weeks.length === 1) return `第${weeks[0]}周`

  const min = weeks[0]
  const max = weeks[weeks.length - 1]
  const count = weeks.length

  if (count === max - min + 1) {
    return `${min}-${max}周`
  }

  const isAllOdd = weeks.every(w => w % 2 === 1)
  if (isAllOdd && count === Math.floor((max - min) / 2) + 1) {
    return `${min}-${max}周(单)`
  }

  const isAllEven = weeks.every(w => w % 2 === 0)
  if (isAllEven && count === Math.floor((max - min) / 2) + 1) {
    return `${min}-${max}周(双)`
  }

  const ranges: string[] = []
  let rangeStart = weeks[0]
  let prev = weeks[0]

  for (let i = 1; i < weeks.length; i++) {
    const cur = weeks[i]
    if (cur === prev + 1) {
      prev = cur
    } else {
      ranges.push(rangeStart === prev ? `第${rangeStart}周` : `${rangeStart}-${prev}周`)
      rangeStart = cur
      prev = cur
    }
  }
  ranges.push(rangeStart === prev ? `第${rangeStart}周` : `${rangeStart}-${prev}周`)
  return ranges.join(', ')
}

/** 辅助获取日期字符串 YYYY-MM-DD */
function getEventDateStr(timeStr: string): string {
  if (!timeStr) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(timeStr)) {
    return timeStr.slice(0, 10)
  }
  try {
    const d = new Date(timeStr)
    if (isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  } catch {
    return ''
  }
}

/** 辅助格式化短日期 M/D */
function formatShortDate(timeStr: string): string {
  if (!timeStr) return ''
  const m = timeStr.match(/(?:^\d{4}-)?0?(\d{1,2})-0?(\d{1,2})/)
  if (m) return `${m[1]}/${m[2]}`
  try {
    const d = new Date(timeStr)
    if (!isNaN(d.getTime())) return `${d.getMonth() + 1}/${d.getDate()}`
  } catch { /* ignore */ }
  return ''
}

/** 辅助提取标准展示时刻 HH:mm */
export function formatEventTime(timeStr: string): string {
  if (!timeStr) return ''
  const m = timeStr.match(/(\d{1,2}:\d{2})/)
  return m ? m[1] : timeStr
}

/** 获取排课或日程的标准官方作息时间展示文本 */
export function getEventDisplayTime(item: ScheduleEvent): string {
  // 1. 若为思政大课 (6-8 节连堂，12:55 开始)
  if (
    item.startTime.includes('12:55') ||
    item.startTime.includes('6-8') ||
    item.title.includes('思想道德') ||
    item.title.includes('思政')
  ) {
    return '12:55 ~ 15:40 (第6-8节)'
  }

  // 2. 若带有具体时间时刻（如 "2026-10-14 14:00:00" 或 "14:00"）
  if (item.startTime.includes(':')) {
    const s = formatEventTime(item.startTime)
    const e = formatEventTime(item.endTime)
    return e ? `${s} ~ ${e}` : s
  }

  // 3. 若为教务节次（如 "1-2节", "5-10节"）
  const jcClean = item.startTime.replace(/节/g, '').trim()
  if (jcClean.startsWith('5-10')) {
    return `${item.startTime} (12:00 ~ 17:40 · 6节连堂)`
  }
  if (jcClean.startsWith('6-9')) {
    return `${item.startTime} (12:55 ~ 16:45 · 4节连堂)`
  }
  if (jcClean.startsWith('6-8')) {
    return `${item.startTime} (12:55 ~ 15:40 · 3节大课)`
  }
  if (jcClean.startsWith('7-10')) {
    return `${item.startTime} (14:00 ~ 17:40 · 4节连堂)`
  }
  if (jcClean.startsWith('1-2') || jcClean === '1' || jcClean === '2') {
    return `${item.startTime} (08:00 ~ 09:40)`
  }
  if (jcClean.startsWith('3-4') || jcClean === '3' || jcClean === '4') {
    return `${item.startTime} (10:00 ~ 11:40)`
  }
  if (jcClean.startsWith('5-6') || jcClean === '5') {
    return `${item.startTime} (12:00 ~ 13:40)`
  }
  if (jcClean.startsWith('7-8') || jcClean === '7' || jcClean === '8') {
    return `${item.startTime} (14:00 ~ 15:40)`
  }
  if (jcClean.startsWith('9-10') || jcClean === '9' || jcClean === '10') {
    return `${item.startTime} (16:00 ~ 17:40)`
  }
  if (jcClean.startsWith('11-14')) {
    return `${item.startTime} (18:00 ~ 21:30 · 4节连堂)`
  }
  if (jcClean.startsWith('11-13')) {
    return `${item.startTime} (18:00 ~ 20:25 · 3节连堂)`
  }
  if (jcClean.startsWith('11') || jcClean.startsWith('12')) {
    return `${item.startTime} (18:00 ~ 19:40)`
  }

  return item.startTime
}

export function ScheduleBrowser() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [weeks, setWeeks] = useState<ScheduleWeek[]>([])
  const [currentWeek, setCurrentWeek] = useState<string>('')
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>('')
  const [semesterTitle, setSemesterTitle] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  // 学期选择器状态：'current' 为实时交我办+Canvas，其余如 '2026_3' 为教务系统历年课表（已持久化）
  const selectedSemesterKey = useAppStore(s => s.scheduleSelectedSemesterKey)
  const setSelectedSemesterKey = useAppStore(s => s.setScheduleSelectedSemesterKey)
  const [jiaowuCache, setJiaowuCache] = useState<Record<string, JiaowuScheduleResult>>({})
  const [jiaowuLoading, setJiaowuLoading] = useState(false)
  const [selectedJiaowuWeek, setSelectedJiaowuWeek] = useState<number>(5)
  const [enrollmentYear, setEnrollmentYear] = useState<number>(2025)

  // 视图模式：'week' (周视图) | 'semester' (学期总览)（已持久化）
  const viewMode = useAppStore(s => s.scheduleViewMode)
  const setViewMode = useAppStore(s => s.setScheduleViewMode)
  const expandNoonSlot = useAppStore(s => s.scheduleExpandNoonSlot)
  const setExpandNoonSlot = useAppStore(s => s.setScheduleExpandNoonSlot)

  // Apple 日历图层开关：排课、讲座/活动、作业 DDL（已持久化）
  const layerFilter = useAppStore(s => s.scheduleLayerFilter)
  const setLayerFilter = useAppStore(s => s.setScheduleLayerFilter)

  // 学期总览子标签：'courses' (按课程聚合) | 'activities' (讲座与活动) | 'assignments' (作业时间轴)
  const [overviewTab, setOverviewTab] = useState<'courses' | 'activities' | 'assignments'>('courses')
  // 学期总览课程子视图：'grid' (全景作息网格，默认直观展示) | 'cards' (课程清单卡片)
  const [overviewCourseView, setOverviewCourseView] = useState<'grid' | 'cards'>('grid')
  const [selectedCourseForModal, setSelectedCourseForModal] = useState<SemesterCourseDetail | null>(null)
  const [expandSemesterNoonSlot, setExpandSemesterNoonSlot] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedCourseNames, setExpandedCourseNames] = useState<Set<string>>(new Set())

  // Apple 风格悬浮卡片 (Hover Popover)
  const [hoveredCourseItem, setHoveredCourseItem] = useState<{
    item: ScheduleEvent
    rect: DOMRect
  } | null>(null)
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null)

  const handleCardMouseEnter = useCallback((item: ScheduleEvent, e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      setHoveredCourseItem({ item, rect })
    }, 150)
  }, [])

  const handleCardMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setHoveredCourseItem(null)
  }, [])

  // 导出设置与状态
  const [includeCourses, setIncludeCourses] = useState(true)
  const [includeActivities, setIncludeActivities] = useState(true)
  const [includeDdl, setIncludeDdl] = useState(true)
  const [alarmMinutesBefore, setAlarmMinutesBefore] = useState(20)
  const [alarmDdlHoursBefore, setAlarmDdlHoursBefore] = useState(24)
  const [exporting, setExporting] = useState(false)
  const [exportedPath, setExportedPath] = useState<string | null>(null)
  const [exportCount, setExportCount] = useState<number>(0)
  const [showExportModal, setShowExportModal] = useState(false)

  // 加载当前学期（交我办 + Canvas）
  const loadSchedule = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await window.api.schedule.fetchEvents()
      if (!res.ok) {
        if (res.error === 'NEED_LOGIN') {
          setError('交我办/校历静默授权未完成，请点击下方按钮重新同步')
        } else {
          setError(res.error || '拉取课表数据失败')
        }
      } else {
        setEvents(res.events || [])
        const rawWeeks = res.weeks || []
        setWeeks(rawWeeks)
        if (res.semesterTitle) setSemesterTitle(res.semesterTitle)

        // 默认定位当前周
        const cWeek = res.currentWeek
        if (cWeek) {
          setCurrentWeek(cWeek)
          const matched =
            rawWeeks.find(w => w.week === cWeek && (!res.semesterTitle || w.title === res.semesterTitle)) ||
            rawWeeks.find(w => w.week === cWeek) ||
            rawWeeks[0]
          if (matched) {
            setSelectedWeekKey(`${matched.title || ''}_${matched.week}`)
          }
          // 同步提取数字供教务周次参考
          const numMatch = cWeek.match(/\d+/)
          if (numMatch) {
            setSelectedJiaowuWeek(parseInt(numMatch[0], 10))
          }
        } else if (rawWeeks.length > 0) {
          setSelectedWeekKey(`${rawWeeks[0].title || ''}_${rawWeeks[0].week}`)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '拉取课表数据失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // 加载教务系统历年课表
  const loadJiaowuSemester = useCallback(
    async (key: string, force = false) => {
      if (!force && jiaowuCache[key]) {
        return
      }
      const [xnm, xqm] = key.split('_')
      if (!xnm || !xqm) return

      setJiaowuLoading(true)
      setError(null)
      try {
        const res = await window.api.schedule.fetchJiaowu(xnm, xqm)
        if (!res.ok) {
          if (res.error === 'NEED_LOGIN') {
            setError('教务系统 (i.sjtu.edu.cn) 会话失效，请先完成 jAccount 登录')
          } else {
            setError(res.error || '查询历年课表失败')
          }
        } else {
          setJiaowuCache(prev => ({ ...prev, [key]: res }))
          if (res.studentGrade) {
            const y = parseInt(res.studentGrade, 10)
            if (!isNaN(y) && y >= 2000 && y <= 2035) {
              setEnrollmentYear(y)
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '查询历年课表失败')
      } finally {
        setJiaowuLoading(false)
      }
    },
    [jiaowuCache]
  )

  useEffect(() => {
    void loadSchedule()
    // 静默预提取学籍与教务当前学期课表（不打扰主视图错误状态）
    window.api.schedule
      .fetchJiaowu('2026', '3')
      .then(res => {
        if (res && res.ok) {
          setJiaowuCache(prev => ({ ...prev, '2026_3': res }))
          if (res.studentGrade) {
            const y = parseInt(res.studentGrade, 10)
            if (!isNaN(y) && y >= 2000 && y <= 2035) {
              setEnrollmentYear(y)
            }
          }
        }
      })
      .catch(() => {})
  }, [loadSchedule])

  // 监听教务系统返回的学籍信息自动提取入学年份 (例如 "2025")
  useEffect(() => {
    for (const res of Object.values(jiaowuCache)) {
      if (res.studentGrade) {
        const y = parseInt(res.studentGrade, 10)
        if (!isNaN(y) && y >= 2000 && y <= 2035) {
          setEnrollmentYear(y)
          break
        }
      }
    }
  }, [jiaowuCache])

  // 监听 Esc 键关闭课程详情弹窗与悬浮卡片
  useEffect(() => {
    if (!selectedCourseForModal && !hoveredCourseItem) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedCourseForModal(null)
        handleCardMouseLeave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedCourseForModal, hoveredCourseItem, handleCardMouseLeave])

  // 根据入学年份（如 2025 级）动态生成学期列表，只展示入学以来的学期，彻底隐藏入学前的空学期
  const dynamicJiaowuSemesters = useMemo(() => {
    const currentXnm = 2026
    const list: Array<{ key: string; label: string }> = []
    for (let y = currentXnm; y >= enrollmentYear; y--) {
      if (y === currentXnm) {
        list.push({ key: `${y}_3`, label: `${y}-${y + 1}学年 第1学期 (秋季 · 官方教务)` })
      } else {
        list.push({ key: `${y}_16`, label: `${y}-${y + 1}学年 第3学期 (夏季小学期)` })
        list.push({ key: `${y}_12`, label: `${y}-${y + 1}学年 第2学期 (春季)` })
        list.push({
          key: `${y}_3`,
          label: `${y}-${y + 1}学年 第1学期 (秋季${y === enrollmentYear ? ' · 入学学期' : ''})`
        })
      }
    }
    return list
  }, [enrollmentYear])

  const handleSemesterChange = (key: string) => {
    setSelectedSemesterKey(key)
    if (key !== 'current') {
      void loadJiaowuSemester(key)
    }
  }

  const isCurrentMode = selectedSemesterKey === 'current'
  const currentJiaowuResult = !isCurrentMode ? jiaowuCache[selectedSemesterKey] : null

  // 三大类事件分流（当前学期模式）
  const courseEvents = useMemo(() => events.filter(e => e.type === 'course'), [events])
  const activityEvents = useMemo(() => events.filter(e => e.type === 'activity'), [events])
  const ddlEvents = useMemo(() => events.filter(e => e.type === 'assignment_ddl'), [events])

  const uniqueCourseNames = useMemo(() => {
    const set = new Set<string>()
    for (const e of courseEvents) {
      if (e.title) set.add(e.title)
    }
    return Array.from(set)
  }, [courseEvents])

  // 周次分组：正式学期周次 vs 假期周次
  const { regularTermWeeks, breakWeeks } = useMemo(() => {
    const regular: ScheduleWeek[] = []
    const breaks: ScheduleWeek[] = []
    for (const w of weeks) {
      if (w.title && (w.title.includes('寒假') || w.title.includes('暑假'))) {
        breaks.push(w)
      } else {
        regular.push(w)
      }
    }
    return { regularTermWeeks: regular, breakWeeks: breaks }
  }, [weeks])

  // 当前选中的周次对象
  const selectedWeekObj = useMemo(() => {
    if (weeks.length === 0) return null
    if (!selectedWeekKey) return weeks[0]
    return weeks.find(w => `${w.title || ''}_${w.week}` === selectedWeekKey) || weeks[0]
  }, [selectedWeekKey, weeks])

  const selectedWeekIndex = useMemo(() => {
    if (!selectedWeekObj || weeks.length === 0) return -1
    return weeks.findIndex(
      w => `${w.title || ''}_${w.week}` === `${selectedWeekObj.title || ''}_${selectedWeekObj.week}`
    )
  }, [selectedWeekObj, weeks])

  // 周视图 7 天列数据构建
  const weekDays = useMemo(() => {
    let baseMonday: Date
    if (isCurrentMode && selectedWeekObj?.startTime) {
      baseMonday = new Date(selectedWeekObj.startTime.replace(/-/g, '/'))
    } else {
      const now = new Date()
      const day = (now.getDay() + 6) % 7 // Monday = 0
      baseMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day, 0, 0, 0)
    }

    const todayStr = new Date().toISOString().slice(0, 10)
    const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    const pad = (n: number) => String(n).padStart(2, '0')

    return dayNames.map((name, i) => {
      const cur = new Date(baseMonday.getTime() + i * 86400000)
      const dateStr = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`
      return {
        dayIndex: i, // 0..6 (周一至周日)
        dayLabel: name,
        dateStr,
        displayDate: `${cur.getMonth() + 1}月${cur.getDate()}日`,
        shortDate: `${cur.getMonth() + 1}/${cur.getDate()}`,
        isToday: dateStr === todayStr
      }
    })
  }, [isCurrentMode, selectedWeekObj])

  // 图层过滤后的当前活跃事件
  const activeEvents = useMemo(() => {
    return events.filter(e => {
      if (e.type === 'course' && !layerFilter.course) return false
      if (e.type === 'activity' && !layerFilter.activity) return false
      if (e.type === 'assignment_ddl' && !layerFilter.ddl) return false
      return true
    })
  }, [events, layerFilter])

  // ══════════════════════════════════════════════════════════
  // 核心：基于交大 6 大标准时段 + CSS Grid 跨行贯通分配
  // 保证同一时段课程水平严格对齐，超长大实验课跨行自然舒展！
  // ══════════════════════════════════════════════════════════
  const { dayClusters, dayTopEvents, hasAnyTopEvents, occupiedSlots, hasNoonEvents } = useMemo(() => {
    const topEvents = new Map<string, ScheduleEvent[]>()
    for (const d of weekDays) {
      topEvents.set(d.dateStr, [])
    }
    const dayEventMap = new Map<number, PlacedEvent[]>()
    for (let i = 0; i < 7; i++) {
      dayEventMap.set(i, [])
    }

    if (isCurrentMode) {
      // 1. 当前学期模式：将当前周活跃事件分配到槽位与跨时段计算
      for (const e of activeEvents) {
        const dateStr = getEventDateStr(e.startTime)
        const dayIdx = weekDays.findIndex(d => d.dateStr === dateStr)
        if (dayIdx === -1) continue

        if (e.type === 'assignment_ddl' || e.allDay) {
          topEvents.get(dateStr)!.push(e)
        } else {
          const range = getSlotRangeFromTime(e.startTime, e.endTime)
          const placed: PlacedEvent = {
            ...e,
            dayIndex: dayIdx,
            startSlot: range.startSlot,
            endSlot: range.endSlot,
            span: range.span,
            badge: range.badge,
            isLabOrLongSession: range.isLabOrLongSession
          }
          dayEventMap.get(dayIdx)!.push(placed)
        }
      }
    } else if (currentJiaowuResult?.courses) {
      // 2. 历年教务系统模式：按周次 zcd 和星期 xqj 映射至 6 大槽位与动态 Row Span 跨行
      const matchedCourses = currentJiaowuResult.courses.filter(c =>
        isWeekInZcd(selectedJiaowuWeek, c.zcd)
      )

      for (const c of matchedCourses) {
        const xqjNum = parseInt(c.xqj, 10)
        const dayIdx = xqjNum >= 1 && xqjNum <= 7 ? xqjNum - 1 : 0
        const range = getSlotRangeFromJc(c.jc)

        const placed: PlacedEvent = {
          id: `jiaowu-${c.kch || c.kcmc}-${c.xqj}-${c.jc}-${selectedJiaowuWeek}`,
          title: c.kcmc,
          location: c.cdmc,
          teacher: c.xm,
          startTime: c.jc,
          endTime: c.zcd,
          type: 'course',
          description: c.jxbmc ? `教学班: ${c.jxbmc} | 学分: ${c.xf || '-'}` : undefined,
          dayIndex: dayIdx,
          startSlot: range.startSlot,
          endSlot: range.endSlot,
          span: range.span,
          badge: range.badge,
          isLabOrLongSession: range.isLabOrLongSession,
          xf: c.xf,
          jxbmc: c.jxbmc
        }

        dayEventMap.get(dayIdx)!.push(placed)
      }
    }

    const clustersMap = new Map<number, DayEventCluster[]>()
    const occupied = new Set<string>()

    for (let i = 0; i < 7; i++) {
      const list = dayEventMap.get(i) || []
      const clusters = clusterDayEvents(list)
      clustersMap.set(i, clusters)

      for (const cl of clusters) {
        for (let s = cl.startSlot; s <= cl.endSlot; s++) {
          occupied.add(`${i}-${s}`)
        }
      }
    }

    let topCount = 0
    for (const arr of topEvents.values()) {
      topCount += arr.length
    }

    const hasNoon = weekDays.some(d => occupied.has(`${d.dayIndex}-3`))

    return {
      dayClusters: clustersMap,
      dayTopEvents: topEvents,
      hasAnyTopEvents: topCount > 0,
      occupiedSlots: occupied,
      hasNoonEvents: hasNoon
    }
  }, [isCurrentMode, activeEvents, currentJiaowuResult, selectedJiaowuWeek, weekDays])

  // 教务系统学期总览数据提取
  const jiaowuOverview = useMemo(() => {
    if (!currentJiaowuResult?.courses) return null
    const map = new Map<string, JiaowuCourseItem[]>()
    for (const c of currentJiaowuResult.courses) {
      if (!map.has(c.kcmc)) {
        map.set(c.kcmc, [])
      }
      map.get(c.kcmc)!.push(c)
    }

    const uniqueCourses = Array.from(map.entries()).map(([name, items]) => {
      const first = items[0]
      const teachers = Array.from(new Set(items.map(i => i.xm).filter(Boolean))).join(', ')
      const locations = Array.from(new Set(items.map(i => i.cdmc).filter(Boolean))).join(', ')
      const periodAndWeeks = items.map(i => `${i.xqjmc} ${i.jc} (${i.zcd})`).join('; ')
      return {
        name,
        kch: first.kch,
        xf: first.xf,
        kcbj: first.kcbj,
        kclbmc: first.kclbmc,
        jxbmc: first.jxbmc,
        teachers,
        locations,
        periodAndWeeks,
        items
      }
    })

    const totalCredits = uniqueCourses.reduce((sum, c) => sum + (parseFloat(c.xf || '0') || 0), 0)
    const uniqueTeachers = Array.from(
      new Set(currentJiaowuResult.courses.map(c => c.xm).filter(Boolean))
    )

    return { uniqueCourses, totalCredits, uniqueTeachers }
  }, [currentJiaowuResult])

  // 当前学期按真实选修课程维度聚合
  const courseCards = useMemo(() => {
    const map = new Map<
      string,
      {
        courseName: string
        titleEn?: string
        teacher?: string
        locations: Set<string>
        events: ScheduleEvent[]
        assignments: ScheduleEvent[]
      }
    >()

    for (const e of courseEvents) {
      if (!map.has(e.title)) {
        map.set(e.title, {
          courseName: e.title,
          titleEn: e.titleEn,
          teacher: e.teacher,
          locations: new Set(),
          events: [],
          assignments: []
        })
      }
      const item = map.get(e.title)!
      if (e.location && e.location !== '不排教室') {
        item.locations.add(e.location)
      }
      if (!item.teacher && e.teacher) {
        item.teacher = e.teacher
      }
      item.events.push(e)
    }

    for (const a of ddlEvents) {
      const matchName = a.courseName || ''
      for (const [cName, item] of map.entries()) {
        if (matchName.includes(cName) || cName.includes(matchName)) {
          item.assignments.push(a)
          break
        }
      }
    }

    return Array.from(map.values()).map(g => ({
      ...g,
      locationsList: Array.from(g.locations),
      events: g.events.sort((a, b) => a.startTime.localeCompare(b.startTime)),
      assignments: g.assignments.sort((a, b) => a.startTime.localeCompare(b.startTime))
    }))
  }, [courseEvents, ddlEvents])

  // 搜索过滤
  const filteredCourseCards = useMemo(() => {
    if (!searchQuery.trim()) return courseCards
    const q = searchQuery.toLowerCase().trim()
    return courseCards.filter(
      g =>
        g.courseName.toLowerCase().includes(q) ||
        (g.teacher && g.teacher.toLowerCase().includes(q)) ||
        g.locationsList.some(loc => loc.toLowerCase().includes(q))
    )
  }, [courseCards, searchQuery])

  const filteredJiaowuCourses = useMemo(() => {
    if (!jiaowuOverview) return []
    if (!searchQuery.trim()) return jiaowuOverview.uniqueCourses
    const q = searchQuery.toLowerCase().trim()
    return jiaowuOverview.uniqueCourses.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        (c.kch && c.kch.toLowerCase().includes(q)) ||
        c.teachers.toLowerCase().includes(q) ||
        c.locations.toLowerCase().includes(q)
    )
  }, [jiaowuOverview, searchQuery])

  const filteredActivities = useMemo(() => {
    const list = [...activityEvents].sort((a, b) => a.startTime.localeCompare(b.startTime))
    if (!searchQuery.trim()) return list
    const q = searchQuery.toLowerCase().trim()
    return list.filter(
      e =>
        e.title.toLowerCase().includes(q) ||
        (e.location && e.location.toLowerCase().includes(q)) ||
        (e.description && e.description.toLowerCase().includes(q))
    )
  }, [activityEvents, searchQuery])

  const filteredAssignments = useMemo(() => {
    const list = [...ddlEvents].sort((a, b) => a.startTime.localeCompare(b.startTime))
    if (!searchQuery.trim()) return list
    const q = searchQuery.toLowerCase().trim()
    return list.filter(
      e =>
        e.title.toLowerCase().includes(q) ||
        (e.courseName && e.courseName.toLowerCase().includes(q))
    )
  }, [ddlEvents, searchQuery])

  const toggleCourseExpand = (name: string) => {
    setExpandedCourseNames(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // ══════════════════════════════════════════════════════════
  // 学期全景作息网格数据生成 (Semester Timetable Grid Data)
  // 将全学期所有选修排课按 7 天 x 6 标准时段归一化聚合
  // ══════════════════════════════════════════════════════════
  const { semesterDayClusters, semesterOccupiedSlots, hasSemesterNoonEvents } = useMemo(() => {
    const dayEventMap = new Map<number, PlacedEvent[]>()
    for (let i = 0; i < 7; i++) {
      dayEventMap.set(i, [])
    }

    if (isCurrentMode) {
      // 1. 当前学期：将全量课程事件按 (课程名, 星期, 时段) 聚合成周期性课表条目
      const courseMap = new Map<
        string,
        {
          courseName: string
          dayOfWeek: number
          startSlot: number
          endSlot: number
          span: number
          badge?: string
          isLabOrLongSession: boolean
          location?: string
          teacher?: string
          weekNums: Set<number>
          timeStr: string
          sampleEvent: ScheduleEvent
        }
      >()

      for (const e of courseEvents) {
        if (!e.startTime) continue
        const dateStr = getEventDateStr(e.startTime)
        if (!dateStr) continue

        const d = new Date(e.startTime.replace(/-/g, '/'))
        const dayOfWeek = (d.getDay() + 6) % 7 // Monday = 0
        const range = getSlotRangeFromTime(e.startTime, e.endTime)
        const key = `${e.title}_${dayOfWeek}_${range.startSlot}_${range.endSlot}`

        if (!courseMap.has(key)) {
          courseMap.set(key, {
            courseName: e.title,
            dayOfWeek,
            startSlot: range.startSlot,
            endSlot: range.endSlot,
            span: range.span,
            badge: range.badge,
            isLabOrLongSession: range.isLabOrLongSession,
            location: e.location,
            teacher: e.teacher,
            weekNums: new Set<number>(),
            timeStr: `${formatEventTime(e.startTime)} ~ ${formatEventTime(e.endTime || '')}`,
            sampleEvent: e
          })
        }

        const entry = courseMap.get(key)!

        // 识别所在周次
        const matchedWeek = weeks.find(
          w => dateStr >= w.startTime.slice(0, 10) && dateStr <= w.endTime.slice(0, 10)
        )
        if (matchedWeek) {
          const wNum = parseWeekNumber(matchedWeek.week, matchedWeek.weekEn)
          if (wNum !== null) entry.weekNums.add(wNum)
        }
      }

      for (const entry of courseMap.values()) {
        const weekNumsArr = Array.from(entry.weekNums).sort((a, b) => a - b)
        const weekRangeStr = formatWeeksRange(weekNumsArr) || '整学期'

        const placed: PlacedEvent = {
          id: `sem-${entry.courseName}-${entry.dayOfWeek}-${entry.startSlot}`,
          title: entry.courseName,
          location: entry.location,
          teacher: entry.teacher,
          startTime: entry.timeStr,
          endTime: weekRangeStr,
          type: 'course',
          dayIndex: entry.dayOfWeek,
          startSlot: entry.startSlot,
          endSlot: entry.endSlot,
          span: entry.span,
          badge: entry.badge,
          isLabOrLongSession: entry.isLabOrLongSession,
          description: weekRangeStr
        }

        dayEventMap.get(entry.dayOfWeek)!.push(placed)
      }
    } else if (currentJiaowuResult?.courses) {
      // 2. 历年教务学期：直接提取官方全学期排课
      for (const c of currentJiaowuResult.courses) {
        const xqjNum = parseInt(c.xqj, 10)
        const dayIdx = xqjNum >= 1 && xqjNum <= 7 ? xqjNum - 1 : 0
        const range = getSlotRangeFromJc(c.jc)

        const placed: PlacedEvent = {
          id: `sem-jw-${c.kch || c.kcmc}-${c.xqj}-${c.jc}`,
          title: c.kcmc,
          location: c.cdmc,
          teacher: c.xm,
          startTime: c.jc,
          endTime: c.zcd, // 周次范围 (如 1-16周)
          type: 'course',
          dayIndex: dayIdx,
          startSlot: range.startSlot,
          endSlot: range.endSlot,
          span: range.span,
          badge: range.badge,
          isLabOrLongSession: range.isLabOrLongSession,
          xf: c.xf,
          jxbmc: c.jxbmc,
          description: c.jxbmc ? `教学班: ${c.jxbmc} | 学分: ${c.xf || '-'}` : undefined
        }

        dayEventMap.get(dayIdx)!.push(placed)
      }
    }

    const clustersMap = new Map<number, DayEventCluster[]>()
    const occupied = new Set<string>()

    for (let i = 0; i < 7; i++) {
      const list = dayEventMap.get(i) || []
      const clusters = clusterDayEvents(list)
      clustersMap.set(i, clusters)

      for (const cl of clusters) {
        for (let s = cl.startSlot; s <= cl.endSlot; s++) {
          occupied.add(`${i}-${s}`)
        }
      }
    }

    const hasNoon = [0, 1, 2, 3, 4, 5, 6].some(d => occupied.has(`${d}-3`))

    return {
      semesterDayClusters: clustersMap,
      semesterOccupiedSlots: occupied,
      hasSemesterNoonEvents: hasNoon
    }
  }, [isCurrentMode, courseEvents, weeks, currentJiaowuResult])

  // 打开课程全学期详情弹窗
  const handleOpenCourseModal = useCallback(
    (courseName: string) => {
      handleCardMouseLeave()
      if (isCurrentMode) {
        const matchedEvents = courseEvents.filter(e => e.title === courseName)
        const matchedDdl = ddlEvents.filter(d => d.courseName === courseName)
        const first = matchedEvents[0]
        const locations = Array.from(new Set(matchedEvents.map(e => e.location).filter(Boolean))).join(' / ')
        const teachers = Array.from(new Set(matchedEvents.map(e => e.teacher).filter(Boolean))).join(', ')

        const sessions = matchedEvents.map((ev, idx) => ({
          dateStr: getEventDateStr(ev.startTime),
          timeStr: `${formatEventTime(ev.startTime)} ~ ${formatEventTime(ev.endTime || '')}`,
          location: ev.location,
          teacher: ev.teacher,
          weekHint: `第 ${idx + 1} 讲`
        }))

        setSelectedCourseForModal({
          courseName,
          titleEn: first?.titleEn || first?.calendarName,
          teachers: teachers || first?.teacher || '主讲教师团队',
          locations: locations || first?.location || '校内教室',
          periodAndWeeks: `全学期共 ${matchedEvents.length} 讲课时`,
          scheduleSessions: sessions,
          assignments: matchedDdl
        })
      } else if (currentJiaowuResult?.courses) {
        const items = currentJiaowuResult.courses.filter(c => c.kcmc === courseName)
        if (items.length === 0) return
        const first = items[0]
        const teachers = Array.from(new Set(items.map(i => i.xm).filter(Boolean))).join(', ')
        const locations = Array.from(new Set(items.map(i => i.cdmc).filter(Boolean))).join(', ')
        const periodAndWeeks = items.map(i => `${i.xqjmc} ${i.jc} (${i.zcd})`).join('; ')

        const sessions = items.map(item => ({
          timeStr: `${item.xqjmc} ${item.jc}`,
          location: item.cdmc,
          teacher: item.xm,
          weekHint: item.zcd
        }))

        setSelectedCourseForModal({
          courseName,
          kch: first.kch,
          kcbj: first.kcbj,
          xf: first.xf,
          kclbmc: first.kclbmc,
          jxbmc: first.jxbmc,
          teachers,
          locations,
          periodAndWeeks,
          scheduleSessions: sessions
        })
      }
    },
    [isCurrentMode, courseEvents, ddlEvents, currentJiaowuResult, handleCardMouseLeave]
  )

  // 导出 ICS 日历
  const handleExport = async () => {
    if (events.length === 0) return
    setExporting(true)
    setExportedPath(null)
    try {
      const options: IcsExportOptions = {
        includeCourses,
        includeActivities,
        includeDdl,
        alarmMinutesBefore,
        alarmDdlHoursBefore
      }
      const res = await window.api.schedule.exportIcs(options, events)
      if (res.ok && res.path) {
        setExportedPath(res.path)
        setExportCount(res.count || 0)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出日历失败')
    } finally {
      setExporting(false)
    }
  }

  const ddlSubmittedCount = useMemo(() => {
    return ddlEvents.filter(
      d => d.submissionStatus === 'submitted' || d.submissionStatus === 'graded'
    ).length
  }, [ddlEvents])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface-1 text-text-1">
      {/* ─── 顶栏控制条 (Apple HIG 风格) ─── */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-bd bg-surface-2/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <span className="text-base font-bold text-text-1 tracking-tight">📅 课表与日程</span>

            {/* 学年学期全局切换下拉选择器 (集成交大教学信息服务网历年课表) */}
            <select
              value={selectedSemesterKey}
              onChange={e => handleSemesterChange(e.target.value)}
              className="rounded-xl border border-bd bg-surface-1 pl-3 pr-8 py-1.5 text-xs font-semibold text-text-1 focus:border-accent focus:outline-none cursor-pointer shadow-2xs hover:border-bd-strong transition-all"
              title="切换当前学期或历史官方排课"
            >
              <optgroup label="交我办 & Canvas (当前学期实时联动)">
                <option value="current">
                  2026-2027-1 (交我办日历 + Canvas全量作业) · 实时
                </option>
              </optgroup>
              <optgroup label="交大教学信息服务网 (历年官方学生课表)">
                {dynamicJiaowuSemesters.map(s => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* 视图模式分段选择器 (Apple Segmented Control) */}
          <div className="flex items-center rounded-xl bg-surface-3 p-1 shadow-2xs">
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={`rounded-lg px-3.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                viewMode === 'week'
                  ? 'bg-surface-1 text-text-1 shadow-2xs font-semibold'
                  : 'text-text-3 hover:text-text-2'
              }`}
            >
              📅 周视图
            </button>
            <button
              type="button"
              onClick={() => setViewMode('semester')}
              className={`rounded-lg px-3.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                viewMode === 'semester'
                  ? 'bg-surface-1 text-text-1 shadow-2xs font-semibold'
                  : 'text-text-3 hover:text-text-2'
              }`}
            >
              📋 学期总览
            </button>
          </div>
        </div>

        {/* 右侧：Apple 日历图层开关 Pills + 操作按钮 */}
        <div className="flex items-center gap-3">
          {isCurrentMode && (
            <div className="hidden sm:flex items-center gap-1.5 rounded-xl border border-bd bg-surface-1 px-2 py-1 shadow-2xs">
              <span className="text-2xs font-medium text-text-3 px-1">图层:</span>
              <button
                type="button"
                onClick={() => setLayerFilter(f => ({ ...f, course: !f.course }))}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-2xs font-medium transition-all cursor-pointer ${
                  layerFilter.course
                    ? 'bg-accent/15 text-accent font-semibold'
                    : 'opacity-40 text-text-3 hover:opacity-70'
                }`}
                title="切换教务排课显示"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                <span>排课 ({courseEvents.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setLayerFilter(f => ({ ...f, activity: !f.activity }))}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-2xs font-medium transition-all cursor-pointer ${
                  layerFilter.activity
                    ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400 font-semibold'
                    : 'opacity-40 text-text-3 hover:opacity-70'
                }`}
                title="切换学术讲座与校园活动显示"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
                <span>讲座 ({activityEvents.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setLayerFilter(f => ({ ...f, ddl: !f.ddl }))}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-2xs font-medium transition-all cursor-pointer ${
                  layerFilter.ddl
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold'
                    : 'opacity-40 text-text-3 hover:opacity-70'
                }`}
                title="切换 Canvas 作业 DDL 显示"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                <span>作业 ({ddlEvents.length})</span>
              </button>
            </div>
          )}

          {!isCurrentMode && currentJiaowuResult?.studentName && (
            <div className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-bd bg-surface-1 px-3 py-1 text-2xs text-text-2 shadow-2xs">
              <span>👤 {currentJiaowuResult.studentName}</span>
              {currentJiaowuResult.studentId && (
                <span className="font-mono text-text-3">({currentJiaowuResult.studentId})</span>
              )}
            </div>
          )}

          {isCurrentMode && (
            <button
              type="button"
              onClick={() => setShowExportModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-2 hover:border-bd-strong hover:text-text-1 hover:bg-surface-2 transition-all cursor-pointer shadow-2xs"
              title="导出为 Apple/Outlook/Google 日历 (.ics)"
            >
              <span>🗓️</span>
              <span>导出日历</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (isCurrentMode) {
                void loadSchedule(true)
              } else {
                void loadJiaowuSemester(selectedSemesterKey, true)
              }
            }}
            disabled={loading || refreshing || jiaowuLoading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-2 hover:border-bd-strong hover:text-text-1 hover:bg-surface-2 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
            title="重新同步数据"
          >
            <span className={refreshing || jiaowuLoading ? 'animate-spin' : ''}>↻</span>
            <span>{refreshing || jiaowuLoading ? '正在同步…' : '重新同步'}</span>
          </button>
        </div>
      </div>

      {/* ─── 主体区 ─── */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {loading || jiaowuLoading ? (
          <div className="flex h-72 flex-col items-center justify-center gap-3 text-text-3">
            <Spinner className="h-8 w-8 text-accent" />
            <span className="text-sm font-medium">
              {isCurrentMode
                ? '正在智能同步交我办排课、校历与全量 Canvas 作业…'
                : '正在连接交大教学信息服务网查询官方课表…'}
            </span>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-warning/30 bg-warning/10 p-6 text-sm text-text-1 shadow-2xs">
            <div className="font-semibold text-warning">课表与日程提示：</div>
            <div className="mt-1 font-mono text-xs text-text-2">{error}</div>
            <button
              type="button"
              onClick={() => {
                if (isCurrentMode) void loadSchedule(true)
                else void loadJiaowuSemester(selectedSemesterKey, true)
              }}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent/90 transition-all cursor-pointer shadow-2xs"
            >
              ↻ 重新同步
            </button>
          </div>
        ) : viewMode === 'week' ? (
          /* ══════════════════════════════════════════
             周视图：交大 6 大标准时段水平严格对齐网格
             ══════════════════════════════════════════ */
          <div className="flex flex-col gap-4">
            {/* 周次导航条 */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-bd bg-surface-2/60 p-3 shadow-2xs backdrop-blur-sm">
              <div className="flex items-center gap-2">
                {isCurrentMode ? (
                  <>
                    <button
                      type="button"
                      disabled={selectedWeekIndex <= 0}
                      onClick={() => {
                        if (selectedWeekIndex > 0) {
                          const prev = weeks[selectedWeekIndex - 1]
                          setSelectedWeekKey(`${prev.title || ''}_${prev.week}`)
                        }
                      }}
                      className="rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-2 hover:border-bd-strong hover:text-text-1 disabled:opacity-30 cursor-pointer shadow-2xs transition-all active:scale-[0.98]"
                      title="上一周"
                    >
                      ‹ 上一周
                    </button>

                    {weeks.length > 0 ? (
                      <select
                        value={selectedWeekKey}
                        onChange={e => setSelectedWeekKey(e.target.value)}
                        className="rounded-xl border border-bd bg-surface-1 pl-3 pr-8 py-1.5 text-xs font-semibold text-text-1 focus:border-accent focus:outline-none cursor-pointer shadow-2xs hover:border-bd-strong transition-all"
                      >
                        <optgroup label={`${semesterTitle || '秋季学期'} (正序)`}>
                          {regularTermWeeks.map(w => {
                            const isCur = w.week === currentWeek
                            const span = `${formatShortDate(w.startTime)} ~ ${formatShortDate(w.endTime)}`
                            return (
                              <option key={`${w.title}_${w.week}`} value={`${w.title || ''}_${w.week}`}>
                                {w.week} ({span}) {isCur ? '· 当前周' : ''}
                              </option>
                            )
                          })}
                        </optgroup>
                        {breakWeeks.length > 0 && (
                          <optgroup label="假期周次">
                            {breakWeeks.map(w => (
                              <option key={`${w.title}_${w.week}`} value={`${w.title || ''}_${w.week}`}>
                                {w.title} - {w.week} ({formatShortDate(w.startTime)} ~ {formatShortDate(w.endTime)})
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    ) : (
                      <span className="text-xs font-semibold text-text-1">本周日程</span>
                    )}

                    <button
                      type="button"
                      disabled={selectedWeekIndex < 0 || selectedWeekIndex >= weeks.length - 1}
                      onClick={() => {
                        if (selectedWeekIndex >= 0 && selectedWeekIndex < weeks.length - 1) {
                          const next = weeks[selectedWeekIndex + 1]
                          setSelectedWeekKey(`${next.title || ''}_${next.week}`)
                        }
                      }}
                      className="rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-2 hover:border-bd-strong hover:text-text-1 disabled:opacity-30 cursor-pointer shadow-2xs transition-all active:scale-[0.98]"
                      title="下一周"
                    >
                      下一周 ›
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={selectedJiaowuWeek <= 1}
                      onClick={() => setSelectedJiaowuWeek(w => Math.max(1, w - 1))}
                      className="rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-2 hover:border-bd-strong hover:text-text-1 disabled:opacity-30 cursor-pointer shadow-2xs transition-all active:scale-[0.98]"
                      title="上一周"
                    >
                      ‹ 上一周
                    </button>

                    <select
                      value={selectedJiaowuWeek}
                      onChange={e => setSelectedJiaowuWeek(parseInt(e.target.value, 10))}
                      className="rounded-xl border border-bd bg-surface-1 pl-3 pr-8 py-1.5 text-xs font-semibold text-text-1 focus:border-accent focus:outline-none cursor-pointer shadow-2xs hover:border-bd-strong transition-all"
                    >
                      {Array.from({ length: 18 }, (_, idx) => idx + 1).map(wNum => (
                        <option key={wNum} value={wNum}>
                          第 {wNum} 周
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      disabled={selectedJiaowuWeek >= 18}
                      onClick={() => setSelectedJiaowuWeek(w => Math.min(18, w + 1))}
                      className="rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-2 hover:border-bd-strong hover:text-text-1 disabled:opacity-30 cursor-pointer shadow-2xs transition-all active:scale-[0.98]"
                      title="下一周"
                    >
                      下一周 ›
                    </button>
                  </>
                )}
              </div>

              <div className="flex items-center gap-3 text-xs font-mono text-text-3">
                {isCurrentMode && selectedWeekObj && (
                  <span>
                    {selectedWeekObj.startTime.slice(0, 10)} ~ {selectedWeekObj.endTime.slice(0, 10)}
                  </span>
                )}
                {!isCurrentMode && currentJiaowuResult && (
                  <span className="rounded-lg bg-surface-1 px-2.5 py-1 text-2xs text-text-2 border border-bd">
                    {currentJiaowuResult.termTitle} · 第 {selectedJiaowuWeek} 周课表
                  </span>
                )}
              </div>
            </div>

            {/* ══════════════════════════════════════════════════════════
               水平严格对齐二维时间网格 (8 列: 时段标尺 96px + 周一至周日)
               ══════════════════════════════════════════════════════════ */}
            <div className="overflow-x-auto rounded-2xl border border-bd/70 dark:border-white/[0.06] bg-surface-1 shadow-2xs">
              <div className="min-w-[920px]">
                {/* 1. 顶部星期标头 */}
                <div className="grid grid-cols-[96px_repeat(7,minmax(0,1fr))] border-b border-bd/50 dark:border-white/[0.05] bg-surface-2/60">
                  <div className="min-w-0 flex items-center justify-center border-r border-bd/50 dark:border-white/[0.05] p-3 text-xs font-semibold text-text-3 select-none">
                    时段 \ 星期
                  </div>
                  {weekDays.map(day => (
                    <div
                      key={day.dayIndex}
                      className={`min-w-0 flex flex-col items-center justify-center border-r border-bd/50 dark:border-white/[0.05] p-2.5 last:border-r-0 ${
                        day.isToday ? 'bg-accent/10 text-accent font-semibold' : 'text-text-2'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold">{day.dayLabel}</span>
                        {day.isToday && (
                          <span className="rounded-full bg-accent px-1.5 py-0.2 text-3xs font-bold text-white">
                            今天
                          </span>
                        )}
                      </div>
                      <span className="text-2xs font-mono text-text-3 opacity-80 mt-0.5">
                        {day.shortDate}
                      </span>
                    </div>
                  ))}
                </div>

                {/* 2. 全天安排与作业 DDL 顶置行（仅当本周有全天事件/DDL 时展开） */}
                {hasAnyTopEvents && (
                  <div className="grid grid-cols-[96px_repeat(7,minmax(0,1fr))] border-b border-bd/50 dark:border-white/[0.05] bg-surface-2/30">
                    <div className="min-w-0 flex flex-col items-center justify-center border-r border-bd/50 dark:border-white/[0.05] p-2 text-2xs text-text-3 font-medium select-none">
                      <span>全天 / 截止</span>
                      <span className="text-3xs text-text-4 font-mono">DDL</span>
                    </div>
                    {weekDays.map(day => {
                      const topList = dayTopEvents.get(day.dateStr) || []
                      return (
                        <div
                          key={`top-${day.dateStr}`}
                          className={`min-w-0 border-r border-bd/50 dark:border-white/[0.05] p-1.5 last:border-r-0 space-y-1 ${
                            day.isToday ? 'bg-accent/[0.03]' : ''
                          }`}
                        >
                          {topList.map(item => {
                            const isSubmitted =
                              item.submissionStatus === 'submitted' || item.submissionStatus === 'graded'
                            const isMissing = item.submissionStatus === 'missing'
                            return (
                              <div
                                key={item.id}
                                className={`group rounded-xl border p-2 text-2xs transition-all shadow-2xs ${
                                  isSubmitted
                                    ? 'border-emerald-500/20 bg-emerald-500/5 dark:bg-[#1a2920] dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                                    : isMissing
                                    ? 'border-rose-500/20 bg-rose-500/10 dark:bg-[#2b1b1b] dark:border-rose-500/20 text-rose-700 dark:text-rose-400'
                                    : 'border-amber-500/20 bg-amber-500/10 dark:bg-[#2b241b] dark:border-amber-500/20 text-amber-700 dark:text-amber-400'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-1">
                                  <span className="font-semibold line-clamp-2 leading-tight">
                                    {item.title}
                                  </span>
                                  <span className="shrink-0 text-3xs font-bold uppercase">
                                    {isSubmitted ? '✓ 已交' : isMissing ? '已逾期' : '待交'}
                                  </span>
                                </div>
                                <div className="mt-1 flex items-center justify-between text-3xs opacity-80">
                                  <span className="truncate">{item.courseName || '作业'}</span>
                                  <span className="font-mono font-medium">
                                    {formatEventTime(item.endTime) || '截止'}
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* 3. 6 大标准时段水平严格对齐 + 跨行贯通统一网格 */}
                <div
                  className="grid grid-cols-[96px_repeat(7,minmax(0,1fr))] relative"
                  style={{
                    gridTemplateRows:
                      !hasNoonEvents && !expandNoonSlot
                        ? 'minmax(110px,auto) minmax(110px,auto) 36px minmax(110px,auto) minmax(110px,auto) minmax(110px,auto)'
                        : 'repeat(6, minmax(110px, auto))'
                  }}
                >
                  {/* A. 左侧时段标尺列 (Column 1, Rows 1..6) */}
                  {SJTU_TIME_SLOTS.map(slot => {
                    const isNoonSlot = slot.id === 3
                    if (isNoonSlot && !hasNoonEvents && !expandNoonSlot) {
                      return (
                        <div
                          key={`ruler-${slot.id}`}
                          style={{ gridColumn: 1, gridRow: 3 }}
                          onClick={() => setExpandNoonSlot(true)}
                          className="min-w-0 flex items-center justify-center border-b border-r border-bd/50 dark:border-white/[0.05] bg-surface-2/20 hover:bg-surface-2/40 cursor-pointer p-1 text-center select-none group"
                          title="点击展开中午第 5-6 节时段 (12:00 - 13:40)"
                        >
                          <span className="text-3xs text-text-4 font-mono group-hover:text-text-2">
                            第 5-6 节 ▾
                          </span>
                        </div>
                      )
                    }

                    return (
                      <div
                        key={`ruler-${slot.id}`}
                        style={{ gridColumn: 1, gridRow: slot.id }}
                        className={`min-w-0 flex flex-col items-center justify-center border-b border-r border-bd/50 dark:border-white/[0.05] bg-surface-2/40 p-2 text-center select-none ${
                          slot.id === 6 ? 'border-b-0' : ''
                        }`}
                      >
                        <div className="flex items-center gap-1 mb-1">
                          <span className="text-3xs font-medium text-text-3 px-1 py-0.5 rounded bg-surface-3">
                            {slot.periodHint}
                          </span>
                          {isNoonSlot && !hasNoonEvents && expandNoonSlot && (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation()
                                setExpandNoonSlot(false)
                              }}
                              className="text-3xs text-text-4 hover:text-text-2 cursor-pointer"
                              title="折叠中午时段"
                            >
                              ▴
                            </button>
                          )}
                        </div>
                        <span className="text-xs font-semibold text-text-1 tracking-tight">
                          {slot.slotLabel}
                        </span>
                        <span className="text-3xs font-mono text-text-3 mt-0.5">{slot.timeRange}</span>
                      </div>
                    )
                  })}

                  {/* B. 背景网格单元格 (Columns 2..8, Rows 1..6) */}
                  {weekDays.map(day =>
                    SJTU_TIME_SLOTS.map(slot => {
                      const isNoonSlot = slot.id === 3
                      if (isNoonSlot && !hasNoonEvents && !expandNoonSlot) {
                        return (
                          <div
                            key={`bg-${day.dayIndex}-3`}
                            style={{ gridColumn: day.dayIndex + 2, gridRow: 3 }}
                            onClick={() => setExpandNoonSlot(true)}
                            className={`min-w-0 border-b border-r border-bd/50 dark:border-white/[0.05] bg-surface-2/20 hover:bg-surface-2/40 cursor-pointer flex items-center justify-center ${
                              day.dayIndex === 6 ? 'border-r-0' : ''
                            }`}
                            title="点击展开中午第 5-6 节"
                          >
                            {day.dayIndex === 0 && (
                              <span className="text-3xs text-text-4 font-sans select-none opacity-80">
                                ☀️ 中午时段 (12:00 - 13:40) · 本周无排课 · 点击展开
                              </span>
                            )}
                          </div>
                        )
                      }

                      const isOccupied = occupiedSlots.has(`${day.dayIndex}-${slot.id}`)
                      return (
                        <div
                          key={`bg-${day.dayIndex}-${slot.id}`}
                          style={{ gridColumn: day.dayIndex + 2, gridRow: slot.id }}
                          className={`min-w-0 border-b border-r border-bd/50 dark:border-white/[0.05] p-1.5 transition-colors ${
                            day.dayIndex === 6 ? 'border-r-0' : ''
                          } ${slot.id === 6 ? 'border-b-0' : ''} ${
                            day.isToday ? 'bg-accent/[0.02]' : ''
                          } ${isOccupied ? '' : 'hover:bg-surface-2/20'}`}
                        />
                      )
                    })
                  )}

                  {/* C. 跨行与标准事件卡片簇 (Columns 2..8, Row Span 1..3) */}
                  {weekDays.map(day => {
                    const clusters = dayClusters.get(day.dayIndex) || []
                    return clusters.map(cluster => (
                      <div
                        key={`cluster-${day.dayIndex}-${cluster.startSlot}-${cluster.endSlot}`}
                        style={{
                          gridColumn: day.dayIndex + 2,
                          gridRow: `${cluster.startSlot} / ${cluster.endSlot + 1}`,
                          zIndex: 10
                        }}
                        className="min-w-0 p-1.5 flex flex-row gap-1.5 pointer-events-auto h-full"
                      >
                        {cluster.events.map(item => {
                          // 1. 讲座/活动卡片
                          if (item.type === 'activity') {
                            return (
                              <div
                                key={item.id}
                                onClick={() => handleOpenCourseModal(item.title)}
                                onMouseEnter={e => handleCardMouseEnter(item, e)}
                                onMouseLeave={handleCardMouseLeave}
                                className="group relative h-full flex flex-col justify-between rounded-xl border border-purple-500/20 dark:border-purple-500/25 bg-purple-500/5 dark:bg-[#231e2b] p-2 text-2xs hover:border-purple-500/40 hover:shadow-2xs transition-all overflow-hidden flex-1 min-w-0 cursor-pointer"
                                title="点击查看详情"
                              >
                                <div className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-purple-500" />
                                <div className="pl-1.5 flex flex-col h-full justify-between">
                                  <div>
                                    <div className="flex items-start justify-between gap-1 text-purple-700 dark:text-purple-400 font-semibold">
                                      <span className="leading-tight break-words">{item.title}</span>
                                      <span className="shrink-0 rounded bg-purple-500/15 px-1 py-0.2 text-3xs font-bold">
                                        讲座
                                      </span>
                                    </div>
                                    <div className="mt-1 space-y-0.5 text-3xs text-text-3 font-mono">
                                      <div>
                                        🕒 {formatEventTime(item.startTime)} ~ {formatEventTime(item.endTime)}
                                      </div>
                                      {item.location && (
                                        <div className="text-text-2 truncate font-sans">
                                          📍 {item.location}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )
                          }

                          // 2. 超长实验课 / 多时段连堂大课 (span >= 3 或 isLabOrLongSession, 如周一下午 5-10 节有机化学实验、周四 6-9 节创新实验)
                          // Apple 翡翠绿/湖青色风格，纵向完全舒展，文字彻底不截断！
                          if (item.isLabOrLongSession || cluster.span >= 3) {
                            return (
                              <div
                                key={item.id}
                                onClick={() => handleOpenCourseModal(item.title)}
                                onMouseEnter={e => handleCardMouseEnter(item, e)}
                                onMouseLeave={handleCardMouseLeave}
                                className="group relative h-full flex flex-col justify-between rounded-xl border border-teal-500/30 dark:border-teal-500/35 bg-surface-1 dark:bg-[#182622] p-2.5 text-2xs hover:border-teal-500/60 hover:shadow-2xs transition-all overflow-hidden flex-1 min-w-0 cursor-pointer"
                                title="点击查看课程全学期课表明细与教学信息"
                              >
                                <div className="absolute left-0 top-1.5 bottom-1.5 w-1.5 rounded-r bg-teal-500 shadow-sm" />
                                <div className="pl-2 flex flex-col h-full justify-between gap-2">
                                  <div>
                                    {/* 顶部课程名 (全宽无遮挡展示) */}
                                    <div>
                                      <div className="font-bold text-text-1 text-xs md:text-sm leading-snug break-words">
                                        {item.title}
                                      </div>
                                    </div>

                                    {/* 详细时间、教室与教师 */}
                                    <div className="mt-2 space-y-1 text-3xs">
                                      <div className="text-teal-600 dark:text-teal-400 font-mono font-semibold text-2xs flex items-center gap-1.5 flex-wrap">
                                        <span>🕒 {getEventDisplayTime(item)}</span>
                                        {item.badge && (
                                          <span className="rounded bg-teal-500/15 dark:bg-teal-500/25 px-1 py-0.2 text-3xs font-semibold text-teal-700 dark:text-teal-300">
                                            {item.badge}
                                          </span>
                                        )}
                                      </div>
                                      {item.location && item.location !== '不排教室' && (
                                        <div className="text-text-1 font-medium font-sans flex items-start gap-1">
                                          <span>📍</span>
                                          <span className="leading-tight break-words">{item.location}</span>
                                        </div>
                                      )}
                                      {item.teacher && (
                                        <div className="text-text-2 font-sans flex items-center gap-1">
                                          <span>👨‍🏫</span>
                                          <span className="truncate">{item.teacher}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* 底部补充：班级与学分 */}
                                  {(item.jxbmc || item.description || item.xf) && (
                                    <div className="pt-2 border-t border-teal-500/15 dark:border-teal-500/20 text-3xs text-text-3 space-y-0.5 font-sans">
                                      {item.jxbmc && (
                                        <div className="truncate text-text-3">
                                          🎓 班级: {item.jxbmc}
                                        </div>
                                      )}
                                      {item.xf && (
                                        <div className="font-mono text-teal-700 dark:text-teal-300">
                                          ⭐ 学分: {item.xf} 学分
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          }

                          // 3. 2 个时段跨行大课 (span === 2, 如 6-8 节思政大课 12:55~15:40)
                          // Apple 活力蓝风格，~220px 舒展，标题独占整行无遮挡！
                          if (cluster.span === 2 || item.startTime.includes('6-8')) {
                            return (
                              <div
                                key={item.id}
                                onClick={() => handleOpenCourseModal(item.title)}
                                onMouseEnter={e => handleCardMouseEnter(item, e)}
                                onMouseLeave={handleCardMouseLeave}
                                className="group relative h-full flex flex-col justify-between rounded-xl border border-sky-500/30 dark:border-sky-500/35 bg-surface-1 dark:bg-[#1a232b] p-2.5 text-2xs hover:border-sky-500/60 hover:shadow-2xs transition-all overflow-hidden flex-1 min-w-0 cursor-pointer"
                                title="点击查看课程全学期课表明细与教学信息"
                              >
                                <div className="absolute left-0 top-1.5 bottom-1.5 w-1.5 rounded-r bg-sky-500 shadow-sm" />
                                <div className="pl-2 flex flex-col h-full justify-between gap-1.5">
                                  <div>
                                    {/* 顶部课程名 (全宽无遮挡展示，彻底解决「思想道德与法治」等长标题截断问题) */}
                                    <div>
                                      <div className="font-bold text-text-1 text-xs md:text-sm leading-snug break-words">
                                        {item.title}
                                      </div>
                                    </div>

                                    <div className="mt-1.5 space-y-1 text-3xs">
                                      <div className="text-sky-600 dark:text-sky-400 font-mono font-semibold text-2xs">
                                        🕒 {getEventDisplayTime(item)}
                                      </div>
                                      {item.location && item.location !== '不排教室' && (
                                        <div className="text-text-1 font-medium font-sans">
                                          📍 {item.location}
                                        </div>
                                      )}
                                      {item.teacher && (
                                        <div className="text-text-2 font-sans truncate">
                                          👨‍🏫 {item.teacher}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {(item.jxbmc || item.description || item.xf) && (
                                    <div className="pt-1.5 border-t border-sky-500/15 dark:border-sky-500/20 text-3xs text-text-3 font-sans truncate">
                                      {item.jxbmc ? `🎓 ${item.jxbmc}` : item.description}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          }

                          // 4. 标准 1 时段课程 (span === 1, 如 1-2节, 3-4节, 7-8节, 9-10节, 11-12节等)
                          return (
                            <div
                              key={item.id}
                              onClick={() => handleOpenCourseModal(item.title)}
                              onMouseEnter={e => handleCardMouseEnter(item, e)}
                              onMouseLeave={handleCardMouseLeave}
                              className="group relative h-full flex flex-col justify-between rounded-xl border border-bd/70 dark:border-white/[0.06] bg-surface-1 dark:bg-[#232326] p-2 text-2xs hover:border-accent dark:hover:border-accent/60 hover:shadow-2xs transition-all overflow-hidden flex-1 min-w-0 cursor-pointer"
                              title="点击查看课程全学期课表明细与教学信息"
                            >
                              <div className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-accent" />
                              <div className="pl-1.5 flex flex-col h-full justify-between">
                                <div>
                                  <div>
                                    <div className="font-semibold text-text-1 leading-snug break-words">
                                      {item.title}
                                    </div>
                                  </div>
                                  <div className="mt-1 space-y-0.5 text-3xs text-text-3 font-mono">
                                    <div className="text-accent font-medium">
                                      🕒 {getEventDisplayTime(item)}
                                    </div>
                                    {item.location && item.location !== '不排教室' && (
                                      <div className="text-text-2 truncate font-sans">
                                        📍 {item.location}
                                      </div>
                                    )}
                                    {item.teacher && (
                                      <div className="text-text-3 truncate font-sans">
                                        👨‍🏫 {item.teacher}
                                      </div>
                                    )}
                                    {item.description && !isCurrentMode && (
                                      <div className="text-text-4 truncate font-sans opacity-70">
                                        {item.description}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ))
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ══════════════════════════════════════════
             学期总览：课程卡片、讲座活动与作业全景
             ══════════════════════════════════════════ */
          <div className="flex flex-col gap-6">
            {/* 顶部分类指标看板 (Apple 极简数字卡片) */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div className="rounded-2xl border border-bd bg-surface-2/60 p-4 shadow-2xs backdrop-blur-sm">
                <div className="flex items-center justify-between text-xs text-text-3 font-medium">
                  <span>{isCurrentMode ? '已选主修课程' : '官方排课门数'}</span>
                  <span className="text-base">📚</span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold tracking-tight text-text-1">
                    {isCurrentMode
                      ? uniqueCourseNames.length
                      : jiaowuOverview?.uniqueCourses.length || 0}
                  </span>
                  <span className="text-xs text-text-3">门课程</span>
                </div>
              </div>

              <div className="rounded-2xl border border-bd bg-surface-2/60 p-4 shadow-2xs backdrop-blur-sm">
                <div className="flex items-center justify-between text-xs text-text-3 font-medium">
                  <span>{isCurrentMode ? '学期排课总节数' : '学期总学分'}</span>
                  <span className="text-base">⏰</span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold tracking-tight text-text-1">
                    {isCurrentMode
                      ? courseEvents.length
                      : jiaowuOverview?.totalCredits || 0}
                  </span>
                  <span className="text-xs text-text-3">
                    {isCurrentMode ? '节课时' : '学分'}
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-bd bg-surface-2/60 p-4 shadow-2xs backdrop-blur-sm">
                <div className="flex items-center justify-between text-xs text-text-3 font-medium">
                  <span>{isCurrentMode ? '学术讲座与校园活动' : '任课教师阵容'}</span>
                  <span className="text-base">🎙️</span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold tracking-tight text-purple-600 dark:text-purple-400">
                    {isCurrentMode
                      ? activityEvents.length
                      : jiaowuOverview?.uniqueTeachers.length || 0}
                  </span>
                  <span className="text-xs text-text-3">
                    {isCurrentMode ? '场通知/讲座' : '位教师'}
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-bd bg-surface-2/60 p-4 shadow-2xs backdrop-blur-sm">
                <div className="flex items-center justify-between text-xs text-text-3 font-medium">
                  <span>{isCurrentMode ? 'Canvas 作业全景' : '学生学籍信息'}</span>
                  <span className="text-base">📝</span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
                    {isCurrentMode
                      ? ddlEvents.length
                      : currentJiaowuResult?.studentName || '已同步'}
                  </span>
                  <span className="text-xs text-text-3">
                    {isCurrentMode
                      ? `项 (${ddlSubmittedCount} 项已交)`
                      : currentJiaowuResult?.studentId || '教务认证'}
                  </span>
                </div>
              </div>
            </div>

            {/* 总览子导航条与搜索 */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bd pb-4">
              <div className="flex items-center gap-1.5 rounded-xl bg-surface-3 p-1 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setOverviewTab('courses')}
                  className={`rounded-lg px-3.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                    overviewTab === 'courses'
                      ? 'bg-surface-1 text-text-1 shadow-2xs font-semibold'
                      : 'text-text-3 hover:text-text-2'
                  }`}
                >
                  📚 课程列表 (
                  {isCurrentMode
                    ? courseCards.length
                    : jiaowuOverview?.uniqueCourses.length || 0}
                  )
                </button>
                {isCurrentMode && (
                  <>
                    <button
                      type="button"
                      onClick={() => setOverviewTab('activities')}
                      className={`rounded-lg px-3.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                        overviewTab === 'activities'
                          ? 'bg-surface-1 text-text-1 shadow-2xs font-semibold'
                          : 'text-text-3 hover:text-text-2'
                      }`}
                    >
                      🎙️ 校园讲座/活动 ({activityEvents.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setOverviewTab('assignments')}
                      className={`rounded-lg px-3.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                        overviewTab === 'assignments'
                          ? 'bg-surface-1 text-text-1 shadow-2xs font-semibold'
                          : 'text-text-3 hover:text-text-2'
                      }`}
                    >
                      📝 作业 DDL 时间轴 ({ddlEvents.length})
                    </button>
                  </>
                )}
              </div>

              {/* 搜索框与视图切换 */}
              <div className="flex items-center gap-3">
                {overviewTab === 'courses' && (
                  <div className="flex items-center gap-1 rounded-xl bg-surface-3 p-1 shadow-2xs">
                    <button
                      type="button"
                      onClick={() => setOverviewCourseView('grid')}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                        overviewCourseView === 'grid'
                          ? 'bg-surface-1 text-accent font-semibold shadow-2xs'
                          : 'text-text-3 hover:text-text-2'
                      }`}
                      title="全学期作息网格视图"
                    >
                      <span>🗓️</span>
                      <span>作息网格</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setOverviewCourseView('cards')}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                        overviewCourseView === 'cards'
                          ? 'bg-surface-1 text-accent font-semibold shadow-2xs'
                          : 'text-text-3 hover:text-text-2'
                      }`}
                      title="课程清单卡片视图"
                    >
                      <span>📋</span>
                      <span>课程清单</span>
                    </button>
                  </div>
                )}

                <div className="relative">
                  <input
                    type="text"
                    placeholder="搜索课程、教师、教室或作业…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-56 md:w-64 rounded-xl border border-bd bg-surface-1 py-1.5 pl-8 pr-3 text-xs text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none shadow-2xs"
                  />
                  <span className="absolute left-2.5 top-2 text-text-3 text-xs">🔍</span>
                </div>
              </div>
            </div>

            {/* ─── 模块 1: 按课程维度展示 (作息网格 vs 清单卡片) ─── */}
            {overviewTab === 'courses' && (
              overviewCourseView === 'grid' ? (
                /* ══════════════════════════════════════════
                   全学期全景作息网格 (8 列: 时段标尺 96px + 周一至周日)
                   与周视图完全一致，直观聚合全学期排课与周次范围！
                   ══════════════════════════════════════════ */
                <div className="overflow-x-auto rounded-2xl border border-bd/70 dark:border-white/[0.06] bg-surface-1 shadow-2xs">
                  <div className="min-w-[920px]">
                    {/* 1. 顶部星期标头 (周一至周日) */}
                    <div className="grid grid-cols-[96px_repeat(7,minmax(0,1fr))] border-b border-bd/50 dark:border-white/[0.05] bg-surface-2/60">
                      <div className="min-w-0 flex items-center justify-center border-r border-bd/50 dark:border-white/[0.05] p-3 text-xs font-semibold text-text-3 select-none">
                        时段 \ 星期
                      </div>
                      {[
                        { label: '星期一', en: 'Mon' },
                        { label: '星期二', en: 'Tue' },
                        { label: '星期三', en: 'Wed' },
                        { label: '星期四', en: 'Thu' },
                        { label: '星期五', en: 'Fri' },
                        { label: '星期六', en: 'Sat' },
                        { label: '星期日', en: 'Sun' }
                      ].map(day => (
                        <div
                          key={day.label}
                          className="min-w-0 flex flex-col items-center justify-center border-r border-bd/50 dark:border-white/[0.05] p-2.5 last:border-r-0 text-text-2"
                        >
                          <span className="text-xs font-semibold">{day.label}</span>
                          <span className="text-3xs font-mono text-text-3 opacity-70 mt-0.5">
                            {day.en}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* 2. 6 大标准时段行统一网格 */}
                    <div
                      className="grid grid-cols-[96px_repeat(7,minmax(0,1fr))] relative"
                      style={{
                        gridTemplateRows:
                          !hasSemesterNoonEvents && !expandSemesterNoonSlot
                            ? 'minmax(110px,auto) minmax(110px,auto) 36px minmax(110px,auto) minmax(110px,auto) minmax(110px,auto)'
                            : 'repeat(6, minmax(110px, auto))'
                      }}
                    >
                      {/* A. 左侧时段标尺列 (Column 1, Rows 1..6) */}
                      {SJTU_TIME_SLOTS.map(slot => {
                        const isNoonSlot = slot.id === 3
                        if (isNoonSlot && !hasSemesterNoonEvents && !expandSemesterNoonSlot) {
                          return (
                            <div
                              key={`sem-ruler-${slot.id}`}
                              style={{ gridColumn: 1, gridRow: 3 }}
                              onClick={() => setExpandSemesterNoonSlot(true)}
                              className="min-w-0 flex items-center justify-center border-b border-r border-bd/50 dark:border-white/[0.05] bg-surface-2/20 hover:bg-surface-2/40 cursor-pointer p-1 text-center select-none group"
                              title="点击展开中午第 5-6 节时段 (12:00 - 13:40)"
                            >
                              <span className="text-3xs text-text-4 font-mono group-hover:text-text-2">
                                第 5-6 节 ▾
                              </span>
                            </div>
                          )
                        }

                        return (
                          <div
                            key={`sem-ruler-${slot.id}`}
                            style={{ gridColumn: 1, gridRow: slot.id }}
                            className={`min-w-0 flex flex-col items-center justify-center border-b border-r border-bd/50 dark:border-white/[0.05] bg-surface-2/40 p-2 text-center select-none ${
                              slot.id === 6 ? 'border-b-0' : ''
                            }`}
                          >
                            <div className="flex items-center gap-1 mb-1">
                              <span className="text-3xs font-medium text-text-3 px-1 py-0.5 rounded bg-surface-3">
                                {slot.periodHint}
                              </span>
                              {isNoonSlot && !hasSemesterNoonEvents && expandSemesterNoonSlot && (
                                <button
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation()
                                    setExpandSemesterNoonSlot(false)
                                  }}
                                  className="text-3xs text-text-4 hover:text-text-2 cursor-pointer"
                                  title="折叠中午时段"
                                >
                                  ▴
                                </button>
                              )}
                            </div>
                            <span className="text-xs font-semibold text-text-1 tracking-tight">
                              {slot.slotLabel}
                            </span>
                            <span className="text-3xs font-mono text-text-3 mt-0.5">{slot.timeRange}</span>
                          </div>
                        )
                      })}

                      {/* B. 背景网格单元格 (Columns 2..8, Rows 1..6) */}
                      {[0, 1, 2, 3, 4, 5, 6].map(dayIdx =>
                        SJTU_TIME_SLOTS.map(slot => {
                          const isNoonSlot = slot.id === 3
                          if (isNoonSlot && !hasSemesterNoonEvents && !expandSemesterNoonSlot) {
                            return (
                              <div
                                key={`sem-bg-${dayIdx}-3`}
                                style={{ gridColumn: dayIdx + 2, gridRow: 3 }}
                                onClick={() => setExpandSemesterNoonSlot(true)}
                                className={`min-w-0 border-b border-r border-bd/50 dark:border-white/[0.05] bg-surface-2/20 hover:bg-surface-2/40 cursor-pointer flex items-center justify-center ${
                                  dayIdx === 6 ? 'border-r-0' : ''
                                }`}
                                title="点击展开中午第 5-6 节"
                              >
                                {dayIdx === 0 && (
                                  <span className="text-3xs text-text-4 font-sans select-none opacity-80">
                                    ☀️ 中午时段 (12:00 - 13:40) · 本学期无排课 · 点击展开
                                  </span>
                                )}
                              </div>
                            )
                          }

                          const isOccupied = semesterOccupiedSlots.has(`${dayIdx}-${slot.id}`)
                          return (
                            <div
                              key={`sem-bg-${dayIdx}-${slot.id}`}
                              style={{ gridColumn: dayIdx + 2, gridRow: slot.id }}
                              className={`min-w-0 border-b border-r border-bd/50 dark:border-white/[0.05] p-1.5 transition-colors ${
                                dayIdx === 6 ? 'border-r-0' : ''
                              } ${slot.id === 6 ? 'border-b-0' : ''} ${
                                isOccupied ? '' : 'hover:bg-surface-2/20'
                              }`}
                            />
                          )
                        })
                      )}

                      {/* C. 跨行课程卡片簇 (Columns 2..8, Row Span 1..3) */}
                      {[0, 1, 2, 3, 4, 5, 6].map(dayIdx => {
                        const clusters = semesterDayClusters.get(dayIdx) || []
                        return clusters.map(cluster => (
                          <div
                            key={`sem-cluster-${dayIdx}-${cluster.startSlot}-${cluster.endSlot}`}
                            style={{
                              gridColumn: dayIdx + 2,
                              gridRow: `${cluster.startSlot} / ${cluster.endSlot + 1}`,
                              zIndex: 10
                            }}
                            className="min-w-0 p-1.5 flex flex-col gap-1.5 pointer-events-auto h-full"
                          >
                            {cluster.events.map(item => {
                              const isSearchMatched =
                                !searchQuery.trim() ||
                                item.title.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
                                (item.teacher &&
                                  item.teacher.toLowerCase().includes(searchQuery.toLowerCase().trim())) ||
                                (item.location &&
                                  item.location.toLowerCase().includes(searchQuery.toLowerCase().trim()))

                              const isLab = item.isLabOrLongSession || cluster.span >= 3
                              const isIdeological = cluster.span === 2 || item.startTime.includes('6-8')

                              return (
                                <div
                                  key={item.id}
                                  onClick={() => handleOpenCourseModal(item.title)}
                                  onMouseEnter={e => handleCardMouseEnter(item, e)}
                                  onMouseLeave={handleCardMouseLeave}
                                  className={`group relative h-full flex flex-col justify-between rounded-xl border p-2.5 text-2xs cursor-pointer transition-all overflow-hidden flex-1 min-w-0 ${
                                    !isSearchMatched ? 'opacity-30' : ''
                                  } ${
                                    isLab
                                      ? 'border-teal-500/30 dark:border-teal-500/35 bg-surface-1 dark:bg-[#182622] hover:border-teal-500/60 hover:shadow-xs'
                                      : isIdeological
                                      ? 'border-sky-500/30 dark:border-sky-500/35 bg-surface-1 dark:bg-[#1a232b] hover:border-sky-500/60 hover:shadow-xs'
                                      : 'border-bd/70 dark:border-white/[0.06] bg-surface-1 dark:bg-[#232326] hover:border-accent dark:hover:border-accent/60 hover:shadow-2xs'
                                  }`}
                                  title="点击查看课程全学期课表明细与教学信息"
                                >
                                  <div
                                    className={`absolute left-0 top-1.5 bottom-1.5 rounded-r shadow-sm ${
                                      isLab
                                        ? 'w-1.5 bg-teal-500'
                                        : isIdeological
                                        ? 'w-1.5 bg-sky-500'
                                        : 'w-1 bg-accent'
                                    }`}
                                  />
                                  <div className="pl-1.5 flex flex-col h-full justify-between gap-1.5">
                                    <div>
                                      {/* 顶部课程名 (全宽无遮挡展示) */}
                                      <div>
                                        <div className="font-bold text-text-1 text-xs md:text-sm leading-snug break-words">
                                          {item.title}
                                        </div>
                                      </div>

                                      {/* 周次范围胶囊徽标 (放置在课名下方，绝不抢占课名横向空间) */}
                                      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                        <span className="shrink-0 rounded-md bg-accent/10 dark:bg-accent/20 px-1.5 py-0.5 text-3xs font-bold text-accent border border-accent/20">
                                          🗓️ {item.endTime || '全学期'}
                                        </span>
                                        {item.xf && (
                                          <span className="shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 text-3xs text-text-3 font-medium">
                                            ⭐ {item.xf} 学分
                                          </span>
                                        )}
                                      </div>

                                      {/* 时间、地点与教师 */}
                                      <div className="mt-1.5 space-y-0.5 text-3xs text-text-3 font-mono">
                                        <div
                                          className={`font-semibold ${
                                            isLab
                                              ? 'text-teal-600 dark:text-teal-400'
                                              : isIdeological
                                              ? 'text-sky-600 dark:text-sky-400'
                                              : 'text-accent'
                                          }`}
                                        >
                                          🕒 {item.startTime}
                                        </div>
                                        {item.location && item.location !== '不排教室' && (
                                          <div className="text-text-1 font-sans font-medium truncate">
                                            📍 {item.location}
                                          </div>
                                        )}
                                        {item.teacher && (
                                          <div className="text-text-3 font-sans truncate">
                                            👨‍🏫 {item.teacher}
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    {/* 底部学分与详情链接 */}
                                    <div className="flex items-center justify-between pt-1 border-t border-bd/20 text-3xs text-text-4">
                                      <span>
                                        {item.xf ? `⭐ ${item.xf} 学分` : item.badge || '选修排课'}
                                      </span>
                                      <span className="text-accent group-hover:underline font-medium">
                                        详情 ›
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        ))
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                /* 课程清单卡片模式 (保留原先的三列卡片) */
                isCurrentMode ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {filteredCourseCards.map(c => {
                      const isExpanded = expandedCourseNames.has(c.courseName)
                      return (
                        <div
                          key={c.courseName}
                          className="flex flex-col justify-between rounded-2xl border border-bd bg-surface-1 p-5 shadow-2xs hover:border-bd-strong hover:shadow-xs transition-all"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <h4
                                onClick={() => handleOpenCourseModal(c.courseName)}
                                className="font-bold text-sm text-text-1 line-clamp-1 hover:text-accent cursor-pointer transition-colors"
                                title="点击查看课程全学期课表与教学信息"
                              >
                                {c.courseName}
                              </h4>
                              <button
                                type="button"
                                onClick={() => handleOpenCourseModal(c.courseName)}
                                className="shrink-0 rounded-full bg-accent/10 hover:bg-accent/20 px-2.5 py-0.5 text-2xs font-semibold text-accent cursor-pointer transition-colors"
                                title="点击查看全学期排课明细与 Canvas 作业"
                              >
                                {c.events.length} 讲 · 详情 ›
                              </button>
                            </div>

                            {c.titleEn && (
                              <div className="mt-1 font-mono text-3xs text-text-3 line-clamp-1">
                                {c.titleEn}
                              </div>
                            )}

                            <div className="mt-4 space-y-1.5 text-xs text-text-2">
                              {c.teacher && (
                                <div className="flex items-center gap-2 text-2xs">
                                  <span className="opacity-70">👨‍🏫 授课教师:</span>
                                  <span className="font-medium text-text-1">{c.teacher}</span>
                                </div>
                              )}
                              {c.locationsList.length > 0 && (
                                <div className="flex items-center gap-2 text-2xs">
                                  <span className="opacity-70">📍 上课教室:</span>
                                  <span className="font-mono text-accent">
                                    {c.locationsList.join(' / ')}
                                  </span>
                                </div>
                              )}
                              {c.assignments.length > 0 && (
                                <div className="flex items-center gap-2 text-2xs">
                                  <span className="opacity-70">📝 关联作业:</span>
                                  <span className="font-medium text-amber-600 dark:text-amber-400">
                                    {c.assignments.length} 项 Canvas 任务
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="mt-4 border-t border-bd/40 pt-3">
                            <button
                              type="button"
                              onClick={() => toggleCourseExpand(c.courseName)}
                              className="flex w-full items-center justify-between text-2xs font-medium text-accent hover:underline cursor-pointer"
                            >
                              <span>
                                {isExpanded ? '收起排课明细' : `展开全学期 ${c.events.length} 讲课时表`}
                              </span>
                              <span className="text-3xs">{isExpanded ? '▲' : '▼'}</span>
                            </button>

                            {isExpanded && (
                              <div className="mt-3 max-h-56 overflow-y-auto space-y-1 rounded-xl bg-surface-2 p-2.5">
                                {c.events.map((ev, idx) => (
                                  <div
                                    key={ev.id}
                                    className="flex items-center justify-between py-1 px-1.5 text-2xs border-b border-bd/20 last:border-0"
                                  >
                                    <span className="font-medium text-text-2">第 {idx + 1} 讲</span>
                                    <span className="font-mono text-text-3">
                                      {ev.startTime} ~ {ev.endTime ? ev.endTime.slice(-5) : ''}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  /* 教务系统官方排课表格/卡片展示 */
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {filteredJiaowuCourses.map(c => (
                      <div
                        key={c.name}
                        className="flex flex-col justify-between rounded-2xl border border-bd bg-surface-1 p-5 shadow-2xs hover:border-bd-strong hover:shadow-xs transition-all"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <h4
                              onClick={() => handleOpenCourseModal(c.name)}
                              className="font-bold text-sm text-text-1 line-clamp-1 hover:text-accent cursor-pointer transition-colors"
                              title="点击查看课程全学期课表与教学信息"
                            >
                              {c.name}
                            </h4>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {c.xf && (
                                <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-2xs font-semibold text-accent">
                                  {c.xf} 学分
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleOpenCourseModal(c.name)}
                                className="rounded-full bg-surface-3 hover:bg-surface-4 px-2 py-0.5 text-2xs font-medium text-text-2 cursor-pointer transition-colors"
                                title="点击查看课程全览详情"
                              >
                                详情 ›
                              </button>
                            </div>
                          </div>

                          {c.kch && (
                            <div className="mt-1 font-mono text-3xs text-text-3">
                              代码: {c.kch} {c.kcbj ? `· ${c.kcbj}` : ''}
                            </div>
                          )}

                          <div className="mt-4 space-y-1.5 text-xs text-text-2">
                            {c.teachers && (
                              <div className="flex items-center gap-2 text-2xs">
                                <span className="opacity-70">👨‍🏫 任课教师:</span>
                                <span className="font-medium text-text-1">{c.teachers}</span>
                              </div>
                            )}
                            {c.locations && (
                              <div className="flex items-center gap-2 text-2xs">
                                <span className="opacity-70">📍 教学地点:</span>
                                <span className="font-mono text-accent">{c.locations}</span>
                              </div>
                            )}
                            {c.kclbmc && (
                              <div className="flex items-center gap-2 text-2xs">
                                <span className="opacity-70">🏷️ 课程类别:</span>
                                <span className="text-text-3">{c.kclbmc}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 border-t border-bd/40 pt-3 text-2xs text-text-3 space-y-1">
                          <div className="font-mono text-accent">🗓️ {c.periodAndWeeks}</div>
                          {c.jxbmc && <div className="truncate opacity-75">班级: {c.jxbmc}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )
            )}

            {/* ─── 模块 2: 校园讲座与学术活动 (仅当前学期) ─── */}
            {overviewTab === 'activities' && isCurrentMode && (
              <div className="space-y-3">
                {filteredActivities.length === 0 ? (
                  <div className="py-16 text-center text-xs text-text-3">暂无校园讲座或活动安排</div>
                ) : (
                  filteredActivities.map(act => (
                    <div
                      key={act.id}
                      className="rounded-2xl border border-purple-500/20 bg-surface-1 p-4 shadow-2xs hover:border-purple-500/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-purple-500/15 px-2 py-0.5 text-3xs font-bold text-purple-600 dark:text-purple-400">
                            {act.calendarName || '讲座/活动'}
                          </span>
                          <h4 className="font-bold text-sm text-text-1">{act.title}</h4>
                        </div>
                        {act.description && (
                          <p className="text-2xs text-text-3 line-clamp-2 max-w-2xl">
                            {act.description}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right space-y-1 font-mono text-2xs text-text-2">
                        <div>
                          🕒 {act.startTime} ~ {act.endTime.slice(-5)}
                        </div>
                        {act.location && (
                          <div className="text-purple-600 dark:text-purple-400">
                            📍 {act.location}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ─── 模块 3: Canvas 作业 DDL 时间轴 (仅当前学期) ─── */}
            {overviewTab === 'assignments' && isCurrentMode && (
              <div className="space-y-3">
                {filteredAssignments.length === 0 ? (
                  <div className="py-16 text-center text-xs text-text-3">暂无 Canvas 作业安排</div>
                ) : (
                  filteredAssignments.map(ddl => {
                    const isSubmitted =
                      ddl.submissionStatus === 'submitted' || ddl.submissionStatus === 'graded'
                    const isMissing = ddl.submissionStatus === 'missing'
                    return (
                      <div
                        key={ddl.id}
                        className="rounded-2xl border border-bd bg-surface-1 p-4 shadow-2xs hover:border-bd-strong transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-3xs font-bold ${
                                isSubmitted
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                  : isMissing
                                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                                  : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              {isSubmitted ? '✓ 已提交' : isMissing ? '已逾期' : '待提交'}
                            </span>
                            <h4 className="font-semibold text-sm text-text-1">{ddl.title}</h4>
                          </div>
                          <div className="text-2xs text-text-3 flex items-center gap-3">
                            <span>📚 课程: {ddl.courseName || '未归类'}</span>
                            {ddl.pointsPossible != null && (
                              <span>满分: {ddl.pointsPossible} 分</span>
                            )}
                            {ddl.score != null && (
                              <span className="font-semibold text-emerald-600">
                                得分: {ddl.score}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="shrink-0 flex items-center gap-4">
                          <div className="text-right font-mono text-2xs">
                            <div className="text-text-3">截止时间 (DDL)</div>
                            <div className="font-semibold text-text-1">
                              {ddl.startTime || '无截止时间'}
                            </div>
                          </div>
                          {ddl.htmlUrl && (
                            <button
                              type="button"
                              onClick={() => {
                                if (ddl.htmlUrl) void window.api.openExternal(ddl.htmlUrl)
                              }}
                              className="rounded-lg border border-bd px-3 py-1.5 text-2xs font-medium text-accent hover:border-accent cursor-pointer transition-all shadow-2xs"
                            >
                              打开作业 ↗
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── 导出日历配置弹窗 (Apple 风格模态框) ─── */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl border border-bd bg-surface-1 p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-bd/60 pb-3">
              <h3 className="text-base font-bold text-text-1">🗓️ 导出为标准日历 (.ics)</h3>
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="rounded-lg p-1 text-text-3 hover:text-text-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-text-3 leading-relaxed">
              导出的 RFC 5545 iCalendar 文件原生支持 Apple Calendar、Outlook、Google 日历及 Android 手机日历同步。
            </p>

            <div className="space-y-3 rounded-2xl bg-surface-2/60 p-4 border border-bd/60 text-xs">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeCourses}
                  onChange={e => setIncludeCourses(e.target.checked)}
                  className="rounded accent-accent"
                />
                <span className="font-medium text-text-1">
                  包含教务排课 ({courseEvents.length} 节)
                </span>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeActivities}
                  onChange={e => setIncludeActivities(e.target.checked)}
                  className="rounded accent-accent"
                />
                <span className="font-medium text-text-1">
                  包含学术讲座与校园活动 ({activityEvents.length} 场)
                </span>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeDdl}
                  onChange={e => setIncludeDdl(e.target.checked)}
                  className="rounded accent-accent"
                />
                <span className="font-medium text-text-1">
                  包含 Canvas 作业截止时间 ({ddlEvents.length} 项)
                </span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="text-2xs text-text-3 block mb-1">上课提前提醒:</label>
                <select
                  value={alarmMinutesBefore}
                  onChange={e => setAlarmMinutesBefore(Number(e.target.value))}
                  className="w-full rounded-xl border border-bd bg-surface-2 pl-3 pr-8 py-1.5 text-xs text-text-1 focus:border-accent cursor-pointer shadow-2xs hover:border-bd-strong transition-all"
                >
                  <option value={10}>提前 10 分钟</option>
                  <option value={20}>提前 20 分钟 (推荐)</option>
                  <option value={30}>提前 30 分钟</option>
                  <option value={60}>提前 1 小时</option>
                </select>
              </div>

              <div>
                <label className="text-2xs text-text-3 block mb-1">作业 DDL 提前提醒:</label>
                <select
                  value={alarmDdlHoursBefore}
                  onChange={e => setAlarmDdlHoursBefore(Number(e.target.value))}
                  className="w-full rounded-xl border border-bd bg-surface-2 pl-3 pr-8 py-1.5 text-xs text-text-1 focus:border-accent cursor-pointer shadow-2xs hover:border-bd-strong transition-all"
                >
                  <option value={12}>提前 12 小时</option>
                  <option value={24}>提前 24 小时 (推荐)</option>
                  <option value={48}>提前 2 天</option>
                </select>
              </div>
            </div>

            {exportedPath && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                <div className="font-semibold">✓ 已成功导出 {exportCount} 项日程与作业！</div>
                <div className="mt-1 font-mono text-3xs truncate">{exportedPath}</div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="rounded-xl border border-bd px-4 py-2 text-xs font-medium text-text-2 hover:bg-surface-2 cursor-pointer transition-all"
              >
                关闭
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={() => void handleExport()}
                className="rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-50 cursor-pointer shadow-xs transition-all"
              >
                {exporting ? '正在生成…' : '立即导出 .ics'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 课程全学期课表与教学信息详情弹窗 (Apple HIG Modal) ─── */}
      {selectedCourseForModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={() => setSelectedCourseForModal(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-bd/80 dark:border-white/10 bg-surface-1 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={e => e.stopPropagation()}
          >
            {/* 顶栏 Header */}
            <div className="flex items-start justify-between border-b border-bd/60 dark:border-white/10 px-6 py-4 bg-surface-2/60">
              <div className="space-y-1.5 pr-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold text-text-1 tracking-tight">
                    {selectedCourseForModal.courseName}
                  </h3>
                  {selectedCourseForModal.xf && (
                    <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-2xs font-semibold text-accent">
                      ⭐ {selectedCourseForModal.xf} 学分
                    </span>
                  )}
                  {selectedCourseForModal.kclbmc && (
                    <span className="rounded-full bg-surface-3 px-2 py-0.5 text-2xs font-medium text-text-3">
                      🏷️ {selectedCourseForModal.kclbmc}
                    </span>
                  )}
                </div>
                {(selectedCourseForModal.titleEn || selectedCourseForModal.kch) && (
                  <div className="font-mono text-2xs text-text-3">
                    {selectedCourseForModal.kch && `代码: ${selectedCourseForModal.kch}`}
                    {selectedCourseForModal.kcbj && ` · 教学班: ${selectedCourseForModal.kcbj}`}
                    {selectedCourseForModal.titleEn && !selectedCourseForModal.kch && selectedCourseForModal.titleEn}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedCourseForModal(null)}
                className="rounded-full p-1.5 text-text-3 hover:text-text-1 hover:bg-surface-3 transition-colors cursor-pointer"
                title="关闭 (Esc)"
              >
                ✕
              </button>
            </div>

            {/* 弹窗内容主体 (可滚动) */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* 核心元信息卡片 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 rounded-xl border border-bd/50 dark:border-white/[0.06] bg-surface-2/40 p-4 text-xs">
                <div>
                  <div className="text-3xs text-text-4 uppercase font-semibold">👨‍🏫 任课教师</div>
                  <div className="mt-1 font-medium text-text-1">{selectedCourseForModal.teachers || '主讲教学团队'}</div>
                </div>
                <div>
                  <div className="text-3xs text-text-4 uppercase font-semibold">📍 教学地点</div>
                  <div className="mt-1 font-medium text-accent">{selectedCourseForModal.locations || '校内常规教室'}</div>
                </div>
                <div>
                  <div className="text-3xs text-text-4 uppercase font-semibold">🗓️ 排课周期 / 节次</div>
                  <div className="mt-1 font-mono text-text-2">{selectedCourseForModal.periodAndWeeks}</div>
                </div>
                {selectedCourseForModal.jxbmc && (
                  <div>
                    <div className="text-3xs text-text-4 uppercase font-semibold">🎓 教学班级</div>
                    <div className="mt-1 text-text-2 truncate">{selectedCourseForModal.jxbmc}</div>
                  </div>
                )}
              </div>

              {/* 课时安排清单 */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <h4 className="text-xs font-bold text-text-2 uppercase tracking-wider flex items-center gap-1.5">
                    <span>📅</span>
                    <span>全学期课时安排清单 ({selectedCourseForModal.scheduleSessions.length} 讲)</span>
                  </h4>
                  <span className="text-3xs text-text-4">按教学周次与日期排序</span>
                </div>

                <div className="max-h-60 overflow-y-auto rounded-xl border border-bd/40 dark:border-white/[0.05] bg-surface-2/30 divide-y divide-bd/30 dark:divide-white/[0.04]">
                  {selectedCourseForModal.scheduleSessions.map((sess, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between px-3.5 py-2 text-2xs hover:bg-surface-2/60 transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="font-semibold text-text-2 shrink-0">
                          {sess.weekHint || `第 ${idx + 1} 讲`}
                        </span>
                        {sess.dateStr && (
                          <span className="font-mono text-text-3 text-3xs">
                            {sess.dateStr}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-right">
                        <span className="font-mono text-accent">
                          {sess.timeStr}
                        </span>
                        {sess.location && sess.location !== '不排教室' && (
                          <span className="text-text-3 font-sans max-w-[140px] truncate hidden sm:inline">
                            📍 {sess.location}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 关联 Canvas 作业与任务 */}
              {selectedCourseForModal.assignments && selectedCourseForModal.assignments.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <h4 className="text-xs font-bold text-text-2 uppercase tracking-wider flex items-center gap-1.5">
                      <span>📝</span>
                      <span>关联 Canvas 作业任务 ({selectedCourseForModal.assignments.length} 项)</span>
                    </h4>
                  </div>

                  <div className="space-y-2">
                    {selectedCourseForModal.assignments.map(ddl => {
                      const isSubmitted =
                        ddl.submissionStatus === 'submitted' || ddl.submissionStatus === 'graded'
                      const isMissing = ddl.submissionStatus === 'missing'

                      return (
                        <div
                          key={ddl.id}
                          className={`flex items-center justify-between rounded-xl border p-3 text-xs transition-colors ${
                            isSubmitted
                              ? 'border-emerald-500/20 bg-emerald-500/5 dark:bg-[#1a2920] dark:border-emerald-500/20'
                              : isMissing
                              ? 'border-rose-500/20 bg-rose-500/10 dark:bg-[#2b1b1b] dark:border-rose-500/20'
                              : 'border-amber-500/20 bg-amber-500/10 dark:bg-[#2b241b] dark:border-amber-500/20'
                          }`}
                        >
                          <div className="space-y-0.5 pr-2">
                            <div className="font-medium text-text-1">{ddl.title}</div>
                            <div className="text-3xs text-text-3 font-mono">
                              截止时间: {ddl.endTime ? `${getEventDateStr(ddl.endTime)} ${formatEventTime(ddl.endTime)}` : '无明确截止'}
                            </div>
                          </div>
                          <div className="shrink-0 flex items-center gap-2">
                            {ddl.htmlUrl && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (ddl.htmlUrl) void window.api.openExternal(ddl.htmlUrl)
                                }}
                                className="rounded-lg border border-bd px-2.5 py-1 text-3xs font-medium text-accent hover:border-accent cursor-pointer transition-all shadow-2xs"
                                title="在默认浏览器中打开该作业"
                              >
                                打开作业 ↗
                              </button>
                            )}
                            <span
                              className={`shrink-0 rounded-full px-2.5 py-0.5 text-3xs font-bold ${
                                isSubmitted
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                  : isMissing
                                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                                  : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              {isSubmitted ? '✓ 已提交' : isMissing ? '已逾期' : '待提交'}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 底栏 Footer */}
            <div className="flex items-center justify-end border-t border-bd/60 dark:border-white/10 px-6 py-3 bg-surface-2/40">
              <button
                type="button"
                onClick={() => setSelectedCourseForModal(null)}
                className="rounded-xl bg-surface-3 hover:bg-surface-4 px-5 py-2 text-xs font-semibold text-text-1 cursor-pointer transition-all shadow-2xs"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Apple 风格鼠标悬停即显浮窗 (Hover Popover) ─── */}
      {hoveredCourseItem && !selectedCourseForModal && (() => {
        const { item, rect } = hoveredCourseItem
        const popoverWidth = 280
        let left = rect.left + rect.width / 2 - popoverWidth / 2
        if (left < 16) left = 16
        if (left + popoverWidth > window.innerWidth - 16) {
          left = window.innerWidth - popoverWidth - 16
        }

        const showAbove = rect.top > 200
        const top = showAbove ? rect.top - 8 : rect.bottom + 8

        return (
          <div
            style={{
              top: `${top}px`,
              left: `${left}px`,
              transform: showAbove ? 'translateY(-100%)' : 'none'
            }}
            className="fixed z-40 pointer-events-none w-[280px] rounded-2xl border border-bd/80 dark:border-white/15 bg-surface-1/95 dark:bg-[#1c1c1e]/95 backdrop-blur-md p-3.5 shadow-xl transition-all duration-150 animate-in fade-in zoom-in-95"
          >
            <div className="space-y-2">
              {/* 顶部课程名称与学分徽标 */}
              <div className="space-y-1">
                <div className="font-bold text-sm text-text-1 leading-snug break-words tracking-tight">
                  {item.title}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {item.xf && (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-3xs font-semibold text-accent">
                      ⭐ {item.xf} 学分
                    </span>
                  )}
                  {item.badge && (
                    <span className="rounded-full bg-surface-3 px-2 py-0.5 text-3xs font-medium text-text-3">
                      {item.badge}
                    </span>
                  )}
                  {item.endTime && item.endTime.includes('周') && (
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-3xs font-semibold text-accent">
                      🗓️ {item.endTime}
                    </span>
                  )}
                  {item.type === 'activity' && (
                    <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-3xs font-bold text-purple-600 dark:text-purple-400">
                      讲座 / 活动
                    </span>
                  )}
                </div>
              </div>

              {/* 详细时间、地点与教师 (完整展示，绝不截断) */}
              <div className="space-y-1.5 pt-2 border-t border-bd/40 dark:border-white/10 text-xs">
                <div className="flex items-start gap-1.5 text-2xs">
                  <span className="text-text-4 shrink-0 font-medium">🕒 时间:</span>
                  <span className="font-mono text-accent font-medium leading-tight">
                    {item.endTime && item.endTime.includes('周')
                      ? `${item.startTime} (${item.endTime})`
                      : getEventDisplayTime(item)}
                  </span>
                </div>
                {item.location && item.location !== '不排教室' && (
                  <div className="flex items-start gap-1.5 text-2xs">
                    <span className="text-text-4 shrink-0 font-medium">📍 地点:</span>
                    <span className="font-medium text-text-1 leading-tight break-words">
                      {item.location}
                    </span>
                  </div>
                )}
                {item.teacher && (
                  <div className="flex items-start gap-1.5 text-2xs">
                    <span className="text-text-4 shrink-0 font-medium">👨‍🏫 教师:</span>
                    <span className="text-text-2 leading-tight">
                      {item.teacher}
                    </span>
                  </div>
                )}
                {(item.jxbmc || item.description) && (
                  <div className="flex items-start gap-1.5 text-3xs">
                    <span className="text-text-4 shrink-0">🎓 班级:</span>
                    <span className="text-text-3 truncate">
                      {item.jxbmc || item.description}
                    </span>
                  </div>
                )}
              </div>

              {/* 底部操作提示 */}
              <div className="pt-1.5 border-t border-bd/30 dark:border-white/5 flex items-center justify-between text-3xs text-text-4">
                <span className="text-accent/90 font-medium">💡 点击查看完整课时与作业</span>
                <span>Esc 关闭</span>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
