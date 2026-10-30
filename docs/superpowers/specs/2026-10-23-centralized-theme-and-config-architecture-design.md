# 统一主题色彩系统与全局配置集中化架构设计规范

**文档编号**：SPEC-2026-10-23-THEME-CONFIG  
**创建日期**：2026-10-23  
**状态**：Approved (已对齐批准)  
**作者**：Antigravity & 用户合作共创  

---

## 1. 背景与核心诉求

### 1.1 现状与痛点
1. **深色模式视觉失衡与眩光**：
   - 此前深色模式在部分高对比度环境下存在文字与纯黑/纯白边框刺眼、彩色色相在暗底上发飘产生光晕震荡（Halation Effect）等问题；
   - 依据知乎专栏深度剖析文章《如何提供更好的深色模式设计体验？》（酸梅干超人），深色模式绝非浅色色彩的简单取反，而是需要遵循**“深灰到中灰的逐层表面抬升（Surface Elevation）”**、**“文字等比 Alpha 衰减呼吸感”**、**“中性灰边框动态 Alpha 逆向抗吞噬法则”**以及**“语义彩色去饱和提亮”**的系统化科学调色。
2. **色彩与配置散落凌乱，维护成本极高**：
   - 颜色定义散落在 `src/renderer/src/index.css`（200 余行 `@property` 与选择器变量）、`tailwind.config.cjs`、以及若干组件代码中；
   - 业务默认配置（如并发数、默认路径、清晰度、机位偏好、冲突策略、关闭行为、私有中转 Worker 默认地址等）与 UI 系统常量（Z-Index 标尺、浮岛避让内边距、动画时长）硬编码散落在 `app.ts`、`utils.ts`、`private-worker.ts` 等多个文件中；
   - 开发者或用户调整配色或修改参数时需要满盘寻找、多处同步，极易出现漏改与状态不同步。

### 1.2 重构目标
1. **单一真理来源（Single Source of Truth, SSOT）**：
   - 建立 `src/shared/theme/`，集中管理全应用所有浅色/深色色彩 Token 与 CSS 变量映射；
   - 建立 `src/shared/config/`，集中管理全应用所有业务偏好默认值与 UI 系统布局常量。
2. **跨端共享统一**：
   - 主进程（如原生窗口背景底色 `window.ts`）、渲染进程（React 组件树）与构建层（`tailwind.config.cjs`）统一从 `src/shared/` 导入，消除任何硬编码与信息孤岛。
3. **100% 优雅向后兼容**：
   - 现有 Tailwind 类名（`bg-base`, `bg-surface-1~4`, `text-text-1~4`, `border-bd`, `border-bd-strong`, `bg-accent*`, `bg-task-*` 等）完全保持不变，上层业务代码零改动享受升级红利；
   - 51 个自动化测试文件、943 个测试用例 100% 全绿，Lint 与 Typecheck 零错误。

---

## 2. 系统架构拓扑

```
src/shared/
├── theme/                        # 🎨 统一设计系统与主题子文件夹
│   ├── tokens.ts                 # 原始色板与语义主题映射（Light / Dark 两套结构化定义）
│   ├── tailwind-theme.cjs        # 供 tailwind.config.cjs 消费的色彩与投影配置
│   ├── theme.css                 # 集中生成的 CSS 变量与 @property 动画声明
│   └── index.ts                  # 统一导出供 TS 代码引用的色彩常量与辅助工具
│
└── config/                       # ⚙️ 统一全局配置子文件夹
    ├── defaults.ts               # 业务偏好默认值（并发数、路径、机位、清晰度、冲突策略等）
    ├── layout.ts                 # UI 交互与布局系统常量（Z-Index 层级梯队、避让间距、动效时长）
    └── index.ts                  # 统一导出
```

---

## 3. 详细设计：色彩系统 (`src/shared/theme/`)

### 3.1 表面层级梯队 (Surface Hierarchy)
深色模式摒弃刺激性纯黑 `#000000`，采用符合桌面显示器视效的温润深炭黑递进梯队：

