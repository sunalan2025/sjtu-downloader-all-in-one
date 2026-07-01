# SJTU 课程下载器

[![stars](https://img.shields.io/github/stars/sunalan2025/sjtu-downloader-all-in-one?style=social)](https://github.com/sunalan2025/sjtu-downloader-all-in-one)
[![release](https://img.shields.io/github/v/release/sunalan2025/sjtu-downloader-all-in-one?display_name=tag&include_prereleases)](https://github.com/sunalan2025/sjtu-downloader-all-in-one/releases)
[![license](https://img.shields.io/github/license/sunalan2025/sjtu-downloader-all-in-one)](./LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](#获取方式)

> ⭐ **如果这个工具帮到了你，欢迎点右上角的 Star 支持一下！** 这能让更多 SJTU 同学搜到它，也激励我持续更新。

批量下载 [v.sjtu.edu.cn](https://v.sjtu.edu.cn) 旁听课程、[Canvas (oc.sjtu.edu.cn)](https://oc.sjtu.edu.cn) 课程资源和[好大学在线 (cnmooc.sjtu.cn)](https://cnmooc.sjtu.cn) 课程视频与课件的桌面工具。支持本地下载和直传交大云盘（pan.sjtu.edu.cn）。

> **网络要求** — 需要连接 SJTU 校园网或使用交大 VPN 才能正常访问视频资源和下载。

> **免责声明** — 本工具仅供下载**自己有权访问**的课程资源用于个人学习。请勿传播、转售下载内容，亦不得用于任何商业用途。下载内容的版权归课程权利方所有，使用者需自行承担相关责任。

---

## 功能特性

### 登录与认证

- **jAccount 扫码登录** — 内嵌官方登录页面，使用「交我办」或微信扫码即可完成认证
- **登录态持久化** — session 保存在本地，关闭应用后重新打开无需重新登录
- **三大来源共享会话** — v.sjtu、Canvas、好大学在线复用同一 jAccount 登录态，一次扫码全通
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
- **PPT 课件下载** — 将课堂视频中的 PPT 幻灯片截图下载并合并为单个 PDF 文件，与视频保存在同一目录
- **单元视频下载** — 下载 Canvas「单元」tab 里嵌入的视频（HLS 网页嵌入 / v.sjtu / vshare 三类来源）
- **教师筛选** — 多教师课程可按教师筛选

#### 好大学在线（cnmooc.sjtu.cn）

- **自动拉取课程列表** — 登录后自动获取正在学习的好大学在线课程
- **按章节结构组织** — 解析课程章节树，按章节折叠展示视频与课件条目
- **资源类型筛选** — 一键切换「全部 / 仅视频 / 仅课件」，下载前过滤
- **懒解析直链** — 扫描只解析章节 HTML，下载时才解析视频 / 课件直链，启动快

### 下载模式

三种模式，三大来源通用：

| 模式 | 说明 |
|------|------|
| **本地** | 文件下载到本地磁盘，按课程自动归档 |
| **云盘** | 边下载边上传到交大云盘，不占本地空间 |
| **两者** | 同时下载到本地和上传到云盘，一份带宽双重备份 |

### 下载控制

- **并发调节** — 支持 2-16 路并发手动设置，也支持**自动并发**模式
- **断点续传** — 下载中断后重新开始自动从断点处继续，无需从头下载
- **智能跳过或替换** — 本地/云盘已存在的同名文件可选择「跳过」（保留旧文件）或「替换」（删除旧文件后重新下载/上传）
- **暂停 / 恢复 / 取消** — 每个任务独立控制，也可一键操作全部任务；暂停时立即中止在途网络请求，不会出现「暂停后还在上传」的情况
- **实时进度** — 显示下载百分比、速度、已下载/总大小
- **完成通知** — 批次全部完成后弹出系统通知，汇报成功 / 失败数量，点击聚焦主窗口

> 自动并发（AIMD 算法）、懒解析、内存优化、IPC 批处理等底层机制见文末[「机制原理」](#机制原理)章节。

---

## 获取方式

### 方式一：下载安装包（推荐）

前往 Releases 页面，下载对应平台的安装包：

| 平台 | 文件格式 | 说明 |
|------|---------|------|
| Windows | `.exe` / `.msi` | NSIS 安装程序（支持自定义路径）或 MSI 安装包（企业部署友好） |
| macOS | `.dmg` / `.zip` | DMG 拖拽安装，或 ZIP 解压即用 |
| Linux | `.AppImage` | 无需安装，添加执行权限后直接运行 |

<details>
<summary><b>⚠️ 关于杀毒软件 / Windows SmartScreen 误报（必读）</b></summary>

本工具是**开源**的，源代码完全公开在 GitHub 上，不包含任何恶意代码。但下载安装时你可能会遇到以下情况，这是**未签名个人软件的通病，不是真有病毒**：

**原因**：本工具没有购买商业代码签名证书（个人项目无法承担每年数百美元的费用），且 Electron 应用 + 网络下载行为容易被杀软启发式引擎误判。`.exe` 和 `.msi` 受同等影响，换格式不会改变。

**如何放行**：

- **Windows SmartScreen 拦截**（"Windows 已保护你的电脑"）→ 点击 `更多信息` → `仍要运行`
- **Microsoft Defender / 360 / 火绒等报毒** → 将安装包和安装目录加入信任区/白名单后运行
- **浏览器拦截下载**（"此文件可能有害"）→ 选择 `保留` / `仍然下载`

**验证安全性**：你可以自行从源码构建（见下方「方式二」），或在 [virustotal.com](https://www.virustotal.com) 上传安装包查看多引擎扫描结果。随着下载量积累和声誉建立，误报会逐渐减少。

</details>

> 💡 安装包已内置 ffmpeg（各平台对应二进制），Canvas「单元视频」中的网页嵌入视频（HLS）会自动无损转封装为 MP4，可选重编码修复花屏，**无需用户另装 ffmpeg**。如需改用系统 PATH 中的 ffmpeg，可设置环境变量 `FFMPEG_BIN` 指向其路径。

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

登录后可通过顶部标签切换三个课程来源：

- **v.sjtu 旁听** — 自动扫描旁听课程，每节课提供教师 + PPT 双视角
- **Canvas** — 自动拉取 Canvas 课程列表，支持课件文件、课堂视频、单元视频、PPT 课件
- **好大学在线** — 自动拉取好大学在线课程，按章节结构展示视频与课件，可按类型筛选

> 每个来源页顶部都有「刷新」键：重新校验登录态并完整重载课程列表。登录态失效时会自动跳转登录页，扫码成功后回到该页自动重新加载。

### 第三步：选择课程和内容

#### v.sjtu 旁听课程

- 点击课程名旁的复选框，全选 / 取消该课程的所有视频
- 点击「教师」或「PPT」按钮，按视角批量选择
- 逐个勾选需要下载的课时和视角

#### Canvas 课程

- 点击课程名旁的复选框，全选 / 取消该课程所有内容
- 顶部分类按钮可按类型批量选择：**课件**、**视频-教师**、**视频-PPT**、**单元视频**、**PPT课件**
- 展开课程卡片可查看课件文件列表、课堂视频列表和单元视频列表
- 课件文件默认已扫描；课堂视频需点击「扫描课堂视频」触发，单元视频需点击「扫描单元视频」触发
- 课堂视频每讲右侧有「📄PPT」按钮，可将该讲的 PPT 幻灯片截图下载为 PDF；也可点击「下载全部PPT」批量下载所有讲次
- PPT PDF 与课堂视频保存在同一目录下（`videos/课堂视频/`）
- 支持按学期筛选课程

#### 好大学在线

- 点击章节标题旁的复选框，全选 / 取消该章节所有条目
- 顶部「资源类型」切换「全部 / 仅视频 / 仅课件」，按需过滤
- 逐个勾选需要下载的视频或课件条目

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

**本地模式**：文件保存在你选择的下载目录下（旁听课程在 `SJTU旁听课程/`，Canvas 在 `Canvas课程/`，好大学在线在 `好大学在线/`）。

**云盘模式**：文件上传到交大云盘（旁听课程在 `SJTU旁听课程/`，Canvas 在 `SJTU Canvas课程/`，好大学在线在 `SJTU好大学在线/`），可在 [pan.sjtu.edu.cn](https://pan.sjtu.edu.cn) 访问。

---

## 下载状态说明

| 状态 | 含义 |
|------|------|
| 等待中 | 已加入下载队列，等待空闲并发槽 |
| 解析直链… | 正在从 v.sjtu / 好大学在线获取视频的 CDN 直链（懒解析：下载前按需调用） |
| 获取文件链接… | 正在从 Canvas API 获取文件签名 URL |
| 解析视频流… | 正在解析 Canvas 课堂视频的多路流地址（同 videoId 自动缓存） |
| 下载中 | 正在下载/上传，显示进度百分比和速度 |
| 已暂停 | 暂停中，恢复后从断点续传（云端任务保留 COS 分片会话） |
| 完成 | 下载/上传成功 |
| 已存在 | 本地/云盘已有同名文件，自动跳过（可在冲突策略中选择「替换」模式） |
| 失败 | 下载/上传出错，可点击重试 |
| 已取消 | 被手动取消 |

---

## 机制原理

> 以下为下载引擎、文件落盘、安全模型的实现细节，普通用户可跳过。需要了解内部机制或二次开发时参考。

### 文件命名规则

#### 文件名清洗

所有文件名和文件夹名在写入磁盘或上传云盘前都会经过清洗：

- Windows 非法字符 `<>:"/\|?*` 和控制字符（0x00-0x1f）替换为 `_`
- 去除末尾的 `.` 和空格
- 长度限制 180 字符
- 空名称回退为 `未命名`

#### 本地保存路径

假设用户选择 `D:\Downloads` 作为下载目录：

```
D:\Downloads/
├── SJTU旁听课程/                          ← v.sjtu 旁听课程
│   └── 2024-2025-1/                       ← 学期文件夹
│       ├── 课程A-张老师/
│       │   ├── 第1讲-教师.mp4
│       │   ├── 第1讲-PPT.mp4
│       │   ├── 第2讲-教师.mp4
│       │   └── ...
│       └── 课程B-李老师/
│           └── ...
│
├── Canvas课程/                             ← Canvas 课程
│   └── 2024-2025-2/                       ← 学期文件夹
│       ├── 课程C-王老师/
│       │   ├── files/                      ← 课件文件（按 Canvas 真实文件夹层级）
│       │   │   ├── 第1章/
│       │   │   │   ├── 讲义.pdf
│       │   │   │   └── 习题.pdf
│       │   │   ├── 第2章/
│       │   │   │   └── ...
│       │   │   └── 大纲/                    ← 大纲正文引用的文件（对应「大纲」tab）
│       │   │       └── 课程大纲.pdf
│       │   └── videos/                     ← 视频文件
│       │       ├── 课堂视频/                ← 来自「课堂视频new」tab
│       │       │   ├── 2025-09-16_08-00-王老师-教学楼101-教师.mp4
│       │       │   ├── 2025-09-16_08-00-王老师-教学楼101-PPT.mp4
│       │       │   └── 2025-09-16_08-00-王老师-教学楼101-PPT课件.pdf  ← PPT 课件 PDF
│       │       └── 单元视频/                ← 来自「单元」tab
│       │           └── 课程C-第3讲录播.mp4
│       └── 课程D-赵老师/
│           └── ...
│
└── 好大学在线/                             ← 好大学在线课程
    └── 课程名/
        └── 第一章 章节标题/
            ├── 1.1 视频条目.mp4
            └── 1.2 课件条目.pdf
```

#### 云端保存路径（交大云盘）

```
交大云盘/
├── SJTU旁听课程/                           ← v.sjtu 旁听课程
│   └── 2024-2025-1/                       ← 学期文件夹
│       ├── 课程A-张老师/
│       │   ├── 第1讲-教师.mp4
│       │   └── ...
│       └── ...
│
├── SJTU Canvas课程/                        ← Canvas 课程（独立根目录）
│   └── 2024-2025-2/                       ← 学期文件夹
│       ├── 课程C-王老师/
│       │   ├── files/
│       │   │   └── ...
│       │   └── videos/
│       │       ├── 课堂视频/
│       │       │   └── ...
│       │       └── 单元视频/
│       │           └── ...
│       └── ...
│
└── SJTU好大学在线/                         ← 好大学在线课程（独立根目录）
    └── 课程名/
        └── 第一章 章节标题/
            └── ...
```

#### 各类型文件命名详情

##### 文件夹名（学期 + 课程名）

| 层级 | 格式 | 示例 |
|------|------|------|
| 学期文件夹 | `{学期}` | `2024-2025-1`、`2024-2025学年第2学期` |
| 课程文件夹 | `{课程名}-{教师}` | `课程A-张老师`、`课程C-王老师/赵老师` |
| 好大学在线课程文件夹 | `{课程名}` | `数据结构` |
| 好大学在线章节文件夹 | `{章节标题}` | `第一章 绪论` |

- 学期取自课程 API 的 `term` / `acteTerm` 字段，无学期信息时不创建学期文件夹
- Canvas 教师名优先取课堂视频扫描结果，未扫描时回退到课程 API 的注册教师
- 多教师用 `/` 连接（如 `王老师/赵老师`）
- 好大学在线不区分学期，按「课程名 / 章节」两级组织

##### 文件名

| 来源 | 格式 | 示例 |
|------|------|------|
| v.sjtu 视频 | `第{N}讲-{视角}.mp4` | `第1讲-教师.mp4`、`第3讲-PPT.mp4` |
| Canvas 课件 | `{原始文件名}` | `lecture_notes_week1.pdf`、`homework3.docx` |
| Canvas 课堂视频 | `{日期}_{时间}-{教师}-{教室}-{视角}.mp4` | `2025-09-16_08-00-王老师-教学楼101-教师.mp4` |
| Canvas PPT 课件 | `{日期}_{时间}-{教师}-{教室}-PPT课件.pdf` | `2025-09-16_08-00-王老师-教学楼101-PPT课件.pdf` |
| Canvas 单元视频 | `{课程名}-{条目标题}.mp4` | `课程C-第3讲录播.mp4` |
| 好大学在线资源 | `{条目标题}.{扩展名}` | `1.1 数组定义.mp4`、`1.2 习题.pdf` |

- v.sjtu 的 `N` 是按上课时间排序后的稳定序号（非原始课次编号）
- Canvas 课堂视频的日期时间格式：原始 `2025-09-16 08:00:00` → `2025-09-16_08-00`（冒号替换为 `-`，空格替换为 `_`，秒数去掉）
- Canvas 课堂视频视角标签：`教师`（讲台画面）、`PPT`（板书画面），多路流时为 `路1`、`路2`...
- 好大学在线资源扩展名由下载时懒解析的直链推断（扫描阶段文件名无扩展名）

##### 临时文件

| 文件 | 说明 |
|------|------|
| `{文件名}.part` | 下载过程中的临时文件，用于断点续传，完成后自动删除 |
| `{文件名}.ts` | HLS 单元视频下载时的临时 TS 文件，合并为 MP4 后自动删除 |

##### Canvas 文件夹层级

Canvas 课程文件保留 Canvas 上的文件夹结构：

| 类型 | 路径前缀 | 说明 |
|------|---------|------|
| 课程文件 | `files/` 或真实子目录 | 按 Canvas 文件夹层级组织；模块里引用的文件若不在文件列表则按其真实 Canvas 文件夹落盘 |
| 大纲补漏 | `files/大纲/` | 大纲正文引用、但「文件」tab 看不到的文件，对应浏览器「大纲」tab |
| 课堂视频 | `videos/课堂视频/` | 来自「课堂视频new」tab，按讲次平铺 |
| PPT 课件 | `videos/课堂视频/` | 来自「课堂视频new」tab 的 PPT 截图，与视频同目录 |
| 单元视频 | `videos/单元视频/` | 来自「单元」tab（HLS 网页嵌入 / v.sjtu / vshare 三类来源） |

### 下载引擎机制

- **双模式 AIMD 自适应并发** — 以 RTT（请求→首字节/上传耗时）、任务错误率、系统内存占用、磁盘写入吞吐、429 限流五项指标闭环；快降慢升（资源超限×0.7 / 重度拥塞×0.6 / 轻度拥塞×0.8 / 连续2周期良好+1），硬边界 2–16，调整间隔 ≥3s。定时器兜底 + 任务完成事件驱动
- **惰性任务物化** — `download:start` 将 spec 存入 pending 队列，调度器临下载时才创建 `TaskRuntime`，内存 O(并发数)
- **O(1) 去重** — `pendingLocalIds` / `pausedLocalIds` 等 Set 提供 O(1) 重复检测
- **懒解析直链** — Canvas / 好大学在线视频直链在下载前按需解析（而非全量预解析），降低启动延迟和 API 调用量；暂停 / 出错重试时清空 url 重新解析，防直链过期
- **网络健康监测** — `noteNetworkError` / `noteNetworkRecovery` 驱动 AIMD 降/升并发；网络频繁出错时自动暂停调度，退避后恢复
- **事件驱动并发槽位** — HLS 下载等待并发槽位使用 Promise 事件通知（`notifyConcurrencySlotAvailable`），延迟从最高 2 秒降至约 10ms，非轮询
- **内存优化** — 终态任务立即清理、Canvas 课程串行处理避免大数据集同时驻留内存、vodChannelsCache 上界 500 条目 LRU 淘汰
- **IPC 进度批处理** — 主进程 `setImmediate` + 渲染端 `queueMicrotask` 双重合并，合并同一事件循环轮次内的多条进度更新
- **裸 node:https 下载** — 下载引擎用 `node:https` 绕开 Chromium 网络栈（后者对跨域 CDN 请求 BLOCKED_BY_CLIENT），手动跟随 302 重定向，支持 Range 续传与写流 backpressure
- **Canvas 文件直链解析** — 下载前从 Electron session 提取 `oc.sjtu.edu.cn` 的 Cookie（含 HttpOnly），注入 `node:https` 请求头，仅在 Canvas 站点这一跳携带；跟随 302 到 S3 预签名直链后不带 Cookie，避免泄漏给第三方域
- **Canvas 端点限流重试** — 高并发下 Canvas `/files/{id}/download` 偶发 429/403，本地与云盘两条 `fetchOnce` 对该跳做指数退避重试（最多 4 次，读 `Retry-After`）；S3 的 403（签名/权限，永久错误）不重试
- **COS 上传 abort** — `ChunkedUploader.abort()` 暴露在途 `ClientRequest`，pause/cancel 时立即中止分片 PUT，不会出现「暂停后还在传」
- **实时传输速度** — 主进程 1s 推送 `transfer:speed`（下行/上行 bytes/s，EMA 平滑）

### 安全模型

- **contextIsolation: true, nodeIntegration: false** — 所有 BrowserWindow 均启用上下文隔离，禁止渲染端访问 Node.js API
- **CSP 内容安全策略** — `index.html` 中配置严格 CSP，`default-src 'self'`，`connect-src` 限制到已知 SJTU 域名
- **webview 导航白名单** — 登录页 webview 仅允许导航到 `sjtu.edu.cn`、`jaccount.sjtu.edu.cn`、`oc.sjtu.edu.cn`，防止导航劫持
- **窗口打开拦截** — `setWindowOpenHandler` 拦截所有新窗口请求，重定向到系统默认浏览器；`web-contents-created` 全局注入
- **IPC 输入验证** — `download:start` 等 IPC handler 对输入参数进行类型和边界校验（非空数组、5000 条上限、每条含 taskId/fileName）
- **token 不经 IPC** — 云盘 `validateToken()` / `spaceInfo()` 不从 renderer 接收 token，main 进程使用内部缓存；jAccount JWT token 仅保存在内存中，进程退出即丢弃

### 登录与会话

- v.sjtu 登录态保存在本地 Electron session（`persist:sjtu`）中，关闭应用后重新打开如仍有效则无需重新登录
- Canvas、好大学在线复用同一 `persist:sjtu` session（共享 jAccount 认证）；好大学在线 SSO 用隐藏 BrowserWindow 自动完成，首次 / cookie 失效时弹可见窗口兜底
- 交大云盘 UserToken 持久化到 localStorage，下次启动可直接使用；main 进程使用内部缓存，不通过 IPC 传输 token

### 云盘上传机制

- 云盘上传采用 4MB 分片直传腾讯 COS，边下载边上传，内存占用恒定
- 上传支持断点续传：`UploadSessionState` 记录已传分片，暂停后恢复跳过已传部分
- 暂停或取消时立即中止在途的 COS 分片上传请求（`ChunkedUploader.abort()`），不会出现「点了暂停还在传」的情况
- 同名文件可选择跳过或替换（`deleteCloudFile` 将远端文件移入回收站，404 幂等），在冲突策略中切换
- 云盘空间信息可在操作栏实时查看

### 磁盘空间

- 本地下载时，视频体积较大（单个可达数百 MB 至数 GB），请确保目标磁盘有足够空间
- 下载过程中的临时文件以 `.part` 后缀保存，用于支持断点续传
- 下载完成后 `.part` 文件会被自动删除；也可手动安全删除，不影响已下载的文件

### 网络与重试

- **必须连接 SJTU 校园网或使用交大 VPN**，否则无法访问 v.sjtu.edu.cn、oc.sjtu.edu.cn、cnmooc.sjtu.cn 的资源
- 部分视频通过 CDN 分发，在校外可能可以下载，但不保证全部可用
- 下载使用 Node.js 原生 HTTP 请求，绕过 Chromium 网络栈，避免跨域限制；Canvas 文件下载通过会话 Cookie 注入实现直链解析，确保文件完整性
- 网络错误（socket hang up、超时、DNS 解析失败等）会自动指数退避重试（最多 3 次），无需手动操作
- Canvas 端点在高并发下偶发 429/403 限流，系统自动读取 `Retry-After` 并做指数退避重试（最多 4 次），无需手动干预
- HLS segment 下载同样支持自动重试，m3u8 解析过程也有重试机制

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
| [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) | 内置 ffmpeg 静态二进制（各平台安装包自带，无需用户另装）：HLS TS → MP4 无损 remux + 可选重编码（Canvas 单元视频） |
| [pdf-lib](https://pdf-lib.js.org/) | PPT 截图合并为 PDF（Canvas 课堂视频配套） |
| [cheerio](https://cheerio.js.org/) | 好大学在线章节 HTML 解析 |

---

## 项目结构

```
src/
├── main/
│   ├── index.ts                  # 主进程：窗口管理、下载引擎、云盘上传引擎、自动并发控制、IPC 进度批处理
│   ├── cloudpan.ts               # 交大云盘 API：认证、文件夹创建与缓存、分片上传（含断点续传、凭证 renew 重试）、文件删除（移入回收站）
│   ├── canvas/
│   │   ├── api.ts                # Canvas REST API 封装（自动翻页、文件夹树、模块/大纲解析、文件元数据查询）
│   │   ├── orchestrator.ts       # Canvas IPC handler 注册（课程扫描、文件下载、视频下载、OIDC SSO、事件驱动并发槽位等待、PPT 下载）
│   │   ├── video-tokens.ts       # Canvas 课堂视频 LTI token 获取、vod API 调用、视频通道缓存（TTL + 上界 500）
│   │   ├── hls-download.ts       # Canvas 单元视频的 m3u8 捕获、HLS 下载、ffmpeg remux + 可选重编码、云盘上传
│   │   ├── ppt-download.ts       # Canvas PPT 课件图片下载 + pdf-lib PDF 合并（与课堂视频同目录）
│   │   └── safe-fetch.ts         # safeFetch 封装：429 限流指数退避 + 网络错误重试
│   ├── cnmooc/
│   │   ├── api.ts                # 好大学在线 REST API + cheerio HTML 解析（课程列表、章节树、会话校验）
│   │   └── orchestrator.ts       # 好大学在线 IPC 编排 + jAccount SSO + build-specs（占位 url，下载时懒解析）
│   └── cloudpan.ts               # 交大云盘 API
├── preload/
│   └── index.ts                  # IPC 桥接：通过 contextBridge 安全暴露主进程 API 给渲染端
├── shared/
│   └── types.ts                  # 跨层共享的 TypeScript 类型定义（API 响应、业务模型、下载规格、Canvas/cnmooc 类型）
└── renderer/
    ├── index.html                # HTML 模板（含 CSP 配置：限制 connect-src 到 SJTU 域名）
    └── src/
        ├── main.tsx              # React 入口
        ├── App.tsx               # 根组件：按 stage 切换页面 + 顶部 Tab 导航 + App 级进度订阅
        ├── index.css             # Tailwind CSS 入口 + 自定义样式（动画、玻璃效果、自定义滚动条）
        ├── store/
        │   └── app.ts            # Zustand 全局状态（含 persist 持久化用户偏好、进度微任务批处理、both 模式聚合）
        ├── hooks/
        │   └── useSharedBrowserHooks.ts  # Browser / CanvasBrowser / CnmoocBrowser 共享的 hooks（云盘连接、token 验证、进度订阅、完成检测）
        ├── components/
        │   ├── TitleBar.tsx      # 自定义标题栏（并发控制、自动并发 AIMD、帮助弹窗、主题切换、登出）
        │   ├── Spinner.tsx       # 加载动画组件
        │   ├── Segmented.tsx     # 统一的「玻璃滑动指示器」分段选择器（Tab/模式/主题复用）
        │   └── DownloadUI.tsx    # 下载 UI 原子组件（进度条 EMA 速度、三态复选框、控制按钮、模式选择器、同名文件冲突策略选择器）
        └── pages/
            ├── Welcome.tsx       # 欢迎页：功能介绍 + 登录入口
            ├── Login.tsx         # 登录页：内嵌 jAccount 扫码 webview（含域名白名单导航限制）
            ├── Browser.tsx       # v.sjtu 旁听课程页：课程列表、双视角卡片、选择、下载、实时进度
            ├── CanvasBrowser.tsx # Canvas 课程页：学期筛选、分类选择、课件/视频下载、串行课程处理、PPT 课件 PDF 下载
            └── CnmoocBrowser.tsx # 好大学在线页：章节折叠、资源类型筛选、懒解析下载
```

### 数据流

```
用户操作 → Browser.tsx / CanvasBrowser.tsx / CnmoocBrowser.tsx
         → window.api.xxx (通过 useSharedBrowserHooks 调用)
         → preload IPC (contextBridge 安全桥)
         → main/index.ts 或 main/canvas/orchestrator.ts 或 main/cnmooc/orchestrator.ts
         → v.sjtu API / Canvas API / 好大学在线 API / 云盘 API
                                    ↓
各页面 ← applyProgress ← ipcRenderer.on ← emitProgress (setImmediate 批处理)
                                    ↓
               useDownloadStats / useEffectiveProgress ← Zustand selector 聚合（编码-数字技巧避免级联重渲染）
```

### 各层职责

| 层 | 关键文件 | 职责 |
|----|---------|------|
| 主进程 | `main/index.ts` | 窗口管理、jAccount 登录验证（含 5 分钟结果缓存）、v.sjtu API 调用、本地下载引擎（惰性任务物化、任务队列、并发调度、HTTP 流式下载、断点续传、自动重试、HTTPS keep-alive、Canvas Cookie 注入直链解析、Canvas 429/403 限流退避重试）、云盘上传引擎（CDN→COS 边下载边分片上传、凭证 renew 重试、COS PUT 中止、覆盖模式远端删除）、自动并发控制（AIMD + 吞吐增益反馈 + 自适应周期 + 瓶颈冷却）、网络健康监测、IPC 进度批处理（setImmediate 合并）、系统通知（下载完成弹窗）、uncaughtException 安全退出 |
| 主进程 | `main/cloudpan.ts` | 交大云盘 API 封装：UserToken 验证、空间凭证获取与缓存、文件夹逐级创建（路径缓存避免重复 PUT）、COS 分片上传（含 renew 凭证、单次重试、断点续传会话状态）、文件存在性检查、文件删除（移入回收站，供替换策略使用）、`ChunkedUploader.abort()` 中止在途 PUT |
| 主进程 | `main/canvas/` | Canvas 课程相关：REST API 封装（自动翻页、并发模块页面批量获取）、OIDC SSO 登录、文件/视频扫描、LTI token 提取、vod 视频通道缓存（TTL 5 分钟 + 上界 500 条目淘汰）、HLS m3u8 捕获与 ffmpeg remux + 可选重编码、事件驱动并发槽位等待、PPT 课件图片下载与 PDF 合成（pdf-lib） |
| 主进程 | `main/cnmooc/` | 好大学在线课程相关：REST API + cheerio HTML 解析（课程列表、章节树）、jAccount SSO（复用 persist:sjtu，隐藏窗口自动完成 + 可见窗口兜底）、build-specs 产占位 spec（下载时懒解析 play.mooc / detail.mooc 取直链）、资源类型过滤（video/document/all） |
| 预加载 | `preload/index.ts` | IPC 通信桥（contextBridge.exposeInMainWorld），让渲染端通过 `window.api.xxx` 安全调用主进程功能。云盘 token 验证/空间查询不再接收 renderer 参数，由 main 进程使用内部缓存 |
| 共享层 | `shared/types.ts` | 跨层共享 TypeScript 类型：API 响应结构、课程/视频模型、下载任务规格、进度状态、云盘类型、Canvas 类型、好大学在线类型、vod API 结构 |
| 渲染端 | `store/app.ts` | Zustand 全局状态：登录态、课程列表、选中态、下载进度（queueMicrotask 微任务批处理）、云盘信息、并发数、云盘连接状态。`persist` 中间件持久化用户偏好（主题、下载目录）。`useEffectiveProgress` 聚合 both 模式本地+云端进度；`useDownloadStats` 编码统计为单个数字避免级联重渲染 |
| 渲染端 | `hooks/useSharedBrowserHooks.ts` | Browser / CanvasBrowser / CnmoocBrowser 共享的 hooks：`useCloudConnection`（云盘连接/断开、状态管理，状态存 zustand 跨 tab 共享；连接逻辑委托 `services/prefetch.ts` 的 `prefetchCloudConnection`）、`useDownloadProgressSubscription`（App 级进度订阅）、`useDownloadCompletion`（选中任务全部终态后自动停止下载状态，弹出系统通知汇报成功/失败数量） |
| 渲染端 | `services/prefetch.ts` | 登录后后台预加载：`prefetchCanvasCourses` / `prefetchCnmoocCourses` / `prefetchCloudConnection`，由 App.tsx 在 `stage==='browser'` 时并行触发；各页面 `loadCourses`/`runScan`/`onConnectCloud` 也复用以去重 |
| 渲染端 | `pages/Browser.tsx` | v.sjtu 旁听课程页：自动扫描、双视角卡片、全选/单选、下载控制、实时进度（memo + useShallow 优化、tasksKey 稳定化避免不必要重算）、刷新键（重走扫描，登录失效跳登录页后自动重载） |
| 渲染端 | `pages/CanvasBrowser.tsx` | Canvas 课程页：学期筛选、分类选择（课件/教师/PPT/单元视频/PPT课件）、串行课程处理（扫描→下载→等待→清理→下一门）、内存优化 |
| 渲染端 | `pages/CnmoocBrowser.tsx` | 好大学在线页：章节折叠卡片、资源类型分段（全部/仅视频/仅课件）、懒解析下载、刷新键 |
| 渲染端 | `components/DownloadUI.tsx` | 下载 UI 原子组件：进度条（EMA 速度）、三态复选框、全局/单任务控制按钮、下载模式选择器、同名文件冲突策略选择器（跳过/替换） |
| 渲染端 | `components/Segmented.tsx` | 统一的「玻璃滑动指示器」分段选择器，Tab 导航、下载模式、主题切换共用 |
| 渲染端 | `components/TitleBar.tsx` | 自定义标题栏：并发滑块、自动并发 AIMD 按钮、主题切换、登出、帮助弹窗 |

---

## 开发

### 前置条件

- [Node.js](https://nodejs.org/) >= 18
- npm

> `npm install` 会通过 [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) 的安装脚本从 GitHub Releases 下载对应平台的 ffmpeg 二进制（约 80MB，仅下载到 `node_modules`）。国内若 GitHub 访问慢，可设环境变量 `FFMPEG_BINARIES_URL` 指向镜像，或设 `FFMPEG_BIN` 直接指向本地已有 ffmpeg 跳过下载。

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

打包使用 [electron-builder](https://www.electron.build/)，配置在 `package.json` 的 `build` 字段中。`ffmpeg-static` 作为生产依赖打入 asar 并通过 `asarUnpack` 解包 native 二进制（asar 拼接格式无法在内部 exec native 二进制）。

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
