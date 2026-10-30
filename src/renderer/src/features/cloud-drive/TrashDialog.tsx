import { useEffect, useRef, useState } from 'react'
import type { CloudTrashItem } from '@shared/cloud-drive'
import { formatDate } from '@shared/utils'
import { Button, Dialog } from '../../components/ui'

export function TrashDialog({ onClose, onChanged }: { onClose: () => void; onChanged: (message: string) => void }) {
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [items, setItems] = useState<CloudTrashItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<CloudTrashItem | null>(null)
  const lock = useRef(false)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setItems([])
    void window.api.cloudpan
      .listTrash(page)
      .then(res => {
        if (cancelled) return
        if (!res.ok || !res.data) throw new Error(res.error || '回收站不可用')
        if (!res.data.contents.length && page > 1) setPage(page - 1)
        setItems(res.data.contents)
        setTotal(res.data.totalNum)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : '读取失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, revision])
  const mutate = async (item: CloudTrashItem, restore: boolean) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const res = await (restore ? window.api.cloudpan.restoreTrash(item.id) : window.api.cloudpan.purgeTrash(item.id))
      if (!res.ok) throw new Error(res.error || '操作失败')
      const successMessage = restore ? `已恢复「${item.name}」` : `已永久删除「${item.name}」`
      setMessage(successMessage)
      setConfirm(null)
      setRevision(value => value + 1)
      onChanged(successMessage)
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="云盘回收站"
      onClose={onClose}
      busy={busy}
      actions={
        confirm ? (
          <>
            <Button disabled={busy} onClick={() => setConfirm(null)}>
              取消删除
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void mutate(confirm, false)}>
              永久删除此项目
            </Button>
          </>
        ) : (
          <>
            <Button disabled={busy || loading} onClick={() => setRevision(value => value + 1)}>
              刷新
            </Button>
            <Button onClick={onClose} disabled={busy}>
              关闭
            </Button>
          </>
        )
      }
    >
      <p className="text-xs leading-5 text-text-2">
        恢复时保留现有同名文件并自动重命名；原文件夹已不存在时恢复到根目录。回收站是否可用由云盘服务端配置决定。
      </p>
      {message && (
        <p role="status" className="text-sm text-success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="break-all text-sm text-danger">
          {error}
        </p>
      )}
      {confirm ? (
        <div className="rounded-lg border border-danger/30 bg-danger-bg p-4 text-sm text-danger">
          将永久删除「{confirm.name}」及其包含的内容，此操作无法恢复。
        </div>
      ) : (
        <>
          <div className="max-h-80 space-y-2 overflow-auto">
            {loading ? (
              <p className="p-4 text-sm text-text-3">加载中…</p>
            ) : !items.length && !error ? (
              <p className="p-4 text-sm text-text-3">回收站为空</p>
            ) : (
              items.map(item => (
                <article key={item.id} className="ui-panel space-y-2">
                  <h3 className="break-all text-sm font-medium">
                    {item.type === 'dir' ? '📁' : '📄'} {item.name}
                  </h3>
                  <p className="break-all text-xs text-text-3">
                    原位置：/{item.originalPath.join('/')} · {formatDate(item.removalTime)}
                  </p>
                  <div className="ui-actions">
                    <Button disabled={busy || !item.canRestore} onClick={() => void mutate(item, true)}>
                      恢复
                    </Button>
                    <Button variant="danger" disabled={busy || !item.canDelete} onClick={() => setConfirm(item)}>
                      永久删除…
                    </Button>
                  </div>
                </article>
              ))
            )}
          </div>
          <div className="ui-actions justify-center">
            <Button disabled={busy || loading || page === 1} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <span className="text-xs">
              第 {page} 页 · 共 {total} 项
            </span>
            <Button disabled={busy || loading || page * 100 >= total} onClick={() => setPage(page + 1)}>
              下一页
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}
