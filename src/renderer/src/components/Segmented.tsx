import { memo } from 'react'

// ─────────────────────────────────────────────────────────────
// Segmented — 统一的「玻璃滑动指示器」分段选择器
//
// 之前 App.TabBar / TitleBar 主题切换 / Browser.ModeSelector /
// CanvasBrowser.ModeSelector 各写一份近乎相同的滑动指示器实现，
// 宽度还硬编码（w-[160px] / calc(33.333%…)）。这里统一为等宽 flex +
// 百分比定位的指示器，宽度自适应、动画曲线一致。
// ─────────────────────────────────────────────────────────────

export interface SegmentedOption<T extends string> {
  key: T
  /** 文本标签，与 icon 至少有一个；纯图标模式可省略 */
  label?: string
  icon?: React.ReactNode
  title?: string
}

type SegmentedSize = 'sm' | 'md' | 'lg'

const SIZE_WRAP: Record<SegmentedSize, string> = {
  sm: 'h-7 text-xs',
  md: 'h-8 text-xs',
  lg: 'h-9 text-sm'
}
const SIZE_BTN: Record<SegmentedSize, string> = {
  sm: 'px-2',
  md: 'px-3',
  lg: 'px-4'
}

function SegmentedImpl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className = ''
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (key: T) => void
  size?: SegmentedSize
  className?: string
}) {
  const n = options.length || 1
  const activeIdx = Math.max(0, options.findIndex(o => o.key === value))
  const seg = 100 / n

  return (
    <div
      className={`relative inline-flex w-fit select-none items-center rounded-lg border border-bd bg-surface-2 p-0.5 ${SIZE_WRAP[size]} ${className}`}
    >
      {/* 玻璃滑动指示器 */}
      <span
        className="pointer-events-none absolute bottom-0.5 top-0.5 rounded-md bg-surface-1 shadow-sm"
        style={{
          width: `calc(${seg}% - 2px)`,
          left: `calc(${activeIdx * seg}% + 1px)`,
          transition: 'left 300ms cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      />
      {options.map(o => {
        const active = o.key === value
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            title={o.title}
            className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md transition-colors duration-200 ${SIZE_BTN[size]} ${
              active ? 'font-medium text-accent' : 'text-text-3 hover:text-text-1'
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export const Segmented = memo(SegmentedImpl) as typeof SegmentedImpl
