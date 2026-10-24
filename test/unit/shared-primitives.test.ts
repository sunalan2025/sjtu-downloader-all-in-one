import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  isClickOutside,
  registerClickOutside,
  useClickOutside
} from '../../src/renderer/src/hooks/useClickOutside'
import { useToast } from '../../src/renderer/src/hooks/useToast'
import { Toast } from '../../src/renderer/src/components/Toast'
import * as cheerio from 'cheerio'
import { cleanParenthesesInTitle } from '../../src/shared/utils'

describe('useClickOutside & registerClickOutside Primitives', () => {
  let listeners: Record<string, Array<(e: any) => void>> = {}

  beforeEach(() => {
    listeners = {}
    ;(global as any).document = {
      addEventListener: vi.fn((event: string, cb: any) => {
        listeners[event] = listeners[event] || []
        listeners[event].push(cb)
      }),
      removeEventListener: vi.fn((event: string, cb: any) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter(fn => fn !== cb)
        }
      })
    }
  })

  afterEach(() => {
    listeners = {}
    vi.restoreAllMocks()
  })

  it('isClickOutside 纯函数精准判定内外边界', () => {
    const targetInside = {} as Node
    const targetOutside = {} as Node
    const targetIgnored = {} as Node

    const containerEl = {
      contains: vi.fn((t) => t === targetInside)
    }
    const ignoredEl = {
      contains: vi.fn((t) => t === targetIgnored)
    }

    const ref = { current: containerEl as any }
    const ignoreRef = { current: ignoredEl as any }

    // 点击内部 → false
    expect(isClickOutside(targetInside, ref, [ignoreRef])).toBe(false)

    // 点击忽略元素 → false
    expect(isClickOutside(targetIgnored, ref, [ignoreRef])).toBe(false)

    // 点击外部 → true
    expect(isClickOutside(targetOutside, ref, [ignoreRef])).toBe(true)

    // target 为 null 或 ref 为空 → false
    expect(isClickOutside(null, ref)).toBe(false)
    expect(isClickOutside(targetOutside, { current: null })).toBe(false)
  })

  it('registerClickOutside 注册并响应 mousedown 外部点击与 cleanup 卸载', () => {
    const onClickOutside = vi.fn()
    const targetEl = { contains: vi.fn(() => false) }
    const ref = { current: targetEl as any }

    const cleanup = registerClickOutside(ref, onClickOutside)

    expect(global.document.addEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function))
    expect(global.document.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function))

    // 触发外部点击
    const mousedownHandler = listeners['mousedown']?.[0]
    expect(mousedownHandler).toBeDefined()
    mousedownHandler({ target: {} })
    expect(onClickOutside).toHaveBeenCalledTimes(1)

    // 卸载
    cleanup()
    expect(global.document.removeEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function))
    expect(global.document.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  it('registerClickOutside 响应 Escape 键关闭与自定义 onEscape', () => {
    const onClickOutside = vi.fn()
    const onEscape = vi.fn()
    const targetEl = { contains: vi.fn(() => false) }
    const ref = { current: targetEl as any }

    // 带自定义 onEscape
    const cleanup1 = registerClickOutside(ref, onClickOutside, { onEscape })
    const keydownHandler1 = listeners['keydown']?.[0]
    keydownHandler1({ key: 'Escape' })
    expect(onEscape).toHaveBeenCalledTimes(1)
    expect(onClickOutside).not.toHaveBeenCalled()
    cleanup1()

    listeners = {}
    // 未带 onEscape 时回退 onClickOutside
    const cleanup2 = registerClickOutside(ref, onClickOutside)
    const keydownHandler2 = listeners['keydown']?.[0]
    keydownHandler2({ key: 'Escape' })
    expect(onClickOutside).toHaveBeenCalledTimes(1)
    cleanup2()
  })

  it('enabled 为 false 时 registerClickOutside 不注册任何事件', () => {
    const onClickOutside = vi.fn()
    const ref = { current: { contains: vi.fn() } as any }

    const cleanup = registerClickOutside(ref, onClickOutside, { enabled: false })
    expect(global.document.addEventListener).not.toHaveBeenCalled()
    cleanup()
  })

  it('useClickOutside hook 正常被组件调用不抛错', () => {
    const ref = { current: null }
    function Component() {
      useClickOutside(ref, () => {})
      return React.createElement('div')
    }
    expect(() => renderToStaticMarkup(React.createElement(Component))).not.toThrow()
  })
})

