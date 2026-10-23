import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as cheerio from 'cheerio'
import {
  ColumnView,
  CourseOverviewInspector,
  FileDetailInspector,
  getCourseResourceBreakdown,
  NetdiskCourseExplorer,
  type NetdiskCourseItem,
  type NetdiskCategoryItem,
  type NetdiskFileItem,
  type CourseOverviewInspectorProps,
  type FileDetailInspectorProps,
  type ColumnViewProps
} from '../../src/renderer/src/components/NetdiskCourseExplorer'
import { estimateResourceSize, formatBytes } from '../../src/shared/utils'
import { useAppStore } from '../../src/renderer/src/store/app'

// 递归搜集虚拟 DOM 节点用于点击测试
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

// 模拟测试数据工厂
function createMockCourse(overrides: Partial<NetdiskCourseItem> = {}): NetdiskCourseItem {
  const fileItems: NetdiskFileItem[] = [
    {
      id: 'f-1',
      name: 'Lecture-01-Introduction.pdf',
      size: 5 * 1024 * 1024,
      type: 'PDF',
      date: '2025-03-01',
      selected: false,
      onToggle: vi.fn()
    },
    {
      id: 'f-2',
      name: 'Lecture-02-Design-Patterns.pptx',
      size: 15 * 1024 * 1024,
      type: 'PPTX',
      date: '2025-03-05',
      selected: true,
      onToggle: vi.fn()
    }
  ]

  const videoItems: NetdiskFileItem[] = [
    {
      id: 'v-1',
      name: '01 课程导学与环境搭建.mp4',
      size: 350 * 1024 * 1024,
      type: 'MP4',
      date: '2025-03-01',
      selected: false,
      onToggle: vi.fn()
    },
    {
      id: 'v-2',
      name: '02 架构演进与接口设计.mp4',
      size: 420 * 1024 * 1024,
      type: 'MP4',
      date: '2025-03-08',
      selected: false,
      onToggle: vi.fn()
    }
  ]

  const assignmentItems: NetdiskFileItem[] = [
    {
      id: 'a-1',
      name: '作业 1：系统架构设计报告.pdf',
      size: 2 * 1024 * 1024,
      type: 'PDF',
      date: '2025-03-10',
      selected: false,
      onToggle: vi.fn()
    }
  ]

  const categories: NetdiskCategoryItem[] = [
    {
      id: 'files',
      name: '课件资料',
      icon: 'file',
      state: 'some',
      onToggle: vi.fn(),
      items: fileItems
    },
    {
      id: 'videos',
      name: '课堂视频',
      icon: 'video',
      state: 'none',
      onToggle: vi.fn(),
      items: videoItems,
      renderExtra: React.createElement('div', { 'data-testid': 'category-extra-banner' }, '分类侵入栏')
    },
    {
      id: 'assignments',
      name: '课程作业',
      icon: 'assignment',
      state: 'none',
      onToggle: vi.fn(),
      items: assignmentItems
    },
    {
      id: 'pptPdf',
      name: 'PPT课件 (PDF)',
      icon: 'presentation',
      state: 'none',
      onToggle: vi.fn(),
      items: []
    }
  ]

  return {
    id: 1001,
    name: '软件工程与架构设计 (SE3353)',
    code: 'SE3353',
    term: '2024-2025-2',
    teacher: '陈教授',
    badge: '必修',
    state: 'some',
    itemCount: 5,
    totalBytes: 792 * 1024 * 1024,
    categories,
    onToggle: vi.fn(),
    onEnter: vi.fn(),
    ...overrides
  }
}

