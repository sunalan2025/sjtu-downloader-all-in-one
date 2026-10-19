import { BrowserWindow } from 'electron'
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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// ─── Legacy LTI Token 提取 ────────────────────────────────────

/**
 * 从 Canvas 旧版录播 Tab 中提取 `canvasCourseId`（加密串）。
 * 流程：通过后台隐藏 BrowserWindow 加载 Tab 页面，自动提交 `#tool_form` 至 `https://courses.sjtu.edu.cn/lti/launch`，
 * 毫秒级捕获重定向 URL 中的 `canvasCourseId` 参数，随后销毁窗口并返回。
 */
export async function extractLegacyLtiToken(
  ses: Electron.Session,
  tabHtmlUrl: string,
  timeoutMs = 8000
): Promise<{ canvasCourseId: string } | null> {
  return withLegacyLtiLock(() => doExtractLegacyLtiToken(ses, tabHtmlUrl, timeoutMs))
}

async function doExtractLegacyLtiToken(
  ses: Electron.Session,
  tabHtmlUrl: string,
  timeoutMs = 8000
): Promise<{ canvasCourseId: string } | null> {
  const fullUrl = tabHtmlUrl.startsWith('http')
    ? tabHtmlUrl
    : `${CANVAS_BASE_URL}${tabHtmlUrl}`

  console.log('[legacy-lti] 打开 Canvas tab:', fullUrl)
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
  win.webContents?.setAudioMuted?.(true)

  let capturedCourseId: string | null = null

  const checkUrl = (url: string) => {
    if (!url || capturedCourseId) return
    const m = url.match(/[?&#]canvasCourseId=([^&#]+)/)
    if (m && m[1]) {
      try {
        capturedCourseId = decodeURIComponent(m[1])
      } catch {
        capturedCourseId = m[1]
      }
    }
  }

  // 监听所有跳转与导航事件，一旦 URL 出现 canvasCourseId 立即捕获
  win.webContents.on?.('will-redirect', (_e, url) => checkUrl(url))
  win.webContents.on?.('did-redirect-navigation', (_e, url) => checkUrl(url))
  win.webContents.on?.('did-navigate', (_e, url) => checkUrl(url))
  win.webContents.on?.('did-frame-navigate', (_e, url) => checkUrl(url))
  win.webContents.on?.('will-navigate', (_e, url) => checkUrl(url))

  const startTime = Date.now()
  try {
    await win.loadURL(fullUrl).catch(err => {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('ERR_ABORTED')) {
        console.log('[legacy-lti] loadURL 信息:', msg)
      }
    })

    // 检查初始 URL 是否已包含 canvasCourseId
    checkUrl(win.webContents.getURL())

    // 尝试提交 #tool_form（如果页面未自动提交）
    if (!capturedCourseId) {
      try {
        await win.webContents.executeJavaScript(`
          (() => {
            const form = document.querySelector('#tool_form') || document.querySelector('form[action*="courses.sjtu.edu.cn"]');
            if (form) {
              form.target = '';
              form.submit();
              return true;
            }
            return false;
          })()
        `)
      } catch {
        // frame not ready
      }
    }

    // 轮询检查 URL（通常 500ms~1000ms 命中）
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline && !capturedCourseId) {
      if (win.isDestroyed?.() || win.webContents.isDestroyed?.()) break
      checkUrl(win.webContents.getURL())
      if (capturedCourseId) break

      await sleep(150)
    }

    if (capturedCourseId) {
      console.log(`[legacy-lti] canvasCourseId 捕获成功: ${capturedCourseId} (耗时 ${Date.now() - startTime}ms)`)
      return { canvasCourseId: capturedCourseId }
    }

    console.log(`[legacy-lti] 超时：未捕获到 canvasCourseId (耗时 ${Date.now() - startTime}ms)`)
    return null
  } catch (err) {
    console.log('[legacy-lti] 异常:', err)
    return null
  } finally {
    if (!win.isDestroyed?.()) {
      win.destroy()
    }
  }
}

// ─── Legacy 列表拉取 ──────────────────────────────────────────

/**
 * 拉取旧版录播系统讲次列表。
 * 调用 POST `https://courses.sjtu.edu.cn/lti/vodVideo/findVodVideoList`，
 * 并将 `body.list` 归一化转换为 `CanvasVideoSession[]`。
 * 遇非云录播教室或错误时优雅返回空数组。
 */
export async function fetchLegacyVodVideoList(
  ses: Electron.Session,
  encCourseId: string
): Promise<CanvasVideoSession[]> {
  try {
    const form = new URLSearchParams()
    form.append('pageIndex', '1')
    form.append('pageSize', '1000')
    form.append('canvasCourseId', encCourseId)

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
      console.warn(`[legacy-video] findVodVideoList HTTP ${resp.status}`)
      return []
    }

    const data = (await resp.json()) as Record<string, unknown>
    // 遇到 非云录播教室 或 code: 400 或非正常返回时优雅返回空数组
    if (
      data.code === 400 ||
      data.code === '400' ||
      String(data.msg || data.message || '').includes('非云录播教室')
    ) {
      console.log(`[legacy-video] 课程 ${encCourseId} 无录播记录或为非云录播教室`)
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
    console.warn('[legacy-video] fetchLegacyVodVideoList 异常:', err)
    return []
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
      console.warn(`[legacy-video] getVodVideoInfos HTTP ${resp.status}`)
      return {}
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

    return { teacherUrl, pptUrl }
  } catch (err) {
    console.warn('[legacy-video] fetchLegacyVodStreamUrls 异常:', err)
    return {}
  }
}
