import React, { useState, useEffect, useCallback } from 'react'
import type { DownloadMode, VideoQualityOption } from '@shared/types'
import { getDownloadActionLabels } from '@shared/utils'
import { useAppStore } from '../store/app'
import { Spinner } from './Spinner'

import type { VideoPerspective } from '@shared/types'
export type { VideoPerspective }

export interface CategorySelectionState {
  files?: boolean
  videos?: boolean
  assignments?: boolean
  pptPdf?: boolean
}

export interface SelectedSummary {
  courseCount?: number
  categoryCount?: number
  totalItems: number
  formattedSize: string
  filesCount?: number
  videoCount?: number
  assignCount?: number
  pptCount?: number
}

export interface FloatingCommandIslandProps {
  /** 选中汇总信息 */
  selectedSummary: SelectedSummary
  /** 是否处于单门课程视图（为 true 时左侧胶囊展示分类数而非课程数） */
  isSingleCourse?: boolean
  /** 分类激活状态（未传则默认全部激活） */
  categorySelection?: CategorySelectionState
  /** 分类激活切换回调 */
  onToggleCategory?: (category: 'files' | 'videos' | 'assignments' | 'pptPdf') => void
  /** 当前视频机位 */
  perspective?: VideoPerspective
  /** 视频机位切换回调 */
  onPerspectiveChange?: (perspective: VideoPerspective) => void
  /** 存储目标模式（'local' | 'cloud' | 'both'） */
  downloadMode?: DownloadMode
  /** 存储目标模式切换回调 */
  onDownloadModeChange?: (mode: DownloadMode) => void
  /** 触发立即下载主回调 */
  onStartDownload?: () => void
  /** 清空选择回调 */
  onClearSelection?: () => void
  /** 视频画质与音频模式偏好（可受控覆盖） */
  videoQualityOption?: VideoQualityOption
  /** 初始是否展开视频机位悬浮菜单（静态渲染测试与受控场景用；生产挂载方不传） */
  defaultPopoverOpen?: boolean
  /** 本轮批量下载进度（done/downloading/uploading/failed/total 及 inflight 比例和）。
   *  由挂载方（NetdiskCourseExplorer）基于 batchTaskIds 计算注入；下载中时主按钮
   *  外圈渲染进度环并显示 done/total，替代已死亡的 OverallProgressBar 的职责。
   *  不传（undefined）时维持纯 CTA 形态（历史行为）。 */
  batchProgress?: {
    done: number
    downloading: number
    uploading: number
    failed: number
    total: number
    /** 0..total 的已完成比例和（含小数），让环平滑推进 */
    inflight: number
  }
  /** 全局下载进行中状态（可由外部受控传入或自同步 store） */
  storeDownloading?: boolean
}

export const PERSPECTIVE_LABELS: Record<VideoPerspective, string> = {
  all: '双机位同时下载',
  teacher: '仅教师视角',
  ppt: '仅PPT投屏',
  audio: '纯音频 MP3'
}

export const VIDEO_PERSPECTIVE_OPTIONS: Array<{
  key: VideoPerspective
  label: string
  desc: string
}> = [
  { key: 'all', label: '双机位同时下载', desc: '包含教师画面与PPT投屏' },
  { key: 'teacher', label: '仅教师视角', desc: '标准板书与教师全景' },
  { key: 'ppt', label: '仅PPT投屏', desc: '高清讲义与屏幕共享' },
  { key: 'audio', label: '纯音频 MP3', desc: '超省空间，随时听课' }
]

export const STORAGE_DEST_OPTIONS: Array<{ key: DownloadMode; label: string }> = [
  { key: 'local', label: '📁 本地' },
  { key: 'cloud', label: '☁️ 云盘' },
  { key: 'both', label: '双备份' }
]

/**
 * 现代 Apple HIG / Raycast 风格底栏智能指挥动作岛
 * 提供选中资源容量动态计量、分类快捷过滤、视频视角下拉及主执行下载入口。
 */
