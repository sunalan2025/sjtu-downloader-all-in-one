import { describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as cheerio from 'cheerio'
import { FloatingCommandIsland } from '../../src/renderer/src/components/FloatingCommandIsland'
import { estimateResourceSize, getDownloadActionLabels } from '../../src/shared/utils'
import { useAppStore } from '../../src/renderer/src/store/app'

describe('Perspective and Audio Settings Display Synchronization Suite', () => {
  beforeEach(() => {
    useAppStore.getState().setDownloadMode('local')
  })
  it('当处于仅音频模式时，悬浮岛芯片显示为原声音频且不呈现存储目标切换按钮', () => {
    const html = renderToStaticMarkup(
      React.createElement(FloatingCommandIsland, {
        selectedSummary: {
          totalItems: 5,
          formattedSize: '约 225 MB',
          videoCount: 5
        },
        videoQualityOption: 'audio_only',
        perspective: 'audio'
      })
    )
    const $ = cheerio.load(html)

    // 验证无存储目标切换
    expect($('[role="group"][aria-label="存储目标切换"]').length).toBe(0)
    expect(html).not.toContain('📁 本地')
    expect(html).not.toContain('☁️ 云盘')

    // 验证音频芯片与提示
    const audioBtn = $('button:contains("原声音频 5")')
    expect(audioBtn.length).toBe(1)
    expect(audioBtn.attr('title')).toContain('仅下载原声音频')
  })

  it('当设置为仅教师视角时，悬浮岛芯片显示为 🎬 教师视频 X 且容量按教师视角估算', () => {
    const est = estimateResourceSize({
      fileBytes: 0,
      videoCount: 2,
      perspective: 'teacher'
    })
    // 2 * 450 MB = 900 MB
    expect(est.formattedSize).toBe('约 900.0 MB')

    const html = renderToStaticMarkup(
      React.createElement(FloatingCommandIsland, {
        selectedSummary: {
          totalItems: 2,
          formattedSize: est.formattedSize,
          videoCount: 2
        },
        perspective: 'teacher'
      })
    )
    const $ = cheerio.load(html)

    const teacherBtn = $('button:contains("教师视频 2")')
    expect(teacherBtn.length).toBe(1)
    expect(teacherBtn.attr('title')).toContain('仅教师视角')
    expect(html).toContain('立即下载 约 900.0 MB')
  })

  it('当设置为仅PPT投屏时，悬浮岛芯片显示为 🎬 PPT视频 X 且容量按PPT投屏估算', () => {
    const est = estimateResourceSize({
      fileBytes: 0,
      videoCount: 3,
      perspective: 'ppt'
    })
    // 3 * 200 MB = 600 MB
    expect(est.formattedSize).toBe('约 600.0 MB')

    const html = renderToStaticMarkup(
      React.createElement(FloatingCommandIsland, {
        selectedSummary: {
          totalItems: 3,
          formattedSize: est.formattedSize,
          videoCount: 3
        },
        perspective: 'ppt'
      })
    )
    const $ = cheerio.load(html)

    const pptBtn = $('button:contains("PPT视频 3")')
    expect(pptBtn.length).toBe(1)
    expect(pptBtn.attr('title')).toContain('仅PPT投屏')
    expect(html).toContain('立即下载 约 600.0 MB')
  })

  it('当设置为双机位同时下载时，悬浮岛芯片显示为 🎬 双机位视频 X 且容量按双机位估算', () => {
    const est = estimateResourceSize({
      fileBytes: 0,
      videoCount: 2,
      perspective: 'all'
    })
    // 2 * 650 MB = 1300 MB -> 约 1.27 GB
    expect(est.formattedSize).toBe('约 1.27 GB')

    const html = renderToStaticMarkup(
      React.createElement(FloatingCommandIsland, {
        selectedSummary: {
          totalItems: 2,
          formattedSize: est.formattedSize,
          videoCount: 2
        },
        perspective: 'all'
      })
    )
    const $ = cheerio.load(html)

    const allBtn = $('button:contains("双机位视频 2")')
    expect(allBtn.length).toBe(1)
    expect(allBtn.attr('title')).toContain('双机位同时下载')
    expect(html).toContain('立即下载 约 1.27 GB')
  })

  describe('DownloadMode 动态自适应动作文案与图标单一真相来源 (getDownloadActionLabels)', () => {
    it('本地下载模式 (local)：主按钮显示「立即下载」，快捷动作显示「下载」，图标为 download', () => {
      const labels = getDownloadActionLabels('local')
      expect(labels.verb).toBe('下载')
      expect(labels.quickActionText).toBe('下载')
      expect(labels.ctaPrefix).toBe('立即下载')
      expect(labels.detailActionText).toBe('⬇ 立即下载此文件')
      expect(labels.inProgressText).toBe('下载进行中…')
      expect(labels.iconType).toBe('download')
      expect(labels.toastMessage('第1讲.mp4')).toBe('已开始下载 "第1讲.mp4"')
      expect(labels.toastPromptMessage('第1讲.mp4')).toBe('已勾选 "第1讲.mp4"，点击「立即下载」开始传输')

      const html = renderToStaticMarkup(
        React.createElement(FloatingCommandIsland, {
          selectedSummary: { totalItems: 1, formattedSize: '10.0 MB' },
          downloadMode: 'local'
        })
      )
      expect(html).toContain('立即下载 10.0 MB')
    })

    it('云盘上传模式 (cloud)：主按钮显示「立即上传」，快捷动作显示「上传」，图标为 upload', () => {
      const labels = getDownloadActionLabels('cloud')
      expect(labels.verb).toBe('上传')
      expect(labels.quickActionText).toBe('上传')
      expect(labels.ctaPrefix).toBe('立即上传')
      expect(labels.detailActionText).toBe('☁️ 立即上传此文件')
      expect(labels.inProgressText).toBe('上传进行中…')
      expect(labels.iconType).toBe('upload')
      expect(labels.toastMessage('第1讲.mp4')).toBe('已开始上传 "第1讲.mp4" 至交大云盘')
      expect(labels.toastPromptMessage('第1讲.mp4')).toBe('已勾选 "第1讲.mp4"，点击「立即上传」开始传输')

      const html = renderToStaticMarkup(
        React.createElement(FloatingCommandIsland, {
          selectedSummary: { totalItems: 1, formattedSize: '10.0 MB' },
          downloadMode: 'cloud'
        })
      )
      expect(html).toContain('立即上传 10.0 MB')
    })

    it('双备份模式 (both)：主按钮显示「下载并备份至云盘」，快捷动作显示「备份」，图标为 both', () => {
      const labels = getDownloadActionLabels('both')
      expect(labels.verb).toBe('下载并备份')
      expect(labels.quickActionText).toBe('备份')
      expect(labels.ctaPrefix).toBe('下载并备份至云盘')
      expect(labels.detailActionText).toBe('☁️⬇ 下载并备份此文件')
      expect(labels.inProgressText).toBe('下载与备份中…')
      expect(labels.iconType).toBe('both')
      expect(labels.toastMessage('第1讲.mp4')).toBe('已开始下载并备份 "第1讲.mp4" 至交大云盘')
      expect(labels.toastPromptMessage('第1讲.mp4')).toBe('已勾选 "第1讲.mp4"，点击「下载并备份至云盘」开始传输')

      const html = renderToStaticMarkup(
        React.createElement(FloatingCommandIsland, {
          selectedSummary: { totalItems: 1, formattedSize: '10.0 MB' },
          downloadMode: 'both'
        })
      )
      expect(html).toContain('下载并备份至云盘 10.0 MB')
    })

    it('在下载进行中 (storeDownloading=true) 时，CTA 大按钮自适应呈现 inProgressText', () => {
      const htmlLocal = renderToStaticMarkup(
        React.createElement(FloatingCommandIsland, {
          selectedSummary: { totalItems: 1, formattedSize: '10.0 MB' },
          downloadMode: 'local',
          storeDownloading: true
        })
      )
      expect(htmlLocal).toContain('下载进行中…')

      const htmlCloud = renderToStaticMarkup(
        React.createElement(FloatingCommandIsland, {
          selectedSummary: { totalItems: 1, formattedSize: '10.0 MB' },
          downloadMode: 'cloud',
          storeDownloading: true
        })
      )
      expect(htmlCloud).toContain('上传进行中…')

      const htmlBoth = renderToStaticMarkup(
        React.createElement(FloatingCommandIsland, {
          selectedSummary: { totalItems: 1, formattedSize: '10.0 MB' },
          downloadMode: 'both',
          storeDownloading: true
        })
      )
      expect(htmlBoth).toContain('下载与备份中…')
    })
  })
})
