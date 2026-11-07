import { useModalScrollLock, reducedMotion, disclosureEase, SHEET_EXIT_MS } from './Motion'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { SettingsNavigationContext } from './SettingsNavigation'

/** Settings never expand the document behind them or move its scroll anchor. */
export function SettingsSheet({ title, children, onClose, motionPhase, origin }: { title: string; children: ReactNode; onClose: () => void; motionPhase?:string; origin?: HTMLElement | null }) {
  useModalScrollLock()
  const dialog = useRef<HTMLElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const pageFrame = useRef<HTMLDivElement>(null)
  const [pages,setPages]=useState([{id:'root',title}])
  const pagesRef=useRef(pages)
  const scrolls=useRef(new Map<string,number>())
  const returningTo=useRef('')
  const pageDirection=useRef(1)
  const page=pages[pages.length-1]
  const push=(id:string,nextTitle:string)=>{
    const previous=pagesRef.current.at(-1)!
    if(previous.id===id)return
    scrolls.current.set(previous.id,body.current?.scrollTop||0)
    pageDirection.current=1
    const next=[...pagesRef.current,{id,title:nextTitle}]
    pagesRef.current=next;setPages(next)
  }
  const back=()=>{
    if(pagesRef.current.length<=1){close.current();return}
    const previous=pagesRef.current.at(-1)!
    scrolls.current.set(previous.id,body.current?.scrollTop||0)
    returningTo.current=previous.id
    pageDirection.current=-1
    const next=pagesRef.current.slice(0,-1)
    pagesRef.current=next;setPages(next)
  }
  const lastPage=useRef('root')
  useLayoutEffect(()=>{
    if(lastPage.current===page.id)return
    lastPage.current=page.id
    if(body.current)body.current.scrollTop=scrolls.current.get(page.id)||0
    const target=returningTo.current&&body.current?.querySelector<HTMLElement>('[data-settings-page="'+returningTo.current+'"]')
    returningTo.current=''
    ;(target||dialog.current?.querySelector<HTMLElement>('h2'))?.focus({preventScroll:true})
    const node=pageFrame.current
    if(node&&!reducedMotion()){
      const animation=node.animate([{opacity:.72,transform:'translateX('+pageDirection.current*14+'px)'},{opacity:1,transform:'none'}],{duration:220,easing:disclosureEase})
      animation.id='settings-page'
      return()=>animation.cancel()
    }
  },[page.id])
  const close = useRef(onClose)
  close.current = onClose
  const motion = useRef<Animation | null>(null)
  const scrimMotion = useRef<Animation | null>(null)
  const started = useRef(false)
  useLayoutEffect(() => {
    const node = dialog.current!
    const current = started.current ? {
      transform: getComputedStyle(node).transform,
      clipPath: getComputedStyle(node).clipPath,
      opacity: getComputedStyle(node).opacity
    } : null
    const scrimNode=scrim.current!
    const scrimFrom=started.current?getComputedStyle(scrimNode).backgroundColor:'rgba(0, 0, 0, 0)'
    motion.current?.cancel();scrimMotion.current?.cancel()
    node.style.transform = 'none'; node.style.clipPath = 'inset(0px round 28px)'; node.style.opacity = '1'
    const frame = node.getBoundingClientRect()
    const mobile = !window.matchMedia('(min-width:700px) and (min-height:560px)').matches
    const anchor = origin?.isConnected ? origin.getBoundingClientRect() : null
    const anchored = mobile && anchor && anchor.width > 80 && anchor.bottom > 0 && anchor.top < innerHeight
    const scale = anchored ? Math.min(1, anchor.width / frame.width) : .96
    const closed = anchored ? {
      transform: `translate(${anchor.left-frame.left}px,${anchor.top-frame.top}px) scale(${scale})`,
      clipPath: `inset(0px 0px ${Math.max(0,frame.height-anchor.height/scale)}px round ${24/scale}px)`,
      opacity: '0'
    } : {
      transform: `translate(0px,${mobile?24:12}px) scale(.96)`, clipPath: 'inset(0px round 28px)', opacity: '0'
    }
    const opened = {transform:'translate(0px,0px) scale(1)',clipPath:'inset(0px round 28px)',opacity:'1'}
    const exiting = motionPhase === 'exit'
    const to = exiting ? closed : opened
    const scrimTo=exiting?'rgba(0, 0, 0, 0)':'rgba(0, 0, 0, 0.4)'
    const duration=exiting?SHEET_EXIT_MS:340
    const easing=exiting?'cubic-bezier(.4,0,.2,1)':disclosureEase
    const children = Array.from(node.children) as HTMLElement[]
    const fades: Animation[] = []
    const settle = () => {
      motion.current?.cancel(); motion.current = null
      scrimMotion.current?.cancel();scrimMotion.current=null
      scrimNode.style.backgroundColor=scrimTo
      node.style.transform = exiting ? to.transform : 'none'
      node.style.clipPath = exiting ? to.clipPath : 'none'
      node.style.opacity = exiting ? '0' : '1'
      fades.forEach(a=>a.cancel())
      children.forEach(child=>child.style.opacity=exiting?'0':'1')
    }
    if (!reducedMotion() && typeof node.animate === 'function') {
      Object.assign(node.style,to)
      const animation = node.animate([current ?? closed,to], {
        duration,easing
      })
      animation.id = 'container-surface'
      motion.current = animation
      scrimNode.style.backgroundColor=scrimTo
      const background=scrimNode.animate([{backgroundColor:scrimFrom},{backgroundColor:scrimTo}],{duration,easing})
      background.id='container-scrim';scrimMotion.current=background
      for (const child of children) {
        const from = started.current ? getComputedStyle(child).opacity : '0'
        child.getAnimations().filter(a=>a.id==='container-content').forEach(a=>a.cancel())
        child.style.opacity = exiting ? '0' : '1'
        const fade = child.animate([{opacity:from},{opacity:exiting?0:1}],{
          duration: exiting ? 180 : 220,easing:'ease-out'
        })
        fade.id = 'container-content'; fades.push(fade)
      }
      void animation.finished.then(()=>{if(motion.current===animation)settle()}).catch(()=>{})
    } else settle()
    started.current = true
    const preference = () => { if(reducedMotion())settle() }
    const resized = () => settle()
    window.addEventListener('sjtu-motion-preference',preference)
    window.addEventListener('resize',resized)
    return () => {
      window.removeEventListener('sjtu-motion-preference',preference)
      window.removeEventListener('resize',resized)
      const style = getComputedStyle(node)
      const presented = {transform:style.transform,clipPath:style.clipPath,opacity:style.opacity}
      const opacity = children.map(child=>getComputedStyle(child).opacity)
      const background=getComputedStyle(scrimNode).backgroundColor
      motion.current?.cancel(); motion.current=null
      scrimMotion.current?.cancel();scrimMotion.current=null
      scrimNode.style.backgroundColor=background
      Object.assign(node.style,presented)
      fades.forEach(a=>a.cancel())
      children.forEach((child,index)=>child.style.opacity=opacity[index])
    }
  },[motionPhase,origin])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        back()
        return
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') ||
          []
      ).filter(element => element.getClientRects().length > 0 && !element.closest('[inert]'))
      const first = controls[0],
        last = controls.at(-1)
      if (!first) {
        event.preventDefault()
        return
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
        event.preventDefault()
        first.focus()
      }
    }
    const onBack=(event:Event)=>{event.preventDefault();back()}
    window.addEventListener('sjtu-modal-back',onBack)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('sjtu-modal-back',onBack)
      document.removeEventListener('keydown', onKey)
      ;(origin?.isConnected?origin:previous)?.focus({ preventScroll: true })
    }
  }, [])
  return createPortal(
    <SettingsNavigationContext.Provider value={{page,depth:pages.length-1,push,back}}><div ref={scrim}
      className="settings-scrim" data-settings-motion="true" data-motion={motionPhase}
      onPointerDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="settings-sheet" data-container-motion="true" inert={motionPhase==='exit'} role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby="settings-sheet-title" ref={dialog}>
        <header className="settings-sheet-head">
          {pages.length>1&&<button type="button" className="icon-button settings-page-back" aria-label="返回上一级" onClick={back}><Icon name="left" size={20}/></button>}
          <div className="settings-header-title">
            <span>{pages.length>1?title:'偏好设置'}</span>
            <h2 tabIndex={-1} id="settings-sheet-title">{page.id==='root'?title:page.title}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭设置" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </header>
        <div className="settings-sheet-body" ref={body}><div className="settings-page-frame" ref={pageFrame}>
          {children}
        </div></div>
      </section>
    </div></SettingsNavigationContext.Provider>,
    document.body
  )
}
