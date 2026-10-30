import {
  app,
  dialog,
  ipcMain,
  nativeImage,
  Notification,
  shell
} from 'electron'
import { join, extname, normalize } from 'node:path'
import { tmpdir } from 'node:os'
import { request as httpsRequest } from 'node:https'
import type {
  UpdateCheckResult,
  PrivateWorkerTunnelConfig,
  PrivateWorkerTaskPayload
} from '../../shared/types'
import { cancelAll } from '../download-engine/local'
import { cloudCancelAll } from '../download-engine/cloud'
import { hasOngoingTasks } from '../download-engine/shared'
import { cleanupStaleDownloads } from '../cleanup'
import { checkpointBackupBeforeQuit, getBackupCatalog } from '../backup/runtime'
import {
  matchAsset,
  downloadUpdate,
  cancelUpdate,
  installUpdate,
  setUpdateEmitter
} from '../updater'
import { isSafeExternalUrl, isNewerVersion } from '../../shared/utils'
import {
  listMaskedCredentials,
  saveCredential,
  updateCredentialLabel,
  deleteCredential,
  clearAllCredentials,
  getCredentialForFill,
  saveWorkerAuthToken,
  getWorkerAuthToken
} from '../credentials'
import {
  testPrivateWorker,
  dispatchPrivateWorkerTask,
  getEmbeddedDevWorkerUrl
} from '../private-worker'
import {
  startSshTunnel,
  stopSshTunnel,
  getSshTunnelStatus
} from '../ssh-tunnel'
import {
  getMainWindow,
  minimizeToTaskbar,
  hideToTray,
  setIsQuitting,
  resolveAppIcon,
  showMainWindow
} from '../window'

// ─── 新版本检查配置 ───
const UPDATE_REPO = 'sunalan2025/sjtu-downloader-all-in-one'
const UPDATE_CHECK_TTL = 60 * 60 * 1000 // 1h 节流，避免触发 GitHub 未认证 60 次/h 限流
let _updateCache: { result: UpdateCheckResult; ts: number } | null = null

import { validateIpcSender, DEFAULT_UNTRUSTED_IPC_ERROR } from '../utils/ipc-guard'
export { validateIpcSender, DEFAULT_UNTRUSTED_IPC_ERROR }

/**
 * 注册应用基础设施、窗口控制、自动更新、凭据保险库与私有中转相关 IPC 通道
 */
