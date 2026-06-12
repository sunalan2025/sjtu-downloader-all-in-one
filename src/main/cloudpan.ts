import { request as httpsRequest } from 'node:https'
import type Electron from 'electron'
import type {
  CloudPanSpaceCred,
  CloudPanStartUploadResult,
  CloudPanConfirmResult,
  CloudPanSpaceInfo
} from '../shared/types'

const PAN_BASE = 'https://pan.sjtu.edu.cn'
const MAX_PARTS_PER_REQ = 50

/** 文件已存在时抛出，上层据此标记任务为 skipped */
export class FileExistsError extends Error {
  constructor(msg: string) { super(msg); this.name = 'FileExistsError' }
}

// ─── Electron session ──────────────────────────────────────────

let _ses: Electron.Session | null = null
export function setSession(s: Electron.Session): void { _ses = s }
function ses(): Electron.Session {
  if (!_ses) throw new Error('cloudpan: session not initialized')
  return _ses
}

// ─── credential cache ──────────────────────────────────────────

let cachedToken: string | null = null
let cachedCred: CloudPanSpaceCred | null = null
let credExpAt = 0

export function getCachedUserToken(): string | null { return cachedToken }
export function clearCachedCredentials(): void { cachedToken = null; cachedCred = null; credExpAt = 0 }

// ─── fetch helper（走 Electron session，自动穿透代理） ──────────

async function api<T>(url: string, opts?: { method?: string; body?: unknown }): Promise<T> {
  const method = opts?.method || 'GET'
  const headers: Record<string, string> = { Accept: 'application/json, text/plain, */*' }
  let body: string | undefined
  if (opts?.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const resp = await ses().fetch(url, { method, headers, body })
  const text = await resp.text()
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text) as T
}

// ─── space credential ──────────────────────────────────────────

async function getSpaceCred(userToken: string): Promise<CloudPanSpaceCred> {
  return api<CloudPanSpaceCred>(`${PAN_BASE}/user/v1/space/1/personal?user_token=${userToken}`, { method: 'POST' })
}

async function ensureCred(userToken: string): Promise<CloudPanSpaceCred> {
  if (cachedCred && cachedToken === userToken && Date.now() < credExpAt - 60_000) return cachedCred
  const cred = await getSpaceCred(userToken)
  cachedToken = userToken
  cachedCred = cred
  credExpAt = Date.now() + cred.expiresIn * 1000
  return cred
}

// ─── path encoding ─────────────────────────────────────────────

function enc(segs: string[]): string {
  return segs.map(s => encodeURIComponent(s)).join('/')
}

// ─── public: validate / space info ──────────────────────────────

export async function validateUserToken(userToken: string): Promise<{ ok: boolean; error?: string }> {
  if (!userToken || userToken.length < 64) return { ok: false, error: 'UserToken 格式不正确' }
  try {
    const cred = await getSpaceCred(userToken)
    cachedToken = userToken; cachedCred = cred; credExpAt = Date.now() + cred.expiresIn * 1000
    return { ok: true }
  } catch (err) { return { ok: false, error: err instanceof Error ? err.message : '连接失败' } }
}

export async function getSpaceInfo(userToken: string): Promise<CloudPanSpaceInfo> {
  return api<CloudPanSpaceInfo>(`${PAN_BASE}/user/v1/space/1?user_token=${userToken}`)
}

// ─── folder creation ───────────────────────────────────────────

/** 创建文件夹。parentPath 为空时在根目录创建，否则在 parentPath 内创建 */
async function ensureFolder(userToken: string, folderName: string, parentPath: string[] = []): Promise<void> {
  const cred = await ensureCred(userToken)
  const path = enc([...parentPath, folderName])
  const url = `${PAN_BASE}/api/v1/directory/${cred.libraryId}/${cred.spaceId}/${path}?conflict_resolution_strategy=ask&access_token=${cred.accessToken}`
  try {
    await api<unknown>(url, { method: 'PUT' })
  } catch (err) {
    if (err instanceof Error && (err.message.includes('SameNameDirectoryOrFileExists') || err.message.includes('HTTP 400') || err.message.includes('HTTP 409'))) return
    throw err
  }
}

/** 逐级创建嵌套文件夹（如 ['SJTU旁听课程', '课程名']） */
export async function ensureFolderPath(userToken: string, ...segments: string[]): Promise<void> {
  const created: string[] = []
  for (const seg of segments) {
    await ensureFolder(userToken, seg, created)
    created.push(seg)
  }
}

