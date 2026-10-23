// 主窗口 + 系统托盘 + 主题图标
//
// mainWindow / isQuitting / tray 是跨模块共享状态：
// - mainWindow 被 emitProgress / emitUpdate / canvas/cnmooc emitter / window:* IPC 读取（getMainWindow）
// - isQuitting 被调度器 / AIMD / cleanup / IPC 读写（getIsQuitting / setIsQuitting）
// - tray 仅本模块内部用（createTray / destroyTray）
//
// 依赖 auth（托盘菜单显示账号）+ concurrency（托盘菜单显示速度）。

import { app, BrowserWindow, Menu, nativeImage, nativeTheme, shell, Tray } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { getAccountName, getStudentId } from './auth'
import { getSpeedEma } from './concurrency'
import { formatBytes, isSafeExternalUrl } from '../shared/utils'
import { THEME_TOKENS } from '../shared/theme'

let mainWindow: BrowserWindow | null = null
let isQuitting = false
let tray: Tray | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function getIsQuitting(): boolean {
  return isQuitting
}

export function setIsQuitting(v: boolean): void {
  isQuitting = v
}

/** 最小化到任务栏（不隐藏到系统托盘） */
export function minimizeToTaskbar(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) return
    mainWindow.minimize()
  }
}

let trayHintShown = false

/** 隐藏窗口到系统托盘（并提示气泡） */
export function hideToTray(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide()
    if (!trayHintShown && tray && process.platform === 'win32') {
      trayHintShown = true
      tray.displayBalloon({
        iconType: 'info',
        title: 'SJTU 课程下载器',
        content: '已最小化到系统托盘，下载将继续在后台进行。点击托盘图标可恢复窗口。'
      })
    }
  }
}

/** 应用窗口图标路径。dev 下从项目 build/icons 解析；打包后从 extraResources(icons) 解析。
 *  PNG 跨平台可用；Windows 打包后任务栏图标取自 exe (win.icon)，此处主要用于
 *  开发期窗口图标与 Linux 窗口装饰。
 *
 *  跟随系统深浅主题: 深色主题 (shouldUseDarkColors) 任务栏为深底 → 用浅色 logo
 *  (icons/light/); 浅色主题 → 用深色 logo (icons/)。两版均透明背景+圆角, 在对应底色上可见。
 *  .exe / 安装包图标为编译时嵌入的深色 icon.ico, 运行时无法切换, 保持深色默认。 */
export function resolveAppIcon(): string {
  const sub = nativeTheme.shouldUseDarkColors ? 'light' : ''
  return is.dev
    ? join(app.getAppPath(), 'build', 'icons', sub, '256.png')
    : join(process.resourcesPath, 'icons', sub, '256.png')
}

export function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    show: true,
    center: true,
    autoHideMenuBar: true,
    icon: resolveAppIcon(),
    backgroundColor: THEME_TOKENS.dark.surface.base,
    // macOS 用 hiddenInset：保留原生交通灯（红黄绿）并 inset 进内容区，与自绘标题栏融合；
    // Win/Linux 用 hidden：无原生按钮，由 renderer 自绘 Mac 风格交通灯（CaptionButtons）。
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // [2.3] sandbox: false is required because webviewTag: true needs access to
      // Electron's webview internals which are blocked by the Chromium sandbox.
      // contextIsolation: true + nodeIntegration: false still protect the renderer.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  mainWindow.webContents.setWindowOpenHandler(d => {
    if (isSafeExternalUrl(d.url)) {
      void shell.openExternal(d.url)
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // ─── 最小化/关闭到系统托盘 ───────────────────────────────────
  // 标题栏使用自定义按钮（见 TitleBar WindowsCaptionButtons）→ window:minimize/close IPC。
  // close 事件可 preventDefault，统一走 handleCloseAction（含下载中确认弹窗），覆盖 Alt+F4/任务栏关闭。
  mainWindow.on('close', (e) => {
    // isQuitting 由托盘"退出"/window:quit/window:cancel-and-quit/before-quit 置位；否则拦截，
    // 发事件让 renderer 弹 Mac 风格确认窗，renderer 回调 window:minimize / window:cancel-and-quit / 不动。
    // 覆盖 Alt+F4 / 任务栏右键关闭。
    if (!isQuitting) {
      e.preventDefault()
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('window:close-requested')
      }
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ─── 系统托盘 ─────────────────────────────────────────────────

/** 托盘图标路径：dev 下从项目 build/icons 取 32.png；打包后从 extraResources(icons) 取。
 *  Electron Tray 在 Windows 上接受 PNG；32px 兼顾 HiDPI 清晰度。
 *  跟随系统深浅主题 (同 resolveAppIcon): 深色主题用浅色 logo, 浅色主题用深色 logo。 */
export function resolveTrayIcon(): string {
  const sub = nativeTheme.shouldUseDarkColors ? 'light' : ''
  return is.dev
    ? join(app.getAppPath(), 'build', 'icons', sub, '32.png')
    : join(process.resourcesPath, 'icons', sub, '32.png')
}

/** 系统主题变化时刷新窗口/托盘图标到当前主题版本。
 *  - 窗口图标 (任务栏): Win/Linux 切换; macOS dock 图标也切换 (深色模式 dock 深底需浅色 logo)。
 *  - 托盘: Win/Linux 切换; macOS 菜单栏图标用 setTemplateImage(true) 自动跟随深浅反色, 不手动切。
 *  图标文件缺失 (nativeImage.isEmpty) 时跳过, 保持当前图标不动。 */
export function applyThemeIcons(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.setIcon(resolveAppIcon()) } catch { /* 图标缺失等, 忽略 */ }
  }
  if (tray && process.platform !== 'darwin') {
    const img = nativeImage.createFromPath(resolveTrayIcon())
    if (!img.isEmpty()) {
      try { tray.setImage(img) } catch { /* 忽略 */ }
    }
  }
}

export function showMainWindow(): void {
  if (isQuitting) return
  if (!mainWindow) createMainWindow()
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}

export function createTray(): void {
  if (tray) return
  let img = nativeImage.createFromPath(resolveTrayIcon())
  if (img.isEmpty()) img = nativeImage.createFromPath(resolveAppIcon())
  // macOS 菜单栏规范：托盘图标应为 template image（纯黑+透明，系统按深/浅菜单栏自动反色）。
  // 彩色图标在深色菜单栏上不可见。Win/Linux 无此机制，保持原色。
  if (process.platform === 'darwin' && !img.isEmpty()) img.setTemplateImage(true)
  tray = new Tray(img)
  tray.setToolTip('SJTU 课程下载器')
  // 右键动态菜单：显示当前账号名 + 实时速度（取主进程 speedEma 当前值）。
  // 不用 setContextMenu（静态菜单无法反映实时速度/账号），改为 right-click 时构建并 popUp。
  tray.on('right-click', () => {
    if (!tray) return
    const menu = Menu.buildFromTemplate([
      { label: `账号：${getAccountName() ?? '未登录'}${getStudentId() ? ` (${getStudentId()})` : ''}`, enabled: false },
      { label: `↓ ${formatBytes(getSpeedEma().down)}/s   ↑ ${formatBytes(getSpeedEma().up)}/s`, enabled: false },
      { type: 'separator' },
      { label: '显示主窗口', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
    tray.popUpContextMenu(menu)
  })
  // 单击/双击托盘图标恢复窗口（Windows 习惯：单击）
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
}

/** 销毁托盘（cleanupOnQuit 用）。 */
export function destroyTray(): void {
  if (tray) { tray.destroy(); tray = null }
}
