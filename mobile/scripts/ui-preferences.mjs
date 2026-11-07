import {chromium} from 'playwright'
import {preview} from 'vite'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import fs from 'node:fs/promises'
import {mockNative} from './ui-fixtures.mjs'
import {settingsRoot,reminderCategory,settleSettings,syncSettings} from './ui-settings.mjs'
const server=await preview({root:fileURLToPath(new URL('..',import.meta.url)),preview:{host:'127.0.0.1',port:4183,strictPort:true}})
const browser=await chromium.launch({executablePath:process.env.UI_TEST_BROWSER||undefined,headless:true,args:['--no-sandbox']})
const out=fileURLToPath(new URL('../ui-results/',import.meta.url));await fs.mkdir(out,{recursive:true})
try{
 for(const viewport of [{width:320,height:740},{width:844,height:390},{width:1280,height:800}]){
  const page=await browser.newPage({viewport,hasTouch:true,isMobile:viewport.width<1000});page.setDefaultTimeout(15000)
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await mockNative(page,{notificationsAllowed:false,grantNotifications:true})
  await page.goto('http://127.0.0.1:4183');await page.getByText('界面测试账号',{exact:true}).waitFor()
  await page.getByRole('button',{name:'下载',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.viewMoving!=='true')
  await page.getByRole('button',{name:/通知与后台同步/}).click();await settleSettings(page)
  assert.equal(await page.getByRole('switch',{name:/开启日程提醒/}).isChecked(),false)
  assert.equal(await page.getByRole('combobox').count(),0,'disabled reminders expose subsettings')
  assert.equal(await page.locator('.settings-sheet [data-settings-page=categories]').isVisible(),false)
  const initial=await page.locator('.settings-sheet').boundingBox()
  await syncSettings(page)
  assert.equal(await page.getByRole('combobox',{name:'同步间隔',exact:true}).count(),0)
  await page.getByRole('switch',{name:/定期同步学校日程/}).check();await settleSettings(page)
  await page.getByRole('combobox',{name:'同步间隔',exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.method==='requestAgendaPermission').length),0)
  await settingsRoot(page)
  const master=page.getByRole('switch',{name:/开启日程提醒/})
  assert.equal(await master.isDisabled(),true);assert.equal(await master.isChecked(),false)
  assert.equal(await page.locator('.settings-sheet [data-settings-page=permissions]').count(),0,'duplicate permission route in reminder settings')
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'})
  assert.equal(await page.getByRole('button',{name:/^系统权限/}).count(),1)
  await page.getByRole('button',{name:/^系统权限/}).click();await settleSettings(page)
  await page.getByRole('button',{name:'允许通知',exact:true}).click();await page.getByText('已允许系统通知',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.method==='requestAgendaPermission').length),1)
  await page.evaluate(()=>window.__listeners['App:backButton']({canGoBack:true}));await page.getByRole('dialog').waitFor({state:'detached'})
  await page.getByRole('button',{name:/通知与后台同步/}).click();await settleSettings(page)
  assert.equal(await master.isChecked(),false,'granting permission unexpectedly enabled reminders')
  await reminderCategory(page)
  const select=page.getByRole('combobox',{name:'课程提前时间',exact:true});const saved=await select.getAttribute('data-value')
  await page.getByRole('switch',{name:/^课程/}).uncheck();await settleSettings(page)
  assert.equal(await select.count(),0,'disabled category exposes its time selector')
  await page.getByRole('switch',{name:/^课程/}).check();await settleSettings(page)
  assert.equal(await select.getAttribute('data-value'),saved)
  const after=await page.locator('.settings-sheet').boundingBox();assert.ok(Math.abs(initial.height-after.height)<1,'navigating settings changed the outer frame height')
  await page.screenshot({path:out+'/preferences-category-'+viewport.width+'.png'})
  await settingsRoot(page);await page.screenshot({path:out+'/preferences-home-'+viewport.width+'.png'})
  // Closing must approach the final transparent state, for X and native Back,
  // with the scrim using the same duration as the surface.
  for(const way of ['close','back']){
   const proof=await page.locator('.settings-sheet').evaluate(async(node,way)=>{
    if(way==='close')node.querySelector('[aria-label="关闭设置"]').click()
    else window.__listeners['App:backButton']({canGoBack:true})
    await new Promise(requestAnimationFrame)
    const surface=node.getAnimations().find(a=>a.id==='container-surface'),scrim=node.parentElement.getAnimations().find(a=>a.id==='container-scrim')
    surface.pause();scrim.pause()
    const duration=surface.effect.getTiming().duration
    surface.currentTime=duration*.999;scrim.currentTime=duration*.999
    const result={opacity:+getComputedStyle(node).opacity,background:getComputedStyle(node.parentElement).backgroundColor,duration,scrimDuration:scrim.effect.getTiming().duration,end:surface.effect.getKeyframes().at(-1).opacity}
    surface.finish();scrim.finish();return result
   },way)
   assert.equal(proof.duration,proof.scrimDuration)
   assert.ok(proof.opacity<.01,'settings disappeared from an opaque last frame')
   assert.ok(Number(proof.background.match(/[\d.]+/g).at(-1))<.01,'scrim did not finish with the sheet')
   assert.equal(+proof.end,0)
   await page.getByRole('dialog').waitFor({state:'detached'})
   if(way==='close'){await page.getByRole('button',{name:/通知与后台同步/}).click();await settleSettings(page)}
  }
  await page.getByRole('button',{name:'课程',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.viewMoving!=='true')
  const session=await page.context().newCDPSession(page)
  async function touch(type,x,y){await session.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]})}
  async function fastAbove(selector){
   const rows=page.locator(selector);await rows.nth(1).evaluate(node=>node.scrollIntoView({block:'center'}));await page.evaluate(()=>new Promise(requestAnimationFrame))
   const row=await rows.nth(1).boundingBox(),x=row.x+row.width*.55,y=row.y+row.height/2
   await touch('touchStart',x,y);await page.waitForTimeout(500);await touch('touchEnd',x,y)
   const above=await rows.first().boundingBox(),ax=above.x+above.width*.5,ay=above.y+above.height/2
   // No 350ms pause: the first legitimate tap immediately after long press must work.
   const held=await page.locator(selector+'.row-selected').count()
   await touch('touchStart',ax,ay);await touch('touchEnd',ax,ay)
   console.log('Immediate upper-row gesture',viewport.width,selector,{held,upper:above.y,hold:row.y,selected:await page.locator(selector+'.row-selected').count()})
   await page.waitForFunction(selector=>document.querySelectorAll(selector+'.row-selected').length===2,selector)
  }
  await fastAbove('[data-course-id]')
  await page.getByRole('button',{name:'完成',exact:true}).click()
  await page.getByRole('button',{name:/高等数学 A/}).click()
  await page.locator('[data-file-id]').first().waitFor();await page.waitForFunction(()=>document.documentElement.dataset.viewMoving!=='true');await settleSettings(page);await fastAbove('[data-file-id]')
  assert.deepEqual(errors,[]);await page.close();console.log('PASS: separate conditional preferences, centralized permissions, seamless close and immediate upper-row selection',viewport.width,viewport.height)
 }
}finally{await browser.close();await server.httpServer.close()}
