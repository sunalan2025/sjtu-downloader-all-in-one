import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/app'
import { SJTU_PARTITION, V_SJTU_ORIGIN, VSJTU_JWT_LS_KEY } from '@shared/types'
import { Spinner } from '../components/Spinner'

const LOGIN_URL = `${V_SJTU_ORIGIN}/jy-application-resmgr-ui/#/login`

// 在 webview 内反复 poll localStorage 直到 SPA 把 jwt 写进去
const READ_JWT_JS = `
  new Promise(resolve => {
    let tries = 0;
    const tick = () => {
      const t = localStorage.getItem(${JSON.stringify(VSJTU_JWT_LS_KEY)});
      if (t && t.length > 20) return resolve(t);
      if (++tries > 30) return resolve(null);
      setTimeout(tick, 100);
    };
    tick();
  })
`

// 沿 body→#page→#content→.container→.login-layout→#login-form→.login-qr 这条路径，
// 把每一层非通路兄弟全部隐藏；通路本身改成 flex 居中。这样 jaccount 页里任何 logo/footer 都不会漏出来。
const QR_LAYOUT_CSS = `
  html, body { background: transparent !important; margin: 0 !important; padding: 0 !important; height: 100% !important; overflow: hidden !important; }
  body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif !important; }

  html, body, #page, #content, .container, .login-layout, #login-form, .login-card {
    background: transparent !important;
    box-shadow: none !important; border: none !important;
    padding: 0 !important; margin: 0 !important;
    width: 100% !important; min-width: 0 !important; max-width: none !important;
    min-height: 100% !important;
    display: flex !important;
    align-items: center !important; justify-content: center !important;
  }

  body > *:not(#page),
  #page > *:not(#content),
  #content > *:not(.container),
  .container > *:not(.login-layout),
  .login-layout > *:not(#login-form):not(.login-card),
  #login-form > *:not(.login-qr),
  .login-card > *:not(.login-qr) { display: none !important; }

  .login-qr { display: block !important; background: transparent !important; margin: 0 !important; padding: 0 !important; }
  .qr-title, #qr-title { font-size: 14px !important; font-weight: 500 !important; }
  .qr-tips, #qr-msg { font-size: 13px !important; }

  ::-webkit-scrollbar { display: none !important; }
  .toast, .tooltip { display: none !important; }
`

function qrThemeCss(theme: 'dark' | 'light'): string {
  if (theme === 'light') {
    return `
      body { color: #4E5969 !important; }
      .qr-title, #qr-title { color: #4E5969 !important; }
      .qr-tips, #qr-msg { color: #86909C !important; }
      #qr-img { background: white !important; padding: 10px !important; border-radius: 12px !important; box-shadow: 0 4px 24px rgba(0,0,0,0.1) !important; }
    `
  }
  return `
    body { color: #A0A0A0 !important; }
    .qr-title, #qr-title { color: #A0A0A0 !important; }
    .qr-tips, #qr-msg { color: #737373 !important; }
    #qr-img { background: white !important; padding: 10px !important; border-radius: 12px !important; box-shadow: 0 4px 24px rgba(0,0,0,0.2) !important; }
  `
}

