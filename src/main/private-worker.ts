/**
 * 校内私有中转服务 (Self-Hosted Private Worker) 主进程客户端与探测模块
 *
 * 职责：
 * 1. 提供私有中转节点的连通性健康探测与延迟计算 (testPrivateWorker)
 * 2. 调度与派发云盘委托代传任务 (dispatchPrivateWorkerTask)
 * 3. 严格遵循私有自建原则，内存敏感凭据用完即焚
 */

import http from 'node:http'
import type { PrivateWorkerTestResult, PrivateWorkerTunnelConfig } from '../shared/types'
import { startSshTunnel } from './ssh-tunnel'

let embeddedServer: http.Server | null = null
let embeddedWorkerUrl: string | null = null

/** 获取当前后台运行的开发测试节点地址 */
export function getEmbeddedDevWorkerUrl(): string | null {
  return embeddedWorkerUrl
}

/** 停止后台运行的开发测试节点 */
export async function stopEmbeddedDevWorker(): Promise<void> {
  if (!embeddedServer) return
  return new Promise(resolve => {
    embeddedServer?.close(() => {
      embeddedServer = null
      embeddedWorkerUrl = null
      resolve()
    })
  })
}

/**
 * 在本地自动拉起轻量开发测试中转节点（带端口冲突自动递增自愈机制）
 */
export async function startEmbeddedDevWorker(startPort = 6880, maxPort = 6889): Promise<string | null> {
  if (embeddedServer && embeddedWorkerUrl) {
    return embeddedWorkerUrl
  }

  for (let port = startPort; port <= maxPort; port++) {
    try {
      const server = http.createServer((req, res) => {
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
          const body = JSON.stringify({
            ok: true,
            taskId: `task_dev_${Date.now()}`,
            message: '开发测试节点已接收任务'
          })
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Content-Length': Buffer.byteLength(body)
          })
          return res.end(body)
        }

        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'Not Found' }))
      })

      const started = await new Promise<boolean>(resolve => {
        server.once('error', (err: { code?: string }) => {
          if (err.code === 'EADDRINUSE') {
            resolve(false)
          } else {
            resolve(false)
          }
        })
        server.listen(port, '127.0.0.1', () => {
          resolve(true)
        })
      })

      if (started) {
        embeddedServer = server
        embeddedWorkerUrl = `http://127.0.0.1:${port}`
        return embeddedWorkerUrl
      }
    } catch {
      // try next port
    }
  }

  return null
}

export interface PrivateWorkerTaskPayload {
  taskId: string
  url: string
  fileName: string
  destPath: string
  cloudUserToken?: string
  conflictStrategy?: 'skip' | 'overwrite'
  fileSize?: number
}

export interface PrivateWorkerTaskResponse {
  ok: boolean
  taskId?: string
  error?: string
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
