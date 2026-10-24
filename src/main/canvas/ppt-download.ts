/**
 * Canvas PPT 课件图片下载 + 合并 PDF
 *
 * 从 v.sjtu "课堂视频new" 的 PPT 切片 API 获取幻灯片图片列表，
 * 并发下载到临时目录后用 pdf-lib 合并为单个 PDF 文件，最后清理临时文件。
 * 支持 cloud/both 模式：生成 PDF 后由 orchestrator 上传云盘（destRoot 空时 PDF 仅作中间产物）。
 */
import { nativeImage } from 'electron'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PDFDocument, type PDFImage } from 'pdf-lib'
import type { PptSlice, PptDownloadOpts, PrivateWorkerConfig } from '../../shared/types'
import { VSJTU_CANVAS_BASE } from '../../shared/types'
import { safeFetch } from './safe-fetch'
import { sanitizeFsName } from '../../shared/utils'
import { wrapWorkerProxyUrl } from '../private-worker'

const VSJTU_REFERER = 'https://v.sjtu.edu.cn/'
/** PPT 图片并发下载数（与 HLS segment 并发一致） */
const PPT_IMG_CONCURRENCY = 5

// ─── 高清 PPT 切片处理与命名工具 ──────────────────────────────

export interface PptSliceItem {
  ivsVideoId: number
  createSec: number
  pptImgUrl: string
}

/** 处理并过滤 PPT 切片列表（过滤 hide === 1 / Number(s.hide) === 0，按 createSec 升序） */
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

/** 格式化切片文件名，例如 '01_00m10s.jpg' */
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

/** 构建 PPT 切片目录名，例如 '高等数学(第1讲)-切片' */
export function buildPptSliceDirName(lectureName: string): string {
  const base = sanitizeFsName(lectureName)
  return `${base}-切片`
}

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

/** 构建单讲 PPT 的文件名（含 .pdf 后缀）。
 *  有 videoSession 时复用课堂视频命名，否则退化为讲次名。
 *  runPptLecture 预算云盘 remotePath 与 downloadPptAsPdf 内部落盘共用此函数，保证两端文件名一致。 */
export function buildPptFileNameForLecture(
  lectureName: string,
  videoSession?: { beginTime: string; teacher: string; classroom: string }
): string {
  return videoSession
    ? buildPptFileName(videoSession)
    : sanitizeFsName(lectureName) + '.pdf'
}

// ─── 获取 PPT 图片列表 ────────────────────────────────────────

/** 获取一讲视频的全部 PPT 幻灯片。
 *  优先调用新版 `v.sjtu.edu.cn/jy-application-resourcemanage/v1/course/ai/ppt`，
 *  若失败则回退至旧版 `query-ppt-slice-es` API。
 *  服务端 code/hide/createSec 字段可能是字符串或数字，统一用 String()/Number() 容错。 */
export async function fetchPptSliceList(
  ses: Electron.Session,
  token: string,
  ivsVideoId: number
): Promise<PptSlice[]> {
  // 1. 优先尝试交大新版科达系统 AI 幻灯片切片 API (GET /v1/course/ai/ppt?courseId=...)
  try {
    const aiUrl = `https://v.sjtu.edu.cn/jy-application-resourcemanage/v1/course/ai/ppt?courseId=${ivsVideoId}`
    const aiResp = await safeFetch(ses, aiUrl, {
      method: 'GET',
      headers: {
        accept: 'application/json, text/plain, */*',
        'jwt-token': token,
        token,
        Referer: VSJTU_REFERER
      }
    })
    if (aiResp && aiResp.ok && typeof aiResp.json === 'function') {
      const json = (await aiResp.json()) as { data?: { docList?: any[] }; code?: unknown }
      const docList = json.data?.docList
      if (Array.isArray(docList) && docList.length > 0) {
        const rawSlices = docList.map(d => ({
          ivsVideoId: Number(d.taskId || ivsVideoId),
          createSec: Number(d.imageSeekTime ?? 0),
          pptImgUrl: String(d.imageUrl || ''),
          hide: d.showFlag === false ? 1 : 0
        }))
        const { slices } = processPptSlices(rawSlices)
        if (slices.length > 0) {
          return slices as unknown as PptSlice[]
        }
      }
    }
  } catch (_aiErr) {
    // 忽略新版 AI 接口探测错误，无缝回退旧版
  }

  // 2. 回退至旧版 query-ppt-slice-es API
  const url = `${VSJTU_CANVAS_BASE}/directOnDemandPlay/vod-analysis/query-ppt-slice-es?ivsVideoId=${ivsVideoId}`
  const resp = await safeFetch(ses, url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      token,
      Referer: VSJTU_REFERER
    }
  })
  const data = (await resp.json()) as { code: string | number; data?: PptSlice[]; message?: string }
  // code 可能是字符串 "0" 或数字 0，统一转字符串比较
  if (String(data.code) !== '0') {
    throw new Error(`query-ppt-slice-es code=${data.code}: ${data.message || ''}`)
  }
  const { slices } = processPptSlices(data.data || [])
  return slices as unknown as PptSlice[]
}

