// 下载引擎共享层：任务运行时接口 + 全局可变状态 + 跨 local/cloud 共用函数。
//
// 所有共享可变状态（tasks/active/cloudTasks/cloudActive/queues/maps）集中在此模块，
// local.ts / cloud.ts / index.ts（ipc）通过 import 直接操作同一引用。
// sharedActiveCount/hasOngoingTasks 读 active/cloudActive/getHlsActive，放此处避免 local/cloud 互相 import。
// resolveDirectUrl 被 runTask（local）+ cloudRunTask（cloud）共用，按 source 分支懒解析直链。

import type { ClientRequest, IncomingMessage } from 'node:http'
import type { WriteStream } from 'node:fs'
import {
  CANVAS_BASE_URL,
  CNMOOC_BASE_URL,
  V_SJTU_API,
  type CanvasDownloadTaskSpec,
  type DownloadState,
  type DownloadTaskSpec,
  type FileConflictStrategy
} from '../../shared/types'
import { getHlsActive } from '../concurrency'
import { emitProgress } from './progress'
import { getIsQuitting } from '../window'
import { sjtuSession } from '../session'
import { vsjtuFetch } from '../auth'
import type { ChunkedUploader, UploadSessionState } from '../cloudpan'
import { getVodChannelsCached, getExtToolToken, fetchExtToolVodUrl, fetchVsharePlayUrl } from '../canvas/video-tokens'
import { fetchLegacyVodStreamUrls } from '../canvas/legacy-video'
import { sanitizeFsName } from '../../shared/utils'
import { fetchCnmoocResourceUrl, inferCnmoocExt } from '../cnmooc/api'
import { vsjtuVodResolver } from './vsjtu-resolver'

// ─── 接口 ───

export interface TaskRuntime {
  spec: DownloadTaskSpec
  state: DownloadState
  /** 最终落盘文件（rename 目标） */
  filePath: string
  /** 下载过程中的文件 = filePath + '.part' */
  partPath: string
  received: number
  total: number
  req?: ClientRequest
  resp?: IncomingMessage
  ws?: WriteStream
  /** pause/cancel 时调用，强制 settle downloadStream 的 Promise（避免等 resp.destroy 异步触发 error） */
  cancel?: () => void
  /** [B2 Fix] 在途的 retry setTimeout 句柄；pause/cancel/quit 时由 destroyLocalHandles 统一 clearTimeout，
   *  避免 cancel 后定时器仍触发 fetchOnce 发出幽灵请求、quit 后访问已清理 runtime。 */
  retryTimers: Set<ReturnType<typeof setTimeout>>
}

export interface CloudTaskRuntime {
  spec: DownloadTaskSpec
  state: DownloadState
  received: number
  total: number
  req?: ClientRequest
  resp?: IncomingMessage
  uploader?: ChunkedUploader
  /** 暂停时保存的 COS 会话状态，恢复时用于断点续传 */
  uploaderState?: UploadSessionState
  /** pause/cancel 时调用，强制 settle cloudDownloadAndUpload 的 Promise */
  cancel?: () => void
  /** [B2 Fix] 在途的 retry setTimeout 句柄；pause/cancel/quit 时由 destroyCloudHandles 统一 clearTimeout。 */
  retryTimers: Set<ReturnType<typeof setTimeout>>
}

export interface PendingSpec {
  spec: DownloadTaskSpec
  /** 预算的落盘路径（纯字符串拼接，便宜）；本地模式用，云端为空 */
  filePath: string
  partPath: string
}

// ─── 任务注册表 + 队列（惰性任务生成） ───

export const tasks = new Map<string, TaskRuntime>()
export const active = new Set<string>()
export const cloudTasks = new Map<string, CloudTaskRuntime>()
export const cloudActive = new Set<string>()

// download:start 不再为每条 spec 建 TaskRuntime（3000 条会常驻占内存），
// 而是把 spec 存进 pendingLocal/pendingCloud。调度器临下载才 shift 一个
// 出来 new TaskRuntime，完成后立即销毁 → 内存里同时仅 ≈ 并发数个 TaskRuntime。
export const pendingLocal: PendingSpec[] = []
export const pausedLocal: PendingSpec[] = []
export const pendingCloud: DownloadTaskSpec[] = []
export const pausedCloud: DownloadTaskSpec[] = []
// PERF: O(1) duplicate-check index sets for pending/paused arrays.
export const pendingLocalIds = new Set<string>()
export const pausedLocalIds = new Set<string>()
export const pendingCloudIds = new Set<string>()
export const pausedCloudIds = new Set<string>()

