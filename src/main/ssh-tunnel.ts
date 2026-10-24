/**
 * 校内私有中转服务 原生 OpenSSH 隧道跨平台管理器与参数安全守护
 *
 * 职责：
 * 1. 严格校验 SSH 主机名与端口参数，从根本上杜绝 Shell 注入与参数注入风险
 * 2. 调度并守护原生 `ssh -N -L` 子进程，提供就绪探针自动检测与友好中文错误翻译
 * 3. 严防本地端口碰撞漏洞，注册退出清理钩子，杜绝后台孤儿进程与本地端口死锁
 */

import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import type { PrivateWorkerTunnelConfig, SshTunnelStatus } from '../shared/types'

let activeProcess: ChildProcess | null = null
let activeConfig: PrivateWorkerTunnelConfig | null = null
let lastError: string | undefined = undefined

/**
 * 校验 SSH 主机名/别名是否合法且安全（防止命令注入与参数注入攻击）
 * 仅允许字母、数字、点、减号、下划线，且首字符严禁为减号（避免被 OpenSSH 解析为 CLI 参数）
 */
export function isValidSshHost(host: string): boolean {
  if (!host || typeof host !== 'string') return false
  const trimmed = host.trim()
  if (!trimmed || trimmed.length > 255) return false
  if (trimmed.startsWith('-')) return false
  // Strictly alphanumeric, dots, dashes, underscores to block shell injection
  return /^[a-zA-Z0-9_.-]+$/.test(trimmed)
}

/**
 * 校验端口号是否在标准有效范围内 (1 ~ 65535)
 */
function isValidPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535
}

/**
 * 将 OpenSSH 常见英文错误输出格式化为友好、场景化的中文提示
 */
export function formatSshError(stderr: string, host: string): string {
  const raw = (stderr || '').trim()
  if (!raw) {
    return `SSH 隧道连接失败（无法连接至主机 "${host}"）`
  }
  if (/could not resolve hostname/i.test(raw) || /不知道这样的主机/i.test(raw)) {
    return `无法解析 SSH 主机名 "${host}"，请检查 ~/.ssh/config 别名或 IP 是否拼写正确 (${raw})`
  }
  if (/permission denied/i.test(raw)) {
    return `SSH 身份认证失败：主机 "${host}" 拒绝了连接，请确认密钥已添加至服务器 authorized_keys (${raw})`
  }
  if (/connection refused/i.test(raw)) {
    return `连接被拒绝：无法连接至主机 "${host}" 的 SSH 端口（请确认服务器运行中且未被防火墙阻断） (${raw})`
  }
  if (/timed out/i.test(raw) || /timeout/i.test(raw)) {
    return `连接主机 "${host}" 超时，请检查网络连通性或是否需要开启 VPN (${raw})`
  }
  if (/address already in use/i.test(raw) || /cannot listen to port/i.test(raw)) {
    return `本地转发端口已被本机其他应用程序占用，无法建立 SSH 监听 (${raw})`
  }
  return raw
}

/**
 * 轻量探针：探测指定端口是否已就绪并监听
 */
export function probePort(port: number, timeoutMs = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' })
    socket.setTimeout(timeoutMs)

    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })

    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })

    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

/**
 * 循环轮询本地转发端口，直到端口连通或超时/子进程意外退出
 */
