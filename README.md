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

## 更新日志

### v2.3.2 — 登录后自动预加载 + PPT 课件云盘冲突修复

#### 新功能

- **登录后自动预加载课程 + 自动连接云盘** — 此前 jAccount 扫码登录成功后只进入主界面，Canvas 课程 / 好大学在线课程要逐个切到对应 tab 才开始扫描，云盘也需手动点「连接云盘」按钮。现改为登录后后台并行预加载：Canvas 课程列表、好大学在线课程列表（含章节）、自动连接云盘三者同时进行，用户切到对应 tab 时数据已就绪，云盘已连上可立即用 cloud/both 模式下载。
  - 三个预加载任务各自独立、互不影响（`Promise.allSettled`）。各来源的 SSO（Canvas OIDC / 好大学在线 jAccount / 云盘 SSO）均复用 `persist:sjtu` 中已有的 jAccount 会话 cookie 在隐藏窗口自动完成，**无需额外扫码**。
  - 失败静默不打扰：Canvas / 好大学在线扫描失败置 error 态（切到 tab 可见、可点刷新重试），云盘连接失败置 error 态（页面可见、可点重连）。
  - 登出再登录会重新触发预加载；与默认 tab（v.sjtu 旁听课程）的扫描并行进行，不互相阻塞。
  - 提取 `services/prefetch.ts` 收敛三段预加载逻辑，各页面（`CanvasBrowser.loadCourses` / `CnmoocBrowser.runScan` / 云盘连接按钮）也复用以去重。

#### 修复 / 改进

- **PPT 课件上传云盘前检查重复文件** — 此前选「上传云盘」时，PPT 课件会先下载全部切片图片、用 pdf-lib 合并成 PDF，上传时才发现云盘已有同名文件，纯 cloud 模式下整门课重复下载纯属浪费。现按 skip/overwrite 策略在上传前检查：
  - cloud-only + skip：下载图片前先查云盘是否已有该 PDF，已有则跳过整个下载（不下载图片、不合并 PDF）。
  - overwrite：先删远端同名文件再上传。
  - 本地 PDF 此前直接覆盖不检查冲突，现一并遵守 skip/overwrite（local/both + skip + 本地已存在则跳过下载，both 模式复用本地 PDF 继续上传云端）。
  - 三层检查 + `uploadLocalFileToCloud` 内部的 `FileExistsError` 兜底，覆盖提前检查的竞态空窗。
- **无 PPT 图片的讲次不再显示「失败」** — 部分课程「课堂视频new」下没有 PPT 切片，此前这些讲次被标记为下载失败，完成通知误报「成功 X 失败 Y」。现改为跳过：无 PPT 切片 / 视频无录播流 / 云盘或本地已存在均返回跳过（非失败）。进度与通知区分「成功 / 跳过 / 失败」三种状态，文案显示「成功 X，跳过 Y，失败 Z」（仅非零项）。
- **每次启动彻底销毁所有登录凭证** — 强化既有安全机制：云盘 UserToken 此前被持久化到 localStorage，启动时存在「持久化恢复 → App 清空」的短暂窗口期（属凭证残留）。现把云盘 token 移出持久化，重启天然为空；启动时主进程额外清云盘内存态凭证（`clearCachedCredentials`）。移除已失效的云盘 token 启动恢复 hook（`useCachedCloudTokenValidation`）——不再持久化即成死代码，登录后由自动预加载重新连接接管。每次开 APP 仍必须重新扫码登录，登录后自动重新连云盘。

---

### v2.3.1 — Canvas 课堂视频按角色下载修复

#### 修复

- **只选「视频-教师」或「视频-PPT」却两路都下载** — 此前在 Canvas 课程下载课堂视频时，无论勾选「视频-教师」还是「视频-PPT」，每一讲都会同时下载教师路和 PPT 路两路视频（即未选的一路也会被下载下来）。
  - 根因：main 端 `canvas:download-lectures` handler 对每个讲次固定生成 teacher + ppt 两路下载 spec，未区分用户实际勾选的角色；前端 `processCourse` 也只按讲次粒度过滤，未把「要哪几路」的意图传给主进程。
  - 修复：新增 `CanvasLectureDownloadItem` 类型用可选 `teacher?` / `ppt?` 字段表达角色意图，前端据此构造入参、main 端按实际角色生成 spec（0~2 路）。只勾教师 → 只下教师路；只勾 PPT → 只下 PPT 路；两路都勾 → 与旧行为一致下两路。同时也修正了完成统计（`both` 模式 `cloudLinkedIds` 镜像与进度统计此前会把未勾选的一路也计入）。
  - 仅影响 Canvas 课堂视频（v.sjtu「课堂视频new」），课件文件 / 单元视频 / PPT 课件 PDF 等其他分类不受影响。

