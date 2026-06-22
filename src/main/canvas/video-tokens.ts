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
  // 例："大学物理(第1讲)" "大学物理(第2讲)" 各自独立，getVodVideoInfos 可取两路
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

/** 从 videoName 中提取讲次编号，例如 "大学物理(第1讲)" → 1 */
export function extractLectureNum(name: string): number {
  const m = name.match(/第(\d+)讲/)
  return m ? Number(m[1]) : 0
}
