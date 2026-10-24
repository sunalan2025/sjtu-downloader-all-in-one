import { contextBridge, ipcRenderer } from 'electron'
import type {
  ApiEnvelope,
  AuditCourseDetail,
  AuditCourseItem,
  AuthStatus,
  CanvasAssignmentItem,
  CanvasAssignmentExportOptions,
  CanvasCourse,
  CanvasDownloadTaskSpec,
  CanvasFileItem,
  CourseResourceSummary,
  CanvasLectureDownloadItem,
  CanvasLectureGroup,
  CanvasTeacherSelection,
  CanvasVideoSession,
  CloudPanSpaceInfo,
  CloudPanDirectoryListing,
  CnmoocChapter,
  CnmoocCourse,
  CnmoocResourceFilter,
  CnmoocSelectedItem,
  DownloadMode,
  FileConflictStrategy,
  DownloadProgress,
  DownloadTaskSpec,
  MaskedCredential,
  PageResult,
  TransferSpeed,
  UpdateCheckResult,
  UpdateProgress,
  VideoQualityOption,
  ScheduleFetchResult,
  JiaowuScheduleResult,
  IcsExportOptions,
  ScheduleEvent,
  IcsExportResult,
  PrivateWorkerTestResult,
  PrivateWorkerTunnelConfig,
  SshTunnelStatus
} from '../shared/types'

import pkg from '../../package.json'

