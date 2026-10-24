/**
 * 交大官方课表 (calendar.sjtu.edu.cn) 与 Canvas DDL 数据抓取器
 */
import { BrowserWindow } from 'electron'
import type Electron from 'electron'
import type { ScheduleEvent, ScheduleWeek, ScheduleFetchResult, JiaowuCourseItem, JiaowuScheduleResult } from '../../shared/types'
import { safeFetch } from '../canvas/safe-fetch'
import { ensureCanvasLogin } from '../canvas/orchestrator'
import { normalizeCanvasUrl } from '../../shared/utils'

const CALENDAR_BASE = 'https://calendar.sjtu.edu.cn'
const CALENDAR_REFERER = 'https://calendar.sjtu.edu.cn/ui/calendar'
const CANVAS_BASE = 'https://oc.sjtu.edu.cn'

const JIAOWU_BASE = 'https://i.sjtu.edu.cn'
const JIAOWU_LOGIN_URL = 'https://i.sjtu.edu.cn/jaccountlogin'
const JIAOWU_KB_URL = 'https://i.sjtu.edu.cn/kbcx/xskbcx_cxXsKb.html?gnmkdm=N253508'
const JIAOWU_REFERER = 'https://i.sjtu.edu.cn/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N253508&layout=default'

let _calendarLoginPromise: Promise<boolean> | null = null
let _calendarSsoDone = false

let _jiaowuLoginPromise: Promise<boolean> | null = null
let _jiaowuSsoDone = false

/** 注销或重置会话时清除 SSO 状态缓存 */
export function invalidateCalendarLogin(): void {
  _calendarSsoDone = false
  _calendarLoginPromise = null
  invalidateJiaowuLogin()
}

/** 清除教务系统 SSO 状态缓存 */
export function invalidateJiaowuLogin(): void {
  _jiaowuSsoDone = false
  _jiaowuLoginPromise = null
}

/** 探测交我办课表会话是否有效 */
export async function isCalendarSessionValid(ses: Electron.Session): Promise<boolean> {
  try {
    if (!ses?.cookies?.get) return true
    const cookies = await ses.cookies.get({ url: CALENDAR_BASE })
    const hasSession = cookies.some(c => c.name.toUpperCase() === 'JSESSIONID')
    if (!hasSession) {
      return false
    }

    // 轻量请求 /ui/calendar 校验会话（未登录时服务端会重定向至 OAuth2 授权）
    const resp = await safeFetch(ses, `${CALENDAR_BASE}/ui/calendar`, {
      method: 'GET',
      headers: {
        Referer: CALENDAR_REFERER
      }
    })

    if (resp.url && (resp.url.includes('jaccount') || resp.url.includes('oauth2') || resp.url.includes('login'))) {
      return false
    }
    return resp.ok || resp.status === 200
  } catch {
    return false
  }
}

