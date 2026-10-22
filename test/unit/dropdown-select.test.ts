import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as cheerio from 'cheerio'
import {
  DropdownSelect,
  type DropdownOption,
  type DropdownGroup
} from '../../src/renderer/src/components/widgets'

describe('DropdownSelect Component Unit Tests', () => {
  it('正确渲染平铺 options 模式下的选中项文本与图标', () => {
    const options: DropdownOption<string>[] = [
      { value: 'all', label: '全部学期', count: 12 },
      { value: '2025_1', label: '2025-2026 秋季学期', count: 5 }
    ]

    const html = renderToStaticMarkup(
      React.createElement(DropdownSelect, {
        value: '2025_1',
        options,
        onChange: () => {},
        icon: '🗓️'
      })
    )

    const $ = cheerio.load(html)
    expect($('button').text()).toContain('🗓️')
    expect($('button').text()).toContain('2025-2026 秋季学期')
    expect($('button').text()).toContain('5')
  })

  it('支持数值类型 value 与 options (如周数 1~18、提醒分钟数)', () => {
    const options: DropdownOption<number>[] = [
      { value: 10, label: '提前 10 分钟' },
      { value: 20, label: '提前 20 分钟' },
      { value: 30, label: '提前 30 分钟' }
    ]

    const html = renderToStaticMarkup(
      React.createElement(DropdownSelect<number>, {
        value: 20,
        options,
        onChange: () => {}
      })
    )

    const $ = cheerio.load(html)
    expect($('button').text()).toContain('提前 20 分钟')
  })

  it('正确支持 groups 分组模式并按大类呈现', () => {
    const groups: DropdownGroup<string>[] = [
      {
        label: '交我办与 Canvas · 实时同步',
        options: [{ value: 'current', label: '2026-2027-1 · 当前学期实时同步' }]
      },
      {
        label: '教学信息服务网 · 历年课表',
        options: [
          { value: '2026_3', label: '2026-2027 秋季学期' },
          { value: '2025_16', label: '2025-2026 夏季小学期' }
        ]
      }
    ]

    const html = renderToStaticMarkup(
      React.createElement(DropdownSelect, {
        value: '2026_3',
        groups,
        onChange: () => {}
      })
    )

    const $ = cheerio.load(html)
    expect($('button').text()).toContain('2026-2027 秋季学期')
  })

  it('具备圆润贴合主题的 Apple HIG 外观类名', () => {
    const options: DropdownOption<string>[] = [
      { value: 'a', label: '选项 A' }
    ]

    const html = renderToStaticMarkup(
      React.createElement(DropdownSelect, {
        value: 'a',
        options,
        onChange: () => {}
      })
    )

    const $ = cheerio.load(html)
    const btn = $('button').first()
    expect(btn.attr('class')).toContain('rounded-xl')
    expect(btn.attr('class')).toContain('border')
  })
})
