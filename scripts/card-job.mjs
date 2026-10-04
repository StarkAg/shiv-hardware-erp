#!/usr/bin/env node
// Guarantee-card job: one command from "what's on the bill" to printed PVC cards.
//
//   node scripts/card-job.mjs <job.json> --preview     render the fronts to PNG (nothing saved/printed)
//   node scripts/card-job.mjs <job.json> --print       number, save to cloud, print slot 1 (+ slot 2)
//        [--printer "<name>"]                          override the Epson queue (default COLOR_PRINTER)
//        [--out <dir>]                                 where the PNGs go (default %TEMP%\shiv-card-job)
//        [--json]                                      end with one "@@RESULT {…}" line for callers
//
// Prints the TEXT side only — the back is the shop's pre-printed card for that
// brand + period (Desktop\Epson designs). Same template, fit rules, QR and tray
// geometry as Shiv Quotation's direct print, without driving its screen.
//
// job.json:
// {
//   "date": "2026-03-10",                        // optional, default today
//   "customer": { "name": "…", "mobile": "…", "uid": "…" },
//   "whatsapp": false,                           // send the "card ready" WhatsApp (needs print server)
//   "cards": [                                   // 1 or 2 cards: [0] → slot 1, [1] → slot 2
//     { "years": 5,                              // one guarantee period per card (its seal is pre-printed);
//                                                // omitted → the first item's brand years from Rates
//       "items": [ { "thickness": "19MM", "brand": "Milton Super Solid",
//                    "size": "7 X 4", "qty": 25, "amount": 68600 } ] }
//
// Size: write it the way the bill does. Feet on the bill ("7x4") → "size": "7 X 4",
// printed as-is. Inches on the bill → "length": "82 4/8", "height": "35 4/8".
//   ]
// }
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(ROOT, 'package.json'))
const args = process.argv.slice(2)
const PRINT = args.includes('--print')
const PREVIEW = args.includes('--preview') || !PRINT
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : '')
const printerArg = opt('--printer')
const outArg = opt('--out')
const JSON_OUT = args.includes('--json')
const jobPath = args.find((a, i) => !a.startsWith('--') && !['--printer', '--out'].includes(args[i - 1]))
if (!jobPath) {
  console.error('usage: node scripts/card-job.mjs <job.json> --preview | --print [--printer "<name>"]')
  process.exit(2)
}

// ── settings ───────────────────────────────────────────────────────────────
function readEnv(file) {
  try {
    return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
      .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]))
  } catch { return {} }
}
const appEnv = readEnv(join(ROOT, '.env.local'))
const psEnv = readEnv(join(ROOT, 'print-server', '.env'))
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v))
const CFG = {
  convex: (appEnv.VITE_CONVEX_URL || '').replace(/\/+$/, ''),
  cloudApi: (appEnv.VITE_CLOUD_API_URL || '').replace(/\/+$/, ''),
  cloudKey: appEnv.VITE_CLOUD_API_KEY || '',
  site: (psEnv.GUARANTEE_PUBLIC_URL || appEnv.VITE_GUARANTEE_PUBLIC_URL || 'https://www.shivhardware.store/Gaurantee').replace(/\/+$/, ''),
  // The short link (qr-redirect/) printed on every card: <short>/<number>/<token>.
  short: (psEnv.GUARANTEE_SHORT_URL ?? appEnv.VITE_GUARANTEE_SHORT_URL ?? 'https://gcvf.vercel.app').replace(/\/+$/, ''),
  printer: printerArg || psEnv.COLOR_PRINTER || 'EPSON L8050 Series',
  slot1: [num(psEnv.EPSON_CARD_SLOT_LEFT_MM, 8), num(psEnv.EPSON_CARD_SLOT_TOP_MM, 35)],
  slot2: [num(psEnv.EPSON_CARD_SLOT2_LEFT_MM, 82), num(psEnv.EPSON_CARD_SLOT2_TOP_MM, 35)],
  offset: [num(psEnv.EPSON_CARD_OFFSET_X_MM, 0), num(psEnv.EPSON_CARD_OFFSET_Y_MM, 0)],
  scale: num(psEnv.EPSON_CARD_SCALE_PERCENT, 100),
  printServer: `http://localhost:${psEnv.PORT || 3333}`,
}
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync)

// ── job → documents ────────────────────────────────────────────────────────
const job = JSON.parse(readFileSync(jobPath, 'utf8').replace(/^﻿/, '')) // tolerate a Windows BOM
const fail = (msg) => {
  console.error(`Error: ${msg}`)
  if (JSON_OUT) console.log(`@@RESULT ${JSON.stringify({ ok: false, error: msg })}`)
  process.exit(1)
}
if (!job.customer?.name) fail('customer.name is required')
if (!Array.isArray(job.cards) || !job.cards.length) fail('cards: give 1 or 2 cards')
if (job.cards.length > 2) fail('the tray holds 2 cards — split the job into passes of 2')

