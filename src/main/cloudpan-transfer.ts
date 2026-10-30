import { basename, join } from 'node:path'
import { mkdirSync, lstatSync, existsSync } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { app, dialog, shell } from 'electron'
import type { DownloadTaskSpec } from '../shared/types'
import {
  getCachedUserToken,
  getFileDownloadUrl,
  uploadLocalFileToCloud,
  listDirectoryContents,
  ensureFolderPath,
  getCloudPanWebUrl
} from './cloudpan'
import { getMainWindow } from './window'
import { emitProgress, registerTaskMeta } from './download-engine/progress'
import { pendingLocal, pendingLocalIds, tasks } from './download-engine/shared'
import { scheduleNext } from './download-engine/local'
import { validateCloudPath, type CloudEntry } from '../shared/cloud-drive'

/** 活跃的后台上传 Promise 集合（供测试与退出等待） */
export const activeUploadPromises = new Set<Promise<void>>()

/** 在系统默认浏览器中打开交大云盘对应目录或根目录 */
export async function openCloudInBrowser(remotePath: string[] = []): Promise<{ ok: boolean; error?: string }> {
  try {
    validateCloudPath(remotePath)
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
    validateCloudPath(remotePath, false)
    assertLocalName(fileName)
    const url = await getFileDownloadUrl(userToken, remotePath)
    if (getCachedUserToken() !== userToken) throw new Error('云盘账号已切换，下载未提交')
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
    if (
      existsSync(filePath) ||
      existsSync(partPath) ||
      pendingLocal.some(task => task.filePath.toLowerCase() === filePath.toLowerCase()) ||
      [...tasks.values()].some(
        task => ['pending', 'downloading', 'paused'].includes(task.state) && task.filePath.toLowerCase() === filePath.toLowerCase()
      )
    ) {
      return { ok: false, error: '本地已有同名文件或下载任务，请选择其他保存位置' }
    }
    pendingLocal.push({ spec, filePath, partPath })
    registerTaskMeta(taskId, { fileName, courseName: '交大云盘' })
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
  targetDirPath: string[] = [],
  folder = false
): Promise<{ ok: boolean; count?: number; error?: string }> {
  const userToken = getCachedUserToken()
  if (!userToken) return { ok: false, error: '未登录云盘' }
  try {
    validateCloudPath(targetDirPath)
    const win = getMainWindow()
    const dialogOpts = {
      title: folder ? '选择要上传到云盘的文件夹' : '选择要上传到云盘的文件',
      properties: (folder ? ['openDirectory'] : ['openFile', 'multiSelections']) as ('openFile' | 'openDirectory' | 'multiSelections')[]
    }
    const result = win ? await dialog.showOpenDialog(win, dialogOpts) : await dialog.showOpenDialog(dialogOpts)
    if (!result || result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { ok: true, count: 0 }
    }
    const cleanTarget = Array.isArray(targetDirPath) ? targetDirPath.filter(Boolean) : []
    const selected: Array<{ localPath: string; path: string[] }> = []
    const directories: string[][] = []
    const walk = async (localPath: string, path: string[], depth = 0): Promise<void> => {
      if (depth > 64 || selected.length + directories.length >= 10000) throw new Error('文件夹过大，请分批上传（最多 10000 项、64 层）')
      validateCloudPath(path, false)
      const stat = await lstat(localPath)
      if (stat.isSymbolicLink()) throw new Error('请移除文件夹中的符号链接后再上传')
      if (stat.isDirectory()) {
        directories.push(path)
        for (const entry of await readdir(localPath)) await walk(join(localPath, entry), [...path, entry], depth + 1)
      } else if (stat.isFile()) selected.push({ localPath, path })
    }
    if (folder) {
      for (const path of result.filePaths) await walk(path, [...cleanTarget, basename(path)])
      for (const path of directories) {
        if (getCachedUserToken() !== userToken) throw new Error('云盘账号已切换')
        await ensureFolderPath(userToken, ...path)
      }
    } else for (const localPath of result.filePaths) selected.push({ localPath, path: [...cleanTarget, basename(localPath)] })
    const items = selected.map(({ localPath, path }) => {
      const remotePath = path.join('/')
      const taskId = 'cloudpan_up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
      registerTaskMeta(taskId, { fileName: basename(localPath), courseName: '交大云盘上传' })
      emitProgress({ taskId, state: 'pending', received: 0, total: 0, storageMode: 'cloudpan' })
      return { localPath, remotePath, taskId }
    })

    const MAX_CONCURRENT_UPLOADS = 3
    let cursor = 0

    const runWorker = async (): Promise<void> => {
      while (cursor < items.length) {
        const item = items[cursor++]
        let lastReceived = 0
        let lastTotal = 0
        emitProgress({ taskId: item.taskId, state: 'downloading', received: 0, total: 0 })
        try {
          if (getCachedUserToken() !== userToken) throw new Error('云盘账号已切换，上传已停止')
          await uploadLocalFileToCloud(userToken, item.localPath, item.remotePath, 'skip', (received, total) => {
            lastReceived = received
            lastTotal = total
            emitProgress({ taskId: item.taskId, state: 'downloading', received, total })
          })
          emitProgress({ taskId: item.taskId, state: 'done', received: lastTotal, total: lastTotal, cloudPath: item.remotePath })
        } catch (err) {
          emitProgress({
            taskId: item.taskId,
            state: 'error',
            received: lastReceived,
            total: lastTotal,
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
    return { ok: true, count: selected.length }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function assertLocalName(name: string): void {
  validateCloudPath([name], false)
  if (/[<>:"|?*]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    throw new Error(`本地文件名不受支持：${name}`)
}

/** Enumerate first so a failed scan cannot silently download an incomplete directory. */
export async function downloadCloudEntries(
  entries: CloudEntry[],
  targetDir?: string
): Promise<{ ok: boolean; count?: number; errors?: string[]; error?: string }> {
  try {
    const token = getCachedUserToken()
    if (!token) throw new Error('未登录云盘')
    if (!Array.isArray(entries) || !entries.length || entries.length > 200) throw new Error('每次请选择 1 至 200 个项目')
    const base = targetDir || app.getPath('downloads')
    const files: Array<{ path: string[]; relative: string[] }> = []
    const dirs: string[][] = []
    let scanned = 0
    const walk = async (entry: CloudEntry, relative: string[], depth = 0): Promise<void> => {
      if (getCachedUserToken() !== token) throw new Error('云盘账号已切换')
      validateCloudPath(entry.path, false)
      relative.forEach(assertLocalName)
      if (++scanned > 10000 || depth > 64) throw new Error('目录过大，请分批下载（最多 10000 项、64 层）')
      if (entry.type === 'file') {
        files.push({ path: entry.path, relative })
        return
      }
      if (entry.type !== 'dir') throw new Error('无效的项目类型')
      dirs.push(relative)
      let loaded = 0
      for (let page = 1; ; page++) {
        const listing = await listDirectoryContents(token, entry.path, page, 500)
        if (!listing.contents.length && loaded < listing.totalNum) throw new Error('目录分页中断，请刷新后重试')
        for (const child of listing.contents)
          await walk({ path: [...entry.path, child.name], type: child.type }, [...relative, child.name], depth + 1)
        loaded += listing.contents.length
        if (loaded >= listing.totalNum) break
      }
    }
    for (const entry of entries) await walk(entry, [entry.path[entry.path.length - 1]])
    mkdirSync(base, { recursive: true })
    for (const path of dirs) {
      let local = base
      for (const part of path) {
        local = join(local, part)
        try {
          if (lstatSync(local).isSymbolicLink()) throw new Error('目标目录含符号链接，请选择其他保存位置')
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        }
        mkdirSync(local, { recursive: true })
      }
    }
    let count = 0
    const errors: string[] = []
    for (const file of files) {
      if (getCachedUserToken() !== token) {
        errors.push('云盘账号已切换，其余下载未提交')
        break
      }
      const result = await downloadCloudFile(file.path, join(base, ...file.relative.slice(0, -1)))
      if (result.ok) count++
      else errors.push(`${file.path.join('/')}：${result.error}`)
    }
    return { ok: errors.length === 0, count, errors }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '下载失败' }
  }
}
