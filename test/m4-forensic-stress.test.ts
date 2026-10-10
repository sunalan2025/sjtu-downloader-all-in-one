import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Mock electron before importing production modules
vi.mock('electron', () => ({
  app: {
    whenReady: async () => {},
    isReady: () => true,
    quit: () => {}
  },
  BrowserWindow: class {
    loadURL = async () => {}
    destroy = () => {}
    isDestroyed = () => false
    webContents = {
      executeJavaScript: async () => ''
    }
  },
  session: {
    fromPartition: () => ({
      cookies: {
        get: async () => []
      },
      fetch: async () => ({ status: 200 }),
      webRequest: {
        onBeforeRequest: () => {},
        onCompleted: () => {}
      }
    })
  }
}))

// Import production implementations
import { VsjtuVodResolver, vsjtuVodResolver } from '../src/main/download-engine/vsjtu-resolver'
import { strictEncodeURIComponent, validateUserToken } from '../src/main/cloudpan'
import {
  parseNestedChapterHtml,
  parseCourseHtml,
  parseChapterHtml,
  resolveCnmoocResourceUrl,
  extractCnmoocDirectUrl,
  classifyCnmoocResource
} from '../src/main/cnmooc/api'
import {
  parseCliArgs,
  saveSessionToFile,
  extractSessionCredentials,
  probeSubsystemConnectivity
} from '../scripts/interactive-login'

// Import helpers & contracts
import * as contracts from './helpers/contracts'

