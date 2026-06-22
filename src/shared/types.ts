// ─────────────────────────────────────────────────────────────
// 站点与 webview 相关常量
// ─────────────────────────────────────────────────────────────

/** sjtu 子域名共享的 Electron partition 标识，保证 cookie/localStorage 持久化 */
export const SJTU_PARTITION = 'persist:sjtu'
/** v.sjtu.edu.cn 站点 origin */
export const V_SJTU_ORIGIN = 'https://v.sjtu.edu.cn'

/** webview 内 localStorage 存 jwt 的 key，登录回跳后由 SPA 自己写入 */
export const VSJTU_JWT_LS_KEY = '_jy-application-resmgr-ui_SESSION_JWT_TOKEN'

// ─────────────────────────────────────────────────────────────
// v.sjtu 后端 API
// 所有请求都要带 jwt-token 头
// ─────────────────────────────────────────────────────────────

/** resmgr API 基础路径 */
export const V_SJTU_API_BASE = 'https://v.sjtu.edu.cn/jy-application-resmgr'

/** v.sjtu resmgr 各接口相对路径 */
export const V_SJTU_API = {
  /** POST: 我的旁听课程申请列表  body: { pageNo, pageSize } */
  auditCourseMy: '/audit-course/my',
  /** POST: 旁听课程的资源详情（课程基本信息 + videos 列表）  body: { resourceId } */
  auditCourseDetail: '/resmgr-resource/detail/auditCourse',
  /** GET: 用一节视频的 refId（=ivs 系统里的 courseId）取直链  query: courseId */
  vodInfoByCourseId: '/resmgr-ivs-res/vod-info-by-course-id'
} as const

// ─────────────────────────────────────────────────────────────
// 后端响应包装结构
// ─────────────────────────────────────────────────────────────

/** v.sjtu 后端统一的响应信封结构，所有 API 返回值都用此格式包装 */
export interface ApiEnvelope<T> {
  /** 业务状态码，"0" 表示成功 */
  code: string
  /** 响应数据，T 由具体接口决定 */
  data: T
  /** 错误或附加消息，成功时通常为 null */
  message: string | null
  /** HTTP 状态码 */
  status: number
  /** 是否成功 */
  success: boolean
  /** 服务端时间戳（毫秒） */
  timestamp: number
}

/** /audit-course/my 等使用的分页结构 */
export interface PageResult<T> {
  /** 当前页码（1-based） */
  currPage: number
  /** 每页条数 */
  pageSize: number
  /** 总记录数 */
  totalCount: number
  /** 总页数 */
  totalPage: number
  /** 当前页数据列表 */
  list: T[]
}

// ─────────────────────────────────────────────────────────────
// 业务模型
// ─────────────────────────────────────────────────────────────

/** /audit-course/my 一条记录 = 一次旁听申请（一门课可能有多次申请） */
export interface AuditCourseItem {
  /** 申请记录 id（不是 resource id） */
  id: number
  acteId: number
  /** 学期文本，例如 "YYYY-YYYY学年第N学期" */
  acteTerm: string
  /** 申请状态 0=申请中  1=已批准 */
  applyStatus: 0 | 1
  applyStatusLabel?: string
  subjId: number
  /** 课程名 */
  subjName: string
  /** 课程代码 */
  subjCode: string
  /** 任课教师 */
  teacName: string
  /** 开课院系 */
  orgaName?: string
  /** 该申请对应的可访问资源（一对一） */
  auditCourseResources: Array<{
    resourceId: number
    teclCode?: string
  }>
}

/** /resmgr-resource/detail/auditCourse 的 data — 课程详情 + 全部视频元信息 */
export interface AuditCourseDetail {
  id: number
  resourceName: string
  resourceCode?: string
  speaker?: string
  teclName?: string
  subjectOrg?: string
  videoSize?: number
  videos: AuditCourseVideo[]
}

/** 课程详情里的一节视频 */
export interface AuditCourseVideo {
  /** videoId */
  id: number
  /** 所属资源 id */
  resourceId: number
  /** 视频标题 */
  videoName: string
  /** ivs 系统里的 courseId，用来打 vod-info-by-course-id 取直链 */
  refId: number
  /** 排序序号 */
  sort: number
  /** 排序时间文本 */
  sortTime?: string
  /** 课程开始时间（时间戳毫秒） */
  courBeginTime?: number
  /** 课程结束时间（时间戳毫秒） */
  courEndTime?: number
  /** 课程审计状态：1=开放, 0=关闭（关闭并不影响旁听者下载） */
  courAuditStatus?: 0 | 1
  /** 发布状态 */
  releaseStatus?: 0 | 1
  /** IVS 发布状态 */
  ivsReleaseStatus?: 0 | 1
}


