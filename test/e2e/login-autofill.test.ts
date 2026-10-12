import { describe, it, expect } from 'vitest'
import { getAutofillScript } from '../../src/renderer/src/pages/Login'
import type { MaskedCredential } from '../../src/shared/types'

describe('Login Autofill & Floating Dropdown Injected Script Suite', () => {
  const mockAccount1: MaskedCredential = {
    id: 'cred_1',
    username: 'student2024',
    label: '本科主账号',
    maskedPassword: '••••••••',
    createdAt: 1700000000000,
    lastUsedAt: 1700000000000
  }

  const mockAccount2: MaskedCredential = {
    id: 'cred_2',
    username: 'grad2026',
    label: '研究生账号',
    maskedPassword: '••••••••',
    createdAt: 1700000001000,
    lastUsedAt: 1700000001000
  }

  it('generates valid script with 0 accounts that contains capture listeners and no dropdown', () => {
    const script = getAutofillScript([], false, null)

    // 语法基本校验：可作为函数体被 JS 解析
    expect(() => new Function(script)).not.toThrow()

    // 校验凭据捕获协议
    expect(script).toContain('__SJTU_CRED_CAPTURED__:')
    expect(script).toContain('submit')
    expect(script).toContain('#submit-password-button')

    // 0 个账号时不应产生回填数据与下拉项
    expect(script).toContain('defaultFill = null')
    expect(script).toContain('accounts = []')

    // 核心安全准则：绝不包含自动提交调用
    expect(script).not.toContain('.submit()')
    expect(script).not.toContain('.click()')
  })

  it('generates single account autofill script without floating dropdown', () => {
    const script = getAutofillScript([mockAccount1], false, {
      username: 'student2024',
      password: 'mypassword123'
    })

    expect(() => new Function(script)).not.toThrow()

    // 包含回填数据及辅助回填函数
    expect(script).toContain('window.__sjtuFillCred')
    expect(script).toContain('student2024')
    expect(script).toContain('mypassword123')
    expect(script).toContain('performAutofill')

    // 派发 input 与 change 事件保证框架受控组件更新
    expect(script).toContain("new Event('input'")
    expect(script).toContain("new Event('change'")

    // 单账号时不展示悬浮下拉卡片或切换徽章
    expect(script).toContain('if (!accs || accs.length <= 1) return;')

    // 核心安全准则：绝不包含自动提交调用
    expect(script).not.toContain('.submit()')
  })

  it('generates multi-account script with Chrome/Edge style floating dropdown and action bridges', () => {
    const script = getAutofillScript([mockAccount1, mockAccount2], true, {
      username: 'grad2026',
      password: 'gradpassword456'
    })

    expect(() => new Function(script)).not.toThrow()

    // 包含两账号脱敏数据
    expect(script).toContain('student2024')
    expect(script).toContain('grad2026')
    expect(script).toContain('本科主账号')
    expect(script).toContain('研究生账号')

    // 下拉框与切换徽章
    expect(script).toContain('__sjtu_cred_dropdown')
    expect(script).toContain('__sjtu_cred_toggle')
    expect(script).toContain('个账号')

    // 账号切换协议与删除协议
    expect(script).toContain('__SJTU_CRED_SELECT__:')
    expect(script).toContain('__SJTU_CRED_DELETE__:')

    // 新账号选项与关闭处理
    expect(script).toContain('使用其他账号登录')
    expect(script).toContain('Escape')

    // 暴露 window.__sjtuUpdateAccounts 供宿主删除或同步时实时更新
    expect(script).toContain('window.__sjtuUpdateAccounts')

    // 适配暗色主题颜色
    expect(script).toContain('#232323')
    expect(script).toContain('#F5F5F5')

    // 核心安全准则：绝不包含自动提交
    expect(script).not.toContain('.submit()')
  })

  it('adapts to light theme correctly for multi-account dropdown', () => {
    const script = getAutofillScript([mockAccount1, mockAccount2], false)

    expect(script).toContain('#FFFFFF')
    expect(script).toContain('#1D2129')
    expect(script).toContain('#E5E6EB')
    expect(script).toContain('__SJTU_CRED_SELECT__:')
  })
})
