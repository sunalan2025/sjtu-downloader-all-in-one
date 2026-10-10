import { useEffect, useRef, useState } from 'react'
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
  window.api.setTheme(resolved).catch(() => undefined)
}

export { applyTheme }

const THEME_OPTIONS: SegmentedOption<Theme>[] = [
  {
    key: 'dark',
    title: '深色主题',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    )
  },
  {
    key: 'light',
    title: '浅色主题',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
    )
  },
  {
    key: 'system',
    title: '跟随系统',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    )
  }
]

export function TitleBar({ onLogout, onOpenSettings }: { onLogout?: () => void, onOpenSettings?: () => void }) {
  const theme = useAppStore(s => s.theme)
  const setTheme = useAppStore(s => s.setTheme)
  const stage = useAppStore(s => s.stage)
  const auth = useAppStore(s => s.auth)
  const activeTab = useAppStore(s => s.activeTab)
  const setActiveTab = useAppStore(s => s.setActiveTab)
  const cloudConnStatus = useAppStore(s => s.cloudConnStatus)

  const isMac = window.api.platform === 'darwin'

  const onSelectTheme = (key: Theme): void => {
    setTheme(key)
    applyTheme(key)
  }

  const tabOptions: SegmentedOption<string>[] = [
    { key: 'canvas', label: 'Canvas 课程' },
    { key: 'audited', label: '课堂实录 (v.sjtu)' },
    { key: 'cnmooc', label: '好大学在线' },
    { key: 'transfer', label: '传输中心' }
  ]

  return (
    <div
      className={`drag-region flex h-14 select-none items-center gap-3 border-b border-bd bg-surface-3 pr-4 text-sm text-text-2 ${
        isMac ? 'pl-[80px]' : 'pl-3'
      }`}
    >
      {!isMac && <CaptionButtons />}
      
      {stage === 'browser' && (
        <div className="no-drag flex h-full items-end ml-4">
          <Segmented 
            options={tabOptions} 
            value={activeTab === 'settings' ? '' : activeTab} 
            onChange={(v) => setActiveTab(v as any)} 
            size="lg" 
            className="mb-2"
          />
        </div>
      )}

      <div className="flex-1" />
      
      {stage === 'browser' && (
        <div className="no-drag flex items-center gap-3">
          {cloudConnStatus === 'connecting' && <span className="text-xs text-info">云盘连接中...</span>}
          {cloudConnStatus === 'idle' && <span className="text-xs text-success">☁️ 云盘已连接</span>}

          {onLogout && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-success-bg px-2.5 py-1 text-xs font-medium text-success ring-1 ring-success-ring"
              title={auth.accountName ? `账号：${auth.accountName}${auth.studentId ? ` (${auth.studentId})` : ''}` : '已登录'}
            >
              <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-success shadow-[0_0_8px_var(--success-ring)]" />
              <span className="truncate">{auth.accountName ? `${auth.accountName}` : '已登录'}</span>
            </span>
          )}

          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-lg p-1.5 text-text-3 transition-all hover:bg-surface-2 hover:text-text-1"
            title="全局设置与偏好"
          >
            ⚙️ 设置
          </button>

          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="rounded-lg px-2.5 py-1.5 text-xs text-text-3 transition-all hover:bg-surface-2 hover:text-text-1"
              title="退出登录"
            >
              退出
            </button>
          )}
        </div>
      )}
      
      <Segmented
        options={THEME_OPTIONS}
        value={theme}
        onChange={onSelectTheme}
        size="sm"
        className="no-drag ml-2"
      />
    </div>
  )
}

// ─── Mac 交通灯窗口按钮 ──────────────────────────────────────

/** macOS 风格红黄绿三键：关闭(红)/最小化(黄)/最大化(绿)，左侧排列。
 *  hover 整组时显示符号。最小化/关闭经 handleWindowAction：有下载时弹 Mac 风格确认窗。 */
