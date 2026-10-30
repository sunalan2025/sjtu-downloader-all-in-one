import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { CloudConflict, CloudEntry, CloudOperationKind } from '@shared/cloud-drive'
import { formatBytes } from '@shared/utils'
import { useAppStore } from '../../store/app'
import { Button, EmptyState, Page, PageHeader, Toolbar } from '../../components/ui'
import { NetdiskViewModeSwitch, DropdownSelect, type DropdownOption } from '../../components/DownloadUI'
import { ColumnView, FileList, type FileSelection, type SelectFiles, type CloudContextMenu } from './FileViews'
import { ContextMenu, type MenuAction, type MenuPoint } from '../file-manager/ContextMenu'
import { copyFileText, matchesFile, type FileInfo, type FileKind } from '../file-manager/files'
import { PropertiesDialog } from '../file-manager/PropertiesDialog'
import { DirectoryFilter } from '../file-manager/DirectoryFilter'
import { useNavigationHistory } from '../file-manager/useNavigationHistory'
import { DestinationDialog } from './DestinationDialog'
import { PreviewDialog } from './PreviewDialog'
import { NameDialog, DeleteDialog, type NameTarget } from './MutationDialogs'
import { OperationResults } from './OperationResults'
import { TrashView } from './TrashView'
import { DirectoryCacheContext, useDirectory } from './useDirectory'
import { createDirectoryCache } from './directory-cache'
import { useOperations } from './useOperations'
import { sortItems, type SortKey } from './directory'

type Clipboard = { kind: CloudOperationKind; entries: CloudEntry[] }

const sortOptions: DropdownOption<SortKey>[] = [
  { value: 'name', label: '按名称' },
  { value: 'modified', label: '按修改时间' },
  { value: 'size', label: '按大小' }
]

export function CloudDrive() {
  const [cache] = useState(createDirectoryCache)
  return <DirectoryCacheContext.Provider value={cache}><CloudDriveContent /></DirectoryCacheContext.Provider>
}

