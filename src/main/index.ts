import { app, Menu, nativeTheme, shell } from 'electron'
import { electronApp } from '@electron-toolkit/utils'
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { setSession } from './cloudpan'
import {
  setCanvasSession,
  setCanvasEmitter,
  setConcurrencyProvider,
  setHlsActiveReporter,
  registerCanvasHandlers,
  invalidateCanvasLogin
} from './canvas/orchestrator'
import { killAllFfmpeg } from './canvas/hls-download'
import { clearVodChannelsCache, clearExtToolTokenCache, invalidateVshareLogin } from './canvas/video-tokens'
import {
  registerCnmoocHandlers,
  setCnmoocSession,
  setCnmoocEmitter,
  invalidateCnmoocLogin
} from './cnmooc/orchestrator'
import { registerScheduleHandlers } from './schedule/orchestrator'
import { invalidateCalendarLogin } from './schedule/schedule-fetcher'
import { cancelUpdate } from './updater'
import { sjtuSession } from './session'
import { hydrateSjtuSession } from './auth'
import { startEmbeddedDevWorker, stopEmbeddedDevWorker } from './private-worker'
import { stopSshTunnel } from './ssh-tunnel'
import {
  getConcurrency,
  getHlsActive,
  setHlsActive,
  startSpeedTicker,
  stopSpeedTicker,
  stopNetworkResumeTimer,
  setRendererEmitter,
  setRescheduleCallback,
  setIsQuittingGetter
} from './concurrency'
import {
  createMainWindow,
  showMainWindow,
  getMainWindow,
  setIsQuitting,
  getIsQuitting,
  createTray,
  applyThemeIcons,
  destroyTray
} from './window'
import { emitProgress } from './download-engine/progress'
import {
  tasks,
  active,
  cloudTasks,
  cloudActive,
  pendingLocal,
  pausedLocal,
  pendingCloud,
  pausedCloud,
  pendingLocalIds,
  pausedLocalIds,
  pendingCloudIds,
  pausedCloudIds,
  cloudPausedStates,
  cnmoocCookiesByTask,
  cloudFullRetries,
  sharedActiveCount,
  destroyLocalHandles,
  destroyCloudHandles
} from './download-engine/shared'
import { scheduleNext } from './download-engine/local'
import { cloudScheduleNext } from './download-engine/cloud'
import { isSafeExternalUrl } from '../shared/utils'

// IPC 领域模块
import { registerAppHandlers } from './ipc/app-handlers'
import { registerAuthHandlers } from './ipc/auth-handlers'
import { registerCloudPanHandlers } from './ipc/cloudpan-handlers'
import { registerDownloadHandlers } from './ipc/download-handlers'

// ─── 单实例锁：已有实例运行则唤起其窗口并退出当前进程，禁止应用多开 ───
const gotTheLock = app.requestSingleInstanceLock()
if (gotTheLock) {
  app.on('second-instance', () => {
    if (getIsQuitting()) return
    const w = getMainWindow()
    if (w) {
      if (w.isMinimized()) w.restore()
      if (!w.isVisible()) w.show()
      w.focus()
    }
  })
} else {
  app.quit()
}

let isAppReady = false

