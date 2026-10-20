import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../src/main/window', () => ({
  getMainWindow: vi.fn(() => null)
}))

import {
  registerTaskMeta,
  emitProgress,
  getDownloadSnapshot,
  resetSnapshotRegistryForTest
} from '../../src/main/download-engine/progress'
import type { DownloadProgress } from '../../src/shared/types'
import { aggregateTaskState } from '../../src/renderer/src/download/progress'

describe('Main Process Download Snapshot & Metadata Registry (progress.ts)', () => {
  beforeEach(() => {
    resetSnapshotRegistryForTest()
  })

  it('registers task metadata and retrieves it via getDownloadSnapshot', () => {
    registerTaskMeta('task_1', { fileName: 'Lecture1.pdf', courseName: 'CS101' })
    const snapshot1 = getDownloadSnapshot()
    expect(snapshot1).toHaveLength(1)
    expect(snapshot1[0]).toMatchObject({
      taskId: 'task_1',
      fileName: 'Lecture1.pdf',
      courseName: 'CS101',
      state: 'pending',
      received: 0,
      total: 0
    })

    // Progress update merges without wiping meta
    emitProgress({
      taskId: 'task_1',
      state: 'downloading',
      received: 500,
      total: 1000
    })

    const snapshot2 = getDownloadSnapshot()
    expect(snapshot2[0]).toMatchObject({
      taskId: 'task_1',
      fileName: 'Lecture1.pdf',
      courseName: 'CS101',
      state: 'downloading',
      received: 500,
      total: 1000
    })
  })

  it('updates metadata if provided subsequently and preserves on completion', () => {
    emitProgress({
      taskId: 'task_2',
      state: 'pending',
      received: 0,
      total: 0
    })
    registerTaskMeta('task_2', { fileName: 'Video.mp4', courseName: 'Physics' })

    const item = getDownloadSnapshot().find(s => s.taskId === 'task_2')
    expect(item?.fileName).toBe('Video.mp4')
    expect(item?.courseName).toBe('Physics')

    emitProgress({
      taskId: 'task_2',
      state: 'done',
      received: 2000,
      total: 2000,
      filePath: '/downloads/Physics/Video.mp4'
    })

    const completed = getDownloadSnapshot().find(s => s.taskId === 'task_2')
    expect(completed?.state).toBe('done')
    expect(completed?.fileName).toBe('Video.mp4')
  })
})

describe('Transfer Center Logical Card Aggregation & De-duplication', () => {
  it('deduplicates both mode mirror tasks into a single logical item', () => {
    const progressMap: Record<string, DownloadProgress> = {
      // Local side of File A
      file_a: {
        taskId: 'file_a',
        fileName: 'CourseSlides.pdf',
        courseName: 'Math101',
        state: 'done',
        received: 1000,
        total: 1000,
        filePath: 'C:/Downloads/CourseSlides.pdf'
      },
      // Cloud mirror of File A
      file_a_cloud: {
        taskId: 'file_a_cloud',
        fileName: 'CourseSlides.pdf',
        courseName: 'Math101',
        state: 'downloading',
        received: 400,
        total: 1000
      },
      // Independent single mode File B
      file_b: {
        taskId: 'file_b',
        fileName: 'Syllabus.docx',
        courseName: 'Math101',
        state: 'downloading',
        received: 100,
        total: 500
      }
    }

    const cloudLinkedIds = { file_a: 'file_a_cloud' }

    // Logic modeled from TransferCenter.tsx
    const entries = Object.entries(progressMap).filter(([id]) => !id.endsWith('_cloud'))
    const logical = entries.map(([id, local]) => {
      const cloudId = cloudLinkedIds[id] || `${id}_cloud`
      const cloud = progressMap[cloudId]
      const aggregate = aggregateTaskState(local, cloud)
      const fileName = local.fileName || cloud?.fileName || id
      return {
        taskId: id,
        fileName,
        aggregate,
        isBoth: !!cloud
      }
    })

    // Assert: Only 2 logical cards, NOT 3 (the _cloud mirror is not an independent card)
    expect(logical).toHaveLength(2)

    const cardA = logical.find(c => c.taskId === 'file_a')
    expect(cardA).toBeDefined()
    expect(cardA?.fileName).toBe('CourseSlides.pdf')
    expect(cardA?.isBoth).toBe(true)
    // Local done, cloud downloading -> phase is uploading
    expect(cardA?.aggregate.phase).toBe('uploading')
    expect(cardA?.aggregate.state).toBe('downloading')

    const cardB = logical.find(c => c.taskId === 'file_b')
    expect(cardB).toBeDefined()
    expect(cardB?.isBoth).toBe(false)
    expect(cardB?.aggregate.phase).toBe('downloading')
  })

  it('accurately isolates failed tasks from active tasks', () => {
    const progressMap: Record<string, DownloadProgress> = {
      good_task: {
        taskId: 'good_task',
        fileName: 'Good.pdf',
        state: 'downloading',
        received: 10,
        total: 100
      },
      bad_task: {
        taskId: 'bad_task',
        fileName: 'Corrupt.zip',
        state: 'error',
        received: 0,
        total: 100,
        message: 'Checksum mismatch'
      }
    }

    const entries = Object.entries(progressMap).filter(([id]) => !id.endsWith('_cloud'))
    const logical = entries.map(([id, local]) => ({
      taskId: id,
      fileName: local.fileName || id,
      aggregate: aggregateTaskState(local, undefined)
    }))

    const active = logical.filter(t => (
      t.aggregate.state === 'downloading' ||
      t.aggregate.state === 'pending' ||
      t.aggregate.state === 'paused'
    ))
    const failed = logical.filter(t => t.aggregate.state === 'error')

    expect(active).toHaveLength(1)
    expect(active[0].taskId).toBe('good_task')

    expect(failed).toHaveLength(1)
    expect(failed[0].taskId).toBe('bad_task')
    expect(failed[0].aggregate.message).toBe('Checksum mismatch')
  })
})
