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
    expect(typeof tailwindTheme.colors.accent.DEFAULT).toBe('function')
    expect(tailwindTheme.colors.accent.DEFAULT()).toBe('var(--accent)')
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

  it('should provide resilient opacity fallback for semantic colors (accent, amber, success, danger, cloud, emerald, sky, rose)', () => {
    const accentFn = tailwindTheme.colors.accent.DEFAULT
    const amberFn = tailwindTheme.colors.amber
    const successFn = tailwindTheme.colors.success.DEFAULT
    const dangerFn = tailwindTheme.colors.danger.DEFAULT
    const warningFn = tailwindTheme.colors.warning.DEFAULT
    const cloudFn = tailwindTheme.colors.cloud.DEFAULT
    const emeraldFn = tailwindTheme.colors.emerald
    const skyFn = tailwindTheme.colors.sky
    const roseFn = tailwindTheme.colors.rose

    expect(typeof accentFn).toBe('function')
    expect(typeof amberFn).toBe('function')
    expect(typeof successFn).toBe('function')
    expect(typeof dangerFn).toBe('function')
    expect(typeof warningFn).toBe('function')
    expect(typeof cloudFn).toBe('function')
    expect(typeof emeraldFn).toBe('function')
    expect(typeof skyFn).toBe('function')
    expect(typeof roseFn).toBe('function')

    // Standard class without opacity modifier (with opacityVariable): returns var(--<color>)
    expect(accentFn({ opacityVariable: '--tw-border-opacity' })).toBe('var(--accent)')
    expect(amberFn({ opacityVariable: '--tw-border-opacity' })).toBe('var(--amber)')
    expect(successFn({ opacityVariable: '--tw-border-opacity' })).toBe('var(--success)')
    expect(dangerFn({ opacityVariable: '--tw-border-opacity' })).toBe('var(--danger)')

    // With explicit opacityValue (e.g. border-accent/40, border-amber/20, border-success/30, border-danger/30)
    expect(accentFn({ opacityValue: '0.4' })).toBe('rgba(var(--color-accent-rgb), 0.4)')
    expect(amberFn({ opacityValue: '0.2' })).toBe('rgba(var(--color-amber-rgb), 0.2)')
    expect(successFn({ opacityValue: '0.3' })).toBe('rgba(var(--color-success-rgb), 0.3)')
    expect(dangerFn({ opacityValue: '0.3' })).toBe('rgba(var(--color-danger-rgb), 0.3)')
    expect(warningFn({ opacityValue: '0.25' })).toBe('rgba(var(--color-warning-rgb), 0.25)')
    expect(cloudFn({ opacityValue: '0.4' })).toBe('rgba(var(--color-cloud-rgb), 0.4)')
    expect(emeraldFn({ opacityValue: '0.5' })).toBe('rgba(var(--color-emerald-rgb), 0.5)')
    expect(skyFn({ opacityValue: '0.5' })).toBe('rgba(var(--color-sky-rgb), 0.5)')
    expect(roseFn({ opacityValue: '0.5' })).toBe('rgba(var(--color-rose-rgb), 0.5)')

    // Direct invocation with no params: fallback to direct CSS variable
    expect(accentFn()).toBe('var(--accent)')
    expect(amberFn()).toBe('var(--amber)')
    expect(successFn()).toBe('var(--success)')
    expect(dangerFn()).toBe('var(--danger)')
  })

  it('should preserve sub-keys for nested semantic color tokens', () => {
    expect(tailwindTheme.colors.accent.light).toBe('var(--accent-light)')
    expect(tailwindTheme.colors.accent.dark).toBe('var(--accent-dark)')
    expect(tailwindTheme.colors.accent['5']).toBe('var(--accent-5)')
    expect(tailwindTheme.colors.accent['85']).toBe('var(--accent-85)')
    expect(tailwindTheme.colors.cloud.light).toBe('var(--cloud-light)')
    expect(tailwindTheme.colors.cloud.dim).toBe('var(--cloud-dim)')
    expect(tailwindTheme.colors.cloud['40']).toBe('var(--cloud-40)')
    expect(tailwindTheme.colors.success.bg).toBe('var(--success-bg)')
    expect(tailwindTheme.colors.warning.ring).toBe('var(--warning-ring)')
    expect(tailwindTheme.colors.danger.bg).toBe('var(--danger-bg)')
  })
})
