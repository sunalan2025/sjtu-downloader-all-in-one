import { useCallback, useEffect, useRef, useState } from 'react'
import native, {type AgendaStatus,type WidgetStatus} from './native'
import { useTransientMessage } from './TransientMessage'
import { widgetVendorGuide } from './widgetVendorGuide'

/** All Android permission requests and OS-settings links live on this page. */
export function PermissionsSettings() {
  const [agenda,setAgenda]=useState<AgendaStatus|null>(null)
  const [widget,setWidget]=useState<WidgetStatus|null>(null)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useTransientMessage()
  const request=useRef(0),working=useRef(false)
  const reload=useCallback(async()=>{
    const id=++request.current
    const [a,w]=await Promise.allSettled([native.agendaSettings(),native.widgetStatus()])
    if(id!==request.current)return
    if(a.status==='fulfilled')setAgenda(a.value)
    if(w.status==='fulfilled')setWidget(w.value)
  },[])
  useEffect(()=>{
    void reload()
    const visible=()=>{if(!document.hidden)void reload()}
    window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible)
    return()=>{request.current++;window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible)}
  },[reload])
  async function action(operation:()=>Promise<unknown>) {
    if(working.current)return
    working.current=true;setBusy(true);setMessage('')
    try{
      await operation();await reload()
      window.dispatchEvent(new Event('sjtu-permissions-updated'))
    }catch{setMessage('暂时无法打开，请从手机设置中找到本应用。')}
    finally{working.current=false;setBusy(false)}
  }
  const guide=widgetVendorGuide(widget?.manufacturer||'',widget?.brand||'')
  return <div className="permissions-content">
    <p className="settings-intro">系统通知、准时更新和后台运行都在这里设置，按需要开启即可。</p>
    {message&&<p role="status" className="settings-message">{message}</p>}
    <section className="settings-group">
      <h3>通知</h3><p className="permission-state">{!agenda?'正在读取…':agenda.permissionGranted?'已允许系统通知':'尚未允许系统通知'}</p>
      <div className="settings-actions">
        {agenda&&!agenda.permissionGranted&&<button className="button button--filled" disabled={busy} onClick={()=>void action(async()=>{
          const next=await native.requestAgendaPermission();setAgenda(next)
          if(!next.permissionGranted)setMessage('系统尚未允许通知，可在手机的通知设置中开启。')
        })}>允许通知</button>}
        <button className="button button--tonal" disabled={busy} onClick={()=>void action(()=>native.openAgendaNotificationSettings({}))}>通知设置</button>
        <button className="button button--tonal" disabled={busy} onClick={()=>void action(()=>native.openAgendaNotificationSettings({channel:'reminders'}))}>声音与振动</button>
      </div>
      <p className="settings-help">声音、振动和锁屏显示由手机通知设置控制。{agenda&&!agenda.channelEnabled?'日程通知当前已关闭，请在声音与振动中开启。':''}</p>
    </section>
    <section className="settings-group">
      <h3>准时提醒与时间横条</h3>
      <p className="permission-state">{!widget?'正在读取…':widget.androidApi<31?'当前系统无需单独设置':widget.exactAlarmAllowed?'已允许准时更新':'尚未允许，时间更新可能稍有延迟'}</p>
      {widget&&widget.androidApi>=31&&!widget.exactAlarmAllowed&&<button className="button button--tonal widget-alarm-action" disabled={busy}
        onClick={()=>void action(()=>native.openWidgetSettings({section:'exactAlarm'}))}>允许准时更新</button>}
      <p className="settings-help">课程提醒和桌面时间横条共用这一项设置，不需要重复开启。</p>
    </section>
    <section className="settings-group">
      <h3>后台运行</h3><p className="permission-state">{!widget?'正在读取…':widget.ignoringBatteryOptimizations?'已允许不受电量限制':'当前按手机的省电规则运行'}</p>
      <button className="button button--tonal" disabled={busy} onClick={()=>void action(()=>native.openWidgetSettings({section:'battery'}))}>后台电量设置</button>
      <p className="settings-help">{guide.power}</p>
    </section>
  </div>
}