export function FloatingCommandIsland({
  selectedSummary,
  isSingleCourse = false,
  categorySelection,
  onToggleCategory,
  perspective,
  onPerspectiveChange: _onPerspectiveChange,
  downloadMode: _downloadMode,
  onDownloadModeChange: _onDownloadModeChange,
  onStartDownload,
  onClearSelection,
  videoQualityOption: propVideoQuality,
  defaultPopoverOpen: _defaultPopoverOpen = false,
  batchProgress,
  storeDownloading: propStoreDownloading
}: FloatingCommandIslandProps): React.JSX.Element | null {
  // 内部状态（支持受控与非受控）
  const [internalCategorySelection, setInternalCategorySelection] = useState<CategorySelectionState>({
    files: true,
    videos: true,
    assignments: true,
    pptPdf: true
  })
  const [internalPerspective] = useState<VideoPerspective>('teacher')


  // 确定有效状态
  const activeCategoryState: CategorySelectionState = {
    files: categorySelection?.files ?? internalCategorySelection.files ?? true,
    videos: categorySelection?.videos ?? internalCategorySelection.videos ?? true,
    assignments: categorySelection?.assignments ?? internalCategorySelection.assignments ?? true,
    pptPdf: categorySelection?.pptPdf ?? internalCategorySelection.pptPdf ?? true
  }

  const storeVideoQuality = useAppStore((s) => s.videoQualityOption)
  const videoQualityOption = propVideoQuality ?? storeVideoQuality
  const globalPerspective = useAppStore((s) => s.videoPerspectivePreference)
  const currentPerspective = perspective ?? globalPerspective ?? internalPerspective
  const isAudioOnly = videoQualityOption === 'audio_only' || currentPerspective === 'audio'
  const perspectiveLabel = PERSPECTIVE_LABELS[currentPerspective] || '仅教师视角'

  const videoChipLabel = isAudioOnly
    ? `🎵 原声音频 ${selectedSummary.videoCount ?? 0}`
    : currentPerspective === 'teacher'
    ? `🎬 教师视频 ${selectedSummary.videoCount ?? 0}`
    : currentPerspective === 'ppt'
    ? `🎬 PPT视频 ${selectedSummary.videoCount ?? 0}`
    : `🎬 双机位视频 ${selectedSummary.videoCount ?? 0}`

  const videoChipTitle = isAudioOnly
    ? '当前下载模式: 仅下载原声音频（如需修改请前往「设置 - 课件与多媒体」）'
    : `当前下载视角: ${perspectiveLabel}（如需修改请前往「设置 - 课件与多媒体」）`

  // 存储模式优先使用 props，无传入时同步 Zustand 全局状态
  const storeDownloadMode = useAppStore((s) => s.downloadMode)
  const effectiveStoreMode = typeof useAppStore.getState === 'function' ? useAppStore.getState().downloadMode : storeDownloadMode
  const currentDownloadMode = _downloadMode ?? effectiveStoreMode ?? storeDownloadMode ?? 'local'
  const actionLabels = getDownloadActionLabels(currentDownloadMode)

  // 全局下载进行中标志 + 批量进度激活标志（提前声明：快捷键 effect 与隐藏条件都要用）
  const globalDownloading = useAppStore((s) => s.downloading)
  const storeDownloading = propStoreDownloading ?? globalDownloading
  const batchActive = batchProgress !== undefined && batchProgress.total > 0

  const handleToggleCategory = useCallback(
    (category: 'files' | 'videos' | 'assignments' | 'pptPdf') => {
      if (onToggleCategory) {
        onToggleCategory(category)
      } else {
        setInternalCategorySelection((prev) => ({
          ...prev,
          [category]: !prev[category]
        }))
      }
    },
    [onToggleCategory]
  )

  const handleStartDownload = useCallback(() => {
    onStartDownload?.()
  }, [onStartDownload])

  // 全局快捷键：Enter 立即下载，Esc 关闭浮窗或清空选择。
  // [Bug Fix] 下载进行中禁用 Enter 提交（与页面 onDownload 的 st.downloading 守卫一致），
  // 防止批次中途重复入队同一批 taskId。
  useEffect(() => {
    if (selectedSummary.totalItems <= 0 && !batchActive) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName ? target.tagName.toLowerCase() : ''
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) {
          return
        }
      }

      if (e.key === 'Enter') {
        if (storeDownloading) return
        e.preventDefault()
        handleStartDownload()
      } else if (e.key === 'Escape') {
        if (onClearSelection) {
          e.preventDefault()
          onClearSelection()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleStartDownload, onClearSelection, selectedSummary.totalItems, batchActive, storeDownloading])

  // 当没有选中任何项目时平滑隐藏。
  // [Bug Fix] 下载进行中不隐藏：岛的进度环是批量进度的唯一实时展示位（原
  // OverallProgressBar 已死），下载中即使清空勾选也保持可见直到批次收尾。
  if (selectedSummary.totalItems <= 0 && !batchActive) {
    return null
  }

  // 左侧信息汇聚文案
  const infoText = isSingleCourse
    ? `✦ ${typeof selectedSummary.categoryCount === 'number' ? `已选 ${selectedSummary.categoryCount} 个分类 · ` : ''}共 ${selectedSummary.totalItems} 项资源 · ${selectedSummary.formattedSize && selectedSummary.formattedSize !== '0 B' ? selectedSummary.formattedSize : '待获取体积'}`
    : `✦ ${typeof selectedSummary.courseCount === 'number' ? `已选 ${selectedSummary.courseCount} 门课程 · ` : ''}共 ${selectedSummary.totalItems} 项资源 · ${selectedSummary.formattedSize && selectedSummary.formattedSize !== '0 B' ? selectedSummary.formattedSize : '待获取体积'}`

  return (
    <div
      role="toolbar"
      aria-label="下载底栏智能指挥动作岛"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-2.5rem)] w-fit bg-gradient-to-b from-white/95 to-slate-50/90 dark:from-[#242428]/95 dark:to-[#1a1a1d]/95 backdrop-blur-xl border border-black/[0.08] dark:border-[#38383c] shadow-2xl shadow-[0_16px_40px_-8px_rgba(0,0,0,0.18),0_1px_1px_rgba(255,255,255,0.9)_inset] dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)] rounded-2xl px-3.5 py-2 flex items-center gap-2.5 animate-fadeIn animate-in fade-in slide-in-from-bottom-4 duration-200 select-none overflow-visible"
    >
      {/* ① 左侧信息汇聚胶囊 */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100/80 dark:bg-surface-2 border border-black/[0.04] dark:border-bd text-xs text-text-2 shadow-2xs whitespace-nowrap shrink-0">
        {onClearSelection && (
          <button
            type="button"
            role="button"
            onClick={onClearSelection}
            title="清空选择"
            aria-label="清空选择"
            className="text-text-4 hover:text-text-1 hover:bg-surface-3 p-1 rounded-full transition-colors cursor-pointer text-xs leading-none"
          >
            ✕
          </button>
        )}
        <span className="font-medium text-text-1">{infoText}</span>
      </div>

      {/* 分割线 */}
      <div className="h-4 w-px bg-bd-strong shrink-0" />

      {/* ② 中间分类交互芯片组 */}
      <div className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
        {/* 课件芯片 */}
        <button
          type="button"
          role="button"
          aria-pressed={activeCategoryState.files}
          onClick={() => handleToggleCategory('files')}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs border transition-all duration-150 cursor-pointer ${
            activeCategoryState.files
              ? 'bg-accent/10 text-accent font-semibold border-accent/30 shadow-2xs'
              : 'border-black/[0.06] dark:border-bd text-text-3 hover:text-text-1 bg-slate-100/60 dark:bg-surface-2/60 hover:bg-slate-200/50 dark:hover:bg-surface-3'
          }`}
        >
          <span>📘 课件 {selectedSummary.filesCount ?? 0}</span>
        </button>

        {/* 视频/音频芯片（悬停显示当前机位/音频提示，点击切换勾选） */}
        <button
          type="button"
          role="button"
          aria-pressed={activeCategoryState.videos}
          onClick={() => handleToggleCategory('videos')}
          title={videoChipTitle}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs border transition-all duration-150 cursor-pointer ${
            activeCategoryState.videos
              ? 'bg-accent/10 text-accent font-semibold border-accent/30 shadow-2xs'
              : 'border-black/[0.06] dark:border-bd text-text-3 hover:text-text-1 bg-slate-100/60 dark:bg-surface-2/60 hover:bg-slate-200/50 dark:hover:bg-surface-3'
          }`}
        >
          <span>{videoChipLabel}</span>
        </button>

        {/* 作业芯片 */}
        <button
          type="button"
          role="button"
          aria-pressed={activeCategoryState.assignments}
          onClick={() => handleToggleCategory('assignments')}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs border transition-all duration-150 cursor-pointer ${
            activeCategoryState.assignments
              ? 'bg-accent/10 text-accent font-semibold border-accent/30 shadow-2xs'
              : 'border-black/[0.06] dark:border-bd text-text-3 hover:text-text-1 bg-slate-100/60 dark:bg-surface-2/60 hover:bg-slate-200/50 dark:hover:bg-surface-3'
          }`}
        >
          <span>📝 作业 {selectedSummary.assignCount ?? 0}</span>
        </button>

        {/* PPT 讲义芯片 */}
        <button
          type="button"
          role="button"
          aria-pressed={activeCategoryState.pptPdf}
          onClick={() => handleToggleCategory('pptPdf')}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs border transition-all duration-150 cursor-pointer ${
            activeCategoryState.pptPdf
              ? 'bg-accent/10 text-accent font-semibold border-accent/30 shadow-2xs'
              : 'border-black/[0.06] dark:border-bd text-text-3 hover:text-text-1 bg-slate-100/60 dark:bg-surface-2/60 hover:bg-slate-200/50 dark:hover:bg-surface-3'
          }`}
        >
          <span>📑 PPT讲义 {selectedSummary.pptCount ?? 0}</span>
        </button>
      </div>

      {/* 分割线 */}
      <div className="h-4 w-px bg-bd-strong shrink-0" />

      {/* ④ 主执行大按钮：下载中变为进度环 + done/total（继承已死的 OverallProgressBar 职责） */}
      {batchActive && batchProgress ? (
        <div
          role="status"
          aria-label={`批量下载进度 ${batchProgress.done}/${batchProgress.total}`}
          className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-slate-100/80 dark:bg-surface-2 border border-black/[0.06] dark:border-bd text-xs select-none whitespace-nowrap shrink-0 shadow-2xs"
          title={`完成 ${batchProgress.done} / ${batchProgress.total}${batchProgress.downloading > 0 ? ` · 下载中 ${batchProgress.downloading}` : ''}${batchProgress.uploading > 0 ? ` · 上传中 ${batchProgress.uploading}` : ''}${batchProgress.failed > 0 ? ` · 失败 ${batchProgress.failed}` : ''}`}
        >
          {/* 环形进度：done 实心段 + inflight 半透明段，中心 spinner */}
          <span className="relative inline-flex h-6 w-6 items-center justify-center">
            <svg className="h-6 w-6 -rotate-90" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" className="text-surface-4" />
              {(() => {
                const C = 2 * Math.PI * 9
                const wDone = batchProgress.total > 0 ? Math.min(1, batchProgress.done / batchProgress.total) : 0
                const wInflight = batchProgress.total > 0
                  ? Math.min(1 - wDone, Math.max(0, batchProgress.inflight) / batchProgress.total)
                  : 0
                return (
                  <>
                    <circle
                      cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5"
                      className="text-accent/40 transition-[stroke-dashoffset] duration-300"
                      strokeDasharray={`${C * wInflight} ${C}`}
                      strokeDashoffset={`${-C * wDone}`}
                      strokeLinecap="round"
                    />
                    <circle
                      cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5"
                      className="text-accent transition-[stroke-dashoffset] duration-300"
                      strokeDasharray={`${C * wDone} ${C}`}
                      strokeLinecap="round"
                    />
                  </>
                )
              })()}
            </svg>
            <Spinner size={10} className="absolute" />
          </span>
          <span className="font-medium text-text-1 tabular-nums">
            {batchProgress.done}/{batchProgress.total}
          </span>
          {batchProgress.downloading > 0 && (
            <span className="text-info">↓{batchProgress.downloading}</span>
          )}
          {batchProgress.uploading > 0 && (
            <span className="text-violet-400">↑{batchProgress.uploading}</span>
          )}
          {batchProgress.failed > 0 && (
            <span className="text-warning">失败 {batchProgress.failed}</span>
          )}
        </div>
      ) : (
        <button
          type="button"
          role="button"
          data-testid="floating-cta-download"
          aria-label={selectedSummary.formattedSize && selectedSummary.formattedSize !== '0 B' ? `${actionLabels.ctaPrefix} ${selectedSummary.formattedSize}` : `${actionLabels.ctaPrefix} · 共 ${selectedSummary.totalItems} 项`}
          onClick={handleStartDownload}
          disabled={storeDownloading}
          className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-accent to-sky-600 hover:from-accent-dark hover:to-sky-700 active:scale-[0.98] text-white font-semibold text-xs sm:text-sm shadow-md shadow-accent/25 hover:shadow-lg hover:shadow-accent/35 transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0 ${
            storeDownloading ? 'opacity-60 cursor-not-allowed hover:from-accent hover:to-sky-600' : ''
          }`}
        >
          <span>{storeDownloading ? actionLabels.inProgressText : (selectedSummary.formattedSize && selectedSummary.formattedSize !== '0 B' ? `${actionLabels.ctaPrefix} ${selectedSummary.formattedSize}` : `${actionLabels.ctaPrefix} · 共 ${selectedSummary.totalItems} 项`)}</span>
          {!storeDownloading && (
            <span className="inline-flex items-center font-mono text-[11px] opacity-80 ml-0.5">⏎</span>
          )}
        </button>
      )}
    </div>
  )
}
