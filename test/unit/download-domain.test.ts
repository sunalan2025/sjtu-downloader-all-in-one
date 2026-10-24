import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  canvasFileTaskId,
  canvasAssignmentTaskId,
  canvasLectureTaskId,
  canvasPptItemTaskId,
  canvasPptPdfBatchTaskId,
  canvasAssignBatchTaskId,
  canvasTranscriptBatchTaskId,
  canvasMvidTaskId,
  canvasExtToolTaskId,
  canvasExtUrlTaskId,
  auditedTaskId,
  cnmoocTaskId,
  parseTaskId,
  collectCourseIds
} from '../../src/renderer/src/download/taskIds'
import {
  aggregateTaskState,
  computeBatchStats,
  isFinalState
} from '../../src/renderer/src/download/progress'
import { submitDownloadBatch } from '../../src/renderer/src/download/submit'
import { useAppStore } from '../../src/renderer/src/store/app'
import type { DownloadProgress, DownloadTaskSpec } from '../../src/shared/types'

describe('Download Domain Layer — Task IDs (taskIds.ts)', () => {
  it('generates correct task IDs across all categories', () => {
    expect(canvasFileTaskId(12345, 67890)).toBe('canvas_file_12345_67890')
    expect(canvasAssignmentTaskId(12345, 999)).toBe('canvas_assignment_12345_999')
    expect(canvasLectureTaskId(12345, 3, 'teacher')).toBe('canvas_lecture_12345_3_teacher')
    expect(canvasLectureTaskId(12345, 3, 'ppt')).toBe('canvas_lecture_12345_3_ppt')
    expect(canvasPptItemTaskId(12345, 2)).toBe('canvas_ppt_item_12345_2')
    expect(canvasPptPdfBatchTaskId(12345)).toBe('canvas_ppt_pdf_12345')
    expect(canvasAssignBatchTaskId(12345)).toBe('canvas_assign_batch_12345')
    expect(canvasTranscriptBatchTaskId(12345)).toBe('canvas_transcript_12345')
    expect(canvasMvidTaskId(12345, 'Module 1: Intro', s => s.replace(/[^a-zA-Z0-9]/g, '_'))).toBe('canvas_mvid_12345_Module_1__Intro')
    expect(canvasExtToolTaskId(12345, 'tool-video-abc')).toBe('canvas_exttool_12345_tool-video-abc')
    expect(canvasExtUrlTaskId(12345, 'uuid-vshare-123')).toBe('canvas_exturl_12345_uuid-vshare-123')
    expect(auditedTaskId(8888, 7777, 0)).toBe('8888_7777_0')
    expect(auditedTaskId(8888, 7777, 3)).toBe('8888_7777_3')
    expect(cnmoocTaskId('course_999', 'item_111')).toBe('cnmooc_course_999_item_111')
  })

  it('correctly parses Canvas files and lectures', () => {
    const parsedFile = parseTaskId('canvas_file_12345_67890')
    expect(parsedFile).toEqual({
      source: 'canvas-file',
      courseId: 12345,
      rest: ['67890']
    })

    const parsedLecture = parseTaskId('canvas_lecture_12345_3_teacher')
    expect(parsedLecture).toEqual({
      source: 'canvas-lecture',
      courseId: 12345,
      rest: ['3', 'teacher']
    })
  })

  it('correctly parses Canvas batch aggregate tasks without trailing segment', () => {
    expect(parseTaskId('canvas_ppt_pdf_12345')).toEqual({
      source: 'canvas-ppt-pdf',
      courseId: 12345,
      rest: []
    })
    expect(parseTaskId('canvas_assign_batch_12345')).toEqual({
      source: 'canvas-assign-batch',
      courseId: 12345,
      rest: []
    })
    expect(parseTaskId('canvas_transcript_12345')).toEqual({
      source: 'canvas-transcript',
      courseId: 12345,
      rest: []
    })
  })

  it('correctly parses audited course tasks and cnmooc tasks', () => {
    expect(parseTaskId('8888_7777_0')).toEqual({
      source: 'audited',
      courseId: 8888,
      rest: ['7777', '0']
    })
    expect(parseTaskId('8888_7777_3')).toEqual({
      source: 'audited',
      courseId: 8888,
      rest: ['7777', '3']
    })
    expect(parseTaskId('cnmooc_999_item_abc')).toEqual({
      source: 'cnmooc',
      courseId: 999,
      rest: ['item_abc']
    })
  })

  it('handles invalid or unrecognized task IDs safely', () => {
    expect(parseTaskId('')).toBeNull()
    expect(parseTaskId('invalid_prefix_123')).toBeNull()
    expect(parseTaskId('canvas_file_notanumber_123')).toBeNull()
    expect(parseTaskId('8888_7777_5')).toBeNull() // angle must be 0 or 3
    expect(parseTaskId('cnmooc_nan_item')).toBeNull()
  })

  it('collectCourseIds extracts unique course IDs correctly', () => {
    const ids = [
      'canvas_file_101_1',
      'canvas_file_101_2',
      'canvas_lecture_102_1_teacher',
      '8888_1_0',
      'invalid_id'
    ]
    const courseIds = collectCourseIds(ids)
    expect(courseIds).toEqual(new Set([101, 102, 8888]))
  })
})

