import type { CloudDriveApi, CloudTaskResult } from '@shared/cloud-drive'

/** Pending operations can outlive several submissions; each IPC query accepts at most 200 IDs. */
export async function queryTasksInBatches(ids: string[], query: CloudDriveApi['queryTasks']): Promise<CloudTaskResult[]> {
  const unique = [...new Set(ids)]
  const results: CloudTaskResult[] = []
  for (let index = 0; index < unique.length; index += 200) {
    const response = await query(unique.slice(index, index + 200))
    if (!response.ok || !response.results) throw new Error(response.error || '查询任务失败')
    results.push(...response.results)
  }
  return results
}
