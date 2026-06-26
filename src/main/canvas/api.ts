/**
 * Canvas REST API 客户端 (oc.sjtu.edu.cn)
 *
 * 替代 Python 的 course_crawler.py / file_downloader.py / modules.py / syllabus.py
 * 使用 Electron session（persist:sjtu）发请求，自动复用 jAccount 登录态。
 */
import type Electron from 'electron'
import {
  CANVAS_API_BASE,
  CANVAS_BASE_URL,
  type CanvasCourse,
  type CanvasFileItem,
  type CanvasModule
} from '../../shared/types'
import { safeFetch } from './safe-fetch'

// ─── Canvas API 请求封装 ──────────────────────────────────────

const CANVAS_ACCEPT = 'application/json+canvas-string-ids, application/json'

/** 自动翻页的 Canvas API 请求。返回所有页的合并结果。 */
export async function canvasFetchAll<T>(
  ses: Electron.Session,
  path: string,
  params?: Record<string, string>
): Promise<T[]> {
  const results: T[] = []
  let url: string | null = buildUrl(path, params)
  while (url) {
    const resp = await canvasFetchWithRetry(ses, url, { method: 'GET', headers: { Accept: CANVAS_ACCEPT } })
    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Canvas API ${resp.status}: ${text.slice(0, 200)}`)
    }
    const data: T[] | T = await resp.json() as T[] | T
    if (Array.isArray(data)) {
      results.push(...data)
    } else {
      results.push(data as T)
    }
    // 跟 Link: <url>; rel="next" 翻页
    url = getNextUrl(resp.headers.get('link'))
  }
  return results
}

/** 单次请求，不翻页 */
export async function canvasFetch<T>(
  ses: Electron.Session,
  path: string,
  opts?: { method?: string; params?: Record<string, string>; body?: unknown }
): Promise<T> {
  const url = buildUrl(path, opts?.params)
  const headers: Record<string, string> = { Accept: CANVAS_ACCEPT }
  let body: string | undefined
  if (opts?.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const resp = await canvasFetchWithRetry(ses, url, { method: opts?.method || 'GET', headers, body })
  const text = await resp.text()
  if (!resp.ok) throw new Error(`Canvas API ${resp.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text) as T
}

/** [Bug Fix] 包装 safeFetch，对 429 限流做退避重试。
 *  Canvas 在并发扫描多门课、每门课并行四个端点时容易触发 429；原实现把 429 当
 *  普通错误抛出，导致整门课扫描失败需手动重扫。这里读 Retry-After（秒），缺省
 *  指数退避，最多重试 CANVAS_MAX_RATE_LIMIT_RETRIES 次。对其它非 429 响应原样返回，
 *  由调用方按 status 处理。 */
const CANVAS_MAX_RATE_LIMIT_RETRIES = 4
async function canvasFetchWithRetry(
  ses: Electron.Session,
  url: string,
  init: RequestInit
): Promise<Response> {
  let attempt = 0
  for (;;) {
    const resp = await safeFetch(ses, url, init)
    if (resp.status !== 429) return resp
    // 已读消费 body 会被丢，但 429 通常无有用 body，直接关闭
    try { await resp.text() } catch { /* ignore */ }
    if (attempt >= CANVAS_MAX_RATE_LIMIT_RETRIES) return resp
    // Retry-After 可能是秒数或 HTTP 日期，这里只处理秒数；缺省用指数退避
    const ra = resp.headers.get('retry-after')
    let delayMs: number
    if (ra && /^\d+$/.test(ra.trim())) {
      delayMs = Math.min(Number(ra.trim()) * 1000, 30_000)
    } else {
      delayMs = Math.min(Math.pow(2, attempt) * 1000, 16_000)
    }
    await new Promise<void>(r => setTimeout(r, delayMs))
    attempt++
  }
}

function buildUrl(path: string, params?: Record<string, string>): string {
  const base = path.startsWith('http') ? path : `${CANVAS_API_BASE}${path}`
  if (!params || Object.keys(params).length === 0) return base
  const qs = new URLSearchParams(params).toString()
  return `${base}?${qs}`
}

/** Canvas 用 Link: <url>; rel="next" 做分页 */
function getNextUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const m = /<([^>]+)>;\s*rel="next"/.exec(linkHeader)
  return m?.[1] ?? null
}

// ─── 文件名清洗 ──────────────────────────────────────────────

export function sanitizeFsName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
  return cleaned.slice(0, 180) || '未命名'
}

// ─── 课程列表 ────────────────────────────────────────────────