describe('Download Domain Layer — Progress Aggregation (progress.ts)', () => {
  it('identifies final states correctly', () => {
    expect(isFinalState('done')).toBe(true)
    expect(isFinalState('skipped')).toBe(true)
    expect(isFinalState('error')).toBe(true)
    expect(isFinalState('cancelled')).toBe(true)
    expect(isFinalState('downloading')).toBe(false)
    expect(isFinalState('pending')).toBe(false)
    expect(isFinalState('paused')).toBe(false)
    expect(isFinalState(undefined)).toBe(false)
  })

  it('handles single mode (no cloud mirror)', () => {
    const progress: DownloadProgress = {
      taskId: 'task1',
      state: 'downloading',
      received: 50,
      total: 100,
      message: 'Downloading...'
    }
    const aggregate = aggregateTaskState(progress, undefined)
    expect(aggregate).toEqual({
      state: 'downloading',
      received: 50,
      total: 100,
      phase: 'downloading',
      message: 'Downloading...',
      localState: 'downloading'
    })
  })

  describe('Both mode (local + cloud)', () => {
    it('prioritizes error state from either side', () => {
      const localError: DownloadProgress = {
        taskId: 't1',
        state: 'error',
        received: 0,
        total: 100,
        message: 'Disk write failed'
      }
      const cloudDownloading: DownloadProgress = {
        taskId: 't1_cloud',
        state: 'downloading',
        received: 10,
        total: 100
      }
      const agg1 = aggregateTaskState(localError, cloudDownloading)
      expect(agg1.state).toBe('error')
      expect(agg1.message).toBe('Disk write failed')

      const localDone: DownloadProgress = { taskId: 't2', state: 'done', received: 100, total: 100 }
      const cloudError: DownloadProgress = { taskId: 't2_cloud', state: 'error', received: 0, total: 100, message: 'Cloud quota exceeded' }
      const agg2 = aggregateTaskState(localDone, cloudError)
      expect(agg2.state).toBe('error')
      expect(agg2.message).toBe('Cloud quota exceeded')
    })

    it('marks done when local is done and cloud is done / skipped / cancelled', () => {
      const localDone: DownloadProgress = { taskId: 't1', state: 'done', received: 100, total: 100 }
      const cloudDone: DownloadProgress = { taskId: 't1_cloud', state: 'done', received: 100, total: 100 }
      expect(aggregateTaskState(localDone, cloudDone).state).toBe('done')

      const cloudCancelled: DownloadProgress = { taskId: 't1_cloud', state: 'cancelled', received: 0, total: 100 }
      expect(aggregateTaskState(localDone, cloudCancelled).state).toBe('done')
    })

    it('transitions to phase uploading when local is done and cloud is uploading', () => {
      const localDone: DownloadProgress = { taskId: 't1', state: 'done', received: 100, total: 100 }
      const cloudUploading: DownloadProgress = {
        taskId: 't1_cloud',
        state: 'downloading',
        received: 30,
        total: 100,
        message: 'Uploading to cloud...'
      }
      const agg = aggregateTaskState(localDone, cloudUploading)
      expect(agg.state).toBe('downloading')
      expect(agg.phase).toBe('uploading')
      expect(agg.received).toBe(30)
      expect(agg.total).toBe(100)
      expect(agg.message).toBe('Uploading to cloud...')
    })

    it('reports paused when local is done and cloud is paused', () => {
      const localDone: DownloadProgress = { taskId: 't1', state: 'done', received: 100, total: 100 }
      const cloudPaused: DownloadProgress = { taskId: 't1_cloud', state: 'paused', received: 30, total: 100 }
      const agg = aggregateTaskState(localDone, cloudPaused)
      expect(agg.phase).toBe('uploading')
      expect(agg.message).toBe('本地完成 · 云端已暂停')
    })
  })

  describe('Batch Statistics (computeBatchStats)', () => {
    it('computes empty taskIds cleanly', () => {
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

    it('computes mixed status in both mode accurately', () => {
      const taskIds = ['t1', 't2', 't3', 't4']
      const cloudLinkedIds = {
        t1: 't1_cloud',
        t2: 't2_cloud',
        t3: 't3_cloud',
        t4: 't4_cloud'
      }
      const progress: Record<string, DownloadProgress> = {
        // t1: both done
        t1: { taskId: 't1', state: 'done', received: 100, total: 100 },
        t1_cloud: { taskId: 't1_cloud', state: 'done', received: 100, total: 100 },
        // t2: local done, cloud uploading (50%)
        t2: { taskId: 't2', state: 'done', received: 100, total: 100 },
        t2_cloud: { taskId: 't2_cloud', state: 'downloading', received: 50, total: 100 },
        // t3: local downloading (40%)
        t3: { taskId: 't3', state: 'downloading', received: 40, total: 100 },
        t3_cloud: { taskId: 't3_cloud', state: 'pending', received: 0, total: 100 },
        // t4: cloud error
        t4: { taskId: 't4', state: 'done', received: 100, total: 100 },
        t4_cloud: { taskId: 't4_cloud', state: 'error', received: 0, total: 100, message: 'Upload fail' }
      }

      const stats = computeBatchStats(taskIds, progress, cloudLinkedIds, true)
      expect(stats.total).toBe(4)
      expect(stats.done).toBe(1) // t1
      expect(stats.failed).toBe(1) // t4
      expect(stats.active).toBe(2) // t2 + t3
      expect(stats.uploading).toBe(1) // t2
      expect(stats.downloading).toBe(1) // t3
      // inflight: t2 gives 1 (uploading), t3 gives 40/100 = 0.4 -> total 1.4
      expect(stats.inflight).toBeCloseTo(1.4)
    })
  })
})

describe('Download Domain Layer — Batch Submission (submit.ts)', () => {
  beforeEach(() => {
    // Reset store state
    useAppStore.setState({
      progress: {},
      batchTaskIds: [],
      cloudLinkedIds: {},
      downloadMode: 'local',
      localDestRoot: 'C:/Downloads'
    })
    // Mock window.api
    ;(globalThis as any).window = {
      api: {
        download: {
          start: vi.fn().mockResolvedValue({ ok: true })
        }
      }
    }
  })

  it('returns ok without side effects when specs is empty', async () => {
    const res = await submitDownloadBatch([], { isBothMode: false })
    expect(res.ok).toBe(true)
    expect(res.submittedTaskIds).toEqual([])
  })

  it('populates pending progress, adds batchTaskIds, and starts download', async () => {
    const specs: DownloadTaskSpec[] = [
      { taskId: 'spec_1', courseId: '101', courseName: 'CS101', name: 'File1.pdf', url: 'https://test/1.pdf' }
    ]

    const res = await submitDownloadBatch(specs, { isBothMode: false })
    expect(res.ok).toBe(true)
    expect(window.api.download.start).toHaveBeenCalled()

    const store = useAppStore.getState()
    expect(store.batchTaskIds).toContain('spec_1')
    expect(store.progress['spec_1']).toMatchObject({
      taskId: 'spec_1',
      state: 'pending'
    })
  })

  it('rolls back and sets error state if IPC fails', async () => {
    ;(window.api.download.start as any).mockResolvedValue({ ok: false, error: 'Target directory not writable' })

    const specs: DownloadTaskSpec[] = [
      { taskId: 'spec_err', courseId: '101', courseName: 'CS101', name: 'File2.pdf', url: 'https://test/2.pdf' }
    ]

    const res = await submitDownloadBatch(specs, { isBothMode: true })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Target directory not writable')

    const store = useAppStore.getState()
    expect(store.progress['spec_err']).toMatchObject({
      taskId: 'spec_err',
      state: 'error',
      message: 'Target directory not writable'
    })
    expect(store.cloudLinkedIds).toEqual({})
  })
})
