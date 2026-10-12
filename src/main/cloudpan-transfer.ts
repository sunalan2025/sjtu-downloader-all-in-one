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
import { getAutoConcurrency, startAutoConcurrency } from './concurrency'

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
      category: 'files'
    }
    const filePath = join(localBase, fileName)
    const partPath = filePath + '.part'
    pendingLocal.push({ spec, filePath, partPath })
    pendingLocalIds.add(spec.taskId)
    if (getAutoConcurrency()) startAutoConcurrency()
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
    for (const localPath of result.filePaths) {
      const fileName = basename(localPath)
      const remotePath = [...cleanTarget, fileName].join('/')
      const taskId = 'cloudpan_up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
      emitProgress({ taskId, state: 'pending', received: 0, total: 0 })
      const uploadP = (async () => {
        emitProgress({ taskId, state: 'downloading', received: 0, total: 0 })
        try {
          await uploadLocalFileToCloud(
            userToken,
            localPath,
            remotePath,
            'overwrite',
            (received, total) => {
              emitProgress({ taskId, state: 'downloading', received, total })
            }
          )
          emitProgress({ taskId, state: 'done', received: 100, total: 100, cloudPath: remotePath })
        } catch (err) {
          emitProgress({
            taskId,
            state: 'error',
            received: 0,
            total: 0,
            message: err instanceof Error ? err.message : String(err)
          })
        }
      })().finally(() => {
        activeUploadPromises.delete(uploadP)
      })
      activeUploadPromises.add(uploadP)
    }
    return { ok: true, count: result.filePaths.length }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
