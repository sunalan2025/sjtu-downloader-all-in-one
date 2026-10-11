import type React from 'react'

export interface BreadcrumbItem {
  id: string
  label: string
  icon?: React.ReactNode
}

export function BreadcrumbBar({
  items,
  onNavigate
}: {
  items: BreadcrumbItem[]
  onNavigate: (id: string) => void
}) {
  return (
    <nav className="flex items-center gap-1.5 py-1.5 text-xs text-text-3 font-medium select-none">
      {items.map((it, idx) => {
        const isLast = idx === items.length - 1
        return (
          <div key={it.id} className="flex items-center gap-1.5">
            {idx > 0 && <span className="text-text-4 font-mono">/</span>}
            <button
              type="button"
              disabled={isLast}
              onClick={() => onNavigate(it.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors ${
                isLast
                  ? 'font-bold text-text-1 cursor-default'
                  : 'text-text-3 hover:bg-surface-2 hover:text-text-1 cursor-pointer'
              }`}
            >
              {it.icon}
              <span className="truncate max-w-[200px]">{it.label}</span>
            </button>
          </div>
        )
      })}
    </nav>
  )
}
