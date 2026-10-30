import type { StateCreator } from 'zustand'
import type {
  CanvasAssignmentExportOptions,
  VideoQualityOption,
  VideoPerspective,
  PrivateWorkerConfig,
  PrivateWorkerTunnelConfig
} from '@shared/types'
import { DEFAULT_NAMING_TEMPLATE } from '@shared/utils'
import { APP_DEFAULTS } from '@shared/config/defaults'
import type { AppState } from '../app'

export type Theme = 'light' | 'dark' | 'system'
export type WindowCloseAction = 'tray' | 'taskbar' | 'quit'
export type ExitWhenDownloadingPolicy = 'prompt' | 'background' | 'pause_quit' | 'save_quit'
export type CourseViewMode = 'grid' | 'list' | 'column'

export interface SettingsSlice {
  theme: Theme
  courseViewMode: CourseViewMode
  windowCloseAction: WindowCloseAction
  exitWhenDownloading: ExitWhenDownloadingPolicy
  hasCompletedInitialSetup: boolean
  lastSetupVersion: string | null
  showSetupWizardModal: boolean
  autoDownloadUpdate: boolean
  pptSaveImages: boolean
  canvasExportAiTranscript: boolean
  canvasExportSrt: boolean
  canvasExportMarkdown: boolean
  canvasAssignmentOptions: CanvasAssignmentExportOptions
  privateWorkerConfig: PrivateWorkerConfig
  namingTemplate: string
  videoQualityOption: VideoQualityOption
  videoPerspectivePreference: VideoPerspective
  autoExportPptPdf: boolean
  hlsTranscodeMaxHeight?: 720 | 1080

  setTheme: (t: Theme) => void
  setCourseViewMode: (mode: CourseViewMode) => void
  setWindowCloseAction: (action: WindowCloseAction) => void
  setExitWhenDownloading: (policy: ExitWhenDownloadingPolicy) => void
  setHasCompletedInitialSetup: (completed: boolean) => void
  setLastSetupVersion: (version: string | null) => void
  setShowSetupWizardModal: (show: boolean) => void
  setAutoDownloadUpdate: (on: boolean) => void
  setPptSaveImages: (on: boolean) => void
  setCanvasExportAiTranscript: (on: boolean) => void
  setCanvasExportSrt: (on: boolean) => void
  setCanvasExportMarkdown: (on: boolean) => void
  setCanvasAssignmentOptions: (
    opts:
      | Partial<CanvasAssignmentExportOptions>
      | ((prev: CanvasAssignmentExportOptions) => CanvasAssignmentExportOptions)
  ) => void
  setPrivateWorkerConfig: (
    cfg: Partial<Omit<PrivateWorkerConfig, 'tunnel'>> & {
      tunnel?: Partial<PrivateWorkerTunnelConfig>
    }
  ) => void
  setNamingTemplate: (t: string) => void
  setVideoQualityOption: (q: VideoQualityOption) => void
  setVideoPerspectivePreference: (p: VideoPerspective) => void
  setAutoExportPptPdf: (on: boolean) => void
  setHlsTranscodeMaxHeight: (h?: 720 | 1080) => void
}

