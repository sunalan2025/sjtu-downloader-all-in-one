#!/usr/bin/env node
/**
 * 交大课程下载器 · 校内私有委托代传服务守护进程 (Private Worker Daemon)
 *
 * 特性：
 * 1. 零第三方依赖 (Zero external dependencies)，仅使用 Node.js 原生 http 模块
 * 2. 支持环境变量与命令行参数配置端口与鉴权 Token
 * 3. 支持跨域 CORS 与心跳健康检查 (/health)
 * 4. 严格单租户内存安全原则，用完即焚
 *
 * 运行方式：
 *   npm run worker:start
 *   或：node scripts/private-worker-daemon.mjs [PORT] [TOKEN]
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PORT = parseInt(process.env.PORT || process.argv[2] || '6880', 10)
const HOST = process.env.HOST || '127.0.0.1'
const AUTH_TOKEN = (process.env.WORKER_TOKEN || process.argv[3] || '').trim()
const VERSION = '1.0.0'

if (HOST === '0.0.0.0' || (!HOST.startsWith('127.') && HOST !== 'localhost')) {
  if (!AUTH_TOKEN || AUTH_TOKEN.length < 16) {
    console.error('[worker:security] 致命错误：外部网络监听 (0.0.0.0) 必须配置强 WORKER_TOKEN（长度 >= 16 位）')
    process.exit(1)
  }
}

const tasks = new Map()
const MAX_CONCURRENT_TASKS = 5
const MAX_QUEUE_SIZE = 100
const TASK_TTL_MS = 3600 * 1000 // 1 hour TTL
const MAX_TASKS_MAP_SIZE = 200

const taskQueue = []
let runningCount = 0

function isTerminalStatus(status) {
  return status === 'completed' || status === 'done' || status === 'error' || status === 'cancelled' || status === 'skipped'
}

function pruneExpiredTasks(now = Date.now()) {
  // 1. 淘汰已完成且超过 3600 秒 (1 小时) 的终态任务记录
  for (const [id, task] of tasks.entries()) {
    const isTerminal = Boolean(task.completedAt || isTerminalStatus(task.status))
    if (isTerminal) {
      const termTime = task.completedAt || task.receivedAt || 0
      if (termTime > 0 && (now - termTime > TASK_TTL_MS)) {
        tasks.delete(id)
      }
    }
  }

  // 2. 若任务表总条数超过 200，按 completedAt 从旧到新淘汰已终态任务直至 tasks.size <= 200
  if (tasks.size > MAX_TASKS_MAP_SIZE) {
    const terminalTasks = []
    for (const [id, task] of tasks.entries()) {
      if (task.completedAt || isTerminalStatus(task.status)) {
        terminalTasks.push({ id, completedAt: task.completedAt || task.receivedAt || 0 })
      }
    }
    terminalTasks.sort((a, b) => a.completedAt - b.completedAt)

    for (const item of terminalTasks) {
      if (tasks.size <= MAX_TASKS_MAP_SIZE) break
      tasks.delete(item.id)
    }
  }
}

if (typeof setInterval === 'function') {
  const pruneTimer = setInterval(() => {
    pruneExpiredTasks()
  }, 60 * 1000)
  if (pruneTimer && typeof pruneTimer.unref === 'function') {
    pruneTimer.unref()
  }
}

function sanitizeLog(val, maxLen = 120) {
  if (typeof val !== 'string') return ''
  return val.replace(/[\r\n\x00-\x1f\x7f-\x9f]/g, '_').slice(0, maxLen)
}

function expandHomeDir(p) {
  if (!p || typeof p !== 'string') return path.join(os.homedir(), 'downloads')
  const trimmed = p.trim()
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }
  return path.resolve(trimmed)
}

const SERVER_DOWNLOAD_ROOT = path.resolve(expandHomeDir(process.env.WORKER_DOWNLOAD_ROOT || '~/sjtu-downloads'))

function isAllowedTargetUrl(rawUrl) {
  try {
    const u = new URL(rawUrl)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    const hostname = u.hostname.toLowerCase()
    // 封禁回环与私网 IP 及 localhost
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|localhost|::1)/i.test(hostname)) {
      return false
    }
    // 仅允许交大官方及认证平台域名
    return /(^|\.)(sjtu\.edu\.cn|sjtu\.cn|cnmooc\.org)$/i.test(hostname)
  } catch {
    return false
  }
}

function sanitizePathSegment(segment, fallback = 'default') {
  if (typeof segment !== 'string') return fallback
  const cleaned = segment
    .replace(/[\\/:*?"<>|\x00-\x1f\x7f-\x9f]/g, '_')
    .replace(/\.{2,}/g, '_')
    .trim()
  return cleaned || fallback
}

function getJpegSize(buf) {
  let i = 2
  while (i < buf.length - 8) {
    if (buf[i] !== 0xFF) { i++; continue }
    const marker = buf[i + 1]
    if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    }
    const len = buf.readUInt16BE(i + 2)
    i += 2 + len
  }
  return { width: 1920, height: 1080 }
}

function createPdfFromJpegBuffers(images) {
  const chunks = []
  const offsets = []
  let byteOffset = 0

  function write(strOrBuf) {
    const b = Buffer.isBuffer(strOrBuf) ? strOrBuf : Buffer.from(strOrBuf, 'latin1')
    chunks.push(b)
    byteOffset += b.length
  }

  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')

  const pageObjIds = []
  let nextId = 3
  const pageSpecs = []
  for (const img of images) {
    const pageId = nextId++
    const contentId = nextId++
    const imgId = nextId++
    pageObjIds.push(pageId)
    pageSpecs.push({ pageId, contentId, imgId, ...img })
  }

  offsets[1] = byteOffset
  write('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

  offsets[2] = byteOffset
  write(`2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map(id => id + ' 0 R').join(' ')}] /Count ${pageObjIds.length} >>\nendobj\n`)

  for (const spec of pageSpecs) {
    const w = spec.width || 1920
    const h = spec.height || 1080

    offsets[spec.pageId] = byteOffset
    write(`${spec.pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im1 ${spec.imgId} 0 R >> >> /Contents ${spec.contentId} 0 R >>\nendobj\n`)

    const streamContent = `q ${w} 0 0 ${h} 0 0 cm /Im1 Do Q`
    offsets[spec.contentId] = byteOffset
    write(`${spec.contentId} 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`)

    offsets[spec.imgId] = byteOffset
    write(`${spec.imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${spec.buf.length} >>\nstream\n`)
    write(spec.buf)
    write('\nendstream\nendobj\n')
  }

  const startXref = byteOffset
  const totalObjs = nextId
  write(`xref\n0 ${totalObjs}\n0000000000 65535 f \n`)
  for (let i = 1; i < totalObjs; i++) {
    const off = String(offsets[i] || 0).padStart(10, '0')
    write(`${off} 00000 n \n`)
  }

  write(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`)

  return Buffer.concat(chunks)
}

function strictEncodeURIComponent(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function encCloudPath(segments) {
  return segments.map(strictEncodeURIComponent).join('/')
}

async function getCloudSpaceCred(userToken) {
  const url = `https://pan.sjtu.edu.cn/user/v1/space/1/personal?user_token=${encodeURIComponent(userToken)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Accept': 'application/json, text/plain, */*' }
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`获取交大云盘空间凭据失败: HTTP ${res.status} ${text.slice(0, 150)}`)
  }
  return await res.json()
}

