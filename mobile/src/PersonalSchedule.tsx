import { useEffect, useState, type FormEvent } from 'react'
import type { CalendarEvent } from './native'

export type PersonalEvent = {
  id: string
  title: string
  date: string
  start: string
  end: string
  allDay: boolean
  notes: string
}

export const PERSONAL_STORAGE_KEY = 'sjtu-personal-schedule-v1'

export function readPersonalEvents(): PersonalEvent[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PERSONAL_STORAGE_KEY) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item): item is PersonalEvent =>
      typeof item === 'object' && item !== null &&
      typeof item.id === 'string' && /^personal-/.test(item.id) &&
      typeof item.title === 'string' &&
      typeof item.date === 'string' && /^\d{4}-\d\d-\d\d$/.test(item.date) &&
      typeof item.start === 'string' && typeof item.end === 'string' &&
      typeof item.allDay === 'boolean' && typeof item.notes === 'string'
    ).slice(0, 500)
  } catch { return [] }
}

export function asCalendarEvent(item: PersonalEvent): CalendarEvent {
  return {
    id: item.id,
    title: item.title,
    startTime: item.allDay ? item.date : item.date + 'T' + item.start + ':00+08:00',
    endTime: item.allDay ? item.date : item.date + 'T' + item.end + ':00+08:00',
    courseName: item.notes ? '个人 · ' + item.notes : '个人日程',
    type: 'event'
  }
}

export function PersonalScheduleEditor({current,initialDate,onSave,onDelete,onClose}:{
  current: PersonalEvent | null
  initialDate: string
  onSave: (event: PersonalEvent) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const [title,setTitle]=useState(current?.title || '')
  const [date,setDate]=useState(current?.date || initialDate)
  const [start,setStart]=useState(current?.start || '09:00')
  const [end,setEnd]=useState(current?.end || '10:00')
  const [allDay,setAllDay]=useState(current?.allDay || false)
  const [notes,setNotes]=useState(current?.notes || '')
  const [error,setError]=useState('')
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()}
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  },[onClose])
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!title.trim() || !date) {setError('请填写日程标题和日期');return}
    if (!allDay && end <= start) {setError('结束时间必须晚于开始时间');return}
    const id=current?.id || 'personal-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2,7)
    onSave({
      id,title:title.trim().slice(0,120),date,start,end,allDay,
      notes:notes.trim().slice(0,500)
    })
  }
  return <div className="schedule-modal-backdrop" onPointerDown={e=>{
    if(e.target===e.currentTarget)onClose()
  }}>
    <section className="schedule-modal glass" role="dialog" aria-modal="true"
      aria-labelledby="schedule-editor-title">
      <div className="schedule-modal-head">
        <h2 id="schedule-editor-title">{current?'编辑日程':'新建日程'}</h2>
        <button type="button" onClick={onClose} aria-label="关闭日程编辑器">×</button>
      </div>
      <form onSubmit={submit}>
        <label>日程标题<input autoFocus maxLength={120} required
          value={title} onChange={e=>setTitle(e.target.value)}
          placeholder="例如：实验课、社团活动、个人计划"/></label>
        <label>日期<input type="date" required value={date}
          onChange={e=>setDate(e.target.value)}/></label>
        <label className="schedule-all-day"><input type="checkbox" checked={allDay}
          onChange={e=>setAllDay(e.target.checked)}/> 全天日程</label>
        {!allDay&&<div className="schedule-time-range">
          <label>开始<input type="time" required value={start}
            onChange={e=>setStart(e.target.value)}/></label>
          <label>结束<input type="time" required value={end}
            onChange={e=>setEnd(e.target.value)}/></label>
        </div>}
        <label>备注（选填）<textarea rows={2} maxLength={500}
          value={notes} onChange={e=>setNotes(e.target.value)}
          placeholder="地点、提醒事项等"/></label>
        {error&&<p className="schedule-form-error" role="alert">{error}</p>}
        <div className="schedule-form-actions">
          {current&&<button type="button" className="schedule-delete" onClick={()=>{
            if(window.confirm('删除这条自定义日程？'))onDelete(current.id)
          }}>删除</button>}
          <button type="button" className="schedule-cancel" onClick={onClose}>取消</button>
          <button type="submit" className="primary">保存日程</button>
        </div>
      </form>
    </section>
  </div>
}
