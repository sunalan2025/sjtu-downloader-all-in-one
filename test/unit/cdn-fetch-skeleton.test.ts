import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../src/main/window', () => ({
  getMainWindow: vi.fn(() => null),
  getIsQuitting: vi.fn(() => false)
}))

// 捕获 httpsRequest 的调用参数与回调句柄
let lastReqOptions: Record<string, unknown> | null = null
let lastReqCallbacks: { req: { end: () => void; setTimeout: (ms: number, cb: () => void) => void; on: (ev: string, cb: (e: Error) => void) => void; destroy: (e?: Error) => void }; respCb: (resp: unknown) => void } | null = null

vi.mock('node:https', () => ({
  request: vi.fn((options: Record<string, unknown>, cb: (resp: unknown) => void) => {
    lastReqOptions = options
    const req = {
      end: vi.fn(),
      setTimeout: vi.fn(),
      on: vi.fn(),
      destroy: vi.fn()
    }
    lastReqCallbacks = { req: req as never, respCb: cb }
    return req
  })
}))

import { cdnFetchOnce, type CdnFetchContext, type CdnFetchCallbacks } from '../../src/main/download-engine/cdn-fetch'
import { canvasCookiesByTask, cnmoocCookiesByTask } from '../../src/main/download-engine/shared'
import type { DownloadProgress } from '../../src/shared/types'

function makeCtx(over: Partial<CdnFetchContext> = {}): CdnFetchContext {
  return {
    taskId: 't1',
    state: 'downloading',
    retryTimers: new Set(),
    received: 0,
    total: 0,
    getRangeFrom: () => 0,
    ...over
  }
}

function makeCb(over: Partial<CdnFetchCallbacks> = {}): CdnFetchCallbacks {
  return {
    fail: vi.fn(),
    onHeaders: vi.fn(() => true),
    onResponse: vi.fn(),
    onRequest: vi.fn(),
    ...over
  }
}

/** 模拟一个 2xx 响应对象（仅骨架用到的字段/方法） */
function fakeResp(status: number, headers: Record<string, string | string[]> = {}): unknown {
  return {
    statusCode: status,
    headers,
    on: vi.fn(),
    resume: vi.fn(),
    removeAllListeners: vi.fn(),
    destroy: vi.fn(),
    destroyed: false
  }
}

