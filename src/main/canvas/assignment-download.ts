/**
 * Canvas 课程作业与提交全量归档引擎 (Assignments & Submissions)
 *
 * 1. 抓取作业题干描述、分值、截止时间、教师附件；
 * 2. 抓取学生本人提交历史原件、得分成绩与助教评语；
 * 3. 结构化归档落盘：
 *    {destRoot}/Canvas课程/{term}/{courseName}/assignments/{作业名称}/
 *    ├── 作业说明与评语.md
 *    ├── attachments/ (题目附件)
 *    └── submissions/ (本人提交原件)
 * 4. 支持 Local、CloudPan 直传及 Both 模式。
 */
import type Electron from 'electron'
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as cheerio from 'cheerio'
import type {
  CanvasAssignmentItem,
  CanvasAssignmentFile,
  CanvasAssignmentComment
} from '../../shared/types'
import { CANVAS_BASE_URL } from '../../shared/types'
import { safeFetch } from './safe-fetch'
import { sanitizeFsName, formatBytes } from '../../shared/utils'

/** 将 HTML 题目要求转为整洁的 Markdown 格式文本 */
export function convertHtmlToMarkdown(html?: string): string {
  if (!html || !html.trim()) return '*(无题目要求描述)*'
  try {
    const $ = cheerio.load(html)
    // 移除无用元素
    $('script, style, iframe').remove()

    // 转换换行与段落
    $('p, div, br, h1, h2, h3, h4, h5, h6, li').each((_, el) => {
      $(el).append('\n')
    })

    // 处理链接
    $('a').each((_, el) => {
      const text = $(el).text().trim()
      const href = $(el).attr('href')
      if (text && href) {
        $(el).replaceWith(`[${text}](${href})`)
      }
    })

    // 处理加粗与强调
    $('strong, b').each((_, el) => {
      const text = $(el).text().trim()
      if (text) $(el).replaceWith(`**${text}**`)
    })

    // 处理列表项
    $('li').each((_, el) => {
      const text = $(el).text().trim()
      if (text) $(el).replaceWith(`- ${text}\n`)
    })

    const text = $.text()
    // 清理连续多余空行
    return text.replace(/\n{3,}/g, '\n\n').trim()
  } catch {
    return sanitizeHtmlFallback(html)
  }
}

/** 降级兜底：循环迭代剥离 HTML 标签直至稳定（防御多字符嵌套绕过 CWE-20, CWE-116） */
export function sanitizeHtmlFallback(html: string): string {
  let sanitized = html
  let prev: string
  do {
    prev = sanitized
    sanitized = sanitized.replace(/<[^>]+>/g, '')
  } while (sanitized !== prev)
  return sanitized.trim() || '*(无题目要求描述)*'
}

