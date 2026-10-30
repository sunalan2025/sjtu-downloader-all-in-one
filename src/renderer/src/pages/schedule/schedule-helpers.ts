import type { ScheduleEvent } from '@shared/types'
import type {
  TimeSlotDef,
  SlotRangeInfo,
  PlacedEvent,
  DayEventCluster
} from './schedule-types'

export const SJTU_TIME_SLOTS: TimeSlotDef[] = [
  {
    id: 1,
    periodHint: '上午',
    slotLabel: '第 1-2 节',
    timeRange: '08:00 - 09:40',
    matchPeriod: m => m >= 7 * 60 && m < 9 * 60 + 50
  },
  {
    id: 2,
    periodHint: '上午',
    slotLabel: '第 3-4 节',
    timeRange: '10:00 - 11:40',
    matchPeriod: m => m >= 9 * 60 + 50 && m < 11 * 60 + 50
  },
  {
    id: 3,
    periodHint: '中午',
    slotLabel: '第 5-6 节',
    timeRange: '12:00 - 13:40',
    matchPeriod: m => m >= 11 * 60 + 50 && m < 12 * 60 + 50
  },
  {
    id: 4,
    periodHint: '下午',
    slotLabel: '第 7-8 节',
    timeRange: '14:00 - 15:40 · 徐汇/医学院 13:30',
    matchPeriod: m => m >= 12 * 60 + 50 && m < 15 * 60 + 50
  },
  {
    id: 5,
    periodHint: '下午',
    slotLabel: '第 9-10 节',
    timeRange: '16:00 - 17:40',
    matchPeriod: m => m >= 15 * 60 + 50 && m < 17 * 60 + 50
  },
  {
    id: 6,
    periodHint: '晚间',
    slotLabel: '第 11-14 节',
    timeRange: '18:00 - 21:30',
    matchPeriod: m => m >= 17 * 60 + 50
  }
]

/** 将官方节次数字映射为 6 大时段编号 (1..6) */
export function periodToSlot(p: number): number {
  if (p <= 2) return 1
  if (p <= 4) return 2
  if (p <= 6) return 3
  if (p <= 8) return 4
  if (p <= 10) return 5
  return 6
}

/** 从教务节次描述（如 "1-2节", "5-10节", "6-8节", "6-9节"）计算其覆盖的标准时段范围与跨行数 */
export function getSlotRangeFromJc(jc: string): SlotRangeInfo {
  if (!jc) return { startSlot: 1, endSlot: 1, span: 1, isLabOrLongSession: false }
  const clean = jc.replace(/节/g, '').trim()
  const m = clean.match(/^(\d+)(?:-(\d+))?/)
  if (!m) return { startSlot: 1, endSlot: 1, span: 1, isLabOrLongSession: false }

  const startP = parseInt(m[1], 10)
  const endP = m[2] ? parseInt(m[2], 10) : startP

  // 1. 特殊超长实验课判定 (如周一下午 5-10 节有机化学实验，横跨 12:00~17:40 整整一个下午)
  if (startP === 5 && endP >= 9) {
    return {
      startSlot: 3,
      endSlot: 5,
      span: 3,
      badge: `${startP}-${endP}节大实验 (12:00 ~ 17:40 · ${endP - startP + 1}节连堂)`,
      isLabOrLongSession: true
    }
  }

  // 2. 6-9 节大实验 (如周四 ET 创新实验 / 周一无机化学实验，12:55~16:45 跨 3 个时段)
  if (startP === 6 && endP >= 9) {
    return {
      startSlot: 3,
      endSlot: 5,
      span: 3,
      badge: `${startP}-${endP}节实验 (12:55 ~ 16:45 · ${endP - startP + 1}节连堂)`,
      isLabOrLongSession: true
    }
  }

  // 3. 6-8 节思政大课 (12:55~15:40，从中午 12:55 跨越至下午 15:40)
  if (startP === 6 && endP === 8) {
    return {
      startSlot: 3,
      endSlot: 4,
      span: 2,
      badge: '6-8节大课 · 12:55 ~ 15:40',
      isLabOrLongSession: false
    }
  }

  // 4. 7-10 节下午长实验 (14:00~17:40)
  if (startP === 7 && endP >= 10) {
    return {
      startSlot: 4,
      endSlot: 5,
      span: 2,
      badge: `${startP}-${endP}节实验 · 14:00 ~ 17:40`,
      isLabOrLongSession: true
    }
  }

  const startSlot = periodToSlot(startP)
  const endSlot = periodToSlot(endP)
  const span = Math.max(1, endSlot - startSlot + 1)
  const isLab = endP - startP + 1 >= 4 || clean.includes('实验')

  let badge: string | undefined
  if (startSlot === 6 && endP >= 13) {
    badge = `${startP}-${endP}节 · ${endP === 14 ? '18:00 ~ 21:30' : '18:00 ~ 20:25'}`
  } else if (span > 1) {
    badge = `${startP}-${endP}节 · ${endP - startP + 1}节连堂`
  }

  return {
    startSlot,
    endSlot,
    span,
    badge,
    isLabOrLongSession: isLab
  }
}

