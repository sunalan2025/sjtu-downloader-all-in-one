/**
 * 好大学在线 (cnmooc.sjtu.cn) REST 客户端
 *
 * 移植自独立项目 cnmooc-downloader（src/courses.js / chapters.js / resources.js /
 * utils.js / config.js），改用 Electron session（persist:sjtu，复用 jAccount 登录态）
 * + cheerio 解析 HTML，与 canvas/api.ts 同构。
 *
 * 关键链路：
 *  - 课程列表：GET /portal/myCourseIndex/1.mooc → HTML 解析 a.view-shadow 卡片
 *  - 章节：GET /portal/session/unitNavigation/{courseId}.mooc → HTML 遍历章节标题 + 条目
 *  - 资源直链（下载时懒解析）：POST /study/play.mooc 取 nodeId → POST /item/detail.mooc
 *    取 node.flvUrl（视频，绝对）/ node.rsUrl（课件，相对 static.cnmooc.sjtu.cn）
 *  - postoken 取自 cpstk cookie
 */
import { BrowserWindow } from 'electron'
import type Electron from 'electron'
import * as cheerio from 'cheerio'
import {
  CNMOOC_BASE_URL,
  CNMOOC_MY_COURSES_URL,
  CNMOOC_STATIC_BASE,
  type CnmoocChapter,
  type CnmoocChapterNode,
  type CnmoocCourse,
  type CnmoocItem,
  type CnmoocSection
} from '../../shared/types'
import { safeFetch } from '../canvas/safe-fetch'
import { sanitizeFsName } from '../canvas/api'

const PLAY_URL = `${CNMOOC_BASE_URL}/study/play.mooc`
const DETAIL_URL = `${CNMOOC_BASE_URL}/item/detail.mooc`
const UNIT_NAV_URL = (courseId: number): string => `${CNMOOC_BASE_URL}/portal/session/unitNavigation/${courseId}.mooc`

/** 测验/作业类 itemType，无可下载资源，扫描时过滤 */
const QUIZ_TYPES = new Set(['30', '50', '60'])

// ─── 通用重试（指数退避） ──────────────────────────────────────

async function retry<T>(fn: () => Promise<T>, maxAttempts = 3, baseDelay = 1000): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === maxAttempts) break
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt - 1)))
    }
  }
  throw lastErr
}

// ─── postoken / 会话校验 ───────────────────────────────────────

/** 读 cpstk cookie 值（POST play/detail 用的 postoken）。Electron cookies API 是 async。 */
export async function readPostokenAsync(ses: Electron.Session): Promise<string> {
  try {
    const cookies = await ses.cookies.get({ url: CNMOOC_BASE_URL })
    return cookies.find(c => c.name === 'cpstk')?.value || ''
  } catch {
    return ''
  }
}

/** 校验 cnmooc 会话是否有效。
 *  1. 前置检查 cpstk cookie（SSO 成功后 cnmooc 落的，没有则肯定未登录，快速失败）
 *  2. 探测 myCourseIndex 确认会话真正可用（已登录 200；过期/未登录 302 到 login.mooc） */
export async function isCnmoocSessionValid(ses: Electron.Session): Promise<boolean> {
  try {
    const cookies = await ses.cookies.get({ url: CNMOOC_BASE_URL })
    if (!cookies.some(c => c.name === 'cpstk' && c.value)) return false
  } catch {
    return false
  }
  try {
    const resp = await safeFetch(ses, CNMOOC_MY_COURSES_URL, { redirect: 'manual' })
    if (resp.status >= 300 && resp.status < 400) return false
    if (resp.status !== 200) return false
    const body = await resp.text()
    if (/login\.mooc|jaccount|请登录|使用JAccount/i.test(body)) return false
    return true
  } catch {
    return false
  }
}

// ─── 课程列表 ─────────────────────────────────────────────────

/** 获取「正在学习」课程列表（支持多页扫描与去重）。
 *  优先尝试 safeFetch（适用于测试或服务端已包含卡片场景）；
 *  若为空则使用隐藏 BrowserWindow 异步渲染取 DOM。 */
