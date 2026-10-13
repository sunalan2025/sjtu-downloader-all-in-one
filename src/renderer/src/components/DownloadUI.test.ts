import { describe, it, expect, vi } from 'vitest'
import { useAppStore } from '../store/app'
import { triStateFromCount, formatBytes, FileTypeBadge, ItemCheckbox } from './DownloadUI'
import { resolveWindowAction } from './WindowConfirmModal'
import { classifyCnmoocItem, isCnmoocQuizOrExercise } from '../pages/CnmoocBrowser'

describe('window exit preferences and resolution', () => {
  it('has correct default window exit preferences', () => {
    const store = useAppStore.getState()
    expect(store.windowCloseAction).toBe('tray')
    expect(store.exitWhenDownloading).toBe('prompt')
  })

  it('updates preferences via setters', () => {
    const store = useAppStore.getState()
    store.setWindowCloseAction('taskbar')
    expect(useAppStore.getState().windowCloseAction).toBe('taskbar')
    store.setExitWhenDownloading('background')
    expect(useAppStore.getState().exitWhenDownloading).toBe('background')

    // reset
    store.setWindowCloseAction('tray')
    store.setExitWhenDownloading('prompt')
  })

  it('resolves close action correctly when no ongoing tasks', async () => {
    const originalWindow = globalThis.window
    ;(globalThis as any).window = {
      api: {
        window: {
          hasOngoingTasks: vi.fn().mockResolvedValue({ ongoing: false })
        }
      }
    }

    try {
      useAppStore.getState().setWindowCloseAction('tray')
      expect(await resolveWindowAction('close')).toBe('minimize')

      useAppStore.getState().setWindowCloseAction('taskbar')
      expect(await resolveWindowAction('close')).toBe('taskbar')

      useAppStore.getState().setWindowCloseAction('quit')
      expect(await resolveWindowAction('close')).toBe('quit')

      expect(await resolveWindowAction('minimize')).toBe('taskbar')
    } finally {
      useAppStore.getState().setWindowCloseAction('tray')
      ;(globalThis as any).window = originalWindow
    }
  })

  it('resolves close action correctly when ongoing tasks exist', async () => {
    const originalWindow = globalThis.window
    ;(globalThis as any).window = {
      api: {
        window: {
          hasOngoingTasks: vi.fn().mockResolvedValue({ ongoing: true })
        }
      }
    }

    try {
      useAppStore.getState().setExitWhenDownloading('background')
      useAppStore.getState().setWindowCloseAction('tray')
      expect(await resolveWindowAction('close')).toBe('minimize')
      expect(await resolveWindowAction('minimize')).toBe('taskbar')

      useAppStore.getState().setWindowCloseAction('taskbar')
      expect(await resolveWindowAction('close')).toBe('taskbar')

      useAppStore.getState().setExitWhenDownloading('pause_quit')
      expect(await resolveWindowAction('close')).toBe('quit')
      // 关键修复验证：进行中任务存在且策略为 pause_quit 时，点击最小化依然保持标准最小化到任务栏 taskbar
      expect(await resolveWindowAction('minimize')).toBe('taskbar')

      // prompt with unmounted modal returns cancel
      useAppStore.getState().setExitWhenDownloading('prompt')
      expect(await resolveWindowAction('close')).toBe('cancel')
      expect(await resolveWindowAction('minimize')).toBe('taskbar')
    } finally {
      useAppStore.getState().setExitWhenDownloading('prompt')
      ;(globalThis as any).window = originalWindow
    }
  })
})

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

describe('courseViewMode preferences', () => {
  it('has correct default courseViewMode (grid)', () => {
    const store = useAppStore.getState()
    expect(store.courseViewMode).toBe('grid')
  })

  it('updates courseViewMode via setter', () => {
    const store = useAppStore.getState()
    store.setCourseViewMode('column')
    expect(useAppStore.getState().courseViewMode).toBe('column')

    store.setCourseViewMode('list')
    expect(useAppStore.getState().courseViewMode).toBe('list')

    store.setCourseViewMode('grid')
    expect(useAppStore.getState().courseViewMode).toBe('grid')
  })
})

