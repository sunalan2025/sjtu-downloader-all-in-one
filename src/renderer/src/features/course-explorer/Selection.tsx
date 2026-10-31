import { createContext, useContext, useState, type ComponentProps } from 'react'
import { SelectionSurface, type SelectableItem } from '../file-manager/SelectionSurface'
import { ContextMenu, type MenuAction, type SelectionMenuRequest } from '../file-manager/ContextMenu'
import type { NetdiskCategoryItem, NetdiskCourseItem, NetdiskFileItem } from './model'

export type CourseMenuEntry =
  { kind: 'course'; item: NetdiskCourseItem } | { kind: 'category'; item: NetdiskCategoryItem } | { kind: 'file'; item: NetdiskFileItem }
export const CourseMenuContext = createContext<((entries: CourseMenuEntry[]) => MenuAction[]) | null>(null)
export type CourseSelectionItem = SelectableItem & { onToggle: () => void; entry: CourseMenuEntry }
export const selectableCourses = (courses: NetdiskCourseItem[]): CourseSelectionItem[] =>
  courses.map(c => ({
    id: String(c.id),
    selected: c.state !== 'none',
    directory: true,
    entry: { kind: 'course', item: c },
    onToggle: c.onToggle
  }))
export const selectableCategories = (categories: NetdiskCategoryItem[]): CourseSelectionItem[] =>
  categories.map(c => ({
    id: c.id,
    selected: c.state !== 'none',
    directory: true,
    entry: { kind: 'category', item: c },
    disabled: c.disabled,
    onToggle: c.onToggle
  }))
export const selectableFiles = (files: NetdiskFileItem[]): CourseSelectionItem[] =>
  files.map(f => ({
    id: f.id,
    selected: f.selected,
    entry: { kind: 'file', item: f },
    disabled: f.disabled,
    onToggle: f.onToggle
  }))
export function CourseSelectionSurface({
  items,
  toggleOnClick = true,
  ...props
}: Omit<ComponentProps<typeof SelectionSurface>, 'onSelectionChange' | 'items'> & {
  items: CourseSelectionItem[]
  toggleOnClick?: boolean
}) {
  const buildActions = useContext(CourseMenuContext)
  const [menu, setMenu] = useState<SelectionMenuRequest | null>(null)
  const targets = menu ? items.filter(item => menu.selectedIds.includes(item.id)) : []
  const actions: MenuAction[] = []
  if (targets.length === 1 && props.onOpen)
    actions.push({
      id: 'open',
      label: targets[0].directory ? '打开' : '查看详情',
      shortcut: 'Enter',
      run: () => props.onOpen?.(targets[0].id)
    })
  if (targets.length) actions.push(...(buildActions?.(targets.map(target => target.entry)) ?? []))
  else
    actions.push({
      id: 'select-all',
      label: '全选',
      shortcut: 'Ctrl/Cmd+A',
      disabled: !items.length,
      run: () => {
        for (const item of items) if (!item.selected && !item.disabled) item.onToggle()
      }
    })
  return (
    <>
      <SelectionSurface
        {...props}
        items={items}
        toggleOnClick={toggleOnClick}
        onContextMenu={buildActions ? setMenu : undefined}
        onSelectionChange={(_next, changed) => {
          for (const id of changed) {
            const item = items.find(it => it.id === id)
            if (item && !item.disabled) {
              item.onToggle()
            }
          }
        }}
      />
      {menu && <ContextMenu point={menu} actions={actions} onClose={() => setMenu(null)} />}
    </>
  )
}