export async function fetchCourses(ses: Electron.Session, maxPages = 10): Promise<CnmoocCourse[]> {
  const allCourses: CnmoocCourse[] = []
  const seen = new Set<string>()

  // 先尝试直接请求第 1 页判断是否已有静态/Mock 卡片
  try {
    const directResp = await safeFetch(ses, CNMOOC_MY_COURSES_URL)
    if (directResp.ok) {
      const directHtml = await directResp.text()
      const initial = parseCourseHtml(directHtml)
      if (initial.length > 0) {
        for (const c of initial) {
          if (!seen.has(c.courseId)) { seen.add(c.courseId); allCourses.push(c) }
        }
        // 多页抓取
        for (let p = 2; p <= maxPages; p++) {
          const nextResp = await safeFetch(ses, `${CNMOOC_BASE_URL}/portal/myCourseIndex/${p}.mooc`)
          if (!nextResp.ok) break
          const nextHtml = await nextResp.text()
          const nextList = parseCourseHtml(nextHtml)
          if (nextList.length === 0) break
          let added = 0
          for (const c of nextList) {
            if (!seen.has(c.courseId)) { seen.add(c.courseId); allCourses.push(c); added++ }
          }
          if (added === 0) break
        }
        return allCourses
      }
    }
  } catch {
    /* 继续降级至 BrowserWindow */
  }

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  try {
    for (let page = 1; page <= maxPages; page++) {
      const pageUrl = `${CNMOOC_BASE_URL}/portal/myCourseIndex/${page}.mooc`
      await win.loadURL(pageUrl)
      const html = await win.webContents.executeJavaScript(`
        (() => new Promise(resolve => {
          let n = 0
          const check = () => {
            const a = document.querySelector('a.view-shadow[href*="/portal/session/index/"]')
            if (a || ++n > 40) return resolve(document.documentElement.outerHTML)
            setTimeout(check, 250)
          }
          check()
        }))()
      `)
      const pageCourses = parseCourseHtml(html)
      if (pageCourses.length === 0) break
      let added = 0
      for (const c of pageCourses) {
        if (!seen.has(c.courseId)) { seen.add(c.courseId); allCourses.push(c); added++ }
      }
      if (added === 0) break
    }
    return allCourses
  } finally {
    win.destroy()
  }
}

/** 解析 myCourseIndex HTML：a.view-shadow[href*="/portal/session/index/{id}.mooc"] 包裹 .view 卡片，
 *  h3.view-title 取课程名（剔除 span.cview-time 子文本）。 */
export function parseCourseHtml(html: string): CnmoocCourse[] {
  const $ = cheerio.load(html)
  const courses: CnmoocCourse[] = []
  const seen = new Set<string>()
  $('a.view-shadow[href*="/portal/session/index/"]').each((_, el) => {
    const $el = $(el)
    const href = $el.attr('href') || ''
    const m = href.match(/\/portal\/session\/index\/(\d+)\.mooc/)
    if (!m) return
    const courseId = m[1]
    if (seen.has(courseId)) return
    seen.add(courseId)
    const $card = $el.closest('.view')
    const $h3 = $card.find('h3.view-title').clone()
    $h3.find('span').remove()
    const rawName = $h3.text().trim()
    const name = rawName ? sanitizeFsName(rawName) : `course_${courseId}`
    courses.push({ courseId, name })
  })
  return courses
}

// ─── 章节 ─────────────────────────────────────────────────────

/** 获取一门课的章节结构（章节标题 + 条目列表）。
 *  courseId 来自用户可控路由参数，先转 int 校验（防注入，对齐 chapters.js）。 */
export async function fetchChapters(ses: Electron.Session, courseId: string): Promise<CnmoocChapter[]> {
  const courseIdNum = Number(courseId)
  if (!Number.isInteger(courseIdNum) || courseIdNum <= 0) {
    throw new Error(`invalid courseId: ${courseId}`)
  }
  const resp = await safeFetch(ses, UNIT_NAV_URL(courseIdNum), {
    headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
  })
  if (!resp.ok) throw new Error(`获取章节失败：HTTP ${resp.status}`)
  const html = await resp.text()
  const chapters = parseChapterHtml(html)
  console.log(`[cnmooc] 章节 courseId=${courseId}：${chapters.length} 章 / ${chapters.reduce((s, c) => s + c.items.length, 0)} 条目`)
  if (chapters.length === 0) {
    const hasLogin = /login\.mooc|jaccount|请登录|使用JAccount/i.test(html)
    console.log(`[cnmooc] 章节为空（HTML ${html.length} 字符，含 itemid=${/itemid=/.test(html)}，${hasLogin ? '疑似未登录/会话失效' : '页面结构异常'}）`)
  }
  return chapters
}