/** 云端任务 pause 时保存的 COS 会话状态（resume 续传用）；taskId → state。
 *  仅对已开始下载后 pause 的任务有意义；pending 任务 pause 无此状态。 */
export const cloudPausedStates = new Map<string, UploadSessionState>()

// ─── 冲突策略 + Cookie 注入 map ───

/** 同名文件冲突策略：taskId → 策略。download:start 入队时写入，
 *  runTask/cloudRunTask 临下载时读取。任务完成后由 scheduleCleanupTask 清理。
 *  覆盖 'overwrite' 时：本地先删已存在的目标文件，云盘先删已存在的远端文件再上传。 */
export const conflictStrategyByTask = new Map<string, FileConflictStrategy>()

/** Canvas 文件下载所需的会话 cookie 头：taskId → "name=val; name2=val2"。
 *  resolveDirectUrl 在下载前从 sjtuSession 取 cookie 写入；downloadStream /
 *  cloudDownloadAndUpload 发 node:https 请求时注入。任务完成由 scheduleCleanupTask 清理。 */
export const canvasCookiesByTask = new Map<string, string>()

/** Canvas HTML 站点主机名（oc.sjtu.edu.cn）。Cookie/Referer 只注入给这一跳；
 *  跟随 302 到 s3.jcloud 预签名直链时不带 Canvas cookie（签名直链自包含，无需 cookie）。 */
export const CANVAS_HOST = new URL(CANVAS_BASE_URL).hostname

/** 好大学在线 (cnmooc.sjtu.cn) 文件下载所需的会话 cookie 头：taskId → "name=val; ..."。
 *  resolveDirectUrl 的 'cnmooc' 分支下载前从 sjtuSession 取 cookie 写入；downloadStream /
 *  cloudDownloadAndUpload 发 node:https 请求时仅对 cnmooc 域注入（视频 CDN 直链自包含，无需 cookie）。
 *  任务完成由 scheduleCleanupTask 清理。 */
export const cnmoocCookiesByTask = new Map<string, string>()

/** cnmooc 会话 cookie 需注入的主机：cnmooc.sjtu.cn 及其子域（如 static.cnmooc.sjtu.cn 课件）。
 *  视频 flvUrl 多落在第三方 CDN，不在此列 → 不注入（避免把 cnmooc cookie 泄漏给无关域）。 */
export function isCnmoocCookieHost(hostname: string): boolean {
  return hostname === 'cnmooc.sjtu.cn' || hostname.endsWith('.cnmooc.sjtu.cn')
}

/** Canvas 下载端点在高并发下偶发 403/429 限流，按指数退避重试。
 *  仅对 Canvas 站点（oc.sjtu.edu.cn）的 429/403 重试；S3 的 403（签名/权限）是永久错误，不重试。 */
export const CANVAS_RL_MAX_RETRIES = 4
export function canvasRlBackoffMs(retryAfter: string | undefined, attempt: number): number {
  if (retryAfter && /^\d+$/.test(retryAfter.trim())) return Math.min(Number(retryAfter.trim()) * 1000, 30_000)
  return Math.min(Math.pow(2, attempt) * 1000, 16_000)
}

// ─── 路径常量 ───

export const CLOUD_ROOT_FOLDER = 'SJTU旁听课程'
export const CLOUD_CANVAS_ROOT_FOLDER = 'SJTU Canvas课程'
export const CLOUD_CNMOOC_ROOT_FOLDER = 'SJTU好大学在线'
/** 好大学在线本地下载子目录名（destRoot 之下） */
export const CNMOOC_LOCAL_DIR = '好大学在线'

