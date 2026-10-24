import type { StateCreator } from 'zustand'
import type {
  Course,
  VideoTask,
  CanvasCourse,
  CanvasTeacherSelection,
  CanvasVideoSession,
  CanvasLectureGroup,
  CanvasFileItem,
  CanvasAssignmentItem,
  CnmoocChapter,
  CnmoocCourse,
  CnmoocResourceFilter
} from '@shared/types'
import type { AppState } from '../app'
import { resetProgressPendingBuffer } from './download-slice'

export type ScanState = 'idle' | 'scanning' | 'done' | 'error'
export type LectureGroup = CanvasLectureGroup

export interface CourseSlice {
  // v.sjtu 旁听课程
  scanState: ScanState
  scanMessage: string
  courses: Course[]
  tasksByCourse: Record<number, VideoTask[]>
  selected: Set<string>
  expandedCourses: Set<number>

  // Canvas 课程
  canvasCourses: CanvasCourse[]
  canvasScanState: ScanState
  canvasScanMessage: string
  canvasExpandedCourses: Set<number>
  canvasCourseData: Record<
    number,
    {
      files: CanvasFileItem[]
      folderMap: Record<number, string>
      moduleFiles: CanvasFileItem[]
      syllabusFiles: CanvasFileItem[]
      assignments?: CanvasAssignmentItem[]
    }
  >
  canvasVideoSessions: Record<number, CanvasVideoSession[]>
  canvasTeachers: Record<number, CanvasTeacherSelection[]>
  canvasSelectedTeachers: Record<number, string[]>
  canvasLtiTokens: Record<number, { token: string; canvasCourseId: string }>
  canvasLectures: Record<number, LectureGroup[]>
  canvasModuleVideos: Record<
    number,
    {
      iframes: Array<{ moduleName: string; pageTitle: string; iframeUrl: string }>
      extTools: Array<{ moduleItemId: number; fileId: string; title: string }>
      extUrls: Array<{ uuid: string; title: string }>
    }
  >
  canvasCourseCategorySelections: Record<
    number,
    {
      files: boolean
      teacher: boolean
      ppt: boolean
      moduleVideo: boolean
      pptPdf: boolean
      assignments?: boolean
    }
  >
  canvasCourseTaskIds: Record<number, string[]>
  canvasGroupByTerm: boolean
  canvasSelectedTerm: string

  // 好大学在线 (cnmooc)
  cnmoocCourses: CnmoocCourse[]
  cnmoocScanState: ScanState
  cnmoocScanMessage: string
  cnmoocExpandedCourses: Set<string>
  cnmoocCourseData: Record<string, { chapters: CnmoocChapter[] }>
  cnmoocResourceFilter: CnmoocResourceFilter

  // 旁听课程 actions
  setScan: (s: ScanState, msg?: string) => void
  setCourses: (c: Course[]) => void
  setTasksForCourse: (id: number, t: VideoTask[]) => void
  resetScanResults: () => void
  setSelected: (s: Set<string>) => void
  toggleSelect: (taskId: string) => void
  toggleSelectMany: (ids: string[], on: boolean) => void
  toggleExpand: (courseId: number) => void

  // Canvas actions
  setCanvasCourses: (c: CanvasCourse[]) => void
  setCanvasScanState: (s: ScanState, msg?: string) => void
  toggleCanvasExpand: (courseId: number) => void
  setCanvasCourseData: (id: number, data: CourseSlice['canvasCourseData'][number]) => void
  setCanvasVideoSessions: (id: number, sessions: CanvasVideoSession[]) => void
  setCanvasTeachers: (id: number, teachers: CanvasTeacherSelection[]) => void
  setCanvasSelectedTeachers: (id: number, teachers: string[]) => void
  setCanvasLtiToken: (id: number, data: { token: string; canvasCourseId: string }) => void
  setCanvasLectures: (id: number, lectures: LectureGroup[]) => void
  setCanvasModuleVideos: (
    id: number,
    videos: {
      iframes: Array<{ moduleName: string; pageTitle: string; iframeUrl: string }>
      extTools: Array<{ moduleItemId: number; fileId: string; title: string }>
      extUrls: Array<{ uuid: string; title: string }>
    }
  ) => void
  setCanvasCourseCategorySelection: (
    id: number,
    sel: Partial<{
      files: boolean
      teacher: boolean
      ppt: boolean
      moduleVideo: boolean
      pptPdf: boolean
      assignments: boolean
    }>
  ) => void
  setAllCanvasCourseCategorySelections: (
    ids: number[],
    sel: Partial<{
      files: boolean
      teacher: boolean
      ppt: boolean
      moduleVideo: boolean
      pptPdf: boolean
      assignments: boolean
    }>
  ) => void
  resetCanvasScanResults: () => void
  deleteCanvasCourseData: (id: number) => void
  setCanvasCourseTaskIds: (id: number, taskIds: string[]) => void
  setCanvasGroupByTerm: (groupByTerm: boolean) => void
  setCanvasSelectedTerm: (term: string) => void

