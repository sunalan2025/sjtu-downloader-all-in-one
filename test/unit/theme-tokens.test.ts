import { describe, it, expect } from 'vitest'
import { THEME_TOKENS, LIGHT_THEME, DARK_THEME } from '../../src/shared/theme/tokens'
import tailwindTheme from '../../src/shared/theme/tailwind-theme.cjs'

describe('Centralized Theme Tokens Contract Suite', () => {
  it('should define both light and dark palettes with symmetric keys', () => {
    expect(THEME_TOKENS.light).toBeDefined()
    expect(THEME_TOKENS.dark).toBeDefined()
    expect(LIGHT_THEME).toBe(THEME_TOKENS.light)
    expect(DARK_THEME).toBe(THEME_TOKENS.dark)

    const lightKeys = Object.keys(LIGHT_THEME).sort()
    const darkKeys = Object.keys(DARK_THEME).sort()
    expect(lightKeys).toEqual(darkKeys)
  })

  it('should satisfy Zhihu/Apple HIG dark mode elevation principles', () => {
    // Canvas base should be soft dark charcoal, not pure OLED pitch black
    expect(DARK_THEME.surface.base).toBe('#161618')
    // Surface elevation must strictly increase from base to surface 4
    expect(DARK_THEME.surface.surface1).toBe('#1E1E22')
    expect(DARK_THEME.surface.surface2).toBe('#26262A')
    expect(DARK_THEME.surface.surface3).toBe('#303036')
    expect(DARK_THEME.surface.surface4).toBe('#3A3A3C')
  })

  it('should apply soft graphite border tokens for dark and light themes', () => {
    expect(DARK_THEME.border.default).toBe('rgba(255, 255, 255, 0.08)')
    expect(DARK_THEME.border.strong).toBe('rgba(255, 255, 255, 0.14)')
    expect(LIGHT_THEME.border.default).toBe('rgba(0, 0, 0, 0.08)')
    expect(LIGHT_THEME.border.strong).toBe('rgba(0, 0, 0, 0.14)')
  })

  it('should export valid tailwind color mappings referencing CSS variables', () => {
    expect(tailwindTheme.colors.base).toBe('var(--bg-base)')
    expect(tailwindTheme.colors['surface-1']).toBe('var(--bg-surface-1)')
    expect(tailwindTheme.colors['text-1']).toBe('var(--text-primary)')
    expect(tailwindTheme.colors.accent.DEFAULT).toBe('var(--accent)')
  })

  it('should provide resilient opacity fallback for bd and bd-strong colors in tailwind', () => {
    const bdColorFn = tailwindTheme.colors.bd
    const bdStrongColorFn = tailwindTheme.colors['bd-strong']

    expect(typeof bdColorFn).toBe('function')
    expect(typeof bdStrongColorFn).toBe('function')

    // Standard border-bd (with opacityVariable): returns var(--border-default)
    expect(bdColorFn({ opacityVariable: '--tw-border-opacity' })).toBe('var(--border-default)')
    expect(bdStrongColorFn({ opacityVariable: '--tw-border-opacity' })).toBe('var(--border-strong)')

    // With explicit opacityValue (e.g. border-bd/50): returns rgba(var(--color-bd-rgb), 0.5)
    expect(bdColorFn({ opacityValue: '0.5' })).toBe('rgba(var(--color-bd-rgb), 0.5)')
    expect(bdStrongColorFn({ opacityValue: '0.8' })).toBe('rgba(var(--color-bd-rgb), 0.8)')

    // Direct invocation with no params: fallback to direct CSS variable
    expect(bdColorFn({})).toBe('var(--border-default)')
    expect(bdStrongColorFn({})).toBe('var(--border-strong)')
    expect(bdColorFn()).toBe('var(--border-default)')
    expect(bdStrongColorFn()).toBe('var(--border-strong)')
  })
})
