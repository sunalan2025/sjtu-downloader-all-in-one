import appLogo from '../assets/logo.png'
import { useAppStore } from '../store/app'
import type { ActiveTab } from '@shared/types'
import pkg from '../../../../package.json'

export function Welcome() {
  const setStage = useAppStore(s => s.setStage)
  const setActiveTab = useAppStore(s => s.setActiveTab)
  const auth = useAppStore(s => s.auth)
  const appVersion = window.api?.version || pkg.version

  const ctaText = auth.expired
    ? '重新登录'
    : (auth.loggedIn ? '进入主页' : '使用 jAccount 登录')

  const onStart = (targetTab?: ActiveTab): void => {
    if (targetTab) {
      setActiveTab(targetTab)
    } else {
      const currentTab = useAppStore.getState().activeTab
      if (currentTab === 'settings' || currentTab === 'transfer') {
        setActiveTab(useAppStore.getState().lastCourseTab || 'canvas')
      }
    }
    setStage(auth.loggedIn ? 'browser' : 'login')
  }

  const serviceItems: Array<{
    id: string
    targetTab: ActiveTab
    title: string
    desc: string
    icon: React.ReactNode
  }> = [
    {
      id: 'canvas',
      targetTab: 'canvas',
      title: 'Canvas 教学平台',
      desc: '课程课件资料、大纲附件、课堂视频与讲义 PDF',
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
          <path d="M6 6h10" />
          <path d="M6 10h10" />
        </svg>
      )
    },
    {
      id: 'lecture',
      targetTab: 'audited',
      title: '旁听课程',
      desc: '旁听课程回放、教师与 PPT 双视角高清视频流',
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="3" />
          <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
        </svg>
      )
    },
    {
      id: 'cnmooc',
      targetTab: 'cnmooc',
      title: '好大学在线',
      desc: '在线慕课课程、章节视频与配套课件文档一键同步',
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 10L12 5 2 10l10 5 10-5z" />
          <path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5" />
          <path d="M22 10v6" />
        </svg>
      )
    },
    {
      id: 'cloudpan',
      targetTab: 'transfer',
      title: '交大云盘备份',
      desc: '单点登录高速分片直传，一份带宽本地与云端双备份',
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        </svg>
      )
    }
  ]

  return (
    <div className="flex h-full w-full select-none overflow-hidden bg-surface-1 flex-col md:flex-row">
      {/* ── 左栏：品牌与登录行动区（自适应黄金分割） ── */}
      <aside className="relative flex w-full md:w-[350px] lg:w-[380px] xl:w-[410px] shrink-0 flex-col justify-between border-b md:border-b-0 md:border-r border-bd bg-surface-2/60 p-6 sm:p-8 lg:p-10 backdrop-blur-sm overflow-y-auto min-h-0">
        {/* 顶部：品牌 Logo 与定位 */}
        <div>
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface-1 shadow-sm ring-1 ring-bd overflow-hidden p-1">
              <img src={appLogo} alt="SJTU Logo" className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-bold tracking-tight text-text-1">SJTU 课程下载</h1>
                <span className="shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-2xs font-medium text-text-3">v{appVersion}</span>
              </div>
              <p className="truncate text-xs text-text-3">交大课程一站式转存与同步工具</p>
            </div>
          </div>

          <div className="mt-6 md:mt-8 text-xs leading-relaxed text-text-3">
            基于统一身份认证授权，支持批量获取课程讲义、双视角旁听课程与慕课视频，提供本地下载与交大云盘双模式。
          </div>
        </div>

        {/* 中部：登录主操作 */}
        <div className="my-5 md:my-6">
          {auth.expired && (
            <div className="mb-3.5 flex items-center gap-2 rounded-xl border border-warning-ring bg-warning-bg px-3.5 py-2 text-xs text-warning">
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>登录凭证已失效，请重新认证</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => onStart()}
            className="no-drag group flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-accent-light hover:shadow-md active:scale-[0.99] cursor-pointer"
          >
            <span>{ctaText}</span>
            <svg className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* 底部：环境与安全状态 */}
        <div className="space-y-1.5 md:space-y-2 border-t border-bd pt-4 text-2xs text-text-3">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 shrink-0 rounded-full bg-success" />
            <span>需连接 <strong>SJTU 校园网</strong> 或使用 <strong>交大 VPN</strong></span>
          </div>
          <div className="text-text-4">
            仅供个人学习课程转存 · 严禁公开转售与商业传播
          </div>
        </div>
      </aside>

      {/* ── 右栏：原生服务列表与功能索引（严格水平与垂直居中，自适应光影） ── */}
      <main className="relative flex flex-1 flex-col items-center justify-center p-6 sm:p-10 lg:p-12 xl:p-16 overflow-y-auto min-h-0">
        {/* 随视口动态延展的深层环境光影，消除大屏空旷感 */}
        <div className="pointer-events-none absolute inset-0 -z-10 bg-hero-radial opacity-60 blur-3xl transition-opacity duration-300" />

        {/* 居中内容容器：最大宽度 500px，在任何窗口尺寸下绝对水平居中 */}
        <div className="w-full max-w-[500px] my-auto">
          <div className="mb-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-3">支持的课程平台与服务</h2>
          </div>

          <div className="space-y-1.5">
            {serviceItems.map(item => (
              <div
                key={item.id}
                onClick={() => onStart(item.targetTab)}
                className="group flex items-start gap-4 rounded-xl p-3.5 transition-all duration-150 hover:bg-surface-2 hover:shadow-sm cursor-pointer"
              >
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-text-2 transition-colors duration-150 group-hover:bg-accent-10 group-hover:text-accent">
                  {item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-1 transition-colors duration-150 group-hover:text-accent">
                      {item.title}
                    </span>
                    <span className="text-text-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100 text-xs">
                      →
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-text-3 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-7 md:mt-8 border-t border-bd pt-4 text-xs text-text-4">
            登录后可在顶栏随时切换课程来源、查看传输中心或在「⚙️ 设置」中配置存储与并发。
          </div>
        </div>
      </main>
    </div>
  )
}