| 表面层级 | 语义类名 / CSS变量 | 浅色模式 (Light) | 深色模式 (Dark) | 适用物理场景 |
| :--- | :--- | :--- | :--- | :--- |
| **Canvas Base** | `bg-base` / `--bg-base` | `#F2F2F7` | `#161618` | 应用程序全局最底层主画布底板 |
| **Surface 1** | `bg-surface-1` / `--bg-surface-1` | `#FFFFFF` | `#1E1E22` | 一级常规卡片、主内容容器、侧边栏底色 |
| **Surface 2** | `bg-surface-2` / `--bg-surface-2` | `#EBEBF0` | `#26262A` | 二级内嵌容器、输入框衬底、分栏列表项 |
| **Surface 3** | `bg-surface-3` / `--bg-surface-3` | `rgba(0,0,0,0.04)` | `#303036` | 三级交互高亮区、下拉菜单浮层 |
| **Surface 4** | `bg-surface-4` / `--bg-surface-4` | `#D1D1D6` | `#3A3A3C` | 模态弹窗主板、关键动作控制台、轨道滑块 |

### 3.2 文字前景色阶体系 (Typography Alpha Decay)
基于知乎文章与 Apple HIG 规范，采用**固定冷灰基底 + 等比 Alpha 衰减**，赋予文字在各种色阶与毛玻璃背景上的通透呼吸感：

* **浅色基底**：`rgb(29, 29, 31)` (`#1D1D1F`)
* **深色基底**：`rgb(244, 244, 245)` (`#F4F4F5`)

| 语义层级 | Tailwind 类名 / CSS变量 | 浅色模式值 | 深色模式值 | 典型用途 |
| :--- | :--- | :--- | :--- | :--- |
| **Text 1 (Primary)** | `text-text-1` / `--text-primary` | `rgba(29, 29, 31, 1.0)` | `rgba(244, 244, 245, 1.0)` | 标题、核心数值、强强调正文 |
| **Text 2 (Secondary)** | `text-text-2` / `--text-secondary` | `rgba(29, 29, 31, 0.60)` | `rgba(244, 244, 245, 0.60)` | 副标题、列表摘要、次级正文 |
| **Text 3 (Tertiary)** | `text-text-3` / `--text-tertiary` | `rgba(29, 29, 31, 0.35)` | `rgba(244, 244, 245, 0.35)` | 辅助说明、时间戳、输入占位符 |
| **Text 4 (Muted)** | `text-text-muted` / `--text-muted` | `rgba(29, 29, 31, 0.20)` | `rgba(244, 244, 245, 0.20)` | 禁用状态提示、次要水印标识 |

### 3.3 边框与分割线体系 (Dynamic Alpha Anti-Swallowing)
统一中性灰基底 `rgb(120, 120, 128)`。在深色模式下，底色会强烈吸收低明度细线，因此**反向大幅提高深色下的 Alpha 透明度**：

| 语义角色 | Tailwind 类名 / CSS变量 | 浅色模式值 | 深色模式值 | 视觉特征与用途 |
| :--- | :--- | :--- | :--- | :--- |
| **Border Default** | `border-bd` / `--border-default` | `rgba(120, 120, 128, 0.16)` | `rgba(120, 120, 128, 0.32)` | 默认卡片轮廓、网格分隔、常规线条 |
| **Border Strong** | `border-bd-strong` / `--border-strong` | `rgba(120, 120, 128, 0.24)` | `rgba(120, 120, 128, 0.36)` | 悬停强化边框、弹窗外框、输入聚焦框 |

### 3.4 品牌主色与语义功能色 (Accent & Semantic Colors)
在深色模式下适度提升明度（Lightness ↑）、微调/微降饱和度（Saturation ↓），避免在深炭黑底色上产生刺眼色震荡：

| 语义色彩角色 | 浅色模式 (Light) | 深色模式 (Dark) | 调色考量与收益 |
| :--- | :--- | :--- | :--- |
| **Accent (品牌蓝)** | `#0071E3` (Apple Blue) | `#0A84FF` (Dark Blue) | 提亮红绿通道，防止在暗黑底色发沉发黑 |
| **Success (成功绿)** | `#34C759` | `#30D158` | 提亮绿色通道，增强在深色下的辨识度 |
| **Warning (警告橙)** | `#FF9500` | `#FF9F0A` | 注入微量冷光，防止视觉疲劳 |
| **Danger (危险红)** | `#FF3B30` | `#FF453A` | 适度提亮，降低警示色的刺目眩光 |
| **Cloud (交大云盘)** | `#0071E3` | `#5AC8FA` / `#0A84FF` | 保持与品牌蓝和多通道录播视角和谐一致 |

