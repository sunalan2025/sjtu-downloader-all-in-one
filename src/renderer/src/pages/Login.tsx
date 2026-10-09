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

/**
 * 动态作用域隔离样式：仅在 html[data-sjtu-mode="isolated"] 激活时生效。
 * 完全摆脱对 body>#page>#content 等固定层级的脆弱依赖；一旦超时降级或还原，
 * 移除该属性即可瞬间恢复完整登录页。
 */
const QR_ISOLATION_CSS = `
  html[data-sjtu-mode="isolated"],
  html[data-sjtu-mode="isolated"] body {
    background: transparent !important;
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    height: 100% !important;
    overflow: hidden !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
  }
  html[data-sjtu-mode="isolated"] body {
    font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif !important;
  }

  /* 隐藏非关键页面修饰元素（头部、尾部、导航、背景、悬浮提示） */
  html[data-sjtu-mode="isolated"] header,
  html[data-sjtu-mode="isolated"] footer,
  html[data-sjtu-mode="isolated"] nav,
  html[data-sjtu-mode="isolated"] .header,
  html[data-sjtu-mode="isolated"] .footer,
  html[data-sjtu-mode="isolated"] .nav,
  html[data-sjtu-mode="isolated"] .navbar,
  html[data-sjtu-mode="isolated"] .copyright,
  html[data-sjtu-mode="isolated"] .login-bg,
  html[data-sjtu-mode="isolated"] .bg-img,
  html[data-sjtu-mode="isolated"] .toast,
  html[data-sjtu-mode="isolated"] .tooltip {
    display: none !important;
  }

  /* 动态隔离链：祖先节点 flex 居中并重置尺寸与背景 */
  html[data-sjtu-mode="isolated"] [data-sjtu-ancestor="true"] {
    background: transparent !important;
    box-shadow: none !important;
    border: none !important;
    padding: 0 !important;
    margin: 0 !important;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    min-height: 0 !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
  }

  /* 隔离目标二维码容器 */
  html[data-sjtu-mode="isolated"] [data-sjtu-qr-container="true"] {
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    background: transparent !important;
    box-shadow: none !important;
    border: none !important;
    margin: 0 auto !important;
    padding: 4px !important;
  }

  /* 非通路兄弟节点隐藏 */
  html[data-sjtu-mode="isolated"] [data-sjtu-hidden="true"] {
    display: none !important;
  }

  /* 二维码图像通用美化（支持 img, canvas, svg 等多元素） */
  html[data-sjtu-mode="isolated"] #qr-img,
  html[data-sjtu-mode="isolated"] img[src*="qrcode"],
  html[data-sjtu-mode="isolated"] .qrcode img,
  html[data-sjtu-mode="isolated"] canvas,
  html[data-sjtu-mode="isolated"] svg {
    background: white !important;
    padding: 8px !important;
    border-radius: 12px !important;
    box-shadow: 0 4px 20px rgba(0,0,0,0.12) !important;
    max-width: 200px !important;
    max-height: 200px !important;
  }

  html[data-sjtu-mode="isolated"] .qr-title,
  html[data-sjtu-mode="isolated"] #qr-title {
    font-size: 14px !important;
    font-weight: 500 !important;
    margin-top: 8px !important;
  }

  html[data-sjtu-mode="isolated"] .qr-tips,
  html[data-sjtu-mode="isolated"] #qr-msg {
    font-size: 13px !important;
    margin-top: 4px !important;
  }

  html[data-sjtu-mode="isolated"] ::-webkit-scrollbar {
    display: none !important;
  }
`

function qrThemeCss(theme: 'dark' | 'light'): string {
  const isDark = theme === 'dark'
  const textColor = isDark ? '#A0A0A0' : '#4E5969'
  const tipsColor = isDark ? '#737373' : '#86909C'
  const shadow = isDark ? '0 4px 24px rgba(0,0,0,0.25)' : '0 4px 24px rgba(0,0,0,0.10)'

  return `
    html[data-sjtu-mode="isolated"] body { color: ${textColor} !important; }
    html[data-sjtu-mode="isolated"] .qr-title, html[data-sjtu-mode="isolated"] #qr-title { color: ${textColor} !important; }
    html[data-sjtu-mode="isolated"] .qr-tips, html[data-sjtu-mode="isolated"] #qr-msg { color: ${tipsColor} !important; }
    html[data-sjtu-mode="isolated"] #qr-img,
    html[data-sjtu-mode="isolated"] img[src*="qrcode"],
    html[data-sjtu-mode="isolated"] .qrcode img,
    html[data-sjtu-mode="isolated"] canvas,
    html[data-sjtu-mode="isolated"] svg {
      box-shadow: ${shadow} !important;
    }
  `
}

