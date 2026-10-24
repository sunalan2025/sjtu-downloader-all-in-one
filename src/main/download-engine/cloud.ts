// 云盘上传引擎：CDN 边下载边分片直传 COS + 暂停/取消/恢复（含断点续传）。
//
// 状态（cloudTasks/cloudActive/queues/cloudPausedStates/cloudFullRetries）在 shared.ts，
// 本模块通过 import 直接操作同一引用。与 local 调度器通过 concurrency 的 reschedule 回调联动。
// COS 分片 4MB，边下边传内存恒定；断点续传用 UploadSessionState 保存已传分片。

import type { ClientRequest, IncomingMessage } from 'node:http'
import { type DownloadState, type DownloadTaskSpec } from '../../shared/types'
import {
  type CloudTaskRuntime,
  cloudTasks,
  cloudActive,
  pendingCloud,
  pausedCloud,
  pendingCloudIds,
  pausedCloudIds,
  cloudPausedStates,
  cloudFullRetries,
  CLOUD_MAX_FULL_RETRIES,
  conflictStrategyByTask,
  CLOUD_ROOT_FOLDER,
  CLOUD_CANVAS_ROOT_FOLDER,
  CLOUD_CNMOOC_ROOT_FOLDER,
  scheduleCleanupTask,
  resolveDirectUrl,
  destroyCloudHandles,
  removeFromSpecArray,
  isCanvasSpec,
  isCnmoocSpec,
  isTransientCloudError,
  effectiveCourseName,
  sharedActiveCount
} from './shared'
import { cdnFetchOnce, type CdnFetchContext, type CdnFetchCallbacks } from './cdn-fetch'
import {
  noteNetworkRecovery,
  noteNetworkError,
  isDnsError,
  noteDownloadBytes,
  noteUploadBytes,
  getConcurrency,
  isNetworkHealthy,
  ensureNetworkResumeTimer
} from '../concurrency'
import { getIsQuitting } from '../window'
import { emitProgress } from './progress'
import { notifyConcurrencySlotAvailable } from '../canvas/orchestrator'
import { sanitizeForLog } from '../canvas/safe-fetch'
import { sanitizeFsName, buildCloudRemoteSegments } from '../../shared/utils'
import { ChunkedUploader, FileExistsError, deleteCloudFile, ensureFolderPath, startChunkedUpload, resumeChunkedUpload } from '../cloudpan'

const CHUNK_SIZE = 4 * 1024 * 1024 // 4 MB per COS part
const MAX_BUFFER_CHUNKS = 2 // 内存中最多缓冲 2 个 4MB 块 → 8MB

/** 把一个 paused 的云端 spec 重新入待处理队列（resume 用） */
export function reEnqueueCloud(spec: DownloadTaskSpec): void {
  // [Bug Fix] 同 reEnqueueLocal：清掉过期直链，cloudRunTask 会重新解析。
  spec.url = ''
  pendingCloud.push(spec)
  pendingCloudIds.add(spec.taskId)
  pausedCloudIds.delete(spec.taskId)
  emitProgress({ taskId: spec.taskId, state: 'pending', received: 0, total: 0 })
}

