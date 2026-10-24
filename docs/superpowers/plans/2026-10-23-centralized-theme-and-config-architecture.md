# 统一主题色彩系统与全局配置集中化架构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 `src/shared/theme/` 与 `src/shared/config/` 两大核心子系统，集中收口深色/浅色设计色彩 Token 与全应用业务偏好/UI 布局常量，实现单一真理来源，并使主进程、渲染进程、Tailwind 与 CSS 变量全面对齐。

**Architecture:** 
1. 在 `src/shared/theme/` 中建立以知乎与 Apple HIG 规范为基准的色彩系统（表面层级逐层微亮抬升、文字等比 Alpha 衰减呼吸感、中性灰边框深色抗吞噬透明度、去饱和提亮语义色），输出 TypeScript Token、Tailwind 色彩映射与集中生成的 `theme.css`；
2. 在 `src/shared/config/` 中沉淀 `defaults.ts`（业务偏好默认值）与 `layout.ts`（UI 层级 Z-Index 标尺与布局度量衡）；
3. 将主进程原生窗口底色、Zustand Store 初始状态、`tailwind.config.cjs` 及 `index.css` 全面收口重构，消除散落硬编码，保持现有 Tailwind 语义类名 100% 向后兼容。

**Tech Stack:** TypeScript, React, TailwindCSS, CSS Custom Properties (`@property`), Electron (Main/Renderer), Zustand, Vitest.

