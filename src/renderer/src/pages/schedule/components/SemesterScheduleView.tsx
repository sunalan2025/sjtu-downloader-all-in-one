import type React from 'react'
import type { ScheduleEvent, JiaowuScheduleResult } from '@shared/types'
import { isSafeExternalUrl } from '@shared/utils'
import type {
  PlacedEvent,
  DayEventCluster,
  UniqueJiaowuCourse,
  SemesterCourseCardItem,
  JiaowuOverviewSummary
} from '../schedule-types'
import { SJTU_TIME_SLOTS } from '../schedule-helpers'
import { LockDeadlineBadge, AssignmentStatusBadge } from './ScheduleBadges'

export type { SemesterCourseCardItem, JiaowuOverviewSummary }

interface SemesterScheduleViewProps {
  isCurrentMode: boolean
  uniqueCourseNames: string[]
  courseEventsCount: number
  activityEventsCount: number
  ddlEventsCount: number
  ddlSubmittedCount: number
  currentJiaowuResult: JiaowuScheduleResult | null
  jiaowuOverview: JiaowuOverviewSummary | null
  overviewTab: 'courses' | 'activities' | 'assignments'
  setOverviewTab: (tab: 'courses' | 'activities' | 'assignments') => void
  overviewCourseView: 'grid' | 'cards'
  setOverviewCourseView: (v: 'grid' | 'cards') => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  hasSemesterNoonEvents: boolean
  expandSemesterNoonSlot: boolean
  setExpandSemesterNoonSlot: (v: boolean) => void
  semesterOccupiedSlots: Set<string>
  semesterDayClusters: Map<number, DayEventCluster[]>
  courseCardsCount: number
  filteredCourseCards: SemesterCourseCardItem[]
  filteredJiaowuCourses: UniqueJiaowuCourse[]
  filteredActivities: ScheduleEvent[]
  filteredAssignments: ScheduleEvent[]
  expandedCourseNames: Set<string>
  toggleCourseExpand: (name: string) => void
  handleOpenCourseModal: (title: string) => void
  handleCardMouseEnter: (item: PlacedEvent, e: React.MouseEvent<HTMLElement>) => void
  handleCardMouseLeave: () => void
}

