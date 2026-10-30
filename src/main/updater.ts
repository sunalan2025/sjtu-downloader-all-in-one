// ─── 应用内自动更新（自研轻量方案，不引入 electron-updater）─────────────
//
// 背景：CLAUDE.md 写过不用 electron-updater（未签名 + 国内网络 + 杀软环境问题多）。
// 本模块自研三平台自动更新，但**复刻 electron-builder 源码 NsisUpdater.doInstall 已验证的
// 安装调用**：spawn NSIS 安装器时传 ['--updated', '/S', '--force-run'] ——
//   --updated   走更新覆盖路径（先关旧实例再覆盖文件）
//   /S          静默安装（无 UI）
//   --force-run 装完自动启动新版本（静默模式下也生效）
// 旧进程在 spawn 后 app.quit() 释放 .dll / .exe 文件锁，安装器静默覆盖并重启 ——
// 既免去用户手动下安装包，又解决了 .msi 更新时"没有 .dll 的访问权限"（文件被运行中进程占用）。
//
// macOS：下载 .zip → ditto 解压 → detached shell 脚本（sleep 等 quit → rm 旧 .app → mv 新 .app → open）
//   macOS 允许替换运行中的 .app（旧进程继续用旧 inode，下次启动用新的）。
//   未签名风险：node:https 下载不经 LaunchServices，不带 com.apple.quarantine；但未签名 .app
//   首次启动仍可能被 Gatekeeper 拦，未端到端验证，必要时降级为仅「前往下载」。
// Linux：下载 .AppImage → chmod +x → 覆盖 process.env.APPIMAGE → app.relaunch + quit。

import { app } from 'electron'
import { execFileSync, spawn } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type WriteStream
} from 'node:fs'
import { join } from 'node:path'
import { request as httpsRequest } from 'node:https'
import { createHash } from 'node:crypto'
import type { ClientRequest, IncomingMessage } from 'node:http'
import type { UpdateAsset, UpdateProgress } from '../shared/types'

/** 渲染端事件推送函数（由 index.ts 注入，内部判断 mainWindow 是否存活） */
type UpdateEmitter = (channel: string, payload: unknown) => void
let emit: UpdateEmitter = (): void => {}

export function setUpdateEmitter(fn: UpdateEmitter): void {
  emit = fn
}

// ─── 下载运行态 ──────────────────────────────────────────────────────
let activeReq: ClientRequest | null = null
let activeStream: WriteStream | null = null
let destPath: string | null = null
let verifiedFilePath: string | null = null
let downloading = false
/** 安装已发起（spawn 了安装器）→ cancelUpdate 不再干预，避免删掉正在使用的临时文件 */
let installing = false

export function getVerifiedFilePath(): string | null {
  return verifiedFilePath
}

/** 测试用重置更新模块运行态 */
export function _resetUpdaterStateForTesting(): void {
  if (activeReq) {
    try { activeReq.destroy() } catch { /* ignore */ }
    activeReq = null
  }
  if (activeStream) {
    try { activeStream.destroy() } catch { /* ignore */ }
    activeStream = null
  }
  if (destPath) {
    try { unlinkSync(destPath) } catch { /* ignore */ }
    destPath = null
  }
  verifiedFilePath = null
  downloading = false
  installing = false
}

/** 从 GitHub release 的 assets 里匹配当前平台的安装器资产。
 *  无匹配（平台/架构无对应 release）返回 null，渲染端回退「前往下载」。 */
interface GithubAsset {
  name: string
  browser_download_url: string
  size: number
}

/** 从 SHA256SUMS.txt 清单文本中提取目标文件的 64 位十六进制 SHA-256 哈希 */
export function parseSha256Checksum(manifestText: string, targetFileName: string): string | null {
  if (!manifestText || !targetFileName) return null
  const lines = manifestText.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([a-fA-F0-9]{64})\s+[*]?(.+)$/)
    if (match) {
      const hash = match[1].toLowerCase()
      const file = match[2].trim()
      if (file === targetFileName || file.endsWith('/' + targetFileName) || file.endsWith('\\' + targetFileName)) {
        return hash
      }
    }
  }
  return null
}