export function cloudScheduleNext(): void {
  if (getIsQuitting()) return
  while (sharedActiveCount() < getConcurrency() && pendingCloud.length > 0) {
    // 网络不佳时暂停拉取新任务，让活跃任务优先重试
    if (!isNetworkHealthy()) {
      ensureNetworkResumeTimer()
      break
    }
    // 惰性 materialization：临下载才从 pendingCloud 取 spec 建 CloudTaskRuntime
    const spec = pendingCloud.shift()!
    pendingCloudIds.delete(spec.taskId)
    const existing = cloudTasks.get(spec.taskId)
    if (existing && (existing.state === 'pending' || existing.state === 'downloading' || existing.state === 'paused')) {
      continue
    }
    const t: CloudTaskRuntime = { spec, state: 'pending', received: 0, total: 0, retryTimers: new Set() }
    cloudTasks.set(spec.taskId, t)
    cloudActive.add(spec.taskId)
    // [B3 Fix] .catch 兜底：同 runTask，防 cloudRunTask reject 导致 cloudActive 永不释放。
    void cloudRunTask(t).catch(err => {
      console.error('[cloudRunTask] unhandled rejection:', sanitizeForLog(err instanceof Error ? err.message : err))
      t.state = 'error'
      emitProgress({ taskId: t.spec.taskId, state: 'error', received: t.received, total: t.total, message: '内部错误' })
      destroyCloudHandles(t, 'internal error')
    }).finally(() => {
      cloudActive.delete(spec.taskId)
      t.req = undefined
      t.resp = undefined
      t.uploader = undefined
      notifyConcurrencySlotAvailable()
      cloudScheduleNext()
    })
  }
}

/** 计算 ensureFolderPath 的参数列表（逐级创建文件夹） */
export function cloudFolderSegments(spec: DownloadTaskSpec): string[] {
  const defaultRoot = isCnmoocSpec(spec) ? CLOUD_CNMOOC_ROOT_FOLDER
    : isCanvasSpec(spec) ? CLOUD_CANVAS_ROOT_FOLDER
    : CLOUD_ROOT_FOLDER
  return buildCloudRemoteSegments(spec.cloudDestRoot, effectiveCourseName(spec).split('/'), defaultRoot)
}

/** 根据任务 spec 计算云盘远端路径 */
export function cloudRemotePath(spec: DownloadTaskSpec): string {
  return [...cloudFolderSegments(spec), sanitizeFsName(spec.fileName)].join('/')
}

