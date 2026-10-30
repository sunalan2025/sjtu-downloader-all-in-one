import type Electron from 'electron'
import { unlinkSync } from 'node:fs'
import type { PrivateWorkerConfig } from '../../shared/types'
import { buildCloudRemoteSegments } from '../../shared/utils'
import { sanitizeFsName } from './api'
import { isWorkerDelegated, dispatchPrivateWorkerTask, queryPrivateWorkerTask } from '../private-worker'
import { cloudFileExists, uploadLocalFileToCloud } from '../cloudpan'
import { resolveIvsVideoId } from './video-tokens'
import { getSession } from './auth-sso'
import { getCachedToken } from './scanner'
import { emitToRenderer } from './events'

export function canvasCoursePath(courseName: string, term?: string): string {
  const sanitized = sanitizeFsName(courseName)
  return term ? `${sanitizeFsName(term)}/${sanitized}` : sanitized
}

/** 单讲 PPT：下载图片 → 合并 PDF → （可选）上传云盘 → 清理 */
export async function runPptLecture(
  session: Electron.Session,
  token: string,
  lecture: {
    ivsVideoId: string
    lectureName: string
    videoSession?: { beginTime: string; teacher: string; classroom: string }
  },
  baseOpts: { courseName: string; destRoot: string; term?: string; saveImages?: boolean; privateWorker?: PrivateWorkerConfig },
  cloudOpts: { cloudUserToken?: string; conflictStrategy?: 'skip' | 'overwrite'; cloudDestRoot?: string },
  cPath: string,
  taskId: string | undefined,
  onLectureProgress: (imgCurrent: number, imgTotal: number, phase: string) => void
): Promise<{ ok: boolean; skipped?: boolean; path?: string; cloudPath?: string; error?: string }> {
  const videoIdStr = lecture.ivsVideoId
  const realIvsVideoId = await resolveIvsVideoId(session, token, videoIdStr)
  if (!realIvsVideoId) {
    return { ok: true, skipped: true }
  }

  const { downloadPptAsPdf, buildPptFileNameForLecture } = await import('./ppt-download')

  if (cloudOpts.cloudUserToken && !baseOpts.destRoot && (cloudOpts.conflictStrategy ?? 'skip') === 'skip') {
    const fileName = buildPptFileNameForLecture(lecture.lectureName, lecture.videoSession)
    const remotePath = buildCloudRemoteSegments(
      cloudOpts.cloudDestRoot,
      [...cPath.split('/'), 'videos', '课堂视频', fileName],
      'SJTU Canvas课程'
    ).join('/')
    if (await cloudFileExists(cloudOpts.cloudUserToken, remotePath)) {
      console.log(`[ppt] 云盘已存在，跳过: ${remotePath}`)
      return { ok: true, skipped: true, cloudPath: remotePath }
    }
  }

  const result = await downloadPptAsPdf(session, token, {
    ivsVideoId: realIvsVideoId,
    courseName: baseOpts.courseName,
    lectureName: lecture.lectureName,
    destRoot: baseOpts.destRoot,
    term: baseOpts.term,
    videoSession: lecture.videoSession,
    conflictStrategy: cloudOpts.conflictStrategy,
    saveImages: baseOpts.saveImages,
    privateWorker: baseOpts.privateWorker
  }, onLectureProgress)

  if (result.skipped && !result.path) {
    return { ok: true, skipped: true }
  }
  if (!result.ok || !result.path || !result.fileName) {
    return { ok: false, error: result.error }
  }

  if (!cloudOpts.cloudUserToken) {
    return { ok: true, skipped: result.skipped, path: result.path }
  }
  const remotePath = buildCloudRemoteSegments(
    cloudOpts.cloudDestRoot,
    [...cPath.split('/'), 'videos', '课堂视频', result.fileName],
    'SJTU Canvas课程'
  ).join('/')
  if (taskId) {
    emitToRenderer('canvas:ppt-progress', {
      taskId, ivsVideoId: lecture.ivsVideoId,
      current: 0, total: 0, phase: `${lecture.lectureName} · 上传云盘…`
    })
  }
  try {
    const r = await uploadLocalFileToCloud(
      cloudOpts.cloudUserToken,
      result.path,
      remotePath,
      cloudOpts.conflictStrategy ?? 'skip'
    )
    const cloudPath = r.path?.[0] ?? remotePath
    if (!baseOpts.destRoot) {
      try { unlinkSync(result.path) } catch { /* ignore */ }
    }
    return { ok: true, path: result.path, cloudPath }
  } catch (err) {
    if (err instanceof Error && err.name === 'FileExistsError') {
      if (!baseOpts.destRoot) {
        try { unlinkSync(result.path) } catch { /* ignore */ }
      }
      return { ok: true, skipped: true, path: result.path, cloudPath: remotePath }
    }
    const msg = err instanceof Error ? err.message : String(err)
    if (!baseOpts.destRoot) {
      try { unlinkSync(result.path) } catch { /* ignore */ }
    }
    return { ok: false, path: result.path, error: `云盘上传失败: ${msg}` }
  }
}

