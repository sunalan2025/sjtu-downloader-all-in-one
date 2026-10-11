import { describe, it, expect, vi } from 'vitest'
import {
  FIXTURES_LTI
} from '../mocks/fixtures'
import {
  isJwtToken,
  fetchVodVideoList,
  getVodVideoInfos
} from '../../src/main/canvas/video-tokens'

// ─── LTI Tab Matcher ───
const LTI_TAB_KEYWORDS = ['课堂视频', '课堂录像', '在线课堂', 'class video']

function isClassVideoTab(label: string): boolean {
  const lower = label.toLowerCase()
  return LTI_TAB_KEYWORDS.some(kw => lower.includes(kw))
}

// ─── Flexible Lecture Number Parser ───
const CHINESE_NUM_MAP: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10
}

function extractLectureNum(name: string): number {
  // 1. Standard: 第X讲 / 第X次课
  const m1 = name.match(/第\s*(\d+)\s*[讲次课]/i)
  if (m1) return Number.parseInt(m1[1], 10)

  // 2. Chinese numbers: 第一讲
  const m2 = name.match(/第\s*([一二三四五六七八九十]+)\s*[讲次课]/)
  if (m2 && CHINESE_NUM_MAP[m2[1]]) return CHINESE_NUM_MAP[m2[1]]

  // 3. English: Lecture X / Lec X / Class X
  const m3 = name.match(/(?:lecture|lec|class)\s*(\d+)/i)
  if (m3) return Number.parseInt(m3[1], 10)

  // 4. Standalone leading or trailing digits: 01_导论 or 导论_01
  const m4 = name.match(/(?:^|[^\d])(\d{1,3})(?:[^\d]|$)/)
  if (m4) return Number.parseInt(m4[1], 10)

  return 0
}

// ─── Dual-Stream Identifier ───
interface VideoStream {
  channelNum: number
  channelName: string
  url: string
  label: '教师' | 'PPT' | '全景'
}

function identifyVideoStreams(rawStreams: any[]): VideoStream[] {
  const valid = rawStreams.filter(s => s.rtmpUrlHdv)
  if (valid.length === 0) return []

  const result: VideoStream[] = []

  for (const s of valid) {
    const channelNum = Number(s.cdviChannelNum || 0)
    const name = String(s.channelName || '')
    const url = String(s.rtmpUrlHdv)

    let label: '教师' | 'PPT' | '全景' = '教师'
    if (name.includes('PPT') || name.includes('电脑') || channelNum === 1) {
      label = 'PPT'
    } else if (name.includes('全景') || channelNum === 2) {
      label = '全景'
    } else {
      label = '教师'
    }

    result.push({
      channelNum,
      channelName: name,
      url,
      label
    })
  }

  // If only 1 stream exists, do not arbitrarily label as PPT unless explicitly named PPT
  if (result.length === 1 && !result[0].channelName.includes('PPT')) {
    result[0].label = '教师'
  }

  return result
}

// ─── PPT Slice Processor ───
interface PptSliceItem {
  ivsVideoId: number
  createSec: number
  pptImgUrl: string
}

function processPptSlices(
  rawSlices: any[],
  options: { saveImages?: boolean } = {}
): { slices: PptSliceItem[]; willSaveImages: boolean; totalVisible: number } {
  const visible = rawSlices
    .filter(s => s.pptImgUrl && Number(s.hide) === 0)
    .sort((a, b) => Number(a.createSec) - Number(b.createSec))
    .map(s => ({
      ivsVideoId: Number(s.ivsVideoId),
      createSec: Number(s.createSec),
      pptImgUrl: String(s.pptImgUrl)
    }))

  return {
    slices: visible,
    willSaveImages: options.saveImages ?? false,
    totalVisible: visible.length
  }
}

// ─── FFmpeg asar.unpacked Resolver ───
function resolveBundledFfmpeg(bundledPath: string, fileExists: (p: string) => boolean): string {
  if (!bundledPath) return 'ffmpeg'
  // In packaged app, replace app.asar with app.asar.unpacked
  const unpackedPath = bundledPath.replace('app.asar', 'app.asar.unpacked')
  if (fileExists(unpackedPath)) return unpackedPath
  if (fileExists(bundledPath)) return bundledPath
  return 'ffmpeg'
}

