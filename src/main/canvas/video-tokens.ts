/**
 * "课堂视频new" LTI Token 提取 + vod API 调用
 *
 * 对应 Python class_video.py 的 LTI 启动 / token 提取 / API 调用部分。
 * 使用 Electron hidden BrowserWindow 替代 Playwright。
 */
import { BrowserWindow } from 'electron'
import type Electron from 'electron'
import {
  CANVAS_BASE_URL,
  VSJTU_CANVAS_BASE,
  type CanvasClassVideoInfo,
  type CanvasVideoSession
} from '../../shared/types'
import { safeFetch } from './safe-fetch'
import { sanitizeFsName } from './api'

const VSJTU_REFERER = 'https://v.sjtu.edu.cn/'

// ─── LTI Token 提取 ──────────────────────────────────────────

/** 从 Canvas 课程的 "课堂视频new" tab 中提取 LTI token + canvasCourseId。
 *  流程：打开 tab URL → 等待 v.sjtu iframe 加载 → 从 sessionStorage 取 Canvas_UserState */
export async function extractLtiToken(
  ses: Electron.Session,
  tabHtmlUrl: string
): Promise<{ token: string; canvasCourseId: string } | null> {
  const fullUrl = tabHtmlUrl.startsWith('http')
    ? tabHtmlUrl
    : `${CANVAS_BASE_URL}${tabHtmlUrl}`

  console.log('[lti] 打开 Canvas tab:', fullUrl)
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true }
  })
  // 静音：隐藏窗口加载的页面可能含自动播放的音视频
  win.webContents.setAudioMuted(true)

  try {
    await win.loadURL(fullUrl)

    // PERF: 轮询检查 v.sjtu 重定向（替代固定 sleep(3000)），典型情况 ~500ms 即完成
    const redirectDeadline = Date.now() + 3000
    let realUrl = ''
    while (Date.now() < redirectDeadline) {
      try {
        realUrl = await win.webContents.executeJavaScript('location.href') as string
        if (realUrl.includes('v.sjtu.edu.cn')) break
      } catch { /* frame not ready */ }
      await sleep(300)
    }

    // 情况 1：LTI 整页重定向到 v.sjtu.edu.cn
    if (realUrl.includes('v.sjtu.edu.cn')) {
      console.log('[lti] 检测到 v.sjtu 重定向，直接读取 sessionStorage')
      const mainFrame = win.webContents.mainFrame
      if (mainFrame) {
        const state = await waitForUserState(mainFrame, 20_000)
        if (state?.token) {
          const accessParams = state.accessParams as Record<string, unknown> | undefined
          const canvasCourseId = String(accessParams?.courId || '')
          console.log('[lti] Token 提取成功')
          return { token: String(state.token), canvasCourseId }
        }
      }
      console.log('[lti] sessionStorage 中未找到 token')
      return null
    }

    // 情况 2：iframe 嵌套模式（备用）
    const frame = await waitForVsjtuFrame(win, 50_000)
    if (!frame) {
      console.log('[lti] 超时：未找到 v.sjtu iframe')
      return null
    }
    console.log('[lti] 找到 v.sjtu iframe')

    // 轮询 sessionStorage.Canvas_UserState（最多 20s）
    const state = await waitForUserState(frame, 20_000)
    if (!state?.token) {
      console.log('[lti] sessionStorage 中未找到 token')
      return null
    }

    const accessParams = state.accessParams as Record<string, unknown> | undefined
    const canvasCourseId = String(accessParams?.courId || '')
    console.log('[lti] Token 提取成功')
    return { token: String(state.token), canvasCourseId }
  } catch (err) {
    console.log('[lti] 异常:', err)
    return null
  } finally {
    win.destroy()
  }
}

/** 等待 webContents 中出现 v.sjtu.edu.cn 的 frame */
async function waitForVsjtuFrame(
  win: BrowserWindow,
  timeoutMs: number
): Promise<Electron.WebFrameMain | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const frames = win.webContents.mainFrame?.frames ?? []
    for (const f of frames) {
      if (f.url.includes('v.sjtu.edu.cn') && f.url.includes('jy-application')) {
        return f
      }
    }
    for (const f of frames) {
      try {
        for (const child of f.frames) {
          if (child.url.includes('v.sjtu.edu.cn') && child.url.includes('jy-application')) {
            return child
          }
        }
      } catch { /* cross-origin */ }
    }
    await sleep(500)
  }
  return null
}

