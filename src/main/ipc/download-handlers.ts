import { ipcMain } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  DownloadMode,
  FileConflictStrategy,
  DownloadTaskSpec,
  PrivateWorkerConfig
} from '../../shared/types'
import { getCachedUserToken } from '../cloudpan'
import { getConcurrency, setConcurrency } from '../concurrency'
import {
  emitProgress,
  registerTaskMeta,
  getDownloadSnapshot,
  clearFinishedSnapshots,
  deleteSnapshot
} from '../download-engine/progress'
import {
  tasks,
  cloudTasks,
  pendingLocal,
  pendingCloud,
  pendingLocalIds,
  pausedLocalIds,
  pendingCloudIds,
  pausedCloudIds,
  conflictStrategyByTask,
  workerConfigByTask,
  CLOUD_ROOT_FOLDER,
  CNMOOC_LOCAL_DIR,
  effectiveCourseName,
  isCanvasSpec,
  isCnmoocSpec
} from '../download-engine/shared'
import {
  scheduleNext,
  pauseTask,
  cancelTask,
  resumeTask,
  pauseAll,
  cancelAll,
  resumeAll
} from '../download-engine/local'
import {
  cloudScheduleNext,
  cloudPauseTask,
  cloudCancelTask,
  cloudResumeTask,
  cloudPauseAll,
  cloudCancelAll,
  cloudResumeAll
} from '../download-engine/cloud'
import {
  isWorkerDelegated,
  dispatchWorkerBatch,
  cancelWorkerTask
} from '../download-engine/worker-dispatch'
import { globalSpeedLimiter, formatPathFromTemplate } from '../../shared/utils'

/**
 * 注册下载子系统所有 IPC 通道 (download:*)
 */
