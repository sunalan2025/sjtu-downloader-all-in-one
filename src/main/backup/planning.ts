import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { BackupCopy, BackupResource, DownloadOptions } from '../../shared/backup'

export function inside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path))
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

/** Include the remote storage root: one server can host several independent backups. */
export function workerTarget(options: DownloadOptions): string {
  const worker = options.privateWorker
  return JSON.stringify([
    worker?.endpointUrl.replace(/\/+$/, ''),
    worker?.storageMode || 'cloudpan',
    worker?.storageMode === 'server_local'
      ? (worker.serverDownloadDir || '~/downloads').replace(/\/+$/, '')
      : (options.cloudDestRoot || '').replace(/^\/+|\/+$/g, '')
  ])
}

export function copyMatchesTarget(copy: BackupCopy, options: DownloadOptions, backend: 'local' | 'cloud'): boolean {
  if (copy.status !== 'present') return false
  if (backend === 'local')
    return copy.backend === 'local' && !!copy.filePath && !!options.localDestRoot && inside(options.localDestRoot, copy.filePath)
  if (options.privateWorker?.enabled) return copy.backend === 'worker' && copy.target === workerTarget(options)
  const root = (options.cloudDestRoot || '').replace(/^\/+|\/+$/g, '')
  return copy.backend === 'cloud' && !!copy.cloudPath && (!root || copy.cloudPath.replace(/^\/+/, '').startsWith(root + '/'))
}

export function missingMode(resource: BackupResource, options: DownloadOptions): 'local' | 'cloud' | 'both' | null {
  if (resource.excludedReason) return null
  const mode = options.mode || 'local'
  const local = mode !== 'cloud' && !resource.copies.some(c => c.version === resource.version && copyMatchesTarget(c, options, 'local'))
  const cloud = mode !== 'local' && !resource.copies.some(c => c.version === resource.version && copyMatchesTarget(c, options, 'cloud'))
  return local && cloud ? 'both' : local ? 'local' : cloud ? 'cloud' : null
}

export function versionedName(name: string, version: string): string {
  const extension = extname(name)
  return `${name.slice(0, extension ? -extension.length : undefined)} [${version.slice(0, 8)}]${extension}`
}

export function redactMessage(message: string): string {
  // Error strings may contain signed URLs. Keep useful diagnostics without persisting credentials.
  return message
    .replace(/https?:\/\/[^\s<>"']+/gi, '[下载地址已隐藏]')
    .replace(/((?:token|authorization|cookie|password)\s*[:=]\s*)[^\s,;]+/gi, '$1[已隐藏]')
    .slice(0, 500)
}