const brandYears = (() => {
  const years = new Map()
  try {
    const walk = (o) => {
      if (Array.isArray(o)) return o.forEach(walk)
      if (o && typeof o === 'object') {
        if (typeof o.name === 'string' && typeof o.guaranteeYears === 'number' && o.guaranteeYears > 0) years.set(o.name.trim().toLowerCase(), o.guaranteeYears)
        Object.values(o).forEach(walk)
      }
    }
    walk(JSON.parse(readFileSync(join(ROOT, 'print-server', 'data', 'catalog.json'), 'utf8')))
  } catch { /* no catalog: years must be given */ }
  return years
})()

/** "84", "84 4/8", "82.5" → { inches, soot } (soot = eighths). */
function dim(v) {
  const s = String(v ?? '').trim()
  if (!s) return null
  const frac = s.match(/^(\d+)\s+(\d)\s*\/\s*8$/)
  if (frac) return { inches: Number(frac[1]), soot: Number(frac[2]) }
  const n = Number(s)
  if (Number.isNaN(n)) fail(`size "${s}" — use inches like 84 or 82 4/8`)
  return { inches: Math.floor(n), soot: Math.round((n - Math.floor(n)) * 8) }
}

const day = job.date || new Date().toISOString().slice(0, 10)
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail(`date "${day}" — use YYYY-MM-DD`)
const dateIso = new Date(`${day}T12:00:00`).toISOString()
const customer = { id: `job-${Date.now().toString(36)}`, name: job.customer.name.trim(), mobile: String(job.customer.mobile ?? '').trim(), uid: String(job.customer.uid ?? '').replace(/\s+/g, ''), address: String(job.customer.address ?? '').trim() }

const cards = job.cards.map((card, i) => {
  if (!card.items?.length) fail(`card ${i + 1} has no items`)
  const years = card.years ?? brandYears.get(String(card.items[0].brand ?? '').trim().toLowerCase())
  if (!years) fail(`card ${i + 1}: give "years" (brand "${card.items[0].brand}" has no years in Rates)`)
  const items = card.items.map((it) => {
    if (!it.brand) fail(`card ${i + 1}: every item needs a brand`)
    const own = brandYears.get(String(it.brand).trim().toLowerCase())
    if (card.years == null && own && own !== years) fail(`card ${i + 1} mixes ${years} and ${own} years — one period per card (its seal is pre-printed)`)
    const sizeLabel = it.size ? String(it.size).trim().replace(/\s*[xX×]\s*/g, ' X ') : null
    return {
      brandName: String(it.brand).trim(),
      guaranteeYears: years,
      thickness: it.thickness ? String(it.thickness).trim() : null,
      // As the bill wrote it (feet stay feet); inches only when given as length/height.
      sizeLabel,
      height: sizeLabel ? null : dim(it.length),
      width: sizeLabel ? null : dim(it.height),
      qty: it.qty != null && it.qty !== '' ? Number(it.qty) : null,
      amount: it.amount != null && it.amount !== '' ? Number(it.amount) : null,
    }
  })
  const first = items[0]
  return { years, items, height: first.height ?? { inches: 0, soot: 0 }, width: first.width ?? { inches: 0, soot: 0 }, qty: first.qty ?? 1 }
})

