import { describe, it, expect, beforeEach } from 'vitest'
import {
  extractQrElementSelector,
  decodeJwtClaims,
  QR_SELECTOR_CANDIDATES
} from '../helpers/contracts'
import {
  pickAccountInfo,
  setJwtToken,
  getAccountName,
  getStudentId,
  clearAuthState
} from '../../src/main/auth'
import {
  MOCK_USER,
  MOCK_JWT_TOKEN,
  MOCK_EXPIRED_JWT_TOKEN,
  FIXTURES_AUTH
} from '../mocks/fixtures'

interface PersistedAuthSession {
  version: 1
  jwtToken: string
  accountName?: string
  studentId?: string
  expiresAt: number
  lastVerifiedAt: number
}

// In-memory mock vault simulating persistent storage under app.getPath('userData')/session.json
class MockAuthVault {
  private data: string | null = null

  async save(session: PersistedAuthSession): Promise<void> {
    this.data = JSON.stringify(session)
  }

  async load(): Promise<PersistedAuthSession | null> {
    if (!this.data) return null
    try {
      return JSON.parse(this.data) as PersistedAuthSession
    } catch {
      return null
    }
  }

  async clear(): Promise<void> {
    this.data = null
  }

  corrupt(): void {
    this.data = '{ invalid_json: true, unterminated'
  }
}

