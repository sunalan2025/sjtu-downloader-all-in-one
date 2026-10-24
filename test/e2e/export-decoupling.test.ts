import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs'

// ─── Mock Electron & Window ─────────────────────────────────────────
vi.mock('../../src/main/window', () => ({
  getIsQuitting: () => false,
  getMainWindow: () => null
}))

vi.mock('electron', () => {
  const listeners: Record<string, Function[]> = {}
  return {
    BrowserWindow: class {
      loadURL = vi.fn().mockResolvedValue(undefined)
      webContents = {
        getURL: () => 'https://oc.sjtu.edu.cn',
        executeJavaScript: vi.fn().mockResolvedValue('<html></html>'),
        setAudioMuted: vi.fn()
      }
      isDestroyed = () => false
      destroy = vi.fn()
    },
    app: {
      whenReady: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockReturnValue(true),
      quit: vi.fn(),
      getPath: (name: string) => join(tmpdir(), `sjtu-test-${name}`)
    },
    session: {
      fromPartition: vi.fn()
    },
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn((event: string, handler: Function) => {
        if (!listeners[event]) listeners[event] = []
        listeners[event].push(handler)
      })
    }
  }
})

import { downloadLectureTranscript } from '../../src/main/canvas/transcript-download'
import { downloadAssignmentArchive } from '../../src/main/canvas/assignment-download'
import type { CanvasAssignmentItem, DownloadTaskSpec } from '../../src/shared/types'
import {
  buildCloudRemoteSegments,
  formatCloudBreadcrumb,
  normalizeCloudPath,
  CLOUD_DEST_PRESETS
} from '../../src/shared/utils'
import {
  cloudRemotePath,
  cloudFolderSegments
} from '../../src/main/download-engine/cloud'
import { useAppStore } from '../../src/renderer/src/store/app'

