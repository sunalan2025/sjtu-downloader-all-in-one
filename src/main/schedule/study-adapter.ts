import { BrowserWindow } from 'electron'
import type Electron from 'electron'
import type { ScheduleEvent } from '../../shared/types'
import { safeFetch } from '../canvas/safe-fetch'

export const STUDY_BASE = 'https://j.sjtu.edu.cn'
const STUDY_LOGIN_URL = 'https://j.sjtu.edu.cn/app/ui/index'
export const STUDY_REFERER = 'https://j.sjtu.edu.cn/app/ui/index'
export const STUDY_EXAM_URL = 'https://j.sjtu.edu.cn/app/stu/exam/semester/list'
export const STUDY_CALENDAR_INFO_URL = 'https://j.sjtu.edu.cn/app/stu/school/calendar/info'

let _studyAtSjtuLoginPromise: Promise<boolean> | null = null
let _studyAtSjtuSsoDone = false

/** 清除学在交大 SSO 状态缓存 */
export function invalidateStudyAtSjtuLogin(): void {
  _studyAtSjtuSsoDone = false
  _studyAtSjtuLoginPromise = null
}

/** 解析学在交大 (j.sjtu.edu.cn) 返回的原始考试 JSON 数据为统一的 ScheduleEvent 列表 */
export function parseStudyAtSjtuExams(raw: unknown): ScheduleEvent[] {
  if (!raw || typeof raw !== 'object') return []
  const data = (raw as { data?: Record<string, unknown[]> }).data
  if (!data || typeof data !== 'object') return []

  const events: ScheduleEvent[] = []
  for (const [category, list] of Object.entries(data)) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const it = item as {
        year?: string
        semester?: string
        examType?: string
        name?: string
        address?: string
        day?: string
        weekday?: string
        startTime?: string
        endTime?: string
        leftDay?: string | number
      }
      if (!it.name) continue

      const name = String(it.name).trim()
      const examType = String(it.examType || category || '考试').trim()
      const day = String(it.day || '').trim()
      const startTime = it.startTime ? `${day} ${it.startTime}`.trim() : day
      const endTime = it.endTime ? `${day} ${it.endTime}`.trim() : day
      const address = String(it.address || '').trim()

      let leftDay: number | undefined
      if (it.leftDay != null) {
        const parsed = parseInt(String(it.leftDay), 10)
        if (!isNaN(parsed)) leftDay = parsed
      }
      if (leftDay === undefined && day) {
        try {
          const examDate = new Date(`${day}T00:00:00+08:00`)
          const now = new Date()
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          const diffMs = examDate.getTime() - today.getTime()
          leftDay = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
        } catch { /* ignore */ }
      }

      const id = `exam-${it.year || ''}-${it.semester || ''}-${name}-${day}-${it.startTime || ''}`.replace(/\s+/g, '_')
      const countdownStr = leftDay != null
        ? (leftDay > 0 ? `距考试还剩 ${leftDay} 天` : leftDay === 0 ? '今日考试' : '已考完')
        : ''

      const descParts = [
        `考试科目: ${name}`,
        `考试类别: ${examType}`,
        address ? `考场地点: ${address}` : null,
        countdownStr ? `倒计时: ${countdownStr}` : null
      ].filter(Boolean)

      events.push({
        id,
        title: `[考试] ${name} (${examType})`,
        courseName: name,
        location: address || undefined,
        startTime,
        endTime,
        type: 'exam',
        examType,
        leftDay,
        description: descParts.join('\n')
      })
    }
  }

  // 按开始时间升序排列
  return events.sort((a, b) => a.startTime.localeCompare(b.startTime))
}

/** 解析正方教务系统 (i.sjtu.edu.cn) 返回的原始考试列表 JSON */

/** 探测学在交大 (j.sjtu.edu.cn) 会话是否有效 */
export async function isStudyAtSjtuSessionValid(ses: Electron.Session): Promise<boolean> {
  try {
    if (!ses?.cookies?.get) return true
    const cookies = await ses.cookies.get({ url: STUDY_BASE })
    if (!cookies || cookies.length === 0) return false

    const resp = await safeFetch(ses, STUDY_CALENDAR_INFO_URL, {
      method: 'GET',
      headers: {
        Referer: STUDY_REFERER
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

/** 静默后台 BrowserWindow 执行学在交大 OAuth2 SSO 握手 */
async function completeStudyAtSjtuSso(ses: Electron.Session): Promise<boolean> {
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
    console.log('[schedule] 加载学在交大 SSO 入口（静默握手）:', STUDY_LOGIN_URL)
    await win.loadURL(STUDY_LOGIN_URL).catch(err => {
      console.warn('[schedule] StudyAtSjtu SSO loadURL 异常:', err)
    })

    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (win.isDestroyed()) return false
      const currentUrl = win.webContents.getURL() || ''

      if (currentUrl.includes('j.sjtu.edu.cn') && !win.webContents.isLoading() && !currentUrl.includes('oauth') && !currentUrl.includes('login')) {
        const cookies = await ses.cookies.get({ url: STUDY_BASE }).catch(() => [])
        const hasSession = cookies.some(c => c.name.toUpperCase() === 'JSESSIONID' || c.name.toLowerCase().includes('session') || c.name.toLowerCase().includes('token')) || cookies.length > 0
        if (hasSession) {
          console.log('[schedule] 学在交大 SSO 握手成功')
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
            console.log('[schedule] 学在交大检测到未登录 jAccount 会话')
            return false
          }
        } catch { /* ignore */ }
      }

      await new Promise(r => setTimeout(r, 300))
    }

    return false
  } catch (err) {
    console.warn('[schedule] 学在交大 SSO 流程异常:', err)
    return false
  } finally {
    if (!win.isDestroyed()) {
      try {
        win.webContents?.stop()
      } catch { /* ignore */ }
      setTimeout(() => {
        try {
          if (!win.isDestroyed()) win.destroy()
        } catch { /* ignore */ }
      }, 500)
    }
  }
}

/** 确保学在交大 SSO 登录完成 */
export async function ensureStudyAtSjtuLoggedIn(ses: Electron.Session): Promise<boolean> {
  if (_studyAtSjtuSsoDone) {
    if (await isStudyAtSjtuSessionValid(ses)) return true
    _studyAtSjtuSsoDone = false
  }
  if (_studyAtSjtuLoginPromise) return _studyAtSjtuLoginPromise

  _studyAtSjtuLoginPromise = (async () => {
    try {
      if (await isStudyAtSjtuSessionValid(ses)) {
        _studyAtSjtuSsoDone = true
        return true
      }

      if (ses?.cookies?.get) {
        const jaCookies = await ses.cookies.get({ domain: 'jaccount.sjtu.edu.cn' }).catch(() => [])
        const hasJaSession = jaCookies.some(c => c.name !== 'JATrustCookie' && c.name.length > 0)
        if (!hasJaSession) {
          console.log('[schedule] 无有效 jAccount 会话，跳过学在交大 SSO')
          return false
        }
      }

      console.log('[schedule] 触发 j.sjtu.edu.cn SSO（隐藏窗口）…')
      const ok = await completeStudyAtSjtuSso(ses)
      if (ok) {
        _studyAtSjtuSsoDone = true
        return true
      }
      return false
    } finally {
      _studyAtSjtuLoginPromise = null
    }
  })()

  return _studyAtSjtuLoginPromise
}

/**
 * 统一抓取本学期考试信息（主源：j.sjtu.edu.cn；备源兜底：i.sjtu.edu.cn）
 * 支持 5 分钟内存缓存与并发调用去重，消除冗余抓取
 */
