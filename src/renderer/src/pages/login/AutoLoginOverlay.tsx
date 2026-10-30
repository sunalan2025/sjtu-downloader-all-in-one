import { Spinner } from '../../components/Spinner'

export interface AutoLoginOverlayProps {
  autoLoginStep: 1 | 2 | 3 | 4
  activeAccountUser?: string
  onCancel: () => void
}

export function AutoLoginOverlay({
  autoLoginStep,
  activeAccountUser,
  onCancel
}: AutoLoginOverlayProps) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-between bg-surface-1 p-6 text-center select-none transition-all duration-300">
      {/* 顶部标题与账号徽章 */}
      <div className="flex flex-col items-center gap-2 pt-2">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
          </span>
          <h2 className="text-base font-semibold text-text-1">正在自动登录交大 jAccount</h2>
        </div>
        {activeAccountUser && (
          <div className="inline-flex items-center gap-1.5 rounded-full border border-bd bg-surface-2 px-3 py-1 text-xs text-text-2">
            <span className="text-text-3">账号:</span>
            <span className="font-mono font-medium text-text-1">{activeAccountUser}</span>
          </div>
        )}
      </div>

      {/* 中间拟人化 3 步执行进度卡片 */}
      <div className="w-full max-w-sm space-y-3 rounded-xl border border-bd bg-surface-2/60 p-4 text-left shadow-xs backdrop-blur-xs">
        {/* 步骤 1: 凭据自动填入 */}
        <div className="flex items-center gap-3">
          <div
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-200 ${
              autoLoginStep > 1
                ? 'bg-emerald-500/15 text-emerald-500'
                : autoLoginStep === 1
                ? 'bg-accent/15 text-accent'
                : 'bg-surface-3 text-text-4'
            }`}
          >
            {autoLoginStep > 1 ? '✓' : '1'}
          </div>
          <div className="flex-1 min-w-0">
            <div
              className={`text-xs font-medium transition-colors ${
                autoLoginStep >= 1 ? 'text-text-1' : 'text-text-3'
              }`}
            >
              填入已保存凭据
            </div>
            <div className="text-3xs text-text-3">
              {autoLoginStep > 1
                ? '账号与密码已填入'
                : autoLoginStep === 1
                ? '正在自然节奏填入账号密码…'
                : '等待填入'}
            </div>
          </div>
          {autoLoginStep === 1 && <Spinner size={14} className="text-accent shrink-0" />}
        </div>

        {/* 步骤 2: 验证码智能识别 */}
        <div className="flex items-center gap-3">
          <div
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-200 ${
              autoLoginStep > 2
                ? 'bg-emerald-500/15 text-emerald-500'
                : autoLoginStep === 2
                ? 'bg-accent/15 text-accent'
                : 'bg-surface-3 text-text-4'
            }`}
          >
            {autoLoginStep > 2 ? '✓' : '2'}
          </div>
          <div className="flex-1 min-w-0">
            <div
              className={`text-xs font-medium transition-colors ${
                autoLoginStep >= 2 ? 'text-text-1' : 'text-text-3'
              }`}
            >
              智能识别验证码
            </div>
            <div className="text-3xs text-text-3">
              {autoLoginStep > 2
                ? '验证码已识别并填充'
                : autoLoginStep === 2
                ? '正在通过交大极客验证码接口识别…'
                : '检测是否需要验证码'}
            </div>
          </div>
          {autoLoginStep === 2 && <Spinner size={14} className="text-accent shrink-0" />}
        </div>

        {/* 步骤 3: 提交认证 */}
        <div className="flex items-center gap-3">
          <div
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-200 ${
              autoLoginStep >= 3
                ? 'bg-accent/15 text-accent'
                : 'bg-surface-3 text-text-4'
            }`}
          >
            3
          </div>
          <div className="flex-1 min-w-0">
            <div
              className={`text-xs font-medium transition-colors ${
                autoLoginStep >= 3 ? 'text-text-1' : 'text-text-3'
              }`}
            >
              提交登录验证
            </div>
            <div className="text-3xs text-text-3">
              {autoLoginStep >= 3 ? '正在提交并等待跳转…' : '待前置步骤完成后自动提交'}
            </div>
          </div>
          {autoLoginStep >= 3 && <Spinner size={14} className="text-accent shrink-0" />}
        </div>

        {/* 动画进度条 */}
        <div className="relative mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{
              width:
                autoLoginStep === 1
                  ? '35%'
                  : autoLoginStep === 2
                  ? '70%'
                  : '95%'
            }}
          />
        </div>
      </div>

      {/* 底部取消按钮与说明 */}
      <div className="flex flex-col items-center gap-2 pb-2">
        <button
          type="button"
          onClick={onCancel}
          className="no-drag inline-flex items-center gap-1.5 rounded-xl border border-bd bg-surface-2 px-4 py-2 text-xs font-medium text-text-2 shadow-xs transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-500 active:scale-95"
        >
          <span>✕</span>
          <span>取消自动登录并重新输入</span>
        </button>
        <p className="text-3xs text-text-3">
          如需更换账号或使用「交我办」扫码登录，请随时点击取消
        </p>
      </div>
    </div>
  )
}

export function LoginSuccessOverlay() {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-surface-1/95 backdrop-blur-md transition-opacity duration-300">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-500 shadow-sm">
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div className="text-base font-semibold text-text-1">登录成功</div>
      <div className="text-xs text-text-3">正在安全接入学在交大与旁听课程系统…</div>
    </div>
  )
}
