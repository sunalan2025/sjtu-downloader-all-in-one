interface ScheduleExportModalProps {
  isOpen: boolean
  onClose: () => void
  includeCourses: boolean
  setIncludeCourses: (v: boolean) => void
  includeActivities: boolean
  setIncludeActivities: (v: boolean) => void
  includeDdl: boolean
  setIncludeDdl: (v: boolean) => void
  courseEventsCount: number
  activityEventsCount: number
  ddlEventsCount: number
  alarmMinutesBefore: number
  setAlarmMinutesBefore: (v: number) => void
  alarmDdlHoursBefore: number
  setAlarmDdlHoursBefore: (v: number) => void
  exportedPath: string | null
  exportCount: number
  exporting: boolean
  onExport: () => void
}

export function ScheduleExportModal({
  isOpen,
  onClose,
  includeCourses,
  setIncludeCourses,
  includeActivities,
  setIncludeActivities,
  includeDdl,
  setIncludeDdl,
  courseEventsCount,
  activityEventsCount,
  ddlEventsCount,
  alarmMinutesBefore,
  setAlarmMinutesBefore,
  alarmDdlHoursBefore,
  setAlarmDdlHoursBefore,
  exportedPath,
  exportCount,
  exporting,
  onExport
}: ScheduleExportModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-3xl border border-bd bg-surface-1 p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-bd/60 pb-3">
          <h3 className="text-base font-bold text-text-1">🗓️ 导出为标准日历 (.ics)</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-text-3 hover:text-text-1 cursor-pointer"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-text-3 leading-relaxed">
          导出的 RFC 5545 iCalendar 文件原生支持 Apple Calendar、Outlook、Google 日历及 Android 手机日历同步。
        </p>

        <div className="space-y-3 rounded-2xl bg-surface-2/60 p-4 border border-bd/60 text-xs">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={includeCourses}
              onChange={e => setIncludeCourses(e.target.checked)}
              className="rounded accent-accent"
            />
            <span className="font-medium text-text-1">
              包含教务排课 ({courseEventsCount} 节)
            </span>
          </label>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={includeActivities}
              onChange={e => setIncludeActivities(e.target.checked)}
              className="rounded accent-accent"
            />
            <span className="font-medium text-text-1">
              包含学术讲座与校园活动 ({activityEventsCount} 场)
            </span>
          </label>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={includeDdl}
              onChange={e => setIncludeDdl(e.target.checked)}
              className="rounded accent-accent"
            />
            <span className="font-medium text-text-1">
              包含 Canvas 作业截止时间 ({ddlEventsCount} 项)
            </span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <label className="text-2xs text-text-3 block mb-1">上课提前提醒:</label>
            <select
              value={alarmMinutesBefore}
              onChange={e => setAlarmMinutesBefore(Number(e.target.value))}
              className="w-full rounded-xl border border-bd bg-surface-2 pl-3 pr-8 py-1.5 text-xs text-text-1 focus:border-accent cursor-pointer shadow-2xs hover:border-bd-strong transition-all"
            >
              <option value={10}>提前 10 分钟</option>
              <option value={20}>提前 20 分钟 (推荐)</option>
              <option value={30}>提前 30 分钟</option>
              <option value={60}>提前 1 小时</option>
            </select>
          </div>

          <div>
            <label className="text-2xs text-text-3 block mb-1">作业 DDL 提前提醒:</label>
            <select
              value={alarmDdlHoursBefore}
              onChange={e => setAlarmDdlHoursBefore(Number(e.target.value))}
              className="w-full rounded-xl border border-bd bg-surface-2 pl-3 pr-8 py-1.5 text-xs text-text-1 focus:border-accent cursor-pointer shadow-2xs hover:border-bd-strong transition-all"
            >
              <option value={12}>提前 12 小时</option>
              <option value={24}>提前 24 小时 (推荐)</option>
              <option value={48}>提前 2 天</option>
            </select>
          </div>
        </div>

        {exportedPath && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400">
            <div className="font-semibold">✓ 已成功导出 {exportCount} 项日程与作业！</div>
            <div className="mt-1 font-mono text-3xs truncate">{exportedPath}</div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-bd px-4 py-2 text-xs font-medium text-text-2 hover:bg-surface-2 cursor-pointer transition-all"
          >
            关闭
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={onExport}
            className="rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-50 cursor-pointer shadow-xs transition-all"
          >
            {exporting ? '正在生成…' : '立即导出 .ics'}
          </button>
        </div>
      </div>
    </div>
  )
}