async function ensureCloudFolders(cred, folderSegments) {
  if (!Array.isArray(folderSegments) || folderSegments.length === 0) return
  for (let i = 1; i <= folderSegments.length; i++) {
    const segs = folderSegments.slice(0, i)
    const pathStr = encCloudPath(segs)
    const url = `https://pan.sjtu.edu.cn/api/v1/directory/${cred.libraryId}/${cred.spaceId}/${pathStr}?conflict_resolution_strategy=ask&access_token=${cred.accessToken}`
    try {
      await fetch(url, {
        method: 'PUT',
        headers: { 'Accept': 'application/json, text/plain, */*' }
      })
    } catch {
      // 容忍目录已存在或并发创建错误
    }
  }
}

async function checkCloudFileExists(cred, filePathSegments) {
  const pathStr = encCloudPath(filePathSegments)
  const url = `https://pan.sjtu.edu.cn/api/v1/file/${cred.libraryId}/${cred.spaceId}/${pathStr}?access_token=${cred.accessToken}`
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

async function deleteCloudFile(cred, filePathSegments) {
  const pathStr = encCloudPath(filePathSegments)
  const url = `https://pan.sjtu.edu.cn/api/v1/file/${cred.libraryId}/${cred.spaceId}/${pathStr}?permanent=0&access_token=${cred.accessToken}`
  try {
    await fetch(url, { method: 'DELETE' })
  } catch {
    // 忽略删除失败
  }
}

async function uploadToCloudPanAsync(task, payload) {
  if (!payload.cloudUserToken || typeof payload.cloudUserToken !== 'string' || !payload.cloudUserToken.trim()) {
    task.status = 'error'
    task.completedAt = Date.now()
    task.error = '云盘转存失败：缺少有效的交大云盘授权凭据，请在设置中重新登录云盘'
    throw new Error(task.error)
  }

  task.status = 'uploading'
  task.startedAt = Date.now()

  let segments = []
  if (payload.destPath) {
    segments = payload.destPath.replace(/^\/+/, '').split('/').filter(Boolean)
  }
  if (segments.length === 0) {
    segments = [
      payload.courseName || '未分类课程',
      payload.categoryName || '课件资料',
      payload.fileName || 'file'
    ]
  }

  const folderSegments = segments.slice(0, -1)
  const fileName = segments[segments.length - 1]
  const cred = await getCloudSpaceCred(payload.cloudUserToken)

  await ensureCloudFolders(cred, folderSegments)

  if (payload.conflictStrategy === 'overwrite') {
    await deleteCloudFile(cred, segments)
  } else {
    const exists = await checkCloudFileExists(cred, segments)
    if (exists) {
      task.status = 'completed'
      task.completedAt = Date.now()
      task.receivedBytes = task.totalBytes || payload.fileSize || 0
      task.targetPath = segments.join('/')
      const safeTaskId = sanitizeLog(task.taskId, 64)
      const safeTarget = sanitizeLog(task.targetPath, 128)
      console.log(`[worker] 云盘已存在同名文件，跳过直传: ${safeTaskId} -> ${safeTarget}`)
      return
    }
  }

  const filePathStr = encCloudPath(segments)
  const initUrl = `https://pan.sjtu.edu.cn/api/v1/file/${cred.libraryId}/${cred.spaceId}/${filePathStr}?multipart&conflict_resolution_strategy=ask&access_token=${cred.accessToken}`
  const initRes = await fetch(initUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      partNumberRange: Array.from({ length: 100 }, (_, i) => i + 1)
    }),
    signal: task.abortController?.signal
  })

  if (!initRes.ok) {
    const errText = await initRes.text()
    if (initRes.status === 409 || errText.includes('SameNameDirectoryOrFileExists')) {
      task.status = 'completed'
      task.completedAt = Date.now()
      task.receivedBytes = task.totalBytes || payload.fileSize || 0
      task.targetPath = segments.join('/')
      return
    }
    throw new Error(`初始化云盘分片上传失败: HTTP ${initRes.status} ${errText.slice(0, 120)}`)
  }

  const initData = await initRes.json()
  const partsMap = new Map()
  if (Array.isArray(initData.parts)) {
    for (const p of initData.parts) partsMap.set(p.partNumber, p)
  }

  async function putChunk(buf, partNum) {
    let part = partsMap.get(partNum)
    if (!part) {
      const renewUrl = `https://pan.sjtu.edu.cn/api/v1/file/${cred.libraryId}/${cred.spaceId}/${initData.confirmKey}?renew&access_token=${cred.accessToken}`
      const renewRes = await fetch(renewUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          partNumberRange: Array.from({ length: 100 }, (_, i) => partNum + i)
        }),
        signal: task.abortController?.signal
      })
      if (!renewRes.ok) {
        throw new Error(`续订分片上传直链失败: HTTP ${renewRes.status}`)
      }
      const renewData = await renewRes.json()
      if (Array.isArray(renewData.parts)) {
        for (const p of renewData.parts) partsMap.set(p.partNumber, p)
      }
      part = partsMap.get(partNum)
    }
    if (!part) {
      throw new Error(`未获取到分片 ${partNum} 的上传地址`)
    }

    let lastPutErr = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const putRes = await fetch(part.url, {
          method: 'PUT',
          headers: {
            'Content-Length': String(buf.length)
          },
          body: buf,
          signal: task.abortController?.signal
        })
        if (putRes.ok || putRes.status === 200 || putRes.status === 204) {
          return
        }
        throw new Error(`COS PUT 分片失败 HTTP ${putRes.status}`)
      } catch (err) {
        lastPutErr = err
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
    throw lastPutErr
  }

  const CHUNK_SIZE = 4 * 1024 * 1024

  if (Array.isArray(payload.slices) && payload.slices.length > 0) {
    // 多切片（PPT 课件直接在服务器内存中合成并直传云盘）
    const imageBuffers = []
    let receivedBytes = 0
    const isPdf = (payload.fileName || '').toLowerCase().endsWith('.pdf')

    for (let i = 0; i < payload.slices.length; i++) {
      const slice = payload.slices[i]
      const res = await fetch(slice.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SJTU-Downloader-Worker/1.0'
        },
        signal: task.abortController?.signal
      })
      if (!res.ok) {
        throw new Error(`切片 ${i + 1}/${payload.slices.length} 下载失败: HTTP ${res.status}`)
      }
      const arrayBuf = await res.arrayBuffer()
      const buf = Buffer.from(arrayBuf)
      receivedBytes += buf.length

      if (isPdf) {
        const size = getJpegSize(buf)
        imageBuffers.push({ buf, width: size.width, height: size.height })
      }
    }

    let uploadDataBuffer = null
    if (isPdf && imageBuffers.length > 0) {
      uploadDataBuffer = createPdfFromJpegBuffers(imageBuffers)
    } else if (imageBuffers.length > 0) {
      uploadDataBuffer = imageBuffers[0].buf
    }

    if (uploadDataBuffer) {
      task.totalBytes = uploadDataBuffer.length
      let offset = 0
      let partNum = 1
      let lastTime = Date.now()
      let lastBytes = 0

      while (offset < uploadDataBuffer.length) {
        const end = Math.min(offset + CHUNK_SIZE, uploadDataBuffer.length)
        const chunk = uploadDataBuffer.subarray(offset, end)
        await putChunk(chunk, partNum++)
        offset = end
        task.receivedBytes = offset
        const now = Date.now()
        const elapsed = (now - lastTime) / 1000
        if (elapsed >= 0.5) {
          task.speed = Math.round((offset - lastBytes) / elapsed)
          lastTime = now
          lastBytes = offset
        }
      }
    }
  } else if (payload.url) {
    // 单文件直下流式直传
    const response = await fetch(payload.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SJTU-Downloader-Worker/1.0'
      },
      signal: task.abortController?.signal
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }

    const contentLength = Number(response.headers.get('content-length') || 0)
    if (contentLength > 0) {
      task.totalBytes = contentLength
    }

    let accumulated = []
    let accumulatedLen = 0
    let partNum = 1
    let totalUploaded = 0
    let lastTime = Date.now()
    let lastBytes = 0

    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunkBuf = Buffer.from(value)
      accumulated.push(chunkBuf)
      accumulatedLen += chunkBuf.length

      while (accumulatedLen >= CHUNK_SIZE) {
        const combined = Buffer.concat(accumulated)
        const partBuf = combined.subarray(0, CHUNK_SIZE)
        const remainder = combined.subarray(CHUNK_SIZE)
        accumulated = remainder.length > 0 ? [remainder] : []
        accumulatedLen = remainder.length

        await putChunk(partBuf, partNum++)
        totalUploaded += partBuf.length
        task.receivedBytes = totalUploaded
        const now = Date.now()
        const elapsed = (now - lastTime) / 1000
        if (elapsed >= 0.5) {
          task.speed = Math.round((totalUploaded - lastBytes) / elapsed)
          lastTime = now
          lastBytes = totalUploaded
        }
      }
    }

    if (accumulatedLen > 0) {
      const partBuf = Buffer.concat(accumulated)
      accumulated = []
      accumulatedLen = 0
      await putChunk(partBuf, partNum++)
      totalUploaded += partBuf.length
      task.receivedBytes = totalUploaded
    }
  } else {
    throw new Error('未提供可转存的媒体 URL 或切片列表')
  }

  // 确认上传完成
  const confirmUrl = `https://pan.sjtu.edu.cn/api/v1/file/${cred.libraryId}/${cred.spaceId}/${initData.confirmKey}?confirm&access_token=${cred.accessToken}`
  const confirmRes = await fetch(confirmUrl, {
    method: 'POST',
    headers: { 'Accept': 'application/json' },
    signal: task.abortController?.signal
  })
  if (!confirmRes.ok) {
    const confErr = await confirmRes.text()
    throw new Error(`确认云盘上传失败: HTTP ${confirmRes.status} ${confErr.slice(0, 120)}`)
  }

  task.status = 'completed'
  task.completedAt = Date.now()
  task.speed = 0
  task.targetPath = segments.join('/')
  const safeTaskId = sanitizeLog(task.taskId, 64)
  const safeTarget = sanitizeLog(task.targetPath, 128)
  console.log(`[worker] 任务 ${safeTaskId} 已在远端成功直传交大云盘: ${safeTarget} (${task.receivedBytes} bytes)`)
}

