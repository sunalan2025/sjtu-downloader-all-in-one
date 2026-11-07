import { useTransientMessage } from './TransientMessage'
import { useCurrentTime } from './CurrentTime'
import { usePresence, withMotion, SHEET_EXIT_MS } from './Motion'
import { autoRetry } from './AutoRetry'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Haptics } from '@capacitor/haptics'
import native, { isAndroid, type CanvasCourse, type DownloadProgress, type CalendarEvent, type CourseDownloadItem } from './native'
import { BatchCourseBrowser, type CourseBrowserHandle, type CourseSelection } from './BatchCourseBrowser'
import { CalendarPage, currentMonth, currentWeekStart, shanghaiDate } from './CalendarPage'
import { readExamSnapshot, saveExamSnapshot, clearExamSnapshot } from './ExamSnapshot'
import { clearVerifiedWeeks, isOfficialClass, mergeOfficialWeeks,
  readVerifiedWeeks, rememberVerifiedWeek } from './VerifiedSchoolWeeks'
import { Icon, type IconName } from './Icon'
import { SettingsSheet } from './SettingsSheet'
import { WidgetSettings } from './WidgetSettings'
import { PermissionsSettings } from './PermissionsSettings'
import { NotificationSettings } from './NotificationSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { applyMaterialTheme, readAppearance, storeAppearance, type DeviceAppearance } from './MaterialTheme'
import { PageHeader, SettingsEntry } from './MaterialUI'
import { acceptCourseAssignments, courseAssignments, useScheduleColors } from './ScheduleColors'
import { useConfirmation } from './Confirmation'
import { scheduleKind, scheduleLabel, schedulePlace, scheduleCourse, dateOffset, shortDate, clockText,
  compareEvents, eventMillis, occurrenceKey, scheduleTimeRange, scheduleTitle, assignmentStatusText, assignmentProgress } from './ScheduleUtils'
import { PersonalScheduleEditor, asCalendarEvent, readPersonalEvents,
  PERSONAL_STORAGE_KEY, type PersonalEvent } from './PersonalSchedule'

type Tab = 'home' | 'courses' | 'calendar' | 'downloads'
type Job = {
  taskId: string; fileName: string; state: 'queued' | 'active' | 'done' | 'error' | 'cancelled'
  bytes: number; total: number; error?: string; uri?: string; savedPath?: string
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value < 1024) return Math.round(value) + ' B'
  if (value < 1024 ** 2) return (value / 1024).toFixed(1) + ' KB'
  if (value < 1024 ** 3) return (value / 1024 ** 2).toFixed(1) + ' MB'
  return (value / 1024 ** 3).toFixed(2) + ' GB'
}
/** Merge course assignment metadata without replacing an already-known Canvas
 * course or showing the same deadline twice because two APIs use different IDs. */
function mergeSchoolAssignments(base:CalendarEvent[],supplement:CalendarEvent[]):CalendarEvent[] {
  const merged=[...base]
  for(const extra of supplement){
    const match=merged.findIndex(old=>occurrenceKey(old)===occurrenceKey(extra) ||
      (old.type==='assignment'&&extra.type==='assignment'&&
       old.title===extra.title&&old.startTime===extra.startTime&&
       (!old.courseName||!extra.courseName||old.courseName===extra.courseName)))
    if(match>=0){
      const old=merged[match]
      const progress=extra.submissionKnown && (!old.submissionKnown ||
        (extra.statusUpdatedAt||0)>=(old.statusUpdatedAt||0)) ? assignmentProgress(extra) : {}
      merged[match]={...old,...progress,courseName:old.courseName||extra.courseName}
    }else merged.push(extra)
  }
  return merged
}

const nav: { id: Tab; text: string; hint: string; icon: IconName }[] = [
  { id: 'home', text: '首页', hint: '近期安排与概览', icon: 'home' },
  { id: 'courses', text: '课程', hint: '教学资料与文件', icon: 'book' },
  { id: 'calendar', text: '日历', hint: '课表、考试与作业', icon: 'calendar' },
  { id: 'downloads', text: '下载', hint: '任务、历史与小组件', icon: 'download' }
]
/** Standalone card with no dependency on the old generic job-list selectors.
 * All content and controls wrap within the available portrait width. */
function DownloadCard({job,onCancel,onOpen}:{
  job:Job
  onCancel:(taskId:string)=>void
  onOpen:(uri:string)=>void
}) {
  const running=job.state==='active'||job.state==='queued'
  const progress=job.total>0?Math.min(100,Math.max(0,job.bytes/job.total*100)):0
  const status=job.state==='done'?'已完成':job.state==='active'?'下载中':
    job.state==='queued'?'等待下载':job.state==='cancelled'?'已取消':'下载失败'
  return <article className={'download-task-card download-task--'+job.state}>
    <div className="download-task-top">
      <div className="download-task-icon"><Icon name={job.state==='done'?'check':'download'} size={20}/></div>
      <div className="download-task-info">
        <strong title={job.fileName}>{job.fileName}</strong>
        <span>{running?(job.state==='queued'?'队列中':formatBytes(job.bytes)+' / '+formatBytes(job.total)):
          job.state==='done'?formatBytes(job.total):job.state==='cancelled'?'已取消下载':'暂时无法下载，请检查网络和课程访问权限'}</span>
      </div>
      <span className={'download-task-status status-'+job.state}>{status}</span>
    </div>
    {running&&<div className="download-task-progress" aria-label={'已下载 '+Math.round(progress)+'%'}>
      <span style={{width:Math.max(job.state==='active'?3:0,progress)+'%'}}/>
    </div>}
    {job.state==='done'&&job.savedPath&&
      <div className="download-task-path">
        <span>保存至：{job.savedPath}</span>
        {job.uri?.startsWith('content://media/')&&<button type="button" className="button button--tonal button--compact"
          onClick={()=>onOpen(job.uri!)}>打开文件</button>}
      </div>}
    {job.state==='active'&&
      <div className="download-task-foot"><button type="button" className="button button--tonal button--compact"
        onClick={()=>onCancel(job.taskId)}>取消下载</button></div>}
  </article>
}


