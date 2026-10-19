import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getDefaultSemesterDateRange,
  fetchCalendarEvents,
  fetchCanvasUpcomingDeadlines,
  fetchAllScheduleEvents,
  findCurrentWeek,
  isCalendarSessionValid,
  ensureCalendarLoggedIn,
  invalidateCalendarLogin
} from '../../src/main/schedule/schedule-fetcher'

describe('Schedule Fetcher Unit Tests', () => {
  beforeEach(() => {
    invalidateCalendarLogin()
    vi.restoreAllMocks()
  })

  describe('getDefaultSemesterDateRange', () => {
    it('returns a valid 4-digit start and end year with YYYY-MM-DD HH:mm format', () => {
      const range = getDefaultSemesterDateRange()
      expect(range.startDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
      expect(range.endDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    })
  })

  describe('findCurrentWeek', () => {
    it('returns the week matching current time', () => {
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const yesterday = new Date(now.getTime() - 86400000)
      const tomorrow = new Date(now.getTime() + 86400000)

      const weeks = [
        {
          week: '第1周',
          title: '秋季学期',
          startTime: '2026-09-01 00:00',
          endTime: '2026-09-07 23:59'
        },
        {
          week: '第6周',
          title: '秋季学期',
          startTime: `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())} 00:00`,
          endTime: `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())} 23:59`
        }
      ]

      const found = findCurrentWeek(weeks)
      expect(found).toBeDefined()
      expect(found?.week).toBe('第6周')
    })

    it('returns undefined when weeks array is empty', () => {
      expect(findCurrentWeek([])).toBeUndefined()
    })
  })

  describe('isCalendarSessionValid', () => {
    it('returns false when JSESSIONID cookie is missing', async () => {
      const mockSes = {
        cookies: {
          get: vi.fn().mockResolvedValue([
            { name: 'OTHER_COOKIE', value: '123' }
          ])
        },
        fetch: vi.fn()
      } as any

      const valid = await isCalendarSessionValid(mockSes)
      expect(valid).toBe(false)
      expect(mockSes.fetch).not.toHaveBeenCalled()
    })

    it('returns false when server redirects to OAuth2 (HTTP 302)', async () => {
      const mockSes = {
        cookies: {
          get: vi.fn().mockResolvedValue([
            { name: 'JSESSIONID', value: 'sess-abc-123' }
          ])
        },
        fetch: vi.fn().mockResolvedValue({
          status: 302,
          ok: false
        })
      } as any

      const valid = await isCalendarSessionValid(mockSes)
      expect(valid).toBe(false)
    })

    it('returns true when JSESSIONID exists and probe succeeds with 200', async () => {
      const mockSes = {
        cookies: {
          get: vi.fn().mockResolvedValue([
            { name: 'JSESSIONID', value: 'sess-abc-123' }
          ])
        },
        fetch: vi.fn().mockResolvedValue({
          status: 200,
          ok: true
        })
      } as any

      const valid = await isCalendarSessionValid(mockSes)
      expect(valid).toBe(true)
    })
  })

  describe('ensureCalendarLoggedIn', () => {
    it('returns true directly if isCalendarSessionValid is true', async () => {
      const mockSes = {
        cookies: {
          get: vi.fn().mockResolvedValue([
            { name: 'JSESSIONID', value: 'valid-sess' }
          ])
        },
        fetch: vi.fn().mockResolvedValue({
          status: 200,
          ok: true
        })
      } as any

      const ok = await ensureCalendarLoggedIn(mockSes)
      expect(ok).toBe(true)
    })

    it('returns false when no valid jAccount session exists', async () => {
      const mockSes = {
        cookies: {
          get: vi.fn().mockImplementation(async ({ url, domain }: { url?: string; domain?: string }) => {
            if (url) return [] // no calendar cookies
            if (domain) return [{ name: 'JATrustCookie', value: 'device-only' }] // no real JAAuthCookie
            return []
          })
        },
        fetch: vi.fn()
      } as any

      const ok = await ensureCalendarLoggedIn(mockSes)
      expect(ok).toBe(false)
    })
  })

  describe('fetchCalendarEvents', () => {
    it('maps calendar.sjtu.edu.cn response to ScheduleEvent and ScheduleWeek arrays and parses teacher', async () => {
      const mockSes = {
        cookies: {
          get: vi.fn().mockResolvedValue([
            { name: 'JSESSIONID', value: 'sess-active' }
          ])
        },
        fetch: vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/ui/calendar')) {
            return { status: 200, ok: true }
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 200,
              data: {
                schoolCalendar: {
                  title: '2026-2027学年秋季学期',
                  weeks: [
                    {
                      week: '第五周',
                      weekEn: 'Week 5',
                      title: '秋季学期',
                      titleEn: 'Autumn Term',
                      startTime: '2026-10-12 00:00',
                      endTime: '2026-10-18 23:59'
                    }
                  ]
                },
                events: [
                  {
                    eventId: 'ev-1',
                    title: '生物化学',
                    titleEn: 'Biochemistry',
                    location: '东中院2-203',
                    startTime: '2026-10-16 10:00',
                    endTime: '2026-10-16 11:40',
                    description: '课程编码: CHEM2001; 授课教师: 李华教授'
                  }
                ]
              }
            })
          }
        })
      } as any

      const res = await fetchCalendarEvents(mockSes)
      expect(res.events).toHaveLength(1)
      expect(res.events[0].id).toBe('ev-1')
      expect(res.events[0].title).toBe('生物化学')
      expect(res.events[0].location).toBe('东中院2-203')
      expect(res.events[0].teacher).toBe('李华教授')
      expect(res.events[0].type).toBe('course')
      expect(res.weeks).toHaveLength(1)
      expect(res.currentWeek).toBe('第五周')
      expect(res.semesterTitle).toBe('2026-2027学年秋季学期')
    })

    it('throws NEED_LOGIN when ensureCalendarLoggedIn fails', async () => {
      const mockSes = {
        cookies: {
          get: vi.fn().mockResolvedValue([])
        },
        fetch: vi.fn()
      } as any

      await expect(fetchCalendarEvents(mockSes)).rejects.toThrow('NEED_LOGIN')
    })
  })

  describe('fetchCanvasUpcomingDeadlines', () => {
    it('fetches upcoming assignments and maps to assignment_ddl events with local formatted dates', async () => {
      const mockSes = {
        fetch: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [
            {
              id: 421772,
              title: '实验报告7',
              end_at: '2026-11-17T15:59:00Z',
              context_name: '生物化学实验',
              html_url: 'https://oc.sjtu.edu.cn/courses/93803/assignments/421772'
            }
          ]
        })
      } as any

      const res = await fetchCanvasUpcomingDeadlines(mockSes)
      expect(res).toHaveLength(1)
      expect(res[0].id).toBe('canvas-ddl-421772')
      expect(res[0].title).toBe('实验报告7')
      expect(res[0].type).toBe('assignment_ddl')
      expect(res[0].courseName).toBe('生物化学实验')
      expect(res[0].startTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    })

    it('returns empty array when network fails or returns non-200', async () => {
      const mockSes = {
        fetch: vi.fn().mockResolvedValue({
          ok: false,
          status: 404
        })
      } as any

      const res = await fetchCanvasUpcomingDeadlines(mockSes)
      expect(res).toEqual([])
    })
  })

  describe('fetchAllScheduleEvents', () => {
    it('aggregates both calendar events and Canvas DDLs into a single unified result', async () => {
      const mockSes = {
        cookies: {
          get: vi.fn().mockResolvedValue([{ name: 'JSESSIONID', value: 'sess-active' }])
        },
        fetch: vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/ui/calendar')) {
            return { status: 200, ok: true }
          }
          if (url.includes('calendar.sjtu.edu.cn')) {
            return {
              ok: true,
              json: async () => ({
                data: {
                  schoolCalendar: { weeks: [{ week: '第5周' }] },
                  events: [{ eventId: 'c1', title: '高等数学', startTime: '2026-10-14 08:00', endTime: '2026-10-14 09:40' }]
                }
              })
            }
          } else {
            return {
              ok: true,
              json: async () => [
                { id: 99, title: '作业1', end_at: '2026-10-15 23:59' }
              ]
            }
          }
        })
      } as any

      const result = await fetchAllScheduleEvents(mockSes)
      expect(result.ok).toBe(true)
      expect(result.events).toHaveLength(2)
      expect(result.events[0].title).toBe('高等数学')
      expect(result.events[1].title).toBe('作业1')
    })

    it('returns NEED_LOGIN error cleanly when calendar session expired', async () => {
      const mockSes = {
        cookies: {
          get: vi.fn().mockResolvedValue([]) // no cookies -> NEED_LOGIN
        },
        fetch: vi.fn()
      } as any

      const result = await fetchAllScheduleEvents(mockSes)
      expect(result.ok).toBe(false)
      expect(result.error).toBe('NEED_LOGIN')
      expect(result.events).toEqual([])
    })
  })
})
