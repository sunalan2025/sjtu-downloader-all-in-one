# SJTU 旁听下载器

批量下载 [v.sjtu.edu.cn](https://v.sjtu.edu.cn)「我的旁听」课程回放视频的桌面工具。支持本地下载和直传交大云盘（pan.sjtu.edu.cn）。

> **网络要求** — 需要连接 SJTU 校园网或使用交大 VPN 才能正常访问视频资源和下载。

> **免责声明** — 本工具仅供下载**自己有权访问**的课程资源用于个人学习。请勿传播、转售下载内容，亦不得用于任何商业用途。下载内容的版权归课程权利方所有，使用者需自行承担相关责任。

---

## 功能特性

### 登录与认证

- **jAccount 扫码登录** — 内嵌官方登录页面，使用「交我办」或微信扫码即可完成认证
- **登录态持久化** — session 保存在本地，关闭应用后重新打开无需重新登录
- **交大云盘一键连接** — 利用已有的 jAccount session 自动完成云盘 SSO 登录，无需额外操作

### 课程扫描

- **自动扫描旁听课** — 登录后自动拉取全部已通过审核的旁听课程
- **双视角视频** — 每节课同时提供教师视角（讲台画面）和 PPT 视角（板书画面），可按需勾选
- **智能排序** — 按上课时间重新编号，消除原始排序中的错乱和重复

### 下载模式

- **本地下载** — 视频保存到本地磁盘，按课程自动归档
- **云盘上传** — 边下载边上传到交大云盘，不占本地空间
- **两者并行** — 同时下载到本地和上传到云盘，一份带宽双重备份

### 下载控制

- **并发调节** — 支持 2-16 路并发，根据网络情况灵活调整
- **断点续传** — 下载中断后重新开始自动从断点处继续，无需从头下载
- **智能跳过** — 本地已存在的文件或云盘已存在的文件自动跳过
- **暂停 / 恢复 / 取消** — 每个任务独立控制，也可一键操作全部任务
- **实时进度** — 显示下载百分比、速度、已下载/总大小
- **网络自适应** — 网络频繁出错时自动暂停调度，退避后恢复，避免无效请求

### 文件归档

视频按以下结构自动整理：

```
SJTU旁听课程/
├── 线性代数-张老师-2025-2026学年第2学期/
│   ├── 第1讲-教师.mp4
│   ├── 第1讲-PPT.mp4
│   ├── 第2讲-教师.mp4
│   └── ...
└── 大学英语-李老师-2025-2026学年第2学期/
    └── ...
```

文件夹名格式：`课程名-教师-学期`
文件名格式：`第N讲-视角.mp4`（N 为按时间排序后的稳定序号）

---

## 获取方式

### 方式一：下载安装包（推荐）

前往 Releases 页面，下载对应平台的安装包：

| 平台 | 文件格式 | 说明 |
|------|---------|------|
| Windows | `.exe` | NSIS 安装程序，支持自定义安装路径 |
| macOS | `.dmg` / `.zip` | DMG 拖拽安装，或 ZIP 解压即用 |
| Linux | `.AppImage` | 无需安装，添加执行权限后直接运行 |

### 方式二：从源码构建

需要 [Node.js](https://nodejs.org/) >= 18 和 npm。

```bash
# 安装依赖
npm install

# 启动开发模式
npm run dev

# 或打包为安装包（输出至 release/ 目录）
npm run build:win     # Windows
npm run build:mac     # macOS
npm run build:linux   # Linux
```

---

## 使用教程

### 第一步：登录

1. 打开应用，点击「使用 jAccount 登录」
2. 页面加载后会出现 jAccount 二维码，使用**交我办**或微信扫码
3. 在手机上确认登录后，应用会自动检测并跳转至课程页面

> 登录信息仅保存在本机，应用不会上传任何账号或密码。

### 第二步：扫描课程

进入课程页面后，应用会自动扫描你的旁听课程列表：

- 已通过审核的课程会显示在列表中
- 每门课默认展开所有课时
- 每节课有两个视角可选：**教师**（讲台画面）和 **PPT**（板书画面）

你可以：

- 点击课程名旁的复选框，全选 / 取消该课程的所有视频
- 点击「教师」或「PPT」按钮，按视角批量选择
- 逐个勾选需要下载的课时和视角

### 第三步：选择下载模式

操作栏提供三种模式：

| 模式 | 说明 |
|------|------|
| **本地** | 视频下载到本地磁盘 |
| **云盘** | 视频上传到交大云盘（需先连接云盘） |
| **两者** | 同时下载到本地和上传到云盘 |

- 选择「本地」或「两者」时，需要点击「选择下载目录」指定本地保存路径
- 选择「云盘」或「两者」时，需要点击「连接交大云盘」完成 SSO 登录

### 第四步：设置并发数

拖动「并发」滑块调整同时下载的任务数：

- **2-3**：带宽有限时（如校园无线网）
- **5-8**：带宽充裕时（如有线网络）
- **8-16**：带宽非常充裕且需要快速下载时

> 并发数过高可能导致下载速度反而下降或触发服务端限流，建议根据实际网络情况调整。

### 第五步：开始下载

1. 确认已选中需要下载的视频
2. 点击「开始下载 N 项」/ 「开始上传 N 项」/ 「开始下载+上传 N 项」按钮

下载过程中可以：

- **暂停单个任务**：点击该任务进度条右侧的暂停按钮
- **取消单个任务**：点击取消按钮
- **恢复暂停的任务**：点击继续按钮，从断点处续传
- **全局控制**：操作栏右侧提供暂停全部、全部继续、取消全部按钮

### 第六步：查看下载结果

下载完成后，进度条变为绿色「完成」状态。

**本地模式**：视频文件保存在你选择的下载目录下的 `SJTU旁听课程/` 文件夹中。

**云盘模式**：视频文件上传到交大云盘的 `SJTU旁听课程/` 文件夹中，可在 [pan.sjtu.edu.cn](https://pan.sjtu.edu.cn) 访问。

---

## 下载状态说明

| 状态 | 含义 |
|------|------|
| 等待中 | 已加入下载队列，等待空闲并发槽 |
| 解析直链… | 正在从 v.sjtu 获取视频的 CDN 直链 |
| 下载中 | 正在下载/上传，显示进度百分比和速度 |
| 已暂停 | 暂停中，恢复后从断点续传 |
| 完成 | 下载/上传成功 |
| 已存在 | 本地/云盘已有同名文件，自动跳过 |
| 失败 | 下载/上传出错，可点击重试 |
| 已取消 | 被手动取消 |

---

## 注意事项

### 网络环境

- **必须连接 SJTU 校园网或使用交大 VPN**，否则无法访问 v.sjtu.edu.cn 的视频资源
- 部分视频通过 CDN 分发，在校外可能可以下载，但不保证全部可用
- 下载使用 Node.js 原生 HTTP 请求，绕过 Chromium 网络栈，避免跨域限制

### 登录与会话

- 登录态保存在本地 Electron session 中，关闭应用后重新打开如仍有效则无需重新登录
- jAccount JWT token 仅保存在内存中，进程退出即丢弃，下次启动需重新扫码
- 交大云盘 UserToken 持久化到 localStorage，下次启动可直接使用

### 云盘上传

- 云盘上传采用 4MB 分片直传腾讯 COS，边下载边上传，内存占用恒定
- 上传支持断点续传：暂停后恢复会跳过已传分片
- 云盘已存在的文件会自动跳过（按文件路径判断）
- 云盘空间信息可在操作栏实时查看

### 磁盘空间

- 本地下载时，视频体积较大（单个可达数百 MB 至数 GB），请确保目标磁盘有足够空间
- 下载过程中的临时文件以 `.part` 后缀保存，用于支持断点续传
- 下载完成后 `.part` 文件会被自动删除；也可手动安全删除，不影响已下载的 `.mp4` 文件

### 文件命名

- 文件名中包含课程名、教师、学期等信息
- 超出操作系统限制的字符（`<>:"/\|?*` 等）会被自动替换为下划线
- 文件名长度限制为 180 字符

---

## 技术栈

| 技术 | 用途 |
|------|------|
| [Electron](https://www.electronjs.org/) | 跨平台桌面应用框架 |
| [electron-vite](https://electron-vite.org/) | 基于 Vite 的 Electron 构建工具 |
| [React 19](https://react.dev/) | UI 框架 |
| [TypeScript](https://www.typescriptlang.org/) | 类型安全的 JavaScript 超集 |
| [Tailwind CSS](https://tailwindcss.com/) | 原子化 CSS 框架 |
| [Zustand](https://zustand-demo.pmnd.rs/) | 轻量级状态管理 |
| [Node.js https](https://nodejs.org/api/https.html) | 原生 HTTP 流式下载（绕过 Chromium CORS） |

---

## 项目结构

```
src/
├── main/
│   ├── index.ts              # 主进程：窗口管理、下载引擎、云盘上传引擎、API 调用
│   └── cloudpan.ts           # 交大云盘 API：认证、文件夹创建、分片上传
├── preload/
│   └── index.ts              # IPC 桥接：安全暴露主进程 API 给渲染端
├── shared/
│   └── types.ts              # 跨层共享的 TypeScript 类型定义
└── renderer/
    ├── index.html            # HTML 模板（含 CSP 配置）
    └── src/
        ├── main.tsx          # React 入口
        ├── App.tsx           # 根组件，按 stage 切换页面
        ├── index.css         # Tailwind CSS 入口 + 自定义样式
        ├── store/
        │   └── app.ts        # Zustand 全局状态（登录、课程、下载进度）
        ├── components/
        │   ├── TitleBar.tsx  # 自定义标题栏（无边框窗口）
        │   └── Spinner.tsx   # 加载动画组件
        └── pages/
            ├── Welcome.tsx   # 欢迎页：功能介绍 + 登录入口
            ├── Login.tsx     # 登录页：内嵌 jAccount 扫码 webview
            └── Browser.tsx   # 主操作页：课程列表、选择、下载控制、进度展示
```

### 数据流

```
用户操作 → Browser.tsx → window.api.xxx → preload IPC → main/index.ts → v.sjtu API / 云盘 API
                                                                       ↓
Browser.tsx ← applyProgress ← ipcRenderer.on ← emitProgress ← 下载/上传引擎
```

### 各层职责

| 层 | 关键文件 | 职责 |
|----|---------|------|
| 主进程 | `main/index.ts` | 窗口管理、jAccount 登录验证、调用 v.sjtu API（扫描课程/获取详情/解析直链）、本地下载引擎（任务队列、并发调度、HTTP 流式下载、断点续传、暂停/取消/恢复）、云盘上传引擎（CDN→COS 边下载边分片上传） |
| 主进程 | `main/cloudpan.ts` | 交大云盘 API 封装：UserToken 验证、空间凭证获取与缓存、文件夹逐级创建、COS 分片上传（含 renew 凭证、单次重试）、文件存在性检查 |
| 预加载 | `preload/index.ts` | IPC 通信桥，让渲染端通过 `window.api.xxx` 安全调用主进程功能 |
| 渲染端 | `store/app.ts` | Zustand 全局状态：登录态、扫描结果、课程列表、选中态、下载进度、并发数（`cloudUserToken`/`concurrency`/`downloadMode`/`localDestRoot` 持久化到 localStorage） |
| 渲染端 | `pages/Browser.tsx` | 主操作页：自动扫描课程、折叠卡片展示（教师/PPT 双视角）、全选/单选/批量选择、下载控制（开始/暂停/恢复/取消、并发调节）、实时进度条（速度、百分比、状态）、云盘连接与空间信息 |
| 渲染端 | `pages/Login.tsx` | 登录页：webview 加载 jAccount 扫码，轮询 localStorage 提取 jwt token，自动检测登录成功并跳转 |
| 共享层 | `shared/types.ts` | API 响应结构、课程/视频模型、下载任务规格、进度状态、云盘类型等 |

---

## 开发

### 前置条件

- [Node.js](https://nodejs.org/) >= 18
- npm

### 常用命令

```bash
# 安装依赖
npm install

# 启动开发模式（支持热更新）
npm run dev

# TypeScript 类型检查
npm run typecheck

# 打包（输出到 release/ 目录）
npm run build          # 当前平台
npm run build:win      # Windows NSIS 安装包
npm run build:mac      # macOS DMG + ZIP
npm run build:linux    # Linux AppImage
npm run build:unpack   # 仅构建不打包（输出目录）
```

### 构建系统

项目使用 [electron-vite](https://electron-vite.org/) 作为构建工具，配置位于 `electron.vite.config.ts`。

构建分为三个独立的 Vite 构建：

- **main** — 主进程代码，入口 `src/main/index.ts`，输出到 `out/main/`
- **preload** — 预加载脚本，入口 `src/preload/index.ts`，输出到 `out/preload/`
- **renderer** — 渲染端 React 应用，入口 `src/renderer/index.html`，输出到 `out/renderer/`

打包使用 [electron-builder](https://www.electron.build/)，配置在 `package.json` 的 `build` 字段中。

### 路径别名

| 别名 | 实际路径 |
|------|---------|
| `@renderer` | `src/renderer/src` |
| `@shared` | `src/shared` |

### 开发模式下的进程关闭

应用在关闭窗口时会主动销毁所有活跃的 HTTP 请求、文件写入流和定时器，确保不会有资源泄漏。下载过程中的 `.part` 文件会保留，下次启动时自动从断点续传。

---

## 许可

[MIT](./LICENSE)
