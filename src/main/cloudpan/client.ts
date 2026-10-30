import type Electron from 'electron'
import type { CloudPanSpaceCred, CloudPanSpaceInfo } from '../../shared/types'
import { wrapDnsError, sanitizeForLog } from '../canvas/safe-fetch'
export const PAN_BASE = 'https://pan.sjtu.edu.cn'
// ─── Electron session ──────────────────────────────────────────

let _ses: Electron.Session | null = null
export function setSession(s: Electron.Session): void {
  _ses = s
}
export function ses(): Electron.Session {
  if (!_ses) throw new Error('cloudpan: session not initialized')
  return _ses
}

// ─── credential cache ──────────────────────────────────────────

let cachedToken: string | null = null
let cachedCred: CloudPanSpaceCred | null = null
let cachedCredToken: string | null = null
let credExpAt = 0
let credentialEpoch = 0
/** PERF: 缓存已成功创建的文件夹路径，避免同一 course 下重复 PUT */
export const FOLDER_CACHE_TTL_MS = 15 * 60 * 1000 // 15 分钟
export const createdFolderPaths = new Map<string, number>()

export function getCachedUserToken(): string | null {
  return cachedToken
}
/** [Bug Fix] 由 main 进程写入缓存的 UserToken。
 *  directLogin 成功后调用，使本次会话立即可用；
 *  app 启动恢复时由渲染端把持久化 token 同步过来（与 auth:set-jwt-token 同模式）。
 *  仅设置 token，space cred 留待 ensureCred 首次下载时懒拉。 */
export function setCachedUserToken(token: string | null): void {
  if (token !== null && (typeof token !== 'string' || token.length > 8192)) throw new Error('无效的云盘凭据')
  credentialEpoch++
  createdFolderPaths.clear()
  cachedToken = token
  // token 变更后旧的 space cred 不再适用，清掉让它重新拉取
  cachedCred = null
  cachedCredToken = null
  credExpAt = 0
}
export function clearCachedCredentials(): void {
  setCachedUserToken(null)
}

// ─── fetch helper（走 Electron session，自动穿透代理） ──────────

export async function api<T>(url: string, opts?: { method?: string; body?: unknown }): Promise<T> {
  return (await requestJson<T>(url, opts)).data
}

export async function requestJson<T>(url: string, opts?: { method?: string; body?: unknown }): Promise<{ status: number; data: T }> {
  const safeMessage = (value: unknown): string => {
    let message = value instanceof Error ? value.message : String(value)
    for (const [key, secret] of new URL(url).searchParams) {
      if (/token|key|secret/i.test(key) && secret)
        message = message.replaceAll(secret, '[redacted]').replaceAll(encodeURIComponent(secret), '[redacted]')
    }
    return sanitizeForLog(message)
  }
  const method = opts?.method || 'GET'
  const headers: Record<string, string> = { Accept: 'application/json, text/plain, */*' }
  let body: string | undefined
  if (opts?.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  let resp: Response
  try {
    resp = await ses().fetch(url, { method, headers, body, signal: AbortSignal.timeout(60_000) })
  } catch (err) {
    const error = wrapDnsError(url, err) ?? err
    throw new Error(safeMessage(error))
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}: ${safeMessage(text).slice(0, 200)}`)
  }
  if (resp.status === 204) return { status: resp.status, data: undefined as T }
  const text = await resp.text()
  return { status: resp.status, data: text.trim() ? (JSON.parse(text) as T) : (undefined as T) }
}

// ─── space credential ──────────────────────────────────────────

async function getSpaceCred(userToken: string): Promise<CloudPanSpaceCred> {
  return api<CloudPanSpaceCred>(`${PAN_BASE}/user/v1/space/1/personal?user_token=${encodeURIComponent(userToken)}`, { method: 'POST' })
}

export async function ensureCred(userToken: string, force = false): Promise<CloudPanSpaceCred> {
  if (cachedToken && cachedToken !== userToken) throw new Error('云盘账号已切换，请重新操作')
  if (!force && cachedCred && cachedCredToken === userToken && Date.now() < credExpAt - 60_000) return cachedCred
  const epoch = credentialEpoch
  const cred = await getSpaceCred(userToken)
  if (credentialEpoch !== epoch) throw new Error('云盘账号已切换，请重新操作')
  // Explicit login owns the token; an old in-flight transfer must not log the account back in.
  cachedCred = cred
  cachedCredToken = userToken
  credExpAt = Date.now() + cred.expiresIn * 1000
  return cred
}

// ─── path encoding ─────────────────────────────────────────────

export function strictEncodeURIComponent(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function enc(segs: string[]): string {
  return segs.map(strictEncodeURIComponent).join('/')
}

// ─── public: validate / space info ──────────────────────────────

export async function validateUserToken(userToken: string): Promise<{ ok: boolean; error?: string }> {
  if (!userToken || userToken.length < 32) return { ok: false, error: 'UserToken 格式不正确' }
  try {
    const epoch = credentialEpoch
    const cred = await getSpaceCred(userToken)
    if (credentialEpoch !== epoch) return { ok: false, error: '云盘账号已切换' }
    if (cachedToken !== userToken) createdFolderPaths.clear()
    cachedToken = userToken
    cachedCred = cred
    cachedCredToken = userToken
    credExpAt = Date.now() + cred.expiresIn * 1000
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '连接失败' }
  }
}

export async function getSpaceInfo(userToken: string): Promise<CloudPanSpaceInfo> {
  return api<CloudPanSpaceInfo>(`${PAN_BASE}/user/v1/space/1?user_token=${encodeURIComponent(userToken)}`)
}
