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

  // 惰性挂载 + 页面状态常驻（Keep-Alive）：初次点击才实例化，挂载后常驻 DOM 移出渲染树，零重绘、零显存浪费、状态永不丢失
  const [visitedTabs, setVisitedTabs] = useState<Set<ActiveTab>>(() => new Set([activeTab]))

  useEffect(() => {
    setVisitedTabs(prev => {
      if (prev.has(activeTab)) return prev
      const next = new Set(prev)
      next.add(activeTab)
      return next
    })
  }, [activeTab])

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
            <div className="relative flex-1 overflow-hidden">
              {visitedTabs.has('audited') && (
                <div className={`h-full w-full flex-col ${activeTab === 'audited' ? 'flex' : 'hidden'}`}>
                  <AuditedCourses />
                </div>
              )}
              {visitedTabs.has('canvas') && (
                <div className={`h-full w-full flex-col ${activeTab === 'canvas' ? 'flex' : 'hidden'}`}>
                  <CanvasBrowser />
                </div>
              )}
              {visitedTabs.has('cnmooc') && (
                <div className={`h-full w-full flex-col ${activeTab === 'cnmooc' ? 'flex' : 'hidden'}`}>
                  <CnmoocBrowser />
                </div>
              )}
              {visitedTabs.has('schedule') && (
                <div className={`h-full w-full flex-col ${activeTab === 'schedule' ? 'flex' : 'hidden'}`}>
                  <ScheduleBrowser />
                </div>
              )}
              {visitedTabs.has('transfer') && (
                <div className={`h-full w-full flex-col ${activeTab === 'transfer' ? 'flex' : 'hidden'}`}>
                  <TransferCenter onBack={handleBackToCourses} />
                </div>
              )}
              {visitedTabs.has('settings') && (
                <div className={`h-full w-full flex-col ${activeTab === 'settings' ? 'flex' : 'hidden'}`}>
                  <Settings onBack={handleBackToCourses} onLogout={() => void handleLogout()} />
                </div>
              )}
              {visitedTabs.has('cloudpan') && (
                <div className={`h-full w-full flex-col ${activeTab === 'cloudpan' ? 'flex' : 'hidden'}`}>
                  <CloudPanExplorer onBack={handleBackToCourses} />
                </div>
              )}
            </div>
          </StagePane>
        )}
      </main>
      <WindowConfirmModal />
      <SetupWizardModal />
    </div>
  )
}
