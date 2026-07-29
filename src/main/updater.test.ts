import { describe, it, expect, vi, afterEach } from 'vitest'

// updater.ts 顶部 import { app } from 'electron'，纯 node 环境无法加载真实 electron。
// matchAsset 是纯函数不调 app，只需让模块能 import。vi.mock hoist，会在 import 前拦截。
vi.mock('electron', () => ({
  app: {
    getPath: () => '',
    getVersion: () => '0.0.0',
    relaunch: () => {},
    quit: () => {},
    setAppUserModelId: () => {}
  }
}))

import { matchAsset } from './updater'

describe('matchAsset', () => {
  const originalPlatform = process.platform
  const originalArch = process.arch

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    Object.defineProperty(process, 'arch', { value: originalArch, configurable: true })
  })

  const setEnv = (platform: string, arch: string): void => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    Object.defineProperty(process, 'arch', { value: arch, configurable: true })
  }

  const assets = [
    { name: 'sjtu-course-downloader-2.3.6-win-x64.exe', browser_download_url: 'https://x/win.exe', size: 100 },
    { name: 'sjtu-course-downloader-2.3.6-mac-arm64.zip', browser_download_url: 'https://x/mac-arm.zip', size: 200 },
    { name: 'sjtu-course-downloader-2.3.6-mac.zip', browser_download_url: 'https://x/mac.zip', size: 201 },
    { name: 'sjtu-course-downloader-2.3.6-linux-x64.AppImage', browser_download_url: 'https://x/linux.AppImage', size: 300 }
  ]

  it('win32 匹配 -win-{arch}.exe', () => {
    setEnv('win32', 'x64')
    const r = matchAsset(assets)
    expect(r).not.toBeNull()
    expect(r!.fileName).toBe('sjtu-course-downloader-2.3.6-win-x64.exe')
    expect(r!.url).toBe('https://x/win.exe')
    expect(r!.size).toBe(100)
  })

  it('darwin 精确架构优先匹配', () => {
    setEnv('darwin', 'arm64')
    const r = matchAsset(assets)
    expect(r!.fileName).toBe('sjtu-course-downloader-2.3.6-mac-arm64.zip')
  })

  it('darwin 无精确架构兜底 universal -mac.zip', () => {
    setEnv('darwin', 'x64') // assets 里无 mac-x64.zip
    const r = matchAsset(assets)
    expect(r!.fileName).toBe('sjtu-course-downloader-2.3.6-mac.zip')
  })

  it('linux 匹配 -linux-{arch}.AppImage', () => {
    setEnv('linux', 'x64')
    const r = matchAsset(assets)
    expect(r!.fileName).toBe('sjtu-course-downloader-2.3.6-linux-x64.AppImage')
  })

  it('不支持的平台返回 null', () => {
    setEnv('freebsd', 'x64')
    expect(matchAsset(assets)).toBeNull()
  })

  it('架构无匹配返回 null', () => {
    setEnv('win32', 'arm64') // assets 里无 win-arm64.exe
    expect(matchAsset(assets)).toBeNull()
  })

  it('非数组输入返回 null', () => {
    expect(matchAsset(null)).toBeNull()
    expect(matchAsset(undefined)).toBeNull()
    expect(matchAsset('not-array')).toBeNull()
    expect(matchAsset({})).toBeNull()
  })

  it('过滤掉缺关键字段的 asset', () => {
    setEnv('win32', 'x64')
    const bad = [
      { name: 'x-win-x64.exe' /* 缺 browser_download_url */ },
      { browser_download_url: 'https://x' /* 缺 name */ }
    ]
    expect(matchAsset(bad)).toBeNull()
  })

  it('size 缺失或非正数时返回 null size', () => {
    setEnv('win32', 'x64')
    const noSize = [{ name: 'app-win-x64.exe', browser_download_url: 'https://x' }]
    const r = matchAsset(noSize)
    expect(r).not.toBeNull()
    expect(r!.size).toBeNull()
  })
})