/** 辅助获取节次起始时段编号 (兼容调用) */
export function getSlotIdFromJc(jc: string): number {
  return getSlotRangeFromJc(jc).startSlot
}

/** 从时间时刻 HH:mm 计算其覆盖的标准时段范围与跨行数 */
export function getSlotRangeFromTime(startTime: string, endTime?: string): SlotRangeInfo {
  if (!startTime) return { startSlot: 1, endSlot: 1, span: 1, isLabOrLongSession: false }

  // 1. 若为思政大课
  if (startTime.includes('12:55') || startTime.includes('6-8')) {
    return {
      startSlot: 3,
      endSlot: 4,
      span: 2,
      badge: '6-8节大课 · 12:55 ~ 15:40',
      isLabOrLongSession: false
    }
  }

  const parseMinutes = (tStr: string): number | null => {
    const m = tStr.match(/(\d{1,2}):(\d{2})/)
    if (!m) return null
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
  }

  const sMin = parseMinutes(startTime)
  if (sMin === null) return { startSlot: 1, endSlot: 1, span: 1, isLabOrLongSession: false }

  const eMin = endTime ? parseMinutes(endTime) : null

  const minToSlot = (m: number): number => {
    if (m < 9 * 60 + 50) return 1 // 08:00 - 09:40
    if (m < 11 * 60 + 50) return 2 // 10:00 - 11:40
    if (m < 13 * 60 + 15) return 3 // 12:00 - 13:40 (中午时段)
    if (m < 15 * 60 + 50) return 4 // 14:00 - 15:40 (下午第 7-8 节，含徐汇/医学院 13:30)
    if (m < 17 * 60 + 50) return 5 // 16:00 - 17:40
    return 6 // 18:00 - 21:30
  }

  const startSlot = minToSlot(sMin)
  let endSlot = startSlot

  if (eMin !== null && eMin > sMin) {
    // 减去 5 分钟容差，避免刚好下课时刻越界到下一槽位
    endSlot = minToSlot(eMin - 5)
    if (endSlot < startSlot) endSlot = startSlot
  }

  const span = Math.max(1, endSlot - startSlot + 1)
  const durationMins = eMin !== null ? eMin - sMin : 0
  const isLab = durationMins >= 180

  let badge: string | undefined
  if (span > 1) {
    badge = `${span}时段连堂 · ${formatEventTime(startTime)} ~ ${endTime ? formatEventTime(endTime) : ''}`
  }

  return {
    startSlot,
    endSlot,
    span,
    badge,
    isLabOrLongSession: isLab
  }
}

