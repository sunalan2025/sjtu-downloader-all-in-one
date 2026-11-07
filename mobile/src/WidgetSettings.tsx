import { useTransientMessage } from './TransientMessage'
import { Disclosure, SettingsGroup } from './Motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import native, { type WidgetStatus } from './native'
import { widgetVendorGuide } from './widgetVendorGuide'
import { autoRetry } from './AutoRetry'

export function WidgetSettings() {
  const [status,setStatus]=useState<WidgetStatus|null>(null)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useTransientMessage()
  const request=useRef(0)
  const adding=useRef(false)
  const reload=useCallback(async()=>{
    const id=++request.current
    try{const next=await autoRetry(()=>native.refreshTodayWidget(),()=>id===request.current)
      if(id===request.current)setStatus(next)}catch{
      try{const next=await native.widgetStatus();if(id===request.current)setStatus(next)}catch{/* Keep useful information until the next foreground refresh. */}
    }
  },[])
  useEffect(()=>{
    void reload()
    window.addEventListener('focus',reload)
    window.addEventListener('sjtu-widget-updated',reload)
    return()=>{request.current++;window.removeEventListener('focus',reload);window.removeEventListener('sjtu-widget-updated',reload)}
  },[reload])
  async function add(kind:'daily'|'weekly') {
    if(adding.current)return
    adding.current=true
    setBusy(true);setMessage('')
    try{
      const result=await native.pinTodayWidget({kind})
      setMessage(result.requested?'请在系统弹窗中确认添加。':'请长按桌面空白处，从“小组件”中添加。')
    }catch{setMessage('暂时无法添加，请长按桌面空白处添加小组件。')}
    finally{adding.current=false;setBusy(false);void reload()}
  }
  const guide=widgetVendorGuide(status?.manufacturer||'',status?.brand||'')
  return <div className="widget-settings-content">
    <p className="widget-data-state">{!status?'正在读取…':status.instances>0?'已添加 '+status.instances+' 个桌面小组件':'把日程放到桌面，一眼查看今天和本周安排。'}</p>
    <div className="widget-panel-buttons">
      <button type="button" className="button button--filled" disabled={busy} onClick={()=>void add('daily')}>添加今日日程</button>
      <button type="button" className="button button--filled" disabled={busy} onClick={()=>void add('weekly')}>添加本周课表</button>
    </div>
    <p className="settings-help">今日日程占 2×3 格，本周课表占 4×6 格。日程会自动更新，本周课表可上下滑动查看。</p>
    <p className="settings-help">周六、周日会提前显示下周工作日，同时保留本周末的安排。</p>
    {message&&<p role="status" className="settings-message">{message}</p>}
    {status&&status.courses+status.deadlines===0&&<p className="settings-help">登录后会自动同步学校日程，也可以先添加个人日程。</p>}
    <SettingsGroup title="保持日程更新">
      <p className="settings-help">时间横条通常每分钟更新，亮屏后会补刷；学校日程按同步设置更新。</p>
    </SettingsGroup>
    <Disclosure title="如何添加到桌面">
      <p className="widget-permission-guide">{guide.add}</p>
      <p className="widget-permission-guide">添加后，使用箭头切换日期，上下滑动查看日程。</p>
      <p className="widget-permission-guide">{guide.power}</p>
    </Disclosure>
  </div>
}
