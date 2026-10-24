# 选项框主题统一与学期文案规范化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将全工程中残留的 5 处原生 HTML `<select>` 下拉框全面重构替换为 Apple HIG 风格的现代圆角 `DropdownSelect` 组件（支持分组、数值类型与毛玻璃微光质感），彻底消除 Windows 平台生硬白底直角弹框；同时彻底清除学期选项中的冗长括号与内部实现细节，使界面排版圆润、通俗且高度统一。

**Architecture:** 
1. 在 `src/renderer/src/components/widgets.tsx` 中升级拓展已有的 `DropdownSelect` 原语，支持泛型 `T extends string | number`、`groups?: DropdownGroup<T>[]` 分组模式、自定义触发器与毛玻璃圆角悬浮弹窗；
2. 在 `ScheduleBrowser.tsx` 和 `schedule-fetcher.ts` 中规范化所有学期文案，彻底移除 `(秋季 · 官方教务)`、`(夏季小学期)`、`(春季)`、`(秋季 · 入学学期)` 等括号表述，统一为通俗易懂的季节表述（如 `${y}-${y + 1} 秋季学期`）；
3. 在 `ScheduleHeaderBar.tsx`、`WeekScheduleView.tsx`、`ScheduleExportModal.tsx` 中全面落地 `DropdownSelect`，消除全仓库所有原生 `<select>`。

**Tech Stack:** React 19, Tailwind CSS, Lucide Icons / Heroicons, Vitest, TypeScript.

**Spec:** 由用户指令与 `/grill-me` 深度对齐拍板的《拟修改词汇与规范化对照表》及组件设计。

## Global Constraints

- 绝不使用可见括号（界面文案与展示避免生硬括号修饰，以空格、中点或自然语序分隔）。
- 严禁重复造轮子：所有下拉功能收口至 `src/renderer/src/components/widgets.tsx` 的 `DropdownSelect`，严禁在页面内部内联私有下拉。
- 门禁铁律：全改动必须 100% 通过 `npm run typecheck`、`npm run lint` 与 `npm test`。

---

### Task 1: 升级扩展基础 `DropdownSelect` 组件以支持分组选项、数值类型与 Apple HIG 质感

**Files:**
- Modify: `src/renderer/src/components/widgets.tsx:264-356`
- Create: `test/unit/dropdown-select.test.ts`

**Interfaces:**
- Consumes: `useClickOutside`
- Produces: 
  - `DropdownOption<T extends string | number>`
  - `DropdownGroup<T extends string | number>`
  - `DropdownSelect<T extends string | number>` (props: `value`, `onChange`, `options?`, `groups?`, `icon?`, `className?`, `buttonClassName?`, `align?`, `size?`, `title?`)

- [ ] **Step 1: 编写 `test/unit/dropdown-select.test.ts` 专项单元测试**
  - 测试平铺 `options` 模式正常渲染与选择；
  - 测试 `groups` 分组模式（渲染分组标题与选项）；
  - 测试支持数值类型 `number`（如周数 1~18、提醒分钟数 10~60）；
  - 测试点击外部触发 `onClose` 关闭弹窗。

- [ ] **Step 2: 运行测试验证失败**
  - `npx vitest run test/unit/dropdown-select.test.ts`

- [ ] **Step 3: 升级 `widgets.tsx` 中的 `DropdownSelect` 实现**
  - 扩展泛型为 `T extends string | number = string`；
  - 新增 `DropdownGroup<T>` 支持，当传入 `groups` 时，渲染分组大类标题与微细分割线；
  - 升级弹窗样式为 Apple HIG 毛玻璃高斯模糊（`rounded-2xl border border-black/[0.08] dark:border-white/[0.12] bg-surface-1/95 backdrop-blur-xl shadow-2xl p-1.5`）；
  - 选项高亮态包含勾选标志 `✓` 与细腻圆角 hover 动效。

- [ ] **Step 4: 运行测试验证全绿**
  - `npx vitest run test/unit/dropdown-select.test.ts`

- [ ] **Step 5: Git Commit**
  - `git commit -m "feat(ui): upgrade DropdownSelect to support option grouping, numeric values, and apple hig styling"`

---

### Task 2: 学期文本去括号规范化与全学期生成逻辑重构

**Files:**
- Modify: `src/renderer/src/pages/ScheduleBrowser.tsx:231-248`
- Modify: `src/main/schedule/schedule-fetcher.ts:920-922`
- Modify: `test/unit/jiaowu-and-grid.test.ts:440-475`

