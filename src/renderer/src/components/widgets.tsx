// 通用 UI 原语：复选框 / 图标 / 文件徽标 / 下拉 / macOS 风格视觉件 / 视图切换器。
//
// [Phase 3 拆分] 原 DownloadUI.tsx（1043 行）按内聚拆为两块：本文件（视觉原语，
// 与下载状态机无关）+ progress-primitives.tsx（进度状态机与任务控制）。旧导入
// 路径 '../components/DownloadUI' 由 DownloadUI.tsx barrel re-export 保持不变。

import { useEffect, useRef, useState } from 'react'
import { useClickOutside } from '../hooks/useClickOutside'
import type { CourseViewMode } from '../store/app'

export type TriState = 'none' | 'some' | 'all'

export function triStateFromCount(sel: number, total: number): TriState {
  if (sel === 0) return 'none'
  return sel === total ? 'all' : 'some'
}

export function TriCheckbox({ state, size = 'sm' }: { state: TriState; size?: 'sm' | 'lg' }) {
  const dims = size === 'lg' ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'
  const tick = size === 'lg' ? 'h-3 w-3' : 'h-2.5 w-2.5'
  const dash = size === 'lg' ? 'h-[2px] w-2.5' : 'h-[2px] w-2'
  const base = `inline-flex ${dims} items-center justify-center rounded-[4px] border-2 transition-all duration-150`
  if (state === 'all') {
    return (
      <span className={`${base} border-accent bg-accent text-white`}>
        <svg viewBox="0 0 16 16" className={tick} fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }
  if (state === 'some') {
    return (
      <span className={`${base} border-accent bg-accent-80 text-white`}>
        <span className={`${dash} rounded-full bg-white`} />
      </span>
    )
  }
  return <span className={`${base} border-bd-strong bg-transparent`} />
}

export function SmallCheck({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-[2px] border transition-all duration-150 ${
        on ? 'border-current bg-current/30' : 'border-current/50'
      }`}
    >
      {on && (
        <svg viewBox="0 0 16 16" className="h-2 w-2" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-text-3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

export function ItemCheckbox({
  checked,
  disabled,
  onChange
}: {
  checked: boolean
  disabled?: boolean
  onChange?: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        if (disabled) return
        onChange?.()
      }}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all duration-150 ${
        disabled
          ? 'cursor-not-allowed opacity-40 border-bd bg-surface-2'
          : checked
            ? 'cursor-pointer border-accent bg-accent text-white shadow-2xs'
            : 'cursor-pointer border-bd-strong bg-surface-1 hover:border-text-3'
      }`}
    >
      {checked && (
        <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}

export function FileTypeBadge({
  filename,
  type,
  className = 'h-[22px] w-[18px] shrink-0 drop-shadow-2xs'
}: {
  filename?: string
  type?: string
  className?: string
}) {
  let ext = type?.toUpperCase()

  // 关键防错：如果文件名包含明确的文件后缀，优先采用真实文件后缀（避免上游误传通用类型覆盖了真实的 pptx/pdf）
  if (ext !== 'M4A' && ext !== 'DISABLED' && filename) {
    const cleanFn = filename.replace(/\s*\([^)]*\)\s*$/, '').trim()
    const m = cleanFn.match(/\.([a-zA-Z0-9]{2,5})$/)
    if (m) {
      const fnExt = m[1].toUpperCase()
      const recognizedExts = [
        'PDF', 'PPT', 'PPTX', 'DOC', 'DOCX', 'XLS', 'XLSX', 'ZIP', 'RAR', '7Z', 'TXT',
        'MP4', 'MP3', 'FLV', 'MKV', 'AVI', 'MOV', 'WAV', 'AAC'
      ]
      if (recognizedExts.includes(fnExt)) {
        ext = fnExt
      } else if (!ext) {
        ext = fnExt
      }
    }
  }

  ext = ext || 'FILE'

  const badgeClass = className || 'h-[22px] w-[18px] shrink-0 drop-shadow-2xs'

  if (ext === 'ASSIGNMENT' || ext === 'ASSIGN') {
    return (
      <svg width={18} height={22} className={badgeClass} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <title>作业归档</title>
        <path d="M3 2C2.44772 2 2 2.44772 2 3V21C2 21.5523 2.44772 22 3 22H17C17.5523 22 18 21.5523 18 21V7L13 2H3Z" fill="#8B5CF6"/>
        <path d="M13 2V6C13 6.55228 13.4477 7 14 7H18L13 2Z" fill="#DDD6FE"/>
        <path d="M6 12l1.5 1.5 3-3M6 16.5l1.5 1.5 3-3" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (ext === 'PDF') {
    return (
      <svg width={18} height={22} className={badgeClass} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <title>PDF 文档</title>
        <path d="M3 2C2.44772 2 2 2.44772 2 3V21C2 21.5523 2.44772 22 3 22H17C17.5523 22 18 21.5523 18 21V7L13 2H3Z" fill="#DC2626"/>
        <path d="M13 2V6C13 6.55228 13.4477 7 14 7H18L13 2Z" fill="#FCA5A5"/>
        <rect x="3.5" y="11" width="13" height="7.5" rx="1.5" fill="#991B1B" />
        <text x="10" y="16.5" fill="#FFFFFF" fontSize="5" fontWeight="bold" textAnchor="middle" fontFamily="system-ui, sans-serif">PDF</text>
      </svg>
    )
  }
  if (ext === 'PPT' || ext === 'PPTX') {
    return (
      <svg width={18} height={22} className={badgeClass} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <title>PowerPoint 幻灯片</title>
        <path d="M3 2C2.44772 2 2 2.44772 2 3V21C2 21.5523 2.44772 22 3 22H17C17.5523 22 18 21.5523 18 21V7L13 2H3Z" fill="#EA580C"/>
        <path d="M13 2V6C13 6.55228 13.4477 7 14 7H18L13 2Z" fill="#FDBA74"/>
        <rect x="3.5" y="11" width="13" height="7.5" rx="1.5" fill="#9A3412" />
        <text x="10" y="16.5" fill="#FFFFFF" fontSize="5" fontWeight="bold" textAnchor="middle" fontFamily="system-ui, sans-serif">PPT</text>
      </svg>
    )
  }
  if (ext === 'MP4' || ext === 'M3U8' || ext === 'VIDEO' || ext === 'FLV' || ext === 'AVI' || ext === 'MKV') {
    return (
      <svg width={18} height={22} className={badgeClass} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <title>MP4 视频</title>
        <path d="M3 2C2.44772 2 2 2.44772 2 3V21C2 21.5523 2.44772 22 3 22H17C17.5523 22 18 21.5523 18 21V7L13 2H3Z" fill="#2563EB"/>
        <path d="M13 2V6C13 6.55228 13.4477 7 14 7H18L13 2Z" fill="#93C5FD"/>
        <polygon points="8,10.5 13.5,13.5 8,16.5" fill="#FFFFFF"/>
        <text x="10" y="20.5" fill="#DBEAFE" fontSize="3.8" fontWeight="bold" textAnchor="middle" fontFamily="system-ui, sans-serif">MP4</text>
      </svg>
    )
  }
  if (ext === 'M4A' || ext === 'MP3' || ext === 'AAC' || ext === 'AUDIO' || ext === 'WAV' || ext === 'FLAC') {
    return (
      <svg width={18} height={22} className={badgeClass} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <title>M4A 音频</title>
        <path d="M3 2C2.44772 2 2 2.44772 2 3V21C2 21.5523 2.44772 22 3 22H17C17.5523 22 18 21.5523 18 21V7L13 2H3Z" fill="#10B981"/>
        <path d="M13 2V6C13 6.55228 13.4477 7 14 7H18L13 2Z" fill="#6EE7B7"/>
        <path d="M8 14.5C8 13.67 8.67 13 9.5 13C10.33 13 11 13.67 11 14.5C11 15.33 10.33 16 9.5 16C8.67 16 8 15.33 8 14.5ZM11 14.5V9.5L14 9V11.5L11 12V14.5Z" fill="#FFFFFF"/>
        <text x="10" y="20.5" fill="#D1FAE5" fontSize="3.8" fontWeight="bold" textAnchor="middle" fontFamily="system-ui, sans-serif">M4A</text>
      </svg>
    )
  }
  if (ext === 'DISABLED' || ext === 'MUTE') {
    return (
      <svg width={18} height={22} className={badgeClass} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <title>无独立音频</title>
        <path d="M3 2C2.44772 2 2 2.44772 2 3V21C2 21.5523 2.44772 22 3 22H17C17.5523 22 18 21.5523 18 21V7L13 2H3Z" fill="#94A3B8"/>
        <path d="M13 2V6C13 6.55228 13.4477 7 14 7H18L13 2Z" fill="#CBD5E1"/>
        <circle cx="10" cy="13.5" r="3" stroke="#FFFFFF" strokeWidth="1.2" fill="none"/>
        <line x1="8" y1="15.5" x2="12" y2="11.5" stroke="#FFFFFF" strokeWidth="1.2"/>
        <text x="10" y="20.5" fill="#F1F5F9" fontSize="3" fontWeight="bold" textAnchor="middle" fontFamily="system-ui, sans-serif">MUTE</text>
      </svg>
    )
  }
  if (ext === 'DOC' || ext === 'DOCX') {
    return (
      <svg width={18} height={22} className={badgeClass} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <title>Word 文档</title>
        <path d="M3 2C2.44772 2 2 2.44772 2 3V21C2 21.5523 2.44772 22 3 22H17C17.5523 22 18 21.5523 18 21V7L13 2H3Z" fill="#0284C7"/>
        <path d="M13 2V6C13 6.55228 13.4477 7 14 7H18L13 2Z" fill="#7DD3FC"/>
        <rect x="3.5" y="11" width="13" height="7.5" rx="1.5" fill="#0369A1" />
        <text x="10" y="16.5" fill="#FFFFFF" fontSize="5" fontWeight="bold" textAnchor="middle" fontFamily="system-ui, sans-serif">DOC</text>
      </svg>
    )
  }
  if (ext === 'ZIP' || ext === 'RAR' || ext === '7Z' || ext === 'TAR' || ext === 'GZ') {
    return (
      <svg width={18} height={22} className={badgeClass} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <title>压缩包</title>
        <path d="M3 2C2.44772 2 2 2.44772 2 3V21C2 21.5523 2.44772 22 3 22H17C17.5523 22 18 21.5523 18 21V7L13 2H3Z" fill="#9333EA"/>
        <path d="M13 2V6C13 6.55228 13.4477 7 14 7H18L13 2Z" fill="#D8B4FE"/>
        <rect x="8.5" y="9" width="3" height="9" rx="0.5" fill="#581C87" />
        <rect x="9" y="10" width="2" height="1.5" fill="#FFFFFF" />
        <rect x="9" y="13" width="2" height="1.5" fill="#FFFFFF" />
        <rect x="9" y="16" width="2" height="1.5" fill="#FFFFFF" />
      </svg>
    )
  }
  return (
    <svg width={18} height={22} className={badgeClass} viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <title>文件</title>
      <path d="M3 2C2.44772 2 2 2.44772 2 3V21C2 21.5523 2.44772 22 3 22H17C17.5523 22 18 21.5523 18 21V7L13 2H3Z" fill="#64748B"/>
      <path d="M13 2V6C13 6.55228 13.4477 7 14 7H18L13 2Z" fill="#CBD5E1"/>
      <line x1="5" y1="12" x2="15" y2="12" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="5" y1="15" x2="13" y2="15" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="5" y1="18" x2="10" y2="18" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function FolderIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={`${className} shrink-0`}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 7V17C3 18.1 3.9 19 5 19H19C20.1 19 21 18.1 21 17V9C21 7.9 20.1 7 19 7H11L9 5H5C3.9 5 3 5.9 3 7Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 10.5H21"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeOpacity="0.28"
        strokeLinecap="round"
      />
    </svg>
  )
}

export interface DropdownOption<T extends string | number = string> {
  value: T
  label: string
  count?: number
  icon?: string
}

export interface DropdownGroup<T extends string | number = string> {
  label: string
  options: DropdownOption<T>[]
}

export interface DropdownSelectProps<T extends string | number = string> {
  value: T
  options?: DropdownOption<T>[]
  groups?: DropdownGroup<T>[]
  onChange: (val: T) => void
  icon?: string
  className?: string
  buttonClassName?: string
  menuClassName?: string
  align?: 'left' | 'right'
  title?: string
  disabled?: boolean
  size?: 'sm' | 'md'
  fullWidth?: boolean
  placeholder?: string
}

export interface DropdownKeyboardNavigationParams<T extends string | number = string> {
  key: string
  isOpen: boolean
  allOptions: DropdownOption<T>[]
  currentIndex: number
  value: T
  onOpen: () => void
  onClose: () => void
  onSelect: (val: T) => void
  onHighlight: (index: number) => void
  preventDefault?: () => void
}

/**
 * 键盘导航事件分发器：支持 WAI-ARIA 规范的下拉框全键盘操作
 * - closed 状态下按 ArrowDown / ArrowUp / Enter / Space 唤起下拉并同步高亮项
 * - open 状态下 ArrowDown / ArrowUp 循环移动高亮项，Home / End 快速首尾导航
 * - Enter / Space 确认选择当前高亮项并收起
 * - Escape / Tab 收起下拉
 */
export function handleDropdownKeyDown<T extends string | number = string>({
  key,
  isOpen,
  allOptions,
  currentIndex,
  value,
  onOpen,
  onClose,
  onSelect,
  onHighlight,
  preventDefault
}: DropdownKeyboardNavigationParams<T>): void {
  if (!isOpen) {
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
      preventDefault?.()
      const selectedIdx = allOptions.findIndex(o => o.value === value)
      onHighlight(selectedIdx >= 0 ? selectedIdx : 0)
      onOpen()
    }
    return
  }

  if (allOptions.length === 0) {
    if (key === 'Escape' || key === 'Tab') {
      if (key === 'Escape') preventDefault?.()
      onClose()
    }
    return
  }

  const count = allOptions.length

  switch (key) {
    case 'ArrowDown': {
      preventDefault?.()
      const nextIdx = (currentIndex + 1) % count
      onHighlight(nextIdx)
      break
    }
    case 'ArrowUp': {
      preventDefault?.()
      const prevIdx = (currentIndex - 1 + count) % count
      onHighlight(prevIdx)
      break
    }
    case 'Home': {
      preventDefault?.()
      onHighlight(0)
      break
    }
    case 'End': {
      preventDefault?.()
      onHighlight(count - 1)
      break
    }
    case 'Enter':
    case ' ': {
      preventDefault?.()
      if (currentIndex >= 0 && currentIndex < count) {
        onSelect(allOptions[currentIndex].value)
      }
      onClose()
      break
    }
    case 'Escape': {
      preventDefault?.()
      onClose()
      break
    }
    case 'Tab': {
      onClose()
      break
    }
  }
}

/** 现代圆角自定义下拉组件（彻底告别系统原生粗糙 select 弹窗，支持分组、Apple HIG 毛玻璃悬浮弹窗与全键盘 WAI-ARIA 无障碍导航） */
export function DropdownSelect<T extends string | number = string>({
  value,
  options,
  groups,
  onChange,
  icon,
  className = '',
  buttonClassName = '',
  menuClassName = '',
  align = 'left',
  title,
  disabled = false,
  size = 'md',
  fullWidth = false,
  placeholder
}: DropdownSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useClickOutside(containerRef, () => setOpen(false), { enabled: open })

  const allOptions = groups && groups.length > 0
    ? groups.flatMap(g => g.options)
    : (options || [])

  const selectedIdx = allOptions.findIndex(o => o.value === value)
  const [highlightedIndex, setHighlightedIndex] = useState<number>(selectedIdx >= 0 ? selectedIdx : 0)

  // 展开时或当前高亮变动时，滚动至可视区域
  useEffect(() => {
    if (!open || !menuRef.current) return
    const highlightedEl = menuRef.current.querySelector<HTMLElement>(`[data-index="${highlightedIndex}"]`)
    if (highlightedEl && typeof highlightedEl.scrollIntoView === 'function') {
      highlightedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [open, highlightedIndex])

  const openMenu = () => {
    const idx = allOptions.findIndex(o => o.value === value)
    setHighlightedIndex(idx >= 0 ? idx : 0)
    setOpen(true)
  }

  const closeMenu = () => {
    setOpen(false)
  }

  const toggleOpen = () => {
    if (disabled) return
    if (!open) {
      openMenu()
    } else {
      closeMenu()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>): void => {
    if (disabled) return
    handleDropdownKeyDown({
      key: e.key,
      isOpen: open,
      allOptions,
      currentIndex: highlightedIndex,
      value,
      onOpen: openMenu,
      onClose: closeMenu,
      onSelect: (val: T) => {
        onChange(val)
        triggerRef.current?.focus()
      },
      onHighlight: (idx: number) => {
        setHighlightedIndex(idx)
      },
      preventDefault: () => e.preventDefault()
    })
  }

  const selectedOpt = allOptions.find(o => o.value === value)

  const renderOptionItem = (opt: DropdownOption<T>, idx: number) => {
    const isSelected = opt.value === value
    const isHighlighted = idx === highlightedIndex
    return (
      <button
        key={String(opt.value)}
        id={`dropdown-opt-${idx}`}
        data-index={idx}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={isSelected}
        onClick={() => {
          onChange(opt.value)
          setOpen(false)
          triggerRef.current?.focus()
        }}
        onMouseEnter={() => setHighlightedIndex(idx)}
        className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-xs transition-colors text-left cursor-pointer ${
          isSelected && isHighlighted
            ? 'bg-accent/20 font-semibold text-accent ring-1 ring-accent/30'
            : isSelected
              ? 'bg-accent/15 font-semibold text-accent'
              : isHighlighted
                ? 'bg-surface-2 text-text-1'
                : 'text-text-2 hover:bg-surface-2/80 hover:text-text-1'
        }`}
      >
        <span className="truncate">
          {opt.icon && <span className="mr-1.5">{opt.icon}</span>}
          {opt.label}
          {typeof opt.count === 'number' ? ` ${opt.count}` : ''}
        </span>
        {isSelected && (
          <span className="text-accent text-xs font-bold shrink-0">✓</span>
        )}
      </button>
    )
  }

  const isSmall = size === 'sm'

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      className={`relative ${fullWidth ? 'block w-full' : 'inline-block'} text-left ${open ? 'z-50' : ''} ${className}`}
      title={title}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggleOpen}
        className={`${
          isSmall ? 'h-8 px-2.5 text-2xs' : 'h-9 px-3 text-xs'
        } ${
          fullWidth ? 'w-full flex' : 'inline-flex'
        } items-center justify-between gap-2 rounded-xl border bg-surface-1 font-medium text-text-1 shadow-2xs transition-all hover:bg-surface-2 cursor-pointer select-none ${
          disabled ? 'opacity-40 cursor-not-allowed hover:bg-surface-1' : ''
        } ${
          open ? 'border-accent ring-2 ring-accent/15 bg-surface-1' : 'border-bd hover:border-bd-strong'
        } ${buttonClassName}`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {icon && <span className={isSmall ? 'text-2xs' : 'text-xs'}>{icon}</span>}
          {selectedOpt ? (
            <span className={`truncate ${fullWidth ? 'max-w-none' : 'max-w-[200px]'}`}>{selectedOpt.label}</span>
          ) : placeholder ? (
            <span className={`truncate text-text-4 font-normal ${fullWidth ? 'max-w-none' : 'max-w-[200px]'}`}>{placeholder}</span>
          ) : (
            <span className={`truncate ${fullWidth ? 'max-w-none' : 'max-w-[200px]'}`}>{String(value ?? '')}</span>
          )}
          {typeof selectedOpt?.count === 'number' && (
            <span className="text-text-4 font-normal ml-1.5">{selectedOpt.count}</span>
          )}
        </div>
        <svg
          className={`${isSmall ? 'h-3 w-3' : 'h-3.5 w-3.5'} text-text-3 transition-transform duration-200 shrink-0 ${open ? 'rotate-180 text-accent' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={`dropdown-opt-${highlightedIndex}`}
          className={`animate-fadeIn absolute ${
            align === 'right' ? 'right-0' : 'left-0'
          } top-[calc(100%+6px)] z-50 ${
            fullWidth ? 'w-full min-w-full' : 'min-w-full w-max max-w-[340px]'
          } max-h-72 overflow-y-auto rounded-2xl border border-black/[0.08] dark:border-bd-strong bg-surface-1 dark:bg-[#1e1e22] p-1.5 shadow-2xl ${menuClassName}`}
        >
          {groups && groups.length > 0 ? (
            groups.map((group, gIdx) => (
              <div key={group.label} className={gIdx > 0 ? 'mt-1 pt-1 border-t border-bd' : ''}>
                <div className="px-3 py-1 text-3xs font-semibold text-text-4 select-none tracking-wider uppercase">
                  {group.label}
                </div>
                {group.options.map(opt => {
                  const optIdx = allOptions.indexOf(opt)
                  return renderOptionItem(opt, optIdx >= 0 ? optIdx : 0)
                })}
              </div>
            ))
          ) : (
            allOptions.map((opt, idx) => renderOptionItem(opt, idx))
          )}
        </div>
      )}
    </div>
  )
}

/** macOS 风格经典天蓝色矢量立体文件夹图标 */
export function MacOSFolderIcon({
  size = 64,
  className = ''
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`drop-shadow-sm select-none shrink-0 ${className}`}
    >
      {/* 1. 文件夹深蓝背板与上方 Tab */}
      <path
        d="M6 14C6 9.58172 9.58172 6 14 6H34.5C37.5 6 40.2 7.8 41.5 10.5L43.8 15H86C90.4183 15 94 18.5817 94 23V68C94 72.4183 90.4183 76 86 76H14C9.58172 76 6 72.4183 6 68V14Z"
        fill="#2563EB"
      />
      {/* 2. 文件夹开口暗色内衬 */}
      <rect x="10" y="17" width="80" height="15" rx="3" fill="#1D4ED8" />
      {/* 3. 文件夹露出纸张微白横条（提供细腻物理拟物感） */}
      <rect x="16" y="14" width="68" height="6" rx="2" fill="#DBEAFE" fillOpacity="0.9" />
      {/* 4. 文件夹主前盖（经典 Apple macOS 天蓝色） */}
      <path
        d="M6 26C6 22.6863 8.68629 20 12 20H88C91.3137 20 94 22.6863 94 26V68C94 72.4183 90.4183 76 86 76H14C9.58172 76 6 72.4183 6 68V26Z"
        fill="#3B82F6"
      />
      {/* 5. 前盖顶部高光微凸倒角 */}
      <path
        d="M6 26C6 22.6863 8.68629 20 12 20H88C91.3137 20 94 22.6863 94 26V28H6V26Z"
        fill="#93C5FD"
        fillOpacity="0.8"
      />
      {/* 6. 前盖底缘微妙投影衬底 */}
      <path
        d="M14 76H86C90.4183 76 94 72.4183 94 68V70C94 74.4183 90.4183 78 86 78H14C9.58172 78 6 74.4183 6 70V68C6 72.4183 9.58172 76 14 76Z"
        fill="#1D4ED8"
        fillOpacity="0.5"
      />
    </svg>
  )
}

/** macOS 风格折角文档图标（根据后缀提供专用色带与徽标） */
export function MacOSDocumentIcon({
  filename,
  type,
  size = 64,
  className = ''
}: {
  filename?: string
  type?: string
  size?: number
  className?: string
}) {
  let ext = type?.toUpperCase()
  if (ext !== 'M4A' && ext !== 'DISABLED' && filename) {
    const cleanFn = filename.replace(/\s*\([^)]*\)\s*$/, '').trim()
    const m = cleanFn.match(/\.([a-zA-Z0-9]{2,5})$/)
    if (m) {
      const fnExt = m[1].toUpperCase()
      const recognizedExts = [
        'PDF', 'PPT', 'PPTX', 'DOC', 'DOCX', 'XLS', 'XLSX', 'ZIP', 'RAR', '7Z', 'TXT',
        'MP4', 'MP3', 'FLV', 'MKV', 'AVI', 'MOV', 'WAV', 'AAC', 'PNG', 'JPG', 'JPEG', 'MD', 'PY', 'TS', 'JS'
      ]
      if (recognizedExts.includes(fnExt)) {
        ext = fnExt
      } else if (!ext) {
        ext = fnExt
      }
    }
  }
  ext = ext || 'FILE'

  let ribbonColor = '#64748B'
  let label = ext
  let isVideo = false
  let isAudio = false
  let isImage = false
  let isAssignment = false

  if (ext === 'ASSIGNMENT' || ext === 'ASSIGN') {
    ribbonColor = '#8B5CF6'
    label = '作业'
    isAssignment = true
  } else if (ext === 'PDF') {
    ribbonColor = '#EF4444'
    label = 'PDF'
  } else if (ext === 'PPT' || ext === 'PPTX') {
    ribbonColor = '#F97316'
    label = 'PPT'
  } else if (ext === 'DOC' || ext === 'DOCX') {
    ribbonColor = '#3B82F6'
    label = 'DOC'
  } else if (ext === 'XLS' || ext === 'XLSX' || ext === 'CSV') {
    ribbonColor = '#10B981'
    label = 'XLS'
  } else if (['MP4', 'MKV', 'AVI', 'MOV', 'FLV', 'TS', 'VIDEO'].includes(ext)) {
    ribbonColor = '#6366F1'
    label = 'MP4'
    isVideo = true
  } else if (['MP3', 'WAV', 'M4A', 'FLAC', 'AAC', 'AUDIO'].includes(ext)) {
    ribbonColor = '#06B6D4'
    label = 'MP3'
    isAudio = true
  } else if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ'].includes(ext)) {
    ribbonColor = '#D97706'
    label = 'ZIP'
  } else if (['PNG', 'JPG', 'JPEG', 'GIF', 'WEBP', 'SVG'].includes(ext)) {
    ribbonColor = '#EC4899'
    label = ext.slice(0, 4)
    isImage = true
  } else if (['TXT', 'MD', 'JSON', 'JS', 'TS', 'PY', 'C', 'CPP', 'JAVA', 'HTML', 'CSS'].includes(ext)) {
    ribbonColor = '#8B5CF6'
    label = ext.slice(0, 4)
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 72 84"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`drop-shadow-sm select-none shrink-0 ${className}`}
    >
      {/* 纸张轮廓：带右上角折角切口 */}
      <path
        d="M8 8C8 4.68629 10.6863 2 14 2H50L64 16V76C64 79.3137 61.3137 82 58 82H14C10.6863 82 8 79.3137 8 76V8Z"
        fill="#FFFFFF"
        stroke="#CBD5E1"
        strokeWidth="1.2"
      />
      {/* 折角三角形 */}
      <path
        d="M50 2V13C50 14.6569 51.3431 16 53 16H64L50 2Z"
        fill="#E2E8F0"
        stroke="#CBD5E1"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* 中心特色徽标 */}
      {isAssignment ? (
        <g stroke={ribbonColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M22 31l3 3 6-6" />
          <path d="M35 31h15" />
          <path d="M22 43l3 3 6-6" />
          <path d="M35 43h15" />
        </g>
      ) : isVideo ? (
        <>
          <circle cx="36" cy="40" r="13" fill={ribbonColor} fillOpacity="0.15" />
          <polygon points="32,33 44,40 32,47" fill={ribbonColor} />
        </>
      ) : isAudio ? (
        <path d="M38 31V45C38 47 36 49 33 49C30.5 49 29 47.5 29 45.5C29 43.5 30.5 42 33 42C34.5 42 35.8 42.6 36.5 43.5V34L45 32V42C45 44 43 46 40 46C37.5 46 36 44.5 36 42.5C36 40.5 37.5 39 40 39C41.5 39 42.8 39.6 43.5 40.5V31L38 31Z" fill={ribbonColor} />
      ) : isImage ? (
        <g fill={ribbonColor}>
          <circle cx="28" cy="36" r="3.5" />
          <path d="M22 47L30 38L37 45L43 39L50 47H22Z" fillOpacity="0.8" />
        </g>
      ) : (
        <g fill="#E2E8F0">
          <rect x="18" y="26" width="24" height="2.5" rx="1.2" />
          <rect x="18" y="32" width="36" height="2.5" rx="1.2" />
          <rect x="18" y="38" width="30" height="2.5" rx="1.2" />
        </g>
      )}

      {/* 底部醒目色带与扩展名 */}
      <rect x="8" y="55" width="56" height="19" fill={ribbonColor} />
      <text
        x="36"
        y="68.5"
        fill="#FFFFFF"
        fontSize="10"
        fontWeight="800"
        textAnchor="middle"
        fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif"
        letterSpacing="0.5"
      >
        {label}
      </text>
    </svg>
  )
}

/** macOS 风格圆圈复选框（用于网格视图批量勾选与选中标识） */
export function MacOSCircleCheckbox({
  checked = false,
  state,
  onClick,
  className = '',
  size = 'md'
}: {
  checked?: boolean
  state?: TriState
  onClick?: (e: React.MouseEvent) => void
  className?: string
  size?: 'sm' | 'md'
}) {
  const isChecked = state ? state === 'all' : checked
  const isIndeterminate = state === 'some'
  const isSelected = isChecked || isIndeterminate
  const wh = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex items-center justify-center rounded-full transition-all duration-150 cursor-pointer ${wh} ${
        isSelected
          ? 'bg-accent text-white shadow-2xs scale-100 ring-1 ring-accent/30'
          : 'bg-surface-1/90 border border-bd text-transparent hover:border-accent/80 hover:bg-surface-2 shadow-2xs'
      } ${className}`}
      title={isChecked ? '取消勾选' : '勾选此项'}
    >
      {isChecked && (
        <svg className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2.5 6 4.8 8.5 9.5 3.5" />
        </svg>
      )}
      {isIndeterminate && (
        <div className={size === 'sm' ? 'w-2 h-0.5 bg-white rounded-full' : 'w-2.5 h-0.5 bg-white rounded-full'} />
      )}
    </button>
  )
}

/** 网盘式导航视图模式切换器（对齐 macOS Finder 顺序：图标 / 列表 / 分栏，带平滑滑动胶囊动效，支持动态 modes 裁剪） */
export function NetdiskViewModeSwitch({
  mode,
  onChange,
  modes = ['grid', 'list', 'column']
}: {
  mode: CourseViewMode
  onChange: (m: CourseViewMode) => void
  modes?: CourseViewMode[]
}) {
  const activeIdx = modes.indexOf(mode)

  return (
    <div className="relative flex h-9 items-center rounded-xl border border-bd bg-surface-2 p-0.5 shadow-2xs select-none">
      {/* 弹性滑动胶囊背景 (Sliding Pill Indicator) */}
      {activeIdx >= 0 && (
        <div
          className="absolute top-0.5 bottom-0.5 w-8 rounded-lg bg-surface-1 shadow-2xs transition-transform duration-200 ease-out pointer-events-none"
          style={{
            transform: `translateX(${activeIdx * 32}px)`
          }}
        />
      )}
      {modes.includes('grid') && (
        <button
          type="button"
          onClick={() => onChange('grid')}
          className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-lg transition-colors cursor-pointer ${
            mode === 'grid' ? 'text-accent font-semibold' : 'text-text-3 hover:text-text-1'
          }`}
          title="图标视图"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
            <rect x="2" y="2" width="5" height="5" rx="1.2" />
            <rect x="9" y="2" width="5" height="5" rx="1.2" />
            <rect x="2" y="9" width="5" height="5" rx="1.2" />
            <rect x="9" y="9" width="5" height="5" rx="1.2" />
          </svg>
        </button>
      )}
      {modes.includes('list') && (
        <button
          type="button"
          onClick={() => onChange('list')}
          className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-lg transition-colors cursor-pointer ${
            mode === 'list' ? 'text-accent font-semibold' : 'text-text-3 hover:text-text-1'
          }`}
          title="列表视图"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <line x1="2.5" y1="3.5" x2="13.5" y2="3.5" />
            <line x1="2.5" y1="8" x2="13.5" y2="8" />
            <line x1="2.5" y1="12.5" x2="13.5" y2="12.5" />
          </svg>
        </button>
      )}
      {modes.includes('column') && (
        <button
          type="button"
          onClick={() => onChange('column')}
          className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-lg transition-colors cursor-pointer ${
            mode === 'column' ? 'text-accent font-semibold' : 'text-text-3 hover:text-text-1'
          }`}
          title="分栏视图"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="2" y="2" width="3.5" height="12" rx="1" fill="currentColor" fillOpacity="0.2" />
            <rect x="6.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" fillOpacity="0.2" />
            <rect x="11" y="2" width="3" height="12" rx="1" fill="currentColor" fillOpacity="0.2" />
          </svg>
        </button>
      )}
    </div>
  )
}

export interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string
  onChange: (value: string) => void
  onClear?: () => void
  containerClassName?: string
}

export function SearchInput({
  value,
  onChange,
  onClear,
  placeholder = '搜索…',
  className = 'h-9 w-48',
  containerClassName = '',
  onKeyDown,
  ...rest
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClear = () => {
    onChange('')
    onClear?.()
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && value) {
      e.stopPropagation()
      e.preventDefault()
      handleClear()
    }
    onKeyDown?.(e)
  }

  return (
    <div className={`relative flex items-center ${containerClassName}`}>
      <svg
        className="pointer-events-none absolute left-3 h-4 w-4 text-text-4 select-none shrink-0"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
          clipRule="evenodd"
        />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={`rounded-xl border border-bd bg-surface-2 pl-9 pr-8 text-xs text-text-1 placeholder:text-text-4 shadow-2xs hover:border-bd-strong focus:border-accent focus:bg-surface-1 focus:outline-none transition-all duration-200 ${className}`}
        {...rest}
      />
      {value.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="清空搜索"
          title="清空 (Esc)"
          onClick={handleClear}
          className="absolute right-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface-3 text-text-3 hover:bg-surface-4 hover:text-text-1 transition-colors cursor-pointer text-2xs leading-none"
        >
          ✕
        </button>
      )}
    </div>
  )
}