describe('Decoupled Export Options and Cloud Destination E2E Test Suite', () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Canvas AI Speech Transcript Decoupled Export (downloadLectureTranscript)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('downloadLectureTranscript: Decoupled SRT & Markdown Export', () => {
    let testDir: string

    beforeEach(() => {
      testDir = mkdtempSync(join(tmpdir(), 'sjtu_e2e_transcript_'))
    })

    afterEach(() => {
      if (testDir && existsSync(testDir)) {
        try {
          rmSync(testDir, { recursive: true, force: true })
        } catch {
          // ignore cleanup errors
        }
      }
    })

    const sampleTranscriptApiData = [
      { startTime: 1200, endTime: 4500, text: '第一句：欢迎同学们学习操作系统原理。' },
      { startTime: 5000, endTime: 8200, text: '第二句：今天我们将讲解虚拟内存管理。' }
    ]

    const createMockSession = (apiData = sampleTranscriptApiData) => {
      return {
        fetch: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            code: 200,
            data: apiData
          })
        })
      } as any
    }

    const baseOpts = {
      courseName: '操作系统',
      term: '2026-2027-1',
      lectureName: '第3讲 虚拟内存',
      videoBaseName: '2026-10-19-陈老师-东中院1-101-教师',
      videoSession: {
        beginTime: '2026-10-19 14:00',
        teacher: '陈老师',
        classroom: '东中院1-101'
      },
      courseId: 54321,
      token: 'mock-auth-token-xyz'
    }

    it('generates only .md review note when exportSrt = false, exportMarkdown = true', async () => {
      const mockSes = createMockSession()
      const res = await downloadLectureTranscript(mockSes, {
        ...baseOpts,
        destRoot: testDir,
        exportSrt: false,
        exportMarkdown: true
      })

      expect(res.ok).toBe(true)
      expect(res.count).toBe(2)
      expect(res.srtPath).toBeUndefined()
      expect(res.mdPath).toBeDefined()

      // 验证 Markdown 文件落地且内容完整
      expect(existsSync(res.mdPath!)).toBe(true)
      const mdContent = readFileSync(res.mdPath!, 'utf-8')
      expect(mdContent).toContain('# 第3讲 虚拟内存 - AI 课堂语音逐字稿与复习笔记')
      expect(mdContent).toContain('陈老师')
      expect(mdContent).toContain('东中院1-101')
      expect(mdContent).toContain('第一句：欢迎同学们学习操作系统原理。')
      expect(mdContent).toContain('第二句：今天我们将讲解虚拟内存管理。')

      // 验证同目录未生成 .srt 字幕
      const targetDir = join(testDir, 'Canvas课程', '2026-2027-1/操作系统', 'videos', '课堂视频')
      const srtFile = join(targetDir, `${baseOpts.videoBaseName}.srt`)
      expect(existsSync(srtFile)).toBe(false)
    })

    it('generates only .srt subtitle when exportSrt = true, exportMarkdown = false', async () => {
      const mockSes = createMockSession()
      const res = await downloadLectureTranscript(mockSes, {
        ...baseOpts,
        destRoot: testDir,
        exportSrt: true,
        exportMarkdown: false
      })

      expect(res.ok).toBe(true)
      expect(res.count).toBe(2)
      expect(res.srtPath).toBeDefined()
      expect(res.mdPath).toBeUndefined()

      // 验证 SRT 字幕文件落地且符合标准 SubRip 时间轴规范
      expect(existsSync(res.srtPath!)).toBe(true)
      const srtContent = readFileSync(res.srtPath!, 'utf-8')
      expect(srtContent).toContain('1\r\n00:00:01,200 --> 00:00:04,500\r\n第一句：欢迎同学们学习操作系统原理。\r\n')
      expect(srtContent).toContain('2\r\n00:00:05,000 --> 00:00:08,200\r\n第二句：今天我们将讲解虚拟内存管理。\r\n')

      // 验证同目录未生成 .md 笔记
      const targetDir = join(testDir, 'Canvas课程', '2026-2027-1/操作系统', 'videos', '课堂视频')
      const mdFile = join(targetDir, `${baseOpts.videoBaseName}-AI逐字稿笔记.md`)
      expect(existsSync(mdFile)).toBe(false)
    })

    it('generates both .srt and .md files when exportSrt = true, exportMarkdown = true', async () => {
      const mockSes = createMockSession()
      const res = await downloadLectureTranscript(mockSes, {
        ...baseOpts,
        destRoot: testDir,
        exportSrt: true,
        exportMarkdown: true
      })

      expect(res.ok).toBe(true)
      expect(res.count).toBe(2)
      expect(res.srtPath).toBeDefined()
      expect(res.mdPath).toBeDefined()

      expect(existsSync(res.srtPath!)).toBe(true)
      expect(existsSync(res.mdPath!)).toBe(true)

      const srtContent = readFileSync(res.srtPath!, 'utf-8')
      expect(srtContent).toContain('第一句：欢迎同学们学习操作系统原理。')
      const mdContent = readFileSync(res.mdPath!, 'utf-8')
      expect(mdContent).toContain('第二句：今天我们将讲解虚拟内存管理。')
    })

    it('safely returns without generating any text files when both exportSrt and exportMarkdown are false', async () => {
      const mockSes = createMockSession()
      const res = await downloadLectureTranscript(mockSes, {
        ...baseOpts,
        destRoot: testDir,
        exportSrt: false,
        exportMarkdown: false
      })

      expect(res.ok).toBe(true)
      expect(res.count).toBe(2)
      expect(res.srtPath).toBeUndefined()
      expect(res.mdPath).toBeUndefined()

      const targetDir = join(testDir, 'Canvas课程', '2026-2027-1/操作系统', 'videos', '课堂视频')
      if (existsSync(targetDir)) {
        const files = readdirSync(targetDir)
        expect(files).toHaveLength(0)
      }
    })

    it('handles empty transcript response gracefully', async () => {
      const mockSes = createMockSession([])
      const res = await downloadLectureTranscript(mockSes, {
        ...baseOpts,
        destRoot: testDir,
        exportSrt: true,
        exportMarkdown: true
      })

      expect(res.ok).toBe(true)
      expect(res.count).toBe(0)
      expect(res.srtPath).toBeUndefined()
      expect(res.mdPath).toBeUndefined()
    })

    it('handles API failure without unhandled rejection', async () => {
      const failingSes = {
        fetch: vi.fn().mockRejectedValue(new Error('Network connection reset'))
      } as any

      const res = await downloadLectureTranscript(failingSes, {
        ...baseOpts,
        destRoot: testDir,
        exportSrt: true,
        exportMarkdown: true
      })

      expect(res.ok).toBe(true)
      expect(res.count).toBe(0)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Canvas Assignment & Submission Fine-Grained Decoupled Export
  // ─────────────────────────────────────────────────────────────────────────────
  describe('downloadAssignmentArchive: Fine-Grained Decoupled Options', () => {
    let testDir: string

    beforeEach(() => {
      testDir = mkdtempSync(join(tmpdir(), 'sjtu_e2e_assignment_'))
    })

    afterEach(() => {
      if (testDir && existsSync(testDir)) {
        try {
          rmSync(testDir, { recursive: true, force: true })
        } catch {
          // ignore cleanup errors
        }
      }
    })

    const sampleAssignment: CanvasAssignmentItem = {
      id: 901,
      name: '实验二_进程调度模拟',
      dueAt: '2026-11-05T23:59:00Z',
      pointsPossible: 100,
      hasSubmission: true,
      submittedAt: '2026-11-04T18:30:00Z',
      submissionScore: 95,
      submissionGrade: 'A',
      htmlUrl: 'https://oc.sjtu.edu.cn/courses/12345/assignments/901',
      descriptionHtml: '<p>请基于 <b>优先级队列</b> 实现多级反馈队列算法，并输出各进程周转时间。</p>',
      teacherAttachments: [
        { id: 11, name: '调度算法指导书.pdf', url: 'https://test/att/11', size: 10240 },
        { id: 12, name: '测试用例集.csv', url: 'https://test/att/12', size: 4096 }
      ],
      submissionFiles: [
        { id: 21, name: '学号_姓名_实验二报告.docx', url: 'https://test/sub/21', size: 20480 },
        { id: 22, name: 'scheduler.cpp', url: 'https://test/sub/22', size: 8192 }
      ],
      comments: [
        { authorName: '助教王五', comment: '时间片轮转逻辑实现正确，边界条件处理严密。', createdAt: '2026-11-06T10:00:00Z' }
      ]
    }

    const createMockSes = () => {
      return {
        fetch: vi.fn().mockImplementation(async (url: string) => {
          return {
            ok: true,
            arrayBuffer: async () => Buffer.from(`mock file buffer for: ${url}`)
          }
        })
      } as any
    }

    it('does not create 作业说明与评语.md nor submissions dir when exportMarkdown=false, downloadAttachments=true, downloadSubmissions=false', async () => {
      const mockSes = createMockSes()
      const res = await downloadAssignmentArchive(mockSes, {
        courseName: '操作系统',
        courseId: 12345,
        term: '2026-2027-1',
        assignment: sampleAssignment,
        destRoot: testDir,
        options: {
          exportMarkdown: false,
          downloadAttachments: true,
          downloadSubmissions: false
        }
      })

      expect(res.ok).toBe(true)
      expect(res.path).toBeDefined()
      const assignDir = res.path!

      // 验证未生成作业说明与评语.md
      expect(existsSync(join(assignDir, '作业说明与评语.md'))).toBe(false)
      // 验证未创建 submissions 目录
      expect(existsSync(join(assignDir, 'submissions'))).toBe(false)

      // 验证题目附件正常下载
      expect(existsSync(join(assignDir, 'attachments', '调度算法指导书.pdf'))).toBe(true)
      expect(existsSync(join(assignDir, 'attachments', '测试用例集.csv'))).toBe(true)
    })

    it('generates only 作业说明与评语.md when exportMarkdown=true, downloadAttachments=false, downloadSubmissions=false', async () => {
      const mockSes = createMockSes()
      const res = await downloadAssignmentArchive(mockSes, {
        courseName: '操作系统',
        courseId: 12345,
        term: '2026-2027-1',
        assignment: sampleAssignment,
        destRoot: testDir,
        options: {
          exportMarkdown: true,
          downloadAttachments: false,
          downloadSubmissions: false
        }
      })

      expect(res.ok).toBe(true)
      const assignDir = res.path!

      // 验证说明文档正常生成且包含完整内容
      const mdPath = join(assignDir, '作业说明与评语.md')
      expect(existsSync(mdPath)).toBe(true)
      const md = readFileSync(mdPath, 'utf-8')
      expect(md).toContain('# 实验二_进程调度模拟')
      expect(md).toContain('- **满分**: 100 分')
      expect(md).toContain('- **最终得分**: 95 分 (等级: A)')
      expect(md).toContain('优先级队列')
      expect(md).toContain('助教王五')
      expect(md).toContain('时间片轮转逻辑实现正确')

      // 验证未生成 attachments 与 submissions 目录
      expect(existsSync(join(assignDir, 'attachments'))).toBe(false)
      expect(existsSync(join(assignDir, 'submissions'))).toBe(false)
    })

    it('generates no files at all when all three options are false', async () => {
      const mockSes = createMockSes()
      const res = await downloadAssignmentArchive(mockSes, {
        courseName: '操作系统',
        courseId: 12345,
        term: '2026-2027-1',
        assignment: sampleAssignment,
        destRoot: testDir,
        options: {
          exportMarkdown: false,
          downloadAttachments: false,
          downloadSubmissions: false
        }
      })

      expect(res.ok).toBe(true)
      const assignDir = res.path!
      expect(existsSync(join(assignDir, '作业说明与评语.md'))).toBe(false)
      expect(existsSync(join(assignDir, 'attachments'))).toBe(false)
      expect(existsSync(join(assignDir, 'submissions'))).toBe(false)

      const remainingEntries = readdirSync(assignDir)
      expect(remainingEntries).toHaveLength(0)
    })

    it('downloads only submissions when exportMarkdown=false, downloadAttachments=false, downloadSubmissions=true', async () => {
      const mockSes = createMockSes()
      const res = await downloadAssignmentArchive(mockSes, {
        courseName: '操作系统',
        courseId: 12345,
        term: '2026-2027-1',
        assignment: sampleAssignment,
        destRoot: testDir,
        options: {
          exportMarkdown: false,
          downloadAttachments: false,
          downloadSubmissions: true
        }
      })

      expect(res.ok).toBe(true)
      const assignDir = res.path!
      expect(existsSync(join(assignDir, '作业说明与评语.md'))).toBe(false)
      expect(existsSync(join(assignDir, 'attachments'))).toBe(false)
      expect(existsSync(join(assignDir, 'submissions', '学号_姓名_实验二报告.docx'))).toBe(true)
      expect(existsSync(join(assignDir, 'submissions', 'scheduler.cpp'))).toBe(true)
    })

    it('downloads all assets by default when options are omitted', async () => {
      const mockSes = createMockSes()
      const res = await downloadAssignmentArchive(mockSes, {
        courseName: '操作系统',
        courseId: 12345,
        term: '2026-2027-1',
        assignment: sampleAssignment,
        destRoot: testDir
      })

      expect(res.ok).toBe(true)
      const assignDir = res.path!
      expect(existsSync(join(assignDir, '作业说明与评语.md'))).toBe(true)
      expect(existsSync(join(assignDir, 'attachments', '调度算法指导书.pdf'))).toBe(true)
      expect(existsSync(join(assignDir, 'submissions', '学号_姓名_实验二报告.docx'))).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Cloud Remote Path & Folder Segments Calculation
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Cloud Remote Path & Folder Segments Calculation', () => {
    const canvasSpec: DownloadTaskSpec = {
      taskId: 'canvas_spec_1',
      courseName: 'Canvas课程/2026-2027-1/计算机网络',
      fileName: '实验一_抓包分析.pkt',
      url: 'https://oc.sjtu.edu.cn/files/1001/download',
      source: 'canvas-files'
    } as any

    const cnmoocSpec: DownloadTaskSpec = {
      taskId: 'cnmooc_spec_1',
      courseName: '人工智能导论',
      term: '2026春',
      fileName: '第1讲_概述.mp4',
      url: 'https://cnmooc/video/1.mp4',
      source: 'cnmooc'
    } as any

    const standardSpec: DownloadTaskSpec = {
      taskId: 'std_spec_1',
      courseName: '高等数学(A)',
      term: '2026-2027-1',
      fileName: '第1讲_微积分基础.mp4',
      url: 'https://v.sjtu.edu.cn/video.mp4',
      source: 'v.sjtu'
    } as any

    describe('cloudDestRoot = "/SJTU课程备份" (Default Prefix)', () => {
      it('calculates remote path and folder segments with /SJTU课程备份 prefix', () => {
        const spec: DownloadTaskSpec = {
          ...canvasSpec,
          cloudDestRoot: '/SJTU课程备份'
        }
        expect(cloudFolderSegments(spec)).toEqual(['SJTU课程备份', '2026-2027-1', '计算机网络'])
        expect(cloudRemotePath(spec)).toBe('SJTU课程备份/2026-2027-1/计算机网络/实验一_抓包分析.pkt')

        const segments = buildCloudRemoteSegments('/SJTU课程备份', ['2026-2027-1', '计算机网络'])
        expect(segments).toEqual(['SJTU课程备份', '2026-2027-1', '计算机网络'])
      })

      it('applies to cnmooc specs as well', () => {
        const spec: DownloadTaskSpec = {
          ...cnmoocSpec,
          cloudDestRoot: '/SJTU课程备份'
        }
        expect(cloudFolderSegments(spec)).toEqual(['SJTU课程备份', '2026春', '人工智能导论'])
        expect(cloudRemotePath(spec)).toBe('SJTU课程备份/2026春/人工智能导论/第1讲_概述.mp4')
      })
    })

    describe('cloudDestRoot = "/" (Cloud Root Directory)', () => {
      it('calculates remote path directly from root with no extra top-level folder', () => {
        const spec: DownloadTaskSpec = {
          ...canvasSpec,
          cloudDestRoot: '/'
        }
        expect(cloudFolderSegments(spec)).toEqual(['2026-2027-1', '计算机网络'])
        expect(cloudRemotePath(spec)).toBe('2026-2027-1/计算机网络/实验一_抓包分析.pkt')

        const segments = buildCloudRemoteSegments('/', ['2026-2027-1', '计算机网络'])
        expect(segments).toEqual(['2026-2027-1', '计算机网络'])
      })

      it('handles cnmooc spec at root correctly', () => {
        const spec: DownloadTaskSpec = {
          ...cnmoocSpec,
          cloudDestRoot: '/'
        }
        expect(cloudFolderSegments(spec)).toEqual(['2026春', '人工智能导论'])
        expect(cloudRemotePath(spec)).toBe('2026春/人工智能导论/第1讲_概述.mp4')
      })
    })

    describe('cloudDestRoot = "/网课备份/2026" (Multi-Tier Custom Destination)', () => {
      it('splits multi-tier destination into separate clean folder segments', () => {
        const spec: DownloadTaskSpec = {
          ...canvasSpec,
          cloudDestRoot: '/网课备份/2026'
        }
        expect(cloudFolderSegments(spec)).toEqual(['网课备份', '2026', '2026-2027-1', '计算机网络'])
        expect(cloudRemotePath(spec)).toBe('网课备份/2026/2026-2027-1/计算机网络/实验一_抓包分析.pkt')

        const segments = buildCloudRemoteSegments('/网课备份/2026', ['2026-2027-1', '计算机网络'])
        expect(segments).toEqual(['网课备份', '2026', '2026-2027-1', '计算机网络'])
      })
    })

    describe('cloudDestRoot = undefined (Fallback to Type-Specific Default)', () => {
      it('falls back to "SJTU Canvas课程" for canvas specs', () => {
        const spec: DownloadTaskSpec = {
          ...canvasSpec,
          cloudDestRoot: undefined
        }
        expect(cloudFolderSegments(spec)).toEqual(['SJTU Canvas课程', '2026-2027-1', '计算机网络'])
        expect(cloudRemotePath(spec)).toBe('SJTU Canvas课程/2026-2027-1/计算机网络/实验一_抓包分析.pkt')

        const segments = buildCloudRemoteSegments(undefined, ['2026-2027-1', '计算机网络'], 'SJTU Canvas课程')
        expect(segments).toEqual(['SJTU Canvas课程', '2026-2027-1', '计算机网络'])
      })

      it('falls back to "SJTU好大学在线" for cnmooc specs', () => {
        const spec: DownloadTaskSpec = {
          ...cnmoocSpec,
          cloudDestRoot: undefined
        }
        expect(cloudFolderSegments(spec)).toEqual(['SJTU好大学在线', '2026春', '人工智能导论'])
        expect(cloudRemotePath(spec)).toBe('SJTU好大学在线/2026春/人工智能导论/第1讲_概述.mp4')
      })

      it('falls back to "SJTU旁听课程" for standard v.sjtu specs', () => {
        const spec: DownloadTaskSpec = {
          ...standardSpec,
          cloudDestRoot: undefined
        }
        expect(cloudFolderSegments(spec)).toEqual(['SJTU旁听课程', '2026-2027-1', '高等数学(A)'])
        expect(cloudRemotePath(spec)).toBe('SJTU旁听课程/2026-2027-1/高等数学(A)/第1讲_微积分基础.mp4')
      })
    })

    describe('Edge Cases, Path Normalization & Breadcrumb Formatting', () => {
      it('normalizes slashes, illegal chars, and whitespace in normalizeCloudPath', () => {
        expect(normalizeCloudPath('   ///网课备份//2026///   ')).toBe('/网课备份/2026')
        expect(normalizeCloudPath('')).toBe('/')
        expect(normalizeCloudPath('   ')).toBe('/')
        expect(normalizeCloudPath('//')).toBe('/')
        expect(normalizeCloudPath('///')).toBe('/')
        expect(normalizeCloudPath('D:\\SJTU\\课程')).toBe('/D/SJTU/课程')
        expect(normalizeCloudPath('/课程:测试*?<好>|')).toBe('/课程测试好')
      })

      it('formats breadcrumb according to root preset standards', () => {
        expect(formatCloudBreadcrumb('/SJTU课程备份')).toBe(
          '交大云盘 > SJTU课程备份 > 2026-2027学年第1学期 > 软件工程 > ...'
        )
        expect(formatCloudBreadcrumb('/')).toBe(
          '交大云盘 > 2026-2027学年第1学期 > 软件工程 > ...'
        )
        expect(formatCloudBreadcrumb('')).toBe(
          '交大云盘 > 2026-2027学年第1学期 > 软件工程 > ...'
        )
      })

      it('provides standardized presets', () => {
        expect(CLOUD_DEST_PRESETS).toHaveLength(3)
        expect(CLOUD_DEST_PRESETS.map(p => p.value)).toEqual(['/SJTU课程备份', '/', '/我的课程'])
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. UI Store State Isolation, Bidirectional Linkage & Persistence Defense
  // ─────────────────────────────────────────────────────────────────────────────
  describe('UI Store State Isolation, Bidirectional Linkage & Persistence Migration', () => {
    it('isolates canvasExportSrt and canvasExportMarkdown state and updates canvasExportAiTranscript link', () => {
      const store = useAppStore.getState()

      // 1. 初始重置为双全开状态
      store.setCanvasExportSrt(true)
      store.setCanvasExportMarkdown(true)
      expect(useAppStore.getState().canvasExportSrt).toBe(true)
      expect(useAppStore.getState().canvasExportMarkdown).toBe(true)
      expect(useAppStore.getState().canvasExportAiTranscript).toBe(true)

      // 2. 仅关闭 SRT：Markdown 保持开启，canvasExportAiTranscript 仍为 true
      store.setCanvasExportSrt(false)
      expect(useAppStore.getState().canvasExportSrt).toBe(false)
      expect(useAppStore.getState().canvasExportMarkdown).toBe(true)
      expect(useAppStore.getState().canvasExportAiTranscript).toBe(true)

      // 3. 接着关闭 Markdown：两者皆为 false，canvasExportAiTranscript 联动为 false
      store.setCanvasExportMarkdown(false)
      expect(useAppStore.getState().canvasExportSrt).toBe(false)
      expect(useAppStore.getState().canvasExportMarkdown).toBe(false)
      expect(useAppStore.getState().canvasExportAiTranscript).toBe(false)

      // 4. 重新单独开启 SRT：Markdown 保持 false，canvasExportAiTranscript 重新激活为 true
      store.setCanvasExportSrt(true)
      expect(useAppStore.getState().canvasExportSrt).toBe(true)
      expect(useAppStore.getState().canvasExportMarkdown).toBe(false)
      expect(useAppStore.getState().canvasExportAiTranscript).toBe(true)

      // 5. 使用传统总开关 setCanvasExportAiTranscript(false)：两子项同时被重置为 false
      store.setCanvasExportAiTranscript(false)
      expect(useAppStore.getState().canvasExportSrt).toBe(false)
      expect(useAppStore.getState().canvasExportMarkdown).toBe(false)
      expect(useAppStore.getState().canvasExportAiTranscript).toBe(false)

      // 6. 使用传统总开关 setCanvasExportAiTranscript(true)：两子项同时被恢复为 true
      store.setCanvasExportAiTranscript(true)
      expect(useAppStore.getState().canvasExportSrt).toBe(true)
      expect(useAppStore.getState().canvasExportMarkdown).toBe(true)
      expect(useAppStore.getState().canvasExportAiTranscript).toBe(true)
    })

    it('updates cloudDestRoot with default value and custom input', () => {
      const store = useAppStore.getState()

      // 初始默认值为 '/SJTU课程备份'
      store.setCloudDestRoot('/SJTU课程备份')
      expect(useAppStore.getState().cloudDestRoot).toBe('/SJTU课程备份')

      // 自定义路径输入
      store.setCloudDestRoot('/交大网盘存档/2026')
      expect(useAppStore.getState().cloudDestRoot).toBe('/交大网盘存档/2026')

      // 云盘根目录
      store.setCloudDestRoot('/')
      expect(useAppStore.getState().cloudDestRoot).toBe('/')

      // 还原
      store.setCloudDestRoot('/SJTU课程备份')
    })

    it('persists decoupled options and cloudDestRoot into partialize', () => {
      const store = useAppStore.getState()
      store.setCloudDestRoot('/工程测试备份')
      store.setCanvasExportSrt(true)
      store.setCanvasExportMarkdown(false)
      store.setCanvasAssignmentOptions({
        exportMarkdown: false,
        downloadAttachments: true,
        downloadSubmissions: false
      })

      const persistOptions = (useAppStore as any).persist?.getOptions?.()
      expect(persistOptions).toBeDefined()
      const partialized = persistOptions.partialize(useAppStore.getState())

      expect(partialized.cloudDestRoot).toBe('/工程测试备份')
      expect(partialized.canvasExportSrt).toBe(true)
      expect(partialized.canvasExportMarkdown).toBe(false)
      expect(partialized.canvasAssignmentOptions).toEqual({
        exportMarkdown: false,
        downloadAttachments: true,
        downloadSubmissions: false
      })

      // 还原
      store.setCloudDestRoot('/SJTU课程备份')
      store.setCanvasExportSrt(true)
      store.setCanvasExportMarkdown(true)
      store.setCanvasAssignmentOptions({
        exportMarkdown: true,
        downloadAttachments: true,
        downloadSubmissions: true
      })
    })

    it('defensively migrates legacy persisted state lacking decoupled export flags', () => {
      const persistOptions = (useAppStore as any).persist?.getOptions?.()
      expect(persistOptions?.merge).toBeDefined()
      const mergeFn = persistOptions.merge

      // 场景 1: 旧版本本地持久化中 canvasExportAiTranscript = false，无 srt / md 独立字段
      const legacyOff = mergeFn(
        {
          canvasExportAiTranscript: false
        },
        useAppStore.getState()
      )
      expect(legacyOff.canvasExportSrt).toBe(false)
      expect(legacyOff.canvasExportMarkdown).toBe(false)
      expect(legacyOff.canvasExportAiTranscript).toBe(false)
      expect(legacyOff.cloudDestRoot).toBe('/SJTU课程备份')

      // 场景 2: 旧版本本地持久化中 canvasExportAiTranscript = true，无 srt / md 独立字段
      const legacyOn = mergeFn(
        {
          canvasExportAiTranscript: true
        },
        useAppStore.getState()
      )
      expect(legacyOn.canvasExportSrt).toBe(true)
      expect(legacyOn.canvasExportMarkdown).toBe(true)
      expect(legacyOn.canvasExportAiTranscript).toBe(true)

      // 场景 3: 旧版本缺少 cloudDestRoot 与 canvasAssignmentOptions
      const legacyEmpty = mergeFn({}, useAppStore.getState())
      expect(legacyEmpty.cloudDestRoot).toBe('/SJTU课程备份')
      expect(legacyEmpty.canvasAssignmentOptions).toEqual({
        exportMarkdown: true,
        downloadAttachments: true,
        downloadSubmissions: true
      })
    })
  })
})
