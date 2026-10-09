// v.sjtu 认证 + 会话持久化 + REST API 客户端 (R1-F1, R1-F3, R5-F2)
//
// 持久化 session 存储在 app.getPath('userData')/session.json 中，启动时由 hydrateSjtuSession 恢复。
// 内存态保存当前 jwtToken / accountName / studentId，并在 401 时自动触发 refreshJwtToken 静默刷新。
// 遇到 429 限流时采用指数退避重试 (calculateBackoffMs)，并反馈 AIMD 限流信号 (noteRateLimited)。

import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { V_SJTU_API_BASE, V_SJTU_ORIGIN, VSJTU_JWT_LS_KEY } from '../shared/types'
import { sjtuSession } from './session'
import { setCachedUserToken } from './cloudpan'
import { calculateBackoffMs } from './download-engine/domain-guard'
import { noteRateLimited } from './concurrency'
import { sanitizeForLog } from './canvas/safe-fetch'

export interface PersistedSession {
  version: 1
  jwtToken: string | null
  accountName?: string
  studentId?: string
  expiresAt?: number
  cloudUserToken?: string
  updatedAt: number
}

export interface AuthInfo {
  loggedIn: boolean
  accountName?: string
  studentId?: string
  expiresAt?: number
  expired?: boolean
}

/** 获取 session.json 文件路径 */
function getSessionFilePath(): string {
  try {
    if (app && typeof app.getPath === 'function') {
      return join(app.getPath('userData'), 'session.json')
    }
  } catch {
    /* ignore */
  }
  return ''
}

/** 原子保存会话数据到 session.json */
export function saveSessionStore(data: Partial<PersistedSession>): void {
  const filePath = getSessionFilePath()
  if (!filePath) return
  try {
    const existing = loadSessionStoreRaw() || { version: 1, jwtToken: null, updatedAt: Date.now() }
    const merged: PersistedSession = {
      version: 1,
      jwtToken: data.jwtToken !== undefined ? data.jwtToken : (existing.jwtToken ?? null),
      accountName: data.accountName !== undefined ? data.accountName : existing.accountName,
      studentId: data.studentId !== undefined ? data.studentId : existing.studentId,
      expiresAt: data.expiresAt !== undefined ? data.expiresAt : existing.expiresAt,
      cloudUserToken: data.cloudUserToken !== undefined ? data.cloudUserToken : existing.cloudUserToken,
      updatedAt: Date.now()
    }
    const tmp = filePath + '.tmp'
    writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf-8')
    renameSync(tmp, filePath)
  } catch (err) {
    console.warn('[auth] 保存 session.json 失败:', err instanceof Error ? err.message : err)
  }
}

/** 从 session.json 读取原始会话对象，处理文件不存在或 JSON 损坏 */
export function loadSessionStoreRaw(): PersistedSession | null {
  const filePath = getSessionFilePath()
  if (!filePath || !existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as PersistedSession
  } catch (err) {
    console.warn('[auth] 读取 session.json 失败:', err instanceof Error ? err.message : err)
    return null
  }
}

/** 删除持久化 session.json 文件 */
export function clearSessionStore(): void {
  const filePath = getSessionFilePath()
  if (!filePath) return
  try {
    if (existsSync(filePath)) unlinkSync(filePath)
  } catch (err) {
    console.warn('[auth] 删除 session.json 失败:', err instanceof Error ? err.message : err)
  }
}

/** 从 JWT Token 中解析 exp 过期时间戳 (毫秒) */
export function extractJwtExpiry(token: string): number | undefined {
  try {
    const parts = token.split('.')
    if (parts.length >= 2) {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
      const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
      if (typeof payload.exp === 'number') {
        return payload.exp * 1000
      }
    }
  } catch {
    /* ignore */
  }
  return undefined
}

/** v.sjtu 的 jwt-token（内存态）。 */
let jwtToken: string | null = null

/** 当前已登录用户的显示名和学号。 */
let accountName: string | null = null
let studentId: string | null = null
let _isSessionExpired = false

let _authCache: { result: AuthInfo; ts: number } | null = null
let _refreshPromise: Promise<boolean> | null = null

/**
 * 借助 persist:sjtu session 内已有的 jAccount Cookie，通过离屏 BrowserWindow
 * 加载 v.sjtu 登录回跳页，触发 SPA 自动刷新并抽取最新 JWT。
 */
