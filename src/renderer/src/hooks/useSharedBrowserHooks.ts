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
 * 订阅主进程的下载进度事件，写入 store。
 */
export function useDownloadProgressSubscription(): void {
  const applyProgress = useAppStore(s => s.applyProgress)
  useEffect(() => window.api.download.onProgress(p => applyProgress(p)), [applyProgress])
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
