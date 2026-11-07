import type { DeviceAppearance } from './MaterialTheme'
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

export type AssignmentProgress = {
  submissionStatus?: 'submitted' | 'unsubmitted' | 'graded' | 'missing'
  submissionKnown?: boolean
  score?: number | null
  pointsPossible?: number | null
  grade?: string
  statusUpdatedAt?: number
}
export type CalendarEvent = AssignmentProgress & {
  id: string
  title: string
  startTime: string
  endTime: string
  courseName: string
  location?: string
  examType?: string
  type: 'assignment' | 'event' | 'course' | 'exam'
}

export type WidgetStatus = {
  instances: number
  dailyInstances?: number
  weeklyInstances?: number
  courses: number
  deadlines: number
  updatedAt: number
  lastRenderAt: number
  nextRefreshAt: number
  lastAlarmFiredAt?: number
  exactAlarmAllowed?: boolean
  lastRenderedInstances: number
  lastRenderError: string
  weeklyRenderedInstances?: number
  weeklyRenderError?: string
  manufacturer: string
  brand: string
  androidApi: number
  pinSupported: boolean
  ignoringBatteryOptimizations: boolean
}

export type NativeInsets = { top: number; bottom: number; left: number; right: number }

export type CourseDownloadItem = { file: CanvasFile; courseName: string; term: string }

export type DownloadProgress = {
  taskId: string
  bytes: number
  total: number
  fileName: string
}

export type AgendaSettings = {
  enabled: boolean
  courseEnabled: boolean; courseMinutes: number
  eventEnabled: boolean; eventMinutes: number
  examEnabled: boolean; examMinutes: number
  homeworkEnabled: boolean; homeworkMinutes: number
  quietEnabled: boolean; quietMode: 'silent' | 'skip'; quietStart: number; quietEnd: number
  allDayHour: number; showContent: boolean; lockScreenDetails: boolean
  backgroundEnabled: boolean; syncMinutes: number; unmeteredOnly: boolean; batteryNotLow: boolean
}
export type AgendaStatus = {
  settings: AgendaSettings; permissionGranted: boolean; channelEnabled: boolean
  exactAlarmAllowed: boolean; nextReminderAt: number; cachedEvents: number
  lastSyncAt: number; lastSyncSuccessAt: number; syncState: string; jobScheduled: boolean
}

type NativeCanvasApi = {
  scheduleColors(options:{courses:string[];assignments:Record<string,number>}):Promise<Record<string,number>>
  deviceAppearance(): Promise<DeviceAppearance>
  setAppAppearance(options: {dark: boolean; mode: 'system' | 'light' | 'dark'; reducedEffects?:boolean; colors: Record<string,string>}): Promise<{ok: boolean}>
  agendaSettings(): Promise<AgendaStatus>
  saveAgendaSettings(options: {settings: AgendaSettings}): Promise<AgendaStatus>
  requestAgendaPermission(): Promise<AgendaStatus>
  openAgendaNotificationSettings(options: {channel?: 'reminders'}): Promise<{ok: boolean}>
  syncAgendaNow(): Promise<AgendaStatus>
  login(): Promise<{ completed: boolean }>
  getInsets(): Promise<NativeInsets>
  calendar(options: { month: string }): Promise<{ items: CalendarEvent[]; warning?: string; authRequired?: boolean; officialConnected?: boolean }>
  calendarWeek(options: { weekStart: string }): Promise<{ items: CalendarEvent[]; warning?: string; authRequired?: boolean; officialConnected?: boolean; needsSupplement: boolean }>
  calendarWeekOfficial(options: { weekStart: string; force?: boolean }): Promise<{ items: CalendarEvent[]; connected: boolean; warning?: string }>
  calendarWeekSupplement(options: { weekStart: string }): Promise<{ items: CalendarEvent[] }>
  openOfficialCalendar(): Promise<{ ok: boolean }>
  exams(options?: { force?: boolean }): Promise<{
    items: CalendarEvent[]; connected: boolean; source?: string; warning?: string
  }>
  openExamPortal(options: { source: 'study' | 'jiaowu' }): Promise<{ ok: boolean }>
  resumeExamSession(): Promise<{ connected: boolean; source?: string; requiresInteraction?: boolean; recovering?: boolean }>
  diagnoseAuth(): Promise<{ savedSessionEncrypted: boolean; canvasCookie: boolean; jaccountCookie: boolean; officialCalendarCookie: boolean; canvasProfile: string; canvasCalendar: string; canvasCourses: string; officialCalendar: string }>
  status(): Promise<{ loggedIn: boolean; name?: string; savedSessionEncrypted?: boolean }>
  courses(): Promise<{ items: CanvasCourse[] }>
  files(options: { courseId: string }): Promise<{ items: CanvasFile[] }>
  download(options: { fileId: string; taskId: string; courseName?: string; term?: string }): Promise<{
    uri: string; fileName: string; savedPath: string; publicDownload: boolean
  }>
  openDownloadedFile(options: { uri: string }): Promise<{ ok: boolean }>
  updateTodayWidget(options: { items: (AssignmentProgress & {
    id?: string; source?: 'personal' | 'school'; title: string; location: string; courseName?: string;
    startMs: number; endMs: number;
    kind: 'course' | 'deadline'
    allDay?: boolean
    assignment?: boolean
    category?: 'course' | 'event' | 'homework' | 'exam'
  })[]; clear?: boolean; preserveSchool?: boolean }): Promise<{ ok: boolean }>
  widgetStatus(): Promise<WidgetStatus>
  refreshTodayWidget(): Promise<WidgetStatus>
  pinTodayWidget(options?: {kind?: 'daily' | 'weekly'}): Promise<{supported: boolean; requested: boolean}>
  openWidgetSettings(options: { section: 'app' | 'battery' | 'exactAlarm' }): Promise<{ ok: boolean }>
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
