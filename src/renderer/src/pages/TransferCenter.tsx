import { useState, useMemo, useEffect } from 'react'
import { useAppStore } from '../store/app'
import { formatBytes } from '../components/DownloadUI'
import { formatDate } from '../../../shared/utils'
import type { TransferSpeed } from '@shared/types'

export function TransferCenter({ onBack: _onBack }: { onBack?: () => void } = {}) {
  const history = useAppStore(s => s.downloadHistory)
  const removeHistoryItem = useAppStore(s => s.removeDownloadHistoryItem)
  const clearHistory = useAppStore(s => s.clearDownloadHistory)
  const localDestRoot = useAppStore(s => s.localDestRoot)
  const progress = useAppStore(s => s.progress)
  
  const [speed, setSpeed] = useState<TransferSpeed>({ down: 0, up: 0 })
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active')

  useEffect(() => {
    return window.api.download.onTransferSpeed(s => setSpeed(s))
  }, [])

  const activeTasks = useMemo(() => {
    return Object.values(progress).filter(p => p.state === 'downloading' || p.state === 'pending' || p.state === 'paused')
  }, [progress])

  const handleOpenDownloadFolder = async (): Promise<void> => {
    let target = localDestRoot
    if (!target && window.api?.getDefaultDownloadsDir) {
      target = await window.api.getDefaultDownloadsDir()
    }
    if (target) {
      void window.api.openPath(target)
    }
  }

  const handleShowInFolder = (path: string) => {
    void window.api.showInFolder(path)
  }

  const renderFileIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toUpperCase() || 'FILE'
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 font-mono text-xs font-bold text-accent">
        {ext}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-surface-1">
      {/* 顶部实时速率与操作看板 */}
      <div className="flex shrink-0 items-center justify-between border-b border-bd bg-surface-2 px-6 py-3.5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded-xl bg-surface-3 px-3 py-1.5 shadow-sm">
            <span className="text-xs text-text-3">活跃并发</span>
            <span className="font-mono text-sm font-bold text-accent">{activeTasks.length}</span>
          </div>

          <div className="flex items-center gap-2 rounded-xl bg-surface-3 px-3 py-1.5 shadow-sm">
            <span className="text-xs text-text-3">总下载速度</span>
            <span className="font-mono text-sm font-bold text-text-1">
              {speed.down > 0 ? `${formatBytes(speed.down)}/s` : '0 B/s'}
            </span>
          </div>

          <div className="h-4 w-px bg-bd" />

          <div className="flex items-center gap-1 rounded-xl bg-surface-3 p-1 shadow-2xs">
            <button
              type="button"
              onClick={() => setActiveTab('active')}
              className={`rounded-lg px-3.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'active'
                  ? 'bg-surface-1 text-text-1 shadow-2xs'
                  : 'text-text-3 hover:text-text-2'
              }`}
            >
              正在下载 ({activeTasks.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`rounded-lg px-3.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-surface-1 text-text-1 shadow-2xs'
                  : 'text-text-3 hover:text-text-2'
              }`}
            >
              已完成历史 ({history.length})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'active' ? (
            <>
              <button
                type="button"
                onClick={() => void window.api.download.pauseAll()}
                className="rounded-xl border border-bd bg-surface-1 px-3.5 py-1.5 text-xs font-medium text-text-2 transition-all hover:bg-surface-3 hover:text-text-1 shadow-2xs cursor-pointer active:scale-[0.98]"
              >
                全部暂停
              </button>
              <button
                type="button"
                onClick={() => void window.api.download.resumeAll()}
                className="rounded-xl bg-accent px-3.5 py-1.5 text-xs font-medium text-white shadow-2xs transition-all hover:bg-accent-light cursor-pointer active:scale-[0.98]"
              >
                全部继续
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={clearHistory}
                className="rounded-xl border border-bd bg-surface-1 px-3.5 py-1.5 text-xs font-medium text-text-2 transition-all hover:bg-surface-3 hover:text-text-1 shadow-2xs cursor-pointer active:scale-[0.98]"
              >
                清空已完成
              </button>
              <button
                type="button"
                onClick={() => void handleOpenDownloadFolder()}
                className="rounded-xl bg-accent px-3.5 py-1.5 text-xs font-medium text-white shadow-2xs transition-all hover:bg-accent-light cursor-pointer active:scale-[0.98]"
              >
                打开下载文件夹
              </button>
            </>
          )}
        </div>
      </div>

      {/* 主体任务列表区 */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'active' && activeTasks.length === 0 && (
          <div className="flex h-64 flex-col items-center justify-center text-sm text-text-3">
            <div className="text-3xl mb-2">📥</div>
            <span>暂无正在进行的下载任务</span>
            <span className="text-xs text-text-4 mt-1">在课程页面勾选课件或视频后点击「立即下载」即可开始传输</span>
          </div>
        )}
        
        {activeTab === 'active' && (
          <div className="space-y-3">
            {activeTasks.map(task => {
              const name = task.filePath?.split(/[\\/]/).pop() || task.taskId.split('_').pop() || task.taskId
              const pct = task.total > 0 ? Math.min(100, Math.round((task.received / task.total) * 100)) : 0
              return (
                <div key={task.taskId} className="flex items-center gap-4 rounded-2xl border border-bd bg-surface-2 p-4 shadow-card">
                  {renderFileIcon(name)}
                  
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="truncate text-sm font-semibold text-text-1" title={name}>{name}</span>
                      <span className="ml-3 shrink-0 font-mono text-xs text-text-3">
                        {formatBytes(task.received)} / {formatBytes(task.total)} ({pct}%)
                      </span>
                    </div>

                    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full rounded-full bg-accent transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    {task.message && (
                      <div className="mt-1.5 text-[11px] text-text-3 truncate">{task.message}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {task.state === 'paused' ? (
                      <button
                        type="button"
                        onClick={() => void window.api.download.resume(task.taskId)}
                        className="rounded-xl bg-accent px-3 py-1 text-xs font-medium text-white shadow-2xs hover:bg-accent-light transition-all cursor-pointer active:scale-[0.98]"
                      >
                        继续
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void window.api.download.pause(task.taskId)}
                        className="rounded-xl border border-bd bg-surface-1 px-3 py-1 text-xs font-medium text-text-2 hover:bg-surface-3 hover:text-text-1 transition-all cursor-pointer shadow-2xs active:scale-[0.98]"
                      >
                        暂停
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void window.api.download.cancel(task.taskId)}
                      className="rounded-xl border border-rose/30 bg-rose/10 px-3 py-1 text-xs font-medium text-rose hover:bg-rose/20 transition-all cursor-pointer shadow-2xs active:scale-[0.98]"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {activeTab === 'history' && history.length === 0 && (
          <div className="flex h-64 flex-col items-center justify-center text-sm text-text-3">
            <div className="text-3xl mb-2">📋</div>
            <span>暂无已下载历史记录</span>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {history.map(item => (
              <div key={item.taskId} className="flex items-center justify-between rounded-2xl border border-bd bg-surface-2 p-4 shadow-card">
                <div className="min-w-0 flex-1 mr-3">
                  <div className="truncate text-sm font-semibold text-text-1" title={item.fileName}>
                    {item.fileName}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-text-3">
                    <span>{item.fileSize ? formatBytes(item.fileSize) : '未知大小'}</span>
                    <span>·</span>
                    <span>{formatDate(item.completedAt)}</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 shrink-0">
                  {item.filePath && (
                    <button
                      type="button"
                      onClick={() => handleShowInFolder(item.filePath!)}
                      className="rounded-xl border border-bd bg-surface-1 px-3.5 py-1.5 text-xs font-medium text-text-2 transition-all hover:bg-surface-3 hover:text-text-1 shadow-2xs cursor-pointer active:scale-[0.98]"
                    >
                      在文件夹中显示
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeHistoryItem(item.taskId)}
                    className="p-1.5 text-xs text-text-4 hover:text-rose transition cursor-pointer"
                    title="移除记录"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
