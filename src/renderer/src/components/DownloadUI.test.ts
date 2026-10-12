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

      expect(await resolveWindowAction('minimize')).toBe('minimize')
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
      expect(await resolveWindowAction('close')).toBe('minimize')
      expect(await resolveWindowAction('minimize')).toBe('minimize')

      useAppStore.getState().setExitWhenDownloading('pause_quit')
      expect(await resolveWindowAction('close')).toBe('quit')
      // 关键修复验证：进行中任务存在且策略为 pause_quit 时，点击最小化依然保持 minimize
      expect(await resolveWindowAction('minimize')).toBe('minimize')

      // prompt with unmounted modal returns cancel
      useAppStore.getState().setExitWhenDownloading('prompt')
      expect(await resolveWindowAction('close')).toBe('cancel')
      expect(await resolveWindowAction('minimize')).toBe('minimize')
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