// ── numbering + secrets (print only) ───────────────────────────────────────
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const mintToken = () => Array.from(randomBytes(20), (b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join('')
async function convexQuery(path, a) {
  const res = await fetch(`${CFG.convex}/api/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, args: a, format: 'json' }) })
  const json = await res.json()
  if (json.status !== 'success') throw new Error(json.errorMessage || `Convex ${path} failed`)
  return json.value
}
const year = new Date().getFullYear()
let refs
if (PRINT) {
  if (!CFG.convex || !CFG.cloudApi) fail('VITE_CONVEX_URL / VITE_CLOUD_API_URL missing in .env.local')
  const latest = await convexQuery('documents:latestGuaranteeSeq', { year })
  refs = cards.map((_, i) => {
    const number = `GC-${year}-${String(latest + 1 + i).padStart(4, '0')}`
    return { number, token: mintToken() }
  })
} else {
  refs = cards.map((_, i) => ({ number: `DRAFT-${i + 1}`, token: 'DRAFT' }))
}
const docs = cards.map((c, i) => ({
  id: refs[i].number,
  number: refs[i].number,
  token: refs[i].token,
  date: dateIso,
  updatedAt: Date.now(),
  customer,
  category: 'readymade-door',
  height: c.height,
  width: c.width,
  qty: c.qty,
  items: c.items,
}))

// ── render the fronts (same template + fit script as the print) ────────────
const { buildGuaranteeHtml, CARD_W_MM, CARD_H_MM } = await import(pathToFileURL(join(ROOT, 'print-server', 'template.mjs')).href)
const puppeteer = require('puppeteer-core')
const outDir = outArg || join(tmpdir(), 'shiv-card-job')
mkdirSync(outDir, { recursive: true })
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage()
await page.setContent('<!doctype html><html></html>')
const w = Math.ceil((CARD_W_MM / 25.4) * 96)
const h = Math.ceil((CARD_H_MM / 25.4) * 96)
await page.setViewport({ width: w, height: h, deviceScaleFactor: 4 })
const pngs = []
for (const [i, doc] of docs.entries()) {
  const qrUrl = CFG.short
    ? `${CFG.short}/${encodeURIComponent(doc.number)}/${encodeURIComponent(doc.token)}`
    : `${CFG.site}/${encodeURIComponent(doc.number)}?k=${encodeURIComponent(doc.token)}`
  await page.setContent(await buildGuaranteeHtml({ ...doc, qrUrl }, 'card'), { waitUntil: 'load' })
  const file = join(outDir, `${PRINT ? doc.number : `preview-slot${i + 1}`}.png`)
  writeFileSync(file, await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: w, height: h } }))
  pngs.push(file)
}
await browser.close()

const summary = docs.map((d, i) =>
  `  slot ${i + 1}: ${d.number} · ${cards[i].years} yr · ${d.items.length} item(s) · ₹${d.items.reduce((s, it) => s + (it.amount || 0), 0)}  (${d.items.map((it) => `${it.thickness ?? ''} ${it.brandName}`.trim()).join(', ')})`)
console.log(`${customer.name} · ${customer.mobile || 'no mobile'} · UID ${customer.uid || 'N/A'} · ${day.split('-').reverse().join('-')}`)
console.log(summary.join('\n'))

const result = () => ({ ok: true, numbers: docs.map((d) => d.number), years: cards.map((c) => c.years), pngs })
if (!PRINT) {
  console.log(`preview: ${pngs.join('  ')}`)
  if (JSON_OUT) console.log(`@@RESULT ${JSON.stringify(result())}`)
  process.exit(0)
}

// ── save to the cloud (same route the apps use) ────────────────────────────
for (const doc of docs) {
  const res = await fetch(`${CFG.cloudApi}/api/guarantees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': CFG.cloudKey },
    body: JSON.stringify({ localId: doc.id, number: doc.number, customer: doc.customer, document: doc }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.ok) fail(`cloud save of ${doc.number} failed: ${JSON.stringify(json)}`)
}
console.log('saved to cloud')

// ── print (text side) ──────────────────────────────────────────────────────
const psArgs = [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'print-server', 'tools', 'print-card-gdi.ps1'),
  '-ImagePath', pngs[0],
  '-PrinterName', CFG.printer,
  '-DevmodeFile', join(ROOT, 'print-server', 'data', 'epson-card.devmode'),
  '-Copies', '1',
  '-JobName', `Shiv guarantee ${docs.map((d) => d.number).join(' + ')}`,
  '-SlotLeftMm', String(CFG.slot1[0]), '-SlotTopMm', String(CFG.slot1[1]),
  '-Slot2LeftMm', String(CFG.slot2[0]), '-Slot2TopMm', String(CFG.slot2[1]),
  '-CardWidthMm', String(CARD_W_MM), '-CardHeightMm', String(CARD_H_MM),
  '-OffsetXmm', String(CFG.offset[0]), '-OffsetYmm', String(CFG.offset[1]),
  '-ScalePercent', String(CFG.scale),
]
if (pngs[1]) psArgs.push('-ImagePath2', pngs[1])
execFileSync('powershell.exe', psArgs, { stdio: 'inherit', windowsHide: true, timeout: 120000 })
console.log(`printed → ${CFG.printer}`)
if (!outArg) for (const f of pngs) rmSync(f, { force: true })

// ── WhatsApp (only when the job asks) ──────────────────────────────────────
if (job.whatsapp && customer.mobile) {
  try {
    const res = await fetch(`${CFG.printServer}/whatsapp-notify-customer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile: customer.mobile, name: customer.name }) })
    console.log(res.ok ? 'WhatsApp sent' : `WhatsApp failed (HTTP ${res.status})`)
  } catch (err) { console.log(`WhatsApp failed: ${err.message}`) }
} else {
  console.log('WhatsApp: not sent')
}
if (JSON_OUT) console.log(`@@RESULT ${JSON.stringify(result())}`)
