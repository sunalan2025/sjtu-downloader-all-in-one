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

    it('fetches courses concurrently from favorites and active courses, deduplicating by id', async () => {
      const requestedUrls: string[] = []
      const mockSes = {
        fetch: vi.fn().mockImplementation(async (url: string) => {
          requestedUrls.push(url)
          if (url.includes('/users/self/favorites/courses')) {
            return {
              ok: true,
              json: async () => [
                { id: 101, name: '高等数学', course_code: 'MATH101' },
                { id: 102, name: '线性代数', course_code: 'MATH102' }
              ]
            }
          }
          if (url.includes('/courses?enrollment_state=active')) {
            return {
              ok: true,
              json: async () => [
                { id: 102, name: '线性代数', course_code: 'MATH102' }, // duplicate
                { id: 103, name: '大学物理', course_code: 'PHYS101' } // non-favorited active course
              ]
            }
          }
          if (url.includes('/courses/101/assignments')) {
            return {
              ok: true,
              json: async () => [{ id: 1001, name: '高数作业1', due_at: '2026-11-20T12:00:00Z' }]
            }
          }
          if (url.includes('/courses/102/assignments')) {
            return {
              ok: true,
              json: async () => [{ id: 1002, name: '线代作业1', due_at: '2026-11-21T12:00:00Z' }]
            }
          }
          if (url.includes('/courses/103/assignments')) {
            return {
              ok: true,
              json: async () => [{ id: 1003, name: '大物作业1', due_at: '2026-11-22T12:00:00Z' }]
            }
          }
          return { ok: false, status: 404 }
        })
      } as any

      const res = await fetchCanvasUpcomingDeadlines(mockSes)
      expect(res).toHaveLength(3)
      expect(res.map(r => r.courseName)).toEqual(['高等数学', '线性代数', '大学物理'])
      // Verify course 102 was requested only once
      const assignmentUrls102 = requestedUrls.filter(u => u.includes('/courses/102/assignments'))
      expect(assignmentUrls102).toHaveLength(1)
    })

    it('inherits lock_at as deadline and sets isLockAtDeadline = true when due_at is missing (e.g. 大学物理)', async () => {
      const mockSes = {
        fetch: vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/users/self/favorites/courses')) {
            return {
              ok: true,
              json: async () => [{ id: 103, name: '大学物理', course_code: 'PHYS101' }]
            }
          }
          if (url.includes('/courses?enrollment_state=active')) {
            return { ok: true, json: async () => [] }
          }
          if (url.includes('/courses/103/assignments')) {
            return {
              ok: true,
              json: async () => [
                {
                  id: 2001,
                  name: '大物实验报告（仅锁定时限）',
                  due_at: null,
                  lock_at: '2026-12-01T15:59:00Z',
                  submission: null
                },
                {
                  id: 2002,
                  name: '大物平时作业（标准 DDL）',
                  due_at: '2026-11-15T15:59:00Z',
                  lock_at: '2026-11-16T15:59:00Z',
                  submission: null
                }
              ]
            }
          }
          return { ok: false, status: 404 }
        })
      } as any

      const res = await fetchCanvasUpcomingDeadlines(mockSes)
      expect(res).toHaveLength(2)
      const lockInherited = res.find(r => r.id === 'canvas-ddl-2001')!
      expect(lockInherited.isLockAtDeadline).toBe(true)
      expect(lockInherited.startTime).toContain('2026-12-01')

      const standardDdl = res.find(r => r.id === 'canvas-ddl-2002')!
      expect(standardDdl.isLockAtDeadline).toBe(false)
      expect(standardDdl.startTime).toContain('2026-11-15')
    })

    it('accurately identifies student submission statuses and fixes the has_submitted_submissions bug', async () => {
      const pastDdl = new Date(Date.now() - 3600 * 1000).toISOString()
      const futureDdl = new Date(Date.now() + 3600 * 1000).toISOString()

      const mockSes = {
        fetch: vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/users/self/favorites/courses')) {
            return {
              ok: true,
              json: async () => [{ id: 101, name: '软件工程', course_code: 'SE101' }]
            }
          }
          if (url.includes('/courses?enrollment_state=active')) {
            return { ok: true, json: async () => [] }
          }
          if (url.includes('/courses/101/assignments')) {
            return {
              ok: true,
              json: async () => [
                {
                  id: 3001,
                  name: '全班有人交但当前学生未交已逾期 (Bug Fix 验证)',
                  due_at: pastDdl,
                  has_submitted_submissions: true, // 全班有人提交
                  submission: null // 当前学生未交！
                },
                {
                  id: 3002,
                  name: '已评分作业',
                  due_at: pastDdl,
                  submission: { workflow_state: 'graded', score: 95 }
                },
                {
                  id: 3003,
                  name: '已提交待批改作业',
                  due_at: futureDdl,
                  submission: { workflow_state: 'submitted' }
                },
                {
                  id: 3004,
                  name: '通过 attempt 判定的已提交作业',
                  due_at: futureDdl,
                  submission: { attempt: 1 }
                },
                {
                  id: 3005,
                  name: '通过 submitted_at 判定的已提交作业',
                  due_at: futureDdl,
                  submission: { submitted_at: '2026-10-18T10:00:00Z' }
                },
                {
                  id: 3006,
                  name: 'Canvas 明确标记 missing 的作业',
                  due_at: futureDdl,
                  submission: { missing: true }
                },
                {
                  id: 3007,
                  name: '未逾期未提交作业',
                  due_at: futureDdl,
                  submission: null
                }
              ]
            }
          }
          return { ok: false, status: 404 }
        })
      } as any

      const res = await fetchCanvasUpcomingDeadlines(mockSes)
      expect(res).toHaveLength(7)

      const bugFixItem = res.find(r => r.id === 'canvas-ddl-3001')!
      expect(bugFixItem.submissionStatus).toBe('missing') // 关键：不得被误判为 submitted！

      const gradedItem = res.find(r => r.id === 'canvas-ddl-3002')!
      expect(gradedItem.submissionStatus).toBe('graded')
      expect(gradedItem.score).toBe(95)

      const submittedItem = res.find(r => r.id === 'canvas-ddl-3003')!
      expect(submittedItem.submissionStatus).toBe('submitted')

      const attemptItem = res.find(r => r.id === 'canvas-ddl-3004')!
      expect(attemptItem.submissionStatus).toBe('submitted')

      const timestampItem = res.find(r => r.id === 'canvas-ddl-3005')!
      expect(timestampItem.submissionStatus).toBe('submitted')

      const missingItem = res.find(r => r.id === 'canvas-ddl-3006')!
      expect(missingItem.submissionStatus).toBe('missing')

      const unsubmittedItem = res.find(r => r.id === 'canvas-ddl-3007')!
      expect(unsubmittedItem.submissionStatus).toBe('unsubmitted')
    })

    it('supports lock_at and submission status in fallback upcoming events', async () => {
      const pastLock = new Date(Date.now() - 3600 * 1000).toISOString()
      const mockSes = {
        fetch: vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/users/self/favorites/courses') || url.includes('/courses?enrollment_state=active')) {
            return { ok: true, json: async () => [] } // courses empty -> triggers fallback
          }
          if (url.includes('/users/self/upcoming_events')) {
            return {
              ok: true,
              json: async () => [
                {
                  id: 4001,
                  title: 'Fallback 锁定作业',
                  lock_at: pastLock,
                  submission: { workflow_state: 'graded', score: 100 }
                }
              ]
            }
          }
          return { ok: false, status: 404 }
        })
      } as any

      const res = await fetchCanvasUpcomingDeadlines(mockSes)
      expect(res).toHaveLength(1)
      expect(res[0].id).toBe('canvas-ddl-4001')
      expect(res[0].isLockAtDeadline).toBe(true)
      expect(res[0].submissionStatus).toBe('graded')
      expect(res[0].score).toBe(100)
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
