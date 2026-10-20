import React, { useState, useRef, useEffect, useCallback } from 'react'
import type { DownloadMode } from '@shared/types'
import { useAppStore } from '../store/app'
import { Spinner } from './Spinner'

export type VideoPerspective = 'all' | 'teacher' | 'ppt' | 'audio'

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
}

export const VIDEO_PERSPECTIVE_OPTIONS: Array<{
  key: VideoPerspective
  label: string
  desc: string
}> = [
  { key: 'all', label: '双机位同时下载', desc: '包含教师画面与PPT投屏' },
  { key: 'teacher', label: '仅教师画面', desc: '标准板书与教师全景' },
  { key: 'ppt', label: '仅PPT投影', desc: '高清讲义与屏幕共享' },
  { key: 'audio', label: '仅原声音频', desc: '超省空间，随时听课' }
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
  onPerspectiveChange,
  downloadMode,
  onDownloadModeChange,
  onStartDownload,
  onClearSelection,
  defaultPopoverOpen = false,
  batchProgress
}: FloatingCommandIslandProps): React.JSX.Element | null {
  // 内部状态（支持受控与非受控）
  const [internalCategorySelection, setInternalCategorySelection] = useState<CategorySelectionState>({
    files: true,
    videos: true,
    assignments: true,
    pptPdf: true
  })
  const [internalPerspective, setInternalPerspective] = useState<VideoPerspective>('teacher')
  const [isPopoverOpen, setIsPopoverOpen] = useState(defaultPopoverOpen)

  const popoverRef = useRef<HTMLDivElement>(null)
  const videoTriggerRef = useRef<HTMLDivElement>(null)

  // 确定有效状态
  const activeCategoryState: CategorySelectionState = {
    files: categorySelection?.files ?? internalCategorySelection.files ?? true,
    videos: categorySelection?.videos ?? internalCategorySelection.videos ?? true,
    assignments: categorySelection?.assignments ?? internalCategorySelection.assignments ?? true,
    pptPdf: categorySelection?.pptPdf ?? internalCategorySelection.pptPdf ?? true
  }

  const currentPerspective = perspective ?? internalPerspective

  // 存储模式优先使用 props，无传入时同步 Zustand 全局状态
  const storeDownloadMode = useAppStore((s) => s.downloadMode)
  const currentDownloadMode = downloadMode ?? storeDownloadMode ?? 'local'

  // 全局下载进行中标志 + 批量进度激活标志（提前声明：快捷键 effect 与隐藏条件都要用）
  const storeDownloading = useAppStore((s) => s.downloading)
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

  const handlePerspectiveSelect = useCallback(
    (p: VideoPerspective) => {
      if (onPerspectiveChange) {
        onPerspectiveChange(p)
      } else {
        setInternalPerspective(p)
      }
      setIsPopoverOpen(false)
    },
    [onPerspectiveChange]
  )

  const handleDownloadModeChange = useCallback(
    (mode: DownloadMode) => {
      if (onDownloadModeChange) {
        onDownloadModeChange(mode)
      } else {
        useAppStore.getState().setDownloadMode(mode)
      }
    },
    [onDownloadModeChange]
  )

  const handleStartDownload = useCallback(() => {
    onStartDownload?.()
  }, [onStartDownload])

  // 点击外部关闭视频机位悬浮菜单
  useEffect(() => {
    if (!isPopoverOpen) return

    const handlePointerDown = (event: MouseEvent | PointerEvent): void => {
      const target = event.target as Node
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        videoTriggerRef.current &&
        !videoTriggerRef.current.contains(target)
      ) {
        setIsPopoverOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isPopoverOpen])

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
        if (isPopoverOpen) {
          setIsPopoverOpen(false)
        } else if (onClearSelection) {
          e.preventDefault()
          onClearSelection()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleStartDownload, isPopoverOpen, onClearSelection, selectedSummary.totalItems, batchActive, storeDownloading])

  // 当没有选中任何项目时平滑隐藏。
  // [Bug Fix] 下载进行中不隐藏：岛的进度环是批量进度的唯一实时展示位（原
  // OverallProgressBar 已死），下载中即使清空勾选也保持可见直到批次收尾。
  if (selectedSummary.totalItems <= 0 && !batchActive) {
    return null
  }

  // 左侧信息汇聚文案
  const infoText = isSingleCourse
    ? `✦ ${typeof selectedSummary.categoryCount === 'number' ? `已选 ${selectedSummary.categoryCount} 个分类 · ` : ''}共 ${selectedSummary.totalItems} 项资源 · ${selectedSummary.formattedSize}`
    : `✦ ${typeof selectedSummary.courseCount === 'number' ? `已选 ${selectedSummary.courseCount} 门课程 · ` : ''}共 ${selectedSummary.totalItems} 项资源 · ${selectedSummary.formattedSize}`

  return (
    <div
      role="toolbar"
      aria-label="下载底栏智能指挥动作岛"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-4xl w-[92%] sm:w-auto bg-surface-1/90 dark:bg-surface-1/85 backdrop-blur-xl border border-bd/80 shadow-2xl rounded-2xl px-4 py-2.5 flex items-center gap-3 animate-fadeIn animate-in fade-in slide-in-from-bottom-4 duration-200 select-none"
    >
      {/* ① 左侧信息汇聚胶囊 */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-2/70 border border-bd/50 text-xs text-text-2 whitespace-nowrap">
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

      {/* ② 中间分类交互芯片组 */}
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        {/* 课件芯片 */}
        <button
          type="button"
          role="button"
          aria-pressed={activeCategoryState.files}
          onClick={() => handleToggleCategory('files')}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs border transition-all duration-150 cursor-pointer ${
            activeCategoryState.files
              ? 'bg-accent/10 text-accent font-semibold border-accent/30'
              : 'border-bd/60 text-text-3 hover:text-text-2 bg-surface-2/40'
          }`}
        >
          <span>📘 课件 {selectedSummary.filesCount ?? 0}</span>
        </button>

        {/* 视频芯片（带机位弹出菜单） */}
        <div ref={videoTriggerRef} className="relative inline-flex items-center">
          <div
            className={`inline-flex items-center rounded-xl text-xs border transition-all duration-150 ${
              activeCategoryState.videos
                ? 'bg-accent/10 text-accent font-semibold border-accent/30'
                : 'border-bd/60 text-text-3 hover:text-text-2 bg-surface-2/40'
            }`}
          >
            <button
              type="button"
              role="button"
              aria-pressed={activeCategoryState.videos}
              onClick={() => handleToggleCategory('videos')}
              className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 cursor-pointer"
            >
              <span>🎬 视频 {selectedSummary.videoCount ?? 0}</span>
            </button>
            <button
              type="button"
              role="button"
              aria-label="选择视频机位"
              aria-haspopup="menu"
              aria-expanded={isPopoverOpen}
              onClick={(e) => {
                e.stopPropagation()
                setIsPopoverOpen((prev) => !prev)
              }}
              className="pr-2 pl-1 py-1 hover:opacity-80 transition-opacity cursor-pointer text-[11px]"
            >
              ▾
            </button>
          </div>

          {/* 视频机位快捷悬浮菜单 (Floating Popover) */}
          {isPopoverOpen && (
            <div
              ref={popoverRef}
              role="menu"
              aria-label="选择视频机位"
              className="absolute bottom-full mb-2.5 left-1/2 -translate-x-1/2 z-50 w-56 rounded-2xl border border-bd/80 bg-surface-1/95 backdrop-blur-xl p-1.5 shadow-2xl animate-fadeIn"
            >
              <div className="px-2.5 py-1 text-[11px] font-medium text-text-3 border-b border-bd/50 mb-1">
                选择视频机位 / 音轨
              </div>
              {VIDEO_PERSPECTIVE_OPTIONS.map((opt) => {
                const active = currentPerspective === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    role="menuitem"
                    onClick={() => handlePerspectiveSelect(opt.key)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-xl transition-colors cursor-pointer text-left ${
                      active
                        ? 'bg-accent/15 text-accent font-semibold'
                        : 'text-text-2 hover:text-text-1 hover:bg-surface-2/80'
                    }`}
                  >
                    <div className="flex flex-col">
                      <span>{opt.label}</span>
                      <span className="text-[10px] text-text-4 font-normal mt-0.5">{opt.desc}</span>
                    </div>
                    {active && <span className="text-accent text-xs font-bold ml-2">✓</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* 作业芯片 */}
        <button
          type="button"
          role="button"
          aria-pressed={activeCategoryState.assignments}
          onClick={() => handleToggleCategory('assignments')}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs border transition-all duration-150 cursor-pointer ${
            activeCategoryState.assignments
              ? 'bg-accent/10 text-accent font-semibold border-accent/30'
              : 'border-bd/60 text-text-3 hover:text-text-2 bg-surface-2/40'
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
              ? 'bg-accent/10 text-accent font-semibold border-accent/30'
              : 'border-bd/60 text-text-3 hover:text-text-2 bg-surface-2/40'
          }`}
        >
          <span>📑 PPT讲义 {selectedSummary.pptCount ?? 0}</span>
        </button>
      </div>

      {/* ③ 右侧存储目标切换胶囊 */}
      <div
        role="group"
        aria-label="存储目标切换"
        className="inline-flex items-center rounded-xl border border-bd/60 bg-surface-2/60 p-0.5 text-xs select-none whitespace-nowrap"
      >
        {STORAGE_DEST_OPTIONS.map((dest) => {
          const isCurrent = currentDownloadMode === dest.key
          return (
            <button
              key={dest.key}
              type="button"
              role="button"
              aria-pressed={isCurrent}
              onClick={() => handleDownloadModeChange(dest.key)}
              className={`px-2.5 py-1 rounded-lg transition-all duration-150 cursor-pointer text-xs ${
                isCurrent
                  ? 'bg-surface-1 text-text-1 font-semibold shadow-2xs'
                  : 'text-text-3 hover:text-text-2'
              }`}
            >
              {dest.label}
            </button>
          )
        })}
      </div>

      {/* ④ 主执行大按钮：下载中变为进度环 + done/total（继承已死的 OverallProgressBar 职责） */}
      {batchActive && batchProgress ? (
        <div
          role="status"
          aria-label={`批量下载进度 ${batchProgress.done}/${batchProgress.total}`}
          className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-xl bg-surface-2/80 border border-bd/60 text-xs select-none whitespace-nowrap"
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
          aria-label={`立即下载 ${selectedSummary.formattedSize}`}
          onClick={handleStartDownload}
          disabled={storeDownloading}
          className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-accent hover:bg-accent-dark active:scale-[0.98] text-white font-semibold text-xs sm:text-sm shadow-glow-sm hover:shadow-glow transition-all duration-150 cursor-pointer whitespace-nowrap ${
            storeDownloading ? 'opacity-60 cursor-not-allowed hover:bg-accent' : ''
          }`}
        >
          <span>{storeDownloading ? '下载进行中…' : `立即下载 ${selectedSummary.formattedSize}`}</span>
          {!storeDownloading && (
            <span className="inline-flex items-center font-mono text-[11px] opacity-80">⏎</span>
          )}
        </button>
      )}
    </div>
  )
}
