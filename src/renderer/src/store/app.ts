import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useShallow } from 'zustand/shallow'
import type { AuthStatus, CloudPanSpaceInfo, Course, DownloadMode, FileConflictStrategy, DownloadProgress, DownloadState, VideoTask, ActiveTab, CanvasLectureGroup, CanvasCourse, CanvasDownloadTaskSpec, CanvasTeacherSelection, CanvasVideoSession, CnmoocChapter, CnmoocCourse, CnmoocResourceFilter } from '@shared/types'

/** 应用主 stage：欢迎页 → 登录 → 浏览器/下载界面 */
export type Stage = 'welcome' | 'login' | 'browser'

/** 扫描状态机（旁听课程和 Canvas 课程共用） */
export type ScanState = 'idle' | 'scanning' | 'done' | 'error'

/** UI 主题偏好 */
export type Theme = 'light' | 'dark' | 'system'

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
  /** 每门课程的分类选择（预设置：课件/教师/PPT/模块视频/PPT课件PDF） */
  canvasCourseCategorySelections: Record<number, { files: boolean; teacher: boolean; ppt: boolean; moduleVideo: boolean; pptPdf: boolean }>
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
  /** 并发下载数，2-16，会同步到主进程。0 = 自动 */
  concurrency: number
  /** 是否处于自动并发模式 */
  autoConcurrency: boolean
  // setters
  /** 切换 UI 主题（dark/light/system） */
  setTheme: (t: Theme) => void
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
  /** 更新指定 Canvas 课程的分类选择（课件/教师/PPT/模块视频） */
  setCanvasCourseCategorySelection: (id: number, sel: Partial<{ files: boolean; teacher: boolean; ppt: boolean; moduleVideo: boolean; pptPdf: boolean }>) => void
  /** 批量更新多个 Canvas 课程的分类选择 */
  setAllCanvasCourseCategorySelections: (ids: number[], sel: Partial<{ files: boolean; teacher: boolean; ppt: boolean; moduleVideo: boolean; pptPdf: boolean }>) => void
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
  /** 更新 both 模式下 localTaskId → cloudTaskId 的映射 */
  setCloudLinkedIds: (m: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void
  /** 标记是否有任务正在下载中 */
  setDownloading: (b: boolean) => void
  /** 清空所有下载进度记录 */
  resetProgress: () => void
  /** 合并单条下载进度到进度表 */
  applyProgress: (p: DownloadProgress) => void
  /** 设置下载并发数（0 = 自动） */
  setConcurrency: (n: number) => void
  /** 切换自动并发模式开关 */
  setAutoConcurrency: (on: boolean) => void
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
  Math.max(2, Math.min(16, Math.floor(Number.isFinite(n) ? n : 3) || 3))

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
    mergedState = 'downloading'
    // 本地已完成，显示云端上传进度而非本地 100%
    mergedReceived = cloud?.received ?? 0
    mergedTotal = cloud?.total ?? 0
    const cpct = cloud.total > 0 ? Math.round((cloud.received / cloud.total) * 100) : 0
    mergedMsg = `本地完成 · 云端上传中 ${cpct}%`
  }
  return { taskId, state: mergedState, received: mergedReceived, total: mergedTotal, message: mergedMsg }
}

/** 顶层下载统计：对一组 taskIds 聚合 done/failed/active 计数，编码成单个数字返回。
 *  只有当 done/failed/active 任一计数真正变化时才触发重渲染 ——
 *  避免每条任务每 2s 的进度回调都让顶层 Browser/CanvasBrowser + ActionBar 重渲。
 *  沿用 CourseSection 里 dlAndErr 的编码思路，提到顶层并支持 both 模式。
 *
 *  返回 { done, failed, active }；active = 尚未到达终态（含 pending/downloading/paused）的任务数。
 *  allFinal ≡ active === 0（当 taskIds 非空时）。 */
export function useDownloadStats(
  taskIds: string[],
  isBothMode: boolean
): { done: number; failed: number; active: number } {
  const encoded = useAppStore(s => {
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
        const cloudDone = !cloudId || cloudSt === 'done' || cloudSt === 'skipped'
        if (localDone && cloudDone) done++
        if (!(localFinal && cloudFinal)) active++
      } else {
        if (st === 'done' || st === 'skipped') done++
        else if (st === 'error') failed++
        else if (st !== 'cancelled') active++
      }
    }
    // [Bug Fix] 使用基数 10000 替代 1000，支持最多 9999 个任务不溢出
    return done * 100_000_000 + failed * 10_000 + active
  })
  return {
    done: Math.floor(encoded / 100_000_000),
    failed: Math.floor(encoded / 10_000) % 10_000,
    active: encoded % 10_000
  }
}

// applyProgress 的批处理缓冲（模块级，便于 resetProgress 同步清零，见下）。
let progressPending: Map<string, DownloadProgress> | null = null
let progressScheduled = false

export const useAppStore = create<AppState>()(
  persist(
    set => ({
      theme: 'dark',
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
      cloudLinkedIds: {},
      concurrency: 3,
      autoConcurrency: false,
      autoDownloadUpdate: false,
      setTheme: theme => set({ theme }),
      setStage: stage => set({ stage }),
      setActiveTab: activeTab => set({ activeTab }),
      setAuth: auth => set({ auth }),
      setScan: (scanState, scanMessage = '') => set({ scanState, scanMessage }),
      setCourses: courses => set({ courses }),
      setTasksForCourse: (id, tasks) =>
        set(state => ({ tasksByCourse: { ...state.tasksByCourse, [id]: tasks } })),
      resetScanResults: () => set(emptyScanResults),
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
      resetCanvasScanResults: () => set({
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
      }),
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
      resetCnmoocScanResults: () => set({
        cnmoocCourses: [],
        cnmoocScanState: 'idle',
        cnmoocScanMessage: '',
        cnmoocExpandedCourses: new Set(),
        cnmoocCourseData: {}
      }),
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
        set({ progress: {} })
      },
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
              for (const [tid, prog] of batch) next[tid] = prog
              return { progress: next }
            })
          })
        }
      },
      setConcurrency: n => set({ concurrency: n === 0 ? 0 : clampConcurrency(n) }),
      setAutoConcurrency: on => set({ autoConcurrency: on })
    }),
    {
      name: 'sjtu-course-downloader',
      storage: createJSONStorage(() => localStorage),
      // 只持久化用户偏好；扫描结果、选中态、进度都是临时数据。
      // cloudUserToken 不持久化：每次启动必须重新扫码登录 + 重新连接云盘，
      // 避免凭证残留（符合"每次开 APP 销毁所有凭证"）。登录后由 App.tsx 的
      // prefetchCloudConnection 自动隐式 SSO 重新连接。
      partialize: state => ({
        theme: state.theme,
        activeTab: state.activeTab,
        concurrency: state.concurrency,
        autoConcurrency: state.autoConcurrency,
        downloadMode: state.downloadMode,
        fileConflictStrategy: state.fileConflictStrategy,
        localDestRoot: state.localDestRoot,
        cnmoocResourceFilter: state.cnmoocResourceFilter,
        autoDownloadUpdate: state.autoDownloadUpdate
      })
    }
  )
)
