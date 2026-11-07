import { chromium } from 'playwright'
import { preview } from 'vite'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { mockNative } from './ui-fixtures.mjs'
const outputDir = process.env.UI_TEST_RESULTS || fileURLToPath(new URL('../ui-results/', import.meta.url))
await fs.mkdir(outputDir, { recursive: true })
const server = await preview({ preview: { host: '127.0.0.1', port: 4174, strictPort: true } })
const browser = await chromium.launch({ executablePath: process.env.UI_TEST_BROWSER || undefined, headless: true, args: ['--no-sandbox'] })
const results = []
const rgb = value =>
  value
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number)
const luminance = value =>
  rgb(value)
    .map(v => v / 255)
    .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
async function contrast(locator, label) {
  const colors = await locator.evaluate(el => {
    let ancestor = el
    while (ancestor && getComputedStyle(ancestor).backgroundColor === 'rgba(0, 0, 0, 0)') ancestor = ancestor.parentElement
    return {
      text: getComputedStyle(el).color,
      background: ancestor ? getComputedStyle(ancestor).backgroundColor : getComputedStyle(document.body).backgroundColor
    }
  })
  const a = luminance(colors.text),
    b = luminance(colors.background)
  assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `${label} has insufficient text contrast: ${JSON.stringify(colors)}`)
}
async function centered(page) {
  const differences = await page.locator('.icon-tile').evaluateAll(tiles =>
    tiles.map(tile => {
      const a = tile.getBoundingClientRect(),
        b = tile.querySelector('svg').getBoundingClientRect()
      return { dx: Math.abs(a.x + a.width / 2 - b.x - b.width / 2), dy: Math.abs(a.y + a.height / 2 - b.y - b.height / 2) }
    })
  )
  assert.ok(differences.length >= 3)
  assert.ok(
    differences.every(p => p.dx < 0.5 && p.dy < 0.5),
    'settings icon is not centered: ' + JSON.stringify(differences)
  )
}
async function settle(page) {
  await page.waitForFunction(()=>document.documentElement.dataset.viewMoving!=='true')
  await page.locator('.screen-motion').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(()=>{}))))
}
async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page overflows horizontally')
}
async function appearance(page) {
  await page.getByRole('button', { name: '下载', exact: true }).click()
  await page.getByRole('button', { name: /界面与颜色/ }).click()
  await page.getByRole('dialog', { name: '界面与颜色' }).waitFor()
}
async function snapshot(page, name) {
  await settle(page)
  await page.screenshot({ path: `${outputDir}/${name}.png`, fullPage: false })
}
try {
  for (const profile of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 1280, height: 800 }
  ]) {
    const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await mockNative(page)
    await page.goto('http://127.0.0.1:4174')
    await page.getByText('界面测试账号', { exact: true }).waitFor()
    for (const mode of ['light', 'dark']) {
      console.log('Material screen review', profile.name, mode)
      await appearance(page)
      await page.getByRole('radio', { name: mode === 'light' ? '浅色' : '深色', exact: true }).click()
      await page.getByRole('radio', { name: '海蓝', exact: true }).click()
      await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, mode)
      await contrast(page.locator('.settings-sheet-head h2'), 'appearance title')
      await page.screenshot({ path: `${outputDir}/material-${profile.name}-${mode}-appearance.png` })
      await page.getByRole('button', { name: '关闭设置', exact: true }).click()
      await page.getByRole('dialog').waitFor({state:'detached'})
      const canvas = await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)
      assert.ok(mode === 'dark' ? luminance(canvas) < 0.05 : luminance(canvas) > 0.8, 'entire canvas must follow the chosen theme')
      await page.getByRole('button', { name: '首页', exact: true }).click()
      await page.getByRole('heading', { name: '概览', exact: true }).waitFor()
      await contrast(page.locator('.home-stage h2'), 'home card')
      await contrast(page.locator('.welcome-name'), 'home supporting text')
      await noOverflow(page)
      await snapshot(page, `material-${profile.name}-${mode}-home`)
      await page.getByRole('button', { name: '课程', exact: true }).click()
      await page.locator('.course-card-open').first().waitFor()
      assert.equal(await page.locator('.course-card-open').count(), 3)
      await contrast(page.locator('.course-text strong').first(), 'course title')
      await snapshot(page, `material-${profile.name}-${mode}-courses`)
      await page.locator('.course-card-open').first().click()
      await page.getByText('第三章_线性空间与线性变换.pdf', { exact: true }).waitFor()
      await contrast(page.locator('.file-info strong').first(), 'file title')
      await contrast(page.locator('.file-info small').first(), 'file metadata')
      await noOverflow(page)
      await snapshot(page, `material-${profile.name}-${mode}-files`)
      await page.getByRole('button', { name: '视频文件', exact: true }).click()
      await settle(page)
      assert.equal(await page.locator('.file-row').count(), 1)
      await page.getByRole('button', { name: '文档课件', exact: true }).click()
      await settle(page)
      await page.locator('.file-row').first().dispatchEvent('contextmenu')
      await page.getByRole('button', { name: '下载 1 个文件', exact: true }).waitFor()
      await page.getByRole('button', { name: '完成', exact: true }).click()
      await page.getByRole('button', { name: '日历', exact: true }).click()
      await page.locator('.week-time-event').first().waitFor()
      await contrast(page.locator('.week-time-event strong').first(), 'week event')
      await noOverflow(page)
      await snapshot(page, `material-${profile.name}-${mode}-calendar`)
      await page.locator('.week-time-event').first().click()
      await page.getByRole('dialog', { name: '日程详情', exact: true }).waitFor()
      await contrast(page.locator('.week-detail-item>strong').first(), 'event details')
      await page.evaluate(() => window.__listeners['App:backButton']?.({ canGoBack: true }))
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      assert.equal(await page.locator('.bottom-nav .selected').getAttribute('aria-label'), '日历')
      await page.getByRole('button', { name: '日', exact: true }).click()
      await page.locator('.day-item-copy>strong').first().waitFor()
      await contrast(page.locator('.day-item-copy>strong').first(), 'day event')
      await snapshot(page, `material-${profile.name}-${mode}-day`)
      await page.getByRole('button', { name: /添加 .* 的个人日程/ }).click()
      await page.getByRole('dialog', { name: '新建日程', exact: true }).waitFor()
      await contrast(page.locator('.schedule-modal h2'), 'schedule editor')
      await contrast(page.getByRole('button', { name: '保存日程', exact: true }), 'primary button')
      await page.evaluate(() => window.__listeners['App:backButton']?.({ canGoBack: true }))
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      assert.equal(await page.locator('.bottom-nav .selected').getAttribute('aria-label'), '日历')
      await page.getByRole('button', { name: '下载', exact: true }).click()
      await settle(page)
      await centered(page)
      assert.match(await page.locator('.settings-entry').last().innerText(), /桌面日程小组件/, 'widget settings must be last')
      await contrast(page.locator('.download-task-info strong').first(), 'download title')
      await contrast(page.locator('.settings-entry strong').first(), 'settings title')
      await page.getByRole('button', { name: '清除历史', exact: true }).click()
      const confirmation = page.getByRole('alertdialog', { name: '清除下载历史？', exact: true })
      await confirmation.waitFor()
      await contrast(confirmation.locator('h2'), 'confirmation title')
      await contrast(confirmation.locator('p'), 'confirmation supporting text')
      await page.evaluate(() => window.__listeners['App:backButton']?.({ canGoBack: true }))
      await confirmation.waitFor({ state: 'detached' })
      assert.equal(await page.locator('.download-task-card').count(), 1, 'canceling confirmation cleared downloads')

      await noOverflow(page)
      await snapshot(page, `material-${profile.name}-${mode}-downloads`)
      await page.getByRole('button', { name: /通知与后台同步/ }).click()
      await page.getByRole('switch', { name: /开启日程提醒/ }).waitFor()
      await contrast(page.locator('.settings-toggle-row strong').first(), 'notification preference')
      await contrast(page.locator('.settings-intro').first(), 'notification help')
      await page.screenshot({ path: `${outputDir}/material-${profile.name}-${mode}-notifications.png` })
      await page.getByRole('button', { name: '关闭设置', exact: true }).click()
      await page.getByRole('dialog').waitFor({state:'detached'})
      await page.getByRole('button', { name: /桌面日程小组件/ }).click()
      await contrast(page.locator('.widget-data-state'), 'widget preferences')
      await page.getByRole('button', { name: '关闭设置', exact: true }).click()
      await page.getByRole('dialog').waitFor({state:'detached'})
      results.push({ profile: profile.name, theme: mode, fullScreens: true, iconsCentered: true, textContrast: true })
    }
    // A manual mode persists and takes precedence over OS changes; system mode follows them live.
    await page.emulateMedia({ colorScheme: 'light' })
    await page.reload()
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    await appearance(page)
    await page.getByRole('radio', { name: '跟随系统', exact: true }).click()
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    const blue = await page.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--md-primary'))
    await page.getByRole('radio', { name: '系统取色', exact: true }).click()
    const system = await page.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--md-primary'))
    assert.notEqual(system, blue, 'Android dynamic seed did not update the full color scheme')
    const native = await page.evaluate(() => window.__calls.filter(c => c.method === 'setAppAppearance').at(-1)?.args)
    assert.equal(native.dark, true)
    assert.equal(native.mode, 'system')
    assert.ok(native.colors.onSurface)
    await page.getByRole('button', { name: '关闭设置', exact: true }).click()
    assert.deepEqual(errors, [])
    await page.close()
  }
  await fs.writeFile(`${outputDir}/material-results.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
} finally {
  await browser.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
