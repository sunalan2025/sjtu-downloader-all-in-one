import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore, type Stage } from './store/app'
import { TitleBar, applyTheme } from './components/TitleBar'
import { WindowConfirmModal } from './components/WindowConfirmModal'
import { Welcome } from './pages/Welcome'
import { Login } from './pages/Login'
import { Browser } from './pages/Browser'
import { CanvasBrowser } from './pages/CanvasBrowser'
import { CnmoocBrowser } from './pages/CnmoocBrowser'
import { TransferCenter } from './pages/TransferCenter'
import { Settings } from './pages/Settings'
import { useDownloadProgressSubscription } from './hooks/useSharedBrowserHooks'
import { prefetchCanvasCourses, prefetchCnmoocCourses, prefetchCloudConnection } from './services/prefetch'
import type { ActiveTab } from '@shared/types'

function StagePane({ stage, children }: { stage: Stage; children: React.ReactNode }) {
  return <div key={stage} className="animate-fadeIn absolute inset-0 flex flex-col">{children}</div>
}

export default function App() {
  const stage = useAppStore(s => s.stage)
  const theme = useAppStore(s => s.theme)
  const activeTab = useAppStore(s => s.activeTab)
  const setStage = useAppStore(s => s.setStage)
  const setAuth = useAppStore(s => s.setAuth)
  const setActiveTab = useAppStore(s => s.setActiveTab)

  const resetScanResults = useAppStore(s => s.resetScanResults)

  // Navigation state for returning from settings
  const [previousTab, setPreviousTab] = useState<ActiveTab>('canvas')

  const handleSettingsClick = () => {
    if (activeTab !== 'settings') {
      setPreviousTab(activeTab)
      setActiveTab('settings')
    }
  }

  const handleBackFromSettings = () => {
    setActiveTab(previousTab)
  }

  // Subscribe to download progress once at App level
  useDownloadProgressSubscription()

  const handleLogout = useCallback(async () => {
    try {
      await window.api.auth.logout()
      setAuth({ loggedIn: false })
      resetScanResults()
      setStage('login')
    } catch { /* ignore */ }
  }, [setAuth, setStage, resetScanResults])

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (): void => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const a = await window.api.auth.status()
        if (cancelled) return
        setAuth(a)
        if (a.loggedIn) {
          setStage('browser')
          const cloudToken = await window.api.cloudpan.getCachedToken()
          if (cloudToken) {
            useAppStore.getState().setCloudUserToken(cloudToken)
          }
        } else {
          useAppStore.getState().setCloudUserToken(null)
          useAppStore.getState().setCloudSpaceInfo(null)
          setStage('login')
        }
      } catch {
        if (!cancelled) setStage('login')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setAuth, setStage])

  const cleanedRef = useRef(false)
  useEffect(() => {
    if (cleanedRef.current) return
    cleanedRef.current = true
    const localDestRoot = useAppStore.getState().localDestRoot || ''
    window.api.cleanupStaleDownloads(localDestRoot).catch(() => undefined)
  }, [])

  const prefetchedRef = useRef(false)
  useEffect(() => {
    if (stage !== 'browser') {
      prefetchedRef.current = false
      return
    }
    if (prefetchedRef.current) return
    prefetchedRef.current = true
    void Promise.allSettled([
      prefetchCanvasCourses(),
      prefetchCnmoocCourses(),
      prefetchCloudConnection()
    ])
  }, [stage])

  return (
    <div className="flex h-full w-full flex-col">
      <TitleBar onLogout={() => void handleLogout()} onOpenSettings={handleSettingsClick} />
      <main className="relative flex flex-1 flex-col overflow-hidden">
        {stage === 'welcome' && (
          <StagePane stage="welcome">
            <Welcome />
          </StagePane>
        )}
        {stage === 'login' && (
          <StagePane stage="login">
            <Login />
          </StagePane>
        )}
        {stage === 'browser' && (
          <StagePane stage="browser">
            <div key={activeTab} className="animate-fadeIn flex-1 overflow-hidden">
              {activeTab === 'audited' && <Browser />}
              {activeTab === 'canvas' && <CanvasBrowser />}
              {activeTab === 'cnmooc' && <CnmoocBrowser />}
              {activeTab === 'transfer' && <TransferCenter />}
              {activeTab === 'settings' && <Settings onBack={handleBackFromSettings} />}
            </div>
          </StagePane>
        )}
      </main>
      <WindowConfirmModal />
    </div>
  )
}
