import { SettingsGroup } from './Motion'
import { Icon } from './Icon'
import type { Appearance, DeviceAppearance } from './MaterialTheme'
export { readAppearance, storeAppearance } from './MaterialTheme'
export type { Appearance } from './MaterialTheme'

export function AppearanceSettings({
  value,
  device,
  onChange
}: {
  value: Appearance
  device: DeviceAppearance
  onChange: (value: Appearance) => void
}) {
  return (
    <>
      <div className="theme-preview" aria-label="当前主题预览">
        <div className="theme-preview-top">
          <span className="theme-preview-mark">
            <Icon name="palette" size={24} />
          </span>
          <span>
            <strong>你的校园，你的色彩</strong>
            <small>跟随你的喜好</small>
          </span>
        </div>
        <div className="theme-preview-cards">
          <span />
          <span />
          <span />
        </div>
        <div className="theme-preview-controls">
          <span />
          <i />
          <i />
        </div>
      </div>
      <SettingsGroup title="显示模式">
        <div className="theme-mode-options" role="radiogroup" aria-label="显示模式">
          {(
            [
              { id: 'system', text: '跟随系统', icon: 'device' },
              { id: 'light', text: '浅色', icon: 'sun' },
              { id: 'dark', text: '深色', icon: 'moon' }
            ] as const
          ).map(item => (
            <button
              type="button"
              role="radio"
              aria-checked={value.theme === item.id}
              className={'theme-mode' + (value.theme === item.id ? ' chosen' : '')}
              key={item.id}
              onClick={() => onChange({ ...value, theme: item.id })}
            >
              <Icon name={item.icon} size={24} />
              <span>{item.text}</span>
              {value.theme === item.id && <Icon name="check" className="theme-mode-check" size={16} />}
            </button>
          ))}
        </div>
      </SettingsGroup>
      <SettingsGroup title="主题颜色">
        <p className="settings-help">整套界面、导航、卡片和控件会随主题颜色协调变化。</p>
        <div className="accent-options" role="radiogroup" aria-label="界面点缀色">
          {(
            [
              { id: 'system', text: '系统取色', color: device.systemSeed || '#007aff' },
              { id: 'ocean', text: '海蓝', color: '#007aff' },
              { id: 'jade', text: '青玉', color: '#008577' },
              { id: 'iris', text: '鸢紫', color: '#7955b5' }
            ] as const
          ).map(item => (
            <button
              type="button"
              role="radio"
              aria-checked={value.accent === item.id}
              className={'accent-option' + (value.accent === item.id ? ' chosen' : '')}
              key={item.id}
              onClick={() => onChange({ ...value, accent: item.id })}
            >
              <span className="accent-swatch" style={{ background: item.color }}>
                {value.accent === item.id && <Icon name="check" size={19} />}
              </span>
              {item.text}
            </button>
          ))}
        </div>
        <p className="settings-help">
          {device.systemSeed ? '已使用手机的主题颜色。' : '当前手机暂不支持系统取色，使用海蓝。'}
        </p>
      </SettingsGroup>
      <section className="settings-group">
        <label className="settings-toggle-row">
          <span>
            <strong>减少动态效果</strong>
            <small>关闭页面过渡、导航滑动和弹窗动效</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={value.reducedEffects}
            onChange={event => onChange({ ...value, reducedEffects: event.target.checked })}
          />
        </label>
        <p className="settings-help">也会遵循系统的减少动态效果设置。</p>
      </section>
    </>
  )
}
