import { argbFromHex, hexFromArgb, themeFromSourceColor } from '@material/material-color-utilities'

export type Appearance = {
  accent: 'system' | 'ocean' | 'jade' | 'iris'
  theme: 'system' | 'light' | 'dark'
  reducedEffects: boolean
}
export type DeviceAppearance = { dark: boolean; systemSeed?: string }
const KEY = 'sjtu-appearance-v1'
export const accentSeeds = { ocean: '#007aff', jade: '#008577', iris: '#7955b5' }
export function readAppearance(): Appearance {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}')
    return {
      accent: ['system', 'ocean', 'jade', 'iris'].includes(value.accent) ? value.accent : 'system',
      theme: ['system', 'light', 'dark'].includes(value.theme) ? value.theme : 'system',
      reducedEffects: value.reducedEffects === true
    }
  } catch {
    return { accent: 'system', theme: 'system', reducedEffects: false }
  }
}
export function storeAppearance(value: Appearance) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    /* In-memory choices still work. */
  }
}
const cache = new Map<string, Record<string, string>>()
/** Shared Material HCT/tonal roles for pages, portals and native dialog chrome. */
export function materialColors(seed: string, dark: boolean): Record<string, string> {
  const key = seed + dark
  const saved = cache.get(key)
  if (saved) return saved
  const theme = themeFromSourceColor(argbFromHex(seed))
  const scheme = (dark ? theme.schemes.dark : theme.schemes.light).toJSON()
  const colors: Record<string, string> = {}
  for (const [role, value] of Object.entries(scheme)) colors[role] = hexFromArgb(value)
  for (const [role, lightTone, darkTone] of [
    ['surface', 98, 6],
    ['surfaceContainerLowest', 100, 4],
    ['surfaceContainerLow', 96, 10],
    ['surfaceContainer', 94, 12],
    ['surfaceContainerHigh', 92, 17],
    ['surfaceContainerHighest', 90, 22]
  ] as const)
    colors[role] = hexFromArgb(theme.palettes.neutral.tone(dark ? darkTone : lightTone))
  for (const [name, source] of Object.entries({ course: '#2363c4', event: '#008577', homework: '#986000', exam: '#9956a0' })) {
    const group = themeFromSourceColor(argbFromHex(source)).schemes[dark ? 'dark' : 'light']
    colors[name + 'Container'] = hexFromArgb(group.primaryContainer)
    colors['on' + name[0].toUpperCase() + name.slice(1) + 'Container'] = hexFromArgb(group.onPrimaryContainer)
  }
  cache.set(key, colors)
  return colors
}
export function applyMaterialTheme(value: Appearance, device: DeviceAppearance) {
  const dark = value.theme === 'dark' || (value.theme === 'system' && device.dark)
  const seed = value.accent === 'system' ? device.systemSeed || accentSeeds.ocean : accentSeeds[value.accent]
  const colors = materialColors(seed, dark)
  const root = document.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  root.dataset.accent = value.accent
  root.dataset.effects = value.reducedEffects ? 'reduced' : 'standard'
  root.style.colorScheme = dark ? 'dark' : 'light'
  for (const [role, color] of Object.entries(colors))
    root.style.setProperty('--md-' + role.replace(/[A-Z]/g, part => '-' + part.toLowerCase()), color)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors.surface)
  return { dark, colors }
}