async function executeTaskAsync(task, payload) {
  task.startedAt = Date.now()
  task.abortController = new AbortController()
  let partPath = null
  let fileStream = null

  try {
    if (!payload.url && (!Array.isArray(payload.slices) || payload.slices.length === 0)) {
      throw new Error('未提供可下载的媒体 URL 或切片列表')
    }
    if (typeof payload.url === 'string' && payload.url.includes('.m3u8')) {
      throw new Error('中转服务器暂不支持 HLS (.m3u8) 流直传，请使用本地下载模式')
    }

    if (task.storageMode === 'server_local' && task.resolvedPath) {
      if (payload.conflictStrategy === 'skip' && fs.existsSync(task.resolvedPath)) {
        task.status = 'skipped'
        task.completedAt = Date.now()
        task.speed = 0
        task.receivedBytes = 0
        const safeTaskId = sanitizeLog(task.taskId, 64)
        const safePath = sanitizeLog(task.resolvedPath, 128)
        console.log(`[worker] 任务 ${safeTaskId} 目标已存在且策略为 skip，跳过下载: ${safePath}`)
        return
      }

      task.status = 'downloading'
      if (Array.isArray(payload.slices) && payload.slices.length > 0) {
        // 多切片（如 PPT 课件多张图片批量拉取并合成 PDF）
        const imageBuffers = []
        let receivedBytes = 0
        const isPdf = (payload.fileName || '').toLowerCase().endsWith('.pdf')
        const sliceDir = path.join(path.dirname(task.resolvedPath), path.parse(task.resolvedPath).name + '_images')

        if (payload.saveImages) {
          fs.mkdirSync(sliceDir, { recursive: true })
        }

        let lastTime = Date.now()
        let lastBytes = 0

        for (let i = 0; i < payload.slices.length; i++) {
          const slice = payload.slices[i]
          const res = await fetch(slice.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SJTU-Downloader-Worker/1.0'
            },
            signal: task.abortController.signal
          })
          if (!res.ok) {
            throw new Error(`切片 ${i + 1}/${payload.slices.length} 下载失败: HTTP ${res.status}`)
          }
          const arrayBuf = await res.arrayBuffer()
          const buf = Buffer.from(arrayBuf)
          receivedBytes += buf.length
          task.receivedBytes = receivedBytes

          const now = Date.now()
          const elapsed = (now - lastTime) / 1000
          if (elapsed >= 0.5) {
            task.speed = Math.round((receivedBytes - lastBytes) / elapsed)
            lastTime = now
            lastBytes = receivedBytes
          }

          if (payload.saveImages) {
            const pageNum = String(i + 1).padStart(3, '0')
            fs.writeFileSync(path.join(sliceDir, `slide_${pageNum}.jpg`), buf)
          }

          if (isPdf) {
            const size = getJpegSize(buf)
            imageBuffers.push({ buf, width: size.width, height: size.height })
          }
        }

        if (isPdf && imageBuffers.length > 0) {
          const pdfBuf = createPdfFromJpegBuffers(imageBuffers)
          fs.writeFileSync(task.resolvedPath, pdfBuf)
        }

        task.status = 'completed'
        task.completedAt = Date.now()
        task.speed = 0
        const safeTaskId = sanitizeLog(task.taskId, 64)
        const safePath = sanitizeLog(task.resolvedPath, 128)
        console.log(`[worker] PPT 任务 ${safeTaskId} (${payload.slices.length} 讲切片) 已成功${isPdf ? '编译为 PDF 并' : ''}保存至: ${safePath} (${receivedBytes} bytes)`)
      } else if (payload.url) {
        // 单文件直下落地
        const response = await fetch(payload.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SJTU-Downloader-Worker/1.0'
          },
          signal: task.abortController.signal
        })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`)
        }
        const contentLength = Number(response.headers.get('content-length') || 0)
        if (contentLength > 0) {
          task.totalBytes = contentLength
        }

        partPath = task.resolvedPath + '.part'
        fileStream = fs.createWriteStream(partPath)
        let streamError = null
        fileStream.on('error', (err) => {
          streamError = err
        })

        const reader = response.body.getReader()
        let receivedBytes = 0
        let lastTime = Date.now()
        let lastBytes = 0

        while (true) {
          if (streamError) throw streamError
          const { done, value } = await reader.read()
          if (done) break
          if (!fileStream.write(Buffer.from(value))) {
            await new Promise((resolve, reject) => {
              fileStream.once('drain', resolve)
              fileStream.once('error', reject)
            })
          }
          if (streamError) throw streamError
          receivedBytes += value.length
          task.receivedBytes = receivedBytes
          const now = Date.now()
          const elapsed = (now - lastTime) / 1000
          if (elapsed >= 0.5) {
            task.speed = Math.round((receivedBytes - lastBytes) / elapsed)
            lastTime = now
            lastBytes = receivedBytes
          }
        }

        await new Promise((resolve, reject) => {
          if (streamError) return reject(streamError)
          fileStream.on('finish', resolve)
          fileStream.on('error', reject)
          fileStream.end()
        })
        fs.renameSync(partPath, task.resolvedPath)
        partPath = null

        task.status = 'completed'
        task.completedAt = Date.now()
        task.speed = 0
        const safeTaskId = sanitizeLog(task.taskId, 64)
        const safePath = sanitizeLog(task.resolvedPath, 128)
        console.log(`[worker] 任务 ${safeTaskId} 已成功下载并保存至: ${safePath} (${receivedBytes} bytes)`)
      } else {
        throw new Error('未提供有效的下载链接')
      }
    } else if (task.storageMode === 'cloudpan') {
      await uploadToCloudPanAsync(task, payload)
    } else {
      throw new Error(`不支持的存储模式: ${task.storageMode}`)
    }
  } catch (err) {
    if (fileStream && !fileStream.destroyed) {
      try {
        fileStream.destroy()
      } catch {}
    }
    if (partPath) {
      try {
        if (fs.existsSync(partPath)) {
          fs.unlinkSync(partPath)
        }
      } catch {}
    }
    task.completedAt = task.completedAt || Date.now()
    if (task.abortController?.signal?.aborted) {
      task.status = 'cancelled'
    } else {
      task.status = 'error'
      task.error = err instanceof Error ? err.message : String(err)
      const safeTaskId = sanitizeLog(task.taskId, 64)
      console.error(`[worker] 任务 ${safeTaskId} 执行失败: ${sanitizeLog(task.error)}`)
    }
    task.speed = 0
    throw err
  }
}

function runTask(taskRecord, payload) {
  runningCount++
  executeTaskAsync(taskRecord, payload)
    .catch(err => {
      console.error('[worker] 执行任务异常:', sanitizeLog(err?.message || String(err)))
    })
    .finally(() => {
      runningCount--
      scheduleWorkerQueue()
    })
}

function scheduleWorkerQueue() {
  while (runningCount < MAX_CONCURRENT_TASKS && taskQueue.length > 0) {
    const next = taskQueue.shift()
    if (!next) break
    if (next.taskRecord.status === 'cancelled') {
      continue
    }
    runTask(next.taskRecord, next.payload)
  }
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Length': Buffer.byteLength(body)
  })
  res.end(body)
}

function verifyAuth(req) {
  if (!AUTH_TOKEN) return true
  const authHeader = req.headers?.['authorization'] || ''
  return authHeader === `Bearer ${AUTH_TOKEN}` || authHeader === AUTH_TOKEN
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    })
    return res.end()
  }

  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const pathname = parsedUrl.pathname

  // 1. 心跳与健康探测接口
  if (pathname === '/health' || pathname === '/') {
    if (!verifyAuth(req)) {
      return sendJson(res, 401, {
        ok: false,
        error: '授权失败：访问授权密钥 (Token) 不匹配'
      })
    }
    return sendJson(res, 200, {
      status: 'ok',
      server: 'sjtu-private-worker',
      version: VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      activeTasks: tasks.size,
      runningTasks: runningCount,
      queuedTasks: taskQueue.length
    })
  }

  // 2. 派发代传任务接口
  if (pathname === '/api/tasks' && req.method === 'POST') {
    if (!verifyAuth(req)) {
      return sendJson(res, 401, { ok: false, error: 'Unauthorized' })
    }

    pruneExpiredTasks()

    let rawBody = ''
    req.on('data', chunk => {
      rawBody += chunk
      if (rawBody.length > 1024 * 1024) {
        req.destroy()
      }
    })

    req.on('end', () => {
      if (taskQueue.length >= MAX_QUEUE_SIZE) {
        return sendJson(res, 429, {
          ok: false,
          error: '中转服务器过载：当前排队任务已达上限 (100)，请稍后再试'
        })
      }

      try {
        const payload = JSON.parse(rawBody || '{}')
        if (!payload.url && (!Array.isArray(payload.slices) || payload.slices.length === 0)) {
          return sendJson(res, 400, {
            ok: false,
            error: '任务缺少有效的媒体直链或切片列表'
          })
        }
        if (typeof payload.url === 'string' && payload.url.includes('.m3u8')) {
          return sendJson(res, 400, {
            ok: false,
            error: '中转服务器暂不支持 HLS (.m3u8) 流直传，请使用本地下载模式'
          })
        }
        const taskId = payload.taskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        const isServerLocal = payload.storageMode === 'server_local'
        let targetPath = payload.destPath || ''
        let resolvedLocalPath = null

        if (isServerLocal) {
          const safeCourse = sanitizePathSegment(payload.courseName, '未分类课程')
          const safeCategory = sanitizePathSegment(payload.categoryName, '其它资料')
          const safeFileName = sanitizePathSegment(payload.fileName, '未命名文件')

          if (payload.courseName && (payload.courseName.includes('..') || payload.courseName.startsWith('/') || payload.courseName.startsWith('\\'))) {
            return sendJson(res, 400, {
              ok: false,
              error: '存储路径无效：禁止访问受保护的根目录以外路径'
            })
          }
          if (payload.categoryName && (payload.categoryName.includes('..') || payload.categoryName.startsWith('/') || payload.categoryName.startsWith('\\'))) {
            return sendJson(res, 400, {
              ok: false,
              error: '存储路径无效：禁止访问受保护的根目录以外路径'
            })
          }
          if (payload.fileName && (payload.fileName.includes('..') || payload.fileName.startsWith('/') || payload.fileName.startsWith('\\'))) {
            return sendJson(res, 400, {
              ok: false,
              error: '存储路径无效：禁止访问受保护的根目录以外路径'
            })
          }
          if (payload.serverDownloadDir) {
            const rawSub = path.resolve(SERVER_DOWNLOAD_ROOT, payload.serverDownloadDir)
            const normRawSub = path.normalize(rawSub)
            const isSubInside = process.platform === 'win32'
              ? normRawSub.toLowerCase().startsWith(SERVER_DOWNLOAD_ROOT.toLowerCase())
              : normRawSub.startsWith(SERVER_DOWNLOAD_ROOT)
            if (!isSubInside) {
              return sendJson(res, 400, {
                ok: false,
                error: '存储路径无效：禁止访问受保护的根目录以外路径'
              })
            }
          }

          const targetDir = path.resolve(SERVER_DOWNLOAD_ROOT, safeCourse, safeCategory)
          const normalizedTarget = path.normalize(targetDir)
          const isTargetInside = process.platform === 'win32'
            ? normalizedTarget.toLowerCase().startsWith(SERVER_DOWNLOAD_ROOT.toLowerCase())
            : normalizedTarget.startsWith(SERVER_DOWNLOAD_ROOT)

          if (!isTargetInside) {
            return sendJson(res, 400, {
              ok: false,
              error: '存储路径无效：禁止访问受保护的根目录以外路径'
            })
          }

          try {
            fs.mkdirSync(targetDir, { recursive: true })
          } catch (mkdirErr) {
            return sendJson(res, 500, {
              ok: false,
              error: `创建存储目录失败: ${mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr)}`
            })
          }

          resolvedLocalPath = path.join(targetDir, safeFileName)
          targetPath = resolvedLocalPath
        }

        const taskRecord = {
          taskId,
          fileName: payload.fileName || 'unknown',
          storageMode: payload.storageMode || 'cloudpan',
          status: 'queued',
          receivedBytes: 0,
          totalBytes: payload.fileSize || 0,
          speed: 0,
          receivedAt: Date.now(),
          targetPath,
          ...(resolvedLocalPath ? { resolvedPath: resolvedLocalPath } : {})
        }
        tasks.set(taskId, taskRecord)

        const safeTaskId = sanitizeLog(taskId, 64)
        const safeTarget = sanitizeLog(targetPath, 128)
        console.log(`[worker] 收到中转任务派发: ${safeTaskId} -> ${safeTarget} [模式: ${payload.storageMode || 'cloudpan'}]`)

        // 并发调度控制：未达 5 并发直接启动，否则入排队队列
        if (runningCount < MAX_CONCURRENT_TASKS) {
          runTask(taskRecord, payload)
        } else {
          taskQueue.push({ taskRecord, payload })
        }

        return sendJson(res, 200, {
          ok: true,
          taskId,
          storageMode: payload.storageMode || 'cloudpan',
          targetPath,
          message: isServerLocal
            ? '中转下载任务已成功加入队列，将保存在中转服务器本地磁盘'
            : '中转代传任务已成功加入队列，将转存至交大云盘'
        })
      } catch (err) {
        return sendJson(res, 400, {
          ok: false,
          error: `解析任务数据失败: ${err instanceof Error ? err.message : String(err)}`
        })
      }
    })
    return
  }

  // 3. 任务状态查询与取消接口
  if (pathname.startsWith('/api/tasks/')) {
    const isCancel = pathname.endsWith('/cancel') || req.method === 'DELETE'
    const taskId = pathname.replace('/api/tasks/', '').replace(/\/cancel$/, '')
    const task = tasks.get(taskId)
    if (!task) {
      return sendJson(res, 404, { ok: false, error: '任务不存在' })
    }

    if (!verifyAuth(req)) {
      return sendJson(res, 401, { ok: false, error: 'Unauthorized' })
    }

    if (isCancel) {
      const qIdx = taskQueue.findIndex(item => item.taskRecord.taskId === taskId)
      if (qIdx !== -1) {
        taskQueue.splice(qIdx, 1)
      }
      if (task.abortController) {
        task.abortController.abort()
      }
      task.status = 'cancelled'
      task.completedAt = Date.now()
      task.speed = 0
      return sendJson(res, 200, { ok: true, message: '任务已取消', task })
    }

    if (req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        task: {
          taskId: task.taskId,
          fileName: task.fileName,
          storageMode: task.storageMode,
          status: task.status,
          receivedBytes: task.receivedBytes || 0,
          totalBytes: task.totalBytes || 0,
          speed: task.speed || 0,
          targetPath: task.targetPath,
          error: task.error
        }
      })
    }
  }

  // 4. 流式中转代理接口 (/api/proxy)
  // 允许客户端请求经由中转机在校内抓取目标资源流并实时回传给本地（支持 Range 断点续传）
  if (pathname === '/api/proxy' && req.method === 'GET') {
    if (!verifyAuth(req)) {
      return sendJson(res, 401, { ok: false, error: 'Unauthorized' })
    }
    const targetUrl = parsedUrl.searchParams.get('url')
    if (!targetUrl) {
      return sendJson(res, 400, { ok: false, error: '缺少目标 url 参数' })
    }
    if (!isAllowedTargetUrl(targetUrl)) {
      return sendJson(res, 403, { ok: false, error: '目标地址不在允许的服务白名单内或属于受限网络地址' })
    }
    try {
      const targetObj = new URL(targetUrl)

      const forwardHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SJTU-Downloader-Worker/1.0',
        'Accept': '*/*'
      }
      if (req.headers.range) {
        forwardHeaders['Range'] = req.headers.range
      }
      if (req.headers.referer) {
        forwardHeaders['Referer'] = req.headers.referer
      }
      if (req.headers.cookie) {
        const targetHost = targetObj.hostname.toLowerCase()
        const reqHost = (req.headers.host || '').split(':')[0].toLowerCase()
        if (targetHost === reqHost || /(^|\.)(sjtu\.edu\.cn|sjtu\.cn|cnmooc\.org)$/i.test(targetHost)) {
          forwardHeaders['Cookie'] = req.headers.cookie
        }
      }

      let currentTargetUrl = targetUrl
      let upstreamResp = null
      const maxRedirects = 5

      for (let r = 0; r < maxRedirects; r++) {
        if (!isAllowedTargetUrl(currentTargetUrl)) {
          return sendJson(res, 403, { ok: false, error: '目标地址不在允许的服务白名单内或属于受限网络地址' })
        }
        upstreamResp = await fetch(currentTargetUrl, {
          method: 'GET',
          headers: forwardHeaders,
          redirect: 'manual'
        })
        if (upstreamResp.status >= 300 && upstreamResp.status < 400 && upstreamResp.headers.has('location')) {
          const loc = upstreamResp.headers.get('location') || ''
          const nextUrl = new URL(loc, currentTargetUrl).toString()
          if (!isAllowedTargetUrl(nextUrl)) {
            return sendJson(res, 403, { ok: false, error: '目标地址不在允许的服务白名单内或属于受限网络地址' })
          }
          currentTargetUrl = nextUrl
          continue
        }
        break
      }

      const responseHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Authorization'
      }
      for (const [key, val] of upstreamResp.headers.entries()) {
        const lowerKey = key.toLowerCase()
        if (['content-length', 'content-type', 'content-range', 'accept-ranges', 'etag', 'last-modified'].includes(lowerKey)) {
          responseHeaders[key] = val
        }
      }

      res.writeHead(upstreamResp.status, responseHeaders)

      if (!upstreamResp.body) {
        return res.end()
      }

      const reader = upstreamResp.body.getReader()
      req.on('close', () => {
        reader.cancel().catch(() => {})
      })

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(Buffer.from(value))
      }
      return res.end()
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[worker] 代理转发失败:`, sanitizeLog(errMsg))
      if (!res.headersSent) {
        return sendJson(res, 502, { ok: false, error: `中转代理失败: ${errMsg}` })
      }
      return res.end()
    }
  }

  return sendJson(res, 404, { ok: false, error: 'Endpoint Not Found' })
})

