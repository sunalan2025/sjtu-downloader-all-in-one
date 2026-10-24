import { describe, it, expect } from 'vitest'

// Production implementations
import {
  processPptSlices,
  formatSliceFileName,
  buildPptSliceDirName,
  mergeImagesToPdf
} from '../../src/main/canvas/ppt-download'
import { writeFileSync, unlinkSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  resolveBundledFfmpeg,
  FFMPEG_PATH
} from '../../src/main/canvas/hls-download'

// Contracts
import {
  processPptSlices as contractProcessPptSlices,
  formatSliceFileName as contractFormatSliceFileName,
  resolveBundledFfmpeg as contractResolveBundledFfmpeg
} from '../helpers/contracts'

describe('M3 Adversarial Stress Testing Suite: PPT Slices (R2-F7) & FFmpeg Path Resolution (R4-F3)', () => {

  // =========================================================================
  // Section 1: processPptSlices (R2-F7)
  // =========================================================================
  describe('1. processPptSlices Adversarial Stress Testing', () => {
    it('handles mixed hide values (string, number, boolean, null, undefined)', () => {
      const mixed = [
        { hide: 0, pptImgUrl: 'http://img/1.jpg', createSec: 10 },
        { hide: '0', pptImgUrl: 'http://img/2.jpg', createSec: 20 },
        { hide: ' 0 ', pptImgUrl: 'http://img/3.jpg', createSec: 30 },
        { hide: 1, pptImgUrl: 'http://img/4.jpg', createSec: 40 },
        { hide: '1', pptImgUrl: 'http://img/5.jpg', createSec: 50 },
        { hide: ' 1 ', pptImgUrl: 'http://img/6.jpg', createSec: 60 },
        { hide: false, pptImgUrl: 'http://img/7.jpg', createSec: 70 },
        { hide: true, pptImgUrl: 'http://img/8.jpg', createSec: 80 },
        { hide: null, pptImgUrl: 'http://img/9.jpg', createSec: 90 },
        { hide: undefined, pptImgUrl: 'http://img/10.jpg', createSec: 100 },
        { hide: '', pptImgUrl: 'http://img/11.jpg', createSec: 110 },
        { hide: 2, pptImgUrl: 'http://img/12.jpg', createSec: 120 },
        { hide: -1, pptImgUrl: 'http://img/13.jpg', createSec: 130 }
      ]

      const res = processPptSlices(mixed)
      const kept = res.slices.map(s => s.createSec)
      // Number(0)===0, Number('0')===0, Number(' 0 ')===0, Number(false)===0, Number(null)===0, Number('')===0
      expect(kept).toEqual([10, 20, 30, 70, 90, 110])
      expect(res.totalVisible).toBe(6)
    })

    it('correctly sorts scrambled and unordered createSec', () => {
      const scrambled = [
        { createSec: 150, pptImgUrl: 'http://img/150.jpg', hide: 0 },
        { createSec: 10, pptImgUrl: 'http://img/10.jpg', hide: 0 },
        { createSec: 0, pptImgUrl: 'http://img/0.jpg', hide: 0 },
        { createSec: 90, pptImgUrl: 'http://img/90.jpg', hide: 0 },
        { createSec: 35, pptImgUrl: 'http://img/35.jpg', hide: 0 }
      ]
      const res = processPptSlices(scrambled)
      expect(res.slices.map(s => s.createSec)).toEqual([0, 10, 35, 90, 150])
    })

    it('handles string, float, and duplicate createSec values', () => {
      const items = [
        { createSec: '120', pptImgUrl: 'http://img/120.jpg', hide: 0 },
        { createSec: '5.5', pptImgUrl: 'http://img/5.5.jpg', hide: 0 },
        { createSec: 25.2, pptImgUrl: 'http://img/25.2.jpg', hide: 0 },
        { createSec: '0', pptImgUrl: 'http://img/0.jpg', hide: 0 },
        { createSec: 25.2, pptImgUrl: 'http://img/25.2_dupe.jpg', hide: 0 }
      ]
      const res = processPptSlices(items)
      expect(res.slices.map(s => s.createSec)).toEqual([0, 5.5, 25.2, 25.2, 120])
      expect(res.slices.length).toBe(5)
    })

    it('gracefully handles missing createSec by falling back to 0', () => {
      const items = [
        { pptImgUrl: 'http://img/1.jpg', hide: 0, createSec: null },
        { pptImgUrl: 'http://img/2.jpg', hide: 0, createSec: undefined },
        { pptImgUrl: 'http://img/3.jpg', hide: 0 },
        { pptImgUrl: 'http://img/4.jpg', hide: 0, createSec: 50 }
      ]
      const res = processPptSlices(items)
      expect(res.slices.length).toBe(4)
      expect(res.slices.map(s => s.createSec)).toEqual([0, 0, 0, 50])
    })

    it('handles empty slices array and non-array inputs safely', () => {
      expect(processPptSlices([]).slices).toEqual([])
      expect(processPptSlices(null as any).slices).toEqual([])
      expect(processPptSlices(undefined as any).slices).toEqual([])
      expect(processPptSlices('invalid' as any).slices).toEqual([])
      expect(processPptSlices(12345 as any).slices).toEqual([])
      expect(processPptSlices({} as any).slices).toEqual([])
    })

    it('filters out null, undefined, primitive items and items without pptImgUrl', () => {
      const dirty = [
        null,
        undefined,
        'corrupted',
        99,
        {},
        { hide: 0 }, // no url
        { hide: 0, pptImgUrl: '' }, // empty url
        { hide: 0, pptImgUrl: 'http://ok.jpg', createSec: 15 }
      ]
      const res = processPptSlices(dirty as any)
      expect(res.slices.length).toBe(1)
      expect(res.slices[0].pptImgUrl).toBe('http://ok.jpg')
    })

    it('correctly reports willSaveImages based on options', () => {
      const input = [{ hide: 0, pptImgUrl: 'http://ok.jpg', createSec: 10 }]
      expect(processPptSlices(input, { saveImages: true }).willSaveImages).toBe(true)
      expect(processPptSlices(input, { saveImages: false }).willSaveImages).toBe(false)
      expect(processPptSlices(input).willSaveImages).toBe(false)
      expect(processPptSlices(input, {}).willSaveImages).toBe(false)
    })

    it('survives high volume stress (5,000 slices) efficiently', () => {
      const large = Array.from({ length: 5000 }, (_, i) => ({
        ivsVideoId: 100,
        createSec: Math.floor(Math.random() * 3600),
        hide: i % 2 === 0 ? 0 : 1,
        pptImgUrl: `https://s3.jcloud.sjtu.edu.cn/slice_${i}.jpg`
      }))
      const res = processPptSlices(large)
      expect(res.slices.length).toBe(2500)
      for (let i = 1; i < res.slices.length; i++) {
        expect(res.slices[i].createSec).toBeGreaterThanOrEqual(res.slices[i - 1].createSec)
      }
    })
  })

  // =========================================================================
  // Section 2: formatSliceFileName (R2-F7)
  // =========================================================================
  describe('2. formatSliceFileName Stress Testing', () => {
    it('pads index with leading zeros across 1..9, 10..99, 100+', () => {
      expect(formatSliceFileName(1, 10)).toBe('01_00m10s.jpg')
      expect(formatSliceFileName(9, 10)).toBe('09_00m10s.jpg')
      expect(formatSliceFileName(10, 10)).toBe('10_00m10s.jpg')
      expect(formatSliceFileName(99, 10)).toBe('99_00m10s.jpg')
      expect(formatSliceFileName(100, 10)).toBe('100_00m10s.jpg')
      expect(formatSliceFileName(0, 10)).toBe('00_00m10s.jpg')
    })

    it('formats boundary timestamp ranges accurately (0s to 100h)', () => {
      expect(formatSliceFileName(1, 0)).toBe('01_00m00s.jpg')
      expect(formatSliceFileName(1, 1)).toBe('01_00m01s.jpg')
      expect(formatSliceFileName(1, 59)).toBe('01_00m59s.jpg')
      expect(formatSliceFileName(1, 60)).toBe('01_01m00s.jpg')
      expect(formatSliceFileName(1, 65)).toBe('01_01m05s.jpg')
      expect(formatSliceFileName(1, 3599)).toBe('01_59m59s.jpg')
      expect(formatSliceFileName(1, 3600)).toBe('01_01h00m00s.jpg')
      expect(formatSliceFileName(1, 3661)).toBe('01_01h01m01s.jpg')
      expect(formatSliceFileName(1, 7200)).toBe('01_02h00m00s.jpg')
      expect(formatSliceFileName(1, 86400)).toBe('01_24h00m00s.jpg')
      expect(formatSliceFileName(1, 360000)).toBe('01_100h00m00s.jpg')
    })

    it('handles negative, float, and non-numeric createSec safely', () => {
      expect(formatSliceFileName(1, -10)).toBe('01_00m00s.jpg')
      expect(formatSliceFileName(1, 15.9)).toBe('01_00m15s.jpg')
      expect(formatSliceFileName(1, NaN)).toBe('01_00m00s.jpg')
      expect(formatSliceFileName(1, null as any)).toBe('01_00m00s.jpg')
      expect(formatSliceFileName(1, undefined as any)).toBe('01_00m00s.jpg')
    })

    it('normalizes file extensions with or without leading dot', () => {
      expect(formatSliceFileName(1, 10, 'jpg')).toBe('01_00m10s.jpg')
      expect(formatSliceFileName(1, 10, '.jpg')).toBe('01_00m10s.jpg')
      expect(formatSliceFileName(1, 10, 'png')).toBe('01_00m10s.png')
      expect(formatSliceFileName(1, 10, '.png')).toBe('01_00m10s.png')
      expect(formatSliceFileName(1, 10, '.jpeg')).toBe('01_00m10s.jpeg')
    })
  })

  // =========================================================================
  // Section 3: buildPptSliceDirName (R2-F7)
  // =========================================================================
  describe('3. buildPptSliceDirName Stress Testing', () => {
    it('appends -切片 to standard lecture names', () => {
      expect(buildPptSliceDirName('高等数学(第1讲)')).toBe('高等数学(第1讲)-切片')
      expect(buildPptSliceDirName('Lecture 01 - Intro')).toBe('Lecture 01 - Intro-切片')
    })

    it('sanitizes Windows and POSIX forbidden filesystem characters', () => {
      const dirSlash = buildPptSliceDirName('Lecture/01')
      const dirColon = buildPptSliceDirName('Lec 1: Intro')
      const dirStar = buildPptSliceDirName('Math*Review?')
      const dirQuotes = buildPptSliceDirName('<Book> "Chapter 1"')
      const dirPipe = buildPptSliceDirName('A | B')

      expect(dirSlash).not.toContain('/')
      expect(dirColon).not.toContain(':')
      expect(dirStar).not.toContain('*')
      expect(dirStar).not.toContain('?')
      expect(dirQuotes).not.toContain('<')
      expect(dirQuotes).not.toContain('>')
      expect(dirQuotes).not.toContain('"')
      expect(dirPipe).not.toContain('|')

      expect(dirSlash).toBe('Lecture_01-切片')
      expect(dirColon).toBe('Lec 1_ Intro-切片')
      expect(dirStar).toBe('Math_Review_-切片')
      expect(dirQuotes).toBe('_Book_ _Chapter 1_-切片')
      expect(dirPipe).toBe('A _ B-切片')
    })

    it('strips trailing dots and spaces to avoid Windows filesystem corruption', () => {
      expect(buildPptSliceDirName('Lecture 1... ')).toBe('Lecture 1-切片')
      expect(buildPptSliceDirName('Lecture 1   ')).toBe('Lecture 1-切片')
    })

    it('safely falls back to 未命名-切片 for empty or whitespace-only inputs', () => {
      expect(buildPptSliceDirName('')).toBe('未命名-切片')
      expect(buildPptSliceDirName('   ')).toBe('未命名-切片')
    })

    it('truncates ultra-long lecture names to prevent Windows MAX_PATH failures', () => {
      const longName = 'A'.repeat(300)
      const res = buildPptSliceDirName(longName)
      expect(res.length).toBeLessThanOrEqual(185)
      expect(res.endsWith('-切片')).toBe(true)
    })
  })

  // =========================================================================
  // Section 4: resolveBundledFfmpeg (R4-F3)
  // =========================================================================
  describe('4. resolveBundledFfmpeg Stress Testing', () => {
    it('resolves to app.asar.unpacked when unpacked binary exists', () => {
      const bundled = 'C:\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe'
      const unpacked = 'C:\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe'
      const res = resolveBundledFfmpeg(bundled, p => p === unpacked || p === bundled)
      expect(res).toBe(unpacked)
    })

    it('falls back to bundled path when only packed binary exists', () => {
      const bundled = 'C:\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe'
      const res = resolveBundledFfmpeg(bundled, p => p === bundled)
      expect(res).toBe(bundled)
    })

    it('falls back to system ffmpeg when neither unpacked nor packed exists', () => {
      const bundled = 'C:\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe'
      const res = resolveBundledFfmpeg(bundled, () => false)
      expect(res).toBe('ffmpeg')
    })

    it('returns ffmpeg when bundledPath is empty, null, or undefined', () => {
      expect(resolveBundledFfmpeg('', () => true)).toBe('ffmpeg')
      expect(resolveBundledFfmpeg(null as any, () => true)).toBe('ffmpeg')
      expect(resolveBundledFfmpeg(undefined as any, () => true)).toBe('ffmpeg')
    })

    it('resolves dev paths (without app.asar) cleanly', () => {
      const devPath = 'D:\\dev\\node_modules\\ffmpeg-static\\ffmpeg.exe'
      expect(resolveBundledFfmpeg(devPath, p => p === devPath)).toBe(devPath)
      expect(resolveBundledFfmpeg(devPath, () => false)).toBe('ffmpeg')
    })

    it('handles Unix forward-slash paths and paths with spaces', () => {
      const unixBundled = '/app/resources/app.asar/node_modules/ffmpeg-static/ffmpeg'
      const unixUnpacked = '/app/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg'
      expect(resolveBundledFfmpeg(unixBundled, p => p === unixUnpacked)).toBe(unixUnpacked)

      const spacedBundled = 'C:\\Program Files\\App\\resources\\app.asar\\ffmpeg.exe'
      const spacedUnpacked = 'C:\\Program Files\\App\\resources\\app.asar.unpacked\\ffmpeg.exe'
      expect(resolveBundledFfmpeg(spacedBundled, p => p === spacedUnpacked)).toBe(spacedUnpacked)
    })

    it('exports a valid non-empty FFMPEG_PATH in production', () => {
      expect(typeof FFMPEG_PATH).toBe('string')
      expect(FFMPEG_PATH.length).toBeGreaterThan(0)
    })
  })

  // =========================================================================
  // Section 5: Parity with Interface Contracts
  // =========================================================================
  describe('5. Parity between Production and Interface Contracts', () => {
    it('maintains strict parity between production and contracts for processPptSlices', () => {
      const sample = [
        { ivsVideoId: 1, createSec: 50, hide: '0', pptImgUrl: 'http://img1.jpg' },
        { ivsVideoId: 2, createSec: 10, hide: 1, pptImgUrl: 'http://img2.jpg' },
        { ivsVideoId: 3, createSec: 20, hide: 0, pptImgUrl: 'http://img3.jpg' }
      ]
      expect(processPptSlices(sample)).toEqual(contractProcessPptSlices(sample))
    })

    it('maintains strict parity for formatSliceFileName', () => {
      for (const t of [0, 10, 60, 3600, 3661]) {
        expect(formatSliceFileName(1, t)).toBe(contractFormatSliceFileName(1, t))
      }
    })

    it('maintains parity for resolveBundledFfmpeg', () => {
      const bundled = 'C:\\resources\\app.asar\\ffmpeg.exe'
      expect(resolveBundledFfmpeg(bundled, () => false)).toBe(contractResolveBundledFfmpeg(bundled, () => false))
    })
  })

  // =========================================================================
  // Section 6: mergeImagesToPdf Resilient PDF Generation & Async Handling
  // =========================================================================
  describe('6. mergeImagesToPdf Resilient PDF Generation & Corrupt Slice Handling', () => {
    it('gracefully handles corrupt images and html error pages without throwing', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'ppt_test_'))
      try {
        const validPngPath = join(tempDir, 'valid.png')
        // 1x1 valid transparent PNG
        const pngBuf = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex')
        writeFileSync(validPngPath, pngBuf)

        const corruptPath = join(tempDir, 'corrupt.jpg')
        writeFileSync(corruptPath, Buffer.from('<html><body>502 Bad Gateway</body></html>'))

        const outPdfPath = join(tempDir, 'merged.pdf')
        await mergeImagesToPdf([validPngPath, corruptPath], outPdfPath)

        expect(existsSync(outPdfPath)).toBe(true)
        expect(statSync(outPdfPath).size).toBeGreaterThan(100)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('creates a non-empty fallback page if all slice images are corrupted', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'ppt_test_corrupt_'))
      try {
        const corruptPath = join(tempDir, 'bad.png')
        writeFileSync(corruptPath, Buffer.from('bad data here'))

        const outPdfPath = join(tempDir, 'corrupt_merged.pdf')
        await mergeImagesToPdf([corruptPath], outPdfPath)

        expect(existsSync(outPdfPath)).toBe(true)
        expect(statSync(outPdfPath).size).toBeGreaterThan(100)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })
})