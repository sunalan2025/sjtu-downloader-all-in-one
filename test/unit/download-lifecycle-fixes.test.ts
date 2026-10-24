import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../src/main/window', () => ({
  getMainWindow: vi.fn(() => null),
  getIsQuitting: vi.fn(() => false)
}))

import {
  aggregateTaskState,
  pruneSettledLinks,
  restoreDownloadSnapshot,
  isRestoredBatchActive,
  clearRestoredBatchActive
} from '../../src/renderer/src/download/progress'
import { submitDownloadBatch } from '../../src/renderer/src/download/submit'
import { useAppStore } from '../../src/renderer/src/store/app'
import {
  emitProgress,
  getDownloadSnapshot,
  deleteSnapshot,
  resetSnapshotRegistryForTest
} from '../../src/main/download-engine/progress'
import { resolveCategoryChipKey } from '../../src/renderer/src/components/NetdiskCourseExplorer'
import type { DownloadProgress, DownloadTaskSpec } from '../../src/shared/types'

function prog(taskId: string, state: DownloadProgress['state'], extra: Partial<DownloadProgress> = {}): DownloadProgress {
  return { taskId, state, received: 0, total: 0, ...extra }
}

describe('Fix 1 — cloudLinkedIds lifecycle (pruneSettledLinks + mode guards)', () => {
  beforeEach(() => {
    useAppStore.setState({
      progress: {},
      batchTaskIds: [],
      cloudLinkedIds: {},
      downloadHistory: []
    })
  })

  it('prunes mirror links whose both sides reached final states', () => {
    const progress: Record<string, DownloadProgress> = {
      done_both: prog('done_both', 'done'),
      done_both_cloud: prog('done_both_cloud', 'done'),
      err_local: prog('err_local', 'error'),
      err_local_cloud: prog('err_local_cloud', 'done'),
      active_both: prog('active_both', 'downloading'),
      active_both_cloud: prog('active_both_cloud', 'downloading'),
      uploading_side: prog('uploading_side', 'done'),
      uploading_side_cloud: prog('uploading_side_cloud', 'downloading')
    }
    const links = {
      done_both: 'done_both_cloud',
      err_local: 'err_local_cloud',
      active_both: 'active_both_cloud',
      uploading_side: 'uploading_side_cloud',
      ghost_link: 'ghost_link_cloud' // 云侧条目从未入队（提交回滚残留）
    }
    const pruned = pruneSettledLinks(links, progress)
    // 终态对、单侧 error 对、云侧缺失的幽灵映射 → 剪掉；在传/上传中 → 保留
    expect(pruned).toEqual({
      active_both: 'active_both_cloud',
      uploading_side: 'uploading_side_cloud'
    })
  })

  it('submitDownloadBatch prunes stale settled links when building both-mode mirrors', async () => {
    // 历史批次残留：done/done 对 + error/done 对
    useAppStore.setState({
      downloadMode: 'both',
      progress: {
        old_done: prog('old_done', 'done'),
        old_done_cloud: prog('old_done_cloud', 'done'),
        old_err: prog('old_err', 'error'),
        old_err_cloud: prog('old_err_cloud', 'done')
      },
      cloudLinkedIds: {
        old_done: 'old_done_cloud',
        old_err: 'old_err_cloud'
      }
    })
    ;(globalThis as any).window = {
      api: { download: { start: vi.fn().mockResolvedValue({ ok: true }) } }
    }

    const specs: DownloadTaskSpec[] = [
      { taskId: 'new_task', courseId: '101', courseName: 'CS', fileName: 'a.pdf', url: '' }
    ]
    await submitDownloadBatch(specs, { isBothMode: true })

    // 陈旧终态映射被剪掉，只保留新批次的镜像
    expect(useAppStore.getState().cloudLinkedIds).toEqual({
      new_task: 'new_task_cloud'
    })
  })

  it('stale error mirror does not poison a cloud-only re-download in TransferCenter aggregation', () => {
    // 场景：先跑 both 批次（X 出错），再切 cloud-only 重下同一 X。
    // 修复后 TransferCenter 仅在 downloadMode === 'both' 时查镜像映射。
    const local: DownloadProgress = prog('X', 'downloading', { received: 50, total: 100 })
    // 陈旧镜像（模拟单模式下仍残留的映射）
    const staleCloud: DownloadProgress = prog('X_cloud', 'error', { message: '旧会话过期' })

    // both 模式：error 优先，聚合为 error（正确语义，两侧都活着）
    expect(aggregateTaskState(local, staleCloud).state).toBe('error')
    // 单模式：不查镜像（修复后的行为），纯本地语义 → downloading
    expect(aggregateTaskState(local, undefined).state).toBe('downloading')
  })

  it('restoreDownloadSnapshot prunes settled links after reload instead of resurrecting them', async () => {
    useAppStore.setState({
      downloadMode: 'local',
      cloudLinkedIds: {
        settled_task: 'settled_task_cloud' // 重载前残留的终态映射
      }
    })
    // 快照恢复：本地 done + 云端 done（两侧终态）
    restoreDownloadSnapshot([
      prog('settled_task', 'done', { filePath: 'D:/x.pdf' }),
      prog('settled_task_cloud', 'done', { cloudPath: '/x.pdf' }),
      prog('still_running', 'downloading', { received: 10, total: 100 })
    ])
    await Promise.resolve()
    await Promise.resolve()

    const links = useAppStore.getState().cloudLinkedIds
    expect(links['settled_task']).toBeUndefined() // 终态映射被剪
    expect(useAppStore.getState().batchTaskIds).toContain('still_running')
  })

  it('restores downloading=true for an in-flight batch and exposes the restored-batch flag', async () => {
    clearRestoredBatchActive()
    useAppStore.setState({ downloading: false, progress: {}, batchTaskIds: [] })

    restoreDownloadSnapshot([
      prog('live_local', 'downloading', { received: 50, total: 100 }),
      prog('live_local_cloud', 'downloading', { received: 20, total: 100 })
    ])
    await Promise.resolve()
    await Promise.resolve()

    // 岛进度环门槛（s.downloading）被恢复
    expect(useAppStore.getState().downloading).toBe(true)
    // 全局收尾器标志置位（页面级 hook 在重载后不会收尾）
    expect(isRestoredBatchActive()).toBe(true)
  })

  it('does not flag a restored batch when snapshot has no active tasks', async () => {
    clearRestoredBatchActive()
    useAppStore.setState({ downloading: false, progress: {}, batchTaskIds: [] })

    restoreDownloadSnapshot([prog('finished', 'done', { filePath: 'D:/a.pdf' })])
    await Promise.resolve()
    await Promise.resolve()

    expect(useAppStore.getState().downloading).toBe(false)
    expect(isRestoredBatchActive()).toBe(false)
  })
})

