// v.sjtu 认证 + REST API 客户端
//
// jwtToken 由 renderer 在登录回跳后从 webview localStorage 抽取并经 IPC 推过来（auth:set-jwt-token），
// 只放内存，进程退出即丢。accountName/studentId 由 getAuthInfo 登录成功时从 /authority/me 抽取并缓存，
// 供托盘菜单 / auth:status 读取。getAuthInfo 5min 缓存避免快速重启时重复网络验真。

import { V_SJTU_API_BASE, V_SJTU_ORIGIN } from '../shared/types'
import { sjtuSession } from './session'

/** v.sjtu 的 jwt-token（内存态，进程退出即丢）。 */
let jwtToken: string | null = null

/** 当前已登录用户的显示名和学号（getAuthInfo 成功时写入，clearAuthState 重置）。 */
let accountName: string | null = null
let studentId: string | null = null

export interface AuthInfo { loggedIn: boolean; accountName?: string; studentId?: string }
let _authCache: { result: AuthInfo; ts: number } | null = null

/** 从 /cloud-rbac/authority/me 的 result 中取用户显示名和学号。
 *  API 结构: { result: { user: { name: "真实姓名", username: "学号", code: "学号" } } } */
export function pickAccountInfo(result: unknown): { name?: string; studentId?: string } {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    if (r.user && typeof r.user === 'object') {
      const u = r.user as Record<string, unknown>
      const name = typeof u.name === 'string' && u.name.trim() ? u.name.trim() : undefined
      const studentId = typeof u.username === 'string' && u.username.trim() ? u.username.trim()
        : typeof u.code === 'string' && u.code.trim() ? u.code.trim() : undefined
      return { name, studentId }
    }
  }
  return {}
}

/** 登录判定：先看 sjtu cookie，再用 jwt 敲 /authority/me 验真。
 *  cloud-rbac 单接受 cookie 即可，但拿到 jwt 才能调 resmgr 系列。
 *  PERF: cache auth result for 5 minutes to skip network round-trip on fast restarts.
 *  同时从 /authority/me 的 result.user 中抽取真实姓名和学号供 UI/托盘显示。 */
export async function getAuthInfo(): Promise<AuthInfo> {
  if (_authCache && Date.now() - _authCache.ts < 300_000) return _authCache.result
  const cookies = await sjtuSession().cookies.get({ domain: 'sjtu.edu.cn' })
  if (cookies.length === 0) {
    _authCache = { result: { loggedIn: false }, ts: Date.now() }
    return _authCache.result
  }
  try {
    const resp = await sjtuSession().fetch(`${V_SJTU_ORIGIN}/cloud-rbac/authority/me`, {
      method: 'GET',
      headers: vsjtuHeaders()
    })
    const text = await resp.text()
    if (!resp.ok) {
      _authCache = { result: { loggedIn: false }, ts: Date.now() }
      return _authCache.result
    }
    const json = JSON.parse(text) as { code?: string; result?: unknown }
    const ok = json?.code === '0'
    const info = ok ? pickAccountInfo(json?.result) : {}
    _authCache = { result: { loggedIn: ok, accountName: info.name, studentId: info.studentId }, ts: Date.now() }
    if (ok) {
      accountName = info.name ?? null
      studentId = info.studentId ?? null
    }
    return _authCache.result
  } catch {
    _authCache = { result: { loggedIn: false }, ts: Date.now() }
    return _authCache.result
  }
}

export function vsjtuHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    Origin: V_SJTU_ORIGIN,
    Referer: `${V_SJTU_ORIGIN}/jy-application-resmgr-ui/`
  }
  if (jwtToken) headers['jwt-token'] = jwtToken
  return headers
}

export async function vsjtuFetch(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<unknown> {
  const headers = vsjtuHeaders()
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json;charset=UTF-8'
  const url = `${V_SJTU_API_BASE}${path}`
  let resp: Response
  try {
    resp = await sjtuSession().fetch(url, {
      method: init?.method || 'GET',
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|net::/i.test(msg)) {
      throw new Error(`DNS 解析失败，无法连接到 v.sjtu.edu.cn，请检查网络连接`)
    }
    throw err
  }
  const text = await resp.text()
  try {
    return JSON.parse(text)
  } catch {
    return { __raw: text, __status: resp.status }
  }
}

export function setJwtToken(token: string | null): void {
  jwtToken = token && token.length > 20 ? token : null
  _authCache = null // JWT 变化后必须重新验证登录态
}

export function getAccountName(): string | null {
  return accountName
}

export function getStudentId(): string | null {
  return studentId
}

/** 重置所有内存态认证状态（jwtToken / accountName / studentId / auth 缓存）。
 *  logout + 启动清凭证 + B5 的 clearSjtuSession 编排调用。 */
export function clearAuthState(): void {
  jwtToken = null
  _authCache = null
  accountName = null
  studentId = null
}
