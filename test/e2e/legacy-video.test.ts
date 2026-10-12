import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockWebContents, mockDestroy, state } = vi.hoisted(() => {
  const mockWebContents = {
    listeners: {} as Record<string, Array<(...args: any[]) => void>>,
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (!mockWebContents.listeners[event]) mockWebContents.listeners[event] = []
      mockWebContents.listeners[event].push(cb)
    }),
    getURL: vi.fn().mockReturnValue('https://oc.sjtu.edu.cn/courses/89673/external_tools/18717'),
    executeJavaScript: vi.fn().mockResolvedValue(true),
    setAudioMuted: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false)
  }
  const mockDestroy = vi.fn()
  const state = {
    mockLoadUrlBehavior: null as ((url: string) => Promise<void>) | null
  }
  return { mockWebContents, mockDestroy, state }
})

vi.mock('electron', () => {
  return {
    BrowserWindow: class MockBrowserWindow {
      loadURL = vi.fn().mockImplementation(async (url: string) => {
        if (state.mockLoadUrlBehavior) {
          return state.mockLoadUrlBehavior(url)
        }
        return undefined
      })
      webContents = mockWebContents
      destroy = mockDestroy
      isDestroyed = vi.fn().mockReturnValue(false)
    }
  }
})

import {
  extractLegacyLtiToken,
  fetchLegacyVodVideoList,
  fetchLegacyVodStreamUrls
} from '../../src/main/canvas/legacy-video'

