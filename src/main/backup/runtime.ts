import type { DownloadProgress, DownloadTaskSpec } from '../../shared/types'
import type { BackupBackend, BackupResult, DownloadOptions } from '../../shared/backup'
import { BackupCatalog, resourceIdentity } from './catalog'

let catalog: BackupCatalog | undefined
let ownerProvider: () => string = () => ''
let changed: () => void = () => {}
let shuttingDown = false
const owners = new Map<string, string>()
let recoveryHandler: (id: string) => Promise<BackupResult | null> = async () => null

export function initializeBackupRuntime(store: BackupCatalog, owner: () => string, notify: () => void): void {
  catalog = store
  ownerProvider = owner
  changed = notify
  shuttingDown = false
  owners.clear()
}
export function getBackupCatalog(): BackupCatalog | undefined {
  return catalog
}
export function currentBackupOwner(): string {
  return ownerProvider() || 'unidentified'
}
export function notifyBackupChanged(): void {
  changed()
}
export function setBackupRecoveryHandler(handler: typeof recoveryHandler): void {
  recoveryHandler = handler
}
export function tryRecoverBackupTask(id: string): Promise<BackupResult | null> {
  return recoveryHandler(id)
}

export function rememberDownload(
  spec: DownloadTaskSpec,
  backend: BackupBackend,
  options: DownloadOptions,
  paths?: { filePath: string; partPath: string }
): void {
  if (!catalog) return
  const owner = currentBackupOwner()
  catalog.admit(owner, spec, backend, options, paths)
  owners.set(spec.taskId, owner)
}
export function commitRememberedDownloads(): void {
  catalog?.flush()
  changed()
}
export interface BackupAdmission {
  spec: DownloadTaskSpec
  backend: BackupBackend
  options: DownloadOptions
  paths?: { filePath: string; partPath: string }
}
/** Commit all records before exposing any of them to a running scheduler. */
export function persistDownloadBatch(entries: BackupAdmission[]): void {
  if (!catalog) return
  const owner = currentBackupOwner()
  const previousTasks = new Map(entries.map(e => [`${owner}:${e.spec.taskId}`, catalog!.data.tasks[`${owner}:${e.spec.taskId}`]]))
  const previousResources = new Map(
    entries.map(e => {
      const id = resourceIdentity(owner, e.spec)
      return [id, catalog!.data.resources[id]]
    })
  )
  const previousOwners = new Map(entries.map(e => [e.spec.taskId, owners.get(e.spec.taskId)]))
  try {
    for (const e of entries) rememberDownload(e.spec, e.backend, e.options, e.paths)
    commitRememberedDownloads()
  } catch (error) {
    for (const [id, value] of previousTasks) {
      if (value) catalog.data.tasks[id] = value
      else delete catalog.data.tasks[id]
    }
    for (const [id, value] of previousResources) {
      if (value) catalog.data.resources[id] = value
      else delete catalog.data.resources[id]
    }
    for (const [id, value] of previousOwners) {
      if (value) owners.set(id, value)
      else owners.delete(id)
    }
    throw error
  }
}
export function recordBackupProgress(progress: DownloadProgress): void {
  if (shuttingDown) return
  const owner = owners.get(progress.taskId)
  if (owner) {
    const previous = catalog?.data.tasks[`${owner}:${progress.taskId}`]?.progress.state
    catalog?.progress(owner, progress)
    if (previous !== progress.state) changed()
  }
}
export function updateBackupRuntimeSpec(spec: DownloadTaskSpec, filePath?: string, partPath?: string): void {
  const owner = owners.get(spec.taskId)
  if (owner) catalog?.updateRuntime(owner, spec, filePath, partPath)
}
export function checkpointBackupBeforeQuit(): void {
  if (shuttingDown) return
  shuttingDown = true
  if (catalog) {
    catalog.markDirty()
    try {
      catalog.flush()
    } catch (error) {
      console.error('[backup] 退出前保存失败', error)
    }
  }
}
export function resetBackupRuntimeForTest(): void {
  catalog = undefined
  owners.clear()
  ownerProvider = () => ''
  shuttingDown = false
  recoveryHandler = async () => null
}
