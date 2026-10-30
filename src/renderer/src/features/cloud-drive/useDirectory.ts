import { createContext, useContext, useEffect, useState } from 'react'
import type { CloudPanItem } from '@shared/types'
import { readDirectory } from './directory'
import { createDirectoryCache } from './directory-cache'

export const DirectoryCacheContext = createContext<ReturnType<typeof createDirectoryCache> | null>(null)

export function useDirectory(path: string[], revision = 0) {
  const key = JSON.stringify(path)
  const cache = useContext(DirectoryCacheContext)
  const [state, setState] = useState<{ key: string; revision: number; items: CloudPanItem[]; loading: boolean; error: string }>({
    key: '',
    revision,
    items: [],
    loading: true,
    error: ''
  })
  useEffect(() => {
    let cancelled = false
    const cached = cache?.peek(JSON.parse(key), revision)
    setState({ key, revision, items: cached || [], loading: !cached, error: '' })
    void (cache ? cache.read(JSON.parse(key), revision) : readDirectory(JSON.parse(key)))
      .then(items => {
        if (!cancelled) setState({ key, revision, items, loading: false, error: '' })
      })
      .catch(err => {
        if (!cancelled) setState({ key, revision, items: [], loading: false, error: err instanceof Error ? err.message : '读取失败' })
      })
    return () => {
      cancelled = true
    }
  }, [key, revision, cache])
  // Never allow clicks on the previous folder during the render before effect cleanup.
  const cached = cache?.peek(path, revision)
  return state.key === key && state.revision === revision ? state : { items: cached || [], loading: !cached, error: '' }
}
