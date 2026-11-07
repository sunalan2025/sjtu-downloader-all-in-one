import type { CalendarEvent } from './native'

/** Text classification is a heuristic: the official API does not supply a
 * reliable exam enum. Treat explicit exam words as exams, even in Canvas
 * assignment entries, and label the rest by their API type. */
export type ScheduleKind='schedule'|'homework'|'exam'
const shanghaiClockFormatter = new Intl.DateTimeFormat('zh-CN',{
  timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
})
const EXAM_WORDS=/(考试|期中|期末|随堂测|测试|测验|小测|笔试|机考|闭卷|开卷|quiz|exam|midterm|final\s*exam|\btest\b)/i
export function scheduleKind(item:CalendarEvent):ScheduleKind {
  if(item.type==='exam')return 'exam'
  if(item.type==='course')return 'schedule'
  if(EXAM_WORDS.test(item.title))return 'exam'
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
/** Some older school entries put a classroom in courseName. Only show
 * genuinely additional metadata; never repeat the place as a course. */
const metadataKey=(text:string)=>text.normalize('NFKC').replace(/[\s·:：–—-]+/g,'').toLowerCase()
export function scheduleCourse(item:CalendarEvent):string {
  const course=item.courseName?.trim()||''
  const key=metadataKey(course)
  if(item.type==='exam'||!course||['正式课表','个人日程'].includes(course)||
    key===metadataKey(item.title)||key===metadataKey(schedulePlace(item)))return ''
  return course
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
  return shanghaiClockFormatter.format(value)
}

/** Deadline instants are not lecture ranges. Only report an end time when
 * the official event or personal schedule actually provides a distinct one. */
export function scheduleTimeRange(item:CalendarEvent):string {
  const start=clockText(item.startTime)
  if(item.type==='assignment')return start==='全天'?'当天截止':start+' 截止'
  if(start==='全天')return '全天'
  const end=clockText(item.endTime)
  return end&&end!=='全天'&&end!==start
    ? start+' — '+end
    : start+' · 结束时间未提供'
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
/** Official lesson IDs can be reused every week. An occurrence includes its
 * instant; UTC and Shanghai representations of the same instant still match. */
export function occurrenceKey(event: CalendarEvent): string {
  return event.id + '|' + eventMillis(event)
}
export function compareEvents(a:CalendarEvent,b:CalendarEvent):number {
  return eventMillis(a)-eventMillis(b) ||
    (a.type==='assignment'?1:0)-(b.type==='assignment'?1:0) ||
    a.title.localeCompare(b.title,'zh-CN')
}

/** Keep source titles stable for deduplication; format exams only at display. */
export function scheduleTitle(item: CalendarEvent): string {
  if (item.type !== 'exam') return item.title
  const name = item.courseName?.trim() || item.title.trim()
  return name.endsWith('考试') ? name : name + '考试'
}
export function assignmentStatusText(item: CalendarEvent, now = Date.now()): string {
  if (item.type !== 'assignment' || !item.submissionKnown) return ''
  if (item.submissionStatus === 'graded') {
    if (item.score != null && Number.isFinite(item.score)) {
      const total = item.pointsPossible != null && item.pointsPossible > 0 ? '/' + item.pointsPossible : ''
      return '已评分 ' + item.score + total + ' 分'
    }
    return '已批改' + (item.grade ? ' ' + item.grade : '')
  }
  if (item.submissionStatus === 'submitted') return '已提交 · 待批改'
  if (item.submissionStatus === 'missing' || eventMillis(item) < now) return '已逾期 · 未提交'
  return '待提交'
}
export function assignmentProgress(item: CalendarEvent) {
  return {
    submissionKnown: item.submissionKnown, submissionStatus: item.submissionStatus,
    score: item.score, pointsPossible: item.pointsPossible, grade: item.grade,
    statusUpdatedAt: item.statusUpdatedAt
  }
}
