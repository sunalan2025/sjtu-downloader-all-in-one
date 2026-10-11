// AIMD 自适应并发 + 实时速度计量 + 网络健康监测
//
// 双模式 AIMD：以 RTT、任务错误率、系统内存占用、磁盘写入吞吐、429 限流五项指标闭环；
// 快降慢升（资源超限×0.7 / 重度拥塞×0.6 / 轻度拥塞×0.8 / 连续 2 周期良好 +1），硬边界 2–16，
// 调整间隔 ≥3s。定时器兜底 + 任务完成事件驱动。
//
// 与 download-engine（index.ts）的循环依赖通过回调注入打破：
// - rendererEmit：推 transfer:speed / download:concurrency-changed 到渲染端（原 mainWindow.webContents.send）
// - reschedule：并发变化后调 scheduleNext + cloudScheduleNext（原直接调用）
// - hasActiveWork：判断是否还有活跃任务（原读 sharedActiveCount + pendingLocal + pendingCloud）
// - isQuittingGetter：退出守卫（原读全局 isQuitting）
// 由 lifecycle.ts 在 whenReady 里注入。

import { freemem, totalmem } from 'node:os'
import { formatBytes } from '../shared/utils'

// ─── 并发上限与 HLS 活跃计数（被 download-engine 读、被 AIMD 写） ───
let concurrency = 3
let autoConcurrency = false

// 正在运行的 HLS 下载（Canvas 课堂视频，由 canvas/orchestrator 发起）。
// 这些任务不在 tasks/cloudTasks 里，原先不计入 sharedActiveCount，导致调度器在
// HLS 下载进行时仍可继续拉本地/云任务到 concurrency 上限 → 实际并发超限。
// 由 orchestrator 在获取槽位后增、下载结束后减，纳入全局计数。
let hlsActive = 0

// ─── AIMD 常量 ───
const AC_MIN = 2
const AC_MAX = 16
const AC_MIN_INTERVAL_MS = 3000     // 调整最小间隔（方案要求 ≥3s，含事件驱动路径）
const AC_EVAL_DEFAULT_MS = 3000
const AC_EVAL_FAST_MS = 3000        // 拥塞/资源超限时快速反应（仍受 ≥3s 下限约束）
const AC_EVAL_SLOW_MS = 5000        // 平稳/无流量时拉长周期减抖
const AC_THROUGHPUT_MIN = 64 * 1024 // 64KB/s 以下不算"有意义的传输"，避免慢网误判爬升
const AC_DISK_CEILING = 150 * 1024 * 1024 // 磁盘写入吞吐标称上限（150MB/s），用于估算磁盘利用率
const AC_MEM_HIGH = 0.85
const AC_DISK_HIGH = 0.70
const AC_RTT_RISE_HEAVY = 0.5
const AC_RTT_RISE_LIGHT = 0.3
const AC_ERR_HEAVY = 0.05
const AC_ERR_LIGHT = 0.01
const AC_GOOD_PERIODS_REQUIRED = 2  // 连续良好周期数达标后才加性增

// ─── AIMD 状态 ───
let acTimer: ReturnType<typeof setTimeout> | undefined
let acBytesSnapshot = 0           // 上轮评估时的累计字节
let acNetErrSnapshot = 0          // 上轮评估时的累计网络错误数
let acTotalBytes = 0              // 全局累计下载+上传字节（AIMD 吞吐用）
let acDownloadBytes = 0           // 累计下载字节（速度显示用，单计不重复）
let acUploadBytes = 0             // 累计上传字节（速度显示用）
let _acTotalErrors = 0            // 全局累计任务级错误（仅日志）
let acNetworkErrors = 0           // 全局累计网络类错误（驱动降并发）
let _acPrevThroughput = 0         // 上一轮吞吐 (bytes/s)，仅日志参考
let acLastEvalMs = 0              // 上一轮评估时间戳
// 周期内重置的指标
let acRttSamples: number[] = []   // 周期内 RTT 样本（ms）
let acBaseRtt = 0                 // RTT 基线（动态跟踪低值）
let acTaskTotal = 0               // 周期内计入的任务尝试数
let acTaskErrors = 0              // 周期内失败的任务数
let acDiskBytesWritten = 0        // 周期内落盘字节数（本地模式）
let acRateLimited = false         // 周期内是否收到 429 限流
let acGoodPeriods = 0             // 连续"状态良好"周期计数

// ─── 速度计量（1s 推送，独立于 AIMD 3s 周期） ─────────────────
let speedTimer: ReturnType<typeof setInterval> | undefined
let speedLastMs = 0
let speedDownSnap = 0
let speedUpSnap = 0
let speedDownEma = 0
let speedUpEma = 0

// ─── 注入回调（打破与 download-engine / window 的循环依赖） ───
let rendererEmit: ((channel: string, data: unknown) => void) | null = null
let reschedule: (() => void) | null = null
let hasActiveWork: (() => boolean) | null = null
let isQuittingGetter: (() => boolean) | null = null

