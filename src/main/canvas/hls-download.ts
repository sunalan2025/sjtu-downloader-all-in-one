/**
 * HLS 视频下载 + ffmpeg remux
 *
 * 对应 Python module_videos.py 的 HLS 流捕获 / segment 下载 / ts 拼接 / mp4 转换。
 * 使用 hidden BrowserWindow 捕获 m3u8，用 node:https 下载 segments。
 */
import { existsSync, openSync, renameSync, statSync, unlinkSync, writeSync, closeSync } from 'node:fs'
import { request as httpsRequest, Agent as HttpsAgent } from 'node:https'
import { execFile, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type { IncomingMessage } from 'node:http'
import { BrowserWindow } from 'electron'
import type Electron from 'electron'

/** 跟踪所有活跃的 ffmpeg 子进程，退出时 kill 防止残留 */
const activeFfmpegProcesses = new Set<ChildProcess>()

/** 退出时杀死所有 ffmpeg 子进程 */
export function killAllFfmpeg(): void {
  for (const proc of activeFfmpegProcesses) {
    try { proc.kill('SIGTERM') } catch { /* ignore */ }
  }
  activeFfmpegProcesses.clear()
}
const TV_REFERER = 'https://etc.sjtu.edu.cn/'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

// PERF: Shared HTTPS agent with keep-alive enabled.
// Reuses TCP+TLS connections across segment downloads, avoiding 720 TLS handshakes
// for a typical video (~72s saved on 100ms-RTT connections).
const hlsKeepAliveAgent = new HttpsAgent({ keepAlive: true, maxSockets: 5 })

export interface HlsProgress {
  phase: 'capturing' | 'downloading' | 'remuxing'
  segmentsDone: number
  segmentsTotal: number
  bytesWritten: number
  message?: string
}

// ─── m3u8 捕获 ──────────────────────────────────────────────

/** 打开 iframe URL，监听网络请求捕获 .m3u8 地址 */
export async function captureM3u8(
  ses: Electron.Session,
  iframeUrl: string,
  timeoutMs = 20_000
): Promise<string | null> {
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true }
  })

  const captured: string[] = []

  // 用 webRequest 监听完成的请求，过滤 m3u8
  const filter = { urls: ['*://*/*'] }
  const listener = (
    _details: Electron.OnCompletedListenerDetails
  ): void => {
    const url = _details.url
    // [Bug 32 Fix] 更精确匹配：排除 .m3u8.key（加密密钥）和其他非 m3u8 资源
    // 只匹配路径或查询参数中以 .m3u8 结尾（可带 ? 或 # 之后的内容）的 URL
    if (/\.m3u8(\?|#|$)/i.test(url) && !url.includes('.m3u8.key') && !captured.includes(url)) {
      captured.push(url)
    }
  }

  ses.webRequest.onCompleted(filter, listener)

  try {
    await win.loadURL(iframeUrl)
    // 等待 m3u8 出现
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline && captured.length === 0) {
      await sleep(500)
    }
    return captured[0] ?? null
  } catch (err) {
    // win.loadURL 可能因 DNS 失败抛出 net::ERR_NAME_NOT_RESOLVED
    const msg = err instanceof Error ? err.message : ''
    if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(msg)) {
      console.warn(`[hls:capture] DNS 解析失败: ${iframeUrl}`)
    }
    return null
  } finally {
    // [Bug Fix] 移除监听器：将 filter 闭包捕获，finally 中传 null listener 覆盖
    ses.webRequest.onCompleted(filter, null)
    win.destroy()
  }
}

// ─── m3u8 解析 ──────────────────────────────────────────────

/** 跟随 master playlist 走到 media playlist，DNS/网络错误时重试 */
export async function resolveM3u8(
  ses: Electron.Session,
  m3u8Url: string,
  maxDepth = 3
): Promise<{ mediaUrl: string; body: string }> {
  let url = m3u8Url
  const MAX_FETCH_RETRIES = 3
  for (let i = 0; i < maxDepth; i++) {
    let lastErr: unknown
    for (let retry = 0; retry <= MAX_FETCH_RETRIES; retry++) {
      try {
        const resp = await ses.fetch(url, {
          headers: { Referer: TV_REFERER, 'User-Agent': USER_AGENT }
        })
        const text = await resp.text()
        // 如果有 #EXT-X-STREAM-INF，是 master playlist → 取第一个 variant
        if (/^#EXT-X-STREAM-INF/m.test(text)) {
          for (const line of text.split('\n')) {
            const trimmed = line.trim()
            if (trimmed && !trimmed.startsWith('#')) {
              url = new URL(trimmed, url).toString()
              break
            }
          }
        } else {
          return { mediaUrl: url, body: text }
        }
        break // 成功，跳出重试循环
      } catch (err) {
        lastErr = err
        const msg = err instanceof Error ? err.message : ''
        const isDns = /ENOTFOUND|getaddrinfo|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/i.test(msg)
        const isNet = /socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timeout|EPIPE/i.test(msg)
        if ((isDns || isNet) && retry < MAX_FETCH_RETRIES) {
          const delay = Math.pow(2, retry) * 1000
          const label = isDns ? 'DNS 解析失败' : '网络错误'
          console.warn(`[hls:m3u8] ${label}，${delay / 1000}s 后重试 (${retry + 1}/${MAX_FETCH_RETRIES}): ${msg}`)
          await sleep(delay)
          continue
        }
        throw err
      }
    }
  }
  return { mediaUrl: url, body: '' }
}

