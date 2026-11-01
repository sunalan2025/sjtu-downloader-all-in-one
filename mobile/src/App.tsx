import { useCallback, useEffect, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Haptics } from '@capacitor/haptics'
import native, { isAndroid, type CanvasCourse, type DownloadProgress, type CalendarEvent, type CourseDownloadItem, type WidgetStatus } from './native'
import { BatchCourseBrowser, type CourseBrowserHandle, type CourseSelection } from './BatchCourseBrowser'
import { CalendarPage, currentMonth, currentWeekStart, shanghaiDate } from './CalendarPage'
import { Icon, type IconName } from './Icon'
import { scheduleKind, scheduleLabel, schedulePlace, dateOffset, shortDate, clockText,
  compareEvents, eventMillis } from './ScheduleUtils'
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
const nav: { id: Tab; text: string; icon: IconName }[] = [
  { id: 'home', text: '首页', icon: 'home' },
  { id: 'courses', text: '课程', icon: 'book' },
  { id: 'calendar', text: '日历', icon: 'calendar' },
  { id: 'downloads', text: '下载', icon: 'download' }
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
          job.state==='done'?formatBytes(job.total):job.error||'此任务未完成'}</span>
      </div>
      <span className={'download-task-status status-'+job.state}>{status}</span>
    </div>
    {running&&<div className="download-task-progress" aria-label={'已下载 '+Math.round(progress)+'%'}>
      <span style={{width:Math.max(job.state==='active'?3:0,progress)+'%'}}/>
    </div>}
    {job.state==='done'&&job.savedPath&&
      <div className="download-task-path">
        <span>保存至：{job.savedPath}</span>
        {job.uri?.startsWith('content://media/')&&<button type="button"
          onClick={()=>onOpen(job.uri!)}>打开文件</button>}
      </div>}
    {job.state==='active'&&
      <div className="download-task-foot"><button type="button"
        onClick={()=>onCancel(job.taskId)}>取消下载</button></div>}
  </article>
}