describe('useToast Hook & Toast Component', () => {
  let captured: ReturnType<typeof useToast> | null = null

  function ToastProbe({ duration }: { duration?: number }) {
    captured = useToast(duration)
    return React.createElement('div')
  }

  function runToastHook(duration?: number) {
    captured = null
    renderToStaticMarkup(React.createElement(ToastProbe, { duration }))
    if (!captured) throw new Error('useToast failed to run')
    return captured
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('初始状态 toast 为 null，具备 showToast 与 hideToast 函数', () => {
    const { toast, showToast, hideToast } = runToastHook()
    expect(toast).toBeNull()
    expect(typeof showToast).toBe('function')
    expect(typeof hideToast).toBe('function')
  })

  it('Toast 组件在 toast 为 null 时渲染为空', () => {
    const html = renderToStaticMarkup(React.createElement(Toast, { toast: null }))
    expect(html).toBe('')
  })

  it('Toast 组件根据不同类型渲染对应 Emoji 与样式', () => {
    const successHtml = renderToStaticMarkup(
      React.createElement(Toast, {
        toast: { text: '下载成功', type: 'success' }
      })
    )
    const $success = cheerio.load(successHtml)
    expect($success('[data-testid="toast-notification"]').length).toBe(1)
    expect(successHtml).toContain('✅')
    expect(successHtml).toContain('下载成功')

    const errorHtml = renderToStaticMarkup(
      React.createElement(Toast, {
        toast: { text: '操作失败', type: 'error' }
      })
    )
    expect(errorHtml).toContain('⚠️')
    expect(errorHtml).toContain('操作失败')

    const infoHtml = renderToStaticMarkup(
      React.createElement(Toast, {
        toast: { text: '正在处理中', type: 'info' }
      })
    )
    expect(infoHtml).toContain('ℹ️')
    expect(infoHtml).toContain('正在处理中')
  })

  it('Toast 组件支持 bottom-wide 宽栏布局样式', () => {
    const wideHtml = renderToStaticMarkup(
      React.createElement(Toast, {
        toast: { text: '宽栏提示', type: 'info' },
        position: 'bottom-wide'
      })
    )
    expect(wideHtml).toContain('bottom-16')
    expect(wideHtml).toContain('left-4')
    expect(wideHtml).toContain('right-4')
  })
})
describe('cleanParenthesesInTitle 标题与课程名去括号纯函数测试', () => {
  it('正确将末尾教学班号 (1) 转化为 1班 并清除括号', () => {
    expect(cleanParenthesesInTitle('物理化学 (1)')).toBe('物理化学 1班')
    expect(cleanParenthesesInTitle('科技实习与创新—生物信息学 (1)')).toBe('科技实习与创新—生物信息学 1班')
  })

  it('正确将课程分类 (B类) 保留文字并移除括号，同时处理班号 (2)', () => {
    expect(cleanParenthesesInTitle('大学物理 (B类) (2)')).toBe('大学物理 B类 2班')
    expect(cleanParenthesesInTitle('高等数学（A类）（1）')).toBe('高等数学 A类 1班')
  })

  it('正确处理作业标题中的课程分类与第N次作业', () => {
    expect(cleanParenthesesInTitle('大学物理二 (B类) 第五周周二作业')).toBe('大学物理二 B类 第五周周二作业')
    expect(cleanParenthesesInTitle('《热力学第二定律》作业 物理化学 (1)')).toBe('《热力学第二定律》作业 物理化学 1班')
    expect(cleanParenthesesInTitle('第(1)次作业')).toBe('第1次作业')
    expect(cleanParenthesesInTitle('第（2）讲课件')).toBe('第2讲课件')
  })

  it('容灾测试：空字符串、无括号文本直接安全返回', () => {
    expect(cleanParenthesesInTitle('')).toBe('')
    expect(cleanParenthesesInTitle('大学英语')).toBe('大学英语')
  })
})