// ─── 云盘全量重试（网络瞬断兜底） ───
//
// cloudDownloadAndUpload 内部已有分片/confirm 级重试；若仍失败（持续超时/断流），
// 不直接标 error 终止，而是把任务重新塞回 pendingCloud 排队、丢弃旧 COS 会话从头再来，
// 给网络恢复的时间。最多全量重试 CLOUD_MAX_FULL_RETRIES 次，仍失败才真正报错。
export const cloudFullRetries = new Map<string, number>()
export const CLOUD_MAX_FULL_RETRIES = 3

// ─── 共用函数 ───

/** 终态任务清理：立即释放内存。终态任务不会再被 pause/resume/cancel 触发，
 *  重试/恢复走 re-enqueue 新建 TaskRuntime，不依赖旧的。 */
export function scheduleCleanupTask(taskId: string, isCloud: boolean): void {
  if (getIsQuitting()) return
  if (isCloud) {
    const t = cloudTasks.get(taskId)
    if (t) {
      t.req = undefined; t.resp = undefined; t.uploader = undefined; t.cancel = undefined
      t.uploaderState = undefined
      cloudTasks.delete(taskId)
    }
  } else {
    const t = tasks.get(taskId)
    if (t) {
      t.req = undefined; t.resp = undefined; t.ws = undefined; t.cancel = undefined
      tasks.delete(taskId)
    }
  }
  conflictStrategyByTask.delete(taskId)
  canvasCookiesByTask.delete(taskId)
  cnmoocCookiesByTask.delete(taskId)
}

// [2.8] Combined active count for shared concurrency limit across local + cloud
export function sharedActiveCount(): number {
  return active.size + cloudActive.size + getHlsActive()
}

/** 是否有进行中（含排队/暂停）的下载任务。用于判断点最小化/关闭时是否需要弹确认窗。
 *  paused 也计入：关闭会丢失暂停态（进度不持久化），故有暂停任务时同样提示。
 *  renderer 在弹出 Mac 风格确认窗前通过 window:has-ongoing-tasks IPC 查询此结果。 */
export function hasOngoingTasks(): boolean {
  return active.size > 0
    || cloudActive.size > 0
    || getHlsActive() > 0
    || pendingLocal.length > 0
    || pendingCloud.length > 0
    || pausedLocal.length > 0
    || pausedCloud.length > 0
}

/** 销毁本地下载任务的活跃连接/文件流并清引用，统一 pause/cancel/quit 三处重复逻辑 */
export function destroyLocalHandles(t: TaskRuntime, reason: string): void {
  try { t.resp?.destroy() } catch { /* ignore */ }
  try { t.req?.destroy(new Error(reason)) } catch { /* ignore */ }
  try { t.ws?.destroy() } catch { /* ignore */ }
  try { t.cancel?.() } catch { /* ignore */ }
  // [B2 Fix] 清理在途 retry 定时器，防 cancel/quit 后幽灵请求与退出后访问已清理 runtime
  t.retryTimers.forEach(timer => clearTimeout(timer))
  t.retryTimers.clear()
  t.req = undefined
  t.resp = undefined
  t.ws = undefined
  t.cancel = undefined
}

/** 销毁云上传任务的活跃连接并清引用（uploader 由调用方按语义处理） */
export function destroyCloudHandles(t: CloudTaskRuntime, reason: string): void {
  try { t.resp?.destroy() } catch { /* ignore */ }
  try { t.req?.destroy(new Error(reason)) } catch { /* ignore */ }
  // 中止在途的 COS 分片上传，否则 pause/cancel 后上传仍会把整个文件传完
  try { t.uploader?.abort() } catch { /* ignore */ }
  try { t.cancel?.() } catch { /* ignore */ }
  // [B2 Fix] 清理在途 retry 定时器
  t.retryTimers.forEach(timer => clearTimeout(timer))
  t.retryTimers.clear()
  t.req = undefined
  t.resp = undefined
  t.cancel = undefined
}

/** 计算落盘/云盘的「课程相对路径」(root 之下、fileName 之上)。
 *  Canvas courseName 形如 "Canvas课程/{term}/{course}/files/..." —— term 已由
 *  canvasCoursePath 拼入 courseName, 这里只剥掉 "Canvas课程/" 前缀, 不可再用
 *  spec.term 补层, 否则 term 重复两层 → 落盘成 .../Canvas课程/{term}/{term}/{course}/...
 *  (本地与云盘同病)。iframe HLS / PPT 走 cPath 直接拼字符串, 本就不经此函数, 路径正确。
 *  cnmooc / v.sjtu 的 courseName 不含 term, 若 spec.term 存在则在此补一层学期。 */
