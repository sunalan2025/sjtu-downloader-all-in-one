import { Children, useEffect, useLayoutEffect, useRef, useId, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Icon } from './Icon'
export const reducedMotion = () =>
  document.documentElement.dataset.effects === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
/** The CSS fallback and View Transitions are mutually exclusive for the
 * entire document lifetime, not just while a snapshot is being animated. */
export function configureMotion() {
  const root = document.documentElement
  const engine = reducedMotion() ? 'reduced' : typeof document.startViewTransition === 'function' ? 'view-transition' : 'css'
  const previous = root.dataset.motionEngine
  if (previous && previous !== engine)
    for (const node of document.querySelectorAll<HTMLElement>('.screen-motion,.course-screen,.calendar-panel-transition'))
      node.dataset.motionComplete = 'true'
  root.dataset.motionEngine = engine
  if(previous!==engine)window.dispatchEvent(new Event('sjtu-motion-preference'))
  return engine
}
let active: ViewTransition | undefined
let pendingChanges: Array<() => void> = []
let waitingForCapture = false
/** Coalesce rapid state changes into one captured update. Network work starts
 * inside its update, so a fast response can never be cleared by a late capture. */
export function withMotion(change: () => void) {
  if (configureMotion() !== 'view-transition') {
    change()
    return
  }
  pendingChanges.push(change)
  if (waitingForCapture) return
  active?.skipTransition()
  waitingForCapture = true
  document.documentElement.dataset.viewMoving = 'true'
  const next = document.startViewTransition(() => {
    waitingForCapture = false
    const changes = pendingChanges.splice(0)
    flushSync(() => changes.forEach(update => update()))
  })
  active = next
  void next.ready.catch(() => {})
  void next.finished
    .catch(() => {})
    .finally(() => {
      if (active === next) {
        active = undefined
        delete document.documentElement.dataset.viewMoving
      }
    })
}
export function usePresence<T>(value: T | null, exitDuration = 210) {
  const [saved, setSaved] = useState(value)
  useLayoutEffect(() => {
    if (value !== null) {
      setSaved(value)
      return
    }
    if (saved === null) return
    if (reducedMotion()) {
      setSaved(null)
      return
    }
    const timer = window.setTimeout(() => setSaved(null), exitDuration)
    return () => window.clearTimeout(timer)
  }, [value, exitDuration])
  return { value: value ?? saved, phase: value === null ? 'exit' : 'enter' } as const
}
let lockCount = 0,
  previousOverflow = ''
export function useModalScrollLock(enabled = true) {
  useEffect(() => {
    if (!enabled) return
    if (lockCount++ === 0) {
      previousOverflow = document.documentElement.style.overflow
      document.documentElement.style.overflow = 'hidden'
    }
    return () => {
      if (--lockCount === 0) document.documentElement.style.overflow = previousOverflow
    }
  }, [enabled])
}
/** Sheets retain their own container transform. Inline folds follow the
 * FlClash/Prism pattern: top-aligned size + travelling/fading entries. */
