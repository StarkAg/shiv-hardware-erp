import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

// Run after building inventory-web. Uses a temporary local server and isolated browser profile.
const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(path => path && existsSync(path));
assert(executablePath, 'Set CHROME_PATH to a Chrome or Chromium executable.');
const root = resolve('inventory-web/dist');
const builtWorker = readFileSync(resolve(root, 'sw.js'), 'utf8');
assert(!builtWorker.includes('__BUILD_'));
const assets = JSON.parse('[' + builtWorker.match(/const CORE = \[([^\n]+)\]/)[1] + ']');
assert(assets.some(path => path.endsWith('.js')) && assets.some(path => path.endsWith('.css')));
let stage = 'old';
const oldHtml = '<!doctype html><title>Old shell</title><h1>Old shell</h1><script>navigator.serviceWorker.register("/sw.js")</script>';
const oldWorker = `const CACHE='shiv-inventory-shell-v2';self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/index.html'])).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(caches.match('/index.html'))});`;
const freshHtml = '<!doctype html><title>Fresh shell</title><h1>Fresh shell</h1>';
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  response.setHeader('Cache-Control', 'no-store');
  if (path === '/sw.js') {
    response.setHeader('Content-Type', 'application/javascript');
    return response.end(stage === 'old' ? oldWorker : stage === 'failed' ? builtWorker.replace(/const CACHE = .+/, "const CACHE = 'shiv-inventory-shell-failed'").replace("const CORE = [", "const CORE = ['/missing.js',") : builtWorker);
  }
  if (path === '/' || path === '/index.html') { response.setHeader('Content-Type', 'text/html'); return response.end(stage === 'old' ? oldHtml : freshHtml); }
  try {
    response.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    response.end(readFileSync(resolve(root, '.' + path)));
  } catch { response.statusCode = 404; response.end('missing'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await puppeteer.launch({ executablePath, headless: true, protocolTimeout: 15000 });
  const page = await browser.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await page.evaluate(async () => {
    localStorage.setItem('pending-stock', '[{"ref":"door","delta":1}]');
    const request = indexedDB.open('stock-test', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('queue');
    const db = await new Promise((resolve,reject) => {request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error)});
    const tx = db.transaction('queue','readwrite'); tx.objectStore('queue').put(7,'quantity');
    await new Promise(resolve => tx.oncomplete=resolve); db.close();
    await (await caches.open('unrelated-cache')).put('/keep', new Response('keep'));
  });
  stage = 'new';
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  try { await page.waitForFunction(() => document.title === 'Fresh shell', {timeout:10000}); } catch (err) { console.log(await page.evaluate(async () => {const r=await navigator.serviceWorker.getRegistration();return {title:document.title,active:r?.active?.state,installing:r?.installing?.state,waiting:r?.waiting?.state,keys:await caches.keys()}})); throw err; }
  const state = await page.evaluate(async () => {
    const request = indexedDB.open('stock-test', 1);
    const db = await new Promise(resolve => request.onsuccess=()=>resolve(request.result));
    const get = db.transaction('queue').objectStore('queue').get('quantity');
    const qty = await new Promise(resolve => get.onsuccess=()=>resolve(get.result)); db.close();
    return { caches: await caches.keys(), saved: localStorage.getItem('pending-stock'), qty };
  });
  assert(!state.caches.includes('shiv-inventory-shell-v2'));
  assert(state.caches.includes('unrelated-cache'));
  assert.equal(state.qty, 7);
  assert(state.saved.includes('delta'));
  const cacheName = state.caches.find(name => name.startsWith('shiv-inventory-shell-'));
  const cachedUrls = await page.evaluate(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname), cacheName);
  for (const asset of assets) assert(cachedUrls.includes(asset), `Asset not cached: ${asset}`);
  stage = 'failed';
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
    const installing = registration.installing;
    if (installing && installing.state !== 'redundant') await new Promise(resolve => installing.addEventListener('statechange', () => {if(installing.state==='redundant')resolve()}));
  });
  assert((await page.evaluate(() => caches.keys())).includes(cacheName));
  await page.setOfflineMode(true);
  await page.goto(origin + '/?offline-check', {waitUntil:'domcontentloaded'});
  assert.equal(await page.title(), 'Fresh shell');
  console.log('PASS: legacy cache upgraded, complete shell cached, failed update keeps working version, offline fallback works, stock data and unrelated caches preserved.');
} finally {
  await browser?.close();
  server.close();
}
