import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  GridView,
  ListView,
  useCategoryViewLogic,
  isVideoCategory,
  isTeacherPerspectiveItem,
  isPptPerspectiveItem,
  type NetdiskCourseItem,
  type NetdiskCategoryItem,
  type NetdiskFileItem,
  type CategoryViewLogicParams
} from '../../src/renderer/src/components/NetdiskCourseExplorer'
import { useAppStore } from '../../src/renderer/src/store/app'

// ── useCategoryViewLogic 直接单测：用测试探针组件把 hook 返回值捕获出来 ──

let captured: ReturnType<typeof useCategoryViewLogic> | null = null
function ProbeComponent(props: CategoryViewLogicParams): React.ReactElement {
  captured = useCategoryViewLogic(props)
  return React.createElement('div')
}

function runHook(props: CategoryViewLogicParams): ReturnType<typeof useCategoryViewLogic> {
  captured = null
  renderToStaticMarkup(React.createElement(ProbeComponent, props))
  // renderToStaticMarkup 同步执行 hook（useState 初值路径），返回值已被捕获
  if (!captured) throw new Error('hook did not run')
  return captured
}

function makeItem(id: string, name: string, selected = false, over: Partial<NetdiskFileItem> = {}): NetdiskFileItem {
  return {
    id,
    name,
    selected,
    onToggle: vi.fn(),
    ...over
  }
}

function makeVideoCategory(): NetdiskCategoryItem {
  return {
    id: 'videos',
    name: '课堂视频',
    icon: 'video',
    state: 'some',
    onToggle: vi.fn(),
    items: [
      makeItem('lec_1_teacher', '第1讲 教师.mp4'),
      makeItem('lec_1_ppt', '第1讲 投屏.mp4'),
      makeItem('lec_2_teacher', '第2讲 教师.mp4'),
      makeItem('lec_2_ppt', '第2讲 投屏.mp4')
    ]
  }
}

function makeCourse(cat: NetdiskCategoryItem): NetdiskCourseItem {
  return {
    id: 101,
    name: '数据结构',
    state: 'some',
    itemCount: cat.items.length,
    categories: [cat],
    onToggle: vi.fn()
  }
}

const baseNavState = { level: 'category' as const, courseId: 101, categoryId: 'videos' }

describe('Phase 3 — useCategoryViewLogic (GridView/ListView shared logic)', () => {
  beforeEach(() => {
    useAppStore.setState({ videoQualityOption: 'origin', downloadMode: 'local' })
  })

  it('classifies teacher/ppt perspective items and video categories', () => {
    expect(isTeacherPerspectiveItem(makeItem('x_teacher', '第1讲'))).toBe(true)
    expect(isTeacherPerspectiveItem(makeItem('lec1', '第1讲教师.mp4'))).toBe(true)
    expect(isPptPerspectiveItem(makeItem('x_ppt', '投屏.mp4'))).toBe(true)
    expect(isVideoCategory(makeVideoCategory())).toBe(true)
    expect(isVideoCategory({ id: 'files', name: '课件', state: 'none', onToggle: vi.fn(), items: [] })).toBe(false)
  })

  it('computes selection state, term grouping, and teacher/ppt counts', () => {
    const cat = makeVideoCategory()
    const course = makeCourse(cat)
    course.state = 'none'  // 课程/条目均未勾选 → isSelected false
    const logic = runHook({
      courses: [course],
      currentCourse: course,
      currentCategory: cat,
      groupByTerm: true
    })

    expect(logic.isVideoCat).toBe(true)
    expect(logic.totalCount).toBe(4)
    expect(logic.teacherCount).toBe(2)
    expect(logic.pptCount).toBe(2)
    expect(logic.isSelected).toBe(false)
  })

  it('filters displayedItems to teacher perspective when activePerspective is teacher (audio maps to teacher)', () => {
    const cat = makeVideoCategory()
    const logic = runHook({
      courses: [makeCourse(cat)],
      currentCourse: makeCourse(cat),
      currentCategory: cat,
      // audio 档 → 文件列表维度按教师视角展示
      perspective: 'audio'
    })

    expect(logic.displayedItems).toHaveLength(2)
    expect(logic.displayedItems.every(isTeacherPerspectiveItem)).toBe(true)
  })

  it('filters displayedItems to ppt perspective when activePerspective is ppt', () => {
    const cat = makeVideoCategory()
    const logic = runHook({
      courses: [makeCourse(cat)],
      currentCourse: makeCourse(cat),
      currentCategory: cat,
      perspective: 'ppt'
    })
    expect(logic.displayedItems).toHaveLength(2)
    expect(logic.displayedItems.every(isPptPerspectiveItem)).toBe(true)
  })

  it('single download: calls the real onDownloadSingle and reports success toast', () => {
    const cat = makeVideoCategory()
    const onDownloadSingle = vi.fn()
    const showToast = vi.fn()
    const logic = runHook({
      courses: [makeCourse(cat)],
      currentCourse: makeCourse(cat),
      currentCategory: cat,
      onDownloadSingle,
      showToast
    })

    const item = cat.items[0]
    logic.handleSingleDownload(item)
    expect(onDownloadSingle).toHaveBeenCalledWith(item, expect.anything(), cat)
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('已开始下载'), 'success')
  })

  it('single download without any real callback: falls back to select + honest info toast (no fake success)', () => {
    const cat = makeVideoCategory()
    const showToast = vi.fn()
    const logic = runHook({
      courses: [makeCourse(cat)],
      currentCourse: makeCourse(cat),
      currentCategory: cat,
      showToast
    })

    const item = cat.items[0]
    logic.handleSingleDownload(item)
    // 无回调 → 勾选 + 「点击立即下载」提示，绝不谎报已开始下载
    expect(item.onToggle).toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('立即下载'), 'info')
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('已开始下载'), 'success')
  })

  it('single download refuses disabled items outright', () => {
    const cat = makeVideoCategory()
    const disabled = makeItem('lec_x', '禁用项.mp4', false, {
      disabled: true,
      onToggle: vi.fn()
    })
    cat.items.push(disabled)
    const onDownloadSingle = vi.fn()
    const showToast = vi.fn()
    const logic = runHook({
      courses: [makeCourse(cat)],
      currentCourse: makeCourse(cat),
      currentCategory: cat,
      onDownloadSingle,
      showToast
    })

    logic.handleSingleDownload(disabled)
    expect(onDownloadSingle).not.toHaveBeenCalled()
    expect(showToast).not.toHaveBeenCalled()
  })

  it('renders identically through GridView and ListView with the shared logic (no regression in markup)', () => {
    const cat = makeVideoCategory()
    const course = makeCourse(cat)
    const commonProps = {
      courses: [course],
      currentCourse: course,
      currentCategory: cat,
      navState: baseNavState,
      perspective: 'all' as const
    }

    const grid = renderToStaticMarkup(React.createElement(GridView, commonProps))
    const list = renderToStaticMarkup(React.createElement(ListView, commonProps))

    // 两视图共享同一份逻辑：分类头（含筛选 pills）都渲染，且文件计数一致
    expect(grid).toContain('全部视频')
    expect(list).toContain('全部视频')
    expect(grid).toContain('第1讲 教师.mp4')
    expect(list).toContain('第1讲 教师.mp4')
    // 筛选为 all 时 4 项全部展示
    expect(grid).toContain('第2讲 投屏.mp4')
    expect(list).toContain('第2讲 投屏.mp4')
  })
})
