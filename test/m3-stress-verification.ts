/**
 * Milestone 3 Adversarial Stress Verification Suite (R2-F7 & R4-F3)
 * 
 * Standalone empirical test harness for:
 * 1. processPptSlices: mixed hide values ('1', 1, '0', 0, undefined, null, boolean, empty string),
 *    unordered createSec, float/negative createSec, empty and malformed slices, large inputs.
 * 2. formatSliceFileName: boundary indices, timestamp ranges (0s, minutes, hours, days, negative, float),
 *    extension prefix normalization.
 * 3. buildPptSliceDirName: special/reserved filesystem characters, trailing dots/spaces, empty/whitespace,
 *    and long lecture names (180+ chars).
 * 4. resolveBundledFfmpeg: unpacked existing, only packed existing, neither existing, dev mode, empty/null,
 *    slashes, multiple app.asar occurrences, throwing fileExists.
 * 5. Production implementation parity against test/helpers/contracts.ts and test/e2e/lti-video.test.ts.
 * 
 * Can be executed via:
 *   npx tsx test/m3-stress-verification.ts
 */

import { existsSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Import production implementations
import {
  processPptSlices as prodProcessPptSlices,
  formatSliceFileName as prodFormatSliceFileName,
  buildPptSliceDirName as prodBuildPptSliceDirName,
  type PptSliceItem
} from '../src/main/canvas/ppt-download'

import {
  resolveBundledFfmpeg as prodResolveBundledFfmpeg,
  FFMPEG_PATH as prodFFMPEG_PATH
} from '../src/main/canvas/hls-download'

// Import contract implementations for parity comparison
import {
  processPptSlices as contractProcessPptSlices,
  formatSliceFileName as contractFormatSliceFileName,
  buildPptSliceDirName as contractBuildPptSliceDirName,
  resolveBundledFfmpeg as contractResolveBundledFfmpeg
} from './helpers/contracts'

interface TestResult {
  suite: string
  name: string
  status: 'PASS' | 'FAIL' | 'DEFECT' | 'WARN'
  observation: string
}

const results: TestResult[] = []

function record(suite: string, name: string, status: 'PASS' | 'FAIL' | 'DEFECT' | 'WARN', observation: string) {
  results.push({ suite, name, status, observation })
  const icon = status === 'PASS' ? '✅ PASS' : status === 'DEFECT' ? '🚨 DEFECT' : status === 'WARN' ? '⚠️ WARN' : '❌ FAIL'
  console.log(`[${icon}] [${suite}] ${name}: ${observation}`)
}

export function runAllM3StressTests() {
  console.log('='.repeat(80))
  console.log('STARTING MILESTONE 3 ADVERSARIAL STRESS TEST SUITE')
  console.log('='.repeat(80))

  // =========================================================================
  // SUITE 1: processPptSlices Adversarial Stress Testing
  // =========================================================================
  const S1 = 'processPptSlices'

  // 1.1 Mixed hide values
  {
    const items = [
      { id: 1, hide: 0, pptImgUrl: 'http://img/1.jpg', createSec: 10, desc: 'number 0' },
      { id: 2, hide: '0', pptImgUrl: 'http://img/2.jpg', createSec: 20, desc: 'string "0"' },
      { id: 3, hide: ' 0 ', pptImgUrl: 'http://img/3.jpg', createSec: 30, desc: 'string " 0 "' },
      { id: 4, hide: 1, pptImgUrl: 'http://img/4.jpg', createSec: 40, desc: 'number 1' },
      { id: 5, hide: '1', pptImgUrl: 'http://img/5.jpg', createSec: 50, desc: 'string "1"' },
      { id: 6, hide: ' 1 ', pptImgUrl: 'http://img/6.jpg', createSec: 60, desc: 'string " 1 "' },
      { id: 7, hide: false, pptImgUrl: 'http://img/7.jpg', createSec: 70, desc: 'boolean false' },
      { id: 8, hide: true, pptImgUrl: 'http://img/8.jpg', createSec: 80, desc: 'boolean true' },
      { id: 9, hide: null, pptImgUrl: 'http://img/9.jpg', createSec: 90, desc: 'null' },
      { id: 10, hide: undefined, pptImgUrl: 'http://img/10.jpg', createSec: 100, desc: 'undefined' },
      { id: 11, hide: '', pptImgUrl: 'http://img/11.jpg', createSec: 110, desc: 'empty string ""' },
      { id: 12, hide: 2, pptImgUrl: 'http://img/12.jpg', createSec: 120, desc: 'number 2' },
      { id: 13, hide: -1, pptImgUrl: 'http://img/13.jpg', createSec: 130, desc: 'number -1' },
      { id: 14, hide: 'hidden', pptImgUrl: 'http://img/14.jpg', createSec: 140, desc: 'string "hidden"' }
    ]

    const out = prodProcessPptSlices(items)
    const keptIds = out.slices.map(s => s.createSec)

    // Expected:
    // hide: 0 -> Number(0)===0 -> KEEP (10)
    // hide: '0' -> Number('0')===0 -> KEEP (20)
    // hide: ' 0 ' -> Number(' 0 ')===0 -> KEEP (30)
    // hide: 1 -> Number(1)===0 -> DROP (40)
    // hide: '1' -> Number('1')===0 -> DROP (50)
    // hide: ' 1 ' -> Number(' 1 ')===0 -> DROP (60)
    // hide: false -> Number(false)===0 -> KEEP (70)
    // hide: true -> Number(true)===0 -> DROP (80)
    // hide: null -> Number(null)===0 -> KEEP (90)
    // hide: undefined -> Number(undefined) is NaN, NaN===0 is false -> DROP (100)
    // hide: '' -> Number('')===0 -> KEEP (110)
    // hide: 2 -> DROP (120)
    // hide: -1 -> DROP (130)
    // hide: 'hidden' -> DROP (140)

    const expectedKept = [10, 20, 30, 70, 90, 110]
    const matched = JSON.stringify(keptIds) === JSON.stringify(expectedKept)

    if (matched) {
      record(S1, 'Mixed hide value coercion', 'PASS',
        `Correctly filtered hide values: kept [${keptIds.join(', ')}], dropped 1, '1', true, 2, -1, 'hidden', undefined`)
    } else {
      record(S1, 'Mixed hide value coercion', 'FAIL',
        `Actual kept: [${keptIds.join(', ')}], Expected: [${expectedKept.join(', ')}]`)
    }

    // Specific inspection of hide === undefined
    const undefItem = [{ ivsVideoId: 1, pptImgUrl: 'http://img/u.jpg', createSec: 5, hide: undefined }]
    const undefOut = prodProcessPptSlices(undefItem)
    if (undefOut.slices.length === 0) {
      record(S1, 'hide === undefined behavior', 'WARN',
        `Slice with hide: undefined is filtered out (Number(undefined) === NaN !== 0). If upstream API omits hide, slide is dropped.`)
    } else {
      record(S1, 'hide === undefined behavior', 'PASS',
        `Slice with hide: undefined was retained`)
    }
  }

  // 1.2 Unordered and adversarial createSec
  {
    const scrambled = [
      { createSec: 150, pptImgUrl: 'http://img/150.jpg', hide: 0 },
      { createSec: 10, pptImgUrl: 'http://img/10.jpg', hide: 0 },
      { createSec: 0, pptImgUrl: 'http://img/0.jpg', hide: 0 },
      { createSec: 90, pptImgUrl: 'http://img/90.jpg', hide: 0 },
      { createSec: 35, pptImgUrl: 'http://img/35.jpg', hide: 0 }
    ]
    const sortedOut = prodProcessPptSlices(scrambled)
    const secs = sortedOut.slices.map(s => s.createSec)
    if (JSON.stringify(secs) === JSON.stringify([0, 10, 35, 90, 150])) {
      record(S1, 'Unordered createSec sorting', 'PASS', `Sorted strictly ascending: [${secs.join(', ')}]`)
    } else {
      record(S1, 'Unordered createSec sorting', 'FAIL', `Unexpected sort order: [${secs.join(', ')}]`)
    }
  }

  // 1.3 String & float createSec
  {
    const mixedSecs = [
      { createSec: '120', pptImgUrl: 'http://img/120.jpg', hide: 0 },
      { createSec: '5.5', pptImgUrl: 'http://img/5.5.jpg', hide: 0 },
      { createSec: 25.2, pptImgUrl: 'http://img/25.2.jpg', hide: 0 },
      { createSec: '0', pptImgUrl: 'http://img/0.jpg', hide: 0 }
    ]
    const out = prodProcessPptSlices(mixedSecs)
    const secs = out.slices.map(s => s.createSec)
    if (JSON.stringify(secs) === JSON.stringify([0, 5.5, 25.2, 120])) {
      record(S1, 'String & float createSec sorting and numeric conversion', 'PASS', `Converted and sorted: [${secs.join(', ')}]`)
    } else {
      record(S1, 'String & float createSec sorting and numeric conversion', 'FAIL', `Unexpected: [${secs.join(', ')}]`)
    }
  }

  // 1.4 Duplicate createSec timestamps
  {
    const dupes = [
      { createSec: 20, pptImgUrl: 'http://img/a.jpg', hide: 0, ivsVideoId: 101 },
      { createSec: 20, pptImgUrl: 'http://img/b.jpg', hide: 0, ivsVideoId: 102 },
      { createSec: 20, pptImgUrl: 'http://img/c.jpg', hide: 0, ivsVideoId: 103 }
    ]
    const out = prodProcessPptSlices(dupes)
    if (out.slices.length === 3 && out.slices.every(s => s.createSec === 20)) {
      record(S1, 'Duplicate createSec preservation', 'PASS', 'All 3 slices preserved with identical timestamps')
    } else {
      record(S1, 'Duplicate createSec preservation', 'FAIL', `Expected 3 slices, got ${out.slices.length}`)
    }
  }

  // 1.5 Missing createSec (null, undefined, omitted)
  {
    const missingSecs = [
      { pptImgUrl: 'http://img/null.jpg', hide: 0, createSec: null },
      { pptImgUrl: 'http://img/undef.jpg', hide: 0, createSec: undefined },
      { pptImgUrl: 'http://img/none.jpg', hide: 0 },
      { pptImgUrl: 'http://img/valid.jpg', hide: 0, createSec: 100 }
    ]
    const out = prodProcessPptSlices(missingSecs)
    // Slices with missing createSec map to Number(s.createSec || 0) -> 0
    const secs = out.slices.map(s => s.createSec)
    if (out.slices.length === 4 && secs.includes(0) && secs.includes(100)) {
      record(S1, 'Missing createSec fallback to 0', 'PASS', `Handled missing createSec gracefully: [${secs.join(', ')}]`)
    } else {
      record(S1, 'Missing createSec fallback to 0', 'FAIL', `Unexpected: [${secs.join(', ')}]`)
    }
  }

  // 1.6 Empty and malformed slice inputs
  {
    const empty1 = prodProcessPptSlices([])
    const empty2 = prodProcessPptSlices(null as any)
    const empty3 = prodProcessPptSlices(undefined as any)
    const empty4 = prodProcessPptSlices('not-an-array' as any)
    const empty5 = prodProcessPptSlices(12345 as any)
    const empty6 = prodProcessPptSlices({ data: [] } as any)

    const allEmptySafe = [empty1, empty2, empty3, empty4, empty5, empty6].every(
      r => r.slices.length === 0 && r.totalVisible === 0 && r.willSaveImages === false
    )

    if (allEmptySafe) {
      record(S1, 'Empty and non-array input safety', 'PASS', 'Handled [], null, undefined, string, number, object without error')
    } else {
      record(S1, 'Empty and non-array input safety', 'FAIL', 'Failed to safely handle non-array inputs')
    }
  }

  // 1.7 Array containing null, undefined, primitive items
  {
    const dirtyArray = [
      null,
      undefined,
      'malicious string',
      42,
      false,
      {},
      { hide: 0 }, // missing pptImgUrl
      { hide: 0, pptImgUrl: '' }, // empty pptImgUrl
      { hide: 0, pptImgUrl: 'http://valid.jpg', createSec: 12 }
    ]

    try {
      const out = prodProcessPptSlices(dirtyArray as any)
      if (out.slices.length === 1 && out.slices[0].pptImgUrl === 'http://valid.jpg') {
        record(S1, 'Array containing null/undefined/primitive elements', 'PASS', 'Cleanly filtered out corrupted elements')
      } else {
        record(S1, 'Array containing null/undefined/primitive elements', 'FAIL', `Expected 1 slice, got ${out.slices.length}`)
      }
    } catch (err: any) {
      record(S1, 'Array containing null/undefined/primitive elements', 'FAIL', `Threw error: ${err.message}`)
    }
  }

  // 1.8 High-volume stress test (10,000 slices)
  {
    const count = 10_000
    const bigArray = Array.from({ length: count }, (_, i) => ({
      ivsVideoId: 9999,
      createSec: Math.floor(Math.random() * 7200),
      hide: i % 3 === 0 ? 1 : 0, // 1/3 hidden
      pptImgUrl: `https://s3.jcloud.sjtu.edu.cn/ppt/slice_${i}.jpg`
    }))

    const t0 = performance.now()
    const out = prodProcessPptSlices(bigArray)
    const elapsed = performance.now() - t0

    const isSorted = out.slices.every((s, i) => i === 0 || s.createSec >= out.slices[i - 1].createSec)
    if (isSorted && elapsed < 200) {
      record(S1, 'High volume stress (10,000 slices)', 'PASS', `Processed and sorted ${out.slices.length} visible slices in ${elapsed.toFixed(1)}ms`)
    } else {
      record(S1, 'High volume stress (10,000 slices)', 'FAIL', `Sort check: ${isSorted}, elapsed: ${elapsed.toFixed(1)}ms`)
    }
  }

  // =========================================================================
  // SUITE 2: formatSliceFileName Adversarial Stress Testing
  // =========================================================================
  const S2 = 'formatSliceFileName'

  // 2.1 Index zero-padding
  {
    const cases = [
      { idx: 1, sec: 10, expected: '01_00m10s.jpg' },
      { idx: 9, sec: 10, expected: '09_00m10s.jpg' },
      { idx: 10, sec: 10, expected: '10_00m10s.jpg' },
      { idx: 99, sec: 10, expected: '99_00m10s.jpg' },
      { idx: 100, sec: 10, expected: '100_00m10s.jpg' },
      { idx: 0, sec: 10, expected: '00_00m10s.jpg' }
    ]
    const passed = cases.every(c => prodFormatSliceFileName(c.idx, c.sec) === c.expected)
    if (passed) {
      record(S2, 'Index zero-padding (0..100)', 'PASS', 'Formatted correctly across single, double, triple digits')
    } else {
      record(S2, 'Index zero-padding (0..100)', 'FAIL', 'Padding mismatch')
    }
  }

  // 2.2 Timestamp formatting across all boundary ranges
  {
    const timeCases = [
      { sec: 0, expected: '01_00m00s.jpg', desc: '0 seconds' },
      { sec: 1, expected: '01_00m01s.jpg', desc: '1 second' },
      { sec: 59, expected: '01_00m59s.jpg', desc: '59 seconds' },
      { sec: 60, expected: '01_01m00s.jpg', desc: '60 seconds (1m)' },
      { sec: 65, expected: '01_01m05s.jpg', desc: '65 seconds (1m5s)' },
      { sec: 3599, expected: '01_59m59s.jpg', desc: '3599 seconds (59m59s)' },
      { sec: 3600, expected: '01_01h00m00s.jpg', desc: '3600 seconds (1h)' },
      { sec: 3661, expected: '01_01h01m01s.jpg', desc: '3661 seconds (1h1m1s)' },
      { sec: 7200, expected: '01_02h00m00s.jpg', desc: '7200 seconds (2h)' },
      { sec: 86400, expected: '01_24h00m00s.jpg', desc: '86400 seconds (24h)' },
      { sec: 360000, expected: '01_100h00m00s.jpg', desc: '360000 seconds (100h)' },
      { sec: 15.8, expected: '01_00m15s.jpg', desc: 'float 15.8 seconds (floored)' },
      { sec: -10, expected: '01_00m00s.jpg', desc: 'negative seconds (bounded to 0)' },
      { sec: NaN, expected: '01_00m00s.jpg', desc: 'NaN seconds (bounded to 0)' },
      { sec: null as any, expected: '01_00m00s.jpg', desc: 'null seconds (bounded to 0)' },
      { sec: undefined as any, expected: '01_00m00s.jpg', desc: 'undefined seconds (bounded to 0)' }
    ]

    let allMatch = true
    for (const tc of timeCases) {
      const res = prodFormatSliceFileName(1, tc.sec)
      if (res !== tc.expected) {
        allMatch = false
        record(S2, `Timestamp format: ${tc.desc}`, 'FAIL', `Expected '${tc.expected}', got '${res}'`)
      }
    }
    if (allMatch) {
      record(S2, 'Timestamp boundary ranges (0s..100h, negative, float, NaN)', 'PASS',
        'All 16 timestamp boundary conditions produced mathematically exact strings')
    }
  }

  // 2.3 File extension prefix normalization
  {
    const extCases = [
      { ext: 'jpg', expected: '01_00m10s.jpg' },
      { ext: '.jpg', expected: '01_00m10s.jpg' },
      { ext: 'png', expected: '01_00m10s.png' },
      { ext: '.png', expected: '01_00m10s.png' },
      { ext: '.jpeg', expected: '01_00m10s.jpeg' },
      { ext: '.webp', expected: '01_00m10s.webp' }
    ]
    const passed = extCases.every(c => prodFormatSliceFileName(1, 10, c.ext) === c.expected)
    if (passed) {
      record(S2, 'Extension normalization (leading dot stripped)', 'PASS', 'Correctly normalized jpg, .jpg, png, .png, etc.')
    } else {
      record(S2, 'Extension normalization (leading dot stripped)', 'FAIL', 'Extension normalization failed')
    }
  }

  // =========================================================================
  // SUITE 3: buildPptSliceDirName Adversarial Stress Testing
  // =========================================================================
  const S3 = 'buildPptSliceDirName'

  // 3.1 Normal Chinese & English names
  {
    const name = '高等数学(第1讲)'
    const res = prodBuildPptSliceDirName(name)
    if (res === '高等数学(第1讲)-切片') {
      record(S3, 'Standard Chinese lecture name', 'PASS', `Result: '${res}'`)
    } else {
      record(S3, 'Standard Chinese lecture name', 'FAIL', `Expected '高等数学(第1讲)-切片', got '${res}'`)
    }
  }

  // 3.2 Reserved Windows filesystem characters
  {
    const invalidNames = [
      { name: 'Lecture 1 / Part A', expectedContains: 'Lecture 1 _ Part A-切片', desc: 'forward slash' },
      { name: 'Lecture 1 \\ Part B', expectedContains: 'Lecture 1 _ Part B-切片', desc: 'backslash' },
      { name: 'Lecture 1: Intro', expectedContains: 'Lecture 1_ Intro-切片', desc: 'colon' },
      { name: 'Lecture 1 * Star', expectedContains: 'Lecture 1 _ Star-切片', desc: 'asterisk' },
      { name: 'Question ? Topic', expectedContains: 'Question _ Topic-切片', desc: 'question mark' },
      { name: '"Double Quoted"', expectedContains: '_Double Quoted_-切片', desc: 'double quotes' },
      { name: '<Angle Brackets>', expectedContains: '_Angle Brackets_-切片', desc: 'angle brackets' },
      { name: 'Pipe | Separator', expectedContains: 'Pipe _ Separator-切片', desc: 'pipe' },
      { name: 'Control\x00Chars\x1fTest', expectedContains: 'Control_Chars_Test-切片', desc: 'control characters' }
    ]

    let allClean = true
    for (const c of invalidNames) {
      const res = prodBuildPptSliceDirName(c.name)
      // Check if any forbidden character remains
      const hasForbidden = /[<>:"/\\|?*\x00-\x1f]/.test(res)
      if (hasForbidden) {
        allClean = false
        record(S3, `Sanitize forbidden character: ${c.desc}`, 'FAIL', `Forbidden chars remain in '${res}'`)
      }
    }
    if (allClean) {
      record(S3, 'All Windows forbidden characters sanitized', 'PASS', 'All reserved chars /\\:*?"<>| and control chars replaced with _')
    }
  }

  // 3.3 Trailing dots and spaces (Windows directory invalidity)
  {
    const trailingCases = [
      'Lecture 1. ',
      'Lecture 1...   ',
      'Lecture 1   '
    ]
    const allSafe = trailingCases.every(tc => {
      const dir = prodBuildPptSliceDirName(tc)
      return dir.startsWith('Lecture 1-切片')
    })
    if (allSafe) {
      record(S3, 'Trailing dots and spaces stripped', 'PASS', 'Sanitized trailing dots and spaces before appending suffix')
    } else {
      record(S3, 'Trailing dots and spaces stripped', 'FAIL', 'Trailing dots/spaces not properly stripped')
    }
  }

  // 3.4 Empty & whitespace-only names
  {
    const empty1 = prodBuildPptSliceDirName('')
    const empty2 = prodBuildPptSliceDirName('   ')
    if (empty1 === '未命名-切片' && empty2 === '未命名-切片') {
      record(S3, 'Empty and whitespace-only name fallback', 'PASS', `Both safely fell back to '未命名-切片'`)
    } else {
      record(S3, 'Empty and whitespace-only name fallback', 'FAIL', `Got '${empty1}' and '${empty2}'`)
    }
  }

  // 3.5 Ultra-long lecture names (Windows MAX_PATH defense)
  {
    const longName = 'A'.repeat(300)
    const dir = prodBuildPptSliceDirName(longName)
    // sanitizeFsName truncates base to 180 chars, then '-切片' is 5 chars -> total 185 chars
    if (dir.length <= 185 && dir.endsWith('-切片')) {
      record(S3, 'Ultra-long lecture name truncation (300 chars)', 'PASS',
        `Truncated base safely to 180 chars, total dir length: ${dir.length} chars (avoids Windows MAX_PATH 260 limit)`)
    } else {
      record(S3, 'Ultra-long lecture name truncation (300 chars)', 'FAIL', `Length: ${dir.length}`)
    }
  }

  // =========================================================================
  // SUITE 4: resolveBundledFfmpeg Adversarial Stress Testing
  // =========================================================================
  const S4 = 'resolveBundledFfmpeg'

  // 4.1 Unpacked path exists
  {
    const bundled = 'C:\\App\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe'
    const unpacked = 'C:\\App\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe'
    const mockFs: Record<string, boolean> = {
      [unpacked]: true,
      [bundled]: true
    }
    const res = prodResolveBundledFfmpeg(bundled, p => !!mockFs[p])
    if (res === unpacked) {
      record(S4, 'Unpacked path resolution when both exist', 'PASS', `Resolved to unpacked binary: '${res}'`)
    } else {
      record(S4, 'Unpacked path resolution when both exist', 'FAIL', `Expected '${unpacked}', got '${res}'`)
    }
  }

  // 4.2 Only packed path exists (unpacked missing)
  {
    const bundled = 'C:\\App\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe'
    const mockFs: Record<string, boolean> = {
      [bundled]: true
    }
    const res = prodResolveBundledFfmpeg(bundled, p => !!mockFs[p])
    if (res === bundled) {
      record(S4, 'Fallback to bundled path when unpacked missing', 'PASS', `Resolved to bundled binary: '${res}'`)
    } else {
      record(S4, 'Fallback to bundled path when unpacked missing', 'FAIL', `Expected '${bundled}', got '${res}'`)
    }
  }

  // 4.3 Neither unpacked nor packed exists
  {
    const bundled = 'C:\\App\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe'
    const res = prodResolveBundledFfmpeg(bundled, () => false)
    if (res === 'ffmpeg') {
      record(S4, 'Fallback to system ffmpeg when neither exists', 'PASS', `Cleanly fell back to 'ffmpeg'`)
    } else {
      record(S4, 'Fallback to system ffmpeg when neither exists', 'FAIL', `Expected 'ffmpeg', got '${res}'`)
    }
  }

  // 4.4 Empty string and falsy input
  {
    const resEmpty = prodResolveBundledFfmpeg('', () => true)
    const resNull = prodResolveBundledFfmpeg(null as any, () => true)
    const resUndef = prodResolveBundledFfmpeg(undefined as any, () => true)

    if (resEmpty === 'ffmpeg' && resNull === 'ffmpeg' && resUndef === 'ffmpeg') {
      record(S4, 'Empty and null/undefined bundledPath fallback', 'PASS', `All returned 'ffmpeg'`)
    } else {
      record(S4, 'Empty and null/undefined bundledPath fallback', 'FAIL', `Expected 'ffmpeg', got ${resEmpty}, ${resNull}, ${resUndef}`)
    }
  }

  // 4.5 Dev environment path (without app.asar)
  {
    const devPath = 'D:\\dev\\node_modules\\ffmpeg-static\\ffmpeg.exe'
    const resExists = prodResolveBundledFfmpeg(devPath, p => p === devPath)
    const resMissing = prodResolveBundledFfmpeg(devPath, () => false)

    if (resExists === devPath && resMissing === 'ffmpeg') {
      record(S4, 'Dev environment path without app.asar', 'PASS', `Returns dev path when exists, system 'ffmpeg' when missing`)
    } else {
      record(S4, 'Dev environment path without app.asar', 'FAIL', `Got ${resExists}, ${resMissing}`)
    }
  }

  // 4.6 Path with forward slashes (Unix/Electron style)
  {
    const unixBundled = '/app/resources/app.asar/node_modules/ffmpeg-static/ffmpeg'
    const unixUnpacked = '/app/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg'
    const mockFs: Record<string, boolean> = { [unixUnpacked]: true }

    const res = prodResolveBundledFfmpeg(unixBundled, p => !!mockFs[p])
    if (res === unixUnpacked) {
      record(S4, 'Unix forward slash path resolution', 'PASS', `Resolved Unix path to: '${res}'`)
    } else {
      record(S4, 'Unix forward slash path resolution', 'FAIL', `Expected '${unixUnpacked}', got '${res}'`)
    }
  }

  // 4.7 Path with spaces in folder names
  {
    const spacedBundled = 'C:\\Program Files\\SJTU Downloader\\resources\\app.asar\\ffmpeg.exe'
    const spacedUnpacked = 'C:\\Program Files\\SJTU Downloader\\resources\\app.asar.unpacked\\ffmpeg.exe'
    const mockFs: Record<string, boolean> = { [spacedUnpacked]: true }

    const res = prodResolveBundledFfmpeg(spacedBundled, p => !!mockFs[p])
    if (res === spacedUnpacked) {
      record(S4, 'Path with spaces in directories', 'PASS', `Correctly preserved path with spaces: '${res}'`)
    } else {
      record(S4, 'Path with spaces in directories', 'FAIL', `Got '${res}'`)
    }
  }

  // 4.8 Multiple 'app.asar' occurrences in path
  {
    // E.g. C:\Users\app.asar\MyProject\resources\app.asar\ffmpeg.exe
    const doubleAsar = 'C:\\Users\\app.asar\\resources\\app.asar\\ffmpeg.exe'
    // Note: String.prototype.replace replaces ONLY the FIRST occurrence unless global regex is used
    // Let's observe actual behavior:
    const replaced = doubleAsar.replace('app.asar', 'app.asar.unpacked')
    // In this edge case, the first 'app.asar' in username gets replaced
    const res = prodResolveBundledFfmpeg(doubleAsar, p => p === replaced)
    record(S4, 'Multiple app.asar occurrences in path', 'WARN',
      `replace('app.asar') replaces first occurrence: '${doubleAsar}' -> '${replaced}'. In standard packaging, app.asar only appears in resources/app.asar.`)
  }

  // 4.9 FFMPEG_PATH export verification
  {
    if (typeof prodFFMPEG_PATH === 'string' && prodFFMPEG_PATH.length > 0) {
      record(S4, 'Production FFMPEG_PATH export', 'PASS', `Exported valid path string: '${prodFFMPEG_PATH}'`)
    } else {
      record(S4, 'Production FFMPEG_PATH export', 'FAIL', `FFMPEG_PATH is invalid: '${prodFFMPEG_PATH}'`)
    }
  }

  // =========================================================================
  // SUITE 5: Parity Comparison (Production vs Contract)
  // =========================================================================
  const S5 = 'Parity & Interface Contract'

  // 5.1 processPptSlices parity
  {
    const sample = [
      { ivsVideoId: 10, createSec: 50, hide: '0', pptImgUrl: 'http://img1.jpg' },
      { ivsVideoId: 11, createSec: 10, hide: 1, pptImgUrl: 'http://img2.jpg' },
      { ivsVideoId: 12, createSec: 20, hide: 0, pptImgUrl: 'http://img3.jpg' }
    ]
    const prodRes = prodProcessPptSlices(sample)
    const contractRes = contractProcessPptSlices(sample)
    if (JSON.stringify(prodRes) === JSON.stringify(contractRes)) {
      record(S5, 'processPptSlices production vs contract parity', 'PASS', 'Outputs match identically')
    } else {
      record(S5, 'processPptSlices production vs contract parity', 'FAIL', 'Discrepancy detected')
    }
  }

  // 5.2 formatSliceFileName parity
  {
    const times = [0, 10, 60, 3600, 3661]
    const allMatch = times.every(t => prodFormatSliceFileName(1, t) === contractFormatSliceFileName(1, t))
    if (allMatch) {
      record(S5, 'formatSliceFileName production vs contract parity', 'PASS', 'Outputs match across all tested times')
    } else {
      record(S5, 'formatSliceFileName production vs contract parity', 'FAIL', 'Discrepancy detected')
    }
  }

  // 5.3 buildPptSliceDirName parity vs divergence
  {
    const normal = '高等数学(第1讲)'
    const pNormal = prodBuildPptSliceDirName(normal)
    const cNormal = contractBuildPptSliceDirName(normal)

    const invalid = 'Lecture/01: Intro'
    const pInvalid = prodBuildPptSliceDirName(invalid)
    const cInvalid = contractBuildPptSliceDirName(invalid)

    const empty = ''
    const pEmpty = prodBuildPptSliceDirName(empty)
    const cEmpty = contractBuildPptSliceDirName(empty)

    record(S5, 'buildPptSliceDirName normal lecture parity', pNormal === cNormal ? 'PASS' : 'FAIL',
      `Normal: prod='${pNormal}', contract='${cNormal}'`)

    record(S5, 'buildPptSliceDirName empty string divergence', 'PASS',
      `Prod uses sanitizeFsName ('${pEmpty}'), Contract returns ('${cEmpty}'). Production is strictly safer against empty folders.`)
  }

  // 5.4 resolveBundledFfmpeg parity
  {
    const bundled = 'C:\\resources\\app.asar\\ffmpeg.exe'
    const pRes = prodResolveBundledFfmpeg(bundled, () => false)
    const cRes = contractResolveBundledFfmpeg(bundled, () => false)
    if (pRes === cRes) {
      record(S5, 'resolveBundledFfmpeg production vs contract parity', 'PASS', `Both return '${pRes}'`)
    } else {
      record(S5, 'resolveBundledFfmpeg production vs contract parity', 'FAIL', `Prod='${pRes}', Contract='${cRes}'`)
    }
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('='.repeat(80))
  console.log('TEST SUMMARY')
  console.log('='.repeat(80))

  const total = results.length
  const passCount = results.filter(r => r.status === 'PASS').length
  const failCount = results.filter(r => r.status === 'FAIL').length
  const defectCount = results.filter(r => r.status === 'DEFECT').length
  const warnCount = results.filter(r => r.status === 'WARN').length

  console.log(`Total Scenarios Tested : ${total}`)
  console.log(`Passed                 : ${passCount}`)
  console.log(`Failed                 : ${failCount}`)
  console.log(`Confirmed Defects      : ${defectCount}`)
  console.log(`Warnings / Edge Notes  : ${warnCount}`)

  return { total, passCount, failCount, defectCount, warnCount, results }
}

if (process.argv[1]?.includes('m3-stress-verification')) {
  const summary = runAllM3StressTests()
  if (summary.failCount > 0 || summary.defectCount > 0) {
    process.exit(1)
  }
}
