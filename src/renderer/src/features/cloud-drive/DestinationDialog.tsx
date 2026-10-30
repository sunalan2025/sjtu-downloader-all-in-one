import { useState } from 'react'
import { validateCloudOperation, type CloudConflict, type CloudEntry, type CloudOperationKind } from '@shared/cloud-drive'
import { Button, Dialog } from '../../components/ui'
import { DropdownSelect, type DropdownOption } from '../../components/widgets'
import { useDirectory } from './useDirectory'

const conflictOptions: DropdownOption<CloudConflict>[] = [
  { value: 'ask', label: '报告冲突，保留现有项目' },
  { value: 'rename', label: '自动重命名新项目' }
]

export function DestinationDialog({
  kind,
  entries,
  initialPath,
  busy,
  error,
  onClose,
  onConfirm
}: {
  kind: CloudOperationKind
  entries: CloudEntry[]
  initialPath: string[]
  busy: boolean
  error?: string
  onClose: () => void
  onConfirm: (path: string[], conflict: CloudConflict) => void
}) {
  const [path, setPath] = useState(initialPath)
  const [revision, setRevision] = useState(0)
  const [conflict, setConflict] = useState<CloudConflict>('ask')
  const directory = useDirectory(path, revision)
  let reason = ''
  try {
    validateCloudOperation({ kind, entries, destination: path, conflict })
  } catch (err) {
    reason = (err as Error).message
  }
  const action = kind === 'copy' ? '复制' : '移动'
  return (
    <Dialog
      title={`${action} ${entries.length} 个项目到…`}
      busy={busy}
      onClose={onClose}
      actions={
        <>
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={busy || directory.loading || !!directory.error || !!reason}
            onClick={() => onConfirm(path, conflict)}
          >
            {busy ? '正在提交…' : `${action}到此文件夹`}
          </Button>
        </>
      }
    >
      <div className="ui-actions">
        <Button disabled={busy || !path.length} onClick={() => setPath(path.slice(0, -1))}>
          ↑ 上一级
        </Button>
        <Button disabled={busy} onClick={() => setPath([])}>
          根目录
        </Button>
        <span className="min-w-0 break-all text-xs text-text-2">/{path.join('/')}</span>
      </div>
      <div className="h-56 overflow-auto rounded-lg border border-bd" aria-label="选择目标文件夹">
        {directory.loading ? (
          <p className="p-4 text-text-2">加载中…</p>
        ) : directory.error ? (
          <div className="p-4 text-danger">
            {directory.error}
            <Button onClick={() => setRevision(v => v + 1)}>重试</Button>
          </div>
        ) : (
          <>
            {!directory.items.some(item => item.type === 'dir') && (
              <p className="p-4 text-sm text-text-3">此目录下没有子文件夹，可以直接选择当前目录。</p>
            )}
            {directory.items
              .filter(item => item.type === 'dir')
              .map(item => (
                <button
                  type="button"
                  disabled={busy}
                  key={item.name}
                  className="drive-row w-full text-left text-sm"
                  onClick={() => setPath([...path, item.name])}
                >
                  <span>📁</span>
                  <span className="truncate">{item.name}</span>
                  <span className="ml-auto">›</span>
                </button>
              ))}
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>遇到同名项目</span>
        <DropdownSelect<CloudConflict>
          value={conflict}
          onChange={setConflict}
          options={conflictOptions}
          disabled={busy}
          size="sm"
        />
      </div>
      {reason && (
        <p className="text-sm text-warning" role="status">
          {reason}
        </p>
      )}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
