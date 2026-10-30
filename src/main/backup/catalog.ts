import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CanvasDownloadTaskSpec, DownloadProgress, DownloadTaskSpec } from '../../shared/types'
import type {
  BackupBackend,
  BackupCandidate,
  BackupCopy,
  BackupCourse,
  BackupResource,
  BackupTask,
  CourseSubscription,
  DownloadOptions
} from '../../shared/backup'
import { redactMessage, workerTarget } from './planning'

interface CatalogData {
  schemaVersion: 1
  resources: Record<string, BackupResource>
  tasks: Record<string, BackupTask>
  subscriptions: Record<string, CourseSubscription>
}

export const digest = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24)
const isFinished = (state: string): boolean => ['done', 'skipped', 'cancelled'].includes(state)
const emptyData = (): CatalogData => ({ schemaVersion: 1, resources: {}, tasks: {}, subscriptions: {} })

export function canRefreshSpec(spec: DownloadTaskSpec): boolean {
  const s = spec as CanvasDownloadTaskSpec
  const source = s.source as string | undefined
  return !!(
    s.refId ||
    (source === 'canvas-files' && (s.rawFileId || /_\d+$/.test(s.taskId.replace(/_cloud$/, '')))) ||
    (source === 'cloudpan' && s.cloudRemotePath) ||
    (source === 'cnmooc' && s.cnmoocItemId) ||
    (source === 'canvas-class-video' && s.canvasVideoId && s.canvasCourseId) ||
    (source === 'canvas-video' && s.canvasVideoId) ||
    (source === 'canvas-exttool-video' && s.canvasFileId && s.canvasModuleItemId && s.canvasCourseId) ||
    (source === 'canvas-exturl-video' && s.canvasVshareUuid)
  )
}

export function safeSpec(spec: DownloadTaskSpec): DownloadTaskSpec | CanvasDownloadTaskSpec {
  const allowed = [
    'taskId',
    'courseName',
    'term',
    'fileName',
    'refId',
    'angle',
    'isHls',
    'extractAudio',
    'category',
    'source',
    'rawFileId',
    'courseId',
    'cloudRemotePath',
    'cloudDestRoot',
    'destRelPath',
    'fileSize',
    'categoryName',
    'canvasCourseId',
    'canvasRelPath',
    'canvasVideoId',
    'canvasStreamIdx',
    'canvasModuleItemId',
    'canvasFileId',
    'canvasVshareUuid',
    'cnmoocItemId',
    'cnmoocItemType',
    'cnmoocChapter',
    'cnmoocResourceFilter',
    'resourceVersion',
    'resourceSize',
    'backupCourse',
    'httpValidator'
  ]
  const result: Record<string, unknown> = { url: '' }
  for (const key of allowed) {
    if (Object.hasOwn(spec, key)) result[key] = (spec as unknown as Record<string, unknown>)[key]
  }
  return JSON.parse(JSON.stringify(result)) as DownloadTaskSpec
}

export function safeOptions(options: DownloadOptions): DownloadOptions {
  const clean = {
    mode: options.mode,
    localDestRoot: options.localDestRoot,
    conflictStrategy: options.conflictStrategy,
    namingTemplate: options.namingTemplate,
    cloudDestRoot: options.cloudDestRoot,
    privateWorker: options.privateWorker
      ? {
          enabled: options.privateWorker.enabled,
          endpointUrl: options.privateWorker.endpointUrl,
          authToken: '',
          storageMode: options.privateWorker.storageMode,
          serverDownloadDir: options.privateWorker.serverDownloadDir,
          tunnel: options.privateWorker.tunnel
            ? {
                enabled: options.privateWorker.tunnel.enabled,
                host: options.privateWorker.tunnel.host,
                remotePort: options.privateWorker.tunnel.remotePort,
                localPort: options.privateWorker.tunnel.localPort
              }
            : undefined
        }
      : undefined
  }
  return JSON.parse(JSON.stringify(clean)) as DownloadOptions
}

export function resourceIdentity(owner: string, spec: DownloadTaskSpec): string {
  const s = spec as CanvasDownloadTaskSpec
  let sourceId: string | number = s.taskId.replace(/_cloud$/, '')
  if (s.source === 'canvas-files')
    sourceId =
      s.rawFileId ||
      s.taskId
        .replace(/_cloud$/, '')
        .split('_')
        .at(-1) ||
      sourceId
  else if (s.cnmoocItemId) sourceId = s.cnmoocItemId
  else if (s.canvasVideoId) sourceId = `${s.canvasVideoId}:${s.canvasStreamIdx ?? 0}`
  else if (s.canvasFileId) sourceId = s.canvasFileId
  else if (s.canvasVshareUuid) sourceId = s.canvasVshareUuid
  else if (s.refId) sourceId = `${s.refId}:${s.angle ?? 0}`
  else if (s.cloudRemotePath) sourceId = Array.isArray(s.cloudRemotePath) ? s.cloudRemotePath.join('/') : s.cloudRemotePath
  return digest(JSON.stringify([owner, s.source || 'audited', sourceId, !!s.extractAudio]))
}

