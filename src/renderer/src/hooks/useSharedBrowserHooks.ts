/**
 * Browser 与 CanvasBrowser 共享的 hooks
 *
 * 抽取云盘连接/断开、缓存 token 验证、下载进度订阅、下载完成检测等
 * 两个页面高度重复的逻辑。
 */
import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '../store/app'
import { useShallow } from 'zustand/shallow'
import { prefetchCloudConnection } from '../services/prefetch'
import { restoreDownloadSnapshot, computeBatchStats, isRestoredBatchActive, clearRestoredBatchActive } from '../download/progress'

// ─── 云盘连接状态类型 ──────────────────────────────────────────

export type CloudConnState =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { status: 'error'; message: string }

// ─── useCloudConnection ────────────────────────────────────────

/**
 * [2.14] 封装云盘连接/断开操作及连接状态管理。
 * cloudConn 状态已移至 zustand store，跨 tab 共享。
 * 返回 { cloudConn, onConnectCloud, onDisconnectCloud }
 *
 * 云盘连接逻辑提取到 services/prefetch.ts 的 prefetchCloudConnection，
 * 登录后 App.tsx 也会调它自动连接（无需用户手动点按钮）。
 */
export function useCloudConnection(): {
  cloudConn: CloudConnState
  onConnectCloud: () => Promise<void>
  onDisconnectCloud: () => void
} {
  const { setCloudUserToken, setCloudSpaceInfo, cloudConnStatus, cloudConnMessage, setCloudConnStatus } = useAppStore(
    useShallow(s => ({
      setCloudUserToken: s.setCloudUserToken,
      setCloudSpaceInfo: s.setCloudSpaceInfo,
      cloudConnStatus: s.cloudConnStatus,
      cloudConnMessage: s.cloudConnMessage,
      setCloudConnStatus: s.setCloudConnStatus
    }))
  )

  const cloudConn: CloudConnState = cloudConnStatus === 'connecting'
    ? { status: 'connecting' }
    : cloudConnStatus === 'error'
      ? { status: 'error', message: cloudConnMessage }
      : { status: 'idle' }

  const onConnectCloud = useCallback(async (): Promise<void> => {
    await prefetchCloudConnection()
  }, [])

  const onDisconnectCloud = useCallback((): void => {
    setCloudUserToken(null)
    setCloudSpaceInfo(null)
    setCloudConnStatus('idle')
    void window.api.cloudpan.logout()
  }, [setCloudUserToken, setCloudSpaceInfo, setCloudConnStatus])

  return { cloudConn, onConnectCloud, onDisconnectCloud }
}

// ─── useDownloadProgressSubscription ───────────────────────────

/**
 * 订阅主进程的下载进度事件，写入 store；
 * 并在组件挂载/重载时向主进程拉取全量快照，恢复正在传输与历史状态。
 */
export function useDownloadProgressSubscription(): void {
  const applyProgress = useAppStore(s => s.applyProgress)
  useEffect(() => {
    // 启动/重载时：拉取主进程全量任务快照，根治页面刷新后任务蒸发
    if (window.api?.download?.getSnapshot) {
      window.api.download
        .getSnapshot()
        .then(snapshot => {
          restoreDownloadSnapshot(snapshot)
        })
        .catch(err => {
          console.warn('[snapshot] 拉取主进程下载快照失败:', err)
        })
    }

    return window.api.download.onProgress(p => applyProgress(p))
  }, [applyProgress])
}

// ─── useDownloadCompletion ─────────────────────────────────────

/**
 * 当所有选中任务都到达终态时，自动将 downloading 置为 false，
 * 并弹出系统通知汇报成功/失败数量。
 * @param selectedTaskIds 选中的任务 ID 列表
 * @param activeCount 来自 useDownloadStats 的 active 计数
 * @param doneCount 来自 useDownloadStats 的 done（成功+跳过）计数
 * @param failedCount 来自 useDownloadStats 的 failed（error）计数
 * @param skipWhenEmpty 为 true 时，selected 为空直接 return（CanvasBrowser 场景：扫描阶段下载任务还没注册）
 */