---

### v2.3.0 — 应用内自动更新

#### 新功能

- **应用内自动更新** — 此前检测到新版后需手动去 GitHub 下载安装包、手动运行安装，更新过程还会因应用进程占用文件而报「没有 .dll 的访问权限」。本次改为应用内一键自动更新：检测到新版 → 下载安装包 → 静默安装 → 退出旧进程释放文件锁 → 安装器自动启动新版本。
  - 三平台支持：Windows（NSIS 静默 `--updated /S --force-run`）、macOS（zip 解压 + shell 脚本替换 .app）、Linux（AppImage 覆盖 + relaunch）。
  - 标题栏更新徽章状态机：idle（待下载）→ downloading（进度条 + 取消）→ ready（立即安装并重启）→ 失败重试 / 前往下载兜底。
  - 新增开关「以后检测到新版自动下载」（默认关闭），开启后检测到新版即后台下载，下载完停在 ready 等确认安装，不自动重启打断使用。
  - 始终保留「前往下载」兜底：当前平台无匹配安装包（如 arm64 Windows）或自动更新失败时，仍可手动下载。
  - 不引入 electron-updater（未签名 + 国内网络 + 杀软环境下问题多），自研轻量方案，复刻 electron-builder 源码已验证的 NSIS 安装调用。

#### 修复

- **.msi 更新报「没有 .dll 的访问权限」** — 根因是应用关窗最小化到托盘而非退出，进程持续占用安装目录的 `ffmpeg.dll` / `.exe` 等文件，MSI 替换文件时拿不到写句柄。自动更新流程中旧进程在 spawn 安装器后退出释放文件锁，此问题随之解决。（手动跑 .msi 时仍需先彻底退出应用。）

#### ⚠️ 升级须知

- **macOS 自动更新未签名验证** — 项目未签名未公证，mac 自动更新替换 .app 后首次启动仍可能被 Gatekeeper 拦截，必要时右键「打开」放行一次；若持续被拦，可点「前往下载」手动更新。Windows / Linux 路径已验证更稳。

---

### v2.2.3 — 单实例锁 · 禁止应用多开

#### 新功能

- **单实例锁** — 此前可同时打开多个应用实例，多个实例共用同一份 `persist:sjtu` 会话凭证，会出现下载任务冲突、以及新实例启动时 `clearSjtuSession()` 把正在运行的旧实例凭证一并清掉（表现为下载途中突然被强制重新扫码登录）等问题。本次启用 Electron 单实例锁：
  - 已有实例运行时，再次启动会唤起并聚焦已运行实例的主窗口（含最小化到托盘的隐藏态），新启动的进程立即退出，不再开第二个窗口。
  - 未获取到锁的进程不执行任何初始化（尤其不会触发 `clearSjtuSession` 清掉已运行实例的登录凭证），等待 `app.quit()` 完成退出。

---

### v2.2.2 — Canvas 保存路径修复 + 图标深浅主题

#### 修复

- **Canvas 课程保存路径学期重复** — 此前通过下载队列下发的 Canvas 资源（课件文件、课堂视频、单元视频 spec）在落盘时会多出一层学期目录：
  - 本地：`Canvas课程/{学期}/{学期}/{课程}/...`
  - 云盘：`SJTU Canvas课程/{学期}/{学期}/{课程}/...`

  根因：`canvasCoursePath` 已把学期拼进 `courseName`，而 `effectiveCourseName` 又用 `spec.term` 再拼一次。iframe HLS 与 PPT 走另一条路径本就正确，导致同一课程下两类资源落在不同目录。本次统一为单层学期，所有 Canvas 资源路径一致。仅影响设了学期的 Canvas 课程。

#### 新功能

- **图标跟随系统深浅主题** — 任务栏 / 托盘图标随系统深色 / 浅色模式自动切换：深色任务栏显示浅色 logo、浅色任务栏显示深色 logo，解决深色模式下深色 logo 不可见的问题。图标预处理同步重做（抠除米黄背景、logo 几何居中、iOS squircle 圆角过渡）。（exe / 安装包图标为编译时静态嵌入，无法运行时切换，保持深色默认。）

#### 维护

- **Canvas 死代码清理** — 移除补漏文件改合并进 files 列表后的遗留死代码：`canvas-modules` / `canvas-syllabus` source 枚举、`resolveDirectUrl` 对应懒解析分支、`_from_modules` / `_from_syllabus` 字面量、冗余的 `moduleFileIds` / `syllabusFileIds` 参数与字段、5 处 spec 对象的死 `term` 字段。

#### ⚠️ 升级须知

- **旧版双重学期目录**：v2.2.0 / v2.2.1 下载的 Canvas 资源（设了学期的课程）落盘时多了一层学期目录，升级后新下载路径已修正为单层；已下载的旧目录不会自动迁移，可手动把 `Canvas课程/{学期}/{学期}/{课程}/...` 里多出的那层 `{学期}` 目录去掉（云盘路径同理）。

