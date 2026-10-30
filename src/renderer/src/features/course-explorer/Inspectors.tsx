import { useToast } from '../../hooks/useToast'
import { Toast } from '../../components/Toast'
import { useMemo, useState } from 'react'
import { FileTypeBadge, formatBytes } from '../../components/DownloadUI'
import { useAppStore } from '../../store/app'
import type { DownloadMode } from '@shared/types'
import { estimateResourceSize, getDownloadActionLabels } from '@shared/utils'
import { type VideoPerspective } from '../../components/FloatingCommandIsland'
import { PERSPECTIVE_LABELS } from '../../components/FloatingCommandIsland'
import { NetdiskCourseItem, NetdiskCategoryItem, NetdiskFileItem } from './model'

// ─────────────────────────────────────────────────────────────
// 3. ColumnView (分栏多级并列视图 / macOS Miller Columns)
// ─────────────────────────────────────────────────────────────

export interface CourseResourceBreakdown {
  filesCount: number
  fileBytes: number
  videoCount: number
  assignmentCount: number
  hasVideos: boolean
  hasAssignments: boolean
  pptPdfAvailable: boolean
}

export function getCourseResourceBreakdown(course: NetdiskCourseItem): CourseResourceBreakdown {
  let filesCount = 0
  let fileBytes = 0
  let videoCount = 0
  let assignmentCount = 0
  let pptPdfAvailable = false

  for (const cat of course.categories) {
    const isVideoCat = cat.icon === 'video' || cat.icon === 'audio' || cat.id === 'videos' || cat.id === 'teacher'
    const isAssignCat = cat.icon === 'assignment' || cat.id === 'assignments'
    const isPptPdfCat = cat.id === 'pptPdf' || cat.id === 'ppt-pdf'

    if (isPptPdfCat) {
      pptPdfAvailable = true
      continue
    }

    if (isAssignCat) {
      assignmentCount += cat.items.length
      continue
    }

    if (isVideoCat) {
      videoCount = Math.max(videoCount, cat.items.length)
      continue
    }

    if (cat.id === 'ppt') {
      videoCount = Math.max(videoCount, cat.items.length)
      continue
    }

    for (const it of cat.items) {
      const ext = it.name.split('.').pop()?.toLowerCase() || ''
      const isVideoItem =
        it.type === 'MP4' ||
        it.type === 'M4A' ||
        it.type === 'video' ||
        ['mp4', 'mkv', 'mov', 'flv', 'ts', 'webm', 'mp3', 'm4a'].includes(ext)
      if (isVideoItem) {
        videoCount++
      } else {
        filesCount++
        fileBytes += it.size || 0
      }
    }
  }

  if (fileBytes === 0 && course.totalBytes) {
    fileBytes = course.totalBytes
  }

  if (filesCount === 0 && videoCount === 0 && assignmentCount === 0 && course.itemCount > 0) {
    filesCount = course.itemCount
  }

  const hasVideos =
    videoCount > 0 || course.categories.some(c => c.icon === 'video' || c.icon === 'audio' || c.id === 'videos' || c.id === 'teacher')

  return {
    filesCount,
    fileBytes,
    videoCount,
    assignmentCount,
    hasVideos,
    hasAssignments: assignmentCount > 0,
    pptPdfAvailable: pptPdfAvailable || hasVideos
  }
}

export interface CourseOverviewInspectorProps {
  course: NetdiskCourseItem
  category?: NetdiskCategoryItem
  perspective?: VideoPerspective
  onPerspectiveChange?: (perspective: VideoPerspective) => void
  hasPptPdf?: boolean
  onTogglePptPdf?: (enabled: boolean) => void
  onDownloadCourse?: (course: NetdiskCourseItem) => void
  hasSelection?: boolean
  downloadMode?: DownloadMode
}

