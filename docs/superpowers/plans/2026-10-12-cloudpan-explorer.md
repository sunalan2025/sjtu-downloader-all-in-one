# 交大云盘资源管理器 (CloudPan Explorer) 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在客户端内实现全功能「☁️ 交大云盘资源管理器」，支持目录树浏览、新建文件夹、重命名、删除、直接下载到本地与手动上传任意文件，并打通顶栏快捷入口与统一传输引擎。

**Architecture:** 主进程基于腾讯云 SMH 协议扩展 `src/main/cloudpan.ts` 补齐目录列取、CRUD 及直链提取 API，并在 `src/main/index.ts` 注册 IPC 通道；渲染端在 `src/renderer/src/pages/CloudPanExplorer.tsx` 构建现代网盘卡片流（面包屑下钻导航、网格/列表视图、批量操作条及弹窗交互），由顶栏云盘胶囊点击一键切入并与传输中心无缝协同。

**Tech Stack:** Electron 39, React 19, TypeScript 5.7, Tailwind CSS, Lucide Icons, Zustand, Vitest.

**Spec:** [docs/superpowers/specs/2026-10-12-cloudpan-explorer-design.md](file:///d:/SJTU/编程/sjtu-downloader-all-in-one/docs/superpowers/specs/2026-10-12-cloudpan-explorer-design.md)

## Global Constraints
- 所有正文文本中非 LaTeX 数学公式的美元符号 `$` 必须转义为 `\$` 或包裹在行内代码块中；
- 保持全项目 TypeScript 类型检查 0 报错（`npm run typecheck`）；
- 保持 ESLint 校验 0 报错（`npm run lint`）；
- 保持全量测试套件（17 套件，438 项测试）全部 100% PASS（`npm test`）；
- 路径与文件名必须遵守 SJTU 统一安全编码规范 (`strictEncodeURIComponent`)，防止目录穿越。

---

### Task 1: 云盘 SMH 底层 API 协议与 IPC 管道实现

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/cloudpan.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Create: `test/e2e/cloudpan-explorer.test.ts`

**Interfaces:**
- Produces:
  - `CloudPanItem`: `{ name: string; type: 'dir' | 'file'; size?: number; fileType?: string; modificationTime: string; creationTime?: string; crc64?: string }`
  - `CloudPanDirectoryListing`: `{ path: string[]; currentDirName: string; totalNum: number; page: number; pageSize: number; contents: CloudPanItem[] }`
  - `listDirectoryContents(userToken: string, dirPath?: string[], page?: number, pageSize?: number): Promise<CloudPanDirectoryListing>`
  - `createDirectory(userToken: string, dirPath: string[]): Promise<void>`
  - `deleteCloudItem(userToken: string, targetPath: string[], isDir: boolean): Promise<void>`
  - `renameCloudItem(userToken: string, oldPath: string[], newName: string, isDir: boolean): Promise<void>`
  - `getFileDownloadUrl(userToken: string, filePath: string[]): Promise<string>`

- [ ] **Step 1: 在 `src/shared/types.ts` 中定义云盘文件与目录数据模型与 Preload API 声明**
- [ ] **Step 2: 编写失败的单元测试用例 `test/e2e/cloudpan-explorer.test.ts`**
  - 测试根目录与多级子目录的内容解析与字段格式化；
  - 测试新建文件夹、重命名与删除接口的参数构造与 URL 严苛转义；
  - 测试获取文件下载直链返回 COS URL。
- [ ] **Step 3: 运行测试验证失败**
  - 运行 `npx vitest run test/e2e/cloudpan-explorer.test.ts`，确认因功能未实现而报错。
- [ ] **Step 4: 在 `src/main/cloudpan.ts` 中实现 SMH 协议函数**
  - 实现 `listDirectoryContents`：请求 `GET /api/v1/directory/{libraryId}/{spaceId}/{path}`，正确映射 `contents`；
  - 实现 `createDirectory`：请求 `PUT /api/v1/directory/{libraryId}/{spaceId}/{path}`；
  - 实现 `deleteCloudItem`：请求 `DELETE /api/v1/{file|directory}/{libraryId}/{spaceId}/{path}`；
  - 实现 `renameCloudItem`：请求 `PUT /api/v1/{file|directory}/{libraryId}/{spaceId}/{path}?move_to={newPath}`；
  - 实现 `getFileDownloadUrl`：请求 `GET /api/v1/file/{libraryId}/{spaceId}/{path}?download=true`。
- [ ] **Step 5: 在 `src/main/index.ts` 注册 IPC 处理器并在 `src/preload/index.ts` 暴露给渲染进程**
- [ ] **Step 6: 运行测试并验证通过**
  - 运行 `npx vitest run test/e2e/cloudpan-explorer.test.ts` 确保全部用例通过。
- [ ] **Step 7: 提交代码**
  - `git add -A && git commit -m "feat(cloudpan): implement SMH directory listing, CRUD APIs, and IPC handlers"`

---

### Task 2: 云盘文件上传与下载传输引擎深度打通

**Files:**
- Modify: `src/main/cloudpan.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `test/e2e/cloudpan-explorer.test.ts`

**Interfaces:**
- Produces:
  - `window.api.cloudpan.downloadFile(remotePath: string[], targetDir?: string): Promise<{ ok: boolean; taskId?: string; error?: string }>`
  - `window.api.cloudpan.uploadFiles(targetDirPath: string[]): Promise<{ ok: boolean; count?: number; error?: string }>`
  - `window.api.cloudpan.openInBrowser(remotePath?: string[]): Promise<void>`

- [ ] **Step 1: 编写上传与下载联动的测试用例**
  - 在 `test/e2e/cloudpan-explorer.test.ts` 中测试调起下载直链入列本地任务。
- [ ] **Step 2: 在 `src/main/index.ts` 中实现 `cloudpan:download-file`**
  - 从 `cloudpan.ts` 获取 COS 直链后，构造 `LocalTaskSpec` 并提交给本地下载调度器 `enqueueLocalTasks`。
- [ ] **Step 3: 在 `src/main/index.ts` 中实现 `cloudpan:upload-files`**
  - 调起 Electron 原生 `dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })`；
  - 为选中的本地文件构造 `CloudTaskSpec` 并提交给云盘直传调度器 `enqueueCloudTasks`。
- [ ] **Step 4: 在 `src/main/index.ts` 中实现 `cloudpan:open-web`**
  - 使用 `shell.openExternal('https://pan.sjtu.edu.cn/#/files/' + path)` 调起浏览器。
- [ ] **Step 5: 运行测试并验证通过**
  - 运行 `npm test` 验证无回归。
- [ ] **Step 6: 提交代码**
  - `git add -A && git commit -m "feat(cloudpan): integrate cloud file download and local file upload with transfer queue"`

---

### Task 3: 渲染端专属「☁️ 交大云盘资源管理器」组件与路由流转

**Files:**
- Create: `src/renderer/src/pages/CloudPanExplorer.tsx`
- Modify: `src/renderer/src/store/app.ts`
- Modify: `src/renderer/src/components/TitleBar.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/DownloadUI.test.ts`

**Interfaces:**
- Consumes:
  - `window.api.cloudpan.*`
  - `useAppStore`: `activeTab`, `setActiveTab`, `cloudpanToken`, `cloudpanCapacity`
- Produces:
  - `CloudPanExplorer` 页面组件

- [ ] **Step 1: 在 `src/renderer/src/store/app.ts` 中支持 `cloudpan` 路由扩展与前序页面记录**
  - 在 `activeTab` 联合类型中增加 `'cloudpan'`，并提供 `previousTab` 以便返回。
- [ ] **Step 2: 在 `src/renderer/src/components/TitleBar.tsx` 中让云盘胶囊可点击并切换路由**
  - 已登录状态下点击 `[ ☁️ 交大云盘 ]` 胶囊触发 `setActiveTab('cloudpan')`。
- [ ] **Step 3: 构建 `src/renderer/src/pages/CloudPanExplorer.tsx`**
  - 顶部横幅：返回按钮 `< 返回课程列表`、配额使用进度条、操作按钮组（`[ + 新建文件夹 ]`、`[ 📤 上传文件 ]`、`[ 🌐 网页端打开 ]`、`[ ↻ 刷新 ]`）、视图切换开关（网格/列表）；
  - 路径导航：嵌入 `BreadcrumbBar`，支持点击各层级跳转，首项为 `☁️ 个人根目录`；
  - 列表与卡片渲染：文件夹卡片/行支持单击下钻，文件卡片/行展示格式图标、大小、修改时间与操作按钮（下载、重命名、删除、网页打开）；
  - 批量操作浮动条：选中文件后显示 `已选 X 项`，支持 `批量下载到本地` 与 `批量删除`；
  - 模态弹窗：新建文件夹输入弹窗、重命名输入弹窗、删除二次防误触确认弹窗。
- [ ] **Step 4: 在 `src/renderer/src/App.tsx` 中挂载 `CloudPanExplorer`**
- [ ] **Step 5: 在 `src/renderer/src/components/DownloadUI.test.ts` 中添加路由流转单元测试**
- [ ] **Step 6: 运行测试并验证通过**
  - 运行 `npm test`，确保全部测试通过。
- [ ] **Step 7: 提交代码**
  - `git add -A && git commit -m "feat(renderer): implement CloudPanExplorer page with breadcrumb navigation and batch controls"`

---

### Task 4: 全链路回归验证与构建校验

**Files:**
- 全局检验

- [ ] **Step 1: 代码静态与类型检查**
  - 运行 `npm run lint`，确保 0 errors；
  - 运行 `npm run typecheck`，确保 0 errors。
- [ ] **Step 2: 全量自动化测试回归**
  - 运行 `npm test`，确保 18 套件 / 450+ 项测试全部 100% PASS。
- [ ] **Step 3: 生产构建验证**
  - 运行 `npm run build`，确保成功打包生成发布版。
- [ ] **Step 4: 提交并推送到 GitHub 远端仓库**
  - `git push origin master` 并核查 CI/CD 流水线。
