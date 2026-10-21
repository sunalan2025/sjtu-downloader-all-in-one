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

export * from './schedule/schedule-types'
export * from './schedule/schedule-helpers'

import type {
  PlacedEvent,
  DayEventCluster,
  SemesterCourseDetail
} from './schedule/schedule-types'
import {
  getSlotRangeFromJc,
  getSlotRangeFromTime,
  clusterDayEvents,
  isWeekInZcd,
  parseWeekNumber,
  formatWeeksRange,
  getEventDateStr,
  formatEventTime
} from './schedule/schedule-helpers'

export { LockDeadlineBadge, AssignmentStatusBadge } from './schedule/components/ScheduleBadges'
import { ScheduleExportModal } from './schedule/components/ScheduleExportModal'
import { CourseDetailModal } from './schedule/components/CourseDetailModal'
import { CourseHoverPopover } from './schedule/components/CourseHoverPopover'
import { ScheduleHeaderBar } from './schedule/components/ScheduleHeaderBar'
import { WeekScheduleView } from './schedule/components/WeekScheduleView'
import { SemesterScheduleView } from './schedule/components/SemesterScheduleView'

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

  // 未标注日期作业（无 due_at 也无 lock_at）指示胶囊与浮窗
  const [showUndatedPopover, setShowUndatedPopover] = useState(false)

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
  // 筛选既无 due_at 也无 lock_at 的活跃作业（无截止时限容灾）
  const undatedAssignments = useMemo(() => {
    if (!isCurrentMode) return []
    return ddlEvents.filter(e => !e.startTime)
  }, [isCurrentMode, ddlEvents])

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
      assignments: g.assignments.sort((a, b) => {
        if (!a.startTime && !b.startTime) return a.title.localeCompare(b.title)
        if (!a.startTime) return 1
        if (!b.startTime) return -1
        return a.startTime.localeCompare(b.startTime)
      })
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
    const list = [...ddlEvents].sort((a, b) => {
      if (!a.startTime && !b.startTime) return a.title.localeCompare(b.title)
      if (!a.startTime) return 1
      if (!b.startTime) return -1
      return a.startTime.localeCompare(b.startTime)
    })
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
      <ScheduleHeaderBar
        selectedSemesterKey={selectedSemesterKey}
        onSemesterChange={handleSemesterChange}
        semesters={dynamicJiaowuSemesters}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        isCurrentMode={isCurrentMode}
        layerFilter={layerFilter}
        onToggleLayer={key => setLayerFilter(f => ({ ...f, [key]: !f[key] }))}
        courseEventsCount={courseEvents.length}
        activityEventsCount={activityEvents.length}
        ddlEventsCount={ddlEvents.length}
        studentName={currentJiaowuResult?.studentName}
        studentId={currentJiaowuResult?.studentId}
        onOpenExportModal={() => setShowExportModal(true)}
        onRefresh={() => {
          if (isCurrentMode) {
            void loadSchedule(true)
          } else {
            void loadJiaowuSemester(selectedSemesterKey, true)
          }
        }}
        loading={loading}
        refreshing={refreshing}
        jiaowuLoading={jiaowuLoading}
      />

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
          <WeekScheduleView
            isCurrentMode={isCurrentMode}
            weeks={weeks}
            selectedWeekKey={selectedWeekKey}
            setSelectedWeekKey={setSelectedWeekKey}
            selectedWeekIndex={selectedWeekIndex}
            regularTermWeeks={regularTermWeeks}
            breakWeeks={breakWeeks}
            currentWeek={currentWeek}
            semesterTitle={semesterTitle}
            selectedWeekObj={selectedWeekObj}
            currentJiaowuResult={currentJiaowuResult}
            selectedJiaowuWeek={selectedJiaowuWeek}
            setSelectedJiaowuWeek={setSelectedJiaowuWeek}
            undatedAssignments={undatedAssignments}
            showUndatedPopover={showUndatedPopover}
            setShowUndatedPopover={setShowUndatedPopover}
            weekDays={weekDays}
            dayTopEvents={dayTopEvents}
            hasAnyTopEvents={hasAnyTopEvents}
            dayClusters={dayClusters}
            occupiedSlots={occupiedSlots}
            hasNoonEvents={hasNoonEvents}
            expandNoonSlot={expandNoonSlot}
            setExpandNoonSlot={setExpandNoonSlot}
            handleOpenCourseModal={handleOpenCourseModal}
            handleCardMouseEnter={handleCardMouseEnter}
            handleCardMouseLeave={handleCardMouseLeave}
          />
        ) : (
          <SemesterScheduleView
            isCurrentMode={isCurrentMode}
            uniqueCourseNames={uniqueCourseNames}
            courseEventsCount={courseEvents.length}
            activityEventsCount={activityEvents.length}
            ddlEventsCount={ddlEvents.length}
            ddlSubmittedCount={ddlSubmittedCount}
            currentJiaowuResult={currentJiaowuResult}
            jiaowuOverview={jiaowuOverview}
            overviewTab={overviewTab}
            setOverviewTab={setOverviewTab}
            overviewCourseView={overviewCourseView}
            setOverviewCourseView={setOverviewCourseView}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            hasSemesterNoonEvents={hasSemesterNoonEvents}
            expandSemesterNoonSlot={expandSemesterNoonSlot}
            setExpandSemesterNoonSlot={setExpandSemesterNoonSlot}
            semesterOccupiedSlots={semesterOccupiedSlots}
            semesterDayClusters={semesterDayClusters}
            courseCardsCount={courseCards.length}
            filteredCourseCards={filteredCourseCards}
            filteredJiaowuCourses={filteredJiaowuCourses}
            filteredActivities={filteredActivities}
            filteredAssignments={filteredAssignments}
            expandedCourseNames={expandedCourseNames}
            toggleCourseExpand={toggleCourseExpand}
            handleOpenCourseModal={handleOpenCourseModal}
            handleCardMouseEnter={handleCardMouseEnter}
            handleCardMouseLeave={handleCardMouseLeave}
          />
        )}
      </div>

      {/* ─── 导出日历配置弹窗 ─── */}
      <ScheduleExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        includeCourses={includeCourses}
        setIncludeCourses={setIncludeCourses}
        includeActivities={includeActivities}
        setIncludeActivities={setIncludeActivities}
        includeDdl={includeDdl}
        setIncludeDdl={setIncludeDdl}
        courseEventsCount={courseEvents.length}
        activityEventsCount={activityEvents.length}
        ddlEventsCount={ddlEvents.length}
        alarmMinutesBefore={alarmMinutesBefore}
        setAlarmMinutesBefore={setAlarmMinutesBefore}
        alarmDdlHoursBefore={alarmDdlHoursBefore}
        setAlarmDdlHoursBefore={setAlarmDdlHoursBefore}
        exportedPath={exportedPath}
        exportCount={exportCount}
        exporting={exporting}
        onExport={() => void handleExport()}
      />

      {/* ─── 课程全学期课表详情弹窗 ─── */}
      <CourseDetailModal
        course={selectedCourseForModal}
        onClose={() => setSelectedCourseForModal(null)}
      />

      {/* ─── Apple 风格鼠标悬停即显浮窗 ─── */}
      <CourseHoverPopover
        hoveredCourseItem={hoveredCourseItem}
        hasOpenModal={Boolean(selectedCourseForModal)}
      />
    </div>
  )
}
