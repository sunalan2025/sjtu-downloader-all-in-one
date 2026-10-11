import { describe, it, expect, vi } from 'vitest'

// Mock Electron before importing orchestrator
vi.mock('electron', () => ({
  BrowserWindow: class {
    loadURL = vi.fn().mockResolvedValue(undefined)
    webContents = { getURL: () => 'https://oc.sjtu.edu.cn' }
    destroy = vi.fn()
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  }
}))

import { groupCoursesByTerm, sortAcademicTerms } from '../../src/shared/utils'
import { extractCanvasFileIds, isForbiddenError, CanvasApiError, listCourses } from '../../src/main/canvas/api'
import { scanCourse } from '../../src/main/canvas/orchestrator'
import type Electron from 'electron'

describe('Canvas LMS Scanning Logic & Term Grouping Adversarial Stress Suite', () => {

  // =========================================================================
  // Section 1: sortAcademicTerms and groupCoursesByTerm (R2-F1)
  // =========================================================================
  describe('Section 1: sortAcademicTerms and groupCoursesByTerm Stress Testing', () => {

    describe('1.1 groupCoursesByTerm Edge Cases & Adversarial Inputs', () => {
      it('handles empty course list cleanly', () => {
        const res = groupCoursesByTerm([])
        expect(res).toEqual({})
      })

      it('correctly groups courses with standard string terms', () => {
        const courses = [
          { id: 1, name: '课A', term: '2025-2026-1' },
          { id: 2, name: '课B', term: '2025-2026-1' },
          { id: 3, name: '课C', term: '2024-2025-2' }
        ]
        const res = groupCoursesByTerm(courses)
        expect(Object.keys(res)).toEqual(['2025-2026-1', '2024-2025-2'])
        expect(res['2025-2026-1']).toHaveLength(2)
        expect(res['2024-2025-2']).toHaveLength(1)
      })

      it('correctly groups courses with object terms (Canvas raw API style)', () => {
        const courses = [
          { id: 1, name: '课A', term: { name: '2025-2026-1' } },
          { id: 2, name: '课B', term: { name: '2025-2026-2' } }
        ]
        const res = groupCoursesByTerm(courses)
        expect(res['2025-2026-1']).toBeDefined()
        expect(res['2025-2026-2']).toBeDefined()
      })

      it('groups null, undefined, empty string, whitespace-only terms to "(无学期)"', () => {
        const courses = [
          { id: 1, name: '课1', term: null },
          { id: 2, name: '课2', term: undefined },
          { id: 3, name: '课3', term: '' },
          { id: 4, name: '课4', term: '   ' },
          { id: 5, name: '课5', term: { name: '' } },
          { id: 6, name: '课6', term: { name: '   ' } },
          { id: 7, name: '课7', term: { name: undefined } },
          { id: 8, name: '课8', term: {} as any },
          { id: 9, name: '课9' } // missing term property
        ]
        const res = groupCoursesByTerm(courses)
        expect(Object.keys(res)).toEqual(['(无学期)'])
        expect(res['(无学期)']).toHaveLength(9)
      })

      it('handles unexpected non-standard types gracefully without throwing', () => {
        const courses = [
          { id: 1, name: '课1', term: 12345 as any },
          { id: 2, name: '课2', term: true as any },
          { id: 3, name: '课3', term: ['2025-2026-1'] as any },
          { id: 4, name: '课4', term: { name: 123 } as any }
        ]
        const res = groupCoursesByTerm(courses)
        expect(res['(无学期)']).toBeDefined()
        expect(res['(无学期)']).toHaveLength(4)
      })

      it('trims leading and trailing whitespace from term names', () => {
        const courses = [
          { id: 1, name: '课1', term: '  2025-2026-1  ' },
          { id: 2, name: '课2', term: { name: '  2025-2026-1\t' } }
        ]
        const res = groupCoursesByTerm(courses)
        expect(Object.keys(res)).toEqual(['2025-2026-1'])
        expect(res['2025-2026-1']).toHaveLength(2)
      })
    })

    describe('1.2 sortAcademicTerms Edge Cases & Ordering', () => {
      it('handles empty and single-element arrays', () => {
        expect(sortAcademicTerms([])).toEqual([])
        expect(sortAcademicTerms(['2025-2026-1'])).toEqual(['2025-2026-1'])
        expect(sortAcademicTerms(['(无学期)'])).toEqual(['(无学期)'])
      })

      it('sorts standard academic terms in descending order (newest first)', () => {
        const input = ['2023-2024-2', '2025-2026-1', '2024-2025-1', '2025-2026-2', '2024-2025-2']
        const expected = ['2025-2026-2', '2025-2026-1', '2024-2025-2', '2024-2025-1', '2023-2024-2']
        expect(sortAcademicTerms(input)).toEqual(expected)
      })

      it('ALWAYS places "(无学期)" at the very end regardless of initial position', () => {
        const input1 = ['(无学期)', '2025-2026-1', '2024-2025-2']
        const input2 = ['2024-2025-2', '(无学期)', '2025-2026-1']
        const input3 = ['2025-2026-1', '2024-2025-2', '(无学期)']

        const expected = ['2025-2026-1', '2024-2025-2', '(无学期)']
        expect(sortAcademicTerms(input1)).toEqual(expected)
        expect(sortAcademicTerms(input2)).toEqual(expected)
        expect(sortAcademicTerms(input3)).toEqual(expected)
      })

      it('handles multiple "(无学期)" elements placing all of them at the end', () => {
        const input = ['(无学期)', '2025-2026-1', '(无学期)', '2024-2025-2']
        const sorted = sortAcademicTerms(input)
        expect(sorted.slice(0, 2)).toEqual(['2025-2026-1', '2024-2025-2'])
        expect(sorted.slice(2)).toEqual(['(无学期)', '(无学期)'])
      })

      it('correctly performs natural numeric sorting (e.g. 10 > 2)', () => {
        const input = ['2024-2025-2', '2024-2025-10', '2024-2025-1']
        const sorted = sortAcademicTerms(input)
        expect(sorted).toEqual(['2024-2025-10', '2024-2025-2', '2024-2025-1'])
      })

      it('does not mutate the original input array', () => {
        const original = ['2024-2025-1', '2025-2026-1']
        const copy = [...original]
        sortAcademicTerms(original)
        expect(original).toEqual(copy)
      })

      it('handles Chinese semester names in descending chronological order', () => {
        const input = ['2023-2024学年春季学期', '2024-2025学年秋季学期', '2024-2025学年春季学期']
        const sorted = sortAcademicTerms(input)
        expect(sorted[0]).toContain('2024-2025')
        expect(sorted[sorted.length - 1]).toContain('2023-2024')
      })
    })
  })

  // =========================================================================
  // Section 2: Syllabus HTML link extraction (extractCanvasFileIds) & Errors
  // =========================================================================
  describe('Section 2: extractCanvasFileIds & isForbiddenError Stress Testing', () => {

    it('extracts file IDs from varied standard Canvas HTML links', () => {
      const html = `
        <p>下载课件：<a href="/courses/101/files/5001">课件1</a></p>
        <p>下载附件：<a href="/files/5002/download?download_frd=1">课件2</a></p>
        <p>API直链：<a href="/api/v1/courses/101/files/5003">课件3</a></p>
        <p>短路径：<a href="/api/v1/files/5004">课件4</a></p>
      `
      const ids = extractCanvasFileIds(html)
      expect(ids).toEqual([5001, 5002, 5003, 5004])
    })

    it('deduplicates identical file IDs in syllabus HTML', () => {
      const html = `
        <a href="/courses/101/files/5001">链接1</a>
        <a href="/files/5001/download">链接2</a>
        <a href="/courses/101/files/5001">链接3</a>
      `
      const ids = extractCanvasFileIds(html)
      expect(ids).toEqual([5001])
    })

    it('handles empty, null, or link-less HTML gracefully', () => {
      expect(extractCanvasFileIds('')).toEqual([])
      expect(extractCanvasFileIds('   ')).toEqual([])
      expect(extractCanvasFileIds('<div>这是纯文本介绍，没有附带任何课件文件</div>')).toEqual([])
      expect(extractCanvasFileIds('<a href="https://example.com/other">外部链接</a>')).toEqual([])
    })

    it('ignores malformed links (no id, non-numeric id, empty path)', () => {
      const html = `
        <a href="/files/">无ID</a>
        <a href="/files/abc">非数字</a>
        <a href="/files//download">连续斜杠</a>
        <a href="/courses/files/">缺失课程ID</a>
      `
      const ids = extractCanvasFileIds(html)
      expect(ids).toEqual([])
    })

    it('handles adversarial inputs (unclosed tags, script tags, massive text)', () => {
      const html = `
        <script>alert('/files/999')</script>
        <div data-url="/files/1000">未闭合标签
        <a href="/files/1001
        <img src="/courses/1/files/1002" />
      `
      const ids = extractCanvasFileIds(html)
      expect(ids).toContain(999)
      expect(ids).toContain(1000)
      expect(ids).toContain(1002)
    })

    it('isForbiddenError correctly detects 403 status across formats', () => {
      expect(isForbiddenError(new CanvasApiError(403, 'Forbidden'))).toBe(true)
      expect(isForbiddenError({ status: 403 })).toBe(true)
      expect(isForbiddenError(new Error('Canvas API 403: Forbidden'))).toBe(true)
      expect(isForbiddenError(new Error('HTTP 403'))).toBe(true)
      expect(isForbiddenError('403 Forbidden')).toBe(true)

      // Other errors must NOT be detected as forbidden
      expect(isForbiddenError(new CanvasApiError(401, 'Unauthorized'))).toBe(false)
      expect(isForbiddenError(new CanvasApiError(404, 'Not Found'))).toBe(false)
      expect(isForbiddenError(new CanvasApiError(500, 'Server Error'))).toBe(false)
      expect(isForbiddenError({ status: 401 })).toBe(false)
      expect(isForbiddenError(new Error('Network disconnected'))).toBe(false)
    })
  })

  // =========================================================================
  // Section 3: scanCourse Comprehensive Adversarial Stress Testing (R2-F2)
  // =========================================================================
  describe('Section 3: scanCourse Adversarial Stress Testing', () => {

    function createMockSession(router: (url: string) => { status: number; body: any; headers?: Record<string, string> }) {
      return {
        fetch: async (url: string) => {
          const res = router(url)
          return new Response(JSON.stringify(res.body), {
            status: res.status,
            headers: {
              'Content-Type': 'application/json',
              ...res.headers
            }
          })
        }
      } as unknown as Electron.Session
    }

    it('Stress 3.1: Only /files is 403 Forbidden; /folders, /modules, /syllabus succeed', async () => {
      const mockSession = createMockSession(url => {
        if (url.includes('/files?per_page=100')) {
          return { status: 403, body: { message: 'Forbidden: Files tab disabled by instructor' } }
        }
        if (url.includes('/folders?per_page=100')) {
          return {
            status: 200,
            body: [
              { id: 10, full_name: 'course files/讲义', name: '讲义' },
              { id: 20, full_name: 'course files/作业', name: '作业' }
            ]
          }
        }
        if (url.includes('/modules?per_page=100')) {
          return {
            status: 200,
            body: [{ id: 100, name: '第一周 绪论' }]
          }
        }
        if (url.includes('/modules/100/items?per_page=100')) {
          return {
            status: 200,
            body: [
              { id: 201, type: 'File', content_id: 3001, title: '绪论课件.pdf' }
            ]
          }
        }
        if (url.includes('/courses/12345?include[]=syllabus_body')) {
          return {
            status: 200,
            body: {
              syllabus_body: '<p>教学大纲：<a href="/files/4001/download">大纲附件.docx</a></p>'
            }
          }
        }
        if (url.includes('/files/3001')) {
          return {
            status: 200,
            body: { id: 3001, display_name: '绪论课件.pdf', size: 1024, url: 'https://oc.sjtu.edu.cn/files/3001/download', folder_id: 10 }
          }
        }
        if (url.includes('/files/4001')) {
          return {
            status: 200,
            body: { id: 4001, display_name: '大纲附件.docx', size: 2048, url: 'https://oc.sjtu.edu.cn/files/4001/download', folder_id: null }
          }
        }
        return { status: 404, body: {} }
      })

      const res = await scanCourse(mockSession, 12345)

      expect(res.ok).toBe(true)
      expect(res.filesTabAccessible).toBe(false)
      expect(res.files).toEqual([])
      expect(res.warning).toContain('教师已禁用文件列表')
      expect(res.folderMap[10]).toBe('讲义')
      expect(res.folderMap[20]).toBe('作业')
      expect(res.moduleFiles).toHaveLength(1)
      expect(res.moduleFiles[0].fileId).toBe(3001)
      expect(res.moduleFiles[0].displayName).toBe('绪论课件.pdf')
      expect(res.syllabusFiles).toHaveLength(1)
      expect(res.syllabusFiles[0].fileId).toBe(4001)
      expect(res.syllabusFiles[0].displayName).toBe('大纲附件.docx')
    })

    it('Stress 3.2: Both /files and /folders are 403 Forbidden', async () => {
      const mockSession = createMockSession(url => {
        if (url.includes('/files?per_page=100') || url.includes('/folders?per_page=100')) {
          return { status: 403, body: { message: 'Forbidden' } }
        }
        if (url.includes('/modules?per_page=100')) {
          return {
            status: 200,
            body: [{ id: 100, name: 'Module 1' }]
          }
        }
        if (url.includes('/modules/100/items?per_page=100')) {
          return {
            status: 200,
            body: [{ id: 201, type: 'File', content_id: 3001, title: '课件.pdf' }]
          }
        }
        if (url.includes('/courses/12345?include[]=syllabus_body')) {
          return {
            status: 200,
            body: { syllabus_body: '<p><a href="/files/4001/download">大纲.pdf</a></p>' }
          }
        }
        if (url.includes('/files/3001')) {
          return {
            status: 200,
            body: { id: 3001, display_name: '课件.pdf', size: 1024, url: 'https://oc.sjtu.edu.cn/files/3001/download' }
          }
        }
        if (url.includes('/files/4001')) {
          return {
            status: 200,
            body: { id: 4001, display_name: '大纲.pdf', size: 2048, url: 'https://oc.sjtu.edu.cn/files/4001/download' }
          }
        }
        return { status: 404, body: {} }
      })

      const res = await scanCourse(mockSession, 12345)

      expect(res.ok).toBe(true)
      expect(res.filesTabAccessible).toBe(false)
      expect(res.files).toEqual([])
      expect(res.folderMap).toEqual({})
      expect(res.warning).toContain('教师已禁用文件列表')
      expect(res.moduleFiles).toHaveLength(1)
      expect(res.syllabusFiles).toHaveLength(1)
    })

    it('Stress 3.3: /modules is completely empty or contains non-file items', async () => {
      const mockSession = createMockSession(url => {
        if (url.includes('/files?per_page=100')) {
          return { status: 403, body: { message: 'Forbidden' } }
        }
        if (url.includes('/folders?per_page=100')) {
          return { status: 403, body: { message: 'Forbidden' } }
        }
        if (url.includes('/modules?per_page=100')) {
          return {
            status: 200,
            body: [
              { id: 1, name: '空模块' },
              { id: 2, name: '仅作业和讨论的模块' }
            ]
          }
        }
        if (url.includes('/modules/1/items?per_page=100')) {
          return { status: 200, body: [] }
        }
        if (url.includes('/modules/2/items?per_page=100')) {
          return {
            status: 200,
            body: [
              { id: 10, type: 'SubHeader', title: '章节标题' },
              { id: 11, type: 'Assignment', content_id: 99, title: '作业1' },
              { id: 12, type: 'Discussion', content_id: 88, title: '讨论1' },
              { id: 13, type: 'File', content_id: null, title: '空contentId文件' }
            ]
          }
        }
        if (url.includes('/courses/12345?include[]=syllabus_body')) {
          return { status: 200, body: { syllabus_body: '' } }
        }
        return { status: 404, body: {} }
      })

      const res = await scanCourse(mockSession, 12345)

      expect(res.ok).toBe(true)
      expect(res.filesTabAccessible).toBe(false)
      expect(res.moduleFiles).toEqual([])
      expect(res.syllabusFiles).toEqual([])
    })

    it('Stress 3.4: Syllabus has malformed HTML links, null/empty body', async () => {
      const mockSession = createMockSession(url => {
        if (url.includes('/files?per_page=100')) {
          return { status: 403, body: { message: 'Forbidden' } }
        }
        if (url.includes('/folders?per_page=100')) {
          return { status: 403, body: { message: 'Forbidden' } }
        }
        if (url.includes('/modules?per_page=100')) {
          return { status: 200, body: [] }
        }
        if (url.includes('/courses/12345?include[]=syllabus_body')) {
          return {
            status: 200,
            body: {
              syllabus_body: `
                <div>欢迎来到本课程！</div>
                <a href="/files/">破损链接1</a>
                <a href="/files/not-a-number">破损链接2</a>
                <a href="/files/7777/download">有效链接1</a>
                <a href="/courses/12345/files/7777">重复有效链接1</a>
                <script>document.write('/files/8888')</script>
              `
            }
          }
        }
        if (url.includes('/files/7777')) {
          return {
            status: 200,
            body: { id: 7777, display_name: '大纲.pdf', size: 1024, url: 'https://oc.sjtu.edu.cn/files/7777/download' }
          }
        }
        if (url.includes('/files/8888')) {
          return {
            status: 200,
            body: { id: 8888, display_name: '注入.pdf', size: 1024, url: 'https://oc.sjtu.edu.cn/files/8888/download' }
          }
        }
        return { status: 404, body: {} }
      })

      const res = await scanCourse(mockSession, 12345)

      expect(res.ok).toBe(true)
      expect(res.syllabusFiles.length).toBeGreaterThanOrEqual(1)
      const ids = res.syllabusFiles.map(f => f.fileId)
      expect(ids).toContain(7777)
    })

    it('Stress 3.5: HTTP 401 Unauthorized MUST propagate error, NOT suppress or pretend 403', async () => {
      const mockSession = createMockSession(url => {
        if (url.includes('/files?per_page=100')) {
          return { status: 401, body: { status: 'unauthenticated', errors: [{ message: 'user not logged in' }] } }
        }
        return { status: 200, body: [] }
      })

      const res = await scanCourse(mockSession, 12345)

      // Critical requirement: 401 must propagate error, NOT suppress!
      expect(res.ok).toBe(false)
      expect(res.filesTabAccessible).toBe(false)
      expect(res.error).toBeDefined()
      expect(res.error).toMatch(/401|Canvas API 401/)
      expect(res.warning).toBeUndefined()
    })

    it('Stress 3.6: HTTP 500 Server Error on /files propagates error', async () => {
      const mockSession = createMockSession(url => {
        if (url.includes('/files?per_page=100')) {
          return { status: 500, body: { message: 'Internal Server Error' } }
        }
        return { status: 200, body: [] }
      })

      const res = await scanCourse(mockSession, 12345)

      expect(res.ok).toBe(false)
      expect(res.error).toBeDefined()
      expect(res.error).toMatch(/500|Canvas API 500/)
    })

    it('Stress 3.7: Network disconnection / fetch throw propagates error cleanly', async () => {
      const mockSession = {
        fetch: async () => {
          throw new Error('ERR_CONNECTION_REFUSED: failed to connect to oc.sjtu.edu.cn')
        }
      } as unknown as Electron.Session

      const res = await scanCourse(mockSession, 12345)

      expect(res.ok).toBe(false)
      expect(res.error).toContain('ERR_CONNECTION_REFUSED')
    })

    it('Stress 3.8: Complete happy path with cross-source deduplication', async () => {
      const mockSession = createMockSession(url => {
        if (url.includes('/files?per_page=100')) {
          return {
            status: 200,
            body: [
              { id: 9999, display_name: '已在Files中的课件.pdf', size: 1024, url: 'https://oc.sjtu.edu.cn/f/9999', folder_id: 1 }
            ]
          }
        }
        if (url.includes('/folders?per_page=100')) {
          return { status: 200, body: [{ id: 1, full_name: 'course files/讲义' }] }
        }
        if (url.includes('/modules?per_page=100')) {
          return { status: 200, body: [{ id: 1, name: 'M1' }] }
        }
        if (url.includes('/modules/1/items?per_page=100')) {
          return {
            status: 200,
            body: [
              { id: 10, type: 'File', content_id: 9999, title: '已在Files中的课件.pdf' },
              { id: 11, type: 'File', content_id: 8888, title: '仅在Module的课件.pdf' }
            ]
          }
        }
        if (url.includes('/courses/12345?include[]=syllabus_body')) {
          return {
            status: 200,
            body: {
              syllabus_body: '<a href="/files/9999">f1</a><a href="/files/8888">f2</a><a href="/files/7777">f3</a>'
            }
          }
        }
        if (url.includes('/files/8888')) {
          return {
            status: 200,
            body: { id: 8888, display_name: '仅在Module的课件.pdf', size: 1024, url: 'https://oc.sjtu.edu.cn/f/8888', folder_id: 1 }
          }
        }
        if (url.includes('/files/7777')) {
          return {
            status: 200,
            body: { id: 7777, display_name: '仅在Syllabus的课件.pdf', size: 1024, url: 'https://oc.sjtu.edu.cn/f/7777', folder_id: null }
          }
        }
        return { status: 404, body: {} }
      })

      const res = await scanCourse(mockSession, 12345)

      expect(res.ok).toBe(true)
      expect(res.filesTabAccessible).toBe(true)
      expect(res.files).toHaveLength(1)
      expect(res.files[0].fileId).toBe(9999)

      expect(res.moduleFiles).toHaveLength(1)
      expect(res.moduleFiles[0].fileId).toBe(8888)

      expect(res.syllabusFiles).toHaveLength(1)
      expect(res.syllabusFiles[0].fileId).toBe(7777)
    })
  })

  // =========================================================================
  // Section 4: listCourses, Concluded State & End-to-End Pipeline
  // =========================================================================
  describe('Section 4: listCourses Parsing & End-to-End Pipeline', () => {
    it('listCourses includes concluded state query when includeCompleted=true', async () => {
      let requestedUrl = ''
      const mockSession = {
        fetch: async (url: string) => {
          requestedUrl = url
          return new Response(JSON.stringify([
            {
              id: 101,
              name: '高等数学 (当前在修)',
              course_code: 'MATH101',
              term: { name: '2025-2026-1' },
              enrollments: [{ enrollment_state: 'active' }],
              teachers: [{ display_name: '张教授' }]
            },
            {
              id: 102,
              name: '大学物理 (已归档历史结课)',
              course_code: 'PHYS101',
              term: { name: '2024-2025-2' },
              enrollments: [{ enrollment_state: 'concluded' }],
              teachers: [{ display_name: '李教授' }]
            },
            {
              id: 103,
              name: '受限课程',
              access_restricted_by_date: true
            }
          ]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        }
      } as unknown as Electron.Session

      const courses = await listCourses(mockSession, true)

      // Query param verification
      expect(requestedUrl).toContain('enrollment_state[]=concluded')
      expect(requestedUrl).toContain('enrollment_state[]=active')
      expect(requestedUrl).toContain('enrollment_state[]=completed')

      // Parsing verification
      expect(courses).toHaveLength(2)
      expect(courses[0].enrollmentState).toBe('active')
      expect(courses[1].enrollmentState).toBe('concluded')
      expect(courses[1].name).toBe('大学物理 (已归档历史结课)')

      // End-to-end integration: feed into groupCoursesByTerm and sortAcademicTerms
      const grouped = groupCoursesByTerm(courses)
      const sortedTerms = sortAcademicTerms(Object.keys(grouped))

      expect(sortedTerms).toEqual(['2025-2026-1', '2024-2025-2'])
      expect(grouped['2025-2026-1'][0].courseId).toBe(101)
      expect(grouped['2024-2025-2'][0].courseId).toBe(102)
    })

    it('listCourses restricts to active only when includeCompleted=false', async () => {
      let requestedUrl = ''
      const mockSession = {
        fetch: async (url: string) => {
          requestedUrl = url
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        }
      } as unknown as Electron.Session

      await listCourses(mockSession, false)

      expect(requestedUrl).toContain('enrollment_state[]=active')
      expect(requestedUrl).not.toContain('concluded')
    })
  })
})
