import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useShallow } from 'zustand/shallow'
import { createDeduplicatedStorage } from './dedup-storage'
import type {
  CanvasAssignmentExportOptions,
  DownloadProgress,
  DownloadState
} from '@shared/types'

// 导入领域切片
import { createAuthSlice, type AuthSlice, type Stage } from './slices/auth-slice'
import {
  createSettingsSlice,
  type SettingsSlice,
  type Theme,
  type WindowCloseAction,
  type ExitWhenDownloadingPolicy,
  type CourseViewMode
} from './slices/settings-slice'
import { createCloudPanSlice, type CloudPanSlice } from './slices/cloudpan-slice'
import { createScheduleSlice, type ScheduleSlice } from './slices/schedule-slice'
import { createDownloadSlice, type DownloadSlice } from './slices/download-slice'
import {
  createCourseSlice,
  type CourseSlice,
  type ScanState,
  type LectureGroup
} from './slices/course-slice'

// 重新导出外部所需类型
export type {
  Stage,
  ScanState,
  Theme,
  WindowCloseAction,
  ExitWhenDownloadingPolicy,
  CourseViewMode,
  LectureGroup
}

/** 组合全局状态类型 */
export type AppState = AuthSlice &
  SettingsSlice &
  CloudPanSlice &
  ScheduleSlice &
  DownloadSlice &
  CourseSlice

/**
 * both 模式下，把云端进度合并到本地 taskId 对应的条目上；
 * 单任务组件（AngleCell）直接订阅此 selector 即可拿到聚合后的状态。
 */
export function useEffectiveProgress(taskId: string): DownloadProgress | undefined {
  const [local, cloud] = useAppStore(
    useShallow(s => {
      const cloudId = s.downloadMode === 'both' ? s.cloudLinkedIds[taskId] : undefined
      return [s.progress[taskId], cloudId ? s.progress[cloudId] : undefined]
    })
  )

  if (!cloud) return local

  const localDone = local?.state === 'done' || local?.state === 'skipped'
  const cloudDone = cloud?.state === 'done' || cloud?.state === 'skipped'
  const eitherError = local?.state === 'error' || cloud?.state === 'error'
  let mergedState: DownloadState = local?.state ?? 'pending'
  let mergedMsg = local?.message
  let mergedReceived = local?.received ?? 0
  let mergedTotal = local?.total ?? 0
  if (eitherError) {
    mergedState = 'error'
    mergedMsg = local?.state === 'error' ? local?.message : cloud?.message
  } else if (localDone && cloudDone) {
    mergedState = 'done'
  } else if (localDone && !cloudDone) {
    if (cloud?.state === 'cancelled') {
      mergedState = 'done'
    } else if (cloud?.state === 'paused') {
      mergedState = 'downloading'
      mergedMsg = '本地完成 · 云端已暂停'
    } else {
      mergedState = 'downloading'
      mergedReceived = cloud?.received ?? 0
      mergedTotal = cloud?.total ?? 0
      mergedMsg = '本地完成 · 云端上传中'
    }
  }
  return { taskId, state: mergedState, received: mergedReceived, total: mergedTotal, message: mergedMsg }
}

/**
 * 顶层下载统计：对一组 taskIds 聚合 done/failed/active 计数返回。
 */
export function useDownloadStats(
  taskIds: string[],
  isBothMode: boolean
): { done: number; failed: number; active: number } {
  return useAppStore(
    useShallow(s => {
      let done = 0
      let failed = 0
      let active = 0
      for (const id of taskIds) {
        const st = s.progress[id]?.state
        if (isBothMode) {
          const cloudId = s.cloudLinkedIds[id]
          const cloudSt = cloudId ? s.progress[cloudId]?.state : undefined
          const localFinal = st === 'done' || st === 'skipped' || st === 'error' || st === 'cancelled'
          const cloudFinal = !cloudId || cloudSt === 'done' || cloudSt === 'skipped' || cloudSt === 'error' || cloudSt === 'cancelled'
          if (st === 'error' || cloudSt === 'error') failed++
          const localDone = st === 'done' || st === 'skipped'
          const cloudDone = !cloudId || cloudSt === 'done' || cloudSt === 'skipped' || cloudSt === 'cancelled'
          if (localDone && cloudDone) done++
          if (!(localFinal && cloudFinal)) active++
        } else {
          if (st === 'done' || st === 'skipped') done++
          else if (st === 'error') failed++
          else if (st !== 'cancelled') active++
        }
      }
      return { done, failed, active }
    })
  )
}

/**
 * 聚合切片式应用全局 Store
 */
