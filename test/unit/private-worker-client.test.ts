/**
 * 校内私有中转服务 (Private Worker) 核心客户端与连通性单元测试
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { spawn } from 'node:child_process'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  normalizeWorkerUrl,
  testPrivateWorker,
  startEmbeddedDevWorker,
  stopEmbeddedDevWorker,
  getEmbeddedDevWorkerUrl
} from '../../src/main/private-worker'
import { Settings } from '../../src/renderer/src/pages/Settings'
import { useAppStore } from '../../src/renderer/src/store/app'

describe('PrivateWorker Client & Health Check Suite', () => {
  let mockServer: http.Server
  let serverPort: number
  const VALID_TOKEN = 'test_secret_token_123'

  beforeAll(async () => {
    mockServer = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`)
      const auth = req.headers['authorization']

      if (url.pathname === '/health') {
        if (url.searchParams.get('slow') === 'true') {
          // 模拟超时响应：延迟 1000ms 不响应
          setTimeout(() => {
            if (!res.writableEnded) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true }))
            }
          }, 1000)
          return
        }

        if (url.searchParams.get('requireAuth') === 'true') {
          if (auth !== `Bearer ${VALID_TOKEN}`) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }))
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(
          JSON.stringify({
            status: 'ok',
            server: 'sjtu-private-worker-mock',
            version: '1.2.3'
          })
        )
      }

      res.writeHead(404)
      res.end('Not Found')
    })

    await new Promise<void>(resolve => {
      mockServer.listen(0, '127.0.0.1', () => {
        const addr = mockServer.address() as AddressInfo
        serverPort = addr.port
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>(resolve => mockServer.close(() => resolve()))
    await stopEmbeddedDevWorker()
  })

  describe('normalizeWorkerUrl', () => {
    it('去除两端空格并补齐 http:// 协议', () => {
      expect(normalizeWorkerUrl('  127.0.0.1:6880  ')).toBe('http://127.0.0.1:6880')
    })

    it('保留 https 协议', () => {
      expect(normalizeWorkerUrl('https://worker.sjtu.internal/')).toBe('https://worker.sjtu.internal')
    })

    it('移除末尾多余斜杠', () => {
      expect(normalizeWorkerUrl('http://192.168.1.100:6880///')).toBe('http://192.168.1.100:6880')
    })

    it('空字符串安全处理', () => {
      expect(normalizeWorkerUrl('')).toBe('')
    })
  })

  describe('testPrivateWorker', () => {
    it('空地址时返回明确的输入提示', async () => {
      const res = await testPrivateWorker('')
      expect(res.success).toBe(false)
      expect(res.error).toContain('请输入有效的中转服务节点地址')
    })

    it('健康探测成功：正确解析版本、服务名与毫秒级延迟', async () => {
      const res = await testPrivateWorker(`http://127.0.0.1:${serverPort}`)
      expect(res.success).toBe(true)
      expect(res.version).toBe('1.2.3')
      expect(res.serverName).toBe('sjtu-private-worker-mock')
      expect(res.latencyMs).toBeGreaterThan(0)
    })

    it('携带匹配的访问授权密钥 (Token) 可正常通过鉴权', async () => {
      const res = await testPrivateWorker(
        `http://127.0.0.1:${serverPort}?requireAuth=true`,
        VALID_TOKEN
      )
      expect(res.success).toBe(true)
      expect(res.version).toBe('1.2.3')
    })

    it('密钥错误时返回友好的授权失败提示', async () => {
      const res = await testPrivateWorker(
        `http://127.0.0.1:${serverPort}?requireAuth=true`,
        'wrong_token'
      )
      expect(res.success).toBe(false)
      expect(res.error).toContain('授权失败：访问授权密钥 (Token) 不匹配')
    })

    it('连接未开放的端口时提示无法连接', async () => {
      const res = await testPrivateWorker('http://127.0.0.1:59999')
      expect(res.success).toBe(false)
      expect(res.error).toContain('无法连接到该服务节点')
    })

    it('请求超出时限时返回超时提示', async () => {
      const res = await testPrivateWorker(
        `http://127.0.0.1:${serverPort}?slow=true`,
        undefined,
        100
      )
      expect(res.success).toBe(false)
      expect(res.error).toContain('超时')
    })
  })

  describe('EmbeddedDevWorker (开发环境无感自动就绪)', () => {
    it('能在指定端口范围自动拉起内置服务并响应探测', async () => {
      await stopEmbeddedDevWorker()
      const url = await startEmbeddedDevWorker(6871, 6875)
      expect(url).toBeDefined()
      expect(getEmbeddedDevWorkerUrl()).toBe(url)

      const probe = await testPrivateWorker(url!)
      expect(probe.success).toBe(true)
      expect(probe.serverName).toBe('sjtu-private-worker-dev')
      expect(probe.version).toBe('1.0.0')

      await stopEmbeddedDevWorker()
      expect(getEmbeddedDevWorkerUrl()).toBeNull()
    })

    it('首选端口被占用时自动向后递增自愈', async () => {
      await stopEmbeddedDevWorker()
      // 先手动占用 6876 端口
      const blocker = http.createServer((_, res) => res.end('blocked'))
      await new Promise<void>(resolve => blocker.listen(6876, '127.0.0.1', () => resolve()))

      try {
        const url = await startEmbeddedDevWorker(6876, 6879)
        expect(url).toBe('http://127.0.0.1:6877')
        const probe = await testPrivateWorker(url!)
        expect(probe.success).toBe(true)
      } finally {
        await stopEmbeddedDevWorker()
        await new Promise<void>(resolve => blocker.close(() => resolve()))
      }
    })
  })

  describe('Settings 界面渲染与规范', () => {
    it('在传输与网络面板中渲染校内私有中转服务卡片与开关', () => {
      useAppStore.setState({
        privateWorkerConfig: {
          enabled: false,
          endpointUrl: 'http://127.0.0.1:6880',
          authToken: ''
        }
      })

      const html = renderToStaticMarkup(
        React.createElement(Settings, { initialNav: 'network' })
      )

      expect(html).toContain('校内私有中转服务（实验性）')
      expect(html).toContain('免本地流量')
      expect(html).toContain('将云盘上传任务委托给校内私有工作机')
    })

    it('开启状态下展示服务节点地址、密钥输入框与一键测试按钮', () => {
      useAppStore.setState({
        privateWorkerConfig: {
          enabled: true,
          endpointUrl: 'http://127.0.0.1:6880',
          authToken: 'my_secret_token'
        }
      })

      const html = renderToStaticMarkup(
        React.createElement(Settings, { initialNav: 'network' })
      )

      expect(html).toContain('服务节点地址')
      expect(html).toContain('访问授权密钥 (Token)')
      expect(html).toContain('测试服务连接')
    })
  })

  describe('Daemon Script E2E (scripts/private-worker-daemon.mjs)', () => {
    it('能在本机直接启动并响应 /health 与测试连接', async () => {
      const port = 6889
      const daemonProcess = spawn('node', ['scripts/private-worker-daemon.mjs', String(port), 'e2e_token'], {
        stdio: 'pipe'
      })

      try {
        await new Promise<void>((resolve, reject) => {
          daemonProcess.stdout.on('data', chunk => {
            if (chunk.toString().includes('本地监听地址')) resolve()
          })
          daemonProcess.on('error', reject)
        })

        const res = await testPrivateWorker(`http://127.0.0.1:${port}`, 'e2e_token')
        expect(res.success).toBe(true)
        expect(res.version).toBe('1.0.0')
        expect(res.serverName).toBe('sjtu-private-worker')
        expect(res.latencyMs).toBeGreaterThan(0)
      } finally {
        daemonProcess.kill('SIGINT')
      }
    })
  })
})
