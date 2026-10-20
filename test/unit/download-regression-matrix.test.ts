import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../src/main/window', () => ({
  getMainWindow: vi.fn(() => null)
}))

import {
  aggregateTaskState,
  computeBatchStats,
  isFinalState,
  restoreDownloadSnapshot
} from '../../src/renderer/src/download/progress'
import { useAppStore } from '../../src/renderer/src/store/app'
import { destroyLocalHandles, type TaskRuntime } from '../../src/main/download-engine/shared'
import type { DownloadProgress, DownloadState } from '../../src/shared/types'

describe('Phase 4 — Full State Matrix for aggregateTaskState (progress.ts)', () => {
  it('correctly classifies isFinalState for all DownloadState values', () => {
    const finalStates: DownloadState[] = ['done', 'skipped', 'error', 'cancelled']
    const nonFinalStates: DownloadState[] = ['pending', 'downloading', 'paused']

    for (const state of finalStates) {
      expect(isFinalState(state)).toBe(true)
    }
    for (const state of nonFinalStates) {
      expect(isFinalState(state)).toBe(false)
    }
    expect(isFinalState(undefined)).toBe(false)
  })

  describe('Single Mode (no cloud mirror)', () => {
    it('returns pending with 0 bytes when local is undefined', () => {
      const agg = aggregateTaskState(undefined, undefined)
      expect(agg).toEqual({
        state: 'pending',
        received: 0,
        total: 0,
        phase: 'downloading',
        message: undefined,
        localState: undefined
      })
    })

    const testStates: DownloadState[] = ['pending', 'downloading', 'paused', 'done', 'skipped', 'error', 'cancelled']
    for (const state of testStates) {
      it(`faithfully reflects local state '${state}'`, () => {
        const local: DownloadProgress = {
          taskId: 'task_single',
          state,
          received: state === 'done' ? 1024 : 512,
          total: 1024,
          message: `Local message for ${state}`
        }
        const agg = aggregateTaskState(local, undefined)
        expect(agg.state).toBe(state)
        expect(agg.received).toBe(state === 'error' ? 0 : local.received)
        expect(agg.total).toBe(state === 'error' ? 0 : 1024)
        expect(agg.phase).toBe('downloading')
        expect(agg.message).toBe(`Local message for ${state}`)
        expect(agg.localState).toBe(state)
        expect(agg.cloudState).toBeUndefined()
      })
    }
  })

  describe('Both Mode — Error Dominance Matrix', () => {
    it('local error takes precedence and outputs local error message', () => {
      const local: DownloadProgress = { taskId: 't1', state: 'error', message: 'Local disk full' }
      const cloudStates: DownloadState[] = ['pending', 'downloading', 'paused', 'done', 'skipped', 'cancelled', 'error']

      for (const cs of cloudStates) {
        const cloud: DownloadProgress = { taskId: 't1_cloud', state: cs, message: 'Cloud err' }
        const agg = aggregateTaskState(local, cloud)
        expect(agg.state).toBe('error')
        expect(agg.message).toBe('Local disk full')
        expect(agg.phase).toBe('downloading')
        expect(agg.received).toBe(0)
        expect(agg.total).toBe(0)
      }
    })

    it('cloud error takes precedence over non-error local states', () => {
      const nonErrorLocalStates: DownloadState[] = ['pending', 'downloading', 'paused', 'done', 'skipped', 'cancelled']
      const cloud: DownloadProgress = { taskId: 't2_cloud', state: 'error', message: 'COS Token expired' }

      for (const ls of nonErrorLocalStates) {
        const local: DownloadProgress = { taskId: 't2', state: ls, received: 500, total: 1000 }
        const agg = aggregateTaskState(local, cloud)
        expect(agg.state).toBe('error')
        expect(agg.message).toBe('COS Token expired')
        expect(agg.phase).toBe('downloading')
        expect(agg.received).toBe(0)
        expect(agg.total).toBe(0)
      }
    })
  })

  describe('Both Mode — Completion & Skipped Permutations', () => {
    const successLocal: DownloadState[] = ['done', 'skipped']
    const successCloud: DownloadState[] = ['done', 'skipped', 'cancelled']

    for (const ls of successLocal) {
      for (const cs of successCloud) {
        it(`marks overall as done when local is ${ls} and cloud is ${cs}`, () => {
          const local: DownloadProgress = { taskId: 't3', state: ls, received: 1000, total: 1000, message: `${ls} msg` }
          const cloud: DownloadProgress = { taskId: 't3_cloud', state: cs, received: cs === 'cancelled' ? 0 : 1000, total: 1000 }

          const agg = aggregateTaskState(local, cloud)
          expect(agg.state).toBe('done')
          expect(agg.phase).toBe('downloading')
          expect(agg.received).toBe(1000)
          expect(agg.total).toBe(1000)
          expect(agg.message).toBe(`${ls} msg`)
        })
      }
    }
  })

  describe('Both Mode — In-Flight Uploading Phase (Local Done, Cloud in Progress)', () => {
    it('sets state downloading and phase uploading when cloud is downloading', () => {
      const local: DownloadProgress = { taskId: 't4', state: 'done', received: 1000, total: 1000 }
      const cloud: DownloadProgress = {
        taskId: 't4_cloud',
        state: 'downloading',
        received: 350,
        total: 1000,
        message: 'Uploading part 2/5'
      }
      const agg = aggregateTaskState(local, cloud)
      expect(agg.state).toBe('downloading')
      expect(agg.phase).toBe('uploading')
      expect(agg.received).toBe(350)
      expect(agg.total).toBe(1000)
      expect(agg.message).toBe('Uploading part 2/5')
    })

    it('sets fallback message when cloud downloading lacks custom message', () => {
      const local: DownloadProgress = { taskId: 't4', state: 'skipped', received: 0, total: 1000 }
      const cloud: DownloadProgress = { taskId: 't4_cloud', state: 'downloading', received: 200, total: 1000 }
      const agg = aggregateTaskState(local, cloud)
      expect(agg.state).toBe('downloading')
      expect(agg.phase).toBe('uploading')
      expect(agg.message).toBe('本地完成 · 云端上传中')
    })

    it('sets uploading phase and paused message when local done but cloud is paused', () => {
      const local: DownloadProgress = { taskId: 't5', state: 'done', received: 1000, total: 1000 }
      const cloud: DownloadProgress = { taskId: 't5_cloud', state: 'paused', received: 400, total: 1000 }
      const agg = aggregateTaskState(local, cloud)
      expect(agg.state).toBe('downloading')
      expect(agg.phase).toBe('uploading')
      expect(agg.received).toBe(1000)
      expect(agg.total).toBe(1000)
      expect(agg.message).toBe('本地完成 · 云端已暂停')
    })
  })

  describe('Both Mode — Local Not Finished (Local Priority)', () => {
    it('reflects local downloading when cloud is pending or paused', () => {
      const local: DownloadProgress = { taskId: 't6', state: 'downloading', received: 300, total: 1000, message: 'Downloading local...' }
      const cloud: DownloadProgress = { taskId: 't6_cloud', state: 'pending', received: 0, total: 1000 }
      const agg = aggregateTaskState(local, cloud)
      expect(agg.state).toBe('downloading')
      expect(agg.phase).toBe('downloading')
      expect(agg.received).toBe(300)
      expect(agg.total).toBe(1000)
      expect(agg.message).toBe('Downloading local...')
    })

    it('reflects local paused when local is paused', () => {
      const local: DownloadProgress = { taskId: 't7', state: 'paused', received: 150, total: 1000 }
      const cloud: DownloadProgress = { taskId: 't7_cloud', state: 'pending', received: 0, total: 1000 }
      const agg = aggregateTaskState(local, cloud)
      expect(agg.state).toBe('paused')
      expect(agg.phase).toBe('downloading')
      expect(agg.received).toBe(150)
      expect(agg.total).toBe(1000)
    })

    it('reflects local cancelled when local is cancelled (unless cloud error)', () => {
      const local: DownloadProgress = { taskId: 't8', state: 'cancelled', received: 50, total: 1000 }
      const cloud: DownloadProgress = { taskId: 't8_cloud', state: 'downloading', received: 0, total: 1000 }
      const agg = aggregateTaskState(local, cloud)
      expect(agg.state).toBe('cancelled')
      expect(agg.phase).toBe('downloading')
    })
  })
})