/** 通过隐藏 BrowserWindow 执行静默 OAuth2 SSO 握手（严禁弹出任何可见窗口） */
async function completeCalendarSso(ses: Electron.Session): Promise<boolean> {
  if (typeof BrowserWindow !== 'function') {
    return true
  }

  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })

  if (typeof win.webContents?.setAudioMuted === 'function') {
    win.webContents.setAudioMuted(true)
  }

  try {
    const loginUrl = `${CALENDAR_BASE}/login`
    console.log('[schedule] 加载课表 SSO 登录入口（静默握手）:', loginUrl)

    await win.loadURL(loginUrl).catch(err => {
      console.warn('[schedule] SSO loadURL 抛出异常（重定向跳转通常会抛错，可忽略）:', err)
    })

    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (win.isDestroyed()) return false
      const currentUrl = win.webContents.getURL() || ''

      // 1. 成功判定：若已回到 calendar 域且已具备 JSESSIONID Cookie
      if (currentUrl.includes('calendar.sjtu.edu.cn')) {
        const cookies = await ses.cookies.get({ url: CALENDAR_BASE }).catch(() => [])
        const hasSession = cookies.some(c => c.name.toUpperCase() === 'JSESSIONID')
        if (hasSession) {
          await new Promise(r => setTimeout(r, 300))
          console.log('[schedule] SSO 握手成功，已获取 calendar.sjtu.edu.cn JSESSIONID')
          return true
        }
      }

      // 2. OAuth2 同意授权页面（如果有确认按钮则自动点击）
      if (currentUrl.includes('oauth2/authorize') || currentUrl.includes('oauth2/approval')) {
        try {
          await win.webContents.executeJavaScript(`
            (() => {
              const confirmBtn = document.querySelector('#btn_confirm, button[name="authorized"], input[type="submit"][name="authorized"], .btn-primary');
              if (confirmBtn) {
                confirmBtn.click();
                return true;
              }
              return false;
            })()
          `).catch(() => {})
        } catch { /* ignore */ }
      }

      // 3. 真实未登录判定：页面停止加载，且页面停留在 jAccount 登录表单
      if (!win.webContents.isLoading() && currentUrl.includes('jaccount.sjtu.edu.cn')) {
        try {
          const hasLoginForm = await win.webContents.executeJavaScript(`
            Boolean(document.querySelector('input[name="user"], input[id="user"], #passwordForm, .login-box'))
          `).catch(() => false)
          if (hasLoginForm) {
            console.log('[schedule] 检测到 jAccount 登录表单，当前会话未登录或已失效')
            return false
          }
        } catch { /* ignore */ }
      }

      await new Promise(r => setTimeout(r, 300))
    }

    console.warn('[schedule] SSO 握手超时，当前 URL:', win.isDestroyed() ? '' : win.webContents.getURL())
    return false
  } catch (err) {
    console.warn('[schedule] SSO 流程异常:', err)
    return false
  } finally {
    if (!win.isDestroyed()) {
      try {
        win.webContents?.stop()
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          if (!win.isDestroyed()) win.destroy()
        } catch { /* ignore */ }
      }, 500)
    }
  }
}

/** 确保课表 SSO 登录完成 */
export async function ensureCalendarLoggedIn(ses: Electron.Session): Promise<boolean> {
  if (_calendarSsoDone) {
    if (await isCalendarSessionValid(ses)) return true
    _calendarSsoDone = false
  }
  if (_calendarLoginPromise) return _calendarLoginPromise

  _calendarLoginPromise = (async () => {
    try {
      if (await isCalendarSessionValid(ses)) {
        _calendarSsoDone = true
        return true
      }

      // 预检：检查是否具备有效 jAccount 会话 Cookie
      if (ses?.cookies?.get) {
        const jaCookies = await ses.cookies.get({ domain: 'jaccount.sjtu.edu.cn' }).catch(() => [])
        const hasJaSession = jaCookies.some(c => c.name !== 'JATrustCookie' && c.name.length > 0)
        if (!hasJaSession) {
          console.log('[schedule] 无有效 jAccount 会话，跳过静默 SSO')
          return false
        }
      }

      console.log('[schedule] 触发 calendar.sjtu.edu.cn SSO（隐藏窗口）…')
      const ok = await completeCalendarSso(ses)
      if (ok) {
        _calendarSsoDone = true
        return true
      }
      return false
    } finally {
      _calendarLoginPromise = null
    }
  })()

  return _calendarLoginPromise
}

/** 根据当前时间从周次列表中匹配当前教学周 */
export function findCurrentWeek(weeks: ScheduleWeek[]): ScheduleWeek | undefined {
  if (!weeks || weeks.length === 0) return undefined
  const now = Date.now()
  return weeks.find(w => {
    try {
      const s = new Date(w.startTime.replace(/-/g, '/')).getTime()
      const e = new Date(w.endTime.replace(/-/g, '/')).getTime()
      return now >= s && now <= e
    } catch {
      return false
    }
  })
}