/** 从时间字符串 HH:mm 匹配标准时段编号 1..6 */
export function getSlotIdFromTime(timeStr: string): number {
  return getSlotRangeFromTime(timeStr).startSlot
}

/** 将同一天内的事件按时段重叠区间进行分组聚类，避免 CSS Grid 重叠遮挡 */
export function clusterDayEvents(events: PlacedEvent[]): DayEventCluster[] {
  if (events.length === 0) return []
  const sorted = [...events].sort((a, b) => {
    if (a.startSlot !== b.startSlot) return a.startSlot - b.startSlot
    if (a.type === 'exam' && b.type !== 'exam') return -1
    if (b.type === 'exam' && a.type !== 'exam') return 1
    return b.span - a.span
  })
  const clusters: DayEventCluster[] = []
  let currentCluster: PlacedEvent[] = [sorted[0]]
  let clusterStart = sorted[0].startSlot
  let clusterEnd = sorted[0].endSlot

  for (let i = 1; i < sorted.length; i++) {
    const ev = sorted[i]
    if (ev.startSlot <= clusterEnd) {
      currentCluster.push(ev)
      clusterEnd = Math.max(clusterEnd, ev.endSlot)
    } else {
      clusters.push({
        startSlot: clusterStart,
        endSlot: clusterEnd,
        span: Math.max(1, clusterEnd - clusterStart + 1),
        events: currentCluster
      })
      currentCluster = [ev]
      clusterStart = ev.startSlot
      clusterEnd = ev.endSlot
    }
  }
  clusters.push({
    startSlot: clusterStart,
    endSlot: clusterEnd,
    span: Math.max(1, clusterEnd - clusterStart + 1),
    events: currentCluster
  })
  return clusters
}

/** 判定给定教学周是否落在周次描述字符串中（如 "1-16周", "1-15周(单)", "2-16周(双)", "第12周"） */
export function isWeekInZcd(weekNum: number, zcd: string): boolean {
  if (!zcd) return true
  const parts = zcd.split(',')
  for (const rawPart of parts) {
    const part = rawPart.trim()
    if (!part) continue

    if (part.includes('(单)')) {
      const m = part.match(/(\d+)-(\d+)/)
      if (m) {
        const start = parseInt(m[1], 10)
        const end = parseInt(m[2], 10)
        if (weekNum >= start && weekNum <= end && weekNum % 2 === 1) return true
      }
      continue
    }

    if (part.includes('(双)')) {
      const m = part.match(/(\d+)-(\d+)/)
      if (m) {
        const start = parseInt(m[1], 10)
        const end = parseInt(m[2], 10)
        if (weekNum >= start && weekNum <= end && weekNum % 2 === 0) return true
      }
      continue
    }

    const rangeMatch = part.match(/(\d+)-(\d+)/)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10)
      const end = parseInt(rangeMatch[2], 10)
      if (weekNum >= start && weekNum <= end) return true
      continue
    }

    const singleMatch = part.match(/(?:第)?(\d+)周?/)
    if (singleMatch) {
      const w = parseInt(singleMatch[1], 10)
      if (weekNum === w) return true
    }
  }
  return false
}

