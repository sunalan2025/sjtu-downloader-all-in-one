import { useCurrentTime } from './CurrentTime'
import { Collapsible, useModalScrollLock, usePresence, withMotion } from './Motion'
import { scheduleStyle, useScheduleColors } from './ScheduleColors'
import { PageHeader } from './MaterialUI'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import type { CalendarEvent } from './native'
import { scheduleKind, scheduleLabel, schedulePlace, scheduleCourse, compareEvents, scheduleTimeRange, scheduleTitle, assignmentStatusText } from './ScheduleUtils'

const TZ = 'Asia/Shanghai'
// Reuse Intl formatters: a multi-day timetable otherwise allocates hundreds
// of DateTimeFormat instances during a single React render.
const dayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year:'numeric',month:'2-digit',day:'2-digit'
})
const clockFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: TZ,hour:'2-digit',minute:'2-digit',hourCycle:'h23'
})
const DOW = ['周日','周一','周二','周三','周四','周五','周六']
const pad = (n: number) => String(n).padStart(2, '0')
export const shanghaiDate = (time: string) => {
  if (!time) return ''
  if (/^\d{4}-\d\d-\d\d$/.test(time)) return time
  const d = new Date(time)
  if (Number.isNaN(d.getTime())) return time.slice(0, 10)
  const p = dayFormatter.formatToParts(d)
  return [p.find(x=>x.type==='year')?.value,p.find(x=>x.type==='month')?.value,p.find(x=>x.type==='day')?.value].join('-')
}
const currentDate = () => shanghaiDate(new Date().toISOString())
export const currentMonth = () => currentDate().slice(0,7)
const nextDay = (day: string, offset: number) => {
  // Shanghai dates are Gregorian with no daylight-saving transitions.
  return new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7))-1,
    Number(day.slice(8,10))+offset)).toISOString().slice(0,10)
}
const dayIndex = (day: string) => new Date(day+'T12:00:00+08:00').getUTCDay()
const monday = (day: string) => nextDay(day, -(dayIndex(day)+6)%7)
export const currentWeekStart = () => monday(currentDate())
const timeText = (time: string) => {
  if (!time || /^\d{4}-\d\d-\d\d$/.test(time)) return '全天'
  const d = new Date(time)
  return Number.isNaN(d.getTime()) ? '' : clockFormatter.format(d)
}
const minute = (time: string, fallback = 480) => {
  const t = timeText(time).match(/^(\d{2}):(\d{2})$/)
  return t ? Number(t[1])*60+Number(t[2]) : fallback
}
const isTimed = (e: CalendarEvent) => /^\d{2}:\d{2}$/.test(timeText(e.startTime))
const isHomework = (e: CalendarEvent) => e.type === 'assignment'
const endMinute=(event:CalendarEvent)=>{
  const start=minute(event.startTime),duration=(Date.parse(event.endTime)-Date.parse(event.startTime))/60000
  return Math.min(1440,start+(Number.isFinite(duration)&&duration>0?duration:45))
}
type WeekBlock = { start:number; end:number; events:CalendarEvent[] }
/**
 * Homework deadlines are instants, not 28-minute lectures. They are displayed
 * as readable cards in the above-timeline deadline lane, with their actual
 * clock time, instead of manufacturing a clipped 23:59 calendar block.
 *
 * For real timed events, combine genuinely overlapping time ranges into
 * one full-width stack indicator. Narrow 3/5/7-column views must never shrink
 * 3+ concurrent events to unreadable 20px-wide slivers.
 */
