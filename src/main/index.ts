import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, shell } from 'electron'
import { electronApp } from '@electron-toolkit/utils'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { request as httpsRequest } from 'node:https'
import {
  V_SJTU_API,
  type DownloadMode,
  type FileConflictStrategy,
  type DownloadTaskSpec
} from '../shared/types'
import {
  getCachedUserToken,
  setCachedUserToken,
  clearCachedCredentials,
  validateUserToken,
  getSpaceInfo,
  setSession,
  listDirectoryContents,
  createDirectory,
  deleteCloudItem,
  renameCloudItem,
  getFileDownloadUrl
} from './cloudpan'
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
import type { UpdateCheckResult } from '../shared/types'
import {
  registerCnmoocHandlers,
  setCnmoocSession,
  setCnmoocEmitter,
  invalidateCnmoocLogin
} from './cnmooc/orchestrator'
import { matchAsset, downloadUpdate, cancelUpdate, installUpdate, setUpdateEmitter } from './updater'
import { sjtuSession, clearSjtuSessionCookies } from './session'
import { cleanupStaleDownloads } from './cleanup'
import {
  getAuthInfo,
  vsjtuFetch,
  setJwtToken,
  clearAuthState,
  hydrateSjtuSession,
  saveSessionStore,
  loadSessionStoreRaw,
  exchangeVsjtuJwtByCode,
  ensureVsjtuLogin
} from './auth'
import {
  getConcurrency,
  setConcurrency,
  getAutoConcurrency,
  setAutoConcurrency,
  getHlsActive,
  setHlsActive,
  startAutoConcurrency,
  stopAutoConcurrency,
  startSpeedTicker,
  stopSpeedTicker,
  stopNetworkResumeTimer,
  setRendererEmitter,
  setRescheduleCallback,
  setHasActiveWorkGetter,
  setIsQuittingGetter
} from './concurrency'
import {
  createMainWindow,
  showMainWindow,
  getMainWindow,
  minimizeToTaskbar,
  setIsQuitting,
  getIsQuitting,
  createTray,
  applyThemeIcons,
  resolveAppIcon,
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
  conflictStrategyByTask,
  cnmoocCookiesByTask,
  cloudFullRetries,
  CLOUD_ROOT_FOLDER,
  CNMOOC_LOCAL_DIR,
  sharedActiveCount,
  hasOngoingTasks,
  effectiveCourseName,
  destroyLocalHandles,
  destroyCloudHandles,
  isCanvasSpec,
  isCnmoocSpec
} from './download-engine/shared'
import {
  scheduleNext,
  pauseTask,
  cancelTask,
  resumeTask,
  pauseAll,
  cancelAll,
  resumeAll
} from './download-engine/local'
import {
  cloudScheduleNext,
  cloudPauseTask,
  cloudCancelTask,
  cloudResumeTask,
  cloudPauseAll,
  cloudCancelAll,
  cloudResumeAll
} from './download-engine/cloud'
import { saveQueueState, loadQueueState } from './download-engine/persistence'
import { globalSpeedLimiter, formatPathFromTemplate } from '../shared/utils'


// ─── 新版本检查配置 ───
const UPDATE_REPO = 'sunalan2025/sjtu-downloader-all-in-one'
const UPDATE_CHECK_TTL = 60 * 60 * 1000 // 1h 节流，避免触发 GitHub 未认证 60 次/h 限流
let _updateCache: { result: UpdateCheckResult; ts: number } | null = null

/** 语义版本比较：latest > current 返回 true。不引 semver 依赖，仅按 a.b.c 数字逐段比。
 *  非 semver 字符串（解析失败）视为非新版，保守返回 false。 */
function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.split('.').map(Number)
  const b = current.split('.').map(Number)
  if (a.some(n => Number.isNaN(n)) || b.some(n => Number.isNaN(n))) return false
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    if (ai > bi) return true
    if (ai < bi) return false
  }
  return false
}




/** 托盘图标路径：dev 下从项目 build/icons 取 32.png；打包后从 extraResources(icons) 取。
 *  Electron Tray 在 Windows 上接受 PNG；32px 兼顾 HiDPI 清晰度。
 *  跟随系统深浅主题 (同 resolveAppIcon): 深色主题用浅色 logo, 浅色主题用深色 logo。 */

/** 系统主题变化时刷新窗口/托盘图标到当前主题版本。
 *  - 窗口图标 (任务栏): Win/Linux 切换; macOS dock 图标也切换 (深色模式 dock 深底需浅色 logo)。
 *  - 托盘: Win/Linux 切换; macOS 菜单栏图标用 setTemplateImage(true) 自动跟随深浅反色, 不手动切。
 *  图标文件缺失 (nativeImage.isEmpty) 时跳过, 保持当前图标不动。 */



