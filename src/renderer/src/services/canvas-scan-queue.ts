/**
 * Canvas 课程静默后台预扫描管线与双阶段异步加速调度器
 *
 * 核心优化特性：
 * 1. 双阶段异步解耦 (Decoupled Two-Phase Execution)：
 *    - Phase 1 (极速课件与元数据): 纯 REST 接口并发打满（默认 4 路），零延时响应，
 *      1~2 秒内瞬间就绪当前学期全部课程的文件列表、作业与体积，UI 卡片瞬间告别“待获取”；
 *    - Phase 2 (平滑课堂视频与讲次跟进): 视频单路/双路在后台礼貌防抖推进，杜绝网络与 CPU 峰值。
 * 2. 双队列优先级机制 (High/Low Priority Queues)：
 *    - highQueue: 当前学期活跃课程，直接插队优先调度；
 *    - lowQueue: 历年历史课程逆序静默排队。
 * 3. 毫秒级抢占插队 (Interactive Preemption)：
 *    - 用户鼠标悬停或点击任意课程卡片时，该课程在 Phase 1 与 Phase 2 均立即抢占队首优先执行。
 * 4. 纯静默无感：就地平滑局部更新，无弹窗、无刷新、无阻塞。
 */

export interface ScanTaskOptions {
  courseId: number
  priority?: 'high' | 'normal' | 'low'
  scanFiles: (courseId: number) => Promise<void>
  scanVideos?: (courseId: number) => Promise<void>
  onFilesDone?: (courseId: number) => void
  onDone?: (courseId: number) => void
  onError?: (courseId: number, err: unknown) => void
}

interface InternalTask {
  options: ScanTaskOptions
  priority: 'high' | 'normal' | 'low'
}

export class CanvasScanQueue {
  private fileConcurrency: number
  private videoConcurrency: number
  private delayMs: number

  // Phase 1: 课件与元数据队列
  private highFilesQueue: InternalTask[] = []
  private lowFilesQueue: InternalTask[] = []
  private fileInFlight = new Set<number>()
  private runningFileWorkers = 0

  // Phase 2: 课堂视频与讲次队列
  private highVideosQueue: InternalTask[] = []
  private lowVideosQueue: InternalTask[] = []
  private videoInFlight = new Set<number>()
  private runningVideoWorkers = 0

  // 状态追踪集合
  private completed = new Set<number>()
  private queued = new Set<number>()
  private aborted = false

  constructor(concurrency = 4, delayMs = 60, videoConcurrency = 2) {
    this.fileConcurrency = Math.max(1, concurrency)
    this.videoConcurrency = Math.max(1, Math.min(concurrency, videoConcurrency))
    this.delayMs = delayMs
  }

  /**
   * 提交扫描任务入队
   * 若任务已完成、正在执行或已在队列中，自动跳过防重
   */
  public enqueue(task: ScanTaskOptions): void {
    const { courseId } = task
    if (this.completed.has(courseId) || this.fileInFlight.has(courseId) || this.videoInFlight.has(courseId) || this.queued.has(courseId)) {
      return
    }

    this.queued.add(courseId)
    const priority = task.priority || 'normal'
    const internalTask: InternalTask = { options: task, priority }

    if (priority === 'high') {
      this.highFilesQueue.push(internalTask)
    } else {
      this.lowFilesQueue.push(internalTask)
    }

    this.scheduleFiles()
  }

  /**
   * 用户交互即时插队（Preemption）：
   * 将该课程提升至 highQueue 队首，确保用户当前正在交互的课程立即可用
   */
  public promote(courseId: number): void {
    if (this.completed.has(courseId)) return

    // 1. 若在 files 队列中，提升至 highFilesQueue 队首
    const lowFileIdx = this.lowFilesQueue.findIndex(t => t.options.courseId === courseId)
    if (lowFileIdx >= 0) {
      const [task] = this.lowFilesQueue.splice(lowFileIdx, 1)
      task.priority = 'high'
      this.highFilesQueue.unshift(task)
      this.scheduleFiles()
    } else {
      const highFileIdx = this.highFilesQueue.findIndex(t => t.options.courseId === courseId)
      if (highFileIdx > 0) {
        const [task] = this.highFilesQueue.splice(highFileIdx, 1)
        this.highFilesQueue.unshift(task)
        this.scheduleFiles()
      }
    }

    // 2. 若在 videos 队列中，提升至 highVideosQueue 队首
    const lowVidIdx = this.lowVideosQueue.findIndex(t => t.options.courseId === courseId)
    if (lowVidIdx >= 0) {
      const [task] = this.lowVideosQueue.splice(lowVidIdx, 1)
      task.priority = 'high'
      this.highVideosQueue.unshift(task)
      this.scheduleVideos()
    } else {
      const highVidIdx = this.highVideosQueue.findIndex(t => t.options.courseId === courseId)
      if (highVidIdx > 0) {
        const [task] = this.highVideosQueue.splice(highVidIdx, 1)
        this.highVideosQueue.unshift(task)
        this.scheduleVideos()
      }
    }
  }