describe('initial setup and audio-only preferences', () => {
  it('has correct default hasCompletedInitialSetup (false)', () => {
    const store = useAppStore.getState()
    expect(store.hasCompletedInitialSetup).toBe(false)
  })

  it('updates hasCompletedInitialSetup via setter', () => {
    const store = useAppStore.getState()
    store.setHasCompletedInitialSetup(true)
    expect(useAppStore.getState().hasCompletedInitialSetup).toBe(true)

    store.setHasCompletedInitialSetup(false)
    expect(useAppStore.getState().hasCompletedInitialSetup).toBe(false)
  })

  it('supports videoQualityOption audio_only mode', () => {
    const store = useAppStore.getState()
    store.setVideoQualityOption('audio_only')
    expect(useAppStore.getState().videoQualityOption).toBe('audio_only')

    store.setVideoQualityOption('origin')
    expect(useAppStore.getState().videoQualityOption).toBe('origin')
  })
})

describe('FileTypeBadge and ItemCheckbox', () => {
  it('FileTypeBadge renders audio badge for M4A and disabled badge for DISABLED', () => {
    const m4aBadge = FileTypeBadge({ type: 'M4A' })
    expect(m4aBadge.props.children[0].props.children).toBe('M4A 音频')

    const m4aFilenameBadge = FileTypeBadge({ filename: 'lecture.m4a' })
    expect(m4aFilenameBadge.props.children[0].props.children).toBe('M4A 音频')

    const disabledBadge = FileTypeBadge({ type: 'DISABLED' })
    expect(disabledBadge.props.children[0].props.children).toBe('无独立音频')

    const mp4Badge = FileTypeBadge({ type: 'MP4' })
    expect(mp4Badge.props.children[0].props.children).toBe('MP4 视频')
  })

  it('ItemCheckbox renders with disabled attribute', () => {
    const cb = ItemCheckbox({ checked: false, disabled: true })
    expect(cb.props.disabled).toBe(true)
    expect(cb.props.className).toContain('cursor-not-allowed')
  })
})

describe('cloudpan activeTab navigation and state machine', () => {
  it('switches to cloudpan tab while preserving lastCourseTab', () => {
    const store = useAppStore.getState()
    // Start on canvas
    store.setActiveTab('canvas')
    expect(useAppStore.getState().activeTab).toBe('canvas')
    expect(useAppStore.getState().lastCourseTab).toBe('canvas')

    // Switch to cloudpan
    store.setActiveTab('cloudpan')
    expect(useAppStore.getState().activeTab).toBe('cloudpan')
    // lastCourseTab should still be canvas
    expect(useAppStore.getState().lastCourseTab).toBe('canvas')

    // Switch back to lastCourseTab
    store.setActiveTab(useAppStore.getState().lastCourseTab)
    expect(useAppStore.getState().activeTab).toBe('canvas')
  })

  it('correctly remembers cnmooc and audited as lastCourseTab when switching to cloudpan', () => {
    const store = useAppStore.getState()

    // cnmooc
    store.setActiveTab('cnmooc')
    expect(useAppStore.getState().lastCourseTab).toBe('cnmooc')
    store.setActiveTab('cloudpan')
    expect(useAppStore.getState().activeTab).toBe('cloudpan')
    expect(useAppStore.getState().lastCourseTab).toBe('cnmooc')

    // audited
    store.setActiveTab('audited')
    expect(useAppStore.getState().lastCourseTab).toBe('audited')
    store.setActiveTab('cloudpan')
    expect(useAppStore.getState().activeTab).toBe('cloudpan')
    expect(useAppStore.getState().lastCourseTab).toBe('audited')

    // Return back to audited
    store.setActiveTab(useAppStore.getState().lastCourseTab)
    expect(useAppStore.getState().activeTab).toBe('audited')
  })
})

