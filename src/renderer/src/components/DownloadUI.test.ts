import { describe, it, expect, vi } from 'vitest'
import { useAppStore } from '../store/app'
import { triStateFromCount, formatBytes, FileTypeBadge, ItemCheckbox } from './DownloadUI'
import { resolveWindowAction } from './WindowConfirmModal'

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

