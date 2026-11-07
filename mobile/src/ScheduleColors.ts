import { useSyncExternalStore, type CSSProperties } from 'react'
import palette from '../public/schedule-palette.json'
import type { CalendarEvent } from './native'
import { scheduleKind } from './ScheduleUtils'
const KEY = 'sjtu-course-colors-v1'
let assignments: Record<string, number> = {}
try {
  assignments = JSON.parse(localStorage.getItem(KEY) || '{}')
} catch {
  /* Defaults remain usable. */
}
const listeners = new Set<() => void>()
let revision = 0
export const courseColorKey = (title: string) => title.replace(/\s+/g, '').toLowerCase()
function publish() {
  try {
    localStorage.setItem(KEY, JSON.stringify(assignments))
  } catch {
    /* Current session is still colored. */
  }
  revision++
  listeners.forEach(listener => listener())
}
export function courseAssignments(titles: string[]) {
  let changed = false
  const used = new Set(Object.values(assignments))
  for (const title of [...new Set(titles.map(courseColorKey))].sort()) {
    if (!title || Number.isInteger(assignments[title])) continue
    let slot = 0
    while (used.has(slot)) slot++
    assignments[title] = slot
    used.add(slot)
    changed = true
  }
  if (changed) publish()
  return { ...assignments }
}
export function acceptCourseAssignments(next: Record<string, number>) {
  if (JSON.stringify(assignments) === JSON.stringify(next)) return
  assignments = next
  publish()
}
export function useScheduleColors() {
  useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => revision
  )
}
export function schedulePaint(event: CalendarEvent, dark = document.documentElement.dataset.theme === 'dark') {
  const kind = scheduleKind(event)
  if (kind === 'exam') return { fill: '#ffc1c4', ink: '#67272e', edge: '#c77c84' }
  if (kind === 'homework') return { fill: '#fff5cf', ink: '#55471f', edge: '#b3a067' }
  if (event.type !== 'course') return { fill: '#daebf6', ink: '#263b4b', edge: '#89a9bf' }
  const key = courseColorKey(event.title)
  const slot = assignments[key] ?? 0
  // Normal semesters use the distinct hand-spaced hues. Additional courses
  // retain a unique fill rather than cycling back to the first course color.
  const base = palette[slot % palette.length][dark ? 'dark' : 'light']
  if (slot < palette.length) return base
  const value = Number.parseInt(base.fill.slice(1), 16)
  const fill = '#' + ((value ^ (Math.floor(slot / palette.length) * 0x010101)) & 0xffffff).toString(16).padStart(6, '0')
  return { ...base, fill }
}
export function scheduleStyle(event: CalendarEvent): CSSProperties {
  const paint = schedulePaint(event)
  return { '--schedule-fill': paint.fill, '--schedule-ink': paint.ink, '--schedule-edge': paint.edge } as CSSProperties
}