export function effectiveCourseName(spec: DownloadTaskSpec): string {
  const isCanvas = isCanvasSpec(spec)
  const raw = isCanvas && spec.courseName.startsWith('Canvas课程/')
    ? spec.courseName.slice('Canvas课程/'.length)
    : spec.courseName
  return (!isCanvas && spec.term) ? `${sanitizeFsName(spec.term)}/${raw}` : raw
}

/** 按需解析直链（Canvas 签名 URL + vod-info），runTask 与 cloudRunTask 共用。
 *  await 期间检查 cancel 竞态（统一了两处重复逻辑，并补上 runTask 原先缺失的 cancel 守卫）。
 *  返回 true=可继续下载，false=已被取消或解析失败（调用方直接 return）。 */
export async function resolveDirectUrl(
  t: { spec: DownloadTaskSpec; state: DownloadState; total: number; filePath?: string; partPath?: string },
  isCloud: boolean
): Promise<boolean> {
  const src = (t.spec as CanvasDownloadTaskSpec).source

  // canvas-files：url 可能在 resume 时被清空（reEnqueueLocal/Cloud 强制重解析），
  // 按 fileId 重建 /files/{id}/download 端点。
  if (src === 'canvas-files' && !t.spec.url) {
    const parts = t.spec.taskId.split('_')
    const fileId = Number(parts[parts.length - 1])
    if (fileId > 0) {
      t.spec.url = `${CANVAS_BASE_URL}/files/${fileId}/download?download_frd=1`
    }
  }

  // Canvas 文件（files）：t.spec.url 是 /files/{id}/download 这个 HTML 端点。
  // 下载引擎用裸 node:https 不带 cookie，直接下载会被 302 到
  // /login/canvas（拿到 HTML 登录页存成课件 → 全部损坏）。
  // 这里把 Canvas 会话 cookie 取出来存进 canvasCookiesByTask，由 downloadStream /
  // cloudDownloadAndUpload 在发请求时注入 Cookie 头；node:https 的 fetchOnce 本就
  // 会手动跟随 302，带上 cookie 后能从 /files/{id}/download 跳到 s3.jcloud 预签名
  // 直链并直接下载，无需单独的 ses.fetch 解析步骤（那样会顺带下载文件体、cancel
  // 又无法可靠中止 S3 流，并发时幽灵下载会把真正的 node:https 下载拖死）。
  // 附带好处：HTML 端点每次访问都签发新 URL，暂停数小时后 resume 也不会因签名过期失败。
  if (
    src === 'canvas-files' &&
    /\/files\/\d+\/download/.test(t.spec.url)
  ) {
    try {
      const cookies = await sjtuSession().cookies.get({ url: CANVAS_BASE_URL })
      const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
      if (!cookieHeader) throw new Error('Canvas 会话 cookie 为空，请重新登录后重试')
      canvasCookiesByTask.set(t.spec.taskId, cookieHeader)
    } catch (err) {
      if (t.state === 'cancelled') return false
      t.state = 'error'
      const msg = err instanceof Error ? err.message : String(err)
      emitProgress({ taskId: t.spec.taskId, state: 'error', received: 0, total: 0, message: msg.slice(0, 240) })
      scheduleCleanupTask(t.spec.taskId, isCloud)
      return false
    }
  }

  // 好大学在线 (cnmooc)：注入会话 cookie（视频/课件直链下载用），url 为空时懒解析直链。
  // 扫描阶段不预探直链（用户选择「仅下载时懒解析」），build-specs 产 url:'' 占位 spec；
  // 此处逐任务 POST play.mooc+detail.mooc 取直链，按 cnmoocResourceFilter 过滤，并补全扩展名。
  // pause/resume 或 error 重试时 url 被清空（reEnqueueLocal/Cloud），会重新解析（防直链过期）。
  if (src === 'cnmooc') {
    // 注入 cnmooc 会话 cookie（无论 url 是否已填，下载请求都需要）
    try {
      const cookies = await sjtuSession().cookies.get({ url: CNMOOC_BASE_URL })
      const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
      if (cookieHeader) cnmoocCookiesByTask.set(t.spec.taskId, cookieHeader)
    } catch {
      /* cookie 拉取失败不致命：视频 CDN 直链可能本就不需要 cookie */
    }

    // 懒解析直链（url 已填则跳过）
    if (!t.spec.url) {
      const cs = t.spec as CanvasDownloadTaskSpec
      if (cs.cnmoocItemId) {
        if (t.state !== 'cancelled') {
          t.state = 'downloading'
          emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: 0, total: 0, message: '解析资源直链…' })
        }
        try {
          const r = await fetchCnmoocResourceUrl(sjtuSession(), {
            itemId: cs.cnmoocItemId,
            itemType: cs.cnmoocItemType ?? '10',
            title: t.spec.fileName
          })
          if (t.state === 'cancelled') return false
          if (!r?.url) throw new Error('未获取到资源直链')

          // 资源类型过滤：仅视频/仅课件时不匹配则标 skipped
          const filter = cs.cnmoocResourceFilter
          if (filter && filter !== 'all' && r.type !== filter) {
            t.state = 'skipped'
            emitProgress({
              taskId: t.spec.taskId,
              state: 'skipped',
              received: 0,
              total: 0,
              message: filter === 'video' ? '已按筛选条件跳过（仅视频）' : '已按筛选条件跳过（仅课件）'
            })
            scheduleCleanupTask(t.spec.taskId, isCloud)
            return false
          }

          t.spec.url = r.url

          // 补全扩展名：扫描阶段 fileName 无扩展名，按直链推断补上（.mp4/.pdf 等）。
          // 本地任务同步更新 filePath/partPath（download:start 时按无扩展名 fileName 算的）；
          // 云端无 filePath，cloudRemotePath 用更新后的 fileName 自动生效。
          const ext = inferCnmoocExt(r.url)
          if (ext && !t.spec.fileName.toLowerCase().endsWith(ext.toLowerCase())) {
            t.spec.fileName = t.spec.fileName + ext
            if (t.filePath && !t.filePath.toLowerCase().endsWith(ext.toLowerCase())) {
              t.filePath = t.filePath + ext
              t.partPath = t.filePath + '.part'
            }
          }
        } catch (err) {
          if (t.state === 'cancelled') return false
          t.state = 'error'
          const msg = err instanceof Error ? err.message : String(err)
          emitProgress({ taskId: t.spec.taskId, state: 'error', received: 0, total: 0, message: msg.slice(0, 240) })
          scheduleCleanupTask(t.spec.taskId, isCloud)
          return false
        }
      }
    }
  }

  if (t.spec.url) return true

  // Canvas 课堂视频：按 videoId 解析流直链（带缓存，同 videoId 教师+PPT 共享一次解析）
  if (src === 'canvas-class-video') {
    const cs = t.spec as CanvasDownloadTaskSpec
    if (cs.canvasVideoId && cs.canvasVideoToken) {
      if (t.state !== 'cancelled') {
        t.state = 'downloading'
        emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: 0, total: 0, message: '解析视频流…' })
      }
      try {
        const channels = await getVodChannelsCached(sjtuSession(), cs.canvasVideoToken, cs.canvasVideoId)
        let ch = channels[cs.canvasStreamIdx ?? 0]
        if (!ch && channels.length > 0) {
          ch = channels[0]
        }
        if (!ch?.url) throw new Error(`未找到该路视频流（streamIdx=${cs.canvasStreamIdx ?? 0}）`)
        t.spec.url = ch.url
        t.spec.isHls = ch.url.includes('.m3u8')
      } catch (err) {
        if (t.state === 'cancelled') return false
        t.state = 'error'
        const msg = err instanceof Error ? err.message : String(err)
        emitProgress({ taskId: t.spec.taskId, state: 'error', received: 0, total: 0, message: msg.slice(0, 240) })
        scheduleCleanupTask(t.spec.taskId, isCloud)
        return false
      }
    }
  }

  // ExternalTool 模块视频：v.sjtu LTI（课程级 token 缓存）→ /file/{fileId} → S3 MP4 直链。
  // token 是课程级的，任选一个 ExternalTool 模块项跳转即服务全课所有 fileId，24h 内复用。
  // S3 直链（etv.sjtu.edu.cn）自包含签名，downloadStream 不需注入 cookie。
  if (src === 'canvas-exttool-video' && !t.spec.url) {
    const cs = t.spec as CanvasDownloadTaskSpec
    if (cs.canvasFileId && cs.canvasCourseId && cs.canvasModuleItemId) {
      if (t.state !== 'cancelled') {
        t.state = 'downloading'
        emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: 0, total: 0, message: 'LTI 解析视频…' })
      }
      try {
        const token = await getExtToolToken(sjtuSession(), cs.canvasCourseId, cs.canvasModuleItemId)
        const vod = await fetchExtToolVodUrl(sjtuSession(), cs.canvasCourseId, cs.canvasFileId, token)
        if (!vod.url) throw new Error('未获取到视频直链')
        t.spec.url = vod.url
        if (vod.fileSize > 0) t.total = vod.fileSize
      } catch (err) {
        if (t.state === 'cancelled') return false
        const msg = err instanceof Error ? err.message : String(err)
        // token 失效：fetchExtToolVodUrl 已清缓存，重试一次（重新 LTI 跳转换新 token）
        if (/登录信息无效|未登录|过期|无效的token|token已失效/.test(msg)) {
          try {
            const token2 = await getExtToolToken(sjtuSession(), cs.canvasCourseId, cs.canvasModuleItemId)
            const vod2 = await fetchExtToolVodUrl(sjtuSession(), cs.canvasCourseId, cs.canvasFileId, token2)
            if (vod2.url) {
              t.spec.url = vod2.url
              if (vod2.fileSize > 0) t.total = vod2.fileSize
            } else { throw new Error('重试仍未获取到视频直链') }
          } catch { /* 重试也失败，走下面的 error 路径 */ }
        }
        if (!t.spec.url) {
          t.state = 'error'
          emitProgress({ taskId: t.spec.taskId, state: 'error', received: 0, total: 0, message: msg.slice(0, 240) })
          scheduleCleanupTask(t.spec.taskId, isCloud)
          return false
        }
      }
    }
  }

  // ExternalUrl 模块视频：vshare /api/video/play/{uuid}（带 vshare cookie）→ S3 MP4 直链。
  // vshare 经 jAccount SSO 登录，ses 已有 cookie；S3 直链自包含签名。
  if (src === 'canvas-exturl-video' && !t.spec.url) {
    const cs = t.spec as CanvasDownloadTaskSpec
    if (cs.canvasVshareUuid) {
      if (t.state !== 'cancelled') {
        t.state = 'downloading'
        emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: 0, total: 0, message: '解析 vshare 视频…' })
      }
      try {
        const vod = await fetchVsharePlayUrl(sjtuSession(), cs.canvasVshareUuid)
        if (!vod.url) throw new Error('未获取到视频直链')
        t.spec.url = vod.url
        if (vod.fileSize > 0) t.total = vod.fileSize
      } catch (err) {
        if (t.state === 'cancelled') return false
        t.state = 'error'
        const msg = err instanceof Error ? err.message : String(err)
        emitProgress({ taskId: t.spec.taskId, state: 'error', received: 0, total: 0, message: msg.slice(0, 240) })
        scheduleCleanupTask(t.spec.taskId, isCloud)
        return false
      }
    }
  }

  // 旧版录播中心（courses.sjtu.edu.cn / legacy-video）：支持 pause/resume 及网络重试时重新拉取直链
  if (src === 'canvas-video' && !t.spec.url) {
    const cs = t.spec as CanvasDownloadTaskSpec
    if (cs.canvasVideoId) {
      if (t.state !== 'cancelled') {
        t.state = 'downloading'
        emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: 0, total: 0, message: '解析旧版录播直链…' })
      }
      try {
        const streamUrls = await fetchLegacyVodStreamUrls(sjtuSession(), cs.canvasVideoId)
        const targetUrl = cs.canvasStreamIdx === 1 ? streamUrls.pptUrl : streamUrls.teacherUrl
        if (!targetUrl) throw new Error('未获取到旧版录播视频直链')
        t.spec.url = targetUrl
      } catch (err) {
        if (t.state === 'cancelled') return false
        t.state = 'error'
        const msg = err instanceof Error ? err.message : String(err)
        emitProgress({ taskId: t.spec.taskId, state: 'error', received: 0, total: 0, message: msg.slice(0, 240) })
        scheduleCleanupTask(t.spec.taskId, isCloud)
        return false
      }
    }
  }

  if (!t.spec.url && t.spec.refId != null) {
    if (t.state !== 'cancelled') {
      t.state = 'downloading'
      emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: 0, total: 0, message: '解析直链…' })
    }
    try {
      const res = await vsjtuVodResolver.resolveVodStream(
        t.spec.refId,
        t.spec.angle ?? 0,
        async (id) => vsjtuFetch(`${V_SJTU_API.vodInfoByCourseId}?courseId=${encodeURIComponent(id)}`)
      )
      if (!res.success || !res.streamUrl) {
        throw new Error('该课次暂无可用视频流')
      }
      t.spec.url = res.streamUrl
    } catch (err) {
      if (t.state === 'cancelled') return false
      t.state = 'error'
      const msg = err instanceof Error ? err.message : String(err)
      emitProgress({ taskId: t.spec.taskId, state: 'error', received: 0, total: 0, message: msg.slice(0, 240) })
      scheduleCleanupTask(t.spec.taskId, isCloud)
      return false
    }
  }

  // 被 pause/cancel 则中止（await 期间用户可能点了暂停/取消）
  return t.state !== 'paused' && t.state !== 'cancelled'
}

