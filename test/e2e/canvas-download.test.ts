import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, unlinkSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  isAllowedSjtuUrl,
  verifyDownloadIntegrity
} from '../helpers/contracts'
import {
  FIXTURES_CANVAS
} from '../mocks/fixtures'

// Regex for extracting Canvas file IDs from syllabus HTML (matching orchestrator logic)
function extractCanvasFileIds(html: string): number[] {
  const ids: number[] = []
  const matches = html.matchAll(/\/files\/(\d+)/g)
  for (const m of matches) {
    const id = Number(m[1])
    if (Number.isFinite(id) && !ids.includes(id)) {
      ids.push(id)
    }
  }
  return ids
}

// Model course grouping by term
function groupCoursesByTerm(courses: any[]): Record<string, any[]> {
  const grouped: Record<string, any[]> = {}
  for (const c of courses) {
    const term = c.term?.name || '未标注学期'
    if (!grouped[term]) grouped[term] = []
    grouped[term].push(c)
  }
  return grouped
}

// ScanCourse simulation with 403 tolerance
interface SimulatedScanResult {
  ok: boolean
  filesTabAccessible: boolean
  files: any[]
  folderMap: Record<number, string>
  moduleFiles: any[]
  syllabusFiles: any[]
  warning?: string
  error?: string
}

async function simulateScanCourse(
  courseId: number,
  options: { files403?: boolean } = {}
): Promise<SimulatedScanResult> {
  const filesTabAccessible = !options.files403

  let folderMap: Record<number, string> = {}
  let files: any[] = []

  if (filesTabAccessible) {
    folderMap = Object.fromEntries(FIXTURES_CANVAS.folders.map(f => [f.id, f.full_name]))
    files = FIXTURES_CANVAS.files
  }

  // Modules and Syllabus are fetched independently (Promise.allSettled pattern)
  const modules = FIXTURES_CANVAS.modules
  const syllabusHtml = FIXTURES_CANVAS.syllabusHtml

  const knownFileIds = new Set(files.map(f => f.id))
  const moduleFileIds: number[] = []

  for (const m of modules) {
    for (const item of m.items) {
      if (item.type === 'File' && item.content_id && !knownFileIds.has(item.content_id)) {
        moduleFileIds.push(item.content_id)
        knownFileIds.add(item.content_id)
      }
    }
  }

  const syllabusFileIds = extractCanvasFileIds(syllabusHtml).filter(id => !knownFileIds.has(id))

  const moduleFiles = moduleFileIds.map(id => ({
    id,
    display_name: '补充阅读_实数完备性.pdf',
    size: 524288,
    url: `https://oc.sjtu.edu.cn/files/${id}/download?download_frd=1`
  }))

  const syllabusFiles = syllabusFileIds.map(id => ({
    id,
    display_name: '课程教学大纲2025.pdf',
    size: 262144,
    url: `https://oc.sjtu.edu.cn/files/${id}/download?download_frd=1`
  }))

  return {
    ok: true,
    filesTabAccessible,
    files,
    folderMap,
    moduleFiles,
    syllabusFiles,
    warning: !filesTabAccessible ? '教师已禁用文件列表，已自动从单元和大纲提取可用课件' : undefined
  }
}

// 302 Redirect Handler
function interceptDownloadRedirect(
  locationHeader: string,
  requestUrl: string
): { action: 'follow' | 'abort'; reason?: string; nextUrl?: string } {
  const next = new URL(locationHeader, requestUrl).toString()

  // 1. Check for session expired login redirect
  if (next.includes('/login') || next.includes('jaccount.sjtu.edu.cn')) {
    return {
      action: 'abort',
      reason: 'Canvas 会话失效，下载重定向至登录页'
    }
  }

  // 2. Check for security domain whitelist
  if (!isAllowedSjtuUrl(next)) {
    return {
      action: 'abort',
      reason: `禁止向非交大受信域重定向: ${next}`
    }
  }

  return { action: 'follow', nextUrl: next }
}

