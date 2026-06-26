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
  type CnmoocCourse,
  type CnmoocItem
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

/** 获取「正在学习」课程列表。
 *  myCourseIndex 的课程卡片由 jQuery（js/app/home/index.js）异步渲染，
 *  ses.fetch 只能拿到空骨架 → 必须用隐藏 BrowserWindow 渲染后取 DOM HTML。
 *  关 backgroundThrottling 避免隐藏窗口被节流导致 AJAX 不推进。 */
export async function fetchCourses(ses: Electron.Session): Promise<CnmoocCourse[]> {
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
    await win.loadURL(CNMOOC_MY_COURSES_URL)
    // 课程卡片由 jQuery AJAX 异步加载，loadURL 的 did-finish-load 只等 DOM ready，
    // 这里轮询 a.view-shadow 出现（或 15s 超时）确认渲染完成
    const html = await win.webContents.executeJavaScript(`
      (() => new Promise(resolve => {
        let n = 0
        const check = () => {
          const a = document.querySelector('a.view-shadow[href*="/portal/session/index/"]')
          // 卡片出现，或轮询 60 次（~15s）仍无 → 返回当前 HTML（调用方据此判断是否未登录）
          if (a || ++n > 60) return resolve(document.documentElement.outerHTML)
          setTimeout(check, 250)
        }
        check()
      }))()
    `)
    const courses = parseCourseHtml(html)
    console.log(`[cnmooc] 课程列表渲染完成：${courses.length} 门`)
    if (courses.length === 0) {
      // 诊断：HTML 里既无课程卡片也无登录表单 → 可能页面结构变化；含登录表单 → 会话失效
      const hasLogin = /login\.mooc|jaccount|请登录|使用JAccount/i.test(html)
      console.log(`[cnmooc] 课程列表为空（HTML ${html.length} 字符，${hasLogin ? '疑似未登录/会话失效' : '页面结构异常'}）`)
    }
    return courses
  } finally {
    win.destroy()
  }
}

/** 解析 myCourseIndex HTML：a.view-shadow[href*="/portal/session/index/{id}.mooc"] 包裹 .view 卡片，
 *  h3.view-title 取课程名（剔除 span.cview-time 子文本）。 */
function parseCourseHtml(html: string): CnmoocCourse[] {
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

/** 解析 unitNavigation HTML：DOM 顺序遍历，章节标题（.unit-title 等 / h2-h4）+
 *  条目（a[itemid][itemtype] 或 .lecture-action），过滤测验 itemType。 */
function parseChapterHtml(html: string): CnmoocChapter[] {
  const $ = cheerio.load(html)
  const chapters: CnmoocChapter[] = []
  let current: CnmoocChapter | null = null

  $('*').each((_, el) => {
    const $el = $(el)
    const tag = String($el.prop('tagName') || '').toLowerCase()

    const isChapterHeading =
      $el.hasClass('unit-title') ||
      $el.hasClass('chapter-title') ||
      $el.hasClass('section-title') ||
      $el.attr('data-type') === 'chapter' ||
      tag === 'h2' || tag === 'h3' || tag === 'h4'

    if (isChapterHeading) {
      const title = $el.text().trim()
      if (title) {
        current = { chapter: sanitizeFsName(title), items: [] }
        chapters.push(current)
      }
      return
    }

    const itemId = $el.attr('itemid') || $el.attr('data-itemid')
    if (!itemId) return
    if (tag !== 'a' && !$el.hasClass('lecture-action')) return

    const itemType = $el.attr('itemtype') || '10'
    if (QUIZ_TYPES.has(itemType)) return

    if (!current) {
      current = { chapter: '未分章节', items: [] }
      chapters.push(current)
    }
    if (!current.items.find(i => i.itemId === itemId)) {
      const rawTitle = $el.attr('title') || $el.text().trim()
      const title = rawTitle ? sanitizeFsName(rawTitle) : `item_${itemId}`
      current.items.push({ itemId, itemType, title })
    }
  })

  return chapters.filter(c => c.items.length > 0)
}

// ─── 资源直链（下载时懒解析） ─────────────────────────────────

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
    const detail = await detailResp.json() as {
      node?: { flvUrl?: string; rsUrl?: string }
      path?: string
    }
    const node = detail.node || {}
    const staticBase = detail.path || CNMOOC_STATIC_BASE

    let url = ''
    if (node.flvUrl && /^https?:\/\//i.test(node.flvUrl)) url = node.flvUrl
    else if (node.rsUrl) url = staticBase + node.rsUrl
    else if (node.flvUrl) url = resolveRelative(node.flvUrl)
    else throw new Error('detail 响应无可下载 URL')

    return { url, type: classifyCnmoocResource(url) }
  }

  try {
    return await retry(fn, 3, 1000)
  } catch {
    return null
  }
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