export function registerAppHandlers(): void {
  // 自动更新事件推送绑定
  setUpdateEmitter((channel: string, payload: unknown) => {
    const w = getMainWindow()
    if (w && !w.isDestroyed()) {
      w.webContents.send(channel, payload)
    }
  })

  // 标题栏按钮颜色跟随主题
  ipcMain.handle('app:set-theme', (_e, theme: 'dark' | 'light') => {
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

  // ─── 自定义标题栏窗口控制 ───
  ipcMain.handle('window:minimize', () => { hideToTray(); return { ok: true } })
  ipcMain.handle('window:minimize-to-taskbar', () => { minimizeToTaskbar(); return { ok: true } })
  ipcMain.handle('window:quit', () => { setIsQuitting(true); app.quit(); return { ok: true } })
  ipcMain.handle('window:cancel-and-quit', () => {
    cancelAll()
    cloudCancelAll()
    setIsQuitting(true)
    app.quit()
    return { ok: true }
  })
  ipcMain.handle('window:has-ongoing-tasks', () => ({ ongoing: hasOngoingTasks() }))
  ipcMain.handle('window:pause-and-quit', () => {
    checkpointBackupBeforeQuit()
    setIsQuitting(true)
    app.quit()
    return { ok: true }
  })
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

  ipcMain.handle('app:cleanup-stale-downloads', (event, localDestRoot?: unknown): { ok: boolean; error?: string } => {
    if (getBackupCatalog()?.storageError) return { ok: false, error: '资源清单读取异常，已暂停清理以保护未完成文件' }
    if (!validateIpcSender(event)) {
      return { ok: false, error: '安全拦截：拒绝来自未受信任来源的高权限系统调用' }
    }
    if (localDestRoot !== undefined && (typeof localDestRoot !== 'string' || localDestRoot.includes('\0'))) {
      return { ok: false, error: '路径参数包含非法字符' }
    }
    try {
      const protectedPaths = getBackupCatalog()?.protectedPaths()
      const dest = typeof localDestRoot === 'string' ? localDestRoot : undefined
      if (protectedPaths) {
        cleanupStaleDownloads(dest, protectedPaths)
      } else {
        cleanupStaleDownloads(dest)
      }
    } catch (e) {
      console.error('[startup] 清理残留文件失败（不阻塞）:', e)
    }
    return { ok: true }
  })

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

  // ─── 新版本检查（主进程请求 GitHub，绕开渲染端 CSP 限制） ───
  ipcMain.handle('app:check-update', async (): Promise<UpdateCheckResult> => {
    const current = app.getVersion()
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
      const r = fail(err instanceof Error ? err.message : String(err))
      _updateCache = { result: r, ts: Date.now() }
      return r
    }
  })

  // ─── 打开外部 URL ───
  ipcMain.handle('app:open-external', async (event, url: string): Promise<{ ok: boolean; error?: string }> => {
    if (!validateIpcSender(event)) {
      return { ok: false, error: DEFAULT_UNTRUSTED_IPC_ERROR }
    }
    if (!isSafeExternalUrl(url)) {
      return { ok: false, error: '仅支持打开合法的 HTTP/HTTPS 网页链接' }
    }
    try {
      await shell.openExternal(url.trim())
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 本地文件/文件夹在资源管理器中打开/定位 ───
  ipcMain.handle('app:show-in-folder', (event, fullPath: unknown): { ok: boolean; error?: string } => {
    if (!validateIpcSender(event)) {
      return { ok: false, error: '安全拦截：拒绝来自未受信任来源的高权限系统调用' }
    }
    if (typeof fullPath !== 'string' || !fullPath.trim() || fullPath.includes('\0')) {
      return { ok: false, error: '路径参数包含非法字符' }
    }
    try {
      shell.showItemInFolder(fullPath)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle('app:get-default-downloads-dir', (): string => {
    try {
      return app.getPath('downloads')
    } catch {
      return join(tmpdir(), 'downloads')
    }
  })

  ipcMain.handle('app:open-path', async (event, fullPath?: unknown): Promise<{ ok: boolean; error?: string }> => {
    if (!validateIpcSender(event)) {
      return { ok: false, error: DEFAULT_UNTRUSTED_IPC_ERROR }
    }
    if (fullPath !== undefined && (typeof fullPath !== 'string' || fullPath.includes('\0'))) {
      return { ok: false, error: '路径参数包含非法字符' }
    }
    let target = typeof fullPath === 'string' ? fullPath.trim() : ''
    if (!target) {
      try {
        target = app.getPath('downloads')
      } catch {
        target = app.getPath('home')
      }
    }
    const normalizedTarget = normalize(target)
    const ext = extname(normalizedTarget).toLowerCase()
    const DANGEROUS_EXTENSIONS = new Set([
      '.exe', '.bat', '.cmd', '.msi', '.ps1', '.vbs', '.vbe',
      '.js', '.jse', '.wsf', '.wsh', '.scr', '.com', '.pif',
      '.app', '.sh', '.bash', '.bin'
    ])
    if (ext && DANGEROUS_EXTENSIONS.has(ext)) {
      return { ok: false, error: '安全拦截：出于系统安全考虑，禁止直接打开可执行程序与脚本文件' }
    }
    try {
      const err = await shell.openPath(normalizedTarget)
      if (err) return { ok: false, error: err }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ─── 应用内自动更新：下载 / 安装 / 取消 ───
  ipcMain.handle('app:download-update', (): { ok: boolean; error?: string } => {
    const asset = _updateCache?.result.asset
    if (!asset) return { ok: false, error: '当前平台无可用安装包，请前往 GitHub 手动下载' }
    return downloadUpdate(asset)
  })
  ipcMain.handle('app:install-update', (): { ok: boolean; error?: string } => installUpdate())
  ipcMain.handle('app:cancel-update', (): { ok: boolean } => { cancelUpdate(); return { ok: true } })

  // ─── 安全凭据保险库 (Credentials Vault) ─────────────────────────
  ipcMain.handle('credentials:list', (event) => {
    if (!validateIpcSender(event)) {
      throw new Error('安全拦截：拒绝来自未受信任来源的高权限系统调用')
    }
    return listMaskedCredentials()
  })
  ipcMain.handle('credentials:save', (event, { username, password, label }) => {
    if (!validateIpcSender(event)) {
      throw new Error('安全拦截：拒绝来自未受信任来源的高权限系统调用')
    }
    return saveCredential(username, password, label)
  })
  ipcMain.handle('credentials:update-label', (event, { id, label }) => {
    if (!validateIpcSender(event)) {
      throw new Error('安全拦截：拒绝来自未受信任来源的高权限系统调用')
    }
    return updateCredentialLabel(id, label)
  })
  ipcMain.handle('credentials:delete', (event, id) => {
    if (!validateIpcSender(event)) {
      throw new Error('安全拦截：拒绝来自未受信任来源的高权限系统调用')
    }
    return deleteCredential(id)
  })
  ipcMain.handle('credentials:clear-all', (event) => {
    if (!validateIpcSender(event)) {
      throw new Error('安全拦截：拒绝来自未受信任来源的高权限系统调用')
    }
    return clearAllCredentials()
  })
  ipcMain.handle('credentials:get-fill-data', (event, id) => {
    if (!validateIpcSender(event)) {
      throw new Error('安全拦截：拒绝来自未受信任来源的高权限系统调用')
    }
    return getCredentialForFill(id)
  })
  ipcMain.handle('credentials:get-worker-token', (event) => {
    if (!validateIpcSender(event)) {
      throw new Error('安全拦截：拒绝来自未受信任来源的高权限系统调用')
    }
    return getWorkerAuthToken()
  })
  ipcMain.handle('credentials:save-worker-token', (event, token: string) => {
    if (!validateIpcSender(event)) {
      throw new Error('安全拦截：拒绝来自未受信任来源的高权限系统调用')
    }
    return saveWorkerAuthToken(token)
  })

  // ─── 校内私有中转服务探测与 SSH 隧道托管 ─────────────────────────
  ipcMain.handle(
    'private-worker:test',
    (event, payload?: { url?: string; token?: string; tunnel?: PrivateWorkerTunnelConfig }) => {
      if (!validateIpcSender(event)) {
        return { success: false, ok: false, error: '安全拦截：拒绝来自未受信任来源的高权限系统调用' }
      }
      const timeoutMs = payload?.tunnel?.enabled ? 8000 : 4000
      return testPrivateWorker(payload?.url || '', payload?.token, timeoutMs, payload?.tunnel)
    }
  )
  ipcMain.handle(
    'private-worker:dispatch-task',
    (event, payload: { url: string; task: PrivateWorkerTaskPayload; token?: string }) => {
      if (!validateIpcSender(event)) {
        return { ok: false, error: '安全拦截：拒绝来自未受信任来源的高权限系统调用' }
      }
      return dispatchPrivateWorkerTask(payload.url, payload.task, payload.token)
    }
  )
  ipcMain.handle('private-worker:get-dev-info', () => {
    return {
      isDev: !app.isPackaged,
      devWorkerUrl: getEmbeddedDevWorkerUrl()
    }
  })
  ipcMain.handle('ssh-tunnel:start', (event, config: PrivateWorkerTunnelConfig) => {
    if (!validateIpcSender(event)) {
      return { success: false, ok: false, error: '安全拦截：拒绝来自未受信任来源的高权限系统调用' }
    }
    return startSshTunnel(config)
  })
  ipcMain.handle('ssh-tunnel:stop', (event) => {
    if (!validateIpcSender(event)) {
      return { success: false, ok: false, error: '安全拦截：拒绝来自未受信任来源的高权限系统调用' }
    }
    return stopSshTunnel()
  })
  ipcMain.handle('ssh-tunnel:status', (event) => {
    if (!validateIpcSender(event)) {
      return { running: false, ok: false, error: '安全拦截：拒绝来自未受信任来源的高权限系统调用' }
    }
    return getSshTunnelStatus()
  })
}