async function cloudRunTask(t: CloudTaskRuntime): Promise<void> {
  t.state = 'downloading'

  // 恢复 pause 时保存的 COS 会话状态（惰性模型下 uploaderState 不随 spec 传输，存于 cloudPausedStates）
  if (!t.uploaderState) {
    const saved = cloudPausedStates.get(t.spec.taskId)
    if (saved) {
      t.uploaderState = saved
      cloudPausedStates.delete(t.spec.taskId)
    }
  }

  // 按需解析直链（lazy resolution，与 runTask 共用；含 cancel 竞态守卫）
  if (!await resolveDirectUrl(t, true)) return

  // 替换模式：上传前先删除云盘上已存在的同名文件，避免 startChunkedUpload
  // 的 HEAD 检查抛 FileExistsError。断点续传（uploaderState 非空）时跳过——
  // 那是上次未完成的上传，应继续而非删了重来。
  const strategy = conflictStrategyByTask.get(t.spec.taskId) ?? 'skip'
  if (strategy === 'overwrite' && !t.uploaderState && t.spec.cloudUserToken) {
    try {
      await deleteCloudFile(t.spec.cloudUserToken, cloudRemotePath(t.spec))
    } catch (err) {
      // 删除失败不致命：仍尝试上传，由 startChunkedUpload 的冲突判定兜底
      console.warn('[cloudpan] 替换模式删除旧文件失败，继续尝试上传:', sanitizeForLog(err instanceof Error ? err.message : err))
    }
  }

  // 断点续传：已传字节对应的 CDN Range 起点
  // [B6 Fix] 用 bytesReceived（真实字节）而非 (nextPart-1)*CHUNK_SIZE：
  // 若 pause 时最后一片是不足 4MB 的部分片且已上传，nextPart++ 但 bytesReceived 是实际字节，
  // 原 (nextPart-1)*CHUNK_SIZE > bytesReceived → CDN Range 重传一片（COS 幂等不损坏）但
  // uploadChunk 又 bytesReceived += chunk.length → 进度重复计入，可能 received > total。
  const resumeFromByte = t.uploaderState
    ? t.uploaderState.bytesReceived
    : 0
  // 启动期间（resolveDirectUrl / deleteCloudFile 的 await）用户可能点了暂停/取消：
  // 此时 t.cancel 尚未挂载（在 cloudDownloadAndUpload 内才设置），destroyCloudHandles
  // 无法中止。这里显式检查状态，避免暂停后又把 CDN 拉流和 COS 上传会话建起来。
  if ((t.state as DownloadState) === 'paused' || (t.state as DownloadState) === 'cancelled') return
  emitProgress({
    taskId: t.spec.taskId,
    state: 'downloading',
    received: resumeFromByte,
    total: t.total
  })

  try {
    await cloudDownloadAndUpload(t)
    if ((t.state as DownloadState) === 'cancelled') return
    t.state = 'done'
    t.uploaderState = undefined
    cloudPausedStates.delete(t.spec.taskId)
    cloudFullRetries.delete(t.spec.taskId)  // 成功 → 清掉全量重试计数
    // CDN 下载字节已在 cloudDownloadAndUpload 的 data 事件里逐块计入 noteDownloadBytes，此处不重复累计
    emitProgress({
      taskId: t.spec.taskId,
      state: 'done',
      received: t.received,
      total: t.total || t.received,
      cloudPath: cloudRemotePath(t.spec)
    })
    scheduleCleanupTask(t.spec.taskId, true)
  } catch (err) {
    const finalState = t.state as DownloadState
    if (finalState === 'paused' || finalState === 'cancelled') return
    if (err instanceof FileExistsError) {
      t.state = 'skipped'
      cloudFullRetries.delete(t.spec.taskId)
      emitProgress({
        taskId: t.spec.taskId,
        state: 'skipped',
        received: 0,
        total: 0,
        message: '云盘已存在，跳过'
      })
      scheduleCleanupTask(t.spec.taskId, true)
      return
    }

    // [网络鲁棒性] 瞬时网络错误（超时/断流/5xx/分片未整合/会话过期）且未超全量重试上限 →
    // 丢弃旧 COS 会话、从头重新入队，给网络恢复时间，而非直接报错终止。
    const retries = cloudFullRetries.get(t.spec.taskId) ?? 0
    if (!getIsQuitting() && isTransientCloudError(err) && retries < CLOUD_MAX_FULL_RETRIES) {
      cloudFullRetries.set(t.spec.taskId, retries + 1)
      noteNetworkError()  // 喂入网络健康门，触发 30s 冷却再拉新任务
      // 丢弃旧上传会话（可能已损坏），销毁连接与句柄，下次从头建新会话
      destroyCloudHandles(t, 'transient error')
      t.uploaderState = undefined
      cloudPausedStates.delete(t.spec.taskId)
      // 从 cloudTasks 移除旧 runtime，让 cloudScheduleNext 重新物化出干净的 runtime
      cloudTasks.delete(t.spec.taskId)
      // 重新入待处理队列
      pendingCloud.push(t.spec)
      pendingCloudIds.add(t.spec.taskId)
      const msg = err instanceof Error ? err.message : String(err)
      emitProgress({
        taskId: t.spec.taskId,
        state: 'pending',
        received: 0,
        total: 0,
        message: `网络中断（${msg.slice(0, 60)}），重新排队重试 (${retries + 1}/${CLOUD_MAX_FULL_RETRIES})`
      })
      // 不调 scheduleCleanupTask —— 任务仍在（换了 runtime）。
      // finally 会 cloudScheduleNext() 把它重新拉起；网络不健康时由 30s 冷却门兜底等待。
      return
    }

    t.state = 'error'
    cloudFullRetries.delete(t.spec.taskId)  // 到此为永久失败，清计数
    if (t.uploader) {
      t.uploaderState = t.uploader.getState()
    }
    const msg = err instanceof Error ? err.message : String(err || '上传失败')
    emitProgress({
      taskId: t.spec.taskId,
      state: 'error',
      received: t.received,
      total: t.total,
      message: retries >= CLOUD_MAX_FULL_RETRIES
        ? `重试 ${CLOUD_MAX_FULL_RETRIES} 次仍失败：${msg.slice(0, 180)}`
        : msg.slice(0, 240)
    })
  }
}

