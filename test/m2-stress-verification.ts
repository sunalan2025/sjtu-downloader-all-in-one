/**
 * M2 Challenger Adversarial Stress Verification Suite (R2-F3, R2-F4)
 * 
 * Standalone empirical test script and oracle harness.
 * Can be executed via:
 *   npx tsx test/m2-stress-verification.ts
 * or
 *   npx vitest run test/m2-stress-verification.ts
 */

import { existsSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  interceptDownloadRedirect,
  isAllowedSjtuUrl,
  SecurityViolationError
} from '../src/main/download-engine/domain-guard'

import {
  verifyDownloadIntegrity,
  assertDownloadIntegrity,
  FileIntegrityError,
  isHtmlExtension
} from '../src/main/download-engine/integrity'

interface TestResult {
  name: string
  category: string
  status: 'PASS' | 'FAIL' | 'DEFECT_CONFIRMED'
  detail: string
}

const results: TestResult[] = []

function logResult(r: TestResult) {
  results.push(r)
  const tag = r.status === 'PASS' ? '✅ PASS' : r.status === 'DEFECT_CONFIRMED' ? '🚨 DEFECT' : '❌ FAIL'
  console.log(`[${tag}] [${r.category}] ${r.name} - ${r.detail}`)
}

export function runAllStressTests() {
  const testDir = join(tmpdir(), `m2_challenger_stress_${Date.now()}`)
  mkdirSync(testDir, { recursive: true })

  try {
    const baseRequestUrl = 'https://oc.sjtu.edu.cn/files/100/download'

    // =========================================================================
    // 1. interceptDownloadRedirect Stress Testing
    // =========================================================================

    // 1.1 Mixed-case login URLs
    {
      const mixedCases = [
        { url: '/Login/Canvas', desc: 'mixed-case /Login/Canvas' },
        { url: '/LOGIN/CANVAS', desc: 'uppercase /LOGIN/CANVAS' },
        { url: '/Login', desc: 'mixed-case /Login' },
        { url: '/LOGIN', desc: 'uppercase /LOGIN' },
        { url: 'https://oc.sjtu.edu.cn/Login/Canvas', desc: 'absolute mixed-case https://oc.sjtu.edu.cn/Login/Canvas' }
      ]

      for (const mc of mixedCases) {
        const res = interceptDownloadRedirect(mc.url, baseRequestUrl)
        if (res.action === 'follow') {
          logResult({
            name: mc.desc,
            category: 'R2-F3: 302 Interception (Mixed-case bypass)',
            status: 'DEFECT_CONFIRMED',
            detail: `Returned action='follow' with nextUrl='${res.nextUrl}', bypassing login interception due to case-sensitive check!`
          })
        } else {
          logResult({
            name: mc.desc,
            category: 'R2-F3: 302 Interception (Mixed-case)',
            status: 'PASS',
            detail: `Correctly aborted: ${res.reason}`
          })
        }
      }

      // Baseline lowercase check
      const baseline = interceptDownloadRedirect('/login/canvas', baseRequestUrl)
      if (baseline.action === 'abort') {
        logResult({
          name: 'lowercase /login/canvas',
          category: 'R2-F3: 302 Interception (Baseline)',
          status: 'PASS',
          detail: `Correctly aborted: ${baseline.reason}`
        })
      } else {
        logResult({
          name: 'lowercase /login/canvas',
          category: 'R2-F3: 302 Interception (Baseline)',
          status: 'FAIL',
          detail: 'Failed to abort lowercase login'
        })
      }
    }

    // 1.2 False Positive Risk on Legitimate Course Files
    {
      const legitimateFileUrl = 'https://s3.jcloud.sjtu.edu.cn/bucket/login.pdf?sign=abc'
      const res = interceptDownloadRedirect(legitimateFileUrl, baseRequestUrl)
      if (res.action === 'abort' && res.reason?.includes('Canvas 会话失效')) {
        logResult({
          name: 'Legitimate course file named login.pdf on S3 (/login.pdf)',
          category: 'R2-F3: 302 Interception (False-positive collision)',
          status: 'DEFECT_CONFIRMED',
          detail: `Legitimate file URL '${legitimateFileUrl}' was erroneously aborted because next.includes('/login') matches any S3 file starting with login (e.g. /login.pdf)!`
        })
      } else if (res.action === 'follow') {
        logResult({
          name: 'Legitimate course file named login.pdf on S3',
          category: 'R2-F3: 302 Interception (False-positive collision)',
          status: 'PASS',
          detail: 'Legitimate file was allowed to follow'
        })
      }
    }

    // 1.3 Tricky Relative vs Absolute URLs
    {
      const relativeTests = [
        {
          header: '/files/200/download',
          expect: 'follow',
          desc: 'valid relative root path /files/200/download'
        },
        {
          header: '../../courses/1/files/2/download',
          expect: 'follow',
          desc: 'relative parent path ../../courses/1/files/2/download'
        },
        {
          header: '//s3.jcloud.sjtu.edu.cn/bucket/obj.pdf',
          expect: 'follow',
          desc: 'protocol-relative URL to S3 //s3.jcloud.sjtu.edu.cn/...'
        },
        {
          header: '//attacker.com/malicious.pdf',
          expect: 'abort',
          desc: 'protocol-relative URL to external domain //attacker.com/...'
        },
        {
          header: 'invalid:port::9999',
          expect: 'abort',
          desc: 'malformed location header'
        }
      ]

      for (const t of relativeTests) {
        const res = interceptDownloadRedirect(t.header, baseRequestUrl)
        if (res.action === t.expect) {
          logResult({
            name: t.desc,
            category: 'R2-F3: Relative/Absolute URL Handling',
            status: 'PASS',
            detail: `action=${res.action} as expected (${res.nextUrl || res.reason})`
          })
        } else {
          logResult({
            name: t.desc,
            category: 'R2-F3: Relative/Absolute URL Handling',
            status: 'FAIL',
            detail: `Expected action=${t.expect}, got action=${res.action}`
          })
        }
      }
    }

    // 1.4 Non-SJTU Phishing and Domain Confusion Attacks
    {
      const phishingTests = [
        { url: 'https://sjtu.edu.cn.attacker.com/fake.pdf', desc: 'Attacker suffix: sjtu.edu.cn.attacker.com' },
        { url: 'https://attacker-sjtu.edu.cn/fake.pdf', desc: 'Attacker hyphen prefix: attacker-sjtu.edu.cn' },
        { url: 'https://sjtu.edu.cn@attacker.com/fake.pdf', desc: 'Userinfo injection: https://sjtu.edu.cn@attacker.com' },
        { url: 'https://attacker.com#oc.sjtu.edu.cn', desc: 'Hash injection: https://attacker.com#oc.sjtu.edu.cn' },
        { url: 'https://attacker.com/?url=https://oc.sjtu.edu.cn', desc: 'Query spoofing: https://attacker.com/?url=...' },
        { url: 'https://fake-sjtu.cn/file.pdf', desc: 'Fake sjtu.cn domain: fake-sjtu.cn' },
        { url: 'http://oc.sjtu.edu.cn/files/100', desc: 'Plain HTTP on production domain' }
      ]

      for (const pt of phishingTests) {
        const res = interceptDownloadRedirect(pt.url, baseRequestUrl)
        if (res.action === 'abort') {
          logResult({
            name: pt.desc,
            category: 'R5-F1: Phishing Domain Isolation',
            status: 'PASS',
            detail: `Successfully aborted: ${res.reason}`
          })
        } else {
          logResult({
            name: pt.desc,
            category: 'R5-F1: Phishing Domain Isolation',
            status: 'DEFECT_CONFIRMED',
            detail: `Phishing domain was NOT aborted! action=${res.action}, nextUrl=${res.nextUrl}`
          })
        }
      }
    }

    // =========================================================================
    // 2. verifyDownloadIntegrity & assertDownloadIntegrity Stress Testing
    // =========================================================================

    // 2.1 File Size Boundaries (0-byte, 1-byte, exact minBytes)
    {
      // 0-byte file
      const pZero = join(testDir, 'zero_byte.bin')
      writeFileSync(pZero, Buffer.alloc(0))
      const resZero = verifyDownloadIntegrity(pZero)
      if (!resZero.valid && resZero.error?.includes('文件大小为 0 字节')) {
        logResult({
          name: '0-byte file rejection',
          category: 'R2-F4: File Size Validation',
          status: 'PASS',
          detail: `Correctly rejected: ${resZero.error}`
        })
      } else {
        logResult({
          name: '0-byte file rejection',
          category: 'R2-F4: File Size Validation',
          status: 'FAIL',
          detail: `0-byte file was not properly rejected: ${JSON.stringify(resZero)}`
        })
      }

      // 1-byte binary file
      const pOne = join(testDir, 'one_byte.bin')
      writeFileSync(pOne, Buffer.from([0x00]))
      const resOne = verifyDownloadIntegrity(pOne, 1)
      if (resOne.valid) {
        logResult({
          name: '1-byte binary file acceptance',
          category: 'R2-F4: File Size Validation',
          status: 'PASS',
          detail: '1-byte binary file accepted'
        })
      } else {
        logResult({
          name: '1-byte binary file acceptance',
          category: 'R2-F4: File Size Validation',
          status: 'FAIL',
          detail: `1-byte file rejected: ${resOne.error}`
        })
      }

      // Exact minBytes boundary
      const pExact = join(testDir, 'exact_boundary.bin')
      writeFileSync(pExact, Buffer.alloc(100, 0x41))
      const resExact = verifyDownloadIntegrity(pExact, 100)
      const resSub = verifyDownloadIntegrity(pExact, 101)
      const resSuper = verifyDownloadIntegrity(pExact, 99)

      if (resExact.valid && !resSub.valid && resSuper.valid) {
        logResult({
          name: 'Exact minBytes boundary (size=100 vs minBytes=99,100,101)',
          category: 'R2-F4: File Size Validation',
          status: 'PASS',
          detail: 'Boundary conditions strictly satisfied'
        })
      } else {
        logResult({
          name: 'Exact minBytes boundary',
          category: 'R2-F4: File Size Validation',
          status: 'FAIL',
          detail: `Boundary failure: exact=${resExact.valid}, sub=${resSub.valid}, super=${resSuper.valid}`
        })
      }

      // Non-existent file
      const pNone = join(testDir, 'non_existent.bin')
      const resNone = verifyDownloadIntegrity(pNone)
      if (!resNone.valid && resNone.error === '文件不存在') {
        logResult({
          name: 'Non-existent file handling',
          category: 'R2-F4: Non-existent File',
          status: 'PASS',
          detail: 'Correctly returned valid: false, error: 文件不存在'
        })
      } else {
        logResult({
          name: 'Non-existent file handling',
          category: 'R2-F4: Non-existent File',
          status: 'FAIL',
          detail: `Unexpected result: ${JSON.stringify(resNone)}`
        })
      }
    }

    // 2.2 HTML Sniffing Variants & Edge Cases
    {
      const htmlVariants = [
        {
          name: 'Standard lowercase <!doctype html>',
          content: '<!doctype html><html><body>Login</body></html>',
          expected: false
        },
        {
          name: 'Uppercase <!DOCTYPE HTML>',
          content: '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">',
          expected: false
        },
        {
          name: 'Leading whitespace and newlines before <!DOCTYPE html>',
          content: '   \r\n\t\n   <!DOCTYPE html><html><body>Login</body></html>',
          expected: false
        },
        {
          name: 'HTML starting with <html lang="zh-CN"> (no doctype)',
          content: '  <html lang="zh-CN"><head><title>Login</title></head></html>',
          expected: false
        },
        {
          name: 'HTML starting with uppercase <HTML>',
          content: '<HTML><BODY>Login</BODY></HTML>',
          expected: false
        },
        {
          name: 'HTML preceded by >512 bytes of spaces/padding',
          content: ' '.repeat(600) + '<!DOCTYPE html><html><body>Login</body></html>',
          expected: false // Sniff buffer boundary vulnerability!
        },
        {
          name: 'HTML starting with comment <!-- Canvas Session Notice -->',
          content: '<!-- Canvas LMS Session Notice -->\n<!DOCTYPE html><html><body>Login</body></html>',
          expected: false // Comment-first bypass vulnerability!
        }
      ]

      for (const hv of htmlVariants) {
        const pHtml = join(testDir, `html_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.pdf`)
        writeFileSync(pHtml, hv.content)
        const check = verifyDownloadIntegrity(pHtml)
        if (check.valid === hv.expected) {
          logResult({
            name: hv.name,
            category: 'R2-F4: HTML Sniffing Detection',
            status: 'PASS',
            detail: `Detected as invalid: ${check.error}`
          })
        } else {
          logResult({
            name: hv.name,
            category: 'R2-F4: HTML Sniffing Detection',
            status: 'DEFECT_CONFIRMED',
            detail: `HTML disguised payload bypassed integrity check! valid=${check.valid}`
          })
        }
      }
    }

    // 2.3 Binary Magic Bytes Preservation
    {
      const binaryPayloads = [
        { name: 'PDF (%PDF-1.7)', data: Buffer.from('%PDF-1.7\n%stream') },
        { name: 'ZIP / DOCX / PPTX (PK..)', data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]) },
        { name: 'PNG (‰PNG...)', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
        { name: 'MP4 (ftyp)', data: Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]) },
        { name: 'Plain text notes', data: Buffer.from('Course lecture notes for Chapter 1') }
      ]

      for (const bp of binaryPayloads) {
        const pBin = join(testDir, `bin_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.dat`)
        writeFileSync(pBin, bp.data)
        const check = verifyDownloadIntegrity(pBin)
        if (check.valid) {
          logResult({
            name: `Binary magic bytes: ${bp.name}`,
            category: 'R2-F4: Magic Bytes Legitimate Files',
            status: 'PASS',
            detail: 'Valid binary accepted without false positive'
          })
        } else {
          logResult({
            name: `Binary magic bytes: ${bp.name}`,
            category: 'R2-F4: Magic Bytes Legitimate Files',
            status: 'FAIL',
            detail: `Legitimate binary was falsely rejected: ${check.error}`
          })
        }
      }
    }

    // 2.4 File Descriptor Leak on Windows (EBUSY test)
    {
      const pLock = join(testDir, 'lock_test.bin')
      writeFileSync(pLock, Buffer.from('%PDF-1.4 test'))
      verifyDownloadIntegrity(pLock)
      try {
        unlinkSync(pLock)
        logResult({
          name: 'File descriptor cleanup (Windows unlinkSync without EBUSY)',
          category: 'R2-F4: Resource Management',
          status: 'PASS',
          detail: 'File descriptor was safely closed in finally block'
        })
      } catch (e: any) {
        logResult({
          name: 'File descriptor cleanup',
          category: 'R2-F4: Resource Management',
          status: 'FAIL',
          detail: `File handle leaked, unlinkSync failed: ${e.message}`
        })
      }
    }

  } finally {
    try {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
    } catch {}
  }

  // Summary
  console.log('\n================ STRESS TEST SUMMARY ================')
  const total = results.length
  const passed = results.filter(r => r.status === 'PASS').length
  const defects = results.filter(r => r.status === 'DEFECT_CONFIRMED').length
  const failed = results.filter(r => r.status === 'FAIL').length
  console.log(`Total Scenarios Tested: ${total}`)
  console.log(`Passed: ${passed}`)
  console.log(`Defects Confirmed: ${defects}`)
  console.log(`Failed / Regressions: ${failed}`)
  console.log('=====================================================\n')

  return { total, passed, defects, failed, results }
}

if (process.argv[1]?.includes('m2-stress-verification')) {
  runAllStressTests()
}