async function clearSjtuSession(): Promise<void> {
  await clearSjtuSessionCookies()
  // vshare 域 cookie 已随 clearStorageData 清除，同步重置内存登录态标志，
  // 否则下次 ensureVshareLogin 会被 _vshareLoginDone 短路、不再探测会话有效性
  invalidateVshareLogin()
  // [B5 Fix] 同步重置 cnmooc/canvas SSO 标志，否则 session 清除后各 ensureLogin 被旧标志短路、不再探测
  invalidateCnmoocLogin()
  invalidateCanvasLogin()
}

// ─────────────────────────────────────────────────────────────
// 下载：任务注册表 + 动态调度器 + 断点续传
// ─────────────────────────────────────────────────────────────



/** 把一个 paused 的云端 spec 重新入待处理队列（resume 用） */

// ─── 单实例锁：已有实例运行则唤起其窗口并退出当前进程，禁止应用多开 ───
const gotTheLock = app.requestSingleInstanceLock()
if (gotTheLock) {
  // 第二个实例尝试启动时，唤起并聚焦已运行实例的主窗口（可能在托盘隐藏中）。
  // 不调 createMainWindow：第一实例可能仍在初始化，重复创建会出双窗口；
  // 窗口未就绪时由第一实例自行 show，这里仅在已存在时聚焦。
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
  // 未获取单实例锁的进程不执行任何初始化（尤其避免 clearSjtuSession 清掉
  // 已运行实例的凭证），等待上面的 app.quit() 完成退出。
  if (!gotTheLock) return

  // ─── 全局兜底：防止未捕获的 promise rejection 导致任务卡在 downloading 永不结束 ───
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason)
  })
  process.on('uncaughtException', (err) => {
    // [2.6] Log the error, then attempt graceful shutdown.
    // Silently swallowing uncaughtException leaves the app in an undefined state.
    console.error('[uncaughtException]', err)
    cleanupOnQuit()
    app.quit()
  })

  electronApp.setAppUserModelId('edu.sjtu.course-downloader')

  // 移除默认应用菜单（File/Edit/View/Window/Help，含开发者工具入口）。
  // autoHideMenuBar 仍可按 Alt 呼出，setApplicationMenu(null) 彻底移除，避免用户误触。
  Menu.setApplicationMenu(null)

  // webview 内任何 window.open 都走外部浏览器
  app.on('web-contents-created', (_, contents) => {
    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(d => {
        shell.openExternal(d.url)
        return { action: 'deny' }
      })
    }
  })

  sjtuSession() // 预热持久化 session
  setSession(sjtuSession()) // 云盘 API 使用 Electron session（走系统代理）
  setCanvasSession(sjtuSession()) // Canvas 使用同一个持久化 session（共享 jAccount 登录态）

  // ─── 会话持久化与启动恢复（R1-F1, R1-F3） ───
  // 异步恢复会话，绝不阻塞应用主窗口与图形界面首次渲染
  void (async () => {
    try {
      const hydAuth = await hydrateSjtuSession()
      console.log(
        '[startup] 会话恢复状态:',
        hydAuth.loggedIn
          ? `已登录 (${hydAuth.accountName || hydAuth.studentId})`
          : '未登录/需重新认证'
      )
    } catch (e) {
      console.error('[startup] 会话恢复失败（不阻塞启动）:', e)
    }
  })()
  // [2.7] Simplified emitter callback — removed dead `scalar` parameter
  setCanvasEmitter((channel, data) => {
    const w = getMainWindow()
    if (!w) return
    w.webContents.send(channel, data)
  })
  // [concurrency.ts 注入] 打破与 download-engine / window 的循环依赖：
  // - rendererEmit: 推 transfer:speed / download:concurrency-changed
  // - reschedule: 并发变化后调 scheduleNext + cloudScheduleNext
  // - hasActiveWork: 判断是否还有活跃任务（evalAutoConcurrency 用）
  // - isQuittingGetter: 退出守卫
  setRendererEmitter((channel, data) => {
    getMainWindow()?.webContents.send(channel, data)
  })
  setRescheduleCallback(() => {
    scheduleNext()
    cloudScheduleNext()
  })
  setHasActiveWorkGetter(() => sharedActiveCount() > 0 || pendingLocal.length > 0 || pendingCloud.length > 0)
  setIsQuittingGetter(() => getIsQuitting())
  // [Bug 37 Fix] 注入并发容量提供者，让 HLS 下载遵守全局并发限制
  setConcurrencyProvider(() => ({ active: sharedActiveCount(), concurrency: getConcurrency() }))
  // [Bug Fix] 注入 HLS 活跃计数回调：orchestrator 在获取槽位后增、下载结束后减，
  // 让 sharedActiveCount 把正在跑的 HLS 任务算进去，调度器才不会超发并发。
  setHlsActiveReporter((delta: number) => { setHlsActive(Math.max(0, getHlsActive() + delta)) })
  registerCanvasHandlers()

  // 好大学在线 (cnmooc.sjtu.cn) — 复用同一 persist:sjtu session（共享 jAccount 登录态）
  setCnmoocSession(sjtuSession())
  setCnmoocEmitter((channel, data) => {
    const w = getMainWindow()
    if (!w) return
    w.webContents.send(channel, data)
  })
  registerCnmoocHandlers()

  // 标题栏按钮颜色跟随主题
  ipcMain.handle('app:set-theme', (_e, theme: 'dark' | 'light') => {
    // 标题栏已改用自绘按钮（无 titleBarOverlay），setTitleBarOverlay 在无 overlay 时无效；
    // 保留 try/catch 以防旧版/其他平台行为差异。
    try {
      const w = getMainWindow()
      if (w && theme === 'light') {
        w.setTitleBarOverlay({ color: '#FFFFFF', symbolColor: '#1D2129', height: 36 })
      } else if (w) {
        w.setTitleBarOverlay({ color: '#121212', symbolColor: '#F5F5F5', height: 36 })
      }
    } catch { /* no titleBarOverlay configured — ignore */ }
    return { ok: true }
  })

  // ─── 自定义标题栏窗口控制（Mac 交通灯按钮 + renderer 自绘确认弹窗） ───
  // 弹窗逻辑在 renderer（Mac 风格 HTML modal），主进程只提供原子动作。
  // 原生 minimize 事件无法 preventDefault，故任务栏/Win+Down 最小化仍直接隐藏到托盘。
  // close 事件可 preventDefault：发 window:close-requested 给 renderer 弹确认窗，
  // renderer 选择后回调 window:minimize / window:cancel-and-quit / 不动。
  ipcMain.handle('window:minimize', () => { getMainWindow()?.hide(); return { ok: true } })
  ipcMain.handle('window:minimize-to-taskbar', () => { minimizeToTaskbar(); return { ok: true } })
  /** 直接退出（无下载时用）：不取消下载，cleanupOnQuit 统一回收句柄 */
  ipcMain.handle('window:quit', () => { setIsQuitting(true); app.quit(); return { ok: true } })
  /** 取消所有下载并退出（有下载时用户选"取消下载并退出"） */
  ipcMain.handle('window:cancel-and-quit', () => {
    cancelAll()
    cloudCancelAll()
    setIsQuitting(true)
    app.quit()
    return { ok: true }
  })
  /** 查询是否有进行中任务（renderer 据此决定是否弹确认窗） */
  ipcMain.handle('window:has-ongoing-tasks', () => ({ ongoing: hasOngoingTasks() }))
  ipcMain.handle('window:toggle-maximize', () => {
    const w = getMainWindow()
    if (w) {
      if (w.isMaximized()) w.unmaximize()
      else w.maximize()
    }
    return { ok: true }
  })
  ipcMain.handle('window:is-maximized', () => ({ maximized: !!getMainWindow()?.isMaximized() }))

  ipcMain.handle('app:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择本地下载目录'
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  /** 启动清理残留文件：渲染端 App 启动时调一次，传持久化的 localDestRoot。
   *  清 cloud-only 临时根 / tmpdir 应用子目录 / PPT 图片临时目录 / localDestRoot 半下载 .part+孤立.ts。
   *  失败不阻塞（返回 ok，错误仅记日志）。 */
  ipcMain.handle('app:cleanup-stale-downloads', (_e, localDestRoot?: string): { ok: boolean } => {
    try {
      cleanupStaleDownloads(localDestRoot || undefined)
    } catch (e) {
      console.error('[startup] 清理残留文件失败（不阻塞）:', e)
    }
    return { ok: true }
  })

  /** 弹出系统通知（下载完成提醒）。
   *  Windows 下 Notification 自带应用名，icon 用应用图标增强辨识度。
   *  点击通知聚焦主窗口（最小化到托盘时尤其有用）。 */
  ipcMain.handle(
    'app:notify',
    async (_e, payload: { title: string; body: string }): Promise<{ ok: boolean }> => {
      try {
        const n = new Notification({
          title: payload.title,
          body: payload.body,
          icon: nativeImage.createFromPath(resolveAppIcon()),
          silent: false
        })
        n.on('click', () => showMainWindow())
        n.show()
        return { ok: true }
      } catch {
        return { ok: false }
      }
    }
  )

  // ─── 自动更新事件推送：update:progress / update:ready / update:failed ───
  // getMainWindow() 可能已销毁（退出期），内部判空 no-op。
  function emitUpdate(channel: string, payload: unknown): void {
    const w = getMainWindow()
    if (w && !w.isDestroyed()) {
      w.webContents.send(channel, payload)
    }
  }
  setUpdateEmitter(emitUpdate)

  // ─── 新版本检查（主进程请求 GitHub，绕开渲染端 CSP 限制） ───
  // 渲染端 CSP connect-src 只允许 SJTU 域名，无法直连 api.github.com，
  // 故由主进程用 node:https 拉取 releases/latest，结果经 IPC 给渲染端 TitleBar 徽章。
  // 同时从 assets[] 匹配当前平台安装器，写入 result.asset 供应用内自动下载安装。
  ipcMain.handle('app:check-update', async (): Promise<UpdateCheckResult> => {
    const current = app.getVersion()
    // 1h 节流：避免每次 TitleBar mount 都打 GitHub API（限流 60 次/h 未认证）
    if (_updateCache && Date.now() - _updateCache.ts < UPDATE_CHECK_TTL) {
      return _updateCache.result
    }
    const fail = (error: string): UpdateCheckResult => ({
      hasUpdate: false, currentVersion: current, latestVersion: null, releaseUrl: null, releaseNotes: null, asset: null, error
    })
    try {
      const json = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const req = httpsRequest(
          {
            method: 'GET',
            hostname: 'api.github.com',
            path: `/repos/${UPDATE_REPO}/releases/latest`,
            headers: {
              'User-Agent': `sjtu-downloader/${current}`,
              Accept: 'application/vnd.github+json'
            },
            timeout: 5000
          },
          resp => {
            if (resp.statusCode !== 200) {
              reject(new Error(`HTTP ${resp.statusCode}`))
              resp.resume()
              return
            }
            let body = ''
            resp.setEncoding('utf8')
            resp.on('data', (chunk: string) => { body += chunk })
            resp.on('end', () => {
              try { resolve(JSON.parse(body) as Record<string, unknown>) }
              catch { reject(new Error('JSON 解析失败')) }
            })
          }
        )
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(new Error('timeout')) })
        req.end()
      })
      const tag = typeof json.tag_name === 'string' ? json.tag_name.replace(/^v/, '') : ''
      if (!tag) {
        const r = fail('响应缺少 tag_name')
        _updateCache = { result: r, ts: Date.now() }
        return r
      }
      const result: UpdateCheckResult = {
        hasUpdate: isNewerVersion(tag, current),
        currentVersion: current,
        latestVersion: tag,
        releaseUrl: typeof json.html_url === 'string' ? json.html_url : `https://github.com/${UPDATE_REPO}/releases/latest`,
        releaseNotes: typeof json.body === 'string' ? json.body.slice(0, 500) : null,
        asset: matchAsset(json.assets)
      }
      _updateCache = { result, ts: Date.now() }
      return result
    } catch (err) {
      // 网络失败静默返回 hasUpdate:false，不打扰用户
      const r = fail(err instanceof Error ? err.message : String(err))
      _updateCache = { result: r, ts: Date.now() }
      return r
    }
  })

  // ─── 打开外部 URL（限于 GitHub 或交大云盘域，防任意 URL 打开） ───
  ipcMain.handle('app:open-external', (_e, url: string): { ok: boolean } => {
    if (typeof url !== 'string' || (!url.startsWith('https://github.com/') && !url.startsWith('https://pan.sjtu.edu.cn/'))) {
      return { ok: false }
    }
    void shell.openExternal(url)
    return { ok: true }
  })

  // ─── 本地文件/文件夹在资源管理器中打开/定位 ───
  ipcMain.handle('app:show-in-folder', (_e, fullPath: string): { ok: boolean } => {
    if (typeof fullPath !== 'string' || !fullPath.trim()) return { ok: false }
    try {
      shell.showItemInFolder(fullPath)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle('app:open-path', async (_e, fullPath: string): Promise<{ ok: boolean; error?: string }> => {
    if (typeof fullPath !== 'string' || !fullPath.trim()) return { ok: false, error: '路径为空' }
    try {
      const err = await shell.openPath(fullPath)
      if (err) return { ok: false, error: err }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ─── 应用内自动更新：下载 / 安装 / 取消（asset 取 check-update 缓存） ───
  // 下载安装包到 temp → 安装时 spawn 安装器并 app.quit 释放文件锁，详见 updater.ts
  ipcMain.handle('app:download-update', (): { ok: boolean; error?: string } => {
    const asset = _updateCache?.result.asset
    if (!asset) return { ok: false, error: '当前平台无可用安装包，请前往 GitHub 手动下载' }
    return downloadUpdate(asset)
  })
  ipcMain.handle('app:install-update', (): { ok: boolean; error?: string } => installUpdate())
  ipcMain.handle('app:cancel-update', (): { ok: boolean } => { cancelUpdate(); return { ok: true } })

  ipcMain.handle('auth:set-jwt-token', (_e, token: string | null, userInfo?: { name?: string; studentId?: string }) => {
    setJwtToken(token, userInfo)
    return { ok: true }
  })
  ipcMain.handle('auth:logout', async () => {
    clearAuthState()
    clearCachedCredentials()
    await clearSjtuSession()
    return { loggedIn: false, checkedAt: new Date().toISOString() }
  })
  ipcMain.handle('auth:clear', async () => {
    clearAuthState()
    clearCachedCredentials()
    await clearSjtuSession()
    return { loggedIn: false, checkedAt: new Date().toISOString() }
  })
  ipcMain.handle('auth:status', async (_e, force?: boolean) => {
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

  ipcMain.handle('auth:exchange-code', async (_e, code: string) => {
    if (!code) return { success: false }
    const token = await exchangeVsjtuJwtByCode(code)
    return { success: !!token, token }
  })

  ipcMain.handle('vsjtu:scan-audit', async (_e, pageNo = 1, pageSize = 100) => {
    // 类似于好大学在线的 ensureCnmoocLogin，发起扫描前主动确保持有有效 JWT
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

  ipcMain.handle('vsjtu:audit-course-detail', async (_e, resourceId: number) => {
    await ensureVsjtuLogin()
    const r = await vsjtuFetch(V_SJTU_API.auditCourseDetail, {
      method: 'POST',
      body: { resourceId }
    })
    return r
  })


  ipcMain.handle(
    'download:start',
    async (
      _e,
      destRoot: string,
      specs: DownloadTaskSpec[],
      options?: { mode?: DownloadMode; localDestRoot?: string; conflictStrategy?: FileConflictStrategy; namingTemplate?: string }
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        // [2.1] IPC input validation: bound batch size, validate spec array
        const MAX_SPECS_PER_BATCH = 5000
        if (!Array.isArray(specs) || specs.length === 0) {
          return { ok: false, error: 'specs 不能为空' }
        }
        if (specs.length > MAX_SPECS_PER_BATCH) {
          return { ok: false, error: `specs 数量超出上限（${MAX_SPECS_PER_BATCH}）` }
        }
        for (const spec of specs) {
          if (!spec.taskId || !spec.fileName) {
            return { ok: false, error: 'spec 缺少 taskId 或 fileName' }
          }
        }

        const mode: DownloadMode = options?.mode
          ?? (specs.some(s => s.cloudUserToken) ? 'cloud' : 'local')

        const cloudToken = getCachedUserToken()

        // [Bug Fix] 前置校验：所选下载模式的前置条件必须满足，否则明确报错。
        // 原先 mode='cloud' 且未连云盘时，本地分支因 mode 不匹配跳过、云端分支因
        // `&& cloudToken` 跳过，导致 0 入队却返回 {ok:true}，渲染端 spec 永远停在 pending。
        if ((mode === 'cloud' || mode === 'both') && !cloudToken) {
          return {
            ok: false,
            error: mode === 'both'
              ? '当前为「本地 + 云盘」模式，但未连接交大云盘，请先连接云盘或切换为仅本地下载'
              : '当前为云盘模式，但未连接交大云盘，请先连接云盘或切换为本地下载'
          }
        }
        if ((mode === 'local' || mode === 'both') && !(options?.localDestRoot || destRoot)) {
          return { ok: false, error: '请先选择本地下载目录' }
        }

        // ─── 本地下载 ───
        if (mode === 'local' || mode === 'both') {
          const root = options?.localDestRoot || destRoot
          if (!root) throw new Error('请先选择本地下载目录')

          // 区分 Canvas 课程 / 好大学在线 / 旁听课程的下载路径
          const isCanvas = specs.some(s => isCanvasSpec(s))
          const isCnmooc = specs.some(s => isCnmoocSpec(s))
          const localBase = isCnmooc ? join(root, CNMOOC_LOCAL_DIR)
            : isCanvas ? join(root, 'Canvas课程')
            : join(root, CLOUD_ROOT_FOLDER)
          mkdirSync(localBase, { recursive: true })

          // 首次下载时在目录写入说明文件
          // 用 'wx' 独占创建：已存在则 EEXIST 忽略，消除 existsSync→writeFileSync 的 TOCTOU
          const readmePath = join(localBase, '下载说明.txt')
          try {
            writeFileSync(readmePath, [
              '下载说明',
              '========',
              '',
              '本目录下的 .part 文件是下载过程中的临时文件，支持会话内断点续传',
              '（暂停→恢复不重下）。每次打开应用时会自动清理上次会话残留的 .part',
              '和 remux 失败的孤立 .ts 文件，释放本地空间——因此跨重启不再续传，',
              '如需重下直接发起即可。',
              '',
              '已下载完成的 .mp4 视频不会被清理，可放心保留。',
              '',
              '—— 上海交大课程下载器',
              ''
            ].join('\n'), { encoding: 'utf-8', flag: 'wx' })
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
          }
          for (const spec of specs) {
            // PERF: O(1) duplicate-check via index Sets instead of O(n) .some() scans
            if (tasks.has(spec.taskId)) {
              const st = tasks.get(spec.taskId)!.state
              if (st === 'pending' || st === 'downloading' || st === 'paused') continue
            }
            if (pendingLocalIds.has(spec.taskId)) continue
            if (pausedLocalIds.has(spec.taskId)) continue
            const relPath = formatPathFromTemplate(options?.namingTemplate || '', {
              term: spec.term,
              course: effectiveCourseName(spec),
              fileName: spec.fileName
            })
            const filePath = join(localBase, ...relPath.split('/'))
            const partPath = filePath + '.part'
            pendingLocal.push({ spec: { ...spec, cloudUserToken: undefined }, filePath, partPath })
            pendingLocalIds.add(spec.taskId)
            if (options?.conflictStrategy) conflictStrategyByTask.set(spec.taskId, options.conflictStrategy)
            if (getAutoConcurrency()) startAutoConcurrency()
            emitProgress({ taskId: spec.taskId, state: 'pending', received: 0, total: 0 })
          }
          scheduleNext()
        }

        // ─── 云盘上传 ───
        if ((mode === 'cloud' || mode === 'both') && cloudToken) {
          const cloudSpecs = mode === 'both'
            ? specs.map(s => ({ ...s, taskId: s.taskId + '_cloud', cloudUserToken: cloudToken }))
            : specs.map(s => ({ ...s, cloudUserToken: cloudToken }))
          for (const spec of cloudSpecs) {
            // PERF: O(1) duplicate-check via index Sets instead of O(n) .some() scans
            if (cloudTasks.has(spec.taskId)) {
              const st = cloudTasks.get(spec.taskId)!.state
              if (st === 'pending' || st === 'downloading' || st === 'paused') continue
            }
            if (pendingCloudIds.has(spec.taskId)) continue
            if (pausedCloudIds.has(spec.taskId)) continue
            pendingCloud.push(spec)
            pendingCloudIds.add(spec.taskId)
            if (options?.conflictStrategy) conflictStrategyByTask.set(spec.taskId, options.conflictStrategy)
            if (getAutoConcurrency()) startAutoConcurrency()
            emitProgress({ taskId: spec.taskId, state: 'pending', received: 0, total: 0 })
          }
          cloudScheduleNext()
        }

        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: msg.slice(0, 300) }
      }
    }
  )

  ipcMain.handle('download:pause', (_e, id: string) => {
    // 任务可能在本地或云端任一队列（pending/paused/active），两端都尝试，各自对找不到的 id 安全 return
    pauseTask(id)
    cloudPauseTask(id)
    return { ok: true }
  })
  ipcMain.handle('download:cancel', (_e, id: string) => {
    cancelTask(id)
    cloudCancelTask(id)
    return { ok: true }
  })
  ipcMain.handle('download:resume', (_e, id: string) => {
    resumeTask(id)
    cloudResumeTask(id)
    return { ok: true }
  })
  ipcMain.handle('download:pause-all', () => {
    pauseAll(); cloudPauseAll()
    return { ok: true }
  })
  ipcMain.handle('download:cancel-all', () => {
    cancelAll(); cloudCancelAll()
    return { ok: true }
  })
  ipcMain.handle('download:resume-all', () => {
    resumeAll(); cloudResumeAll()
    return { ok: true }
  })
  ipcMain.handle('download:set-concurrency', (_e, n: number) => {
    if (n === 0) {
      // 自动并发模式
      setAutoConcurrency(true)
      setConcurrency(3)
      startAutoConcurrency()
    } else {
      setAutoConcurrency(false)
      stopAutoConcurrency()
      setConcurrency(Math.max(2, Math.min(16, Math.floor(Number(n)) || 3)))
    }
    scheduleNext()
    cloudScheduleNext()
    return { ok: true, concurrency: getConcurrency(), auto: getAutoConcurrency() }
  })
  ipcMain.handle('download:set-speed-limit', (_e, limitKBps: number) => {
    globalSpeedLimiter.setLimitKBps(limitKBps || 0)
    return { ok: true }
  })

  // ─── 交大云盘 (pan.sjtu.edu.cn) 认证 ────────────────────────

  ipcMain.handle('cloudpan:get-cached-token', () => getCachedUserToken())

  // [Bug Fix] 启动恢复：渲染端把 localStorage 持久化的 UserToken 同步给 main 缓存。
  // main 的 cachedToken 是内存变量、重启即丢；不同步会导致 UI 显示"已连接"但下载时
  // getCachedUserToken() 返回 null。与 auth:set-jwt-token 同模式，token 由 main 持有。
  ipcMain.handle('cloudpan:set-cached-token', (_e, token: string | null) => {
    setCachedUserToken(token)
    saveSessionStore({ cloudUserToken: token ?? undefined })
    return { ok: true }
  })

  // [2.2] validate-token and space-info use main-process cached token only.
  // The renderer should not send the raw token — we use getCachedUserToken() instead.
  ipcMain.handle('cloudpan:validate-token', async () => {
    const userToken = getCachedUserToken()
    if (!userToken) return { ok: false, error: '未登录云盘' }
    return validateUserToken(userToken)
  })

  ipcMain.handle('cloudpan:space-info', async () => {
    const userToken = getCachedUserToken()
    if (!userToken) return { ok: false, error: '未登录云盘' }
    try {
      const info = await getSpaceInfo(userToken)
      return { ok: true, info }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '获取空间信息失败' }
    }
  })

  ipcMain.handle('cloudpan:logout', () => {
    clearCachedCredentials()
    saveSessionStore({ cloudUserToken: undefined })
    return { ok: true }
  })

  // ─── 交大云盘资源管理器与文件操作 ─────────────────────────

  ipcMain.handle(
    'cloudpan:list-dir',
    async (_e, dirPath: string[] = [], page = 1, pageSize = 100) => {
      const userToken = getCachedUserToken()
      if (!userToken) return { ok: false, error: '未登录云盘' }
      try {
        const data = await listDirectoryContents(userToken, dirPath, page, pageSize)
        return { ok: true, data }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : '获取目录列表失败' }
      }
    }
  )

  ipcMain.handle(
    'cloudpan:create-dir',
    async (_e, dirPath: string[]) => {
      const userToken = getCachedUserToken()
      if (!userToken) return { ok: false, error: '未登录云盘' }
      try {
        await createDirectory(userToken, dirPath)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : '创建目录失败' }
      }
    }
  )

  ipcMain.handle(
    'cloudpan:delete-item',
    async (_e, targetPath: string[], isDir: boolean) => {
      const userToken = getCachedUserToken()
      if (!userToken) return { ok: false, error: '未登录云盘' }
      try {
        await deleteCloudItem(userToken, targetPath, isDir)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : '删除失败' }
      }
    }
  )

  ipcMain.handle(
    'cloudpan:rename-item',
    async (_e, oldPath: string[], newName: string, isDir: boolean) => {
      const userToken = getCachedUserToken()
      if (!userToken) return { ok: false, error: '未登录云盘' }
      try {
        await renameCloudItem(userToken, oldPath, newName, isDir)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : '重命名失败' }
      }
    }
  )

  ipcMain.handle(
    'cloudpan:get-download-url',
    async (_e, filePath: string[]) => {
      const userToken = getCachedUserToken()
      if (!userToken) return { ok: false, error: '未登录云盘' }
      try {
        const url = await getFileDownloadUrl(userToken, filePath)
        return { ok: true, url }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : '获取下载链接失败' }
      }
    }
  )

  /** 利用已有的 jAccount session 直接完成 pan SSO 登录。
   *  用隐藏 BrowserWindow 加载 pan → 点击"jAccount登录" → SSO 自动跳转 → 拿 UserToken cookie。 */
  ipcMain.handle('cloudpan:direct-login', async () => {
    const ses = sjtuSession()
    try {
      // [R3-F3] 优先复用已有有效 USER_TOKEN (内存缓存 -> 持久化缓存 -> Cookie 缓存)，避免多余的 SSO 弹窗
      const cachedToken = getCachedUserToken() || loadSessionStoreRaw()?.cloudUserToken
      if (cachedToken && cachedToken.length >= 32) {
        const valid = await validateUserToken(cachedToken)
        if (valid.ok) {
          setCachedUserToken(cachedToken)
          saveSessionStore({ cloudUserToken: cachedToken })
          return { ok: true, userToken: cachedToken }
        }
      }

      const existingCookies = await ses.cookies.get({ url: 'https://pan.sjtu.edu.cn' })
      const existingUt = existingCookies.find(c => c.name === 'USER_TOKEN' && c.value && c.value.length >= 32)
        || (await ses.cookies.get({ domain: 'sjtu.edu.cn' })).find(c => c.name === 'USER_TOKEN' && c.value && c.value.length >= 32)
      if (existingUt) {
        const valid = await validateUserToken(existingUt.value)
        if (valid.ok) {
          setCachedUserToken(existingUt.value)
          saveSessionStore({ cloudUserToken: existingUt.value })
          return { ok: true, userToken: existingUt.value }
        }
      }

      const jaCookies = await ses.cookies.get({ domain: 'jaccount.sjtu.edu.cn' })
      if (jaCookies.length === 0) {
        return { ok: false, error: 'jAccount 未登录，请先登录 v.sjtu' }
      }

      const win = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true }
      })

      try {
        await win.loadURL('https://pan.sjtu.edu.cn').catch(e => {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg.includes('ERR_CONNECTION_TIMED_OUT') || msg.includes('ETIMEDOUT')) {
            throw new Error('网络连接超时，请检查是否已连接校园网或交大 VPN')
          }
          throw e
        })
        await new Promise(r => setTimeout(r, 2000))

        // [R3-F3] 点击 SSO 登录按钮：精准定位交大云盘真实的登录按钮
        await win.webContents.executeJavaScript(`
          (function() {
            var btn = document.querySelector('.linear-gradient-btn');
            if (btn) { btn.click(); return; }
            var buttons = document.querySelectorAll('button');
            for (var i = 0; i < buttons.length; i++) {
              if (buttons[i].textContent.includes('jAccount登录')) {
                buttons[i].click();
                return;
              }
            }
          })()
        `)

        // 轮询 USER_TOKEN cookie
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 500))
          const cookies = await ses.cookies.get({ url: 'https://pan.sjtu.edu.cn' })
          const ut = cookies.find(c => c.name === 'USER_TOKEN' && c.value && c.value.length >= 32)
            || (await ses.cookies.get({ domain: 'sjtu.edu.cn' })).find(c => c.name === 'USER_TOKEN' && c.value && c.value.length >= 32)
          if (ut) {
            setCachedUserToken(ut.value)
            saveSessionStore({ cloudUserToken: ut.value })
            return { ok: true, userToken: ut.value }
          }
        }

        return { ok: false, error: 'SSO 超时' }
      } finally {
        if (!win.isDestroyed()) {
          win.destroy()
        }
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '登录失败' }
    }
  })

  createMainWindow()
  createTray()
  startSpeedTicker()

  // 恢复上次退出前未完成的任务队列
  const { restoredCount } = loadQueueState()
  if (restoredCount > 0) {
    scheduleNext()
    cloudScheduleNext()
  }

  // 系统深浅主题切换 → 同步窗口/托盘图标 (深色主题用浅色logo, 浅色主题用深色logo)
  nativeTheme.on('updated', applyThemeIcons)

  app.on('activate', () => {
    // macOS dock 点击：有窗口则显示，无则重建
    showMainWindow()
  })

  // 标记应用启动与主窗口就绪，解除启动期 window-all-closed 保护
  isAppReady = true
})

