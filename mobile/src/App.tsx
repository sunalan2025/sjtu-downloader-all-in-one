import { useCallback, useEffect, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Haptics } from '@capacitor/haptics'
import native, { isAndroid, type CanvasCourse, type DownloadProgress, type CalendarEvent, type CourseDownloadItem } from './native'
import { BatchCourseBrowser, type CourseBrowserHandle } from './BatchCourseBrowser'
import { CalendarPage, currentMonth, shanghaiDate } from './CalendarPage'
import { Icon, type IconName } from './Icon'

type Tab = 'home' | 'courses' | 'calendar' | 'downloads'
type Job = { taskId: string; fileName: string; state: 'queued' | 'active' | 'done' | 'error' | 'cancelled'; bytes: number; total: number; error?: string }

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
  const calendarRequestId = useRef(0)
  const lastCalendarFetch = useRef(0)
  const onSystemBack = useCallback(() => {
    // The Android system gesture/button first closes a nested course view,
    // then moves to Home, and only minimizes from the root.
    if (tabRef.current === 'courses' && courseBrowser.current?.goBack()) return
    if (tabRef.current !== 'home') { setTab('home'); return }
    void CapacitorApp.minimizeApp().catch(() => {})
  }, [])
  const switchTab = (next: Tab) => {
    if (next === tab) return
    if (next === 'calendar') {
      // Returning to the calendar always shows today's schedule automatically.
      const current = currentMonth()
      if (month !== current) setMonth(current)
      else if (loggedIn && Date.now() - lastCalendarFetch.current > 90_000) void loadCalendar(current)
    }
    if (isAndroid) void Haptics.selectionChanged().catch(() => {})
    setTab(next)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  const [loggedIn, setLoggedIn] = useState(false)
  const [sessionChecking, setSessionChecking] = useState(isAndroid)
  const [user, setUser] = useState('')
  const [courses, setCourses] = useState<CanvasCourse[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [month, setMonth] = useState(currentMonth())
  const [busy, setBusy] = useState(false)
  const [calendarBusy, setCalendarBusy] = useState(false)
  const [calendarWarning, setCalendarWarning] = useState('')
  const [calendarAuthRequired, setCalendarAuthRequired] = useState(false)
  const [officialConnected, setOfficialConnected] = useState(false)
  const [diagnostic, setDiagnostic] = useState('')
  const [diagnosing, setDiagnosing] = useState(false)
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
      if (!disposed) void loadCalendar(currentMonth())
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
    void loadCalendar(month)
  }, [month, loggedIn])

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
      setTab('courses')
    } catch (e) { setNotice('登录未完成：' + String(e)) }
    finally { setBusy(false) }
  }
  async function logout(): Promise<void> {
    if (!window.confirm('确定退出登录吗？这会清除手机上保存的交大登录会话。')) return
    try {
      await native.logout()
      setLoggedIn(false); setUser(''); setCourses([]); setEvents([]); setCalendarWarning(''); setCalendarAuthRequired(false); setOfficialConnected(false)
      setTab('home')
    } catch (e) { setNotice(String(e)) }
  }
  async function loadCourses(): Promise<void> {
    setBusy(true)
    try { setCourses((await native.courses()).items) }
    catch (e) { setNotice('读取课程失败：' + String(e)) }
    finally { setBusy(false) }
  }
  async function loadCalendar(target: string): Promise<void> {
    const requestId = ++calendarRequestId.current
    setCalendarBusy(true)
    try {
      const result = await native.calendar({ month: target })
      if (requestId !== calendarRequestId.current) return
      setEvents(result.items)
      setOfficialConnected(!!result.officialConnected)
      setCalendarWarning(result.warning || '')
      setCalendarAuthRequired(!!result.authRequired)
      lastCalendarFetch.current = Date.now()
    } catch (e) {
      if (requestId !== calendarRequestId.current) return
      setEvents([])
      setOfficialConnected(false)
      setCalendarAuthRequired(false)
      setCalendarWarning('日程同步失败：' + String(e))
    } finally {
      if (requestId === calendarRequestId.current) setCalendarBusy(false)
    }
  }
  async function openOfficialCalendar(): Promise<void> {
    if (!isAndroid) { setNotice('此操作只能在 Android 设备上使用'); return }
    try {
      const result = await native.openOfficialCalendar()
      if (result.ok) await loadCalendar(month)
    }
    catch (e) { setNotice('无法打开交大官方课表：' + String(e)) }
  }
  async function diagnoseConnection(): Promise<void> {
    if (!isAndroid) return
    setDiagnosing(true)
    try {
      const d = await native.diagnoseAuth()
      setDiagnostic('已加密保存登录会话: ' + (d.savedSessionEncrypted ? '是' : '否') + '\n'
        + 'Canvas Cookie: ' + d.canvasCookie + '\n'
        + 'jAccount Cookie: ' + d.jaccountCookie + '\n'
        + '正式课表 Cookie: ' + d.officialCalendarCookie + '\n'
        + 'Canvas 用户信息: ' + d.canvasProfile + '\n'
        + 'Canvas 课程: ' + d.canvasCourses + '\n'
        + 'Canvas 日历: ' + d.canvasCalendar + '\n'
        + '正式课表: ' + d.officialCalendar)
    } catch(e) { setDiagnostic('诊断异常：' + String(e)) }
    finally { setDiagnosing(false) }
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
    setTab('downloads')
    let cursor = 0
    async function worker() {
      while (cursor < specs.length) {
        const job = specs[cursor++]
        setJobs(old => old.map(j => j.taskId === job.taskId ? { ...j, state: 'active' } : j))
        try {
          await native.download({
            fileId: job.file.id,
            taskId: job.taskId,
            term: job.term,
            courseName: job.courseName
          })
          setJobs(old => old.map(j => j.taskId === job.taskId ?
            { ...j, state: 'done', bytes: j.total } : j))
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

  const active = jobs.filter(j => j.state === 'active').length
  const finished = jobs.filter(j => j.state === 'done').length
  const today = shanghaiDate(new Date().toISOString())
  const todayEvents = events.filter(e => shanghaiDate(e.startTime) === today).slice(0, 3)

  return <div className="app">
    <div className="ambient ambient-one" aria-hidden="true"/>
    <div className="ambient ambient-two" aria-hidden="true"/>
    <div className="app-shell">
      <header className="topbar glass">
        <div className="brand">
          <div className="brand-mark"><img src="./desktop-logo.png" alt="SJTU Downloader"/></div>
          <strong>SJTU Downloader</strong>
        </div>
        <button className="avatar-button glass-interactive" disabled={sessionChecking}
          aria-label={sessionChecking ? '正在检查会话' : loggedIn ? '退出登录' : '登录'}
          onClick={() => loggedIn ? void logout() : void login()}>
          <Icon name={loggedIn ? 'shield' : 'school'} size={20}/>
        </button>
      </header>
      {notice && <div role="alert" className="notice glass"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" size={17}/></button></div>}
      {!isAndroid && <div className="preview-note">网页预览 · 登录、下载需在 Android 设备上测试</div>}
      <section className="content">
        <div className="screen-motion" key={tab}>
          {tab === 'home' && <>
            <section className="home-stage glass-panel">
              <div className="home-kicker">SJTU · CAMPUS</div>
              <h1>{loggedIn ? '欢迎回来' : '学习，轻盈一点。'}</h1>
              {loggedIn ? <div className="welcome-name">{user || '已连接交大账号'}</div>
                : <div className="welcome-name">{sessionChecking ? '正在恢复登录…' : '你的课程与日程'}</div>}
              {!loggedIn && !sessionChecking && <button className="primary login-entry" disabled={!isAndroid || busy} onClick={() => void login()}>
                {busy ? '正在连接…' : '交我办登录'} <Icon name="arrow" size={17}/>
              </button>}
              {loggedIn && <div className="session-indicator"><span className="connected-dot"/>已连接</div>}
            </section>
            <section className="home-summary glass">
              <div><strong>{courses.length}</strong><span>课程</span></div>
              <div className="summary-divider"/>
              <div><strong>{active}</strong><span>下载中</span></div>
              <div className="summary-divider"/>
              <div><strong>{finished}</strong><span>已完成</span></div>
            </section>
            {loggedIn && todayEvents.length > 0 && <section className="today-brief">
              <h2>今日安排 <span>{today.slice(5)}</span></h2>
              <div className="compact-agenda glass">
                {todayEvents.map(e => <div className="compact-event" key={e.id}>
                  <span className="event-dot"/><span>{e.title}</span>
                </div>)}
              </div>
            </section>}
          </>}
          {tab === 'courses' && (sessionChecking
            ? <div className="loading-note">正在恢复登录…</div>
            : <BatchCourseBrowser ref={courseBrowser} courses={courses} loggedIn={loggedIn} loading={busy}
                onRefresh={() => void loadCourses()} onLogin={() => void login()}
                onBatchDownload={downloadBatch} onNotice={setNotice}/>)}
          {tab === 'calendar' && (loggedIn
            ? <>
              <CalendarPage month={month} onMonthChange={setMonth} events={events}
                busy={calendarBusy} onRefresh={() => void loadCalendar(month)}
                onOfficial={() => void openOfficialCalendar()} officialConnected={officialConnected}/>
              <details className="diagnostic glass">
                <summary><Icon name="shield" size={16}/>连接状态 <Icon name="right" size={15}/></summary>
                {calendarWarning && <p className="diagnostic-hint">{calendarWarning}</p>}
                {calendarAuthRequired && <button className="text-button" onClick={() => void login()}>重新登录 Canvas</button>}
                <button className="text-button" disabled={diagnosing} onClick={() => void diagnoseConnection()}>
                  {diagnosing ? '检测中…' : '检测接口'}
                </button>
                {diagnostic && <pre className="diagnostic-output">{diagnostic}</pre>}
              </details>
            </>
            : <>
              <div className="page-intro"><h1>日历</h1></div>
              <div className="empty-box glass"><strong>登录后查看日程</strong>
                <button className="primary" disabled={!isAndroid || busy} onClick={() => void login()}>交我办登录 <Icon name="arrow" size={17}/></button>
              </div>
            </>)}
          {tab === 'downloads' && <>
            <div className="page-intro"><h1>下载</h1><span className="muted-count">{active ? active + ' 项进行中' : jobs.length + ' 项任务'}</span></div>
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
                {j.error && <small className="error-text">{j.error}</small>}
              </div>)}</div>}
          </>}
        </div>
      </section>
    </div>
    <nav className="bottom-nav glass" aria-label="主导航">{nav.map(item => <button type="button" key={item.id}
      className={item.id === tab ? 'selected' : ''} onClick={() => switchTab(item.id)}
      aria-current={item.id === tab ? 'page' : undefined}>
      <span className="nav-icon"><Icon name={item.icon} size={21}/></span><span>{item.text}</span>
    </button>)}</nav>
  </div>
}
