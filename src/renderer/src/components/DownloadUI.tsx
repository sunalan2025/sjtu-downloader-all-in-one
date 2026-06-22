import { useRef } from 'react'
import type { DownloadMode, FileConflictStrategy, DownloadProgress, DownloadState } from '@shared/types'
import { Segmented, type SegmentedOption } from './Segmented'
import { Spinner } from './Spinner'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type TriState = 'none' | 'some' | 'all'

export function triStateFromCount(sel: number, total: number): TriState {
  if (sel === 0) return 'none'
  return sel === total ? 'all' : 'some'
}

const FILL_BY_STATE: Record<DownloadState, string> = {
  done: 'bg-success',
  error: 'bg-warning',
  skipped: 'bg-text-4',
  paused: 'bg-warning/70',
  cancelled: 'bg-text-4',
  pending: 'bg-gradient-to-r from-accent to-accent-light',
  downloading: 'bg-gradient-to-r from-accent to-accent-light',
}

const TEXT_BY_STATE: Record<DownloadState, string> = {
  done: 'text-success',
  error: 'text-warning',
  skipped: 'text-text-3',
  paused: 'text-warning',
  cancelled: 'text-text-4',
  pending: 'text-text-2',
  downloading: 'text-text-2',
}

// ─────────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────────

export function formatBytes(b: number): string {
  if (!b || b < 0) return '0 B'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function stateLabel(s: DownloadState, pct: number, msg?: string): string {
  switch (s) {
    case 'pending':
      return msg || '等待中'
    case 'downloading':
      return `${pct}%`
    case 'done':
      return '完成'
    case 'error':
      return msg || '失败'
    case 'skipped':
      return '已存在'
    case 'paused':
      return pct > 0 ? `已暂停 · ${pct}%` : '已暂停'
    case 'cancelled':
      return '已取消'
  }
}

/** 为进度条状态提供更详细的 tooltip 提示 */
export function stateHint(s: DownloadState, msg?: string): string {
  switch (s) {
    case 'pending':
      return '任务正在排队等待，即将开始下载'
    case 'downloading':
      return '正在下载中'
    case 'done':
      return '下载完成'
    case 'error':
      return msg || '下载失败，可点击重试按钮重新下载'
    case 'skipped':
      return '该文件已存在，自动跳过'
    case 'paused':
      return '已暂停，可点击继续按钮恢复下载'
    case 'cancelled':
      return '已取消，如需重新下载请重新选择'
  }
}

// ─────────────────────────────────────────────────────────────
// Checkbox / icon primitives
// ─────────────────────────────────────────────────────────────

export function TriCheckbox({ state, size = 'sm' }: { state: TriState; size?: 'sm' | 'lg' }) {
  const dims = size === 'lg' ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'
  const tick = size === 'lg' ? 'h-3 w-3' : 'h-2.5 w-2.5'
  const dash = size === 'lg' ? 'h-[2px] w-2.5' : 'h-[2px] w-2'
  const base = `inline-flex ${dims} items-center justify-center rounded-[4px] border-2 transition-all duration-150`
  if (state === 'all') {
    return (
      <span className={`${base} border-accent bg-accent text-white`}>
        <svg viewBox="0 0 16 16" className={tick} fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }
  if (state === 'some') {
    return (
      <span className={`${base} border-accent bg-accent-80 text-white`}>
        <span className={`${dash} rounded-full bg-white`} />
      </span>
    )
  }
  return <span className={`${base} border-bd-strong bg-transparent`} />
}

export function SmallCheck({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-[2px] border transition-all duration-150 ${
        on ? 'border-current bg-current/30' : 'border-current/50'
      }`}
    >
      {on && (
        <svg viewBox="0 0 16 16" className="h-2 w-2" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-text-3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

export function CtrlIcon({ kind, size = 14 }: { kind: 'pause' | 'resume' | 'cancel'; size?: number }) {
  if (kind === 'pause') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="5" width="4" height="14" rx="1" />
        <rect x="14" y="5" width="4" height="14" rx="1" />
      </svg>
    )
  }
  if (kind === 'resume') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M7 5v14l12-7L7 5z" />
      </svg>
    )
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────
// Progress bar
// ─────────────────────────────────────────────────────────────

export function ProgressBar({ p }: { p: DownloadProgress }) {
  const prevRef = useRef<{ t: number; r: number; speed: number }>({ t: 0, r: 0, speed: 0 })

  if (p.state === 'downloading') {
    if (p.received > prevRef.current.r) {
      const now = Date.now()
      if (prevRef.current.t > 0) {
        const dt = (now - prevRef.current.t) / 1000
        const db = p.received - prevRef.current.r
        if (dt > 0.1) {
          const inst = db / dt
          // EMA 平滑，避免数字跳动
          prevRef.current.speed =
            prevRef.current.speed === 0 ? inst : prevRef.current.speed * 0.6 + inst * 0.4
        }
      }
      prevRef.current.t = now
      prevRef.current.r = p.received
    }
  } else {
    prevRef.current = { t: 0, r: 0, speed: 0 }
  }

  const pct =
    p.total > 0
      ? Math.min(100, Math.round((p.received / p.total) * 100))
      : p.state === 'done'
        ? 100
        : 0
  const isDl = p.state === 'downloading'
  // 填充色：done 用 success 渐变，downloading 用 accent 渐变，其余纯色
  const fill = FILL_BY_STATE[p.state]
  const textColor = TEXT_BY_STATE[p.state]

  // paused 时进度条宽度按已下载比例显示；cancelled 显示当前已下载比例（视觉残留）
  const barWidth =
    p.state === 'skipped'
      ? 100
      : p.state === 'paused' || p.state === 'cancelled'
        ? pct
        : Math.max(isDl ? 2 : 0, pct)
  const isDone = p.state === 'done'

  return (
    <div className="space-y-1.5">
      <div className="relative h-2 overflow-hidden rounded-full bg-surface-2 shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]">
        <div
          className={`relative h-full overflow-hidden rounded-full ${fill} transition-[width] duration-300 ease-out`}
          style={{ width: `${barWidth}%` }}
        >
          {isDl && (
            <div className="absolute inset-y-0 -inset-x-2 animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          )}
        </div>
        {isDone && (
          <svg
            className="animate-fadeIn absolute right-0 top-1/2 mr-1 h-3 w-3 -translate-y-1/2 text-white"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          >
            <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 whitespace-nowrap text-xs tabular-nums">
        {isDl ? (
          <>
            <span className="text-text-2">
              {formatBytes(p.received)}
              {p.total > 0 && (
                <span className="text-text-4"> / {formatBytes(p.total)}</span>
              )}
              <span className="ml-2 font-medium text-text-1">{pct}%</span>
            </span>
            {prevRef.current.speed > 0 && (
              <span className="text-text-3">{formatBytes(prevRef.current.speed)}/s</span>
            )}
          </>
        ) : (
          <span className={`truncate ${textColor}`} title={stateHint(p.state, p.message)}>
            {stateLabel(p.state, pct, p.message)}
          </span>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Control buttons
// ─────────────────────────────────────────────────────────────

export function GlobalCtrlButton({
  kind,
  onClick,
  title
}: {
  kind: 'pause' | 'resume' | 'cancel'
  onClick: () => void
  title: string
}) {
  const tone =
    kind === 'cancel'
      ? 'text-danger ring-danger-ring hover:bg-danger-bg'
      : kind === 'pause'
        ? 'text-warning ring-warning-ring hover:bg-warning-bg'
        : 'text-success ring-success-ring hover:bg-success-bg'
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg bg-surface-3 ring-1 transition-all duration-150 hover:scale-105 ${tone}`}
    >
      <CtrlIcon kind={kind} />
    </button>
  )
}

export function TaskCtrlButtons({
  state,
  onPause,
  onCancel,
  onResume
}: {
  state: DownloadState
  onPause: () => void
  onCancel: () => void
  onResume: () => void
}) {
  // 终态：不显示控制按钮
  if (state === 'done' || state === 'skipped' || state === 'cancelled') return null
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {state === 'downloading' || state === 'pending' ? (
        <TaskCtrlBtn kind="pause" onClick={onPause} title="暂停此任务" />
      ) : (
        <TaskCtrlBtn kind="resume" onClick={onResume} title="继续此任务" />
      )}
      <TaskCtrlBtn kind="cancel" onClick={onCancel} title="取消此任务" />
    </div>
  )
}

