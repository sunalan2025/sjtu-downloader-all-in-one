import { app, ipcMain, safeStorage, shell, type IpcMainInvokeEvent } from 'electron'
import { realpath, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type {
  BackupApi,
  BackupResource,
  BackupResult,
  BackupSnapshot,
  BackupTask,
  CourseSubscription,
  DownloadOptions
} from '../../shared/backup'
import type { DownloadTaskSpec } from '../../shared/types'
import { pendingSubscriptionResources } from '../../shared/backup'
import { BackupCatalog, digest, safeOptions } from './catalog'
import {
  currentBackupOwner,
  getBackupCatalog,
  initializeBackupRuntime,
  notifyBackupChanged,
  persistDownloadBatch,
  setBackupRecoveryHandler
} from './runtime'
import { canvasVersionStillMatches, clearBackupSourceCaches, listBackupCourses, refreshBackupSpec, scanBackupCourse } from './sources'
import { getAuthInfo, getStudentId } from '../auth'
import { getMainWindow, getIsQuitting } from '../window'
import { getCachedUserToken } from '../cloudpan'
import { getWorkerAuthToken } from '../credentials'
import { validateIpcSender, DEFAULT_UNTRUSTED_IPC_ERROR, setIpcGuardWindowGetter } from '../utils/ipc-guard'
setIpcGuardWindowGetter(getMainWindow)
import { startDownloadBatch } from '../ipc/download-handlers'
import {
  pendingLocal,
  pendingLocalIds,
  pendingCloud,
  pendingCloudIds,
  pausedLocalIds,
  pausedCloudIds,
  tasks,
  cloudTasks,
  conflictStrategyByTask,
  workerConfigByTask
} from '../download-engine/shared'
import { resumeTask, scheduleNext } from '../download-engine/local'
import { cloudResumeTask, cloudScheduleNext } from '../download-engine/cloud'
import { emitProgress, registerTaskMeta } from '../download-engine/progress'
import { dispatchWorkerBatch, isWorkerTask, pollWorkerTaskProgress } from '../download-engine/worker-dispatch'
import { queryPrivateWorkerTask } from '../private-worker'
import { inside, missingMode, versionedName, redactMessage, workerTarget } from './planning'

const busy = new Set<string>()
const recovering = new Set<string>()
let timer: ReturnType<typeof setInterval> | undefined
let notifyTimer: ReturnType<typeof setTimeout> | undefined

function store(): BackupCatalog {
  const catalog = getBackupCatalog()
  if (!catalog) throw Error('资源库尚未就绪')
  return catalog
}
function ownSubscription(id: string): CourseSubscription {
  const sub = store().data.subscriptions[id]
  if (!sub || sub.owner !== currentBackupOwner()) throw Error('未找到当前账号的课程订阅')
  return sub
}
async function requireAccount(): Promise<string> {
  const auth = await getAuthInfo()
  const owner = currentBackupOwner()
  if (!auth.loggedIn || owner === 'unidentified') throw Error('请先登录原账号，再恢复或同步课程')
  return owner
}
function isLive(taskId: string): boolean {
  return (
    pendingLocalIds.has(taskId) ||
    pendingCloudIds.has(taskId) ||
    pausedLocalIds.has(taskId) ||
    pausedCloudIds.has(taskId) ||
    tasks.has(taskId) ||
    cloudTasks.has(taskId) ||
    isWorkerTask(taskId)
  )
}
async function hydratedOptions(options: DownloadOptions): Promise<DownloadOptions> {
  return {
    ...options,
    privateWorker: options.privateWorker ? { ...options.privateWorker, authToken: await getWorkerAuthToken() } : undefined
  }
}

async function verifyCopies(resources: BackupResource[]): Promise<number> {
  const copies = resources.flatMap(r => r.copies).filter(c => c.backend === 'local' && c.filePath)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(8, copies.length) }, async () => {
      while (cursor < copies.length) {
        const copy = copies[cursor++]
        try {
          const info = await stat(copy.filePath!)
          copy.status = !info.isFile() || (copy.size !== undefined && copy.size !== info.size) ? 'changed' : 'present'
        } catch (error) {
          copy.status = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unknown'
        }
        copy.checkedAt = Date.now()
      }
    })
  )
  store().markDirty()
  store().flush()
  notifyBackupChanged()
  return copies.length
}