/** 获取作业 4 态个人提交状态信息（标签文字、徽标样式与卡片样式） */
export function getAssignmentStatusInfo(
  status?: 'submitted' | 'unsubmitted' | 'graded' | 'missing',
  score?: number | null
): {
  label: string
  badgeClass: string
  cardBorderClass: string
  cardBgClass: string
  cardTextClass: string
} {
  switch (status) {
    case 'graded':
      return {
        label: `✓ 已评分${score != null ? ` ${score}分` : ''}`,
        badgeClass: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/25',
        cardBorderClass: 'border-blue-500/25 dark:border-blue-500/30',
        cardBgClass: 'bg-blue-500/5 dark:bg-[#142332]',
        cardTextClass: 'text-blue-800 dark:text-blue-300'
      }
    case 'submitted':
      return {
        label: '✓ 已提交',
        badgeClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25',
        cardBorderClass: 'border-emerald-500/25 dark:border-emerald-500/25',
        cardBgClass: 'bg-emerald-500/5 dark:bg-[#1a2920]',
        cardTextClass: 'text-emerald-700 dark:text-emerald-400'
      }
    case 'missing':
      return {
        label: '✕ 已逾期',
        badgeClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/25',
        cardBorderClass: 'border-rose-500/25 dark:border-rose-500/25',
        cardBgClass: 'bg-rose-500/10 dark:bg-[#2b1b1b]',
        cardTextClass: 'text-rose-700 dark:text-rose-400'
      }
    case 'unsubmitted':
    default:
      return {
        label: '⏳ 待提交',
        badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25',
        cardBorderClass: 'border-amber-500/25 dark:border-amber-500/25',
        cardBgClass: 'bg-amber-500/10 dark:bg-[#2b241b]',
        cardTextClass: 'text-amber-700 dark:text-amber-400'
      }
  }
}

/** 辅助从周次文本或英文解析阿拉伯数字周次 (如 "第五周", "Week 5" -> 5) */
export function parseWeekNumber(weekStr: string, weekEn?: string): number | null {
  if (weekEn) {
    const m = weekEn.match(/\d+/)
    if (m) return parseInt(m[0], 10)
  }
  const digitMatch = weekStr.match(/\d+/)
  if (digitMatch) return parseInt(digitMatch[0], 10)

  // 先提取 "第X周" 中的中文字符
  const chMatch = weekStr.match(/第([一二三四五六七八九十]+)周/)
  const token = chMatch ? chMatch[1] : weekStr

  // 按照字符串长度倒序排列，确保 "十六" 优先于 "六" 和 "十" 匹配
  const chMap: Record<string, number> = {
    二十: 20, 十九: 19, 十八: 18, 十七: 17, 十六: 16, 十五: 15, 十四: 14, 十三: 13, 十二: 12, 十一: 11,
    十: 10, 九: 9, 八: 8, 七: 7, 六: 6, 五: 5, 四: 4, 三: 3, 二: 2, 一: 1
  }

  if (token && chMap[token]) {
    return chMap[token]
  }

  for (const [ch, num] of Object.entries(chMap)) {
    if (weekStr.includes(`第${ch}周`) || weekStr.includes(ch)) return num
  }
  return null
}

/** 将周次数组聚合格式化为交大标准周次描述 (如 [1..16] -> "1-16周", [1,3,5..] -> "1-15周(单)") */
export function formatWeeksRange(rawWeeks: number[]): string {
  const weeks = Array.from(new Set(rawWeeks)).sort((a, b) => a - b)
  if (weeks.length === 0) return ''
  if (weeks.length === 1) return `第${weeks[0]}周`

  const min = weeks[0]
  const max = weeks[weeks.length - 1]
  const count = weeks.length

  if (count === max - min + 1) {
    return `${min}-${max}周`
  }

  const isAllOdd = weeks.every(w => w % 2 === 1)
  if (isAllOdd && count === Math.floor((max - min) / 2) + 1) {
    return `${min}-${max}周(单)`
  }

  const isAllEven = weeks.every(w => w % 2 === 0)
  if (isAllEven && count === Math.floor((max - min) / 2) + 1) {
    return `${min}-${max}周(双)`
  }

  const ranges: string[] = []
  let rangeStart = weeks[0]
  let prev = weeks[0]

  for (let i = 1; i < weeks.length; i++) {
    const cur = weeks[i]
    if (cur === prev + 1) {
      prev = cur
    } else {
      ranges.push(rangeStart === prev ? `第${rangeStart}周` : `${rangeStart}-${prev}周`)
      rangeStart = cur
      prev = cur
    }
  }
  ranges.push(rangeStart === prev ? `第${rangeStart}周` : `${rangeStart}-${prev}周`)
  return ranges.join(', ')
}

