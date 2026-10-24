// 本地下载引擎：调度 + HTTP 流式下载 + 暂停/取消/恢复。
//
// 状态（tasks/active/queues/cookies）在 shared.ts，本模块通过 import 直接操作同一引用。
// 调度器与 cloud 调度器通过 concurrency 的 reschedule 回调联动，不互相 import。
// AIMD note* 在 data 事件 / finally 里调用，喂入 concurrency 模块。

import { Agent as HttpsAgent } from 'node:https'
import { createWriteStream, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/** 全局保活长连接 Agent：复用 TCP/TLS 握手，避免千百个小文件下载时端口耗尽与重复握手延迟 */
export const sharedDownloadAgent = new HttpsAgent({
  keepAlive: true,
  keepAliveMsecs: 15000,
  maxSockets: 32,
  maxFreeSockets: 16,
  timeout: 60000
})

import { type DownloadState } from '../../shared/types'
import {
  assertDownloadIntegrity,
  verifyDownloadIntegrity,
  isHtmlExtension
} from './integrity'
import {
  type TaskRuntime,
  type PendingSpec,
  tasks,
  active,
  pendingLocal,
  pausedLocal,
  pendingLocalIds,
  pausedLocalIds,
  conflictStrategyByTask,
  scheduleCleanupTask,
  resolveDirectUrl,
  destroyLocalHandles,
  removeFromSpecArray,
  extractErrorMessage,
  sharedActiveCount,
  isHlsStreamTask,
  workerConfigByTask
} from './shared'
import { cdnFetchOnce, type CdnFetchContext, type CdnFetchCallbacks } from './cdn-fetch'
import { downloadHlsVideo, extractAudioFromVideo } from '../canvas/hls-download'
import { sjtuSession } from '../session'
import {
  noteNetworkRecovery,
  noteNetworkError,
  isDnsError,
  noteDownloadBytes,
  getConcurrency,
  isNetworkHealthy,
  ensureNetworkResumeTimer
} from '../concurrency'
import { getIsQuitting } from '../window'
import { emitProgress } from './progress'
import { notifyConcurrencySlotAvailable } from '../canvas/orchestrator'
import { sanitizeForLog } from '../canvas/safe-fetch'
import { globalSpeedLimiter } from '../../shared/utils'

export function scheduleNext(): void {
  if (getIsQuitting()) return
  while (sharedActiveCount() < getConcurrency() && pendingLocal.length > 0) {
    // 网络不佳时暂停拉取新任务，让活跃任务优先重试
    if (!isNetworkHealthy()) {
      // 设置兜底恢复定时器：避免所有活跃任务都失败后永久卡住
      ensureNetworkResumeTimer()
      break
    }
    // 惰性 materialization：临下载才从 pendingLocal 取 spec 建 TaskRuntime
    const { spec, filePath, partPath } = pendingLocal.shift()!
    pendingLocalIds.delete(spec.taskId)
    const existing = tasks.get(spec.taskId)
    if (existing && (existing.state === 'pending' || existing.state === 'downloading' || existing.state === 'paused')) {
      continue // 已在跑（重复入队防护）
    }
    const t: TaskRuntime = {
      spec: { ...spec, cloudUserToken: undefined },
      filePath, partPath,
      state: 'pending', received: 0, total: 0,
      retryTimers: new Set()
    }
    tasks.set(spec.taskId, t)
    active.add(spec.taskId)
    // [B3 Fix] .catch 兜底：若 runTask 内部某条路径漏 try/catch 而 reject，.finally 不接 rejection
    // 会导致 active 永不释放（任务卡死）。catch 兜底置 error + 清理，finally 仍执行释放槽位。
    void runTask(t).catch(err => {
      console.error('[runTask] unhandled rejection:', sanitizeForLog(err instanceof Error ? err.message : err))
      t.state = 'error'
      emitProgress({ taskId: t.spec.taskId, state: 'error', received: t.received, total: t.total, message: '内部错误' })
      destroyLocalHandles(t, 'internal error')
    }).finally(() => {
      active.delete(spec.taskId)
      t.req = undefined
      t.resp = undefined
      t.ws = undefined
      t.cancel = undefined
      notifyConcurrencySlotAvailable()
      scheduleNext()
    })
  }
}

async function runTask(t: TaskRuntime): Promise<void> {
  const strategy = conflictStrategyByTask.get(t.spec.taskId) ?? 'skip'

  // 最终文件已存在 → 跳过 或 先删后下载（overwrite）
  if (strategy === 'overwrite') {
    // 替换模式：无需预检存在性，直接删，不存在则 ENOENT 自然忽略
    // （消除 existsSync/stat → unlink 的 TOCTOU 窗口）
    try { unlinkSync(t.filePath) } catch { /* 不存在则忽略 */ }
    try { unlinkSync(t.partPath) } catch { /* ignore */ }
  } else {
    // skip 策略：检查已存在文件是否有效；若既有文件损坏（0 字节或非允许 HTML 错误页），则删除以自愈重新下载
    const existing = statSync(t.filePath, { throwIfNoEntry: false })
    if (existing) {
      const integrity = verifyDownloadIntegrity(t.filePath, 1, isHtmlExtension(t.filePath))
      if (integrity.valid) {
        t.state = 'skipped'
        emitProgress({
          taskId: t.spec.taskId,
          state: 'skipped',
          received: 0,
          total: 0,
          filePath: t.filePath,
          message: '已存在，跳过'
        })
        scheduleCleanupTask(t.spec.taskId, false)
        return
      }
      // 既有文件损坏，清除以自愈
      try { unlinkSync(t.filePath) } catch { /* ignore */ }
    }
  }

  // 确保目标目录存在（惰性：临下载才建，避免一开始对 3000 条 spec 全 mkdir）
  try {
    mkdirSync(join(t.filePath, '..'), { recursive: true })
  } catch {
    /* ignore */
  }

  // 按需解析直链（lazy resolution，与 cloudRunTask 共用；含 cancel 竞态守卫）
  if (!await resolveDirectUrl(t, false)) return

  t.state = 'downloading'
  emitProgress({
    taskId: t.spec.taskId,
    state: 'downloading',
    received: t.received,
    total: t.total
  })

  try {
    if (isHlsStreamTask(t.spec)) {
      const isAudioOnly = t.spec.extractAudio || t.filePath.endsWith('.m4a')
      const hlsRes = await downloadHlsVideo(t.spec.url, t.filePath, {
        session: sjtuSession(),
        isAudioOnly,
        privateWorker: workerConfigByTask.get(t.spec.taskId),
        onProgress: (p) => {
          if (t.state === 'cancelled' || t.state === 'paused') return
          t.received = p.bytesWritten || p.segmentsDone
          t.total = p.segmentsTotal || 0
          emitProgress({
            taskId: t.spec.taskId,
            state: 'downloading',
            received: t.received,
            total: t.total,
            unit: p.bytesWritten ? 'bytes' : 'count',
            message: p.message || (p.phase === 'downloading' ? `下载切片 (${p.segmentsDone}/${p.segmentsTotal})` : p.phase === 'remuxing' ? '正在合并转码 MP4…' : '')
          })
        }
      })
      if (hlsRes?.path) t.filePath = hlsRes.path
      assertDownloadIntegrity(t.filePath, 1, false)
      t.state = 'done'
      emitProgress({
        taskId: t.spec.taskId,
        state: 'done',
        received: t.received,
        total: t.total || t.received,
        filePath: t.filePath
      })
      scheduleCleanupTask(t.spec.taskId, false)
      return
    }

    // 本地下载自动重试：网络错误（socket hang up 等）时最多重试 3 次
    const MAX_DL_RETRIES = 3
    for (let attempt = 0; ; attempt++) {
      try {
        await downloadStream(t)
        noteNetworkRecovery()
        break
      } catch (retryErr) {
        if (t.state !== 'downloading') throw retryErr // 被 pause/cancel，不重试
        const msg = (retryErr instanceof Error ? retryErr.message : '').replace(/[\r\n]+/g, ' ')
        const isNetErr =
          /socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timeout|EPIPE/i.test(msg) ||
          isDnsError(retryErr)
        const errLabel = isDnsError(retryErr) ? 'DNS 解析失败' : '网络中断'
        if (isNetErr && attempt < MAX_DL_RETRIES) {
          const delay = Math.pow(2, attempt + 1) * 1000
          noteNetworkError()
          console.warn(`[download] ${errLabel}，${delay / 1000}s 后重试 (${attempt + 1}/${MAX_DL_RETRIES})`)
          emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: t.received, total: t.total, message: `${errLabel}，${delay / 1000}s 后重试 (${attempt + 1}/${MAX_DL_RETRIES})` })
          await new Promise<void>(resolve => {
            const timer = setTimeout(() => {
              t.retryTimers.delete(timer)
              resolve()
            }, delay)
            t.retryTimers.add(timer)
          })
          if (t.state !== 'downloading') throw retryErr // 等待期间被 pause/cancel
          continue
        }
        throw retryErr
      }
    }
    // 校验完整性并转正落盘 (R2-F4)
    try {
      assertDownloadIntegrity(t.partPath, 1, isHtmlExtension(t.filePath))
    } catch (integrityErr) {
      try {
        unlinkSync(t.partPath)
      } catch {
        /* ignore */
      }
      throw integrityErr
    }
    const isAudioOnly = t.spec.extractAudio || t.filePath.endsWith('.m4a')
    if (isAudioOnly) {
      const m4aPath = t.filePath.endsWith('.m4a') ? t.filePath : t.filePath.replace(/\.mp4$/, '.m4a')
      emitProgress({ taskId: t.spec.taskId, state: 'downloading', received: t.received, total: t.total, message: '正在提取纯音频 (AAC .m4a)…' })
      const ok = await extractAudioFromVideo(t.partPath, m4aPath)
      if (ok) {
        t.filePath = m4aPath
      } else {
        renameSync(t.partPath, t.filePath)
      }
    } else {
      renameSync(t.partPath, t.filePath)
    }
    t.state = 'done'
    // 下载字节已在 downloadStream 的 data 事件里逐块计入 noteDownloadBytes，此处不重复累计
    emitProgress({
      taskId: t.spec.taskId,
      state: 'done',
      received: t.received,
      total: t.total || t.received,
      filePath: t.filePath
    })
    scheduleCleanupTask(t.spec.taskId, false)
  } catch (err) {
    // 经过 await 后 pauseTask / cancelTask 可能已经把 state 改了；TS narrow 看不到，强转一下
    const finalState = t.state as DownloadState
    if (finalState === 'paused') {
      // .part 保留用于续传；用 destroy 立即释放文件句柄（end() 是异步的）
      try {
        t.ws?.destroy()
      } catch {
        /* ignore */
      }
      return
    }
    if (finalState === 'cancelled') {
      // 先 destroy 释放文件句柄，再删文件
      try {
        t.ws?.destroy()
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(t.partPath)
      } catch {
        /* ignore */
      }
      scheduleCleanupTask(t.spec.taskId, false)
      // cancelTask 已 emit
      return
    }
    // 真正的下载错误：释放句柄并清理损坏的 .part 文件
    try {
      t.ws?.destroy()
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(t.partPath)
    } catch {
      /* ignore */
    }
    t.state = 'error'
    destroyLocalHandles(t, 'download error')
    const msg = extractErrorMessage(err, '下载失败')
    emitProgress({
      taskId: t.spec.taskId,
      state: 'error',
      received: t.received,
      total: t.total,
      message: msg.slice(0, 240)
    })
  }
}

