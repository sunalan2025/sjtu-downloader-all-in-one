/**
 * 校内私有中转服务 (Self-Hosted Private Worker) 主进程客户端与探测模块
 *
 * 职责：
 * 1. 提供私有中转节点的连通性健康探测与延迟计算 (testPrivateWorker)
 * 2. 调度与派发云盘委托代传任务 (dispatchPrivateWorkerTask)
 * 3. 严格遵循私有自建原则，内存敏感凭据用完即焚
 */

import http from 'node:http'
import type {
  DownloadMode,
  PrivateWorkerConfig,
  PrivateWorkerTestResult,
  PrivateWorkerTunnelConfig,
  PrivateWorkerTaskPayload,
  PrivateWorkerTaskResponse,
  PrivateWorkerTaskRecord,
  PrivateWorkerTaskQueryResponse
} from '../shared/types'
import { startSshTunnel, registerDevWorkerCleanupHook } from './ssh-tunnel'
import { isAllowedSjtuUrl } from './download-engine/domain-guard'

export type {
  PrivateWorkerTaskPayload,
  PrivateWorkerTaskResponse,
  PrivateWorkerTaskRecord,
  PrivateWorkerTaskQueryResponse
}

/**
 * 判断当前任务批次是否应当完全委托给校内私有中转机在远端脱机执行
 * 规则：
 * 1. 私有中转服务已启用且配置了有效的节点地址；
 * 2. 只要目标下载模式为 cloud，均委托给远端工作机承接：
 *    - 若 storageMode 为 'server_local'，中转机就地落盘在服务器本地磁盘；
 *    - 若 storageMode 为 'cloudpan'，中转机在远端直连下载并直传至交大云盘；
 *    两者在本地电脑上均仅接收状态与进度心跳，实现真正的 0 本机视频流消耗。
 * 3. 当用户选择存入本机电脑（local 模式）时，由本地下载引擎承接落盘，底层网络请求经由 Worker /api/proxy 流式代理中继。
 */
export function isWorkerDelegated(
  mode?: DownloadMode,
  privateWorker?: PrivateWorkerConfig
): boolean {
  if (!privateWorker || !privateWorker.enabled || !privateWorker.endpointUrl?.trim()) {
    return false
  }

  // 只要目标下载模式为 cloud，均委托给远端工作机承接（cloudpan 直传云盘 或 server_local 就地落盘）
  if (mode === 'cloud') {
    return true
  }

  return false
}

/**
 * 若启用了私有中转服务，将目标直链包装为经由中转节点的流式代理地址
 * 让下载到本机的流量也完整经过校内中转机中继
 */
export function wrapWorkerProxyUrl(rawUrl: string, privateWorker?: PrivateWorkerConfig): string {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl
  if (!privateWorker || !privateWorker.enabled || !privateWorker.endpointUrl?.trim()) {
    return rawUrl
  }
  const normalized = normalizeWorkerUrl(privateWorker.endpointUrl)
  if (!normalized) return rawUrl
  // 已是中转节点代理地址的无需重复包装
  if (rawUrl.startsWith(normalized)) return rawUrl
  return `${normalized}/api/proxy?url=${encodeURIComponent(rawUrl)}`
}

let embeddedServer: http.Server | null = null
let embeddedWorkerUrl: string | null = null
const devTasks = new Map<string, PrivateWorkerTaskRecord>()

/** 获取当前后台运行的开发测试节点地址 */
export function getEmbeddedDevWorkerUrl(): string | null {
  return embeddedWorkerUrl
}

/** 停止后台运行的开发测试节点 */
export async function stopEmbeddedDevWorker(): Promise<void> {
  if (!embeddedServer) return
  devTasks.clear()
  return new Promise(resolve => {
    embeddedServer?.close(() => {
      embeddedServer = null
      embeddedWorkerUrl = null
      resolve()
    })
  })
}

// 注册开发节点清理钩子，避免 ssh-tunnel 反向循环导入 private-worker
registerDevWorkerCleanupHook(stopEmbeddedDevWorker)

/**
 * 优先尝试指定端口范围；全被占用或被系统保留时由系统分配回环端口。
 */