/** 计算默认学期查询时间窗口（若未指定，默认覆盖本学期前后约 5 个月） */
export function getDefaultSemesterDateRange(): { startDate: string; endDate: string } {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1 // 1-12

  // 粗略判断春/秋季学期
  // 秋季学期：9 月 ~ 次年 2 月
  // 春季学期：2 月 ~ 7 月
  // 夏季学期：7 月 ~ 8 月
  let startYear = year
  let startMonth = 9
  let endYear = year + 1
  let endMonth = 2

  if (month >= 2 && month <= 7) {
    startMonth = 2
    endYear = year
    endMonth = 7
  } else if (month >= 7 && month <= 8) {
    startMonth = 7
    endYear = year
    endMonth = 8
  } else if (month === 1) {
    startYear = year - 1
    startMonth = 9
    endYear = year
    endMonth = 2
  }

  const startMonthStr = String(startMonth).padStart(2, '0')
  const endMonthStr = String(endMonth).padStart(2, '0')

  return {
    startDate: `${startYear}-${startMonthStr}-01 00:00`,
    endDate: `${endYear}-${endMonthStr}-28 23:59`
  }
}

/** 从 calendar.sjtu.edu.cn 抓取学期排课与校历周次信息 */
export async function fetchCalendarEvents(
  ses: Electron.Session,
  startDate?: string,
  endDate?: string
): Promise<{ events: ScheduleEvent[]; weeks: ScheduleWeek[]; currentWeek?: string; semesterTitle?: string }> {
  const loggedIn = await ensureCalendarLoggedIn(ses)
  if (!loggedIn) {
    throw new Error('NEED_LOGIN')
  }

  // 1. 尝试探测用户的日历列表以区分“课程”与“会议/讲座”
  let courseCalendarId: string | null = null
  let meetingCalendarId: string | null = null
  try {
    const calListResp = await safeFetch(ses, `${CALENDAR_BASE}/api/calendar/list`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Referer: CALENDAR_REFERER
      }
    })
    if (calListResp.ok) {
      const listData = (await calListResp.json()) as {
        data?: {
          my?: Array<{ id: string; name: string }>
        }
      }
      const myCals = listData.data?.my || []
      for (const c of myCals) {
        if (c.name === '课程') courseCalendarId = c.id
        else if (c.name === '会议') meetingCalendarId = c.id
      }
    }
  } catch {
    // 忽略日历列表获取失败，继续走通用规则探测
  }

  const range = (startDate && endDate) ? { startDate, endDate } : getDefaultSemesterDateRange()
  const url = `https://calendar.sjtu.edu.cn/api/event/list?startDate=${encodeURIComponent(range.startDate)}&endDate=${encodeURIComponent(range.endDate)}&weekly=true&ids=`

  const resp = await safeFetch(ses, url, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*',
      Referer: CALENDAR_REFERER,
      'X-Requested-With': 'XMLHttpRequest'
    }
  })

  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403 || resp.status === 302) {
      throw new Error('NEED_LOGIN')
    }
    throw new Error(`calendar.sjtu.edu.cn 返回 HTTP ${resp.status}`)
  }

  const json = (await resp.json()) as {
    data?: {
      schoolCalendar?: {
        title?: string
        weeks?: Array<{
          week: string
          weekEn?: string
          title?: string
          titleEn?: string
          startTime: string
          endTime: string
        }>
      }
      events?: Array<{
        eventId: string
        calendarId?: string
        claimIcon?: boolean
        title: string
        titleEn?: string
        location?: string
        startTime: string
        endTime: string
        recurrence?: number
        allDay?: boolean
        description?: string
      }>
    }
  }

  const rawEvents = json.data?.events || []
  const rawWeeks = json.data?.schoolCalendar?.weeks || []

  // 2. 映射事件并严格区分「教务排课」与「学术讲座/校园活动」
  const events: ScheduleEvent[] = rawEvents.map(e => {
    let eventType: 'course' | 'activity' = 'course'
    let calendarName = '课程'

    if (courseCalendarId && e.calendarId === courseCalendarId) {
      eventType = 'course'
      calendarName = '教务排课'
    } else if (
      (meetingCalendarId && e.calendarId === meetingCalendarId) ||
      e.eventId.startsWith('ACTIVITY') ||
      e.claimIcon === true ||
      e.recurrence === 0
    ) {
      eventType = 'activity'
      calendarName = (meetingCalendarId && e.calendarId === meetingCalendarId) ? '学术讲座/会议' : '第二课堂/活动'
    }

    let teacher: string | undefined
    if (e.description) {
      const m = e.description.match(/(?:教师|任课教师|任课老师|Teacher)\s*[:：]\s*([^\s;,\n]+)/i)
      if (m) teacher = m[1]
    }
    return {
      id: e.eventId,
      title: e.title,
      titleEn: e.titleEn,
      location: e.location || '',
      startTime: e.startTime,
      endTime: e.endTime,
      type: eventType,
      allDay: !!e.allDay,
      teacher,
      description: e.description,
      calendarName
    }
  })

  // 3. 周次严格按时间升序排序并去重
  const sortedRawWeeks = [...rawWeeks].sort((a, b) => a.startTime.localeCompare(b.startTime))
  const seenWeeks = new Set<string>()
  const weeks: ScheduleWeek[] = []

  for (const w of sortedRawWeeks) {
    const key = `${w.startTime}_${w.endTime}_${w.week}`
    if (!seenWeeks.has(key)) {
      seenWeeks.add(key)
      weeks.push({
        week: w.week,
        weekEn: w.weekEn,
        title: w.title || '',
        titleEn: w.titleEn,
        startTime: w.startTime,
        endTime: w.endTime
      })
    }
  }

  // 4. 计算当前真实周次与学期名称（杜绝因 weeks[0] 散列首项为寒假而误报“寒假”）
  const now = Date.now()
  const currentWeekObj = weeks.find(w => {
    try {
      const s = new Date(w.startTime.replace(/-/g, '/')).getTime()
      const e = new Date(w.endTime.replace(/-/g, '/')).getTime()
      return now >= s && now <= e
    } catch {
      return false
    }
  })

  const currentWeek = currentWeekObj?.week || weeks[0]?.week

  // 判定当前学期标题：优先以 json.data?.schoolCalendar?.title 为准（若非“寒假”），其次当前周
  let semesterTitle = json.data?.schoolCalendar?.title
  if (!semesterTitle || semesterTitle.includes('寒假') || semesterTitle.includes('暑假')) {
    semesterTitle = currentWeekObj?.title
  }
  if (!semesterTitle) {
    // 其次优先寻找包含“学期”且不含“假”的活跃学期
    const activeTermWeek = weeks.find(w => w.title && !w.title.includes('假'))
    semesterTitle = activeTermWeek?.title || weeks[0]?.title || '秋季学期'
  }

  return { events, weeks, currentWeek, semesterTitle }
}

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