/** 退出前清理：销毁所有活跃的 HTTP 请求、文件流、定时器。
 *  同时将任务状态置为 cancelled，确保重试定时器回调时能正确退出。 */
function cleanupOnQuit(): void {
  setIsQuitting(true)

  // 退出前将待处理与暂停的任务保存到本地用户数据目录
  saveQueueState()

  // 中止自动更新下载并清理临时文件（installing=true 即安装已 spawn 时 no-op，
  // 避免删掉 NSIS 安装器正在使用的临时 .exe）
  cancelUpdate()

  // 杀死所有 ffmpeg 子进程，防止残留
  killAllFfmpeg()

  // 清除 vod channels 缓存（释放内存、丢弃 token 关联结果）
  clearVodChannelsCache()

  // 清除 ExternalTool 模块视频的课程级 LTI token 缓存
  clearExtToolTokenCache()

  // 重置 vshare 登录态标志（vshare 域 cookie 随会话清除）
  invalidateVshareLogin()
  // [B5 Fix] 同步重置 cnmooc/canvas SSO 标志
  invalidateCnmoocLogin()
  invalidateCanvasLogin()

  // 清除 cnmooc 会话 cookie 缓存（释放内存）
  cnmoocCookiesByTask.clear()

  // 清除云盘全量重试计数（释放内存）
  cloudFullRetries.clear()

  // 清除自动并发定时器
  stopAutoConcurrency()

  // 清除速度推送定时器
  stopSpeedTicker()

  // 销毁系统托盘
  destroyTray()

  // 清除网络恢复定时器
  stopNetworkResumeTimer()

  // 销毁所有本地下载任务的活跃连接和文件流
  for (const [, t] of tasks) {
    if (t.state === 'downloading' || t.state === 'pending') {
      t.state = 'cancelled'
      destroyLocalHandles(t, 'app quit')
      // [Bug Fix] 推送 cancelled 进度，避免渲染端残留"下载中"陈旧态。
      // 退出时 getMainWindow() 可能已销毁，emitProgress 内部对 getMainWindow() 为空做 no-op，安全。
      emitProgress({ taskId: t.spec.taskId, state: 'cancelled', received: t.received, total: t.total, message: '应用退出' })
    }
  }

  // 销毁所有云盘上传任务的活跃连接
  for (const [, t] of cloudTasks) {
    if (t.state === 'downloading' || t.state === 'pending') {
      t.state = 'cancelled'
      destroyCloudHandles(t, 'app quit')
      t.uploader = undefined
      emitProgress({ taskId: t.spec.taskId, state: 'cancelled', received: t.received, total: t.total, message: '应用退出' })
    }
  }

  // 释放所有任务引用与待处理队列，允许 GC 回收
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
  // 必须确保初始化已完成且主窗口已建立，
  // 避免启动期后台静默探测窗口（如 refreshJwtToken / SSO 检查）销毁时误判"全部窗口已关闭"
  if (!isAppReady) return
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  cleanupOnQuit()
})
