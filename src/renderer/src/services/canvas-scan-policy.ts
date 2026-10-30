import { sortAcademicTerms } from '@shared/utils'

export function newestTermCourses<T extends { term?: string }>(courses: T[]): T[] {
  const terms = sortAcademicTerms([...new Set(courses.map(course => course.term || ''))])
  const newest = terms.find(term => /\d{4}/.test(term))
  return newest ? courses.filter(course => course.term === newest) : []
}
