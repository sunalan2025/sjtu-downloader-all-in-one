import { useCallback, useEffect, useRef, useState } from 'react'

/** Restart the deadline even when the same action produces the same message. */
export function useTransientMessage(duration = 4000) {
  const [entry, setEntry] = useState({ text: '', expires: 0 })
  const timer = useRef<number | undefined>(undefined)
  const setMessage = useCallback((text: string) => {
    window.clearTimeout(timer.current)
    setEntry({ text, expires: Date.now() + duration })
  }, [duration])
  useEffect(() => {
    if (!entry.text) return
    const expire = () => {
      const remaining=entry.expires-Date.now()
      if(remaining>0){timer.current=window.setTimeout(expire,remaining);return}
      setEntry(old => old === entry ? { text: '', expires: 0 } : old)
    }
    timer.current = window.setTimeout(expire, Math.max(0, entry.expires - Date.now()))
    document.addEventListener('visibilitychange', expire)
    return () => { window.clearTimeout(timer.current); document.removeEventListener('visibilitychange', expire) }
  }, [entry])
  return [entry.text, setMessage] as const
}
