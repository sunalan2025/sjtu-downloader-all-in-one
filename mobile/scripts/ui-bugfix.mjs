import { reminderCategory, allDaySettings, syncSettings, settingsRoot, settleSettings } from './ui-settings.mjs'
import { chromium } from 'playwright'
import { preview } from 'vite'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { mockNative } from './ui-fixtures.mjs'
const server=await preview({root:fileURLToPath(new URL('..',import.meta.url)),preview:{host:'127.0.0.1',port:4179,strictPort:true}})
const browser=await chromium.launch({executablePath:process.env.UI_TEST_BROWSER||undefined,headless:true,args:['--no-sandbox']})
const out=fileURLToPath(new URL('../ui-results/',import.meta.url));await fs.mkdir(out,{recursive:true})
async function settle(page){
  await page.waitForFunction(()=>document.documentElement.dataset.viewMoving!=='true')
  await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))))
}
async function touch(session,type,x,y){await session.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1,radiusX:3,radiusY:3}]})}
try{
  for(const viewport of [{width:320,height:740},{width:844,height:390},{width:1280,height:800}]){
    const context=await browser.newContext({viewport,hasTouch:true,isMobile:viewport.width<1000})
    const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message))
    await mockNative(page,{recurringWeeks:true})
    await page.addInitScript(()=>{
      const date=new Date(Date.now()+8*3600000),weekday=date.getUTCDay()||7;window.__homeDays=15-weekday
      const original=window.Capacitor.nativePromise
      window.__widgetInFlight=0;window.__widgetMax=0
      window.Capacitor.nativePromise=async(plugin,method,args)=>{
        if(method==='updateTodayWidget'){
          window.__widgetMax=Math.max(window.__widgetMax,++window.__widgetInFlight)
          try{await new Promise(r=>setTimeout(r,100));const result=await original(plugin,method,args);window.__persistedWidget=args;return result}
          finally{window.__widgetInFlight--}
        }
        if(method==='saveAgendaSettings')await new Promise(r=>setTimeout(r,500))
        return original(plugin,method,args)
      }
    })
    await page.goto('http://127.0.0.1:4179')
    await page.getByText('界面测试账号',{exact:true}).waitFor()
    await page.waitForFunction(()=>document.querySelectorAll('.recent-agenda-item').length>=Number(window.__homeDays))
    console.log('Home loaded',viewport.width)
    const dates=await page.locator('.recent-day').count()
    assert.equal(dates,await page.evaluate(()=>window.__homeDays),'Home did not stop at next Sunday')
    await page.waitForFunction(()=>window.__widgetInFlight===0)
    assert.equal(await page.evaluate(()=>window.__widgetMax),1,'native widget snapshots wrote concurrently')
    const repeated=await page.evaluate(()=>{
      const calls=window.__calls.filter(c=>c.method==='updateTodayWidget')
      return calls.at(-1).args.items.filter(row=>row.id==='official:recurring-0').map(row=>row.startMs)
    })
    assert.ok(new Set(repeated).size>=3,'widget bridge dropped later weekly occurrences')
    // Narrow portrait and short landscape must show native time fields in full.
    await page.getByRole('button',{name:'日历',exact:true}).click();await settle(page)
    await page.getByRole('button',{name:/添加 .* 的个人日程/}).click();await settle(page)
    const dialog=page.getByRole('dialog',{name:'新建日程'})
    for(const label of ['开始','结束']){
      const input=dialog.getByLabel(label,{exact:true});await input.scrollIntoViewIfNeeded()
      const bounds=await input.evaluate(node=>{
        const r=node.getBoundingClientRect(),p=node.closest('.schedule-modal').getBoundingClientRect(),c=node.closest('.motion-collapse').getBoundingClientRect()
        return{x:r.left,right:r.right,width:r.width,height:r.height,parent:p.toJSON(),clip:c.toJSON()}
      })
      assert.ok(bounds.x>=bounds.parent.x&&bounds.right<=bounds.parent.right&&bounds.width>=130&&bounds.height>=54,'time input clipped horizontally')
      assert.ok(bounds.x>=bounds.clip.x&&bounds.right<=bounds.clip.right,'collapsible clipped the time input')
    }
    await dialog.getByLabel('日程标题').fill('回归测试日程')
    await dialog.getByLabel('开始',{exact:true}).fill('16:30');await dialog.getByLabel('结束',{exact:true}).fill('15:00')
    await dialog.getByRole('button',{name:'保存日程'}).click()
    await dialog.getByText('结束时间必须晚于开始时间').waitFor()
    await dialog.getByLabel('结束',{exact:true}).fill('17:30')
    await dialog.getByRole('button',{name:'保存日程'}).click();await dialog.waitFor({state:'detached'})
    console.log('Form passed',viewport.width)
    await page.getByRole('button',{name:'下载',exact:true}).click();await settle(page)
    await page.getByRole('button',{name:'清除历史',exact:true}).click()
    await page.getByRole('alertdialog').getByRole('button',{name:'清除历史',exact:true}).click()
    const notice=page.locator('.notice');await notice.waitFor()
    const layout=await page.locator('.page-heading').boundingBox()
    await notice.waitFor({state:'detached',timeout:5500})
    assert.equal((await page.locator('.page-heading').boundingBox()).y,layout.y,'notice moved page content')
    await page.getByRole('button',{name:/桌面日程小组件/}).click();await settle(page)
    const buttons=page.locator('.widget-panel-buttons button')
    const colors=await buttons.evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).backgroundColor))
    assert.equal(colors[0],colors[1],'widget add buttons disagree')
    await buttons.first().click();await page.locator('.settings-message').waitFor()
    await page.waitForTimeout(4300);assert.equal(await page.locator('.settings-message').count(),0,'transient settings prompt remained')
    await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'})
    await page.getByRole('button',{name:/通知与后台同步/}).click();await settle(page)
    await reminderCategory(page)
    const select=page.getByRole('combobox',{name:'课程提前时间',exact:true})
    await select.scrollIntoViewIfNeeded();await select.click();await settle(page)
    const anchor=await select.boundingBox()
    await page.mouse.click(anchor.x+anchor.width/2,anchor.y+anchor.height/2)
    await page.locator('.select-overlay').waitFor({state:'detached'})
    assert.equal(await select.getAttribute('aria-expanded'),'false','second physical anchor tap did not dismiss')
    await select.click();await settle(page)
    await page.getByRole('option',{name:'提前 30 分钟',exact:true}).click()
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(800)
    assert.equal(await select.getAttribute('data-value'),'30','focus reload discarded an in-flight settings save')
    await allDaySettings(page)
    const hours=page.getByRole('combobox',{name:'全天日程时间',exact:true})
    await hours.scrollIntoViewIfNeeded();const value=await hours.getAttribute('data-value')
    await hours.click();await settle(page)
    const session=await context.newCDPSession(page),list=page.locator('.select-options'),box=await list.boundingBox()
    const x=box.x+box.width/2,y=box.y+box.height*.75
    await touch(session,'touchStart',x,y)
    for(let i=1;i<=12;i++){await touch(session,'touchMove',x,y-i*Math.min(9,(box.height*.55)/12));await page.waitForTimeout(20)}
    await touch(session,'touchEnd',x,y)
    await page.waitForTimeout(300)
    assert.equal(await hours.getAttribute('data-value'),value,'drag selected an option')
    assert.equal(await hours.getAttribute('aria-expanded'),'true','drag dismissed the option list')
    await page.keyboard.press('Escape');await page.locator('.select-overlay').waitFor({state:'detached'})
    await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'})
    await page.getByRole('button',{name:'课程',exact:true}).click();await settle(page)
    console.log('Menus passed',viewport.width)
    const rows=page.locator('[data-course-id]')
    const first=rows.nth(0);await first.scrollIntoViewIfNeeded()
    const start=await first.boundingBox(),tx=start.x+start.width*.55,ty=start.y+start.height/2
    await touch(session,'touchStart',tx,ty);await page.waitForTimeout(490)
    assert.equal(await page.locator('[data-course-id].row-selected').count(),1)
    const after=await first.boundingBox()
    assert.equal(after.y,start.y,'selection toolbar shifted the course rows')
    assert.equal(after.height,start.height,'selection checkbox changed course row height')
    await touch(session,'touchMove',tx,ty+1);await page.waitForTimeout(200)
    assert.equal(await page.locator('[data-course-id].row-selected').count(),1,'stationary held finger selected another row')
    await touch(session,'touchEnd',tx,ty);await page.waitForTimeout(400)
    await page.getByRole('button',{name:'完成',exact:true}).click()
    await page.getByRole('button',{name:/高等数学 A/}).click();await settle(page)
    const file=page.locator('[data-file-id]').first();await file.waitFor();await file.scrollIntoViewIfNeeded()
    const fb=await file.boundingBox(),fx=fb.x+fb.width*.55,fy=fb.y+fb.height/2
    await touch(session,'touchStart',fx,fy);await page.waitForTimeout(490)
    const fa=await file.boundingBox();assert.equal(fa.y,fb.y,'selection toolbar shifted files');assert.equal(fa.height,fb.height)
    await touch(session,'touchMove',fx,fy+1)
    assert.equal(await page.locator('[data-file-id].row-selected').count(),1)
    await touch(session,'touchEnd',fx,fy);await page.waitForTimeout(400)
    await page.screenshot({path:out+'/bugfix-'+viewport.width+'.png'})
    assert.deepEqual(errors,[])
    await context.close();console.log('Interaction/data regression PASS',viewport.width,viewport.height)
  }
  // Cold offline startup must preserve the native school's last snapshot.
  const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(15000)
  await page.clock.install({time:new Date('2026-11-08T15:59:30Z')})
  await mockNative(page,{recurringWeeks:true})
  await page.addInitScript(()=>{
    const original=window.Capacitor.nativePromise
    const date=new Date(Date.now()+8*3600000),weekday=date.getUTCDay()||7;window.__homeDays=15-weekday
    window.__offline=true;window.__statusDelay=0
    window.Capacitor.nativePromise=async(plugin,method,args)=>{
      if(method==='status'){
        if(window.__offline)throw new Error('Temporary offline')
        const result=await original(plugin,method,args)
        if(window.__statusDelay)await new Promise(r=>setTimeout(r,window.__statusDelay))
        return result
      }
      return original(plugin,method,args)
    }
  })
  await page.goto('http://127.0.0.1:4179')
  await page.waitForFunction(()=>window.__calls.some(c=>c.method==='updateTodayWidget'))
  assert.ok(await page.evaluate(()=>window.__calls.filter(c=>c.method==='updateTodayWidget').every(c=>!c.args.clear&&c.args.preserveSchool)), 'cold offline startup cleared native cached lessons')
  await page.evaluate(()=>window.__offline=false)
  await page.clock.fastForward(21000);await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await page.getByText('界面测试账号',{exact:true}).waitFor()
  await page.waitForFunction(()=>document.querySelectorAll('.recent-agenda-item').length>=Number(window.__homeDays))
  const before=await page.evaluate(()=>window.__calls.filter(c=>c.method==='calendarWeek').map(c=>c.args.weekStart).sort().at(-1))
  await page.clock.fastForward(60000)
  await page.evaluate(()=>window.__homeDays=14)
  await page.waitForFunction(old=>window.__calls.filter(c=>c.method==='calendarWeek').some(c=>c.args.weekStart>old),before)
  await page.waitForFunction(()=>document.querySelectorAll('.recent-agenda-item').length>=Number(window.__homeDays))
  // A profile check started before logout must not sign the user back in.
  await page.evaluate(()=>window.__statusDelay=1200)
  await page.clock.fastForward(21000);await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await page.getByRole('button',{name:'退出账号',exact:true}).click()
  await page.getByRole('alertdialog').getByRole('button',{name:'退出账号',exact:true}).click()
  await page.clock.fastForward(2000)
  await page.getByRole('button',{name:/交我办登录/}).waitFor()
  assert.equal(await page.locator('.recent-agenda-item').count(),0,'old account responses repainted Home after logout')
  await page.waitForFunction(()=>window.__calls.filter(c=>c.method==='updateTodayWidget').at(-1)?.args.clear===true)
  await page.close();console.log('PASS: cold offline cache preservation, Shanghai midnight refresh, stale profile after logout')
}finally{await browser.close();await server.httpServer.close()}
