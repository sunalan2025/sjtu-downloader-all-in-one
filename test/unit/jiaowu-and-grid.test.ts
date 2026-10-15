import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchJiaowuSchedule,
  isJiaowuSessionValid,
  invalidateJiaowuLogin
} from '../../src/main/schedule/schedule-fetcher'
import {
  isWeekInZcd,
  getSlotIdFromJc,
  getSlotIdFromTime,
  getSlotRangeFromJc,
  getSlotRangeFromTime,
  clusterDayEvents,
  getEventDisplayTime,
  parseWeekNumber,
  formatWeeksRange,
  SJTU_TIME_SLOTS
} from '../../src/renderer/src/pages/ScheduleBrowser'
import { isSafeExternalUrl, normalizeCanvasUrl } from '../../src/shared/utils'

describe('Jiaowu Schedule & Horizontal Grid Unit Tests', () => {
  beforeEach(() => {
    invalidateJiaowuLogin()
    vi.restoreAllMocks()
  })

  describe('isWeekInZcd (周次匹配规则)', () => {
    it('matches single week "第12周" or "12周"', () => {
      expect(isWeekInZcd(12, '第12周')).toBe(true)
      expect(isWeekInZcd(12, '12周')).toBe(true)
      expect(isWeekInZcd(11, '第12周')).toBe(false)
    })

    it('matches standard range "1-16周"', () => {
      expect(isWeekInZcd(1, '1-16周')).toBe(true)
      expect(isWeekInZcd(8, '1-16周')).toBe(true)
      expect(isWeekInZcd(16, '1-16周')).toBe(true)
      expect(isWeekInZcd(17, '1-16周')).toBe(false)
    })

    it('matches odd weeks "1-15周(单)"', () => {
      expect(isWeekInZcd(1, '1-15周(单)')).toBe(true)
      expect(isWeekInZcd(3, '1-15周(单)')).toBe(true)
      expect(isWeekInZcd(15, '1-15周(单)')).toBe(true)
      expect(isWeekInZcd(2, '1-15周(单)')).toBe(false)
      expect(isWeekInZcd(4, '1-15周(单)')).toBe(false)
      expect(isWeekInZcd(17, '1-15周(单)')).toBe(false)
    })

    it('matches even weeks "2-16周(双)"', () => {
      expect(isWeekInZcd(2, '2-16周(双)')).toBe(true)
      expect(isWeekInZcd(4, '2-16周(双)')).toBe(true)
      expect(isWeekInZcd(16, '2-16周(双)')).toBe(true)
      expect(isWeekInZcd(1, '2-16周(双)')).toBe(false)
      expect(isWeekInZcd(3, '2-16周(双)')).toBe(false)
    })

    it('matches complex comma-separated patterns', () => {
      const pattern = '1-11周,13-16周'
      expect(isWeekInZcd(5, pattern)).toBe(true)
      expect(isWeekInZcd(11, pattern)).toBe(true)
      expect(isWeekInZcd(12, pattern)).toBe(false)
      expect(isWeekInZcd(13, pattern)).toBe(true)
      expect(isWeekInZcd(16, pattern)).toBe(true)

      const mixed = '6周,10周,14-15周'
      expect(isWeekInZcd(6, mixed)).toBe(true)
      expect(isWeekInZcd(7, mixed)).toBe(false)
      expect(isWeekInZcd(10, mixed)).toBe(true)
      expect(isWeekInZcd(14, mixed)).toBe(true)
      expect(isWeekInZcd(15, mixed)).toBe(true)
      expect(isWeekInZcd(16, mixed)).toBe(false)
    })
  })

  describe('getSlotRangeFromJc (教务节次到标准时段范围与 Row Span 跨行映射)', () => {
    it('maps standard 2-period courses to span 1', () => {
      expect(getSlotRangeFromJc('1-2节')).toEqual({
        startSlot: 1,
        endSlot: 1,
        span: 1,
        badge: undefined,
        isLabOrLongSession: false
      })
      expect(getSlotRangeFromJc('3-4节')).toEqual({
        startSlot: 2,
        endSlot: 2,
        span: 1,
        badge: undefined,
        isLabOrLongSession: false
      })
      expect(getSlotRangeFromJc('5-6节')).toEqual({
        startSlot: 3,
        endSlot: 3,
        span: 1,
        badge: undefined,
        isLabOrLongSession: false
      })
      expect(getSlotRangeFromJc('7-8节')).toEqual({
        startSlot: 4,
        endSlot: 4,
        span: 1,
        badge: undefined,
        isLabOrLongSession: false
      })
      expect(getSlotRangeFromJc('9-10节')).toEqual({
        startSlot: 5,
        endSlot: 5,
        span: 1,
        badge: undefined,
        isLabOrLongSession: false
      })
      expect(getSlotRangeFromJc('11-12节')).toEqual({
        startSlot: 6,
        endSlot: 6,
        span: 1,
        badge: undefined,
        isLabOrLongSession: false
      })
    })

    it('maps 6-8 ideological class (思政大课) to span 2 (12:55~15:40, 跨中午与下午)', () => {
      const res = getSlotRangeFromJc('6-8节')
      expect(res.startSlot).toBe(3)
      expect(res.endSlot).toBe(4)
      expect(res.span).toBe(2)
      expect(res.badge).toContain('6-8节大课')
      expect(getSlotIdFromJc('6-8节')).toBe(3)
    })

    it('maps 6-9 lab class (ET创新实验/无机实验) to span 3 (12:55~16:45, 跨中午至下午第2大节)', () => {
      const res = getSlotRangeFromJc('6-9节')
      expect(res.startSlot).toBe(3)
      expect(res.endSlot).toBe(5)
      expect(res.span).toBe(3)
      expect(res.isLabOrLongSession).toBe(true)
      expect(res.badge).toContain('6-9节实验')
    })

    it('maps 5-10 ultra-long lab class (有机化学实验) to span 3 (12:00~17:40, 贯穿整个下午)', () => {
      const res = getSlotRangeFromJc('5-10节')
      expect(res.startSlot).toBe(3)
      expect(res.endSlot).toBe(5)
      expect(res.span).toBe(3)
      expect(res.isLabOrLongSession).toBe(true)
      expect(res.badge).toContain('5-10节大实验')
    })

    it('maps 7-10 lab class to span 2 (14:00~17:40)', () => {
      const res = getSlotRangeFromJc('7-10节')
      expect(res.startSlot).toBe(4)
      expect(res.endSlot).toBe(5)
      expect(res.span).toBe(2)
      expect(res.isLabOrLongSession).toBe(true)
    })

    it('maps evening extended courses (11-13节, 11-14节)', () => {
      const res13 = getSlotRangeFromJc('11-13节')
      expect(res13.startSlot).toBe(6)
      expect(res13.endSlot).toBe(6)
      expect(res13.badge).toContain('11-13节')

      const res14 = getSlotRangeFromJc('11-14节')
      expect(res14.startSlot).toBe(6)
      expect(res14.endSlot).toBe(6)
      expect(res14.badge).toContain('11-14节')
      expect(res14.isLabOrLongSession).toBe(true)
    })
  })

  describe('getSlotRangeFromTime (时间时刻到标准时段范围与跨行数映射)', () => {
    it('maps standard morning/afternoon times', () => {
      expect(getSlotRangeFromTime('08:00', '09:40').span).toBe(1)
      expect(getSlotRangeFromTime('10:00', '11:40').span).toBe(1)
      expect(getSlotRangeFromTime('14:00', '15:40').span).toBe(1)
      expect(getSlotRangeFromTime('16:00', '17:40').span).toBe(1)
      expect(getSlotRangeFromTime('18:00', '21:30').span).toBe(1)
    })

    it('maps 12:00 ~ 17:40 long lab to span 3', () => {
      const res = getSlotRangeFromTime('12:00', '17:40')
      expect(res.startSlot).toBe(3)
      expect(res.endSlot).toBe(5)
      expect(res.span).toBe(3)
      expect(res.isLabOrLongSession).toBe(true)
    })

    it('maps 12:55 ~ 15:40 ideological course to span 2', () => {
      const res = getSlotRangeFromTime('12:55', '15:40')
      expect(res.startSlot).toBe(3)
      expect(res.endSlot).toBe(4)
      expect(res.span).toBe(2)
    })
  })

  describe('clusterDayEvents (同一天重叠事件聚类避免 CSS Grid 遮挡)', () => {
    it('groups single non-overlapping events independently', () => {
      const events = [
        {
          id: '1',
          title: '有机化学实验',
          startTime: '5-10节',
          type: 'course' as const,
          dayIndex: 0,
          startSlot: 3,
          endSlot: 5,
          span: 3,
          isLabOrLongSession: true
        }
      ]
      const clusters = clusterDayEvents(events)
      expect(clusters).toHaveLength(1)
      expect(clusters[0].startSlot).toBe(3)
      expect(clusters[0].endSlot).toBe(5)
      expect(clusters[0].span).toBe(3)
      expect(clusters[0].events).toHaveLength(1)
    })

    it('clusters overlapping events into one multi-column container', () => {
      const events = [
        {
          id: 'c1',
          title: '形势与政策',
          startTime: '9-10节',
          type: 'course' as const,
          dayIndex: 2,
          startSlot: 5,
          endSlot: 5,
          span: 1,
          isLabOrLongSession: false
        },
        {
          id: 'c2',
          title: '学术讲座',
          startTime: '16:00',
          endTime: '17:30',
          type: 'activity' as const,
          dayIndex: 2,
          startSlot: 5,
          endSlot: 5,
          span: 1,
          isLabOrLongSession: false
        }
      ]
      const clusters = clusterDayEvents(events)
      expect(clusters).toHaveLength(1)
      expect(clusters[0].startSlot).toBe(5)
      expect(clusters[0].endSlot).toBe(5)
      expect(clusters[0].events).toHaveLength(2)
    })
  })

  describe('getEventDisplayTime (作息时间文本规范展示)', () => {
    it('formats 12:55 ideological block distinctly', () => {
      const ideologicalEvent = {
        id: 'test-1',
        title: '思想道德与法治',
        startTime: '2026-10-14 12:55:00',
        endTime: '2026-10-14 15:40:00',
        type: 'course' as const
      }
      expect(getEventDisplayTime(ideologicalEvent)).toBe('12:55 ~ 15:40 (第6-8节)')
    })

    it('formats 5-10节 long lab course with full time range and duration', () => {
      const labEvent = {
        id: 'test-lab',
        title: '有机化学实验 (1)',
        startTime: '5-10节',
        endTime: '1-16周',
        type: 'course' as const
      }
      expect(getEventDisplayTime(labEvent)).toBe('5-10节 (12:00 ~ 17:40 · 6节连堂)')
    })

    it('formats 6-9节 ET lab course with full time range', () => {
      const etLab = {
        id: 'test-et',
        title: 'ET创新实验',
        startTime: '6-9节',
        endTime: '1-16周',
        type: 'course' as const
      }
      expect(getEventDisplayTime(etLab)).toBe('6-9节 (12:55 ~ 16:45 · 4节连堂)')
    })

    it('formats standard time string cleanly', () => {
      const peEvent = {
        id: 'test-2',
        title: '体育(4)-激光射击',
        startTime: '2026-10-14 14:00:00',
        endTime: '2026-10-14 15:40:00',
        type: 'course' as const
      }
      expect(getEventDisplayTime(peEvent)).toBe('14:00 ~ 15:40')
    })

    it('formats jiaowu period code with canonical time range', () => {
      const jiaowuCourse = {
        id: 'test-3',
        title: '数据结构',
        startTime: '7-8节',
        endTime: '1-16周',
        type: 'course' as const
      }
      expect(getEventDisplayTime(jiaowuCourse)).toBe('7-8节 (14:00 ~ 15:40)')
    })
  })

  describe('fetchJiaowuSchedule', () => {
    it('returns parsed courses and student info on successful POST', async () => {
      const mockSes = {
        cookies: {
          get: vi.fn().mockResolvedValue([{ name: 'JSESSIONID', value: 'sess-jw-ok' }])
        },
        fetch: vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('xskbcx_cxXskbcxIndex.html')) {
            return { status: 200, ok: true }
          }
          if (url.includes('xskbcx_cxXsKb.html')) {
            return {
              ok: true,
              status: 200,
              text: async () =>
                JSON.stringify({
                  kbList: [
                    {
                      kcmc: '生物化学',
                      jc: '1-2节',
                      xqj: '1',
                      xqjmc: '星期一',
                      zcd: '1-16周',
                      cdmc: '东中院2-203',
                      xm: '冯雁,梁如冰',
                      xf: '6',
                      kch: 'BIO2208'
                    },
                    {
                      kcmc: '物理化学',
                      jc: '3-4节',
                      xqj: '1',
                      xqjmc: '星期一',
                      zcd: '1-16周',
                      cdmc: '东下院209',
                      xm: '李涛',
                      xf: '4',
                      kch: 'CHEM2202'
                    }
                  ],
                  xsxx: {
                    XM: '张三',
                    XH: '525080910001'
                  }
                })
            }
          }
          return { status: 404, ok: false }
        })
      } as any

      const res = await fetchJiaowuSchedule(mockSes, '2026', '3')
      expect(res.ok).toBe(true)
      expect(res.courses).toHaveLength(2)
      expect(res.courses[0].kcmc).toBe('生物化学')
      expect(res.courses[0].cdmc).toBe('东中院2-203')
      expect(res.studentName).toBe('张三')
      expect(res.studentId).toBe('525080910001')
      expect(res.studentGrade).toBe('2025')
      expect(res.termTitle).toContain('2026-2027学年 第1学期 (秋季)')
    })

    it('extracts studentGrade preferentially from NJDM_ID', async () => {
      const mockSes = {
        cookies: {
          get: vi.fn().mockResolvedValue([{ name: 'JSESSIONID', value: 'sess-jw-ok' }])
        },
        fetch: vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('xskbcx_cxXskbcxIndex.html')) return { status: 200, ok: true }
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                kbList: [],
                xsxx: { XM: '李四', XH: '524080910002', NJDM_ID: '2024' }
              })
          }
        })
      } as any

      const res = await fetchJiaowuSchedule(mockSes, '2026', '3')
      expect(res.ok).toBe(true)
      expect(res.studentGrade).toBe('2024')
    })

    it('returns NEED_LOGIN cleanly when unauthenticated', async () => {
      const mockSes = {
        cookies: {
          get: vi.fn().mockResolvedValue([])
        },
        fetch: vi.fn()
      } as any

      const res = await fetchJiaowuSchedule(mockSes, '2026', '3')
      expect(res.ok).toBe(false)
      expect(res.error).toBe('NEED_LOGIN')
      expect(res.courses).toEqual([])
    })

    it('handles non-JSON or jAccount redirect HTML safely', async () => {
      const mockSes = {
        cookies: {
          get: vi.fn().mockResolvedValue([{ name: 'JSESSIONID', value: 'expired-sess' }])
        },
        fetch: vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('xskbcx_cxXskbcxIndex.html')) {
            return { status: 200, ok: true }
          }
          return {
            ok: true,
            status: 200,
            text: async () => '<html><body>统一身份认证 jaccount.sjtu.edu.cn</body></html>'
          }
        })
      } as any

      const res = await fetchJiaowuSchedule(mockSes, '2025', '12')
      expect(res.ok).toBe(false)
      expect(res.error).toBe('NEED_LOGIN')
    })
  })

  describe('Dynamic Jiaowu Semester Generation Logic', () => {
    function generateSemesters(enrollmentYear: number, currentXnm = 2026) {
      const list: Array<{ key: string; label: string }> = []
      for (let y = currentXnm; y >= enrollmentYear; y--) {
        if (y === currentXnm) {
          list.push({ key: `${y}_3`, label: `${y}-${y + 1}学年 第1学期 (秋季 · 官方教务)` })
        } else {
          list.push({ key: `${y}_16`, label: `${y}-${y + 1}学年 第3学期 (夏季小学期)` })
          list.push({ key: `${y}_12`, label: `${y}-${y + 1}学年 第2学期 (春季)` })
          list.push({
            key: `${y}_3`,
            label: `${y}-${y + 1}学年 第1学期 (秋季${y === enrollmentYear ? ' · 入学学期' : ''})`
          })
        }
      }
      return list
    }

    it('generates only semesters starting from 2025 for 2025 grade student (excludes 2024, 2023)', () => {
      const semesters = generateSemesters(2025, 2026)
      const keys = semesters.map(s => s.key)
      expect(keys).toEqual(['2026_3', '2025_16', '2025_12', '2025_3'])
      expect(keys).not.toContain('2024_3')
      expect(keys).not.toContain('2023_3')
      expect(semesters.find(s => s.key === '2025_3')?.label).toContain('入学学期')
    })

    it('includes earlier semesters only for senior students (e.g. 2023 grade)', () => {
      const semesters = generateSemesters(2023, 2026)
      const keys = semesters.map(s => s.key)
      expect(keys).toContain('2026_3')
      expect(keys).toContain('2025_3')
      expect(keys).toContain('2024_3')
      expect(keys).toContain('2023_3')
      expect(semesters.find(s => s.key === '2023_3')?.label).toContain('入学学期')
    })
  })

  describe('parseWeekNumber (周次文本数字解析)', () => {
    it('parses English week formats like "Week 5" or "week 16"', () => {
      expect(parseWeekNumber('第五周', 'Week 5')).toBe(5)
      expect(parseWeekNumber('', 'Week 16')).toBe(16)
      expect(parseWeekNumber('Week 7')).toBe(7)
    })

    it('parses Arabic digits in Chinese week strings', () => {
      expect(parseWeekNumber('第5周')).toBe(5)
      expect(parseWeekNumber('第12周')).toBe(12)
      expect(parseWeekNumber('16周')).toBe(16)
    })

    it('parses Chinese numerals in week strings', () => {
      expect(parseWeekNumber('第一周')).toBe(1)
      expect(parseWeekNumber('第二周')).toBe(2)
      expect(parseWeekNumber('第八周')).toBe(8)
      expect(parseWeekNumber('第十六周')).toBe(16)
    })

    it('returns null for unparseable strings', () => {
      expect(parseWeekNumber('假期')).toBeNull()
      expect(parseWeekNumber('')).toBeNull()
    })
  })

  describe('formatWeeksRange (全学期周次聚合压缩)', () => {
    it('compresses full continuous range 1-16 weeks', () => {
      const allWeeks = Array.from({ length: 16 }, (_, i) => i + 1)
      expect(formatWeeksRange(allWeeks)).toBe('1-16周')
    })

    it('compresses half semester range 1-8 weeks', () => {
      const halfWeeks = Array.from({ length: 8 }, (_, i) => i + 1)
      expect(formatWeeksRange(halfWeeks)).toBe('1-8周')
    })

    it('formats single week correctly', () => {
      expect(formatWeeksRange([5])).toBe('第5周')
    })

    it('formats odd weeks as (单)', () => {
      expect(formatWeeksRange([1, 3, 5, 7, 9, 11, 13, 15])).toBe('1-15周(单)')
    })

    it('formats even weeks as (双)', () => {
      expect(formatWeeksRange([2, 4, 6, 8, 10, 12, 14, 16])).toBe('2-16周(双)')
    })

    it('formats segmented ranges with gaps', () => {
      expect(formatWeeksRange([1, 2, 3, 4, 8, 9, 10])).toBe('1-4周, 8-10周')
      expect(formatWeeksRange([6, 10, 14, 15])).toBe('第6周, 第10周, 14-15周')
    })

    it('handles duplicates and unsorted inputs gracefully', () => {
      expect(formatWeeksRange([3, 1, 2, 2, 3, 1])).toBe('1-3周')
      expect(formatWeeksRange([])).toBe('')
    })
  })

  describe('isSafeExternalUrl (外部跳转安全校验)', () => {
    it('allows standard https and http URLs', () => {
      expect(isSafeExternalUrl('https://oc.sjtu.edu.cn/courses/123/assignments/456')).toBe(true)
      expect(isSafeExternalUrl('https://pan.sjtu.edu.cn/')).toBe(true)
      expect(isSafeExternalUrl('https://github.com/my-repo/releases')).toBe(true)
      expect(isSafeExternalUrl('http://example.com/page')).toBe(true)
    })

    it('rejects unsafe local and executable protocols', () => {
      expect(isSafeExternalUrl('file:///C:/Windows/System32/cmd.exe')).toBe(false)
      expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
      expect(isSafeExternalUrl('powershell:Invoke-Expression')).toBe(false)
      expect(isSafeExternalUrl('data:text/html;base64,...')).toBe(false)
    })

    it('rejects relative paths and invalid strings', () => {
      expect(isSafeExternalUrl('/courses/123/assignments/456')).toBe(false)
      expect(isSafeExternalUrl('courses/123')).toBe(false)
      expect(isSafeExternalUrl('')).toBe(false)
      expect(isSafeExternalUrl('   ')).toBe(false)
      expect(isSafeExternalUrl(null)).toBe(false)
      expect(isSafeExternalUrl(undefined)).toBe(false)
      expect(isSafeExternalUrl(12345)).toBe(false)
    })
  })

  describe('normalizeCanvasUrl (Canvas 作业与资源链接规范化)', () => {
    it('leaves absolute URLs untouched', () => {
      const url = 'https://oc.sjtu.edu.cn/courses/100/assignments/200'
      expect(normalizeCanvasUrl(url)).toBe(url)
      expect(normalizeCanvasUrl('http://canvas.custom.edu/test')).toBe('http://canvas.custom.edu/test')
    })

    it('prepends Canvas base domain to relative paths', () => {
      expect(normalizeCanvasUrl('/courses/100/assignments/200')).toBe(
        'https://oc.sjtu.edu.cn/courses/100/assignments/200'
      )
      expect(normalizeCanvasUrl('courses/100/assignments/200')).toBe(
        'https://oc.sjtu.edu.cn/courses/100/assignments/200'
      )
    })

    it('returns empty string for empty, whitespace or non-string inputs', () => {
      expect(normalizeCanvasUrl('')).toBe('')
      expect(normalizeCanvasUrl('   ')).toBe('')
      expect(normalizeCanvasUrl(undefined)).toBe('')
    })
  })
})

