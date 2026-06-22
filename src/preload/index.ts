import { contextBridge, ipcRenderer } from 'electron'
import type {
  ApiEnvelope,
  AuditCourseDetail,
  AuditCourseItem,
  AuthStatus,
  CanvasCourse,
  CanvasDownloadTaskSpec,
  CanvasFileItem,
  CanvasLectureGroup,
  CanvasTeacherSelection,
  CanvasVideoSession,
  CloudPanSpaceInfo,
  DownloadMode,
  FileConflictStrategy,
  DownloadProgress,
  DownloadTaskSpec,
  PageResult,
  TransferSpeed
} from '../shared/types'

/** 通用订阅器：注册 ipcRenderer 监听并返回取消订阅函数 */
const subscribe = <T>(channel: string, cb: (p: T) => void): (() => void) => {
  const listener = (_: unknown, p: T): void => cb(p)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** 暴露给 renderer 进程的完整 API 表面，通过 contextBridge 挂载到 window.api */
const api = {
  /** 主进程平台标识（darwin/win32/linux），renderer 据此做平台分支（如 macOS 用原生交通灯） */
  platform: process.platform,
  /** 切换标题栏按钮主题（深色/浅色） */
  setTheme: (theme: 'dark' | 'light'): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('app:set-theme', theme),
  /** 弹出系统目录选择对话框，返回选择的路径或 null */
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('app:select-folder'),
  /** 弹出系统通知（标题 + 正文）；点击通知聚焦主窗口 */
  notify: (title: string, body: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('app:notify', { title, body }),
  // ─── 自定义标题栏窗口控制（Mac 交通灯按钮） ───
  window: {
    /** 隐藏到系统托盘（最小化按钮/确认窗"最小化"选项） */
    minimize: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('window:minimize'),
    /** 直接退出（无下载时关闭按钮） */
    quit: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('window:quit'),
    /** 取消所有下载并退出（确认窗"取消下载并退出"） */
    cancelAndQuit: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('window:cancel-and-quit'),
    /** 查询是否有进行中任务（决定是否弹确认窗） */
    hasOngoingTasks: (): Promise<{ ongoing: boolean }> => ipcRenderer.invoke('window:has-ongoing-tasks'),
    /** 最大化/还原切换 */
    toggleMaximize: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('window:toggle-maximize'),
    /** 查询当前是否最大化 */
    isMaximized: (): Promise<{ maximized: boolean }> => ipcRenderer.invoke('window:is-maximized'),
    /** 订阅关闭请求（Alt+F4/任务栏关闭触发，renderer 弹确认窗），返回取消订阅函数 */
    onCloseRequested: (cb: () => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('window:close-requested', listener)
      return (): void => { ipcRenderer.removeListener('window:close-requested', listener) }
    }
  },
  auth: {
    /** 检查当前 v.sjtu 登录状态 */
    status: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:status'),
    /** 登出并清除 sjtu session 的 cookies/localStorage */
    logout: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:logout'),
    /** 将 v.sjtu SPA 写入 localStorage 的 jwt-token 传给 main 进程缓存 */
    setJwtToken: (token: string | null): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('auth:set-jwt-token', token)
  },
  vsjtu: {
    /** 分页扫描旁听课程申请列表 */
    scanAudit: (
      pageNo = 1,
      pageSize = 100
    ): Promise<ApiEnvelope<PageResult<AuditCourseItem>>> =>
      ipcRenderer.invoke('vsjtu:scan-audit', pageNo, pageSize),
    /** 按 resourceId 获取一门旁听课程的详情（含视频列表） */
    auditCourseDetail: (resourceId: number): Promise<ApiEnvelope<AuditCourseDetail>> =>
      ipcRenderer.invoke('vsjtu:audit-course-detail', resourceId)
  },
  download: {
    /** 提交一批下载任务，支持 local/cloud/both 三种模式 */
    start: (destRoot: string, tasks: DownloadTaskSpec[], options?: { mode?: DownloadMode; localDestRoot?: string; conflictStrategy?: FileConflictStrategy }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('download:start', destRoot, tasks, options),
    /** 暂停单个任务（本地+云端同时尝试） */
    pause: (taskId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('download:pause', taskId),
    /** 取消单个任务（本地+云端同时尝试） */
    cancel: (taskId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('download:cancel', taskId),
    /** 恢复单个任务（本地+云端同时尝试） */
    resume: (taskId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('download:resume', taskId),
    /** 暂停所有任务 */
    pauseAll: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('download:pause-all'),
    /** 取消所有任务 */
    cancelAll: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('download:cancel-all'),
    /** 恢复所有任务 */
    resumeAll: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('download:resume-all'),
    /** 设置并发数；传 0 启用自动并发模式（AIMD） */
    setConcurrency: (n: number): Promise<{ ok: boolean; concurrency: number; auto?: boolean }> =>
      ipcRenderer.invoke('download:set-concurrency', n),
    /** 订阅下载进度变化事件，返回取消订阅函数 */
    onProgress: (cb: (p: DownloadProgress) => void) => subscribe<DownloadProgress>('download:progress', cb),
    /** 订阅并发数变化事件（自动模式下），返回取消订阅函数 */
    onConcurrencyChanged: (cb: (n: number) => void) => subscribe<number>('download:concurrency-changed', cb),
    /** 订阅实时传输速度事件（下行/上行 bytes/s，1s 推送），返回取消订阅函数 */
    onTransferSpeed: (cb: (s: TransferSpeed) => void) => subscribe<TransferSpeed>('transfer:speed', cb)
  },
  cloudpan: {
    /** 获取 main 进程缓存的 USER_TOKEN */
    getCachedToken: (): Promise<string | null> =>
      ipcRenderer.invoke('cloudpan:get-cached-token'),
    /** [Bug Fix] 启动恢复时把 localStorage 持久化的 token 同步给 main 缓存 */
    setCachedToken: (token: string | null): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('cloudpan:set-cached-token', token),
    /** [2.2] 验证 main 进程缓存的 USER_TOKEN 是否有效（不再从 renderer 传 token） */
    validateToken: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('cloudpan:validate-token'),
    /** [2.2] 查询 main 进程缓存的 USER_TOKEN 对应的云盘空间容量信息 */
    spaceInfo: (): Promise<{ ok: boolean; info?: CloudPanSpaceInfo; error?: string }> =>
      ipcRenderer.invoke('cloudpan:space-info'),
    /** 利用已有 jAccount session 完成云盘 SSO 登录 */
    directLogin: (): Promise<{ ok: boolean; userToken?: string; error?: string }> =>
      ipcRenderer.invoke('cloudpan:direct-login'),
    /** 清除云盘缓存的 USER_TOKEN */
    logout: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('cloudpan:logout')
  },
  // ─── Canvas (oc.sjtu.edu.cn) ───
  canvas: {
    /** 列出当前用户所有 Canvas 课程 */
    listCourses: (): Promise<{ ok: boolean; courses?: CanvasCourse[]; error?: string }> =>
      ipcRenderer.invoke('canvas:list-courses'),
    /** 扫描一门 Canvas 课程的文件和模块结构 */
    scanCourse: (courseId: number): Promise<{
      ok: boolean
      files?: CanvasFileItem[]
      folderMap?: Record<number, string>
      moduleFileIds?: number[]
      syllabusFileIds?: number[]
      error?: string
    }> =>
      ipcRenderer.invoke('canvas:scan-course', courseId),
    /** 根据已扫描的文件列表构建 DownloadTaskSpec 数组 */
    buildDownloadSpecs: (
      courseName: string,
      courseId: number,
      files: CanvasFileItem[],
      folderMap: Record<number, string>,
      moduleFileIds: number[],
      syllabusFileIds: number[],
      destRoot: string
    ): Promise<{ ok: boolean; specs?: CanvasDownloadTaskSpec[]; error?: string }> =>
      ipcRenderer.invoke('canvas:build-download-specs', courseName, courseId, files, folderMap, moduleFileIds, syllabusFileIds, destRoot),
    /** 扫描课程的课堂视频录播会话，返回教师筛选和讲次分组 */
    classVideoScan: (courseId: number): Promise<{
      ok: boolean
      sessions?: CanvasVideoSession[]
      teachers?: CanvasTeacherSelection[]
      lectures?: CanvasLectureGroup[]
      token?: string
      canvasCourseId?: string
      error?: string
    }> =>
      ipcRenderer.invoke('canvas:class-video-scan', courseId),
    /** 为课堂视频生成下载 spec（按教师筛选 + LTI token 解析） */
    classVideoDownload: (
      courseName: string,
      courseId: number,
      sessions: CanvasVideoSession[],
      selectedTeachers: string[],
      token: string,
      canvasCourseId: string,
      destRoot: string,
      conflictStrategy?: FileConflictStrategy
    ): Promise<{ ok: boolean; specs?: CanvasDownloadTaskSpec[]; error?: string }> =>
      ipcRenderer.invoke('canvas:class-video-download', courseName, courseId, sessions, selectedTeachers, token, canvasCourseId, destRoot, conflictStrategy),
    /** 扫描课程模块中的内嵌视频（iframe 页面） */
    moduleVideoScan: (courseId: number): Promise<{
      ok: boolean
      tasks?: Array<{ moduleName: string; pageTitle: string; iframeUrl: string }>
      error?: string
    }> =>
      ipcRenderer.invoke('canvas:module-video-scan', courseId),
    /** 为模块内嵌视频生成下载 spec */
    moduleVideoDownload: (
      courseName: string,
      courseId: number,
      tasks: Array<{ moduleName: string; pageTitle: string; iframeUrl: string }>,
      destRoot: string,
      conflictStrategy?: FileConflictStrategy
    ): Promise<{ ok: boolean; specs?: CanvasDownloadTaskSpec[]; error?: string }> =>
      ipcRenderer.invoke('canvas:module-video-download', courseName, courseId, tasks, destRoot, conflictStrategy),
    /** 立即下载单个模块内嵌视频（不经 queue，同步返回落盘路径） */
    downloadModuleVideoNow: (
      courseName: string,
      iframeUrl: string,
      baseName: string,
      destRoot: string
    ): Promise<{ ok: boolean; path?: string; format?: string; error?: string }> =>
      ipcRenderer.invoke('canvas:download-module-video-now', courseName, iframeUrl, baseName, destRoot),
    /** 下载指定讲次列表（按 lectureItems 按需解析流直链） */
    downloadLectures: (
      courseName: string,
      courseId: number,
      lectureItems: CanvasLectureGroup[],
      token: string,
      destRoot: string,
      conflictStrategy?: FileConflictStrategy
    ): Promise<{ ok: boolean; specs?: CanvasDownloadTaskSpec[]; error?: string }> =>
      ipcRenderer.invoke('canvas:download-lectures', courseName, courseId, lectureItems, token, destRoot, conflictStrategy),
    onScanProgress: (cb: (p: { courseId: number; phase: string; message: string }) => void) => subscribe<{ courseId: number; phase: string; message: string }>('canvas:scan-progress', cb),
    onHlsProgress: (cb: (p: { baseName: string; phase: string; segmentsDone: number; segmentsTotal: number; bytesWritten: number; message?: string }) => void) => subscribe<{ baseName: string; phase: string; segmentsDone: number; segmentsTotal: number; bytesWritten: number; message?: string }>('canvas:hls-progress', cb)
  }
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (err) {
  console.error('[preload] contextBridge failed:', err)
}

export type ExposedApi = typeof api
