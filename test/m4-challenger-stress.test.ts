import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs'
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
        executeJavaScript: vi.fn().mockResolvedValue('<html></html>')
      }
      isDestroyed = () => false
      destroy = vi.fn()
    },
    app: {
      whenReady: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockReturnValue(true),
      quit: vi.fn()
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
  VsjtuVodResolver,
  vsjtuVodResolver,
  type VodStreamResult
} from '../src/main/download-engine/vsjtu-resolver'

import {
  strictEncodeURIComponent,
  setSession,
  clearCachedCredentials,
  FileExistsError,
  startChunkedUpload
} from '../src/main/cloudpan'

import {
  parseNestedChapterHtml,
  parseChapterHtml,
  parseCourseHtml,
  resolveCnmoocResourceUrl,
  extractCnmoocDirectUrl
} from '../src/main/cnmooc/api'

import {
  parseCliArgs,
  extractSessionCredentials,
  probeSubsystemConnectivity,
  setupTrafficInterceptor,
  saveSessionToFile
} from '../scripts/interactive-login'

import { parseAuditCoursesPage } from './helpers/contracts'
import { MockSession } from './mocks/electron-session.mock'

// ─────────────────────────────────────────────────────────────────────
// M4 Adversarial Stress Test Suite
// ─────────────────────────────────────────────────────────────────────
describe('Milestone 4 Adversarial Empirical Stress Suite', () => {

  // ===================================================================
  // 1. v.sjtu Pagination & Stream Resolution Stress
  // ===================================================================
  describe('1. v.sjtu Course Pagination, Angle Tolerance & In-flight Deduplication', () => {

    describe('1.1 Pagination Stress: 0 items, 1 page, multi-page, missing totalPage', () => {
      it('handles 0 items in records gracefully', () => {
        const resp = {
          success: true,
          data: {
            records: [],
            total: 0,
            totalPage: 0,
            currPage: 1
          }
        }
        const parsed = parseAuditCoursesPage(resp)
        expect(parsed.courses).toEqual([])
        expect(parsed.totalPage).toBe(1) // normalized min 1
        expect(parsed.currPage).toBe(1)
      })

      it('handles null/undefined data safely without throwing', () => {
        const emptyParsed = parseAuditCoursesPage({})
        expect(emptyParsed.courses).toEqual([])
        expect(emptyParsed.totalPage).toBe(1)

        const nullParsed = parseAuditCoursesPage({ data: null })
        expect(nullParsed.courses).toEqual([])
        expect(nullParsed.totalPage).toBe(1)
      })

      it('supports alternative response layout with "list" instead of "records"', () => {
        const resp = {
          success: true,
          data: {
            list: [
              { id: 901, applyStatus: 1, subjName: '计算机系统架构' },
              { id: 902, applyStatus: 0, subjName: '未审核课程' }
            ],
            total: 2,
            totalPage: 1
          }
        }
        const parsed = parseAuditCoursesPage(resp)
        expect(parsed.courses.length).toBe(1)
        expect(parsed.courses[0].id).toBe(901)
        expect(parsed.courses[0].courseName).toBe('计算机系统架构')
      })

      it('reads totalPage when totalPage is missing but "pages" exists', () => {
        const resp = {
          success: true,
          data: {
            pages: 4,
            current: 2,
            records: [{ id: 888, applyStatus: 1, subjName: '算法设计' }]
          }
        }
        const parsed = parseAuditCoursesPage(resp)
        expect(parsed.totalPage).toBe(4)
        expect(parsed.currPage).toBe(2)
      })

      it('defaults totalPage to 1 when neither totalPage nor pages is provided', () => {
        const resp = {
          success: true,
          data: {
            records: [{ id: 111, applyStatus: 1, subjName: '测试课程' }]
          }
        }
        const parsed = parseAuditCoursesPage(resp)
        expect(parsed.totalPage).toBe(1)
      })

      it('accumulates multi-page results sequentially across pages', () => {
        const page1 = {
          data: {
            totalPage: 3,
            currPage: 1,
            records: [{ id: 101, applyStatus: 1, subjName: '第一讲' }]
          }
        }
        const page2 = {
          data: {
            totalPage: 3,
            currPage: 2,
            records: [{ id: 102, applyStatus: 1, subjName: '第二讲' }]
          }
        }
        const page3 = {
          data: {
            totalPage: 3,
            currPage: 3,
            records: [{ id: 103, applyStatus: 1, subjName: '第三讲' }]
          }
        }

        const pages = [page1, page2, page3]
        const accumulated = pages.flatMap(p => parseAuditCoursesPage(p).courses)
        expect(accumulated.length).toBe(3)
        expect(accumulated.map(c => c.courseName)).toEqual(['第一讲', '第二讲', '第三讲'])
      })

      it('filters out non-approved courses (applyStatus != 1)', () => {
        const resp = {
          data: {
            records: [
              { id: 1, applyStatus: 1, subjName: '通过' },
              { id: 2, applyStatus: 0, subjName: '申请中' },
              { id: 3, applyStatus: 2, subjName: '已拒绝' },
              { id: 4, applyStatus: -1, subjName: '已撤回' }
            ]
          }
        }
        const parsed = parseAuditCoursesPage(resp)
        expect(parsed.courses.length).toBe(1)
        expect(parsed.courses[0].id).toBe(1)
      })
    })

    describe('1.2 Single-Angle Tolerance Stress', () => {
      let resolver: VsjtuVodResolver

      beforeEach(() => {
        resolver = new VsjtuVodResolver()
      })

      it('falls back to angle 0 when requested angle 3 is missing', async () => {
        const mockVodData = {
          data: {
            videoInfos: [
              {
                angle: 0,
                angleName: '教师全景',
                playUrls: ['https://vod.sjtu.edu.cn/teacher_only.mp4']
              }
            ]
          }
        }
        const result = await resolver.resolveVodStream(5001, 3, async () => mockVodData)
        expect(result.success).toBe(true)
        expect(result.streamUrl).toBe('https://vod.sjtu.edu.cn/teacher_only.mp4')
        expect(result.availableAngles).toEqual([0])
      })

      it('falls back to angle 3 when requested angle 0 is missing', async () => {
        const mockVodData = {
          data: {
            videoInfos: [
              {
                angle: 3,
                angleName: 'PPT课件',
                extendPlayUrls: ['https://vod.sjtu.edu.cn/ppt_only.mp4']
              }
            ]
          }
        }
        const result = await resolver.resolveVodStream(5002, 0, async () => mockVodData)
        expect(result.success).toBe(true)
        expect(result.streamUrl).toBe('https://vod.sjtu.edu.cn/ppt_only.mp4')
        expect(result.availableAngles).toEqual([3])
      })

      it('handles both angles missing (videoInfos is empty) without throwing', async () => {
        const mockVodData = {
          data: {
            videoInfos: []
          }
        }
        const result = await resolver.resolveVodStream(5003, 0, async () => mockVodData)
        expect(result.success).toBe(false)
        expect(result.streamUrl).toBeNull()
        expect(result.availableAngles).toEqual([])
      })

      it('handles completely malformed or missing vodData without throwing', async () => {
        const result = await resolver.resolveVodStream(5004, 0, async () => ({}))
        expect(result.success).toBe(false)
        expect(result.streamUrl).toBeNull()
      })

      it('correctly normalizes protocol-relative URLs starting with //', async () => {
        const mockVodData = {
          data: {
            videoInfos: [
              {
                angle: 0,
                angleName: '教师全景',
                playUrls: ['//vod.sjtu.edu.cn/live/stream.m3u8']
              }
            ]
          }
        }
        const result = await resolver.resolveVodStream(5005, 0, async () => mockVodData)
        expect(result.success).toBe(true)
        expect(result.streamUrl).toBe('https://vod.sjtu.edu.cn/live/stream.m3u8')
      })

      it('respects URL priority: extendPlayUrls > playUrls > videoUrl', async () => {
        const mockVodData = {
          data: {
            videoInfos: [
              {
                angle: 0,
                extendPlayUrls: ['https://vod.sjtu.edu.cn/priority1.mp4'],
                playUrls: ['https://vod.sjtu.edu.cn/priority2.mp4'],
                videoUrl: 'https://vod.sjtu.edu.cn/priority3.mp4'
              }
            ]
          }
        }
        const res1 = await resolver.resolveVodStream(5006, 0, async () => mockVodData)
        expect(res1.streamUrl).toBe('https://vod.sjtu.edu.cn/priority1.mp4')

        // Without extendPlayUrls
        delete (mockVodData.data.videoInfos[0] as any).extendPlayUrls
        resolver.clearCache()
        const res2 = await resolver.resolveVodStream(5006, 0, async () => mockVodData)
        expect(res2.streamUrl).toBe('https://vod.sjtu.edu.cn/priority2.mp4')

        // Without playUrls
        delete (mockVodData.data.videoInfos[0] as any).playUrls
        resolver.clearCache()
        const res3 = await resolver.resolveVodStream(5006, 0, async () => mockVodData)
        expect(res3.streamUrl).toBe('https://vod.sjtu.edu.cn/priority3.mp4')
      })
    })

    describe('1.3 In-Flight Deduplication & Concurrency Stress', () => {
      it('deduplicates 20 simultaneous concurrent calls into exactly 1 network request', async () => {
        const resolver = new VsjtuVodResolver()
        let fetchCalls = 0

        const delayedFetch = async (id: number) => {
          fetchCalls++
          await new Promise(r => setTimeout(r, 50))
          return {
            data: {
              videoInfos: [
                { angle: 0, playUrls: [`https://vod.sjtu.edu.cn/${id}_0.mp4`] },
                { angle: 3, playUrls: [`https://vod.sjtu.edu.cn/${id}_3.mp4`] }
              ]
            }
          }
        }

        // Fire 20 requests concurrently for the same courseId (alternating angles)
        const promises: Promise<VodStreamResult>[] = []
        for (let i = 0; i < 20; i++) {
          promises.push(resolver.resolveVodStream(7001, i % 2 === 0 ? 0 : 3, delayedFetch))
        }

        const results = await Promise.all(promises)

        expect(fetchCalls).toBe(1)
        expect(resolver.networkCallCount).toBe(1)
        expect(results.length).toBe(20)
        expect(results.every(r => r.success)).toBe(true)
        expect(results[0].streamUrl).toContain('7001_0.mp4')
        expect(results[1].streamUrl).toContain('7001_3.mp4')
      })

      it('clears inFlight map when network request rejects, allowing subsequent retry', async () => {
        const resolver = new VsjtuVodResolver()
        let attempt = 0

        const flakeyFetch = async (id: number) => {
          attempt++
          if (attempt === 1) {
            throw new Error('Network timeout on first attempt')
          }
          return {
            data: {
              videoInfos: [{ angle: 0, playUrls: [`https://vod.sjtu.edu.cn/${id}.mp4`] }]
            }
          }
        }

        // First parallel batch: both should reject
        const [p1, p2] = await Promise.allSettled([
          resolver.resolveVodStream(7002, 0, flakeyFetch),
          resolver.resolveVodStream(7002, 0, flakeyFetch)
        ])

        expect(p1.status).toBe('rejected')
        expect(p2.status).toBe('rejected')

        // Subsequent call should be able to retry and succeed
        const successRes = await resolver.resolveVodStream(7002, 0, flakeyFetch)
        expect(successRes.success).toBe(true)
        expect(attempt).toBe(2)
      })

      it('serves results from cache without network calls within TTL', async () => {
        const resolver = new VsjtuVodResolver(60_000)
        let networkCount = 0

        const fetchFn = async () => {
          networkCount++
          return {
            data: {
              videoInfos: [{ angle: 0, playUrls: ['https://vod.sjtu.edu.cn/cached.mp4'] }]
            }
          }
        }

        await resolver.resolveVodStream(7003, 0, fetchFn)
        await resolver.resolveVodStream(7003, 0, fetchFn)
        await resolver.resolveVodStream(7003, 0, fetchFn)

        expect(networkCount).toBe(1)

        resolver.clearCache()
        await resolver.resolveVodStream(7003, 0, fetchFn)
        expect(networkCount).toBe(2)
      })
    })
  })

  // ===================================================================
  // 2. CloudPan RFC 3986, Token Renewal & Duplicate File Stress
  // ===================================================================
  describe('2. CloudPan RFC 3986 Encoding, Token Renewal & Duplicate Handling', () => {

    describe('2.1 Strict RFC 3986 Encoding on Special Characters [!\'()*]', () => {
      it('encodes all 5 RFC 3986 characters into %XX hex representation', () => {
        expect(strictEncodeURIComponent('!')).toBe('%21')
        expect(strictEncodeURIComponent('\'')).toBe('%27')
        expect(strictEncodeURIComponent('(')).toBe('%28')
        expect(strictEncodeURIComponent(')')).toBe('%29')
        expect(strictEncodeURIComponent('*')).toBe('%2A')
      })

      it('contrasts with standard encodeURIComponent which leaves [!\'()*] unescaped', () => {
        const raw = `!'()*`
        expect(encodeURIComponent(raw)).toBe(`!'()*`) // Standard leaves them intact!
        expect(strictEncodeURIComponent(raw)).toBe('%21%27%28%29%2A') // Strict encodes all 5
      })

      it('handles mixed filenames with Chinese, spaces, parentheses, apostrophes, exclamation marks, and asterisks', () => {
        const filename = `高等数学 (上) - 课件! [2026]*'s.pdf`
        const encoded = strictEncodeURIComponent(filename)

        expect(/[!'()*]/.test(encoded)).toBe(false) // Zero unescaped characters
        expect(encoded).toContain('%28')
        expect(encoded).toContain('%29')
        expect(encoded).toContain('%21')
        expect(encoded).toContain('%2A')
        expect(encoded).toContain('%27')

        // Lossless round-trip verification
        expect(decodeURIComponent(encoded)).toBe(filename)
      })
    })

    describe('2.2 ChunkedUploader confirm() Token Expiration Retry Logic', () => {
      let mockSession: MockSession

      beforeEach(() => {
        mockSession = new MockSession()
        setSession(mockSession as any)
        clearCachedCredentials()
      })

      it('retries confirm() with fresh token upon encountering HTTP 401 token expiration', async () => {
        let personalTokenCalls = 0
        let confirmAttempt = 0
        const userToken = 'valid_user_token_32_chars_minimum_here'

        mockSession.registerFetchHandler((url, init) => {
          // 1. Space credentials
          if (url.includes('/user/v1/space/1/personal')) {
            personalTokenCalls++
            const accessToken = personalTokenCalls === 1 ? 'old_expired_access_token' : 'fresh_renewed_access_token'
            return new Response(JSON.stringify({
              libraryId: 'lib_test',
              spaceId: 'sp_test',
              accessToken,
              expiresIn: 3600
            }), { status: 200 })
          }

          // 2. HEAD check (file not exists)
          if (init?.method === 'HEAD') {
            return new Response(null, { status: 404 })
          }

          // 3. Init multipart
          if (url.includes('?multipart')) {
            return new Response(JSON.stringify({
              confirmKey: 'test_confirm_key_123',
              domain: 'cos.jcloud.sjtu.edu.cn',
              uploadId: 'upload_id_123',
              path: '/cos/path/test.mp4',
              parts: {},
              expiration: new Date(Date.now() + 3600000).toISOString(),
              status: 0
            }), { status: 200 })
          }

          // 4. Confirm endpoint
          if (url.includes('?confirm')) {
            confirmAttempt++
            if (url.includes('access_token=old_expired_access_token')) {
              return new Response(JSON.stringify({ error: 'TokenExpired', message: 'AccessToken expired' }), {
                status: 401
              })
            }
            if (url.includes('access_token=fresh_renewed_access_token')) {
              return new Response(JSON.stringify({
                fileId: 'file_success_777',
                path: '/test.mp4',
                hash: 'abc'
              }), { status: 200 })
            }
          }

          return undefined
        })

        const uploader = await startChunkedUpload(userToken, 'test.mp4')
        const confirmResult = await uploader.confirm()

        expect(confirmAttempt).toBe(2)
        expect(personalTokenCalls).toBe(2)
        expect(confirmResult.fileId).toBe('file_success_777')
      })

      it('re-throws 401 when token renewal fails or userToken is invalid', async () => {
        const userToken = 'valid_user_token_32_chars_minimum_here'

        mockSession.registerFetchHandler((url, init) => {
          if (url.includes('/user/v1/space/1/personal')) {
            return new Response(JSON.stringify({
              libraryId: 'lib_test',
              spaceId: 'sp_test',
              accessToken: 'bad_token',
              expiresIn: 3600
            }), { status: 200 })
          }
          if (init?.method === 'HEAD') return new Response(null, { status: 404 })
          if (url.includes('?multipart')) {
            return new Response(JSON.stringify({
              confirmKey: 'test_ck',
              domain: 'cos.jcloud.sjtu.edu.cn',
              uploadId: 'up_id',
              path: '/p',
              parts: {},
              expiration: new Date(Date.now() + 3600000).toISOString(),
              status: 0
            }), { status: 200 })
          }
          if (url.includes('?confirm')) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
          }
          return undefined
        })

        const uploader = await startChunkedUpload(userToken, 'unauthorized.mp4')
        await expect(uploader.confirm()).rejects.toThrow(/HTTP 401/)
      })
    })

    describe('2.3 Duplicate File Skip Handling', () => {
      let mockSession: MockSession

      beforeEach(() => {
        mockSession = new MockSession()
        setSession(mockSession as any)
        clearCachedCredentials()
      })

      it('throws FileExistsError when HEAD check returns 200 OK (file already exists)', async () => {
        const userToken = 'valid_user_token_32_chars_minimum_here'

        mockSession.registerFetchHandler((url, init) => {
          if (url.includes('/user/v1/space/1/personal')) {
            return new Response(JSON.stringify({
              libraryId: 'lib_test',
              spaceId: 'sp_test',
              accessToken: 'tok',
              expiresIn: 3600
            }), { status: 200 })
          }
          if (init?.method === 'HEAD') {
            return new Response(null, { status: 200 }) // File exists!
          }
          return undefined
        })

        await expect(startChunkedUpload(userToken, 'existing_file.mp4'))
          .rejects.toThrow(FileExistsError)
      })

      it('throws FileExistsError when init multipart POST returns HTTP 409 (SameNameDirectoryOrFileExists)', async () => {
        const userToken = 'valid_user_token_32_chars_minimum_here'

        mockSession.registerFetchHandler((url, init) => {
          if (url.includes('/user/v1/space/1/personal')) {
            return new Response(JSON.stringify({
              libraryId: 'lib_test',
              spaceId: 'sp_test',
              accessToken: 'tok',
              expiresIn: 3600
            }), { status: 200 })
          }
          if (init?.method === 'HEAD') {
            return new Response(null, { status: 404 }) // Race condition: didn't exist at HEAD
          }
          if (url.includes('?multipart')) {
            return new Response(JSON.stringify({
              error: 'SameNameDirectoryOrFileExists'
            }), { status: 409 })
          }
          return undefined
        })

        await expect(startChunkedUpload(userToken, 'race_condition_file.mp4'))
          .rejects.toThrow(FileExistsError)
      })
    })
  })

  // ===================================================================
  // 3. CNMOOC Chapter Tree & Lazy Link Resolution Stress
  // ===================================================================
  describe('3. CNMOOC Diverse Chapter Hierarchy & Resource Link Resolution', () => {

    describe('3.1 Diverse HTML Structures & Boundary Parsing', () => {
      it('parses nested structure with data-type="chapter" and data-itemid', () => {
        const html = `
          <div data-type="chapter">第二章 深度学习</div>
          <div class="section-title">2.1 卷积神经网络</div>
          <div data-itemid="1001" data-itemtype="10" title="CNN 原理">CNN</div>
          <div data-itemid="1002" data-itemtype="20" title="CNN 课件 (PDF)">PDF</div>
        `
        const tree = parseNestedChapterHtml(html)
        expect(tree.length).toBe(1)
        expect(tree[0].chapterTitle).toBe('第二章 深度学习')
        expect(tree[0].sections.length).toBe(1)
        expect(tree[0].sections[0].sectionTitle).toBe('2.1 卷积神经网络')
        expect(tree[0].sections[0].items.length).toBe(2)
      })

      it('handles items directly under a chapter without an explicit section', () => {
        const html = `
          <div class="chapter-title">引言与前言</div>
          <div itemid="501" itemtype="10" title="课程介绍"></div>
          <div itemid="502" itemtype="20" title="教学大纲"></div>
        `
        const tree = parseNestedChapterHtml(html)
        expect(tree.length).toBe(1)
        expect(tree[0].chapterTitle).toBe('引言与前言')
        expect(tree[0].sections.length).toBe(1)
        expect(tree[0].sections[0].sectionTitle).toBe('未分小节')
        expect(tree[0].sections[0].items.length).toBe(2)
      })

      it('handles items appearing before any chapter declaration', () => {
        const html = `
          <div itemid="101" itemtype="10" title="课前导学"></div>
          <div class="chapter-title">第一章 正式课程</div>
          <div class="section-title">1.1 基础</div>
          <div itemid="102" itemtype="10" title="第一节"></div>
        `
        const tree = parseNestedChapterHtml(html)
        expect(tree.length).toBe(2)
        expect(tree[0].chapterTitle).toBe('未分章节')
        expect(tree[0].sections[0].sectionTitle).toBe('未分小节')
        expect(tree[0].sections[0].items[0].itemId).toBe('101')
        expect(tree[1].chapterTitle).toBe('第一章 正式课程')
      })

      it('ignores whitespace-only chapter titles and section titles', () => {
        const html = `
          <div class="chapter-title">    </div>
          <div class="section-title"> \n\t </div>
          <div class="chapter-title">有效章节</div>
          <div class="section-title">有效小节</div>
          <div itemid="301" itemtype="10" title="视频"></div>
        `
        const tree = parseNestedChapterHtml(html)
        expect(tree.length).toBe(1)
        expect(tree[0].chapterTitle).toBe('有效章节')
      })

      it('deduplicates duplicate itemIds within the same section', () => {
        const html = `
          <div class="chapter-title">第1章</div>
          <div class="section-title">1.1</div>
          <div itemid="888" title="条目A"></div>
          <div itemid="888" title="条目A重复"></div>
        `
        const tree = parseNestedChapterHtml(html)
        expect(tree[0].sections[0].items.length).toBe(1)
        expect(tree[0].sections[0].items[0].title).toBe('条目A')
      })

      it('filters out quiz types (30, 50, 60) consistently', () => {
        const html = `
          <div class="chapter-title">第1章</div>
          <div class="section-title">1.1</div>
          <div itemid="1" itemtype="10" title="视频"></div>
          <div itemid="2" itemtype="30" title="单元测验"></div>
          <div itemid="3" itemtype="50" title="期末作业"></div>
          <div itemid="4" itemtype="60" title="考试"></div>
          <div itemid="5" itemtype="20" title="文档"></div>
        `
        const tree = parseNestedChapterHtml(html)
        const items = tree[0].sections[0].items
        expect(items.length).toBe(2)
        expect(items.map(i => i.itemId)).toEqual(['1', '5'])
      })

      it('parseChapterHtml builds clean filesystem paths and sanitizes invalid characters', () => {
        const html = `
          <div class="chapter-title">第1章: 特殊字符/测试?</div>
          <div class="section-title">1.1 基础*讲解&lt;1&gt;</div>
          <div itemid="99" itemtype="10" title="讲解: 视频|第1集"></div>
        `
        const chapters = parseChapterHtml(html)
        expect(chapters.length).toBe(1)
        // Chapter directory path should not contain prohibited characters
        expect(/[\\?*|"<>]/.test(chapters[0].chapter)).toBe(false)
        expect(chapters[0].items[0].title).not.toContain(':')
        expect(chapters[0].items[0].title).not.toContain('|')
      })
    })

    describe('3.2 Lazy Resource URL Resolution with Absolute & Relative URLs', () => {
      it('resolves absolute mp4Url directly', () => {
        const detail = {
          node: { mp4Url: 'https://video.cnmooc.sjtu.cn/media/lecture1.mp4' }
        }
        const res = resolveCnmoocResourceUrl(detail)
        expect(res.url).toBe('https://video.cnmooc.sjtu.cn/media/lecture1.mp4')
        expect(res.type).toBe('video')
      })

      it('resolves site-relative mp4Url (/media/...) to CNMOOC_BASE_URL', () => {
        const detail = {
          node: { mp4Url: '/media/video_relative.mp4' }
        }
        const res = resolveCnmoocResourceUrl(detail)
        expect(res.url).toBe('https://cnmooc.sjtu.cn/media/video_relative.mp4')
        expect(res.type).toBe('video')
      })

      it('resolves protocol-relative mp4Url (//cdn...) to https://cdn...', () => {
        const detail = {
          node: { mp4Url: '//cdn.cnmooc.sjtu.cn/video.mp4' }
        }
        const res = resolveCnmoocResourceUrl(detail)
        expect(res.url).toBe('https://cdn.cnmooc.sjtu.cn/video.mp4')
        expect(res.type).toBe('video')
      })

      it('resolves flvUrl when mp4Url is absent', () => {
        const detail = {
          node: { flvUrl: 'https://video.cnmooc.sjtu.cn/stream.flv' }
        }
        const res = resolveCnmoocResourceUrl(detail)
        expect(res.url).toBe('https://video.cnmooc.sjtu.cn/stream.flv')
        expect(res.type).toBe('video')
      })

      it('resolves string playList', () => {
        const detail = {
          node: { playList: 'https://video.cnmooc.sjtu.cn/live.m3u8' }
        }
        const res = resolveCnmoocResourceUrl(detail)
        expect(res.url).toBe('https://video.cnmooc.sjtu.cn/live.m3u8')
      })

      it('resolves array of strings playList', () => {
        const detail = {
          node: { playList: ['https://video.cnmooc.sjtu.cn/first.mp4', 'https://video.cnmooc.sjtu.cn/second.mp4'] }
        }
        const res = resolveCnmoocResourceUrl(detail)
        expect(res.url).toBe('https://video.cnmooc.sjtu.cn/first.mp4')
      })

      it('resolves array of objects playList with { url } and { playUrl }', () => {
        const detail1 = {
          node: { playList: [{ url: 'https://video.cnmooc.sjtu.cn/obj_url.mp4' }] }
        }
        expect(resolveCnmoocResourceUrl(detail1).url).toBe('https://video.cnmooc.sjtu.cn/obj_url.mp4')

        const detail2 = {
          node: { playList: [{ playUrl: 'https://video.cnmooc.sjtu.cn/obj_playurl.mp4' }] }
        }
        expect(resolveCnmoocResourceUrl(detail2).url).toBe('https://video.cnmooc.sjtu.cn/obj_playurl.mp4')
      })

      it('resolves multi-bitrate dictionary playList with priority shd > hd > sd', () => {
        const detail = {
          node: {
            playList: {
              sd: 'https://video.cnmooc.sjtu.cn/sd.mp4',
              hd: 'https://video.cnmooc.sjtu.cn/hd.mp4',
              shd: 'https://video.cnmooc.sjtu.cn/shd.mp4'
            }
          }
        }
        const res = resolveCnmoocResourceUrl(detail)
        expect(res.url).toBe('https://video.cnmooc.sjtu.cn/shd.mp4')
      })

      it('resolves relative rsUrl against detail.path and default static CDN base', () => {
        const detailWithCustomPath = {
          path: 'https://custom-static.cnmooc.sjtu.cn/files',
          node: { rsUrl: '/slides/lecture1.pdf' }
        }
        const res1 = resolveCnmoocResourceUrl(detailWithCustomPath)
        expect(res1.url).toBe('https://custom-static.cnmooc.sjtu.cn/files/slides/lecture1.pdf')
        expect(res1.type).toBe('document')

        const detailWithDefaultPath = {
          node: { rsUrl: 'slides/lecture2.pdf' }
        }
        const res2 = resolveCnmoocResourceUrl(detailWithDefaultPath)
        expect(res2.url).toBe('https://static.cnmooc.sjtu.cn/slides/lecture2.pdf')
        expect(res2.type).toBe('document')
      })

      it('throws when detail contains no downloadable URLs', () => {
        expect(() => resolveCnmoocResourceUrl({})).toThrow('detail 响应无可下载 URL')
        expect(() => resolveCnmoocResourceUrl({ node: {} })).toThrow('detail 响应无可下载 URL')
        expect(() => resolveCnmoocResourceUrl({ node: { mp4Url: '', rsUrl: '' } })).toThrow('detail 响应无可下载 URL')
      })
    })
  })

  // ===================================================================
  // 4. Interactive Login CLI Arg Parsing & Execution Stress
  // ===================================================================
  describe('4. Interactive Login CLI Scaffolding (R4-F1)', () => {

    describe('4.1 CLI Argument Parsing Stress', () => {
      it('parses empty args as all flags false', () => {
        const opts = parseCliArgs([])
        expect(opts).toEqual({
          dumpTraffic: false,
          saveSession: false,
          probeOnly: false,
          help: false
        })
      })

      it('parses individual flags accurately', () => {
        expect(parseCliArgs(['--dump-traffic']).dumpTraffic).toBe(true)
        expect(parseCliArgs(['--save-session']).saveSession).toBe(true)
        expect(parseCliArgs(['--probe-only']).probeOnly).toBe(true)
        expect(parseCliArgs(['--help']).help).toBe(true)
        expect(parseCliArgs(['-h']).help).toBe(true)
      })

      it('parses combined and unordered flags, ignoring unknown flags', () => {
        const opts = parseCliArgs(['--unknown-arg', '--save-session', '--dump-traffic', 'some-path'])
        expect(opts.saveSession).toBe(true)
        expect(opts.dumpTraffic).toBe(true)
        expect(opts.probeOnly).toBe(false)
        expect(opts.help).toBe(false)
      })
    })

    describe('4.2 Session Harvesting & Deduplication Mock', () => {
      it('harvests and deduplicates cookies across the 6 SJTU domains', async () => {
        const mockSes = new MockSession()

        // Set cookies across domains, including duplicates
        await mockSes.cookies.set({ domain: 'jaccount.sjtu.edu.cn', name: 'JA_SIG', value: 'sig123' })
        await mockSes.cookies.set({ domain: 'pan.sjtu.edu.cn', name: 'USER_TOKEN', value: 'token_pan_456' })
        await mockSes.cookies.set({ domain: 'cnmooc.sjtu.cn', name: 'cpstk', value: 'postoken_789' })
        await mockSes.cookies.set({ domain: 'oc.sjtu.edu.cn', name: '_legacy_normandy_session', value: 'sess_canvas' })
        await mockSes.cookies.set({ domain: 'v.sjtu.edu.cn', name: 'JSESSIONID', value: 'jsess_vsjtu' })

        const creds = await extractSessionCredentials(mockSes as any)

        expect(creds.userToken).toBe('token_pan_456')
        expect(creds.cpstk).toBe('postoken_789')
        expect(creds.jsessionid).toBe('jsess_vsjtu')
        expect(creds.totalCookies).toBeGreaterThanOrEqual(5)
      })
    })

    describe('4.3 Subsystem Connectivity Probing Mock', () => {
      it('evaluates all 5 SJTU subsystems and records status in scorecard', async () => {
        const mockSes = new MockSession()

        mockSessionProbeSetup(mockSes)

        const scorecard = await probeSubsystemConnectivity(mockSes as any, 'user_token_sample')

        expect(scorecard.auth).toBe(true)
        expect(scorecard.canvas).toBe(true)
        expect(scorecard.vsjtu).toBe(true)
        expect(scorecard.cloudpan).toBe(true)
        expect(scorecard.cnmooc).toBe(true)
        expect(scorecard.details.auth).toContain('HTTP')
        expect(scorecard.details.canvas).toContain('HTTP')
        expect(scorecard.details.vsjtu).toContain('HTTP')
        expect(scorecard.details.cloudpan).toContain('HTTP')
        expect(scorecard.details.cnmooc).toContain('HTTP')
      })

      it('gracefully handles unreachable subsystems without throwing unhandled rejection', async () => {
        const mockSes = new MockSession()
        // Register no handlers -> fetch will return 404 or reject

        const scorecard = await probeSubsystemConnectivity(mockSes as any, 'token')

        expect(scorecard.canvas).toBe(false)
        expect(scorecard.vsjtu).toBe(false)
        expect(scorecard.details.canvas).toBeDefined()
      })
    })

    describe('4.4 Traffic Interception & Session Serialization', () => {
      it('setupTrafficInterceptor does not attach webRequest when dump is false', () => {
        const mockWebReq = {
          onBeforeRequest: vi.fn(),
          onCompleted: vi.fn()
        }
        setupTrafficInterceptor({ webRequest: mockWebReq } as any, false)
        expect(mockWebReq.onBeforeRequest).not.toHaveBeenCalled()
      })

      it('setupTrafficInterceptor attaches listeners when dump is true', () => {
        const mockWebReq = {
          onBeforeRequest: vi.fn(),
          onCompleted: vi.fn()
        }
        setupTrafficInterceptor({ webRequest: mockWebReq } as any, true)
        expect(mockWebReq.onBeforeRequest).toHaveBeenCalled()
        expect(mockWebReq.onCompleted).toHaveBeenCalled()
      })

      it('saveSessionToFile writes valid JSON to specified filepath', () => {
        const tmpPath = join(tmpdir(), `test_auth_session_${Date.now()}.json`)
        const testData = {
          userToken: 'tok_test',
          timestamp: new Date().toISOString(),
          cookies: [{ name: 'A', value: 'B' }]
        }

        try {
          saveSessionToFile(testData, tmpPath)
          expect(existsSync(tmpPath)).toBe(true)
          const readBack = JSON.parse(readFileSync(tmpPath, 'utf-8'))
          expect(readBack.userToken).toBe('tok_test')
          expect(readBack.cookies[0].name).toBe('A')
        } finally {
          if (existsSync(tmpPath)) {
            unlinkSync(tmpPath)
          }
        }
      })
    })
  })

  // ===================================================================
  // 5. Empirical Challenge & Stress Invariants (Dispatched Tasks)
  // ===================================================================
  describe('5. Empirical Challenge & Stress Invariants', () => {

    // ─────────────────────────────────────────────────────────────────
    // 5.1 Browser.tsx Batch Pool Concurrency & Rate Limiting
    // ─────────────────────────────────────────────────────────────────
    describe('5.1 Browser.tsx Batch Pool Concurrency & Rate Limiting', () => {
      it('concurrency pool invariant: active in-flight requests NEVER exceed BATCH_SIZE (5) across 25 courses', async () => {
        const BATCH_SIZE = 5
        const TOTAL_COURSES = 25
        const courses = Array.from({ length: TOTAL_COURSES }, (_, i) => ({ id: 1000 + i, name: `Course ${i}` }))

        let activeCount = 0
        let peakConcurrency = 0
        const concurrencyLog: number[] = []

        const mockAuditCourseDetail = async (_courseId: number) => {
          activeCount++
          peakConcurrency = Math.max(peakConcurrency, activeCount)
          concurrencyLog.push(activeCount)

          // Simulate variable network latency
          await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 20))

          activeCount--
          return { success: true, data: { videos: [] } }
        }

        // Execute batch loop identically to Browser.tsx (lines 159-180)
        let done = 0
        const progressUpdates: string[] = []

        for (let i = 0; i < courses.length; i += BATCH_SIZE) {
          const batch = courses.slice(i, i + BATCH_SIZE)
          await Promise.all(
            batch.map(async c => {
              try {
                await mockAuditCourseDetail(c.id)
              } finally {
                done += 1
                progressUpdates.push(`正在扫描视频…${done} / ${courses.length}`)
              }
            })
          )
        }

        // Strict assertions
        expect(peakConcurrency).toBeLessThanOrEqual(5)
        expect(peakConcurrency).toBeGreaterThan(1) // Confirms parallel within batch
        expect(concurrencyLog.every(c => c <= 5)).toBe(true)
        expect(done).toBe(TOTAL_COURSES)
        expect(progressUpdates.length).toBe(TOTAL_COURSES)
        expect(progressUpdates[progressUpdates.length - 1]).toBe('正在扫描视频…25 / 25')
      })

      it('batch pool fault tolerance: individual course failures do not abort scanning of other courses', async () => {
        const BATCH_SIZE = 5
        const courses = Array.from({ length: 13 }, (_, i) => ({ id: 2000 + i, name: `Course ${i}` }))

        const completedCourses: number[] = []
        const failedCourses: number[] = []
        let done = 0

        const mockAuditCourseDetail = async (id: number) => {
          // Courses 3 and 7 simulate failures
          if (id === 2003) throw new Error('HTTP 500 Internal Server Error')
          if (id === 2007) return { success: false, message: '课程已被归档' }
          return { success: true, data: { videos: [{ id: 1 }] } }
        }

        for (let i = 0; i < courses.length; i += BATCH_SIZE) {
          const batch = courses.slice(i, i + BATCH_SIZE)
          await Promise.all(
            batch.map(async c => {
              try {
                const det = await mockAuditCourseDetail(c.id)
                if (det?.success && det.data) {
                  completedCourses.push(c.id)
                } else {
                  failedCourses.push(c.id)
                }
              } catch {
                failedCourses.push(c.id)
              } finally {
                done += 1
              }
            })
          )
        }

        expect(done).toBe(13)
        expect(completedCourses.length).toBe(11)
        expect(failedCourses).toEqual([2003, 2007])
      })

      it('contrast with unbounded execution: unbatched Promise.all blasts server with all concurrent requests', async () => {
        const courses = Array.from({ length: 20 }, (_, i) => ({ id: 3000 + i }))
        let activeCount = 0
        let unbatchedPeak = 0

        await Promise.all(
          courses.map(async () => {
            activeCount++
            unbatchedPeak = Math.max(unbatchedPeak, activeCount)
            await new Promise(r => setTimeout(r, 15))
            activeCount--
          })
        )

        // Without batching, peak explodes to 20!
        expect(unbatchedPeak).toBe(20)
      })
    })

    // ─────────────────────────────────────────────────────────────────
    // 5.2 CloudPan Multi-Hour Upload Simulation & confirm() Expiration
    // ─────────────────────────────────────────────────────────────────
    describe('5.2 CloudPan Multi-Hour Upload Simulation & confirm() Expiration', () => {
      let mockSession: MockSession

      beforeEach(() => {
        mockSession = new MockSession()
        setSession(mockSession as any)
        clearCachedCredentials()
      })

      it('multi-hour upload simulation: confirm() succeeds when token expires after upload parts complete', async () => {
        const userToken = 'valid_user_token_32_chars_minimum_here'
        let tokenFetchCount = 0
        let confirmRequestCount = 0
        const initialAccessToken = 'token_valid_for_first_hour'
        const renewedAccessToken = 'token_renewed_after_three_hours'

        // Session handler simulating multi-hour lifetime
        mockSession.registerFetchHandler((url, init) => {
          if (url.includes('/user/v1/space/1/personal')) {
            tokenFetchCount++
            return new Response(JSON.stringify({
              libraryId: 'lib_multihour',
              spaceId: 'sp_multihour',
              accessToken: tokenFetchCount === 1 ? initialAccessToken : renewedAccessToken,
              expiresIn: 3600 // 1 hour token
            }), { status: 200 })
          }

          if (init?.method === 'HEAD') {
            return new Response(null, { status: 404 }) // File does not exist yet
          }

          if (url.includes('?multipart')) {
            return new Response(JSON.stringify({
              confirmKey: 'multihour_confirm_key_999',
              domain: 'cos.jcloud.sjtu.edu.cn',
              uploadId: 'multihour_upload_id',
              path: '/cos/multihour.mp4',
              parts: {
                '1': { headers: { Authorization: 'sign-1' } }
              },
              expiration: new Date(Date.now() + 3600000).toISOString(),
              status: 0
            }), { status: 200 })
          }

          if (url.includes('?confirm')) {
            confirmRequestCount++
            // Attempt 1 uses expired token -> returns 401
            if (url.includes(`access_token=${initialAccessToken}`)) {
              return new Response(JSON.stringify({
                code: 'InvalidAccessToken',
                message: 'HTTP 401: Token expired after 3 hours of uploading parts'
              }), { status: 401 })
            }

            // Attempt 2 uses renewed token -> returns 200 OK
            if (url.includes(`access_token=${renewedAccessToken}`)) {
              return new Response(JSON.stringify({
                fileId: 'file_multihour_success_8888',
                path: '/cos/multihour.mp4',
                hash: 'sha256_mock_hash'
              }), { status: 200 })
            }
          }

          return undefined
        })

        // 1. Start chunked upload
        const uploader = await startChunkedUpload(userToken, 'multihour_video.mp4')
        expect(tokenFetchCount).toBe(1)

        // 2. Simulate 3 hours passing: token expires on server
        // 3. confirm() is invoked after all parts completed
        const result = await uploader.confirm()

        // 4. Verify confirm() cleanly renewed token and succeeded
        expect(confirmRequestCount).toBe(2)
        expect(tokenFetchCount).toBe(2)
        expect(result.fileId).toBe('file_multihour_success_8888')
      })

      it('compounded worst-case: confirm() handles 401 Token Expiration followed by MultipartUploadIncomplete', async () => {
        const userToken = 'valid_user_token_32_chars_minimum_here'
        let tokenFetchCount = 0
        let confirmRequestCount = 0

        mockSession.registerFetchHandler((url, init) => {
          if (url.includes('/user/v1/space/1/personal')) {
            tokenFetchCount++
            return new Response(JSON.stringify({
              libraryId: 'lib_compounded',
              spaceId: 'sp_compounded',
              accessToken: `token_ver_${tokenFetchCount}`,
              expiresIn: 3600
            }), { status: 200 })
          }

          if (init?.method === 'HEAD') return new Response(null, { status: 404 })

          if (url.includes('?multipart')) {
            return new Response(JSON.stringify({
              confirmKey: 'compounded_key_777',
              domain: 'cos.jcloud.sjtu.edu.cn',
              uploadId: 'compounded_up_id',
              path: '/cos/compounded.mp4',
              parts: {},
              expiration: new Date(Date.now() + 3600000).toISOString(),
              status: 0
            }), { status: 200 })
          }

          if (url.includes('?confirm')) {
            confirmRequestCount++
            // Attempt 1: 401 expired
            if (confirmRequestCount === 1) {
              return new Response(JSON.stringify({ message: 'HTTP 401 Unauthorized' }), { status: 401 })
            }
            // Attempt 2: 400 MultipartUploadIncomplete (COS consolidation lag)
            if (confirmRequestCount === 2) {
              return new Response(JSON.stringify({ message: 'HTTP 400 MultipartUploadIncomplete: parts still merging' }), { status: 400 })
            }
            // Attempt 3: 200 OK
            return new Response(JSON.stringify({
              fileId: 'file_compounded_done',
              path: '/cos/compounded.mp4'
            }), { status: 200 })
          }

          return undefined
        })

        const uploader = await startChunkedUpload(userToken, 'compounded.mp4')
        const result = await uploader.confirm()

        expect(confirmRequestCount).toBe(3)
        expect(tokenFetchCount).toBe(2)
        expect(result.fileId).toBe('file_compounded_done')
      })
    })

    // ─────────────────────────────────────────────────────────────────
    // 5.3 CNMOOC Chapter Parser Edge Cases: Quizzes, Tags & Paths
    // ─────────────────────────────────────────────────────────────────
    describe('5.3 CNMOOC Chapter Parser Edge Cases (Quizzes, Tags & Paths)', () => {
      it('quiz skipping: strictly filters out items with itemtype/data-itemtype 30, 50, 60', () => {
        const html = `
          <div class="chapter-title">第1章 综合评测测试</div>
          <div class="section-title">1.1 课程与作业</div>
          <a class="item" itemid="101" itemtype="10" title="正常视频 1"></a>
          <a class="item" itemid="102" itemtype="20" title="正常文档 1"></a>
          <a class="item" itemid="103" itemtype="30" title="小测验 (itemtype=30)"></a>
          <a class="item" itemid="104" data-itemtype="30" title="小测验 (data-itemtype=30)"></a>
          <a class="item" itemid="105" itemtype="50" title="作业 (itemtype=50)"></a>
          <a class="item" itemid="106" data-itemtype="50" title="作业 (data-itemtype=50)"></a>
          <a class="item" itemid="107" itemtype="60" title="期末大考 (itemtype=60)"></a>
          <a class="item" itemid="108" data-itemtype="60" title="期末大考 (data-itemtype=60)"></a>
          <a class="item" itemid="109" itemtype="10" title="正常视频 2"></a>
        `
        const tree = parseNestedChapterHtml(html)
        expect(tree.length).toBe(1)
        const items = tree[0].sections[0].items
        expect(items.length).toBe(3)
        expect(items.map(i => i.itemId)).toEqual(['101', '102', '109'])
        expect(items.map(i => i.title)).toEqual(['正常视频 1', '正常文档 1', '正常视频 2'])
      })

      it('ghost chapter pruning: chapters containing ONLY quizzes (30, 50, 60) are completely filtered out', () => {
        const html = `
          <div class="chapter-title">第1章 知识精讲</div>
          <div class="section-title">1.1 讲次</div>
          <a itemid="11" itemtype="10" title="讲次视频"></a>

          <div class="chapter-title">第2章 单元测试与期末考试</div>
          <div class="section-title">2.1 单元小测</div>
          <a itemid="21" itemtype="30" title="测验一"></a>
          <div class="section-title">2.2 阶段作业</div>
          <a itemid="22" itemtype="50" title="作业一"></a>
          <div class="section-title">2.3 期末考试</div>
          <a itemid="23" itemtype="60" title="终考"></a>
        `
        const tree = parseNestedChapterHtml(html)
        expect(tree.length).toBe(1)
        expect(tree[0].chapterTitle).toBe('第1章 知识精讲')
      })

      it('unusual section tags: supports h3, span, li, p, and deeply nested tags with class section-title', () => {
        const html = `
          <div class="chapter-title">第1章 异形标签</div>
          <h3 class="section-title">1.1 H3 标签小节</h3>
          <div itemid="1" itemtype="10" title="视频 1"></div>

          <span class="section-title">1.2 SPAN 标签小节</span>
          <div itemid="2" itemtype="10" title="视频 2"></div>

          <li class="section-title">1.3 LI 标签小节</li>
          <div itemid="3" itemtype="10" title="视频 3"></div>

          <p class="section-title">1.4 P 标签小节</p>
          <div itemid="4" itemtype="10" title="视频 4"></div>

          <div class="section-title">
            <span>1.5 嵌套结构</span>
            <small>（副标题说明）</small>
          </div>
          <div itemid="5" itemtype="10" title="视频 5"></div>
        `
        const tree = parseNestedChapterHtml(html)
        expect(tree.length).toBe(1)
        expect(tree[0].sections.length).toBe(5)
        expect(tree[0].sections[0].sectionTitle).toBe('1.1 H3 标签小节')
        expect(tree[0].sections[1].sectionTitle).toBe('1.2 SPAN 标签小节')
        expect(tree[0].sections[2].sectionTitle).toBe('1.3 LI 标签小节')
        expect(tree[0].sections[3].sectionTitle).toBe('1.4 P 标签小节')
        expect(tree[0].sections[4].sectionTitle).toContain('1.5 嵌套结构')
        expect(tree[0].sections[4].sectionTitle).toContain('副标题说明')
      })

      it('path sanitization: removes illegal Windows characters, traversal sequences, and trailing dots', () => {
        const html = `
          <div class="chapter-title">第1章: 特殊/字符\\测试 &lt;1&gt;? * " | ..</div>
          <div class="section-title">1.1 目录../穿越:试验... </div>
          <a itemid="999" itemtype="10" title="恶意文件名: &lt;con&gt;|aux?*.mp4"></a>
        `
        const chapters = parseChapterHtml(html)
        expect(chapters.length).toBe(1)
        const ch = chapters[0]

        // 1. Chapter path format
        expect(ch.chapter).toBeDefined()
        // No slashes other than the directory separator /
        const parts = ch.chapter.split('/')
        expect(parts.length).toBe(2)

        for (const p of parts) {
          // No prohibited characters: < > : " \ | ? *
          expect(/[<>:"\\|?*]/.test(p)).toBe(false)
          // No trailing dots or spaces
          expect(/[. ]+$/.test(p)).toBe(false)
        }

        // 2. Item file name sanitization
        const itemTitle = ch.items[0].title
        expect(/[<>:"/\\|?*]/.test(itemTitle)).toBe(false)
        expect(/[. ]+$/.test(itemTitle)).toBe(false)
      })

      it('item identification: recognizes id="item_12345", id="item-67890", and data-itemid', () => {
        const html = `
          <div class="chapter-title">第1章</div>
          <div class="section-title">1.1</div>
          <div id="item_1111" itemtype="10" title="条目 1"></div>
          <div id="item-2222" itemtype="10" title="条目 2"></div>
          <div data-itemid="3333" data-itemtype="10" title="条目 3"></div>
        `
        const tree = parseNestedChapterHtml(html)
        expect(tree[0].sections[0].items.length).toBe(3)
        expect(tree[0].sections[0].items.map(i => i.itemId)).toEqual(['1111', '2222', '3333'])
      })
    })
  })
})

// ─── Helper for Mock Subsystem Probe ─────────────────────────────────
function mockSessionProbeSetup(mockSes: MockSession): void {
  mockSes.registerFetchHandler((url, init) => {
    if (url.includes('jaccount.sjtu.edu.cn')) {
      return new Response('jAccount OK', { status: 200 })
    }
    if (url.includes('oc.sjtu.edu.cn/api/v1/courses')) {
      return new Response('[]', { status: 200 })
    }
    if (url.includes('jy-application-resmgr-resource/auditCourse/my')) {
      return new Response(JSON.stringify({ code: 200 }), { status: 200 })
    }
    if (url.includes('pan.sjtu.edu.cn/user/v1/space/1')) {
      return new Response(JSON.stringify({ availableSpace: 100 }), { status: 200 })
    }
    if (url.includes('cnmooc.sjtu.cn/portal/myCourseIndex/1.mooc')) {
      return new Response('cnmooc OK', { status: 200 })
    }
    return undefined
  })
}
