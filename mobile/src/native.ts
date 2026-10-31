import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export type CanvasCourse = {
  id: string
  name: string
  code: string
  term: string
}

export type CanvasFile = {
  id: string
  name: string
  size: number
  contentType: string
  locked: boolean
}

export type DownloadProgress = {
  taskId: string
  bytes: number
  total: number
  fileName: string
}

type NativeCanvasApi = {
  login(): Promise<{ completed: boolean }>
  status(): Promise<{ loggedIn: boolean; name?: string }>
  courses(): Promise<{ items: CanvasCourse[] }>
  files(options: { courseId: string }): Promise<{ items: CanvasFile[] }>
  download(options: { fileId: string; taskId: string }): Promise<{ uri: string; fileName: string }>
  cancelDownload(options: { taskId: string }): Promise<{ ok: boolean }>
  logout(): Promise<{ ok: boolean }>
  addListener(
    eventName: 'downloadProgress',
    listener: (event: DownloadProgress) => void
  ): Promise<PluginListenerHandle>
}

const native = registerPlugin<NativeCanvasApi>('SjtuCanvas')
export const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
export default native
