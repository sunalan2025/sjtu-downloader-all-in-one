# 前端模块与统一布局

本轮将云盘文件管理和共享课程浏览器拆分为功能模块，并把各主要页面的布局尺度收敛到公共组件和样式变量。已有业务入口保留兼容导出，后续可以按模块逐步迁移。

## 依赖方向

```text
pages/                         页面装配与导航入口
  ├─ features/cloud-drive/     云盘目录、操作、弹窗
  └─ features/course-explorer/ 三个课程来源共用的资源浏览器
       ↓
components/ui/                 Page / PageHeader / Toolbar / Button / Dialog / EmptyState
styles/layout.css              间距、尺寸、内容区、列表、弹窗规范
       ↓
shared/types + shared/theme    数据契约、纯工具、主题语义

window.api → preload → main/ipc → main/cloudpan + cloudpan-transfer
```

视图组件不直接发起云盘变更。`CloudDrive` 负责页面编排；`useDirectory` 负责目录请求和过期响应隔离；`useOperations` 负责提交、结果和异步任务查询；各弹窗只管理各自的交互状态。文件视图的选择事件携带文件与所属路径，防止分栏祖先目录中的操作误用当前路径。

## 模块职责

| 模块 | 负责内容 |
| --- | --- |
| `features/cloud-drive/directory.ts` | 完整目录分页、去重、搜索排序 |
| `features/cloud-drive/FileViews.tsx` | 列表、图标、分栏和界面分页 |
| `features/cloud-drive/DestinationDialog.tsx` | 目标文件夹与冲突策略 |
| `features/cloud-drive/MutationDialogs.tsx` | 新建、重命名、删除确认 |
| `features/cloud-drive/PreviewDialog.tsx` / `TrashDialog.tsx` | 预览与回收站 |
| `features/course-explorer/model.tsx` | 课程、分类、条目及对外属性类型 |
| `features/course-explorer/shared.tsx` | 分类、选择与共用呈现逻辑 |
| `features/course-explorer/GridView.tsx` / `ListView.tsx` / `ColumnView.tsx` | 各种视图 |
| `features/course-explorer/Inspectors.tsx` | 课程、分类与文件详情面板 |
| `features/course-explorer/Explorer.tsx` | 浏览路径、视图切换和页面编排 |

`components/NetdiskCourseExplorer.tsx` 和 `pages/CloudPanExplorer.tsx` 保持轻量入口。主进程 `cloudpan.ts` 同样保留兼容导出，实际实现拆到 `client.ts`、`files.ts`、`operations.ts`、`trash.ts`、`upload.ts`。

## 统一视觉尺度

| 用途 | 规范 |
| --- | --- |
| 页面左右与内容边距 | 20px；窗口宽度 ≤1100px 时为 16px |
| 页面标题 | 18px，使用统一 PageHeader |
| 标题说明 | 12px，位于标题下方 |
| 标题区 | 最小高度 76px，允许动作区自然换行 |
| 工具栏 | 上下 10px，操作间隔 8px，可换行 |
| 标准按钮、输入框 | 最小高度 36px |
| 面板间距与内边距 | 16px |
| 标准列表行 | 最小高度 48px |
| 弹窗 | 限制在可视窗口内，正文独立滚动，保留可见操作区 |

课程页、云盘、资源库、传输中心、课表与设置页已接入统一页面标题和内容间距。设置长控件允许换行/局部滚动；多层 flex 容器显式设置 `min-width: 0` / `min-height: 0`，避免内容把页面撑出窗口。

补全了此前引用但未定义的 Tailwind 字号 `3xs`（10px，用于紧凑辅助标签），以及 `0.2` 间距、`2xs` 阴影和 `xs` 背景模糊别名。主要正文仍使用 12–14px。课表折叠午间提示跨越一整行，不再挤入周一单元格。

背景色 token `base` 只映射到 `backgroundColor`，避免生成同名文字颜色覆盖 `text-base` 字号工具。该冲突此前会把浅色主题下的弹窗标题染成接近白色；生成 CSS 的回归测试覆盖这一点。

## 后续开发约定

1. 新页面先使用 `Page`、`PageHeader`、`Toolbar` 和 `ui-content`；不要重新定义一套标题字号和页面边距。
2. 新按钮优先用 `Button`；特殊图标按钮、导航标签可保留自己的布局，不全局修改所有 button 的尺寸。
3. 弹窗使用公共 `Dialog`，获得原生焦点约束、Esc 关闭和焦点恢复；执行变更时禁止重复提交。
4. 业务状态属于功能目录，纯渲染组件通过属性接收数据和回调；共享目录不得导入主进程模块。Node 路径工具已移到 `main/utils/paths.ts`，避免渲染构建引入 `node:path`。
5. IPC 改动同步更新共享类型和 preload；参数校验放在主进程，不能只依赖按钮禁用。
6. 新增视图需检查长标题、空态、错误态、1024px 窗口与深浅主题。分栏/课表可在内容区水平滚动，不能撑大整个应用。

本轮没有重写所有业务模块。设置页和课表的数据编排仍在原目录，统一了外层布局；后续可沿相同边界继续拆分，不需要一次性更换状态管理框架。