/** 统一获取所有课表与日程事件 */
export async function fetchAllScheduleEvents(
  ses: Electron.Session,
  options?: { startDate?: string; endDate?: string }
): Promise<ScheduleFetchResult> {
  try {
    let calError: string | null = null
    const [calRes, ddlEvents] = await Promise.all([
      fetchCalendarEvents(ses, options?.startDate, options?.endDate).catch(err => {
        const msg = err instanceof Error ? err.message : String(err)
        calError = msg
        console.warn('[schedule] 拉取交我办课表失败:', msg)
        return { events: [], weeks: [], currentWeek: undefined, semesterTitle: undefined }
      }),
      fetchCanvasUpcomingDeadlines(ses).catch(() => [])
    ])

    if (calError === 'NEED_LOGIN') {
      return {
        ok: false,
        events: [],
        error: 'NEED_LOGIN'
      }
    }

    const allEvents = [...calRes.events, ...ddlEvents]

    return {
      ok: true,
      events: allEvents,
      weeks: calRes.weeks,
      currentWeek: calRes.currentWeek,
      semesterTitle: calRes.semesterTitle
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      events: [],
      error: msg
    }
  }
}

/** 探测教务系统 (i.sjtu.edu.cn) 会话是否有效 */
export async function isJiaowuSessionValid(ses: Electron.Session): Promise<boolean> {
  try {
    if (!ses?.cookies?.get) return true
    const cookies = await ses.cookies.get({ url: JIAOWU_BASE })
    const hasSession = cookies.some(c => c.name.toUpperCase() === 'JSESSIONID')
    if (!hasSession) return false

    const resp = await safeFetch(ses, JIAOWU_REFERER, {
      method: 'GET',
      headers: { Referer: JIAOWU_BASE }
    })
    if (resp.url && (resp.url.includes('login_slogin') || resp.url.includes('jaccount'))) {
      return false
    }
    return resp.ok || resp.status === 200
  } catch {
    return false
  }
}