/** 轮询 frame 的 sessionStorage.Canvas_UserState */
async function waitForUserState(
  frame: Electron.WebFrameMain,
  timeoutMs: number
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const state = await frame.executeJavaScript(
        "JSON.parse(sessionStorage.getItem('Canvas_UserState') || '{}')"
      ) as Record<string, unknown> | null
      if (state && typeof state === 'object' && state.token) {
        return state
      }
    } catch { /* frame may not be ready */ }
    await sleep(500)
  }
  return null
}

// ─── Vod API 调用 ─────────────────────────────────────────────

/** 获取课程所有录课场次列表 */
export async function fetchVodVideoList(
  ses: Electron.Session,
  token: string,
  canvasCourseId: string
): Promise<CanvasVideoSession[]> {
  // SPA 对 courId 做 encodeURIComponent，服务端要求编码
  const enc = encodeURIComponent(canvasCourseId)
  const resp = await safeFetch(ses,
    `${VSJTU_CANVAS_BASE}/directOnDemandPlay/findVodVideoList`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        token,
        Referer: VSJTU_REFERER
      },
      body: JSON.stringify({ canvasCourseId: enc })
    }
  )
  const data = await resp.json() as Record<string, unknown>
  if (data.code !== '0') {
    throw new Error(`findVodVideoList code=${data.code}: ${data.message}`)
  }
  const rootData = (data.data || {}) as Record<string, unknown>
  const records = (rootData.records as Array<Record<string, unknown>>) || []
  // 按 videoName 中的讲次编号排序，每条记录 = 1 讲（内含教师+PPT 两路流）
  // 例："课程名(第1讲)" "课程名(第2讲)" 各自独立，getVodVideoInfos 可取两路
  const sorted = records
    .filter(r => r.videoId)
    .sort((a, b) => {
      const na = extractLectureNum(String(a.videoName || ''))
      const nb = extractLectureNum(String(b.videoName || ''))
      if (na !== nb) return na - nb
      return String(a.courseBeginTime || '').localeCompare(String(b.courseBeginTime || ''))
    })

  return sorted
    .map(r => ({
      videoId: String(r.videoId || ''),
      courId: Number(r.courId || 0),
      teacher: String(r.userName || '未知教师'),
      classroom: String(r.classroomName || '未知地点'),
      beginTime: String(r.courseBeginTime || ''),
      videoName: String(r.videoName || '')
    }))
}

/** 获取单个视频的多路流信息（教师 + PPT）。
 *  统一规则：每个 videoId 一定有 2 路流（教师 + PPT）。
 *  区分方式：channelNum 不同 → 按 channelNum 去重；channelNum 相同 → 按 URL 设备 ID 去重。 */
async function fetchVodVideoInfos(
  ses: Electron.Session,
  token: string,
  videoId: string
): Promise<CanvasClassVideoInfo[]> {
  const form = new URLSearchParams()
  form.append('playTypeHls', 'true')
  form.append('isAudit', 'true')
  form.append('id', videoId)

  const resp = await safeFetch(ses,
    `${VSJTU_CANVAS_BASE}/directOnDemandPlay/getVodVideoInfos`,
    {
      method: 'POST',
      headers: {
        token,
        Referer: VSJTU_REFERER
      },
      body: form
    }
  )
  const data = await resp.json() as Record<string, unknown>
  if (data.code !== '0') {
    throw new Error(`getVodVideoInfos code=${data.code}: ${data.message}`)
  }
  const info = (data.data || {}) as Record<string, unknown>
  const streams = (info.videoPlayResponseVoList as Array<Record<string, unknown>>) || []

  // [PPT Fix] getVodVideoInfos 返回的 data.courId（数值型）即 PPT 切片 API 需要的 ivsVideoId。
  // 它与 findVodVideoList record 里的 courId 不同（后者是另一套加密串），也与 videoId（加密串）不同。
  // 经浏览器真实链路验证：query-ppt-slice-es?ivsVideoId={courId数值} 才能拿到切片，传 videoId 会 500。
  // 这里解析流直链时顺手缓存 (token, videoId) → courId，供 PPT 下载复用，避免重复请求。
  const courIdNum = Number(info.courId)
  if (Number.isFinite(courIdNum) && courIdNum > 0) {
    ivsVideoIdCache.set(`${token}::${videoId}`, { ts: Date.now(), ivsVideoId: courIdNum })
    if (ivsVideoIdCache.size > VOD_CACHE_MAX_SIZE) {
      const oldest = ivsVideoIdCache.keys().next().value
      if (oldest) ivsVideoIdCache.delete(oldest)
    }
  }

  const valid = streams.filter(v => v.rtmpUrlHdv)
  if (valid.length === 0) return []

  // 提取 URL 路径中的设备 ID（第 6 段），用于 channelNum 相同时区分
  const getDeviceId = (url: string): string => {
    try { return url.split('/')[5] || '' } catch { return '' }
  }

  // 按 channelNum 是否有差异选择去重键
  const channelNums = new Set(valid.map(v => Number(v.cdviChannelNum)))
  const useChannelNum = channelNums.size > 1

  const seen = new Set<string>()
  const result: CanvasClassVideoInfo[] = []
  for (const v of valid) {
    const key = useChannelNum
      ? String(v.cdviChannelNum)
      : getDeviceId(String(v.rtmpUrlHdv))
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push({
      channelNum: Number(v.cdviChannelNum),
      url: String(v.rtmpUrlHdv),
      label: '' // 由调用方根据返回顺序标注：第0=教师，第1=PPT
    })
  }
  return result
}

