// 实时传输速度计量 + 网络健康监测 + 并发限制管理
//
// 与 download-engine（index.ts）的循环依赖通过回调注入打破：
// - rendererEmit：推 transfer:speed 到渲染端
// - reschedule：网络恢复后触发重试调度
// - isQuittingGetter：退出守卫

import { formatBytes } from '../shared/utils'

// ─── 并发上限与 HLS 活跃计数 ───
let concurrency = 3

// 正在运行的 HLS 下载（Canvas 课堂视频，由 canvas/orchestrator 发起）。
// 由 orchestrator 在获取槽位后增、下载结束后减，纳入全局计数。
let hlsActive = 0

// ─── 速度计量（1s 推送） ─────────────────
let speedTimer: ReturnType<typeof setInterval> | undefined
let speedLastMs = 0
let speedDownSnap = 0
let speedUpSnap = 0
let speedDownEma = 0
let speedUpEma = 0
let acDownloadBytes = 0           // 累计下载字节（速度显示用）
let acUploadBytes = 0             // 累计上传字节（速度显示用）

// ─── 注入回调 ───
let rendererEmit: ((channel: string, data: unknown) => void) | null = null
let reschedule: (() => void) | null = null
let isQuittingGetter: (() => boolean) | null = null

export function setRendererEmitter(fn: (channel: string, data: unknown) => void): void {
  rendererEmit = fn
}
export function setRescheduleCallback(fn: () => void): void {
  reschedule = fn
}
export function setIsQuittingGetter(fn: () => boolean): void {
  isQuittingGetter = fn
}

// ─── getter / setter ───
export function getConcurrency(): number { return concurrency }
export function setConcurrency(c: number): void { concurrency = c }
export function getHlsActive(): number { return hlsActive }
export function setHlsActive(n: number): void { hlsActive = n }
export function getSpeedEma(): { down: number; up: number } {
  return { down: speedDownEma, up: speedUpEma }
}

export { formatBytes }

// ─── 速度指标埋点 ───
export function noteDownloadBytes(bytes: number): void {
  acDownloadBytes += bytes
}
export function noteUploadBytes(bytes: number): void {
  acUploadBytes += bytes
}

/** 启动 1s 速度推送定时器（应用就绪后常驻，idle 时也推送 0 供 UI 显示）。 */
export function startSpeedTicker(): void {
  if (speedTimer) return
  speedLastMs = Date.now()
  speedDownSnap = 0
  speedUpSnap = 0
  speedTimer = setInterval(emitTransferSpeed, 1000)
}

export function stopSpeedTicker(): void {
  if (speedTimer) { clearInterval(speedTimer); speedTimer = undefined }
}

/** 计算 EMA 平滑后的下行/上行速度并推送给渲染端。 */
function emitTransferSpeed(): void {
  if (isQuittingGetter?.()) return
  const now = Date.now()
  const dt = Math.max(1, (now - speedLastMs) / 1000)
  const downInst = (acDownloadBytes - speedDownSnap) / dt
  const upInst = (acUploadBytes - speedUpSnap) / dt
  speedDownSnap = acDownloadBytes
  speedUpSnap = acUploadBytes
  speedLastMs = now
  speedDownEma = speedDownEma === 0 ? downInst : speedDownEma * 0.6 + downInst * 0.4
  speedUpEma = speedUpEma === 0 ? upInst : speedUpEma * 0.6 + upInst * 0.4
  rendererEmit?.('transfer:speed', {
    down: Math.round(speedDownEma),
    up: Math.round(speedUpEma)
  })
}

// ─── 网络健康监测 ─────────────────────────────────────────────

/** 判断错误是否为 DNS 解析失败（ENOTFOUND / ERR_NAME_NOT_RESOLVED） */
export function isDnsError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/i.test(msg)) return true
  if ('code' in err && /^(ENOTFOUND|EAI_AGAIN)$/.test(String((err as Error & { code?: unknown }).code))) return true
  return false
}

let networkErrorStreak = 0
let networkResumeTimer: ReturnType<typeof setTimeout> | undefined
const NETWORK_BACKOFF_MS = 30_000

export function noteNetworkError(): void {
  networkErrorStreak++
  if (networkResumeTimer) { clearTimeout(networkResumeTimer); networkResumeTimer = undefined }
}

export function noteNetworkRecovery(): void {
  networkErrorStreak = 0
  if (networkResumeTimer) { clearTimeout(networkResumeTimer); networkResumeTimer = undefined }
}

export function isNetworkHealthy(): boolean {
  return networkErrorStreak < 3
}

/** 调度器在网络不健康时设置兜底恢复定时器：避免所有活跃任务都失败后永久卡住。
 *  30s 后清零 networkErrorStreak 并触发 reschedule（scheduleNext + cloudScheduleNext）。
 *  由 scheduleNext / cloudScheduleNext 在 !isNetworkHealthy() 时调用。 */
export function ensureNetworkResumeTimer(): void {
  if (!networkResumeTimer) {
    networkResumeTimer = setTimeout(() => {
      networkResumeTimer = undefined
      networkErrorStreak = 0
      reschedule?.()
    }, NETWORK_BACKOFF_MS)
  }
}

/** 清除网络恢复定时器（cleanupOnQuit 用）。 */
export function stopNetworkResumeTimer(): void {
  if (networkResumeTimer) { clearTimeout(networkResumeTimer); networkResumeTimer = undefined }
}
