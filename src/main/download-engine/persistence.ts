import { app } from 'electron'
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DownloadTaskSpec, FileConflictStrategy } from '../../shared/types'
import {
  tasks,
  cloudTasks,
  pendingLocal,
  pausedLocal,
  pendingCloud,
  pausedCloud,
  pendingLocalIds,
  pausedLocalIds,
  pendingCloudIds,
  pausedCloudIds,
  conflictStrategyByTask,
  type PendingSpec
} from './shared'

function getQueueFilePath(): string {
  try {
    return join(app.getPath('userData'), 'download_queue.json')
  } catch {
    return ''
  }
}

interface SavedQueueState {
  version: number
  pendingLocal: PendingSpec[]
  pausedLocal: PendingSpec[]
  pendingCloud: DownloadTaskSpec[]
  pausedCloud: DownloadTaskSpec[]
  conflictStrategies: Array<[string, FileConflictStrategy]>
}

/** 将当前未完成与暂停的任务保存至用户数据目录下的 download_queue.json */
export function saveQueueState(): void {
  const file = getQueueFilePath()
  if (!file) return

  // 收集被打断的活跃任务（转换为 pending）
  const activeLocalSpecs: PendingSpec[] = []
  for (const [, t] of tasks) {
    if (t.state === 'downloading' || t.state === 'pending') {
      activeLocalSpecs.push({ spec: t.spec, filePath: t.filePath, partPath: t.partPath })
    }
  }

  const activeCloudSpecs: DownloadTaskSpec[] = []
  for (const [, t] of cloudTasks) {
    if (t.state === 'downloading' || t.state === 'pending') {
      activeCloudSpecs.push(t.spec)
    }
  }

  const allPendingLocal = [...activeLocalSpecs, ...pendingLocal]
  const allPendingCloud = [...activeCloudSpecs, ...pendingCloud]

  const totalTasks = allPendingLocal.length + pausedLocal.length + allPendingCloud.length + pausedCloud.length
  if (totalTasks === 0) {
    try { if (existsSync(file)) unlinkSync(file) } catch { /* ignore */ }
    return
  }

  const state: SavedQueueState = {
    version: 1,
    pendingLocal: allPendingLocal,
    pausedLocal,
    pendingCloud: allPendingCloud,
    pausedCloud,
    conflictStrategies: Array.from(conflictStrategyByTask.entries())
  }

  const tmpFile = file + '.tmp'
  try {
    writeFileSync(tmpFile, JSON.stringify(state), 'utf-8')
    renameSync(tmpFile, file)
    console.log(`[queue:persistence] 已保存 ${totalTasks} 条未完成任务到本地`)
  } catch (err) {
    console.warn('[queue:persistence] 保存队列失败:', err instanceof Error ? err.message : err)
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile)
    } catch { /* ignore */ }
  }
}

/** 应用启动时恢复本地保存的任务队列 */
export function loadQueueState(): { restoredCount: number } {
  const file = getQueueFilePath()
  if (!file || !existsSync(file)) return { restoredCount: 0 }

  try {
    const raw = readFileSync(file, 'utf-8')
    const data = JSON.parse(raw) as SavedQueueState
    if (data.version !== 1) return { restoredCount: 0 }

    let count = 0

    if (Array.isArray(data.conflictStrategies)) {
      for (const [id, strat] of data.conflictStrategies) {
        conflictStrategyByTask.set(id, strat)
      }
    }

    if (Array.isArray(data.pendingLocal)) {
      for (const item of data.pendingLocal) {
        if (item?.spec?.taskId && !pendingLocalIds.has(item.spec.taskId)) {
          pendingLocal.push(item)
          pendingLocalIds.add(item.spec.taskId)
          count++
        }
      }
    }

    if (Array.isArray(data.pausedLocal)) {
      for (const item of data.pausedLocal) {
        if (item?.spec?.taskId && !pausedLocalIds.has(item.spec.taskId)) {
          pausedLocal.push(item)
          pausedLocalIds.add(item.spec.taskId)
          count++
        }
      }
    }

    if (Array.isArray(data.pendingCloud)) {
      for (const spec of data.pendingCloud) {
        if (spec?.taskId && !pendingCloudIds.has(spec.taskId)) {
          pendingCloud.push(spec)
          pendingCloudIds.add(spec.taskId)
          count++
        }
      }
    }

    if (Array.isArray(data.pausedCloud)) {
      for (const spec of data.pausedCloud) {
        if (spec?.taskId && !pausedCloudIds.has(spec.taskId)) {
          pausedCloud.push(spec)
          pausedCloudIds.add(spec.taskId)
          count++
        }
      }
    }

    console.log(`[queue:persistence] 成功恢复 ${count} 条历史未完成任务`)
    return { restoredCount: count }
  } catch (err) {
    console.warn('[queue:persistence] 恢复队列失败:', err instanceof Error ? err.message : err)
    return { restoredCount: 0 }
  }
}
