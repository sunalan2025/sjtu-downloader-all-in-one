import type { StateCreator } from 'zustand'
import type { AuthStatus, ActiveTab } from '@shared/types'
import type { AppState } from '../app'

export type Stage = 'welcome' | 'login' | 'browser'

export interface AuthSlice {
  stage: Stage
  activeTab: ActiveTab
  auth: AuthStatus
  lastCourseTab: 'canvas' | 'audited' | 'cnmooc' | 'schedule'
  setStage: (s: Stage) => void
  setActiveTab: (t: ActiveTab) => void
  setAuth: (a: AuthStatus) => void
  setLastCourseTab: (tab: 'canvas' | 'audited' | 'cnmooc' | 'schedule') => void
}

export const createAuthSlice: StateCreator<AppState, [], [], AuthSlice> = set => ({
  stage: 'welcome',
  activeTab: 'audited',
  auth: { loggedIn: false },
  lastCourseTab: 'canvas',
  setStage: stage => set({ stage }),
  setActiveTab: activeTab => set(state => {
    const isCourse = activeTab === 'canvas' || activeTab === 'audited' || activeTab === 'cnmooc' || activeTab === 'schedule'
    return {
      activeTab,
      lastCourseTab: isCourse ? activeTab : state.lastCourseTab
    }
  }),
  setAuth: auth => set({ auth }),
  setLastCourseTab: lastCourseTab => set({ lastCourseTab })
})
