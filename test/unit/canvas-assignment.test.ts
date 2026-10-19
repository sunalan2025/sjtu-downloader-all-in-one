import { describe, it, expect, vi } from 'vitest'
import {
  convertHtmlToMarkdown,
  sanitizeHtmlFallback,
  compileAssignmentMarkdown,
  fetchCourseAssignments,
  downloadAssignmentArchive
} from '../../src/main/canvas/assignment-download'
import type { CanvasAssignmentItem } from '../../src/shared/types'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, readFileSync, rmSync } from 'node:fs'

describe('Canvas Assignment Archive Unit Tests', () => {
  const sampleAssignment: CanvasAssignmentItem = {
    id: 101,
    name: '实验报告1_酶动力学',
    dueAt: '2026-10-20T23:59:00Z',
    pointsPossible: 100,
    hasSubmission: true,
    submittedAt: '2026-10-19T14:30:12Z',
    submissionScore: 96,
    submissionGrade: 'A',
    htmlUrl: 'https://oc.sjtu.edu.cn/courses/93803/assignments/101',
    descriptionHtml: '<p>请根据实验测得的数据绘制双倒数作图，求出Km与Vmax。</p>',
    teacherAttachments: [
      { id: 1, name: '实验讲义.pdf', url: 'https://oc.sjtu.edu.cn/files/1', size: 102400 }
    ],
    submissionFiles: [
      { id: 2, name: '学生报告.docx', url: 'https://oc.sjtu.edu.cn/files/2', size: 204800 }
    ],
    comments: [
      { authorName: '助教张三', comment: '数据拟合曲线标准，误差分析到位。', createdAt: '2026-10-22T10:15:00Z' }
    ]
  }

  describe('convertHtmlToMarkdown', () => {
    it('converts paragraphs, links, bold, and list elements properly', () => {
      const html = '<p>请阅读 <b>实验手册</b> 并完成 <a href="http://example.com/guide.pdf">下载</a>。</p><ul><li>第一步</li><li>第二步</li></ul>'
      const md = convertHtmlToMarkdown(html)
      expect(md).toContain('**实验手册**')
      expect(md).toContain('[下载](http://example.com/guide.pdf)')
      expect(md).toContain('- 第一步')
      expect(md).toContain('- 第二步')
    })

    it('returns placeholder on null or empty input', () => {
      expect(convertHtmlToMarkdown('')).toBe('*(无题目要求描述)*')
      expect(convertHtmlToMarkdown(undefined)).toBe('*(无题目要求描述)*')
    })

    it('handles nested tags properly in sanitizeHtmlFallback without escaping', () => {
      const maliciousHtml = '<scr<script>ipt>alert(1)</script>完成<b>报告</b>'
      const result = sanitizeHtmlFallback(maliciousHtml)
      expect(result).not.toContain('<script>')
      expect(result).not.toContain('<scr')
      expect(result).toContain('完成')
      expect(result).toContain('报告')
    })
  })

  describe('compileAssignmentMarkdown', () => {
    it('compiles full markdown containing title, metadata, requirements, attachments, submissions, and comments', () => {
      const md = compileAssignmentMarkdown(sampleAssignment)
      expect(md).toContain('# 实验报告1_酶动力学')
      expect(md).toContain('- **满分**: 100 分')
      expect(md).toContain('- **提交状态**: 已提交')
      expect(md).toContain('- **最终得分**: 96 分 (等级: A)')
      expect(md).toContain('请根据实验测得的数据绘制双倒数作图')
      expect(md).toContain('[实验讲义.pdf](./attachments/%E5%AE%9E%E9%AA%8C%E8%AE%B2%E4%B9%89.pdf)')
      expect(md).toContain('[学生报告.docx](./submissions/%E5%AD%A6%E7%94%9F%E6%8A%A5%E5%91%8A.docx)')
      expect(md).toContain('助教张三')
      expect(md).toContain('数据拟合曲线标准，误差分析到位。')
    })
  })

  describe('fetchCourseAssignments', () => {
    it('calls assignments API and maps results', async () => {
      const mockSes = {
        fetch: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [
            {
              id: 501,
              name: '大作业',
              due_at: '2026-11-01T23:59:00Z',
              points_possible: 100,
              submission: {
                workflow_state: 'submitted',
                submitted_at: '2026-10-31T20:00:00Z',
                score: 95,
                attachments: [{ id: 10, display_name: '作业.pdf', url: 'https://download/1' }],
                submission_comments: [{ author_name: '李老师', comment: '很好' }]
              },
              attachments: [{ id: 11, display_name: '要求.docx', url: 'https://download/2' }]
            }
          ]
        })
      } as any

      const res = await fetchCourseAssignments(mockSes, 93803)
      expect(res).toHaveLength(1)
      expect(res[0].id).toBe(501)
      expect(res[0].name).toBe('大作业')
      expect(res[0].hasSubmission).toBe(true)
      expect(res[0].submissionFiles).toHaveLength(1)
      expect(res[0].teacherAttachments).toHaveLength(1)
      expect(res[0].comments).toHaveLength(1)
      expect(res[0].comments[0].comment).toBe('很好')
    })
  })

  describe('downloadAssignmentArchive', () => {
    const testDir = join(tmpdir(), `test_assignment_${Date.now()}`)

    it('downloads assignment markdown and attachment files', async () => {
      const sampleItem: CanvasAssignmentItem = {
        id: 701,
        name: '期中作业',
        hasSubmission: true,
        teacherAttachments: [{ id: 1, name: '指导书.txt', url: 'http://test/file1' }],
        submissionFiles: [{ id: 2, name: '提交.txt', url: 'http://test/file2' }],
        comments: []
      }

      const mockSes = {
        fetch: vi.fn().mockImplementation(async (url: string) => {
          return {
            ok: true,
            arrayBuffer: async () => Buffer.from(`content of ${url}`)
          }
        })
      } as any

      const res = await downloadAssignmentArchive(mockSes, {
        courseName: '生物化学',
        courseId: 93803,
        assignment: sampleItem,
        destRoot: testDir
      })

      expect(res.ok).toBe(true)
      expect(res.path).toBeDefined()
      expect(existsSync(join(res.path!, '作业说明与评语.md'))).toBe(true)
      expect(existsSync(join(res.path!, 'attachments', '指导书.txt'))).toBe(true)
      expect(existsSync(join(res.path!, 'submissions', '提交.txt'))).toBe(true)

      const md = readFileSync(join(res.path!, '作业说明与评语.md'), 'utf-8')
      expect(md).toContain('# 期中作业')

      // 清理
      try { rmSync(testDir, { recursive: true, force: true }) } catch {}
    })

    it('falls back to mkdtempSync-created secure temp directory when destRoot is empty', async () => {
      const mockSes = {
        fetch: vi.fn()
      } as any

      const res = await downloadAssignmentArchive(mockSes, {
        courseName: '生物化学',
        courseId: 93803,
        assignment: { ...sampleAssignment, teacherAttachments: [], submissionFiles: [] },
        destRoot: ''
      })

      expect(res.ok).toBe(true)
      expect(res.path).toBeDefined()
      expect(res.path).toContain('sjtu-canvas-assign-')
      if (res.path) {
        try { rmSync(res.path, { recursive: true, force: true }) } catch {}
      }
    })
  })
})
