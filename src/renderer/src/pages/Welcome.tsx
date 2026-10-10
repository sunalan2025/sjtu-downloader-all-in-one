import { useAppStore } from '../store/app'

export function Welcome() {
  const setStage = useAppStore(s => s.setStage)
  const auth = useAppStore(s => s.auth)

  const ctaText = auth.expired
    ? '重新登录 (jAccount)'
    : (auth.loggedIn ? '进入主页' : '使用 jAccount 登录')

  const onStart = (): void => setStage(auth.loggedIn ? 'browser' : 'login')

  return (
    <div className="relative flex h-full w-full items-center justify-center p-6 select-none overflow-hidden">
      {/* 柔和环境光晕背景 */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-hero-radial opacity-70 blur-3xl" />

      {/* 悬浮毛玻璃居中卡片 */}
      <div className="animate-fadeIn relative w-full max-w-[480px] rounded-3xl border border-bd bg-surface-1/85 p-8 sm:p-10 shadow-card backdrop-blur-xl flex flex-col items-center text-center">
        {/* 顶部精致应用 Logo */}
        <div className="relative mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-accent-15 via-accent-10 to-cloud-10 text-accent ring-1 ring-accent-25 shadow-sm">
          <span className="absolute -inset-1 rounded-2xl bg-accent opacity-20 blur-md" />
          <svg className="relative h-8 w-8 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
            <path d="M6 6h10" />
            <path d="M6 10h10" />
            <path d="m9 16 3 3 3-3" />
            <path d="M12 13v6" />
          </svg>
        </div>

        {/* 标题与定位 */}
        <h1 className="text-2xl font-bold tracking-tight text-text-1 sm:text-3xl">
          SJTU 课程<span className="text-accent">下载</span>
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-text-3">
          一站式转存与同步 · 本地与交大云盘双模式
        </p>

        {/* 三大来源轻量胶囊徽标 */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-bd bg-surface-2 px-3 py-1 text-xs font-medium text-text-2">
            <svg className="h-3.5 w-3.5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
            Canvas 课程
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-bd bg-surface-2 px-3 py-1 text-xs font-medium text-text-2">
            <svg className="h-3.5 w-3.5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="3" />
              <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
            </svg>
            课堂实录 (v.sjtu)
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-bd bg-surface-2 px-3 py-1 text-xs font-medium text-text-2">
            <svg className="h-3.5 w-3.5 text-cloud" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 10L12 5 2 10l10 5 10-5z" />
              <path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5" />
            </svg>
            好大学在线
          </span>
        </div>

        {/* 会话过期轻量提示（仅在已过期时显现） */}
        {auth.expired && (
          <div className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-warning-ring bg-warning-bg px-3.5 py-2.5 text-xs text-warning">
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>登录凭证已过期，请重新登录认证</span>
          </div>
        )}

        {/* 主操作 CTA 按钮 */}
        <button
          type="button"
          onClick={onStart}
          className="no-drag mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 text-sm font-semibold text-white shadow-glow transition-all duration-200 hover:scale-[1.01] hover:bg-accent-light hover:shadow-[0_12px_40px_-10px,var(--accent-50)] active:scale-[0.99] cursor-pointer"
        >
          <span>{ctaText}</span>
          <svg className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </button>

        {/* 底部环境提示与声明 */}
        <div className="mt-5 flex items-center justify-center gap-1.5 text-2xs text-text-3">
          <svg className="h-3.5 w-3.5 text-warning shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>需连接 <strong>SJTU 校园网</strong> 或使用 <strong>交大 VPN</strong></span>
        </div>
      </div>
    </div>
  )
}
