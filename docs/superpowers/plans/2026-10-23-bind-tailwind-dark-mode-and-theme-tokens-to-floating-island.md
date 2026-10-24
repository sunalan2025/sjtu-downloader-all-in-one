# 绑定 Tailwind 暗色选择器与收口底部悬浮岛语义主题实施计划

> **Goal**: 彻底解决深色模式下底部悬浮动作岛（FloatingCommandIsland）依然呈现亮白色浅色外观的缺陷。配置 Tailwind `darkMode` 基于应用属性选择器 `[data-theme="dark"]` 响应，并将底部悬浮岛从手写 `from-white/95`、`bg-slate-100` 等硬编码类彻底收口至系统级 `bg-surface-1`、`bg-surface-2` 语义色彩。

---

## 架构与技术方案

### 1. Tailwind 暗色策略绑定 (`tailwind.config.cjs`)
Tailwind 默认使用 `@media (prefers-color-scheme: dark)`（OS 媒体查询），导致应用内手动切换深色模式或用户 OS 为浅色时，Tailwind 的所有 `dark:` 类选择器完全失效。
**解决方案**：在 `tailwind.config.cjs` 根级配置：
```javascript
darkMode: ['class', '[data-theme="dark"]'],
```
此举让所有 `dark:` 规则完全精准绑定到 `<html data-theme="dark">` 上，彻底解绑操作系统的默认锁死，与全应用的 CSS 变量主题切换做到 100% 实时同步。

### 2. 主题切换类名双轨同步 (`src/renderer/src/components/TitleBar.tsx`)
在 `applyTheme` 中同时操作 `classList.add('dark')` / `classList.remove('dark')` 与 `setAttribute('data-theme', resolved)`，确保同时兼容属性选择器和类选择器。

### 3. 底部悬浮动作岛收口至系统 Surface 语义色彩 (`FloatingCommandIsland.tsx`)
- **容器背景**：由写死的 `from-white/95 to-slate-50/90 dark:from-[#242428]/95 ...` 重构为：
  `bg-surface-1/95 backdrop-blur-xl border border-bd`；
  在浅色模式下呈现透亮白玻璃，在深色模式下自适应呈现柔和深炭黑毛玻璃（`#1E1E22`），完全消除突兀白条。
- **信息胶囊与分类芯片**：彻底移除 `bg-slate-100/80`、`hover:bg-slate-200/50` 等硬编码灰色，统一收口至 `bg-surface-2` 与 `hover:bg-surface-3`。

---

## 实施任务拆解

- [ ] **Task 1: 配置 Tailwind `darkMode` 属性选择器与双轨主题同步 (`tailwind.config.cjs`, `TitleBar.tsx`)**
  - 在 `tailwind.config.cjs` 添加 `darkMode: ['class', '[data-theme="dark"]']`。
  - 在 `TitleBar.tsx` 的 `applyTheme` 同步 `.dark` 类名。
  - 验证：`npm run typecheck`, `npm run lint`。

- [ ] **Task 2: 全面重构 FloatingCommandIsland 至系统 Surface 色彩标尺 (`FloatingCommandIsland.tsx`)**
  - 重构根容器背景为 `bg-surface-1/95 backdrop-blur-xl`。
  - 净化内部所有胶囊与芯片为 `bg-surface-2` 与 `hover:bg-surface-3`。
  - 验证：`npx vitest run test/unit/floating-command-island.test.ts`。

- [ ] **Task 3: 全链路门禁终验与整分支审查 (Final Whole-Branch Review)**
  - 执行 `npm run typecheck`。
  - 执行 `npm run lint`。
  - 执行 `npm test`（53 套件 100% 绿灯）。
  - 派发 Final Whole-Branch Reviewer 验证整分支 net diff。
