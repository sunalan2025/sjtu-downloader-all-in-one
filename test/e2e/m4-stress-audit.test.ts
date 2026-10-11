import { describe, it, expect, vi } from 'vitest'
import {
  parseAuditCoursesPage,
  VsjtuVodResolver,
  strictEncodeURIComponent,
  MockChunkedUploader,
  parseNestedChapterHtml,
  parseChapterHtml,
  resolveCnmoocResourceUrl,
  extractCnmoocDirectUrl,
  parseCliArgs,
  extractSessionCredentials,
  probeSubsystemConnectivity
} from '../helpers/contracts'
import { vsjtuVodResolver } from '../../src/main/download-engine/vsjtu-resolver'

describe('M4 Adversarial Stress Audit: v.sjtu, CloudPan, CNMOOC & Interactive Login', () => {

  // ─────────────────────────────────────────────────────────────
  // 1. v.sjtu Pagination & Stream Tolerant Resolution (R3-F1, R3-F2)
  // ─────────────────────────────────────────────────────────────
  describe('1. v.sjtu Pagination & Stream Tolerant Resolution', () => {
    it('parseAuditCoursesPage: handles corrupted payloads, field aliases, and fallback names', () => {
      // 1.1 Empty or malformed payload
      expect(parseAuditCoursesPage(null)).toEqual({ courses: [], totalPage: 1, currPage: 1 })
      expect(parseAuditCoursesPage({})).toEqual({ courses: [], totalPage: 1, currPage: 1 })
      expect(parseAuditCoursesPage({ data: {} })).toEqual({ courses: [], totalPage: 1, currPage: 1 })

      // 1.2 Alias fallback: list vs records, pages vs totalPage, current vs currPage
      const aliasPayload = {
        data: {
          list: [
            { id: 101, applyStatus: 1, subjName: '高等工程数学', auditCourseResources: [{ resourceId: 501 }] },
            { id: 102, applyStatus: 0, subjName: '未批准课程' },
            { id: 103, applyStatus: 1, auditCourseResources: [{ resourceId: 503, courseName: '深度学习导论' }] },
            { id: 104, applyStatus: 1 } // No resources, no subjName
          ],
          pages: 5,
          current: 3
        }
      }
      const parsed = parseAuditCoursesPage(aliasPayload)
      expect(parsed.totalPage).toBe(5)
      expect(parsed.currPage).toBe(3)
      expect(parsed.courses).toHaveLength(3) // 101, 103, 104 (102 rejected due to applyStatus: 0)

      expect(parsed.courses[0]).toEqual({
        id: 101,
        applyStatus: 1,
        resourceId: 501,
        courseName: '高等工程数学'
      })
      expect(parsed.courses[1]).toEqual({
        id: 103,
        applyStatus: 1,
        resourceId: 503,
        courseName: '深度学习导论'
      })
      expect(parsed.courses[2]).toEqual({
        id: 104,
        applyStatus: 1,
        resourceId: 104, // fallback to id
        courseName: '未命名课程' // fallback to default
      })
    })

    it('VsjtuVodResolver: in-flight deduplication collapses concurrent requests for the same courseId', async () => {
      const resolver = new VsjtuVodResolver(5000)
      let networkFetchCalls = 0

      const mockFetch = vi.fn(async (_courseId: number) => {
        networkFetchCalls++
        await new Promise(r => setTimeout(r, 20))
        return {
          success: true,
          data: {
            videoInfos: [
              { angle: 0, angleName: '教师全景', extendPlayUrls: ['https://vod.sjtu.edu.cn/0.m3u8'] },
              { angle: 3, angleName: 'PPT课件', extendPlayUrls: ['https://vod.sjtu.edu.cn/3.m3u8'] }
            ]
          }
        }
      })

      // Concurrently resolve angle 0 and angle 3 for courseId 9999
      const [resAngle0, resAngle3] = await Promise.all([
        resolver.resolveVodStream(9999, 0, mockFetch),
        resolver.resolveVodStream(9999, 3, mockFetch)
      ])

      expect(networkFetchCalls).toBe(1)
      expect(resolver.networkCallCount).toBe(1)
      expect(resAngle0.success).toBe(true)
      expect(resAngle0.streamUrl).toBe('https://vod.sjtu.edu.cn/0.m3u8')
      expect(resAngle3.success).toBe(true)
      expect(resAngle3.streamUrl).toBe('https://vod.sjtu.edu.cn/3.m3u8')
    })

    it('VsjtuVodResolver: respects TTL cache and re-fetches after TTL expiration', async () => {
      const resolver = new VsjtuVodResolver(50) // 50ms TTL
      let fetchCount = 0

      const mockFetch = async (cid: number) => {
        fetchCount++
        return {
          data: {
            videoInfos: [{ angle: 0, videoUrl: `https://vod.sjtu.edu.cn/${cid}_${fetchCount}.mp4` }]
          }
        }
      }

      // First call -> network
      const first = await resolver.resolveVodStream(123, 0, mockFetch)
      expect(fetchCount).toBe(1)
      expect(first.streamUrl).toContain('123_1.mp4')

      // Second immediate call -> cache hit
      const second = await resolver.resolveVodStream(123, 0, mockFetch)
      expect(fetchCount).toBe(1)
      expect(second.streamUrl).toBe(first.streamUrl)

      // Wait for TTL expiration
      await new Promise(r => setTimeout(r, 60))

      // Third call -> TTL expired, network re-fetch
      const third = await resolver.resolveVodStream(123, 0, mockFetch)
      expect(fetchCount).toBe(2)
      expect(third.streamUrl).toContain('123_2.mp4')
    })

    it('VsjtuVodResolver: single-angle tolerance gracefully falls back to available angle', async () => {
      const resolver = new VsjtuVodResolver(5000)

      // Payload only has angle 0
      const singleAngleData = {
        data: {
          videoInfos: [
            { angle: 0, angleName: '主视角', playUrls: ['//vod.sjtu.edu.cn/main.m3u8'] }
          ]
        }
      }

      // Requested angle 3 (PPT), which is missing
      const res = await resolver.resolveVodStream(888, 3, async () => singleAngleData)
      expect(res.success).toBe(true)
      expect(res.streamUrl).toBe('https://vod.sjtu.edu.cn/main.m3u8')
      expect(res.availableAngles).toEqual([0])
      expect(res.angleName).toBe('主视角')
    })

    it('VsjtuVodResolver: network rejection cleans up in-flight promise and permits retry', async () => {
      const resolver = new VsjtuVodResolver(5000)
      let attempt = 0

      const flapperFetch = async (_cid: number) => {
        attempt++
        if (attempt === 1) throw new Error('Network 503')
        return {
          data: {
            videoInfos: [{ angle: 0, videoUrl: 'https://vod.sjtu.edu.cn/success.mp4' }]
          }
        }
      }

      await expect(resolver.resolveVodStream(555, 0, flapperFetch)).rejects.toThrow('Network 503')

      // Second attempt must NOT be stuck on the failed in-flight promise
      const second = await resolver.resolveVodStream(555, 0, flapperFetch)
      expect(second.success).toBe(true)
      expect(second.streamUrl).toBe('https://vod.sjtu.edu.cn/success.mp4')
    })

    it('vsjtuVodResolver singleton: exists and exposes clearCache', () => {
      expect(vsjtuVodResolver).toBeInstanceOf(VsjtuVodResolver)
      vsjtuVodResolver.clearCache()
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 2. CloudPan SSO, Token Renewal & Path Encoding (R3-F3, R3-F4)
  // ─────────────────────────────────────────────────────────────
  describe('2. CloudPan SSO, Token Renewal & Path Encoding', () => {
    it('strictEncodeURIComponent: strictly escapes RFC 3986 reserved characters [!\'()*]', () => {
      const specialFileName = "Chapter 1 (Intro) & Notes [2026]!*'.pdf"
      const encoded = strictEncodeURIComponent(specialFileName)

      // Standard encodeURIComponent preserves !, ', (, ), *
      // strictEncodeURIComponent MUST encode them as %21, %27, %28, %29, %2A
      expect(encoded).not.toContain('!')
      expect(encoded).not.toContain("'")
      expect(encoded).not.toContain('(')
      expect(encoded).not.toContain(')')
      expect(encoded).not.toContain('*')

      expect(encoded).toContain('%21') // !
      expect(encoded).toContain('%27') // '
      expect(encoded).toContain('%28') // (
      expect(encoded).toContain('%29') // )
      expect(encoded).toContain('%2A') // *

      expect(decodeURIComponent(encoded)).toBe(specialFileName)
    })

    it('MockChunkedUploader: tracks chunk uploads and performs dynamic token refresh on expiration', async () => {
      let tokenCounter = 1
      const getFreshToken = vi.fn(async () => `token_v${++tokenCounter}`)
      const uploader = new MockChunkedUploader('token_v1', getFreshToken)

      // Normal upload
      await uploader.uploadPart(1, false)
      expect(uploader.getContext().token).toBe('token_v1')
      expect(uploader.getContext().renewCount).toBe(0)

      // Upload with expired token -> dynamic renewal
      await uploader.uploadPart(2, true)
      expect(uploader.getContext().token).toBe('token_v2')
      expect(uploader.getContext().renewCount).toBe(1)

      // Long upload exceeding 50 parts -> dynamic renewal
      await uploader.uploadPart(51, false)
      expect(uploader.getContext().token).toBe('token_v3')
      expect(uploader.getContext().renewCount).toBe(2)
      expect(uploader.getContext().uploadedParts).toEqual([1, 2, 51])
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 3. CNMOOC Nested Chapter Tree & Direct Link Parsing (R3-F5, R3-F6)
  // ─────────────────────────────────────────────────────────────
  describe('3. CNMOOC Chapter Tree & Direct Link Parsing', () => {
    it('parseNestedChapterHtml: groups sections into chapters and filters out quizzes (types 30, 50, 60)', () => {
      const html = `
        <div class="chapter-title">第1章 软件工程概论</div>
        <div class="section-title">1.1 软件危机与工程化方法</div>
        <a class="item-title" itemid="1001" itemtype="10" title="1.1.1 软件危机的表现与起源"></a>
        <a class="item-title" itemid="1002" itemtype="20" title="1.1.2 课件PPT下载"></a>
        <a class="item-title" itemid="1003" itemtype="30" title="1.1.3 随堂测验 (Quiz)"></a>
        <div class="section-title">1.2 敏捷开发宣言</div>
        <a class="item-title" itemid="1004" itemtype="10" title="1.2.1 Scrum 框架详解"></a>
        <a class="item-title" itemid="1005" itemtype="50" title="1.2.2 阶段测试 (Exam)"></a>
        <a class="item-title" itemid="1006" itemtype="60" title="1.2.3 互评作业 (Assignment)"></a>

        <div class="chapter-title">第2章 面向对象分析与设计</div>
        <div class="section-title">2.1 UML 核心建模图</div>
        <a class="item-title" itemid="2001" itemtype="10" title="2.1.1 类图与时序图精讲"></a>
      `

      const tree = parseNestedChapterHtml(html)
      expect(tree).toHaveLength(2)

      // Chapter 1
      expect(tree[0].chapterTitle).toBe('第1章 软件工程概论')
      expect(tree[0].sections).toHaveLength(2)
      expect(tree[0].sections[0].sectionTitle).toBe('1.1 软件危机与工程化方法')
      expect(tree[0].sections[0].items).toHaveLength(2)
      expect(tree[0].sections[0].items.map(i => i.itemId)).toEqual(['1001', '1002'])
      // Quizzes (1003, 1005, 1006) MUST be filtered out
      expect(tree[0].sections[1].items).toHaveLength(1)
      expect(tree[0].sections[1].items[0].itemId).toBe('1004')

      // Chapter 2
      expect(tree[1].chapterTitle).toBe('第2章 面向对象分析与设计')
      expect(tree[1].sections).toHaveLength(1)
      expect(tree[1].sections[0].items).toHaveLength(1)
      expect(tree[1].sections[0].items[0].itemId).toBe('2001')
    })

    it('parseChapterHtml: generates formatted relative folder paths for each section', () => {
      const html = `
        <div class="chapter-title">模块一</div>
        <div class="section-title">小节A</div>
        <a itemid="1" itemtype="10" title="视频1"></a>
      `
      const chapters = parseChapterHtml(html)
      expect(chapters).toHaveLength(1)
      expect(chapters[0].chapter).toBe('模块一/小节A')
      expect(chapters[0].items[0].title).toBe('视频1')
    })

    it('resolveCnmoocResourceUrl: resolves various candidate formats (mp4, flv, playList, rsUrl)', () => {
      // 1. mp4Url
      expect(resolveCnmoocResourceUrl({ node: { mp4Url: 'https://cnmooc.sjtu.cn/v.mp4' } }))
        .toEqual({ url: 'https://cnmooc.sjtu.cn/v.mp4', type: 'video' })

      // 2. protocol relative video URL
      expect(resolveCnmoocResourceUrl({ node: { highUrl: '//vod.cnmooc.sjtu.cn/high.mp4' } }))
        .toEqual({ url: 'https://vod.cnmooc.sjtu.cn/high.mp4', type: 'video' })

      // 3. playList array
      expect(resolveCnmoocResourceUrl({ node: { playList: [{ url: 'https://cdn.cnmooc.sjtu.cn/live.m3u8' }] } }))
        .toEqual({ url: 'https://cdn.cnmooc.sjtu.cn/live.m3u8', type: 'video' })

      // 4. playList dictionary
      expect(resolveCnmoocResourceUrl({ node: { videoPlayList: { hd: 'https://cdn.cnmooc.sjtu.cn/hd.mp4' } } }))
        .toEqual({ url: 'https://cdn.cnmooc.sjtu.cn/hd.mp4', type: 'video' })

      // 5. flv fallback
      expect(resolveCnmoocResourceUrl({ node: { flvUrl: '/media/stream.flv' } }))
        .toEqual({ url: 'https://cnmooc.sjtu.cn/media/stream.flv', type: 'video' })

      // 6. rsUrl document fallback
      expect(resolveCnmoocResourceUrl({ node: { rsUrl: '/docs/slides.pdf' }, path: 'https://static.cnmooc.sjtu.cn' }))
        .toEqual({ url: 'https://static.cnmooc.sjtu.cn/docs/slides.pdf', type: 'document' })

      // 7. extractCnmoocDirectUrl alias
      expect(extractCnmoocDirectUrl({ node: { mp4Url: 'https://cnmooc.sjtu.cn/alias.mp4' } }).url)
        .toBe('https://cnmooc.sjtu.cn/alias.mp4')

      // 8. Error on empty payload
      expect(() => resolveCnmoocResourceUrl({})).toThrow('detail 响应无可下载 URL')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 4. Interactive Login CLI Scaffold & Network Prober (R4-F1)
  // ─────────────────────────────────────────────────────────────
  describe('4. Interactive Login CLI Scaffold & Network Prober', () => {
    it('parseCliArgs: correctly parses flags and default values', () => {
      const defaultArgs = parseCliArgs([])
      expect(defaultArgs).toEqual({
        dumpTraffic: false,
        saveSession: false,
        probeOnly: false,
        help: false
      })

      const customArgs = parseCliArgs(['--dump-traffic', '--save-session', '--probe-only'])
      expect(customArgs).toEqual({
        dumpTraffic: true,
        saveSession: true,
        probeOnly: true,
        help: false
      })

      expect(parseCliArgs(['-h']).help).toBe(true)
      expect(parseCliArgs(['--help']).help).toBe(true)
    })

    it('extractSessionCredentials: scans across 6 SJTU domains and extracts critical tokens', async () => {
      const mockCookies = [
        { domain: 'sjtu.edu.cn', name: 'JA_TICKET', value: 'ticket_123', path: '/' },
        { domain: 'pan.sjtu.edu.cn', name: 'USER_TOKEN', value: 'cloudpan_token_abc12345678901234567890', path: '/' },
        { domain: 'cnmooc.sjtu.cn', name: 'cpstk', value: 'cnmooc_post_token_xyz', path: '/' },
        { domain: 'oc.sjtu.edu.cn', name: '_legacy_normandy_session', value: 'canvas_sess', path: '/' },
        { domain: 'v.sjtu.edu.cn', name: 'JSESSIONID', value: 'jsess_987', path: '/' }
      ]

      const mockSes = {
        cookies: {
          get: vi.fn(async (query: any) => {
            if (query.url) {
              return mockCookies.filter(c => c.domain === 'pan.sjtu.edu.cn')
            }
            return mockCookies.filter(c => c.domain === query.domain)
          })
        }
      } as any

      const creds = await extractSessionCredentials(mockSes)
      expect(creds.userToken).toBe('cloudpan_token_abc12345678901234567890')
      expect(creds.cpstk).toBe('cnmooc_post_token_xyz')
      expect(creds.jsessionid).toBe('jsess_987')
      expect(creds.totalCookies).toBe(5)
    })

    it('probeSubsystemConnectivity: probes all 5 subsystems and produces a complete scorecard', async () => {
      const mockSes = {
        fetch: vi.fn(async (url: string) => {
          if (url.includes('jaccount')) return { status: 302 }
          if (url.includes('courses')) return { status: 200 }
          if (url.includes('auditCourse')) return { status: 200 }
          if (url.includes('pan.sjtu.edu.cn')) return { status: 200 }
          if (url.includes('cnmooc')) return { status: 200 }
          return { status: 404 }
        })
      } as any

      const scorecard = await probeSubsystemConnectivity(mockSes, 'test_user_token')
      expect(scorecard.auth).toBe(true)
      expect(scorecard.canvas).toBe(true)
      expect(scorecard.vsjtu).toBe(true)
      expect(scorecard.cloudpan).toBe(true)
      expect(scorecard.cnmooc).toBe(true)
      expect(scorecard.details.auth).toBe('HTTP 302')
      expect(scorecard.details.canvas).toBe('HTTP 200')
    })
  })
})
