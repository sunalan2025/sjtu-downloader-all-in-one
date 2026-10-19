/**
 * Canvas 课堂实录 AI 语音逐字稿与字幕导出引擎 (ASR Transcript & SRT Generator)
 *
 * 1. 对接交大录播中台 v.sjtu.edu.cn AI 语音识别 (ASR) 翻译接口；
 * 2. 将毫秒级时间戳转换为工业级 RFC SubRip (.srt) 外挂字幕文件；
 * 3. 编译图文时间轴课堂复习笔记 (.md)；
 * 4. 产物与课堂视频 MP4 同名同目录保存，主流播放器双击自动挂载同名字幕。
 */
import type Electron from 'electron'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { safeFetch } from './safe-fetch'
import { sanitizeFsName } from '../../shared/utils'

export interface AiTranscriptRawItem {
  startTime?: number | string
  beginTime?: number | string
  start?: number | string
  endTime?: number | string
  end?: number | string
  text?: string
  content?: string
  sentence?: string
  words?: string
}

export interface AiTranscriptItem {
  startTime: number // 毫秒
  endTime: number   // 毫秒
  text: string
}

export interface TranscriptMetadata {
  courseName: string
  lectureName: string
  teacher?: string
  classroom?: string
  beginTime?: string
  date?: string
}

/**
 * 将毫秒时间戳转换为标准 SRT 时间码格式: HH:mm:ss,SSS
 * 例如 123456 -> 00:02:03,456
 */
export function formatSrtTime(ms: number): string {
  const safeMs = Math.max(0, Math.floor(Number.isFinite(ms) ? ms : 0))
  const hours = Math.floor(safeMs / 3600000)
  const minutes = Math.floor((safeMs % 3600000) / 60000)
  const seconds = Math.floor((safeMs % 60000) / 1000)
  const millis = safeMs % 1000

  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  const sss = String(millis).padStart(3, '0')

  return `${hh}:${mm}:${ss},${sss}`
}

/**
 * 将毫秒时间戳转换为便于阅读的分钟/秒时间轴标题: HH:mm:ss 或 mm:ss
 * 例如 83000 -> 01:23
 */
export function formatTimelineTime(ms: number): string {
  const safeMs = Math.max(0, Math.floor(Number.isFinite(ms) ? ms : 0))
  const hours = Math.floor(safeMs / 3600000)
  const minutes = Math.floor((safeMs % 3600000) / 60000)
  const seconds = Math.floor((safeMs % 60000) / 1000)

  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')

  if (hours > 0) {
    const hh = String(hours).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }
  return `${mm}:${ss}`
}

/**
 * 标准化 ASR 原始片段数组
 */
export function normalizeTranscriptItems(rawList: unknown): AiTranscriptItem[] {
  if (!Array.isArray(rawList)) return []

  const items: AiTranscriptItem[] = []
  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as AiTranscriptRawItem

    const text = (r.text || r.content || r.sentence || r.words || '').trim()
    if (!text) continue

    const startVal = Number(r.startTime ?? r.beginTime ?? r.start ?? 0)
    const endVal = Number(r.endTime ?? r.end ?? startVal + 2000)

    const startTime = Math.max(0, isNaN(startVal) ? 0 : startVal)
    const endTime = Math.max(startTime, isNaN(endVal) ? startTime + 2000 : endVal)

    items.push({ startTime, endTime, text })
  }

  // 按开始时间排序
  items.sort((a, b) => a.startTime - b.startTime)
  return items
}

/**
 * 将 AI 语音切片编译为工业级 SubRip (.srt) 文本
 */
export function convertAiTranscriptToSrt(items: AiTranscriptItem[]): string {
  if (items.length === 0) return ''

  const blocks: string[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const seq = i + 1
    const timecode = `${formatSrtTime(item.startTime)} --> ${formatSrtTime(item.endTime)}`
    blocks.push(`${seq}\r\n${timecode}\r\n${item.text}\r\n`)
  }

  return blocks.join('\r\n')
}

/**
 * 将 AI 语音切片编译为结构化 Markdown 图文时间轴复习笔记
 */