/** 真正的 HTTP 流式下载；支持手动重定向、Range 续传、写流 backpressure。
 *  完全绕开 Chromium 网络栈：之前用 sjtuSession.fetch / net.request 都被 Chromium
 *  按 cross-origin 直接 BLOCKED_BY_CLIENT。Node 的 https 不做 CORS 也不阻拦。
 *  [Phase 2] fetchOnce 的公共骨架（cookie 注入 / 重定向拦截 / 限流重试 / total 解析）
 *  抽取到 cdn-fetch.ts；本函数只保留本地特有部分：.part 续传探测、200 回退清
 *  .part、写流背压与限速。 */
function downloadStream(t: TaskRuntime): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // 续传探测：part 文件已存在且 size>0 → 发 Range
    let resumeFrom = 0
    try {
      const partStat = statSync(t.partPath, { throwIfNoEntry: false })
      if (partStat && partStat.size > 0) resumeFrom = partStat.size
    } catch {
      /* ignore */
    }
    t.received = resumeFrom

    let settled = false
    // Canvas 下载端点限流重试计数（429/403，仅 oc.sjtu.edu.cn 这一跳；跨 fetchOnce 共享）
    const rlRetries = { count: 0 }
    const fail = (e: Error): void => {
      if (settled) return
      settled = true
      try { t.ws?.destroy() } catch { /* ignore */ }
      try { t.resp?.destroy() } catch { /* ignore */ }
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
      try { t.ws?.destroy() } catch { /* ignore */ }
      try { t.resp?.destroy() } catch { /* ignore */ }
      reject(new Error('cancelled'))
    }

    const ctx: CdnFetchContext = {
      taskId: t.spec.taskId,
      get state() { return t.state },
      retryTimers: t.retryTimers,
      get received() { return t.received },
      get total() { return t.total },
      getRangeFrom: () => resumeFrom,
      agent: sharedDownloadAgent
    }
    const cb: CdnFetchCallbacks = {
      fail,
      // 2xx 但带 Range 且 CDN 返回 200（不支持续传）：把现有 .part 丢掉重头来
      onHeaders: (_resp, status) => {
        if (resumeFrom > 0 && status === 200) {
          try {
            unlinkSync(t.partPath)
          } catch {
            /* ignore */
          }
          resumeFrom = 0
          t.received = 0
        }
        return true
      },
      onResponse: (resp, total, status) => {
        t.total = total
        emitProgress({
          taskId: t.spec.taskId,
          state: 'downloading',
          received: t.received,
          total: t.total
        })

        const ws = createWriteStream(
          t.partPath,
          status === 206 ? { flags: 'a' } : { flags: 'w' }
        )
        t.ws = ws
        ws.on('error', fail)

        let lastEmit = 0
        let isPausedByLimiter = false
        let isPausedByDrain = false

        resp.on('data', (chunk: Buffer) => {
          // 用户已点 pause/cancel：req.destroy 异步生效前，缓冲区里的 data 事件
          // 还会继续触发。这里直接干掉 resp，避免把刚 emit 的 paused 状态覆盖回 downloading。
          const s = t.state as DownloadState
          if (s === 'paused' || s === 'cancelled') {
            try {
              resp.destroy()
            } catch {
              /* ignore */
            }
            return
          }
          t.received += chunk.length
          noteDownloadBytes(chunk.length)

          // 限速流控：若令牌不足，暂停可读流并在定时器到期后恢复
          const delay = globalSpeedLimiter.acquireDelay(chunk.length)
          if (delay > 0) {
            isPausedByLimiter = true
            resp.pause()
            const timer = setTimeout(() => {
              t.retryTimers.delete(timer)
              isPausedByLimiter = false
              if (!isPausedByDrain && !resp.destroyed && t.state === 'downloading') {
                resp.resume()
              }
            }, delay)
            t.retryTimers.add(timer)
          }

          // 磁盘写入背压：缓冲区满时暂停流，drain 后恢复
          if (!ws.write(chunk)) {
            isPausedByDrain = true
            resp.pause()
            ws.once('drain', () => {
              isPausedByDrain = false
              if (!isPausedByLimiter && !resp.destroyed && t.state === 'downloading') {
                resp.resume()
              }
            })
          }

          const now = Date.now()
          if (now - lastEmit > 250) {
            lastEmit = now
            emitProgress({
              taskId: t.spec.taskId,
              state: 'downloading',
              received: t.received,
              total: t.total
            })
          }
        })
        resp.on('end', () => {
          // resp 被 cancelTask/pauseTask destroy 后仍可能触发 end；
          // 此时 ok() 会导致 runTask 误走 renameSync 干扰新 TaskRuntime
          if (!resp.destroyed) ws.end(() => ok())
        })
        resp.on('error', fail)
      },
      onRequest: (req) => {
        t.req = req
        req.setTimeout(60000, () => {
          req.destroy(new Error('请求超时（60s）'))
        })
        req.on('error', fail)
      },
      onRespAttached: (resp) => {
        t.resp = resp
      }
    }

    cdnFetchOnce(t.spec.url, 0, rlRetries, ctx, cb)
  })
}


