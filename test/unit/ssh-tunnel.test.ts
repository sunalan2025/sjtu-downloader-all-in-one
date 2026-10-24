/**
 * 校内私有中转服务 原生 OpenSSH 隧道跨平台管理器与参数安全守护专属单元测试
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { EventEmitter } from 'node:events'

// 模拟 ChildProcess 实例
class MockChildProcess extends EventEmitter {
  pid: number
  exitCode: number | null = null
  signalCode: string | null = null
  killed: boolean = false
  stderr: EventEmitter
  stdout: EventEmitter
  stdin: EventEmitter

  constructor(pid = 54321) {
    super()
    this.pid = pid
    this.stderr = new EventEmitter()
    this.stdout = new EventEmitter()
    this.stdin = new EventEmitter()
  }

  kill(signal: NodeJS.Signals | string = 'SIGTERM'): boolean {
    this.killed = true
    process.nextTick(() => {
      this.signalCode = typeof signal === 'string' ? signal : `SIG${signal}`
      this.emit('exit', null, signal)
    })
    return true
  }
}

const mockSpawn = vi.fn()

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: (...args: unknown[]) => mockSpawn(...args)
  }
})

import {
  isValidSshHost,
  probePort,
  startSshTunnel,
  stopSshTunnel,
  getSshTunnelStatus
} from '../../src/main/ssh-tunnel'
import { testPrivateWorker } from '../../src/main/private-worker'
import type { PrivateWorkerTunnelConfig } from '../../src/shared/types'

describe('SSH Tunnel & Security Guard Unit Tests', () => {
  let mockHttpServer: http.Server
  let mockPort: number

  beforeAll(async () => {
    mockHttpServer = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(
          JSON.stringify({
            status: 'ok',
            server: 'sjtu-worker-test',
            version: '2.0.0'
          })
        )
      }
      res.writeHead(404)
      res.end('Not Found')
    })

    await new Promise<void>((resolve) => {
      mockHttpServer.listen(0, '127.0.0.1', () => {
        const addr = mockHttpServer.address() as AddressInfo
        mockPort = addr.port
        resolve()
      })
    })
  })

  afterAll(async () => {
    await stopSshTunnel()
    await new Promise<void>((resolve) => mockHttpServer.close(() => resolve()))
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    await stopSshTunnel()
  })

  afterEach(async () => {
    await stopSshTunnel()
  })

  describe('isValidSshHost (SSH 主机名安全校验)', () => {
    it('正确通过符合安全规范的合法主机名与别名', () => {
      const validHosts = [
        'sjtu-direct',
        'lab-gpu',
        'server.local',
        '10.0.0.1',
        'worker_node.sjtu',
        'my-server-123',
        'deeplearning.cs.sjtu.edu.cn',
        'node_cluster_1',
        '  lab-gpu  ' // 前后空白符修剪后合法
      ]

      for (const host of validHosts) {
        expect(isValidSshHost(host), `Expected "${host}" to be valid`).toBe(true)
      }
    })

    it('坚决拦截命令注入攻击字符', () => {
      const injectionAttempts = [
        'host; rm -rf /',
        'host && whoami',
        'host | cat',
        'host || exit 1',
        'host; reboot',
        'host\nrm -rf /',
        'host&echo 1'
      ]

      for (const attempt of injectionAttempts) {
        expect(isValidSshHost(attempt), `Expected injection "${attempt}" to be rejected`).toBe(false)
      }
    })

    it('坚决拦截 Shell 元字符与反引号执行', () => {
      const shellMetacharacters = [
        'host$(id)',
        'host`id`',
        'host"quote',
        "host'quote",
        'host>out.txt',
        'host<in.txt',
        'host*',
        'host?',
        'host^',
        'host~',
        'host#',
        'host/path',
        'host\\path'
      ]

      for (const meta of shellMetacharacters) {
        expect(isValidSshHost(meta), `Expected metacharacter "${meta}" to be rejected`).toBe(false)
      }
    })

    it('坚决拦截 OpenSSH 参数注入（首字符以减号开头）', () => {
      const paramInjections = [
        '-oProxyCommand=calc.exe',
        '-L80:localhost:80',
        '-p22',
        '-F/etc/ssh/ssh_config',
        '   -danger-leading-dash' // 修剪后依然以减号开头
      ]

      for (const param of paramInjections) {
        expect(isValidSshHost(param), `Expected parameter injection "${param}" to be rejected`).toBe(false)
      }
    })

    it('拦截空值、非法类型与超出 255 字符长度的超长主机名', () => {
      expect(isValidSshHost('')).toBe(false)
      expect(isValidSshHost('   ')).toBe(false)
      expect(isValidSshHost(null as unknown as string)).toBe(false)
      expect(isValidSshHost(undefined as unknown as string)).toBe(false)
      expect(isValidSshHost(123 as unknown as string)).toBe(false)
      expect(isValidSshHost({} as unknown as string)).toBe(false)
      expect(isValidSshHost('a'.repeat(256))).toBe(false)
      expect(isValidSshHost('a'.repeat(255))).toBe(true)
    })
  })

  describe('probePort (本地轻量端口探针)', () => {
    it('对正在监听中的本地端口返回 true', async () => {
      const alive = await probePort(mockPort, 500)
      expect(alive).toBe(true)
    })

    it('对未被监听的端口返回 false', async () => {
      // 选取一个未被占用的端口
      const dead = await probePort(59998, 200)
      expect(dead).toBe(false)
    })
  })

  describe('startSshTunnel & stopSshTunnel (生命周期与错误边界)', () => {
    it('拒绝非法或空的配置参数', async () => {
      const res1 = await startSshTunnel(null as unknown as PrivateWorkerTunnelConfig)
      expect(res1.success).toBe(false)
      expect(res1.error).toContain('无效的隧道配置参数')

      const res2 = await startSshTunnel({ enabled: true, host: '' })
      expect(res2.success).toBe(false)
      expect(res2.error).toContain('SSH 主机名称格式无效')

      const res3 = await startSshTunnel({ enabled: true, host: 'invalid;injection' })
      expect(res3.success).toBe(false)
      expect(res3.error).toContain('SSH 主机名称格式无效')
    })

    it('严格校验端口号边界 (1 ~ 65535)', async () => {
      const invalidPorts = [0, -1, 65536, 70000, 3.14, NaN]

      for (const port of invalidPorts) {
        const resLocal = await startSshTunnel({
          enabled: true,
          host: 'lab-gpu',
          localPort: port,
          remotePort: 6880
        })
        expect(resLocal.success).toBe(false)
        expect(resLocal.error).toContain('必须在 1 到 65535 之间')

        const resRemote = await startSshTunnel({
          enabled: true,
          host: 'lab-gpu',
          localPort: 6880,
          remotePort: port
        })
        expect(resRemote.success).toBe(false)
        expect(resRemote.error).toContain('必须在 1 到 65535 之间')
      }
    })

    it('成功启动 SSH 隧道并记录运行状态、PID 与端口信息', async () => {
      const mockChild = new MockChildProcess(88888)
      mockSpawn.mockReturnValueOnce(mockChild)

      const startRes = await startSshTunnel({
        enabled: true,
        host: 'lab-gpu',
        localPort: mockPort,
        remotePort: 6880
      })

      expect(startRes.success).toBe(true)
      expect(startRes.pid).toBe(88888)

      // 验证命令行参数构造严格符合标准
      expect(mockSpawn).toHaveBeenCalledTimes(1)
      expect(mockSpawn).toHaveBeenCalledWith(
        'ssh',
        [
          '-N',
          '-L',
          `${mockPort}:127.0.0.1:6880`,
          '-o',
          'ExitOnForwardFailure=yes',
          '-o',
          'ServerAliveInterval=30',
          '-o',
          'ServerAliveCountMax=3',
          'lab-gpu'
        ],
        {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )

      // 验证状态查询返回正确的运行中状态
      const status = getSshTunnelStatus()
      expect(status.running).toBe(true)
      expect(status.pid).toBe(88888)
      expect(status.host).toBe('lab-gpu')
      expect(status.localPort).toBe(mockPort)
      expect(status.remotePort).toBe(6880)
      expect(status.error).toBeUndefined()
    })

    it('对相同配置且依然存活的隧道进行复用，避免重复启动进程', async () => {
      const mockChild = new MockChildProcess(77777)
      mockSpawn.mockReturnValueOnce(mockChild)

      const firstRes = await startSshTunnel({
        enabled: true,
        host: 'lab-gpu',
        localPort: mockPort,
        remotePort: 6880
      })
      expect(firstRes.success).toBe(true)
      expect(mockSpawn).toHaveBeenCalledTimes(1)

      // 再次调用相同配置
      const secondRes = await startSshTunnel({
        enabled: true,
        host: 'lab-gpu',
        localPort: mockPort,
        remotePort: 6880
      })
      expect(secondRes.success).toBe(true)
      expect(secondRes.pid).toBe(77777)
      // spawn 没有被二次触发
      expect(mockSpawn).toHaveBeenCalledTimes(1)
    })

    it('当配置发生变更时，自动先停止旧隧道再拉起新隧道', async () => {
      const mockChild1 = new MockChildProcess(11111)
      const mockChild2 = new MockChildProcess(22222)
      mockSpawn.mockReturnValueOnce(mockChild1).mockReturnValueOnce(mockChild2)

      const res1 = await startSshTunnel({
        enabled: true,
        host: 'lab-gpu',
        localPort: mockPort,
        remotePort: 6880
      })
      expect(res1.success).toBe(true)
      expect(res1.pid).toBe(11111)

      // 变更 host 为 sjtu-server
      const res2 = await startSshTunnel({
        enabled: true,
        host: 'sjtu-server',
        localPort: mockPort,
        remotePort: 6880
      })
      expect(res2.success).toBe(true)
      expect(res2.pid).toBe(22222)
      expect(mockChild1.killed).toBe(true)
      expect(getSshTunnelStatus().host).toBe('sjtu-server')
    })

    it('stopSshTunnel 能安全停止活跃隧道并重置状态', async () => {
      const mockChild = new MockChildProcess(33333)
      mockSpawn.mockReturnValueOnce(mockChild)

      await startSshTunnel({
        enabled: true,
        host: 'lab-gpu',
        localPort: mockPort,
        remotePort: 6880
      })
      expect(getSshTunnelStatus().running).toBe(true)

      const stopRes = await stopSshTunnel()
      expect(stopRes.success).toBe(true)
      expect(mockChild.killed).toBe(true)

      const statusAfter = getSshTunnelStatus()
      expect(statusAfter.running).toBe(false)
      expect(statusAfter.pid).toBeUndefined()
      expect(statusAfter.host).toBeUndefined()
    })

    it('在未运行隧道时调用 stopSshTunnel 安全无损返回', async () => {
      const res = await stopSshTunnel()
      expect(res.success).toBe(true)
    })

    it('优雅处理系统未安装 OpenSSH (ENOENT) 的异常场景', async () => {
      const mockChild = new MockChildProcess(44444)
      mockSpawn.mockImplementationOnce(() => {
        process.nextTick(() => {
          const enoentErr = Object.assign(new Error('spawn ssh ENOENT'), { code: 'ENOENT' })
          mockChild.emit('error', enoentErr)
          mockChild.exitCode = 1
          mockChild.emit('exit', 1, null)
        })
        return mockChild
      })

      const res = await startSshTunnel({
        enabled: true,
        host: 'lab-gpu',
        localPort: 59997,
        remotePort: 6880
      })

      expect(res.success).toBe(false)
      expect(res.error).toContain('系统未找到 ssh 命令')
      expect(res.error).toContain('OpenSSH')

      const status = getSshTunnelStatus()
      expect(status.running).toBe(false)
      expect(status.error).toContain('系统未找到 ssh 命令')
    })

    it('优雅处理 SSH 认证失败或异常退出 (非零退出码) 场景', async () => {
      const mockChild = new MockChildProcess(55555)
      mockSpawn.mockImplementationOnce(() => {
        process.nextTick(() => {
          mockChild.stderr.emit('data', 'Permission denied (publickey).\r\n')
          mockChild.exitCode = 255
          mockChild.emit('exit', 255, null)
        })
        return mockChild
      })

      const res = await startSshTunnel({
        enabled: true,
        host: 'lab-gpu',
        localPort: 59996,
        remotePort: 6880
      })

      expect(res.success).toBe(false)
      expect(res.error).toContain('Permission denied (publickey)')

      const status = getSshTunnelStatus()
      expect(status.running).toBe(false)
      expect(status.error).toContain('Permission denied')
    })

    it('优雅处理 spawn 自身同步抛出异常的场景', async () => {
      mockSpawn.mockImplementationOnce(() => {
        throw new Error('EACCES: permission denied')
      })

      const res = await startSshTunnel({
        enabled: true,
        host: 'lab-gpu',
        localPort: mockPort,
        remotePort: 6880
      })

      expect(res.success).toBe(false)
      expect(res.error).toContain('SSH 进程拉起失败: EACCES: permission denied')
    })
  })

  describe('testPrivateWorker 隧道集成能力 (Tunnel Integration)', () => {
    it('当未配置隧道或 enabled: false 时，直接探测中转节点', async () => {
      // 未配置 tunnelConfig
      const resDirect = await testPrivateWorker(`http://127.0.0.1:${mockPort}`)
      expect(resDirect.success).toBe(true)
      expect(resDirect.serverName).toBe('sjtu-worker-test')
      expect(mockSpawn).not.toHaveBeenCalled()

      // tunnelConfig.enabled: false
      const resDisabled = await testPrivateWorker(
        `http://127.0.0.1:${mockPort}`,
        undefined,
        2000,
        { enabled: false, host: 'lab-gpu' }
      )
      expect(resDisabled.success).toBe(true)
      expect(resDisabled.serverName).toBe('sjtu-worker-test')
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('当 enabled: true 且隧道初始化失败时，拦截探测并透传隧道错误信息', async () => {
      // 非法 host 拦截
      const resInvalidHost = await testPrivateWorker(
        `http://127.0.0.1:${mockPort}`,
        undefined,
        2000,
        { enabled: true, host: 'host; evil command' }
      )
      expect(resInvalidHost.success).toBe(false)
      expect(resInvalidHost.error).toContain('SSH 隧道启动失败')
      expect(resInvalidHost.error).toContain('SSH 主机名称格式无效')
      expect(mockSpawn).not.toHaveBeenCalled()

      // ENOENT 模拟
      const mockChild = new MockChildProcess(66666)
      mockSpawn.mockImplementationOnce(() => {
        process.nextTick(() => {
          const enoent = Object.assign(new Error('spawn ssh ENOENT'), { code: 'ENOENT' })
          mockChild.emit('error', enoent)
          mockChild.exitCode = 1
          mockChild.emit('exit', 1, null)
        })
        return mockChild
      })

      const resEnoent = await testPrivateWorker(
        `http://127.0.0.1:59995`,
        undefined,
        2000,
        { enabled: true, host: 'missing-ssh', localPort: 59995 }
      )
      expect(resEnoent.success).toBe(false)
      expect(resEnoent.error).toContain('SSH 隧道启动失败')
      expect(resEnoent.error).toContain('系统未找到 ssh 命令')
    })

    it('当 enabled: true 且隧道建立成功时，顺利连通私有中转服务健康接口', async () => {
      const mockChild = new MockChildProcess(99999)
      mockSpawn.mockReturnValueOnce(mockChild)

      const res = await testPrivateWorker(
        `http://127.0.0.1:${mockPort}`,
        undefined,
        3000,
        {
          enabled: true,
          host: 'lab-gpu',
          localPort: mockPort,
          remotePort: 6880
        }
      )

      expect(res.success).toBe(true)
      expect(res.serverName).toBe('sjtu-worker-test')
      expect(res.version).toBe('2.0.0')
      expect(res.latencyMs).toBeGreaterThan(0)
      expect(mockSpawn).toHaveBeenCalledTimes(1)
    })
  })
})
