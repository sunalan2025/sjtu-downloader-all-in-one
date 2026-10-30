import { isSafeExternalUrl, cleanParenthesesInTitle } from '@shared/utils'
import type { SemesterCourseDetail } from '../schedule-types'
import {
  getAssignmentStatusInfo,
  getEventDateStr,
  formatEventTime
} from '../schedule-helpers'
import { LockDeadlineBadge, AssignmentStatusBadge } from './ScheduleBadges'

interface CourseDetailModalProps {
  course: SemesterCourseDetail | null
  onClose: () => void
}

export function CourseDetailModal({ course, onClose }: CourseDetailModalProps) {
  if (!course) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-bd-strong bg-surface-1 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* 顶栏 Header */}
        <div className="flex items-start justify-between border-b border-bd px-6 py-4 bg-surface-2/60">
          <div className="space-y-1.5 pr-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-text-1 tracking-tight">
                {cleanParenthesesInTitle(course.courseName)}
              </h3>
              {course.xf && (
                <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-2xs font-semibold text-accent">
                  ⭐ {course.xf} 学分
                </span>
              )}
              {course.kclbmc && (
                <span className="rounded-full bg-surface-3 px-2 py-0.5 text-2xs font-medium text-text-3">
                  🏷️ {course.kclbmc}
                </span>
              )}
            </div>
            {(course.titleEn || course.kch) && (
              <div className="font-mono text-2xs text-text-3">
                {course.kch && `代码: ${course.kch}`}
                {course.kcbj && ` · 教学班: ${course.kcbj}`}
                {course.titleEn && !course.kch && course.titleEn}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-text-3 hover:text-text-1 hover:bg-surface-3 transition-colors cursor-pointer"
            title="关闭 · 按 Esc 退出"
          >
            ✕
          </button>
        </div>

        {/* 弹窗内容主体 (可滚动) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 核心元信息卡片 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 rounded-xl border border-bd bg-surface-2/40 p-4 text-xs">
            <div>
              <div className="text-3xs text-text-4 uppercase font-semibold">👨‍🏫 任课教师</div>
              <div className="mt-1 font-medium text-text-1">{course.teachers || '主讲教学团队'}</div>
            </div>
            <div>
              <div className="text-3xs text-text-4 uppercase font-semibold">📍 教学地点</div>
              <div className="mt-1 font-medium text-accent">{course.locations || '校内常规教室'}</div>
            </div>
            <div>
              <div className="text-3xs text-text-4 uppercase font-semibold">🗓️ 排课周期 / 节次</div>
              <div className="mt-1 font-mono text-text-2">{course.periodAndWeeks}</div>
            </div>
            {course.jxbmc && (
              <div>
                <div className="text-3xs text-text-4 uppercase font-semibold">🎓 教学班级</div>
                <div className="mt-1 text-text-2 truncate">{course.jxbmc}</div>
              </div>
            )}
          </div>

          {/* 课时安排清单 */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h4 className="text-xs font-bold text-text-2 uppercase tracking-wider flex items-center gap-1.5">
                <span>📅</span>
                <span>全学期课时安排清单 ({course.scheduleSessions.length} 讲)</span>
              </h4>
              <span className="text-3xs text-text-4">按教学周次与日期排序</span>
            </div>

            <div className="max-h-60 overflow-y-auto rounded-xl border border-bd bg-surface-2/30 divide-y divide-bd">
              {course.scheduleSessions.map((sess, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between px-3.5 py-2 text-2xs hover:bg-surface-2/60 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-semibold text-text-2 shrink-0">
                      {sess.weekHint || `第 ${idx + 1} 讲`}
                    </span>
                    {sess.dateStr && (
                      <span className="font-mono text-text-3 text-3xs">
                        {sess.dateStr}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <span className="font-mono text-accent">
                      {sess.timeStr}
                    </span>
                    {sess.location && sess.location !== '不排教室' && (
                      <span className="text-text-3 font-sans max-w-[140px] truncate hidden sm:inline">
                        📍 {sess.location}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 关联考试安排 */}
          {course.exams && course.exams.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <h4 className="text-xs font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>🚨</span>
                  <span>关联考试与考场安排 ({course.exams.length} 场)</span>
                </h4>
                <span className="text-3xs text-text-4">交大官方考场与备考提醒</span>
              </div>

              <div className="space-y-2">
                {course.exams.map(exam => (
                  <div
                    key={exam.id}
                    className="rounded-xl border border-rose-500/30 bg-rose-500/5 dark:bg-[#2b181c] p-3.5 text-xs space-y-2 shadow-2xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="font-semibold text-text-1 flex items-center gap-2">
                          <span>{exam.title}</span>
                          <span className="rounded bg-rose-500/20 px-1.5 py-0.2 text-3xs font-bold text-rose-700 dark:text-rose-300">
                            {exam.examType || '考试'}
                          </span>
                        </div>
                        <div className="text-3xs text-text-3 font-mono">
                          🕒 {getEventDateStr(exam.startTime)} {formatEventTime(exam.startTime)} ~ {formatEventTime(exam.endTime || '')}
                        </div>
                      </div>
                      {exam.leftDay !== undefined && (
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-0.5 text-2xs font-bold ${
                            exam.leftDay === 0
                              ? 'bg-rose-500 text-white animate-pulse'
                              : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                          }`}
                        >
                          {exam.leftDay === 0
                            ? '今日考试'
                            : exam.leftDay > 0
                              ? `距考试还剩 ${exam.leftDay} 天`
                              : '已结束'}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-text-2 pt-2 border-t border-rose-500/15">
                      <div className="flex items-center gap-1">
                        <span className="text-text-4 font-medium">📍 考场地点:</span>
                        <span className="font-semibold text-rose-600 dark:text-rose-400">
                          {exam.location || '考场地点待公布'}
                        </span>
                      </div>
                      {exam.conflictCourseTitle && (
                        <div className="flex items-center gap-1 text-rose-600 dark:text-rose-400">
                          <span>⚠️</span>
                          <span>原排课冲突:「{exam.conflictCourseTitle}」时段已被本次考试占用</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 关联 Canvas 作业与任务 */}
          {course.assignments && course.assignments.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <h4 className="text-xs font-bold text-text-2 uppercase tracking-wider flex items-center gap-1.5">
                  <span>📝</span>
                  <span>关联 Canvas 作业任务 ({course.assignments.length} 项)</span>
                </h4>
              </div>

              <div className="space-y-2">
                {course.assignments.map(ddl => {
                  const statusInfo = getAssignmentStatusInfo(ddl.submissionStatus, ddl.score)
                  const canOpen = Boolean(ddl.htmlUrl && isSafeExternalUrl(ddl.htmlUrl))

                  return (
                    <div
                      key={ddl.id}
                      className={`flex items-center justify-between rounded-xl border p-3 text-xs transition-colors ${statusInfo.cardBorderClass} ${statusInfo.cardBgClass}`}
                    >
                      <div className="space-y-0.5 pr-2">
                        <div className="font-medium text-text-1">{ddl.title}</div>
                        <div className="text-3xs text-text-3 font-mono flex items-center gap-1.5 flex-wrap">
                          <span>
                            截止时间: {ddl.endTime ? `${getEventDateStr(ddl.endTime)} ${formatEventTime(ddl.endTime)}` : '未标注日期'}
                          </span>
                          {ddl.isLockAtDeadline && <LockDeadlineBadge />}
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {canOpen && ddl.htmlUrl && (
                          <button
                            type="button"
                            onClick={() => {
                              if (ddl.htmlUrl) void window.api.openExternal(ddl.htmlUrl)
                            }}
                            className="rounded-lg border border-bd px-2.5 py-1 text-3xs font-medium text-accent hover:border-accent cursor-pointer transition-all shadow-2xs"
                            title="在默认浏览器中打开该作业"
                          >
                            打开作业 ↗
                          </button>
                        )}
                        <AssignmentStatusBadge status={ddl.submissionStatus} score={ddl.score} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* 底栏 Footer */}
        <div className="flex items-center justify-end border-t border-bd px-6 py-3 bg-surface-2/40">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-surface-3 hover:bg-surface-4 px-5 py-2 text-xs font-semibold text-text-1 cursor-pointer transition-all shadow-2xs"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
