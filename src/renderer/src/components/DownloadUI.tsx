import { useRef, useState, useEffect } from 'react'
import type { DownloadProgress, DownloadState, CnmoocResourceFilter } from '@shared/types'
import { Segmented, type SegmentedOption } from './Segmented'
import { Spinner } from './Spinner'
import { useAppStore, type CourseViewMode } from '../store/app'
import { useShallow } from 'zustand/shallow'
import { formatBytes } from '../../../shared/utils'

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

export { formatBytes }

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
// 好大学在线 资源类型分段选择器（全部 / 仅视频 / 仅课件）
// 下载时懒解析直链后按此过滤：不匹配的资源标 skipped
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// 课程级进度摘要条 — Browser CourseSection & CanvasBrowser CanvasCourseCard 共用
// 堆叠段：绿(完成) + 蓝(进行中已下载部分) + 红(失败) + 灰(剩余)
// inflight = Σ 进行中任务的已完成比例（0..total，含小数），让条平滑推进而非只在任务完成时跳
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// 全局总进度条 — 三页 ActionBar 共用，跨所有课程/任务的整批进度
// 订阅整个 progress map（下载为全局态、每批 resetProgress 清空 → 读全表即当前批次），
// 算 done/failed/active/inflight/total，渲染堆叠条 + 完成数 + 失败数。
// 仅在 downloading 时由各页挂载，单组件每 tick 重渲（廉价）。
// ─────────────────────────────────────────────────────────────