// 在 webview 内 poll：等 #qr-img 真的换成 /qrcode?uuid=... 的 URL 且图加载完
const WAIT_FOR_QR_JS = `
  new Promise(resolve => {
    let tries = 0;
    const tick = () => {
      const img = document.getElementById('qr-img');
      const isReal = img && img.complete && img.naturalWidth > 30 && /\\/qrcode\\?/.test(img.src);
      if (isReal) return resolve('ok');
      if (++tries > 40) return resolve('timeout');
      setTimeout(tick, 150);
    };
    tick();
  })
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

// [2.4] Allowed domains for the login webview — prevents navigation to attacker-controlled domains
const ALLOWED_NAV_DOMAINS = ['sjtu.edu.cn', 'jaccount.sjtu.edu.cn', 'oc.sjtu.edu.cn']

function isAllowedNavDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return ALLOWED_NAV_DOMAINS.some(d => host === d || host.endsWith('.' + d))
  } catch {
    return false
  }
}

export function Login() {
  const webviewRef = useRef<WebviewElement | null>(null)
  const setStage = useAppStore(s => s.setStage)
  const setAuth = useAppStore(s => s.setAuth)
  const theme = useAppStore(s => s.theme)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState('正在加载登录页…')

  const checkAuth = useCallback(async (): Promise<boolean> => {
    try {
      const a = await window.api.auth.status()
      setAuth(a)
      return a.loggedIn
    } catch {
      return false
    }
  }, [setAuth])

  /** 从当前 webview 的 localStorage 抽 jwt，推给 main。
   *  登录回跳后 SPA 自己写 LS，所以这一步必须等到 v.sjtu 域 dom-ready 之后才有意义。 */
  const pullJwt = useCallback(async (): Promise<string | null> => {
    const wv = webviewRef.current
    if (!wv) return null
    try {
      const t = (await wv.executeJavaScript(READ_JWT_JS)) as string | null
      if (t && t.length > 20) {
        await window.api.auth.setJwtToken(t)
        return t
      }
    } catch {
      /* ignore */
    }
    return null
  }, [])

  // 一进 Login 就先 check 一遍。已登录直接跳，不让 webview 跑出 v.sjtu 首页
  useEffect(() => {
    void (async () => {
      if (await checkAuth()) setStage('browser')
    })()
  }, [checkAuth, setStage])

  // 兜底轮询：jaccount 回跳的中间域名/重定向链路较杂，nav 事件不一定都能捕到。
  // 只要 cookie 在 v.sjtu 已生效，2.5s 内就能跳出 Login（跳之前先把 jwt 抽出来）。
  useEffect(() => {
    const id = setInterval(() => {
      void (async () => {
        if (await checkAuth()) {
          await pullJwt()
          setStage('browser')
        }
      })()
    }, 2500)
    return () => clearInterval(id)
  }, [checkAuth, pullJwt, setStage])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return

    const onDomReady = (): void => {
      const url = wv.getURL()
      if (!url.includes('jaccount.sjtu.edu.cn')) return
      const resolved = theme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme
      void wv.insertCSS(QR_LAYOUT_CSS + qrThemeCss(resolved)).catch(() => undefined)
      void wv
        .executeJavaScript(WAIT_FOR_QR_JS)
        .then(state => {
          if (state === 'ok') {
            setReady(true)
            setError(null)
            setStatusMsg('请用「交我办」或微信扫码登录')
          } else {
            setError('二维码加载超时，请点击下方刷新重试')
            setStatusMsg('二维码加载失败')
          }
        })
        .catch(() => undefined)
    }

    const onNav = (): void => {
      const url = wv.getURL()
      // [2.4] Block navigation to domains outside the allowed SJTU list
      if (!isAllowedNavDomain(url)) {
        console.warn('[Login] blocked navigation to unexpected domain:', url)
        void wv.loadURL(LOGIN_URL)
        return
      }
      // 一旦离开 jaccount 域立刻藏 webview，避免 v.sjtu 首页/中转页内容闪现。
      // 在跳到 Browser 之前，先把 SPA 写入 localStorage 的 jwt 抽出来推给 main。
      if (!url.includes('jaccount.sjtu.edu.cn')) {
        setReady(false)
        setStatusMsg('登录成功，正在进入…')
        void (async () => {
          await pullJwt()
          if (await checkAuth()) setStage('browser')
        })()
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
  }, [checkAuth, pullJwt, setStage, theme])

  const onReload = (): void => {
    setReady(false)
    setError(null)
    setStatusMsg('正在刷新…')
    webviewRef.current?.loadURL(LOGIN_URL).catch(() => undefined)
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center px-6 py-8">
      <button
        type="button"
        onClick={() => setStage('welcome')}
        className="no-drag absolute left-6 top-6 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-text-3 transition-all duration-200 hover:bg-surface-3 hover:text-text-1"
      >
        ← 返回
      </button>

      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="text-xl font-bold text-text-1">jAccount 登录</h1>
          <p className="mt-2 text-sm text-text-3">{statusMsg}</p>
        </header>

        <div className="relative rounded-2xl border border-bd bg-surface-1 p-6 shadow-card backdrop-blur">
          <div className="relative h-[320px] w-full overflow-hidden rounded-xl bg-base">
            {!ready && !error && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface-1 backdrop-blur-sm">
                <Spinner size={28} />
                <div className="text-sm text-text-3">正在加载二维码…</div>
              </div>
            )}
            {error && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface-1 px-6 text-center backdrop-blur-sm">
                <div className="text-sm font-medium text-amber">{error}</div>
              </div>
            )}
            <webview
              ref={webviewRef as React.RefObject<HTMLElement>}
              src={LOGIN_URL}
              partition={SJTU_PARTITION}
              style={{
                width: '100%',
                height: '100%',
                background: 'transparent',
                opacity: ready ? 1 : 0,
                transition: 'opacity 0.2s'
              }}
            />
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-text-3">
            <span>{ready ? '二维码 60 秒后自动刷新' : ' '}</span>
            <button
              type="button"
              onClick={onReload}
              className="inline-flex items-center gap-1 text-text-3 transition-colors duration-150 hover:text-accent-light"
            >
              手动刷新 ↻
            </button>
          </div>
        </div>

        <div className="mt-8 space-y-2">
          <div className="flex items-start gap-2.5 rounded-xl bg-surface-3 px-4 py-3">
            <span className="mt-0.5 text-sm">💡</span>
            <p className="text-xs leading-relaxed text-text-3">
              打开「<strong className="text-text-2">交我办</strong>」App 或微信，
              扫描上方二维码即可完成登录。
            </p>
          </div>
          <div className="flex items-start gap-2.5 rounded-xl border border-amber/20 bg-amber/5 px-4 py-3">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-xs leading-relaxed text-amber">
              请确保已连接 <strong>SJTU 校园网</strong>或<strong>交大 VPN</strong>，否则无法正常登录和下载。
            </p>
          </div>
          <p className="text-center text-xs text-text-4">
            登录信息仅保存在本机，应用不会上传任何账号或密码。
          </p>
        </div>
      </div>
    </div>
  )
}