function placeClasses(events:CalendarEvent[]):WeekBlock[] {
  const timed=events.filter(e=>isTimed(e)&&e.type!=='assignment')
    .map(event=>{
      const start=minute(event.startTime)
      return {event,start,end:Math.max(start+1,endMinute(event))}
    }).sort((a,b)=>a.start-b.start||a.end-b.end||a.event.title.localeCompare(b.event.title,'zh-CN'))
  const blocks:WeekBlock[]=[]
  let cluster:typeof timed=[]
  let clusterEnd=-1
  const flush=()=>{
    if(!cluster.length)return
    const events=cluster.map(entry=>entry.event)
    blocks.push({
      start:cluster[0].start,end:clusterEnd,events
    })
    cluster=[]
    clusterEnd=-1
  }
  for(const item of timed){
    if(cluster.length&&item.start>=clusterEnd)flush()
    cluster.push(item)
    clusterEnd=Math.max(clusterEnd,item.end)
  }
  flush()
  return blocks
}
const isDeadlineLaneItem=(e:CalendarEvent)=>e.type==='assignment'||!isTimed(e)
export function CalendarPage({month,onMonthChange,onWeekChange,events,busy,officialConnected,
  onAddSchedule,onEditSchedule,onExamConnect,onExamFallback,examConnected,examChecking,examWarning,examSource}:{
  month:string
  onMonthChange:(month:string)=>void
  onWeekChange:(weekStart:string)=>void
  events:CalendarEvent[]
  busy:boolean
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
  useScheduleColors()
  const now=useCurrentTime()
  const today=shanghaiDate(new Date(now).toISOString())
  const [selected,setSelected]=useState(today)
  const [view,setView]=useState<'week'|'month'>('week')
  const [display,setDisplay]=useState<'week'|'day'>('week')
  const [detailEvents,setDetailEvents]=useState<CalendarEvent[]|null>(null)
  const detailPresence=usePresence(detailEvents)
  useModalScrollLock(detailPresence.value!==null)
  const closeDetailsRef=useRef<HTMLButtonElement|null>(null)
  useEffect(()=>{
    if(!detailPresence.value)return
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null
    closeDetailsRef.current?.focus({preventScroll:true})
    const onEscape=(event:KeyboardEvent)=>{if(event.key==='Escape')setDetailEvents(null)}
    const onBack=(event:Event)=>{event.preventDefault();setDetailEvents(null)}
    window.addEventListener('sjtu-modal-back',onBack)
    document.addEventListener('keydown',onEscape)
    return ()=>{
      window.removeEventListener('sjtu-modal-back',onBack)
      document.removeEventListener('keydown',onEscape)
      previousFocus?.focus({preventScroll:true})
    }
  },[detailPresence.value])
  const [motionDirection,setMotionDirection]=useState<'forward'|'backward'>('forward')
  const [hasNestedMotion,setHasNestedMotion]=useState(false)
  const selectedRef=useRef(selected)
  selectedRef.current=selected
  const previousToday=useRef(today)
  useEffect(()=>{
    // The shared wall clock also handles midnight and resume. Follow today
    // only when the user had not deliberately selected another date.
    if(selectedRef.current===previousToday.current&&today!==previousToday.current)setSelected(today)
    previousToday.current=today
  },[today])
  const weekStart=monday(selected)
  const weekDates=Array.from({length:7},(_,i)=>nextDay(weekStart,i))
  const weekSwipeStart=useRef<{x:number;y:number}|null>(null)
  const daySwipeStart=useRef<{x:number;y:number}|null>(null)
  const weekContainer=useRef<HTMLElement|null>(null)
  const [measuredLane,setMeasuredLane]=useState<{key:string;height:number}|null>(null)
  const [availableWidth,setAvailableWidth]=useState(0)
  const [availableHeight,setAvailableHeight]=useState(()=>window.visualViewport?.height||window.innerHeight)
  const [measuredHour,setMeasuredHour]=useState<{key:string;pixels:number}|null>(null)
  const [landscape,setLandscape]=useState(
    ()=>window.matchMedia('(orientation: landscape)').matches)
  useEffect(()=>{
    const node=weekContainer.current
    const measure=()=>{
      setAvailableWidth(node?.getBoundingClientRect().width||window.innerWidth)
      setAvailableHeight(window.visualViewport?.height||window.innerHeight)
      setLandscape(window.matchMedia('(orientation: landscape)').matches)
    }
    const observer=typeof ResizeObserver!=='undefined' ? new ResizeObserver(measure):null
    if(node)observer?.observe(node)
    window.addEventListener('resize',measure)
    window.visualViewport?.addEventListener('resize',measure)
    window.addEventListener('orientationchange',measure)
    measure()
    return()=>{
      observer?.disconnect()
      window.removeEventListener('resize',measure)
      window.visualViewport?.removeEventListener('resize',measure)
      window.removeEventListener('orientationchange',measure)
    }
  },[display,selected,availableWidth>=1000,availableWidth>=660])
  // Use the *actual timetable content width*, rather than tablet model name.
  // A generous landscape canvas shows the standard Mon–Sun week.
  // Medium landscape shows 5 contiguous days including the selected date;
  // narrow portrait stays centered at selected-1/selected/selected+1.
  const visibleWeekCount=landscape && availableWidth>=880?7:
    landscape && availableWidth>=550?5:3
  const selectedIndex=weekDates.indexOf(selected)
  const fiveStart=Math.max(0,Math.min(2,(selectedIndex<0?0:selectedIndex)-2))
  const visibleWeekDates=visibleWeekCount===7?weekDates:
    visibleWeekCount===5?weekDates.slice(fiveStart,fiveStart+5):
    [nextDay(selected,-1),selected,nextDay(selected,1)]

  const eventMap=useMemo(()=>{
    const map=new Map<string,CalendarEvent[]>()
    const seen=new Set<string>()
    for(const event of events){
      const date=shanghaiDate(event.startTime)
      // User-created events are distinct even if their title and time match a
      // school event or another personal entry.
      const key=event.id.startsWith('personal-') ? event.id :
        [date,event.title,event.type,timeText(event.startTime),
          event.type==='assignment'?(event.courseName||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase():''].join('|')
      if(!date||seen.has(key))continue
      seen.add(key)
      const group=map.get(date)
      if(group)group.push(event)
      else map.set(date,[event])
    }
    for(const values of map.values())values.sort(compareEvents)
    return map
  },[events])
  // Deadline points live in the shared-height task lane above the hour grid.
  // The hour axis is based on actual timed lessons/exams, not a 23:59 DDL,
  // which would otherwise extend every day's view through midnight.
  const weekTimed=visibleWeekDates.flatMap(date=>
    (eventMap.get(date)||[]).filter(e=>isTimed(e)&&e.type!=='assignment'))
  const weekFirstHour=weekTimed.length
    ? Math.max(0,Math.floor(Math.min(...weekTimed.map(e=>minute(e.startTime)))/60)-1) : 8
  const weekLastHour=weekTimed.length
    ? Math.min(24,Math.max(weekFirstHour+3,
        Math.ceil(Math.max(...weekTimed.map(endMinute))/60)+1))
    : 18
  const allDayFor=(date:string)=>(eventMap.get(date)||[])
    .filter(isDeadlineLaneItem)
  // The three/five/seven day columns share one deadline-lane height.
  // Account for full multi-line task titles and a separate HH:mm badge
  // instead of dropping items or hiding them behind a "+N" placeholder.
  const deadlineColumnWidth=Math.max(52,(availableWidth-58)/visibleWeekDates.length-10)
  const approximateLetters=Math.max(4,Math.floor((deadlineColumnWidth-8)/10))
  const estimatedLaneHeight=Math.max(70,...visibleWeekDates.map(date=>{
    const entries=allDayFor(date)
    return 14+entries.reduce((sum,event)=>{
      const weightedLength=[...event.title].reduce((n,ch)=>n+(ch.charCodeAt(0)<128?.6:1),0)
      const lines=Math.max(1,Math.ceil(weightedLength/approximateLetters))
      return sum+Math.max(47,29+lines*15)
    },0)+Math.max(0,entries.length-1)*5
  }))
  const laneKey=visibleWeekDates.join('|')+'@'+Math.round(availableWidth)+':'+
    visibleWeekDates.map(date=>(eventMap.get(date)||[]).filter(isDeadlineLaneItem)
      .map(e=>e.id+e.title+assignmentStatusText(e,now)).join(',')).join('|')
  const allDayHeight=Math.max(estimatedLaneHeight,
    measuredLane?.key===laneKey?measuredLane.height:0)
  // CSS text wrapping depends on real rendered column width, fonts and system
  // scaling. Measure each lane's scrollHeight so even long task titles remain
  // visible on narrow OEM WebViews where a character-count estimate falls short.
  useLayoutEffect(()=>{
    if(display!=='week')return
    const measure=()=>{
      const lanes=weekContainer.current?.querySelectorAll<HTMLElement>(
        '.week-time-column .week-all-day')
      if(!lanes?.length)return
      let required=estimatedLaneHeight
      for(const lane of lanes){
        required=Math.max(required,lane.scrollHeight+2)
      }
      setMeasuredLane(previous=>previous?.key===laneKey&&previous.height>=required
        ?previous:{key:laneKey,height:required})
    }
    measure()
    const animation=window.requestAnimationFrame(measure)
    window.addEventListener('resize',measure)
    return ()=>{
      window.cancelAnimationFrame(animation)
      window.removeEventListener('resize',measure)
    }
  },[display,laneKey,estimatedLaneHeight])
  // Narrow columns need more vertical room for wrapped times and course names.
  // Use viewport proportions first, then measure real card content (including
  // system font scaling). Keep one shared scale for all days and the clock line.
  const columnWidth=Math.max(52,(availableWidth-46)/visibleWeekDates.length)
  const baseHour=Math.round(Math.max(64,Math.min(108,
    availableHeight*(landscape ? .085 : .105)+Math.max(0,120-columnWidth)*.3)))
  const hourKey=visibleWeekDates.join('|')+'@'+Math.round(availableWidth)+'x'+Math.round(availableHeight)+':'+
    weekTimed.map(e=>e.id+e.startTime+e.endTime+e.title+schedulePlace(e)).join('|')
  const WEEK_HOUR_PX=Math.max(baseHour,measuredHour?.key===hourKey?measuredHour.pixels:0)
  useLayoutEffect(()=>{
    if(display!=='week')return
    const measure=()=>{
      let required=baseHour
      for(const card of weekContainer.current?.querySelectorAll<HTMLElement>('.week-time-event')||[]){
        const duration=Number(card.dataset.minutes)
        if(duration<45)continue // Short events keep their exact range and a compact title.
        const css=getComputedStyle(card)
        const children=Array.from(card.children).filter(node=>getComputedStyle(node).display!=='none')
        const textHeight=children.reduce((sum,node)=>sum+node.getBoundingClientRect().height,0)
        const content=textHeight+parseFloat(css.paddingTop)+parseFloat(css.paddingBottom)+
          Math.max(0,children.length-1)*parseFloat(css.rowGap||'0')+4
        required=Math.max(required,Math.ceil((content+3)*60/duration))
      }
      const pixels=Math.min(200,required)
      setMeasuredHour(old=>old?.key===hourKey&&old.pixels===pixels?old:{key:hourKey,pixels})
    }
    measure()
    const fonts=()=>measure()
    document.fonts?.addEventListener('loadingdone',fonts)
    return()=>document.fonts?.removeEventListener('loadingdone',fonts)
  },[display,hourKey,baseHour])
  const weekHeight=(weekLastHour-weekFirstHour)*WEEK_HOUR_PX+
    (weekLastHour===24?WEEK_HOUR_PX:0)
  const weekPosition=(minutes:number)=>Math.max(0,
    Math.min(weekHeight,(minutes-weekFirstHour*60)/60*WEEK_HOUR_PX))
  const nowClock=timeText(new Date(now).toISOString())
  const nowMinute=minute(new Date(now).toISOString())
  const showNow=visibleWeekDates.includes(today)&&nowMinute>=weekFirstHour*60&&nowMinute<=weekLastHour*60
  const dayEvents=eventMap.get(selected)||[]
  const shift=(offset:number)=>{
    setHasNestedMotion(true)
    setMotionDirection(offset < 0 ? 'backward' : 'forward')
    const next=nextDay(selected,offset)
    document.documentElement.dataset.navigationDirection=offset<0?'backward':'forward'
    withMotion(()=>{
      setSelected(next)
      if(monday(next)!==monday(selected))onWeekChange(monday(next))
      if(next.slice(0,7)!==month)onMonthChange(next.slice(0,7))
    })
  }
  const select=(date:string)=>{
    if(date===selected)return
    if (date !== selected) setHasNestedMotion(true)
    setMotionDirection(date < selected ? 'backward' : 'forward')
    document.documentElement.dataset.navigationDirection=date<selected?'backward':'forward'
    withMotion(()=>{
      setSelected(date)
      if(monday(date)!==monday(selected))onWeekChange(monday(date))
      if(date.slice(0,7)!==month)onMonthChange(date.slice(0,7))
    })
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
    <PageHeader title="课表" subtitle="课程、考试与作业" className="calendar-head">
      <div className="calendar-head-actions">
        <div className="calendar-display-switch" role="group" aria-label="课表显示方式">
          <button type="button" className={display==='week'?'on':''} onClick={()=>{if(display==='week')return;setHasNestedMotion(true);setMotionDirection('backward');withMotion(()=>setDisplay('week'))}}>周</button>
          <button type="button" className={display==='day'?'on':''} onClick={()=>{if(display==='day')return;setHasNestedMotion(true);setMotionDirection('forward');withMotion(()=>setDisplay('day'))}}>日</button>
        </div>
        <button type="button" className="today-pill" onClick={()=>{select(today);setView('week');if(display!=='day')withMotion(()=>setDisplay('day'))}}>今天</button>
        <button type="button" className="calendar-add" onClick={()=>onAddSchedule(selected)}
          aria-label={'添加 '+selected+' 的个人日程'}>＋</button>
      </div>
    </PageHeader>
    <section className="week-navigator surface-card">
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
      <Collapsible open={view==='month'}><div className="month-fold">
        <div className="month-fold-title"><span>{year} 年 {mon} 月</span><button onClick={()=>setView('week')} aria-label="收起月历"><Icon name="close" size={16}/></button></div>
        <div className="calendar-grid weekdays">{['日','一','二','三','四','五','六'].map(x=><span key={x}>{x}</span>)}</div>
        <div className="calendar-grid month-grid">{monthDates.map(d=><button type="button" key={d}
          className={['calendar-day',d===selected?'picked':'',d===today?'today':'',d.slice(0,7)!==month?'outside':''].join(' ')}
          onClick={()=>{select(d);setView('week')}}><span>{Number(d.slice(-2))}</span>{eventMap.has(d)&&<i/>}</button>)}</div>
      </div></Collapsible>
    </section>

    <div key={display === 'week' ? 'week-' + selected : 'day-' + selected}
      className={'calendar-panel-transition' + (hasNestedMotion ? ' nested-motion' : '') + ' calendar-panel--' + motionDirection}>
    {display==='week' && <section ref={weekContainer}
      className={'week-overview surface-card week-overview--'+visibleWeekCount}
      aria-label={visibleWeekCount===7?'周一到周日完整周课表':visibleWeekCount===5?'五天课表':'三天课表'}>
      <div className="week-view-toolbar">
        <div className="week-view-caption">
          <strong>课表</strong>
          <span>作业在上方，点日程查看详情</span>
        </div>
        <div className="week-page-buttons" role="group" aria-label="切换显示的日期">
          <button type="button" aria-label={visibleWeekCount===7?'上一周':'显示前一天'}
            onClick={()=>shift(visibleWeekCount===7?-7:-1)}>
            <Icon name="left" size={17}/>
          </button>
          <button type="button" aria-label={visibleWeekCount===7?'下一周':'显示后一天'}
            onClick={()=>shift(visibleWeekCount===7?7:1)}>
            <Icon name="right" size={17}/>
          </button>
        </div>
      </div>
      <div className="week-timetable-scroll" role="region" tabIndex={0}
        aria-label="每小时对齐的周课表，截止任务完整显示在时间轴上方，重叠课程可点击查看全部"
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
            shift(dx<0?(visibleWeekCount===7?7:1):(visibleWeekCount===7?-7:-1))
          }
        }}
        onTouchCancel={()=>{weekSwipeStart.current=null}}>
        <div className="week-timetable-grid"
          style={{
            gridTemplateColumns:'46px repeat('+visibleWeekDates.length+',minmax(0,1fr))',
            '--week-all-day-height':allDayHeight+'px',
            '--week-hour-px':WEEK_HOUR_PX+'px'
          } as React.CSSProperties}>
          <div className="week-time-axis">
            <div className="week-time-header week-axis-heading">时间</div>
            <div className="week-all-day week-axis-all-day">全天<br/>截止</div>
            <div className="week-hour-column" style={{height:weekHeight}}>
              {Array.from({length:weekLastHour-weekFirstHour+1},(_,i)=>i+weekFirstHour).map(hour=>
                <div className="week-time-label" key={hour}
                  style={{top:weekPosition(hour*60)}}>{pad(hour)}:00</div>)}
            </div>
          </div>
          {visibleWeekDates.map(date=>{
            const entries=eventMap.get(date)||[]
            const allDay=entries.filter(isDeadlineLaneItem)
            const placed=placeClasses(entries)
            const weekday=DOW[dayIndex(date)]
            return <div key={date} className={'week-time-column'+(date===today?' is-today':'')+(date===selected?' is-selected':'')}
              data-date={date}>
              <button type="button" className={'week-time-header week-day-heading'+(date===selected?' picked':'')}
                onClick={()=>{select(date);withMotion(()=>setDisplay('day'))}} aria-label={weekday+' '+date+'，查看日课表'}>
                <span>{weekday}</span><strong>{Number(date.slice(-2))}</strong>
              </button>
              <div className="week-all-day">
                {allDay.length>0 ? allDay.map(event=>{
                  const kind=scheduleKind(event)
                  return <button type="button" key={event.id}
                    style={scheduleStyle(event)} className={'week-all-day-chip schedule-colored week-deadline-'+kind}
                    onClick={()=>setDetailEvents([event])}
                    aria-label={timeText(event.startTime)+' '+scheduleTitle(event)}
                    title={scheduleTitle(event)}>
                    <span className="week-deadline-time">
                      {isTimed(event)?timeText(event.startTime)+
                        (event.type==='assignment'?' 截止':''):
                        event.type==='assignment'?'当天截止':'全天'}
                    </span>
                    <strong>{scheduleTitle(event)}</strong>
                {assignmentStatusText(event,now)&&<small className="assignment-status">{assignmentStatusText(event,now)}</small>}
                    {event.type==='assignment'&&event.courseName&&
                      <small className="week-deadline-course">课程 · {event.courseName}</small>}
                  </button>
                }) : <span className="week-all-day-empty">—</span>}
              </div>
              <div className="week-hour-lane" style={{height:weekHeight}}>
                {Array.from({length:weekLastHour-weekFirstHour+1},(_,i)=>i+weekFirstHour).map(hour=>
                  <div key={hour} className="week-hour-rule" style={{top:weekPosition(hour*60)}}/>)}
                {placed.map(({events:overlaps,start,end})=>{
                  const primary=overlaps.find(e=>scheduleKind(e)==='exam')||overlaps[0]
                  const many=overlaps.length>1
                  const styleEnd=Math.max(2,weekPosition(end)-weekPosition(start)-3)
                  const density=end-start<45?(styleEnd<44?'minimal':'compact'):'full'
                  // Keep late-night exams tappable inside the final hour.
                  const top=Math.max(0,Math.min(weekPosition(start),weekHeight-styleEnd))
                  return <button type="button" key={primary.id+'-'+start}
                    className={'week-time-event schedule-colored '+
                      (scheduleKind(primary)==='exam'?' week-time-exam':'')+
                      (many?' week-time-stack':'')}
                    data-minutes={end-start} data-density={density}
                    style={{...scheduleStyle(primary),top,height:styleEnd,left:'2px',width:'calc(100% - 4px)'}}
                    onClick={()=>setDetailEvents(overlaps)}
                    aria-label={many?timeText(primary.startTime)+' 开始的 '+overlaps.length+
                      ' 项安排，点击查看完整内容':timeText(primary.startTime)+' '+scheduleTitle(primary)}
                    title={many?overlaps.map(e=>timeText(e.startTime)+' '+scheduleTitle(e)).join('\n'):scheduleTitle(primary)}>
                    <span className="week-event-time">{scheduleTimeRange(primary)}
                      {many?' · '+overlaps.length+' 项':''}</span>
                    {many&&<span className="schedule-conflict-colors">{overlaps.map(e=><i key={e.id} style={scheduleStyle(e)} title={scheduleTitle(e)}/>)}</span>}
                    <strong>{many?'该时段 '+overlaps.length+' 项安排':scheduleTitle(primary)}</strong>
                    {many?(styleEnd>=66?<small className="week-overlap-preview">{overlaps.map(e=>scheduleTitle(e)).join('、')}</small>:null):
                      (primary.type==='course'||primary.type==='exam')&&schedulePlace(primary)&&
                      <small className="week-classroom">{schedulePlace(primary)}</small>}
                  </button>
                })}
              </div>
            </div>
          })}
          {showNow&&<div className="week-now-line" role="note" aria-label={'当前时间 '+nowClock}
            style={{top:'calc(var(--week-head-height) + var(--week-all-day-height) + '+weekPosition(nowMinute)+'px)'}}>
            <time>{nowClock}</time><i aria-hidden="true"/>
          </div>}
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
      <section className="day-timeline surface-card" aria-label="按时间顺序排列的日程、作业和考试"
        onTouchStart={e=>{
          const touch=e.touches[0]
          if(touch)daySwipeStart.current={x:touch.clientX,y:touch.clientY}
        }}
        onTouchEnd={e=>{
          const start=daySwipeStart.current
          daySwipeStart.current=null
          const touch=e.changedTouches[0]
          if(!start||!touch)return
          const dx=touch.clientX-start.x,dy=touch.clientY-start.y
          // Horizontal swipe changes date; vertical scroll remains native.
          if(Math.abs(dx)>55 && Math.abs(dx)>Math.abs(dy)*1.4)
            shift(dx<0?1:-1)
        }}
        onTouchCancel={()=>{daySwipeStart.current=null}}>
        {dayEvents.length===0?<div className="day-group-empty">当天没有课程、作业或考试</div>:
          dayEvents.map(event=>{
            const kind=scheduleKind(event)
            return <div key={event.id} className={'day-group-item day-timeline-item kind-'+kind}>
              <div className="day-item-time">
                <strong>{timeText(event.startTime)}</strong>
                {event.type==='assignment'?<small>截止</small>:
                  timeText(event.endTime)!=='全天'&&timeText(event.endTime)!==timeText(event.startTime)&&
                  <small>至 {timeText(event.endTime)}</small>}
              </div>
              <div className="day-item-copy">
                <div className="day-item-meta">
                  <span className={'day-kind-pill day-kind-'+kind}>
                    <i className="schedule-dot" style={scheduleStyle(event)} aria-hidden="true"/>
                    {event.type==='exam'&&event.examType?event.examType:event.type==='course'?'课程':scheduleLabel(kind)}
                  </span>
                </div>
                <strong>{scheduleTitle(event)}</strong>
                {assignmentStatusText(event,now)&&<small className="assignment-status">{assignmentStatusText(event,now)}</small>}
                {schedulePlace(event)&&
                  <span className="day-item-place">{event.type==='exam'?'考场':'教室'} · {schedulePlace(event)}</span>}
                {event.type==='assignment'&&scheduleCourse(event)&&
                  <span className="day-item-course">所属课程 · {scheduleCourse(event)}</span>}
                {event.type!=='assignment'&&scheduleCourse(event)&&
                  <span className="day-item-subtitle">{scheduleCourse(event)}</span>}
              </div>
              {event.id.startsWith('personal-')&&
                <button type="button" className="day-item-edit button button--tonal button--compact"
                  onClick={()=>onEditSchedule(event.id)}>编辑</button>}
            </div>
          })}
      </section>
    </>}
    </div>
    {detailPresence.value&&createPortal(<div className="week-detail-scrim" data-motion={detailPresence.phase}
      onMouseDown={event=>{if(event.target===event.currentTarget)setDetailEvents(null)}}>
      <section className="week-detail-sheet" role="dialog" aria-modal="true"
        aria-labelledby="week-detail-title">
        <div className="week-detail-top">
          <div>
            <span>完整日程</span>
            <h2 id="week-detail-title">{detailPresence.value.length>1?
              '同一时段的 '+detailPresence.value.length+' 项安排':'日程详情'}</h2>
          </div>
          <button type="button" aria-label="关闭日程详情"
            className="week-detail-close" ref={closeDetailsRef}
            onClick={()=>setDetailEvents(null)}>
            <Icon name="close" size={19}/>
          </button>
        </div>
        <div className="week-detail-list">
          {[...detailPresence.value].sort(compareEvents).map(event=>{
            const kind=scheduleKind(event)
            return <article key={event.id} className={'week-detail-item week-detail-'+kind}>
              <div className="week-detail-meta">
                <span className={'day-kind-pill day-kind-'+kind}>
                  <i className="schedule-dot" style={scheduleStyle(event)} aria-hidden="true"/>
                  {event.type==='exam'&&event.examType?event.examType:event.type==='course'?'课程':scheduleLabel(kind)}
                </span>
                <time>{scheduleTimeRange(event)}</time>
              </div>
              <strong>{scheduleTitle(event)}</strong>
              {assignmentStatusText(event,now)&&<small className="assignment-status">{assignmentStatusText(event,now)}</small>}
              {schedulePlace(event)&&<p>{event.type==='exam'?'考场':'地点'} · {schedulePlace(event)}</p>}
              {scheduleCourse(event)&&<p>{event.id.startsWith('personal-')?'备注 · ':event.type==='assignment'?'所属课程 · ':'课程 · '}{scheduleCourse(event)}</p>}
              {event.id.startsWith('personal-')&&<button type="button" className="button button--tonal button--compact"
                onClick={()=>{setDetailEvents(null);onEditSchedule(event.id)}}>编辑日程</button>}
            </article>
          })}
        </div>
        <button type="button" className="week-detail-day"
          onClick={()=>{
            const date=shanghaiDate(detailPresence.value![0].startTime)
            select(date)
            withMotion(()=>setDisplay('day'))
            setDetailEvents(null)
          }}>查看当天完整时间列表 <Icon name="right" size={16}/></button>
      </section>
    </div>,document.body)}
    {!examConnected&&examWarning?.includes('登录')&&<div className="exam-connect-panel surface-card">
      <div className="exam-connect-copy"><strong>考试安排</strong><span>连接学校考试系统后自动更新。</span></div>
      <div className="exam-connect-actions"><button type="button" className="button button--tonal" disabled={examChecking} onClick={onExamConnect}>
        {examChecking?'正在连接…':'连接考试安排'}
      </button></div>
    </div>}
  </>
}
