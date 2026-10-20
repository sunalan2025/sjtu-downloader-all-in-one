import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useShallow } from 'zustand/shallow'
import type { AuthStatus, CanvasAssignmentExportOptions, CloudPanSpaceInfo, Course, DownloadMode, FileConflictStrategy, DownloadProgress, DownloadState, VideoTask, ActiveTab, CanvasLectureGroup, CanvasCourse, CanvasTeacherSelection, CanvasVideoSession, CnmoocChapter, CnmoocCourse, CnmoocResourceFilter, DownloadHistoryItem, VideoQualityOption } from '@shared/types'
import { DEFAULT_NAMING_TEMPLATE } from '@shared/utils'

/** 应用主 stage：欢迎页 → 登录 → 浏览器/下载界面 */
export type Stage = 'welcome' | 'login' | 'browser'

/** 扫描状态机（旁听课程和 Canvas 课程共用） */
export type ScanState = 'idle' | 'scanning' | 'done' | 'error'

/** UI 主题偏好 */
export type Theme = 'light' | 'dark' | 'system'

/** 窗口关闭行为：tray=最小化到托盘，taskbar=最小化到任务栏，quit=彻底退出应用 */
export type WindowCloseAction = 'tray' | 'taskbar' | 'quit'

/** 正在下载时关闭窗口的策略：prompt=始终弹窗询问，background=自动转入托盘继续下载，pause_quit=自动暂停任务并退出应用 */
export type ExitWhenDownloadingPolicy = 'prompt' | 'background' | 'pause_quit'

/** 网盘式课程导航视图模式：grid=网格大图标，list=详细列表，column=分栏多级并列 */
export type CourseViewMode = 'grid' | 'list' | 'column'

/** renderer 侧讲次分组类型，与 shared/types 的 CanvasLectureGroup 同构 */
export type LectureGroup = CanvasLectureGroup