async function waitForPort(
  port: number,
  timeoutMs: number,
  child: ChildProcess,
  getStderr: () => string,
  host: string
): Promise<{ ok: boolean; error?: string }> {
  const startTime = Date.now()
  const interval = 150

  while (Date.now() - startTime < timeoutMs) {
    if (child.exitCode !== null || child.killed) {
      const err = formatSshError(getStderr(), host)
      return { ok: false, error: err }
    }

    const isOpen = await probePort(port, 200)
    if (isOpen) {
      // 端口连通后，短暂确认 120ms 子进程没有在监听后立即报错崩溃
      await new Promise((resolve) => setTimeout(resolve, 120))
      if (child.exitCode !== null || child.killed) {
        const err = formatSshError(getStderr(), host)
        return { ok: false, error: err }
      }
      return { ok: true }
    }

    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  if (child.exitCode !== null || child.killed) {
    return { ok: false, error: formatSshError(getStderr(), host) }
  }

  const err = getStderr().trim()
    ? formatSshError(getStderr(), host)
    : `等待本地转发端口就绪超时（无法连接至主机 "${host}"，请检查网络或配置）`
  return { ok: false, error: err }
}

/**
 * 启动或复用 OpenSSH 本地端口转发隧道
 */
export async function startSshTunnel(
  config: PrivateWorkerTunnelConfig
): Promise<{ success: boolean; pid?: number; error?: string }> {
  if (!config || typeof config !== 'object') {
    return { success: false, error: '无效的隧道配置参数' }
  }

  const trimmedHost = typeof config.host === 'string' ? config.host.trim() : ''
  if (!isValidSshHost(trimmedHost)) {
    return {
      success: false,
      error: 'SSH 主机名称格式无效（仅允许字母、数字、点、减号、下划线）'
    }
  }

  const localPort = config.localPort ?? 6880
  const remotePort = config.remotePort ?? 6880

  if (!isValidPort(localPort) || !isValidPort(remotePort)) {
    return {
      success: false,
      error: '本地或远端转发端口必须在 1 到 65535 之间'
    }
  }

  // 若已有相同配置的活跃隧道在运行，且本地端口依然连通，直接复用
  if (activeProcess && !activeProcess.killed && activeProcess.exitCode === null) {
    if (
      activeConfig &&
      activeConfig.host === trimmedHost &&
      activeConfig.localPort === localPort &&
      activeConfig.remotePort === remotePort
    ) {
      const alive = await probePort(localPort, 300)
      if (alive) {
        return { success: true, pid: activeProcess.pid }
      }
    }
    // 配置不一致或旧端口失效，先优雅停止旧隧道
    await stopSshTunnel()
  }

  let stderrBuffer = ''
  let spawnError: Error | null = null

  let child: ChildProcess
  try {
    child = spawn(
      'ssh',
      [
        '-N',
        '-L',
        `${localPort}:127.0.0.1:${remotePort}`,
        '-o',
        'ExitOnForwardFailure=yes',
        '-o',
        'ServerAliveInterval=30',
        '-o',
        'ServerAliveCountMax=3',
        trimmedHost
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    lastError = `SSH 进程拉起失败: ${msg}`
    return { success: false, error: lastError }
  }

  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderrBuffer += chunk.toString()
    if (stderrBuffer.length > 4000) {
      stderrBuffer = stderrBuffer.slice(-4000)
    }
  })

  child.once('error', (err) => {
    spawnError = err
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      lastError = '系统未找到 ssh 命令，请确保已安装 OpenSSH 客户端并配置在环境变量 PATH 中'
    } else {
      lastError = `SSH 进程启动失败: ${err.message}`
    }
  })

  child.once('exit', (code, signal) => {
    if (activeProcess === child) {
      activeProcess = null
      activeConfig = null
    }
    if (code !== 0 && !lastError) {
      const err = stderrBuffer.trim()
      lastError = err ? formatSshError(err, trimmedHost) : `SSH 隧道进程已退出 (code: ${code ?? 'none'}, signal: ${signal ?? 'none'})`
    }
  })

  const waitResult = await waitForPort(localPort, 3500, child, () => {
    if (spawnError) {
      return (
        lastError ||
        ((spawnError as NodeJS.ErrnoException).code === 'ENOENT'
          ? '系统未找到 ssh 命令，请确保已安装 OpenSSH 客户端并配置在环境变量 PATH 中'
          : spawnError.message)
      )
    }
    return stderrBuffer
  }, trimmedHost)

  if (waitResult.ok) {
    activeProcess = child
    activeConfig = {
      enabled: true,
      host: trimmedHost,
      localPort,
      remotePort
    }
    lastError = undefined
    return { success: true, pid: child.pid }
  }

  // 端口未就绪或进程已退出，回收子进程
  try {
    if (!child.killed && child.exitCode === null) {
      child.kill('SIGTERM')
    }
  } catch {
    // ignore
  }

  activeProcess = null
  activeConfig = null
  const finalError = waitResult.error || lastError || 'SSH 隧道建立失败'
  lastError = finalError
  return { success: false, error: finalError }
}

/**
 * 停止当前运行中的 SSH 隧道进程
 */
export async function stopSshTunnel(): Promise<{ success: boolean; error?: string }> {
  if (!activeProcess || activeProcess.killed || activeProcess.exitCode !== null) {
    activeProcess = null
    activeConfig = null
    return { success: true }
  }

  const proc = activeProcess
  activeProcess = null
  activeConfig = null

  return new Promise((resolve) => {
    let resolved = false
    const finish = (): void => {
      if (!resolved) {
        resolved = true
        resolve({ success: true })
      }
    }

    proc.once('exit', finish)

    try {
      proc.kill('SIGTERM')
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      finish()
      return
    }

    // 若 1000ms 内未正常退出，强制 SIGKILL
    const forceTimer = setTimeout(() => {
      if (!proc.killed && proc.exitCode === null) {
        try {
          proc.kill('SIGKILL')
        } catch {
          // ignore
        }
      }
      finish()
    }, 1000)
    forceTimer.unref()
  })
}

/**
 * 获取当前 SSH 隧道实时运行状态
 */
export function getSshTunnelStatus(): SshTunnelStatus {
  const isRunning = !!activeProcess && !activeProcess.killed && activeProcess.exitCode === null
  return {
    running: isRunning,
    pid: isRunning ? activeProcess?.pid : undefined,
    host: isRunning ? activeConfig?.host : undefined,
    localPort: isRunning ? activeConfig?.localPort : undefined,
    remotePort: isRunning ? activeConfig?.remotePort : undefined,
    error: lastError
  }
}

// ─────────────────────────────────────────────────────────────
// 进程退出自愈钩子：杜绝后台孤儿进程与端口死锁
// ─────────────────────────────────────────────────────────────
let exitHooksRegistered = false

function registerTunnelExitHooks(): void {
  if (exitHooksRegistered) return
  exitHooksRegistered = true

  const killSync = (): void => {
    if (activeProcess && !activeProcess.killed && activeProcess.exitCode === null) {
      try {
        activeProcess.kill('SIGTERM')
      } catch {
        // ignore
      }
    }
  }

  process.on('exit', killSync)
  process.on('SIGINT', killSync)
  process.on('SIGTERM', killSync)
}

registerTunnelExitHooks()