  // cnmooc actions
  setCnmoocCourses: (c: CnmoocCourse[]) => void
  setCnmoocScanState: (s: ScanState, msg?: string) => void
  toggleCnmoocExpand: (courseId: string) => void
  setCnmoocCourseData: (id: string, data: { chapters: CnmoocChapter[] }) => void
  setCnmoocResourceFilter: (f: CnmoocResourceFilter) => void
  resetCnmoocScanResults: () => void
  deleteCnmoocCourseData: (id: string) => void
}

export const createCourseSlice: StateCreator<AppState, [], [], CourseSlice> = set => ({
  scanState: 'idle',
  scanMessage: '',
  courses: [],
  tasksByCourse: {},
  selected: new Set<string>(),
  expandedCourses: new Set<number>(),

  canvasCourses: [],
  canvasScanState: 'idle',
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
  canvasGroupByTerm: true,
  canvasSelectedTerm: 'all',

  cnmoocCourses: [],
  cnmoocScanState: 'idle',
  cnmoocScanMessage: '',
  cnmoocExpandedCourses: new Set<string>(),
  cnmoocCourseData: {},
  cnmoocResourceFilter: 'all',

  setScan: (scanState, scanMessage = '') => set({ scanState, scanMessage }),
  setCourses: courses => set({ courses }),
  setTasksForCourse: (id, tasks) =>
    set(state => ({ tasksByCourse: { ...state.tasksByCourse, [id]: tasks } })),
  resetScanResults: () => {
    resetProgressPendingBuffer()
    set({
      scanState: 'idle',
      scanMessage: '',
      courses: [],
      tasksByCourse: {},
      selected: new Set<string>(),
      expandedCourses: new Set<number>(),
      progress: {},
      downloading: false
    })
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

  setCanvasCourses: canvasCourses => set({ canvasCourses }),
  setCanvasScanState: (canvasScanState, canvasScanMessage = '') =>
    set({ canvasScanState, canvasScanMessage }),
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
    resetProgressPendingBuffer()
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
      canvasCourseTaskIds: {}
    })
  },
  deleteCanvasCourseData: id =>
    set(state => {
      const { [id]: _1, ...restCourseData } = state.canvasCourseData
      const { [id]: _2, ...restLectures } = state.canvasLectures
      const { [id]: _3, ...restLti } = state.canvasLtiTokens
      const { [id]: _4, ...restModuleVideos } = state.canvasModuleVideos
      return {
        canvasCourseData: restCourseData,
        canvasLectures: restLectures,
        canvasLtiTokens: restLti,
        canvasModuleVideos: restModuleVideos
      }
    }),
  setCanvasCourseTaskIds: (id, taskIds) =>
    set(state => ({ canvasCourseTaskIds: { ...state.canvasCourseTaskIds, [id]: taskIds } })),
  setCanvasGroupByTerm: canvasGroupByTerm => set({ canvasGroupByTerm }),
  setCanvasSelectedTerm: canvasSelectedTerm => set({ canvasSelectedTerm }),

  setCnmoocCourses: cnmoocCourses => set({ cnmoocCourses }),
  setCnmoocScanState: (cnmoocScanState, cnmoocScanMessage = '') =>
    set({ cnmoocScanState, cnmoocScanMessage }),
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
    resetProgressPendingBuffer()
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
    })
})
