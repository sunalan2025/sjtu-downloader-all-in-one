/**
 * 好大学在线 (cnmooc.sjtu.cn) 下载编排器 — 注册 IPC 处理器，协调扫描 / 登录 / spec 生成
 *
 * 与 canvas/orchestrator.ts 同构：session/emitter 注入式，不直接持 BrowserWindow 引用。
 * cnmooc 复用 v.sjtu 的 jAccount 登录态（persist:sjtu），SSO 用隐藏 BrowserWindow
 * 自动完成（首次失败则弹可见窗口兜底）。
 *
 * 资源直链**仅下载时懒解析**：扫描只解析章节 HTML；build-specs 产占位 spec（url 为空），
 * 下载引擎 resolveDirectUrl 的 'cnmooc' 分支在下载前 POST play.mooc+detail.mooc 取直链，
 * 并按 cnmoocResourceFilter 过滤、补全扩展名。
 */
import { BrowserWindow, ipcMain } from 'electron'
import type Electron from 'electron'
import {
  CNMOOC_BASE_URL,
  CNMOOC_MY_COURSES_URL,
  type CanvasDownloadTaskSpec,
  type CnmoocCourse,
  type CnmoocResourceFilter,
  type CnmoocSelectedItem
} from '../../shared/types'
import {
  fetchCourses,
  fetchChapters,
  isCnmoocSessionValid
} from './api'
import { sanitizeFsName } from '../canvas/api'

let ses: Electron.Session | null = null

export function setCnmoocSession(session: Electron.Session): void {
  ses = session
}

function getSession(): Electron.Session {
  if (!ses) throw new Error('cnmooc session not initialized')
  return ses
}

type CnmoocEmitter = (channel: string, data?: unknown) => void
let _emit: CnmoocEmitter | null = null

export function setCnmoocEmitter(emitter: CnmoocEmitter): void {
  _emit = emitter
}

function emitToRenderer(channel: string, data?: unknown): void {
  _emit?.(channel, data)
}

function emitScanProgress(courseId: string, phase: string, message: string): void {
  emitToRenderer('cnmooc:scan-progress', { courseId, phase, message })
}

// ─── 登录（jAccount SSO，复用 persist:sjtu cookie） ────────────

/** SSO 是否已成功过（避免每次 API 调用都重走 SSO） */
let _cnmoocLoginDone = false

/** 标记登录态失效（session 过期时由调用方清除，强制下次重走 SSO） */
export function invalidateCnmoocLogin(): void {
  _cnmoocLoginDone = false
}

/** 确保 cnmooc 已登录：先探现有会话，无效则隐藏窗口走 jAccount SSO，再失败弹可见窗口。 */
export async function ensureCnmoocLogin(): Promise<boolean> {
  if (_cnmoocLoginDone) return true
  const session = getSession()
  if (await isCnmoocSessionValid(session)) {
    _cnmoocLoginDone = true
    return true
  }
  console.log('[cnmooc] 触发 jAccount SSO（隐藏窗口）…')
  if (await completeCnmoocSso(session, false)) {
    _cnmoocLoginDone = true
    return true
  }
  console.log('[cnmooc] 隐藏 SSO 失败，弹出可见窗口')
  if (await completeCnmoocSso(session, true)) {
    _cnmoocLoginDone = true
    return true
  }
  return false
}

/** 通过 BrowserWindow 完成 cnmooc jAccount SSO。
 *  先 load home/login.mooc 建立 cnmooc 会话（JSESSIONID）—— 直接 loadURL /oauth/jacAuth.mooc
 *  会因缺少 session 上下文 ERR_FAILED。login.mooc 加载后在页面上下文点击 jAccount 入口
 *  （a.link-other[href="/oauth/jacAuth.mooc"]），带 referer/cookie 触发 SSO 跳转：
 *  cnmooc → jaccount（检测 persist:sjtu 的 jAccount cookie）→ 回跳 cnmooc 落 cpstk。
 *  关 backgroundThrottling：隐藏窗口默认被节流，SSO 重定向链路会被拖慢甚至卡住（曾导致超时）。
 *  show=true 弹可见窗口（首次/jaccount cookie 失效需扫码），show=false 隐藏 60s 自动 SSO。 */