export function matchAsset(assetsRaw: unknown): UpdateAsset | null {
  if (!Array.isArray(assetsRaw)) return null
  const assets = assetsRaw.filter((a): a is GithubAsset =>
    a != null && typeof a === 'object' &&
    typeof (a as GithubAsset).name === 'string' &&
    typeof (a as GithubAsset).browser_download_url === 'string'
  )
  const plat = process.platform
  const arch = process.arch
  let target: GithubAsset | undefined
  if (plat === 'win32') {
    // NSIS .exe（不是 .msi —— MSI 静默替换 + 退出旧进程的链路不如 NSIS --force-run 干净）
    target = assets.find(a => new RegExp(`-win-${arch}\\.exe$`).test(a.name))
  } else if (plat === 'darwin') {
    // 优先当前架构精确匹配，兜底 universal（-mac.zip 无 arch 段）
    target = assets.find(a => new RegExp(`-mac-${arch}\\.zip$`).test(a.name))
      ?? assets.find(a => /-mac\.zip$/.test(a.name))
  } else if (plat === 'linux') {
    target = assets.find(a => new RegExp(`-linux-${arch}\\.AppImage$`).test(a.name))
  }
  if (!target) return null

  // 匹配发布资产中的 SHA256SUMS.txt 清单
  const shaAsset = assets.find(a => a.name.toLowerCase() === 'sha256sums.txt')

  return {
    url: target.browser_download_url,
    size: typeof target.size === 'number' && target.size > 0 ? target.size : null,
    fileName: target.name,
    sha256Url: shaAsset ? shaAsset.browser_download_url : null
  }
}

/** 简易拉取纯文本（跟随重定向，拉取 SHA256SUMS.txt 清单专用） */
function fetchText(url: string, depth = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('重定向过多'))
    let u: URL
    try { u = new URL(url) } catch (e) { return reject(e) }
    const req = httpsRequest({
      method: 'GET',
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'User-Agent': `sjtu-downloader/${app.getVersion()}`,
        Accept: 'text/plain,*/*'
      },
      timeout: 10000
    }, (resp) => {
      const status = resp.statusCode ?? 0
      if (status >= 300 && status < 400 && resp.headers.location) {
        resp.resume()
        return resolve(fetchText(new URL(resp.headers.location, url).toString(), depth + 1))
      }
      if (status !== 200) {
        resp.resume()
        return reject(new Error(`HTTP ${status}`))
      }
      let body = ''
      resp.setEncoding('utf8')
      resp.on('data', chunk => { body += chunk })
      resp.on('end', () => resolve(body))
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.end()
  })
}

/** 触发下载安装包。流式下载 + 手动跟随 302（GitHub release asset → objects.githubusercontent.com CDN）。
 *  下载流式计算 SHA-256，完成时比对 Release 清单指纹；不匹配阻断安装并擦除文件。
 *  进度 1s 节流推送 update:progress，完成推 update:ready，失败/取消推 update:failed。
 *  幂等：已在下载则返回 error 不重复触发。 */
