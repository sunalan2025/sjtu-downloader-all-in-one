/** Browser checks against built static output; no school accounts or external downloads. */
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
const base=path.resolve(fileURLToPath(new URL('../dist/',import.meta.url)))
const results=fileURLToPath(new URL('../ui-results/',import.meta.url));await fs.mkdir(results,{recursive:true})
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml'}
const server=http.createServer(async(req,res)=>{try{const file=path.resolve(base,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(file!==base&&!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return}const target=file===base?path.join(base,'index.html'):file;const data=await fs.readFile(target);res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream'});res.end(data)}catch{res.writeHead(404);res.end('Not found')}})
await new Promise(resolve=>server.listen(4348,'127.0.0.1',resolve))
const browser=await chromium.launch({executablePath:process.env.UI_TEST_BROWSER||undefined,headless:true,args:['--no-sandbox']})
try{
 for(const width of [320,390,768,1440]){
  const mobile=width<500
  const context=await browser.newContext({viewport:{width,height:900},userAgent:mobile?'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',reducedMotion:'reduce',colorScheme:'light',permissions:['clipboard-read','clipboard-write']})
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('http://127.0.0.1:4348')
  await page.waitForFunction(()=>document.querySelector('#recommended-download').href.includes('releases/download'))
  assert.match(await page.locator('#recommended-download').getAttribute('href'),mobile?/\.apk$/:/\.AppImage$/)
  for(const name of ['课程文件','学期课程','课表日程','交大云盘','深色界面']){
   const tab=page.getByRole('tab',{name,exact:true});await tab.click()
   const panel=page.getByRole('tabpanel');assert.equal(await panel.count(),1)
   await panel.locator('img').evaluate(image=>image.decode())
   assert.equal(await tab.getAttribute('aria-selected'),'true')
  }
  await page.getByRole('tab',{name:'课程文件',exact:true}).focus();await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('tab',{name:'学期课程',exact:true}).getAttribute('aria-selected'),'true')
  await page.getByRole('tabpanel').getByRole('link',{name:/查看大图/}).click();await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'})
  await page.getByRole('button',{name:'切换深浅主题',exact:true}).click()
  assert.equal(await page.locator('html').getAttribute('class'),'dark')
  await page.reload();assert.equal(await page.locator('html').getAttribute('class'),'dark')
  await page.getByRole('button',{name:'切换深浅主题',exact:true}).click()
  const faq=page.locator('.faq-list details').first();await faq.locator('summary').click();assert.equal(await faq.getAttribute('open'),'')
  await faq.locator('summary').click();assert.equal(await faq.getAttribute('open'),null)
  if(width<941){await page.locator('.mobile-nav summary').click();await page.getByRole('navigation',{name:'手机导航'}).getByRole('link',{name:'下载',exact:true}).click();assert.equal(await page.locator('.mobile-nav').getAttribute('open'),null)}
  const hash=page.locator('[data-sha]').first();await hash.click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),await hash.getAttribute('data-sha'))
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal page overflow')
  const internal=await page.locator('a[href^="#"]').evaluateAll(links=>links.map(a=>a.getAttribute('href')).filter(h=>h!=='#'&&!document.querySelector(h)))
  assert.deepEqual(internal,[])
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(results,'website-top-'+width+'.png')})
  await page.screenshot({path:path.join(results,'website-'+width+'.png'),fullPage:true})
  assert.deepEqual(errors,[]);await context.close();console.log('PASS: screenshot gallery, keyboard, dialog, theme, mobile navigation, hashes and downloads',width)
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
