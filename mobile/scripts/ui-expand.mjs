import { chromium } from 'playwright'
import { preview } from 'vite'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { mockNative } from './ui-fixtures.mjs'
const server=await preview({root:fileURLToPath(new URL('..',import.meta.url)),preview:{host:'127.0.0.1',port:4177,strictPort:true}})
const browser=await chromium.launch({executablePath:process.env.UI_TEST_BROWSER||undefined,headless:true,args:['--no-sandbox']})
const evidence=new URL('../ui-results/',import.meta.url)
await fs.mkdir(evidence,{recursive:true})
async function settle(page){
  await page.waitForFunction(()=>document.documentElement.dataset.viewMoving!=='true')
  await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))))
}
try{
  for(const profile of [{name:'phone',width:390,height:844},{name:'tablet',width:1280,height:800}]){
    console.log('Checking smooth expansion and background clock',profile.name)
    const page=await browser.newPage({viewport:profile})
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    await page.clock.install({time:new Date('2026-11-05T11:00:00+08:00')})
    await mockNative(page)
    await page.goto('http://127.0.0.1:4177')
    await page.getByText('界面测试账号',{exact:true}).waitFor()
    await page.getByRole('button',{name:'日历',exact:true}).click();await settle(page)
    await page.locator('.week-range').click()
    const fold=page.locator('.week-navigator>.motion-collapse')
    const reverse=await fold.evaluate(async node=>{
      const a=node.getAnimations().find(a=>a.id==='disclosure-height');a.pause();a.currentTime=90
      const from=node.getBoundingClientRect().height
      document.querySelector('.week-range').click()
      await new Promise(requestAnimationFrame)
      const b=node.getAnimations().find(a=>a.id==='disclosure-height');b.pause();b.currentTime=0
      return{from,reversed:node.getBoundingClientRect().height,inert:node.inert}
    })
    assert.ok(reverse.from>0);assert.ok(Math.abs(reverse.from-reverse.reversed)<1,'disclosure jumped when reversed')
    assert.equal(reverse.inert,true)
    await fold.evaluate(node=>node.getAnimations().forEach(a=>a.finish()));await settle(page)
    assert.equal(await fold.evaluate(node=>node.getBoundingClientRect().height),0)
    for(let i=0;i<12;i++){
      await page.locator('.week-range').evaluate(node=>node.click())
      await page.waitForTimeout(18)
    }
    await settle(page)
    assert.equal(await fold.getAttribute('aria-hidden'),'true')
    // Both subscribers share the same minute source, and hidden pages sleep.
    const line=page.locator('.week-now-line time')
    const before=await line.textContent()
    await page.clock.fastForward(60_050);assert.notEqual(await line.textContent(),before)
    const hidden=await line.textContent()
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__hidden});window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'))})
    await page.clock.fastForward(120_000);assert.equal(await line.textContent(),hidden,'hidden page kept running the UI clock')
    await page.evaluate(()=>{window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'))})
    await page.waitForFunction(value=>document.querySelector('.week-now-line time').textContent!==value,hidden)
    await page.getByRole('button',{name:'下载',exact:true}).click();await settle(page)
    const entry=page.getByRole('button',{name:/桌面日程小组件 添加到桌面/})
    await entry.evaluate(node=>node.scrollIntoView({block:'center'}))
    const scroll=await page.evaluate(()=>scrollY)
    await entry.click();await page.getByRole('dialog',{name:'桌面日程小组件',exact:true}).waitFor()
    const opening=await page.locator('.settings-sheet').evaluate(node=>{
      const a=node.getAnimations().find(a=>a.id==='container-surface');a.pause();a.currentTime=0
      const frame=a.effect.getKeyframes()[0]
      return{transform:frame.transform,clip:frame.clipPath,duration:a.effect.getTiming().duration}
    })
    assert.equal(opening.duration,340)
    if(profile.name==='phone')assert.match(opening.clip,/inset\(0px 0px [1-9]/,'mobile panel did not grow from its entry')
    else assert.match(opening.transform,/scale\(0.96\)/,'tablet panel should use its centered presentation')
    await page.locator('.settings-sheet').evaluate(node=>node.getAnimations().forEach(a=>a.finish()));await settle(page)
    const disclosure=page.getByRole('button',{name:'如何添加到桌面',exact:true})
    await disclosure.focus();await page.keyboard.press('Enter');await settle(page)
    assert.equal(await disclosure.getAttribute('aria-expanded'),'true')
    const controlled=await disclosure.getAttribute('aria-controls')
    const body=page.locator('[id='+JSON.stringify(controlled)+']')
    assert.equal(await body.evaluate(node=>node.inert),false)
    const stableNodes=await page.locator('.settings-disclosure *').count()
    for(let i=0;i<10;i++){await disclosure.evaluate(node=>node.click());await page.waitForTimeout(18)}
    await settle(page)
    assert.equal(await disclosure.getAttribute('aria-expanded'),'true')
    assert.equal(await page.locator('.settings-disclosure *').count(),stableNodes)
    await page.screenshot({path:fileURLToPath(new URL('expansion-'+profile.name+'.png',evidence))})
    await page.getByRole('button',{name:'关闭设置',exact:true}).click()
    await page.getByRole('dialog').waitFor({state:'detached'})
    assert.equal(await page.evaluate(()=>scrollY),scroll,'settings changed the page scroll anchor')
    assert.equal(await entry.evaluate(node=>document.activeElement===node),true,'focus did not return to the entry')
    // Closing during entry must start from the presented geometry.
    await entry.click()
    const interruption=await page.locator('.settings-sheet').evaluate(async node=>{
      const a=node.getAnimations().find(a=>a.id==='container-surface');a.pause();a.currentTime=100
      const prior=getComputedStyle(node).transform
      node.querySelector('[aria-label="关闭设置"]').click();await new Promise(requestAnimationFrame)
      const b=node.getAnimations().find(a=>a.id==='container-surface');b.pause();b.currentTime=0
      const from=getComputedStyle(node).transform;b.finish()
      return{prior,from}
    })
    assert.equal(interruption.from,interruption.prior,'sheet restarted its transition while reversing')
    await page.getByRole('dialog').waitFor({state:'detached'})
    await page.emulateMedia({reducedMotion:'reduce'})
    await entry.click();await settle(page)
    assert.equal(await page.locator('.settings-sheet').evaluate(node=>node.getAnimations().length),0)
    await page.getByRole('button',{name:'如何添加到桌面',exact:true}).click()
    assert.equal(await page.locator('.settings-disclosure:not(.settings-disclosure--group) .motion-collapse').evaluate(node=>node.getAnimations().length),0)
    await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'})
    assert.deepEqual(errors,[])
    console.log('PASS: smooth reversal, container motion, keyboard/focus, stable scroll and sleeping clock',profile.name)
    await page.close()
  }
}finally{await browser.close();await server.httpServer.close()}