function CloudDriveContent() {
  const localDestRoot = useAppStore(state => state.localDestRoot)
  const space = useAppStore(state => state.cloudSpaceInfo)
  const [path, setPath] = useState<string[]>([])
  const [revision, setRevision] = useState(0)
  const [mode, setMode] = useState<'list' | 'grid' | 'column'>(() => {
    try {
      const saved = localStorage.getItem('cloud-drive-view')
      return saved === 'grid' || saved === 'column' ? saved : 'list'
    } catch {
      return 'list'
    }
  })
  const [sort, setSort] = useState<SortKey>('name')
  const [descending, setDescending] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<FileKind>('all')
  const [properties, setProperties] = useState<FileInfo[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectionContext, setSelectionContext] = useState<{ path: string[]; items: import('@shared/types').CloudPanItem[] } | null>(null)
  const [clipboard, setClipboard] = useState<Clipboard | null>(null)
  const [destination, setDestination] = useState<Clipboard | null>(null)
  const [destinationPath, setDestinationPath] = useState<string[] | null>(null)
  const [menu, setMenu] = useState<{ point: MenuPoint; parent: string[]; files: FileSelection[]; sourceItems: import('@shared/types').CloudPanItem[] } | null>(null)
  const [nameTarget, setNameTarget] = useState<NameTarget | null>(null)
  const [deleteEntries, setDeleteEntries] = useState<CloudEntry[] | null>(null)
  const [preview, setPreview] = useState<FileSelection | null>(null)
  const [working, setWorking] = useState(false)
  const [inTrash, setInTrash] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const lock = useRef(false)
  const directory = useDirectory(path, revision)
  const refresh = useCallback(() => {
    setRevision(value => value + 1)
    setSelected(new Set())
    setSelectionContext(null)
  }, [])
  const operations = useOperations(refresh)
  const items = useMemo(() => sortItems(directory.items.filter(item => matchesFile({ name: item.name, directory: item.type === 'dir' }, query, kind)), '', sort, descending), [directory.items, sort, descending, query, kind])
  const selectionPath = selectionContext?.path ?? path
  const selection = (selectionContext?.items ?? directory.items).filter(item => selected.has(item.name))
  const entries: CloudEntry[] = selection.map(item => ({ path: [...selectionPath, item.name], type: item.type }))
  const blocked = working || operations.busy
  useEffect(() => {
    let cancelled = false
    void window.api.cloudpan
      .spaceInfo()
      .then(res => {
        if (!cancelled && res.ok && res.info) useAppStore.getState().setCloudSpaceInfo(res.info)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [revision])
  const navigate = (next: string[]) => {
    setMenu(null)
    setQuery('')
    setKind('all')
    setPath(next)
    setSelected(new Set())
    setSelectionContext(null)
    setPreview(null)
  }
  const history = useNavigationHistory(path, navigate)
  const filterChanged = () => { setSelected(new Set()); setSelectionContext(null); setMenu(null) }
  const fileInfo = (files: FileSelection[]): FileInfo[] => files.map(file => ({ name: file.item.name, path: `交大云盘:/${[...file.parent, file.item.name].join('/')}`, directory: file.item.type === 'dir', size: file.item.size, modified: file.item.modificationTime }))
  const open = (file: FileSelection) => (file.item.type === 'dir' ? navigate([...file.parent, file.item.name]) : setPreview(file))
  const selectAt: SelectFiles = (parent, sourceItems, next) => {
    setSelectionContext({ path: parent, items: sourceItems })
    setSelected(next)
  }
  const currentSelection = JSON.stringify(selectionPath) === JSON.stringify(path) ? selected : new Set<string>()
  const allSelected = !!items.length && items.every(item => currentSelection.has(item.name))
  const toggleAll = () => selectAt(path, items, allSelected ? new Set() : new Set(items.map(item => item.name)))
  const copy = (kind: CloudOperationKind) => {
    if (entries.length) {
      setClipboard({ kind, entries })
      setNotice({ text: `已${kind === 'copy' ? '复制' : '剪切'} ${entries.length} 个项目。进入目标文件夹后粘贴。` })
    }
  }
  async function run(action: () => Promise<void>) {
    if (lock.current || operations.busy) return
    lock.current = true
    setWorking(true)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      setNotice({ error: true, text: err instanceof Error ? err.message : '操作失败' })
    } finally {
      lock.current = false
      setWorking(false)
    }
  }
  const download = (targets: CloudEntry[]) =>
    void run(async () => {
      const res = await window.api.cloudpan.downloadEntries(targets, localDestRoot || undefined)
      if (!res.ok) throw new Error([`已加入 ${res.count ?? 0} 个下载任务`, res.error, ...(res.errors || [])].filter(Boolean).join('；'))
      setNotice({ text: `已将 ${res.count ?? 0} 个文件加入传输中心，文件夹层级会保留。` })
    })
  const upload = (folder: boolean, target = path) =>
    void run(async () => {
      const res = await window.api.cloudpan.uploadFiles(target, folder)
      if (!res.ok) throw new Error(res.error || '上传失败')
      setNotice({ text: `已提交 ${res.count ?? 0} 个文件上传。同名文件保留原件；传输完成后刷新目录查看。` })
      refresh()
    })
  const rename = () => {
    if (selection.length === 1)
      setNameTarget({ path: [...selectionPath, selection[0].name], name: selection[0].name, type: selection[0].type, create: false })
  }
  const web = (remote: string[]) =>
    void run(async () => {
      const res = await window.api.cloudpan.openInBrowser(remote)
      if (!res.ok) throw new Error(res.error || '无法打开网页端')
    })
  const confirmOperation = async (target: string[], conflict: CloudConflict) => {
    if (!destination) return
    if (await operations.submit({ ...destination, destination: target, conflict })) {
      if (destination.kind === 'move') setClipboard(null)
      setDestination(null)
      setDestinationPath(null)
    }
  }
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!blocked) history.onKeyDown(event)
    if (event.defaultPrevented) return
    // Checkboxes keep focus after selecting a file; file shortcuts must still work there.
    // Preserve native editing shortcuts only in text fields and modal dialogs.
    if (
      (event.target as HTMLElement).closest(
        'input:not([type="checkbox"]):not([type="radio"]),textarea,select,dialog,[contenteditable]:not([contenteditable="false"])'
      ) ||
      blocked
    )
      return
    const modifier = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    if (modifier && ['a', 'c', 'x', 'v'].includes(key)) {
      event.preventDefault()
      if (key === 'a') selectAt(path, items, new Set(items.map(item => item.name)))
      if (key === 'c') copy('copy')
      if (key === 'x') copy('move')
      if (key === 'v' && clipboard) setDestination(clipboard)
    } else if (key === 'escape' && entries.length) {
      event.preventDefault()
      setSelected(new Set())
      setSelectionContext(null)
    } else if (key === 'f2' && entries.length === 1) {
      event.preventDefault()
      rename()
    } else if (key === 'delete' && entries.length) {
      event.preventDefault()
      setDeleteEntries(entries)
    }
  }
  const used = Number(space?.size) || 0
  const capacity = Number(space?.capacity) || 0
  const contextMenu: CloudContextMenu = (parent, sourceItems, request) => {
    if (blocked) return
    setMenu({ point: { x: request.x, y: request.y }, parent, sourceItems,
      files: sourceItems.filter(item => request.selectedIds.includes(item.name)).map(item => ({ parent, item })) })
  }
  const menuActions: MenuAction[] = []
  if (menu) {
    const targets: CloudEntry[] = menu.files.map(file => ({ path: [...file.parent, file.item.name], type: file.item.type }))
    const single = menu.files.length === 1 ? menu.files[0] : undefined
    const chooseDestination = (value: Clipboard) => { setDestinationPath(menu.parent); setDestination(value) }
    if (single) menuActions.push({ id: 'open', label: single.item.type === 'dir' ? '打开文件夹' : '预览 / 详情', shortcut: 'Enter', run: () => open(single) })
    if (targets.length) {
      menuActions.push(
        { id: 'download', label: `下载${targets.length > 1 ? ` ${targets.length} 项` : ''}`, run: () => download(targets) },
        { id: 'copy', label: '复制', shortcut: 'Ctrl/Cmd+C', divider: true, run: () => { setClipboard({ kind: 'copy', entries: targets }); setNotice({ text: `已复制 ${targets.length} 项` }) } },
        { id: 'cut', label: '剪切', shortcut: 'Ctrl/Cmd+X', run: () => { setClipboard({ kind: 'move', entries: targets }); setNotice({ text: `已剪切 ${targets.length} 项` }) } },
        { id: 'copy-to', label: '复制到…', run: () => chooseDestination({ kind: 'copy', entries: targets }) },
        { id: 'move-to', label: '移动到…', run: () => chooseDestination({ kind: 'move', entries: targets }) }
      )
      if (single) menuActions.push({ id: 'rename', label: '重命名', shortcut: 'F2', run: () => setNameTarget({ path: targets[0].path, name: single.item.name, type: single.item.type, create: false }) })
      menuActions.push({ id: 'delete', label: `删除${targets.length > 1 ? ` ${targets.length} 项` : ''}…`, shortcut: 'Delete', danger: true, divider: true, run: () => setDeleteEntries(targets) })
      menuActions.push(
        { id: 'copy-name', label: '复制名称', divider: true, run: () => void run(async () => { await copyFileText(menu.files.map(file => file.item.name).join('\n')); setNotice({ text: '已复制名称' }) }) },
        { id: 'copy-path', label: '复制目录路径', run: () => void run(async () => { await copyFileText(fileInfo(menu.files).map(file => file.path).join('\n')); setNotice({ text: '已复制云盘路径' }) }) },
        { id: 'properties', label: '属性', run: () => setProperties(fileInfo(menu.files)) }
      )
    } else {
      menuActions.push(
        { id: 'new-folder', label: '新建文件夹…', run: () => setNameTarget({ path: menu.parent, name: '', type: 'dir', create: true }) },
        { id: 'upload', label: '上传文件…', run: () => upload(false, menu.parent) },
        { id: 'upload-folder', label: '上传文件夹…', run: () => upload(true, menu.parent) },
        { id: 'paste', label: '粘贴到此文件夹…', shortcut: 'Ctrl/Cmd+V', disabled: !clipboard, divider: true, run: () => { if (clipboard) chooseDestination(clipboard) } },
        { id: 'select-all', label: '全选', shortcut: 'Ctrl/Cmd+A', disabled: !menu.sourceItems.length, run: () => selectAt(menu.parent, menu.sourceItems, new Set(menu.sourceItems.map(item => item.name))) },
        { id: 'refresh', label: '刷新', divider: true, run: refresh }
      )
    }
  }

  if (inTrash) {
    return (
      <TrashView
        onBack={() => {
          setInTrash(false)
          refresh()
        }}
        onChanged={message => {
          setNotice({ text: message })
          refresh()
        }}
      />
    )
  }

  return (
    <Page tabIndex={0} onKeyDown={onKey}>
      <PageHeader
        title="交大云盘"
        description={capacity ? `已用 ${formatBytes(used)} / ${formatBytes(capacity)} · 个人空间` : '管理文件、文件夹与云端副本'}
        actions={
          <>
            {clipboard && !entries.length && (
              <Button
                variant="primary"
                disabled={blocked}
                onClick={() => setDestination(clipboard)}
                title="粘贴到当前文件夹 (Ctrl/Cmd+V)"
                className="animate-fadeIn shadow-glow-sm"
              >
                📋 粘贴 ({clipboard.entries.length} 项)
              </Button>
            )}
            <Button disabled={blocked} onClick={() => setNameTarget({ path, name: '', type: 'dir', create: true })}>
              ＋ 新建文件夹
            </Button>
            <Button variant="primary" disabled={blocked} onClick={() => upload(false)}>
              上传文件
            </Button>
            <Button disabled={blocked} onClick={() => upload(true)}>
              上传文件夹
            </Button>
            <Button disabled={blocked} onClick={() => web(path)}>
              网页端
            </Button>
            <Button disabled={blocked} onClick={() => setInTrash(true)}>
              回收站
            </Button>
          </>
        }
      />
      <Toolbar className="justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <nav aria-label="云盘路径" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-xs select-none">
            <button className="shrink-0 rounded p-1.5 text-text-2 hover:bg-surface-2 transition-colors" onClick={() => navigate([])}>
              个人根目录
            </button>
            {path.map((part, index) => (
              <span key={index} className="flex min-w-0 shrink-0 items-center gap-1">
                <span className="text-text-4">/</span>
                <button
                  className="max-w-48 truncate rounded p-1.5 text-text-2 hover:bg-surface-2 transition-colors"
                  title={part}
                  onClick={() => navigate(path.slice(0, index + 1))}
                >
                  {part}
                </button>
              </span>
            ))}
          </nav>
        </div>

        <div className="ml-3 flex shrink-0 items-center gap-2">
          <DropdownSelect<SortKey>
            value={sort}
            onChange={setSort}
            options={sortOptions}
            title="排序字段"
          />
          <Button onClick={() => setDescending(v => !v)} title="切换排序方向">
            {descending ? '降序 ↓' : '升序 ↑'}
          </Button>
          <NetdiskViewModeSwitch
            mode={mode}
            onChange={next => {
              setMode(next)
              try {
                localStorage.setItem('cloud-drive-view', next)
              } catch {
                /* Optional preference. */
              }
            }}
          />
        </div>
      </Toolbar>
      <Toolbar className="justify-between">
        <DirectoryFilter query={query} kind={kind} onQuery={value => { filterChanged(); setQuery(value) }} onKind={value => { filterChanged(); setKind(value) }} />
        <div className="flex items-center gap-3 text-xs text-text-3"><span>{items.length} / {directory.items.length} 项</span><Button disabled={blocked} onClick={refresh}>刷新</Button></div>
      </Toolbar>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-in-out ${
          entries.length > 0 ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
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
                  disabled={!items.length}
                  onChange={toggleAll}
                />
                全选
              </label>

              <Button disabled={blocked || !entries.length} onClick={() => copy('copy')} title="Ctrl/Cmd+C">
                复制
              </Button>
              <Button disabled={blocked || !entries.length} onClick={() => copy('move')} title="Ctrl/Cmd+X">
                剪切
              </Button>
              {clipboard && (
                <Button disabled={blocked} onClick={() => setDestination(clipboard)} title="Ctrl/Cmd+V">
                  粘贴 ({clipboard.entries.length})
                </Button>
              )}
              <Button disabled={blocked || !entries.length} onClick={() => setDestination({ kind: 'copy', entries })}>
                复制到…
              </Button>
              <Button disabled={blocked || !entries.length} onClick={() => setDestination({ kind: 'move', entries })}>
                移动到…
              </Button>
              <Button
                disabled={blocked || entries.length !== 1}
                onClick={rename}
                title={entries.length > 1 ? '仅支持单个文件重命名' : '重命名文件 (F2)'}
              >
                重命名
              </Button>
              <Button disabled={blocked || !entries.length} onClick={() => download(entries)}>
                下载
              </Button>
              <Button disabled={!entries.length} onClick={() => setProperties(fileInfo(selection.map(item => ({ item, parent: selectionPath }))))}>属性</Button>
              <Button variant="danger" disabled={blocked || !entries.length} onClick={() => setDeleteEntries(entries)} title="删除已选文件 (Delete)">
                删除
              </Button>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                onClick={() => {
                  setSelected(new Set())
                  setSelectionContext(null)
                }}
                title="取消选择 (Esc)"
                className="text-text-3 hover:text-text-1"
              >
                ✕ 取消选择
              </Button>
            </div>
          </Toolbar>
        </div>
      </div>
      {(notice || operations.error) && (
        <div
          className={`mx-4 mt-3 flex shrink-0 items-start gap-3 rounded-lg border border-bd p-3 text-xs ${notice?.error || operations.error ? 'bg-danger-bg text-danger' : 'bg-surface-2 text-text-2'}`}
          role={notice?.error || operations.error ? 'alert' : 'status'}
        >
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{operations.error || notice?.text}</p>
          {operations.error ? (
            <Button onClick={operations.resume}>重新查询</Button>
          ) : (
            <button aria-label="关闭提示" onClick={() => setNotice(null)}>
              ✕
            </button>
          )}
        </div>
      )}
      <OperationResults results={operations.results} onClear={operations.clear} />
      {mode === 'column' ? (
        <ColumnView path={path} revision={revision} items={items} selected={selected} selectionPath={selectionPath}
          onSelectionChange={selectAt} onOpen={open} onRetry={refresh} onNavigate={navigate} disabled={blocked} onContextMenu={contextMenu} />
      ) : directory.loading ? (
        <EmptyState title="正在读取文件夹…" />
      ) : directory.error ? (
        <EmptyState title="读取失败">
          <p className="mb-3 break-all text-danger">{directory.error}</p>
          <Button onClick={refresh}>重新加载</Button>
        </EmptyState>
      ) : (
        <FileList items={items} path={path} selected={currentSelection} onSelectionChange={selectAt} onOpen={open} grid={mode === 'grid'} disabled={blocked} onContextMenu={contextMenu} />
      )}
      <footer className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-bd px-5 py-2 text-xs text-text-3">
        <span>{blocked ? '正在处理，请稍候…' : 'Ctrl/Cmd+C、X、V、A · F2 重命名 · Delete 删除'}</span>
        <span>文件夹优先 · 搜索范围为当前目录</span>
      </footer>
      {destination && (
        <DestinationDialog
          kind={destination.kind}
          entries={destination.entries}
          initialPath={destinationPath ?? path}
          busy={operations.busy}
          error={operations.error}
          onClose={() => { setDestination(null); setDestinationPath(null) }}
          onConfirm={(target, conflict) => {
            void confirmOperation(target, conflict)
          }}
        />
      )}
      {nameTarget && <NameDialog target={nameTarget} onClose={() => setNameTarget(null)} onDone={refresh} />}
      {menu && <ContextMenu point={menu.point} actions={menuActions} onClose={() => setMenu(null)} />}
      {properties && <PropertiesDialog files={properties} onClose={() => setProperties(null)} />}
      {deleteEntries && (
        <DeleteDialog
          entries={deleteEntries}
          onClose={() => setDeleteEntries(null)}
          onDone={(text, error) => {
            refresh()
            setNotice({ text, error })
          }}
        />
      )}
      {preview && (
        <PreviewDialog
          key={JSON.stringify([...preview.parent, preview.item.name])}
          file={preview}
          onClose={() => setPreview(null)}
          onDownload={() => {
            download([{ path: [...preview.parent, preview.item.name], type: 'file' }])
            setPreview(null)
          }}
          onWeb={() => {
            web([...preview.parent, preview.item.name])
            setPreview(null)
          }}
        />
      )}
    </Page>
  )
}
