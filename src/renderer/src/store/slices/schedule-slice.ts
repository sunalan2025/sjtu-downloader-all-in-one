import type { StateCreator } from 'zustand'
import type { AppState } from '../app'

export interface ScheduleSlice {
  scheduleSelectedSemesterKey: string
  scheduleViewMode: 'week' | 'semester'
  scheduleLayerFilter: { course: boolean; activity: boolean; ddl: boolean }
  scheduleExpandNoonSlot: boolean
  setScheduleSelectedSemesterKey: (key: string) => void
  setScheduleViewMode: (mode: 'week' | 'semester') => void
  setScheduleLayerFilter: (
    filter:
      | Partial<{ course: boolean; activity: boolean; ddl: boolean }>
      | ((prev: { course: boolean; activity: boolean; ddl: boolean }) => {
          course: boolean
          activity: boolean
          ddl: boolean
        })
  ) => void
  setScheduleExpandNoonSlot: (expand: boolean) => void
}

export const createScheduleSlice: StateCreator<AppState, [], [], ScheduleSlice> = set => ({
  scheduleSelectedSemesterKey: 'current',
  scheduleViewMode: 'week',
  scheduleLayerFilter: { course: true, activity: true, ddl: true },
  scheduleExpandNoonSlot: false,
  setScheduleSelectedSemesterKey: scheduleSelectedSemesterKey => set({ scheduleSelectedSemesterKey }),
  setScheduleViewMode: scheduleViewMode => set({ scheduleViewMode }),
  setScheduleLayerFilter: filter =>
    set(state => ({
      scheduleLayerFilter:
        typeof filter === 'function'
          ? (
              filter as (prev: {
                course: boolean
                activity: boolean
                ddl: boolean
              }) => { course: boolean; activity: boolean; ddl: boolean }
            )(state.scheduleLayerFilter)
          : { ...state.scheduleLayerFilter, ...filter }
    })),
  setScheduleExpandNoonSlot: scheduleExpandNoonSlot => set({ scheduleExpandNoonSlot })
})
