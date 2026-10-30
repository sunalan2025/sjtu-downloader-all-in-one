import type { CanvasVideoSession } from './types'

/** An explicit source wins over legacy metadata retained during cross-version merging. */
export function isLegacyCanvasVideo(session: Pick<CanvasVideoSession, 'source' | 'legacyCourseId'>): boolean {
  return session.source === 'legacy' || (!session.source && !!session.legacyCourseId)
}