describe('FileTypeBadge and Cnmooc item classification', () => {
  it('FileTypeBadge prioritizes explicit filename extension over fallback type parameter', () => {
    // 即使外部传入 type: 'MP4'，若 filename 明确为 pptx，必须展示 PPTX 幻灯片图标，防止将文档错误显示为视频
    const pptBadge = FileTypeBadge({ filename: '正溴丁烷的制备20231009.pptx', type: 'MP4' })
    expect(JSON.stringify(pptBadge)).toContain('PowerPoint 幻灯片')

    const pdfBadge = FileTypeBadge({ filename: '大学化学实验操作规范.pdf', type: 'MP4' })
    expect(JSON.stringify(pdfBadge)).toContain('PDF 文档')

    const videoBadge = FileTypeBadge({ filename: '第一讲 绪论.mp4', type: 'MP4' })
    expect(JSON.stringify(videoBadge)).toContain('MP4 视频')
  })

  it('classifyCnmoocItem accurately identifies PPT/PDF courseware without misleading MP4 suffix', () => {
    // 即使上游 DOM 标记 itemType 为 10，真实扩展名为 PPTX/PDF 的项不能被当作视频处理
    const pptItem = classifyCnmoocItem({ title: '正溴丁烷的制备20231009.pptx', itemType: '10' })
    expect(pptItem.isVideo).toBe(false)
    expect(pptItem.type).toBe('PPTX')
    expect(pptItem.displayName).toBe('正溴丁烷的制备20231009.pptx')

    const pdfItem = classifyCnmoocItem({ title: '有机化学实验讲义.pdf', itemType: '10' })
    expect(pdfItem.isVideo).toBe(false)
    expect(pdfItem.type).toBe('PDF')
    expect(pdfItem.displayName).toBe('有机化学实验讲义.pdf')

    // 清理历史残留的尾部 (MP4) 误标
    const dirtyPpt = classifyCnmoocItem({ title: '正溴丁烷的制备20231009.pptx (MP4)', itemType: '10' })
    expect(dirtyPpt.isVideo).toBe(false)
    expect(dirtyPpt.type).toBe('PPTX')
    expect(dirtyPpt.displayName).toBe('正溴丁烷的制备20231009.pptx')
  })

  it('classifyCnmoocItem handles videos and audio-only extraction mode', () => {
    // 常规视频
    const videoItem = classifyCnmoocItem({ title: '1.1 绪论与有机化学发展史', itemType: '10' }, false)
    expect(videoItem.isVideo).toBe(true)
    expect(videoItem.type).toBe('MP4')
    expect(videoItem.displayName).toBe('1.1 绪论与有机化学发展史')

    // 仅提取音频模式：视频项自动变为 M4A，并标明音频
    const audioItem = classifyCnmoocItem({ title: '1.1 绪论与有机化学发展史', itemType: '10' }, true)
    expect(audioItem.isVideo).toBe(true)
    expect(audioItem.type).toBe('M4A')
    expect(audioItem.displayName).toBe('1.1 绪论与有机化学发展史 (音频 M4A)')

    // 包含 .mp4 后缀的文件在音频模式下转换为 .m4a
    const mp4Audio = classifyCnmoocItem({ title: '1.1 绪论.mp4', itemType: '10' }, true)
    expect(mp4Audio.isVideo).toBe(true)
    expect(mp4Audio.type).toBe('M4A')
    expect(mp4Audio.displayName).toBe('1.1 绪论.m4a')
  })

  it('isCnmoocQuizOrExercise accurately filters out practice exercises and test quizzes without files', () => {
    // 明确的在线练习题与测试题（即使没有显式 itemType 标记）
    expect(isCnmoocQuizOrExercise('第五章练习题')).toBe(true)
    expect(isCnmoocQuizOrExercise('第五章测试题（必做）')).toBe(true)
    expect(isCnmoocQuizOrExercise('第1节随堂测验')).toBe(true)
    expect(isCnmoocQuizOrExercise('第一章作业')).toBe(true)
    expect(isCnmoocQuizOrExercise('期末考试')).toBe(true)
    expect(isCnmoocQuizOrExercise('单元综合自测')).toBe(true)
    expect(isCnmoocQuizOrExercise('课程问卷调查')).toBe(true)
    expect(isCnmoocQuizOrExercise('第一节测验 (过滤)', '30')).toBe(true)

    // 真正的音视频与课件文档，绝不能被误过滤
    expect(isCnmoocQuizOrExercise('用电设施、设备简介.mp4')).toBe(false)
    expect(isCnmoocQuizOrExercise('有机化学实验讲义.pdf')).toBe(false)
    expect(isCnmoocQuizOrExercise('正溴丁烷的制备20231009.pptx')).toBe(false)
    expect(isCnmoocQuizOrExercise('第五章 习题课')).toBe(false)
    expect(isCnmoocQuizOrExercise('期末试卷讲评')).toBe(false)
    expect(isCnmoocQuizOrExercise('作业答疑.mp4')).toBe(false)
  })
})

