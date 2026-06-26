/**
 * Canvas PPT 课件图片下载 + 合并 PDF
 *
 * 从 v.sjtu "课堂视频new" 的 PPT 切片 API 获取幻灯片图片列表，
 * 并发下载到临时目录后用 pdf-lib 合并为单个 PDF 文件，最后清理临时文件。
 * 支持 cloud/both 模式：生成 PDF 后由 orchestrator 上传云盘（destRoot 空时 PDF 仅作中间产物）。
 */
import type Electron from 'electron'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PDFDocument, type PDFImage } from 'pdf-lib'
import type { PptSlice, PptDownloadOpts } from '../../shared/types'
import { VSJTU_CANVAS_BASE } from '../../shared/types'
import { safeFetch } from './safe-fetch'
import { sanitizeFsName } from './api'

const VSJTU_REFERER = 'https://v.sjtu.edu.cn/'
/** PPT 图片并发下载数（与 HLS segment 并发一致） */
const PPT_IMG_CONCURRENCY = 5

/** 构建课堂视频同目录路径：{destRoot}/Canvas课程/{term}/{courseName}/videos/课堂视频/
 *  destRoot 为空（cloud-only）时落到系统临时目录，PDF 仅作上传中间产物。 */
function canvasVideoDir(destRoot: string, courseName: string, term?: string): string {
  const base = destRoot || tmpdir()
  const parts = [base, 'Canvas课程']
  if (term) parts.push(sanitizeFsName(term))
  parts.push(sanitizeFsName(courseName), 'videos', '课堂视频')
  return join(...parts)
}

/** 构建与课堂视频一致的 PPT 文件名：{时间戳}-{教师}-{教室}-PPT课件.pdf */
export function buildPptFileName(session: { beginTime: string; teacher: string; classroom: string }): string {
  let t = session.beginTime.replace(/:/g, '-').replace(' ', '_')
  const parts = t.split('-')
  if (parts.length >= 5) t = parts.slice(0, 4).join('-')
  return sanitizeFsName(`${t}-${session.teacher}-${session.classroom}-PPT课件`) + '.pdf'
}

// ─── 获取 PPT 图片列表 ────────────────────────────────────────

/** 调用 query-ppt-slice-es API 获取一讲视频的全部 PPT 幻灯片。
 *  服务端 code/hide/createSec 字段可能是字符串或数字，统一用 String()/Number() 容错。 */
export async function fetchPptSliceList(
  ses: Electron.Session,
  token: string,
  ivsVideoId: number
): Promise<PptSlice[]> {
  const url = `${VSJTU_CANVAS_BASE}/directOnDemandPlay/vod-analysis/query-ppt-slice-es?ivsVideoId=${ivsVideoId}`
  const resp = await safeFetch(ses, url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      token,
      Referer: VSJTU_REFERER
    }
  })
  const data = await resp.json() as { code: string | number; data?: PptSlice[]; message?: string }
  // code 可能是字符串 "0" 或数字 0，统一转字符串比较
  if (String(data.code) !== '0') {
    throw new Error(`query-ppt-slice-es code=${data.code}: ${data.message || ''}`)
  }
  // 只保留未隐藏且有图片 URL 的切片，按视频秒数排序
  return (data.data || [])
    .filter(s => s && s.pptImgUrl && Number(s.hide) === 0)
    .sort((a, b) => Number(a.createSec) - Number(b.createSec))
}

// ─── 下载单张图片 ─────────────────────────────────────────────

/** 通过 ses.fetch 下载单张 PPT 图片到本地（S3 预签名 URL，无需 cookie） */
async function downloadPptImage(
  ses: Electron.Session,
  url: string,
  destPath: string
): Promise<void> {
  const resp = await ses.fetch(url)
  if (!resp.ok) {
    throw new Error(`下载 PPT 图片失败: HTTP ${resp.status}`)
  }
  const arrayBuffer = await resp.arrayBuffer()
  writeFileSync(destPath, Buffer.from(arrayBuffer))
}

// ─── 图片合并为 PDF ───────────────────────────────────────────

/** 按图片真实字节判断类型并嵌入：PNG 用 embedPng，其余按 JPG 处理。
 *  课堂视频截图默认是 JPG，但服务端可能返回 PNG；embedJpg 遇到 PNG 会抛错，故按字节分流。 */
