// 进度推送（setImmediate 批处理）
//
// 多个并发任务可能在同一事件循环 tick 各自 emit 进度（如 8 个任务 2s 间隔漂移到同一 tick）。
// 批处理把 N 次 IPC 序列化合并为 1 次/tick，减少渲染端重渲染。

import type { DownloadProgress } from '../../shared/types'
import { getMainWindow } from '../window'

let progressBatch: Map<string, DownloadProgress> | null = null
let progressScheduled = false

export function emitProgress(p: DownloadProgress): void {
  if (!progressBatch) progressBatch = new Map()
  progressBatch.set(p.taskId, p)
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