export async function listCourses(
  ses: Electron.Session,
  includeCompleted = true
): Promise<CanvasCourse[]> {
  const stateParams = includeCompleted
    ? '&enrollment_state[]=active&enrollment_state[]=completed&enrollment_state[]=invited_or_pending'
    : '&enrollment_state[]=active'
  const items = await canvasFetchAll<Record<string, unknown>>(
    ses,
    `/courses?per_page=100&include[]=term&include[]=teachers${stateParams}`
  )
  return items
    .map(parseCourse)
    .filter((c): c is CanvasCourse => c !== null)
}

function parseCourse(item: Record<string, unknown>): CanvasCourse | null {
  if (item.access_restricted_by_date) return null
  const name = item.name as string | undefined
  if (!name) return null
  const term = ((item.term as Record<string, unknown>)?.name as string) || ''
  const enrollments = (item.enrollments as Array<Record<string, unknown>>) || []
  const states = new Set(enrollments.map(e => e.enrollment_state as string))
  let enrollmentState = 'unknown'
  if (states.has('active')) enrollmentState = 'active'
  else if (states.size > 0) enrollmentState = [...states].filter(Boolean).join(',')
  const teachersRaw = (item.teachers as Array<Record<string, unknown>>) ?? []
  const teachers = teachersRaw
    .map(t => (t.display_name as string) || (t.name as string) || '')
    .filter(Boolean)
  return {
    courseId: Number(item.id),
    name,
    courseCode: (item.course_code as string) || '',
    term,
    teachers,
    enrollmentState,
    url: `${CANVAS_BASE_URL}/courses/${item.id}`
  }
}

// ─── 文件夹树 ────────────────────────────────────────────────

export async function fetchFolderMap(
  ses: Electron.Session,
  courseId: number
): Promise<Map<number, string>> {
  const items = await canvasFetchAll<Record<string, unknown>>(
    ses,
    `/courses/${courseId}/folders?per_page=100`
  )
  const map = new Map<number, string>()
  for (const item of items) {
    let rel = (item.full_name as string) || (item.name as string) || ''
    if (rel.startsWith('course files/')) rel = rel.slice('course files/'.length)
    else if (rel === 'course files') rel = ''
    const clean = rel
      .split('/')
      .filter(Boolean)
      .map(sanitizeFsName)
      .join('/')
    map.set(Number(item.id), clean)
  }
  return map
}

// ─── 文件列表 ────────────────────────────────────────────────

export async function fetchCourseFiles(
  ses: Electron.Session,
  courseId: number
): Promise<CanvasFileItem[]> {
  const items = await canvasFetchAll<Record<string, unknown>>(
    ses,
    `/courses/${courseId}/files?per_page=100`
  )
  return items.map(f => ({
    fileId: Number(f.id),
    displayName: (f.display_name as string) || (f.filename as string) || `file_${f.id}`,
    filename: (f.filename as string) || `file_${f.id}`,
    url: (f.url as string) || '',
    size: Number(f.size || 0),
    folderId: f.folder_id != null ? Number(f.folder_id) : null,
    locked: Boolean(f.locked || f.hidden || f.locked_for_user)
  }))
}

/** 获取单个文件的元数据（含签名 URL）
 *  [Bug 35 Fix] 不再静默吞掉异常，让调用方看到真实错误原因（如 401 鉴权过期）。
 *  返回 folderId 供补漏文件落盘到真实 Canvas 文件夹（不再用哨兵目录）。 */
export async function fetchFileMeta(
  ses: Electron.Session,
  fileId: number
): Promise<{ url: string; displayName: string; size: number; folderId: number | null } | null> {
  const f = await canvasFetch<Record<string, unknown>>(ses, `/files/${fileId}`)
  return {
    url: (f.url as string) || '',
    displayName: (f.display_name as string) || (f.filename as string) || `file_${fileId}`,
    size: Number(f.size || 0),
    folderId: f.folder_id != null ? Number(f.folder_id) : null
  }
}

// ─── Modules ─────────────────────────────────────────────────