export function convertAiTranscriptToMarkdown(
  items: AiTranscriptItem[],
  meta: TranscriptMetadata
): string {
  const lines: string[] = []

  lines.push(`# ${meta.lectureName} - AI 课堂语音逐字稿与复习笔记`)
  lines.push('')
  lines.push('## 基本信息')
  lines.push(`- **所属课程**: ${meta.courseName}`)
  lines.push(`- **讲次标题**: ${meta.lectureName}`)
  if (meta.teacher) lines.push(`- **主讲教师**: ${meta.teacher}`)
  if (meta.classroom) lines.push(`- **授课教室**: ${meta.classroom}`)
  if (meta.beginTime) lines.push(`- **授课时间**: ${meta.beginTime}`)
  lines.push(`- **语音段落总数**: ${items.length} 段`)
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 课堂时间轴逐字纪要')
  lines.push('')

  if (items.length === 0) {
    lines.push('*(本讲课堂实录暂未生成语音识别逐字稿)*')
    lines.push('')
    return lines.join('\n')
  }

  // 聚合同一分钟或相近时间段的发言，排版更自然
  for (const item of items) {
    const timeStr = formatTimelineTime(item.startTime)
    lines.push(`### [${timeStr}]`)
    lines.push(item.text)
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 抓取单讲课堂实录的 AI 语音逐字稿 (v.sjtu.edu.cn)
 */
export async function fetchAiTranscript(
  ses: Electron.Session,
  token: string,
  courseId: string | number
): Promise<AiTranscriptItem[]> {
  try {
    const url = `https://v.sjtu.edu.cn/jy-application-resourcemanage/v1/course/ai/translate?courseId=${courseId}`
    const resp = await safeFetch(ses, url, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
        Authorization: `Bearer ${token}`,
        Referer: 'https://v.sjtu.edu.cn/'
      }
    })

    if (!resp.ok) {
      console.warn(`[transcript] fetchAiTranscript courseId=${courseId} HTTP ${resp.status}`)
      return []
    }

    const json = (await resp.json()) as { code?: number; data?: unknown } | unknown[]
    const rawData = (json && typeof json === 'object' && 'data' in json) ? (json as { data: unknown }).data : json
    return normalizeTranscriptItems(rawData)
  } catch (err) {
    console.warn(`[transcript] fetchAiTranscript courseId=${courseId} 异常:`, err)
    return []
  }
}

export interface LectureTranscriptExportOpts {
  courseName: string
  term?: string
  lectureName: string
  videoBaseName: string
  videoSession?: { beginTime: string; teacher: string; classroom: string }
  destRoot: string
  courseId: string | number
  token: string
  exportSrt?: boolean
  exportMarkdown?: boolean
}

/**
 * 下载并保存单讲课堂视频的 AI 字幕 (.srt) 与逐字稿笔记 (.md)
 */
export async function downloadLectureTranscript(
  ses: Electron.Session,
  opts: LectureTranscriptExportOpts,
  onProgress?: (phase: string) => void
): Promise<{ ok: boolean; srtPath?: string; mdPath?: string; count?: number; error?: string }> {
  try {
    const {
      courseName, term, lectureName, videoBaseName,
      videoSession, destRoot, courseId, token,
      exportSrt = true, exportMarkdown = true
    } = opts

    onProgress?.(`正在获取 ${lectureName} AI语音逐字稿…`)
    const items = await fetchAiTranscript(ses, token, courseId)
    if (items.length === 0) {
      return { ok: true, count: 0 }
    }

    // 目录路径：Canvas课程/{term}/{courseName}/videos/课堂视频/
    const base = destRoot || mkdtempSync(join(tmpdir(), 'sjtu-transcript-'))
    const parts = [sanitizeFsName(courseName)]
    if (term) parts.unshift(sanitizeFsName(term))
    const outDir = join(base, 'Canvas课程', parts.join('/'), 'videos', '课堂视频')
    mkdirSync(outDir, { recursive: true })

    const cleanBaseName = sanitizeFsName(videoBaseName)
    let srtPath: string | undefined
    let mdPath: string | undefined

    // 1. 导出同名 .srt 外挂字幕
    if (exportSrt) {
      onProgress?.(`生成字幕文件: ${cleanBaseName}.srt`)
      const srtContent = convertAiTranscriptToSrt(items)
      srtPath = join(outDir, `${cleanBaseName}.srt`)
      writeFileSync(srtPath, srtContent, 'utf-8')
    }

    // 2. 导出时间轴笔记 .md
    if (exportMarkdown) {
      onProgress?.(`生成复习笔记: ${cleanBaseName}-AI逐字稿笔记.md`)
      const mdContent = convertAiTranscriptToMarkdown(items, {
        courseName,
        lectureName,
        teacher: videoSession?.teacher,
        classroom: videoSession?.classroom,
        beginTime: videoSession?.beginTime
      })
      mdPath = join(outDir, `${cleanBaseName}-AI逐字稿笔记.md`)
      writeFileSync(mdPath, mdContent, 'utf-8')
    }

    return { ok: true, srtPath, mdPath, count: items.length }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