/** 解析 unitNavigation HTML 为两级嵌套树结构 (R3-F5) */
export function parseNestedChapterHtml(html: string): CnmoocChapterNode[] {
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
      if (title) {
        currentChapter = { chapterTitle: title, sections: [] }
        chapters.push(currentChapter)
        currentSection = null
      }
      return
    }

    if (isSection) {
      const title = $el.text().trim()
      if (title) {
        currentSection = { sectionTitle: title, items: [] }
        if (!currentChapter) {
          currentChapter = { chapterTitle: '未分章节', sections: [] }
          chapters.push(currentChapter)
        }
        currentChapter.sections.push(currentSection)
      }
      return
    }

    const itemId = $el.attr('itemid') || $el.attr('data-itemid') || $el.attr('id')?.match(/item[_-]?(\d+)/i)?.[1]
    if (!itemId) return

    const rawTitle = $el.attr('title') || $el.attr('data-title') || $el.text().trim() || `item_${itemId}`
    let itemType = $el.attr('itemtype') || $el.attr('data-itemtype')
    const isDocTitle = /\.(pdf|ppt|pptx|doc|docx|xls|xlsx|txt|zip|rar)($|\s)/i.test(rawTitle)
      || /\((课件|文档|资料|PPT|PDF)\)/i.test(rawTitle)

    if (!itemType) {
      itemType = isDocTitle ? '20' : '10'
    } else if (itemType === '10' && isDocTitle) {
      // 容错：即使上游 DOM 标记为 10，但文件名明确为 PPT/PDF/DOC，修正为课件文档类型 20
      itemType = '20'
    }

    if (QUIZ_TYPES.has(itemType)) return

    if (!currentChapter) {
      currentChapter = { chapterTitle: '未分章节', sections: [] }
      chapters.push(currentChapter)
    }
    if (!currentSection) {
      currentSection = { sectionTitle: '未分小节', items: [] }
      currentChapter.sections.push(currentSection)
    }

    if (!currentSection.items.some(i => i.itemId === itemId)) {
      currentSection.items.push({ itemId, itemType, title: rawTitle })
    }
  })

  return chapters.filter(c => c.sections.some(s => s.items.length > 0))
}

/** 兼容前端的章节列表结构（包含多级子目录路径） */
export function parseChapterHtml(html: string): CnmoocChapter[] {
  const tree = parseNestedChapterHtml(html)
  const chapters: CnmoocChapter[] = []
  for (const c of tree) {
    for (const s of c.sections) {
      const chapterPath = s.sectionTitle === '未分小节'
        ? sanitizeFsName(c.chapterTitle)
        : `${sanitizeFsName(c.chapterTitle)}/${sanitizeFsName(s.sectionTitle)}`
      chapters.push({
        chapter: chapterPath,
        chapterTitle: c.chapterTitle,
        sections: c.sections,
        items: s.items.map(it => ({
          ...it,
          title: sanitizeFsName(it.title)
        }))
      })
    }
  }
  return chapters
}

// ─── URL 工具 ─────────────────────────────────────────────────

/** 相对 URL 补全为绝对（cnmooc 站内） */
function resolveRelative(maybeRelative: string): string {
  if (!maybeRelative) return ''
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative
  if (maybeRelative.startsWith('//')) return 'https:' + maybeRelative
  if (maybeRelative.startsWith('/')) return CNMOOC_BASE_URL + maybeRelative
  return CNMOOC_BASE_URL + '/' + maybeRelative
}

// ─── 资源直链（下载时懒解析） ─────────────────────────────────

