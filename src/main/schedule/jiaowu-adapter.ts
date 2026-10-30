import { BrowserWindow } from 'electron'
import type Electron from 'electron'
import type { ScheduleEvent, JiaowuCourseItem, JiaowuScheduleResult } from '../../shared/types'
import { safeFetch } from '../canvas/safe-fetch'

export const JIAOWU_BASE = 'https://i.sjtu.edu.cn'
const JIAOWU_LOGIN_URL = 'https://i.sjtu.edu.cn/jaccountlogin'
const JIAOWU_KB_URL = 'https://i.sjtu.edu.cn/kbcx/xskbcx_cxXsKb.html?gnmkdm=N253508'
const JIAOWU_REFERER = 'https://i.sjtu.edu.cn/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N253508&layout=default'
export const JIAOWU_EXAM_URL = 'https://i.sjtu.edu.cn/kwgl/kscx_cxXsksxxIndex.html?doType=query&gnmkdm=N358105'

let _jiaowuLoginPromise: Promise<boolean> | null = null
let _jiaowuSsoDone = false

/** 清除教务系统 SSO 状态缓存 */
export function invalidateJiaowuLogin(): void {
  _jiaowuSsoDone = false
  _jiaowuLoginPromise = null
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


export function parseJiaowuExams(raw: unknown): ScheduleEvent[] {
  if (!raw || typeof raw !== 'object') return []
  const items = (raw as { items?: unknown[] }).items
  if (!Array.isArray(items)) return []

  const events: ScheduleEvent[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const it = item as {
      kcmc?: string
      ksmc?: string
      kssj?: string
      cdmc?: string
      cdxqmc?: string
      kch?: string
      jxbmc?: string
      kkxy?: string
      ksfs?: string
      xnm?: string
      xqm?: string
    }
    if (!it.kcmc) continue

    const name = String(it.kcmc).trim()
    const ksmc = String(it.ksmc || '').trim()

    // kssj 格式通常形如: "2026-11-04(13:10-15:10)" 或 "2026-11-04 13:10-15:10"
    const kssjMatch = String(it.kssj || '').match(/(\d{4}-\d{2}-\d{2})[^\d]*(\d{1,2}:\d{2})\s*[-~至到]\s*(\d{1,2}:\d{2})/)
    let startTime = ''
    let endTime = ''
    let day = ''
    if (kssjMatch) {
      day = kssjMatch[1]
      startTime = `${day} ${kssjMatch[2]}`
      endTime = `${day} ${kssjMatch[3]}`
    } else {
      startTime = String(it.kssj || '')
      endTime = String(it.kssj || '')
    }

    const cdmc = (it.cdmc || '').trim()
    const cdxqmc = (it.cdxqmc || '').trim()
    const location = cdmc
      ? (cdxqmc && !cdmc.includes(cdxqmc) ? `${cdmc} (${cdxqmc})` : cdmc)
      : undefined

    let examType = '考试'
    if (ksmc.includes('期中随堂考') || ksmc.includes('随堂考')) examType = '期中随堂考'
    else if (ksmc.includes('物理期中') || ksmc.includes('化学期中') || ksmc.includes('期中')) examType = '期中考试'
    else if (ksmc.includes('期末')) examType = '期末考试'

    let leftDay: number | undefined
    if (day) {
      try {
        const examDate = new Date(`${day}T00:00:00+08:00`)
        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const diffMs = examDate.getTime() - today.getTime()
        leftDay = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
      } catch { /* ignore */ }
    }

    const id = `exam-jw-${it.xnm || ''}-${it.xqm || ''}-${name}-${day}-${startTime}`.replace(/\s+/g, '_')
    const descParts = [
      `考试科目: ${name}`,
      ksmc ? `考试名称: ${ksmc}` : null,
      `考试类别: ${examType}`,
      location ? `考场地点: ${location}` : null,
      it.kkxy ? `开课学院: ${it.kkxy}` : null,
      it.jxbmc ? `教学班: ${it.jxbmc}` : null,
      leftDay != null ? `倒计时: ${leftDay > 0 ? `距考试还剩 ${leftDay} 天` : leftDay === 0 ? '今日考试' : '已考完'}` : null
    ].filter(Boolean)

    events.push({
      id,
      title: `[考试] ${name}${examType !== '考试' ? ` (${examType})` : ''}`,
      courseName: name,
      location,
      startTime,
      endTime,
      type: 'exam',
      examType,
      leftDay,
      description: descParts.join('\n')
    })
  }

  return events.sort((a, b) => a.startTime.localeCompare(b.startTime))
}

