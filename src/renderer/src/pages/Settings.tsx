import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '../components/ui'
import { useAppStore } from '../store/app'
import { prefetchCloudConnection } from '../services/prefetch'
import type { MaskedCredential } from '@shared/types'
import { GeneralSection } from './settings/sections/GeneralSection'
import { StorageSection } from './settings/sections/StorageSection'
import { MediaSection } from './settings/sections/MediaSection'
import { NetworkSection } from './settings/sections/NetworkSection'
import { AccountSection } from './settings/sections/AccountSection'
import { AboutSection } from './settings/sections/AboutSection'
import type { SettingsProps } from './settings/types'

export type { SettingsProps } from './settings/types'

export function Settings({
  onLogout,
  initialNav = 'general',
  videoQualityOption: propVideoQuality,
  videoPerspectivePreference: propPerspective,
  cloudUserToken: propCloudToken,
  cloudSpaceInfo: propCloudSpace,
  auth: propAuth
}: SettingsProps) {
  const storeAuth = useAppStore(s => s.auth)
  const auth = propAuth !== undefined ? propAuth : storeAuth

  // --- 导航状态 ---
  const [activeNav, setActiveNav] = useState(initialNav)

  // --- 存储相关 ---
  const localDestRoot = useAppStore(s => s.localDestRoot)
  const setLocalDestRoot = useAppStore(s => s.setLocalDestRoot)
  const namingTemplate = useAppStore(s => s.namingTemplate)
  const [defaultDownloadsDir, setDefaultDownloadsDir] = useState<string>('')
  const [isCustomTemplate, setIsCustomTemplate] = useState(
    Boolean(namingTemplate && !['{course}/{title}', '{term}/{course}/{title}'].includes(namingTemplate))
  )

  useEffect(() => {
    let mounted = true
    if (typeof window !== 'undefined' && window.api?.getDefaultDownloadsDir) {
      window.api.getDefaultDownloadsDir().then((p: string) => {
        if (mounted && p) setDefaultDownloadsDir(p)
      }).catch(() => undefined)
    }
    return () => {
      mounted = false
    }
  }, [])

  const resolvedLocalPath = localDestRoot || defaultDownloadsDir
  const isDefaultLocalPath = !localDestRoot

  const handleSelectFolder = async (): Promise<void> => {
    const p = await window.api.selectFolder()
    if (p) setLocalDestRoot(p)
  }

  // --- 云盘相关 ---
  const storeCloudToken = useAppStore(s => s.cloudUserToken)
  const cloudUserToken = propCloudToken !== undefined ? propCloudToken : storeCloudToken
  const storeCloudSpace = useAppStore(s => s.cloudSpaceInfo)
  const cloudSpaceInfo = propCloudSpace !== undefined ? propCloudSpace : storeCloudSpace

  const handleCloudToggle = async (): Promise<void> => {
    if (cloudUserToken) {
      useAppStore.getState().setCloudUserToken(null)
      useAppStore.getState().setCloudSpaceInfo(null)
    } else {
      await prefetchCloudConnection()
    }
  }

  const cloudPercent = (() => {
    if (!cloudSpaceInfo) return null
    const sizeNum = typeof cloudSpaceInfo.size === 'number' ? cloudSpaceInfo.size : parseFloat(String(cloudSpaceInfo.size))
    const capNum = typeof cloudSpaceInfo.capacity === 'number' ? cloudSpaceInfo.capacity : parseFloat(String(cloudSpaceInfo.capacity))
    if (!capNum || isNaN(sizeNum) || isNaN(capNum) || capNum <= 0) return null
    return Math.min(100, Math.round((sizeNum / capNum) * 100))
  })()

  // --- 课件与多媒体 ---
  const storeVideoQuality = useAppStore(s => s.videoQualityOption)
  const setVideoQualityOption = useAppStore(s => s.setVideoQualityOption)
  const videoQualityOption = propVideoQuality ?? storeVideoQuality

  const storePerspective = useAppStore(s => s.videoPerspectivePreference)
  const setVideoPerspectivePreference = useAppStore(s => s.setVideoPerspectivePreference)
  const videoPerspectivePreference = propPerspective ?? storePerspective

  const isAudioOnly = videoQualityOption === 'audio_only' || videoPerspectivePreference === 'audio'
  const handleToggleAudioOnly = useCallback((enabled: boolean) => {
    if (enabled) {
      setVideoQualityOption('audio_only')
      setVideoPerspectivePreference('audio')
    } else {
      setVideoQualityOption('origin')
      setVideoPerspectivePreference('teacher')
    }
  }, [setVideoQualityOption, setVideoPerspectivePreference])

  // --- 账号与凭据 ---
  const [credentials, setCredentials] = useState<MaskedCredential[]>([])
  const [isLoadingCreds, setIsLoadingCreds] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')
  const [showClearModal, setShowClearModal] = useState(false)
  const [credToDelete, setCredToDelete] = useState<MaskedCredential | null>(null)

  const loadCredentials = async (): Promise<void> => {
    if (typeof window === 'undefined' || !window.api?.credentials) return
    setIsLoadingCreds(true)
    try {
      const list = await window.api.credentials.list()
      setCredentials(list)
    } catch {
      // 忽略凭据库读取错误
    } finally {
      setIsLoadingCreds(false)
    }
  }

  useEffect(() => {
    if (activeNav === 'account') {
      void loadCredentials()
    }
  }, [activeNav])

  const handleSaveLabel = async (id: string): Promise<void> => {
    if (typeof window === 'undefined' || !window.api?.credentials) return
    const trimmed = editingLabel.trim()
    await window.api.credentials.updateLabel(id, trimmed || undefined)
    setEditingId(null)
    setEditingLabel('')
    await loadCredentials()
  }

  const handleDelete = async (): Promise<void> => {
    if (!credToDelete || typeof window === 'undefined' || !window.api?.credentials) return
    await window.api.credentials.delete(credToDelete.id)
    setCredToDelete(null)
    await loadCredentials()
  }

  const handleClearAll = async (): Promise<void> => {
    if (typeof window === 'undefined' || !window.api?.credentials) return
    await window.api.credentials.clearAll()
    setShowClearModal(false)
    await loadCredentials()
  }

  // --- 更新相关 ---
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateMessage, setUpdateMessage] = useState<string | null>(null)

  const handleManualCheckUpdate = async (): Promise<void> => {
    if (typeof window === 'undefined' || !window.api?.checkUpdate) return
    setUpdateChecking(true)
    setUpdateMessage(null)
    try {
      const r = await window.api.checkUpdate()
      if (r.hasUpdate) {
        setUpdateMessage(`发现新版本 v${r.latestVersion}！`)
      } else {
        setUpdateMessage('当前已是最新版本，无需更新。')
      }
    } catch {
      setUpdateMessage('检查更新失败，请确认网络连接后重试。')
    } finally {
      setUpdateChecking(false)
    }
  }

  return (
    <div className="ui-page">
      <PageHeader title="全局设置" description="管理外观、存储、网络与账号偏好" />
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* 左栏分类导航 */}
        <aside className="w-44 shrink-0 overflow-y-auto border-r border-bd bg-surface-1 p-3 flex flex-col gap-1 select-none">
          {[
            { id: 'general', label: '⚙️ 常规偏好' },
            { id: 'storage', label: '📦 存储与下载' },
            { id: 'media', label: '🎬 课件与多媒体' },
            { id: 'network', label: '⚡ 传输与网络' },
            { id: 'account', label: '🔐 账号与云盘' },
            { id: 'about', label: 'ℹ️ 关于与更新' }
          ].map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveNav(item.id)}
              className={`flex items-center rounded-lg px-3 py-2 text-left text-xs font-medium transition-all cursor-pointer ${
                activeNav === item.id
                  ? 'bg-accent/10 text-accent font-semibold'
                  : 'text-text-3 hover:bg-surface-2 hover:text-text-1'
              }`}
            >
              {item.label}
            </button>
          ))}
        </aside>

        {/* 右栏内容 */}
        <main className="ui-content pb-16">
          <div className="mx-auto w-full max-w-5xl">
            {activeNav === 'general' && <GeneralSection />}

            {activeNav === 'storage' && (
              <StorageSection
                handleSelectFolder={handleSelectFolder}
                resolvedLocalPath={resolvedLocalPath}
                isDefaultLocalPath={isDefaultLocalPath}
                isCustomTemplate={isCustomTemplate}
                setIsCustomTemplate={setIsCustomTemplate}
              />
            )}

            {activeNav === 'media' && (
              <MediaSection
                videoQualityOption={videoQualityOption}
                setVideoQualityOption={setVideoQualityOption}
                videoPerspectivePreference={videoPerspectivePreference}
                setVideoPerspectivePreference={setVideoPerspectivePreference}
                isAudioOnly={isAudioOnly}
                handleToggleAudioOnly={handleToggleAudioOnly}
              />
            )}

            {activeNav === 'network' && <NetworkSection />}

            {activeNav === 'account' && (
              <AccountSection
                auth={auth}
                onLogout={onLogout}
                cloudUserToken={cloudUserToken}
                cloudSpaceInfo={cloudSpaceInfo}
                cloudPercent={cloudPercent}
                handleCloudToggle={handleCloudToggle}
                credentials={credentials}
                isLoadingCreds={isLoadingCreds}
                editingId={editingId}
                setEditingId={setEditingId}
                editingLabel={editingLabel}
                setEditingLabel={setEditingLabel}
                showClearModal={showClearModal}
                setShowClearModal={setShowClearModal}
                credToDelete={credToDelete}
                setCredToDelete={setCredToDelete}
                handleSaveLabel={handleSaveLabel}
                handleDelete={handleDelete}
                handleClearAll={handleClearAll}
              />
            )}

            {activeNav === 'about' && (
              <AboutSection
                updateChecking={updateChecking}
                updateMessage={updateMessage}
                handleManualCheckUpdate={handleManualCheckUpdate}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

export default Settings
