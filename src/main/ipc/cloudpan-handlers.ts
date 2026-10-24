import { BrowserWindow, ipcMain } from 'electron'
import {
  getCachedUserToken,
  setCachedUserToken,
  clearCachedCredentials,
  validateUserToken,
  getSpaceInfo,
  listDirectoryContents,
  createDirectory,
  deleteCloudItem,
  renameCloudItem,
  getFileDownloadUrl
} from '../cloudpan'
import {
  downloadCloudFile,
  uploadCloudFiles,
  openCloudInBrowser
} from '../cloudpan-transfer'
import { saveSessionStore, loadSessionStoreRaw } from '../auth'
import { sjtuSession } from '../session'

/**
 * 注册交大云盘 (pan.sjtu.edu.cn) 所有 IPC 通道 (cloudpan:*)
 */
export function registerCloudPanHandlers(): void {
  ipcMain.handle('cloudpan:get-cached-token', () => getCachedUserToken())

  ipcMain.handle('cloudpan:set-cached-token', (_e, token: string | null) => {
    setCachedUserToken(token)
    saveSessionStore({ cloudUserToken: token ?? undefined })
    return { ok: true }
  })

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

  ipcMain.handle(
    'cloudpan:download-file',
    async (_e, remotePath: string[], targetDir?: string) => {
      return downloadCloudFile(remotePath, targetDir)
    }
  )

  ipcMain.handle(
    'cloudpan:upload-files',
    async (_e, targetDirPath: string[] = []) => {
      return uploadCloudFiles(targetDirPath)
    }
  )

  ipcMain.handle(
    'cloudpan:open-web',
    async (_e, remotePath: string[] = []) => {
      return openCloudInBrowser(remotePath)
    }
  )

  /**
   * 利用已有的 jAccount session 直接完成 pan SSO 登录。
   * 用隐藏 BrowserWindow 加载 pan → 点击"jAccount登录" → SSO 自动跳转 → 拿 UserToken cookie。
   */
  ipcMain.handle('cloudpan:direct-login', async () => {
    const ses = sjtuSession()
    try {
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
        return { ok: false, error: 'jAccount 未登录，请先登录' }
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
}