// ─────────────────────────────────────────────────────────────
// 应用层 DTO（renderer ↔ main 通信用）
// ─────────────────────────────────────────────────────────────

export interface AuthStatus {
  loggedIn: boolean
  /** 当前已登录 jAccount 账号名（显示用，托盘/标题栏）；登录但解析失败时为 undefined */
  accountName?: string
  /** 登录检测的最后一次时间，ISO 字符串 */
  checkedAt?: string
}

/** 列表展示用的简化课程 */
export interface Course {
  /** resourceId（用来打 audit-course-detail） */
  id: number
  /** 申请记录 id，便于做去重 key */
  applyId: number
  /** 课程显示名 */
  name: string
  /** 课程代码 */
  courseCode?: string
  /** 任课教师 */
  teacher?: string
  /** 学期文本 */
  term?: string
  /** 开课院系 */
  org?: string
}

/** 一节课 × 一路视角 = 一个下载任务（教师 angle=0 / PPT angle=3）。
 *  扫描阶段不调 vod-info，所以直链 URL 此时尚未解析；下载点击时再现拉。 */
export interface VideoTask {
  /** 跨进程稳定 id：`${courseId}_${videoId}_${angle}` */
  taskId: string
  courseId: number
  videoId: number
  /** ivs courseId，下载前用来拉 vod-info 取直链 */
  refId: number
  angle: 0 | 3
  viewLabel: '教师' | 'PPT'
  /** "第1讲" 形式 — 按 sortTime 重新编号后的稳定序号 */
  lectureLabel: string
  /** 这一讲对应的上课日期，"YYYY-MM-DD"；副标显示用 */
  lectureDate?: string
  /** 排序键：chronological position (1-based) */
  sort: number
  sortTime?: string
  /** 落盘文件名 `课程名-教师-学期-第几讲-视角.mp4`（main 端会再做合法字符 sanitize） */
  fileName: string
  // 冗余：直接拿到的课程级元信息，方便在列表显示
  courseName: string
  teacher: string
  term: string
}

// ─────────────────────────────────────────────────────────────
// 下载相关
// ─────────────────────────────────────────────────────────────

/** 下载模式 */
export type DownloadMode = 'local' | 'cloud' | 'both'

/** 同名文件冲突策略：skip=跳过已存在的同名文件，overwrite=先删除已存在文件再下载/上传 */
export type FileConflictStrategy = 'skip' | 'overwrite'

/** 下载任务规格：由 renderer 组装，传给 main 端调度下载/上传 */
export interface DownloadTaskSpec {
  /** 前端生成的唯一 id，用于关联进度回调 */
  taskId: string
  url: string
  /** 课程名（main 会做 sanitize 并拼到 destRoot 之下） */
  courseName: string
  fileName: string
  /** 交大云盘 UserToken；存在时走云盘上传而非本地下载 */
  cloudUserToken?: string
  /** vod-info 资源 id，用于按需解析直链（lazy resolution） */
  refId?: number
  /** 视角：0=教师, 3=PPT */
  angle?: number
}

/** 下载/上传任务状态机 */
export type DownloadState =
  | 'pending'
  | 'downloading'
  | 'paused'
  | 'cancelled'
  | 'done'
  | 'error'
  | 'skipped'

/** 主进程推送到 renderer 的下载/上传进度条目 */
export interface DownloadProgress {
  taskId: string
  state: DownloadState
  received: number
  total: number
  /** 落盘文件最终绝对路径（done/skipped 时有；云盘模式下无此字段） */
  filePath?: string
  /** 错误或附加说明（error/skipped 时有） */
  message?: string
}

/** 实时传输速度（字节/秒），由主进程 1s 推送一次，EMA 平滑后 */
export interface TransferSpeed {
  /** 下行速度（CDN→本机下载字节/秒） */
  down: number
  /** 上行速度（本机→云盘上传字节/秒） */
  up: number
}

// ─────────────────────────────────────────────────────────────
// 交大云盘 (pan.sjtu.edu.cn) 相关
// ─────────────────────────────────────────────────────────────

/** 交大云盘 space credentials，用于获取上传权限 */
export interface CloudPanSpaceCred {
  accessToken: string
  expiresIn: number
  libraryId: string
  spaceId: string
  /** 0=成功 */
  status: number
  message?: string
}