/** 静默后台 BrowserWindow 执行教务系统 OAuth2 SSO 握手 */
async function completeJiaowuSso(ses: Electron.Session): Promise<boolean> {
  if (typeof BrowserWindow !== 'function') return true

  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })

  if (typeof win.webContents?.setAudioMuted === 'function') {
    win.webContents.setAudioMuted(true)
  }

  try {
    console.log('[schedule] 加载教务系统入口（静默握手）:', JIAOWU_LOGIN_URL)
    await win.loadURL(JIAOWU_LOGIN_URL).catch(err => {
      console.warn('[schedule] Jiaowu SSO loadURL 异常:', err)
    })

    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (win.isDestroyed()) return false
      const currentUrl = win.webContents.getURL() || ''

      if (
        currentUrl.includes('i.sjtu.edu.cn') &&
        !currentUrl.includes('login_slogin') &&
        !currentUrl.includes('jaccountlogin')
      ) {
        const cookies = await ses.cookies.get({ url: JIAOWU_BASE }).catch(() => [])
        const hasSession = cookies.some(c => c.name.toUpperCase() === 'JSESSIONID')
        if (hasSession && !win.webContents.isLoading()) {
          console.log('[schedule] 教务系统 SSO 握手成功，已获取 i.sjtu.edu.cn JSESSIONID')
          return true
        }
      }

      // OAuth2 授权确认页面自动提交
      if (currentUrl.includes('oauth2/authorize') || currentUrl.includes('oauth2/approval')) {
        try {
          await win.webContents.executeJavaScript(`
            (() => {
              const confirmBtn = document.querySelector('#btn_confirm, button[name="authorized"], input[type="submit"][name="authorized"], .btn-primary');
              if (confirmBtn) {
                confirmBtn.click();
                return true;
              }
              return false;
            })()
          `).catch(() => {})
        } catch { /* ignore */ }
      }

      // 未登录检测
      if (!win.webContents.isLoading() && currentUrl.includes('jaccount.sjtu.edu.cn')) {
        try {
          const hasLoginForm = await win.webContents.executeJavaScript(`
            Boolean(document.querySelector('input[name="user"], input[id="user"], #passwordForm, .login-box'))
          `).catch(() => false)
          if (hasLoginForm) {
            console.log('[schedule] 教务系统检测到未登录 jAccount 会话')
            return false
          }
        } catch { /* ignore */ }
      }

      await new Promise(r => setTimeout(r, 300))
    }
    return false
  } catch (err) {
    console.warn('[schedule] Jiaowu SSO 流程异常:', err)
    return false
  } finally {
    if (!win.isDestroyed()) {
      try {
        win.webContents?.stop()
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          if (!win.isDestroyed()) win.destroy()
        } catch { /* ignore */ }
      }, 500)
    }
  }
}

/** 确保教务系统 SSO 登录完成 */
export async function ensureJiaowuLoggedIn(ses: Electron.Session): Promise<boolean> {
  if (_jiaowuSsoDone) {
    if (await isJiaowuSessionValid(ses)) return true
    _jiaowuSsoDone = false
  }
  if (_jiaowuLoginPromise) return _jiaowuLoginPromise

  _jiaowuLoginPromise = (async () => {
    try {
      if (await isJiaowuSessionValid(ses)) {
        _jiaowuSsoDone = true
        return true
      }
      if (ses?.cookies?.get) {
        const jaCookies = await ses.cookies.get({ domain: 'jaccount.sjtu.edu.cn' }).catch(() => [])
        const hasJaSession = jaCookies.some(c => c.name !== 'JATrustCookie' && c.name.length > 0)
        if (!hasJaSession) {
          console.log('[schedule] 无有效 jAccount 会话，跳过教务系统静默 SSO')
          return false
        }
      }
      console.log('[schedule] 触发 i.sjtu.edu.cn SSO（隐藏窗口）…')
      const ok = await completeJiaowuSso(ses)
      if (ok) {
        _jiaowuSsoDone = true
        return true
      }
      return false
    } finally {
      _jiaowuLoginPromise = null
    }
  })()

  return _jiaowuLoginPromise
}