/** 下载单讲 PPT 课件图片并合并为 PDF（可选云盘上传） */
export async function handlePptDownload(opts: {
  ltiToken?: string
  taskId?: string
  ivsVideoId: string
  courseName: string
  lectureName: string
  destRoot: string
  cloudUserToken?: string
  conflictStrategy?: 'skip' | 'overwrite'
  term?: string
  videoSession?: { beginTime: string; teacher: string; classroom: string }
  saveImages?: boolean
  privateWorker?: PrivateWorkerConfig
  cloudDestRoot?: string
}): Promise<{ ok: boolean; skipped?: boolean; path?: string; cloudPath?: string; error?: string }> {
  try {
    const session = getSession()
    const token = opts.ltiToken || getCachedToken()
    if (!token) {
      return { ok: false, error: '请先点击"课堂视频"扫描课程，以获取访问token' }
    }
    const cPath = canvasCoursePath(opts.courseName, opts.term)
    const result = await runPptLecture(
      session, token,
      { ivsVideoId: opts.ivsVideoId, lectureName: opts.lectureName, videoSession: opts.videoSession },
      { courseName: opts.courseName, destRoot: opts.destRoot, term: opts.term, saveImages: opts.saveImages, privateWorker: opts.privateWorker },
      { cloudUserToken: opts.cloudUserToken, conflictStrategy: opts.conflictStrategy, cloudDestRoot: opts.cloudDestRoot },
      cPath, opts.taskId,
      (current, total, phase) => {
        emitToRenderer('canvas:ppt-progress', {
          taskId: opts.taskId, ivsVideoId: opts.ivsVideoId, current, total,
          phase: `${opts.lectureName} · ${phase}`, lectureName: opts.lectureName
        })
      }
    )
    return result
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 批量下载多讲 PPT 课件（可选云盘上传） */
export async function handlePptDownloadBatch(opts: {
  ltiToken?: string
  taskId?: string
  lectures: Array<{ ivsVideoId: string; lectureName: string; videoSession?: { beginTime: string; teacher: string; classroom: string } }>
  courseName: string
  destRoot: string
  cloudUserToken?: string
  conflictStrategy?: 'skip' | 'overwrite'
  term?: string
  saveImages?: boolean
  privateWorker?: PrivateWorkerConfig
  cloudDestRoot?: string
}): Promise<{ ok: boolean; results?: Array<{ lectureName: string; ok: boolean; skipped?: boolean; path?: string; cloudPath?: string; error?: string }>; error?: string }> {
  try {
    const session = getSession()
    const token = opts.ltiToken || getCachedToken()
    if (!token) {
      return { ok: false, error: '请先点击"课堂视频"扫描课程，以获取访问token' }
    }
    const cPath = canvasCoursePath(opts.courseName, opts.term)
    const taskId = opts.taskId
    const total = opts.lectures.length
    const results: Array<{ lectureName: string; ok: boolean; skipped?: boolean; path?: string; cloudPath?: string; error?: string }> = []

    // 私有中转服务代传接管判定
    if (isWorkerDelegated(opts.cloudUserToken ? 'cloud' : 'local', opts.privateWorker)) {
      const worker = opts.privateWorker!
      for (let i = 0; i < opts.lectures.length; i++) {
        const lecture = opts.lectures[i]
        if (taskId) {
          emitToRenderer('canvas:ppt-progress', {
            taskId, ivsVideoId: 0, current: i, total,
            phase: `中转解析 ${lecture.lectureName}…`, lectureName: lecture.lectureName
          })
        }
        const realIvsVideoId = await resolveIvsVideoId(session, token, lecture.ivsVideoId)
        if (!realIvsVideoId) {
          results.push({ lectureName: lecture.lectureName, ok: true, skipped: true })
          continue
        }
        const { fetchPptSliceList, buildPptFileNameForLecture } = await import('./ppt-download')
        const slices = await fetchPptSliceList(session, token, realIvsVideoId)
        if (!slices || slices.length === 0) {
          results.push({ lectureName: lecture.lectureName, ok: true, skipped: true })
          continue
        }
        const fileName = buildPptFileNameForLecture(lecture.lectureName, lecture.videoSession)
        if (taskId) {
          emitToRenderer('canvas:ppt-progress', {
            taskId, ivsVideoId: realIvsVideoId, current: i, total,
            phase: `中转派发 ${lecture.lectureName} (${slices.length}讲切片)…`, lectureName: lecture.lectureName
          })
        }
        const destPath = [opts.cloudDestRoot || '', cPath, '课堂讲义 (PPT)', fileName]
          .filter(Boolean)
          .join('/')
        const subTaskId = `${taskId || 'ppt'}_${realIvsVideoId}`
        const dispatchRes = await dispatchPrivateWorkerTask(
          worker.endpointUrl,
          {
            taskId: subTaskId,
            url: slices[0].pptImgUrl,
            fileName,
            destPath,
            cloudUserToken: worker.storageMode === 'server_local' ? undefined : opts.cloudUserToken,
            conflictStrategy: opts.conflictStrategy,
            storageMode: worker.storageMode || 'cloudpan',
            serverDownloadDir: worker.serverDownloadDir || '~/downloads',
            courseName: opts.courseName,
            categoryName: '课堂讲义 (PPT)',
            slices: slices.map(s => ({ url: s.pptImgUrl, createSec: Number(s.createSec) })),
            saveImages: opts.saveImages
          },
          worker.authToken
        )
        if (!dispatchRes.ok) {
          results.push({ lectureName: lecture.lectureName, ok: false, error: dispatchRes.error })
          if (taskId) {
            emitToRenderer('canvas:ppt-progress', {
              taskId, ivsVideoId: realIvsVideoId, current: i + 1, total,
              phase: `${lecture.lectureName} 派发失败`, lectureName: lecture.lectureName
            })
          }
          continue
        }

        let pollDone = false
        const startPoll = Date.now()
        while (!pollDone && Date.now() - startPoll < 300_000) {
          await new Promise(r => setTimeout(r, 1000))
          const q = await queryPrivateWorkerTask(worker.endpointUrl, subTaskId, worker.authToken)
          if (q.ok && q.task) {
            if (q.task.status === 'completed') {
              results.push({ lectureName: lecture.lectureName, ok: true })
              pollDone = true
              break
            }
            if (q.task.status === 'failed') {
              results.push({ lectureName: lecture.lectureName, ok: false, error: q.task.error })
              pollDone = true
              break
            }
            if (taskId) {
              emitToRenderer('canvas:ppt-progress', {
                taskId, ivsVideoId: realIvsVideoId, current: i, total,
                phase: `${lecture.lectureName} 远端合成转存中…`, lectureName: lecture.lectureName
              })
            }
          }
        }
        if (!pollDone) {
          results.push({ lectureName: lecture.lectureName, ok: false, error: '等待远端合成超时' })
        }
        if (taskId) {
          const lastRes = results[results.length - 1]
          emitToRenderer('canvas:ppt-progress', {
            taskId, ivsVideoId: realIvsVideoId, current: i + 1, total,
            phase: lastRes?.ok ? `${lecture.lectureName} 完成` : `${lecture.lectureName} 失败`,
            lectureName: lecture.lectureName
          })
        }
      }
      if (taskId) {
        emitToRenderer('canvas:ppt-progress', { taskId, ivsVideoId: 0, current: total, total, phase: '中转下载完成' })
      }
      return { ok: true, results }
    }

    if (taskId) {
      emitToRenderer('canvas:ppt-progress', { taskId, ivsVideoId: 0, current: 0, total, phase: '开始下载PPT课件…' })
    }

    for (let i = 0; i < opts.lectures.length; i++) {
      const lecture = opts.lectures[i]
      if (taskId) {
        emitToRenderer('canvas:ppt-progress', {
          taskId, ivsVideoId: lecture.ivsVideoId, current: i, total,
          phase: `下载 ${lecture.lectureName}…`, lectureName: lecture.lectureName
        })
      }
      const result = await runPptLecture(
        session, token, lecture,
        { courseName: opts.courseName, destRoot: opts.destRoot, term: opts.term, saveImages: opts.saveImages, privateWorker: opts.privateWorker },
        { cloudUserToken: opts.cloudUserToken, conflictStrategy: opts.conflictStrategy, cloudDestRoot: opts.cloudDestRoot },
        cPath, taskId,
        (imgCurrent, imgTotal, phase) => {
          if (!taskId) return
          emitToRenderer('canvas:ppt-progress', {
            taskId, ivsVideoId: lecture.ivsVideoId, current: i, total,
            phase: `${lecture.lectureName} · ${phase}`, lectureName: lecture.lectureName
          })
        }
      )
      results.push({ lectureName: lecture.lectureName, ...result })
      if (taskId) {
        emitToRenderer('canvas:ppt-progress', {
          taskId, ivsVideoId: lecture.ivsVideoId, current: i + 1, total,
          phase: result.skipped ? `${lecture.lectureName} 跳过` : (result.ok ? `${lecture.lectureName} 完成` : `${lecture.lectureName} 失败`),
          lectureName: lecture.lectureName
        })
      }
    }

    if (taskId) {
      emitToRenderer('canvas:ppt-progress', { taskId, ivsVideoId: 0, current: total, total, phase: '完成' })
    }
    return { ok: true, results }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
