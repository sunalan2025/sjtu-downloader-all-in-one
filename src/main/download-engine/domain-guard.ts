/**
 * SJTU 官方域名隔离守卫与 429 退避算法 (R5-F1, R5-F2)
 *
 * 集中校验网络请求与重定向目标是否为交大官方域名：
 * - *.sjtu.edu.cn (含 s3.jcloud.sjtu.edu.cn, oc.sjtu.edu.cn, v.sjtu.edu.cn 等)
 * - *.sjtu.cn (含 cnmooc.sjtu.cn, static.cnmooc.sjtu.cn 等)
 * - 本地开发/测试环境下允许 localhost / 127.0.0.1 / [::1] (供 Mock 测试)
 */

export class SecurityViolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecurityViolationError'
  }
}

export interface DomainGuardOptions {
  /** 是否允许 localhost / 127.0.0.1 回环地址 (默认测试环境下为 true) */
  allowLocalhost?: boolean
}

/** 判断当前是否处于测试/开发环境 */
export function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST)
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * 校验目标 URL 是否属于受允许的 SJTU 官方域名。
 *
 * @param urlStr 待校验的 URL 字符串
 * @param options 可选配置项
 * @returns true 表示在白名单内且协议安全；false 表示非法或存在潜在安全风险
 */
export function isAllowedSjtuUrl(urlStr: string, options?: DomainGuardOptions): boolean {
  if (!urlStr || typeof urlStr !== 'string') {
    return false
  }

  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    return false
  }

  const hostname = parsed.hostname.toLowerCase()
  const protocol = parsed.protocol.toLowerCase()
  const allowLocal = options?.allowLocalhost ?? isTestEnv()

  // 1. 回环地址校验 (测试环境放行)
  if (LOOPBACK_HOSTNAMES.has(hostname)) {
    return allowLocal && (protocol === 'http:' || protocol === 'https:')
  }

  // 2. 生产网络环境强制要求 HTTPS 协议
  if (protocol !== 'https:') {
    return false
  }

  // 3. SJTU 官方域名匹配 (*.sjtu.edu.cn, s3.jcloud.sjtu.edu.cn, *.sjtu.cn)
  if (hostname === 's3.jcloud.sjtu.edu.cn') {
    return true
  }
  if (hostname === 'sjtu.edu.cn' || hostname.endsWith('.sjtu.edu.cn')) {
    return true
  }
  if (hostname === 'sjtu.cn' || hostname.endsWith('.sjtu.cn')) {
    return true
  }

  return false
}

/**
 * 断言目标 URL 在 SJTU 官方域名白名单内。若不在则抛出 SecurityViolationError。
 *
 * @param urlStr 待校验的 URL
 * @param context 上下文描述信息（如任务 ID 或调用阶段）
 * @throws {SecurityViolationError}
 */
export function assertAllowedSjtuUrl(urlStr: string, context = 'DownloadRedirect'): void {
  if (!isAllowedSjtuUrl(urlStr)) {
    throw new SecurityViolationError(
      `[${context}] 安全拦截：目标 URL 域名不在 SJTU 官方白名单内 (${urlStr.slice(0, 120)})`
    )
  }
}

/**
 * 计算 429 限流退避时长 (毫秒)。
 * 优先读取 Retry-After 头 (支持秒数或 HTTP-Date 格式)；若无则采用指数退避。
 */
export function calculateBackoffMs(
  retryAfter?: string | null,
  attempt = 1,
  maxDelayMs = 60_000,
  addJitter = false
): number {
  if (retryAfter) {
    const parsedSec = Number.parseInt(retryAfter, 10)
    if (Number.isFinite(parsedSec) && parsedSec >= 0) {
      return Math.min(parsedSec * 1000, maxDelayMs)
    }
    const httpDate = Date.parse(retryAfter)
    if (!Number.isNaN(httpDate)) {
      const diff = httpDate - Date.now()
      if (diff > 0) return Math.min(diff, maxDelayMs)
    }
  }
  const expDelay = 1000 * Math.pow(2, Math.max(0, attempt - 1))
  const jitter = addJitter ? Math.floor(Math.random() * 500) : 0
  return Math.min(expDelay + jitter, maxDelayMs)
}

export const calculateRateLimitBackoffMs = calculateBackoffMs