app.whenReady().then(async () => {
  if (!gotTheLock) return

  // ─── 全局兜底：防止未捕获的 promise rejection 导致任务卡死 ───
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason)
  })
  process.on('uncaughtException', (err) => {
    if (err instanceof RangeError && err.message.includes('init["status"]')) {
      console.warn('[net:warn] 忽略 Electron net.fetch 内部请求中止/连接重置状态码异常:', err.message)
      return
    }

    console.error('[uncaughtException]', err)
    cleanupOnQuit()
    app.quit()
  })

  electronApp.setAppUserModelId('edu.sjtu.course-downloader')

  // 移除默认应用菜单，避免误触开发者工具等
  Menu.setApplicationMenu(null)

  // webview 内任何 window.open 都走外部安全浏览器
  app.on('web-contents-created', (_, contents) => {
    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(d => {
        if (isSafeExternalUrl(d.url)) {
          void shell.openExternal(d.url)
        }
        return { action: 'deny' }
      })
    }
  })

  sjtuSession() // 预热持久化 session
  setSession(sjtuSession()) // 云盘 API 使用 Electron session（走系统代理）
  setCanvasSession(sjtuSession()) // Canvas 使用同一个持久化 session（共享 jAccount 登录态）

  // ─── 会话持久化与启动恢复（R1-F1, R1-F3） ───
  void (async () => {
    try {
      const hydAuth = await hydrateSjtuSession()
      console.log(
        '[startup] 会话恢复状态:',
        hydAuth.loggedIn ? '已登录' : '未登录/需重新认证'
      )
    } catch (e) {
      console.error('[startup] 会话恢复失败（不阻塞启动）:', e)
    }
  })()

  setCanvasEmitter((channel, data) => {
    const w = getMainWindow()
    if (!w) return
    w.webContents.send(channel, data)
  })

  setRendererEmitter((channel, data) => {
    getMainWindow()?.webContents.send(channel, data)
  })
  setRescheduleCallback(() => {
    scheduleNext()
    cloudScheduleNext()
  })
  setIsQuittingGetter(() => getIsQuitting())
  setConcurrencyProvider(() => ({ active: sharedActiveCount(), concurrency: getConcurrency() }))
  setHlsActiveReporter((delta: number) => { setHlsActive(Math.max(0, getHlsActive() + delta)) })
  registerCanvasHandlers()

  // 好大学在线 (cnmooc.sjtu.cn)
  setCnmoocSession(sjtuSession())
  setCnmoocEmitter((channel, data) => {
    const w = getMainWindow()
    if (!w) return
    w.webContents.send(channel, data)
  })
  registerCnmoocHandlers()

  // 课表与日程管理 (calendar.sjtu.edu.cn / Canvas DDL)
  registerScheduleHandlers(sjtuSession(), getMainWindow)

  // 开发环境 (npm run dev) 下自动拉起内置测试中转节点
  if (!app.isPackaged) {
    startEmbeddedDevWorker().then(url => {
      if (url) console.log('[dev-worker] 内置开发测试节点已自动就绪:', url)
    }).catch(() => undefined)
  }

  // ─── 挂载解耦的领域 IPC 模块 ───
  registerAppHandlers()
  registerAuthHandlers()
  registerCloudPanHandlers()
  registerDownloadHandlers()

  createMainWindow()
  createTray()
  startSpeedTicker()

  // 清理可能遗留的陈旧任务队列文件
  try {
    const oldQueueFile = join(app.getPath('userData'), 'download_queue.json')
    if (existsSync(oldQueueFile)) unlinkSync(oldQueueFile)
  } catch { /* ignore */ }

  // 系统深浅主题切换 → 同步窗口/托盘图标
  nativeTheme.on('updated', applyThemeIcons)

  app.on('activate', () => {
    showMainWindow()
  })

  isAppReady = true
})

/** 退出前清理：销毁所有活跃的 HTTP 请求、文件流、定时器 */
function cleanupOnQuit(): void {
  setIsQuitting(true)

  cancelUpdate()
  killAllFfmpeg()
  clearVodChannelsCache()
  clearExtToolTokenCache()

  invalidateVshareLogin()
  invalidateCnmoocLogin()
  invalidateCanvasLogin()
  invalidateCalendarLogin()

  cnmoocCookiesByTask.clear()
  cloudFullRetries.clear()

  stopSpeedTicker()
  destroyTray()

  stopEmbeddedDevWorker().catch(() => undefined)
  stopSshTunnel().catch(() => undefined)
  stopNetworkResumeTimer()

  for (const [, t] of tasks) {
    if (t.state === 'downloading' || t.state === 'pending') {
      t.state = 'cancelled'
      destroyLocalHandles(t, 'app quit')
      emitProgress({ taskId: t.spec.taskId, state: 'cancelled', received: t.received, total: t.total, message: '应用退出' })
    }
  }

  for (const [, t] of cloudTasks) {
    if (t.state === 'downloading' || t.state === 'pending') {
      t.state = 'cancelled'
      destroyCloudHandles(t, 'app quit')
      t.uploader = undefined
      emitProgress({ taskId: t.spec.taskId, state: 'cancelled', received: t.received, total: t.total, message: '应用退出' })
    }
  }

  tasks.clear()
  active.clear()
  pendingLocal.length = 0
  pausedLocal.length = 0
  pendingLocalIds.clear()
  pausedLocalIds.clear()
  cloudTasks.clear()
  cloudActive.clear()
  pendingCloud.length = 0
  pausedCloud.length = 0
  pendingCloudIds.clear()
  pausedCloudIds.clear()
  cloudPausedStates.clear()
}

app.on('window-all-closed', () => {
  if (!isAppReady) return
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  cleanupOnQuit()
  stopSshTunnel().catch(() => undefined)
})