/** 从 spec 数组移除指定 taskId 的项 */
export function removeFromSpecArray<T extends { spec?: DownloadTaskSpec } | DownloadTaskSpec>(
  arr: T[], taskId: string
): T | undefined {
  const i = arr.findIndex(item => ('spec' in item ? item.spec?.taskId : (item as DownloadTaskSpec).taskId) === taskId)
  if (i < 0) return undefined
  return arr.splice(i, 1)[0]
}

/** 判断是否为 Canvas 任务 */
export function isCanvasSpec(spec: DownloadTaskSpec): boolean {
  return !!(spec as CanvasDownloadTaskSpec).source?.startsWith?.('canvas')
}

/** 判断是否为好大学在线 (cnmooc) 任务 */
export function isCnmoocSpec(spec: DownloadTaskSpec): boolean {
  return (spec as CanvasDownloadTaskSpec).source === 'cnmooc'
}

/** 判断任务是否为 HLS 视频流任务（需要通过 HLS 管道下载 TS 切片并 remux 转码） */
export function isHlsStreamTask(spec: any): boolean {
  if (!spec) return false
  if (spec.source === 'canvas-class-video') return true
  if (spec.isHls === true) return true
  const url = String(spec.url || '').toLowerCase()
  if (url.endsWith('.m3u8') || url.includes('.m3u8?') || url.includes('.m3u8#')) return true
  return false
}

/** 提取错误消息字符串，统一处理 unknown 类型的 error 入参 */
export function extractErrorMessage(err: unknown, fallback = '未知错误'): string {
  return err instanceof Error ? err.message : String(err || fallback)
}

/** 判定云盘上传错误是否值得全量重试（网络/超时/服务端临时错误）。
 *  4xx 鉴权类（401/403）、会话逻辑错误不重试 —— 重试也无益。
 *  [B7 Fix] 补匹配「上传会话已过期」（renewWithRetry 两次 400 后抛），让过期 COS 会话走全量重试自愈。 */
export function isTransientCloudError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '')
  if (/timeout|aborted|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/i.test(msg)) return true
  if (/HTTP 5\d\d/.test(msg)) return true
  if (/MultipartUploadIncomplete/i.test(msg)) return true
  if (/上传会话已过期/i.test(msg)) return true  // [B7 Fix]
  return false
}

// ─── 文件完整性守卫 (R2-F4) ───
export {
  FileIntegrityError,
  type FileIntegrityResult,
  isHtmlExtension,
  verifyDownloadIntegrity,
  assertDownloadIntegrity
} from './integrity'