export default function App() {
  const {confirm, dismissConfirmation} = useConfirmation()
  useScheduleColors()
  const [tab, setTab] = useState<Tab>('home')
  const currentTime=useCurrentTime()
  const today=shanghaiDate(new Date(currentTime).toISOString())
  const [homeRefresh,setHomeRefresh]=useState(0)
  type SettingsSection = 'widget' | 'reminders' | 'appearance' | 'permissions' | null
  const [settingsSheet, setSettingsSheetState] = useState<SettingsSection>(null)
  const settingsOrigin = useRef<HTMLElement | null>(null)
  const settingsSheetRef = useRef<SettingsSection>(null)
  const setSettingsSheet = useCallback((value: SettingsSection, trigger?: HTMLElement) => {
    if (value) settingsOrigin.current = trigger ?? null
    // Native back can arrive before React commits a freshly opened sheet.
    settingsSheetRef.current = value
    setSettingsSheetState(value)
  }, [])
  const settingsPresence=usePresence(settingsSheet, SHEET_EXIT_MS + 20)
  const [appearance, setAppearance] = useState(readAppearance)
  const [deviceAppearance, setDeviceAppearance] = useState<DeviceAppearance>(() => ({
    dark: window.matchMedia('(prefers-color-scheme: dark)').matches
  }))
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => {
      const accept = (next: DeviceAppearance) => setDeviceAppearance(old =>
        old.dark === next.dark && old.systemSeed === next.systemSeed ? old : next)
      if (isAndroid) void native.deviceAppearance().then(accept).catch(() => accept({dark:media.matches}))
      else accept({dark:media.matches})
    }
    const visible = () => { if (document.visibilityState === 'visible') update() }
    update()
    media.addEventListener('change', update)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', visible)
    return () => {
      media.removeEventListener('change', update)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])
  useLayoutEffect(() => {
    const resolved = applyMaterialTheme(appearance, deviceAppearance)
    storeAppearance(appearance)
    if (isAndroid) void native.setAppAppearance({...resolved,mode:appearance.theme,reducedEffects:appearance.reducedEffects}).catch(() => {})
  }, [appearance, deviceAppearance])
  const [railExpanded,setRailExpanded]=useState(()=>{
    try{
      const saved=window.localStorage.getItem('sjtu-navigation-rail')
      if(saved==='expanded'||saved==='collapsed')return saved==='expanded'
    }catch{ /* Private browsing may disable persistent storage. */ }
    return typeof window!=='undefined' &&
      window.matchMedia('(orientation:landscape) and (min-width:1000px) and (min-height:420px)').matches
  })
  useEffect(()=>{
    const followViewport=()=>{
      try{
        if(window.localStorage.getItem('sjtu-navigation-rail'))return
      }catch{ /* Follow viewport when storage is unavailable. */ }
      setRailExpanded(window.matchMedia(
        '(orientation:landscape) and (min-width:1000px) and (min-height:420px)'
      ).matches)
    }
    window.addEventListener('orientationchange',followViewport)
    window.addEventListener('resize',followViewport)
    return ()=>{
      window.removeEventListener('orientationchange',followViewport)
      window.removeEventListener('resize',followViewport)
    }
  },[])
  const toggleRail=()=>{
    setRailExpanded(previous=>{
      const next=!previous
      try{window.localStorage.setItem('sjtu-navigation-rail',next?'expanded':'collapsed')}
      catch{ /* The navigation still works without storage. */ }
      return next
    })
  }
  const tabRef = useRef<Tab>('home')
  const courseBrowser = useRef<CourseBrowserHandle>(null)
  const [selection, setSelection] = useState<CourseSelection>({ count: 0, busy: false, scope: null })
  const onSelectionChange = useCallback((next: CourseSelection) => {
    setSelection(previous => previous.count === next.count &&
      previous.busy === next.busy && previous.scope === next.scope ? previous : next)
  }, [])
  const [tabMotion, setTabMotion] = useState<'none' | 'forward' | 'backward'>('none')
  // The outgoing panel unmounts immediately. Each new keyed panel receives
  // its own fixed direction, so rapid taps cannot reverse an in-flight mask.
  const showTab = useCallback((next: Tab) => {
    const previous = tabRef.current
    if (previous === next) return
    const direction=nav.findIndex(t => t.id === next)>nav.findIndex(t => t.id === previous)?'forward':'backward'
    tabRef.current = next
    document.documentElement.dataset.navigationDirection=direction
    // Keep the outgoing scroll/content intact until its snapshot is captured.
    withMotion(()=>{
      setTabMotion(direction)
      setTab(next)
      if(next!=='courses')setSelection({count:0,busy:false,scope:null})
      window.scrollTo(0,0)
    })
  }, [])
  const calendarRequestId = useRef(0)
  const lastCalendarFetch = useRef(0)
  type WeekResponse = Awaited<ReturnType<typeof native.calendarWeek>>
  const weeklyCache = useRef(new Map<string, {
    items: CalendarEvent[]; officialConnected: boolean; warning: string; savedAt: number;
    needsSupplement: boolean
  }>())
  const pendingWeeks = useRef(new Map<string, Promise<WeekResponse>>())
  const pendingSupplements = useRef(new Map<string, ReturnType<typeof native.calendarWeekSupplement>>())
  const sessionGeneration = useRef(0)
  // Lazy state initializer: read the verified timetable from disk once per App mount.
  const [verifiedWeeks] = useState(readVerifiedWeeks)
  const displayedWeek = useRef('')
  const lastWidgetPayload = useRef('')
  const widgetWrites=useRef(Promise.resolve())
  const widgetRevision=useRef(0)
  // All three consumers (Home, Calendar, neighboring week) share one request
  // per week; keep no more than eight weeks of calendar objects in memory.
  const rememberWeek = (week: string, data: {
    items: CalendarEvent[]; officialConnected: boolean; warning: string;
    needsSupplement?: boolean
  }) => {
    const cache = weeklyCache.current
    cache.delete(week)
    cache.set(week, { ...data, needsSupplement: data.needsSupplement ?? false,
      savedAt: Date.now() })
    while (cache.size > 8) cache.delete(cache.keys().next().value!)
  }
  const readWeek = (week: string, force = false): Promise<WeekResponse> => {
    const cached = weeklyCache.current.get(week)
    // A missing official timetable is not a healthy 3-minute cache hit.
    if (!force && cached && Date.now() - cached.savedAt <
        (cached.officialConnected ? 10*60_000 : 15_000)) {
      return Promise.resolve({ ...cached, needsSupplement: cached.needsSupplement })
    }
    const ongoing = pendingWeeks.current.get(week)
    if (ongoing) return ongoing
    const generation = sessionGeneration.current
    const request = native.calendarWeek({weekStart:week}).then(response => {
      if (generation !== sessionGeneration.current) throw new Error('Session changed')
      const live = response.items.filter(isOfficialClass)
      if (response.officialConnected && live.length)
        rememberVerifiedWeek(verifiedWeeks,week,live)
      const backup = verifiedWeeks.get(week)?.items || []
      const missing = backup.length > 0 && !live.length
      const normalized = missing ? {
        ...response,
        items: mergeOfficialWeeks(response.items, backup),
        warning: (response.warning ? response.warning + ' ' : '') +
          '本周正式课程暂时未返回，已保留最近成功同步的课表；可重新授权或同步。'
      } : response
      // Empty/unauthorized results must not erase previously verified lessons.
      rememberWeek(week, {
        items: normalized.items, officialConnected: !!normalized.officialConnected,
        warning: normalized.warning || '', needsSupplement: !!normalized.needsSupplement
      })
      return normalized
    }).finally(() => {
      if(pendingWeeks.current.get(week)===request)pendingWeeks.current.delete(week)
    })
    pendingWeeks.current.set(week, request)
    return request
  }
  const readSupplement = (week: string) => {
    const ongoing = pendingSupplements.current.get(week)
    if (ongoing) return ongoing
    const request = native.calendarWeekSupplement({weekStart:week})
      .finally(() => {
        if(pendingSupplements.current.get(week)===request)
          pendingSupplements.current.delete(week)
      })
    pendingSupplements.current.set(week,request)
    return request
  }
  const onSystemBack = useCallback(() => {
    if (!window.dispatchEvent(new Event('sjtu-popup-back', {cancelable:true}))) return
    if (dismissConfirmation()) return
    if (!window.dispatchEvent(new Event('sjtu-modal-back', {cancelable:true}))) return
    if (settingsSheetRef.current) { setSettingsSheet(null); return }
    // The Android system gesture/button first closes a nested course view,
    // then moves to Home, and only minimizes from the root.
    if (tabRef.current === 'courses' && courseBrowser.current?.goBack()) return
    if (tabRef.current !== 'home') { showTab('home'); return }
    void CapacitorApp.minimizeApp().catch(() => {})
  }, [showTab])
  const switchTab = (next: Tab) => {
    if (next === tabRef.current) return
    if (next === 'calendar') {
      // Returning to the calendar always shows today's schedule automatically.
      const current = currentMonth()
      const week = currentWeekStart()
      if (month !== current) setMonth(current)
      if (weekStart !== week) setWeekStart(week)
      else if (loggedIn && Date.now() - lastCalendarFetch.current > 5*60_000) void loadCalendar(week)
      if(loggedIn && Date.now()-lastExamFetch.current>5*60_000)void loadExamSchedule()
    }
    if (isAndroid) void Haptics.selectionChanged().catch(() => {})
    showTab(next)
  }
  const [loggedIn, setLoggedIn] = useState(false)
  const [sessionChecking, setSessionChecking] = useState(isAndroid)
  const [sessionKnown,setSessionKnown]=useState(!isAndroid)
  const [user, setUser] = useState('')
  const account=useRef<string|null>(null)
  const sessionRequest=useRef(0)
  const [courses, setCourses] = useState<CanvasCourse[]>([])
  const [jobs, setJobs] = useState<Job[]>(() => {
    try {
      const cached: unknown = JSON.parse(window.localStorage.getItem('sjtu-downloaded-files-v1') || '[]')
      if (!Array.isArray(cached)) return []
      return cached.filter((item): item is Job =>
        typeof item === 'object' && item !== null &&
        typeof item.taskId === 'string' && typeof item.fileName === 'string' &&
        item.state === 'done' && typeof item.savedPath === 'string' &&
        typeof item.uri === 'string').slice(0, 150)
    } catch { return [] }
  })
  useEffect(() => {
    // Only persist completed files, not queued tasks that cannot survive a restart.
    try {
      const finished = jobs.filter(job => job.state === 'done' && job.uri && job.savedPath)
        .slice(0, 150).map(({taskId,fileName,uri,savedPath})=>({
          taskId,fileName,uri,savedPath,state:'done'
        }))
      const serialized=JSON.stringify(finished)
      if(window.localStorage.getItem('sjtu-downloaded-files-v1')!==serialized)
        window.localStorage.setItem('sjtu-downloaded-files-v1',serialized)
    } catch { /* Disabled WebView storage must not prevent downloads. */ }
  }, [jobs])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [examEvents,setExamEvents]=useState<CalendarEvent[]>([])
  const [examConnected,setExamConnected]=useState(false)
  const [examSource,setExamSource]=useState('')
  const [examChecking,setExamChecking]=useState(false)
  const [examWarning,setExamWarning]=useState('')
  const lastExamFetch=useRef(0)
  const examRequest=useRef(0)
  const [neighborEvents, setNeighborEvents] = useState<CalendarEvent[]>([])
  const [homeSchoolEvents,setHomeSchoolEvents]=useState<CalendarEvent[]>([])
  const [homeWidgetLoaded,setHomeWidgetLoaded]=useState(false)
  const [homeLoadedThrough,setHomeLoadedThrough]=useState('')
  const [homeTimetableVerified,setHomeTimetableVerified]=useState(false)
  const [personalEvents, setPersonalEvents] = useState<PersonalEvent[]>(readPersonalEvents)
  const [editingSchedule, setEditingSchedule] = useState<{current:PersonalEvent|null;date:string}|null>(null)
  useEffect(()=>{
    try {localStorage.setItem(PERSONAL_STORAGE_KEY,JSON.stringify(personalEvents.slice(0,500)))}
    catch { /* Storage unavailability must not prevent editing in this session. */ }
  },[personalEvents])
  function savePersonalSchedule(value:PersonalEvent) {
    setPersonalEvents(old=>{
      const exists=old.some(item=>item.id===value.id)
      return exists?old.map(item=>item.id===value.id?value:item):[...old,value]
    })
    setEditingSchedule(null)
  }
  function deletePersonalSchedule(id:string) {
    setPersonalEvents(old=>old.filter(item=>item.id!==id))
    setEditingSchedule(null)
  }
  const editorPresence=usePresence(editingSchedule)
  function addSchedule(date:string) {
    setEditingSchedule({current:null,date})
  }
  function editSchedule(id:string) {
    const item=personalEvents.find(event=>event.id===id)
    if(item)setEditingSchedule({current:item,date:item.date})
  }
  const [month, setMonth] = useState(currentMonth())
  const [weekStart, setWeekStart] = useState(currentWeekStart())
  const [busy, setBusy] = useState(false)
  const [calendarBusy, setCalendarBusy] = useState(false)
  const [calendarWarning, setCalendarWarning] = useState('')
  const [officialConnected, setOfficialConnected] = useState(false)
  const [notice, setNotice] = useTransientMessage()

  useEffect(() => {
    if (!isAndroid) return
    let disposed = false
    let handler: { remove(): Promise<void> } | undefined
    void CapacitorApp.addListener('backButton', () => onSystemBack()).then(h => {
      if (disposed) void h.remove()
      else handler = h
    }).catch(() => {})
    return () => {
      disposed = true
      if (handler) void handler.remove()
    }
  }, [onSystemBack])

  useEffect(() => {
    if (!isAndroid) return
    void refreshSession()
    let lastSessionCheck = Date.now()
    const checkOnReturn = () => {
      if (document.visibilityState === 'hidden') return
      if (Date.now() - lastSessionCheck < 20_000) return
      lastSessionCheck = Date.now()
      void refreshSession()
      setHomeRefresh(value=>value+1)
    }
    window.addEventListener('focus', checkOnReturn)
    window.addEventListener('online', checkOnReturn)
    document.addEventListener('visibilitychange', checkOnReturn)
    const applyInsets = () => {
      void native.getInsets().then(insets => {
        const css = document.documentElement.style
        css.setProperty('--safe-top', insets.top + 'px')
        css.setProperty('--safe-bottom', insets.bottom + 'px')
        css.setProperty('--safe-left', insets.left + 'px')
        css.setProperty('--safe-right', insets.right + 'px')
      }).catch(() => {})
    }
    applyInsets()
    window.addEventListener('resize', applyInsets)
    let disposed = false
    let handle: { remove(): Promise<void> } | undefined
    void native.addListener('downloadProgress', (event: DownloadProgress) => {
      if (disposed) return
      setJobs(previous => previous.map(j => j.taskId === event.taskId
        ? { ...j, bytes: event.bytes, total: event.total } : j))
    }).then(h => { if (disposed) void h.remove(); else handle = h })
    let calendarHandle: { remove(): Promise<void> } | undefined
    void native.addListener('calendarSessionReady', () => {
      if (!disposed && account.current) {
        weeklyCache.current.clear()
        setHomeRefresh(value=>value+1)
        void loadCalendar(currentWeekStart(), true)
      }
    }).then(h => { if (disposed) void h.remove(); else calendarHandle = h }).catch(() => {})
    return () => {
      disposed = true
      window.removeEventListener('resize', applyInsets)
      window.removeEventListener('focus', checkOnReturn)
      window.removeEventListener('online', checkOnReturn)
      document.removeEventListener('visibilitychange', checkOnReturn)
      if (handle) void handle.remove()
      if (calendarHandle) void calendarHandle.remove()
    }
  }, [])

  useEffect(() => {
    if (!isAndroid || !loggedIn) return
    void loadCalendar(weekStart)
  }, [weekStart, loggedIn])

  // Desktop schedule-fetcher independently merges StudyAtSJTU exam events.
  // Keep this request off the weekly timetable critical path and distinguish
  // "not authorized" from an authenticated semester with zero exams.
  useEffect(()=>{
    if(!isAndroid)return
    if(loggedIn){
      // Immediately paint the last VERIFIED exam timetable for this Canvas
      // account. Authentication still happens on every native cold start;
      // a cached response never claims the registrar is currently connected.
      const snapshot=readExamSnapshot(user)
      if(snapshot){
        setExamEvents(snapshot.items)
        setExamSource(snapshot.source)
        setExamConnected(false)
      }
      void loadExamSchedule()
    }else{
      ++examRequest.current
      setExamEvents([]);setExamConnected(false)
      setExamSource('');setExamWarning('')
    }
  },[loggedIn,user])
  useEffect(()=>{
    if(!loggedIn||!isAndroid)return
    const onVisible=()=>{
      if(document.visibilityState==='visible'&&Date.now()-lastExamFetch.current>5*60_000)
        void loadExamSchedule()
    }
    document.addEventListener('visibilitychange',onVisible)
    window.addEventListener('online',onVisible)
    return ()=>{
      document.removeEventListener('visibilitychange',onVisible)
      window.removeEventListener('online',onVisible)
    }
  },[loggedIn])

  useEffect(() => {
    if (!isAndroid || !loggedIn) return
    const check = () => {
      if (document.visibilityState !== 'visible') return
      // No manual refresh button: automatically update stale school data when
      // the app returns to foreground, network reconnects or timer fires.
      if (Date.now() - lastCalendarFetch.current < 5 * 60_000) return
      // Reuse healthy 10-minute week snapshots; explicit retry still
      // bypasses the cache, but background tab returns do not refetch every
      // Canvas course and assignment page.
      void loadCalendar(weekStart).then(()=>setHomeRefresh(value=>value+1))
    }
    const interval = window.setInterval(check, 2 * 60_000)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [weekStart, loggedIn])

  // Cache this week's lessons independently of the active tab. A calendar
  // sync must keep both desktop widgets fresh even while the user browses
  // courses, downloads or a different week.
  useEffect(()=>{
    if(!isAndroid||!loggedIn){
      setHomeSchoolEvents([])
      setHomeWidgetLoaded(false)
      setHomeLoadedThrough('')
      setHomeTimetableVerified(false)
      return
    }
    const todayWeek=currentWeekStart()
    // Publish nearer weeks before requesting farther widget cache weeks.
    const weeks=[todayWeek,dateOffset(todayWeek,7),dateOffset(todayWeek,14),dateOffset(todayWeek,21)]
    const generation=sessionGeneration.current
    const loaded=new Map<string,CalendarEvent[]>()
    let disposed=false
    setHomeWidgetLoaded(false)
    setHomeTimetableVerified(false)
    const publish=()=>{
      if(disposed||generation!==sessionGeneration.current)return
      const seen=new Set<string>()
      const merged=weeks.flatMap(week=>loaded.get(week)||[])
        .filter(item=>{
          const key=occurrenceKey(item)
          if(seen.has(key))return false
          seen.add(key)
          return true
        }).sort(compareEvents)
      const ranges=weeks.filter(week=>loaded.has(week)).map(week=>[week,dateOffset(week,6)])
      setHomeSchoolEvents(previous=>{
        const preserved=previous.filter(event=>!ranges.some(([start,end])=>{
          const day=shanghaiDate(event.startTime);return day>=start&&day<=end
        }))
        const rows=new Map([...preserved,...merged].map(event=>[occurrenceKey(event),event]))
        return [...rows.values()].sort(compareEvents)
      })
      const through=loaded.has(weeks[1])?dateOffset(todayWeek,13):loaded.has(todayWeek)?dateOffset(todayWeek,6):''
      if(through)setHomeLoadedThrough(previous=>previous>through?previous:through)
    }
    // One ordered producer: a fast later response must never overtake the
    // current or next week. Calendar-only neighbors are loaded on that tab.
    let cursor=0
    const loadOne=async()=>{
      while(!disposed && cursor<weeks.length){
        const week=weeks[cursor++]
        let items:CalendarEvent[]=[]
        let needsSupplement=false
        let trusted=false
        try {
          const response=await readWeek(week)
          items=response.items
          needsSupplement=response.needsSupplement
          trusted=!!response.officialConnected || items.some(isOfficialClass)
        }catch{items=weeklyCache.current.get(week)?.items||[]}
        if(disposed||generation!==sessionGeneration.current)return
        if(week===todayWeek)setHomeTimetableVerified(trusted)
        loaded.set(week,items)
        publish()
        if(needsSupplement){
          try{
            const supplement=await readSupplement(week)
            if(disposed||generation!==sessionGeneration.current)return
            const merged=mergeSchoolAssignments(items,supplement.items)
            const cache=weeklyCache.current.get(week)
            // A successful empty supplement is complete; don't fetch all
            // course assignments again on every calendar navigation.
            if(cache)rememberWeek(week,{...cache,items:merged,needsSupplement:false})
            if(JSON.stringify(merged)!==JSON.stringify(items)){
              loaded.set(week,merged)
              publish()
            }
          }catch{ /* Restricted coursework never blocks available classes. */ }
        }
      }
    }
    void loadOne().then(()=>{
      if(!disposed&&generation===sessionGeneration.current)setHomeWidgetLoaded(true)
    }).catch(()=>{})
    return ()=>{disposed=true}
  },[loggedIn,user,today,homeRefresh])

  // Dates at the edges of the currently selected week still need their
  // previous/next day; also surface upcoming official events on Home.
  useEffect(()=>{
    if(!isAndroid||!loggedIn||tab!=='calendar'){setNeighborEvents([]);return}
    let disposed=false
    const adjacent=[-7,7].map(offset=>{
      const date=new Date(weekStart+'T00:00:00Z')
      date.setUTCDate(date.getUTCDate()+offset)
      return date.toISOString().slice(0,10)
    })
    setNeighborEvents([])
    void Promise.all(adjacent.map(async week=>{
      try{return (await readWeek(week)).items}
      catch{return weeklyCache.current.get(week)?.items||[] as CalendarEvent[]}
    })).then(groups=>{
      if(!disposed)setNeighborEvents(groups.flat())
    })
    return ()=>{disposed=true}
  },[weekStart,loggedIn,tab])

  async function loadExamSchedule(force=false): Promise<void> {
    if(!isAndroid)return
    if(!force&&Date.now()-lastExamFetch.current<5*60_000)return
    const request=++examRequest.current
    lastExamFetch.current=Date.now()
    setExamChecking(true)
    try{
      let response=await native.exams({force})
      let requiresInteraction=false
      if(request!==examRequest.current)return
      if(!response.connected && loggedIn){
        // Like the desktop app, first try to establish the exam portal's
        // separate SSO session via existing jAccount cookies. No password
        // prompt is necessary when the school session is still valid.
        try{
          const silent=await native.resumeExamSession()
          if(request!==examRequest.current)return
          requiresInteraction=!!silent.requiresInteraction
          if(!silent.recovering)response=await native.exams({force:true})
        }catch{ /* Visible login remains a manual fallback. */ }
      }
      if(request!==examRequest.current)return
      if(response.connected){
        setExamEvents(response.items)
        setExamConnected(true)
        setExamSource(response.source||'学校')
        saveExamSnapshot(user,response.source||'学校',response.items)
        setExamWarning('')
      }else{
        // Unverified auth is NOT a zero-exams response. Keep older events
        // visible if available, and allow an earlier automatic retry.
        setExamConnected(false)
        lastExamFetch.current=Date.now()-4*60_000
        setExamWarning(requiresInteraction
          ? '请登录学校考试系统后查看考试安排。'
          : '考试安排稍后自动更新。')
      }
    }catch(error){
      if(request===examRequest.current){
        lastExamFetch.current=Date.now()-4*60_000
        setExamWarning('考试安排稍后自动更新。')
      }
    }finally{
      if(request===examRequest.current)setExamChecking(false)
    }
  }
  async function connectExams(source:'study'|'jiaowu'):Promise<void> {
    if(!isAndroid)return
    setExamChecking(true)
    try{
      const result=await native.openExamPortal({source})
      if(result.ok){
        lastExamFetch.current=0
        await loadExamSchedule(true)
      }
    }catch(error){
      setExamWarning('暂时无法连接学校考试系统，稍后会自动更新。')
    }finally{setExamChecking(false)}
  }

  function clearSchoolSession() {
    sessionGeneration.current++
    ++calendarRequestId.current; ++examRequest.current; ++widgetRevision.current
    weeklyCache.current.clear();pendingWeeks.current.clear();pendingSupplements.current.clear()
    clearVerifiedWeeks(verifiedWeeks);clearExamSnapshot()
    displayedWeek.current='';lastWidgetPayload.current='';lastExamFetch.current=0
    setBusy(false)
    setCourses([]);setEvents([]);setNeighborEvents([]);setHomeSchoolEvents([])
    setHomeWidgetLoaded(false);setHomeLoadedThrough('');setHomeTimetableVerified(false)
    setExamEvents([]);setExamConnected(false);setExamSource('');setExamWarning('')
    setCalendarWarning('');setOfficialConnected(false)
  }
  async function refreshSession(): Promise<void> {
    const request=++sessionRequest.current
    setSessionChecking(true)
    try {
      const result = await native.status()
      if(request!==sessionRequest.current)return
      const owner=result.loggedIn?(result.name||'已登录'):''
      let savedOwner=''
      try{savedOwner=localStorage.getItem('sjtu-school-cache-owner')||''}catch{}
      if((account.current!==null&&account.current!==owner)||
         (result.loggedIn&&savedOwner!==owner))clearSchoolSession()
      account.current=owner
      setSessionKnown(true)
      try{localStorage.setItem('sjtu-school-cache-owner',owner)}catch{}
      setLoggedIn(result.loggedIn)
      setUser(result.name || '')
      // Restore Home immediately after verifying the login session. Course
      // pagination runs in the background instead of blocking login completion.
      if (result.loggedIn) void loadCourses()
    } catch (e) { setNotice('暂时无法连接学校，请检查网络。') }
    finally { if(request===sessionRequest.current)setSessionChecking(false) }
  }
  async function login(): Promise<void> {
    if (!isAndroid) return
    setBusy(true); setNotice('')
    try {
      await native.login()
      await refreshSession()
      // Every successful login lands on Home, including sessions started from
      // the course/calendar sign-in actions. Do not redirect to the course list.
      showTab('home')
    } catch (e) { setNotice('登录未完成，请检查网络后再登录。') }
    finally { setBusy(false) }
  }
  async function logout(): Promise<void> {
    if (!await confirm({title:'退出账号？',message:'这会清除手机上保存的交大登录会话，并关闭学校日程的后台同步。',confirmLabel:'退出账号',destructive:true})) return
    try {
      await native.logout()
      ++sessionRequest.current
      clearSchoolSession()
      account.current=''
      setLoggedIn(false);setUser('');setSessionKnown(true);setSessionChecking(false)
      showTab('home')
    } catch (e) { setNotice('操作暂未完成，请检查网络。') }
  }
  async function loadCourses(): Promise<void> {
    const generation=sessionGeneration.current
    setBusy(true)
    try { const result=await autoRetry(()=>native.courses(),()=>generation===sessionGeneration.current)
      if(generation===sessionGeneration.current)setCourses(result.items) }
    catch (e) { if(generation===sessionGeneration.current)setNotice('课程暂未更新，联网后会自动更新。') }
    finally { if(generation===sessionGeneration.current)setBusy(false) }
  }
  async function loadCalendar(targetWeek: string, force = false): Promise<void> {
    const requestId = ++calendarRequestId.current
    const previous = weeklyCache.current.get(targetWeek)
    const saved = verifiedWeeks.get(targetWeek)?.items || []
    if(displayedWeek.current !== targetWeek) {
      displayedWeek.current = targetWeek
      // Never leave a previous week's events on the screen while switching.
      setEvents(previous?.items || saved)
      setOfficialConnected(previous?.officialConnected || false)
    } else if(saved.length && !previous?.officialConnected && !previous?.items.some(isOfficialClass)) {
      setEvents(rows=>mergeOfficialWeeks(rows,saved))
    }
    setCalendarBusy(true)
    // Start the official timetable immediately. Native code now shares one
    // network FutureTask with the comprehensive Canvas+official request, so
    // there is no delayed duplicate HTTP call or needless second connection.
    const official = native.calendarWeekOfficial({weekStart:targetWeek,force})
    void official.then(response=>{
      if(requestId !== calendarRequestId.current)return
      if(response.connected){
        // Do not keep a loading mask over the verified official timetable
        // while slower Canvas assignment pagination continues in parallel.
        setCalendarBusy(false)
        if(response.items.length){
          rememberVerifiedWeek(verifiedWeeks,targetWeek,response.items)
          const prior=weeklyCache.current.get(targetWeek)
          if(prior)rememberWeek(targetWeek,{...prior,
            items:mergeOfficialWeeks(prior.items,response.items),
            officialConnected:true})
          setEvents(rows=>mergeOfficialWeeks(rows,response.items))
        }
        setOfficialConnected(true)
        setCalendarWarning(previous =>
          previous.includes('正式课表') ? '' : previous)
      } else if(!saved.length){
        // The Canvas response can still independently supply assignments.
        setCalendarWarning(response.warning ||
          '正在使用首页登录的交大账号自动恢复课表，请稍后重试。')
      }
    }).catch(()=>{ /* Regular response handles transport errors. */ })
    try {
      // A deliberate retry invalidates official data BEFORE the combined
      // Canvas request reads it. Ordinary loads remain fully parallel.
      const result = await (force
        ? official.then(()=>readWeek(targetWeek,true))
        : readWeek(targetWeek,false))
      if (requestId !== calendarRequestId.current) return
      const upToDateBackup=verifiedWeeks.get(targetWeek)?.items || []
      const updated = upToDateBackup.length && !result.items.some(isOfficialClass)
        ? mergeOfficialWeeks(result.items,upToDateBackup) : result.items
      setEvents(updated)
      setOfficialConnected(!!result.officialConnected)
      const warning=result.warning ||
        (!result.officialConnected
          ? '正在通过首页已登录的交大账号同步课表；如果学校服务暂时不可用，课程仍可查看上次同步版本。'
          : '')
      setCalendarWarning(warning)
      lastCalendarFetch.current = Date.now()
      if (result.needsSupplement) {
        void readSupplement(targetWeek).then(extra => {
          if (requestId !== calendarRequestId.current) return
          setEvents(previous => {
            const merged = mergeSchoolAssignments(previous,extra.items)
            const previousCache = weeklyCache.current.get(targetWeek)
            if (previousCache) rememberWeek(targetWeek, {
              ...previousCache,items:merged,needsSupplement:false
            })
            return merged
          })
        }).catch(() => {})
      }
    } catch(e) {
      if (requestId !== calendarRequestId.current) return
      // Keep the current week's verified lessons visible on transport failure.
      if(saved.length)setEvents(rows=>mergeOfficialWeeks(rows,saved))
      lastCalendarFetch.current=Date.now()-4*60_000
      setCalendarWarning('部分日程暂未更新，联网后会自动更新。')
    } finally {
      if (requestId === calendarRequestId.current) setCalendarBusy(false)
    }
  }
  async function downloadBatch(tasks: CourseDownloadItem[]): Promise<void> {
    if (!isAndroid || tasks.length === 0) return
    if (tasks.length > 1200) { setNotice('单批次最多 1200 个文件，请分学期下载。'); return }
    const stamp = Date.now().toString(36)
    const specs = tasks.map((item, index) => ({ ...item, taskId: stamp + '-' + index + '-' + item.file.id }))
    setJobs(old => [...specs.map(x => ({
      taskId: x.taskId,
      fileName: x.file.name,
      state: 'queued' as const,
      bytes: 0,
      total: x.file.size
    })), ...old])
    showTab('downloads')
    let cursor = 0
    async function worker() {
      while (cursor < specs.length) {
        const job = specs[cursor++]
        setJobs(old => old.map(j => j.taskId === job.taskId ? { ...j, state: 'active' } : j))
        try {
          const saved = await native.download({
            fileId: job.file.id,
            taskId: job.taskId,
            term: job.term,
            courseName: job.courseName
          })
          setJobs(old => old.map(j => j.taskId === job.taskId ?
            { ...j, state: 'done', bytes: j.total, uri: saved.uri,
              fileName: saved.fileName, savedPath: saved.savedPath } : j))
        } catch (error) {
          const message = String(error)
          setJobs(old => old.map(j => j.taskId === job.taskId ?
            { ...j, state: message.includes('取消') ? 'cancelled' : 'error', error: message } : j))
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, specs.length) }, () => worker()))
  }
  async function cancel(taskId: string): Promise<void> {
    try { await native.cancelDownload({ taskId }) }
    catch (e) { setNotice('操作暂未完成，请检查网络。') }
  }
  async function openDownloadedFile(uri: string): Promise<void> {
    try { await native.openDownloadedFile({ uri }) }
    catch (e) { setNotice('暂时无法打开文件，请使用手机文件管理器查看。') }
  }
  async function clearFinishedHistory() {
    const count = jobs.filter(job => job.state !== 'active' && job.state !== 'queued').length
    if (!count) return
    if (!await confirm({title:'清除下载历史？',message:'将清除 '+count+' 条已结束的任务记录，手机中已保存的文件会保留。',confirmLabel:'清除历史',destructive:true})) return
    setJobs(previous => previous.filter(job => job.state === 'active' || job.state === 'queued'))
    setNotice('已清除历史记录，手机中的下载文件仍然保留。')
  }

  const active = jobs.filter(j => j.state === 'active').length
  const personalCalendar=useMemo(()=>personalEvents.map(asCalendarEvent),[personalEvents])
  const calendarEvents=useMemo(()=>[...events,...neighborEvents,...examEvents,...personalCalendar],
    [events,neighborEvents,examEvents,personalCalendar])
  const agendaEnd=dateOffset(currentWeekStart(),13)
  const agendaVisibleThrough=isAndroid&&(loggedIn||sessionChecking)
    ? (homeLoadedThrough?homeLoadedThrough<agendaEnd?homeLoadedThrough:agendaEnd:today) : agendaEnd
  const upcomingEvents=useMemo(()=>{
    const seen=new Set<string>()
    const until=agendaVisibleThrough
    return [...homeSchoolEvents,...examEvents,...personalCalendar].filter(event=>{
      const day=shanghaiDate(event.startTime)
      return day>=today&&day<=until
    }).sort(compareEvents).filter(event=>{
      const key=occurrenceKey(event)
      if(seen.has(key))return false
      seen.add(key);return true
    })
  },[homeSchoolEvents,examEvents,personalCalendar,today,agendaVisibleThrough])
  const firstThree=[today,dateOffset(today,1),dateOffset(today,2)].filter(day=>day<=agendaVisibleThrough)
  const extraAgendaDates=Array.from(new Set(upcomingEvents
    .map(event=>shanghaiDate(event.startTime))
    .filter(day=>day>firstThree[firstThree.length-1])))
  const agendaDates=[...firstThree,...extraAgendaDates]
  const subjectTitles=useMemo(()=>[...new Set([...calendarEvents,...homeSchoolEvents]
    .filter(e=>e.type==='course').map(e=>e.title))].sort().join('\n'),[calendarEvents,homeSchoolEvents])
  useLayoutEffect(()=>{
    const titles=subjectTitles.split('\n').filter(Boolean)
    const preferred=courseAssignments(titles)
    let alive=true
    if(isAndroid)void native.scheduleColors({courses:titles,assignments:preferred})
      .then(next=>{if(alive)acceptCourseAssignments(next)}).catch(()=>{})
    return()=>{alive=false}
  },[subjectTitles])
  // Only publish a complete, current-week snapshot. v0.4.11 sent an empty
  // array on mount and overwrote previously synchronized data before the first
  // network response. Preserve Android's last nonempty snapshot while loading.
  useEffect(() => {
    if (!isAndroid || sessionChecking) return
    // Never overwrite the last working desktop timetable with a partial
    // Canvas-only snapshot when the official school calendar SSO is unavailable.
    const schoolReady=loggedIn&&homeWidgetLoaded&&homeTimetableVerified
    const school=schoolReady?homeSchoolEvents:[]
    const rows=[...school,...examEvents,...personalCalendar].sort(compareEvents)
    const now=Date.now()
    const cutoff=Date.parse(dateOffset(today,22)+'T00:00:00+08:00')
    const seen=new Set<string>()
    const items=rows.map(event=>{
      const kind=scheduleKind(event)
      // School timetable and personal timed plans are class/agenda entries;
      // all Canvas homework and recognized exams are displayed as deadlines.
      const deadline=kind==='homework'||kind==='exam'
      const startMs=eventMillis(event)
      const requestedEnd=Date.parse(event.endTime)
      const endMs=event.type==='assignment'?startMs:
        Number.isFinite(requestedEnd)&&requestedEnd>startMs
          ? requestedEnd : startMs+45*60*1000
      return {
        id:event.id,source:event.id.startsWith('personal-')?'personal' as const:'school' as const,
        title:event.title.trim(),location:schedulePlace(event),
        courseName:event.type==='assignment'||event.type==='exam'?event.courseName||'':'',
        ...assignmentProgress(event),
        assignment:event.type==='assignment',
        startMs,endMs,kind:deadline?'deadline' as const:'course' as const,
        allDay:/^\d{4}-\d\d-\d\d$/.test(event.startTime),
        category:kind==='exam'?'exam' as const:
          kind==='homework'?'homework' as const:
          event.type==='course'?'course' as const:'event' as const
      }
    }).filter(item=>item.title&&Number.isFinite(item.startMs)&&item.startMs<cutoff
      &&item.startMs>=now-8*24*60*60*1000
      &&Number.isFinite(item.endMs)&&(item.kind==='deadline'||item.endMs>item.startMs))
      .filter(item=>{
        const key=[item.id||item.title,item.startMs,item.kind].join('|')
        if(seen.has(key))return false
        seen.add(key)
        return true
      }).sort((a,b)=>a.startMs-b.startMs)
      .slice(0,300)

    // An empty remote response may be a temporary school outage. Do not erase
    // an otherwise valid widget cache unless the account was logged out.
    const payload={items,clear:sessionKnown&&!loggedIn,preserveSchool:!sessionKnown||(loggedIn&&!schoolReady)}
    const signature=JSON.stringify(payload)
    if(signature===lastWidgetPayload.current)return
    // Coalesce identical queued writes, and clear the signature on failure.
    lastWidgetPayload.current=signature
    const revision=++widgetRevision.current
    const generation=sessionGeneration.current
    widgetWrites.current=widgetWrites.current.catch(()=>{}).then(async()=>{
      if(revision!==widgetRevision.current||generation!==sessionGeneration.current)return
      await native.updateTodayWidget(payload)
      if(revision!==widgetRevision.current||generation!==sessionGeneration.current)return
      lastWidgetPayload.current=signature
      window.dispatchEvent(new Event('sjtu-widget-updated'))
    }).catch(() => {
      if(revision===widgetRevision.current)lastWidgetPayload.current=''
    })
  },[loggedIn,sessionKnown,sessionChecking,homeWidgetLoaded,homeTimetableVerified,homeSchoolEvents,examEvents,personalCalendar,today])

  const batchActive = tab === 'courses' && loggedIn && !sessionChecking && selection.count > 0
  const tabIndex = nav.findIndex(item => item.id === tab)

  return <div className={'app '+(railExpanded?'rail-expanded':'rail-collapsed')}>
    <div className="app-shell">
      {notice && <div role="alert" className="notice surface-card"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" size={17}/></button></div>}
      <section className="content">
        <div className={'screen-motion screen-motion--' + tabMotion} key={tab}>
          {tab === 'home' && <>
            <div className="app-identity"><img src="./desktop-logo.png" alt=""/>SJTU Downloader</div>
            <PageHeader title="概览" subtitle={new Date().toLocaleDateString('zh-CN', {timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'long'})}>
              <button type="button" className="icon-button" aria-label="主题设置" onClick={event=>setSettingsSheet('appearance',event.currentTarget)}><Icon name="palette" size={23}/></button>
            </PageHeader>
            <div className="home-overview-grid">
              <section className="home-stage">
                <div className="account-main"><div>
                  <div className="home-kicker">你的校园工作台</div>
                  <h2>{loggedIn ? '欢迎回来' : '学习，轻盈一点。'}</h2>
                  <div className="welcome-name">{loggedIn ? user || '已连接交大账号' : sessionChecking ? '正在恢复登录…' : '课程资料与日程，一处掌握'}</div>
                </div><span className="account-emblem"><Icon name={loggedIn?'school':'book'} size={34}/></span></div>
                {!loggedIn && !sessionChecking && <button className="primary login-entry" disabled={!isAndroid || busy} onClick={() => void login()}>
                  {busy ? '正在连接…' : '交我办登录'} <Icon name="arrow" size={18}/>
                </button>}
                {loggedIn && <div className="home-session-line"><span className="session-indicator"><span className="connected-dot"/>账号已连接</span>
                  <button className="text-button quiet-logout" onClick={() => void logout()}>退出账号</button></div>}
              </section>
              <div className="home-metrics" aria-label="当前概览">
                <article className="metric-card"><span>今日安排</span><strong>{upcomingEvents.filter(e=>shanghaiDate(e.startTime)===today).length}</strong><small>今天的日程</small></article>
                <article className="metric-card"><span>今日作业</span><strong>{upcomingEvents.filter(e=>shanghaiDate(e.startTime)===today&&e.type==='assignment').length}</strong><small>截止任务</small></article>
                <article className="metric-card"><span>正在下载</span><strong>{active}</strong><small>文件任务</small></article>
              </div>
            </div>
            <section className="today-brief recent-agenda">
              <div className="recent-agenda-head">
                <h2>近期安排 <span>至下周日 · {shortDate(agendaEnd)}</span></h2>
                <button type="button" className="button button--tonal" onClick={()=>addSchedule(today)}>＋ 添加日程</button>
              </div>
              <div className="recent-agenda-groups">
                {agendaDates.map((date,index)=>{
                  const todayItems=upcomingEvents.filter(event=>shanghaiDate(event.startTime)===date)
                  const dateLabel=date===today?'今天':date===dateOffset(today,1)?'明天':date===dateOffset(today,2)?'后天':shortDate(date)
                  return <section className={'recent-day'+(index===0?' recent-day--today':'')} key={date} data-date={date}
                    aria-label={dateLabel+'的安排'}>
                    <div className="recent-day-heading">
                      <strong>{dateLabel}</strong>
                      <span>{index<3?shortDate(date):''}</span>
                      <small>{todayItems.length} 项</small>
                    </div>
                    {todayItems.length>0?<div className="recent-day-items">
                      {todayItems.map(event=>{
                        const kind=scheduleKind(event)
                        const personal=event.id.startsWith('personal-')
                        return <div key={occurrenceKey(event)} className={'recent-agenda-item agenda-'+kind}>
                          <span className="recent-agenda-time">{clockText(event.startTime)}</span>
                          <div className="recent-agenda-body">
                            <strong>{scheduleTitle(event)}</strong>
                            {assignmentStatusText(event,currentTime)&&<small className="assignment-status">{assignmentStatusText(event,currentTime)}</small>}
                            <small>{event.type==='course'?'课程':scheduleLabel(kind)}
                              {' · '+scheduleTimeRange(event)}
                              {schedulePlace(event)?' · '+schedulePlace(event):''}</small>
                            {event.type==='assignment'&&scheduleCourse(event)&&
                              <small className="recent-assignment-course">所属课程 · {scheduleCourse(event)}</small>}
                          </div>
                          {personal&&<button type="button" className="button button--tonal button--compact" onClick={()=>editSchedule(event.id)}
                            aria-label={'编辑 '+event.title}>编辑</button>}
                        </div>
                      })}
                    </div>:<p className="recent-day-empty">{isAndroid&&(sessionChecking||loggedIn&&!homeLoadedThrough)?'正在读取安排…':'暂无安排'}</p>}
                  </section>
                })}
              </div>
            </section>
          </>}
          {tab === 'courses' && (sessionChecking
            ? <div className="loading-note">正在恢复登录…</div>
            : <BatchCourseBrowser ref={courseBrowser} courses={courses} loggedIn={loggedIn} loading={busy}
                onLogin={() => void login()}
                onBatchDownload={downloadBatch} onNotice={setNotice} onSelectionChange={onSelectionChange}/>)}
          {tab === 'calendar' && <>
              <CalendarPage month={month} onMonthChange={setMonth} onWeekChange={setWeekStart}
                events={calendarEvents} busy={calendarBusy}
                officialConnected={officialConnected}
                examConnected={examConnected} examChecking={examChecking}
                examWarning={examWarning} examSource={examSource}
                onExamConnect={()=>{if(loggedIn)void connectExams('jiaowu');else void login()}}
                onExamFallback={()=>{if(loggedIn)void connectExams('study');else void login()}}
                onAddSchedule={addSchedule} onEditSchedule={editSchedule}/>
              {!loggedIn&&<div className="calendar-notice">
                个人日程可离线使用；登录交我办后将合并显示学校课表与作业。
              </div>}
              {calendarWarning&&<p className="calendar-notice" role="status">部分日程暂未更新，联网后会自动更新。</p>}
          </>}
          {tab === 'downloads' && <div className="downloads-layout">
            <PageHeader title="下载" subtitle="文件任务与应用设置" className="downloads-heading">
              <div className="downloads-heading-actions">
                <span>{active>0?active+' 项进行中':jobs.length+' 项任务'}</span>
                {jobs.some(job=>job.state!=='active'&&job.state!=='queued')&&
                  <button type="button" className="downloads-clear button button--tonal button--compact" onClick={clearFinishedHistory}>
                    清除历史
                  </button>}
              </div>
            </PageHeader>
            <div className="downloads-folder">
              <div className="downloads-folder-icon"><Icon name="download" size={20}/></div>
              <div><strong>文件保存位置</strong>
                <span>手机文件管理器 / 下载 / SJTU Downloader</span>
              </div>
            </div>
            {jobs.length===0?
              <div className="downloads-empty">
                <Icon name="download" size={29}/>
                <strong>还没有下载任务</strong>
                <span>在课程中长按选择文件，再点击底部下载按钮</span>
              </div>:
              <div className="downloads-sections">
                {([
                  {key:'active',title:'进行中',items:jobs.filter(job=>job.state==='active'||job.state==='queued')},
                  {key:'history',title:'下载记录',items:jobs.filter(job=>job.state!=='active'&&job.state!=='queued')}
                ] as const).filter(section=>section.items.length>0).map(section=>
                  <section className="downloads-section" key={section.key}>
                    <div className="downloads-section-heading">
                      <h2>{section.title}</h2><span>{section.items.length} 项</span>
                    </div>
                    <div className="downloads-task-list">
                      {section.items.map(job=><DownloadCard key={job.taskId} job={job}
                        onCancel={id=>void cancel(id)} onOpen={uri=>void openDownloadedFile(uri)}/>)}
                    </div>
                  </section>)}
              </div>}
            <section className="download-settings" aria-label="偏好设置">
              <div className="downloads-section-heading"><h2>偏好设置</h2><span>按你的习惯</span></div>
              <div className="settings-entry-list">
                {isAndroid && <SettingsEntry title="通知与后台同步" description="分类提醒、免打扰与定期更新" icon="bell"
                  onClick={trigger=>setSettingsSheet('reminders',trigger)}/>}
                <SettingsEntry title="界面与颜色" description="浅色、深色与主题颜色" icon="palette"
                  onClick={trigger=>setSettingsSheet('appearance',trigger)}/>
                {isAndroid && <SettingsEntry title="系统权限" description="通知、准时更新与后台运行" icon="shield"
                  onClick={trigger=>setSettingsSheet('permissions',trigger)}/>}
                {isAndroid && <SettingsEntry title="桌面日程小组件" description="添加到桌面，随时查看日程" icon="calendar"
                  onClick={trigger=>setSettingsSheet('widget',trigger)} expanded={settingsSheet==='widget'}/>}
              </div>
            </section>
          </div>}

        </div>
      </section>
    </div>
    {settingsPresence.value && <SettingsSheet origin={settingsOrigin.current} motionPhase={settingsPresence.phase} title={settingsPresence.value === 'widget' ? '桌面日程小组件'
      : settingsPresence.value === 'reminders' ? '通知与后台同步' : settingsPresence.value === 'permissions' ? '系统权限' : '界面与颜色'} onClose={() => setSettingsSheet(null)}>
      {settingsPresence.value === 'widget' ? <WidgetSettings/> : settingsPresence.value === 'reminders'
        ? <NotificationSettings loggedIn={loggedIn}/> : settingsPresence.value === 'permissions' ? <PermissionsSettings/> : <AppearanceSettings value={appearance} device={deviceAppearance} onChange={setAppearance}/>}
    </SettingsSheet>}
    {editorPresence.value&&<PersonalScheduleEditor motionPhase={editorPresence.phase}
      key={editorPresence.value.current?.id||editorPresence.value.date}
      current={editorPresence.value.current} initialDate={editorPresence.value.date}
      onSave={savePersonalSchedule} onDelete={deletePersonalSchedule}
      onClose={()=>setEditingSchedule(null)}/>}
    <div className={'bottom-dock surface-card' + (batchActive ? ' is-batch' : '')}>
      {batchActive ? <div className="batch-dock" role="group" aria-label="批量下载操作">
        <button type="button" className="primary batch-dock-action" disabled={!isAndroid || selection.busy}
          onClick={() => courseBrowser.current?.downloadSelection()}>
          <Icon name="download" size={20}/>
          {selection.busy ? '正在扫描课程资料…'
            : selection.scope === 'files' ? '下载 ' + selection.count + ' 个文件'
              : '下载 ' + selection.count + ' 门课程'}
        </button>
      </div> : null}
      <div className="rail-header">
        <button type="button" className="rail-toggle" onClick={toggleRail}
          aria-label={railExpanded?'收起侧栏导航':'展开侧栏导航'}
          aria-expanded={railExpanded}
          title={railExpanded?'收起侧栏':'展开侧栏'}>
          <span className="rail-toggle-symbol" aria-hidden="true">
            <span className="rail-toggle-spine"/><Icon name={railExpanded?'left':'right'} size={16}/>
          </span>
          <span className="rail-toggle-label">{railExpanded?'收起侧栏':'展开侧栏'}</span>
        </button>
      </div>
      <nav className="bottom-nav" aria-label="主导航">
        <span className="nav-slider" aria-hidden="true"
          style={{ '--nav-index': tabIndex } as React.CSSProperties}/>
        {nav.map(item => <button type="button" key={item.id}
          className={item.id === tab ? 'selected' : ''} onClick={() => switchTab(item.id)}
          aria-label={item.text}
          title={railExpanded?undefined:item.text}
          aria-current={item.id === tab ? 'page' : undefined}>
          <span className="nav-icon"><Icon name={item.icon} size={21}/></span>
          <span className="nav-label"><strong>{item.text}</strong><small>{item.hint}</small></span>
        </button>)}
      </nav>
    </div>
  </div>
}
