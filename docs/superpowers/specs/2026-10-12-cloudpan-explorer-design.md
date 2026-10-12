# 交大云盘资源管理器 (CloudPan Explorer) 架构与交互设计方案

> **文档状态**：已批准 (Approved)  
> **创建日期**：2026-10-12  
> **适用模块**：交大云盘集成 (`src/main/cloudpan.ts`)、渲染端应用入口与视图流转 (`src/renderer/src/pages/CloudPanExplorer.tsx`, `TitleBar.tsx`, `App.tsx`)

---

## 1. 背景与目标

### 1.1 现状与痛点
此前客户端已实现交大云盘（`pan.sjtu.edu.cn`）基于 jAccount 的 SSO 免密直连、空间配额查询以及课程课件的大文件直传功能。但云盘在此前仅充当“单向同步的目标存储”，用户在客户端内**无法查看云盘已存文件**，也**无法对云盘文件进行管理与操作（如新建文件夹、重命名、删除、从云盘下载到本地、手动上传本地文件等）**。

### 1.2 建设目标
在保持现有四大核心功能标签页（Canvas 课程、课堂实录、好大学在线、传输中心）结构清晰的前提下：
1. **轻量快捷入口**：利用顶栏右侧现有的 `[ ☁️ 交大云盘 (配额) ]` 胶囊，点击一键展开/切入全屏的「☁️ 交大云盘资源管理器」；
2. **现代网盘交互流**：复用现有的网盘式多模交互（顶部 `BreadcrumbBar` 面包屑逐级下钻与回退、网格大图标 `grid` / 详细列表 `list` 视图切换、复选框多选联动与底部批量操作条）；
3. **全流程云端文件管理**：
   - **浏览**：查看根目录与任意多级子目录，显示名称、图标、大小、修改日期；
   - **新建**：在当前目录下快速新建文件夹；
   - **重命名**：文件与文件夹的直观重命名；
   - **删除**：文件与文件夹的安全删除（带防误触二次确认）；
   - **云端下载至本地**：单文件或批量选中下载，自动提取直链并入列统一传输引擎；
   - **本地上传至云盘**：调起文件选择器，将本地文件通过分片直传能力上传至当前云盘目录；
   - **网页端直达**：支持一键调用浏览器跳转到交大云盘对应网页位置，利用官方网页版进行 Office 在线协同编辑。
4. **统一传输体系协同**：云盘文件的上传与下载完全打通现有的 `src/main/download-engine/`，享受并发控制、断点续传与网速统计，并实时联动顶栏传输中心。

---

## 2. 底层协议与 API 规范（腾讯云 SMH）

交大云盘（`pan.sjtu.edu.cn`）底层运行腾讯云智能媒资托管平台（SMH）。所有 API 均走现有的会话凭据换取机制（`userToken` -> `libraryId`, `spaceId`, `accessToken`）。

### 2.1 接口映射清单

| 业务功能 | HTTP 方法与路径 | Query / Body 参数 | 返回值摘要 |
| :--- | :--- | :--- | :--- |
| **列出目录内容** | `GET /api/v1/directory/{libraryId}/{spaceId}/{dirPath}` | `access_token`, `page`, `page_size`, `order_by=name` | `{ contents: CloudPanItem[], totalNum, page, pageSize }` |
| **新建文件夹** | `PUT /api/v1/directory/{libraryId}/{spaceId}/{dirPath}` | `access_token`, `conflict_resolution_strategy=ask` | `{ path: string[] }` |
| **删除目录** | `DELETE /api/v1/directory/{libraryId}/{spaceId}/{dirPath}` | `access_token` | `204 No Content` |
| **删除文件** | `DELETE /api/v1/file/{libraryId}/{spaceId}/{filePath}` | `access_token` | `204 No Content` |
| **重命名/移动目录** | `PUT /api/v1/directory/{libraryId}/{spaceId}/{dirPath}` | `access_token`, `move_to={newPath}`, `conflict_resolution_strategy=ask` | `{ path: string[] }` |
| **重命名/移动文件** | `PUT /api/v1/file/{libraryId}/{spaceId}/{filePath}` | `access_token`, `move_to={newPath}`, `conflict_resolution_strategy=ask` | `{ path: string[] }` |
| **获取文件下载直链** | `GET /api/v1/file/{libraryId}/{spaceId}/{filePath}` | `access_token`, `download=true` | `{ cosUrl: string }` 或 302 重定向 |

### 2.2 数据模型定义 (`src/shared/types.ts`)

```typescript
export interface CloudPanItem {
  name: string
  type: 'dir' | 'file'
  size?: number
  fileType?: string
  modificationTime: string
  creationTime?: string
  crc64?: string
}

export interface CloudPanDirectoryListing {
  path: string[]
  currentDirName: string
  totalNum: number
  page: number
  pageSize: number
  contents: CloudPanItem[]
}
```