describe('Fix 2 — single history removal syncs with main-process snapshot (deleteSnapshot)', () => {
  beforeEach(() => {
    resetSnapshotRegistryForTest()
    useAppStore.setState({
      progress: {},
      batchTaskIds: [],
      cloudLinkedIds: {},
      downloadHistory: [],
      downloadMode: 'local'
    })
    ;(globalThis as any).window = {
      api: {
        download: {
          start: vi.fn().mockResolvedValue({ ok: true }),
          deleteSnapshot: vi.fn().mockImplementation((taskId: string) => {
            deleteSnapshot(taskId)
            return Promise.resolve({ ok: true })
          }),
          clearFinishedSnapshots: vi.fn().mockResolvedValue({ ok: true })
        }
      }
    }
  })

  it('deleteSnapshot removes a terminal snapshot and its _cloud mirror, but not active tasks', () => {
    emitProgress(prog('h_done', 'done', { filePath: 'D:/a.pdf' }))
    emitProgress(prog('h_done_cloud', 'done', { cloudPath: '/a.pdf' }))
    emitProgress(prog('h_active', 'downloading'))

    deleteSnapshot('h_done')

    const remaining = getDownloadSnapshot().map(s => s.taskId)
    expect(remaining).not.toContain('h_done')
    expect(remaining).not.toContain('h_done_cloud')
    expect(remaining).toContain('h_active')
  })

  it('refuses to delete a non-terminal snapshot (in-flight task protection)', () => {
    emitProgress(prog('inflight', 'downloading', { received: 10, total: 100 }))
    deleteSnapshot('inflight')
    expect(getDownloadSnapshot().map(s => s.taskId)).toContain('inflight')
  })

  it('removeDownloadHistoryItem purges progress entry + calls main-process deleteSnapshot', async () => {
    useAppStore.setState({
      downloadHistory: [
        { taskId: 'h1', fileName: 'f1.pdf', filePath: 'D:/f1.pdf', completedAt: 1000 }
      ],
      progress: {
        h1: prog('h1', 'done', { filePath: 'D:/f1.pdf' })
      }
    })

    useAppStore.getState().removeDownloadHistoryItem('h1')

    const store = useAppStore.getState()
    expect(store.downloadHistory).toEqual([])
    // progress 终态条目同步删除 → 快照恢复后不会"复活"该历史
    expect(store.progress['h1']).toBeUndefined()
    expect(window.api.download.deleteSnapshot).toHaveBeenCalledWith('h1')
  })

  it('removeDownloadHistoryItem keeps in-flight progress entries intact', () => {
    useAppStore.setState({
      downloadHistory: [
        { taskId: 'h2', fileName: 'f2.pdf', completedAt: 2000 }
      ],
      progress: {
        h2: prog('h2', 'downloading', { received: 30, total: 100 })
      }
    })

    useAppStore.getState().removeDownloadHistoryItem('h2')

    // 在传任务不可删（防用户误点把进行中的任务进度抹掉）
    expect(useAppStore.getState().progress['h2']).toBeDefined()
  })
})

