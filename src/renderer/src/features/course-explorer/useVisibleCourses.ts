import { useEffect, useRef } from 'react'
import type { NetdiskCourseItem } from './model'

/** Observe the actual viewport and its scroll clips, never the whole filtered term. */
export function useVisibleCourses(courses: NetdiskCourseItem[], viewKey: string) {
  const root = useRef<HTMLDivElement>(null)
  const latest = useRef(courses)
  latest.current = courses
  const idsKey = JSON.stringify(courses.map(course => course.id))
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio <= 0) continue
          const id = (entry.target as HTMLElement).dataset.courseId
          latest.current.find(course => String(course.id) === id)?.onVisible?.()
          observer.unobserve(entry.target)
        }
      },
      { threshold: 0.01 }
    )
    root.current.querySelectorAll('[data-course-id]').forEach(node => observer.observe(node))
    return () => observer.disconnect()
  }, [idsKey, viewKey])
  return root
}
