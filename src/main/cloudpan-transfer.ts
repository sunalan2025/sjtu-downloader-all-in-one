import { basename, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { app, dialog, shell } from 'electron'
import type { DownloadTaskSpec } from '../shared/types'
import {
  getCachedUserToken,
  getFileDownloadUrl,
  uploadLocalFileToCloud,
  getCloudPanWebUrl
} from './cloudpan'
import { getMainWindow } from './window'
import { emitProgress } from './download-engine/progress'
import { pendingLocal, pendingLocalIds } from './download-engine/shared'
import { scheduleNext } from './download-engine/local'

/** 活跃的后台上传 Promise 集合（供测试与退出等待） */
export const activeUploadPromises = new Set<Promise<void>>()

/** 在系统默认浏览器中打开交大云盘对应目录或根目录 */
export async function openCloudInBrowser(
  remotePath: string[] = []
): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = getCloudPanWebUrl(remotePath)
    if (!url.startsWith('https://pan.sjtu.edu.cn/')) {
      return { ok: false, error: '非法URL' }
    }
    await shell.openExternal(url)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 下载交大云盘文件并加入本地传输队列 */
export async function downloadCloudFile(
  remotePath: string[],
  targetDir?: string
): Promise<{ ok: boolean; taskId?: string; error?: string }> {
  const userToken = getCachedUserToken()
  if (!userToken) return { ok: false, error: '未登录云盘' }
  if (!remotePath || !Array.isArray(remotePath) || remotePath.length === 0) {
    return { ok: false, error: '文件路径不能为空' }
  }
  const fileName = remotePath[remotePath.length - 1]
  if (!fileName || !fileName.trim()) {
    return { ok: false, error: '文件路径不能为空' }
  }
  try {
    const url = await getFileDownloadUrl(userToken, remotePath)
    let defaultDownloads: string
    try {
      defaultDownloads = app.getPath('downloads')
    } catch {
      defaultDownloads = join(tmpdir(), 'downloads')
    }
    const localBase = targetDir || defaultDownloads
    mkdirSync(localBase, { recursive: true })

    const taskId = 'cloudpan_dl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
    const spec: DownloadTaskSpec = {
      taskId,
      url,
      fileName,
      courseName: '交大云盘',
      category: 'files',
      source: 'cloudpan',
      cloudRemotePath: remotePath
    }
    const filePath = join(localBase, fileName)
    const partPath = filePath + '.part'
    pendingLocal.push({ spec, filePath, partPath })
    pendingLocalIds.add(spec.taskId)
    emitProgress({ taskId: spec.taskId, state: 'pending', received: 0, total: 0 })
    scheduleNext()
    return { ok: true, taskId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 调起本地文件选择框并将选中文件上传到交大云盘目标目录 */
export async function uploadCloudFiles(
  targetDirPath: string[] = []
): Promise<{ ok: boolean; count?: number; error?: string }> {
  const userToken = getCachedUserToken()
  if (!userToken) return { ok: false, error: '未登录云盘' }
  try {
    const win = getMainWindow()
    const dialogOpts = {
      title: '选择要上传到云盘的文件',
      properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[]
    }
    const result = win ? await dialog.showOpenDialog(win, dialogOpts) : await dialog.showOpenDialog(dialogOpts)
    if (!result || result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { ok: true, count: 0 }
    }
    const cleanTarget = Array.isArray(targetDirPath) ? targetDirPath.filter(Boolean) : []
    const items = result.filePaths.map(localPath => {
      const fileName = basename(localPath)
      const remotePath = [...cleanTarget, fileName].join('/')
      const taskId = 'cloudpan_up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
      emitProgress({ taskId, state: 'pending', received: 0, total: 0 })
      return { localPath, remotePath, taskId }
    })

    const MAX_CONCURRENT_UPLOADS = 3
    let cursor = 0

    const runWorker = async (): Promise<void> => {
      while (cursor < items.length) {
        const item = items[cursor++]
        emitProgress({ taskId: item.taskId, state: 'downloading', received: 0, total: 0 })
        try {
          await uploadLocalFileToCloud(
            userToken,
            item.localPath,
            item.remotePath,
            'overwrite',
            (received, total) => {
              emitProgress({ taskId: item.taskId, state: 'downloading', received, total })
            }
          )
          emitProgress({ taskId: item.taskId, state: 'done', received: 100, total: 100, cloudPath: item.remotePath })
        } catch (err) {
          emitProgress({
            taskId: item.taskId,
            state: 'error',
            received: 0,
            total: 0,
            message: err instanceof Error ? err.message : String(err)
          })
        }
      }
    }

    const workerCount = Math.min(MAX_CONCURRENT_UPLOADS, items.length)
    for (let i = 0; i < workerCount; i++) {
      const workerP = runWorker().finally(() => {
        activeUploadPromises.delete(workerP)
      })
      activeUploadPromises.add(workerP)
    }
    return { ok: true, count: result.filePaths.length }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
