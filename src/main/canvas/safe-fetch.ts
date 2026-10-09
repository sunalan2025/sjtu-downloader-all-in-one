import type Electron from 'electron'
import { calculateBackoffMs } from '../download-engine/domain-guard'

/** 清洗用于日志的字符串：剥离 CR/LF 与其他 C0 控制字符（防 CRLF 日志注入），并截断超长内容。
 *  CodeQL js/log-injection：把用户提供的值（URL、错误消息、文件名）拼进 console.warn/log 前，
 *  必须先经此清洗，避免攻击者通过控制字符伪造日志行或注入终端转义序列。 */
export function sanitizeForLog(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\x00-\x1F\x7F]/g, '?')
    .slice(0, 500)
}

/** 将 Chromium DNS/网络错误转为可读消息；非 DNS 错误返回 null（由调用方原样抛出）。 */
export function wrapDnsError(url: string, err: unknown): Error | null {
  const msg = err instanceof Error ? err.message : String(err)
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(msg)) {
    return new Error(`DNS 解析失败，无法连接到 ${new URL(url).hostname}，请检查网络连接`)
  }
  return null
}

export const DEFAULT_429_MAX_RETRIES = 4

/** 包装 ses.fetch，具备 Chromium DNS 错误转义以及 429 限流指数退避自愈 */
export async function safeFetch(
  ses: Electron.Session,
  url: string,
  init?: RequestInit,
  maxRetries = DEFAULT_429_MAX_RETRIES
): Promise<Response> {
  let attempt = 0
  for (;;) {
    let resp: Response
    try {
      resp = await ses.fetch(url, init)
    } catch (err) {
      throw wrapDnsError(url, err) ?? err
    }

    if (resp.status !== 429 || attempt >= maxRetries) {
      return resp
    }

    // 释放 429 响应体，避免连接悬挂
    try {
      await resp.text()
    } catch {
      /* ignore */
    }

    const ra = resp.headers.get('retry-after')
    const delayMs = calculateBackoffMs(ra, attempt + 1)
    console.warn(
      `[safeFetch] 429 Too Many Requests (${sanitizeForLog(url)})，${Math.round(delayMs / 1000)}s 后重试 (${attempt + 1}/${maxRetries})`
    )

    await new Promise<void>(r => setTimeout(r, delayMs))
    attempt++
  }
}
