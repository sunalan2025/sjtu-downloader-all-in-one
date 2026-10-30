import {
  validateCloudOperation,
  type CloudOperationRequest,
  type CloudOperationResult,
  type CloudTaskResult
} from '../../shared/cloud-drive'
import { PAN_BASE, ensureCred, enc, requestJson, getCachedUserToken, createdFolderPaths } from './client'

/** A batch is intentionally non-atomic. Return an outcome for every selected item. Never retry a mutation automatically. */
export async function operateCloudEntries(token: string, request: CloudOperationRequest): Promise<CloudOperationResult[]> {
  validateCloudOperation(request)
  const results: CloudOperationResult[] = []
  for (const entry of request.entries) {
    const destination = [...request.destination, entry.path[entry.path.length - 1]]
    try {
      if (getCachedUserToken() !== token) throw new Error('云盘账号已切换，未继续操作')
      const cred = await ensureCred(token)
      if (getCachedUserToken() !== token) throw new Error('云盘账号已切换，未继续操作')
      const type = entry.type === 'dir' ? 'directory' : 'file'
      const url = `${PAN_BASE}/api/v1/${type}/${cred.libraryId}/${cred.spaceId}/${enc(destination)}?access_token=${encodeURIComponent(cred.accessToken)}&conflict_resolution_strategy=${request.conflict}`
      const { status, data } = await requestJson<{ path?: string[]; taskId?: string | number }>(url, {
        method: 'PUT',
        body: { [request.kind === 'copy' ? 'copyFrom' : 'from']: entry.path.join('/') }
      })
      if (status === 202) {
        if (data?.taskId === undefined) throw new Error('服务器已接受操作但未返回任务编号，请刷新确认结果，勿重复提交')
        results.push({ source: entry.path, destination, state: 'pending', taskId: String(data.taskId) })
      } else if (status === 200 || status === 201 || status === 204) {
        results.push({ source: entry.path, destination: data?.path ?? destination, state: 'done' })
      } else throw new Error(`操作结果未确认（HTTP ${status}），请刷新目录检查`)
    } catch (err) {
      results.push({
        source: entry.path,
        destination,
        state: 'error',
        error: err instanceof Error ? err.message : '操作失败，请刷新目录确认结果'
      })
    }
  }
  createdFolderPaths.clear()
  return results
}

export async function queryCloudTasks(token: string, ids: string[]): Promise<CloudTaskResult[]> {
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(id => typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id)))
    throw new Error('无效的云盘任务编号')
  const cred = await ensureCred(token)
  const { data } = await requestJson<
    Array<{
      id?: string | number
      taskId?: string | number
      status: number
      result?: { path?: string[]; message?: string }
      message?: string
    }>
  >(`${PAN_BASE}/api/v1/task/${cred.libraryId}/${cred.spaceId}/${ids.join(',')}?access_token=${encodeURIComponent(cred.accessToken)}`)
  return ids.map(taskId => {
    const task = data?.find(t => String(t.taskId ?? t.id) === taskId)
    if (!task) return { taskId, state: 'error', error: '未找到任务，请刷新目录确认结果' }
    if (task.status === 200 || task.status === 204) return { taskId, state: 'done', destination: task.result?.path }
    if (task.status === 202 || task.status === 201) return { taskId, state: 'pending' }
    return { taskId, state: 'error', error: task.result?.message || task.message || `服务器任务返回状态 ${task.status}，请检查目录` }
  })
}
