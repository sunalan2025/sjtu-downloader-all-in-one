import { describe, expect, it } from 'vitest'
import { sanitizeFsName, formatPathFromTemplate, formatBytes } from './utils'
import { getDynamicChunkSize } from '../main/cloudpan'

describe('sanitizeFsName', () => {
  it('replaces illegal characters with underscores', () => {
    expect(sanitizeFsName('math:101/lecture*1?.pdf')).toBe('math_101_lecture_1_.pdf')
  })

  it('trims trailing dots and spaces', () => {
    expect(sanitizeFsName('course_name. . .')).toBe('course_name')
  })

  it('fallback to 未命名 when empty', () => {
    expect(sanitizeFsName('   ')).toBe('未命名')
  })
})

describe('getDynamicChunkSize', () => {
  it('returns 4MB for small files', () => {
    expect(getDynamicChunkSize(100 * 1024 * 1024)).toBe(4 * 1024 * 1024)
  })

  it('returns 8MB for medium files (200MB - 1GB)', () => {
    expect(getDynamicChunkSize(500 * 1024 * 1024)).toBe(8 * 1024 * 1024)
  })

  it('returns 16MB for large files (> 1GB)', () => {
    expect(getDynamicChunkSize(2 * 1024 * 1024 * 1024)).toBe(16 * 1024 * 1024)
  })
})

describe('formatPathFromTemplate', () => {
  it('replaces template variables correctly', () => {
    const res = formatPathFromTemplate('{term}/{course}/{category}/{fileName}', {
      term: '2025-2026-1',
      course: '高等数学',
      category: 'videos',
      fileName: 'lecture_1.mp4'
    })
    expect(res).toBe('2025-2026-1/高等数学/videos/lecture_1.mp4')
  })

  it('handles empty optional variables gracefully', () => {
    const res = formatPathFromTemplate('{course}/{teacher}/{fileName}', {
      course: '大学物理',
      fileName: 'chapter1.pdf'
    })
    expect(res).toBe('大学物理/chapter1.pdf')
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
  it('<1TB → GB（2 位小数）', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB')
    expect(formatBytes(1024 * 1024 * 1024 * 2.5)).toBe('2.50 GB')
  })
  it('≥1TB → TB（2 位小数）', () => {
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1.00 TB')
    expect(formatBytes(1024 * 1024 * 1024 * 1024 * 1.5)).toBe('1.50 TB')
  })
})