export function useDownloadCompletion(
  selectedTaskIds: string[],
  activeCount: number,
  skipWhenEmpty = false,
  doneCount?: number,
  failedCount?: number
): void {
  const { downloading, setDownloading } = useAppStore(
    useShallow(s => ({
      downloading: s.downloading,
      setDownloading: s.setDownloading
    }))
  )

  // 每个下载批次只通知一次：downloading 由 false→true 时重置标记
  const notifiedRef = useRef(false)
  useEffect(() => {
    if (downloading) notifiedRef.current = false
  }, [downloading])

  useEffect(() => {
    if (!downloading) return
    if (skipWhenEmpty && selectedTaskIds.length === 0) return
    // [Bug Fix] 移除 selectedTaskIds.length === 0 的短路判断。
    // 用户可能先全选→开始下载→然后取消全选，此时 selectedTaskIds 为空
    // 但实际任务仍在运行。只根据 activeCount 判断是否真正完成。
    if (activeCount === 0) {
      setDownloading(false)
      // 下载全部收尾 → 系统通知汇报成功/失败数量（每个批次仅一次）
      if (!notifiedRef.current && (typeof doneCount === 'number' || typeof failedCount === 'number')) {
        notifiedRef.current = true
        const done = doneCount ?? 0
        const failed = failedCount ?? 0
        if (done === 0 && failed === 0) return  // 没有任何任务进入终态（如全部取消），不打扰
        const body = failed > 0
          ? `成功 ${done} 项，失败 ${failed} 项`
          : `全部 ${done} 项完成`
        window.api.notify('下载完成', body).catch(() => undefined)
      }
    }
  }, [downloading, selectedTaskIds, activeCount, setDownloading, skipWhenEmpty, doneCount, failedCount])
}

// ─── useGlobalDownloadCompletion ───────────────────────────────

/**
 * [Bug Fix / 重载语义] 页面重载（Ctrl+R）后恢复的下载批次收尾器。
 *
 * 重载后页面级 useDownloadCompletion 因 selected 为空（扫描/勾选态不持久化）+
 * skipWhenEmpty 不会把 downloading 收回 false——进度环会永远显示"下载进行中"。
 * 本 hook 挂在 App 级（页面之外），只接管「快照恢复的批次」：
 * restoreDownloadSnapshot 置位 restoredBatchActive 标志，此处订阅 progress 变化、
 * 基于 batchTaskIds 统计 active，归零即收尾 + 通知 + 清标志。
 * 正常批次（页面 onDownload 发起）不置标志，仍由页面 hook 负责，避免双重通知。
 */
export function useGlobalDownloadCompletion(): void {
  const downloading = useAppStore(s => s.downloading)
  const batchTaskIds = useAppStore(s => s.batchTaskIds)
  const setDownloading = useAppStore(s => s.setDownloading)

  // progress 变化驱动重查（订阅整个 map 的引用变化——applyProgress 批处理已合并，
  // 每 flush 一次仅一次重渲染）
  const progress = useAppStore(s => s.progress)

  useEffect(() => {
    if (!downloading || !isRestoredBatchActive()) return
    const store = useAppStore.getState()
    const ids = store.batchTaskIds
    if (ids.length === 0) {
      // 无批次集（如全部已被移除）→ 直接收尾
      clearRestoredBatchActive()
      setDownloading(false)
      return
    }
    const stats = computeBatchStats(
      ids,
      store.progress,
      store.cloudLinkedIds,
      store.downloadMode === 'both'
    )
    if (stats.active > 0) return
    clearRestoredBatchActive()
    setDownloading(false)
    const done = stats.done
    const failed = stats.failed
    if (done === 0 && failed === 0) return  // 全取消不打扰
    const body = failed > 0 ? `成功 ${done} 项，失败 ${failed} 项` : `全部 ${done} 项完成`
    window.api.notify('下载完成', body).catch(() => undefined)
  }, [downloading, batchTaskIds, progress, setDownloading])
}
