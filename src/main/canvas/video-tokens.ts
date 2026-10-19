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

// ─── LTI Tab 匹配器 ──────────────────────────────────────────

const LTI_TAB_KEYWORDS = ['课堂视频', '课堂录像', '在线课堂', 'class video']

/** 判断 Canvas tab 标签是否为课堂视频工具 tab（大小写不敏感） */
export function isClassVideoTab(label: string): boolean {
  if (!label) return false
  const lower = label.toLowerCase()
  return LTI_TAB_KEYWORDS.some(kw => lower.includes(kw))
}

/** 判断 Canvas tab 是否为旧版课堂录播 (courses.sjtu.edu.cn / Tool 18717) */
export function isLegacyClassVideoTab(label: string, htmlUrl?: string): boolean {
  const normLabel = (label || '').toLowerCase()
  const normUrl = (htmlUrl || '').toLowerCase()
  if (normUrl.includes('18717') || normUrl.includes('courses.sjtu.edu.cn')) return true
  if (normLabel.includes('旧版') && isClassVideoTab(normLabel)) return true
  return false
}

/** 判断 Canvas tab 是否为新版课堂录播 (v.sjtu.edu.cn / Tool 8329 / 通用) */
export function isNewClassVideoTab(label: string, htmlUrl?: string): boolean {
  if (isLegacyClassVideoTab(label, htmlUrl)) return false
  const normLabel = (label || '').toLowerCase()
  const normUrl = (htmlUrl || '').toLowerCase()
  if (normUrl.includes('8329') || normUrl.includes('v.sjtu.edu.cn')) return true
  if (normLabel.includes('新版') && isClassVideoTab(normLabel)) return true
  return isClassVideoTab(normLabel)
}

