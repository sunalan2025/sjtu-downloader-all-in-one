import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/app'
import { SJTU_PARTITION, VSJTU_JWT_LS_KEY } from '@shared/types'
import { Spinner } from '../components/Spinner'
import pkg from '../../../../package.json'
import {
  JACCOUNT_AUTH_URL,
  isAllowedNavDomain,
  isTrustedJAccountOrigin,
  isLoginSuccessUrl,
  type WebviewElement
} from './login/login-security'
import { getJAccountEmbedCss } from './login/jaccount-embed-css'
import { getAutofillScript } from './login/autofill-script'
import { SaveCredentialModal } from './login/SaveCredentialModal'
import { AutoLoginOverlay, LoginSuccessOverlay } from './login/AutoLoginOverlay'

// 向后兼容导出（供外部单测及模块直接引用）
export { isAllowedNavDomain, isTrustedJAccountOrigin } from './login/login-security'
export { getAutofillScript } from './login/autofill-script'

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
  const [isAutoLoginActive, setIsAutoLoginActive] = useState(false)
  const isAutoLoginActiveRef = useRef(false)
  const [autoLoginStep, setAutoLoginStep] = useState<1 | 2 | 3 | 4>(1)
  const [activeAccountUser, setActiveAccountUser] = useState<string>('')
  const [isLoginSuccessOverlay, setIsLoginSuccessOverlay] = useState(false)
  const isAutoLoginCancelledRef = useRef(false)

  const capturedCredRef = useRef<{ username: string; password: string } | null>(null)
  const isSolvingCaptchaRef = useRef(false)
  const lastSolvedDataUrlRef = useRef<string | null>(null)
  const [pendingSaveCred, setPendingSaveCred] = useState<{
    username: string
    password: string
    defaultLabel?: string
  } | null>(null)
  const [customLabel, setCustomLabel] = useState('')
  const [isSavingCred, setIsSavingCred] = useState(false)

  const handleCancelAutoLogin = useCallback(async (): Promise<void> => {
    isAutoLoginCancelledRef.current = true
    isAutoLoginActiveRef.current = false
    setIsAutoLoginActive(false)
    setAutoLoginStep(1)
    setStatusMsg('已取消自动登录，请手动登录或扫码')
    const wv = webviewRef.current
    if (wv) {
      try {
        await wv.executeJavaScript(`
          if (typeof window.__sjtuCancelAutoLogin === 'function') {
            window.__sjtuCancelAutoLogin();
          }
          if (typeof window.__sjtuClearInputs === 'function') {
            window.__sjtuClearInputs();
          }
        `)
        await wv.loadURL(JACCOUNT_AUTH_URL)
      } catch {
        /* ignore */
      }
    }
  }, [])

  const navigateToBrowser = useCallback(() => {
    const currentVersion = window.api?.version || pkg.version
    const lastVersion = useAppStore.getState().lastSetupVersion
    const hasCompleted = useAppStore.getState().hasCompletedInitialSetup
    if (!hasCompleted || !lastVersion || lastVersion !== currentVersion) {
      useAppStore.getState().setShowSetupWizardModal(true)
    }
    const currentTab = useAppStore.getState().activeTab
    if (currentTab === 'settings') {
      useAppStore.getState().setActiveTab(useAppStore.getState().lastCourseTab || 'canvas')
    }
    setIsLoginSuccessOverlay(false)
    setStage('browser')
  }, [setStage])

  const proceedAfterLogin = useCallback(async (): Promise<void> => {
    // 自动登录场景：所用账号密码本就来自已保存凭据，绝不二次弹窗打扰用户，平滑延时展示动画后直接进入主页
    if (isAutoLoginActiveRef.current) {
      capturedCredRef.current = null
      setTimeout(() => {
        navigateToBrowser()
      }, 500)
      return
    }

    const captured = capturedCredRef.current
    if (captured && captured.username && captured.password) {
      try {
        const list = await window.api.credentials.list()
        const existing = list.find(c => c.username === captured.username)
        if (existing) {
          const fill = await window.api.credentials.getFillData(existing.id)
          if (fill.ok && fill.password === captured.password) {
            // 密码完全一致，getFillData 已在主进程更新 lastUsedAt，直接进入主页
            capturedCredRef.current = null
            navigateToBrowser()
            return
          }
        }
        // 新账号或已更改密码，弹出气泡卡片询问
        setCustomLabel(existing?.label || '')
        setPendingSaveCred({
          username: captured.username,
          password: captured.password,
          defaultLabel: existing?.label
        })
        return
      } catch (err) {
        console.error('[Login] credentials check error:', err)
        capturedCredRef.current = null
        navigateToBrowser()
        return
      }
    }
    // 未捕获新凭据（如扫码登录），直接进入主页
    capturedCredRef.current = null
    navigateToBrowser()
  }, [navigateToBrowser])

  const handleConfirmSaveCred = useCallback(async (): Promise<void> => {
    if (!pendingSaveCred) return
    setIsSavingCred(true)
    try {
      await window.api.credentials.save(
        pendingSaveCred.username,
        pendingSaveCred.password,
        customLabel.trim() || undefined
      )
    } catch (err) {
      console.error('[Login] failed to save credential:', err)
    } finally {
      setIsSavingCred(false)
      setPendingSaveCred(null)
      capturedCredRef.current = null
      navigateToBrowser()
    }
  }, [customLabel, navigateToBrowser, pendingSaveCred])

  const handleSkipSaveCred = useCallback((): void => {
    setPendingSaveCred(null)
    capturedCredRef.current = null
    navigateToBrowser()
  }, [navigateToBrowser])

  const handleSelectAccount = useCallback(async (id: string): Promise<void> => {
    const wv = webviewRef.current
    if (!wv) return
    if (!isTrustedJAccountOrigin(wv.getURL())) {
      console.warn('[Login] 拒绝向非 jAccount 官方页面填充凭据:', wv.getURL())
      return
    }
    try {
      const fill = await window.api.credentials.getFillData(id)
      if (fill.ok && fill.username && fill.password) {
        await wv.executeJavaScript(`
          if (typeof window.__sjtuFillCred === 'function') {
            window.__sjtuFillCred(${JSON.stringify(fill.username)}, ${JSON.stringify(fill.password)});
          }
        `)
      }
    } catch (err) {
      console.error('[Login] failed to fill selected credential:', err)
    }
  }, [])

  const handleDeleteAccountFromWebview = useCallback(async (id: string): Promise<void> => {
    try {
      await window.api.credentials.delete(id)
      const updated = await window.api.credentials.list()
      const wv = webviewRef.current
      if (wv) {
        await wv.executeJavaScript(`
          if (typeof window.__sjtuUpdateAccounts === 'function') {
            window.__sjtuUpdateAccounts(${JSON.stringify(updated)});
          }
        `).catch(() => undefined)
      }
    } catch (err) {
      console.error('[Login] failed to delete credential from webview:', err)
    }
  }, [])

  const handleSolveCaptcha = useCallback(async (dataUrl: string): Promise<void> => {
    const wv = webviewRef.current
    if (!wv || !dataUrl || dataUrl.length < 100) return
    if (isAutoLoginCancelledRef.current) return
    if (isSolvingCaptchaRef.current || lastSolvedDataUrlRef.current === dataUrl) return
    isSolvingCaptchaRef.current = true
    lastSolvedDataUrlRef.current = dataUrl
    if (!isAutoLoginCancelledRef.current) {
      setAutoLoginStep(2)
      setStatusMsg('正在自动识别验证码…')
    }
    try {
      console.log('[Login] 收到验证码图片，正在调用极客验证码接口识别...')
      const res = await window.api.auth.solveCaptcha(dataUrl)
      if (res.ok && res.code) {
        console.log('[Login] 验证码自动识别结果:', res.code)
        if (!isAutoLoginCancelledRef.current) {
          setAutoLoginStep(2)
          setStatusMsg(`验证码识别成功 (${res.code})，正在填入并准备登录…`)
        }
        const execRes = await wv.executeJavaScript(`
          (() => {
            try {
              if (typeof window.__sjtuFillCaptchaAndSubmit === 'function') {
                window.__sjtuFillCaptchaAndSubmit(${JSON.stringify(res.code)});
                return { ok: true, via: '__sjtuFillCaptchaAndSubmit' };
              }
              const cEl = document.querySelector('#passwordForm #input-login-captcha, #input-login-captcha');
              if (cEl) {
                cEl.value = ${JSON.stringify(res.code)};
                cEl.dispatchEvent(new Event('input', { bubbles: true }));
                cEl.dispatchEvent(new Event('change', { bubbles: true }));
              }
              const btn = document.querySelector('#submit-password-button, #passwordForm input[type="submit"], input[type="submit"]');
              if (typeof window.checkForm === 'function' && btn) {
                window.checkForm(btn);
                return { ok: true, via: 'direct_checkForm' };
              }
              if (btn && typeof btn['click'] === 'function') {
                btn['click']();
                return { ok: true, via: 'direct_click' };
              }
              return { ok: false, error: 'no_submit_btn' };
            } catch (e) {
              return { ok: false, error: String(e) };
            }
          })()
        `)
        console.log('[Login] 验证码填入与提交执行结果:', execRes)
      } else {
        console.warn('[Login] 验证码自动识别未获取到结果:', res.error)
        setStatusMsg('验证码识别未成功，请点击图片刷新或手动输入')
      }
    } catch (err) {
      console.warn('[Login] 验证码自动识别异常:', err)
      setStatusMsg('验证码识别未成功，请点击图片刷新或手动输入')
    } finally {
      isSolvingCaptchaRef.current = false
    }
  }, [])

  const triggerActiveCaptchaCheck = useCallback(async (): Promise<void> => {
    const wv = webviewRef.current
    if (!wv || !isTrustedJAccountOrigin(wv.getURL())) return
    if (isAutoLoginCancelledRef.current) return
    try {
      const dataUrl = await wv.executeJavaScript(`
        (() => {
          try {
            if (window.__sjtuAutoLoginCancelled) return null;
            if (typeof window.__sjtuGetCaptchaDataUrl === 'function') {
              return window.__sjtuGetCaptchaDataUrl();
            }
            const img = document.querySelector('#passwordForm #captcha-img, #captcha-img');
            if (!img || !img.complete || img.naturalWidth === 0) return null;
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || 110;
            canvas.height = img.naturalHeight || 40;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            ctx.drawImage(img, 0, 0);
            return canvas.toDataURL('image/jpeg', 0.95);
          } catch {
            return null;
          }
        })()
      `)
      if (dataUrl && typeof dataUrl === 'string' && dataUrl.length > 100) {
        if (!isAutoLoginCancelledRef.current) {
          await handleSolveCaptcha(dataUrl)
        }
      } else {
        if (!isAutoLoginCancelledRef.current) {
          await wv
            .executeJavaScript(`
            if (typeof window.__sjtuCheckNoCaptchaAndSubmit === 'function') {
              window.__sjtuCheckNoCaptchaAndSubmit();
            }
          `)
            .catch(() => undefined)
        }
      }
    } catch {
      /* ignore */
    }
  }, [handleSolveCaptcha])

  const onConsoleMsg = useCallback(
    (e: any): void => {
      const msg = (e && typeof e.message === 'string' ? e.message : '') as string
      if (msg === '__SJTU_CRED_CLEAR__' || msg.startsWith('__SJTU_CRED_CLEAR__')) {
        capturedCredRef.current = null
      } else if (msg.startsWith('__SJTU_CRED_CAPTURED__:')) {
        try {
          const data = JSON.parse(msg.slice(23))
          if (data && typeof data.user === 'string' && typeof data.pass === 'string') {
            capturedCredRef.current = { username: data.user, password: data.pass }
          }
        } catch {}
      } else if (msg.startsWith('__SJTU_CRED_SELECT__:')) {
        const id = msg.slice(21)
        void handleSelectAccount(id)
      } else if (msg.startsWith('__SJTU_CRED_DELETE__:')) {
        const id = msg.slice(21)
        void handleDeleteAccountFromWebview(id)
      } else if (msg.startsWith('__SJTU_SOLVE_CAPTCHA__:')) {
        const dataUrl = msg.slice(23)
        void handleSolveCaptcha(dataUrl)
      } else if (msg.startsWith('__SJTU_AUTOLOGIN_PHASE__:')) {
        const phase = msg.slice(25)
        if (!isAutoLoginCancelledRef.current) {
          if (phase === 'username') {
            setAutoLoginStep(1)
            setStatusMsg('正在填入已保存账号…')
          } else if (phase === 'password') {
            setAutoLoginStep(1)
            setStatusMsg('已填入账号，正在填入密码…')
          } else if (phase === 'check_captcha') {
            setAutoLoginStep(2)
            setStatusMsg('已填入账号密码，正在检测环境与验证码…')
          } else if (phase === 'submitting') {
            setAutoLoginStep(3)
            setStatusMsg('验证完成，正在提交登录认证…')
          }
        }
      } else if (msg === '__SJTU_AUTOLOGIN_CANCELLED__') {
        isAutoLoginActiveRef.current = false
        setIsAutoLoginActive(false)
        setAutoLoginStep(1)
        setStatusMsg('已取消自动登录，请手动登录或扫码')
      } else if (msg.startsWith('__SJTU_LOGIN_ERROR__:')) {
        const errText = msg.slice(22)
        console.warn('[Login] jAccount 页面返回错误提示:', errText)
        if (errText.includes('验证码') || errText.toLowerCase().includes('captcha')) {
          setStatusMsg(`验证码校验未通过 (${errText})，正在自动刷新并重新识别…`)
          setAutoLoginStep(2)
          lastSolvedDataUrlRef.current = null
        } else {
          isAutoLoginActiveRef.current = false
          setIsAutoLoginActive(false)
          setStatusMsg(`登录失败: ${errText}，请核对账号密码`)
        }
      }
    },
    [handleDeleteAccountFromWebview, handleSelectAccount, handleSolveCaptcha]
  )

  const injectAutofill = useCallback(async (): Promise<void> => {
    const wv = webviewRef.current
    if (!wv) return
    if (!isTrustedJAccountOrigin(wv.getURL())) {
      console.warn('[Login] 拒绝向非 jAccount 官方页面注入自动填充脚本:', wv.getURL())
      return
    }
    try {
      const accounts = await window.api.credentials.list()
      let defaultFill: { username?: string; password?: string } | null = null
      if (!isAutoLoginCancelledRef.current && accounts.length > 0) {
        const fillRes = await window.api.credentials.getFillData(accounts[0].id)
        if (fillRes.ok && fillRes.username && fillRes.password) {
          defaultFill = { username: fillRes.username, password: fillRes.password }
        }
      }
      if (defaultFill) {
        isAutoLoginActiveRef.current = true
        setIsAutoLoginActive(true)
        setActiveAccountUser(defaultFill.username || '')
        setAutoLoginStep(1)
        setStatusMsg('检测到已保存账号，准备自动登录…')
      } else {
        isAutoLoginActiveRef.current = false
        setIsAutoLoginActive(false)
        setAutoLoginStep(1)
      }
      const script = getAutofillScript(accounts, isDarkRef.current, defaultFill)
      await wv.executeJavaScript(script)

      setTimeout(() => void triggerActiveCaptchaCheck(), 600)
      setTimeout(() => void triggerActiveCaptchaCheck(), 1500)
    } catch (err) {
      console.error('[Login] failed to inject autofill script:', err)
    }
  }, [triggerActiveCaptchaCheck])

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
    // 0. 优先从 webview 当前 URL 拦截 OAuth2 Code，直接调 SSO 接口换取 JWT（耗时 <100ms）
    const initialUrl = webviewRef.current?.getURL() || ''
    const initialCode = initialUrl.match(/[?&#]code=([a-zA-Z0-9_-]+)/)?.[1]
    if (initialCode) {
      try {
        const res = await window.api.auth.exchangeCode(initialCode)
        if (res.success) {
          const a = await window.api.auth.status(false)
          setAuth(a)
          try {
            const cloudToken = await window.api.cloudpan.getCachedToken()
            if (cloudToken) useAppStore.getState().setCloudUserToken(cloudToken)
          } catch {}
          await proceedAfterLogin()
          return
        }
      } catch {}
    }

    let attempts = 0
    const maxAttempts = 40 // 40 * 250ms = 10s
    while (attempts++ < maxAttempts) {
      // 1. 若 URL 随后才变化出 code，也第一时间直换
      const currentUrl = webviewRef.current?.getURL() || ''
      const code = currentUrl.match(/[?&#]code=([a-zA-Z0-9_-]+)/)?.[1]
      if (code) {
        try {
          const res = await window.api.auth.exchangeCode(code)
          if (res.success) {
            const a = await window.api.auth.status(false)
            setAuth(a)
            await proceedAfterLogin()
            return
          }
        } catch {}
      }

      // 2. 尝试从 webview 抽取 JWT（本地存储兜底）
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
        await proceedAfterLogin()
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
          await proceedAfterLogin()
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
      await proceedAfterLogin()
      return
    }

    isFinishingRef.current = false
    setIsLoginSuccessOverlay(false)
    setReady(true)
    setError('会话同步耗时较长，请点击下方「刷新」重试')
    setStatusMsg('登录同步超时')
  }, [checkAuth, proceedAfterLogin, pullJwt, setAuth])

  // 初始挂载时预检：若已有登录态直接切入主界面
  useEffect(() => {
    void (async () => {
      if (await checkAuth()) navigateToBrowser()
    })()
  }, [checkAuth, navigateToBrowser])

  // 主题动态响应：在深浅主题切换时实时更新 webview 样式变量与自动填充组件
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv || !ready) return
    try {
      const url = wv.getURL?.() ?? ''
      if (isTrustedJAccountOrigin(url)) {
        void wv.insertCSS(getJAccountEmbedCss(isDark)).catch(() => undefined)
        void injectAutofill()
      }
    } catch {
      /* ignore */
    }
  }, [injectAutofill, isDark, ready])

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
              setIsLoginSuccessOverlay(true)
              setReady(false)
              setStatusMsg('登录成功，正在进入主页…')
              void handleLoginCompletion()
              return
            }

            if (isTrustedJAccountOrigin(url)) {
              const is2FA = await wv
                .executeJavaScript(`
                (() => {
                  try {
                    const text = document.body ? document.body.innerText : '';
                    return text.includes('二次验证') || text.includes('安全验证') || !!document.querySelector('.confirm-title, input[value="提交"]');
                  } catch {
                    return false;
                  }
                })()
              `)
                .catch(() => false)
              if (is2FA) {
                setStatusMsg('请完成二次验证（支持交我办扫码、动态码或短信）')
              }
            }
          } catch {
            /* ignore */
          }
        }

        const token = await pullJwt()
        if (token) {
          const a = await checkAuth(false)
          if (a) {
            isFinishingRef.current = true
            setIsLoginSuccessOverlay(true)
            await proceedAfterLogin()
            return
          }
        }
      })()
    }, 1500)
    return () => clearInterval(id)
  }, [checkAuth, handleLoginCompletion, proceedAfterLogin, pullJwt])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return

    const updateAuthStatus = async (): Promise<void> => {
      try {
        const is2FA = await wv
          .executeJavaScript(`
          (() => {
            try {
              const text = document.body ? document.body.innerText : '';
              return text.includes('二次验证') || text.includes('安全验证') || !!document.querySelector('.confirm-title, input[value="提交"]');
            } catch {
              return false;
            }
          })()
        `)
          .catch(() => false)
        if (is2FA) {
          setStatusMsg('请完成二次验证（支持交我办扫码、动态码或短信）')
        } else {
          setStatusMsg('请扫码、账号密码或短信验证登录')
        }
      } catch {
        setStatusMsg('请扫码、账号密码或短信验证登录')
      }
    }

    const onDomReady = (): void => {
      const url = wv.getURL()
      if (isLoginSuccessUrl(url)) {
        if (!isFinishingRef.current) {
          isFinishingRef.current = true
          setIsLoginSuccessOverlay(true)
          setStatusMsg('登录成功，正在进入主页…')
          void handleLoginCompletion()
        }
        return
      }

      if (isTrustedJAccountOrigin(url)) {
        void wv.insertCSS(getJAccountEmbedCss(isDarkRef.current)).catch(() => undefined)
        setReady(true)
        setError(null)
        void updateAuthStatus()
        void injectAutofill()
      }
    }

    const onNav = (): void => {
      const url = wv.getURL()
      if (!isAllowedNavDomain(url)) {
        console.warn('[Login] blocked navigation to unexpected domain:', url)
        setError('安全拦截：当前网页非交大官方认证服务 (jaccount.sjtu.edu.cn)，已自动返回认证首页')
        setStatusMsg('安全拦截：当前网页非交大官方认证服务 (jaccount.sjtu.edu.cn)，已自动返回认证首页')
        void wv.loadURL(JACCOUNT_AUTH_URL)
        return
      }

      const lowerUrl = url.toLowerCase()
      if (
        lowerUrl.includes('qr') ||
        lowerUrl.includes('qrcode') ||
        lowerUrl.includes('refresh') ||
        lowerUrl.includes('reauth') ||
        lowerUrl.includes('renew')
      ) {
        capturedCredRef.current = null
      }

      if (isTrustedJAccountOrigin(url)) {
        setError(null)
        void updateAuthStatus()
        void injectAutofill()
        return
      }

      // 真正登录成功的判定：URL 携带 OAuth code，或到达 home 首页
      if (isLoginSuccessUrl(url) && !isFinishingRef.current) {
        isFinishingRef.current = true
        setIsLoginSuccessOverlay(true)
        setStatusMsg('登录成功，正在进入主页…')
        void handleLoginCompletion()
      }
    }

    const onFail = (e: any): void => {
      if (e?.errorCode === -3) return
      setError(`认证页面加载失败 (${e?.errorDescription || '网络异常'})，请检查是否已连接交大校园网或 VPN`)
      setStatusMsg('认证页面加载失败')
      setReady(false)
    }

    wv.addEventListener('dom-ready', onDomReady)
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    wv.addEventListener('did-fail-load', onFail)
    wv.addEventListener('console-message', onConsoleMsg as (e: Event) => void)

    return () => {
      wv.removeEventListener('dom-ready', onDomReady)
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
      wv.removeEventListener('did-fail-load', onFail)
      wv.removeEventListener('console-message', onConsoleMsg as (e: Event) => void)
    }
  }, [handleLoginCompletion, injectAutofill, onConsoleMsg])

  const onReload = useCallback((): void => {
    isFinishingRef.current = false
    capturedCredRef.current = null
    lastSolvedDataUrlRef.current = null
    isSolvingCaptchaRef.current = false
    isAutoLoginCancelledRef.current = false
    isAutoLoginActiveRef.current = false
    setIsAutoLoginActive(false)
    setAutoLoginStep(1)
    setIsLoginSuccessOverlay(false)
    setPendingSaveCred(null)
    setReady(false)
    setError(null)
    setStatusMsg('正在加载登录界面…')
    webviewRef.current?.loadURL(JACCOUNT_AUTH_URL).catch(() => undefined)
  }, [])

  return (
    <div className="relative flex h-full w-full items-center justify-center px-6 py-8">
      <button
        type="button"
        onClick={() => {
          capturedCredRef.current = null
          setPendingSaveCred(null)
          setStage('welcome')
        }}
        className="no-drag absolute left-6 top-6 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-text-3 transition-all duration-200 hover:bg-surface-3 hover:text-text-1"
      >
        ← 返回
      </button>

      <div className="w-full max-w-2xl transition-all duration-300">
        <header className="mb-6 text-center">
          <h1 className="text-xl font-bold text-text-1">jAccount 统一身份认证</h1>
          <div className="mt-2.5 flex items-center justify-center gap-2.5">
            <div className="inline-flex items-center gap-2 rounded-full border border-bd bg-surface-2 px-3.5 py-1 text-xs text-text-2 shadow-xs transition-all duration-200">
              {isAutoLoginActive && (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
              )}
              <span>{statusMsg}</span>
            </div>
          </div>
          {isAutoLoginActive && (
            <div className="mx-auto mt-2.5 h-0.5 w-44 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full w-full bg-accent/80 transition-all duration-300 animate-pulse" />
            </div>
          )}
        </header>

        <div className="relative rounded-2xl border border-bd bg-surface-1 p-6 shadow-card backdrop-blur">
          <div className="relative h-[415px] min-h-[380px] w-full overflow-hidden rounded-xl bg-surface-1">
            {!ready && !error && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface-1 backdrop-blur-sm">
                <Spinner size={28} />
                <div className="text-sm text-text-3">正在加载认证界面…</div>
              </div>
            )}
            {isAutoLoginActive && !isLoginSuccessOverlay && (
              <AutoLoginOverlay
                autoLoginStep={autoLoginStep}
                activeAccountUser={activeAccountUser}
                onCancel={handleCancelAutoLogin}
              />
            )}
            {isLoginSuccessOverlay && <LoginSuccessOverlay />}
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
                background: isDark ? '#161618' : '#FFFFFF',
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
              打开「<strong className="text-text-2">交我办</strong>」App 或微信，扫描左侧二维码即可完成扫码登录与二次验证；亦可在右侧直接使用账号密码登录。
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

      {pendingSaveCred && (
        <SaveCredentialModal
          pendingSaveCred={pendingSaveCred}
          customLabel={customLabel}
          setCustomLabel={setCustomLabel}
          isSavingCred={isSavingCred}
          onConfirm={() => void handleConfirmSaveCred()}
          onSkip={handleSkipSaveCred}
        />
      )}
    </div>
  )
}
