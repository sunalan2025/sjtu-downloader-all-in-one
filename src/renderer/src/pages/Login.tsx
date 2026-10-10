import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/app'
import { SJTU_PARTITION, VSJTU_JWT_LS_KEY } from '@shared/types'
import { Spinner } from '../components/Spinner'

/**
 * 直接加载上海交通大学统一身份认证 OAuth2 授权入口
 * 避免经由 v.sjtu 中转单页应用导致的超时与路由事件误触发
 */
const JACCOUNT_AUTH_URL =
  'https://jaccount.sjtu.edu.cn/oauth2/authorize?response_type=code&scope=openid&client_id=pmZTZ9QZEAwXGLGheU99&redirect_uri=https%3A%2F%2Fv.sjtu.edu.cn%2F%23%2Flogin'

/**
 * 统一样式优化：
 * 1. 破除小屏隐藏二维码的规则，确保二维码始终可见；
 * 2. 隐藏不必要的外部顶栏与页脚版权，保留核心卡片；
 * 3. 完整保留二维码扫码、账号密码登录、短信验证以及二次验证（2FA）表单与控件。
 */
const JACCOUNT_EMBED_CSS = `
  /* 破除移动端响应式隐藏，确保二维码始终可以被渲染 */
  .login-qr,
  #qr-mask,
  #qr-img {
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
  }

  /* 隐藏页眉与页尾多余的版权信息与背景图，专注登录卡片主体 */
  header,
  footer,
  .header,
  .footer,
  .copyright,
  .login-bg,
  .bg-img {
    display: none !important;
  }

  html, body {
    background: transparent !important;
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    height: 100% !important;
    overflow-y: auto !important;
    overflow-x: hidden !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif !important;
  }

  .login-card,
  .login-box {
    box-shadow: none !important;
    border: none !important;
    margin: 0 auto !important;
    background: transparent !important;
    width: 100% !important;
    max-width: 580px !important;
  }

  /* 确保账号密码、短信验证以及二次验证 (2FA) 表单全部可见可交互 */
  #passwordForm,
  #smsForm,
  .form-login,
  #second-auth-form,
  #login-app-wait {
    visibility: visible !important;
    opacity: 1 !important;
  }
`

type WebviewElement = HTMLElement & {
  src: string
  partition: string
  loadURL: (url: string) => Promise<void>
  getURL: () => string
  reload: () => void
  insertCSS: (css: string) => Promise<string>
  executeJavaScript: (script: string) => Promise<unknown>
  addEventListener(type: string, listener: (e: Event) => void): void
  removeEventListener(type: string, listener: (e: Event) => void): void
}

const ALLOWED_NAV_DOMAINS = ['sjtu.edu.cn', 'sjtu.cn']

function isAllowedNavDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return ALLOWED_NAV_DOMAINS.some(d => host === d || host.endsWith('.' + d))
  } catch {
    return false
  }
}

/** 准确判定是否属于已成功通过 jAccount 认证的回调或进入主页 */
function isLoginSuccessUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.searchParams.has('code') || u.hash.includes('code=')) return true
    if (u.hash.includes('/home') || u.hash.includes('/index') || u.hash.includes('/dashboard')) return true
    if (u.pathname.includes('/home') || u.pathname.includes('/index') || u.pathname.includes('/dashboard')) return true
    return false
  } catch {
    return url.includes('code=') || url.includes('/home')
  }
}