export function downloadUpdate(asset: UpdateAsset): { ok: boolean; error?: string } {
  if (installing) return { ok: false, error: '正在安装，无法重新下载' }
  if (downloading) return { ok: false, error: '已有下载在进行' }

  downloading = true
  verifiedFilePath = null
  const dir = join(app.getPath('temp'), 'sjtu-update')
  try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
  destPath = join(dir, asset.fileName)
  // 清理同路径旧文件（上次下载残留 / 重复触发）
  try { if (existsSync(destPath)) unlinkSync(destPath) } catch { /* ignore */ }

  const fileStream = createWriteStream(destPath)
  activeStream = fileStream
  let loaded = 0
  let lastEmitTs = 0
  const hasher = createHash('sha256')

  let manifestPromise: Promise<string | null> | null = null
  if (asset.sha256) {
    manifestPromise = Promise.resolve(asset.sha256)
  } else if (asset.sha256Url) {
    manifestPromise = fetchText(asset.sha256Url).then(manifest => {
      return parseSha256Checksum(manifest, asset.fileName)
    }).catch(err => {
      console.error('[updater] 获取或解析校验清单失败:', err)
      return null
    })
  }

  const pushProgress = (total: number | null): void => {
    const now = Date.now()
    if (now - lastEmitTs < 1000) return
    lastEmitTs = now
    const p: UpdateProgress = {
      loaded,
      total,
      percent: total && total > 0 ? Math.min(100, (loaded / total) * 100) : null
    }
    emit('update:progress', p)
  }

  const fail = (err: string): void => {
    if (!downloading) return
    downloading = false
    activeReq = null
    verifiedFilePath = null
    try { fileStream.destroy() } catch { /* ignore */ }
    try { if (destPath) unlinkSync(destPath) } catch { /* ignore */ }
    destPath = null
    activeStream = null
    emit('update:failed', { error: err })
  }

  const fetchOnce = (url: string, depth: number): void => {
    if (depth > 5) { fail('重定向过多'); return }
    let u: URL
    try { u = new URL(url) } catch { fail('URL 解析失败'); return }
    const req = httpsRequest(
      {
        method: 'GET',
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          'User-Agent': `sjtu-downloader/${app.getVersion()}`,
          Accept: 'application/octet-stream,*/*'
        },
        timeout: 30000
      },
      (resp: IncomingMessage) => {
        const status = resp.statusCode ?? 0
        // 手动跟随重定向（node:https 默认不跟）
        if (status >= 300 && status < 400 && resp.headers.location) {
          resp.resume()
          fetchOnce(new URL(resp.headers.location, url).toString(), depth + 1)
          return
        }
        if (status !== 200) {
          resp.resume()
          fail(`下载失败：HTTP ${status}`)
          return
        }
        const contentLength = parseInt(resp.headers['content-length'] ?? '', 10)
        const realTotal = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : asset.size
        loaded = 0
        resp.on('data', (chunk: Buffer) => {
          loaded += chunk.length
          hasher.update(chunk)
          pushProgress(realTotal)
        })
        resp.pipe(fileStream)
        fileStream.on('finish', async () => {
          if (!downloading) return

          let expectedHash: string | null = null
          if (manifestPromise) {
            try {
              expectedHash = await manifestPromise
            } catch {
              expectedHash = null
            }
          }

          if (!downloading) return
          downloading = false
          activeReq = null
          activeStream = null

          // 数字指纹完整性校验 (C-2)
          const actualHash = hasher.digest('hex').toLowerCase()

          if (asset.sha256Url && !expectedHash) {
            try { if (destPath) unlinkSync(destPath) } catch { /* ignore */ }
            destPath = null
            verifiedFilePath = null
            emit('update:failed', { error: '安装包完整性校验失败：无法获取官方发布校验清单，已中止更新以保护系统安全' })
            return
          }

          if (expectedHash) {
            if (actualHash !== expectedHash.toLowerCase()) {
              try { if (destPath) unlinkSync(destPath) } catch { /* ignore */ }
              destPath = null
              verifiedFilePath = null
              emit('update:failed', { error: '安装包完整性校验失败：文件指纹与发布清单不一致，已中止安装以保护系统安全' })
              return
            }
          } else if (asset.size && loaded !== asset.size) {
            try { if (destPath) unlinkSync(destPath) } catch { /* ignore */ }
            destPath = null
            verifiedFilePath = null
            emit('update:failed', { error: '更新安装包大小不匹配，文件可能不完整' })
            return
          }

          verifiedFilePath = destPath
          // 最终进度推 100%，再推 ready
          emit('update:progress', { loaded, total: realTotal, percent: 100 })
          emit('update:ready', { ok: true })
        })
        fileStream.on('error', e => fail(e.message))
      }
    )
    req.on('error', e => fail(e.message))
    req.on('timeout', () => { req.destroy(new Error('下载超时')) })
    activeReq = req
    req.end()
  }

  fetchOnce(asset.url, 0)
  return { ok: true }
}

/** 取消下载（用户取消 / 应用退出清理）。安装已发起时 no-op。 */
export function cancelUpdate(): void {
  if (installing) return
  if (activeReq) {
    try { activeReq.destroy() } catch { /* ignore */ }
    activeReq = null
  }
  if (activeStream) {
    try { activeStream.destroy() } catch { /* ignore */ }
    activeStream = null
  }
  downloading = false
  verifiedFilePath = null
  if (destPath) {
    try { unlinkSync(destPath) } catch { /* ignore */ }
    destPath = null
  }
}

/** 是否有已下载就绪待安装的包（渲染端状态判断用）。 */
export function hasReadyInstaller(): boolean {
  return !!verifiedFilePath && verifiedFilePath === destPath && existsSync(destPath)
}

/** 严格白名单校验 macOS .app 安装路径（防御目录穿越与关键系统路径覆盖） */
export function isSafeMacAppPath(p: string): boolean {
  if (!p || typeof p !== 'string') return false
  const trimmed = p.trim()
  if (!trimmed.endsWith('.app')) return false
  if (
    trimmed === '/' ||
    trimmed === '/Applications' ||
    trimmed === '/Applications/' ||
    trimmed.startsWith('/System') ||
    trimmed.startsWith('/usr') ||
    trimmed.startsWith('/bin') ||
    trimmed.startsWith('/sbin')
  ) {
    return false
  }
  if (trimmed.includes('..')) return false
  return true
}

/** 安装更新：spawn 安装器 / 替换 bundle 后退出当前进程让安装器接管。
 *  必须在 downloadUpdate 完成后调用（destPath 就绪）。 */
