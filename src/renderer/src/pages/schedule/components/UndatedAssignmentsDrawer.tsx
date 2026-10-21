import { useRef } from 'react'
import type { ScheduleEvent } from '@shared/types'
import { isSafeExternalUrl } from '@shared/utils'
import { useClickOutside } from '../../../hooks/useClickOutside'
import { AssignmentStatusBadge } from './ScheduleBadges'

interface UndatedAssignmentsDrawerProps {
  isOpen: boolean
  onToggle: () => void
  onClose: () => void
  assignments: ScheduleEvent[]
}

export function UndatedAssignmentsDrawer({
  isOpen,
  onToggle,
  onClose,
  assignments
}: UndatedAssignmentsDrawerProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useClickOutside(containerRef, onClose, {
    enabled: isOpen,
    onEscape: onClose
  })

  if (assignments.length === 0) return null

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1 text-2xs font-sans font-medium text-amber-700 dark:text-amber-400 cursor-pointer transition-all shadow-2xs select-none"
        title="点击查看未标注截止日期的活跃作业"
      >
        <span>📌 {assignments.length} 项未标注日期</span>
        <span className="text-3xs opacity-70">▾</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-2xl border border-bd/80 dark:border-white/15 bg-surface-1/95 dark:bg-[#1c1c1e]/95 backdrop-blur-md p-4 shadow-xl z-30 transition-all duration-150 animate-in fade-in zoom-in-95 font-sans">
          <div className="flex items-center justify-between border-b border-bd/50 dark:border-white/10 pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-text-1">📌 未标注日期的作业</span>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-3xs font-semibold text-amber-700 dark:text-amber-400">
                {assignments.length} 项
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-text-3 hover:text-text-1 cursor-pointer transition-colors"
            >
              ✕
            </button>
          </div>
          <p className="text-3xs text-text-3 mb-3 leading-relaxed">
            此类作业在 Canvas 中未设置明确截止时间 (due_at) 与关闭时间 (lock_at)，建议及时查阅课程页面以防遗漏。
          </p>
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {assignments.map(item => (
              <div
                key={item.id}
                className="rounded-xl border border-bd/60 bg-surface-2/40 p-2.5 text-xs space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-text-1 text-2xs line-clamp-2 leading-snug">
                    {item.title}
                  </span>
                  <AssignmentStatusBadge status={item.submissionStatus} score={item.score} />
                </div>
                <div className="flex items-center justify-between text-3xs text-text-3">
                  <span className="truncate max-w-[180px]">{item.courseName || '未归类课程'}</span>
                  {item.htmlUrl && isSafeExternalUrl(item.htmlUrl) && (
                    <button
                      type="button"
                      onClick={() => {
                        if (item.htmlUrl) void window.api.openExternal(item.htmlUrl)
                      }}
                      className="text-accent hover:underline font-medium cursor-pointer"
                    >
                      打开作业 ↗
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
