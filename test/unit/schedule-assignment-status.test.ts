import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchCanvasUpcomingDeadlines,
  invalidateCalendarLogin
} from '../../src/main/schedule/schedule-fetcher'

describe('Canvas Assignment Submission Status & Dual-Track Deadline Inheritance Tests', () => {
  beforeEach(() => {
    invalidateCalendarLogin()
    vi.restoreAllMocks()
  })

  describe('Bug Prevention & Submission Status Determination', () => {
    it('1. 全班有人交但本人未交（Bug 专项防御）：未逾期时必须判定为 unsubmitted，绝不能误判为 submitted', async () => {
      const futureDdl = new Date(Date.now() + 86400 * 1000 * 5).toISOString()

      const mockSes = {
        fetch: vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/users/self/favorites/courses')) {
            return {
              ok: true,
              json: async () => [{ id: 101, name: '软件工程基础', course_code: 'SE101' }]
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
                  id: 9001,
                  name: 'Lab 1 - Git Workflow',
                  due_at: futureDdl,
                  // 关键：全班有人交了，Canvas assignments API 会返回 has_submitted_submissions: true
                  has_submitted_submissions: true,
                  // 但当前登录学生本人未交
                  submission: {
                    workflow_state: 'unsubmitted',
                    submitted_at: null,
                    attempt: null
                  }
                }
              ]
            }
          }
          return { ok: false, status: 404 }
        })
      } as any

      const results = await fetchCanvasUpcomingDeadlines(mockSes)
      expect(results).toHaveLength(1)
      const item = results[0]
      expect(item.id).toBe('canvas-ddl-9001')
      expect(item.title).toBe('Lab 1 - Git Workflow')
      // 核心断言：绝对不能是 submitted！
      expect(item.submissionStatus).toBe('unsubmitted')
      expect(item.submissionStatus).not.toBe('submitted')
    })

    it('2. 全班有人交且本人逾期未交（Bug 专项防御 2）：已逾期必须准确判定为 missing，绝不能误判为 submitted', async () => {
      const pastDdl = new Date(Date.now() - 86400 * 1000 * 3).toISOString()

      const mockSes = {
        fetch: vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/users/self/favorites/courses')) {
            return {
              ok: true,
              json: async () => [{ id: 101, name: '软件工程基础', course_code: 'SE101' }]
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
                  id: 9002,
                  name: 'Lab 0 - Environment Setup (Overdue)',
                  due_at: pastDdl,
                  has_submitted_submissions: true, // 全班很多同学已交
                  submission: {
                    workflow_state: 'unsubmitted',
                    submitted_at: null,
                    attempt: null
                  }
                }
              ]
            }
          }
          return { ok: false, status: 404 }
        })
      } as any

      const results = await fetchCanvasUpcomingDeadlines(mockSes)
      expect(results).toHaveLength(1)
      const item = results[0]
      expect(item.id).toBe('canvas-ddl-9002')
      // 核心断言：逾期未交判定为 missing，绝对不能是 submitted 或 unsubmitted！
      expect(item.submissionStatus).toBe('missing')
      expect(item.submissionStatus).not.toBe('submitted')
      expect(item.submissionStatus).not.toBe('unsubmitted')
    })

    it('3. 本人已交未批改：返回 submitted 状态', async () => {
      const futureDdl = new Date(Date.now() + 86400 * 1000 * 2).toISOString()

      const mockSes = {
        fetch: vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/users/self/favorites/courses')) {
            return {
              ok: true,
              json: async () => [{ id: 101, name: '离散数学', course_code: 'CS101' }]
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
                  id: 9003,
                  name: 'Homework 3: Graph Theory',
                  due_at: futureDdl,
                  submission: {
                    workflow_state: 'submitted',
                    submitted_at: '2026-10-12T12:00:00Z',
                    attempt: 1
                  }
                }
              ]
            }
          }
          return { ok: false, status: 404 }
        })
      } as any

      const results = await fetchCanvasUpcomingDeadlines(mockSes)
      expect(results).toHaveLength(1)
      const item = results[0]
      expect(item.id).toBe('canvas-ddl-9003')
      expect(item.submissionStatus).toBe('submitted')
    })

    it('4. 本人已批改：返回 graded 状态，并正确附带得分与满分信息', async () => {
      const pastDdl = new Date(Date.now() - 86400 * 1000 * 7).toISOString()

      const mockSes = {
        fetch: vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/users/self/favorites/courses')) {
            return {
              ok: true,
              json: async () => [{ id: 101, name: '数据结构', course_code: 'CS102' }]
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
                  id: 9004,
                  name: 'Project 1: Red-Black Tree',
                  due_at: pastDdl,
                  points_possible: 10,
                  submission: {
                    workflow_state: 'graded',
                    score: 9.5,
                    grade: '9.5',
                    attempt: 1,
                    submitted_at: '2026-10-05T10:00:00Z'
                  }
                }
              ]
            }
          }
          return { ok: false, status: 404 }
        })
      } as any

      const results = await fetchCanvasUpcomingDeadlines(mockSes)
      expect(results).toHaveLength(1)
      const item = results[0]
      expect(item.id).toBe('canvas-ddl-9004')
      expect(item.submissionStatus).toBe('graded')
      expect(item.score).toBe(9.5)
      expect(item.pointsPossible).toBe(10)
    })
  })

  describe('Dual-Track Lock Deadline Inheritance (大学物理类作业)', () => {
    it('5. 大学物理类课程（无 due_at，仅设 lock_at）双轨继承：准确将 lock_at 继承为截止时间并标记 isLockAtDeadline = true', async () => {
      const lockIso = '2026-10-21T02:00:00Z'
      const lockDate = new Date(lockIso)
      const pad = (n: number) => String(n).padStart(2, '0')
      const expectedTime = `${lockDate.getFullYear()}-${pad(lockDate.getMonth() + 1)}-${pad(lockDate.getDate())} ${pad(lockDate.getHours())}:${pad(lockDate.getMinutes())}`

      const mockSes = {
        fetch: vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/users/self/favorites/courses')) {
            return {
              ok: true,
              json: async () => [{ id: 201, name: '大学物理(A)(1)', course_code: 'PHYS1001' }]
            }
          }
          if (url.includes('/courses?enrollment_state=active')) {
            return { ok: true, json: async () => [] }
          }
          if (url.includes('/courses/201/assignments')) {
            return {
              ok: true,
              json: async () => [
                {
                  id: 9005,
                  name: '大学物理实验五：光电效应（仅锁定时间）',
                  due_at: null,
                  lock_at: lockIso,
                  points_possible: 100,
                  submission: null
                }
              ]
            }
          }
          return { ok: false, status: 404 }
        })
      } as any

      const results = await fetchCanvasUpcomingDeadlines(mockSes)
      expect(results).toHaveLength(1)
      const item = results[0]
      expect(item.id).toBe('canvas-ddl-9005')
      expect(item.title).toBe('大学物理实验五：光电效应（仅锁定时间）')
      expect(item.isLockAtDeadline).toBe(true)
      expect(item.startTime).toBe(expectedTime)
      expect(item.endTime).toBe(expectedTime)
      expect(item.pointsPossible).toBe(100)
    })
  })

  describe('Course Merging & Deduplication', () => {
    it('6. 全课程去重合并（收藏夹 [A, B] + 活跃课程 [B, C]）：精确覆盖 [A, B, C]，且重复的 B 课程仅请求一次', async () => {
      const requestedUrls: string[] = []

      const mockSes = {
        fetch: vi.fn().mockImplementation(async (url: string) => {
          requestedUrls.push(url)
          if (url.includes('/users/self/favorites/courses')) {
            return {
              ok: true,
              json: async () => [
                { id: 1001, name: '课程 A (高等数学)', course_code: 'MATH1001' },
                { id: 1002, name: '课程 B (大学化学)', course_code: 'CHEM1001' }
              ]
            }
          }
          if (url.includes('/courses?enrollment_state=active')) {
            return {
              ok: true,
              json: async () => [
                { id: 1002, name: '课程 B (大学化学)', course_code: 'CHEM1001' }, // 重复项
                { id: 1003, name: '课程 C (大学物理 - 未星标)', course_code: 'PHYS1002' } // 新增未星标课程
              ]
            }
          }
          if (url.includes('/courses/1001/assignments')) {
            return {
              ok: true,
              json: async () => [
                { id: 8001, name: '高数第 5 周习题', due_at: '2026-11-01T12:00:00Z' }
              ]
            }
          }
          if (url.includes('/courses/1002/assignments')) {
            return {
              ok: true,
              json: async () => [
                { id: 8002, name: '化学实验报告 2', due_at: '2026-11-02T12:00:00Z' }
              ]
            }
          }
          if (url.includes('/courses/1003/assignments')) {
            return {
              ok: true,
              json: async () => [
                { id: 8003, name: '大物思考题', lock_at: '2026-11-03T12:00:00Z' }
              ]
            }
          }
          return { ok: false, status: 404 }
        })
      } as any

      const results = await fetchCanvasUpcomingDeadlines(mockSes)

      // 断言返回全部 3 门课程的作业
      expect(results).toHaveLength(3)
      const courseNames = results.map(r => r.courseName)
      expect(courseNames).toContain('课程 A (高等数学)')
      expect(courseNames).toContain('课程 B (大学化学)')
      expect(courseNames).toContain('课程 C (大学物理 - 未星标)')

      // 验证网络请求去重：课程 1002 对应的 assignment 接口仅被调用 1 次
      const assignmentsUrls = requestedUrls.filter(u => u.includes('/assignments?include[]=submission'))
      expect(assignmentsUrls).toHaveLength(3)
      expect(assignmentsUrls.filter(u => u.includes('/courses/1001/assignments'))).toHaveLength(1)
      expect(assignmentsUrls.filter(u => u.includes('/courses/1002/assignments'))).toHaveLength(1)
      expect(assignmentsUrls.filter(u => u.includes('/courses/1003/assignments'))).toHaveLength(1)
    })
  })

  describe('Edge Cases & Fallback Mode', () => {
    it('handles student who submitted after deadline: status remains submitted, never missing', async () => {
      const pastDdl = new Date(Date.now() - 86400 * 1000 * 2).toISOString()

      const mockSes = {
        fetch: vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/users/self/favorites/courses')) {
            return {
              ok: true,
              json: async () => [{ id: 101, name: '计算方法', course_code: 'MATH2001' }]
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
                  id: 9010,
                  name: '迟交实验报告',
                  due_at: pastDdl,
                  submission: {
                    workflow_state: 'submitted',
                    submitted_at: '2026-10-18T12:00:00Z',
                    late: true,
                    attempt: 1
                  }
                }
              ]
            }
          }
          return { ok: false, status: 404 }
        })
      } as any

      const results = await fetchCanvasUpcomingDeadlines(mockSes)
      expect(results).toHaveLength(1)
      expect(results[0].submissionStatus).toBe('submitted')
    })

    it('handles explicit missing: true flag even if due_at is in the future', async () => {
      const futureDdl = new Date(Date.now() + 86400 * 1000 * 3).toISOString()

      const mockSes = {
        fetch: vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/users/self/favorites/courses')) {
            return {
              ok: true,
              json: async () => [{ id: 101, name: '专业英语', course_code: 'ENG1001' }]
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
                  id: 9011,
                  name: 'Quiz 1',
                  due_at: futureDdl,
                  submission: {
                    workflow_state: 'unsubmitted',
                    missing: true
                  }
                }
              ]
            }
          }
          return { ok: false, status: 404 }
        })
      } as any

      const results = await fetchCanvasUpcomingDeadlines(mockSes)
      expect(results).toHaveLength(1)
      expect(results[0].submissionStatus).toBe('missing')
    })

    it('fallback upcoming_events retains bug defense against has_submitted_submissions', async () => {
      const futureDdl = new Date(Date.now() + 86400 * 1000 * 5).toISOString()

      const mockSes = {
        fetch: vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/users/self/favorites/courses') || url.includes('/courses?enrollment_state=active')) {
            return { ok: true, json: async () => [] } // 空课程触发 fallback
          }
          if (url.includes('/users/self/upcoming_events')) {
            return {
              ok: true,
              json: async () => [
                {
                  id: 9020,
                  title: 'Fallback Assignment',
                  due_at: futureDdl,
                  context_name: 'Fallback Course',
                  assignment: {
                    has_submitted_submissions: true,
                    submission: {
                      workflow_state: 'unsubmitted',
                      submitted_at: null,
                      attempt: null
                    }
                  }
                }
              ]
            }
          }
          return { ok: false, status: 404 }
        })
      } as any

      const results = await fetchCanvasUpcomingDeadlines(mockSes)
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('canvas-ddl-9020')
      expect(results[0].submissionStatus).toBe('unsubmitted')
      expect(results[0].submissionStatus).not.toBe('submitted')
    })
  })
})