// ─── 进程级 videoId→channels 缓存（懒解析去重） ───────────────
//
// 同一讲的教师路 + PPT 路共享同一 videoId，下载前各自 resolveDirectUrl 时
// 若都打 fetchVodVideoInfos 会重复请求。缓存让同一 videoId 在 TTL 内只解析一次，
// 第二次直接取对应 streamIdx 的 channel。TTL 短（5 分钟）避免 token 过期后用到陈旧结果。

const vodChannelsCache = new Map<string, { ts: number; channels: CanvasClassVideoInfo[] }>()
const VOD_CACHE_TTL = 5 * 60 * 1000
// PERF: bound cache size to prevent unbounded memory growth for large course catalogs.
// Evict oldest entry (Map insertion order) when limit is exceeded.
const VOD_CACHE_MAX_SIZE = 500

/** 带缓存的 fetchVodVideoInfos：同 (token, videoId) 在 TTL 内复用解析结果。
 *  [Bug Fix] 缓存键含 token：LTI token 中途刷新后（如 401 重扫），旧 token 关联的
 *  频道结果不会被新 token 命中，避免用过期鉴权拿到的陈旧流地址。原先只按 videoId
 *  键，TTL 5min 内 token 换了仍可能返回旧 token 解析出的频道。 */
export async function getVodChannelsCached(
  ses: Electron.Session,
  token: string,
  videoId: string
): Promise<CanvasClassVideoInfo[]> {
  const cacheKey = `${token}::${videoId}`
  const hit = vodChannelsCache.get(cacheKey)
  if (hit && Date.now() - hit.ts < VOD_CACHE_TTL) return hit.channels
  const channels = await fetchVodVideoInfos(ses, token, videoId)
  vodChannelsCache.set(cacheKey, { ts: Date.now(), channels })
  // PERF: evict oldest entry when cache exceeds max size
  if (vodChannelsCache.size > VOD_CACHE_MAX_SIZE) {
    const oldest = vodChannelsCache.keys().next().value
    if (oldest) vodChannelsCache.delete(oldest)
  }
  return channels
}

/** 清空缓存（退出时调用，释放内存、丢弃可能过期的 token 关联结果） */
export function clearVodChannelsCache(): void {
  vodChannelsCache.clear()
  ivsVideoIdCache.clear()
}

// ─── PPT 课件 ivsVideoId 缓存 ────────────────────────────────
//
// query-ppt-slice-es API 需要的 ivsVideoId 是 getVodVideoInfos 返回的 data.courId（数值型），
// 不是 findVodVideoList 的 videoId（加密串）。fetchVodVideoInfos 解析流直链时已把
// (token, videoId) → courId 缓存到这里；PPT 下载先查缓存，未命中再调 getVodVideoInfos 现取。
const ivsVideoIdCache = new Map<string, { ts: number; ivsVideoId: number }>()

/** 解析 PPT API 需要的 ivsVideoId（= getVodVideoInfos 的 data.courId 数值）。
 *  命中缓存直接返回；未命中则调一次 getVodVideoInfos（其内部会回填缓存）。
 *  返回 null 表示该讲无可用 vod 信息（如视频未发布/无流）。 */