/** 归一化授课开始时间戳 (YYYY-MM-DD HH:mm) */
export function normalizeLectureBeginTime(t: string | undefined): string {
  if (!t) return ''
  const clean = t.trim().replace(/\//g, '-')
  const m = clean.match(/^(\d{4}-\d{1,2}-\d{1,2})[T\s](\d{1,2}:\d{1,2})/)
  if (m) {
    const d = m[1].split('-').map(p => p.padStart(2, '0')).join('-')
    const time = m[2].split(':').map(p => p.padStart(2, '0')).join(':')
    return `${d} ${time}`
  }
  const mDate = clean.match(/^(\d{4}-\d{1,2}-\d{1,2})/)
  if (mDate) {
    return mDate[1].split('-').map(p => p.padStart(2, '0')).join('-')
  }
  return clean
}

/** 提取归一化授课日期 (YYYY-MM-DD) */
export function extractLectureDate(t: string | undefined): string {
  if (!t) return ''
  const clean = t.trim().replace(/\//g, '-')
  const m = clean.match(/^(\d{4}-\d{1,2}-\d{1,2})/)
  if (m) {
    return m[1].split('-').map(p => p.padStart(2, '0')).join('-')
  }
  return ''
}

/** 判断两个 Session 是否代表同一堂课 */
export function isSameLectureSession(a: CanvasVideoSession, b: CanvasVideoSession): boolean {
  const normTimeA = normalizeLectureBeginTime(a.beginTime)
  const normTimeB = normalizeLectureBeginTime(b.beginTime)
  if (normTimeA && normTimeB && normTimeA === normTimeB) {
    return true
  }

  const numA = extractLectureNum(a.videoName)
  const numB = extractLectureNum(b.videoName)
  if (numA > 0 && numB > 0 && numA === numB) {
    const dateA = extractLectureDate(a.beginTime)
    const dateB = extractLectureDate(b.beginTime)
    if (!dateA || !dateB || dateA === dateB) {
      return true
    }
  }

  return false
}

/**
 * 双轨录播讲次并集融合与去重引擎。
 * - 以授课时间戳 beginTime 与讲次序号 lectureNum 对齐去重；
 * - 两边皆有时：优先保留新版元数据，保留旧版 legacyCourseId 及缺失教师信息；
 * - 一边独有时：完整并入，消灭任何讲次缺失；
 * - 结果按讲次编号与开始时间稳定排序。
 */
export function mergeAndDeduplicateLectures(
  newSessions: CanvasVideoSession[],
  legacySessions: CanvasVideoSession[]
): CanvasVideoSession[] {
  const merged: CanvasVideoSession[] = []
  const usedLegacyIndices = new Set<number>()

  for (const n of newSessions) {
    let matchedLegacyIdx = -1
    for (let i = 0; i < legacySessions.length; i++) {
      if (usedLegacyIndices.has(i)) continue
      if (isSameLectureSession(n, legacySessions[i])) {
        matchedLegacyIdx = i
        break
      }
    }

    if (matchedLegacyIdx >= 0) {
      usedLegacyIndices.add(matchedLegacyIdx)
      const leg = legacySessions[matchedLegacyIdx]
      merged.push({
        ...leg,
        ...n,
        legacyCourseId: n.legacyCourseId || leg.legacyCourseId,
        teacher: (n.teacher && n.teacher !== '未知教师') ? n.teacher : (leg.teacher || n.teacher),
        classroom: (n.classroom && n.classroom !== '未知教室') ? n.classroom : (leg.classroom || n.classroom),
        source: n.source || 'new'
      })
    } else {
      merged.push({
        ...n,
        source: n.source || 'new'
      })
    }
  }

  for (let i = 0; i < legacySessions.length; i++) {
    if (usedLegacyIndices.has(i)) continue
    const leg = legacySessions[i]
    merged.push({
      ...leg,
      source: leg.source || 'legacy'
    })
  }

  merged.sort((a, b) => {
    const na = extractLectureNum(a.videoName)
    const nb = extractLectureNum(b.videoName)
    if (na > 0 && nb > 0 && na !== nb) return na - nb
    if (na > 0 && nb === 0) return -1
    if (na === 0 && nb > 0) return 1
    return (a.beginTime || '').localeCompare(b.beginTime || '')
  })

  return merged
}

// ─── LTI Token 提取 ──────────────────────────────────────────

/** 全局 LTI 提取互斥锁：确保同一时间仅有 1 个提取窗口运行，彻底避免句柄和资源堆叠 */
let ltiScanMutex: Promise<unknown> = Promise.resolve()

function withLtiLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = ltiScanMutex.then(fn, fn)
  ltiScanMutex = next.catch(() => {})
  return next
}

/** 从 Canvas 课程的 "课堂视频new" tab 中提取 LTI token + canvasCourseId。
 *  流程：互斥窗口打开 tab URL → 毫秒级拦截 302 重定向里的 jwt_token → 立即销毁窗口返回 */
export async function extractLtiToken(
  ses: Electron.Session,
  tabHtmlUrl: string
): Promise<{ token: string; canvasCourseId: string } | null> {
  return withLtiLock(() => doExtractLtiToken(ses, tabHtmlUrl))
}

async function doExtractLtiToken(
  ses: Electron.Session,
  tabHtmlUrl: string
): Promise<{ token: string; canvasCourseId: string } | null> {
  const fullUrl = tabHtmlUrl.startsWith('http')
    ? tabHtmlUrl
    : `${CANVAS_BASE_URL}${tabHtmlUrl}`

  const mCourse = tabHtmlUrl.match(/\/courses\/(\d+)/)
  const canvasCourseId = mCourse ? mCourse[1] : ''

  console.log('[lti] 打开 Canvas tab:', fullUrl)
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 700,
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })
  // 静音：隐藏窗口加载的页面可能含自动播放的音视频
  win.webContents.setAudioMuted(true)

  let capturedToken: string | null = null

  const checkUrl = (url: string) => {
    if (!url || capturedToken) return
    const m = url.match(/[?&#]jwt_token=([^&#]+)/)
    if (m && m[1]) {
      try {
        capturedToken = decodeURIComponent(m[1])
      } catch {
        capturedToken = m[1]
      }
    }
  }

  // 监听所有跳转与导航事件，一旦 URL 出现 jwt_token 毫秒级捕获
  win.webContents.on('will-redirect', (_e, url) => checkUrl(url))
  win.webContents.on('did-redirect-navigation', (_e, url) => checkUrl(url))
  win.webContents.on('did-navigate', (_e, url) => checkUrl(url))
  win.webContents.on('did-frame-navigate', (_e, url) => checkUrl(url))

  const startTime = Date.now()
  try {
    await win.loadURL(fullUrl).catch(err => {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('ERR_ABORTED')) {
        console.log('[lti] loadURL 信息:', msg)
      }
    })

    // 快速轮询检查 URL 或 storage（最多 8 秒，通常 500ms~1000ms 即命中）
    const deadline = Date.now() + 8000
    while (Date.now() < deadline && !capturedToken) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) break
      checkUrl(win.webContents.getURL())
      if (capturedToken) break

      try {
        const token = await win.webContents.executeJavaScript(`
          (() => {
            try {
              return sessionStorage.getItem('jy-application-resourcemanage-ui_STORAGE_KEY_JWT_TOKEN') ||
                     JSON.parse(sessionStorage.getItem('Canvas_UserState') || '{}').token ||
                     null;
            } catch { return null; }
          })()
        `)
        if (token) {
          capturedToken = String(token)
          break
        }
      } catch { /* frame not ready */ }

      await sleep(150)
    }

    if (capturedToken) {
      console.log(`[lti] Token 提取成功 (耗时 ${Date.now() - startTime}ms)`)
      return { token: capturedToken, canvasCourseId }
    }

    // 备用兼容：旧系统 iframe 查找（超时缩减至 4 秒）
    const frame = await waitForVsjtuFrame(win, 4000)
    if (frame) {
      const state = await waitForUserState(frame, 4000)
      if (state?.token) {
        const accessParams = state.accessParams as Record<string, unknown> | undefined
        const courId = String(accessParams?.courId || canvasCourseId)
        return { token: String(state.token), canvasCourseId: courId }
      }
    }

    console.log(`[lti] 超时：未捕获到 token (耗时 ${Date.now() - startTime}ms)`)
    return null
  } catch (err) {
    console.log('[lti] 异常:', err)
    return null
  } finally {
    if (!win.isDestroyed()) {
      win.destroy()
    }
  }
}

