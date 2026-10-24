import { useState, useMemo, useEffect } from 'react'
import { useAppStore } from '../store/app'
import { formatBytes } from '../components/DownloadUI'
import { formatDate } from '../../../shared/utils'
import { aggregateTaskState } from '../download/progress'
import type { TransferSpeed } from '@shared/types'

export function TransferCenter() {
  const history = useAppStore(s => s.downloadHistory)
  const removeHistoryItem = useAppStore(s => s.removeDownloadHistoryItem)
  const removeProgressItem = useAppStore(s => s.removeProgressItem)
  const clearHistory = useAppStore(s => s.clearDownloadHistory)
  const localDestRoot = useAppStore(s => s.localDestRoot)
  const progress = useAppStore(s => s.progress)
  const cloudLinkedIds = useAppStore(s => s.cloudLinkedIds)

  const [speed, setSpeed] = useState<TransferSpeed>({ down: 0, up: 0 })
  const [activeTab, setActiveTab] = useState<'active' | 'failed' | 'history'>(() => {
    const prog = useAppStore.getState().progress
    const hasActive = Object.values(prog).some(p =>
      (p.state === 'downloading' || p.state === 'pending' || p.state === 'paused') &&
      !p.taskId.endsWith('_cloud') && !p.taskId.includes('_scan_')
    )
    if (hasActive) return 'active'
    const hist = useAppStore.getState().downloadHistory
    const hasFinished = Object.values(prog).some(p =>
      (p.state === 'done' || p.state === 'skipped') &&
      !p.taskId.endsWith('_cloud') && !p.taskId.includes('_scan_')
    )
    if (hist.length > 0 || hasFinished) return 'history'
    return 'active'
  })

  useEffect(() => {
    return window.api.download.onTransferSpeed(s => setSpeed(s))
  }, [])

  // 聚合逻辑任务：过滤掉 both 模式下的 _cloud 镜像 ID 与内部扫描任务，合并为单个逻辑卡片。
  // [Bug Fix] 仅 both 模式下查镜像映射：cloudLinkedIds 里可能残留历史批次的陈旧
  // 映射（单模式批次不清理它），无守卫地查会把正在下载的单模式任务误聚合到
  // 陈旧 error 镜像上、显示成"传输失败"。与 useEffectiveProgress 同语义守卫。
  const downloadMode = useAppStore(s => s.downloadMode)
  const canvasCourses = useAppStore(s => s.canvasCourses)
  const logicalTasks = useMemo(() => {
    const entries = Object.entries(progress).filter(([id]) => !id.endsWith('_cloud') && !id.includes('_scan_'))
    return entries.map(([id, local]) => {
      const cloudId = downloadMode === 'both' ? cloudLinkedIds[id] : undefined
      const cloud = cloudId ? progress[cloudId] : undefined
      const aggregate = aggregateTaskState(local, cloud)

      // 解析课程名称：优先本地任务元数据，无则通过 ID 中的数字反查全局课程
      const courseIdMatch = id.match(/_(\d+)(?:_|$)/)
      const matchedCourse = courseIdMatch
        ? canvasCourses?.find(c => String(c.courseId) === courseIdMatch[1])
        : undefined
      const courseName = local.courseName || cloud?.courseName || matchedCourse?.name

      // 解析规范化文件名，消除裸露的数字 ID
      let fileName = local.fileName || cloud?.fileName || local.filePath?.split(/[\\/]/).pop()
      if (!fileName || /^\d+$/.test(fileName) || fileName === id) {
        if (id.includes('_ppt_')) {
          fileName = courseName ? `${courseName} · 课堂讲义 (PPT/PDF)` : '课堂讲义 (PPT/PDF)'
        } else if (id.includes('_assign_')) {
          fileName = courseName ? `${courseName} · 课程作业归档` : '课程作业归档'
        } else if (id.includes('_transcript_')) {
          fileName = courseName ? `${courseName} · 课堂逐字稿与字幕` : '课堂逐字稿与字幕'
        } else {
          fileName = id.split('_').pop() || id
        }
      }

      return {
        taskId: id,
        fileName,
        courseName,
        aggregate,
        isBoth: !!cloud
      }
    })
  }, [progress, cloudLinkedIds, downloadMode, canvasCourses])

  const activeTasks = useMemo(() => {
    return logicalTasks.filter(t => (
      t.aggregate.state === 'downloading' ||
      t.aggregate.state === 'pending' ||
      t.aggregate.state === 'paused'
    ))
  }, [logicalTasks])

  const failedTasks = useMemo(() => {
    return logicalTasks.filter(t => t.aggregate.state === 'error')
  }, [logicalTasks])

  // 兜底补齐：若当前会话内存中已有完成/跳过任务，但 downloadHistory 中未记录（如旧版本遗留未落盘）
  // 自动将其合入 downloadHistory，保证看板与顶栏计数完全一致
  useEffect(() => {
    const finishedLogical = logicalTasks.filter(t => t.aggregate.state === 'done' || t.aggregate.state === 'skipped')
    if (finishedLogical.length === 0) return

    const missing = finishedLogical.filter(lt => {
      const baseId = lt.taskId.replace(/_cloud$/, '')
      return !history.some(h => h.taskId.replace(/_cloud$/, '') === baseId)
    })

    if (missing.length > 0) {
      for (const item of missing) {
        const rawLocal = progress[item.taskId]
        const rawCloud = cloudLinkedIds[item.taskId] ? progress[cloudLinkedIds[item.taskId]] : undefined
        const fileSize = item.aggregate.total > 0
          ? item.aggregate.total
          : (item.aggregate.received > 0 ? item.aggregate.received : undefined)
        useAppStore.getState().addDownloadHistory({
          taskId: item.taskId,
          fileName: item.fileName,
          courseName: item.courseName,
          filePath: rawLocal?.filePath || rawCloud?.filePath,
          cloudPath: rawLocal?.cloudPath || rawCloud?.cloudPath,
          fileSize,
          completedAt: Date.now()
        })
      }
    }
  }, [logicalTasks, history, progress, cloudLinkedIds])

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

  const handleRetryAllFailed = () => {
    for (const task of failedTasks) {
      void window.api.download.resume(task.taskId)
    }
  }

  const handleCancelAllFailed = () => {
    for (const task of failedTasks) {
      // [Bug Fix] 先请求主进程 cancel（清理其 runtime / cookie / 队列条目），
      // 再本地删进度条目：提交失败等主进程不认识的任务 cancel 不会回发终态，
      // 若只等回声，行会永远留在「传输异常」里。本地删除兜底立即消失。
      void window.api.download.cancel(task.taskId).catch(() => {})
      removeProgressItem(task.taskId)
    }
  }

  const formatProgressCount = (task: { taskId: string; fileName: string; aggregate: { received: number; total: number } }) => {
    const { received, total } = task.aggregate
    const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0
    if (task.taskId.includes('_ppt_')) {
      return `第 ${received} / ${total} 讲 (${pct}%)`
    }
    if (task.taskId.includes('_assign_')) {
      return `已完成 ${received} / ${total} 项 (${pct}%)`
    }
    if (task.taskId.includes('_transcript_')) {
      return `第 ${received} / ${total} 讲 (${pct}%)`
    }
    if (total > 0 && total <= 500 && !task.fileName?.match(/\.(mp4|zip|rar|7z|tar|gz|iso|dmg|exe|mkv|mov|flv|avi)$/i)) {
      return `已完成 ${received} / ${total} 项 (${pct}%)`
    }
    return `${formatBytes(received)} / ${formatBytes(total)} (${pct}%)`
  }

  const renderFileIcon = (filename: string, taskId?: string) => {
    let ext = filename.split('.').pop()?.toUpperCase() || ''
    if (!ext || ext === filename.toUpperCase() || ext.length > 5 || /^\d+$/.test(ext)) {
      if (taskId?.includes('_ppt_')) ext = 'PPT'
      else if (taskId?.includes('_assign_')) ext = '作业'
      else if (taskId?.includes('_transcript_')) ext = 'AI'
      else if (taskId?.includes('_video_') || taskId?.includes('_mvid_')) ext = 'MP4'
      else ext = '文件'
    }

    const isPpt = ext === 'PPT' || ext === 'PDF'
    const isMedia = ext === 'MP4' || ext === 'AI' || ext === '作业'
    const bgClass = isPpt
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
      : isMedia
      ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20'
      : 'bg-accent/10 text-accent border border-accent/20'

    return (
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-mono text-xs font-bold shadow-2xs ${bgClass}`}>
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
            <span className="text-xs text-text-3">活跃传输</span>
            <span className="font-mono text-sm font-bold text-accent">{activeTasks.length}</span>
          </div>

          <div className="flex items-center gap-2 rounded-xl bg-surface-3 px-3 py-1.5 shadow-sm">
            <span className="text-xs text-text-3">下载速度</span>
            <span className="font-mono text-sm font-bold text-text-1">
              {speed.down > 0 ? `${formatBytes(speed.down)}/s` : '0 B/s'}
            </span>
          </div>

          {speed.up > 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-surface-3 px-3 py-1.5 shadow-sm">
              <span className="text-xs text-text-3">上传速度</span>
              <span className="font-mono text-sm font-bold text-sky-600 dark:text-sky-400">
                {`${formatBytes(speed.up)}/s`}
              </span>
            </div>
          )}

          <div className="h-4 w-px bg-bd" />

          {/* 切换 Tab */}
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
              正在传输 ({activeTasks.length})
            </button>
            {failedTasks.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('failed')}
                className={`rounded-lg px-3.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'failed'
                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 shadow-2xs'
                    : 'text-rose-500 hover:text-rose-600'
                }`}
              >
                传输异常 ({failedTasks.length})
              </button>
            )}
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

        {/* 顶部右侧操作栏 */}
        <div className="flex items-center gap-2">
          {activeTab === 'active' && (
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
          )}

          {activeTab === 'failed' && (
            <>
              <button
                type="button"
                onClick={handleCancelAllFailed}
                className="rounded-xl border border-bd bg-surface-1 px-3.5 py-1.5 text-xs font-medium text-text-2 transition-all hover:bg-surface-3 hover:text-text-1 shadow-2xs cursor-pointer active:scale-[0.98]"
              >
                全部移除
              </button>
              <button
                type="button"
                onClick={handleRetryAllFailed}
                className="rounded-xl bg-accent px-3.5 py-1.5 text-xs font-medium text-white shadow-2xs transition-all hover:bg-accent-light cursor-pointer active:scale-[0.98]"
              >
                全部重试
              </button>
            </>
          )}

          {activeTab === 'history' && (
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
        {/* 正在传输空态 */}
        {activeTab === 'active' && activeTasks.length === 0 && (
          <div className="flex h-64 flex-col items-center justify-center text-sm text-text-3">
            <div className="text-3xl mb-2">📥</div>
            <span>暂无正在进行的传输任务</span>
            {history.length > 0 ? (
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-surface-3 px-4 py-2 text-xs font-semibold text-accent hover:bg-surface-4 transition-all shadow-2xs cursor-pointer"
              >
                查看已完成记录 ({history.length} 项) ›
              </button>
            ) : (
              <span className="text-xs text-text-4 mt-1">在课程页面勾选课件或视频后点击「立即下载」即可开始传输</span>
            )}
          </div>
        )}

        {/* 正在传输列表 */}
        {activeTab === 'active' && (
          <div className="space-y-3">
            {activeTasks.map(task => {
              const agg = task.aggregate
              const pct = agg.total > 0 ? Math.min(100, Math.round((agg.received / agg.total) * 100)) : 0
              return (
                <div key={task.taskId} className="flex items-center gap-4 rounded-2xl border border-bd bg-surface-2 p-4 shadow-card">
                  {renderFileIcon(task.fileName, task.taskId)}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-sm font-semibold text-text-1" title={task.fileName}>
                          {task.fileName}
                        </span>
                        {task.courseName && (
                          <span className="shrink-0 rounded-md bg-surface-3 px-2 py-0.5 text-2xs text-text-2 font-medium border border-bd/60">
                            {task.courseName}
                          </span>
                        )}
                        {task.isBoth && (
                          <span className="shrink-0 rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 px-1.5 py-0.5 text-2xs font-medium border border-sky-500/20">
                            本地+云盘
                          </span>
                        )}
                        {agg.phase === 'uploading' && (
                          <span className="shrink-0 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 text-2xs font-medium border border-amber-500/20">
                            ☁ 上传中
                          </span>
                        )}
                      </div>
                      <span className="ml-3 shrink-0 font-mono text-xs font-medium text-text-2">
                        {formatProgressCount(task)}
                      </span>
                    </div>

                    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          agg.phase === 'uploading' ? 'bg-amber-500' : 'bg-accent'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="mt-1.5 flex items-center justify-between text-xs text-text-2">
                      <span className="truncate font-medium">
                        {agg.message || (agg.phase === 'uploading' ? '正在上传至交大云盘…' : '正在下载…')}
                      </span>
                      {agg.phase === 'uploading' && (
                        <span className="shrink-0 text-amber-600 dark:text-amber-400 font-semibold text-2xs ml-2">本地已就绪</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {agg.state === 'paused' ? (
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

        {/* 传输异常列表 */}
        {activeTab === 'failed' && (
          <div className="space-y-3">
            {failedTasks.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center text-sm text-text-3">
                <div className="text-3xl mb-2">🎉</div>
                <span>没有传输失败的任务</span>
              </div>
            ) : (
              failedTasks.map(task => (
                <div key={task.taskId} className="flex items-center gap-4 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 shadow-card">
                  {renderFileIcon(task.fileName, task.taskId)}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-sm font-semibold text-text-1" title={task.fileName}>
                          {task.fileName}
                        </span>
                        {task.courseName && (
                          <span className="shrink-0 rounded-md bg-surface-3 px-2 py-0.5 text-2xs text-text-2 font-medium border border-bd/60">
                            {task.courseName}
                          </span>
                        )}
                      </div>
                      <span className="ml-3 shrink-0 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 px-2 py-0.5 text-2xs font-semibold">
                        传输失败
                      </span>
                    </div>

                    <div className="text-xs text-rose-600 dark:text-rose-400 truncate">
                      {task.aggregate.message || '网络连接超时或目标服务异常'}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void window.api.download.resume(task.taskId)}
                      className="rounded-xl bg-accent px-3 py-1 text-xs font-medium text-white shadow-2xs hover:bg-accent-light transition-all cursor-pointer active:scale-[0.98]"
                    >
                      重试
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // [Bug Fix] 同 handleCancelAllFailed：cancel + 本地删条目双保险
                        void window.api.download.cancel(task.taskId).catch(() => {})
                        removeProgressItem(task.taskId)
                      }}
                      className="rounded-xl border border-bd bg-surface-1 px-3 py-1 text-xs font-medium text-text-2 hover:bg-surface-3 hover:text-text-1 transition-all cursor-pointer shadow-2xs active:scale-[0.98]"
                    >
                      移除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 已完成历史空态 */}
        {activeTab === 'history' && history.length === 0 && (
          <div className="flex h-64 flex-col items-center justify-center text-sm text-text-3">
            <div className="text-3xl mb-2">📋</div>
            <span>暂无已下载历史记录</span>
          </div>
        )}

        {/* 已完成历史列表 */}
        {activeTab === 'history' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {history.map(item => (
              <div key={item.taskId} className="flex items-center gap-3.5 rounded-2xl border border-bd bg-surface-2 p-4 shadow-card">
                {renderFileIcon(item.fileName, item.taskId)}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0 mb-1">
                    <span className="truncate text-sm font-semibold text-text-1" title={item.fileName}>
                      {item.fileName}
                    </span>
                    {item.courseName && (
                      <span className="shrink-0 rounded-md bg-surface-3 px-2 py-0.5 text-2xs text-text-2 font-medium border border-bd/60">
                        {item.courseName}
                      </span>
                    )}
                    {item.cloudPath && !item.filePath && (
                      <span className="shrink-0 rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 px-1.5 py-0.5 text-2xs font-medium border border-sky-500/20">
                        云盘/服务器
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-3 font-mono">
                    <span>{item.fileSize ? formatBytes(item.fileSize) : '传输完成'}</span>
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