/** 从 CDN 流式下载视频，每积满 4MB 就上传一个 COS 分片。
 *  uploader 是外层闭包变量，CDN 200 回退时可就地替换，避免旧 handler 引用过期 session。 */
function cloudDownloadAndUpload(t: CloudTaskRuntime): Promise<void> {
  const userToken = t.spec.cloudUserToken
  if (!userToken) return Promise.reject(new Error('cloudUserToken is required'))

  return new Promise<void>((resolve, reject) => {
    let settled = false
    const fail = (e: Error): void => {
      if (settled) return
      settled = true
      reject(e)
    }
    const ok = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    t.cancel = () => {
      if (settled) return
      settled = true
      reject(new Error('cancelled'))
    }

    const remotePath = cloudRemotePath(t.spec)
    const startUrl = t.spec.url

    // 外层闭包变量：所有 handler 通过引用访问，CDN 200 回退时就地替换
    let uploader: ChunkedUploader
    let activeReq: ClientRequest | undefined
    let activeResp: IncomingMessage | undefined
    let retryCount = 0
    const MAX_RETRIES = 3
    // Canvas 下载端点限流重试计数（429/403，仅 oc.sjtu.edu.cn 这一跳；跨 fetchOnce 共享）
    const rlRetries = { count: 0 }

    const doFetch = (): void => {
      // 按块收集，仅在拼满 CHUNK_SIZE 时才 Buffer.concat，避免 O(n²) 逐块复制
      let chunks: Buffer[] = []
      let chunksLen = 0
      let uploading = false
      let ended = false
      let timedOut = false  // 防止 timeout + error 双重重试

      // 串行上传：同一时刻只有一个分片在传（含末尾 confirm）。
      // [Bug Fix] 原 flushToUpload 未检查 uploading，数据到达快时多个分片并发上传，
      // 并发 uploadChunk 会竞争共享的 parts/expiration 凭证状态（renewWithRetry 就地重写），
      // 导致取到过期/缺失凭证 → COS PUT 400 → 最终 confirm 报 MultipartUploadIncomplete。
      // 网络越差上传越慢、缓冲堆积越多、并发竞争越频繁，故"网络不好时上传末段 400"。
      // 串行化后凭证不再竞争；.then 回调里递归调用本函数排空后续分片或触发 confirm。
      const tryUploadNext = (): void => {
        if (settled) return  // 已 pause/cancel/完成 → 不再启动新的分片上传或 confirm
        if (uploading) return
        // resp 已结束且无残留 → 全部分片已上传，confirm 收尾
        if (ended && chunksLen === 0) {
          uploading = true
          void uploader.confirm().then(ok).catch(fail)
          return
        }
        // 攒满一片，或已结束但还有不足一片的尾段 → 上传
        if (chunksLen >= CHUNK_SIZE || (ended && chunksLen > 0)) {
          const sendBuf = Buffer.concat(chunks)
          chunks = []
          chunksLen = 0
          const uploadBuf = sendBuf.subarray(0, CHUNK_SIZE)
          const remainder = sendBuf.subarray(CHUNK_SIZE)
          if (remainder.length > 0) {
            chunks.push(remainder)
            chunksLen = remainder.length
          }
          uploading = true
          void uploader.uploadChunk(uploadBuf).then(() => {
            // 上传字节计入速度指标
            noteUploadBytes(uploadBuf.length)
            uploading = false
            // [Bug Fix] 一片上传成功即重置 CDN 拉流重试计数。
            // 原 retryCount 作用于整个 cloudDownloadAndUpload，长任务累计 3 次独立
            // 网络抖动（即便每次都恢复）就会整体 fail，把传到 99% 的大文件放弃掉。
            // 按"成功推进即清零"的滑动口径，只有连续失败才计入上限。
            retryCount = 0
            // 背压解除：缓冲降下来后恢复 CDN 拉流
            if (!ended && chunksLen < CHUNK_SIZE * MAX_BUFFER_CHUNKS && activeResp) {
              try { activeResp.resume() } catch { /* ignore */ }
            }
            tryUploadNext()  // 排空下一片，或进入 confirm
          }).catch((e: Error) => {
            fail(e)
          })
        }
        // 否则：数据不足一片且未结束，等待更多 data 到达
      }

      // [Phase 2] fetchOnce 公共骨架（cookie 注入 / 重定向拦截 / 限流重试 / total
      // 解析）抽取到 cdn-fetch.ts；此处保留云端特有部分：Range 起点 = uploader
      // 已收字节、CDN 不支持 Range 的 200 回退重建 uploader、请求级指数退避重试。
      const ctx: CdnFetchContext = {
        taskId: t.spec.taskId,
        get state() { return t.state },
        retryTimers: t.retryTimers,
        get received() { return t.received },
        get total() { return t.total },
        getRangeFrom: () => uploader.bytesReceived
      }
      const cb: CdnFetchCallbacks = {
        fail,
        // CDN 不支持 Range（带 Range 但返回 200 而非 206）：销毁旧请求，重建 uploader，重新开始
        onHeaders: (resp, status) => {
          if (uploader.bytesReceived > 0 && status === 200) {
            console.warn('[cloudpan:cdn] CDN 不支持 Range，从头重新上传')
            // [Bug 33 Fix] 先移除旧 resp 上的监听器，防止旧流的 data/end 事件干扰新会话
            resp.removeAllListeners()
            resp.resume()
            try { activeReq?.destroy() } catch { /* ignore */ }
            t.uploaderState = undefined
            chunks = []; chunksLen = 0
            uploading = false; ended = false
            void ensureFolderPath(userToken, ...cloudFolderSegments(t.spec))
              .then(() => startChunkedUpload(userToken, remotePath))
              .then(u2 => {
                if (settled) return
                uploader = u2  // 就地替换，所有 handler 引用同一个变量
                t.uploader = u2
                retryCount = 0
                doFetch()      // 全新 fetch 会话
              }).catch(fail)
            return false
          }
          return true
        },
        onResponse: (resp, total) => {
          noteNetworkRecovery()
          t.total = total

          if (!settled) emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: uploader.bytesReceived, total: t.total })
          let lastEmit = 0

          resp.on('data', (chunk: Buffer) => {
            if (settled) { try { resp.destroy() } catch { /* ignore */ } ; return }
            const s = t.state as DownloadState
            if (s === 'paused' || s === 'cancelled') {
              try { resp.destroy() } catch { /* ignore */ }
              return
            }

            chunks.push(chunk)
            chunksLen += chunk.length
            t.received += chunk.length
            noteDownloadBytes(chunk.length)  // CDN 下载字节（上传字节在 uploadChunk 完成时计入 noteUploadBytes）

            if (chunksLen >= CHUNK_SIZE * MAX_BUFFER_CHUNKS) {
              try { resp.pause() } catch { /* ignore */ }
            }

            tryUploadNext()

            const now = Date.now()
            if (now - lastEmit > 250) {
              lastEmit = now
              emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: uploader.bytesReceived, total: t.total })
            }
          })

          resp.on('end', () => {
            if (resp.destroyed) return
            ended = true
            // 上传剩余不足一片的尾段；无残留则直接 confirm
            tryUploadNext()
          })

          resp.on('error', (err: Error) => {
            if (retryCount < MAX_RETRIES && t.state === 'downloading') {
              retryCount++
              noteNetworkError()
              const delay = Math.pow(2, retryCount) * 1000
              const label = isDnsError(err) ? 'DNS 解析失败' : '网络错误'
              console.warn(`[cloudpan:cdn] ${label}，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES}): ${err.message}`)
              emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: uploader.bytesReceived, total: t.total, message: `${label}，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES})` })
              const retryTimer = setTimeout(() => {
                t.retryTimers.delete(retryTimer)
                if (t.state !== 'downloading') return
                doFetch()
              }, delay)
              t.retryTimers.add(retryTimer)
            } else {
              fail(err)
            }
          })
        },
        onRequest: (req) => {
          activeReq = req
          t.req = req
          req.setTimeout(60_000, () => {
            if (retryCount < MAX_RETRIES && t.state === 'downloading') {
              timedOut = true
              retryCount++
              noteNetworkError()
              const delay = Math.pow(2, retryCount) * 1000
              console.warn(`[cloudpan:cdn] 请求超时，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES})`)
              emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: uploader.bytesReceived, total: t.total, message: `请求超时，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES})` })
              try { req.destroy() } catch { /* ignore */ }
              const retryTimer = setTimeout(() => {
                t.retryTimers.delete(retryTimer)
                if (settled || t.state !== 'downloading') return
                doFetch()
              }, delay)
              t.retryTimers.add(retryTimer)
            } else {
              req.destroy(new Error('请求超时（60s）'))
            }
          })
          req.on('error', (err: Error) => {
            // timeout handler 已处理重试，跳过
            if (timedOut) return
            if (!settled && retryCount < MAX_RETRIES && t.state === 'downloading') {
              retryCount++
              noteNetworkError()
              const delay = Math.pow(2, retryCount) * 1000
              const label = isDnsError(err) ? 'DNS 解析失败' : '连接错误'
              console.warn(`[cloudpan:cdn] ${label}，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES})`)
              emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: uploader.bytesReceived, total: t.total, message: `${label}，${delay / 1000}s 后重试 (${retryCount}/${MAX_RETRIES})` })
              const retryTimer = setTimeout(() => {
                t.retryTimers.delete(retryTimer)
                if (settled || t.state !== 'downloading') return
                doFetch()
              }, delay)
              t.retryTimers.add(retryTimer)
            } else if (!settled) {
              fail(err)
            }
          })
        },
        onRespAttached: (resp) => {
          activeResp = resp
          t.resp = resp
        }
      }

      cdnFetchOnce(startUrl, 0, rlRetries, ctx, cb)

    }

    // 初始化 uploader，然后开始下载
    const uploaderPromise = t.uploaderState
      ? resumeChunkedUpload(userToken, t.uploaderState)
      : ensureFolderPath(userToken, ...cloudFolderSegments(t.spec)).then(() => startChunkedUpload(userToken, remotePath))

    uploaderPromise.then(u0 => {
      if (settled) return
      uploader = u0
      t.uploader = u0
      doFetch()
    }).catch(fail)
  })
}