interface AppState {
  theme: Theme
  stage: Stage
  activeTab: ActiveTab
  auth: AuthStatus
  // v.sjtu 旁听课程扫描结果
  scanState: ScanState
  scanMessage: string
  courses: Course[]
  /** 每门课对应的全部视频任务（每节课 2 条：教师 + PPT） */
  tasksByCourse: Record<number, VideoTask[]>
  // 用户选择
  selected: Set<string>
  /** 展开的课程 id */
  expandedCourses: Set<number>
  // Canvas 课程状态
  canvasCourses: CanvasCourse[]
  canvasScanState: ScanState
  canvasScanMessage: string
  canvasExpandedCourses: Set<number>
  /** Canvas 课程文件扫描结果 */
  canvasCourseData: Record<number, {
    files: import('@shared/types').CanvasFileItem[]
    folderMap: Record<number, string>
    moduleFiles: import('@shared/types').CanvasFileItem[]
    syllabusFiles: import('@shared/types').CanvasFileItem[]
    assignments?: import('@shared/types').CanvasAssignmentItem[]
  }>
  /** Canvas 课堂视频会话 */
  canvasVideoSessions: Record<number, CanvasVideoSession[]>
  /** Canvas 教师选择 */
  canvasTeachers: Record<number, CanvasTeacherSelection[]>
  canvasSelectedTeachers: Record<number, string[]>
  /** Canvas LTI token 缓存 */
  canvasLtiTokens: Record<number, { token: string; canvasCourseId: string }>
  /** Canvas 讲次分组（courseId → lectures[]） */
  canvasLectures: Record<number, LectureGroup[]>
  /** Canvas 模块内嵌视频（iframe 页面，HLS 下载） */
  canvasModuleVideos: Record<number, {
    iframes: Array<{ moduleName: string; pageTitle: string; iframeUrl: string }>
    extTools: Array<{ moduleItemId: number; fileId: string; title: string }>
    extUrls: Array<{ uuid: string; title: string }>
  }>
  /** 每门课程的分类选择（预设置：课件/教师/PPT/模块视频/PPT课件PDF/作业与提交） */
  canvasCourseCategorySelections: Record<number, { files: boolean; teacher: boolean; ppt: boolean; moduleVideo: boolean; pptPdf: boolean; assignments?: boolean }>
  /** 每门课程已提交下载的 taskIds（processCourse 写入）。
   *  独立于扫描数据，deleteCanvasCourseData 不清空它 → 下载完成后进度条仍能显示 done/total，
   *  直到 resetProgress/刷新整个清空。用于 CourseProgressSummary 在扫描数据被清后的回退统计。 */
  canvasCourseTaskIds: Record<number, string[]>
  // 好大学在线 (cnmooc) 状态
  cnmoocCourses: CnmoocCourse[]
  cnmoocScanState: ScanState
  cnmoocScanMessage: string
  /** 展开的 cnmooc 课程 id（courseId 为字符串） */
  cnmoocExpandedCourses: Set<string>
  /** cnmooc 课程章节扫描结果（courseId → chapters） */
  cnmoocCourseData: Record<string, { chapters: CnmoocChapter[] }>
  /** 资源类型过滤：all=不过滤，video=仅视频，document=仅课件（下载时懒解析后过滤） */
  cnmoocResourceFilter: CnmoocResourceFilter
  // 交大云盘
  cloudUserToken: string | null
  cloudSpaceInfo: CloudPanSpaceInfo | null
  // [2.14] Cloud connection status shared across tabs (was per-component useState)
  cloudConnStatus: 'idle' | 'connecting' | 'error'
  cloudConnMessage: string
  // 下载模式
  downloadMode: DownloadMode
  /** 同名文件冲突策略：skip=跳过，overwrite=先删除再下载/上传 */
  fileConflictStrategy: FileConflictStrategy
  localDestRoot: string
  /** 云盘备份保存的根目录（默认 '/SJTU课程备份'） */
  cloudDestRoot: string
  /** HLS 模块视频重编码目标高度（720/1080）；不设置 = 不重编码（保留原始质量）。
   *  解决 tv.sjtu.edu.cn 超高分辨率 I-frame-only 源在系统播放器中花屏/卡死的问题。 */
  hlsTranscodeMaxHeight?: 720 | 1080
  /** 检测到新版本时是否自动后台下载安装包（默认 false）。
   *  下载完成停在 ready 等用户确认安装，不自动重启打断使用。 */
  autoDownloadUpdate: boolean
  /** both 模式下 localTaskId → cloudTaskId 映射，用于进度聚合 */
  cloudLinkedIds: Record<string, string>
  // 下载状态
  downloading: boolean
  progress: Record<string, DownloadProgress>
  /** 本轮 onDownload 提交的 taskId 集合（含 PPT 聚合 + iframe HLS + 常规文件，不含 _cloud 镜像）。
   *  OverallProgressBar 据此统计 done/active/total，而非遍历 progress 全表——
   *  total 精准反映勾选并入队的任务数，扫描占位 / 未勾选残留不计入。resetProgress 同步清空。 */
  batchTaskIds: string[]
  /** 全局下载限速（KB/s，0 = 不限速） */
  maxDownloadSpeedKBps: number
  /** 自定义文件/目录命名模板 */
  namingTemplate: string
  /** 视频下载画质/纯音频选项 */
  videoQualityOption: VideoQualityOption
  /** 已下载历史记录 */
  downloadHistory: DownloadHistoryItem[]
  /** 并发下载数，2-16，会同步到主进程。0 = 自动 */
  concurrency: number
  /** 网盘式课程导航视图模式：grid=网格大图标，list=详细列表，column=分栏多级并列 */
  courseViewMode: CourseViewMode
  /** Canvas 课程是否按学期分栏展示（默认 true） */
  canvasGroupByTerm: boolean
  /** Canvas 当前选中的学期过滤（'all' 或学期名称） */
  canvasSelectedTerm: string
  /** 课表当前选中的学期（'current' 或教务系统学期 key） */
  scheduleSelectedSemesterKey: string
  /** 课表视图模式：'week' (周视图) | 'semester' (学期总览) */
  scheduleViewMode: 'week' | 'semester'
  /** Apple 日历图层开关：排课、讲座/活动、作业 DDL */
  scheduleLayerFilter: { course: boolean; activity: boolean; ddl: boolean }
  /** 课表中午时段展开状态 */
  scheduleExpandNoonSlot: boolean
  /** 上一次激活的内容课程 tab（canvas / audited / cnmooc / schedule） */
  lastCourseTab: 'canvas' | 'audited' | 'cnmooc' | 'schedule'
  /** 关闭主窗口时的默认动作（tray=最小化到托盘，taskbar=最小化到任务栏，quit=彻底退出应用） */
  windowCloseAction: WindowCloseAction
  /** 正在下载时关闭窗口的策略（prompt=始终弹窗询问，background=自动转入托盘继续下载，pause_quit=自动暂停任务并退出应用） */
  exitWhenDownloading: ExitWhenDownloadingPolicy
  /** 是否已完成首次登录后的初始化配置向导 */
  hasCompletedInitialSetup: boolean
  /** 上次完成初始偏好设置/版本确认的应用版本号（例如 '2.4.1'） */
  lastSetupVersion: string | null
  /** 是否显示全局初始设置/版本更新确认模态弹窗 */
  showSetupWizardModal: boolean
  /** PPT 讲义导出时是否同时保留高清切片图片目录 */
  pptSaveImages: boolean
  /** 课堂视频下载时是否同步导出 AI 字幕 (.srt) 与逐字稿笔记 (.md)（兼容字段，与 canvasExportSrt || canvasExportMarkdown 联动） */
  canvasExportAiTranscript: boolean
  /** 课堂视频下载时是否同步导出 SRT 字幕文件（默认 true） */
  canvasExportSrt: boolean
  /** 课堂视频下载时是否同步导出 Markdown 格式逐字稿（默认 true） */
  canvasExportMarkdown: boolean
  /** Canvas 课程作业与提交归档导出选项 */
  canvasAssignmentOptions: CanvasAssignmentExportOptions
  // setters
  /** 切换 AI 字幕与逐字稿导出开关（向下兼容向导与旧设置，联动更新 srt 和 markdown） */
  setCanvasExportAiTranscript: (on: boolean) => void
  /** 切换课堂视频 SRT 字幕导出开关 */
  setCanvasExportSrt: (on: boolean) => void
  /** 切换课堂视频 Markdown 逐字稿导出开关 */
  setCanvasExportMarkdown: (on: boolean) => void
  /** 更新 Canvas 课程作业导出选项 */
  setCanvasAssignmentOptions: (
    opts:
      | Partial<CanvasAssignmentExportOptions>
      | ((prev: CanvasAssignmentExportOptions) => CanvasAssignmentExportOptions)
  ) => void
  /** 标记是否完成首次初始化配置 */
  setHasCompletedInitialSetup: (completed: boolean) => void
  /** 记录上次完成向导确认的应用版本号 */
  setLastSetupVersion: (version: string | null) => void
  /** 控制是否显示全局初始设置/版本更新确认模态弹窗 */
  setShowSetupWizardModal: (show: boolean) => void
  /** 切换关闭主窗口动作偏好 */
  setWindowCloseAction: (action: WindowCloseAction) => void
  /** 切换正在下载时关闭策略偏好 */
  setExitWhenDownloading: (policy: ExitWhenDownloadingPolicy) => void
  /** 切换 UI 主题（dark/light/system） */
  setTheme: (t: Theme) => void
  /** 切换网盘式课程导航视图模式 */
  setCourseViewMode: (mode: CourseViewMode) => void
  /** 切换 Canvas 课程是否按学期分栏展示 */
  setCanvasGroupByTerm: (groupByTerm: boolean) => void
  /** 切换 Canvas 当前选中的学期过滤 */
  setCanvasSelectedTerm: (term: string) => void
  /** 切换课表选中的学期 */
  setScheduleSelectedSemesterKey: (key: string) => void
  /** 切换课表视图模式 */
  setScheduleViewMode: (mode: 'week' | 'semester') => void
  /** 切换课表图层筛选 */
  setScheduleLayerFilter: (filter: Partial<{ course: boolean; activity: boolean; ddl: boolean }> | ((prev: { course: boolean; activity: boolean; ddl: boolean }) => { course: boolean; activity: boolean; ddl: boolean })) => void
  /** 切换课表中午时段展开状态 */
  setScheduleExpandNoonSlot: (expand: boolean) => void
  /** 记录上一次激活的课程 tab */
  setLastCourseTab: (tab: 'canvas' | 'audited' | 'cnmooc') => void
  /** 切换主界面 stage */
  setStage: (s: Stage) => void
  /** 切换顶部 tab（旁听/Canvas） */
  setActiveTab: (t: ActiveTab) => void
  /** 更新 v.sjtu 登录状态 */
  setAuth: (a: AuthStatus) => void
  /** 更新旁听课程扫描状态和消息 */
  setScan: (s: ScanState, msg?: string) => void
  /** 替换全部旁听课程列表 */
  setCourses: (c: Course[]) => void
  /** 设置指定课程的视频任务列表 */
  setTasksForCourse: (id: number, t: VideoTask[]) => void
  /** 清空旁听课程扫描结果和选中态 */
  resetScanResults: () => void
  /** 覆盖全选集合 */
  setSelected: (s: Set<string>) => void
  /** 切换单个 taskId 的选中状态 */
  toggleSelect: (taskId: string) => void
  /** 批量设置多个 taskId 的选中状态 */
  toggleSelectMany: (ids: string[], on: boolean) => void
  /** 切换课程的展开/折叠状态 */
  toggleExpand: (courseId: number) => void
  // Canvas setters
  /** 替换全部 Canvas 课程列表 */
  setCanvasCourses: (c: CanvasCourse[]) => void
  /** 更新 Canvas 课程扫描状态和消息 */
  setCanvasScanState: (s: ScanState, msg?: string) => void
  /** 切换 Canvas 课程的展开/折叠状态 */
  toggleCanvasExpand: (courseId: number) => void
  /** 设置指定 Canvas 课程的文件扫描数据 */
  setCanvasCourseData: (id: number, data: AppState['canvasCourseData'][number]) => void
  /** 设置指定 Canvas 课程的课堂视频会话列表 */
  setCanvasVideoSessions: (id: number, sessions: CanvasVideoSession[]) => void
  /** 设置指定 Canvas 课程的教师筛选选项 */
  setCanvasTeachers: (id: number, teachers: CanvasTeacherSelection[]) => void
  /** 设置指定 Canvas 课程已选中的教师列表 */
  setCanvasSelectedTeachers: (id: number, teachers: string[]) => void
  /** 缓存指定 Canvas 课程的 LTI token 和 canvasCourseId */
  setCanvasLtiToken: (id: number, data: { token: string; canvasCourseId: string }) => void
  /** 设置指定 Canvas 课程的讲次分组列表 */
  setCanvasLectures: (id: number, lectures: LectureGroup[]) => void
  /** 设置指定 Canvas 课程的模块内嵌视频列表 */
  setCanvasModuleVideos: (id: number, videos: {
    iframes: Array<{ moduleName: string; pageTitle: string; iframeUrl: string }>
    extTools: Array<{ moduleItemId: number; fileId: string; title: string }>
    extUrls: Array<{ uuid: string; title: string }>
  }) => void
  /** 更新指定 Canvas 课程的分类选择（课件/教师/PPT/模块视频/作业） */
  setCanvasCourseCategorySelection: (id: number, sel: Partial<{ files: boolean; teacher: boolean; ppt: boolean; moduleVideo: boolean; pptPdf: boolean; assignments: boolean }>) => void
  /** 批量更新多个 Canvas 课程的分类选择 */
  setAllCanvasCourseCategorySelections: (ids: number[], sel: Partial<{ files: boolean; teacher: boolean; ppt: boolean; moduleVideo: boolean; pptPdf: boolean; assignments: boolean }>) => void
  /** 清空所有 Canvas 课程扫描数据和选中态 */
  resetCanvasScanResults: () => void
  /** 删除单门课程的扫描数据，释放内存 */
  deleteCanvasCourseData: (id: number) => void
  /** 设置单门 Canvas 课程已提交下载的 taskIds（processCourse 写入，deleteCanvasCourseData 不清空） */
  setCanvasCourseTaskIds: (id: number, taskIds: string[]) => void
  // ─── cnmooc setters ───
  /** 替换全部好大学在线课程列表 */
  setCnmoocCourses: (c: CnmoocCourse[]) => void
  /** 更新好大学在线扫描状态和消息 */
  setCnmoocScanState: (s: ScanState, msg?: string) => void
  /** 切换好大学在线课程的展开/折叠状态 */
  toggleCnmoocExpand: (courseId: string) => void
  /** 设置指定好大学在线课程的章节扫描数据 */
  setCnmoocCourseData: (id: string, data: { chapters: CnmoocChapter[] }) => void
  /** 设置好大学在线资源类型过滤（全部/仅视频/仅课件） */
  setCnmoocResourceFilter: (f: CnmoocResourceFilter) => void
  /** 清空所有好大学在线扫描数据和选中态 */
  resetCnmoocScanResults: () => void
  /** 删除单门好大学在线课程的扫描数据，释放内存 */
  deleteCnmoocCourseData: (id: string) => void
  // 共享 setters
  /** 设置交大云盘 USER_TOKEN */
  setCloudUserToken: (token: string | null) => void
  /** 更新云盘空间容量信息 */
  setCloudSpaceInfo: (info: CloudPanSpaceInfo | null) => void
  // [2.14] Setters for shared cloud connection status
  setCloudConnStatus: (status: 'idle' | 'connecting' | 'error', message?: string) => void
  /** 切换下载模式（local/cloud/both） */
  setDownloadMode: (m: DownloadMode) => void
  /** 设置同名文件冲突策略（skip/overwrite） */
  setFileConflictStrategy: (s: FileConflictStrategy) => void
  /** 设置 HLS 重编码目标高度 */
  setHlsTranscodeMaxHeight: (h?: 720 | 1080) => void
  /** 设置「检测到新版自动下载」开关 */
  setAutoDownloadUpdate: (on: boolean) => void
  /** 设置本地下载目录路径 */
  setLocalDestRoot: (p: string) => void
  /** 设置云盘备份保存的根目录路径 */
  setCloudDestRoot: (p: string) => void
  /** 更新 both 模式下 localTaskId → cloudTaskId 的映射 */
  setCloudLinkedIds: (m: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void
  /** 标记是否有任务正在下载中 */
  setDownloading: (b: boolean) => void
  /** 清空所有下载进度记录 */
  resetProgress: () => void
  /** 清空已完成/跳过/失败的终态任务进度记录 */
  clearCompletedProgress: () => void
  /** 追加本轮提交的 taskId（去重）。入队时调用，供 OverallProgressBar 精准统计。 */
  addBatchTaskIds: (ids: string[]) => void
  /** 清空 batchTaskIds（不动 progress）。Browser/Cnmooc onDownload 入口调用——
   *  这两页依赖 progress 跨批次残留的 done 态「跳过已完成任务」(不能 resetProgress)，
   *  但 batchTaskIds 是追加集，跨批次会累积进 total，故每轮单独清空。Canvas 用 resetProgress 一并清。 */
  resetBatchTaskIds: () => void
  /** 幽灵兜底：把 batchTaskIds 里非终态任务标 cancelled。
   *  cancelAll 后或下载循环收尾时调用，确保 OverallProgressBar active 归零、downloading 解除。
   *  防主进程漏发终态导致 active 永不归零（真幽灵）。 */
  markBatchPendingCancelled: () => void
  /** 合并单条下载进度到进度表 */
  applyProgress: (p: DownloadProgress) => void
  /** 设置全局下载限速（KB/s） */
  setMaxDownloadSpeedKBps: (n: number) => void
  /** 设置自定义命名模板 */
  setNamingTemplate: (t: string) => void
  /** 设置视频下载画质/纯音频选项 */
  setVideoQualityOption: (q: VideoQualityOption) => void
  /** 新增已下载历史记录 */
  addDownloadHistory: (item: DownloadHistoryItem) => void
  /** 移除单条已下载历史记录 */
  removeDownloadHistoryItem: (taskId: string) => void
  /** 从进度表删除单条（含 _cloud 镜像）——仅终态条目可删。
   *  TransferCenter「移除」用：提交失败等主进程不认识的任务，cancel 后主进程
   *  不会回发终态，行会永远留在列表里；本地直接删除即可。 */
  removeProgressItem: (taskId: string) => void
  /** 清空所有已下载历史记录 */
  clearDownloadHistory: () => void
  /** 设置下载并发数（0 = 自动） */
  setConcurrency: (n: number) => void
  /** 切换 PPT 讲义切片原图保存开关 */
  setPptSaveImages: (on: boolean) => void
}

const emptyScanResults = {
  scanState: 'idle' as ScanState,
  scanMessage: '',
  courses: [] as Course[],
  tasksByCourse: {} as Record<number, VideoTask[]>,
  selected: new Set<string>(),
  expandedCourses: new Set<number>(),
  progress: {} as Record<string, DownloadProgress>,
  downloading: false
}

const clampConcurrency = (n: number): number =>
  Math.max(1, Math.min(16, Math.floor(Number.isFinite(n) ? n : 3) || 3))

/** both 模式下，把云端进度合并到本地 taskId 对应的条目上；
 *  单任务组件（AngleCell）直接订阅此 selector 即可拿到聚合后的状态。
 *
 *  实现要点：订阅 local + cloud 两个独立引用，合并放在 render 阶段（非 selector 内），
 *  这样只有当该任务自身的 local 或 cloud 进度真正变化时才触发重渲染，
 *  避免"每次任意任务进度更新 → 所有 AngleCell 全部重渲染"的级联风暴。 */
export function useEffectiveProgress(taskId: string): DownloadProgress | undefined {
  const [local, cloud] = useAppStore(
    useShallow(s => {
      // [Bug Fix] 仅在 both 模式下才查云端镜像并合并。原先只要 cloudLinkedIds[taskId]
      // 存在就合并，而 cloudLinkedIds 在 both 模式跑完后并不清空 → 用户切到 local/cloud
      // 单模式后，进度条仍显示"本地完成 · 云端上传中"等陈旧合并态，直到下次下载开始。
      // 加 downloadMode === 'both' 守卫，单模式下直接走本地进度分支。
      const cloudId = s.downloadMode === 'both' ? s.cloudLinkedIds[taskId] : undefined
      return [s.progress[taskId], cloudId ? s.progress[cloudId] : undefined]
    })
  )

  if (!cloud) return local   // 非 both 模式或该任务无云端镜像 → 直接返回本地进度

  const localDone = local?.state === 'done' || local?.state === 'skipped'
  const cloudDone = cloud?.state === 'done' || cloud?.state === 'skipped'
  const eitherError = local?.state === 'error' || cloud?.state === 'error'
  let mergedState: DownloadState = local?.state ?? 'pending'
  let mergedMsg = local?.message
  let mergedReceived = local?.received ?? 0
  let mergedTotal = local?.total ?? 0
  if (eitherError) {
    mergedState = 'error'
    mergedMsg = local?.state === 'error' ? local?.message : cloud?.message
  } else if (localDone && cloudDone) {
    mergedState = 'done'
  } else if (localDone && !cloudDone) {
    // 本地已完成、云端未完成：按云端真实态细分，避免 cancelled/paused 也误显"上传中"
    if (cloud?.state === 'cancelled') {
      // 云端已取消（用户主动放弃云端副本）→ 本地已完成即视为该任务完成
      mergedState = 'done'
    } else if (cloud?.state === 'paused') {
      mergedState = 'downloading'
      mergedMsg = '本地完成 · 云端已暂停'
    } else {
      // 云端上传中（或排队中）→ 显示云端上传进度，pct 由 ProgressBar 单独展示
      mergedState = 'downloading'
      mergedReceived = cloud?.received ?? 0
      mergedTotal = cloud?.total ?? 0
      mergedMsg = '本地完成 · 云端上传中'
    }
  }
  return { taskId, state: mergedState, received: mergedReceived, total: mergedTotal, message: mergedMsg }
}

/** 顶层下载统计：对一组 taskIds 聚合 done/failed/active 计数返回。
 *  只有当 done/failed/active 任一计数真正变化时才触发重渲染 ——
 *  避免每条任务每 2s 的进度回调都让顶层 Browser/CanvasBrowser + ActionBar 重渲。
 *
 *  返回 { done, failed, active }；active = 尚未到达终态（含 pending/downloading/paused）的任务数。
 *  allFinal ≡ active === 0（当 taskIds 非空时）。
 *
 *  [Bug Fix] 原实现用 done*1e8+failed*1e4+active 编码成单个 number 以走原始值比较，
 *  但 failed≥10000 溢出到 done 位、active≥10000 溢出到 failed 位（Canvas 50 课×200 文件即触发）。
 *  useShallow 已能正确浅比较对象，编码冗余且有溢出风险，改回对象返回。 */
export function useDownloadStats(
  taskIds: string[],
  isBothMode: boolean
): { done: number; failed: number; active: number } {
  return useAppStore(useShallow(s => {
    let done = 0
    let failed = 0
    let active = 0
    for (const id of taskIds) {
      const st = s.progress[id]?.state
      if (isBothMode) {
        const cloudId = s.cloudLinkedIds[id]
        const cloudSt = cloudId ? s.progress[cloudId]?.state : undefined
        const localFinal = st === 'done' || st === 'skipped' || st === 'error' || st === 'cancelled'
        const cloudFinal = !cloudId || cloudSt === 'done' || cloudSt === 'skipped' || cloudSt === 'error' || cloudSt === 'cancelled'
        if (st === 'error' || cloudSt === 'error') failed++
        const localDone = st === 'done' || st === 'skipped'
        const cloudDone = !cloudId || cloudSt === 'done' || cloudSt === 'skipped' || cloudSt === 'cancelled'
        if (localDone && cloudDone) done++
        if (!(localFinal && cloudFinal)) active++
      } else {
        if (st === 'done' || st === 'skipped') done++
        else if (st === 'error') failed++
        else if (st !== 'cancelled') active++
      }
    }
    return { done, failed, active }
  }))
}

// applyProgress 的批处理缓冲（模块级，便于 resetProgress 同步清零，见下）。
let progressPending: Map<string, DownloadProgress> | null = null
let progressScheduled = false

export const useAppStore = create<AppState>()(
  persist(
    set => ({
      theme: 'system',
      stage: 'welcome',
      activeTab: 'audited' as ActiveTab,
      auth: { loggedIn: false },
      ...emptyScanResults,
      // Canvas 状态
      canvasCourses: [] as CanvasCourse[],
      canvasScanState: 'idle' as ScanState,
      canvasScanMessage: '',
      canvasExpandedCourses: new Set<number>(),
      canvasCourseData: {},
      canvasVideoSessions: {},
      canvasTeachers: {},
      canvasSelectedTeachers: {},
      canvasLtiTokens: {},
      canvasLectures: {},
      canvasModuleVideos: {},
      canvasCourseCategorySelections: {},
      canvasCourseTaskIds: {},
      // 好大学在线 (cnmooc)
      cnmoocCourses: [] as CnmoocCourse[],
      cnmoocScanState: 'idle' as ScanState,
      cnmoocScanMessage: '',
      cnmoocExpandedCourses: new Set<string>(),
      cnmoocCourseData: {},
      cnmoocResourceFilter: 'all' as CnmoocResourceFilter,
      // 共享
      cloudUserToken: null,
      cloudSpaceInfo: null,
      cloudConnStatus: 'idle' as 'idle' | 'connecting' | 'error',
      cloudConnMessage: '',
      downloadMode: 'cloud',
      fileConflictStrategy: 'skip' as FileConflictStrategy,
      localDestRoot: '',
      cloudDestRoot: '/SJTU课程备份',
      cloudLinkedIds: {},
      batchTaskIds: [],
      concurrency: 3,
      autoDownloadUpdate: false,
      courseViewMode: 'grid' as CourseViewMode,
      canvasGroupByTerm: true,
      canvasSelectedTerm: 'all',
      scheduleSelectedSemesterKey: 'current',
      scheduleViewMode: 'week' as 'week' | 'semester',
      scheduleLayerFilter: { course: true, activity: true, ddl: true },
      scheduleExpandNoonSlot: false,
      lastCourseTab: 'canvas' as 'canvas' | 'audited' | 'cnmooc',
      windowCloseAction: 'tray' as WindowCloseAction,
      exitWhenDownloading: 'prompt' as ExitWhenDownloadingPolicy,
      hasCompletedInitialSetup: false,
      lastSetupVersion: null,
      showSetupWizardModal: false,
      pptSaveImages: false,
      canvasExportAiTranscript: true,
      canvasExportSrt: true,
      canvasExportMarkdown: true,
      canvasAssignmentOptions: {
        exportMarkdown: true,
        downloadAttachments: true,
        downloadSubmissions: true
      },
      setHasCompletedInitialSetup: hasCompletedInitialSetup => set({ hasCompletedInitialSetup }),
      setLastSetupVersion: lastSetupVersion => set({ lastSetupVersion }),
      setShowSetupWizardModal: showSetupWizardModal => set({ showSetupWizardModal }),
      setPptSaveImages: pptSaveImages => set({ pptSaveImages }),
      setCanvasExportAiTranscript: canvasExportAiTranscript =>
        set({
          canvasExportAiTranscript,
          canvasExportSrt: canvasExportAiTranscript,
          canvasExportMarkdown: canvasExportAiTranscript
        }),
      setCanvasExportSrt: on =>
        set(state => ({
          canvasExportSrt: on,
          canvasExportAiTranscript: on || state.canvasExportMarkdown
        })),
      setCanvasExportMarkdown: on =>
        set(state => ({
          canvasExportMarkdown: on,
          canvasExportAiTranscript: state.canvasExportSrt || on
        })),
      setCanvasAssignmentOptions: opts =>
        set(state => ({
          canvasAssignmentOptions:
            typeof opts === 'function'
              ? opts(state.canvasAssignmentOptions)
              : { ...state.canvasAssignmentOptions, ...opts }
        })),
      setWindowCloseAction: windowCloseAction => set({ windowCloseAction }),
      setExitWhenDownloading: exitWhenDownloading => set({ exitWhenDownloading }),
      setTheme: theme => set({ theme }),
      setCourseViewMode: courseViewMode => set({ courseViewMode }),
      setCanvasGroupByTerm: canvasGroupByTerm => set({ canvasGroupByTerm }),
      setCanvasSelectedTerm: canvasSelectedTerm => set({ canvasSelectedTerm }),
      setScheduleSelectedSemesterKey: scheduleSelectedSemesterKey => set({ scheduleSelectedSemesterKey }),
      setScheduleViewMode: scheduleViewMode => set({ scheduleViewMode }),
      setScheduleLayerFilter: filter => set(state => ({
        scheduleLayerFilter: typeof filter === 'function'
          ? (filter as (prev: { course: boolean; activity: boolean; ddl: boolean }) => { course: boolean; activity: boolean; ddl: boolean })(state.scheduleLayerFilter)
          : { ...state.scheduleLayerFilter, ...filter }
      })),
      setScheduleExpandNoonSlot: scheduleExpandNoonSlot => set({ scheduleExpandNoonSlot }),
      setLastCourseTab: lastCourseTab => set({ lastCourseTab }),
      setStage: stage => set({ stage }),
      setActiveTab: activeTab => set(state => {
        const isCourse = activeTab === 'canvas' || activeTab === 'audited' || activeTab === 'cnmooc' || activeTab === 'schedule'
        return {
          activeTab,
          lastCourseTab: isCourse ? activeTab : state.lastCourseTab
        }
      }),
      setAuth: auth => set({ auth }),
      setScan: (scanState, scanMessage = '') => set({ scanState, scanMessage }),
      setCourses: courses => set({ courses }),
      setTasksForCourse: (id, tasks) =>
        set(state => ({ tasksByCourse: { ...state.tasksByCourse, [id]: tasks } })),
      resetScanResults: () => {
        progressPending = null
        progressScheduled = false
        set(emptyScanResults)
      },
      setSelected: selected => set({ selected }),
      toggleSelect: taskId =>
        set(state => {
          const next = new Set(state.selected)
          if (next.has(taskId)) next.delete(taskId)
          else next.add(taskId)
          return { selected: next }
        }),
      toggleSelectMany: (ids, on) =>
        set(state => {
          const next = new Set(state.selected)
          for (const id of ids) {
            if (on) next.add(id)
            else next.delete(id)
          }
          return { selected: next }
        }),
      toggleExpand: courseId =>
        set(state => {
          const next = new Set(state.expandedCourses)
          if (next.has(courseId)) next.delete(courseId)
          else next.add(courseId)
          return { expandedCourses: next }
        }),
      // ─── Canvas setters ───
      setCanvasCourses: canvasCourses => set({ canvasCourses }),
      setCanvasScanState: (canvasScanState, canvasScanMessage = '') => set({ canvasScanState, canvasScanMessage }),
      toggleCanvasExpand: courseId =>
        set(state => {
          const next = new Set(state.canvasExpandedCourses)
          if (next.has(courseId)) next.delete(courseId)
          else next.add(courseId)
          return { canvasExpandedCourses: next }
        }),
      setCanvasCourseData: (id, data) =>
        set(state => ({ canvasCourseData: { ...state.canvasCourseData, [id]: data } })),
      setCanvasVideoSessions: (id, sessions) =>
        set(state => ({ canvasVideoSessions: { ...state.canvasVideoSessions, [id]: sessions } })),
      setCanvasTeachers: (id, teachers) =>
        set(state => ({ canvasTeachers: { ...state.canvasTeachers, [id]: teachers } })),
      setCanvasSelectedTeachers: (id, teachers) =>
        set(state => ({ canvasSelectedTeachers: { ...state.canvasSelectedTeachers, [id]: teachers } })),
      setCanvasLtiToken: (id, data) =>
        set(state => ({ canvasLtiTokens: { ...state.canvasLtiTokens, [id]: data } })),
      setCanvasLectures: (id, lectures) =>
        set(state => ({ canvasLectures: { ...state.canvasLectures, [id]: lectures } })),
      setCanvasModuleVideos: (id, videos) =>
        set(state => ({ canvasModuleVideos: { ...state.canvasModuleVideos, [id]: videos } })),
      setCanvasCourseCategorySelection: (id, sel) =>
        set(state => ({
          canvasCourseCategorySelections: {
            ...state.canvasCourseCategorySelections,
            [id]: { ...state.canvasCourseCategorySelections[id], ...sel }
          }
        })),
      setAllCanvasCourseCategorySelections: (ids, sel) =>
        set(state => {
          const next = { ...state.canvasCourseCategorySelections }
          for (const id of ids) next[id] = { ...next[id], ...sel }
          return { canvasCourseCategorySelections: next }
        }),
      resetCanvasScanResults: () => {
        progressPending = null
        progressScheduled = false
        set({
          canvasCourses: [],
          canvasScanState: 'idle',
          canvasScanMessage: '',
          canvasExpandedCourses: new Set(),
          canvasCourseData: {},
          canvasVideoSessions: {},
          canvasTeachers: {},
          canvasSelectedTeachers: {},
          canvasLtiTokens: {},
          canvasLectures: {},
          canvasModuleVideos: {},
          canvasCourseCategorySelections: {},
          canvasCourseTaskIds: {},
        })
      },
      deleteCanvasCourseData: id =>
        set(state => {
          const { [id]: _1, ...restCourseData } = state.canvasCourseData
          const { [id]: _2, ...restLectures } = state.canvasLectures
          const { [id]: _3, ...restLti } = state.canvasLtiTokens
          const { [id]: _4, ...restModuleVideos } = state.canvasModuleVideos
          // 注意：不清 canvasCourseTaskIds —— 下载完成后扫描数据释放，
          // 但进度条仍需 taskIds 统计 done/total，故保留到 resetProgress/刷新才清。
          return { canvasCourseData: restCourseData, canvasLectures: restLectures, canvasLtiTokens: restLti, canvasModuleVideos: restModuleVideos }
        }),
      setCanvasCourseTaskIds: (id, taskIds) =>
        set(state => ({ canvasCourseTaskIds: { ...state.canvasCourseTaskIds, [id]: taskIds } })),
      // ─── cnmooc setters ───
      setCnmoocCourses: cnmoocCourses => set({ cnmoocCourses }),
      setCnmoocScanState: (cnmoocScanState, cnmoocScanMessage = '') => set({ cnmoocScanState, cnmoocScanMessage }),
      toggleCnmoocExpand: courseId =>
        set(state => {
          const next = new Set(state.cnmoocExpandedCourses)
          if (next.has(courseId)) next.delete(courseId)
          else next.add(courseId)
          return { cnmoocExpandedCourses: next }
        }),
      setCnmoocCourseData: (id, data) =>
        set(state => ({ cnmoocCourseData: { ...state.cnmoocCourseData, [id]: data } })),
      setCnmoocResourceFilter: cnmoocResourceFilter => set({ cnmoocResourceFilter }),
      resetCnmoocScanResults: () => {
        progressPending = null
        progressScheduled = false
        set({
          cnmoocCourses: [],
          cnmoocScanState: 'idle',
          cnmoocScanMessage: '',
          cnmoocExpandedCourses: new Set(),
          cnmoocCourseData: {}
        })
      },
      deleteCnmoocCourseData: id =>
        set(state => {
          const { [id]: _cn, ...rest } = state.cnmoocCourseData
          return { cnmoocCourseData: rest }
        }),
      // ─── 共享 setters ───
      setCloudUserToken: cloudUserToken => set({ cloudUserToken }),
      setCloudSpaceInfo: cloudSpaceInfo => set({ cloudSpaceInfo }),
      setCloudConnStatus: (cloudConnStatus, cloudConnMessage = '') => set({ cloudConnStatus, cloudConnMessage }),
      setDownloadMode: downloadMode => set({ downloadMode }),
      setFileConflictStrategy: fileConflictStrategy => set({ fileConflictStrategy }),
      setHlsTranscodeMaxHeight: hlsTranscodeMaxHeight => set({ hlsTranscodeMaxHeight }),
      setAutoDownloadUpdate: autoDownloadUpdate => set({ autoDownloadUpdate }),
      setLocalDestRoot: localDestRoot => set({ localDestRoot }),
      setCloudDestRoot: cloudDestRoot => set({ cloudDestRoot }),
      setCloudLinkedIds: (m: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) =>
        set(state => ({ cloudLinkedIds: typeof m === 'function' ? m(state.cloudLinkedIds) : m })),
      setDownloading: downloading => set({ downloading }),
      resetProgress: () => {
        // [Bug Fix] 同步丢弃尚未 flush 的批处理。原实现只 set({progress:{}})，但
        // applyProgress 的微任务 pending map 不清：若重置与一个在途进度事件同 tick，
        // resetProgress 先执行，随后微任务把 pending 里的旧条目 flush 回新 store，
        // 导致刚清空的进度表里又冒出陈旧终态条目。这里把 pending/scheduled 一并清零，
        // 让随后的 flush 无条目可写。
        progressPending = null
        progressScheduled = false
        // batchTaskIds 同步清空：新一轮下载从空集开始，total/active 不受上一轮残留影响
        set({ progress: {}, batchTaskIds: [] })
      },
      clearCompletedProgress: () => {
        progressPending = null
        progressScheduled = false
        set(state => {
          const nextProg: Record<string, DownloadProgress> = {}
          for (const [id, p] of Object.entries(state.progress)) {
            if (p.state === 'downloading' || p.state === 'pending' || p.state === 'paused') {
              nextProg[id] = p
            }
          }
          const nextBatchTaskIds = state.batchTaskIds.filter(id => {
            const p = state.progress[id]
            return p && (p.state === 'downloading' || p.state === 'pending' || p.state === 'paused')
          })
          return { progress: nextProg, batchTaskIds: nextBatchTaskIds }
        })
      },
      // 入队时追加 taskId（去重），供 OverallProgressBar 基于本轮提交集精准统计。
      // 空数组 no-op（避免无谓 set 触发重渲染）；有新增才返回新数组。
      addBatchTaskIds: (ids: string[]) =>
        set(state => {
          if (ids.length === 0) return {}
          const acc = new Set(state.batchTaskIds)
          let changed = false
          for (const id of ids) if (!acc.has(id)) { acc.add(id); changed = true }
          return changed ? { batchTaskIds: [...acc] } : {}
        }),
      // 仅清 batchTaskIds，保留 progress（跨批次 done 态用于「跳过已完成」判断）。
      // Browser/Cnmooc onDownload 入口调用，防 batchTaskIds 跨批次累积进 total。
      resetBatchTaskIds: () => set({ batchTaskIds: [] }),
      // 幽灵兜底：遍历 batchTaskIds，把非终态任务标 cancelled。
      // cancelAll 后 / 下载循环收尾时调用，防主进程漏发终态导致 active 永不归零。
      // 保留已有 received/total（避免进度条回退）；无条目的补一条 cancelled 占位。
      markBatchPendingCancelled: () =>
        set(state => {
          let changed = false
          const next = { ...state.progress }
          for (const tid of state.batchTaskIds) {
            const cur = next[tid]
            const st = cur?.state
            if (st !== 'done' && st !== 'skipped' && st !== 'error' && st !== 'cancelled') {
              next[tid] = { taskId: tid, state: 'cancelled', received: cur?.received ?? 0, total: cur?.total ?? 0, message: '已取消' }
              changed = true
            }
          }
          return changed ? { progress: next } : {}
        }),
      // PERF: batch rapid progress updates into a single microtask.
      // Multiple applyProgress calls within the same event loop tick (e.g. 2+ tasks
      // completing simultaneously, or scan + download progress arriving together)
      // are merged into one store.set(), reducing React re-render count.
      // Each call accumulates into a Map; a queueMicrotask fires once to flush.
      // pending/scheduled 提升到模块级，让 resetProgress 能同步清零（见上）。
      applyProgress: (p: DownloadProgress) => {
        if (!progressPending) progressPending = new Map()
        progressPending.set(p.taskId, p)
        if (!progressScheduled) {
          progressScheduled = true
          queueMicrotask(() => {
            const batch = progressPending
            progressPending = null
            progressScheduled = false
            if (!batch || batch.size === 0) return
            set(state => {
              const next = { ...state.progress }
              let historyUpdated = false
              let nextHistory = state.downloadHistory
              for (const [tid, prog] of batch) {
                next[tid] = prog
                if (prog.state === 'done' && (prog.filePath || prog.cloudPath)) {
                  const baseId = tid.replace(/_cloud$/, '')
                  const existingIndex = nextHistory.findIndex(h => {
                    const hBaseId = h.taskId.replace(/_cloud$/, '')
                    if (hBaseId === baseId) return true
                    const localMatch = !!(prog.filePath && h.filePath === prog.filePath)
                    const cloudMatch = !!(prog.cloudPath && h.cloudPath === prog.cloudPath)
                    return localMatch || cloudMatch
                  })
                  if (existingIndex >= 0) {
                    // 已有记录（both 模式另一侧先完成）：补全路径与元数据，不重复增行
                    if (!historyUpdated) {
                      nextHistory = [...nextHistory]
                      historyUpdated = true
                    }
                    const existing = nextHistory[existingIndex]
                    nextHistory[existingIndex] = {
                      ...existing,
                      filePath: prog.filePath || existing.filePath,
                      cloudPath: prog.cloudPath || existing.cloudPath,
                      fileName: prog.fileName || existing.fileName
                    }
                  } else {
                    if (!historyUpdated) {
                      nextHistory = [...nextHistory]
                      historyUpdated = true
                    }
                    const displayPath = prog.filePath || prog.cloudPath || tid
                    const fileName = prog.fileName || displayPath.split(/[/\\]/).pop() || tid
                    const fileSize = (prog.total && prog.total > 0)
                      ? prog.total
                      : (prog.received && prog.received > 0 ? prog.received : undefined)
                    nextHistory.unshift({
                      taskId: baseId,
                      fileName,
                      filePath: prog.filePath,
                      cloudPath: prog.cloudPath,
                      fileSize,
                      completedAt: Date.now()
                    })
                  }
                }
              }
              const cappedHistory = historyUpdated ? nextHistory.slice(0, 300) : nextHistory
              return historyUpdated ? { progress: next, downloadHistory: cappedHistory } : { progress: next }
            })
          })
        }
      },
      maxDownloadSpeedKBps: 0,
      namingTemplate: DEFAULT_NAMING_TEMPLATE,
      videoQualityOption: 'origin',
      downloadHistory: [],
      setMaxDownloadSpeedKBps: n => {
        const val = Math.max(0, n)
        set({ maxDownloadSpeedKBps: val })
        window?.api?.download?.setSpeedLimit?.(val).catch(() => undefined)
      },
      setNamingTemplate: t => set({ namingTemplate: t }),
      setVideoQualityOption: q => set({ videoQualityOption: q }),
      addDownloadHistory: item =>
        set(state => {
          const baseId = item.taskId.replace(/_cloud$/, '')
          const alreadyExists = state.downloadHistory.some(h => {
            const hBaseId = h.taskId.replace(/_cloud$/, '')
            if (hBaseId === baseId) return true
            const localMatch = !!(item.filePath && h.filePath === item.filePath)
            const cloudMatch = !!(item.cloudPath && h.cloudPath === item.cloudPath)
            return localMatch || cloudMatch
          })
          if (alreadyExists) return {}
          return { downloadHistory: [{ ...item, taskId: baseId }, ...state.downloadHistory].slice(0, 300) }
        }),
      removeDownloadHistoryItem: taskId =>
        set(state => {
          // [Bug Fix] 联动删 progress 终态条目 + 主进程快照：否则刷新页面后
          // 快照恢复 → applyProgress(done) 会把刚删的历史"复活"。
          // 仅删终态条目（done/skipped/cancelled），在传/失败任务不动。
          const baseId = taskId.replace(/_cloud$/, '')
          const nextProg = { ...state.progress }
          for (const id of [baseId, baseId + '_cloud']) {
            const p = nextProg[id]
            if (p && (p.state === 'done' || p.state === 'skipped' || p.state === 'cancelled')) {
              delete nextProg[id]
            }
          }
          if (typeof window !== 'undefined' && window.api?.download?.deleteSnapshot) {
            void window.api.download.deleteSnapshot(baseId).catch(() => {})
          }
          return {
            downloadHistory: state.downloadHistory.filter(h => h.taskId !== taskId),
            progress: nextProg
          }
        }),
      clearDownloadHistory: () => {
        set(state => {
          const nextProg = { ...state.progress }
          for (const [tid, p] of Object.entries(nextProg)) {
            if (p.state === 'done' || p.state === 'skipped' || p.state === 'cancelled') {
              delete nextProg[tid]
            }
          }
          return { downloadHistory: [], progress: nextProg }
        })
        if (typeof window !== 'undefined' && window.api?.download?.clearFinishedSnapshots) {
          void window.api.download.clearFinishedSnapshots().catch(() => {})
        }
      },
      removeProgressItem: taskId =>
        set(state => {
          const baseId = taskId.replace(/_cloud$/, '')
          const nextProg = { ...state.progress }
          for (const id of [baseId, baseId + '_cloud']) {
            const p = nextProg[id]
            // 仅删终态（含 error）：error 属于终态且重试语义走 resumeTask 的 runtime，
            // 删条目不影响主进程重试；在传任务（downloading/pending/paused）不可删，
            // 必须走 cancel 让主进程停掉。
            if (p && (p.state === 'done' || p.state === 'skipped' || p.state === 'cancelled' || p.state === 'error')) {
              delete nextProg[id]
            }
          }
          return { progress: nextProg }
        }),
      setConcurrency: n => {
        const val = n === 0 ? 0 : clampConcurrency(n)
        set({ concurrency: val })
        window?.api?.download?.setConcurrency?.(val).catch(() => undefined)
      }
    }),
    {
      name: 'sjtu-course-downloader',
      version: 3,
      migrate: (persistedState: unknown, version: number) => {
        const state = (persistedState ?? {}) as Record<string, unknown>
        if (version < 3 && state) {
          state.theme = 'system'
        }
        if (state && (state.activeTab === 'settings' || state.activeTab === 'transfer' || state.activeTab === 'cloudpan')) {
          state.activeTab = (state.lastCourseTab as string) || 'canvas'
        }
        if (state && Array.isArray(state.downloadHistory) && state.downloadHistory.length > 300) {
          state.downloadHistory = state.downloadHistory.slice(0, 300)
        }
        return state
      },
      merge: (persistedState: unknown, currentState: AppState) => {
        const persisted = (persistedState ?? {}) as Partial<AppState>
        const activeTab =
          persisted.activeTab === 'settings' || persisted.activeTab === 'transfer' || persisted.activeTab === 'cloudpan'
            ? persisted.lastCourseTab || currentState.lastCourseTab || 'canvas'
            : (persisted.activeTab ?? currentState.activeTab)
        const canvasExportSrt = typeof persisted.canvasExportSrt === 'boolean'
          ? persisted.canvasExportSrt
          : (typeof persisted.canvasExportAiTranscript === 'boolean' ? persisted.canvasExportAiTranscript : currentState.canvasExportSrt)
        const canvasExportMarkdown = typeof persisted.canvasExportMarkdown === 'boolean'
          ? persisted.canvasExportMarkdown
          : (typeof persisted.canvasExportAiTranscript === 'boolean' ? persisted.canvasExportAiTranscript : currentState.canvasExportMarkdown)
        const canvasAssignmentOptions: CanvasAssignmentExportOptions = {
          ...currentState.canvasAssignmentOptions,
          ...(persisted.canvasAssignmentOptions ?? {})
        }
        return {
          ...currentState,
          ...persisted,
          cloudDestRoot: persisted.cloudDestRoot ?? currentState.cloudDestRoot,
          canvasExportSrt,
          canvasExportMarkdown,
          canvasExportAiTranscript: canvasExportSrt || canvasExportMarkdown,
          canvasAssignmentOptions,
          activeTab
        }
      },
      onRehydrateStorage: () => state => {
        if (state && (state.activeTab === 'settings' || state.activeTab === 'transfer' || state.activeTab === 'cloudpan')) {
          state.activeTab = state.lastCourseTab || 'canvas'
        }
        if (state && typeof state.concurrency === 'number') {
          window?.api?.download?.setConcurrency?.(state.concurrency).catch(() => undefined)
        }
        if (state && typeof state.maxDownloadSpeedKBps === 'number') {
          window?.api?.download?.setSpeedLimit?.(state.maxDownloadSpeedKBps).catch(() => undefined)
        }
      },
      storage: createJSONStorage(() => {
        if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
          try {
            if (typeof localStorage !== 'undefined') return localStorage
          } catch { /* ignore */ }
        }
        return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
          clear: () => {},
          key: () => null,
          length: 0
        }
      }),
      // 只持久化用户偏好；扫描结果、选中态、进度都是临时数据。
      // cloudUserToken 不持久化：每次启动必须重新扫码登录 + 重新连接云盘，
      // 避免凭证残留（符合"每次开 APP 销毁所有凭证"）。登录后由 App.tsx 的
      // prefetchCloudConnection 自动隐式 SSO 重新连接。
      partialize: state => ({
        theme: state.theme,
        activeTab: (state.activeTab === 'settings' || state.activeTab === 'transfer' || state.activeTab === 'cloudpan')
          ? (state.lastCourseTab || 'canvas')
          : state.activeTab,
        concurrency: state.concurrency,
        downloadMode: state.downloadMode,
        fileConflictStrategy: state.fileConflictStrategy,
        localDestRoot: state.localDestRoot,
        cloudDestRoot: state.cloudDestRoot,
        cnmoocResourceFilter: state.cnmoocResourceFilter,
        autoDownloadUpdate: state.autoDownloadUpdate,
        maxDownloadSpeedKBps: state.maxDownloadSpeedKBps,
        namingTemplate: state.namingTemplate,
        videoQualityOption: state.videoQualityOption,
        downloadHistory: state.downloadHistory,
        courseViewMode: state.courseViewMode,
        canvasGroupByTerm: state.canvasGroupByTerm,
        canvasSelectedTerm: state.canvasSelectedTerm,
        canvasCourseCategorySelections: state.canvasCourseCategorySelections,
        scheduleSelectedSemesterKey: state.scheduleSelectedSemesterKey,
        scheduleViewMode: state.scheduleViewMode,
        scheduleLayerFilter: state.scheduleLayerFilter,
        scheduleExpandNoonSlot: state.scheduleExpandNoonSlot,
        lastCourseTab: state.lastCourseTab,
        windowCloseAction: state.windowCloseAction,
        exitWhenDownloading: state.exitWhenDownloading,
        hasCompletedInitialSetup: state.hasCompletedInitialSetup,
        lastSetupVersion: state.lastSetupVersion,
        pptSaveImages: state.pptSaveImages,
        canvasExportAiTranscript: state.canvasExportAiTranscript,
        canvasExportSrt: state.canvasExportSrt,
        canvasExportMarkdown: state.canvasExportMarkdown,
        canvasAssignmentOptions: state.canvasAssignmentOptions
      })
    }
  )
)
