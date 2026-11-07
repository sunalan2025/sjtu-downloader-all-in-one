import { reminderCategory, allDaySettings, syncSettings, settingsRoot, settleSettings } from './ui-settings.mjs'
import {chromium} from 'playwright'
import {preview} from 'vite'
import sharp from 'sharp'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {mockNative} from './ui-fixtures.mjs'
const server=await preview({root:fileURLToPath(new URL('..',import.meta.url)),preview:{host:'127.0.0.1',port:4182,strictPort:true}})
const browser=await chromium.launch({executablePath:process.env.UI_TEST_BROWSER||undefined,headless:true,args:['--no-sandbox']})
const out=fileURLToPath(new URL('../ui-results/',import.meta.url));await fs.mkdir(out,{recursive:true})
async function settle(page){
 await page.waitForFunction(()=>document.documentElement.dataset.viewMoving!=='true')
 await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))))
}
try{
 for(const profile of [{width:320,height:740},{width:390,height:844},{width:844,height:390},{width:1280,height:800}]){
  const page=await browser.newPage({viewport:profile,hasTouch:true,isMobile:profile.width<1000});page.setDefaultTimeout(15000)
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await mockNative(page)
  await page.addInitScript(()=>{
   const start=document.startViewTransition.bind(document)
   document.startViewTransition=(...args)=>window.__vt=start(...args)
   const original=window.Capacitor.nativePromise
   window.Capacitor.nativePromise=async(plugin,method,args)=>{
    const result=await original(plugin,method,args)
    if(['calendarWeek','calendarWeekOfficial'].includes(method)&&result.items?.length){
     const date=result.items[0].startTime.slice(0,10)
     return {...result,items:[...result.items.map((item,index)=>index===0?{...item,title:'程序设计思想与方法（计算机科学与技术）',location:'东中院二号楼 204 教室'}:item),
      ...[['12:00','12:10'],['12:15','12:25']].map(([start,end],index)=>({id:'personal-short-'+index,title:'短日程'+index,type:'event',startTime:date+'T'+start+':00+08:00',endTime:date+'T'+end+':00+08:00'}))]}
    }
    return result
   }
  })
  await page.goto('http://127.0.0.1:4182');await page.getByText('界面测试账号',{exact:true}).waitFor()
  // Assert rendered pixels during the transition: DOM visibility alone misses
  // navigation hidden underneath the top-layer content snapshot.
  for(const tab of ['课程','日历','下载']){
   await page.getByRole('button',{name:tab,exact:true}).click();await page.evaluate(()=>window.__vt.ready)
   await page.evaluate(()=>document.getAnimations().filter(a=>a.effect?.pseudoElement?.includes('view-transition')).forEach(a=>{a.pause();a.currentTime=120}))
   const dock=await page.locator('.bottom-dock').evaluate(n=>({r:n.getBoundingClientRect().toJSON(),color:getComputedStyle(n).backgroundColor}))
   const expected=dock.color.match(/\d+/g).slice(0,3).map(Number)
   const shot=await page.screenshot()
   const point={left:Math.round(dock.r.x+Math.min(40,dock.r.width/2)),top:Math.round(dock.r.bottom-4),width:1,height:1}
   const pixel=await sharp(shot).extract(point).raw().toBuffer()
   assert.ok(expected.every((channel,index)=>Math.abs(channel-pixel[index])<=2),'navigation disappeared behind the page snapshot: '+tab)
   await fs.writeFile(out+'/nav-transition-'+profile.width+'-'+tab+'.png',shot)
   await page.evaluate(()=>document.getAnimations().forEach(a=>{try{a.finish()}catch{}}));await settle(page)
  }
  await page.getByRole('button',{name:/通知与后台同步/}).click();await settle(page)
  await reminderCategory(page)
  const select=page.getByRole('combobox',{name:'课程提前时间',exact:true}),saved=await select.getAttribute('data-value')
  await select.scrollIntoViewIfNeeded()
  const session=await page.context().newCDPSession(page)
  async function tapAnchor(hold=0){const b=await select.boundingBox(),x=b.x+b.width/2,y=b.y+b.height/2
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]})
   if(hold)await page.waitForTimeout(hold)
   await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  }
  // Hold pointerdown long enough for the old implementation to expose the
  // trigger, then release: its synthetic click used to reopen the popup.
  for(const hold of [0,100,180]){
   await tapAnchor();await settle(page);assert.equal(await select.getAttribute('aria-expanded'),'true')
   await tapAnchor(hold)
   await page.waitForFunction(()=>document.querySelector('.select-overlay')?.dataset.phase==='exit')
   const exit=await page.locator('.select-menu').evaluate(node=>{
    const a=node.getAnimations().find(a=>a.id==='select-surface');a.pause();a.currentTime=0;const start={height:node.getBoundingClientRect().height,opacity:+getComputedStyle(node).opacity};a.currentTime=130;const middle={height:node.getBoundingClientRect().height,opacity:+getComputedStyle(node).opacity};a.finish();return{start,middle}
   })
   assert.ok(exit.middle.height<exit.start.height&&exit.middle.opacity<exit.start.opacity,'second tap replayed the opening animation')
   await page.locator('.select-overlay').waitFor({state:'detached'});await page.waitForTimeout(350)
   assert.equal(await select.getAttribute('aria-expanded'),'false','touch release reopened the closing menu')
  }
  assert.equal(await select.getAttribute('data-value'),saved)
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'})
  await page.getByRole('button',{name:'日历',exact:true}).click();await settle(page)
  const scale=()=>page.locator('.week-timetable-grid').evaluate(n=>parseFloat(getComputedStyle(n).getPropertyValue('--week-hour-px')))
  const initial=await scale();assert.ok(initial>=64)
  const checkCards=async()=>{
   const cards=await page.locator('.week-time-event[data-density=full]').evaluateAll(nodes=>nodes.map(n=>({id:n.title,client:n.clientHeight,scroll:n.scrollHeight})))
   assert.ok(cards.length>=2);for(const card of cards)assert.ok(card.scroll<=card.client+2,'course text clipped vertically: '+JSON.stringify(card))
   const short=page.locator('.week-time-event').filter({hasText:/短日程/});assert.equal(await short.count(),2,'short, separate events were merged into a false overlap')
   const a=await short.nth(0).boundingBox(),b=await short.nth(1).boundingBox();assert.ok(a.y+a.height<b.y,'short event cards overlap')
  }
  await checkCards()
  if(profile.width===390){
   await page.addStyleTag({content:'.week-time-event[data-density=full] strong{font-size:24px!important;line-height:1.5!important;}'})
   await page.setViewportSize({width:390,height:650});await page.waitForTimeout(150)
   await checkCards();assert.ok(await scale()>initial,'larger text did not expand the time axis')
   await page.setViewportSize({width:844,height:390});await page.waitForTimeout(150)
   await checkCards();assert.ok(await scale()<initial,'landscape timeline did not adapt to the wider columns')
  }
  await page.locator('.week-timetable-grid').screenshot({path:out+'/adaptive-week-'+profile.width+'.png'})
  assert.deepEqual(errors,[]);await page.close();console.log('PASS: visible navigation mid-transition, real touch close/reverse, adaptive timetable',profile.width,profile.height)
 }
}finally{await browser.close();await server.httpServer.close()}
