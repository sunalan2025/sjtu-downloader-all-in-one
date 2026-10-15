import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/app'
import { BreadcrumbBar, type BreadcrumbItem } from '../components/BreadcrumbBar'
import {
  NetdiskViewModeSwitch,
  TriCheckbox,
  type TriState,
  MacOSFolderIcon,
  MacOSDocumentIcon,
  MacOSCircleCheckbox
} from '../components/DownloadUI'
import { Spinner } from '../components/Spinner'
import { formatBytes, buildAncestorPathChain } from '@shared/utils'
import type { CloudPanItem } from '@shared/types'

interface CloudPanExplorerProps {
  onBack?: () => void
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return dateStr
  }
}

function getFileIcon(item: CloudPanItem, isLarge = false) {
  const sizeClass = isLarge ? 'h-14 w-14 text-3xl' : 'h-10 w-10 text-xl'
  if (item.type === 'dir') {
    return (
      <div className={`flex shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 ${sizeClass}`}>
        📁
      </div>
    )
  }
  const ext = item.name.split('.').pop()?.toLowerCase() || ''
  if (ext === 'pdf') {
    return (
      <div className={`flex shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-500 font-bold ${sizeClass}`}>
        📄
      </div>
    )
  }
  if (['doc', 'docx'].includes(ext)) {
    return (
      <div className={`flex shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500 ${sizeClass}`}>
        📝
      </div>
    )
  }
  if (['xls', 'xlsx', 'csv'].includes(ext)) {
    return (
      <div className={`flex shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500 ${sizeClass}`}>
        📊
      </div>
    )
  }
  if (['ppt', 'pptx'].includes(ext)) {
    return (
      <div className={`flex shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500 ${sizeClass}`}>
        📑
      </div>
    )
  }
  if (['mp4', 'mkv', 'avi', 'mov', 'flv', 'ts'].includes(ext)) {
    return (
      <div className={`flex shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-500 ${sizeClass}`}>
        🎬
      </div>
    )
  }
  if (['mp3', 'wav', 'm4a', 'flac', 'aac'].includes(ext)) {
    return (
      <div className={`flex shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-500 ${sizeClass}`}>
        🎵
      </div>
    )
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return (
      <div className={`flex shrink-0 items-center justify-center rounded-xl bg-amber-600/10 text-amber-600 ${sizeClass}`}>
        📦
      </div>
    )
  }
  if (['txt', 'md', 'json', 'js', 'ts', 'py', 'c', 'cpp', 'java', 'html', 'css'].includes(ext)) {
    return (
      <div className={`flex shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500 ${sizeClass}`}>
        📜
      </div>
    )
  }
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-xl bg-slate-500/10 text-slate-500 ${sizeClass}`}>
      📄
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// CloudPanMillerColumns (macOS Miller Columns / 专业网盘分栏视图)
// ─────────────────────────────────────────────────────────────

interface CloudPanMillerColumnsProps {
  initialItems: CloudPanItem[]
  currentPath: string[]
  onPathChange: (path: string[]) => void
  selectedNames: Set<string>
  onToggleSelect: (name: string) => void
  onDownloadSingle: (item: CloudPanItem) => void
  onRename: (item: CloudPanItem) => void
  onDelete: (item: CloudPanItem) => void
  onOpenWeb: (item: CloudPanItem) => void
}

interface ColumnData {
  path: string[]
  name: string
  items: CloudPanItem[]
  selectedName: string | null
  loading?: boolean
}

function CloudPanMillerColumns({
  initialItems,
  currentPath,
  onPathChange,
  selectedNames,
  onToggleSelect,
  onDownloadSingle,
  onRename,
  onDelete,
  onOpenWeb
}: CloudPanMillerColumnsProps) {
  const [columns, setColumns] = useState<ColumnData[]>([
    { path: [], name: '根目录', items: initialItems, selectedName: null }
  ])
  const [previewFile, setPreviewFile] = useState<{ item: CloudPanItem; dirPath: string[] } | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isLoadingUrl, setIsLoadingUrl] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const dirCacheRef = useRef<Map<string, CloudPanItem[]>>(new Map())
  const lastNavigatedPathRef = useRef<string | null>(null)

  // 缓存与更新根目录初始项目
  useEffect(() => {
    if (initialItems.length > 0) {
      dirCacheRef.current.set('', initialItems)
    }
  }, [initialItems])

  const scrollToRight = useCallback(() => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (containerRef.current) {
          containerRef.current.scrollTo({
            left: containerRef.current.scrollWidth,
            behavior: 'smooth'
          })
        }
      }, 60)
    })
  }, [])

  const fetchDir = useCallback(async (path: string[], bypassCache = false): Promise<CloudPanItem[]> => {
    const key = path.join('/')
    if (!bypassCache && dirCacheRef.current.has(key)) {
      return dirCacheRef.current.get(key)!
    }
    try {
      const res = await window.api.cloudpan.listDirectory(path)
      const list = res.ok && res.data ? res.data.contents || [] : []
      dirCacheRef.current.set(key, list)
      return list
    } catch {
      return []
    }
  }, [])

  const resolvePreviewUrl = useCallback(async (dirPath: string[], item: CloudPanItem) => {
    setPreviewFile({ item, dirPath })
    setPreviewUrl(null)
    const ext = item.name.split('.').pop()?.toLowerCase() || ''
    const isMedia = ['mp4', 'mkv', 'mov', 'flv', 'ts', 'mp3', 'm4a', 'wav', 'aac', 'flac', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)
    if (isMedia) {
      setIsLoadingUrl(true)
      try {
        const urlRes = await window.api.cloudpan.getDownloadUrl([...dirPath, item.name])
        if (urlRes.ok && urlRes.url) {
          setPreviewUrl(urlRes.url)
        }
      } catch {
        // ignore
      } finally {
        setIsLoadingUrl(false)
      }
    }
  }, [])

  // 单击条目逻辑（严格单层步进：点击文件夹仅展开其下一层，不自动预选任何子项目）
  const handleItemClick = useCallback(async (colIndex: number, item: CloudPanItem) => {
    const col = columns[colIndex]
    if (!col) return

    if (item.type === 'file') {
      const truncated = columns.slice(0, colIndex + 1).map((c, idx) =>
        idx === colIndex ? { ...c, selectedName: item.name } : c
      )
      setColumns(truncated)
      void resolvePreviewUrl(col.path, item)
      scrollToRight()
      return
    }

    // 文件夹：清除右侧已打开的预览与后序多余列，仅加载下一列
    setPreviewFile(null)
    setPreviewUrl(null)

    const nextPath = [...col.path, item.name]
    const truncated = columns.slice(0, colIndex + 1).map((c, idx) =>
      idx === colIndex ? { ...c, selectedName: item.name } : c
    )

    setColumns([...truncated, { path: nextPath, name: item.name, items: [], selectedName: null, loading: true }])
    scrollToRight()

    const list = await fetchDir(nextPath)
    setColumns([...truncated, {
      path: nextPath,
      name: item.name,
      items: list,
      selectedName: null,
      loading: false
    }])
    lastNavigatedPathRef.current = nextPath.join('/')
    onPathChange(nextPath)
    scrollToRight()
  }, [columns, fetchDir, onPathChange, resolvePreviewUrl, scrollToRight])

  // 首次打开或外部路径同步（严格单层步进：首次打开根目录绝不自动预展开任何子目录）
  useEffect(() => {
    const currentPathStr = currentPath.join('/')
    if (lastNavigatedPathRef.current === currentPathStr) {
      return
    }
    lastNavigatedPathRef.current = currentPathStr

    let isCancelled = false

    const hydrate = async () => {
      // 首次打开或回到根目录：仅展示根目录单列，selectedName 为 null
      if (currentPath.length === 0) {
        const rootItems = initialItems.length > 0 ? initialItems : await fetchDir([])
        if (isCancelled) return
        setColumns([
          { path: [], name: '根目录', items: rootItems, selectedName: null }
        ])
        setPreviewFile(null)
        setPreviewUrl(null)
        return
      }

      // 外部传入已有路径：水合整条路径各祖先列（不自动预选最后一列的任何子项）
      const ancestorChain = buildAncestorPathChain(currentPath)
      const newCols: ColumnData[] = []
      for (const node of ancestorChain) {
        const items = await fetchDir(node.path)
        if (isCancelled) return
        newCols.push({
          path: node.path,
          name: node.name,
          items,
          selectedName: node.selectedName
        })
      }

      setColumns(newCols)
      setPreviewFile(null)
      setPreviewUrl(null)
      scrollToRight()
    }

    void hydrate()

    return () => {
      isCancelled = true
    }
  }, [currentPath, fetchDir, initialItems, scrollToRight])

  // 刷新所有已展开列
  const handleRefreshColumns = useCallback(async () => {
    dirCacheRef.current.clear()
    const updated = await Promise.all(
      columns.map(async col => {
        const items = await fetchDir(col.path, true)
        return { ...col, items }
      })
    )
    setColumns(updated)
  }, [columns, fetchDir])

  // 列内文件批量勾选
  const handleToggleColumnFiles = useCallback((colIdx: number) => {
    const col = columns[colIdx]
    if (!col) return
    const fileItems = col.items.filter(i => i.type === 'file')
    if (fileItems.length === 0) return
    const allChecked = fileItems.every(i => selectedNames.has(i.name))
    fileItems.forEach(i => {
      if (allChecked && selectedNames.has(i.name)) {
        onToggleSelect(i.name)
      } else if (!allChecked && !selectedNames.has(i.name)) {
        onToggleSelect(i.name)
      }
    })
  }, [columns, onToggleSelect, selectedNames])

  return (
    <div className="flex h-full w-full flex-col rounded-2xl border border-bd bg-surface-1 shadow-card select-none overflow-hidden">
      {/* 顶部分栏全局控制栏 (Miller Columns Global Bar) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bd/60 bg-surface-2/60 px-4 py-2 text-xs select-none shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text-2 flex items-center gap-1.5">
            <span>📊</span>
            <span>分栏多级目录</span>
            <span className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-2xs text-text-3">
              {columns.length} 级列
            </span>
          </span>
          <div className="h-3 w-px bg-bd/60 hidden sm:block" />
          <span className="text-2xs text-text-4 font-mono truncate max-w-xs hidden sm:inline" title={`/${columns.map(c => c.name).filter(Boolean).join('/')}`}>
            /{columns.map(c => c.name).filter(Boolean).join('/')}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* 收起一列 */}
          {columns.length > 1 && (
            <button
              type="button"
              onClick={() => {
                setColumns(prev => prev.slice(0, prev.length - 1))
                setPreviewFile(null)
              }}
              className="inline-flex items-center gap-1 rounded-xl border border-bd bg-surface-1 px-2.5 py-1 text-2xs font-medium text-text-3 hover:text-text-1 hover:bg-surface-2 transition-all cursor-pointer"
              title="收起最右侧的一列分栏"
            >
              <span>📁 收起一列</span>
            </button>
          )}

          {/* 刷新分栏 */}
          <button
            type="button"
            onClick={() => void handleRefreshColumns()}
            className="inline-flex items-center gap-1 rounded-xl border border-bd bg-surface-1 px-2.5 py-1 text-2xs font-medium text-text-3 hover:text-text-1 hover:bg-surface-2 transition-all cursor-pointer"
            title="重新刷新当前已展开的所有分栏内容"
          >
            <span>↻ 刷新</span>
          </button>
        </div>
      </div>

      {/* 横向平铺多级分栏主体 */}
      <div
        ref={containerRef}
        className="flex flex-1 w-full flex-row overflow-x-auto divide-x divide-bd/60 scroll-smooth"
      >
        {columns.map((col, colIdx) => (
          <div key={`${col.path.join('/') || 'root'}-${colIdx}`} className="flex w-64 md:w-72 shrink-0 flex-col bg-surface-1/40 h-full">
            {/* 每列顶栏：显示该层名称与项目计数 */}
            <div className="flex h-10 items-center justify-between border-b border-bd/60 bg-surface-2/40 px-3.5 text-xs font-semibold text-text-2 select-none shrink-0">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span>{col.path.length === 0 ? '🏠' : '📁'}</span>
                <span className="truncate font-semibold" title={col.name}>{col.name}</span>
                <span className="text-2xs font-mono text-text-4 shrink-0">({col.items.length})</span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleToggleColumnFiles(colIdx)
                }}
                title="全选/取消本列文件"
                className="rounded-lg px-1.5 py-0.5 text-2xs text-text-3 hover:bg-surface-3 hover:text-text-1 transition-colors cursor-pointer"
              >
                ✓
              </button>
            </div>

            {/* 列内容流 */}
            <div className="flex-1 overflow-y-auto py-2">
              {col.loading ? (
                <div className="flex h-32 flex-col items-center justify-center gap-2 text-text-4 text-xs">
                  <Spinner size={16} />
                  <span>加载中…</span>
                </div>
              ) : col.items.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center text-text-4 text-xs">
                  <span className="text-xl mb-1 opacity-50">📂</span>
                  <span>空文件夹</span>
                </div>
              ) : (
                col.items.map(item => {
                  const isActive = col.selectedName === item.name
                  const isChecked = selectedNames.has(item.name)
                  return (
                    <div
                      key={item.name}
                      onClick={() => void handleItemClick(colIdx, item)}
                      className={`group flex items-center justify-between px-3 py-2 transition-all cursor-pointer mx-2 my-0.5 rounded-xl ${
                        isActive
                          ? 'bg-accent/10 text-accent font-semibold shadow-2xs'
                          : 'text-text-1 hover:bg-surface-2/70'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span
                          role="checkbox"
                          aria-checked={isChecked}
                          tabIndex={0}
                          onClick={e => {
                            e.stopPropagation()
                            onToggleSelect(item.name)
                          }}
                          className="cursor-pointer shrink-0 opacity-80 group-hover:opacity-100 transition-opacity"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="h-3.5 w-3.5 rounded border-bd text-accent focus:ring-accent cursor-pointer accent-accent"
                          />
                        </span>
                        <span className="shrink-0 text-base flex items-center justify-center w-5">
                          {item.type === 'dir' ? (
                            <span className="text-amber-500">📁</span>
                          ) : (
                            getFileIcon(item, false)
                          )}
                        </span>
                        <span className="truncate text-xs min-w-0 flex-1" title={item.name}>
                          {item.name}
                        </span>
                      </div>
                      {item.type === 'dir' ? (
                        <span className={`shrink-0 ml-1.5 text-xs font-mono transition-transform ${
                          isActive ? 'text-accent font-bold translate-x-0.5' : 'text-text-4 group-hover:text-text-3'
                        }`}>
                          ›
                        </span>
                      ) : (
                        <span className="shrink-0 text-2xs text-text-4 font-mono ml-1.5">
                          {item.size ? formatBytes(item.size) : ''}
                        </span>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        ))}

        {/* 最右侧：文件大预览与元数据卡片 (Preview Column) */}
        {previewFile && (
          <div className="flex w-80 md:w-96 shrink-0 flex-col bg-surface-1 p-5 overflow-y-auto border-l border-bd/60 select-none">
            <div className="flex items-center justify-between pb-3 border-b border-bd/60">
              <span className="text-xs font-bold text-text-2">文件详情与预览</span>
              <button
                type="button"
                onClick={() => { setPreviewFile(null); setPreviewUrl(null); }}
                className="text-text-4 hover:text-text-1 text-xs p-1 rounded-md hover:bg-surface-3 transition-colors cursor-pointer"
                title="关闭预览面板"
              >
                ✕
              </button>
            </div>

            <div className="my-4">
              {(() => {
                const ext = previewFile.item.name.split('.').pop()?.toLowerCase() || ''
                const isVideo = ['mp4', 'mkv', 'mov', 'flv', 'ts'].includes(ext)
                const isAudio = ['mp3', 'm4a', 'wav', 'aac', 'flac'].includes(ext)
                const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)

                if (isVideo) {
                  return (
                    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black flex items-center justify-center shadow-md">
                      {previewUrl ? (
                        <video
                          key={previewUrl}
                          controls
                          playsInline
                          src={previewUrl}
                          className="w-full h-full object-contain"
                        />
                      ) : isLoadingUrl ? (
                        <div className="flex flex-col items-center gap-2 text-text-3 text-xs">
                          <Spinner size={16} />
                          <span>正在解析播放流…</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center text-white/80 gap-2">
                          <span className="text-3xl">🎬</span>
                          <span className="text-2xs text-text-4">视频文件</span>
                        </div>
                      )}
                    </div>
                  )
                }

                if (isAudio) {
                  return (
                    <div className="w-full rounded-xl bg-surface-2 p-4 flex flex-col items-center border border-bd/60 shadow-xs">
                      <div className="h-16 w-16 rounded-2xl bg-cyan-500/10 text-cyan-500 flex items-center justify-center text-3xl mb-3 shadow-inner">
                        🎵
                      </div>
                      {previewUrl ? (
                        <audio
                          key={previewUrl}
                          controls
                          src={previewUrl}
                          className="w-full mt-1"
                        />
                      ) : isLoadingUrl ? (
                        <div className="flex items-center gap-2 text-xs text-text-3 py-2">
                          <Spinner size={14} />
                          <span>加载音频中…</span>
                        </div>
                      ) : null}
                    </div>
                  )
                }

                if (isImage && previewUrl) {
                  return (
                    <div className="w-full rounded-xl overflow-hidden bg-surface-2 border border-bd/60 flex items-center justify-center max-h-56">
                      <img src={previewUrl} alt={previewFile.item.name} className="max-h-56 object-contain" />
                    </div>
                  )
                }

                return (
                  <div className="flex justify-center py-4">
                    <div className="p-5 rounded-2xl bg-surface-2 border border-bd/60 shadow-inner">
                      {getFileIcon(previewFile.item, true)}
                    </div>
                  </div>
                )
              })()}
            </div>

            <h3 className="text-sm font-bold text-text-1 break-all select-text leading-snug mb-3" title={previewFile.item.name}>
              {previewFile.item.name}
            </h3>

            <div className="w-full rounded-xl border border-bd/80 bg-surface-2/60 p-3.5 text-left text-xs divide-y divide-bd/40 space-y-2 mb-4">
              <div className="flex justify-between py-1">
                <span className="text-text-3">类型</span>
                <span className="font-mono text-text-1 uppercase">
                  {previewFile.item.name.split('.').pop() || '文件'}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-text-3">大小</span>
                <span className="font-mono font-bold text-accent">
                  {formatBytes(previewFile.item.size || 0)}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-text-3">修改时间</span>
                <span className="font-mono text-text-2 text-2xs">
                  {formatDate(previewFile.item.modificationTime)}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-text-3">云端路径</span>
                <span className="font-mono text-2xs text-text-3 truncate max-w-[180px]" title={`/${[...previewFile.dirPath, previewFile.item.name].join('/')}`}>
                  /{[...previewFile.dirPath, previewFile.item.name].join('/')}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 mt-auto">
              <button
                type="button"
                onClick={() => void onDownloadSingle(previewFile.item)}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-white shadow-glow-sm hover:bg-accent-light active:scale-[0.98] transition-all cursor-pointer"
              >
                <span>📥 立即下载到本地</span>
              </button>

              <div className="grid grid-cols-3 gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => onRename(previewFile.item)}
                  className="flex items-center justify-center gap-1 rounded-xl border border-bd bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-text-2 hover:bg-surface-3 hover:text-text-1 transition-colors cursor-pointer"
                >
                  <span>✏️ 重命名</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(previewFile.item)}
                  className="flex items-center justify-center gap-1 rounded-xl border border-bd bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-warning hover:bg-warning/10 transition-colors cursor-pointer"
                >
                  <span>🗑️ 删除</span>
                </button>
                <button
                  type="button"
                  onClick={() => void onOpenWeb(previewFile.item)}
                  className="flex items-center justify-center gap-1 rounded-xl border border-bd bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-text-2 hover:bg-surface-3 hover:text-text-1 transition-colors cursor-pointer"
                >
                  <span>🌐 网页端</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function CloudPanExplorer({ onBack: _onBack }: CloudPanExplorerProps = {}) {
  const cloudSpaceInfo = useAppStore(s => s.cloudSpaceInfo)
  const setCloudSpaceInfo = useAppStore(s => s.setCloudSpaceInfo)
  const localDestRoot = useAppStore(s => s.localDestRoot)
  const courseViewMode = useAppStore(s => s.courseViewMode)
  const setCourseViewMode = useAppStore(s => s.setCourseViewMode)

  const [currentPath, setCurrentPath] = useState<string[]>([])
  const [contents, setContents] = useState<CloudPanItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set())
  const [cloudPanBatchMenuOpen, setCloudPanBatchMenuOpen] = useState(false)
  const cloudPanBatchMenuRef = useRef<HTMLDivElement>(null)
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (!cloudPanBatchMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (cloudPanBatchMenuRef.current && !cloudPanBatchMenuRef.current.contains(e.target as Node)) {
        setCloudPanBatchMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCloudPanBatchMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [cloudPanBatchMenuOpen])

  // 模态弹窗状态
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)

  const [renameTarget, setRenameTarget] = useState<CloudPanItem | null>(null)
  const [renameNewName, setRenameNewName] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)

  const [deleteTargets, setDeleteTargets] = useState<CloudPanItem[] | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // 弹窗提示通知
  const showToast = useCallback((text: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToastMsg({ text, type })
  }, [])

  useEffect(() => {
    if (!toastMsg) return
    const timer = setTimeout(() => setToastMsg(null), 3500)
    return () => clearTimeout(timer)
  }, [toastMsg])

  // 配额容量计算
  const quota = useMemo(() => {
    if (!cloudSpaceInfo) return null
    const sizeNum = typeof cloudSpaceInfo.size === 'number'
      ? cloudSpaceInfo.size
      : parseFloat(String(cloudSpaceInfo.size)) || 0
    const capNum = typeof cloudSpaceInfo.capacity === 'number'
      ? cloudSpaceInfo.capacity
      : parseFloat(String(cloudSpaceInfo.capacity)) || 0
    const pct = capNum > 0 ? Math.min(100, Math.round((sizeNum / capNum) * 100)) : 0
    return {
      usedStr: formatBytes(sizeNum),
      totalStr: formatBytes(capNum),
      pct
    }
  }, [cloudSpaceInfo])

  // 刷新配额
  const refreshSpaceInfo = useCallback(async () => {
    try {
      const res = await window.api.cloudpan.spaceInfo()
      if (res.ok && res.info) {
        setCloudSpaceInfo(res.info)
      }
    } catch {
      // ignore
    }
  }, [setCloudSpaceInfo])

  // 导航防连击与防误触互斥锁
  const lastNavTimeRef = useRef<number>(0)
  const isNavigatingRef = useRef<boolean>(false)

  // 拉取目录内容
  const fetchDirectory = useCallback(async (path: string[]) => {
    setLoading(true)
    setError(null)
    setSelectedNames(new Set())
    try {
      const res = await window.api.cloudpan.listDirectory(path)
      if (res.ok && res.data) {
        setContents(res.data.contents || [])
      } else {
        setError(res.error || '获取目录内容失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络或通信异常')
    } finally {
      setLoading(false)
      // 释放导航跃迁互斥锁
      setTimeout(() => {
        isNavigatingRef.current = false
      }, 120)
    }
  }, [])

  useEffect(() => {
    void fetchDirectory(currentPath)
    void refreshSpaceInfo()
  }, [currentPath, fetchDirectory, refreshSpaceInfo])

  // 排序与过滤：文件夹优先排在前面，同类型按名称字典序
  const displayedItems = useMemo(() => {
    let list = [...contents]
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter(it => it.name.toLowerCase().includes(q))
    }
    return list.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'dir' ? -1 : 1
      }
      return a.name.localeCompare(b.name, 'zh-CN')
    })
  }, [contents, searchQuery])



  // 导航操作（防误触与冷却截流）
  const handleBreadcrumbNavigate = (id: string) => {
    const now = Date.now()
    if (loading || isNavigatingRef.current || now - lastNavTimeRef.current < 400) return
    lastNavTimeRef.current = now
    if (!id) {
      setCurrentPath([])
    } else {
      setCurrentPath(id.split('/'))
    }
  }

  const handleEnterFolder = useCallback((name: string) => {
    const now = Date.now()
    // 防误触与连击节流：若当前处于加载中或距离上一次导航不足 450ms，坚决丢弃请求
    if (loading || isNavigatingRef.current || now - lastNavTimeRef.current < 450) {
      return
    }
    lastNavTimeRef.current = now
    isNavigatingRef.current = true
    setCurrentPath(prev => [...prev, name])
  }, [loading])

  // 多选逻辑
  const toggleSelect = (name: string) => {
    setSelectedNames(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // 智能分类多选逻辑
  const cloudPanTriState = useMemo<TriState>(() => {
    if (displayedItems.length === 0 || selectedNames.size === 0) return 'none'
    const selCount = displayedItems.filter(i => selectedNames.has(i.name)).length
    if (selCount === 0) return 'none'
    if (selCount === displayedItems.length) return 'all'
    return 'some'
  }, [displayedItems, selectedNames])

  const handleToggleAll = () => {
    if (cloudPanTriState === 'all') {
      setSelectedNames(new Set())
    } else {
      setSelectedNames(new Set(displayedItems.map(i => i.name)))
    }
  }

  const handleSelectFilesOnly = () => {
    const files = displayedItems.filter(i => i.type === 'file').map(i => i.name)
    setSelectedNames(new Set(files))
  }

  const handleSelectVideosOnly = () => {
    const videoExts = ['mp4', 'mkv', 'mov', 'flv', 'ts', 'webm', 'mp3', 'm4a', 'wav']
    const media = displayedItems
      .filter(i => i.type === 'file' && videoExts.includes(i.name.split('.').pop()?.toLowerCase() || ''))
      .map(i => i.name)
    setSelectedNames(new Set(media))
  }

  const handleSelectDocsOnly = () => {
    const docExts = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'zip', 'rar', '7z']
    const docs = displayedItems
      .filter(i => i.type === 'file' && docExts.includes(i.name.split('.').pop()?.toLowerCase() || ''))
      .map(i => i.name)
    setSelectedNames(new Set(docs))
  }

  const handleClearSelection = () => {
    setSelectedNames(new Set())
  }

  // 单项操作
  const handleDownloadSingle = async (item: CloudPanItem) => {
    if (item.type === 'dir') {
      showToast('暂不支持直接下载文件夹，请进入目录下载单个文件', 'info')
      return
    }
    try {
      const remotePath = [...currentPath, item.name]
      const res = await window.api.cloudpan.downloadFile(remotePath, localDestRoot || undefined)
      if (res.ok) {
        showToast(`已将「${item.name}」加入传输中心下载队列`, 'success')
      } else {
        showToast(res.error || '下载提交失败', 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '下载异常', 'error')
    }
  }

  const handleOpenBrowserSingle = async (item: CloudPanItem) => {
    try {
      await window.api.cloudpan.openInBrowser([...currentPath, item.name])
    } catch (err) {
      showToast(err instanceof Error ? err.message : '打开网页端失败', 'error')
    }
  }

  // 上传文件
  const handleUploadFiles = async () => {
    try {
      const res = await window.api.cloudpan.uploadFiles(currentPath)
      if (res.ok) {
        if (res.count && res.count > 0) {
          showToast(`已将 ${res.count} 个文件加入传输中心上传队列`, 'success')
          void fetchDirectory(currentPath)
          void refreshSpaceInfo()
        }
      } else if (res.error) {
        showToast(`上传异常: ${res.error}`, 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '上传文件失败', 'error')
    }
  }

  // 网页端打开当前目录
  const handleOpenCurrentInBrowser = async () => {
    try {
      await window.api.cloudpan.openInBrowser(currentPath)
    } catch (err) {
      showToast(err instanceof Error ? err.message : '打开网页端失败', 'error')
    }
  }

  // 新建文件夹提交
  const handleCreateFolderSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const name = newFolderName.trim()
    if (!name) {
      showToast('文件夹名称不能为空', 'error')
      return
    }
    if (/[\\/:*?"<>|]/.test(name)) {
      showToast('文件夹名称不能包含 \\ / : * ? " < > | 等非法字符', 'error')
      return
    }
    setIsCreatingFolder(true)
    try {
      const res = await window.api.cloudpan.createFolder([...currentPath, name])
      if (res.ok) {
        showToast(`文件夹「${name}」创建成功`, 'success')
        setNewFolderOpen(false)
        setNewFolderName('')
        void fetchDirectory(currentPath)
      } else {
        showToast(res.error || '新建文件夹失败', 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '新建文件夹异常', 'error')
    } finally {
      setIsCreatingFolder(false)
    }
  }

  // 重命名提交
  const handleRenameSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!renameTarget) return
    const newName = renameNewName.trim()
    if (!newName) {
      showToast('新名称不能为空', 'error')
      return
    }
    if (newName === renameTarget.name) {
      setRenameTarget(null)
      return
    }
    if (/[\\/:*?"<>|]/.test(newName)) {
      showToast('名称不能包含 \\ / : * ? " < > | 等非法字符', 'error')
      return
    }
    setIsRenaming(true)
    try {
      const oldPath = [...currentPath, renameTarget.name]
      const res = await window.api.cloudpan.renameItem(oldPath, newName, renameTarget.type === 'dir')
      if (res.ok) {
        showToast(`已重命名为「${newName}」`, 'success')
        setRenameTarget(null)
        void fetchDirectory(currentPath)
      } else {
        showToast(res.error || '重命名失败', 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '重命名异常', 'error')
    } finally {
      setIsRenaming(false)
    }
  }

  // 删除确认提交
  const handleDeleteSubmit = async () => {
    if (!deleteTargets || deleteTargets.length === 0) return
    setIsDeleting(true)
    let successCount = 0
    let failedCount = 0
    try {
      for (const item of deleteTargets) {
        const targetPath = [...currentPath, item.name]
        const res = await window.api.cloudpan.deleteItem(targetPath, item.type === 'dir')
        if (res.ok) successCount++
        else failedCount++
      }
      if (failedCount === 0) {
        showToast(`已成功删除 ${successCount} 项内容（移入回收站）`, 'success')
      } else {
        showToast(`成功删除 ${successCount} 项，失败 ${failedCount} 项`, 'error')
      }
      setDeleteTargets(null)
      setSelectedNames(new Set())
      void fetchDirectory(currentPath)
      void refreshSpaceInfo()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除处理异常', 'error')
    } finally {
      setIsDeleting(false)
    }
  }

  // 批量下载选中的文件
  const handleBatchDownload = async () => {
    const selectedFiles = displayedItems.filter(it => selectedNames.has(it.name) && it.type === 'file')
    if (selectedFiles.length === 0) {
      showToast('所选项目中没有文件（暂不支持直接批量下载整个文件夹）', 'info')
      return
    }
    let queuedCount = 0
    for (const file of selectedFiles) {
      const remotePath = [...currentPath, file.name]
      const res = await window.api.cloudpan.downloadFile(remotePath, localDestRoot || undefined)
      if (res.ok) queuedCount++
    }
    showToast(`已将 ${queuedCount} 个文件加入下载队列`, 'success')
    setSelectedNames(new Set())
  }

  // 面包屑项
  const breadcrumbItems: BreadcrumbItem[] = useMemo(() => {
    const items: BreadcrumbItem[] = [
      {
        id: '',
        label: '个人根目录',
        icon: <span>☁️</span>
      }
    ]
    currentPath.forEach((seg, idx) => {
      items.push({
        id: currentPath.slice(0, idx + 1).join('/'),
        label: seg,
        icon: <span>📁</span>
      })
    })
    return items
  }, [currentPath])

  return (
    <div className="flex h-full w-full flex-col bg-surface-1 overflow-hidden select-none">
      {/* 顶部横幅栏 */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-bd bg-surface-2 px-6 py-3.5 shadow-2xs">
        <div className="flex items-center gap-3">
          <span className="text-base font-bold text-text-1">☁️ 交大云盘资源管理器</span>
          {quota && (
            <div
              className="hidden md:flex items-center gap-2 rounded-xl border border-bd/80 bg-surface-1 px-2.5 py-1 text-2xs text-text-2 shadow-2xs"
              title={`容量已用: ${quota.usedStr}，总容量: ${quota.totalStr}`}
            >
              <span>已用 {quota.usedStr} / {quota.totalStr} ({quota.pct}%)</span>
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    quota.pct > 90 ? 'bg-warning' : 'bg-accent'
                  }`}
                  style={{ width: `${quota.pct}%` }}
                />
              </div>
            </div>
          )}

          {/* 视图模式切换（三态视图统一：分栏 / 列表 / 网格，移至左侧与课程一致） */}
          <NetdiskViewModeSwitch
            mode={courseViewMode}
            onChange={setCourseViewMode}
          />
        </div>

        {/* 右侧动作工具栏 */}
        <div className="flex items-center gap-2">
          {/* 新建文件夹 */}
          <button
            type="button"
            onClick={() => {
              setNewFolderName('')
              setNewFolderOpen(true)
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-bd bg-surface-1 px-3 text-xs font-medium text-text-1 hover:border-bd-strong hover:bg-surface-2 transition-all shadow-2xs cursor-pointer"
            title="在当前目录下新建文件夹"
          >
            <span className="font-bold text-accent">+</span>
            <span>新建文件夹</span>
          </button>

          {/* 上传文件 */}
          <button
            type="button"
            onClick={() => void handleUploadFiles()}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-semibold text-white shadow-glow-sm hover:brightness-110 active:scale-95 transition-all cursor-pointer"
            title="选择本地文件上传到当前云盘目录"
          >
            <span>📤 上传文件</span>
          </button>

          {/* 网页端打开 */}
          <button
            type="button"
            onClick={() => void handleOpenCurrentInBrowser()}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-bd bg-surface-1 px-3 text-xs font-medium text-text-2 hover:border-bd-strong hover:bg-surface-2 hover:text-text-1 transition-all shadow-2xs cursor-pointer"
            title="在默认浏览器中打开交大云盘该目录"
          >
            <span>🌐 网页端打开</span>
          </button>

          {/* 刷新 */}
          <button
            type="button"
            onClick={() => {
              void fetchDirectory(currentPath)
              void refreshSpaceInfo()
            }}
            disabled={loading}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-bd bg-surface-1 text-text-2 hover:border-bd-strong hover:bg-surface-2 hover:text-text-1 transition-all shadow-2xs cursor-pointer disabled:opacity-50"
            title="刷新当前目录内容"
          >
            <span className={loading ? 'animate-spin' : ''}>↻</span>
          </button>
        </div>
      </header>

      {/* 路径导航条与本地搜索 */}
      <div className="flex items-center justify-between border-b border-bd/60 bg-surface-1 px-6 py-2">
        <div className="flex-1 overflow-x-auto pr-4">
          <BreadcrumbBar items={breadcrumbItems} onNavigate={handleBreadcrumbNavigate} />
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {/* 快捷批量选择控件 */}
          <div ref={cloudPanBatchMenuRef} className="relative inline-flex items-center rounded-xl border border-bd bg-surface-2 shadow-2xs hover:border-bd-strong transition-all select-none">
            <button
              type="button"
              onClick={handleToggleAll}
              className="inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium text-text-1 hover:bg-surface-1 rounded-l-xl transition-all cursor-pointer"
              title="全选 / 取消当前目录全部项目"
            >
              <TriCheckbox state={cloudPanTriState} size="sm" />
              <span>全选</span>
            </button>
            <div className="h-3.5 w-px bg-bd/70" />
            <button
              type="button"
              onClick={() => setCloudPanBatchMenuOpen(prev => !prev)}
              className="inline-flex h-8 w-7 items-center justify-center text-xs text-text-3 hover:text-text-1 hover:bg-surface-1 rounded-r-xl transition-all cursor-pointer"
              title="快捷分类选择（仅选文件/仅选视频/仅选文档/清空）"
            >
              <svg className={`h-3 w-3 transition-transform duration-200 ${cloudPanBatchMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </button>

            {cloudPanBatchMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1.5 w-52 rounded-2xl border border-bd bg-surface-1 p-1.5 shadow-xl animate-fadeIn text-xs">
                <div className="px-2.5 py-1 text-2xs font-semibold text-text-3 border-b border-bd/40 mb-1">
                  当前目录快捷勾选 ({displayedItems.length} 项)
                </div>
                <button
                  type="button"
                  onClick={() => {
                    handleSelectFilesOnly()
                    setCloudPanBatchMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-text-1 hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <span>📄</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-xs text-accent">仅选所有文件</div>
                    <div className="text-2xs text-text-3">自动排除文件夹</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleSelectVideosOnly()
                    setCloudPanBatchMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-text-1 hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <span>🎬</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-xs text-info">仅选音视频文件</div>
                    <div className="text-2xs text-text-3">MP4 / MKV / MP3 等</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleSelectDocsOnly()
                    setCloudPanBatchMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-text-1 hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <span>📑</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-xs">仅选文档资料</div>
                    <div className="text-2xs text-text-3">PDF / Word / PPT 等</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleToggleAll()
                    setCloudPanBatchMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-text-1 hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  <span>📁</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-xs">全选所有项目</div>
                    <div className="text-2xs text-text-3">包含文件夹与文件</div>
                  </div>
                </button>
                <div className="my-1 border-t border-bd/40" />
                <button
                  type="button"
                  onClick={() => {
                    handleClearSelection()
                    setCloudPanBatchMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-warning hover:bg-warning/10 transition-colors cursor-pointer"
                >
                  <span>✕</span>
                  <span className="font-medium text-xs">清空选择</span>
                </button>
              </div>
            )}
          </div>

          <div className="relative shrink-0">
            <span className="pointer-events-none absolute left-3 top-2 text-text-4">🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索当前目录..."
              className="h-8 w-44 rounded-xl border border-bd bg-surface-2 pl-8 pr-3 text-xs text-text-1 placeholder:text-text-4 shadow-2xs focus:w-56 focus:border-accent focus:bg-surface-1 focus:outline-none transition-all duration-200"
            />
          </div>
        </div>
      </div>

      {/* 提示消息 Floating Toast */}
      {toastMsg && (
        <div className="fixed top-16 right-6 z-50 animate-fadeIn">
          <div
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium shadow-xl border backdrop-blur-md ${
              toastMsg.type === 'success'
                ? 'bg-success/15 border-success/30 text-success'
                : toastMsg.type === 'error'
                  ? 'bg-warning/15 border-warning/30 text-warning'
                  : 'bg-surface-1/90 border-bd text-text-1'
            }`}
          >
            <span>{toastMsg.type === 'success' ? '✅' : toastMsg.type === 'error' ? '⚠️' : 'ℹ️'}</span>
            <span>{toastMsg.text}</span>
          </div>
        </div>
      )}

      {/* 主视图内容区域 */}
      <main className={`relative flex-1 p-4 md:p-6 ${courseViewMode === 'column' ? 'overflow-hidden flex flex-col pb-20' : 'overflow-y-auto'}`}>
        {/* 加载中轻量蒙层与防误触穿透拦截 */}
        {loading && contents.length > 0 && courseViewMode !== 'column' && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-surface-1/40 backdrop-blur-[1px] pointer-events-auto select-none">
            <div className="flex items-center gap-2 rounded-xl border border-bd bg-surface-2 px-3.5 py-2 shadow-lg text-xs font-medium text-text-1">
              <Spinner size={16} />
              <span>正在加载目录…</span>
            </div>
          </div>
        )}
        {loading && contents.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-text-3">
            <Spinner size={24} />
            <span className="text-xs">正在读取云盘目录...</span>
          </div>
        ) : error ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="text-3xl">⚠️</div>
            <div className="text-sm font-semibold text-text-1">读取目录失败</div>
            <div className="text-xs text-warning max-w-md">{error}</div>
            <button
              type="button"
              onClick={() => void fetchDirectory(currentPath)}
              className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-xl border border-bd bg-surface-2 px-3 text-xs font-medium text-text-1 hover:bg-surface-3 transition-all"
            >
              ↻ 点击重试
            </button>
          </div>
        ) : displayedItems.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center text-text-3">
            <div className="text-4xl">📂</div>
            <div className="text-sm font-medium text-text-2">
              {searchQuery ? '未找到匹配的文件或文件夹' : '当前文件夹为空'}
            </div>
            <div className="text-xs text-text-4">
              可点击上方「📤 上传文件」上传本地资料，或「+ 新建文件夹」组织结构
            </div>
          </div>
        ) : courseViewMode === 'column' ? (
          <CloudPanMillerColumns
            initialItems={contents}
            currentPath={currentPath}
            onPathChange={setCurrentPath}
            selectedNames={selectedNames}
            onToggleSelect={toggleSelect}
            onDownloadSingle={handleDownloadSingle}
            onRename={item => {
              setRenameTarget(item)
              setRenameNewName(item.name)
            }}
            onDelete={item => setDeleteTargets([item])}
            onOpenWeb={handleOpenBrowserSingle}
          />
        ) : courseViewMode === 'grid' ? (
          /* macOS 风格原生自适应大图标网格视图 */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-3 p-2 pb-24 select-none">
            {displayedItems.map(item => {
              const isSelected = selectedNames.has(item.name)
              return (
                <div
                  key={item.name}
                  onClick={() => toggleSelect(item.name)}
                  onDoubleClick={() => {
                    if (item.type === 'dir') {
                      handleEnterFolder(item.name)
                    } else {
                      void handleDownloadSingle(item)
                    }
                  }}
                  className={`group relative flex flex-col items-center justify-start rounded-xl p-2.5 transition-all duration-150 cursor-pointer ${
                    isSelected
                      ? 'bg-accent/15 ring-1 ring-accent/40 shadow-xs'
                      : 'hover:bg-surface-2/70 active:bg-surface-3/50'
                  }`}
                  title={`${item.name} (${item.type === 'dir' ? '双击进入' : '双击下载'})`}
                >
                  {/* macOS 风格圆圈复选框 (左上角) */}
                  <div
                    className="absolute top-2 left-2 z-10"
                    onClick={e => {
                      e.stopPropagation()
                      toggleSelect(item.name)
                    }}
                  >
                    <MacOSCircleCheckbox
                      checked={isSelected}
                      size="sm"
                      className={isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                    />
                  </div>

                  {/* 悬停快捷微操作菜单 (右上角微胶囊) */}
                  <div
                    className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={e => e.stopPropagation()}
                  >
                    {item.type === 'dir' ? (
                      <button
                        type="button"
                        onClick={() => handleEnterFolder(item.name)}
                        title="进入文件夹"
                        className="flex h-5 items-center gap-0.5 rounded-full bg-surface-1/90 px-1.5 text-2xs font-medium text-accent border border-bd shadow-2xs hover:bg-surface-2 cursor-pointer"
                      >
                        <span>进入</span>
                        <span>›</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleDownloadSingle(item)}
                        title="下载到本地"
                        className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-1/90 text-text-3 hover:text-accent border border-bd shadow-2xs hover:bg-surface-2 cursor-pointer text-2xs"
                      >
                        ↓
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setRenameTarget(item)
                        setRenameNewName(item.name)
                      }}
                      title="重命名"
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-1/90 text-text-3 hover:text-text-1 border border-bd shadow-2xs hover:bg-surface-2 cursor-pointer text-2xs"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTargets([item])}
                      title="删除"
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-1/90 text-text-3 hover:text-warning border border-bd shadow-2xs hover:bg-surface-2 cursor-pointer text-2xs"
                    >
                      ×
                    </button>
                  </div>

                  {/* 居中大图标 (60px) */}
                  <div className="my-1 flex h-16 w-16 items-center justify-center transition-transform duration-150 group-hover:scale-105 shrink-0">
                    {item.type === 'dir' ? (
                      <MacOSFolderIcon size={60} />
                    ) : (
                      <MacOSDocumentIcon filename={item.name} size={58} />
                    )}
                  </div>

                  {/* 居中文件名与副标元信息 (严格顶部对齐与固定基线) */}
                  <div className="w-full flex flex-col items-center text-center mt-1.5">
                    <span
                      className={`text-xs font-medium line-clamp-2 break-all leading-snug w-full px-1 h-9 flex items-start justify-center ${
                        isSelected ? 'text-accent font-semibold' : 'text-text-1'
                      }`}
                      title={item.name}
                    >
                      {item.name}
                    </span>
                    <span className="mt-0.5 text-2xs text-text-4 truncate w-full px-1 font-mono h-4 flex items-center justify-center">
                      {item.type === 'dir' ? '文件夹' : formatBytes(item.size || 0)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          /* 详细列表表格视图 */
          <div className="overflow-hidden rounded-2xl border border-bd bg-surface-2 shadow-2xs pb-20">
            <div className="grid grid-cols-12 items-center border-b border-bd/70 bg-surface-3/50 px-4 py-2.5 text-xs font-semibold text-text-3">
              <div className="col-span-6 flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selectedNames.size === displayedItems.length && displayedItems.length > 0}
                  onChange={handleToggleAll}
                  className="h-4 w-4 rounded border-bd text-accent focus:ring-accent cursor-pointer"
                />
                <span>名称</span>
              </div>
              <div className="col-span-2 text-right">大小</div>
              <div className="col-span-2 text-right">修改时间</div>
              <div className="col-span-2 text-right pr-2">操作</div>
            </div>

            <div className="divide-y divide-bd/40">
              {displayedItems.map(item => {
                const isSelected = selectedNames.has(item.name)
                return (
                  <div
                    key={item.name}
                    onDoubleClick={() => {
                      if (item.type === 'dir') handleEnterFolder(item.name)
                    }}
                    className={`grid grid-cols-12 items-center px-4 py-2.5 text-xs transition-colors select-none ${
                      item.type === 'dir' ? 'cursor-pointer hover:bg-surface-1' : 'hover:bg-surface-1'
                    } ${isSelected ? 'bg-accent/5' : ''}`}
                  >
                    <div className="col-span-6 flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        onClick={e => {
                          e.stopPropagation()
                          toggleSelect(item.name)
                        }}
                        className="h-4 w-4 rounded border-bd text-accent focus:ring-accent cursor-pointer shrink-0"
                      />
                      {getFileIcon(item, false)}
                      <span className="truncate font-medium text-text-1" title={item.name}>
                        {item.name}
                      </span>
                    </div>

                    <div className="col-span-2 text-right font-mono text-text-3">
                      {item.type === 'dir' ? '-' : formatBytes(item.size || 0)}
                    </div>

                    <div className="col-span-2 text-right text-text-3 font-mono text-2xs">
                      {formatDate(item.modificationTime)}
                    </div>

                    <div
                      className="col-span-2 flex items-center justify-end gap-1"
                      onClick={e => e.stopPropagation()}
                    >
                      {item.type === 'dir' && (
                        <button
                          type="button"
                          onClick={() => handleEnterFolder(item.name)}
                          title="进入文件夹"
                          className="inline-flex items-center gap-1 rounded-lg bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/25 transition-colors cursor-pointer"
                        >
                          <span>进入</span>
                          <span className="font-bold">›</span>
                        </button>
                      )}
                      {item.type === 'file' && (
                        <button
                          type="button"
                          onClick={() => void handleDownloadSingle(item)}
                          title="下载到本地"
                          className="rounded-lg p-1 text-text-3 hover:bg-accent/15 hover:text-accent transition-colors cursor-pointer"
                        >
                          📥
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setRenameTarget(item)
                          setRenameNewName(item.name)
                        }}
                        title="重命名"
                        className="rounded-lg p-1 text-text-3 hover:bg-surface-3 hover:text-text-1 transition-colors"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTargets([item])}
                        title="删除"
                        className="rounded-lg p-1 text-text-3 hover:bg-warning/20 hover:text-warning transition-colors"
                      >
                        🗑️
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleOpenBrowserSingle(item)}
                        title="在网页端打开"
                        className="rounded-lg p-1 text-text-3 hover:bg-surface-3 hover:text-text-1 transition-colors"
                      >
                        🌐
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 底部浮动批量操作胶囊 (Floating Batch Action Bar) */}
        {selectedNames.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-fadeIn">
            <div className="flex items-center gap-3 rounded-2xl border border-bd bg-surface-2/95 px-5 py-2.5 shadow-2xl backdrop-blur-md">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-text-1 pr-2 border-r border-bd">
                <span className="text-accent">☑</span>
                <span>已选择 {selectedNames.size} 项</span>
              </div>

              {/* 批量下载 */}
              <button
                type="button"
                onClick={() => void handleBatchDownload()}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-semibold text-white shadow-glow-sm hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                title="将勾选的所有文件加入下载队列"
              >
                <span>📥 批量下载到本地</span>
              </button>

              {/* 批量删除 */}
              <button
                type="button"
                onClick={() => {
                  const toDelete = displayedItems.filter(it => selectedNames.has(it.name))
                  setDeleteTargets(toDelete)
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-warning/40 bg-warning/10 px-3 text-xs font-medium text-warning hover:bg-warning/20 transition-all cursor-pointer"
                title="批量删除所选内容"
              >
                <span>🗑️ 批量删除</span>
              </button>

              {/* 取消选择 */}
              <button
                type="button"
                onClick={() => setSelectedNames(new Set())}
                className="inline-flex h-8 items-center rounded-xl px-2.5 text-xs text-text-3 hover:bg-surface-3 hover:text-text-1 transition-all cursor-pointer"
              >
                取消选择
              </button>
            </div>
          </div>
        )}
      </main>

      {/* ─── 模态弹窗 1: 新建文件夹 ─── */}
      {newFolderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-fadeIn" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setNewFolderOpen(false)} />
          <div className="relative w-[360px] rounded-2xl border border-bd bg-surface-1 p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-text-1 mb-3">📁 新建文件夹</h3>
            <form onSubmit={e => void handleCreateFolderSubmit(e)}>
              <input
                autoFocus
                type="text"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                placeholder="请输入文件夹名称"
                className="w-full h-9 rounded-xl border border-bd bg-surface-2 px-3 text-xs text-text-1 placeholder:text-text-4 focus:border-accent focus:outline-none transition-all"
              />
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNewFolderOpen(false)}
                  className="h-8 rounded-xl px-3 text-xs text-text-3 hover:bg-surface-2 hover:text-text-1 transition-all cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isCreatingFolder || !newFolderName.trim()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-accent px-4 text-xs font-semibold text-white shadow-glow-sm hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isCreatingFolder ? '创建中...' : '确认创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── 模态弹窗 2: 重命名 ─── */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-fadeIn" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setRenameTarget(null)} />
          <div className="relative w-[360px] rounded-2xl border border-bd bg-surface-1 p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-text-1 mb-3">
              ✏️ 重命名{renameTarget.type === 'dir' ? '文件夹' : '文件'}
            </h3>
            <form onSubmit={e => void handleRenameSubmit(e)}>
              <input
                autoFocus
                type="text"
                value={renameNewName}
                onChange={e => setRenameNewName(e.target.value)}
                placeholder="请输入新名称"
                className="w-full h-9 rounded-xl border border-bd bg-surface-2 px-3 text-xs text-text-1 placeholder:text-text-4 focus:border-accent focus:outline-none transition-all"
              />
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenameTarget(null)}
                  className="h-8 rounded-xl px-3 text-xs text-text-3 hover:bg-surface-2 hover:text-text-1 transition-all cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isRenaming || !renameNewName.trim()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-accent px-4 text-xs font-semibold text-white shadow-glow-sm hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isRenaming ? '保存中...' : '确认重命名'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── 模态弹窗 3: 删除确认 ─── */}
      {deleteTargets && deleteTargets.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-fadeIn" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setDeleteTargets(null)} />
          <div className="relative w-[380px] rounded-2xl border border-bd bg-surface-1 p-5 shadow-2xl text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning/15 text-2xl text-warning mb-3">
              🗑️
            </div>
            <h3 className="text-base font-bold text-text-1">确认删除？</h3>
            <p className="mt-2 text-xs text-text-3 leading-relaxed">
              确定要将选中的 <strong className="text-text-1">{deleteTargets.length}</strong> 项内容删除吗？
              <br />
              删除后内容将移入交大云盘回收站。
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setDeleteTargets(null)}
                className="h-9 rounded-xl border border-bd bg-surface-2 px-4 text-xs font-medium text-text-2 hover:bg-surface-3 transition-all cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteSubmit()}
                disabled={isDeleting}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-warning px-5 text-xs font-semibold text-white shadow-glow-sm hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CloudPanExplorer
