import { chromium } from 'playwright'
import { preview } from 'vite'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { mockNative } from './ui-fixtures.mjs'
const server=await preview({root:fileURLToPath(new URL('..',import.meta.url)),preview:{host:'127.0.0.1',port:4176,strictPort:true}})
const browser=await chromium.launch({executablePath:process.env.UI_TEST_BROWSER||undefined,headless:true,args:['--no-sandbox']})
try {
  for (const profile of [{name:'phone',width:390,height:844},{name:'tablet',width:1280,height:800}]) {
    const page=await browser.newPage({viewport:profile})
    const errors=[];page.on('pageerror',e=>errors.push(e.message))
    await page.clock.install({time:new Date('2026-11-05T11:16:00+08:00')})
    await mockNative(page,{progressCases:true})
    await page.goto('http://127.0.0.1:4176')
    await page.getByText('界面测试账号',{exact:true}).waitFor()
    await page.locator('.recent-agenda-item .assignment-status').filter({hasText:'已评分 0/100 分'}).waitFor()
    await page.getByRole('button',{name:'日历',exact:true}).click()
    const line=page.locator('.week-now-line')
    await line.getByText('11:16',{exact:true}).waitFor()
    assert.equal(await line.evaluate(el=>getComputedStyle(el).borderTopStyle),'dashed')
    for(const label of ['已评分 0/100 分','已评分 92.5/100 分','已提交 · 待批改','待提交','已逾期 · 未提交','已批改 A'])
      assert.ok(await page.locator('.week-all-day-chip .assignment-status').filter({hasText:label}).count()>0,label)
    assert.equal(await page.locator('.week-all-day-chip').filter({hasText:'同名练习'}).count(),2,'different course assignments were merged')
    await page.waitForFunction(()=>document.documentElement.dataset.viewMoving!=='true')
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    // Homework loading can increase the lane above the timetable. Measure the
    // line against its time axis, atomically, rather than the screen origin.
    const axisOffset=()=>page.evaluate(()=>document.querySelector('.week-now-line').getBoundingClientRect().top-document.querySelector('.week-hour-lane').getBoundingClientRect().top)
    const before=await axisOffset()
    const hourPixels=await page.locator('.week-timetable-grid').evaluate(n=>parseFloat(getComputedStyle(n).getPropertyValue('--week-hour-px')))
    assert.ok(Math.abs(before-(11*60+16-7*60)/60*hourPixels)<2,'now line is on wrong time axis')
    await page.evaluate(()=>{window.__entrances=0;document.addEventListener('animationstart',e=>{if(e.target.matches?.('.screen-motion,.calendar-panel-transition'))window.__entrances++})})
    await page.clock.runFor(60_050)
    await line.getByText('11:17',{exact:true}).waitFor()
    assert.ok(Math.abs(await axisOffset()-before-hourPixels/60)<.3,'one minute must follow the adaptive time scale')
    assert.equal(await page.evaluate(()=>window.__entrances),0)
    await page.locator('.week-time-event').filter({hasText:'大学物理考试'}).click()
    const detail=page.getByRole('dialog',{name:'日程详情',exact:true})
    await detail.waitFor();assert.equal(await detail.locator('strong').filter({hasText:'大学物理考试'}).count(),1)
    assert.ok(!(await detail.innerText()).includes('考试考试'))
    await page.getByRole('button',{name:'关闭日程详情',exact:true}).click();await detail.waitFor({state:'detached'})
    await page.getByRole('button',{name:'下一周',exact:true}).first().click();await line.waitFor({state:'detached'})
    await page.getByRole('button',{name:'今天',exact:true}).click()
    await page.getByRole('button',{name:'周',exact:true}).click();await line.waitFor()
    await page.clock.setFixedTime(new Date('2026-11-05T23:10:00+08:00'))
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await line.waitFor({state:'detached'})
    await page.clock.setFixedTime(new Date('2026-11-06T00:01:00+08:00'))
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
    await page.locator('.week-day.active strong').getByText('6',{exact:true}).waitFor()
    const payloads=await page.evaluate(()=>window.__calls.filter(c=>c.method==='updateTodayWidget').map(c=>c.args))
    assert.ok(payloads.some(p=>p.items.some(i=>i.submissionStatus==='graded'&&i.score===0&&i.pointsPossible===100)),'widget bridge dropped grade metadata')
    assert.deepEqual(errors,[])
    await page.screenshot({path:fileURLToPath(new URL('../ui-results/calendar-status-'+profile.name+'.png',import.meta.url)),fullPage:true})
    await page.close();console.log('PASS: live time, exam names, assignment grades and widget payload',profile.name)
  }
} finally {await browser.close();await server.httpServer.close()}
