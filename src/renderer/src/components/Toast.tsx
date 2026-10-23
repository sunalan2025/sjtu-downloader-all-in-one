import { memo } from 'react'
import type { ToastState } from '../hooks/useToast'

export interface ToastProps {
  toast: ToastState | null
  className?: string
  position?: 'bottom-center' | 'bottom-wide'
  onClose?: () => void
}

/**
 * 共享 Toast 提示浮条组件
 * 支持标准居中悬浮与宽栏贴底两种布局
 */
export const Toast = memo(function Toast({
  toast,
  className = '',
  position = 'bottom-center',
  onClose
}: ToastProps) {
  if (!toast) return null

  const isWide = position === 'bottom-wide'
  const icon = toast.type === 'success' ? '✅' : toast.type === 'error' ? '⚠️' : 'ℹ️'

  const colorStyles: Record<string, string> = {
    success: 'bg-surface-3/95 text-text-1 ring-1 ring-bd shadow-lg',
    error: 'bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 shadow-xl',
    info: 'bg-surface-3/95 text-text-1 ring-1 ring-bd shadow-lg'
  }

  const basePos = isWide
    ? 'absolute bottom-16 left-4 right-4 z-[70] flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium backdrop-blur animate-fadeIn'
    : 'absolute bottom-6 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium backdrop-blur animate-fadeIn select-none'

  return (
    <div
      role="status"
      data-testid="toast-notification"
      onClick={onClose}
      className={`${basePos} ${colorStyles[toast.type] || colorStyles.info} ${className}`}
    >
      <span>{icon}</span>
      <span className="truncate max-w-sm">{toast.text}</span>
    </div>
  )
})
