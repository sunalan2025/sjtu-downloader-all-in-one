import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export function PageHeader({
  title,
  subtitle,
  children,
  className = ''
}: {
  title: string
  subtitle?: string
  children?: ReactNode
  className?: string
}) {
  return (
    <header className={'page-header ' + className}>
      <div className="page-heading">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="page-header-actions">{children}</div>}
    </header>
  )
}
export function IconTile({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <span className={'icon-tile ' + className}>
      <Icon name={name} size={24} />
    </span>
  )
}
export function SettingsEntry({
  title,
  description,
  icon,
  onClick,
  expanded
}: {
  title: string
  description: string
  icon: IconName
  onClick: (trigger: HTMLButtonElement) => void
  expanded?: boolean
}) {
  return (
    <button type="button" className="settings-entry" onClick={event=>onClick(event.currentTarget)} aria-haspopup="dialog" aria-expanded={expanded}>
      <IconTile name={icon} />
      <span className="settings-entry-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <Icon name="right" size={20} />
    </button>
  )
}
