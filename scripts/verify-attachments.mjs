import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const base = process.env.PANEL_QA_URL || 'http://127.0.0.1:5180';
const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage();
const errors = [];
let popups = 0;
page.on('pageerror', error => errors.push(error.message));
page.on('popup', () => popups++);
const click = label => page.click('[aria-label="' + label + '"]');
try {
  await page.setViewport({ width: 1365, height: 900 });
  await page.goto(base + '/tests/browser/attachment-preview.html');
  await page.click('#open-photos');
  await page.waitForSelector('dialog[open] img');
  assert.equal(await page.$eval('dialog', el => el.matches(':modal')), true);
  await page.click('dialog img');
  assert.equal(popups, 0);
  await click('Zoom in');
  assert.equal(await page.$eval('output', el => el.textContent), '150%');
  await click('Rotate clockwise');
  assert.match(await page.$eval('dialog img', el => el.style.transform), /90deg/);
  await click('Next page');
  await page.waitForFunction(() => document.querySelector('dialog img')?.alt === '#0002');
  assert.equal(await page.$eval('output', el => el.textContent), '100%');
  await page.keyboard.press('Escape');
  assert.equal(await page.$('dialog'), null);
  assert.equal(await page.$eval('#narration', el => el.value), 'Keep this draft');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'open-photos');
  await page.click('#open-pdf');
  await page.waitForSelector('dialog img', { timeout: 20000 });
  assert.match(await page.$eval('.attachment-footer', el => el.textContent), /PDF page 1 of 2/);
  await click('Next page');
  await page.waitForFunction(() => document.querySelector('.attachment-footer')?.textContent.includes('PDF page 2 of 2'));
  await page.waitForSelector('dialog img');
  await click('Close preview');
  await page.click('#open-empty');
  assert.match(await page.$eval('[role="alert"]', el => el.textContent), /No attachments/);
  await click('Close preview');
  await page.click('#open-broken');
  await page.waitForSelector('[role="alert"]');
  assert.match(await page.$eval('[role="alert"]', el => el.textContent), /Could not load/);
  await click('Close preview');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.click('#open-photos');
  await page.waitForSelector('dialog img');
  const bounds = await page.$eval('.attachment-panel', el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });
  assert.ok(bounds.left >= 0 && bounds.right <= 390 && bounds.top >= 0 && bounds.bottom <= 844);
  await click('Zoom in');
  await page.screenshot({ path: '/tmp/shiv-attachment-mobile.png' });
  await click('Close preview');
  const converted = await page.evaluate(() => window.convertLongPdf());
  assert.deepEqual(converted, { count: 14, last: 'fourteen p14.jpg' });
  assert.deepEqual(errors, []);
  console.log('Attachment browser checks passed: photos, PDFs, zoom, rotation, page navigation, close/focus, empty/error states, mobile layout, 14-page upload conversion; no new tabs.');
} finally {
  await browser.close();
}
