// CDN 拉流骨架：local（写文件流）与 cloud（攒分片上传）两条下载路径共用的
// fetchOnce 核心逻辑抽取。
//
// 两侧手抄的 ~150 行完全一致的骨架：URL 解析 → header 构建（Canvas / cnmooc
// cookie 按域注入）→ SJTU 域名重定向拦截跟随 → 非 2xx 的 Canvas 429/403 限流
// 指数退避重试 → 2xx 的 Content-Range/Content-Length total 解析 → 交给回调
// 消费 body。差异点（Range 起点、200 回退、data/end 消费、请求级错误重试）
// 通过 ctx / 回调注入。
//
// 请求级（超时/连接错误）重试不在骨架内——本地路径无重试（外层 runTask 有
// 3 次整体重试），云端路径自带指数退避，均在 onRequest 回调后自行注册。

import { request as httpsRequest } from 'node:https'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { CANVAS_BASE_URL, CNMOOC_BASE_URL, V_SJTU_ORIGIN, type DownloadState } from '../../shared/types'
import { interceptDownloadRedirect } from './domain-guard'
import {
  canvasCookiesByTask,
  cnmoocCookiesByTask,
  CANVAS_HOST,
  CANVAS_RL_MAX_RETRIES,
  canvasRlBackoffMs,
  isCnmoocCookieHost
} from './shared'
import { emitProgress } from './progress'

/** CDN 拉流请求头：CDN 校验 Referer / UA — 没带会 403 */
const CDN_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/** 骨架运行时上下文：由调用方闭包提供，骨架在重试时动态读取 */
export interface CdnFetchContext {
  taskId: string
  /** 任务当前态（读属性而非快照值：重试门槛判断要在定时器触发时取最新态） */
  state: DownloadState
  /** 在途 retry setTimeout 句柄集合（限流退避定时器注册于此，pause/cancel 时统一清理） */
  retryTimers: Set<ReturnType<typeof setTimeout>>
  /** 进度条当前值（限流重试 message 用；骨架读字段值，data 回调里调用方同步更新） */
  received: number
  total: number
  /** Range 起点：getter 形式，重定向跟随/重试发起时动态读取
   *  （本地 = .part 已有字节，可能被 200 回退清零；云端 = uploader 已收字节） */
  getRangeFrom: () => number
  /** keep-alive Agent（本地用 sharedDownloadAgent 复用连接；云端不传用全局默认） */
  agent?: import('node:https').Agent
}

export interface CdnFetchCallbacks {
  fail: (e: Error) => void
  /** 2xx 响应头到达：返回 true 走骨架的通用 total 解析 + onResponse；
   *  返回 false 表示调用方已自行处理该响应（如云端 CDN 不支持 Range 的 200 回退），骨架直接返回。 */
  onHeaders: (resp: IncomingMessage, status: number, url: string) => boolean
  /** 2xx 且未被 onHeaders 拦截：total 已解析完成，消费 body 流（含注册 t.resp 等句柄） */
  onResponse: (resp: IncomingMessage, total: number, status: number) => void
  /** 请求发起时挂句柄（t.req；请求级超时/错误重试由调用方在此注册） */
  onRequest: (req: ClientRequest) => void
  /** 响应到达时挂句柄（t.resp） */
  onRespAttached?: (resp: IncomingMessage) => void
}

/**
 * 发起一次 CDN GET（骨架）：
 * - 手动跟随 302（经 interceptDownloadRedirect 的 SJTU 域名白名单 + 登录页拦截）
 * - Canvas（oc.sjtu.edu.cn）/ cnmooc 域注入会话 cookie，其余域不注入
 * - 非 2xx：Canvas 站点的 429/403 指数退避重试（读 Retry-After；上限
 *   CANVAS_RL_MAX_RETRIES，计数挂在调用方闭包，跨 fetchOnce 共享、整体重试时重置）
 * - 2xx：解析 total（206 读 Content-Range），交回调消费
 * 请求超时 / req 错误不在骨架内，由调用方在 onRequest 里自行注册。
 */
