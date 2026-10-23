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

  it('should apply dynamic alpha anti-swallowing to dark borders', () => {
    expect(DARK_THEME.border.default).toContain('120, 120, 128')
    expect(DARK_THEME.border.default).toContain('0.32')
    expect(DARK_THEME.border.strong).toContain('120, 120, 128')
    expect(DARK_THEME.border.strong).toContain('0.36')
  })

  it('should export valid tailwind color mappings referencing CSS variables', () => {
    expect(tailwindTheme.colors.base).toBe('var(--bg-base)')
    expect(tailwindTheme.colors['surface-1']).toBe('var(--bg-surface-1)')
    expect(tailwindTheme.colors['text-1']).toBe('var(--text-primary)')
    expect(tailwindTheme.colors.bd).toBe('var(--border-default)')
    expect(tailwindTheme.colors['bd-strong']).toBe('var(--border-strong)')
    expect(tailwindTheme.colors.accent.DEFAULT).toBe('var(--accent)')
  })
})
