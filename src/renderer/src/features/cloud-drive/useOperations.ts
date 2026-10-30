import { useCallback, useEffect, useRef, useState } from 'react'
import type { CloudOperationRequest, CloudOperationResult } from '@shared/cloud-drive'
import { queryTasksInBatches } from './tasks'

export function useOperations(onRefresh: () => void) {
  const [results, setResults] = useState<CloudOperationResult[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const submit = useCallback(
    async (request: CloudOperationRequest) => {
      if (lock.current) return false
      lock.current = true
      setBusy(true)
      setError('')
      try {
        const response = await window.api.cloudpan.operate(request)
        if (!response.ok || !response.results) throw new Error(response.error || '提交失败')
        if (live.current) {
          setResults(previous => [...previous.filter(item => item.state === 'pending'), ...response.results!])
          onRefresh()
        }
        return true
      } catch (err) {
        if (live.current) setError(err instanceof Error ? err.message : '操作失败，请刷新目录确认结果')
        return false
      } finally {
        lock.current = false
        if (live.current) setBusy(false)
      }
    },
    [onRefresh]
  )
  useEffect(() => {
    const pending = results.filter(item => item.state === 'pending' && item.taskId)
    if (!pending.length || error) return
    let cancelled = false
    const timer = setTimeout(() => {
      void queryTasksInBatches(
        pending.map(item => item.taskId!),
        ids => window.api.cloudpan.queryTasks(ids)
      )
        .then(response => {
          if (cancelled) return
          const updates = new Map(response.map(item => [item.taskId, item]))
          setResults(previous =>
            previous.map(item => {
              const update = item.taskId ? updates.get(item.taskId) : undefined
              return update
                ? { ...item, state: update.state, error: update.error, destination: update.destination ?? item.destination }
                : item
            })
          )
          if (response.some(item => item.state !== 'pending')) onRefresh()
        })
        .catch(err => {
          if (!cancelled) setError(`任务状态查询失败，操作可能仍在服务器执行。${err instanceof Error ? err.message : ''}`)
        })
    }, 3000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [results, error, onRefresh])
  return {
    results,
    busy,
    error,
    submit,
    resume: () => setError(''),
    clear: () => setResults(previous => previous.filter(item => item.state === 'pending'))
  }
}