describe('CDN fetch skeleton (cdn-fetch.ts)', () => {
  beforeEach(() => {
    lastReqOptions = null
    lastReqCallbacks = null
    canvasCookiesByTask.clear()
    cnmoocCookiesByTask.clear()
  })

  it('builds base CDN headers with Referer/UA and no cookie when task has none', () => {
    const ctx = makeCtx()
    const cb = makeCb()
    cdnFetchOnce('https://etv.sjtu.edu.cn/video.mp4', 0, { count: 0 }, ctx, cb)

    expect(lastReqOptions).toMatchObject({
      method: 'GET',
      host: 'etv.sjtu.edu.cn',
      path: '/video.mp4'
    })
    const headers = (lastReqOptions as { headers: Record<string, string> }).headers
    expect(headers.Accept).toBe('*/*')
    expect(headers.Referer).toContain('v.sjtu.edu.cn')
    expect(headers.Cookie).toBeUndefined()
    expect(headers.Range).toBeUndefined()
    expect(cb.onRequest).toHaveBeenCalled()
  })

  it('injects Canvas cookie only on the oc.sjtu.edu.cn hop', () => {
    canvasCookiesByTask.set('t1', 'canvas_session=abc')
    const ctx = makeCtx()
    cdnFetchOnce('https://oc.sjtu.edu.cn/files/123/download?download_frd=1', 0, { count: 0 }, ctx, makeCb())

    const headers = (lastReqOptions as { headers: Record<string, string> }).headers
    expect(headers.Cookie).toBe('canvas_session=abc')
    expect(headers.Referer).toContain('oc.sjtu.edu.cn')
  })

  it('does NOT inject Canvas cookie on non-Canvas hosts (S3 presigned URLs)', () => {
    canvasCookiesByTask.set('t1', 'canvas_session=abc')
    cdnFetchOnce('https://s3.jcloud.sjtu.edu.cn/presigned/file.mp4', 0, { count: 0 }, makeCtx(), makeCb())

    const headers = (lastReqOptions as { headers: Record<string, string> }).headers
    expect(headers.Cookie).toBeUndefined()
  })

  it('injects cnmooc cookie on cnmooc.sjtu.cn and its subdomains only', () => {
    cnmoocCookiesByTask.set('t1', 'JSESSIONID=xyz; cpstk=tok')
    const ctx = makeCtx()

    cdnFetchOnce('https://static.cnmooc.sjtu.cn/docs/1.pdf', 0, { count: 0 }, ctx, makeCb())
    expect((lastReqOptions as { headers: Record<string, string> }).headers.Cookie).toBe('JSESSIONID=xyz; cpstk=tok')

    // 第三方 CDN 直链 → 不注入（防 cookie 泄漏）
    cdnFetchOnce('https://vod.example-cdn.com/flv/1.flv', 0, { count: 0 }, ctx, makeCb())
    expect((lastReqOptions as { headers: Record<string, string> }).headers.Cookie).toBeUndefined()
  })

  it('sends Range header from dynamic getRangeFrom (resume support)', () => {
    const ctx = makeCtx({ getRangeFrom: () => 4096 })
    cdnFetchOnce('https://etv.sjtu.edu.cn/video.mp4', 0, { count: 0 }, ctx, makeCb())
    expect((lastReqOptions as { headers: Record<string, string> }).headers.Range).toBe('bytes=4096-')
  })

  it('passes the keep-alive agent through to httpsRequest when provided', () => {
    const agent = { keepAlive: true } as never
    cdnFetchOnce('https://etv.sjtu.edu.cn/v.mp4', 0, { count: 0 }, makeCtx({ agent }), makeCb())
    expect((lastReqOptions as { agent?: unknown }).agent).toBe(agent)
  })

  it('aborts on redirect to a login page and surfaces the intercept reason', () => {
    const cb = makeCb()
    cdnFetchOnce('https://oc.sjtu.edu.cn/files/1/download', 0, { count: 0 }, makeCtx(), cb)

    // 模拟 302 → jaccount 登录页
    ;(lastReqCallbacks!.respCb as (r: unknown) => void)(fakeResp(302, { location: 'https://jaccount.sjtu.edu.cn/oauth/authorize' }))

    expect(cb.fail).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('会话失效')
    }))
    expect(cb.onHeaders).not.toHaveBeenCalled()
    expect(cb.onResponse).not.toHaveBeenCalled()
  })

  it('fails immediately on depth > 5 (redirect loop guard)', () => {
    const cb = makeCb()
    cdnFetchOnce('https://etv.sjtu.edu.cn/a', 6, { count: 0 }, makeCtx(), cb)
    expect(cb.fail).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('重定向过多') }))
  })

  it('fails on unparseable URL', () => {
    const cb = makeCb()
    cdnFetchOnce('not a url', 0, { count: 0 }, makeCtx(), cb)
    expect(cb.fail).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('URL 解析失败') }))
  })

  it('respects the RL retry cap: gives up after CANVAS_RL_MAX_RETRIES and reports HTTP status', () => {
    vi.useFakeTimers()
    try {
      const rlRetries = { count: 4 } // 已达上限
      const cb = makeCb()
      const ctx = makeCtx()

      cdnFetchOnce('https://oc.sjtu.edu.cn/files/9/download', 0, rlRetries, ctx, cb)
      // 模拟 429 响应流：收集 body 后 end
      const resp = fakeResp(429, { 'retry-after': '1' })
      const handlers: Record<string, Array<(arg?: unknown) => void>> = {}
      ;(resp as unknown as { on: (ev: string, cb2: (arg?: unknown) => void) => void }).on = (ev, cb2) => {
        handlers[ev] = handlers[ev] ?? []
        handlers[ev].push(cb2)
      }
      ;(lastReqCallbacks!.respCb as (r: unknown) => void)(resp)

      // 触发 end → 超限 → 直接 fail（不再排队重试）
      handlers['end']?.[0]?.()
      expect(cb.fail).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('HTTP 429')
      }))
      // 没有注册新的重试定时器
      expect(ctx.retryTimers.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('emits progress message and schedules a backoff timer on rate-limited retry', () => {
    vi.useFakeTimers()
    try {
      const rlRetries = { count: 0 }
      const cb = makeCb()
      const ctx = makeCtx()

      cdnFetchOnce('https://oc.sjtu.edu.cn/files/9/download', 0, rlRetries, ctx, cb)
      const handlers: Record<string, Array<(arg?: unknown) => void>> = {}
      const resp = fakeResp(429, { 'retry-after': '1' })
      ;(resp as unknown as { on: (ev: string, cb2: (arg?: unknown) => void) => void }).on = (ev, cb2) => {
        handlers[ev] = handlers[ev] ?? []
        handlers[ev].push(cb2)
      }
      ;(lastReqCallbacks!.respCb as (r: unknown) => void)(resp)

      handlers['end']?.[0]?.()
      expect(rlRetries.count).toBe(1)
      expect(ctx.retryTimers.size).toBe(1) // 退避定时器已注册进 retryTimers（pause/cancel 可清理）
      expect(cb.fail).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('delegates 2xx to onHeaders/onResponse with parsed total from Content-Range (206)', () => {
    const onHeaders = vi.fn(() => true)
    const onResponse = vi.fn()
    const cb = makeCb({ onHeaders, onResponse })

    cdnFetchOnce('https://etv.sjtu.edu.cn/v.mp4', 0, { count: 0 }, makeCtx(), cb)
    ;(lastReqCallbacks!.respCb as (r: unknown) => void)(
      fakeResp(206, { 'content-range': 'bytes 4096-8191/10240', 'content-length': '4096' })
    )

    expect(onHeaders).toHaveBeenCalled()
    expect(onResponse).toHaveBeenCalledWith(expect.anything(), 10240, 206)
  })

  it('delegates plain 200 with Content-Length total', () => {
    const onResponse = vi.fn()
    cdnFetchOnce('https://etv.sjtu.edu.cn/v.mp4', 0, { count: 0 }, makeCtx(), makeCb({ onResponse }))
    ;(lastReqCallbacks!.respCb as (r: unknown) => void)(fakeResp(200, { 'content-length': '2048' }))
    expect(onResponse).toHaveBeenCalledWith(expect.anything(), 2048, 200)
  })

  it('onHeaders returning false short-circuits total parsing (cloud 200-fallback path)', () => {
    const onResponse = vi.fn()
    const cb = makeCb({ onHeaders: () => false, onResponse })
    cdnFetchOnce('https://etv.sjtu.edu.cn/v.mp4', 0, { count: 0 }, makeCtx(), cb)
    ;(lastReqCallbacks!.respCb as (r: unknown) => void)(fakeResp(200, { 'content-length': '2048' }))
    expect(onResponse).not.toHaveBeenCalled()
  })
})

// 引用 DownloadProgress 类型以保持与项目类型系统一致（emitProgress 参数形状）
type _ProgressShape = DownloadProgress