/** 等待 webContents 中出现 v.sjtu.edu.cn 的 frame */
async function waitForVsjtuFrame(
  win: BrowserWindow,
  timeoutMs: number
): Promise<Electron.WebFrameMain | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return null
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

/** 判断是否为 LTI 1.3 JWT Token（3段 base64 结构，且以 eyJ 开头） */
export function isJwtToken(token: string): boolean {
  return typeof token === 'string' && token.startsWith('eyJ') && token.split('.').length === 3
}

/** 获取课程所有录课场次列表（适配全新 jy-application-resourcemanage 系统并向下兼容旧系统） */
export async function fetchVodVideoList(
  ses: Electron.Session,
  token: string,
  canvasCourseId: string
): Promise<CanvasVideoSession[]> {
  // 1. 若为全新 LTI 1.3 JWT Token，调用全新 jy-application-resourcemanage API (GET /lms/launch-context + /v1/subject_vod_list_new)
  if (isJwtToken(token)) {
    try {
    const contextResp = await safeFetch(ses,
      'https://v.sjtu.edu.cn/jy-application-resourcemanage/lms/launch-context',
      {
        headers: {
          'jwt-token': token,
          token,
          Referer: VSJTU_REFERER,
          Accept: 'application/json'
        }
      }
    )
    if (contextResp.ok) {
      const cData = await contextResp.json() as Record<string, unknown>
      // 课程未录课 / 未排课：接口直接返回 LMS_TEACHING_CLASS_NOT_FOUND 或 ok: false
      if (cData.code === 'LMS_TEACHING_CLASS_NOT_FOUND' || cData.ok === false) {
        console.log(`[canvas] 课程 ${canvasCourseId} 未安排直录播 (${cData.message || 'LMS_TEACHING_CLASS_NOT_FOUND'})`)
        return []
      }
      const dataObj = (cData.data || {}) as Record<string, unknown>
      const canvasRecord = (dataObj.canvasRecord || {}) as Record<string, unknown>
      const courseObj = (dataObj.course || {}) as Record<string, unknown>
      const teachingClassId = canvasRecord.teachingClassId || courseObj.teachingClassId
      if (teachingClassId) {
        console.log(`[canvas] 获取到 teachingClassId: ${teachingClassId}，拉取录播讲次列表…`)
        const vodListUrl = `https://v.sjtu.edu.cn/jy-application-resourcemanage/v1/subject_vod_list_new?page.pageIndex=1&page.pageSize=1000&teclIds=${teachingClassId}&page.orders[0].asc=false&page.orders[0].field=courBeginTime&schoolOpenStatusFlag=false`
        const listResp = await safeFetch(ses, vodListUrl, {
          headers: {
            'jwt-token': token,
            token,
            Referer: VSJTU_REFERER,
            Accept: 'application/json'
          }
        })
        if (listResp.ok) {
          const listData = await listResp.json() as Record<string, unknown>
          const innerData = (listData.data || {}) as Record<string, unknown>
          const records = (innerData.records as Array<Record<string, unknown>>) || []
          console.log(`[canvas] subject_vod_list_new 获取到 ${records.length} 条记录`)
          const mapped: CanvasVideoSession[] = records.map((r, idx) => {
            const id = String(r.id || idx + 1)
            const teacNames = Array.isArray(r.teacNames) ? r.teacNames.join('/') : String(r.userName || '未知教师')
            const subjName = String(r.subjName || '')
            const weekStr = r.weekNumber ? `第${r.weekNumber}周` : ''
            const beginTime = String(r.courBeginTime || '')
            return {
              videoId: id,
              courId: Number(r.id || 0),
              teacher: teacNames,
              classroom: String(r.clroName || '未知地点'),
              beginTime,
              videoName: [subjName, weekStr, beginTime ? `(${beginTime})` : ''].filter(Boolean).join(' ')
            }
          })
          return mapped
        }
      }
    }
  } catch (err) {
    console.log('[canvas] 新版 resourcemanage API 调用异常，尝试旧版回退:', err)
    }
  }

  // 2. 回退：旧版 directOnDemandPlay/findVodVideoList（兼容旧系统及既有单测 mock）
  return fetchVodVideoListLegacy(ses, token, canvasCourseId)
}

