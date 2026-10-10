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
 * Interface Contract 1.1: 302 Download Redirect Interceptor (R2-F3)
 */
export interface RedirectInterceptResult {
  action: 'follow' | 'abort'
  reason?: string
  nextUrl?: string
}

export function interceptDownloadRedirect(
  locationHeader: string,
  requestUrl: string
): RedirectInterceptResult {
  let parsed: URL
  try {
    parsed = new URL(locationHeader, requestUrl)
  } catch {
    return {
      action: 'abort',
      reason: `重定向 URL 解析失败：${locationHeader}`
    }
  }

  const host = parsed.hostname.toLowerCase()
  const path = parsed.pathname.toLowerCase()

  // 1. Check for session expired login redirect
  if (
    host === 'jaccount.sjtu.edu.cn' ||
    host.endsWith('.jaccount.sjtu.edu.cn') ||
    (host === 'oc.sjtu.edu.cn' && (path.startsWith('/login') || path === '/login'))
  ) {
    return {
      action: 'abort',
      reason: 'Canvas 会话失效，下载重定向至登录页'
    }
  }

  const next = parsed.toString()

  // 2. Check for security domain whitelist
  if (!isAllowedSjtuUrl(next)) {
    return {
      action: 'abort',
      reason: `禁止向非交大受信域重定向: ${next}`
    }
  }

  return { action: 'follow', nextUrl: next }
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
      const readLen = Math.min(2048, stat.size)
      const buf = Buffer.alloc(readLen)
      readSync(fd, buf, 0, readLen, 0)
      const head = buf.toString('utf8').toLowerCase()
      if (head.includes('<!doctype html') || head.includes('<html')) {
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

/**
 * Interface Contract 6: LTI 1.3 Video Scan & Pagination (R2-F5)
 */
const LTI_TAB_KEYWORDS = ['课堂视频', '课堂录像', '在线课堂', 'class video']

export function isClassVideoTab(label: string): boolean {
  if (!label) return false
  const lower = label.toLowerCase()
  return LTI_TAB_KEYWORDS.some(kw => lower.includes(kw))
}

const CHINESE_NUM_MAP: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '十一': 11, '十二': 12
}

export function extractLectureNum(name: string): number {
  if (!name) return 0
  const m1 = name.match(/第\s*(\d+)\s*[讲次课]/i)
  if (m1) return Number.parseInt(m1[1], 10)

  const m2 = name.match(/第\s*([一二三四五六七八九十]+)\s*[讲次课]/)
  if (m2 && CHINESE_NUM_MAP[m2[1]]) return CHINESE_NUM_MAP[m2[1]]

  const m3 = name.match(/(?:lecture|lec|class)\s*(\d+)/i)
  if (m3) return Number.parseInt(m3[1], 10)

  const m4 = name.match(/(?:^|[^\d])(\d{1,3})(?:[^\d]|$)/)
  if (m4) return Number.parseInt(m4[1], 10)

  return 0
}

/**
 * Interface Contract 7: Video Stream Identifier (R2-F6)
 */
export interface VideoStream {
  channelNum: number
  channelName: string
  url: string
  label: '教师' | 'PPT' | '全景'
}

export function identifyVideoStreams(rawStreams: any[]): VideoStream[] {
  if (!rawStreams || !Array.isArray(rawStreams)) return []
  const valid = rawStreams.filter(s => s && (s.rtmpUrlHdv || s.url))
  if (valid.length === 0) return []

  const result: VideoStream[] = []

  for (const s of valid) {
    const channelNum = Number(s.cdviChannelNum ?? s.channelNum ?? 0)
    const name = String(s.channelName || '')
    const url = String(s.rtmpUrlHdv || s.url || '')

    let label: '教师' | 'PPT' | '全景' = '教师'
    if (name.includes('PPT') || name.includes('电脑') || channelNum === 1) {
      label = 'PPT'
    } else if (name.includes('全景') || channelNum === 2) {
      label = '全景'
    } else {
      label = '教师'
    }

    result.push({
      channelNum,
      channelName: name,
      url,
      label
    })
  }

  if (result.length === 1 && !result[0].channelName.includes('PPT')) {
    result[0].label = '教师'
  }

  return result
}

/**
 * Interface Contract 8: High-Definition PPT Slices Harvester (R2-F7)
 */
export interface PptSliceItem {
  ivsVideoId: number
  createSec: number
  pptImgUrl: string
}

export function processPptSlices(
  rawSlices: any[],
  options: { saveImages?: boolean } = {}
): { slices: PptSliceItem[]; willSaveImages: boolean; totalVisible: number } {
  if (!rawSlices || !Array.isArray(rawSlices)) {
    return { slices: [], willSaveImages: options.saveImages ?? false, totalVisible: 0 }
  }
  const visible = rawSlices
    .filter(s => s && s.pptImgUrl && Number(s.hide) === 0)
    .sort((a, b) => Number(a.createSec) - Number(b.createSec))
    .map(s => ({
      ivsVideoId: Number(s.ivsVideoId || 0),
      createSec: Number(s.createSec || 0),
      pptImgUrl: String(s.pptImgUrl)
    }))

  return {
    slices: visible,
    willSaveImages: options.saveImages ?? false,
    totalVisible: visible.length
  }
}

export function formatSliceFileName(index: number, createSec: number, ext = 'jpg'): string {
  const idxStr = String(index).padStart(2, '0')
  const sec = Math.max(0, Math.floor(createSec || 0))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const timeStr = h > 0
    ? `${String(h).padStart(2, '0')}h${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`
    : `${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`
  const cleanExt = ext.replace(/^\./, '')
  return `${idxStr}_${timeStr}.${cleanExt}`
}

export function buildPptSliceDirName(lectureName: string): string {
  const base = lectureName.replace(/[/\\?%*:|"<>]/g, '_')
  return `${base}-切片`
}

/**
 * Interface Contract 9: FFmpeg asar.unpacked Path Resolver (R4-F3)
 */
export function resolveBundledFfmpeg(
  bundledPath: string,
  fileExists: (p: string) => boolean = existsSync
): string {
  if (!bundledPath) return 'ffmpeg'
  const unpackedPath = bundledPath.replace('app.asar', 'app.asar.unpacked')
  if (fileExists(unpackedPath)) return unpackedPath
  if (fileExists(bundledPath)) return bundledPath
  return 'ffmpeg'
}

/**
 * Interface Contract 10: HLS Stream Task Detector (R2-F6)
 */
export function isHlsStreamTask(spec: any): boolean {
  if (!spec) return false
  if (spec.source === 'canvas-class-video') return true
  if (spec.isHls === true) return true
  const url = String(spec.url || '').toLowerCase()
  if (url.endsWith('.m3u8') || url.includes('.m3u8?') || url.includes('.m3u8#')) return true
  return false
}

