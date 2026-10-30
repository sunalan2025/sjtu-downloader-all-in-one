import { useCallback, useEffect, useRef, useState } from 'react'
import type { BackupSnapshot } from '@shared/backup'

const empty: BackupSnapshot = { resources: [], recoverableTasks: [], subscriptions: [], busySubscriptionIds: [] }

/** Coalesce notifications while an IPC read is in flight; each screen requests only its own data. */
export function useLibrarySnapshot(scope: 'library' | 'transfers') {
  const [data, setData] = useState(empty)
  const [error, setError] = useState('')
  const read = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    let mounted = true
    let queued = false
    let running: Promise<void> | undefined
    const refresh = (): Promise<void> => {
      queued = true
      if (running) return running
      running = (async () => {
        while (queued && mounted && window.api.backup) {
          queued = false
          try {
            const snapshot = await window.api.backup.snapshot(scope)
            if (!Array.isArray(snapshot.resources)) throw Error('读取记录失败，请稍后重试')
            if (mounted) { setData(snapshot); setError('') }
          } catch (cause) {
            if (mounted) setError(cause instanceof Error ? cause.message : '读取失败')
          }
        }
      })().finally(() => { running = undefined })
      return running
    }
    read.current = refresh
    void refresh()
    const unsubscribe = window.api.backup?.onChanged(() => { void refresh() })
    return () => { mounted = false; unsubscribe?.() }
  }, [scope])
  const refresh = useCallback(() => read.current(), [])
  return { data, error, refresh }
}
