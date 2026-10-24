// DownloadUI — barrel re-export。
//
// [Phase 3 拆分] 本文件原为 1043 行的混合组件库，按内聚拆为：
//   - widgets.tsx           视觉原语（复选框 / 图标 / 文件徽标 / macOS 风格视觉件 / 下拉 / 视图切换器）
//   - progress-primitives.tsx  下载进度原语（状态机文案 / 进度条 / 任务控制 / 资源类型分段 / 课程级摘要）
//
// 保持既有 `from './DownloadUI'` / `from '../components/DownloadUI'` 导入路径不变，
// 7 个消费方（NetdiskCourseExplorer / TitleBar / AuditedCourses / CanvasBrowser /
// CloudPanExplorer / CnmoocBrowser / TransferCenter + DownloadUI.test.ts）零改动。
// 新代码请直接从对应模块导入。

export type { TriState } from './widgets'
export { triStateFromCount } from './widgets'
export { formatBytes } from './progress-primitives'
export { stateLabel, stateHint } from './progress-primitives'
export { ProgressBar } from './progress-primitives'
export { GlobalCtrlButton, TaskCtrlButtons, TaskCtrlBtn } from './progress-primitives'
export { ResourceTypeSegmented } from './progress-primitives'
export { CourseProgressSummary } from './progress-primitives'
export { CtrlIcon } from './progress-primitives'
export { TriCheckbox, SmallCheck, Chevron, ItemCheckbox } from './widgets'
export { FileTypeBadge, FolderIcon } from './widgets'
export { DropdownSelect, type DropdownOption, type DropdownGroup } from './widgets'
export { MacOSFolderIcon, MacOSDocumentIcon, MacOSCircleCheckbox } from './widgets'
export { NetdiskViewModeSwitch } from './widgets'
