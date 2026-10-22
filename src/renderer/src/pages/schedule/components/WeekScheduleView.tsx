import { useMemo } from 'react'
import { DropdownSelect, type DropdownOption, type DropdownGroup } from '../../../components/widgets'
import type React from 'react'
import type { ScheduleWeek, ScheduleEvent, JiaowuScheduleResult } from '@shared/types'
import { isSafeExternalUrl, cleanParenthesesInTitle } from '@shared/utils'
import type { PlacedEvent, DayEventCluster } from '../schedule-types'
import {
  SJTU_TIME_SLOTS,
  formatEventTime,
  getEventDisplayTime,
  getAssignmentStatusInfo
} from '../schedule-helpers'
import { LockDeadlineBadge } from './ScheduleBadges'
import { UndatedAssignmentsDrawer } from './UndatedAssignmentsDrawer'

interface WeekDayInfo {
  dayIndex: number
  dateStr: string
  dayLabel: string
  shortDate: string
  isToday: boolean
}

interface WeekScheduleViewProps {
  isCurrentMode: boolean
  weeks: ScheduleWeek[]
  selectedWeekKey: string
  setSelectedWeekKey: (k: string) => void
  selectedWeekIndex: number
  regularTermWeeks: ScheduleWeek[]
  breakWeeks: ScheduleWeek[]
  currentWeek: string
  semesterTitle: string
  selectedWeekObj: ScheduleWeek | null | undefined
  currentJiaowuResult: JiaowuScheduleResult | null
  selectedJiaowuWeek: number
  setSelectedJiaowuWeek: (fn: number | ((prev: number) => number)) => void
  undatedAssignments: ScheduleEvent[]
  showUndatedPopover: boolean
  setShowUndatedPopover: (fn: boolean | ((prev: boolean) => boolean)) => void
  weekDays: WeekDayInfo[]
  dayTopEvents: Map<string, ScheduleEvent[]>
  hasAnyTopEvents: boolean
  dayClusters: Map<number, DayEventCluster[]>
  occupiedSlots: Set<string>
  hasNoonEvents: boolean
  expandNoonSlot: boolean
  setExpandNoonSlot: (v: boolean) => void
  handleOpenCourseModal: (title: string) => void
  handleCardMouseEnter: (item: PlacedEvent, e: React.MouseEvent<HTMLElement>) => void
  handleCardMouseLeave: () => void
}

