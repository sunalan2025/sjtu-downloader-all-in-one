import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/app'
import { SJTU_PARTITION, VSJTU_JWT_LS_KEY, type MaskedCredential } from '@shared/types'
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
      overflow-x: hidden !important;
      overflow-y: auto !important;
      scrollbar-width: none !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif !important;
      -webkit-font-smoothing: antialiased !important;
    }

    ::-webkit-scrollbar {
      display: none !important;
      width: 0 !important;
      height: 0 !important;
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
      min-height: 100% !important;
      height: auto !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      overflow: visible !important;
    }

    /* 核心卡片容器：支持 flex-wrap，自适应顶部提示与下层双栏（扫码 + 账密/二次验证） */
    #login-form.login-card,
    .login-card,
    .login-box {
      display: flex !important;
      flex-flow: row wrap !important;
      align-items: center !important;
      justify-content: center !important;
      box-shadow: none !important;
      border: none !important;
      margin: 0 auto !important;
      padding: 0 !important;
      background: transparent !important;
      background-color: transparent !important;
      width: 100% !important;
      max-width: 540px !important;
      box-sizing: border-box !important;
    }

    /* 顶部提示栏（如二次验证说明、推送确认等非扫码和非表单的直接子元素）：独占第一行全宽并居中 */
    #login-form > :not(.login-qr):not(.form-login):not(script):not(style),
    .confirm-title,
    .confirm-msg,
    .confirm-msg-left {
      width: 100% !important;
      flex: 0 0 100% !important;
      text-align: center !important;
      margin: 0 0 16px 0 !important;
      padding: 0 12px !important;
      order: 1 !important;
      box-sizing: border-box !important;
      color: var(--theme-text) !important;
    }

    #login-form > :not(.login-qr):not(.form-login) h1,
    #login-form > :not(.login-qr):not(.form-login) h2,
    #login-form > :not(.login-qr):not(.form-login) h3,
    #login-form > :not(.login-qr):not(.form-login) strong {
      font-size: 16px !important;
      font-weight: 600 !important;
      color: var(--theme-text) !important;
      margin-bottom: 4px !important;
      line-height: 1.4 !important;
    }

    #login-form > :not(.login-qr):not(.form-login) p,
    #login-form > :not(.login-qr):not(.form-login) span {
      font-size: 13px !important;
      color: var(--theme-text-sub) !important;
      line-height: 1.5 !important;
    }

    /* 左侧二维码扫码专区：第二行左侧 */
    .login-qr {
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      order: 2 !important;
      float: none !important;
      flex: 0 0 210px !important;
      width: 210px !important;
      min-width: 210px !important;
      margin: 0 !important;
      padding: 4px 20px 4px 0 !important;
      border-right: 1px solid var(--theme-border) !important;
      box-sizing: border-box !important;
    }

    .login-qr .qr-title {
      font-size: 14px !important;
      font-weight: 600 !important;
      margin-bottom: 10px !important;
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
      width: 170px !important;
      height: 170px !important;
      padding: 5px !important;
      background: var(--theme-qr-bg) !important;
      border-radius: 12px !important;
      border: 1px solid var(--theme-qr-border) !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05) !important;
      box-sizing: border-box !important;
    }

    #qr-img {
      display: block !important;
      width: 156px !important;
      height: 156px !important;
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

    /* 右侧表单专区（账号密码 / 短信 / 二次验证）：第二行右侧 */
    .form-login {
      display: flex !important;
      flex-direction: column !important;
      justify-content: center !important;
      order: 3 !important;
      float: none !important;
      flex: 0 0 260px !important;
      width: 260px !important;
      min-width: 260px !important;
      margin: 0 !important;
      padding: 4px 0 4px 20px !important;
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

    /* 登录/提交按钮 */
    .form-submit,
    .btn-primary,
    input[type="submit"],
    button[type="submit"],
    input[value="提交"],
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
      margin-top: 8px !important;
    }

    .form-submit:hover,
    .btn-primary:hover,
    input[type="submit"]:hover,
    button[type="submit"]:hover,
    #submit-password-button:hover,
    #submit-sms-button:hover {
      opacity: 0.9 !important;
    }

    .form-submit:active,
    .btn-primary:active,
    input[type="submit"]:active,
    button[type="submit"]:active,
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

    /* 二次验证 (2FA) 细部交互适配 */
    .form-login input[type="radio"] {
      accent-color: var(--theme-accent) !important;
      margin-right: 8px !important;
      cursor: pointer !important;
      vertical-align: middle !important;
    }

    .form-login input[type="checkbox"] {
      accent-color: var(--theme-accent) !important;
      margin-right: 8px !important;
      cursor: pointer !important;
      vertical-align: middle !important;
    }

    .form-select,
    .form-login .radio-group,
    .form-login .form-group,
    .form-login label:has(input[type="radio"]),
    .form-login div:has(input[type="radio"]) {
      font-size: 13px !important;
      color: var(--theme-text) !important;
      cursor: pointer !important;
      display: inline-flex !important;
      align-items: center !important;
      margin-bottom: 24px !important;
    }

    .form-login label:has(input[type="checkbox"]),
    .form-login div:has(input[type="checkbox"]) {
      font-size: 12px !important;
      color: var(--theme-text-sub) !important;
      margin: 12px 0 10px 0 !important;
      display: flex !important;
      align-items: center !important;
      cursor: pointer !important;
    }

    /* 气泡提示自适应，避免与上方单选框遮挡 */
    .tooltip-wrapper {
      z-index: 100 !important;
      margin-bottom: 2px !important;
    }

    .tooltip {
      border-radius: 6px !important;
      font-size: 12px !important;
      line-height: 1.4 !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08) !important;
      background-color: ${isDark ? 'rgba(34, 197, 94, 0.15)' : '#f0f9eb'} !important;
      border-color: ${isDark ? 'rgba(34, 197, 94, 0.5)' : '#67c23a'} !important;
    }

    .tooltip-message {
      color: ${isDark ? '#4ade80' : '#67c23a'} !important;
      font-size: 12px !important;
    }

    .tooltip-arrow:after {
      border-top-color: ${isDark ? 'rgba(34, 197, 94, 0.5)' : '#67c23a'} !important;
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

/**
 * 生成在 jAccount 认证页面中执行的安全自动填充与多账号悬浮面板脚本：
 * 1. 捕获表单输入与提交事件：通过 __SJTU_CRED_CAPTURED__ 通知宿主；
 * 2. 单账号时：自动将用户名与密码安全回填至对应输入框；
 * 3. 多账号时：默认回填最近账号，并在用户名输入框容器注入 Chrome/Edge 风格原生悬浮卡片；
 *    点击任一账号触发 __SJTU_CRED_SELECT__，点击删除按钮触发 __SJTU_CRED_DELETE__；
 * 4. 关键安全与交互准则：绝不自动提交表单！仅填充输入框。
 */
export function getAutofillScript(
  accounts: MaskedCredential[],
  isDark: boolean,
  defaultFill?: { username?: string; password?: string } | null
): string {
  const jsonAccounts = JSON.stringify(accounts)
  const jsonDefaultFill = JSON.stringify(defaultFill || null)
  const darkBool = Boolean(isDark)

  return `(() => {
  try {
    const accounts = ${jsonAccounts};
    const defaultFill = ${jsonDefaultFill};
    const isDark = ${darkBool};

    function setInputValue(el, val) {
      if (!el || val == null) return;
      try {
        el.focus();
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (desc && desc.set) {
          desc.set.call(el, val);
        } else {
          el.value = val;
        }
      } catch (e) {
        el.value = val;
      }
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    }

    function findUserEl() {
      return document.querySelector('#input-login-user, #user, input[name="user"], input[name="username"]');
    }
    function findPassEl() {
      return document.querySelector('#input-login-pass, #pass, input[name="pass"], input[type="password"]');
    }

    window.__sjtuFillCred = function(username, password) {
      const uEl = findUserEl();
      const pEl = findPassEl();
      if (uEl && username) setInputValue(uEl, username);
      if (pEl && password) setInputValue(pEl, password);
    };

    function captureCredentials() {
      const uEl = findUserEl();
      const pEl = findPassEl();
      if (uEl && pEl) {
        const user = (uEl.value || '').trim();
        const pass = pEl.value || '';
        if (user && pass) {
          console.log('__SJTU_CRED_CAPTURED__:' + JSON.stringify({ user, pass }));
        }
      }
    }

    if (!window.__sjtuCaptureBound) {
      window.__sjtuCaptureBound = true;

      document.addEventListener('submit', function() {
        captureCredentials();
      }, true);

      document.addEventListener('click', function(e) {
        const target = e.target;
        if (target && typeof target.closest === 'function') {
          const btn = target.closest('#submit-password-button, #submit-sms-button, input[type="submit"], button[type="submit"], .form-submit, .btn-primary');
          if (btn) {
            captureCredentials();
          }
        }
      }, true);

      document.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          const uEl = findUserEl();
          const pEl = findPassEl();
          if (document.activeElement === uEl || document.activeElement === pEl) {
            captureCredentials();
          }
        }
      }, true);
    }

    function performAutofill() {
      if (defaultFill && defaultFill.username) {
        const uEl = findUserEl();
        const pEl = findPassEl();
        if (uEl) setInputValue(uEl, defaultFill.username);
        if (pEl && defaultFill.password) setInputValue(pEl, defaultFill.password);
      }
    }
    performAutofill();
    setTimeout(performAutofill, 150);
    setTimeout(performAutofill, 400);

    function renderDropdown(accs) {
      const oldDropdown = document.getElementById('__sjtu_cred_dropdown');
      if (oldDropdown) oldDropdown.remove();
      const oldToggle = document.getElementById('__sjtu_cred_toggle');
      if (oldToggle) oldToggle.remove();

      if (!accs || accs.length <= 1) return;

      const userEl = findUserEl();
      if (!userEl) return;

      const container = userEl.closest('.input-control') || userEl.parentElement;
      if (!container) return;

      if (window.getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }

      userEl.style.paddingRight = '68px';

      const bg = isDark ? '#232323' : '#FFFFFF';
      const text = isDark ? '#F5F5F5' : '#1D2129';
      const textSub = isDark ? '#A0A0A0' : '#86909C';
      const border = isDark ? '#3D3D3D' : '#E5E6EB';
      const hoverBg = isDark ? '#2D2D2D' : '#F2F3F5';
      const shadow = isDark ? '0 8px 24px rgba(0,0,0,0.5)' : '0 8px 24px rgba(0,0,0,0.12)';
      const accent = isDark ? '#4080FF' : '#165DFF';
      const badgeBg = isDark ? 'rgba(64,128,255,0.18)' : 'rgba(22,93,255,0.08)';
      const badgeColor = isDark ? '#69B1FF' : '#165DFF';

      const toggle = document.createElement('div');
      toggle.id = '__sjtu_cred_toggle';
      toggle.title = '切换已保存的 jAccount 账号';
      toggle.style.position = 'absolute';
      toggle.style.right = '8px';
      toggle.style.top = '50%';
      toggle.style.transform = 'translateY(-50%)';
      toggle.style.zIndex = '5';
      toggle.style.fontSize = '11px';
      toggle.style.fontWeight = '500';
      toggle.style.padding = '2px 7px';
      toggle.style.borderRadius = '4px';
      toggle.style.background = badgeBg;
      toggle.style.color = badgeColor;
      toggle.style.cursor = 'pointer';
      toggle.style.userSelect = 'none';
      toggle.style.display = 'flex';
      toggle.style.alignItems = 'center';
      toggle.style.gap = '3px';
      toggle.style.transition = 'opacity 0.15s';

      const toggleSpan = document.createElement('span');
      toggleSpan.textContent = accs.length + '个账号';
      const arrowSpan = document.createElement('span');
      arrowSpan.style.fontSize = '9px';
      arrowSpan.textContent = '▼';
      toggle.appendChild(toggleSpan);
      toggle.appendChild(arrowSpan);
      container.appendChild(toggle);

      const dropdown = document.createElement('div');
      dropdown.id = '__sjtu_cred_dropdown';
      dropdown.style.position = 'absolute';
      dropdown.style.top = 'calc(100% + 4px)';
      dropdown.style.left = '0';
      dropdown.style.width = '100%';
      dropdown.style.boxSizing = 'border-box';
      dropdown.style.background = bg;
      dropdown.style.border = '1px solid ' + border;
      dropdown.style.borderRadius = '10px';
      dropdown.style.boxShadow = shadow;
      dropdown.style.zIndex = '99999';
      dropdown.style.display = 'none';
      dropdown.style.maxHeight = '220px';
      dropdown.style.overflowY = 'auto';
      dropdown.style.fontFamily = 'inherit';

      accs.forEach(function(acc) {
        const itemEl = document.createElement('div');
        itemEl.className = '__sjtu_cred_item';
        itemEl.setAttribute('data-id', acc.id);
        itemEl.style.display = 'flex';
        itemEl.style.alignItems = 'center';
        itemEl.style.justifyContent = 'space-between';
        itemEl.style.padding = '8px 12px';
        itemEl.style.cursor = 'pointer';
        itemEl.style.borderBottom = '1px solid ' + border;
        itemEl.style.transition = 'background 0.12s';

        const infoEl = document.createElement('div');
        infoEl.style.flex = '1';
        infoEl.style.minWidth = '0';
        infoEl.style.paddingRight = '8px';

        const topRow = document.createElement('div');
        topRow.style.display = 'flex';
        topRow.style.alignItems = 'center';
        topRow.style.gap = '6px';
        topRow.style.marginBottom = '2px';

        const userSpan = document.createElement('span');
        userSpan.style.fontSize = '13px';
        userSpan.style.fontWeight = '600';
        userSpan.style.color = text;
        userSpan.style.overflow = 'hidden';
        userSpan.style.textOverflow = 'ellipsis';
        userSpan.style.whiteSpace = 'nowrap';
        userSpan.textContent = acc.username;
        topRow.appendChild(userSpan);

        if (acc.label) {
          const labelBadge = document.createElement('span');
          labelBadge.style.fontSize = '10px';
          labelBadge.style.padding = '1px 5px';
          labelBadge.style.borderRadius = '4px';
          labelBadge.style.background = badgeBg;
          labelBadge.style.color = badgeColor;
          labelBadge.style.fontWeight = '500';
          labelBadge.textContent = acc.label;
          topRow.appendChild(labelBadge);
        }
        infoEl.appendChild(topRow);

        const botRow = document.createElement('div');
        botRow.style.fontSize = '11px';
        botRow.style.color = textSub;
        botRow.style.display = 'flex';
        botRow.style.alignItems = 'center';
        botRow.style.gap = '4px';

        const passSpan = document.createElement('span');
        passSpan.style.letterSpacing = '1px';
        passSpan.textContent = acc.maskedPassword || '••••••••';
        botRow.appendChild(passSpan);
        infoEl.appendChild(botRow);

        itemEl.appendChild(infoEl);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = '__sjtu_cred_del_btn';
        delBtn.setAttribute('data-id', acc.id);
        delBtn.title = '删除此账号';
        delBtn.textContent = '✕';
        delBtn.style.background = 'transparent';
        delBtn.style.border = 'none';
        delBtn.style.color = textSub;
        delBtn.style.cursor = 'pointer';
        delBtn.style.padding = '4px 6px';
        delBtn.style.borderRadius = '4px';
        delBtn.style.fontSize = '13px';
        delBtn.style.lineHeight = '1';
        delBtn.style.transition = 'all 0.12s';

        delBtn.onmouseenter = function() {
          delBtn.style.color = '#FF4D4F';
          delBtn.style.background = isDark ? 'rgba(255,77,79,0.2)' : 'rgba(255,77,79,0.1)';
        };
        delBtn.onmouseleave = function() {
          delBtn.style.color = textSub;
          delBtn.style.background = 'transparent';
        };
        delBtn.onclick = function(e) {
          e.stopPropagation();
          console.log('__SJTU_CRED_DELETE__:' + acc.id);
          itemEl.remove();
          const remaining = dropdown.querySelectorAll('.__sjtu_cred_item');
          if (remaining.length <= 1) {
            dropdown.remove();
            toggle.remove();
            userEl.style.paddingRight = '10px';
          } else {
            toggleSpan.textContent = remaining.length + '个账号';
          }
        };

        itemEl.appendChild(delBtn);

        itemEl.onmouseenter = function() {
          itemEl.style.background = hoverBg;
        };
        itemEl.onmouseleave = function() {
          itemEl.style.background = 'transparent';
        };
        itemEl.onclick = function(e) {
          if (e.target && e.target.closest('.__sjtu_cred_del_btn')) return;
          console.log('__SJTU_CRED_SELECT__:' + acc.id);
          closeMenu();
        };

        dropdown.appendChild(itemEl);
      });

      const newAccEl = document.createElement('div');
      newAccEl.className = '__sjtu_cred_new_acc';
      newAccEl.style.display = 'flex';
      newAccEl.style.alignItems = 'center';
      newAccEl.style.gap = '6px';
      newAccEl.style.padding = '8px 12px';
      newAccEl.style.cursor = 'pointer';
      newAccEl.style.fontSize = '12px';
      newAccEl.style.color = accent;
      newAccEl.style.fontWeight = '500';
      newAccEl.style.transition = 'background 0.12s';
      newAccEl.innerHTML = '<span>+</span><span>使用其他账号登录</span>';
      newAccEl.onmouseenter = function() {
        newAccEl.style.background = hoverBg;
      };
      newAccEl.onmouseleave = function() {
        newAccEl.style.background = 'transparent';
      };
      newAccEl.onclick = function() {
        const uEl = findUserEl();
        const pEl = findPassEl();
        if (uEl) {
          setInputValue(uEl, '');
          uEl.focus();
        }
        if (pEl) {
          setInputValue(pEl, '');
        }
        closeMenu();
      };
      dropdown.appendChild(newAccEl);

      container.appendChild(dropdown);

      function openMenu() {
        dropdown.style.display = 'block';
      }
      function closeMenu() {
        dropdown.style.display = 'none';
      }
      function toggleMenu() {
        if (dropdown.style.display === 'block') {
          closeMenu();
        } else {
          openMenu();
        }
      }

      toggle.onclick = function(e) {
        e.stopPropagation();
        toggleMenu();
      };
      userEl.onfocus = function() {
        openMenu();
      };
      userEl.onclick = function(e) {
        e.stopPropagation();
        openMenu();
      };

      document.addEventListener('click', function(e) {
        if (!dropdown.contains(e.target) && e.target !== userEl && !toggle.contains(e.target)) {
          closeMenu();
        }
      });

      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeMenu();
      });
    }

    renderDropdown(accounts);

    window.__sjtuUpdateAccounts = function(updatedAccs) {
      renderDropdown(updatedAccs);
    };
  } catch (err) {
    console.error('[SJTU-Autofill] error in injected script:', err);
  }
})()`;
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

  const capturedCredRef = useRef<{ username: string; password: string } | null>(null)
  const [pendingSaveCred, setPendingSaveCred] = useState<{
    username: string
    password: string
    defaultLabel?: string
  } | null>(null)
  const [customLabel, setCustomLabel] = useState('')
  const [isSavingCred, setIsSavingCred] = useState(false)

  const navigateToBrowser = useCallback(() => {
    const hasCompleted = useAppStore.getState().hasCompletedInitialSetup
    if (!hasCompleted) {
      useAppStore.getState().setActiveTab('settings')
    } else {
      const currentTab = useAppStore.getState().activeTab
      if (currentTab === 'settings' || currentTab === 'transfer') {
        useAppStore.getState().setActiveTab(useAppStore.getState().lastCourseTab || 'canvas')
      }
    }
    setStage('browser')
  }, [setStage])

  const proceedAfterLogin = useCallback(async (): Promise<void> => {
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

  const onConsoleMsg = useCallback(
    (e: any): void => {
      const msg = (e && typeof e.message === 'string' ? e.message : '') as string
      if (msg.startsWith('__SJTU_CRED_CAPTURED__:')) {
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
      }
    },
    [handleDeleteAccountFromWebview, handleSelectAccount]
  )

  const injectAutofill = useCallback(async (): Promise<void> => {
    const wv = webviewRef.current
    if (!wv) return
    try {
      const accounts = await window.api.credentials.list()
      let defaultFill: { username?: string; password?: string } | null = null
      if (accounts.length > 0) {
        const fillRes = await window.api.credentials.getFillData(accounts[0].id)
        if (fillRes.ok && fillRes.username && fillRes.password) {
          defaultFill = { username: fillRes.username, password: fillRes.password }
        }
      }
      const script = getAutofillScript(accounts, isDarkRef.current, defaultFill)
      await wv.executeJavaScript(script)
    } catch (err) {
      console.error('[Login] failed to inject autofill script:', err)
    }
  }, [])

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
      if (url.includes('jaccount.sjtu.edu.cn')) {
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
              setReady(false)
              setStatusMsg('登录成功，正在进入主页…')
              void handleLoginCompletion()
              return
            }

            if (url.includes('jaccount.sjtu.edu.cn')) {
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
        void updateAuthStatus()
        void injectAutofill()
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
        void updateAuthStatus()
        void injectAutofill()
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
          <div className="relative h-[415px] min-h-[380px] w-full overflow-hidden rounded-xl bg-surface-1">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-bd bg-surface-1 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-lg text-accent">
                🔐
              </div>
              <div>
                <h3 className="text-base font-semibold text-text-1">记住此账号密码？</h3>
                <p className="text-xs text-text-3">下次登录将自动为您填好，安全便捷</p>
              </div>
            </div>

            <div className="rounded-xl border border-bd bg-surface-2 p-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-3">登录账号</span>
                <span className="font-mono font-medium text-text-1">{pendingSaveCred.username}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-3">密码保护</span>
                <span className="font-medium text-emerald-500">🛡️ 系统硬件级加密保护</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-text-2">
                账号备注别名 <span className="font-normal text-text-3">(可选)</span>
              </label>
              <input
                type="text"
                value={customLabel}
                onChange={e => setCustomLabel(e.target.value)}
                placeholder="例如：本科账号、研究生账号、科研账号"
                maxLength={30}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') void handleConfirmSaveCred()
                  if (e.key === 'Escape') handleSkipSaveCred()
                }}
                className="w-full rounded-lg border border-bd bg-surface-2 px-3 py-2 text-xs text-text-1 placeholder-text-3 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={isSavingCred}
                onClick={handleSkipSaveCred}
                className="flex-1 rounded-xl border border-bd bg-surface-2 py-2 text-xs font-medium text-text-2 transition hover:bg-surface-3 disabled:opacity-50"
              >
                暂不保存
              </button>
              <button
                type="button"
                disabled={isSavingCred}
                onClick={() => void handleConfirmSaveCred()}
                className="flex-1 rounded-xl bg-accent py-2 text-xs font-medium text-white shadow-sm transition hover:bg-accent-hover disabled:opacity-50"
              >
                {isSavingCred ? '正在保存…' : '记住此账号'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
