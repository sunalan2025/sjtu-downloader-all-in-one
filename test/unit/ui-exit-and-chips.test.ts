import { describe, it, expect, beforeEach } from 'vitest'
import {
  resolveCategoryChipKey,
  type NetdiskCategoryItem
} from '../../src/renderer/src/components/NetdiskCourseExplorer'
import { useAppStore } from '../../src/renderer/src/store/app'
import type { DownloadProgress } from '../../src/shared/types'

describe('Netdisk Category Chip Key Resolution (resolveCategoryChipKey)', () => {
  it('honors explicit chipKey over id and name', () => {
    const item: NetdiskCategoryItem = {
      id: 'ppt',
      name: '📑 课堂PPT实录 (MP4)',
      chipKey: 'videos',
      state: 'none',
      onToggle: () => {},
      items: []
    }
    expect(resolveCategoryChipKey(item)).toBe('videos')
  })

  it('correctly maps teacher and ppt lecture recordings to videos', () => {
    const teacherCat: NetdiskCategoryItem = {
      id: 'teacher',
      name: '👨‍🏫 教师实录 (MP4)',
      state: 'none',
      onToggle: () => {},
      items: []
    }
    const pptCat: NetdiskCategoryItem = {
      id: 'ppt',
      name: '📑 课堂PPT实录 (MP4)',
      state: 'none',
      onToggle: () => {},
      items: []
    }
    expect(resolveCategoryChipKey(teacherCat)).toBe('videos')
    expect(resolveCategoryChipKey(pptCat)).toBe('videos')
  })

  it('correctly maps standard Canvas categories to their chip keys', () => {
    const filesCat: NetdiskCategoryItem = {
      id: 'files',
      name: '课件资料',
      chipKey: 'files',
      state: 'none',
      onToggle: () => {},
      items: []
    }
    const assignCat: NetdiskCategoryItem = {
      id: 'assignments',
      name: '📝 课程作业与提交',
      chipKey: 'assignments',
      state: 'none',
      onToggle: () => {},
      items: []
    }
    const pptPdfCat: NetdiskCategoryItem = {
      id: 'pptPdf',
      name: '📑 PPT课件 (PDF)',
      chipKey: 'pptPdf',
      state: 'none',
      onToggle: () => {},
      items: []
    }
    expect(resolveCategoryChipKey(filesCat)).toBe('files')
    expect(resolveCategoryChipKey(assignCat)).toBe('assignments')
    expect(resolveCategoryChipKey(pptPdfCat)).toBe('pptPdf')
  })
})

describe('Download History De-duplication in Both Mode', () => {
  beforeEach(() => {
    useAppStore.setState({
      downloadHistory: [],
      progress: {}
    })
  })

  it('merges both-mode local and cloud completions into a single unified history entry', async () => {
    const store = useAppStore.getState()

    // 1. 本地下载完成
    const localProg: DownloadProgress = {
      taskId: 'canvas_file_101_501',
      fileName: 'LectureNotes.pdf',
      state: 'done',
      received: 2048,
      total: 2048,
      filePath: 'C:/Downloads/CS101/LectureNotes.pdf'
    }
    store.applyProgress(localProg)
    await Promise.resolve()

    const historyAfterLocal = useAppStore.getState().downloadHistory
    expect(historyAfterLocal).toHaveLength(1)
    expect(historyAfterLocal[0].taskId).toBe('canvas_file_101_501')
    expect(historyAfterLocal[0].filePath).toBe('C:/Downloads/CS101/LectureNotes.pdf')
    expect(historyAfterLocal[0].cloudPath).toBeUndefined()

    // 2. 云端上传紧接着完成（_cloud 镜像）
    const cloudProg: DownloadProgress = {
      taskId: 'canvas_file_101_501_cloud',
      fileName: 'LectureNotes.pdf',
      state: 'done',
      received: 2048,
      total: 2048,
      cloudPath: '/SJTU课程备份/CS101/LectureNotes.pdf'
    }
    store.applyProgress(cloudProg)
    await Promise.resolve()

    const historyAfterCloud = useAppStore.getState().downloadHistory
    // 断言：历史记录仍仅有 1 条，并未产生双行！且同时补齐了 filePath 与 cloudPath！
    expect(historyAfterCloud).toHaveLength(1)
    expect(historyAfterCloud[0].taskId).toBe('canvas_file_101_501')
    expect(historyAfterCloud[0].filePath).toBe('C:/Downloads/CS101/LectureNotes.pdf')
    expect(historyAfterCloud[0].cloudPath).toBe('/SJTU课程备份/CS101/LectureNotes.pdf')
    expect(historyAfterCloud[0].fileName).toBe('LectureNotes.pdf')
  })
})