export async function startEmbeddedDevWorker(startPort = 6880, maxPort = 6889): Promise<string | null> {
  if (embeddedServer && embeddedWorkerUrl) {
    return embeddedWorkerUrl
  }

  if (!Number.isInteger(startPort) || !Number.isInteger(maxPort) || startPort < 0 || maxPort > 65535 || startPort > maxPort) return null
  const ports = new Set([...Array.from({ length: maxPort - startPort + 1 }, (_, index) => startPort + index), 0])
  for (const port of ports) {
    try {
      const server = http.createServer(async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
          })
          return res.end()
        }

        const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
        const pathname = parsedUrl.pathname

        if (pathname === '/health' || pathname === '/') {
          const body = JSON.stringify({
            status: 'ok',
            server: 'sjtu-private-worker-dev',
            version: '1.0.0',
            uptimeSeconds: Math.round(process.uptime()),
            mode: 'embedded-dev'
          })
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Content-Length': Buffer.byteLength(body)
          })
          return res.end(body)
        }

        if (pathname === '/api/tasks' && req.method === 'POST') {
          let rawBody = ''
          req.on('data', chunk => {
            rawBody += chunk
          })
          req.on('end', () => {
            try {
              const payload = JSON.parse(rawBody || '{}') as Partial<PrivateWorkerTaskPayload>
              const taskId = payload.taskId || `task_dev_${Date.now()}`
              const isLocal = payload.storageMode === 'server_local'
              const targetPath = isLocal
                ? `${payload.serverDownloadDir || '~/downloads'}/${payload.courseName || '未分类'}/${payload.fileName || 'file'}`
                : (payload.destPath || '')

              devTasks.set(taskId, {
                taskId,
                fileName: payload.fileName || 'unknown',
                storageMode: payload.storageMode || 'cloudpan',
                status: 'completed',
                receivedBytes: payload.fileSize || 1024,
                totalBytes: payload.fileSize || 1024,
                speed: 1048576,
                targetPath
              })

              const body = JSON.stringify({
                ok: true,
                taskId,
                storageMode: payload.storageMode || 'cloudpan',
                targetPath,
                message: isLocal
                  ? '开发测试节点已接收任务，将保存在中转服务器本地磁盘'
                  : '开发测试节点已接收任务，将转存至交大云盘'
              })
              res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Content-Length': Buffer.byteLength(body)
              })
              res.end(body)
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }))
            }
          })
          return
        }

        if (pathname.startsWith('/api/tasks/')) {
          const isCancel = pathname.endsWith('/cancel') || req.method === 'DELETE'
          const taskId = pathname.replace('/api/tasks/', '').replace(/\/cancel$/, '')
          const task = devTasks.get(taskId)

          if (isCancel) {
            if (task) task.status = 'cancelled'
            const body = JSON.stringify({ ok: true, message: '任务已取消' })
            res.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
              'Content-Length': Buffer.byteLength(body)
            })
            return res.end(body)
          }

          if (req.method === 'GET') {
            if (!task) {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              return res.end(JSON.stringify({ ok: false, error: '任务不存在' }))
            }
            const body = JSON.stringify({ ok: true, task })
            res.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
              'Content-Length': Buffer.byteLength(body)
            })
            return res.end(body)
          }
        }

        if (pathname === '/api/proxy' && req.method === 'GET') {
          const targetUrl = parsedUrl.searchParams.get('url')
          if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ ok: false, error: '缺少目标 url' }))
          }
          if (!isAllowedSjtuUrl(targetUrl, { allowLocalhost: false })) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ ok: false, error: '安全拦截：仅允许代理交大官方域名' }))
          }
          try {
            const forwardHeaders: Record<string, string> = {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SJTU-Downloader-Worker/1.0',
              'Accept': '*/*'
            }
            if (req.headers.range) forwardHeaders['Range'] = req.headers.range
            if (req.headers.referer) forwardHeaders['Referer'] = req.headers.referer
            const upstream = await fetch(targetUrl, { method: 'GET', headers: forwardHeaders })
            const respHeaders: Record<string, string> = {
              'Access-Control-Allow-Origin': '*'
            }
            for (const [k, v] of upstream.headers.entries()) {
              if (['content-length', 'content-type', 'content-range', 'accept-ranges'].includes(k.toLowerCase())) {
                respHeaders[k] = v
              }
            }
            res.writeHead(upstream.status, respHeaders)
            if (!upstream.body) return res.end()
            const reader = upstream.body.getReader()
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              res.write(Buffer.from(value))
            }
            return res.end()
          } catch (proxyErr) {
            res.writeHead(502, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ ok: false, error: String(proxyErr) }))
          }
        }

        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Not Found' }))
      })

      const started = await new Promise<boolean>(resolve => {
        server.once('error', () => resolve(false))
        server.listen(port, '127.0.0.1', () => {
          resolve(true)
        })
      })

      if (started) {
        const address = server.address()
        if (!address || typeof address === 'string') {
          server.close()
          continue
        }
        embeddedServer = server
        embeddedWorkerUrl = `http://127.0.0.1:${address.port}`
        return embeddedWorkerUrl
      }
    } catch {
      // try next port
    }
  }

  return null
}

