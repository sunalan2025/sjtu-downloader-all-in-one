interface SemesterOption {
  key: string
  label: string
}

interface LayerFilter {
  course: boolean
  activity: boolean
  ddl: boolean
}

interface ScheduleHeaderBarProps {
  selectedSemesterKey: string
  onSemesterChange: (key: string) => void
  semesters: SemesterOption[]
  viewMode: 'week' | 'semester'
  onViewModeChange: (mode: 'week' | 'semester') => void
  isCurrentMode: boolean
  layerFilter: LayerFilter
  onToggleLayer: (key: keyof LayerFilter) => void
  courseEventsCount: number
  activityEventsCount: number
  ddlEventsCount: number
  studentName?: string
  studentId?: string
  onOpenExportModal: () => void
  onRefresh: () => void
  loading: boolean
  refreshing: boolean
  jiaowuLoading: boolean
}

export function ScheduleHeaderBar({
  selectedSemesterKey,
  onSemesterChange,
  semesters,
  viewMode,
  onViewModeChange,
  isCurrentMode,
  layerFilter,
  onToggleLayer,
  courseEventsCount,
  activityEventsCount,
  ddlEventsCount,
  studentName,
  studentId,
  onOpenExportModal,
  onRefresh,
  loading,
  refreshing,
  jiaowuLoading
}: ScheduleHeaderBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-bd bg-surface-1/80 px-6 py-3.5 backdrop-blur-md sticky top-0 z-20">
      {/* 左侧：学期选择器 + 视图切换 (周视图 / 学期总览) */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">🗓️</span>
          <select
            value={selectedSemesterKey}
            onChange={e => onSemesterChange(e.target.value)}
            className="rounded-xl border border-bd bg-surface-1 pl-3 pr-8 py-1.5 text-xs font-semibold text-text-1 focus:border-accent focus:outline-none cursor-pointer shadow-2xs hover:border-bd-strong transition-all"
            title="切换当前学期或历史官方排课"
          >
            <optgroup label="交我办与教学平台 · 当前学期实时同步">
              <option value="current">
                2026-2027-1 · 当前学期实时同步
              </option>
            </optgroup>
            <optgroup label="教学信息服务网 · 历年官方课表">
              {semesters.map(s => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* 视图模式分段选择器 (Apple Segmented Control) */}
        <div className="flex items-center rounded-xl bg-surface-3 p-1 shadow-2xs">
          <button
            type="button"
            onClick={() => onViewModeChange('week')}
            className={`rounded-lg px-3.5 py-1 text-xs font-medium transition-all cursor-pointer ${
              viewMode === 'week'
                ? 'bg-surface-1 text-text-1 shadow-2xs font-semibold'
                : 'text-text-3 hover:text-text-2'
            }`}
          >
            📅 周视图
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('semester')}
            className={`rounded-lg px-3.5 py-1 text-xs font-medium transition-all cursor-pointer ${
              viewMode === 'semester'
                ? 'bg-surface-1 text-text-1 shadow-2xs font-semibold'
                : 'text-text-3 hover:text-text-2'
            }`}
          >
            📋 学期总览
          </button>
        </div>
      </div>

      {/* 右侧：Apple 日历图层开关 Pills + 操作按钮 */}
      <div className="flex items-center gap-3">
        {isCurrentMode && (
          <div className="hidden sm:flex items-center gap-1.5 rounded-xl border border-bd bg-surface-1 px-2 py-1 shadow-2xs">
            <span className="text-2xs font-medium text-text-3 px-1">图层:</span>
            <button
              type="button"
              onClick={() => onToggleLayer('course')}
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-2xs font-medium transition-all cursor-pointer ${
                layerFilter.course
                  ? 'bg-accent/15 text-accent font-semibold'
                  : 'opacity-40 text-text-3 hover:opacity-70'
              }`}
              title="切换教务排课显示"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              <span>排课 · {courseEventsCount}</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleLayer('activity')}
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-2xs font-medium transition-all cursor-pointer ${
                layerFilter.activity
                  ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400 font-semibold'
                  : 'opacity-40 text-text-3 hover:opacity-70'
              }`}
              title="切换学术讲座与校园活动显示"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
              <span>讲座 · {activityEventsCount}</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleLayer('ddl')}
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-2xs font-medium transition-all cursor-pointer ${
                layerFilter.ddl
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold'
                  : 'opacity-40 text-text-3 hover:opacity-70'
              }`}
              title="切换 Canvas 作业 DDL 显示"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span>作业 · {ddlEventsCount}</span>
            </button>
          </div>
        )}

        {!isCurrentMode && studentName && (
          <div className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-bd bg-surface-1 px-3 py-1 text-2xs text-text-2 shadow-2xs">
            <span>👤 {studentName}</span>
            {studentId && (
              <span className="font-mono text-text-3">· {studentId}</span>
            )}
          </div>
        )}

        {isCurrentMode && (
          <button
            type="button"
            onClick={onOpenExportModal}
            className="inline-flex items-center gap-1.5 rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-2 hover:border-bd-strong hover:text-text-1 hover:bg-surface-2 transition-all cursor-pointer shadow-2xs"
            title="导出为 Apple/Outlook/Google 日历 (.ics)"
          >
            <span>🗓️</span>
            <span>导出日历</span>
          </button>
        )}

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || refreshing || jiaowuLoading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-bd bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-2 hover:border-bd-strong hover:text-text-1 hover:bg-surface-2 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
          title="重新同步数据"
        >
          <span className={refreshing || jiaowuLoading ? 'animate-spin' : ''}>↻</span>
          <span>{refreshing || jiaowuLoading ? '正在同步…' : '重新同步'}</span>
        </button>
      </div>
    </div>
  )
}