export const createSettingsSlice: StateCreator<AppState, [], [], SettingsSlice> = set => ({
  theme: 'system',
  courseViewMode: APP_DEFAULTS.courseViewMode,
  windowCloseAction: APP_DEFAULTS.windowCloseAction,
  exitWhenDownloading: APP_DEFAULTS.exitWhenDownloadingPolicy,
  hasCompletedInitialSetup: false,
  lastSetupVersion: null,
  showSetupWizardModal: false,
  autoDownloadUpdate: false,
  pptSaveImages: false,
  canvasExportAiTranscript: true,
  canvasExportSrt: true,
  canvasExportMarkdown: true,
  canvasAssignmentOptions: {
    exportMarkdown: true,
    downloadAttachments: true,
    downloadSubmissions: true
  },
  privateWorkerConfig: {
    ...APP_DEFAULTS.privateWorker,
    tunnel: {
      enabled: false,
      host: '',
      remotePort: 6880,
      localPort: 6880
    }
  },
  namingTemplate: DEFAULT_NAMING_TEMPLATE,
  videoQualityOption: APP_DEFAULTS.videoQualityOption,
  videoPerspectivePreference: APP_DEFAULTS.videoPerspectivePreference,
  autoExportPptPdf: true,

  setTheme: theme => set({ theme }),
  setCourseViewMode: courseViewMode => set({ courseViewMode }),
  setWindowCloseAction: windowCloseAction => set({ windowCloseAction }),
  setExitWhenDownloading: exitWhenDownloading => set({ exitWhenDownloading }),
  setHasCompletedInitialSetup: hasCompletedInitialSetup => set({ hasCompletedInitialSetup }),
  setLastSetupVersion: lastSetupVersion => set({ lastSetupVersion }),
  setShowSetupWizardModal: showSetupWizardModal => set({ showSetupWizardModal }),
  setAutoDownloadUpdate: autoDownloadUpdate => set({ autoDownloadUpdate }),
  setPptSaveImages: pptSaveImages => set({ pptSaveImages }),
  setCanvasExportAiTranscript: canvasExportAiTranscript =>
    set({
      canvasExportAiTranscript,
      canvasExportSrt: canvasExportAiTranscript,
      canvasExportMarkdown: canvasExportAiTranscript
    }),
  setCanvasExportSrt: on =>
    set(state => ({
      canvasExportSrt: on,
      canvasExportAiTranscript: on || state.canvasExportMarkdown
    })),
  setCanvasExportMarkdown: on =>
    set(state => ({
      canvasExportMarkdown: on,
      canvasExportAiTranscript: state.canvasExportSrt || on
    })),
  setCanvasAssignmentOptions: opts =>
    set(state => ({
      canvasAssignmentOptions:
        typeof opts === 'function'
          ? opts(state.canvasAssignmentOptions)
          : { ...state.canvasAssignmentOptions, ...opts }
    })),
  setPrivateWorkerConfig: cfg => {
    if (cfg.authToken !== undefined && typeof window !== 'undefined' && window.api?.credentials?.saveWorkerToken) {
      void window.api.credentials.saveWorkerToken(cfg.authToken).catch(() => {})
    }
    return set(state => {
      const { tunnel: cfgTunnel, ...cfgRest } = cfg
      const currentTunnel = state.privateWorkerConfig?.tunnel ?? {
        enabled: false,
        host: '',
        remotePort: 6880,
        localPort: 6880
      }
      const updatedTunnel: PrivateWorkerTunnelConfig =
        cfgTunnel !== undefined
          ? {
              enabled: cfgTunnel.enabled ?? currentTunnel.enabled,
              host: cfgTunnel.host ?? currentTunnel.host,
              remotePort: cfgTunnel.remotePort ?? currentTunnel.remotePort,
              localPort: cfgTunnel.localPort ?? currentTunnel.localPort
            }
          : currentTunnel

      return {
        privateWorkerConfig: {
          ...state.privateWorkerConfig,
          ...cfgRest,
          tunnel: updatedTunnel
        }
      }
    })
  },
  setNamingTemplate: namingTemplate => set({ namingTemplate }),
  setVideoQualityOption: videoQualityOption => set({ videoQualityOption }),
  setVideoPerspectivePreference: p =>
    set(state => ({
      videoPerspectivePreference: p,
      videoQualityOption:
        p === 'audio'
          ? 'audio_only'
          : state.videoQualityOption === 'audio_only'
            ? APP_DEFAULTS.videoQualityOption
            : state.videoQualityOption
    })),
  setAutoExportPptPdf: autoExportPptPdf => set({ autoExportPptPdf }),
  setHlsTranscodeMaxHeight: hlsTranscodeMaxHeight => set({ hlsTranscodeMaxHeight })
})
