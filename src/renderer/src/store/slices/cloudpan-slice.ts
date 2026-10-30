import type { StateCreator } from 'zustand'
import type { CloudPanSpaceInfo } from '@shared/types'
import type { AppState } from '../app'

export interface CloudPanSlice {
  cloudUserToken: string | null
  cloudSpaceInfo: CloudPanSpaceInfo | null
  cloudConnStatus: 'idle' | 'connecting' | 'error'
  cloudConnMessage: string
  setCloudUserToken: (token: string | null) => void
  setCloudSpaceInfo: (info: CloudPanSpaceInfo | null) => void
  setCloudConnStatus: (status: 'idle' | 'connecting' | 'error', message?: string) => void
}

export const createCloudPanSlice: StateCreator<AppState, [], [], CloudPanSlice> = set => ({
  cloudUserToken: null,
  cloudSpaceInfo: null,
  cloudConnStatus: 'idle',
  cloudConnMessage: '',
  setCloudUserToken: cloudUserToken => set({ cloudUserToken }),
  setCloudSpaceInfo: cloudSpaceInfo => set({ cloudSpaceInfo }),
  setCloudConnStatus: (cloudConnStatus, cloudConnMessage = '') =>
    set({ cloudConnStatus, cloudConnMessage })
})
