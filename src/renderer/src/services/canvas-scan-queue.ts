/** Bounded two-phase scanning: visible/opened courses precede newest-term prefetch. */
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
  generation: number
}
export class CanvasScanQueue {
  private fileConcurrency: number
  private videoConcurrency: number
  private delayMs: number
  private files: InternalTask[] = []
  private videos: InternalTask[] = []
  private tasks = new Map<number, InternalTask>()
  private completed = new Set<number>()
  private runningFiles = 0
  private runningVideos = 0
  private generation = 0

  constructor(concurrency = 4, delayMs = 60, videoConcurrency = 2) {
    this.fileConcurrency = Math.max(1, concurrency)
    this.videoConcurrency = Math.max(1, Math.min(concurrency, videoConcurrency))
    this.delayMs = Math.max(0, delayMs)
  }
  public enqueue(options: ScanTaskOptions): void {
    if (this.has(options.courseId)) return
    const task: InternalTask = { options, priority: options.priority || 'normal', generation: this.generation }
    this.tasks.set(options.courseId, task)
    this.files.push(task)
    this.schedule()
  }
  public promote(courseId: number): void {
    const task = this.tasks.get(courseId)
    if (!task) return
    // In-flight file tasks also retain this priority for their later video phase.
    task.priority = 'high'
    for (const queue of [this.files, this.videos]) {
      const index = queue.indexOf(task)
      if (index >= 0) {
        queue.splice(index, 1)
        queue.unshift(task)
      }
    }
    this.schedule()
  }
  public retry(options: ScanTaskOptions): void {
    if (this.tasks.has(options.courseId)) return
    this.completed.delete(options.courseId)
    this.enqueue(options)
  }
  public clear(): void {
    // Old IPC calls cannot be aborted here; ignore their completion in the new queue.
    this.generation++
    this.files = []
    this.videos = []
    this.tasks.clear()
    this.completed.clear()
    this.runningFiles = 0
    this.runningVideos = 0
  }
  public has(courseId: number): boolean {
    return this.tasks.has(courseId) || this.completed.has(courseId)
  }
  public isRunning(): boolean {
    return this.tasks.size > 0 || this.runningFiles > 0 || this.runningVideos > 0
  }
  public markCompleted(courseId: number): void {
    this.completed.add(courseId)
    this.tasks.delete(courseId)
    this.files = this.files.filter(task => task.options.courseId !== courseId)
    this.videos = this.videos.filter(task => task.options.courseId !== courseId)
  }
  private take(queue: InternalTask[]): InternalTask | undefined {
    const high = queue.findIndex(task => task.priority === 'high')
    return queue.splice(high < 0 ? 0 : high, 1)[0]
  }
  private schedule(): void {
    while (this.runningFiles < this.fileConcurrency && this.files.length) {
      const task = this.take(this.files)!
      this.runningFiles++
      void this.execute(task, 'files')
    }
    while (this.runningVideos < this.videoConcurrency && this.videos.length) {
      const task = this.take(this.videos)!
      this.runningVideos++
      void this.execute(task, 'videos')
    }
  }
  private async execute(task: InternalTask, phase: 'files' | 'videos'): Promise<void> {
    const { courseId } = task.options
    try {
      if (phase === 'files') await task.options.scanFiles(courseId)
      else await task.options.scanVideos?.(courseId)
      if (task.generation !== this.generation || !this.tasks.has(courseId)) return
      if (phase === 'files') task.options.onFilesDone?.(courseId)
      if (phase === 'files' && task.options.scanVideos) {
        this.videos.push(task)
        this.schedule()
      } else {
        this.completed.add(courseId)
        this.tasks.delete(courseId)
        task.options.onDone?.(courseId)
      }
    } catch (error) {
      if (task.generation === this.generation) {
        this.tasks.delete(courseId)
        task.options.onError?.(courseId, error)
      }
    } finally {
      if (this.delayMs && task.priority !== 'high') await new Promise(resolve => setTimeout(resolve, this.delayMs))
      if (task.generation === this.generation) {
        if (phase === 'files') this.runningFiles--
        else this.runningVideos--
        this.schedule()
      }
    }
  }
}
