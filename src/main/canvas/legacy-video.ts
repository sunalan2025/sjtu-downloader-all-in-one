import type Electron from 'electron'
import { CANVAS_BASE_URL, type CanvasVideoSession } from '../../shared/types'
import { safeFetch } from './safe-fetch'
import { extractLectureNum } from './video-tokens'

// ─── LTI Mutex ───────────────────────────────────────────────

let legacyLtiMutex: Promise<unknown> = Promise.resolve()

function withLegacyLtiLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = legacyLtiMutex.then(fn, fn)
  legacyLtiMutex = next.catch(() => {})
  return next
}

export class LegacyLtiError extends Error {}

// ─── Legacy LTI Form 解析与 Token 提取 ────────────────────────

/**
 * 从 Canvas Tab 页面 HTML 中解析带预签名 OAuth 1.0 参数的 #tool_form 表单。
 */
export function parseLtiForm(html: string): { action: string; params: URLSearchParams } | null {
  if (!html) return null
  const formMatch = html.match(/<form\b[^>]*?(?:id=["']tool_form["']|action=["'][^"']*courses\.sjtu\.edu\.cn[^"']*)[^>]*>([\s\S]*?)<\/form>/i)
  if (!formMatch) return null

  const formTag = formMatch[0].slice(0, formMatch[0].indexOf('>') + 1)
  const actionMatch = formTag.match(/action=["']([^"']+)["']/i)
  if (!actionMatch) return null
  const action = actionMatch[1]

  const formBody = formMatch[1]
  const params = new URLSearchParams()
  const inputRegex = /<input\b[^>]*?>/gi
  let m: RegExpExecArray | null
  while ((m = inputRegex.exec(formBody)) !== null) {
    const inputTag = m[0]
    const nameMatch = inputTag.match(/name=(["'])(.*?)\1/i)
    if (!nameMatch) continue
    const name = nameMatch[2]
    const valMatch = inputTag.match(/value=(["'])(.*?)\1/i)
    const value = valMatch ? valMatch[2] : ''
    const entityMap: Record<string, string> = {
      '&quot;': '"',
      '&#39;': "'",
      '&lt;': '<',
      '&gt;': '>',
      '&amp;': '&'
    }
    const decodedVal = value.replace(/&(?:quot|#39|lt|gt|amp);/g, (match) => entityMap[match] || match)
    params.append(name, decodedVal)
  }

  return { action, params }
}

/**
 * 从 Canvas 旧版录播 Tab 中提取 `canvasCourseId`（加密串）。
 * 纯 HTTP 管道流程：
 * 1. safeFetch(ses, fullUrl) 获取 Canvas 外部工具页面 HTML；
 * 2. parseLtiForm 提取带 34 个预签名 OAuth 1.0 参数的 #tool_form 表单；
 * 3. safeFetch(ses, form.action, { method: 'POST', body: params.toString() }) 发起 LTI 启动；
 * 4. 从 302 重定向 URL 或响应内容中正则提取 canvasCourseId 并返回。
 * 耗时约 50-150ms，彻底消除后台 BrowserWindow 句柄占用与 iframe 跨域阻塞。
 */
export async function extractLegacyLtiToken(
  ses: Electron.Session,
  tabHtmlUrl: string,
  timeoutMs = 15000
): Promise<{ canvasCourseId: string } | null> {
  return withLegacyLtiLock(() => doExtractLegacyLtiToken(ses, tabHtmlUrl, timeoutMs))
}

async function doExtractLegacyLtiToken(
  ses: Electron.Session,
  tabHtmlUrl: string,
  timeoutMs = 15000
): Promise<{ canvasCourseId: string } | null> {
  const fullUrl = tabHtmlUrl.startsWith('http')
    ? tabHtmlUrl
    : `${CANVAS_BASE_URL}${tabHtmlUrl}`

  console.log('[legacy-lti] 请求 Canvas Tab 页面:', fullUrl)

  const startTime = Date.now()
  try {
    // 1. 获取 Tab 页面 HTML
    const pageResp = await safeFetch(ses, fullUrl, undefined, 2, timeoutMs)
    if (!pageResp.ok) {
      console.warn(`[legacy-lti] 获取 Tab 页面失败: HTTP ${pageResp.status}`)
      return null
    }
    const html = await pageResp.text()

    // 2. 解析表单
    const parsed = parseLtiForm(html)
    if (!parsed || !parsed.action) {
      console.warn('[legacy-lti] 页面未包含有效的 #tool_form 表单')
      return null
    }

    // 3. POST 提交表单至 LTI 启动地址 (courses.sjtu.edu.cn/lti/launch)
    const ltiResp = await safeFetch(
      ses,
      parsed.action,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': fullUrl,
          'Origin': CANVAS_BASE_URL
        },
        body: parsed.params.toString()
      },
      2,
      timeoutMs
    )

    // 4. 提取 canvasCourseId
    let capturedId: string | null = null

    // 优先从最终 URL 提取 (跟随 302 重定向后的 URL)
    if (ltiResp.url) {
      const mUrl = ltiResp.url.match(/[?&#]canvasCourseId=([^&#]+)/)
      if (mUrl && mUrl[1]) {
        capturedId = mUrl[1]
      }
    }

    // 若未自动跟随重定向，从 Location 响应头中提取
    if (!capturedId) {
      const loc = ltiResp.headers.get('location') || ''
      const mLoc = loc.match(/[?&#]canvasCourseId=([^&#]+)/)
      if (mLoc && mLoc[1]) {
        capturedId = mLoc[1]
      }
    }

    // 若 URL 未保留 query，从返回的 HTML 页面内联脚本中提取 (var canvasCourseId="...")
    if (!capturedId) {
      const text = await ltiResp.text()
      const mScript = text.match(/canvasCourseId\s*=\s*["']([^"']+)["']/)
      if (mScript && mScript[1]) {
        capturedId = mScript[1]
      }
    }

    if (capturedId) {
      console.log(`[legacy-lti] 纯 HTTP 管道凭据提取成功 (耗时 ${Date.now() - startTime}ms):`, capturedId.slice(0, 16) + '...')
      return { canvasCourseId: capturedId }
    }

    console.warn('[legacy-lti] 响应未包含 canvasCourseId 凭据')
    return null
  } catch (err) {
    console.warn('[legacy-lti] 提取异常:', err instanceof Error ? err.message : String(err))
    return null
  }
}

// ─── Legacy 列表拉取 ──────────────────────────────────────────

/**
 * 拉取旧版录播系统讲次列表。
 * 调用 POST `https://courses.sjtu.edu.cn/lti/vodVideo/findVodVideoList`，
 * 并将 `body.list` 归一化转换为 `CanvasVideoSession[]`。
 * 未安排录播返回空数组；网络和鉴权错误交给扫描器单独报告。
 */
export async function fetchLegacyVodVideoList(
  ses: Electron.Session,
  encCourseId: string
): Promise<CanvasVideoSession[]> {
  try {
    const form = new URLSearchParams()
    form.append('pageIndex', '1')
    form.append('pageSize', '1000')
    const rawParam = encCourseId.includes('%') ? encCourseId : encodeURIComponent(encCourseId)
    form.append('canvasCourseId', rawParam)

    const resp = await safeFetch(
      ses,
      'https://courses.sjtu.edu.cn/lti/vodVideo/findVodVideoList',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://courses.sjtu.edu.cn/',
          'Accept': 'application/json, text/plain, */*'
        },
        body: form.toString()
      }
    )

    if (!resp.ok) {
      throw new Error(`旧版录播列表请求失败 (HTTP ${resp.status})`)
    }

    const data = (await resp.json()) as Record<string, unknown>
    // 遇到 非云录播教室 或 code: 400 或非正常返回时优雅返回空数组
    if (
      data.code === 400 ||
      data.code === '400' ||
      String(data.msg || data.message || '').includes('非云录播教室')
    ) {
      console.log('[legacy-video] 无录播记录或为非云录播教室')
      return []
    }

    const bodyObj = (data.body ?? data.data ?? data) as Record<string, unknown>
    const list = (bodyObj?.list ?? (Array.isArray(bodyObj) ? bodyObj : [])) as Array<Record<string, unknown>>

    if (!Array.isArray(list) || list.length === 0) {
      return []
    }

    const sessions: CanvasVideoSession[] = list.map((r, idx) => {
      const videoId = String(r.videoId ?? r.id ?? idx + 1)
      const courId = Number(r.courId ?? r.id ?? 0)
      const teacher = String(r.userName ?? r.teacher ?? '未知教师')
      const classroom = String(r.classroomName ?? r.classroom ?? '未知教室')
      const beginTime = String(r.courseBeginTime ?? r.beginTime ?? '')
      const endTime = String(r.courseEndTime ?? r.endTime ?? '')
      const videoName = String(r.videoName ?? `第${idx + 1}讲`)

      return {
        videoId,
        courId,
        teacher,
        classroom,
        beginTime,
        endTime,
        videoName,
        legacyCourseId: encCourseId,
        source: 'legacy'
      }
    })

    sessions.sort((a, b) => {
      const na = extractLectureNum(a.videoName)
      const nb = extractLectureNum(b.videoName)
      if (na > 0 && nb > 0 && na !== nb) return na - nb
      return (a.beginTime || '').localeCompare(b.beginTime || '')
    })

    return sessions
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : '旧版录播列表读取失败')
  }
}

// ─── Legacy 多流直链解析 ───────────────────────────────────────

/**
 * 解析旧版录播单讲的多路视频流 MP4 直链。
 * 调用 POST `https://courses.sjtu.edu.cn/lti/vodVideo/getVodVideoInfos`，
 * 将 `cdviViewNum === 0` 映射为 `teacherUrl`（教师视角），
 * 将 `cdviViewNum === 3` 映射为 `pptUrl`（PPT视角）。
 */
export async function fetchLegacyVodStreamUrls(
  ses: Electron.Session,
  videoId: string
): Promise<{ teacherUrl?: string; pptUrl?: string }> {
  try {
    const form = new URLSearchParams()
    form.append('playTypeHls', 'true')
    form.append('id', videoId)
    form.append('isAudit', 'true')

    const resp = await safeFetch(
      ses,
      'https://courses.sjtu.edu.cn/lti/vodVideo/getVodVideoInfos',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://courses.sjtu.edu.cn/',
          'Accept': 'application/json, text/plain, */*'
        },
        body: form.toString()
      }
    )

    if (!resp.ok) {
      throw new Error(`旧版录播播放地址请求失败 (HTTP ${resp.status})`)
    }

    const data = (await resp.json()) as Record<string, unknown>
    const info = (data.body ?? data.data ?? data) as Record<string, unknown>
    const streams = (
      info?.videoPlayResponseVoList ??
      data?.videoPlayResponseVoList ??
      []
    ) as Array<Record<string, unknown>>

    let teacherUrl: string | undefined
    let pptUrl: string | undefined

    for (const s of streams) {
      const viewNum = Number(s.cdviViewNum ?? s.viewNum ?? s.channelNum)
      const url = String(s.url ?? s.rtmpUrlHdv ?? s.playUrl ?? s.videoUrl ?? '').trim()
      if (!url) continue

      if (viewNum === 0) {
        teacherUrl = url
      } else if (viewNum === 3) {
        pptUrl = url
      }
    }

    if (!teacherUrl && !pptUrl) throw new Error('旧版录播没有可用的视频流，可能尚未开放点播')
    return { teacherUrl, pptUrl }
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : '旧版录播播放地址读取失败')
  }
}
