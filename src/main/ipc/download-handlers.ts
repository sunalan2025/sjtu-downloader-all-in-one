import { ipcMain } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  DownloadMode,
  DownloadTaskSpec
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
  cancelWorkerTask,
  isWorkerTask
} from '../download-engine/worker-dispatch'
import { globalSpeedLimiter, formatPathFromTemplate } from '../../shared/utils'
import type { DownloadOptions } from '../../shared/backup'
import { persistDownloadBatch, tryRecoverBackupTask } from '../backup/runtime'
import { validateIpcSender, DEFAULT_UNTRUSTED_IPC_ERROR } from '../utils/ipc-guard'

/**
 * 注册下载子系统所有 IPC 通道 (download:*)
 */
export async function startDownloadBatch(
      destRoot: string,
      specs: DownloadTaskSpec[],
      options?: DownloadOptions
    ): Promise<{ ok: boolean; error?: string }> {
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

        const remoteLocal = options?.privateWorker?.enabled && options.privateWorker.storageMode === 'server_local'
        if ((mode === 'cloud' || mode === 'both') && !remoteLocal && !cloudToken) {
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
              '未完成任务会保存到资源库，重启后可在「资源库 → 任务恢复」继续。',
              '请保留 .part 文件。支持 Range 且资源版本未变时会继续下载；',
              'HLS、云盘上传或无法验证来源的文件会安全地重新传输。',
              '',
              '已下载完成的 .mp4 视频不会被清理，可放心保留。',
              '',
              '—— 上海交大课程下载器',
              ''
            ].join('\n'), { encoding: 'utf-8', flag: 'wx' })
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
          }
          const admissions: { spec: DownloadTaskSpec; filePath: string; partPath: string }[] = []
          const seen = new Set<string>()
          for (const spec of specs) {
            if (tasks.has(spec.taskId)) {
              const st = tasks.get(spec.taskId)!.state
              if (st === 'pending' || st === 'downloading' || st === 'paused') continue
            }
            if (pendingLocalIds.has(spec.taskId)) continue
            if (pausedLocalIds.has(spec.taskId)) continue
            if (seen.has(spec.taskId)) continue
            seen.add(spec.taskId)
            const relPath = formatPathFromTemplate(options?.namingTemplate || '', {
              term: spec.term,
              course: effectiveCourseName(spec),
              fileName: spec.fileName
            })
            const filePath = join(localBase, ...relPath.split('/'))
            const partPath = filePath + '.part'
            admissions.push({ spec, filePath, partPath })
          }
          persistDownloadBatch(admissions.map(({ spec, filePath, partPath }) => ({ spec, backend: 'local', options: { ...options, localDestRoot: root, mode: 'local' }, paths: { filePath, partPath } })))
          for (const { spec, filePath, partPath } of admissions) {
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
        if ((mode === 'cloud' || mode === 'both') && (cloudToken || remoteLocal)) {
          const cloudSpecs = mode === 'both'
            ? specs.map(s => ({
                ...s,
                taskId: s.taskId + '_cloud',
                cloudUserToken: cloudToken || undefined,
                cloudDestRoot: options?.cloudDestRoot ?? s.cloudDestRoot
              }))
            : specs.map(s => ({
                ...s,
                cloudUserToken: cloudToken || undefined,
                cloudDestRoot: options?.cloudDestRoot ?? s.cloudDestRoot
              }))

          if (isWorkerDelegated('cloud', options?.privateWorker)) {
            const result = await dispatchWorkerBatch(cloudSpecs, {
              ...options,
              mode: 'cloud'
            })
            if (!result.ok) return result
          } else {
            const admissions: DownloadTaskSpec[] = []
            const seen = new Set<string>()
            for (const spec of cloudSpecs) {
              if (cloudTasks.has(spec.taskId)) {
                const st = cloudTasks.get(spec.taskId)!.state
                if (st === 'pending' || st === 'downloading' || st === 'paused') continue
              }
              if (pendingCloudIds.has(spec.taskId)) continue
              if (pausedCloudIds.has(spec.taskId)) continue
              if (seen.has(spec.taskId)) continue
              seen.add(spec.taskId)
              admissions.push(spec)
            }
            persistDownloadBatch(admissions.map(spec => ({ spec, backend: 'cloud', options: { ...options, mode: 'cloud', cloudDestRoot: options?.cloudDestRoot ?? spec.cloudDestRoot } })))
            for (const spec of admissions) {
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

export function registerDownloadHandlers(): void {
  const handle: typeof ipcMain.handle = (channel, listener) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!validateIpcSender(event)) {
        return { ok: false, error: DEFAULT_UNTRUSTED_IPC_ERROR }
      }
      return listener(event, ...args)
    })

  handle('download:start', (_e, destRoot: string, specs: DownloadTaskSpec[], options?: DownloadOptions) => startDownloadBatch(destRoot, specs, options))

  handle('download:pause', (_e, id: string) => {
    if (isWorkerTask(id) || (!id.endsWith('_cloud') && isWorkerTask(id + '_cloud'))) {
      return { ok: false, error: '中转任务不支持断点暂停，仅支持取消' }
    }
    pauseTask(id)
    cloudPauseTask(id)
    if (!id.endsWith('_cloud')) {
      cloudPauseTask(id + '_cloud')
    }
    return { ok: true }
  })

  handle('download:cancel', (_e, id: string) => {
    cancelTask(id)
    cloudCancelTask(id)
    const workerActive = isWorkerTask(id)
    cancelWorkerTask(id)
    if (workerActive) {
      emitProgress({ taskId: id, state: 'cancelled', received: 0, total: 0, message: '已取消' })
    }
    if (!id.endsWith('_cloud')) {
      const cloudId = id + '_cloud'
      const cloudWorkerActive = isWorkerTask(cloudId)
      cloudCancelTask(cloudId)
      cancelWorkerTask(cloudId)
      if (cloudWorkerActive) {
        emitProgress({ taskId: cloudId, state: 'cancelled', received: 0, total: 0, message: '已取消' })
      }
    }
    return { ok: true }
  })

  handle('download:resume', async (_e, id: string) => {
    const recovered = await tryRecoverBackupTask(id)
    if (recovered) return recovered
    resumeTask(id)
    cloudResumeTask(id)
    if (!id.endsWith('_cloud')) cloudResumeTask(id + '_cloud')
    return { ok: true }
  })

  handle('download:get-snapshot', () => {
    return getDownloadSnapshot()
  })

  handle('download:clear-finished-snapshots', () => {
    clearFinishedSnapshots()
    return { ok: true }
  })

  handle('download:delete-snapshot', (_e, taskId: string) => {
    deleteSnapshot(taskId)
    return { ok: true }
  })

  handle('download:pause-all', () => {
    pauseAll()
    cloudPauseAll()
    return { ok: true }
  })

  handle('download:cancel-all', () => {
    cancelAll()
    cloudCancelAll()
    return { ok: true }
  })

  handle('download:resume-all', () => {
    resumeAll()
    cloudResumeAll()
    return { ok: true }
  })

  handle('download:set-concurrency', (_e, n: number) => {
    setConcurrency(Math.max(1, Math.min(16, Math.floor(Number(n)) || 3)))
    scheduleNext()
    cloudScheduleNext()
    return { ok: true, concurrency: getConcurrency() }
  })

  handle('download:set-speed-limit', (_e, limitKBps: number) => {
    globalSpeedLimiter.setLimitKBps(limitKBps || 0)
    return { ok: true }
  })
}
