/**
 * 下载领域层 — 进度聚合纯函数与 hooks（唯一真相来源）
 *
 * [Bug Fix / 重构] 原先「both 模式本地+云端合并」的状态机被手抄了 6 份且规则
 * 有出入：useEffectiveProgress / useDownloadStats（store/app.ts）、死掉的
 * OverallProgressBar（DownloadUI.tsx）、三页课程级 summary（CanvasBrowser /
 * AuditedCourses / CnmoocBrowser 各一份，逐行近似却各自微调——cloud cancelled
 * 算不算 done、error 优先级、localDone+cloudUploading 的 inflight 计法均不同）。
 *
 * 本模块以 `aggregateTaskState()` 纯函数为唯一实现，全部消费方（单任务进度条、
 * 批量统计、课程级 summary、岛进度环）改为调用它。
 *
 * 聚合规则（both 模式，单模式退化为 local 分支）：
 *   - 任一 error              → error（文案取先出错的一侧）
 *   - 本地 done/skipped 且云端 done/skipped/cancelled/无镜像 → done
 *   - 本地 done 且云端在传    → uploading（本地副本就绪，云端仍在写）
 *   - 本地非终态              → downloading/pending（看本地 state）
 *   - 本地 cancelled          → cancelled（云端 error 除外，见 error 优先级）
 */
import type { DownloadProgress, DownloadState } from '@shared/types'
import { useAppStore } from '../store/app'
import { useShallow } from 'zustand/shallow'

// ─── 纯函数（可单测） ─────────────────────────────────────────

export type AggregatePhase = 'downloading' | 'uploading'

/** 单个（本地侧）任务的聚合态：归一化的展示状态 + 进度量 */
export interface TaskAggregate {
  /** 聚合后的展示状态（含 both 合并语义；单模式即 local 原态） */
  state: DownloadState
  /** 进度量：取「当前活跃侧」的 received/total（本地在传取本地、上传中取云端） */
  received: number
  total: number
  /** 该任务处于哪个阶段（both 模式区分下载中/上传中；单模式恒 downloading） */
  phase: AggregatePhase
  /** 附加文案（error 文案 / both 模式「本地完成 · 云端上传中」等） */
  message?: string
  /** 本地/云端原始态（诊断与高级统计用） */
  localState?: DownloadState
  cloudState?: DownloadState
}

const DONE_STATES: ReadonlySet<DownloadState> = new Set(['done', 'skipped'])
const FINAL_STATES: ReadonlySet<DownloadState> = new Set(['done', 'skipped', 'error', 'cancelled'])

export function isFinalState(s: DownloadState | undefined): boolean {
  return !!s && FINAL_STATES.has(s)
}

/**
 * 聚合单个任务的本地+云端进度（both 模式核心状态机，唯一实现）。
 * @param local 本地侧进度条目（可能 undefined——任务未入队）
 * @param cloud 云端镜像进度条目（单模式或无镜像传 undefined）
 */
export function aggregateTaskState(local?: DownloadProgress, cloud?: DownloadProgress): TaskAggregate {
  const ls = local?.state
  const cs = cloud?.state

  // 任一侧 error → error（本地优先报文案，因本地先跑）
  if (ls === 'error' || cs === 'error') {
    const errMsg = ls === 'error' ? local?.message : cloud?.message
    return { state: 'error', received: 0, total: 0, phase: 'downloading', message: errMsg, localState: ls, cloudState: cs }
  }

  // 无云端镜像（单模式 / both 但该任务无镜像）→ 纯本地语义
  if (!cloud) {
    return {
      state: ls ?? 'pending',
      received: local?.received ?? 0,
      total: local?.total ?? 0,
      phase: 'downloading',
      message: local?.message,
      localState: ls
    }
  }

  const localDone = !!ls && DONE_STATES.has(ls)
  // 云端 cancelled 视为「用户放弃云端副本」：本地 done 即整任务 done
  const cloudDone = cs === 'done' || cs === 'skipped' || cs === 'cancelled'

  if (localDone && cloudDone) {
    return { state: 'done', received: local?.received ?? 0, total: local?.total ?? 0, phase: 'downloading', message: local?.message, localState: ls, cloudState: cs }
  }

  // 本地 done、云端仍在传 → 上传中，进度取云端（上传字节）
  if (localDone && !cloudDone) {
    if (cs === 'paused') {
      return { state: 'downloading', received: local?.received ?? 0, total: local?.total ?? 0, phase: 'uploading', message: '本地完成 · 云端已暂停', localState: ls, cloudState: cs }
    }
    return {
      state: 'downloading',
      received: cloud?.received ?? 0,
      total: cloud?.total ?? 0,
      phase: 'uploading',
      message: cloud?.message ?? '本地完成 · 云端上传中',
      localState: ls,
      cloudState: cs
    }
  }

  // 本地未终态（下载中/排队/暂停）→ 以本地进度为主
  return {
    state: ls ?? 'pending',
    received: local?.received ?? 0,
    total: local?.total ?? 0,
    phase: 'downloading',
    message: local?.message,
    localState: ls,
    cloudState: cs
  }
}