export function registerDownloadHandlers(): void {
  ipcMain.handle(
    'download:start',
    async (
      _e,
      destRoot: string,
      specs: DownloadTaskSpec[],
      options?: {
        mode?: DownloadMode
        localDestRoot?: string
        conflictStrategy?: FileConflictStrategy
        namingTemplate?: string
        cloudDestRoot?: string
        privateWorker?: PrivateWorkerConfig
      }
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const MAX_SPECS_PER_BATCH = 5000
        if (!Array.isArray(specs) || specs.length === 0) {
          return { ok: false, error: 'specs 不能为空' }
        }
        if (specs.length > MAX_SPECS_PER_BATCH) {
          return { ok: false, error: `specs 数量超出上限（${MAX_SPECS_PER_BATCH}）` }
        }
        for (const spec of specs) {
          if (!spec.taskId || !spec.fileName) {
            return { ok: false, error: 'spec 缺少 taskId 或 fileName' }
          }
        }

        const mode: DownloadMode = options?.mode
          ?? (specs.some(s => s.cloudUserToken) ? 'cloud' : 'local')

        // 私有中转服务代传接管判定：若命中中转分流规则，委托远端节点代传并直接返回
        if (isWorkerDelegated(mode, options?.privateWorker)) {
          return dispatchWorkerBatch(specs, options!)
        }

        const cloudToken = getCachedUserToken()

        if ((mode === 'cloud' || mode === 'both') && !cloudToken) {
          return {
            ok: false,
            error: mode === 'both'
              ? '当前为「本地 + 云盘」模式，但未连接交大云盘，请先连接云盘或切换为仅本地下载'
              : '当前为云盘模式，但未连接交大云盘，请先连接云盘或切换为本地下载'
          }
        }
        if ((mode === 'local' || mode === 'both') && !(options?.localDestRoot || destRoot)) {
          return { ok: false, error: '请先选择本地下载目录' }
        }

        // ─── 本地下载 ───
        if (mode === 'local' || mode === 'both') {
          const root = options?.localDestRoot || destRoot
          if (!root) throw new Error('请先选择本地下载目录')

          const isCanvas = specs.some(s => isCanvasSpec(s))
          const isCnmooc = specs.some(s => isCnmoocSpec(s))
          const localBase = isCnmooc ? join(root, CNMOOC_LOCAL_DIR)
            : isCanvas ? join(root, 'Canvas课程')
            : join(root, CLOUD_ROOT_FOLDER)
          mkdirSync(localBase, { recursive: true })

          const readmePath = join(localBase, '下载说明.txt')
          try {
            writeFileSync(readmePath, [
              '下载说明',
              '========',
              '',
              '本目录下的 .part 文件是下载过程中的临时文件，支持会话内断点续传',
              '（暂停→恢复不重下）。每次打开应用时会自动清理上次会话残留的 .part',
              '和 remux 失败的孤立 .ts 文件，释放本地空间——因此跨重启不再续传，',
              '如需重下直接发起即可。',
              '',
              '已下载完成的 .mp4 视频不会被清理，可放心保留。',
              '',
              '—— 上海交大课程下载器',
              ''
            ].join('\n'), { encoding: 'utf-8', flag: 'wx' })
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
          }
          for (const spec of specs) {
            if (tasks.has(spec.taskId)) {
              const st = tasks.get(spec.taskId)!.state
              if (st === 'pending' || st === 'downloading' || st === 'paused') continue
            }
            if (pendingLocalIds.has(spec.taskId)) continue
            if (pausedLocalIds.has(spec.taskId)) continue
            const relPath = formatPathFromTemplate(options?.namingTemplate || '', {
              term: spec.term,
              course: effectiveCourseName(spec),
              fileName: spec.fileName
            })
            const filePath = join(localBase, ...relPath.split('/'))
            const partPath = filePath + '.part'
            pendingLocal.push({ spec: { ...spec, cloudUserToken: undefined }, filePath, partPath })
            pendingLocalIds.add(spec.taskId)
            if (options?.conflictStrategy) conflictStrategyByTask.set(spec.taskId, options.conflictStrategy)
            if (options?.privateWorker?.enabled && options.privateWorker.endpointUrl?.trim()) {
              workerConfigByTask.set(spec.taskId, options.privateWorker)
            }
            registerTaskMeta(spec.taskId, { fileName: spec.fileName, courseName: effectiveCourseName(spec) })
            emitProgress({ taskId: spec.taskId, state: 'pending', received: 0, total: 0, fileName: spec.fileName, courseName: effectiveCourseName(spec) })
          }
          scheduleNext()
        }

        // ─── 云盘上传 ───
        if ((mode === 'cloud' || mode === 'both') && cloudToken) {
          const cloudSpecs = mode === 'both'
            ? specs.map(s => ({
                ...s,
                taskId: s.taskId + '_cloud',
                cloudUserToken: cloudToken,
                cloudDestRoot: options?.cloudDestRoot ?? s.cloudDestRoot
              }))
            : specs.map(s => ({
                ...s,
                cloudUserToken: cloudToken,
                cloudDestRoot: options?.cloudDestRoot ?? s.cloudDestRoot
              }))

          if (isWorkerDelegated('cloud', options?.privateWorker)) {
            void dispatchWorkerBatch(cloudSpecs, {
              ...options,
              mode: 'cloud'
            })
          } else {
            for (const spec of cloudSpecs) {
              if (cloudTasks.has(spec.taskId)) {
                const st = cloudTasks.get(spec.taskId)!.state
                if (st === 'pending' || st === 'downloading' || st === 'paused') continue
              }
              if (pendingCloudIds.has(spec.taskId)) continue
              if (pausedCloudIds.has(spec.taskId)) continue
              pendingCloud.push(spec)
              pendingCloudIds.add(spec.taskId)
              if (options?.conflictStrategy) conflictStrategyByTask.set(spec.taskId, options.conflictStrategy)
              if (options?.privateWorker?.enabled && options.privateWorker.endpointUrl?.trim()) {
                workerConfigByTask.set(spec.taskId, options.privateWorker)
              }
              registerTaskMeta(spec.taskId, { fileName: spec.fileName, courseName: effectiveCourseName(spec) })
              emitProgress({ taskId: spec.taskId, state: 'pending', received: 0, total: 0, fileName: spec.fileName, courseName: effectiveCourseName(spec) })
            }
            cloudScheduleNext()
          }
        }

        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: msg.slice(0, 300) }
      }
    }
  )

  ipcMain.handle('download:pause', (_e, id: string) => {
    pauseTask(id)
    cloudPauseTask(id)
    cancelWorkerTask(id)
    if (!id.endsWith('_cloud')) {
      cloudPauseTask(id + '_cloud')
      cancelWorkerTask(id + '_cloud')
    }
    return { ok: true }
  })

  ipcMain.handle('download:cancel', (_e, id: string) => {
    cancelTask(id)
    cloudCancelTask(id)
    cancelWorkerTask(id)
    if (!id.endsWith('_cloud')) {
      cloudCancelTask(id + '_cloud')
      cancelWorkerTask(id + '_cloud')
    }
    return { ok: true }
  })

  ipcMain.handle('download:resume', (_e, id: string) => {
    resumeTask(id)
    cloudResumeTask(id)
    if (!id.endsWith('_cloud')) cloudResumeTask(id + '_cloud')
    return { ok: true }
  })

  ipcMain.handle('download:get-snapshot', () => {
    return getDownloadSnapshot()
  })

  ipcMain.handle('download:clear-finished-snapshots', () => {
    clearFinishedSnapshots()
    return { ok: true }
  })

  ipcMain.handle('download:delete-snapshot', (_e, taskId: string) => {
    deleteSnapshot(taskId)
    return { ok: true }
  })

  ipcMain.handle('download:pause-all', () => {
    pauseAll()
    cloudPauseAll()
    return { ok: true }
  })

  ipcMain.handle('download:cancel-all', () => {
    cancelAll()
    cloudCancelAll()
    return { ok: true }
  })

  ipcMain.handle('download:resume-all', () => {
    resumeAll()
    cloudResumeAll()
    return { ok: true }
  })

  ipcMain.handle('download:set-concurrency', (_e, n: number) => {
    setConcurrency(Math.max(1, Math.min(16, Math.floor(Number(n)) || 3)))
    scheduleNext()
    cloudScheduleNext()
    return { ok: true, concurrency: getConcurrency() }
  })

  ipcMain.handle('download:set-speed-limit', (_e, limitKBps: number) => {
    globalSpeedLimiter.setLimitKBps(limitKBps || 0)
    return { ok: true }
  })
}
