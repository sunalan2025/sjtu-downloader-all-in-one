import { request as httpsRequest } from 'node:https'
import { open } from 'node:fs/promises'
import type { ClientRequest } from 'node:http'
import type { CloudPanSpaceCred, CloudPanStartUploadResult, CloudPanConfirmResult } from '../../shared/types'
import { PAN_BASE, api, ensureCred, enc, ses } from './client'
import { wrapDnsError } from '../canvas/safe-fetch'
import { ensureFolderPath } from './files'
const MAX_PARTS_PER_REQ = 50
export class FileExistsError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'FileExistsError'
  }
}
// ─── COS PUT（直连腾讯 COS，不走代理） ─────────────────────────

/** 单次 COS PUT。multipart PUT 对同一 (uploadId, partNumber) 幂等，重试安全。 */
function cosPutOnce(
  url: string,
  headers: Record<string, string>,
  data: Buffer,
  onReq?: (req: ClientRequest) => void
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = httpsRequest(
      {
        method: 'PUT',
        hostname: u.hostname,
        port: 443,
        path: `${u.pathname}${u.search}`,
        headers: { ...headers, 'Content-Length': String(data.length) }
      },
      resp => {
        let body = ''
        resp.on('data', (c: Buffer) => {
          body += c.toString('utf8')
        })
        resp.on('end', () => resolve({ status: resp.statusCode || 0, body }))
        resp.on('error', reject)
      }
    )
    onReq?.(req) // 暴露 req 给调用方，便于 abort
    req.on('error', reject)
    req.setTimeout(300_000, () => req.destroy(new Error('COS timeout')))
    req.write(data)
    req.end()
  })
}

/** COS PUT 带网络错误重试（指数退避）。
 *  [Bug Fix] 原实现遇到首次 socket 错误/超时即失败，网络抖动下分片上传频繁失败 →
 *  最终 confirm 报 MultipartUploadIncomplete。multipart PUT 幂等，可安全重传同一分片。 */
async function cosPut(
  url: string,
  headers: Record<string, string>,
  data: Buffer,
  maxRetries = 2,
  onReq?: (req: ClientRequest) => void
): Promise<{ status: number; body: string }> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await cosPutOnce(url, headers, data, onReq)
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      const retryable = /timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|ENOTFOUND|EAI_AGAIN/i.test(msg)
      if (!retryable || attempt === maxRetries) throw err
      const delay = Math.pow(2, attempt) * 1000
      console.warn(`[cloudpan:cos] 分片上传网络错误，${delay / 1000}s 后重试 (${attempt + 1}/${maxRetries}): ${msg}`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastErr
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
  /** 中止当前在途的 COS 分片 PUT 请求（pause/cancel 时调用，让上传立即停下）。 */
  abort(): void
}

/** 检查云盘文件是否已存在（HEAD 请求，不创建上传会话） */
async function checkFileExists(cred: CloudPanSpaceCred, remotePath: string): Promise<boolean> {
  const path = enc(remotePath.split('/'))
  const url = `${PAN_BASE}/api/v1/file/${cred.libraryId}/${cred.spaceId}/${path}?access_token=${cred.accessToken}`
  try {
    const resp = await ses().fetch(url, { method: 'HEAD' })
    // 2xx 视为已存在；其余（含 404 / 鉴权失败 / 网络错误）一律视为不存在。
    // 调用方 startChunkedUpload 依赖此宽松判定：HEAD 失败时退回创建流程，由 init 接口的 409 兜底。
    return resp.ok
  } catch {
    return false
  }
}

/** 检查云盘文件是否已存在（HEAD，不创建上传会话）。
 *  供 PPT 课件等场景在上传前预判 skip，避免先生成文件再发现远端已存在。
 *  与 startChunkedUpload 同样的宽松判定：HEAD 失败一律视为不存在，由后续上传兜底。 */
export async function cloudFileExists(userToken: string, remotePath: string): Promise<boolean> {
  const cred = await ensureCred(userToken)
  return checkFileExists(cred, remotePath)
}

