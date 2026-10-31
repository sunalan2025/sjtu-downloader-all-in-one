import { useMemo, useState } from 'react'
import { Icon } from './Icon'
import type { CalendarEvent } from './native'

const weekNames = ['日', '一', '二', '三', '四', '五', '六']
const z = (n: number) => String(n).padStart(2, '0')
export const currentMonth = () => {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).formatToParts(now)
  return String(parts.find(x => x.type === 'year')?.value) + '-' + String(parts.find(x => x.type === 'month')?.value)
}
export const shanghaiDate = (time: string) => {
  if (!time) return ''
  if (/^\d{4}-\d\d-\d\d$/.test(time)) return time
  const d = new Date(time)
  if (Number.isNaN(d.getTime())) return time.slice(0, 10)
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  return [p.find(x => x.type === 'year')?.value, p.find(x => x.type === 'month')?.value, p.find(x => x.type === 'day')?.value].join('-')
}
const eventHour = (time: string) => {
  if (!time || /^\d{4}-\d\d-\d\d$/.test(time)) return '全天'
  const d = new Date(time)
  return Number.isNaN(d.getTime()) ? '日程' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
}

export function CalendarPage({ month, onMonthChange, events, busy, onRefresh, onOfficial }: {
  month: string
  onMonthChange: (month: string) => void
  events: CalendarEvent[]
  busy: boolean
  onRefresh: () => void
  onOfficial: () => void
}) {
  const today = shanghaiDate(new Date().toISOString())
  const [selected, setSelected] = useState(today)
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1).getDay()
  const last = new Date(y, m, 0).getDate()
  const eventMap = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of events) {
      const key = shanghaiDate(event.startTime)
      map.set(key, [...(map.get(key) || []), event])
    }
    return map
  }, [events])
  const days = Array.from({ length: Math.ceil((first + last) / 7) * 7 }, (_, i) => {
    const date = new Date(y, m - 1, 1 + i - first)
    return { key: date.getFullYear() + '-' + z(date.getMonth() + 1) + '-' + z(date.getDate()), day: date.getDate(), inMonth: date.getMonth() === m - 1 }
  })
  const day = selected.startsWith(month) ? selected : month + '-01'
  const todayEvents = eventMap.get(day) || []
  function move(offset: number) {
    const next = new Date(y, m - 1 + offset, 1)
    const iso = next.getFullYear() + '-' + z(next.getMonth() + 1)
    onMonthChange(iso)
    setSelected(iso + '-01')
  }
  return <>
    <div className="page-intro"><div className="eyebrow">STUDENT CALENDAR</div><h1>我的日程</h1><p>课程活动与作业截止，一眼掌握。</p></div>
    <section className="calendar-card">
      <div className="calendar-toolbar">
        <div><div className="calendar-year">{y} 年</div><strong>{m} 月 <span className="subtle">/ {new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(y, m - 1, 1))}</span></strong></div>
        <div className="calendar-actions"><button aria-label="上个月" onClick={() => move(-1)}><Icon name="left" size={18}/></button><button aria-label="下个月" onClick={() => move(1)}><Icon name="right" size={18}/></button></div>
      </div>
      <div className="calendar-grid weekdays">{weekNames.map(w => <span key={w}>{w}</span>)}</div>
      <div className="calendar-grid month-grid">{days.map(d => <button type="button" key={d.key} onClick={() => setSelected(d.key)} className={['calendar-day',!d.inMonth?'outside':'',d.key === today?'today':'',d.key === day?'picked':''].join(' ')}><span>{d.day}</span>{eventMap.has(d.key) && <i aria-label="有日程"/>}</button>)}</div>
    </section>
    <div className="section-title"><div><h2>{Number(day.slice(-2))} 日安排</h2><p>{day} · {todayEvents.length} 项日程</p></div><button className="icon-button" aria-label="同步日程" disabled={busy} onClick={onRefresh}><Icon name="refresh" size={19}/></button></div>
    {busy ? <div className="loading-note">正在同步 Canvas 日程…</div> : todayEvents.length ? <div className="agenda-list">{todayEvents.map(event => <div className="agenda-item" key={event.id}><div className={event.type==='assignment'?'agenda-icon violet':'agenda-icon'}><Icon name={event.type==='assignment'?'clock':'calendar'} size={19}/></div><div className="agenda-text"><strong>{event.title}</strong><small>{eventHour(event.startTime)} · {event.courseName || (event.type==='assignment'?'作业截止':'课程活动')}</small></div><span className={'agenda-tag '+(event.type==='assignment'?'violet':'')}>{event.type==='assignment'?'DDL':'活动'}</span></div>)}</div> : <div className="empty-box"><div className="empty-picture"><Icon name="calendar" size={30}/></div><strong>这一天暂无同步日程</strong><p>切换日期，或刷新查看新的 Canvas 日历活动。</p></div>}
    <button className="official-card" onClick={onOfficial}><div className="official-icon"><Icon name="school" size={22}/></div><div><strong>查看交大官方课表</strong><small>前往 calendar.sjtu.edu.cn（独立登录）</small></div><Icon name="external" size={17}/></button>
    <p className="disclaimer">当前同步 Canvas 日历事件及作业截止日期；正式教学课表和考试安排尚未接入本地日历，请使用上方官方入口查看。所有时间按北京时间显示。</p>
  </>
}
