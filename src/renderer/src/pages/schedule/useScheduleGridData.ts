import { useMemo } from 'react'
import type { ScheduleEvent, ScheduleWeek, JiaowuScheduleResult } from '@shared/types'
import type { PlacedEvent, DayEventCluster } from './schedule-types'
import {
  getSlotRangeFromJc,
  getSlotRangeFromTime,
  clusterDayEvents,
  isWeekInZcd,
  parseWeekNumber,
  formatWeeksRange,
  getEventDateStr,
  formatEventTime
} from './schedule-helpers'

export interface WeekGridDayInfo {
  dayIndex: number
  dateStr: string
  dayLabel: string
  shortDate: string
  isToday: boolean
}

export function useScheduleWeekGrid(
  isCurrentMode: boolean,
  activeEvents: ScheduleEvent[],
  weekDays: WeekGridDayInfo[],
  currentJiaowuResult: JiaowuScheduleResult | null,
  selectedJiaowuWeek: number
) {
  return useMemo(() => {
    const topEvents = new Map<string, ScheduleEvent[]>()
    for (const d of weekDays) {
      topEvents.set(d.dateStr, [])
    }
    const dayEventMap = new Map<number, PlacedEvent[]>()
    for (let i = 0; i < 7; i++) {
      dayEventMap.set(i, [])
    }

    if (isCurrentMode) {
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
}

export function useScheduleSemesterGrid(
  isCurrentMode: boolean,
  courseEvents: ScheduleEvent[],
  weeks: ScheduleWeek[],
  currentJiaowuResult: JiaowuScheduleResult | null
) {
  return useMemo(() => {
    const dayEventMap = new Map<number, PlacedEvent[]>()
    for (let i = 0; i < 7; i++) {
      dayEventMap.set(i, [])
    }

    if (isCurrentMode) {
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
          endTime: c.zcd,
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
}
