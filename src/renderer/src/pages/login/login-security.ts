/**
 * 登录安全校验与网关路由常量
 */

export const JACCOUNT_AUTH_URL =
  'https://jaccount.sjtu.edu.cn/oauth2/authorize?response_type=code&scope=openid&client_id=pmZTZ9QZEAwXGLGheU99&redirect_uri=https%3A%2F%2Fv.sjtu.edu.cn%2F%23%2Flogin'

export type WebviewElement = HTMLElement & {
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

export const ALLOWED_NAV_DOMAINS = ['sjtu.edu.cn', 'sjtu.cn']

export function isAllowedNavDomain(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    const host = u.hostname
    return ALLOWED_NAV_DOMAINS.some(d => host === d || host.endsWith('.' + d))
  } catch {
    return false
  }
}

export function isTrustedJAccountOrigin(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    return u.protocol === 'https:' && u.hostname === 'jaccount.sjtu.edu.cn'
  } catch {
    return false
  }
}

/** 准确判定是否属于已成功通过 jAccount 认证的回调或进入主页 */
export function isLoginSuccessUrl(url: string): boolean {
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
