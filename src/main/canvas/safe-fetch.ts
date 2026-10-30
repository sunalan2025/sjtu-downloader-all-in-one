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
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000

/** 包装 ses.fetch，具备超时熔断（AbortController 深度中止底层网络连接）、Chromium DNS 错误转义以及 429 限流指数退避自愈 */
export async function safeFetch(
  ses: Electron.Session,
  url: string,
  init?: RequestInit,
  maxRetries = DEFAULT_429_MAX_RETRIES,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  let attempt = 0
  for (;;) {
    let resp: Response
    const controller = new AbortController()

    let removeCallerAbortListener: (() => void) | undefined
    if (init?.signal) {
      if (init.signal.aborted) {
        controller.abort(init.signal.reason)
      } else {
        const onCallerAbort = (): void => {
          controller.abort(init.signal?.reason)
        }
        init.signal.addEventListener('abort', onCallerAbort, { once: true })
        removeCallerAbortListener = (): void => {
          init.signal?.removeEventListener('abort', onCallerAbort)
        }
      }
    }

    try {
      let fetchPromise: Promise<Response>
      try {
        fetchPromise = ses.fetch(url, { ...init, signal: controller.signal })
      } catch (callErr) {
        throw wrapDnsError(url, callErr) ?? callErr
      }

      if (timeoutMs > 0) {
        let timer: NodeJS.Timeout | undefined
        try {
          resp = await new Promise<Response>((resolve, reject) => {
            let settled = false

            timer = setTimeout(() => {
              if (settled) return
              settled = true
              const timeoutError = new Error(
                `请求超时 (${Math.round(timeoutMs / 1000)}s): ${sanitizeForLog(url)}`
              )
              controller.abort(timeoutError)
              reject(timeoutError)
            }, timeoutMs)

            fetchPromise.then(
              r => {
                if (settled) return
                settled = true
                if (timer) clearTimeout(timer)
                resolve(r)
              },
              err => {
                if (settled) return
                settled = true
                if (timer) clearTimeout(timer)
                reject(err)
              }
            )
          })
        } finally {
          if (timer) clearTimeout(timer)
        }
      } else {
        resp = await fetchPromise
      }
    } catch (err) {
      throw wrapDnsError(url, err) ?? err
    } finally {
      removeCallerAbortListener?.()
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

    await new Promise<void>((resolve, reject) => {
      if (init?.signal?.aborted) {
        reject(init.signal.reason ?? new Error('This operation was aborted'))
        return
      }

      function onAbort(): void {
        clearTimeout(backoffTimer)
        reject(init?.signal?.reason ?? new Error('This operation was aborted'))
      }

      const backoffTimer = setTimeout(() => {
        init?.signal?.removeEventListener('abort', onAbort)
        resolve()
      }, delayMs)

      init?.signal?.addEventListener('abort', onAbort, { once: true })
    })

    attempt++
  }
}
