import { describe, it, expect } from 'vitest'
import {
  estimateResourceSize,
  type EstimateSizeParams,
  type EstimatedSizeResult
} from '../../src/shared/utils'
import type { SingleDownloadPayload } from '../../src/shared/types'

describe('Resource Size Estimation Engine (estimateResourceSize)', () => {
  it('returns 0 B and 0 totalBytes for empty params or zero values', () => {
    const res1 = estimateResourceSize({})
    expect(res1).toEqual<EstimatedSizeResult>({
      totalBytes: 0,
      formattedSize: '0 B'
    })

    const res2 = estimateResourceSize({
      fileBytes: 0,
      videoCount: 0,
      hasAssignments: false,
      assignmentCount: 0,
      hasPptPdf: false,
      pptPdfCount: 0
    })
    expect(res2).toEqual<EstimatedSizeResult>({
      totalBytes: 0,
      formattedSize: '0 B'
    })
  })

  it('accurately calculates fileBytes alone with proper formatting', () => {
    const oneMb = 1024 * 1024
    const res = estimateResourceSize({ fileBytes: oneMb * 5 })
    expect(res.totalBytes).toBe(5 * oneMb)
    expect(res.formattedSize).toBe('约 5.0 MB')
  })

  it('handles negative or invalid fileBytes safely as 0', () => {
    const res = estimateResourceSize({ fileBytes: -100 })
    expect(res.totalBytes).toBe(0)
    expect(res.formattedSize).toBe('0 B')
  })

  it('estimates video sizes correctly across different perspectives', () => {
    const MB = 1024 * 1024
    const count = 3

    // 'all' perspective: 650 MB / lecture -> 1950 MB
    const resAll = estimateResourceSize({ videoCount: count, perspective: 'all' })
    expect(resAll.totalBytes).toBe(count * 650 * MB)
    expect(resAll.formattedSize).toBe('约 1.90 GB')

    // default perspective is 'all'
    const resDefault = estimateResourceSize({ videoCount: count })
    expect(resDefault.totalBytes).toBe(count * 650 * MB)

    // 'teacher' perspective: 450 MB / lecture -> 1350 MB
    const resTeacher = estimateResourceSize({ videoCount: count, perspective: 'teacher' })
    expect(resTeacher.totalBytes).toBe(count * 450 * MB)
    expect(resTeacher.formattedSize).toBe('约 1.32 GB')

    // 'ppt' perspective: 200 MB / lecture -> 600 MB
    const resPpt = estimateResourceSize({ videoCount: count, perspective: 'ppt' })
    expect(resPpt.totalBytes).toBe(count * 200 * MB)
    expect(resPpt.formattedSize).toBe('约 600.0 MB')

    // 'audio' perspective: 45 MB / lecture -> 135 MB
    const resAudio = estimateResourceSize({ videoCount: count, perspective: 'audio' })
    expect(resAudio.totalBytes).toBe(count * 45 * MB)
    expect(resAudio.formattedSize).toBe('约 135.0 MB')
  })

  it('calculates assignment increments at 2 MB per assignment', () => {
    const MB = 1024 * 1024

    // hasAssignments = true with explicit assignmentCount
    const resWithCount = estimateResourceSize({
      hasAssignments: true,
      assignmentCount: 4
    })
    expect(resWithCount.totalBytes).toBe(4 * 2 * MB)
    expect(resWithCount.formattedSize).toBe('约 8.0 MB')

    // hasAssignments = true with default count = 1
    const resDefaultCount = estimateResourceSize({
      hasAssignments: true
    })
    expect(resDefaultCount.totalBytes).toBe(1 * 2 * MB)
    expect(resDefaultCount.formattedSize).toBe('约 2.0 MB')

    // hasAssignments = false ignores assignmentCount
    const resFalse = estimateResourceSize({
      hasAssignments: false,
      assignmentCount: 10
    })
    expect(resFalse.totalBytes).toBe(0)
    expect(resFalse.formattedSize).toBe('0 B')
  })

  it('calculates PPT PDF increments at 15 MB per lecture', () => {
    const MB = 1024 * 1024

    // hasPptPdf = true with explicit pptPdfCount
    const resExplicit = estimateResourceSize({
      hasPptPdf: true,
      pptPdfCount: 2
    })
    expect(resExplicit.totalBytes).toBe(2 * 15 * MB)
    expect(resExplicit.formattedSize).toBe('约 30.0 MB')

    // hasPptPdf = true falling back to videoCount
    const resFallbackVideo = estimateResourceSize({
      videoCount: 4,
      perspective: 'ppt', // 4 * 200 MB = 800 MB
      hasPptPdf: true // 4 * 15 MB = 60 MB
    })
    expect(resFallbackVideo.totalBytes).toBe((4 * 200 + 4 * 15) * MB)
    expect(resFallbackVideo.formattedSize).toBe('约 860.0 MB')

    // hasPptPdf = false ignores count
    const resFalse = estimateResourceSize({
      hasPptPdf: false,
      pptPdfCount: 5
    })
    expect(resFalse.totalBytes).toBe(0)
  })

  it('aggregates all resource types together accurately', () => {
    const MB = 1024 * 1024
    const params: EstimateSizeParams = {
      fileBytes: 50 * MB, // 50 MB
      videoCount: 2,
      perspective: 'teacher', // 2 * 450 MB = 900 MB
      hasAssignments: true,
      assignmentCount: 5, // 5 * 2 MB = 10 MB
      hasPptPdf: true,
      pptPdfCount: 2 // 2 * 15 MB = 30 MB
    }
    // Total: 50 + 900 + 10 + 30 = 990 MB
    const result = estimateResourceSize(params)
    expect(result.totalBytes).toBe(990 * MB)
    expect(result.formattedSize).toBe('约 990.0 MB')
  })

  it('satisfies SingleDownloadPayload typing', () => {
    const payload: SingleDownloadPayload = {
      id: 'file-12345',
      type: 'file',
      name: 'Lecture01.pdf',
      courseId: 98765,
      url: 'https://oc.sjtu.edu.cn/files/12345/download',
      size: 1048576
    }
    expect(payload.id).toBe('file-12345')
    expect(payload.type).toBe('file')
    expect(payload.name).toBe('Lecture01.pdf')
    expect(payload.courseId).toBe(98765)
  })
})