function subscriptionResources(sub: CourseSubscription): BackupResource[] {
  return Object.values(store().data.resources).filter(
    r => r.owner === sub.owner && r.course.key === sub.course.key && (!sub.lastCheckedAt || r.lastSeenAt >= sub.lastCheckedAt)
  )
}

async function enqueueMissing(sub: CourseSubscription): Promise<number> {
  if ((await requireAccount()) !== sub.owner) throw Error('账号已切换，本次备份已停止')
  const resources = subscriptionResources(sub)
  await verifyCopies(resources)
  const options = await hydratedOptions(sub.options)
  let count = 0
  // Small groups keep IPC/state work bounded and give the event loop room between batches.
  const groups = new Map<'local' | 'cloud' | 'both', DownloadTaskSpec[]>()
  const outstanding = new Map<string, BackupTask[]>()
  for (const task of Object.values(store().data.tasks)) {
    if (task.owner !== sub.owner || !['pending', 'downloading', 'paused'].includes(task.progress.state)) continue
    const key = `${task.resourceId}:${task.version}`
    const items = outstanding.get(key) || []
    items.push(task)
    outstanding.set(key, items)
  }
  for (const resource of resources) {
    if (getIsQuitting() || currentBackupOwner() !== sub.owner) break
    let mode = missingMode(resource, options)
    if (!mode) continue
    const running = outstanding.get(`${resource.id}:${resource.version}`) || []
    const localPending = running.some(
      t => t.backend === 'local' && t.filePath && options.localDestRoot && inside(options.localDestRoot, t.filePath)
    )
    const cloudPending = running.some(t =>
      options.privateWorker?.enabled
        ? t.backend === 'worker' && workerTarget(t.options) === workerTarget(options)
        : t.backend === 'cloud' && (t.options.cloudDestRoot || '') === (options.cloudDestRoot || '')
    )
    const local = mode !== 'cloud' && !localPending
    const cloud = mode !== 'local' && !cloudPending
    mode = local && cloud ? 'both' : local ? 'local' : cloud ? 'cloud' : null
    if (!mode) continue
    const spec = await refreshBackupSpec({
      ...resource.spec,
      resourceVersion: resource.version,
      resourceSize: resource.size,
      taskId: `backup_${resource.id}_${resource.version}_${digest(JSON.stringify([mode, options.localDestRoot, options.cloudDestRoot, options.namingTemplate, workerTarget(options)]))}`,
      fileName: versionedName(resource.spec.fileName, resource.version),
      backupCourse: sub.course
    })
    const group = groups.get(mode) || []
    group.push(spec)
    groups.set(mode, group)
  }
  for (const [mode, specs] of groups) {
    for (let offset = 0; offset < specs.length; offset += 100) {
      if (getIsQuitting() || currentBackupOwner() !== sub.owner) throw Error('账号已切换或应用正在退出，剩余任务未提交')
      const batch = specs.slice(offset, offset + 100)
      const result = await startDownloadBatch(options.localDestRoot || '', batch, { ...options, mode, conflictStrategy: 'overwrite' })
      if (!result.ok) throw Error(result.error || '补齐任务提交失败')
      count += batch.length
    }
  }
  return count
}

async function checkSubscription(id: string, fill = false): Promise<BackupResult> {
  const sub = ownSubscription(id)
  if (busy.has(id)) return { ok: false, error: '此课程正在检查，请稍后再试' }
  busy.add(id)
  notifyBackupChanged()
  try {
    if ((await requireAccount()) !== sub.owner) throw Error('账号已切换，请重新打开资源库')
    const scanStartedAt = Date.now()
    const result = await scanBackupCourse(sub.course, sub.selection)
    if (getIsQuitting() || currentBackupOwner() !== sub.owner || !store().data.subscriptions[id]) throw Error('本次检查已停止')
    if (result.items.length > 20_000) throw Error('课程资源超过单次扫描上限，请在课程页面分批下载')
    let added = 0,
      updated = 0
    for (const item of result.items) {
      const change = store().discover(sub.owner, item).change
      if (change === 'new') added++
      if (change === 'updated') updated++
    }
    sub.lastCheckedAt = scanStartedAt
    sub.nextCheckAt = Date.now() + sub.intervalMinutes * 60_000
    sub.lastError = undefined
    sub.warning = result.warning
    sub.added = added
    sub.updated = updated
    store().markDirty()
    store().flush()
    const count = fill || (sub.enabled && sub.autoDownload) ? await enqueueMissing(sub) : 0
    return { ok: true, count }
  } catch (error) {
    sub.lastError = redactMessage(error instanceof Error ? error.message : String(error))
    sub.nextCheckAt = Date.now() + Math.max(5, sub.intervalMinutes) * 60_000
    store().scheduleFlush()
    return { ok: false, error: sub.lastError }
  } finally {
    busy.delete(id)
    notifyBackupChanged()
  }
}

