import { useCallback, useEffect } from 'react'
import { useAppStore, type Stage } from './store/app'
import { TitleBar, applyTheme } from './components/TitleBar'
import { WindowConfirmModal } from './components/WindowConfirmModal'
import { Segmented, type SegmentedOption } from './components/Segmented'
import { Welcome } from './pages/Welcome'
import { Login } from './pages/Login'
import { Browser } from './pages/Browser'
import { CanvasBrowser } from './pages/CanvasBrowser'
import { useDownloadProgressSubscription } from './hooks/useSharedBrowserHooks'
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

  // [2.15] Subscribe to download progress once at App level (not per-page)
  useDownloadProgressSubscription()

  const handleLogout = useCallback(async () => {
    try {
      await window.api.auth.logout()
      setAuth({ loggedIn: false })
      resetScanResults()
      setStage('welcome')
    } catch { /* ignore */ }
  }, [setAuth, setStage, resetScanResults])

  // 初始化主题 + 监听系统主题变化
  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (): void => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  useEffect(() => {
    // 启动时检查登录态：已登录直接进 browser，否则停留 welcome
    // BUG FIX: add cancelled guard so state updates don't fire after unmount
    // (e.g. during React strict-mode double-mount or fast navigation).
    let cancelled = false
    void (async () => {
      try {
        const a = await window.api.auth.status()
        if (cancelled) return
        setAuth(a)
        if (a.loggedIn) setStage('browser')
      } catch {
        /* ignore */
      }
    })()
    return () => { cancelled = true }
  }, [setAuth, setStage])

  return (
    <div className="flex h-full w-full flex-col">
      <TitleBar onLogout={() => void handleLogout()} />
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
            <BrowserTabBar activeTab={activeTab} onChange={setActiveTab} />
            <div key={activeTab} className="animate-fadeIn flex-1 overflow-hidden">
              {activeTab === 'audited' && <Browser />}
              {activeTab === 'canvas' && <CanvasBrowser />}
            </div>
          </StagePane>
        )}
      </main>
      {/* Mac 风格窗口关闭/最小化确认弹窗（单例，监听 Alt+F4 与交通灯按钮） */}
      <WindowConfirmModal />
    </div>
  )
}

// ─── Tab 导航栏（使用共享 Segmented 组件，玻璃滑动风格） ───

function BrowserTabBar({
  activeTab,
  onChange
}: {
  activeTab: ActiveTab
  onChange: (t: ActiveTab) => void
}) {
  const tabOptions: SegmentedOption<ActiveTab>[] = [
    {
      key: 'audited',
      label: 'v.sjtu 旁听课程',
      title: '旁听课程视频',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
          <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
        </svg>
      )
    },
    {
      key: 'canvas',
      label: 'Canvas 课程',
      title: 'Canvas 课程资料',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8" />
          <path d="M12 17v4" />
        </svg>
      )
    }
  ]
  return (
    <div className="no-drag flex items-center border-b border-bd bg-surface-3 px-6 py-2">
      <Segmented options={tabOptions} value={activeTab} onChange={onChange} size="lg" />
    </div>
  )
}
