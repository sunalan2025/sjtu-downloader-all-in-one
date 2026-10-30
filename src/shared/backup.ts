import type {
  CanvasDownloadTaskSpec,
  DownloadMode,
  DownloadProgress,
  DownloadTaskSpec,
  FileConflictStrategy,
  PrivateWorkerConfig
} from './types'

export type BackupSource = 'canvas' | 'cnmooc' | 'audited'
export type BackupBackend = 'local' | 'cloud' | 'worker'

export interface DownloadOptions {
  mode?: DownloadMode
  localDestRoot?: string
  conflictStrategy?: FileConflictStrategy
  namingTemplate?: string
  cloudDestRoot?: string
  privateWorker?: PrivateWorkerConfig
}

export interface BackupCourse {
  key: string
  source: BackupSource
  id: string
  name: string
  term?: string
}

export interface BackupSelection {
  files: boolean
  videos: boolean
  perspective: 'teacher' | 'ppt' | 'all'
}

export interface BackupCandidate {
  spec: DownloadTaskSpec | CanvasDownloadTaskSpec
  version: string
  size?: number
  course: BackupCourse
}

export interface BackupCopy {
  key: string
  backend: BackupBackend
  version: string
  filePath?: string
  cloudPath?: string
  endpoint?: string
  target?: string
  size?: number
  status: 'present' | 'missing' | 'changed' | 'unknown'
  completedAt: number
  checkedAt?: number
}

/** Stored specs never contain session tokens or signed URLs. */
export interface BackupResource {
  id: string
  owner: string
  course: BackupCourse
  spec: DownloadTaskSpec | CanvasDownloadTaskSpec
  version: string
  size?: number
  discoveredAt: number
  lastSeenAt: number
  copies: BackupCopy[]
  excludedReason?: string
}

export interface BackupTask {
  id: string
  owner: string
  resourceId: string
  version: string
  spec: DownloadTaskSpec | CanvasDownloadTaskSpec
  /** Only non-refreshable URLs are stored, encrypted by the OS credential service. */
  encryptedUrl?: string
  recoveryWarning?: string
  backend: BackupBackend
  options: DownloadOptions
  filePath?: string
  partPath?: string
  progress: DownloadProgress
  createdAt: number
  updatedAt: number
  recovered?: boolean
}

export interface CourseSubscription {
  id: string
  owner: string
  course: BackupCourse
  selection: BackupSelection
  options: DownloadOptions
  enabled: boolean
  autoDownload: boolean
  intervalMinutes: number
  lastCheckedAt?: number
  nextCheckAt: number
  lastError?: string
  warning?: string
  added: number
  updated: number
}

export interface BackupSnapshot {
  resources: BackupResource[]
  recoverableTasks: BackupTask[]
  subscriptions: CourseSubscription[]
  busySubscriptionIds: string[]
  storageError?: string
}

export interface BackupResult {
  ok: boolean
  error?: string
  count?: number
}

export interface BackupApi {
  status: () => Promise<{ recoverableCount: number; updateCourseCount?: number; storageError?: string }>
  snapshot: (scope?: 'library' | 'transfers') => Promise<BackupSnapshot>
  courses: (source: BackupSource) => Promise<{ ok: boolean; courses?: BackupCourse[]; error?: string }>
  saveSubscription: (input: {
    id?: string
    course: BackupCourse
    selection: BackupSelection
    options: DownloadOptions
    enabled: boolean
    autoDownload: boolean
    intervalMinutes: number
  }) => Promise<BackupResult>
  removeSubscription: (id: string) => Promise<BackupResult>
  checkSubscription: (id: string) => Promise<BackupResult>
  fillMissing: (id: string) => Promise<BackupResult>
  recover: (taskIds: string[]) => Promise<BackupResult>
  dismissRecovery: (taskIds: string[]) => Promise<BackupResult>
  cancelRecovery: (taskIds: string[]) => Promise<BackupResult>
  verifyLocal: () => Promise<BackupResult>
  openCopy: (resourceId: string, copyKey: string) => Promise<BackupResult>
  onChanged: (cb: () => void) => () => void
}

export function pendingSubscriptionResources(sub: CourseSubscription, resources: BackupResource[]): BackupResource[] {
  return resources.filter(resource =>
    resource.course.key === sub.course.key && resource.owner === sub.owner &&
    (!sub.lastCheckedAt || resource.lastSeenAt >= sub.lastCheckedAt) && !resource.excludedReason &&
    !resource.copies.some(copy => copy.version === resource.version && copy.status === 'present')
  )
}