// ─── 任务级控制 ─────────────────────────────────────────────────

/** 把一个 paused 的本地 spec 重新入待处理队列（resume 用） */
export function reEnqueueLocal(p: PendingSpec): void {
  // [Bug Fix] 清掉已解析的直链，强制 resolveDirectUrl 重新解析。
  // Canvas 签名 URL / vod 流直链都有 TTL，任务暂停数小时或出错后恢复时，
  // 旧 url 往往已 403；若不清空，resolveDirectUrl 见 t.spec.url 非空直接 return，
  // 导致恢复后立即再次失败、永久卡在 error。
  p.spec.url = ''
  pendingLocal.push(p)
  pendingLocalIds.add(p.spec.taskId)
  pausedLocalIds.delete(p.spec.taskId)
  emitProgress({ taskId: p.spec.taskId, state: 'pending', received: 0, total: 0 })
}

/** 暂停核心：活跃任务销毁句柄；pending 任务移到 pausedLocal。不调度 */
function pauseTaskCore(id: string): void {
  // 已 materialize 的活跃/错误任务
  const t = tasks.get(id)
  if (t) {
    if (t.state !== 'downloading' && t.state !== 'pending') return
    const wasActive = active.has(id)
    t.state = 'paused'
    active.delete(id)
    emitProgress({ taskId: id, state: 'paused', received: t.received, total: t.total, message: '已暂停' })
    if (wasActive) {
      destroyLocalHandles(t, 'paused')
    }
    // 把 spec 移入 pausedLocal 待 resume（保留 filePath/partPath）
    pausedLocal.push({ spec: t.spec, filePath: t.filePath, partPath: t.partPath })
    pausedLocalIds.add(id)
    // paused 的 TaskRuntime 立即清理（spec 已转移到 pausedLocal）
    tasks.delete(id)
    return
  }
  // 还在 pendingLocal（没轮到下载）→ 移到 pausedLocal
  const p = removeFromSpecArray(pendingLocal, id)
  if (p) {
    emitProgress({ taskId: id, state: 'paused', received: 0, total: 0, message: '已暂停' })
    pausedLocal.push(p)
    pendingLocalIds.delete(id)
    pausedLocalIds.add(id)
  }
}