### 3.5 阴影净化法则
* 深色模式下物理移除所有黑色投影（`box-shadow: none` 或极细微环境微光）；
* 空间层次完全由 **Surface 表面亮度阶梯** 与 **1px 半透明中性描边** 共同呈现，杜绝新手常见的“亮色脏发光”瑕疵。

---

## 4. 详细设计：全局配置系统 (`src/shared/config/`)

### 4.1 业务偏好默认值 (`src/shared/config/defaults.ts`)
收口全应用业务偏好与配置默认项：

```typescript
export interface AppDefaultSettings {
  // 基础下载偏好
  concurrency: number               // 默认 3
  maxDownloadSpeedKBps: number      // 默认 0 (不限速)
  fileConflictStrategy: 'skip' | 'overwrite'  // 默认 'skip'
  
  // 窗口与后台策略
  windowCloseAction: 'tray' | 'taskbar' | 'quit'  // 默认 'tray'
  exitWhenDownloadingPolicy: 'prompt' | 'background' | 'pause_quit' // 默认 'prompt'
  
  // 媒体与录播默认偏好
  videoQualityOption: 'origin' | '720p' | 'audio_only' // 默认 'origin'
  videoPerspectivePreference: 'all' | 'teacher' | 'ppt' | 'audio' // 默认 'teacher'
  
  // 目录与模板
  defaultLocalDestRoot: string      // 默认 'SJTU课程'
  defaultCloudDestRoot: string      // 默认 '/SJTU课程备份'
  defaultNamingTemplate: string     // '{course}/{category}/{title}.{ext}'
  
  // 私有中转服务配置
  defaultPrivateWorkerConfig: {
    enabled: boolean                // 默认 false
    endpointUrl: string            // 默认 'http://127.0.0.1:6880'
    authToken: string              // 默认 ''
  }
}
```

### 4.2 UI 交互与布局系统常量 (`src/shared/config/layout.ts`)
收口所有 UI 布局度量衡与交互时序：

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
  commandIslandBottomPadding: 96, // 对应 pb-24，确保底部卡片不被遮挡
  cardGridMinWidth: 260,
} as const

export const ANIMATION_DURATION = {
  fast: 150,     // 悬停反馈、微动效
  normal: 200,   // 折叠展开、抽屉进出
  slow: 300,     // 模态弹窗出场
  toastAutoDismiss: 3000,
} as const
```

---

## 5. 工程协同与重构落地步骤

1. **创建子模块**：
   - 建立 `src/shared/theme/` 与 `src/shared/config/`，写入完整类型、常量与 CSS 生成配置。
2. **打通 Tailwind 配置 (`tailwind.config.cjs`)**：
   - 将原配置文件中手工编写的 60 余行 `colors` 映射直接改为导入 `@shared/theme/tailwind-theme.cjs`。
3. **样式表收口 (`src/renderer/src/index.css`)**：
   - 移除原文件中冗长的 `:root` 与 `[data-theme='dark']` 散落定义，统一引入 `theme.css`。
4. **主进程协同 (`src/main/window.ts`)**：
   - 原生窗口创建配置中直接引用 `THEME_TOKENS.dark.surface.base`（即 `#161618`），杜绝白屏闪烁。
5. **状态管理收口 (`src/renderer/src/store/app.ts`)**：
   - Zustand Store 初始状态改为引用 `APP_DEFAULTS`，彻底消除硬编码。
6. **自动化单元测试验证**：
   - 新增 `test/unit/theme-and-config.test.ts`，验证所有 Token、默认值与 CSS 变量的自洽性；
   - 运行全套门禁（typecheck, lint, test）。

---

## 6. 验证门禁与验收标准

依据工程规范，必须顺序通过全部自动化门禁：
1. `npm run typecheck`：TypeScript 0 错误；
2. `npm run lint`：ESLint 0 错误 0 警告；
3. `npm test`：51 个测试文件 100% 全部通过，新增单元测试验证主题与配置完整性。