describe('Phase 4 — Batch Stats Matrix (computeBatchStats)', () => {
  it('returns all zeroes for empty task list', () => {
    const stats = computeBatchStats([], {}, {}, false)
    expect(stats).toEqual({
      done: 0,
      failed: 0,
      active: 0,
      inflight: 0,
      downloading: 0,
      uploading: 0,
      total: 0
    })
  })

  it('accurately computes mixed batch stats in both mode', () => {
    const progressMap: Record<string, DownloadProgress> = {
      // 1. Both done (done + done)
      t1: { taskId: 't1', state: 'done', received: 100, total: 100 },
      t1_cloud: { taskId: 't1_cloud', state: 'done', received: 100, total: 100 },

      // 2. Both done (skipped + cancelled)
      t2: { taskId: 't2', state: 'skipped', received: 0, total: 0 },
      t2_cloud: { taskId: 't2_cloud', state: 'cancelled', received: 0, total: 0 },

      // 3. Failed (local done, cloud error)
      t3: { taskId: 't3', state: 'done', received: 100, total: 100 },
      t3_cloud: { taskId: 't3_cloud', state: 'error', message: 'Auth failed' },

      // 4. Failed (local error)
      t4: { taskId: 't4', state: 'error', message: 'Write failed' },

      // 5. In-flight downloading (local downloading 50%, cloud pending)
      t5: { taskId: 't5', state: 'downloading', received: 50, total: 100 },
      t5_cloud: { taskId: 't5_cloud', state: 'pending', received: 0, total: 100 },

      // 6. In-flight uploading (local done, cloud uploading 80%)
      t6: { taskId: 't6', state: 'done', received: 100, total: 100 },
      t6_cloud: { taskId: 't6_cloud', state: 'downloading', received: 80, total: 100 },

      // 7. Paused (local paused)
      t7: { taskId: 't7', state: 'paused', received: 25, total: 100 }
    }

    const cloudLinks: Record<string, string> = {
      t1: 't1_cloud',
      t2: 't2_cloud',
      t3: 't3_cloud',
      t5: 't5_cloud',
      t6: 't6_cloud'
    }

    const taskIds = ['t1', 't2', 't3', 't4', 't5', 't6', 't7']
    const stats = computeBatchStats(taskIds, progressMap, cloudLinks, true)

    expect(stats.total).toBe(7)
    expect(stats.done).toBe(2) // t1, t2
    expect(stats.failed).toBe(2) // t3, t4
    expect(stats.active).toBe(3) // t5, t6, t7
    expect(stats.downloading).toBe(2) // t5, t7 (both in local phase)
    expect(stats.uploading).toBe(1) // t6 (in cloud uploading phase)
    // inflight: t5 (50/100 = 0.5) + t6 (local ready = 1) = 1.5 (t7 is paused, inflight = 0)
    expect(stats.inflight).toBeCloseTo(1.5, 2)
  })
})

