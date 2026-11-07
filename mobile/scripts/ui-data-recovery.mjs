import { chromium } from 'playwright'
import { preview } from 'vite'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { mockNative } from './ui-fixtures.mjs'
const server=await preview({root:fileURLToPath(new URL('..',import.meta.url)),preview:{host:'127.0.0.1',port:4180,strictPort:true}})
const browser=await chromium.launch({executablePath:process.env.UI_TEST_BROWSER||undefined,headless:true,args:['--no-sandbox']})
try{
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});page.setDefaultTimeout(15000)
  await page.clock.install({time:new Date('2026-11-06T02:00:00Z')})
  await mockNative(page,{recurringWeeks:true,schoolEvents:false})
  await page.addInitScript(()=>{
    window.__homeDays=10
    const original=window.Capacitor.nativePromise
    window.__calendarUnavailable=true;window.__calendarPhase='初次';window.__delayCourses=0
    window.Capacitor.nativePromise=async(plugin,method,args)=>{
      if(method==='courses'&&window.__delayCourses)await new Promise(r=>setTimeout(r,window.__delayCourses))
      const result=await original(plugin,method,args)
      if(['calendarWeek','calendarWeekOfficial'].includes(method)){
        if(window.__calendarUnavailable)return {...result,items:[],connected:false,officialConnected:false}
        return {...result,items:result.items.map(item=>({...item,title:window.__calendarPhase+item.title}))}
      }
      return result
    }
  })
  await page.goto('http://127.0.0.1:4180')
  await page.getByText('界面测试账号',{exact:true}).waitFor()
  await page.waitForFunction(()=>window.__calls.filter(c=>c.method==='calendarWeek').length>=4)
  assert.equal(await page.locator('.recent-agenda-item').count(),0)
  await page.evaluate(()=>{
    window.__calendarUnavailable=false
    window.__listeners['SjtuCanvas:calendarSessionReady']({})
  })
  await page.waitForFunction(()=>document.querySelectorAll('.recent-agenda-item').length>=Number(window.__homeDays))
  assert.ok((await page.locator('.recent-agenda-item').first().innerText()).includes('初次'))
  await page.evaluate(()=>window.__calendarPhase='已更新')
  await page.clock.fastForward(13*60000)
  await page.locator('.recent-agenda-item').filter({hasText:'已更新'}).first().waitFor()
  // Cancel a course-list response that is still in flight during logout.
  await page.evaluate(()=>{window.__delayCourses=3000;window.dispatchEvent(new Event('focus'))})
  await page.getByRole('button',{name:'退出账号',exact:true}).click()
  await page.getByRole('alertdialog').getByRole('button',{name:'退出账号',exact:true}).click()
  await page.clock.fastForward(4000)
  const login=page.getByRole('button',{name:/交我办登录/});await login.waitFor()
  assert.equal(await login.isEnabled(),true,'cancelled course load left login disabled')
  assert.equal(await page.locator('.recent-agenda-item').count(),0)
  console.log('PASS: calendar authorization recovery updates Home, foreground refresh updates Home, logout cancels course load')
}finally{await browser.close();await server.httpServer.close()}
