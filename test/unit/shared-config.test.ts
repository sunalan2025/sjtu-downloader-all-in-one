import { describe, it, expect } from 'vitest'
import { APP_DEFAULTS } from '../../src/shared/config/defaults'
import { Z_INDEX, LAYOUT_METRICS, ANIMATION_DURATION } from '../../src/shared/config/layout'
import * as ConfigIndex from '../../src/shared/config/index'

describe('Centralized Shared Config Suite', () => {
  it('should provide complete and valid application defaults', () => {
    expect(APP_DEFAULTS.concurrency).toBe(3)
    expect(APP_DEFAULTS.maxDownloadSpeedKBps).toBe(0)
    expect(APP_DEFAULTS.downloadMode).toBe('local')
    expect(APP_DEFAULTS.fileConflictStrategy).toBe('skip')
    expect(APP_DEFAULTS.windowCloseAction).toBe('tray')
    expect(APP_DEFAULTS.exitWhenDownloadingPolicy).toBe('prompt')
    expect(APP_DEFAULTS.videoQualityOption).toBe('origin')
    expect(APP_DEFAULTS.videoPerspectivePreference).toBe('teacher')
    expect(APP_DEFAULTS.defaultLocalDestRoot).toBe('SJTU课程')
    expect(APP_DEFAULTS.defaultCloudDestRoot).toBe('/SJTU课程备份')
    expect(APP_DEFAULTS.defaultNamingTemplate).toBe('{course}/{category}/{title}.{ext}')
    expect(APP_DEFAULTS.courseViewMode).toBe('grid')
    expect(APP_DEFAULTS.privateWorker).toEqual({
      enabled: false,
      endpointUrl: 'http://127.0.0.1:6880',
      authToken: ''
    })
  })

  it('should maintain strict monotonic and clash-free z-index ordering', () => {
    expect(Z_INDEX.base).toBeLessThan(Z_INDEX.stickyHeader)
    expect(Z_INDEX.stickyHeader).toBeLessThan(Z_INDEX.dropdown)
    expect(Z_INDEX.dropdown).toBeLessThan(Z_INDEX.drawer)
    expect(Z_INDEX.drawer).toBeLessThan(Z_INDEX.commandIsland)
    expect(Z_INDEX.commandIsland).toBeLessThan(Z_INDEX.modalBackdrop)
    expect(Z_INDEX.modalBackdrop).toBeLessThan(Z_INDEX.modalCard)
    expect(Z_INDEX.modalCard).toBeLessThan(Z_INDEX.popover)
    expect(Z_INDEX.popover).toBeLessThan(Z_INDEX.toast)

    // Values are distinct
    const values = Object.values(Z_INDEX)
    const uniqueValues = new Set(values)
    expect(uniqueValues.size).toBe(values.length)
  })

  it('should define positive layout metrics and reasonable animation durations', () => {
    expect(LAYOUT_METRICS.sidebarWidthCollapsed).toBe(64)
    expect(LAYOUT_METRICS.sidebarWidthExpanded).toBe(240)
    expect(LAYOUT_METRICS.titlebarHeight).toBe(40)
    expect(LAYOUT_METRICS.commandIslandBottomPadding).toBe(96)
    expect(LAYOUT_METRICS.cardGridMinWidth).toBe(260)

    expect(LAYOUT_METRICS.sidebarWidthCollapsed).toBeGreaterThan(0)
    expect(LAYOUT_METRICS.sidebarWidthExpanded).toBeGreaterThan(LAYOUT_METRICS.sidebarWidthCollapsed)

    expect(ANIMATION_DURATION.fast).toBe(150)
    expect(ANIMATION_DURATION.normal).toBe(200)
    expect(ANIMATION_DURATION.slow).toBe(300)
    expect(ANIMATION_DURATION.toastAutoDismiss).toBe(3000)

    expect(ANIMATION_DURATION.fast).toBeLessThan(ANIMATION_DURATION.normal)
    expect(ANIMATION_DURATION.normal).toBeLessThan(ANIMATION_DURATION.slow)
    expect(ANIMATION_DURATION.slow).toBeLessThan(ANIMATION_DURATION.toastAutoDismiss)
  })

  it('should properly re-export all config symbols from index', () => {
    expect(ConfigIndex.APP_DEFAULTS).toBe(APP_DEFAULTS)
    expect(ConfigIndex.Z_INDEX).toBe(Z_INDEX)
    expect(ConfigIndex.LAYOUT_METRICS).toBe(LAYOUT_METRICS)
    expect(ConfigIndex.ANIMATION_DURATION).toBe(ANIMATION_DURATION)
  })
})