describe('Phase 4 — Snapshot Restoration & Reload Recovery (restoreDownloadSnapshot)', () => {
  beforeEach(() => {
    useAppStore.setState({
      progress: {},
      batchTaskIds: [],
      cloudLinkedIds: {},
      downloadHistory: []
    })
  })

  it('safely handles empty or invalid snapshots', () => {
    expect(restoreDownloadSnapshot([])).toEqual({ activeIds: [], cloudLinks: {} })
    expect(restoreDownloadSnapshot(null as any)).toEqual({ activeIds: [], cloudLinks: {} })
    expect(restoreDownloadSnapshot(undefined as any)).toEqual({ activeIds: [], cloudLinks: {} })
  })

  it('restores downloading, paused, done, and both-mode cloud links on page reload (Ctrl+R)', async () => {
    const mockSnapshot: DownloadProgress[] = [
      // Active downloading task
      {
        taskId: 'dl_task_1',
        fileName: 'Lecture_1.pdf',
        courseName: 'Data Structures',
        state: 'downloading',
        received: 400,
        total: 1000
      },
      // Active paused task
      {
        taskId: 'paused_task_2',
        fileName: 'Lecture_2.pdf',
        courseName: 'Data Structures',
        state: 'paused',
        received: 150,
        total: 1000
      },
      // Completed local task with file path
      {
        taskId: 'done_task_3',
        fileName: 'Syllabus.docx',
        courseName: 'Data Structures',
        state: 'done',
        received: 2048,
        total: 2048,
        filePath: 'D:/Courses/Data Structures/Syllabus.docx'
      },
      // Both-mode: local side completed
      {
        taskId: 'video_lecture_4',
        fileName: 'Video_01.mp4',
        courseName: 'Physics',
        state: 'done',
        received: 50000,
        total: 50000,
        filePath: 'D:/Courses/Physics/Video_01.mp4'
      },
      // Both-mode: cloud mirror uploading
      {
        taskId: 'video_lecture_4_cloud',
        fileName: 'Video_01.mp4',
        courseName: 'Physics',
        state: 'downloading',
        received: 25000,
        total: 50000
      }
    ]

    const result = restoreDownloadSnapshot(mockSnapshot)

    // 1. Assert return values
    expect(result.activeIds).toEqual(['dl_task_1', 'paused_task_2'])
    expect(result.cloudLinks).toEqual({
      video_lecture_4: 'video_lecture_4_cloud'
    })

    // 2. Wait for Zustand queueMicrotask to flush batch progress
    await Promise.resolve()
    await Promise.resolve()

    const store = useAppStore.getState()

    // 3. Assert active batchTaskIds contains active tasks and excludes completed ones
    expect(store.batchTaskIds).toContain('dl_task_1')
    expect(store.batchTaskIds).toContain('paused_task_2')
    expect(store.batchTaskIds).not.toContain('done_task_3')

    // 4. Assert cloudLinkedIds registered
    expect(store.cloudLinkedIds['video_lecture_4']).toBe('video_lecture_4_cloud')

    // 5. Assert store.progress contains all items with metadata preserved
    expect(store.progress['dl_task_1']).toMatchObject({
      taskId: 'dl_task_1',
      fileName: 'Lecture_1.pdf',
      state: 'downloading',
      received: 400
    })
    expect(store.progress['paused_task_2']).toMatchObject({
      taskId: 'paused_task_2',
      state: 'paused',
      received: 150
    })
    expect(store.progress['done_task_3']).toMatchObject({
      taskId: 'done_task_3',
      state: 'done',
      filePath: 'D:/Courses/Data Structures/Syllabus.docx'
    })

    // 6. Assert downloadHistory automatically recorded completed task
    const historyItem = store.downloadHistory.find(h => h.taskId === 'done_task_3')
    expect(historyItem).toBeDefined()
    expect(historyItem?.fileName).toBe('Syllabus.docx')
    expect(historyItem?.filePath).toBe('D:/Courses/Data Structures/Syllabus.docx')

    // 7. Verify aggregate state of restored both-mode video task is in 'uploading' phase
    const videoAgg = aggregateTaskState(
      store.progress['video_lecture_4'],
      store.progress['video_lecture_4_cloud']
    )
    expect(videoAgg.state).toBe('downloading')
    expect(videoAgg.phase).toBe('uploading')
    expect(videoAgg.received).toBe(25000)
    expect(videoAgg.total).toBe(50000)
  })

  it('handles IPC progress event streaming after snapshot initialization without losing state', async () => {
    // 1. Initial snapshot restoration
    restoreDownloadSnapshot([
      {
        taskId: 'live_task',
        fileName: 'Live.pdf',
        courseName: 'Math',
        state: 'downloading',
        received: 100,
        total: 1000
      }
    ])
    await Promise.resolve()
    await Promise.resolve()

    expect(useAppStore.getState().progress['live_task'].received).toBe(100)

    // 2. Simulate streaming onProgress updates arriving from IPC
    const applyProgress = useAppStore.getState().applyProgress
    applyProgress({
      taskId: 'live_task',
      state: 'downloading',
      received: 600,
      total: 1000
    })
    await Promise.resolve()
    await Promise.resolve()

    // 3. Metadata from snapshot (fileName, courseName) should be retained while progress increases
    const current = useAppStore.getState().progress['live_task']
    expect(current.received).toBe(600)
    expect(current.state).toBe('downloading')
  })
})

