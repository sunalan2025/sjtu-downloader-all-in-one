import { useEffect, useId, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'

export function Page({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-page ${className}`} {...props} />
}
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="ui-page-header">
      <div className="min-w-0">
        <h1 className="ui-page-title">{title}</h1>
        {description && <p className="ui-page-description">{description}</p>}
      </div>
      {actions && <div className="ui-actions">{actions}</div>}
    </header>
  )
}
export function Toolbar({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-toolbar ${className}`} {...props} />
}
const buttonVariants = {
  secondary: 'ui-button-secondary',
  primary: 'ui-button-primary',
  danger: 'ui-button-danger'
}
export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'secondary' | 'primary' | 'danger' }) {
  return <button type={type} className={`ui-button ${buttonVariants[variant]} ${className}`} {...props} />
}
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="ui-empty">
      <h2 className="text-base font-semibold text-text-1">{title}</h2>
      {children && <div className="mt-2 text-sm text-text-2">{children}</div>}
    </div>
  )
}

/** Native modal supplies focus containment, Escape and focus restoration without document-wide listeners. */
export function Dialog({
  title,
  children,
  onClose,
  busy = false,
  actions
}: {
  title: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
  actions?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const dialog = ref.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    dialog?.showModal()
    return () => {
      dialog?.close()
      previouslyFocused?.focus()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className="ui-dialog"
      aria-labelledby={id}
      onCancel={e => {
        e.preventDefault()
        if (!busy) onClose()
      }}
    >
      <div className="ui-dialog-header">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        <Button aria-label="关闭弹窗" disabled={busy} onClick={onClose}>
          ✕
        </Button>
      </div>
      <div className="ui-dialog-body">{children}</div>
      {actions && <div className="ui-dialog-footer">{actions}</div>}
    </dialog>
  )
}