describe('Fix 3 — removeProgressItem for tasks unknown to the main process', () => {
  beforeEach(() => {
    useAppStore.setState({ progress: {}, batchTaskIds: [], cloudLinkedIds: {} })
  })

  it('removes terminal-state entries including error and _cloud mirrors', () => {
    useAppStore.setState({
      progress: {
        submit_fail: prog('submit_fail', 'error', { message: 'IPC 通信失败' }),
        both_task: prog('both_task', 'error'),
        both_task_cloud: prog('both_task_cloud', 'error')
      }
    })

    useAppStore.getState().removeProgressItem('submit_fail')
    expect(useAppStore.getState().progress['submit_fail']).toBeUndefined()

    // 主键删除时连带镜像
    useAppStore.getState().removeProgressItem('both_task')
    const p = useAppStore.getState().progress
    expect(p['both_task']).toBeUndefined()
    expect(p['both_task_cloud']).toBeUndefined()
  })

  it('refuses to remove in-flight entries (must go through cancel)', () => {
    useAppStore.setState({
      progress: {
        live: prog('live', 'downloading', { received: 5, total: 10 }),
        queued: prog('queued', 'pending'),
        halted: prog('halted', 'paused')
      }
    })

    useAppStore.getState().removeProgressItem('live')
    useAppStore.getState().removeProgressItem('queued')
    useAppStore.getState().removeProgressItem('halted')

    const p = useAppStore.getState().progress
    expect(p['live']).toBeDefined()
    expect(p['queued']).toBeDefined()
    expect(p['halted']).toBeDefined()
  })
})

describe('Fix 4 — cnmooc chapter categories are pinned to the files chip', () => {
  it('explicit chipKey files wins over chapter-name keyword sniffing', () => {
    // 章节名含「视频」「作业」字样也不该被误归类
    const videoTitledChapter = {
      id: '第3章 视频处理基础',
      name: '第3章 视频处理基础',
      chipKey: 'files' as const,
      state: 'none' as const,
      onToggle: () => {},
      items: []
    }
    const assignmentTitledChapter = {
      id: '第5章 作业调度算法',
      name: '第5章 作业调度算法',
      chipKey: 'files' as const,
      state: 'none' as const,
      onToggle: () => {},
      items: []
    }
    expect(resolveCategoryChipKey(videoTitledChapter)).toBe('files')
    expect(resolveCategoryChipKey(assignmentTitledChapter)).toBe('files')
  })

  it('unpinned items still fall back to keyword resolution (Canvas/Audited unchanged)', () => {
    const canvasVideo = {
      id: 'teacher',
      name: '👨‍🏫 教师实录 (MP4)',
      state: 'none' as const,
      onToggle: () => {},
      items: []
    }
    expect(resolveCategoryChipKey(canvasVideo)).toBe('videos')
  })
})