/** 删除云盘文件/文件夹（移入回收站）。供「替换」策略在上传前先清掉同名文件。
 *  接口：DELETE /api/v1/file/{libraryId}/{spaceId}/{path}?permanent=0&access_token=...
 *  路径按段 URL 编码（参考 JboxTransfer TboxService.DeleteFile）。
 *  204/200 均视为成功；文件本就不存在（404）也视为成功（幂等，符合"替换"语义）。 */
export async function deleteCloudFile(userToken: string, remotePath: string): Promise<void> {
  const cred = await ensureCred(userToken)
  const path = enc(remotePath.split('/'))
  const url = `${PAN_BASE}/api/v1/file/${cred.libraryId}/${cred.spaceId}/${path}?permanent=0&access_token=${cred.accessToken}`
  try {
    const resp = await ses().fetch(url, { method: 'DELETE' })
    // 204 NoContent / 200 OK → 成功；404 → 本就不存在，幂等成功
    if (resp.status === 204 || resp.status === 200 || resp.status === 404) return
    const text = await resp.text()
    throw new Error(`删除云盘文件失败：HTTP ${resp.status} ${text.slice(0, 120)}`)
  } catch (err) {
    // 404 属于预期内的"不存在"，不报错
    if (err instanceof Error && /HTTP 404/.test(err.message)) return
    throw wrapDnsError(url, err) ?? err
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
      return buildUploader(userToken, cred, initResult)
    }
    throw err
  }

  return buildUploader(userToken, cred, initResult)
}

/** 从保存的会话状态恢复 uploader，跳过已传分片 */
export async function resumeChunkedUpload(userToken: string, state: UploadSessionState): Promise<ChunkedUploader> {
  let cred = await ensureCred(userToken)
  const renewBody = { partNumberRange: Array.from({ length: MAX_PARTS_PER_REQ }, (_, i) => state.nextPart + i) }
  let r: CloudPanStartUploadResult
  try {
    r = await api<CloudPanStartUploadResult>(
      `${PAN_BASE}/api/v1/file/${cred.libraryId}/${cred.spaceId}/${state.confirmKey}?renew&access_token=${cred.accessToken}`,
      { method: 'POST', body: renewBody }
    )
  } catch (err) {
    if (err instanceof Error && (err.message.includes('HTTP 401') || err.message.includes('401'))) {
      cred = await ensureCred(userToken, true)
      r = await api<CloudPanStartUploadResult>(
        `${PAN_BASE}/api/v1/file/${cred.libraryId}/${cred.spaceId}/${state.confirmKey}?renew&access_token=${cred.accessToken}`,
        { method: 'POST', body: renewBody }
      )
    } else {
      throw err
    }
  }
  return buildUploader(
    userToken,
    cred,
    {
      confirmKey: state.confirmKey,
      domain: state.domain,
      uploadId: state.uploadId,
      path: state.cosPath,
      parts: r.parts,
      expiration: r.expiration,
      status: r.status
    },
    new Set(state.uploadedParts),
    state.nextPart,
    state.bytesReceived
  )
}

