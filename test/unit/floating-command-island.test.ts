import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as cheerio from 'cheerio'
import {
  FloatingCommandIsland,
  VIDEO_PERSPECTIVE_OPTIONS,
  STORAGE_DEST_OPTIONS,
  type FloatingCommandIslandProps,
  type VideoPerspective
} from '../../src/renderer/src/components/FloatingCommandIsland'
import { estimateResourceSize } from '../../src/shared/utils'
import { useAppStore } from '../../src/renderer/src/store/app'

describe('FloatingCommandIsland Component Unit Tests', () => {
  beforeEach(() => {
    // 重置全局 store 的 downloadMode
    useAppStore.getState().setDownloadMode('local')
  })

  // 辅助函数：根据 Props 用 renderToStaticMarkup 渲染并返回 cheerio 包装的根节点
  function renderIsland(props: Partial<FloatingCommandIslandProps> = {}) {
    const defaultProps: FloatingCommandIslandProps = {
      selectedSummary: {
        courseCount: 2,
        totalItems: 14,
        formattedSize: '约 1.25 GB',
        filesCount: 8,
        videoCount: 4,
        assignCount: 2,
        pptCount: 4
      },
      ...props
    }
    const html = renderToStaticMarkup(React.createElement(FloatingCommandIsland, defaultProps))
    return {
      html,
      $: cheerio.load(html),
      props: defaultProps
    }
  }

  // 辅助函数：提取 VNode 树中的可点击元素，用于单元测试事件回调
  function renderIslandVNode(props: Partial<FloatingCommandIslandProps> = {}) {
    const defaultProps: FloatingCommandIslandProps = {
      selectedSummary: {
        courseCount: 2,
        totalItems: 14,
        formattedSize: '约 1.25 GB',
        filesCount: 8,
        videoCount: 4,
        assignCount: 2,
        pptCount: 4
      },
      ...props
    }

    let capturedVNode: any = null
    function CaptureWrapper() {
      capturedVNode = FloatingCommandIsland(defaultProps)
      return capturedVNode
    }

    renderToStaticMarkup(React.createElement(CaptureWrapper))
    return { vnode: capturedVNode, props: defaultProps }
  }

  // 递归搜集指定 predicate 的虚拟 DOM 节点
  function findVNodes(node: any, predicate: (n: any) => boolean): any[] {
    if (!node) return []
    if (Array.isArray(node)) {
      return node.flatMap((item) => findVNodes(item, predicate))
    }
    if (typeof node !== 'object') return []
    const results: any[] = []
    if (predicate(node)) {
      results.push(node)
    }
    const children = node.props?.children
    if (children) {
      results.push(...findVNodes(children, predicate))
    }
    return results
  }

  describe('1. 基础渲染与显隐逻辑 (Visibility & Invariants)', () => {
    it('当 totalItems <= 0 且未显式指定 visible 时平滑隐藏 (返回 null)', () => {
      const { html } = renderIsland({
        selectedSummary: {
          totalItems: 0,
          formattedSize: '0 B'
        },
        visible: false
      })
      expect(html).toBe('')
    })

    it('当 totalItems === 0 但显式指定 visible=true 时强制呈现', () => {
      const { html, $ } = renderIsland({
        selectedSummary: {
          totalItems: 0,
          formattedSize: '0 B'
        },
        visible: true
      })
      expect(html).not.toBe('')
      expect($('[role="toolbar"]').length).toBe(1)
    })

    it('当 totalItems > 0 时正常呈现现代毛玻璃悬浮岛', () => {
      const { $, html } = renderIsland()
      const toolbar = $('[role="toolbar"]')
      expect(toolbar.length).toBe(1)
      expect(toolbar.attr('aria-label')).toBe('下载底栏智能指挥动作岛')
      expect(html).toContain('fixed bottom-6')
      expect(html).toContain('backdrop-blur-xl')
      expect(html).toContain('shadow-2xl')
      expect(html).toContain('rounded-2xl')
    })
  })

  describe('2. 信息汇聚胶囊 (Left Info Capsule)', () => {
    it('在多课程视图下呈现已选课程数、资源项数与预估容量', () => {
      const { $ } = renderIsland({
        isSingleCourse: false,
        selectedSummary: {
          courseCount: 3,
          totalItems: 28,
          formattedSize: '约 2.45 GB'
        }
      })
      const text = $('[role="toolbar"]').text()
      expect(text).toContain('✦ 已选 3 门课程 · 共 28 项资源 · 约 2.45 GB')
    })

    it('在单门课程视图 (isSingleCourse=true) 下呈现分类数与资源项数', () => {
      const { $ } = renderIsland({
        isSingleCourse: true,
        selectedSummary: {
          categoryCount: 4,
          totalItems: 16,
          formattedSize: '约 800.0 MB'
        }
      })
      const text = $('[role="toolbar"]').text()
      expect(text).toContain('✦ 已选 4 个分类 · 共 16 项资源 · 约 800.0 MB')
    })

    it('当提供 onClearSelection 回调时呈现清空小叉按钮并在点击时触发回调', () => {
      const onClearSelection = vi.fn()
      const { $ } = renderIsland({ onClearSelection })
      const clearBtn = $('button[aria-label="清空选择"]')
      expect(clearBtn.length).toBe(1)
      expect(clearBtn.text()).toContain('✕')

      // 测试点击事件
      const { vnode } = renderIslandVNode({ onClearSelection })
      const clearVNodes = findVNodes(vnode, (n) => n.props?.['aria-label'] === '清空选择')
      expect(clearVNodes.length).toBe(1)
      clearVNodes[0].props.onClick()
      expect(onClearSelection).toHaveBeenCalledTimes(1)
    })

    it('未提供 onClearSelection 时不呈现清空小叉按钮', () => {
      const { $ } = renderIsland({ onClearSelection: undefined })
      const clearBtn = $('button[aria-label="清空选择"]')
      expect(clearBtn.length).toBe(0)
    })
  })

  describe('3. 分类交互芯片组 (Category Filter Chips)', () => {
    it('正确呈现课件、视频、作业与PPT讲义 4 组分类芯片与计数', () => {
      const { $ } = renderIsland({
        selectedSummary: {
          totalItems: 25,
          formattedSize: '约 1.50 GB',
          filesCount: 10,
          videoCount: 6,
          assignCount: 4,
          pptCount: 5
        }
      })
      expect($('button:contains("📘 课件 (10)")').length).toBe(1)
      expect($('button:contains("🎬 视频 (6)")').length).toBe(1)
      expect($('button:contains("📝 作业 (4)")').length).toBe(1)
      expect($('button:contains("📑 PPT讲义 (5)")').length).toBe(1)
    })

    it('根据 categorySelection 属性呈现对应激活态 (aria-pressed 与高亮类名)', () => {
      const { $ } = renderIsland({
        categorySelection: {
          files: true,
          videos: false,
          assignments: true,
          pptPdf: false
        }
      })
      const filesChip = $('button:contains("📘 课件")')
      const assignChip = $('button:contains("📝 作业")')
      const pptChip = $('button:contains("📑 PPT讲义")')

      expect(filesChip.attr('aria-pressed')).toBe('true')
      expect(filesChip.attr('class')).toContain('bg-accent/10')
      expect(filesChip.attr('class')).toContain('text-accent')

      expect(assignChip.attr('aria-pressed')).toBe('true')

      expect(pptChip.attr('aria-pressed')).toBe('false')
      expect(pptChip.attr('class')).toContain('text-text-3')
    })

    it('点击课件、视频、作业、PPT芯片时触发 onToggleCategory 回调', () => {
      const onToggleCategory = vi.fn()
      const { vnode } = renderIslandVNode({ onToggleCategory })

      // 课件
      const filesBtn = findVNodes(vnode, (n) => n.props?.children?.props?.children?.[0]?.includes?.('📘 课件') || n.props?.children?.includes?.('📘 课件'))[0]
      expect(filesBtn).toBeDefined()
      filesBtn.props.onClick()
      expect(onToggleCategory).toHaveBeenCalledWith('files')

      // 视频
      const videoBtn = findVNodes(vnode, (n) => n.props?.children?.props?.children?.[0]?.includes?.('🎬 视频') || n.props?.children?.includes?.('🎬 视频'))[0]
      expect(videoBtn).toBeDefined()
      videoBtn.props.onClick()
      expect(onToggleCategory).toHaveBeenCalledWith('videos')

      // 作业
      const assignBtn = findVNodes(vnode, (n) => n.props?.children?.props?.children?.[0]?.includes?.('📝 作业') || n.props?.children?.includes?.('📝 作业'))[0]
      expect(assignBtn).toBeDefined()
      assignBtn.props.onClick()
      expect(onToggleCategory).toHaveBeenCalledWith('assignments')

      // PPT
      const pptBtn = findVNodes(vnode, (n) => n.props?.children?.props?.children?.[0]?.includes?.('📑 PPT讲义') || n.props?.children?.includes?.('📑 PPT讲义'))[0]
      expect(pptBtn).toBeDefined()
      pptBtn.props.onClick()
      expect(onToggleCategory).toHaveBeenCalledWith('pptPdf')

      expect(onToggleCategory).toHaveBeenCalledTimes(4)
    })
  })

  describe('4. 视频机位弹出菜单 (Video Perspective Popover)', () => {
    it('包含视频机位下拉触发按钮 (aria-haspopup="menu")', () => {
      const { $ } = renderIsland()
      const trigger = $('button[aria-label="选择视频机位"]')
      expect(trigger.length).toBe(1)
      expect(trigger.attr('aria-haspopup')).toBe('menu')
      expect(trigger.text().trim()).toBe('▾')
    })

    it('VIDEO_PERSPECTIVE_OPTIONS 导出 4 大标准视角并具备清晰文案', () => {
      expect(VIDEO_PERSPECTIVE_OPTIONS.length).toBe(4)
      const keys = VIDEO_PERSPECTIVE_OPTIONS.map((o) => o.key)
      expect(keys).toEqual(['all', 'teacher', 'ppt', 'audio'])

      expect(VIDEO_PERSPECTIVE_OPTIONS[0].label).toBe('双机位同时下载')
      expect(VIDEO_PERSPECTIVE_OPTIONS[1].label).toBe('仅教师画面 (推荐)')
      expect(VIDEO_PERSPECTIVE_OPTIONS[2].label).toBe('仅PPT投影')
      expect(VIDEO_PERSPECTIVE_OPTIONS[3].label).toBe('仅原声音频 (M4A)')
    })

    it('切换机位时触发 onPerspectiveChange 回调', () => {
      const onPerspectiveChange = vi.fn()
      const { vnode } = renderIslandVNode({
        defaultPopoverOpen: true,
        onPerspectiveChange
      })

      // 在 Popover 内查找机位选项菜单项
      const menuItems = findVNodes(vnode, (n) => n.props?.role === 'menuitem')
      expect(menuItems.length).toBe(4)

      // 点击 "仅PPT投影"
      menuItems[2].props.onClick()
      expect(onPerspectiveChange).toHaveBeenCalledWith('ppt')

      // 点击 "仅原声音频 (M4A)"
      menuItems[3].props.onClick()
      expect(onPerspectiveChange).toHaveBeenCalledWith('audio')
    })
  })

  describe('5. 存储目标切换胶囊 (Storage Destination Switcher)', () => {
    it('正确呈现 STORAGE_DEST_OPTIONS 中的 本地 / 云盘 / 双备份 3 大存储选项', () => {
      const { $ } = renderIsland({ downloadMode: 'cloud' })
      const destGroup = $('[role="group"][aria-label="存储目标切换"]')
      expect(destGroup.length).toBe(1)

      const buttons = destGroup.find('button')
      expect(buttons.length).toBe(3)
      expect(buttons.eq(0).text()).toContain('📁 本地')
      expect(buttons.eq(1).text()).toContain('☁️ 云盘')
      expect(buttons.eq(2).text()).toContain('双备份')

      // cloud 应该处于激活态
      expect(buttons.eq(1).attr('aria-pressed')).toBe('true')
      expect(buttons.eq(0).attr('aria-pressed')).toBe('false')
    })

    it('点击存储模式选项触发 onDownloadModeChange 回调', () => {
      const onDownloadModeChange = vi.fn()
      const { vnode } = renderIslandVNode({
        downloadMode: 'local',
        onDownloadModeChange
      })

      const destButtons = findVNodes(
        vnode,
        (n) => n.props?.role === 'button' && (n.props?.children === '☁️ 云盘' || n.props?.children === '双备份')
      )
      expect(destButtons.length).toBe(2)

      // 点击云盘
      destButtons[0].props.onClick()
      expect(onDownloadModeChange).toHaveBeenCalledWith('cloud')

      // 点击双备份
      destButtons[1].props.onClick()
      expect(onDownloadModeChange).toHaveBeenCalledWith('both')
    })

    it('未传递 onDownloadModeChange 时，自动更新 Zustand 全局 store.downloadMode', () => {
      useAppStore.getState().setDownloadMode('local')
      const { vnode } = renderIslandVNode({
        downloadMode: undefined,
        onDownloadModeChange: undefined
      })

      const cloudBtn = findVNodes(vnode, (n) => n.props?.children === '☁️ 云盘')[0]
      expect(cloudBtn).toBeDefined()
      cloudBtn.props.onClick()

      expect(useAppStore.getState().downloadMode).toBe('cloud')
    })
  })

  describe('6. 主执行下载大按钮 (Primary Action CTA)', () => {
    it('主执行按钮文案符合规范：立即下载 ${formattedSize} (⏎)', () => {
      const { $ } = renderIsland({
        selectedSummary: {
          totalItems: 10,
          formattedSize: '约 1.80 GB'
        }
      })
      const ctaBtn = $('button[aria-label="立即下载 约 1.80 GB"]')
      expect(ctaBtn.length).toBe(1)
      expect(ctaBtn.text()).toContain('立即下载 约 1.80 GB')
      expect(ctaBtn.text()).toContain('(⏎)')
    })

    it('点击主执行按钮时触发 onStartDownload 及 onDownload 回调', () => {
      const onStartDownload = vi.fn()
      const onDownload = vi.fn()
      const { vnode } = renderIslandVNode({
        onStartDownload,
        onDownload
      })

      const ctaBtn = findVNodes(vnode, (n) => n.props?.['aria-label']?.startsWith?.('立即下载'))[0]
      expect(ctaBtn).toBeDefined()
      ctaBtn.props.onClick()

      expect(onStartDownload).toHaveBeenCalledTimes(1)
      expect(onDownload).toHaveBeenCalledTimes(1)
    })
  })

  describe('7. 无障碍属性完备性 (Accessibility)', () => {
    it('整体结构具备清晰的角色声明与 ARIA 标记', () => {
      const { $ } = renderIsland()
      expect($('[role="toolbar"]').length).toBe(1)
      expect($('[role="group"]').length).toBe(1)
      expect($('button[role="button"]').length).toBeGreaterThanOrEqual(6)
      expect($('button[aria-haspopup="menu"]').length).toBe(1)
    })
  })

  describe('8. 与容量预估引擎真实联动 (Real-Time Resource Size Estimation Integration)', () => {
    it('将 estimateResourceSize 计算结果传入后，胶囊与CTA按钮完美同步展示', () => {
      // 模拟真实选课场景：120MB课件，3讲视频(教师视角 3*450MB=1350MB)，4个作业(8MB)，3个PPT生成(45MB)
      // 总量 = 120 + 1350 + 8 + 45 = 1523 MB -> 约 1.49 GB
      const MB = 1024 * 1024
      const est = estimateResourceSize({
        fileBytes: 120 * MB,
        videoCount: 3,
        perspective: 'teacher',
        hasAssignments: true,
        assignmentCount: 4,
        hasPptPdf: true,
        pptPdfCount: 3
      })

      const { $ } = renderIsland({
        selectedSummary: {
          courseCount: 1,
          totalItems: 20,
          formattedSize: est.formattedSize,
          filesCount: 10,
          videoCount: 3,
          assignCount: 4,
          pptCount: 3
        }
      })

      const toolbarText = $('[role="toolbar"]').text()
      expect(toolbarText).toContain('✦ 已选 1 门课程 · 共 20 项资源 · 约 1.49 GB')
      expect(toolbarText).toContain('立即下载 约 1.49 GB')
    })
  })
})
