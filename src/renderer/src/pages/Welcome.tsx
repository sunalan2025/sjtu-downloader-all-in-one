import { useAppStore } from '../store/app'

export function Welcome() {
  const setStage = useAppStore(s => s.setStage)
  const auth = useAppStore(s => s.auth)

  const cta = auth.loggedIn ? '进入主页' : '使用 jAccount 登录'
  const onStart = (): void => setStage(auth.loggedIn ? 'browser' : 'login')

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-y-auto px-8 py-12">
      <div className="w-full max-w-3xl">
        <header className="mb-12 text-center">
          <div className="mb-5 inline-flex items-center gap-2.5 rounded-full border border-bd bg-surface-3 px-4 py-1.5 text-sm tracking-wide text-text-2 backdrop-blur">
            <span className="relative inline-block h-2 w-2 rounded-full bg-accent">
              <span className="absolute inset-0 animate-breathe rounded-full bg-accent opacity-60 blur-sm" />
            </span>
            为 SJTU 同学打造
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-text-1 sm:text-4xl">
            SJTU 旁听课程<span className="text-accent-light">转存</span>
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-text-2">
            一键扫描你在 <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-sm text-text-1">v.sjtu.edu.cn</span> 的「我的旁听」课程，
            批量转存回放视频到 <span className="font-medium text-cloud-light">交大云盘</span>，不占本地空间。
          </p>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FeatureCard
            icon={<IconShield />}
            title="jAccount 安全登录"
            desc="嵌入官方扫码登录，session 持久化保存在本地"
            accent="accent"
          />
          <FeatureCard
            icon={<IconList />}
            title="一键扫描旁听课"
            desc="自动抓取你有权访问的全部课程，按学期归类"
            accent="accent"
          />
          <FeatureCard
            icon={<IconCloud />}
            title="直传交大云盘"
            desc="边下载边上传，4MB 分片直传 COS，自动建课程文件夹"
            accent="cloud"
          />
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 rounded-xl border border-amber/20 bg-amber/5 px-4 py-2.5 text-xs text-amber">
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>需要连接 <strong>SJTU 校园网</strong>或使用<strong>交大 VPN</strong> 才能正常使用</span>
        </div>

        <div className="mt-6 flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={onStart}
            className="no-drag inline-flex h-12 items-center gap-2.5 rounded-xl bg-accent px-8 text-base font-semibold text-white shadow-glow transition-all duration-200 hover:scale-[1.02] hover:bg-accent-light hover:shadow-[0_14px_50px_-10px,var(--accent-50)] active:scale-[0.98]"
          >
            {cta}
            <span className="text-lg leading-none">→</span>
          </button>
          <p className="max-w-sm text-center text-xs leading-relaxed text-text-4">
            本工具仅供转存你<strong className="text-text-3">本人有权访问</strong>的课程，
            请勿传播、转售下载内容；版权归课程权利方所有。
          </p>
        </div>
      </div>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  desc,
  accent = 'accent'
}: {
  icon: React.ReactNode
  title: string
  desc: string
  accent?: 'accent' | 'cloud'
}) {
  const accentColors = accent === 'cloud'
    ? 'bg-cloud-dim text-cloud-light ring-cloud-25'
    : 'bg-accent-15 text-accent-light ring-accent-25'

  return (
    <div className="animate-fadeIn group rounded-2xl border border-bd bg-surface-3 p-5 backdrop-blur transition-all duration-200 hover:border-bd-strong hover:shadow-card-hover">
      <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${accentColors} transition-transform duration-200 group-hover:scale-110`}>
        {icon}
      </div>
      <div className="text-sm font-semibold text-text-1">{title}</div>
      <div className="mt-1.5 text-xs leading-relaxed text-text-3">{desc}</div>
    </div>
  )
}

function IconShield() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconList() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 6h12M8 12h12M8 18h12" strokeLinecap="round" />
      <circle cx="4" cy="6" r="1.2" fill="currentColor" />
      <circle cx="4" cy="12" r="1.2" fill="currentColor" />
      <circle cx="4" cy="18" r="1.2" fill="currentColor" />
    </svg>
  )
}
function IconCloud() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
      <path d="M12 13v5m-3-3l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