function buildUploader(
  userToken: string,
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
  let activeCred = cred

  /** renew 上传会话凭证，[R3-F4] 支持动态刷新 accessToken 避免长时间大文件上传中会话凭证过期；
   *  400 时等待后重试（网络抖动导致会话暂时不可用）；
   *  [Bug 31 Fix] 若两次 400，则上传会话可能已过期（COS 服务端清理），抛出明确错误。 */
  async function renewWithRetry(pn: number): Promise<CloudPanStartUploadResult> {
    const body = { partNumberRange: Array.from({ length: MAX_PARTS_PER_REQ }, (_, i) => pn + i) }
    if (userToken) {
      try {
        activeCred = await ensureCred(userToken)
      } catch {
        // fallback to current activeCred
      }
    }
    const currentRenewUrl = `${PAN_BASE}/api/v1/file/${activeCred.libraryId}/${activeCred.spaceId}/${confirmKey}?renew&access_token=${activeCred.accessToken}`
    try {
      return await api<CloudPanStartUploadResult>(currentRenewUrl, { method: 'POST', body })
    } catch (err) {
      if (err instanceof Error && (err.message.includes('HTTP 401') || err.message.includes('401'))) {
        if (userToken) {
          activeCred = await ensureCred(userToken, true)
          const retryRenewUrl = `${PAN_BASE}/api/v1/file/${activeCred.libraryId}/${activeCred.spaceId}/${confirmKey}?renew&access_token=${activeCred.accessToken}`
          return await api<CloudPanStartUploadResult>(retryRenewUrl, { method: 'POST', body })
        }
      }
      if (err instanceof Error && err.message.includes('HTTP 400')) {
        await new Promise(r => setTimeout(r, 3000))
        try {
          return await api<CloudPanStartUploadResult>(currentRenewUrl, { method: 'POST', body })
        } catch {
          throw new Error('上传会话已过期（服务端返回 400），请取消后重新上传')
        }
      }
      throw err
    }
  }

  // 当前在途的 COS PUT 请求句柄；abort() 用它立即中止上传
  let activePutReq: ClientRequest | undefined

  return {
    get bytesReceived() {
      return bytesReceived
    },
    get uploadedParts() {
      return new Set(trackedParts)
    },
    getState(): UploadSessionState {
      return {
        confirmKey,
        domain,
        uploadId,
        cosPath,
        nextPart,
        bytesReceived,
        uploadedParts: [...trackedParts]
      }
    },
    abort(): void {
      try {
        activePutReq?.destroy(new Error('aborted'))
      } catch {
        /* ignore */
      }
      activePutReq = undefined
    },
    async uploadChunk(chunk: Buffer): Promise<void> {
      const pn = nextPart++
      const now = Date.now()
      if (expiration - now < 30_000 || !parts[String(pn)]) {
        const r = await renewWithRetry(pn)
        parts = r.parts
        expiration = new Date(r.expiration).getTime()
      }
      const pi = parts[String(pn)]
      if (!pi) throw new Error(`No credential for part ${pn}`)
      const trackReq = (req: ClientRequest): void => {
        activePutReq = req
      }
      // COS PUT 带单次重试
      let resp = await cosPut(
        `https://${domain}${cosPath}?uploadId=${uploadId}&partNumber=${pn}`,
        { ...pi.headers, 'Content-Type': 'application/octet-stream' },
        chunk,
        2,
        trackReq
      )
      activePutReq = undefined
      if (resp.status < 200 || resp.status >= 300) {
        // renew 凭证后重试一次
        const r2 = await renewWithRetry(pn)
        parts = r2.parts
        expiration = new Date(r2.expiration).getTime()
        const pi2 = parts[String(pn)]
        if (!pi2) throw new Error(`No credential for part ${pn} after renew`)
        resp = await cosPut(
          `https://${domain}${cosPath}?uploadId=${uploadId}&partNumber=${pn}`,
          { ...pi2.headers, 'Content-Type': 'application/octet-stream' },
          chunk,
          2,
          trackReq
        )
        activePutReq = undefined
        if (resp.status < 200 || resp.status >= 300) {
          throw new Error(`COS PUT part ${pn}: HTTP ${resp.status} - ${resp.body.slice(0, 200)}`)
        }
      }
      trackedParts.add(pn)
      bytesReceived += chunk.length
    },
    async confirm(): Promise<CloudPanConfirmResult> {
      // COS 在收到 confirm 请求后需要时间整合分片，偶尔会返回 MultipartUploadIncomplete；
      // 网络抖动也可能导致 400/5xx/超时。多次指数退避重试以提升末段鲁棒性。
      const MAX_CONFIRM_RETRIES = 4
      let lastErr: unknown
      for (let attempt = 0; attempt < MAX_CONFIRM_RETRIES; attempt++) {
        if (userToken) {
          try {
            activeCred = await ensureCred(userToken)
          } catch {
            // fallback to current activeCred
          }
        }
        const url = `${PAN_BASE}/api/v1/file/${activeCred.libraryId}/${activeCred.spaceId}/${confirmKey}?confirm&conflict_resolution_strategy=overwrite&access_token=${activeCred.accessToken}`
        try {
          return await api<CloudPanConfirmResult>(url, { method: 'POST' })
        } catch (err) {
          lastErr = err
          const msg = err instanceof Error ? err.message : String(err)
          if ((msg.includes('HTTP 401') || msg.includes('401')) && userToken) {
            try {
              activeCred = await ensureCred(userToken, true)
              continue
            } catch {
              // retry with backoff
            }
          }
          const retryable =
            msg.includes('MultipartUploadIncomplete') ||
            msg.includes('HTTP 400') ||
            msg.includes('HTTP 5') ||
            /timeout|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up/i.test(msg)
          if (!retryable || attempt === MAX_CONFIRM_RETRIES - 1) throw err
          const delay = Math.pow(2, attempt) * 1500
          console.warn(
            `[cloudpan:confirm] 整合失败(${msg.slice(0, 80)})，${delay / 1000}s 后重试 (${attempt + 1}/${MAX_CONFIRM_RETRIES - 1})`
          )
          await new Promise(r => setTimeout(r, delay))
        }
      }
      throw lastErr
    }
  }
}

