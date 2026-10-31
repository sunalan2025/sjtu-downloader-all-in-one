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
  location?: string
  type: 'assignment' | 'event' | 'course'
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
  calendar(options: { month: string }): Promise<{ items: CalendarEvent[]; warning?: string; authRequired?: boolean; officialConnected?: boolean }>
  calendarWeek(options: { weekStart: string }): Promise<{ items: CalendarEvent[]; warning?: string; authRequired?: boolean; officialConnected?: boolean; needsSupplement: boolean }>
  calendarWeekSupplement(options: { weekStart: string }): Promise<{ items: CalendarEvent[] }>
  openOfficialCalendar(): Promise<{ ok: boolean }>
  diagnoseAuth(): Promise<{ savedSessionEncrypted: boolean; canvasCookie: boolean; jaccountCookie: boolean; officialCalendarCookie: boolean; canvasProfile: string; canvasCalendar: string; canvasCourses: string; officialCalendar: string }>
  status(): Promise<{ loggedIn: boolean; name?: string; savedSessionEncrypted?: boolean }>
  courses(): Promise<{ items: CanvasCourse[] }>
  files(options: { courseId: string }): Promise<{ items: CanvasFile[] }>
  download(options: { fileId: string; taskId: string; courseName?: string; term?: string }): Promise<{
    uri: string; fileName: string; savedPath: string; publicDownload: boolean
  }>
  openDownloadedFile(options: { uri: string }): Promise<{ ok: boolean }>
  updateTodayWidget(options: { items: {
    title: string; location: string; startMs: number; endMs: number
  }[] }): Promise<{ ok: boolean }>
  cancelDownload(options: { taskId: string }): Promise<{ ok: boolean }>
  logout(): Promise<{ ok: boolean }>
  addListener(
    eventName: 'downloadProgress' | 'calendarSessionReady',
    listener: (event: DownloadProgress & { connected?: boolean }) => void
  ): Promise<PluginListenerHandle>
}

const native = registerPlugin<NativeCanvasApi>('SjtuCanvas')
export const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
export default native