describe('ColumnView Dynamic 4th Column Inspector Suite', () => {
  beforeEach(() => {
    useAppStore.getState().setDownloadMode('local')
  })
  describe('1. 课程资源结构分析与容量计算 (getCourseResourceBreakdown & estimateResourceSize)', () => {
    it('正确解析混合课程的课件、视频、作业与 PPT PDF 属性', () => {
      const course = createMockCourse()
      const breakdown = getCourseResourceBreakdown(course)

      expect(breakdown.filesCount).toBe(2)
      expect(breakdown.fileBytes).toBe(20 * 1024 * 1024)
      expect(breakdown.videoCount).toBe(2)
      expect(breakdown.assignmentCount).toBe(1)
      expect(breakdown.hasVideos).toBe(true)
      expect(breakdown.hasAssignments).toBe(true)
      expect(breakdown.pptPdfAvailable).toBe(true)

      const est = estimateResourceSize({
        fileBytes: breakdown.fileBytes,
        videoCount: breakdown.videoCount,
        perspective: 'teacher',
        hasAssignments: breakdown.hasAssignments,
        assignmentCount: breakdown.assignmentCount,
        hasPptPdf: false
      })
      // 20MB file + 2 * 450MB teacher + 1 * 2MB assignment = 922MB
      expect(est.totalBytes).toBe(922 * 1024 * 1024)
      expect(est.formattedSize).toBe(`约 ${formatBytes(922 * 1024 * 1024)}`)
    })

    it('无视频的纯课件课程正确识别 hasVideos=false', () => {
      const pureDocCourse = createMockCourse({
        categories: [
          {
            id: 'files',
            name: '课件资料',
            icon: 'file',
            state: 'none',
            onToggle: vi.fn(),
            items: [
              {
                id: 'doc-1',
                name: 'Syllabus.pdf',
                size: 1024 * 1024,
                selected: false,
                onToggle: vi.fn()
              }
            ]
          }
        ]
      })
      const breakdown = getCourseResourceBreakdown(pureDocCourse)
      expect(breakdown.hasVideos).toBe(false)
      expect(breakdown.videoCount).toBe(0)
      expect(breakdown.filesCount).toBe(1)
    })
  })

  describe('2. CourseOverviewInspector (第 4 栏课程/分类概览检查器)', () => {
    it('当只选中课程时，正确渲染课程名称、代码、学期、教师与容量预估卡片', () => {
      const course = createMockCourse()
      const html = renderToStaticMarkup(
        React.createElement(CourseOverviewInspector, {
          course
        })
      )
      const $ = cheerio.load(html)

      // 标题与标签
      expect($('h2').text()).toContain('软件工程与架构设计 (SE3353)')
      expect(html).toContain('2024-2025-2')
      expect(html).toContain('SE3353')
      expect(html).toContain('陈教授')
      expect(html).toContain('必修')

      // 容量预估
      const estimatedBadge = $('[data-testid="course-estimated-size"]')
      expect(estimatedBadge.length).toBe(1)
      expect(estimatedBadge.text()).toMatch(/约 \d+(\.\d+)? (MB|GB)/)

      // 4 项资源明细指标
      expect(html).toContain('课件资料')
      expect(html).toContain('课堂录播')
      expect(html).toContain('课程作业')
      expect(html).toContain('PPT 讲义 PDF')
    })

    it('当存在分类上下文时，呈现分类提示信息', () => {
      const course = createMockCourse()
      const category = course.categories[0]
      const html = renderToStaticMarkup(
        React.createElement(CourseOverviewInspector, {
          course,
          category
        })
      )
      const $ = cheerio.load(html)
      expect(html).toContain('分类与课程概览')
      expect(html).toContain('当前浏览分类:')
      expect(html).toContain('课件资料')
    })

    it('对有录播视频的课程渲染偏好状态只读概览并指示当前默认机位', () => {
      const course = createMockCourse()
      const html = renderToStaticMarkup(
        React.createElement(CourseOverviewInspector, {
          course,
          perspective: 'teacher'
        })
      )
      const $ = cheerio.load(html)

      const summary = $('[data-testid="unified-preferences-summary"]')
      expect(summary.length).toBe(1)
      expect(summary.text()).toContain('默认录播视角')
      expect(summary.text()).toContain('仅教师视角')
    })

    it('无录播课程不展示录播机位条目', () => {
      const docCourse = createMockCourse({
        categories: [
          {
            id: 'files',
            name: '课件资料',
            icon: 'file',
            state: 'none',
            onToggle: vi.fn(),
            items: []
          }
        ]
      })
      const html = renderToStaticMarkup(
        React.createElement(CourseOverviewInspector, {
          course: docCourse
        })
      )
      const $ = cheerio.load(html)
      const summary = $('[data-testid="unified-preferences-summary"]')
      expect(summary.length).toBe(1)
      expect(summary.text()).not.toContain('默认录播视角')
    })

    it('偏好概览正确展示 PPT 讲义自动提取状态与设置提示', () => {
      const course = createMockCourse()
      const html = renderToStaticMarkup(
        React.createElement(CourseOverviewInspector, {
          course,
          hasPptPdf: true
        })
      )
      const $ = cheerio.load(html)
      const summary = $('[data-testid="unified-preferences-summary"]')
      expect(summary.text()).toContain('PPT 讲义自动提取')
      expect(summary.text()).toContain('已开启')
      expect(summary.text()).toContain('如需修改请前往「设置 - 课件与多媒体」')
    })

    it('支持传入 hasPptPdf: false 控制展示状态', () => {
      const course = createMockCourse()
      const html = renderToStaticMarkup(
        React.createElement(CourseOverviewInspector, {
          course,
          hasPptPdf: false
        })
      )
      const $ = cheerio.load(html)
      const summary = $('[data-testid="unified-preferences-summary"]')
      expect(summary.text()).toContain('未开启')
    })

    it('点击底部主下载按钮触发 onDownloadCourse 回调并提供 Toast 反馈', () => {
      const course = createMockCourse()
      const onDownloadCourse = vi.fn()

      let capturedVNode: any = null
      function Wrapper() {
        capturedVNode = CourseOverviewInspector({
          course,
          onDownloadCourse
        })
        return capturedVNode
      }

      renderToStaticMarkup(React.createElement(Wrapper))

      const downloadBtns = findVNodes(
        capturedVNode,
        n => n.props?.['data-testid'] === 'course-download-cta'
      )
      expect(downloadBtns.length).toBe(1)
      downloadBtns[0].props.onClick()

      expect(onDownloadCourse).toHaveBeenCalledWith(course)
    })
  })

  describe('3. FileDetailInspector (第 4 栏单文件详情检查器)', () => {
    it('当选中单文件时，展示大图标预览、文件名、大小、日期、所属课程与分类', () => {
      const course = createMockCourse()
      const category = course.categories[0]
      const file = category.items[0]

      const html = renderToStaticMarkup(
        React.createElement(FileDetailInspector, {
          item: file,
          course,
          category,
          onClose: vi.fn()
        })
      )
      const $ = cheerio.load(html)

      expect($('h3').text()).toContain('Lecture-01-Introduction.pdf')
      expect(html).toContain('软件工程与架构设计')
      expect(html).toContain('课件资料')
      expect(html).toContain(formatBytes(file.size!))
      expect(html).toContain('2025-03-01')
      expect(html).toContain('⬇ 立即下载此文件')
      expect(html).toContain('勾选此文件加入清单')
    })

    it('视频文件渲染 🎬 视频缩略图预览卡片', () => {
      const course = createMockCourse()
      const video = course.categories[1].items[0]

      const html = renderToStaticMarkup(
        React.createElement(FileDetailInspector, {
          item: video,
          course,
          onClose: vi.fn()
        })
      )
      expect(html).toContain('🎬')
      expect(html).toContain('课堂视频 / 录播课件')
    })

    it('音频文件渲染 🎵 音频预览卡片', () => {
      const course = createMockCourse()
      const audioItem: NetdiskFileItem = {
        id: 'aud-1',
        name: 'Lecture-Audio.m4a',
        size: 30 * 1024 * 1024,
        type: 'M4A',
        selected: false,
        onToggle: vi.fn()
      }

      const html = renderToStaticMarkup(
        React.createElement(FileDetailInspector, {
          item: audioItem,
          course,
          onClose: vi.fn()
        })
      )
      expect(html).toContain('🎵')
      expect(html).toContain('音频课件')
    })

    it('点击单文件立即下载按钮触发 onDownloadSingle 回调', () => {
      const course = createMockCourse()
      const category = course.categories[0]
      const file = category.items[0]
      const onDownloadSingle = vi.fn()

      let capturedVNode: any = null
      function Wrapper() {
        capturedVNode = FileDetailInspector({
          item: file,
          course,
          category,
          onClose: vi.fn(),
          onDownloadSingle
        })
        return capturedVNode
      }

      renderToStaticMarkup(React.createElement(Wrapper))

      const downloadBtns = findVNodes(
        capturedVNode,
        n => typeof n.props?.children?.props?.children === 'string' && n.props.children.props.children.includes('立即下载此文件')
      )
      expect(downloadBtns.length).toBe(1)
      downloadBtns[0].props.onClick()

      expect(onDownloadSingle).toHaveBeenCalledWith(file, course, category)
    })

    it('点击勾选/取消勾选按钮触发 item.onToggle', () => {
      const course = createMockCourse()
      const file = course.categories[0].items[0]

      let capturedVNode: any = null
      function Wrapper() {
        capturedVNode = FileDetailInspector({
          item: file,
          course,
          onClose: vi.fn()
        })
        return capturedVNode
      }

      renderToStaticMarkup(React.createElement(Wrapper))

      const toggleBtns = findVNodes(
        capturedVNode,
        n => typeof n.props?.children?.props?.children === 'string' && n.props.children.props.children.includes('加入清单')
      )
      expect(toggleBtns.length).toBe(1)
      toggleBtns[0].props.onClick()

      expect(file.onToggle).toHaveBeenCalledTimes(1)
    })

    it('点击 ✕ 关闭按钮调用 onClose 回调', () => {
      const course = createMockCourse()
      const file = course.categories[0].items[0]
      const onClose = vi.fn()

      let capturedVNode: any = null
      function Wrapper() {
        capturedVNode = FileDetailInspector({
          item: file,
          course,
          onClose
        })
        return capturedVNode
      }

      renderToStaticMarkup(React.createElement(Wrapper))

      const closeBtns = findVNodes(capturedVNode, n => n.props?.['aria-label'] === '关闭详情面板')
      expect(closeBtns.length).toBe(1)
      closeBtns[0].props.onClick()

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('4. ColumnView 交互流与动态切换联动', () => {
    it('当只选中课程未选文件时，保持纯净分栏展开，不渲染冗余 CourseOverviewInspector', () => {
      const course = createMockCourse()
      const html = renderToStaticMarkup(
        React.createElement(ColumnView, {
          courses: [course],
          activeCourse: course,
          onSelectCourse: vi.fn(),
          onSelectCategory: vi.fn()
        })
      )
      const $ = cheerio.load(html)

      expect($('[data-testid="course-overview-inspector"]').length).toBe(0)
      expect($('[data-testid="file-detail-inspector"]').length).toBe(0)
    })

    it('选定分类后，第 3 栏呈现文件流，但彻底移除顶部的侵入性 renderExtra 条且不渲染冗余概览', () => {
      const course = createMockCourse()
      const videoCategory = course.categories[1] // 有 renderExtra 属性
      expect(videoCategory.renderExtra).toBeDefined()

      const html = renderToStaticMarkup(
        React.createElement(ColumnView, {
          courses: [course],
          activeCourse: course,
          activeCategory: videoCategory,
          onSelectCourse: vi.fn(),
          onSelectCategory: vi.fn()
        })
      )
      const $ = cheerio.load(html)

      // Column 3 中不得包含 category-extra-banner
      expect($('[data-testid="category-extra-banner"]').length).toBe(0)
      expect(html).not.toContain('分类侵入栏')

      // 未点击具体文件时，不展示冗余概览
      expect($('[data-testid="course-overview-inspector"]').length).toBe(0)
      expect($('[data-testid="file-detail-inspector"]').length).toBe(0)
    })

    it('当选中单文件时，第 4 栏动态切换为 FileDetailInspector', () => {
      const course = createMockCourse()
      const category = course.categories[0]
      const selectedFile = category.items[0]

      const html = renderToStaticMarkup(
        React.createElement(ColumnView, {
          courses: [course],
          activeCourse: course,
          activeCategory: category,
          selectedFileItem: selectedFile,
          onSelectCourse: vi.fn(),
          onSelectCategory: vi.fn()
        })
      )
      const $ = cheerio.load(html)

      expect($('[data-testid="course-overview-inspector"]').length).toBe(0)
      expect($('[data-testid="file-detail-inspector"]').length).toBe(1)
      expect(html).toContain('Lecture-01-Introduction.pdf')
      expect(html).toContain('⬇ 立即下载此文件')
    })

    it('点击文件检查器 ✕ 关闭按钮能将选择状态置空并收起第 4 栏', () => {
      const course = createMockCourse()
      const category = course.categories[0]
      const selectedFile = category.items[0]
      const onSelectFileItem = vi.fn()

      let capturedVNode: any = null
      function Wrapper() {
        capturedVNode = ColumnView({
          courses: [course],
          activeCourse: course,
          activeCategory: category,
          selectedFileItem: selectedFile,
          onSelectCourse: vi.fn(),
          onSelectCategory: vi.fn(),
          onSelectFileItem
        })
        return capturedVNode
      }

      renderToStaticMarkup(React.createElement(Wrapper))

      const fileDetailNodes = findVNodes(capturedVNode, n => n.type === FileDetailInspector)
      expect(fileDetailNodes.length).toBe(1)
      fileDetailNodes[0].props.onClose()

      expect(onSelectFileItem).toHaveBeenCalledWith(null)
    })

    it('再次点击已高亮的同一课件项时，自动反选并收起第 4 栏预览', () => {
      const course = createMockCourse()
      const category = course.categories[0]
      const selectedFile = category.items[0]
      const onSelectFileItem = vi.fn()

      let capturedVNode: any = null
      function Wrapper() {
        capturedVNode = ColumnView({
          courses: [course],
          activeCourse: course,
          activeCategory: category,
          selectedFileItem: selectedFile,
          onSelectCourse: vi.fn(),
          onSelectCategory: vi.fn(),
          onSelectFileItem
        })
        return capturedVNode
      }

      renderToStaticMarkup(React.createElement(Wrapper))

      const fileRows = findVNodes(capturedVNode, n => n.props?.onClick && n.key === selectedFile.id)
      expect(fileRows.length).toBe(1)
      fileRows[0].props.onClick()

      expect(onSelectFileItem).toHaveBeenCalledWith(null)
    })
  })

  describe('5. NetdiskCourseExplorer 分栏模式端到端属性透传', () => {
    it('在 viewMode="column" 时，通过 navState 选定课程保持纯净分栏，无冗余概览争宠', () => {
      const course = createMockCourse()
      const onPerspectiveChange = vi.fn()
      const onDownloadCourse = vi.fn()

      const html = renderToStaticMarkup(
        React.createElement(NetdiskCourseExplorer, {
          courses: [course],
          viewMode: 'column',
          navState: {
            level: 'course',
            courseId: course.id
          },
          onNavigate: vi.fn(),
          perspective: 'ppt',
          onPerspectiveChange,
          onDownloadCourse
        })
      )
      const $ = cheerio.load(html)

      expect($('[data-testid="course-overview-inspector"]').length).toBe(0)
      expect($('[data-testid="file-detail-inspector"]').length).toBe(0)
    })

    it('在 viewMode="column" 且存在多选课程时，自动挂载 FloatingCommandIsland 并提供统一批量下载', () => {
      const course1 = createMockCourse({ id: 'c1', name: '高等数学', state: 'all' })
      const course2 = createMockCourse({ id: 'c2', name: '大学物理', state: 'all' })
      const onStartDownload = vi.fn()

      const html = renderToStaticMarkup(
        React.createElement(NetdiskCourseExplorer, {
          courses: [course1, course2],
          viewMode: 'column',
          navState: { level: 'root' },
          onNavigate: vi.fn(),
          onStartDownload
        })
      )
      const $ = cheerio.load(html)

      // 验证底部动作岛在分栏视图下成功挂载
      const island = $('div[role="toolbar"]')
      expect(island.length).toBe(1)
      expect(island.text()).toContain('2 门课程')
      expect(island.text()).toContain('立即下载')

      // 验证各栏包含 pb-24 避让内边距
      const scrollContainers = $('.overflow-y-auto')
      expect(scrollContainers.toArray().some((el: any) => $(el).hasClass('pb-24'))).toBe(true)
    })

    it('在 viewMode="column" 且无任何勾选项时，保持纯净不展示底栏动作岛且无 pb-24', () => {
      const unselectedCourse = createMockCourse({
        state: 'none',
        categories: [
          {
            id: 'files',
            name: '课件资料',
            icon: 'file',
            state: 'none',
            onToggle: vi.fn(),
            items: [
              {
                id: 'f-1',
                name: 'Lecture-01.pdf',
                selected: false,
                onToggle: vi.fn()
              }
            ]
          }
        ]
      })
      const html = renderToStaticMarkup(
        React.createElement(NetdiskCourseExplorer, {
          courses: [unselectedCourse],
          viewMode: 'column',
          navState: { level: 'root' },
          onNavigate: vi.fn()
        })
      )
      const $ = cheerio.load(html)

      expect($('div[role="toolbar"]').length).toBe(0)
      const pb24Containers = $('.pb-24')
      expect(pb24Containers.length).toBe(0)
    })
  })
})