export async function resolveIvsVideoId(
  ses: Electron.Session,
  token: string,
  videoId: string
): Promise<number | null> {
  const cacheKey = `${token}::${videoId}`
  const hit = ivsVideoIdCache.get(cacheKey)
  if (hit && Date.now() - hit.ts < VOD_CACHE_TTL) return hit.ivsVideoId
  // 未命中：调 getVodVideoInfos 现取（会顺带回填缓存 + 流直链缓存）
  const channels = await getVodChannelsCached(ses, token, videoId)
  const after = ivsVideoIdCache.get(cacheKey)
  if (after) return after.ivsVideoId
  // channels 为空也可能没回填（视频无流），此时无 ivsVideoId 可用
  if (channels.length === 0) return null
  return null
}

// ─── 频道标签映射 ────────────────────────────────────────────

const STREAM_LABELS: Record<number, string> = { 0: '教师', 1: 'PPT' }

/** 构建课堂视频文件名。
 *  streamIndex: 该 videoId 内的第几路流（0=教师，1=PPT），由 getVodVideoInfos 返回顺序决定。 */
export function buildClassVideoFileName(
  courseName: string,
  session: CanvasVideoSession,
  streamIndex: number
): string {
  // "2025-09-16 08:00:00" → "2025-09-16_08-00"
  let t = session.beginTime.replace(/:/g, '-').replace(' ', '_')
  const parts = t.split('-')
  if (parts.length >= 5) t = parts.slice(0, 4).join('-') // 去掉秒
  const label = STREAM_LABELS[streamIndex] || `路${streamIndex + 1}`
  return sanitizeFileName(`${t}-${session.teacher}-${session.classroom}-${label}`)
}

function sanitizeFileName(name: string): string {
  return sanitizeFsName(name) + '.mp4'
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/** 从 videoName 中提取讲次编号，例如 "课程名(第1讲)" → 1 */
export function extractLectureNum(name: string): number {
  const m = name.match(/第(\d+)讲/)
  return m ? Number(m[1]) : 0
}

// ─── ExternalTool 模块视频：LTI 跳转 + /file/{id} → S3 直链 MP4 ─────
//
// 部分课程的模块视频是 ExternalTool 类型，external_url 指向
// v.sjtu.edu.cn/jy-application-canvas-sjtu-ui/#/playerPage/index?fileId=XXX。
// 真实链路（已验证）：
//   1. Canvas 模块项页 /courses/{cid}/modules/items/{itemId} 有隐藏 POST 表单
//      action=v.sjtu/oidc/login_initiations，带 LTI 签名 + target_link_uri(含fileId)
//   2. 提交表单 → v.sjtu 验签 → 跳 #/playerPage/index?tokenId=XXX
//   3. getAccessTokenByTokenId?tokenId=XXX → data.token (JWT, 24h, 课程级)
//   4. GET /file/{fileId} 带 token 头 → data.vodUrl = S3 预签名 MP4 (Range)
//
// 关键：token 是课程级的，任选一个 ExternalTool 模块项跳转即可服务全课所有 fileId。
// 每门课只需 1 次 LTI 跳转，缓存 24h。

const EXTTOOL_TOKEN_TTL = 23 * 60 * 60 * 1000 // 23h（略小于服务端 24h，留安全余量）
const extToolTokenCache = new Map<number, { token: string; expAt: number }>()

/** 清空 ExternalTool token 缓存（退出/登出时调用） */
export function clearExtToolTokenCache(): void {
  extToolTokenCache.clear()
}

/** 取课程级 ExternalTool token：命中缓存直接返回，否则用 moduleItemId 做 LTI 跳转。
 *  moduleItemId 仅用于首次 LTI 跳转，跳转后 token 服务全课所有 fileId。 */
export async function getExtToolToken(
  ses: Electron.Session,
  courseId: number,
  moduleItemId: number
): Promise<string> {
  const hit = extToolTokenCache.get(courseId)
  if (hit && Date.now() < hit.expAt) return hit.token

  const tokenId = await launchExtToolLti(ses, courseId, moduleItemId)
  const token = await getExtToolAccessToken(ses, tokenId)
  extToolTokenCache.set(courseId, { token, expAt: Date.now() + EXTTOOL_TOKEN_TTL })
  console.log(`[canvas:exttool] 课程 ${courseId} LTI token 已缓存（24h）`)
  return token
}

/** 拉取 v.sjtu ExternalTool 视频的 S3 直链 + 元数据。
 *  token 失效（返回登录无效）时清缓存让调用方重试。 */
export async function fetchExtToolVodUrl(
  ses: Electron.Session,
  courseId: number,
  fileId: string,
  token: string
): Promise<{ url: string; fileName: string; fileSize: number }> {
  const resp = await safeFetch(ses, `${VSJTU_CANVAS_BASE}/file/${fileId}`, {
    headers: { token, Accept: 'application/json' }
  })
  const data = await resp.json() as { code: string; message: string | null; data?: { vodUrl?: string; fileName?: string; fileSize?: number } }
  if (data.code !== '0' || !data.data?.vodUrl) {
    // token 过期：清缓存让下次重新 LTI 跳转
    if (data.message && /登录信息无效|未登录|过期|无效的token|token已失效/i.test(data.message)) {
      extToolTokenCache.delete(courseId)
      console.log(`[canvas:exttool] 课程 ${courseId} token 失效，已清缓存`)
    }
    throw new Error(`v.sjtu /file/${fileId} 失败: ${data.message || data.code}`)
  }
  return {
    url: data.data.vodUrl,
    fileName: data.data.fileName || `exttool_${fileId}.mp4`,
    fileSize: Number(data.data.fileSize || 0)
  }
}

/** LTI 跳转：loadURL Canvas 模块项页 → 提交隐藏表单 → 捕获跳转 URL 里的 tokenId。
 *  表单 target=_blank，改为本窗口提交后页面会跳到 v.sjtu，URL 含 tokenId=XXX。 */
async function launchExtToolLti(
  ses: Electron.Session,
  courseId: number,
  moduleItemId: number
): Promise<string> {
  const url = `${CANVAS_BASE_URL}/courses/${courseId}/modules/items/${moduleItemId}`
  console.log(`[canvas:exttool] LTI 跳转: ${url}`)
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 700,
    webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true }
  })
  win.webContents.setAudioMuted(true)

  try {
    await win.loadURL(url)
    // 等表单渲染（10 秒超时，防页面异常时 Promise 永不 resolve）
    await win.webContents.executeJavaScript(
      `new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000
        const check = () => {
          const f = document.querySelector('#tool_form')
          if (f) { resolve(true); return }
          if (Date.now() > deadline) { reject(new Error('tool_form 未出现（超时 10s）')); return }
          setTimeout(check, 200)
        }
        check()
      })`
    )
    // 改 target 为本窗口并提交（原 target=_blank 会开新窗口）
    await win.webContents.executeJavaScript(
      `(() => { const f = document.querySelector('#tool_form'); f.target = ''; f.submit(); })()`
    )
    // 等 v.sjtu 跳转完成，从 URL hash 提取 tokenId
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const cur = win.webContents.getURL()
      const m = cur.match(/tokenId=([^&]+)/)
      if (m) return decodeURIComponent(m[1])
      await sleep(300)
    }
    throw new Error('LTI 跳转超时，未捕获到 tokenId')
  } finally {
    win.destroy()
  }
}

