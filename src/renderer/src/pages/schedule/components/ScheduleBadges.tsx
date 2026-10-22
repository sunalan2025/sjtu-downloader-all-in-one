import { getAssignmentStatusInfo } from '../schedule-helpers'

/** 锁定截止徽标：标明截止时间继承自 Canvas 课程锁定/关闭时间 (lock_at) */
export function LockDeadlineBadge({
  className = '',
  compact = false
}: {
  className?: string
  compact?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded border border-sky-500/20 bg-sky-500/10 px-1 py-0.5 text-3xs font-medium text-sky-600 dark:text-sky-400 font-sans select-none shrink-0 ${className}`}
      title="该作业未设置明确截止时间，截止时限自动继承自课程锁定关闭时间"
    >
      <span>🔒</span>
      <span>{compact ? '锁定' : '锁定截止'}</span>
    </span>
  )
}

/** 作业 4 态提交状态徽标组件 */
export function AssignmentStatusBadge({
  status,
  score,
  className = ''
}: {
  status?: 'submitted' | 'unsubmitted' | 'graded' | 'missing'
  score?: number | null
  className?: string
}) {
  const info = getAssignmentStatusInfo(status, score)
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-3xs font-bold ${info.badgeClass} ${className}`}
    >
      {info.label}
    </span>
  )
}
