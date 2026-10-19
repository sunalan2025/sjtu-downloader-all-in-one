import { describe, it, expect } from 'vitest'
import net from 'node:net'
import { testPortAvailability, getSafeAvailablePort } from '../../scripts/port-helper.mjs'

describe('Port Helper Unit Tests', () => {
  it('correctly reports true for an unoccupied port and false for an occupied port', async () => {
    // 启动一个临时本地 TCP 服务器占用一个端口
    const tempServer = net.createServer()
    await new Promise<void>((resolve) => {
      tempServer.listen(0, '127.0.0.1', () => resolve())
    })
    const occupiedPort = (tempServer.address() as net.AddressInfo).port

    // 测试占用状态
    const availableWhenOccupied = await testPortAvailability(occupiedPort, '127.0.0.1')
    expect(availableWhenOccupied).toBe(false)

    // 关闭服务器释放端口
    await new Promise<void>((resolve) => {
      tempServer.close(() => resolve())
    })

    // 释放后应重新变为可用
    const availableAfterClosed = await testPortAvailability(occupiedPort, '127.0.0.1')
    expect(availableAfterClosed).toBe(true)
  })

  it('skips occupied ports and increments to the next available port', async () => {
    // 监听一个临时端口
    const tempServer = net.createServer()
    await new Promise<void>((resolve) => {
      tempServer.listen(0, '127.0.0.1', () => resolve())
    })
    const basePort = (tempServer.address() as net.AddressInfo).port

    try {
      // 从已被占用的 basePort 起步寻找安全端口，应该自动跳到 basePort + 1（或之后）
      const safePort = await getSafeAvailablePort(basePort, '127.0.0.1', 10)
      expect(safePort).toBeGreaterThan(basePort)
    } finally {
      await new Promise<void>((resolve) => {
        tempServer.close(() => resolve())
      })
    }
  })

  it('resolves an available port when tested on current system', async () => {
    const safePort = await getSafeAvailablePort(5173, '127.0.0.1')
    expect(typeof safePort).toBe('number')
    expect(safePort).toBeGreaterThanOrEqual(5173)

    // 验证返回的 safePort 确实可以正常建立监听
    const canListen = await testPortAvailability(safePort, '127.0.0.1')
    expect(canListen).toBe(true)
  })
})