// ─── COS PUT（直连腾讯 COS，不走代理） ─────────────────────────

function cosPut(url: string, headers: Record<string, string>, data: Buffer): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = httpsRequest(
      { method: 'PUT', hostname: u.hostname, port: 443, path: `${u.pathname}${u.search}`,
        headers: { ...headers, 'Content-Length': String(data.length) } },
      resp => {
        let body = ''
        resp.on('data', (c: Buffer) => { body += c.toString('utf8') })
        resp.on('end', () => resolve({ status: resp.statusCode || 0, body }))
        resp.on('error', reject)
      }
    )
    req.on('error', reject)
    req.setTimeout(300_000, () => req.destroy(new Error('COS timeout')))
    req.write(data); req.end()
  })
}

// ─── chunked upload ────────────────────────────────────────────

/** 上传会话快照 — 暂停时保存，恢复时传给 resumeChunkedUpload */
export interface UploadSessionState {
  confirmKey: string
  domain: string
  uploadId: string
  cosPath: string
  nextPart: number
  bytesReceived: number
  uploadedParts: number[]
}

export interface ChunkedUploader {
  readonly bytesReceived: number
  readonly uploadedParts: Set<number>
  getState(): UploadSessionState
  uploadChunk(chunk: Buffer): Promise<void>
  confirm(): Promise<CloudPanConfirmResult>
}

/** 检查云盘文件是否已存在（HEAD 请求，不创建上传会话） */
async function checkFileExists(cred: CloudPanSpaceCred, remotePath: string): Promise<boolean> {
  const path = enc(remotePath.split('/'))
  const url = `${PAN_BASE}/api/v1/file/${cred.libraryId}/${cred.spaceId}/${path}?access_token=${cred.accessToken}`
  try {
    const resp = await ses().fetch(url, { method: 'HEAD' })
    return resp.ok  // 200/2xx = 文件存在, 404 = 不存在
  } catch {
    return false
  }
}

export async function startChunkedUpload(userToken: string, remotePath: string): Promise<ChunkedUploader> {
  const cred = await ensureCred(userToken)

  // 先用 HEAD 检查文件是否已存在（不创建上传会话）
  if (await checkFileExists(cred, remotePath)) {
    throw new FileExistsError(remotePath)
  }

  const path = enc(remotePath.split('/'))
  const initUrl = `${PAN_BASE}/api/v1/file/${cred.libraryId}/${cred.spaceId}/${path}?multipart&conflict_resolution_strategy=ask&access_token=${cred.accessToken}`

  let initResult: CloudPanStartUploadResult
  try {
    initResult = await api<CloudPanStartUploadResult>(initUrl, {
      method: 'POST',
      body: { partNumberRange: Array.from({ length: MAX_PARTS_PER_REQ }, (_, i) => i + 1) }
    })
  } catch (err) {
    if (err instanceof Error && (err.message.includes('SameNameDirectoryOrFileExists') || err.message.includes('HTTP 409')))
      throw new FileExistsError(remotePath)
    // 400 可能是文件在 HEAD 检查后被并发创建导致的竞态，也可能是暂时性错误
    if (err instanceof Error && err.message.includes('HTTP 400')) {
      if (await checkFileExists(cred, remotePath)) throw new FileExistsError(remotePath)
      // 文件不存在 → 可能是暂时性错误，延迟后重试一次
      await new Promise(r => setTimeout(r, 2000))
      initResult = await api<CloudPanStartUploadResult>(initUrl, {
        method: 'POST',
        body: { partNumberRange: Array.from({ length: MAX_PARTS_PER_REQ }, (_, i) => i + 1) }
      })
      return buildUploader(cred, initResult)
    }
    throw err
  }

  return buildUploader(cred, initResult)
}

/** 从保存的会话状态恢复 uploader，跳过已传分片 */
export async function resumeChunkedUpload(userToken: string, state: UploadSessionState): Promise<ChunkedUploader> {
  const cred = await ensureCred(userToken)
  // renew 凭证以获取最新 parts
  const r = await api<CloudPanStartUploadResult>(
    `${PAN_BASE}/api/v1/file/${cred.libraryId}/${cred.spaceId}/${state.confirmKey}?renew&access_token=${cred.accessToken}`,
    { method: 'POST', body: { partNumberRange: Array.from({ length: MAX_PARTS_PER_REQ }, (_, i) => state.nextPart + i) } }
  )
  return buildUploader(cred, {
    confirmKey: state.confirmKey,
    domain: state.domain,
    uploadId: state.uploadId,
    path: state.cosPath,
    parts: r.parts,
    expiration: r.expiration,
    status: r.status
  }, new Set(state.uploadedParts), state.nextPart, state.bytesReceived)
}