export function cdnFetchOnce(
  url: string,
  depth: number,
  rlRetries: { count: number },
  ctx: CdnFetchContext,
  cb: CdnFetchCallbacks
): void {
  if (depth > 5) {
    cb.fail(new Error(`重定向过多：${depth}`))
    return
  }
  let u: URL
  try {
    u = new URL(url)
  } catch {
    cb.fail(new Error(`URL 解析失败：${url.slice(0, 120)}`))
    return
  }

  const headers: Record<string, string> = {
    Accept: '*/*',
    Referer: `${V_SJTU_ORIGIN}/jy-application-resmgr-ui/`,
    'User-Agent': CDN_USER_AGENT
  }
  const rangeFrom = ctx.getRangeFrom()
  if (rangeFrom > 0) headers.Range = `bytes=${rangeFrom}-`
  // Canvas 文件：仅在 oc.sjtu.edu.cn 这一跳注入会话 cookie + oc.sjtu Referer，
  // 让 node:https 从 /files/{id}/download 跟随 302 到 s3 预签名直链。
  // 跟随到 s3.jcloud 时不带 cookie（签名直链自包含，且避免把 Canvas cookie 泄漏给第三方域）。
  const canvasCookie = canvasCookiesByTask.get(ctx.taskId)
  if (canvasCookie && u.hostname === CANVAS_HOST) {
    headers.Cookie = canvasCookie
    headers.Referer = `${CANVAS_BASE_URL}/`
  }
  // 好大学在线：仅对 cnmooc.sjtu.cn 及其子域（含 static.cnmooc 课件）注入会话 cookie。
  // 与 Canvas 互斥（任务来源单一），视频 CDN 直链不在 cnmooc 域 → 不注入。
  const cnmoocCookie = cnmoocCookiesByTask.get(ctx.taskId)
  if (cnmoocCookie && isCnmoocCookieHost(u.hostname)) {
    headers.Cookie = cnmoocCookie
    headers.Referer = `${CNMOOC_BASE_URL}/`
  }

  const req = httpsRequest(
    {
      method: 'GET',
      host: u.hostname,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      headers,
      ...(ctx.agent ? { agent: ctx.agent } : {})
    },
    (resp: IncomingMessage) => {
      cb.onRespAttached?.(resp)
      const status = resp.statusCode || 0

      // 跟随重定向：严格强制 SJTU 域名隔离，防止凭证/流量外泄与会话过期下载 HTML (R2-F3)
      if (status >= 300 && status < 400 && resp.headers.location) {
        resp.resume()
        const intercept = interceptDownloadRedirect(resp.headers.location, url)
        if (intercept.action === 'abort') {
          cb.fail(new Error(intercept.reason || '重定向被拦截'))
          return
        }
        cdnFetchOnce(intercept.nextUrl || resp.headers.location, depth + 1, rlRetries, ctx, cb)
        return
      }

      if (status < 200 || status >= 300) {
        // 对任何 SJTU 域名的 429 (Too Many Requests) 进行指数退避重试；
        // 403 仅对 oc.sjtu 限流进行重试（S3 的 403 是签名/权限永久错误，不重试）
        const isRateLimited = status === 429 || (status === 403 && u.hostname === CANVAS_HOST)
        let bodyHead = ''
        resp.on('data', (c: Buffer) => {
          if (bodyHead.length < 200) bodyHead += c.toString('utf8', 0, 200)
        })
        resp.on('end', () => {
          if (isRateLimited && rlRetries.count < CANVAS_RL_MAX_RETRIES && ctx.state === 'downloading') {
            rlRetries.count++
            const raHdr = resp.headers['retry-after']
            const raStr = Array.isArray(raHdr) ? raHdr[0] : raHdr
            const delay = canvasRlBackoffMs(raStr, rlRetries.count)
            emitProgress({ taskId: ctx.taskId, state: 'downloading', received: ctx.received, total: ctx.total, message: `文件下载被限流(${status})，${Math.round(delay / 1000)}s 后重试 (${rlRetries.count}/${CANVAS_RL_MAX_RETRIES})` })
            const rlTimer = setTimeout(() => {
              ctx.retryTimers.delete(rlTimer)
              if (ctx.state === 'downloading') cdnFetchOnce(url, depth, rlRetries, ctx, cb)
            }, delay)
            ctx.retryTimers.add(rlTimer)
            return
          }
          cb.fail(new Error(`HTTP ${status} ${resp.statusMessage || ''} — ${bodyHead.slice(0, 200)}`.trim()))
        })
        // BUG FIX: missing error handler on non-200 response body stream.
        // Without this, a network error during body collection is an unhandled
        // 'error' event, crashing the process.
        resp.on('error', cb.fail)
        return
      }

      // 调用方自定义 2xx 处理（如云端 CDN 不支持 Range 的 200 回退重建 uploader）
      if (!cb.onHeaders(resp, status, url)) return

      // 计算 total
      const lenHdr = resp.headers['content-length']
      const cl = Number(Array.isArray(lenHdr) ? lenHdr[0] : lenHdr) || 0
      let total: number
      if (status === 206) {
        // Content-Range: bytes start-end/total
        const cr = resp.headers['content-range']
        const crStr = Array.isArray(cr) ? cr[0] : cr
        const m = crStr ? /\/(\d+)$/.exec(crStr) : null
        total = m ? Number(m[1]) : rangeFrom + cl || 0
      } else {
        total = cl
      }
      cb.onResponse(resp, total, status)
    }
  )
  cb.onRequest(req)
  req.end()
}
