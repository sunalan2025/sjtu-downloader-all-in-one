import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatSrtTime,
  formatTimelineTime,
  normalizeTranscriptItems,
  convertAiTranscriptToSrt,
  convertAiTranscriptToMarkdown,
  fetchAiTranscript,
  downloadLectureTranscript
} from '../../src/main/canvas/transcript-download'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, readFileSync, rmSync } from 'node:fs'

describe('Canvas AI Speech Transcript & SRT Generator Unit Tests', () => {
  describe('formatSrtTime', () => {
    it('formats 0 ms correctly', () => {
      expect(formatSrtTime(0)).toBe('00:00:00,000')
    })

    it('formats seconds and milliseconds correctly', () => {
      expect(formatSrtTime(1200)).toBe('00:00:01,200')
      expect(formatSrtTime(65432)).toBe('00:01:05,432')
    })

    it('formats hours, minutes, seconds and milliseconds correctly', () => {
      expect(formatSrtTime(3661005)).toBe('01:01:01,005')
      expect(formatSrtTime(7325999)).toBe('02:02:05,999')
    })

    it('handles negative, NaN and non-finite values gracefully', () => {
      expect(formatSrtTime(-500)).toBe('00:00:00,000')
      expect(formatSrtTime(NaN)).toBe('00:00:00,000')
      expect(formatSrtTime(Infinity)).toBe('00:00:00,000')
    })
  })

  describe('formatTimelineTime', () => {
    it('formats less than an hour as mm:ss', () => {
      expect(formatTimelineTime(0)).toBe('00:00')
      expect(formatTimelineTime(65000)).toBe('01:05')
      expect(formatTimelineTime(3599000)).toBe('59:59')
    })

    it('formats one hour or more as HH:mm:ss', () => {
      expect(formatTimelineTime(3600000)).toBe('01:00:00')
      expect(formatTimelineTime(3665000)).toBe('01:01:05')
    })
  })

  describe('normalizeTranscriptItems', () => {
    it('normalizes various raw field names and sorts by startTime', () => {
      const raw = [
        { beginTime: 5000, end: 8000, content: '第二句话' },
        { start: 1000, endTime: 4000, text: '第一句话' },
        { startTime: '9000', endTime: '12000', sentence: '第三句话' },
        { startTime: 15000, text: '' } // 空文本被过滤
      ]

      const items = normalizeTranscriptItems(raw)
      expect(items).toHaveLength(3)
      expect(items[0]).toEqual({ startTime: 1000, endTime: 4000, text: '第一句话' })
      expect(items[1]).toEqual({ startTime: 5000, endTime: 8000, text: '第二句话' })
      expect(items[2]).toEqual({ startTime: 9000, endTime: 12000, text: '第三句话' })
    })

    it('returns empty array on non-array input', () => {
      expect(normalizeTranscriptItems(null)).toEqual([])
      expect(normalizeTranscriptItems(undefined)).toEqual([])
      expect(normalizeTranscriptItems({})).toEqual([])
    })
  })

  describe('convertAiTranscriptToSrt', () => {
    it('converts transcript items to standard SubRip (.srt) format with CRLF', () => {
      const items = [
        { startTime: 1200, endTime: 4500, text: '同学们好，今天我们开始讲生物化学第五章。' },
        { startTime: 4800, endTime: 8200, text: '重点关注流感嗜血杆菌的全基因组序列比对。' }
      ]

      const srt = convertAiTranscriptToSrt(items)
      expect(srt).toContain('1\r\n00:00:01,200 --> 00:00:04,500\r\n同学们好，今天我们开始讲生物化学第五章。\r\n')
      expect(srt).toContain('2\r\n00:00:04,800 --> 00:00:08,200\r\n重点关注流感嗜血杆菌的全基因组序列比对。\r\n')
    })

    it('returns empty string on empty items', () => {
      expect(convertAiTranscriptToSrt([])).toBe('')
    })
  })

  describe('convertAiTranscriptToMarkdown', () => {
    const meta = {
      courseName: '生物化学与分子生物学',
      lectureName: '第5讲 基因组学概论',
      teacher: '梁如冰',
      classroom: '东中院2-203',
      beginTime: '2026-10-12 14:00'
    }

    it('compiles structured Markdown notes with metadata and timeline bullets', () => {
      const items = [
        { startTime: 83000, endTime: 86000, text: '现在我们来看真核生物基因组的特点。' }
      ]

      const md = convertAiTranscriptToMarkdown(items, meta)
      expect(md).toContain('# 第5讲 基因组学概论 - AI 课堂语音逐字稿与复习笔记')
      expect(md).toContain('- **所属课程**: 生物化学与分子生物学')
      expect(md).toContain('- **主讲教师**: 梁如冰')
      expect(md).toContain('- **授课教室**: 东中院2-203')
      expect(md).toContain('- **授课时间**: 2026-10-12 14:00')
      expect(md).toContain('### [01:23]')
      expect(md).toContain('现在我们来看真核生物基因组的特点。')
    })

    it('handles empty transcript items with friendly notice', () => {
      const md = convertAiTranscriptToMarkdown([], meta)
      expect(md).toContain('*(本讲课堂实录暂未生成语音识别逐字稿)*')
    })
  })

  describe('fetchAiTranscript', () => {
    it('fetches and unwraps data payload from API', async () => {
      const mockSes = {
        fetch: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            code: 200,
            data: [
              { startTime: 1000, endTime: 3000, text: '测试语句1' }
            ]
          })
        })
      } as any

      const res = await fetchAiTranscript(mockSes, 'test-token', 98765)
      expect(res).toHaveLength(1)
      expect(res[0].text).toBe('测试语句1')
    })

    it('returns empty array when API returns non-200 or throws', async () => {
      const mockSes = {
        fetch: vi.fn().mockResolvedValue({ ok: false, status: 500 })
      } as any

      const res = await fetchAiTranscript(mockSes, 'test-token', 98765)
      expect(res).toEqual([])
    })
  })

  describe('downloadLectureTranscript', () => {
    const testDir = join(tmpdir(), 'test_canvas_transcript_' + Date.now())

    afterEach(() => {
      if (existsSync(testDir)) {
        try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore */ }
      }
    })

    it('fetches transcript and writes both .srt and .md to disk', async () => {
      const mockSes = {
        fetch: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [
            { startTime: 2000, endTime: 5000, text: '第一句课堂发言。' }
          ]
        })
      } as any

      const res = await downloadLectureTranscript(mockSes, {
        courseName: '生物化学',
        term: '2026-2027-1',
        lectureName: '第1讲 绪论',
        videoBaseName: '2026-10-12-梁如冰-东中院2-203-教师',
        videoSession: {
          beginTime: '2026-10-12 10:00',
          teacher: '梁如冰',
          classroom: '东中院2-203'
        },
        destRoot: testDir,
        courseId: 12345,
        token: 'mock-jwt-token'
      })

      expect(res.ok).toBe(true)
      expect(res.count).toBe(1)
      expect(res.srtPath).toBeDefined()
      expect(res.mdPath).toBeDefined()

      expect(existsSync(res.srtPath!)).toBe(true)
      expect(existsSync(res.mdPath!)).toBe(true)

      const srtText = readFileSync(res.srtPath!, 'utf-8')
      expect(srtText).toContain('00:00:02,000 --> 00:00:05,000')
      expect(srtText).toContain('第一句课堂发言。')

      const mdText = readFileSync(res.mdPath!, 'utf-8')
      expect(mdText).toContain('# 第1讲 绪论 - AI 课堂语音逐字稿与复习笔记')
      expect(mdText).toContain('第一句课堂发言。')
    })
  })
})
