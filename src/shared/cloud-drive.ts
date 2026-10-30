/** Cloud-drive contracts and path rules; no Electron, React or Node dependencies. */
export type CloudOperationKind = 'copy' | 'move'
export type CloudConflict = 'ask' | 'rename'
export interface CloudEntry {
  path: string[]
  type: 'file' | 'dir'
}
export interface CloudOperationRequest {
  kind: CloudOperationKind
  entries: CloudEntry[]
  destination: string[]
  conflict: CloudConflict
}
export interface CloudOperationResult {
  source: string[]
  destination: string[]
  state: 'done' | 'pending' | 'error'
  taskId?: string
  error?: string
}
export interface CloudTaskResult {
  taskId: string
  state: 'done' | 'pending' | 'error'
  destination?: string[]
  error?: string
}
export interface CloudDriveApi {
  listTrash: (page?: number) => Promise<{ ok: boolean; data?: { contents: CloudTrashItem[]; totalNum: number }; error?: string }>
  restoreTrash: (id: string) => Promise<{ ok: boolean; error?: string }>
  purgeTrash: (id: string) => Promise<{ ok: boolean; error?: string }>
  operate: (request: CloudOperationRequest) => Promise<{ ok: boolean; results?: CloudOperationResult[]; error?: string }>
  queryTasks: (ids: string[]) => Promise<{ ok: boolean; results?: CloudTaskResult[]; error?: string }>
  downloadEntries: (
    entries: CloudEntry[],
    targetDir?: string
  ) => Promise<{ ok: boolean; count?: number; errors?: string[]; error?: string }>
}
export interface CloudTrashItem {
  id: string
  name: string
  type: 'file' | 'dir'
  originalPath: string[]
  size: number
  removalTime: string
  canRestore: boolean
  canDelete: boolean
}

export function validateCloudPath(value: unknown, allowRoot = true): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 128 || (!allowRoot && !value.length)) throw new Error('无效的云盘路径')
  for (const part of value) {
    if (
      typeof part !== 'string' ||
      !part.trim() ||
      part === '.' ||
      part === '..' ||
      part.length > 255 ||
      /[/\\\u0000-\u001f\u007f]/.test(part)
    ) {
      throw new Error('名称不能为空，不能包含路径分隔符、控制字符或相对路径')
    }
  }
  if (value.join('/').length > 4096) throw new Error('云盘路径过长')
}

export function pathStartsWith(path: string[], parent: string[]): boolean {
  return path.length >= parent.length && parent.every((part, i) => part === path[i])
}

export function validateCloudOperation(value: CloudOperationRequest): void {
  if (!value || !['copy', 'move'].includes(value.kind) || !['ask', 'rename'].includes(value.conflict)) throw new Error('无效的文件操作')
  validateCloudPath(value.destination)
  if (!Array.isArray(value.entries) || !value.entries.length || value.entries.length > 200) throw new Error('每次请选择 1 至 200 个项目')
  const seen = new Set<string>()
  for (const entry of value.entries) {
    if (!entry || !['dir', 'file'].includes(entry.type)) throw new Error('无效的项目类型')
    validateCloudPath(entry.path, false)
    const key = JSON.stringify(entry.path)
    if (seen.has(key)) throw new Error('选择包含重复项目')
    seen.add(key)
    if (entry.type === 'dir' && pathStartsWith(value.destination, entry.path)) throw new Error('不能将文件夹放入自身或其子文件夹')
    if (value.kind === 'move' && JSON.stringify(entry.path.slice(0, -1)) === JSON.stringify(value.destination))
      throw new Error('项目已经位于目标文件夹')
    if (value.entries.some(other => other !== entry && other.type === 'dir' && pathStartsWith(entry.path, other.path)))
      throw new Error('不能同时选择文件夹及其内部项目')
  }
}
