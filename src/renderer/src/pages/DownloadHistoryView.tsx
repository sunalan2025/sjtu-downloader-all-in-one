import { useState, useMemo } from 'react'
import { useAppStore } from '../store/app'
import { formatBytes } from '../components/DownloadUI'
import type { DownloadHistoryItem } from '@shared/types'

export function DownloadHistoryView() {
  const history = useAppStore(s => s.downloadHistory)
  const removeHistoryItem = useAppStore(s => s.removeDownloadHistoryItem)
  const clearHistory = useAppStore(s => s.clearDownloadHistory)
  const localDestRoot = useAppStore(s => s.localDestRoot)

  const [searchQuery, setSearchQuery] = useState('')

  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return history
    const q = searchQuery.toLowerCase().trim()
    return history.filter(
      item =>
        item.fileName.toLowerCase().includes(q) ||
        (item.courseName && item.courseName.toLowerCase().includes(q)) ||
        (item.filePath && item.filePath.toLowerCase().includes(q)) ||
        (item.cloudPath && item.cloudPath.toLowerCase().includes(q))
    )
  }, [history, searchQuery])

  const formatDate = (ts: number): string => {
    try {
      const d = new Date(ts)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    } catch {
      return ''
    }
  }

  const handleOpenPath = (path: string) => {
    void window.api.openPath(path)
  }

  const handleOpenExternal = (url: string) => {
    void window.api.openExternal(url)
  }

  const handleShowInFolder = (path: string) => {
    void window.api.showInFolder(path)
  }

  return (
    <div className="flex h-full flex-col p-6 max-w-6xl mx-auto w-full">
      {/* 顶部标题与工具栏 */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-border/40">
        <div>
          <h1 className="text-xl font-bold text-text-1 flex items-center gap-2">
            <span>已下载历史管理</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent font-semibold">
              {history.length} 项记录
            </span>
          </h1>
          <p className="text-xs text-text-3 mt-1">
            快速搜索已完成下载的文件，支持本地文件一键打开/定位，以及云盘文件的极速访问
          </p>
        </div>

        <div className="flex items-center gap-3">
          {localDestRoot && (
            <button
              type="button"
              onClick={() => handleOpenPath(localDestRoot)}
              className="px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-text-2 hover:text-text-1 text-xs font-medium transition-colors flex items-center gap-1.5"
            >
              <span>📂</span> 打开保存总目录
            </button>
          )}
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('确定要清空全部下载历史记录吗？（已下载的本地和云盘文件不会被删除）')) {
                  clearHistory()
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium transition-colors flex items-center gap-1.5"
            >
              <span>🧹</span> 清空历史
            </button>
          )}
        </div>
      </div>

      {/* 搜索过滤框 */}
      {history.length > 0 && (
        <div className="mb-4">
          <input
            type="text"
            placeholder="搜索文件名、课程名称、本地路径或云盘路径..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-surface-2 text-text-1 text-sm placeholder-text-3 border border-border/40 focus:outline-none focus:border-accent transition-colors"
          />
        </div>
      )}

      {/* 列表区域 */}
      <div className="flex-1 overflow-y-auto pr-1">
        {filteredHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-text-3 gap-3">
            <span className="text-4xl">📂</span>
            <p className="text-sm font-medium">
              {history.length === 0 ? '暂无已下载历史记录' : '未找到匹配的文件'}
            </p>
            <p className="text-xs text-text-3/70">
              {history.length === 0 ? '提交任务并下载完成后，记录会自动显示在这里' : '尝试更改搜索关键词'}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredHistory.map((item: DownloadHistoryItem) => {
              const isLocalOnly = !!item.filePath && !item.cloudPath
              const isCloudOnly = !item.filePath && !!item.cloudPath
              const isBoth = !!item.filePath && !!item.cloudPath
              const displayPath = item.filePath || item.cloudPath || ''

              return (
                <div
                  key={item.taskId || displayPath}
                  className="flex items-center justify-between p-3.5 rounded-xl bg-surface-2/60 hover:bg-surface-2 border border-border/30 transition-all group"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1 pr-4">
                    <div className="w-10 h-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0 text-lg">
                      {item.fileName.endsWith('.mp4') || item.fileName.endsWith('.ts') ? '🎥'
                        : item.fileName.endsWith('.pdf') ? '📄'
                        : item.fileName.endsWith('.m4a') || item.fileName.endsWith('.mp3') ? '🎵'
                        : '📁'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-text-1 text-sm truncate max-w-[320px] md:max-w-[450px]" title={item.fileName}>
                          {item.fileName}
                        </span>
                        {item.courseName && (
                          <span className="text-[11px] px-1.5 py-0.2 rounded bg-surface-3 text-text-2 shrink-0">
                            {item.courseName}
                          </span>
                        )}
                        {isCloudOnly && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-cloud/10 text-cloud font-medium shrink-0 flex items-center gap-0.5">
                            ☁️ 云端
                          </span>
                        )}
                        {isBoth && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-success/10 text-success font-medium shrink-0">
                            本地 + 云端
                          </span>
                        )}
                        {isLocalOnly && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-accent/10 text-accent font-medium shrink-0">
                            本地
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-3 truncate mt-0.5" title={displayPath}>
                        {displayPath}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right text-xs text-text-3">
                      {item.fileSize && <div>{formatBytes(item.fileSize)}</div>}
                      <div>{formatDate(item.completedAt)}</div>
                    </div>

                    <div className="flex items-center gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
                      {item.filePath && (
                        <button
                          type="button"
                          onClick={() => handleShowInFolder(item.filePath!)}
                          className="px-2.5 py-1.5 rounded-md bg-surface-3 hover:bg-accent/20 hover:text-accent text-text-2 text-xs font-medium transition-colors"
                          title="在资源管理器中高亮定位该本地文件"
                        >
                          定位
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (item.filePath) {
                            handleOpenPath(item.filePath)
                          } else {
                            handleOpenExternal('https://pan.sjtu.edu.cn/')
                          }
                        }}
                        className="px-2.5 py-1.5 rounded-md bg-accent text-white hover:bg-accent-light text-xs font-medium transition-colors"
                        title={item.filePath ? '用系统默认播放器或关联程序打开' : '在浏览器中打开交大网盘网页'}
                      >
                        {item.filePath ? '打开' : '访问云盘'}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeHistoryItem(item.taskId)}
                        className="p-1.5 text-text-3 hover:text-red-400 transition-colors text-xs"
                        title="从历史记录列表中移除"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
