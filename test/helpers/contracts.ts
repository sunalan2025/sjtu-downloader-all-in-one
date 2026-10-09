/**
 * Reference interface contracts and helper implementations derived from PROJECT.md § Interface Contracts.
 * Used for contract verification and opaque-box assertions across Tiers 1-4.
 */

import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs'

/**
 * Interface Contract 1: Domain Guard
 * Returns true if URL protocol is valid and hostname matches official SJTU domains.
 */
export function isAllowedSjtuUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr)
    const host = u.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1') {
      return u.protocol === 'http:' || u.protocol === 'https:'
    }
    if (u.protocol !== 'https:') return false
    if (host === 's3.jcloud.sjtu.edu.cn') return true
    if (host === 'sjtu.edu.cn' || host.endsWith('.sjtu.edu.cn')) return true
    if (host === 'sjtu.cn' || host.endsWith('.sjtu.cn')) return true
    return false
  } catch {
    return false
  }
}

/**
 * Interface Contract 2: Download File Integrity Guard
 * Verifies non-empty and checks that binary files do not start with HTML markup.
 */
export interface FileIntegrityResult {
  valid: boolean
  error?: string
}

export function verifyDownloadIntegrity(
  filePath: string,
  minBytes = 1,
  allowHtml = false
): FileIntegrityResult {
  if (!existsSync(filePath)) {
    return { valid: false, error: '文件不存在' }
  }
  const stat = statSync(filePath)
  if (stat.size < minBytes) {
    return { valid: false, error: `文件大小为 ${stat.size} 字节，小于最小要求 ${minBytes} 字节` }
  }
  if (!allowHtml) {
    const fd = openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(Math.min(512, stat.size))
      readSync(fd, buf, 0, buf.length, 0)
      const head = buf.toString('utf8').trim().toLowerCase()
      if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
        return { valid: false, error: '文件内容为 HTML 网页（疑似未认证重定向至登录页），非有效课件二进制' }
      }
    } finally {
      closeSync(fd)
    }
  }
  return { valid: true }
}

/**
 * Interface Contract 3: 429 Exponential Backoff with Retry-After
 */
export function calculateBackoffMs(retryAfter?: string | null, attempt = 1, maxDelayMs = 60_000): number {
  if (retryAfter) {
    const parsedSec = Number.parseInt(retryAfter, 10)
    if (Number.isFinite(parsedSec) && parsedSec >= 0) {
      return Math.min(parsedSec * 1000, maxDelayMs)
    }
    const httpDate = Date.parse(retryAfter)
    if (!Number.isNaN(httpDate)) {
      const diff = httpDate - Date.now()
      if (diff > 0) return Math.min(diff, maxDelayMs)
    }
  }
  const expDelay = 1000 * Math.pow(2, Math.max(0, attempt - 1))
  return Math.min(expDelay, maxDelayMs)
}

/**
 * Interface Contract 4: Multi-Selector QR Code Matcher
 */
export const QR_SELECTOR_CANDIDATES = [
  '#qr-img',
  'img.qr-img',
  'img.qrcode',
  '.login-qr img',
  '#qrcode img',
  'canvas.qrcode',
  '#qr-canvas',
  'img[src*="qrcode"]'
]

export function extractQrElementSelector(html: string): string | null {
  if (html.includes('id="qr-img"')) return '#qr-img'
  if (html.includes('class="qr-img"')) return 'img.qr-img'
  if (html.includes('<canvas') && html.includes('qrcode')) return 'canvas.qrcode'
  if (html.includes('<img') && html.includes('qrcode')) return 'img.qrcode'
  if (html.includes('class="qrcode"')) return 'img.qrcode'
  if (html.includes('login-qr') && html.includes('<img')) return '.login-qr img'
  if (html.includes('id="qrcode"') && html.includes('<img')) return '#qrcode img'
  if (html.includes('/qrcode?')) return 'img[src*="qrcode"]'
  return null
}

/**
 * Interface Contract 5: JWT Payload extractor
 */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = Buffer.from(parts[1], 'base64').toString('utf8')
    return JSON.parse(payload) as Record<string, unknown>
  } catch {
    return null
  }
}
