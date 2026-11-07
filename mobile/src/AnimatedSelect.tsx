import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { reducedMotion, usePresence } from './Motion'

type Option<T> = { value: T; label: string }
const OPEN_MS = 420, CLOSE_MS = 260
const easeOut = 'cubic-bezier(.215,.61,.355,1)'

/** One anchored option menu in both the course filter and settings. Focus
 * stays on its combobox, so the enclosing sheet retains its normal Tab order. */
export function AnimatedSelect<T extends string | number>({ label, value, options, disabled = false, onChange, className = '' }: {
  label: string; value: T; options: readonly Option<T>[]; disabled?: boolean
  onChange: (value: T) => void; className?: string
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const motion = useRef<Animation | null>(null)
  const started = useRef(false)
  const gesture=useRef<{x:number;y:number;scroll:number;option:Element|null;moved:boolean}|null>(null)
  const revealActive=useRef(true)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const presence = usePresence(open ? true : null, CLOSE_MS + 20)
  const selected = Math.max(0, options.findIndex(option => option.value === value))
  const openMenu = () => { if (!disabled) { revealActive.current=true; setActive(selected); setOpen(true) } }
  const choose = (index: number) => {
    setOpen(false)
    trigger.current?.focus({preventScroll:true})
    const option = options[index]
    if (option && option.value !== value) onChange(option.value)
  }
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  // Native Back can arrive on the first visible frame, before passive effects.
  useLayoutEffect(() => {
    if (!open) return
    const back = (event: Event) => { event.preventDefault(); setOpen(false) }
    const dismiss = () => setOpen(false)
    const anchor = trigger.current!.getBoundingClientRect()
    const scrolled = (event: Event) => {
      if (event.target instanceof Node && list.current?.contains(event.target)) return
      const current = trigger.current?.getBoundingClientRect()
      // Focus/scrollIntoView can deliver an already-completed scroll after
      // the click. Dismiss only when the control has actually moved away.
      if (!current || Math.abs(current.top-anchor.top)>1 || Math.abs(current.left-anchor.left)>1) dismiss()
    }
    window.addEventListener('sjtu-popup-back', back)
    window.addEventListener('resize', dismiss)
    window.visualViewport?.addEventListener('resize', dismiss)
    window.addEventListener('scroll', scrolled, true)
    return () => {
      window.removeEventListener('sjtu-popup-back', back)
      window.removeEventListener('resize', dismiss)
      window.visualViewport?.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', scrolled, true)
    }
  }, [open])
  useLayoutEffect(() => {
    if (!presence.value) { started.current = false; return }
    const node = menu.current!, button = trigger.current!
    const anchor = button.getBoundingClientRect()
    const current = started.current ? {
      left: getComputedStyle(node).left, top: getComputedStyle(node).top,
      width: getComputedStyle(node).width, height: getComputedStyle(node).height,
      borderRadius: getComputedStyle(node).borderRadius, opacity: getComputedStyle(node).opacity
    } : null
    motion.current?.cancel()
    const viewport = window.visualViewport
    const leftEdge = (viewport?.offsetLeft ?? 0) + 12, topEdge = (viewport?.offsetTop ?? 0) + 12
    const rightEdge = leftEdge + (viewport?.width ?? innerWidth) - 24
    const bottomEdge = topEdge + (viewport?.height ?? innerHeight) - 24
    const width = Math.min(rightEdge - leftEdge, Math.max(220, anchor.width))
    const below = bottomEdge - anchor.bottom - 8, above = anchor.top - topEdge - 8
    const upward = below < Math.min(options.length * 48 + 16, 300) && above > below
    // Measure wrapped labels rather than assuming every row is 48px high.
    node.style.width=width+'px'
    node.style.height='auto'
    const naturalHeight=list.current!.scrollHeight
    const height = Math.min(naturalHeight, 368, Math.max(48, upward ? above : below), bottomEdge-topEdge)
    const left = Math.min(rightEdge - width, Math.max(leftEdge, anchor.right - width))
    const top = upward ? Math.max(topEdge, anchor.top - height - 8) : Math.min(bottomEdge - height, anchor.bottom + 8)
    Object.assign(node.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' })
    const closed = {
      left:anchor.left+'px',top:anchor.top+'px',width:anchor.width+'px',height:anchor.height+'px',
      borderRadius:'12px',opacity:'0'
    }
    // The surface and its shadow share the same animated bounds. No clip-path
    // cuts the shadow off or reveals it abruptly at the end of the animation.
    const opened = {left:left+'px',top:top+'px',width:width+'px',height:height+'px',borderRadius:'24px',opacity:'1'}
    const exiting = presence.phase === 'exit'
    started.current = true
    const to = exiting ? closed : opened
    const entries = Array.from(list.current!.children) as HTMLElement[]
    const animations: Animation[] = []
    const settle = () => {
      motion.current?.cancel(); motion.current = null
      Object.assign(node.style, exiting ? closed : opened)
      animations.forEach(animation => animation.cancel())
      entries.forEach(entry => { entry.style.opacity = exiting ? '0' : '1'; entry.style.transform = 'none' })
    }
    if (reducedMotion() || !node.animate) settle()
    else {
      Object.assign(node.style, to)
      const frames = exiting ? [current ?? opened, closed] : [current ?? closed, opened]
      const animation = node.animate(frames, { duration: exiting ? CLOSE_MS : OPEN_MS, easing: easeOut })
      animation.id = 'select-surface'; motion.current = animation
      entries.forEach((entry, index) => {
        const from = getComputedStyle(entry)
        const opacity = current ? from.opacity : '0', transform = current ? from.transform : 'translateY(-8px)'
        entry.style.opacity = exiting ? '0' : '1'; entry.style.transform = 'none'
        const fade = entry.animate([{ opacity, transform }, { opacity: exiting ? 0 : 1, transform: exiting ? 'translateY(-4px)' : 'none' }], {
          duration: exiting ? 140 : 240, delay: exiting ? 0 : Math.min(90, Math.abs(index-selected)*14), easing: easeOut, fill: 'backwards'
        })
        fade.id = 'select-option'; animations.push(fade)
      })
      void animation.finished.then(() => { if (motion.current === animation) settle() }).catch(() => {})
    }
    const preference = () => { if (reducedMotion()) settle() }
    window.addEventListener('sjtu-motion-preference', preference)
    return () => {
      window.removeEventListener('sjtu-motion-preference', preference)
      const style = getComputedStyle(node)
      const presented = { left:style.left, top:style.top, width:style.width, height:style.height, borderRadius:style.borderRadius, opacity:style.opacity }
      const rows = entries.map(entry => ({ opacity: getComputedStyle(entry).opacity, transform: getComputedStyle(entry).transform }))
      motion.current?.cancel(); motion.current = null
      Object.assign(node.style, presented)
      animations.forEach(animation => animation.cancel())
      entries.forEach((entry, index) => Object.assign(entry.style, rows[index]))
    }
  }, [presence.value, presence.phase])
  useLayoutEffect(() => {
    if (!open || !revealActive.current) return
    const parent = list.current, row = parent?.querySelector<HTMLElement>('[data-active=true]')
    if (!parent || !row) return
    if (row.offsetTop < parent.scrollTop) parent.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > parent.scrollTop + parent.clientHeight)
      parent.scrollTop = row.offsetTop + row.offsetHeight - parent.clientHeight
  }, [active, open, presence.value])
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Tab') { setOpen(false); return }
    if (event.key === 'Escape' && presence.value) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); return
    }
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation()
      if (!open) { openMenu(); return }
      if (event.key === 'Enter' || event.key === ' ') choose(active)
      else { revealActive.current=true; setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? options.length-1 :
        Math.max(0, Math.min(options.length-1, index + (event.key === 'ArrowUp' ? -1 : 1)))) }
    }
  }
  return <div className={'animated-select ' + className}>
    <button ref={trigger} type="button" className="select-trigger" role="combobox" aria-label={label}
      aria-expanded={open} aria-haspopup="listbox" aria-controls={presence.value ? id : undefined}
      aria-activedescendant={open ? id+'-'+active : undefined} data-value={String(value)} disabled={disabled}
      onKeyDown={keyDown} onClick={() => open ? setOpen(false) : openMenu()}>
      <span>{options[selected]?.label ?? String(value)}</span><Icon name="right" size={16}/>
    </button>
    {presence.value && createPortal(<div className="select-overlay" data-phase={presence.phase}
      onPointerDownCapture={event => {
        gesture.current={x:event.clientX,y:event.clientY,scroll:list.current?.scrollTop??0,
          option:(event.target as Element).closest('[role=option]'),moved:false}
      }}
      onClickCapture={event=>{
        const anchor=trigger.current?.getBoundingClientRect()
        const onAnchor=anchor&&event.clientX>=anchor.left&&event.clientX<=anchor.right&&
          event.clientY>=anchor.top&&event.clientY<=anchor.bottom
        if(event.target===event.currentTarget||onAnchor){
          event.preventDefault();event.stopPropagation()
          // Dismiss only once the tap's click has been dispatched. Dismissing
          // on pointerdown lets Android retarget touchend/click to the exposed
          // trigger, which immediately reopens the menu during its exit.
          if(!gesture.current?.moved)setOpen(false)
        }
      }}
      onPointerMoveCapture={event=>{
        const start=gesture.current
        if(start&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>8)start.moved=true
      }}
      onPointerCancel={()=>{if(gesture.current)gesture.current.moved=true}}>
      <div ref={menu} className="select-menu" inert={!open}>
        <div ref={list} className="select-options" onScroll={()=>{if(gesture.current)gesture.current.moved=true}} id={id} role="listbox" aria-label={label}>
          {options.map((option, index) => <div key={String(option.value)} id={id+'-'+index} role="option"
            aria-selected={value === option.value} data-active={active === index} className="select-option"
            onPointerDown={event => {if(event.pointerType==='mouse')event.preventDefault()}}
            onPointerMove={event => {if(event.pointerType==='mouse'&&!event.buttons){revealActive.current=false;setActive(index)}}}
            onClick={event => {
              const start=gesture.current
              if(event.detail!==0&&(!start||start.moved||start.option!==event.currentTarget||Math.abs((list.current?.scrollTop??0)-start.scroll)>2))return
              choose(index)
            }}>
            <span>{option.label}</span><Icon name="check" size={18} className={value === option.value ? '' : 'select-check-hidden'}/>
          </div>)}
        </div>
      </div>
    </div>, document.body)}
  </div>
}
