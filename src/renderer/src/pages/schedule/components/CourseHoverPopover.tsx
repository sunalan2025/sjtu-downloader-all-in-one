import type { ScheduleEvent } from '@shared/types'
import { getEventDisplayTime } from '../schedule-helpers'
import { cleanParenthesesInTitle } from '@shared/utils'

export interface HoveredCourseInfo {
  item: ScheduleEvent
  rect: DOMRect
}

interface CourseHoverPopoverProps {
  hoveredCourseItem: HoveredCourseInfo | null
  hasOpenModal: boolean
}

export function CourseHoverPopover({
  hoveredCourseItem,
  hasOpenModal
}: CourseHoverPopoverProps) {
  if (!hoveredCourseItem || hasOpenModal) return null

  const { item, rect } = hoveredCourseItem
  const popoverWidth = 280
  let left = rect.left + rect.width / 2 - popoverWidth / 2
  if (left < 16) left = 16
  if (left + popoverWidth > window.innerWidth - 16) {
    left = window.innerWidth - popoverWidth - 16
  }

  const showAbove = rect.top > 200
  const top = showAbove ? rect.top - 8 : rect.bottom + 8

  return (
    <div
      style={{
        top: `${top}px`,
        left: `${left}px`,
        transform: showAbove ? 'translateY(-100%)' : 'none'
      }}
      className="fixed z-50 pointer-events-none w-[280px] rounded-2xl border border-bd-strong bg-surface-1 dark:bg-[#1c1c1e] p-3.5 shadow-xl transition-all duration-150 animate-in fade-in zoom-in-95"
    >
      <div className="space-y-2">
        {/* 顶部课程名称与学分徽标 */}
        <div className="space-y-1">
          <div className="font-bold text-sm text-text-1 leading-snug break-words tracking-tight">
            {cleanParenthesesInTitle(item.title)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {item.xf && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-3xs font-semibold text-accent">
                ⭐ {item.xf} 学分
              </span>
            )}
            {item.badge && (
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-3xs font-medium text-text-3">
                {item.badge}
              </span>
            )}
            {item.endTime && item.endTime.includes('周') && (
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-3xs font-semibold text-accent">
                🗓️ {item.endTime}
              </span>
            )}
            {item.type === 'activity' && (
              <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-3xs font-bold text-purple-600 dark:text-purple-400">
                讲座 / 活动
              </span>
            )}
          </div>
        </div>

        {/* 详细时间、地点与教师 (完整展示，绝不截断) */}
        <div className="space-y-1.5 pt-2 border-t border-bd text-xs">
          <div className="flex items-start gap-1.5 text-2xs">
            <span className="text-text-4 shrink-0 font-medium">🕒 时间:</span>
            <span className="font-mono text-accent font-medium leading-tight">
              {item.endTime && item.endTime.includes('周')
                ? `${item.startTime} (${item.endTime})`
                : getEventDisplayTime(item)}
            </span>
          </div>
          {item.location && item.location !== '不排教室' && (
            <div className="flex items-start gap-1.5 text-2xs">
              <span className="text-text-4 shrink-0 font-medium">📍 地点:</span>
              <span className="font-medium text-text-1 leading-tight break-words">
                {item.location}
              </span>
            </div>
          )}
          {item.teacher && (
            <div className="flex items-start gap-1.5 text-2xs">
              <span className="text-text-4 shrink-0 font-medium">👨‍🏫 教师:</span>
              <span className="text-text-2 leading-tight">
                {item.teacher}
              </span>
            </div>
          )}
          {(item.jxbmc || item.description) && (
            <div className="flex items-start gap-1.5 text-3xs">
              <span className="text-text-4 shrink-0">🎓 班级:</span>
              <span className="text-text-3 truncate">
                {item.jxbmc || item.description}
              </span>
            </div>
          )}
        </div>

        {/* 底部操作提示 */}
        <div className="pt-1.5 border-t border-bd/60 flex items-center justify-between text-3xs text-text-4">
          <span className="text-accent/90 font-medium">💡 点击查看完整课时与作业</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  )
}