export function SemesterScheduleView({
  isCurrentMode,
  uniqueCourseNames,
  courseEventsCount,
  activityEventsCount,
  ddlEventsCount,
  ddlSubmittedCount,
  currentJiaowuResult,
  jiaowuOverview,
  overviewTab,
  setOverviewTab,
  overviewCourseView,
  setOverviewCourseView,
  searchQuery,
  setSearchQuery,
  hasSemesterNoonEvents,
  expandSemesterNoonSlot,
  setExpandSemesterNoonSlot,
  semesterOccupiedSlots,
  semesterDayClusters,
  courseCardsCount,
  filteredCourseCards,
  filteredJiaowuCourses,
  filteredActivities,
  filteredAssignments,
  expandedCourseNames,
  toggleCourseExpand,
  handleOpenCourseModal,
  handleCardMouseEnter,
  handleCardMouseLeave
}: SemesterScheduleViewProps) {
  return (
    <div className="flex flex-col gap-6">
      {/* 顶部分类指标看板 (Apple 极简数字卡片) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-bd bg-surface-2/60 p-4 shadow-2xs backdrop-blur-sm">
          <div className="flex items-center justify-between text-xs text-text-3 font-medium">
            <span>{isCurrentMode ? '已选主修课程' : '官方排课门数'}</span>
            <span className="text-base">📚</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-text-1">
              {isCurrentMode
                ? uniqueCourseNames.length
                : jiaowuOverview?.uniqueCourses.length || 0}
            </span>
            <span className="text-xs text-text-3">门课程</span>
          </div>
        </div>

        <div className="rounded-2xl border border-bd bg-surface-2/60 p-4 shadow-2xs backdrop-blur-sm">
          <div className="flex items-center justify-between text-xs text-text-3 font-medium">
            <span>{isCurrentMode ? '学期排课总节数' : '学期总学分'}</span>
            <span className="text-base">⏰</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-text-1">
              {isCurrentMode
                ? courseEventsCount
                : jiaowuOverview?.totalCredits || 0}
            </span>
            <span className="text-xs text-text-3">
              {isCurrentMode ? '节课时' : '学分'}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-bd bg-surface-2/60 p-4 shadow-2xs backdrop-blur-sm">
          <div className="flex items-center justify-between text-xs text-text-3 font-medium">
            <span>{isCurrentMode ? '学术讲座与校园活动' : '任课教师阵容'}</span>
            <span className="text-base">🎙️</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-purple-600 dark:text-purple-400">
              {isCurrentMode
                ? activityEventsCount
                : jiaowuOverview?.uniqueTeachers.length || 0}
            </span>
            <span className="text-xs text-text-3">
              {isCurrentMode ? '场通知/讲座' : '位教师'}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-bd bg-surface-2/60 p-4 shadow-2xs backdrop-blur-sm">
          <div className="flex items-center justify-between text-xs text-text-3 font-medium">
            <span>{isCurrentMode ? 'Canvas 作业全景' : '学生学籍信息'}</span>
            <span className="text-base">📝</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
              {isCurrentMode
                ? ddlEventsCount
                : currentJiaowuResult?.studentName || '已同步'}
            </span>
            <span className="text-xs text-text-3">
              {isCurrentMode
                ? `项 (${ddlSubmittedCount} 项已交)`
                : currentJiaowuResult?.studentId || '教务认证'}
            </span>
          </div>
        </div>
      </div>

      {/* 总览子导航条与搜索 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bd pb-4">
        <div className="flex items-center gap-1.5 rounded-xl bg-surface-3 p-1 shadow-2xs">
          <button
            type="button"
            onClick={() => setOverviewTab('courses')}
            className={`rounded-lg px-3.5 py-1 text-xs font-medium transition-all cursor-pointer ${
              overviewTab === 'courses'
                ? 'bg-surface-1 text-text-1 shadow-2xs font-semibold'
                : 'text-text-3 hover:text-text-2'
            }`}
          >
            📚 课程列表 (
            {isCurrentMode
              ? courseCardsCount
              : jiaowuOverview?.uniqueCourses.length || 0}
            )
          </button>
          {isCurrentMode && (
            <>
              <button
                type="button"
                onClick={() => setOverviewTab('activities')}
                className={`rounded-lg px-3.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                  overviewTab === 'activities'
                    ? 'bg-surface-1 text-text-1 shadow-2xs font-semibold'
                    : 'text-text-3 hover:text-text-2'
                }`}
              >
                🎙️ 校园讲座/活动 ({activityEventsCount})
              </button>
              <button
                type="button"
                onClick={() => setOverviewTab('assignments')}
                className={`rounded-lg px-3.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                  overviewTab === 'assignments'
                    ? 'bg-surface-1 text-text-1 shadow-2xs font-semibold'
                    : 'text-text-3 hover:text-text-2'
                }`}
              >
                📝 作业 DDL 时间轴 ({ddlEventsCount})
              </button>
            </>
          )}
        </div>

        {/* 搜索框与视图切换 */}
        <div className="flex items-center gap-3">
          {overviewTab === 'courses' && (
            <div className="flex items-center gap-1 rounded-xl bg-surface-3 p-1 shadow-2xs">
              <button
                type="button"
                onClick={() => setOverviewCourseView('grid')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                  overviewCourseView === 'grid'
                    ? 'bg-surface-1 text-accent font-semibold shadow-2xs'
                    : 'text-text-3 hover:text-text-2'
                }`}
                title="全学期作息网格视图"
              >
                <span>🗓️</span>
                <span>作息网格</span>
              </button>
              <button
                type="button"
                onClick={() => setOverviewCourseView('cards')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                  overviewCourseView === 'cards'
                    ? 'bg-surface-1 text-accent font-semibold shadow-2xs'
                    : 'text-text-3 hover:text-text-2'
                }`}
                title="课程清单卡片视图"
              >
                <span>📋</span>
                <span>课程清单</span>
              </button>
            </div>
          )}

          <div className="relative">
            <input
              type="text"
              placeholder="搜索课程、教师、教室或作业…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-56 md:w-64 rounded-xl border border-bd bg-surface-1 py-1.5 pl-8 pr-3 text-xs text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none shadow-2xs"
            />
            <span className="absolute left-2.5 top-2 text-text-3 text-xs">🔍</span>
          </div>
        </div>
      </div>

      {/* ─── 模块 1: 按课程维度展示 (作息网格 vs 清单卡片) ─── */}
      {overviewTab === 'courses' && (
        overviewCourseView === 'grid' ? (
          /* ══════════════════════════════════════════
             全学期全景作息网格 (8 列: 时段标尺 96px + 周一至周日)
             与周视图完全一致，直观聚合全学期排课与周次范围！
             ══════════════════════════════════════════ */
          <div className="overflow-x-auto rounded-2xl border border-bd/70 dark:border-white/[0.06] bg-surface-1 shadow-2xs">
            <div className="min-w-[920px]">
              {/* 1. 顶部星期标头 (周一至周日) */}
              <div className="grid grid-cols-[96px_repeat(7,minmax(0,1fr))] border-b border-bd/50 dark:border-white/[0.05] bg-surface-2/60">
                <div className="min-w-0 flex items-center justify-center border-r border-bd/50 dark:border-white/[0.05] p-3 text-xs font-semibold text-text-3 select-none">
                  时段 \ 星期
                </div>
                {[
                  { label: '星期一', en: 'Mon' },
                  { label: '星期二', en: 'Tue' },
                  { label: '星期三', en: 'Wed' },
                  { label: '星期四', en: 'Thu' },
                  { label: '星期五', en: 'Fri' },
                  { label: '星期六', en: 'Sat' },
                  { label: '星期日', en: 'Sun' }
                ].map(day => (
                  <div
                    key={day.label}
                    className="min-w-0 flex flex-col items-center justify-center border-r border-bd/50 dark:border-white/[0.05] p-2.5 last:border-r-0 text-text-2"
                  >
                    <span className="text-xs font-semibold">{day.label}</span>
                    <span className="text-3xs font-mono text-text-3 opacity-70 mt-0.5">
                      {day.en}
                    </span>
                  </div>
                ))}
              </div>

              {/* 2. 6 大标准时段行统一网格 */}
              <div
                className="grid grid-cols-[96px_repeat(7,minmax(0,1fr))] relative"
                style={{
                  gridTemplateRows:
                    !hasSemesterNoonEvents && !expandSemesterNoonSlot
                      ? 'minmax(110px,auto) minmax(110px,auto) 36px minmax(110px,auto) minmax(110px,auto) minmax(110px,auto)'
                      : 'repeat(6, minmax(110px, auto))'
                }}
              >
                {/* A. 左侧时段标尺列 (Column 1, Rows 1..6) */}
                {SJTU_TIME_SLOTS.map(slot => {
                  const isNoonSlot = slot.id === 3
                  if (isNoonSlot && !hasSemesterNoonEvents && !expandSemesterNoonSlot) {
                    return (
                      <div
                        key={`sem-ruler-${slot.id}`}
                        style={{ gridColumn: 1, gridRow: 3 }}
                        onClick={() => setExpandSemesterNoonSlot(true)}
                        className="min-w-0 flex items-center justify-center border-b border-r border-bd/50 dark:border-white/[0.05] bg-surface-2/20 hover:bg-surface-2/40 cursor-pointer p-1 text-center select-none group"
                        title="点击展开中午第 5-6 节时段 (12:00 - 13:40)"
                      >
                        <span className="text-3xs text-text-4 font-mono group-hover:text-text-2">
                          第 5-6 节 ▾
                        </span>
                      </div>
                    )
                  }

                  return (
                    <div
                      key={`sem-ruler-${slot.id}`}
                      style={{ gridColumn: 1, gridRow: slot.id }}
                      className={`min-w-0 flex flex-col items-center justify-center border-b border-r border-bd/50 dark:border-white/[0.05] bg-surface-2/40 p-2 text-center select-none ${
                        slot.id === 6 ? 'border-b-0' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1 mb-1">
                        <span className="text-3xs font-medium text-text-3 px-1 py-0.5 rounded bg-surface-3">
                          {slot.periodHint}
                        </span>
                        {isNoonSlot && !hasSemesterNoonEvents && expandSemesterNoonSlot && (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation()
                              setExpandSemesterNoonSlot(false)
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
                {[0, 1, 2, 3, 4, 5, 6].map(dayIdx =>
                  SJTU_TIME_SLOTS.map(slot => {
                    const isNoonSlot = slot.id === 3
                    if (isNoonSlot && !hasSemesterNoonEvents && !expandSemesterNoonSlot) {
                      return (
                        <div
                          key={`sem-bg-${dayIdx}-3`}
                          style={{ gridColumn: dayIdx + 2, gridRow: 3 }}
                          onClick={() => setExpandSemesterNoonSlot(true)}
                          className={`min-w-0 border-b border-r border-bd/50 dark:border-white/[0.05] bg-surface-2/20 hover:bg-surface-2/40 cursor-pointer flex items-center justify-center ${
                            dayIdx === 6 ? 'border-r-0' : ''
                          }`}
                          title="点击展开中午第 5-6 节"
                        >
                          {dayIdx === 0 && (
                            <span className="text-3xs text-text-4 font-sans select-none opacity-80">
                              ☀️ 中午时段 (12:00 - 13:40) · 本学期无排课 · 点击展开
                            </span>
                          )}
                        </div>
                      )
                    }

                    const isOccupied = semesterOccupiedSlots.has(`${dayIdx}-${slot.id}`)
                    return (
                      <div
                        key={`sem-bg-${dayIdx}-${slot.id}`}
                        style={{ gridColumn: dayIdx + 2, gridRow: slot.id }}
                        className={`min-w-0 border-b border-r border-bd/50 dark:border-white/[0.05] p-1.5 transition-colors ${
                          dayIdx === 6 ? 'border-r-0' : ''
                        } ${slot.id === 6 ? 'border-b-0' : ''} ${
                          isOccupied ? '' : 'hover:bg-surface-2/20'
                        }`}
                      />
                    )
                  })
                )}

                {/* C. 跨行课程卡片簇 (Columns 2..8, Row Span 1..3) */}
                {[0, 1, 2, 3, 4, 5, 6].map(dayIdx => {
                  const clusters = semesterDayClusters.get(dayIdx) || []
                  return clusters.map(cluster => (
                    <div
                      key={`sem-cluster-${dayIdx}-${cluster.startSlot}-${cluster.endSlot}`}
                      style={{
                        gridColumn: dayIdx + 2,
                        gridRow: `${cluster.startSlot} / ${cluster.endSlot + 1}`,
                        zIndex: 10
                      }}
                      className="min-w-0 p-1.5 flex flex-col gap-1.5 pointer-events-auto h-full"
                    >
                      {cluster.events.map(item => {
                        const isSearchMatched =
                          !searchQuery.trim() ||
                          item.title.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
                          (item.teacher &&
                            item.teacher.toLowerCase().includes(searchQuery.toLowerCase().trim())) ||
                          (item.location &&
                            item.location.toLowerCase().includes(searchQuery.toLowerCase().trim()))

                        const isLab = item.isLabOrLongSession || cluster.span >= 3
                        const isIdeological = cluster.span === 2 || item.startTime.includes('6-8')

                        return (
                          <div
                            key={item.id}
                            onClick={() => handleOpenCourseModal(item.title)}
                            onMouseEnter={e => handleCardMouseEnter(item, e)}
                            onMouseLeave={handleCardMouseLeave}
                            className={`group relative h-full flex flex-col justify-between rounded-xl border p-2.5 text-2xs cursor-pointer transition-all overflow-hidden flex-1 min-w-0 ${
                              !isSearchMatched ? 'opacity-30' : ''
                            } ${
                              isLab
                                ? 'border-teal-500/30 dark:border-teal-500/35 bg-surface-1 dark:bg-[#182622] hover:border-teal-500/60 hover:shadow-xs'
                                : isIdeological
                                ? 'border-sky-500/30 dark:border-sky-500/35 bg-surface-1 dark:bg-[#1a232b] hover:border-sky-500/60 hover:shadow-xs'
                                : 'border-bd/70 dark:border-white/[0.06] bg-surface-1 dark:bg-[#232326] hover:border-accent dark:hover:border-accent/60 hover:shadow-2xs'
                            }`}
                            title="点击查看课程全学期课表明细与教学信息"
                          >
                            <div
                              className={`absolute left-0 top-1.5 bottom-1.5 rounded-r shadow-sm ${
                                isLab
                                  ? 'w-1.5 bg-teal-500'
                                  : isIdeological
                                  ? 'w-1.5 bg-sky-500'
                                  : 'w-1 bg-accent'
                              }`}
                            />
                            <div className="pl-1.5 flex flex-col h-full justify-between gap-1.5">
                              <div>
                                {/* 顶部课程名 (全宽无遮挡展示) */}
                                <div>
                                  <div className="font-bold text-text-1 text-xs md:text-sm leading-snug break-words">
                                    {item.title}
                                  </div>
                                </div>

                                {/* 周次范围胶囊徽标 */}
                                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                  <span className="shrink-0 rounded-md bg-accent/10 dark:bg-accent/20 px-1.5 py-0.5 text-3xs font-bold text-accent border border-accent/20">
                                    🗓️ {item.endTime || '全学期'}
                                  </span>
                                  {item.xf && (
                                    <span className="shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 text-3xs text-text-3 font-medium">
                                      ⭐ {item.xf} 学分
                                    </span>
                                  )}
                                </div>

                                {/* 时间、地点与教师 */}
                                <div className="mt-1.5 space-y-0.5 text-3xs text-text-3 font-mono">
                                  <div
                                    className={`font-semibold ${
                                      isLab
                                        ? 'text-teal-600 dark:text-teal-400'
                                        : isIdeological
                                        ? 'text-sky-600 dark:text-sky-400'
                                        : 'text-accent'
                                    }`}
                                  >
                                    🕒 {item.startTime}
                                  </div>
                                  {item.location && item.location !== '不排教室' && (
                                    <div className="text-text-1 font-sans font-medium truncate">
                                      📍 {item.location}
                                    </div>
                                  )}
                                  {item.teacher && (
                                    <div className="text-text-3 font-sans truncate">
                                      👨‍🏫 {item.teacher}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* 底部学分与详情链接 */}
                              <div className="flex items-center justify-between pt-1 border-t border-bd/20 text-3xs text-text-4">
                                <span>
                                  {item.xf ? `⭐ ${item.xf} 学分` : item.badge || '选修排课'}
                                </span>
                                <span className="text-accent group-hover:underline font-medium">
                                  详情 ›
                                </span>
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
        ) : (
          /* 课程清单卡片模式 (保留原先的三列卡片) */
          isCurrentMode ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredCourseCards.map(c => {
                const isExpanded = expandedCourseNames.has(c.courseName)
                return (
                  <div
                    key={c.courseName}
                    className="flex flex-col justify-between rounded-2xl border border-bd bg-surface-1 p-5 shadow-2xs hover:border-bd-strong hover:shadow-xs transition-all"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4
                          onClick={() => handleOpenCourseModal(c.courseName)}
                          className="font-bold text-sm text-text-1 line-clamp-1 hover:text-accent cursor-pointer transition-colors"
                          title="点击查看课程全学期课表与教学信息"
                        >
                          {c.courseName}
                        </h4>
                        <button
                          type="button"
                          onClick={() => handleOpenCourseModal(c.courseName)}
                          className="shrink-0 rounded-full bg-accent/10 hover:bg-accent/20 px-2.5 py-0.5 text-2xs font-semibold text-accent cursor-pointer transition-colors"
                          title="点击查看全学期排课明细与 Canvas 作业"
                        >
                          {c.events.length} 讲 · 详情 ›
                        </button>
                      </div>

                      {c.titleEn && (
                        <div className="mt-1 font-mono text-3xs text-text-3 line-clamp-1">
                          {c.titleEn}
                        </div>
                      )}

                      <div className="mt-4 space-y-1.5 text-xs text-text-2">
                        {c.teacher && (
                          <div className="flex items-center gap-2 text-2xs">
                            <span className="opacity-70">👨‍🏫 授课教师:</span>
                            <span className="font-medium text-text-1">{c.teacher}</span>
                          </div>
                        )}
                        {c.locationsList.length > 0 && (
                          <div className="flex items-center gap-2 text-2xs">
                            <span className="opacity-70">📍 上课教室:</span>
                            <span className="font-mono text-accent">
                              {c.locationsList.join(' / ')}
                            </span>
                          </div>
                        )}
                        {c.assignments.length > 0 && (
                          <div className="flex items-center gap-2 text-2xs">
                            <span className="opacity-70">📝 关联作业:</span>
                            <span className="font-medium text-amber-600 dark:text-amber-400">
                              {c.assignments.length} 项 Canvas 任务
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 border-t border-bd/40 pt-3">
                      <button
                        type="button"
                        onClick={() => toggleCourseExpand(c.courseName)}
                        className="flex w-full items-center justify-between text-2xs font-medium text-accent hover:underline cursor-pointer"
                      >
                        <span>
                          {isExpanded ? '收起排课明细' : `展开全学期 ${c.events.length} 讲课时表`}
                        </span>
                        <span className="text-3xs">{isExpanded ? '▲' : '▼'}</span>
                      </button>

                      {isExpanded && (
                        <div className="mt-3 max-h-56 overflow-y-auto space-y-1 rounded-xl bg-surface-2 p-2.5">
                          {c.events.map((ev, idx) => (
                            <div
                              key={ev.id}
                              className="flex items-center justify-between py-1 px-1.5 text-2xs border-b border-bd/20 last:border-0"
                            >
                              <span className="font-medium text-text-2">第 {idx + 1} 讲</span>
                              <span className="font-mono text-text-3">
                                {ev.startTime} ~ {ev.endTime ? ev.endTime.slice(-5) : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            /* 教务系统官方排课表格/卡片展示 */
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredJiaowuCourses.map(c => (
                <div
                  key={c.name}
                  className="flex flex-col justify-between rounded-2xl border border-bd bg-surface-1 p-5 shadow-2xs hover:border-bd-strong hover:shadow-xs transition-all"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h4
                        onClick={() => handleOpenCourseModal(c.name)}
                        className="font-bold text-sm text-text-1 line-clamp-1 hover:text-accent cursor-pointer transition-colors"
                        title="点击查看课程全学期课表与教学信息"
                      >
                        {c.name}
                      </h4>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {c.xf && (
                          <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-2xs font-semibold text-accent">
                            {c.xf} 学分
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleOpenCourseModal(c.name)}
                          className="rounded-full bg-surface-3 hover:bg-surface-4 px-2 py-0.5 text-2xs font-medium text-text-2 cursor-pointer transition-colors"
                          title="点击查看课程全览详情"
                        >
                          详情 ›
                        </button>
                      </div>
                    </div>

                    {c.kch && (
                      <div className="mt-1 font-mono text-3xs text-text-3">
                        代码: {c.kch} {c.kcbj ? `· ${c.kcbj}` : ''}
                      </div>
                    )}

                    <div className="mt-4 space-y-1.5 text-xs text-text-2">
                      {c.teachers && (
                        <div className="flex items-center gap-2 text-2xs">
                          <span className="opacity-70">👨‍🏫 任课教师:</span>
                          <span className="font-medium text-text-1">{c.teachers}</span>
                        </div>
                      )}
                      {c.locations && (
                        <div className="flex items-center gap-2 text-2xs">
                          <span className="opacity-70">📍 教学地点:</span>
                          <span className="font-mono text-accent">{c.locations}</span>
                        </div>
                      )}
                      {c.kclbmc && (
                        <div className="flex items-center gap-2 text-2xs">
                          <span className="opacity-70">🏷️ 课程类别:</span>
                          <span className="text-text-3">{c.kclbmc}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 border-t border-bd/40 pt-3 text-2xs text-text-3 space-y-1">
                    <div className="font-mono text-accent">🗓️ {c.periodAndWeeks}</div>
                    {c.jxbmc && <div className="truncate opacity-75">班级: {c.jxbmc}</div>}
                  </div>
                </div>
              ))}
            </div>
          )
        )
      )}

      {/* ─── 模块 2: 校园讲座与学术活动 (仅当前学期) ─── */}
      {overviewTab === 'activities' && isCurrentMode && (
        <div className="space-y-3">
          {filteredActivities.length === 0 ? (
            <div className="py-16 text-center text-xs text-text-3">暂无校园讲座或活动安排</div>
          ) : (
            filteredActivities.map(act => (
              <div
                key={act.id}
                className="rounded-2xl border border-purple-500/20 bg-surface-1 p-4 shadow-2xs hover:border-purple-500/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-purple-500/15 px-2 py-0.5 text-3xs font-bold text-purple-600 dark:text-purple-400">
                      {act.calendarName || '讲座/活动'}
                    </span>
                    <h4 className="font-bold text-sm text-text-1">{act.title}</h4>
                  </div>
                  {act.description && (
                    <p className="text-2xs text-text-3 line-clamp-2 max-w-2xl">
                      {act.description}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right space-y-1 font-mono text-2xs text-text-2">
                  <div>
                    🕒 {act.startTime} ~ {act.endTime.slice(-5)}
                  </div>
                  {act.location && (
                    <div className="text-purple-600 dark:text-purple-400">
                      📍 {act.location}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ─── 模块 3: Canvas 作业 DDL 时间轴 (仅当前学期) ─── */}
      {overviewTab === 'assignments' && isCurrentMode && (
        <div className="space-y-3">
          {filteredAssignments.length === 0 ? (
            <div className="py-16 text-center text-xs text-text-3">暂无 Canvas 作业安排</div>
          ) : (
            filteredAssignments.map(ddl => {
              const canOpen = Boolean(ddl.htmlUrl && isSafeExternalUrl(ddl.htmlUrl))
              return (
                <div
                  key={ddl.id}
                  className="rounded-2xl border border-bd bg-surface-1 p-4 shadow-2xs hover:border-bd-strong transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <AssignmentStatusBadge status={ddl.submissionStatus} score={ddl.score} />
                      <h4 className="font-semibold text-sm text-text-1">{ddl.title}</h4>
                    </div>
                    <div className="text-2xs text-text-3 flex items-center gap-3">
                      <span>📚 课程: {ddl.courseName || '未归类'}</span>
                      {ddl.pointsPossible != null && (
                        <span>满分: {ddl.pointsPossible} 分</span>
                      )}
                      {ddl.score != null && (
                        <span className="font-semibold text-blue-600 dark:text-blue-400">
                          得分: {ddl.score}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-4">
                    <div className="text-right font-mono text-2xs">
                      <div className="text-text-3 flex items-center justify-end gap-1.5">
                        {ddl.isLockAtDeadline && <LockDeadlineBadge />}
                        <span>截止时间 (DDL)</span>
                      </div>
                      <div className="font-semibold text-text-1">
                        {ddl.startTime || '未标注日期'}
                      </div>
                    </div>
                    {canOpen && ddl.htmlUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          if (ddl.htmlUrl) void window.api.openExternal(ddl.htmlUrl)
                        }}
                        className="rounded-lg border border-bd px-3 py-1.5 text-2xs font-medium text-accent hover:border-accent cursor-pointer transition-all shadow-2xs"
                      >
                        打开作业 ↗
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
