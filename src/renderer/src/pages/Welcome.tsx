import { useAppStore } from '../store/app'

export function Welcome() {
  const setStage = useAppStore(s => s.setStage)
  const auth = useAppStore(s => s.auth)

  const cta = auth.loggedIn ? '进入主页' : '使用 jAccount 登录'
  const onStart = (): void => setStage(auth.loggedIn ? 'browser' : 'login')

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-y-auto px-8 py-10">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-hero-radial opacity-80 blur-2xl" />
      <div className="w-full max-w-4xl">
        {/* ── Hero ── */}
        <header className="mb-10 text-center">
          <div className="mb-5 inline-flex items-center gap-2.5 rounded-full border border-bd bg-surface-3 px-4 py-1.5 text-sm tracking-wide text-text-2 backdrop-blur">
            <span className="relative inline-block h-2 w-2 rounded-full bg-accent">
              <span className="absolute inset-0 animate-breathe rounded-full bg-accent opacity-60 blur-sm" />
            </span>
            为 SJTU 同学打造 · 一次登录，三大来源
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-text-1 sm:text-4xl">
            SJTU 课程<span className="text-accent-light">下载</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-text-2">
            一站式下载
            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-sm text-text-1">v.sjtu.edu.cn</span> 旁听课程、
            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-sm text-text-1">oc.sjtu.edu.cn</span> Canvas 资料、
            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-sm text-text-1">cnmooc.sjtu.cn</span> 好大学在线，
            支持<span className="font-medium text-cloud-light">本地下载</span>与<span className="font-medium text-cloud-light">直传交大云盘</span>。
          </p>
        </header>

        {/* ── 三大课程来源 ── */}
        <div className="mb-4 flex items-center gap-3 px-1">
          <h2 className="text-sm font-semibold tracking-wide text-text-2">课程来源</h2>
          <div className="h-px flex-1 bg-bd" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <SourceCard
            icon={<IconPlay />}
            domain="v.sjtu.edu.cn"
            title="旁听课程视频"
            points={['教师 / PPT 双视角', '按上课时间智能排序', '一键批量下载整学期']}
            accent="accent"
          />
          <SourceCard
            icon={<IconBook />}
            domain="oc.sjtu.edu.cn"
            title="Canvas 课程资料"
            points={['课件 / 大纲 / 模块补漏', '课堂视频 + 单元视频', 'PPT 切片合并为 PDF']}
            accent="accent"
          />
          <SourceCard
            icon={<IconCap />}
            domain="cnmooc.sjtu.cn"
            title="好大学在线"
            points={['课程视频与课件', '按章节结构组织', '仅视频 / 仅课件筛选']}
            accent="cloud"
          />
        </div>

        {/* ── 核心能力 ── */}
        <div className="mb-4 mt-8 flex items-center gap-3 px-1">
          <h2 className="text-sm font-semibold tracking-wide text-text-2">核心能力</h2>
          <div className="h-px flex-1 bg-bd" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Capability icon={<IconDualMode />} title="本地 + 云盘双模式" desc="边下载边 4MB 分片直传，一份带宽双重备份" />
          <Capability icon={<IconResume />} title="断点续传" desc="中断后从断点继续，.part 临时文件自动续接" />
          <Capability icon={<IconGauge />} title="自动并发 AIMD" desc="2–16 路按吞吐与错误率自适应，无需手调" />
          <Capability icon={<IconFilm />} title="内置 ffmpeg" desc="HLS→MP4 无损转封装，可选重编码修复花屏" />
          <Capability icon={<IconPdf />} title="PPT 课件 PDF" desc="课堂视频 PPT 切片合并为单个 PDF，与视频同目录" />
          <Capability icon={<IconBell />} title="完成通知" desc="批次成功 / 失败数量汇总，点击聚焦主窗口" />
        </div>

        {/* ── 网络提示 ── */}
        <div className="mt-6 flex items-center justify-center gap-2 rounded-xl border border-warning-ring bg-warning-bg px-4 py-2.5 text-xs text-warning">
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>需要连接 <strong>SJTU 校园网</strong>或使用<strong>交大 VPN</strong> 才能正常使用</span>
        </div>

        {/* ── CTA ── */}
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

// ─────────────────────────────────────────────────────────────
// 课程来源卡片
// ─────────────────────────────────────────────────────────────

function SourceCard({
  icon,
  domain,
  title,
  points,
  accent = 'accent'
}: {
  icon: React.ReactNode
  domain: string
  title: string
  points: string[]
  accent?: 'accent' | 'cloud'
}) {
  const accentColors = accent === 'cloud'
    ? 'bg-cloud-dim text-cloud-light ring-cloud-25'
    : 'bg-accent-15 text-accent-light ring-accent-25'
  const dot = accent === 'cloud' ? 'text-cloud' : 'text-accent'

  return (
    <div className="animate-fadeIn group rounded-2xl border border-bd bg-surface-3 p-5 backdrop-blur transition-all duration-200 hover:border-bd-strong hover:shadow-card-hover">
      <div className="flex items-center gap-3">
        <div className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${accentColors} transition-transform duration-200 group-hover:scale-110`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-1">{title}</div>
          <div className="truncate font-mono text-2xs text-text-3">{domain}</div>
        </div>
      </div>
      <ul className="mt-4 space-y-1.5">
        {points.map(p => (
          <li key={p} className="flex items-start gap-2 text-xs leading-relaxed text-text-3">
            <span className={`mt-1 inline-block h-1 w-1 shrink-0 rounded-full ${dot}`} />
            {p}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 核心能力小块
// ─────────────────────────────────────────────────────────────

function Capability({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-bd bg-surface-3 p-3.5 backdrop-blur transition-colors duration-150 hover:border-bd-strong">
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-10 text-accent-light">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-text-1">{title}</div>
        <div className="mt-0.5 text-2xs leading-relaxed text-text-3">{desc}</div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 图标
// ─────────────────────────────────────────────────────────────

function IconPlay() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
    </svg>
  )
}
function IconBook() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
    </svg>
  )
}
function IconCap() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 10L12 5 2 10l10 5 10-5z" />
      <path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5" />
      <path d="M22 10v6" />
    </svg>
  )
}
function IconDualMode() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h12a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
      <path d="M3 8l3-4h8l3 4" />
      <path d="M18 11h2a2 2 0 012 2v2" />
    </svg>
  )
}
function IconResume() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 11-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  )
}
function IconGauge() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 14l4-4" />
      <path d="M3.5 18a9 9 0 1117 0" />
      <circle cx="12" cy="14" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}
function IconFilm() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </svg>
  )
}
function IconPdf() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v5h5" />
      <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M8 13h2a1.5 1.5 0 010 3H8v-3zM8 16v2" />
    </svg>
  )
}
function IconBell() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 01-3.4 0" />
    </svg>
  )
}