---

### v2.2.1 — 应用名称统一补丁

#### 修复

- **统一应用名称** — 此前 MSI 安装界面、控制面板、快捷方式显示「SJTU 旁听下载器」，与窗口标题/README 的「SJTU 课程下载器」、通知署名的「SJTU 旁听课程下载器」三套字样混用。本次统一为：
  - 中英混合（主显示名）：**SJTU 课程下载器** — 安装包 / 控制面板 / 快捷方式 / 窗口标题 / 托盘 / README
  - 全中文：**上海交大课程下载器** — `.part` 下载说明文件署名
  - 全英文：**SJTU Course Downloader** — 版权 / 作者署名
  - 内部标识由 `sjtu-audited-downloader` 改为 `sjtu-course-downloader`（npm name / appId / persist key / 安装包文件名）

#### ⚠️ 升级须知

- **appId 变更**：旧版「SJTU 旁听下载器」不会被自动覆盖卸载，升级后请在「设置 → 应用」手动卸载旧版本，避免两个应用并存
- **本地偏好重置**：主题 / 下载目录 / 云盘 token 等设置会回到默认，需重新配置

---

### v2.2.0 — 新版本检查提醒 + 强制重新登录 + MSI 安装包 + 安全修复

#### 新功能

- **新版本检查提醒** — 应用启动时静默请求 GitHub Releases，发现新版本在标题栏显示「新版 vX.X.X」徽章，点击查看更新内容并跳转下载页（主进程请求，绕开渲染端 CSP；1h 缓存节流；网络失败静默不打扰）
- **Windows MSI 安装包** — 新增 `.msi` 安装格式（与 `.exe` 并存），企业部署/组策略安装友好；WiX 配置 `-cultures:zh-CN` 解决中文产品名 codepage 问题
- **强制重新登录** — 每次打开 APP 都清除上次会话的登录凭证（jAccount cookie + 云盘 token），强制重新扫码，避免过期态或串号残留

#### 安全

- **CodeQL 告警处理** — 清理 14 条代码质量问题（未使用变量/import、死赋值、永真条件）+ 修复 6 条安全告警（日志注入 `sanitizeForLog`、`mkdtempSync` 原子临时目录、`statSync(throwIfNoEntry)` / `open+fstat` 消除文件系统 TOCTOU）；`existsSync→unlink` 改直接删 + catch ENOENT；readme 写入改 `flag:'wx'` 独占创建
- **依赖升级** — `electron-builder` 25→26（tar 6→7，清 8 条 CVE）、`vite` 5→7 + `electron-vite` 2→5 + `@vitejs/plugin-react` 4→5（清 3 条 CVE）；共自动关闭 13 条 Dependabot 告警
- **安全工具开启** — CodeQL 代码扫描 + Dependabot 依赖更新 + 漏洞告警全部启用（此前为关闭状态）
- **剩余告警已审计关闭** — 18 条 electron CVE（受 webview 兼容限制暂不升主版本，标记 tolerable_risk）+ 1 条 http-to-file（下载器核心功能，路径已 sanitizeFsName 清洗，won't fix）

#### 文档

- **杀软误报声明** — README 增加折叠区说明未签名个人软件被误报的原因及放行步骤（SmartScreen / Defender / 360 / 火绒 / 浏览器）
- **可发现性优化** — 仓库描述改中英双语 + topics 换功能导向标签，`sjtu 旁听下载` / `好大学在线 下载` / `sjtu course downloader` 等搜索词均可命中
- **Star 引导** — README 顶部加徽章（stars/release/license/platform）+ 点赞引导文案

---

### v2.1.0 — v.sjtu 刷新键 + 欢迎页重设计 + README 重组

#### 新功能

- **v.sjtu 旁听页刷新键** — 顶栏新增「刷新 ↻」，重新校验登录态并完整重载课程列表；登录态失效时跳登录页，扫码成功后回到本页自动重新扫描

#### 改进

- **欢迎页重设计** — 融入三大课程来源（v.sjtu 旁听 / Canvas / 好大学在线）与六项核心能力卡片
- **README 重组** — 使用说明（获取方式 / 使用教程 / 状态说明）前置，机制原理（文件命名 / 下载引擎 / 安全模型）后置收口；补全好大学在线来源与路径结构
- **新增 LICENSE** — 此前 README / package.json 声称 MIT 但缺失文件，已补上

---

### v2.0.0 — 好大学在线来源 + PPT 课件 PDF + 内置 ffmpeg + Canvas 单元视频三来源

#### 新增来源：好大学在线（cnmooc.sjtu.cn）

