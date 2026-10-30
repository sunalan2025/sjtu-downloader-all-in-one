import { useRef, useState } from 'react'
import { validateCloudPath, type CloudEntry } from '@shared/cloud-drive'
import { Button, Dialog } from '../../components/ui'

export interface NameTarget {
  path: string[]
  name: string
  type: 'dir' | 'file'
  create: boolean
}
export function NameDialog({ target, onClose, onDone }: { target: NameTarget; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(target.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const save = async () => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const clean = name.trim()
      validateCloudPath([clean], false)
      const result = target.create
        ? await window.api.cloudpan.createFolder([...target.path, clean])
        : await window.api.cloudpan.renameItem(target.path, clean, target.type === 'dir')
      if (!result.ok) throw new Error(result.error || '保存失败')
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={target.create ? '新建文件夹' : '重命名'}
      busy={busy}
      onClose={onClose}
      actions={
        <>
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form="cloud-name-form" variant="primary" disabled={busy || !name.trim()}>
            保存
          </Button>
        </>
      }
    >
      <form
        id="cloud-name-form"
        onSubmit={event => {
          event.preventDefault()
          void save()
        }}
      >
        <label className="flex flex-col gap-2 text-sm">
          名称
          <input
            className="ui-field w-full"
            autoFocus
            value={name}
            disabled={busy}
            maxLength={255}
            onChange={event => setName(event.target.value)}
          />
        </label>
      </form>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}

export function DeleteDialog({
  entries,
  onClose,
  onDone
}: {
  entries: CloudEntry[]
  onClose: () => void
  onDone: (message: string, error: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const remove = async () => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    const errors: string[] = []
    let done = 0
    // The token is not sent back through IPC; it only detects switching accounts between requests.
    const owner = await window.api.cloudpan.getCachedToken().catch(() => null)
    for (const entry of entries) {
      try {
        if (!owner || (await window.api.cloudpan.getCachedToken()) !== owner) {
          errors.push('云盘账号已切换，其余删除未执行')
          break
        }
        const res = await window.api.cloudpan.deleteItem(entry.path, entry.type === 'dir')
        if (!res.ok) throw new Error(res.error || '删除失败')
        done++
      } catch (err) {
        errors.push(`${entry.path.at(-1)}：${err instanceof Error ? err.message : '删除失败'}`)
      }
    }
    onDone(`已删除 ${done} 项。${errors.join('；')}`, !!errors.length)
    onClose()
  }
  return (
    <Dialog
      title={`删除 ${entries.length} 个项目？`}
      busy={busy}
      onClose={onClose}
      actions={
        <>
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void remove()}>
            确认删除
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-2">文件夹中的内容也会被删除。云盘启用回收站时可从回收站恢复；未启用时将永久删除。</p>
      <ul className="max-h-48 list-inside list-disc overflow-auto text-sm">
        {entries.map(entry => (
          <li key={JSON.stringify(entry.path)} className="break-all">
            /{entry.path.join('/')}
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
