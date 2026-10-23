/**
 * 校内私有中转服务 (Self-Hosted Private Worker) 主进程客户端与探测模块
 *
 * 职责：
 * 1. 提供私有中转节点的连通性健康探测与延迟计算 (testPrivateWorker)
 * 2. 调度与派发云盘委托代传任务 (dispatchPrivateWorkerTask)
 * 3. 严格遵循私有自建原则，内存敏感凭据用完即焚
 */

import type { PrivateWorkerTestResult } from '../shared/types'

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
 */
export async function testPrivateWorker(
  rawUrl: string,
  token?: string,
  timeoutMs = 4000
): Promise<PrivateWorkerTestResult> {
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