export function setRendererEmitter(fn: (channel: string, data: unknown) => void): void {
  rendererEmit = fn
}
export function setRescheduleCallback(fn: () => void): void {
  reschedule = fn
}
export function setHasActiveWorkGetter(fn: () => boolean): void {
  hasActiveWork = fn
}
export function setIsQuittingGetter(fn: () => boolean): void {
  isQuittingGetter = fn
}

// ─── getter / setter ───
export function getConcurrency(): number { return concurrency }
export function setConcurrency(c: number): void { concurrency = c }
export function getAutoConcurrency(): boolean { return autoConcurrency }
export function setAutoConcurrency(v: boolean): void { autoConcurrency = v }
export function getHlsActive(): number { return hlsActive }
export function setHlsActive(n: number): void { hlsActive = n }
export function getSpeedEma(): { down: number; up: number } {
  return { down: speedDownEma, up: speedUpEma }
}

export { formatBytes }

// ─── 指标埋点（download-engine 在 data 事件 / finally 里调用） ───
export function noteDownloadBytes(bytes: number): void {
  acTotalBytes += bytes
  acDownloadBytes += bytes
}
export function noteUploadBytes(bytes: number): void {
  acTotalBytes += bytes
  acUploadBytes += bytes
}
export function noteDiskWrite(bytes: number): void {
  acDiskBytesWritten += bytes
}
let lastRttSampleTs = 0
const RTT_SAMPLE_INTERVAL_MS = 200

export function noteRttSample(ms: number): void {
  // 过滤明显异常值（暂停/续传后的首包抖动），保留合理范围；200ms 节流防极大并发下样本数组膨胀
  if (ms > 0 && ms < 60_000) {
    const now = Date.now()
    if (now - lastRttSampleTs >= RTT_SAMPLE_INTERVAL_MS) {
      lastRttSampleTs = now
      acRttSamples.push(ms)
    }
  }
}
export function noteTaskResult(success: boolean): void {
  acTaskTotal++
  if (!success) acTaskErrors++
}
export function noteRateLimited(): void {
  acRateLimited = true
}
export function noteTaskError(): void {
  _acTotalErrors++
}

/** 系统内存占用比例（0..1）。用 os.freemem/totalmem 近似整机内存压力。 */
function getMemUsage(): number {
  const total = totalmem()
  if (total <= 0) return 0
  return Math.max(0, Math.min(1, 1 - freemem() / total))
}

/** 磁盘 IO 利用率近似（0..1）。跨平台无法精确取系统级磁盘利用率，
 *  这里用本进程周期内的落盘吞吐占标称上限的比例近似 —— 仅本地下载模式下有意义，
 *  用来判断磁盘是否成为瓶颈。 */