// ─── 本地文件 → 云盘（HLS 模块视频下载后上传） ────────────────

export function getDynamicChunkSize(totalBytes: number): number {
  if (totalBytes > 1024 * 1024 * 1024) return 16 * 1024 * 1024 // >1GB: 16MB
  if (totalBytes > 200 * 1024 * 1024) return 8 * 1024 * 1024 // >200MB: 8MB
  return 4 * 1024 * 1024 // <=200MB: 4MB
}

/** 把本地文件按动态分片（4MB ~ 16MB）上传到云盘。
 *  - skip 策略：远端已存在 → 抛 FileExistsError（调用方据此标 skipped）
 *  - overwrite 策略：先 deleteCloudFile 再 startChunkedUpload
 *  - 自动 ensureFolderPath（逐级创建父目录）
 *  onProgress(bytesUploaded, totalBytes) 用于进度推送。
 *  返回 confirm 结果（含云盘 path）。 */
export async function uploadLocalFileToCloud(
  userToken: string,
  localPath: string,
  remotePath: string,
  conflictStrategy: 'skip' | 'overwrite',
  onProgress?: (bytesUploaded: number, totalBytes: number) => void,
  customUploader?: ChunkedUploader
): Promise<CloudPanConfirmResult> {
  // 确保父目录存在（逐级创建）
  const segments = remotePath.split('/')
  const folderSegments = segments.slice(0, -1) // 去掉文件名，保留目录层级
  if (folderSegments.length > 0 && !customUploader) {
    await ensureFolderPath(userToken, ...folderSegments)
  }

  // overwrite：先删远端同名文件（404 幂等）
  if (conflictStrategy === 'overwrite' && !customUploader) {
    await deleteCloudFile(userToken, remotePath).catch(() => undefined)
  }

  const uploader = customUploader ?? (await startChunkedUpload(userToken, remotePath))
  try {
    const fileHandle = await open(localPath, 'r')
    try {
      // fileHandle 持有期间文件不会被删/截断 → 用 stat() 拿 size，消除 TOCTOU
      const stat = await fileHandle.stat()
      const total = stat.size
      const chunkSize = getDynamicChunkSize(total)
      const buf = Buffer.allocUnsafe(chunkSize)
      let uploaded = 0
      while (uploaded < total) {
        const { bytesRead } = await fileHandle.read(buf, 0, chunkSize, uploaded)
        if (bytesRead <= 0) break
        // 最后一片不足 chunkSize：只传实际读到的字节
        const chunk = bytesRead < chunkSize ? buf.subarray(0, bytesRead) : buf
        await uploader.uploadChunk(chunk)
        uploaded += bytesRead
        onProgress?.(uploaded, total)
      }
    } finally {
      await fileHandle.close()
    }
    return await uploader.confirm()
  } catch (err) {
    uploader.abort()
    throw err
  }
}

// ─── 云盘网页端 URL 构建 ─────────────────────────────────────

/** 构造网页端目标地址 */
export function getCloudPanWebUrl(remotePath: string[] = []): string {
  const clean = Array.isArray(remotePath) ? remotePath.filter(Boolean) : []
  if (clean.length === 0) return 'https://pan.sjtu.edu.cn/#/files/'
  return 'https://pan.sjtu.edu.cn/#/files/' + clean.map(encodeURIComponent).join('/')
}
