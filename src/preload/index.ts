import { contextBridge, ipcRenderer } from 'electron'
import type {
  ApiEnvelope,
  AuditCourseDetail,
  AuditCourseItem,
  AuthStatus,
  CloudPanSpaceInfo,
  DownloadMode,
  DownloadProgress,
  DownloadTaskSpec,
  PageResult
} from '../shared/types'

const api = {
  setTheme: (theme: 'dark' | 'light'): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('app:set-theme', theme),
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('app:select-folder'),
  auth: {
    status: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:status'),
    logout: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:logout'),
    setJwtToken: (token: string | null): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('auth:set-jwt-token', token)
  },
  vsjtu: {
    scanAudit: (
      pageNo = 1,
      pageSize = 100
    ): Promise<ApiEnvelope<PageResult<AuditCourseItem>>> =>
      ipcRenderer.invoke('vsjtu:scan-audit', pageNo, pageSize),
    auditCourseDetail: (resourceId: number): Promise<ApiEnvelope<AuditCourseDetail>> =>
      ipcRenderer.invoke('vsjtu:audit-course-detail', resourceId)
  },
  download: {
    start: (destRoot: string, tasks: DownloadTaskSpec[], options?: { mode?: DownloadMode; localDestRoot?: string }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('download:start', destRoot, tasks, options),
    pause: (taskId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('download:pause', taskId),
    cancel: (taskId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('download:cancel', taskId),
    resume: (taskId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('download:resume', taskId),
    pauseAll: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('download:pause-all'),
    cancelAll: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('download:cancel-all'),
    resumeAll: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('download:resume-all'),
    setConcurrency: (n: number): Promise<{ ok: boolean; concurrency: number }> =>
      ipcRenderer.invoke('download:set-concurrency', n),
    onProgress: (cb: (p: DownloadProgress) => void): (() => void) => {
      const listener = (_: unknown, p: DownloadProgress): void => cb(p)
      ipcRenderer.on('download:progress', listener)
      return () => ipcRenderer.removeListener('download:progress', listener)
    }
  },
  cloudpan: {
    getCachedToken: (): Promise<string | null> =>
      ipcRenderer.invoke('cloudpan:get-cached-token'),
    validateToken: (userToken: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('cloudpan:validate-token', userToken),
    spaceInfo: (
      userToken: string
    ): Promise<{ ok: boolean; info?: CloudPanSpaceInfo; error?: string }> =>
      ipcRenderer.invoke('cloudpan:space-info', userToken),
    directLogin: (): Promise<{ ok: boolean; userToken?: string; error?: string }> =>
      ipcRenderer.invoke('cloudpan:direct-login'),
    logout: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('cloudpan:logout')
  }
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (err) {
  console.error('[preload] contextBridge failed:', err)
}

export type ExposedApi = typeof api
