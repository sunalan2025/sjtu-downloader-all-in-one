import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import native, { isAndroid, type CanvasCourse, type CanvasFile, type CourseDownloadItem } from './native'

type Kind = 'all' | 'documents' | 'video' | 'other'
const categoryNames: Record<Kind, string> = { all: '全部', documents: '文档课件', video: '视频文件', other: '其他' }
function kindOf(file: CanvasFile): Exclude<Kind, 'all'> {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (file.contentType.startsWith('video/') || ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v'].includes(ext)) return 'video'
  if (['pdf', 'ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'zip', 'rar', '7z', 'md', 'key', 'pages'].includes(ext)) return 'documents'
  return 'other'
}
const displayBytes = (bytes: number) => bytes > 1024 ** 2
  ? (bytes / (1024 ** 2)).toFixed(1) + ' MB'
  : bytes > 1024 ? (bytes / 1024).toFixed(0) + ' KB' : (bytes || 0) + ' B'

export type CourseBrowserHandle = {
  goBack: () => boolean
  downloadSelection: () => void
  clearSelection: () => void
}
export type CourseSelection = { count: number; busy: boolean; scope: 'courses' | 'files' | null }
function currentSemester(semesters: string[]): string {
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric'
  }).formatToParts(new Date())
  const year = Number(date.find(part => part.type === 'year')?.value)
  const month = Number(date.find(part => part.type === 'month')?.value)
  // January still belongs to the previous autumn term at SJTU.
  const fall = month >= 8 || month === 1
  const academicStart = fall && month === 1 ? year - 1 : (fall ? year : year - 1)
  const range = String(academicStart) + '-' + String(academicStart + 1)
  const season = fall
    ? /秋|fall|autumn|第一学期|第1学期|上学期|(?:[-/_]\s*1\s*$)/i
    : /春|spring|第二学期|第2学期|下学期|(?:[-/_]\s*2\s*$)/i
  const scored = semesters.map(label => {
    const matchingYear = label.includes(String(year)) || label.includes(String(academicStart))
    const matchingSeason = season.test(label)
    const matchingRange = label.includes(range) ||
      (label.includes(String(academicStart)) && label.includes(String(academicStart + 1)))
    return { label, score: matchingYear && matchingSeason ? 10 + (matchingRange ? 2 : 0) : 0 }
  }).sort((a, b) => b.score - a.score)
  return scored[0]?.score ? scored[0].label :
    (semesters.find(s => s !== '未分类学期') || semesters[0] || '')
}
type BrowserProps = {
  courses: CanvasCourse[]
  loggedIn: boolean
  loading: boolean
  onRefresh: () => void
  onLogin: () => void
  onBatchDownload: (tasks: CourseDownloadItem[]) => Promise<void>
  onNotice: (text: string) => void
  onSelectionChange: (selection: CourseSelection) => void
}
export const BatchCourseBrowser = forwardRef<CourseBrowserHandle, BrowserProps>(function BatchCourseBrowser(
  { courses, loggedIn, loading, onRefresh, onLogin, onBatchDownload, onNotice, onSelectionChange }, ref
) {
  const [termChoice, setTermChoice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [chosenCourses, setChosenCourses] = useState<Set<string>>(new Set())
  const [active, setActive] = useState<CanvasCourse | null>(null)
  const [files, setFiles] = useState<CanvasFile[]>([])
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [kind, setKind] = useState<Kind>('all')
  const [fetching, setFetching] = useState(false)
  const [fileError, setFileError] = useState('')
  const fileRequestId = useRef(0)
  const [collecting, setCollecting] = useState(false)

  const closeCourse = () => {
    if (!active) return false
    fileRequestId.current++
    setActive(null)
    setFiles([])
    setFileError('')
    setFetching(false)
    setSearch('')
    setSelectedFiles(new Set())
    return true
  }

  const semesters = useMemo(() =>
    Array.from(new Set(courses.map(c => c.term || '未分类学期'))).sort((a, b) => b.localeCompare(a, 'zh-CN')), [courses])
  const term = termChoice === '' ? '' : termChoice && semesters.includes(termChoice)
    ? termChoice : currentSemester(semesters)
  const courseList = useMemo(() => courses.filter(c => {
    const matchesTerm = !term || (c.term || '未分类学期') === term
    const q = search.trim().toLowerCase()
    return matchesTerm && (!q || (c.name + ' ' + c.code + ' ' + c.term).toLowerCase().includes(q))
  }), [courses, term, search])
  const visibleFiles = useMemo(() => files.filter(f =>
    (kind === 'all' || kindOf(f) === kind) &&
    (!search.trim() || f.name.toLowerCase().includes(search.toLowerCase()))
  ), [files, kind, search])
  const selectableFiles = visibleFiles.filter(f => !f.locked)
  const chosen = courses.filter(c => chosenCourses.has(c.id))
  useEffect(() => {
    onSelectionChange({
      count: loggedIn ? (active ? selectedFiles.size : chosenCourses.size) : 0,
      busy: !active && collecting,
      scope: active ? 'files' : 'courses'
    })
  }, [active, collecting, chosenCourses.size, selectedFiles.size, loggedIn, onSelectionChange])
  useEffect(() => () => onSelectionChange({ count: 0, busy: false, scope: null }), [onSelectionChange])

  function toggleCourse(id: string) {
    setChosenCourses(old => {
      const copy = new Set(old)
      if (copy.has(id)) copy.delete(id); else copy.add(id)
      return copy
    })
  }
  function toggleFile(id: string) {
    setSelectedFiles(old => {
      const copy = new Set(old)
      if (copy.has(id)) copy.delete(id); else copy.add(id)
      return copy
    })
  }
  async function loadCourseFiles(course: CanvasCourse) {
    const request = ++fileRequestId.current
    setFetching(true)
    setFileError('')
    try {
      const result = await native.files({ courseId: course.id })
      if (fileRequestId.current === request) setFiles(result.items)
    } catch (error) {
      if (fileRequestId.current === request) {
        const message = String(error).replace(/^(Error:\s*)+/i, '').trim()
        setFileError(message || '网络连接中断，请稍后重试')
      }
    } finally {
      if (fileRequestId.current === request) setFetching(false)
    }
  }
  async function openCourse(course: CanvasCourse) {
    setActive(course); setFiles([]); setSelectedFiles(new Set()); setKind('all'); setSearch('')
    await loadCourseFiles(course)
  }
  async function downloadFiles() {
    if (!active || selectedFiles.size === 0) return
    const tasks = files.filter(f => !f.locked && selectedFiles.has(f.id))
      .map(file => ({ file, courseName: active.name, term: active.term }))
    if (tasks.length) await onBatchDownload(tasks)
  }
  async function downloadCourses() {
    if (!chosen.length || collecting) return
    setCollecting(true)
    let skipped = 0
    try {
      const all: CourseDownloadItem[] = []
      // Avoid firing hundreds of concurrent API requests; three native workers are available.
      let cursor = 0
      const work = async () => {
        while (cursor < chosen.length) {
          const selected = chosen[cursor++]
          try {
            const list = (await native.files({ courseId: selected.id })).items
            for (const file of list) {
              if (!file.locked) all.push({ file, courseName: selected.name, term: selected.term })
            }
          } catch { skipped++ }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, chosen.length) }, () => work()))
      if (all.length === 0) {
        onNotice(skipped ? '所选课程资源无法读取，请检查 Canvas 权限。' : '所选课程中没有可下载文件。')
        return
      }
      if (all.length > 1200) {
        onNotice('本次批量下载超过 1200 个文件，请减少所选课程分批执行。')
        return
      }
      if (skipped) onNotice('有 ' + skipped + ' 门课程无法读取，其他课程已加入下载队列。')
      await onBatchDownload(all)
    } finally { setCollecting(false) }
  }

  useImperativeHandle(ref, () => ({
    goBack: closeCourse,
    downloadSelection: () => { if (active) void downloadFiles(); else void downloadCourses() },
    clearSelection: () => {
      if (active) setSelectedFiles(new Set())
      else setChosenCourses(new Set())
    }
  }))
  return <div key={active ? 'detail' : 'list'}
    className={'course-screen ' + (active ? 'course-screen--detail' : 'course-screen--list')}>
    <div className="page-intro compact"><h1>{active ? active.name : '课程'}</h1></div>
    {!loggedIn ? <div className="empty-box"><div className="empty-picture"><Icon name="shield" size={28}/></div>
      <strong>登录后查看课程</strong>
      <button className="primary" onClick={onLogin} disabled={!isAndroid}>使用 jAccount 登录 <Icon name="arrow" size={15}/></button></div>
    : active ? <>
      <div className="row-actions"><button className="text-button" onClick={closeCourse}>
        <Icon name="left" size={16}/> 返回课程</button><span className="muted-count">{files.length} 个</span></div>
      <label className="search-field"><Icon name="search" size={19}/><input aria-label="搜索课件" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索文件"/></label>
      <div className="category-chips">{(Object.keys(categoryNames) as Kind[]).map(k => <button key={k} className={k===kind?'chosen':''} onClick={()=>setKind(k)}>{categoryNames[k]}</button>)}</div>
      <div className="batch-toolbar"><button className="text-button" onClick={() => setSelectedFiles(old => {
        const ids=selectableFiles.map(f=>f.id)
        const next=new Set(old)
        const fully=ids.length>0 && ids.every(x=>next.has(x))
        ids.forEach(id=>fully?next.delete(id):next.add(id))
        return next
      })}>{selectableFiles.length && selectableFiles.every(f => selectedFiles.has(f.id)) ? '取消全选' : '全选'}</button>
      {selectedFiles.size>0 && <button className="text-button clear-selection" onClick={() => setSelectedFiles(new Set())}>取消选择（{selectedFiles.size}）</button>}</div>
      {fetching ? <div className="loading-note">正在读取文件…</div>
        : fileError ? <div className="file-retry-panel glass" role="alert">
          <Icon name="wifi" size={22}/>
          <strong>暂时无法读取文件</strong>
          <span>{fileError}</span>
          <button className="primary" onClick={() => { if (active) void loadCourseFiles(active) }}>
            <Icon name="refresh" size={16}/> 重试
          </button>
        </div>
        : visibleFiles.length ? <div className="item-list">{visibleFiles.map(file =>
          <div className={'file-row '+(selectedFiles.has(file.id)?'row-selected':'')} key={file.id}>
            <button disabled={file.locked} className={'select-circle '+(selectedFiles.has(file.id)?'checked':'')} aria-label={'选择 '+file.name} aria-pressed={selectedFiles.has(file.id)} onClick={()=>toggleFile(file.id)}>{selectedFiles.has(file.id) && <Icon name="check" size={14}/>}</button>
            <span className="file-badge"><Icon name="file" size={19}/></span>
            <span className="file-info"><strong>{file.name}</strong><small>{file.locked ? '无权限' : displayBytes(file.size)}</small></span>
            <button className="small-action" disabled={file.locked} aria-label={'下载 '+file.name} onClick={()=>void onBatchDownload([{file,courseName:active.name,term:active.term}])}><Icon name="download" size={17}/></button>
          </div>)}</div> : <div className="empty-box"><div className="empty-picture"><Icon name="file" size={28}/></div><strong>暂无文件</strong></div>}
    </> : <>
      <label className="search-field"><Icon name="search" size={19}/><input aria-label="搜索课程" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索课程"/></label>
      <div className="row-actions"><span className="muted-count">{courseList.length} 门</span><button className="text-button" onClick={onRefresh} disabled={loading}><Icon name="refresh" size={16}/> 刷新课程</button></div>
      <label className="semester-select"><span className="sr-only">学期筛选</span><select aria-label="选择学期" value={term} onChange={e=>setTermChoice(e.target.value)}>
        <option value="">全部学期（{courses.length}）</option>
        {semesters.map(t=><option key={t} value={t}>{t}</option>)}
      </select></label>
      <div className="batch-toolbar"><button className="text-button" onClick={() => setChosenCourses(old => {
        const next=new Set(old)
        const ids=courseList.map(c=>c.id)
        const fully=ids.length>0&&ids.every(id=>next.has(id))
        ids.forEach(id=>fully?next.delete(id):next.add(id))
        return next
      })}>{courseList.length && courseList.every(c=>chosenCourses.has(c.id))?'取消全选':'全选'}</button>{chosenCourses.size>0 && <button className="text-button clear-selection" onClick={() => setChosenCourses(new Set())}>取消选择（{chosenCourses.size}）</button>}</div>
      {loading ? <div className="loading-note">正在同步课程…</div>
        : courseList.length ? <div className="course-list">{courseList.map(c =>
        <div className="course-card batch-course-row" key={c.id}>
          <button className={'select-circle '+(chosenCourses.has(c.id)?'checked':'')} aria-label={'选择课程 '+c.name} aria-pressed={chosenCourses.has(c.id)} onClick={()=>toggleCourse(c.id)}>{chosenCourses.has(c.id)&&<Icon name="check" size={14}/>}</button>
          <button className="course-card-open" onClick={()=>void openCourse(c)}><span className="course-symbol"><Icon name="book" size={18}/></span><span className="course-text"><strong>{c.name}</strong></span><Icon name="right" className="chevron" size={17}/></button>
        </div>)}</div>
        : <div className="empty-box"><div className="empty-picture"><Icon name="book" size={28}/></div><strong>暂无课程</strong></div>}
    </>}
  </div>
})
