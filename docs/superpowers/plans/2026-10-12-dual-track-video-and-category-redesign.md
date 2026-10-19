# Canvas 录播新旧双轨融合引擎与课件分类图标重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现交大 Canvas 录播新旧双轨（`v.sjtu.edu.cn` + `courses.sjtu.edu.cn`）并发扫描、时间对齐与并集去重，支持旧版 MP4 Range 极速下载；彻底修复课堂视频 PPT 视角图标误标为 PPT 文档的问题，并将 PPT 课件 (PDF) 细化为逐讲明细项。

**Architecture:** 
1. 新建 `src/main/canvas/legacy-video.ts` 封装 `courses.sjtu.edu.cn` LTI 握手、讲次列表查询与直链提取；
2. 升级 `src/main/canvas/orchestrator.ts` 的 `canvas:class-video-scan` 为双轨级联/并集融合引擎，智能对齐讲次，并在下载时透明分发旧版 Range 任务；
3. 在 `src/renderer/src/pages/CanvasBrowser.tsx` 中纠正 PPT 视角类型为 `MP4`，并为 `pptPdf` 类别填充各讲次独立的 PDF 明细项。

**Tech Stack:** TypeScript, Electron, Vitest, React, TailwindCSS.

**Spec:** [docs/superpowers/specs/2026-10-12-dual-track-video-and-category-redesign-design.md](file:///d:/SJTU/编程/sjtu-downloader-all-in-one/docs/superpowers/specs/2026-10-12-dual-track-video-and-category-redesign-design.md)

## Global Constraints
- 磁盘与渲染端绝对杜绝明文密码，保持用户隐私信息（姓名、学工号）脱敏；
- 正文中凡非公式美元符号必须严格转义为 `\$` 或包裹在行内代码块中；
- 链接统一采用 `[file](file:///...)` 格式；
- 现有 488+ 测试用例 100% 保持通过，`npm run lint` 与 `npm run typecheck` 0 报错。

---

### Task 1: 旧版录播协议 (`courses.sjtu.edu.cn`) 客户端与多流直链解析

**Files:**
- Create: `src/main/canvas/legacy-video.ts`
- Modify: `src/shared/types.ts:310-335`
- Test: `test/e2e/legacy-video.test.ts`

**Interfaces:**
- Produces:
  - `extractLegacyLtiToken(ses: Electron.Session, tabHtmlUrl: string): Promise<{ canvasCourseId: string } | null>`
  - `fetchLegacyVodVideoList(ses: Electron.Session, encCourseId: string): Promise<CanvasVideoSession[]>`
  - `fetchLegacyVodStreamUrls(ses: Electron.Session, videoId: string): Promise<{ teacherUrl?: string; pptUrl?: string }>`
- Consumes:
  - `CanvasVideoSession` from `src/shared/types.ts`
  - `safeFetch` from `src/main/canvas/safe-fetch.ts`

- [ ] **Step 1: 编写测试用例验证旧版列表解析与流匹配**
  在 `test/e2e/legacy-video.test.ts` 中构建 mock 服务，测试：
  - `findVodVideoList` 正确转换为 `CanvasVideoSession` 结构；
  - `getVodVideoInfos` 正确将 `cdviViewNum === 0` 识别为教师流，`cdviViewNum === 3` 识别为 PPT 流；
  - 遇到 `非云录播教室` 或 `code: 400` 时优雅返回空数组。

- [ ] **Step 2: 运行测试验证失败状态**
  执行：`npx vitest run test/e2e/legacy-video.test.ts`
  预期：FAIL（模块尚未存在）

- [ ] **Step 3: 实现 `src/main/canvas/legacy-video.ts`**
  实现 LTI 表单提交、`findVodVideoList` 分页获取、`getVodVideoInfos` 直链提取与重试机制。在 `src/shared/types.ts` 中的 `CanvasVideoSession` 增加 `legacyCourseId?: string` 标识。

- [ ] **Step 4: 运行测试验证通过**
  执行：`npx vitest run test/e2e/legacy-video.test.ts`
  预期：PASS

- [ ] **Step 5: 提交任务代码**
  ```bash
  git add src/shared/types.ts src/main/canvas/legacy-video.ts test/e2e/legacy-video.test.ts
  git commit -m "feat(canvas): implement legacy courses.sjtu.edu.cn LTI client and stream resolver"
  ```

---

### Task 2: 主进程新旧双轨并集融合扫描引擎 (Dual-Track Union Engine)

**Files:**
- Modify: `src/main/canvas/orchestrator.ts:450-530`
- Modify: `src/main/canvas/video-tokens.ts:20-30`
- Test: `test/e2e/dual-track-scan.test.ts`

**Interfaces:**
- Produces:
  - 增强 `canvas:class-video-scan` 支持单轨、回退与双轨并集融合
  - 增强 `canvas:class-video-download` 支持旧版 MP4 Range 直链任务派发
- Consumes:
  - `fetchVodVideoList` from `src/main/canvas/video-tokens.ts`
  - `fetchLegacyVodVideoList`, `fetchLegacyVodStreamUrls` from `src/main/canvas/legacy-video.ts`

- [ ] **Step 1: 编写双轨扫描与并集去重测试**
  在 `test/e2e/dual-track-scan.test.ts` 中编写测试：
  - 仅有新版时正常走新版；
  - 新版为 0 且有旧版时，自动回退拉取旧版（如课程 89673 获取 14 讲）；
  - 双轨并存时按授课时间戳对齐去重，合并教师列表；
  - 旧版录播下载 spec 准确生成 `CanvasDownloadTaskSpec`，走直接 HTTP Range 传输。

- [ ] **Step 2: 运行测试验证失败状态**
  执行：`npx vitest run test/e2e/dual-track-scan.test.ts`
  预期：FAIL

- [ ] **Step 3: 改造 `orchestrator.ts` 实现双轨融合与旧版下载**
  - 在 `canvas:class-video-scan` 中识别所有符合条件的 Tab（区分 8329 与 18717）；
  - 优先扫描新版，若新版无数据或包含旧版则探测旧版；
  - 对扫描结果以 `beginTime` + `lectureNum` 对齐去重合并；
  - 在 `canvas:class-video-download` 中对含 `legacyCourseId` 的 session，调用 `fetchLegacyVodStreamUrls` 产出直链并下发下载任务。

- [ ] **Step 4: 运行测试验证通过**
  执行：`npx vitest run test/e2e/dual-track-scan.test.ts`
  预期：PASS

- [ ] **Step 5: 提交任务代码**
  ```bash
  git add src/main/canvas/orchestrator.ts src/main/canvas/video-tokens.ts test/e2e/dual-track-scan.test.ts
  git commit -m "feat(canvas): implement dual-track union scanning engine with legacy stream dispatch"
  ```

---

### Task 3: 渲染端分类与图标纠偏、PPT课件 (PDF) 逐讲明细化

**Files:**
- Modify: `src/renderer/src/pages/CanvasBrowser.tsx:1140-1200, 1310-1325`
- Test: `src/renderer/src/components/DownloadUI.test.ts`

**Interfaces:**
- Produces:
  - PPT 录播项 `type: isAudioOnly ? 'DISABLED' : 'MP4'`，名称：`第${l.lectureNum}讲 PPT投影视角 (MP4)`
  - `pptPdf` 类别生成各讲独立 PDF 项，中间栏呈现有效讲次数

- [ ] **Step 1: 编写渲染端分类与图标断言测试**
  在 `src/renderer/src/components/DownloadUI.test.ts` 中添加测试：
  - 验证 `第1讲 PPT投影视角 (MP4)` 在 `type: 'MP4'` 时正确渲染 MP4 蓝色视频图标；
  - 验证 `pptPdf` 分类包含讲次明细，各讲次呈现红色 PDF 徽标。

- [ ] **Step 2: 运行测试验证失败状态**
  执行：`npx vitest run src/renderer/src/components/DownloadUI.test.ts`
  预期：FAIL

- [ ] **Step 3: 修改 `CanvasBrowser.tsx`**
  - 将 PPT 录播项的 `type` 从 `'PPT'` 改为 `isAudioOnly ? 'DISABLED' : 'MP4'`；
  - 名称统一为 `${c.name} - 第${l.lectureNum}讲 PPT投影视角 (MP4)`（教师流为 `教师视角 (MP4)`）；
  - 在 `id: 'pptPdf'` 分类中，基于已扫描讲次生成各讲独立的课件项 `${c.name} - 第${l.lectureNum}讲 PPT课件 (PDF)`，赋予 `type: 'PDF'`，中间栏计数值展示为讲次数。

- [ ] **Step 4: 运行测试验证通过**
  执行：`npx vitest run src/renderer/src/components/DownloadUI.test.ts`
  预期：PASS

- [ ] **Step 5: 提交任务代码**
  ```bash
  git add src/renderer/src/pages/CanvasBrowser.tsx src/renderer/src/components/DownloadUI.test.ts
  git commit -m "fix(ui): correct PPT video stream type to MP4 and populate PPT PDF lecture items"
  ```

---

### Task 4: 端到端全量门禁与真实回归验证

**Files:**
- All modified and test files

- [ ] **Step 1: 运行全量单元测试与 E2E 测试**
  执行：`npm test`
  预期：所有 490+ 项测试全部 PASS，0 失败。

- [ ] **Step 2: 运行类型检查与 ESLint**
  执行：`npm run typecheck && npm run lint`
  预期：0 errors, 0 warnings。

- [ ] **Step 3: 提交并推送到 GitHub 远程仓库**
  ```bash
  git push origin master
  ```
