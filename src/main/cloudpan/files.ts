import type { CloudPanItem, CloudPanDirectoryListing } from '../../shared/types'
import { PAN_BASE, api, ensureCred, enc, createdFolderPaths, FOLDER_CACHE_TTL_MS } from './client'
import { validateCloudPath } from '../../shared/cloud-drive'
// ─── folder creation ───────────────────────────────────────────

/** 创建文件夹。parentPath 为空时在根目录创建，否则在 parentPath 内创建 */
async function ensureFolder(userToken: string, folderName: string, parentPath: string[] = []): Promise<void> {
  const cred = await ensureCred(userToken)
  const path = enc([...parentPath, folderName])
  const url = `${PAN_BASE}/api/v1/directory/${cred.libraryId}/${cred.spaceId}/${path}?conflict_resolution_strategy=ask&access_token=${cred.accessToken}`
  try {
    await api<unknown>(url, { method: 'PUT' })
  } catch (err) {
    if (err instanceof Error && (err.message.includes('SameNameDirectoryOrFileExists') || err.message.includes('HTTP 409'))) {
      // A name conflict may refer to a file. Confirm that the target really is a directory.
      await listDirectoryContents(userToken, [...parentPath, folderName], 1, 1)
      return
    }
    throw err
  }
}

/** 逐级创建嵌套文件夹（如 ['SJTU旁听课程', '课程名']）。
 *  PERF: 缓存已创建的路径，同一 course 下 100 个文件只发 3 次 HTTP PUT 而非 300 次。 */
export async function ensureFolderPath(userToken: string, ...segments: string[]): Promise<void> {
  validateCloudPath(segments)
  const created: string[] = []
  for (const seg of segments) {
    const key = JSON.stringify([userToken, ...created, seg])
    const cachedAt = createdFolderPaths.get(key)
    if (!cachedAt || Date.now() - cachedAt >= FOLDER_CACHE_TTL_MS) {
      await ensureFolder(userToken, seg, created)
      createdFolderPaths.set(key, Date.now())
    }
    created.push(seg)
  }
}

// ─── 云盘资源管理器与文件操作 API (SMH) ──────────────────────────

/**
 * 列出云盘目录下的文件和子目录
 */
export async function listDirectoryContents(
  userToken: string,
  dirPath: string[] = [],
  page = 1,
  pageSize = 100
): Promise<CloudPanDirectoryListing> {
  validateCloudPath(dirPath)
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000)
    throw new Error('无效的分页参数')
  const cred = await ensureCred(userToken)
  const pathPart = enc(dirPath)
  const pathUrl = pathPart ? `/${pathPart}` : ''
  const url = `${PAN_BASE}/api/v1/directory/${cred.libraryId}/${cred.spaceId}${pathUrl}?access_token=${cred.accessToken}&page=${page}&page_size=${pageSize}&order_by=name`

  const raw = await api<{
    contents?: Array<{
      name: string
      type: 'dir' | 'file'
      size?: number
      fileType?: string
      file_type?: string
      modificationTime?: string
      modification_time?: string
      creationTime?: string
      creation_time?: string
      crc64?: string
    }>
    totalNum?: number
    page?: number
    pageSize?: number
    page_size?: number
  }>(url)

  const contents: CloudPanItem[] = (raw.contents || []).map(item => ({
    name: item.name,
    type: item.type === 'dir' ? 'dir' : 'file',
    size: item.size !== undefined ? Number(item.size) : undefined,
    fileType: item.fileType || item.file_type || undefined,
    modificationTime: item.modificationTime || item.modification_time || new Date().toISOString(),
    creationTime: item.creationTime || item.creation_time || undefined,
    crc64: item.crc64 ? String(item.crc64) : undefined
  }))

  return {
    path: dirPath,
    currentDirName: dirPath.length > 0 ? dirPath[dirPath.length - 1] : '',
    totalNum: raw.totalNum ?? contents.length,
    page: raw.page ?? page,
    pageSize: raw.pageSize ?? raw.page_size ?? pageSize,
    contents
  }
}

/**
 * 在云盘中创建文件夹
 */
export async function createDirectory(userToken: string, dirPath: string[]): Promise<void> {
  validateCloudPath(dirPath)
  if (dirPath.length === 0) throw new Error('目录路径不能为空')
  const cred = await ensureCred(userToken)
  const path = enc(dirPath)
  const url = `${PAN_BASE}/api/v1/directory/${cred.libraryId}/${cred.spaceId}/${path}?conflict_resolution_strategy=ask&access_token=${cred.accessToken}`
  await api<unknown>(url, { method: 'PUT' })
  createdFolderPaths.set(JSON.stringify([userToken, ...dirPath]), Date.now())
}

/**
 * 删除云盘中的文件或目录
 */
export async function deleteCloudItem(userToken: string, targetPath: string[], isDir: boolean): Promise<void> {
  validateCloudPath(targetPath)
  if (targetPath.length === 0) throw new Error('目标路径不能为空')
  const cred = await ensureCred(userToken)
  const path = enc(targetPath)
  const typeSegment = isDir ? 'directory' : 'file'
  const url = `${PAN_BASE}/api/v1/${typeSegment}/${cred.libraryId}/${cred.spaceId}/${path}?access_token=${cred.accessToken}`
  await api<unknown>(url, { method: 'DELETE' })
  createdFolderPaths.clear()
}

/**
 * 重命名/移动云盘中的文件或目录
 */
export async function renameCloudItem(userToken: string, oldPath: string[], newName: string, isDir: boolean): Promise<void> {
  validateCloudPath(oldPath)
  if (oldPath.length === 0 || typeof newName !== 'string' || !newName.trim()) throw new Error('路径或新名称不能为空')
  validateCloudPath([newName], false)
  const cred = await ensureCred(userToken)
  const parentPath = oldPath.slice(0, -1)
  const newPath = [...parentPath, newName.trim()]
  const moveTo = enc(newPath)
  const typeSegment = isDir ? 'directory' : 'file'
  const url = `${PAN_BASE}/api/v1/${typeSegment}/${cred.libraryId}/${cred.spaceId}/${moveTo}?conflict_resolution_strategy=ask&access_token=${cred.accessToken}`
  await api<unknown>(url, { method: 'PUT', body: { from: oldPath.join('/') } })
  createdFolderPaths.clear()
}

/**
 * 通过 SMH 文件信息接口获取下载直链，不请求文件内容。
 */
export async function getFileDownloadUrl(userToken: string, filePath: string[]): Promise<string> {
  validateCloudPath(filePath)
  if (filePath.length === 0) throw new Error('文件路径不能为空')
  const cred = await ensureCred(userToken)
  const path = enc(filePath)
  // Electron session.fetch rejects manual redirects instead of exposing Location.
  // SMH's documented ?info endpoint returns the signed URL as JSON directly.
  const url = `${PAN_BASE}/api/v1/file/${cred.libraryId}/${cred.spaceId}/${path}?info&access_token=${encodeURIComponent(cred.accessToken)}`
  const data = await api<{ cosUrl?: string; url?: string; downloadUrl?: string }>(url)
  const downloadUrl = data?.cosUrl || data?.url || data?.downloadUrl
  if (typeof downloadUrl !== 'string' || !downloadUrl) {
    throw new Error('响应中未包含下载直链')
  }
  let target: URL
  try {
    target = new URL(downloadUrl)
  } catch {
    throw new Error('响应中的下载直链无效')
  }
  if (target.protocol !== 'https:' || target.username || target.password) throw new Error('响应中的下载直链不安全')
  return downloadUrl
}
