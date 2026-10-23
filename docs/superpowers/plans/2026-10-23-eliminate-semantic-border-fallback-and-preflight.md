# 消除语义边框回退与覆盖 Tailwind Preflight 白边方案实施计划

> **Goal**: 彻底根除应用中所有语义色边框（校园网提示框、按学期分组、免本地流量、安全防护横幅、作业归档卡片等）回退为 Tailwind Preflight `#e5e7eb` 亮白边框的问题；在全局 base 层将默认边框由 `#e5e7eb` 覆盖为系统的柔和暗灰 `var(--border-default)`，并打通全套语义色透明度通道，清理浮岛与复选框高亮白边。

---

## 架构与技术方案

### 1. 全局 Preflight 默认边框重置 (`src/renderer/src/index.css`)
Tailwind Preflight 在 `@tailwind base` 中硬编码了：
```css
*, ::before, ::after {
  border-color: #e5e7eb;
}
```
这导致任何在深色模式下写了 `border` 但颜色类未能生效的元素，全都会继承 `#e5e7eb`（刺眼亮白）。
重置方案：在 `index.css` 的 `@layer base` 中统一覆盖为：
```css
*, ::before, ::after {
  border-color: var(--border-default);
}
```
此举彻底切断所有元素回退为亮白色的可能性，实现全工程边框的全局安全兜底。

### 2. 全量语义色 RGB 通道与透明度解析打通
- 在 `src/shared/theme/theme.css` 中为所有语义色补充 RGB 通道定义（明暗模式各一套）：
  - `--color-accent-rgb`: `0, 113, 227` (light) / `10, 132, 255` (dark)
  - `--color-cloud-rgb`: `0, 113, 227` (light) / `10, 132, 255` (dark)
  - `--color-success-rgb`: `52, 199, 89` (light) / `48, 209, 88` (dark)
  - `--color-warning-rgb`: `255, 149, 0` (light) / `255, 159, 10` (dark)
  - `--color-danger-rgb`: `255, 59, 48` (light) / `255, 69, 58` (dark)
  - `--color-amber-rgb`: `255, 149, 0` (light) / `255, 159, 10` (dark)
  - `--color-emerald-rgb`: `52, 199, 89` (light) / `48, 209, 88` (dark)
  - `--color-sky-rgb`: `0, 113, 227` (light) / `10, 132, 255` (dark)
  - `--color-rose-rgb`: `255, 59, 48` (light) / `255, 69, 58` (dark)
- 在 `src/shared/theme/tailwind-theme.cjs` 中将这些颜色全部通过 `createColorWithFallback` 封装，使 `border-amber/20`、`border-accent/40`、`border-accent/60`、`border-success/30`、`border-danger/30` 能 100% 精准编译为 `rgba(var(--color-*-rgb), <alpha>)`。

### 3. 浮动岛与复选框高亮白边清理
- `FloatingCommandIsland.tsx`:
  - 容器边框统一为 `border border-bd`；
  - 移除 `0_1px_1px_rgba(255,255,255,0.9)_inset` 亮白内阴影，替换为纯净的微环境柔光；
- `widgets.tsx` (`MacOSCircleCheckbox`):
  - 选中态外围将 `ring-2 ring-white/60` 优化为 `ring-1 ring-accent/30`，彻底消除白环。

---

## 实施任务拆解

- [ ] **Task 1: 重置全局 Base 边框并打通全套语义色 RGB 通道 (`theme.css`, `index.css`, `tailwind-theme.cjs`)**
  - 在 `index.css` `@layer base` 覆盖 `*, ::before, ::after { border-color: var(--border-default); }`。
  - 在 `theme.css` 定义明暗双轨 RGB 通道变量。
  - 在 `tailwind-theme.cjs` 将 `accent`、`success`、`warning`、`danger`、`amber`、`cloud`、`emerald`、`sky`、`rose` 打通透明度映射。
  - 在 `test/unit/theme-tokens.test.ts` 补充单测。
  - 验证：`npm run typecheck`, `npm run lint`, `npx vitest run test/unit/theme-tokens.test.ts`。

- [ ] **Task 2: 清理浮动岛与复选框的特定高亮白边 (`FloatingCommandIsland.tsx` & `widgets.tsx`)**
  - 修改 `src/renderer/src/components/FloatingCommandIsland.tsx`：清除 `dark:border-[#38383c]` 与白色内阴影。
  - 修改 `src/renderer/src/components/widgets.tsx`：优化 `MacOSCircleCheckbox` 白光外环。
  - 验证页面单测。

- [ ] **Task 3: 全链路门禁终验与整分支审查 (Final Whole-Branch Review)**
  - 执行 `npm run typecheck`。
  - 执行 `npm run lint`。
  - 执行 `npm test`（53 套件 100% 绿灯）。
  - 派发 Final Whole-Branch Reviewer 验证整分支 net diff。
