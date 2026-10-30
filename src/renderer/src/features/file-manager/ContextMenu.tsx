import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface MenuAction {
  id: string
  label: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  divider?: boolean
  run: () => void
}
export interface MenuPoint {
  x: number
  y: number
}
export interface SelectionMenuRequest extends MenuPoint {
  id: string | null
  selectedIds: string[]
}

/** One menu implementation for all views; actions remain owned by each platform. */
export function ContextMenu({ point, actions, onClose }: { point: MenuPoint; actions: MenuAction[]; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  const returnFocus = useRef(document.activeElement as HTMLElement | null)
  const [position, setPosition] = useState(point)
  const close = useRef(onClose)
  close.current = onClose
  useLayoutEffect(() => {
    const bounds = root.current?.getBoundingClientRect()
    if (!bounds) return
    setPosition({
      x: Math.max(8, Math.min(point.x, window.innerWidth - bounds.width - 8)),
      y: Math.max(8, Math.min(point.y, window.innerHeight - bounds.height - 8))
    })
    root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [point])
  useEffect(() => {
    const node = root.current
    const previous = returnFocus.current
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) close.current()
    }
    const dismiss = () => close.current()
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('scroll', outside, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('scroll', outside, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
      if (node?.contains(document.activeElement) || document.activeElement === document.body) previous?.focus({ preventScroll: true })
    }
  }, [])
  return createPortal(
    <div
      ref={root}
      role="menu"
      aria-label="文件操作"
      tabIndex={-1}
      className="file-context-menu"
      style={{ left: position.x, top: position.y }}
      onContextMenu={event => event.preventDefault()}
      onKeyDown={event => {
        event.stopPropagation()
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault()
          onClose()
          return
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next]?.focus()
      }}
    >
      {actions.map(action => (
        <div key={action.id}>
          {action.divider && <div role="separator" className="my-1 border-t border-bd" />}
          <button
            role="menuitem"
            type="button"
            disabled={action.disabled}
            className={`file-context-action ${action.danger ? 'text-danger' : 'text-text-1'}`}
            onClick={() => {
              onClose()
              action.run()
            }}
          >
            <span>{action.label}</span>
            <span className="ml-5 text-2xs text-text-3">{action.shortcut}</span>
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}
