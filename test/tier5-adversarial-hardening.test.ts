import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ─── Mock Electron & Window ─────────────────────────────────────────
vi.mock('../src/main/window', () => ({
  getIsQuitting: () => false,
  getMainWindow: () => null
}))

vi.mock('electron', () => {
  const listeners: Record<string, Function[]> = {}
  return {
    BrowserWindow: class {
      loadURL = vi.fn().mockResolvedValue(undefined)
      webContents = {
        getURL: () => 'https://oc.sjtu.edu.cn',
        executeJavaScript: vi.fn().mockResolvedValue('<html></html>'),
        setAudioMuted: vi.fn()
      }
      isDestroyed = () => false
      destroy = vi.fn()
    },
    app: {
      whenReady: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockReturnValue(true),
      quit: vi.fn(),
      getPath: (name: string) => join(tmpdir(), `sjtu-test-${name}`)
    },
    session: {
      fromPartition: vi.fn()
    },
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn((event: string, handler: Function) => {
        if (!listeners[event]) listeners[event] = []
        listeners[event].push(handler)
      })
    }
  }
})

// ─── Import Production Modules ───────────────────────────────────────
import {
  isAllowedSjtuUrl,
  interceptDownloadRedirect,
  calculateBackoffMs
} from '../src/main/download-engine/domain-guard'

import {
  verifyDownloadIntegrity,
  assertDownloadIntegrity,
  isHtmlExtension,
  FileIntegrityError
} from '../src/main/download-engine/integrity'

import {
  sanitizeFsName
} from '../src/shared/utils'

import {
  extractLectureNum,
  identifyVideoStreams
} from '../src/main/canvas/video-tokens'

import {
  processPptSlices,
  formatSliceFileName,
  buildPptSliceDirName,
  buildPptFileNameForLecture
} from '../src/main/canvas/ppt-download'

import {
  resolveBundledFfmpeg
} from '../src/main/canvas/hls-download'

import {
  isTransientCloudError,
  sharedActiveCount,
  hasOngoingTasks,
  active,
  cloudActive,
  pendingLocal,
  pausedLocal,
  pendingCloud,
  pausedCloud
} from '../src/main/download-engine/shared'

import {
  cloudRemotePath
} from '../src/main/download-engine/cloud'

import {
  getDynamicChunkSize
} from '../src/main/cloudpan'

import {
  parseNestedChapterHtml,
  resolveCnmoocResourceUrl,
  classifyCnmoocResource,
  inferCnmoocExt
} from '../src/main/cnmooc/api'

import {
  VsjtuVodResolver
} from '../src/main/download-engine/vsjtu-resolver'

import {
  extractCanvasFileIds,
  extractVideoIframes,
  extractVshareLinks,
  isForbiddenError,
  CanvasApiError
} from '../src/main/canvas/api'

import {
  extractJwtExpiry,
  pickAccountInfo
} from '../src/main/auth'

import {
  parseSegments
} from '../src/main/canvas/hls-download'

