import type Electron from 'electron'

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