async function completeCnmoocSso(session: Electron.Session, show: boolean): Promise<boolean> {
  const win = new BrowserWindow({
    show,
    width: 1000,
    height: 700,
    title: '登录 好大学在线 (Jaccount)',
    autoHideMenuBar: true,
    webPreferences: {
      session,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  try {
    // 1. 加载 login.mooc 建立 cnmooc 会话（直接 loadURL jacAuth 会因缺 session 上下文 ERR_FAILED）
    await win.loadURL(`${CNMOOC_BASE_URL}/home/login.mooc`)
    // 2. 在页面上下文点击 jAccount 入口（带 login.mooc 的 referer/cookie，触发 SSO 跳转）
    await win.webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector('a.link-other[href="/oauth/jacAuth.mooc"]')
          || document.querySelector('a[href*="jaccount"]')
          || document.querySelector('a.jaccount')
          || document.querySelector('#jaccount');
        if (el) { el.click(); return true; }
        return false;
      })();
    `).catch(() => { /* 点击触发导航会 reject，忽略 */ })

    // 3. 轮询 cnmooc 会话是否生效（SSO 回跳落 cpstk 后 myCourseIndex 返回 200）
    const timeoutMs = show ? 120_000 : 60_000
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1000))
      if (await isCnmoocSessionValid(session)) {
        await new Promise(r => setTimeout(r, 500)) // 等 cpstk cookie 完全落盘
        console.log('[cnmooc] SSO 完成')
        return true
      }
    }
    // 超时排查：jaccount 会话不存在时 SSO 会停在 jaccount 登录页无法自动回跳，
    // 提示用户先在应用内完成 v.sjtu 的 jAccount 登录。
    const jaCookies = await session.cookies.get({ domain: 'jaccount.sjtu.edu.cn' })
    const jaSession = jaCookies.some(c => c.name !== 'JATrustCookie')
    console.log(`[cnmooc] SSO 超时（jaccount 会话${jaSession ? '存在' : '不存在，请先在应用内登录 v.sjtu'}）`)
    return false
  } catch (e) {
    console.log('[cnmooc] SSO 异常:', e)
    return false
  } finally {
    win.destroy()
  }
}

// ─── 注册所有 cnmooc IPC handler ───────────────────────────────

export function registerCnmoocHandlers(): void {
  // ─── 登录状态（含课程列表，未登录不报错由前端引导） ───
  ipcMain.handle('cnmooc:status', async () => {
    try {
      const session = getSession()
      const loggedIn = await isCnmoocSessionValid(session)
      let courses: CnmoocCourse[] | undefined
      if (loggedIn) {
        try {
          _cnmoocLoginDone = true
          courses = await fetchCourses(session)
        } catch {
          /* 课程列表拉取失败不影响登录态判定 */
        }
      }
      return { ok: true, loggedIn, courses }
    } catch (err) {
      return { ok: false, loggedIn: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 显式触发登录（前端「连接好大学在线」按钮） ───
  ipcMain.handle('cnmooc:login', async () => {
    try {
      const ok = await ensureCnmoocLogin()
      return { ok }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 扫描课程列表 ───
  ipcMain.handle('cnmooc:scan', async () => {
    try {
      const loggedIn = await ensureCnmoocLogin()
      if (!loggedIn) return { ok: false, error: '好大学在线登录失败，请先登录 jAccount（v.sjtu）' }
      try {
        const courses = await fetchCourses(getSession())
        return { ok: true, courses }
      } catch (err) {
        // 课程列表 401/重定向 → session 可能过期，清缓存重试一次
        const msg = err instanceof Error ? err.message : String(err)
        if (/401|403|登录|login/i.test(msg)) {
          console.log('[cnmooc] 课程列表拉取疑似会话过期，重走 SSO')
          _cnmoocLoginDone = false
          const ok2 = await ensureCnmoocLogin()
          if (!ok2) return { ok: false, error: '好大学在线登录失败' }
          const courses = await fetchCourses(getSession())
          return { ok: true, courses }
        }
        throw err
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 扫描一门课的章节结构（仅 HTML 解析，快；不预探直链） ───
  ipcMain.handle('cnmooc:scan-course', async (_e, courseId: string) => {
    try {
      emitScanProgress(courseId, 'chapters', '正在解析章节…')
      const chapters = await fetchChapters(getSession(), courseId)
      emitScanProgress(courseId, 'done', `解析完成：${chapters.length} 章`)
      return { ok: true, chapters }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 构建下载 spec（占位 url，下载时懒解析） ───
  // courseName/courseId 用于落盘路径与 taskId；items 携带 chapter 用于子目录；
  // resourceFilter 由下载引擎按直链类型过滤（all 不过滤）。
  ipcMain.handle(
    'cnmooc:build-specs',
    async (
      _e,
      courseName: string,
      courseId: string,
      items: CnmoocSelectedItem[],
      resourceFilter: CnmoocResourceFilter
    ) => {
      try {
        const specs: CanvasDownloadTaskSpec[] = []
        const cleanCourse = sanitizeFsName(courseName)
        for (const item of items) {
          const chapter = sanitizeFsName(item.chapter)
          specs.push({
            taskId: `cnmooc_${courseId}_${item.itemId}`,
            url: '', // 懒解析：下载前由 resolveDirectUrl 的 'cnmooc' 分支填入
            courseName: `${cleanCourse}/${chapter}`,
            fileName: sanitizeFsName(item.title),
            source: 'cnmooc',
            cnmoocItemId: item.itemId,
            cnmoocItemType: item.itemType,
            cnmoocChapter: chapter,
            cnmoocResourceFilter: resourceFilter
          })
        }
        return { ok: true, specs }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
