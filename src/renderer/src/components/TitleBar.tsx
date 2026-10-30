import { useClickOutside } from '../hooks/useClickOutside'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore, type Theme } from '../store/app'
import { Segmented, type SegmentedOption } from './Segmented'
import { formatBytes } from './DownloadUI'
import { handleWindowAction } from './WindowConfirmModal'
import type { UpdateCheckResult, UpdateProgress } from '@shared/types'

/** 应用主题：直接设置 data-theme，瞬时切换（无过渡动画）。 */
function applyTheme(theme: Theme): void {
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme
  document.documentElement.setAttribute('data-theme', resolved)
  if (resolved === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
  window.api.setTheme(resolved).catch(() => undefined)
}

export { applyTheme }

const HEADER_CAPSULE_BASE_CLS =
  'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all shadow-2xs cursor-pointer active:scale-[0.98]'
const HEADER_CAPSULE_ACTIVE_CLS =
  'bg-accent text-white border-accent shadow-glow-sm'
const HEADER_CAPSULE_INACTIVE_CLS =
  'border-bd bg-surface-2 text-text-2 hover:bg-surface-1 hover:border-bd-strong hover:text-text-1'

export function TitleBar({
  onOpenSettings,
  onOpenTransfer
}: {
  onOpenSettings?: () => void
  onOpenTransfer?: () => void
}) {
  const stage = useAppStore(s => s.stage)
  const activeTab = useAppStore(s => s.activeTab)
  const lastCourseTab = useAppStore(s => s.lastCourseTab)
  const setActiveTab = useAppStore(s => s.setActiveTab)
  const cloudUserToken = useAppStore(s => s.cloudUserToken)
  const cloudConnStatus = useAppStore(s => s.cloudConnStatus)
  const progress = useAppStore(s => s.progress)

  const [speed, setSpeed] = useState<{ down: number; up: number }>({ down: 0, up: 0 })
  const [recoverableCount, setRecoverableCount] = useState(0)
  const [updateCourseCount, setUpdateCourseCount] = useState(0)
  useEffect(() => {
    if (stage !== 'browser' || !window.api.backup) return
    let mounted = true
    const refresh = (): void => { void window.api.backup.status().then(s => { if (mounted) { setRecoverableCount(s.recoverableCount || 0); setUpdateCourseCount(s.updateCourseCount || 0) } }).catch(() => {}) }
    refresh()
    const unsubscribe = window.api.backup.onChanged(refresh)
    return () => { mounted = false; unsubscribe() }
  }, [stage])
  useEffect(() => {
    return window.api.download.onTransferSpeed(s => setSpeed(s))
  }, [])

  const activeItems = useMemo(
    () => Object.values(progress).filter(
      p => (p.state === 'downloading' || p.state === 'pending' || p.state === 'paused') &&
        !p.taskId.endsWith('_cloud') && !p.taskId.includes('_scan_')
    ),
    [progress]
  )
  const activeCount = activeItems.length

  const doneCount = useMemo(
    () => Object.values(progress).filter(
      p => (p.state === 'done' || p.state === 'skipped') &&
        !p.taskId.endsWith('_cloud') && !p.taskId.includes('_scan_')
    ).length,
    [progress]
  )

  const overallPct = useMemo(() => {
    if (activeCount === 0) return 0
    let totalBytes = 0
    let receivedBytes = 0
    for (const item of activeItems) {
      if (item.total > 0) {
        totalBytes += item.total
        receivedBytes += item.received
      }
    }
    if (totalBytes > 0) {
      return Math.min(99, Math.round((receivedBytes / totalBytes) * 100))
    }
    return 0
  }, [activeItems, activeCount])

  const isMac = window.api.platform === 'darwin'

  // 课程与学业日程内容源，与全局系统传输中心/设置严格解耦
  const tabOptions: SegmentedOption<string>[] = [
    { key: 'canvas', label: 'Canvas 课程' },
    { key: 'audited', label: '旁听课程' },
    { key: 'cnmooc', label: '好大学在线' },
    { key: 'schedule', label: '课表与日程' }
  ]

  const isDetailView = activeTab === 'settings' || activeTab === 'transfer' || activeTab === 'cloudpan' || activeTab === 'library'

  return (
    <div
      className={`drag-region flex h-14 select-none items-center border-b border-bd bg-surface-3 text-sm text-text-2 ${
        isMac ? 'pl-[80px] pr-4' : 'pl-4 pr-0'
      }`}
    >
      {stage === 'browser' && (
        isDetailView ? (
          <div className="no-drag flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setActiveTab(lastCourseTab || 'canvas')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-bd bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-1 hover:border-bd-strong hover:bg-surface-1 transition-all shadow-2xs cursor-pointer"
              title="返回课程列表"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5m7 7l-7-7 7-7" />
              </svg>
              <span>返回课程</span>
            </button>
            <span className="text-text-4 font-mono text-xs">/</span>
            <span className="text-xs font-semibold text-text-1">
              {activeTab === 'library' ? '资源库' : activeTab === 'transfer' ? '📥 传输中心' : activeTab === 'cloudpan' ? '☁️ 交大云盘' : '⚙️ 全局设置'}
            </span>
          </div>
        ) : (
          <div className="no-drag flex h-full items-end">
            <Segmented 
              options={tabOptions} 
              value={activeTab} 
              onChange={(v) => {
                setActiveTab(v as any)
              }} 
              size="lg" 
              className="mb-2"
            />
          </div>
        )
      )}

      <div className="flex-1" />
      
      {stage === 'browser' && (
        <div className={`no-drag flex items-center gap-3 ${!isMac ? 'mr-3' : ''}`}>
          {/* 资源库快速入口胶囊 */}
          <button
            type="button"
            aria-label={`资源库${updateCourseCount ? `，${updateCourseCount} 门收藏课程有待下载更新` : ''}`}
            title={activeTab === 'library' ? '点击返回课程列表' : '收藏课程与待下载更新'}
            onClick={() => setActiveTab(activeTab === 'library' ? lastCourseTab || 'canvas' : 'library')}
            className={`${HEADER_CAPSULE_BASE_CLS} ${
              activeTab === 'library' ? HEADER_CAPSULE_ACTIVE_CLS : HEADER_CAPSULE_INACTIVE_CLS
            }`}
          >
            <span aria-hidden="true">▤</span>
            <span>资源库</span>
            {updateCourseCount > 0 && (
              <span
                className={`rounded-full px-1.5 font-mono text-2xs ${
                  activeTab === 'library' ? 'bg-white/20 text-white' : 'bg-accent/15 text-accent'
                }`}
              >
                {updateCourseCount}
              </span>
            )}
          </button>

          {/* 交大云盘快速入口胶囊 */}
          <button
            type="button"
            onClick={() => {
              if (!cloudUserToken) {
                setActiveTab('settings')
              } else if (activeTab === 'cloudpan') {
                setActiveTab(lastCourseTab || 'canvas')
              } else {
                setActiveTab('cloudpan')
              }
            }}
            className={`${HEADER_CAPSULE_BASE_CLS} ${
              activeTab === 'cloudpan'
                ? HEADER_CAPSULE_ACTIVE_CLS
                : cloudUserToken
                  ? HEADER_CAPSULE_INACTIVE_CLS
                  : 'border-bd bg-surface-2 text-text-3 hover:bg-surface-1 hover:border-bd-strong hover:text-text-2'
            }`}
            title={
              !cloudUserToken
                ? '交大云盘未连接，点击前往设置授权'
                : activeTab === 'cloudpan'
                  ? '点击返回课程列表'
                  : '交大云盘已连接，点击打开云盘资源管理器'
            }
          >
            {cloudConnStatus === 'connecting' ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-info opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-info" />
                </span>
                <span>云盘连接中...</span>
              </>
            ) : cloudUserToken ? (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-success" />
                <span>☁️ 交大云盘</span>
              </>
            ) : (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-surface-4" />
                <span>☁️ 连接云盘</span>
              </>
            )}
          </button>

          {/* 全局传输看板胶囊入口 */}
          <button
            type="button"
            onClick={onOpenTransfer}
            className={`${HEADER_CAPSULE_BASE_CLS} ${
              activeTab === 'transfer'
                ? HEADER_CAPSULE_ACTIVE_CLS
                : activeCount > 0
                  ? 'border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 hover:border-accent/50'
                  : HEADER_CAPSULE_INACTIVE_CLS
            }`}
            title={`传输中心：${recoverableCount ? `${recoverableCount} 项任务待恢复 · ` : ''}${activeCount > 0 ? `${activeCount} 项任务进行中` : '查看传输队列与历史'}`}
          >
            {activeCount > 0 ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
                </span>
                <span>
                  📥 传输 ({activeCount} 项
                  {speed.down > 1024 ? ` · ↓ ${formatBytes(speed.down)}/s` : ''}
                  {overallPct > 0 ? ` · ${overallPct}%` : ''})
                </span>
              </>
            ) : (
              <>
                <span>📥 传输中心</span>
                {recoverableCount > 0 && (
                  <span
                    className={`rounded-full px-1.5 font-mono text-2xs ${
                      activeTab === 'transfer' ? 'bg-white/20 text-white' : 'bg-danger text-white'
                    }`}
                  >
                    {recoverableCount}
                  </span>
                )}
                {doneCount > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 font-mono text-2xs ${
                      activeTab === 'transfer' ? 'bg-white/20 text-white' : 'bg-surface-3 text-text-3'
                    }`}
                  >
                    {doneCount}
                  </span>
                )}
              </>
            )}
          </button>

          <UpdateBadge />

          <button
            type="button"
            onClick={onOpenSettings}
            className={`${HEADER_CAPSULE_BASE_CLS} ${
              activeTab === 'settings' ? HEADER_CAPSULE_ACTIVE_CLS : HEADER_CAPSULE_INACTIVE_CLS
            }`}
            title={activeTab === 'settings' ? '点击返回课程列表' : '全局设置与偏好'}
          >
            <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0 2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>设置</span>
          </button>
        </div>
      )}

      {/* Windows / Linux 右上角原生风格窗口控制三键 */}
      {!isMac && <WindowsCaptionButtons />}
    </div>
  )
}

// ─── Windows / Linux 原生风格窗口控制三键 ─────────────────────

/** Windows / Linux 原生风格窗口控制三键：最小化 [-]、最大化/还原 [□/❐]、关闭 [×]
 *  放置在标题栏最右侧，高度占满 h-full，关闭键 hover 呈现标准红底高亮 (#E81123)。 */
function WindowsCaptionButtons() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const sync = (): void => { void window.api.window.isMaximized().then(r => setMaximized(r.maximized)) }
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  return (
    <div className="no-drag flex h-full items-stretch self-stretch">
      {/* 最小化 */}
      <button
        type="button"
        title="最小化"
        onClick={() => void handleWindowAction('minimize')}
        className="flex w-12 items-center justify-center text-text-3 hover:bg-surface-2 hover:text-text-1 active:bg-surface-4 transition-colors cursor-pointer"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M1 5.5h8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      </button>

      {/* 最大化 / 还原 */}
      <button
        type="button"
        title={maximized ? '向下还原' : '最大化'}
        onClick={() => void window.api.window.toggleMaximize()}
        className="flex w-12 items-center justify-center text-text-3 hover:bg-surface-2 hover:text-text-1 active:bg-surface-4 transition-colors cursor-pointer"
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M3 2.5V1.5H8.5V7H7.5" />
            <rect x="1.5" y="3" width="6" height="6" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="1.5" y="1.5" width="7" height="7" />
          </svg>
        )}
      </button>

      {/* 关闭 */}
      <button
        type="button"
        title="关闭"
        onClick={() => void handleWindowAction('close')}
        className="flex w-12 items-center justify-center text-text-3 hover:bg-[#E81123] hover:text-white active:bg-[#C42B1C] transition-colors cursor-pointer"
      >
        <svg width="10" height="10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
          <line x1="2" y1="2" x2="8" y2="8" />
          <line x1="8" y1="2" x2="2" y2="8" />
        </svg>
      </button>
    </div>
  )
}

/** 新版本提醒徽章：启动时检查 GitHub releases/latest，有新版显示在标题旁。
 *  支持应用内自动更新：下载安装包 → 静默安装 → 退出当前进程释放文件锁 → 安装器启动新版本。
 *  状态机：idle（有新版待下载）→ downloading → ready（可安装）→ installUpdate 后 app.quit；
 *  任何阶段失败 → failed（重试 / 前往下载兜底）。
 *  autoDownloadUpdate 开启时 mount 自动下载，下载完停在 ready 等用户确认（不自动重启打断使用）。
 *  网络失败/无新版时静默不显示；主进程 1h 缓存节流避免重复请求。 */
function UpdateBadge() {
  const [info, setInfo] = useState<UpdateCheckResult | null>(null)
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'ready' | 'failed'>('idle')
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const autoDownloadUpdate = useAppStore(s => s.autoDownloadUpdate)
  const setAutoDownloadUpdate = useAppStore(s => s.setAutoDownloadUpdate)

  const startDownload = (): void => {
    setProgress(null)
    setError(null)
    setPhase('downloading')
    void window.api.downloadUpdate()
  }

  useEffect(() => {
    let cancelled = false
    void window.api.checkUpdate().then(r => {
      if (cancelled) return
      setInfo(r)
      // 自动下载：开启且当前平台有匹配资产时，mount 即开始下载
      if (r.hasUpdate && r.asset && autoDownloadUpdate) startDownload()
    }).catch(() => undefined)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 订阅主进程下载事件驱动状态机
  useEffect(() => {
    const offP = window.api.onUpdateProgress(p => { setProgress(p); setPhase('downloading') })
    const offR = window.api.onUpdateReady(() => { setPhase('ready'); setProgress(null) })
    const offF = window.api.onUpdateFailed(e => { setPhase('failed'); setError(e.error) })
    return () => { offP(); offR(); offF() }
  }, [])

  useClickOutside(ref, () => setOpen(false), { enabled: open })

  if (!info?.hasUpdate || !info.latestVersion) return null

  const hasAsset = !!info.asset
  const badgeText =
    phase === 'downloading'
      ? (progress?.percent ? `下载 ${Math.round(progress.percent)}%` : '下载中…')
      : phase === 'ready' ? '已就绪'
        : phase === 'failed' ? '更新失败'
          : `新版 v${info.latestVersion}`

  return (
    <div className="relative no-drag" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 rounded-full bg-accent-15 px-2 py-0.5 text-2xs font-medium text-accent-light ring-1 ring-accent-25 transition-all hover:bg-accent-20"
        title={`检测到新版本 v${info.latestVersion}（当前 v${info.currentVersion}），点击查看`}
      >
        <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-accent">
          <span className="absolute inset-0 animate-pulse rounded-full bg-accent opacity-60" />
        </span>
        {badgeText}
      </button>
      {open && (
        <div className="animate-fadeIn absolute left-0 top-full z-50 mt-2 w-72 rounded-xl border border-bd-strong bg-surface-1 p-4 text-xs leading-relaxed text-text-2 shadow-2xl">
          <div className="mb-1 text-sm font-semibold text-text-1">发现新版本</div>
          <div className="mb-2 text-text-3">
            v{info.currentVersion} → <span className="font-medium text-accent-light">v{info.latestVersion}</span>
          </div>

          {/* idle / failed：显示 release notes */}
          {(phase === 'idle' || phase === 'failed') && info.releaseNotes && (
            <div className="mb-3 max-h-32 overflow-y-auto rounded-lg bg-surface-3 p-2 text-2xs text-text-3">
              <pre className="whitespace-pre-wrap font-sans">{info.releaseNotes}</pre>
            </div>
          )}

          {/* failed 错误文案 */}
          {phase === 'failed' && error && (
            <div className="mb-3 rounded-lg bg-surface-3 p-2 text-2xs text-text-3">{error}</div>
          )}

          {/* downloading 进度条 */}
          {phase === 'downloading' && (
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between text-2xs text-text-3">
                <span>正在下载更新…</span>
                <span className="font-mono">
                  {progress?.percent ? `${Math.round(progress.percent)}%` : ''}
                  {progress?.total
                    ? ` · ${formatBytes(progress.loaded)}/${formatBytes(progress.total)}`
                    : progress?.loaded ? ` · ${formatBytes(progress.loaded)}` : ''}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${progress?.percent ?? 0}%` }}
                />
              </div>
            </div>
          )}

          {/* idle：立即安装 + 自动下载开关 + 前往下载兜底 */}
          {phase === 'idle' && (
            <>
              <button
                type="button"
                onClick={startDownload}
                disabled={!hasAsset}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-semibold text-white shadow-glow-sm transition-all hover:bg-accent-light active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {hasAsset ? '立即安装' : '当前平台暂不支持自动更新'}
              </button>
              {hasAsset && (
                <label className="mt-2 flex items-center gap-1.5 text-2xs text-text-3">
                  <input
                    type="checkbox"
                    checked={autoDownloadUpdate}
                    onChange={e => {
                      setAutoDownloadUpdate(e.target.checked)
                      if (e.target.checked) startDownload()
                    }}
                    className="accent-accent"
                  />
                  以后检测到新版自动下载
                </label>
              )}
              <button
                type="button"
                onClick={() => { if (info.releaseUrl) void window.api.openExternal(info.releaseUrl) }}
                className="mt-2 inline-flex h-7 w-full items-center justify-center gap-1.5 text-2xs text-text-4 transition-colors hover:text-text-2"
              >
                浏览器打开 GitHub Releases
              </button>
            </>
          )}

          {/* downloading：取消 */}
          {phase === 'downloading' && (
            <button
              type="button"
              onClick={() => { void window.api.cancelUpdate(); setPhase('idle'); setProgress(null) }}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-bd bg-surface-2 px-3 text-xs font-medium text-text-2 transition-all hover:bg-surface-3"
            >
              取消下载
            </button>
          )}

          {/* ready：立即安装并重启（主进程 spawn 安装器后 app.quit） */}
          {phase === 'ready' && (
            <button
              type="button"
              onClick={() => { void window.api.installUpdate() }}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-semibold text-white shadow-glow-sm transition-all hover:bg-accent-light active:scale-[0.98]"
            >
              立即安装并重启
            </button>
          )}

          {/* failed：重试 + 前往下载兜底 */}
          {phase === 'failed' && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={startDownload}
                disabled={!hasAsset}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-semibold text-white shadow-glow-sm transition-all hover:bg-accent-light active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                重试下载
              </button>
              <button
                type="button"
                onClick={() => { if (info.releaseUrl) void window.api.openExternal(info.releaseUrl) }}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-bd bg-surface-2 px-3 text-xs font-medium text-text-2 transition-all hover:bg-surface-3"
              >
                前往下载
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


