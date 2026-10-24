/**
 * 校内私有中转服务下载调度管线 (Worker Dispatch Pipeline)
 *
 * 核心职责：
 * 1. 判定是否满足委托中转代传分流条件（isWorkerDelegated）；
 * 2. 懒解析 Canvas / 直链下载地址至直连 S3 预签名 URL（避免第三方节点缺少 Cookie 鉴权失败）；
 * 3. 批量派发任务至私有中转机，并在主进程推送 download:progress 状态机（实现本地 0 流量消耗）。
 */

import type { DownloadMode, DownloadTaskSpec, PrivateWorkerConfig } from '../../shared/types'
import { registerTaskMeta, emitProgress } from './progress'
import { effectiveCourseName } from './shared'
import { sjtuSession } from '../session'
import { CANVAS_BASE_URL } from '../../shared/types'
import { isWorkerDelegated, dispatchPrivateWorkerTask } from '../private-worker'
export { isWorkerDelegated }

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
 * 调度并将一批下载任务派发给私有中转机
 */
export async function dispatchWorkerBatch(
  specs: DownloadTaskSpec[],
  options: {
    mode?: DownloadMode
    privateWorker?: PrivateWorkerConfig
    namingTemplate?: string
    cloudDestRoot?: string
  }
): Promise<{ ok: boolean; error?: string }> {
  const worker = options.privateWorker
  if (!worker || !worker.endpointUrl) {
    return { ok: false, error: '私有中转服务未正确配置' }
  }

  const isServerLocal = worker.storageMode === 'server_local'

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
      message: '正在向中转服务器派发 (0 本地流量)…'
    })
  }

  // 异步在后台逐个派发并追踪
  void (async () => {
    for (const spec of specs) {
      const course = effectiveCourseName(spec)
      const rawSpec = spec as { fileSize?: number; destRelPath?: string; categoryName?: string }
      const fileSize = rawSpec.fileSize || 0
      try {
        emitProgress({
          taskId: spec.taskId,
          state: 'downloading',
          received: 0,
          total: fileSize,
          fileName: spec.fileName,
          courseName: course,
          message: isServerLocal
            ? '中转工作机下载中 (0 本地流量)…'
            : '中转代传至云盘中 (0 本地流量)…'
        })

        // 预解析可能需要鉴权的 Canvas 文件端点为纯净 S3 签名直链
        const directUrl = await resolveDirectCanvasUrl(spec.url)

        const res = await dispatchPrivateWorkerTask(
          worker.endpointUrl,
          {
            taskId: spec.taskId,
            url: directUrl,
            fileName: spec.fileName,
            destPath: rawSpec.destRelPath || '',
            storageMode: worker.storageMode || 'cloudpan',
            serverDownloadDir: worker.serverDownloadDir || '~/downloads',
            courseName: course,
            categoryName: spec.category || rawSpec.categoryName || '课件资料',
            fileSize
          },
          worker.authToken
        )

        if (res.ok) {
          emitProgress({
            taskId: spec.taskId,
            state: 'done',
            received: fileSize || 1,
            total: fileSize || 1,
            fileName: spec.fileName,
            courseName: course,
            message: isServerLocal ? '已保存至中转服务器本地磁盘' : '已转存至交大云盘'
          })
        } else {
          emitProgress({
            taskId: spec.taskId,
            state: 'error',
            received: 0,
            total: fileSize,
            fileName: spec.fileName,
            courseName: course,
            message: res.error || '中转节点处理失败'
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
  })()

  return { ok: true }
}