/** COS 分片上传的请求头（每个分片需要不同的签名） */
export interface CloudPanUploadPart {
  headers: {
    authorization: string
    'x-amz-content-sha256': string
    'x-amz-date': string
  }
}

/** 交大云盘分片上传的启动响应 */
export interface CloudPanStartUploadResult {
  confirmKey: string
  domain: string
  expiration: string
  parts: Record<string, CloudPanUploadPart>
  path: string
  uploadId: string
  status: number
  message?: string
}

/** 分片上传完成后的确认响应 */
export interface CloudPanConfirmResult {
  name: string
  size: string
  type: string
  path: string[]
  status: number
  message?: string
}

/** 交大云盘个人空间容量信息 */
export interface CloudPanSpaceInfo {
  availableSpace: string
  capacity: string
  hasPersonalSpace: boolean
  size: string
}

// ─────────────────────────────────────────────────────────────
// Canvas (oc.sjtu.edu.cn) 相关
// ─────────────────────────────────────────────────────────────

export const CANVAS_BASE_URL = 'https://oc.sjtu.edu.cn'
export const CANVAS_API_BASE = 'https://oc.sjtu.edu.cn/api/v1'
export const VSJTU_CANVAS_BASE = 'https://v.sjtu.edu.cn/jy-application-canvas-sjtu'

/** Canvas 课程 */
export interface CanvasCourse {
  courseId: number
  name: string
  courseCode: string
  term: string
  teachers: string[]
  enrollmentState: string
  url: string
}

/** Canvas 文件 */
export interface CanvasFileItem {
  fileId: number
  displayName: string
  filename: string
  url: string
  size: number
  folderId: number | null
  locked: boolean
}

/** Canvas 模块 */
export interface CanvasModule {
  id: number
  name: string
  items: CanvasModuleItem[]
}

export interface CanvasModuleItem {
  type: string
  contentId: number | null
  title: string
  pageUrl: string | null
}

/** "课堂视频new" 一次录课会话 */
export interface CanvasVideoSession {
  videoId: string
  courId: number
  teacher: string
  classroom: string
  beginTime: string
  videoName: string
}

/** 课堂视频的一路流（教师 / PPT） */
export interface CanvasClassVideoInfo {
  channelNum: number
  url: string
  label: string
}

/** Canvas 下载任务的来源分类 */
export type CanvasTaskSource =
  | 'canvas-files'
  | 'canvas-modules'
  | 'canvas-syllabus'
  | 'canvas-class-video'
  | 'canvas-module-video'

/** 扩展 DownloadTaskSpec，增加 Canvas 来源标记和路径信息 */
export interface CanvasDownloadTaskSpec extends DownloadTaskSpec {
  /** Canvas 任务来源分类 */
  source: CanvasTaskSource
  /** Canvas 课程 ID，用于关联 */
  canvasCourseId?: number
  /** 文件在 Canvas 上的相对路径（files 的文件夹层级） */
  canvasRelPath?: string
  /** 课堂视频懒解析所需（source='canvas-class-video' 时）。
   *  url 留空，由 resolveDirectUrl 在下载前调 fetchVodVideoInfos 解析。 */
  /** vod 系统 videoId */
  canvasVideoId?: string
  /** LTI token，解析直链用 */
  canvasVideoToken?: string
  /** 流序号：0=教师, 1=PPT（决定取 channels 的哪一路） */
  canvasStreamIdx?: number
}

/** 教师筛选选项（多教师课程用） */
export interface CanvasTeacherSelection {
  teacher: string
  count: number
  selected: boolean
}

/** Canvas 课堂视频按讲次分组（每讲含教师+PPT 两路流，由 getVodVideoInfos 解出）。
 *  main 端 orchestrator.groupLectures 产出，renderer 侧 LectureGroup 与之同构。 */
export interface CanvasLectureGroup {
  lectureNum: number
  date: string
  teacher?: CanvasVideoSession
}

/** 渲染端顶部 tab */
export type ActiveTab = 'audited' | 'canvas'

// ─────────────────────────────────────────────────────────────
// vod-info API 响应结构（用于 resolveDirectUrl 类型安全）
// ─────────────────────────────────────────────────────────────

/** vod-info-by-course-id 返回的单路视频信息 */
export interface VodVideoInfo {
  /** 视角编号：0=教师, 3=PPT */
  angle: number
  /** 各播放直链（通常只有一个元素） */
  extendPlayUrls?: string[]
}

/** vod-info-by-course-id 接口返回的 data 字段结构 */
export interface VodInfoData {
  videoInfos?: VodVideoInfo[]
}