/** 从 media playlist body 中解析所有 segment URL */
export function parseSegments(mediaUrl: string, body: string): string[] {
  const urls: string[] = []
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    urls.push(new URL(trimmed, mediaUrl).toString())
  }
  return urls
}

// ─── HLS segment 并发下载 ────────────────────────────────────

/** 下载 m3u8 的所有 segment，按序流式写入 .ts 文件。
 *  使用 drain-queue 模式：只缓冲乱序到达的少量 segment，
 *  峰值内存从 O(total * segSize) 降低到 O(maxWorkers * segSize)。 */
export async function downloadHls(
  ses: Electron.Session,
  m3u8Url: string,
  destPath: string,
  onProgress?: (p: HlsProgress) => void,
  maxWorkers = 5
): Promise<number> {
  const { mediaUrl, body } = await resolveM3u8(ses, m3u8Url)
  const segments = parseSegments(mediaUrl, body)
  if (segments.length === 0) throw new Error(`m3u8 无 segments: ${m3u8Url}`)

  onProgress?.({ phase: 'downloading', segmentsDone: 0, segmentsTotal: segments.length, bytesWritten: 0 })

  const tmpPath = destPath + '.part'
  // 打开文件描述符，支持 positional write
  let fd = openSync(tmpPath, 'w')

  // drain-queue: writeIdx = 下一个要写入磁盘的 segment 序号
  let writeIdx = 0
  let writeOffset = 0
  const pendingWrites = new Map<number, Buffer>() // 乱序到达的 segment 缓存
  let done = 0
  let bytesWritten = 0
  let writeError: Error | null = null

  /** 尝试按序 flush 已缓冲的 segment 到磁盘 */
  const flushSequential = (): void => {
    while (pendingWrites.has(writeIdx)) {
      const buf = pendingWrites.get(writeIdx)!
      pendingWrites.delete(writeIdx)
      try {
        writeSync(fd, buf, 0, buf.length, writeOffset)
      } catch (err) {
        writeError = err instanceof Error ? err : new Error(String(err))
        return
      }
      writeOffset += buf.length
      writeIdx++
    }
  }

  try {
    // 并发下载所有 segment，下载完成的 segment 立即尝试按序写入
    const workers: Promise<void>[] = []
    let idx = 0
    let aborted = false
    const firstErr: { err: unknown } = { err: null }
    const workerErr = (e: unknown): void => { if (!firstErr.err) firstErr.err = e; aborted = true }
    for (let w = 0; w < Math.min(maxWorkers, segments.length); w++) {
      workers.push((async () => {
        while (idx < segments.length) {
          if (aborted || writeError) return
          const i = idx++
          let data: Buffer
          try { data = await fetchSegment(segments[i]) }
          catch (e) { workerErr(e); return }
          if (aborted) return
          pendingWrites.set(i, data)
          done++
          bytesWritten += data.length
          flushSequential()
          onProgress?.({
            phase: 'downloading',
            segmentsDone: done,
            segmentsTotal: segments.length,
            bytesWritten
          })
        }
      })())
    }
    await Promise.allSettled(workers)

    if (firstErr.err) throw firstErr.err
    if (writeError) throw writeError
    // 最终 flush（理论上 flushSequential 在最后一个 worker 中已完成）
    flushSequential()
    if (writeError) throw writeError
    if (writeIdx < segments.length) throw new Error('segment 下载缺失（并发任务异常终止）')

    closeSync(fd)
    fd = -1 // 标记已关闭，finally 中不再 close
    renameSync(tmpPath, destPath)
  } catch (err) {
    // 清理：关闭 fd + 删除 .part
    if (fd >= 0) { try { closeSync(fd) } catch { /* ignore */ } }
    try { unlinkSync(tmpPath) } catch { /* ignore */ }
    throw err
  }
  return bytesWritten
}

/** 判断是否为可重试的网络错误（含 DNS 解析失败） */
function isRetryableNetErr(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/i.test(msg)) return true
  if (/socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timeout|EPIPE/i.test(msg)) return true
  if ('code' in err && /^(ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE)$/.test(String((err as Error & { code?: unknown }).code))) return true
  return false
}

