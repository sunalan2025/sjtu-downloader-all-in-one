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
 * 统一样式与主题注入：
 * 1. 强制采用 Flexbox 双栏横向排布：左侧扫码登录 + 纵向分割线 + 右侧账密/短信登录；
 * 2. 破除 jAccount 响应式媒体查询中的折行与隐藏，保证二维码和表单始终水平并列；
 * 3. 彻底清除外层多余背景（如灰底 #dce3e6）、页眉、页脚及浮动条，实现与客户端窗口主题完美无缝融合；
 * 4. 深度契合客户端深浅色主题，动态注入色彩变量与精致圆角微阴影；
 * 5. 锁定 overflow: hidden，杜绝页面滚动条与局部溢出。
 */
function getJAccountEmbedCss(isDark: boolean): string {
  const vars = isDark
    ? `
      --theme-bg: #1E1E1E;
      --theme-text: #F5F5F5;
      --theme-text-sub: #A0A0A0;
      --theme-text-muted: #737373;
      --theme-border: #333333;
      --theme-qr-bg: #FFFFFF;
      --theme-qr-border: #444444;
      --theme-input-bg: #272727;
      --theme-input-border: #383838;
      --theme-input-text: #F5F5F5;
      --theme-placeholder: #666666;
      --theme-accent: #4080FF;
      --theme-accent-hover: #69B1FF;
      --theme-accent-ring: rgba(64, 128, 255, 0.25);
      --theme-accent-shadow: rgba(64, 128, 255, 0.2);
      --theme-warn-bg: #2E2316;
      --theme-warn-text: #FB923C;
    `
    : `
      --theme-bg: #FFFFFF;
      --theme-text: #1D2129;
      --theme-text-sub: #4E5969;
      --theme-text-muted: #86909C;
      --theme-border: #E5E6EB;
      --theme-qr-bg: #FFFFFF;
      --theme-qr-border: #E5E6EB;
      --theme-input-bg: #F7F8FA;
      --theme-input-border: #E5E6EB;
      --theme-input-text: #1D2129;
      --theme-placeholder: #A8ABB2;
      --theme-accent: #165DFF;
      --theme-accent-hover: #0E42D2;
      --theme-accent-ring: rgba(22, 93, 255, 0.20);
      --theme-accent-shadow: rgba(22, 93, 255, 0.15);
      --theme-warn-bg: #FFF7E6;
      --theme-warn-text: #D46B08;
    `

  return `
    :root {
      ${vars}
    }

    /* 隐藏所有多余的页眉、页脚、背景图、APP快速登录浮窗 */
    header,
    footer,
    #header,
    #footer,
    .header,
    .footer,
    .copyright,
    .login-bg,
    .bg-img,
    #login-app,
    .app-link {
      display: none !important;
    }

    html, body {
      background: var(--theme-bg) !important;
      background-color: var(--theme-bg) !important;
      color: var(--theme-text) !important;
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      height: 100% !important;
      overflow: hidden !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif !important;
      -webkit-font-smoothing: antialiased !important;
    }

    #page,
    #content,
    .container,
    .login-layout {
      background: transparent !important;
      background-color: transparent !important;
      border: none !important;
      box-shadow: none !important;
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      height: 100% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      overflow: hidden !important;
    }

    /* 核心卡片容器：水平 Flex 布局，左扫码右账密，若触发交我办推送确认或二次验证则自适应切为单栏居中 */
    #login-form.login-card,
    .login-card,
    .login-box {
      display: flex !important;
      flex-direction: row !important;
      align-items: center !important;
      justify-content: center !important;
      box-shadow: none !important;
      border: none !important;
      margin: 0 auto !important;
      padding: 0 !important;
      background: transparent !important;
      background-color: transparent !important;
      width: auto !important;
      max-width: 560px !important;
      box-sizing: border-box !important;
    }

    #login-form:has(.confirm-title),
    #login-form:has(.confirm-msg),
    #login-form:has(table),
    #login-form:has(#second-auth-form) {
      flex-direction: column !important;
    }

    /* 左侧二维码扫码专区 */
    .login-qr {
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      float: none !important;
      width: 220px !important;
      min-width: 220px !important;
      margin: 0 !important;
      padding: 8px 28px 8px 0 !important;
      border-right: 1px solid var(--theme-border) !important;
      box-sizing: border-box !important;
    }

    .login-qr .qr-title {
      font-size: 14px !important;
      font-weight: 600 !important;
      margin-bottom: 12px !important;
      color: var(--theme-text) !important;
      text-align: center !important;
    }

    .login-qr .bolder-blue {
      color: var(--theme-accent) !important;
      font-weight: 600 !important;
    }

    #qr-mask {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 176px !important;
      height: 176px !important;
      padding: 6px !important;
      background: var(--theme-qr-bg) !important;
      border-radius: 12px !important;
      border: 1px solid var(--theme-qr-border) !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05) !important;
      box-sizing: border-box !important;
    }

    #qr-img {
      display: block !important;
      width: 160px !important;
      height: 160px !important;
      border-radius: 6px !important;
      visibility: visible !important;
      opacity: 1 !important;
    }

    .qr-tips {
      font-size: 12px !important;
      color: var(--theme-text-muted) !important;
      margin-top: 10px !important;
      text-align: center !important;
    }

    .qr-tips .bolder-blue {
      color: var(--theme-accent) !important;
    }

    /* 右侧表单专区（账号密码 / 短信验证） */
    .form-login {
      display: flex !important;
      flex-direction: column !important;
      justify-content: center !important;
      float: none !important;
      width: 260px !important;
      min-width: 260px !important;
      margin: 0 !important;
      padding: 8px 0 8px 28px !important;
      box-sizing: border-box !important;
    }

    .form-login .login-header {
      margin-bottom: 14px !important;
    }

    .form-login .login-title {
      font-size: 16px !important;
      font-weight: 600 !important;
      color: var(--theme-text) !important;
      margin: 0 !important;
      padding: 0 !important;
      line-height: 1.4 !important;
    }

    .input-control {
      position: relative !important;
      margin-bottom: 10px !important;
    }

    .input-control .icon {
      position: absolute !important;
      left: 10px !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      z-index: 2 !important;
      opacity: ${isDark ? '0.7' : '0.85'} !important;
    }

    .form-input,
    #input-login-user,
    #input-login-pass,
    #input-login-captcha,
    #input-login-mobile,
    #input-login-sms {
      width: 100% !important;
      height: 38px !important;
      line-height: 38px !important;
      padding: 0 10px 0 34px !important;
      border-radius: 8px !important;
      border: 1px solid var(--theme-input-border) !important;
      background-color: var(--theme-input-bg) !important;
      color: var(--theme-input-text) !important;
      font-size: 13px !important;
      outline: none !important;
      box-sizing: border-box !important;
      transition: border-color 0.15s, box-shadow 0.15s !important;
    }

    .form-input:focus,
    #input-login-user:focus,
    #input-login-pass:focus,
    #input-login-captcha:focus,
    #input-login-mobile:focus,
    #input-login-sms:focus {
      border-color: var(--theme-accent) !important;
      box-shadow: 0 0 0 2px var(--theme-accent-ring) !important;
    }

    .form-input::placeholder,
    #input-login-user::placeholder,
    #input-login-pass::placeholder,
    #input-login-captcha::placeholder,
    #input-login-mobile::placeholder,
    #input-login-sms::placeholder {
      color: var(--theme-placeholder) !important;
    }

    /* 验证码输入框及图片 */
    .captcha-input {
      position: relative !important;
      display: flex !important;
      align-items: center !important;
    }

    #captcha-img {
      height: 34px !important;
      cursor: pointer !important;
      border-radius: 6px !important;
      margin-left: 6px !important;
      border: 1px solid var(--theme-input-border) !important;
    }

    /* 登录按钮 */
    .form-submit,
    .btn-primary,
    #submit-password-button,
    #submit-sms-button {
      width: 100% !important;
      height: 38px !important;
      line-height: 38px !important;
      padding: 0 !important;
      background: var(--theme-accent) !important;
      color: #ffffff !important;
      border: none !important;
      border-radius: 8px !important;
      font-size: 14px !important;
      font-weight: 500 !important;
      letter-spacing: 2px !important;
      cursor: pointer !important;
      box-shadow: 0 2px 6px var(--theme-accent-shadow) !important;
      transition: opacity 0.15s, transform 0.05s !important;
    }

    .form-submit:hover,
    .btn-primary:hover,
    #submit-password-button:hover,
    #submit-sms-button:hover {
      opacity: 0.9 !important;
    }

    .form-submit:active,
    .btn-primary:active,
    #submit-password-button:active,
    #submit-sms-button:active {
      transform: scale(0.99) !important;
    }

    /* 辅助链接（忘记密码、注册等） */
    .action-control,
    #login-action {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      margin-top: 10px !important;
      font-size: 12px !important;
    }

    .action-control a,
    #login-action a,
    .form-login a {
      color: var(--theme-text-sub) !important;
      text-decoration: none !important;
      font-size: 12px !important;
      transition: color 0.15s !important;
    }

    .action-control a:hover,
    #login-action a:hover,
    .form-login a:hover {
      color: var(--theme-accent) !important;
      text-decoration: underline !important;
    }

    .form-login div[style*="margin-top: 30px"],
    .form-login div[style*="margin-top:30px"] {
      margin-top: 10px !important;
      text-align: center !important;
    }

    /* 提示信息 */
    .warn-info,
    #div_warn {
      padding: 6px 10px !important;
      border-radius: 6px !important;
      background-color: var(--theme-warn-bg) !important;
      color: var(--theme-warn-text) !important;
      font-size: 12px !important;
      margin-bottom: 8px !important;
    }

    /* 短信验证码发送按钮 */
    .captcha-input #sms-btn,
    #sms-btn {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      background: var(--theme-accent) !important;
      border-radius: 0 8px 8px 0 !important;
      color: #ffffff !important;
      height: 38px !important;
      line-height: 38px !important;
      padding: 0 12px !important;
      font-size: 12px !important;
      cursor: pointer !important;
      white-space: nowrap !important;
      user-select: none !important;
      box-sizing: border-box !important;
    }

    /* 交我办移动端推送确认 / 提示 */
    .confirm-title {
      font-size: 15px !important;
      font-weight: 600 !important;
      color: var(--theme-text) !important;
      margin: 12px 0 6px 0 !important;
      text-align: center !important;
    }

    .confirm-msg {
      font-size: 13px !important;
      color: var(--theme-text-sub) !important;
      margin-bottom: 12px !important;
      text-align: center !important;
    }

    .confirm-cancel {
      color: var(--theme-text-muted) !important;
      text-decoration: underline !important;
      font-size: 12px !important;
      cursor: pointer !important;
      text-align: center !important;
    }

    /* 二次验证 (2FA) 容器兼容 */
    #second-auth-form {
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      width: 100% !important;
    }
  `
}

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
  const theme = useAppStore(s => s.theme)
  const isDark =
    theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const isDarkRef = useRef(isDark)
  isDarkRef.current = isDark

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
      const data = (await wv.executeJavaScript(`
        (() => {
          try {
            const token = localStorage.getItem(${JSON.stringify(VSJTU_JWT_LS_KEY)}) || localStorage.getItem('jwt-token') || localStorage.getItem('token');
            const userRaw = localStorage.getItem('_jy-application-resmgr-ui_SESSION_USER_INFO') || localStorage.getItem('user_info') || localStorage.getItem('userInfo');
            let userInfo = null;
            if (userRaw) {
              try {
                const u = JSON.parse(userRaw);
                userInfo = {
                  name: u.name || u.userName || u.realName,
                  studentId: u.code || u.username || u.userCode || u.studentId
                };
              } catch {}
            }
            return { token, userInfo };
          } catch {
            return null;
          }
        })()
      `)) as { token?: string | null; userInfo?: { name?: string; studentId?: string } | null } | null

      const t = data?.token
      if (t && t.length > 20) {
        await window.api.auth.setJwtToken(t, data?.userInfo || undefined)
        return t
      }
    } catch {
      /* ignore */
    }
    return null
  }, [])

  const handleLoginCompletion = useCallback(async (): Promise<void> => {
    let attempts = 0
    const maxAttempts = 40 // 40 * 250ms = 10s
    while (attempts++ < maxAttempts) {
      // 1. 尝试从 webview 抽取 JWT
      const token = await pullJwt()
      if (token) {
        // 成功提取 JWT，由于主进程已将其置为已登录，立即获取状态并秒进主页！
        const a = await window.api.auth.status(false)
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

      // 2. 检查主进程缓存状态（若已由后台恢复或单点登录就绪）
      try {
        const cached = await window.api.auth.status(false)
        if (cached.loggedIn) {
          setAuth(cached)
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

      await new Promise(r => setTimeout(r, 250))
    }

    // 兜底进入（部分业务页面 cookie 已就绪但 JWT 写入慢）
    const a = await checkAuth(false)
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

  // 主题动态响应：在深浅主题切换时实时更新 webview 样式变量
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv || !ready) return
    try {
      const url = wv.getURL?.() ?? ''
      if (url.includes('jaccount.sjtu.edu.cn')) {
        void wv.insertCSS(getJAccountEmbedCss(isDark)).catch(() => undefined)
      }
    } catch {
      /* ignore */
    }
  }, [isDark, ready])

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
          const a = await checkAuth(false)
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
        void wv.insertCSS(getJAccountEmbedCss(isDarkRef.current)).catch(() => undefined)
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
          <div className="relative h-[380px] w-full overflow-hidden rounded-xl bg-surface-1">
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
                background: isDark ? '#1E1E1E' : '#FFFFFF',
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
