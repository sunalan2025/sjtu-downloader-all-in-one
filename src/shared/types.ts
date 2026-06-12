// ─────────────────────────────────────────────────────────────
// 站点与 webview 相关常量
// ─────────────────────────────────────────────────────────────

export const SJTU_PARTITION = 'persist:sjtu'
export const V_SJTU_ORIGIN = 'https://v.sjtu.edu.cn'

/** webview 内 localStorage 存 jwt 的 key，登录回跳后由 SPA 自己写入 */
export const VSJTU_JWT_LS_KEY = '_jy-application-resmgr-ui_SESSION_JWT_TOKEN'

// ─────────────────────────────────────────────────────────────
// v.sjtu 后端 API
// 所有请求都要带 jwt-token 头
// ─────────────────────────────────────────────────────────────

export const V_SJTU_API_BASE = 'https://v.sjtu.edu.cn/jy-application-resmgr'

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

export interface ApiEnvelope<T> {
  code: string
  data: T
  message: string | null
  status: number
  success: boolean
  timestamp: number
}

/** /audit-course/my 等使用的分页结构 */
export interface PageResult<T> {
  currPage: number
  pageSize: number
  totalCount: number
  totalPage: number
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
  resourceId: number
  videoName: string
  /** ivs 系统里的 courseId，用来打 vod-info-by-course-id 取直链 */
  refId: number
  sort: number
  sortTime?: string
  courBeginTime?: number
  courEndTime?: number
  /** 课程审计状态：1=开放, 0=关闭（关闭并不影响旁听者下载） */
  courAuditStatus?: 0 | 1
  releaseStatus?: 0 | 1
  ivsReleaseStatus?: 0 | 1
}


// ─────────────────────────────────────────────────────────────
// 应用层 DTO（renderer ↔ main 通信用）
// ─────────────────────────────────────────────────────────────

export interface AuthStatus {
  loggedIn: boolean
  /** 登录检测的最后一次时间，ISO 字符串 */
  checkedAt?: string
}

/** 列表展示用的简化课程 */
export interface Course {
  /** resourceId（用来打 audit-course-detail） */
  id: number
  /** 申请记录 id，便于做去重 key */
  applyId: number
  name: string
  courseCode?: string
  teacher?: string
  term?: string
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

export type DownloadMode = 'local' | 'cloud' | 'both'

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

export type DownloadState =
  | 'pending'
  | 'downloading'
  | 'paused'
  | 'cancelled'
  | 'done'
  | 'error'
  | 'skipped'

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

// ─────────────────────────────────────────────────────────────
// 交大云盘 (pan.sjtu.edu.cn) 相关
// ─────────────────────────────────────────────────────────────

export interface CloudPanSpaceCred {
  accessToken: string
  expiresIn: number
  libraryId: string
  spaceId: string
  /** 0=成功 */
  status: number
  message?: string
}

export interface CloudPanUploadPart {
  headers: {
    authorization: string
    'x-amz-content-sha256': string
    'x-amz-date': string
  }
}

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

export interface CloudPanConfirmResult {
  name: string
  size: string
  type: string
  path: string[]
  status: number
  message?: string
}

export interface CloudPanSpaceInfo {
  availableSpace: string
  capacity: string
  hasPersonalSpace: boolean
  size: string
}
