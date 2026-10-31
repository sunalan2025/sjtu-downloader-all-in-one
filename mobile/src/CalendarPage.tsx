import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import type { CalendarEvent } from './native'

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
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hour12:false}).format(d)
}
const minute = (time: string, fallback = 480) => {
  const t = timeText(time).match(/^(\d{2}):(\d{2})$/)
  return t ? Number(t[1])*60+Number(t[2]) : fallback
}
const isTimed = (e: CalendarEvent) => /^\d{2}:\d{2}$/.test(timeText(e.startTime))
const isHomework = (e: CalendarEvent) => e.type === 'assignment'
const isClass = (e: CalendarEvent) => e.type === 'course'
const isActivity = (e: CalendarEvent) => e.type === 'event'
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
export function CalendarPage({month,onMonthChange,onWeekChange,events,busy,onRefresh,onOfficial,officialConnected}:{
  month:string
  onMonthChange:(month:string)=>void
  onWeekChange:(weekStart:string)=>void
  events:CalendarEvent[]
  busy:boolean
  onRefresh:()=>void
  onOfficial:()=>void
  officialConnected?:boolean
}) {
  const today=currentDate()
  const [selected,setSelected]=useState(today)
  const [view,setView]=useState<'week'|'month'>('week')
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
  const eventMap=useMemo(()=>{
    const map=new Map<string,CalendarEvent[]>()
    const seen=new Set<string>()
    for(const event of events){
      const date=shanghaiDate(event.startTime)
      const key=[date,event.title,event.type,timeText(event.startTime)].join('|')
      if(!date||seen.has(key))continue
      seen.add(key)
      map.set(date,[...(map.get(date)||[]),event])
    }
    return map
  },[events])
  const dayEvents=eventMap.get(selected)||[]
  const classEvents=dayEvents.filter(isClass)
  const activityEvents=dayEvents.filter(isActivity)
  const homework=dayEvents.filter(isHomework)
  const timed=placeClasses([...classEvents,...activityEvents])
  const untimed=dayEvents.filter(e=>!isHomework(e)&&!isTimed(e))
  // Trim empty morning/evening hours so homework and classes fit on one screen.
  const firstHour=timed.length?Math.max(6,Math.floor(Math.min(...timed.map(e=>e.start))/60)-1):8
  const lastHour=timed.length?Math.min(23,Math.ceil(Math.max(...timed.map(e=>e.end))/60)+1):11
  const MIN_TIME=firstHour*60
  const MAX_TIME=lastHour*60
  const PX_PER_HOUR=53
  const position=(m:number)=>Math.max(0,(m-MIN_TIME)/60*PX_PER_HOUR)
  const shift=(offset:number)=>{
    const next=nextDay(selected,offset)
    setSelected(next)
    if(monday(next)!==monday(selected))onWeekChange(monday(next))
    if(next.slice(0,7)!==month)onMonthChange(next.slice(0,7))
  }
  const select=(date:string)=>{
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
        <button type="button" className="today-pill" onClick={()=>{select(today);setView('week')}}>今天</button>
        <button type="button" className="icon-button" aria-label="同步日程" disabled={busy} onClick={onRefresh}><Icon name="refresh" size={18}/></button>
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
    <div className="schedule-day-head"><div><strong>{Number(selected.slice(5,7))} 月 {Number(selected.slice(-2))} 日</strong><span>{dayLabel}</span></div>
      {busy?<span className="sync-state"><span className="sync-spin"/>同步中</span>:<span className="sync-state">{classEvents.length} 节课程 · {homework.length} 项作业</span>}</div>
    {homework.length>0&&<div className="deadline-wrapper"><section className="deadline-section">
      <div className="schedule-section-title"><h2>作业截止</h2><span>{homework.length?homework.length+' 项':'无'}</span></div>
      <div className="deadline-grid">{homework.sort((a,b)=>a.startTime.localeCompare(b.startTime)).map(e=>
        <article className="deadline-card glass" key={e.id}>
          <div className="deadline-icon"><Icon name="clock" size={18}/></div>
          <div className="deadline-info"><strong>{e.title}</strong>{e.courseName&&<small>{e.courseName}</small>}</div>
          <time className="deadline-time">{timeText(e.startTime)}</time>
        </article>)}</div>
    </section>
    </div>}
    {!busy&&timed.length===0?<div className="no-classes glass"><Icon name="book" size={20}/>今天没有课程安排</div>:
    <section className="timetable glass" aria-label="当日课程时间课表">
      <div className="timetable-axis">
        {Array.from({length:lastHour-firstHour+1},(_,i)=>i+firstHour).map(hour=><div key={hour} className="timetable-hour" style={{top:position(hour*60)}}>{pad(hour)}:00</div>)}
      </div>
      <div className="timetable-track" style={{height:(MAX_TIME-MIN_TIME)/60*PX_PER_HOUR}}>
        {Array.from({length:lastHour-firstHour+1},(_,i)=>i+firstHour).map(hour=><div className="timetable-line" key={hour} style={{top:position(hour*60)}}/>)}
        {!busy&&timed.length===0&&<div className="timetable-empty">当天暂无课程安排</div>}
        {timed.map(({event,start,end,left,width,tone})=>{
          const top=position(Math.max(MIN_TIME,start))
          const height=Math.max(44,position(Math.min(MAX_TIME,end))-top-3)
          return <article key={event.id} className={'time-class '+tone}
            style={{top,left:left+'%',width:'calc('+width+'% - 5px)',height}}>
            <strong>{event.title}</strong>
            <span className="time-class-range">{timeText(event.startTime)}–{timeText(event.endTime)}</span>
            {event.courseName&&!/^(课程活动|正式课表)$/.test(event.courseName)&&<small>{event.courseName}</small>}
          </article>
        })}
        {(()=>{
          if(selected!==today)return null
          const now=new Date(),p=new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now)
          const nowM=Number(p.find(v=>v.type==='hour')?.value)*60+Number(p.find(v=>v.type==='minute')?.value)
          return nowM>=MIN_TIME&&nowM<=MAX_TIME?<div className="time-now" style={{top:position(nowM)}}/>:null
        })()}
      </div>
    </section>}
    {untimed.length>0&&<section className="schedule-extras glass"><div className="schedule-section-label">全天安排</div>
      {untimed.map(e=><div className="schedule-extra" key={e.id}><span className="event-dot"/>{e.title}</div>)}</section>}
    {!officialConnected&&<button className="connect-timetable glass" onClick={onOfficial}>
      <Icon name="school" size={18}/><span>连接正式课表</span><Icon name="right" size={16}/>
    </button>}
  </>
}
