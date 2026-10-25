import type { StateCreator } from 'zustand'
import type {
  DownloadMode,
  FileConflictStrategy,
  DownloadProgress,
  DownloadHistoryItem
} from '@shared/types'
import { APP_DEFAULTS } from '@shared/config/defaults'
import type { AppState } from '../app'

// applyProgress 的批处理缓冲（模块级，便于 resetProgress 同步清零）
let progressPending: Map<string, DownloadProgress> | null = null
let progressScheduled = false

export function resetProgressPendingBuffer(): void {
  progressPending = null
  progressScheduled = false
}

const clampConcurrency = (n: number): number =>
  Math.max(1, Math.min(16, Math.floor(Number.isFinite(n) ? n : APP_DEFAULTS.concurrency) || APP_DEFAULTS.concurrency))

export interface DownloadSlice {
  downloadMode: DownloadMode
  fileConflictStrategy: FileConflictStrategy
  localDestRoot: string
  cloudDestRoot: string
  cloudLinkedIds: Record<string, string>
  downloading: boolean
  progress: Record<string, DownloadProgress>
  batchTaskIds: string[]
  maxDownloadSpeedKBps: number
  concurrency: number
  downloadHistory: DownloadHistoryItem[]

  setDownloadMode: (m: DownloadMode) => void
  setFileConflictStrategy: (s: FileConflictStrategy) => void
  setLocalDestRoot: (p: string) => void
  setCloudDestRoot: (p: string) => void
  setCloudLinkedIds: (m: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void
  setDownloading: (b: boolean) => void
  resetProgress: () => void
  clearCompletedProgress: () => void
  addBatchTaskIds: (ids: string[]) => void
  resetBatchTaskIds: () => void
  markBatchPendingCancelled: () => void
  applyProgress: (p: DownloadProgress) => void
  setMaxDownloadSpeedKBps: (n: number) => void
  addDownloadHistory: (item: DownloadHistoryItem) => void
  removeDownloadHistoryItem: (taskId: string) => void
  removeProgressItem: (taskId: string) => void
  clearDownloadHistory: () => void
  setConcurrency: (n: number) => void
}

export const createDownloadSlice: StateCreator<AppState, [], [], DownloadSlice> = set => ({
  downloadMode: APP_DEFAULTS.downloadMode,
  fileConflictStrategy: APP_DEFAULTS.fileConflictStrategy,
  localDestRoot: APP_DEFAULTS.defaultLocalDestRoot,
  cloudDestRoot: APP_DEFAULTS.defaultCloudDestRoot,
  cloudLinkedIds: {},
  downloading: false,
  progress: {},
  batchTaskIds: [],
  maxDownloadSpeedKBps: APP_DEFAULTS.maxDownloadSpeedKBps,
  concurrency: APP_DEFAULTS.concurrency,
  downloadHistory: [],

  setDownloadMode: downloadMode => set({ downloadMode }),
  setFileConflictStrategy: fileConflictStrategy => set({ fileConflictStrategy }),
  setLocalDestRoot: localDestRoot => set({ localDestRoot }),
  setCloudDestRoot: cloudDestRoot => set({ cloudDestRoot }),
  setCloudLinkedIds: m =>
    set(state => ({ cloudLinkedIds: typeof m === 'function' ? m(state.cloudLinkedIds) : m })),
  setDownloading: downloading => set({ downloading }),

  resetProgress: () => {
    progressPending = null
    progressScheduled = false
    set({ progress: {}, batchTaskIds: [] })
  },

  clearCompletedProgress: () => {
    progressPending = null
    progressScheduled = false
    set(state => {
      const nextProg: Record<string, DownloadProgress> = {}
      for (const [id, p] of Object.entries(state.progress)) {
        if (p.state === 'downloading' || p.state === 'pending' || p.state === 'paused') {
          nextProg[id] = p
        }
      }
      const nextBatchTaskIds = state.batchTaskIds.filter(id => {
        const p = state.progress[id]
        return p && (p.state === 'downloading' || p.state === 'pending' || p.state === 'paused')
      })
      return { progress: nextProg, batchTaskIds: nextBatchTaskIds }
    })
  },

  addBatchTaskIds: ids =>
    set(state => {
      if (ids.length === 0) return {}
      const acc = new Set(state.batchTaskIds)
      let changed = false
      for (const id of ids) {
        if (!acc.has(id)) {
          acc.add(id)
          changed = true
        }
      }
      return changed ? { batchTaskIds: [...acc] } : {}
    }),

  resetBatchTaskIds: () => set({ batchTaskIds: [] }),

  markBatchPendingCancelled: () =>
    set(state => {
      let changed = false
      const next = { ...state.progress }
      for (const tid of state.batchTaskIds) {
        const cur = next[tid]
        const st = cur?.state
        if (st !== 'done' && st !== 'skipped' && st !== 'error' && st !== 'cancelled') {
          next[tid] = {
            taskId: tid,
            state: 'cancelled',
            received: cur?.received ?? 0,
            total: cur?.total ?? 0,
            message: '已取消'
          }
          changed = true
        }
      }
      return changed ? { progress: next } : {}
    }),

  applyProgress: (p: DownloadProgress) => {
    if (!progressPending) progressPending = new Map()
    progressPending.set(p.taskId, p)
    if (!progressScheduled) {
      progressScheduled = true
      queueMicrotask(() => {
        const batch = progressPending
        progressPending = null
        progressScheduled = false
        if (!batch || batch.size === 0) return
        set(state => {
          const next = { ...state.progress }
          let historyUpdated = false
          let nextHistory = state.downloadHistory
          for (const [tid, prog] of batch) {
            const prev = next[tid]
            next[tid] = {
              ...prev,
              ...prog,
              fileName: prog.fileName || prev?.fileName,
              courseName: prog.courseName || prev?.courseName,
              storageMode: prog.storageMode || prev?.storageMode
            }
            const isFinished = prog.state === 'done' || prog.state === 'skipped'
            if (isFinished && !tid.includes('_scan_')) {
              const baseId = tid.replace(/_cloud$/, '')
              const mergedFilePath = prog.filePath || prev?.filePath
              const mergedCloudPath = prog.cloudPath || prev?.cloudPath
              const mergedFileName = prog.fileName || prev?.fileName
              const mergedCourseName = prog.courseName || prev?.courseName
              const mergedStorageMode = prog.storageMode || prev?.storageMode

              const existingIndex = nextHistory.findIndex(h => {
                const hBaseId = h.taskId.replace(/_cloud$/, '')
                if (hBaseId === baseId) return true
                const localMatch = !!(mergedFilePath && h.filePath === mergedFilePath)
                const cloudMatch = !!(mergedCloudPath && h.cloudPath === mergedCloudPath)
                return localMatch || cloudMatch
              })
              if (existingIndex >= 0) {
                if (!historyUpdated) {
                  nextHistory = [...nextHistory]
                  historyUpdated = true
                }
                const existing = nextHistory[existingIndex]
                nextHistory[existingIndex] = {
                  ...existing,
                  filePath: mergedFilePath || existing.filePath,
                  cloudPath: mergedCloudPath || existing.cloudPath,
                  fileName: mergedFileName || existing.fileName,
                  courseName: mergedCourseName || existing.courseName,
                  storageMode: mergedStorageMode || existing.storageMode,
                  fileSize:
                    prog.total && prog.total > 0
                      ? prog.total
                      : prog.received && prog.received > 0
                        ? prog.received
                        : prev?.total && prev.total > 0
                          ? prev.total
                          : existing.fileSize
                }
              } else {
                if (!historyUpdated) {
                  nextHistory = [...nextHistory]
                  historyUpdated = true
                }
                const displayPath = mergedFilePath || mergedCloudPath || tid
                let fileName = mergedFileName || displayPath.split(/[/\\]/).pop() || tid
                if (!fileName || /^\d+$/.test(fileName) || fileName === tid) {
                  if (tid.includes('_ppt_')) {
                    fileName = mergedCourseName ? `${mergedCourseName} · 课堂讲义 (PPT/PDF)` : '课堂讲义 (PPT/PDF)'
                  } else if (tid.includes('_assign_')) {
                    fileName = mergedCourseName ? `${mergedCourseName} · 课程作业归档` : '课程作业归档'
                  } else if (tid.includes('_transcript_')) {
                    fileName = mergedCourseName ? `${mergedCourseName} · 课堂逐字稿与字幕` : '课堂逐字稿与字幕'
                  } else {
                    fileName = tid.split('_').pop() || tid
                  }
                }
                const fileSize =
                  prog.total && prog.total > 0
                    ? prog.total
                    : prog.received && prog.received > 0
                      ? prog.received
                      : prev?.total && prev.total > 0
                        ? prev.total
                        : undefined
                nextHistory.unshift({
                  taskId: baseId,
                  fileName,
                  filePath: mergedFilePath,
                  cloudPath: mergedCloudPath,
                  courseName: mergedCourseName,
                  storageMode: mergedStorageMode,
                  fileSize,
                  completedAt: Date.now()
                })
              }
            }
          }
          const cappedHistory = historyUpdated ? nextHistory.slice(0, 300) : nextHistory
          return historyUpdated ? { progress: next, downloadHistory: cappedHistory } : { progress: next }
        })
      })
    }
  },

  setMaxDownloadSpeedKBps: n => {
    const val = Math.max(0, n)
    set({ maxDownloadSpeedKBps: val })
    window?.api?.download?.setSpeedLimit?.(val).catch(() => undefined)
  },

  addDownloadHistory: item =>
    set(state => {
      const baseId = item.taskId.replace(/_cloud$/, '')
      const alreadyExists = state.downloadHistory.some(h => {
        const hBaseId = h.taskId.replace(/_cloud$/, '')
        if (hBaseId === baseId) return true
        const localMatch = !!(item.filePath && h.filePath === item.filePath)
        const cloudMatch = !!(item.cloudPath && h.cloudPath === item.cloudPath)
        return localMatch || cloudMatch
      })
      if (alreadyExists) return {}
      return { downloadHistory: [{ ...item, taskId: baseId }, ...state.downloadHistory].slice(0, 300) }
    }),

  removeDownloadHistoryItem: taskId =>
    set(state => {
      const baseId = taskId.replace(/_cloud$/, '')
      const nextProg = { ...state.progress }
      for (const id of [baseId, baseId + '_cloud']) {
        const p = nextProg[id]
        if (p && (p.state === 'done' || p.state === 'skipped' || p.state === 'cancelled')) {
          delete nextProg[id]
        }
      }
      if (typeof window !== 'undefined' && window.api?.download?.deleteSnapshot) {
        void window.api.download.deleteSnapshot(baseId).catch(() => {})
      }
      return {
        downloadHistory: state.downloadHistory.filter(h => h.taskId !== taskId),
        progress: nextProg
      }
    }),

  clearDownloadHistory: () => {
    set(state => {
      const nextProg = { ...state.progress }
      for (const [tid, p] of Object.entries(nextProg)) {
        if (p.state === 'done' || p.state === 'skipped' || p.state === 'cancelled') {
          delete nextProg[tid]
        }
      }
      return { downloadHistory: [], progress: nextProg }
    })
    if (typeof window !== 'undefined' && window.api?.download?.clearFinishedSnapshots) {
      void window.api.download.clearFinishedSnapshots().catch(() => {})
    }
  },

  removeProgressItem: taskId =>
    set(state => {
      const baseId = taskId.replace(/_cloud$/, '')
      const nextProg = { ...state.progress }
      for (const id of [baseId, baseId + '_cloud']) {
        const p = nextProg[id]
        if (p && (p.state === 'done' || p.state === 'skipped' || p.state === 'cancelled' || p.state === 'error')) {
          delete nextProg[id]
        }
      }
      return { progress: nextProg }
    }),

  setConcurrency: n => {
    const val = n === 0 ? 0 : clampConcurrency(n)
    set({ concurrency: val })
    window?.api?.download?.setConcurrency?.(val).catch(() => undefined)
  }
})