export function installUpdate(): { ok: boolean; error?: string } {
  if (!verifiedFilePath || verifiedFilePath !== destPath || !existsSync(destPath)) {
    return { ok: false, error: '安装包尚未通过完整性校验，禁止执行' }
  }
  const installerPath = destPath
  installing = true
  try {
    if (process.platform === 'win32') {
      // 复刻 electron-builder NsisUpdater.doInstall：--updated /S /force-run
      spawn(installerPath, ['--updated', '/S', '--force-run'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }).unref()
      // 退出当前进程释放文件锁，让 NSIS 静默覆盖并 --force-run 启动新版本
      setImmediate(() => app.quit())
      return { ok: true }
    }
    if (process.platform === 'darwin') {
      return installMac(installerPath)
    }
    if (process.platform === 'linux') {
      return installLinux(installerPath)
    }
    installing = false
    return { ok: false, error: '不支持的平台' }
  } catch (e) {
    installing = false
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** macOS：解压 zip → detached shell 脚本等旧进程退出后替换 .app 并重启。 */
function installMac(zipPath: string): { ok: boolean; error?: string } {
  // process.execPath 形如 /Applications/SJTU 课程下载器.app/Contents/MacOS/SJTU 课程下载器
  const marker = '/Contents/MacOS/'
  const idx = process.execPath.indexOf(marker)
  if (idx < 0) {
    installing = false
    return { ok: false, error: '无法定位应用安装目录，请前往官网重新下载' }
  }
  const appPath = process.execPath.slice(0, idx) // /.../SJTU 课程下载器.app
  const appName = appPath.split('/').pop() ?? 'App.app'
  const extractDir = join(app.getPath('temp'), 'sjtu-update-extract')
  try { mkdirSync(extractDir, { recursive: true }) } catch { /* ignore */ }

  // ditto 解压（electron-builder mac zip 由 ditto 创建，用 ditto 解压保留权限/可执行位）
  try {
    execFileSync('ditto', ['-xk', zipPath, extractDir], { stdio: 'ignore' })
  } catch {
    // 兜底 unzip
    try {
      execFileSync('unzip', ['-o', '-q', zipPath, '-d', extractDir], { stdio: 'ignore' })
    } catch (e) {
      installing = false
      return { ok: false, error: `解压失败：${e instanceof Error ? e.message : String(e)}` }
    }
  }
  const newApp = join(extractDir, appName)
  if (!existsSync(newApp)) {
    installing = false
    return { ok: false, error: '解压后未找到 .app' }
  }

  // 路径安全白名单断言 (C-3)
  if (!isSafeMacAppPath(appPath) || !isSafeMacAppPath(newApp)) {
    installing = false
    return { ok: false, error: '无法定位应用安装目录，请前往官网重新下载' }
  }

  // 静态参数化 shell 脚本：位置参数 $1 为原 app，$2 为新 app，彻底消除字符串拼接注入风险 (C-3)
  const scriptPath = join(app.getPath('temp'), 'sjtu-update-replace.sh')
  const script = [
    '#!/bin/sh',
    'set -e',
    'sleep 1',
    'OLD_APP="$1"',
    'NEW_APP="$2"',
    'rm -rf "$OLD_APP"',
    'mv "$NEW_APP" "$OLD_APP"',
    'open -n "$OLD_APP"',
    ''
  ].join('\n')
  try {
    writeFileSync(scriptPath, script, { mode: 0o755 })
  } catch (e) {
    installing = false
    return { ok: false, error: `写入替换脚本失败：${e instanceof Error ? e.message : String(e)}` }
  }
  spawn('/bin/sh', [scriptPath, appPath, newApp], { detached: true, stdio: 'ignore' }).unref()
  setImmediate(() => app.quit())
  return { ok: true }
}

/** Linux：覆盖当前 AppImage（运行中可执行文件可被替换，旧进程用旧 inode）→ relaunch。 */
function installLinux(appImagePath: string): { ok: boolean; error?: string } {
  const currentAppImage = process.env.APPIMAGE
  if (!currentAppImage) {
    installing = false
    return { ok: false, error: '非 AppImage 运行环境（缺少 APPIMAGE）' }
  }
  try {
    chmodSync(appImagePath, 0o755)
    // 优先 rename（同文件系统原子替换），跨设备回退 copy（rename 跨设备抛 EXDEV）
    try {
      renameSync(appImagePath, currentAppImage)
    } catch {
      copyFileSync(appImagePath, currentAppImage)
      try { unlinkSync(appImagePath) } catch { /* ignore */ }
    }
  } catch (e) {
    installing = false
    return { ok: false, error: `替换 AppImage 失败：${e instanceof Error ? e.message : String(e)}` }
  }
  app.relaunch()
  setImmediate(() => app.quit())
  return { ok: true }
}
