import { createContext, useContext } from 'react'
import { Icon, type IconName } from './Icon'

type Page = { id: string; title: string }
export type SettingsNavigation = {
  page: Page; depth: number
  push: (id: string, title: string) => void
  back: () => void
}
export const SettingsNavigationContext = createContext<SettingsNavigation | null>(null)
export function useSettingsNavigation() {
  const value=useContext(SettingsNavigationContext)
  if(!value)throw new Error('Settings navigation is unavailable')
  return value
}
export function SettingsLink({page,title,description,icon='right',disabled=false}:{
  page:string;title:string;description?:string;icon?:IconName;disabled?:boolean
}) {
  const navigation=useSettingsNavigation()
  return <button type="button" className="settings-page-link" data-settings-page={page} disabled={disabled}
    onClick={()=>navigation.push(page,title)}>
    <span><strong>{title}</strong>{description&&<small>{description}</small>}</span><Icon name={icon} size={20}/>
  </button>
}
