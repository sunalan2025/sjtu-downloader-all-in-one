/**
 * 设置视图文案规范化与纯音频模式解耦单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as cheerio from 'cheerio'
import { Settings } from '@renderer/pages/Settings'
import { useAppStore } from '@renderer/store/app'

describe('Settings View Terminology and Media Audio Mode Suite', () => {
  beforeEach(() => {
    useAppStore.setState({
      videoQualityOption: 'origin',
      videoPerspectivePreference: 'teacher'
    })
  })

  describe('1. 账号与云盘文案净化与黑话消除验证 (Terminology Guardrails)', () => {
    it('账号与云盘设置页杜绝 DPAPI、Keychain、SSO单点直连、存储配额等黑话，使用通俗易懂的规范中文', () => {
      const html = renderToStaticMarkup(
        React.createElement(Settings, {
          initialNav: 'account',
          cloudUserToken: 'mock-token',
          cloudSpaceInfo: { size: '1073741824', capacity: '107374182400' },
          auth: {
            loggedIn: true,
            accountName: '张同学',
            studentId: '522031910000'
          }
        })
      )
      const $ = cheerio.load(html)
      const pageText = $('body').text()

      // 铁律：杜绝底层系统黑话与技术缩写
      expect(pageText).not.toContain('DPAPI')
      expect(pageText).not.toContain('Keychain')
      expect(pageText).not.toContain('SSO 单点直连')
      expect(pageText).not.toContain('一键直连 SSO')
      expect(pageText).not.toContain('系统安全保险库')
      expect(pageText).not.toContain('已保存凭据列表')
      expect(pageText).not.toContain('已用存储配额')
      expect(pageText).not.toContain('云端转存默认根目录')

      // 正向断言：规范化、亲切自然的表述
      expect(pageText).toContain('账号安全加密防护')
      expect(pageText).toContain('一键免密连接')
      expect(pageText).toContain('交大云盘已用空间')
      expect(pageText).toContain('已保存的账号')
      expect(pageText).toContain('云盘保存目录')
      expect(pageText).toContain('管理 jAccount 登录状态、交大云盘连接与已保存的账号')
    })
  })

  describe('2. 课件与多媒体：纯音频模式独立与清晰度解耦 (Audio-Only Mode)', () => {
    it('默认未开启纯音频模式时，清晰度与机位视角均专注于画面，不混入音频选项', () => {
      const html = renderToStaticMarkup(
        React.createElement(Settings, {
          initialNav: 'media',
          videoQualityOption: 'origin',
          videoPerspectivePreference: 'teacher'
        })
      )
      const $ = cheerio.load(html)

      // 存在独立开关
      expect($('span:contains("仅下载原声音频")').length).toBeGreaterThanOrEqual(1)

      // 渲染清晰度与镜头视角
      expect($('div:contains("默认视频清晰度")').length).toBeGreaterThanOrEqual(1)
      expect($('div:contains("默认录播镜头视角")').length).toBeGreaterThanOrEqual(1)

      // 选项中不再混杂"仅提取音频"与"纯音频 MP3"
      const originBtn = $('button:contains("原画高清")')
      const p1080Btn = $('button:contains("1080P")')
      const p720Btn = $('button:contains("720P")')
      expect(originBtn.length).toBe(1)
      expect(p1080Btn.length).toBe(1)
      expect(p720Btn.length).toBe(1)

      // 视角选项中仅保留画面镜头
      expect($('button:contains("双机位同时下载")').length).toBe(1)
      expect($('button:contains("仅教师视角")').length).toBe(1)
      expect($('button:contains("仅PPT投屏")').length).toBe(1)
      expect($('button:contains("纯音频 MP3")').length).toBe(0)
    })

    it('当开启纯音频模式时，视频清晰度与多机位选择自动折叠收起，展示专属音频提示条', () => {
      const html = renderToStaticMarkup(
        React.createElement(Settings, {
          initialNav: 'media',
          videoQualityOption: 'audio_only',
          videoPerspectivePreference: 'audio'
        })
      )
      const $ = cheerio.load(html)
      const bodyText = $('body').text()

      // 提示条呈现
      expect(bodyText).toContain('当前已开启仅下载原声音频模式')

      // 视频清晰度与镜头视角选择控件已被隐藏折叠
      expect($('button:contains("原画高清")').length).toBe(0)
      expect($('button:contains("仅教师视角")').length).toBe(0)
      expect($('button:contains("仅PPT投屏")').length).toBe(0)
    })
  })
})
