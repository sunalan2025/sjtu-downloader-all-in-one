import { useEffect, useMemo, useState } from 'react'
import native, { isAndroid, type CanvasCourse, type CanvasFile, type DownloadProgress } from './native'

type Tab = 'home' | 'courses' | 'downloads'
type Job = { taskId: string; fileName: string; state: 'active' | 'done' | 'error' | 'cancelled'; bytes: number; total: number; error?: string }
function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value < 1024) return Math.round(value) + ' B'
  if (value < 1024 ** 2) return (value / 1024).toFixed(1) + ' KB'
  if (value < 1024 ** 3) return (value / 1024 ** 2).toFixed(1) + ' MB'
  return (value / 1024 ** 3).toFixed(2) + ' GB'
}

const glyph: Record<Tab, string> = { home: '⌂', courses: '▦', downloads: '↓' }

export default function App() {
  const [tab, setTab] = useState<Tab>('home')
  const [loggedIn, setLoggedIn] = useState(false)
  const [user, setUser] = useState('')
  const [courses, setCourses] = useState<CanvasCourse[]>([])
  const [course, setCourse] = useState<CanvasCourse | null>(null)
  const [files, setFiles] = useState<CanvasFile[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!isAndroid) return
    void refreshSession()
    let disposed = false
    let handle: { remove(): Promise<void> } | undefined
    void native.addListener('downloadProgress', (event: DownloadProgress) => {
      if (disposed) return
      setJobs(previous => previous.map(j => j.taskId === event.taskId
        ? { ...j, bytes: event.bytes, total: event.total } : j))
    }).then(h => { if (disposed) void h.remove(); else handle = h })
    return () => { disposed = true; if (handle) void handle.remove() }
  }, [])

  async function refreshSession(): Promise<void> {
    try {
      const result = await native.status()
      setLoggedIn(result.loggedIn)
      setUser(result.name || '')
      if (result.loggedIn) await loadCourses()
    } catch (e) { setNotice('连接 Canvas 失败：' + String(e)) }
  }

  async function login(): Promise<void> {
    setBusy(true)
    setNotice('')
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
      setLoggedIn(false); setUser(''); setCourses([]); setCourse(null); setFiles([])
      setTab('home')
    } catch (e) { setNotice(String(e)) }
  }

  async function loadCourses(): Promise<void> {
    setBusy(true)
    try { setCourses((await native.courses()).items) }
    catch (e) { setNotice('读取课程失败：' + String(e)) }
    finally { setBusy(false) }
  }

  async function openCourse(selected: CanvasCourse): Promise<void> {
    setBusy(true); setCourse(selected); setSearch(''); setFiles([])
    try { setFiles((await native.files({ courseId: selected.id })).items) }
    catch (e) { setNotice('读取课件失败：' + String(e)) }
    finally { setBusy(false) }
  }

  async function download(file: CanvasFile): Promise<void> {
    if (file.locked) return
    const taskId = String(Date.now()) + '-' + file.id
    setJobs(old => [{ taskId, fileName: file.name, state: 'active', bytes: 0, total: file.size }, ...old])
    setTab('downloads')
    try {
      await native.download({ fileId: file.id, taskId })
      setJobs(old => old.map(j => j.taskId === taskId ? { ...j, state: 'done', bytes: j.total } : j))
    } catch (e) {
      const message = String(e)
      setJobs(old => old.map(j => j.taskId === taskId ? {
        ...j, state: message.includes('取消') ? 'cancelled' : 'error', error: message
      } : j))
    }
  }

  async function cancel(taskId: string): Promise<void> {
    try { await native.cancelDownload({ taskId }) }
    catch (e) { setNotice(String(e)) }
  }

  const filtered = useMemo(() => files.filter(f => f.name.toLowerCase().includes(search.toLowerCase())), [files, search])
  const active = jobs.filter(j => j.state === 'active').length
  const finished = jobs.filter(j => j.state === 'done').length

  return <main>
    <div className="top-glow" />
    <header className="topbar">
      <div className="brand"><div className="logo">S</div><div><strong>SJTU Downloader</strong><small>ANDROID · EARLY ACCESS</small></div></div>
      <span className={'status ' + (loggedIn ? 'online' : '')}><span className="dot" />{loggedIn ? '已连接' : '未登录'}</span>
    </header>
    {notice && <div role="alert" className="notice" onClick={() => setNotice('')}>{notice}<b>×</b></div>}
    {!isAndroid && <div className="notice">网页预览模式：登录与文件下载只能在 Android App 中使用。</div>}
    <section className="content">
      {tab === 'home' && <>
        <div className="hero"><span className="eyebrow">你的课程，一触即达</span><h1>把知识<br /><em>装进口袋。</em></h1><p>上海交通大学课程资料下载与管理，专为移动端打造。</p>
          {!loggedIn ? <button className="primary" disabled={!isAndroid || busy} onClick={() => void login()}>{busy ? '正在连接…' : '使用 jAccount 登录'} <span>↗</span></button>
            : <button className="primary" onClick={() => { setTab('courses'); void loadCourses() }}>浏览我的课程 <span>→</span></button>}
        </div>
        <div className="section-heading"><h2>一览概况</h2><span>LIVE OVERVIEW</span></div>
        <div className="stats"><div><span>已同步课程</span><strong>{courses.length}</strong><small>Canvas</small></div><div><span>完成下载</span><strong>{finished}</strong><small>本次会话</small></div><div><span>传输中</span><strong>{active}</strong><small>任务</small></div></div>
        <div className="section-heading"><h2>快速访问</h2></div>
        <button className="quick-card" onClick={() => setTab('courses')}><span className="quick-icon">▦</span><span><strong>Canvas 课程资源</strong><small>查看课程、课件与附件</small></span><b>→</b></button>
        <button className="quick-card" onClick={() => setTab('downloads')}><span className="quick-icon alt">↓</span><span><strong>下载管理</strong><small>查看进度与任务状态</small></span><b>→</b></button>
        {loggedIn && <div className="account"><span>当前账号 · {user || '已授权'}</span><button onClick={() => void logout()}>退出登录</button></div>}
      </>}
      {tab === 'courses' && <>
        <div className="page-head"><div><span className="eyebrow">COURSE LIBRARY</span><h1>{course ? course.name : '我的课程'}</h1><p>{course ? '可访问的 Canvas 文件资源' : '同步你的交大 Canvas 课程'}</p></div></div>
        {!loggedIn ? <div className="empty"><div className="empty-mark">🔐</div><h3>请先登录</h3><p>连接 jAccount 以浏览已授权课程。</p><button className="primary" disabled={!isAndroid || busy} onClick={() => void login()}>前往登录 →</button></div>
          : course ? <>
            <div className="action-bar"><button onClick={() => { setCourse(null); setFiles([]) }}>← 全部课程</button><span>{filtered.length} 个文件</span></div>
            <input className="search" aria-label="搜索课件" placeholder="搜索课件名称…" value={search} onChange={e => setSearch(e.target.value)} />
            {busy ? <div className="empty">正在读取课件…</div> : filtered.length === 0 ? <div className="empty">暂无可访问文件</div> : <div className="item-list">{filtered.map(f =>
              <div className="file-row" key={f.id}><div className="file-badge">▤</div><div className="file-info"><strong>{f.name}</strong><small>{formatBytes(f.size)} · {f.contentType || '文件'}</small></div><button disabled={f.locked || !isAndroid} aria-label={'下载' + f.name} title={f.locked ? '无权限下载' : '下载'} onClick={() => void download(f)}>{f.locked ? '🔒' : '↓'}</button></div>
            )}</div>}
          </> : <>
            <div className="action-bar"><strong>Canvas</strong><button disabled={busy} onClick={() => void loadCourses()}>↻ 刷新</button></div>
            {busy ? <div className="empty">正在同步课程…</div> : courses.length === 0 ? <div className="empty">暂无课程，请检查校园网或 VPN 连接。</div> :
            <div className="course-list">{courses.map((c, i) => <button key={c.id} className="course-row" onClick={() => void openCourse(c)}><span className="course-number">{String(i + 1).padStart(2, '0')}</span><span><strong>{c.name}</strong><small>{c.term || c.code || 'Canvas 课程'}</small></span><b>↗</b></button>)}</div>}
          </>}
      </>}
      {tab === 'downloads' && <>
        <div className="page-head"><span className="eyebrow">TRANSFER CENTER</span><h1>下载中心</h1><p>正在传输 {active} 项 · 已完成 {finished} 项</p></div>
        <div className="section-heading"><h2>传输任务</h2><span>{jobs.length} ITEMS</span></div>
        {jobs.length === 0 ? <div className="empty"><div className="empty-mark">↓</div><h3>暂无下载任务</h3><p>前往课程列表，挑选需要的课件。</p><button onClick={() => setTab('courses')} className="primary">浏览课程 →</button></div> : <div className="job-list">{jobs.map(j => <div className="job-card" key={j.taskId}>
          <div className="job-meta"><span className="job-icon">↓</span><div><strong>{j.fileName}</strong><small>{j.state === 'done' ? '下载完成 · 已保存至 Downloads/SJTU Downloader' : j.state === 'active' ? formatBytes(j.bytes) + ' / ' + formatBytes(j.total) : j.state === 'cancelled' ? '已取消' : '下载失败'}</small></div><span className={'job-state ' + j.state}>{j.state === 'done' ? '完成' : j.state === 'active' ? '下载中' : j.state === 'cancelled' ? '已取消' : '失败'}</span></div>
          <div className="progress-track"><div style={{ width: (j.state === 'done' ? 100 : j.total > 0 ? Math.max(2, Math.min(100, (j.bytes / j.total) * 100)) : 2) + '%' }} /></div>
          {j.state === 'active' && <button className="cancel" onClick={() => void cancel(j.taskId)}>取消下载</button>}
          {j.error && <small className="error-text">{j.error}</small>}
        </div>)}</div>}
        <div className="hint">下载进行时请保持应用打开。后台稳定续传将在后续版本实现。</div>
      </>}
    </section>
    <nav className="bottom-nav" aria-label="主导航">{(['home', 'courses', 'downloads'] as Tab[]).map(key => <button key={key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}><span className="nav-icon">{glyph[key]}</span><span>{key === 'home' ? '首页' : key === 'courses' ? '课程' : '下载'}</span></button>)}</nav>
  </main>
}
