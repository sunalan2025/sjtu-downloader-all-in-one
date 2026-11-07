import { withMotion } from './Motion'
import { AnimatedSelect } from './AnimatedSelect'
import { autoRetry } from './AutoRetry'
import { PageHeader } from './MaterialUI'
import { forwardRef, type TouchEvent, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
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
  onLogin: () => void
  onBatchDownload: (tasks: CourseDownloadItem[]) => Promise<void>
  onNotice: (text: string) => void
  onSelectionChange: (selection: CourseSelection) => void
}
export const BatchCourseBrowser = forwardRef<CourseBrowserHandle, BrowserProps>(function BatchCourseBrowser(
  { courses, loggedIn, loading, onLogin, onBatchDownload, onNotice, onSelectionChange }, ref
) {
  const [termChoice, setTermChoice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [chosenCourses, setChosenCourses] = useState<Set<string>>(new Set())
  const [courseSelectMode,setCourseSelectMode]=useState(false)
  const courseTouch=useRef<{
    timer:number|null;anchor:number;last:number;x:number;y:number;active:boolean
    longPressed:boolean;moved:boolean
  }|null>(null)
  const blockCourseClickUntil=useRef(0)
  const stopCourseTouch=()=>{
    const record=courseTouch.current
    if(record?.timer!==null&&record?.timer!==undefined)window.clearTimeout(record.timer)
    if(record&&(record.longPressed||record.moved))
      blockCourseClickUntil.current=Date.now()+350
    courseTouch.current=null
  }
  useEffect(()=>()=>{const record=courseTouch.current
    if(record?.timer!==null&&record?.timer!==undefined)window.clearTimeout(record.timer)
  },[])
  const enterCourseSelection=(index:number)=>{
    const item=courseList[index]
    if(!item)return
    blockCourseClickUntil.current=Date.now()+460
    setCourseSelectMode(true)
    setChosenCourses(old=>new Set([...old,item.id]))
  }
  const selectCourseRange=(first:number,last:number)=>{
    setChosenCourses(old=>{
      const next=new Set(old)
      for(let i=Math.min(first,last);i<=Math.max(first,last);i++){
        const item=courseList[i]
        if(item)next.add(item.id)
      }
      return next
    })
  }
  const startCourseTouch=(e:TouchEvent<HTMLDivElement>)=>{
    // A fresh contact is a new user action, not the long press's synthetic click.
    blockCourseClickUntil.current=0
    const element=(e.target as Element).closest<HTMLElement>('[data-course-id]')
    if(!element||(e.target as Element).closest('.select-circle'))return
    const index=courseList.findIndex(item=>item.id===element.dataset.courseId)
    const finger=e.touches[0]
    if(index<0||!finger)return
    stopCourseTouch()
    const record={timer:null as number|null,anchor:index,last:index,
      x:finger.clientX,y:finger.clientY,active:courseSelectMode,
      longPressed:false,moved:false}
    courseTouch.current=record
    if(courseSelectMode)return
    record.timer=window.setTimeout(()=>{
      if(courseTouch.current!==record)return
      record.active=true
      record.longPressed=true
      enterCourseSelection(index)
    },380)
  }
  const moveCourseTouch=(e:TouchEvent<HTMLDivElement>)=>{
    const record=courseTouch.current,finger=e.touches[0]
    if(!record||!finger)return
    if(!record.active){
      if(Math.hypot(finger.clientX-record.x,finger.clientY-record.y)>11)stopCourseTouch()
      return
    }
    if(Math.hypot(finger.clientX-record.x,finger.clientY-record.y)<=11)return
    record.moved=true
    const target=document.elementFromPoint(finger.clientX,finger.clientY)?.closest<HTMLElement>('[data-course-id]')
    const index=courseList.findIndex(item=>item.id===target?.dataset.courseId)
    if(index>=0&&index!==record.last){
      record.last=index
      record.moved=true
      selectCourseRange(record.anchor,index)
    }
  }

  const [active, setActive] = useState<CanvasCourse | null>(null)
  const [hasNestedMotion, setHasNestedMotion] = useState(false)
  const [files, setFiles] = useState<CanvasFile[]>([])
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [fileSelectMode, setFileSelectMode] = useState(false)
  const touchSelect = useRef<{
    timer: number | null; anchor: number; last: number; x: number; y: number; active: boolean
    longPressed: boolean; moved: boolean
  } | null>(null)
  const blockClickUntil=useRef(0)
  useEffect(()=>{
    // React delegates touchmove passively. A held range-selection gesture
    // needs a nonpassive listener to stop the page scrolling under the finger.
    const hold=(event:globalThis.TouchEvent)=>{
      if(event.cancelable&&(courseTouch.current?.active||touchSelect.current?.active))event.preventDefault()
    }
    document.addEventListener('touchmove',hold,{passive:false})
    return()=>document.removeEventListener('touchmove',hold)
  },[])
  const stopTouchSelect=()=>{
    const record=touchSelect.current
    if(record?.timer!==null && record?.timer!==undefined)window.clearTimeout(record.timer)
    if(record&&(record.longPressed||record.moved))
      blockClickUntil.current=Date.now()+350
    touchSelect.current=null
  }
  useEffect(()=>()=>{const record=touchSelect.current
    if(record?.timer!==null && record?.timer!==undefined)window.clearTimeout(record.timer)
  },[])
  const enterFileSelection=(index:number)=>{
    const file=visibleFiles[index]
    if(!file||file.locked)return
    blockClickUntil.current=Date.now()+450
    setFileSelectMode(true)
    setSelectedFiles(old=>new Set([...old,file.id]))
  }
  const markSelectionRange=(from:number,to:number)=>{
    const min=Math.min(from,to),max=Math.max(from,to)
    setSelectedFiles(old=>{
      const next=new Set(old)
      for(let i=min;i<=max;i++){
        const file=visibleFiles[i]
        if(file&&!file.locked)next.add(file.id)
      }
      return next
    })
  }
  const startFileTouch=(e:TouchEvent<HTMLDivElement>)=>{
    blockClickUntil.current=0
    const hit=(e.target as Element).closest<HTMLElement>('[data-file-id]')
    if(!hit || (e.target as Element).closest('.small-action,.select-circle'))return
    const index=visibleFiles.findIndex(file=>file.id===hit.dataset.fileId)
    if(index<0||visibleFiles[index].locked)return
    stopTouchSelect()
    const finger=e.touches[0]
    if(!finger)return
    const record={timer:null as number|null,anchor:index,last:index,
      x:finger.clientX,y:finger.clientY,active:fileSelectMode,
      longPressed:false,moved:false}
    touchSelect.current=record
    // A normal tap in selection mode is handled by onClick, while dragging
    // extends the range in onTouchMove. Selecting on touch-start would cause
    // the subsequent click to immediately toggle the row back off.
    if(fileSelectMode)return
    record.timer=window.setTimeout(()=>{
      if(touchSelect.current!==record)return
      record.active=true
      record.longPressed=true
      enterFileSelection(index)
    },380)
  }
  const moveFileTouch=(e:TouchEvent<HTMLDivElement>)=>{
    const record=touchSelect.current
    const finger=e.touches[0]
    if(!record||!finger)return
    if(!record.active){
      if(Math.hypot(finger.clientX-record.x,finger.clientY-record.y)>11)stopTouchSelect()
      return
    }
    if(Math.hypot(finger.clientX-record.x,finger.clientY-record.y)<=11)return
    record.moved=true
    const hit=document.elementFromPoint(finger.clientX,finger.clientY)?.closest<HTMLElement>('[data-file-id]')
    const index=visibleFiles.findIndex(file=>file.id===hit?.dataset.fileId)
    if(index>=0&&index!==record.last){
      record.last=index
      record.moved=true
      markSelectionRange(record.anchor,index)
    }
  }

  const [kind, setKind] = useState<Kind>('all')
  const [fetching, setFetching] = useState(false)
  const [fileError, setFileError] = useState('')
  const fileRequestId = useRef(0)
  const [collecting, setCollecting] = useState(false)
  const collectionGeneration=useRef(0)
  useEffect(()=>()=>{fileRequestId.current++;collectionGeneration.current++},[loggedIn])

  const closeCourse = () => {
    if (!active) return false
    fileRequestId.current++
    stopTouchSelect()
    document.documentElement.dataset.navigationDirection='backward'
    withMotion(()=>{
      setHasNestedMotion(true)
      setActive(null)
      setFiles([])
      setFileError('')
      setFetching(false)
      setSearch('')
      setSelectedFiles(new Set())
      setFileSelectMode(false)
    })
    return true
  }

  // Android's system Back gesture must unwind selection before navigation.
  // When browsing a folder, the first Back only dismisses its checkboxes;
  // a second Back actually leaves the folder.
  const handleBack = () => {
    if (active) {
      if (fileSelectMode || selectedFiles.size > 0) {
        stopTouchSelect()
        setSelectedFiles(new Set())
        setFileSelectMode(false)
        return true
      }
      return closeCourse()
    }
    if (courseSelectMode || chosenCourses.size > 0) {
      stopCourseTouch()
      setChosenCourses(new Set())
      setCourseSelectMode(false)
      return true
    }
    return false
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
  // The selection controls are transient: clearing the last selected item
  // automatically returns to the ordinary course/file list.
  useEffect(() => {
    if (fileSelectMode && selectedFiles.size === 0) setFileSelectMode(false)
  }, [fileSelectMode, selectedFiles.size])
  useEffect(() => {
    if (courseSelectMode && chosenCourses.size === 0) setCourseSelectMode(false)
  }, [courseSelectMode, chosenCourses.size])
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
      const result = await autoRetry(()=>native.files({ courseId: course.id }),()=>fileRequestId.current===request)
      if (fileRequestId.current === request) setFiles(result.items)
    } catch (error) {
      if (fileRequestId.current === request) {
        setFileError('联网后会自动更新。')
      }
    } finally {
      if (fileRequestId.current === request) setFetching(false)
    }
  }
  useEffect(()=>{
    if(!active||!fileError)return
    const refresh=()=>{if(document.visibilityState==='visible')void loadCourseFiles(active)}
    window.addEventListener('online',refresh)
    window.addEventListener('focus',refresh)
    const timer=window.setTimeout(refresh,30_000)
    return()=>{window.clearTimeout(timer);window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh)}
  },[active?.id,fileError])
  async function openCourse(course: CanvasCourse) {
    document.documentElement.dataset.navigationDirection='forward'
    setHasNestedMotion(true)
    withMotion(()=>{
      setActive(course);setFiles([]);setSelectedFiles(new Set());setFileSelectMode(false)
      stopTouchSelect();setKind('all');setSearch('')
      void loadCourseFiles(course)
    })
  }
  async function downloadFiles() {
    if (!active || selectedFiles.size === 0) return
    const tasks = files.filter(f => !f.locked && selectedFiles.has(f.id))
      .map(file => ({ file, courseName: active.name, term: active.term }))
    if (tasks.length) await onBatchDownload(tasks)
  }
  async function downloadCourses() {
    if (!chosen.length || collecting) return
    const generation=++collectionGeneration.current
    setCollecting(true)
    let skipped = 0
    try {
      const all: CourseDownloadItem[] = []
      // Avoid firing hundreds of concurrent API requests; three native workers are available.
      let cursor = 0
      const work = async () => {
        while (generation===collectionGeneration.current && cursor < chosen.length) {
          const selected = chosen[cursor++]
          try {
            const list = (await native.files({ courseId: selected.id })).items
            if(generation!==collectionGeneration.current)return
            for (const file of list) {
              if (!file.locked) all.push({ file, courseName: selected.name, term: selected.term })
            }
          } catch { skipped++ }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, chosen.length) }, () => work()))
      if(generation!==collectionGeneration.current)return
      if (all.length === 0) {
        onNotice(skipped ? '部分课程资料暂时无法下载。' : '所选课程中没有可下载文件。')
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
    goBack: handleBack,
    downloadSelection: () => { if (active) void downloadFiles(); else void downloadCourses() },
    clearSelection: () => {
      if (active) { setSelectedFiles(new Set()); setFileSelectMode(false) }
      else { setChosenCourses(new Set()); setCourseSelectMode(false) }
    }
  }))
  return <div key={active ? 'detail' : 'list'}
    className={'course-screen ' + (hasNestedMotion ? 'nested-motion ' : '') + (active ? 'course-screen--detail' : 'course-screen--list')}>
    <PageHeader title={active ? active.name : '课程'} subtitle={active ? '课程文件' : '课程与学习资料'}/>
    {!loggedIn ? <div className="empty-box"><div className="empty-picture"><Icon name="shield" size={28}/></div>
      <strong>登录后查看课程</strong>
      <button className="primary" onClick={onLogin} disabled={!isAndroid}>登录交大账号 <Icon name="arrow" size={15}/></button></div>
    : active ? <>
      <div className="row-actions"><button className="text-button" onClick={() => void handleBack()}>
        <Icon name="left" size={16}/> 返回课程</button><span className="muted-count">{files.length} 个</span></div>
      <label className="search-field"><Icon name="search" size={19}/><input aria-label="搜索课件" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索文件"/></label>
      <div className="category-chips">{(Object.keys(categoryNames) as Kind[]).map(k => <button key={k} className={k===kind?'chosen':''} onClick={()=>{if(k!==kind)withMotion(()=>setKind(k))}}>{categoryNames[k]}</button>)}</div>
      <div className="selection-slot">{!fileSelectMode ? <div className="file-select-hint">长按文件，保持按住并上下滑动即可连续多选</div>
        : <div className="batch-toolbar file-selection-toolbar">
            <button className="text-button" onClick={() => setSelectedFiles(old => {
              const ids=selectableFiles.map(file=>file.id)
              const next=new Set(old)
              const full=ids.length>0&&ids.every(id=>next.has(id))
              ids.forEach(id=>full?next.delete(id):next.add(id))
              return next
            })}>{selectableFiles.length&&selectableFiles.every(file=>selectedFiles.has(file.id))?'取消全选':'全选'}</button>
            <span className="muted-count">已选 {selectedFiles.size} 项</span>
            <button className="text-button clear-selection" onClick={()=>{
              setSelectedFiles(new Set());setFileSelectMode(false)
            }}>完成</button>
          </div>}</div>
      {fetching ? <div className="loading-note">正在读取文件…</div>
        : fileError ? <div className="file-retry-panel surface-card" role="alert">
          <Icon name="wifi" size={22}/>
          <strong>暂时无法读取文件</strong>
          <span>{fileError}</span>
        </div>
        : visibleFiles.length ? <div className={'item-list'+(fileSelectMode?' selecting-files':'')}
            onPointerDownCapture={()=>{blockClickUntil.current=0}}
            onTouchStart={startFileTouch} onTouchMove={moveFileTouch}
            onTouchEnd={stopTouchSelect} onTouchCancel={stopTouchSelect}
            onClickCapture={e=>{
              if(e.detail!==0&&Date.now()<blockClickUntil.current){
                e.preventDefault();e.stopPropagation()
              }
            }}>
            {visibleFiles.map((file,index)=>
              <div className={'file-row '+(selectedFiles.has(file.id)?'row-selected':'')+
                (fileSelectMode?' selecting':'')} key={file.id} data-file-id={file.id}
                onContextMenu={e=>{
                  if(file.locked)return
                  e.preventDefault()
                  enterFileSelection(index)
                }}
                onClick={()=>{if(fileSelectMode&&!file.locked)toggleFile(file.id)}}>
                <span className="file-leading">{fileSelectMode?<span className={'select-circle file-selection-circle'+
                  (selectedFiles.has(file.id)?' checked':'')} aria-label={selectedFiles.has(file.id)?'已选择':'未选择'}>
                  {selectedFiles.has(file.id)&&<Icon name="check" size={14}/>}
                </span>:<span className="file-badge"><Icon name="file" size={19}/></span>}</span>
                <span className="file-info"><strong>{file.name}</strong>
                  <small>{file.locked?'无权限':displayBytes(file.size)}</small></span>
                {<button className="small-action" style={{visibility:fileSelectMode?'hidden':undefined}} disabled={file.locked||fileSelectMode}
                  aria-label={'下载 '+file.name}
                  onClick={e=>{e.stopPropagation();void onBatchDownload([{file,courseName:active.name,term:active.term}])}}>
                  <Icon name="download" size={17}/>
                </button>}
              </div>)}
          </div> : <div className="empty-box"><div className="empty-picture">
            <Icon name="file" size={28}/></div><strong>暂无文件</strong></div>}
    </> : <>
      <label className="search-field"><Icon name="search" size={19}/><input aria-label="搜索课程" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索课程"/></label>
      <div className="row-actions"><span className="muted-count">{courseList.length} 门 · 自动同步</span></div>
      <AnimatedSelect className="semester-select" label="选择学期" value={term} onChange={setTermChoice}
        options={[{value:'',label:`全部学期（${courses.length}）`},...semesters.map(t=>({value:t,label:t}))]}/>
      <div className="selection-slot">{courseSelectMode?<div className="batch-toolbar file-selection-toolbar">
        <button className="text-button" onClick={() => setChosenCourses(old=>{
          const next=new Set(old),ids=courseList.map(item=>item.id)
          const full=ids.length>0&&ids.every(id=>next.has(id))
          ids.forEach(id=>full?next.delete(id):next.add(id))
          return next
        })}>{courseList.length&&courseList.every(item=>chosenCourses.has(item.id))?'取消全选':'全选'}</button>
        <span className="muted-count">已选 {chosenCourses.size} 门</span>
        <button className="text-button clear-selection" onClick={()=>{
          setChosenCourses(new Set());setCourseSelectMode(false)
        }}>完成</button>
      </div>:<div className="file-select-hint">长按课程可多选</div>}</div>
      {loading ? <div className="loading-note">正在同步课程…</div>
        : courseList.length ? <div className={'course-list'+(courseSelectMode?' selecting-files':'')}
          onPointerDownCapture={()=>{blockCourseClickUntil.current=0}}
          onTouchStart={startCourseTouch} onTouchMove={moveCourseTouch}
          onTouchEnd={stopCourseTouch} onTouchCancel={stopCourseTouch}
          onClickCapture={e=>{
            if(e.detail!==0&&Date.now()<blockCourseClickUntil.current){e.preventDefault();e.stopPropagation()}
          }}>
          {courseList.map((c,index)=>
            <div className={'course-card batch-course-row'+(chosenCourses.has(c.id)?' row-selected':'')}
              data-course-id={c.id} key={c.id}
              onContextMenu={e=>{e.preventDefault();enterCourseSelection(index)}}>
              <button className="course-card-open" onClick={()=>{
                if(courseSelectMode)toggleCourse(c.id)
                else void openCourse(c)
              }}><span className="course-symbol">{courseSelectMode?<span className={'select-circle'+(chosenCourses.has(c.id)?' checked':'')}>
                  {chosenCourses.has(c.id)&&<Icon name="check" size={14}/>}</span>:<Icon name="book" size={18}/>}</span>
                <span className="course-text"><strong>{c.name}</strong><small>{c.code&&c.code!==c.name?c.code:'课程资料'}</small></span>
                <Icon name={courseSelectMode?'check':'right'} className="chevron" size={17}/>
              </button>
            </div>)}
          </div>
        : <div className="empty-box"><div className="empty-picture"><Icon name="book" size={28}/></div><strong>暂无课程</strong></div>}
    </>}
  </div>
})
