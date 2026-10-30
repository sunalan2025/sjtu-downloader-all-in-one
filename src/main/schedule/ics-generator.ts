/**
 * RFC 5545 iCalendar (.ics) 生成器
 *
 * 将交我办排课事件与 Canvas DDL 转换为标准 iCalendar 格式，
 * 支持 Asia/Shanghai 时区定义、自定义提前提醒 (VALARM) 与规范字符转义。
 */
import type { ScheduleEvent, IcsExportOptions } from '../../shared/types'

const CRLF = '\r\n'

/** 转义 iCalendar 文本字段中的特殊字符（\ -> \\, ; -> \;, , -> \,, \n -> \n） */
export function escapeIcsText(text: string): string {
  if (!text) return ''
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/** 将日期字符串（支持 "YYYY-MM-DD HH:mm", "YYYY-MM-DD HH:mm:ss", ISO 格式）格式化为 iCal 本地时间 "YYYYMMDDTHHmmss" */
export function formatIcsDateTime(dateInput: string | Date): string {
  const d = typeof dateInput === 'string' ? parseDateString(dateInput) : dateInput
  if (!d || isNaN(d.getTime())) {
    // 容错返回当前时间
    const now = new Date()
    return formatDigits(now.getFullYear(), 4) +
      formatDigits(now.getMonth() + 1, 2) +
      formatDigits(now.getDate(), 2) +
      'T' +
      formatDigits(now.getHours(), 2) +
      formatDigits(now.getMinutes(), 2) +
      formatDigits(now.getSeconds(), 2)
  }
  return formatDigits(d.getFullYear(), 4) +
    formatDigits(d.getMonth() + 1, 2) +
    formatDigits(d.getDate(), 2) +
    'T' +
    formatDigits(d.getHours(), 2) +
    formatDigits(d.getMinutes(), 2) +
    formatDigits(d.getSeconds(), 2)
}

/** 辅助解析各种常见日期字符串 */
function parseDateString(str: string): Date {
  const s = str.trim()
  // "YYYY-MM-DD HH:mm" 或 "YYYY-MM-DD HH:mm:ss"
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
  if (m) {
    const year = parseInt(m[1], 10)
    const month = parseInt(m[2], 10) - 1
    const day = parseInt(m[3], 10)
    const hour = m[4] ? parseInt(m[4], 10) : 0
    const min = m[5] ? parseInt(m[5], 10) : 0
    const sec = m[6] ? parseInt(m[6], 10) : 0
    return new Date(year, month, day, hour, min, sec)
  }
  return new Date(str)
}

function formatDigits(n: number, len: number): string {
  return String(n).padStart(len, '0')
}

/** 生成 Asia/Shanghai 标准 VTIMEZONE 块，避免导入 Google / Outlook / Apple 时出现时区错位 */
export function buildVTimezoneShanghai(): string[] {
  return [
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Shanghai',
    'X-LIC-LOCATION:Asia/Shanghai',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:CST',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE'
  ]
}

/** 为事件构建单个 VEVENT 条目 */
export function buildVEvent(
  event: ScheduleEvent,
  options: IcsExportOptions,
  nowFormatted: string
): string[] {
  const lines: string[] = []
  lines.push('BEGIN:VEVENT')

  // UID 必须全域唯一
  const uid = event.id.includes('@') ? event.id : `${event.id}@sjtu.edu.cn`
  lines.push(`UID:${uid}`)
  lines.push(`DTSTAMP:${nowFormatted}Z`)

  const startFormatted = formatIcsDateTime(event.startTime)
  const endFormatted = formatIcsDateTime(event.endTime)

  if (event.allDay) {
    // 全天事件使用 VALUE=DATE:YYYYMMDD
    const startDateOnly = startFormatted.slice(0, 8)
    const endDateOnly = endFormatted.slice(0, 8)
    lines.push(`DTSTART;VALUE=DATE:${startDateOnly}`)
    lines.push(`DTEND;VALUE=DATE:${endDateOnly}`)
  } else {
    lines.push(`DTSTART;TZID=Asia/Shanghai:${startFormatted}`)
    lines.push(`DTEND;TZID=Asia/Shanghai:${endFormatted}`)
  }

  // 标题
  let summary = event.title
  if (event.type === 'assignment_ddl') {
    summary = summary.startsWith('[DDL]') ? summary : `[DDL] ${summary}`
  } else if (event.type === 'exam') {
    summary = summary.startsWith('[考试]') ? summary : `[考试] ${summary}`
  }
  lines.push(`SUMMARY:${escapeIcsText(summary)}`)

  // 地点
  if (event.location && event.location !== '不排教室') {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`)
  }

  // 描述
  const descParts: string[] = []
  if (event.teacher) descParts.push(`授课教师: ${event.teacher}`)
  if (event.courseName && event.courseName !== event.title) descParts.push(`所属课程: ${event.courseName}`)
  if (event.weekInfo) descParts.push(`周次校历: ${event.weekInfo}`)
  if (event.examType) descParts.push(`考试类别: ${event.examType}`)
  if (event.conflictCourseTitle) descParts.push(`时段排课冲突: 占用日常课程「${event.conflictCourseTitle}」`)
  if (event.description) descParts.push(event.description)

  if (descParts.length > 0) {
    lines.push(`DESCRIPTION:${escapeIcsText(descParts.join('\n'))}`)
  }

  // 提醒 (VALARM)
  if (event.type === 'course' && options.alarmMinutesBefore > 0) {
    lines.push('BEGIN:VALARM')
    lines.push(`TRIGGER:-PT${options.alarmMinutesBefore}M`)
    lines.push('ACTION:DISPLAY')
    lines.push(`DESCRIPTION:课程上课提醒: ${escapeIcsText(event.title)}`)
    lines.push('END:VALARM')
  } else if (event.type === 'assignment_ddl' && options.alarmDdlHoursBefore > 0) {
    lines.push('BEGIN:VALARM')
    lines.push(`TRIGGER:-PT${options.alarmDdlHoursBefore}H`)
    lines.push('ACTION:DISPLAY')
    lines.push(`DESCRIPTION:作业截止提醒: ${escapeIcsText(event.title)}`)
    lines.push('END:VALARM')
  } else if (event.type === 'exam') {
    const examHours = options.alarmExamHoursBefore ?? 24
    if (examHours > 0) {
      lines.push('BEGIN:VALARM')
      lines.push(`TRIGGER:-PT${examHours}H`)
      lines.push('ACTION:DISPLAY')
      lines.push(`DESCRIPTION:考试备考提醒 (考前 ${examHours} 小时): ${escapeIcsText(event.title)}`)
      lines.push('END:VALARM')
    }
    const examMins = options.alarmExamMinutesBefore ?? 120
    if (examMins > 0) {
      lines.push('BEGIN:VALARM')
      lines.push(`TRIGGER:-PT${examMins}M`)
      lines.push('ACTION:DISPLAY')
      lines.push(`DESCRIPTION:考试出发提醒 (考前 ${Math.round(examMins / 60)} 小时): ${escapeIcsText(event.title)}`)
      lines.push('END:VALARM')
    }
  }

  lines.push('END:VEVENT')
  return lines
}

/**
 * 将事件列表按选项编译为完整的 RFC 5545 iCalendar 文本
 */
export function generateIcsContent(
  events: ScheduleEvent[],
  options: IcsExportOptions = {
    includeCourses: true,
    includeDdl: true,
    includeExams: true,
    alarmMinutesBefore: 20,
    alarmDdlHoursBefore: 24,
    alarmExamHoursBefore: 24,
    alarmExamMinutesBefore: 120
  }
): string {
  const filtered = events.filter(e => {
    if (e.type === 'course') return options.includeCourses !== false
    if (e.type === 'activity') return options.includeActivities !== false
    if (e.type === 'assignment_ddl') return options.includeDdl !== false
    if (e.type === 'exam') return options.includeExams !== false
    return true
  })

  const now = new Date()
  const nowFormatted = now.getUTCFullYear() +
    formatDigits(now.getUTCMonth() + 1, 2) +
    formatDigits(now.getUTCDate(), 2) +
    'T' +
    formatDigits(now.getUTCHours(), 2) +
    formatDigits(now.getUTCMinutes(), 2) +
    formatDigits(now.getUTCSeconds(), 2)

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SJTU Course Downloader//SJTU Schedule Calendar//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:上海交通大学课表与日程',
    'X-WR-TIMEZONE:Asia/Shanghai',
    ...buildVTimezoneShanghai()
  ]

  for (const ev of filtered) {
    const vEventLines = buildVEvent(ev, options, nowFormatted)
    lines.push(...vEventLines)
  }

  lines.push('END:VCALENDAR')
  return lines.join(CRLF) + CRLF
}
