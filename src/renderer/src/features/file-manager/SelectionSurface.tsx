import { useEffect, useRef, useState, type ReactNode, type MouseEvent, type PointerEvent } from 'react'
import { changedSelection, intersects, selectItem, type SelectionRect } from './selection'
import type { SelectionMenuRequest } from './ContextMenu'

export interface SelectableItem {
  id: string
  selected: boolean
  disabled?: boolean
  directory?: boolean
}

const controls = 'button,input,textarea,select,a,[role="checkbox"],[contenteditable="true"],[data-selection-ignore]'

/** Shared file-manager gestures. Selection and opening are separate operations. */
export function SelectionSurface({
  items,
  onSelectionChange,
  onOpen,
  onActivate,
  onContextMenu,
  column = false,
  toggleOnClick = false,
  children,
  className = '',
  label
}: {
  items: SelectableItem[]
  onSelectionChange: (next: Set<string>, changed: string[]) => void
  onOpen?: (id: string) => void
  onActivate?: (id: string) => void
  onContextMenu?: (request: SelectionMenuRequest) => void
  column?: boolean
  toggleOnClick?: boolean
  children: ReactNode
  className?: string
  label: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const anchor = useRef<string | null>(null)
  const current = useRef(new Set<string>())
  current.current = new Set(items.filter(item => item.selected).map(item => item.id))
  const ids = items.filter(item => !item.disabled).map(item => item.id)
  const [rectangle, setRectangle] = useState<SelectionRect | null>(null)
  const drag = useRef<{
    x: number
    y: number
    clientX: number
    clientY: number
    base: Set<string>
    active: boolean
    pointerId: number
  } | null>(null)
  const suppressClick = useRef(false)
  const frame = useRef(0)
  const commitRef = useRef<(next: Set<string>) => void>(() => {})
  commitRef.current = next => {
    const changed = changedSelection(current.current, next)
    current.current = next
    if (changed.length) onSelectionChange(next, changed)
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const rowAt = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null
    const row = target.closest<HTMLElement>('[data-selection-id]')
    return row && root.current?.contains(row) ? row : null
  }
  const choose = (id: string, event: MouseEvent | React.KeyboardEvent) => {
    commitRef.current(selectItem(ids, current.current, id, anchor.current, event, toggleOnClick))
    if (!event.shiftKey || anchor.current === null) anchor.current = id
  }
  const showMenu = (id: string | null, x: number, y: number) => {
    if (!onContextMenu || (id && !ids.includes(id))) return
    // A right click on an existing selection preserves the whole batch.
    const next = id ? current.current.has(id) ? new Set(current.current) : new Set([id]) : new Set<string>()
    commitRef.current(next)
    if (id) anchor.current = id
    onContextMenu({ id, selectedIds: [...next], x, y })
  }
  const updateDrag = () => {
    const state = drag.current
    const node = root.current
    if (!state || !node || !state.active) return
    const bounds = node.getBoundingClientRect()
    const x = Math.max(0, Math.min(bounds.width, state.clientX - bounds.left)) + node.scrollLeft
    const y = Math.max(0, Math.min(bounds.height, state.clientY - bounds.top)) + node.scrollTop
    const rect = { left: Math.min(state.x, x), top: Math.min(state.y, y), right: Math.max(state.x, x), bottom: Math.max(state.y, y) }
    setRectangle(rect)
    const hit = new Set(state.base)
    node.querySelectorAll<HTMLElement>('[data-selection-id]').forEach(row => {
      const id = row.dataset.selectionId!
      if (!ids.includes(id)) return
      const r = row.getBoundingClientRect()
      if (
        intersects(rect, {
          left: r.left - bounds.left + node.scrollLeft,
          right: r.right - bounds.left + node.scrollLeft,
          top: r.top - bounds.top + node.scrollTop,
          bottom: r.bottom - bounds.top + node.scrollTop
        })
      )
        hit.add(id)
    })
    commitRef.current(hit)
  }
  const autoScroll = () => {
    const state = drag.current
    const node = root.current
    if (!state || !node || !state.active) return
    const bounds = node.getBoundingClientRect()
    const speed = state.clientY < bounds.top + 28 ? -12 : state.clientY > bounds.bottom - 28 ? 12 : 0
    if (speed) {
      node.scrollTop += speed
      updateDrag()
    }
    frame.current = requestAnimationFrame(autoScroll)
  }
  const finishDrag = (event: PointerEvent) => {
    if (!drag.current) return
    suppressClick.current = drag.current.active
    drag.current = null
    cancelAnimationFrame(frame.current)
    setRectangle(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return (
    <div
      ref={root}
      tabIndex={0}
      aria-label={label}
      className={`selection-surface relative select-none outline-none ${className}`}
      onContextMenu={event => {
        if (!onContextMenu || (event.target as Element).closest('input:not([type="checkbox"]),textarea,[contenteditable="true"]')) return
        event.preventDefault()
        event.stopPropagation()
        const row = rowAt(event.target)
        row?.focus({ preventScroll: true })
        showMenu(row?.dataset.selectionId ?? null, event.clientX, event.clientY)
      }}
      onClickCapture={event => {
        if (suppressClick.current) {
          suppressClick.current = false
          event.stopPropagation()
          event.preventDefault()
          return
        }
        if ((event.target as Element).closest(controls)) return
        const row = rowAt(event.target)
        if (!row) {
          commitRef.current(new Set())
          anchor.current = null
          return
        }
        event.stopPropagation()
        const item = items.find(item => item.id === row.dataset.selectionId)
        if (!item || item.disabled) return
        row.focus({ preventScroll: true })
        if (column && item.directory && !event.ctrlKey && !event.metaKey && !event.shiftKey) onOpen?.(item.id)
        else {
          choose(item.id, event)
          if (!event.ctrlKey && !event.metaKey && !event.shiftKey) onActivate?.(item.id)
        }
      }}
      onDoubleClickCapture={event => {
        if ((event.target as Element).closest(controls)) return
        const id = rowAt(event.target)?.dataset.selectionId
        if (id && ids.includes(id)) {
          event.stopPropagation()
          onOpen?.(id)
        }
      }}
      onKeyDown={event => {
        if ((event.target as Element).closest('input:not([type="checkbox"]),textarea,select,[contenteditable="true"]')) return
        const key = event.key.toLowerCase()
        if (event.altKey && (key === 'arrowleft' || key === 'arrowright')) return
        if (onContextMenu && (key === 'contextmenu' || (key === 'f10' && event.shiftKey))) {
          event.preventDefault()
          event.stopPropagation()
          const row = rowAt(event.target)
          const bounds = (row ?? root.current)?.getBoundingClientRect()
          if (bounds) showMenu(row?.dataset.selectionId ?? null, bounds.left + 16, bounds.top + 20)
          return
        }
        if ((event.target as Element).closest(controls) && !((event.ctrlKey || event.metaKey) && key === 'a')) return
        const row = rowAt(event.target)
        const id = row?.dataset.selectionId
        if ((event.ctrlKey || event.metaKey) && key === 'a') {
          event.preventDefault()
          event.stopPropagation()
          commitRef.current(new Set(ids))
        } else if (key === 'escape') {
          event.preventDefault()
          event.stopPropagation()
          commitRef.current(new Set())
          anchor.current = null
        } else if (id && key === 'enter') {
          event.preventDefault()
          event.stopPropagation()
          onOpen?.(id)
        } else if (id && key === ' ' && !(event.target as Element).closest(controls)) {
          event.preventDefault()
          event.stopPropagation()
          commitRef.current(selectItem(ids, current.current, id, anchor.current, { ...event, ctrlKey: true }, toggleOnClick))
          anchor.current = id
        } else if (['arrowdown', 'arrowup', 'arrowleft', 'arrowright'].includes(key)) {
          const offset = key === 'arrowup' || key === 'arrowleft' ? -1 : 1
          const nextId = ids[Math.max(0, Math.min(ids.length - 1, (id ? ids.indexOf(id) : -1) + offset))]
          if (!nextId) return
          event.preventDefault()
          event.stopPropagation()
          const next = [...(root.current?.querySelectorAll<HTMLElement>('[data-selection-id]') ?? [])].find(
            el => el.dataset.selectionId === nextId
          )
          next?.focus({ preventScroll: true })
          next?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          if (!event.ctrlKey && !event.metaKey && !toggleOnClick) choose(nextId, event)
        }
      }}
      onPointerDown={event => {
        suppressClick.current = false
        if (event.button !== 0 || (event.target as Element).closest(`${controls},[data-selection-id]`)) return
        const node = event.currentTarget
        const bounds = node.getBoundingClientRect()
        // Do not capture native scrollbar gestures.
        if (event.clientX - bounds.left >= node.clientWidth || event.clientY - bounds.top >= node.clientHeight) return
        node.focus({ preventScroll: true })
        drag.current = {
          x: event.clientX - bounds.left + node.scrollLeft,
          y: event.clientY - bounds.top + node.scrollTop,
          clientX: event.clientX,
          clientY: event.clientY,
          base: event.ctrlKey || event.metaKey || event.shiftKey ? new Set(current.current) : new Set(),
          active: false,
          pointerId: event.pointerId
        }
        node.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        const state = drag.current
        if (!state || state.pointerId !== event.pointerId) return
        if (!state.active && Math.hypot(event.clientX - state.clientX, event.clientY - state.clientY) < 4) return
        const wasActive = state.active
        state.active = true
        state.clientX = event.clientX
        state.clientY = event.clientY
        updateDrag()
        if (!wasActive) frame.current = requestAnimationFrame(autoScroll)
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={() => {
        drag.current = null
        cancelAnimationFrame(frame.current)
        setRectangle(null)
      }}
    >
      {children}
      {rectangle && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-30 border border-accent bg-accent/15"
          style={{
            left: rectangle.left,
            top: rectangle.top,
            width: rectangle.right - rectangle.left,
            height: rectangle.bottom - rectangle.top
          }}
        />
      )}
    </div>
  )
}