export async function refreshJwtToken(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise
  _refreshPromise = (async () => {
    try {
      const ses = sjtuSession()
      const jaCookies = await ses.cookies.get({ domain: 'jaccount.sjtu.edu.cn' })
      if (jaCookies.length === 0) {
        console.log('[auth] 无 jAccount cookie，无法静默刷新')
        return false
      }

      if (typeof BrowserWindow !== 'function') {
        return false
      }

      const win = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true }
      })

      try {
        await win.loadURL(`${V_SJTU_ORIGIN}/jy-application-resmgr-ui/#/login`)
        const deadline = Date.now() + 15_000
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 500))
          if (win.isDestroyed()) return false
          const url = win.webContents.getURL()

          // 若停留在密码登录或二维码表单页，说明 jAccount Cookie 彻底过期
          if (url.includes('jaccount.sjtu.edu.cn/jaccount/jalogin') || url.includes('/qrcode')) {
            console.log('[auth] jAccount cookie 已失效，需交互式重新登录')
            return false
          }

          const token = (await win.webContents
            .executeJavaScript(`localStorage.getItem(${JSON.stringify(VSJTU_JWT_LS_KEY)})`)
            .catch(() => null)) as string | null

          if (token && token.length > 20 && token !== jwtToken) {
            console.log('[auth] 自动刷新 JWT 成功')
            setJwtToken(token)
            return true
          }
        }
        return false
      } finally {
        if (!win.isDestroyed()) win.destroy()
      }
    } catch (err) {
      console.warn('[auth] 静默刷新异常:', err)
      return false
    }
  })()

  try {
    return await _refreshPromise
  } finally {
    _refreshPromise = null
  }
}

/** 从 /cloud-rbac/authority/me 的 result 中取用户显示名和学号。 */
export function pickAccountInfo(result: unknown): { name?: string; studentId?: string } {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    if (r.user && typeof r.user === 'object') {
      const u = r.user as Record<string, unknown>
      const name = typeof u.name === 'string' && u.name.trim() ? u.name.trim() : undefined
      const studentId =
        typeof u.username === 'string' && u.username.trim()
          ? u.username.trim()
          : typeof u.code === 'string' && u.code.trim()
            ? u.code.trim()
            : undefined
      return { name, studentId }
    }
  }
  return {}
}

const AUTH_429_MAX_RETRIES = 3

/**
 * 登录判定：先看 sjtu cookie，再用 jwt 敲 /authority/me 验真。
 * 具备本地过期提前感知、401 自动刷新以及 429 指数退避重试能力。
 */
