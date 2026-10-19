import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Mock electron before importing production modules
vi.mock('../src/main/window', () => ({
  getIsQuitting: () => false,
  getMainWindow: () => null
}))

// Import real production implementations
import {
  isClassVideoTab,
  extractLectureNum,
  identifyVideoStreams,
  fetchVodVideoList
} from '../src/main/canvas/video-tokens'

import {
  processPptSlices,
  formatSliceFileName,
  buildPptSliceDirName,
  downloadPptAsPdf
} from '../src/main/canvas/ppt-download'

import {
  resolveBundledFfmpeg
} from '../src/main/canvas/hls-download'

import {
  isHlsStreamTask
} from '../src/main/download-engine/shared'

// Import contracts for exact equivalence verification
import * as contracts from './helpers/contracts'

describe('M3 Forensic Audit: Production Implementation & Stress Verification', () => {

  // ─────────────────────────────────────────────────────────────
  // 1. Contract vs Production Equivalence Checks
  // ─────────────────────────────────────────────────────────────
  describe('1. Equivalence between Contracts and Production Code', () => {
    it('isClassVideoTab behaves identically on all edge cases', () => {
      const inputs = [
        '课堂视频', '课堂视频new', '课堂录像', '在线课堂', 'class video',
        'CLASS VIDEO', 'Class Video (LTI)', '课程大纲', '讨论区', '',
        '   课堂录像   ', '视频作业', '录像讨论'
      ]
      for (const input of inputs) {
        expect(isClassVideoTab(input)).toBe(contracts.isClassVideoTab(input))
      }
    })

    it('extractLectureNum behaves identically on all edge cases', () => {
      const titles = [
        '高等数学(第1讲)', '高等数学(第01讲)', '大学物理 第02次课', '大学物理 第15次课',
        '线性代数 第一讲', '线性代数 第十讲', '线性代数 第十一讲', '线性代数 第十二讲',
        'Computer Science Lecture 12', 'Lec 05: Dynamic Programming', 'class 3',
        '01_导论', '导论_02', '无讲次课程', '期末总复习与答疑', '', '第999讲'
      ]
      for (const title of titles) {
        expect(extractLectureNum(title)).toBe(contracts.extractLectureNum(title))
      }
    })

    it('identifyVideoStreams behaves identically on stream fixtures and edge cases', () => {
      const dualStream = [
        { cdviChannelNum: 0, channelName: '教师摄像', rtmpUrlHdv: 'https://live.sjtu.edu.cn/teacher.m3u8' },
        { cdviChannelNum: 1, channelName: 'PPT电脑', rtmpUrlHdv: 'https://live.sjtu.edu.cn/ppt.m3u8' }
      ]
      expect(identifyVideoStreams(dualStream)).toEqual(contracts.identifyVideoStreams(dualStream))

      const singleStream = [
        { cdviChannelNum: 0, channelName: '主视角', rtmpUrlHdv: 'https://live.sjtu.edu.cn/main.m3u8' }
      ]
      expect(identifyVideoStreams(singleStream)).toEqual(contracts.identifyVideoStreams(singleStream))

      const emptyStream: any[] = []
      expect(identifyVideoStreams(emptyStream)).toEqual(contracts.identifyVideoStreams(emptyStream))
    })

    it('processPptSlices behaves identically on all slice lists', () => {
      const raw = [
        { ivsVideoId: 101, createSec: 120, hide: 0, pptImgUrl: 'https://img/3.jpg' },
        { ivsVideoId: 102, createSec: 10, hide: 0, pptImgUrl: 'https://img/1.jpg' },
        { ivsVideoId: 103, createSec: 45, hide: 1, pptImgUrl: 'https://img/hidden.jpg' },
        { ivsVideoId: 104, createSec: 45, hide: '0', pptImgUrl: 'https://img/2.jpg' }
      ]
      expect(processPptSlices(raw, { saveImages: true })).toEqual(contracts.processPptSlices(raw, { saveImages: true }))
      expect(processPptSlices(raw, { saveImages: false })).toEqual(contracts.processPptSlices(raw, { saveImages: false }))
      expect(processPptSlices([])).toEqual(contracts.processPptSlices([]))
    })

    it('formatSliceFileName behaves identically across timestamp boundaries', () => {
      const seconds = [0, 5, 59, 60, 61, 3599, 3600, 3601, 7325]
      for (let i = 0; i < seconds.length; i++) {
        expect(formatSliceFileName(i + 1, seconds[i])).toBe(contracts.formatSliceFileName(i + 1, seconds[i]))
      }
    })

    it('resolveBundledFfmpeg behaves identically across all path configurations', () => {
      const existsMock = (p: string) => p.includes('app.asar.unpacked')
      expect(resolveBundledFfmpeg('C:\\app.asar\\ffmpeg.exe', existsMock))
        .toBe(contracts.resolveBundledFfmpeg('C:\\app.asar\\ffmpeg.exe', existsMock))

      expect(resolveBundledFfmpeg('', existsMock))
        .toBe(contracts.resolveBundledFfmpeg('', existsMock))
    })

    it('isHlsStreamTask behaves identically on all spec variations', () => {
      const specs = [
        { source: 'canvas-class-video' },
        { isHls: true },
        { url: 'https://sjtu.edu.cn/video.m3u8' },
        { url: 'https://sjtu.edu.cn/video.m3u8?token=xyz' },
        { url: 'https://sjtu.edu.cn/video.mp4' },
        { url: '' },
        null,
        {}
      ]
      for (const spec of specs) {
        expect(isHlsStreamTask(spec)).toBe(contracts.isHlsStreamTask(spec))
      }
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 2. Adversarial Stress & Edge Cases
  // ─────────────────────────────────────────────────────────────
  describe('2. Adversarial Stress & Edge Cases', () => {
    describe('R2-F5: LTI Video Scan & Pagination Loop Termination', () => {
      it('handles empty server record list without infinite loop', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          json: async () => ({
            code: '0',
            data: {
              total: 0,
              records: []
            }
          })
        })

        // Temporary monkey-patch global fetch for test
        const origFetch = global.fetch
        global.fetch = mockFetch

        try {
          // fetchVodVideoList uses safeFetch which delegates to ses.fetch or global fetch
          const records = await fetchVodVideoList(
            { fetch: mockFetch } as any,
            'fake_token',
            '10001'
          )
          expect(records).toEqual([])
          expect(mockFetch).toHaveBeenCalledTimes(1)
        } finally {
          global.fetch = origFetch
        }
      })

      it('accumulates multi-page records and terminates exactly when all records retrieved', async () => {
        let callCount = 0
        const page1 = Array.from({ length: 500 }, (_, i) => ({
          videoId: `vid_${i + 1}`,
          videoName: `第${i + 1}讲`,
          beginTime: '2026-03-01 08:00:00'
        }))
        const page2 = Array.from({ length: 250 }, (_, i) => ({
          videoId: `vid_${i + 501}`,
          videoName: `第${i + 501}讲`,
          beginTime: '2026-03-02 08:00:00'
        }))

        const mockFetch = vi.fn().mockImplementation(async (_url, opts) => {
          callCount++
          const body = JSON.parse(opts.body)
          if (body.current === 1) {
            return {
              json: async () => ({
                code: '0',
                data: { total: 750, records: page1 }
              })
            }
          } else {
            return {
              json: async () => ({
                code: '0',
                data: { total: 750, records: page2 }
              })
            }
          }
        })

        const records = await fetchVodVideoList(
          { fetch: mockFetch } as any,
          'fake_token',
          '10001'
        )

        expect(callCount).toBe(2)
        expect(records.length).toBe(750)
        expect(records[0].videoName).toBe('第1讲')
        expect(records[749].videoName).toBe('第750讲')
      })

      it('throws descriptive error on server error code', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          json: async () => ({
            code: '500',
            message: 'Session Token Expired'
          })
        })

        await expect(fetchVodVideoList({ fetch: mockFetch } as any, 'tok', 'c1'))
          .rejects.toThrow('findVodVideoList code=500: Session Token Expired')
      })
    })

    describe('R2-F6: Stream Classification Robustness', () => {
      it('correctly handles 3-stream recording with panorama channel', () => {
        const streams = [
          { cdviChannelNum: 0, channelName: '教师全景', rtmpUrlHdv: 'https://s/pan.m3u8' },
          { cdviChannelNum: 1, channelName: '电脑PPT', rtmpUrlHdv: 'https://s/ppt.m3u8' },
          { cdviChannelNum: 2, channelName: '板书特写', rtmpUrlHdv: 'https://s/extra.m3u8' }
        ]
        const identified = identifyVideoStreams(streams)
        expect(identified.length).toBe(3)
        expect(identified[0].label).toBe('全景') // name includes '全景'
        expect(identified[1].label).toBe('PPT')  // name includes 'PPT'
        expect(identified[2].label).toBe('全景') // channelNum 2
      })

      it('handles streams missing rtmpUrlHdv but providing url property', () => {
        const streams = [
          { cdviChannelNum: 0, channelName: '教师', url: 'https://s/teacher.m3u8' }
        ]
        const identified = identifyVideoStreams(streams)
        expect(identified.length).toBe(1)
        expect(identified[0].url).toBe('https://s/teacher.m3u8')
        expect(identified[0].label).toBe('教师')
      })

      it('filters out corrupted stream items without valid URLs', () => {
        const streams = [
          null,
          { channelName: '无效流' },
          { cdviChannelNum: 0, channelName: '教师', url: 'https://valid.m3u8' }
        ]
        const identified = identifyVideoStreams(streams)
        expect(identified.length).toBe(1)
        expect(identified[0].label).toBe('教师')
      })
    })

    describe('R2-F7: PPT Slide Harvester Companion Directory Verification', () => {
      const testDir = join(tmpdir(), 'test_m3_ppt_slices_' + Date.now())

      beforeEach(() => {
        mkdirSync(testDir, { recursive: true })
      })

      it('sanitizes illegal path characters when generating companion slice folder name', () => {
        const rawName = '高等数学: 第1讲 / 导论 * ? " < > | 基础'
        const dirName = buildPptSliceDirName(rawName)
        expect(dirName).not.toMatch(/[/\\?%*:|"<>]/)
        expect(dirName).toBe('高等数学_ 第1讲 _ 导论 _ _ _ _ _ _ 基础-切片')
      })

      it('formats slice file names correctly for hours, minutes, and seconds', () => {
        expect(formatSliceFileName(1, 0)).toBe('01_00m00s.jpg')
        expect(formatSliceFileName(5, 65)).toBe('05_01m05s.jpg')
        expect(formatSliceFileName(12, 3661)).toBe('12_01h01m01s.jpg')
        expect(formatSliceFileName(99, 36000)).toBe('99_10h00m00s.jpg')
      })

      it('downloadPptAsPdf writes PDF and copies slice images when saveImages is true', async () => {
        const destRoot = join(testDir, 'downloads')
        mkdirSync(destRoot, { recursive: true })

        // 1x1 valid PNG buffer
        const samplePng = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        )

        const mockSes = {
          fetch: vi.fn().mockImplementation(async (url: string) => {
            if (url.includes('query-ppt-slice-es')) {
              return {
                json: async () => ({
                  code: '0',
                  data: [
                    { ivsVideoId: 101, createSec: 15, hide: 0, pptImgUrl: 'https://v.sjtu.edu.cn/img1.png' },
                    { ivsVideoId: 101, createSec: 75, hide: 0, pptImgUrl: 'https://v.sjtu.edu.cn/img2.png' }
                  ]
                })
              }
            } else {
              return {
                ok: true,
                status: 200,
                arrayBuffer: async () => new Uint8Array(samplePng).buffer
              }
            }
          })
        } as any

        const result = await downloadPptAsPdf(
          mockSes,
          'mock_token',
          {
            ivsVideoId: '101',
            courseName: '软件测试',
            lectureName: '第1讲_概述',
            destRoot,
            term: '2025-2026-1',
            saveImages: true
          }
        )

        expect(result.ok).toBe(true)
        expect(result.path).toBeDefined()
        expect(existsSync(result.path!)).toBe(true)
        expect(result.imageFolder).toBeDefined()
        expect(existsSync(result.imageFolder!)).toBe(true)

        // Verify companion slice directory contains the correctly named images
        const savedImages = readdirSync(result.imageFolder!)
        expect(savedImages).toEqual(['01_00m15s.jpg', '02_01m15s.jpg'])
      })

      it('downloadPptAsPdf does NOT create slice directory when saveImages is false or undefined', async () => {
        const destRoot = join(testDir, 'downloads_no_slices')
        mkdirSync(destRoot, { recursive: true })

        const samplePng = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64'
        )

        const mockSes = {
          fetch: vi.fn().mockImplementation(async (url: string) => {
            if (url.includes('query-ppt-slice-es')) {
              return {
                json: async () => ({
                  code: '0',
                  data: [
                    { ivsVideoId: 102, createSec: 15, hide: 0, pptImgUrl: 'https://v.sjtu.edu.cn/img1.png' }
                  ]
                })
              }
            } else {
              return {
                ok: true,
                status: 200,
                arrayBuffer: async () => new Uint8Array(samplePng).buffer
              }
            }
          })
        } as any

        const result = await downloadPptAsPdf(
          mockSes,
          'mock_token',
          {
            ivsVideoId: '102',
            courseName: '软件测试',
            lectureName: '第2讲_基础',
            destRoot,
            term: '2025-2026-1',
            saveImages: false
          }
        )

        expect(result.ok).toBe(true)
        expect(result.path).toBeDefined()
        expect(existsSync(result.path!)).toBe(true)
        expect(result.imageFolder).toBeUndefined()

        const sliceDir = join(destRoot, 'Canvas课程', '2025-2026-1', '软件测试', 'videos', '课堂视频', '第2讲_基础-切片')
        expect(existsSync(sliceDir)).toBe(false)
      })
    })

    describe('R4-F3: FFmpeg asar.unpacked Path Resolution', () => {
      it('prefers app.asar.unpacked when fileExists confirms unpacked exists', () => {
        const bundled = 'D:\\App\\resources\\app.asar\\ffmpeg.exe'
        const unpacked = 'D:\\App\\resources\\app.asar.unpacked\\ffmpeg.exe'
        const existsMap = new Set([bundled, unpacked])

        const res = resolveBundledFfmpeg(bundled, p => existsMap.has(p))
        expect(res).toBe(unpacked)
      })

      it('falls back to bundled path when unpacked is missing but bundled exists', () => {
        const bundled = 'D:\\App\\resources\\app.asar\\ffmpeg.exe'
        const existsMap = new Set([bundled])

        const res = resolveBundledFfmpeg(bundled, p => existsMap.has(p))
        expect(res).toBe(bundled)
      })

      it('falls back to system ffmpeg when neither exists or path is empty', () => {
        expect(resolveBundledFfmpeg('', () => false)).toBe('ffmpeg')
        expect(resolveBundledFfmpeg('D:\\App\\missing\\ffmpeg.exe', () => false)).toBe('ffmpeg')
      })
    })
  })
})
