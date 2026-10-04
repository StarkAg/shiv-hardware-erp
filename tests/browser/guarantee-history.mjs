// Run against a production preview: npm run build; npm run preview -- --port 5191
// Uses a fresh browser profile, synthetic cards and blocked external requests.
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const base = process.argv[2] || 'http://localhost:5191'
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--host-resolver-rules=MAP *.convex.cloud ~NOTFOUND, MAP *.convex.site ~NOTFOUND'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1366, height: 900 })
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    const url = request.url()
    if (url.startsWith(base + '/') || url.startsWith('data:') || url.startsWith('blob:')) request.continue()
    else request.abort()
  })
  await page.evaluateOnNewDocument(() => {
    if (localStorage.getItem('guarantee-test-seeded')) return
    localStorage.clear()
    const guarantees = Array.from({ length: 3 }, (_, index) => ({
      id: `test-card-${index}`, number: `GC-TEST-000${index + 1}`,
      date: '2026-09-12', token: `test-token-${index}`,
      customer: { name: `Test Customer ${index + 1}`, mobile: '', address: '', uid: '' },
      items: [],
    }))
    localStorage.setItem('shiv-panel:v7', JSON.stringify({ guarantees }))
    localStorage.setItem('guarantee-test-seeded', '1')
  })
  await page.goto(`${base}/counter.html#/guarantee/history`)
  const rowCount = () => page.$$eval('tbody tr button[title="Delete"]', (buttons) => buttons.length)
  const open = () => page.click('tbody tr button[title="Delete"]')
  const gone = () => page.waitForSelector('[role="dialog"]', { hidden: true })
  await page.waitForSelector('tbody tr button[title="Delete"]')
  assert.equal(await rowCount(), 3)
  await open()
  await page.waitForSelector('[role="dialog"]')
  const layout = await page.$eval('[role="dialog"]', (dialog) => {
    const backdrop = dialog.parentElement
    const [cancel, confirm] = dialog.querySelectorAll('button')
    const a = cancel.getBoundingClientRect(), b = confirm.getBoundingClientRect()
    const box = dialog.getBoundingClientRect()
    return {
      fixed: getComputedStyle(backdrop).position,
      gap: b.left - a.right,
      centered: Math.abs(box.left + box.width / 2 - innerWidth / 2) < 2,
      portaled: backdrop.parentElement.parentElement === document.body,
      focused: document.activeElement.textContent,
    }
  })
  assert.equal(layout.fixed, 'fixed')
  assert.ok(layout.gap >= 8)
  assert.ok(layout.centered && layout.portaled)
  assert.equal(layout.focused, 'Cancel')
  await page.keyboard.down('Shift')
  await page.keyboard.press('Tab')
  await page.keyboard.up('Shift')
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Delete')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Cancel')
  await page.keyboard.press('Escape')
  await gone()
  assert.equal(await rowCount(), 3)
  await open()
  await page.click('[role="dialog"] .btn.ghost')
  await gone()
  assert.equal(await rowCount(), 3)
  await open()
  await page.screenshot({ path: process.env.TEMP + '/guarantee-delete-dialog.png' })
  await page.click('[role="dialog"] .btn.danger')
  await gone()
  assert.equal(await rowCount(), 2)
  await page.reload()
  await page.waitForSelector('tbody tr button[title="Delete"]')
  assert.equal(await rowCount(), 2)
  assert.equal(await page.$eval('tbody', (el) => el.textContent.includes('GC-TEST-0001')), false)
  await page.setViewport({ width: 390, height: 844 })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await open()
  const fits = await page.$eval('[role="dialog"]', (dialog) => {
    const box = dialog.getBoundingClientRect()
    return box.left >= 0 && box.right <= innerWidth && Boolean(dialog.closest('.dark'))
  })
  assert.ok(fits)
  await page.click('[role="dialog"] .btn.danger')
  await gone()
  assert.equal(await rowCount(), 1)
  await open()
  await page.click('[role="dialog"] .btn.danger')
  await gone()
  assert.equal(await rowCount(), 0)
  console.log('PASS: styled, centered dialog; focus loop; Cancel/Escape; each row deletes; reload persistence; mobile/dark layout.')
} finally {
  await browser.close()
}
