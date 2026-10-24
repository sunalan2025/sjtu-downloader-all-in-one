import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('UI Z-Index Hierarchy and Layer Mask Guardrails', () => {
  const readComponent = (relPath: string) => {
    const fullPath = path.resolve(__dirname, '../../', relPath)
    return fs.readFileSync(fullPath, 'utf8')
  }

  it('ScheduleHeaderBar must have higher z-index than WeekScheduleView navigation bar', () => {
    const headerSource = readComponent('src/renderer/src/pages/schedule/components/ScheduleHeaderBar.tsx')
    const weekViewSource = readComponent('src/renderer/src/pages/schedule/components/WeekScheduleView.tsx')

    const headerMatch = headerSource.match(/sticky top-0 z-(\d+)/)
    const weekNavMatch = weekViewSource.match(/relative z-(\d+)/)

    expect(headerMatch).toBeTruthy()
    expect(weekNavMatch).toBeTruthy()

    const headerZ = parseInt(headerMatch![1], 10)
    const weekNavZ = parseInt(weekNavMatch![1], 10)

    // ScheduleHeaderBar (z-40) must be strictly higher than WeekScheduleView (z-10)
    expect(headerZ).toBeGreaterThan(weekNavZ)
    expect(headerZ).toBe(40)
    expect(weekNavZ).toBe(10)
  })

  it('DropdownSelect popup must be fully opaque without bleed-through alpha', () => {
    const widgetsSource = readComponent('src/renderer/src/components/widgets.tsx')
    // Must NOT have bg-surface-1/95 which bleeds underlying text through
    expect(widgetsSource).not.toContain('bg-surface-1/95')
    expect(widgetsSource).toContain('bg-surface-1 dark:bg-[#1e1e22]')
    // Container must elevate z-index when open
    expect(widgetsSource).toContain("open ? 'z-50' : ''")
  })

  it('FloatingCommandIsland does not have bleed-through alpha or popover leak', () => {
    const islandSource = readComponent('src/renderer/src/components/FloatingCommandIsland.tsx')
    // Popover menu was retired and should not leak back into the island
    expect(islandSource).not.toContain('role="menu"')
    expect(islandSource).not.toContain('aria-haspopup="menu"')
  })

  it('CourseHoverPopover must be solid and elevated to z-50', () => {
    const popoverSource = readComponent('src/renderer/src/pages/schedule/components/CourseHoverPopover.tsx')
    expect(popoverSource).not.toContain('bg-surface-1/95')
    expect(popoverSource).toContain('bg-surface-1 dark:bg-[#1c1c1e]')
    expect(popoverSource).toContain('fixed z-50 pointer-events-none')
  })

  it('Full-screen Modals must be elevated to z-[60] to cover page popovers and islands', () => {
    const courseModal = readComponent('src/renderer/src/pages/schedule/components/CourseDetailModal.tsx')
    const exportModal = readComponent('src/renderer/src/pages/schedule/components/ScheduleExportModal.tsx')
    const wizardModal = readComponent('src/renderer/src/components/SetupWizardModal.tsx')

    expect(courseModal).toContain('fixed inset-0 z-[60]')
    expect(exportModal).toContain('fixed inset-0 z-[60]')
    expect(wizardModal).toContain('fixed inset-0 z-[60]')
  })

  it('Toast notifications must be elevated to z-[70] for global visibility', () => {
    const toastSource = readComponent('src/renderer/src/components/Toast.tsx')
    expect(toastSource).toContain("z-[70] flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium backdrop-blur animate-fadeIn")
    expect(toastSource).toContain("z-[70] flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium backdrop-blur animate-fadeIn select-none")
  })
})
