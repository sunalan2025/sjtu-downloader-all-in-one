# Modularize ScheduleBrowser Implementation Plan

> **Goal**: 将 3278 行巨石组件 `src/renderer/src/pages/ScheduleBrowser.tsx` 模块化解耦为高内聚子模块，提升代码可读性与维护性，同时保持 100% 现有界面表现、交互行为与单元测试向后兼容。

---

## 模块拆分架构图

```
src/renderer/src/pages/
├── ScheduleBrowser.tsx                      <-- 瘦身为主状态调度器与顶层装配入口 (~350 行)
└── schedule/
    ├── schedule-types.ts                   <-- 领域类型、时段定义与详情数据模型
    ├── schedule-helpers.ts                 <-- 节次时段映射、周次判断、作息聚类纯函数（供单测与各视图复用）
    └── components/
        ├── ScheduleBadges.tsx              <-- LockDeadlineBadge 与 AssignmentStatusBadge
        ├── ScheduleHeaderBar.tsx           <-- 顶栏视图切换、学期下拉与图层开关
        ├── CourseDetailModal.tsx           <-- 课程全学期课表详情弹窗 (Apple HIG Modal)
        ├── ScheduleExportModal.tsx         <-- ICS 日历导出配置弹窗
        ├── CourseHoverPopover.tsx          <-- 鼠标悬停即显课程浮窗 (Hover Popover)
        ├── UndatedAssignmentsDrawer.tsx    <-- 未标注日期作业折叠浮窗与指示胶囊
        ├── WeekScheduleView.tsx            <-- 周视图：周次切换栏、顶部 DDL、7天×6时段跨行网格
        └── SemesterScheduleView.tsx        <-- 学期总览：全景作息网格、课程卡片、活动与作业时间轴
```

---

## 任务拆分与执行清单

### Task 1: 抽离领域类型与纯函数计算层 (`schedule-types.ts` & `schedule-helpers.ts`)
- **目标**: 提取接口与纯函数，`ScheduleBrowser.tsx` 转发导出，确保现有单元测试 `jiaowu-and-grid.test.ts` 无缝绿灯。
- **新建文件**:
  - `src/renderer/src/pages/schedule/schedule-types.ts`
  - `src/renderer/src/pages/schedule/schedule-helpers.ts`
- **修改文件**:
  - `src/renderer/src/pages/ScheduleBrowser.tsx`（以 re-export 方式保持所有已导出类型与函数导出签名不变）
- **验证门禁**:
  - `npm run typecheck` 0 错误
  - `npm test -- test/unit/jiaowu-and-grid.test.ts` 100% 通过
- **Commit**: `refactor(schedule): extract schedule-types and schedule-helpers pure calculation layer`

### Task 2: 抽离 UI 独立徽标与弹窗组件
- **目标**: 提取视觉徽标与 3 个独立弹窗/浮层组件。
- **新建文件**:
  - `src/renderer/src/pages/schedule/components/ScheduleBadges.tsx`
  - `src/renderer/src/pages/schedule/components/ScheduleExportModal.tsx`
  - `src/renderer/src/pages/schedule/components/CourseDetailModal.tsx`
  - `src/renderer/src/pages/schedule/components/CourseHoverPopover.tsx`
- **修改文件**:
  - `src/renderer/src/pages/ScheduleBrowser.tsx`（引入并挂载上述组件，re-export 徽标组件以兼容外部调用）
- **验证门禁**:
  - `npm run typecheck` 0 错误
  - `npm run lint` 0 错误 0 警告
  - `npm test` 全绿
- **Commit**: `refactor(schedule): extract ScheduleBadges and modals to standalone components`

### Task 3: 抽离顶栏、未标注日期浮窗与周视图 (`WeekScheduleView.tsx`)
- **目标**: 抽离控制顶栏、未标注日期浮窗以及复杂的周视图 7 天 × 6 时段跨行网格。
- **新建文件**:
  - `src/renderer/src/pages/schedule/components/ScheduleHeaderBar.tsx`
  - `src/renderer/src/pages/schedule/components/UndatedAssignmentsDrawer.tsx`
  - `src/renderer/src/pages/schedule/components/WeekScheduleView.tsx`
- **修改文件**:
  - `src/renderer/src/pages/ScheduleBrowser.tsx`
- **验证门禁**:
  - `npm run typecheck` 0 错误
  - `npm run lint` 0 错误 0 警告
  - `npm test` 全绿
- **Commit**: `refactor(schedule): extract ScheduleHeaderBar and WeekScheduleView components`

### Task 4: 抽离学期总览视图 (`SemesterScheduleView.tsx`)
- **目标**: 抽离学期全景作息网格、课程清单卡片、活动列表与作业时间轴。
- **新建文件**:
  - `src/renderer/src/pages/schedule/components/SemesterScheduleView.tsx`
- **修改文件**:
  - `src/renderer/src/pages/ScheduleBrowser.tsx`
- **验证门禁**:
  - `npm run typecheck` 0 错误
  - `npm run lint` 0 错误 0 警告
  - `npm test` 全绿
- **Commit**: `refactor(schedule): extract SemesterScheduleView component`

### Task 5: 最终集成与全系统三大门禁终验
- **目标**: 清理 `ScheduleBrowser.tsx` 中所有未使用的冗余代码与 import，行数收敛至约 350 行左右；执行三大严格门禁。
- **验证命令**:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test` (全量 43 个测试文件，883+ 测试用例 100% 绿灯)
- **Commit**: `refactor(schedule): finalize modular ScheduleBrowser architecture and clean imports`
