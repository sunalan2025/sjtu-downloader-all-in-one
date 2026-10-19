import { describe, it, expect, vi, beforeEach } from 'vitest'
import type Electron from 'electron'
import type { CanvasVideoSession } from '../../src/shared/types'

// Mock Electron IPC and BrowserWindow
const ipcHandlers = new Map<string, (...args: any[]) => any>()

vi.mock('electron', () => {
  return {
    app: {
      getPath: vi.fn(() => 'D:/mock-userData'),
      whenReady: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockReturnValue(true),
      quit: vi.fn()
    },
    session: {
      fromPartition: vi.fn(() => ({
        cookies: {
          get: vi.fn().mockResolvedValue([]),
          set: vi.fn().mockResolvedValue(undefined)
        }
      }))
    },
    BrowserWindow: class MockBrowserWindow {
      loadURL = vi.fn().mockResolvedValue(undefined)
      webContents = {
        getURL: () => 'https://oc.sjtu.edu.cn',
        setAudioMuted: vi.fn(),
        on: vi.fn()
      }
      destroy = vi.fn()
      isDestroyed = vi.fn().mockReturnValue(false)
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
        ipcHandlers.set(channel, handler)
      }),
      on: vi.fn()
    },
    Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
    shell: { openExternal: vi.fn() },
    nativeImage: { createFromPath: vi.fn() },
    nativeTheme: { shouldUseDarkColors: false },
    Tray: vi.fn()
  }
})

vi.mock('../../src/main/window', () => ({
  getMainWindow: vi.fn(() => null),
  getIsQuitting: vi.fn(() => false)
}))

// Mock legacy-video & video-tokens & api modules for orchestrator testing
vi.mock('../../src/main/canvas/legacy-video', async () => {
  const actual = await vi.importActual<typeof import('../../src/main/canvas/legacy-video')>('../../src/main/canvas/legacy-video')
  return {
    ...actual,
    extractLegacyLtiToken: vi.fn(),
    fetchLegacyVodVideoList: vi.fn(),
    fetchLegacyVodStreamUrls: vi.fn()
  }
})

vi.mock('../../src/main/canvas/api', async () => {
  const actual = await vi.importActual<typeof import('../../src/main/canvas/api')>('../../src/main/canvas/api')
  return {
    ...actual,
    fetchCourseTabs: vi.fn()
  }
})

import {
  isClassVideoTab,
  isLegacyClassVideoTab,
  isNewClassVideoTab,
  mergeAndDeduplicateLectures
} from '../../src/main/canvas/video-tokens'

import {
  registerCanvasHandlers,
  setCanvasSession
} from '../../src/main/canvas/orchestrator'

import * as legacyVideoModule from '../../src/main/canvas/legacy-video'
import * as canvasApiModule from '../../src/main/canvas/api'
import * as videoTokensModule from '../../src/main/canvas/video-tokens'

