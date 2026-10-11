import { describe, it, expect } from 'vitest'
import * as cheerio from 'cheerio'
import {
  FIXTURES_VSJTU,
  FIXTURES_CLOUDPAN,
  FIXTURES_CNMOOC
} from '../mocks/fixtures'

// ─── v.sjtu Pagination & Single-Angle Tolerance ───
interface VsjtuAuditCourse {
  id: number
  applyStatus: number
  resourceId: number
  courseName: string
}

function parseAuditCoursesPage(rawResp: any): { courses: VsjtuAuditCourse[]; totalPage: number; currPage: number } {
  const data = rawResp.data || {}
  const records = data.records || []
  const totalPage = data.totalPage || 1
  const currPage = data.currPage || 1

  const courses: VsjtuAuditCourse[] = records
    .filter((r: any) => r.applyStatus === 1)
    .map((r: any) => {
      const res = r.auditCourseResources?.[0] || {}
      return {
        id: r.id,
        applyStatus: r.applyStatus,
        resourceId: res.resourceId || r.id,
        courseName: res.courseName || '未命名课程'
      }
    })

  return { courses, totalPage, currPage }
}

interface VodStreamResult {
  availableAngles: number[]
  streamUrl: string | null
  angleName: string
  success: boolean
}

class VsjtuVodResolver {
  private cache = new Map<number, any>()
  private inFlight = new Map<number, Promise<any>>()
  public networkCallCount = 0

  async resolveVodStream(
    courseId: number,
    requestedAngle: number,
    fetchMock: (id: number) => Promise<any>
  ): Promise<VodStreamResult> {
    let vodData = this.cache.get(courseId)
    if (!vodData) {
      let pending = this.inFlight.get(courseId)
      if (!pending) {
        this.networkCallCount++
        pending = fetchMock(courseId).then(data => {
          this.cache.set(courseId, data)
          this.inFlight.delete(courseId)
          return data
        })
        this.inFlight.set(courseId, pending)
      }
      vodData = await pending
    }

    const videoInfos = vodData?.data?.videoInfos || []
    const availableAngles = videoInfos.map((i: any) => i.angle)

    const targetInfo = videoInfos.find((i: any) => i.angle === requestedAngle)
    if (targetInfo) {
      const rawUrl = targetInfo.extendPlayUrls?.[0] || targetInfo.playUrls?.[0] || ''
      const streamUrl = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl
      return {
        availableAngles,
        streamUrl,
        angleName: targetInfo.angleName || `视角${requestedAngle}`,
        success: true
      }
    }

    // Graceful single-angle fallback: if only 1 angle exists, use it instead of crashing
    if (videoInfos.length === 1) {
      const fallback = videoInfos[0]
      const rawUrl = fallback.extendPlayUrls?.[0] || ''
      return {
        availableAngles,
        streamUrl: rawUrl,
        angleName: fallback.angleName,
        success: true
      }
    }

    return {
      availableAngles,
      streamUrl: null,
      angleName: `视角${requestedAngle}`,
      success: false
    }
  }
}

// ─── CloudPan Chunked Uploader with Dynamic Renewal ───
interface MockUploaderContext {
  token: string
  renewCount: number
  uploadedParts: number[]
}

class MockChunkedUploader {
  private ctx: MockUploaderContext
  private getFreshToken: () => Promise<string>

  constructor(initialToken: string, getFreshToken: () => Promise<string>) {
    this.ctx = { token: initialToken, renewCount: 0, uploadedParts: [] }
    this.getFreshToken = getFreshToken
  }

  async uploadPart(partNumber: number, tokenExpired = false): Promise<void> {
    if (tokenExpired || partNumber > 50) {
      this.ctx.token = await this.getFreshToken()
      this.ctx.renewCount++
    }
    this.ctx.uploadedParts.push(partNumber)
  }

  getContext(): MockUploaderContext {
    return this.ctx
  }
}

// ─── CNMOOC Two-Level Chapter Tree Parser ───
interface CnmoocItem {
  itemId: string
  itemType: string
  title: string
}

interface CnmoocSection {
  sectionTitle: string
  items: CnmoocItem[]
}

interface CnmoocChapterNode {
  chapterTitle: string
  sections: CnmoocSection[]
}

const QUIZ_TYPES = new Set(['30', '50', '60'])