// ─── 任务级控制 ─────────────────────────────────────────────────

/** 暂停核心：活跃任务保存 COS 会话 + 销毁句柄；pending 任务移到 pausedCloud。不调度 */
function cloudPauseTaskCore(id: string): void {
  const t = cloudTasks.get(id)
  if (t) {
    if (t.state !== 'downloading' && t.state !== 'pending') return
    t.state = 'paused'
    cloudActive.delete(id)
    emitProgress({ taskId: id, state: 'paused', received: t.received, total: t.total, message: '已暂停' })
    // 保存 COS 会话状态，用于恢复时断点续传（先存再 destroy，getState 同步安全）
    if (t.uploader) t.uploaderState = t.uploader.getState()
    if (t.uploaderState) cloudPausedStates.set(id, t.uploaderState)
    destroyCloudHandles(t, 'paused')
    t.uploader = undefined
    // spec 移入 pausedCloud 待 resume
    pausedCloud.push(t.spec)
    pausedCloudIds.add(id)
    cloudTasks.delete(id)
    return
  }
  // 还在 pendingCloud → 移到 pausedCloud
  const spec = removeFromSpecArray(pendingCloud, id)
  if (spec) {
    emitProgress({ taskId: id, state: 'paused', received: 0, total: 0, message: '已暂停' })
    pausedCloud.push(spec)
    pendingCloudIds.delete(id)
    pausedCloudIds.add(id)
  }
}

