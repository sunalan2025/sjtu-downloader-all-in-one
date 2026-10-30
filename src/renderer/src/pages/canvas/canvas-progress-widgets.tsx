import { memo } from 'react'
import { useAppStore, useEffectiveProgress } from '../../store/app'
import { ProgressBar, TaskCtrlButtons } from '../../components/DownloadUI'
import {
  canvasPptPdfBatchTaskId,
  canvasAssignBatchTaskId,
  canvasTranscriptBatchTaskId
} from '../../download/taskIds'

export const FileRowProgress = memo(function FileRowProgress({ tid }: { tid: string }) {
  const p = useEffectiveProgress(tid)
  if (!p || (p.state !== 'downloading' && p.state !== 'pending' && p.state !== 'error' && p.state !== 'paused')) {
    return null
  }
  return <ProgressBar p={p} />
})

export const VideoRowProgress = memo(function VideoRowProgress({ tid, controllable }: { tid: string; controllable: boolean }) {
  const p = useEffectiveProgress(tid)
  if (!p || (p.state !== 'downloading' && p.state !== 'pending' && p.state !== 'error' && p.state !== 'paused')) {
    return null
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-[80px]">
        <ProgressBar p={p} />
      </div>
      {controllable && (
        <TaskCtrlButtons
          state={p.state}
          onPause={() => window.api.download.pause(tid).catch(() => undefined)}
          onCancel={() => window.api.download.cancel(tid).catch(() => undefined)}
          onResume={() => window.api.download.resume(tid).catch(() => undefined)}
        />
      )}
    </div>
  )
})

/** PPT 课件 PDF 的课程级聚合进度：current/total 为讲次级（X/Y 讲），
 *  单讲内的图片下载进度折进 message。进度由 canvas:ppt-progress → applyProgress 写入。 */
export const PptPdfProgressRow = memo(function PptPdfProgressRow({ courseId }: { courseId: number }) {
  const tid = canvasPptPdfBatchTaskId(courseId)
  const p = useEffectiveProgress(tid)
  const isSelected = useAppStore(s => !!s.canvasCourseCategorySelections[courseId]?.pptPdf)
  if (!p) {
    return (
      <div className="py-1.5 text-xs text-text-4">
        {isSelected ? '已选择，点击「开始下载」生成 PPT 课件 PDF' : '未勾选：勾选后可在下载时自动提取板书与幻灯片并导出为 PDF 讲义'}
      </div>
    )
  }
  const isDone = p.state === 'done' || p.state === 'skipped'
  const isErr = p.state === 'error'
  const isDl = p.state === 'downloading' || p.state === 'pending'
  const pct = p.total > 0 ? Math.round((p.received / p.total) * 100) : (isDone ? 100 : 0)
  const barWidth = isDl ? Math.max(pct, 3) : pct
  const fill = isErr ? 'bg-warning'
    : isDone ? 'bg-success'
    : 'bg-gradient-to-r from-accent to-accent-light'
  const text = isErr ? (p.message || '失败')
    : isDone ? (p.message || '完成')
    : isDl ? (p.total > 0 ? `${p.received}/${p.total} 讲` : '下载中…') + (p.message ? ` · ${p.message}` : '')
    : '等待中'
  const textColor = isErr ? 'text-warning' : isDone ? 'text-success' : 'text-text-2'
  return (
    <div className="space-y-1.5">
      <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full transition-[width] duration-300 ${fill}`} style={{ width: `${barWidth}%` }} />
      </div>
      <div className={`truncate text-xs tabular-nums ${textColor}`} title={text}>{text}</div>
    </div>
  )
})

/** 作业全量归档的课程级聚合进度：current/total 为作业数（X/Y 项） */
export const AssignmentProgressRow = memo(function AssignmentProgressRow({
  courseId,
  hasCd,
  isLoading,
  onScan: _onScan
}: {
  courseId: number
  hasCd: boolean
  isLoading: boolean
  onScan?: () => void
}) {
  const tid = canvasAssignBatchTaskId(courseId)
  const p = useEffectiveProgress(tid)
  const isSelected = useAppStore(s => !!s.canvasCourseCategorySelections[courseId]?.assignments)

  if (!hasCd && !isLoading) {
    return null
  }

  if (!p) {
    return (
      <div className="py-1.5 text-xs text-text-4">
        {isSelected ? '已选择，点击「开始下载」归档作业题干、附件与提交记录' : '勾选后归档作业要求、老师附件、本人提交原件与评语'}
      </div>
    )
  }

  const isDone = p.state === 'done' || p.state === 'skipped'
  const isErr = p.state === 'error'
  const isDl = p.state === 'downloading' || p.state === 'pending'
  const pct = p.total > 0 ? Math.round((p.received / p.total) * 100) : (isDone ? 100 : 0)
  const barWidth = isDl ? Math.max(pct, 3) : pct
  const fill = isErr ? 'bg-warning'
    : isDone ? 'bg-success'
    : 'bg-gradient-to-r from-accent to-accent-light'
  const text = isErr ? (p.message || '作业归档失败')
    : isDone ? (p.message || '作业归档完成')
    : isDl ? (p.total > 0 ? `${p.received}/${p.total} 项` : '归档中…') + (p.message ? ` · ${p.message}` : '')
    : '等待中'
  const textColor = isErr ? 'text-warning' : isDone ? 'text-success' : 'text-text-2'
  return (
    <div className="space-y-1.5">
      <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full transition-[width] duration-300 ${fill}`} style={{ width: `${barWidth}%` }} />
      </div>
      <div className={`truncate text-xs tabular-nums ${textColor}`} title={text}>{text}</div>
    </div>
  )
})