/** 从交大教学信息服务网 (i.sjtu.edu.cn) 抓取学期排课 */
export async function fetchJiaowuSchedule(
  ses: Electron.Session,
  xnm = '2026',
  xqm = '3'
): Promise<JiaowuScheduleResult> {
  const termName = xqm === '3' ? '秋季学期' : xqm === '12' ? '春季学期' : '夏季小学期'
  const termTitle = `${xnm}-${Number(xnm) + 1} ${termName}`

  try {
    const loggedIn = await ensureJiaowuLoggedIn(ses)
    if (!loggedIn) {
      return {
        ok: false,
        xnm,
        xqm,
        termTitle,
        courses: [],
        error: 'NEED_LOGIN'
      }
    }

    const postBody = new URLSearchParams()
    postBody.append('xnm', xnm)
    postBody.append('xqm', xqm)
    postBody.append('kzlx', 'ck')

    const resp = await safeFetch(ses, JIAOWU_KB_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': JIAOWU_REFERER
      },
      body: postBody.toString()
    })

    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403 || resp.status === 302 || resp.status === 901) {
        return { ok: false, xnm, xqm, termTitle, courses: [], error: 'NEED_LOGIN' }
      }
      throw new Error(`教务系统返回 HTTP ${resp.status}`)
    }

    const text = await resp.text()
    let json: {
      kbList?: Array<{
        kcmc?: string
        jc?: string
        xqj?: string | number
        xqjmc?: string
        zcd?: string
        cdmc?: string
        xm?: string
        xf?: string
        jxbmc?: string
        kcbj?: string
        kclbmc?: string
        kch?: string
      }>
      xsxx?: {
        XM?: string
        XH?: string
      }
    }

    try {
      json = JSON.parse(text)
    } catch {
      if (text.includes('jaccount.sjtu.edu.cn') || text.includes('统一身份认证')) {
        return { ok: false, xnm, xqm, termTitle, courses: [], error: 'NEED_LOGIN' }
      }
      throw new Error('教务系统响应非标准 JSON')
    }

    const rawKb = json.kbList || []
    const courses: JiaowuCourseItem[] = rawKb.map(item => ({
      kcmc: (item.kcmc || '').trim(),
      jc: (item.jc || '').trim(),
      xqj: String(item.xqj || '').trim(),
      xqjmc: (item.xqjmc || '').trim(),
      zcd: (item.zcd || '').trim(),
      cdmc: (item.cdmc || '').trim(),
      xm: (item.xm || '').trim(),
      xf: item.xf ? String(item.xf).trim() : undefined,
      jxbmc: item.jxbmc ? String(item.jxbmc).trim() : undefined,
      kcbj: item.kcbj ? String(item.kcbj).trim() : undefined,
      kclbmc: item.kclbmc ? String(item.kclbmc).trim() : undefined,
      kch: item.kch ? String(item.kch).trim() : undefined
    }))

    const studentGrade = (json.xsxx as Record<string, unknown> | undefined)?.NJDM_ID
      ? String((json.xsxx as Record<string, unknown>).NJDM_ID)
      : json.xsxx?.XH && json.xsxx.XH.length >= 3
        ? '20' + json.xsxx.XH.slice(1, 3)
        : undefined

    return {
      ok: true,
      xnm,
      xqm,
      termTitle,
      courses,
      studentName: json.xsxx?.XM,
      studentId: json.xsxx?.XH,
      studentGrade
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      xnm,
      xqm,
      termTitle,
      courses: [],
      error: msg
    }
  }
}