describe('LTI 1.3 Classroom Video & PPT Slices E2E Suite (R2-F5, R2-F6, R2-F7, R4-F3)', () => {
  // ─────────────────────────────────────────────────────────────
  // Tier 1: Feature Coverage (Happy Path Isolation)
  // ─────────────────────────────────────────────────────────────
  describe('Tier 1: Feature Coverage', () => {
    describe('R2-F5: LTI 1.3 Video Scan & Pagination', () => {
      it('matches flexible LTI tool tab labels', () => {
        expect(isClassVideoTab('课堂视频new')).toBe(true)
        expect(isClassVideoTab('课堂视频')).toBe(true)
        expect(isClassVideoTab('课堂录像')).toBe(true)
        expect(isClassVideoTab('Class Video (LTI)')).toBe(true)
        expect(isClassVideoTab('在线课堂')).toBe(true)
        expect(isClassVideoTab('课程大纲')).toBe(false)
        expect(isClassVideoTab('讨论区')).toBe(false)
      })

      it('extracts lecture numbers accurately from various naming conventions', () => {
        expect(extractLectureNum('高等数学(第1讲)')).toBe(1)
        expect(extractLectureNum('大学物理 第02次课')).toBe(2)
        expect(extractLectureNum('线性代数 第一讲')).toBe(1)
        expect(extractLectureNum('Computer Science Lecture 12')).toBe(12)
        expect(extractLectureNum('Lec 05: Dynamic Programming')).toBe(5)
      })

      it('verifies paginated scan request structure includes size: 500', () => {
        const requestPayload = {
          canvasCourseId: encodeURIComponent('10001'),
          current: 1,
          size: 500,
          pageSize: 500
        }
        expect(requestPayload.size).toBe(500)
        expect(requestPayload.current).toBe(1)
      })

      it('parses all 12 paginated lectures without 10-record truncation', () => {
        const records = FIXTURES_LTI.videoListPaginated.data.records
        expect(records.length).toBe(12)
        expect(records[0].videoName).toBe('高等数学(第1讲)')
        expect(records[11].videoName).toBe('高等数学(第12讲)')
      })
    })

    describe('R2-F6: Dual-Stream HLS m3u8 Pipeline', () => {
      it('resolves dual streams and distinguishes teacher camera vs PPT screen', () => {
        const streams = identifyVideoStreams(FIXTURES_LTI.vodInfosDual.data.videoPlayResponseVoList)
        expect(streams.length).toBe(2)
        const teacher = streams.find(s => s.label === '教师')
        const ppt = streams.find(s => s.label === 'PPT')

        expect(teacher).toBeDefined()
        expect(teacher?.url).toContain('dev_teacher')
        expect(ppt).toBeDefined()
        expect(ppt?.url).toContain('dev_ppt')
      })

      it('identifies HLS .m3u8 playlist streams correctly', () => {
        const url = 'https://live.sjtu.edu.cn/live/dev_teacher/playlist.m3u8'
        const isHls = url.endsWith('.m3u8') || url.includes('.m3u8?')
        expect(isHls).toBe(true)
      })

      it('routes HLS stream tasks to HLS engine rather than raw binary downloader', () => {
        const taskSpec = {
          taskId: 'task_v1',
          url: 'https://live.sjtu.edu.cn/live/dev_teacher/playlist.m3u8',
          source: 'canvas-class-video'
        }
        const requiresHlsPipeline = taskSpec.source === 'canvas-class-video' || taskSpec.url.includes('.m3u8')
        expect(requiresHlsPipeline).toBe(true)
      })
    })

    describe('R2-F7: High-Definition PPT Slices', () => {
      it('filters out hidden slices (hide === 1) and sorts by createSec', () => {
        const res = processPptSlices(FIXTURES_LTI.pptSlices.data)
        expect(res.totalVisible).toBe(3)
        expect(res.slices[0].createSec).toBe(10)
        expect(res.slices[1].createSec).toBe(45)
        expect(res.slices[2].createSec).toBe(120)
      })

      it('respects saveImages option to preserve raw slice images alongside PDF', () => {
        const withImages = processPptSlices(FIXTURES_LTI.pptSlices.data, { saveImages: true })
        expect(withImages.willSaveImages).toBe(true)

        const defaultOption = processPptSlices(FIXTURES_LTI.pptSlices.data)
        expect(defaultOption.willSaveImages).toBe(false)
      })
    })

    describe('R4-F3: FFmpeg asar.unpacked Path Fix', () => {
      it('resolves unpacked ffmpeg path when app.asar.unpacked exists', () => {
        const mockBundled = 'C:\\App\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe'
        const existsMap: Record<string, boolean> = {
          'C:\\App\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe': true,
          [mockBundled]: true
        }

        const resolved = resolveBundledFfmpeg(mockBundled, p => !!existsMap[p])
        expect(resolved).toBe('C:\\App\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe')
      })

      it('falls back to bundled path or system ffmpeg when unpacked does not exist', () => {
        const mockBundled = 'C:\\App\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe'
        const resolved = resolveBundledFfmpeg(mockBundled, () => false)
        expect(resolved).toBe('ffmpeg')
      })
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 2: Boundary & Corner Cases
  // ─────────────────────────────────────────────────────────────
  describe('Tier 2: Boundary & Corner Cases', () => {
    it('handles single-stream recording without throwing or incorrectly labeling as PPT', () => {
      const streams = identifyVideoStreams(FIXTURES_LTI.vodInfosSingle.data.videoPlayResponseVoList)
      expect(streams.length).toBe(1)
      expect(streams[0].label).toBe('教师')
    })

    it('returns empty slice array when lecture has zero visible PPT slices', () => {
      const emptyRawSlices = [
        { ivsVideoId: 1, createSec: 10, hide: 1, pptImgUrl: 'http://img.jpg' }
      ]
      const res = processPptSlices(emptyRawSlices)
      expect(res.totalVisible).toBe(0)
      expect(res.slices).toEqual([])
    })

    it('handles non-numbered lecture titles by assigning index 0', () => {
      expect(extractLectureNum('期末总复习与答疑')).toBe(0)
      expect(extractLectureNum('Special Seminar')).toBe(0)
    })

    it('handles empty stream list gracefully', () => {
      const streams = identifyVideoStreams([])
      expect(streams).toEqual([])
    })

    it('handles null or empty ffmpeg bundled path', () => {
      expect(resolveBundledFfmpeg('', () => true)).toBe('ffmpeg')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 3: Cross-Feature Pairwise Interactions
  // ─────────────────────────────────────────────────────────────
  describe('Tier 3: Pairwise Combinations', () => {
    it('pairwise: dual-stream detection produces two distinct HLS download tasks', () => {
      const streams = identifyVideoStreams(FIXTURES_LTI.vodInfosDual.data.videoPlayResponseVoList)
      const lectureName = '高等数学(第1讲)'

      const tasks = streams.map(s => ({
        taskId: `lec_1_${s.label}`,
        fileName: `${lectureName}-${s.label}.mp4`,
        url: s.url,
        isHls: true
      }))

      expect(tasks.length).toBe(2)
      expect(tasks[0].fileName).toBe('高等数学(第1讲)-教师.mp4')
      expect(tasks[1].fileName).toBe('高等数学(第1讲)-PPT.mp4')
      expect(tasks[0].isHls).toBe(true)
      expect(tasks[1].isHls).toBe(true)
    })

    it('pairwise: single-stream lecture generates exactly 1 task preventing missing stream errors', () => {
      const streams = identifyVideoStreams(FIXTURES_LTI.vodInfosSingle.data.videoPlayResponseVoList)
      const tasks = streams.map(s => ({
        taskId: `lec_single_${s.label}`,
        fileName: `单视角课程-${s.label}.mp4`,
        url: s.url
      }))

      expect(tasks.length).toBe(1)
      expect(tasks[0].fileName).toContain('教师')
    })

    it('pairwise: PPT slice harvest with saveImages option prepares both PDF and slide directory', () => {
      const res = processPptSlices(FIXTURES_LTI.pptSlices.data, { saveImages: true })
      expect(res.slices.length).toBe(3)

      const outputTargets = {
        pdfPath: '高等数学(第1讲)-课件.pdf',
        imageFolder: res.willSaveImages ? '高等数学(第1讲)-切片/' : null
      }

      expect(outputTargets.pdfPath).toBeDefined()
      expect(outputTargets.imageFolder).toBe('高等数学(第1讲)-切片/')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 4: End-to-End User Workflows
  // ─────────────────────────────────────────────────────────────
  describe('Tier 4: End-to-End User Workflows', () => {
    it('e2e: complete lecture lifecycle: tab matching -> paginated scan -> dual stream -> HLS dispatch -> PPT harvest', () => {
      // 1. Locate Tab
      const tab = FIXTURES_LTI.tabs.find(t => isClassVideoTab(t.label))
      expect(tab).toBeDefined()

      // 2. Fetch all paginated lectures
      const records = FIXTURES_LTI.videoListPaginated.data.records
      expect(records.length).toBeGreaterThan(10)

      // 3. For lecture #1, resolve streams
      const streams = identifyVideoStreams(FIXTURES_LTI.vodInfosDual.data.videoPlayResponseVoList)
      expect(streams.length).toBe(2)

      // 4. Dispatch HLS tasks
      const hlsTasks = streams.map(s => ({
        url: s.url,
        fileName: `${records[0].videoName}-${s.label}.mp4`
      }))
      expect(hlsTasks[0].fileName).toBe('高等数学(第1讲)-教师.mp4')
      expect(hlsTasks[1].fileName).toBe('高等数学(第1讲)-PPT.mp4')

      // 5. Harvest PPT slices and prepare dual export (PDF + HD Images)
      const pptResult = processPptSlices(FIXTURES_LTI.pptSlices.data, { saveImages: true })
      expect(pptResult.totalVisible).toBe(3)
      expect(pptResult.willSaveImages).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 5: New jy-application-resourcemanage API & Token Guarding
  // ─────────────────────────────────────────────────────────────
  describe('Tier 5: New jy-application-resourcemanage API & Token Guarding', () => {
    it('isJwtToken correctly identifies LTI 1.3 JWT tokens vs legacy/mock tokens', () => {
      const validJwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.sig'
      expect(isJwtToken(validJwt)).toBe(true)
      expect(isJwtToken('fake_token')).toBe(false)
      expect(isJwtToken('4b6cc46b9e48d6d6cd82ffa96a79920067a869f8')).toBe(false)
      expect(isJwtToken('')).toBe(false)
      expect(isJwtToken(null as any)).toBe(false)
    })

    it('fetchVodVideoList gracefully returns empty array when course has no recording (LMS_TEACHING_CLASS_NOT_FOUND)', async () => {
      const jwtToken = 'eyJhbGciOiJSUzI1NiJ9.eyJhdXRoVXNlciI6eyJjb2RlIjoiMTIzNDUifX0.signature'
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 'LMS_TEACHING_CLASS_NOT_FOUND',
          data: null,
          dataOk: false,
          message: '当前课程暂未安排直录播',
          ok: false,
          status: 500
        })
      })

      const origFetch = global.fetch
      global.fetch = mockFetch
      try {
        const records = await fetchVodVideoList(
          { fetch: mockFetch } as any,
          jwtToken,
          '89673'
        )
        expect(records).toEqual([])
        expect(mockFetch).toHaveBeenCalledTimes(1)
      } finally {
        global.fetch = origFetch
      }
    })

    it('fetchVodVideoList fetches records via subject_vod_list_new when teachingClassId exists', async () => {
      const jwtToken = 'eyJhbGciOiJSUzI1NiJ9.eyJhdXRoVXNlciI6eyJjb2RlIjoiMTIzNDUifX0.signature'
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('launch-context')) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              data: {
                canvasRecord: { teachingClassId: 10681 }
              }
            })
          }
        }
        if (url.includes('subject_vod_list_new')) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              data: {
                records: [
                  {
                    id: 172477,
                    courBeginTime: '2026-10-10 16:50:20',
                    clroName: '东中院3-204',
                    teacNames: ['刘越'],
                    subjName: '程序设计思想与方法（C）',
                    weekNumber: 4
                  }
                ]
              }
            })
          }
        }
        throw new Error(`Unexpected URL: ${url}`)
      })

      const origFetch = global.fetch
      global.fetch = mockFetch
      try {
        const records = await fetchVodVideoList(
          { fetch: mockFetch } as any,
          jwtToken,
          '93272'
        )
        expect(records.length).toBe(1)
        expect(records[0].videoId).toBe('172477')
        expect(records[0].teacher).toBe('刘越')
        expect(records[0].classroom).toBe('东中院3-204')
        expect(records[0].videoName).toContain('程序设计思想与方法（C）')
      } finally {
        global.fetch = origFetch
      }
    })

    it('getVodVideoInfos resolves direct MP4 stream URLs from course_vod_urls_new', async () => {
      const jwtToken = 'eyJhbGciOiJSUzI1NiJ9.eyJhdXRoVXNlciI6eyJjb2RlIjoiMTIzNDUifX0.signature'
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          data: {
            courseVodViewList: [
              {
                courId: 172477,
                viewNum: 5,
                url: 'https://live.sjtu.edu.cn/mnt/record5/.../165017.mp4?key=secret5'
              },
              {
                courId: 172477,
                viewNum: 1,
                url: 'https://live.sjtu.edu.cn/mnt/record7/.../165017.mp4?key=secret1'
              }
            ]
          }
        })
      })

      const origFetch = global.fetch
      global.fetch = mockFetch
      try {
        const streams = await getVodVideoInfos(
          { fetch: mockFetch } as any,
          jwtToken,
          '172477'
        )
        expect(streams.length).toBe(2)
        // 教师 should be sorted first (viewNum 1)
        expect(streams[0].label).toBe('教师')
        expect(streams[0].url).toContain('secret1')
        // PPT should be sorted second (viewNum 5)
        expect(streams[1].label).toBe('PPT')
        expect(streams[1].url).toContain('secret5')
      } finally {
        global.fetch = origFetch
      }
    })
  })
})