export function inferCourse(spec: DownloadTaskSpec): BackupCourse {
  if (spec.backupCourse) return spec.backupCourse
  const s = spec as CanvasDownloadTaskSpec
  const source = s.source?.startsWith('canvas') ? 'canvas' : s.source === 'cnmooc' ? 'cnmooc' : 'audited'
  const id = String(s.canvasCourseId || s.courseId || s.courseName)
  return { key: `${source}:${id}`, id, source, name: s.courseName, term: s.term }
}

/** Main-process, single-writer catalog. State transitions are persisted before work is admitted. */
export class BackupCatalog {
  data: CatalogData = emptyData()
  storageError?: string
  private readOnly = false
  private dirty = false
  private timer?: ReturnType<typeof setTimeout>
  private flushDueAt = 0

  constructor(
    readonly path: string,
    private readonly encrypt: (value: string) => string = () => {
      throw Error('系统加密不可用')
    }
  ) {
    if (!existsSync(path)) return
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as CatalogData
      if (
        parsed.schemaVersion !== 1 ||
        !parsed.resources ||
        !parsed.tasks ||
        !parsed.subscriptions ||
        Array.isArray(parsed.resources) ||
        Array.isArray(parsed.tasks) ||
        Array.isArray(parsed.subscriptions)
      )
        throw Error('不支持的资源清单格式')
      this.data = parsed
      for (const r of Object.values(parsed.resources)) {
        if (
          !r?.id ||
          !r.owner ||
          !r.course?.key ||
          !r.spec?.taskId ||
          !r.version ||
          !Array.isArray(r.copies) ||
          r.copies.some(c => !c?.key || !c.version)
        )
          throw Error('资源记录不完整')
      }
      for (const s of Object.values(parsed.subscriptions)) {
        if (
          !s?.id ||
          !s.owner ||
          !s.course?.key ||
          !s.options ||
          !s.selection ||
          !Number.isFinite(s.intervalMinutes) ||
          s.intervalMinutes < 5
        )
          throw Error('订阅记录不完整')
      }
      for (const t of Object.values(this.data.tasks)) {
        if (
          !t?.spec?.taskId ||
          !t.progress ||
          !t.options ||
          !t.owner ||
          !this.data.resources[t.resourceId] ||
          !['local', 'cloud', 'worker'].includes(t.backend)
        )
          throw Error('任务记录不完整')
        if (!isFinished(t.progress.state)) {
          t.recovered = true
          t.progress.state = 'paused'
          t.progress.message = t.backend === 'worker' ? '上次任务：请检查远端状态' : '上次任务已保留，点击继续恢复'
        }
      }
    } catch (error) {
      // Preserve the original file instead of silently overwriting a damaged/newer catalog.
      this.storageError = `资源清单无法读取，原文件已保留：${error instanceof Error ? error.message : String(error)}`
      this.data = emptyData()
      this.readOnly = true
    }
  }

  markDirty(): void {
    this.dirty = true
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.readOnly) throw Error(this.storageError)
    if (!this.dirty) return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.tmp`
      const fd = openSync(temporary, 'w', 0o600)
      try {
        writeFileSync(fd, JSON.stringify(this.data))
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(temporary, this.path)
      this.dirty = false
      this.storageError = undefined
    } catch (error) {
      this.storageError = `无法保存资源清单：${error instanceof Error ? error.message : String(error)}`
      throw error
    }
  }

  scheduleFlush(delay = 1000): void {
    this.dirty = true
    if (this.readOnly) return
    const due = Date.now() + delay
    if (this.timer && this.flushDueAt <= due) return
    if (this.timer) clearTimeout(this.timer)
    this.flushDueAt = due
    this.timer = setTimeout(() => {
      this.timer = undefined
      try {
        this.flush()
      } catch {
        /* surfaced in snapshot */
      }
    }, delay)
    this.timer.unref?.()
  }

  discover(owner: string, candidate: BackupCandidate): { resource: BackupResource; change: 'new' | 'updated' | 'same' } {
    const id = resourceIdentity(owner, candidate.spec)
    const old = this.data.resources[id]
    const change = !old ? 'new' : old.version !== candidate.version ? 'updated' : 'same'
    const resource: BackupResource = {
      id,
      owner,
      course: candidate.course,
      spec: safeSpec(candidate.spec),
      version: candidate.version,
      size: candidate.size,
      discoveredAt: old?.discoveredAt ?? Date.now(),
      lastSeenAt: Date.now(),
      copies: old?.copies ?? [],
      excludedReason:
        change === 'same' &&
        (old?.spec as CanvasDownloadTaskSpec)?.cnmoocResourceFilter === (candidate.spec as CanvasDownloadTaskSpec).cnmoocResourceFilter
          ? old?.excludedReason
          : undefined
    }
    this.data.resources[id] = resource
    this.markDirty()
    return { resource, change }
  }

  admit(
    owner: string,
    spec: DownloadTaskSpec,
    backend: BackupBackend,
    options: DownloadOptions,
    paths?: { filePath: string; partPath: string }
  ): BackupTask {
    if (this.readOnly) throw Error(this.storageError)
    const resourceId = resourceIdentity(owner, spec)
    const oldResource = this.data.resources[resourceId]
    const version = spec.resourceVersion || oldResource?.version || digest(JSON.stringify([spec.fileName, spec.resourceSize ?? null]))
    if (!oldResource || (spec.resourceVersion && spec.resourceVersion !== oldResource.version))
      this.discover(owner, { course: inferCourse(spec), spec, version, size: spec.resourceSize })
    const id = `${owner}:${spec.taskId}`
    const old = this.data.tasks[id]
    const task: BackupTask = {
      id,
      owner,
      resourceId,
      version,
      spec: safeSpec(spec),
      backend,
      options: safeOptions(options),
      ...paths,
      progress: { taskId: spec.taskId, state: 'pending', received: 0, total: 0, fileName: spec.fileName, courseName: spec.courseName },
      createdAt: old?.createdAt ?? Date.now(),
      updatedAt: Date.now()
    }
    if (!canRefreshSpec(spec)) {
      if (spec.url) {
        try {
          task.encryptedUrl = this.encrypt(spec.url)
        } catch {
          task.recoveryWarning = '系统加密不可用，重启后需从课程页面重新发起此资源'
        }
      } else if (old?.encryptedUrl) task.encryptedUrl = old.encryptedUrl
      else task.recoveryWarning = '此任务缺少可恢复的资源标识，请从课程页面重新发起'
    }
    this.data.tasks[id] = task
    this.markDirty()
    return task
  }

  progress(owner: string, progress: DownloadProgress): void {
    const task = this.data.tasks[`${owner}:${progress.taskId}`]
    if (!task) return
    task.progress = { ...task.progress, ...progress }
    if (task.progress.message) task.progress.message = redactMessage(task.progress.message)
    task.updatedAt = Date.now()
    task.recovered = false
    if (progress.filePath) task.filePath = progress.filePath
    const resource = this.data.resources[task.resourceId]
    if (resource && progress.state === 'skipped' && !progress.filePath && !progress.cloudPath && /类型|过滤/.test(progress.message || '')) {
      resource.excludedReason = progress.message
    }
    if (resource && (progress.state === 'done' || progress.state === 'skipped') && (progress.filePath || progress.cloudPath)) {
      const path = progress.filePath || progress.cloudPath!
      const target = task.backend === 'worker' ? workerTarget(task.options) : undefined
      const key = digest(JSON.stringify([task.backend, target || '', path]))
      const previous = resource.copies.find(c => c.key === key)
      // An existing filename alone cannot prove it contains the latest source revision.
      const version = progress.state === 'skipped' ? previous?.version || 'unverified' : task.version
      const copy: BackupCopy = {
        key,
        target,
        backend: task.backend,
        version,
        filePath: task.backend === 'local' ? progress.filePath : undefined,
        cloudPath: progress.cloudPath || (task.backend === 'worker' ? progress.filePath : undefined),
        endpoint: task.options.privateWorker?.endpointUrl,
        size: progress.total || progress.received || undefined,
        status: version === 'unverified' ? 'unknown' : 'present',
        completedAt: Date.now(),
        checkedAt: undefined as number | undefined
      }
      if (copy.filePath) {
        try {
          copy.size = statSync(copy.filePath).size
          copy.checkedAt = Date.now()
        } catch {
          copy.status = 'unknown'
        }
      }
      resource.copies = [...resource.copies.filter(c => c.key !== key), copy]
    }
    // Byte counters change frequently. Durable admission plus the .part file preserves
    // recovery; write counters at most every 10 s, but persist state changes promptly.
    this.scheduleFlush(progress.state === 'downloading' ? 10_000 : 1000)
  }

  updateRuntime(owner: string, spec: DownloadTaskSpec, filePath?: string, partPath?: string): void {
    const task = this.data.tasks[`${owner}:${spec.taskId}`]
    if (!task) return
    task.spec = safeSpec(spec)
    if (filePath) task.filePath = filePath
    if (partPath) task.partPath = partPath
    this.scheduleFlush()
  }

  saveSubscription(subscription: Omit<CourseSubscription, 'id'> & { id?: string }): CourseSubscription {
    const next = { ...subscription, id: subscription.id || randomUUID() }
    this.data.subscriptions[next.id] = next
    this.markDirty()
    this.flush()
    return next
  }

  protectedPaths(): string[] {
    return [
      ...Object.values(this.data.tasks).flatMap(t =>
        [t.filePath, !isFinished(t.progress.state) ? t.partPath : undefined].filter((p): p is string => !!p)
      ),
      ...Object.values(this.data.resources).flatMap(r => r.copies.flatMap(c => (c.backend === 'local' && c.filePath ? [c.filePath] : [])))
    ]
  }
}