export function cloudPauseTask(id: string): void {
  cloudPauseTaskCore(id)
  cloudScheduleNext()
}

/** 取消核心：活跃任务销毁句柄 + 丢弃会话；pending/paused 任务从队列移除。不调度 */
function cloudCancelTaskCore(id: string): void {
  const t = cloudTasks.get(id)
  if (t) {
    if (t.state === 'done' || t.state === 'cancelled' || t.state === 'skipped') return
    t.state = 'cancelled'
    cloudActive.delete(id)
    emitProgress({ taskId: id, state: 'cancelled', received: t.received, total: t.total, message: '已取消' })
    destroyCloudHandles(t, 'cancelled')
    t.uploader = undefined
    t.uploaderState = undefined
    cloudTasks.delete(id)
    cloudPausedStates.delete(id)
    // [B1 Fix] 清掉全量重试计数，否则同 taskId 重新下载时 cloudRunTask 取到陈旧值，过早触发「重试耗尽」永久失败
    cloudFullRetries.delete(id)
    scheduleCleanupTask(id, true)
    return
  }
  if (removeFromSpecArray(pendingCloud, id) || removeFromSpecArray(pausedCloud, id)) {
    emitProgress({ taskId: id, state: 'cancelled', received: 0, total: 0, message: '已取消' })
    cloudPausedStates.delete(id)
    // [B1 Fix] 同上：清掉全量重试计数（任务可能正在全量重试排队中被取消）
    cloudFullRetries.delete(id)
    pendingCloudIds.delete(id)
    pausedCloudIds.delete(id)
    scheduleCleanupTask(id, true)
  }
}