export function TaskCtrlBtn({
  kind,
  onClick,
  title
}: {
  kind: 'pause' | 'resume' | 'cancel'
  onClick: () => void
  title: string
}) {
  const tone =
    kind === 'cancel'
      ? 'text-danger/80 hover:bg-danger-bg hover:text-danger'
      : kind === 'pause'
        ? 'text-warning/80 hover:bg-warning-bg hover:text-warning'
        : 'text-success/80 hover:bg-success-bg hover:text-success'
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-all duration-150 hover:scale-110 ${tone}`}
    >
      <CtrlIcon kind={kind} size={12} />
    </button>
  )
}

// ─────────────────────────────────────────────────────────────
// 下载模式分段选择器（本地 / 云盘 / 两者） — 统一 Browser & CanvasBrowser
// ─────────────────────────────────────────────────────────────

const MODE_OPTIONS: SegmentedOption<DownloadMode>[] = [
  { key: 'local', label: '本地', title: '仅下载到本地磁盘' },
  { key: 'cloud', label: '云盘', title: '仅上传到交大云盘' },
  { key: 'both', label: '两者', title: '同时下载到本地并上传到云盘' }
]

export function ModeSegmented({
  value,
  onChange
}: {
  value: DownloadMode
  onChange: (m: DownloadMode) => void
}) {
  return <Segmented options={MODE_OPTIONS} value={value} onChange={onChange} size="md" />
}

// ─────────────────────────────────────────────────────────────
// 同名文件冲突策略分段选择器（跳过 / 替换） — 统一 Browser & CanvasBrowser
// ─────────────────────────────────────────────────────────────

const CONFLICT_OPTIONS: SegmentedOption<FileConflictStrategy>[] = [
  { key: 'skip', label: '跳过', title: '同名文件已存在时跳过，保留旧文件' },
  { key: 'overwrite', label: '替换', title: '同名文件已存在时先删除旧文件，再重新下载/上传' }
]

export function ConflictStrategySegmented({
  value,
  onChange
}: {
  value: FileConflictStrategy
  onChange: (s: FileConflictStrategy) => void
}) {
  return <Segmented options={CONFLICT_OPTIONS} value={value} onChange={onChange} size="md" />
}

// ─────────────────────────────────────────────────────────────
// 课程级进度摘要条 — Browser CourseSection & CanvasBrowser CanvasCourseCard 共用
// ─────────────────────────────────────────────────────────────

export function CourseProgressSummary({
  done,
  downloading,
  errors,
  total
}: {
  done: number
  downloading: number
  errors: number
  total: number
}) {
  if (done === 0 && downloading === 0 && errors === 0) return null
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="border-t border-bd px-5 py-3">
      <div className="flex items-center gap-3">
        {/* 进度条 */}
        <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${
              errors > 0 && done === 0 ? 'bg-warning' : 'bg-success'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* 状态文字 */}
        <div className="flex shrink-0 items-center gap-2.5 text-xs tabular-nums">
          <span className="font-medium text-success">{done}/{total}</span>
          {downloading > 0 && (
            <span className="inline-flex items-center gap-1 text-info">
              <Spinner size={11} />{downloading}
            </span>
          )}
          {errors > 0 && <span className="text-warning">失败 {errors}</span>}
        </div>
      </div>
    </div>
  )
}
