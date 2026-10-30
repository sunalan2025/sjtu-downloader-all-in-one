import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

export function useNavigationHistory<T>(current: T, apply: (next: T) => void, scope = '') {
  const entries = useRef<T[]>([current])
  const index = useRef(0)
  const previousScope = useRef(scope)
  const [, render] = useState(0)
  const key = JSON.stringify(current)
  useEffect(() => {
    if (previousScope.current !== scope) {
      previousScope.current = scope
      entries.current = [current]
      index.current = 0
      render(value => value + 1)
    } else if (JSON.stringify(entries.current[index.current]) !== key) {
      entries.current = [...entries.current.slice(0, index.current + 1), current].slice(-100)
      index.current = entries.current.length - 1
      render(value => value + 1)
    }
  }, [key, scope, current])
  const go = (offset: number) => {
    const next = index.current + offset
    if (next < 0 || next >= entries.current.length) return
    index.current = next
    apply(entries.current[next])
    render(value => value + 1)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    if ((event.target as Element).closest('input,textarea,select,dialog,[role="menu"],[contenteditable="true"]')) return
    event.preventDefault()
    event.stopPropagation()
    go(event.key === 'ArrowLeft' ? -1 : 1)
  }
  return {
    back: () => go(-1),
    forward: () => go(1),
    canBack: index.current > 0,
    canForward: index.current < entries.current.length - 1,
    onKeyDown
  }
}