describe('Dual-Track Union Video Scan & Dispatch Engine Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcHandlers.clear()
    registerCanvasHandlers()
    setCanvasSession({} as Electron.Session)
  })

  // =========================================================================
  // 1. Tab Identification Helpers
  // =========================================================================
  describe('Tab Identification Helpers', () => {
    it('isLegacyClassVideoTab recognizes legacy external tool 18717 and "旧版" labels', () => {
      expect(isLegacyClassVideoTab('课堂视频', '/courses/89673/external_tools/18717')).toBe(true)
      expect(isLegacyClassVideoTab('课堂视频旧版', '/courses/89673/external_tools/unknown')).toBe(true)
      expect(isLegacyClassVideoTab('课堂视频（旧版）')).toBe(true)
      expect(isLegacyClassVideoTab('旧版课堂录像')).toBe(true)
      expect(isLegacyClassVideoTab('课堂视频', 'https://courses.sjtu.edu.cn/lti/launch')).toBe(true)

      // Negative cases
      expect(isLegacyClassVideoTab('课堂视频', '/courses/89673/external_tools/8329')).toBe(false)
      expect(isLegacyClassVideoTab('课堂视频新版')).toBe(false)
      expect(isLegacyClassVideoTab('课程大纲', '/courses/89673/external_tools/18717')).toBe(true) // tool 18717 is legacy
      expect(isLegacyClassVideoTab('作业', '/courses/89673/assignments')).toBe(false)
    })

    it('isNewClassVideoTab recognizes new tool 8329, "新版", and general class video tabs', () => {
      expect(isNewClassVideoTab('课堂视频', '/courses/89673/external_tools/8329')).toBe(true)
      expect(isNewClassVideoTab('课堂视频new', '/courses/89673/external_tools/8329')).toBe(true)
      expect(isNewClassVideoTab('课堂视频新版')).toBe(true)
      expect(isNewClassVideoTab('课堂视频', 'https://v.sjtu.edu.cn/jy-application-canvas-sjtu')).toBe(true)
      // Generic label without legacy marker defaults to new
      expect(isNewClassVideoTab('课堂视频')).toBe(true)
      expect(isNewClassVideoTab('Class Video')).toBe(true)

      // Negative cases
      expect(isNewClassVideoTab('课堂视频', '/courses/89673/external_tools/18717')).toBe(false)
      expect(isNewClassVideoTab('课堂视频旧版')).toBe(false)
      expect(isNewClassVideoTab('讨论')).toBe(false)
    })

    it('isClassVideoTab recognizes both new and legacy class video tab labels', () => {
      expect(isClassVideoTab('课堂视频')).toBe(true)
      expect(isClassVideoTab('课堂视频new')).toBe(true)
      expect(isClassVideoTab('课堂视频新版')).toBe(true)
      expect(isClassVideoTab('课堂视频旧版')).toBe(true)
      expect(isClassVideoTab('课堂录像')).toBe(true)
      expect(isClassVideoTab('在线课堂')).toBe(true)
      expect(isClassVideoTab('Class Video')).toBe(true)
      expect(isClassVideoTab('讨论区')).toBe(false)
    })
  })

  // =========================================================================
  // 2. mergeAndDeduplicateLectures
  // =========================================================================
  describe('mergeAndDeduplicateLectures', () => {
    it('returns only new sessions when legacy sessions are empty', () => {
      const newSessions: CanvasVideoSession[] = [
        {
          videoId: 'new_1',
          courId: 101,
          teacher: '张老师',
          classroom: '东中101',
          beginTime: '2025-09-15 08:00:00',
          videoName: '第1讲 绪论'
        },
        {
          videoId: 'new_2',
          courId: 102,
          teacher: '张老师',
          classroom: '东中101',
          beginTime: '2025-09-22 08:00:00',
          videoName: '第2讲 基础概念'
        }
      ]

      const merged = mergeAndDeduplicateLectures(newSessions, [])
      expect(merged).toHaveLength(2)
      expect(merged[0].videoId).toBe('new_1')
      expect(merged[0].source).toBe('new')
      expect(merged[1].videoId).toBe('new_2')
      expect(merged[1].source).toBe('new')
    })

    it('returns only legacy sessions when new sessions are empty', () => {
      const legacySessions: CanvasVideoSession[] = [
        {
          videoId: 'leg_1',
          courId: 0,
          teacher: '李老师',
          classroom: '下院101',
          beginTime: '2025-09-10 08:00:00',
          videoName: '离散数学(第1讲)',
          legacyCourseId: 'enc_89673',
          source: 'legacy'
        },
        {
          videoId: 'leg_2',
          courId: 0,
          teacher: '李老师',
          classroom: '下院101',
          beginTime: '2025-09-17 08:00:00',
          videoName: '离散数学(第2讲)',
          legacyCourseId: 'enc_89673',
          source: 'legacy'
        }
      ]

      const merged = mergeAndDeduplicateLectures([], legacySessions)
      expect(merged).toHaveLength(2)
      expect(merged[0].videoId).toBe('leg_1')
      expect(merged[0].source).toBe('legacy')
      expect(merged[0].legacyCourseId).toBe('enc_89673')
      expect(merged[1].videoId).toBe('leg_2')
      expect(merged[1].source).toBe('legacy')
    })

    it('aligns lectures by normalized beginTime, prefers new session, and preserves legacyCourseId', () => {
      const newSessions: CanvasVideoSession[] = [
        {
          videoId: 'new_1',
          courId: 101,
          teacher: '王老师',
          classroom: '东中201',
          beginTime: '2025-09-15 08:00:00',
          videoName: '第1讲 高清录播'
        }
      ]

      const legacySessions: CanvasVideoSession[] = [
        {
          videoId: 'leg_1',
          courId: 0,
          teacher: '王老师',
          classroom: '东中201',
          beginTime: '2025-09-15 08:00',
          videoName: '第1讲',
          legacyCourseId: 'enc_legacy_course_id',
          source: 'legacy'
        }
      ]

      const merged = mergeAndDeduplicateLectures(newSessions, legacySessions)
      expect(merged).toHaveLength(1)
      expect(merged[0].videoId).toBe('new_1') // preferred new
      expect(merged[0].videoName).toBe('第1讲 高清录播')
      expect(merged[0].legacyCourseId).toBe('enc_legacy_course_id') // preserved legacyCourseId
      expect(merged[0].source).toBe('new')
    })

    it('merges partial overlap cleanly (new has 1-3, legacy has 1-5 -> total 5 lectures)', () => {
      const newSessions: CanvasVideoSession[] = [1, 2, 3].map(n => ({
        videoId: `new_${n}`,
        courId: 100 + n,
        teacher: '赵老师',
        classroom: '中院200',
        beginTime: `2025-10-0${n} 08:00:00`,
        videoName: `第${n}讲 新版`
      }))

      const legacySessions: CanvasVideoSession[] = [1, 2, 3, 4, 5].map(n => ({
        videoId: `leg_${n}`,
        courId: 0,
        teacher: '赵老师',
        classroom: '中院200',
        beginTime: `2025-10-0${n} 08:00:00`,
        videoName: `第${n}讲 旧版`,
        legacyCourseId: 'enc_course_123',
        source: 'legacy' as const
      }))

      const merged = mergeAndDeduplicateLectures(newSessions, legacySessions)
      expect(merged).toHaveLength(5)
      // Lectures 1-3 should prefer new
      expect(merged[0].videoId).toBe('new_1')
      expect(merged[1].videoId).toBe('new_2')
      expect(merged[2].videoId).toBe('new_3')
      // Lectures 4-5 should come from legacy
      expect(merged[3].videoId).toBe('leg_4')
      expect(merged[3].source).toBe('legacy')
      expect(merged[4].videoId).toBe('leg_5')
      expect(merged[4].source).toBe('legacy')
    })

    it('fills in missing teacher metadata from legacy if new session teacher is missing or unknown', () => {
      const newSessions: CanvasVideoSession[] = [
        {
          videoId: 'new_1',
          courId: 101,
          teacher: '未知教师',
          classroom: '东中101',
          beginTime: '2025-09-15 08:00:00',
          videoName: '第1讲 绪论'
        }
      ]

      const legacySessions: CanvasVideoSession[] = [
        {
          videoId: 'leg_1',
          courId: 0,
          teacher: '孙教授',
          classroom: '东中101',
          beginTime: '2025-09-15 08:00:00',
          videoName: '第1讲',
          legacyCourseId: 'enc_course_123',
          source: 'legacy'
        }
      ]

      const merged = mergeAndDeduplicateLectures(newSessions, legacySessions)
      expect(merged).toHaveLength(1)
      expect(merged[0].teacher).toBe('孙教授')
    })
  })

  // =========================================================================
  // 3. IPC canvas:class-video-scan Dual-Track Behavior
  // =========================================================================
  describe('canvas:class-video-scan IPC Handler', () => {
    it('scans new tab normally when only new tab (tool 8329) exists', async () => {
      const courseTabs = [
        { id: '1', label: '课堂视频', htmlUrl: '/courses/12345/external_tools/8329' },
        { id: '2', label: '大纲', htmlUrl: '/courses/12345/assignments/syllabus' }
      ]
      vi.mocked(canvasApiModule.fetchCourseTabs).mockResolvedValue(courseTabs as any)

      vi.spyOn(videoTokensModule, 'extractLtiToken').mockResolvedValue({
        token: 'mock_jwt_token_8329',
        canvasCourseId: '12345'
      })
      vi.spyOn(videoTokensModule, 'fetchVodVideoList').mockResolvedValue([
        {
          videoId: 'v1',
          courId: 1,
          teacher: '张老师',
          classroom: '东上院101',
          beginTime: '2025-09-10 08:00:00',
          videoName: '第1讲'
        }
      ])

      const handler = ipcHandlers.get('canvas:class-video-scan')
      expect(handler).toBeDefined()

      const res = await handler!(null, 12345)
      expect(res.ok).toBe(true)
      expect(res.sessions).toHaveLength(1)
      expect(res.sessions[0].videoId).toBe('v1')
      expect(res.token).toBe('mock_jwt_token_8329')
      expect(res.canvasCourseId).toBe('12345')
      expect(res.teachers).toEqual([{ teacher: '张老师', count: 1, selected: true }])
      expect(res.lectures).toHaveLength(1)
    })

    it('falls back to legacy tab (tool 18717) when new tab returns 0 sessions (e.g. unarranged course 89673)', async () => {
      const courseTabs = [
        { id: '1', label: '课堂视频', htmlUrl: '/courses/89673/external_tools/8329' },
        { id: '2', label: '课堂视频旧版', htmlUrl: '/courses/89673/external_tools/18717' }
      ]
      vi.mocked(canvasApiModule.fetchCourseTabs).mockResolvedValue(courseTabs as any)

      // New tab returns 0 records
      vi.spyOn(videoTokensModule, 'extractLtiToken').mockResolvedValue({
        token: 'mock_jwt_token_empty',
        canvasCourseId: '89673'
      })
      vi.spyOn(videoTokensModule, 'fetchVodVideoList').mockResolvedValue([])

      // Legacy tab returns 14 sessions
      vi.mocked(legacyVideoModule.extractLegacyLtiToken).mockResolvedValue({
        canvasCourseId: 'enc_course_89673'
      })
      const mockLegacySessions: CanvasVideoSession[] = Array.from({ length: 14 }, (_, i) => ({
        videoId: `leg_89673_${i + 1}`,
        courId: 0,
        teacher: '钱老师',
        classroom: '下院205',
        beginTime: `2025-09-${String(i + 1).padStart(2, '0')} 08:00:00`,
        videoName: `高等数学(第${i + 1}讲)`,
        legacyCourseId: 'enc_course_89673',
        source: 'legacy'
      }))
      vi.mocked(legacyVideoModule.fetchLegacyVodVideoList).mockResolvedValue(mockLegacySessions)

      const handler = ipcHandlers.get('canvas:class-video-scan')
      const res = await handler!(null, 89673)

      expect(res.ok).toBe(true)
      expect(res.sessions).toHaveLength(14)
      expect(res.sessions[0].legacyCourseId).toBe('enc_course_89673')
      expect(res.legacyCourseId).toBe('enc_course_89673')
      expect(res.teachers).toEqual([{ teacher: '钱老师', count: 14, selected: true }])
      expect(res.lectures).toHaveLength(14)
    })

    it('merges both when dual track has concurrent sessions on new and legacy tabs', async () => {
      const courseTabs = [
        { id: '1', label: '课堂视频新版', htmlUrl: '/courses/90001/external_tools/8329' },
        { id: '2', label: '课堂视频旧版', htmlUrl: '/courses/90001/external_tools/18717' }
      ]
      vi.mocked(canvasApiModule.fetchCourseTabs).mockResolvedValue(courseTabs as any)

      vi.spyOn(videoTokensModule, 'extractLtiToken').mockResolvedValue({
        token: 'token_90001',
        canvasCourseId: '90001'
      })
      vi.spyOn(videoTokensModule, 'fetchVodVideoList').mockResolvedValue([
        {
          videoId: 'new_1',
          courId: 101,
          teacher: '周老师',
          classroom: '东下101',
          beginTime: '2025-09-01 08:00:00',
          videoName: '第1讲 导论'
        }
      ])

      vi.mocked(legacyVideoModule.extractLegacyLtiToken).mockResolvedValue({
        canvasCourseId: 'enc_90001'
      })
      vi.mocked(legacyVideoModule.fetchLegacyVodVideoList).mockResolvedValue([
        {
          videoId: 'leg_1',
          courId: 0,
          teacher: '周老师',
          classroom: '东下101',
          beginTime: '2025-09-01 08:00:00',
          videoName: '第1讲',
          legacyCourseId: 'enc_90001',
          source: 'legacy'
        },
        {
          videoId: 'leg_2',
          courId: 0,
          teacher: '周老师',
          classroom: '东下101',
          beginTime: '2025-09-08 08:00:00',
          videoName: '第2讲 深入',
          legacyCourseId: 'enc_90001',
          source: 'legacy'
        }
      ])

      const handler = ipcHandlers.get('canvas:class-video-scan')
      const res = await handler!(null, 90001)

      expect(res.ok).toBe(true)
      expect(res.sessions).toHaveLength(2)
      // Lecture 1 from new with legacyCourseId preserved
      expect(res.sessions[0].videoId).toBe('new_1')
      expect(res.sessions[0].legacyCourseId).toBe('enc_90001')
      // Lecture 2 from legacy
      expect(res.sessions[1].videoId).toBe('leg_2')
      expect(res.sessions[1].source).toBe('legacy')
      expect(res.teachers).toEqual([{ teacher: '周老师', count: 2, selected: true }])
      expect(res.token).toBe('token_90001')
      expect(res.legacyCourseId).toBe('enc_90001')
    })

    it('returns empty results gracefully when course has no class video tabs', async () => {
      const courseTabs = [
        { id: '1', label: '课程首页', htmlUrl: '/courses/11111' },
        { id: '2', label: '讨论', htmlUrl: '/courses/11111/discussion_topics' }
      ]
      vi.mocked(canvasApiModule.fetchCourseTabs).mockResolvedValue(courseTabs as any)

      const handler = ipcHandlers.get('canvas:class-video-scan')
      const res = await handler!(null, 11111)

      expect(res.ok).toBe(true)
      expect(res.sessions).toEqual([])
      expect(res.teachers).toEqual([])
    })
  })

  // =========================================================================
  // 4. IPC canvas:class-video-download Legacy Direct MP4 Range Dispatch
  // =========================================================================
  describe('canvas:class-video-download IPC Handler', () => {
    it('generates direct MP4 task specs for legacy sessions using fetchLegacyVodStreamUrls', async () => {
      vi.mocked(legacyVideoModule.fetchLegacyVodStreamUrls).mockResolvedValue({
        teacherUrl: 'https://videos.sjtu.edu.cn/vod/2025/teacher_view_01.mp4',
        pptUrl: 'https://videos.sjtu.edu.cn/vod/2025/ppt_view_01.mp4'
      })

      const sessions: CanvasVideoSession[] = [
        {
          videoId: 'legacy_vid_101',
          courId: 0,
          teacher: '吴老师',
          classroom: '中院301',
          beginTime: '2025-09-12 10:00:00',
          videoName: '离散数学(第1讲)',
          legacyCourseId: 'enc_course_89673',
          source: 'legacy'
        }
      ]

      const handler = ipcHandlers.get('canvas:class-video-download')
      expect(handler).toBeDefined()

      const res = await handler!(
        null,
        '离散数学',
        89673,
        sessions,
        ['吴老师'],
        'dummy_token',
        '89673',
        'D:/Downloads',
        'skip',
        '2025-2026-1'
      )

      expect(res.ok).toBe(true)
      expect(res.specs).toBeDefined()
      expect(res.specs).toHaveLength(2)

      const teacherSpec = res.specs.find((s: any) => s.canvasStreamIdx === 0)
      const pptSpec = res.specs.find((s: any) => s.canvasStreamIdx === 1)

      expect(teacherSpec).toBeDefined()
      expect(teacherSpec.url).toBe('https://videos.sjtu.edu.cn/vod/2025/teacher_view_01.mp4')
      expect(teacherSpec.source).toBe('canvas-video')
      expect(teacherSpec.isHls).toBe(false)
      expect(teacherSpec.fileName).toContain('教师视角 (MP4).mp4')

      expect(pptSpec).toBeDefined()
      expect(pptSpec.url).toBe('https://videos.sjtu.edu.cn/vod/2025/ppt_view_01.mp4')
      expect(pptSpec.source).toBe('canvas-video')
      expect(pptSpec.isHls).toBe(false)
      expect(pptSpec.fileName).toContain('PPT投影视角 (MP4).mp4')
    })

    it('resolveDirectUrl successfully re-resolves legacy canvas-video MP4 streams when url is cleared', async () => {
      const { resolveDirectUrl } = await import('../../src/main/download-engine/shared')
      vi.mocked(legacyVideoModule.fetchLegacyVodStreamUrls).mockResolvedValue({
        teacherUrl: 'https://videos.sjtu.edu.cn/vod/resumed_teacher.mp4',
        pptUrl: 'https://videos.sjtu.edu.cn/vod/resumed_ppt.mp4'
      })

      const taskRuntimeTeacher: any = {
        spec: {
          taskId: 'canvas_lecture_89673_1_teacher',
          source: 'canvas-video',
          url: '', // cleared on pause/resume
          canvasVideoId: 'video_resume_123',
          canvasStreamIdx: 0
        },
        state: 'pending',
        total: 0
      }

      const okTeacher = await resolveDirectUrl(taskRuntimeTeacher, false)
      expect(okTeacher).toBe(true)
      expect(taskRuntimeTeacher.spec.url).toBe('https://videos.sjtu.edu.cn/vod/resumed_teacher.mp4')

      const taskRuntimePpt: any = {
        spec: {
          taskId: 'canvas_lecture_89673_1_ppt',
          source: 'canvas-video',
          url: '', // cleared on pause/resume
          canvasVideoId: 'video_resume_123',
          canvasStreamIdx: 1
        },
        state: 'pending',
        total: 0
      }

      const okPpt = await resolveDirectUrl(taskRuntimePpt, false)
      expect(okPpt).toBe(true)
      expect(taskRuntimePpt.spec.url).toBe('https://videos.sjtu.edu.cn/vod/resumed_ppt.mp4')
    })
  })
})