describe('settings navigation', () => {
  it('supports settings navigation to credentials tab', () => {
    // 验证设置面板导航项包含 credentials
    const navItems = [
      { id: 'storage', label: '📦 存储与下载' },
      { id: 'cloud', label: '☁️ 交大云盘集成' },
      { id: 'performance', label: '⚡ 性能与并发' },
      { id: 'video', label: '🎬 课件与视频' },
      { id: 'appearance', label: '🎨 外观与窗口' },
      { id: 'credentials', label: '🔐 账号与凭据管理' }
    ]
    expect(navItems.some(item => item.id === 'credentials')).toBe(true)
  })
})

describe('Canvas category badges and PPT PDF lecture items', () => {
  it('FileTypeBadge renders blue MP4 badge when item name is PPT投影视角 and type is MP4', () => {
    // 纠偏前：课堂视频中的 PPT 投影视角被赋予 type: 'PPT'，导致 FileTypeBadge 误显示橙色幻灯片图标
    // 纠偏后：type 修正为 MP4，必须渲染蓝色 MP4 视频图标，绝不能出现橙色 PowerPoint 幻灯片图标
    const pptVideoStreamBadge = FileTypeBadge({
      filename: '高等数学 - 第1讲 PPT投影视角 (MP4)',
      type: 'MP4'
    })
    const badgeStr = JSON.stringify(pptVideoStreamBadge)
    expect(badgeStr).toContain('MP4 视频')
    expect(badgeStr).toContain('#2563EB')
    expect(badgeStr).not.toContain('PowerPoint 幻灯片')
    expect(badgeStr).not.toContain('#EA580C')
  })

  it('FileTypeBadge renders red PDF badge when item name is PPT课件 and type is PDF', () => {
    // PPT课件 (PDF) 各讲次项应渲染为红色 PDF 徽标
    const pptPdfBadge = FileTypeBadge({
      filename: '高等数学 - 第1讲 PPT课件 (PDF)',
      type: 'PDF'
    })
    const badgeStr = JSON.stringify(pptPdfBadge)
    expect(badgeStr).toContain('PDF 文档')
    expect(badgeStr).toContain('#DC2626')
    expect(badgeStr).not.toContain('PowerPoint 幻灯片')
  })

  it('buildPptPdfItems populates lecture items with PDF type and correct metadata', async () => {
    const { buildPptPdfItems, pptPdfTaskId } = await import('../pages/CanvasBrowser')
    const mockLectures = [
      { lectureNum: 1, date: '2026-03-01', teacher: { id: 's1' } as any },
      { lectureNum: 2, date: '2026-03-08', teacher: { id: 's2' } as any }
    ]
    const onToggle = vi.fn()
    const items = buildPptPdfItems('高等数学', 99999, mockLectures, true, onToggle)

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: pptPdfTaskId(99999, 1),
      name: '高等数学 - 第1讲 PPT课件 (PDF)',
      date: '2026-03-01',
      type: 'PDF',
      selected: true
    })
    expect(items[1]).toMatchObject({
      id: pptPdfTaskId(99999, 2),
      name: '高等数学 - 第2讲 PPT课件 (PDF)',
      date: '2026-03-08',
      type: 'PDF',
      selected: true
    })

    // 触发单讲 onToggle 联动
    items[0].onToggle()
    expect(onToggle).toHaveBeenCalledTimes(1)

    // 验证各讲次项所用徽标为红色 PDF
    const firstItemBadge = FileTypeBadge({ filename: items[0].name, type: items[0].type })
    expect(JSON.stringify(firstItemBadge)).toContain('PDF 文档')
    expect(JSON.stringify(firstItemBadge)).toContain('#DC2626')
  })
})

