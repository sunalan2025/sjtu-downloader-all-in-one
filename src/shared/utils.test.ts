import { describe, expect, it } from 'vitest'
import { sanitizeFsName, formatPathFromTemplate, formatBytes, buildCloudRemoteSegments } from './utils'
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

  it('prefixes Windows reserved device names with an underscore', () => {
    expect(sanitizeFsName('CON')).toBe('_CON')
    expect(sanitizeFsName('con.pdf')).toBe('_con.pdf')
    expect(sanitizeFsName('aux.docx')).toBe('_aux.docx')
    expect(sanitizeFsName('prn.tar.gz')).toBe('_prn.tar.gz')
    expect(sanitizeFsName('com1.mp4')).toBe('_com1.mp4')
    expect(sanitizeFsName('lpt2')).toBe('_lpt2')
    expect(sanitizeFsName('console.log')).toBe('console.log')
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

describe('buildCloudRemoteSegments', () => {
  it('falls back to defaultPrefix when destRoot is undefined', () => {
    const res = buildCloudRemoteSegments(undefined, ['2026-2027学年', '软件工程'], 'SJTU Canvas课程')
    expect(res).toEqual(['SJTU Canvas课程', '2026-2027学年', '软件工程'])
  })

  it('omits prefix when destRoot is undefined and defaultPrefix is not provided', () => {
    const res = buildCloudRemoteSegments(undefined, ['2026-2027学年', '软件工程'])
    expect(res).toEqual(['2026-2027学年', '软件工程'])
  })

  it('uses clean top-level folder when destRoot is specified', () => {
    const res = buildCloudRemoteSegments('/SJTU课程备份', ['2026-2027学年', '软件工程'], 'SJTU Canvas课程')
    expect(res).toEqual(['SJTU课程备份', '2026-2027学年', '软件工程'])
  })

  it('supports multi-level destRoot paths and strips leading/trailing slashes', () => {
    const res = buildCloudRemoteSegments('///我的归档/课程备份///', ['2026-2027学年', '软件工程'])
    expect(res).toEqual(['我的归档', '课程备份', '2026-2027学年', '软件工程'])
  })

  it('treats "/" or empty destRoot as root directory without any prefix', () => {
    const resSlash = buildCloudRemoteSegments('/', ['2026-2027学年', '软件工程'], 'SJTU Canvas课程')
    expect(resSlash).toEqual(['2026-2027学年', '软件工程'])

    const resEmpty = buildCloudRemoteSegments('', ['2026-2027学年', '软件工程'], 'SJTU Canvas课程')
    expect(resEmpty).toEqual(['2026-2027学年', '软件工程'])
  })

  it('sanitizes illegal file system characters in both root and sub-segments', () => {
    const res = buildCloudRemoteSegments('/备:份*目录?/', ['学期|1', '软件<工程>'])
    expect(res).toEqual(['备_份_目录_', '学期_1', '软件_工程_'])
  })
})