/** 旧版 directOnDemandPlay/findVodVideoList 接口回退实现 */
async function fetchVodVideoListLegacy(
  ses: Electron.Session,
  token: string,
  canvasCourseId: string
): Promise<CanvasVideoSession[]> {
  // SPA 对 courId 做 encodeURIComponent，服务端要求编码
  const enc = encodeURIComponent(canvasCourseId)
  let current = 1
  const size = 500
  const allRecords: Array<Record<string, unknown>> = []

  while (true) {
    const resp = await safeFetch(ses,
      `${VSJTU_CANVAS_BASE}/directOnDemandPlay/findVodVideoList`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          token,
          Referer: VSJTU_REFERER
        },
        body: JSON.stringify({
          canvasCourseId: enc,
          current,
          size,
          pageSize: size
        })
      }
    )
    const data = await resp.json() as Record<string, unknown>
    if (data.code !== '0') {
      throw new Error(`findVodVideoList code=${data.code}: ${data.message}`)
    }
    const rootData = (data.data || {}) as Record<string, unknown>
    const records = (rootData.records as Array<Record<string, unknown>>) || []
    allRecords.push(...records)

    const total = Number(rootData.total ?? allRecords.length)
    if (records.length === 0 || allRecords.length >= total || records.length < size) {
      break
    }
    current++
  }

  // 按 videoName 中的讲次编号排序，每条记录 = 1 讲（内含教师+PPT 两路流）
  // 例："课程名(第1讲)" "课程名(第2讲)" 各自独立，getVodVideoInfos 可取两路
  const sorted = allRecords
    .filter(r => r && r.videoId)
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

// ─── 多路视频流识别 ──────────────────────────────────────────

export interface VideoStream {
  channelNum: number
  channelName: string
  url: string
  label: '教师' | 'PPT' | '全景'
}

/** 识别并分类多路视频流（教师 / PPT / 全景），并提供单路流保护逻辑 */
export function identifyVideoStreams(rawStreams: any[]): VideoStream[] {
  if (!rawStreams || !Array.isArray(rawStreams)) return []
  const valid = rawStreams.filter(s => s && (s.rtmpUrlHdv || s.url))
  if (valid.length === 0) return []

  const result: VideoStream[] = []

  for (const s of valid) {
    const channelNum = Number(s.cdviChannelNum ?? s.channelNum ?? 0)
    const name = String(s.channelName || '')
    const url = String(s.rtmpUrlHdv || s.url || '')

    const label: '教师' | 'PPT' | '全景' =
      name.includes('PPT') || name.includes('电脑') || channelNum === 1
        ? 'PPT'
        : name.includes('全景') || channelNum === 2
          ? '全景'
          : '教师'

    result.push({
      channelNum,
      channelName: name,
      url,
      label
    })
  }

  // If only 1 stream exists, do not arbitrarily label as PPT unless explicitly named PPT
  if (result.length === 1 && !result[0].channelName.includes('PPT')) {
    result[0].label = '教师'
  }

  return result
}

