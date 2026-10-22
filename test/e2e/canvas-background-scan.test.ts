import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CanvasScanQueue, type ScanTaskOptions } from '../../src/renderer/src/services/canvas-scan-queue'

describe('Canvas Silent Background Prescan Pipeline E2E & Integration Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('多学期模拟：当前学期活跃课程优先毫秒级就绪，随后历年历史课程静默排队', async () => {
    const scanLog: Array<{ courseId: number; phase: 'files' | 'videos'; time: number }> = []
    const startTime = Date.now()

    // 模拟 2 并发，15ms 间隙
    const queue = new CanvasScanQueue(2, 15)

    // 模拟 6 门课程：两门当前学期（2026_1），四门历史学期（2025_1, 2024_1）
    const mockCourses = [
      { id: 101, term: '2026-2027-1', name: '当前课程A' },
      { id: 102, term: '2026-2027-1', name: '当前课程B' },
      { id: 201, term: '2025-2026-1', name: '历史课程C' },
      { id: 202, term: '2025-2026-1', name: '历史课程D' },
      { id: 301, term: '2024-2025-1', name: '历史课程E' },
      { id: 302, term: '2024-2025-1', name: '历史课程F' }
    ]

    const primaryTerm = '2026-2027-1'

    // 入队逻辑与 CanvasBrowser 保持严格一致
    for (const c of mockCourses) {
      const isCurrentTerm = c.term === primaryTerm
      queue.enqueue({
        courseId: c.id,
        priority: isCurrentTerm ? 'high' : 'low',
        scanFiles: async (id) => {
          await new Promise((r) => setTimeout(r, 20))
          scanLog.push({ courseId: id, phase: 'files', time: Date.now() - startTime })
        },
        scanVideos: async (id) => {
          await new Promise((r) => setTimeout(r, 10))
          scanLog.push({ courseId: id, phase: 'videos', time: Date.now() - startTime })
        }
      })
    }

    // 等待所有课程在后台管线中静默处理完成
    await new Promise((resolve) => setTimeout(resolve, 350))

    // 验证：当前学期课程 101 与 102 的 files 阶段必须排在前两位执行完成
    const firstTwoScannedFiles = scanLog.filter((l) => l.phase === 'files').slice(0, 2).map((l) => l.courseId)
    expect(firstTwoScannedFiles).toContain(101)
    expect(firstTwoScannedFiles).toContain(102)

    // 验证：所有 6 门课程最终全部无感就绪
    const allScannedCourses = new Set(scanLog.map((l) => l.courseId))
    expect(allScannedCourses.size).toBe(6)
  })

  it('交互即时插队：用户点击/悬停未扫描历史课程时，该课程立即抢占队首优先完成', async () => {
    const executedOrder: number[] = []
    const queue = new CanvasScanQueue(1, 10)

    const createTask = (courseId: number, priority: 'high' | 'low'): ScanTaskOptions => ({
      courseId,
      priority,
      scanFiles: async (id) => {
        await new Promise((r) => setTimeout(r, 30))
        executedOrder.push(id)
      }
    })

    // 模拟课程列表入队：1 正在执行，2、3、4 在低优先级排队
    queue.enqueue(createTask(1, 'low'))
    queue.enqueue(createTask(2, 'low'))
    queue.enqueue(createTask(3, 'low'))
    queue.enqueue(createTask(4, 'low'))

    // 用户在界面悬停或点击了历史课程 3
    queue.promote(3)

    // 等待全部任务执行完成
    await new Promise((resolve) => setTimeout(resolve, 250))

    // 课程 1 正在占用 worker，课程 3 插队到第 2 个执行，先于 2 和 4
    expect(executedOrder[0]).toBe(1)
    expect(executedOrder[1]).toBe(3)
    expect(executedOrder[2]).toBe(2)
    expect(executedOrder[3]).toBe(4)
  })

  it('缓存跳过与防重标记：已就绪课程通过 markCompleted 跳过，杜绝重复网络请求', async () => {
    let networkRequestCount = 0
    const queue = new CanvasScanQueue(2, 10)

    // 模拟已经缓存在 store 中的课程 501
    queue.markCompleted(501)

    // 尝试重新入队 501
    queue.enqueue({
      courseId: 501,
      scanFiles: async () => {
        networkRequestCount++
      }
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    // 501 已被标记完成，绝对不触发 scanFiles
    expect(networkRequestCount).toBe(0)
  })
})
