import { BrowserWindow } from 'electron'
import type Electron from 'electron'
import { CANVAS_BASE_URL } from '../../shared/types'

let ses: Electron.Session | null = null

export function setCanvasSession(session: Electron.Session): void {
  ses = session
}

export function getSession(): Electron.Session {
  if (!ses) throw new Error('Canvas session not initialized')
  return ses
}

/** SSO 是否已成功过（避免每次 API 调用都重新走 SSO） */
let _canvasSsoDone = false

/** SSO in-flight Promise：并发扫描多课程 / 下载时各调用方共用同一次 SSO attempt */
let _canvasLoginPromise: Promise<boolean> | null = null

/** 标记 Canvas 登录态失效（clearSjtuSession / cleanupOnQuit 调用，强制下次重走 SSO） */
export function invalidateCanvasLogin(): void {
  _canvasSsoDone = false
  _canvasLoginPromise = null
}

export async function ensureCanvasLogin(): Promise<boolean> {
  if (_canvasSsoDone) return true
  if (_canvasLoginPromise) return _canvasLoginPromise
  _canvasLoginPromise = (async () => {
    if (_canvasSsoDone) return true
    const session = getSession()

    // 预检：若无有效 jAccount 会话，跳过静默 SSO，绝不弹出可见窗口打扰用户
    const jaCookies = await session.cookies.get({ domain: 'jaccount.sjtu.edu.cn' }).catch(() => [])
    const hasJaSession = jaCookies.some(c => c.name !== 'JATrustCookie')
    if (!hasJaSession) {
      console.log('[canvas] 无有效 jAccount 会话，跳过静默 SSO')
      return false
    }

    // 直接走 OIDC SSO：jAccount 有 cookies 时 ~1s 自动完成（隐藏窗口）
    console.log('[canvas] 触发 OIDC SSO（隐藏窗口）…')
    const ok = await completeOidcSso(session, false)
    if (ok) {
      _canvasSsoDone = true
      return true
    }
    console.log('[canvas] 静默 SSO 失败，会话可能已失效')
    return false
  })()
  try {
    return await _canvasLoginPromise
  } finally {
    if (!_canvasSsoDone) _canvasLoginPromise = null
  }
}

/** 通过 BrowserWindow 完成 Canvas OIDC SSO 流程（复用 jAccount session，隐藏窗口静默完成） */
export async function completeOidcSso(session: Electron.Session, show: boolean): Promise<boolean> {
  const win = new BrowserWindow({
    show,
    width: 800,
    height: 600,
    webPreferences: { session, nodeIntegration: false, contextIsolation: true }
  })

  try {
    const ssoUrl = `${CANVAS_BASE_URL}/login/openid_connect`
    console.log('[canvas] 加载 SSO URL:', ssoUrl)
    await win.loadURL(ssoUrl)

    const timeoutMs = show ? 120_000 : 15_000
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500))
      const url = win.webContents.getURL()

      // 若检测到重定向至 jAccount 登录或扫码页，说明全局会话已过期，立即退出
      if (url.includes('jaccount.sjtu.edu.cn/jaccount/jalogin') || url.includes('/qrcode')) {
        console.log('[canvas] SSO 重定向至 jAccount 登录页，会话已过期')
        return false
      }

      // SSO 成功标志：URL 包含 login_success 或回到 Canvas 主域
      if (isCanvasDashboardUrl(url)) {
        console.log('[canvas] SSO 完成:', url.slice(0, 100))
        await new Promise(r => setTimeout(r, 500))
        return true
      }
    }
    console.log('[canvas] SSO 超时，最后 URL:', win.webContents.getURL().slice(0, 120))
    return false
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!msg.includes('ERR_FAILED (-2)')) {
      console.log('[canvas] SSO 异常:', e)
    }
    return false
  } finally {
    if (!win.isDestroyed()) {
      win.destroy()
    }
  }
}

/** 判断 URL 是否是 Canvas 主页面（非登录页、非 jAccount 页） */
export function isCanvasDashboardUrl(url: string): boolean {
  if (!url) return false
  const lower = url.toLowerCase()
  if (!lower.startsWith(CANVAS_BASE_URL.toLowerCase())) return false
  if (lower.includes('jaccount')) return false
  const path = lower.slice(CANVAS_BASE_URL.length).split('?')[0]
  if (path.startsWith('/login')) return false
  if (path.startsWith('/saml')) return false
  return true
}