async function recoverOne(task: BackupTask): Promise<BackupResult> {
  const taskId = task.spec.taskId
  if (recovering.has(task.id)) return { ok: false, error: '此任务正在恢复' }
  recovering.add(task.id)
  try {
    if ((await requireAccount()) !== task.owner) throw Error('请登录创建此任务的原账号')
    if (task.recoveryWarning) throw Error(task.recoveryWarning)
    if (isLive(taskId)) {
      if (task.backend === 'worker') return { ok: true, count: 0 }
      resumeTask(taskId)
      cloudResumeTask(taskId)
      return { ok: true, count: 1 }
    }
    const options = await hydratedOptions(task.options)
    let spec = { ...task.spec }
    const assertOwner = (): void => {
      if (getIsQuitting() || currentBackupOwner() !== task.owner) throw Error('账号已切换或应用正在退出，本次恢复已停止')
    }
    const refresh = async (): Promise<void> => {
      spec = await refreshBackupSpec(spec)
      if (task.encryptedUrl && !spec.url) {
        if (!safeStorage.isEncryptionAvailable()) throw Error('系统凭据服务不可用，无法恢复临时下载地址')
        spec.url = safeStorage.decryptString(Buffer.from(task.encryptedUrl, 'base64'))
      }
      assertOwner()
    }
    assertOwner()
    if (task.backend === 'worker') {
      const worker = options.privateWorker
      if (!worker?.endpointUrl) throw Error('原中转服务器配置缺失')
      const remote = await queryPrivateWorkerTask(worker.endpointUrl, taskId, worker.authToken)
      assertOwner()
      if (remote.ok && remote.task && !['failed', 'cancelled'].includes(remote.task.status)) {
        persistDownloadBatch([{ spec, backend: 'worker', options }])
        void pollWorkerTaskProgress(
          worker.endpointUrl,
          taskId,
          spec.fileName,
          spec.courseName,
          0,
          worker.storageMode === 'server_local',
          remote.task.targetPath || '',
          worker.authToken
        )
        return { ok: true, count: 1 }
      }
      if (!remote.ok && !/404|不存在|not found/i.test(remote.error || '')) throw Error(remote.error || '无法确认远端状态，未重复提交任务')
      await refresh()
      return await dispatchWorkerBatch([spec], options)
    }
    await refresh()
    if (task.backend === 'cloud') {
      const token = getCachedUserToken()
      if (!token) throw Error('请先连接交大云盘，上传将从头重新开始')
      spec = { ...spec, cloudUserToken: token, cloudDestRoot: options.cloudDestRoot ?? spec.cloudDestRoot }
      persistDownloadBatch([{ spec, backend: 'cloud', options }])
      pendingCloud.push(spec)
      pendingCloudIds.add(taskId)
      if (options.conflictStrategy) conflictStrategyByTask.set(taskId, options.conflictStrategy)
      registerTaskMeta(taskId, spec)
      emitProgress({ taskId, state: 'pending', received: 0, total: 0, message: '已恢复任务，将重新上传云盘' })
      cloudScheduleNext()
    } else {
      if (
        !task.filePath ||
        !task.partPath ||
        !options.localDestRoot ||
        !inside(options.localDestRoot, task.filePath) ||
        task.partPath !== task.filePath + '.part'
      )
        throw Error('保存位置校验失败，请从课程页面重新发起')
      const preserve = !spec.isHls && (!!spec.httpValidator || (await canvasVersionStillMatches(spec)))
      assertOwner()
      if (!preserve) {
        try {
          await unlink(task.partPath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      spec.resumeFromPartial = preserve
      assertOwner()
      persistDownloadBatch([{ spec, backend: 'local', options, paths: { filePath: task.filePath, partPath: task.partPath } }])
      pendingLocal.push({ spec, filePath: task.filePath, partPath: task.partPath })
      pendingLocalIds.add(taskId)
      if (options.conflictStrategy) conflictStrategyByTask.set(taskId, options.conflictStrategy)
      if (options.privateWorker?.enabled) workerConfigByTask.set(taskId, options.privateWorker)
      registerTaskMeta(taskId, spec)
      emitProgress({
        taskId,
        state: 'pending',
        received: preserve ? task.progress.received : 0,
        total: task.progress.total,
        message: preserve ? '已恢复，验证来源后继续下载' : '已恢复任务，将重新下载以确保文件完整'
      })
      scheduleNext()
    }
    return { ok: true, count: 1 }
  } catch (error) {
    task.progress.message = redactMessage(error instanceof Error ? error.message : String(error))
    store().scheduleFlush()
    return { ok: false, error: task.progress.message }
  } finally {
    recovering.delete(task.id)
    notifyBackupChanged()
  }
}

export function backupSnapshot(scope?: 'library' | 'transfers'): BackupSnapshot {
  const owner = currentBackupOwner()
  const subscriptions = Object.values(store().data.subscriptions).filter(s => s.owner === owner)
  const courseKeys = new Set(subscriptions.map(s => s.course.key))
  return {
    resources: scope === 'transfers' ? [] : Object.values(store().data.resources).filter(r => r.owner === owner && (scope !== 'library' || courseKeys.has(r.course.key))),
    recoverableTasks: scope === 'library' ? [] : Object.values(store().data.tasks)
      .filter(
        t =>
          t.owner === owner && (t.recovered || t.progress.state === 'error') && !['done', 'skipped', 'cancelled'].includes(t.progress.state)
      )
      .map(t => ({ ...t, encryptedUrl: undefined })),
    subscriptions: scope === 'transfers' ? [] : subscriptions,
    busySubscriptionIds: [...busy],
    storageError: store().storageError
  }
}

function trusted(event: IpcMainInvokeEvent): boolean {
  return validateIpcSender(event)
}
function checkedStrings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 5000 || value.some(v => typeof v !== 'string' || v.length > 300))
    throw Error('任务列表不合法')
  return [...new Set(value)]
}

export function initializeBackupService(): void {
  const catalog = new BackupCatalog(join(app.getPath('userData'), 'resource-catalog-v1.json'), value => {
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'))
      throw Error('系统加密不可用')
    return safeStorage.encryptString(value).toString('base64')
  })
  initializeBackupRuntime(
    catalog,
    () => {
      const id = getStudentId()
      return id ? digest(id) : ''
    },
    () => {
      if (notifyTimer) return
      notifyTimer = setTimeout(() => {
        notifyTimer = undefined
        getMainWindow()?.webContents.send('backup:changed')
      }, 300)
      notifyTimer.unref?.()
    }
  )
  setBackupRecoveryHandler(async id => {
    const tasksToRecover = [id, ...(!id.endsWith('_cloud') ? [id + '_cloud'] : [])]
      .map(taskId => catalog.data.tasks[`${currentBackupOwner()}:${taskId}`])
      .filter((t): t is BackupTask => !!t && !isLive(t.spec.taskId) && !['done', 'skipped', 'cancelled'].includes(t.progress.state))
    if (!tasksToRecover.length) return null
    for (const task of tasksToRecover) {
      const result = await recoverOne(task)
      if (!result.ok) return result
    }
    return { ok: true, count: tasksToRecover.length }
  })

  const handle = (name: string, fn: (...args: any[]) => unknown): void => {
    ipcMain.handle(`backup:${name}`, async (event, ...args: unknown[]) => {
      if (!trusted(event)) throw Error(DEFAULT_UNTRUSTED_IPC_ERROR)
      try {
        return await fn(...args)
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    })
  }
  handle('snapshot', backupSnapshot)
  handle('status', () => ({
    updateCourseCount: Object.values(catalog.data.subscriptions).filter(sub =>
      sub.owner === currentBackupOwner() && pendingSubscriptionResources(sub, Object.values(catalog.data.resources)).length > 0
    ).length,
    recoverableCount: Object.values(catalog.data.tasks).filter(
      t =>
        t.owner === currentBackupOwner() &&
        (t.recovered || t.progress.state === 'error') &&
        !['done', 'skipped', 'cancelled'].includes(t.progress.state)
    ).length,
    storageError: catalog.storageError
  }))
  handle('courses', async source => {
    if (!['canvas', 'cnmooc', 'audited'].includes(source)) throw Error('未知课程来源')
    await requireAccount()
    return { ok: true, courses: await listBackupCourses(source) }
  })
  handle('save-subscription', async (input: Parameters<BackupApi['saveSubscription']>[0]) => {
    const owner = await requireAccount()
    if (
      !input ||
      !input.course ||
      !['canvas', 'cnmooc', 'audited'].includes(input.course.source) ||
      !/^[\w-]{1,100}$/.test(input.course.id) ||
      typeof input.course.name !== 'string' ||
      input.course.name.length > 300 ||
      input.course.key !== `${input.course.source}:${input.course.id}`
    )
      throw Error('课程信息不合法')
    if (
      !input.selection ||
      (!input.selection.files && !input.selection.videos) ||
      !['teacher', 'ppt', 'all'].includes(input.selection.perspective)
    )
      throw Error('请选择要订阅的资源类型')
    if (input.course.source === 'audited' && !input.selection.videos) throw Error('旁听课程仅提供视频订阅')
    const options = input.options && { ...input.options }
    if (options && options.mode !== 'cloud' && !options.localDestRoot) options.localDestRoot = app.getPath('downloads')
    if (
      !options ||
      !['local', 'cloud', 'both'].includes(options.mode || '') ||
      (options.mode !== 'cloud' && (!options.localDestRoot || !isAbsolute(options.localDestRoot)))
    )
      throw Error('请在设置中选择有效的本地保存目录和保存模式')
    for (const value of [
      options.localDestRoot,
      options.cloudDestRoot,
      options.namingTemplate,
      options.privateWorker?.endpointUrl,
      options.privateWorker?.serverDownloadDir
    ]) {
      if (value !== undefined && (typeof value !== 'string' || value.length > 2048)) throw Error('保存配置不合法')
    }
    if (options.privateWorker?.enabled) {
      const endpoint = new URL(
        /^https?:\/\//i.test(options.privateWorker.endpointUrl)
          ? options.privateWorker.endpointUrl
          : `http://${options.privateWorker.endpointUrl}`
      )
      if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['http:', 'https:'].includes(endpoint.protocol))
        throw Error('中转地址不能包含密码、查询参数或片段，请将密钥保存在专用设置中')
      if (!['cloudpan', 'server_local'].includes(options.privateWorker.storageMode || 'cloudpan')) throw Error('未知中转存储模式')
      options.privateWorker.endpointUrl = endpoint.toString().replace(/\/+$/, '')
    }
    if (!Number.isFinite(input.intervalMinutes) || input.intervalMinutes < 5 || input.intervalMinutes > 10_080)
      throw Error('检查间隔应在 5 分钟至 7 天之间')
    if (Object.values(catalog.data.subscriptions).filter(s => s.owner === owner).length >= 100 && !input.id)
      throw Error('最多保存 100 个课程订阅')
    const old = input.id
      ? ownSubscription(input.id)
      : Object.values(catalog.data.subscriptions).find(s => s.owner === owner && s.course.key === input.course.key)
    if (old && busy.has(old.id)) throw Error('请等待本次检查完成后再修改订阅')
    catalog.saveSubscription({
      ...old,
      id: old?.id,
      owner,
      course: {
        key: input.course.key,
        id: input.course.id,
        name: input.course.name,
        source: input.course.source,
        term: typeof input.course.term === 'string' ? input.course.term.slice(0, 100) : undefined
      },
      selection: { files: !!input.selection.files, videos: !!input.selection.videos, perspective: input.selection.perspective },
      options: safeOptions(options),
      enabled: !!input.enabled,
      autoDownload: !!input.autoDownload,
      intervalMinutes: Math.floor(input.intervalMinutes),
      nextCheckAt: Date.now(),
      added: old?.added || 0,
      updated: old?.updated || 0
    })
    notifyBackupChanged()
    return { ok: true }
  })
  handle('remove-subscription', id => {
    const sub = ownSubscription(id)
    if (busy.has(sub.id)) throw Error('请等待本次检查完成后再移除订阅')
    delete catalog.data.subscriptions[sub.id]
    catalog.markDirty()
    catalog.flush()
    notifyBackupChanged()
    return { ok: true }
  })
  handle('check', id => checkSubscription(id))
  handle('fill', id => checkSubscription(id, true))
  handle('recover', async ids => {
    let count = 0
    const errors: string[] = []
    for (const id of checkedStrings(ids)) {
      const task = catalog.data.tasks[id]
      if (!task || task.owner !== currentBackupOwner() || ['done', 'skipped', 'cancelled'].includes(task.progress.state)) continue
      const result = await recoverOne(task)
      if (!result.ok) errors.push(result.error || '恢复失败')
      else count += result.count || 0
    }
    if (errors.length) return { ok: false, count, error: `已恢复 ${count} 项，${errors.length} 项未完成：${errors[0]}` }
    return { ok: true, count }
  })
  handle('dismiss', ids => {
    for (const id of checkedStrings(ids)) {
      const task = catalog.data.tasks[id]
      if (!task || task.owner !== currentBackupOwner() || isLive(task.spec.taskId)) continue
      task.progress.state = 'cancelled'
      task.recovered = false
    }
    catalog.markDirty()
    catalog.flush()
    notifyBackupChanged()
    return { ok: true }
  })
  handle('cancel-recovery', async ids => {
    let count = 0
    for (const id of checkedStrings(ids)) {
      const task = catalog.data.tasks[id]
      if (!task || task.owner !== currentBackupOwner() || ['done', 'skipped', 'cancelled'].includes(task.progress.state)) continue
      if (isLive(task.spec.taskId)) throw Error('任务已经运行，请在正在传输列表中取消')
      if (task.backend === 'worker') throw Error('请先恢复远端任务状态，再从传输列表取消')
      if (task.backend === 'local' && task.partPath) {
        const root = task.options.localDestRoot
        if (!root || task.partPath !== task.filePath + '.part' || !inside(root, task.partPath)) throw Error('分片保存位置校验失败')
        try {
          const [realRoot, realParent] = await Promise.all([realpath(root), realpath(dirname(task.partPath))])
          if (!inside(realRoot, realParent)) throw Error('分片目录指向保存目录之外，未清理文件')
          await unlink(task.partPath)
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
      task.progress = { ...task.progress, state: 'cancelled', message: '已取消，未完成分片已清理' }
      task.recovered = false
      count++
    }
    catalog.markDirty()
    catalog.flush()
    notifyBackupChanged()
    return { ok: true, count }
  })
  handle('verify', async () => ({ ok: true, count: await verifyCopies(backupSnapshot().resources) }))
  handle('open-copy', async (resourceId, copyKey) => {
    const resource = catalog.data.resources[resourceId]
    const copy = resource?.owner === currentBackupOwner() ? resource.copies.find(c => c.key === copyKey) : undefined
    if (!copy?.filePath || copy.backend !== 'local') throw Error('此副本不在本机，请在云盘或远端服务器查看')
    await stat(copy.filePath)
    shell.showItemInFolder(copy.filePath)
    return { ok: true }
  })
  const startupOwners = new Set<string>()
  timer = setInterval(() => {
    if (getIsQuitting() || busy.size) return
    const owner = currentBackupOwner()
    if (owner === 'unidentified') return
    if (!startupOwners.has(owner)) {
      startupOwners.add(owner)
      for (const sub of Object.values(catalog.data.subscriptions)) {
        if (sub.owner !== owner) continue
        // A favourite checks for updates; starting the app never starts a download.
        sub.autoDownload = false
        sub.intervalMinutes = 30
        if (sub.enabled) sub.nextCheckAt = Date.now()
      }
      catalog.scheduleFlush()
    }
    const next = Object.values(catalog.data.subscriptions).find(s => s.owner === owner && s.enabled && s.nextCheckAt <= Date.now())
    if (next) void checkSubscription(next.id).catch(() => {})
  }, 5_000)
  timer.unref?.()
}

export function stopBackupService(): void {
  if (timer) clearInterval(timer)
  if (notifyTimer) clearTimeout(notifyTimer)
  timer = undefined
  notifyTimer = undefined
  clearBackupSourceCaches()
}