/** 用 tokenId 换 access token（JWT，课程级） */
async function getExtToolAccessToken(ses: Electron.Session, tokenId: string): Promise<string> {
  const resp = await safeFetch(ses, `${VSJTU_CANVAS_BASE}/lti3/getAccessTokenByTokenId?tokenId=${encodeURIComponent(tokenId)}`, {
    headers: { Accept: 'application/json' }
  })
  const data = await resp.json() as { code: string; message: string | null; data?: { token?: string } }
  if (data.code !== '0' || !data.data?.token) {
    throw new Error(`getAccessTokenByTokenId 失败: ${data.message || data.code}`)
  }
  return data.data.token
}

// ─── ExternalUrl 模块视频：vshare → S3 直链 MP4 ──────────────────

const VSHARE_BASE = 'https://vshare.sjtu.edu.cn'

/** 拉取 vshare 视频 S3 直链：GET /api/video/play/{uuid}（带 vshare cookie）。
 *  vshare 通过 jAccount SSO 登录，ses 已有 cookie。 */
export async function fetchVsharePlayUrl(
  ses: Electron.Session,
  uuid: string
): Promise<{ url: string; fileName: string; fileSize: number }> {
  const resp = await safeFetch(ses, `${VSHARE_BASE}/api/video/play/${uuid}?locale=zh`, {
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
  })
  const data = await resp.json() as { errno: number; error: string; entities?: Array<{ playUrl?: string; title?: string; fileSize?: number; type?: string }> }
  const e = data.entities?.[0]
  const playUrl = e?.playUrl
  if (data.errno !== 0 || !playUrl) {
    throw new Error(`vshare /play/${uuid} 失败: ${data.error || data.errno}`)
  }
  const ext = e?.type || 'mp4'
  return {
    url: playUrl,
    fileName: `${e?.title || uuid}.${ext}`,
    fileSize: Number(e?.fileSize || 0)
  }
}
