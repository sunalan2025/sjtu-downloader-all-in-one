/**
 * 下载文件完整性守卫 (R2-F4)
 *
 * 确保落盘文件非空 (size >= minBytes) 且非 HTML 错误页/登录页。
 */
import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { extname } from 'node:path'

export class FileIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileIntegrityError'
  }
}

export interface FileIntegrityResult {
  valid: boolean
  error?: string
}

const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml'])

/** 判断文件扩展名是否本身即为 HTML 网页文件 */
export function isHtmlExtension(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return HTML_EXTENSIONS.has(ext)
}

/**
 * 校验下载文件的有效性与完整性。
 *
 * @param filePath 本地文件路径
 * @param minBytes 最小字节数，默认 1
 * @param allowHtml 是否允许 HTML 内容（默认 false，若为 true 则即使检测到 <html> 也放行）
 */
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
    return {
      valid: false,
      error: `文件大小为 ${stat.size} 字节，小于最小要求 ${minBytes} 字节`
    }
  }

  if (!allowHtml) {
    const fd = openSync(filePath, 'r')
    try {
      const readLen = Math.min(2048, stat.size)
      const buf = Buffer.alloc(readLen)
      readSync(fd, buf, 0, readLen, 0)
      const head = buf.toString('utf8').toLowerCase()
      if (head.includes('<!doctype html') || head.includes('<html')) {
        return {
          valid: false,
          error: '文件内容为 HTML 网页（疑似未认证重定向至登录页），非有效课件二进制'
        }
      }
    } finally {
      closeSync(fd)
    }
  }

  return { valid: true }
}

/**
 * 断言文件完整性，若校验失败则抛出 FileIntegrityError。
 */
export function assertDownloadIntegrity(
  filePath: string,
  minBytes = 1,
  allowHtml = false
): void {
  const check = verifyDownloadIntegrity(filePath, minBytes, allowHtml)
  if (!check.valid) {
    throw new FileIntegrityError(check.error || '文件完整性校验失败')
  }
}
