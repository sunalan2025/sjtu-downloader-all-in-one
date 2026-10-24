// 进度推送（setImmediate 批处理）与主进程任务快照登记册
//
// 1. 多个并发任务可能在同一事件循环 tick 各自 emit 进度（如 8 个任务 2s 间隔漂移到同一 tick）。
//    批处理把 N 次 IPC 序列化合并为 1 次/tick，减少渲染端重渲染。
// 2. taskSnapshotRegistry 作为主进程下载真相来源（Single Source of Truth），
//    缓存所有任务的最新状态、文件名与课程名，支持渲染端重载 (Ctrl+R) 时拉取全量快照，
//    根治任务重载蒸发问题。

import type { DownloadProgress } from '../../shared/types'
import { getMainWindow } from '../window'

let progressBatch: Map<string, DownloadProgress> | null = null
let progressScheduled = false

/** 主进程下载任务快照注册表：taskId → 最新 DownloadProgress */
const taskSnapshotRegistry = new Map<string, DownloadProgress>()

/** 注册任务元数据（文件名、所属课程名），确保任务生命周期内元数据不丢失 */
export function registerTaskMeta(taskId: string, meta: { fileName?: string; courseName?: string }): void {
  const existing = taskSnapshotRegistry.get(taskId)
  if (existing) {
    if (meta.fileName && !existing.fileName) existing.fileName = meta.fileName
    if (meta.courseName && !existing.courseName) existing.courseName = meta.courseName
  } else {
    taskSnapshotRegistry.set(taskId, {
      taskId,
      state: 'pending',
      received: 0,
      total: 0,
      fileName: meta.fileName,
      courseName: meta.courseName
    })
  }
}

/** 获取主进程所有已知的最新下载进度快照（按入队顺序） */
export function getDownloadSnapshot(): DownloadProgress[] {
  return Array.from(taskSnapshotRegistry.values())
}

/** 清理已完成或已取消的历史快照 */
export function clearFinishedSnapshots(): void {
  for (const [id, item] of taskSnapshotRegistry.entries()) {
    if (item.state === 'done' || item.state === 'skipped' || item.state === 'cancelled') {
      taskSnapshotRegistry.delete(id)
    }
  }
}

/** 删除单条历史快照（含其 _cloud 镜像）。
 *  供渲染端删除单条历史记录时联动调用——否则刷新页面后快照恢复
 *  会把该 done 条目连历史一起"复活"。仅允许删终态条目，防误删在传任务。 */
export function deleteSnapshot(taskId: string): void {
  const baseId = taskId.replace(/_cloud$/, '')
  for (const id of [baseId, baseId + '_cloud']) {
    const item = taskSnapshotRegistry.get(id)
    if (item && (item.state === 'done' || item.state === 'skipped' || item.state === 'cancelled')) {
      taskSnapshotRegistry.delete(id)
    }
  }
}

/** 清空全部快照（测试或重置时使用） */
export function resetSnapshotRegistryForTest(): void {
  taskSnapshotRegistry.clear()
}

export function emitProgress(p: DownloadProgress): void {
  const existing = taskSnapshotRegistry.get(p.taskId)
  const merged: DownloadProgress = {
    ...existing,
    ...p,
    fileName: p.fileName || existing?.fileName,
    courseName: p.courseName || existing?.courseName
  }
  taskSnapshotRegistry.set(p.taskId, merged)

  if (!progressBatch) progressBatch = new Map()
  progressBatch.set(p.taskId, merged)
  if (!progressScheduled) {
    progressScheduled = true
    setImmediate(() => {
      const batch = progressBatch!
      progressBatch = null
      progressScheduled = false
      for (const prog of batch.values()) {
        getMainWindow()?.webContents.send('download:progress', prog)
      }
    })
  }
}
