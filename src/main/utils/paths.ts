import path from 'node:path'

/** Filesystem semantics belong to the main process; renderer utilities must not import node:path. */
export function normalizeComparePath(value: string): string {
  if (!value) return ''
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
