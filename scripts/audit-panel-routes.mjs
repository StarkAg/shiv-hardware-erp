import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.PANEL_QA_URL || 'http://127.0.0.1:5180';
const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const routes = [
  '/home', '/paper', '/day',
  ...['sale', 'purchase', 'receipt', 'payment', 'grn', 'return', 'refund', 'quotation'].map(kind => '/bills?new=' + kind),
  '/quotations', '/cash-review', '/cash-pending', '/ledger/all', '/ledger/suppliers', '/ledger/customers',
  '/ledger/tocome', '/ledger/monthly', '/ledger/trial', '/ledger/bills', '/ledgers', '/profit', '/trash', '/printer-queue',
  '/pdf-viewer', '/m', '/receive',
];
const report = [];
const dir = '/tmp/shiv-panel-route-audit';
await mkdir(dir, { recursive: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  let errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  for (const route of routes) {
    errors = [];
    await page.goto(base + '/#' + route);
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 4000 }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 450));
    const details = await page.evaluate(() => ({
      url: location.hash,
      headings: [...document.querySelectorAll('h1,h2')].map(el => el.textContent.trim()).slice(0, 6),
      textLength: document.body.innerText.length,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2,
      brokenImages: [...document.images].filter(img => img.complete && img.naturalWidth === 0 && img.currentSrc).length,
      errorScreen: /Something went wrong|screen could not be drawn|Unexpected Application Error/.test(document.body.innerText),
    }));
    const row = { route, ...details, errors: [...new Set(errors)] };
    report.push(row);
    if (row.errorScreen || row.errors.length || row.horizontalOverflow || row.brokenImages) {
      await page.screenshot({ path: dir + '/' + route.replace(/\W/g, '_') + '.png', fullPage: true });
    }
    console.log(JSON.stringify(row));
  }
  await writeFile(dir + '/routes.json', JSON.stringify(report, null, 2));
} finally { await browser.close(); }
