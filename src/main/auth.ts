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

/** 从 JWT Token 中解析 Claims Payload */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = Buffer.from(base64, 'base64').toString('utf8')
    return JSON.parse(payload) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 从 JWT Token 中解析 exp 过期时间戳 (毫秒) */
export function extractJwtExpiry(token: string): number | undefined {
  const claims = decodeJwtClaims(token)
  if (claims && typeof claims.exp === 'number') {
    return claims.exp * 1000
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
 * 通过 OAuth2 授权回调所携带的 code，直接向交大视频后台换取最新的有效 JWT Token。
 * 此端点为官方单页应用换取 Token 的真实底层接口，耗时 < 100ms，无需等待繁重的 SPA 页面加载与 JS 执行。
 */
export async function exchangeVsjtuJwtByCode(code: string): Promise<string | null> {
  if (!code) return null
  try {
    const url = `${V_SJTU_API_BASE}/sso/login?code=${encodeURIComponent(code)}`
    const resp = await sjtuSession().fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
        Origin: V_SJTU_ORIGIN,
        Referer: `${V_SJTU_ORIGIN}/jy-application-resmgr-ui/`
      }
    })
    if (!resp.ok) return null
    const text = await resp.text()
    const json = JSON.parse(text) as { code?: string; data?: { jwt_token?: string } }
    if (json?.code === '0' && json?.data?.jwt_token) {
      const token = json.data.jwt_token
      console.log('[auth] 成功通过 SSO 接口凭借 OAuth Code 换取到 JWT Token！')
      setJwtToken(token)
      return token
    }
  } catch (err) {
    console.warn('[auth] SSO Code 换取 JWT 异常:', err)
  }
  return null
}

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
        webPreferences: {
          session: ses,
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false
        }
      })

      const JACCOUNT_AUTH_URL =
        'https://jaccount.sjtu.edu.cn/oauth2/authorize?response_type=code&scope=openid&client_id=pmZTZ9QZEAwXGLGheU99&redirect_uri=https%3A%2F%2Fv.sjtu.edu.cn%2F%23%2Flogin'

      try {
        let codeExtracted: string | null = null
        const tryExtractCode = (targetUrl: string) => {
          if (codeExtracted || !targetUrl) return
          try {
            const u = new URL(targetUrl)
            const code = u.searchParams.get('code') || targetUrl.match(/[?&#]code=([a-zA-Z0-9_-]+)/)?.[1]
            if (code) codeExtracted = code
          } catch {}
        }

        win.webContents.on('will-navigate', (_e, url) => tryExtractCode(url))
        win.webContents.on('did-navigate', (_e, url) => tryExtractCode(url))
        win.webContents.on('did-redirect-navigation', (_e, url) => tryExtractCode(url))

        await win.loadURL(JACCOUNT_AUTH_URL)
        const deadline = Date.now() + 15_000
        while (Date.now() < deadline) {
          const currentUrl = win.isDestroyed() ? '' : win.webContents.getURL()
          tryExtractCode(currentUrl)

          if (codeExtracted) {
            console.log('[auth] 拦截到 OAuth2 授权 Code，直接调用 SSO 接口秒换 Token…')
            const token = await exchangeVsjtuJwtByCode(codeExtracted)
            if (token) return true
          }

          // 若停留在密码登录或二维码表单页，说明 jAccount Cookie 彻底过期
          if (currentUrl.includes('jaccount.sjtu.edu.cn/jaccount/jalogin') || currentUrl.includes('/qrcode')) {
            console.log('[auth] jAccount cookie 已失效，需交互式重新登录')
            return false
          }

          if (!win.isDestroyed() && currentUrl.includes('v.sjtu.edu.cn')) {
            const token = (await win.webContents
              .executeJavaScript(`localStorage.getItem(${JSON.stringify(VSJTU_JWT_LS_KEY)})`)
              .catch(() => null)) as string | null

            if (token && token.length > 20) {
              const exp = extractJwtExpiry(token)
              const isFresh = !exp || exp > Date.now() + 30_000
              const currExp = jwtToken ? extractJwtExpiry(jwtToken) : undefined
              const currExpired = !currExp || currExp <= Date.now()

              if (isFresh && (token !== jwtToken || currExpired)) {
                console.log('[auth] 自动刷新 JWT 成功')
                setJwtToken(token)
                return true
              }
            }
          }

          await new Promise(r => setTimeout(r, 400))
          if (win.isDestroyed()) return false
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

/** 确保当前持有未过期的交大视频 JWT Token，若无则自动触发静默刷新 */
export async function ensureVsjtuLogin(): Promise<boolean> {
  const exp = jwtToken ? extractJwtExpiry(jwtToken) : undefined
  const isFresh = !!jwtToken && (!exp || Date.now() < exp)
  if (isFresh) return true
  console.log('[auth] 检测到当前交大视频凭据缺失或过期，主动触发静默登录刷新…')
  return await refreshJwtToken()
}

/** 从 /cloud-rbac/authority/me 的响应中取用户显示名和学号，兼容嵌套结构与多种命名。 */
export function pickAccountInfo(result: unknown): { name?: string; studentId?: string } {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    const target =
      r.result && typeof r.result === 'object'
        ? (r.result as Record<string, unknown>)
        : r.data && typeof r.data === 'object'
          ? (r.data as Record<string, unknown>)
          : r

    const u =
      target.user && typeof target.user === 'object'
        ? (target.user as Record<string, unknown>)
        : target

    const name = typeof u.name === 'string' && u.name.trim() ? u.name.trim() : undefined
    const studentId =
      typeof u.username === 'string' && u.username.trim()
        ? u.username.trim()
        : typeof u.code === 'string' && u.code.trim()
          ? u.code.trim()
          : undefined
    return { name, studentId }
  }
  return {}
}

const AUTH_429_MAX_RETRIES = 3

/**
 * 登录判定：优先基于本地未过期 JWT Token 判定，并用 /authority/me 增量补全实名信息。
 * 具备本地过期提前感知、401 自动刷新以及 429 指数退避重试能力。
 */
export async function getAuthInfo(force = false): Promise<AuthInfo> {
  if (!force && _authCache) {
    const ttl = _authCache.result.loggedIn ? 60_000 : 1_500
    if (Date.now() - _authCache.ts < ttl) {
      return _authCache.result
    }
  }

  // 1. 检查 JWT Token 是否合法且未过期
  const exp = jwtToken ? extractJwtExpiry(jwtToken) : undefined
  const isJwtFresh = !!jwtToken && (!exp || Date.now() < exp)

  // 若无有效 JWT，直接判定为未登录
  if (!isJwtFresh) {
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
        // 限流耗尽时不污染为未登录，保留现有有效状态
        if (_authCache?.result.loggedIn) return _authCache.result
        return {
          loggedIn: isJwtFresh,
          accountName: accountName ?? undefined,
          studentId: studentId ?? undefined,
          expired: _isSessionExpired
        }
      }

      if (!resp.ok) {
        _isSessionExpired = resp.status === 401
        const loggedIn = resp.status === 401 ? false : isJwtFresh
        _authCache = {
          result: {
            loggedIn,
            accountName: accountName ?? undefined,
            studentId: studentId ?? undefined,
            expiresAt: exp,
            expired: _isSessionExpired
          },
          ts: Date.now()
        }
        return _authCache.result
      }

      const text = await resp.text()
      const json = JSON.parse(text) as {
        code?: string
        result?: unknown
        data?: unknown
        user?: unknown
      }
      const ok = json?.code === '0'
      const info = ok ? pickAccountInfo(json?.result ?? json?.data ?? json) : {}
      const freshExp = jwtToken ? extractJwtExpiry(jwtToken) : exp

      if (ok) {
        if (info.name) accountName = info.name
        if (info.studentId) studentId = info.studentId
        _isSessionExpired = false
        saveSessionStore({
          accountName: accountName ?? undefined,
          studentId: studentId ?? undefined,
          expiresAt: freshExp
        })
      }

      _authCache = {
        result: {
          loggedIn: ok,
          accountName: accountName ?? info.name,
          studentId: studentId ?? info.studentId,
          expiresAt: freshExp,
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
      // 网络故障（如校园网 IPv6 / 路由中断）时，若持有有效 JWT 则不阻断用户使用
      const loggedIn = isJwtFresh && !_isSessionExpired
      _authCache = {
        result: {
          loggedIn,
          accountName: accountName ?? undefined,
          studentId: studentId ?? undefined,
          expiresAt: exp,
          expired: _isSessionExpired
        },
        ts: Date.now()
      }
      return _authCache.result
    }
  }

  return {
    loggedIn: isJwtFresh && !_isSessionExpired,
    accountName: accountName ?? undefined,
    studentId: studentId ?? undefined,
    expired: _isSessionExpired
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
      if (refreshed && attempt < VSJTU_FETCH_MAX_RETRIES) {
        continue
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
      const isJwtExpiredCode =
        json?.code === 'auth.authz.jwt.expired' ||
        json?.code === 'auth.authz.jwt.invalid' ||
        json?.code === '401' ||
        json?.status === 10013 ||
        (typeof json?.code === 'string' && json.code.startsWith('auth.authz.')) ||
        (json?.code === '-1' &&
          typeof json?.message === 'string' &&
          (json.message.startsWith('auth.authz.') || /jwt|token|未登录|登录已过期|过期|rules|signature/i.test(json.message))) ||
        (typeof json?.message === 'string' && /jwt.*expired|token.*expired|未登录|登录已过期/i.test(json.message))

      if (isJwtExpiredCode) {
        if (attempt < VSJTU_FETCH_MAX_RETRIES) {
          const reason = (typeof json?.message === 'string' && json.message) ? json.message : (json?.code || '未知')
          console.log(`[auth] vsjtuFetch ${path} 返回业务认证过期码 (${reason})，尝试自动刷新 JWT…`)
          const refreshed = await refreshJwtToken()
          if (refreshed) {
            continue
          }
        }
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
export function setJwtToken(
  token: string | null,
  userInfo?: { name?: string; studentId?: string }
): void {
  jwtToken = token && token.length > 20 ? token : null
  _isSessionExpired = false

  if (jwtToken) {
    const expiresAt = extractJwtExpiry(jwtToken)
    const claims = decodeJwtClaims(jwtToken)

    let parsedUserCode: string | undefined
    let parsedUserName: string | undefined
    if (typeof claims?.authUserDetails === 'string') {
      try {
        const aud = JSON.parse(claims.authUserDetails)
        parsedUserCode = aud?.user?.code
        parsedUserName = aud?.user?.name
      } catch {
        /* ignore */
      }
    }

    const name =
      userInfo?.name ||
      (typeof claims?.name === 'string' ? claims.name : undefined) ||
      parsedUserName ||
      accountName ||
      undefined

    const studentIdVal =
      userInfo?.studentId ||
      (typeof claims?.username === 'string'
        ? claims.username
        : typeof claims?.sub === 'string'
          ? claims.sub
          : undefined) ||
      parsedUserCode ||
      studentId ||
      undefined

    if (name) accountName = name
    if (studentIdVal) studentId = studentIdVal

    // 关键优化：一旦成功获取到有效 JWT，立即设为已登录，避免前端轮询等待远程探测时阻塞卡死
    _authCache = {
      result: {
        loggedIn: true,
        accountName: accountName ?? undefined,
        studentId: studentId ?? undefined,
        expiresAt,
        expired: false
      },
      ts: Date.now()
    }

    saveSessionStore({
      jwtToken,
      accountName: accountName ?? undefined,
      studentId: studentId ?? undefined,
      expiresAt
    })
  } else {
    _authCache = null
    saveSessionStore({ jwtToken: null })
  }
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

  // 检查持久化 JWT 是否已在本地明确过期
  const exp = extractJwtExpiry(saved.jwtToken)
  if (exp && Date.now() > exp) {
    console.log('[auth] 持久化 JWT 已过期，需重新登录')
    clearAuthState()
    return { loggedIn: false, expired: true }
  }

  jwtToken = saved.jwtToken
  accountName = saved.accountName ?? null
  studentId = saved.studentId ?? null

  // 严苛会话守卫：作为 All-in-One 下载器，除本地 JWT 外，Canvas、CNMOOC、交大云盘及 JWT 静默续期
  // 均强依赖 persist:sjtu 中的 jAccount 统一身份认证会话 Cookie（JAUSER / JASESSIONID 等）。
  // 若应用重启后 Chromium 丢弃了会话 Cookie（只剩 JATrustCookie 或为空），说明会话已断开，
  // 必须判定为未登录并清除孤立凭据，直接引导用户进入登录界面。
  let hasJaSession = false
  try {
    const jaCookies = await sjtuSession().cookies.get({ domain: 'jaccount.sjtu.edu.cn' })
    hasJaSession = jaCookies.some(c => c.name !== 'JATrustCookie' && c.name.length > 0)
  } catch {
    hasJaSession = false
  }

  if (!hasJaSession) {
    console.log('[auth] 缺少有效 jAccount 会话 Cookie，已恢复的会话视为过期，需重新登录')
    clearAuthState()
    return { loggedIn: false, expired: true }
  }

  // 恢复主进程缓存的云盘 token
  if (saved.cloudUserToken) {
    setCachedUserToken(saved.cloudUserToken)
  }

  // 关键提速：本地存储的 JWT Token 仍未过期且 jAccount 会话凭据有效，立刻认定为有效登录并放行首屏
  // 后续在后台静默发起增量验真，绝不阻塞应用主窗口与图形界面首次渲染
  if (exp && Date.now() < exp) {
    _authCache = {
      result: {
        loggedIn: true,
        accountName: accountName ?? undefined,
        studentId: studentId ?? undefined,
        expiresAt: exp,
        expired: false
      },
      ts: Date.now()
    }
    void getAuthInfo(true).catch(err => {
      console.warn('[auth] 后台会话刷新校验异常（不影响已恢复状态）:', err)
    })
    return _authCache.result
  }

  // 启动时单次校验凭据
  _authCache = null
  const auth = await getAuthInfo()
  return auth
}
