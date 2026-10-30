# 深色模式边框柔化与类名规范化收口实施计划

> **Goal**: 彻底解决深色模式下边框、选项框与分割线刺眼发白问题（消除由于 Tailwind 对 CSS 变量未配置透明度解析导致的回退为纯白 `currentColor` 的根本缺陷），落地 macOS/Linear 风格微弱柔和暗灰边框（8%~12%），并将全工程散落的百分比边框类归一化为标准的 `border-bd` 与 `border-bd-strong`。

---

## 架构与视觉规范设计

### 1. 色彩与透明度标尺
- **深色模式 (Dark Mode)**:
  - `--color-bd-rgb`: `255, 255, 255`
  - `--border-default`: `rgba(255, 255, 255, 0.08)` (在 `#161618` 底色上呈现极其柔和的石墨暗灰 `#252528`，消除任何亮白反光)
  - `--border-strong`: `rgba(255, 255, 255, 0.14)` (在 `#161618` 底色上呈现适度清晰的暗灰 `#323235`)
- **浅色模式 (Light Mode)**:
  - `--color-bd-rgb`: `0, 0, 0`
  - `--border-default`: `rgba(0, 0, 0, 0.08)`
  - `--border-strong`: `rgba(0, 0, 0, 0.14)`

### 2. Tailwind 编译防御层 (Single Source of Truth)
- 在 `src/shared/theme/tailwind-theme.cjs` 中为 `bd` 与 `bd-strong` 增加安全生成函数：
  ```javascript
  const createColorWithFallback = (defaultVar, rgbVar) => ({ opacityVariable, opacityValue }) => {
    if (opacityVariable !== undefined) return `var(${defaultVar})`;
    if (opacityValue !== undefined) return `rgba(var(${rgbVar}), ${opacityValue})`;
    return `var(${defaultVar})`;
  };
  ```
  彻底杜绝任何未来的 `/alpha` 修饰符降级回退到 CSS 默认的 `currentColor`（白色文字前景色）。

### 3. 组件视觉落地
- **顶栏分段选择器 (`Segmented.tsx`)**:
  - 外层容器: `border border-bd bg-surface-2/80` (微弱暗灰线框)
  - 滑块指示器: 移除 `border border-bd/40`，采用原生玻璃滑块（`bg-surface-1 shadow-2xs`），纯靠表面色差与微阴影浮起。
- **设置页面 (`Settings.tsx`)**:
  - 左右侧边栏分割竖线: 由 `border-r border-bd/60` 净化为 `border-r border-bd`；
  - 选项行分割线: 由 `divide-bd/50 border-t border-bd/50` 净化为 `divide-bd border-t border-bd`；
  - 云盘与账户卡片: 统一为 `border border-bd`。
- **全工程类名归一化**:
  - 彻底肃清全工程 `src/renderer/` 中的 `border-bd/40`、`border-bd/60`、`border-bd/70`、`border-bd/80`、`divide-bd/50` 等随意手写的百分比类名。

---

## 实施任务拆解

- [ ] **Task 1: 重构主题边框 Token 与底层 Tailwind 容灾解析 (`src/shared/theme/`)**
  - 修改 `src/shared/theme/tokens.ts`：更新明暗模式边框透明度标尺。
  - 修改 `src/shared/theme/theme.css`：更新 `--border-default`、`--border-strong` 与新增 `--color-bd-rgb`。
  - 修改 `src/shared/theme/tailwind-theme.cjs`：加入 `createColorWithFallback` 容灾函数。
  - 更新 `test/unit/theme-tokens.test.ts`。
  - 门禁：`npm run typecheck`, `npm run lint`, `npx vitest run test/unit/theme-tokens.test.ts`。

- [ ] **Task 2: 净化顶栏组件、分段选项框与快捷胶囊 (`TitleBar.tsx` & `Segmented.tsx`)**
  - 修改 `src/renderer/src/components/Segmented.tsx`：移除滑块刺眼白描边，外层容器采用统一 `border-bd`。
  - 修改 `src/renderer/src/components/TitleBar.tsx`：净化交大云盘快速胶囊与返回按钮的边框类名。
  - 验证组件单测。

- [ ] **Task 3: 净化设置中心页面与左右分割竖线 (`Settings.tsx`)**
  - 修改 `src/renderer/src/pages/Settings.tsx`：左右侧边栏分割竖线统一为 `border-r border-bd`；卡片与分割线统一为 `border-bd`。
  - 验证页面单测。

- [ ] **Task 4: 净化网盘资源浏览器与日程组件中散落的边框类 (`NetdiskCourseExplorer.tsx` & `schedule/`)**
  - 修改 `src/renderer/src/components/NetdiskCourseExplorer.tsx`：清除所有 `border-bd/*` 与 `divide-bd/*`。
  - 修改 `src/renderer/src/pages/schedule/`：清除日程视图与抽屉中散落的百分比边框类。

- [ ] **Task 5: 全链路门禁终验与整分支审查 (Final Whole-Branch Review)**
  - 执行 `npm run typecheck`。
  - 执行 `npm run lint`。
  - 执行 `npm test`（53 套件 100% 绿灯）。
  - 派发 Final Whole-Branch Reviewer 验证整分支 net diff。
