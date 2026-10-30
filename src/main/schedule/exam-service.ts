import type Electron from 'electron'
import type { ScheduleEvent } from '../../shared/types'
import { safeFetch } from '../canvas/safe-fetch'
import {
  ensureJiaowuLoggedIn,
  parseJiaowuExams,
  JIAOWU_BASE,
  JIAOWU_EXAM_URL
} from './jiaowu-adapter'
import {
  ensureStudyAtSjtuLoggedIn,
  parseStudyAtSjtuExams,
  STUDY_BASE,
  STUDY_EXAM_URL,
  STUDY_REFERER,
  STUDY_CALENDAR_INFO_URL
} from './study-adapter'

let _cachedExamEvents: ScheduleEvent[] | null = null
let _cachedExamEventsTime = 0
let _fetchExamEventsPromise: Promise<ScheduleEvent[]> | null = null

/** 清除考试日程内存缓存 */
export function invalidateExamEventsCache(): void {
  _cachedExamEvents = null
  _cachedExamEventsTime = 0
  _fetchExamEventsPromise = null
}

/** 为考试事件标注与其时段重叠的日常排课，保证学生在排考期间知晓停上/冲突课程 */
export function tagExamCourseConflicts(examEvents: ScheduleEvent[], courseEvents: ScheduleEvent[]): void {
  for (const exam of examEvents) {
    if (!exam.startTime || !exam.endTime) continue
    const examStart = new Date(exam.startTime.replace(/-/g, '/')).getTime()
    const examEnd = new Date(exam.endTime.replace(/-/g, '/')).getTime()
    if (isNaN(examStart) || isNaN(examEnd)) continue

    const conflicting = courseEvents.find(c => {
      if (c.type !== 'course' || !c.startTime || !c.endTime) return false
      const cStart = new Date(c.startTime.replace(/-/g, '/')).getTime()
      const cEnd = new Date(c.endTime.replace(/-/g, '/')).getTime()
      if (isNaN(cStart) || isNaN(cEnd)) return false
      // 时段重叠判定：examStart < cEnd && examEnd > cStart
      return examStart < cEnd && examEnd > cStart
    })

    if (conflicting) {
      exam.conflictCourseTitle = conflicting.courseName || conflicting.title
    }
  }
}


export async function fetchExamEvents(
  ses: Electron.Session,
  year?: string,
  semester?: string,
  force = false
): Promise<ScheduleEvent[]> {
  const now = Date.now()
  if (!force && _cachedExamEvents && now - _cachedExamEventsTime < 5 * 60 * 1000) {
    return _cachedExamEvents
  }
  if (_fetchExamEventsPromise) return _fetchExamEventsPromise

  _fetchExamEventsPromise = (async () => {
    try {
      const res = await doFetchExamEvents(ses, year, semester)
      _cachedExamEvents = res
      _cachedExamEventsTime = Date.now()
      return res
    } finally {
      _fetchExamEventsPromise = null
    }
  })()

  return _fetchExamEventsPromise
}

async function doFetchExamEvents(
  ses: Electron.Session,
  year?: string,
  semester?: string
): Promise<ScheduleEvent[]> {
  // 1. 尝试主源：学在交大 RESTful JSON 接口
  try {
    const studyOk = await ensureStudyAtSjtuLoggedIn(ses)
    if (studyOk) {
      let targetYear = year
      let targetSem = semester

      if (!targetYear || !targetSem) {
        try {
          const calInfoResp = await safeFetch(ses, STUDY_CALENDAR_INFO_URL, {
            method: 'GET',
            headers: { Accept: 'application/json', Referer: STUDY_REFERER }
          })
          if (calInfoResp.ok) {
            const calJson = (await calInfoResp.json()) as { data?: { year?: string; semester?: string } }
            if (calJson?.data?.year) targetYear = calJson.data.year
            if (calJson?.data?.semester) targetSem = calJson.data.semester
          }
        } catch { /* ignore */ }
      }

      // 若未探明学期，根据当前自然月份推算春/秋/夏学期
      if (!targetYear || !targetSem) {
        const now = new Date()
        const y = now.getFullYear()
        const m = now.getMonth() + 1
        if (m >= 2 && m <= 7) {
          targetYear = `${y - 1}-${y}`
          targetSem = '2'
        } else if (m >= 7 && m <= 8) {
          targetYear = `${y - 1}-${y}`
          targetSem = '3'
        } else if (m === 1) {
          targetYear = `${y - 1}-${y}`
          targetSem = '1'
        } else {
          targetYear = `${y}-${y + 1}`
          targetSem = '1'
        }
      }

      const examListUrl = `${STUDY_EXAM_URL}?locale=zh&year=${encodeURIComponent(targetYear)}&semester=${encodeURIComponent(targetSem)}`
      const resp = await safeFetch(ses, examListUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Referer: `${STUDY_BASE}/app/ui/exam`
        }
      })

      if (resp.ok) {
        const json = await resp.json()
        const parsed = parseStudyAtSjtuExams(json)
        if (parsed.length > 0) {
          console.log(`[schedule] 从学在交大成功获取 ${parsed.length} 门考试安排`)
          return parsed
        }
      }
    }
  } catch (err) {
    console.warn('[schedule] 从学在交大拉取考试信息异常，尝试正方教务系统备用源:', err)
  }

  // 2. 备源：教务信息服务网 (i.sjtu.edu.cn) 兜底
  try {
    const jwOk = await ensureJiaowuLoggedIn(ses)
    if (jwOk) {
      const now = new Date()
      const y = now.getFullYear()
      const m = now.getMonth() + 1
      let xnm = String(y)
      let xqm = '3'
      if (m >= 2 && m <= 7) {
        xnm = String(y - 1)
        xqm = '12'
      } else if (m >= 7 && m <= 8) {
        xnm = String(y - 1)
        xqm = '16'
      } else if (m === 1) {
        xnm = String(y - 1)
        xqm = '3'
      }

      const postBody = new URLSearchParams()
      postBody.append('xnm', xnm)
      postBody.append('xqm', xqm)
      postBody.append('queryModel.showCount', '50')
      postBody.append('queryModel.currentPage', '1')

      const jwResp = await safeFetch(ses, JIAOWU_EXAM_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': `${JIAOWU_BASE}/kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105&layout=default`
        },
        body: postBody.toString()
      })

      if (jwResp.ok) {
        const jwJson = await jwResp.json()
        const parsed = parseJiaowuExams(jwJson)
        console.log(`[schedule] 从正方教务系统获取 ${parsed.length} 门考试安排`)
        return parsed
      }
    }
  } catch (err) {
    console.warn('[schedule] 从教务信息服务网拉取考试信息失败:', err)
  }

  return []
}
