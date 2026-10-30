/**
 * 下载领域层 — taskId 工厂与解析器（唯一真相来源）
 *
 * taskId 是渲染端 ↔ 主进程 ↔ 进度表三方共享的任务主键。原先生成与解析逻辑
 * 散落在三页（CanvasBrowser / AuditedCourses / CnmoocBrowser）共 12 处：
 * 字符串前缀拼接（`canvas_file_${courseId}_${fileId}`）与正则反解
 * （`/^canvas_(?:file|lecture|...)(\d+)_/`）各自为政，格式约定靠复制粘贴维持。
 *
 * 本模块收编全部生成与解析。规则：
 *   - 生成函数按「来源:标识符」拼接，主进程 orchestrator 的 spec 产制方一致
 *   - `parseTaskId()` 是唯一的反解入口，解析失败返回 null（不抛异常）
 *   - 前缀变更只改这里
 *
 * 当前 task 源前缀：
 *   canvas_file_{cid}_{fid}         — Canvas 课件文件（含模块/大纲补漏，统一走 files 路径）
 *   canvas_lecture_{cid}_{lec}_{r}  — Canvas 课堂视频（r = teacher | ppt）
 *   canvas_mvid_{cid}_{title}       — Canvas 单元视频 Page iframe（HLS）
 *   canvas_exttool_{cid}_{fid}      — Canvas 单元视频 ExternalTool（直接 MP4）
 *   canvas_exturl_{cid}_{uuid}      — Canvas 单元视频 ExternalUrl（vshare MP4）
 *   canvas_assignment_{cid}_{aid}   — Canvas 作业归档
 *   {cid}_{vid}_{angle}             — 旁听课程视频（angle: 0=教师, 3=PPT）
 *   cnmooc_{cid}_{itemId}          — 好大学在线条目
 *
 * 聚合任务（非逐文件，下载引擎在主进程内部完成，无 _cloud 镜像）：
 *   canvas_ppt_pdf_{cid}            — PPT 课件 PDF 批量聚合
 *   canvas_assign_batch_{cid}       — 作业归档批量聚合
 *   canvas_transcript_{cid}         — AI 字幕/逐字稿批量聚合
 */

/** 旁听课程视角编号 */
export type AuditedAngle = 0 | 3

// ─── Canvas ───────────────────────────────────────────────────

export function canvasFileTaskId(courseId: number, fileId: number): string {
  return `canvas_file_${courseId}_${fileId}`
}

export function canvasAssignmentTaskId(courseId: number, assignmentId: number): string {
  return `canvas_assignment_${courseId}_${assignmentId}`
}

export function canvasLectureTaskId(courseId: number, lectureNum: number, role: 'teacher' | 'ppt'): string {
  return `canvas_lecture_${courseId}_${lectureNum}_${role}`
}

/** PPT 课件 PDF 逐讲明细项 id（注意：这是 UI 展示项 id，聚合任务 id 是 canvasPptPdfBatchTaskId） */
export function canvasPptItemTaskId(courseId: number, lectureNum: number): string {
  return `canvas_ppt_item_${courseId}_${lectureNum}`
}

/** PPT 课件 PDF 课程级聚合任务 id（主进程 downloadBatch 的进度 taskId） */
export function canvasPptPdfBatchTaskId(courseId: number): string {
  return `canvas_ppt_pdf_${courseId}`
}

/** 作业归档课程级聚合任务 id */
export function canvasAssignBatchTaskId(courseId: number): string {
  return `canvas_assign_batch_${courseId}`
}

/** AI 字幕/逐字稿课程级聚合任务 id */
export function canvasTranscriptBatchTaskId(courseId: number): string {
  return `canvas_transcript_${courseId}`
}

/** 单元视频 Page iframe（HLS）。pageTitle 经 sanitize 保证 taskId 稳定、落盘名合法 */
export function canvasMvidTaskId(courseId: number, pageTitle: string, sanitize: (s: string) => string): string {
  return `canvas_mvid_${courseId}_${sanitize(pageTitle)}`
}

/** 单元视频 ExternalTool（v.sjtu playerPage 直接 MP4） */
export function canvasExtToolTaskId(courseId: number, fileId: string): string {
  return `canvas_exttool_${courseId}_${fileId}`
}

