/** Render the actual desktop React application with isolated example IPC responses. */
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import fs from 'node:fs/promises'
import path from 'node:path'
import {chromium} from 'playwright'
import {installDesktopFixture} from './desktop-fixture.mjs'
const root=fileURLToPath(new URL('../..',import.meta.url))
const require=createRequire(path.join(root,'package.json'))
const {createServer}=await import(require.resolve('vite'))
const {default:react}=await import(require.resolve('@vitejs/plugin-react'))
const output=path.join(root,'docs/images/desktop');await fs.mkdir(output,{recursive:true})
const server=await createServer({configFile:false,root:path.join(root,'src/renderer'),plugins:[react()],resolve:{alias:{'@renderer':path.join(root,'src/renderer/src'),'@shared':path.join(root,'src/shared')}},server:{host:'127.0.0.1',port:5198,strictPort:true,fs:{allow:[root]}}})
await server.listen()
const browser=await chromium.launch({executablePath:process.env.UI_TEST_BROWSER||undefined,headless:true,args:['--no-sandbox']})
try{
 const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1,locale:'zh-CN',colorScheme:'light',reducedMotion:'reduce'})
 const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error('Renderer error:',error.message)});page.on('console',msg=>{if(msg.type()==='error')console.log('Browser:',msg.text())})
 await page.clock.install({time:new Date('2026-11-04T10:20:00+08:00')})
 await page.addInitScript(installDesktopFixture)
 await page.goto('http://127.0.0.1:5198')

 await page.getByText('高等数学 A',{exact:true}).first().waitFor()
 await page.evaluate(async()=>{const {useAppStore}=await import('/src/store/app.ts');const s=useAppStore.getState();for(const c of window.__documentationData.courses)s.setCanvasCourseData(c.courseId,window.__documentationData.data)})
 await page.waitForTimeout(700)
 await page.screenshot({path:path.join(output,'courses.png')})
 await page.getByText('高等数学 A',{exact:true}).first().dblclick()
 await page.getByText('课件资料',{exact:true}).first().dblclick()
 await page.getByText('第一章 课程导论.pdf',{exact:true}).first().waitFor()
 await page.evaluate(async()=>{const {useAppStore}=await import('/src/store/app.ts');useAppStore.getState().setCourseViewMode('list')})
 await page.waitForTimeout(700)
 await page.getByRole('checkbox').nth(1).check()
 await page.getByRole('checkbox').nth(2).check()
 await page.screenshot({path:path.join(output,'files.png')})
 await page.evaluate(async()=>{const {useAppStore}=await import('/src/store/app.ts');useAppStore.getState().setActiveTab('schedule')})
 await page.getByText('第三章习题',{exact:true}).first().waitFor()
 await page.waitForTimeout(700)
 await page.screenshot({path:path.join(output,'schedule.png')})
 await page.evaluate(async()=>{const {useAppStore}=await import('/src/store/app.ts');useAppStore.getState().setActiveTab('cloudpan')})
 await page.getByText('本周学习计划.md',{exact:true}).first().waitFor()
 await page.waitForTimeout(700)
 await page.screenshot({path:path.join(output,'cloud-drive.png')})
 await page.evaluate(async()=>{const {useAppStore}=await import('/src/store/app.ts');const s=useAppStore.getState();s.setTheme('dark');s.setActiveTab('canvas')})
 await page.waitForTimeout(700)
 await page.screenshot({path:path.join(output,'dark-mode.png')})
 if(errors.length)throw new Error(errors.join('\n'))
 console.log('Captured five desktop screens from application components with example data')
}finally{await browser.close();await server.close()}
