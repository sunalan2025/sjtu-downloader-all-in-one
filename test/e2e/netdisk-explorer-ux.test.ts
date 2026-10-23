import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as cheerio from 'cheerio'
import {
  NetdiskCourseExplorer,
  GridView,
  ListView,
  CategoryLevelHeader,
  VideoPerspectiveFilterPills,
  isVideoCategory,
  isTeacherPerspectiveItem,
  isPptPerspectiveItem,
  type NetdiskCourseItem,
  type NetdiskCategoryItem,
  type NetdiskFileItem,
  type NetdiskCourseExplorerProps,
  type NetdiskNavState
} from '../../src/renderer/src/components/NetdiskCourseExplorer'
import { FloatingCommandIsland } from '../../src/renderer/src/components/FloatingCommandIsland'
import { useAppStore } from '../../src/renderer/src/store/app'

// 搜集虚拟 DOM 节点用于测试事件绑定
function findVNodes(node: any, predicate: (n: any) => boolean): any[] {
  if (!node) return []
  if (Array.isArray(node)) {
    return node.flatMap(item => findVNodes(item, predicate))
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

function createMockCourse(overrides: Partial<NetdiskCourseItem> = {}): NetdiskCourseItem {
  const fileItems: NetdiskFileItem[] = [
    {
      id: 'canvas_file_101_1',
      name: '01-课程大纲.pdf',
      size: 2 * 1024 * 1024,
      type: 'PDF',
      selected: false,
      onToggle: vi.fn(),
      onDownloadSingle: vi.fn()
    },
    {
      id: 'canvas_file_101_2',
      name: '02-第一讲课件.pptx',
      size: 10 * 1024 * 1024,
      type: 'PPTX',
      selected: true,
      onToggle: vi.fn(),
      onDownloadSingle: vi.fn()
    }
  ]

  const videoItems: NetdiskFileItem[] = [
    {
      id: 'canvas_lecture_101_1_teacher',
      name: '软件工程 - 第1讲 教师视角 (MP4)',
      size: 450 * 1024 * 1024,
      type: 'MP4',
      date: '2025-03-01',
      selected: true,
      onToggle: vi.fn(),
      onDownloadSingle: vi.fn()
    },
    {
      id: 'canvas_lecture_101_1_ppt',
      name: '软件工程 - 第1讲 PPT投影视角 (MP4)',
      size: 200 * 1024 * 1024,
      type: 'MP4',
      date: '2025-03-01',
      selected: false,
      onToggle: vi.fn(),
      onDownloadSingle: vi.fn()
    }
  ]

  const categories: NetdiskCategoryItem[] = [
    {
      id: 'files',
      name: '课件资料',
      icon: 'file',
      state: 'some',
      onToggle: vi.fn(),
      items: fileItems,
      renderExtra: React.createElement('div', null, '课件扩展面板')
    },
    {
      id: 'videos',
      name: '课堂视频',
      icon: 'video',
      state: 'some',
      onToggle: vi.fn(),
      items: videoItems,
      renderExtra: React.createElement('div', null, '视频扩展面板')
    },
    {
      id: 'assignments',
      name: '作业与实验',
      icon: 'assignment',
      state: 'none',
      onToggle: vi.fn(),
      items: []
    },
    {
      id: 'pptPdf',
      name: 'PPT 讲义 (PDF)',
      icon: 'presentation',
      state: 'none',
      onToggle: vi.fn(),
      items: []
    }
  ]

  return {
    id: 101,
    name: '软件工程',
    code: 'SE101',
    term: '2025-2026-1',
    teacher: '张教授',
    state: 'some',
    itemCount: 4,
    totalBytes: 662 * 1024 * 1024,
    categories,
    onToggle: vi.fn(),
    onEnter: vi.fn(),
    onDownload: vi.fn(),
    perspective: 'all',
    onPerspectiveChange: vi.fn(),
    ...overrides
  }
}

describe('NetdiskCourseExplorer UX Redesign Suite (Task 4)', () => {
  beforeEach(() => {
    useAppStore.getState().setDownloadMode('local')
  })

  function renderExplorer(props: Partial<NetdiskCourseExplorerProps> = {}) {
    const course = createMockCourse()
    const defaultProps: NetdiskCourseExplorerProps = {
      courses: [course],
      viewMode: 'grid',
      navState: { level: 'root' },
      onNavigate: vi.fn(),
      onDownloadSingle: vi.fn(),
      onDownloadCourse: vi.fn(),
      ...props
    }

    const html = renderToStaticMarkup(React.createElement(NetdiskCourseExplorer, defaultProps))
    return {
      html,
      $: cheerio.load(html),
      props: defaultProps,
      course
    }
  }

  function renderExplorerVNode(props: Partial<NetdiskCourseExplorerProps> = {}) {
    const course = createMockCourse()
    const defaultProps: NetdiskCourseExplorerProps = {
      courses: [course],
      viewMode: 'grid',
      navState: { level: 'root' },
      onNavigate: vi.fn(),
      onDownloadSingle: vi.fn(),
      onDownloadCourse: vi.fn(),
      ...props
    }

    let captured: any = null
    function Wrapper() {
      captured = (NetdiskCourseExplorer as any).type(defaultProps)
      return captured
    }

    renderToStaticMarkup(React.createElement(Wrapper))
    return { vnode: captured, props: defaultProps, course }
  }

  // ─────────────────────────────────────────────────────────────
  // 1. 二级目录白板清理验证 (No In-Content Banners in Level 2)
  // ─────────────────────────────────────────────────────────────
  describe('1. 二级目录白板清理验证 (Clean In-Content Banners in Level 2)', () => {
    it('在 GridView 下进入二级目录 (course)，彻底不包含 "专属操作" 文本与白板容器', () => {
      const { html, $ } = renderExplorer({
        viewMode: 'grid',
        navState: { level: 'course', courseId: 101 }
      })

      // 验证整个 HTML 中彻底没有 "专属操作"
      expect(html).not.toContain('专属操作')
      expect($('*:contains("专属操作")').length).toBe(0)

      // 验证 4 个分类文件夹卡片完整正常呈现
      expect(html).toContain('课件资料')
      expect(html).toContain('课堂视频')
      expect(html).toContain('作业与实验')
      expect(html).toContain('PPT 讲义 (PDF)')
    })

    it('在 ListView 下进入二级目录 (course)，彻底不包含 "专属操作" 文本', () => {
      const { html, $ } = renderExplorer({
        viewMode: 'list',
        navState: { level: 'course', courseId: 101 }
      })

      expect(html).not.toContain('专属操作')
      expect($('*:contains("专属操作")').length).toBe(0)
      expect(html).toContain('课件资料')
      expect(html).toContain('课堂视频')
    })

    it('在三级目录 (category) ListView 下，不渲染分类级的侵入性 renderExtra 面板', () => {
      const { html } = renderExplorer({
        viewMode: 'list',
        navState: { level: 'category', courseId: 101, categoryId: 'files' }
      })

      // currentCategory.renderExtra "课件扩展面板" 应当被彻底移除
      expect(html).not.toContain('课件扩展面板')
      expect(html).not.toContain('专属操作')
    })

    it('在三级目录 (category) GridView 下，同样不渲染侵入性 renderExtra 白板条', () => {
      const { html } = renderExplorer({
        viewMode: 'grid',
        navState: { level: 'category', courseId: 101, categoryId: 'files' }
      })

      expect(html).not.toContain('课件扩展面板')
      expect(html).not.toContain('专属操作')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 2. 视频分类顶部 Filter Pills 视角筛选器验证 (Video Perspective Filter Pills)
  // ─────────────────────────────────────────────────────────────
  describe('2. 视频分类顶部 Filter Pills 视角筛选器验证', () => {
    it('工具函数 isVideoCategory 正确识别视频与音频分类', () => {
      expect(isVideoCategory({ id: 'videos', name: '课堂视频', state: 'none', onToggle: vi.fn(), items: [] })).toBe(true)
      expect(isVideoCategory({ id: 'audio_recordings', name: '录音', icon: 'audio', state: 'none', onToggle: vi.fn(), items: [] })).toBe(true)
      expect(isVideoCategory({ id: 'files', name: '课件资料', icon: 'file', state: 'none', onToggle: vi.fn(), items: [] })).toBe(false)
    })

    it('工具函数 isTeacherPerspectiveItem 与 isPptPerspectiveItem 精准区分机位流', () => {
      const teacherItem: NetdiskFileItem = {
        id: 'canvas_lecture_1_teacher',
        name: '第1讲 教师视角 (MP4)',
        selected: false,
        onToggle: vi.fn()
      }
      const pptItem: NetdiskFileItem = {
        id: 'canvas_lecture_1_ppt',
        name: '第1讲 PPT投影视角 (MP4)',
        selected: false,
        onToggle: vi.fn()
      }

      expect(isTeacherPerspectiveItem(teacherItem)).toBe(true)
      expect(isPptPerspectiveItem(teacherItem)).toBe(false)
      expect(isTeacherPerspectiveItem(pptItem)).toBe(false)
      expect(isPptPerspectiveItem(pptItem)).toBe(true)
    })

    it('进入课堂视频分类三级目录时，顶栏内嵌 Filter Pills 胶囊分段器', () => {
      const { $, html } = renderExplorer({
        viewMode: 'grid',
        navState: { level: 'category', courseId: 101, categoryId: 'videos' }
      })

      const pills = $('[data-testid="video-filter-pills"]')
      expect(pills.length).toBe(1)
      expect(html).toContain('全部视频 2')
      expect(html).toContain('仅教师视角 1')
      expect(html).toContain('仅PPT投屏 1')
    })

    it('在 ListView 模式下，视频分类顶栏同样内嵌 Filter Pills 胶囊分段器', () => {
      const { $, html } = renderExplorer({
        viewMode: 'list',
        navState: { level: 'category', courseId: 101, categoryId: 'videos' }
      })

      const pills = $('[data-testid="video-filter-pills"]')
      expect(pills.length).toBe(1)
      expect(html).toContain('全部视频 2')
      expect(html).toContain('仅教师视角 1')
      expect(html).toContain('仅PPT投屏 1')
    })

    it('点击仅教师视角胶囊时，触发视角切换与切流更新', () => {
      const onPerspectiveChange = vi.fn()
      const course = createMockCourse({ onPerspectiveChange })

      // 1. 验证 VideoPerspectiveFilterPills 胶囊组件点击交互
      let pillsVNode: any = null
      function PillsWrapper() {
        pillsVNode = VideoPerspectiveFilterPills({
          perspective: 'all',
          totalCount: 2,
          teacherCount: 1,
          pptCount: 1,
          onChange: onPerspectiveChange
        })
        return pillsVNode
      }
      renderToStaticMarkup(React.createElement(PillsWrapper))

      const buttons = findVNodes(pillsVNode, n => n.type === 'button' && (Array.isArray(n.props?.children) ? n.props.children.join('') : String(n.props?.children || '')).includes('仅教师视角'))
      expect(buttons.length).toBeGreaterThan(0)

      buttons[0].props.onClick()
      expect(onPerspectiveChange).toHaveBeenCalledWith('teacher')

      // 2. 验证 GridView 中 CategoryLevelHeader 视角分流联动回调
      let gridVNode: any = null
      function GridWrapper() {
        gridVNode = GridView({
          courses: [course],
          currentCourse: course,
          currentCategory: course.categories[1],
          navState: { level: 'category', courseId: 101, categoryId: 'videos' },
          onNavigate: vi.fn(),
          onPerspectiveChange
        })
        return gridVNode
      }
      renderToStaticMarkup(React.createElement(GridWrapper))

      const headerNode = findVNodes(gridVNode, n => n.type === CategoryLevelHeader)[0]
      expect(headerNode).toBeDefined()
      headerNode.props.onPerspectiveChange('teacher')

      expect(onPerspectiveChange).toHaveBeenCalledWith('teacher')
      expect(course.onPerspectiveChange).toHaveBeenCalledWith('teacher')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 3. 单文件悬停即现极速下载验证 (Hover to Reveal Download Button)
  // ─────────────────────────────────────────────────────────────
  describe('3. 单文件悬停即现极速下载验证 (Hover to Reveal Download Button)', () => {
    it('在 GridView 三级目录下，每个未禁用的文件卡片均渲染单个下载按钮', () => {
      const { $ } = renderExplorer({
        viewMode: 'grid',
        navState: { level: 'category', courseId: 101, categoryId: 'files' }
      })

      const downloadButtons = $('button[data-testid="single-download-btn"]')
      expect(downloadButtons.length).toBe(2)
      expect(downloadButtons.first().text()).toContain('下载')
    })

    it('在 ListView 三级目录下，每个未禁用的文件行均渲染单个下载按钮', () => {
      const { $ } = renderExplorer({
        viewMode: 'list',
        navState: { level: 'category', courseId: 101, categoryId: 'files' }
      })

      const downloadButtons = $('button[data-testid="single-download-btn"]')
      expect(downloadButtons.length).toBe(2)
      expect(downloadButtons.first().text()).toContain('下载')
    })

    it('点击单个下载按钮触发对应 item.onDownloadSingle 与 onDownloadSingle 回调，并弹出 Toast 提示', () => {
      const onDownloadSingleMock = vi.fn()
      const showToastMock = vi.fn()
      const course = createMockCourse()
      const targetItem = course.categories[0].items[0]

      // 1. 测试提供外部 onDownloadSingle 时的回调与 Toast
      let gridVNode: any = null
      function GridWrapper() {
        gridVNode = GridView({
          courses: [course],
          currentCourse: course,
          currentCategory: course.categories[0],
          navState: { level: 'category', courseId: 101, categoryId: 'files' },
          onNavigate: vi.fn(),
          onDownloadSingle: onDownloadSingleMock,
          showToast: showToastMock
        })
        return gridVNode
      }
      renderToStaticMarkup(React.createElement(GridWrapper))

      const downloadButtons = findVNodes(gridVNode, n => n.type === 'button' && n.props?.['data-testid'] === 'single-download-btn')
      expect(downloadButtons.length).toBe(2)

      const fakeEvent = { stopPropagation: vi.fn() }
      downloadButtons[0].props.onClick(fakeEvent)

      expect(fakeEvent.stopPropagation).toHaveBeenCalled()
      expect(onDownloadSingleMock).toHaveBeenCalledWith(targetItem, course, course.categories[0])
      expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining(targetItem.name), 'success')

      // 2. 测试未提供外部 onDownloadSingle 时，回退执行 targetItem.onDownloadSingle
      let gridVNodeFallback: any = null
      function GridFallbackWrapper() {
        gridVNodeFallback = GridView({
          courses: [course],
          currentCourse: course,
          currentCategory: course.categories[0],
          navState: { level: 'category', courseId: 101, categoryId: 'files' },
          onNavigate: vi.fn()
        })
        return gridVNodeFallback
      }
      renderToStaticMarkup(React.createElement(GridFallbackWrapper))

      const fallbackButtons = findVNodes(gridVNodeFallback, n => n.type === 'button' && n.props?.['data-testid'] === 'single-download-btn')
      fallbackButtons[0].props.onClick({ stopPropagation: vi.fn() })
      expect(targetItem.onDownloadSingle).toHaveBeenCalled()
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 4. 底栏动作岛在非分栏模式下的响应式挂载与交互验证
  // ─────────────────────────────────────────────────────────────
  describe('4. 底栏动作岛在非分栏模式下的挂载与响应式容量更新', () => {
    it('当没有任何项被选中时 (totalItems === 0)，动作岛不渲染', () => {
      const course = createMockCourse({
        state: 'none',
        categories: [
          {
            id: 'files',
            name: '课件资料',
            state: 'none',
            onToggle: vi.fn(),
            items: [
              { id: 'f-1', name: 'a.pdf', selected: false, onToggle: vi.fn() }
            ]
          }
        ]
      })

      const { $ } = renderExplorer({
        courses: [course],
        viewMode: 'grid',
        navState: { level: 'root' }
      })

      const island = $('[role="toolbar"][aria-label="下载底栏智能指挥动作岛"]')
      expect(island.length).toBe(0)
    })

    it('在非分栏模式 (GridView) 且有选中项时，动作岛平滑挂载并显示预估体积', () => {
      const { $, html } = renderExplorer({
        viewMode: 'grid',
        navState: { level: 'root' }
      })

      const island = $('[role="toolbar"][aria-label="下载底栏智能指挥动作岛"]')
      expect(island.length).toBe(1)
      expect(html).toContain('已选 1 门课程')
      expect(html).toContain('立即下载')
    })

    it('在单门课程内 (course/category) 时，动作岛指示分类数而非课程数', () => {
      const { html } = renderExplorer({
        viewMode: 'grid',
        navState: { level: 'course', courseId: 101 }
      })

      expect(html).toContain('已选 2 个分类')
      expect(html).toContain('立即下载')
    })

    it('在分栏模式 (column) 下，全视图体验统一，有选中项时同样居中挂载底栏动作岛', () => {
      const { $ } = renderExplorer({
        viewMode: 'column',
        navState: { level: 'root' }
      })

      const island = $('[role="toolbar"][aria-label="下载底栏智能指挥动作岛"]')
      expect(island.length).toBe(1)
      expect(island.text()).toContain('立即下载')
    })

    it('点击动作岛中的立即下载主按钮，无缝触发下载回调', () => {
      const onDownloadCourse = vi.fn()
      const course = createMockCourse({ onDownload: vi.fn() })

      const { vnode } = renderExplorerVNode({
        courses: [course],
        viewMode: 'grid',
        navState: { level: 'root' },
        onDownloadCourse
      })

      // 动作岛组件被正常渲染并注入回调
      const islandNode = findVNodes(vnode, n => n.type === FloatingCommandIsland)[0]
      expect(islandNode).toBeDefined()
      expect(islandNode.props.onStartDownload).toBeDefined()

      // 1. 触发 islandNode.props.onStartDownload 回调
      islandNode.props.onStartDownload()
      expect(course.onDownload).toHaveBeenCalledTimes(1)

      // 2. 渲染 FloatingCommandIsland 实际按钮并触发点击
      let islandVNode: any = null
      function IslandWrapper() {
        islandVNode = FloatingCommandIsland(islandNode.props)
        return islandVNode
      }
      renderToStaticMarkup(React.createElement(IslandWrapper))

      const ctaButtons = findVNodes(islandVNode, n => n.type === 'button' && n.props?.['aria-label']?.includes('立即下载'))
      expect(ctaButtons.length).toBe(1)
      ctaButtons[0].props.onClick()
      expect(course.onDownload).toHaveBeenCalledTimes(2)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 5. 底栏动作岛显示时 GridView 与 ListView 动态注入 pb-28 避让内边距 (Task 5)
  // ─────────────────────────────────────────────────────────────
  describe('5. 底栏动作岛显示时 GridView 与 ListView 动态注入 pb-28 避让内边距', () => {
    it('GridView 在有选中项时各层级均注入 pb-28 滚动内边距', () => {
      const course = createMockCourse({ state: 'some' })

      // 根目录
      const rootHtml = renderToStaticMarkup(
        React.createElement(GridView, {
          courses: [course],
          navState: { level: 'root' },
          onNavigate: vi.fn(),
          hasSelection: true
        })
      )
      expect(rootHtml).toContain('pb-28')

      // 课程层级
      const courseHtml = renderToStaticMarkup(
        React.createElement(GridView, {
          courses: [course],
          currentCourse: course,
          navState: { level: 'course', courseId: course.id },
          onNavigate: vi.fn(),
          hasSelection: true
        })
      )
      expect(courseHtml).toContain('pb-28')

      // 分类层级
      const catHtml = renderToStaticMarkup(
        React.createElement(GridView, {
          courses: [course],
          currentCourse: course,
          currentCategory: course.categories[0],
          navState: { level: 'category', courseId: course.id, categoryId: course.categories[0].id },
          onNavigate: vi.fn(),
          hasSelection: true
        })
      )
      expect(catHtml).toContain('pb-28')
    })

    it('GridView 在无选中项时使用常规底边距 (无 pb-28)', () => {
      const emptyCourse = createMockCourse({
        state: 'none',
        categories: [
          {
            id: 'files',
            name: '课件',
            state: 'none',
            onToggle: vi.fn(),
            items: [{ id: 'f1', name: 'f1.pdf', selected: false, onToggle: vi.fn() }]
          }
        ]
      })

      const rootHtml = renderToStaticMarkup(
        React.createElement(GridView, {
          courses: [emptyCourse],
          navState: { level: 'root' },
          onNavigate: vi.fn(),
          hasSelection: false
        })
      )
      expect(rootHtml).not.toContain('pb-28')
      expect(rootHtml).toContain('pb-6')

      const courseHtml = renderToStaticMarkup(
        React.createElement(GridView, {
          courses: [emptyCourse],
          currentCourse: emptyCourse,
          navState: { level: 'course', courseId: emptyCourse.id },
          onNavigate: vi.fn(),
          hasSelection: false
        })
      )
      expect(courseHtml).not.toContain('pb-28')
      expect(courseHtml).toContain('pb-4')
    })

    it('ListView 在有选中项时各层级均注入 pb-28 滚动内边距', () => {
      const course = createMockCourse({ state: 'some' })

      // 根目录
      const rootHtml = renderToStaticMarkup(
        React.createElement(ListView, {
          courses: [course],
          navState: { level: 'root' },
          onNavigate: vi.fn(),
          hasSelection: true
        })
      )
      expect(rootHtml).toContain('pb-28')

      // 课程层级
      const courseHtml = renderToStaticMarkup(
        React.createElement(ListView, {
          courses: [course],
          currentCourse: course,
          navState: { level: 'course', courseId: course.id },
          onNavigate: vi.fn(),
          hasSelection: true
        })
      )
      expect(courseHtml).toContain('pb-28')

      // 分类层级
      const catHtml = renderToStaticMarkup(
        React.createElement(ListView, {
          courses: [course],
          currentCourse: course,
          currentCategory: course.categories[0],
          navState: { level: 'category', courseId: course.id, categoryId: course.categories[0].id },
          onNavigate: vi.fn(),
          hasSelection: true
        })
      )
      expect(catHtml).toContain('pb-28')
    })

    it('ListView 在无选中项时使用常规底边距 (无 pb-28)', () => {
      const emptyCourse = createMockCourse({
        state: 'none',
        categories: [
          {
            id: 'files',
            name: '课件',
            state: 'none',
            onToggle: vi.fn(),
            items: [{ id: 'f1', name: 'f1.pdf', selected: false, onToggle: vi.fn() }]
          }
        ]
      })

      const rootHtml = renderToStaticMarkup(
        React.createElement(ListView, {
          courses: [emptyCourse],
          navState: { level: 'root' },
          onNavigate: vi.fn(),
          hasSelection: false
        })
      )
      expect(rootHtml).not.toContain('pb-28')

      const courseHtml = renderToStaticMarkup(
        React.createElement(ListView, {
          courses: [emptyCourse],
          currentCourse: emptyCourse,
          navState: { level: 'course', courseId: emptyCourse.id },
          onNavigate: vi.fn(),
          hasSelection: false
        })
      )
      expect(courseHtml).not.toContain('pb-28')

      const catHtml = renderToStaticMarkup(
        React.createElement(ListView, {
          courses: [emptyCourse],
          currentCourse: emptyCourse,
          currentCategory: emptyCourse.categories[0],
          navState: { level: 'category', courseId: emptyCourse.id, categoryId: emptyCourse.categories[0].id },
          onNavigate: vi.fn(),
          hasSelection: false
        })
      )
      expect(catHtml).not.toContain('pb-28')
      expect(catHtml).toContain('pb-4')
    })

    it('NetdiskCourseExplorer 在完整集成渲染时根据选中态动态切换 pb-28', () => {
      // 1. 有选中项时：渲染包含 pb-28
      const { html: selectedHtml } = renderExplorer({
        viewMode: 'grid',
        navState: { level: 'root' }
      })
      expect(selectedHtml).toContain('pb-28')

      // 2. 无任何选中项时：渲染不包含 pb-28
      const emptyCourse = createMockCourse({
        state: 'none',
        categories: [
          {
            id: 'files',
            name: '课件资料',
            state: 'none',
            onToggle: vi.fn(),
            items: [{ id: 'f-1', name: 'a.pdf', selected: false, onToggle: vi.fn() }]
          }
        ]
      })
      const { html: emptyHtml } = renderExplorer({
        courses: [emptyCourse],
        viewMode: 'grid',
        navState: { level: 'root' }
      })
      expect(emptyHtml).not.toContain('pb-28')
    })
  })
})