export function pauseTask(id: string): void {
  pauseTaskCore(id)
  scheduleNext()
}

/** 取消核心：活跃任务销毁句柄/删 .part；pending/paused 任务从队列移除。不调度 */
function cancelTaskCore(id: string): void {
  const t = tasks.get(id)
  if (t) {
    if (t.state === 'done' || t.state === 'cancelled' || t.state === 'skipped') return
    const wasActive = active.has(id)
    t.state = 'cancelled'
    active.delete(id)
    emitProgress({ taskId: id, state: 'cancelled', received: t.received, total: t.total, message: '已取消' })
    if (wasActive) {
      destroyLocalHandles(t, 'cancelled')
    } else {
      try { unlinkSync(t.partPath) } catch { /* ignore */ }
    }
    tasks.delete(id)
    scheduleCleanupTask(id, false)
    return
  }
  // pending 或 paused 队列里 → 移除
  const foundPending = removeFromSpecArray(pendingLocal, id)
  const foundPaused = removeFromSpecArray(pausedLocal, id)
  if (foundPending || foundPaused) {
    emitProgress({ taskId: id, state: 'cancelled', received: 0, total: 0, message: '已取消' })
    pendingLocalIds.delete(id)
    pausedLocalIds.delete(id)
    scheduleCleanupTask(id, false)
  }
}

