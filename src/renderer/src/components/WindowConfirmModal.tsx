import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/app'

/** 窗口动作：minimize=最小化按钮，close=关闭按钮（或 Alt+F4） */
type WindowAction = 'minimize' | 'close'
/** 用户选择：minimize=最小化到托盘，taskbar=最小化到任务栏，quit=退出应用，cancel=取消（保持窗口） */
type WindowChoice = 'minimize' | 'taskbar' | 'quit' | 'cancel'

// ─── 模块级单例：让 CaptionButtons / close-requested 都能触发同一个弹窗 ───
//
// 弹窗 state 提到模块级，组件 mount 时注册 setOpen，卸载时清空。
// requestWindowAction(action) 返回 Promise，组件内 resolve 它。
let openFn: ((action: WindowAction) => Promise<WindowChoice>) | null = null

/** 根据任务运行状态与用户偏好解析待执行的窗口动作：
 *  - 最小化动作：始终返回 'minimize'（不受正在下载策略拦截）；
 *  - 关闭动作且无进行中任务：按 windowCloseAction 映射（tray → 'minimize', taskbar → 'taskbar', quit → 'quit'）；
 *  - 关闭动作且有进行中任务：按 exitWhenDownloading 映射（background → 'minimize', pause_quit → 'quit', prompt → 弹窗询问）。 */
export async function resolveWindowAction(action: WindowAction): Promise<WindowChoice> {
  // 最小化按钮操作始终执行标准最小化到任务栏，不受正在下载关闭策略拦截
  if (action === 'minimize') return 'taskbar'

  const { ongoing } = await window.api.window.hasOngoingTasks()
  const { windowCloseAction, exitWhenDownloading } = useAppStore.getState()

  if (!ongoing) {
    if (windowCloseAction === 'taskbar') return 'taskbar'
    if (windowCloseAction === 'quit') return 'quit'
    return 'minimize'
  }

  // 有进行中任务且关闭窗口时：受 exitWhenDownloading 策略控制
  if (exitWhenDownloading === 'background') {
    return windowCloseAction === 'taskbar' ? 'taskbar' : 'minimize'
  }
  if (exitWhenDownloading === 'pause_quit') return 'quit'

  if (!openFn) return 'cancel' // 弹窗未就绪，安全回退
  return openFn(action)
}

/** 执行窗口动作：查询状态与用户策略偏好 → 分流执行对应 IPC。
 *  CaptionButtons 和 close-requested 监听共用此函数。 */
export async function handleWindowAction(action: WindowAction): Promise<void> {
  const choice = await resolveWindowAction(action)
  if (choice === 'minimize') {
    await window.api.window.minimize()
  } else if (choice === 'taskbar') {
    await window.api.window.minimizeToTaskbar()
  } else if (choice === 'quit') {
    await window.api.window.cancelAndQuit()
  }
  // cancel → 什么都不做
}

/** Mac 风格确认弹窗。挂载在 App 顶层（单例），监听 close-requested 事件。
 *  弹窗由模块级 openFn 触发，用户点击按钮后 resolve 对应 Promise。 */
export function WindowConfirmModal() {
  const windowCloseAction = useAppStore(s => s.windowCloseAction)
  const [state, setState] = useState<{ action: WindowAction; resolve: (c: WindowChoice) => void } | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    // 注册模块级触发器：返回 Promise，组件内 setState + 保存 resolve
    openFn = (action: WindowAction): Promise<WindowChoice> =>
      new Promise<WindowChoice>(resolve => {
        // 若已有弹窗打开，先 resolve 旧Promise 为 cancel 再开新的（防重复）
        if (stateRef.current) stateRef.current.resolve('cancel')
        setState({ action, resolve })
      })
    return () => { openFn = null }
  }, [])

  // 监听 Alt+F4 / 任务栏关闭 → 触发 close 弹窗
  useEffect(() => {
    return window.api.window.onCloseRequested(() => { void handleWindowAction('close') })
  }, [])

  const close = useCallback((c: WindowChoice) => {
    setState(prev => {
      prev?.resolve(c)
      return null
    })
  }, [])

  // Esc 取消
  useEffect(() => {
    if (!state) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close('cancel')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, close])

  if (!state) return null

  const isClose = state.action === 'close'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      {/* 毛玻璃遮罩 */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-fadeIn"
        onClick={() => close('cancel')}
      />
      {/* Mac 风格弹窗卡片 */}
      <div className="relative w-[360px] animate-fadeIn rounded-2xl border border-white/10 bg-surface-1 p-5 shadow-2xl">
        <div className="flex flex-col items-center gap-3 text-center">
          {/* 标题图标 */}
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-full ${
              isClose ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning'
            }`}
          >
            {isClose ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            )}
          </div>
          <div>
            <div className="text-base font-semibold text-text-1">
              {isClose ? '关闭应用？' : '最小化窗口？'}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-text-3">
              应用有正在进行的下载/上传任务。
              <br />
              {windowCloseAction === 'taskbar'
                ? '最小化到任务栏可让任务在后台继续，取消下载并退出将中止全部任务。'
                : '最小化到托盘可让任务在后台继续，取消下载并退出将中止全部任务。'}
            </p>
          </div>
        </div>

        {/* 按钮区：Mac 风格 — 主按钮填充，次按钮描边 */}
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            autoFocus
            onClick={() => close(windowCloseAction === 'taskbar' ? 'taskbar' : 'minimize')}
            className="h-9 rounded-lg bg-accent text-sm font-medium text-white transition-all hover:brightness-110 active:scale-[0.98]"
          >
            {windowCloseAction === 'taskbar' ? '最小化到任务栏' : '最小化到托盘'}
          </button>
          <button
            type="button"
            onClick={() => close('quit')}
            className="h-9 rounded-lg bg-danger text-sm font-medium text-white transition-all hover:brightness-110 active:scale-[0.98]"
          >
            取消下载并退出
          </button>
          <button
            type="button"
            onClick={() => close('cancel')}
            className="h-9 rounded-lg border border-bd bg-transparent text-sm font-medium text-text-2 transition-all hover:bg-surface-3 active:scale-[0.98]"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
