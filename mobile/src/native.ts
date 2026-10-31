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

export type CalendarEvent = {
  id: string
  title: string
  startTime: string
  endTime: string
  courseName: string
  type: 'assignment' | 'event'
}

export type NativeInsets = { top: number; bottom: number; left: number; right: number }

export type CourseDownloadItem = { file: CanvasFile; courseName: string; term: string }

export type DownloadProgress = {
  taskId: string
  bytes: number
  total: number
  fileName: string
}

type NativeCanvasApi = {
  login(): Promise<{ completed: boolean }>
  getInsets(): Promise<NativeInsets>
  calendar(options: { month: string }): Promise<{ items: CalendarEvent[]; warning?: string; authRequired?: boolean }>
  openOfficialCalendar(): Promise<{ ok: boolean }>
  status(): Promise<{ loggedIn: boolean; name?: string }>
  courses(): Promise<{ items: CanvasCourse[] }>
  files(options: { courseId: string }): Promise<{ items: CanvasFile[] }>
  download(options: { fileId: string; taskId: string; courseName?: string; term?: string }): Promise<{ uri: string; fileName: string }>
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
