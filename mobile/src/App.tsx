import { useCallback, useEffect, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Haptics } from '@capacitor/haptics'
import native, { isAndroid, type CanvasCourse, type DownloadProgress, type CalendarEvent, type CourseDownloadItem } from './native'
import { BatchCourseBrowser, type CourseBrowserHandle, type CourseSelection } from './BatchCourseBrowser'
import { CalendarPage, currentMonth, currentWeekStart, shanghaiDate } from './CalendarPage'
import { Icon, type IconName } from './Icon'
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
  const [neighborEvents, setNeighborEvents] = useState<CalendarEvent[]>([])
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

  async function refreshSession(): Promise<void> {
    setSessionChecking(true)
    try {
      const result = await native.status()
      setLoggedIn(result.loggedIn)
      setUser(result.name || '')
      if (result.loggedIn) await loadCourses()
    } catch (e) { setNotice('连接 Canvas 失败：' + String(e)) }
    finally { setSessionChecking(false) }
  }
  async function login(): Promise<void> {
    if (!isAndroid) return
    setBusy(true); setNotice('')
    try {
      await native.login()
      await refreshSession()
      showTab('courses')
    } catch (e) { setNotice('登录未完成：' + String(e)) }
    finally { setBusy(false) }
  }
  async function logout(): Promise<void> {
    if (!window.confirm('确定退出登录吗？这会清除手机上保存的交大登录会话。')) return
    try {
      await native.logout()
      weeklyCache.current.clear(); setLoggedIn(false); setUser(''); setCourses([]); setEvents([]); setCalendarWarning(''); setOfficialConnected(false)
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
      setCalendarWarning('日程同步失败，请点击刷新重试：' + String(e))
    } finally {
      if (requestId === calendarRequestId.current) setCalendarBusy(false)
    }
  }
  async function openOfficialCalendar(): Promise<void> {
    if (!isAndroid) { setNotice('此操作只能在 Android 设备上使用'); return }
    try {
      const result = await native.openOfficialCalendar()
      if (result.ok) { weeklyCache.current.clear(); await loadCalendar(weekStart, true) }
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
  const finished = jobs.filter(j => j.state === 'done').length
  const today = shanghaiDate(new Date().toISOString())
  const calendarEvents = [...events,...neighborEvents,...personalEvents.map(asCalendarEvent)]
  const upcomingEvents = calendarEvents
    .filter(event => shanghaiDate(event.startTime)>=today)
    .sort((a,b)=>a.startTime.localeCompare(b.startTime))
    .filter((event,index,list)=>list.findIndex(other=>other.id===event.id)===index)
    .slice(0,6)
  const batchActive = tab === 'courses' && loggedIn && !sessionChecking && selection.count > 0
  const tabIndex = nav.findIndex(item => item.id === tab)

  return <div className="app">
    <div className="ambient ambient-one" aria-hidden="true"/>
    <div className="ambient ambient-two" aria-hidden="true"/>
    <div className="app-shell">
      <header className="topbar glass">
        <div className="brand">
          <div className="brand-mark"><img src="./desktop-logo.png" alt="SJTU Downloader"/></div>
          <strong>SJTU Downloader</strong>
        </div>

      </header>
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
            <section className="home-summary glass">
              <div><strong>{courses.length}</strong><span>课程</span></div>
              <div className="summary-divider"/>
              <div><strong>{active}</strong><span>下载中</span></div>
              <div className="summary-divider"/>
              <div><strong>{finished}</strong><span>已完成</span></div>
            </section>
            <section className="today-brief recent-agenda">
              <div className="recent-agenda-head">
                <h2>近期安排 <span>课程、作业与个人日程</span></h2>
                <button type="button" onClick={()=>addSchedule(today)}>＋ 添加日程</button>
              </div>
              <div className="compact-agenda glass">
                {upcomingEvents.length===0 ? <div className="upcoming-empty">
                  近期暂无安排，可以添加自己的日程
                </div> : upcomingEvents.map(event=>
                  <button type="button" className={'compact-event upcoming-event'+
                      (event.id.startsWith('personal-')?' is-personal':'')}
                    key={event.id} disabled={!event.id.startsWith('personal-')}
                    onClick={()=>editSchedule(event.id)}>
                    <span className="event-dot"/>
                    <span className="upcoming-event-body">
                      <strong>{event.title}</strong>
                      <small>{shanghaiDate(event.startTime).slice(5).replace('-','/')}{' '}
                        {event.startTime.length===10?'全天':new Intl.DateTimeFormat('zh-CN',{
                          hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Shanghai'
                        }).format(new Date(event.startTime))}
                        {event.id.startsWith('personal-')?' · 个人日程':''}</small>
                    </span>
                    {event.id.startsWith('personal-')&&<span className="upcoming-edit">编辑</span>}
                  </button>)}
              </div>
            </section>
          </>}
          {tab === 'courses' && (sessionChecking
            ? <div className="loading-note">正在恢复登录…</div>
            : <BatchCourseBrowser ref={courseBrowser} courses={courses} loggedIn={loggedIn} loading={busy}
                onRefresh={() => void loadCourses()} onLogin={() => void login()}
                onBatchDownload={downloadBatch} onNotice={setNotice} onSelectionChange={onSelectionChange}/>)}
          {tab === 'calendar' && <>
              <CalendarPage month={month} onMonthChange={setMonth} onWeekChange={setWeekStart}
                events={calendarEvents} busy={calendarBusy}
                onRefresh={()=>{if(loggedIn)void loadCalendar(weekStart,true)}}
                onOfficial={()=>{if(loggedIn)void openOfficialCalendar();else void login()}}
                officialConnected={officialConnected}
                onAddSchedule={addSchedule} onEditSchedule={editSchedule}/>
              {!loggedIn&&<div className="calendar-notice">
                个人日程可离线使用；登录交我办后将合并显示学校课表与作业。
              </div>}
              {calendarWarning&&calendarWarning.includes('失败')&&
                <div className="calendar-notice" role="alert">{calendarWarning}</div>}
          </>}
          {tab === 'downloads' && <>
            <div className="page-intro downloads-head"><h1>下载</h1>
              <div className="downloads-head-actions">
                <span className="muted-count">{active ? active + ' 项进行中' : jobs.length + ' 项任务'}</span>
                {jobs.some(job => job.state !== 'active' && job.state !== 'queued') &&
                  <button className="clear-history-action" onClick={clearFinishedHistory}>清除历史</button>}
              </div>
            </div>
            <div className="download-location glass">
              <div className="download-location-text">
                <strong>文件保存位置</strong>
                <span>手机文件管理 → 下载 → SJTU Downloader</span>
              </div>
            </div>
            {!jobs.length ? <div className="empty-box glass"><Icon name="download" size={29}/><strong>暂无下载</strong></div>
              : <div className="job-list">{jobs.map(j => <div className="job-card glass" key={j.taskId}>
                <div className="job-row">
                  <div className="file-badge"><Icon name="download" size={18}/></div>
                  <div className="job-content"><strong>{j.fileName}</strong>
                    <small>{j.state === 'active' ? formatBytes(j.bytes) + ' / ' + formatBytes(j.total)
                      : j.state === 'done' ? '已完成'
                      : j.state === 'queued' ? '等待中'
                      : j.state === 'cancelled' ? '已取消' : '下载失败'}</small>
                  </div>
                  {j.state === 'done' ? <Icon name="check" size={19} className="done-check"/> :
                    <span className={'job-state ' + j.state}>{j.state === 'active' ? '下载中' : j.state === 'queued' ? '排队' : j.state === 'error' ? '失败' : ''}</span>}
                </div>
                {(j.state === 'active' || j.state === 'queued') && <div className="progress-track">
                  <div style={{width: (j.total > 0 ? Math.min(100, (j.bytes / j.total) * 100) : 3) + '%'}}/>
                </div>}
                {j.state === 'active' && <button className="text-button cancel-action" onClick={() => void cancel(j.taskId)}>取消</button>}
                {j.state === 'done' && j.savedPath && <div className="download-saved">
                  <span title={j.savedPath}>已保存：{j.savedPath}</span>
                  {j.uri?.startsWith('content://media/') &&
                    <button type="button" onClick={() => void openDownloadedFile(j.uri!)}>打开文件</button>}
                </div>}
                {j.error && <small className="error-text">{j.error}</small>}
              </div>)}</div>}
          </>}
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
