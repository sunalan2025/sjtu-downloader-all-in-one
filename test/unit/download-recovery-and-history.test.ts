import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../src/main/window', () => ({
  getMainWindow: vi.fn(() => null),
  getIsQuitting: vi.fn(() => false)
}))

import {
  tasks,
  pendingLocal,
  pausedLocal,
  cloudTasks,
  pendingCloud,
  pausedCloud,
  type TaskRuntime,
  type CloudTaskRuntime
} from '../../src/main/download-engine/shared'
import {
  resumeTask,
  cancelTask
} from '../../src/main/download-engine/local'
import {
  cloudResumeTask,
  cloudCancelTask
} from '../../src/main/download-engine/cloud'
import {
  taskSnapshotRegistry,
  clearFinishedSnapshots,
  getDownloadSnapshot,
  resetSnapshotRegistryForTest,
  emitProgress
} from '../../src/main/download-engine/progress'
import { submitDownloadBatch } from '../../src/renderer/src/download/submit'
import { useAppStore } from '../../src/renderer/src/store/app'
import type { DownloadProgress, DownloadTaskSpec } from '../../src/shared/types'

describe('Architectural Fix Verification — Failed Task Recovery and History Management', () => {
  beforeEach(() => {
    // Reset Main engine queues
    tasks.clear()
    pendingLocal.length = 0
    pausedLocal.length = 0

    cloudTasks.clear()
    pendingCloud.length = 0
    pausedCloud.length = 0

    resetSnapshotRegistryForTest()

    // Reset Zustand store
    useAppStore.setState({
      progress: {},
      batchTaskIds: [],
      cloudLinkedIds: {},
      downloadHistory: [],
      downloadMode: 'local',
      localDestRoot: 'D:/Downloads'
    })

    // Mock global window
    ;(globalThis as any).window = {
      api: {
        download: {
          start: vi.fn().mockResolvedValue({ ok: true }),
          clearFinishedSnapshots: vi.fn().mockImplementation(() => {
            clearFinishedSnapshots()
            return Promise.resolve({ ok: true })
          })
        }
      }
    }
  })

  describe('1. Failed Local Task Recovery & Cancellation (local.ts)', () => {
    it('preserves failed local task runtime in tasks Map so resumeTask can re-enqueue it', () => {
      const taskId = 'test_failed_local_1'
      const mockRuntime: TaskRuntime = {
        spec: {
          taskId,
          url: 'https://test.sjtu.edu.cn/lecture.mp4',
          fileName: 'lecture.mp4',
          courseName: 'Physics'
        },
        filePath: 'D:/Downloads/lecture.mp4',
        partPath: 'D:/Downloads/lecture.mp4.part',
        state: 'error',
        received: 100,
        total: 1000,
        retryTimers: new Set()
      }
      tasks.set(taskId, mockRuntime)

      expect(tasks.has(taskId)).toBe(true)
      expect(pendingLocal.length).toBe(0)

      // When user clicks retry in Transfer Center, resumeTask is invoked
      resumeTask(taskId)

      // The task must be picked up by scheduler and transitioned away from 'error' state
      const updatedRuntime = tasks.get(taskId)
      expect(updatedRuntime).toBeDefined()
      expect(updatedRuntime?.state).not.toBe('error')
    })

    it('allows cancelTask to cleanly cancel and remove a failed local task', () => {
      const taskId = 'test_failed_local_2'
      const mockRuntime: TaskRuntime = {
        spec: {
          taskId,
          url: 'https://test.sjtu.edu.cn/doc.pdf',
          fileName: 'doc.pdf',
          courseName: 'Math'
        },
        filePath: 'D:/Downloads/doc.pdf',
        partPath: 'D:/Downloads/doc.pdf.part',
        state: 'error',
        received: 0,
        total: 500,
        retryTimers: new Set()
      }
      tasks.set(taskId, mockRuntime)

      // User clicks remove in Transfer Center
      cancelTask(taskId)

      expect(tasks.has(taskId)).toBe(false)
      const snapshot = getDownloadSnapshot().find(s => s.taskId === taskId)
      expect(snapshot?.state).toBe('cancelled')
    })
  })

  describe('2. Failed Cloud Task Recovery & Cancellation (cloud.ts)', () => {
    it('preserves failed cloud task runtime so cloudResumeTask can re-enqueue it', () => {
      const taskId = 'test_failed_cloud_1'
      const mockCloudRuntime: CloudTaskRuntime = {
        spec: {
          taskId,
          url: 'https://cdn.sjtu.edu.cn/video.mp4',
          fileName: 'video.mp4',
          courseName: 'AI',
          cloudUserToken: 'token_123'
        },
        state: 'error',
        received: 200,
        total: 1000,
        retryTimers: new Set()
      }
      cloudTasks.set(taskId, mockCloudRuntime)

      expect(cloudTasks.has(taskId)).toBe(true)
      expect(pendingCloud.length).toBe(0)

      // User clicks retry in Transfer Center
      cloudResumeTask(taskId)

      // Must be picked up by cloud scheduler and transitioned away from 'error' state
      const updatedCloudRuntime = cloudTasks.get(taskId)
      expect(updatedCloudRuntime).toBeDefined()
      expect(updatedCloudRuntime?.state).not.toBe('error')
    })

    it('allows cloudCancelTask to cleanly cancel and remove a failed cloud task', () => {
      const taskId = 'test_failed_cloud_2'
      const mockCloudRuntime: CloudTaskRuntime = {
        spec: {
          taskId,
          url: 'https://cdn.sjtu.edu.cn/slide.pdf',
          fileName: 'slide.pdf',
          courseName: 'AI',
          cloudUserToken: 'token_123'
        },
        state: 'error',
        received: 0,
        total: 300,
        retryTimers: new Set()
      }
      cloudTasks.set(taskId, mockCloudRuntime)

      // User clicks remove
      cloudCancelTask(taskId)

      expect(cloudTasks.has(taskId)).toBe(false)
      const snapshot = getDownloadSnapshot().find(s => s.taskId === taskId)
      expect(snapshot?.state).toBe('cancelled')
    })
  })

  describe('3. History Clearing & Anti-Resurrection Guard (progress.ts & app.ts)', () => {
    it('clearFinishedSnapshots purges terminal states while preserving active and error states', () => {
      emitProgress({ taskId: 't_done', state: 'done', received: 100, total: 100 })
      emitProgress({ taskId: 't_skipped', state: 'skipped', received: 0, total: 0 })
      emitProgress({ taskId: 't_cancelled', state: 'cancelled', received: 0, total: 0 })
      emitProgress({ taskId: 't_downloading', state: 'downloading', received: 50, total: 100 })
      emitProgress({ taskId: 't_error', state: 'error', received: 10, total: 100 })

      expect(getDownloadSnapshot()).toHaveLength(5)

      clearFinishedSnapshots()

      const remaining = getDownloadSnapshot()
      expect(remaining).toHaveLength(2)
      expect(remaining.map(r => r.taskId).sort()).toEqual(['t_downloading', 't_error'])
    })

    it('store.clearDownloadHistory clears history, purges terminal progress, and calls IPC', () => {
      useAppStore.setState({
        downloadHistory: [
          { taskId: 'h1', fileName: 'f1.pdf', filePath: '/f1.pdf', completedAt: 1000 },
          { taskId: 'h2', fileName: 'f2.pdf', filePath: '/f2.pdf', completedAt: 2000 }
        ],
        progress: {
          h1: { taskId: 'h1', state: 'done', received: 100, total: 100, filePath: '/f1.pdf' },
          h2: { taskId: 'h2', state: 'done', received: 200, total: 200, filePath: '/f2.pdf' },
          active_task: { taskId: 'active_task', state: 'downloading', received: 50, total: 100 }
        }
      })

      useAppStore.getState().clearDownloadHistory()

      const store = useAppStore.getState()
      expect(store.downloadHistory).toEqual([])
      // Finished tasks should be deleted from progress table so they do not recreate history
      expect(store.progress['h1']).toBeUndefined()
      expect(store.progress['h2']).toBeUndefined()
      // Active task progress must be preserved
      expect(store.progress['active_task']).toBeDefined()
      expect(store.progress['active_task'].state).toBe('downloading')

      expect(window.api.download.clearFinishedSnapshots).toHaveBeenCalled()
    })
  })

  describe('4. Batch Submission Mirror Protection (submit.ts)', () => {
    it('does NOT wipe existing cloudLinkedIds when submitting in non-both mode', async () => {
      // Suppose an existing both-mode task is currently uploading
      useAppStore.setState({
        downloadMode: 'local',
        cloudLinkedIds: {
          existing_task: 'existing_task_cloud'
        }
      })

      const specs: DownloadTaskSpec[] = [
        { taskId: 'new_local_task', courseId: '101', courseName: 'CS', fileName: 'CS.pdf', url: 'https://test/cs.pdf' }
      ]

      const res = await submitDownloadBatch(specs, { isBothMode: false })
      expect(res.ok).toBe(true)

      // existing_task's cloud link must NOT be wiped!
      expect(useAppStore.getState().cloudLinkedIds).toEqual({
        existing_task: 'existing_task_cloud'
      })
    })

    it('only rolls back newly added mirror keys when both-mode submission fails', async () => {
      useAppStore.setState({
        downloadMode: 'both',
        cloudLinkedIds: {
          prev_both_task: 'prev_both_task_cloud'
        }
      })

      ;(window.api.download.start as any).mockResolvedValueOnce({ ok: false, error: 'Cloud quota full' })

      const specs: DownloadTaskSpec[] = [
        { taskId: 'failed_batch_task', courseId: '102', courseName: 'Math', fileName: 'Math.pdf', url: 'https://test/m.pdf' }
      ]

      const res = await submitDownloadBatch(specs, {
        isBothMode: true,
        existingCloudLinkedIds: { prev_both_task: 'prev_both_task_cloud' }
      })
      expect(res.ok).toBe(false)

      // Rollback must restore prev_both_task without leaving failed_batch_task
      expect(useAppStore.getState().cloudLinkedIds).toEqual({
        prev_both_task: 'prev_both_task_cloud'
      })
      expect(useAppStore.getState().cloudLinkedIds['failed_batch_task']).toBeUndefined()
    })
  })
})
