import type { CloudTrashItem } from '../../shared/cloud-drive'
import { PAN_BASE, ensureCred, requestJson, createdFolderPaths } from './client'

export async function listCloudTrash(token: string, page = 1): Promise<{ contents: CloudTrashItem[]; totalNum: number }> {
  if (!Number.isInteger(page) || page < 1) throw new Error('无效的分页参数')
  const cred = await ensureCred(token)
  const { data } = await requestJson<{
    totalNum?: number
    contents?: Array<{
      recycledItemId: number | string
      name: string
      type: string
      originalPath?: string[]
      size?: string | number
      removalTime?: string
      authorityList?: { canRestore?: boolean; canDelete?: boolean }
    }>
  }>(
    `${PAN_BASE}/api/v1/recycled/${cred.libraryId}/${cred.spaceId}?page=${page}&page_size=100&order_by=removalTime&order_by_type=desc&access_token=${encodeURIComponent(cred.accessToken)}`
  )
  return {
    totalNum: data.totalNum ?? data.contents?.length ?? 0,
    contents: (data.contents || []).map(item => ({
      id: String(item.recycledItemId),
      name: item.name,
      type: item.type === 'dir' ? 'dir' : 'file',
      originalPath: item.originalPath || [],
      size: Number(item.size) || 0,
      removalTime: item.removalTime || '',
      canRestore: item.authorityList?.canRestore !== false,
      canDelete: item.authorityList?.canDelete !== false
    }))
  }
}

export async function mutateCloudTrash(token: string, id: string, restore: boolean): Promise<void> {
  if (typeof id !== 'string' || !/^\d{1,30}$/.test(id)) throw new Error('无效的回收站项目编号')
  const cred = await ensureCred(token)
  const query = restore ? '&restore&conflict_resolution_strategy=rename&restore_path_strategy=fallbackToRoot' : ''
  const { status } = await requestJson<unknown>(
    `${PAN_BASE}/api/v1/recycled/${cred.libraryId}/${cred.spaceId}/${id}?access_token=${encodeURIComponent(cred.accessToken)}${query}`,
    { method: restore ? 'POST' : 'DELETE' }
  )
  if (status !== 200 && status !== 204) throw new Error(`服务器返回 ${status}，请刷新回收站确认结果`)
  createdFolderPaths.clear()
}
