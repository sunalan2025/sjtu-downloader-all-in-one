# Canvas 录播新旧双轨融合引擎与课件分类图标重构 设计方案

> **日期**：2026-10-12  
> **目标**：彻底解决 Canvas 课堂录播（MP4）与 PPT 课件（PDF）分类及图标混淆问题；实现 2025-2026 学年及历史全学期「新旧双轨录播系统（`v.sjtu.edu.cn` + `courses.sjtu.edu.cn`）」自动并发探测、讲次去重与 MP4 Range 高速下载，彻底终结历史学期 1,000+ 讲录播漏扫问题。

---

## 1. 背景与根因剖析

### 1.1 分类与图标混淆根因
- 在 [src/renderer/src/pages/CanvasBrowser.tsx](file:///d:/SJTU/编程/sjtu-downloader-all-in-one/src/renderer/src/pages/CanvasBrowser.tsx#L1165) 中，课堂视频列表内的 PPT 投影视角流被赋予了 `type: 'PPT'`，导致 `FileTypeBadge` 将其渲染为**橙色 PPT 幻灯片图标**，尽管文件名写着 `(MP4)`，极易让用户误以为 PPT 文档被转成了 MP4；
- 中间分类栏的 `📑 PPT课件 (PDF)` 分类下的文件项被写死为空数组 `items: []`，导致该分类固定显示 `0 >` 且右侧完全为空，无法逐讲点选或直观获知可导出的 PDF 讲义数。

### 1.2 课程录播漏扫根因（2025-2026 学年实测）
- 2025-2026-1（秋季学期）：新版录播系统（Tool 8329）**100% 返回未排课**，全部 949 讲课堂实录独占保存在旧版系统（Tool 18717）；
- 2025-2026-2（春季学期）：存在推流割接（如物理/口语前半段在旧版，后半段在新版）与旧版留存更完整（如高数、有机、AI基础旧版讲次更多）；
- 2025-2026-3（夏季学期）：如《大模型与智能体工程实践》全部 16 讲完整录播独占保存在旧版中；
- 客户端原逻辑仅取第 1 个匹配 `isClassVideoTab` 的 Tab（即 8329），未排课时直接返回空且无旧版协议引擎，导致超过 77% 的录播完全漏扫。

---

## 2. 架构设计

### 2.1 双轨并集融合扫描引擎 (Dual-Track Union Engine)
```text
                         Canvas 课程 (courseId)
                                   │
               ┌───────────────────┴───────────────────┐
               ▼                                       ▼
     Tab: 课堂视频新版 (8329)               Tab: 课堂视频旧版 (18717)
    (v.sjtu.edu.cn - LTI 1.3)             (courses.sjtu.edu.cn - LTI 1.0)
               │                                       │
               ▼                                       ▼
       [fetchVodVideoList]                   [findVodVideoList]
         (新版讲次列表)                         (旧版讲次列表)
               │                                       │
               └───────────────────┬───────────────────┘
                                   ▼
                        【讲次时间对齐与并集融合】
               - 以授课开始时间戳 (beginTime) 进行去重归一化
               - 两边皆有时：优先保留新版元数据或更高清晰度
               - 一边独有时：完整并入，消灭任何讲次缺失
               - 合并统计任课教师（支持单选/多选教师）
```

### 2.2 旧版录播协议适配 (`src/main/canvas/legacy-video.ts`)
1. **LTI 握手**：离屏 BrowserWindow 加载 `https://oc.sjtu.edu.cn/courses/${courseId}/external_tools/18717`，自动向 `https://courses.sjtu.edu.cn/lti/launch` 提交 `#tool_form` 表单，捕获重定向 URL 里的 `canvasCourseId`（加密串）；
2. **列表拉取**：`POST https://courses.sjtu.edu.cn/lti/vodVideo/findVodVideoList`（单次获取最多 1000 讲）；
3. **直链解析**：`POST https://courses.sjtu.edu.cn/lti/vodVideo/getVodVideoInfos`，获取 `videos.sjtu.edu.cn` 的教师视角（`cdviViewNum: 0`）与 PPT 视角（`cdviViewNum: 3`）直链；
4. **下载通道**：直链为标准 MP4 视频，原生支持 HTTP 206 Range，直接接入主进程通用分段下载管道。

### 2.3 分类与图标纠偏设计
1. **录播流明确命名与图标**：
   - 教师视角：`${c.name} - 第${l.lectureNum}讲 教师视角 (MP4)`，`type: 'MP4'`（蓝色视频图标）
   - PPT 视角：`${c.name} - 第${l.lectureNum}讲 PPT投影视角 (MP4)`，`type: isAudioOnly ? 'DISABLED' : 'MP4'`（蓝色视频图标）
2. **「📑 PPT课件 (PDF)」明细化与联动**：
   - 中间分类栏数字展示为实际支持讲次数（如 `12 >`）；
   - 右侧第三栏列出各讲 `${c.name} - 第${l.lectureNum}讲 PPT课件 (PDF)`，`type: 'PDF'`（红色 PDF 图标）；
   - 支持全选与按讲次单独导出。