/** 在 webview 内执行：多选择器检测、自动切 Tab 与动态隔离 */
const DETECT_AND_ISOLATE_QR_JS = `
  new Promise(resolve => {
    let tries = 0;
    let tabSwitched = false;

    const isValidQr = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) return false;

      const tag = el.tagName.toLowerCase();
      if (tag === 'img') {
        if (!el.complete || el.naturalWidth < 40) return false;
        const src = el.src || '';
        if (!src || src.endsWith('#') || src === window.location.href) return false;
        return true;
      }
      if (tag === 'canvas') {
        return el.width >= 40 && el.height >= 40;
      }
      if (tag === 'svg') {
        return el.querySelectorAll('rect, path').length > 0;
      }
      const child = el.querySelector('img, canvas, svg');
      if (child) return isValidQr(child);
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && (bg.includes('data:image') || bg.includes('qrcode'))) return true;
      return false;
    };

    const findQrElement = () => {
      const selectors = [
        '#qr-img',
        'img[src*="qrcode"]',
        'img[src*="QRCode"]',
        'img[src*="qrCode"]',
        '.qrcode img',
        '.qr-code img',
        '[class*="qrcode"] img',
        '[class*="qr-code"] img',
        '.qrcode canvas',
        '.qr-code canvas',
        '[class*="qrcode"] canvas',
        'canvas',
        '.qrcode svg',
        '.qr-code svg',
        '[class*="qrcode"] svg',
        'svg',
        '[class*="qrcode"]',
        '[class*="qr-code"]'
      ];
      for (const sel of selectors) {
        try {
          const els = document.querySelectorAll(sel);
          for (const el of Array.from(els)) {
            if (isValidQr(el)) return el;
          }
        } catch { /* ignore bad selector */ }
      }
      return null;
    };

    const trySwitchToQrTab = () => {
      if (tabSwitched) return;
      const tabSelectors = [
        '#tab-qrcode', '#tab-qr', '#tab-scan',
        '.tab-qrcode', '.tab-qr', '.qr-tab',
        '[data-tab="qrcode"]', '[data-tab="qr"]',
        '.qr-switch-icon', '.login-switch-btn', '.switch-to-qr',
        '[title*="扫码"]', '[title*="二维码"]',
        '[aria-label*="扫码"]', '[aria-label*="二维码"]'
      ];
      for (const sel of tabSelectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) {
          tabSwitched = true;
          el.click();
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return;
        }
      }
      const candidates = document.querySelectorAll('a, button, [role="tab"], .tab, .tab-item, .nav-item, .el-tabs__item, .ant-tabs-tab, span, div');
      for (const el of Array.from(candidates)) {
        if (el.children.length > 2) continue;
        const text = (el.textContent || '').trim();
        if ((text === '扫码登录' || text === '二维码登录' || text.includes('交我办') || text.includes('微信扫码')) && el.offsetParent !== null) {
          tabSwitched = true;
          el.click();
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return;
        }
      }
    };

    const findQrContainer = (target) => {
      const known = target.closest('.login-qr, .login-card, .login-box, .qrcode-box, .qrcode-container, [class*="qr-box"], [class*="qrcode"]');
      if (known && known !== document.body && known !== document.documentElement) {
        return known;
      }
      let parent = target.parentElement;
      while (parent && parent !== document.body) {
        const r = parent.getBoundingClientRect();
        if (r.width >= 120 && r.width <= 480 && r.height >= 120) {
          return parent;
        }
        parent = parent.parentElement;
      }
      return target.parentElement || target;
    };

    const applyIsolation = (container) => {
      document.documentElement.setAttribute('data-sjtu-mode', 'isolated');
      container.setAttribute('data-sjtu-qr-container', 'true');

      let curr = container;
      while (curr && curr !== document.body && curr !== document.documentElement) {
        curr.setAttribute('data-sjtu-ancestor', 'true');
        if (curr.parentElement) {
          for (const sib of Array.from(curr.parentElement.children)) {
            if (sib !== curr && !sib.hasAttribute('data-sjtu-ancestor')) {
              sib.setAttribute('data-sjtu-hidden', 'true');
            }
          }
        }
        curr = curr.parentElement;
      }
    };

    const tick = () => {
      const qrEl = findQrElement();
      if (qrEl) {
        const container = findQrContainer(qrEl);
        applyIsolation(container);
        return resolve('ok');
      }

      trySwitchToQrTab();

      if (++tries > 36) { // 36 * 150ms = 5.4s
        return resolve('timeout');
      }
      setTimeout(tick, 150);
    };

    tick();
  })
`