**Interfaces:**
- Consumes: `enrollmentYear`
- Produces: 
  - `dynamicJiaowuSemesters` 输出无括号通俗学期标签（`${y}-${y + 1} 秋季学期`、`${y}-${y + 1} 春季学期`、`${y}-${y + 1} 夏季小学期`）

- [ ] **Step 1: 更新 `ScheduleBrowser.tsx` 中的 `dynamicJiaowuSemesters`**
  - 彻底去除 `(秋季 · 官方教务)`、`(夏季小学期)`、`(春季)`、`(秋季 · 入学学期)` 括号与多余字样；
  - 规范统一为季节表述：
    - `list.push({ key: `${y}_3`, label: `${y}-${y + 1} 秋季学期` })`
    - `list.push({ key: `${y}_16`, label: `${y}-${y + 1} 夏季小学期` })`
    - `list.push({ key: `${y}_12`, label: `${y}-${y + 1} 春季学期` })`

- [ ] **Step 2: 更新 `schedule-fetcher.ts` 中的 `termTitle` 与 `termName`**
  - 将 `xqm === '3' ? '第1学期 (秋季)' : xqm === '12' ? '第2学期 (春季)' : '第3学期 (夏季小学期)'` 净化为 `'秋季学期'` / `'春季学期'` / `'夏季小学期'`；
  - 组合标题为 `${xnm}-${Number(xnm) + 1} ${termName}`。

- [ ] **Step 3: 同步更新 `test/unit/jiaowu-and-grid.test.ts` 对应断言**
  - 更新单元测试内的断言匹配，确保测试准确覆盖规范化后的文本。

- [ ] **Step 4: 运行单元测试**
  - `npx vitest run test/unit/jiaowu-and-grid.test.ts`

- [ ] **Step 5: Git Commit**
  - `git commit -m "refactor(schedule): remove verbose parentheses from semester labels and normalize to seasonal format"`

---

### Task 3: 全局统一替换原生 `<select>` 为 `DropdownSelect`

**Files:**
- Modify: `src/renderer/src/pages/schedule/components/ScheduleHeaderBar.tsx:59-78`
- Modify: `src/renderer/src/pages/schedule/components/WeekScheduleView.tsx:105-171`
- Modify: `src/renderer/src/pages/schedule/components/ScheduleExportModal.tsx:105-129`

- [ ] **Step 1: 改造 `ScheduleHeaderBar.tsx` 中的学期选择器**
  - 将原生 `<select>` 替换为 `DropdownSelect`；
  - 传入 `groups`：
    - 分组 1：「交我办与 Canvas · 实时同步」，选项为 `2026-2027-1 · 当前学期实时同步`
    - 分组 2：「教学信息服务网 · 历年课表」，选项为规范化后的历年学期列表

- [ ] **Step 2: 改造 `WeekScheduleView.tsx` 中的两处周次选择器**
  - 第一处（当前学期周次选择器）：使用 `DropdownSelect`，分为「秋季学期 正序」与「假期周次」（如有）；
  - 第二处（历年教务周次选择器）：使用 `DropdownSelect<number>`，选项为 1~18 周。

- [ ] **Step 3: 改造 `ScheduleExportModal.tsx` 中的两处提醒时间选择器**
  - 上课提前提醒：使用 `DropdownSelect<number>`，选项为 10 分钟、20 分钟、30 分钟、1 小时；
  - 作业 DDL 提前提醒：使用 `DropdownSelect<number>`，选项为 12 小时、24 小时、2 天。

- [ ] **Step 4: 检查并确认全仓库再无任何原生 `<select>` 标签**
  - `git grep "<select"`

- [ ] **Step 5: Git Commit**
  - `git commit -m "feat(ui): replace all native select controls with apple hig DropdownSelect across schedule module"`

---

### Task 4: 全套自动化测试验证与全链路门禁终验

**Files:**
- All changed files and test suites

- [ ] **Step 1: 运行 TypeScript 类型检查**
  - `npm run typecheck`（必须 0 错误）

- [ ] **Step 2: 运行 ESLint 代码检查**
  - `npm run lint`（必须 0 错误 0 警告）

- [ ] **Step 3: 运行全套测试套件**
  - `npm test`（892+ 测试必须 100% 绿灯）

- [ ] **Step 4: Git 提交并向用户汇报**
  - 编写实施成果总结。