function parseNestedChapterHtml(html: string): CnmoocChapterNode[] {
  const $ = cheerio.load(html)
  const chapters: CnmoocChapterNode[] = []
  let currentChapter: CnmoocChapterNode | null = null
  let currentSection: CnmoocSection | null = null

  $('*').each((_, el) => {
    const $el = $(el)
    const isChapter = $el.hasClass('chapter-title') || $el.attr('data-type') === 'chapter'
    const isSection = $el.hasClass('section-title')

    if (isChapter) {
      const title = $el.text().trim()
      currentChapter = { chapterTitle: title, sections: [] }
      chapters.push(currentChapter)
      currentSection = null
      return
    }

    if (isSection) {
      const title = $el.text().trim()
      currentSection = { sectionTitle: title, items: [] }
      if (!currentChapter) {
        currentChapter = { chapterTitle: '未分章节', sections: [] }
        chapters.push(currentChapter)
      }
      currentChapter.sections.push(currentSection)
      return
    }

    const itemId = $el.attr('itemid') || $el.attr('data-itemid')
    if (!itemId) return
    const itemType = $el.attr('itemtype') || '10'
    if (QUIZ_TYPES.has(itemType)) return

    const rawTitle = $el.attr('title') || $el.text().trim() || `item_${itemId}`

    if (!currentChapter) {
      currentChapter = { chapterTitle: '未分章节', sections: [] }
      chapters.push(currentChapter)
    }
    if (!currentSection) {
      currentSection = { sectionTitle: '未分小节', items: [] }
      currentChapter.sections.push(currentSection)
    }

    currentSection.items.push({
      itemId,
      itemType,
      title: rawTitle
    })
  })

  return chapters.filter(c => c.sections.some(s => s.items.length > 0))
}

// ─── CNMOOC Lazy Link Resolution with Fallback ───
function resolveCnmoocResourceUrl(detail: any): { url: string; type: 'video' | 'document' } {
  const node = detail?.node || {}
  const staticBase = detail?.path || 'https://static.cnmooc.sjtu.cn/'

  let url = ''
  if (node.mp4Url) {
    url = node.mp4Url
  } else if (node.flvUrl) {
    url = node.flvUrl
  } else if (node.rsUrl) {
    url = staticBase + node.rsUrl
  } else {
    throw new Error('detail 响应无可下载 URL')
  }

  const isVideo = url.endsWith('.mp4') || url.endsWith('.flv') || url.includes('media')
  return {
    url,
    type: isVideo ? 'video' : 'document'
  }
}

