/**
 * 共享工具函数
 */

/** 文件名清洗：替换 Windows/Linux 文件系统非法字符，修剪末尾点与空格，截断至 180 字符 */
export function sanitizeFsName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
  return cleaned.slice(0, 180) || '未命名'
}

/** 默认命名模板 */
export const DEFAULT_NAMING_TEMPLATE = '{term}/{course}/{category}/{fileName}'

/** 根据自定义模板格式化落盘路径 */
export function formatPathFromTemplate(
  template: string,
  vars: {
    term?: string
    course?: string
    category?: string
    teacher?: string
    fileName: string
  }
): string {
  const tpl = template.trim() || DEFAULT_NAMING_TEMPLATE
  const map: Record<string, string> = {
    term: vars.term ? sanitizeFsName(vars.term) : '',
    course: vars.course ? sanitizeFsName(vars.course) : '未命名课程',
    category: vars.category ? sanitizeFsName(vars.category) : '',
    teacher: vars.teacher ? sanitizeFsName(vars.teacher) : '',
    fileName: sanitizeFsName(vars.fileName)
  }

  const parts = tpl
    .split('/')
    .map(seg => {
      let s = seg
      for (const [k, v] of Object.entries(map)) {
        s = s.replace(new RegExp(`\\{${k}\\}`, 'gi'), v)
      }
      s = s.trim()
      return s ? sanitizeFsName(s) : ''
    })
    .filter(Boolean)

  return parts.join('/')
}

/** 基于令牌桶的全局带宽限速器 */
export class SpeedLimiter {
  private maxBytesPerSec = 0
  private tokens = 0
  private lastCheck = Date.now()

  public setLimitKBps(limitKBps: number): void {
    this.maxBytesPerSec = limitKBps > 0 ? limitKBps * 1024 : 0
    this.tokens = this.maxBytesPerSec
    this.lastCheck = Date.now()
  }

  public async consume(bytes: number): Promise<void> {
    if (this.maxBytesPerSec <= 0 || bytes <= 0) return

    const now = Date.now()
    const elapsedSec = (now - this.lastCheck) / 1000
    this.lastCheck = now

    // 补充令牌（上限为 1.5 秒的配额，防止突发）
    this.tokens = Math.min(this.maxBytesPerSec * 1.5, this.tokens + elapsedSec * this.maxBytesPerSec)

    if (this.tokens >= bytes) {
      this.tokens -= bytes
      return
    }

    // 令牌不足：计算需要等待的时间
    const missing = bytes - this.tokens
    const waitMs = (missing / this.maxBytesPerSec) * 1000
    this.tokens = 0
    await new Promise(r => setTimeout(r, Math.min(waitMs, 5000)))
  }
}

export const globalSpeedLimiter = new SpeedLimiter()

/** 字节格式化：支持 KB/MB/GB/TB，保留合适的小数位数 */
export function formatBytes(b: number): string {
  if (!b || b < 0) return '0 B'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  if (b < 1024 * 1024 * 1024 * 1024) return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
  return `${(b / 1024 / 1024 / 1024 / 1024).toFixed(2)} TB`
}