describe('M4 Forensic Audit: Production Implementation & Stress Verification', () => {

  // ─────────────────────────────────────────────────────────────
  // 1. VsjtuVodResolver & Single-Angle Tolerance (R3-F2)
  // ─────────────────────────────────────────────────────────────
  describe('VsjtuVodResolver Production Stress Tests', () => {
    let resolver: VsjtuVodResolver

    beforeEach(() => {
      resolver = new VsjtuVodResolver(1000) // 1s TTL for testing
    })

    it('resolves requested angle accurately when present', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        data: {
          videoInfos: [
            { angle: 0, angleName: '教师全景', extendPlayUrls: ['//v.sjtu.edu.cn/t.mp4'] },
            { angle: 3, angleName: 'PPT画面', extendPlayUrls: ['https://v.sjtu.edu.cn/ppt.mp4'] }
          ]
        }
      })

      const res0 = await resolver.resolveVodStream(101, 0, mockFetch)
      expect(res0.success).toBe(true)
      expect(res0.streamUrl).toBe('https://v.sjtu.edu.cn/t.mp4')
      expect(res0.angleName).toBe('教师全景')

      const res3 = await resolver.resolveVodStream(101, 3, mockFetch)
      expect(res3.success).toBe(true)
      expect(res3.streamUrl).toBe('https://v.sjtu.edu.cn/ppt.mp4')
      expect(res3.angleName).toBe('PPT画面')

      // Network call should be cached (only 1 fetch for course 101)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(resolver.networkCallCount).toBe(1)
    })

    it('handles single-angle lectures by falling back to available angle (100% success)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        data: {
          videoInfos: [
            { angle: 0, angleName: '单视角全景', extendPlayUrls: ['https://v.sjtu.edu.cn/single.mp4'] }
          ]
        }
      })

      // Requesting angle 3 when only angle 0 exists
      const res = await resolver.resolveVodStream(202, 3, mockFetch)
      expect(res.success).toBe(true)
      expect(res.streamUrl).toBe('https://v.sjtu.edu.cn/single.mp4')
      expect(res.angleName).toBe('单视角全景')
      expect(res.availableAngles).toEqual([0])
    })

    it('deduplicates concurrent in-flight requests for the same courseId', async () => {
      let resolveCall: any
      const delayedFetch = vi.fn().mockImplementation(() => {
        return new Promise(r => { resolveCall = r })
      })

      const p1 = resolver.resolveVodStream(303, 0, delayedFetch)
      const p2 = resolver.resolveVodStream(303, 3, delayedFetch)

      expect(delayedFetch).toHaveBeenCalledTimes(1)

      resolveCall({
        data: {
          videoInfos: [
            { angle: 0, angleName: '教师', playUrls: ['https://v.sjtu.edu.cn/a0.mp4'] }
          ]
        }
      })

      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1.success).toBe(true)
      expect(r2.success).toBe(true)
      expect(delayedFetch).toHaveBeenCalledTimes(1)
    })

    it('re-fetches after TTL expiration and handles network failures gracefully without poisoning cache', async () => {
      const failFetch = vi.fn().mockRejectedValue(new Error('Network 500'))
      await expect(resolver.resolveVodStream(404, 0, failFetch)).rejects.toThrow('Network 500')

      // Cache should not be poisoned: subsequent call should try again
      const successFetch = vi.fn().mockResolvedValue({
        data: { videoInfos: [{ angle: 0, videoUrl: 'https://v.sjtu.edu.cn/ok.mp4' }] }
      })
      const ok = await resolver.resolveVodStream(404, 0, successFetch)
      expect(ok.success).toBe(true)
      expect(ok.streamUrl).toBe('https://v.sjtu.edu.cn/ok.mp4')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 2. CloudPan strictEncodeURIComponent & Token Handling (R3-F3, R3-F4)
  // ─────────────────────────────────────────────────────────────
  describe('CloudPan RFC 3986 Path Encoding & Uploader Renewal', () => {
    it('strictEncodeURIComponent properly encodes reserved chars [!\'()*]', () => {
      const raw = "2026! Course (Notes) & 'Slides'* Final.pdf"
      const encoded = strictEncodeURIComponent(raw)

      expect(encoded).not.toContain('!')
      expect(encoded).not.toContain("'")
      expect(encoded).not.toContain('(')
      expect(encoded).not.toContain(')')
      expect(encoded).not.toContain('*')

      expect(encoded).toContain('%21')
      expect(encoded).toContain('%27')
      expect(encoded).toContain('%28')
      expect(encoded).toContain('%29')
      expect(encoded).toContain('%2A')
    })

    it('strictEncodeURIComponent handles Chinese characters and whitespace correctly', () => {
      const input = '高等数学（第七版）/第一讲*绪论!.pdf'
      const encoded = strictEncodeURIComponent(input)
      expect(encoded).toContain('%EF%BC%88') // （
      expect(encoded).toContain('%EF%BC%89') // ）
      expect(encoded).toContain('%2A')       // *
      expect(encoded).toContain('%21')       // !
    })

    it('validateUserToken rejects empty or short (< 32 char) tokens', async () => {
      const r1 = await validateUserToken('')
      expect(r1.ok).toBe(false)
      expect(r1.error).toContain('格式不正确')

      const r2 = await validateUserToken('short_token_under_32')
      expect(r2.ok).toBe(false)
      expect(r2.error).toContain('格式不正确')
    })

    it('MockChunkedUploader renews access tokens on expiry and part > 50', async () => {
      let renewCount = 0
      const getFreshToken = async () => {
        renewCount++
        return `renewed_token_${renewCount}`
      }

      const uploader = new contracts.MockChunkedUploader('initial_token', getFreshToken)
      await uploader.uploadPart(1, false)
      expect(uploader.getContext().token).toBe('initial_token')
      expect(uploader.getContext().renewCount).toBe(0)

      // Upload part with expired token
      await uploader.uploadPart(2, true)
      expect(uploader.getContext().token).toBe('renewed_token_1')
      expect(uploader.getContext().renewCount).toBe(1)

      // Upload part > 50 triggers renewal
      await uploader.uploadPart(51, false)
      expect(uploader.getContext().token).toBe('renewed_token_2')
      expect(uploader.getContext().renewCount).toBe(2)
      expect(uploader.getContext().uploadedParts).toEqual([1, 2, 51])
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 3. CNMOOC Two-Level Nested Chapter Tree & Course Scanner (R3-F5)
  // ─────────────────────────────────────────────────────────────
  describe('CNMOOC Chapter Tree and Course Parsers', () => {
    const mockHtml = `
      <div class="unit-nav">
        <div class="chapter-title" data-type="chapter">第一章 计算机基础</div>
        <div class="section-title">1.1 二进制与逻辑运算</div>
        <div itemid="1001" itemtype="10" title="1.1.1 视频讲解" class="lecture-action"></div>
        <div itemid="1002" itemtype="20" title="1.1.2 课件讲义" class="lecture-action"></div>
        <div itemid="1003" itemtype="30" title="1.1.3 随堂测验" class="lecture-action"></div>

        <div class="section-title">1.2 计算机硬件体系</div>
        <div itemid="1004" itemtype="10" title="1.2.1 CPU工作原理" class="lecture-action"></div>

        <div class="chapter-title" data-type="chapter">第二章 数据结构</div>
        <div class="section-title">2.1 线性表</div>
        <div itemid="2001" itemtype="10" title="2.1.1 顺序表实现" class="lecture-action"></div>
        <div itemid="2002" itemtype="50" title="2.1.2 单元测试" class="lecture-action"></div>
      </div>
    `

    it('parseNestedChapterHtml produces two-level hierarchy and filters quiz types (30, 50, 60)', () => {
      const tree = parseNestedChapterHtml(mockHtml)
      expect(tree.length).toBe(2)

      // Chapter 1
      expect(tree[0].chapterTitle).toBe('第一章 计算机基础')
      expect(tree[0].sections.length).toBe(2)
      expect(tree[0].sections[0].sectionTitle).toBe('1.1 二进制与逻辑运算')
      expect(tree[0].sections[0].items.length).toBe(2) // 1001, 1002 (1003 filtered out)
      expect(tree[0].sections[0].items.map(i => i.itemId)).toEqual(['1001', '1002'])

      expect(tree[0].sections[1].sectionTitle).toBe('1.2 计算机硬件体系')
      expect(tree[0].sections[1].items.length).toBe(1)
      expect(tree[0].sections[1].items[0].itemId).toBe('1004')

      // Chapter 2
      expect(tree[1].chapterTitle).toBe('第二章 数据结构')
      expect(tree[1].sections.length).toBe(1)
      expect(tree[1].sections[0].items.length).toBe(1) // 2001 (2002 filtered out)
    })

    it('parseChapterHtml produces compatible flat list with slash-delimited chapter/section names', () => {
      const chapters = parseChapterHtml(mockHtml)
      expect(chapters.length).toBe(3) // 3 sections total
      expect(chapters[0].chapter).toBe('第一章 计算机基础/1.1 二进制与逻辑运算')
      expect(chapters[1].chapter).toBe('第一章 计算机基础/1.2 计算机硬件体系')
      expect(chapters[2].chapter).toBe('第二章 数据结构/2.1 线性表')
    })

    it('parseCourseHtml parses course list and deduplicates by courseId', () => {
      const courseHtml = `
        <div class="view">
          <a class="view-shadow" href="/portal/session/index/999.mooc">
            <h3 class="view-title">编译原理 <span class="cview-time">2026春</span></h3>
          </a>
        </div>
        <div class="view">
          <a class="view-shadow" href="/portal/session/index/999.mooc">
            <h3 class="view-title">重复课程</h3>
          </a>
        </div>
        <div class="view">
          <a class="view-shadow" href="/portal/session/index/888.mooc">
            <h3 class="view-title">操作系统</h3>
          </a>
        </div>
      `
      const courses = parseCourseHtml(courseHtml)
      expect(courses.length).toBe(2)
      expect(courses[0].courseId).toBe('999')
      expect(courses[0].name).toBe('编译原理')
      expect(courses[1].courseId).toBe('888')
      expect(courses[1].name).toBe('操作系统')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 4. CNMOOC Lazy Link Fallback Resolution (R3-F6)
  // ─────────────────────────────────────────────────────────────
  describe('CNMOOC Lazy Resource URL Resolution', () => {
    it('resolves mp4Url as video type', () => {
      const detail = { node: { mp4Url: 'https://media.cnmooc.org/v/1.mp4' } }
      const res = resolveCnmoocResourceUrl(detail)
      expect(res.url).toBe('https://media.cnmooc.org/v/1.mp4')
      expect(res.type).toBe('video')
    })

    it('resolves flvUrl as video type', () => {
      const detail = { node: { flvUrl: '//media.cnmooc.org/live/stream.flv' } }
      const res = resolveCnmoocResourceUrl(detail)
      expect(res.url).toBe('https://media.cnmooc.org/live/stream.flv')
      expect(res.type).toBe('video')
    })

    it('resolves playList array format', () => {
      const detail = {
        node: {
          playList: [
            { quality: '1080P', url: 'https://cdn.sjtu.cn/hls/1080.m3u8' },
            { quality: '720P', url: 'https://cdn.sjtu.cn/hls/720.m3u8' }
          ]
        }
      }
      const res = resolveCnmoocResourceUrl(detail)
      expect(res.url).toBe('https://cdn.sjtu.cn/hls/1080.m3u8')
      expect(res.type).toBe('video')
    })

    it('resolves playList quality dictionary format (shd/hd/sd)', () => {
      const detail = {
        node: {
          playList: {
            shd: 'https://cdn.sjtu.cn/vod/shd.mp4',
            hd: 'https://cdn.sjtu.cn/vod/hd.mp4'
          }
        }
      }
      const res = resolveCnmoocResourceUrl(detail)
      expect(res.url).toBe('https://cdn.sjtu.cn/vod/shd.mp4')
      expect(res.type).toBe('video')
    })

    it('resolves static rsUrl document with staticBase prepending', () => {
      const detail = {
        path: 'https://static.cnmooc.org/res/',
        node: { rsUrl: 'course/slides/lecture1.pdf' }
      }
      const res = resolveCnmoocResourceUrl(detail)
      expect(res.url).toBe('https://static.cnmooc.org/res/course/slides/lecture1.pdf')
      expect(res.type).toBe('document')
    })

    it('throws error when no playable or downloadable URL is provided in detail', () => {
      const emptyDetail = { node: {} }
      expect(() => resolveCnmoocResourceUrl(emptyDetail)).toThrow('detail 响应无可下载 URL')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 5. Interactive Login CLI Scaffolding (R4-F1)
  // ─────────────────────────────────────────────────────────────
  describe('Interactive Login CLI Scaffolding', () => {
    it('parseCliArgs correctly recognizes CLI flags', () => {
      const opts = parseCliArgs(['--dump-traffic', '--save-session', '--probe-only'])
      expect(opts.dumpTraffic).toBe(true)
      expect(opts.saveSession).toBe(true)
      expect(opts.probeOnly).toBe(true)
      expect(opts.help).toBe(false)

      const helpOpts = parseCliArgs(['-h'])
      expect(helpOpts.help).toBe(true)
    })

    it('saveSessionToFile exports session credentials to disk in valid JSON format', () => {
      const tempPath = join(tmpdir(), `test_session_${Date.now()}.json`)
      const dummyData = {
        timestamp: new Date().toISOString(),
        userToken: 'test_token_12345678901234567890123456789012',
        scorecard: { auth: true, canvas: true, vsjtu: true, cloudpan: true, cnmooc: true }
      }

      try {
        saveSessionToFile(dummyData, tempPath)
        expect(existsSync(tempPath)).toBe(true)
        const content = JSON.parse(readFileSync(tempPath, 'utf-8'))
        expect(content.userToken).toBe(dummyData.userToken)
        expect(content.scorecard.auth).toBe(true)
      } finally {
        if (existsSync(tempPath)) {
          rmSync(tempPath, { force: true })
        }
      }
    })

    it('extractSessionCredentials harvests cookies and tokens across domains', async () => {
      const mockSes: any = {
        cookies: {
          get: vi.fn().mockImplementation(async ({ domain, url }: any) => {
            if (domain === 'pan.sjtu.edu.cn' || url === 'https://pan.sjtu.edu.cn') {
              return [
                { domain: 'pan.sjtu.edu.cn', name: 'USER_TOKEN', value: 'my_pan_token_32_chars_long_1234', path: '/' }
              ]
            }
            if (domain === 'cnmooc.sjtu.cn') {
              return [
                { domain: 'cnmooc.sjtu.cn', name: 'cpstk', value: 'my_cpstk_token', path: '/' }
              ]
            }
            if (domain === 'jaccount.sjtu.edu.cn') {
              return [
                { domain: 'jaccount.sjtu.edu.cn', name: 'JSESSIONID', value: 'session_abc', path: '/' }
              ]
            }
            return []
          })
        }
      }

      const creds = await extractSessionCredentials(mockSes)
      expect(creds.userToken).toBe('my_pan_token_32_chars_long_1234')
      expect(creds.cpstk).toBe('my_cpstk_token')
      expect(creds.jsessionid).toBe('session_abc')
      expect(creds.totalCookies).toBeGreaterThanOrEqual(3)
    })

    it('probeSubsystemConnectivity probes all 5 subsystems and returns scorecard', async () => {
      const mockSes: any = {
        fetch: vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('jaccount')) return { status: 200 }
          if (url.includes('api/v1/courses')) return { status: 200 }
          if (url.includes('auditCourse/my')) return { status: 200 }
          if (url.includes('pan.sjtu.edu.cn')) return { status: 200 }
          if (url.includes('myCourseIndex')) return { status: 200 }
          return { status: 404 }
        })
      }

      const scorecard = await probeSubsystemConnectivity(mockSes, 'test_token')
      expect(scorecard.auth).toBe(true)
      expect(scorecard.canvas).toBe(true)
      expect(scorecard.vsjtu).toBe(true)
      expect(scorecard.cloudpan).toBe(true)
      expect(scorecard.cnmooc).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 6. Contract Equivalence Verification (Contracts 11-15)
  // ─────────────────────────────────────────────────────────────
  describe('Interface Contracts 11-15 Equivalence Verification', () => {
    it('Contract 11 parseAuditCoursesPage works as specified', () => {
      const raw = {
        data: {
          records: [
            { id: 1, applyStatus: 1, auditCourseResources: [{ resourceId: 101, courseName: '课A' }] },
            { id: 2, applyStatus: 0, auditCourseResources: [{ resourceId: 102, courseName: '课B' }] },
            { id: 3, applyStatus: 1, subjName: '课C' }
          ],
          totalPage: 3,
          currPage: 1
        }
      }

      const parsed = contracts.parseAuditCoursesPage(raw)
      expect(parsed.totalPage).toBe(3)
      expect(parsed.currPage).toBe(1)
      expect(parsed.courses.length).toBe(2)
      expect(parsed.courses[0].resourceId).toBe(101)
      expect(parsed.courses[0].courseName).toBe('课A')
      expect(parsed.courses[1].resourceId).toBe(3)
      expect(parsed.courses[1].courseName).toBe('课C')
    })

    it('Contract 12 exports real VsjtuVodResolver', () => {
      expect(contracts.VsjtuVodResolver).toBe(VsjtuVodResolver)
      expect(contracts.vsjtuVodResolver).toBe(vsjtuVodResolver)
    })

    it('Contract 13 exports strictEncodeURIComponent and MockChunkedUploader', () => {
      expect(contracts.strictEncodeURIComponent).toBe(strictEncodeURIComponent)
      expect(contracts.MockChunkedUploader).toBeDefined()
    })

    it('Contract 14 exports parseNestedChapterHtml, parseCourseHtml, parseChapterHtml', () => {
      expect(contracts.parseNestedChapterHtml).toBe(parseNestedChapterHtml)
      expect(contracts.parseCourseHtml).toBe(parseCourseHtml)
      expect(contracts.parseChapterHtml).toBe(parseChapterHtml)
    })

    it('Contract 15 exports resolveCnmoocResourceUrl and CLI functions', () => {
      expect(contracts.resolveCnmoocResourceUrl).toBe(resolveCnmoocResourceUrl)
      expect(contracts.extractCnmoocDirectUrl).toBe(extractCnmoocDirectUrl)
      expect(contracts.extractSessionCredentials).toBe(extractSessionCredentials)
      expect(contracts.probeSubsystemConnectivity).toBe(probeSubsystemConnectivity)
      expect(contracts.parseCliArgs).toBe(parseCliArgs)
    })
  })
})