export default function App() {
  const [tab, setTab] = useState<Tab>('home')
  const tabRef = useRef<Tab>('home')
  tabRef.current = tab
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
    setTabMotion(nav.findIndex(t => t.id === next) > nav.findIndex(t => t.id === previous)
      ? 'forward' : 'backward')
    tabRef.current = next
    setTab(next)
    if (next !== 'courses') setSelection({ count: 0, busy: false, scope: null })
    window.scrollTo(0, 0)
  }, [])
  const calendarRequestId = useRef(0)
  const lastCalendarFetch = useRef(0)
  const weeklyCache = useRef(new Map<string, {
    items: CalendarEvent[]; officialConnected: boolean; warning: string; savedAt: number
  }>())
  const onSystemBack = useCallback(() => {
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
      else if (loggedIn && Date.now() - lastCalendarFetch.current > 90_000) void loadCalendar(week, true)
      if(loggedIn && Date.now()-lastExamFetch.current>5*60_000)void loadExamSchedule()
    }
    if (isAndroid) void Haptics.selectionChanged().catch(() => {})
    showTab(next)
  }
  const [loggedIn, setLoggedIn] = useState(false)
  const [sessionChecking, setSessionChecking] = useState(isAndroid)
  const [user, setUser] = useState('')
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
      const finished = jobs.filter(job => job.state === 'done' && job.uri && job.savedPath).slice(0, 150)
      window.localStorage.setItem('sjtu-downloaded-files-v1', JSON.stringify(finished))
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
  const [homeCalendarLoaded,setHomeCalendarLoaded]=useState(false)
  const [widgetDetailsOpen,setWidgetDetailsOpen]=useState(false)
  const [widgetStatus,setWidgetStatus]=useState<WidgetStatus|null>(null)
  const [widgetBusy,setWidgetBusy]=useState(false)
  const [widgetMessage,setWidgetMessage]=useState('')
  const refreshWidgetStatus=useCallback(async()=>{
    if(!isAndroid)return
    try{
      const status=await native.widgetStatus()
      setWidgetStatus(status)
      setWidgetMessage('')
    }catch(error){setWidgetMessage('状态读取失败：'+String(error))}
  },[])
  async function refreshLauncherWidget() {
    setWidgetBusy(true)
    try{
      const status=await native.refreshTodayWidget()
      setWidgetStatus(status)
      setWidgetMessage(status.instances===0?'系统没有检测到已添加的小组件，请重新添加。':
        '已向桌面提交刷新。若仍不显示，查看下方后台运行设置。')
    }catch(error){setWidgetMessage('刷新失败：'+String(error))}
    finally{setWidgetBusy(false)}
  }
  async function openLauncherSettings(section:'app'|'battery') {
    try{await native.openWidgetSettings({section})}
    catch(error){setWidgetMessage('打开系统设置失败：'+String(error))}
  }
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
  const [notice, setNotice] = useState('')

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
    }
    window.addEventListener('focus', checkOnReturn)
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
      if (!disposed) { weeklyCache.current.clear(); void loadCalendar(currentWeekStart(), true) }
    }).then(h => { if (disposed) void h.remove(); else calendarHandle = h }).catch(() => {})
    return () => {
      disposed = true
      window.removeEventListener('resize', applyInsets)
      window.removeEventListener('focus', checkOnReturn)
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
    if(loggedIn)void loadExamSchedule()
    else{
      ++examRequest.current
      setExamEvents([]);setExamConnected(false)
      setExamSource('');setExamWarning('')
    }
  },[loggedIn])
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
      void loadCalendar(weekStart, true)
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

  // Show today's school timetable as soon as its own week arrives. Previously
  // a slow request for a second/third week blocked publishing *all* data to
  // the home screen widget, including the current day's already loaded class.
  useEffect(()=>{
    if(tab!=='home')return
    if(!isAndroid||!loggedIn){
      setHomeSchoolEvents([])
      setHomeCalendarLoaded(false)
      return
    }
    const todayWeek=currentWeekStart()
    const weeks=[todayWeek,dateOffset(todayWeek,-7),dateOffset(todayWeek,7),dateOffset(todayWeek,14)]
    const loaded=new Map<string,CalendarEvent[]>()
    let disposed=false
    setHomeCalendarLoaded(false)
    const publish=()=>{
      if(disposed)return
      const seen=new Set<string>()
      const merged=weeks.flatMap(week=>loaded.get(week)||[])
        .filter(item=>{
          const key=item.id+'|'+item.startTime
          if(seen.has(key))return false
          seen.add(key)
          return true
        }).sort(compareEvents)
      setHomeSchoolEvents(merged)
      if(loaded.has(todayWeek))setHomeCalendarLoaded(true)
    }
    for(const week of weeks){
      void (async()=>{
        let items:CalendarEvent[]=[]
        let needsSupplement=false
        const cached=weeklyCache.current.get(week)
        if(cached && Date.now()-cached.savedAt<180_000){
          items=cached.items
        } else {
          try{
            const response=await native.calendarWeek({weekStart:week})
            items=response.items
            needsSupplement=response.needsSupplement
            weeklyCache.current.set(week,{items,
              officialConnected:!!response.officialConnected,
              warning:response.warning||'',savedAt:Date.now()})
          }catch{items=cached?.items||[]}
        }
        if(disposed)return
        loaded.set(week,items)
        publish()
        if(needsSupplement){
          try{
            const supplement=await native.calendarWeekSupplement({weekStart:week})
            if(disposed)return
            const ids=new Set(items.map(item=>item.id))
            const extra=supplement.items.filter(item=>{
              if(ids.has(item.id))return false
              ids.add(item.id)
              return true
            })
            if(extra.length){
              loaded.set(week,[...items,...extra])
              const cache=weeklyCache.current.get(week)
              if(cache)weeklyCache.current.set(week,{...cache,items:[...items,...extra]})
              publish()
            }
          }catch{ /* Restricted coursework never blocks available classes. */ }
        }
      })()
    }
    return ()=>{disposed=true}
  },[tab,loggedIn])

  // Dates at the edges of the currently selected week still need their
  // previous/next day; also surface upcoming official events on Home.
  useEffect(()=>{
    if(!isAndroid||!loggedIn){setNeighborEvents([]);return}
    let disposed=false
    const adjacent=[-7,7].map(offset=>{
      const date=new Date(weekStart+'T00:00:00Z')
      date.setUTCDate(date.getUTCDate()+offset)
      return date.toISOString().slice(0,10)
    })
    setNeighborEvents([])
    void Promise.all(adjacent.map(async week=>{
      const cached=weeklyCache.current.get(week)
      if(cached && Date.now()-cached.savedAt<180_000)return cached.items
      try {
        const response=await native.calendarWeek({weekStart:week})
        weeklyCache.current.set(week,{items:response.items,
          officialConnected:!!response.officialConnected,
          warning:response.warning||'',savedAt:Date.now()})
        return response.items
      }catch{return [] as CalendarEvent[]}
    })).then(groups=>{
      if(!disposed)setNeighborEvents(groups.flat())
    })
    return ()=>{disposed=true}
  },[weekStart,loggedIn])

  async function loadExamSchedule(force=false): Promise<void> {
    if(!isAndroid)return
    if(!force&&Date.now()-lastExamFetch.current<5*60_000)return
    const request=++examRequest.current
    lastExamFetch.current=Date.now()
    setExamChecking(true)
    try{
      const response=await native.exams({force})
      if(request!==examRequest.current)return
      if(response.connected){
        setExamEvents(response.items)
        setExamConnected(true)
        setExamSource(response.source||'学校')
        setExamWarning('')
      }else{
        setExamConnected(false)
        setExamWarning(response.warning||'考试系统需要单独认证')
      }
    }catch(error){
      if(request===examRequest.current)
        setExamWarning('读取考试安排失败：'+String(error))
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
      setExamWarning('连接考试系统失败：'+String(error))
    }finally{setExamChecking(false)}
  }

  async function refreshSession(): Promise<void> {
    setSessionChecking(true)
    try {
      const result = await native.status()
      setLoggedIn(result.loggedIn)
      setUser(result.name || '')
      // Restore Home immediately after verifying the login session. Course
      // pagination runs in the background instead of blocking login completion.
      if (result.loggedIn) void loadCourses()
    } catch (e) { setNotice('连接 Canvas 失败：' + String(e)) }
    finally { setSessionChecking(false) }
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
    } catch (e) { setNotice('登录未完成：' + String(e)) }
    finally { setBusy(false) }
  }
  async function logout(): Promise<void> {
    if (!window.confirm('确定退出登录吗？这会清除手机上保存的交大登录会话。')) return
    try {
      await native.logout()
      weeklyCache.current.clear(); setLoggedIn(false); setUser(''); setCourses([]); setEvents([]);
      setExamEvents([]);setExamConnected(false);setExamSource('');lastExamFetch.current=0;
      setCalendarWarning(''); setOfficialConnected(false)
      showTab('home')
    } catch (e) { setNotice(String(e)) }
  }
  async function loadCourses(): Promise<void> {
    setBusy(true)
    try { setCourses((await native.courses()).items) }
    catch (e) { setNotice('读取课程失败：' + String(e)) }
    finally { setBusy(false) }
  }
  async function loadCalendar(targetWeek: string, force = false): Promise<void> {
    const requestId = ++calendarRequestId.current
    const cache = weeklyCache.current.get(targetWeek)
    if (!force && cache && Date.now() - cache.savedAt < 180_000) {
      setEvents(cache.items)
      setOfficialConnected(cache.officialConnected)
      setCalendarWarning(cache.warning)
      setCalendarBusy(false)
      return
    }
    setCalendarBusy(true)
    try {
      const result = await native.calendarWeek({ weekStart: targetWeek })
      if (requestId !== calendarRequestId.current) return
      setEvents(result.items)
      setOfficialConnected(!!result.officialConnected)
      setCalendarWarning(result.warning || '')
      lastCalendarFetch.current = Date.now()
      weeklyCache.current.set(targetWeek, {
        items: result.items, officialConnected: !!result.officialConnected,
        warning: result.warning || '', savedAt: Date.now()
      })
      // Load restricted Canvas assignment details in the background.
      // Do not hold the week grid open while dozens of course APIs finish.
      if (result.needsSupplement) {
        void native.calendarWeekSupplement({ weekStart: targetWeek }).then(extra => {
          if (requestId !== calendarRequestId.current) return
          setEvents(previous => {
            const known = new Set(previous.map(e =>
              [e.title,e.type,shanghaiDate(e.startTime)].join('|')))
            const extras = extra.items.filter(e => {
              const key = [e.title,e.type,shanghaiDate(e.startTime)].join('|')
              if (known.has(key)) return false
              known.add(key)
              return true
            })
            const merged = [...previous, ...extras]
            const previousCache = weeklyCache.current.get(targetWeek)
            if (previousCache) weeklyCache.current.set(targetWeek, {
              ...previousCache, items: merged
            })
            return merged
          })
        }).catch(() => {})
      }
    } catch(e) {
      if (requestId !== calendarRequestId.current) return
      setCalendarWarning('日程同步失败，将在网络恢复或应用再次打开时自动重试：' + String(e))
    } finally {
      if (requestId === calendarRequestId.current) setCalendarBusy(false)
    }
  }
  async function openOfficialCalendar(): Promise<void> {
    if (!isAndroid) { setNotice('此操作只能在 Android 设备上使用'); return }
    try {
      const result = await native.openOfficialCalendar()
      if (result.ok) { weeklyCache.current.clear(); void loadCalendar(weekStart, true) }
    }
    catch (e) { setNotice('无法打开交大官方课表：' + String(e)) }
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
    catch (e) { setNotice(String(e)) }
  }
  async function openDownloadedFile(uri: string): Promise<void> {
    try { await native.openDownloadedFile({ uri }) }
    catch (e) { setNotice('打开文件失败：' + String(e)) }
  }
  function clearFinishedHistory() {
    const count = jobs.filter(job => job.state !== 'active' && job.state !== 'queued').length
    if (!count) return
    if (!window.confirm('清除 ' + count + ' 条下载历史？此操作不会删除手机中已保存的文件。')) return
    setJobs(previous => previous.filter(job => job.state === 'active' || job.state === 'queued'))
    setNotice('已清除历史记录，手机中的下载文件仍然保留。')
  }

  const active = jobs.filter(j => j.state === 'active').length
  const today = shanghaiDate(new Date().toISOString())
  const calendarEvents = [...events,...neighborEvents,...examEvents,...personalEvents.map(asCalendarEvent)]
  const lastAgendaDate=dateOffset(today,13)
  const upcomingEvents=[...homeSchoolEvents,...examEvents,...personalEvents.map(asCalendarEvent)]
    .filter(event=>{
      const day=shanghaiDate(event.startTime)
      return day>=today&&day<=lastAgendaDate
    })
    .sort(compareEvents)
    .filter((event,index,list)=>list.findIndex(other=>other.id===event.id)===index)
  const firstThree=[today,dateOffset(today,1),dateOffset(today,2)]
  const extraAgendaDates=Array.from(new Set(upcomingEvents
    .map(event=>shanghaiDate(event.startTime))
    .filter(day=>day>firstThree[2]))).slice(0,7)
  const agendaDates=[...firstThree,...extraAgendaDates]
  // Only publish a complete, current-week snapshot. v0.4.11 sent an empty
  // array on mount and overwrote previously synchronized data before the first
  // network response. Preserve Android's last nonempty snapshot while loading.
  useEffect(() => {
    if (!isAndroid || sessionChecking) return
    if (loggedIn && !homeCalendarLoaded) return
    const school=loggedIn?homeSchoolEvents:[]
    const rows=[...school,...examEvents,...personalEvents.map(asCalendarEvent)].sort(compareEvents)
    const now=Date.now()
    const cutoff=now+21*24*60*60*1000
    const seen=new Set<string>()
    const items=rows.filter(event=>
      // Personal all-day tasks are not lectures starting at midnight.
      event.type==='assignment'||event.type==='exam'||
      !/^\d{4}-\d\d-\d\d$/.test(event.startTime)
    ).map(event=>{
      const kind=scheduleKind(event)
      // School timetable and personal timed plans are class/agenda entries;
      // all Canvas homework and recognized exams are displayed as deadlines.
      const deadline=kind==='homework'||kind==='exam'
      const startMs=eventMillis(event)
      const requestedEnd=Date.parse(event.endTime)
      const endMs=deadline ? startMs :
        Number.isFinite(requestedEnd)&&requestedEnd>startMs
          ? requestedEnd : startMs+45*60*1000
      return {
        id:event.id,title:event.title.trim(),location:schedulePlace(event),
        startMs,endMs,kind:deadline?'deadline' as const:'course' as const,
        category:kind==='exam'?'exam' as const:
          kind==='homework'?'homework' as const:
          event.type==='course'?'course' as const:'event' as const
      }
    }).filter(item=>item.title&&Number.isFinite(item.startMs)&&item.startMs<cutoff
      &&item.startMs>=now-8*24*60*60*1000
      &&Number.isFinite(item.endMs)&&(item.kind==='deadline'||item.endMs>item.startMs))
      .filter(item=>{
        const key=item.id||[item.title,item.startMs,item.kind].join('|')
        if(seen.has(key))return false
        seen.add(key)
        return true
      }).sort((a,b)=>a.startMs-b.startMs)
      .slice(0,300)
      .map(({title,location,startMs,endMs,kind,category})=>({
        title,location,startMs,endMs,kind,category
      }))
    // An empty remote response may be a temporary school outage. Do not erase
    // an otherwise valid widget cache unless the account was logged out.
    if(loggedIn&&items.length===0)return
    void native.updateTodayWidget({items,clear:!loggedIn})
      .then(()=>{if(widgetDetailsOpen)void refreshWidgetStatus()})
      .catch(error=>setWidgetMessage('组件同步失败：'+String(error)))
  },[loggedIn,sessionChecking,homeCalendarLoaded,homeSchoolEvents,examEvents,personalEvents,widgetDetailsOpen,refreshWidgetStatus])

  useEffect(()=>{
    if(widgetDetailsOpen)void refreshWidgetStatus()
  },[widgetDetailsOpen,refreshWidgetStatus])

  const batchActive = tab === 'courses' && loggedIn && !sessionChecking && selection.count > 0
  const tabIndex = nav.findIndex(item => item.id === tab)

  return <div className="app">
    <div className="ambient ambient-one" aria-hidden="true"/>
    <div className="ambient ambient-two" aria-hidden="true"/>
    <div className="app-shell">
      {tab === 'home' && <header className="topbar glass">
        <div className="brand">
          <div className="brand-mark"><img src="./desktop-logo.png" alt="SJTU Downloader"/></div>
          <strong>SJTU Downloader</strong>
        </div>
      </header>}
      {notice && <div role="alert" className="notice glass"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" size={17}/></button></div>}
      {!isAndroid && <div className="preview-note">网页预览 · 登录、下载需在 Android 设备上测试</div>}
      <section className="content">
        <div className={'screen-motion screen-motion--' + tabMotion} key={tab}>
          {tab === 'home' && <>
            <section className="home-stage glass-panel">
              <div className="home-kicker">SJTU · CAMPUS</div>
              <h1>{loggedIn ? '欢迎回来' : '学习，轻盈一点。'}</h1>
              {loggedIn ? <div className="welcome-name">{user || '已连接交大账号'}</div>
                : <div className="welcome-name">{sessionChecking ? '正在恢复登录…' : '你的课程与日程'}</div>}
              {!loggedIn && !sessionChecking && <button className="primary login-entry" disabled={!isAndroid || busy} onClick={() => void login()}>
                {busy ? '正在连接…' : '交我办登录'} <Icon name="arrow" size={17}/>
              </button>}
              {loggedIn && <div className="home-session-line">
                <span className="session-indicator"><span className="connected-dot"/>已连接</span>
                <button className="quiet-logout" onClick={() => void logout()}>退出账号</button>
              </div>}
            </section>
            <section className="today-brief recent-agenda">
              <div className="recent-agenda-head">
                <h2>近期安排 <span>课程、作业与个人日程</span></h2>
                <button type="button" onClick={()=>addSchedule(today)}>＋ 添加日程</button>
              </div>
              <div className="recent-agenda-groups">
                {agendaDates.map((date,index)=>{
                  const todayItems=upcomingEvents.filter(event=>shanghaiDate(event.startTime)===date)
                  const dateLabel=index===0?'今天':index===1?'明天':index===2?'后天':shortDate(date)
                  return <section className="recent-day glass" key={date}
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
                        return <div key={event.id} className={'recent-agenda-item agenda-'+kind}>
                          <span className="recent-agenda-time">{clockText(event.startTime)}</span>
                          <div className="recent-agenda-body">
                            <strong>{event.title}</strong>
                            <small>{scheduleLabel(kind)}
                              {schedulePlace(event)?' · '+schedulePlace(event):''}</small>
                          </div>
                          {personal&&<button type="button" onClick={()=>editSchedule(event.id)}
                            aria-label={'编辑 '+event.title}>编辑</button>}
                        </div>
                      })}
                    </div>:<p className="recent-day-empty">暂无安排</p>}
                  </section>
                })}
              </div>
            </section>
            {isAndroid && <section className="home-widget-panel glass">
              <button type="button" className="home-widget-toggle"
                aria-expanded={widgetDetailsOpen}
                onClick={()=>setWidgetDetailsOpen(value=>!value)}>
                <span><Icon name="calendar" size={17}/> 桌面课表小组件</span>
                <span className="home-widget-arrow">{widgetDetailsOpen?'收起':'检查状态'}</span>
              </button>
              {widgetDetailsOpen && <div className="home-widget-body">
                <p className="widget-data-state">
                  {widgetStatus?(
                    widgetStatus.instances===0?'尚未检测到添加的小组件':
                    widgetStatus.courses+widgetStatus.deadlines===0?'已添加组件，但本地还没有课表或 Deadline 数据':
                    '已缓存 '+widgetStatus.courses+' 条日程、'+widgetStatus.deadlines+
                    ' 条 Deadline；检测到 '+widgetStatus.instances+' 个组件'
                  ):'正在读取组件状态…'}
                </p>
                {widgetStatus?.updatedAt ? <p className="widget-status-sub">
                  最近同步：{new Date(widgetStatus.updatedAt).toLocaleString('zh-CN')}
                  {' · '}最近提交绘制：{widgetStatus.lastRenderedInstances} 个
                  {widgetStatus.lastRenderError?' · 原生提交异常：'+widgetStatus.lastRenderError:''}
                </p> : null}
                {widgetStatus && <p className="widget-status-sub">
                  后台电量限制：{widgetStatus.ignoringBatteryOptimizations?'系统标准电池优化已豁免':'可能受限制（可手动设置）'}
                  {' · '}桌面是否真的显示仍由系统启动器决定
                </p>}
                {widgetMessage&&<p role="status" className="widget-status-sub">{widgetMessage}</p>}
                <div className="widget-panel-buttons">
                  <button type="button" disabled={widgetBusy} onClick={()=>void refreshLauncherWidget()}>
                    {widgetBusy?'刷新中…':'重新绘制组件'}
                  </button>
                  <button type="button" onClick={()=>void openLauncherSettings('battery')}>后台耗电设置</button>
                  <button type="button" onClick={()=>void openLauncherSettings('app')}>应用权限设置</button>
                </div>
                <p className="widget-permission-guide">
                  {/vivo|iqoo/i.test(widgetStatus?.manufacturer||'')
                    ? 'vivo / iQOO：在系统设置搜索「自启动」「后台高耗电」或「后台耗电管理」，允许本应用后台活动。'
                    : /xiaomi|redmi/i.test(widgetStatus?.manufacturer||'')
                    ? '小米 / 红米：在系统设置搜索「后台自启动」并打开；省电策略设置为「无限制」。'
                    : /oppo|realme|oneplus/i.test(widgetStatus?.manufacturer||'')
                    ? 'OPPO / 一加 / realme：在应用耗电管理中允许后台活动和自启动。'
                    : /huawei|honor/i.test(widgetStatus?.manufacturer||'')
                    ? '华为 / 荣耀：在应用启动管理中关闭自动管理，允许自启动和后台运行。'
                    : '如果更新不及时，请在系统应用设置中允许后台活动和自启动。'}
                </p>
                <p className="widget-permission-guide">
                  桌面展示本机已同步的课表不需要存储权限。后台设置只能帮助后续更新；
                  如果课表仍为空，请先确认应用日历里已有课程和作业。
                </p>
              </div>}
            </section>}
          </>}
          {tab === 'courses' && (sessionChecking
            ? <div className="loading-note">正在恢复登录…</div>
            : <BatchCourseBrowser ref={courseBrowser} courses={courses} loggedIn={loggedIn} loading={busy}
                onLogin={() => void login()}
                onBatchDownload={downloadBatch} onNotice={setNotice} onSelectionChange={onSelectionChange}/>)}
          {tab === 'calendar' && <>
              <CalendarPage month={month} onMonthChange={setMonth} onWeekChange={setWeekStart}
                events={calendarEvents} busy={calendarBusy}
                onOfficial={()=>{if(loggedIn)void openOfficialCalendar();else void login()}}
                officialConnected={officialConnected}
                examConnected={examConnected} examChecking={examChecking}
                examWarning={examWarning} examSource={examSource}
                onExamConnect={()=>{if(loggedIn)void connectExams('study');else void login()}}
                onExamFallback={()=>{if(loggedIn)void connectExams('jiaowu');else void login()}}
                onAddSchedule={addSchedule} onEditSchedule={editSchedule}/>
              {!loggedIn&&<div className="calendar-notice">
                个人日程可离线使用；登录交我办后将合并显示学校课表与作业。
              </div>}
              {calendarWarning&&calendarWarning.includes('失败')&&
                <div className="calendar-notice" role="alert">{calendarWarning}</div>}
          </>}
          {tab === 'downloads' && <div className="downloads-layout">
            <div className="page-intro downloads-heading">
              <div><h1>下载</h1><span>学校课程文件</span></div>
              <div className="downloads-heading-actions">
                <span>{active>0?active+' 项进行中':jobs.length+' 项任务'}</span>
                {jobs.some(job=>job.state!=='active'&&job.state!=='queued')&&
                  <button type="button" className="downloads-clear" onClick={clearFinishedHistory}>
                    清除历史
                  </button>}
              </div>
            </div>
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
          </div>}

        </div>
      </section>
    </div>
    {editingSchedule&&<PersonalScheduleEditor
      key={editingSchedule.current?.id||editingSchedule.date}
      current={editingSchedule.current} initialDate={editingSchedule.date}
      onSave={savePersonalSchedule} onDelete={deletePersonalSchedule}
      onClose={()=>setEditingSchedule(null)}/>}
    <div className={'bottom-dock glass' + (batchActive ? ' is-batch' : '')}>
      {batchActive ? <div className="batch-dock" role="group" aria-label="批量下载操作">
        <button type="button" className="primary batch-dock-action" disabled={!isAndroid || selection.busy}
          onClick={() => courseBrowser.current?.downloadSelection()}>
          <Icon name="download" size={20}/>
          {selection.busy ? '正在扫描课程资料…'
            : selection.scope === 'files' ? '下载 ' + selection.count + ' 个文件'
              : '下载 ' + selection.count + ' 门课程'}
        </button>
      </div> : <nav className="bottom-nav" aria-label="主导航">
        <span className="nav-slider" aria-hidden="true"
          style={{ transform: 'translate3d(' + (tabIndex * 100) + '%,0,0)' }}/>
        {nav.map(item => <button type="button" key={item.id}
          className={item.id === tab ? 'selected' : ''} onClick={() => switchTab(item.id)}
          aria-current={item.id === tab ? 'page' : undefined}>
          <span className="nav-icon"><Icon name={item.icon} size={21}/></span><span>{item.text}</span>
        </button>)}
      </nav>}
    </div>
  </div>
}