/** 下载单个 segment，网络错误时最多重试 3 次 */
function fetchSegment(url: string, maxRetries = 3): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const attempt = (retryCount: number): void => {
      const u = new URL(url)
      const req = httpsRequest(
        {
          method: 'GET',
          host: u.hostname,
          port: u.port || 443,
          path: `${u.pathname}${u.search}`,
          agent: hlsKeepAliveAgent,
          headers: {
            Referer: TV_REFERER,
            'User-Agent': USER_AGENT,
            'Accept-Encoding': 'identity'
          }
        },
        (resp: IncomingMessage) => {
          if (resp.statusCode && (resp.statusCode < 200 || resp.statusCode >= 300)) {
            resp.resume()
            reject(new Error(`Segment HTTP ${resp.statusCode}`))
            return
          }
          // PERF: track total length and pre-allocate to avoid an extra copy pass
          // (Buffer.concat creates a new buffer and copies all chunks; this approach
          // does the same but with allocUnsafe for fewer zero-fills)
          const chunks: Buffer[] = []
          let totalLen = 0
          resp.on('data', (c: Buffer) => { chunks.push(c); totalLen += c.length })
          resp.on('end', () => {
            const buf = Buffer.allocUnsafe(totalLen)
            let offset = 0
            for (const c of chunks) { c.copy(buf, offset); offset += c.length }
            resolve(buf)
          })
          resp.on('error', (err: Error) => {
            if (retryCount < maxRetries && isRetryableNetErr(err)) {
              const delay = Math.pow(2, retryCount) * 1000
              console.warn(`[hls:segment] 网络错误，${delay / 1000}s 后重试 (${retryCount + 1}/${maxRetries}): ${err.message}`)
              setTimeout(() => attempt(retryCount + 1), delay)
            } else {
              reject(err)
            }
          })
        }
      )
      req.setTimeout(60_000, () => req.destroy(new Error('segment timeout')))
      req.on('error', (err: Error) => {
        if (retryCount < maxRetries && isRetryableNetErr(err)) {
          const delay = Math.pow(2, retryCount) * 1000
          console.warn(`[hls:segment] 网络错误，${delay / 1000}s 后重试 (${retryCount + 1}/${maxRetries}): ${err.message}`)
          setTimeout(() => attempt(retryCount + 1), delay)
        } else {
          reject(err)
        }
      })
      req.end()
    }
    attempt(0)
  })
}

// ─── ffmpeg remux ────────────────────────────────────────────

/** 无损 remux .ts → .mp4（只换容器，不重编码）。
 *  成功删除 .ts 返回 true；失败保留 .ts 返回 false。 */
export async function remuxTsToMp4(tsPath: string, mp4Path: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const proc = execFile('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', tsPath,
      '-c', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      '-movflags', '+faststart',
      mp4Path
    ], { timeout: 600_000 }, (err) => {
      activeFfmpegProcesses.delete(proc)
      if (err) {
        // ffmpeg 不在 PATH 或转换失败
        try { unlinkSync(mp4Path) } catch { /* ignore */ }
        resolve(false)
      } else {
        // 成功，删 .ts
        try { unlinkSync(tsPath) } catch { /* ignore */ }
        resolve(true)
      }
    })
    activeFfmpegProcesses.add(proc)
  })
}

// ─── 完整流程：捕获 m3u8 → 下载 → remux ─────────────────────

export async function downloadModuleVideo(
  ses: Electron.Session,
  iframeUrl: string,
  destDir: string,
  baseName: string,
  onProgress?: (p: HlsProgress) => void
): Promise<{ path: string; format: 'mp4' | 'ts' }> {
  const mp4Path = join(destDir, `${baseName}.mp4`)
  const tsPath = join(destDir, `${baseName}.ts`)

  // 已存在 → 跳过
  if (existsSync(mp4Path) && statSync(mp4Path).size > 0) {
    return { path: mp4Path, format: 'mp4' }
  }
  // 历史 .ts → 尝试 remux
  if (existsSync(tsPath) && statSync(tsPath).size > 0) {
    if (await remuxTsToMp4(tsPath, mp4Path)) {
      return { path: mp4Path, format: 'mp4' }
    }
    return { path: tsPath, format: 'ts' }
  }

  // 捕获 m3u8
  onProgress?.({ phase: 'capturing', segmentsDone: 0, segmentsTotal: 0, bytesWritten: 0, message: '正在捕获 m3u8 播放地址…' })
  const m3u8 = await captureM3u8(ses, iframeUrl)
  if (!m3u8) throw new Error('未捕获到 m3u8 播放地址')

  // 下载 HLS segments
  onProgress?.({ phase: 'downloading', segmentsDone: 0, segmentsTotal: 0, bytesWritten: 0, message: '正在下载 HLS 切片…' })
  await downloadHls(ses, m3u8, tsPath, onProgress)

  // remux
  onProgress?.({ phase: 'remuxing', segmentsDone: 0, segmentsTotal: 0, bytesWritten: 0, message: '正在转换为 mp4…' })
  if (await remuxTsToMp4(tsPath, mp4Path)) {
    return { path: mp4Path, format: 'mp4' }
  }
  return { path: tsPath, format: 'ts' }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
