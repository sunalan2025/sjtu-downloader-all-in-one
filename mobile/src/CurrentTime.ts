import { useSyncExternalStore } from 'react'

// One clock for the entire app. Background pages have no minute timer; resume
// immediately corrects all subscribers together, including Shanghai midnight.
let now=Date.now()
let timer:number|undefined
const listeners=new Set<()=>void>()
const snapshot=()=>now
const pulse=()=>{
  window.clearTimeout(timer);timer=undefined
  const current=Date.now()
  if(current!==now){now=current;listeners.forEach(listener=>listener())}
  if(listeners.size&&!document.hidden)timer=window.setTimeout(pulse,60_000-Date.now()%60_000+30)
}
const visibility=()=>{
  if(document.hidden){window.clearTimeout(timer);timer=undefined}else pulse()
}
const focus=()=>{if(!document.hidden)pulse()}
const subscribe=(listener:()=>void)=>{
  listeners.add(listener)
  if(listeners.size===1){
    window.addEventListener('focus',focus)
    document.addEventListener('visibilitychange',visibility)
    pulse()
  }
  return()=>{
    listeners.delete(listener)
    if(!listeners.size){
      window.clearTimeout(timer);timer=undefined
      window.removeEventListener('focus',focus)
      document.removeEventListener('visibilitychange',visibility)
    }
  }
}
export function useCurrentTime():number{return useSyncExternalStore(subscribe,snapshot)}