// ─── 批量统计（纯函数） ───────────────────────────────────────

export interface BatchStats {
  /** 终态成功数（含 skipped；both 模式要求两侧都 done） */
  done: number
  /** 失败数（任一侧 error） */
  failed: number
  /** 活跃数（尚未到终态：downloading/pending/paused + uploading） */
  active: number
  /** 进行中任务的进度比例和（0..active，含小数），进度条平滑推进用 */
  inflight: number
  /** both 模式：本地在传的任务数 */
  downloading: number
  /** both 模式：本地 done 云端在传的任务数 */
  uploading: number
  total: number
}

/**
 * 聚合一组任务 id 的批量统计（both 模式区分下载/上传，与岛进度环口径一致）。
 * @param taskIds 本地侧 taskId 列表（不含 _cloud 镜像 id）
 * @param progress 进度表
 * @param cloudLinkedIds localId → cloudId 映射（both 模式）
 * @param isBoth 是否 both 模式
 */
export function computeBatchStats(
  taskIds: readonly string[],
  progress: Record<string, DownloadProgress>,
  cloudLinkedIds: Record<string, string>,
  isBoth: boolean
): BatchStats {
  let done = 0
  let failed = 0
  let active = 0
  let inflight = 0
  let downloading = 0
  let uploading = 0

  for (const id of taskIds) {
    const local = progress[id]
    const ls = local?.state
    if (isBoth) {
      const cloudId = cloudLinkedIds[id]
      const cloud = cloudId ? progress[cloudId] : undefined
      const cs = cloud?.state
      const localDone = !!ls && DONE_STATES.has(ls)
      const cloudDone = !cloudId || cs === 'done' || cs === 'skipped' || cs === 'cancelled'
      const localFinal = localDone || ls === 'error' || ls === 'cancelled'
      const cloudFinal = cloudDone || cs === 'error'

      if (ls === 'error' || cs === 'error') failed++
      else if (localDone && cloudDone) done++
      else if (!localFinal) {
        // 本地在下载/排队/暂停
        active++
        downloading++
        if (ls === 'downloading' && local && local.total > 0) inflight += Math.min(1, local.received / local.total)
      } else if (localDone && !cloudFinal) {
        // 本地就绪、云端上传中
        active++
        uploading++
        inflight += 1
      }
      // 本地 cancelled（cloud 非 error）→ 已取消，静默不计
    } else {
      if (ls === 'done' || ls === 'skipped') done++
      else if (ls === 'error') failed++
      else if (ls !== 'cancelled' && ls !== undefined) {
        active++
        if (ls === 'downloading' && local && local.total > 0) inflight += Math.min(1, local.received / local.total)
      }
    }
  }

  return { done, failed, active, inflight, downloading, uploading, total: taskIds.length }
}

/**
 * 剪枝 both 模式镜像映射：两侧均无活跃条目（都终态，或任一侧终态且另一侧缺失）
 * 的映射关系直接移除。镜像关系只在任务进行中有统计价值；到终态后残留只会污染
 * 后续单模式批次（TransferCenter 聚合 / skip-done 判断查到陈旧 error 镜像，把
 * 正在下载的任务误显示为失败）。提交新批次与快照恢复时调用。
 */
export function pruneSettledLinks(
  cloudLinkedIds: Record<string, string>,
  progress: Record<string, DownloadProgress>
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [localId, cloudId] of Object.entries(cloudLinkedIds)) {
    const local = progress[localId]
    const cloud = progress[cloudId]
    // 任一侧条目存在且未终态 → 映射仍可能有统计价值，保留
    if ((local && !isFinalState(local.state)) || (cloud && !isFinalState(cloud.state))) {
      next[localId] = cloudId
    }
    // 两侧均终态 / 一侧终态另一侧缺失（含从未入队的回滚残留）→ 剪掉
  }
  return next
}

