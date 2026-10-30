# 子文件夹勾选解耦、课程作业全量归档修复与视频自动扫描 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底解决双击进入子文件夹误触发全选导致悬浮条异常的问题；修复 Canvas 课程作业（题目附件、在线文本与提交原件）下载全链路；实现进入视频分类自动扫描呈现录播。

**Architecture:**
1. **文件夹导航与选择态解耦**：在网格/列表视图进入子目录（`navState.level === 'category'`）时，清空当前分类的批量全选缓存及相关任务勾选，确保内部呈现未勾选初始态；避免双击首击误触卡片勾选。
2. **作业归档引擎增强**：利用 Cheerio 从题干 `description` HTML 中稳健提取教师课件附件；从 `submission.body` 提取在线文本提交；从 `submission.attachments` 及 `submission_comments[].attachments` 提取学生提交原件与助教批注文件；修复批量调度器 `processCourse` 聚合任务退出判断条件；打通单作业直接下载与云盘上传逻辑。
3. **录播自动化扫描**：在进入课堂视频分类或在分栏视图激活视频类别时，自动触发 `doClassVideoScan(courseId)`，展示加载中指示器并在扫描完成后即时渲染，移除“点击扫描课堂视频”的手动交互冗余。

**Tech Stack:** React 18, Zustand, Electron Session, Cheerio, Vitest, TypeScript.

---

## Global Constraints
- 高校师生界面友好自然，严格遵守《用户界面语言表述与词汇规范化确认准则》。
- 界面操作出口唯一，底栏与操作区无互斥争宠按钮。
- 所有改动必须通过全链路验证：`npm run typecheck`（0 错误）、`npm run lint`（0 警告）、`npm test`（100% 绿灯）。

---

### Task 1: 修复子文件夹进入时自动清空全选态，避免悬浮条误显示“全部勾选”

**Files:**
- Modify: `src/renderer/src/pages/CanvasBrowser.tsx`
- Modify: `src/renderer/src/features/course-explorer/GridView.tsx`
- Modify: `src/renderer/src/features/course-explorer/ListView.tsx`
- Test: `test/unit/file-manager-selection.test.ts`

- [ ] **Step 1: 编写测试用例验证进入分类目录时不继承卡片全选状态**
- [ ] **Step 2: 在 `CanvasBrowser.tsx` 的导航状态跳转逻辑中，当导航至 `level === 'category'` 时，重置当前分类在 `canvasCourseCategorySelections` 中的标记，并清除 `selected` 中该分类的项**
- [ ] **Step 3: 优化 `GridView.tsx` 与 `ListView.tsx` 双击卡片事件，防止双击的第一击触发全选**
- [ ] **Step 4: 运行 `npm test` 确认选择逻辑单元测试通过**

---

### Task 2: 修复 Canvas 课程作业提取与下载全链路引擎

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/canvas/assignment-download.ts`
- Modify: `src/renderer/src/pages/canvas/canvas-download-actions.ts`
- Modify: `src/renderer/src/pages/canvas/canvas-course-mapper.tsx`
- Test: `test/unit/canvas-assignment.test.ts`
- Test: `test/e2e/export-decoupling.test.ts`

- [ ] **Step 1: 在 `CanvasAssignmentItem` 类型中增加 `submissionBody?: string` 字段与批注附件支持**
- [ ] **Step 2: 在 `fetchCourseAssignments` 中使用 Cheerio 解析 `raw.description` 提取内嵌的题目附件 URL，并提取 `sub.body` 及 `submission_comments[].attachments`**
- [ ] **Step 3: 在 `compileAssignmentMarkdown` 中完善作业说明、题目附件清单、学生文本提交与助教评语排版**
- [ ] **Step 4: 修复 `canvas-download-actions.ts` 第 633 行遗漏 `!assignmentAggregateTaskId` 的致命提前退出判断**
- [ ] **Step 5: 在 `canvas-course-mapper.tsx` 中为作业条目补充 `onDownloadSingle` 极速单作业直下回调**
- [ ] **Step 6: 在 `downloadAssignmentArchive` 中打通针对交大云盘（CloudPan）直传上传逻辑**
- [ ] **Step 7: 运行 `npm test` 验证作业解析、Markdown 生成与下载调度用例全部通过**

---

### Task 3: 实现进入课程视频界面全自动扫描与渲染

**Files:**
- Modify: `src/renderer/src/pages/CanvasBrowser.tsx`
- Modify: `src/renderer/src/pages/canvas/canvas-course-mapper.tsx`
- Modify: `src/renderer/src/pages/canvas/canvas-progress-widgets.tsx`
- Test: `test/unit/canvas-video-routing.test.ts`

- [ ] **Step 1: 在 `CanvasBrowser.tsx` 中添加响应式 Effect：当用户切换至 `categoryId === 'videos'` 或在分栏视图选中视频类别且尚未扫描过该课程录播时，自动调度 `doClassVideoScan(courseId)`**
- [ ] **Step 2: 移除 `VideoCategoryExtra` 中生硬的“点击扫描课堂视频”按钮，在未完成扫描时展示正在扫描微动画与提示**
- [ ] **Step 3: 完善空状态文案与加载态无缝切换逻辑**
- [ ] **Step 4: 运行 `npm test` 确认录播路由与扫描测试通过**

---

### Task 4: 全链路质量门禁与打包验证

- [ ] **Step 1: 运行 `npm run typecheck` 验证 TypeScript 静态类型 0 错误**
- [ ] **Step 2: 运行 `npm run lint` 验证 ESLint 代码规范 0 警告**
- [ ] **Step 3: 运行 `npm test` 验证全部 80+ 个测试套件 100% 绿灯**
- [ ] **Step 4: 运行 `npm run build:unpack` 确保发布包构建无异常**
