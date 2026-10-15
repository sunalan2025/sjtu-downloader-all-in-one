import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore, type Stage } from './store/app'
import { TitleBar, applyTheme } from './components/TitleBar'
import { WindowConfirmModal } from './components/WindowConfirmModal'
import { SetupWizardModal } from './components/SetupWizardModal'
import pkg from '../../../package.json'
import { Welcome } from './pages/Welcome'
import { Login } from './pages/Login'
import { AuditedCourses } from './pages/AuditedCourses'
import { CanvasBrowser } from './pages/CanvasBrowser'
import { CnmoocBrowser } from './pages/CnmoocBrowser'
import { TransferCenter } from './pages/TransferCenter'
import { Settings } from './pages/Settings'
import { CloudPanExplorer } from './pages/CloudPanExplorer'
import { ScheduleBrowser } from './pages/ScheduleBrowser'
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

  // 记忆上一次所浏览的课程 Tab，供传输中心与设置页一键返回
  const [previousCourseTab, setPreviousCourseTab] = useState<ActiveTab>('canvas')

  useEffect(() => {
    if (activeTab === 'canvas' || activeTab === 'audited' || activeTab === 'cnmooc' || activeTab === 'schedule') {
      setPreviousCourseTab(activeTab)
    }
  }, [activeTab])

  const handleSettingsClick = () => {
    if (activeTab === 'settings') {
      setActiveTab(previousCourseTab)
    } else {
      setActiveTab('settings')
    }
  }

  const handleTransferClick = () => {
    if (activeTab === 'transfer') {
      setActiveTab(previousCourseTab)
    } else {
      setActiveTab('transfer')
    }
  }

  const handleBackToCourses = () => {
    setActiveTab(previousCourseTab)
  }

  // Subscribe to download progress once at App level
  useDownloadProgressSubscription()

  const handleLogout = useCallback(async () => {
    try {
      await window.api.auth.logout()
      setAuth({ loggedIn: false })
      resetScanResults()
      setStage('welcome')
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
          const currentVersion = window.api?.version || pkg.version
          const lastVersion = useAppStore.getState().lastSetupVersion
          const hasCompleted = useAppStore.getState().hasCompletedInitialSetup
          if (!hasCompleted || !lastVersion || lastVersion !== currentVersion) {
            useAppStore.getState().setShowSetupWizardModal(true)
          }
          setStage('browser')
          const cloudToken = await window.api.cloudpan.getCachedToken()
          if (cloudToken) {
            useAppStore.getState().setCloudUserToken(cloudToken)
          }
        } else {
          useAppStore.getState().setCloudUserToken(null)
          useAppStore.getState().setCloudSpaceInfo(null)
          setStage('welcome')
        }
      } catch {
        if (!cancelled) setStage('welcome')
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
      <TitleBar
        onOpenSettings={handleSettingsClick}
        onOpenTransfer={handleTransferClick}
      />
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
              {activeTab === 'audited' && <AuditedCourses />}
              {activeTab === 'canvas' && <CanvasBrowser />}
              {activeTab === 'cnmooc' && <CnmoocBrowser />}
              {activeTab === 'schedule' && <ScheduleBrowser />}
              {activeTab === 'transfer' && <TransferCenter onBack={handleBackToCourses} />}
              {activeTab === 'settings' && <Settings onBack={handleBackToCourses} onLogout={() => void handleLogout()} />}
              {activeTab === 'cloudpan' && <CloudPanExplorer onBack={handleBackToCourses} />}
            </div>
          </StagePane>
        )}
      </main>
      <WindowConfirmModal />
      <SetupWizardModal />
    </div>
  )
}
