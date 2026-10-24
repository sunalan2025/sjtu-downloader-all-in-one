/**
 * 校内私有中转服务下载调度管线 (Worker Dispatch Pipeline)
 *
 * 核心职责：
 * 1. 判定是否满足委托中转代传分流条件（isWorkerDelegated）；
 * 2. 懒解析 Canvas / 直链下载地址至直连 S3 预签名 URL（避免第三方节点缺少 Cookie 鉴权失败）；
 * 3. 批量派发任务至私有中转机，并在主进程通过长轮询推送 download:progress 状态机（实现本地 0 流量消耗）；
 * 4. 支持中转任务的取消协同。
 */

import type { DownloadMode, DownloadTaskSpec, PrivateWorkerConfig } from '../../shared/types'
import { registerTaskMeta, emitProgress } from './progress'
import { effectiveCourseName } from './shared'
import { sjtuSession } from '../session'
import { CANVAS_BASE_URL } from '../../shared/types'
import {
  isWorkerDelegated,
  dispatchPrivateWorkerTask,
  queryPrivateWorkerTask,
  cancelPrivateWorkerTask
} from '../private-worker'
import { cloudRemotePath } from './cloud'
import { getCachedUserToken } from '../cloudpan'

export { isWorkerDelegated }

const activeWorkerTrackers = new Map<string, { abort: () => void; workerUrl: string; authToken?: string }>()

/**
 * 取消当前正在中转执行的指定任务
 */
export function cancelWorkerTask(taskId: string): void {
  const tracker = activeWorkerTrackers.get(taskId)
  if (tracker) {
    tracker.abort()
    activeWorkerTrackers.delete(taskId)
    void cancelPrivateWorkerTask(tracker.workerUrl, taskId, tracker.authToken).catch(() => {})
  }
}

/**
 * 将 Canvas 的 /files/{id}/download 端点重定向解析为 S3 预签名直链
 * 使用 Electron 会话 Cookie 请求 302 头，无下载体传输，耗时 < 50ms。
 */