/**
 * 向私有中转服务派发代传任务
 * @param workerUrl 节点 URL，例如 http://127.0.0.1:6880
 * @param payload 任务载荷
 * @param token 访问授权密钥 (Token)，选填
 * @param timeoutMs 超时时限（毫秒），默认 10000ms
 */
export async function dispatchPrivateWorkerTask(
  workerUrl: string,
  payload: PrivateWorkerTaskPayload,
  token?: string,
  timeoutMs = 10000
): Promise<PrivateWorkerTaskResponse> {
  const normalized = normalizeWorkerUrl(workerUrl)
  if (!normalized) {
    return { ok: false, error: '中转服务节点地址无效' }
  }

  let taskEndpoint = ''
  try {
    const urlObj = new URL(normalized)
    urlObj.pathname = '/api/tasks'
    taskEndpoint = urlObj.toString()
  } catch {
    return { ok: false, error: '请输入有效的中转服务节点地址格式' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
  if (token && token.trim()) {
    headers['Authorization'] = `Bearer ${token.trim()}`
  }

  try {
    const res = await fetch(taskEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    })

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: '授权失败：访问授权密钥 (Token) 不匹配或已失效' }
    }

    if (!res.ok) {
      return { ok: false, error: `服务返回异常状态码 HTTP ${res.status}` }
    }

    const data = await res.json().catch(() => ({})) as PrivateWorkerTaskResponse
    return {
      ok: Boolean(data.ok),
      taskId: data.taskId || payload.taskId,
      storageMode: data.storageMode || payload.storageMode,
      targetPath: data.targetPath,
      message: data.message,
      error: data.error
    }
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err)
    if (errMessage.includes('aborted') || (err as { name?: string })?.name === 'AbortError') {
      return { ok: false, error: `派发任务超时（超过 ${Math.round(timeoutMs / 1000)} 秒）` }
    }
    return { ok: false, error: `派发任务失败: ${errMessage}` }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 规范化节点 URL，移除末尾斜杠并补全协议
 */
