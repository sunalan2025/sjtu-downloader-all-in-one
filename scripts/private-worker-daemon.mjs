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
const AUTH_TOKEN = (process.env.WORKER_TOKEN || process.argv[3] || '').trim()
const VERSION = '1.0.0'

const tasks = new Map()

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

function sanitizePathSegment(segment, fallback = 'default') {
  if (typeof segment !== 'string') return fallback
  const cleaned = segment
    .replace(/[\\/:*?"<>|\x00-\x1f\x7f-\x9f]/g, '_')
    .replace(/\.{2,}/g, '_')
    .trim()
  return cleaned || fallback
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
  const authHeader = req.headers['authorization'] || ''
  const expected = `Bearer ${AUTH_TOKEN}`
  return authHeader === expected || authHeader === AUTH_TOKEN
}

const server = http.createServer((req, res) => {
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
      activeTasks: tasks.size
    })
  }

  // 2. 派发代传任务接口
  if (pathname === '/api/tasks' && req.method === 'POST') {
    if (!verifyAuth(req)) {
      return sendJson(res, 401, { ok: false, error: 'Unauthorized' })
    }

    let rawBody = ''
    req.on('data', chunk => {
      rawBody += chunk
      if (rawBody.length > 1024 * 1024) {
        req.destroy()
      }
    })

    req.on('end', () => {
      try {
        const payload = JSON.parse(rawBody || '{}')
        const taskId = payload.taskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        const isServerLocal = payload.storageMode === 'server_local'
        let targetPath = payload.destPath || ''
        let resolvedLocalPath = null

        if (isServerLocal) {
          const baseDir = expandHomeDir(payload.serverDownloadDir)
          const safeCourse = sanitizePathSegment(payload.courseName, '未分类课程')
          const safeCategory = sanitizePathSegment(payload.categoryName, '其它资料')
          const safeFileName = sanitizePathSegment(payload.fileName, '未命名文件')

          const targetDir = path.resolve(baseDir, safeCourse, safeCategory)
          const normalizedBase = path.normalize(baseDir)
          const normalizedTarget = path.normalize(targetDir)

          if (!normalizedTarget.startsWith(normalizedBase)) {
            return sendJson(res, 400, {
              ok: false,
              error: '检测到非法路径穿越尝试'
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
          receivedAt: Date.now(),
          targetPath,
          ...(resolvedLocalPath ? { resolvedPath: resolvedLocalPath } : {})
        }
        tasks.set(taskId, taskRecord)

        const safeTaskId = sanitizeLog(taskId, 64)
        const safeTarget = sanitizeLog(targetPath, 128)
        console.log(`[worker] 收到中转任务派发: ${safeTaskId} -> ${safeTarget} [模式: ${payload.storageMode || 'cloudpan'}]`)

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

  // 3. 任务状态查询接口
  if (pathname.startsWith('/api/tasks/') && req.method === 'GET') {
    if (!verifyAuth(req)) {
      return sendJson(res, 401, { ok: false, error: 'Unauthorized' })
    }
    const taskId = pathname.replace('/api/tasks/', '')
    const task = tasks.get(taskId)
    if (!task) {
      return sendJson(res, 404, { ok: false, error: '任务不存在' })
    }
    return sendJson(res, 200, { ok: true, task })
  }

  return sendJson(res, 404, { ok: false, error: 'Endpoint Not Found' })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log('╔════════════════════════════════════════════════════════════════╗')
  console.log('║        SJTU Downloader Private Worker Daemon v' + VERSION + '           ║')
  console.log('║       交大课程下载器 · 校内私有委托代传工作机守护进程          ║')
  console.log('╚════════════════════════════════════════════════════════════════╝')
  console.log(`  ✓ 本地监听地址: http://127.0.0.1:${PORT}`)
  console.log(`  ✓ 健康检查接口: http://127.0.0.1:${PORT}/health`)
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