export function Login() {
  const webviewRef = useRef<WebviewElement | null>(null)
  const isFinishingRef = useRef(false)
  const setStage = useAppStore(s => s.setStage)
  const setAuth = useAppStore(s => s.setAuth)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState('正在加载交大统一身份认证…')

  const checkAuth = useCallback(async (force = false): Promise<boolean> => {
    try {
      const a = await window.api.auth.status(force)
      setAuth(a)
      return a.loggedIn
    } catch {
      return false
    }
  }, [setAuth])

  const pullJwt = useCallback(async (): Promise<string | null> => {
    const wv = webviewRef.current
    if (!wv) return null
    try {
      const t = (await wv.executeJavaScript(
        `localStorage.getItem(${JSON.stringify(VSJTU_JWT_LS_KEY)})`
      )) as string | null
      if (t && t.length > 20) {
        await window.api.auth.setJwtToken(t)
        return t
      }
    } catch {
      /* ignore */
    }
    return null
  }, [])

  const handleLoginCompletion = useCallback(async (): Promise<void> => {
    let attempts = 0
    const maxAttempts = 30 // 30 * 400ms = 12s
    while (attempts++ < maxAttempts) {
      // 1. 尝试从 webview 抽取 JWT
      await pullJwt()

      // 2. 强制校验主进程认证状态
      try {
        const a = await window.api.auth.status(true)
        if (a.loggedIn) {
          setAuth(a)
          try {
            const cloudToken = await window.api.cloudpan.getCachedToken()
            if (cloudToken) {
              useAppStore.getState().setCloudUserToken(cloudToken)
            }
          } catch {
            /* ignore */
          }
          setStage('browser')
          return
        }
      } catch {
        /* ignore */
      }

      await new Promise(r => setTimeout(r, 400))
    }

    // 兜底进入（部分业务页面 cookie 已就绪但 JWT 写入慢）
    const a = await checkAuth()
    if (a) {
      setStage('browser')
      return
    }

    isFinishingRef.current = false
    setReady(true)
    setError('会话同步耗时较长，请点击下方「刷新」重试')
    setStatusMsg('登录同步超时')
  }, [checkAuth, pullJwt, setAuth, setStage])

  // 初始挂载时预检：若已有登录态直接切入主界面
  useEffect(() => {
    void (async () => {
      if (await checkAuth()) setStage('browser')
    })()
  }, [checkAuth, setStage])

  // 定时后台守卫：监听登录回调或 JWT 写入
  useEffect(() => {
    const id = setInterval(() => {
      void (async () => {
        if (isFinishingRef.current) return
        const wv = webviewRef.current
        if (wv) {
          try {
            const url = wv.getURL()
            if (isLoginSuccessUrl(url)) {
              isFinishingRef.current = true
              setReady(false)
              setStatusMsg('登录成功，正在进入主页…')
              void handleLoginCompletion()
              return
            }
          } catch {
            /* ignore */
          }
        }

        const token = await pullJwt()
        if (token) {
          const a = await checkAuth(true)
          if (a) {
            setStage('browser')
            return
          }
        }
      })()
    }, 1500)
    return () => clearInterval(id)
  }, [checkAuth, handleLoginCompletion, pullJwt, setStage])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return

    const onDomReady = (): void => {
      const url = wv.getURL()
      if (isLoginSuccessUrl(url)) {
        if (!isFinishingRef.current) {
          isFinishingRef.current = true
          setReady(false)
          setStatusMsg('登录成功，正在进入主页…')
          void handleLoginCompletion()
        }
        return
      }

      if (url.includes('jaccount.sjtu.edu.cn')) {
        void wv.insertCSS(JACCOUNT_EMBED_CSS).catch(() => undefined)
        setReady(true)
        setError(null)
        setStatusMsg('请扫码、账号密码或短信验证登录')
      }
    }

    const onNav = (): void => {
      const url = wv.getURL()
      if (!isAllowedNavDomain(url)) {
        console.warn('[Login] blocked navigation to unexpected domain:', url)
        void wv.loadURL(JACCOUNT_AUTH_URL)
        return
      }

      if (url.includes('jaccount.sjtu.edu.cn')) {
        setError(null)
        setStatusMsg('请扫码、账号密码或短信验证登录')
        return
      }

      // 真正登录成功的判定：URL 携带 OAuth code，或到达 home 首页
      if (isLoginSuccessUrl(url) && !isFinishingRef.current) {
        isFinishingRef.current = true
        setReady(false)
        setStatusMsg('登录成功，正在进入主页…')
        void handleLoginCompletion()
      }
    }

    wv.addEventListener('dom-ready', onDomReady)
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)

    return () => {
      wv.removeEventListener('dom-ready', onDomReady)
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
    }
  }, [handleLoginCompletion])

  const onReload = useCallback((): void => {
    isFinishingRef.current = false
    setReady(false)
    setError(null)
    setStatusMsg('正在加载登录界面…')
    webviewRef.current?.loadURL(JACCOUNT_AUTH_URL).catch(() => undefined)
  }, [])

  return (
    <div className="relative flex h-full w-full items-center justify-center px-6 py-8">
      <button
        type="button"
        onClick={() => setStage('welcome')}
        className="no-drag absolute left-6 top-6 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-text-3 transition-all duration-200 hover:bg-surface-3 hover:text-text-1"
      >
        ← 返回
      </button>

      <div className="w-full max-w-2xl transition-all duration-300">
        <header className="mb-6 text-center">
          <h1 className="text-xl font-bold text-text-1">jAccount 统一身份认证</h1>
          <p className="mt-2 text-sm text-text-3">{statusMsg}</p>
        </header>

        <div className="relative rounded-2xl border border-bd bg-surface-1 p-6 shadow-card backdrop-blur">
          <div className="relative h-[470px] w-full overflow-hidden rounded-xl bg-base">
            {!ready && !error && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface-1 backdrop-blur-sm">
                <Spinner size={28} />
                <div className="text-sm text-text-3">
                  {isFinishingRef.current ? '登录成功，正在进入主页…' : '正在加载认证界面…'}
                </div>
              </div>
            )}
            {error && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface-1 px-6 text-center backdrop-blur-sm">
                <div className="text-sm font-medium text-amber">{error}</div>
                <button
                  type="button"
                  onClick={onReload}
                  className="mt-2 rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white transition hover:bg-accent/90"
                >
                  刷新页面
                </button>
              </div>
            )}
            <webview
              ref={webviewRef as unknown as React.RefObject<HTMLElement>}
              src={JACCOUNT_AUTH_URL}
              partition={SJTU_PARTITION}
              style={{
                width: '100%',
                height: '100%',
                background: '#ffffff',
                opacity: ready ? 1 : 0,
                transition: 'opacity 0.2s'
              }}
            />
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-text-3">
            <span>支持「交我办」/微信扫码、账号密码、短信验证及二次验证</span>
            <button
              type="button"
              onClick={onReload}
              className="inline-flex items-center gap-1 text-text-3 transition-colors duration-150 hover:text-accent-light"
            >
              刷新 ↻
            </button>
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <div className="flex items-start gap-2.5 rounded-xl bg-surface-3 px-4 py-3">
            <span className="mt-0.5 text-sm">💡</span>
            <p className="text-xs leading-relaxed text-text-3">
              打开「<strong className="text-text-2">交我办</strong>」App 或微信，扫描左侧二维码即可完成扫码登录；亦可在右侧直接使用账号密码登录。
            </p>
          </div>
          <div className="flex items-start gap-2.5 rounded-xl border border-amber/20 bg-amber/5 px-4 py-3">
            <svg
              className="mt-0.5 h-4 w-4 shrink-0 text-amber"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p className="text-xs leading-relaxed text-amber">
              请确保已连接 <strong>SJTU 校园网</strong>或<strong>交大 VPN</strong>，否则后续旁听课和内网资源将无法下载。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