function CaptionButtons() {
  const [maximized, setMaximized] = useState(false)
  const [hover, setHover] = useState(false)

  useEffect(() => {
    const sync = (): void => { void window.api.window.isMaximized().then(r => setMaximized(r.maximized)) }
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  const dotBase = 'no-drag flex h-3 w-3 items-center justify-center rounded-full transition-[filter] duration-150 hover:brightness-95'

  return (
    <div
      className="no-drag flex items-center gap-2"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* 关闭（红） */}
      <button
        type="button"
        title="关闭"
        onClick={() => void handleWindowAction('close')}
        className={dotBase}
        style={{ backgroundColor: '#FF5F57' }}
      >
        {hover && (
          <svg width="6" height="6" viewBox="0 0 6 6" fill="none" stroke="#4D0000" strokeWidth="1.2" strokeLinecap="round">
            <line x1="1" y1="1" x2="5" y2="5" />
            <line x1="5" y1="1" x2="1" y2="5" />
          </svg>
        )}
      </button>
      {/* 最小化（黄） */}
      <button
        type="button"
        title="最小化"
        onClick={() => void handleWindowAction('minimize')}
        className={dotBase}
        style={{ backgroundColor: '#FEBC2E' }}
      >
        {hover && (
          <svg width="6" height="6" viewBox="0 0 6 6" fill="none" stroke="#4D3500" strokeWidth="1.2" strokeLinecap="round">
            <line x1="1" y1="3" x2="5" y2="3" />
          </svg>
        )}
      </button>
      {/* 最大化/还原（绿） */}
      <button
        type="button"
        title={maximized ? '向下还原' : '最大化'}
        onClick={() => void window.api.window.toggleMaximize()}
        className={dotBase}
        style={{ backgroundColor: '#28C840' }}
      >
        {hover && (
          maximized ? (
            <svg width="6" height="6" viewBox="0 0 6 6" fill="none" stroke="#003400" strokeWidth="1.1" strokeLinecap="round">
              <path d="M2 1L1 2 M5 4L4 5" />
              <path d="M4 1L5 2 M1 4L2 5" />
            </svg>
          ) : (
            <svg width="6" height="6" viewBox="0 0 6 6" fill="none" stroke="#003400" strokeWidth="1.1" strokeLinecap="round">
              <path d="M3 1.2L3 4.2 M1.5 2.7L3 1.2L4.5 2.7" transform="rotate(90 3 3)" />
            </svg>
          )
        )}
      </button>
    </div>
  )
}

// ─── 实时传输速度 ────────────────────────────────────────────

/** 订阅主进程 transfer:speed 事件，在标题栏显示下行/上行实时速度。
 *  独立组件 + 本地 state，避免速度高频更新触发整个 TitleBar 重渲染。 */
function TransferSpeedIndicator() {
  const [speed, setSpeed] = useState<{ down: number; up: number }>({ down: 0, up: 0 })

  useEffect(() => {
    return window.api.download.onTransferSpeed(s => {
      setSpeed({ down: s.down, up: s.up })
    })
  }, [])

  const idle = speed.down < 1024 && speed.up < 1024
  return (
    <div
      className={`inline-flex select-none items-center gap-2 rounded-lg border border-bd bg-surface-3 px-2.5 py-1 text-xs font-mono tabular-nums ${
        idle ? 'text-text-4' : 'text-text-2'
      }`}
      title={`下行 ${formatBytes(speed.down)}/s · 上行 ${formatBytes(speed.up)}/s`}
    >
      <span className="inline-flex items-center gap-1" title="下载速度">
        <span className="text-info">↓</span>
        <span className={speed.down < 1024 ? 'text-text-4' : 'text-info'}>{formatBytes(speed.down)}/s</span>
      </span>
      <span className="h-3 w-px bg-bd" />
      <span className="inline-flex items-center gap-1" title="上传速度">
        <span className="text-accent">↑</span>
        <span className={speed.up < 1024 ? 'text-text-4' : 'text-accent'}>{formatBytes(speed.up)}/s</span>
      </span>
    </div>
  )
}

// ─── 并发滑块 ────────────────────────────────────────────────

function ConcurrencyControl({ value, auto, onChange }: { value: number; auto: boolean; onChange: (n: number) => void }) {
  return (
    <label
      className="inline-flex select-none items-center gap-2 rounded-lg border border-bd bg-surface-3 px-2.5 py-1 text-xs text-text-2"
      title="同时进行的下载/上传任务数量。自动模式根据网络状况动态调整"
    >
      <span className="shrink-0 text-text-2">并发</span>
      <button
        type="button"
        onClick={() => onChange(auto ? 3 : 0)}
        className={`rounded px-1.5 py-0.5 text-xs font-medium transition-colors ${
          auto ? 'bg-accent/15 text-accent' : 'text-text-3 hover:text-text-1'
        }`}
      >
        自动
      </button>
      {!auto && (
        <>
          <input
            type="range"
            min={2}
            max={16}
            step={1}
            value={value}
            onChange={e => onChange(Number(e.target.value))}
            className="h-1.5 w-16 cursor-pointer accent-accent"
          />
          <span className="w-5 text-center font-mono text-xs font-medium text-text-1">{value}</span>
        </>
      )}
      {auto && (
        <span className="font-mono text-xs font-medium text-accent">{value}</span>
      )}
    </label>
  )
}

// ─── 帮助弹窗 ────────────────────────────────────────────────

function HelpButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: globalThis.MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-text-1 shadow-glow-sm transition-all duration-150 hover:scale-110 hover:shadow-glow"
        title="查看并发设置说明"
      >
        ?
      </button>
      {open && (
        <div className="animate-fadeIn absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-bd-strong bg-surface-1/95 p-4 text-xs leading-relaxed text-text-2 shadow-xl backdrop-blur-md">
          <div className="mb-2 text-sm font-semibold text-text-1">并发数设置</div>
          <div className="space-y-1.5 text-text-3">
            <p>并发数 = 同时进行的下载/上传任务数量。数值越大速度越快，但对带宽和 CPU 的要求越高。</p>
            <div className="mt-2 space-y-1">
              <p><span className="font-medium text-success">2-3</span> — 校园无线网、VPN、带宽有限时推荐</p>
              <p><span className="font-medium text-info">4-6</span> — 有线网络、带宽充裕时推荐（默认）</p>
              <p><span className="font-medium text-warning">7-10</span> — 千兆网络、需要快速批量下载时</p>
              <p><span className="font-medium text-danger">11-16</span> — 仅限非常充裕的带宽环境，过高可能触发限流</p>
            </div>
            <p className="mt-1.5 text-text-4">建议从低并发开始，逐步调高观察速度变化。如果速度反而下降或频繁出错，请降低并发数。</p>
          </div>
        </div>
      )}
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

  useEffect(() => {
    if (!open) return
    const handler = (e: globalThis.MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

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
        <div className="animate-fadeIn absolute left-0 top-full z-50 mt-2 w-72 rounded-xl border border-bd-strong bg-surface-1/95 p-4 text-xs leading-relaxed text-text-2 shadow-xl backdrop-blur-md">
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
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-white shadow-glow-sm transition-all hover:bg-accent-light active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
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
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-bd bg-surface-2 px-3 text-xs font-medium text-text-2 transition-all hover:bg-surface-3"
            >
              取消下载
            </button>
          )}

          {/* ready：立即安装并重启（主进程 spawn 安装器后 app.quit） */}
          {phase === 'ready' && (
            <button
              type="button"
              onClick={() => { void window.api.installUpdate() }}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-white shadow-glow-sm transition-all hover:bg-accent-light active:scale-[0.98]"
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
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-white shadow-glow-sm transition-all hover:bg-accent-light active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
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

// ─── 全局限速控制 ─────────────────────────────────────────────

function SpeedLimitControl() {
  const maxDownloadSpeedKBps = useAppStore(s => s.maxDownloadSpeedKBps)
  const setMaxDownloadSpeedKBps = useAppStore(s => s.setMaxDownloadSpeedKBps)

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const limit = Number(e.target.value) || 0
    setMaxDownloadSpeedKBps(limit)
    void window.api.download.setSpeedLimit(limit)
  }

  return (
    <div
      className="inline-flex select-none items-center gap-1.5 rounded-lg border border-bd bg-surface-3 px-2 py-1 text-xs text-text-2"
      title="全局下载速度上限控制"
    >
      <span className="text-accent font-bold">⚡</span>
      <select
        value={maxDownloadSpeedKBps}
        onChange={handleSelect}
        className="bg-transparent text-text-2 focus:outline-none cursor-pointer text-xs font-medium"
      >
        <option value={0} className="bg-surface-2 text-text-1">⚡ 不限速</option>
        <option value={1024} className="bg-surface-2 text-text-1">限速 1 MB/s</option>
        <option value={2048} className="bg-surface-2 text-text-1">限速 2 MB/s</option>
        <option value={5120} className="bg-surface-2 text-text-1">限速 5 MB/s</option>
        <option value={10240} className="bg-surface-2 text-text-1">限速 10 MB/s</option>
        <option value={20480} className="bg-surface-2 text-text-1">限速 20 MB/s</option>
      </select>
    </div>
  )
}

// ─── 自定义命名规则 ───────────────────────────────────────────

function NamingTemplateControl() {
  const namingTemplate = useAppStore(s => s.namingTemplate)
  const setNamingTemplate = useAppStore(s => s.setNamingTemplate)
  const [open, setOpen] = useState(false)
  const [tempVal, setTempVal] = useState(namingTemplate)

  const handleSave = () => {
    setNamingTemplate(tempVal)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setTempVal(namingTemplate); setOpen(true) }}
        className="inline-flex select-none items-center gap-1 rounded-lg border border-bd bg-surface-3 px-2 py-1 text-xs text-text-2 hover:bg-surface-2 transition-colors"
        title="设置文件/目录自定义命名规则"
      >
        <span>🏷️</span>
        <span className="truncate max-w-[80px]">命名规则</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-surface-1 p-5 border border-border/40 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-text-1 text-base flex items-center gap-2">
                <span>🏷️ 自定义文件命名模板</span>
              </h3>
              <button onClick={() => setOpen(false)} className="text-text-3 hover:text-text-1 text-sm">✕</button>
            </div>

            <p className="text-xs text-text-3">
              支持在下载路径中自动替换变量：
              <code className="text-accent bg-surface-2 px-1 rounded ml-1">{"{term}"}</code>、
              <code className="text-accent bg-surface-2 px-1 rounded ml-1">{"{course}"}</code>、
              <code className="text-accent bg-surface-2 px-1 rounded ml-1">{"{category}"}</code>、
              <code className="text-accent bg-surface-2 px-1 rounded ml-1">{"{teacher}"}</code>、
              <code className="text-accent bg-surface-2 px-1 rounded ml-1">{"{fileName}"}</code>
            </p>

            <input
              type="text"
              value={tempVal}
              onChange={e => setTempVal(e.target.value)}
              placeholder="{term}/{course}/{category}/{fileName}"
              className="w-full px-3 py-2 rounded-lg bg-surface-2 text-text-1 text-sm border border-border/40 focus:outline-none focus:border-accent font-mono"
            />

            <div className="p-3 rounded-lg bg-surface-2/60 text-xs space-y-1">
              <span className="text-text-3 block font-medium">样例渲染路径效果：</span>
              <div className="font-mono text-text-2 break-all">
                2025-2026-1/高等数学/videos/lecture_01.mp4
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-surface-2 text-text-2 text-xs hover:bg-surface-3 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs hover:bg-accent-light font-medium transition-colors"
              >
                保存模板
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