export async function getAuthInfo(): Promise<AuthInfo> {
  if (_authCache && Date.now() - _authCache.ts < 300_000) return _authCache.result

  const cookies = await sjtuSession().cookies.get({ domain: 'sjtu.edu.cn' })
  if (cookies.length === 0) {
    _authCache = { result: { loggedIn: false, expired: _isSessionExpired }, ts: Date.now() }
    return _authCache.result
  }

  // 本地预检：如果记录了过期时间且已失效，先尝试自动刷新
  const saved = loadSessionStoreRaw()
  if (saved?.expiresAt && Date.now() > saved.expiresAt) {
    console.log('[auth] 本地检测到 JWT 已过期，尝试自动刷新…')
    const refreshed = await refreshJwtToken()
    if (!refreshed) {
      _isSessionExpired = true
      _authCache = { result: { loggedIn: false, expired: true }, ts: Date.now() }
      return _authCache.result
    }
  }

  const url = `${V_SJTU_ORIGIN}/cloud-rbac/authority/me`
  for (let attempt = 0; attempt <= AUTH_429_MAX_RETRIES; attempt++) {
    try {
      let resp = await sjtuSession().fetch(url, {
        method: 'GET',
        headers: vsjtuHeaders()
      })

      // 401: 凭据失效，尝试自动刷新
      if (resp.status === 401) {
        console.log('[auth] /authority/me 返回 401，尝试刷新凭据…')
        const ok = await refreshJwtToken()
        if (ok) {
          resp = await sjtuSession().fetch(url, {
            method: 'GET',
            headers: vsjtuHeaders()
          })
        }
      }

      // 429: 限流退避
      if (resp.status === 429) {
        noteRateLimited()
        try {
          await resp.text()
        } catch {
          /* ignore */
        }
        if (attempt < AUTH_429_MAX_RETRIES) {
          const delay = calculateBackoffMs(resp.headers.get('retry-after'), attempt + 1)
          console.warn(
            `[getAuthInfo] 触发 429 限流，${Math.round(delay / 1000)}s 后重试 (${attempt + 1}/${AUTH_429_MAX_RETRIES})`
          )
          await new Promise(r => setTimeout(r, delay))
          continue
        }
        // 限流耗尽时不污染为未登录，保留现有有效缓存
        if (_authCache?.result.loggedIn) return _authCache.result
        return { loggedIn: false, expired: _isSessionExpired }
      }

      if (!resp.ok) {
        _isSessionExpired = resp.status === 401
        _authCache = { result: { loggedIn: false, expired: _isSessionExpired }, ts: Date.now() }
        return _authCache.result
      }

      const text = await resp.text()
      const json = JSON.parse(text) as { code?: string; result?: unknown }
      const ok = json?.code === '0'
      const info = ok ? pickAccountInfo(json?.result) : {}
      const exp = jwtToken ? extractJwtExpiry(jwtToken) : undefined

      if (ok) {
        accountName = info.name ?? null
        studentId = info.studentId ?? null
        _isSessionExpired = false
        saveSessionStore({
          accountName: accountName ?? undefined,
          studentId: studentId ?? undefined,
          expiresAt: exp
        })
      }

      _authCache = {
        result: {
          loggedIn: ok,
          accountName: info.name,
          studentId: info.studentId,
          expiresAt: exp,
          expired: !ok && _isSessionExpired
        },
        ts: Date.now()
      }
      return _authCache.result
    } catch {
      if (attempt < AUTH_429_MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
        continue
      }
      _authCache = { result: { loggedIn: false, expired: _isSessionExpired }, ts: Date.now() }
      return _authCache.result
    }
  }

  return { loggedIn: false, expired: _isSessionExpired }
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

const VSJTU_FETCH_MAX_RETRIES = 4

export async function vsjtuFetch(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<unknown> {
  const doRequest = async () => {
    const headers = vsjtuHeaders()
    if (init?.body !== undefined) headers['Content-Type'] = 'application/json;charset=UTF-8'
    const url = `${V_SJTU_API_BASE}${path}`
    return await sjtuSession().fetch(url, {
      method: init?.method || 'GET',
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined
    })
  }

  for (let attempt = 0; attempt <= VSJTU_FETCH_MAX_RETRIES; attempt++) {
    let resp: Response
    try {
      resp = await doRequest()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|net::/i.test(msg)) {
        throw new Error(`DNS 解析失败，无法连接到 v.sjtu.edu.cn，请检查网络连接`)
      }
      throw err
    }

    // 401 自动刷新重试
    if (resp.status === 401) {
      console.log(`[auth] vsjtuFetch ${path} 返回 401，尝试自动刷新 JWT…`)
      const refreshed = await refreshJwtToken()
      if (refreshed) {
        try {
          resp = await doRequest()
        } catch (retryErr) {
          throw retryErr
        }
      } else {
        _isSessionExpired = true
      }
    }

    // 429 限流退避重试
    if (resp.status === 429) {
      noteRateLimited()
      try {
        await resp.text()
      } catch {
        /* ignore */
      }
      if (attempt < VSJTU_FETCH_MAX_RETRIES) {
        const delay = calculateBackoffMs(resp.headers.get('retry-after'), attempt + 1)
        console.warn(
          `[vsjtuFetch] 触发 429 限流，${Math.round(delay / 1000)}s 后重试 (${attempt + 1}/${VSJTU_FETCH_MAX_RETRIES}): ${sanitizeForLog(path)}`
        )
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      throw new Error(`v.sjtu API 限流重试耗尽 (HTTP 429): ${path}`)
    }

    const text = await resp.text()
    try {
      const json = JSON.parse(text)
      if (
        json?.code === '401' ||
        json?.message?.includes('未登录') ||
        json?.message?.includes('登录已过期')
      ) {
        _isSessionExpired = true
      }
      return json
    } catch {
      return { __raw: text, __status: resp.status }
    }
  }

  throw new Error(`v.sjtu 请求失败: ${path}`)
}

/** 设置 JWT Token 并持久化保存 */
export function setJwtToken(token: string | null): void {
  jwtToken = token && token.length > 20 ? token : null
  _authCache = null
  _isSessionExpired = false
  const expiresAt = jwtToken ? extractJwtExpiry(jwtToken) : undefined
  saveSessionStore({ jwtToken, expiresAt })
}

export function getAccountName(): string | null {
  return accountName
}

export function getStudentId(): string | null {
  return studentId
}

/** 重置所有内存态认证状态并删除持久化 session.json */
export function clearAuthState(): void {
  jwtToken = null
  _authCache = null
  accountName = null
  studentId = null
  _isSessionExpired = false
  clearSessionStore()
}

/**
 * 启动时从持久化存储恢复 SJTU 会话 (R1-F1, R1-F3)
 */
export async function hydrateSjtuSession(): Promise<AuthInfo> {
  console.log('[auth] 正在从持久化存储恢复 SJTU 会话…')
  try {
    await sjtuSession().cookies.flushStore()
  } catch {
    /* ignore */
  }

  const saved = loadSessionStoreRaw()
  if (!saved || !saved.jwtToken) {
    console.log('[auth] 未找到持久化 session.json，需扫码登录')
    return { loggedIn: false }
  }

  jwtToken = saved.jwtToken
  accountName = saved.accountName ?? null
  studentId = saved.studentId ?? null

  // 恢复主进程缓存的云盘 token
  if (saved.cloudUserToken) {
    setCachedUserToken(saved.cloudUserToken)
  }

  // 启动时强制重新验证
  _authCache = null
  const auth = await getAuthInfo()
  if (!auth.loggedIn && !auth.expired) {
    const refreshed = await refreshJwtToken()
    if (refreshed) {
      _authCache = null
      return await getAuthInfo()
    }
  }

  return auth
}
