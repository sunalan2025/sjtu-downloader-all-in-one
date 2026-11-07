import type {CalendarEvent} from './native'

// Personal exam schedule only; never credentials or school authentication tokens.
// A previously verified response can paint immediately after a cold app start
// while the native registrar client validates its session in the background.
const KEY='sjtu-verified-exam-snapshot-v1'
const MAX_AGE=24*60*60*1000
type Snapshot={owner:string;savedAt:number;source:string;items:CalendarEvent[]}

export function readExamSnapshot(owner:string):{items:CalendarEvent[];source:string}|null {
  if(!owner)return null
  try {
    const value=JSON.parse(localStorage.getItem(KEY)||'null') as Snapshot|null
    if(!value||value.owner!==owner||!Number.isFinite(value.savedAt)||
       value.savedAt>Date.now()+60_000||Date.now()-value.savedAt>MAX_AGE||
       !Array.isArray(value.items))return null
    return {items:value.items.filter(item=>
      item && typeof item.title==='string' &&
      typeof item.startTime==='string' && typeof item.endTime==='string' &&
      item.type==='exam' && typeof item.id==='string').slice(0,150),
      source:typeof value.source==='string'?value.source:''}
  }catch{return null}
}

export function saveExamSnapshot(owner:string,source:string,items:CalendarEvent[]):void {
  if(!owner)return
  try {
    localStorage.setItem(KEY,JSON.stringify({
      owner,savedAt:Date.now(),source,
      items:items.filter(item=>item.type==='exam').slice(0,150)
    } satisfies Snapshot))
  }catch{/* Disabled storage only affects the instant preview. */}
}

export function clearExamSnapshot():void {
  try{localStorage.removeItem(KEY)}catch{}
}
