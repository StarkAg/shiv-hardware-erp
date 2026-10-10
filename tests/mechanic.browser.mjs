import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { build } from 'esbuild'
import puppeteer from 'puppeteer-core'

// Isolated fixtures only: this test never authenticates or writes to the shop.
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) => p && existsSync(p))
assert(executablePath, 'Set CHROME_PATH to a Chromium executable.')
const root = resolve('.')
const mock = `import {useEffect,useState} from 'react'; import {getFunctionName} from 'convex/server';
export function useQuery(fn){const [,tick]=useState(0);useEffect(()=>{const update=()=>tick(x=>x+1);window.addEventListener('fixture',update);return()=>window.removeEventListener('fixture',update)},[]);return getFunctionName(fn)==='attendance:getStaff'?['Vijay','Anup']:window.orders}
const client={connectionState:()=>({isWebSocketConnected:window.connected!==false})}; export const useConvex=()=>client;
export const useMutation=()=>async(args)=>{if(window.failSend)throw {data:{message:'Test send failed. Draft retained.'}};window.sent.push(args);const at=Date.now();window.orders=window.orders.map(o=>o.id===args.billId?{...o,sizes:{...args,at},measuredAt:args.measured?at:o.measuredAt}:o);window.dispatchEvent(new Event('fixture'));return {at,measuredAt:args.measured?at:0}};`
const bundled = await build({
  stdin: { contents: "import React from 'react';import{createRoot}from'react-dom/client';import App from './mechanic-web/src/App.jsx';createRoot(document.getElementById('root')).render(<App/>);", resolveDir: root, loader: 'jsx' },
  bundle: true, write: false, format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'fixture-convex', setup(b) {
    b.onResolve({ filter: /^convex\/react$/ }, () => ({ path: 'fixture', namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: mock, loader: 'js', resolveDir: root }))
  } }],
})
const fixture = { id: 'test-order', number: 'Q-014', quotation: true, date: '2026-10-10', customerName: 'Sample Customer', customerPhone: '9999999999', site: 'Main Road, first floor', notes: 'Measure both door openings.', visitBy: 'Gopal & Bandhu', measuredAt: 0, sizes: null, pieces: [{ key: 'door#1', what: 'WPC door', of: '1 of 2', qty: 1 }, { key: 'door#2', what: 'WPC door', of: '2 of 2', qty: 1 }] }
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  response.setHeader('Cache-Control', 'no-store')
  if (path === '/fixture.html') {
    response.setHeader('Content-Type', 'text/html')
    return response.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script>window.orders=${JSON.stringify([fixture, { ...fixture, id: 'other', visitBy: 'Anup', customerName: 'Other mechanic customer' }])};window.sent=[];</script><script type="module" src="/fixture.js"></script>`)
  }
  if (path === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); return response.end(bundled.outputFiles[0].text) }
  if (path === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); return response.end(readFileSync('mechanic-web/src/index.css')) }
  const file = resolve('mechanic-web/dist', '.' + (path === '/' ? '/index.html' : path))
  if (!file.startsWith(resolve('mechanic-web/dist') + '/') && !file.startsWith(resolve('mechanic-web/dist') + '\\')) { response.writeHead(403); return response.end() }
  try { response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' })[extname(file)] || 'application/octet-stream'); response.end(readFileSync(file)) }
  catch { response.writeHead(404); response.end('Not found') }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await puppeteer.launch({ executablePath, headless: true })
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('dialog', (dialog) => dialog.accept())
  await page.evaluateOnNewDocument(() => localStorage.setItem('shiv-mechanic:name', JSON.stringify('Vijay')))
  await page.goto(origin + '/fixture.html')
  // One mechanic group, so no name to pick.
  assert.equal(await page.$('.name-label'), null)
  assert.equal(await page.$$eval('.order-card', (nodes) => nodes.length), 1)
  // Server subscription changes reach the open list without a reload.
  await page.evaluate(() => { window.orders = window.orders.map((o) => ({ ...o, visitBy: 'Gopal & Bandhu' })); window.dispatchEvent(new Event('fixture')) })
  await page.waitForFunction(() => document.querySelectorAll('.order-card').length === 2)
  await page.evaluate(() => { window.orders = window.orders.map((o) => o.id === 'other' ? { ...o, visitBy: 'Anup' } : o); window.dispatchEvent(new Event('fixture')) })
  await page.waitForFunction(() => document.querySelectorAll('.order-card').length === 1)
  mkdirSync('.probe/mechanic-screens', { recursive: true })
  await page.screenshot({ path: '.probe/mechanic-screens/list.png', fullPage: true })
  await page.click('.order-card')
  await page.waitForSelector('[aria-label="Width of piece 1"]')
  await page.type('[aria-label="Width of piece 1"]', '24 1/2')
  await page.type('[aria-label="Height of piece 1"]', '72')
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('shiv-mechanic:draft:test-order')).pieces[0].w), '24 1/2')
  await page.reload()
  await page.click('.order-card')
  assert.equal(await page.$eval('[aria-label="Width of piece 1"]', (e) => e.value), '24 1/2')
  await page.evaluate(() => { window.connected = false })
  await page.waitForFunction(() => document.querySelector('.live').textContent.includes('Offline'))
  await page.click('.save-buttons button')
  assert.equal(await page.evaluate(() => window.sent.length), 0)
  assert((await page.$eval('.save-bar', (e) => e.textContent)).includes('Connect to the internet'))
  await page.evaluate(() => { window.connected = true })
  await page.waitForFunction(() => document.querySelector('.live').textContent === 'Live')
  await page.click('.save-buttons button')
  await page.waitForFunction(() => window.sent.length === 1)
  assert.equal(await page.evaluate(() => window.sent[0].measured), false)
  assert.equal(await page.evaluate(() => window.sent[0].by), 'Gopal & Bandhu')
  assert.equal(await page.evaluate(() => localStorage.getItem('shiv-mechanic:draft:test-order')), null)
  await page.type('[aria-label="Width of piece 2"]', '30')
  await page.evaluate(() => { window.failSend = true })
  await page.click('.primary')
  await page.waitForFunction(() => document.body.textContent.includes('Test send failed'))
  assert(await page.evaluate(() => !!localStorage.getItem('shiv-mechanic:draft:test-order')))
  await page.evaluate(() => { window.failSend = false; window.orders[0].sizes.at += 100; window.dispatchEvent(new Event('fixture')) })
  await page.waitForFunction(() => document.body.textContent.includes('Newer sizes arrived'))
  assert(await page.$eval('.primary', (e) => e.disabled))
  await page.click('.error button')
  await page.type('[aria-label="Width of piece 2"]', '30')
  await page.type('[aria-label="Height of piece 2"]', '80')
  await page.screenshot({ path: '.probe/mechanic-screens/detail.png', fullPage: true })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
  await page.setViewport({ width: 320, height: 740, deviceScaleFactor: 1 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: '.probe/mechanic-screens/dark-small.png', fullPage: true })
  await page.click('.primary')
  await page.waitForFunction(() => window.sent.length === 2)
  assert.equal(await page.evaluate(() => window.sent[1].measured), true)
  await page.evaluate(() => { window.orders = []; window.dispatchEvent(new Event('fixture')) })
  await page.waitForFunction(() => document.body.textContent.includes('billed or removed'))
  assert(await page.$eval('.primary', (e) => e.disabled))
  assert.deepEqual(errors, [])

  // Real production bundle: PIN gate plus complete offline shell, no shop calls.
  const context = await browser.createBrowserContext()
  const prod = await context.newPage()
  await prod.setRequestInterception(true)
  prod.on('request', (request) => request.url().startsWith(origin) ? request.continue() : request.abort())
  await prod.goto(origin)
  await prod.waitForSelector('#shop-pin')
  await prod.waitForFunction(() => navigator.serviceWorker.controller)
  const cached = await prod.evaluate(async () => { const name = (await caches.keys()).find((k) => k.startsWith('shiv-mechanic-')); return (await (await caches.open(name)).keys()).map((r) => r.url) })
  assert(cached.some((u) => /\/assets\/.*\.js$/.test(u)))
  assert(cached.some((u) => /\/assets\/.*\.css$/.test(u)))
  await prod.setOfflineMode(true)
  await prod.reload()
  await prod.waitForSelector('#shop-pin')
  console.log('PASS: mechanic filtering, draft recovery, offline send, partial/complete sends, failed send retention, conflict protection, closed orders, 320px layout, PIN gate and offline production shell.')
} finally {
  await browser?.close()
  server.close()
}
