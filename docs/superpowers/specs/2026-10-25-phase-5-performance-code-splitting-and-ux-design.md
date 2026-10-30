# 阶段五设计规范：性能度量、按需加载与信息呈现打磨 (A25)

**设计日期**：2026-10-25  
**目标版本**：2.5.5-performance-and-ux  
**关联审查报告**：[2026-10-24-review.md](file:///D:/SJTU/编程/sjtu-downloader-all-in-one/docs/audits/2026-10-24-review.md)（问题编号：A25）

---

## 1. 架构目标与阶段范围

阶段五作为审计收官阶段，聚焦于**首屏载入性能优化、次级页面代码分块 (Code Splitting)、消除构建器循环引用警告，以及三种下载存储目标（本机 / 远端服务器 / 交大云盘）的清晰视觉区分与路径防错**：
1. **次级页面按需动态导入 (Code-Splitting)**：使用 `React.lazy` 与 `Suspense` 将占用巨量首屏体积的次级页面（`Settings`、`TransferCenter`、`CloudPanExplorer`、`ScheduleBrowser`、`ResourceLibrary`、`CnmoocBrowser`、`AuditedCourses`）分块解耦，显著降低初次首屏解析时间与内存压力。
2. **解除构建器模块循环导入 (Circular Import Elimination)**：消除 `src/main/ssh-tunnel.ts` 中 `await import('./private-worker')` 与 `private-worker.ts` 之间的循环依赖，解除 Vite/Rollup 打包时的 chunking 异常警告。
3. **三种保存位置稳定呈现与远端路径安全隔离**：在传输中心和任务列表中明确清晰地展示“本机保存”、“交大云盘”与“私有服务器”三态标识；当任务落盘于远端私有服务器时，仅展示远端服务器路径或提供快捷复制，**严禁将远端服务器路径传入本机 `shell.openPath` / `shell.showItemInFolder`**，杜绝系统弹窗报错。
4. **性能基线与全量门禁**：建立首包分块测试与构建校验，保证全套门禁 100% 绿色。

---

## 2. 拟修改词汇与规范化对照表

| 原表述 / 待定表述 | 拟规范化表述 | 修改考量与用户体验收益 |
| :--- | :--- | :--- |
| **混合显示**：<br>`云盘/服务器` 混为一谈 | 明确区分两类独立标识：<br>`交大云盘` 与 `私有服务器` | 消除用户对文件去向的认知混淆，直观识别是存入了交大云盘还是自建中转服务器 |
| **远端服务器任务按钮**：<br>`在文件夹中显示` (点击弹错或无反应) | 展示 `复制服务器路径`，不提供本机“在文件夹中显示”按钮 | 远端服务器磁盘并非本机文件系统，避免调用系统 Shell 产生无意义错误提示 |

---

## 3. 详细设计与实现方案

### 3.1 次级页面动态加载 (React.lazy)
- **App.tsx 改造**：
  首屏关键路由：`Welcome`、`Login`、`CanvasBrowser` 保持直接引用，秒开进入主流程。
  次级功能页面使用 `lazy` 按需载入：
  ```tsx
  const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })))
  const TransferCenter = lazy(() => import('./pages/TransferCenter').then(m => ({ default: m.TransferCenter })))
  const CloudPanExplorer = lazy(() => import('./pages/CloudPanExplorer').then(m => ({ default: m.CloudPanExplorer })))
  const ScheduleBrowser = lazy(() => import('./pages/ScheduleBrowser').then(m => ({ default: m.ScheduleBrowser })))
  const ResourceLibrary = lazy(() => import('./pages/ResourceLibrary').then(m => ({ default: m.ResourceLibrary })))
  const AuditedCourses = lazy(() => import('./pages/AuditedCourses').then(m => ({ default: m.AuditedCourses })))
  const CnmoocBrowser = lazy(() => import('./pages/CnmoocBrowser').then(m => ({ default: m.CnmoocBrowser })))
  ```
  在 `App.tsx` 页面渲染区域使用轻量优雅的 `<Suspense fallback={<PageSkeleton />}>` 占位，确保切页平滑无白屏。

### 3.2 循环依赖与构建器告警解除
- **解耦设计**：
  在 `src/main/ssh-tunnel.ts` 中，停止嵌入式测试节点通过动态注入生命周期钩子（或通过主进程应用层统一调度）解耦，剥离对 `private-worker.ts` 的静态/动态反向依赖，使依赖图谱呈单向无环流动：`private-worker` -> `ssh-tunnel`。

### 3.3 三种保存位置与路径安全打开防错
- **TransferCenter.tsx 渲染设计**：
  1. `item.storageMode === 'server_local'`：
     - 徽标显示：`私有服务器` (紫色主题徽标)；
     - 路径说明：`服务器路径: /...`；
     - 操作区提供 `复制路径` 按钮，不调用本地 `showInFolder`。
  2. `item.storageMode === 'cloudpan'` 或 `item.cloudPath`：
     - 徽标显示：`交大云盘` (天蓝色主题徽标)；
     - 路径说明：`云盘目录: /...`。
  3. 默认本机下载：
     - 徽标显示：`本机保存` (绿色主题徽标)；
     - 操作区正常提供 `在文件夹中显示` (调用 `window.api.showInFolder`)。

---

## 4. 门禁验证标准

1. **构建输出验证**：
   - 运行构建，确认次级页面产出独立 chunk；无 Rollup/Vite 循环引用警告。
2. **功能与 A11y 验证**：
   - 保证切页至设置页与传输中心能够无缝加载并保持状态。
   - 远端服务器任务不触发本地 Shell 报错。
3. **全链路工程门禁**：
   - `npm run typecheck`（0 errors）。
   - `npm run lint`（0 errors, 0 warnings）。
   - `npm test`（100% pass）。
   - `node docs/audits/2026-10-24-reproduce.mjs`（12 项指标全绿）。