**Spec:** [2026-10-23-centralized-theme-and-config-architecture-design.md](file:///d:/SJTU/编程/sjtu-downloader-all-in-one/docs/superpowers/specs/2026-10-23-centralized-theme-and-config-architecture-design.md)

## Global Constraints

- 全面落地知乎文章《如何提供更好的深色模式设计体验？》色彩规范：深色底色 `#161618`，表面层级从深到浅逐步抬升（Surface-1 `#1E1E22`, Surface-2 `#26262A`, Surface-3 `#303036`, Surface-4 `#3A3A3C`），深色模式物理移除黑色阴影。
- 文字前景色采用等比 Alpha 衰减体系：深色下基底 `rgb(244, 244, 245)` 搭配 100% / 60% / 35% / 20%，浅色下基底 `rgb(29, 29, 31)` 搭配 100% / 60% / 35% / 20%。
- 边框采用基底色 `rgb(120, 120, 128)` 动态抗吞噬体系：深色模式下强化为 `32%`（默认边框）与 `36%`（强调边框）。
- 100% 保持现有 Tailwind 类名（`bg-base`, `bg-surface-1~4`, `text-text-1~4`, `border-bd`, `border-bd-strong`, `bg-accent*`, `bg-task-*` 等）向后兼容，业务层代码无需重写。
- 遵循单一真理来源（SSOT）铁律，严禁在各自组件和页面中硬编码零散配置和色彩。
- 全链路门禁必须 100% 全绿：`npm run typecheck` (0 错误)、`npm run lint` (0 错误 0 警告)、`npm test` (全套 51 测试套件 100% 绿灯)。

---

### Task 1: 构建统一主题色彩子系统 (`src/shared/theme/`) 与单元测试

**Files:**
- Create: `src/shared/theme/tokens.ts`
- Create: `src/shared/theme/theme.css`
- Create: `src/shared/theme/tailwind-theme.cjs`
- Create: `src/shared/theme/index.ts`
- Test: `test/unit/theme-tokens.test.ts`

**Interfaces:**
- Consumes: None (底层基础模块)
- Produces:
  - `THEME_TOKENS`: `{ light: ThemePalette; dark: ThemePalette }`
  - `tailwind-theme.cjs`: `{ colors: Record<string, any>, boxShadow: Record<string, string> }`
  - `theme.css`: `@property` 自定义属性声明与 `:root`, `[data-theme='light']`, `[data-theme='dark']` 变量池

- [ ] **Step 1: 编写主题 Token 契约与完整性测试**

在 `test/unit/theme-tokens.test.ts` 中编写测试：

```typescript
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
```

- [ ] **Step 2: 运行测试以确认红灯**

运行：`npx vitest run test/unit/theme-tokens.test.ts`  
预期：FAIL，模块 `../../src/shared/theme/tokens` 不存在。

- [ ] **Step 3: 实现 `tokens.ts`、`theme.css`、`tailwind-theme.cjs` 与 `index.ts`**

创建 `src/shared/theme/tokens.ts`：

```typescript
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
    default: 'rgba(120, 120, 128, 0.16)',
    strong: 'rgba(120, 120, 128, 0.24)'
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
    default: 'rgba(120, 120, 128, 0.32)',
    strong: 'rgba(120, 120, 128, 0.36)'
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
```

创建 `src/shared/theme/tailwind-theme.cjs`：

```javascript
module.exports = {
  colors: {
    base: 'var(--bg-base)',
    'surface-1': 'var(--bg-surface-1)',
    'surface-2': 'var(--bg-surface-2)',
    'surface-3': 'var(--bg-surface-3)',
    'surface-4': 'var(--bg-surface-4)',
    'text-1': 'var(--text-primary)',
    'text-2': 'var(--text-secondary)',
    'text-3': 'var(--text-tertiary)',
    'text-4': 'var(--text-muted)',
    'text-muted': 'var(--text-muted)',
    bd: 'var(--border-default)',
    'bd-strong': 'var(--border-strong)',
    accent: {
      DEFAULT: 'var(--accent)',
      light: 'var(--accent-light)',
      dark: 'var(--accent-dark)',
      '5': 'var(--accent-5)',
      '10': 'var(--accent-10)',
      '15': 'var(--accent-15)',
      '20': 'var(--accent-20)',
      '25': 'var(--accent-25)',
      '30': 'var(--accent-30)',
      '40': 'var(--accent-40)',
      '50': 'var(--accent-50)',
      '60': 'var(--accent-60)',
      '80': 'var(--accent-80)',
      '85': 'var(--accent-85)',
    },
    cloud: {
      DEFAULT: 'var(--cloud)',
      light: 'var(--cloud-light)',
      dim: 'var(--cloud-dim)',
      '25': 'var(--cloud-25)',
      '40': 'var(--cloud-40)',
    },
    success: {
      DEFAULT: 'var(--success)',
      bg: 'var(--success-bg)',
      ring: 'var(--success-ring)',
    },
    warning: {
      DEFAULT: 'var(--warning)',
      bg: 'var(--warning-bg)',
      ring: 'var(--warning-ring)',
    },
    info: {
      DEFAULT: 'var(--info)',
      bg: 'var(--info-bg)',
      ring: 'var(--info-ring)',
    },
    danger: {
      DEFAULT: 'var(--danger)',
      bg: 'var(--danger-bg)',
      ring: 'var(--danger-ring)',
    },
    task: {
      done: 'var(--task-done-bg)',
      downloading: 'var(--task-downloading-bg)',
      paused: 'var(--task-paused-bg)',
      error: 'var(--task-error-bg)',
      queue: 'var(--queue)',
    },
  },
  boxShadow: {
    glow: '0 10px 40px -10px var(--accent-40)',
    'glow-sm': '0 4px 20px -6px var(--accent-30)',
    'glow-cloud': '0 8px 30px -8px var(--cloud-40)',
    card: '0 2px 12px rgba(0,0,0,0.15), 0 0 0 1px var(--border-default)',
    'card-hover': '0 8px 30px rgba(0,0,0,0.2), 0 0 0 1px var(--border-strong)',
  }
}
```

创建 `src/shared/theme/theme.css`：

```css
/* ─── 主题过渡与 CSS 属性类型注册 ─── */
@property --bg-base { syntax: '<color>'; inherits: true; initial-value: #161618; }
@property --bg-surface-1 { syntax: '<color>'; inherits: true; initial-value: #1e1e22; }
@property --bg-surface-2 { syntax: '<color>'; inherits: true; initial-value: #26262a; }
@property --bg-surface-3 { syntax: '<color>'; inherits: true; initial-value: #303036; }
@property --bg-surface-4 { syntax: '<color>'; inherits: true; initial-value: #3a3a3c; }
@property --bg-body { syntax: '<color>'; inherits: true; initial-value: #161618; }
@property --text-primary { syntax: '<color>'; inherits: true; initial-value: rgba(244, 244, 245, 1); }
@property --text-secondary { syntax: '<color>'; inherits: true; initial-value: rgba(244, 244, 245, 0.6); }
@property --text-tertiary { syntax: '<color>'; inherits: true; initial-value: rgba(244, 244, 245, 0.35); }
@property --text-muted { syntax: '<color>'; inherits: true; initial-value: rgba(244, 244, 245, 0.2); }
@property --border-default { syntax: '<color>'; inherits: true; initial-value: rgba(120, 120, 128, 0.32); }
@property --border-strong { syntax: '<color>'; inherits: true; initial-value: rgba(120, 120, 128, 0.36); }
@property --accent { syntax: '<color>'; inherits: true; initial-value: #0a84ff; }
@property --accent-light { syntax: '<color>'; inherits: true; initial-value: #409cff; }
@property --accent-dark { syntax: '<color>'; inherits: true; initial-value: #0064d6; }
@property --cloud { syntax: '<color>'; inherits: true; initial-value: #0a84ff; }
@property --cloud-light { syntax: '<color>'; inherits: true; initial-value: #5ac8fa; }
@property --success { syntax: '<color>'; inherits: true; initial-value: #30d158; }
@property --warning { syntax: '<color>'; inherits: true; initial-value: #ff9f0a; }
@property --danger { syntax: '<color>'; inherits: true; initial-value: #ff453a; }
@property --info { syntax: '<color>'; inherits: true; initial-value: #0a84ff; }

/* ─── 浅色模式 (Light Theme) ─── */
:root,
[data-theme='light'] {
  --bg-base: #F2F2F7;
  --bg-surface-1: #FFFFFF;
  --bg-surface-2: #EBEBF0;
  --bg-surface-3: rgba(0, 0, 0, 0.04);
  --bg-surface-4: #D1D1D6;
  --bg-body: #F2F2F7;
  --bg-body-accent-1: rgba(0, 113, 227, 0.03);
  --bg-body-accent-2: rgba(0, 113, 227, 0.01);

  --text-primary: rgba(29, 29, 31, 1.0);
  --text-secondary: rgba(29, 29, 31, 0.60);
  --text-tertiary: rgba(29, 29, 31, 0.35);
  --text-muted: rgba(29, 29, 31, 0.20);

  --border-default: rgba(120, 120, 128, 0.16);
  --border-strong: rgba(120, 120, 128, 0.24);

  --accent: #0071E3;
  --accent-light: #409CFF;
  --accent-dark: #0058B6;
  --accent-5: rgba(0, 113, 227, 0.05);
  --accent-10: rgba(0, 113, 227, 0.10);
  --accent-15: rgba(0, 113, 227, 0.15);
  --accent-20: rgba(0, 113, 227, 0.20);
  --accent-25: rgba(0, 113, 227, 0.25);
  --accent-30: rgba(0, 113, 227, 0.30);
  --accent-40: rgba(0, 113, 227, 0.40);
  --accent-50: rgba(0, 113, 227, 0.50);
  --accent-60: rgba(0, 113, 227, 0.60);
  --accent-80: rgba(0, 113, 227, 0.80);
  --accent-85: rgba(0, 113, 227, 0.85);

  --cloud: #0071E3;
  --cloud-light: #5AC8FA;
  --cloud-dim: rgba(0, 113, 227, 0.07);
  --cloud-25: rgba(0, 113, 227, 0.15);
  --cloud-40: rgba(0, 113, 227, 0.25);

  --emerald: #34C759;
  --amber: #FF9500;
  --rose: #FF3B30;
  --sky: #0071E3;

  --success: #34C759;
  --success-bg: rgba(52, 199, 89, 0.10);
  --success-ring: rgba(52, 199, 89, 0.22);
  --warning: #FF9500;
  --warning-bg: rgba(255, 149, 0, 0.10);
  --warning-ring: rgba(255, 149, 0, 0.22);
  --info: #0071E3;
  --info-bg: rgba(0, 113, 227, 0.08);
  --info-ring: rgba(0, 113, 227, 0.20);
  --danger: #FF3B30;
  --danger-bg: rgba(255, 59, 48, 0.08);
  --danger-ring: rgba(255, 59, 48, 0.20);

  --task-done-bg: #E8F8EE;
  --task-downloading-bg: #EBF3FF;
  --task-paused-bg: #FFF4E5;
  --task-error-bg: #FEECEB;
  --queue: #86868B;

  --progress-track: #E5E5EA;
  --selection-bg: rgba(0, 113, 227, 0.15);
  --scrollbar-thumb: rgba(0, 0, 0, 0.16);
  --scrollbar-thumb-hover: rgba(0, 0, 0, 0.28);

  color-scheme: light;
}

/* ─── 深色模式 (Dark Theme - 知乎 & Apple HIG 规范化) ─── */
[data-theme='dark'] {
  --bg-base: #161618;
  --bg-surface-1: #1E1E22;
  --bg-surface-2: #26262A;
  --bg-surface-3: #303036;
  --bg-surface-4: #3A3A3C;
  --bg-body: #161618;
  --bg-body-accent-1: rgba(10, 132, 255, 0.04);
  --bg-body-accent-2: rgba(10, 132, 255, 0.02);

  --text-primary: rgba(244, 244, 245, 1.0);
  --text-secondary: rgba(244, 244, 245, 0.60);
  --text-tertiary: rgba(244, 244, 245, 0.35);
  --text-muted: rgba(244, 244, 245, 0.20);

  --border-default: rgba(120, 120, 128, 0.32);
  --border-strong: rgba(120, 120, 128, 0.36);

  --accent: #0A84FF;
  --accent-light: #409CFF;
  --accent-dark: #0064D6;
  --accent-5: rgba(10, 132, 255, 0.05);
  --accent-10: rgba(10, 132, 255, 0.10);
  --accent-15: rgba(10, 132, 255, 0.15);
  --accent-20: rgba(10, 132, 255, 0.20);
  --accent-25: rgba(10, 132, 255, 0.25);
  --accent-30: rgba(10, 132, 255, 0.30);
  --accent-40: rgba(10, 132, 255, 0.40);
  --accent-50: rgba(10, 132, 255, 0.50);
  --accent-60: rgba(10, 132, 255, 0.60);
  --accent-80: rgba(10, 132, 255, 0.80);
  --accent-85: rgba(10, 132, 255, 0.85);

  --cloud: #0A84FF;
  --cloud-light: #5AC8FA;
  --cloud-dim: rgba(10, 132, 255, 0.10);
  --cloud-25: rgba(10, 132, 255, 0.25);
  --cloud-40: rgba(10, 132, 255, 0.40);

  --emerald: #30D158;
  --amber: #FF9F0A;
  --rose: #FF453A;
  --sky: #0A84FF;

  --success: #30D158;
  --success-bg: rgba(48, 209, 88, 0.12);
  --success-ring: rgba(48, 209, 88, 0.24);
  --warning: #FF9F0A;
  --warning-bg: rgba(255, 159, 10, 0.12);
  --warning-ring: rgba(255, 159, 10, 0.24);
  --info: #0A84FF;
  --info-bg: rgba(10, 132, 255, 0.10);
  --info-ring: rgba(10, 132, 255, 0.22);
  --danger: #FF453A;
  --danger-bg: rgba(255, 69, 58, 0.12);
  --danger-ring: rgba(255, 69, 58, 0.24);

  --task-done-bg: #1A2E28;
  --task-downloading-bg: #1F2937;
  --task-paused-bg: #2E2316;
  --task-error-bg: #2E1F1F;
  --queue: #71717A;

  --progress-track: #26262A;
  --selection-bg: rgba(10, 132, 255, 0.25);
  --scrollbar-thumb: rgba(255, 255, 255, 0.16);
  --scrollbar-thumb-hover: rgba(255, 255, 255, 0.28);

  color-scheme: dark;
}
```

创建 `src/shared/theme/index.ts`：

```typescript
export * from './tokens'
```

- [ ] **Step 4: 运行测试以确认绿灯**

运行：`npx vitest run test/unit/theme-tokens.test.ts`  
预期：PASS，所有测试全绿通过。

- [ ] **Step 5: 提交改动**

```bash
git add src/shared/theme/ test/unit/theme-tokens.test.ts
git commit -m "feat(theme): establish centralized design tokens and theme style system"
```

---

### Task 2: 构建统一全局配置子系统 (`src/shared/config/`) 与单元测试

**Files:**
- Create: `src/shared/config/defaults.ts`
- Create: `src/shared/config/layout.ts`
- Create: `src/shared/config/index.ts`
- Test: `test/unit/shared-config.test.ts`

**Interfaces:**
- Consumes: None
- Produces:
  - `APP_DEFAULTS`: 包含全局并发、限速、冲突策略、退出策略、视频默认项、中转服务默认项
  - `Z_INDEX`: 全局 UI 层级映射字典
  - `LAYOUT_METRICS`: 布局度量衡
  - `ANIMATION_DURATION`: 交互动画标尺

- [ ] **Step 1: 编写配置系统单测**

在 `test/unit/shared-config.test.ts` 中编写测试：

```typescript
import { describe, it, expect } from 'vitest'
import { APP_DEFAULTS } from '../../src/shared/config/defaults'
import { Z_INDEX, LAYOUT_METRICS, ANIMATION_DURATION } from '../../src/shared/config/layout'

describe('Centralized Shared Config Suite', () => {
  it('should provide complete and valid application defaults', () => {
    expect(APP_DEFAULTS.concurrency).toBe(3)
    expect(APP_DEFAULTS.maxDownloadSpeedKBps).toBe(0)
    expect(APP_DEFAULTS.fileConflictStrategy).toBe('skip')
    expect(APP_DEFAULTS.windowCloseAction).toBe('tray')
    expect(APP_DEFAULTS.exitWhenDownloadingPolicy).toBe('prompt')
    expect(APP_DEFAULTS.videoQualityOption).toBe('origin')
    expect(APP_DEFAULTS.videoPerspectivePreference).toBe('teacher')
    expect(APP_DEFAULTS.defaultLocalDestRoot).toBe('SJTU课程')
    expect(APP_DEFAULTS.defaultCloudDestRoot).toBe('/SJTU课程备份')
    expect(APP_DEFAULTS.privateWorker.endpointUrl).toBe('http://127.0.0.1:6880')
  })

  it('should maintain strict monotonic and clash-free z-index ordering', () => {
    expect(Z_INDEX.base).toBeLessThan(Z_INDEX.stickyHeader)
    expect(Z_INDEX.stickyHeader).toBeLessThan(Z_INDEX.dropdown)
    expect(Z_INDEX.dropdown).toBeLessThan(Z_INDEX.commandIsland)
    expect(Z_INDEX.commandIsland).toBeLessThan(Z_INDEX.modalBackdrop)
    expect(Z_INDEX.modalBackdrop).toBeLessThan(Z_INDEX.modalCard)
    expect(Z_INDEX.modalCard).toBeLessThan(Z_INDEX.toast)
  })

  it('should define positive layout metrics and reasonable animation durations', () => {
    expect(LAYOUT_METRICS.commandIslandBottomPadding).toBe(96)
    expect(LAYOUT_METRICS.sidebarWidthCollapsed).toBeGreaterThan(0)
    expect(LAYOUT_METRICS.sidebarWidthExpanded).toBeGreaterThan(LAYOUT_METRICS.sidebarWidthCollapsed)
    expect(ANIMATION_DURATION.toastAutoDismiss).toBe(3000)
  })
})
```

- [ ] **Step 2: 运行测试以确认红灯**

运行：`npx vitest run test/unit/shared-config.test.ts`  
预期：FAIL，模块 `../../src/shared/config/defaults` 不存在。

- [ ] **Step 3: 实现 `defaults.ts`、`layout.ts` 与 `index.ts`**

创建 `src/shared/config/defaults.ts`：

```typescript
import type { DownloadMode, FileConflictStrategy, VideoQualityOption, VideoPerspective } from '../types'

export interface AppDefaultsConfig {
  concurrency: number
  maxDownloadSpeedKBps: number
  downloadMode: DownloadMode
  fileConflictStrategy: FileConflictStrategy
  windowCloseAction: 'tray' | 'taskbar' | 'quit'
  exitWhenDownloadingPolicy: 'prompt' | 'background' | 'pause_quit'
  videoQualityOption: VideoQualityOption
  videoPerspectivePreference: VideoPerspective
  defaultLocalDestRoot: string
  defaultCloudDestRoot: string
  defaultNamingTemplate: string
  courseViewMode: 'grid' | 'list' | 'column'
  privateWorker: {
    enabled: boolean
    endpointUrl: string
    authToken: string
  }
}

export const APP_DEFAULTS: AppDefaultsConfig = {
  concurrency: 3,
  maxDownloadSpeedKBps: 0,
  downloadMode: 'local',
  fileConflictStrategy: 'skip',
  windowCloseAction: 'tray',
  exitWhenDownloadingPolicy: 'prompt',
  videoQualityOption: 'origin',
  videoPerspectivePreference: 'teacher',
  defaultLocalDestRoot: 'SJTU课程',
  defaultCloudDestRoot: '/SJTU课程备份',
  defaultNamingTemplate: '{course}/{category}/{title}.{ext}',
  courseViewMode: 'grid',
  privateWorker: {
    enabled: false,
    endpointUrl: 'http://127.0.0.1:6880',
    authToken: ''
  }
}
```

创建 `src/shared/config/layout.ts`：

```typescript
export const Z_INDEX = {
  base: 0,
  stickyHeader: 10,
  dropdown: 30,
  drawer: 35,
  commandIsland: 40,
  modalBackdrop: 50,
  modalCard: 51,
  popover: 60,
  toast: 100,
} as const

export const LAYOUT_METRICS = {
  sidebarWidthCollapsed: 64,
  sidebarWidthExpanded: 240,
  titlebarHeight: 40,
  commandIslandBottomPadding: 96, // 对应 pb-24，确保底部卡片不被动作岛遮挡
  cardGridMinWidth: 260,
} as const

export const ANIMATION_DURATION = {
  fast: 150,
  normal: 200,
  slow: 300,
  toastAutoDismiss: 3000,
} as const
```

创建 `src/shared/config/index.ts`：

```typescript
export * from './defaults'
export * from './layout'
```

- [ ] **Step 4: 运行测试以确认绿灯**

运行：`npx vitest run test/unit/shared-config.test.ts`  
预期：PASS，所有测试全绿通过。

- [ ] **Step 5: 提交改动**

```bash
git add src/shared/config/ test/unit/shared-config.test.ts
git commit -m "feat(config): establish centralized application defaults and layout constants"
```

---

### Task 3: 集成 Tailwind、全局 CSS 与主进程窗口底色

**Files:**
- Modify: `tailwind.config.cjs`
- Modify: `src/renderer/src/index.css`
- Modify: `src/main/window.ts`
- Test: `test/unit/theme-tokens.test.ts`

**Interfaces:**
- Consumes: `@shared/theme/tailwind-theme.cjs`, `@shared/theme/theme.css`, `@shared/theme/tokens`
- Produces: 打通底层编译构建与全局样式

- [ ] **Step 1: 在 `tailwind.config.cjs` 中引入 `@shared/theme/tailwind-theme.cjs`**

编辑 `tailwind.config.cjs`：

```javascript
/** @type {import('tailwindcss').Config} */
const sharedTheme = require('./src/shared/theme/tailwind-theme.cjs')

module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: sharedTheme.colors,
      boxShadow: sharedTheme.boxShadow,
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro Display"',
          '"PingFang SC"',
          'Inter',
          '"Segoe UI"',
          '"Microsoft YaHei"',
          '"Noto Sans SC"',
          'sans-serif'
        ]
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1.4' }],
        xs: ['0.75rem', { lineHeight: '1.5' }],
        sm: ['0.875rem', { lineHeight: '1.5' }],
        base: ['1rem', { lineHeight: '1.6' }],
        lg: ['1.125rem', { lineHeight: '1.5', fontWeight: '600' }],
        xl: ['1.375rem', { lineHeight: '1.4', fontWeight: '600' }],
        '2xl': ['1.75rem', { lineHeight: '1.3', fontWeight: '700' }],
        '3xl': ['2.25rem', { lineHeight: '1.2', fontWeight: '700' }],
        caption: ['0.75rem', { lineHeight: '1.5' }],
        body: ['0.875rem', { lineHeight: '1.5' }],
        display: ['1.25rem', { lineHeight: '1.4', fontWeight: '700' }]
      },
      backgroundImage: {
        'hero-radial':
          'radial-gradient(1200px 600px at 20% -10%, var(--accent-15), transparent 60%), radial-gradient(900px 500px at 100% 20%, var(--bg-surface-2), transparent 60%)'
      },
      keyframes: {
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' }
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' }
        },
        pulseGlow: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.8' }
        }
      },
      animation: {
        shimmer: 'shimmer 2s infinite',
        fadeIn: 'fadeIn 0.25s ease-out forwards',
        fadeInUp: 'fadeInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        float: 'float 4s ease-in-out infinite',
        'pulse-slow': 'pulseGlow 3s ease-in-out infinite'
      }
    }
  },
  plugins: []
}
```

- [ ] **Step 2: 净化 `src/renderer/src/index.css` 并引入 `@shared/theme/theme.css`**

在 `src/renderer/src/index.css` 顶部导入 `theme.css`，替换掉原本内嵌的 220 余行 `@property` 与 `:root`/`[data-theme='dark']` 声明：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@import '../../shared/theme/theme.css';

@layer base {
  html,
  body,
  #root {
    height: 100%;
    margin: 0;
  }
...
```

- [ ] **Step 3: 主进程 `src/main/window.ts` 接入 `@shared/theme`**

在 `src/main/window.ts` 中引入 `THEME_TOKENS`：

```typescript
import { THEME_TOKENS } from '../shared/theme'

// 在 createWindow 中：
backgroundColor: THEME_TOKENS.dark.surface.base,
```

- [ ] **Step 4: 运行类型检查与主题单测**

运行：
`npm run typecheck`  
`npx vitest run test/unit/theme-tokens.test.ts`  
预期：PASS，0 错误。

- [ ] **Step 5: 提交改动**

```bash
git add tailwind.config.cjs src/renderer/src/index.css src/main/window.ts
git commit -m "refactor(theme): bind tailwind, global css and main window to centralized theme tokens"
```

---

### Task 4: 重构 Zustand Store 与组件层默认值引用

**Files:**
- Modify: `src/renderer/src/store/app.ts`
- Modify: `src/shared/utils.ts`
- Test: `test/unit/setup-wizard-modal.test.ts`, `test/unit/z-index-layering.test.ts`

**Interfaces:**
- Consumes: `@shared/config/defaults`, `@shared/config/layout`
- Produces: 彻底移除 Store 与公共模块中的硬编码默认配置

- [ ] **Step 1: 在 `src/renderer/src/store/app.ts` 引入 `APP_DEFAULTS`**

在 `src/renderer/src/store/app.ts` 中：
将 `theme`、`downloadMode`、`fileConflictStrategy`、`concurrency`、`maxDownloadSpeedKBps`、`localDestRoot`、`cloudDestRoot`、`videoQualityOption`、`videoPerspectivePreference`、`windowCloseAction`、`exitWhenDownloadingPolicy`、`courseViewMode`、`privateWorkerConfig` 的初始值统一替换为 `APP_DEFAULTS` 中的定义：

```typescript
import { APP_DEFAULTS } from '@shared/config/defaults'

// create<AppState>() 初始状态：
theme: 'dark',
stage: 'welcome',
activeTab: 'canvas',
auth: { hasValidCookie: false, authenticated: false },
...
downloadMode: APP_DEFAULTS.downloadMode,
fileConflictStrategy: APP_DEFAULTS.fileConflictStrategy,
concurrency: APP_DEFAULTS.concurrency,
maxDownloadSpeedKBps: APP_DEFAULTS.maxDownloadSpeedKBps,
localDestRoot: APP_DEFAULTS.defaultLocalDestRoot,
cloudDestRoot: APP_DEFAULTS.defaultCloudDestRoot,
videoQualityOption: APP_DEFAULTS.videoQualityOption,
videoPerspectivePreference: APP_DEFAULTS.videoPerspectivePreference,
windowCloseAction: APP_DEFAULTS.windowCloseAction,
exitWhenDownloadingPolicy: APP_DEFAULTS.exitWhenDownloadingPolicy,
courseViewMode: APP_DEFAULTS.courseViewMode,
privateWorkerConfig: { ...APP_DEFAULTS.privateWorker },
```

- [ ] **Step 2: 在 `src/shared/utils.ts` 中引用 `APP_DEFAULTS.defaultNamingTemplate`**

在 `src/shared/utils.ts` 中：
```typescript
import { APP_DEFAULTS } from './config/defaults'

export const DEFAULT_NAMING_TEMPLATE = APP_DEFAULTS.defaultNamingTemplate
```

- [ ] **Step 3: 运行相关单元测试验证无回归**

运行：
`npx vitest run test/unit/setup-wizard-modal.test.ts test/unit/z-index-layering.test.ts`  
预期：PASS，所有测试全部绿灯通过。

- [ ] **Step 4: 提交改动**

```bash
git add src/renderer/src/store/app.ts src/shared/utils.ts
git commit -m "refactor(config): consume centralized APP_DEFAULTS in app store and shared utils"
```

---

### Task 5: 全链路门禁终验与回归验证 (Typecheck, Lint, Test)

**Files:**
- Verify: 全工程源码与测试

- [ ] **Step 1: 执行 TypeScript 静态类型检查**

运行：`npm run typecheck`  
预期：0 错误，全绿退出。

- [ ] **Step 2: 执行 ESLint 代码规范检查**

运行：`npm run lint`  
预期：0 错误 0 警告，全绿退出。

- [ ] **Step 3: 运行全套自动化测试套件**

运行：`npm test`  
预期：52 个测试套件，945+ 个测试用例 100% 绿灯全过！

- [ ] **Step 4: Git 提交或确认工作区干净**

```bash
git status
```
确保工作区干净无未跟踪的残余文件。
