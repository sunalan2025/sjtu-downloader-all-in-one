import { reminderCategory, allDaySettings, syncSettings, settingsRoot, settleSettings } from './ui-settings.mjs'
import { chromium } from 'playwright'
import { preview } from 'vite'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { mockNative } from './ui-fixtures.mjs'
const server=await preview({root:fileURLToPath(new URL('..',import.meta.url)),preview:{host:'127.0.0.1',port:4178,strictPort:true}})
const browser=await chromium.launch({executablePath:process.env.UI_TEST_BROWSER||undefined,headless:true,args:['--no-sandbox']})
const evidence=new URL('../ui-results/',import.meta.url)
await fs.mkdir(evidence,{recursive:true})
async function settle(page){
  await page.waitForFunction(()=>document.documentElement.dataset.viewMoving!=='true')
  await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))))
}
try{
  for(const profile of [{name:'phone',width:390,height:844},{name:'tablet',width:1280,height:800},{name:'landscape',width:844,height:390}]){
    const page=await browser.newPage({viewport:profile})
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    await mockNative(page)
    await page.goto('http://127.0.0.1:4178')
    await page.getByText('界面测试账号',{exact:true}).waitFor()
    await page.getByRole('button',{name:'下载',exact:true}).click();await settle(page)
    await page.getByRole('button',{name:/通知与后台同步/}).click();await settle(page)
    await reminderCategory(page)
    const group=page.locator('.reminder-detail')
    const closing=await group.evaluate(async node=>{
      const body=node.querySelector('.motion-collapse'),full=body.getBoundingClientRect().height
      node.querySelector('input[type=checkbox]').click();await new Promise(requestAnimationFrame)
      const motion=body.getAnimations().find(a=>a.id==='disclosure-height');motion.pause();motion.currentTime=150
      const rows=body.querySelectorAll('[data-unfold-entry]')
      rows.forEach(row=>row.getAnimations().forEach(a=>{a.pause();a.currentTime=100}))
      return{full,height:body.getBoundingClientRect().height,inert:body.inert,opacity:getComputedStyle(body).opacity,
        entries:[...rows].map(row=>getComputedStyle(row).opacity)}
    })
    assert.ok(closing.height>0&&closing.height<closing.full,'settings folded without intermediate geometry')
    assert.equal(closing.inert,true);assert.equal(closing.opacity,'1')
    assert.ok(closing.entries.some(value=>Number(value)>0&&Number(value)<1),'entries did not move/fade independently')
    await page.screenshot({path:fileURLToPath(new URL('fold-middle-'+profile.name+'.png',evidence))})
    await group.evaluate(node=>node.getAnimations({subtree:true}).forEach(a=>a.finish()));await settle(page)
    await group.getByRole('switch',{name:/课程/}).check();await settle(page)
    const select=page.getByRole('combobox',{name:'课程提前时间',exact:true})
    const saved=await select.getAttribute('data-value')
    await select.click()
    const menu=page.locator('.select-menu')
    const middle=await menu.evaluate(node=>{
      const a=node.getAnimations().find(a=>a.id==='select-surface');a.pause();a.currentTime=100
      node.getAnimations({subtree:true}).filter(a=>a.id==='select-option').forEach(a=>{a.pause();a.currentTime=100})
      return{transform:getComputedStyle(node).transform,clip:getComputedStyle(node).clipPath,height:node.getBoundingClientRect().height,shadow:getComputedStyle(node).boxShadow,opacity:getComputedStyle(node).opacity}
    })
    assert.ok(Number(middle.opacity)>0&&Number(middle.opacity)<1,'option menu appeared without growing out of its value')
    assert.equal(middle.clip,'none','menu shadow was clipped');assert.ok(middle.height>30);assert.notEqual(middle.shadow,'none')
    await page.screenshot({path:fileURLToPath(new URL('options-middle-'+profile.name+'.png',evidence))})
    await menu.evaluate(node=>node.getAnimations({subtree:true}).forEach(a=>a.finish()));await settle(page)
    const bounds=await menu.boundingBox()
    assert.ok(bounds.x>=10&&bounds.y>=10&&bounds.x+bounds.width<=profile.width-10&&bounds.y+bounds.height<=profile.height-10,'menu escaped the viewport')
    await page.getByRole('option',{name:'提前 30 分钟',exact:true}).click()
    await page.locator('.select-overlay').waitFor({state:'detached'})
    assert.equal(await select.getAttribute('data-value'),'30')
    assert.equal(await select.evaluate(node=>node===document.activeElement),true,'selection lost combobox focus')
    await select.click();await settle(page)
    await page.keyboard.press('Escape')
    await page.locator('.select-overlay').waitFor({state:'detached'})
    assert.equal(await page.getByRole('dialog',{name:'课程提醒',exact:true}).count(),1,'Escape dismissed the sheet below the menu')
    await select.click();await settle(page)
    await page.evaluate(()=>window.__listeners['App:backButton']({canGoBack:true}))
    await page.locator('.select-overlay').waitFor({state:'detached'})
    assert.equal(await page.getByRole('dialog',{name:'课程提醒',exact:true}).count(),1,'Android Back dismissed the sheet below the menu')
    await select.click()
    const reversal=await menu.evaluate(async node=>{
      const animation=node.getAnimations().find(a=>a.id==='select-surface');animation.pause();animation.currentTime=100
      const before=node.getBoundingClientRect().height
      document.querySelector('[aria-label="课程提前时间"]').click();await new Promise(requestAnimationFrame)
      const closing=node.getAnimations().find(a=>a.id==='select-surface');closing.pause();closing.currentTime=0
      const after=node.getBoundingClientRect().height
      node.getAnimations({subtree:true}).forEach(a=>a.finish())
      return{before,after}
    })
    assert.ok(Math.abs(reversal.after-reversal.before)<0.1,'option menu jumped back to an endpoint when reversed')
    await page.locator('.select-overlay').waitFor({state:'detached'})
    for(let index=0;index<12;index++){await select.evaluate(node=>node.click());await page.waitForTimeout(18)}
    await settle(page);await page.locator('.select-overlay').waitFor({state:'detached'})
    assert.equal(await select.getAttribute('data-value'),'30','interrupted menus changed the saved value')
    // Every option is keyboard reachable, and the chosen value survives reopening settings.
    await select.focus();await page.keyboard.press('ArrowDown');await settle(page)
    await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter')
    await page.locator('.select-overlay').waitFor({state:'detached'})
    await reminderCategory(page)
    assert.equal(await select.getAttribute('data-value'),'5')
    await page.getByRole('button',{name:'关闭设置',exact:true}).click()
    await page.getByRole('dialog').waitFor({state:'detached'})
    await page.getByRole('button',{name:/通知与后台同步/}).click();await settle(page)
    await reminderCategory(page)
    assert.equal(await select.getAttribute('data-value'),'5')
    await allDaySettings(page)
    const hours=page.getByRole('combobox',{name:'全天日程时间',exact:true})
    await hours.click();await settle(page)
    assert.equal(await hours.getAttribute('aria-expanded'),'true','focus scrolling closed the hour menu')
    await page.keyboard.press('End');await page.keyboard.press('Enter')
    await page.locator('.select-overlay').waitFor({state:'detached'})
    assert.equal(await hours.getAttribute('data-value'),'23')
    await hours.click();await settle(page)
    assert.ok(await page.locator('.select-options').evaluate(node=>node.scrollTop>0),'long option list did not reveal its selected value')
    await page.keyboard.press('Escape');await page.locator('.select-overlay').waitFor({state:'detached'})
    await page.emulateMedia({reducedMotion:'reduce'})
    await reminderCategory(page)
    await select.click()
    assert.equal(await menu.evaluate(node=>node.getAnimations({subtree:true}).length),0)
    await page.keyboard.press('Escape');await page.locator('.select-overlay').waitFor({state:'detached'})
    await page.getByRole('button',{name:'关闭设置',exact:true}).click()
    await page.getByRole('dialog').waitFor({state:'detached'})
    await page.getByRole('button',{name:'课程',exact:true}).click();await settle(page)
    const term=page.getByRole('combobox',{name:'选择学期'})
    await term.click();await settle(page)
    assert.ok(await page.getByRole('option').count()>1,'course filter lost its terms')
    await page.keyboard.press('Escape');await page.locator('.select-overlay').waitFor({state:'detached'})
    assert.deepEqual(errors,[])
    console.log('PASS: visible fold/menu frames, viewport fit, real option saving, keyboard, nested Back/Escape, long lists and reduced motion',profile.name,{previous:saved})
    await page.close()
  }
}finally{await browser.close();await server.httpServer.close()}
