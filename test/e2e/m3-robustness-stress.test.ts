import { describe, it, expect, vi } from 'vitest'

// Mock window before imports
vi.mock('../../src/main/window', () => ({
  getIsQuitting: () => false,
  getMainWindow: () => null
}))

import {
  identifyVideoStreams,
  extractLectureNum,
  isClassVideoTab
} from '../../src/main/canvas/video-tokens'
import {
  resolveBundledFfmpeg
} from '../../src/main/canvas/hls-download'
import {
  processPptSlices,
  formatSliceFileName,
  buildPptSliceDirName
} from '../../src/main/canvas/ppt-download'
import {
  isHlsStreamTask
} from '../../src/main/download-engine/shared'

describe('Milestone 3 Robustness, Interface Contracts & Regression Stress Suite', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Dimension 1: Single-stream & Multi-stream Recording Robustness (R2-F6)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Dimension 1: Stream Identification & Single-Stream Tolerance', () => {
    it('handles empty, null, or undefined stream arrays without throwing', () => {
      expect(identifyVideoStreams([])).toEqual([])
      expect(identifyVideoStreams(null as any)).toEqual([])
      expect(identifyVideoStreams(undefined as any)).toEqual([])
      expect(identifyVideoStreams([null, undefined, {}])).toEqual([])
    })

    it('single-stream recording: does NOT crash or label as PPT when only 1 channel exists', () => {
      const singleStreamNormal = [
        { cdviChannelNum: 0, channelName: '主摄像头', rtmpUrlHdv: 'https://live.sjtu.edu.cn/live/main.m3u8' }
      ]
      const res = identifyVideoStreams(singleStreamNormal)
      expect(res).toHaveLength(1)
      expect(res[0].label).toBe('教师')
      expect(res[0].channelNum).toBe(0)
    })

    it('single-stream recording: channelNum=1 but not named PPT is safely forced to 教师', () => {
      const singleMisconfigured = [
        { cdviChannelNum: 1, channelName: '黑板特写', rtmpUrlHdv: 'https://live.sjtu.edu.cn/live/cam.m3u8' }
      ]
      const res = identifyVideoStreams(singleMisconfigured)
      expect(res).toHaveLength(1)
      expect(res[0].label).toBe('教师')
    })

    it('single-stream recording: explicitly named PPT is preserved as PPT', () => {
      const singlePpt = [
        { cdviChannelNum: 1, channelName: '电脑PPT屏幕', rtmpUrlHdv: 'https://live.sjtu.edu.cn/live/ppt.m3u8' }
      ]
      const res = identifyVideoStreams(singlePpt)
      expect(res).toHaveLength(1)
      expect(res[0].label).toBe('PPT')
    })

    it('dual-stream recording: sorts teacher to index 0 and PPT to index 1 even if returned reversed', () => {
      const reversedStreams = [
        { cdviChannelNum: 1, channelName: 'PPT课件', rtmpUrlHdv: 'https://live.sjtu.edu.cn/live/ppt.m3u8' },
        { cdviChannelNum: 0, channelName: '主讲教师', rtmpUrlHdv: 'https://live.sjtu.edu.cn/live/tea.m3u8' }
      ]
      const identified = identifyVideoStreams(reversedStreams)
      expect(identified).toHaveLength(2)

      const sorted = [...identified].sort((a, b) => {
        if (a.label === '教师' && b.label !== '教师') return -1
        if (b.label === '教师' && a.label !== '教师') return 1
        if (a.label === 'PPT' && b.label !== 'PPT') return -1
        if (b.label === 'PPT' && a.label !== 'PPT') return 1
        return 0
      })
      expect(sorted[0].label).toBe('教师')
      expect(sorted[0].url).toContain('tea.m3u8')
      expect(sorted[1].label).toBe('PPT')
      expect(sorted[1].url).toContain('ppt.m3u8')
    })

    it('triple-stream recording: distinguishes 教师, PPT, 全景', () => {
      const tripleStreams = [
        { cdviChannelNum: 2, channelName: '全景视角', rtmpUrlHdv: 'https://live.sjtu.edu.cn/live/pano.m3u8' },
        { cdviChannelNum: 1, channelName: '电脑PPT', rtmpUrlHdv: 'https://live.sjtu.edu.cn/live/ppt.m3u8' },
        { cdviChannelNum: 0, channelName: '教师主讲', rtmpUrlHdv: 'https://live.sjtu.edu.cn/live/tea.m3u8' }
      ]
      const identified = identifyVideoStreams(tripleStreams)
      expect(identified).toHaveLength(3)
      const labels = identified.map(s => s.label)
      expect(labels).toContain('教师')
      expect(labels).toContain('PPT')
      expect(labels).toContain('全景')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Dimension 2: FFmpeg asar.unpacked Path Resolution (R4-F3)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Dimension 2: FFmpeg asar.unpacked Path Resolution', () => {
    it('uses app.asar.unpacked path when unpacked binary exists', () => {
      const mockAsarPath = 'D:\\App\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe'
      const mockUnpackedPath = 'D:\\App\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe'

      const fileExists = (p: string) => p === mockUnpackedPath || p === mockAsarPath
      const resolved = resolveBundledFfmpeg(mockAsarPath, fileExists)
      expect(resolved).toBe(mockUnpackedPath)
    })

    it('falls back to bundled path when unpacked binary does not exist but bundled does', () => {
      const mockDevPath = 'D:\\App\\node_modules\\ffmpeg-static\\ffmpeg.exe'
      const fileExists = (p: string) => p === mockDevPath
      const resolved = resolveBundledFfmpeg(mockDevPath, fileExists)
      expect(resolved).toBe(mockDevPath)
    })

    it('falls back to system "ffmpeg" when neither exists or path is empty', () => {
      expect(resolveBundledFfmpeg('', () => true)).toBe('ffmpeg')
      expect(resolveBundledFfmpeg('D:\\NonExistent\\ffmpeg.exe', () => false)).toBe('ffmpeg')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Dimension 3: High-Definition PPT Slices Harvester (R2-F7)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Dimension 3: High-Definition PPT Slices & File Naming', () => {
    it('filters out hidden slices (hide === 1 or Number(s.hide) !== 0)', () => {
      const raw = [
        { ivsVideoId: 101, createSec: 15, hide: 0, pptImgUrl: 'https://v.sjtu.edu.cn/slice1.jpg' },
        { ivsVideoId: 102, createSec: 5, hide: 1, pptImgUrl: 'https://v.sjtu.edu.cn/slice_hidden.jpg' },
        { ivsVideoId: 103, createSec: 30, hide: '0', pptImgUrl: 'https://v.sjtu.edu.cn/slice2.jpg' },
        { ivsVideoId: 104, createSec: 45, hide: 0, pptImgUrl: '' } // empty url should be ignored
      ]
      const res = processPptSlices(raw, { saveImages: true })
      expect(res.totalVisible).toBe(2)
      expect(res.slices[0].createSec).toBe(15)
      expect(res.slices[1].createSec).toBe(30)
      expect(res.willSaveImages).toBe(true)
    })

    it('formats slice file name with 2-digit index and standard timestamps', () => {
      expect(formatSliceFileName(1, 10)).toBe('01_00m10s.jpg')
      expect(formatSliceFileName(9, 65)).toBe('09_01m05s.jpg')
      expect(formatSliceFileName(12, 3665)).toBe('12_01h01m05s.jpg')
      expect(formatSliceFileName(15, 7320)).toBe('15_02h02m00s.jpg')
    })

    it('formats slice file name safely with 0, negative, and float timestamps', () => {
      expect(formatSliceFileName(1, 0)).toBe('01_00m00s.jpg')
      expect(formatSliceFileName(2, -50)).toBe('02_00m00s.jpg')
      expect(formatSliceFileName(3, 12.85)).toBe('03_00m12s.jpg')
      expect(formatSliceFileName(4, 10, '.png')).toBe('04_00m10s.png')
    })

    it('builds PPT slice directory name by sanitizing Windows forbidden path chars', () => {
      const sanitized = buildPptSliceDirName('高等数学:第1讲/极限*与?连续"<>|')
      expect(sanitized).toBe('高等数学_第1讲_极限_与_连续____-切片')
      expect(sanitized).not.toContain(':')
      expect(sanitized).not.toContain('/')
      expect(sanitized).not.toContain('*')
      expect(sanitized).not.toContain('?')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Dimension 4: HLS Stream Recognition & Dispatch (R2-F6)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Dimension 4: HLS Stream Task Detector', () => {
    it('detects HLS tasks across source, flag, and URL extensions', () => {
      expect(isHlsStreamTask({ source: 'canvas-class-video' })).toBe(true)
      expect(isHlsStreamTask({ isHls: true })).toBe(true)
      expect(isHlsStreamTask({ url: 'https://live.sjtu.edu.cn/video.m3u8' })).toBe(true)
      expect(isHlsStreamTask({ url: 'https://live.sjtu.edu.cn/video.m3u8?token=xyz' })).toBe(true)
      expect(isHlsStreamTask({ url: 'https://live.sjtu.edu.cn/video.m3u8#hash' })).toBe(true)
    })

    it('does not treat standard MP4, PDF, or other binary tasks as HLS', () => {
      expect(isHlsStreamTask({ url: 'https://oc.sjtu.edu.cn/files/lecture.mp4' })).toBe(false)
      expect(isHlsStreamTask({ url: 'https://oc.sjtu.edu.cn/files/handout.pdf' })).toBe(false)
      expect(isHlsStreamTask(null)).toBe(false)
      expect(isHlsStreamTask(undefined)).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Dimension 5: Lecture Tab and Number Matcher (R2-F5)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Dimension 5: LTI Tab & Lecture Number Parser Flexibility', () => {
    it('matches all known SJTU LTI video tab labels', () => {
      expect(isClassVideoTab('课堂视频')).toBe(true)
      expect(isClassVideoTab('课堂视频new')).toBe(true)
      expect(isClassVideoTab('课堂录像')).toBe(true)
      expect(isClassVideoTab('在线课堂')).toBe(true)
      expect(isClassVideoTab('Class Video')).toBe(true)
      expect(isClassVideoTab('CLASS VIDEO (LTI 1.3)')).toBe(true)
      expect(isClassVideoTab('作业')).toBe(false)
      expect(isClassVideoTab('成绩')).toBe(false)
    })

    it('extracts lecture numbers from standard, Chinese, English, and standalone titles', () => {
      expect(extractLectureNum('大学物理(第5讲)')).toBe(5)
      expect(extractLectureNum('计算机系统结构 第10次课')).toBe(10)
      expect(extractLectureNum('毛泽东思想概论 第一讲')).toBe(1)
      expect(extractLectureNum('线性代数 第十二讲')).toBe(12)
      expect(extractLectureNum('Lecture 08: Memory Hierarchy')).toBe(8)
      expect(extractLectureNum('Lec 3 - Sorting Algorithms')).toBe(3)
      expect(extractLectureNum('02_导论与基本概念')).toBe(2)
      expect(extractLectureNum('导论与基本概念_07')).toBe(7)
      expect(extractLectureNum('期末考前答疑')).toBe(0)
    })
  })
})
