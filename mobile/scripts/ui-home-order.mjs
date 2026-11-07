import {chromium} from 'playwright'
import {preview} from 'vite'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {mockNative} from './ui-fixtures.mjs'
const server=await preview({root:fileURLToPath(new URL('..',import.meta.url)),preview:{host:'127.0.0.1',port:4184,strictPort:true}})
const browser=await chromium.launch({executablePath:process.env.UI_TEST_BROWSER||undefined,headless:true,args:['--no-sandbox']})
try{
 for(const date of ['2026-11-02','2026-11-06','2026-11-08','2026-12-31']){
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});page.setDefaultTimeout(15000)
  await page.clock.install({time:new Date(date+'T12:00:00+08:00')})
  await mockNative(page,{recurringWeeks:true})
  await page.addInitScript(()=>{
   const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date())
   const offset=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10)
   const weekday=new Date(today+'T12:00:00Z').getUTCDay()||7
   const week=offset(today,1-weekday),next=offset(week,7),end=offset(week,13)
   window.__bounds={today,week,next,end,currentEnd:offset(week,6),days:15-weekday}
   window.__trace=[];window.__dateFrames=[]
   new MutationObserver(()=>{
    const dates=[...document.querySelectorAll('.recent-day')].map(n=>n.dataset.date)
    if(dates.length)window.__dateFrames.push(dates)
   }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-date']})
   const original=window.Capacitor.nativePromise
   window.Capacitor.nativePromise=async(plugin,method,args)=>{
    if(method==='calendarWeek'){
     window.__trace.push({week:args.weekStart,phase:'start',time:performance.now()})
     await new Promise(r=>setTimeout(r,args.weekStart===week?180:args.weekStart===next?850:20))
     const value=await original(plugin,method,args)
     window.__trace.push({week:args.weekStart,phase:'done',time:performance.now()})
     return value
    }
    if(method==='exams')return {connected:true,source:'学校',items:[
     {id:'exam:inside',title:'范围内考试',courseName:'范围内',type:'exam',startTime:end+'T16:00:00+08:00',endTime:end+'T17:00:00+08:00'},
     {id:'exam:outside',title:'范围外考试',courseName:'范围外',type:'exam',startTime:offset(end,1)+'T16:00:00+08:00',endTime:offset(end,1)+'T17:00:00+08:00'}]}
    return original(plugin,method,args)
   }
  })
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto('http://127.0.0.1:4184')
  await page.waitForFunction(()=>window.__trace.some(r=>r.week===window.__bounds.next&&r.phase==='start'))
  const early=await page.evaluate(()=>({bounds:window.__bounds,dates:[...document.querySelectorAll('.recent-day')].map(n=>n.dataset.date)}))
  assert.ok(early.dates.every(day=>day<=early.bounds.currentEnd),'next week appeared before the earlier week finished')
  await page.waitForFunction(()=>document.querySelectorAll('.recent-day').length===window.__bounds.days)
  await page.waitForFunction(()=>window.__trace.filter(r=>r.phase==='done').length===4)
  const result=await page.evaluate(()=>({trace:window.__trace,frames:window.__dateFrames,bounds:window.__bounds,dates:[...document.querySelectorAll('.recent-day')].map(n=>n.dataset.date),text:document.querySelector('.recent-agenda').innerText}))
  const starts=result.trace.filter(row=>row.phase==='start')
  assert.equal(starts.length,4,'Home fetched redundant calendar neighbor weeks')
  assert.deepEqual(starts.map(r=>r.week),[0,7,14,21].map(n=>new Date(Date.parse(result.bounds.week+'T00:00:00Z')+n*86400000).toISOString().slice(0,10)))
  for(let i=1;i<starts.length;i++)assert.ok(starts[i].time>=result.trace.find(r=>r.week===starts[i-1].week&&r.phase==='done').time,'a later week request overtook the previous week')
  for(const frame of result.frames){assert.deepEqual(frame,[...frame].sort());assert.ok(frame.every(day=>day>=result.bounds.today&&day<=result.bounds.end),'a day past next Sunday flashed on Home')}
  assert.equal(result.dates.at(-1),result.bounds.end)
  assert.ok(result.text.includes('范围内考试'));assert.ok(!result.text.includes('范围外'))
  await page.waitForFunction(()=>window.__calls.filter(c=>c.method==='updateTodayWidget').some(c=>c.args.items.some(i=>i.startMs>Date.parse(window.__bounds.end+'T23:59:59+08:00'))))
  assert.deepEqual(errors,[]);await page.close();console.log('PASS: ordered week loading and next-Sunday range, with future widget cache preserved',date)
 }
}finally{await browser.close();await server.httpServer.close()}