describe('Legacy Video Protocol (courses.sjtu.edu.cn) Client Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWebContents.listeners = {}
    mockWebContents.getURL.mockReturnValue('https://oc.sjtu.edu.cn/courses/89673/external_tools/18717')
    mockWebContents.executeJavaScript.mockReset().mockResolvedValue(true)
    state.mockLoadUrlBehavior = null
  })

  // =========================================================================
  // 1. fetchLegacyVodVideoList
  // =========================================================================
  describe('fetchLegacyVodVideoList', () => {
    it('converts body.list correctly into CanvasVideoSession records', async () => {
      const mockResponse = {
        code: 200,
        msg: 'success',
        body: {
          total: 2,
          list: [
            {
              id: 90001,
              videoId: 'legacy_vid_1',
              userName: '李老师',
              classroomName: '下院101',
              courseBeginTime: '2025-09-10 08:00:00',
              courseEndTime: '2025-09-10 09:40:00',
              videoName: '离散数学(第1讲)'
            },
            {
              id: 90002,
              videoId: 'legacy_vid_2',
              userName: '李老师',
              classroomName: '下院101',
              courseBeginTime: '2025-09-17 08:00:00',
              courseEndTime: '2025-09-17 09:40:00',
              videoName: '离散数学(第2讲)'
            }
          ]
        }
      }

      let requestedUrl = ''
      let requestedOptions: any = null

      const mockSes = {
        fetch: vi.fn().mockImplementation(async (url: string, opts: any) => {
          requestedUrl = url
          requestedOptions = opts
          return {
            ok: true,
            status: 200,
            json: async () => mockResponse,
            text: async () => JSON.stringify(mockResponse)
          }
        })
      }

      const sessions = await fetchLegacyVodVideoList(mockSes as any, 'enc_course_xyz789')

      expect(requestedUrl).toBe('https://courses.sjtu.edu.cn/lti/vodVideo/findVodVideoList')
      expect(requestedOptions.method).toBe('POST')
      expect(requestedOptions.headers['Content-Type']).toContain('application/x-www-form-urlencoded')
      expect(requestedOptions.body).toContain('canvasCourseId=enc_course_xyz789')
      expect(requestedOptions.body).toContain('pageIndex=1')
      expect(requestedOptions.body).toContain('pageSize=1000')

      expect(sessions).toHaveLength(2)

      expect(sessions[0]).toEqual({
        videoId: 'legacy_vid_1',
        courId: 90001,
        teacher: '李老师',
        classroom: '下院101',
        beginTime: '2025-09-10 08:00:00',
        endTime: '2025-09-10 09:40:00',
        videoName: '离散数学(第1讲)',
        legacyCourseId: 'enc_course_xyz789',
        source: 'legacy'
      })

      expect(sessions[1]).toEqual({
        videoId: 'legacy_vid_2',
        courId: 90002,
        teacher: '李老师',
        classroom: '下院101',
        beginTime: '2025-09-17 08:00:00',
        endTime: '2025-09-17 09:40:00',
        videoName: '离散数学(第2讲)',
        legacyCourseId: 'enc_course_xyz789',
        source: 'legacy'
      })
    })

    it('gracefully returns empty array on 非云录播教室 response', async () => {
      const mockSes = {
        fetch: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            code: 400,
            msg: '该教室为非云录播教室，无在线录播数据'
          })
        })
      }

      const result = await fetchLegacyVodVideoList(mockSes as any, 'enc_course_empty')
      expect(result).toEqual([])
    })

    it('gracefully returns empty array on HTTP 400 Bad Request', async () => {
      const mockSes = {
        fetch: vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          json: async () => ({ code: 400, message: 'Invalid courseId' }),
          text: async () => 'Bad Request'
        })
      }

      const result = await fetchLegacyVodVideoList(mockSes as any, 'invalid_enc_id')
      expect(result).toEqual([])
    })

    it('gracefully returns empty array on network failure or exception', async () => {
      const mockSes = {
        fetch: vi.fn().mockRejectedValue(new Error('Network connection refused'))
      }

      const result = await fetchLegacyVodVideoList(mockSes as any, 'enc_offline')
      expect(result).toEqual([])
    })

    it('gracefully handles empty list response or null body', async () => {
      const mockSes = {
        fetch: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            code: 200,
            body: { list: [] }
          })
        })
      }

      const result = await fetchLegacyVodVideoList(mockSes as any, 'enc_empty_list')
      expect(result).toEqual([])
    })
  })

  // =========================================================================
  // 2. fetchLegacyVodStreamUrls
  // =========================================================================
  describe('fetchLegacyVodStreamUrls', () => {
    it('correctly maps cdviViewNum === 0 to teacherUrl and cdviViewNum === 3 to pptUrl', async () => {
      const mockResponse = {
        code: 200,
        msg: 'success',
        body: {
          videoPlayResponseVoList: [
            {
              cdviViewNum: 0,
              channelName: '教师',
              url: 'https://videos.sjtu.edu.cn/vod/teacher_view_high.mp4'
            },
            {
              cdviViewNum: 3,
              channelName: '电脑',
              url: 'https://videos.sjtu.edu.cn/vod/ppt_view_high.mp4'
            }
          ]
        }
      }

      let requestedUrl = ''
      let requestedOptions: any = null

      const mockSes = {
        fetch: vi.fn().mockImplementation(async (url: string, opts: any) => {
          requestedUrl = url
          requestedOptions = opts
          return {
            ok: true,
            status: 200,
            json: async () => mockResponse,
            text: async () => JSON.stringify(mockResponse)
          }
        })
      }

      const urls = await fetchLegacyVodStreamUrls(mockSes as any, 'vid_12345')

      expect(requestedUrl).toBe('https://courses.sjtu.edu.cn/lti/vodVideo/getVodVideoInfos')
      expect(requestedOptions.method).toBe('POST')
      expect(requestedOptions.headers['Content-Type']).toContain('application/x-www-form-urlencoded')
      expect(requestedOptions.body).toContain('playTypeHls=true')
      expect(requestedOptions.body).toContain('id=vid_12345')
      expect(requestedOptions.body).toContain('isAudit=true')

      expect(urls.teacherUrl).toBe('https://videos.sjtu.edu.cn/vod/teacher_view_high.mp4')
      expect(urls.pptUrl).toBe('https://videos.sjtu.edu.cn/vod/ppt_view_high.mp4')
    })

    it('handles single teacher stream gracefully when PPT stream does not exist', async () => {
      const mockResponse = {
        code: 200,
        data: {
          videoPlayResponseVoList: [
            {
              cdviViewNum: 0,
              rtmpUrlHdv: 'https://videos.sjtu.edu.cn/vod/single_teacher.mp4'
            }
          ]
        }
      }

      const mockSes = {
        fetch: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => mockResponse
        })
      }

      const urls = await fetchLegacyVodStreamUrls(mockSes as any, 'vid_single')
      expect(urls.teacherUrl).toBe('https://videos.sjtu.edu.cn/vod/single_teacher.mp4')
      expect(urls.pptUrl).toBeUndefined()
    })

    it('returns empty object when stream list is empty or API errors', async () => {
      const mockSes = {
        fetch: vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => ({ code: 500 })
        })
      }

      const urls = await fetchLegacyVodStreamUrls(mockSes as any, 'vid_err')
      expect(urls).toEqual({})
    })
  })

  // =========================================================================
  // 3. extractLegacyLtiToken
  // =========================================================================
  describe('extractLegacyLtiToken', () => {
    it('captures canvasCourseId from redirect navigation URL and destroys offscreen window', async () => {
      state.mockLoadUrlBehavior = async () => {
        // Trigger redirect navigation listener
        const redirectUrl = 'https://courses.sjtu.edu.cn/lti/rtcVideoPlay.d2j?canvasCourseId=captured_course_token_abc'
        mockWebContents.getURL.mockReturnValue(redirectUrl)
        if (mockWebContents.listeners['will-redirect']) {
          for (const listener of mockWebContents.listeners['will-redirect']) {
            listener({} as any, redirectUrl)
          }
        }
      }

      const mockSes = { fetch: vi.fn() }
      const res = await extractLegacyLtiToken(
        mockSes as any,
        'https://oc.sjtu.edu.cn/courses/89673/external_tools/18717'
      )

      expect(res).toEqual({ canvasCourseId: 'captured_course_token_abc' })
      expect(mockDestroy).toHaveBeenCalled()
    })

    it('normalizes relative tabHtmlUrl and submits #tool_form if present', async () => {
      mockWebContents.getURL.mockReturnValue('https://oc.sjtu.edu.cn/courses/93272/external_tools/18717')
      mockWebContents.executeJavaScript.mockImplementation(async () => {
        const destUrl = 'https://courses.sjtu.edu.cn/lti/rtcVideoPlay.d2j?canvasCourseId=token_from_relative_tab'
        mockWebContents.getURL.mockReturnValue(destUrl)
        if (mockWebContents.listeners['did-navigate']) {
          for (const listener of mockWebContents.listeners['did-navigate']) {
            listener({} as any, destUrl)
          }
        }
        return true
      })

      const mockSes = { fetch: vi.fn() }
      const res = await extractLegacyLtiToken(
        mockSes as any,
        '/courses/93272/external_tools/18717'
      )

      expect(res).toEqual({ canvasCourseId: 'token_from_relative_tab' })
      expect(mockWebContents.executeJavaScript).toHaveBeenCalled()
      expect(mockDestroy).toHaveBeenCalled()
    })

    it('returns null when timeout occurs without capturing canvasCourseId', async () => {
      mockWebContents.getURL.mockReturnValue('https://oc.sjtu.edu.cn/courses/89673/external_tools/18717')

      const mockSes = { fetch: vi.fn() }
      const res = await extractLegacyLtiToken(
        mockSes as any,
        'https://oc.sjtu.edu.cn/courses/89673/external_tools/18717',
        300
      )

      expect(res).toBeNull()
      expect(mockDestroy).toHaveBeenCalled()
    })
  })
})
