export interface SelectionModifiers {
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
}

export function selectItem(
  ids: readonly string[],
  selected: ReadonlySet<string>,
  id: string,
  anchor: string | null,
  modifiers: SelectionModifiers = {}
) {
  const additive = modifiers.ctrlKey || modifiers.metaKey
  if (modifiers.shiftKey && anchor !== null && ids.includes(anchor)) {
    const start = ids.indexOf(anchor)
    const end = ids.indexOf(id)
    if (end < 0) return new Set(selected)
    return new Set([...(additive ? selected : []), ...ids.slice(Math.min(start, end), Math.max(start, end) + 1)])
  }
  if (!additive) return new Set([id])
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export interface SelectionRect {
  left: number
  top: number
  right: number
  bottom: number
}
export function intersects(a: SelectionRect, b: SelectionRect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

export function changedSelection(previous: ReadonlySet<string>, next: ReadonlySet<string>) {
  return [...new Set([...previous, ...next])].filter(id => previous.has(id) !== next.has(id))
}