/** 辅助获取日期字符串 YYYY-MM-DD */
export function getEventDateStr(timeStr: string): string {
  if (!timeStr) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(timeStr)) {
    return timeStr.slice(0, 10)
  }
  try {
    const d = new Date(timeStr)
    if (isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  } catch {
    return ''
  }
}

/** 辅助格式化短日期 M/D */
export function formatShortDate(timeStr: string): string {
  if (!timeStr) return ''
  const m = timeStr.match(/(?:^\d{4}-)?0?(\d{1,2})-0?(\d{1,2})/)
  if (m) return `${m[1]}/${m[2]}`
  try {
    const d = new Date(timeStr)
    if (!isNaN(d.getTime())) return `${d.getMonth() + 1}/${d.getDate()}`
  } catch { /* ignore */ }
  return ''
}

/** 辅助提取标准展示时刻 HH:mm */
export function formatEventTime(timeStr: string): string {
  if (!timeStr) return ''
  const m = timeStr.match(/(\d{1,2}:\d{2})/)
  return m ? m[1] : timeStr
}

/** 获取排课或日程的标准官方作息时间展示文本 */
export function getEventDisplayTime(item: ScheduleEvent): string {
  // 1. 若为思政大课 (6-8 节连堂，12:55 开始)
  if (
    item.startTime.includes('12:55') ||
    item.startTime.includes('6-8') ||
    item.title.includes('思想道德') ||
    item.title.includes('思政')
  ) {
    return '12:55 ~ 15:40 · 第6-8节'
  }

  // 2. 若带有具体时间时刻（如 "2026-10-14 14:00:00" 或 "14:00"）
  if (item.startTime.includes(':')) {
    const s = formatEventTime(item.startTime)
    const e = formatEventTime(item.endTime)
    return e ? `${s} ~ ${e}` : s
  }

  // 3. 若为教务节次（如 "1-2节", "5-10节"）
  const jcClean = item.startTime.replace(/节/g, '').trim()
  if (jcClean.startsWith('5-10')) {
    return `${item.startTime} (12:00 ~ 17:40 · 6节连堂)`
  }
  if (jcClean.startsWith('6-9')) {
    return `${item.startTime} (12:55 ~ 16:45 · 4节连堂)`
  }
  if (jcClean.startsWith('6-8')) {
    return `${item.startTime} (12:55 ~ 15:40 · 3节大课)`
  }
  if (jcClean.startsWith('7-10')) {
    return `${item.startTime} (14:00 ~ 17:40 · 4节连堂)`
  }
  if (jcClean.startsWith('1-2') || jcClean === '1' || jcClean === '2') {
    return `${item.startTime} (08:00 ~ 09:40)`
  }
  if (jcClean.startsWith('3-4') || jcClean === '3' || jcClean === '4') {
    return `${item.startTime} (10:00 ~ 11:40)`
  }
  if (jcClean.startsWith('5-6') || jcClean === '5') {
    return `${item.startTime} (12:00 ~ 13:40)`
  }
  if (jcClean.startsWith('7-8') || jcClean === '7' || jcClean === '8') {
    return `${item.startTime} (14:00 ~ 15:40)`
  }
  if (jcClean.startsWith('9-10') || jcClean === '9' || jcClean === '10') {
    return `${item.startTime} (16:00 ~ 17:40)`
  }
  if (jcClean.startsWith('11-14')) {
    return `${item.startTime} (18:00 ~ 21:30 · 4节连堂)`
  }
  if (jcClean.startsWith('11-13')) {
    return `${item.startTime} (18:00 ~ 20:25 · 3节连堂)`
  }
  if (jcClean.startsWith('11') || jcClean.startsWith('12')) {
    return `${item.startTime} (18:00 ~ 19:40)`
  }

  return item.startTime
}