export function cloudCancelTask(id: string): void {
  cloudCancelTaskCore(id)
  cloudScheduleNext()
}

export function cloudResumeTask(id: string): void {
  const spec = removeFromSpecArray(pausedCloud, id)
  if (spec) {
    reEnqueueCloud(spec) // cloudRunTask 会从 cloudPausedStates 取 uploaderState 续传
    cloudScheduleNext()
    return
  }
  const t = cloudTasks.get(id)
  if (t && t.state === 'error') {
    cloudFullRetries.delete(id)  // 手动恢复 → 重置全量重试计数，给满额度
    reEnqueueCloud(t.spec)
    cloudTasks.delete(id)
    cloudScheduleNext()
  }
}

export function cloudPauseAll(): void {
  for (const id of [...cloudTasks.keys()]) cloudPauseTaskCore(id)
  for (const spec of pendingCloud) {
    emitProgress({ taskId: spec.taskId, state: 'paused', received: 0, total: 0, message: '已暂停' })
    pausedCloud.push(spec)
    pausedCloudIds.add(spec.taskId)
  }
  pendingCloud.length = 0
  pendingCloudIds.clear()
  cloudScheduleNext()
}
export function cloudCancelAll(): void {
  for (const id of [...cloudTasks.keys()]) cloudCancelTaskCore(id)
  for (const spec of pendingCloud) {
    emitProgress({ taskId: spec.taskId, state: 'cancelled', received: 0, total: 0, message: '已取消' })
  }
  pendingCloud.length = 0
  pendingCloudIds.clear()
  for (const spec of pausedCloud) {
    emitProgress({ taskId: spec.taskId, state: 'cancelled', received: 0, total: 0, message: '已取消' })
  }
  pausedCloud.length = 0
  pausedCloudIds.clear()
  cloudPausedStates.clear()
  cloudFullRetries.clear()  // 全部取消 → 丢弃重试计数
  cloudScheduleNext()
}
export function cloudResumeAll(): void {
  const paused = pausedCloud.splice(0)
  pausedCloudIds.clear()
  for (const spec of paused) reEnqueueCloud(spec)
  for (const [id, t] of cloudTasks) {
    if (t.state === 'error') {
      reEnqueueCloud(t.spec)
      cloudTasks.delete(id)
    }
  }
  cloudScheduleNext()
}
