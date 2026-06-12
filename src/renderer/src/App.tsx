import { useEffect } from 'react'
import { useAppStore } from './store/app'
import { TitleBar, applyTheme } from './components/TitleBar'
import { Welcome } from './pages/Welcome'
import { Login } from './pages/Login'
import { Browser } from './pages/Browser'

export default function App() {
  const stage = useAppStore(s => s.stage)
  const theme = useAppStore(s => s.theme)
  const setStage = useAppStore(s => s.setStage)
  const setAuth = useAppStore(s => s.setAuth)

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
    void (async () => {
      try {
        const a = await window.api.auth.status()
        setAuth(a)
        if (a.loggedIn) setStage('browser')
      } catch {
        /* ignore */
      }
    })()
  }, [setAuth, setStage])

  return (
    <div className="flex h-full w-full flex-col">
      <TitleBar />
      <main className="relative flex-1 overflow-hidden">
        {stage === 'welcome' && <Welcome />}
        {stage === 'login' && <Login />}
        {stage === 'browser' && <Browser />}
      </main>
    </div>
  )
}
