import type Electron from 'electron'

/** 清洗用于日志的字符串：剥离 CR/LF 与其他 C0 控制字符（防 CRLF 日志注入），并截断超长内容。
 *  CodeQL js/log-injection：把用户提供的值（URL、错误消息、文件名）拼进 console.warn/log 前，
 *  必须先经此清洗，避免攻击者通过控制字符伪造日志行或注入终端转义序列。 */
export function sanitizeForLog(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[\x00-\x1F\x7F]/g, '?').slice(0, 500)
}

/** 将 Chromium DNS/网络错误转为可读消息；非 DNS 错误返回 null（由调用方原样抛出）。 */
export function wrapDnsError(url: string, err: unknown): Error | null {
  const msg = err instanceof Error ? err.message : String(err)
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(msg)) {
    return new Error(`DNS 解析失败，无法连接到 ${new URL(url).hostname}，请检查网络连接`)
  }
  return null
}

/** 包装 ses.fetch，将 Chromium DNS/网络错误转为可读消息 */
export async function safeFetch(
  ses: Electron.Session,
  url: string,
  init?: RequestInit
): Promise<Response> {
  try {
    return await ses.fetch(url, init)
  } catch (err) {
    throw wrapDnsError(url, err) ?? err
  }
}
