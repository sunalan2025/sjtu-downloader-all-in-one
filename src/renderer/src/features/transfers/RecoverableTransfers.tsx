import { useState } from 'react'
import type { BackupTask } from '@shared/backup'
import { formatBytes } from '@shared/utils'

export function RecoverableTransfers({ tasks, onChanged }: { tasks: BackupTask[]; onChanged: () => Promise<void> }) {
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(tasks.length / 50))
  const current = Math.min(page, pages - 1)
  const run = async (ids: string[], cancel = false) => {
    setWorking(true)
    try {
      const result = await (cancel ? window.api.backup.cancelRecovery(ids) : window.api.backup.recover(ids))
      setMessage(result.ok ? `已${cancel ? '取消' : '恢复'} ${result.count ?? ids.length} 项任务` : result.error || '操作失败')
      await onChanged()
    } catch (error) { setMessage(error instanceof Error ? error.message : '恢复失败') }
    finally { setWorking(false) }
  }
  if (!tasks.length) return null
  return <section className="mb-6 space-y-3" aria-label="上次未完成的传输">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-sm font-semibold">上次未完成 · {tasks.length} 项</h2>
        <p className="mt-1 text-xs text-text-3">保留断点，验证来源后继续；HLS 与云盘中转可能需要重新传输。</p></div>
      <button className="ui-button ui-button-secondary" disabled={working || tasks.every(t => !!t.recoveryWarning)}
        onClick={() => void run(tasks.filter(t => !t.recoveryWarning).slice(0, 500).map(t => t.id))}>继续可恢复任务</button>
    </div>
    {message && <p role="status" className="text-sm text-text-2">{message}</p>}
    {tasks.slice(current * 50, current * 50 + 50).map(task => <article key={task.id} className="ui-panel ui-reveal flex flex-wrap items-center gap-4">
      <div className="min-w-0 flex-1">
        <h3 className="break-words text-sm font-semibold">{task.spec.fileName}</h3>
        <p className="mt-1 truncate text-xs text-text-3" title={task.spec.courseName}>{task.spec.backupCourse?.name || task.spec.courseName}</p>
        <p className="mt-2 text-xs text-text-2">{formatBytes(task.progress.received)} / {formatBytes(task.progress.total)} · {task.backend === 'local' ? '本机' : task.backend === 'cloud' ? '交大云盘' : '服务器'}</p>
        <p className="mt-1 text-xs text-text-3">{task.recoveryWarning || task.progress.message || '等待继续'}</p>
      </div>
      <button className="ui-button ui-button-secondary" disabled={working || !!task.recoveryWarning} onClick={() => void run([task.id])}>继续任务</button>
      {task.backend !== 'worker' && <button className="ui-button ui-button-secondary" disabled={working} title="取消此任务并清理其未完成分片" onClick={() => void run([task.id], true)}>取消任务</button>}
    </article>)}
    {pages > 1 && <div className="flex items-center justify-center gap-3 text-xs">
      <button className="ui-button ui-button-secondary" disabled={!current} onClick={() => setPage(current - 1)}>上一页</button>
      <span>{current + 1} / {pages}</span>
      <button className="ui-button ui-button-secondary" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>下一页</button>
    </div>}
  </section>
}