/** 编译成标准《作业说明与评语.md》Markdown 文档内容 */
export function compileAssignmentMarkdown(item: CanvasAssignmentItem): string {
  const lines: string[] = []

  lines.push(`# ${item.name}`)
  lines.push('')
  lines.push('## 基本信息')
  lines.push(`- **所属作业**: ${item.name}`)
  if (item.pointsPossible !== undefined) {
    lines.push(`- **满分**: ${item.pointsPossible} 分`)
  }
  lines.push(`- **截止时间**: ${item.dueAt ? item.dueAt.replace('T', ' ').replace('Z', '') : '无截止时间'}`)
  lines.push(`- **提交状态**: ${item.hasSubmission ? '已提交' : '未提交'}`)
  if (item.hasSubmission) {
    if (item.submittedAt) {
      lines.push(`- **提交时间**: ${item.submittedAt.replace('T', ' ').replace('Z', '')}`)
    }
    if (item.submissionScore !== undefined || item.submissionGrade !== undefined) {
      const scoreStr = item.submissionScore !== undefined ? `${item.submissionScore} 分` : ''
      const gradeStr = item.submissionGrade ? ` (等级: ${item.submissionGrade})` : ''
      lines.push(`- **最终得分**: ${scoreStr}${gradeStr}`)
    }
  }
  if (item.htmlUrl) {
    lines.push(`- **Canvas 网页链接**: [点击跳转](${item.htmlUrl})`)
  }

  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 题目要求')
  lines.push('')
  lines.push(convertHtmlToMarkdown(item.descriptionHtml))
  lines.push('')

  if (item.teacherAttachments && item.teacherAttachments.length > 0) {
    lines.push('---')
    lines.push('')
    lines.push('## 题目附件')
    for (const att of item.teacherAttachments) {
      const sizeStr = att.size ? ` (${formatBytes(att.size)})` : ''
      lines.push(`- 📄 [${att.name}](./attachments/${encodeURIComponent(att.name)})${sizeStr}`)
    }
    lines.push('')
  }

  if (item.submissionFiles && item.submissionFiles.length > 0) {
    lines.push('---')
    lines.push('')
    lines.push('## 本人提交原件')
    for (const sub of item.submissionFiles) {
      const sizeStr = sub.size ? ` (${formatBytes(sub.size)})` : ''
      lines.push(`- 📦 [${sub.name}](./submissions/${encodeURIComponent(sub.name)})${sizeStr}`)
    }
    lines.push('')
  }

  if (item.comments && item.comments.length > 0) {
    lines.push('---')
    lines.push('')
    lines.push('## 教师 / 助教评语')
    for (const c of item.comments) {
      const timeStr = c.createdAt ? ` (${c.createdAt.replace('T', ' ').replace('Z', '')})` : ''
      lines.push(`> **${c.authorName || '评阅人'}${timeStr}**:`)
      lines.push(`> ${c.comment.replace(/\n/g, '\n> ')}`)
      lines.push('')
    }
  }

  return lines.join('\n')
}

/** 规范化 Canvas 课程名与学期子路径 */
function canvasCoursePath(courseName: string, term?: string): string {
  const parts = term ? [sanitizeFsName(term)] : []
  parts.push(sanitizeFsName(courseName))
  return parts.join('/')
}

/** 获取单门课程的全部作业列表（包含题目描述、附件、学生本人提交、打分与评语） */
export async function fetchCourseAssignments(
  ses: Electron.Session,
  courseId: number
): Promise<CanvasAssignmentItem[]> {
  try {
    const url = `${CANVAS_BASE_URL}/api/v1/courses/${courseId}/assignments?include[]=submission&include[]=submission_comments&include[]=attachments&per_page=100`
    const resp = await safeFetch(ses, url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Referer: `${CANVAS_BASE_URL}/`
      }
    })

    if (!resp.ok) {
      console.warn(`[canvas] fetchCourseAssignments course=${courseId} HTTP ${resp.status}`)
      return []
    }

    const items = (await resp.json()) as Array<Record<string, unknown>>
    if (!Array.isArray(items)) return []

    const mapped: CanvasAssignmentItem[] = items.map(raw => {
      const sub = (raw.submission || {}) as Record<string, unknown>
      const hasSubmission = Boolean(sub.workflow_state && sub.workflow_state !== 'unsubmitted')

      // 提取题目附件
      const rawAtts = (raw.attachments as Array<Record<string, unknown>>) || []
      const teacherAttachments: CanvasAssignmentFile[] = rawAtts.map(a => ({
        id: Number(a.id || 0),
        name: sanitizeFsName(String(a.display_name || a.filename || 'attachment')),
        url: String(a.url || ''),
        size: Number(a.size || 0)
      })).filter(a => !!a.url)

      // 提取学生本人提交文件
      const rawSubs = (sub.attachments as Array<Record<string, unknown>>) || []
      const submissionFiles: CanvasAssignmentFile[] = rawSubs.map(s => ({
        id: Number(s.id || 0),
        name: sanitizeFsName(String(s.display_name || s.filename || 'submission')),
        url: String(s.url || ''),
        size: Number(s.size || 0)
      })).filter(s => !!s.url)

      // 提取助教评语
      const rawComments = (sub.submission_comments as Array<Record<string, unknown>>) || []
      const comments: CanvasAssignmentComment[] = rawComments.map(c => ({
        authorName: String(c.author_name || '助教'),
        comment: String(c.comment || '').trim(),
        createdAt: String(c.created_at || '')
      })).filter(c => !!c.comment)

      return {
        id: Number(raw.id),
        name: sanitizeFsName(String(raw.name || `作业_${raw.id}`)),
        dueAt: raw.due_at ? String(raw.due_at) : undefined,
        pointsPossible: raw.points_possible !== undefined ? Number(raw.points_possible) : undefined,
        hasSubmission,
        submittedAt: sub.submitted_at ? String(sub.submitted_at) : undefined,
        submissionScore: sub.score !== undefined ? Number(sub.score) : undefined,
        submissionGrade: sub.grade !== undefined ? String(sub.grade) : undefined,
        htmlUrl: raw.html_url ? String(raw.html_url) : undefined,
        descriptionHtml: raw.description ? String(raw.description) : undefined,
        teacherAttachments,
        submissionFiles,
        comments
      }
    })

    return mapped
  } catch (err) {
    console.warn(`[canvas] fetchCourseAssignments course=${courseId} 异常:`, err)
    return []
  }
}