- **课程视频与课件下载** — 移植自独立项目 `cnmooc-downloader`，改用 Electron 既有能力（`persist:sjtu` session + `ses.fetch` + 裸 `node:https` 下载引擎 + cheerio HTML 解析），不复用 Playwright
- **jAccount SSO 复用** — 复用 v.sjtu 的 jAccount 会话，隐藏 BrowserWindow 自动完成 SSO，首次 / cookie 失效时弹可见窗口兜底
- **按章节结构组织** — 解析课程章节树，章节可折叠，每条目带三态勾选
- **资源类型筛选** — 全部 / 仅视频 / 仅课件，下载时按懒解析的直链扩展名过滤
- **懒解析直链** — 扫描只解析章节 HTML，下载时 POST `play.mooc` + `detail.mooc` 取 `flvUrl` / `rsUrl`，扩展名按直链补全
- **落盘** — 本地 `好大学在线/{课程名}/{章节}/{文件名}`，云盘 `SJTU好大学在线/...`；cnmooc cookie 仅对 `cnmooc.sjtu.cn` 及其子域注入

#### Canvas PPT 课件 PDF

- **课堂视频 PPT 切片合并** — 调 `query-ppt-slice-es` API 获取 PPT 截图，并发 5 下载后用 `pdf-lib` 合并为 16:9 PDF，每页 960×540 pt
- **与视频同目录** — 落盘到 `videos/课堂视频/{时间戳}-{教师}-{教室}-PPT课件.pdf`，文件名格式与课堂视频一致
- **课程级 token 复用** — 复用课堂视频的 LTI JWT token；cloud/both 模式下 PDF 生成后自动上传云盘

#### 内置 ffmpeg

- **`ffmpeg-static@5.3.0`** 作为生产依赖打入安装包，`asarUnpack` 解包 native 二进制；Canvas「单元视频」HLS → MP4 无损 remux + 可选重编码修复花屏，**无需用户另装 ffmpeg**
- **windowsHide** — Electron 主进程是 GUI 子系统，Windows 下 spawn ffmpeg 必须传 `windowsHide:true`，否则触发 `spawn EPERM`；缺失 / 平台不支持时回退系统 PATH
- **HLS 可选重编码** — `transcodeVideo` 用 `libx264 -preset fast -crf 23` 重建 GOP + 缩放，解决 tv.sjtu.edu.cn 超高分辨率 I-frame-only 源花屏；源高度已 ≤ 目标时仍重建 GOP

#### Canvas 单元视频三来源

- **ExternalTool → 直接 MP4**（`v.sjtu/jy-application-canvas-sjtu-ui/#/playerPage`）— LTI 验签跳转取课程级 token（24h），`GET /file/{fileId}` 拿 S3 预签名 MP4
- **ExternalUrl → 直接 MP4**（`vshare.sjtu.edu.cn/play/{uuid}`）— `GET /api/video/play/{uuid}` 拿 S3 预签名 MP4
- **Page iframe → 真 HLS**（`v.sjtu/course/opencourseshareXXX.html`）— webRequest 捕获 m3u8 → 并发 5 下 segment → ffmpeg remux；支持 local/cloud/both（cloud 模式传云盘 token 自动上传）

#### v.sjtu 刷新键

- **顶栏刷新键** — 与好大学在线页一致，重新校验登录态并完整重载课程列表；登录态失效时跳登录页，扫码成功后回到本页自动重新扫描

### v1.1.0 — Canvas 修复与下载增强

#### Canvas 文件下载修复

- **Canvas 文件直链解析** — 修复 Canvas 课件下载后无法打开的问题（根因：`node:https` 绕过 Chromium 网络栈后无法携带 Canvas 会话 Cookie，302 到登录页 HTML 被存为课件文件）。实现方案：下载前从 Electron session 提取 `oc.sjtu.edu.cn` 的 Cookie（含 HttpOnly），注入 `node:https` 请求头，仅在 Canvas 站点这一跳携带；跟随 302 到 S3 预签名直链后不带 Cookie，避免泄漏给第三方域
- **Canvas 端点 429/403 限流重试** — 高并发下载时 Canvas 偶发返回 429 或 403，系统读取 `Retry-After` 响应头并做指数退避重试（最多 4 次）；S3 的 403（签名/权限，永久错误）不重试

#### 同名文件冲突策略

- **跳过 / 替换** — 新增同名文件冲突策略选项，与本地/云盘/两者三种保存模式正交
  - **跳过**（默认）：目标文件已存在则跳过，保留旧文件
  - **替换**：本地下载先删除旧文件再重新下载；云盘上传先将远端同名文件移入回收站再上传
- **Canvas 视频覆盖** — 课堂视频、单元视频、讲次下载均支持冲突策略，替换模式不再预先跳过同名文件

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
