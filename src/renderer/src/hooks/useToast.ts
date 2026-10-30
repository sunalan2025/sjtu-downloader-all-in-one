import { useState, useRef, useCallback, useEffect } from 'react'

export type ToastType = 'success' | 'info' | 'error'

export interface ToastState {
  text: string
  type: ToastType
}

/**
 * 跨页面共享的轻量 Toast hook
 * 具备自动销毁、防重入定时器清理机制
 */
export function useToast(defaultDuration = 2500) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback(
    (text: string, type: ToastType = 'success', duration = defaultDuration) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      setToast({ text, type })
      timerRef.current = setTimeout(() => {
        setToast(null)
      }, duration)
    },
    [defaultDuration]
  )

  const hideToast = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast(null)
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return { toast, showToast, hideToast }
}