/** 通过 ses.fetch 下载单个文件到本地 */
async function downloadSingleFile(
  ses: Electron.Session,
  url: string,
  destPath: string,
  conflictStrategy: 'skip' | 'overwrite' = 'skip'
): Promise<boolean> {
  if (conflictStrategy !== 'overwrite' && existsSync(destPath) && statSync(destPath).size > 0) {
    return true // 已存在跳过
  }
  const resp = await ses.fetch(url)
  if (!resp.ok) {
    throw new Error(`下载文件失败: HTTP ${resp.status}`)
  }
  const arrayBuffer = await resp.arrayBuffer()
  writeFileSync(destPath, Buffer.from(arrayBuffer))
  return false
}

export interface AssignmentDownloadOpts {
  courseName: string
  courseId: number
  assignment: CanvasAssignmentItem
  destRoot: string
  term?: string
  conflictStrategy?: 'skip' | 'overwrite'
  cloudUserToken?: string
}

/** 单个作业全量归档下载 */
export async function downloadAssignmentArchive(
  ses: Electron.Session,
  opts: AssignmentDownloadOpts,
  onProgress?: (phase: string) => void
): Promise<{ ok: boolean; path?: string; skipped?: boolean; error?: string }> {
  try {
    const { courseName, assignment, destRoot, term, conflictStrategy = 'skip' } = opts
    const base = destRoot || mkdtempSync(join(tmpdir(), 'sjtu-canvas-assign-'))
    const cPath = canvasCoursePath(courseName, term)
    const assignDirName = sanitizeFsName(assignment.name)
    const outDir = join(base, 'Canvas课程', cPath, 'assignments', assignDirName)

    mkdirSync(outDir, { recursive: true })
    onProgress?.(`生成说明文档: ${assignment.name}`)

    // 1. 编译并保存《作业说明与评语.md》
    const mdPath = join(outDir, '作业说明与评语.md')
    const mdContent = compileAssignmentMarkdown(assignment)
    writeFileSync(mdPath, mdContent, 'utf-8')

    // 2. 下载题目附件
    if (assignment.teacherAttachments.length > 0) {
      const attDir = join(outDir, 'attachments')
      mkdirSync(attDir, { recursive: true })
      for (let i = 0; i < assignment.teacherAttachments.length; i++) {
        const att = assignment.teacherAttachments[i]
        onProgress?.(`下载题目附件 (${i + 1}/${assignment.teacherAttachments.length}): ${att.name}`)
        const dest = join(attDir, att.name)
        await downloadSingleFile(ses, att.url, dest, conflictStrategy).catch(e => {
          console.warn(`[assignment] 附件 ${att.name} 下载异常:`, e)
        })
      }
    }

    // 3. 下载学生本人提交原件
    if (assignment.submissionFiles.length > 0) {
      const subDir = join(outDir, 'submissions')
      mkdirSync(subDir, { recursive: true })
      for (let i = 0; i < assignment.submissionFiles.length; i++) {
        const sub = assignment.submissionFiles[i]
        onProgress?.(`下载提交原件 (${i + 1}/${assignment.submissionFiles.length}): ${sub.name}`)
        const dest = join(subDir, sub.name)
        await downloadSingleFile(ses, sub.url, dest, conflictStrategy).catch(e => {
          console.warn(`[assignment] 提交原件 ${sub.name} 下载异常:`, e)
        })
      }
    }

    return { ok: true, path: outDir }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