export function OverallProgressBar() {
  // 基于「本轮显式提交的任务集」batchTaskIds 统计，而非遍历 progress 全表。
  // 这样 total = 勾选并入队的任务数（扫描占位 / 未勾选残留 / 陈旧条目都不进集合），
  // PPT 聚合 + iframe HLS + 常规文件统一计入；both 模式区分「下载中 / 上传中」，
  // 让用户看懂本地已 done 但云端还在传时为什么进度条还在转。
  const stats = useAppStore(
    useShallow(s => {
      let done = 0
      let failed = 0
      let downloading = 0 // both: 本地未终态；非 both: 全部 active
      let uploading = 0   // both: 本地 done 但 cloud 未终态
      let inflight = 0    // 下载中的进度比例和
      let upInflight = 0  // 上传中的进度比例和（本地已满，按 1 计）
      const isBoth = s.downloadMode === 'both'
      const ids = s.batchTaskIds
      for (const id of ids) {
        const prog = s.progress[id]
        const st = prog?.state
        if (isBoth) {
          const cloudId = s.cloudLinkedIds[id]
          const cloudSt = cloudId ? s.progress[cloudId]?.state : undefined
          const localDone = st === 'done' || st === 'skipped'
          const cloudDone = !cloudId || cloudSt === 'done' || cloudSt === 'skipped' || cloudSt === 'cancelled'
          const localFinal = localDone || st === 'error' || st === 'cancelled'
          const cloudFinal = !cloudId || cloudDone || cloudSt === 'error'
          if (st === 'error' || cloudSt === 'error') failed++
          else if (localDone && cloudDone) done++
          else if (!localFinal) {
            // 本地还在下载 / 排队 → 下载中
            downloading++
            if (st === 'downloading' && prog.total > 0) inflight += Math.min(1, prog.received / prog.total)
          } else if (localDone && !cloudFinal) {
            // 本地已完成、云端还在上传 → 上传中
            uploading++
            upInflight += 1
          }
          // 本地 cancelled（且 cloud 非 error）：已取消，静默不计 active/done/failed
          // （本地 error 已在上方计 failed；本地 cancelled + cloud 仍跑的边角也归静默，避免幽灵）
        } else {
          if (st === 'done' || st === 'skipped') done++
          else if (st === 'error') failed++
          else if (st !== 'cancelled') {
            downloading++
            if (st === 'downloading' && prog.total > 0) inflight += Math.min(1, prog.received / prog.total)
          }
        }
      }
      return { done, failed, downloading, uploading, inflight, upInflight, total: ids.length, isBoth, localDestRoot: s.localDestRoot }
    })
  )
  const { done, failed, downloading, uploading, inflight, upInflight, total, isBoth, localDestRoot } = stats
  if (total === 0) return null
  const w = (n: number): number => (total > 0 ? Math.min(100, (n / total) * 100) : 0)
  const wDone = w(done)
  const wDown = w(inflight)
  const wUp = w(upInflight)
  const wErr = w(failed)
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface-3 px-3 py-1.5 text-xs tabular-nums">
      <div className="relative flex h-2 flex-1 overflow-hidden rounded-full bg-surface-2 min-w-[120px]">
        <div className="h-full bg-success transition-[width] duration-300 ease-out" style={{ width: `${wDone}%` }} />
        <div className="h-full bg-gradient-to-r from-accent to-accent-light transition-[width] duration-300 ease-out" style={{ width: `${wDown}%` }} />
        {isBoth && (
          <div className="h-full bg-gradient-to-r from-violet-500 to-violet-400 transition-[width] duration-300 ease-out" style={{ width: `${wUp}%` }} />
        )}
        {wErr > 0 && (
          <div className="h-full bg-warning transition-[width] duration-300 ease-out" style={{ width: `${wErr}%` }} />
        )}
      </div>
      <span className="shrink-0 text-text-2">
        完成 <span className="font-medium text-success">{done}</span> / {total}
      </span>
      {downloading > 0 && (
        <span className="inline-flex shrink-0 items-center gap-1 text-info">
          <Spinner size={11} />{isBoth ? `下载${downloading}` : downloading}
        </span>
      )}
      {isBoth && uploading > 0 && (
        <span className="inline-flex shrink-0 items-center gap-1 text-violet-400">
          <Spinner size={11} />上传{uploading}
        </span>
      )}
      {failed > 0 && <span className="shrink-0 text-warning">失败 {failed}</span>}
      {localDestRoot && (
        <button
          type="button"
          onClick={() => void window.api.openPath(localDestRoot)}
          className="shrink-0 rounded px-1.5 py-0.5 text-text-3 hover:bg-surface-2 hover:text-text-1 transition-colors"
          title={`在资源管理器中打开目标目录:\n${localDestRoot}`}
        >
          📂 目录
        </button>
      )}
      {(done > 0 || failed > 0) && (
        <button
          type="button"
          onClick={() => useAppStore.getState().clearCompletedProgress()}
          className="shrink-0 rounded px-1.5 py-0.5 text-text-3 hover:bg-surface-2 hover:text-text-1 transition-colors"
          title="清空当前已完成与失败的任务记录"
        >
          🧹 清空
        </button>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 设计图对齐视觉徽标与图标
// ─────────────────────────────────────────────────────────────

export function ItemCheckbox({
  checked,
  disabled,
  onChange
}: {
  checked: boolean
  disabled?: boolean
  onChange?: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        if (disabled) return
        onChange?.()
      }}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all duration-150 ${
        disabled
          ? 'cursor-not-allowed opacity-40 border-bd/40 bg-surface-2'
          : checked
            ? 'cursor-pointer border-accent bg-accent text-white shadow-2xs'
            : 'cursor-pointer border-bd-strong bg-surface-1 hover:border-text-3'
      }`}
    >
      {checked && (
        <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}

export function FileTypeBadge({
  filename,
  type,
  className = 'h-[22px] w-[18px] shrink-0 drop-shadow-2xs'
}: {
  filename?: string
  type?: string
  className?: string
}) {
  let ext = type?.toUpperCase()

  // 关键防错：如果文件名包含明确的文件后缀，优先采用真实文件后缀（避免上游误传通用类型覆盖了真实的 pptx/pdf）
  if (ext !== 'M4A' && ext !== 'DISABLED' && filename) {
    const cleanFn = filename.replace(/\s*\([^)]*\)\s*$/, '').trim()
    const m = cleanFn.match(/\.([a-zA-Z0-9]{2,5})$/)
    if (m) {
      const fnExt = m[1].toUpperCase()
      const recognizedExts = [
        'PDF', 'PPT', 'PPTX', 'DOC', 'DOCX', 'XLS', 'XLSX', 'ZIP', 'RAR', '7Z', 'TXT',
        'MP4', 'MP3', 'FLV', 'MKV', 'AVI', 'MOV', 'WAV', 'AAC'
      ]
      if (recognizedExts.includes(fnExt)) {
        ext = fnExt
      } else if (!ext) {
        ext = fnExt
      }
    }
  }

  ext = ext || 'FILE'

  const badgeClass = className || 'h-[22px] w-[18px] shrink-0 drop-shadow-2xs'

  if (ext === 'PDF') {
    return (
      <svg width={18} height={22} className={badgeClass} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <title>PDF 文档</title>
        <path d="M3 2C2.44772 2 2 2.44772 2 3V21C2 21.5523 2.44772 22 3 22H17C17.5523 22 18 21.5523 18 21V7L13 2H3Z" fill="#DC2626"/>
        <path d="M13 2V6C13 6.55228 13.4477 7 14 7H18L13 2Z" fill="#FCA5A5"/>
        <rect x="3.5" y="11" width="13" height="7.5" rx="1.5" fill="#991B1B" />
        <text x="10" y="16.5" fill="#FFFFFF" fontSize="5" fontWeight="bold" textAnchor="middle" fontFamily="system-ui, sans-serif">PDF</text>
      </svg>
    )
  }
  if (ext === 'PPT' || ext === 'PPTX') {
    return (
      <svg width={18} height={22} className={badgeClass} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <title>PowerPoint 幻灯片</title>
        <path d="M3 2C2.44772 2 2 2.44772 2 3V21C2 21.5523 2.44772 22 3 22H17C17.5523 22 18 21.5523 18 21V7L13 2H3Z" fill="#EA580C"/>
        <path d="M13 2V6C13 6.55228 13.4477 7 14 7H18L13 2Z" fill="#FDBA74"/>
        <rect x="3.5" y="11" width="13" height="7.5" rx="1.5" fill="#9A3412" />
        <text x="10" y="16.5" fill="#FFFFFF" fontSize="5" fontWeight="bold" textAnchor="middle" fontFamily="system-ui, sans-serif">PPT</text>
      </svg>
    )
  }
  if (ext === 'MP4' || ext === 'M3U8' || ext === 'VIDEO' || ext === 'FLV' || ext === 'AVI' || ext === 'MKV') {
    return (
      <svg width={18} height={22} className={badgeClass} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <title>MP4 视频</title>
        <path d="M3 2C2.44772 2 2 2.44772 2 3V21C2 21.5523 2.44772 22 3 22H17C17.5523 22 18 21.5523 18 21V7L13 2H3Z" fill="#2563EB"/>
        <path d="M13 2V6C13 6.55228 13.4477 7 14 7H18L13 2Z" fill="#93C5FD"/>
        <polygon points="8,10.5 13.5,13.5 8,16.5" fill="#FFFFFF"/>
        <text x="10" y="20.5" fill="#DBEAFE" fontSize="3.8" fontWeight="bold" textAnchor="middle" fontFamily="system-ui, sans-serif">MP4</text>
      </svg>
    )
  }
  if (ext === 'M4A' || ext === 'MP3' || ext === 'AAC' || ext === 'AUDIO' || ext === 'WAV' || ext === 'FLAC') {
    return (
      <svg width={18} height={22} className={badgeClass} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <title>M4A 音频</title>
        <path d="M3 2C2.44772 2 2 2.44772 2 3V21C2 21.5523 2.44772 22 3 22H17C17.5523 22 18 21.5523 18 21V7L13 2H3Z" fill="#10B981"/>
        <path d="M13 2V6C13 6.55228 13.4477 7 14 7H18L13 2Z" fill="#6EE7B7"/>
        <path d="M8 14.5C8 13.67 8.67 13 9.5 13C10.33 13 11 13.67 11 14.5C11 15.33 10.33 16 9.5 16C8.67 16 8 15.33 8 14.5ZM11 14.5V9.5L14 9V11.5L11 12V14.5Z" fill="#FFFFFF"/>
        <text x="10" y="20.5" fill="#D1FAE5" fontSize="3.8" fontWeight="bold" textAnchor="middle" fontFamily="system-ui, sans-serif">M4A</text>
      </svg>
    )
  }
  if (ext === 'DISABLED' || ext === 'MUTE') {
    return (
      <svg width={18} height={22} className={badgeClass} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <title>无独立音频</title>
        <path d="M3 2C2.44772 2 2 2.44772 2 3V21C2 21.5523 2.44772 22 3 22H17C17.5523 22 18 21.5523 18 21V7L13 2H3Z" fill="#94A3B8"/>
        <path d="M13 2V6C13 6.55228 13.4477 7 14 7H18L13 2Z" fill="#CBD5E1"/>
        <circle cx="10" cy="13.5" r="3" stroke="#FFFFFF" strokeWidth="1.2" fill="none"/>
        <line x1="8" y1="15.5" x2="12" y2="11.5" stroke="#FFFFFF" strokeWidth="1.2"/>
        <text x="10" y="20.5" fill="#F1F5F9" fontSize="3" fontWeight="bold" textAnchor="middle" fontFamily="system-ui, sans-serif">MUTE</text>
      </svg>
    )
  }
  if (ext === 'DOC' || ext === 'DOCX') {
    return (
      <svg width={18} height={22} className={badgeClass} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <title>Word 文档</title>
        <path d="M3 2C2.44772 2 2 2.44772 2 3V21C2 21.5523 2.44772 22 3 22H17C17.5523 22 18 21.5523 18 21V7L13 2H3Z" fill="#0284C7"/>
        <path d="M13 2V6C13 6.55228 13.4477 7 14 7H18L13 2Z" fill="#7DD3FC"/>
        <rect x="3.5" y="11" width="13" height="7.5" rx="1.5" fill="#0369A1" />
        <text x="10" y="16.5" fill="#FFFFFF" fontSize="5" fontWeight="bold" textAnchor="middle" fontFamily="system-ui, sans-serif">DOC</text>
      </svg>
    )
  }
  if (ext === 'ZIP' || ext === 'RAR' || ext === '7Z' || ext === 'TAR' || ext === 'GZ') {
    return (
      <svg width={18} height={22} className={badgeClass} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <title>压缩包</title>
        <path d="M3 2C2.44772 2 2 2.44772 2 3V21C2 21.5523 2.44772 22 3 22H17C17.5523 22 18 21.5523 18 21V7L13 2H3Z" fill="#9333EA"/>
        <path d="M13 2V6C13 6.55228 13.4477 7 14 7H18L13 2Z" fill="#D8B4FE"/>
        <rect x="8.5" y="9" width="3" height="9" rx="0.5" fill="#581C87" />
        <rect x="9" y="10" width="2" height="1.5" fill="#FFFFFF" />
        <rect x="9" y="13" width="2" height="1.5" fill="#FFFFFF" />
        <rect x="9" y="16" width="2" height="1.5" fill="#FFFFFF" />
      </svg>
    )
  }
  return (
    <svg width={18} height={22} className={badgeClass} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <title>文件</title>
      <path d="M3 2C2.44772 2 2 2.44772 2 3V21C2 21.5523 2.44772 22 3 22H17C17.5523 22 18 21.5523 18 21V7L13 2H3Z" fill="#64748B"/>
      <path d="M13 2V6C13 6.55228 13.4477 7 14 7H18L13 2Z" fill="#CBD5E1"/>
      <line x1="5" y1="12" x2="15" y2="12" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="5" y1="15" x2="13" y2="15" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="5" y1="18" x2="10" y2="18" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function FolderIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={`${className} shrink-0`}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 7V17C3 18.1 3.9 19 5 19H19C20.1 19 21 18.1 21 17V9C21 7.9 20.1 7 19 7H11L9 5H5C3.9 5 3 5.9 3 7Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 10.5H21"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeOpacity="0.28"
        strokeLinecap="round"
      />
    </svg>
  )
}

export interface DropdownOption<T extends string = string> {
  value: T
  label: string
  count?: number
  icon?: string
}

/** 现代圆角自定义下拉组件（彻底告别系统原生粗糙 select 弹窗） */
export function DropdownSelect<T extends string = string>({
  value,
  options,
  onChange,
  icon,
  className = ''
}: {
  value: T
  options: DropdownOption<T>[]
  onChange: (val: T) => void
  icon?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const selectedOpt = options.find(o => o.value === value) || options[0]

  return (
    <div ref={containerRef} className={`relative inline-block text-left ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className={`h-10 inline-flex items-center justify-between gap-2 rounded-xl border bg-surface-2 px-3.5 text-xs font-medium text-text-1 shadow-2xs transition-all hover:bg-surface-1 cursor-pointer select-none ${
          open ? 'border-accent ring-2 ring-accent/15 bg-surface-1' : 'border-bd hover:border-bd-strong'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {icon && <span className="text-xs">{icon}</span>}
          <span className="truncate max-w-[150px]">{selectedOpt?.label ?? value}</span>
          {typeof selectedOpt?.count === 'number' && (
            <span className="text-text-4 font-normal">({selectedOpt.count})</span>
          )}
        </div>
        <svg
          className={`h-3.5 w-3.5 text-text-3 transition-transform duration-200 ${open ? 'rotate-180 text-accent' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div className="animate-fadeIn absolute left-0 top-[calc(100%+6px)] z-50 min-w-full w-max max-w-[280px] max-h-64 overflow-y-auto rounded-xl border border-bd bg-surface-1 p-1.5 shadow-2xl">
          {options.map(opt => {
            const isSelected = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs transition-colors text-left cursor-pointer ${
                  isSelected
                    ? 'bg-accent/10 font-semibold text-accent'
                    : 'text-text-2 hover:bg-surface-2 hover:text-text-1'
                }`}
              >
                <span className="truncate">
                  {opt.label}
                  {typeof opt.count === 'number' ? ` (${opt.count})` : ''}
                </span>
                {isSelected && (
                  <svg className="h-3.5 w-3.5 text-accent shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}


/** macOS 风格经典天蓝色矢量立体文件夹图标 */
export function MacOSFolderIcon({
  size = 64,
  className = ''
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`drop-shadow-sm select-none shrink-0 ${className}`}
    >
      {/* 1. 文件夹深蓝背板与上方 Tab */}
      <path
        d="M6 14C6 9.58172 9.58172 6 14 6H34.5C37.5 6 40.2 7.8 41.5 10.5L43.8 15H86C90.4183 15 94 18.5817 94 23V68C94 72.4183 90.4183 76 86 76H14C9.58172 76 6 72.4183 6 68V14Z"
        fill="#2563EB"
      />
      {/* 2. 文件夹开口暗色内衬 */}
      <rect x="10" y="17" width="80" height="15" rx="3" fill="#1D4ED8" />
      {/* 3. 文件夹露出纸张微白横条（提供细腻物理拟物感） */}
      <rect x="16" y="14" width="68" height="6" rx="2" fill="#DBEAFE" fillOpacity="0.9" />
      {/* 4. 文件夹主前盖（经典 Apple macOS 天蓝色） */}
      <path
        d="M6 26C6 22.6863 8.68629 20 12 20H88C91.3137 20 94 22.6863 94 26V68C94 72.4183 90.4183 76 86 76H14C9.58172 76 6 72.4183 6 68V26Z"
        fill="#3B82F6"
      />
      {/* 5. 前盖顶部高光微凸倒角 */}
      <path
        d="M6 26C6 22.6863 8.68629 20 12 20H88C91.3137 20 94 22.6863 94 26V28H6V26Z"
        fill="#93C5FD"
        fillOpacity="0.8"
      />
      {/* 6. 前盖底缘微妙投影衬底 */}
      <path
        d="M14 76H86C90.4183 76 94 72.4183 94 68V70C94 74.4183 90.4183 78 86 78H14C9.58172 78 6 74.4183 6 70V68C6 72.4183 9.58172 76 14 76Z"
        fill="#1D4ED8"
        fillOpacity="0.5"
      />
    </svg>
  )
}

/** macOS 风格折角文档图标（根据后缀提供专用色带与徽标） */
export function MacOSDocumentIcon({
  filename,
  type,
  size = 64,
  className = ''
}: {
  filename?: string
  type?: string
  size?: number
  className?: string
}) {
  let ext = type?.toUpperCase()
  if (ext !== 'M4A' && ext !== 'DISABLED' && filename) {
    const cleanFn = filename.replace(/\s*\([^)]*\)\s*$/, '').trim()
    const m = cleanFn.match(/\.([a-zA-Z0-9]{2,5})$/)
    if (m) {
      const fnExt = m[1].toUpperCase()
      const recognizedExts = [
        'PDF', 'PPT', 'PPTX', 'DOC', 'DOCX', 'XLS', 'XLSX', 'ZIP', 'RAR', '7Z', 'TXT',
        'MP4', 'MP3', 'FLV', 'MKV', 'AVI', 'MOV', 'WAV', 'AAC', 'PNG', 'JPG', 'JPEG', 'MD', 'PY', 'TS', 'JS'
      ]
      if (recognizedExts.includes(fnExt)) {
        ext = fnExt
      } else if (!ext) {
        ext = fnExt
      }
    }
  }
  ext = ext || 'FILE'

  let ribbonColor = '#64748B'
  let label = ext
  let isVideo = false
  let isAudio = false
  let isImage = false

  if (ext === 'PDF') {
    ribbonColor = '#EF4444'
    label = 'PDF'
  } else if (ext === 'PPT' || ext === 'PPTX') {
    ribbonColor = '#F97316'
    label = 'PPT'
  } else if (ext === 'DOC' || ext === 'DOCX') {
    ribbonColor = '#3B82F6'
    label = 'DOC'
  } else if (ext === 'XLS' || ext === 'XLSX' || ext === 'CSV') {
    ribbonColor = '#10B981'
    label = 'XLS'
  } else if (['MP4', 'MKV', 'AVI', 'MOV', 'FLV', 'TS', 'VIDEO'].includes(ext)) {
    ribbonColor = '#6366F1'
    label = 'MP4'
    isVideo = true
  } else if (['MP3', 'WAV', 'M4A', 'FLAC', 'AAC', 'AUDIO'].includes(ext)) {
    ribbonColor = '#06B6D4'
    label = 'MP3'
    isAudio = true
  } else if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ'].includes(ext)) {
    ribbonColor = '#D97706'
    label = 'ZIP'
  } else if (['PNG', 'JPG', 'JPEG', 'GIF', 'WEBP', 'SVG'].includes(ext)) {
    ribbonColor = '#EC4899'
    label = ext.slice(0, 4)
    isImage = true
  } else if (['TXT', 'MD', 'JSON', 'JS', 'TS', 'PY', 'C', 'CPP', 'JAVA', 'HTML', 'CSS'].includes(ext)) {
    ribbonColor = '#8B5CF6'
    label = ext.slice(0, 4)
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 72 84"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`drop-shadow-sm select-none shrink-0 ${className}`}
    >
      {/* 纸张轮廓：带右上角折角切口 */}
      <path
        d="M8 8C8 4.68629 10.6863 2 14 2H50L64 16V76C64 79.3137 61.3137 82 58 82H14C10.6863 82 8 79.3137 8 76V8Z"
        fill="#FFFFFF"
        stroke="#CBD5E1"
        strokeWidth="1.2"
      />
      {/* 折角三角形 */}
      <path
        d="M50 2V13C50 14.6569 51.3431 16 53 16H64L50 2Z"
        fill="#E2E8F0"
        stroke="#CBD5E1"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* 中心特色徽标 */}
      {isVideo ? (
        <>
          <circle cx="36" cy="40" r="13" fill={ribbonColor} fillOpacity="0.15" />
          <polygon points="32,33 44,40 32,47" fill={ribbonColor} />
        </>
      ) : isAudio ? (
        <path d="M38 31V45C38 47 36 49 33 49C30.5 49 29 47.5 29 45.5C29 43.5 30.5 42 33 42C34.5 42 35.8 42.6 36.5 43.5V34L45 32V42C45 44 43 46 40 46C37.5 46 36 44.5 36 42.5C36 40.5 37.5 39 40 39C41.5 39 42.8 39.6 43.5 40.5V31L38 31Z" fill={ribbonColor} />
      ) : isImage ? (
        <g fill={ribbonColor}>
          <circle cx="28" cy="36" r="3.5" />
          <path d="M22 47L30 38L37 45L43 39L50 47H22Z" fillOpacity="0.8" />
        </g>
      ) : (
        <g fill="#E2E8F0">
          <rect x="18" y="26" width="24" height="2.5" rx="1.2" />
          <rect x="18" y="32" width="36" height="2.5" rx="1.2" />
          <rect x="18" y="38" width="30" height="2.5" rx="1.2" />
        </g>
      )}

      {/* 底部醒目色带与扩展名 */}
      <rect x="8" y="55" width="56" height="19" fill={ribbonColor} />
      <text
        x="36"
        y="68.5"
        fill="#FFFFFF"
        fontSize="10"
        fontWeight="800"
        textAnchor="middle"
        fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif"
        letterSpacing="0.5"
      >
        {label}
      </text>
    </svg>
  )
}

/** macOS 风格圆圈复选框（用于网格视图批量勾选与选中标识） */
export function MacOSCircleCheckbox({
  checked = false,
  state,
  onClick,
  className = '',
  size = 'md'
}: {
  checked?: boolean
  state?: TriState
  onClick?: (e: React.MouseEvent) => void
  className?: string
  size?: 'sm' | 'md'
}) {
  const isChecked = state ? state === 'all' : checked
  const isIndeterminate = state === 'some'
  const isSelected = isChecked || isIndeterminate
  const wh = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex items-center justify-center rounded-full transition-all duration-150 cursor-pointer ${wh} ${
        isSelected
          ? 'bg-accent text-white shadow-2xs scale-100 ring-2 ring-white/60'
          : 'bg-surface-1/90 border border-bd text-transparent hover:border-accent/80 hover:bg-surface-2 shadow-2xs'
      } ${className}`}
      title={isChecked ? '取消勾选' : '勾选此项'}
    >
      {isChecked && (
        <svg className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2.5 6 4.8 8.5 9.5 3.5" />
        </svg>
      )}
      {isIndeterminate && (
        <div className={size === 'sm' ? 'w-2 h-0.5 bg-white rounded-full' : 'w-2.5 h-0.5 bg-white rounded-full'} />
      )}
    </button>
  )
}

/** 网盘式导航视图模式切换器（对齐 macOS Finder 顺序：图标 / 列表 / 分栏，带平滑滑动胶囊动效） */
export function NetdiskViewModeSwitch({
  mode,
  onChange
}: {
  mode: CourseViewMode
  onChange: (m: CourseViewMode) => void
}) {
  // 对齐 macOS Finder 标准工具栏顺序: [图标 (grid)] [列表 (list)] [分栏 (column)]
  const modes: CourseViewMode[] = ['grid', 'list', 'column']
  const activeIdx = modes.indexOf(mode)

  return (
    <div className="relative flex h-9 items-center rounded-xl border border-bd bg-surface-2 p-0.5 shadow-2xs select-none">
      {/* 弹性滑动胶囊背景 (Sliding Pill Indicator) */}
      <div
        className="absolute top-0.5 bottom-0.5 w-8 rounded-lg bg-surface-1 shadow-2xs transition-transform duration-200 ease-out pointer-events-none"
        style={{
          transform: `translateX(${Math.max(0, activeIdx) * 32}px)`
        }}
      />
      <button
        type="button"
        onClick={() => onChange('grid')}
        className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-lg transition-colors cursor-pointer ${
          mode === 'grid' ? 'text-accent font-semibold' : 'text-text-3 hover:text-text-1'
        }`}
        title="图标视图 (Icon / Grid)"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
          <rect x="2" y="2" width="5" height="5" rx="1.2" />
          <rect x="9" y="2" width="5" height="5" rx="1.2" />
          <rect x="2" y="9" width="5" height="5" rx="1.2" />
          <rect x="9" y="9" width="5" height="5" rx="1.2" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onChange('list')}
        className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-lg transition-colors cursor-pointer ${
          mode === 'list' ? 'text-accent font-semibold' : 'text-text-3 hover:text-text-1'
        }`}
        title="列表视图 (List)"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <line x1="2.5" y1="3.5" x2="13.5" y2="3.5" />
          <line x1="2.5" y1="8" x2="13.5" y2="8" />
          <line x1="2.5" y1="12.5" x2="13.5" y2="12.5" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onChange('column')}
        className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-lg transition-colors cursor-pointer ${
          mode === 'column' ? 'text-accent font-semibold' : 'text-text-3 hover:text-text-1'
        }`}
        title="分栏视图 (Column)"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="2" y="2" width="3.5" height="12" rx="1" fill="currentColor" fillOpacity="0.2" />
          <rect x="6.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" fillOpacity="0.2" />
          <rect x="11" y="2" width="3" height="12" rx="1" fill="currentColor" fillOpacity="0.2" />
        </svg>
      </button>
    </div>
  )
}