/** 统一资源直链解析（支持 mp4 / flv / playList / rsUrl） (R3-F6) */
export function resolveCnmoocResourceUrl(detail: any): { url: string; type: 'video' | 'document' } {
  const node = detail?.node || {}
  const rawStatic = detail?.path || CNMOOC_STATIC_BASE
  const staticBase = rawStatic.endsWith('/') ? rawStatic : `${rawStatic}/`

  let candidateVideoUrl = node.mp4Url || node.hdUrl || node.highUrl || node.playUrl || node.videoUrl || node.hlsUrl

  if (!candidateVideoUrl && (node.playList || node.videoPlayList)) {
    const pl = node.playList || node.videoPlayList
    if (typeof pl === 'string') {
      candidateVideoUrl = pl
    } else if (Array.isArray(pl) && pl.length > 0) {
      candidateVideoUrl = pl[0]?.url || pl[0]?.playUrl || pl[0]
    } else if (typeof pl === 'object') {
      candidateVideoUrl = pl.shd || pl.hd || pl.sd || Object.values(pl)[0]
    }
  }

  if (!candidateVideoUrl && node.flvUrl) {
    candidateVideoUrl = node.flvUrl
  }

  let url = ''
  if (candidateVideoUrl) {
    url = resolveRelative(candidateVideoUrl)
  } else if (node.rsUrl) {
    url = staticBase + String(node.rsUrl).replace(/^\/+/, '')
  } else {
    throw new Error('detail 响应无可下载 URL')
  }

  return {
    url,
    type: classifyCnmoocResource(url)
  }
}

export const extractCnmoocDirectUrl = resolveCnmoocResourceUrl

/** 单次 POST（form-urlencoded + X-Requested-With + Referer） */
async function cnmoocPost(
  ses: Electron.Session,
  url: string,
  form: Record<string, string>,
  referer: string,
  accept?: string
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: referer,
    Origin: CNMOOC_BASE_URL
  }
  if (accept) headers.Accept = accept
  return safeFetch(ses, url, { method: 'POST', headers, body: new URLSearchParams(form).toString() })
}

/** 解析一个 cnmooc 条目的下载直链 + 资源类型。
 *  两步：POST play.mooc 取 nodeId → POST item/detail.mooc 取 node.flvUrl/rsUrl。
 *  失败返回 null（调用方跳过该条目，不中断整批）。 */
export async function fetchCnmoocResourceUrl(
  ses: Electron.Session,
  item: Pick<CnmoocItem, 'itemId' | 'itemType' | 'title'>
): Promise<{ url: string; type: 'video' | 'document' } | null> {
  const postoken = await readPostokenAsync(ses)
  const referer = `${CNMOOC_BASE_URL}/study/initplay/${item.itemId}.mooc`

  const fn = async (): Promise<{ url: string; type: 'video' | 'document' }> => {
    const playResp = await cnmoocPost(
      ses,
      PLAY_URL,
      { itemId: item.itemId, itemType: item.itemType, testPaperId: '', postoken },
      referer
    )
    if (!playResp.ok) throw new Error(`play.mooc HTTP ${playResp.status}`)
    const playHtml = await playResp.text()
    const nodeIdMatch = playHtml.match(/id="nodeId"\s+value="(\d+)"/)
    const nodeId = nodeIdMatch?.[1]
    if (!nodeId) throw new Error('play.mooc 响应无 nodeId')

    const detailResp = await cnmoocPost(
      ses,
      DETAIL_URL,
      { nodeId, itemId: item.itemId, postoken },
      referer,
      'application/json, text/javascript, */*; q=0.01'
    )
    if (!detailResp.ok) throw new Error(`detail.mooc HTTP ${detailResp.status}`)
    const detail = await detailResp.json()
    return resolveCnmoocResourceUrl(detail)
  }

  try {
    return await retry(fn, 3, 1000)
  } catch {
    return null
  }
}

/** 按 URL 扩展名判定资源类型（移植自 cnmooc config.classifyResourceUrl） */
export function classifyCnmoocResource(url: string): 'video' | 'document' {
  if (!url) return 'video'
  const lower = url.toLowerCase()
  if (/\.(mp4|flv|webm|mkv|avi|mov|wmv|m4v)(\?|$)/i.test(lower)) return 'video'
  if (/\.(pdf|ppt|pptx|doc|docx|xls|xlsx|txt|zip|rar)(\?|$)/i.test(lower)) return 'document'
  if (lower.includes('static.cnmooc.sjtu.cn')) return 'document'
  return 'video'
}

/** 从直链推断文件扩展名（如 .mp4 / .pdf）；无扩展名返回空串。
 *  下载时用于补全 fileName（扫描阶段未探直链，fileName 暂无扩展名）。 */
export function inferCnmoocExt(url: string): string {
  try {
    const u = new URL(url)
    const m = u.pathname.match(/\.([a-z0-9]{1,5})$/i)
    if (m) return '.' + m[1].toLowerCase()
  } catch {
    /* ignore */
  }
  return ''
}
