import type Electron from 'electron'
import type { ScheduleEvent } from '../../shared/types'
import { safeFetch } from '../canvas/safe-fetch'
import { ensureCanvasLogin } from '../canvas/orchestrator'
import { normalizeCanvasUrl } from '../../shared/utils'

const CANVAS_BASE = 'https://oc.sjtu.edu.cn'

/** 辅助将时间转为本地 YYYY-MM-DD HH:mm 格式 */
function formatToLocalDateTime(timeStr: string): string {
  try {
    const d = new Date(timeStr)
    if (isNaN(d.getTime())) return timeStr
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return timeStr
  }
}

/** 从 Canvas 获取即将到期的待办/作业 DDL（降级保底） */
async function fetchCanvasUpcomingEventsFallback(
  ses: Electron.Session
): Promise<ScheduleEvent[]> {
  try {
    const url = `${CANVAS_BASE}/api/v1/users/self/upcoming_events`
    const resp = await safeFetch(ses, url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Referer: `${CANVAS_BASE}/`
      }
    })

    if (!resp.ok) return []

    const items = (await resp.json()) as Array<{
      id: number | string
      title?: string
      name?: string
      start_at?: string
      end_at?: string
      due_at?: string
      lock_at?: string
      context_name?: string
      html_url?: string
      description?: string
      points_possible?: number | null
      submission?: {
        workflow_state?: string
        score?: number | null
        grade?: string | null
        submitted_at?: string | null
        attempt?: number | null
        late?: boolean
        missing?: boolean
      } | null
      assignment?: {
        id?: number
        title?: string
        name?: string
        due_at?: string | null
        lock_at?: string | null
        end_at?: string | null
        start_at?: string | null
        points_possible?: number | null
        submission?: {
          workflow_state?: string
          score?: number | null
          grade?: string | null
          submitted_at?: string | null
          attempt?: number | null
          late?: boolean
          missing?: boolean
        } | null
      }
    }>

    if (!Array.isArray(items)) return []

    const now = Date.now()
    return items
      .filter(item => item.end_at || item.start_at || item.due_at || item.lock_at || item.assignment?.due_at || item.assignment?.lock_at)
      .map(item => {
        const assignment = item.assignment
        const dueTime = item.due_at || assignment?.due_at || item.end_at || item.start_at || ''
        const lockTime = item.lock_at || assignment?.lock_at || ''
        const rawTime = dueTime || lockTime
        const isLockAtDeadline = !dueTime && Boolean(lockTime)
        const localTime = rawTime ? formatToLocalDateTime(rawTime) : ''
        const normalizedUrl = normalizeCanvasUrl(item.html_url)

        const sub = item.submission || assignment?.submission
        const ws = sub?.workflow_state
        const isSubmitted =
          ws === 'submitted' ||
          ws === 'graded' ||
          ws === 'pending_review' ||
          Boolean(sub?.submitted_at) ||
          (typeof sub?.attempt === 'number' && sub.attempt > 0)

        let subStatus: 'submitted' | 'unsubmitted' | 'graded' | 'missing'
        if (ws === 'graded') {
          subStatus = 'graded'
        } else if (isSubmitted) {
          subStatus = 'submitted'
        } else if (sub?.missing === true) {
          subStatus = 'missing'
        } else if (rawTime && new Date(rawTime).getTime() < now) {
          subStatus = 'missing'
        } else {
          subStatus = 'unsubmitted'
        }

        return {
          id: `canvas-ddl-${item.id}`,
          title: item.title || item.name || assignment?.title || assignment?.name || '未命名作业',
          startTime: localTime,
          endTime: localTime,
          type: 'assignment_ddl' as const,
          courseName: item.context_name,
          description: normalizedUrl ? `作业链接: ${normalizedUrl}` : item.description,
          htmlUrl: normalizedUrl || undefined,
          pointsPossible: item.points_possible ?? assignment?.points_possible,
          score: sub?.score,
          submissionStatus: subStatus,
          isLockAtDeadline
        }
      })
  } catch {
    return []
  }
}

