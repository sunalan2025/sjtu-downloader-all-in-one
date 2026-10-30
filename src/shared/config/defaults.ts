import type { DownloadMode, FileConflictStrategy, VideoQualityOption, VideoPerspective, PrivateWorkerStorageMode } from '../types'

export interface AppDefaultsConfig {
  concurrency: number
  maxDownloadSpeedKBps: number
  downloadMode: DownloadMode
  fileConflictStrategy: FileConflictStrategy
  windowCloseAction: 'tray' | 'taskbar' | 'quit'
  exitWhenDownloadingPolicy: 'prompt' | 'background' | 'pause_quit' | 'save_quit'
  videoQualityOption: VideoQualityOption
  videoPerspectivePreference: VideoPerspective
  defaultLocalDestRoot: string
  defaultCloudDestRoot: string
  defaultNamingTemplate: string
  courseViewMode: 'grid' | 'list' | 'column'
  privateWorker: {
    enabled: boolean
    endpointUrl: string
    authToken: string
    storageMode: PrivateWorkerStorageMode
    serverDownloadDir: string
  }
}

export const APP_DEFAULTS: AppDefaultsConfig = {
  concurrency: 3,
  maxDownloadSpeedKBps: 0,
  downloadMode: 'local',
  fileConflictStrategy: 'skip',
  windowCloseAction: 'tray',
  exitWhenDownloadingPolicy: 'prompt',
  videoQualityOption: 'origin',
  videoPerspectivePreference: 'teacher',
  defaultLocalDestRoot: 'SJTU课程',
  defaultCloudDestRoot: '/SJTU课程备份',
  defaultNamingTemplate: '{course}/{category}/{title}.{ext}',
  courseViewMode: 'grid',
  privateWorker: {
    enabled: false,
    endpointUrl: 'http://127.0.0.1:6880',
    authToken: '',
    storageMode: 'cloudpan',
    serverDownloadDir: '~/downloads'
  }
}
