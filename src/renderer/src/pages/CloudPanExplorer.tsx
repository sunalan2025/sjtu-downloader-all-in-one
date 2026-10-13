import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/app'
import { BreadcrumbBar, type BreadcrumbItem } from '../components/BreadcrumbBar'
import { NetdiskViewModeSwitch } from '../components/DownloadUI'
import { Spinner } from '../components/Spinner'
import { formatBytes } from '@shared/utils'
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
  const [activeItemName, setActiveItemName] = useState<string | null>(null)
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set())
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null)

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

  // 区分文件夹目录与选定活跃项目（用于分栏模式）
  const dirItems = useMemo(() => {
    return displayedItems.filter(i => i.type === 'dir')
  }, [displayedItems])

  const activeItem = useMemo(() => {
    if (!activeItemName) return displayedItems[0] || null
    return displayedItems.find(i => i.name === activeItemName) || displayedItems[0] || null
  }, [displayedItems, activeItemName])

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
    setActiveItemName(null)
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
    setActiveItemName(null)
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

  const handleToggleAll = () => {
    if (selectedNames.size === displayedItems.length && displayedItems.length > 0) {
      setSelectedNames(new Set())
    } else {
      setSelectedNames(new Set(displayedItems.map(i => i.name)))
    }
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

          {/* 视图模式切换（三态视图统一：分栏 / 列表 / 网格） */}
          <NetdiskViewModeSwitch
            mode={courseViewMode}
            onChange={setCourseViewMode}
          />
        </div>
      </header>

      {/* 路径导航条与本地搜索 */}
      <div className="flex items-center justify-between border-b border-bd/60 bg-surface-1 px-6 py-2">
        <div className="flex-1 overflow-x-auto pr-4">
          <BreadcrumbBar items={breadcrumbItems} onNavigate={handleBreadcrumbNavigate} />
        </div>
        <div className="relative shrink-0">
          <span className="pointer-events-none absolute left-3 top-2.5 text-text-4">🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="搜索当前目录..."
            className="h-8 w-44 rounded-xl border border-bd bg-surface-2 pl-8 pr-3 text-xs text-text-1 placeholder:text-text-4 shadow-2xs focus:w-56 focus:border-accent focus:bg-surface-1 focus:outline-none transition-all duration-200"
          />
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
        {loading && contents.length > 0 && (
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
          /* 分栏多级并列视图 (Column / macOS Miller Columns) */
          <div className="flex h-full w-full divide-x divide-bd rounded-2xl border border-bd bg-surface-1 shadow-card overflow-hidden">
            {/* 第 1 栏：目录结构与文件夹导航 */}
            <div className="flex w-64 md:w-72 shrink-0 flex-col bg-surface-1">
              <div className="flex h-10 items-center justify-between border-b border-bd bg-surface-2/40 px-4 text-xs font-semibold text-text-2 select-none">
                <span className="flex items-center gap-1.5">
                  <span>📁 文件夹目录</span>
                  <span className="font-mono text-2xs text-text-3">({dirItems.length})</span>
                </span>
                {currentPath.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentPath(prev => prev.slice(0, -1))
                      setActiveItemName(null)
                    }}
                    className="text-2xs text-accent hover:underline flex items-center gap-0.5 cursor-pointer"
                    title="返回上一级目录"
                  >
                    <span>⬆️ 上一级</span>
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-bd/30">
                {/* 根目录快捷项 */}
                <div
                  onClick={() => {
                    if (currentPath.length > 0) {
                      setCurrentPath([])
                      setActiveItemName(null)
                    }
                  }}
                  className={`flex items-center justify-between px-3.5 py-2.5 transition-colors cursor-pointer select-none ${
                    currentPath.length === 0
                      ? 'bg-accent/10 border-l-4 border-accent text-accent font-semibold'
                      : 'hover:bg-surface-2/60 text-text-1'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-base">☁️</span>
                    <span className="truncate text-xs font-medium">个人根目录</span>
                  </div>
                  {currentPath.length > 0 && <span className="text-2xs text-text-4 font-mono">根</span>}
                </div>

                {/* 当前层级的文件夹项 */}
                {dirItems.map(dir => {
                  const isSelected = selectedNames.has(dir.name)
                  const isActive = activeItem?.name === dir.name
                  return (
                    <div
                      key={dir.name}
                      onClick={() => setActiveItemName(dir.name)}
                      onDoubleClick={() => handleEnterFolder(dir.name)}
                      className={`flex items-center justify-between px-3.5 py-2.5 transition-colors cursor-pointer select-none ${
                        isActive
                          ? 'bg-accent/10 border-l-4 border-accent text-accent font-semibold'
                          : 'hover:bg-surface-2/60 text-text-1'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          role="checkbox"
                          aria-checked={isSelected}
                          tabIndex={0}
                          onClick={e => {
                            e.stopPropagation()
                            toggleSelect(dir.name)
                          }}
                          className="cursor-pointer shrink-0"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="h-3.5 w-3.5 rounded border-bd text-accent focus:ring-accent cursor-pointer"
                          />
                        </span>
                        <span className="text-amber-500 shrink-0">📁</span>
                        <span className="truncate text-xs" title={dir.name}>
                          {dir.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          handleEnterFolder(dir.name)
                        }}
                        className="text-text-4 hover:text-accent p-1 -mr-1 rounded hover:bg-surface-3 transition-colors text-xs font-mono cursor-pointer"
                        title="进入此文件夹"
                      >
                        ›
                      </button>
                    </div>
                  )
                })}

                {dirItems.length === 0 && (
                  <div className="flex flex-col items-center justify-center p-8 text-center text-text-4 text-xs">
                    <span className="text-2xl mb-1 opacity-60">📂</span>
                    <span>当前层级暂无子文件夹</span>
                  </div>
                )}
              </div>
            </div>

            {/* 第 2 栏：当前目录全部文件与项目列表 */}
            <div className="flex w-80 md:w-96 shrink-0 flex-col bg-surface-1/50 border-r border-bd">
              <div className="flex h-10 items-center justify-between border-b border-bd bg-surface-2/40 px-4 text-xs font-semibold text-text-2 select-none">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedNames.size === displayedItems.length && displayedItems.length > 0}
                    onChange={handleToggleAll}
                    className="h-3.5 w-3.5 rounded border-bd text-accent focus:ring-accent cursor-pointer"
                    title="全选当前列表"
                  />
                  <span className="truncate max-w-[160px]">
                    {currentPath.length === 0 ? '根目录项目' : currentPath[currentPath.length - 1]}
                  </span>
                  <span className="font-mono text-2xs text-text-3">({displayedItems.length})</span>
                </div>
                <span className="text-2xs text-text-4 font-normal">单击选定 · 双击进目录</span>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-bd/30">
                {displayedItems.map(item => {
                  const isSelected = selectedNames.has(item.name)
                  const isActive = activeItem?.name === item.name
                  return (
                    <div
                      key={item.name}
                      onClick={() => setActiveItemName(item.name)}
                      onDoubleClick={() => {
                        if (item.type === 'dir') handleEnterFolder(item.name)
                      }}
                      className={`flex items-center justify-between px-3.5 py-2.5 transition-colors cursor-pointer select-none ${
                        isActive
                          ? 'bg-accent/15 border-l-4 border-accent text-accent font-semibold'
                          : 'hover:bg-surface-2/60 text-text-1'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span
                          role="checkbox"
                          aria-checked={isSelected}
                          tabIndex={0}
                          onClick={e => {
                            e.stopPropagation()
                            toggleSelect(item.name)
                          }}
                          className="cursor-pointer shrink-0"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="h-3.5 w-3.5 rounded border-bd text-accent focus:ring-accent cursor-pointer"
                          />
                        </span>
                        <span className="shrink-0">{getFileIcon(item, false)}</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium" title={item.name}>
                            {item.name}
                          </div>
                          <div className="flex items-center gap-2 text-2xs font-mono text-text-3 mt-0.5">
                            <span>{item.type === 'dir' ? '文件夹' : formatBytes(item.size || 0)}</span>
                            <span>·</span>
                            <span>{formatDate(item.modificationTime).split(' ')[0]}</span>
                          </div>
                        </div>
                      </div>

                      {item.type === 'dir' ? (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation()
                            handleEnterFolder(item.name)
                          }}
                          className="text-text-4 hover:text-accent p-1 text-xs font-mono cursor-pointer"
                          title="进入文件夹"
                        >
                          ›
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation()
                            void handleDownloadSingle(item)
                          }}
                          className="text-text-3 hover:text-accent p-1 rounded hover:bg-surface-3 transition-colors text-xs cursor-pointer"
                          title="下载到本地"
                        >
                          📥
                        </button>
                      )}
                    </div>
                  )
                })}

                {displayedItems.length === 0 && (
                  <div className="flex flex-col items-center justify-center p-8 text-center text-text-4 text-xs">
                    <span className="text-2xl mb-1 opacity-60">📂</span>
                    <span>当前文件夹为空</span>
                  </div>
                )}
              </div>
            </div>

            {/* 第 3 栏：选定项目详情与操作控制台 */}
            <div className="flex flex-1 flex-col bg-surface-1 p-6 overflow-y-auto">
              <div className="flex h-10 items-center justify-between border-b border-bd pb-3 mb-6 select-none">
                <span className="text-xs font-semibold text-text-2">ℹ️ 资源详情与控制台</span>
                {selectedNames.size > 0 && (
                  <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-2xs font-medium text-accent">
                    已勾选 {selectedNames.size} 项
                  </span>
                )}
              </div>

              {activeItem ? (
                <div className="flex flex-col items-center text-center max-w-md mx-auto w-full">
                  {/* 大图标 */}
                  <div className="my-4 p-4 rounded-2xl bg-surface-2 border border-bd/60 shadow-inner">
                    {getFileIcon(activeItem, true)}
                  </div>

                  {/* 名称 */}
                  <h3 className="text-sm font-bold text-text-1 break-all select-text mb-2 leading-relaxed" title={activeItem.name}>
                    {activeItem.name}
                  </h3>

                  {/* 详细元数据 */}
                  <div className="w-full my-4 rounded-xl border border-bd bg-surface-2/60 p-3.5 text-left text-xs divide-y divide-bd/40">
                    <div className="flex justify-between py-1.5">
                      <span className="text-text-3">项目类型</span>
                      <span className="font-medium text-text-1 font-mono uppercase">
                        {activeItem.type === 'dir' ? '文件夹 (Directory)' : (activeItem.name.split('.').pop() || 'FILE')}
                      </span>
                    </div>
                    {activeItem.type === 'file' && (
                      <div className="flex justify-between py-1.5">
                        <span className="text-text-3">文件大小</span>
                        <span className="font-mono text-text-1 font-semibold">{formatBytes(activeItem.size || 0)}</span>
                      </div>
                    )}
                    <div className="flex justify-between py-1.5">
                      <span className="text-text-3">修改时间</span>
                      <span className="font-mono text-text-2">{formatDate(activeItem.modificationTime)}</span>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <span className="text-text-3">云端路径</span>
                      <span className="font-mono text-2xs text-text-2 truncate max-w-[200px]" title={`/${[...currentPath, activeItem.name].join('/')}`}>
                        /{[...currentPath, activeItem.name].join('/')}
                      </span>
                    </div>
                  </div>

                  {/* 操作按钮群 */}
                  <div className="w-full flex flex-col gap-2.5 mt-2">
                    {activeItem.type === 'file' && (
                      <button
                        type="button"
                        onClick={() => void handleDownloadSingle(activeItem)}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-white shadow-glow-sm hover:opacity-95 transition-all cursor-pointer"
                      >
                        <span>📥 下载此文件到本地</span>
                      </button>
                    )}
                    {activeItem.type === 'dir' && (
                      <button
                        type="button"
                        onClick={() => handleEnterFolder(activeItem.name)}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-white shadow-glow-sm hover:opacity-95 transition-all cursor-pointer"
                      >
                        <span>📂 进入此文件夹</span>
                      </button>
                    )}

                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRenameTarget(activeItem)
                          setRenameNewName(activeItem.name)
                        }}
                        className="flex items-center justify-center gap-1 rounded-xl border border-bd bg-surface-2 px-3 py-2 text-xs font-medium text-text-1 hover:border-bd-strong hover:bg-surface-3 transition-colors cursor-pointer"
                      >
                        <span>✏️ 重命名</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTargets([activeItem])}
                        className="flex items-center justify-center gap-1 rounded-xl border border-bd bg-surface-2 px-3 py-2 text-xs font-medium text-warning hover:border-warning/50 hover:bg-warning/10 transition-colors cursor-pointer"
                      >
                        <span>🗑️ 删除</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleOpenBrowserSingle(activeItem)}
                        className="flex items-center justify-center gap-1 rounded-xl border border-bd bg-surface-2 px-3 py-2 text-xs font-medium text-text-2 hover:border-bd-strong hover:bg-surface-3 hover:text-text-1 transition-colors cursor-pointer"
                      >
                        <span>🌐 网页端</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-center text-text-4">
                  <span className="text-4xl mb-2">☁️</span>
                  <span className="text-xs text-text-2 font-medium">请在左侧或中间列选择项目</span>
                  <span className="text-2xs text-text-3 mt-1">支持实时查看文件元数据、直链下载与云盘管理</span>
                </div>
              )}
            </div>
          </div>
        ) : courseViewMode === 'grid' ? (
          /* 网格大图标视图 */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 pb-20">
            {displayedItems.map(item => {
              const isSelected = selectedNames.has(item.name)
              return (
                <div
                  key={item.name}
                  onClick={() => {
                    setActiveItemName(item.name)
                  }}
                  onDoubleClick={() => {
                    if (item.type === 'dir') {
                      handleEnterFolder(item.name)
                    }
                  }}
                  className={`group relative flex flex-col justify-between rounded-2xl border p-3.5 transition-all shadow-2xs select-none ${
                    item.type === 'dir' ? 'cursor-pointer' : 'cursor-default'
                  } ${
                    isSelected
                      ? 'border-accent bg-accent/5 ring-1 ring-accent'
                      : 'border-bd bg-surface-2 hover:border-bd-strong hover:bg-surface-1'
                  }`}
                >
                  {/* 复选框勾选 */}
                  <div
                    className="absolute top-2.5 left-2.5 z-10"
                    onClick={e => {
                      e.stopPropagation()
                      toggleSelect(item.name)
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      className="h-4 w-4 rounded border-bd text-accent focus:ring-accent cursor-pointer"
                    />
                  </div>

                  {/* 图标 */}
                  <div className="flex flex-col items-center pt-2 pb-1">
                    {getFileIcon(item, true)}
                    <span
                      className="mt-2.5 text-center text-xs font-medium text-text-1 line-clamp-2 break-all w-full leading-snug"
                      title={item.name}
                    >
                      {item.name}
                    </span>
                  </div>

                  {/* 元信息 */}
                  <div className="mt-2 flex items-center justify-between text-2xs text-text-4 pt-1 border-t border-bd/40">
                    <span>{item.type === 'dir' ? '文件夹' : formatBytes(item.size || 0)}</span>
                    <span title={item.modificationTime}>{formatDate(item.modificationTime).split(' ')[0]}</span>
                  </div>

                  {/* 悬停快捷操作栏 */}
                  <div
                    className="mt-2 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={e => e.stopPropagation()}
                  >
                    {item.type === 'dir' && (
                      <button
                        type="button"
                        onClick={() => handleEnterFolder(item.name)}
                        title="进入文件夹"
                        className="inline-flex items-center gap-0.5 rounded-lg bg-accent/15 px-2 py-0.5 text-2xs font-semibold text-accent hover:bg-accent/25 transition-colors cursor-pointer"
                      >
                        <span>进入</span>
                        <span>›</span>
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
                    onClick={() => {
                      setActiveItemName(item.name)
                    }}
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
