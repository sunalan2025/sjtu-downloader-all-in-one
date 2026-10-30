// 下载进度原语：状态机文案（stateLabel/stateHint）、进度条（含 EMA 速度估算）、
// 任务/全局控制按钮、资源类型分段器、课程级进度摘要。
//
// [Phase 3 拆分] 原 DownloadUI.tsx 按内聚拆分；视觉原语在 widgets.tsx。
// TriState / triStateFromCount 与视觉无关但被两侧引用，落在 widgets.tsx 并在此
// re-export，保持 DownloadUI barrel 的既有导出面。

import { useRef } from 'react'
import type { DownloadProgress, DownloadState, CnmoocResourceFilter } from '@shared/types'
import { Segmented, type SegmentedOption } from './Segmented'
import { Spinner } from './Spinner'
import { formatBytes } from '../../../shared/utils'

export { formatBytes }
export type { TriState } from './widgets'
export { triStateFromCount } from './widgets'

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

export function ProgressBar({ p }: { p: DownloadProgress }) {
  const prevRef = useRef<{ t: number; r: number; speed: number }>({ t: 0, r: 0, speed: 0 })

  // 仅字节单位任务计算速度；count 单位（HLS 切片数）不算速度（切片/秒会被误格式化为字节/秒）
  if (p.state === 'downloading' && p.unit !== 'count') {
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
              {p.message ? (
                // HLS 阶段文案 / both 模式"本地完成 · 云端上传中"等提示优先于字节显示
                <span className="truncate" title={p.message}>{p.message}</span>
              ) : (
                <>
                  {formatBytes(p.received)}
                  {p.total > 0 && (
                    <span className="text-text-4"> / {formatBytes(p.total)}</span>
                  )}
                </>
              )}
              <span className="ml-2 font-medium text-text-1">{pct}%</span>
            </span>
            {p.unit !== 'count' && prevRef.current.speed > 0 && (
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


const RESOURCE_TYPE_OPTIONS: SegmentedOption<string>[] = [
  { key: 'all', label: '全部', title: '视频和课件都下载' },
  { key: 'video', label: '仅视频', title: '仅下载视频，课件在下载阶段自动跳过' },
  { key: 'document', label: '仅课件', title: '仅下载课件文档，视频在下载阶段自动跳过' }
]

export function ResourceTypeSegmented({
  value,
  onChange
}: {
  value: CnmoocResourceFilter
  onChange: (f: CnmoocResourceFilter) => void
}) {
  return (
    <Segmented
      options={RESOURCE_TYPE_OPTIONS}
      value={value}
      onChange={k => onChange(k as CnmoocResourceFilter)}
      size="xl"
    />
  )
}

export function CourseProgressSummary({
  done,
  downloading,
  errors,
  inflight,
  total,
  className
}: {
  done: number
  downloading: number
  errors: number
  inflight?: number
  total: number
  className?: string
}) {
  if (done === 0 && downloading === 0 && errors === 0) return null
  const w = (n: number): number => (total > 0 ? Math.min(100, (n / total) * 100) : 0)
  const wDone = w(done)
  const wInflight = w(inflight ?? 0)
  const wErr = w(errors)
  return (
    <div className={className ?? 'flex items-center gap-2.5 py-0.5'}>
      {/* 堆叠进度条 */}
      <div className="relative flex h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-success transition-[width] duration-300 ease-out" style={{ width: `${wDone}%` }} />
        <div className="h-full bg-gradient-to-r from-accent to-accent-light transition-[width] duration-300 ease-out" style={{ width: `${wInflight}%` }} />
        {wErr > 0 && (
          <div className="h-full bg-warning transition-[width] duration-300 ease-out" style={{ width: `${wErr}%` }} />
        )}
      </div>
      {/* 状态文字 */}
      <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-mono tabular-nums">
        <span className="font-medium text-success">{done}/{total}</span>
        {downloading > 0 && (
          <span className="inline-flex items-center gap-1 text-info">
            <Spinner size={10} />{downloading}
          </span>
        )}
        {errors > 0 && <span className="text-warning">失败 {errors}</span>}
      </div>
    </div>
  )
}