// ─────────────────────────────────────────────────────────────────────
// Tier 5 Adversarial Coverage Hardening Suite
// ─────────────────────────────────────────────────────────────────────
describe('Tier 5 Adversarial Coverage Hardening Suite', () => {

  // ===================================================================
  // 1. Domain Guard & 302 Redirect Interception (R5-F1, R5-F2, R2-F3)
  // ===================================================================
  describe('1. Domain Guard & 302 Redirect Interception (R5-F1, R5-F2, R2-F3)', () => {
    describe('1.1 Hostname & Protocol Boundary Stress', () => {
      it('rejects malicious subdomains and domain-suffix spoofing', () => {
        expect(isAllowedSjtuUrl('https://sjtu.edu.cn.attacker.org/leak')).toBe(false)
        expect(isAllowedSjtuUrl('https://evil-sjtu.edu.cn/leak')).toBe(false)
        expect(isAllowedSjtuUrl('https://sjtu.cn.evil.com/api')).toBe(false)
        expect(isAllowedSjtuUrl('https://s3.jcloud.sjtu.edu.cn.phishing.org')).toBe(false)
        expect(isAllowedSjtuUrl('https://oc.sjtu.edu.cn@attacker.com')).toBe(false)
      })

      it('rejects non-HTTPS protocols on production SJTU domains', () => {
        expect(isAllowedSjtuUrl('http://oc.sjtu.edu.cn/courses')).toBe(false)
        expect(isAllowedSjtuUrl('ftp://oc.sjtu.edu.cn/files')).toBe(false)
        expect(isAllowedSjtuUrl('file:///etc/passwd')).toBe(false)
        expect(isAllowedSjtuUrl('javascript:alert(1)')).toBe(false)
        expect(isAllowedSjtuUrl('data:text/html,<html></html>')).toBe(false)
      })

      it('safely handles malformed and irregular inputs', () => {
        expect(isAllowedSjtuUrl('')).toBe(false)
        expect(isAllowedSjtuUrl(null as any)).toBe(false)
        expect(isAllowedSjtuUrl(undefined as any)).toBe(false)
        expect(isAllowedSjtuUrl('not-a-valid-url')).toBe(false)
        expect(isAllowedSjtuUrl('   ')).toBe(false)
      })

      it('accepts legitimate SJTU domains case-insensitively', () => {
        expect(isAllowedSjtuUrl('HTTPS://OC.SJTU.EDU.CN/api/v1/courses')).toBe(true)
        expect(isAllowedSjtuUrl('https://S3.JCLOUD.SJTU.EDU.CN/canvas-bucket/key')).toBe(true)
        expect(isAllowedSjtuUrl('https://CNMOOC.SJTU.CN/portal/session')).toBe(true)
        expect(isAllowedSjtuUrl('https://v.sjtu.edu.cn/jy-application/video')).toBe(true)
      })
    })

    describe('1.2 302 Redirect Interception (R2-F3)', () => {
      const origin = 'https://oc.sjtu.edu.cn/courses/101/files/555/download'

      it('intercepts redirect to jAccount login portal (session expired)', () => {
        const res = interceptDownloadRedirect('https://jaccount.sjtu.edu.cn/jaccount/jalogin?sid=123', origin)
        expect(res.action).toBe('abort')
        expect(res.reason).toContain('Canvas 会话失效')
      })

      it('intercepts redirect to Canvas internal login page', () => {
        const res1 = interceptDownloadRedirect('https://oc.sjtu.edu.cn/login/canvas', origin)
        expect(res1.action).toBe('abort')
        expect(res1.reason).toContain('Canvas 会话失效')

        const res2 = interceptDownloadRedirect('/login', origin)
        expect(res2.action).toBe('abort')
        expect(res2.reason).toContain('Canvas 会话失效')
      })

      it('intercepts redirect to external open-redirect targets', () => {
        const res = interceptDownloadRedirect('https://malicious.evil.com/payload.exe', origin)
        expect(res.action).toBe('abort')
        expect(res.reason).toContain('禁止向非交大受信域重定向')
      })

      it('permits valid pre-signed redirect to S3 storage', () => {
        const target = 'https://s3.jcloud.sjtu.edu.cn/canvas-files/attachment?AWSAccessKeyId=KEY&Signature=SIG'
        const res = interceptDownloadRedirect(target, origin)
        expect(res.action).toBe('follow')
        expect(res.nextUrl).toBe(target)
      })
    })

    describe('1.3 Rate Limit Backoff Calculation (R5-F2)', () => {
      it('calculates backoff from numeric Retry-After', () => {
        expect(calculateBackoffMs('5', 1, 60000, false)).toBe(5000)
        expect(calculateBackoffMs('120', 1, 60000, false)).toBe(60000) // clamped to max
      })

      it('calculates backoff from HTTP-Date header', () => {
        const futureDate = new Date(Date.now() + 15000).toUTCString()
        const delay = calculateBackoffMs(futureDate, 1, 60000, false)
        expect(delay).toBeGreaterThan(10000)
        expect(delay).toBeLessThanOrEqual(16000)
      })

      it('falls back to exponential backoff when Retry-After is absent or invalid', () => {
        expect(calculateBackoffMs(null, 1, 60000, false)).toBe(1000) // 1000 * 2^0
        expect(calculateBackoffMs(undefined, 2, 60000, false)).toBe(2000) // 1000 * 2^1
        expect(calculateBackoffMs(undefined, 4, 60000, false)).toBe(8000) // 1000 * 2^3
        expect(calculateBackoffMs('invalid-date', 3, 60000, false)).toBe(4000)
      })
    })
  })

  // ===================================================================
  // 2. Download File Integrity Guard (R2-F4)
  // ===================================================================
  describe('2. Download File Integrity Guard (R2-F4)', () => {
    let testDir: string

    beforeEach(() => {
      testDir = mkdtempSync(join(tmpdir(), 'integrity-adv-'))
    })

    afterEach(() => {
      try {
        if (existsSync(testDir)) {
          rmSync(testDir, { recursive: true, force: true })
        }
      } catch { /* ignore */ }
    })

    it('rejects 0-byte downloaded files as corrupted', () => {
      const p = join(testDir, 'empty.pdf')
      writeFileSync(p, Buffer.alloc(0))

      const res = verifyDownloadIntegrity(p, 1, false)
      expect(res.valid).toBe(false)
      expect(res.error).toContain('文件大小为 0 字节')

      expect(() => assertDownloadIntegrity(p, 1, false)).toThrow(FileIntegrityError)
    })

    it('detects and rejects HTML error pages disguised as non-HTML resources', () => {
      const p = join(testDir, 'error.pdf')
      writeFileSync(p, '<!DOCTYPE html><html><head><title>404 Not Found</title></head><body>Error</body></html>', 'utf-8')

      const res = verifyDownloadIntegrity(p, 1, false)
      expect(res.valid).toBe(false)
      expect(res.error).toContain('文件内容为 HTML 网页')

      expect(() => assertDownloadIntegrity(p, 1, false)).toThrow(FileIntegrityError)
    })

    it('allows genuine HTML documents when file extension is .html or .htm', () => {
      const p = join(testDir, 'page.html')
      writeFileSync(p, '<!DOCTYPE html><html><body>Normal Syllabus Content</body></html>', 'utf-8')

      const res = verifyDownloadIntegrity(p, 1, true)
      expect(res.valid).toBe(true)
    })

    it('allows genuine binary files (e.g. PDF magic %PDF-)', () => {
      const p = join(testDir, 'valid.pdf')
      writeFileSync(p, Buffer.from('%PDF-1.4\n%some binary data...'), 'utf-8')

      const res = verifyDownloadIntegrity(p, 1, false)
      expect(res.valid).toBe(true)
    })

    it('identifies html extensions accurately', () => {
      expect(isHtmlExtension('course/syllabus.html')).toBe(true)
      expect(isHtmlExtension('course/index.htm')).toBe(true)
      expect(isHtmlExtension('course/index.XHTML')).toBe(true)
      expect(isHtmlExtension('lecture.pdf')).toBe(false)
      expect(isHtmlExtension('video.mp4')).toBe(false)
    })
  })

  // ===================================================================
  // 3. File System Sanitization & Security Boundary
  // ===================================================================
  describe('3. File System Sanitization & Security Boundary', () => {
    it('sanitizes directory separators to prevent directory escape', () => {
      const dangerous = '../../../../etc/passwd'
      const clean = sanitizeFsName(dangerous)
      expect(clean).not.toContain('/')
      expect(clean).not.toContain('\\')
      expect(clean).toBe('.._.._.._.._etc_passwd')
    })

    it('strips Windows illegal filename characters (<>:"/\\|?*)', () => {
      const illegal = 'Lecture: Introduction <Part 1> | Chapter "1"? *'
      const clean = sanitizeFsName(illegal)
      expect(clean).not.toMatch(/[<>:"/\\|?*]/)
    })

    it('strips ASCII control characters (0x00 - 0x1F)', () => {
      const control = 'bad\x00file\x01name\x1F.mp4'
      const clean = sanitizeFsName(control)
      expect(clean).not.toMatch(/[\x00-\x1F]/)
    })

    it('trims trailing dots and spaces that crash Windows filesystem APIs', () => {
      const trailing = 'My Folder Name...   '
      const clean = sanitizeFsName(trailing)
      expect(clean.endsWith('.')).toBe(false)
      expect(clean.endsWith(' ')).toBe(false)
    })

    it('enforces safe max length on excessively long filenames', () => {
      const extremelyLong = 'a'.repeat(500)
      const clean = sanitizeFsName(extremelyLong)
      expect(clean.length).toBeLessThanOrEqual(180)
    })
  })

  // ===================================================================
  // 4. Classroom Video & PPT Slices Hardening (R2-F5, R2-F6, R2-F7)
  // ===================================================================
  describe('4. Classroom Video & PPT Slices Hardening (R2-F5, R2-F6, R2-F7)', () => {
    describe('4.1 Lecture Number Extraction Multi-Pattern Parsing', () => {
      it('correctly extracts standard Arabic numeral lectures', () => {
        expect(extractLectureNum('计算机网络(第1讲)')).toBe(1)
        expect(extractLectureNum('大学物理 第15次课')).toBe(15)
        expect(extractLectureNum('操作系统原理 第 08 讲')).toBe(8)
      })

      it('correctly extracts Chinese numeral lectures', () => {
        expect(extractLectureNum('高等数学(第一讲)')).toBe(1)
        expect(extractLectureNum('线性代数 第十讲')).toBe(10)
        expect(extractLectureNum('数值分析 第十二讲')).toBe(12)
      })

      it('correctly extracts English lecture notations', () => {
        expect(extractLectureNum('Lecture 04: Concurrency')).toBe(4)
        expect(extractLectureNum('CS101 Lec 7 - Graphs')).toBe(7)
        expect(extractLectureNum('Class 2 Intro')).toBe(2)
      })

      it('correctly extracts prefix/suffix numbers', () => {
        expect(extractLectureNum('03_内存管理')).toBe(3)
        expect(extractLectureNum('期末复习_18')).toBe(18)
      })

      it('returns 0 for unnumbered or malformed lectures', () => {
        expect(extractLectureNum('绪论')).toBe(0)
        expect(extractLectureNum('')).toBe(0)
        expect(extractLectureNum(null as any)).toBe(0)
      })
    })

    describe('4.2 Video Stream Classification & Single-Stream Tolerance', () => {
      it('returns empty array when rawStreams is empty or null', () => {
        expect(identifyVideoStreams([])).toEqual([])
        expect(identifyVideoStreams(null as any)).toEqual([])
      })

      it('correctly classifies dual stream (Teacher & PPT)', () => {
        const raw = [
          { channelNum: 0, channelName: '教师主视角', rtmpUrlHdv: 'https://live.sjtu.edu.cn/teacher.m3u8' },
          { channelNum: 1, channelName: 'PPT电脑桌面', rtmpUrlHdv: 'https://live.sjtu.edu.cn/ppt.m3u8' }
        ]
        const streams = identifyVideoStreams(raw)
        expect(streams.length).toBe(2)
        expect(streams.find(s => s.label === '教师')).toBeDefined()
        expect(streams.find(s => s.label === 'PPT')).toBeDefined()
      })

      it('applies defensive single-stream fallback to prevent mislabeling as PPT', () => {
        const single = [
          { channelNum: 1, channelName: '主视频', rtmpUrlHdv: 'https://live.sjtu.edu.cn/only.m3u8' }
        ]
        const streams = identifyVideoStreams(single)
        expect(streams.length).toBe(1)
        // If only 1 stream exists and name doesn't contain PPT, label defaults to '教师'
        expect(streams[0].label).toBe('教师')
      })
    })

    describe('4.3 High-Definition PPT Slices Harvester', () => {
      it('filters out hidden slides (hide === 1 or hide === "1") and sorts ascending', () => {
        const raw = [
          { ivsVideoId: 101, createSec: 120, pptImgUrl: 'https://s3/2.jpg', hide: 0 },
          { ivsVideoId: 101, createSec: 60, pptImgUrl: 'https://s3/1.jpg', hide: '0' },
          { ivsVideoId: 101, createSec: 90, pptImgUrl: 'https://s3/hidden.jpg', hide: 1 },
          { ivsVideoId: 101, createSec: 150, pptImgUrl: 'https://s3/hidden2.jpg', hide: '1' }
        ]
        const { slices, totalVisible } = processPptSlices(raw)
        expect(totalVisible).toBe(2)
        expect(slices.length).toBe(2)
        expect(slices[0].createSec).toBe(60)
        expect(slices[1].createSec).toBe(120)
      })

      it('formats slice filename cleanly across short and long timestamps', () => {
        expect(formatSliceFileName(1, 0)).toBe('01_00m00s.jpg')
        expect(formatSliceFileName(5, 75)).toBe('05_01m15s.jpg')
        expect(formatSliceFileName(12, 3665)).toBe('12_01h01m05s.jpg')
        expect(formatSliceFileName(2, 45, '.png')).toBe('02_00m45s.png')
      })

      it('builds companion slice directory name correctly', () => {
        expect(buildPptSliceDirName('高等数学(第1讲)')).toBe('高等数学(第1讲)-切片')
      })

      it('builds PPT file name consistently with video session or fallback', () => {
        const session = {
          beginTime: '2025-09-16 08:00:00',
          teacher: '张三',
          classroom: '东上院101'
        }
        const nameWithSession = buildPptFileNameForLecture('第1讲', session)
        expect(nameWithSession).toContain('2025-09-16_08-00')
        expect(nameWithSession).toContain('张三')
        expect(nameWithSession).toContain('东上院101-PPT课件.pdf')

        const nameFallback = buildPptFileNameForLecture('第1讲', undefined)
        expect(nameFallback).toBe('第1讲.pdf')
      })
    })

    describe('4.4 Bundled FFmpeg Resolution (R4-F3)', () => {
      it('resolves app.asar.unpacked path in production package when unpacked file exists', () => {
        const dummyBundled = 'D:\\App\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe'
        const unpacked = 'D:\\App\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe'

        const mockExists = (p: string) => p === unpacked
        const resolved = resolveBundledFfmpeg(dummyBundled, mockExists)
        expect(resolved).toBe(unpacked)
      })

      it('falls back to bundled path if unpacked does not exist but bundled exists', () => {
        const dummyBundled = 'D:\\Dev\\node_modules\\ffmpeg-static\\ffmpeg.exe'
        const mockExists = (p: string) => p === dummyBundled
        const resolved = resolveBundledFfmpeg(dummyBundled, mockExists)
        expect(resolved).toBe(dummyBundled)
      })

      it('falls back to system ffmpeg binary name when no files exist or path is empty', () => {
        expect(resolveBundledFfmpeg('', () => false)).toBe('ffmpeg')
        expect(resolveBundledFfmpeg('D:\\none\\ffmpeg.exe', () => false)).toBe('ffmpeg')
      })
    })
  })

  // ===================================================================
  // 5. CloudPan SSO & Chunking Protocols (R3-F3, R3-F4)
  // ===================================================================
  describe('5. CloudPan SSO & Chunking Protocols (R3-F3, R3-F4)', () => {
    it('calculates dynamic chunk sizes based on file total bytes', () => {
      expect(getDynamicChunkSize(50 * 1024 * 1024)).toBe(4 * 1024 * 1024) // 50MB -> 4MB
      expect(getDynamicChunkSize(200 * 1024 * 1024)).toBe(4 * 1024 * 1024) // 200MB -> 4MB
      expect(getDynamicChunkSize(500 * 1024 * 1024)).toBe(8 * 1024 * 1024) // 500MB -> 8MB
      expect(getDynamicChunkSize(1024 * 1024 * 1024)).toBe(8 * 1024 * 1024) // 1GB -> 8MB
      expect(getDynamicChunkSize(2 * 1024 * 1024 * 1024)).toBe(16 * 1024 * 1024) // 2GB -> 16MB
    })

    it('correctly maps remote paths according to course source and hierarchy', () => {
      const canvasSpec = {
        taskId: 'task_1',
        courseName: 'Canvas课程/2025-2026-1/操作系统',
        fileName: '第1讲.mp4',
        url: 'https://s3/video.mp4',
        source: 'canvas-files'
      } as any

      const path = cloudRemotePath(canvasSpec)
      expect(path).toBe('SJTU Canvas课程/2025-2026-1/操作系统/第1讲.mp4')

      const cnmoocSpec = {
        taskId: 'task_2',
        courseName: '机器学习',
        term: '2025春',
        fileName: '导论.mp4',
        url: 'https://cnmooc/video.mp4',
        source: 'cnmooc'
      } as any

      const cnmoocPath = cloudRemotePath(cnmoocSpec)
      expect(cnmoocPath).toBe('SJTU好大学在线/2025春/机器学习/导论.mp4')
    })

    it('accurately classifies transient vs permanent cloud errors', () => {
      expect(isTransientCloudError(new Error('socket hang up'))).toBe(true)
      expect(isTransientCloudError(new Error('ETIMEDOUT: connection timed out'))).toBe(true)
      expect(isTransientCloudError(new Error('HTTP 502 Bad Gateway'))).toBe(true)
      expect(isTransientCloudError(new Error('MultipartUploadIncomplete'))).toBe(true)
      expect(isTransientCloudError(new Error('上传会话已过期，请重试'))).toBe(true)

      expect(isTransientCloudError(new Error('HTTP 401 Unauthorized'))).toBe(false)
      expect(isTransientCloudError(new Error('HTTP 403 Forbidden'))).toBe(false)
      expect(isTransientCloudError(new Error('HTTP 404 Not Found'))).toBe(false)
    })
  })

  // ===================================================================
  // 6. CNMOOC Chapter Tree & Direct Link Parsing (R3-F5, R3-F6)
  // ===================================================================
  describe('6. CNMOOC Chapter Tree & Direct Link Parsing (R3-F5, R3-F6)', () => {
    it('parses nested chapter HTML into clean tree structures while filtering quiz types', () => {
      const sampleHtml = `
        <div class="chapter-title">第一章 绪论</div>
        <div class="section-title">1.1 课程背景</div>
        <div itemid="1001" itemtype="10" title="课程导学视频"></div>
        <div itemid="1002" itemtype="20" title="课程PPT"></div>
        <div itemid="1003" itemtype="30" title="随堂测验 (Quiz)"></div>
        <div class="section-title">1.2 发展历史</div>
        <div itemid="1004" itemtype="10" title="历史沿革"></div>
        <div class="chapter-title">第二章 核心理论</div>
        <div class="section-title">2.1 模型架构</div>
        <div itemid="1005" itemtype="10" title="架构解析"></div>
      `
      const tree = parseNestedChapterHtml(sampleHtml)
      expect(tree.length).toBe(2) // 2 chapters

      const ch1 = tree[0]
      expect(ch1.chapterTitle).toBe('第一章 绪论')
      expect(ch1.sections.length).toBe(2)

      const sec1 = ch1.sections[0]
      expect(sec1.sectionTitle).toBe('1.1 课程背景')
      // item 1003 (type 30) must be filtered out
      expect(sec1.items.length).toBe(2)
      expect(sec1.items.map(i => i.itemId)).toEqual(['1001', '1002'])

      const sec2 = ch1.sections[1]
      expect(sec2.items.length).toBe(1)
      expect(sec2.items[0].itemId).toBe('1004')
    })

    it('resolves resource URL priorities: mp4Url > playList > flvUrl > rsUrl', () => {
      // 1. mp4Url
      const detail1 = { node: { mp4Url: 'https://cdn.sjtu.cn/vid.mp4', flvUrl: 'https://cdn.sjtu.cn/vid.flv' } }
      expect(resolveCnmoocResourceUrl(detail1).url).toBe('https://cdn.sjtu.cn/vid.mp4')
      expect(resolveCnmoocResourceUrl(detail1).type).toBe('video')

      // 2. playList
      const detail2 = { node: { playList: [{ url: 'https://cdn.sjtu.cn/high.mp4' }] } }
      expect(resolveCnmoocResourceUrl(detail2).url).toBe('https://cdn.sjtu.cn/high.mp4')

      // 3. flvUrl
      const detail3 = { node: { flvUrl: 'https://cdn.sjtu.cn/stream.flv' } }
      expect(resolveCnmoocResourceUrl(detail3).url).toBe('https://cdn.sjtu.cn/stream.flv')

      // 4. rsUrl (document)
      const detail4 = { node: { rsUrl: '/docs/slides.pdf' }, path: 'https://static.cnmooc.sjtu.cn/' }
      expect(resolveCnmoocResourceUrl(detail4).url).toBe('https://static.cnmooc.sjtu.cn/docs/slides.pdf')
      expect(resolveCnmoocResourceUrl(detail4).type).toBe('document')
    })

    it('classifies resources and infers file extensions accurately', () => {
      expect(classifyCnmoocResource('https://cdn/video.mp4')).toBe('video')
      expect(classifyCnmoocResource('https://cdn/lecture.flv?token=xyz')).toBe('video')
      expect(classifyCnmoocResource('https://cdn/handout.pdf')).toBe('document')
      expect(classifyCnmoocResource('https://static.cnmooc.sjtu.cn/res/123')).toBe('document')

      expect(inferCnmoocExt('https://cdn/file.MP4?key=abc')).toBe('.mp4')
      expect(inferCnmoocExt('https://cdn/doc.pdf')).toBe('.pdf')
      expect(inferCnmoocExt('https://cdn/stream')).toBe('')
    })
  })

  // ===================================================================
  // 7. v.sjtu VOD Resolver & Concurrency Invariants
  // ===================================================================
  describe('7. v.sjtu VOD Resolver & Concurrency Invariants', () => {
    it('tolerates single angle and falls back gracefully when requested angle is missing', async () => {
      const resolver = new VsjtuVodResolver()
      const mockFetch = vi.fn().mockResolvedValue({
        data: {
          videoInfos: [
            { angle: 0, angleName: '教师视角', playUrls: ['//live.sjtu.edu.cn/teacher.m3u8'] }
          ]
        }
      })

      // Request angle 1 (PPT) which does not exist in videoInfos
      const result = await resolver.resolveVodStream(12345, 1, mockFetch)
      expect(result.success).toBe(true)
      expect(result.streamUrl).toBe('https://live.sjtu.edu.cn/teacher.m3u8')
      expect(result.angleName).toBe('教师视角')
    })

    it('deduplicates in-flight network requests for same courseId', async () => {
      const resolver = new VsjtuVodResolver()
      let fetchCallCount = 0
      const mockFetch = vi.fn().mockImplementation(async () => {
        fetchCallCount++
        await new Promise(r => setTimeout(r, 20))
        return {
          data: {
            videoInfos: [
              { angle: 0, angleName: '默认视角', playUrls: ['https://live.sjtu.edu.cn/stream.m3u8'] }
            ]
          }
        }
      })

      // Fire 3 simultaneous resolutions
      const [r1, r2, r3] = await Promise.all([
        resolver.resolveVodStream(999, 0, mockFetch),
        resolver.resolveVodStream(999, 0, mockFetch),
        resolver.resolveVodStream(999, 0, mockFetch)
      ])

      expect(fetchCallCount).toBe(1)
      expect(r1.streamUrl).toBe('https://live.sjtu.edu.cn/stream.m3u8')
      expect(r2.streamUrl).toBe('https://live.sjtu.edu.cn/stream.m3u8')
      expect(r3.streamUrl).toBe('https://live.sjtu.edu.cn/stream.m3u8')
    })

    it('correctly tracks global task concurrency and ongoing states', () => {
      // Clear queues
      active.clear()
      cloudActive.clear()
      pendingLocal.length = 0
      pausedLocal.length = 0
      pendingCloud.length = 0
      pausedCloud.length = 0

      expect(hasOngoingTasks()).toBe(false)
      expect(sharedActiveCount()).toBe(0)

      active.add('task_local_1')
      expect(sharedActiveCount()).toBe(1)
      expect(hasOngoingTasks()).toBe(true)

      cloudActive.add('task_cloud_1')
      expect(sharedActiveCount()).toBe(2)

      active.clear()
      cloudActive.clear()
      expect(hasOngoingTasks()).toBe(false)
    })
  })

  // ===================================================================
  // 8. Canvas HTML Extraction Helpers (api.ts)
  // ===================================================================
  describe('8. Canvas HTML Extraction Helpers (api.ts)', () => {
    it('extracts canvas file IDs from HTML content', () => {
      const html = `
        <a href="/courses/101/files/8888/download">课件1</a>
        <a href="/api/v1/courses/101/files/9999">课件2</a>
        <a href="/files/8888">重复链接</a>
      `
      const ids = extractCanvasFileIds(html)
      expect(ids).toEqual([8888, 9999])
    })

    it('extracts embedded video iframes and ignores non-SJTU iframes', () => {
      const html = `
        <iframe src="https://v.sjtu.edu.cn/player?id=123"></iframe>
        <iframe src="https://tv.sjtu.edu.cn/embed?id=456"></iframe>
        <iframe src="https://youtube.com/embed/external"></iframe>
      `
      const urls = extractVideoIframes(html)
      expect(urls).toEqual([
        'https://v.sjtu.edu.cn/player?id=123',
        'https://tv.sjtu.edu.cn/embed?id=456'
      ])
    })

    it('extracts vshare links UUIDs', () => {
      const html = `
        <a href="https://vshare.sjtu.edu.cn/play/a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d">视频1</a>
        <a href="https://vshare.sjtu.edu.cn/play/a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d">重复视频</a>
        <a href="https://vshare.sjtu.edu.cn/play/99887766-5544-3322-1100-aabbccddeeff">视频2</a>
      `
      const uuids = extractVshareLinks(html)
      expect(uuids).toEqual([
        'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        '99887766-5544-3322-1100-aabbccddeeff'
      ])
    })
  })

  // ===================================================================
  // 9. Auth JWT Expiry & Account Info Parsing (R1-F1, R1-F3)
  // ===================================================================
  describe('9. Auth JWT Expiry & Account Info Parsing (R1-F1, R1-F3)', () => {
    it('correctly extracts exp timestamp from valid JWT payload', () => {
      // payload: { "exp": 1791600000, "user": "test" }
      const payloadBase64 = Buffer.from(JSON.stringify({ exp: 1791600000, user: 'test' })).toString('base64')
      const token = `header.${payloadBase64}.signature`
      const exp = extractJwtExpiry(token)
      expect(exp).toBe(1791600000 * 1000)
    })

    it('returns undefined when exp is missing, not a number, or malformed', () => {
      expect(extractJwtExpiry('malformed-token')).toBeUndefined()
      expect(extractJwtExpiry('a.b')).toBeUndefined()

      const payloadWithoutExp = Buffer.from(JSON.stringify({ user: 'test' })).toString('base64')
      expect(extractJwtExpiry(`header.${payloadWithoutExp}.sig`)).toBeUndefined()

      const payloadWithStrExp = Buffer.from(JSON.stringify({ exp: '12345' })).toString('base64')
      expect(extractJwtExpiry(`header.${payloadWithStrExp}.sig`)).toBeUndefined()
    })

    it('parses account display name and student id from /cloud-rbac/authority/me response', () => {
      const fullRes = {
        user: {
          name: '张三 ',
          username: '520030910000'
        }
      }
      expect(pickAccountInfo(fullRes)).toEqual({
        name: '张三',
        studentId: '520030910000'
      })

      // Fallback to code if username is missing
      const codeRes = {
        user: {
          name: '李四',
          code: '12345678'
        }
      }
      expect(pickAccountInfo(codeRes)).toEqual({
        name: '李四',
        studentId: '12345678'
      })

      // Empty or invalid objects
      expect(pickAccountInfo({})).toEqual({})
      expect(pickAccountInfo(null)).toEqual({})
      expect(pickAccountInfo('not-an-object')).toEqual({})
    })
  })

  // ===================================================================
  // 10. HLS Playlist Segment Parsing (R2-F6)
  // ===================================================================
  describe('10. HLS Playlist Segment Parsing (R2-F6)', () => {
    it('parses media playlist segments resolving relative URLs against mediaUrl', () => {
      const mediaUrl = 'https://live.sjtu.edu.cn/hls/course_101/index.m3u8'
      const m3u8Body = `
        #EXTM3U
        #EXT-X-VERSION:3
        #EXT-X-TARGETDURATION:10
        #EXTINF:9.009,
        seg-0.ts
        #EXTINF:9.009,
        seg-1.ts
        #EXTINF:4.500,
        https://cdn.sjtu.edu.cn/absolute/seg-2.ts
        #EXT-X-ENDLIST
      `
      const segments = parseSegments(mediaUrl, m3u8Body)
      expect(segments).toEqual([
        'https://live.sjtu.edu.cn/hls/course_101/seg-0.ts',
        'https://live.sjtu.edu.cn/hls/course_101/seg-1.ts',
        'https://cdn.sjtu.edu.cn/absolute/seg-2.ts'
      ])
    })

    it('returns empty array when playlist has no segment lines', () => {
      const mediaUrl = 'https://live.sjtu.edu.cn/hls/index.m3u8'
      const emptyBody = `
        #EXTM3U
        #EXT-X-TARGETDURATION:10
        #EXT-X-ENDLIST
      `
      expect(parseSegments(mediaUrl, emptyBody)).toEqual([])
    })
  })

  // ===================================================================
  // 11. Canvas Error Discrimination (R2-F2)
  // ===================================================================
  describe('11. Canvas Error Discrimination (R2-F2)', () => {
    it('correctly identifies 403 Forbidden across CanvasApiError and generic Errors', () => {
      const err403 = new CanvasApiError(403, 'Forbidden Tab')
      expect(isForbiddenError(err403)).toBe(true)

      const err500 = new CanvasApiError(500, 'Internal Server Error')
      expect(isForbiddenError(err500)).toBe(false)

      const obj403 = { status: 403, message: 'Forbidden' }
      expect(isForbiddenError(obj403)).toBe(true)

      const msg403 = new Error('HTTP 403 Forbidden: Files tab disabled by instructor')
      expect(isForbiddenError(msg403)).toBe(true)

      const msg404 = new Error('HTTP 404 Not Found')
      expect(isForbiddenError(msg404)).toBe(false)
    })
  })
})

