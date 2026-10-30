import type {
  VideoQualityOption,
  VideoPerspective
} from '@shared/types'

export type SettingsNav = 'general' | 'storage' | 'media' | 'network' | 'account' | 'about'

export interface SettingsProps {
  onLogout?: () => void
  initialNav?: string
  videoQualityOption?: VideoQualityOption
  videoPerspectivePreference?: VideoPerspective
  cloudUserToken?: string | null
  cloudSpaceInfo?: { size: number | string; capacity: number | string } | null
  auth?: { loggedIn?: boolean; accountName?: string; studentId?: string }
}