/** 通用订阅器：注册 ipcRenderer 监听并返回取消订阅函数 */
const subscribe = <T>(channel: string, cb: (p: T) => void): (() => void) => {
  const listener = (_: unknown, p: T): void => cb(p)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** 暴露给 renderer 进程的完整 API 表面，通过 contextBridge 挂载到 window.api */
const api = {
  /** 应用当前版本号（直接从 package.json 读取，与安装包和 GitHub Release 对齐） */
  version: pkg.version,
  /** 主进程平台标识（darwin/win32/linux），renderer 据此做平台分支（如 macOS 用原生交通灯） */
  platform: process.platform,
  /** 切换标题栏按钮主题（深色/浅色） */
  setTheme: (theme: 'dark' | 'light'): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('app:set-theme', theme),
  /** 弹出系统目录选择对话框，返回选择的路径或 null */
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('app:select-folder'),
  /** 启动清理：清掉上次会话残留的临时/半下载文件（cloud-only 临时根 + tmpdir + localDestRoot 的 .part/.ts） */
  cleanupStaleDownloads: (localDestRoot: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('app:cleanup-stale-downloads', localDestRoot),
  /** 弹出系统通知（标题 + 正文）；点击通知聚焦主窗口 */
  notify: (title: string, body: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('app:notify', { title, body }),
  /** 检查 GitHub 上是否有新版本（主进程请求，1h 缓存节流） */
  checkUpdate: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('app:check-update'),
  /** 在系统默认浏览器打开外部 URL（仅限 github.com，防任意 URL 打开） */
  openExternal: (url: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:open-external', url),
  /** 在系统资源管理器中打开/高亮指定文件或文件夹 */
  showInFolder: (fullPath: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:show-in-folder', fullPath),
  /** 用系统默认关联应用打开指定文件或文件夹 */
  openPath: (fullPath?: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('app:open-path', fullPath),
  /** 获取系统默认下载目录路径（Downloads） */
  getDefaultDownloadsDir: (): Promise<string> => ipcRenderer.invoke('app:get-default-downloads-dir'),
  // ─── 应用内自动更新（asset 取 check-update 缓存；下载到 temp → spawn 安装器 → quit 释放文件锁） ───
  /** 下载当前平台安装包到临时目录（进度经 onUpdateProgress 推送） */
  downloadUpdate: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('app:download-update'),
  /** 安装已下载的更新：spawn 安装器并退出当前进程，安装器静默覆盖并启动新版本 */
  installUpdate: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('app:install-update'),
  /** 取消下载并清理临时文件 */
  cancelUpdate: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:cancel-update'),
  /** 下载进度推送（loaded/total/percent） */
  onUpdateProgress: (cb: (p: UpdateProgress) => void): (() => void) => subscribe('update:progress', cb),
  /** 下载完成，可安装 */
  onUpdateReady: (cb: () => void): (() => void) => subscribe('update:ready', () => cb()),
  /** 下载失败 / 取消 */
  onUpdateFailed: (cb: (e: { error: string }) => void): (() => void) => subscribe('update:failed', cb),
  // ─── 自定义标题栏窗口控制（Mac 交通灯按钮） ───
  window: {
    /** 隐藏到系统托盘（最小化按钮/确认窗"最小化"选项） */
    minimize: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('window:minimize'),
    /** 最小化到任务栏 */
    minimizeToTaskbar: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('window:minimize-to-taskbar'),
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
    status: (force?: boolean): Promise<AuthStatus> => ipcRenderer.invoke('auth:status', force),
    /** 登出并清除 sjtu session 的 cookies/localStorage */
    logout: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:logout'),
    /** 显式清理凭据与会话 */
    clear: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:clear'),
    /** 将 v.sjtu SPA 写入 localStorage 的 jwt-token 与用户信息传给 main 进程缓存 */
    setJwtToken: (
      token: string | null,
      userInfo?: { name?: string; studentId?: string }
    ): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('auth:set-jwt-token', token, userInfo),
    /** 使用 OAuth2 授权 Code 直接换取交大视频 JWT Token */
    exchangeCode: (code: string): Promise<{ success: boolean; token?: string | null }> =>
      ipcRenderer.invoke('auth:exchange-code', code)
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
    start: (destRoot: string, tasks: DownloadTaskSpec[], options?: { mode?: DownloadMode; localDestRoot?: string; conflictStrategy?: FileConflictStrategy; namingTemplate?: string; cloudDestRoot?: string }): Promise<{ ok: boolean; error?: string }> =>
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
    /** 设置全局下载限速 (KB/s，0 = 不限速) */
    setSpeedLimit: (limitKBps: number): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('download:set-speed-limit', limitKBps),
    /** 获取主进程最新下载进度快照（渲染端重载或初始化时拉取） */
    getSnapshot: (): Promise<DownloadProgress[]> =>
      ipcRenderer.invoke('download:get-snapshot'),
    /** 清除主进程中已完成或已取消的历史快照 */
    clearFinishedSnapshots: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('download:clear-finished-snapshots'),
    /** 删除单条历史快照（含其 _cloud 镜像）；与渲染端删除单条历史记录联动 */
    deleteSnapshot: (taskId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('download:delete-snapshot', taskId),
    /** 订阅下载进度变化事件，返回取消订阅函数 */
    onProgress: (cb: (p: DownloadProgress) => void) => subscribe<DownloadProgress>('download:progress', cb),
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
    logout: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('cloudpan:logout'),
    /** 列出交大云盘目录内容 */
    listDirectory: (
      dirPath?: string[],
      page?: number,
      pageSize?: number
    ): Promise<{ ok: boolean; data?: CloudPanDirectoryListing; error?: string }> =>
      ipcRenderer.invoke('cloudpan:list-dir', dirPath, page, pageSize),
    /** 在交大云盘中创建文件夹 */
    createFolder: (dirPath: string[]): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('cloudpan:create-dir', dirPath),
    /** 删除交大云盘中的文件或文件夹 */
    deleteItem: (targetPath: string[], isDir: boolean): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('cloudpan:delete-item', targetPath, isDir),
    /** 重命名交大云盘中的文件或文件夹 */
    renameItem: (oldPath: string[], newName: string, isDir: boolean): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('cloudpan:rename-item', oldPath, newName, isDir),
    /** 获取交大云盘文件的下载直链 */
    getDownloadUrl: (filePath: string[]): Promise<{ ok: boolean; url?: string; error?: string }> =>
      ipcRenderer.invoke('cloudpan:get-download-url', filePath),
    /** 下载交大云盘文件到本地并加入传输队列 */
    downloadFile: (remotePath: string[], targetDir?: string): Promise<{ ok: boolean; taskId?: string; error?: string }> =>
      ipcRenderer.invoke('cloudpan:download-file', remotePath, targetDir),
    /** 调起本地文件选择框并将选中文件上传到交大云盘 */
    uploadFiles: (targetDirPath: string[]): Promise<{ ok: boolean; count?: number; error?: string }> =>
      ipcRenderer.invoke('cloudpan:upload-files', targetDirPath),
    /** 在系统默认浏览器中打开交大云盘网页版 */
    openInBrowser: (remotePath?: string[]): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('cloudpan:open-web', remotePath)
  },
  // ─── Canvas (oc.sjtu.edu.cn) ───
  canvas: {
    /** 列出当前用户所有 Canvas 课程 */
    listCourses: (): Promise<{ ok: boolean; courses?: CanvasCourse[]; error?: string }> =>
      ipcRenderer.invoke('canvas:list-courses'),
    /** 扫描一门 Canvas 课程的文件和模块结构 (R2-F2) */
    scanCourse: (courseId: number): Promise<CourseResourceSummary> =>
      ipcRenderer.invoke('canvas:scan-course', courseId),
    /** 根据已扫描的文件列表构建 DownloadTaskSpec 数组 */
    buildDownloadSpecs: (
      courseName: string,
      courseId: number,
      files: CanvasFileItem[],
      folderMap: Record<number, string>,
      destRoot: string,
      term?: string
    ): Promise<{ ok: boolean; specs?: CanvasDownloadTaskSpec[]; error?: string }> =>
      ipcRenderer.invoke('canvas:build-download-specs', courseName, courseId, files, folderMap, destRoot, term),
    /** 扫描课程的课堂视频录播会话，返回教师筛选和讲次分组 */
    classVideoScan: (courseId: number): Promise<{
      ok: boolean
      sessions?: CanvasVideoSession[]
      teachers?: CanvasTeacherSelection[]
      lectures?: CanvasLectureGroup[]
      token?: string
      canvasCourseId?: string
      legacyCourseId?: string
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
      conflictStrategy?: FileConflictStrategy,
      term?: string
    ): Promise<{ ok: boolean; specs?: CanvasDownloadTaskSpec[]; error?: string }> =>
      ipcRenderer.invoke('canvas:class-video-download', courseName, courseId, sessions, selectedTeachers, token, canvasCourseId, destRoot, conflictStrategy, term),
    /** 扫描课程模块中的视频（三类来源：Page iframe HLS / ExternalTool 直接MP4 / ExternalUrl 直接MP4） */
    moduleVideoScan: (courseId: number): Promise<{
      ok: boolean
      tasks?: Array<{ moduleName: string; pageTitle: string; iframeUrl: string }>
      extTools?: Array<{ moduleItemId: number; fileId: string; title: string }>
      extUrls?: Array<{ uuid: string; title: string }>
      error?: string
    }> =>
      ipcRenderer.invoke('canvas:module-video-scan', courseId),
    /** 为 ExternalTool/ExternalUrl 模块视频生成下载 spec（直接 MP4，走 download:start） */
    moduleVideoDownload: (
      courseName: string,
      courseId: number,
      extTools: Array<{ moduleItemId: number; fileId: string; title: string }>,
      extUrls: Array<{ uuid: string; title: string }>,
      destRoot: string,
      conflictStrategy?: FileConflictStrategy,
      term?: string
    ): Promise<{ ok: boolean; specs?: CanvasDownloadTaskSpec[]; error?: string }> =>
      ipcRenderer.invoke('canvas:module-video-download', courseName, courseId, extTools, extUrls, destRoot, conflictStrategy, term),
    /** 立即下载单个模块内嵌视频（不经 queue，同步返回落盘路径）。
     *  cloudUserToken 存在时，下载完 mp4 后上传到云盘。
     *  transcodeMaxHeight: 720/1080 时，remux 后重编码（缩放+标准GOP），0 或不传 = 不重编码。
     *  skipped=true：本地已复用 / 云盘已存在，未产生新内容（与 PPT 课件一致）。 */
    downloadModuleVideoNow: (
      courseName: string,
      iframeUrl: string,
      baseName: string,
      destRoot: string,
      taskId: string,
      cloudUserToken?: string,
      conflictStrategy?: FileConflictStrategy,
      qualityOption?: number | string,
      term?: string,
      cloudDestRoot?: string
    ): Promise<{ ok: boolean; skipped?: boolean; path?: string; format?: string; cloudPath?: string; error?: string }> =>
      ipcRenderer.invoke('canvas:download-module-video-now', courseName, iframeUrl, baseName, destRoot, taskId, cloudUserToken, conflictStrategy, qualityOption, term, cloudDestRoot),
    /** 下载指定讲次列表（按 lectureItems 按需解析流直链） */
    downloadLectures: (
      courseName: string,
      courseId: number,
      lectureItems: CanvasLectureDownloadItem[],
      token: string,
      destRoot: string,
      conflictStrategy?: FileConflictStrategy,
      term?: string,
      qualityOption?: VideoQualityOption
    ): Promise<{ ok: boolean; specs?: CanvasDownloadTaskSpec[]; error?: string }> =>
      ipcRenderer.invoke('canvas:download-lectures', courseName, courseId, lectureItems, token, destRoot, conflictStrategy, term, qualityOption),
    onScanProgress: (cb: (p: { courseId: number; phase: string; message: string }) => void) => subscribe<{ courseId: number; phase: string; message: string }>('canvas:scan-progress', cb),
    onHlsProgress: (cb: (p: { taskId: string; baseName: string; phase: string; segmentsDone: number; segmentsTotal: number; bytesWritten: number; message?: string }) => void) => subscribe<{ taskId: string; baseName: string; phase: string; segmentsDone: number; segmentsTotal: number; bytesWritten: number; message?: string }>('canvas:hls-progress', cb),
    /** 批量下载与归档课程作业 (Assignments & Submissions) */
    downloadAssignments: (opts: {
      taskId?: string
      courseId: number
      courseName: string
      assignments: CanvasAssignmentItem[]
      destRoot: string
      term?: string
      conflictStrategy?: FileConflictStrategy
      options?: CanvasAssignmentExportOptions
    }): Promise<{
      ok: boolean
      results?: Array<{ assignmentName: string; ok: boolean; path?: string; error?: string }>
      error?: string
    }> =>
      ipcRenderer.invoke('canvas:assignment-download-batch', opts),
    /** 订阅作业归档进度事件 */
    onAssignmentProgress: (cb: (p: { taskId?: string; current: number; total: number; phase: string; assignmentName?: string }) => void) =>
      subscribe<{ taskId?: string; current: number; total: number; phase: string; assignmentName?: string }>('canvas:assignment-progress', cb),
    /** 导出单讲课堂实录 AI 语音逐字稿与字幕 (.srt / .md) */
    downloadTranscript: (opts: {
      courseName: string
      term?: string
      lectureName: string
      videoBaseName: string
      videoSession?: { beginTime: string; teacher: string; classroom: string }
      destRoot: string
      courseId: string | number
      exportSrt?: boolean
      exportMarkdown?: boolean
    }): Promise<{ ok: boolean; srtPath?: string; mdPath?: string; count?: number; error?: string }> =>
      ipcRenderer.invoke('canvas:transcript-download', opts),
    /** 批量导出多讲课堂实录 AI 语音逐字稿与字幕 */
    downloadTranscriptBatch: (opts: {
      taskId?: string
      courseName: string
      term?: string
      destRoot: string
      lectures: Array<{
        lectureName: string
        videoBaseName: string
        courseId: string | number
        videoSession?: { beginTime: string; teacher: string; classroom: string }
      }>
      exportSrt?: boolean
      exportMarkdown?: boolean
    }): Promise<{
      ok: boolean
      results?: Array<{ lectureName: string; ok: boolean; srtPath?: string; mdPath?: string; count?: number; error?: string }>
      error?: string
    }> =>
      ipcRenderer.invoke('canvas:transcript-download-batch', opts),
    /** 订阅逐字稿导出进度事件 */
    onTranscriptProgress: (cb: (p: { taskId?: string; current: number; total: number; phase: string }) => void) =>
      subscribe<{ taskId?: string; current: number; total: number; phase: string }>('canvas:transcript-progress', cb)
  },
  // ─── 好大学在线 (cnmooc.sjtu.cn) ───
  cnmooc: {
    /** 查询好大学在线登录状态（含课程列表，未登录不报错） */
    status: (): Promise<{ ok: boolean; loggedIn?: boolean; courses?: CnmoocCourse[]; error?: string }> =>
      ipcRenderer.invoke('cnmooc:status'),
    /** 显式触发 jAccount SSO 登录（前端「连接好大学在线」按钮） */
    login: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('cnmooc:login'),
    /** 扫描好大学在线「正在学习」课程列表（自动 SSO） */
    scan: (): Promise<{ ok: boolean; courses?: CnmoocCourse[]; error?: string }> =>
      ipcRenderer.invoke('cnmooc:scan'),
    /** 扫描一门课的章节结构（仅 HTML 解析，不预探直链） */
    scanCourse: (courseId: string): Promise<{ ok: boolean; chapters?: CnmoocChapter[]; error?: string }> =>
      ipcRenderer.invoke('cnmooc:scan-course', courseId),
    /** 为选中的条目构建下载 spec（占位 url，下载时懒解析直链并按类型过滤） */
    buildSpecs: (
      courseName: string,
      courseId: string,
      items: CnmoocSelectedItem[],
      resourceFilter: CnmoocResourceFilter
    ): Promise<{ ok: boolean; specs?: CanvasDownloadTaskSpec[]; error?: string }> =>
      ipcRenderer.invoke('cnmooc:build-specs', courseName, courseId, items, resourceFilter),
    /** 订阅扫描进度事件，返回取消订阅函数 */
    onScanProgress: (cb: (p: { courseId: string; phase: string; message: string }) => void) => subscribe<{ courseId: string; phase: string; message: string }>('cnmooc:scan-progress', cb)
  },
  // ─── Canvas PPT 课件下载 ───
  ppt: {
    /** 下载单讲 PPT 课件图片并合并为 PDF（cloudUserToken 存在时上传云盘）。
     *  taskId 存在时进度通过 canvas:ppt-progress 推送（用于 UI 进度条）。
     *  destRoot 空 = cloud-only（PDF 仅作上传中间产物，上传后清理）。 */
    download: (opts: {
      taskId?: string
      /** vod 系统的 videoId（加密串，非数值）。主进程用 resolveIvsVideoId 解析成 PPT API 需要的数值型 ivsVideoId。 */
      ivsVideoId: string
      courseName: string
      lectureName: string
      destRoot: string
      cloudUserToken?: string
      conflictStrategy?: FileConflictStrategy
      term?: string
      videoSession?: { beginTime: string; teacher: string; classroom: string }
      saveImages?: boolean
      cloudDestRoot?: string
    }): Promise<{ ok: boolean; skipped?: boolean; path?: string; cloudPath?: string; error?: string }> =>
      ipcRenderer.invoke('canvas:ppt-download', opts),
    /** 批量下载多讲 PPT 课件（可选云盘上传）。进度事件 canvas:ppt-progress 带 taskId，
     *  current/total 为讲次级（X/Y 讲），单讲内图片进度折进 phase。 */
    downloadBatch: (opts: {
      taskId?: string
      lectures: Array<{ ivsVideoId: string; lectureName: string; videoSession?: { beginTime: string; teacher: string; classroom: string } }>
      courseName: string
      destRoot: string
      cloudUserToken?: string
      conflictStrategy?: FileConflictStrategy
      term?: string
      saveImages?: boolean
      cloudDestRoot?: string
    }): Promise<{ ok: boolean; results?: Array<{ lectureName: string; ok: boolean; skipped?: boolean; path?: string; cloudPath?: string; error?: string }>; error?: string }> =>
      ipcRenderer.invoke('canvas:ppt-download-batch', opts),
    /** 订阅 PPT 下载进度事件（含 taskId，用于映射到 UI 进度条） */
    onProgress: (cb: (p: { taskId?: string; ivsVideoId: number; current: number; total: number; phase: string; lectureName?: string }) => void) =>
      subscribe<{ taskId?: string; ivsVideoId: number; current: number; total: number; phase: string; lectureName?: string }>('canvas:ppt-progress', cb)
  },
  credentials: {
    list: (): Promise<MaskedCredential[]> => ipcRenderer.invoke('credentials:list'),
    save: (username: string, password: string, label?: string): Promise<{ ok: boolean; id?: string; error?: string }> =>
      ipcRenderer.invoke('credentials:save', { username, password, label }),
    updateLabel: (id: string, label?: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('credentials:update-label', { id, label }),
    delete: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('credentials:delete', id),
    clearAll: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('credentials:clear-all'),
    getFillData: (id?: string): Promise<{ ok: boolean; username?: string; password?: string; error?: string }> =>
      ipcRenderer.invoke('credentials:get-fill-data', id)
  },
  schedule: {
    fetchEvents: (options?: { startDate?: string; endDate?: string }): Promise<ScheduleFetchResult> =>
      ipcRenderer.invoke('schedule:fetch-events', options),
    fetchJiaowu: (xnm?: string, xqm?: string): Promise<JiaowuScheduleResult> =>
      ipcRenderer.invoke('schedule:fetch-jiaowu', xnm, xqm),
    exportIcs: (options: IcsExportOptions, events: ScheduleEvent[]): Promise<IcsExportResult> =>
      ipcRenderer.invoke('schedule:export-ics', options, events)
  },
  /** 测试校内私有中转服务的连通性与健康状态 */
  testPrivateWorker: (
    url: string,
    token?: string,
    tunnel?: PrivateWorkerTunnelConfig
  ): Promise<PrivateWorkerTestResult> =>
    ipcRenderer.invoke('private-worker:test', { url, token, tunnel }),
  /** 获取开发环境内置测试节点就绪状态 */
  getDevWorkerInfo: (): Promise<{ isDev: boolean; devWorkerUrl: string | null }> =>
    ipcRenderer.invoke('private-worker:get-dev-info'),
  /** 启动校内私有中转服务 SSH 隧道 */
  startSshTunnel: (
    config: PrivateWorkerTunnelConfig
  ): Promise<{ success: boolean; pid?: number; error?: string }> =>
    ipcRenderer.invoke('ssh-tunnel:start', config),
  /** 停止校内私有中转服务 SSH 隧道 */
  stopSshTunnel: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ssh-tunnel:stop'),
  /** 获取当前 SSH 隧道运行状态 */
  getSshTunnelStatus: (): Promise<SshTunnelStatus> =>
    ipcRenderer.invoke('ssh-tunnel:status')
}


try {
  contextBridge.exposeInMainWorld('api', api)
} catch (err) {
  console.error('[preload] contextBridge failed:', err)
}

export type ExposedApi = typeof api