/** 获取单个视频的多路流信息（教师 + PPT）。
 *  适配全新 course_vod_urls_new API（直链 MP4）并向下兼容旧系统 getVodVideoInfos */
export async function getVodVideoInfos(
  ses: Electron.Session,
  token: string,
  videoId: string
): Promise<CanvasClassVideoInfo[]> {
  // 1. 若为全新 LTI 1.3 JWT Token，调用全新 resourcemanage/v1/course_vod_urls_new API (获取高清直链 MP4)
  if (isJwtToken(token)) {
    try {
      const newVodUrl = `https://v.sjtu.edu.cn/jy-application-resourcemanage/v1/course_vod_urls_new?courseId=${encodeURIComponent(videoId)}`
    const resp = await safeFetch(ses, newVodUrl, {
      headers: {
        'jwt-token': token,
        token,
        Referer: VSJTU_REFERER,
        Accept: 'application/json'
      }
    })
    if (resp.ok) {
      const data = await resp.json() as Record<string, unknown>
      const inner = (data.data || {}) as Record<string, unknown>
      const views = (inner.courseVodViewList as Array<Record<string, unknown>>) || []
      if (views.length > 0) {
        // 缓存 ivsVideoId 供 PPT 切片使用
        const courIdNum = Number(views[0].courId || videoId)
        if (Number.isFinite(courIdNum) && courIdNum > 0) {
          ivsVideoIdCache.set(`${token}::${videoId}`, { ts: Date.now(), ivsVideoId: courIdNum })
          if (ivsVideoIdCache.size > VOD_CACHE_MAX_SIZE) {
            const oldest = ivsVideoIdCache.keys().next().value
            if (oldest) ivsVideoIdCache.delete(oldest)
          }
        }

        const result: CanvasClassVideoInfo[] = []
        for (const item of views) {
          const viewNum = Number(item.viewNum ?? 1)
          const label = viewNum === 5 ? 'PPT' : (viewNum === 1 ? '教师' : '全景')
          result.push({
            channelNum: viewNum,
            url: String(item.url || ''),
            label
          })
        }
        result.sort((a, b) => {
          if (a.label === '教师' && b.label !== '教师') return -1
          if (b.label === '教师' && a.label !== '教师') return 1
          if (a.label === 'PPT' && b.label !== 'PPT') return -1
          if (b.label === 'PPT' && a.label !== 'PPT') return 1
          return 0
        })
        return result
      }
    }
  } catch (err) {
    console.log('[canvas] 新版 course_vod_urls_new 调用异常，尝试旧版回退:', err)
    }
  }

  // 2. 回退：旧版 directOnDemandPlay/getVodVideoInfos
  return getVodVideoInfosLegacy(ses, token, videoId)
}

/** 旧版 directOnDemandPlay/getVodVideoInfos 回退实现 */
async function getVodVideoInfosLegacy(
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
  const courIdNum = Number(info.courId)
  if (Number.isFinite(courIdNum) && courIdNum > 0) {
    ivsVideoIdCache.set(`${token}::${videoId}`, { ts: Date.now(), ivsVideoId: courIdNum })
    if (ivsVideoIdCache.size > VOD_CACHE_MAX_SIZE) {
      const oldest = ivsVideoIdCache.keys().next().value
      if (oldest) ivsVideoIdCache.delete(oldest)
    }
  }

  const identified = identifyVideoStreams(streams)
  if (identified.length === 0) return []

  // 保证排序稳定：教师排第0位，PPT排第1位
  const sorted = [...identified].sort((a, b) => {
    if (a.label === '教师' && b.label !== '教师') return -1
    if (b.label === '教师' && a.label !== '教师') return 1
    if (a.label === 'PPT' && b.label !== 'PPT') return -1
    if (b.label === 'PPT' && a.label !== 'PPT') return 1
    return 0
  })

  return sorted.map(s => ({
    channelNum: s.channelNum,
    url: s.url,
    label: s.label
  }))
}