export function normalizeWorkerUrl(rawUrl: string): string {
  let url = (rawUrl || '').trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`
  }
  return url.replace(/\/+$/, '')
}

/**
 * 测试私有中转节点的连通性与健康状态
 * @param rawUrl 节点 URL，如 http://127.0.0.1:6880
 * @param token 访问授权密钥 (Token)，选填
 * @param timeoutMs 超时时限（毫秒），默认 4000ms
 * @param tunnelConfig 可选的 SSH 隧道托管配置
 */
export async function testPrivateWorker(
  rawUrl: string,
  token?: string,
  timeoutMs = 4000,
  tunnelConfig?: PrivateWorkerTunnelConfig
): Promise<PrivateWorkerTestResult> {
  if (tunnelConfig?.enabled) {
    // 严防开发模拟假节点占用端口：启动隧道前先停止嵌入式开发测试服务
    await stopEmbeddedDevWorker()

    const tunnelRes = await startSshTunnel(tunnelConfig)
    if (!tunnelRes.success) {
      return {
        success: false,
        error: `SSH 隧道启动失败: ${tunnelRes.error || '未知错误'}`
      }
    }
  }

  const normalized = normalizeWorkerUrl(rawUrl)
  if (!normalized) {
    return {
      success: false,
      error: '请输入有效的中转服务节点地址（例如 http://127.0.0.1:6880）'
    }
  }

  let healthUrl = ''
  try {
    const urlObj = new URL(normalized)
    if (!urlObj.pathname || urlObj.pathname === '/') {
      urlObj.pathname = '/health'
    } else if (!urlObj.pathname.endsWith('/health')) {
      urlObj.pathname = `${urlObj.pathname.replace(/\/+$/, '')}/health`
    }
    healthUrl = urlObj.toString()
  } catch {
    return {
      success: false,
      error: '请输入有效的中转服务节点地址格式'
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const headers: Record<string, string> = {
    'Accept': 'application/json'
  }
  if (token && token.trim()) {
    headers['Authorization'] = `Bearer ${token.trim()}`
  }

  const startTime = performance.now()
  try {
    const res = await fetch(healthUrl, {
      method: 'GET',
      headers,
      signal: controller.signal
    })
    const latencyMs = Math.round(performance.now() - startTime)

    if (res.status === 401 || res.status === 403) {
      return {
        success: false,
        latencyMs,
        error: '授权失败：访问授权密钥 (Token) 不匹配或已失效'
      }
    }

    if (!res.ok) {
      return {
        success: false,
        latencyMs,
        error: `服务返回异常状态码 HTTP ${res.status}`
      }
    }

    const data = await res.json().catch(() => ({})) as {
      status?: string
      version?: string
      server?: string
      name?: string
    }

    if (
      tunnelConfig?.enabled &&
      (data.server === 'sjtu-private-worker-dev' || data.name === 'sjtu-private-worker-dev')
    ) {
      return {
        success: false,
        latencyMs,
        error: '检测到目标端口连接被本机开发测试服务拦截，未真正连入远程 SSH 服务器'
      }
    }

    return {
      success: true,
      latencyMs: Math.max(1, latencyMs),
      version: data.version || '1.0.0',
      serverName: data.server || data.name || 'sjtu-private-worker'
    }
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - startTime)
    const errMessage = err instanceof Error ? err.message : String(err)
    const cause = (err as { cause?: unknown })?.cause
    const causeMsg = cause instanceof Error ? cause.message : String(cause || '')
    const causeCode = (cause as { code?: string })?.code || ''

    if (errMessage.includes('aborted') || errMessage.includes('timeout') || (err as { name?: string })?.name === 'TimeoutError' || (err as { name?: string })?.name === 'AbortError') {
      return {
        success: false,
        latencyMs,
        error: `连接超时（超过 ${Math.round(timeoutMs / 1000)} 秒），请检查网络连通性或防火墙设置`
      }
    }

    if (
      errMessage.includes('ECONNREFUSED') ||
      errMessage.includes('Failed to fetch') ||
      errMessage.includes('fetch failed') ||
      causeMsg.includes('ECONNREFUSED') ||
      causeCode === 'ECONNREFUSED'
    ) {
      return {
        success: false,
        latencyMs,
        error: '无法连接到该服务节点，请确认服务已启动且端口开放'
      }
    }

    return {
      success: false,
      latencyMs,
      error: `连接失败：${errMessage}`
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 查询私有中转服务上特定任务的执行状态与实时传输进度
 */
export async function queryPrivateWorkerTask(
  workerUrl: string,
  taskId: string,
  token?: string,
  timeoutMs = 5000
): Promise<PrivateWorkerTaskQueryResponse> {
  const normalized = normalizeWorkerUrl(workerUrl)
  if (!normalized || !taskId) {
    return { ok: false, error: '参数无效' }
  }

  let endpoint = ''
  try {
    const urlObj = new URL(normalized)
    urlObj.pathname = `/api/tasks/${encodeURIComponent(taskId)}`
    endpoint = urlObj.toString()
  } catch {
    return { ok: false, error: '中转服务节点地址格式无效' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token && token.trim()) {
    headers['Authorization'] = `Bearer ${token.trim()}`
  }

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers,
      signal: controller.signal
    })

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: '授权失败：访问密钥不匹配或已失效' }
    }
    if (res.status === 404) {
      return { ok: false, error: '任务不存在' }
    }
    if (!res.ok) {
      return { ok: false, error: `查询任务状态失败: HTTP ${res.status}` }
    }

    const data = (await res.json()) as { ok: boolean; task?: PrivateWorkerTaskRecord; error?: string }
    return {
      ok: Boolean(data.ok),
      task: data.task,
      error: data.error
    }
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err)
    if (errMessage.includes('aborted') || (err as { name?: string })?.name === 'AbortError') {
      return { ok: false, error: '查询中转任务超时' }
    }
    return { ok: false, error: `查询中转任务异常: ${errMessage}` }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 请求私有中转服务取消特定任务
 */
export async function cancelPrivateWorkerTask(
  workerUrl: string,
  taskId: string,
  token?: string,
  timeoutMs = 5000
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const normalized = normalizeWorkerUrl(workerUrl)
  if (!normalized || !taskId) {
    return { ok: false, error: '参数无效' }
  }

  let endpoint = ''
  try {
    const urlObj = new URL(normalized)
    urlObj.pathname = `/api/tasks/${encodeURIComponent(taskId)}`
    endpoint = urlObj.toString()
  } catch {
    return { ok: false, error: '中转服务节点地址格式无效' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token && token.trim()) {
    headers['Authorization'] = `Bearer ${token.trim()}`
  }

  try {
    const res = await fetch(endpoint, {
      method: 'DELETE',
      headers,
      signal: controller.signal
    })

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: '授权失败：访问密钥不匹配或已失效' }
    }

    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string }
    return {
      ok: Boolean(data.ok),
      message: data.message,
      error: data.error
    }
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `取消中转任务异常: ${errMessage}` }
  } finally {
    clearTimeout(timer)
  }
}
