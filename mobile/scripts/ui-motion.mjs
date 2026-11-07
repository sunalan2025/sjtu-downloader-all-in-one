import { chromium } from 'playwright'
import { labFromArgb } from '../node_modules/@material/material-color-utilities/utils/color_utils.js'
import { preview } from 'vite'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { mockNative } from './ui-fixtures.mjs'
const server = await preview({
  root: fileURLToPath(new URL('..', import.meta.url)),
  preview: { host: '127.0.0.1', port: 4175, strictPort: true }
})
const browser = await chromium.launch({ executablePath: process.env.UI_TEST_BROWSER || undefined, headless: true, args: ['--no-sandbox'] })
const evidence = new URL('../ui-results/', import.meta.url)
await fs.mkdir(evidence, { recursive: true })
const results = []
async function settle(page) {
  await page.waitForFunction(() => document.documentElement.dataset.viewMoving !== 'true')
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => {}))
    )
  )
}
async function close(page) {
  await page.getByRole('button', { name: '关闭设置', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
}
async function navigate(page, name) {
  await page.getByRole('button', { name, exact: true }).click()
  await settle(page)
}
function distinct(colors) {
  const labs = colors.map(x =>
    labFromArgb(
      0xff000000 |
        x.fill
          .match(/\d+/g)
          .map(Number)
          .reduce((n, v) => (n << 8) | v, 0)
    )
  )
  for (const lab of labs) assert.ok(lab[0] >= 82, 'course fill must stay pastel')
  for (let i = 0; i < labs.length; i++)
    for (let j = 0; j < i; j++)
      assert.ok(
        Math.hypot(...labs[i].map((v, k) => v - labs[j][k])) >= 12,
        'subjects are perceptually too similar: ' + colors[i].name + ' / ' + colors[j].name
      )
}
async function noSecondAnimation(page) {
  await page.waitForTimeout(450)
  const audit = await page.evaluate(() => window.__motionAudit)
  assert.deepEqual(audit.live, [], 'CSS entrance replayed after the View Transition: ' + JSON.stringify(audit))
}
async function plainLanguage(page) {
  const copy = await page.locator('body').innerText()
  assert.ok(
    !/Canvas|\bAPI\b|Deadline|原生|绘制|测试通知|重试|SSO|调度|登记|缓存/.test(copy),
    'technical/diagnostic language leaked into UI: ' + copy
  )
}
try {
  for (const profile of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 1280, height: 800 }
  ]) {
    console.log('Checking subject colors and motion', profile.name)
    const page = await browser.newPage({ viewport: profile })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await mockNative(page, { manyCourses: true, fileFailures: 2, legacyMetadata: true })
    await page.addInitScript(() => {
      window.__motionAudit = { transactions: 0, live: [], before: [] }
      const original = document.startViewTransition.bind(document)
      document.startViewTransition = callback => {
        window.__motionAudit.transactions++
        return original(() => {
          window.__motionAudit.before.push({ scroll: scrollY, files: document.querySelectorAll('.file-row').length })
          return callback()
        })
      }
      document.addEventListener(
        'animationstart',
        event => {
          if (event.target instanceof Element && event.target.matches('.screen-motion,.course-screen,.calendar-panel-transition'))
            window.__motionAudit.live.push(event.animationName)
        },
        true
      )
    })
    await page.goto('http://127.0.0.1:4175')
    await page.getByText('界面测试账号', { exact: true }).waitFor()
    await navigate(page, '日历')
    assert.equal(await page.evaluate(() => window.__motionAudit.transactions), 1, 'one navigation started multiple transitions')
    await noSecondAnimation(page)
    await page.evaluate(() => {
      window.__motionAudit = { transactions: 0, live: [], before: [] }
    })
    await page.getByRole('button', { name: '日', exact: true }).click()
    await settle(page)
    const paints = () =>
      page.locator('.day-group-item').evaluateAll(items =>
        items.map(el => ({
          name: el.querySelector('.day-item-copy>strong')?.textContent,
          kind: el.className,
          fill: getComputedStyle(el.querySelector('.schedule-dot')).backgroundColor,
          surface: getComputedStyle(el).backgroundColor,
          ink: getComputedStyle(el).color
        }))
      )
    await noSecondAnimation(page)
    await page.evaluate(() => {
      window.__motionAudit = { transactions: 0, live: [], before: [] }
    })
    await page.getByRole('button', { name: '日', exact: true }).click()
    await settle(page)
    assert.equal(await page.evaluate(() => window.__motionAudit.transactions), 0, 'selected view animated again')
    const light = await paints(),
      courses = light.filter(x => x.kind.includes('kind-schedule'))
    assert.equal(courses.length, 12)
    assert.equal(new Set(light.map(x => x.surface)).size, 1, 'day list used different event backgrounds')
    assert.equal(await page.locator('.day-item-range').count(), 0, 'start time appeared in two places')
    assert.equal((await page.locator('.day-group-item').first().innerText()).match(/08:00/g)?.length, 1)
    assert.equal(new Set(courses.map(x => x.fill)).size, 12, 'course colors repeated')
    distinct(courses)
    const exam = light.find(x => x.kind.includes('kind-exam'))
    assert.ok(exam && !courses.some(x => x.fill === exam.fill), 'exam reused a course color')
    const registry = await page.evaluate(() => localStorage.getItem('sjtu-course-colors-v1'))
    await page.screenshot({ path: new URL(`subjects-${profile.name}-light.png`, evidence).pathname, fullPage: true })
    await page.getByRole('button', { name: '周', exact: true }).click()
    await settle(page)
    await noSecondAnimation(page)
    await page.screenshot({ path: new URL(`subjects-${profile.name}-week-pastel.png`, evidence).pathname, fullPage: false })
    for (const event of await page
      .locator('.week-time-event,.week-all-day-chip')
      .evaluateAll(items => items.map(el => getComputedStyle(el).backgroundColor))) {
      const rgb = event.match(/\d+/g).map(Number)
      const value = 0xff000000 | rgb.reduce((n, v) => (n << 8) | v, 0)
      assert.ok(labFromArgb(value)[0] >= 80, 'timetable used a dark event color')
    }
    await page.locator('.week-time-event').filter({ hasText: '高等数学' }).first().click()
    const detail = page.getByRole('dialog', { name: '日程详情', exact: true })
    await detail.waitFor()
    const meta = await detail.locator('.week-detail-item>p').allTextContents()
    assert.deepEqual(meta, ['地点 · 东中院 2-204'], 'classroom was repeated as a course name')
    assert.ok(!(await detail.locator('.week-detail-item').getAttribute('style')), 'detail inherited a subject background')
    await page.getByRole('button', { name: '关闭日程详情', exact: true }).click()
    await detail.waitFor({ state: 'detached' })
    await page.locator('.week-time-event').filter({ hasText: '程序设计' }).first().click()
    await page.getByRole('dialog', { name: '日程详情', exact: true }).waitFor()
    assert.ok(
      (await page.locator('.week-detail-item>p').allTextContents()).includes('课程 · 计算机课程'),
      'valid course metadata was removed'
    )
    await page.getByRole('button', { name: '关闭日程详情', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.locator('.week-time-exam').first().click()
    await page.getByRole('dialog').waitFor()
    const detailBackgrounds = await page
      .locator('.week-detail-item')
      .evaluateAll(items => items.map(el => getComputedStyle(el).backgroundColor))
    assert.ok(detailBackgrounds.length > 1, 'fixture must contain overlapping courses and an exam')
    assert.equal(new Set(detailBackgrounds).size, 1, 'detail cards used different backgrounds')
    await page.getByRole('button', { name: '关闭日程详情', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    const range = page.locator('.week-range')
    await range.click()
    const expanding = await page.locator('.week-navigator>.motion-collapse').evaluate(el => {
      const a = el.getAnimations().find(a => a.id === 'disclosure-height')
      if (!a) return null
      a.pause()
      a.currentTime = 140
      return { height: el.getBoundingClientRect().height, total: el.firstElementChild.scrollHeight }
    })
    assert.ok(
      expanding && expanding.height > 0 && expanding.height < expanding.total,
      'month fold snapped open: ' + JSON.stringify(expanding)
    )
    await page.locator('.week-navigator>.motion-collapse').evaluate(el => el.getAnimations().forEach(a => a.finish()))
    await page.getByRole('button', { name: '收起月历', exact: true }).click()
    await settle(page)
    await page
      .getByRole('button', { name: /添加 .* 的个人日程/ })
      .first()
      .click()
    await page.getByRole('dialog', { name: '新建日程', exact: true }).waitFor()
    await page.getByLabel('全天日程', { exact: true }).check()
    await settle(page)
    assert.equal(await page.getByLabel('开始', { exact: true }).isDisabled(), true)
    await page.getByLabel('全天日程', { exact: true }).uncheck()
    await settle(page)
    assert.equal(await page.getByLabel('开始', { exact: true }).isDisabled(), false)
    await page.evaluate(() => window.__listeners['App:backButton']?.({ canGoBack: true }))
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.notEqual(await page.locator('html').evaluate(el => el.style.overflow), 'hidden')
    await page.evaluate(() => window.scrollTo(0, 150))
    const outgoingScroll = await page.evaluate(() => scrollY)
    assert.ok(outgoingScroll > 0, 'fixture must be scrolled before changing tabs')
    await navigate(page, '课程')
    assert.equal(
      await page.evaluate(() => window.__motionAudit.before.at(-1).scroll),
      outgoingScroll,
      'outgoing page scrolled before its snapshot'
    )
    await page.locator('.course-card-open').first().click()
    await page.getByText('第三章_线性空间与线性变换.pdf', { exact: true }).waitFor()
    assert.ok(
      await page.evaluate(() => window.__calls.filter(c => c.method === 'files').length >= 3),
      'files were not retried automatically'
    )
    assert.equal(await page.getByRole('button', { name: /重试/ }).count(), 0)
    await settle(page)
    await page.getByRole('button', { name: '返回课程', exact: true }).click()
    await settle(page)
    assert.equal(await page.evaluate(() => window.__motionAudit.before.at(-1).files), 3, 'folder cleared before the outgoing snapshot')
    await noSecondAnimation(page)
    await navigate(page, '下载')
    const entry = page.getByRole('button', { name: /桌面日程小组件/ })
    await entry.evaluate(el =>
      el.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          clientX: el.getBoundingClientRect().x + 20,
          clientY: el.getBoundingClientRect().y + 20
        })
      )
    )
    const press = await entry.evaluate(el => {
      const a = el.getAnimations().find(a => a.id === 'press')
      if (!a) return null
      a.pause()
      a.currentTime = 105
      return getComputedStyle(el).scale
    })
    assert.ok(press && Number(press) < 1, 'button has no press response')
    await entry.evaluate(el => el.getAnimations().forEach(a => a.finish()))
    await entry.click()
    await page.getByRole('dialog', { name: '桌面日程小组件' }).waitFor()
    await plainLanguage(page)
    assert.ok(
      await page.evaluate(() => window.__calls.some(c => c.method === 'refreshTodayWidget')),
      'widget health refresh did not run automatically'
    )
    assert.equal(await page.getByRole('button', { name: /测试|重试|绘制/ }).count(), 0)
    await page.locator('.settings-disclosure:not(.settings-disclosure--group) .disclosure-trigger').click()
    await settle(page)
    assert.equal(await page.locator('.settings-disclosure:not(.settings-disclosure--group) .disclosure-trigger').getAttribute('aria-expanded'), 'true')
    // A closed sheet remains painted for the reverse transition, then releases its focus/scroll lock.
    const exit = await page.getByRole('button', { name: '关闭设置', exact: true }).evaluate(async el => {
      el.click()
      await new Promise(requestAnimationFrame)
      const root = document.querySelector('.settings-scrim')
      return {
        phase: root?.getAttribute('data-motion'),
        animation: root
          ?.querySelector('section')
          ?.getAnimations()
          .some(a => a.id === 'container-surface')
      }
    })
    assert.equal(exit.phase, 'exit')
    assert.equal(exit.animation, true)
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.getByRole('button', { name: /通知与后台同步/ }).click()
    await page.getByRole('switch', { name: /开启日程提醒/ }).waitFor()
    await plainLanguage(page)
    assert.equal(await page.getByRole('button', { name: /测试|重试|立即同步/ }).count(), 0)
    assert.equal(await page.evaluate(() => window.__calls.filter(c => c.method === 'testAgendaNotification').length), 0)
    await close(page)
    await page.getByRole('button', { name: /界面与颜色/ }).click()
    await page.getByRole('radio', { name: '深色', exact: true }).click()
    await close(page)
    await navigate(page, '日历')
    await page.getByRole('button', { name: '日', exact: true }).click()
    await settle(page)
    const dark = await paints()
    distinct(dark.filter(x => x.kind.includes('kind-schedule')))
    assert.equal(new Set(dark.filter(x => x.kind.includes('kind-schedule')).map(x => x.fill)).size, 12)
    assert.equal(new Set(dark.map(x => x.surface)).size, 1, 'dark list used different event backgrounds')
    assert.equal(await page.evaluate(() => localStorage.getItem('sjtu-course-colors-v1')), registry, 'theme change reassigned courses')
    await page.screenshot({ path: new URL(`subjects-${profile.name}-dark.png`, evidence).pathname, fullPage: true })
    // Interrupting in-progress page transitions must keep the last destination.
    await page.evaluate(() => {
      for (const name of ['首页', '课程', '下载', '日历', '下载'])
        document.querySelector(`.bottom-nav button[aria-label="${name}"]`).click()
    })
    await settle(page)
    assert.equal(await page.locator('.bottom-nav .selected').getAttribute('aria-label'), '下载')
    await noSecondAnimation(page)
    await page.getByRole('button', { name: /界面与颜色/ }).click()
    await page.getByRole('switch', { name: /减少动态效果/ }).check()
    await close(page)
    await navigate(page, '首页')
    assert.equal(await page.locator('html').getAttribute('data-view-moving'), null)
    assert.deepEqual(errors, [])
    results.push({
      profile: profile.name,
      uniqueCourses: 12,
      pastelTimetable: true,
      neutralListsAndDetails: true,
      metadataDeduplicated: true,
      singlePageAnimation: true,
      examSeparate: true,
      automaticRetry: true,
      pressAndExitMotion: true,
      expansion: true,
      interruptions: true,
      reducedMotion: true
    })
    await page.close()
  }
  await fs.writeFile(new URL('motion-results.json', evidence), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
} finally {
  await browser.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
