import { describe, it, expect, vi } from 'vitest'

// DownloadUI.tsx 导入会触发 store/app.ts 加载，其 persist 中间件在 node 环境访问 localStorage 会报错。
// 用 vi.mock 拦截 store，仅测纯函数。vi.mock hoist，在 import 前生效。
vi.mock('../store/app', () => ({
  useAppStore: (() => ({})) as unknown
}))

import { triStateFromCount, formatBytes } from './DownloadUI'

describe('triStateFromCount', () => {
  it('sel=0 → none', () => {
    expect(triStateFromCount(0, 5)).toBe('none')
    expect(triStateFromCount(0, 0)).toBe('none')
  })
  it('sel=total → all', () => {
    expect(triStateFromCount(5, 5)).toBe('all')
    expect(triStateFromCount(0, 0)).toBe('none') // 0 选 0 总按 sel===0 走 none
  })
  it('0<sel<total → some', () => {
    expect(triStateFromCount(3, 5)).toBe('some')
    expect(triStateFromCount(1, 5)).toBe('some')
  })
})

describe('formatBytes', () => {
  it('0 或负数 → 0 B', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(-1024)).toBe('0 B')
  })
  it('<1024 → B', () => {
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })
  it('<1MB → KB（1 位小数）', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })
  it('<1GB → MB（1 位小数）', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1024 * 1024 * 512)).toBe('512.0 MB')
  })
  it('≥1GB → GB（2 位小数）', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB')
    expect(formatBytes(1024 * 1024 * 1024 * 2.5)).toBe('2.50 GB')
  })
})