/** 课堂视频/音频分类的快捷扫描入口与 AI 逐字稿导出进度 */
export const VideoCategoryExtra = memo(function VideoCategoryExtra({
  courseId,
  hasLectures,
  isLoading,
  isAudioOnly,
  onScan: _onScan,
  onSelectPerspective
}: {
  courseId: number
  hasLectures: boolean
  isLoading: boolean
  isAudioOnly: boolean
  onScan?: () => void
  onSelectPerspective?: (p: 'all' | 'teacher' | 'ppt' | 'none' | 'audio') => void
}) {
  const tid = canvasTranscriptBatchTaskId(courseId)
  const p = useEffectiveProgress(tid)

  if (!hasLectures && !isLoading) {
    return null
  }

  return (
    <div className="space-y-2">
      {hasLectures && onSelectPerspective && !isAudioOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2/60 px-2.5 py-1.5 border border-bd text-xs select-none">
          <span className="text-2xs font-semibold text-text-3">🎬 视角筛选</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onSelectPerspective('all')}
              className="rounded-md border border-bd bg-surface-1 px-2 py-0.5 text-2xs text-text-2 hover:border-accent hover:text-accent transition-colors cursor-pointer"
              title="同时勾选教师视角与 PPT 投屏"
            >
              全选
            </button>
            <button
              type="button"
              onClick={() => onSelectPerspective('teacher')}
              className="rounded-md border border-bd bg-surface-1 px-2 py-0.5 text-2xs text-text-2 hover:border-accent hover:text-accent transition-colors cursor-pointer"
              title="仅勾选教师机位画面与音频"
            >
              仅教师
            </button>
            <button
              type="button"
              onClick={() => onSelectPerspective('ppt')}
              className="rounded-md border border-bd bg-surface-1 px-2 py-0.5 text-2xs text-text-2 hover:border-accent hover:text-accent transition-colors cursor-pointer"
              title="仅勾选 PPT 幻灯片屏幕投屏"
            >
              仅 PPT
            </button>
            <button
              type="button"
              onClick={() => onSelectPerspective('audio')}
              className="rounded-md border border-bd bg-surface-1 px-2 py-0.5 text-2xs text-text-2 hover:border-accent hover:text-accent transition-colors cursor-pointer"
              title="切换为仅提取原声音频：自动只选教师视角，PPT 投屏无独立音频流将被禁用"
            >
              仅音频
            </button>
            <button
              type="button"
              onClick={() => onSelectPerspective('none')}
              className="rounded-md border border-bd bg-surface-1 px-2 py-0.5 text-2xs text-warning/80 hover:border-warning hover:text-warning transition-colors cursor-pointer"
              title="取消该课程全部视频勾选"
            >
              清空
            </button>
          </div>
        </div>
      )}
      {p && (
        <div className="space-y-1">
          <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${
                p.state === 'error' ? 'bg-warning' : p.state === 'done' ? 'bg-success' : 'bg-gradient-to-r from-accent to-accent-light'
              }`}
              style={{ width: `${p.total > 0 ? Math.round((p.received / p.total) * 100) : (p.state === 'done' ? 100 : 0)}%` }}
            />
          </div>
          <div className={`truncate text-2xs tabular-nums ${p.state === 'error' ? 'text-warning' : p.state === 'done' ? 'text-success' : 'text-text-3'}`}>
            {p.message || (p.state === 'done' ? 'AI 字幕导出完成' : '导出中…')}
          </div>
        </div>
      )}
    </div>
  )
})
