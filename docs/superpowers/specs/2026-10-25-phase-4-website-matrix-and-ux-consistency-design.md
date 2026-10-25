# 阶段四设计规范：发布矩阵、依赖合规与交互一致性 (A19 ~ A24)

**设计日期**：2026-10-25  
**目标版本**：2.5.4-ux-and-release-hardening  
**关联审查报告**：[2026-10-24-review.md](file:///D:/SJTU/编程/sjtu-downloader-all-in-one/docs/audits/2026-10-24-review.md)（问题编号：A19、A20、A21、A22、A23、A24）

---

## 1. 架构目标与阶段范围

阶段四聚焦于**外部发布物可信度、官网依赖安全边界、界面交互可访问性 (a11y) 与持续集成防御覆盖**：
1. **A19（官网发布矩阵与 SHA256 一致性）**：修复 `website/src/utils/releaseInfo.ts` 中 `mac-x64` 静态与动态逻辑误配 `mac-arm64.zip` 的缺陷；实现 Release 资源动态解析真实 SHA256，消除新 Release 回退旧静态哈希的倒挂问题；统一 Linux 架构名称与打包产物（`x64` / `arm64`）匹配。
2. **A20（官网 Astro 依赖安全收敛）**：全面评估官网 Astro 静态部署依赖链，锁定静态模式构建安全性，修复或升级关键构建依赖。
3. **A21（退出设置文案与取消行为统一）**：在 `src/renderer/src/pages/Settings.tsx` 中将“自动暂停并退出”规范化为“退出时自动取消任务”，真实反映本地下载中止生命周期，消除用户误判。
4. **A22（选择器键盘导航与弹窗焦点陷阱）**：在下拉组件（`widgets.tsx`）中实现完整键盘无障碍导航（`ArrowUp` / `ArrowDown` 遍历、`Enter` 确认、`Escape` 退出），在确认弹窗（`WindowConfirmModal.tsx`）中实现焦点捕获（Focus Trap），符合 WCAG 键盘操作标准。
5. **A23（文本对比度与主题 Token WCAG 4.5:1）**：在 `src/shared/theme/tokens.ts` 中调优浅色与深色模式下的 `text.tertiary` 与辅助文本色值，确保正文与说明性文字对比度满足 WCAG AA 级要求（$\ge 4.5:1$），区分“未选中”与“不可用”视觉态。
6. **A24（CI 范围与独立 Worker 测试覆盖）**：在 `.github/workflows/ci.yml` 中补全 `test/**`、`scripts/private-worker-daemon.mjs` 监控路径，确保修改测试或守护进程时 100% 触发完整 CI 门禁。

---

## 2. 拟修改词汇与规范化对照表

| 原表述 / 待定表述 | 拟规范化表述 | 修改考量与用户体验收益 |
| :--- | :--- | :--- |
| **设置页退出行为**：<br>`有任务时退出应用: 自动暂停并退出` (实际底层是 cancel) | `退出时自动取消任务` | 真实反映软件行为（本地下载目前不支持跨进程持久化断点重连，此前写作“暂停”会导致用户误以为下次开机可直接继续），避免因文案误导导致未完成文件损坏认知偏差 |
| **官网 Mac Intel 下载包标注**：<br>`x64 (Intel 架构)` 却链接到了 `arm64.zip` | 链接修正为 `sjtu-course-downloader-*-mac-x64.zip`，并标注 `macOS (Intel 芯片)` 与 `macOS (Apple Silicon 芯片)` | 消除架构倒挂 Bug，防止 Intel Mac 师生下载后报错无法运行 |
| **选择器与弹窗焦点提示**：<br>无键盘操作状态或焦点逸出弹窗 | 选中项高亮、支持 `↑ / ↓` 切换与 `Enter` 选择，焦点锁定在弹窗内 | 满足高校无障碍 (WCAG) 访问规范，提升键盘操作效率 |

---

## 3. 详细设计与实现方案

### 3.1 A19 · 官网发布矩阵与 SHA256 动态解析
- **根因**：
  - `STATIC_FALLBACK_ASSETS['mac-x64']` 的 `filename` 错误配置为 `sjtu-course-downloader-2.5.0-mac-arm64.zip`；
  - 动态函数 `findAsset(release, ...)` 在查找 `mac-x64` 时，正则是 `/(mac|darwin).*(x64|intel|x86_64).*\.zip$/i`，但未能防止通配符贪婪匹配，且 fallback 映射中对未知哈希无条件读取 `STATIC_FALLBACK_ASSETS` 的旧哈希。
- **重构设计**：
  1. 修复静态常量：
     `'mac-x64': { filename: 'sjtu-course-downloader-2.5.0-mac-x64.zip', ... }`
  2. 针对动态 Release，若 Release 中包含 `latest.yml` 或 `latest-mac.yml`，或 assets 中带有 `.sha256` 清单，动态解析真实哈希；若无对应架构资产，明确展示为不可用或待发布，严禁以 arm64 充当 x64，严禁以旧版本哈希伪造新版本资产哈希。

### 3.2 A20 · 官网依赖安全合规与静态部署加固
- **根因**：官网 `website/package.json` 中的 Astro 与构建依赖存在历史警报。
- **重构设计**：
  - 官网完全以 GitHub Pages 静态站点 (`output: 'static'`) 交付，不运行 SSR node 服务端；
  - 检查并升级 `website/package.json` 中的依赖，锁定构建时安全沙箱。

### 3.3 A21 · 设置页退出文案与底层取消行为对齐
- **根因**：`Settings.tsx:327` 文案为“自动暂停并退出”，而主进程对应 `window:cancel-and-quit`，实际上直接调用了 `abort()` 并删除了未完成的 `.part` 文件。
- **重构设计**：
  - 将设置界面的选项文案调整为“退出时自动取消任务”，提示语调整为“退出应用时将自动中止并取消所有正在下载的任务”；
  - 与后端 `window:cancel-and-quit` 行为严格一致。

### 3.4 A22 · 选择器键盘导航与弹窗焦点陷阱
- **根因**：下拉选择框与模态弹窗未捕获 `Tab` / `Shift+Tab` 焦点，下拉框未监听方向键。
- **重构设计**：
  1. 下拉组件增加 `onKeyDown` 处理器：
     - `ArrowDown` / `ArrowUp`：上下切换高亮 item；
     - `Enter` / `Space`：选择当前高亮 item 并关闭下拉；
     - `Escape`：关闭下拉并恢复触发按钮焦点；
     - 增加 `role="listbox"` 与 `aria-activedescendant` 支持。
  2. 弹窗组件增加 Focus Trap：
     - 弹窗打开时将焦点自动设置到首个可聚焦元素；
     - 监听 `Tab` 键，当在最后一个元素上按 `Tab` 时循环至第一个，在第一个元素上按 `Shift+Tab` 时循环至最后一个；
     - `Escape` 键触发关闭。

### 3.5 A23 · 文本对比度与主题 Token 优化
- **根因**：`text.tertiary` 在亮色模式下使用 `rgba(29, 29, 31, 0.52)`，对比度仅约 3.47:1，低于 WCAG AA 要求的 4.5:1。
- **重构设计**：
  - 调整亮色模式 `text.tertiary`：提升至 `rgba(29, 29, 31, 0.68)`（对比度提升至 $\ge 4.7:1$）；
  - 调整深色模式 `text.tertiary`：提升至 `rgba(235, 235, 245, 0.65)`（对比度提升至 $\ge 5.1:1$）；
  - 保留 `text.muted` 仅用于禁用状态或微小装饰性边框，正文说明一律使用满足 4.5:1 的 token。

### 3.6 A24 · CI 测试范围与守护进程全面覆盖
- **根因**：`.github/workflows/ci.yml` 路径过滤漏掉了 `test/**` 与 `scripts/private-worker-daemon.mjs`。
- **重构设计**：
  - 在 `.github/workflows/ci.yml` 的 `paths` 中加入：
    - `test/**`
    - `scripts/**`
    - `website/**`
  - 确保 Worker 守护进程测试被 CI 100% 纳入。

---

## 4. 门禁验证标准

1. **审计复现脚本**:
   - `W1-architecture-and-stale-hash`:
     - `intel.filename === 'sjtu-course-downloader-2.5.0-mac-x64.zip'`；
     - `newReleaseUsesOldStaticHash === false`。
2. **自动化测试**:
   - 补充发布矩阵、A11y 键盘导航、焦点陷阱与对比度测试用例。
   - `npm test` 100% 通过（测试用例数突破 1150+）。
3. **全链路门禁**:
   - `npm run typecheck`（0 errors）。
   - `npm run lint`（0 errors, 0 warnings）。
