import { reminderCategory, allDaySettings, syncSettings, settingsRoot, settleSettings } from './ui-settings.mjs'
import { mockNative } from './ui-fixtures.mjs'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { preview } from 'vite'
import { fileURLToPath } from 'node:url'
const outputDir = process.env.UI_TEST_RESULTS || fileURLToPath(new URL('../ui-results/', import.meta.url))
await fs.mkdir(outputDir, { recursive: true })
const server = await preview({ preview: { host: '127.0.0.1', port: 4173, strictPort: true } })
const testUrl = 'http://127.0.0.1:4173'
const browser = await chromium.launch({ executablePath: process.env.UI_TEST_BROWSER || undefined, headless: true, args: ['--no-sandbox'] })
const results = []
try {
  async function settleSlider(page) {
    await page.locator('.nav-slider').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)))
  }
  async function aligned(page) {
    await settleSlider(page)
    await page.locator('.bottom-nav .selected').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))))
    const rects = await page.evaluate(() => {
      const a = document.querySelector('.nav-slider').getBoundingClientRect(),
        b = document.querySelector('.bottom-nav .selected').getBoundingClientRect()
      return { a: { x: a.x, y: a.y, width: a.width, height: a.height }, b: { x: b.x, y: b.y, width: b.width, height: b.height } }
    })
    for (const key of ['x', 'y', 'width', 'height'])
      assert.ok(Math.abs(rects.a[key] - rects.b[key]) < 2, `slider ${key}: ${JSON.stringify(rects)}`)
    return rects
  }
  async function motion(page) {
    return page.locator('.screen-motion').evaluate(el => getComputedStyle(el).animationName)
  }
  async function noOverflow(page) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal page overflow')
  }
  for (const cfg of [
    { name: 'phone', width: 390, height: 844, animation: 'pageEaseForward', rail: false },
    { name: 'small-phone', width: 320, height: 640, animation: 'pageEaseForward', rail: false },
    { name: 'phone-landscape', width: 844, height: 390, animation: 'pageEaseCompact', rail: false },
    { name: 'tablet-portrait', width: 800, height: 1280, animation: 'pageEaseTablet', rail: false },
    { name: 'tablet-landscape', width: 1280, height: 800, animation: 'pageEaseDown', rail: true },
    { name: 'short-tablet', width: 960, height: 480, animation: 'pageEaseDown', rail: true }
  ]) {
    const page = await browser.newPage({ viewport: { width: cfg.width, height: cfg.height }, deviceScaleFactor: 1 })
    const errors = []
    console.log('Checking', cfg.name)
    page.on('pageerror', e => errors.push(e.message))
    await mockNative(page)
    // Explicitly exercise the transition fallback for older Android WebViews.
    await page.addInitScript(()=>{Object.defineProperty(document,'startViewTransition',{value:undefined})})
    await page.goto(testUrl)
    await page.getByText('界面测试账号', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: /桌面日程小组件/ }).count(), 0, 'widget settings leaked onto Home')
    await page.getByRole('button', { name: '下载', exact: true }).click()
    assert.equal(await motion(page), cfg.animation)
    await page.waitForTimeout(480)
    if (cfg.rail) await aligned(page)
    const order = await page.locator('.downloads-layout').evaluate(el => el.lastElementChild.className)
    assert.ok(order.includes('download-settings'))
    const entry = page.getByRole('button', { name: /桌面日程小组件/ })
    await entry.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
    const before = await entry.boundingBox()
    const scrollBefore = await page.evaluate(() => scrollY)
    await entry.click()
    await page.getByRole('dialog', { name: '桌面日程小组件' }).waitFor()
    await entry.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))))
    const during = await entry.boundingBox()
    assert.ok(Math.abs(before.y - during.y) < 1 && Math.abs(before.x - during.x) < 1, 'opening settings shifted the entry')
    for (const text of ['添加今日日程', '添加本周课表']) await page.getByRole('button', { name: text, exact: true }).click()
    assert.ok(
      await page.evaluate(() =>
        ['daily', 'weekly'].every(kind => window.__calls.some(c => c.method === 'pinTodayWidget' && c.args.kind === kind))
      )
    )
    await noOverflow(page)
    await page.getByRole('button', { name: '关闭设置', exact: true }).click()
    await page.getByRole('dialog').waitFor({state:'detached'})
    assert.equal(await page.getByRole('dialog').count(), 0)
    const after = await entry.boundingBox()
    assert.ok(Math.abs(before.y - after.y) < 1 && Math.abs(before.x - after.x) < 1, 'closing settings shifted the entry')
    assert.equal(await page.evaluate(() => scrollY), scrollBefore, 'closing settings changed document scroll')
    await page.getByRole('button',{name:/^系统权限/}).click()
    await page.getByText('允许准时更新', { exact: true }).waitFor()
    const alarm = page.locator('.widget-alarm-action')
    const style = await alarm.evaluate(el => {
      const s = getComputedStyle(el)
      return { bg: s.backgroundImage, radius: s.borderRadius, h: Number.parseFloat(s.height) }
    })
    assert.ok(style.bg === 'none' && style.radius === '100px' && style.h >= 48)
    await alarm.click()
    assert.ok(await page.evaluate(() => window.__calls.some(c => c.method === 'openWidgetSettings' && c.args.section === 'exactAlarm')))
    await page.getByRole('button',{name:'关闭设置',exact:true}).click()
    await page.getByRole('dialog').waitFor({state:'detached'})

    if (cfg.rail) {
      if (await page.getByRole('button', { name: '展开侧栏导航', exact: true }).count()) {
        await page.getByRole('button', { name: '展开侧栏导航', exact: true }).click()
        await page.waitForTimeout(420)
      }
      // Prove the surface interpolates rather than jumping between row backgrounds.
      const start = await page.locator('.nav-slider').evaluate(el => el.getBoundingClientRect().y)
      await page.getByRole('button', { name: '首页', exact: true }).click()
      // Sample the real CSS transition at a fixed time; CPU scheduling in CI
      // must not turn an intermediate-frame assertion into a timing lottery.
      const mid = await page.locator('.nav-slider').evaluate(el => {
        const animation = el.getAnimations()[0]
        if (!animation) throw new Error('No rail transition was created')
        animation.pause()
        animation.currentTime = 120
        return el.getBoundingClientRect().y
      })
      assert.ok(mid < start - 2, 'rail did not interpolate toward the selected row')
      await page.locator('.nav-slider').evaluate(el => el.getAnimations().forEach(a => a.finish()))
      const end = await page.locator('.nav-slider').evaluate(el => el.getBoundingClientRect().y)
      assert.ok(mid > end + 1, 'rail jumped directly to destination')
      await aligned(page)
      await page.getByRole('button', { name: /收起侧栏导航/ }).click()
      await page.waitForTimeout(420)
      await page.getByRole('button', { name: '日历', exact: true }).click()
      assert.equal(await motion(page), 'pageEaseDown')
      await page.waitForTimeout(450)
      await aligned(page)
      await page.getByRole('button', { name: '首页', exact: true }).click()
      assert.equal(await motion(page), 'pageEaseUp')
      await page.waitForTimeout(450)
      await aligned(page)
      // Rapid navigation must settle at the final target.
      await page.evaluate(() => {
        for (const name of ['日历', '课程', '下载', '首页', '下载'])
          document.querySelector(`.bottom-nav button[aria-label="${name}"]`).click()
      })
      await page.waitForTimeout(450)
      await aligned(page)
      await page.getByRole('button', { name: /展开侧栏导航/ }).click()
      await page.waitForTimeout(420)
      await aligned(page)
    }
    // Capture all settings, then rotate without remounting.
    await page.getByRole('button', { name: '下载', exact: true }).click()
    await page.locator('.screen-motion').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)))
    await page.screenshot({ path: `${outputDir}/${cfg.name}.png`, fullPage: true })
    await page.setViewportSize({ width: cfg.height, height: cfg.width })
    await page.waitForTimeout(500)
    await noOverflow(page)
    if (cfg.height >= 740 && cfg.width >= 420) await aligned(page)
    await page.getByRole('button', { name: /桌面日程小组件/ }).click()
    await page.getByRole('dialog', { name: '桌面日程小组件' }).waitFor()
    await page.evaluate(() => {
      const back = window.__listeners['App:backButton']
      if (!back) throw new Error('Native back listener was not installed')
      back({ canGoBack: true })
    })
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(await page.getByRole('dialog').count(), 0, 'Android back failed to close settings')
    assert.equal(await page.locator('.bottom-nav .selected').getAttribute('aria-label'), '下载')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: '课程', exact: true }).click()
    assert.equal(await motion(page), 'none')
    assert.equal(await page.locator('.nav-slider').evaluate(el => getComputedStyle(el).transitionDuration), '0s')
    assert.deepEqual(errors, [])
    results.push({ device: cfg.name, motion: cfg.animation, passed: true })
    await page.close()
  }
  // Notification consent, independent background work, saved offsets and theme choices.
  const preferencesPage = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await mockNative(preferencesPage, { notificationsAllowed: false, grantNotifications:true })
  await preferencesPage.goto(testUrl)
  await preferencesPage.getByText('界面测试账号', { exact: true }).waitFor()
  await preferencesPage.getByRole('button', { name: '下载', exact: true }).click()
  await preferencesPage.getByRole('button', { name: /通知与后台同步/ }).click()
  await syncSettings(preferencesPage)
  await preferencesPage.getByRole('switch',{name:/定期同步学校日程/}).check()
  assert.equal(await preferencesPage.evaluate(()=>window.__calls.filter(c=>c.method==='requestAgendaPermission').length),0)
  await preferencesPage.getByRole('combobox',{name:'同步间隔',exact:true}).click()
  await preferencesPage.getByRole('option',{name:'约每 30 分钟',exact:true}).click()
  await preferencesPage.locator('.select-overlay').waitFor({state:'detached'})
  await settingsRoot(preferencesPage)
  assert.equal(await preferencesPage.getByRole('switch',{name:/开启日程提醒/}).isDisabled(),true)
  assert.equal(await preferencesPage.getByRole('switch',{name:/开启日程提醒/}).isChecked(),false)
  await preferencesPage.getByRole('button',{name:'关闭设置',exact:true}).click()
  await preferencesPage.getByRole('dialog').waitFor({state:'detached'})
  await preferencesPage.getByRole('button',{name:/^系统权限/}).click()
  await preferencesPage.getByRole('button',{name:'允许通知',exact:true}).click()
  await preferencesPage.getByText('已允许系统通知',{exact:true}).waitFor()
  await preferencesPage.getByRole('button',{name:'关闭设置',exact:true}).click()
  await preferencesPage.getByRole('dialog').waitFor({state:'detached'})
  await preferencesPage.getByRole('button',{name:/通知与后台同步/}).click()
  await reminderCategory(preferencesPage)
  assert.equal(await preferencesPage.evaluate(()=>window.__calls.filter(c=>c.method==='requestAgendaPermission').length),1,'only the root permission page may request system permission')
  await preferencesPage.getByRole('combobox',{name:'课程提前时间',exact:true}).click()
  await preferencesPage.getByRole('option',{name:'提前 30 分钟',exact:true}).click()
  await preferencesPage.locator('.select-overlay').waitFor({state:'detached'})
  await reminderCategory(preferencesPage,'exam')
  await preferencesPage.getByRole('combobox',{name:'考试提前时间',exact:true}).click()
  await preferencesPage.getByRole('option',{name:'提前 2 小时',exact:true}).click()
  await preferencesPage.locator('.select-overlay').waitFor({state:'detached'})
  await preferencesPage.screenshot({path:`${outputDir}/notification-settings.png`,fullPage:true})
  await preferencesPage.getByRole('button',{name:'关闭设置',exact:true}).click()
  await preferencesPage.getByRole('dialog').waitFor({state:'detached'})
  await preferencesPage.getByRole('button',{name:/通知与后台同步/}).click()
  await reminderCategory(preferencesPage)
  assert.equal(await preferencesPage.getByRole('combobox',{name:'课程提前时间',exact:true}).getAttribute('data-value'),'30')
  await reminderCategory(preferencesPage,'exam')
  assert.equal(await preferencesPage.getByRole('combobox',{name:'考试提前时间',exact:true}).getAttribute('data-value'),'120')
  await preferencesPage.getByRole('button',{name:'关闭设置',exact:true}).click()
  await preferencesPage.getByRole('dialog').waitFor({state:'detached'})
  await preferencesPage.getByRole('button', { name: /界面与颜色/ }).click()
  await preferencesPage.getByRole('radio', { name: '青玉', exact: true }).click()
  assert.equal(await preferencesPage.locator('html').getAttribute('data-accent'), 'jade')
  await preferencesPage.getByRole('switch', { name: /减少动态效果/ }).check()
  await preferencesPage.getByRole('button', { name: '关闭设置', exact: true }).click()
  await preferencesPage.getByRole('button', { name: '首页', exact: true }).click()
  assert.equal(await motion(preferencesPage), 'none')
  await preferencesPage.reload()
  assert.equal(await preferencesPage.locator('html').getAttribute('data-accent'), 'jade')
  assert.equal(await preferencesPage.locator('html').getAttribute('data-effects'), 'reduced')
  await preferencesPage.close()
  // Empty downloads and logged-out users must still have widget settings at the bottom.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await mockNative(page, { loggedIn: false, history: false })
  await page.goto(testUrl)
  await page.getByRole('button', { name: '下载', exact: true }).click()
  await page.getByText('还没有下载任务', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: /桌面日程小组件/ }).count(), 1)
  await noOverflow(page)
  await page.getByRole('button', { name: '首页', exact: true }).click()
  await page.getByRole('button', { name: '＋ 添加日程', exact: true }).click()
  await page.getByLabel('日程标题', { exact: true }).fill('回归测试个人日程')
  await page.getByRole('button', { name: '保存日程', exact: true }).click()
  await page.getByText('回归测试个人日程', { exact: true }).waitFor()
  await page.getByRole('button', { name: '编辑 回归测试个人日程', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '取消', exact: true }).evaluate(el => getComputedStyle(el).borderRadius), '100px')
  await page.getByLabel('日程标题', { exact: true }).fill('个人日程已更新')
  await page.getByRole('button', { name: '保存日程', exact: true }).click()
  await page.getByText('个人日程已更新', { exact: true }).waitFor()
  await page.close()
  await fs.writeFile(`${outputDir}/results.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
} finally {
  await browser.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