// ─── 下载单张图片 ─────────────────────────────────────────────

/** 通过 ses.fetch 下载单张 PPT 图片到本地（S3 预签名 URL，无需 cookie） */
async function downloadPptImage(
  ses: Electron.Session,
  url: string,
  destPath: string,
  privateWorker?: PrivateWorkerConfig
): Promise<void> {
  const targetUrl = wrapWorkerProxyUrl(url, privateWorker)
  const headers: Record<string, string> = {}
  if (privateWorker?.enabled && privateWorker.authToken?.trim()) {
    headers['Authorization'] = `Bearer ${privateWorker.authToken.trim()}`
  }
  const fetchFn = (ses && typeof ses.fetch === 'function') ? ses.fetch.bind(ses) : fetch
  const resp = await fetchFn(targetUrl, { headers })
  if (!resp.ok) {
    throw new Error(`下载 PPT 图片失败: HTTP ${resp.status}`)
  }
  const arrayBuffer = await resp.arrayBuffer()
  await writeFile(destPath, Buffer.from(arrayBuffer))
}

// ─── 图片合并为 PDF ───────────────────────────────────────────

/** 按图片真实字节判断类型并嵌入：
 * 1. PNG 魔数 (89 50 4E 47) 用 embedPng；
 * 2. JPG 魔数 (FF D8) 用 embedJpg；
 * 3. 其余格式 (WebP, GIF, BMP 等) 通过 Electron nativeImage 转为 PNG Buffer 后用 embedPng 嵌入；
 * 4. 彻底损坏或不可解析的图片返回 null，由上层优雅跳过并保留其余课件。 */
async function embedImage(pdfDoc: PDFDocument, bytes: Buffer): Promise<PDFImage | null> {
  if (!bytes || bytes.length < 4) return null

  // 1. PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    try {
      return await pdfDoc.embedPng(bytes)
    } catch {
      // 容灾转入 nativeImage 兜底
    }
  }

  // 2. JPEG: FF D8
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    try {
      return await pdfDoc.embedJpg(bytes)
    } catch {
      // 容灾转入 nativeImage 兜底
    }
  }

  // 3. WebP / BMP / GIF 或非标格式分流：通过 Electron 内置 nativeImage 转换为标准 PNG Buffer
  try {
    const img = nativeImage.createFromBuffer(bytes)
    if (!img.isEmpty()) {
      const pngBuffer = img.toPNG()
      if (pngBuffer && pngBuffer.length > 0) {
        return await pdfDoc.embedPng(pngBuffer)
      }
    }
  } catch {
    // 无法解析
  }

  return null
}

