import { useEffect, type RefObject } from 'react'

export interface UseClickOutsideOptions {
  enabled?: boolean
  ignoreRefs?: Array<RefObject<HTMLElement | null>>
  onEscape?: () => void
  eventType?: 'mousedown' | 'pointerdown'
}

/**
 * 判定目标 target 是否处于 ref 元素及 ignoreRefs 之外
 */
export function isClickOutside(
  target: Node | null,
  ref: RefObject<HTMLElement | null>,
  ignoreRefs?: Array<RefObject<HTMLElement | null>>
): boolean {
  if (!target || !ref.current) return false
  if (ref.current.contains(target)) return false
  if (ignoreRefs && ignoreRefs.some(r => r.current?.contains(target))) {
    return false
  }
  return true
}

/**
 * 核心事件绑定与清理逻辑
 * 注册 mousedown/pointerdown 与 Escape 按键监听，返回 cleanup 卸载函数
 */
export function registerClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClickOutside: () => void,
  options?: UseClickOutsideOptions
): () => void {
  const enabled = options?.enabled ?? true
  if (!enabled || typeof document === 'undefined') return () => {}

  const ignoreRefs = options?.ignoreRefs
  const onEscape = options?.onEscape
  const eventType = options?.eventType ?? 'mousedown'

  const handleClickOutside = (e: MouseEvent | PointerEvent): void => {
    const target = e.target as Node | null
    if (isClickOutside(target, ref, ignoreRefs)) {
      onClickOutside()
    }
  }

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      if (onEscape) {
        onEscape()
      } else {
        onClickOutside()
      }
    }
  }

  document.addEventListener(eventType, handleClickOutside as EventListener)
  document.addEventListener('keydown', handleKeyDown)
  return () => {
    document.removeEventListener(eventType, handleClickOutside as EventListener)
    document.removeEventListener('keydown', handleKeyDown)
  }
}

/**
 * 监听目标 DOM 元素外部的点击动作与按键 (Escape)，触发关闭回调。
 * 支持传入 ignoreRefs（例如点击打开开关自身不重复判定为外部点击）。
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClickOutside: () => void,
  options?: UseClickOutsideOptions
): void {
  const enabled = options?.enabled ?? true
  const ignoreRefs = options?.ignoreRefs
  const onEscape = options?.onEscape
  const eventType = options?.eventType ?? 'mousedown'

  useEffect(() => {
    return registerClickOutside(ref, onClickOutside, {
      enabled,
      ignoreRefs,
      onEscape,
      eventType
    })
  }, [enabled, ref, onClickOutside, ignoreRefs, onEscape, eventType])
}
