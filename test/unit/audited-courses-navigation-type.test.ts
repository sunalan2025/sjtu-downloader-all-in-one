import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MacOSDocumentIcon } from '../../src/renderer/src/components/widgets'

describe('AuditedCourses file type and navigation decouple audit', () => {
  it('ensures pptItems are typed as MP4 instead of PPT document', () => {
    const filePath = join(__dirname, '../../src/renderer/src/pages/AuditedCourses.tsx')
    const content = readFileSync(filePath, 'utf8')

    // pptItems type must be MP4 when not audio-only, NEVER PPT document
    expect(content).toContain("type: isAudioOnly ? 'DISABLED' : 'MP4'")
    expect(content).not.toContain("type: isAudioOnly ? 'DISABLED' : 'PPT'")
  })

  it('ensures handleNavigate in AuditedCourses decouples navigation from selection to maintain unselected state on enter', () => {
    const filePath = join(__dirname, '../../src/renderer/src/pages/AuditedCourses.tsx')
    const content = readFileSync(filePath, 'utf8')

    // Must define handleNavigate with decoupling logic for both course and category levels
    expect(content).toContain('handleNavigate = useCallback(')
    expect(content).toContain("(next.level === 'course' || next.level === 'category') && next.courseId")
    expect(content).toContain('onNavigate={handleNavigate}')
  })

  it('ensures handleNavigate in CnmoocBrowser decouples navigation from selection to maintain unselected state on enter', () => {
    const filePath = join(__dirname, '../../src/renderer/src/pages/CnmoocBrowser.tsx')
    const content = readFileSync(filePath, 'utf8')

    // Must define handleNavigate with decoupling logic for both course and category levels
    expect(content).toContain('handleNavigate = useCallback(')
    expect(content).toContain("(next.level === 'course' || next.level === 'category') && next.courseId")
    expect(content).toContain('onNavigate={handleNavigate}')
  })

  it('verifies MacOSDocumentIcon renders MP4 video badge instead of PPT for lecture screen recording', () => {
    // When filename is '(PPT MP4)' and type is 'MP4'
    const html = renderToStaticMarkup(
      React.createElement(MacOSDocumentIcon, {
        filename: '高等数学I - 第1讲 (PPT MP4)',
        type: 'MP4',
        size: 58
      })
    )

    // Should render MP4 label, not PPT
    expect(html).toContain('MP4')
    expect(html).not.toContain('>PPT<')
    // Indigo ribbon color for video (#6366F1), not orange (#F97316)
    expect(html).toContain('#6366F1')
    expect(html).not.toContain('#F97316')
  })

  it('ensures GridView CourseCard and CategoryCard support single click selection and double click entry', () => {
    const gridPath = join(__dirname, '../../src/renderer/src/features/course-explorer/GridView.tsx')
    const gridContent = readFileSync(gridPath, 'utf8')

    // CourseCard and CategoryCard containers support onClick to toggle selection
    expect(gridContent).toMatch(/CourseCard[\s\S]*?onClick=\{\(\) => c\.onToggle\(\)\}/)
    expect(gridContent).toMatch(/cat\.id[\s\S]*?onClick=\{\(\) => cat\.onToggle\(\)\}/)
    // And onDoubleClick to navigate
    expect(gridContent).toMatch(/CourseCard[\s\S]*?onDoubleClick/)
    expect(gridContent).toMatch(/cat\.id[\s\S]*?onDoubleClick/)
    // Category level grid has px-2 py-1.5 padding to prevent leftmost border clipping
    expect(gridContent).toContain('className={`h-full overflow-y-auto px-2 py-1.5 ${isSelected ? \'pb-28\' : \'pb-4\'}`}')
  })

  it('ensures CourseSelectionSurface defaults toggleOnClick to true and toggles changed items', () => {
    const selPath = join(__dirname, '../../src/renderer/src/features/course-explorer/Selection.tsx')
    const selContent = readFileSync(selPath, 'utf8')

    expect(selContent).toContain('toggleOnClick = true')
    expect(selContent).toContain('if (item && !item.disabled)')
    expect(selContent).toContain('item.onToggle()')
  })

  it('ensures Explorer onNavigate does not execute course.onToggle loop', () => {
    const expPath = join(__dirname, '../../src/renderer/src/features/course-explorer/Explorer.tsx')
    const expContent = readFileSync(expPath, 'utf8')

    expect(expContent).not.toContain('course.state !== \'none\'')
  })

  it('ensures AuditedCourses and CnmoocBrowser wire up real single download handlers', () => {
    const auditedPath = join(__dirname, '../../src/renderer/src/pages/AuditedCourses.tsx')
    const auditedContent = readFileSync(auditedPath, 'utf8')
    expect(auditedContent).toContain('handleSingleDownloadTask')
    expect(auditedContent).toContain('onDownloadSingle={item => {')

    const cnmoocPath = join(__dirname, '../../src/renderer/src/pages/CnmoocBrowser.tsx')
    const cnmoocContent = readFileSync(cnmoocPath, 'utf8')
    expect(cnmoocContent).toContain('handleSingleDownloadItem')
    expect(cnmoocContent).toContain('onDownloadSingle={item => {')

    const gridPath = join(__dirname, '../../src/renderer/src/features/course-explorer/GridView.tsx')
    const gridContent = readFileSync(gridPath, 'utf8')
    expect(gridContent).toContain('data-testid="single-download-btn"')
  })
})
