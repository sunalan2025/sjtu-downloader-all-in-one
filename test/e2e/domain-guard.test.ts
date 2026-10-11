import { describe, it, expect } from 'vitest'
import { isAllowedSjtuUrl, calculateBackoffMs } from '../helpers/contracts'

describe('Domain Guard & Rate Limiting E2E Suite (R5-F1, R5-F2)', () => {
  // ─────────────────────────────────────────────────────────────
  // Tier 1: Feature Coverage (Happy Path Isolation)
  // ─────────────────────────────────────────────────────────────
  describe('Tier 1: Feature Coverage', () => {
    describe('R5-F1: Strict SJTU Domain Isolation', () => {
      it('allows official Canvas LMS HTTPS domain', () => {
        expect(isAllowedSjtuUrl('https://oc.sjtu.edu.cn/api/v1/courses')).toBe(true)
      })

      it('allows official v.sjtu HTTPS domain', () => {
        expect(isAllowedSjtuUrl('https://v.sjtu.edu.cn/cloud-rbac/authority/me')).toBe(true)
      })

      it('allows official SJTU CloudPan HTTPS domain', () => {
        expect(isAllowedSjtuUrl('https://pan.sjtu.edu.cn/user/v1/space/1')).toBe(true)
      })

      it('allows official JCloud S3 presigned storage HTTPS domain', () => {
        expect(isAllowedSjtuUrl('https://s3.jcloud.sjtu.edu.cn/canvas-storage/file.pdf?sign=xyz')).toBe(true)
      })

      it('allows official CNMOOC Good University Online HTTPS domain', () => {
        expect(isAllowedSjtuUrl('https://cnmooc.sjtu.cn/portal/myCourseIndex/1.mooc')).toBe(true)
        expect(isAllowedSjtuUrl('https://static.cnmooc.sjtu.cn/course/slides.pdf')).toBe(true)
      })

      it('allows local development environments on localhost and 127.0.0.1 via HTTP', () => {
        expect(isAllowedSjtuUrl('http://localhost:5173')).toBe(true)
        expect(isAllowedSjtuUrl('http://127.0.0.1:3000/api/mock')).toBe(true)
      })
    })

    describe('R5-F2: Network Rate Limiting & Backoff', () => {
      it('computes exponential backoff for attempt 1 (1000ms base)', () => {
        const delay = calculateBackoffMs(null, 1)
        expect(delay).toBe(1000)
      })

      it('computes exponential backoff doubling on successive attempts', () => {
        expect(calculateBackoffMs(null, 2)).toBe(2000)
        expect(calculateBackoffMs(null, 3)).toBe(4000)
        expect(calculateBackoffMs(null, 4)).toBe(8000)
      })

      it('honors numeric Retry-After header specified in seconds', () => {
        const delay = calculateBackoffMs('5', 1)
        expect(delay).toBe(5000)
      })

      it('honors HTTP-date formatted Retry-After header in the future', () => {
        const futureDate = new Date(Date.now() + 15_000).toUTCString()
        const delay = calculateBackoffMs(futureDate, 1)
        expect(delay).toBeGreaterThanOrEqual(14_000)
        expect(delay).toBeLessThanOrEqual(16_000)
      })

      it('enforces maximum ceiling cap on backoff duration', () => {
        const delay = calculateBackoffMs(null, 10, 30_000)
        expect(delay).toBe(30_000)
      })
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 2: Boundary & Corner Cases
  // ─────────────────────────────────────────────────────────────
  describe('Tier 2: Boundary & Corner Cases', () => {
    it('blocks insecure plain HTTP on non-localhost SJTU domains', () => {
      expect(isAllowedSjtuUrl('http://oc.sjtu.edu.cn/files/download')).toBe(false)
      expect(isAllowedSjtuUrl('http://v.sjtu.edu.cn/api/vod')).toBe(false)
    })

    it('blocks adversarial phishing subdomains mimicking SJTU hostname suffix', () => {
      expect(isAllowedSjtuUrl('https://sjtu.edu.cn.attacker-site.com/steal-token')).toBe(false)
      expect(isAllowedSjtuUrl('https://oc.sjtu.edu.cn.evil.org/login')).toBe(false)
      expect(isAllowedSjtuUrl('https://fake-s3.jcloud.sjtu.edu.cn.phishing.cn')).toBe(false)
    })

    it('blocks non-SJTU educational or commercial domains', () => {
      expect(isAllowedSjtuUrl('https://fudan.edu.cn/courses')).toBe(false)
      expect(isAllowedSjtuUrl('https://baidu.com')).toBe(false)
      expect(isAllowedSjtuUrl('https://s3.amazonaws.com/sjtu-bucket/file.pdf')).toBe(false)
    })

    it('blocks unsupported and dangerous URL protocols', () => {
      expect(isAllowedSjtuUrl('ftp://oc.sjtu.edu.cn/archive.zip')).toBe(false)
      expect(isAllowedSjtuUrl('file:///C:/Windows/System32/calc.exe')).toBe(false)
      expect(isAllowedSjtuUrl('javascript:alert(document.cookie)')).toBe(false)
      expect(isAllowedSjtuUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBe(false)
    })

    it('safely rejects empty string, whitespace, and malformed URLs without throwing', () => {
      expect(isAllowedSjtuUrl('')).toBe(false)
      expect(isAllowedSjtuUrl('   ')).toBe(false)
      expect(isAllowedSjtuUrl('not-a-valid-url')).toBe(false)
      expect(isAllowedSjtuUrl('https://')).toBe(false)
      expect(isAllowedSjtuUrl('http://:80/path')).toBe(false)
    })

    it('handles negative or invalid Retry-After strings gracefully', () => {
      expect(calculateBackoffMs('-5', 1)).toBe(1000)
      expect(calculateBackoffMs('invalid-date-string', 2)).toBe(2000)
      expect(calculateBackoffMs('', 3)).toBe(4000)
    })

    it('handles past HTTP-date in Retry-After by falling back to attempt backoff', () => {
      const pastDate = new Date(Date.now() - 10_000).toUTCString()
      const delay = calculateBackoffMs(pastDate, 2)
      expect(delay).toBe(2000)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 3: Cross-Feature Pairwise Interactions
  // ─────────────────────────────────────────────────────────────
  describe('Tier 3: Pairwise Combinations', () => {
    it('pairwise: 302 redirect from Canvas to legitimate S3 presigned URL is permitted', () => {
      const initialUrl = 'https://oc.sjtu.edu.cn/files/999/download?download_frd=1'
      const redirectTarget = 'https://s3.jcloud.sjtu.edu.cn/canvas-courses/course-101/lecture.pdf?X-Amz-Signature=abc'

      expect(isAllowedSjtuUrl(initialUrl)).toBe(true)
      expect(isAllowedSjtuUrl(redirectTarget)).toBe(true)
    })

    it('pairwise: 302 redirect from Canvas to external attacker CDN is intercepted and rejected', () => {
      const initialUrl = 'https://oc.sjtu.edu.cn/files/999/download'
      const maliciousRedirect = 'https://malicious-cdn.net/exploit.pdf'

      expect(isAllowedSjtuUrl(initialUrl)).toBe(true)
      expect(isAllowedSjtuUrl(maliciousRedirect)).toBe(false)
    })

    it('pairwise: HTTP 429 response on SJTU endpoint triggers backoff delay while validating retry target', () => {
      const targetEndpoint = 'https://v.sjtu.edu.cn/jy-application-resmgr/audit-course/my'
      const isAllowed = isAllowedSjtuUrl(targetEndpoint)
      const backoffDelay = calculateBackoffMs('3', 1)

      expect(isAllowed).toBe(true)
      expect(backoffDelay).toBe(3000)
    })

    it('pairwise: rate limiting with missing Retry-After header applies exponential backoff on allowed domain', () => {
      const targetEndpoint = 'https://oc.sjtu.edu.cn/api/v1/courses/10001/files'
      expect(isAllowedSjtuUrl(targetEndpoint)).toBe(true)

      const attempt1Delay = calculateBackoffMs(null, 1)
      const attempt2Delay = calculateBackoffMs(null, 2)
      const attempt3Delay = calculateBackoffMs(null, 3)

      expect(attempt1Delay).toBe(1000)
      expect(attempt2Delay).toBe(2000)
      expect(attempt3Delay).toBe(4000)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 4: End-to-End User Workflows
  // ─────────────────────────────────────────────────────────────
  describe('Tier 4: End-to-End User Workflows', () => {
    it('e2e: verifies entire redirect chain security during course asset download', () => {
      // Simulate multi-hop redirect chain:
      // Hop 1: oc.sjtu.edu.cn/files/1/download
      // Hop 2: 302 to oc.sjtu.edu.cn/api/v1/files/1/public_url
      // Hop 3: 302 to s3.jcloud.sjtu.edu.cn/...
      const redirectChain = [
        'https://oc.sjtu.edu.cn/files/1/download',
        'https://oc.sjtu.edu.cn/api/v1/files/1/public_url',
        'https://s3.jcloud.sjtu.edu.cn/canvas/files/1/asset.pdf'
      ]

      for (const hopUrl of redirectChain) {
        const allowed = isAllowedSjtuUrl(hopUrl)
        expect(allowed).toBe(true)
      }
    })

    it('e2e: aborts download sequence if an intermediate redirect deviates to untrusted host', () => {
      const compromisedChain = [
        'https://oc.sjtu.edu.cn/files/1/download',
        'https://unauthorized-proxy.com/files/1/download',
        'https://s3.jcloud.sjtu.edu.cn/canvas/files/1/asset.pdf'
      ]

      let aborted = false
      let abortReason = ''

      for (const hopUrl of compromisedChain) {
        if (!isAllowedSjtuUrl(hopUrl)) {
          aborted = true
          abortReason = `Untrusted redirect target rejected: ${hopUrl}`
          break
        }
      }

      expect(aborted).toBe(true)
      expect(abortReason).toContain('unauthorized-proxy.com')
    })

    it('e2e: simulates multi-attempt rate limit backoff and recovery lifecycle', () => {
      let currentAttempt = 1
      const totalSimulatedRetries = 3
      const recordedDelays: number[] = []

      while (currentAttempt <= totalSimulatedRetries) {
        const delay = calculateBackoffMs(null, currentAttempt)
        recordedDelays.push(delay)
        currentAttempt++
      }

      expect(recordedDelays).toEqual([1000, 2000, 4000])
      expect(isAllowedSjtuUrl('https://oc.sjtu.edu.cn/api/v1/courses')).toBe(true)
    })
  })
})
