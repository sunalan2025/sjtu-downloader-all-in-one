import { ipcMain } from 'electron'
import { V_SJTU_API } from '../../shared/types'
import { clearCachedCredentials } from '../cloudpan'
import { clearSjtuSessionCookies } from '../session'
import { invalidateVshareLogin } from '../canvas/video-tokens'
import { invalidateCnmoocLogin } from '../cnmooc/orchestrator'
import { invalidateCanvasLogin } from '../canvas/orchestrator'
import { invalidateCalendarLogin } from '../schedule/schedule-fetcher'
import {
  getAuthInfo,
  vsjtuFetch,
  setJwtToken,
  clearAuthState,
  exchangeVsjtuJwtByCode,
  ensureVsjtuLogin
} from '../auth'
import { validateIpcSender, DEFAULT_UNTRUSTED_IPC_ERROR } from '../utils/ipc-guard'

/**
 * 彻底清除 SJTU 会话与各子系统登录态缓存
 */
export async function clearSjtuSession(): Promise<void> {
  await clearSjtuSessionCookies()
  invalidateVshareLogin()
  invalidateCnmoocLogin()
  invalidateCanvasLogin()
  invalidateCalendarLogin()
}

/**
 * 注册用户认证与交大在线 (auth:*, vsjtu:*) 相关 IPC 通道
 */
export function registerAuthHandlers(): void {
  const handle: typeof ipcMain.handle = (channel, listener) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!validateIpcSender(event)) {
        return { ok: false, error: DEFAULT_UNTRUSTED_IPC_ERROR }
      }
      return listener(event, ...args)
    })

  handle('auth:set-jwt-token', (_e, token: string | null, userInfo?: { name?: string; studentId?: string }) => {
    setJwtToken(token, userInfo)
    return { ok: true }
  })

  handle('auth:logout', async () => {
    clearAuthState()
    clearCachedCredentials()
    await clearSjtuSession()
    return { loggedIn: false, checkedAt: new Date().toISOString() }
  })

  handle('auth:clear', async () => {
    clearAuthState()
    clearCachedCredentials()
    await clearSjtuSession()
    return { loggedIn: false, checkedAt: new Date().toISOString() }
  })

  handle('auth:status', async (_e, force?: boolean) => {
    const info = await getAuthInfo(force)
    return {
      loggedIn: info.loggedIn,
      accountName: info.accountName,
      studentId: info.studentId,
      user:
        info.accountName || info.studentId
          ? { name: info.accountName || '', account: info.studentId || '' }
          : undefined,
      expiresAt: info.expiresAt,
      expired: info.expired,
      checkedAt: new Date().toISOString()
    }
  })

  handle('auth:exchange-code', async (_e, code: string) => {
    if (!code) return { success: false }
    const token = await exchangeVsjtuJwtByCode(code)
    return { success: !!token, token }
  })

  handle('auth:solve-captcha', async (_e, dataUrl: string) => {
    if (!dataUrl || typeof dataUrl !== 'string') {
      console.warn('[auth:solve-captcha] 无效的 dataUrl')
      return { ok: false, error: 'invalid_data_url' }
    }
    try {
      const commaIdx = dataUrl.indexOf(',')
      const base64Str = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl
      const buf = Buffer.from(base64Str, 'base64')

      const formData = new FormData()
      formData.append('image', new Blob([buf], { type: 'image/jpeg' }), 'captcha.jpg')

      console.log(`[auth:solve-captcha] 正在向 geek.sjtu.edu.cn 请求验证码识别 (图片大小: ${buf.length} 字节)...`)
      const resp = await fetch('https://geek.sjtu.edu.cn/captcha-solver/', {
        method: 'POST',
        body: formData
      })

      if (!resp.ok) {
        console.warn(`[auth:solve-captcha] 识别服务返回 HTTP ${resp.status}`)
        return { ok: false, error: `HTTP ${resp.status}` }
      }
      const data = (await resp.json()) as { error?: string; result?: string | null }
      if (data.result && typeof data.result === 'string') {
        const code = data.result.trim()
        console.log(`[auth:solve-captcha] 验证码识别成功: ${code}`)
        return { ok: true, code }
      }
      console.warn('[auth:solve-captcha] 识别服务未返回识别结果:', data)
      return { ok: false, error: data.error || 'no_result' }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.warn('[auth:solve-captcha] 请求异常:', errMsg)
      return { ok: false, error: errMsg }
    }
  })

  handle('vsjtu:scan-audit', async (_e, pageNo = 1, pageSize = 100) => {
    await ensureVsjtuLogin()

    const first = (await vsjtuFetch(V_SJTU_API.auditCourseMy, {
      method: 'POST',
      body: { pageNo, pageSize }
    })) as { success?: boolean; data?: any }

    if (pageNo === 1 && first?.success && first.data) {
      const getItems = (d: any): unknown[] => {
        if (!d) return []
        if (Array.isArray(d.records)) return d.records
        if (Array.isArray(d.list)) return d.list
        return []
      }
      const totalPage = Number(first.data.totalPage ?? first.data.pages ?? 1) || 1
      const allRecords = [...getItems(first.data)]

      if (totalPage > 1) {
        for (let p = 2; p <= totalPage; p++) {
          try {
            const next = (await vsjtuFetch(V_SJTU_API.auditCourseMy, {
              method: 'POST',
              body: { pageNo: p, pageSize }
            })) as { success?: boolean; data?: any }
            if (next?.success && next.data) {
              allRecords.push(...getItems(next.data))
            }
          } catch {
            break
          }
        }
      }
      return {
        ...first,
        data: {
          ...first.data,
          records: allRecords,
          list: allRecords,
          total: allRecords.length,
          totalCount: allRecords.length,
          currPage: 1,
          totalPage: 1
        }
      }
    }
    return first
  })

  handle('vsjtu:audit-course-detail', async (_e, resourceId: number) => {
    await ensureVsjtuLogin()
    const r = await vsjtuFetch(V_SJTU_API.auditCourseDetail, {
      method: 'POST',
      body: { resourceId }
    })
    return r
  })
}
