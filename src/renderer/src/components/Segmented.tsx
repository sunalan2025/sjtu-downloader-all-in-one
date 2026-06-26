import { memo, useLayoutEffect, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────
// Segmented — 统一的「玻璃滑动指示器」分段选择器
//
// 之前 App.TabBar / TitleBar 主题切换 / Browser.ModeSelector /
// CanvasBrowser.ModeSelector 各写一份近乎相同的滑动指示器实现，
// 宽度还硬编码（w-[160px] / calc(33.333%…)）。这里统一为等宽 flex +
// 百分比定位的指示器，宽度自适应、动画曲线一致。
//
// [Bug Fix] 指示器定位：旧实现用等分百分比（width = 100/n%，left = idx*seg%），
// 但容器是 w-fit（收缩到内容刚好），flex-1 的 grow 无多余空间可分配 → 按钮按各自
// 文字 min-content 宽度排列、彼此不等宽（实测「原始/720p/1080p」= 40/44.78/51.81px）。
// 等分百分比的指示器中心与不等宽按钮中心错开 ~2.8px，文字看起来没在玻璃方框正中。
// 改为用 useLayoutEffect 读取激活按钮的 offsetLeft/offsetWidth 作为指示器的
// 实际像素位置/宽度，并配 ResizeObserver 在容器 resize（字体加载/窗口缩放）时
// 重测 —— 指示器精确覆盖激活按钮，文字永远居中，同时保留滑动动画与紧凑宽度。
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
  const activeIdx = Math.max(0, options.findIndex(o => o.key === value))

  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  // 指示器像素位置/宽度。首帧为 0，useLayoutEffect 在 paint 前修正，避免闪现。
  const [ind, setInd] = useState({ left: 0, width: 0 })

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const btn = btnRefs.current[activeIdx]
    if (!wrap || !btn) return
    const update = (): void => {
      setInd({ left: btn.offsetLeft, width: btn.offsetWidth })
    }
    update()
    // 容器尺寸变化（字体迟到加载、窗口缩放、父级布局）时重测，保证指示器始终贴合按钮。
    const ro = new ResizeObserver(update)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [activeIdx, options.length])

  return (
    <div
      ref={wrapRef}
      className={`relative inline-flex w-fit select-none items-center rounded-lg border border-bd bg-surface-2 p-0.5 ${SIZE_WRAP[size]} ${className}`}
    >
      {/* 玻璃滑动指示器：像素级贴合激活按钮 */}
      <span
        className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-md bg-surface-1 shadow-sm"
        style={{
          transform: `translateX(${ind.left}px)`,
          width: `${ind.width}px`,
          transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1), width 300ms cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      />
      {options.map((o, i) => {
        const active = o.key === value
        return (
          <button
            key={o.key}
            ref={el => { btnRefs.current[i] = el }}
            type="button"
            onClick={() => onChange(o.key)}
            title={o.title}
            className={`relative z-10 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md transition-colors duration-200 ${SIZE_BTN[size]} ${
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