export function CourseOverviewInspector({
  course,
  category,
  perspective,
  onPerspectiveChange: _onPerspectiveChange,
  hasPptPdf,
  onTogglePptPdf: _onTogglePptPdf,
  onDownloadCourse,
  hasSelection,
  downloadMode: _downloadMode
}: CourseOverviewInspectorProps) {
  const [internalPerspective] = useState<VideoPerspective>('teacher')
  const globalPerspective = useAppStore(s => s.videoPerspectivePreference)
  const globalAutoPptPdf = useAppStore(s => s.autoExportPptPdf)
  const storeDownloadMode = useAppStore(s => s.downloadMode)
  const effectiveStoreMode = typeof useAppStore.getState === 'function' ? useAppStore.getState().downloadMode : storeDownloadMode
  const activeDownloadMode = _downloadMode ?? effectiveStoreMode ?? storeDownloadMode ?? 'local'
  const actionLabels = getDownloadActionLabels(activeDownloadMode)
  const activePerspective: VideoPerspective = perspective ?? course.perspective ?? globalPerspective ?? internalPerspective
  const perspectiveLabel = PERSPECTIVE_LABELS[activePerspective] || '仅教师视角'

  const pptCat = course.categories.find(c => c.id === 'pptPdf' || c.id === 'ppt-pdf')
  const defaultPptPdf = pptCat ? pptCat.state === 'all' : false
  const [internalPptPdf] = useState<boolean>(defaultPptPdf)
  const isPptPdfOn = hasPptPdf ?? course.hasPptPdf ?? (pptCat ? pptCat.state === 'all' : (globalAutoPptPdf ?? internalPptPdf))

  const { toast, showToast, hideToast } = useToast(2500)

  const breakdown = useMemo(() => getCourseResourceBreakdown(course), [course])

  const estimated = useMemo(() => {
    return estimateResourceSize({
      fileBytes: breakdown.fileBytes,
      videoCount: breakdown.videoCount,
      perspective: activePerspective,
      hasAssignments: breakdown.hasAssignments,
      assignmentCount: breakdown.assignmentCount,
      hasPptPdf: isPptPdfOn,
      pptPdfCount: breakdown.videoCount > 0 ? breakdown.videoCount : 1
    })
  }, [breakdown, activePerspective, isPptPdfOn])

  const handleDownloadCourse = () => {
    // [Bug Fix] 原实现兜底"未全选则 onToggle + toast 已开始下载全部资源"——在未接
    // 页面级提交回调（onDownloadCourse / course.onDownload）的页面上是死按钮 + 假成功。
    // 无真实回调时改为切换整课勾选态并如实提示，禁止谎报"已开始下载"。
    if (onDownloadCourse) {
      onDownloadCourse(course)
    } else if (course.onDownload) {
      course.onDownload()
    } else {
      course.onToggle()
      showToast(course.state === 'all' ? `已取消勾选 "${course.name}"` : actionLabels.toastPromptMessage(course.name), 'info')
      return
    }
    showToast(actionLabels.toastMessage(course.name), 'success')
  }

  return (
    <div
      data-testid="course-overview-inspector"
      className={`flex w-80 md:w-96 shrink-0 flex-col bg-surface-1 p-5 overflow-y-auto border-l border-bd select-none h-full relative animate-fadeIn ${hasSelection ? 'pb-24' : ''}`}
    >
      {/* 顶部标题区 */}
      <div className="pb-3 border-b border-bd shrink-0">
        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
          <span className="text-2xs font-semibold text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/20">
            {category ? '分类与课程概览' : '课程概览'}
          </span>
          {course.term && (
            <span className="text-2xs font-mono text-text-3 bg-surface-2 px-1.5 py-0.5 rounded border border-bd">{course.term}</span>
          )}
          {course.code && (
            <span className="text-2xs font-mono text-text-3 bg-surface-2 px-1.5 py-0.5 rounded border border-bd">{course.code}</span>
          )}
          {course.teacher && (
            <span className="text-2xs text-text-3 bg-surface-2 px-1.5 py-0.5 rounded border border-bd">👨‍🏫 {course.teacher}</span>
          )}
          {course.badge && (
            <span className="text-2xs font-semibold text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
              {course.badge}
            </span>
          )}
        </div>
        <h2 className="text-sm font-bold text-text-1 leading-snug break-words" title={course.name}>
          {course.name}
        </h2>
        {category && (
          <div className="mt-1 flex items-center gap-1 text-2xs text-text-3">
            <span>当前浏览分类:</span>
            <span className="font-semibold text-text-2">{category.name}</span>
            <span className="font-mono text-text-4">({category.items.length})</span>
          </div>
        )}
      </div>

      {/* 资源结构与容量预估卡片 */}
      <div className="my-3 rounded-xl border border-bd bg-surface-2/60 p-3.5 space-y-2 shrink-0 shadow-2xs">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-3 font-medium">预估总容量</span>
          <span className="font-mono text-sm font-bold text-accent" data-testid="course-estimated-size">
            {estimated.formattedSize}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-bd text-xs">
          <div className="flex flex-col">
            <span className="text-text-4 text-2xs">课件资料</span>
            <span className="text-text-1 font-mono font-semibold">
              {breakdown.filesCount} 项{breakdown.fileBytes > 0 ? ` · ${formatBytes(breakdown.fileBytes)}` : ''}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-text-4 text-2xs">课堂录播</span>
            <span className="text-text-1 font-mono font-semibold">
              {breakdown.videoCount > 0 ? `${breakdown.videoCount} 讲` : '无录播'}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-text-4 text-2xs">课程作业</span>
            <span className="text-text-1 font-mono font-semibold">
              {breakdown.assignmentCount > 0 ? `${breakdown.assignmentCount} 项` : '无作业'}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-text-4 text-2xs">PPT 讲义 PDF</span>
            <span className="text-text-1 font-mono font-semibold">
              {isPptPdfOn ? (breakdown.videoCount > 0 ? `预估 ${breakdown.videoCount} 份` : '已开启') : '未开启'}
            </span>
          </div>
        </div>
      </div>

      {/* 偏好状态只读概览（统一在设置页修改） */}
      <div
        className="my-2 rounded-xl border border-bd bg-surface-2/40 p-3 space-y-1.5 shrink-0 text-2xs"
        data-testid="unified-preferences-summary"
      >
        {breakdown.hasVideos && (
          <div className="flex items-center justify-between text-text-2">
            <span className="flex items-center gap-1.5 font-medium">
              <span>📹</span>
              <span>默认录播视角</span>
            </span>
            <span className="font-semibold text-accent">{perspectiveLabel}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-text-2">
          <span className="flex items-center gap-1.5 font-medium">
            <span>📑</span>
            <span>PPT 讲义自动提取</span>
          </span>
          <span className={`font-semibold ${isPptPdfOn ? 'text-accent' : 'text-text-4'}`}>{isPptPdfOn ? '已开启' : '未开启'}</span>
        </div>
        <div className="pt-1 text-3xs text-text-4 border-t border-bd text-right">如需修改请前往「设置 - 课件与多媒体」</div>
      </div>

      {/* 勾选状态指示 */}
      <div className="mt-2 mb-1 flex items-center justify-between text-xs text-text-3 px-1 shrink-0">
        <span>课程勾选状态</span>
        <span
          className={`font-semibold ${course.state === 'all' ? 'text-accent' : course.state === 'some' ? 'text-warning' : 'text-text-4'}`}
        >
          {course.state === 'all' ? '已全选' : course.state === 'some' ? '部分已选' : '未勾选'}
        </span>
      </div>

      {/* Toast 提示浮条 */}
      <Toast toast={toast} onClose={hideToast} position="bottom-wide" />

      {/* 底部主执行按钮 */}
      <div className="mt-auto pt-3 shrink-0">
        <button
          type="button"
          data-testid="course-download-cta"
          onClick={handleDownloadCourse}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold text-white shadow-glow-sm hover:bg-accent-light active:scale-[0.98] transition-all cursor-pointer"
        >
          <span>
            {actionLabels.iconType === 'both' ? '☁️⬇ ' : actionLabels.iconType === 'upload' ? '☁️ ' : '⬇ '}
            {actionLabels.iconType === 'both' ? '下载并备份' : actionLabels.ctaPrefix}本门课程全部资源 · {estimated.formattedSize}
          </span>
        </button>
      </div>
    </div>
  )
}

export interface FileDetailInspectorProps {
  item: NetdiskFileItem
  course?: NetdiskCourseItem
  category?: NetdiskCategoryItem
  onClose: () => void
  onDownloadSingle?: (item: NetdiskFileItem, course?: NetdiskCourseItem, category?: NetdiskCategoryItem) => void
  hasSelection?: boolean
  downloadMode?: DownloadMode
}

export function FileDetailInspector({
  item,
  course,
  category,
  onClose,
  onDownloadSingle,
  hasSelection,
  downloadMode: _downloadMode
}: FileDetailInspectorProps) {
  const { toast, showToast, hideToast } = useToast(2500)
  const storeDownloadMode = useAppStore(s => s.downloadMode)
  const effectiveStoreMode = typeof useAppStore.getState === 'function' ? useAppStore.getState().downloadMode : storeDownloadMode
  const activeDownloadMode = _downloadMode ?? effectiveStoreMode ?? storeDownloadMode ?? 'local'
  const actionLabels = getDownloadActionLabels(activeDownloadMode)

  const handleDownloadSingle = () => {
    if (item.disabled) return
    // [Bug Fix] 同 Grid/ListView：无真实直下回调时禁止假"已开始下载"toast
    if (onDownloadSingle) {
      onDownloadSingle(item, course, category)
    } else if (item.onDownload) {
      item.onDownload()
    } else if (item.onDownloadSingle) {
      item.onDownloadSingle()
    } else {
      if (!item.selected) {
        item.onToggle()
      }
      showToast(actionLabels.toastPromptMessage(item.name), 'info')
      return
    }
    showToast(actionLabels.toastMessage(item.name), 'success')
  }

  const ext = item.name.split('.').pop()?.toLowerCase() || ''
  const isVideo = ['mp4', 'mkv', 'mov', 'flv', 'ts', 'webm'].includes(ext) || item.type === 'MP4'
  const isAudio = ['mp3', 'm4a', 'wav', 'aac', 'flac'].includes(ext) || item.type === 'M4A'

  return (
    <div
      data-testid="file-detail-inspector"
      className={`flex w-80 md:w-96 shrink-0 flex-col bg-surface-1 p-5 overflow-y-auto border-l border-bd select-none h-full relative animate-fadeIn ${hasSelection ? 'pb-24' : ''}`}
    >
      {/* 顶部标题区与关闭按钮 */}
      <div className="flex items-center justify-between pb-3 border-b border-bd shrink-0">
        <span className="text-xs font-bold text-text-2">课件详情与预览</span>
        <button
          type="button"
          onClick={onClose}
          className="text-text-4 hover:text-text-1 text-xs p-1 rounded-md hover:bg-surface-3 transition-colors cursor-pointer"
          title="关闭详情面板"
          aria-label="关闭详情面板"
        >
          ✕
        </button>
      </div>

      {/* 缩略图与大图标预览 */}
      <div className="my-4 shrink-0">
        {isVideo ? (
          <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black flex items-center justify-center shadow-md">
            <div className="flex flex-col items-center justify-center text-white/90 gap-2 p-4 text-center">
              <span className="text-4xl">🎬</span>
              <span className="text-xs font-semibold">课堂视频 / 录播课件</span>
              <span className="text-2xs text-white/60">可直接点击下方按钮即时单文件下载</span>
            </div>
          </div>
        ) : isAudio ? (
          <div className="w-full rounded-xl bg-surface-2 p-5 flex flex-col items-center border border-bd shadow-xs">
            <div className="h-16 w-16 rounded-2xl bg-cyan-500/10 text-cyan-500 flex items-center justify-center text-3xl mb-2 shadow-inner">
              🎵
            </div>
            <span className="text-xs font-medium text-text-2">音频课件</span>
          </div>
        ) : (
          <div className="w-full rounded-xl bg-surface-2/60 p-6 flex flex-col items-center justify-center border border-bd shadow-xs">
            <div className="scale-125 mb-2">
              <FileTypeBadge filename={item.name} type={item.type} />
            </div>
            <span className="text-2xs font-mono font-bold text-text-3 uppercase tracking-wider mt-2">{ext || item.type || 'DOCUMENT'}</span>
          </div>
        )}
      </div>

      {/* 文件名 */}
      <h3 className="text-sm font-bold text-text-1 break-all select-text leading-snug mb-3 shrink-0" title={item.name}>
        {item.name}
      </h3>

      {/* 详细元数据表 */}
      <div className="w-full rounded-xl border border-bd bg-surface-2/60 p-3.5 text-left text-xs divide-y divide-bd space-y-2 mb-4 shrink-0 shadow-2xs">
        {course?.name && (
          <div className="flex justify-between py-1">
            <span className="text-text-3">所属课程</span>
            <span className="font-semibold text-text-1 text-2xs truncate max-w-[180px]" title={course.name}>
              {course.name}
            </span>
          </div>
        )}
        {category?.name && (
          <div className="flex justify-between py-1">
            <span className="text-text-3">所属分类</span>
            <span className="font-semibold text-text-1 text-2xs">{category.name}</span>
          </div>
        )}
        {item.assignmentMeta ? (
          <>
            <div className="flex justify-between py-1">
              <span className="text-text-3">作业属性</span>
              <span className="font-semibold text-text-1 text-2xs">全量归档包</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-text-3">提交状态</span>
              <span className={`text-2xs font-semibold ${item.assignmentMeta.hasSubmission ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {item.assignmentMeta.hasSubmission
                  ? (item.assignmentMeta.submissionScore !== undefined ? `已提交 · ${item.assignmentMeta.submissionScore}分` : '已提交待批改')
                  : '未提交'}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-text-3">包含内容</span>
              <span className="font-medium text-text-2 text-2xs">
                {item.assignmentMeta.submissionFileCount} 个原件 · {item.assignmentMeta.teacherAttachmentCount} 个附件 · 说明.md
              </span>
            </div>
            {item.assignmentMeta.dueAt && (
              <div className="flex justify-between py-1">
                <span className="text-text-3">截止时间</span>
                <span className="font-mono text-text-2 text-2xs">{item.assignmentMeta.dueAt.slice(0, 16).replace('T', ' ')}</span>
              </div>
            )}
          </>
        ) : (
          <div className="flex justify-between py-1">
            <span className="text-text-3">文件大小</span>
            <span className="font-mono font-bold text-accent">{item.size ? formatBytes(item.size) : '未知'}</span>
          </div>
        )}
        {item.date && (
          <div className="flex justify-between py-1">
            <span className="text-text-3">讲次/时间</span>
            <span className="font-mono text-text-2 text-2xs">{item.date}</span>
          </div>
        )}
        <div className="flex justify-between py-1">
          <span className="text-text-3">状态</span>
          <span className={`text-2xs font-medium ${item.disabled ? 'text-warning' : item.selected ? 'text-accent' : 'text-text-3'}`}>
            {item.disabled ? item.disabledReason || '不可用' : item.selected ? '已加入清单' : '未选择'}
          </span>
        </div>
      </div>

      {item.renderExtra && (
        <div className="w-full mb-4 p-3 rounded-xl bg-surface-2/50 border border-bd text-xs shrink-0">
          <div className="text-2xs font-semibold text-text-3 mb-1.5 uppercase tracking-wider">资源属性</div>
          {item.renderExtra}
        </div>
      )}

      {/* Toast 提示浮条 */}
      <Toast toast={toast} onClose={hideToast} position="bottom-wide" />

      {/* 底部双按钮操作区 */}
      <div className="flex flex-col gap-2 mt-auto shrink-0 pt-2">
        <button
          type="button"
          data-testid="file-download-btn"
          disabled={item.disabled}
          onClick={handleDownloadSingle}
          className={`w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
            item.disabled
              ? 'bg-surface-3 text-text-4 cursor-not-allowed opacity-60'
              : 'bg-accent text-white shadow-glow-sm hover:bg-accent-light active:scale-[0.98]'
          }`}
        >
          <span>{actionLabels.detailActionText}</span>
        </button>

        <button
          type="button"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return
            item.onToggle()
          }}
          className={`w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-medium border transition-all cursor-pointer ${
            item.disabled
              ? 'border-bd bg-surface-2 text-text-4 cursor-not-allowed opacity-60'
              : item.selected
                ? 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20'
                : 'border-bd bg-surface-2 text-text-2 hover:bg-surface-3 hover:text-text-1'
          }`}
        >
          <span>{item.selected ? '✓ 已加入清单 · 点击取消' : '+ 勾选此文件加入清单'}</span>
        </button>
      </div>
    </div>
  )
}
