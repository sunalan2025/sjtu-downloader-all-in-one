import { useEffect, useMemo, useRef, useState } from 'react'
import type { CloudPanItem } from '@shared/types'
import { formatBytes, formatDate } from '@shared/utils'
import { MacOSFolderIcon, MacOSDocumentIcon } from '../../components/DownloadUI'
import { Button, EmptyState } from '../../components/ui'
import { SelectionSurface } from '../file-manager/SelectionSurface'
import type { SelectionMenuRequest } from '../file-manager/ContextMenu'
import { useDirectory } from './useDirectory'
import { sortItems } from './directory'

export interface FileSelection {
  item: CloudPanItem
  parent: string[]
}
export type SelectFiles = (path: string[], items: CloudPanItem[], selected: Set<string>) => void
export type CloudContextMenu = (path: string[], items: CloudPanItem[], request: SelectionMenuRequest) => void
export function FileIcon({ item, size = 32 }: { item: { type: 'dir' | 'file'; name: string }; size?: number }) {
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center">
      {item.type === 'dir' ? <MacOSFolderIcon size={size} /> : <MacOSDocumentIcon filename={item.name} size={size} />}
    </span>
  )
}

export function FileList({
  items,
  path,
  selected = new Set(),
  onSelectionChange,
  onOpen,
  onInspect,
  onContextMenu,
  grid = false,
  column = false,
  activeName,
  disabled = false
}: {
  items: CloudPanItem[]
  path: string[]
  selected?: Set<string>
  onSelectionChange: SelectFiles
  onOpen: (file: FileSelection) => void
  grid?: boolean
  column?: boolean
  activeName?: string
  disabled?: boolean
  onInspect?: (file: FileSelection) => void
  onContextMenu?: CloudContextMenu
}) {
  const [page, setPage] = useState(1)
  const count = Math.max(1, Math.ceil(items.length / 100))
  const current = Math.min(page, count)
  useEffect(() => {
    setPage(1)
  }, [items])
  const open = (id: string) => {
    const item = items.find(item => item.name === id)
    if (item && !disabled) onOpen({ item, parent: path })
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SelectionSurface
        key={JSON.stringify(path)}
        label={`文件列表：${path.at(-1) || '个人根目录'}`}
        items={items.map(item => ({ id: item.name, selected: selected.has(item.name), directory: item.type === 'dir', disabled }))}
        onSelectionChange={next => onSelectionChange(path, items, next)}
        onOpen={open}
        onContextMenu={onContextMenu ? request => onContextMenu(path, items, request) : undefined}
        onActivate={
          column
            ? id => {
                const item = items.find(item => item.name === id)
                if (item) onInspect?.({ item, parent: path })
              }
            : undefined
        }
        column={column}
        className={`min-h-0 flex-1 overflow-auto ${grid ? 'ui-content' : 'pb-8'}`}
      >
        {!items.length ? (
          <EmptyState title="没有项目">文件夹为空，或没有匹配的搜索结果。</EmptyState>
        ) : (
          <div className={grid ? 'drive-grid' : ''}>
            {items.slice((current - 1) * 100, current * 100).map(item => (
              <div
                key={item.name}
                data-selection-id={item.name}
                tabIndex={-1}
                role="option"
                aria-selected={selected.has(item.name)}
                title={item.name}
                className={`${grid ? 'drive-card' : column ? 'drive-column-row' : 'drive-row'} cursor-default outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${selected.has(item.name) ? 'bg-accent/10 ring-1 ring-inset ring-accent/30' : activeName === item.name ? 'bg-surface-2 text-accent' : ''}`}
              >
                <input
                  type="checkbox"
                  className={`h-4 w-4 shrink-0 accent-accent ${grid ? 'absolute left-2 top-2' : ''}`}
                  aria-label={`选择 ${item.name}`}
                  checked={selected.has(item.name)}
                  disabled={disabled}
                  onClick={event => event.stopPropagation()}
                  onDoubleClick={event => event.stopPropagation()}
                  onChange={() => {
                    const next = new Set(selected)
                    if (next.has(item.name)) next.delete(item.name)
                    else next.add(item.name)
                    onSelectionChange(path, items, next)
                  }}
                />
                <FileIcon item={item} size={grid ? 64 : column ? 24 : 32} />
                <span
                  className={`min-w-0 flex-1 text-sm font-medium ${grid ? 'w-full line-clamp-2 min-h-10 break-all text-center' : 'truncate'}`}
                >
                  {item.name}
                </span>
                {column ? (
                  item.type === 'dir' && (
                    <span aria-hidden="true" className="shrink-0 text-text-4">
                      ›
                    </span>
                  )
                ) : (
                  <div className={`flex shrink-0 gap-4 text-xs text-text-3 ${grid ? 'justify-center' : ''}`}>
                    <span className={grid ? 'text-center' : 'w-16 text-right'}>
                      {item.type === 'dir' ? '文件夹' : formatBytes(item.size ?? 0)}
                    </span>
                    {!grid && <span className="hidden w-32 text-right xl:block">{formatDate(item.modificationTime)}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SelectionSurface>
      {count > 1 && (
        <div className="ui-toolbar justify-center">
          <Button disabled={current === 1} onClick={() => setPage(current - 1)}>
            上一页
          </Button>
          <span className="text-xs">
            {current} / {count} · 共 {items.length} 项
          </span>
          <Button disabled={current === count} onClick={() => setPage(current + 1)}>
            下一页
          </Button>
        </div>
      )}
    </div>
  )
}

function DirectoryColumn({
  path,
  revision,
  onOpen,
  onInspect,
  onRetry,
  onNavigate,
  onSelectionChange,
  selected,
  activeName,
  disabled,
  currentItems,
  onContextMenu
}: {
  path: string[]
  revision: number
  onOpen: (file: FileSelection) => void
  onRetry: () => void
  onNavigate: (path: string[]) => void
  onSelectionChange: SelectFiles
  selected: Set<string>
  activeName?: string
  currentItems?: CloudPanItem[]
  disabled: boolean
  onInspect: (file: FileSelection) => void
  onContextMenu?: CloudContextMenu
}) {
  const directory = useDirectory(path, revision)
  const items = useMemo(() => sortItems(directory.items, '', 'name', false), [directory.items])
  return (
    <section className={`drive-column ui-column-enter ${currentItems ? 'drive-column-current' : ''}`} aria-label={path.at(-1) || '根目录'} aria-busy={directory.loading}>
      <button
        className="drive-column-heading text-left hover:text-accent"
        title={`返回 ${path.at(-1) || '个人根目录'}`}
        onClick={() => onNavigate(path)}
        disabled={disabled}
      >
        {path.at(-1) || '个人根目录'}
      </button>
      {directory.loading ? (
        <div className="p-4 text-xs text-text-3 ui-loading-breathe" role="status">正在读取文件夹…</div>
      ) : directory.error ? (
        <EmptyState title="加载失败">
          <p>{directory.error}</p>
          <Button onClick={onRetry}>重试</Button>
        </EmptyState>
      ) : (
        <FileList
          items={currentItems ?? items}
          path={path}
          selected={selected}
          onSelectionChange={onSelectionChange}
          onOpen={onOpen}
          onInspect={onInspect}
          onContextMenu={onContextMenu}
          column
          activeName={activeName}
          disabled={disabled}
        />
      )}
    </section>
  )
}

export function ColumnView({
  path,
  revision,
  items,
  selected,
  selectionPath,
  onSelectionChange,
  onOpen,
  onRetry,
  onNavigate,
  disabled = false,
  onContextMenu
}: {
  path: string[]
  revision: number
  items: CloudPanItem[]
  selected: Set<string>
  selectionPath: string[]
  onSelectionChange: SelectFiles
  onOpen: (file: FileSelection) => void
  onRetry: () => void
  onNavigate: (path: string[]) => void
  disabled?: boolean
  onContextMenu?: CloudContextMenu
}) {
  const container = useRef<HTMLDivElement>(null)
  const [inspected, setInspected] = useState<FileSelection | null>(null)
  const pathKey = JSON.stringify(path)
  useEffect(() => {
    setInspected(null)
    const frame = requestAnimationFrame(() => container.current?.scrollTo({ left: container.current.scrollWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }))
    return () => cancelAnimationFrame(frame)
  }, [pathKey])
  useEffect(() => {
    if (!inspected) return
    const frame = requestAnimationFrame(() => container.current?.scrollTo({ left: container.current.scrollWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }))
    return () => cancelAnimationFrame(frame)
  }, [inspected])
  const columns = Array.from({ length: path.length + 1 }, (_, index) => path.slice(0, index))
  const selectionAt = (parent: string[]) => (JSON.stringify(parent) === JSON.stringify(selectionPath) ? selected : new Set<string>())
  return (
    <div ref={container} className="drive-columns">
      {columns.map(parent => (
        <DirectoryColumn
          key={JSON.stringify(parent)}
          path={parent}
          revision={revision}
          onOpen={onOpen}
          onRetry={onRetry}
          onNavigate={onNavigate}
          onInspect={setInspected}
          onContextMenu={onContextMenu}
          onSelectionChange={onSelectionChange}
          selected={selectionAt(parent)}
          activeName={path[parent.length]}
          currentItems={parent.length === path.length ? items : undefined}
          disabled={disabled}
        />
      ))}
      {inspected && (
        <aside className="drive-column ui-column-enter space-y-4 overflow-y-auto p-4" aria-label="云盘文件详情">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">文件详情</h2>
            <Button onClick={() => setInspected(null)}>关闭</Button>
          </div>
          <FileIcon item={inspected.item} size={64} />
          <p className="break-all text-sm font-medium">{inspected.item.name}</p>
          <p className="text-xs text-text-3">{formatBytes(inspected.item.size ?? 0)}</p>
          <p className="break-all text-xs text-text-3">位置：/{inspected.parent.join('/')}</p>
          <Button onClick={() => onOpen(inspected)}>预览文件</Button>
          <p className="text-xs text-text-3">下载、复制、移动等操作可使用顶部工具栏。</p>
        </aside>
      )}
    </div>
  )
}
