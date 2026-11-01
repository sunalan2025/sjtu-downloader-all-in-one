import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { CalendarEvent } from './native'
import { scheduleKind, scheduleLabel, schedulePlace, compareEvents } from './ScheduleUtils'

const TZ = 'Asia/Shanghai'
const DOW = ['周日','周一','周二','周三','周四','周五','周六']
const pad = (n: number) => String(n).padStart(2, '0')
export const shanghaiDate = (time: string) => {
  if (!time) return ''
  if (/^\d{4}-\d\d-\d\d$/.test(time)) return time
  const d = new Date(time)
  if (Number.isNaN(d.getTime())) return time.slice(0, 10)
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(d)
  return [p.find(x=>x.type==='year')?.value,p.find(x=>x.type==='month')?.value,p.find(x=>x.type==='day')?.value].join('-')
}
const currentDate = () => shanghaiDate(new Date().toISOString())
export const currentMonth = () => currentDate().slice(0,7)
const nextDay = (day: string, offset: number) => {
  const d = new Date(day + 'T12:00:00+08:00')
  d.setUTCDate(d.getUTCDate() + offset)
  const p = new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d)
  return [p.find(v=>v.type==='year')?.value,p.find(v=>v.type==='month')?.value,p.find(v=>v.type==='day')?.value].join('-')
}
const dayIndex = (day: string) => new Date(day+'T12:00:00+08:00').getUTCDay()
const monday = (day: string) => nextDay(day, -(dayIndex(day)+6)%7)
export const currentWeekStart = () => monday(currentDate())
const timeText = (time: string) => {
  if (!time || /^\d{4}-\d\d-\d\d$/.test(time)) return '全天'
  const d = new Date(time)
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d)
}
const minute = (time: string, fallback = 480) => {
  const t = timeText(time).match(/^(\d{2}):(\d{2})$/)
  return t ? Number(t[1])*60+Number(t[2]) : fallback
}
const isTimed = (e: CalendarEvent) => /^\d{2}:\d{2}$/.test(timeText(e.startTime))
const isHomework = (e: CalendarEvent) => e.type === 'assignment'
const COURSE_COLORS = ['indigo','teal','lavender','amber'] as const
type Placed = { event:CalendarEvent; start:number; end:number; left:number; width:number; tone:string }
function placeClasses(events:CalendarEvent[]): Placed[] {
  const sorted=events.filter(isTimed).map(event=>({
    event,start:minute(event.startTime),end:Math.max(minute(event.endTime,minute(event.startTime)+45),minute(event.startTime)+28)
  })).sort((a,b)=>a.start-b.start||a.end-b.end)
  const placed:Placed[]=[]
  let cluster:typeof sorted=[]
  const flush=()=>{
    if(!cluster.length)return
    const ends:number[]=[]
    const cols:number[]=[]
    for(const item of cluster){
      let c=ends.findIndex(x=>x<=item.start)
      if(c<0){c=ends.length;ends.push(item.end)}else ends[c]=item.end
      cols.push(c)
    }
    const width=100/ends.length
    cluster.forEach((item,i)=>placed.push({...item,left:cols[i]*width,width,
      tone:COURSE_COLORS[Math.abs([...item.event.title].reduce((a,c)=>a+c.charCodeAt(0),0))%COURSE_COLORS.length]}))
    cluster=[]
  }
  let activeEnd=-1
  for(const item of sorted){
    if(cluster.length&&item.start>=activeEnd)flush()
    cluster.push(item);activeEnd=Math.max(activeEnd,item.end)
  }
  flush()
  return placed
}
export function CalendarPage({month,onMonthChange,onWeekChange,events,busy,onOfficial,officialConnected,
  onAddSchedule,onEditSchedule,onExamConnect,onExamFallback,examConnected,examChecking,examWarning,examSource}:{
  month:string
  onMonthChange:(month:string)=>void
  onWeekChange:(weekStart:string)=>void
  events:CalendarEvent[]
  busy:boolean
  onOfficial:()=>void
  officialConnected?:boolean
  examConnected:boolean
  examChecking:boolean
  examWarning?:string
  examSource?:string
  onExamConnect:()=>void
  onExamFallback:()=>void
  onAddSchedule:(date:string)=>void
  onEditSchedule:(id:string)=>void
}) {
  const today=currentDate()
  const [selected,setSelected]=useState(today)
  const [view,setView]=useState<'week'|'month'>('week')
  const [display,setDisplay]=useState<'week'|'day'>('week')
  const [motionDirection,setMotionDirection]=useState<'forward'|'backward'>('forward')
  const [hasNestedMotion,setHasNestedMotion]=useState(false)
  const selectedRef=useRef(selected)
  selectedRef.current=selected
  useEffect(()=>{
    // When the app is reopened after midnight, automatically select today unless
    // the user deliberately navigated away from today's date.
    const id=window.setInterval(()=>{
      const latest=currentDate()
      if(selectedRef.current===today&&latest!==today)setSelected(latest)
    },60_000)
    return ()=>clearInterval(id)
  },[today])
  const weekStart=monday(selected)
  const weekDates=Array.from({length:7},(_,i)=>nextDay(weekStart,i))
  // Phone view is ALWAYS the selected date in the middle, with its immediate
  // neighbors on either side. Do not partition the week into pages: that put
  // Monday/Tuesday selection at the edge and hid Sunday beside Monday.
  const weekSwipeStart=useRef<{x:number;y:number}|null>(null)
  const visibleWeekDates=[nextDay(selected,-1),selected,nextDay(selected,1)]
  const visibleWeekCount=3

  const eventMap=useMemo(()=>{
    const map=new Map<string,CalendarEvent[]>()
    const seen=new Set<string>()
    for(const event of events){
      const date=shanghaiDate(event.startTime)
      // User-created events are distinct even if their title and time match a
      // school event or another personal entry.
      const key=event.id.startsWith('personal-') ? event.id :
        [date,event.title,event.type,timeText(event.startTime)].join('|')
      if(!date||seen.has(key))continue
      seen.add(key)
      map.set(date,[...(map.get(date)||[]),event])
    }
    for(const values of map.values())values.sort(compareEvents)
    return map
  },[events])
  // Both the hour labels and all seven day columns use one minute-to-pixel
  // function. Vertical positions never depend on how many cards precede a class.
  const weekTimed=visibleWeekDates.flatMap(date =>
    (eventMap.get(date)||[]).filter(isTimed))
  const weekFirstHour=weekTimed.length
    ? Math.max(6,Math.floor(Math.min(...weekTimed.map(e=>minute(e.startTime)))/60)-1) : 8
  const weekLastHour=weekTimed.length
    ? Math.min(23,Math.max(weekFirstHour+3,
        Math.ceil(Math.max(...weekTimed.map(e=>Math.max(minute(e.endTime,minute(e.startTime)+45),minute(e.startTime)+28)))/60)+1))
    : 18
  // The all-day lane has a *shared* height across all three columns. Compute it
  // from the number and approximate wrapped line counts of the actual entries.
  // Each item is rendered in full rather than hidden under an unusable "+N".
  const allDayFor=(date:string)=>(eventMap.get(date)||[])
    .filter(event=>!isTimed(event))
  const allDayHeight=Math.max(70,...visibleWeekDates.map(date=>{
    const entries=allDayFor(date)
    return 12+entries.reduce((height,event)=>{
      // Portrait day columns are about 85–115 CSS px wide; allow wrapping
      // with extra headroom for long Chinese homework names.
      const lines=Math.max(1,Math.ceil(event.title.length/7))
      return height+Math.max(36,19+lines*15)
    },0)+Math.max(0,entries.length-1)*5
  }))
  const WEEK_HOUR_PX=54
  const weekHeight=(weekLastHour-weekFirstHour)*WEEK_HOUR_PX
  const weekPosition=(minutes:number)=>Math.max(0,Math.min(weekHeight,(minutes-weekFirstHour*60)/60*WEEK_HOUR_PX))
  const dayEvents=eventMap.get(selected)||[]
  const shift=(offset:number)=>{
    setHasNestedMotion(true)
    setMotionDirection(offset < 0 ? 'backward' : 'forward')
    const next=nextDay(selected,offset)
    setSelected(next)
    if(monday(next)!==monday(selected))onWeekChange(monday(next))
    if(next.slice(0,7)!==month)onMonthChange(next.slice(0,7))
  }
  const select=(date:string)=>{
    if (date !== selected) setHasNestedMotion(true)
    setMotionDirection(date < selected ? 'backward' : 'forward')
    setSelected(date)
    if(monday(date)!==monday(selected))onWeekChange(monday(date))
    if(date.slice(0,7)!==month)onMonthChange(date.slice(0,7))
  }
  const [year,mon]=month.split('-').map(Number)
  const first=new Date(Date.UTC(year,mon-1,1)).getUTCDay()
  const last=new Date(Date.UTC(year,mon,0)).getUTCDate()
  const monthDates=Array.from({length:Math.ceil((first+last)/7)*7},(_,i)=>{
    const d=new Date(Date.UTC(year,mon-1,1+i-first))
    return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate())
  })
  const dayLabel=DOW[dayIndex(selected)]
  return <>
    <div className="page-intro calendar-head"><h1>课表</h1>
      <div className="calendar-head-actions">
        <div className="calendar-display-switch" role="group" aria-label="课表显示方式">
          <button type="button" className={display==='week'?'on':''} onClick={()=>{if(display!=='week')setHasNestedMotion(true);setMotionDirection('backward');setDisplay('week')}}>周</button>
          <button type="button" className={display==='day'?'on':''} onClick={()=>{if(display!=='day')setHasNestedMotion(true);setMotionDirection('forward');setDisplay('day')}}>日</button>
        </div>
        <button type="button" className="today-pill" onClick={()=>{select(today);setView('week');setDisplay('day')}}>今天</button>
        <button type="button" className="calendar-add" onClick={()=>onAddSchedule(selected)}
          aria-label={'添加 '+selected+' 的个人日程'}>＋</button>
      </div>
    </div>
    <section className="week-navigator glass">
      <div className="week-toolbar">
        <button aria-label="上一周" onClick={()=>shift(-7)}><Icon name="left" size={18}/></button>
        <button className="week-range" onClick={()=>setView(v=>v==='week'?'month':'week')} aria-expanded={view==='month'}>
          {weekDates[0].slice(0,7)===weekDates[6].slice(0,7)?weekDates[0].slice(0,7):weekDates[0].slice(0,7)+' — '+weekDates[6].slice(5,7)} <Icon name="calendar" size={15}/>
        </button>
        <button aria-label="下一周" onClick={()=>shift(7)}><Icon name="right" size={18}/></button>
      </div>
      <div className="week-days">{weekDates.map((d,i)=><button type="button" key={d}
        onClick={()=>select(d)} className={['week-day',d===selected?'active':'',d===today?'is-today':''].join(' ')}
        aria-label={DOW[dayIndex(d)]+' '+d} aria-pressed={d===selected}>
        <small>{DOW[dayIndex(d)].slice(-1)}</small><strong>{Number(d.slice(-2))}</strong>
        <span className={'week-indicators '+((eventMap.get(d)||[]).some(isHomework)?'has-homework':'')}>{(eventMap.get(d)||[]).length>0?'•':''}</span>
      </button>)}</div>
      {view==='month'&&<div className="month-fold">
        <div className="month-fold-title"><span>{year} 年 {mon} 月</span><button onClick={()=>setView('week')} aria-label="收起月历"><Icon name="close" size={16}/></button></div>
        <div className="calendar-grid weekdays">{['日','一','二','三','四','五','六'].map(x=><span key={x}>{x}</span>)}</div>
        <div className="calendar-grid month-grid">{monthDates.map(d=><button type="button" key={d}
          className={['calendar-day',d===selected?'picked':'',d===today?'today':'',d.slice(0,7)!==month?'outside':''].join(' ')}
          onClick={()=>{select(d);setView('week')}}><span>{Number(d.slice(-2))}</span>{eventMap.has(d)&&<i/>}</button>)}</div>
      </div>}
    </section>

    <div key={display === 'week' ? 'week-' + selected : 'day-' + selected}
      className={'calendar-panel-transition' + (hasNestedMotion ? ' nested-motion' : '') + ' calendar-panel--' + motionDirection}>
    {display==='week' && <section className="week-overview glass" aria-label="适配手机的本周课程时间表">
      <div className="week-view-toolbar">
        <div className="week-view-caption">
          <strong>课表</strong>
        </div>
        <div className="week-page-buttons" role="group" aria-label="切换显示的日期">
          <button type="button" aria-label="显示前一天" onClick={()=>shift(-1)}>
            <Icon name="left" size={17}/>
          </button>
          <button type="button" aria-label="显示后一天" onClick={()=>shift(1)}>
            <Icon name="right" size={17}/>
          </button>
        </div>
      </div>
      <div className="week-timetable-scroll" role="region" tabIndex={0}
        aria-label="每小时对齐的周课表，点击课程查看当天详情"
        onTouchStart={e=>{
          const touch=e.touches[0]
          if(touch)weekSwipeStart.current={x:touch.clientX,y:touch.clientY}
        }}
        onTouchEnd={e=>{
          if(!weekSwipeStart.current)return
          const touch=e.changedTouches[0]
          const start=weekSwipeStart.current
          weekSwipeStart.current=null
          if(!touch)return
          const dx=touch.clientX-start.x,dy=touch.clientY-start.y
          if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.3){
            shift(dx<0?1:-1)
          }
        }}
        onTouchCancel={()=>{weekSwipeStart.current=null}}>
        <div className="week-timetable-grid"
          style={{
            gridTemplateColumns:'46px repeat('+visibleWeekDates.length+',minmax(0,1fr))',
            '--week-all-day-height':allDayHeight+'px'
          } as React.CSSProperties}>
          <div className="week-time-axis">
            <div className="week-time-header week-axis-heading">时间</div>
            <div className="week-all-day week-axis-all-day">全天</div>
            <div className="week-hour-column" style={{height:weekHeight}}>
              {Array.from({length:weekLastHour-weekFirstHour+1},(_,i)=>i+weekFirstHour).map(hour=>
                <div className="week-time-label" key={hour}
                  style={{top:weekPosition(hour*60)}}>{pad(hour)}:00</div>)}
            </div>
          </div>
          {visibleWeekDates.map(date=>{
            const entries=eventMap.get(date)||[]
            const allDay=entries.filter(e=>!isTimed(e))
            const placed=placeClasses(entries)
            const weekday=DOW[dayIndex(date)]
            return <div key={date} className={'week-time-column'+(date===today?' is-today':'')+(date===selected?' is-selected':'')}
              data-date={date}>
              <button type="button" className={'week-time-header week-day-heading'+(date===selected?' picked':'')}
                onClick={()=>{select(date);setDisplay('day')}} aria-label={weekday+' '+date+'，查看日课表'}>
                <span>{weekday}</span><strong>{Number(date.slice(-2))}</strong>
              </button>
              <div className="week-all-day">
                {allDay.length>0 ? allDay.map(event=>
                  <button type="button" key={event.id} className="week-all-day-chip"
                    onClick={()=>{
                      if(event.id.startsWith('personal-'))onEditSchedule(event.id)
                      else {select(date);setDisplay('day')}
                    }}
                    aria-label={event.title} title={event.title}>
                    <span>{event.title}</span>
                  </button>) : <span className="week-all-day-empty">—</span>}
              </div>
              <div className="week-hour-lane" style={{height:weekHeight}}>
                {Array.from({length:weekLastHour-weekFirstHour+1},(_,i)=>i+weekFirstHour).map(hour=>
                  <div key={hour} className="week-hour-rule" style={{top:weekPosition(hour*60)}}/>)}
                {placed.map(({event,start,end,left,width,tone})=>
                  <button type="button" key={event.id} className={'week-time-event '+tone+
                    (event.type==='assignment'?' week-time-homework':'')+
                    (scheduleKind(event)==='exam'?' week-time-exam':'')}
                    style={{
                      top:weekPosition(start),
                      height:Math.max(24,weekPosition(end)-weekPosition(start)-3),
                      left:left+'%',width:'calc('+width+'% - 2px)'
                    }}
                    onClick={()=>{
                      if(event.id.startsWith('personal-'))onEditSchedule(event.id)
                      else {select(date);setDisplay('day')}
                    }}
                    aria-label={timeText(event.startTime)+' '+event.title}>
                    <span>{event.type==='assignment'?'截止 ':''}{timeText(event.startTime)}</span>
                    <strong>{event.title}</strong>
                    {(event.type==='course'||event.type==='exam')&&schedulePlace(event)&&
                      <small className="week-classroom" title={schedulePlace(event)}>
                        {schedulePlace(event)}
                      </small>}
                  </button>)}
              </div>
            </div>
          })}
        </div>
      </div>
    </section>}
    {display==='day'&&<>
      <div className="schedule-day-head">
        <div><strong>{Number(selected.slice(5,7))} 月 {Number(selected.slice(-2))} 日</strong>
          <span>{dayLabel}</span></div>
        {busy?<span className="sync-state"><span className="sync-spin"/>自动同步中</span>:
          <span className="sync-state">{dayEvents.length} 项安排</span>}
      </div>
      <section className="day-timeline glass" aria-label="按时间顺序排列的日程、作业和考试">
        {dayEvents.length===0?<div className="day-group-empty">当天没有课程、作业或考试</div>:
          dayEvents.map(event=>{
            const kind=scheduleKind(event)
            return <div key={event.id} className={'day-group-item day-timeline-item kind-'+kind}>
              <div className="day-item-time">
                <strong>{timeText(event.startTime)}</strong>
                {isTimed(event)&&timeText(event.endTime)!==timeText(event.startTime)&&
                  <small>{timeText(event.endTime)}</small>}
              </div>
              <div className="day-item-copy">
                <span className={'day-kind-pill day-kind-'+kind}>
                  {event.type==='exam'&&event.examType?event.examType:scheduleLabel(kind)}
                </span>
                <strong>{event.title}</strong>
                {schedulePlace(event)&&
                  <span className="day-item-place">教室 · {schedulePlace(event)}</span>}
                {event.courseName&&!schedulePlace(event)&&
                  event.courseName!=='正式课表'&&event.courseName!=='个人日程'&&
                  <span className="day-item-subtitle">{event.courseName}</span>}
              </div>
              {event.id.startsWith('personal-')&&
                <button type="button" className="day-item-edit"
                  onClick={()=>onEditSchedule(event.id)}>编辑</button>}
            </div>
          })}
      </section>
    </>}
    </div>
    {!officialConnected&&<button className="connect-timetable glass" onClick={onOfficial}>
      <Icon name="school" size={18}/><span>连接正式课表</span><Icon name="right" size={16}/>
    </button>}
    {!examConnected&&<div className="exam-connect-panel glass">
      <div className="exam-connect-copy">
        <strong>{examChecking?'正在读取学校考试安排…':'连接考试信息'}</strong>
        <span>{examWarning||'从学在交大同步正式考试时间、类型与考场'}</span>
      </div>
      <div className="exam-connect-actions">
        <button type="button" disabled={examChecking} onClick={onExamConnect}>学在交大</button>
        <button type="button" disabled={examChecking} onClick={onExamFallback}>教务备用</button>
      </div>
    </div>}
    {examConnected&&<div className="exam-connected-note">
      已连接{examSource||'学校'}考试信息 · 考试安排自动同步
    </div>}
  </>
}
