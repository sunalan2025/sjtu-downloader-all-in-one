/**
 * 交大官方课表 (calendar.sjtu.edu.cn) 与 Canvas DDL 数据抓取器（统一聚合中枢）
 */
import { BrowserWindow } from 'electron'
import type Electron from 'electron'
import type { ScheduleEvent, ScheduleWeek, ScheduleFetchResult } from '../../shared/types'
import { safeFetch } from '../canvas/safe-fetch'
import { fetchCanvasUpcomingDeadlines } from './canvas-schedule'
import { fetchExamEvents, tagExamCourseConflicts, invalidateExamEventsCache } from './exam-service'
import { invalidateJiaowuLogin } from './jiaowu-adapter'
import { invalidateStudyAtSjtuLogin } from './study-adapter'

// 向后兼容统一重导出子模块 API
export * from './canvas-schedule'
export * from './jiaowu-adapter'
export * from './study-adapter'
export * from './exam-service'
export * from './ics-generator'

const CALENDAR_BASE = 'https://calendar.sjtu.edu.cn'
const CALENDAR_REFERER = 'https://calendar.sjtu.edu.cn/ui/calendar'

let _calendarLoginPromise: Promise<boolean> | null = null
let _calendarSsoDone = false


/** 注销或重置会话时清除 SSO 状态缓存 */
export function invalidateCalendarLogin(): void {
  _calendarSsoDone = false
  _calendarLoginPromise = null
  invalidateJiaowuLogin()
  invalidateStudyAtSjtuLogin()
  invalidateExamEventsCache()
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

export async function fetchAllScheduleEvents(
  ses: Electron.Session,
  options?: { startDate?: string; endDate?: string }
): Promise<ScheduleFetchResult> {
  try {
    let calError: string | null = null
    const [calRes, ddlEvents, examEvents] = await Promise.all([
      fetchCalendarEvents(ses, options?.startDate, options?.endDate).catch(err => {
        const msg = err instanceof Error ? err.message : String(err)
        calError = msg
        console.warn('[schedule] 拉取交我办课表失败:', msg)
        return { events: [], weeks: [], currentWeek: undefined, semesterTitle: undefined }
      }),
      fetchCanvasUpcomingDeadlines(ses).catch(() => []),
      fetchExamEvents(ses).catch(err => {
        console.warn('[schedule] 拉取考试日程失败:', err)
        return []
      })
    ])

    if (calError === 'NEED_LOGIN') {
      return {
        ok: false,
        events: [],
        error: 'NEED_LOGIN'
      }
    }

    // 为考试事件标注与日常排课的时段冲突
    tagExamCourseConflicts(examEvents, calRes.events)

    const allEvents = [...calRes.events, ...ddlEvents, ...examEvents]

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