/** 单元视频 ExternalUrl（vshare 直接 MP4） */
export function canvasExtUrlTaskId(courseId: number, uuid: string): string {
  return `canvas_exturl_${courseId}_${uuid}`
}

// ─── 旁听课程 (v.sjtu) ─────────────────────────────────────────

export function auditedTaskId(courseId: number, videoId: number, angle: AuditedAngle): string {
  return `${courseId}_${videoId}_${angle}`
}

// ─── 好大学在线 (cnmooc) ──────────────────────────────────────

export function cnmoocTaskId(courseId: string, itemId: string): string {
  return `cnmooc_${courseId}_${itemId}`
}

// ─── 解析（唯一反解入口） ─────────────────────────────────────

export interface ParsedTaskId {
  /** 任务来源 */
  source: 'canvas-file' | 'canvas-lecture' | 'canvas-mvid' | 'canvas-exttool' | 'canvas-exturl'
    | 'canvas-assignment' | 'canvas-ppt-pdf' | 'canvas-ppt-item' | 'canvas-assign-batch' | 'canvas-transcript'
    | 'audited' | 'cnmooc'
  /** 课程 id（audited: resourceId；canvas: courseId；cnmooc: courseId 字符串转 number，可能 NaN——cnmooc 的 courseId 本就是字符串） */
  courseId: number
  /** 其余标识段（文件 id / videoId / lectureNum 等，按 source 语义取用） */
  rest: string[]
}

const CANVAS_PREFIX_MAP: Record<string, ParsedTaskId['source']> = {
  canvas_file: 'canvas-file',
  canvas_lecture: 'canvas-lecture',
  canvas_mvid: 'canvas-mvid',
  canvas_exttool: 'canvas-exttool',
  canvas_exturl: 'canvas-exturl',
  canvas_assignment: 'canvas-assignment',
  canvas_ppt_pdf: 'canvas-ppt-pdf',
  canvas_ppt_item: 'canvas-ppt-item',
  canvas_assign_batch: 'canvas-assign-batch',
  canvas_transcript: 'canvas-transcript'
}

/** 解析 taskId。无法识别的格式返回 null。 */
export function parseTaskId(taskId: string): ParsedTaskId | null {
  if (!taskId || typeof taskId !== 'string') return null

  if (taskId.startsWith('cnmooc_')) {
    const rest = taskId.slice('cnmooc_'.length)
    const sep = rest.indexOf('_')
    if (sep <= 0) return null
    const courseStr = rest.slice(0, sep)
    const cid = Number(courseStr)
    if (!Number.isFinite(cid)) return null
    return { source: 'cnmooc', courseId: cid, rest: [rest.slice(sep + 1)] }
  }

  // 旁听：{cid}_{vid}_{angle}（无前缀，三段数字）
  const m = taskId.match(/^(\d+)_(\d+)_([03])$/)
  if (m) {
    return { source: 'audited', courseId: Number(m[1]), rest: [m[2], m[3]] }
  }

  // Canvas 各前缀：{prefix}_{cid}_... 或 {prefix}_{cid}（批量聚合任务）
  for (const [prefix, source] of Object.entries(CANVAS_PREFIX_MAP)) {
    if (taskId.startsWith(prefix + '_')) {
      const rest = taskId.slice(prefix.length + 1)
      const sep = rest.indexOf('_')
      if (sep === -1) {
        // 无后续段（如 canvas_ppt_pdf_12345、canvas_assign_batch_12345、canvas_transcript_12345）
        const cid = Number(rest)
        if (!Number.isFinite(cid)) return null
        return { source, courseId: cid, rest: [] }
      }
      if (sep <= 0) return null
      const cid = Number(rest.slice(0, sep))
      if (!Number.isFinite(cid)) return null
      return { source, courseId: cid, rest: rest.slice(sep + 1).split('_') }
    }
  }

  return null
}

/** 从任意 taskId 集合提取涉及的 courseId 集合（页面 coursesToProcess 派生用） */
export function collectCourseIds(taskIds: Iterable<string>): Set<number> {
  const out = new Set<number>()
  for (const id of taskIds) {
    const p = parseTaskId(id)
    if (p) out.add(p.courseId)
  }
  return out
}
