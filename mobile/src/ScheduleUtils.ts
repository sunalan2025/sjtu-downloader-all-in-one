import type { CalendarEvent } from './native'

/** Text classification is a heuristic: the official API does not supply a
 * reliable exam enum. Treat explicit exam words as exams, even in Canvas
 * assignment entries, and label the rest by their API type. */
export type ScheduleKind='schedule'|'homework'|'exam'
const EXAM_WORDS=/(考试|期中|期末|随堂测|测试|测验|小测|笔试|机考|闭卷|开卷|quiz|exam|midterm|final\s*exam|\btest\b)/i
export function scheduleKind(item:CalendarEvent):ScheduleKind {
  if(item.type==='exam'||EXAM_WORDS.test(item.title))return 'exam'
  return item.type==='assignment'?'homework':'schedule'
}
export function scheduleLabel(kind:ScheduleKind):string {
  return kind==='exam'?'考试':kind==='homework'?'作业':'日程'
}
export function schedulePlace(item:CalendarEvent):string {
  const explicit=item.location?.trim()
  if(explicit)return explicit
  // Older versions returned the official classroom in courseName. Canvas
  // context_name is normally a *course title*, so don't call it a classroom.
  if(item.id.startsWith('official:') &&
    item.courseName && item.courseName!=='正式课表')return item.courseName
  return ''
}
export function dateOffset(date:string,days:number):string {
  const value=new Date(date+'T12:00:00+08:00')
  value.setUTCDate(value.getUTCDate()+days)
  return value.toISOString().slice(0,10)
}
export function shortDate(date:string):string {
  const [,month,day]=date.split('-')
  return Number(month)+'月'+Number(day)+'日'
}
export function clockText(time:string):string {
  if(!time||/^\d{4}-\d\d-\d\d$/.test(time))return '全天'
  const value=new Date(time)
  if(Number.isNaN(value.getTime()))return '全天'
  return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(value)
}

/** Normalize official timezone offsets, Canvas UTC due_at and date-only items
 * before ordering any mixed schedule. Date-only assignments are due at the
 * end of their Shanghai calendar day; all-day personal events start at 00:00. */
export function eventMillis(event:CalendarEvent):number {
  const value=event.startTime
  if(/^\d{4}-\d\d-\d\d$/.test(value)) {
    const suffix=event.type==='assignment'?'T23:59:59+08:00':'T00:00:00+08:00'
    return Date.parse(value+suffix)
  }
  const parsed=Date.parse(value)
  return Number.isFinite(parsed)?parsed:Number.POSITIVE_INFINITY
}
export function compareEvents(a:CalendarEvent,b:CalendarEvent):number {
  return eventMillis(a)-eventMillis(b) ||
    (a.type==='assignment'?1:0)-(b.type==='assignment'?1:0) ||
    a.title.localeCompare(b.title,'zh-CN')
}
