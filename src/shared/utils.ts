/**
 * 共享工具函数
 */
import type { DownloadMode } from './types'
import { APP_DEFAULTS } from './config/defaults'

/** 文件名清洗：替换 Windows/Linux 文件系统非法字符，修剪末尾点与空格，截断至 180 字符 */
export function sanitizeFsName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
  const trimmed = cleaned.slice(0, 180) || '未命名'
  const reservedRegex = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
  return reservedRegex.test(trimmed) ? `_${trimmed}` : trimmed
}

/** 默认命名模板 */
export const DEFAULT_NAMING_TEMPLATE = APP_DEFAULTS.defaultNamingTemplate

/** 根据自定义模板格式化落盘路径 */
export function formatPathFromTemplate(
  template: string,
  vars: {
    term?: string
    course?: string
    category?: string
    teacher?: string
    fileName: string
    title?: string
    ext?: string
  }
): string {
  const tpl = template.trim() || DEFAULT_NAMING_TEMPLATE
  const lastDot = vars.fileName.lastIndexOf('.')
  const derivedExt = lastDot > 0 ? vars.fileName.slice(lastDot + 1) : ''
  const derivedTitle = lastDot > 0 ? vars.fileName.slice(0, lastDot) : vars.fileName

  const map: Record<string, string> = {
    term: vars.term ? sanitizeFsName(vars.term) : '',
    course: vars.course ? sanitizeFsName(vars.course) : '未命名课程',
    category: vars.category ? sanitizeFsName(vars.category) : '',
    teacher: vars.teacher ? sanitizeFsName(vars.teacher) : '',
    fileName: sanitizeFsName(vars.fileName),
    title: sanitizeFsName(vars.title ?? derivedTitle),
    ext: sanitizeFsName(vars.ext ?? derivedExt)
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

  public isLimited(): boolean {
    return this.maxBytesPerSec > 0
  }

  /**
   * 尝试消费指定字节数并返回需要暂停的延迟时间 (ms)。
   * 返回 0 表示当前令牌充足；返回 > 0 表示需调用 resp.pause() 并延迟对应时间后 resume。
   */
  public acquireDelay(bytes: number): number {
    if (this.maxBytesPerSec <= 0 || bytes <= 0) return 0

    const now = Date.now()
    const elapsedSec = (now - this.lastCheck) / 1000
    this.lastCheck = now

    // 补充令牌（上限为 1.2 秒的配额，防止突发洪峰）
    this.tokens = Math.min(this.maxBytesPerSec * 1.2, this.tokens + elapsedSec * this.maxBytesPerSec)

    if (this.tokens >= bytes) {
      this.tokens -= bytes
      return 0
    }

    const missing = bytes - this.tokens
    this.tokens = 0
    const waitMs = Math.round((missing / this.maxBytesPerSec) * 1000)
    return Math.min(Math.max(waitMs, 10), 3000)
  }

  public async consume(bytes: number): Promise<void> {
    const delay = this.acquireDelay(bytes)
    if (delay > 0) {
      await new Promise(r => setTimeout(r, delay))
    }
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

/**
 * 将课程按学期归类 (R2-F1)。
 * 支持 raw API 对象 (term: { name: string }) 与已解析的 CanvasCourse (term: string)。
 * term 缺失、空或 null 时归类到 '(无学期)'。
 */
export function groupCoursesByTerm<T extends { term?: string | { name?: string } | null }>(
  courses: T[]
): Record<string, T[]> {
  const grouped: Record<string, T[]> = {}
  for (const c of courses) {
    let termName = ''
    if (typeof c.term === 'string') {
      termName = c.term.trim()
    } else if (c.term && typeof c.term === 'object' && typeof c.term.name === 'string') {
      termName = c.term.name.trim()
    }
    const key = termName || '未标注学期'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(c)
  }
  return grouped
}

/**
 * 学期逆序排序 (R2-F1)。
 * 按照时间倒序排列（最新学期排在最前，'(无学期)' 排在最后）。
 */
export function sortAcademicTerms(terms: string[]): string[] {
  return [...terms].sort((a, b) => {
    if (a === '未标注学期' || a === '(无学期)') return 1
    if (b === '未标注学期' || b === '(无学期)') return -1
    return b.localeCompare(a, 'zh-CN', { numeric: true })
  })
}

/**
 * 递归/循环深度级联展开路径生成器（用于分栏文件管理器 Miller Columns 路径水合还原）
 */
export function buildAncestorPathChain(path: string[]): Array<{ path: string[]; name: string; selectedName: string | null }> {
  const chain: Array<{ path: string[]; name: string; selectedName: string | null }> = [
    { path: [], name: '根目录', selectedName: path[0] || null }
  ]
  for (let i = 0; i < path.length; i++) {
    const subPath = path.slice(0, i + 1)
    const nextSelected = i + 1 < path.length ? path[i + 1] : null
    chain.push({
      path: subPath,
      name: path[i],
      selectedName: nextSelected
    })
  }
  return chain
}

/**
 * 判断目录列表是否符合单子目录自动穿透条件（仅有 1 个子文件夹且 0 个文件）
 */
export function canAutoPenetrateSingleSubdir(items: Array<{ type: 'dir' | 'file'; name: string }>): { canPenetrate: boolean; singleSubdirName?: string } {
  const dirs = items.filter(i => i.type === 'dir')
  const files = items.filter(i => i.type === 'file')
  if (dirs.length === 1 && files.length === 0) {
    return { canPenetrate: true, singleSubdirName: dirs[0].name }
  }
  return { canPenetrate: false }
}

/**
 * 校验外部跳转 URL 是否为安全合法的 Web 网页协议（仅允许 http/https，防 file/javascript 等危险本地命令协议）
 */
export function isSafeExternalUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return false
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 确保 Canvas 相对路径被补全为完整的交大 Canvas 直链
 */
export function normalizeCanvasUrl(url?: string, defaultBase = 'https://oc.sjtu.edu.cn'): string {
  if (!url || typeof url !== 'string' || !url.trim()) return ''
  const trimmed = url.trim()
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }
  if (trimmed.startsWith('/')) {
    return `${defaultBase.replace(/\/+$/, '')}${trimmed}`
  }
  return `${defaultBase.replace(/\/+$/, '')}/${trimmed}`
}

/**
 * 标准时间戳/日期字符串格式化工具
 * 支持 Date 对象、毫秒时间戳 (number) 及 ISO/标准日期字符串。
 * 格式化为：YYYY-MM-DD HH:mm（当 includeTime 为 true 时）或 YYYY-MM-DD（当 includeTime 为 false 时）。
 * 若解析失败或为空，返回 fallback（默认 '-'）。
 */
export function formatDate(
  val?: string | number | Date | null,
  options?: { includeTime?: boolean; fallback?: string }
): string {
  const fallback = options?.fallback ?? '-'
  if (val === null || val === undefined || val === '' || val === 0) return fallback
  try {
    const d = val instanceof Date ? val : new Date(val)
    if (isNaN(d.getTime())) {
      return typeof val === 'string' ? val : fallback
    }
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const date = String(d.getDate()).padStart(2, '0')
    if (options?.includeTime === false) {
      return `${y}-${m}-${date}`
    }
    const h = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${date} ${h}:${min}`
  } catch {
    return typeof val === 'string' ? val : fallback
  }
}

/** 交大云盘常用根目录预设 */
export const CLOUD_DEST_PRESETS = [
  { label: '/SJTU课程备份 (默认)', value: '/SJTU课程备份' },
  { label: '云盘根目录 (/)', value: '/' },
  { label: '/我的课程', value: '/我的课程' }
] as const

/**
 * 格式化交大云盘目标保存路径的面包屑预览。
 * 格式：交大云盘 > [用户设定目录] > [学期] > [课程] > ...
 * 当 root 为 '/' 或空时直接省略第一级自定义目录；其他以 '/' 开头的非根目录去除首尾斜杠清晰分段展示。
 */
export function formatCloudBreadcrumb(
  root: string,
  sampleTerm = '2026-2027学年第1学期',
  sampleCourse = '软件工程'
): string {
  const cleaned = (root || '').trim().replace(/^\/+/, '').replace(/\/+$/, '')
  if (!cleaned) {
    return `交大云盘 > ${sampleTerm} > ${sampleCourse} > ...`
  }
  return `交大云盘 > ${cleaned} > ${sampleTerm} > ${sampleCourse} > ...`
}

/**
 * 规范化交大云盘根目录路径：
 * 1. 修剪首尾空白；
 * 2. 统一将反斜杠 '\' 转换为正斜杠 '/'；
 * 3. 清理非法字符（<>:"|?* 及控制字符）；
 * 4. 合并多余连续斜杠；
 * 5. 确保以 '/' 开头；
 * 6. 若非根目录 '/'，去除尾部斜杠。
 * 空输入或仅由空格/斜杠构成时返回 '/'。
 */
export function normalizeCloudPath(pathStr: string): string {
  if (!pathStr || typeof pathStr !== 'string') return '/'
  let p = pathStr.trim().replace(/\\/g, '/')
  p = p.replace(/[<>:"|?*\x00-\x1f]/g, '')
  p = p.replace(/\/+/g, '/')
  if (!p.startsWith('/')) {
    p = '/' + p
  }
  if (p.length > 1 && p.endsWith('/')) {
    p = p.replace(/\/+$/, '')
  }
  return p || '/'
}

/**
 * 根据用户设定的云盘根目录、子目录层级以及默认前缀，计算云盘远端目录分段数组 (folder segments)。
 * - 若 destRoot 为 undefined：使用 defaultPrefix（若提供且非空则作为单元素数组 [sanitizeFsName(defaultPrefix)]，否则为空数组 []）；
 * - 若 destRoot 存在且非空（去除首尾斜杠后）：
 *   - 清洗后为空字符串（即 destRoot 原为 '/' 或 ''），表示用户指定直属云盘根目录，顶层目录段为空；
 *   - 否则按 '/' 分割作为顶层目录层级（如 ['SJTU课程备份'] 或 ['我的课程']），各段经 sanitizeFsName 清洗；
 * - 将 subSegments 经 sanitizeFsName 拼接在后返回。
 */
export function buildCloudRemoteSegments(
  destRoot: string | undefined,
  subSegments: string[],
  defaultPrefix?: string
): string[] {
  let rootSegments: string[] = []
  if (destRoot === undefined) {
    if (defaultPrefix && defaultPrefix.trim()) {
      rootSegments = [sanitizeFsName(defaultPrefix.trim())]
    }
  } else {
    const trimmed = destRoot.trim().replace(/^\/+/, '').replace(/\/+$/, '')
    if (trimmed.length > 0) {
      rootSegments = trimmed
        .split('/')
        .map(s => s.trim())
        .filter(Boolean)
        .map(sanitizeFsName)
    }
  }

  const cleanSubSegments = subSegments
    .map(s => (s || '').trim())
    .filter(Boolean)
    .map(sanitizeFsName)

  return [...rootSegments, ...cleanSubSegments]
}

// ─────────────────────────────────────────────────────────────
// 响应式资源容量预估引擎与单文件直下接口
// ─────────────────────────────────────────────────────────────

export type { SingleDownloadPayload } from './types'

export interface EstimateSizeParams {
  fileBytes?: number
  videoCount?: number
  perspective?: 'all' | 'teacher' | 'ppt' | 'audio'
  hasAssignments?: boolean
  assignmentCount?: number
  hasPptPdf?: boolean
  pptPdfCount?: number
}

export interface EstimatedSizeResult {
  totalBytes: number
  formattedSize: string // 如 "约 3.1 GB" 或 "0 B"
}

/** 视频录播机位基准容量常数（每讲字节数估算基准） */
const VIDEO_PERSPECTIVE_BENCHMARK_BYTES: Record<'all' | 'teacher' | 'ppt' | 'audio', number> = {
  all: 650 * 1024 * 1024,
  teacher: 450 * 1024 * 1024,
  ppt: 200 * 1024 * 1024,
  audio: 45 * 1024 * 1024
}

/** 作业附件与作业描述归档基准容量（每项 2MB） */
const ASSIGNMENT_BENCHMARK_BYTES = 2 * 1024 * 1024

/** PPT 讲义 PDF 合成基准容量（每讲 15MB） */
const PPT_PDF_BENCHMARK_BYTES = 15 * 1024 * 1024

/**
 * 响应式资源容量预估引擎
 * 根据当前勾选的课件文件、视频机位偏好、作业及 PPT PDF 讲义配置，毫秒级加权计算总字节数并返回友好格式化文本。
 */
export function estimateResourceSize(params: EstimateSizeParams): EstimatedSizeResult {
  const fileBytes = Math.max(0, params.fileBytes || 0)

  let videoBytes = 0
  if (params.videoCount && params.videoCount > 0) {
    const perspective = params.perspective || 'all'
    const benchmark = VIDEO_PERSPECTIVE_BENCHMARK_BYTES[perspective] ?? VIDEO_PERSPECTIVE_BENCHMARK_BYTES.all
    videoBytes = params.videoCount * benchmark
  }

  let assignmentBytes = 0
  if (params.hasAssignments) {
    const count = params.assignmentCount !== undefined ? Math.max(0, params.assignmentCount) : 1
    assignmentBytes = count * ASSIGNMENT_BENCHMARK_BYTES
  }

  let pptPdfBytes = 0
  if (params.hasPptPdf) {
    const count = params.pptPdfCount !== undefined
      ? Math.max(0, params.pptPdfCount)
      : (params.videoCount !== undefined && params.videoCount > 0 ? params.videoCount : 1)
    pptPdfBytes = count * PPT_PDF_BENCHMARK_BYTES
  }

  const totalBytes = fileBytes + videoBytes + assignmentBytes + pptPdfBytes
  const formattedSize = totalBytes > 0 ? `约 ${formatBytes(totalBytes)}` : '0 B'

  return {
    totalBytes,
    formattedSize
  }
}

/**
 * 界面标题与课程名称括号净化函数
 * 消除生硬的中文/英文括号，将教学班号（如 `(1)`）自然转化为 `1班`，
 * 将课程分类（如 `(B类)`）转化为 `B类`，彻底消除可见括号。
 *
 * 示例:
 * - `大学物理 (B类) (2)` -> `大学物理 B类 2班`
 * - `物理化学 (1)` -> `物理化学 1班`
 * - `科技实习与创新—生物信息学 (1)` -> `科技实习与创新—生物信息学 1班`
 * - `大学物理二 (B类) 第五周周二作业` -> `大学物理二 B类 第五周周二作业`
 * - `《热力学第二定律》作业 物理化学 (1)` -> `《热力学第二定律》作业 物理化学 1班`
 * - `第(1)次作业` -> `第1次作业`
 */
export function cleanParenthesesInTitle(title: string): string {
  if (!title) return ''
  return title
    .replace(/第\s*[（(]\s*(\d+)\s*[）)]\s*([次讲章节周题])/g, '第$1$2')
    .replace(/(?<!第)[（(]\s*(\d+)\s*[）)](?![次讲章节周题])/g, ' $1班 ')
    .replace(/[（(](.*?)[）)]/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface DownloadActionLabels {
  /** 动作动词：'下载' | '上传' | '备份' */
  verb: string
  /** 快捷动作标签：'下载' | '上传' | '备份' */
  quickActionText: string
  /** 悬浮岛主执行文案前缀：'立即下载' | '立即上传' | '下载并备份至云盘' */
  ctaPrefix: string
  /** 详情面板单项主执行文案：'⬇ 立即下载此文件' | '☁️ 立即上传此文件' | '☁️⬇ 下载并备份此文件' */
  detailActionText: string
  /** 传输进行中文案：'下载进行中…' | '上传进行中…' | '下载与备份中…' */
  inProgressText: string
  /** Toast 成功反馈文案生成器 */
  toastMessage: (name: string) => string
  /** Toast 引导勾选反馈文案生成器 */
  toastPromptMessage: (name: string) => string
  /** 图标类型标识：'download' | 'upload' | 'both' */
  iconType: 'download' | 'upload' | 'both'
}

/**
 * 传输动作文案与图标单一真相来源
 * 依据全局存储模式（local / cloud / both），为底栏动作岛、详情面板与悬停按钮提供统一表述。
 */
export function getDownloadActionLabels(mode?: DownloadMode): DownloadActionLabels {
  const currentMode = mode || 'local'

  if (currentMode === 'cloud') {
    return {
      verb: '上传',
      quickActionText: '上传',
      ctaPrefix: '立即上传',
      detailActionText: '☁️ 立即上传此文件',
      inProgressText: '上传进行中…',
      toastMessage: (name: string) => `已开始上传 "${name}" 至交大云盘`,
      toastPromptMessage: (name: string) => `已勾选 "${name}"，点击「立即上传」开始传输`,
      iconType: 'upload'
    }
  }

  if (currentMode === 'both') {
    return {
      verb: '下载并备份',
      quickActionText: '备份',
      ctaPrefix: '下载并备份至云盘',
      detailActionText: '☁️⬇ 下载并备份此文件',
      inProgressText: '下载与备份中…',
      toastMessage: (name: string) => `已开始下载并备份 "${name}" 至交大云盘`,
      toastPromptMessage: (name: string) => `已勾选 "${name}"，点击「下载并备份至云盘」开始传输`,
      iconType: 'both'
    }
  }

  // 默认 local
  return {
    verb: '下载',
    quickActionText: '下载',
    ctaPrefix: '立即下载',
    detailActionText: '⬇ 立即下载此文件',
    inProgressText: '下载进行中…',
    toastMessage: (name: string) => `已开始下载 "${name}"`,
    toastPromptMessage: (name: string) => `已勾选 "${name}"，点击「立即下载」开始传输`,
    iconType: 'download'
  }
}

/**
 * 语义版本比较：若 latest > current 返回 true，否则返回 false。
 * 支持带或不带 'v' 前缀的版本号，按数字逐段比较。
 * 非合法版本号或解析失败时，保守返回 false。
 */
export function isNewerVersion(latest: string, current: string): boolean {
  if (!latest || !current || typeof latest !== 'string' || typeof current !== 'string') {
    return false
  }
  const cleanLatest = latest.trim().replace(/^v/i, '')
  const cleanCurrent = current.trim().replace(/^v/i, '')
  const a = cleanLatest.split('.').map(Number)
  const b = cleanCurrent.split('.').map(Number)
  if (a.some(n => Number.isNaN(n)) || b.some(n => Number.isNaN(n))) return false
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    if (ai > bi) return true
    if (ai < bi) return false
  }
  return false
}