export const fetchVodVideoInfos = getVodVideoInfos

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

const CHINESE_NUM_MAP: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '十一': 11, '十二': 12
}

/** 从 videoName 中提取讲次编号，支持多种命名规范：
 *  1. 标准：第X讲 / 第X次课
 *  2. 中文数字：第一讲 ~ 第十二讲
 *  3. 英文：Lecture X / Lec X / Class X
 *  4. 独立首尾数字：01_导论 / 导论_01
 */
export function extractLectureNum(name: string): number {
  if (!name) return 0
  // 1. Standard: 第X讲 / 第X次课
  const m1 = name.match(/第\s*(\d+)\s*[讲次课]/i)
  if (m1) return Number.parseInt(m1[1], 10)

  // 2. Chinese numbers: 第一讲 ~ 第十二讲
  const m2 = name.match(/第\s*([一二三四五六七八九十]+)\s*[讲次课]/)
  if (m2 && CHINESE_NUM_MAP[m2[1]]) return CHINESE_NUM_MAP[m2[1]]

  // 3. English: Lecture X / Lec X / Class X
  const m3 = name.match(/(?:lecture|lec|class)\s*(\d+)/i)
  if (m3) return Number.parseInt(m3[1], 10)

  // 4. Standalone leading or trailing digits: 01_导论 or 导论_01
  const m4 = name.match(/(?:^|[^\d])(\d{1,3})(?:[^\d]|$)/)
  if (m4) return Number.parseInt(m4[1], 10)

  return 0
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

// vshare 登录态（vshare 域 JSESSIONID cookie）是否已建立。
// 与 Canvas/v.sjtu 不同：vshare 后端另发 JSESSIONID，必须访问 vshare 时经 jAccount SSO
// 落盘——persist:sjtu 虽有 jAccount cookie，但从未访问过 vshare 时 vshare 域无 JSESSIONID，
// /api/video/play/{uuid} 直接返回 USER_LOGIN_REQUIRED。首次调用前需 ensureVshareLogin。
let _vshareLoginDone = false

// SSO in-flight Promise：并发下载多个 vshare 视频时，resolveDirectUrl 逐任务调
// ensureVshareLogin，若无去重会同时开 N 个 BrowserWindow 走 SSO（隐藏失败再各弹可见窗
// → 满屏白屏小窗口）。所有并发调用方共用同一次 SSO attempt，结果共享。
let _vshareLoginPromise: Promise<boolean> | null = null

/** 标记 vshare 登录态失效（API 返回 USER_LOGIN_REQUIRED 时调用，强制下次重走 SSO） */
export function invalidateVshareLogin(): void {
  _vshareLoginDone = false
  _vshareLoginPromise = null
}

/** 探测 vshare 会话是否有效：调 /api/user/me/profile，errno:0 视为已登录。
 *  vshare API 用 body.errno 表示成败（HTTP 永远 200）。 */
async function isVshareSessionValid(ses: Electron.Session): Promise<boolean> {
  try {
    const resp = await safeFetch(ses, `${VSHARE_BASE}/api/user/me/profile`, {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    })
    const data = await resp.json() as { errno?: number }
    return data.errno === 0
  } catch {
    return false
  }
}

/** 确保 vshare 已登录：先探现有会话，无效则隐藏窗口走 jAccount SSO。
 *  uuid 用于构造触发 SSO 的 play 页 URL（play 页 JS 检测登录态，未登录跳 jaccount SSO）。
 *  并发去重：所有并发调用方共用同一次 in-flight SSO Promise，避免同时开多个 BrowserWindow。
 *  jAccount cookie 已在 persist:sjtu（用户登录 v.sjtu 时建立），SSO 必能自动完成，无需可见窗。 */
export async function ensureVshareLogin(
  ses: Electron.Session,
  uuid: string
): Promise<boolean> {
  if (_vshareLoginDone) return true
  if (_vshareLoginPromise) return _vshareLoginPromise
  _vshareLoginPromise = (async () => {
    if (_vshareLoginDone) return true
    if (await isVshareSessionValid(ses)) {
      _vshareLoginDone = true
      return true
    }
    console.log('[vshare] 触发 jAccount SSO（隐藏窗口）…')
    if (await completeVshareSso(ses, uuid)) {
      _vshareLoginDone = true
      return true
    }
    const jaCookies = await ses.cookies.get({ domain: 'jaccount.sjtu.edu.cn' })
    const jaSession = jaCookies.some(c => c.name !== 'JATrustCookie')
    console.log(`[vshare] SSO 失败（jaccount 会话${jaSession ? '存在但未落 vshare cookie' : '不存在，请先在应用内登录 v.sjtu'}）`)
    return false
  })()
  try {
    return await _vshareLoginPromise
  } finally {
    // SSO 失败时清空 in-flight，允许下次重试；成功时 _vshareLoginDone 已置 true，
    // 下次调用首行直接返回，不会再走到这里
    if (!_vshareLoginDone) _vshareLoginPromise = null
  }
}

/** 隐藏 BrowserWindow 加载 vshare play 页触发 jAccount SSO，轮询会话生效。
 *  vshare play 页 JS 调 /api/user/me/profile，未登录则跳 jaccount SSO，回跳后落 JSESSIONID。
 *  关 backgroundThrottling：隐藏窗口默认被节流，SSO 重定向链路会被拖慢甚至卡住。
 *  setAudioMuted：play 页含自动播放视频。jAccount cookie 已在 persist:sjtu，SSO 自动完成无需用户交互。 */
async function completeVshareSso(
  ses: Electron.Session,
  uuid: string
): Promise<boolean> {
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 700,
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  win.webContents.setAudioMuted(true)
  try {
    await win.loadURL(`${VSHARE_BASE}/play/${uuid}`).catch(() => { /* SSO 跳转会 reject，忽略 */ })
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      await sleep(1000)
      if (await isVshareSessionValid(ses)) {
        await sleep(500) // 等 cookie 完全落盘
        console.log('[vshare] SSO 完成')
        return true
      }
    }
    return false
  } catch (e) {
    console.log('[vshare] SSO 异常:', e)
    return false
  } finally {
    win.destroy()
  }
}