// ─── React hooks（包装纯函数，供组件订阅） ─────────────────────

/**
 * 单任务进度订阅（useEffectiveProgress 的领域层形态，行为完全一致）。
 * 保留 store/app.ts 中的原导出作为兼容别名，新代码一律从这里导入。
 */
export function useTaskAggregate(taskId: string): TaskAggregate | undefined {
  const [local, cloud] = useAppStore(
    useShallow(s => {
      // 仅 both 模式下查云端镜像（修复单模式残留陈旧合并态的 [Bug Fix] 语义保留）
      const cloudId = s.downloadMode === 'both' ? s.cloudLinkedIds[taskId] : undefined
      return [s.progress[taskId], cloudId ? s.progress[cloudId] : undefined]
    })
  )
  if (!local && !cloud) return undefined
  return aggregateTaskState(local, cloud)
}

/** 批量统计订阅：对一组 taskIds 聚合 done/failed/active（useDownloadStats 的领域层形态） */
export function useBatchStats(
  taskIds: readonly string[],
  isBoth: boolean
): BatchStats {
  return useAppStore(
    useShallow(s => computeBatchStats(taskIds, s.progress, s.cloudLinkedIds, isBoth))
  )
}

/**
 * 将主进程全量任务快照还原到渲染端 store。
 * 供应用启动 / 页面重载 (Ctrl+R) / 订阅初始化时调用。
 * 返回本次恢复的 activeIds 与 cloudLinks。
 */
export function restoreDownloadSnapshot(snapshot: DownloadProgress[]): {
  activeIds: string[]
  cloudLinks: Record<string, string>
} {
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    return { activeIds: [], cloudLinks: {} }
  }
  const store = useAppStore.getState()
  const activeIds: string[] = []
  const cloudLinks: Record<string, string> = { ...store.cloudLinkedIds }

  // 先把快照条目全部 applyProgress 进 store；同时叠加快照构建剪枝用的有效进度表
  // （applyProgress 是微任务批处理，立刻读 store.progress 拿不到本轮条目，
  // 直接用会把活跃映射误判成"两侧缺失"剪掉）
  const effectiveProgress: Record<string, DownloadProgress> = { ...store.progress }
  for (const p of snapshot) {
    store.applyProgress(p)
    effectiveProgress[p.taskId] = p
    if (p.taskId.endsWith('_cloud')) {
      const baseId = p.taskId.slice(0, -'_cloud'.length)
      cloudLinks[baseId] = p.taskId
    } else if (p.state === 'downloading' || p.state === 'pending' || p.state === 'paused') {
      activeIds.push(p.taskId)
    }
  }
  // 剪枝：两侧均无活跃条目的映射无保留价值（重载前残留的终态对在这里清掉）
  const pruned = pruneSettledLinks(cloudLinks, effectiveProgress)
  if (Object.keys(pruned).length > 0) {
    store.setCloudLinkedIds(pruned)
  } else if (Object.keys(cloudLinks).length > 0) {
    store.setCloudLinkedIds({})
  }
  if (activeIds.length > 0) {
    store.addBatchTaskIds(activeIds)
    // [Bug Fix] 重载时主进程仍在传 → 恢复 downloading 标志。否则岛的进度环消失
    // （NetdiskCourseExplorer 的 batchProgress selector 以 s.downloading 为门槛）、
    // Enter 提交守卫失效、完成通知也不会弹出。收尾由 useGlobalDownloadCompletion
    // 接管（页面级 hook 在重载后因 selected 为空 + skipWhenEmpty 不会收尾）。
    if (!store.downloading) store.setDownloading(true)
    restoredBatchActive = true
  }
  return { activeIds, cloudLinks }
}

// ─── 重载恢复批次的全局收尾标志 ────────────────────────────────
//
// 重载后页面级 useDownloadCompletion 因 selected 为空（扫描态不持久化）+ skipWhenEmpty
// 不会把 downloading 收回 false。useGlobalDownloadCompletion（App 级）接管收尾：
// 仅当本标志为 true（即 downloading 来自快照恢复而非页面 onDownload）时才动作，
// 避免与页面 hook 双重通知。恢复批次收尾或被取消时置回 false。
let restoredBatchActive = false

/** 快照恢复置 downloading=true 时置位（内部使用） */
export function isRestoredBatchActive(): boolean {
  return restoredBatchActive
}

/** 恢复批次收尾/被取消时复位 */
export function clearRestoredBatchActive(): void {
  restoredBatchActive = false
}