async function embedImage(pdfDoc: PDFDocument, bytes: Buffer): Promise<PDFImage> {
  // PNG 魔数：89 50 4E 47（.PNG）；JPG 魔数：FF D8 FF
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return pdfDoc.embedPng(bytes)
  }
  return pdfDoc.embedJpg(bytes)
}

/** 将本地图片文件列表合并为单个 PDF（每张图一页，16:9 横向） */
export async function mergeImagesToPdf(
  imagePaths: string[],
  outputPath: string
): Promise<void> {
  const pdfDoc = await PDFDocument.create()

  for (const imgPath of imagePaths) {
    const imgBytes = readFileSync(imgPath)
    const image = await embedImage(pdfDoc, imgBytes)
    // 标准 16:9 页面（1920×1080 → 960×540 pt，保持宽高比）
    const page = pdfDoc.addPage([960, 540])
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: 960,
      height: 540
    })
  }

  const pdfBytes = await pdfDoc.save()
  writeFileSync(outputPath, pdfBytes)
}

// ─── 完整流程 ─────────────────────────────────────────────────

export type PptProgressCallback = (current: number, total: number, phase: string) => void

/** 完整流程：获取图片列表 → 并发下载 → 合并 PDF → 清理临时文件。
 *  destRoot 为空（cloud-only）时使用系统临时目录，PDF 仅作上传中间产物。
 *  返回 { ok, path, fileName }：path 为本地 PDF 绝对路径，fileName 用于云盘远端路径。
 *  临时目录在 finally 中递归清理，确保部分失败/异常也不残留图片。 */
export async function downloadPptAsPdf(
  ses: Electron.Session,
  token: string,
  opts: PptDownloadOpts,
  onProgress?: PptProgressCallback
): Promise<{ ok: boolean; path?: string; fileName?: string; error?: string }> {
  const { ivsVideoId, courseName, lectureName, destRoot, term, videoSession } = opts
  let tmpDir: string | null = null

  try {
    // 1. 获取 PPT 图片列表
    onProgress?.(0, 0, '获取PPT列表...')
    const slices = await fetchPptSliceList(ses, token, ivsVideoId)
    if (slices.length === 0) {
      return { ok: false, error: '该讲没有PPT课件' }
    }
    console.log(`[ppt] 获取到 ${slices.length} 张 PPT 图片`)

    // 2. 创建临时目录
    tmpDir = join(tmpdir(), `sjtu-ppt-${ivsVideoId}-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })

    // 3. 并发下载图片（保留序号，合并时按序）
    const imagePaths: (string | null)[] = new Array(slices.length).fill(null)
    let downloaded = 0
    for (let i = 0; i < slices.length; i += PPT_IMG_CONCURRENCY) {
      const batch = slices.slice(i, i + PPT_IMG_CONCURRENCY)
      await Promise.all(batch.map(async (s, j) => {
        const idx = i + j
        // 临时文件名扩展名无关紧要（嵌入时按字节判断类型），统一用 .jpg
        const imgPath = join(tmpDir!, `${String(idx).padStart(4, '0')}.jpg`)
        try {
          await downloadPptImage(ses, s.pptImgUrl, imgPath)
          imagePaths[idx] = imgPath
        } catch (err) {
          console.warn(`[ppt] 下载第 ${idx + 1} 张失败，跳过:`, err instanceof Error ? err.message : err)
        }
        downloaded++
        onProgress?.(downloaded, slices.length, `下载PPT图片 ${downloaded}/${slices.length}…`)
      }))
    }
    const validPaths = imagePaths.filter((p): p is string => !!p)
    if (validPaths.length === 0) {
      return { ok: false, error: '所有PPT图片下载失败' }
    }

    // 4. 合并为 PDF（与课堂视频同目录；cloud-only 时落到临时目录）
    onProgress?.(slices.length, slices.length, '合并为PDF...')
    const outDir = canvasVideoDir(destRoot, courseName, term)
    mkdirSync(outDir, { recursive: true })
    const fileName = videoSession
      ? buildPptFileName(videoSession)
      : sanitizeFsName(lectureName) + '.pdf'
    const outputPath = join(outDir, fileName)

    await mergeImagesToPdf(validPaths, outputPath)
    console.log(`[ppt] PDF 已保存: ${outputPath}`)

    return { ok: true, path: outputPath, fileName }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ppt] 下载失败:', msg)
    return { ok: false, error: msg }
  } finally {
    // 无论成功 / 失败 / 部分图片失败，递归清理整个临时目录（含未删尽的图片）
    if (tmpDir) {
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }
}
