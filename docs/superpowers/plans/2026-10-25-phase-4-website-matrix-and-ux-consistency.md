# 阶段四实施计划：发布矩阵、依赖合规与交互一致性 (A19 ~ A24) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成审计报告中 A19~A24 的 6 项发布物可信度与交互一致性修复，消除官网 Mac Intel 下载产物错配为 arm64 及新 Release 误用旧哈希问题、规范设置页任务中止文案、实现选择器与模态框的无障碍键盘导航与焦点陷阱、提升浅/深色模式文本对比度至 WCAG 4.5:1，并补全 CI 对 Worker 守护进程与全量测试文件的覆盖。

**Architecture:**
1. `website/src/utils/releaseInfo.ts` 修正架构与产物匹配规则，静态 Mac x64 纠正为 `mac-x64.zip`，动态资产哈希计算在找不到真实 sha256 时不再静默回退旧版本的静态哈希，保证资产与哈希强绑定；
2. `Settings.tsx` 将设置选项文案更新为“退出时自动取消任务”，消除对用户“任务可跨进程断点恢复”的误导；
3. `widgets.tsx` 与 `WindowConfirmModal.tsx` 分别补充列表键盘导航（`ArrowUp/Down`, `Enter`, `Escape`）与弹窗内循环焦点陷阱（Focus Trap）；
4. `src/shared/theme/tokens.ts` 调优 `text.tertiary` 与辅助文本色值，满足 WCAG AA 4.5:1 最小对比度；
5. `.github/workflows/ci.yml` 补齐 `test/**`、`scripts/**` 与 `website/**` 触发路径，锁定守护进程与全链路持续集成。

