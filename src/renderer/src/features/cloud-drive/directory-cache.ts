import type { CloudPanItem } from '@shared/types'
import { readDirectory } from './directory'

/** Owned by one mounted drive. Reuses ancestor listings without retaining another account's data. */
export function createDirectoryCache(load = readDirectory, now = Date.now) {
  let revision = 0
  let generation = 0
  const entries = new Map<string, { items: CloudPanItem[]; expires: number }>()
  const pending = new Map<string, Promise<CloudPanItem[]>>()
  const prepare = (next: number) => {
    if (next === revision) return
    revision = next
    generation++
    entries.clear()
    pending.clear()
  }
  const peek = (path: string[], next: number): CloudPanItem[] | undefined => {
    prepare(next)
    const key = JSON.stringify(path)
    const cached = entries.get(key)
    if (!cached) return undefined
    if (cached.expires <= now()) { entries.delete(key); return undefined }
    entries.delete(key)
    entries.set(key, cached)
    return cached.items
  }
  return {
    peek,
    read(path: string[], next: number): Promise<CloudPanItem[]> {
      const cached = peek(path, next)
      if (cached) return Promise.resolve(cached)
      const key = JSON.stringify(path)
      const existing = pending.get(key)
      if (existing) return existing
      const started = generation
      const request = load(path).then(items => {
        if (started === generation && items.length <= 20_000) {
          entries.set(key, { items, expires: now() + 30_000 })
          while (entries.size > 32 || [...entries.values()].reduce((sum, entry) => sum + entry.items.length, 0) > 20_000) {
            entries.delete(entries.keys().next().value!)
          }
        }
        return items
      }).finally(() => { if (pending.get(key) === request) pending.delete(key) })
      pending.set(key, request)
      return request
    }
  }
}