  /**
   * 清空所有待处理任务与运行标志
   */
  public clear(): void {
    this.aborted = true
    this.highFilesQueue = []
    this.lowFilesQueue = []
    this.highVideosQueue = []
    this.lowVideosQueue = []
    this.queued.clear()
    this.fileInFlight.clear()
    this.videoInFlight.clear()
    this.completed.clear()
    this.runningFileWorkers = 0
    this.runningVideoWorkers = 0
  }

  /**
   * 是否有任务正在运行或等待中
   */
  public isRunning(): boolean {
    return (
      this.runningFileWorkers > 0 ||
      this.runningVideoWorkers > 0 ||
      this.highFilesQueue.length > 0 ||
      this.lowFilesQueue.length > 0 ||
      this.highVideosQueue.length > 0 ||
      this.lowVideosQueue.length > 0
    )
  }

  /**
   * 判断课程是否已入队、正在执行或已完成
   */
  public has(courseId: number): boolean {
    return (
      this.queued.has(courseId) ||
      this.fileInFlight.has(courseId) ||
      this.videoInFlight.has(courseId) ||
      this.completed.has(courseId)
    )
  }

  /**
   * 标记某门课程已通过其他途径完成（如单文件下载或已缓存）
   */
  public markCompleted(courseId: number): void {
    this.completed.add(courseId)
    this.queued.delete(courseId)
    this.fileInFlight.delete(courseId)
    this.videoInFlight.delete(courseId)
    this.highFilesQueue = this.highFilesQueue.filter(t => t.options.courseId !== courseId)
    this.lowFilesQueue = this.lowFilesQueue.filter(t => t.options.courseId !== courseId)
    this.highVideosQueue = this.highVideosQueue.filter(t => t.options.courseId !== courseId)
    this.lowVideosQueue = this.lowVideosQueue.filter(t => t.options.courseId !== courseId)
  }

  // ══════════════════════════════════════════════════════════
  // Phase 1 调度（极速课件扫描）
  // ══════════════════════════════════════════════════════════

  private scheduleFiles(): void {
    this.aborted = false
    while (
      this.runningFileWorkers < this.fileConcurrency &&
      (this.highFilesQueue.length > 0 || this.lowFilesQueue.length > 0)
    ) {
      const task = this.highFilesQueue.shift() || this.lowFilesQueue.shift()
      if (!task) break
      this.fileInFlight.add(task.options.courseId)
      this.runningFileWorkers++
      void this.executeFileTask(task)
    }
  }

  private async executeFileTask(task: InternalTask): Promise<void> {
    const { courseId } = task.options
    try {
      if (this.aborted) return

      // 执行 Phase 1: 毫秒级获取课件与文件体积
      await task.options.scanFiles(courseId)
      task.options.onFilesDone?.(courseId)

      // 若有视频任务，无缝交接至 Phase 2 队列推进
      if (task.options.scanVideos && !this.aborted) {
        if (task.priority === 'high') {
          this.highVideosQueue.push(task)
        } else {
          this.lowVideosQueue.push(task)
        }
        this.scheduleVideos()
      } else {
        this.completed.add(courseId)
        this.queued.delete(courseId)
        task.options.onDone?.(courseId)
      }
    } catch (err) {
      task.options.onError?.(courseId, err)
    } finally {
      this.fileInFlight.delete(courseId)
      this.runningFileWorkers--

      // 高优先级课件任务 0 延时，普通/低优先级任务享受轻量防抖
      if (this.delayMs > 0 && !this.aborted && task.priority !== 'high') {
        await new Promise(resolve => setTimeout(resolve, this.delayMs))
      }

      if (!this.aborted) {
        this.scheduleFiles()
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // Phase 2 调度（静默视频扫描）
  // ══════════════════════════════════════════════════════════

  private scheduleVideos(): void {
    if (this.aborted) return
    while (
      this.runningVideoWorkers < this.videoConcurrency &&
      (this.highVideosQueue.length > 0 || this.lowVideosQueue.length > 0)
    ) {
      const task = this.highVideosQueue.shift() || this.lowVideosQueue.shift()
      if (!task) break
      this.videoInFlight.add(task.options.courseId)
      this.runningVideoWorkers++
      void this.executeVideoTask(task)
    }
  }

  private async executeVideoTask(task: InternalTask): Promise<void> {
    const { courseId } = task.options
    try {
      if (this.aborted) return
      if (task.options.scanVideos) {
        await task.options.scanVideos(courseId)
      }
      this.completed.add(courseId)
      this.queued.delete(courseId)
      task.options.onDone?.(courseId)
    } catch (err) {
      task.options.onError?.(courseId, err)
    } finally {
      this.videoInFlight.delete(courseId)
      this.runningVideoWorkers--

      if (this.delayMs > 0 && !this.aborted && task.priority !== 'high') {
        await new Promise(resolve => setTimeout(resolve, this.delayMs))
      }

      if (!this.aborted) {
        this.scheduleVideos()
      }
    }
  }
}