describe('Canvas Semester Grouping & CloudPan Navigation Anti-Misclick Suite', () => {
  it('useAppStore has canvasGroupByTerm defaulting to true and toggles via setCanvasGroupByTerm', () => {
    const store = useAppStore.getState()
    expect(store.canvasGroupByTerm).toBe(true)

    store.setCanvasGroupByTerm(false)
    expect(useAppStore.getState().canvasGroupByTerm).toBe(false)

    store.setCanvasGroupByTerm(true)
    expect(useAppStore.getState().canvasGroupByTerm).toBe(true)
  })

  it('NetdiskCourseExplorer groups courses by term in descending order when groupByTerm is enabled', () => {
    const mockCourses = [
      { id: 101, name: '软件工程', term: '2025-2026-1', state: 'none', itemCount: 3, categories: [], onToggle: vi.fn() },
      { id: 102, name: '计算机体系结构', term: '2025-2026-2', state: 'all', itemCount: 5, categories: [], onToggle: vi.fn() },
      { id: 103, name: '数据结构与算法', term: '2025-2026-1', state: 'all', itemCount: 2, categories: [], onToggle: vi.fn() },
      { id: 104, name: '操作系统专题', term: '2024-2025-2', state: 'none', itemCount: 4, categories: [], onToggle: vi.fn() }
    ] as any

    const map = new Map<string, any[]>()
    for (const c of mockCourses) {
      const t = c.term?.trim() || '其他 / 未指定学期'
      if (!map.has(t)) map.set(t, [])
      map.get(t)!.push(c)
    }
    const sortedTerms = Array.from(map.keys()).sort((a, b) => b.localeCompare(a, 'zh-CN'))
    const groups = sortedTerms.map(term => ({ term, items: map.get(term)! }))

    expect(groups).toHaveLength(3)
    // 2025-2026-2 排在最前（最新学期）
    expect(groups[0].term).toBe('2025-2026-2')
    expect(groups[0].items).toHaveLength(1)
    expect(groups[0].items[0].name).toBe('计算机体系结构')

    // 2025-2026-1 排在中间
    expect(groups[1].term).toBe('2025-2026-1')
    expect(groups[1].items).toHaveLength(2)
    expect(groups[1].items.map((i: any) => i.name)).toEqual(['软件工程', '数据结构与算法'])

    // 2024-2025-2 排在最后
    expect(groups[2].term).toBe('2024-2025-2')
    expect(groups[2].items).toHaveLength(1)
  })

  it('CloudPan anti-misclick cooldown lock drops rapid double invocations within 450ms or when loading', () => {
    let lastNavTime = 0
    let isNavigating = false
    let currentPath: string[] = []
    let loading = false

    const handleEnterFolder = (name: string, now: number) => {
      if (loading || isNavigating || now - lastNavTime < 450) {
        return false // dropped
      }
      lastNavTime = now
      isNavigating = true
      currentPath = [...currentPath, name]
      return true // navigated
    }

    // 1st click at t=1000
    const res1 = handleEnterFolder('FolderA', 1000)
    expect(res1).toBe(true)
    expect(currentPath).toEqual(['FolderA'])

    // 2nd rapid click at t=1150 (150ms later, double-click scenario) -> MUST BE DROPPED
    const res2 = handleEnterFolder('ChildFolder', 1150)
    expect(res2).toBe(false)
    expect(currentPath).toEqual(['FolderA'])

    // 3rd click at t=1300 while loading -> MUST BE DROPPED
    isNavigating = false
    loading = true
    const res3 = handleEnterFolder('ChildFolder', 1300)
    expect(res3).toBe(false)
    expect(currentPath).toEqual(['FolderA'])

    // 4th click after cooldown expired (t=1600) and loading complete -> SUCCESS
    loading = false
    const res4 = handleEnterFolder('ChildFolder', 1600)
    expect(res4).toBe(true)
    expect(currentPath).toEqual(['FolderA', 'ChildFolder'])
  })
})