describe('Phase 4 — Main Process Retry Timer Hardening & Leak Prevention (local.ts & shared.ts)', () => {
  it('registers and cleans up retry timers on destroyLocalHandles without leaking', () => {
    vi.useFakeTimers()
    try {
      const mockRuntime: TaskRuntime = {
        spec: {
          taskId: 't_retry_test',
          url: 'https://test.sjtu.edu.cn/file.pdf',
          dir: 'D:/Downloads',
          filename: 'file.pdf'
        },
        state: 'downloading',
        received: 0,
        total: 1000,
        filePath: 'D:/Downloads/file.pdf',
        partPath: 'D:/Downloads/file.pdf.part',
        retryTimers: new Set()
      }

      // Simulate the timer logic added in local.ts line 215
      const timer = setTimeout(() => {
        mockRuntime.retryTimers.delete(timer)
      }, 5000)
      mockRuntime.retryTimers.add(timer)

      expect(mockRuntime.retryTimers.size).toBe(1)
      expect(mockRuntime.retryTimers.has(timer)).toBe(true)

      // When destroyLocalHandles is triggered (e.g. on pause / cancel / window close)
      destroyLocalHandles(mockRuntime, 'test abort')

      // Timer set should be completely cleared and destroyed
      expect(mockRuntime.retryTimers.size).toBe(0)

      // Advancing timers should not cause any callback execution or crash
      vi.advanceTimersByTime(10000)
      expect(mockRuntime.retryTimers.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
