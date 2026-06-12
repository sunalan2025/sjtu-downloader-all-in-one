import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useShallow } from 'zustand/shallow'
import type { AuthStatus, CloudPanSpaceInfo, Course, DownloadMode, DownloadProgress, DownloadState, VideoTask } from '@shared/types'

export type Stage = 'welcome' | 'login' | 'browser'

export type ScanState = 'idle' | 'scanning' | 'done' | 'error'

export type Theme = 'light' | 'dark' | 'system'

interface AppState {
  theme: Theme
  stage: Stage
  auth: AuthStatus
  // 扫描结果
  scanState: ScanState
  scanMessage: string
  courses: Course[]
  /** 每门课对应的全部视频任务（每节课 2 条：教师 + PPT） */
  tasksByCourse: Record<number, VideoTask[]>
  // 用户选择
  selected: Set<string>
  /** 展开的课程 id */
  expandedCourses: Set<number>
  // 交大云盘
  cloudUserToken: string | null
  cloudSpaceInfo: CloudPanSpaceInfo | null
  // 下载模式
  downloadMode: DownloadMode
  localDestRoot: string
  /** both 模式下 localTaskId → cloudTaskId 映射，用于进度聚合 */
  cloudLinkedIds: Record<string, string>
  // 下载状态
  downloading: boolean
  progress: Record<string, DownloadProgress>
  /** 并发下载数，2-16，会同步到主进程 */
  concurrency: number
  // setters
  setTheme: (t: Theme) => void
  setStage: (s: Stage) => void
  setAuth: (a: AuthStatus) => void
  setScan: (s: ScanState, msg?: string) => void
  setCourses: (c: Course[]) => void
  setTasksForCourse: (id: number, t: VideoTask[]) => void
  resetScanResults: () => void
  setSelected: (s: Set<string>) => void
  toggleSelect: (taskId: string) => void
  toggleSelectMany: (ids: string[], on: boolean) => void
  toggleExpand: (courseId: number) => void
  setCloudUserToken: (token: string | null) => void
  setCloudSpaceInfo: (info: CloudPanSpaceInfo | null) => void
  setDownloadMode: (m: DownloadMode) => void
  setLocalDestRoot: (p: string) => void
  setCloudLinkedIds: (m: Record<string, string>) => void
  setDownloading: (b: boolean) => void
  applyProgress: (p: DownloadProgress) => void
  setConcurrency: (n: number) => void
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
      const cloudId = s.cloudLinkedIds[taskId]
      return [s.progress[taskId], cloudId ? s.progress[cloudId] : undefined]
    })
  )

  if (!cloud) return local   // 非 both 模式或该任务无云端镜像 → 直接返回本地进度
  if (!local && !cloud) return undefined

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
    const cpct = cloud && cloud.total > 0 ? Math.round((cloud.received / cloud.total) * 100) : 0
    mergedMsg = `本地完成 · 云端上传中 ${cpct}%`
  }
  return { taskId, state: mergedState, received: mergedReceived, total: mergedTotal, message: mergedMsg }
}

export const useAppStore = create<AppState>()(
  persist(
    set => ({
      theme: 'dark',
      stage: 'welcome',
      auth: { loggedIn: false },
      ...emptyScanResults,
      cloudUserToken: null,
      cloudSpaceInfo: null,
      downloadMode: 'cloud',
      localDestRoot: '',
      cloudLinkedIds: {},
      concurrency: 3,
      setTheme: theme => set({ theme }),
      setStage: stage => set({ stage }),
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
      setCloudUserToken: cloudUserToken => set({ cloudUserToken }),
      setCloudSpaceInfo: cloudSpaceInfo => set({ cloudSpaceInfo }),
      setDownloadMode: downloadMode => set({ downloadMode }),
      setLocalDestRoot: localDestRoot => set({ localDestRoot }),
      setCloudLinkedIds: cloudLinkedIds => set({ cloudLinkedIds }),
      setDownloading: downloading => set({ downloading }),
      applyProgress: p =>
        set(state => ({ progress: { ...state.progress, [p.taskId]: p } })),
      setConcurrency: n => set({ concurrency: clampConcurrency(n) })
    }),
    {
      name: 'sjtu-audited-downloader',
      storage: createJSONStorage(() => localStorage),
      // 只持久化用户偏好；扫描结果、选中态、进度都是临时数据
      partialize: state => ({
        theme: state.theme,
        cloudUserToken: state.cloudUserToken,
        concurrency: state.concurrency,
        downloadMode: state.downloadMode,
        localDestRoot: state.localDestRoot
      })
    }
  )
)