export function cancelTask(id: string): void {
  cancelTaskCore(id)
  scheduleNext()
}

export function resumeTask(id: string): void {
  // paused 队列里的 spec → 放回 pending
  const p = removeFromSpecArray(pausedLocal, id)
  if (p) {
    reEnqueueLocal(p)
    scheduleNext()
    return
  }
  // 已 materialize 但处于 error 的任务 → 重新入队
  const t = tasks.get(id)
  if (t && t.state === 'error') {
    reEnqueueLocal({ spec: t.spec, filePath: t.filePath, partPath: t.partPath })
    tasks.delete(id)
    scheduleNext()
  }
}

export function pauseAll(): void {
  for (const id of [...tasks.keys()]) pauseTaskCore(id)
  // pendingLocal 全部移到 pausedLocal
  for (const p of pendingLocal) {
    emitProgress({ taskId: p.spec.taskId, state: 'paused', received: 0, total: 0, message: '已暂停' })
    pausedLocal.push(p)
    pausedLocalIds.add(p.spec.taskId)
  }
  pendingLocal.length = 0
  pendingLocalIds.clear()
  scheduleNext()
}
export function cancelAll(): void {
  for (const id of [...tasks.keys()]) cancelTaskCore(id)
  for (const p of pendingLocal) {
    emitProgress({ taskId: p.spec.taskId, state: 'cancelled', received: 0, total: 0, message: '已取消' })
  }
  pendingLocal.length = 0
  pendingLocalIds.clear()
  for (const p of pausedLocal) {
    emitProgress({ taskId: p.spec.taskId, state: 'cancelled', received: 0, total: 0, message: '已取消' })
  }
  pausedLocal.length = 0
  pausedLocalIds.clear()
  scheduleNext()
}
export function resumeAll(): void {
  // pausedLocal 全部放回 pendingLocal
  const paused = pausedLocal.splice(0)
  pausedLocalIds.clear()
  for (const p of paused) reEnqueueLocal(p)
  // error 态的 materialized 任务也恢复
  for (const [id, t] of tasks) {
    if (t.state === 'error') {
      reEnqueueLocal({ spec: t.spec, filePath: t.filePath, partPath: t.partPath })
      tasks.delete(id)
    }
  }
  scheduleNext()
}