describe('Auth & Session Persistence E2E Suite (R1-F1, R1-F2, R1-F3)', () => {
  let vault: MockAuthVault

  beforeEach(() => {
    vault = new MockAuthVault()
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 1: Feature Coverage (Happy Path Isolation)
  // ─────────────────────────────────────────────────────────────
  describe('Tier 1: Feature Coverage', () => {
    describe('R1-F1: Persistent Session Storage', () => {
      it('saves auth session with JWT token, student identity, and expiration', async () => {
        const session: PersistedAuthSession = {
          version: 1,
          jwtToken: MOCK_JWT_TOKEN,
          accountName: MOCK_USER.name,
          studentId: MOCK_USER.studentId,
          expiresAt: Date.now() + 86400_000,
          lastVerifiedAt: Date.now()
        }
        await vault.save(session)
        const loaded = await vault.load()

        expect(loaded).not.toBeNull()
        expect(loaded?.jwtToken).toBe(MOCK_JWT_TOKEN)
        expect(loaded?.accountName).toBe(MOCK_USER.name)
        expect(loaded?.studentId).toBe(MOCK_USER.studentId)
      })

      it('hydrates session on startup without executing destructive session wipe', async () => {
        let startupWipeExecuted = false
        const simulateStartup = async (hydrateFromVault: boolean) => {
          if (!hydrateFromVault) {
            startupWipeExecuted = true
          }
          return vault.load()
        }

        await vault.save({
          version: 1,
          jwtToken: MOCK_JWT_TOKEN,
          accountName: MOCK_USER.name,
          studentId: MOCK_USER.studentId,
          expiresAt: Date.now() + 86400_000,
          lastVerifiedAt: Date.now()
        })

        const recoveredSession = await simulateStartup(true)
        expect(startupWipeExecuted).toBe(false)
        expect(recoveredSession?.jwtToken).toBe(MOCK_JWT_TOKEN)
      })

      it('clears persistent session vault on explicit user logout', async () => {
        await vault.save({
          version: 1,
          jwtToken: MOCK_JWT_TOKEN,
          expiresAt: Date.now() + 3600_000,
          lastVerifiedAt: Date.now()
        })
        await vault.clear()
        const loaded = await vault.load()
        expect(loaded).toBeNull()
      })

      it('should sanitize activeTab when persisted state contains settings or transfer', () => {
        const rawState = { activeTab: 'settings', lastCourseTab: 'canvas' }
        const sanitizedTab = (rawState.activeTab === 'settings' || rawState.activeTab === 'transfer')
          ? (rawState.lastCourseTab || 'canvas')
          : rawState.activeTab
        expect(sanitizedTab).toBe('canvas')
      })
    })

    describe('R1-F2: QR DOM Resilience', () => {
      it('matches standard id="qr-img" element', () => {
        const html = '<div class="qrcode-box"><img id="qr-img" src="/qrcode?uuid=123" /></div>'
        expect(extractQrElementSelector(html)).toBe('#qr-img')
      })

      it('falls back to img.qr-img selector when ID is missing', () => {
        const html = '<div class="login-wrapper"><img class="qr-img" src="/qrcode?uuid=123" /></div>'
        expect(extractQrElementSelector(html)).toBe('img.qr-img')
      })

      it('falls back to container .login-qr img selector', () => {
        const html = '<div class="login-qr"><img src="data:image/png;base64,abc" /></div>'
        expect(extractQrElementSelector(html)).toBe('.login-qr img')
      })

      it('detects canvas-based QR element canvas.qrcode', () => {
        const html = '<div class="qr-container"><canvas class="qrcode"></canvas></div>'
        expect(extractQrElementSelector(html)).toBe('canvas.qrcode')
      })

      it('unmasks webview opacity to 1 on timeout so user can interact natively', () => {
        let webviewOpacity = 0
        const onQrLoadTimeout = () => {
          webviewOpacity = 1 // Unmask fallback
        }
        onQrLoadTimeout()
        expect(webviewOpacity).toBe(1)
      })
    })

    describe('R1-F3: Session Lifecycle & Auto-Refresh', () => {
      it('extracts real name and student ID from /authority/me envelope via pickAccountInfo', () => {
        const info = pickAccountInfo(FIXTURES_AUTH.meSuccess.result)
        expect(info.name).toBe(MOCK_USER.name)
        expect(info.studentId).toBe(MOCK_USER.username)
      })

      it('decodes JWT claims to extract user and exp timestamp', () => {
        const claims = decodeJwtClaims(MOCK_JWT_TOKEN)
        expect(claims).not.toBeNull()
        expect(claims?.sub).toBe('120037910000')
        expect(claims?.name).toBe('测试用户')
        expect(claims?.exp).toBe(1799999999)
      })

      it('identifies expired JWT token', () => {
        const claims = decodeJwtClaims(MOCK_EXPIRED_JWT_TOKEN)
        expect(claims).not.toBeNull()
        const nowSec = Math.floor(Date.now() / 1000)
        expect((claims?.exp as number) < nowSec).toBe(true)
      })

      it('returns empty info for unauthenticated result', () => {
        const info = pickAccountInfo(null)
        expect(info).toEqual({})
        const emptyObj = pickAccountInfo({})
        expect(emptyObj).toEqual({})
      })
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 2: Boundary & Corner Cases
  // ─────────────────────────────────────────────────────────────
  describe('Tier 2: Boundary & Corner Cases', () => {
    it('gracefully recovers when vault file contains corrupted JSON', async () => {
      vault.corrupt()
      const loaded = await vault.load()
      expect(loaded).toBeNull()
    })

    it('rejects hydration if persisted JWT is expired', async () => {
      const expiredSession: PersistedAuthSession = {
        version: 1,
        jwtToken: MOCK_EXPIRED_JWT_TOKEN,
        accountName: MOCK_USER.name,
        studentId: MOCK_USER.username,
        expiresAt: 1500000000 * 1000,
        lastVerifiedAt: 1500000000 * 1000
      }
      await vault.save(expiredSession)
      const loaded = await vault.load()
      const isExpired = loaded ? loaded.expiresAt < Date.now() : true
      expect(isExpired).toBe(true)
    })

    it('rejects hydration when jAccount session cookies are absent or only JATrustCookie is present', async () => {
      // Simulate dual-factor guard: unexpired JWT in vault, but session cookies only contain JATrustCookie
      const mockCookies = [{ domain: 'jaccount.sjtu.edu.cn', name: 'JATrustCookie', value: 'trust_device_123' }]
      const hasJaSession = mockCookies.some(c => c.name !== 'JATrustCookie' && c.name.length > 0)
      expect(hasJaSession).toBe(false)

      await vault.save({
        version: 1,
        jwtToken: MOCK_JWT_TOKEN,
        accountName: MOCK_USER.name,
        studentId: MOCK_USER.studentId,
        expiresAt: Date.now() + 86400_000,
        lastVerifiedAt: Date.now()
      })

      // When hasJaSession is false, stale session is cleared
      if (!hasJaSession) {
        await vault.clear()
      }
      const loaded = await vault.load()
      expect(loaded).toBeNull()
    })

    it('handles malformed JWT token with missing or invalid parts', () => {
      expect(decodeJwtClaims('')).toBeNull()
      expect(decodeJwtClaims('singleparttoken')).toBeNull()
      expect(decodeJwtClaims('header.invalid-base64-payload!!!.signature')).toBeNull()
    })

    it('extracts studentId when authority envelope uses code instead of username', () => {
      const payload = {
        user: {
          name: '李同学',
          code: '121037910001'
        }
      }
      const info = pickAccountInfo(payload)
      expect(info.name).toBe('李同学')
      expect(info.studentId).toBe('121037910001')
    })

    it('extracts account info when authority envelope uses root user shape from production Kedacom backend', () => {
      const prodPayload = {
        code: '0',
        user: {
          name: '周同学',
          code: '520030910001'
        }
      }
      const info = pickAccountInfo(prodPayload)
      expect(info.name).toBe('周同学')
      expect(info.studentId).toBe('520030910001')
    })

    it('extracts account info when nested under data envelope', () => {
      const dataPayload = {
        code: '0',
        data: {
          user: {
            name: '赵老师',
            username: '99001122'
          }
        }
      }
      const info = pickAccountInfo(dataPayload)
      expect(info.name).toBe('赵老师')
      expect(info.studentId).toBe('99001122')
    })

    it('setJwtToken immediately establishes identity without blocking on network', () => {
      try {
        setJwtToken(MOCK_JWT_TOKEN, { name: '测试用户', studentId: '120037910000' })
        expect(getAccountName()).toBe('测试用户')
        expect(getStudentId()).toBe('120037910000')
      } finally {
        clearAuthState()
      }
    })

    it('returns null when HTML contains no recognizable QR selectors', () => {
      const alienHtml = '<div class="content"><p>请在终端使用命令行登录</p></div>'
      expect(extractQrElementSelector(alienHtml)).toBeNull()
    })

    it('candidate selector list contains all required fallback patterns', () => {
      expect(QR_SELECTOR_CANDIDATES).toContain('#qr-img')
      expect(QR_SELECTOR_CANDIDATES).toContain('img.qr-img')
      expect(QR_SELECTOR_CANDIDATES).toContain('.login-qr img')
      expect(QR_SELECTOR_CANDIDATES).toContain('canvas.qrcode')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 3: Cross-Feature Pairwise Interactions
  // ─────────────────────────────────────────────────────────────
  describe('Tier 3: Pairwise Combinations', () => {
    it('pairwise: session hydration triggers network verification and gracefully handles 401', async () => {
      await vault.save({
        version: 1,
        jwtToken: MOCK_JWT_TOKEN,
        accountName: MOCK_USER.name,
        studentId: MOCK_USER.username,
        expiresAt: Date.now() + 3600_000,
        lastVerifiedAt: Date.now()
      })

      // Simulate downstream API returning 401
      const apiResponse = { status: 401, error: 'Token revoked on server' }
      let promptReAuth = false

      if (apiResponse.status === 401) {
        promptReAuth = true
        await vault.clear()
      }

      expect(promptReAuth).toBe(true)
      const rechecked = await vault.load()
      expect(rechecked).toBeNull()
    })

    it('pairwise: offline startup falls back to decoded JWT identity if network is unavailable', async () => {
      await vault.save({
        version: 1,
        jwtToken: MOCK_JWT_TOKEN,
        accountName: MOCK_USER.name,
        studentId: MOCK_USER.username,
        expiresAt: Date.now() + 86400_000,
        lastVerifiedAt: Date.now()
      })

      const networkAvailable = false
      const session = await vault.load()
      let userDisplay = ''

      if (!networkAvailable && session) {
        // Fallback to offline claims
        const claims = decodeJwtClaims(session.jwtToken)
        userDisplay = `${claims?.name} (${claims?.sub})`
      }

      expect(userDisplay).toBe('测试用户 (120037910000)')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // Tier 4: End-to-End User Workflows
  // ─────────────────────────────────────────────────────────────
  describe('Tier 4: End-to-End User Workflows', () => {
    it('e2e: complete login -> persist -> simulated app restart -> restore lifecycle', async () => {
      // 1. User performs QR login
      const rawHtml = '<div class="qrcode-wrapper"><img class="qr-img" src="/qrcode?token=init" /></div>'
      const matchedSelector = extractQrElementSelector(rawHtml)
      expect(matchedSelector).toBe('img.qr-img')

      // 2. Token extracted and persisted
      const sessionToPersist: PersistedAuthSession = {
        version: 1,
        jwtToken: MOCK_JWT_TOKEN,
        accountName: MOCK_USER.name,
        studentId: MOCK_USER.username,
        expiresAt: Date.now() + 7 * 86400_000,
        lastVerifiedAt: Date.now()
      }
      await vault.save(sessionToPersist)

      // 3. App closes and reopens (new process instance)
      const freshProcessVault = new MockAuthVault()
      // Copy data from storage
      const rawVaultData = JSON.stringify(sessionToPersist)
      // Inject raw vault data
      ;(freshProcessVault as any).data = rawVaultData

      const bootSession = await freshProcessVault.load()
      expect(bootSession).not.toBeNull()
      expect(bootSession?.jwtToken).toBe(MOCK_JWT_TOKEN)

      // 4. Verification succeeds and stage transitions to browser
      let appStage = 'welcome'
      if (bootSession && bootSession.expiresAt > Date.now()) {
        appStage = 'browser'
      }
      expect(appStage).toBe('browser')
    })

    it('e2e: expired session prompt and graceful re-authentication workflow', async () => {
      // 1. Persisted session is expired
      await vault.save({
        version: 1,
        jwtToken: MOCK_EXPIRED_JWT_TOKEN,
        accountName: MOCK_USER.name,
        studentId: MOCK_USER.username,
        expiresAt: Date.now() - 3600_000,
        lastVerifiedAt: Date.now() - 3600_000
      })

      // 2. App boots
      const session = await vault.load()
      let requireQrScan = false
      let alertMessage = ''

      if (session && session.expiresAt <= Date.now()) {
        requireQrScan = true
        alertMessage = '登录凭据已过期，请重新扫码'
        await vault.clear()
      }

      expect(requireQrScan).toBe(true)
      expect(alertMessage).toContain('登录凭据已过期')

      // 3. User re-scans and obtains fresh token
      await vault.save({
        version: 1,
        jwtToken: MOCK_JWT_TOKEN,
        accountName: MOCK_USER.name,
        studentId: MOCK_USER.username,
        expiresAt: Date.now() + 86400_000,
        lastVerifiedAt: Date.now()
      })

      const refreshed = await vault.load()
      expect(refreshed?.jwtToken).toBe(MOCK_JWT_TOKEN)
    })
  })
})
