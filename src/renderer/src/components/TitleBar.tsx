import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore, type Theme } from '../store/app'
import { Segmented, type SegmentedOption } from './Segmented'
import { formatBytes } from './DownloadUI'
import { handleWindowAction } from './WindowConfirmModal'

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

export function TitleBar({ onLogout }: { onLogout?: () => void }) {
  const theme = useAppStore(s => s.theme)
  const setTheme = useAppStore(s => s.setTheme)
  const stage = useAppStore(s => s.stage)
  const auth = useAppStore(s => s.auth)
  const concurrency = useAppStore(s => s.concurrency)
  const autoConcurrency = useAppStore(s => s.autoConcurrency)
  const setConcurrency = useAppStore(s => s.setConcurrency)
  const setAutoConcurrency = useAppStore(s => s.setAutoConcurrency)

  // macOS 用原生交通灯（titleBarStyle: hiddenInset），不渲染自绘按钮；
  // 左侧留出 ~80px 给原生交通灯。Win/Linux 渲染自绘 Mac 风格交通灯。
  const isMac = window.api.platform === 'darwin'

  // 自动并发模式下，监听主进程的并发数变化
  useEffect(() => {
    if (!autoConcurrency) return
    return window.api.download.onConcurrencyChanged((n: number) => {
      setConcurrency(n)
    })
  }, [autoConcurrency, setConcurrency])

  const onSelect = (key: Theme): void => {
    setTheme(key)
    applyTheme(key)
  }

  // PERF [debounce]: debounce IPC call to ~300ms to avoid rapid-fire during slider drag
  const isFirstMount = useRef(true)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false
      // Sync persisted concurrency/auto mode to main on mount (main defaults to concurrency=3, auto=false otherwise).
      void window.api.download.setConcurrency(autoConcurrency ? 0 : concurrency)
      return
    }
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      void window.api.download.setConcurrency(concurrency)
    }, 300)
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current) }
  }, [concurrency])

  return (
    <div
      className={`drag-region flex h-10 select-none items-center gap-3 pr-4 text-sm text-text-2 ${
        isMac ? 'pl-[80px]' : 'pl-3'
      }`}
    >
      {/* Mac 交通灯窗口按钮（左侧）— macOS 用原生，Win/Linux 自绘 */}
      {!isMac && <CaptionButtons />}
      <div className="flex shrink-0 items-center gap-2.5">
        <span className="font-semibold tracking-wide text-text-1">SJTU 课程下载器</span>
      </div>
      <div className="flex-1" />
      {stage === 'browser' && (
        <div className="no-drag flex items-center gap-2.5">
          {/* 已登录 + 账号名 */}
          {onLogout && (
            <>
              <span
                className="inline-flex max-w-[240px] items-center gap-1.5 rounded-full bg-success-bg px-2.5 py-1 text-xs font-medium text-success ring-1 ring-success-ring"
                title={auth.accountName ? `账号：${auth.accountName}${auth.studentId ? ` (${auth.studentId})` : ''}` : '已登录'}
              >
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-success shadow-[0_0_8px_var(--success-ring)]" />
                <span className="truncate">{auth.accountName ? `${auth.accountName}${auth.studentId ? ` (${auth.studentId})` : ''}` : '已登录'}</span>
              </span>
              <button
                type="button"
                onClick={onLogout}
                className="rounded-lg px-2.5 py-1 text-xs text-text-3 transition-all hover:bg-surface-2 hover:text-text-1"
                title="清除本机登录会话，返回首页"
              >
                退出登录
              </button>
            </>
          )}
          {/* 实时传输速度 */}
          <TransferSpeedIndicator />
          {/* 并发控制 */}
          <ConcurrencyControl
            value={concurrency}
            auto={autoConcurrency}
            onChange={(n) => { setConcurrency(n); setAutoConcurrency(n === 0) }}
          />
          <HelpButton />
        </div>
      )}
      {/* 主题切换 */}
      <Segmented
        options={THEME_OPTIONS}
        value={theme}
        onChange={onSelect}
        size="sm"
        className="no-drag"
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
