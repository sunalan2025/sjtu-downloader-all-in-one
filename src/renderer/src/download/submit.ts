/**
 * 下载领域层 — 批量下载提交编排（唯一提交入口）
 *
 * [重构] 原先三页的 onDownload 各自手抄同一套提交骨架：跳过已完成 → applyProgress
 * 占位 pending → addBatchTaskIds → both 模式建立 cloudLinkedIds → download:start →
 * 启动失败回滚（清镜像 + 标 error）。三份实现的细节略有差异（Canvas 失败时还会
 * 把 iframe 任务标 cancelled）。本模块收编为 submitDownloadBatch()，页面只负责
 * 「收集意图 → 构建 specs」，提交后的状态流转全部由领域层统一处理。
 *
 * 与页面契约：
 *   - 页面在调用前完成守卫（downloading / localDestRoot / cloudUserToken 检查）
 *   - 页面传入 specs（含占位 url，主进程懒解析）与 pendingTaskIds（含聚合任务 id）
 *   - 返回 ok=true 表示已入队；false 表示启动失败（错误已写进各任务进度）
 */
import type { DownloadTaskSpec } from '@shared/types'
import { useAppStore } from '../store/app'
import { pruneSettledLinks } from './progress'
import { resolveLocalDestination } from './destination'

export interface SubmitBatchOptions {
  /** both 模式：本地↔云端镜像 taskId 映射将由此建立 */
  isBothMode: boolean
  /** 现有 cloudLinkedIds（both 时在其上增量合并，保留既有镜像） */
  existingCloudLinkedIds?: Record<string, string>
}

export interface SubmitBatchResult {
  ok: boolean
  error?: string
  /** 实际提交的任务 id（含聚合任务；不含 _cloud 镜像） */
  submittedTaskIds: string[]
}

/**
 * 提交一批下载任务（唯一提交入口）：
 * 1. 占位 pending 进度（渲染端立即有反馈，不等主进程首个事件）
 * 2. 计入 batchTaskIds（岛进度环 / 完成统计的 total 来源）
 * 3. both 模式建立 cloudLinkedIds 镜像
 * 4. download:start IPC；失败时回滚：清镜像 + 每任务标 error
 *
 * 注意：跳过已完成任务（localDone && cloudDone）的过滤由调用方在构建 specs 时
 * 完成（需要各自的课程上下文判断），本函数不做重复过滤——传入即提交。
 */
export async function submitDownloadBatch(
  specs: DownloadTaskSpec[],
  opts: SubmitBatchOptions
): Promise<SubmitBatchResult> {
  const store = useAppStore.getState()
  if (specs.length === 0) return { ok: true, submittedTaskIds: [] }

  const downloadMode = store.downloadMode
  const options = {
    mode: downloadMode,
    conflictStrategy: store.fileConflictStrategy,
    localDestRoot: downloadMode !== 'cloud' ? store.localDestRoot : undefined,
    namingTemplate: store.namingTemplate,
    cloudDestRoot: store.cloudDestRoot,
    privateWorker: store.privateWorkerConfig
  }

  // 占位 pending + 计入本轮提交集
  const taskIds = specs.map(s => s.taskId)
  store.addBatchTaskIds(taskIds)
  for (const spec of specs) {
    if (!store.progress[spec.taskId]) {
      store.applyProgress({ taskId: spec.taskId, state: 'pending', received: 0, total: 0, message: '等待解析直链…' })
    }
  }

  // both 模式建立镜像映射（增量合并现有镜像；非 both 时保留既有映射，防冲掉后台已在传任务）。
  // 合并前先剪枝：两侧均终态的镜像关系已无统计价值，残留只会污染后续单模式批次
  // （TransferCenter 聚合 / skip-done 判断会查到陈旧 error 镜像），到终态即剪。
  if (opts.isBothMode) {
    const pairs: Record<string, string> = pruneSettledLinks(
      opts.existingCloudLinkedIds ?? store.cloudLinkedIds,
      store.progress
    )
    for (const spec of specs) pairs[spec.taskId] = spec.taskId + '_cloud'
    store.setCloudLinkedIds(pairs)
  }

  // IPC 提交；异常/失败回滚
  let result: { ok: boolean; error?: string }
  try {
    const localDestRoot = await resolveLocalDestination(downloadMode, store.localDestRoot)
    result = await window.api.download.start(localDestRoot, specs, { ...options, localDestRoot: localDestRoot || undefined })
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : 'IPC 通信失败' }
  }

  if (!result.ok) {
    // 回滚：仅清掉本批次刚建立的镜像 + 每任务标 error（渲染端可见失败原因）
    if (opts.isBothMode) {
      if (opts.existingCloudLinkedIds) {
        store.setCloudLinkedIds(opts.existingCloudLinkedIds)
      } else {
        const next = { ...store.cloudLinkedIds }
        for (const spec of specs) delete next[spec.taskId]
        store.setCloudLinkedIds(next)
      }
    }
    for (const spec of specs) {
      store.applyProgress({
        taskId: spec.taskId,
        state: 'error',
        received: 0,
        total: 0,
        message: result.error || '下载启动失败'
      })
    }
    return { ok: false, error: result.error, submittedTaskIds: [] }
  }

  return { ok: true, submittedTaskIds: taskIds }
}