export const disclosureEase = 'cubic-bezier(.22,1,.36,1)'
const unfoldEase = 'cubic-bezier(.215,.61,.355,1)'
const foldEase = 'cubic-bezier(.55,.055,.675,.19)'
export const SHEET_EXIT_MS = 300
export function Collapsible({ open, children, className = '', id }: { open: boolean; children: ReactNode; className?: string; id?: string }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const animation = useRef<Animation | null>(null)
  const mounted = useRef(false)
  const target = useRef(open)
  target.current = open
  useLayoutEffect(() => {
    const node = outer.current!, content = inner.current!
    const indicator = id ? document.querySelector<SVGElement>(`[aria-controls="${CSS.escape(id)}"]>svg`) : null
    if (indicator) indicator.style.transition = 'none'
    const entries = Array.from(content.querySelectorAll<HTMLElement>('[data-unfold-entry]'))
    if (!entries.length) entries.push(...Array.from(content.children) as HTMLElement[])
    let fades: Animation[] = [], lastTarget = -1
    const cancel = () => {
      animation.current?.cancel(); animation.current = null
      fades.forEach(a => a.cancel()); fades = []
    }
    const settle = () => {
      cancel()
      node.style.height = target.current ? 'auto' : '0px'
      node.style.opacity = '1'
      node.style.visibility = target.current ? 'visible' : 'hidden'
      if (indicator) indicator.style.rotate = target.current ? '90deg' : '0deg'
      entries.forEach(entry => {
        entry.style.opacity = target.current ? '1' : '0'
        entry.style.transform = target.current ? 'none' : 'translateY(-24px)'
      })
    }
    const animate = () => {
      if (reducedMotion() || typeof node.animate !== 'function') { settle(); return }
      // Read the presented height *before* canceling an interrupted animation.
      const from = node.getBoundingClientRect().height
      const to = target.current ? content.getBoundingClientRect().height : 0
      lastTarget = to
      const rows = entries.map(entry => ({ opacity: getComputedStyle(entry).opacity, transform: getComputedStyle(entry).transform }))
      const rotation = indicator ? getComputedStyle(indicator).rotate : '0deg'
      node.style.height = from + 'px'
      cancel()
      node.style.height = to + 'px'
      node.style.opacity = '1'
      node.style.visibility = 'visible'
      if (Math.abs(to-from) < .5) { settle(); return }
      const motion = node.animate([
        { height: from + 'px' }, { height: to + 'px' }
      ], { duration: target.current ? 360 : 300, easing: target.current ? unfoldEase : foldEase })
      motion.id = 'disclosure-height'
      animation.current = motion
      if (indicator) {
        const to = target.current ? '90deg' : '0deg'
        indicator.style.rotate = to
        const turn = indicator.animate([{ rotate: rotation }, { rotate: to }], {
          duration: target.current ? 360 : 300, easing: target.current ? unfoldEase : foldEase
        })
        turn.id = 'disclosure-chevron'; fades.push(turn)
      }
      const visible = Math.max(1, Math.min(content.offsetHeight, innerHeight - node.getBoundingClientRect().top))
      entries.forEach((entry, index) => {
        const distance = Math.min(1, Math.abs(entry.offsetTop + entry.offsetHeight / 2 - visible / 2) / (visible / 2))
        const folded = `translateY(-${Math.min(48, entry.offsetTop + entry.offsetHeight / 2)}px)`
        entry.style.opacity = target.current ? '1' : '0'
        entry.style.transform = target.current ? 'none' : folded
        const fade = entry.animate([rows[index], { opacity: target.current ? 1 : 0, transform: target.current ? 'none' : folded }], {
          duration: target.current ? 240 : 220, delay: target.current ? distance * 80 : 0,
          easing: target.current ? unfoldEase : foldEase, fill: 'backwards'
        })
        fade.id = 'disclosure-entry'; fades.push(fade)
      })
      void motion.finished.then(() => {
        if (animation.current === motion) settle()
      }).catch(() => {})
    }
    if (!mounted.current) { mounted.current = true; settle() } else animate()
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (target.current && animation.current && Math.abs(content.getBoundingClientRect().height-lastTarget) > 1) animate()
    })
    resize?.observe(content)
    const preference = () => { if (reducedMotion()) settle() }
    window.addEventListener('sjtu-motion-preference', preference)
    return () => {
      resize?.disconnect()
      window.removeEventListener('sjtu-motion-preference', preference)
      // Preserve the current presentation through an open/close state update.
      const height = node.getBoundingClientRect().height
      const rows = entries.map(entry => ({ opacity: getComputedStyle(entry).opacity, transform: getComputedStyle(entry).transform }))
      const rotation = indicator ? getComputedStyle(indicator).rotate : '0deg'
      cancel()
      node.style.height = height + 'px'
      if (indicator) indicator.style.rotate = rotation
      entries.forEach((entry, index) => Object.assign(entry.style, rows[index]))
    }
  }, [open])
  return <div ref={outer} id={id} className={'motion-collapse ' + className + (open ? ' is-open' : '')}
    aria-hidden={!open} inert={!open}>
    <div ref={inner} className="motion-collapse-inner">{children}</div>
  </div>
}
/** Header, chevron and retained controls share a single unfolding surface. */
export function Disclosure({ title, children, initialOpen = false, group = false }: { title: string; children: ReactNode; initialOpen?: boolean; group?: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  const id = useId()
  const heading = <button type="button" className="disclosure-trigger" aria-expanded={open} aria-controls={id}
    onClick={() => setOpen(value => !value)}>
    <span>{title}</span><Icon name="right" size={18} />
  </button>
  return <section className={group ? 'settings-group settings-disclosure settings-disclosure--group' : 'settings-disclosure'} data-expanded={open}>
    {group ? <h3>{heading}</h3> : heading}
    <Collapsible open={open} id={id}><div className="disclosure-content">
      {Children.toArray(children).map((child, index) => <div data-unfold-entry key={index}>{child}</div>)}
    </div></Collapsible>
  </section>
}
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <Disclosure title={title} initialOpen group>{children}</Disclosure>
}
export function MotionProvider({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    configureMotion()
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      configureMotion()
    }
    media.addEventListener('change', update)
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-effects'] })
    return () => {
      media.removeEventListener('change', update)
      observer.disconnect()
    }
  }, [])
  useEffect(() => {
    const press = (event: PointerEvent | KeyboardEvent) => {
      if (reducedMotion() || (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key))) return
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null
      if (!target || target.disabled) return
      target
        .getAnimations()
        .filter(a => a.id === 'press')
        .forEach(a => a.cancel())
      if (!target.matches('.select-trigger,.disclosure-trigger')) {
        const animation = target.animate([{ scale: '1' }, { scale: '.96', offset: 0.35 }, { scale: '1' }], {
          duration: 300,
          easing: 'cubic-bezier(.2,0,0,1)'
        })
        animation.id = 'press'
      }
      if (event instanceof PointerEvent) {
        if (getComputedStyle(target).position === 'static') target.style.position = 'relative'
        target.classList.add('motion-press-target')
        const rect = target.getBoundingClientRect(),
          size = Math.max(rect.width, rect.height) * 2
        const wave = document.createElement('span')
        wave.className = 'press-wave'
        wave.setAttribute('aria-hidden', 'true')
        Object.assign(wave.style, {
          width: size + 'px',
          height: size + 'px',
          left: event.clientX - rect.left - size / 2 + 'px',
          top: event.clientY - rect.top - size / 2 + 'px'
        })
        target.append(wave)
        const ripple = wave.animate(
          [
            { transform: 'scale(0)', opacity: 0.16 },
            { transform: 'scale(1)', opacity: 0 }
          ],
          { duration: 480, easing: 'cubic-bezier(.2,0,0,1)' }
        )
        void ripple.finished.catch(() => {}).finally(() => wave.remove())
      }
    }
    document.addEventListener('pointerdown', press, true)
    document.addEventListener('keydown', press, true)
    return () => {
      document.removeEventListener('pointerdown', press, true)
      document.removeEventListener('keydown', press, true)
    }
  }, [])
  return <>{children}</>
}
