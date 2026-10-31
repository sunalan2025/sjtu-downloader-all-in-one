import { useEffect, useState } from 'react'
import native, { isAndroid, type CanvasCourse, type DownloadProgress, type CalendarEvent, type CourseDownloadItem } from './native'
import { BatchCourseBrowser } from './BatchCourseBrowser'
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
  const [loggedIn, setLoggedIn] = useState(false)
  const [user, setUser] = useState('')
  const [courses, setCourses] = useState<CanvasCourse[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [month, setMonth] = useState(currentMonth())
  const [busy, setBusy] = useState(false)
  const [calendarBusy, setCalendarBusy] = useState(false)
  const [calendarWarning, setCalendarWarning] = useState('')
  const [calendarAuthRequired, setCalendarAuthRequired] = useState(false)
  const [diagnostic, setDiagnostic] = useState('')
  const [diagnosing, setDiagnosing] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!isAndroid) return
    void refreshSession()
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
    return () => { disposed = true; window.removeEventListener('resize', applyInsets); if (handle) void handle.remove() }
  }, [])

  useEffect(() => {
    if (!isAndroid || !loggedIn) return
    void loadCalendar(month)
  }, [month, loggedIn])

  async function refreshSession(): Promise<void> {
    try {
      const result = await native.status()
      setLoggedIn(result.loggedIn)
      setUser(result.name || '')
      if (result.loggedIn) await loadCourses()
    } catch (e) { setNotice('连接 Canvas 失败：' + String(e)) }
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
    try {
      await native.logout()
      setLoggedIn(false); setUser(''); setCourses([]); setEvents([]); setCalendarWarning(''); setCalendarAuthRequired(false)
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
    setCalendarBusy(true)
    try {
      const result = await native.calendar({ month: target })
      setEvents(result.items)
      setCalendarWarning(result.warning || '')
      setCalendarAuthRequired(!!result.authRequired)
    } catch (e) {
      setEvents([])
      setCalendarAuthRequired(false)
      setCalendarWarning('日历同步失败：' + String(e))
    }
    finally { setCalendarBusy(false) }
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
      setDiagnostic('Canvas Cookie: ' + d.canvasCookie + '\n'
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
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><img src="./desktop-logo.png" alt="SJTU Downloader 桌面版图标"/></div><div className="brand-text"><strong>SJTU Downloader</strong><small>上海交通大学 · 课程助手</small></div></div>
        <button className="avatar-button" aria-label={loggedIn ? '退出登录' : '登录账号'} onClick={() => loggedIn ? void logout() : void login()} title={loggedIn ? '退出登录' : '登录账号'}><Icon name={loggedIn ? 'shield' : 'school'} size={20}/></button>
      </header>
      {notice && <div role="alert" className="notice"><Icon name="alert" size={17}/><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" size={15}/></button></div>}
      {!isAndroid && <div className="notice"><Icon name="alert" size={17}/><span>浏览器仅预览 UI。登录、课表同步和下载请在 Android 客户端中测试。</span></div>}
      <section className="content">
        {tab === 'home' && <>
          <section className="hero">
            <div className="eyebrow">WELCOME TO YOUR CAMPUS</div>
            <h1>{loggedIn ? <>今天也要<br/><span>好好学习。</span></> : <>你的交大课程，<br/><span>随身携带。</span></>}</h1>
            <p>{loggedIn ? (user ? user + '，欢迎回来。课程与资料已准备就绪。' : '连接课程，随时掌握学习动态。') : '课程资料、日历日程、文件下载，一个应用轻松管理。'}</p>
            <button className="cta" disabled={!isAndroid || busy} onClick={() => loggedIn ? setTab('courses') : void login()}>{busy ? '正在连接…' : loggedIn ? '查看我的课程' : '使用 jAccount 登录'}<Icon name="arrow" size={17}/></button>
          </section>
          <div className="section-title"><div><h2>学习概况</h2><p>你的课程与下载动态</p></div></div>
          <div className="metric-grid">
            <div className="metric"><span className="mini-icon"><Icon name="book" size={18}/></span><strong>{courses.length}</strong><small>Canvas 课程</small></div>
            <div className="metric"><span className="mini-icon"><Icon name="check" size={18}/></span><strong>{finished}</strong><small>本次已完成</small></div>
            <div className="metric"><span className="mini-icon"><Icon name="download" size={18}/></span><strong>{active}</strong><small>正在下载</small></div>
          </div>
          <div className="section-title"><div><h2>今日安排</h2><p>{today} · 北京时间</p></div><button className="detail-link" onClick={() => setTab('calendar')}>查看日历 <Icon name="right" size={15}/></button></div>
          {loggedIn && todayEvents.length ? <div className="agenda-list">{todayEvents.map(e => <div className="agenda-item" key={e.id}><span className="agenda-icon"><Icon name={e.type==='assignment'?'clock':'calendar'} size={18}/></span><div className="agenda-text"><strong>{e.title}</strong><small>{e.courseName || (e.type==='assignment'?'作业截止':'Canvas 活动')}</small></div></div>)}</div> : <div className="empty-box"><div className="empty-picture"><Icon name="calendar" size={27}/></div><strong>{loggedIn ? '今天暂无 Canvas 日程' : '登录后同步日历'}</strong><p>{loggedIn ? '点开日历查看其他日期及课程活动。' : '同步你的 Canvas 日历与作业截止日期。'}</p></div>}
          <div className="section-title"><div><h2>快捷入口</h2></div></div>
          <div className="quick-list">
            <button className="quick-card" onClick={() => setTab('courses')}><span className="tile-icon"><Icon name="book" size={22}/></span><span className="tile-text"><strong>我的课程</strong><small>浏览与下载 Canvas 课件</small></span><Icon name="right" className="chevron" size={17}/></button>
            <button className="quick-card" onClick={() => setTab('calendar')}><span className="tile-icon turquoise"><Icon name="calendar" size={22}/></span><span className="tile-text"><strong>课程日历</strong><small>查看活动、DDL 和官方课表入口</small></span><Icon name="right" className="chevron" size={17}/></button>
            <button className="quick-card" onClick={() => setTab('downloads')}><span className="tile-icon violet"><Icon name="download" size={22}/></span><span className="tile-text"><strong>下载管理</strong><small>任务进度与历史记录</small></span><Icon name="right" className="chevron" size={17}/></button>
          </div>
          {loggedIn && <div className="account-line"><span>当前账号 · {user || '已连接'}</span><button onClick={() => void logout()}>退出登录</button></div>}
        </>}
        {tab === 'courses' && <BatchCourseBrowser
          courses={courses}
          loggedIn={loggedIn}
          loading={busy}
          onRefresh={() => void loadCourses()}
          onLogin={() => void login()}
          onBatchDownload={downloadBatch}
          onNotice={setNotice}
        />}
        {tab === 'calendar' && (loggedIn ?
          <>
            {calendarWarning && <div role="alert" className="notice calendar-warning"><Icon name="alert" size={18}/><span>{calendarWarning}</span>{calendarAuthRequired && <button className="text-button" onClick={() => void login()}>重新登录</button>}</div>}
            <CalendarPage month={month} onMonthChange={setMonth} events={events} busy={calendarBusy} onRefresh={() => void loadCalendar(month)} onOfficial={() => void openOfficialCalendar()}/>
            <div className="surface" style={{marginTop:18}}>
              <h3>接口诊断</h3>
              <p className="disclaimer">只显示状态码及 Cookie 是否存在，不上传账号或 Cookie。</p>
              <button className="primary" disabled={diagnosing} onClick={() => void diagnoseConnection()}>{diagnosing?'正在检测…':'检测认证状态'}</button>
              {diagnostic && <pre className="diagnostic-output">{diagnostic}</pre>}
            </div>
          </>
          : <><div className="page-intro"><span className="eyebrow">STUDENT CALENDAR</span><h1>我的日程</h1><p>一页掌握学习节奏。</p></div><div className="empty-box"><div className="empty-picture"><Icon name="calendar" size={28}/></div><strong>登录后同步日历</strong><p>支持 Canvas 活动与作业截止日期。官方课表可通过单独入口查看。</p><button className="primary" disabled={!isAndroid || busy} onClick={() => void login()}>连接 jAccount <Icon name="arrow" size={15}/></button></div><button className="official-card" onClick={() => void openOfficialCalendar()}><span className="official-icon"><Icon name="school" size={21}/></span><span style={{flex:1}}><strong>查看交大官方课表</strong><small>前往 calendar.sjtu.edu.cn</small></span><Icon name="external" size={17}/></button></>)}
        {tab === 'downloads' && <>
          <div className="page-intro"><span className="eyebrow">TRANSFERS</span><h1>下载管理</h1><p>查看资料下载状态与进度。</p></div>
          <div className="metric-grid"><div className="metric"><span className="mini-icon"><Icon name="download" size={18}/></span><strong>{active}</strong><small>正在下载</small></div><div className="metric"><span className="mini-icon"><Icon name="check" size={18}/></span><strong>{finished}</strong><small>已完成</small></div><div className="metric"><span className="mini-icon"><Icon name="file" size={18}/></span><strong>{jobs.length}</strong><small>全部任务</small></div></div>
          <div className="section-title"><div><h2>传输列表</h2><p>{jobs.length} 项任务</p></div></div>
          {!jobs.length ? <div className="empty-box"><div className="empty-picture"><Icon name="download" size={28}/></div><strong>还没有下载任务</strong><p>进入课程页面，选择需要保存的课件即可。</p><button className="primary" onClick={() => setTab('courses')}>浏览课程 <Icon name="arrow" size={16}/></button></div> : <div className="job-list">{jobs.map(j => <div className="job-card" key={j.taskId}>
            <div className="job-row"><div className="file-badge"><Icon name="download" size={19}/></div><div className="job-content"><strong>{j.fileName}</strong><small>{j.state === 'done' ? '已存入应用专属下载目录' : j.state === 'active' ? formatBytes(j.bytes) + ' / ' + formatBytes(j.total) : j.state === 'queued' ? '等待下载队列' : j.state === 'cancelled' ? '已取消' : '下载失败'}</small></div><span className={'job-state ' + j.state}>{j.state === 'done' ? '完成' : j.state === 'active' ? '下载中' : j.state === 'queued' ? '排队中' : j.state === 'cancelled' ? '已取消' : '失败'}</span></div>
            <div className="progress-track"><div style={{width:(j.state==='done'?100:j.total>0?Math.min(100,(j.bytes/j.total)*100):3)+'%'}}/></div>
            {j.state === 'active' && <button className="text-button" onClick={() => void cancel(j.taskId)}>取消下载</button>}
            {j.error && <small className="error-text">{j.error}</small>}
          </div>)}</div>}
          <p className="disclaimer">当前任务仅在应用运行期间管理，尚不支持断点续传及杀进程后恢复。已下载文件保存在应用专属文件目录。</p>
        </>}
      </section>
    </div>
    <nav className="bottom-nav" aria-label="主导航">{nav.map(item=><button type="button" key={item.id} className={item.id === tab ? 'selected' : ''} onClick={() => setTab(item.id)} aria-current={item.id===tab?'page':undefined}><span className="nav-icon"><Icon name={item.icon} size={21}/></span><span>{item.text}</span></button>)}</nav>
  </div>
}