---

## 3. 系统架构与模块分层

```mermaid
flowchart TD
    Renderer[Renderer: CloudPanExplorer.tsx] -->|IPC: cloudpan:list-dir / delete / rename| Preload[Preload: window.api.cloudpan]
    Preload -->|IPC invoke| MainIPC[Main: IPC Handlers in index.ts]
    MainIPC --> CloudPanEngine[Main: cloudpan.ts (SMH API)]
    MainIPC --> DownloadEngine[Main: download-engine/local.ts]
    
    CloudPanEngine -->|HTTPS REST| SJTUPanAPI[pan.sjtu.edu.cn (SMH)]
    DownloadEngine -->|Range HTTP GET| TencentCOS[Tencent Cloud COS]
    CloudPanEngine -->|Chunked PUT| TencentCOS
```

### 3.1 主进程层 (`src/main/cloudpan.ts`)
新增并导出以下核心管理函数：
- `listDirectoryContents(userToken, dirPath, page, pageSize): Promise<CloudPanDirectoryListing>`
- `createDirectory(userToken, dirPath): Promise<void>`
- `deleteCloudItem(userToken, targetPath, isDir): Promise<void>`
- `renameCloudItem(userToken, oldPath, newPath, isDir): Promise<void>`
- `getFileDownloadUrl(userToken, filePath): Promise<string>`

### 3.2 IPC 管道层 (`src/preload/index.ts` & `src/main/index.ts`)
注册以下 IPC 通道：
- `cloudpan:list-dir`: 查询目录文件列表；
- `cloudpan:create-dir`: 创建子目录；
- `cloudpan:delete-item`: 删除指定文件或目录；
- `cloudpan:rename-item`: 重命名文件或目录；
- `cloudpan:download-file`: 将云盘文件加入下载引擎；
- `cloudpan:upload-files`: 唤起本地对话框并将选中的文件加入分片上传队列；
- `cloudpan:open-web`: 调起系统默认浏览器打开云盘网页版。

### 3.3 界面与交互设计 (`src/renderer/src/pages/CloudPanExplorer.tsx`)
1. **顶栏快捷导航与状态指示**：
   - 顶部提供返回按钮：`< 返回课程列表`；
   - 标题区展示：`☁️ 交大云盘资源管理器` + 容量配额胶囊（如 `已用 932 GB / 1024 GB (91%)`）；
   - 右侧操作区：`[ + 新建文件夹 ]`、`[ 📤 上传文件 ]`、`[ 🌐 网页端打开 ]`、`[ ↻ 刷新 ]` 以及 `courseViewMode` 切换开关。
2. **路径与面包屑导航**：
   - 采用 `BreadcrumbBar`：`☁️ 个人根目录 / ... / ...`；
   - 点击任意历史层级可瞬间跳转；
   - 单击子文件夹可直接下钻。
3. **双重视图支持**：
   - `grid`：现代化卡片阵列，带大尺寸文件夹/文件格式图标、文件名、大小及快捷操作悬浮菜单；
   - `list`：清晰表格排版，支持按名称、修改日期、大小排序。
4. **批量操作条与弹窗**：
   - 支持多选复选框，选中后底部常驻浮动操作条（`已选中 X 项` -> `批量下载` / `批量删除`）；
   - 提供「新建文件夹」输入弹窗、「重命名」输入弹窗及「删除确认」安全弹窗。

---

## 4. 实施计划 (Phase Breakdown)

1. **Phase 1: 底层 SMH API 协议与 IPC 管道实现**
   - 在 `src/main/cloudpan.ts` 补齐 SMH 接口调用与路径严苛编码；
   - 在 `src/main/index.ts` 与 `src/preload/index.ts` 注册 IPC 管道与类型定义；
   - 编写 `test/e2e/cloudpan-explorer.test.ts` 进行接口协议单测验证。
2. **Phase 2: 渲染端云盘资源管理器组件构建**
   - 新建 `src/renderer/src/pages/CloudPanExplorer.tsx`；
   - 集成面包屑导航、网格/列表视图、操作按钮栏及模态交互；
   - 在 `TitleBar.tsx` 与 `App.tsx` 打通云盘徽标切入与回退路由。
3. **Phase 3: 传输引擎联动与上传/下载全链路闭环**
   - 实现云盘文件一键下载至本地本地下载目录并进入传输队列；
   - 实现本地文件选择后分片直传当前目录并实时刷新列表。
4. **Phase 4: 全量回归测试与代码质量验证**
   - 运行 `npm run lint`、`npm run typecheck` 保持零错误；
   - 运行全量测试套件（`npm test`），保持 100% 测试通过。
