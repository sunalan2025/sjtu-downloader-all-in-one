export interface ThemeSurface {
  base: string
  surface1: string
  surface2: string
  surface3: string
  surface4: string
  body: string
}

export interface ThemeText {
  primary: string
  secondary: string
  tertiary: string
  muted: string
}

export interface ThemeBorder {
  default: string
  strong: string
}

export interface ThemePalette {
  surface: ThemeSurface
  text: ThemeText
  border: ThemeBorder
  accent: {
    DEFAULT: string
    light: string
    dark: string
  }
  status: {
    success: string
    successBg: string
    warning: string
    warningBg: string
    danger: string
    dangerBg: string
    info: string
    infoBg: string
  }
  cloud: {
    DEFAULT: string
    light: string
    dim: string
  }
}

export const LIGHT_THEME: ThemePalette = {
  surface: {
    base: '#F2F2F7',
    surface1: '#FFFFFF',
    surface2: '#EBEBF0',
    surface3: 'rgba(0, 0, 0, 0.04)',
    surface4: '#D1D1D6',
    body: '#F2F2F7'
  },
  text: {
    primary: 'rgba(29, 29, 31, 1.0)',
    secondary: 'rgba(29, 29, 31, 0.60)',
    tertiary: 'rgba(29, 29, 31, 0.35)',
    muted: 'rgba(29, 29, 31, 0.20)'
  },
  border: {
    default: 'rgba(0, 0, 0, 0.08)',
    strong: 'rgba(0, 0, 0, 0.14)'
  },
  accent: {
    DEFAULT: '#0071E3',
    light: '#409CFF',
    dark: '#0058B6'
  },
  status: {
    success: '#34C759',
    successBg: 'rgba(52, 199, 89, 0.10)',
    warning: '#FF9500',
    warningBg: 'rgba(255, 149, 0, 0.10)',
    danger: '#FF3B30',
    dangerBg: 'rgba(255, 59, 48, 0.08)',
    info: '#0071E3',
    infoBg: 'rgba(0, 113, 227, 0.08)'
  },
  cloud: {
    DEFAULT: '#0071E3',
    light: '#5AC8FA',
    dim: 'rgba(0, 113, 227, 0.07)'
  }
}

export const DARK_THEME: ThemePalette = {
  surface: {
    base: '#161618',
    surface1: '#1E1E22',
    surface2: '#26262A',
    surface3: '#303036',
    surface4: '#3A3A3C',
    body: '#161618'
  },
  text: {
    primary: 'rgba(244, 244, 245, 1.0)',
    secondary: 'rgba(244, 244, 245, 0.60)',
    tertiary: 'rgba(244, 244, 245, 0.35)',
    muted: 'rgba(244, 244, 245, 0.20)'
  },
  border: {
    default: 'rgba(255, 255, 255, 0.08)',
    strong: 'rgba(255, 255, 255, 0.14)'
  },
  accent: {
    DEFAULT: '#0A84FF',
    light: '#409CFF',
    dark: '#0064D6'
  },
  status: {
    success: '#30D158',
    successBg: 'rgba(48, 209, 88, 0.12)',
    warning: '#FF9F0A',
    warningBg: 'rgba(255, 159, 10, 0.12)',
    danger: '#FF453A',
    dangerBg: 'rgba(255, 69, 58, 0.12)',
    info: '#0A84FF',
    infoBg: 'rgba(10, 132, 255, 0.10)'
  },
  cloud: {
    DEFAULT: '#0A84FF',
    light: '#5AC8FA',
    dim: 'rgba(10, 132, 255, 0.10)'
  }
}

export const THEME_TOKENS = {
  light: LIGHT_THEME,
  dark: DARK_THEME
} as const