function getDiskIoUsage(dtMs: number): number {
  const rate = acDiskBytesWritten / (Math.max(1, dtMs) / 1000) // bytes/s
  return Math.max(0, Math.min(1, rate / AC_DISK_CEILING))
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

export function startAutoConcurrency(): void {
  if (acTimer) return
  acBytesSnapshot = acTotalBytes
  acNetErrSnapshot = acNetworkErrors
  acRttSamples = []
  acTaskTotal = 0
  acTaskErrors = 0
  acDiskBytesWritten = 0
  acRateLimited = false
  acGoodPeriods = 0
  _acPrevThroughput = 0
  acLastEvalMs = Date.now()
  acTimer = setTimeout(evalAutoConcurrency, AC_EVAL_DEFAULT_MS)
}

export function stopAutoConcurrency(): void {
  if (acTimer) { clearTimeout(acTimer); acTimer = undefined }
}

function scheduleEval(ms: number): void {
  // [Fix] 清理前一个待执行评估，防 leak + 重复触发（原遗漏，新增调用点在 acTimer pending 时会双触发）
  if (acTimer) clearTimeout(acTimer)
  acLastEvalMs = Date.now()
  acTimer = setTimeout(evalAutoConcurrency, ms)
}

/** 核心 AIMD 决策：测量自上次评估以来的吞吐/RTT/错误率/资源水位，调整 concurrency。
 *  由定时器（兜底）和任务完成事件（事件驱动，更实时）共同调用。
 *  返回下一次评估建议间隔（ms）。不管理定时器本身，由调用方 scheduleEval。 */
function runConcurrencyEval(): number {
  const now = Date.now()
  const dt = Math.max(1, now - acLastEvalMs)
  const bytesDelta = acTotalBytes - acBytesSnapshot
  const netErrDelta = acNetworkErrors - acNetErrSnapshot
  const throughput = bytesDelta / (dt / 1000)  // bytes/s

  // ── 周期指标 ──
  const avgRtt = acRttSamples.length > 0
    ? acRttSamples.reduce((a, b) => a + b, 0) / acRttSamples.length
    : acBaseRtt
  const rttRise = acBaseRtt > 0 ? (avgRtt - acBaseRtt) / acBaseRtt : 0
  const errRate = acTaskTotal > 0 ? acTaskErrors / acTaskTotal : 0
  const memUse = getMemUsage()
  const diskUse = getDiskIoUsage(dt)
  const limited = acRateLimited

  // ── 重置周期计数 ──
  acBytesSnapshot = acTotalBytes
  acNetErrSnapshot = acNetworkErrors
  acRttSamples = []
  acTaskTotal = 0
  acTaskErrors = 0
  acDiskBytesWritten = 0
  acRateLimited = false

  // ── 动态更新 RTT 基线：只下不上（拥塞导致的升高不污染基线）──
  if (avgRtt > 0) {
    if (acBaseRtt <= 0) acBaseRtt = avgRtt
    else if (avgRtt < acBaseRtt) acBaseRtt = acBaseRtt * 0.7 + avgRtt * 0.3
  }
  if (acBaseRtt <= 0) acBaseRtt = 120 // 兜底默认

  const prev = concurrency
  let nextMs: number

  if (memUse > AC_MEM_HIGH || diskUse > AC_DISK_HIGH) {
    // ── 资源超限兜底 → ×0.7 ──
    concurrency = Math.max(AC_MIN, Math.floor(concurrency * 0.7))
    acGoodPeriods = 0
    nextMs = AC_EVAL_FAST_MS
  } else if (netErrDelta > 0 || limited || rttRise > AC_RTT_RISE_HEAVY || errRate > AC_ERR_HEAVY) {
    // ── 重度拥塞 / 限流 / 网络错误 → ×0.6 ──
    concurrency = Math.max(AC_MIN, Math.floor(concurrency * 0.6))
    acGoodPeriods = 0
    nextMs = AC_EVAL_FAST_MS
  } else if (rttRise > AC_RTT_RISE_LIGHT || errRate > AC_ERR_LIGHT) {
    // ── 轻度拥塞 → ×0.8 ──
    concurrency = Math.max(AC_MIN, Math.floor(concurrency * 0.8))
    acGoodPeriods = 0
    nextMs = AC_EVAL_DEFAULT_MS
  } else if (throughput > AC_THROUGHPUT_MIN && errRate < AC_ERR_LIGHT && rttRise < 0.2) {
    // ── 状态良好：连续 2 周期达标才加性增 +1 ──
    acGoodPeriods++
    if (acGoodPeriods >= AC_GOOD_PERIODS_REQUIRED) {
      concurrency = Math.min(AC_MAX, concurrency + 1)
      acGoodPeriods = 0
    }
    nextMs = AC_EVAL_DEFAULT_MS
  } else {
    // ── 几乎无流量 / 边界状态：维持并发，拉长周期 ──
    nextMs = AC_EVAL_SLOW_MS
  }

  _acPrevThroughput = throughput

  if (concurrency !== prev) {
    console.log(
      `[auto-concurrency] ${prev} → ${concurrency} ` +
      `(rtt=${avgRtt.toFixed(0)}ms rise=${(rttRise * 100).toFixed(0)}% ` +
      `err=${(errRate * 100).toFixed(0)}% (${acTaskErrors}/${acTaskTotal}) ` +
      `mem=${(memUse * 100).toFixed(0)}% disk=${(diskUse * 100).toFixed(0)}% ` +
      `thr=${(throughput / 1024).toFixed(0)}KB/s netErr=${netErrDelta}${limited ? ' 429' : ''})`
    )
    rendererEmit?.('download:concurrency-changed', concurrency)
  }
  // 并发变化后立即调度，让新增槽位尽快被填充
  reschedule?.()
  return nextMs
}

function evalAutoConcurrency(): void {
  acTimer = undefined
  if (isQuittingGetter?.()) { stopAutoConcurrency(); return }
  // 所有队列和活跃集合为空 → 暂停定时器，等下次有任务时重启
  if (!hasActiveWork?.()) {
    stopAutoConcurrency()
    return
  }
  const nextMs = runConcurrencyEval()
  scheduleEval(nextMs)
}

// ─── 事件驱动并发探测 ─────────────────────────────────────────
//
// 定时器评估是兜底；真正"实时"的信号是任务完成事件 —— 每完成一个文件/视频，
// 立刻测量这段时间窗口的吞吐/RTT/错误并做 AIMD 决策。相比固定 3-5s 定时器，
// 能在任务粒度上更快响应网络变化（尤其大文件下载期间定时器窗口太粗）。
// 方案要求调整间隔 ≥3s：事件驱动路径同样受 AC_MIN_INTERVAL_MS 约束，
// 距上次评估不足 3s 时跳过，由定时器兜底评估。

/** 由 runTask / cloudRunTask 的 .finally 在任务结束时调用。
 *  仅在自动并发模式下生效；距上次评估 ≥3s 才立即跑一次 AIMD 评估并重排定时器。 */
export function onTaskCompleted(): void {
  if (!autoConcurrency || isQuittingGetter?.()) return
  const now = Date.now()
  if (now - acLastEvalMs < AC_MIN_INTERVAL_MS) return
  // 用最新窗口的吞吐/RTT/错误做决策，并按建议间隔重排定时器（定时器退居为无完成事件时的兜底）
  const nextMs = runConcurrencyEval()
  if (acTimer) { clearTimeout(acTimer); acTimer = undefined }
  scheduleEval(nextMs)
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
  acNetworkErrors++   // 驱动自动并发的乘性减
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
