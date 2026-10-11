import { describe, it, expect, vi } from 'vitest'

// Mock electron window dependencies before production module import
vi.mock('../src/main/window', () => ({
  getIsQuitting: () => false,
  getMainWindow: () => null
}))

// Import real production implementations
import {
  isClassVideoTab as prodIsClassVideoTab,
  extractLectureNum as prodExtractLectureNum,
  identifyVideoStreams as prodIdentifyVideoStreams,
  buildClassVideoFileName
} from '../src/main/canvas/video-tokens'

import {
  isHlsStreamTask as prodIsHlsStreamTask
} from '../src/main/download-engine/shared'

import {
  resolveBundledFfmpeg as prodResolveBundledFfmpeg
} from '../src/main/canvas/hls-download'

import {
  processPptSlices as prodProcessPptSlices,
  formatSliceFileName as prodFormatSliceFileName,
  buildPptSliceDirName as prodBuildPptSliceDirName
} from '../src/main/canvas/ppt-download'

// Import contract reference implementations
import * as contracts from './helpers/contracts'

describe('Adversarial Stress Suite: LTI Video Scan & Dual-Stream Routing', () => {

  // =========================================================================
  // Section 1: isClassVideoTab Adversarial Probing
  // =========================================================================
  describe('1. isClassVideoTab Adversarial Tests', () => {
    it('accepts standard and extended video tab labels', () => {
      const validLabels = [
        '课堂视频',
        '课堂视频new',
        '课堂视频NEW',
        '课堂录像',
        '在线课堂',
        'class video',
        'Class Video',
        'CLASS VIDEO',
        'Class Video (LTI 1.3)',
        'Class Video Tool',
        '【课堂视频】',
        '录像与课堂视频'
      ]
      for (const label of validLabels) {
        expect(prodIsClassVideoTab(label), `Should accept: "${label}"`).toBe(true)
        expect(contracts.isClassVideoTab(label)).toBe(true)
      }
    })

    it('handles whitespace variations (leading, trailing, tabs, newlines)', () => {
      expect(prodIsClassVideoTab('  课堂视频  ')).toBe(true)
      expect(prodIsClassVideoTab('\t课堂录像\n')).toBe(true)
      expect(prodIsClassVideoTab('  Class Video  ')).toBe(true)
      expect(prodIsClassVideoTab('class   video')).toBe(false) // interior whitespace breaks exact keyword match
    })

    it('rejects standard non-video Canvas tabs', () => {
      const nonVideoTabs = [
        '主页',
        '公告',
        '模块',
        '作业',
        '讨论',
        '成绩',
        '人员',
        '文件',
        '课程大纲',
        '问卷',
        '设置',
        'Zoom',
        'Syllabus',
        'Assignments',
        'Modules',
        'Discussions',
        'Grades',
        'Files'
      ]
      for (const tab of nonVideoTabs) {
        expect(prodIsClassVideoTab(tab), `Should reject: "${tab}"`).toBe(false)
        expect(contracts.isClassVideoTab(tab)).toBe(false)
      }
    })

    it('handles falsy and malformed inputs gracefully without throwing', () => {
      expect(prodIsClassVideoTab('')).toBe(false)
      expect(prodIsClassVideoTab(null as any)).toBe(false)
      expect(prodIsClassVideoTab(undefined as any)).toBe(false)
    })

    it('evaluates semantic ambiguity tabs', () => {
      // Tabs that mention "视频" but are not class video LTI tool
      // Documenting current behavior:
      expect(prodIsClassVideoTab('课堂视频作业')).toBe(true) // contains '课堂视频'
      expect(prodIsClassVideoTab('视频作业')).toBe(false)
      expect(prodIsClassVideoTab('教学视频')).toBe(false)
      expect(prodIsClassVideoTab('微课视频')).toBe(false)
    })
  })

  // =========================================================================
  // Section 2: extractLectureNum Adversarial Probing
  // =========================================================================
  describe('2. extractLectureNum Adversarial Tests', () => {
    describe('2.1 Standard Arabic Numbering Patterns', () => {
      it('parses standard 第X讲 / 第X次课 / 第X课', () => {
        expect(prodExtractLectureNum('第1讲')).toBe(1)
        expect(prodExtractLectureNum('高等数学(第01讲)')).toBe(1)
        expect(prodExtractLectureNum('大学物理 第15次课')).toBe(15)
        expect(prodExtractLectureNum('第3课 导论')).toBe(3)
        expect(prodExtractLectureNum('第 48 讲：期末总结')).toBe(48)
        expect(prodExtractLectureNum('第0讲 导读')).toBe(0)
      })
    })

    describe('2.2 Chinese Numerals Handling & Limits', () => {
      it('parses Chinese numerals 1 to 12', () => {
        expect(prodExtractLectureNum('第一讲')).toBe(1)
        expect(prodExtractLectureNum('第二讲')).toBe(2)
        expect(prodExtractLectureNum('第三次课')).toBe(3)
        expect(prodExtractLectureNum('第四讲')).toBe(4)
        expect(prodExtractLectureNum('第五讲')).toBe(5)
        expect(prodExtractLectureNum('第六讲')).toBe(6)
        expect(prodExtractLectureNum('第七讲')).toBe(7)
        expect(prodExtractLectureNum('第八讲')).toBe(8)
        expect(prodExtractLectureNum('第九讲')).toBe(9)
        expect(prodExtractLectureNum('第十讲')).toBe(10)
        expect(prodExtractLectureNum('第十一讲')).toBe(11)
        expect(prodExtractLectureNum('第十二讲')).toBe(12)
      })

      it('observes behavior on Chinese numerals above 12 (e.g. 第十三讲 ~ 第二十讲)', () => {
        // Document empirical behavior: CHINESE_NUM_MAP only defines up to 12.
        // Therefore 第十三讲 ~ 第二十讲 cannot resolve via CHINESE_NUM_MAP.
        const lec13 = prodExtractLectureNum('高等数学 第十三讲')
        const lec14 = prodExtractLectureNum('高等数学 第十四讲')
        const lec16 = prodExtractLectureNum('大学物理 第十六次课')
        const lec20 = prodExtractLectureNum('计算机网络 第二十讲')

        // Document that current implementation returns 0 because CHINESE_NUM_MAP caps at 12
        expect(lec13).toBe(0)
        expect(lec14).toBe(0)
        expect(lec16).toBe(0)
        expect(lec20).toBe(0)
      })
    })

    describe('2.3 English & Roman Patterns', () => {
      it('parses English lecture titles', () => {
        expect(prodExtractLectureNum('Lecture 1')).toBe(1)
        expect(prodExtractLectureNum('LECTURE 12')).toBe(12)
        expect(prodExtractLectureNum('Lec 05: Dynamic Programming')).toBe(5)
        expect(prodExtractLectureNum('Class 3: Machine Learning')).toBe(3)
        expect(prodExtractLectureNum('Computer Science Lecture 100')).toBe(100)
      })

      it('observes Roman numerals behavior', () => {
        // Roman numerals like Lecture III, Lecture IV:
        // Document empirical behavior: not matched by m3 (which requires \d+),
        // falls through to 0
        expect(prodExtractLectureNum('Lecture I')).toBe(0)
        expect(prodExtractLectureNum('Lecture II')).toBe(0)
        expect(prodExtractLectureNum('Lecture III')).toBe(0)
        expect(prodExtractLectureNum('Lecture IV')).toBe(0)
        expect(prodExtractLectureNum('Lecture X')).toBe(0)
      })
    })

    describe('2.4 Standalone & Delimited Digits', () => {
      it('extracts standalone leading and trailing digits', () => {
        expect(prodExtractLectureNum('01_导论')).toBe(1)
        expect(prodExtractLectureNum('导论_02')).toBe(2)
        expect(prodExtractLectureNum('003-算法')).toBe(3)
        expect(prodExtractLectureNum('[04] 线性代数')).toBe(4)
      })

      it('evaluates collision between dates, course codes, and lecture digits', () => {
        // Case: date-prefixed lecture with explicit 第X讲:
        // m1 (第X讲) has precedence over date digits!
        expect(prodExtractLectureNum('2026-03-01 高等数学 第1讲')).toBe(1)
        expect(prodExtractLectureNum('2026-03-02 大学物理 第02次课')).toBe(2)

        // Case: date-prefixed WITHOUT 第X讲 or Lecture keyword:
        // "2026-03-01 导论": m4 matches 03 (month) or 01 (day)
        const dateOnly = prodExtractLectureNum('2026-03-01 导论')
        // In "2026-03-01", 2026 has 4 digits (>3), so m4 matches 03
        expect(dateOnly).toBe(3)

        // Case: Course code without lecture number:
        // "CS201 计算机导论": matches 201
        expect(prodExtractLectureNum('CS201 计算机导论')).toBe(201)
      })

      it('returns 0 for titles without any numbers', () => {
        expect(prodExtractLectureNum('高等数学答疑')).toBe(0)
        expect(prodExtractLectureNum('期末考试说明')).toBe(0)
        expect(prodExtractLectureNum('绪论与课程要求')).toBe(0)
        expect(prodExtractLectureNum('')).toBe(0)
        expect(prodExtractLectureNum(null as any)).toBe(0)
      })
    })
  })

  // =========================================================================
  // Section 3: identifyVideoStreams Adversarial Probing
  // =========================================================================
  describe('3. identifyVideoStreams Adversarial Tests', () => {
    it('handles empty, null, and non-array inputs cleanly', () => {
      expect(prodIdentifyVideoStreams([])).toEqual([])
      expect(prodIdentifyVideoStreams(null as any)).toEqual([])
      expect(prodIdentifyVideoStreams(undefined as any)).toEqual([])
      expect(prodIdentifyVideoStreams('invalid' as any)).toEqual([])
      expect(prodIdentifyVideoStreams([null, undefined, {}])).toEqual([])
      expect(prodIdentifyVideoStreams([{ rtmpUrlHdv: '' }, { url: '' }])).toEqual([])
    })

    describe('3.1 Single Stream Scenarios', () => {
      it('single stream with channelNum=0 and standard teacher name -> 教师', () => {
        const single = [
          { cdviChannelNum: 0, channelName: '教师全景', rtmpUrlHdv: 'https://live.sjtu.edu.cn/tea.m3u8' }
        ]
        const res = prodIdentifyVideoStreams(single)
        expect(res).toHaveLength(1)
        expect(res[0].label).toBe('教师')
        expect(res[0].channelNum).toBe(0)
        expect(res[0].url).toBe('https://live.sjtu.edu.cn/tea.m3u8')
      })

      it('single stream with channelNum=1 but not named PPT -> safely forced to 教师', () => {
        const singleMisconfigured = [
          { cdviChannelNum: 1, channelName: '主视角摄像机', rtmpUrlHdv: 'https://live.sjtu.edu.cn/cam.m3u8' }
        ]
        const res = prodIdentifyVideoStreams(singleMisconfigured)
        expect(res).toHaveLength(1)
        expect(res[0].label).toBe('教师')
      })

      it('single stream explicitly named PPT -> preserved as PPT', () => {
        const singlePpt = [
          { cdviChannelNum: 1, channelName: '录屏PPT课件', rtmpUrlHdv: 'https://live.sjtu.edu.cn/ppt.m3u8' }
        ]
        const res = prodIdentifyVideoStreams(singlePpt)
        expect(res).toHaveLength(1)
        expect(res[0].label).toBe('PPT')
      })
    })

    describe('3.2 Dual Streams Normal and Swapped Channels', () => {
      it('dual streams with normal channel indices (0: 教师, 1: PPT)', () => {
        const dualNormal = [
          { cdviChannelNum: 0, channelName: '教师视角', rtmpUrlHdv: 'https://live.sjtu.edu.cn/tea.m3u8' },
          { cdviChannelNum: 1, channelName: '电脑PPT', rtmpUrlHdv: 'https://live.sjtu.edu.cn/ppt.m3u8' }
        ]
        const res = prodIdentifyVideoStreams(dualNormal)
        expect(res).toHaveLength(2)
        expect(res[0].label).toBe('教师')
        expect(res[1].label).toBe('PPT')
      })

      it('dual streams with reversed order in API response array (PPT first, Teacher second)', () => {
        const dualReversed = [
          { cdviChannelNum: 1, channelName: '电脑PPT', rtmpUrlHdv: 'https://live.sjtu.edu.cn/ppt.m3u8' },
          { cdviChannelNum: 0, channelName: '教师摄像', rtmpUrlHdv: 'https://live.sjtu.edu.cn/tea.m3u8' }
        ]
        const res = prodIdentifyVideoStreams(dualReversed)
        expect(res).toHaveLength(2)
        expect(res[0].label).toBe('PPT')
        expect(res[1].label).toBe('教师')

        // When sorted for download ordering:
        const sorted = [...res].sort((a, b) => {
          if (a.label === '教师' && b.label !== '教师') return -1
          if (b.label === '教师' && a.label !== '教师') return 1
          if (a.label === 'PPT' && b.label !== 'PPT') return -1
          if (b.label === 'PPT' && a.label !== 'PPT') return 1
          return 0
        })
        expect(sorted[0].label).toBe('教师')
        expect(sorted[1].label).toBe('PPT')
      })

      it('observes dual streams with swapped channel numbers (channel 0 is PPT, channel 1 is 教师)', () => {
        // Here, channelNum=0 has name '电脑PPT', and channelNum=1 has name '主讲教师'.
        const swapped = [
          { cdviChannelNum: 0, channelName: '电脑PPT', rtmpUrlHdv: 'https://live.sjtu.edu.cn/ppt.m3u8' },
          { cdviChannelNum: 1, channelName: '主讲教师', rtmpUrlHdv: 'https://live.sjtu.edu.cn/tea.m3u8' }
        ]
        const res = prodIdentifyVideoStreams(swapped)
        expect(res).toHaveLength(2)

        // Stream 0: name has 'PPT' -> label = 'PPT'
        expect(res[0].label).toBe('PPT')

        // Stream 1: name has '主讲教师', but cdviChannelNum === 1 ->
        // Because condition is: name.includes('PPT') || name.includes('电脑') || channelNum === 1
        // channelNum === 1 causes it to be labeled 'PPT'!
        // Document empirical behavior:
        expect(res[1].label).toBe('PPT')
      })
    })

    describe('3.3 Multi-Stream & Property Variations', () => {
      it('supports url fallback when rtmpUrlHdv is missing', () => {
        const streams = [
          { channelNum: 0, channelName: '教师', url: 'https://live.sjtu.edu.cn/tea.m3u8' }
        ]
        const res = prodIdentifyVideoStreams(streams)
        expect(res).toHaveLength(1)
        expect(res[0].url).toBe('https://live.sjtu.edu.cn/tea.m3u8')
        expect(res[0].label).toBe('教师')
      })

      it('identifies 全景 panorama channel (channelNum: 2 or name includes 全景)', () => {
        const streams = [
          { cdviChannelNum: 0, channelName: '主讲教师', rtmpUrlHdv: 'https://live.sjtu.edu.cn/tea.m3u8' },
          { cdviChannelNum: 1, channelName: '电脑课件PPT', rtmpUrlHdv: 'https://live.sjtu.edu.cn/ppt.m3u8' },
          { cdviChannelNum: 2, channelName: '全景镜头', rtmpUrlHdv: 'https://live.sjtu.edu.cn/pano.m3u8' }
        ]
        const res = prodIdentifyVideoStreams(streams)
        expect(res).toHaveLength(3)
        expect(res[0].label).toBe('教师')
        expect(res[1].label).toBe('PPT')
        expect(res[2].label).toBe('全景')
      })
    })
  })

  // =========================================================================
  // Section 4: isHlsStreamTask Adversarial Probing
  // =========================================================================
  describe('4. isHlsStreamTask Adversarial Tests', () => {
    it('accurately identifies canvas-class-video source tasks as HLS', () => {
      expect(prodIsHlsStreamTask({ source: 'canvas-class-video' })).toBe(true)
      expect(prodIsHlsStreamTask({ source: 'canvas-class-video', url: 'https://live.sjtu.edu.cn/stream.m3u8' })).toBe(true)
      expect(prodIsHlsStreamTask({ source: 'canvas-class-video', url: 'https://anything.com/video' })).toBe(true)
    })

    it('accurately identifies tasks with isHls: true flag', () => {
      expect(prodIsHlsStreamTask({ isHls: true })).toBe(true)
      expect(prodIsHlsStreamTask({ isHls: true, url: '' })).toBe(true)
      expect(prodIsHlsStreamTask({ isHls: false })).toBe(false)
      expect(prodIsHlsStreamTask({ isHls: 'true' as any })).toBe(false) // strict boolean check
    })

    it('identifies diverse M3U8 URL patterns', () => {
      const m3u8Urls = [
        'https://live.sjtu.edu.cn/live/stream.m3u8',
        'https://live.sjtu.edu.cn/live/stream.M3U8',
        'https://live.sjtu.edu.cn/live/stream.m3u8?token=xyz123',
        'https://live.sjtu.edu.cn/live/stream.m3u8?auth=1&time=100#track1',
        'https://live.sjtu.edu.cn/live/stream.m3u8#live',
        'http://localhost:8080/vod/playlist.m3u8'
      ]
      for (const url of m3u8Urls) {
        expect(prodIsHlsStreamTask({ url }), `Should detect HLS for ${url}`).toBe(true)
        expect(contracts.isHlsStreamTask({ url })).toBe(true)
      }
    })

    it('rejects non-HLS resources (direct MP4, PDF, HTML, etc.)', () => {
      const nonHlsTasks = [
        { url: 'https://s3.jcloud.sjtu.edu.cn/bucket/lecture.mp4' },
        { url: 'https://oc.sjtu.edu.cn/files/handout.pdf' },
        { url: 'https://oc.sjtu.edu.cn/login' },
        { url: 'https://vshare.sjtu.edu.cn/play/video.mp4?m3u8=false' },
        { url: 'https://live.sjtu.edu.cn/stream.m3u8.key' }, // encryption key is not an HLS playlist task
        { url: '' },
        {}
      ]
      for (const task of nonHlsTasks) {
        expect(prodIsHlsStreamTask(task), `Should not be HLS: ${JSON.stringify(task)}`).toBe(false)
        expect(contracts.isHlsStreamTask(task)).toBe(false)
      }
    })

    it('handles falsy task specs safely without throwing', () => {
      expect(prodIsHlsStreamTask(null)).toBe(false)
      expect(prodIsHlsStreamTask(undefined)).toBe(false)
      expect(prodIsHlsStreamTask(0 as any)).toBe(false)
      expect(prodIsHlsStreamTask('' as any)).toBe(false)
    })
  })

  // =========================================================================
  // Section 5: Cross-Layer Production & Contract Symmetry
  // =========================================================================
  describe('5. Production and Contract Symmetry Verification', () => {
    it('verifies complete consistency between production code and test contract helpers', () => {
      // 1. isClassVideoTab
      const tabSamples = ['课堂视频', '课堂录像', '在线课堂', 'class video', '讨论区', '']
      for (const t of tabSamples) {
        expect(prodIsClassVideoTab(t)).toBe(contracts.isClassVideoTab(t))
      }

      // 2. extractLectureNum
      const titleSamples = ['高等数学(第1讲)', '大学物理 第02次课', '线性代数 第一讲', 'Lecture 5', '01_导论', '无序号']
      for (const t of titleSamples) {
        expect(prodExtractLectureNum(t)).toBe(contracts.extractLectureNum(t))
      }

      // 3. identifyVideoStreams
      const streamSamples = [
        [{ cdviChannelNum: 0, channelName: '教师', rtmpUrlHdv: 'http://a.m3u8' }],
        [{ cdviChannelNum: 1, channelName: 'PPT', rtmpUrlHdv: 'http://b.m3u8' }],
        []
      ]
      for (const s of streamSamples) {
        expect(prodIdentifyVideoStreams(s)).toEqual(contracts.identifyVideoStreams(s))
      }

      // 4. isHlsStreamTask
      const specSamples = [
        { source: 'canvas-class-video' },
        { isHls: true },
        { url: 'http://a.m3u8' },
        { url: 'http://a.mp4' },
        null
      ]
      for (const sp of specSamples) {
        expect(prodIsHlsStreamTask(sp)).toBe(contracts.isHlsStreamTask(sp))
      }
    })
  })
})
