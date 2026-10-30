import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { CloudTrashItem } from '@shared/cloud-drive'
import { formatBytes, formatDate } from '@shared/utils'
import { Button, Dialog, EmptyState, Page, PageHeader, Toolbar } from '../../components/ui'
import { NetdiskViewModeSwitch } from '../../components/DownloadUI'
import { SelectionSurface } from '../file-manager/SelectionSurface'
import { FileIcon } from './FileViews'

type ConfirmAction =
  | { type: 'purge-all' }
  | { type: 'purge-selected'; items: CloudTrashItem[] }
  | { type: 'restore-single'; item: CloudTrashItem }

export function TrashView({
  onBack,
  onChanged
}: {
  onBack: () => void
  onChanged?: (message: string) => void
}) {
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [items, setItems] = useState<CloudTrashItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'list' | 'grid'>(() => {
    try {
      const saved = localStorage.getItem('cloud-trash-view')
      return saved === 'grid' ? 'grid' : 'list'
    } catch {
      return 'list'
    }
  })

  const handleModeChange = (next: 'grid' | 'list' | 'column') => {
    if (next === 'list' || next === 'grid') {
      setMode(next)
      try {
        localStorage.setItem('cloud-trash-view', next)
      } catch {
        /* Optional preference */
      }
    }
  }
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const lock = useRef(false)

  // 读取回收站列表
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setNotice(null)
    setSelected(new Set())
    void window.api.cloudpan
      .listTrash(page)
      .then(res => {
        if (cancelled) return
        if (!res.ok || !res.data) throw new Error(res.error || '回收站不可用')
        if (!res.data.contents.length && page > 1) {
          setPage(p => p - 1)
          return
        }
        setItems(res.data.contents)
        setTotal(res.data.totalNum)
      })
      .catch(err => {
        if (!cancelled) setNotice({ error: true, text: err instanceof Error ? err.message : '读取失败' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, revision])

  // 回收站列表项
  const filteredItems = items

  // 全选状态与切换
  const allSelected = !!filteredItems.length && filteredItems.every(item => selected.has(item.id))
  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredItems.map(item => item.id)))
    }
  }

  // 批量还原
  const handleBatchRestore = async () => {
    const targets = filteredItems.filter(it => selected.has(it.id))
    if (!targets.length || lock.current) return
    lock.current = true
    setBusy(true)
    setNotice(null)
    try {
      const results = await Promise.allSettled(targets.map(it => window.api.cloudpan.restoreTrash(it.id)))
      const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.ok).length
      const failed = targets.length - succeeded
      const msg = `已恢复 ${succeeded} 个项目${failed > 0 ? `（${failed} 项失败）` : ''}`
      setNotice({ text: msg, error: failed > 0 && succeeded === 0 })
      onChanged?.(msg)
      setSelected(new Set())
      setRevision(r => r + 1)
    } catch (err) {
      setNotice({ error: true, text: err instanceof Error ? err.message : '还原操作失败' })
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  // 批量永久删除
  const handleBatchPurge = async (targets: CloudTrashItem[]) => {
    if (!targets.length || lock.current) return
    lock.current = true
    setBusy(true)
    setNotice(null)
    setConfirmAction(null)
    try {
      const results = await Promise.allSettled(targets.map(it => window.api.cloudpan.purgeTrash(it.id)))
      const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.ok).length
      const failed = targets.length - succeeded
      const msg = `已永久删除 ${succeeded} 个项目${failed > 0 ? `（${failed} 项失败）` : ''}`
      setNotice({ text: msg, error: failed > 0 && succeeded === 0 })
      onChanged?.(msg)
      setSelected(new Set())
      setRevision(r => r + 1)
    } catch (err) {
      setNotice({ error: true, text: err instanceof Error ? err.message : '彻底删除失败' })
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  // 清空回收站
  const handleEmptyTrash = async () => {
    if (!items.length || lock.current) return
    lock.current = true
    setBusy(true)
    setNotice(null)
    setConfirmAction(null)
    try {
      const results = await Promise.allSettled(items.map(it => window.api.cloudpan.purgeTrash(it.id)))
      const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.ok).length
      const msg = `已清空当前 ${succeeded} 个回收站项目`
      setNotice({ text: msg })
      onChanged?.(msg)
      setSelected(new Set())
      setRevision(r => r + 1)
    } catch (err) {
      setNotice({ error: true, text: err instanceof Error ? err.message : '清空回收站失败' })
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  // 单个还原
  const handleSingleRestore = async (item: CloudTrashItem) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setNotice(null)
    setConfirmAction(null)
    try {
      const res = await window.api.cloudpan.restoreTrash(item.id)
      if (!res.ok) throw new Error(res.error || '还原失败')
      const msg = `已恢复「${item.name}」`
      setNotice({ text: msg })
      onChanged?.(msg)
      setRevision(r => r + 1)
    } catch (err) {
      setNotice({ error: true, text: err instanceof Error ? err.message : '还原失败' })
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  // 键盘快捷键监听
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('input,textarea,dialog')) return
    const modifier = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()

    if (modifier && key === 'a') {
      event.preventDefault()
      setSelected(new Set(filteredItems.map(it => it.id)))
    } else if (key === 'escape') {
      if (selected.size > 0) {
        event.preventDefault()
        setSelected(new Set())
      } else {
        event.preventDefault()
        onBack()
      }
    } else if (key === 'delete' && selected.size > 0) {
      event.preventDefault()
      const targets = filteredItems.filter(it => selected.has(it.id))
      setConfirmAction({ type: 'purge-selected', items: targets })
    }
  }

  // 双击项目快捷还原
  const handleItemOpen = (id: string) => {
    const target = items.find(it => it.id === id)
    if (target && target.canRestore) {
      setConfirmAction({ type: 'restore-single', item: target })
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / 100))

  return (
    <Page tabIndex={0} onKeyDown={onKeyDown}>
      {/* 第 1 行：回收站全局页头 */}
      <PageHeader
        title="回收站"
        description="被删除的项目保留在此，原路径不存在时将恢复至根目录"
        actions={
          <Button
            variant="danger"
            disabled={busy || loading || !items.length}
            onClick={() => setConfirmAction({ type: 'purge-all' })}
            title="彻底清空回收站中所有文件"
          >
            清空回收站
          </Button>
        }
      />

      {/* 第 2 行：浏览与控制工具栏 */}
      <Toolbar className="justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button disabled={busy} onClick={onBack} title="返回我的文件列表">
            ← 返回我的文件
          </Button>
          <span className="text-text-4 font-mono text-xs">/</span>
          <span className="text-xs font-semibold text-text-1">回收站</span>
        </div>

        <div className="ml-3 flex shrink-0 items-center gap-2">
          <NetdiskViewModeSwitch
            mode={mode}
            modes={['grid', 'list']}
            onChange={handleModeChange}
          />
        </div>
      </Toolbar>

      {/* 第 3 行：条件浮现批量操作栏（平滑折叠展开动效） */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-in-out ${
          selected.size > 0 ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
        }`}
      >
        <div className="overflow-hidden">
          <Toolbar className="border-b border-accent/20 bg-accent/5 justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <label className="mr-1 flex items-center gap-1.5 text-xs font-medium text-text-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded accent-accent cursor-pointer"
                  checked={allSelected}
                  disabled={!filteredItems.length}
                  onChange={toggleAll}
                />
                全选
              </label>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void handleBatchRestore()}
                title="将所选文件还原至原路径"
              >
                还原已选 ({selected.size})
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  const targets = filteredItems.filter(it => selected.has(it.id))
                  setConfirmAction({ type: 'purge-selected', items: targets })
                }}
                title="彻底删除所选文件，无法恢复"
              >
                永久删除 ({selected.size})
              </Button>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                onClick={() => setSelected(new Set())}
                title="取消选择 (Esc)"
                className="text-text-3 hover:text-text-1"
              >
                ✕ 取消选择
              </Button>
            </div>
          </Toolbar>
        </div>
      </div>

      {/* 提示消息浮条 */}
      {notice && (
        <div
          className={`mx-4 mt-3 flex shrink-0 items-start gap-3 rounded-lg border border-bd p-3 text-xs ${
            notice.error ? 'bg-danger-bg text-danger' : 'bg-surface-2 text-text-2'
          }`}
          role={notice.error ? 'alert' : 'status'}
        >
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{notice.text}</p>
          <button aria-label="关闭提示" onClick={() => setNotice(null)} className="cursor-pointer hover:text-text-1">
            ✕
          </button>
        </div>
      )}

      {/* 通用文件管理器画布：SelectionSurface 承载拖拽框选与多选 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {mode === 'list' && (
          <div className="flex shrink-0 items-center border-b border-bd bg-surface-2/60 px-4 py-2 text-2xs font-semibold text-text-3">
            <div className="w-8 shrink-0" />
            <div className="min-w-0 flex-1">名称</div>
            <div className="hidden w-48 shrink-0 md:block xl:w-64">原位置</div>
            <div className="hidden w-36 shrink-0 sm:block">删除时间</div>
            <div className="w-20 shrink-0 text-right">大小</div>
            <div className="w-24 shrink-0 text-center">操作</div>
          </div>
        )}

        <SelectionSurface
          label="回收站文件列表"
          items={filteredItems.map(item => ({ id: item.id, selected: selected.has(item.id), directory: item.type === 'dir' }))}
          onSelectionChange={next => setSelected(next)}
          onOpen={handleItemOpen}
          className={`min-h-0 flex-1 overflow-auto ${mode === 'grid' ? 'ui-content' : 'pb-6'}`}
        >
          {loading ? (
            <EmptyState title="正在读取回收站…">正在拉取已删除文件列表，请稍候。</EmptyState>
          ) : !filteredItems.length ? (
            <EmptyState title="回收站为空">
              没有被删除的文件或文件夹。
            </EmptyState>
          ) : mode === 'grid' ? (
            <div className="drive-grid">
              {filteredItems.map(item => (
                <div
                  key={item.id}
                  data-selection-id={item.id}
                  tabIndex={-1}
                  role="option"
                  aria-selected={selected.has(item.id)}
                  title={`原位置：/${item.originalPath.join('/')}\n双击可快速还原`}
                  className={`drive-card cursor-default outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                    selected.has(item.id)
                      ? 'bg-accent/10 ring-1 ring-inset ring-accent/30'
                      : 'hover:bg-surface-2'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="absolute left-2.5 top-2.5 h-4 w-4 shrink-0 rounded accent-accent cursor-pointer"
                    aria-label={`选择 ${item.name}`}
                    checked={selected.has(item.id)}
                    onClick={e => e.stopPropagation()}
                    onChange={() => {
                      const next = new Set(selected)
                      if (next.has(item.id)) next.delete(item.id)
                      else next.add(item.id)
                      setSelected(next)
                    }}
                  />
                  <FileIcon item={item} size={44} />
                  <span className="w-full truncate text-center text-xs font-medium text-text-1">
                    {item.name}
                  </span>
                  <span className="w-full truncate text-center text-2xs text-text-3">
                    /{item.originalPath.join('/')}
                  </span>
                  <span className="text-2xs text-text-3 font-mono">
                    {formatDate(item.removalTime)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div>
              {filteredItems.map(item => (
                <div
                  key={item.id}
                  data-selection-id={item.id}
                  tabIndex={-1}
                  role="option"
                  aria-selected={selected.has(item.id)}
                  title={`双击可快速还原「${item.name}」`}
                  className={`drive-row cursor-default outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                    selected.has(item.id)
                      ? 'bg-accent/10 ring-1 ring-inset ring-accent/30'
                      : 'hover:bg-surface-2'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 rounded accent-accent cursor-pointer"
                    aria-label={`选择 ${item.name}`}
                    checked={selected.has(item.id)}
                    onClick={e => e.stopPropagation()}
                    onChange={() => {
                      const next = new Set(selected)
                      if (next.has(item.id)) next.delete(item.id)
                      else next.add(item.id)
                      setSelected(next)
                    }}
                  />
                  <FileIcon item={item} size={24} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-1">
                    {item.name}
                  </span>
                  <span className="hidden w-48 shrink-0 truncate text-2xs text-text-3 md:block xl:w-64" title={`/${item.originalPath.join('/')}`}>
                    /{item.originalPath.join('/')}
                  </span>
                  <span className="hidden w-36 shrink-0 font-mono text-2xs text-text-3 sm:block">
                    {formatDate(item.removalTime)}
                  </span>
                  <span className="w-20 shrink-0 text-right font-mono text-2xs text-text-3">
                    {item.type === 'dir' ? '--' : formatBytes(item.size)}
                  </span>
                  <div className="flex w-24 shrink-0 items-center justify-center gap-1">
                    <button
                      type="button"
                      disabled={busy || !item.canRestore}
                      onClick={e => {
                        e.stopPropagation()
                        void handleSingleRestore(item)
                      }}
                      className="rounded px-1.5 py-0.5 text-2xs font-medium text-accent hover:bg-accent/10 transition-colors disabled:opacity-40"
                      title="还原到原位置"
                    >
                      还原
                    </button>
                    <button
                      type="button"
                      disabled={busy || !item.canDelete}
                      onClick={e => {
                        e.stopPropagation()
                        setConfirmAction({ type: 'purge-selected', items: [item] })
                      }}
                      className="rounded px-1.5 py-0.5 text-2xs font-medium text-danger hover:bg-danger-bg transition-colors disabled:opacity-40"
                      title="彻底删除"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SelectionSurface>

        {/* 底栏分页控制 */}
        <div className="flex shrink-0 items-center justify-center gap-3 border-t border-bd bg-surface-1 p-3">
          <Button disabled={busy || loading || page <= 1} onClick={() => setPage(p => p - 1)}>
            上一页
          </Button>
          <span className="font-mono text-xs text-text-3">
            第 {page} 页 · 共 {totalPages} 页{total > 0 ? ` (共 ${total} 项)` : ''}
          </span>
          <Button disabled={busy || loading || page >= totalPages} onClick={() => setPage(p => p + 1)}>
            下一页
          </Button>
        </div>
      </div>

      {/* 二次安全确认对话框 */}
      {confirmAction?.type === 'purge-all' && (
        <Dialog
          title="清空回收站"
          onClose={() => setConfirmAction(null)}
          busy={busy}
          actions={
            <>
              <Button disabled={busy} onClick={() => setConfirmAction(null)}>
                取消
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void handleEmptyTrash()}>
                彻底清空
              </Button>
            </>
          }
        >
          <div className="space-y-2">
            <p className="text-sm text-text-1">
              确定要彻底清空当前回收站中的所有文件吗？
            </p>
            <p className="text-xs text-danger">
              ⚠️ 此操作不可撤销，回收站中的所有文件与文件夹将被永久彻底粉碎！
            </p>
          </div>
        </Dialog>
      )}

      {confirmAction?.type === 'purge-selected' && (
        <Dialog
          title="永久删除文件"
          onClose={() => setConfirmAction(null)}
          busy={busy}
          actions={
            <>
              <Button disabled={busy} onClick={() => setConfirmAction(null)}>
                取消
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void handleBatchPurge(confirmAction.items)}
              >
                彻底删除
              </Button>
            </>
          }
        >
          <div className="space-y-2">
            <p className="text-sm text-text-1">
              确定要彻底删除已选的 {confirmAction.items.length} 个项目吗？
            </p>
            <p className="text-xs text-danger">
              ⚠️ 选中的项目及其子内容将被永久删除，无法再次还原！
            </p>
          </div>
        </Dialog>
      )}

      {confirmAction?.type === 'restore-single' && (
        <Dialog
          title="还原文件"
          onClose={() => setConfirmAction(null)}
          busy={busy}
          actions={
            <>
              <Button disabled={busy} onClick={() => setConfirmAction(null)}>
                取消
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void handleSingleRestore(confirmAction.item)}
              >
                立即还原
              </Button>
            </>
          }
        >
          <div className="space-y-2 text-xs text-text-2">
            <p className="text-sm font-medium text-text-1">
              是否将「{confirmAction.item.name}」还原至原位置？
            </p>
            <p className="font-mono text-text-3">
              原路径：/{confirmAction.item.originalPath.join('/')}
            </p>
            <p className="text-2xs text-text-3">
              若原文件夹已不存在将恢复至个人根目录；若目标位置存在同名文件将自动重命名保留。
            </p>
          </div>
        </Dialog>
      )}
    </Page>
  )
}