/** 将本地图片文件列表合并为单个 PDF（每张图一页，16:9 横向，异步非阻塞且具备坏片容灾） */
export async function mergeImagesToPdf(
  imagePaths: string[],
  outputPath: string
): Promise<void> {
  const pdfDoc = await PDFDocument.create()
  let embeddedCount = 0

  for (let i = 0; i < imagePaths.length; i++) {
    const imgPath = imagePaths[i]
    try {
      const imgBytes = await readFile(imgPath)
      const image = await embedImage(pdfDoc, imgBytes)
      if (image) {
        // 标准 16:9 页面（1920×1080 → 960×540 pt，保持宽高比）
        const page = pdfDoc.addPage([960, 540])
        page.drawImage(image, {
          x: 0,
          y: 0,
          width: 960,
          height: 540
        })
        embeddedCount++
      } else {
        console.warn(`[ppt] 第 ${i + 1} 页图片数据无法解析，已优雅跳过并保留其余课件: ${imgPath}`)
      }
    } catch (err) {
      console.warn(`[ppt] 读取第 ${i + 1} 页图片失败，已跳过: ${imgPath} ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 若所有图片均损坏，至少添加一页空白页避免 pdf-lib 保存 0 页抛错
  if (embeddedCount === 0) {
    pdfDoc.addPage([960, 540])
  }

  const pdfBytes = await pdfDoc.save()
  await writeFile(outputPath, pdfBytes)
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
): Promise<{ ok: boolean; skipped?: boolean; path?: string; fileName?: string; imageFolder?: string; error?: string }> {
  const { ivsVideoId, courseName, lectureName, destRoot, term, videoSession, conflictStrategy } = opts
  let tmpDir: string | null = null

  try {
    // 1. 获取 PPT 图片列表
    onProgress?.(0, 0, '获取PPT列表...')
    const slices = await fetchPptSliceList(ses, token, ivsVideoId)
    if (slices.length === 0) {
      // 无 PPT 切片：跳过而非失败（部分课程"课堂视频new"下没有 PPT 课件）
      console.log('[ppt] 该讲没有 PPT 课件，跳过')
      return { ok: true, skipped: true }
    }
    console.log(`[ppt] 获取到 ${slices.length} 张 PPT 图片`)

    // 2. 算落盘路径；local/both（destRoot 非空）+ skip 模式下本地已存在则跳过下载图片
    //    （与常规文件下载一致；cloud-only destRoot 空 → 不检查本地，PDF 仅作上传中间产物）
    const outDir = canvasVideoDir(destRoot, courseName, term)
    mkdirSync(outDir, { recursive: true })
    const fileName = buildPptFileNameForLecture(lectureName, videoSession)
    const outputPath = join(outDir, fileName)
    if (destRoot && conflictStrategy !== 'overwrite' && existsSync(outputPath) && statSync(outputPath).size > 0) {
      console.log(`[ppt] 本地已存在，跳过: ${outputPath}`)
      return { ok: true, skipped: true, path: outputPath, fileName }
    }

    // 3. 创建临时目录（mkdtempSync 原子创建 + 随机后缀，防符号链接预置攻击）
    tmpDir = mkdtempSync(join(tmpdir(), 'sjtu-ppt-'))

    // 4. 并发下载图片（Worker Pool 队列模式，避免分批等待）
    const imagePaths: (string | null)[] = new Array(slices.length).fill(null)
    let downloaded = 0
    let nextIdx = 0

    const workers: Promise<void>[] = []
    const workerCount = Math.min(PPT_IMG_CONCURRENCY, slices.length)

    for (let w = 0; w < workerCount; w++) {
      workers.push((async () => {
        while (nextIdx < slices.length) {
          const idx = nextIdx++
          const s = slices[idx]
          const imgPath = join(tmpDir!, `${String(idx).padStart(4, '0')}.jpg`)
          try {
            await downloadPptImage(ses, s.pptImgUrl, imgPath, opts.privateWorker)
            imagePaths[idx] = imgPath
          } catch (err) {
            console.warn(`[ppt] 下载第 ${idx + 1} 张失败，跳过:`, err instanceof Error ? err.message : err)
          }
          downloaded++
          onProgress?.(downloaded, slices.length, `下载PPT图片 ${downloaded}/${slices.length}…`)
        }
      })())
    }
    await Promise.all(workers)
    const validPaths = imagePaths.filter((p): p is string => !!p)
    if (validPaths.length === 0) {
      return { ok: false, error: '所有PPT图片下载失败' }
    }

    // 5. 合并为 PDF（outputPath / fileName 已在第 2 步算好）
    onProgress?.(slices.length, slices.length, '合并为PDF...')
    await mergeImagesToPdf(validPaths, outputPath)
    console.log(`[ppt] PDF 已保存: ${outputPath}`)

    // 6. 保存高清切片图片到切片目录（saveImages: true 且存在 destRoot）
    let imageFolder: string | undefined
    if (opts.saveImages && destRoot) {
      const sliceDirName = buildPptSliceDirName(lectureName)
      const sliceDir = join(outDir, sliceDirName)
      mkdirSync(sliceDir, { recursive: true })
      for (let i = 0; i < slices.length; i++) {
        const srcPath = imagePaths[i]
        if (srcPath && existsSync(srcPath)) {
          const destImgName = formatSliceFileName(i + 1, Number(slices[i].createSec || 0))
          copyFileSync(srcPath, join(sliceDir, destImgName))
        }
      }
      imageFolder = sliceDir
      console.log(`[ppt] 高清切片图片已保存至: ${sliceDir}`)
    }

    return { ok: true, path: outputPath, fileName, imageFolder }
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

/** 批量独立下载 PPT 切片图片到指定目录 */
export async function downloadPptSlices(
  ses: Electron.Session,
  slices: Array<{ pptImgUrl: string; createSec?: number }>,
  outputDir: string,
  onProgress?: (done: number, total: number) => void,
  privateWorker?: PrivateWorkerConfig
): Promise<string[]> {
  mkdirSync(outputDir, { recursive: true })
  const resultPaths: (string | null)[] = new Array(slices.length).fill(null)
  let downloaded = 0
  let nextIdx = 0

  const workers: Promise<void>[] = []
  const workerCount = Math.min(PPT_IMG_CONCURRENCY, slices.length)

  for (let w = 0; w < workerCount; w++) {
    workers.push((async () => {
      while (nextIdx < slices.length) {
        const idx = nextIdx++
        const s = slices[idx]
        const fileName = formatSliceFileName(idx + 1, Number(s.createSec || 0))
        const destPath = join(outputDir, fileName)
        try {
          await downloadPptImage(ses, s.pptImgUrl, destPath, privateWorker)
          resultPaths[idx] = destPath
        } catch (err) {
          console.warn(`[ppt] 下载切片图片 ${fileName} 失败:`, err)
        }
        downloaded++
        onProgress?.(downloaded, slices.length)
      }
    })())
  }
  await Promise.all(workers)
  return resultPaths.filter((p): p is string => !!p)
}