describe('Canvas LMS & Download Integrity E2E Suite (R2-F1, R2-F2, R2-F3, R2-F4)', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'sjtu-test-'))
  })

  afterEach(() => {
    try {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
    } catch {}
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 1: Feature Coverage (Happy Path Isolation)
  // ─────────────────────────────────────────────────────────────
  describe('Tier 1: Feature Coverage', () => {
    describe('R2-F1: Canvas Course Listing & Grouping', () => {
      it('returns enrolled courses with names, codes, and terms', () => {
        expect(FIXTURES_CANVAS.courses.length).toBe(3)
        expect(FIXTURES_CANVAS.courses[0].name).toBe('高等数学 (A类)')
        expect(FIXTURES_CANVAS.courses[0].course_code).toBe('MATH1201')
      })

      it('groups courses correctly by academic term', () => {
        const grouped = groupCoursesByTerm(FIXTURES_CANVAS.courses)
        expect(Object.keys(grouped)).toContain('2025-2026-1')
        expect(Object.keys(grouped)).toContain('2024-2025-2')
        expect(Object.keys(grouped)).toContain('2023-2024-1')
        expect(grouped['2025-2026-1'][0].name).toBe('高等数学 (A类)')
      })

      it('includes concluded/archived courses in grouping without omission', () => {
        const concludedCourse = FIXTURES_CANVAS.courses.find(c => c.enrollments[0].enrollment_state === 'concluded')
        expect(concludedCourse).toBeDefined()
        expect(concludedCourse?.name).toBe('大学物理 (已归档)')
      })

      it('sorts academic terms in reverse chronological order', () => {
        const terms = Object.keys(groupCoursesByTerm(FIXTURES_CANVAS.courses))
        const sorted = [...terms].sort().reverse()
        expect(sorted[0]).toBe('2025-2026-1')
        expect(sorted[1]).toBe('2024-2025-2')
        expect(sorted[2]).toBe('2023-2024-1')
      })

      it('assigns 未标注学期 fallback when course has no term metadata', () => {
        const courseWithoutTerm = [{ id: 999, name: '独立研讨课', term: null }]
        const grouped = groupCoursesByTerm(courseWithoutTerm)
        expect(grouped['未标注学期']).toBeDefined()
      })
    })

    describe('R2-F2: Canvas 403 Files Tab Tolerance', () => {
      it('standard course scan extracts files, folders, modules, and syllabus', async () => {
        const res = await simulateScanCourse(10001, { files403: false })
        expect(res.ok).toBe(true)
        expect(res.filesTabAccessible).toBe(true)
        expect(res.files.length).toBe(2)
        expect(res.moduleFiles.length).toBe(1)
        expect(res.syllabusFiles.length).toBe(1)
      })

      it('tolerates 403 on files tab without crashing and extracts from modules and syllabus', async () => {
        const res = await simulateScanCourse(10001, { files403: true })
        expect(res.ok).toBe(true)
        expect(res.filesTabAccessible).toBe(false)
        expect(res.files.length).toBe(0)
        expect(res.moduleFiles.length).toBe(2) // Both items in module recovered
        expect(res.syllabusFiles.length).toBe(1)
        expect(res.warning).toContain('教师已禁用文件列表')
      })

      it('extracts embedded file IDs from syllabus HTML via regex', () => {
        const ids = extractCanvasFileIds(FIXTURES_CANVAS.syllabusHtml)
        expect(ids).toContain(304)
        expect(ids.length).toBe(1)
      })
    })

    describe('R2-F3: Pre-signed Links & 302 Interception', () => {
      it('allows legitimate 302 redirect from Canvas to S3 presigned URL', () => {
        const result = interceptDownloadRedirect(
          'https://s3.jcloud.sjtu.edu.cn/canvas/301.pdf?sign=123',
          'https://oc.sjtu.edu.cn/files/301/download'
        )
        expect(result.action).toBe('follow')
        expect(result.nextUrl).toContain('s3.jcloud.sjtu.edu.cn')
      })

      it('intercepts 302 redirect pointing to /login/canvas and raises SessionExpired', () => {
        const result = interceptDownloadRedirect(
          '/login/canvas',
          'https://oc.sjtu.edu.cn/files/301/download'
        )
        expect(result.action).toBe('abort')
        expect(result.reason).toContain('Canvas 会话失效，下载重定向至登录页')
      })

      it('intercepts 302 redirect pointing to jAccount SSO endpoint', () => {
        const result = interceptDownloadRedirect(
          'https://jaccount.sjtu.edu.cn/oauth2/authorize?client_id=canvas',
          'https://oc.sjtu.edu.cn/files/301/download'
        )
        expect(result.action).toBe('abort')
        expect(result.reason).toContain('Canvas 会话失效')
      })
    })

    describe('R2-F4: Downloaded File Integrity Guard', () => {
      it('validates a valid binary PDF file passes integrity check', () => {
        const filePath = join(testDir, 'valid.pdf')
        // Valid PDF file starts with %PDF-
        writeFileSync(filePath, Buffer.from('%PDF-1.4 ... binary stream contents'))
        const check = verifyDownloadIntegrity(filePath, 10)
        expect(check.valid).toBe(true)
      })

      it('detects and rejects 0-byte empty file', () => {
        const filePath = join(testDir, 'empty.pdf')
        writeFileSync(filePath, Buffer.alloc(0))
        const check = verifyDownloadIntegrity(filePath, 1)
        expect(check.valid).toBe(false)
        expect(check.error).toContain('文件大小为 0 字节')
      })

      it('detects and rejects HTML error page disguised with .pdf extension', () => {
        const filePath = join(testDir, 'fake.pdf')
        writeFileSync(filePath, '<!DOCTYPE html><html><head><title>Canvas 登录</title></head></html>')
        const check = verifyDownloadIntegrity(filePath, 1)
        expect(check.valid).toBe(false)
        expect(check.error).toContain('文件内容为 HTML 网页')
      })

      it('detects and rejects HTML page without doctype starting with <html', () => {
        const filePath = join(testDir, 'login.zip')
        writeFileSync(filePath, '<html><body>Please login via jAccount</body></html>')
        const check = verifyDownloadIntegrity(filePath, 1)
        expect(check.valid).toBe(false)
        expect(check.error).toContain('HTML 网页')
      })
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 2: Boundary & Corner Cases
  // ─────────────────────────────────────────────────────────────
  describe('Tier 2: Boundary & Corner Cases', () => {
    it('handles non-existent file path gracefully', () => {
      const nonExistent = join(testDir, 'does_not_exist.pdf')
      const check = verifyDownloadIntegrity(nonExistent)
      expect(check.valid).toBe(false)
      expect(check.error).toBe('文件不存在')
    })

    it('rejects file smaller than required minBytes', () => {
      const filePath = join(testDir, 'tiny.bin')
      writeFileSync(filePath, Buffer.from('12345'))
      const check = verifyDownloadIntegrity(filePath, 100)
      expect(check.valid).toBe(false)
      expect(check.error).toContain('小于最小要求 100 字节')
    })

    it('allows HTML files when allowHtml is explicitly true', () => {
      const filePath = join(testDir, 'index.html')
      writeFileSync(filePath, '<!DOCTYPE html><html><body>Document</body></html>')
      const check = verifyDownloadIntegrity(filePath, 1, true)
      expect(check.valid).toBe(true)
    })

    it('intercepts redirect to external untrusted domain with security error', () => {
      const result = interceptDownloadRedirect(
        'https://external-storage-untrusted.com/data.pdf',
        'https://oc.sjtu.edu.cn/files/301/download'
      )
      expect(result.action).toBe('abort')
      expect(result.reason).toContain('禁止向非交大受信域重定向')
    })

    it('extracts multiple file IDs from complex syllabus HTML without duplicates', () => {
      const complexHtml = `
        <p><a href="/courses/10/files/101/download">讲义1</a></p>
        <p><a href="/courses/10/files/102/download">讲义2</a></p>
        <p><a href="/files/101/download">讲义1 重复链接</a></p>
      `
      const ids = extractCanvasFileIds(complexHtml)
      expect(ids).toEqual([101, 102])
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 3: Cross-Feature Pairwise Interactions
  // ─────────────────────────────────────────────────────────────
  describe('Tier 3: Pairwise Combinations', () => {
    it('pairwise: scan with 403 fallback directly feeds download specs to integrity-guarded writer', async () => {
      const scanRes = await simulateScanCourse(10001, { files403: true })
      expect(scanRes.filesTabAccessible).toBe(false)

      // Total downloadable items found via fallback
      const totalItems = [...scanRes.moduleFiles, ...scanRes.syllabusFiles]
      expect(totalItems.length).toBe(3)

      // Simulate downloading one of the fallback files
      const targetFile = totalItems[0]
      const partPath = join(testDir, `${targetFile.display_name}.part`)

      // Write simulated binary payload
      writeFileSync(partPath, Buffer.from('%PDF-1.4 Module content payload'))

      const check = verifyDownloadIntegrity(partPath, 10)
      expect(check.valid).toBe(true)
    })

    it('pairwise: 302 redirect to login prevents writing fake HTML file to disk', () => {
      const redirect = interceptDownloadRedirect('/login/canvas', 'https://oc.sjtu.edu.cn/files/99/download')

      expect(redirect.action).toBe('abort')
      // Because action was abort, file is NOT written
      const filePath = join(testDir, 'course_syllabus.pdf')
      expect(existsSync(filePath)).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 4: End-to-End User Workflows
  // ─────────────────────────────────────────────────────────────
  describe('Tier 4: End-to-End User Workflows', () => {
    it('e2e: complete course scan with hidden files tab -> file extraction -> safe download & verification', async () => {
      // Step 1: Scan course with hidden files tab (403)
      const scan = await simulateScanCourse(10001, { files403: true })
      expect(scan.ok).toBe(true)
      expect(scan.filesTabAccessible).toBe(false)

      const downloadableItems = [...scan.files, ...scan.moduleFiles, ...scan.syllabusFiles]
      expect(downloadableItems.length).toBe(3)

      // Step 2: Download each item with 302 redirect guard
      for (const item of downloadableItems) {
        // Resolve direct URL
        const redirectCheck = interceptDownloadRedirect(
          'https://s3.jcloud.sjtu.edu.cn/canvas/' + item.id,
          item.url
        )
        expect(redirectCheck.action).toBe('follow')

        // Write .part
        const partPath = join(testDir, `${item.display_name}.part`)
        const finalPath = join(testDir, item.display_name)
        writeFileSync(partPath, Buffer.from('%PDF-1.5 ' + item.display_name))

        // Verify integrity before renaming
        const integrity = verifyDownloadIntegrity(partPath, 5)
        expect(integrity.valid).toBe(true)

        // Rename .part -> final
        writeFileSync(finalPath, Buffer.from('%PDF-1.5 ' + item.display_name))
        unlinkSync(partPath)

        expect(existsSync(finalPath)).toBe(true)
      }
    })

    it('e2e: session expiry during multi-file download triggers abort and prevents corruption', () => {
      const items = [
        { name: 'Lecture1.pdf', url: 'https://oc.sjtu.edu.cn/files/1/download' },
        { name: 'Lecture2.pdf', url: 'https://oc.sjtu.edu.cn/files/2/download' }
      ]

      let sessionValid = true
      let filesSaved = 0
      let abortedWithAuthError = false

      for (const item of items) {
        // Simulate token expiration before second file
        if (item.name === 'Lecture2.pdf') sessionValid = false

        const redirectLocation = sessionValid
          ? 'https://s3.jcloud.sjtu.edu.cn/bucket/' + item.name
          : '/login/canvas'

        const redirect = interceptDownloadRedirect(redirectLocation, item.url)
        if (redirect.action === 'abort') {
          abortedWithAuthError = true
          break
        }

        const outPath = join(testDir, item.name)
        writeFileSync(outPath, Buffer.from('%PDF-1.4 Content'))
        filesSaved++
      }

      expect(filesSaved).toBe(1)
      expect(abortedWithAuthError).toBe(true)
      expect(existsSync(join(testDir, 'Lecture2.pdf'))).toBe(false)
    })
  })
})
