import { useModalScrollLock, usePresence } from './Motion'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

type Options = { title: string; message: string; confirmLabel: string; destructive?: boolean }
type Pending = Options & { resolve: (accepted: boolean) => void }
const Context = createContext<{
  confirm: (options: Options) => Promise<boolean>
  dismissConfirmation: () => boolean
} | null>(null)

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const presence=usePresence(pending)
  const current = useRef<Pending | null>(null)
  const finish = useCallback((accepted: boolean) => {
    const old = current.current
    if (!old) return false
    current.current = null
    setPending(null)
    old.resolve(accepted)
    return true
  }, [])
  const confirm = useCallback(
    (options: Options) =>
      new Promise<boolean>(resolve => {
        current.current?.resolve(false)
        const next = { ...options, resolve }
        current.current = next
        setPending(next)
      }),
    []
  )
  const dismissConfirmation = useCallback(() => finish(false), [finish])
  return (
    <Context.Provider value={{ confirm, dismissConfirmation }}>
      {children}
      {presence.value && <ConfirmationDialog request={presence.value} motionPhase={presence.phase} finish={finish} />}
    </Context.Provider>
  )
}
function ConfirmationDialog({ request, finish, motionPhase }: { request: Pending; finish: (accepted: boolean) => boolean; motionPhase:string }) {
  useModalScrollLock()
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    root.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        finish(false)
      } else if (event.key === 'Tab') {
        const controls = root.current?.querySelectorAll<HTMLButtonElement>('button')
        if (!controls?.length) return
        const target = event.shiftKey ? controls[0] : controls[controls.length - 1]
        if (document.activeElement === target) {
          event.preventDefault()
          ;(event.shiftKey ? controls[controls.length - 1] : controls[0]).focus()
        }
      }
    }
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('keydown', key, true)
      previous?.focus({ preventScroll: true })
    }
  }, [finish])
  return createPortal(
    <div
      className="confirmation-scrim" data-motion={motionPhase}
      onPointerDown={event => {
        if (event.target === event.currentTarget) finish(false)
      }}
    >
      <section
        ref={root}
        className="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        aria-describedby="confirmation-message"
      >
        <span className="confirmation-icon">
          <Icon name={request.destructive ? 'alert' : 'shield'} size={28} />
        </span>
        <h2 id="confirmation-title">{request.title}</h2>
        <p id="confirmation-message">{request.message}</p>
        <div className="confirmation-actions">
          <button type="button" className="text-button" onClick={() => finish(false)}>
            取消
          </button>
          <button
            type="button"
            className={'button ' + (request.destructive ? 'button--danger' : 'button--filled')}
            onClick={() => finish(true)}
          >
            {request.confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  )
}
export function useConfirmation() {
  const value = useContext(Context)
  if (!value) throw new Error('ConfirmationProvider missing')
  return value
}
