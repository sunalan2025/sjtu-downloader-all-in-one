/**
 * 初始化向导 (SetupWizardModal) 4 步精炼结构与多媒体学习辅助单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as cheerio from 'cheerio'
import { SetupWizardModal } from '../../src/renderer/src/components/SetupWizardModal'
import { useAppStore } from '../../src/renderer/src/store/app'

describe('SetupWizardModal Refactoring Suite (4-Step Onboarding)', () => {
  beforeEach(() => {
    useAppStore.setState({
      showSetupWizardModal: true,
      lastSetupVersion: null,
      downloadMode: 'local',
      videoQualityOption: 'origin',
      videoPerspectivePreference: 'teacher',
      autoExportPptPdf: true,
      canvasExportSrt: true,
      canvasExportMarkdown: true,
      windowCloseAction: 'tray'
    })
  })

  it('初始状态下展示首次使用向导，总步数为 4 步且第 1 步展示存储目标模式', () => {
    const html = renderToStaticMarkup(React.createElement(SetupWizardModal, { initialStep: 1 }))
    const $ = cheerio.load(html)

    expect(html).toContain('首次使用向导')
    expect(html).toContain('步骤 1 / 4')
    expect(html).toContain('存储目标模式')
    expect(html).toContain('仅存本地')
    expect(html).toContain('直传交大云盘')
    expect(html).toContain('本地 + 云盘双备份')

    // 胶囊指示器数量精确为 4 个
    const stepIndicators = $('div[title*="步骤 1 / 4"]').find('button')
    expect(stepIndicators.length).toBe(4)
  })

  it('第 2 步展示保存目录与路径配置（本地路径与云盘快捷预设）', () => {
    const html = renderToStaticMarkup(React.createElement(SetupWizardModal, { initialStep: 2 }))
    expect(html).toContain('步骤 2 / 4')
    expect(html).toContain('本地文件保存目录')
    expect(html).toContain('交大云盘保存目录')
    expect(html).toContain('快捷预设:')
  })

  it('第 3 步「课件与学习辅助」内聚清晰度、录播机位与 3 联复习辅助资料', () => {
    const html = renderToStaticMarkup(React.createElement(SetupWizardModal, { initialStep: 3 }))
    const $ = cheerio.load(html)

    expect(html).toContain('步骤 3 / 4')
    expect(html).toContain('课件与学习辅助')

    // 分区 1：视频优先清晰度（剔除重复的音频选项，只保留标准画质）
    expect(html).toContain('视频优先清晰度')
    expect(html).toContain('原画高清')
    expect(html).toContain('1080P 全高清')
    expect(html).toContain('720P 高清')
    expect(html).not.toContain('仅提取音频 (.m4a)')

    // 分区 2：默认录播机位视角（统一收口纯音频与机位）
    expect(html).toContain('默认录播机位视角')
    expect(html).toContain('仅教师视角')
    expect(html).toContain('双机位录像')
    expect(html).toContain('仅PPT投屏')
    expect(html).toContain('纯音频 MP3')

    // 分区 3：学习辅助资料自动生成（三联开关）
    expect(html).toContain('学习辅助资料自动生成')
    expect(html).toContain('自动生成 PPT 讲义 PDF')
    expect(html).toContain('导出外挂字幕 (.srt)')
    expect(html).toContain('导出复习讲义笔记 (.md)')
  })

  it('第 4 步展示窗口关闭与后台运行保护', () => {
    const html = renderToStaticMarkup(React.createElement(SetupWizardModal, { initialStep: 4 }))
    expect(html).toContain('步骤 4 / 4')
    expect(html).toContain('窗口关闭与后台运行保护')
    expect(html).toContain('最小化到系统托盘')
    expect(html).toContain('最小化到任务栏')
    expect(html).toContain('彻底退出应用')
  })

  it('版本更新场景下头部友好提示「版本更新偏好确认」', () => {
    useAppStore.setState({
      showSetupWizardModal: true,
      lastSetupVersion: '2.4.0'
    })

    const html = renderToStaticMarkup(React.createElement(SetupWizardModal, { initialStep: 1 }))
    expect(html).toContain('版本更新偏好确认')
  })
})