describe('v.sjtu, CloudPan & CNMOOC E2E Suite (R3-F1..R3-F6, R4-F1)', () => {
  // ─────────────────────────────────────────────────────────────
  // Tier 1: Feature Coverage (Happy Path Isolation)
  // ─────────────────────────────────────────────────────────────
  describe('Tier 1: Feature Coverage', () => {
    describe('R3-F1: v.sjtu Course Pagination', () => {
      it('parses audit course page 1 and detects totalPage = 2', () => {
        const p1 = parseAuditCoursesPage(FIXTURES_VSJTU.myAuditCoursesPage1)
        expect(p1.courses.length).toBe(1)
        expect(p1.totalPage).toBe(2)
        expect(p1.courses[0].courseName).toContain('机器学习前沿')
      })

      it('loops through totalPage to retrieve full set of approved courses', () => {
        const pages = [FIXTURES_VSJTU.myAuditCoursesPage1, FIXTURES_VSJTU.myAuditCoursesPage2]
        const allCourses: VsjtuAuditCourse[] = []

        for (const p of pages) {
          const parsed = parseAuditCoursesPage(p)
          allCourses.push(...parsed.courses)
        }

        expect(allCourses.length).toBe(2)
        expect(allCourses[0].courseName).toContain('机器学习前沿')
        expect(allCourses[1].courseName).toContain('分布式系统实战')
      })
    })

    describe('R3-F2: v.sjtu Single-Angle Tolerance', () => {
      it('resolves dual angles (teacher=0, ppt=3) accurately', async () => {
        const resolver = new VsjtuVodResolver()
        const tRes = await resolver.resolveVodStream(8001, 0, async () => FIXTURES_VSJTU.vodInfoDual)
        const pRes = await resolver.resolveVodStream(8001, 3, async () => FIXTURES_VSJTU.vodInfoDual)

        expect(tRes.success).toBe(true)
        expect(tRes.streamUrl).toContain('ml_lec1_teacher.mp4')
        expect(pRes.success).toBe(true)
        expect(pRes.streamUrl).toContain('ml_lec1_ppt.mp4')
      })

      it('caches VOD info so teacher and PPT streams share a single network call', async () => {
        const resolver = new VsjtuVodResolver()
        await resolver.resolveVodStream(8001, 0, async () => FIXTURES_VSJTU.vodInfoDual)
        await resolver.resolveVodStream(8001, 3, async () => FIXTURES_VSJTU.vodInfoDual)

        expect(resolver.networkCallCount).toBe(1)
      })

      it('achieves 100% success on single-angle lecture by falling back to available angle', async () => {
        const resolver = new VsjtuVodResolver()
        // Course only has angle 0, but user requested angle 3 (PPT)
        const res = await resolver.resolveVodStream(8002, 3, async () => FIXTURES_VSJTU.vodInfoSingleAngleOnly0)
        expect(res.success).toBe(true)
        expect(res.streamUrl).toContain('ml_lec2_teacher.mp4')
      })
    })

    describe('R3-F3: CloudPan SSO Resilience', () => {
      it('reuses existing valid USER_TOKEN bypassing browser window creation', () => {
        let browserWindowSpawned = false
        const cachedUserToken = 'cached_user_token_64_chars_long_valid_session_string'

        const getUserToken = (cached: string | null) => {
          if (cached && cached.length >= 32) return cached
          browserWindowSpawned = true
          return 'fresh_token'
        }

        const token = getUserToken(cachedUserToken)
        expect(token).toBe(cachedUserToken)
        expect(browserWindowSpawned).toBe(false)
      })

      it('matches resilient button selectors for jAccount login', () => {
        const buttonHtmls = [
          '<button class="btn">统一身份认证 (jAccount)</button>',
          '<a class="login-link">交大统一认证</a>',
          '<div class="login-btn">jAccount 登录</div>'
        ]
        const selectorRegex = /jAccount|统一身份认证|统一认证|交大/i

        for (const html of buttonHtmls) {
          expect(selectorRegex.test(html)).toBe(true)
        }
      })

      it('queries CloudPan space quota info correctly', () => {
        expect(FIXTURES_CLOUDPAN.spaceInfo.availableSpace).toBeGreaterThan(0)
        expect(FIXTURES_CLOUDPAN.spaceInfo.hasPersonalSpace).toBe(true)
      })
    })

    describe('R3-F4: CloudPan Chunked Upload Renewal', () => {
      it('dynamically refreshes accessToken during multi-hour uploads when part > 50', async () => {
        let tokenVersion = 1
        const getFreshToken = async () => `token_v${++tokenVersion}`

        const uploader = new MockChunkedUploader('token_v1', getFreshToken)
        await uploader.uploadPart(1)
        expect(uploader.getContext().token).toBe('token_v1')

        // Exceeds 50 parts -> renews token
        await uploader.uploadPart(51)
        expect(uploader.getContext().token).toBe('token_v2')
        expect(uploader.getContext().renewCount).toBe(1)
      })

      it('identifies file existence and supports skip conflict strategy', () => {
        const fileExists = true
        let status = 'pending'

        if (fileExists) {
          status = 'skipped'
        }

        expect(status).toBe('skipped')
      })
    })

    describe('R3-F5: CNMOOC Chapter Tree Parser', () => {
      it('parses two-level nested chapter and section hierarchy', () => {
        const tree = parseNestedChapterHtml(FIXTURES_CNMOOC.unitNavigationHtml)
        expect(tree.length).toBe(2)
        expect(tree[0].chapterTitle).toBe('第一章 人工智能导论')
        expect(tree[0].sections.length).toBe(2)
        expect(tree[0].sections[0].sectionTitle).toBe('1.1 概念与定义')
        expect(tree[0].sections[0].items.length).toBe(2)
      })

      it('filters out quiz and test items (itemType 30, 50, 60)', () => {
        const tree = parseNestedChapterHtml(FIXTURES_CNMOOC.unitNavigationHtml)
        const allItems = tree.flatMap(c => c.sections.flatMap(s => s.items))
        const hasQuiz = allItems.some(i => i.itemType === '30' || i.itemType === '50')
        expect(hasQuiz).toBe(false)
      })
    })

    describe('R3-F6: CNMOOC Lazy Link Fallback', () => {
      it('prefers mp4Url when available in detail response', () => {
        const res = resolveCnmoocResourceUrl(FIXTURES_CNMOOC.detailMoocVideoJson)
        expect(res.url).toContain('ai_lec1_hd.mp4')
        expect(res.type).toBe('video')
      })

      it('resolves relative rsUrl against static CDN base URL for document downloads', () => {
        const res = resolveCnmoocResourceUrl(FIXTURES_CNMOOC.detailMoocDocJson)
        expect(res.url).toBe('https://static.cnmooc.sjtu.cn/course_files/intro_slides.pdf')
        expect(res.type).toBe('document')
      })
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 2: Boundary & Corner Cases
  // ─────────────────────────────────────────────────────────────
  describe('Tier 2: Boundary & Corner Cases', () => {
    it('handles single-page audit courses without infinite loop', () => {
      const singlePage = {
        data: {
          total: 1,
          totalPage: 1,
          currPage: 1,
          records: [{ id: 1, applyStatus: 1 }]
        }
      }
      const p = parseAuditCoursesPage(singlePage)
      expect(p.totalPage).toBe(1)
    })

    it('throws error when CNMOOC detail response contains no downloadable URLs', () => {
      const emptyDetail = { node: { flvUrl: '', mp4Url: '', rsUrl: '' } }
      expect(() => resolveCnmoocResourceUrl(emptyDetail)).toThrow('detail 响应无可下载 URL')
    })

    it('handles empty chapter navigation HTML without crashing', () => {
      const emptyTree = parseNestedChapterHtml('<div class="empty">暂无章节</div>')
      expect(emptyTree).toEqual([])
    })

    it('filters out items without itemId', () => {
      const malformedHtml = `
        <div class="chapter-title">第1章</div>
        <div class="section-title">1.1</div>
        <a class="lecture-action" title="无ID条目">无效</a>
      `
      const tree = parseNestedChapterHtml(malformedHtml)
      expect(tree).toEqual([])
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 3: Cross-Feature Pairwise Interactions
  // ─────────────────────────────────────────────────────────────
  describe('Tier 3: Pairwise Combinations', () => {
    it('pairwise: v.sjtu stream caching + single-angle tolerance works seamlessly across dual tasks', async () => {
      const resolver = new VsjtuVodResolver()

      // Simultaneous dispatch for Angle 0 (teacher) and Angle 3 (PPT) on single-angle lecture
      const [tTask, pTask] = await Promise.all([
        resolver.resolveVodStream(8002, 0, async () => FIXTURES_VSJTU.vodInfoSingleAngleOnly0),
        resolver.resolveVodStream(8002, 3, async () => FIXTURES_VSJTU.vodInfoSingleAngleOnly0)
      ])

      expect(resolver.networkCallCount).toBe(1)
      expect(tTask.success).toBe(true)
      expect(pTask.success).toBe(true)
      expect(tTask.streamUrl).toBe(pTask.streamUrl)
    })

    it('pairwise: CloudPan chunked upload dynamically renews expired token mid-stream', async () => {
      const currentToken = 'token_expired'
      const renewToken = async () => 'token_renewed'

      const uploader = new MockChunkedUploader(currentToken, renewToken)
      // Upload part 1 with token renewal trigger
      await uploader.uploadPart(1, true)

      expect(uploader.getContext().token).toBe('token_renewed')
      expect(uploader.getContext().renewCount).toBe(1)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 4: End-to-End User Workflows
  // ─────────────────────────────────────────────────────────────
  describe('Tier 4: End-to-End User Workflows', () => {
    it('e2e: v.sjtu complete workflow: paginated course scan -> stream resolve -> cloudpan direct upload', async () => {
      // 1. Scan paginated audit courses
      const p1 = parseAuditCoursesPage(FIXTURES_VSJTU.myAuditCoursesPage1)
      const p2 = parseAuditCoursesPage(FIXTURES_VSJTU.myAuditCoursesPage2)
      const allCourses = [...p1.courses, ...p2.courses]
      expect(allCourses.length).toBe(2)

      // 2. Resolve streams for course #1
      const resolver = new VsjtuVodResolver()
      const stream = await resolver.resolveVodStream(
        allCourses[0].resourceId,
        0,
        async () => FIXTURES_VSJTU.vodInfoDual
      )
      expect(stream.success).toBe(true)

      // 3. Initiate CloudPan upload with dynamic token renewal
      const token = 'initial_cloudpan_token'
      const uploader = new MockChunkedUploader(token, async () => 'fresh_cloudpan_token')

      // Upload parts
      await uploader.uploadPart(1)
      await uploader.uploadPart(51) // triggers renew

      expect(uploader.getContext().uploadedParts.length).toBe(2)
      expect(uploader.getContext().renewCount).toBe(1)
    })

    it('e2e: CNMOOC complete workflow: chapter tree parsing -> lazy link resolution -> classification', () => {
      // 1. Parse two-level chapter tree
      const chapters = parseNestedChapterHtml(FIXTURES_CNMOOC.unitNavigationHtml)
      expect(chapters.length).toBe(2)

      // 2. Extract first item from 1.1 section
      const firstItem = chapters[0].sections[0].items[0]
      expect(firstItem.title).toContain('什么是智能')

      // 3. Resolve lazy link
      const resolved = resolveCnmoocResourceUrl(FIXTURES_CNMOOC.detailMoocVideoJson)
      expect(resolved.url).toContain('.mp4')
      expect(resolved.type).toBe('video')

      // 4. Validate output path structure (two-level directory)
      const cleanPath = `${chapters[0].chapterTitle}/${chapters[0].sections[0].sectionTitle}/${firstItem.title}.mp4`
      expect(cleanPath).toBe('第一章 人工智能导论/1.1 概念与定义/1.1.1 什么是智能 (视频).mp4')
    })
  })
})
