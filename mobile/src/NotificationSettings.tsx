import { useTransientMessage } from './TransientMessage'
import { autoRetry } from './AutoRetry'
import { AnimatedSelect } from './AnimatedSelect'
import { Collapsible } from './Motion'
import { SettingsLink, useSettingsNavigation } from './SettingsNavigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import native, { type AgendaSettings, type AgendaStatus } from './native'

const timeInput=(minutes:number)=>String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0')
const fromTime=(value:string)=>{const [h,m]=value.split(':').map(Number);return h*60+m}
const dateTime=(value:number)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})
const categories=[
  {kind:'course',label:'课程',options:[0,5,10,15,30,60]},
  {kind:'event',label:'个人与其他日程',options:[0,5,10,15,30,60]},
  {kind:'exam',label:'考试',options:[10,30,60,120,1440]},
  {kind:'homework',label:'作业截止',options:[0,30,60,180,1440,2880,10080]}
] as const
const advance=(minutes:number)=>minutes===0?'开始 / 截止时':minutes>=1440?'提前 '+minutes/1440+' 天':minutes>=60?'提前 '+minutes/60+' 小时':'提前 '+minutes+' 分钟'

export function NotificationSettings({loggedIn}:{loggedIn:boolean}) {
  const navigation=useSettingsNavigation(),page=navigation.page.id
  const [status,setStatus]=useState<AgendaStatus|null>(null)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useTransientMessage()
  const saving=useRef(false),request=useRef(0)
  const reload=useCallback(async()=>{
    if(saving.current)return
    const id=++request.current
    try{const value=await autoRetry(()=>native.agendaSettings(),()=>id===request.current);if(id===request.current)setStatus(value)}
    catch{if(id===request.current)setMessage('暂时无法读取，稍后会自动更新。')}
  },[setMessage])
  useEffect(()=>{
    void reload()
    const visible=()=>{if(!document.hidden)void reload()}
    window.addEventListener('focus',visible);window.addEventListener('sjtu-permissions-updated',visible)
    document.addEventListener('visibilitychange',visible)
    return()=>{request.current++;window.removeEventListener('focus',visible);window.removeEventListener('sjtu-permissions-updated',visible);document.removeEventListener('visibilitychange',visible)}
  },[reload])
  async function save(patch:Partial<AgendaSettings>) {
    if(!status||saving.current)return
    if(patch.enabled===true&&(!status.permissionGranted||!status.channelEnabled)){
      setMessage('请先在偏好设置的系统权限中允许日程通知。');return
    }
    saving.current=true
    const id=++request.current
    setBusy(true);setMessage('')
    try{
      const value=await autoRetry(()=>native.saveAgendaSettings({settings:{...status.settings,...patch}}),()=>id===request.current)
      if(id===request.current)setStatus(value)
    }catch{if(id===request.current)setMessage('设置暂未保存，请稍后再试。')}
    finally{saving.current=false;if(id===request.current)setBusy(false)}
  }
  if(!status)return <div className="settings-loading"><p>{message||'正在读取设置…'}</p></div>
  const allowed=status.permissionGranted&&status.channelEnabled
  const settings={...status.settings,enabled:status.settings.enabled&&allowed}
  const toggle=(key:keyof AgendaSettings,title:string,hint?:string,disabled=false)=><label className="settings-toggle-row" key={key}>
    <span><strong>{title}</strong>{hint&&<small>{hint}</small>}</span>
    <input type="checkbox" role="switch" checked={Boolean(settings[key])} disabled={busy||disabled}
      onChange={event=>void save({[key]:event.target.checked})}/>
  </label>
  const category=categories.find(item=>page==='category-'+item.kind)
  const syncText:Record<string,string>={idle:'尚未执行后台同步',running:'正在同步',success:'学校日程已更新',partial:'部分日程已更新，其余稍后更新',auth:'请返回首页重新登录',network:'暂时无法连接学校，联网后继续更新',deferred:'系统已暂停，稍后会自动继续',rejected:'请在系统权限中允许后台运行'}
  const blocked=!settings.enabled&&(page==='categories'||page==='all-day'||!!category||page==='privacy')
  return <>
    {message&&<p role="status" className="settings-message">{message}</p>}
    {blocked?<p className="settings-intro">日程提醒未开启，请返回上一级开启。</p>
    :page==='categories'?<>
      <p className="settings-intro">按日程种类分别设置，关闭的分类不会发送提醒。</p>
      <div className="settings-page-list">{categories.map(item=>{
        const enabled=Boolean(settings[(item.kind+'Enabled') as keyof AgendaSettings])
        return <SettingsLink key={item.kind} page={'category-'+item.kind} title={item.label+'提醒'} disabled={busy}
          description={enabled?advance(Number(settings[(item.kind+'Minutes') as keyof AgendaSettings])):'未开启'}/>
      })}<SettingsLink page="all-day" title="全天日程" description={'按每天 '+String(settings.allDayHour).padStart(2,'0')+':00 计算提醒'}/></div>
    </>:category?(()=>{
      const enabledKey=(category.kind+'Enabled') as keyof AgendaSettings,minutesKey=(category.kind+'Minutes') as keyof AgendaSettings
      return <section className="settings-group reminder-detail">
        {toggle(enabledKey,category.label,'关闭后保留你的提前时间设置')}
        <Collapsible open={Boolean(settings[enabledKey])}><div data-unfold-entry className="settings-select-row">
          <span>{category.label}提前时间</span><AnimatedSelect label={category.label+'提前时间'} value={Number(settings[minutesKey])}
            disabled={busy||!settings[enabledKey]} onChange={minutes=>void save({[minutesKey]:minutes})}
            options={category.options.map(minutes=>({value:minutes,label:advance(minutes)}))}/>
        </div><p data-unfold-entry className="settings-help">仅影响{category.label}，其他分类的提醒时间保持各自的设置。</p></Collapsible>
      </section>
    })():page==='all-day'?<section className="settings-group">
      <div className="settings-select-row"><span>全天日程按几点计算</span><AnimatedSelect label="全天日程时间" value={settings.allDayHour} disabled={busy}
        onChange={hour=>void save({allDayHour:hour})} options={Array.from({length:24},(_,hour)=>({value:hour,label:String(hour).padStart(2,'0')+':00'}))}/></div>
      <p className="settings-help">全天日程先使用所选时间，再扣除对应分类的提前时间。</p>
    </section>:page==='privacy'?<>
      <section className="settings-group">{toggle('quietEnabled','开启免打扰')}
        <Collapsible open={settings.quietEnabled}>
          <div data-unfold-entry className="settings-select-row"><span>免打扰期间</span><AnimatedSelect label="免打扰处理方式" value={settings.quietMode} disabled={busy||!settings.quietEnabled}
            onChange={mode=>void save({quietMode:mode})} options={[{value:'silent',label:'静默显示通知'},{value:'skip',label:'跳过提醒'}]}/></div>
          <div data-unfold-entry className="settings-time-range">{(['quietStart','quietEnd'] as const).map((key,index)=><label key={key}>{index?'结束':'开始'}
            <input aria-label={index?'免打扰结束':'免打扰开始'} type="time" value={timeInput(settings[key])} disabled={busy||!settings.quietEnabled}
              onChange={event=>{if(event.target.value)void save({[key]:fromTime(event.target.value)})}}/></label>)}</div>
          <p data-unfold-entry className="settings-help">默认静默显示，避免遗漏深夜截止的作业；也可选择跳过。结束后不会集中补发。开始与结束相同表示全天不限制。</p>
        </Collapsible>
      </section>
      <section className="settings-group">{toggle('showContent','通知显示标题与地点')}
        <Collapsible open={settings.showContent}>{toggle('lockScreenDetails','锁屏显示日程详情','关闭时锁屏只显示通用提醒；仍受手机隐私设置控制',!settings.showContent)}</Collapsible>
      </section>
    </>:page==='sync'?<>
      <section className="settings-group">{toggle('backgroundEnabled','定期同步学校日程',loggedIn?'自动更新课程、作业和考试，不依赖通知开关':'登录交大账号后可开启',!loggedIn)}
        <Collapsible open={settings.backgroundEnabled}>
          <div data-unfold-entry className="settings-select-row"><span>同步间隔</span><AnimatedSelect label="同步间隔" value={settings.syncMinutes} disabled={busy||!settings.backgroundEnabled}
            onChange={minutes=>void save({syncMinutes:minutes})} options={[15,30,60,180].map(minutes=>({value:minutes,label:'约每 '+(minutes<60?minutes+' 分钟':minutes/60+' 小时')}))}/></div>
          {toggle('unmeteredOnly','仅在免费网络下同步','例如家中或学校的 Wi-Fi',!settings.backgroundEnabled)}
          {toggle('batteryNotLow','电量不足时暂停',undefined,!settings.backgroundEnabled)}
          <p data-unfold-entry className="settings-help">{syncText[status.syncState]||'稍后自动更新'}{status.lastSyncAt?' · 最近更新：'+dateTime(status.lastSyncAt):''}{status.lastSyncSuccessAt?' · 最近成功：'+dateTime(status.lastSyncSuccessAt):''}</p>
          <p data-unfold-entry className="settings-help">省电或断网时可能延迟，恢复后自动继续。已保存的日程可以离线查看。</p>
        </Collapsible>
      </section>
    </>:<>
      <p className="settings-intro">提醒和后台同步可以分别开启，时间均按北京时间计算。</p>
      <section className="settings-group">{toggle('enabled','开启日程提醒',allowed?'开启后再设置需要提醒的日程':'请先在偏好设置的系统权限中允许日程通知',!allowed)}
        <Collapsible open={settings.enabled}>
          <div data-unfold-entry className="settings-page-list">
            <SettingsLink page="categories" title="分类提醒" description="课程、个人日程、考试与作业" disabled={busy}/>
            <SettingsLink page="privacy" title="免打扰与隐私" description={settings.quietEnabled?'免打扰已开启':'设置安静时段和锁屏内容'} disabled={busy}/>
          </div>
          <p data-unfold-entry className="settings-help">{status.nextReminderAt?'下次提醒：'+dateTime(status.nextReminderAt):'暂无待提醒的日程'}</p>
        </Collapsible>
      </section>
      <div className="settings-page-list"><SettingsLink page="sync" title="后台同步" description={settings.backgroundEnabled?'已开启定期更新':'未开启，可按需要自动更新学校日程'} disabled={busy}/></div>
    </>}
  </>
}