export const useAppStore = create<AppState>()(
  persist(
    (...a) => ({
      ...createAuthSlice(...a),
      ...createSettingsSlice(...a),
      ...createCloudPanSlice(...a),
      ...createScheduleSlice(...a),
      ...createDownloadSlice(...a),
      ...createCourseSlice(...a)
    }),
    {
      name: 'sjtu-course-downloader',
      version: 3,
      migrate: (persistedState: unknown, version: number) => {
        const state = (persistedState ?? {}) as Record<string, unknown>
        if (version < 3 && state) {
          state.theme = 'system'
        }
        if (state && (state.activeTab === 'settings' || state.activeTab === 'transfer' || state.activeTab === 'cloudpan' || state.activeTab === 'library')) {
          state.activeTab = (state.lastCourseTab as string) || 'canvas'
        }
        if (state && Array.isArray(state.downloadHistory) && state.downloadHistory.length > 300) {
          state.downloadHistory = state.downloadHistory.slice(0, 300)
        }
        return state
      },
      merge: (persistedState: unknown, currentState: AppState) => {
        const persisted = (persistedState ?? {}) as Partial<AppState>
        const activeTab =
          persisted.activeTab === 'settings' || persisted.activeTab === 'transfer' || persisted.activeTab === 'cloudpan' || persisted.activeTab === 'library'
            ? persisted.lastCourseTab || currentState.lastCourseTab || 'canvas'
            : (persisted.activeTab ?? currentState.activeTab)
        const canvasExportSrt = typeof persisted.canvasExportSrt === 'boolean'
          ? persisted.canvasExportSrt
          : (typeof persisted.canvasExportAiTranscript === 'boolean' ? persisted.canvasExportAiTranscript : currentState.canvasExportSrt)
        const canvasExportMarkdown = typeof persisted.canvasExportMarkdown === 'boolean'
          ? persisted.canvasExportMarkdown
          : (typeof persisted.canvasExportAiTranscript === 'boolean' ? persisted.canvasExportAiTranscript : currentState.canvasExportMarkdown)
        const canvasAssignmentOptions: CanvasAssignmentExportOptions = {
          ...currentState.canvasAssignmentOptions,
          ...(persisted.canvasAssignmentOptions ?? {})
        }
        return {
          ...currentState,
          ...persisted,
          cloudDestRoot: persisted.cloudDestRoot ?? currentState.cloudDestRoot,
          canvasExportSrt,
          canvasExportMarkdown,
          canvasExportAiTranscript: canvasExportSrt || canvasExportMarkdown,
          canvasAssignmentOptions,
          activeTab
        }
      },
      onRehydrateStorage: () => state => {
        if (state && (state.activeTab === 'settings' || state.activeTab === 'transfer' || state.activeTab === 'cloudpan' || state.activeTab === 'library')) {
          state.activeTab = state.lastCourseTab || 'canvas'
        }
        if (state && typeof state.concurrency === 'number') {
          window?.api?.download?.setConcurrency?.(state.concurrency).catch(() => undefined)
        }
        if (state && typeof state.maxDownloadSpeedKBps === 'number') {
          window?.api?.download?.setSpeedLimit?.(state.maxDownloadSpeedKBps).catch(() => undefined)
        }
      },
      storage: createJSONStorage(() => {
        if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
          try {
            if (typeof localStorage !== 'undefined') return createDeduplicatedStorage(localStorage)
          } catch { /* ignore */ }
        }
        return createDeduplicatedStorage({
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {}
        })
      }),
      partialize: state => ({
        theme: state.theme,
        activeTab: (state.activeTab === 'settings' || state.activeTab === 'transfer' || state.activeTab === 'cloudpan' || state.activeTab === 'library')
          ? (state.lastCourseTab || 'canvas')
          : state.activeTab,
        concurrency: state.concurrency,
        downloadMode: state.downloadMode,
        fileConflictStrategy: state.fileConflictStrategy,
        localDestRoot: state.localDestRoot,
        cloudDestRoot: state.cloudDestRoot,
        cnmoocResourceFilter: state.cnmoocResourceFilter,
        autoDownloadUpdate: state.autoDownloadUpdate,
        maxDownloadSpeedKBps: state.maxDownloadSpeedKBps,
        namingTemplate: state.namingTemplate,
        videoQualityOption: state.videoQualityOption,
        videoPerspectivePreference: state.videoPerspectivePreference,
        autoExportPptPdf: state.autoExportPptPdf,
        downloadHistory: state.downloadHistory,
        courseViewMode: state.courseViewMode,
        canvasGroupByTerm: state.canvasGroupByTerm,
        canvasSelectedTerm: state.canvasSelectedTerm,
        canvasCourseCategorySelections: state.canvasCourseCategorySelections,
        scheduleSelectedSemesterKey: state.scheduleSelectedSemesterKey,
        scheduleViewMode: state.scheduleViewMode,
        scheduleLayerFilter: state.scheduleLayerFilter,
        scheduleExpandNoonSlot: state.scheduleExpandNoonSlot,
        lastCourseTab: state.lastCourseTab,
        windowCloseAction: state.windowCloseAction,
        exitWhenDownloading: state.exitWhenDownloading,
        hasCompletedInitialSetup: state.hasCompletedInitialSetup,
        lastSetupVersion: state.lastSetupVersion,
        pptSaveImages: state.pptSaveImages,
        canvasExportAiTranscript: state.canvasExportAiTranscript,
        canvasExportSrt: state.canvasExportSrt,
        canvasExportMarkdown: state.canvasExportMarkdown,
        canvasAssignmentOptions: state.canvasAssignmentOptions,
        privateWorkerConfig: state.privateWorkerConfig
          ? { ...state.privateWorkerConfig, authToken: '' }
          : state.privateWorkerConfig
      })
    }
  )
)
