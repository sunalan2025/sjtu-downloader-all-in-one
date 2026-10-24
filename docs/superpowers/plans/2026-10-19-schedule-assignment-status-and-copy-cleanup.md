# 课表与日程作业状态精准判定、全课程覆盖与文案净化实施方案

> 实施分支: `feat/schedule-assignment-status-and-copy-cleanup`  
> 基线 Commit: `bba6fda` (master)  
> 执行模式: Subagent-Driven Development (SDD)

---

## 1. 架构背景与缺陷剖析 (Root Causes)

### 1.1 作业“交没交”致命误判
- **根因**：`a.has_submitted_submissions` 在 Canvas API 中表示“该作业在全班是否已有任何一个学生提交过”，而非当前学生个人提交状态。
- **后果**：大班课程中一旦其他同学交了作业，该字段即变为 `true`，导致当前未提交的学生直接被误判为“已提交”，同时遮蔽了后续的 `missing` 逾期判断。
- **解决**：彻底摒弃 `has_submitted_submissions`，直接且仅依赖当前学生的 `submission` 对象（`workflow_state`、`submitted_at`、`attempt > 0`、`submission.missing`）。

### 1.2 “大学物理”等无 `due_at` 作业消失于控制面板与日程
- **根因**：教师未设置 `due_at`（值为 `null`），而是设置了 `lock_at`（锁定时间）。Canvas 官方控制面板将这类作业归入“未标注日期”，而我们的客户端在计算截止时间时 `a.due_at || a.end_at || a.start_at` 遗漏了 `a.lock_at`，导致其时间为空串，在日程周视图中被完全丢弃。
- **解决**：实行**双轨继承时间** `a.due_at || a.lock_at || a.end_at || a.start_at`，当由 `lock_at` 继承时标记 `isLockAtDeadline: true`，在界面标注“锁定截止”；同时合并收藏夹与全部当前学期活跃课程，防止未加星标的课程漏抓。

### 1.3 文案浮夸对比与不规范标识清理
- 消除一切夸大吹嘘、竞品对比词（如“全面升级”、“默认整齐归类，杜绝冗长瀑布流”、“ / 夸克网盘”）；
- 消除“与校友”、“（如「本科账号」、「双学位」）”括号举例；
- 全库彻底移除 `(v.sjtu)` 括号说明，统一规范为地道的中文“旁听课程视频”。

---

## 2. 任务规划清单

### Task 1: 文档与代码库文案全面净化
- **文件**: `README.md`, `package.json`, `src/main/index.ts`, `src/main/cnmooc/orchestrator.ts`, `src/renderer/src/pages/Welcome.tsx` 等
- **内容**:
  1. `README.md` 标题去除副标题；
  2. 介绍中删去“与校友”；
  3. 账号别名删去括号举例；
  4. 架构介绍改为客观陈述功能，删去“全面升级”、“默认整齐归类，杜绝冗长瀑布流”；
  5. 视图描述中彻底删除“ / 夸克网盘”；
  6. 全局移除所有“ (v.sjtu)”括号说明，统一为“旁听课程”或“旁听课程视频”；
  7. 修复主进程错误提示中的“请先登录 v.sjtu”。

### Task 2: 重构主进程作业抓取与提交状态判定
- **文件**: `src/main/schedule/schedule-fetcher.ts`, `src/shared/types.ts`
- **内容**:
  1. `ScheduleEvent` 类型增加 `isLockAtDeadline?: boolean` 字段；
  2. 课程获取范围升级：合并收藏夹课程（`/favorites/courses`）与活跃课程（`/courses?enrollment_state=active`），去重后并发抓取各课作业；
  3. 时间双轨继承：`const rawTime = a.due_at || a.lock_at || a.end_at || a.start_at || ''`，记录 `isLockAtDeadline: !a.due_at && !!a.lock_at`；
  4. 个人提交状态判定重构：
     - `ws === 'graded'` -> `subStatus = 'graded'`（保留分数 `submission.score`）；
     - `ws === 'submitted' || ws === 'pending_review' || Boolean(sub?.submitted_at) || (typeof sub?.attempt === 'number' && sub.attempt > 0)` -> `subStatus = 'submitted'`；
     - `sub?.missing === true || (rawTime && new Date(rawTime).getTime() < Date.now())` -> `subStatus = 'missing'`；
     - 其他情况 -> `subStatus = 'unsubmitted'`。

### Task 3: 渲染端日程弹窗交互与状态展示升级
- **文件**: `src/renderer/src/components/ScheduleModal.tsx`
- **内容**:
  1. 作业卡片若具有 `isLockAtDeadline`，呈现轻量微标“锁定截止”；
  2. 精确呈现状态徽标：
     - 已打分：蓝色徽标，显示“已评分 X分”；
     - 已提交：绿色徽标，“已提交”；
     - 逾期未交：红色徽标，“已逾期”；
     - 未提交：琥珀色徽标，“待提交”；
  3. 点击作业直链安全跳转至 Canvas 作业原生详情页。

### Task 4: 自动化单元与 E2E 测试补充及三大门禁全绿验证
- **文件**: `test/unit/schedule-assignment-status.test.ts`, 现有相关测试
- **内容**:
  1. 单元测试覆盖全班已交但当前学生未交、学生已交未批、学生已批改、学生逾期未交、无 `due_at` 仅有 `lock_at` 的双轨继承等全场景；
  2. 顺序运行并 100% 通过：
     - `npm run typecheck`
     - `npm run lint`
     - `npm test`
