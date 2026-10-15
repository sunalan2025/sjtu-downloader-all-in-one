import { describe, it, expect } from 'vitest'
import {
  escapeIcsText,
  formatIcsDateTime,
  buildVTimezoneShanghai,
  buildVEvent,
  generateIcsContent
} from '../../src/main/schedule/ics-generator'
import type { ScheduleEvent, IcsExportOptions } from '../../src/shared/types'

describe('RFC 5545 iCalendar Generator Unit Tests', () => {
  describe('escapeIcsText', () => {
    it('escapes backslashes, semicolons, commas and newlines', () => {
      const input = 'Hello\\World; Test, New\nLine\r\nAgain'
      const escaped = escapeIcsText(input)
      expect(escaped).toBe('Hello\\\\World\\; Test\\, New\\nLine\\nAgain')
    })

    it('handles empty or blank string gracefully', () => {
      expect(escapeIcsText('')).toBe('')
    })
  })

  describe('formatIcsDateTime', () => {
    it('formats "YYYY-MM-DD HH:mm" string properly', () => {
      const res = formatIcsDateTime('2026-10-16 10:00')
      expect(res).toBe('20261016T100000')
    })

    it('formats Date object properly', () => {
      const d = new Date(2026, 9, 16, 14, 30, 0)
      const res = formatIcsDateTime(d)
      expect(res).toBe('20261016T143000')
    })
  })

  describe('buildVTimezoneShanghai', () => {
    it('contains standard VTIMEZONE structure with +0800', () => {
      const tz = buildVTimezoneShanghai()
      expect(tz).toContain('BEGIN:VTIMEZONE')
      expect(tz).toContain('TZID:Asia/Shanghai')
      expect(tz).toContain('TZOFFSETFROM:+0800')
      expect(tz).toContain('TZOFFSETTO:+0800')
      expect(tz).toContain('END:VTIMEZONE')
    })
  })

  describe('buildVEvent', () => {
    const sampleCourse: ScheduleEvent = {
      id: 'course-101',
      title: '生物化学',
      location: '东中院2-203',
      startTime: '2026-10-16 10:00',
      endTime: '2026-10-16 11:40',
      type: 'course',
      teacher: '梁如冰',
      weekInfo: '秋季学期 第五周'
    }

    const defaultOpts: IcsExportOptions = {
      includeCourses: true,
      includeDdl: true,
      alarmMinutesBefore: 20,
      alarmDdlHoursBefore: 24
    }

    it('generates VEVENT for course with VALARM 20m before', () => {
      const lines = buildVEvent(sampleCourse, defaultOpts, '20261014T000000')
      expect(lines).toContain('BEGIN:VEVENT')
      expect(lines).toContain('UID:course-101@sjtu.edu.cn')
      expect(lines).toContain('SUMMARY:生物化学')
      expect(lines).toContain('LOCATION:东中院2-203')
      expect(lines).toContain('DTSTART;TZID=Asia/Shanghai:20261016T100000')
      expect(lines).toContain('DTEND;TZID=Asia/Shanghai:20261016T114000')
      expect(lines).toContain('BEGIN:VALARM')
      expect(lines).toContain('TRIGGER:-PT20M')
      expect(lines).toContain('END:VALARM')
      expect(lines).toContain('END:VEVENT')
    })

    it('generates VEVENT for assignment DDL with [DDL] prefix and VALARM 24h before', () => {
      const sampleDdl: ScheduleEvent = {
        id: 'ddl-202',
        title: '实验报告1 - 酶动力学',
        startTime: '2026-10-20 23:59',
        endTime: '2026-10-20 23:59',
        type: 'assignment_ddl',
        courseName: '生物化学实验'
      }

      const lines = buildVEvent(sampleDdl, defaultOpts, '20261014T000000')
      expect(lines).toContain('SUMMARY:[DDL] 实验报告1 - 酶动力学')
      expect(lines).toContain('TRIGGER:-PT24H')
    })
  })

  describe('generateIcsContent', () => {
    const events: ScheduleEvent[] = [
      {
        id: 'c1',
        title: '生物化学',
        location: '东中院2-203',
        startTime: '2026-10-16 10:00',
        endTime: '2026-10-16 11:40',
        type: 'course'
      },
      {
        id: 'd1',
        title: '作业 1',
        startTime: '2026-10-20 23:59',
        endTime: '2026-10-20 23:59',
        type: 'assignment_ddl'
      }
    ]

    it('generates valid RFC 5545 calendar with CRLF line endings', () => {
      const content = generateIcsContent(events)
      expect(content.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
      expect(content.endsWith('END:VCALENDAR\r\n')).toBe(true)
      expect(content).toContain('SUMMARY:生物化学')
      expect(content).toContain('SUMMARY:[DDL] 作业 1')
      expect(content.includes('\r\n')).toBe(true)
    })

    it('respects includeCourses and includeDdl filter options', () => {
      const coursesOnly = generateIcsContent(events, {
        includeCourses: true,
        includeDdl: false,
        alarmMinutesBefore: 15,
        alarmDdlHoursBefore: 0
      })
      expect(coursesOnly).toContain('SUMMARY:生物化学')
      expect(coursesOnly).not.toContain('SUMMARY:[DDL] 作业 1')

      const ddlOnly = generateIcsContent(events, {
        includeCourses: false,
        includeDdl: true,
        alarmMinutesBefore: 0,
        alarmDdlHoursBefore: 12
      })
      expect(ddlOnly).not.toContain('SUMMARY:生物化学')
      expect(ddlOnly).toContain('SUMMARY:[DDL] 作业 1')
    })
  })
})
