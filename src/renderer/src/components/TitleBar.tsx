import { useAppStore, type Theme } from '../store/app'

function applyTheme(theme: Theme): void {
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme
  document.documentElement.setAttribute('data-theme', resolved)
  // 通知主进程更新标题栏按钮颜色
  window.api.setTheme(resolved).catch(() => undefined)
}

export { applyTheme }

export function TitleBar() {
  const theme = useAppStore(s => s.theme)
  const setTheme = useAppStore(s => s.setTheme)

  const themes: { key: Theme; icon: React.ReactNode; tip: string }[] = [
    {
      key: 'dark',
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ),
      tip: '深色主题'
    },
    {
      key: 'light',
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ),
      tip: '浅色主题'
    },
    {
      key: 'system',
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      ),
      tip: '跟随系统'
    }
  ]

  const activeIdx = themes.findIndex(t => t.key === theme)

  const onSelect = (key: Theme): void => {
    setTheme(key)
    applyTheme(key)
  }

  return (
    <div className="drag-region flex h-10 select-none items-center px-5 pr-[140px] text-sm text-text-2">
      <div className="flex items-center gap-2.5">
        <span className="relative inline-block h-2.5 w-2.5 rounded-full bg-accent">
          <span className="absolute inset-0 animate-breathe rounded-full bg-accent opacity-50 blur-sm" />
        </span>
        <span className="font-semibold tracking-wide text-text-1">SJTU 旁听下载器</span>
      </div>
      <div className="flex-1" />
      <div className="no-drag relative flex items-center rounded-lg border border-bd bg-surface-2 p-0.5">
        {/* 玻璃滑动指示器 */}
        <span
          className="absolute top-0.5 bottom-0.5 w-[calc(33.333%-2px)] rounded-md bg-surface-1 shadow-sm transition-all duration-300 ease-out"
          style={{ left: `calc(${activeIdx * 33.333}% + 1px)` }}
        />
        {themes.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => onSelect(t.key)}
            title={t.tip}
            className={`relative z-10 flex h-6 w-7 items-center justify-center rounded-md transition-colors duration-200 ${
              theme === t.key ? 'text-accent' : 'text-text-3 hover:text-text-1'
            }`}
          >
            {t.icon}
          </button>
        ))}
      </div>
    </div>
  )
}
