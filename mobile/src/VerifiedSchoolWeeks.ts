import type { CalendarEvent } from './native'
import { compareEvents } from './ScheduleUtils'

/** Store only recently verified official classes; never store cookies/tokens.
 * Avoid replacing known school lessons with an empty response when the
 * calendar's separate SSO session expires or its endpoint times out. */
const KEY = 'sjtu-verified-official-weeks-v1'
const MAX_AGE = 14 * 24 * 60 * 60 * 1000
const MAX_WEEKS = 8

export type VerifiedWeek = { savedAt: number; items: CalendarEvent[] }
export type VerifiedWeeks = Map<string, VerifiedWeek>

export function isOfficialClass(event: CalendarEvent): boolean {
  return event.id.startsWith('official:') && (event.type === 'course' || event.type === 'event')
}

export function readVerifiedWeeks(): VerifiedWeeks {
  const result: VerifiedWeeks = new Map()
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, VerifiedWeek>
    for (const [week, record] of Object.entries(raw)) {
      if (!/^20\d\d-\d\d-\d\d$/.test(week) ||
          !record || !Array.isArray(record.items) ||
          !Number.isFinite(record.savedAt) ||
          Date.now() - record.savedAt > MAX_AGE || record.savedAt > Date.now() + 60_000)
        continue
      const safe = record.items.filter(event =>
        typeof event?.id === 'string' && typeof event?.title === 'string' &&
        typeof event?.startTime === 'string' && typeof event?.endTime === 'string' &&
        isOfficialClass(event)).slice(0, 130)
      if (safe.length) result.set(week, { savedAt: record.savedAt, items: safe })
    }
  } catch { /* Storage can be disabled or may contain old format. */ }
  return result
}

export function rememberVerifiedWeek(cache: VerifiedWeeks, week: string, items: CalendarEvent[]): void {
  const official = items.filter(isOfficialClass).slice(0, 130)
  // An unexpectedly empty result might be a temporary API/SSO failure;
  // retain the last verified nonempty week until a deliberate logout.
  if (!official.length) return
  cache.set(week, {items: official, savedAt: Date.now()})
  const selected = [...cache.entries()]
    .filter(([,entry]) => Date.now() - entry.savedAt < MAX_AGE)
    .sort((a,b) => b[1].savedAt - a[1].savedAt)
    .slice(0,MAX_WEEKS)
  cache.clear()
  for (const [key, entry] of selected) cache.set(key, entry)
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(cache))) }
  catch { /* An in-memory backup is still useful this session. */ }
}

export function clearVerifiedWeeks(cache: VerifiedWeeks): void {
  cache.clear()
  try { localStorage.removeItem(KEY) } catch { }
}

export function mergeOfficialWeeks(
  main: CalendarEvent[], saved: CalendarEvent[]
): CalendarEvent[] {
  const result = [...main]
  const seen = new Set(main.map(event => event.id + '|' + event.startTime))
  for (const event of saved) {
    const key = event.id + '|' + event.startTime
    if (!seen.has(key)) {
      seen.add(key)
      result.push(event)
    }
  }
  return result.sort(compareEvents)
}