/** 超时后在 webview 内执行解除遮罩与还原 DOM */
const UNMASK_PAGE_JS = `
  (() => {
    document.documentElement.removeAttribute('data-sjtu-mode');
    document.documentElement.setAttribute('data-sjtu-mode', 'unmasked');

    document.querySelectorAll('[data-sjtu-ancestor]').forEach(el => el.removeAttribute('data-sjtu-ancestor'));
    document.querySelectorAll('[data-sjtu-qr-container]').forEach(el => el.removeAttribute('data-sjtu-qr-container'));
    document.querySelectorAll('[data-sjtu-hidden]').forEach(el => {
      el.removeAttribute('data-sjtu-hidden');
      el.style.removeProperty('display');
    });

    document.documentElement.style.removeProperty('overflow');
    document.documentElement.style.removeProperty('display');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('display');
    return 'unmasked';
  })()
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
  const [unmasked, setUnmasked] = useState(false)
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

  useEffect(() => {
    void (async () => {
      if (await checkAuth()) setStage('browser')
    })()
  }, [checkAuth, setStage])

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
      const resolved =
        theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : theme
      void wv.insertCSS(QR_ISOLATION_CSS + qrThemeCss(resolved)).catch(() => undefined)
      void wv
        .executeJavaScript(DETECT_AND_ISOLATE_QR_JS)
        .then(async state => {
          if (state === 'ok') {
            setReady(true)
            setUnmasked(false)
            setError(null)
            setStatusMsg('请用「交我办」或微信扫码登录')
          } else {
            // 超时（5.4s）：执行解除遮罩脚本，展示完整页面供用户手动交互
            try {
              await wv.executeJavaScript(UNMASK_PAGE_JS)
            } catch {
              /* ignore */
            }
            setUnmasked(true)
            setReady(true)
            setError(null)
            setStatusMsg('已切换至完整登录页，您可手动扫码或账号密码登录')
          }
        })
        .catch(async () => {
          try {
            await wv.executeJavaScript(UNMASK_PAGE_JS)
          } catch {
            /* ignore */
          }
          setUnmasked(true)
          setReady(true)
          setError(null)
          setStatusMsg('已切换至完整登录页，您可手动登录')
        })
    }

    const onNav = (): void => {
      const url = wv.getURL()
      if (!isAllowedNavDomain(url)) {
        console.warn('[Login] blocked navigation to unexpected domain:', url)
        void wv.loadURL(LOGIN_URL)
        return
      }
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
    setUnmasked(false)
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

      <div className={`w-full transition-all duration-300 ${unmasked ? 'max-w-xl' : 'max-w-sm'}`}>
        <header className="mb-8 text-center">
          <h1 className="text-xl font-bold text-text-1">jAccount 登录</h1>
          <p className="mt-2 text-sm text-text-3">{statusMsg}</p>
        </header>

        <div className="relative rounded-2xl border border-bd bg-surface-1 p-6 shadow-card backdrop-blur">
          <div
            className={`relative w-full rounded-xl bg-base transition-all duration-300 ${
              unmasked ? 'h-[460px] overflow-auto' : 'h-[320px] overflow-hidden'
            }`}
          >
            {!ready && !unmasked && !error && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface-1 backdrop-blur-sm">
                <Spinner size={28} />
                <div className="text-sm text-text-3">正在加载二维码…</div>
              </div>
            )}
            {error && !unmasked && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface-1 px-6 text-center backdrop-blur-sm">
                <div className="text-sm font-medium text-amber">{error}</div>
              </div>
            )}
            <webview
              ref={webviewRef as unknown as React.RefObject<HTMLElement>}
              src={LOGIN_URL}
              partition={SJTU_PARTITION}
              style={{
                width: '100%',
                height: '100%',
                background: unmasked ? '#ffffff' : 'transparent',
                opacity: ready ? 1 : 0,
                transition: 'opacity 0.2s'
              }}
            />
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-text-3">
            <span>{unmasked ? '已启用完整页面手动模式' : ready ? '二维码 60 秒后自动刷新' : ' '}</span>
            <button
              type="button"
              onClick={onReload}
              className="inline-flex items-center gap-1 text-text-3 transition-colors duration-150 hover:text-accent-light"
            >
              手动刷新 ↻
            </button>
          </div>
        </div>

        {unmasked && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-accent/20 bg-accent/5 px-4 py-3">
            <span className="mt-0.5 text-sm">ℹ️</span>
            <p className="text-xs leading-relaxed text-text-2">
              二维码自动提取超时，已为您切换为完整登录页面。您可以在上方直接切换扫码、使用账号密码登录，或点击“手动刷新”重试。
            </p>
          </div>
        )}

        <div className="mt-8 space-y-2">
          <div className="flex items-start gap-2.5 rounded-xl bg-surface-3 px-4 py-3">
            <span className="mt-0.5 text-sm">💡</span>
            <p className="text-xs leading-relaxed text-text-3">
              打开「<strong className="text-text-2">交我办</strong>」App 或微信，
              扫描上方二维码即可完成登录。
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
              请确保已连接 <strong>SJTU 校园网</strong>或<strong>交大 VPN</strong>
              ，否则无法正常登录和下载。
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