function buildUploader(
  cred: CloudPanSpaceCred,
  init: CloudPanStartUploadResult,
  alreadyUploaded?: Set<number>,
  startPart?: number,
  startBytes?: number
): ChunkedUploader {
  const { confirmKey, domain, uploadId, path: cosPath } = init
  let parts = init.parts
  let expiration = new Date(init.expiration).getTime()
  let nextPart = startPart ?? 1
  let bytesReceived = startBytes ?? 0
  const trackedParts = alreadyUploaded ?? new Set<number>()

  const renewUrl = `${PAN_BASE}/api/v1/file/${cred.libraryId}/${cred.spaceId}/${confirmKey}?renew&access_token=${cred.accessToken}`

  /** renew 上传会话凭证，400 时等待后重试（网络抖动导致会话暂时不可用） */
  async function renewWithRetry(pn: number): Promise<CloudPanStartUploadResult> {
    const body = { partNumberRange: Array.from({ length: MAX_PARTS_PER_REQ }, (_, i) => pn + i) }
    try {
      return await api<CloudPanStartUploadResult>(renewUrl, { method: 'POST', body })
    } catch (err) {
      if (err instanceof Error && err.message.includes('HTTP 400')) {
        await new Promise(r => setTimeout(r, 3000))
        return api<CloudPanStartUploadResult>(renewUrl, { method: 'POST', body })
      }
      throw err
    }
  }

  return {
    get bytesReceived() { return bytesReceived },
    get uploadedParts() { return new Set(trackedParts) },
    getState(): UploadSessionState {
      return {
        confirmKey, domain, uploadId, cosPath,
        nextPart, bytesReceived,
        uploadedParts: [...trackedParts]
      }
    },
    async uploadChunk(chunk: Buffer): Promise<void> {
      const pn = nextPart++
      const now = Date.now()
      if (expiration - now < 30_000 || !parts[String(pn)]) {
        const r = await renewWithRetry(pn)
        parts = r.parts; expiration = new Date(r.expiration).getTime()
      }
      const pi = parts[String(pn)]
      if (!pi) throw new Error(`No credential for part ${pn}`)
      // COS PUT 带单次重试
      let resp = await cosPut(
        `https://${domain}${cosPath}?uploadId=${uploadId}&partNumber=${pn}`,
        { ...pi.headers, 'Content-Type': 'application/octet-stream' },
        chunk
      )
      if (resp.status < 200 || resp.status >= 300) {
        // renew 凭证后重试一次
        const r2 = await renewWithRetry(pn)
        parts = r2.parts; expiration = new Date(r2.expiration).getTime()
        const pi2 = parts[String(pn)]
        if (!pi2) throw new Error(`No credential for part ${pn} after renew`)
        resp = await cosPut(
          `https://${domain}${cosPath}?uploadId=${uploadId}&partNumber=${pn}`,
          { ...pi2.headers, 'Content-Type': 'application/octet-stream' },
          chunk
        )
        if (resp.status < 200 || resp.status >= 300) {
          throw new Error(`COS PUT part ${pn}: HTTP ${resp.status} - ${resp.body.slice(0, 200)}`)
        }
      }
      trackedParts.add(pn)
      bytesReceived += chunk.length
    },
    async confirm(): Promise<CloudPanConfirmResult> {
      // COS 在收到 confirm 请求后需要时间整合分片，偶尔会返回 MultipartUploadIncomplete；
      // 网络抖动也可能导致 400；延迟后重试即可解决。
      const url = `${PAN_BASE}/api/v1/file/${cred.libraryId}/${cred.spaceId}/${confirmKey}?confirm&conflict_resolution_strategy=overwrite&access_token=${cred.accessToken}`
      try {
        return await api<CloudPanConfirmResult>(url, { method: 'POST' })
      } catch (err) {
        if (err instanceof Error && (err.message.includes('MultipartUploadIncomplete') || err.message.includes('HTTP 400'))) {
          await new Promise(r => setTimeout(r, 3000))
          return api<CloudPanConfirmResult>(url, { method: 'POST' })
        }
        throw err
      }
    }
  }
}
