import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CanvasScanQueue, type ScanTaskOptions } from '../../src/renderer/src/services/canvas-scan-queue'

describe('CanvasScanQueue Component Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('优先执行 highQueue 中的高优先级任务，随后执行 lowQueue 中的普通/低优先级任务', async () => {
    const executedOrder: number[] = []
    const queue = new CanvasScanQueue(1, 10)

    const createTask = (courseId: number, priority: 'high' | 'low'): ScanTaskOptions => ({
      courseId,
      priority,
      scanFiles: async (id) => {
        executedOrder.push(id)
      }
    })

    // 先入队两门低优先级历史课程，再入队一门高优先级当前学期课程
    queue.enqueue(createTask(101, 'low'))
    queue.enqueue(createTask(102, 'low'))
    queue.enqueue(createTask(999, 'high'))

    // 等待全部任务执行完成
    await new Promise((resolve) => setTimeout(resolve, 150))

    // 999 是高优先级，应被排在前面执行
    expect(executedOrder[0]).toBe(101) // 101 入队时 worker 闲置立即启动
    expect(executedOrder[1]).toBe(999) // 999 插入高优先队列，先于 102 执行
    expect(executedOrder[2]).toBe(102)
  })

  it('promote 方法支持即时插队：将低优先级队列中的课程提升至队首最高优先级', async () => {
    const executedOrder: number[] = []
    const queue = new CanvasScanQueue(1, 20)

    const createTask = (courseId: number): ScanTaskOptions => ({
      courseId,
      priority: 'low',
      scanFiles: async (id) => {
        executedOrder.push(id)
      }
    })

    queue.enqueue(createTask(1))
    queue.enqueue(createTask(2))
    queue.enqueue(createTask(3))
    queue.enqueue(createTask(4))

    // 用户在界面点击了课程 4，触发插队
    queue.promote(4)

    await new Promise((resolve) => setTimeout(resolve, 250))

    // 课程 1 正在执行，课程 4 被插队到第 2 个执行
    expect(executedOrder[0]).toBe(1)
    expect(executedOrder[1]).toBe(4)
    expect(executedOrder).toContain(2)
    expect(executedOrder).toContain(3)
  })

  it('支持并发限制 (如限制并发度为 2)', async () => {
    let activeWorkers = 0
    let maxConcurrent = 0
    const queue = new CanvasScanQueue(2, 10)

    const createTask = (courseId: number): ScanTaskOptions => ({
      courseId,
      priority: 'normal',
      scanFiles: async () => {
        activeWorkers++
        maxConcurrent = Math.max(maxConcurrent, activeWorkers)
        await new Promise((r) => setTimeout(r, 30))
        activeWorkers--
      }
    })

    for (let i = 1; i <= 6; i++) {
      queue.enqueue(createTask(i))
    }

    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(maxConcurrent).toBeLessThanOrEqual(2)
    expect(activeWorkers).toBe(0)
  })

  it('防重保护：对于已排队或已完成的 courseId，不会重复入队', async () => {
    let callCount = 0
    const queue = new CanvasScanQueue(1, 5)

    const task: ScanTaskOptions = {
      courseId: 88,
      priority: 'normal',
      scanFiles: async () => {
        callCount++
      }
    }

    queue.enqueue(task)
    queue.enqueue(task)
    queue.enqueue(task)

    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(callCount).toBe(1)
  })

  it('clear 方法可彻底清空队列与重置状态', async () => {
    const executed: number[] = []
    const queue = new CanvasScanQueue(1, 50)

    queue.enqueue({
      courseId: 1,
      scanFiles: async (id) => {
        executed.push(id)
      }
    })
    queue.enqueue({
      courseId: 2,
      scanFiles: async (id) => {
        executed.push(id)
      }
    })

    // 立即清空
    queue.clear()

    await new Promise((resolve) => setTimeout(resolve, 100))

    // 只有在 clear 瞬间如果 1 已经启动可能执行，但 2 绝对不能被执行
    expect(executed).not.toContain(2)
  })
})
