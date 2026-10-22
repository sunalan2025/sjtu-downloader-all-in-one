/**
 * Canvas 课程静默后台预扫描管线与优先级调度器
 *
 * 设计特性：
 * 1. 双队列优先级机制：
 *    - highQueue: 当前学期活跃课程、或用户点击/悬停即时插队的课程
 *    - lowQueue: 历年历史课程逆序静默排队
 * 2. 双阶段低开销执行：
 *    - Phase 1: 纯 REST 接口获取课件、作业与文件体积（0 窗口、几十 KB、毫秒级响应）
 *    - Phase 2: 轻量延时单路补充课堂视频录播明细
 * 3. 严格并发控制与防抖：
 *    - 默认并发限制为 2 路，每项任务间隔 150ms 礼貌防抖，杜绝 429 与 CPU/内存峰值
 * 4. 纯静默无感：后台静默执行，UI 卡片就地平滑从“待获取体积”过渡到真实容量与项数
 */

export interface ScanTaskOptions {
  courseId: number
  priority?: 'high' | 'normal' | 'low'
  scanFiles: (courseId: number) => Promise<void>
  scanVideos?: (courseId: number) => Promise<void>
  onDone?: (courseId: number) => void
  onError?: (courseId: number, err: unknown) => void
}

export class CanvasScanQueue {
  private concurrency: number
  private delayMs: number
  private highQueue: ScanTaskOptions[] = []
  private lowQueue: ScanTaskOptions[] = []
  private inFlight = new Set<number>()
  private completed = new Set<number>()
  private queued = new Set<number>()
  private runningWorkers = 0
  private aborted = false

  constructor(concurrency = 2, delayMs = 150) {
    this.concurrency = Math.max(1, concurrency)
    this.delayMs = delayMs
  }

  /**
   * 提交扫描任务入队
   * 若任务已完成、正在执行或已在队列中，自动跳过防重
   */
  public enqueue(task: ScanTaskOptions): void {
    const { courseId } = task
    if (this.completed.has(courseId) || this.inFlight.has(courseId) || this.queued.has(courseId)) {
      return
    }

    this.queued.add(courseId)
    if (task.priority === 'high') {
      this.highQueue.push(task)
    } else {
      this.lowQueue.push(task)
    }

    this.schedule()
  }

  /**
   * 用户交互即时插队（Preemption）：
   * 将该课程提升至 highQueue 队首，确保用户当前正在交互的课程立即可用
   */
  public promote(courseId: number): void {
    if (this.completed.has(courseId) || this.inFlight.has(courseId)) {
      return
    }

    // 检查是否在 lowQueue 中
    const lowIndex = this.lowQueue.findIndex(t => t.courseId === courseId)
    if (lowIndex >= 0) {
      const [task] = this.lowQueue.splice(lowIndex, 1)
      task.priority = 'high'
      this.highQueue.unshift(task)
      this.schedule()
      return
    }

    // 若已在 highQueue 中且不在队首，移至队首
    const highIndex = this.highQueue.findIndex(t => t.courseId === courseId)
    if (highIndex > 0) {
      const [task] = this.highQueue.splice(highIndex, 1)
      this.highQueue.unshift(task)
      this.schedule()
    }
  }

  /**
   * 清空所有待处理任务与运行标志
   */
  public clear(): void {
    this.aborted = true
    this.highQueue = []
    this.lowQueue = []
    this.queued.clear()
    this.inFlight.clear()
    this.completed.clear()
    this.runningWorkers = 0
  }

  /**
   * 是否有任务正在运行或等待中
   */
  public isRunning(): boolean {
    return this.runningWorkers > 0 || this.highQueue.length > 0 || this.lowQueue.length > 0
  }

  /**
   * 判断课程是否已入队、正在执行或已完成
   */
  public has(courseId: number): boolean {
    return this.queued.has(courseId) || this.inFlight.has(courseId) || this.completed.has(courseId)
  }

  /**
   * 标记某门课程已通过其他途径完成（如单文件下载或已缓存）
   */
  public markCompleted(courseId: number): void {
    this.completed.add(courseId)
    this.queued.delete(courseId)
    this.inFlight.delete(courseId)
  }

  private schedule(): void {
    this.aborted = false
    while (this.runningWorkers < this.concurrency && (this.highQueue.length > 0 || this.lowQueue.length > 0)) {
      const task = this.highQueue.shift() || this.lowQueue.shift()
      if (!task) break
      this.queued.delete(task.courseId)
      this.inFlight.add(task.courseId)
      this.runningWorkers++
      void this.executeTask(task)
    }
  }

  private async executeTask(task: ScanTaskOptions): Promise<void> {
    const { courseId } = task
    try {
      if (this.aborted) return

      // Phase 1: 毫秒级获取课件、作业与文件体积（纯 REST 请求，极低开销）
      await task.scanFiles(courseId)

      // Phase 2: 轻量单路延时补充视频（如果提供了 scanVideos）
      if (task.scanVideos && !this.aborted) {
        await task.scanVideos(courseId)
      }

      this.completed.add(courseId)
      task.onDone?.(courseId)
    } catch (err) {
      task.onError?.(courseId, err)
    } finally {
      this.inFlight.delete(courseId)
      this.runningWorkers--

      if (this.delayMs > 0 && !this.aborted) {
        await new Promise(resolve => setTimeout(resolve, this.delayMs))
      }

      if (!this.aborted) {
        this.schedule()
      }
    }
  }
}