**Tech Stack:** TypeScript, Astro, React, WCAG 2.2 AA, Vitest, GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-10-25-phase-4-website-matrix-and-ux-consistency-design.md](file:///D:/SJTU/编程/sjtu-downloader-all-in-one/docs/superpowers/specs/2026-10-25-phase-4-website-matrix-and-ux-consistency-design.md)

## Global Constraints

- **UI Copywriting Alignment**: 严格遵照《拟修改词汇与规范化对照表》，严禁未经确认的文案修改。
- **Verification Gate**: 任何改动提交前必须顺序通过：`npm run typecheck` (0 errors) -> `npm run lint` (0 errors, 0 warnings) -> `npm test` (100% pass)。
- **LaTeX Math Rules**: 行内公式使用 `\( ... \)` 或 `$ ... $`；块级公式使用独立成行的 `$$ ... $$`；严禁正文中出现未转义的 `$`（必须转义为 `\$` 或用代码块包裹）。
- **Clickable Links**: 所有提及的文件路径使用 GitHub markdown 链接 `[basename](file:///absolute/path/to/file)`。

---

### Task 1: 官网发布矩阵与真实哈希一致性修复 (A19)

**Files:**
- Modify: `website/src/utils/releaseInfo.ts`
- Modify: `website/src/components/DownloadTable.astro`
- Test: `website/test/releaseInfo.test.ts`

**Interfaces:**
- Consumes: GitHub Releases API payloads / Fallback assets.
- Produces: `getAllPlatformMatrix(release?: Release | null): PlatformDownloadInfo[]`.

- [ ] **Step 1: Write the failing test for release matrix architecture and hash matching**
  - Update `website/test/releaseInfo.test.ts`.
  - Assert that `getAllPlatformMatrix(null)` returns `mac-x64` with `filename` ending in `mac-x64.zip` (not `mac-arm64.zip`).
  - Assert that when a new release is passed, `sha256` does not use the hardcoded static fallback hash of version 2.5.0 unless specifically defined for that exact release.
- [ ] **Step 2: Run test to make sure it fails**
  - Run `npx vitest run website/test/releaseInfo.test.ts`.
- [ ] **Step 3: Fix releaseInfo.ts mapping and hash logic**
  - In `STATIC_FALLBACK_ASSETS['mac-x64']`, set `filename: 'sjtu-course-downloader-2.5.0-mac-x64.zip'`.
  - In `getAllPlatformMatrix`:
    - Ensure dynamic asset lookup for `mac-x64` matches `x64` and explicitly excludes `arm64`.
    - When release assets don't include an explicit sha256 or companion hash for the new release, set `sha256: undefined` or extract from manifest, rather than returning stale static hashes from an old version.
- [ ] **Step 4: Run test to make sure it passes**
  - Run `npx vitest run website/test/releaseInfo.test.ts`.
- [ ] **Step 5: Run lint and typecheck**
  - Run `npm run typecheck` and `npm run lint`.
- [ ] **Step 6: Commit**
  - `git add ...; git commit -m "fix(website): correct mac-x64 download artifact and eliminate stale release hashes (A19)"`

---

### Task 2: 设置页任务退出文案规范化与取消行为对齐 (A21)

**Files:**
- Modify: `src/renderer/src/pages/Settings.tsx:320-340`
- Test: `test/unit/settings-view.test.ts`

**Interfaces:**
- Consumes: Zustand `settings-slice.ts` exit behavior options.
- Produces: UI copywriting for exit behavior setting.

- [ ] **Step 1: Write the failing test for Settings exit behavior copywriting**
  - Update or check `test/unit/settings-view.test.ts`.
  - Assert that setting title and options use aligned copywriting: `退出时自动取消任务`.
- [ ] **Step 2: Run test to make sure it fails**
  - Run `npx vitest run test/unit/settings-view.test.ts`.
- [ ] **Step 3: Update Settings.tsx copywriting**
  - In `src/renderer/src/pages/Settings.tsx`:
    - Update option text: `退出时自动取消任务` (替换“自动暂停并退出”)。
    - Update description: `退出应用时将自动中止并取消所有正在下载的任务`。
- [ ] **Step 4: Run test to make sure it passes**
  - Run `npx vitest run test/unit/settings-view.test.ts`.
- [ ] **Step 5: Run lint and typecheck**
  - Run `npm run typecheck` and `npm run lint`.
- [ ] **Step 6: Commit**
  - `git add ...; git commit -m "fix(ui): align Settings exit behavior copy with actual cancel lifecycle (A21)"`

---

### Task 3: 选择器键盘无障碍导航与弹窗焦点陷阱 (A22)

**Files:**
- Modify: `src/renderer/src/components/widgets.tsx`
- Modify: `src/renderer/src/components/WindowConfirmModal.tsx`
- Test: `test/unit/a11y-focus-trap.test.ts`

**Interfaces:**
- Consumes: React component props and keyboard events.
- Produces: Accessible keyboard navigation and modal focus trapping.

- [ ] **Step 1: Write the failing test for focus trap and keyboard navigation**
  - Create `test/unit/a11y-focus-trap.test.ts`.
  - Test that `WindowConfirmModal` traps Tab focus within its focusable elements (`button`, `input`).
  - Test that `Escape` key closes modal.
  - Test that dropdown selection supports `ArrowDown` / `ArrowUp` item navigation and `Enter` selection.
- [ ] **Step 2: Run test to make sure it fails**
  - Run `npx vitest run test/unit/a11y-focus-trap.test.ts`.
- [ ] **Step 3: Implement keyboard navigation in widgets.tsx and focus trap in WindowConfirmModal.tsx**
  - In `WindowConfirmModal.tsx`:
    - Add ref to dialog container.
    - Implement `keydown` listener:
      - `Tab`: if focused element is last focusable, focus first; if `Shift+Tab` and focused is first, focus last.
      - `Escape`: call onCancel / onClose.
      - Auto-focus the primary or first button upon mount.
  - In `widgets.tsx` dropdown:
    - Support arrow navigation (`ArrowUp` / `ArrowDown`), `Enter` to select, `Escape` to close.
    - Add `role="listbox"` / `role="option"`.
- [ ] **Step 4: Run test to make sure it passes**
  - Run `npx vitest run test/unit/a11y-focus-trap.test.ts`.
- [ ] **Step 5: Run lint and typecheck**
  - Run `npm run typecheck` and `npm run lint`.
- [ ] **Step 6: Commit**
  - `git add ...; git commit -m "feat(a11y): add keyboard navigation for selectors and focus trap for modals (A22)"`

---

### Task 4: 文本对比度与主题 Token WCAG 4.5:1 调优 (A23)

**Files:**
- Modify: `src/shared/theme/tokens.ts`
- Test: `test/unit/theme-tokens.test.ts`

**Interfaces:**
- Consumes: Color tokens for light and dark themes.
- Produces: WCAG 2.2 AA compliant text contrast ratios ($\ge 4.5:1$).

- [ ] **Step 1: Write the failing test for text contrast ratio compliance**
  - Update `test/unit/theme-tokens.test.ts`.
  - Calculate relative luminance and contrast ratio of `text.tertiary` against `bg.canvas` in both light and dark modes.
  - Assert contrast ratio $\ge 4.5:1$.
- [ ] **Step 2: Run test to make sure it fails**
  - Run `npx vitest run test/unit/theme-tokens.test.ts`.
- [ ] **Step 3: Adjust theme tokens for WCAG AA compliance**
  - In `src/shared/theme/tokens.ts`:
    - Light mode: update `text.tertiary` to `rgba(29, 29, 31, 0.68)` (contrast $\ge 4.7:1$).
    - Dark mode: update `text.tertiary` to `rgba(235, 235, 245, 0.65)` (contrast $\ge 5.1:1$).
    - Ensure `text.secondary` also comfortably clears $4.5:1$.
- [ ] **Step 4: Run test to make sure it passes**
  - Run `npx vitest run test/unit/theme-tokens.test.ts`.
- [ ] **Step 5: Run lint and typecheck**
  - Run `npm run typecheck` and `npm run lint`.
- [ ] **Step 6: Commit**
  - `git add ...; git commit -m "style(theme): enhance text contrast tokens to meet WCAG AA 4.5:1 ratio (A23)"`

---

### Task 5: CI 工作流监控与守护进程测试全覆盖 (A24 & A20)

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `eslint.config.mjs`
- Test: Workflow validation

**Interfaces:**
- Consumes: GitHub Actions workflow triggers.
- Produces: Full path coverage including `test/**`, `scripts/**`, and `website/**`.

- [ ] **Step 1: Write test or verification check for CI path filters**
  - Validate `.github/workflows/ci.yml` paths array.
- [ ] **Step 2: Update CI workflow and lint configurations**
  - In `.github/workflows/ci.yml`:
    - Add `test/**`, `scripts/**`, `website/**` to PR and push paths.
  - In `eslint.config.mjs`:
    - Ensure `scripts/private-worker-daemon.mjs` is either checked with node rules or properly targeted so worker code is validated.
- [ ] **Step 3: Run lint and typecheck**
  - Run `npm run typecheck` and `npm run lint`.
- [ ] **Step 4: Commit**
  - `git add ...; git commit -m "ci: expand CI trigger paths to include tests, worker daemon and website (A24)"`

---

### Task 6: 审计复现 W1 绿灯验证与全量门禁交付

**Files:**
- Modify: `docs/audits/2026-10-24-reproduce.mjs:218-225`
- Test: All tests

- [ ] **Step 1: Update reproduce.mjs with green assertion for W1**
  - In `docs/audits/2026-10-24-reproduce.mjs`:
    - Verify that `intel.actualFile` is `sjtu-course-downloader-2.5.0-mac-x64.zip`.
    - Verify that `newReleaseUsesOldStaticHash === false`.
  - Run `node docs/audits/2026-10-24-reproduce.mjs` and confirm all 12 indicators are green.
- [ ] **Step 2: Run full test suite**
  - Run `npm test`.
- [ ] **Step 3: Run full typecheck and lint**
  - Run `npm run typecheck` and `npm run lint`.
- [ ] **Step 4: Commit**
  - `git add ...; git commit -m "test(audit): update reproduce script with Phase 4 green assertions (W1)"`