/** 从 Canvas 获取全景作业 DDL 及真实提交状态（方案 3 深度遍历） */
export async function fetchCanvasUpcomingDeadlines(
  ses: Electron.Session
): Promise<ScheduleEvent[]> {
  try {
    // 关键：确保 Canvas OIDC SSO 握手完成并落盘 _normandy_session
    await ensureCanvasLogin().catch(() => false)

    // 1. 获取用户活跃课程列表（并发获取收藏夹课程与活跃课程，去重合并）
    const courseMap = new Map<number, { id: number; name?: string; title?: string }>()

    const addCourses = (rawList: unknown) => {
      if (!Array.isArray(rawList)) return
      for (const item of rawList) {
        if (item && typeof item === 'object' && 'id' in item) {
          const c = item as { id: number; name?: string; course_code?: string; title?: string }
          if (c.id && (c.name || c.course_code)) {
            if (!courseMap.has(c.id)) {
              courseMap.set(c.id, {
                id: c.id,
                name: c.name || c.course_code || c.title || `Course ${c.id}`,
                title: c.name || c.title || c.course_code
              })
            }
          }
        }
      }
    }

    const [favResp, activeResp] = await Promise.all([
      safeFetch(ses, `${CANVAS_BASE}/api/v1/users/self/favorites/courses`, {
        method: 'GET',
        headers: { Accept: 'application/json', Referer: `${CANVAS_BASE}/` }
      }).catch(() => null),
      safeFetch(ses, `${CANVAS_BASE}/api/v1/courses?enrollment_state=active&per_page=100&include[]=term`, {
        method: 'GET',
        headers: { Accept: 'application/json', Referer: `${CANVAS_BASE}/` }
      }).catch(() => null)
    ])

    if (favResp && favResp.ok) {
      const raw = await favResp.json().catch(() => [])
      addCourses(raw)
    }

    if (activeResp && activeResp.ok) {
      const raw = await activeResp.json().catch(() => [])
      addCourses(raw)
    }

    const courses = Array.from(courseMap.values())

    if (courses.length === 0) {
      return await fetchCanvasUpcomingEventsFallback(ses)
    }

    // 2. 并发拉取每门课程的作业列表（包含个人提交详情）
    const now = Date.now()
    const courseAssignmentPromises = courses.map(async course => {
      try {
        const url = `${CANVAS_BASE}/api/v1/courses/${course.id}/assignments?include[]=submission&per_page=100`
        const resp = await safeFetch(ses, url, {
          method: 'GET',
          headers: { Accept: 'application/json', Referer: `${CANVAS_BASE}/` }
        })
        if (!resp.ok) return []

        const assignments = (await resp.json()) as Array<{
          id: number
          title?: string
          name?: string
          description?: string
          due_at?: string | null
          lock_at?: string | null
          end_at?: string | null
          start_at?: string | null
          html_url?: string
          points_possible?: number | null
          submission?: {
            workflow_state?: string
            score?: number | null
            grade?: string | null
            submitted_at?: string | null
            attempt?: number | null
            late?: boolean
            missing?: boolean
          } | null
        }>

        if (!Array.isArray(assignments)) return []

        return assignments.map(a => {
          const dueTime = a.due_at || a.end_at || a.start_at || ''
          const lockTime = a.lock_at || ''
          const rawTime = dueTime || lockTime
          const isLockAtDeadline = !dueTime && Boolean(lockTime)
          const localTime = rawTime ? formatToLocalDateTime(rawTime) : ''

          const sub = a.submission
          const ws = sub?.workflow_state
          const isSubmitted =
            ws === 'submitted' ||
            ws === 'graded' ||
            ws === 'pending_review' ||
            Boolean(sub?.submitted_at) ||
            (typeof sub?.attempt === 'number' && sub.attempt > 0)

          let subStatus: 'submitted' | 'unsubmitted' | 'graded' | 'missing'
          if (ws === 'graded') {
            subStatus = 'graded'
          } else if (isSubmitted) {
            subStatus = 'submitted'
          } else if (sub?.missing === true) {
            subStatus = 'missing'
          } else if (rawTime && new Date(rawTime).getTime() < now) {
            subStatus = 'missing'
          } else {
            subStatus = 'unsubmitted'
          }

          const rawUrl = a.html_url || (course.id && a.id ? `${CANVAS_BASE}/courses/${course.id}/assignments/${a.id}` : undefined)
          const normalizedUrl = normalizeCanvasUrl(rawUrl)

          return {
            id: `canvas-ddl-${a.id}`,
            title: a.name || a.title || '未命名作业',
            startTime: localTime,
            endTime: localTime,
            type: 'assignment_ddl' as const,
            courseName: course.name || course.title,
            description: a.description,
            htmlUrl: normalizedUrl || undefined,
            pointsPossible: a.points_possible,
            score: a.submission?.score,
            submissionStatus: subStatus,
            isLockAtDeadline
          }
        })
      } catch (err) {
        console.warn(`[schedule] 获取课程 ${course.name || course.id} 作业失败:`, err)
        return []
      }
    })

    const allNested = await Promise.all(courseAssignmentPromises)
    const flatAssignments = allNested.flat()
    if (flatAssignments.length > 0) {
      return flatAssignments
    }

    return await fetchCanvasUpcomingEventsFallback(ses)
  } catch (err) {
    console.warn('[schedule] 获取 Canvas 全景作业异常，降级回退:', err)
    return await fetchCanvasUpcomingEventsFallback(ses)
  }
}
