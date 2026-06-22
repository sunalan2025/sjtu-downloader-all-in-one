# SJTU 课程下载器

批量下载 [v.sjtu.edu.cn](https://v.sjtu.edu.cn) 旁听课程和 [Canvas (oc.sjtu.edu.cn)](https://oc.sjtu.edu.cn) 课程资源的桌面工具。支持本地下载和直传交大云盘（pan.sjtu.edu.cn）。

> **网络要求** — 需要连接 SJTU 校园网或使用交大 VPN 才能正常访问视频资源和下载。

> **免责声明** — 本工具仅供下载**自己有权访问**的课程资源用于个人学习。请勿传播、转售下载内容，亦不得用于任何商业用途。下载内容的版权归课程权利方所有，使用者需自行承担相关责任。

---

## 功能特性

### 登录与认证

- **jAccount 扫码登录** — 内嵌官方登录页面，使用「交我办」或微信扫码即可完成认证
- **登录态持久化** — session 保存在本地，关闭应用后重新打开无需重新登录
- **交大云盘一键连接** — 利用已有的 jAccount session 自动完成云盘 SSO 登录，无需额外操作

### 课程来源

#### v.sjtu 旁听课程

- **自动扫描旁听课** — 登录后自动拉取全部已通过审核的旁听课程
- **双视角视频** — 每节课同时提供教师视角（讲台画面）和 PPT 视角（板书画面），可按需勾选
- **智能排序** — 按上课时间重新编号，消除原始排序中的错乱和重复

#### Canvas 课程

- **自动拉取课程列表** — 登录后自动获取全部 Canvas 课程（含已结课）
- **学期筛选** — 按学期快速筛选课程
- **课件文件下载** — 支持下载课程文件、模块补漏文件、大纲嵌入文件，保留 Canvas 文件夹层级
- **课堂视频下载** — 扫描课堂视频后按讲次展示，每讲含教师 + PPT 两路流
- **模块嵌入视频** — 支持下载 Canvas 模块页面中嵌入的 HLS 视频
- **教师筛选** — 多教师课程可按教师筛选

### 下载模式

三种模式，v.sjtu 和 Canvas 通用：

| 模式 | 说明 |
|------|------|
| **本地** | 文件下载到本地磁盘，按课程自动归档 |
| **云盘** | 边下载边上传到交大云盘，不占本地空间 |
| **两者** | 同时下载到本地和上传到云盘，一份带宽双重备份 |

### 下载控制

- **并发调节** — 支持 2-16 路并发手动设置，也支持**自动并发**模式（AIMD 算法，根据网络吞吐和错误率动态调整，无需手动干预）
- **断点续传** — 下载中断后重新开始自动从断点处继续，无需从头下载
- **智能跳过或替换** — 本地/云盘已存在的同名文件可选择「跳过」（保留旧文件）或「替换」（删除旧文件后重新下载/上传），三种保存模式通用
- **暂停 / 恢复 / 取消** — 每个任务独立控制，也可一键操作全部任务；暂停时立即中止在途网络请求，不会出现「暂停后还在上传」的情况
- **实时进度** — 显示下载百分比、速度、已下载/总大小
- **网络自适应** — 网络频繁出错时自动暂停调度，退避后恢复，避免无效请求
- **自动并发模式** — AIMD（加性增乘性减）算法，配合吞吐增益反馈、自适应评估周期和瓶颈冷却，自动探测最优并发数
- **懒解析** — Canvas 视频直链在下载前按需解析（而非全量预解析），降低启动延迟和 API 调用量
- **内存优化** — 惰性任务物化（临下载才创建 TaskRuntime）、终态任务立即清理、Canvas 课程串行处理避免大数据集同时驻留内存、vodChannelsCache 上界 500 条目 LRU 淘汰
- **IPC 批处理** — 主进程 setImmediate + 渲染端 queueMicrotask 双重批处理，合并同一事件循环轮次内的多条进度更新
- **事件驱动调度** — HLS 下载的并发槽位等待使用 Promise 事件通知替代轮询，延迟从最高 2 秒降至约 10ms

---

## 文件命名规则

### 文件名清洗

所有文件名和文件夹名在写入磁盘或上传云盘前都会经过清洗：

- Windows 非法字符 `<>:"/\|?*` 和控制字符（0x00-0x1f）替换为 `_`
- 去除末尾的 `.` 和空格
- 长度限制 180 字符
- 空名称回退为 `未命名`

### 本地保存路径

假设用户选择 `D:\Downloads` 作为下载目录：

```
D:\Downloads/
├── SJTU旁听课程/                          ← v.sjtu 旁听课程
│   ├── 线性代数-张老师-2024-2025-1/
│   │   ├── 第1讲-教师.mp4
│   │   ├── 第1讲-PPT.mp4
│   │   ├── 第2讲-教师.mp4
│   │   └── ...
│   └── 大学英语-李老师-2024-2025-1/
│       └── ...
│
└── Canvas课程/                             ← Canvas 课程
    ├── 高等数学-王老师-2024-2025-2/
    │   ├── files/                          ← 课件文件
    │   │   ├── 第1章/
    │   │   │   ├── 讲义.pdf
    │   │   │   └── 习题.pdf
    │   │   ├── 第2章/
    │   │   │   └── ...
    │   │   ├── _from_modules/              ← 模块补漏文件
    │   │   │   └── 补充材料.pdf
    │   │   └── _from_syllabus/             ← 大纲嵌入文件
    │   │       └── 课程大纲.pdf
    │   └── videos/                         ← 课堂视频
    │       ├── 2025-09-16_08-00-王老师-东上院301-教师.mp4
    │       ├── 2025-09-16_08-00-王老师-东上院301-PPT.mp4
    │       └── ...
    └── 线性代数-赵老师-2024-2025-2/
        └── ...
```

### 云端保存路径（交大云盘）

```
交大云盘/
├── SJTU旁听课程/                           ← v.sjtu 旁听课程
│   ├── 线性代数-张老师-2024-2025-1/
│   │   ├── 第1讲-教师.mp4
│   │   └── ...
│   └── ...
│
└── SJTU Canvas课程/                        ← Canvas 课程（独立根目录）
    ├── 高等数学-王老师-2024-2025-2/
    │   ├── files/
    │   │   └── ...
    │   └── videos/
    │       └── ...
    └── ...
```

### 各类型文件命名详情

#### 文件夹名（课程名）

| 来源 | 格式 | 示例 |
|------|------|------|
| v.sjtu 旁听 | `{课程名}-{教师}-{学期}` | `线性代数-张老师-2024-2025-1` |
| Canvas | `{课程名}-{教师}-{学期}` | `高等数学-王老师/赵老师-2024-2025-2` |

- v.sjtu 教师名取自课程 API 的 `teacName` 字段
- Canvas 教师名优先取课堂视频扫描结果，未扫描时回退到课程 API 的注册教师
- 多教师用 `/` 连接（如 `王老师/赵老师`）

#### 文件名

| 来源 | 格式 | 示例 |
|------|------|------|
| v.sjtu 视频 | `第{N}讲-{视角}.mp4` | `第1讲-教师.mp4`、`第3讲-PPT.mp4` |
| Canvas 课件 | `{原始文件名}` | `lecture_notes_week1.pdf`、`homework3.docx` |
| Canvas 课堂视频 | `{日期}_{时间}-{教师}-{教室}-{视角}.mp4` | `2025-09-16_08-00-王老师-东上院301-教师.mp4` |
| Canvas 模块视频 | `{课程名}-{页面标题}.mp4` | `高等数学-第3讲录播.mp4` |

- v.sjtu 的 `N` 是按上课时间排序后的稳定序号（非原始课次编号）
- Canvas 课堂视频的日期时间格式：原始 `2025-09-16 08:00:00` → `2025-09-16_08-00`（冒号替换为 `-`，空格替换为 `_`，秒数去掉）
- Canvas 课堂视频视角标签：`教师`（讲台画面）、`PPT`（板书画面），多路流时为 `路1`、`路2`...

#### 临时文件

| 文件 | 说明 |
|------|------|
| `{文件名}.part` | 下载过程中的临时文件，用于断点续传，完成后自动删除 |
| `{文件名}.ts` | HLS 模块视频下载时的临时 TS 文件，合并为 MP4 后自动删除 |

#### Canvas 文件夹层级

Canvas 课程文件保留 Canvas 上的文件夹结构：

| 类型 | 路径前缀 | 说明 |
|------|---------|------|
| 课程文件 | `files/` | 按 Canvas 文件夹层级组织 |
| 模块补漏 | `files/_from_modules/` | 出现在模块中但不在文件列表中的文件 |
| 大纲补漏 | `files/_from_syllabus/` | 出现在课程大纲中但不在文件列表中的文件 |
| 课堂视频 | `videos/` | 按讲次平铺 |

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

### 第二步：选择课程来源

登录后可通过顶部标签切换两个课程来源：

- **v.sjtu 旁听** — 自动扫描旁听课程，每节课提供教师 + PPT 双视角
- **Canvas** — 自动拉取 Canvas 课程列表，支持课件文件和课堂视频

### 第三步：选择课程和内容

#### v.sjtu 旁听课程

- 点击课程名旁的复选框，全选 / 取消该课程的所有视频
- 点击「教师」或「PPT」按钮，按视角批量选择
- 逐个勾选需要下载的课时和视角

#### Canvas 课程

- 点击课程名旁的复选框，全选 / 取消该课程所有内容
- 顶部三个分类按钮可按类型批量选择：**课件**、**视频-教师**、**视频-PPT**
- 展开课程卡片可查看课件文件列表和课堂视频列表
- 课件文件默认已扫描；课堂视频需点击「扫描课堂视频」触发
- 支持按学期筛选课程

### 第四步：选择下载模式

操作栏右侧提供模式和冲突策略选择器：

#### 保存模式

| 模式 | 说明 |
|------|------|
| **本地** | 文件下载到本地磁盘（需选择下载目录） |
| **云盘** | 文件上传到交大云盘（需连接云盘） |
| **两者** | 同时下载到本地并上传到云盘 |

- 选择「本地」或「两者」时，需要点击「选择下载目录」指定本地保存路径
- 选择「云盘」或「两者」时，需要点击「连接交大云盘」完成 SSO 登录

#### 同名文件冲突策略

| 策略 | 说明 |
|------|------|
| **跳过**（默认） | 同名文件已存在时跳过，保留旧文件 |
| **替换** | 同名文件已存在时先删除旧文件，再重新下载/上传 |

### 第五步：设置并发数

拖动「并发」滑块调整同时下载的任务数：

- **自动**：点击「自动」按钮启用 AIMD 自动并发模式，系统根据网络吞吐和错误率动态调整（推荐大多数场景使用）
- **2-3**：带宽有限时（如校园无线网）
- **5-8**：带宽充裕时（如有线网络）
- **8-16**：带宽非常充裕且需要快速下载时

> 自动模式下，并发数会实时显示在标题栏。手动模式下并发数过高可能导致下载速度反而下降或触发服务端限流，建议根据实际网络情况调整。

### 第六步：开始下载

1. 确认已选中需要下载的内容
2. 点击「开始下载 N 项」/ 「开始上传 N 项」/ 「开始下载+上传 N 项」按钮

下载过程中可以：

- **暂停单个任务**：点击该任务进度条旁的暂停按钮
- **取消单个任务**：点击取消按钮
- **恢复暂停的任务**：点击继续按钮，从断点处续传
- **全局控制**：操作栏提供暂停全部、全部继续、取消全部按钮

### 第七步：查看下载结果

下载完成后，进度条变为绿色「完成」状态。同时会弹出**系统通知**，汇报本批次的成功和失败数量（如「全部 23 项完成」或「成功 20 项，失败 3 项」），点击通知可直接聚焦主窗口。

**本地模式**：文件保存在你选择的下载目录下（旁听课程在 `SJTU旁听课程/`，Canvas 在 `Canvas课程/`）。

**云盘模式**：文件上传到交大云盘（旁听课程在 `SJTU旁听课程/`，Canvas 在 `SJTU Canvas课程/`），可在 [pan.sjtu.edu.cn](https://pan.sjtu.edu.cn) 访问。

---

## 下载状态说明

| 状态 | 含义 |
|------|------|
| 等待中 | 已加入下载队列，等待空闲并发槽 |
| 解析直链… | 正在从 v.sjtu 获取视频的 CDN 直链（懒解析：下载前按需调用） |
| 获取文件链接… | 正在从 Canvas API 获取文件签名 URL |
| 解析视频流… | 正在解析 Canvas 课堂视频的多路流地址（同 videoId 自动缓存） |
| 下载中 | 正在下载/上传，显示进度百分比和速度 |
| 已暂停 | 暂停中，恢复后从断点续传（云端任务保留 COS 分片会话） |
| 完成 | 下载/上传成功 |
| 已存在 | 本地/云盘已有同名文件，自动跳过（可在冲突策略中选择「替换」模式） |
| 失败 | 下载/上传出错，可点击重试 |
| 已取消 | 被手动取消 |

---

## 注意事项

### 网络环境

- **必须连接 SJTU 校园网或使用交大 VPN**，否则无法访问 v.sjtu.edu.cn 和 oc.sjtu.edu.cn 的资源
- 部分视频通过 CDN 分发，在校外可能可以下载，但不保证全部可用
- 下载使用 Node.js 原生 HTTP 请求，绕过 Chromium 网络栈，避免跨域限制；Canvas 文件下载通过会话 Cookie 注入实现直链解析，确保文件完整性
- 网络错误（socket hang up、超时、DNS 解析失败等）会自动指数退避重试（最多 3 次），无需手动操作
- Canvas 端点在高并发下偶发 429/403 限流，系统自动读取 `Retry-After` 并做指数退避重试（最多 4 次），无需手动干预
- HLS segment 下载同样支持自动重试，m3u8 解析过程也有重试机制

### 登录与会话

- v.sjtu 登录态保存在本地 Electron session 中，关闭应用后重新打开如仍有效则无需重新登录
- Canvas 使用独立的 SSO session，与 v.sjtu 共用 jAccount 认证
- jAccount JWT token 仅保存在内存中，进程退出即丢弃，下次启动需重新扫码
- 交大云盘 UserToken 持久化到 localStorage，下次启动可直接使用；main 进程使用内部缓存，不通过 IPC 传输 token

### 安全机制

- **contextIsolation + nodeIntegration: false** — 所有窗口（主窗口、Canvas SSO 窗口）均启用上下文隔离，禁止渲染端访问 Node.js API
- **CSP 内容安全策略** — `index.html` 中配置严格的 CSP，`default-src 'self'`，`connect-src` 限制到已知的 SJTU 域名
- **webview 导航白名单** — 登录页 webview 仅允许导航到 `sjtu.edu.cn` 相关域名，防止导航劫持
- **窗口打开拦截** — `setWindowOpenHandler` 拦截所有新窗口请求，重定向到系统默认浏览器
- **IPC 输入验证** — `download:start` 等 IPC handler 对输入参数进行类型和边界校验

### 云盘上传

- 云盘上传采用 4MB 分片直传腾讯 COS，边下载边上传，内存占用恒定
- 上传支持断点续传：暂停后恢复会跳过已传分片
- 暂停或取消时立即中止在途的 COS 分片上传请求，不会出现「点了暂停还在传」的情况
- 同名文件可选择跳过或替换（删除远端文件后重新上传），在冲突策略中切换
- 云盘空间信息可在操作栏实时查看

### 磁盘空间

- 本地下载时，视频体积较大（单个可达数百 MB 至数 GB），请确保目标磁盘有足够空间
- 下载过程中的临时文件以 `.part` 后缀保存，用于支持断点续传
- 下载完成后 `.part` 文件会被自动删除；也可手动安全删除，不影响已下载的文件

---

## 技术栈

| 技术 | 用途 |
|------|------|
| [Electron](https://www.electronjs.org/) | 跨平台桌面应用框架 |
| [electron-vite](https://electron-vite.org/) | 基于 Vite 的 Electron 构建工具 |
| [React 19](https://react.dev/) | UI 框架 |
| [TypeScript](https://www.typescriptlang.org/) | 类型安全的 JavaScript 超集 |
| [Tailwind CSS](https://tailwindcss.com/) | 原子化 CSS 框架 |
| [Zustand](https://zustand-demo.pmnd.rs/) | 轻量级状态管理（含 persist 中间件） |
| [Node.js https](https://nodejs.org/api/https.html) | 原生 HTTP 流式下载（绕过 Chromium CORS） |
| [ffmpeg](https://ffmpeg.org/) | HLS TS → MP4 无损 remux（Canvas 模块视频） |

---

## 项目结构

```
src/
├── main/
│   ├── index.ts                  # 主进程：窗口管理、下载引擎、云盘上传引擎、自动并发控制、IPC 进度批处理
│   ├── cloudpan.ts               # 交大云盘 API：认证、文件夹创建与缓存、分片上传（含断点续传、凭证 renew 重试）、文件删除（移入回收站）
│   └── canvas/
│       ├── api.ts                # Canvas REST API 封装（自动翻页、文件夹树、模块/大纲解析、文件元数据查询）
│       ├── orchestrator.ts       # Canvas IPC handler 注册（课程扫描、文件下载、视频下载、OIDC SSO、事件驱动并发槽位等待）
│       ├── video-tokens.ts       # Canvas 课堂视频 LTI token 获取、vod API 调用、视频通道缓存（TTL + 上界 500）
│       └── hls-download.ts       # Canvas 模块嵌入视频的 m3u8 捕获、HLS 下载、ffmpeg remux
├── preload/
│   └── index.ts                  # IPC 桥接：通过 contextBridge 安全暴露主进程 API 给渲染端
├── shared/
│   └── types.ts                  # 跨层共享的 TypeScript 类型定义（API 响应、业务模型、下载规格、Canvas 类型）
└── renderer/
    ├── index.html                # HTML 模板（含 CSP 配置：限制 connect-src 到 SJTU 域名）
    └── src/
        ├── main.tsx              # React 入口
        ├── App.tsx               # 根组件：按 stage 切换页面 + 顶部 Tab 导航 + App 级进度订阅
        ├── index.css             # Tailwind CSS 入口 + 自定义样式（动画、玻璃效果、自定义滚动条）
        ├── store/
        │   └── app.ts            # Zustand 全局状态（含 persist 持久化用户偏好、进度微任务批处理、both 模式聚合）
        ├── hooks/
        │   └── useSharedBrowserHooks.ts  # Browser 与 CanvasBrowser 共享的 hooks（云盘连接、token 验证、进度订阅、完成检测）
        ├── components/
        │   ├── TitleBar.tsx      # 自定义标题栏（并发控制、自动并发 AIMD、帮助弹窗、主题切换、登出）
        │   ├── Spinner.tsx       # 加载动画组件
        │   ├── Segmented.tsx     # 统一的「玻璃滑动指示器」分段选择器（Tab/模式/主题复用）
        │   └── DownloadUI.tsx    # 下载 UI 原子组件（进度条 EMA 速度、三态复选框、控制按钮、模式选择器、同名文件冲突策略选择器）
        └── pages/
            ├── Welcome.tsx       # 欢迎页：功能介绍 + 登录入口
            ├── Login.tsx         # 登录页：内嵌 jAccount 扫码 webview（含域名白名单导航限制）
            ├── Browser.tsx       # v.sjtu 旁听课程页：课程列表、双视角卡片、选择、下载、实时进度
            └── CanvasBrowser.tsx # Canvas 课程页：学期筛选、分类选择、课件/视频下载、串行课程处理
```

### 数据流

```
用户操作 → Browser.tsx / CanvasBrowser.tsx
         → window.api.xxx (通过 useSharedBrowserHooks 调用)
         → preload IPC (contextBridge 安全桥)
         → main/index.ts 或 main/canvas/orchestrator.ts
         → v.sjtu API / Canvas API / 云盘 API
                                    ↓
Browser.tsx / CanvasBrowser.tsx ← applyProgress ← ipcRenderer.on ← emitProgress (setImmediate 批处理)
                                    ↓
               useDownloadStats / useEffectiveProgress ← Zustand selector 聚合（编码-数字技巧避免级联重渲染）
```

### 各层职责

| 层 | 关键文件 | 职责 |
|----|---------|------|
| 主进程 | `main/index.ts` | 窗口管理、jAccount 登录验证（含 5 分钟结果缓存）、v.sjtu API 调用、本地下载引擎（惰性任务物化、任务队列、并发调度、HTTP 流式下载、断点续传、自动重试、HTTPS keep-alive、Canvas Cookie 注入直链解析、Canvas 429/403 限流退避重试）、云盘上传引擎（CDN→COS 边下载边分片上传、凭证 renew 重试、COS PUT 中止、覆盖模式远端删除）、自动并发控制（AIMD + 吞吐增益反馈 + 自适应周期 + 瓶颈冷却）、网络健康监测、IPC 进度批处理（setImmediate 合并）、系统通知（下载完成弹窗）、uncaughtException 安全退出 |
| 主进程 | `main/cloudpan.ts` | 交大云盘 API 封装：UserToken 验证、空间凭证获取与缓存、文件夹逐级创建（路径缓存避免重复 PUT）、COS 分片上传（含 renew 凭证、单次重试、断点续传会话状态）、文件存在性检查、文件删除（移入回收站，供替换策略使用）、`ChunkedUploader.abort()` 中止在途 PUT |
| 主进程 | `main/canvas/` | Canvas 课程相关：REST API 封装（自动翻页、并发模块页面批量获取）、OIDC SSO 登录、文件/视频扫描、LTI token 提取、vod 视频通道缓存（TTL 5 分钟 + 上界 500 条目淘汰）、HLS m3u8 捕获与 ffmpeg remux、事件驱动并发槽位等待 |
| 预加载 | `preload/index.ts` | IPC 通信桥（contextBridge.exposeInMainWorld），让渲染端通过 `window.api.xxx` 安全调用主进程功能。云盘 token 验证/空间查询不再接收 renderer 参数，由 main 进程使用内部缓存 |
| 共享层 | `shared/types.ts` | 跨层共享 TypeScript 类型：API 响应结构、课程/视频模型、下载任务规格、进度状态、云盘类型、Canvas 类型、vod API 结构 |
| 渲染端 | `store/app.ts` | Zustand 全局状态：登录态、课程列表、选中态、下载进度（queueMicrotask 微任务批处理）、云盘信息、并发数、云盘连接状态。`persist` 中间件持久化用户偏好（主题、下载目录）。`useEffectiveProgress` 聚合 both 模式本地+云端进度；`useDownloadStats` 编码统计为单个数字避免级联重渲染 |
| 渲染端 | `hooks/useSharedBrowserHooks.ts` | Browser 与 CanvasBrowser 共享的 hooks：`useCachedCloudTokenValidation`（启动时验证缓存 token）、`useCloudConnection`（云盘连接/断开、状态管理，状态存 zustand 跨 tab 共享）、`useDownloadProgressSubscription`（App 级进度订阅）、`useDownloadCompletion`（选中任务全部终态后自动停止下载状态，弹出系统通知汇报成功/失败数量） |
| 渲染端 | `pages/Browser.tsx` | v.sjtu 旁听课程页：自动扫描、双视角卡片、全选/单选、下载控制、实时进度（memo + useShallow 优化、tasksKey 稳定化避免不必要重算） |
| 渲染端 | `pages/CanvasBrowser.tsx` | Canvas 课程页：学期筛选、分类选择（课件/教师/PPT）、串行课程处理（扫描→下载→等待→清理→下一门）、内存优化 |
| 渲染端 | `components/DownloadUI.tsx` | 下载 UI 原子组件：进度条（EMA 速度）、三态复选框、全局/单任务控制按钮、下载模式选择器、同名文件冲突策略选择器（跳过/替换） |
| 渲染端 | `components/Segmented.tsx` | 统一的「玻璃滑动指示器」分段选择器，Tab 导航、下载模式、主题切换共用 |
| 渲染端 | `components/TitleBar.tsx` | 自定义标题栏：并发滑块、自动并发 AIMD 按钮、主题切换、登出、帮助弹窗 |

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

## 更新日志

### v1.1.0 — Canvas 修复与下载增强

#### Canvas 文件下载修复

- **Canvas 文件直链解析** — 修复 Canvas 课件下载后无法打开的问题（根因：`node:https` 绕过 Chromium 网络栈后无法携带 Canvas 会话 Cookie，302 到登录页 HTML 被存为课件文件）。实现方案：下载前从 Electron session 提取 `oc.sjtu.edu.cn` 的 Cookie（含 HttpOnly），注入 `node:https` 请求头，仅在 Canvas 站点这一跳携带；跟随 302 到 S3 预签名直链后不带 Cookie，避免泄漏给第三方域
- **Canvas 端点 429/403 限流重试** — 高并发下载时 Canvas 偶发返回 429 或 403，系统读取 `Retry-After` 响应头并做指数退避重试（最多 4 次）；S3 的 403（签名/权限，永久错误）不重试

#### 同名文件冲突策略

- **跳过 / 替换** — 新增同名文件冲突策略选项，与本地/云盘/两者三种保存模式正交
  - **跳过**（默认）：目标文件已存在则跳过，保留旧文件
  - **替换**：本地下载先删除旧文件再重新下载；云盘上传先将远端同名文件移入回收站再上传
- **Canvas 视频覆盖** — 课堂视频、模块视频、讲次下载均支持冲突策略，替换模式不再预先跳过同名文件

#### 暂停/取消响应性

- **COS 上传立即中止** — 新增 `ChunkedUploader.abort()` 方法，暂停或取消时立即销毁在途的 COS PUT 请求，不再出现「暂停后后台仍继续上传」的问题
- **cloudRunTask 启动期状态检查** — 在 `resolveDirectUrl` / `deleteCloudFile` 的 await 窗口显式检查暂停/取消状态，避免暂停后仍建立 CDN + COS 会话

#### 系统通知

- **下载完成通知** — 每批次任务全部完成后弹出系统通知，汇报成功/失败数量（如「全部 23 项完成」或「成功 20 项，失败 3 项」），点击通知聚焦主窗口；每批次仅通知一次，全部取消不打扰

---

### v1.0.1 — 性能优化与稳定性改进

#### 性能优化

- **自动并发控制（AIMD）** — 新增自动并发模式，基于加性增乘性减算法，配合吞吐增益反馈和自适应评估周期（1-4s），自动探测最优并发数，无需手动调整
- **惰性任务物化** — 下载任务不再一次性全部创建 TaskRuntime，改为临下载时才从 pending 队列取出 spec 建立运行时对象，内存占用从 O(n) 降至 O(并发数)
- **O(1) 重复检测** — 用 index Set 替代 pending/paused 队列的 `.some()` 扫描，3000+ 任务批量入队从 O(n^2) 降至 O(n)
- **IPC 进度批处理** — 主进程侧用 `setImmediate` 合并同一事件循环轮次内的多条进度更新为一次 IPC send；渲染端 `applyProgress` 使用 `queueMicrotask` 合并为一次 store.set()，双重批处理减少重渲染
- **Auth 结果缓存** — `isLoggedIn()` 结果缓存 5 分钟，避免短时间内重复网络验证（如快速重启）
- **HTTPS keep-alive** — HLS segment 下载和本地文件下载复用 TLS 连接，减少握手开销
- **Buffer 优化** — 下载引擎使用 chunk 收集 + 按需 concat 替代逐 chunk 拼接，避免 O(n^2) 内存拷贝
- **tasksKey 稳定化** — Browser.tsx 的 `allTasks` 用 `courseId:length` 对作为 key，仅在任务数组长度变化时触发重算
- **React 渲染优化** — 大量子组件使用 `memo` + `useShallow` 批量 selector，避免无关状态变化导致的级联重渲染
- **进度统计编码** — `useDownloadStats` 将 done/failed/active 计数编码为单个数值返回，仅当计数真正变化时才触发重渲染
- **both 模式进度聚合** — `useEffectiveProgress` 精准订阅 local + cloud 两个独立引用，避免全量 progress map 订阅
- **Canvas 课程串行处理** — 扫描→下载→等待完成→释放内存→下一门，避免同时持有所有课程的文件数据
- **Canvas 课程扫描并行化** — 模块页面 body 批量获取使用并发限制（concurrency limit），课程级 API 调用并行化
- **事件驱动并发槽位等待** — HLS 下载的并发槽位等待从 2 秒轮询改为 Promise 事件通知（~10ms 延迟 vs 最高 2s）
- **vodChannelsCache 上界** — 视频通道缓存增加 500 条目上限，超出时按插入序淘汰最旧条目，防止内存无限增长

#### 安全改进

- **IPC 输入验证** — `download:start` IPC handler 验证 specs 为非空数组、5000 条上限、每条含 taskId/fileName
- **云盘 token 不经 renderer** — `validateToken()` 和 `spaceInfo()` 不再从 renderer 接收 token 参数，main 进程使用内部缓存的 USER_TOKEN
- **webview 导航限制** — Login.tsx 的 webview 仅允许导航到 `sjtu.edu.cn`、`jaccount.sjtu.edu.cn`、`oc.sjtu.edu.cn`，防止导航劫持
- **sandbox: false 文档** — 主窗口 `sandbox: false` 的原因（webviewTag 需要）已在代码中注释说明
- **uncaughtException 安全退出** — 未捕获异常处理器在记录日志后调用 `cleanupOnQuit()` + `app.quit()`，不再静默吞错
- **setWindowOpenHandler 全局应用** — `web-contents-created` 事件为所有 webview 注入窗口打开拦截，重定向到 `shell.openExternal`

#### 稳定性修复

- **非 200 响应体 error handler** — 补上 downloadStream 和 cloudDownloadAndUpload 中 non-200 响应流的 error 事件监听，防止未处理的 error 事件导致进程崩溃
- **Race guard** — App.tsx 启动检查登录态、Browser/CanvasBrowser 云盘 token 验证均添加 cancelled flag，防止组件卸载后 state 更新
- **Canvas 视频通道缓存** — 同一 videoId 的教师+PPT 两路流共享解析结果（TTL 5 分钟），避免重复 API 调用
- **终态任务即时清理** — done/skipped/cancelled/error 任务立即释放句柄并从 Map 中移除，不再延迟 8 秒占内存
- **noteNetworkRecovery 位置修正** — 网络恢复通知仅在 CDN 成功响应时触发，不再在重试路径中提前调用
- **skipWhenEmpty 参数** — `useDownloadCompletion` 新增 `skipWhenEmpty` 参数，避免选中任务为空时误判下载完成
- **云端凭证 renew 双重 400 错误信息** — COS 分片上传凭证 renew 连续两次返回 400 时抛出明确错误提示
- **m3u8 URL 匹配修正** — HLS 下载的 m3u8 识别使用 `.m3u8(\?|#|$)` 正则，排除 `.m3u8.key` 文件
- **CDN 200 回退路径清理** — 使用 `resp.removeAllListeners()` 清理 stale 响应监听器，避免内存泄漏
- **fetchFileMeta 异常传播** — Canvas 文件元数据查询不再静默吞错，异常正确传播到调用方
- **共享 hooks 抽取** — `useSharedBrowserHooks.ts` 封装云盘连接、token 验证、进度订阅、完成检测等跨页面共享逻辑；云盘连接状态迁移至 zustand store 跨 tab 共享
- **进度订阅提升至 App 级** — `useDownloadProgressSubscription` 在 App.tsx 调用一次，而非各页面重复订阅
- **dead 参数清理** — `CanvasEmitter` 类型移除未使用的 `scalar` 参数，`mainWindowRef` 标记为 `@deprecated`

#### 新增功能

- **自动并发模式 UI** — 标题栏新增「自动」按钮和并发数实时显示，帮助弹窗说明各并发档位适用场景
- **Segmented 组件** — 统一的「玻璃滑动指示器」分段选择器，Tab 导航、下载模式、主题切换共用同一组件

---

## 许可

[MIT](./LICENSE)