export async function fetchCourseModules(
  ses: Electron.Session,
  courseId: number
): Promise<CanvasModule[]> {
  // Step 1: 拉模块列表（不含 items），快速拿到所有模块 id/name。
  // 不能用 include[]=items——Canvas 平台在某些模块上会截断或返回空 items。
  const mods = await canvasFetchAll<Record<string, unknown>>(
    ses,
    `/courses/${courseId}/modules?per_page=100`
  )

  // Step 2: 并发 5 逐模块拉 items（canvasFetchAll 自动翻页，不会截断）。
  // 与 Page body / File meta 批量获取保持相同并发度。
  const CONCURRENCY = 5
  const mapItem = (i: Record<string, unknown>) => ({
    type: (i.type as string) || '',
    contentId: i.content_id != null ? Number(i.content_id) : null,
    title: (i.title as string) || '',
    pageUrl: (i.page_url as string) || null,
    id: i.id != null ? Number(i.id) : null,
    externalUrl: (i.external_url as string) || null
  })

  const results: CanvasModule[] = []
  for (let i = 0; i < mods.length; i += CONCURRENCY) {
    const batch = mods.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(
      batch.map(async m => {
        const moduleId = Number(m.id)
        const items = await canvasFetchAll<Record<string, unknown>>(
          ses,
          `/courses/${courseId}/modules/${moduleId}/items?per_page=100`
        )
        return {
          id: moduleId,
          name: (m.name as string) || `module_${moduleId}`,
          items: items.map(mapItem)
        }
      })
    )
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(r.value)
      else console.warn('[canvas] fetchCourseModules: 模块 items 拉取失败', r.reason)
    }
  }
  return results
}

// ─── Syllabus ────────────────────────────────────────────────

export async function fetchSyllabusBody(
  ses: Electron.Session,
  courseId: number
): Promise<string> {
  const data = await canvasFetch<Record<string, unknown>>(
    ses,
    `/courses/${courseId}?include[]=syllabus_body`
  )
  return (data.syllabus_body as string) || ''
}

/** 从 HTML 中提取 Canvas 文件链接的 file_id */
export function extractCanvasFileIds(html: string): number[] {
  const re = /\/(?:api\/v1\/)?(?:courses\/\d+\/)?files\/(\d+)/g
  const ids: number[] = []
  const seen = new Set<number>()
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const id = Number(m[1])
    if (!seen.has(id)) { seen.add(id); ids.push(id) }
  }
  return ids
}

// ─── Course Tabs ─────────────────────────────────────────────

export async function fetchCourseTabs(
  ses: Electron.Session,
  courseId: number
): Promise<Array<{ label: string; htmlUrl: string }>> {
  const items = await canvasFetchAll<Record<string, unknown>>(
    ses,
    `/courses/${courseId}/tabs?per_page=100`
  )
  return items.map(t => ({
    label: (t.label as string) || '',
    htmlUrl: (t.html_url as string) || ''
  }))
}

// ─── Pages (for module video iframe scan) ────────────────────

export async function fetchPageBody(
  ses: Electron.Session,
  courseId: number,
  pageUrl: string
): Promise<string> {
  const data = await canvasFetch<Record<string, unknown>>(
    ses,
    `/courses/${courseId}/pages/${pageUrl}`
  )
  return (data.body as string) || ''
}

const VIDEO_DOMAINS = ['v.sjtu.edu.cn', 'tv.sjtu.edu.cn', 'live.sjtu.edu.cn']

/** 从 HTML 中提取嵌入的 v.sjtu / tv.sjtu iframe URL */
export function extractVideoIframes(html: string): string[] {
  // 匹配 <iframe|video|embed 的 src 或 data-src
  const re = /<(?:iframe|video|embed)[^>]+(?:src|data-src)=["']([^"']+)["']/gi
  const urls: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const src = m[1]
    if (VIDEO_DOMAINS.some(d => src.includes(d)) && !seen.has(src)) {
      seen.add(src)
      urls.push(src)
    }
  }
  return urls
}

/** 从 HTML 的 <a href> 中提取 vshare.sjtu.edu.cn 视频链接的 UUID。
 *  某些课程的 Page body 用 <a href="vshare.../play/{uuid}"> 而非 <iframe> 嵌入视频。 */
export function extractVshareLinks(html: string): string[] {
  const re = /href=["'][^"']*vshare\.sjtu\.edu\.cn\/play\/([a-f0-9-]+)/gi
  const uuids: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); uuids.push(m[1]) }
  }
  return uuids
}

/** 列出课程所有 Module Page 的 (module_name, page_title, page_url) */
export async function listModulePages(
  ses: Electron.Session,
  courseId: number
): Promise<Array<{ moduleName: string; pageTitle: string; pageUrl: string }>> {
  const modules = await fetchCourseModules(ses, courseId)
  const out: Array<{ moduleName: string; pageTitle: string; pageUrl: string }> = []
  for (const m of modules) {
    for (const item of m.items) {
      if (item.type === 'Page' && item.pageUrl) {
        out.push({
          moduleName: m.name,
          pageTitle: item.title || item.pageUrl,
          pageUrl: item.pageUrl
        })
      }
    }
  }
  return out
}