export async function resolveDirectCanvasUrl(rawUrl: string): Promise<string> {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl
  try {
    const u = new URL(rawUrl)
    if (u.hostname === 'oc.sjtu.edu.cn' && u.pathname.includes('/files/')) {
      const session = sjtuSession()
      const cookies = await session.cookies.get({ url: CANVAS_BASE_URL })
      const cookieHeader = cookies.map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join('; ')
      if (!cookieHeader) return rawUrl

      const res = await session.fetch(rawUrl, {
        method: 'HEAD',
        redirect: 'manual',
        headers: {
          Cookie: cookieHeader,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })
      const location = res.headers.get('location')
      if (location && /^https?:\/\//i.test(location)) {
        return location
      }
    }
  } catch {
    // 忽略预解析异常，直接使用原始 URL
  }
  return rawUrl
}

/**
 * 轮询中转工作机上的任务执行状态，同步更新客户端 download:progress
 */
export async function pollWorkerTaskProgress(
  workerUrl: string,
  taskId: string,
  fileName: string,
  course: string,
  fileSize: number,
  isServerLocal: boolean,
  fallbackTargetPath: string,
  authToken?: string,
  pollIntervalMs = 1000,
  maxPollTimeMs = 3600_000
): Promise<void> {
  let aborted = false
  const abort = (): void => {
    aborted = true
  }
  activeWorkerTrackers.set(taskId, { abort, workerUrl, authToken })

  const startTime = Date.now()

  try {
    while (!aborted && Date.now() - startTime < maxPollTimeMs) {
      await new Promise(r => setTimeout(r, pollIntervalMs))
      if (aborted) break

      const queryRes = await queryPrivateWorkerTask(workerUrl, taskId, authToken)
      if (!queryRes.ok || !queryRes.task) {
        // 网络抖动，继续轮询重试
        continue
      }

      const task = queryRes.task
      const resolvedPath = task.targetPath || fallbackTargetPath || fileName
      const totalBytes = task.totalBytes || fileSize || 0
      const receivedBytes = task.receivedBytes || 0

      if (task.status === 'completed') {
        emitProgress({
          taskId,
          state: 'done',
          received: totalBytes || receivedBytes || 1,
          total: totalBytes || receivedBytes || 1,
          speed: 0,
          fileName,
          courseName: course,
          filePath: isServerLocal ? resolvedPath : undefined,
          cloudPath: !isServerLocal ? resolvedPath : undefined,
          message: isServerLocal ? '已保存至中转服务器磁盘' : '已转存至交大云盘'
        })
        return
      }

      if (task.status === 'failed') {
        emitProgress({
          taskId,
          state: 'error',
          received: receivedBytes,
          total: totalBytes,
          speed: 0,
          fileName,
          courseName: course,
          message: task.error || '中转服务器处理失败'
        })
        return
      }

      if (task.status === 'cancelled') {
        emitProgress({
          taskId,
          state: 'paused',
          received: receivedBytes,
          total: totalBytes,
          speed: 0,
          fileName,
          courseName: course,
          message: '中转任务已取消'
        })
        return
      }

      // downloading or uploading
      emitProgress({
        taskId,
        state: 'downloading',
        received: receivedBytes,
        total: totalBytes,
        speed: task.speed || 0,
        fileName,
        courseName: course,
        message: isServerLocal ? '中转服务器下载中…' : '中转服务器转存云盘中…'
      })
    }

    if (aborted) {
      emitProgress({
        taskId,
        state: 'paused',
        received: 0,
        total: fileSize,
        speed: 0,
        fileName,
        courseName: course,
        message: '中转任务已停止'
      })
      return
    }

    // 轮询超时
    emitProgress({
      taskId,
      state: 'error',
      received: 0,
      total: fileSize,
      speed: 0,
      fileName,
      courseName: course,
      message: '中转任务等待超时'
    })
  } finally {
    activeWorkerTrackers.delete(taskId)
  }
}

/**
 * 调度并将一批下载任务派发给私有中转机（并发度控制为 2）
 */
export async function dispatchWorkerBatch(
  specs: DownloadTaskSpec[],
  options: {
    mode?: DownloadMode
    privateWorker?: PrivateWorkerConfig
    namingTemplate?: string
    cloudDestRoot?: string
    conflictStrategy?: 'skip' | 'overwrite'
  }
): Promise<{ ok: boolean; error?: string }> {
  const worker = options.privateWorker
  if (!worker || !worker.endpointUrl) {
    return { ok: false, error: '私有中转服务未正确配置' }
  }

  const isServerLocal = worker.storageMode === 'server_local'
  const cachedToken = getCachedUserToken()

  for (const spec of specs) {
    const course = effectiveCourseName(spec)
    const rawSpec = spec as { fileSize?: number; destRelPath?: string; categoryName?: string }
    const fileSize = rawSpec.fileSize || 0
    registerTaskMeta(spec.taskId, {
      fileName: spec.fileName,
      courseName: course
    })

    emitProgress({
      taskId: spec.taskId,
      state: 'pending',
      received: 0,
      total: fileSize,
      fileName: spec.fileName,
      courseName: course,
      message: '正在向中转服务器派发…'
    })
  }

  // 异步在后台按并发限制逐批派发并追踪
  void (async () => {
    const concurrency = 2
    let nextIndex = 0

    const runWorkerSlot = async (): Promise<void> => {
      while (nextIndex < specs.length) {
        const spec = specs[nextIndex++]
        const course = effectiveCourseName(spec)
        const rawSpec = spec as { fileSize?: number; destRelPath?: string; categoryName?: string }
        const fileSize = rawSpec.fileSize || 0
        const effectiveSpec = {
          ...spec,
          cloudDestRoot: options.cloudDestRoot ?? spec.cloudDestRoot
        }

        const targetDestPath = isServerLocal
          ? (rawSpec.destRelPath || '')
          : cloudRemotePath(effectiveSpec)
        const targetCloudToken = spec.cloudUserToken || cachedToken || undefined

        try {
          emitProgress({
            taskId: spec.taskId,
            state: 'downloading',
            received: 0,
            total: fileSize,
            fileName: spec.fileName,
            courseName: course,
            message: isServerLocal
              ? '中转服务器下载中…'
              : '中转服务器转存云盘中…'
          })

          // 预解析可能需要鉴权的 Canvas 文件端点为纯净 S3 签名直链
          const directUrl = await resolveDirectCanvasUrl(spec.url)

          const res = await dispatchPrivateWorkerTask(
            worker.endpointUrl,
            {
              taskId: spec.taskId,
              url: directUrl,
              fileName: spec.fileName,
              destPath: targetDestPath,
              cloudUserToken: targetCloudToken,
              conflictStrategy: options.conflictStrategy,
              storageMode: worker.storageMode || 'cloudpan',
              serverDownloadDir: worker.serverDownloadDir || '~/downloads',
              courseName: course,
              categoryName: spec.category || rawSpec.categoryName || '课件资料',
              fileSize
            },
            worker.authToken
          )

          if (res.ok) {
            await pollWorkerTaskProgress(
              worker.endpointUrl,
              spec.taskId,
              spec.fileName,
              course,
              fileSize,
              isServerLocal,
              targetDestPath,
              worker.authToken
            )
          } else {
            emitProgress({
              taskId: spec.taskId,
              state: 'error',
              received: 0,
              total: fileSize,
              fileName: spec.fileName,
              courseName: course,
              message: res.error || '中转服务器处理失败'
            })
          }
        } catch (err) {
          emitProgress({
            taskId: spec.taskId,
            state: 'error',
            received: 0,
            total: fileSize,
            fileName: spec.fileName,
            courseName: course,
            message: err instanceof Error ? err.message : '中转派发异常'
          })
        }
      }
    }

    const slots = Array.from({ length: Math.min(concurrency, specs.length) }, () => runWorkerSlot())
    await Promise.all(slots)
  })()

  return { ok: true }
}