server.listen(PORT, HOST, () => {
  console.log('╔════════════════════════════════════════════════════════════════╗')
  console.log('║        SJTU Downloader Private Worker Daemon v' + VERSION + '           ║')
  console.log('║       交大课程下载器 · 校内私有委托代传工作机守护进程          ║')
  console.log('╚════════════════════════════════════════════════════════════════╝')
  console.log(`  ✓ 本地监听地址: http://${HOST}:${PORT}`)
  console.log(`  ✓ 健康检查接口: http://${HOST}:${PORT}/health`)
  if (AUTH_TOKEN) {
    console.log(`  🔒 已启用访问授权密钥 (Token): ${AUTH_TOKEN.slice(0, 3)}***`)
  } else {
    console.log(`  💡 当前未设置访问密钥（如需保护节点，可通过环境变量 WORKER_TOKEN 设置）`)
  }
  console.log('  按 Ctrl+C 可随时安全退出服务\n')
})

process.on('SIGINT', () => {
  console.log('\n[worker] 正在优雅停止中转服务...')
  server.close(() => {
    console.log('[worker] 服务已完全停止。')
    process.exit(0)
  })
})

if (typeof globalThis !== 'undefined') {
  globalThis.MAX_CONCURRENT_TASKS = MAX_CONCURRENT_TASKS
  globalThis.MAX_QUEUE_SIZE = MAX_QUEUE_SIZE
  globalThis.TASK_TTL_MS = TASK_TTL_MS
  globalThis.MAX_TASKS_MAP_SIZE = MAX_TASKS_MAP_SIZE
  globalThis.tasks = tasks
  globalThis.taskQueue = taskQueue
  globalThis.getRunningCount = () => runningCount
  globalThis.setRunningCount = (val) => { runningCount = val }
  globalThis.pruneExpiredTasks = pruneExpiredTasks
  globalThis.scheduleWorkerQueue = scheduleWorkerQueue
  globalThis.runTask = runTask
}