/** 单次拉取 vshare 视频 S3 直链（不处理登录）。errno:0 返回直链，否则返回 error。 */
async function fetchVsharePlayUrlOnce(
  ses: Electron.Session,
  uuid: string
): Promise<{ ok: boolean; url: string; fileName: string; fileSize: number; error: string }> {
  const resp = await safeFetch(ses, `${VSHARE_BASE}/api/video/play/${uuid}?locale=zh`, {
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
  })
  const data = await resp.json() as { errno: number; error: string; entities?: Array<{ playUrl?: string; title?: string; fileSize?: number; type?: string }> }
  const e = data.entities?.[0]
  const playUrl = e?.playUrl
  if (data.errno === 0 && playUrl) {
    const ext = e?.type || 'mp4'
    return { ok: true, url: playUrl, fileName: `${e?.title || uuid}.${ext}`, fileSize: Number(e?.fileSize || 0), error: '' }
  }
  return { ok: false, url: '', fileName: '', fileSize: 0, error: data.error || String(data.errno) }
}

/** 拉取 vshare 视频 S3 直链：GET /api/video/play/{uuid}（带 vshare JSESSIONID cookie）。
 *  首次 ensureVshareLogin 通过 jAccount SSO 建立 vshare 会话；API 返回 USER_LOGIN_REQUIRED
 *  时 invalidate + 重走 SSO + 重试一次（防 cookie 边界过期自愈）。 */
export async function fetchVsharePlayUrl(
  ses: Electron.Session,
  uuid: string
): Promise<{ url: string; fileName: string; fileSize: number }> {
  await ensureVshareLogin(ses, uuid)
  let r = await fetchVsharePlayUrlOnce(ses, uuid)
  if (r.ok) return { url: r.url, fileName: r.fileName, fileSize: r.fileSize }
  // 登录态失效：清缓存重走 SSO 后重试一次
  if (/USER_LOGIN_REQUIRED|login|未登录|登录/i.test(r.error)) {
    console.log(`[vshare] /play/${uuid} 返回 ${r.error}，重走 SSO 重试`)
    invalidateVshareLogin()
    if (await ensureVshareLogin(ses, uuid)) {
      r = await fetchVsharePlayUrlOnce(ses, uuid)
      if (r.ok) return { url: r.url, fileName: r.fileName, fileSize: r.fileSize }
    }
  }
  throw new Error(`vshare /play/${uuid} 失败: ${r.error}`)
}
