import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as cheerio from 'cheerio'
import { FloatingCommandIsland } from '../../src/renderer/src/components/FloatingCommandIsland'
import { estimateResourceSize } from '../../src/shared/utils'

describe('Perspective and Audio Settings Display Synchronization Suite', () => {
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
})