export function WeekScheduleView({
  isCurrentMode,
  weeks,
  selectedWeekKey,
  setSelectedWeekKey,
  selectedWeekIndex,
  regularTermWeeks,
  breakWeeks,
  currentWeek,
  semesterTitle,
  selectedWeekObj,
  currentJiaowuResult,
  selectedJiaowuWeek,
  setSelectedJiaowuWeek,
  undatedAssignments,
  showUndatedPopover,
  setShowUndatedPopover,
  weekDays,
  dayTopEvents,
  hasAnyTopEvents,
  dayClusters,
  occupiedSlots,
  hasNoonEvents,
  expandNoonSlot,
  setExpandNoonSlot,
  handleOpenCourseModal,
  handleCardMouseEnter,
  handleCardMouseLeave
}: WeekScheduleViewProps) {
  const currentWeekGroups: DropdownGroup<string>[] = useMemo(() => {
    const res: DropdownGroup<string>[] = [
      {
        label: `${semesterTitle || '秋季学期'} 正序`,
        options: regularTermWeeks.map(w => ({
          value: `${w.title || ''}_${w.week}`,
          label: `${w.week}${w.week === currentWeek ? ' · 当前周' : ''}`
        }))
      }
    ]
    if (breakWeeks.length > 0) {
      res.push({
        label: '假期周次',
        options: breakWeeks.map(w => ({
          value: `${w.title || ''}_${w.week}`,
          label: `${w.title} - ${w.week}`
        }))
      })
    }
    return res
  }, [regularTermWeeks, breakWeeks, currentWeek, semesterTitle])

  const jiaowuWeekOptions: DropdownOption<number>[] = useMemo(
    () => Array.from({ length: 18 }, (_, idx) => idx + 1).map(wNum => ({
      value: wNum,
      label: `第 ${wNum} 周`
    })),
    []
  )

  return (
    <div className="flex flex-col gap-4">
      {/* 周次导航条 (声明 relative z-30 防止展开抽屉时日历表头漂浮在上方) */}
      <div className="relative z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-bd bg-surface-2/60 p-3 shadow-2xs backdrop-blur-sm">
        <div className="flex items-center gap-2">
          {isCurrentMode ? (
            <>
              <button
                type="button"
                disabled={selectedWeekIndex <= 0}
                onClick={() => {
                  if (selectedWeekIndex > 0) {
                    const prev = weeks[selectedWeekIndex - 1]
                    setSelectedWeekKey(`${prev.title || ''}_${prev.week}`)
                  }
                }}
                className="rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-2 hover:border-bd-strong hover:text-text-1 disabled:opacity-30 cursor-pointer shadow-2xs transition-all active:scale-[0.98]"
                title="上一周"
              >
                ‹ 上一周
              </button>

              {weeks.length > 0 ? (
                <DropdownSelect
                  value={selectedWeekKey}
                  onChange={setSelectedWeekKey}
                  groups={currentWeekGroups}
                  buttonClassName="font-semibold"
                  title="选择周次"
                />
              ) : (
                <span className="text-xs font-semibold text-text-1">本周日程</span>
              )}

              <button
                type="button"
                disabled={selectedWeekIndex < 0 || selectedWeekIndex >= weeks.length - 1}
                onClick={() => {
                  if (selectedWeekIndex >= 0 && selectedWeekIndex < weeks.length - 1) {
                    const next = weeks[selectedWeekIndex + 1]
                    setSelectedWeekKey(`${next.title || ''}_${next.week}`)
                  }
                }}
                className="rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-2 hover:border-bd-strong hover:text-text-1 disabled:opacity-30 cursor-pointer shadow-2xs transition-all active:scale-[0.98]"
                title="下一周"
              >
                下一周 ›
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={selectedJiaowuWeek <= 1}
                onClick={() => setSelectedJiaowuWeek(w => Math.max(1, (w as number) - 1))}
                className="rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-2 hover:border-bd-strong hover:text-text-1 disabled:opacity-30 cursor-pointer shadow-2xs transition-all active:scale-[0.98]"
                title="上一周"
              >
                ‹ 上一周
              </button>

              <DropdownSelect<number>
                value={selectedJiaowuWeek}
                onChange={setSelectedJiaowuWeek}
                options={jiaowuWeekOptions}
                buttonClassName="font-semibold"
                title="选择教务周次"
              />

              <button
                type="button"
                disabled={selectedJiaowuWeek >= 18}
                onClick={() => setSelectedJiaowuWeek(w => Math.min(18, (w as number) + 1))}
                className="rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-2 hover:border-bd-strong hover:text-text-1 disabled:opacity-30 cursor-pointer shadow-2xs transition-all active:scale-[0.98]"
                title="下一周"
              >
                下一周 ›
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs font-mono text-text-3">
          {isCurrentMode && undatedAssignments.length > 0 && (
            <UndatedAssignmentsDrawer
              isOpen={showUndatedPopover}
              onToggle={() => setShowUndatedPopover(p => !p)}
              onClose={() => setShowUndatedPopover(false)}
              assignments={undatedAssignments}
            />
          )}
          {isCurrentMode && selectedWeekObj && (
            <span>
              {selectedWeekObj.startTime.slice(0, 10)} ~ {selectedWeekObj.endTime.slice(0, 10)}
            </span>
          )}
          {!isCurrentMode && currentJiaowuResult && (
            <span className="rounded-lg bg-surface-1 px-2.5 py-1 text-2xs text-text-2 border border-bd">
              {currentJiaowuResult.termTitle} · 第 {selectedJiaowuWeek} 周课表
            </span>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
         水平严格对齐二维时间网格 (8 列: 时段标尺 96px + 周一至周日)
         ══════════════════════════════════════════════════════════ */}
      <div className="overflow-x-auto rounded-2xl border border-bd/70 dark:border-white/[0.06] bg-surface-1 shadow-2xs">
        <div className="min-w-[920px]">
          {/* 1. 顶部星期标头 */}
          <div className="grid grid-cols-[96px_repeat(7,minmax(0,1fr))] border-b border-bd/50 dark:border-white/[0.05] bg-surface-2/60">
            <div className="min-w-0 flex items-center justify-center border-r border-bd/50 dark:border-white/[0.05] p-3 text-xs font-semibold text-text-3 select-none">
              时段 \ 星期
            </div>
            {weekDays.map(day => (
              <div
                key={day.dayIndex}
                className={`min-w-0 flex flex-col items-center justify-center border-r border-bd/50 dark:border-white/[0.05] p-2.5 last:border-r-0 ${
                  day.isToday ? 'bg-accent/10 text-accent font-semibold' : 'text-text-2'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold">{day.dayLabel}</span>
                  {day.isToday && (
                    <span className="rounded-full bg-accent px-1.5 py-0.2 text-3xs font-bold text-white">
                      今天
                    </span>
                  )}
                </div>
                <span className="text-2xs font-mono text-text-3 opacity-80 mt-0.5">
                  {day.shortDate}
                </span>
              </div>
            ))}
          </div>

          {/* 2. 全天安排与作业 DDL 顶置行（仅当本周有全天事件/DDL 时展开） */}
          {hasAnyTopEvents && (
            <div className="grid grid-cols-[96px_repeat(7,minmax(0,1fr))] border-b border-bd/50 dark:border-white/[0.05] bg-surface-2/30">
              <div className="min-w-0 flex flex-col items-center justify-center border-r border-bd/50 dark:border-white/[0.05] p-2 text-2xs text-text-3 font-medium select-none">
                <span>全天 / 截止</span>
                <span className="text-3xs text-text-4 font-mono">DDL</span>
              </div>
              {weekDays.map(day => {
                const topList = dayTopEvents.get(day.dateStr) || []
                return (
                  <div
                    key={`top-${day.dateStr}`}
                    className={`min-w-0 border-r border-bd/50 dark:border-white/[0.05] p-1.5 last:border-r-0 space-y-1 ${
                      day.isToday ? 'bg-accent/[0.03]' : ''
                    }`}
                  >
                    {topList.map(item => {
                      const statusInfo = getAssignmentStatusInfo(item.submissionStatus, item.score)
                      const canOpen = Boolean(item.htmlUrl && isSafeExternalUrl(item.htmlUrl))

                      return (
                        <div
                          key={item.id}
                          onClick={() => {
                            if (canOpen && item.htmlUrl) {
                              void window.api.openExternal(item.htmlUrl)
                            }
                          }}
                          className={`group rounded-xl border p-2 text-2xs transition-all shadow-2xs ${
                            statusInfo.cardBorderClass
                          } ${statusInfo.cardBgClass} ${statusInfo.cardTextClass} ${
                            canOpen
                              ? 'cursor-pointer hover:shadow-md hover:scale-[1.01] active:scale-[0.99]'
                              : ''
                          }`}
                          title={canOpen ? '点击前往 Canvas 查看作业详情 ↗' : undefined}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <span className="font-semibold line-clamp-2 leading-tight flex items-center gap-1">
                              {cleanParenthesesInTitle(item.title)}
                              {canOpen && (
                                <span className="opacity-0 group-hover:opacity-100 transition-opacity text-3xs shrink-0 font-normal">
                                  ↗
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-3xs font-bold">
                              {statusInfo.label}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-1 text-3xs opacity-80">
                            <span className="truncate">{cleanParenthesesInTitle(item.courseName || '作业')}</span>
                            <div className="flex items-center gap-1 shrink-0 font-mono font-medium">
                              {item.isLockAtDeadline && <LockDeadlineBadge compact />}
                              <span>{formatEventTime(item.endTime) || '截止'}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}

          {/* 3. 6 大标准时段水平严格对齐 + 跨行贯通统一网格 */}
          <div
            className="grid grid-cols-[96px_repeat(7,minmax(0,1fr))] relative"
            style={{
              gridTemplateRows:
                !hasNoonEvents && !expandNoonSlot
                  ? 'minmax(110px,auto) minmax(110px,auto) 36px minmax(110px,auto) minmax(110px,auto) minmax(110px,auto)'
                  : 'repeat(6, minmax(110px, auto))'
            }}
          >
            {/* A. 左侧时段标尺列 (Column 1, Rows 1..6) */}
            {SJTU_TIME_SLOTS.map(slot => {
              const isNoonSlot = slot.id === 3
              if (isNoonSlot && !hasNoonEvents && !expandNoonSlot) {
                return (
                  <div
                    key={`ruler-${slot.id}`}
                    style={{ gridColumn: 1, gridRow: 3 }}
                    onClick={() => setExpandNoonSlot(true)}
                    className="min-w-0 flex items-center justify-center border-b border-r border-bd/50 dark:border-white/[0.05] bg-surface-2/20 hover:bg-surface-2/40 cursor-pointer p-1 text-center select-none group"
                    title="点击展开中午第 5-6 节时段 · 12:00 - 13:40"
                  >
                    <span className="text-3xs text-text-4 font-mono group-hover:text-text-2">
                      第 5-6 节 ▾
                    </span>
                  </div>
                )
              }

              return (
                <div
                  key={`ruler-${slot.id}`}
                  style={{ gridColumn: 1, gridRow: slot.id }}
                  className={`min-w-0 flex flex-col items-center justify-center border-b border-r border-bd/50 dark:border-white/[0.05] bg-surface-2/40 p-2 text-center select-none ${
                    slot.id === 6 ? 'border-b-0' : ''
                  }`}
                >
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-3xs font-medium text-text-3 px-1 py-0.5 rounded bg-surface-3">
                      {slot.periodHint}
                    </span>
                    {isNoonSlot && !hasNoonEvents && expandNoonSlot && (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          setExpandNoonSlot(false)
                        }}
                        className="text-3xs text-text-4 hover:text-text-2 cursor-pointer"
                        title="折叠中午时段"
                      >
                        ▴
                      </button>
                    )}
                  </div>
                  <span className="text-xs font-semibold text-text-1 tracking-tight">
                    {slot.slotLabel}
                  </span>
                  <span className="text-3xs font-mono text-text-3 mt-0.5">{slot.timeRange}</span>
                </div>
              )
            })}

            {/* B. 背景网格单元格 (Columns 2..8, Rows 1..6) */}
            {weekDays.map(day =>
              SJTU_TIME_SLOTS.map(slot => {
                const isNoonSlot = slot.id === 3
                if (isNoonSlot && !hasNoonEvents && !expandNoonSlot) {
                  return (
                    <div
                      key={`bg-${day.dayIndex}-3`}
                      style={{ gridColumn: day.dayIndex + 2, gridRow: 3 }}
                      onClick={() => setExpandNoonSlot(true)}
                      className={`min-w-0 border-b border-r border-bd/50 dark:border-white/[0.05] bg-surface-2/20 hover:bg-surface-2/40 cursor-pointer flex items-center justify-center ${
                        day.dayIndex === 6 ? 'border-r-0' : ''
                      }`}
                      title="点击展开中午第 5-6 节"
                    >
                      {day.dayIndex === 0 && (
                        <span className="text-3xs text-text-4 font-sans select-none opacity-80">
                          ☀️ 中午时段 (12:00 - 13:40) · 本周无排课 · 点击展开
                        </span>
                      )}
                    </div>
                  )
                }

                const isOccupied = occupiedSlots.has(`${day.dayIndex}-${slot.id}`)
                return (
                  <div
                    key={`bg-${day.dayIndex}-${slot.id}`}
                    style={{ gridColumn: day.dayIndex + 2, gridRow: slot.id }}
                    className={`min-w-0 border-b border-r border-bd/50 dark:border-white/[0.05] p-1.5 transition-colors ${
                      day.dayIndex === 6 ? 'border-r-0' : ''
                    } ${slot.id === 6 ? 'border-b-0' : ''} ${
                      day.isToday ? 'bg-accent/[0.02]' : ''
                    } ${isOccupied ? '' : 'hover:bg-surface-2/20'}`}
                  />
                )
              })
            )}

            {/* C. 跨行与标准事件卡片簇 (Columns 2..8, Row Span 1..3) */}
            {weekDays.map(day => {
              const clusters = dayClusters.get(day.dayIndex) || []
              return clusters.map(cluster => (
                <div
                  key={`cluster-${day.dayIndex}-${cluster.startSlot}-${cluster.endSlot}`}
                  style={{
                    gridColumn: day.dayIndex + 2,
                    gridRow: `${cluster.startSlot} / ${cluster.endSlot + 1}`,
                    zIndex: 10
                  }}
                  className="min-w-0 p-1.5 flex flex-row gap-1.5 pointer-events-auto h-full"
                >
                  {cluster.events.map(item => {
                    // 1. 讲座/活动卡片
                    if (item.type === 'activity') {
                      return (
                        <div
                          key={item.id}
                          onClick={() => handleOpenCourseModal(item.title)}
                          onMouseEnter={e => handleCardMouseEnter(item, e)}
                          onMouseLeave={handleCardMouseLeave}
                          className="group relative h-full flex flex-col justify-between rounded-xl border border-purple-500/20 dark:border-purple-500/25 bg-purple-500/5 dark:bg-[#231e2b] p-2 text-2xs hover:border-purple-500/40 hover:shadow-2xs transition-all overflow-hidden flex-1 min-w-0 cursor-pointer"
                          title="点击查看详情"
                        >
                          <div className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-purple-500" />
                          <div className="pl-1.5 flex flex-col h-full justify-between">
                            <div>
                              <div className="flex items-start justify-between gap-1 text-purple-700 dark:text-purple-400 font-semibold">
                                <span className="leading-tight break-words">{cleanParenthesesInTitle(item.title)}</span>
                                <span className="shrink-0 rounded bg-purple-500/15 px-1 py-0.2 text-3xs font-bold">
                                  讲座
                                </span>
                              </div>
                              <div className="mt-1 space-y-0.5 text-3xs text-text-3 font-mono">
                                <div>
                                  🕒 {formatEventTime(item.startTime)} ~ {formatEventTime(item.endTime)}
                                </div>
                                {item.location && (
                                  <div className="text-text-2 truncate font-sans">
                                    📍 {item.location}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    }

                    // 2. 超长实验课 / 多时段连堂大课 (span >= 3 或 isLabOrLongSession, 如周一下午 5-10 节有机化学实验、周四 6-9 节创新实验)
                    if (item.isLabOrLongSession || cluster.span >= 3) {
                      return (
                        <div
                          key={item.id}
                          onClick={() => handleOpenCourseModal(item.title)}
                          onMouseEnter={e => handleCardMouseEnter(item, e)}
                          onMouseLeave={handleCardMouseLeave}
                          className="group relative h-full flex flex-col justify-between rounded-xl border border-teal-500/30 dark:border-teal-500/35 bg-surface-1 dark:bg-[#182622] p-2.5 text-2xs hover:border-teal-500/60 hover:shadow-2xs transition-all overflow-hidden flex-1 min-w-0 cursor-pointer"
                          title="点击查看课程全学期课表明细与教学信息"
                        >
                          <div className="absolute left-0 top-1.5 bottom-1.5 w-1.5 rounded-r bg-teal-500 shadow-sm" />
                          <div className="pl-2 flex flex-col h-full justify-between gap-2">
                            <div>
                              <div>
                                <div className="font-bold text-text-1 text-xs md:text-sm leading-snug break-words">
                                  {cleanParenthesesInTitle(item.title)}
                                </div>
                              </div>

                              <div className="mt-2 space-y-1 text-3xs">
                                <div className="text-teal-600 dark:text-teal-400 font-mono font-semibold text-2xs flex items-center gap-1.5 flex-wrap">
                                  <span>🕒 {getEventDisplayTime(item)}</span>
                                  {item.badge && (
                                    <span className="rounded bg-teal-500/15 dark:bg-teal-500/25 px-1 py-0.2 text-3xs font-semibold text-teal-700 dark:text-teal-300">
                                      {item.badge}
                                    </span>
                                  )}
                                </div>
                                {item.location && item.location !== '不排教室' && (
                                  <div className="text-text-1 font-medium font-sans flex items-start gap-1">
                                    <span>📍</span>
                                    <span className="leading-tight break-words">{item.location}</span>
                                  </div>
                                )}
                                {item.teacher && (
                                  <div className="text-text-2 font-sans flex items-center gap-1">
                                    <span>👨‍🏫</span>
                                    <span className="truncate">{item.teacher}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {(item.jxbmc || item.description || item.xf) && (
                              <div className="pt-2 border-t border-teal-500/15 dark:border-teal-500/20 text-3xs text-text-3 space-y-0.5 font-sans">
                                {item.jxbmc && (
                                  <div className="truncate text-text-3">
                                    🎓 班级: {item.jxbmc}
                                  </div>
                                )}
                                {item.xf && (
                                  <div className="font-mono text-teal-700 dark:text-teal-300">
                                    ⭐ 学分: {item.xf} 学分
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    }

                    // 3. 2 个时段跨行大课 (span === 2, 如 6-8 节思政大课 12:55~15:40)
                    if (cluster.span === 2 || item.startTime.includes('6-8')) {
                      return (
                        <div
                          key={item.id}
                          onClick={() => handleOpenCourseModal(item.title)}
                          onMouseEnter={e => handleCardMouseEnter(item, e)}
                          onMouseLeave={handleCardMouseLeave}
                          className="group relative h-full flex flex-col justify-between rounded-xl border border-sky-500/30 dark:border-sky-500/35 bg-surface-1 dark:bg-[#1a232b] p-2.5 text-2xs hover:border-sky-500/60 hover:shadow-2xs transition-all overflow-hidden flex-1 min-w-0 cursor-pointer"
                          title="点击查看课程全学期课表明细与教学信息"
                        >
                          <div className="absolute left-0 top-1.5 bottom-1.5 w-1.5 rounded-r bg-sky-500 shadow-sm" />
                          <div className="pl-2 flex flex-col h-full justify-between gap-1.5">
                            <div>
                              <div>
                                <div className="font-bold text-text-1 text-xs md:text-sm leading-snug break-words">
                                  {cleanParenthesesInTitle(item.title)}
                                </div>
                              </div>

                              <div className="mt-1.5 space-y-1 text-3xs">
                                <div className="text-sky-600 dark:text-sky-400 font-mono font-semibold text-2xs">
                                  🕒 {getEventDisplayTime(item)}
                                </div>
                                {item.location && item.location !== '不排教室' && (
                                  <div className="text-text-1 font-medium font-sans">
                                    📍 {item.location}
                                  </div>
                                )}
                                {item.teacher && (
                                  <div className="text-text-2 font-sans truncate">
                                    👨‍🏫 {item.teacher}
                                  </div>
                                )}
                              </div>
                            </div>

                            {(item.jxbmc || item.description || item.xf) && (
                              <div className="pt-1.5 border-t border-sky-500/15 dark:border-sky-500/20 text-3xs text-text-3 font-sans truncate">
                                {item.jxbmc ? `🎓 ${item.jxbmc}` : item.description}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    }

                    // 4. 标准 1 时段课程
                    return (
                      <div
                        key={item.id}
                        onClick={() => handleOpenCourseModal(item.title)}
                        onMouseEnter={e => handleCardMouseEnter(item, e)}
                        onMouseLeave={handleCardMouseLeave}
                        className="group relative h-full flex flex-col justify-between rounded-xl border border-bd/70 dark:border-white/[0.06] bg-surface-1 dark:bg-[#232326] p-2 text-2xs hover:border-accent dark:hover:border-accent/60 hover:shadow-2xs transition-all overflow-hidden flex-1 min-w-0 cursor-pointer"
                        title="点击查看课程全学期课表明细与教学信息"
                      >
                        <div className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-accent" />
                        <div className="pl-1.5 flex flex-col h-full justify-between">
                          <div>
                            <div>
                              <div className="font-semibold text-text-1 leading-snug break-words">
                                {cleanParenthesesInTitle(item.title)}
                              </div>
                            </div>
                            <div className="mt-1 space-y-0.5 text-3xs text-text-3 font-mono">
                              <div className="text-accent font-medium">
                                🕒 {getEventDisplayTime(item)}
                              </div>
                              {item.location && item.location !== '不排教室' && (
                                <div className="text-text-2 truncate font-sans">
                                  📍 {item.location}
                                </div>
                              )}
                              {item.teacher && (
                                <div className="text-text-3 truncate font-sans">
                                  👨‍🏫 {item.teacher}
                                </div>
                              )}
                              {item.description && !isCurrentMode && (
                                <div className="text-text-4 truncate font-sans opacity-70">
                                  {item.description}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
