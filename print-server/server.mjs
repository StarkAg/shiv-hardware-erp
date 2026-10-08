// Shiv Hardware Print Server
// POST /scan-bill  { image, mediaType }             -> guarantee card data
// POST /print      { quote, copies }                -> PDF -> printer
// GET  /whatsapp-print                              -> mobile upload page
// POST /whatsapp-print/jobs { files, copies }       -> uploaded PDFs/images -> printer
// DROP_PRINT_DIR ("~/Print Drop")                   -> dropped PDFs/images -> printer

import { existsSync, readFileSync } from 'fs'
try {
  readFileSync(new URL('.env', import.meta.url), 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=')
    if (k?.trim() && !k.startsWith('#')) process.env[k.trim()] = v.join('=').trim()
  })
} catch {}

import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'
import { execFile } from 'child_process'
import { appendFile, writeFile, unlink, mkdir, rm, readdir, readFile, rename, stat, open } from 'fs/promises'
import { networkInterfaces, tmpdir, homedir } from 'os'
import { join, basename, extname } from 'path'
import { fileURLToPath } from 'url'
import {
  buildGuaranteeHtml, buildQuotationHtml, buildBillHtml,
  CARD_W_MM, CARD_H_MM, CARD_SAFE_MM, CARD_PRINT_W_MM, CARD_PRINT_H_MM,
} from './template.mjs'
import { registerCardScan } from './card-scan.mjs'

const PORT = Number(process.env.PORT) || 3333
const COLOR_PRINTER = process.env.COLOR_PRINTER || process.env.PRINT_PRINTER || 'EPSON L8050 Series'
const BW_PRINTER = process.env.BW_PRINTER || process.env.PRINT_PRINTER || 'NPI33F31D (HP LaserJet Tank MFP 2606sdw)'
const BW_FALLBACK_PRINTER = process.env.BW_FALLBACK_PRINTER || COLOR_PRINTER
const BW_FALLBACK_ON_ERROR = !['0', 'false', 'no', 'off'].includes(String(process.env.BW_FALLBACK_ON_ERROR ?? 'true').trim().toLowerCase())
// Color (cp) fallback: when the EPSON color printer is offline/erroring, print
// the color job on the HP (BW) printer instead (it comes out monochrome).
const COLOR_FALLBACK_PRINTER = process.env.COLOR_FALLBACK_PRINTER || BW_PRINTER
const COLOR_FALLBACK_ON_ERROR = !['0', 'false', 'no', 'off'].includes(String(process.env.COLOR_FALLBACK_ON_ERROR ?? 'true').trim().toLowerCase())
const PRINT_PRINTER = process.env.PRINT_PRINTER || BW_PRINTER
// When the chosen printer is offline/unreachable, auto-route to any printer that
// is actually online. Set PRINTER_AUTO_SELECT=false to always use the fixed printer.
const PRINTER_AUTO_SELECT = !['0', 'false', 'no', 'off'].includes(String(process.env.PRINTER_AUTO_SELECT ?? 'true').trim().toLowerCase())
const PRINT_SERVER_PUBLIC_URL = (process.env.PRINT_SERVER_PUBLIC_URL || '').replace(/\/+$/, '')
// Base URL the printed guarantee-card QR points to (opens the online card view).
// Prefer a public viewer (e.g. Vercel) so a customer's scan works off the shop
// Wi-Fi; falls back to the request host so the QR at least works on the LAN.
const GUARANTEE_PUBLIC_URL = (process.env.GUARANTEE_PUBLIC_URL || '').replace(/\/+$/, '')
// The short link (qr-redirect/) printed on every card: <short>/<number>/<token>.
// Same as GUARANTEE_SHORT_URL in src/lib/printServer.ts; an empty value in .env
// turns it off and prints the long link.
const GUARANTEE_SHORT_URL = (process.env.GUARANTEE_SHORT_URL ?? 'https://gcvf.vercel.app').replace(/\/+$/, '')
const CLOUD_API_URL = (process.env.CLOUD_API_URL || '').replace(/\/+$/, '')
const CLOUD_API_KEY = process.env.CLOUD_API_KEY || ''
const PRINTER_AGENT_ID = process.env.PRINTER_AGENT_ID || 'shiv-shop-printer'
const CLOUD_POLL_INTERVAL_MS = Math.max(3000, Number(process.env.CLOUD_POLL_INTERVAL_MS) || 7000)
const CLOUD_HEARTBEAT_INTERVAL_MS = Math.max(15000, Number(process.env.CLOUD_HEARTBEAT_INTERVAL_MS) || 30000)
const SUMATRA_PDF_PATH = process.env.SUMATRA_PDF_PATH || findSumatraPdfPath()
const EPSON_CARD_PRINT_SETTINGS = (process.env.EPSON_CARD_PRINT_SETTINGS || 'noscale,color,portrait,bin=Disc/ID Card Tray')
  .split(',')
  .map(setting => setting.trim())
  .filter(Boolean)
const EPSON_CARD_PRINT_ENGINE = (process.env.EPSON_CARD_PRINT_ENGINE || 'sumatra').toLowerCase()
const EPSON_CARD_DEVMODE_PATH = process.env.EPSON_CARD_DEVMODE_PATH || fileURLToPath(new URL('data/epson-card.devmode', import.meta.url))
const EPSON_CARD_GDI_SCRIPT = fileURLToPath(new URL('tools/print-card-gdi.ps1', import.meta.url))
const EPSON_CARD_EXCEL_SCRIPT = fileURLToPath(new URL('tools/print-card-excel.ps1', import.meta.url))
const EPSON_CARD_OFFSET_X_MM = Number(process.env.EPSON_CARD_OFFSET_X_MM) || 0
const EPSON_CARD_OFFSET_Y_MM = Number(process.env.EPSON_CARD_OFFSET_Y_MM) || 0
const EPSON_CARD_SCALE_PERCENT = Number(process.env.EPSON_CARD_SCALE_PERCENT) || 100
const EPSON_CARD_SLOT_LEFT_MM = Number(process.env.EPSON_CARD_SLOT_LEFT_MM ?? 13)
const EPSON_CARD_SLOT_TOP_MM = Number(process.env.EPSON_CARD_SLOT_TOP_MM ?? 25)
const EPSON_CARD_SLOT2_LEFT_MM = Number(process.env.EPSON_CARD_SLOT2_LEFT_MM ?? 78)
const EPSON_CARD_SLOT2_TOP_MM = Number(process.env.EPSON_CARD_SLOT2_TOP_MM ?? EPSON_CARD_SLOT_TOP_MM)
// Card geometry lives in template.mjs so the rendered HTML and the tray
// placement below can never drift apart. CARD_PRINT_* is the printer-safe
// area — the Epson clips the extreme card edge, so nothing is laid out there.
const CARD_WIDTH_MM = CARD_W_MM
const CARD_HEIGHT_MM = CARD_H_MM
const CHROME_PATH = findChromePath()
const JSON_MAX_TOKENS = 2048
const HONORIFICS = new Set(['jee', 'ji', 'sir', 'madam'])
const NAME_WORD_RE = /^[a-z][a-z'.-]{2,}$/i
const NAME_CORRECTIONS_URL = new URL('data/name-corrections.json', import.meta.url)
const PLACE_CORRECTIONS_URL = new URL('data/place-corrections.json', import.meta.url)
const PRODUCT_CORRECTIONS_URL = new URL('data/product-corrections.json', import.meta.url)
const SCAN_FEEDBACK_URL = new URL('data/scan-feedback.jsonl', import.meta.url)
const BILLS_STORE_URL   = new URL('data/bills.jsonl',  import.meta.url)
const BILLS_JSON_URL    = new URL('data/bills.json',   import.meta.url)
const GUARANTEES_JSON_URL = new URL('data/guarantees.json', import.meta.url)
const CATALOG_STORE_URL = new URL('data/catalog.json', import.meta.url)

async function saveBillToStore(bill) {
  try {
    const entry = JSON.stringify({ ...bill, _printedAt: new Date().toISOString() })
    await appendFile(BILLS_STORE_URL, entry + '\n', 'utf8')
  } catch (err) {
    console.warn('[bills-store] failed to save bill:', err.message ?? err)
  }
}

function loadBillsFromStore() {
  try {
    const raw = readFileSync(BILLS_STORE_URL, 'utf8')
    return raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
  } catch {
    return []
  }
}

async function saveCatalog(data) {
  try {
    const savedAt = new Date().toISOString()
    await writeFile(CATALOG_STORE_URL, JSON.stringify({ ...data, _savedAt: savedAt }, null, 2), 'utf8')
    broadcastSync('catalog', { savedAt })
  } catch (err) {
    console.warn('[catalog-store] failed to save:', err.message ?? err)
  }
}

function loadCatalog() {
  try {
    return JSON.parse(readFileSync(CATALOG_STORE_URL, 'utf8'))
  } catch {
    return null
  }
}

async function saveBillsJson(bills) {
  try {
    const savedAt = new Date().toISOString()
    await writeFile(BILLS_JSON_URL, JSON.stringify({ bills, _savedAt: savedAt }, null, 2), 'utf8')
    broadcastSync('bills', { count: bills.length, savedAt })
  } catch (err) {
    console.warn('[bills-json] failed to save:', err.message ?? err)
  }
}

function loadBillsJson() {
  try {
    const parsed = JSON.parse(readFileSync(BILLS_JSON_URL, 'utf8'))
    return Array.isArray(parsed?.bills) ? parsed.bills : null
  } catch {
    return null
  }
}

// ── Guarantees store (saved/printed guarantee cards; backs the QR web view) ──
// Snapshot of all generated guarantee cards so that scanning a QR resolves to
// the same card regardless of which device printed it.
async function saveGuaranteesJson(guarantees) {
  try {
    const savedAt = new Date().toISOString()
    await writeFile(GUARANTEES_JSON_URL, JSON.stringify({ guarantees, _savedAt: savedAt }, null, 2), 'utf8')
    broadcastSync('guarantees', { count: guarantees.length, savedAt })
  } catch (err) {
    console.warn('[guarantees-json] failed to save:', err.message ?? err)
  }
}

function loadGuaranteesJson() {
  try {
    const parsed = JSON.parse(readFileSync(GUARANTEES_JSON_URL, 'utf8'))
    return Array.isArray(parsed?.guarantees) ? parsed.guarantees : null
  } catch {
    return null
  }
}

function findGuaranteeByNumber(number) {
  if (!number) return null
  const all = loadGuaranteesJson() ?? []
  return all.find((g) => String(g.number) === String(number)) ?? null
}

// Mobile-first viewer for the QR target on phones: a clean, responsive page
// showing the customer's Aadhaar (UID) + phone and the guaranteed items, plus
// an "Open PDF" button for the full print-ready A4 card.
function buildMobileGuaranteePageHtml(document) {
  const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]
  ))
  const escapedNumber = esc(document.number || '')
  const dateStr = new Date(document.date).toLocaleDateString('en-GB')
  const cust = document.customer || {}

  const fmtDim = (d) => (d && (d.inches || d.soot))
    ? (d.soot > 0 ? `${d.inches || 0} ${d.soot}/8"` : `${d.inches}"`)
    : ''
  const fmtSize = (h, w) => { const a = fmtDim(h), b = fmtDim(w); return a && b ? `${a} × ${b}` : (a || b || '') }

  const items = Array.isArray(document.items) ? document.items : []
  const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0)

  const itemsHtml = items.length ? items.map((it) => {
    const size = fmtSize(it.height, it.width)
    const gy = Number(it.guaranteeYears) || 0
    const sub = [it.thickness ? esc(it.thickness) : '', size].filter(Boolean).join(' · ')
    return `<div class="item">
      <div class="item-info">
        <div class="brand">${esc(it.brandName || '—')}</div>
        ${sub ? `<div class="sub">${sub}</div>` : ''}
      </div>
      <div class="item-meta">
        ${gy > 0 ? `<span class="badge">${gy} yr</span>` : ''}
        ${it.qty ? `<span class="qty">${esc(it.qty)} pc</span>` : ''}
        ${Number(it.amount) ? `<span class="amt">₹${Math.round(Number(it.amount))}</span>` : ''}
      </div>
    </div>`
  }).join('') : '<div class="empty">No items listed on this card.</div>'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#0d6e3f" />
<title>Shiv Hardware — Guarantee Card ${escapedNumber}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f1ec; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1c1917; -webkit-text-size-adjust: 100%; }
  header { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #0d6e3f; color: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.15); }
  header h1 { margin: 0; font-size: 16px; line-height: 1.2; flex: 1; }
  header h1 small { display: block; font-size: 11px; font-weight: 400; opacity: .85; }
  header .tag { background: #fff; color: #0d6e3f; padding: 4px 8px; border-radius: 6px; font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; white-space: nowrap; }
  main { padding: 14px; max-width: 620px; margin: 0 auto; }
  .card { background: #fff; border-radius: 12px; box-shadow: 0 4px 14px rgba(0,0,0,.07); padding: 14px 16px; margin-bottom: 12px; }
  .card h2 { margin: 0 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #0d6e3f; font-weight: 700; }
  .name { font-size: 18px; font-weight: 700; margin-bottom: 10px; }
  .kv { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid #f0ede7; }
  .kv:first-of-type { border-top: 0; }
  .kv .k { font-size: 12px; color: #78716c; width: 84px; flex-shrink: 0; text-transform: uppercase; letter-spacing: .03em; font-weight: 600; }
  .kv .v { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; word-break: break-word; }
  .kv .v a { color: inherit; text-decoration: none; }
  .item { display: flex; align-items: center; gap: 10px; padding: 11px 0; border-top: 1px solid #f0ede7; }
  .item:first-of-type { border-top: 0; }
  .item-info { flex: 1; min-width: 0; }
  .item-info .brand { font-weight: 700; font-size: 15px; }
  .item-info .sub { font-size: 13px; color: #78716c; margin-top: 2px; }
  .item-meta { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .badge { background: #eaf3ee; color: #0d6e3f; font-weight: 700; font-size: 12px; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
  .qty { font-size: 13px; color: #57534e; }
  .amt { font-weight: 700; font-size: 14px; font-variant-numeric: tabular-nums; }
  .empty { color: #a8a29e; font-size: 14px; padding: 6px 0; }
  .total { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding-top: 10px; border-top: 2px solid #1c1917; font-weight: 700; font-size: 16px; }
  .ic { width:1.1em; height:1.1em; vertical-align:-0.18em; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round }
  .pdf { display: block; text-align: center; background: #0d6e3f; color: #fff; text-decoration: none; font-weight: 700; padding: 13px; border-radius: 12px; margin-bottom: 20px; }
  .muted { text-align: center; color: #a8a29e; font-size: 11px; margin: 0 0 24px; }
</style>
</head>
<body>
<header>
  <h1>Shiv Hardware<small>Online Guarantee Card</small></h1>
  <span class="tag">${escapedNumber}</span>
</header>
<main>
  <div class="card">
    <div class="name">${esc(cust.name || '—')}</div>
    <div class="kv"><span class="k">Aadhaar</span><span class="v">${esc(cust.uid || 'N/A')}</span></div>
    <div class="kv"><span class="k">Phone</span><span class="v">${cust.mobile ? `<a href="tel:${esc(cust.mobile)}">${esc(cust.mobile)}</a>` : 'N/A'}</span></div>
    <div class="kv"><span class="k">Date</span><span class="v">${esc(dateStr)}</span></div>
  </div>

  <div class="card">
    <h2>Items</h2>
    ${itemsHtml}
    ${total > 0 ? `<div class="total"><span>Total</span><span>₹${Math.round(total)}</span></div>` : ''}
  </div>

  <a class="pdf" href="/guarantee/${encodeURIComponent(escapedNumber)}/pdf" target="_blank" rel="noreferrer"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg> Open full guarantee card (PDF)</a>
  <p class="muted">Shiv Hardware Store · Ramgarh Cantt</p>
</main>
</body>
</html>`
}

const app = express()
app.set('trust proxy', true)
// Chrome's Private Network Access blocks a public-origin page (e.g. the Vercel
// panel) from calling this local/private server unless the preflight response
// grants it. This header + open CORS lets the deployed panel reach the print
// server on the same PC (localhost) or LAN.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type')
    res.setHeader('Access-Control-Max-Age', '86400')
    return res.sendStatus(204)
  }
  next()
})
app.use(cors())
app.use(express.json({ limit: process.env.PRINT_UPLOAD_LIMIT || '100mb' }))

// ── Server-Sent Events — multi-device live sync ───────────────────────────────
const _sseClients = new Set()

function broadcastSync(event, data = {}) {
  if (_sseClients.size === 0) return
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of [..._sseClients]) {
    try { res.write(msg) } catch { _sseClients.delete(res) }
  }
}

function findChromePath() {
  const configured = process.env.CHROME_PATH?.trim()
  if (configured && existsSync(configured)) return configured
  if (configured) {
    console.warn(`[browser] configured CHROME_PATH does not exist, falling back: ${configured}`)
  }

  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].find(existsSync)
}

const WHATSAPP_ALLOWED_MEDIA_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])
const WHATSAPP_MAX_FILES = 12
const WHATSAPP_MAX_FILE_BYTES = 30 * 1024 * 1024
const WHATSAPP_AUTO_PRINT_ENABLED = parseBoolean(process.env.WHATSAPP_AUTO_PRINT_ENABLED)
const WHATSAPP_AUTO_PRINT_GROUP_NAME = process.env.WHATSAPP_AUTO_PRINT_GROUP_NAME || 'Shiv Hardware'
const WHATSAPP_AUTO_PRINT_GROUP_ID = process.env.WHATSAPP_AUTO_PRINT_GROUP_ID || ''
const WHATSAPP_AUTO_PRINT_COPIES = Math.min(20, Math.max(1, Math.trunc(Number(process.env.WHATSAPP_AUTO_PRINT_COPIES) || 1)))
const WHATSAPP_AUTO_PRINT_COMMAND_TTL_MS = Math.max(1000, Number(process.env.WHATSAPP_AUTO_PRINT_COMMAND_TTL_MS) || 10 * 60 * 1000)
const WHATSAPP_AUTO_PRINT_MEDIA_TYPES = new Set(
  (process.env.WHATSAPP_AUTO_PRINT_MEDIA_TYPES || 'image/jpeg,image/png,image/webp,image/gif,application/pdf')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean),
)
// When true, print images straight through SumatraPDF/lp instead of first wrapping
// them in an A4 PDF with Chrome. It is faster, but SumatraPDF's direct image
// printing produced blank pages on the Epson L8050 driver, so it defaults to false
// (use the reliable Chrome-rendered A4 wrapping). Set to true to re-enable.
const WHATSAPP_IMAGE_DIRECT_PRINT = !['0', 'false', 'no', 'off'].includes(String(process.env.WHATSAPP_IMAGE_DIRECT_PRINT ?? 'false').trim().toLowerCase())
const WHATSAPP_COLOR_PRINT_SETTINGS = parsePrintSettings(process.env.WHATSAPP_COLOR_PRINT_SETTINGS || 'fit,color,portrait,paper=A4,bin=Rear Paper Feeder')
const WHATSAPP_BW_PRINT_SETTINGS = parsePrintSettings(process.env.WHATSAPP_BW_PRINT_SETTINGS || 'fit,monochrome,portrait,paper=A4')
const QUOTATION_PRINT_SETTINGS = parsePrintSettings(process.env.QUOTATION_PRINT_SETTINGS || 'fit,color,portrait,paper=A4,bin=Rear Paper Feeder,print-quality=5')
const BW_FALLBACK_PRINT_SETTINGS = parsePrintSettings(process.env.BW_FALLBACK_PRINT_SETTINGS || 'fit,monochrome,portrait,paper=A4,bin=Rear Paper Feeder')
// The HP is a mono laser, so a color job falling back to it prints monochrome A4.
const COLOR_FALLBACK_PRINT_SETTINGS = parsePrintSettings(process.env.COLOR_FALLBACK_PRINT_SETTINGS || 'fit,monochrome,portrait,paper=A4')
const BW_FALLBACK_RESET_PLAIN_A4 = !['0', 'false', 'no', 'off'].includes(String(process.env.BW_FALLBACK_RESET_PLAIN_A4 ?? 'true').trim().toLowerCase())
const EPSON_DEFAULT_RESET_PLAIN_A4_COLOR = !['0', 'false', 'no', 'off'].includes(String(process.env.EPSON_DEFAULT_RESET_PLAIN_A4_COLOR ?? 'true').trim().toLowerCase())
// Epson L8050 driver quality options are: Draft, Standard, HighQuality, AdvancedSetting
// (mapped to ns0000:<value>). Default to Standard — the everyday mode that reliably
// puts ink on plain A4. (HighQuality on plain paper caused blank output here.)
const EPSON_A4_PRINT_QUALITY = process.env.EPSON_A4_PRINT_QUALITY || 'Standard'
const WHATSAPP_WEB_AUTH_DIR = fileURLToPath(new URL('data/baileys-auth', import.meta.url))
const WHATSAPP_PROCESSED_MESSAGES_URL = new URL('data/whatsapp-processed-messages.json', import.meta.url)
// Every WhatsApp media file is downloaded here BEFORE it is queued for printing,
// so nothing is lost and the print can run from a stable on-disk copy.
const WHATSAPP_PRINTS_DIR = process.env.WHATSAPP_PRINTS_DIR || join(homedir(), 'Downloads', 'whatsapp Prints')

// ── Customer guarantee-card WhatsApp notification ────────────────────────────
// When a guarantee card is generated/printed, message the customer's mobile from
// the same WhatsApp account that hosts the auto-print. Deduped by card number so
// reprints (and the A4 + PVC-card passes for one card) never double-send.
const WHATSAPP_CUSTOMER_NOTIFY_ENABLED = parseBoolean(
  process.env.WHATSAPP_CUSTOMER_NOTIFY_ENABLED ?? String(WHATSAPP_AUTO_PRINT_ENABLED),
)
// Country code prepended to bare 10-digit local mobiles. India (91) by default.
const WHATSAPP_CUSTOMER_COUNTRY_CODE = String(process.env.WHATSAPP_CUSTOMER_COUNTRY_CODE || '91').replace(/\D/g, '')
// Message template. {name} is replaced with the customer's name. Keep {name}
// in any custom text to personalize the greeting. A literal "\n" in the env
// value is turned into a real line break (.env files can't hold raw newlines).
const WHATSAPP_GUARANTEE_MESSAGE = (
  process.env.WHATSAPP_GUARANTEE_MESSAGE
  || 'Hi {name},\n\nThank you for purchasing with us. Your guarantee card is processed — please collect it from the shop.'
).replace(/\\n/g, '\n')

// First name only, proper-cased ("HARSH KUMAR" / "harsh kumar" -> "Harsh") for the greeting.
function greetingName(raw) {
  const first = String(raw ?? '').trim().split(/\s+/)[0] ?? ''
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : ''
}

// Fill the template with the customer's name, degrading gracefully when unknown.
function buildGuaranteeMessage(rawName) {
  const name = greetingName(rawName)
  if (WHATSAPP_GUARANTEE_MESSAGE.includes('{name}')) {
    return WHATSAPP_GUARANTEE_MESSAGE.replace(/\{name\}/g, name || 'there')
  }
  return `${name ? `Hi ${name},` : 'Hi,'}\n\n${WHATSAPP_GUARANTEE_MESSAGE}`
}
const WHATSAPP_NOTIFIED_GUARANTEES_URL = new URL('data/whatsapp-notified-guarantees.json', import.meta.url)
// Per-mobile cooldown so one customer never gets the same guarantee message
// twice in quick succession — e.g. from both the Generate button and a Print,
// or a double-click. 0 disables. Default 10 minutes.
const WHATSAPP_NOTIFY_COOLDOWN_MS = Math.max(0, Number(process.env.WHATSAPP_NOTIFY_COOLDOWN_MS) || 10 * 60 * 1000)
const whatsappRecentNotifyJids = new Map()

function withinNotifyCooldown(jid) {
  if (WHATSAPP_NOTIFY_COOLDOWN_MS <= 0) return false
  const last = whatsappRecentNotifyJids.get(jid)
  return last != null && Date.now() - last < WHATSAPP_NOTIFY_COOLDOWN_MS
}

function markJidNotified(jid) {
  whatsappRecentNotifyJids.set(jid, Date.now())
  if (whatsappRecentNotifyJids.size > 500) {
    const cutoff = Date.now() - WHATSAPP_NOTIFY_COOLDOWN_MS
    for (const [key, ts] of whatsappRecentNotifyJids) if (ts < cutoff) whatsappRecentNotifyJids.delete(key)
  }
}

// ── WhatsApp auto-reply to direct (1:1) messages ─────────────────────────────
// When anyone DMs the shop WhatsApp account, reply once (per cooldown) with a
// redirect message. Groups are unaffected (those drive auto-print).
const WHATSAPP_AUTOREPLY_ENABLED = parseBoolean(process.env.WHATSAPP_AUTOREPLY_ENABLED ?? 'true')
const WHATSAPP_AUTOREPLY_MESSAGE = (process.env.WHATSAPP_AUTOREPLY_MESSAGE
  || 'For any enquiries contact 8092850954 on WhatsApp.').replace(/\\n/g, '\n')
// Don't reply to the same person more than once within this window. Default 1 hour.
const WHATSAPP_AUTOREPLY_COOLDOWN_MS = Math.max(0, Number(process.env.WHATSAPP_AUTOREPLY_COOLDOWN_MS) || 60 * 60 * 1000)
const whatsappRecentAutoReplyJids = new Map()

function withinAutoReplyCooldown(jid) {
  if (WHATSAPP_AUTOREPLY_COOLDOWN_MS <= 0) return false
  const last = whatsappRecentAutoReplyJids.get(jid)
  return last != null && Date.now() - last < WHATSAPP_AUTOREPLY_COOLDOWN_MS
}

function markAutoReplied(jid) {
  whatsappRecentAutoReplyJids.set(jid, Date.now())
  if (whatsappRecentAutoReplyJids.size > 1000) {
    const cutoff = Date.now() - WHATSAPP_AUTOREPLY_COOLDOWN_MS
    for (const [key, ts] of whatsappRecentAutoReplyJids) if (ts < cutoff) whatsappRecentAutoReplyJids.delete(key)
  }
}

// ── WhatsApp "order" → handwritten bill OCR ──────────────────────────────────
// In ANY chat (DM or any group, from anyone), a message that is exactly "order"
// reads the bill photo and replies with the plywood/steel/telescopic item list.
// The photo is: the image the "order" caption is on, the image the "order" text
// replies to, or the latest image sent in that chat in the last few minutes.
// Uses Mesh API (OpenAI-compatible gateway) with a cheap vision model.
const WHATSAPP_ORDER_OCR_ENABLED = parseBoolean(process.env.WHATSAPP_ORDER_OCR_ENABLED ?? 'true')
const MESH_API_KEY = process.env.MESH_API_KEY || ''
const MESH_API_BASE_URL = (process.env.MESH_API_BASE_URL || 'https://api.meshapi.ai/v1').replace(/\/+$/, '')
const MESH_OCR_MODEL = process.env.MESH_OCR_MODEL || 'google/gemini-2.5-flash'
const WHATSAPP_ORDER_IMAGE_TTL_MS = Math.max(1000, Number(process.env.WHATSAPP_ORDER_IMAGE_TTL_MS) || 15 * 60 * 1000)
// jid -> [{ sender, msg, at }] most recent last (a few per chat).
const whatsappRecentOrderImages = new Map()

const ORDER_OCR_PROMPT = `You read handwritten hardware shop bills (photos) and extract items.

OUTPUT FORMAT
Return one item per line, nothing else (no headings, no bullets, no numbering, no commentary):
Thickness Brand/Grade Size – Qty unit
Examples:
19mm S Solid 8x4 – 12 pc
12mm S 7x3 – 2 pc
19mm Amron 8x4 – 1 pc
30mm S 78x36 – 5 pc
20" Telescopic SS – 5 set
If there are no matching items, output exactly: NONE

1. EXTRACT PLYWOOD
All plywood entries: 6mm, 12mm, 18mm, 19mm, 30mm, and inch-based entries converted to mm.
Keep sizes exactly as written (8x4, 7x4, 7x3, 6x4, 78x36, 81x38, etc.).

2. ALSO KEEP THESE NON-PLYWOOD ITEMS
Steel items: "17x20x8 Thali – Qty pc", "17x20x6 Plain – Qty pc", "17x20x4 Cutlery – Qty pc"
Telescopic SS: "20" Telescopic SS – Qty set" (unit is set)

3. IGNORE COMPLETELY
Prices, totals, GST, customer names, phone numbers, dates, P.T.O., tempo fare, Fevicol, nails, screws, hinges, handles, wardrobe channels, rollers, cutter blades, tape, Sunmica/Mica, and any other hardware item not listed above.

4. BRAND NORMALIZATION
Signature -> S ; Signature + Solid -> S Solid ; Amron -> Amron ; Solid (with or without S) -> S Solid
Remove completely: MR, PF, and a standalone H before brand names.
Examples: 19mm Signature Solid -> 19mm S Solid ; 19mm Solid MR -> 19mm S Solid ; 19mm MR -> 19mm ; PF Signature -> S

5. THICKNESS CONVERSION
1¼" (1 1/4 inch) -> 30mm. Keep metric thicknesses unchanged.

6. OCR CORRECTION
Fix obvious handwriting mistakes (Signatue -> Signature -> S; Amron misspellings -> Amron). Correct obvious digit errors only when clearly identifiable.

7. UNITS
Exactly "pc" for plywood, Thali, Plain, Cutlery; exactly "set" for Telescopic SS. Always lowercase. Never Pc, Pcs, Set, Nos.

WORKED EXAMPLE
Handwritten:
1¼ Signature 78x36 – 5
19mm Solid MR 7x4 – 4
19mm MR 7x4 – 2
17x20x8 Thali – 1
20" Telescopic SS – 5
Fevicol Marine – 5kg
Output:
30mm S 78x36 – 5 pc
19mm S Solid 7x4 – 4 pc
19mm 7x4 – 2 pc
17x20x8 Thali – 1 pc
20" Telescopic SS – 5 set`

const whatsappWebState = {
  enabled: WHATSAPP_AUTO_PRINT_ENABLED,
  status: WHATSAPP_AUTO_PRINT_ENABLED ? 'starting' : 'disabled',
  groupName: WHATSAPP_AUTO_PRINT_GROUP_NAME,
  groupId: WHATSAPP_AUTO_PRINT_GROUP_ID,
  copies: WHATSAPP_AUTO_PRINT_COPIES,
  qrDataUrl: null,
  readyAt: null,
  lastMessageAt: null,
  lastPrint: null,
  lastError: null,
}
const whatsappProcessedMessageIds = new Set(loadWhatsAppProcessedMessageIds())
const whatsappPendingMedia = new Map()
const whatsappGroupNameCache = new Map()
// Live Baileys socket, set once the WhatsApp Web connection opens (null while
// disconnected/reconnecting). Used to send customer guarantee notifications.
let whatsappSock = null
// The socket currently being connected (may be pre-login). Used to request a
// phone pairing code as a more reliable alternative to scanning the QR.
let whatsappConnectingSock = null
// Force a fresh login (clears the saved session and reconnects → new QR).
// Replaced with the real implementation once the WhatsApp socket starts.
let whatsappRelogin = async () => { throw new Error('WhatsApp is not enabled') }
// Reconnect KEEPING the saved session (no re-link needed). Used by the watchdog.
let whatsappReconnect = async () => {}
// Timestamp of the last time the connection was healthy ('ready'/'qr'/'starting').
let whatsappLastHealthy = Date.now()
const whatsappNotifiedGuarantees = new Set(loadWhatsAppNotifiedGuarantees())
const printerHealthCache = new Map()
const preparedPlainA4Printers = new Map()

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
}

function parsePrintSettings(value) {
  return String(value ?? '')
    .split(',')
    .map(setting => setting.trim())
    .filter(Boolean)
}

function loadWhatsAppProcessedMessageIds() {
  try {
    const data = JSON.parse(readFileSync(WHATSAPP_PROCESSED_MESSAGES_URL, 'utf8'))
    return Array.isArray(data?.ids) ? data.ids.filter(Boolean) : []
  } catch {
    return []
  }
}

async function saveWhatsAppProcessedMessageIds() {
  const ids = [...whatsappProcessedMessageIds].slice(-1000)
  await writeFile(WHATSAPP_PROCESSED_MESSAGES_URL, JSON.stringify({ ids }, null, 2))
}

function loadWhatsAppNotifiedGuarantees() {
  try {
    const data = JSON.parse(readFileSync(WHATSAPP_NOTIFIED_GUARANTEES_URL, 'utf8'))
    return Array.isArray(data?.numbers) ? data.numbers.filter(Boolean) : []
  } catch {
    return []
  }
}

async function saveWhatsAppNotifiedGuarantees() {
  const numbers = [...whatsappNotifiedGuarantees].slice(-2000)
  await writeFile(WHATSAPP_NOTIFIED_GUARANTEES_URL, JSON.stringify({ numbers }, null, 2))
}

function publicUrlFromRequest(req) {
  if (PRINT_SERVER_PUBLIC_URL) return PRINT_SERVER_PUBLIC_URL

  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const protocol = forwardedProto || req.protocol || 'http'
  const host = req.get('host') || `localhost:${PORT}`
  return `${protocol}://${host}`
}

// URL the printed guarantee QR encodes: the online card view. `req` is optional
// (absent for cloud print jobs), in which case only GUARANTEE_PUBLIC_URL applies.
// When GUARANTEE_PUBLIC_URL is set it is the full path prefix (e.g.
// https://www.shivhardware.store/Gaurantee) and the number is appended directly.
// Otherwise the shop LAN address + the print server's /g/<number> route is used.
function guaranteeCardUrl(number, req) {
  if (!number) return ''
  if (GUARANTEE_PUBLIC_URL) return `${GUARANTEE_PUBLIC_URL}/${encodeURIComponent(number)}`
  let base = (req ? publicUrlFromRequest(req) : '').replace(/\/+$/, '')
  if (!base) return ''
  // A localhost base is useless in a QR a phone must scan — swap in a LAN IP.
  if (/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(base)) {
    const lan = localNetworkUrls(PORT)[0]
    if (lan) base = lan
  }
  return `${base}/g/${encodeURIComponent(number)}`
}

// Return a copy of a guarantee document with the QR URL attached (used by the
// print template). No-op when the URL can't be resolved.
function withGuaranteeQr(doc, req) {
  if (!doc) return doc
  if (GUARANTEE_SHORT_URL && doc.number && doc.token) {
    return { ...doc, qrUrl: `${GUARANTEE_SHORT_URL}/${encodeURIComponent(doc.number)}/${encodeURIComponent(doc.token)}` }
  }
  const url = guaranteeCardUrl(doc.number, req)
  if (!url) return doc
  // The hosted page opens a card only when number AND its secret token match
  // (Convex getGuaranteeByNumber) — a QR without ?k= shows "Card not found".
  // Same URL as the app's guaranteeOnlineUrl and the desktop direct print.
  return { ...doc, qrUrl: doc.token ? `${url}?k=${encodeURIComponent(doc.token)}` : url }
}

function localNetworkUrls(port) {
  const urls = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) urls.push(`http://${entry.address}:${port}`)
    }
  }
  return urls
}

function normalizeNameKey(value) {
  return String(value ?? '').trim().toLowerCase()
}

function titleCaseName(value) {
  return String(value)
    .split(/([-'])/)
    .map(part => part === '-' || part === "'" ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function loadNameData() {
  try {
    const indianNames = readFileSync(new URL('data/indian_names.txt', import.meta.url), 'utf8')
      .split(/\r?\n/)
      .map(line => line.replace(/^name:\s*/i, ''))
    const corrections = JSON.parse(readFileSync(NAME_CORRECTIONS_URL, 'utf8'))
    const names = new Map()

    for (const name of [...indianNames, ...(corrections.preferredNames ?? [])]) {
      const clean = normalizeNameKey(name)
      if (clean && !names.has(clean)) names.set(clean, titleCaseName(clean))
    }

    const buckets = new Map()
    for (const entry of names) {
      const [key] = entry
      const bucket = buckets.get(key.length) ?? []
      bucket.push(entry)
      buckets.set(key.length, bucket)
    }

    return { buckets, ocrCorrections: corrections.ocrCorrections ?? {} }
  } catch (err) {
    console.warn('[names] dictionary unavailable:', err.message)
    return { buckets: new Map(), ocrCorrections: {} }
  }
}

let NAME_DATA = loadNameData()

function loadPlaceData() {
  try {
    const places = readFileSync(new URL('data/jharkhand_places.txt', import.meta.url), 'utf8').split(/\r?\n/)
    const corrections = JSON.parse(readFileSync(PLACE_CORRECTIONS_URL, 'utf8'))
    const placeMap = new Map()

    for (const place of [...places, ...(corrections.preferredPlaces ?? [])]) {
      const clean = normalizeNameKey(place)
      if (clean && !placeMap.has(clean)) placeMap.set(clean, titleCaseName(clean))
    }

    const buckets = new Map()
    for (const entry of placeMap) {
      const [key] = entry
      const bucket = buckets.get(key.length) ?? []
      bucket.push(entry)
      buckets.set(key.length, bucket)
    }

    return { buckets, ocrCorrections: corrections.ocrCorrections ?? {} }
  } catch (err) {
    console.warn('[places] dictionary unavailable:', err.message)
    return { buckets: new Map(), ocrCorrections: {} }
  }
}

let PLACE_DATA = loadPlaceData()

function loadProductCorrections() {
  try {
    return JSON.parse(readFileSync(PRODUCT_CORRECTIONS_URL, 'utf8'))
      .map(correction => ({
        ...correction,
        match: (correction.match ?? []).map(normalizeProductKey),
      }))
  } catch (err) {
    console.warn('[products] corrections unavailable:', err.message)
    return []
  }
}

function normalizeProductKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

let PRODUCT_CORRECTIONS = loadProductCorrections()

const EXTRACT_PROMPT = `This is a handwritten bill from a hardware store in Ramgarh Cantt, India.
Extract these fields and return ONLY valid JSON, no explanation:
{
  "customerName": "full visible text after M/s or Name, including locality written on the same line",
  "mobile": "10-digit mobile number",
  "uid": "UID/Aadhar if visible, else null",
  "address": "address if visible, else null",
  "items": [
    {
      "brandName": "brand/product name",
      "category": "one of: readymade-door, flush-door, plywood-6, block-board-12, block-board-19, aluminium-door, window-2-track, window-3-track",
      "heightInches": whole inches number or null,
      "heightSoot": eighths of an inch, 0 to 7,
      "widthInches": whole inches number or null,
      "widthSoot": eighths of an inch, 0 to 7,
      "sizeLabel": "visible size shorthand such as 7x4 or 8x4, else null",
      "qty": number,
      "amount": right-side line amount number or null,
      "guaranteeYears": 0 or 1 or 3 or 5 or 7 or 8 or 10 or 15 or 20 or 21 or 25 or 30
    }
  ]
}
Rules:
- Contact/mobile must be exact. Read every digit carefully. Return null if unsure; never invent a mobile.
- Customer line always starts with M/s or M/s-like writing. Treat it as a permanent printed/customer prefix; do not include "M/s" in customerName.
- Customer name: keep the full visible text after M/s, including locality. Example: "M/s Lalan Singh Ji, Ranchi Road" => customerName "Lalan Singh Ji, Ranchi Road".
- Address/locality is usually in Jharkhand/Ramgarh area; prefer real Jharkhand place spellings such as Huhua, Bagicha, Bhurkunda, Ranchi Road, Bank Colony, Ramgarh Cantt.
- If a non-empty customer name does not visibly include an honorific, append "Ji". Normalize Ji/Jee spelling to "Ji". Do not output only "Ji" when the name is empty.
- Items are for the guarantee card/main products only. Include doors, plywood/block-board/sheet, aluminium/window products. Exclude handles, hinges, aldrop, screws, nails, tape, magnet, fitting items, nut/bolt, labor/fare, and other accessories.
- DDSM design/brand names must use uppercase "DDSM" exactly, even if handwriting looks like DDsm/DDSm.
- Do not confuse amount/rate on the far right with quantity. Quantity is near the item text: 1Pc, 11Pc, 10Pc, 1Pkt, 3 B/L, 6Pc. Also extract the far-right amount into "amount".
- Alphanumeric door codes such as 213LUS are product/model codes, not amounts. Example: "DDSM Double Door 1Pc 213LUS" means brandName "DDSM Double Door 213LUS", qty 1, amount null.
- Preserve fractions as soot/eighths, not decimals. Example: "76 7/8 X 46" means heightInches 76, heightSoot 7, widthInches 46, widthSoot 0.
- Example: "DDSM PM LU4245 76 7/8 X 46 1 pcs 8197" means brandName "DDSM PM LU4245", heightInches 76, heightSoot 7, widthInches 46, widthSoot 0, qty 1. The 8197 is amount, not quantity.
- Example: "DDSM PM DD595 77 4/8 X 31 3/8 1 Pc 5702" means heightInches 77, heightSoot 4, widthInches 31, widthSoot 3, qty 1.
- Example: "DDSM PM DD595 77 X 37 7/8 1 Pc 6771" means heightInches 77, heightSoot 0, widthInches 37, widthSoot 7, qty 1.
- Board size shorthand: 7x4 or 8x4 means set only sizeLabel ("7x4" or "8x4"). Do not convert board shorthand into inches.
- 19mm board/sheet => category block-board-19. 12mm board/sheet => category block-board-12.
- If a board line looks like "19mm A" but context/amount matches this shorthand, read it as "19mm PF"; do not mark 19mm PF as guaranteed unless explicitly told otherwise.
- "6MM Panther PF" or "Panther PF" is a guaranteed 6mm plywood product: category plywood-6, qty 1 if written 1 Pc, guaranteeYears 10. Preserve visible 7x4/8x4 only as sizeLabel.
- guaranteeYears: 10 for Greenply/Kitply/DDoor/Durian/Panther PF, 7 for Black Touch, 0 for non-guaranteed boards/sheets/accessories/others.
- category: infer from product name.
- null for anything not visible`

const ACCESSORY_ITEM_RE = /\b(handle|hinge|aldrop|screw|nail|tape|magnet|fare|fale|labou?r|fitting|nut|bolt|receiver|stepper|chowkhat|chowket)\b/i
const MAIN_PRODUCT_RE = /\b(door|ply|plywood|board|block|19\s*mm|12\s*mm|6\s*mm|alum|aluminium|window|slider|acp|sgc|ddsm|ddoor|greenply|kitply|durian|black\s*touch|mica|xmica|panther)\b/i

function normalizeCustomer(data) {
  const name = typeof data.customerName === 'string' ? data.customerName.trim() : ''
  const address = correctPlaceSegment(typeof data.address === 'string' ? data.address.trim() : '')
  let customerName = correctCustomerName(name)

  if (customerName && address && !customerName.toLowerCase().includes(address.toLowerCase())) {
    customerName = `${customerName}, ${address}`
  }

  if (customerName && !/\b(jee|ji|sir|madam)\b/i.test(customerName)) {
    customerName = `${customerName} Ji`
  }

  return { ...data, customerName: customerName || null, address: address || null }
}

function normalizeItem(item, productCounts = new Map()) {
  const brandName = typeof item.brandName === 'string' ? item.brandName.trim() : ''
  const normalized = normalizeItemDimensions({ ...item, brandName })
  const correctedProduct = correctProductItem(normalized, productCounts)
  if (correctedProduct) return normalizeProductCasing(correctedProduct)

  if (/19\s*mm/i.test(brandName)) normalized.category = 'block-board-19'
  if (/12\s*mm/i.test(brandName)) normalized.category = 'block-board-12'

  if (/\b7\s*x\s*4\b/i.test(brandName)) {
    normalized.sizeLabel = '7x4'
  }
  if (/\b8\s*x\s*4\b/i.test(brandName)) {
    normalized.sizeLabel = '8x4'
  }

  if (/(19\s*mm|12\s*mm|ply|plywood|board|block)/i.test(brandName)) {
    normalized.guaranteeYears = 0
    normalized.sizeLabel = normalized.sizeLabel ?? inferBoardSizeLabel(normalized)
  }

  return normalizeProductCasing(normalized)
}

function normalizeProductCasing(item) {
  return {
    ...item,
    brandName: String(item.brandName ?? '').replace(/\bddsm\b/gi, 'DDSM'),
  }
}

function normalizeAmount(value) {
  if (value == null || value === '') return null
  const parsed = Number(String(value).replace(/[^\d.]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeSizeLabel(value) {
  const match = String(value ?? '').trim().match(/^(\d+)\s*x\s*(\d+)$/i)
  return match ? `${match[1]}x${match[2]}` : null
}

function inferBoardSizeLabel(item) {
  const height = Number(item.heightInches)
  const width = Number(item.widthInches)
  if (height === 84 && width === 48) return '7x4'
  if (height === 96 && width === 48) return '8x4'
  return null
}

function normalizeDimensionParts(inches, soot) {
  const fractionMatch = typeof inches === 'string'
    ? inches.trim().match(/^(\d+)(?:\s+(\d)\s*\/\s*8)?$/)
    : null
  const numericInches = fractionMatch ? Number(fractionMatch[1]) : Number(inches)
  const parsedSoot = fractionMatch?.[2] == null ? null : Number(fractionMatch[2])
  const numericSoot = soot == null || soot === '' ? NaN : Number(soot)

  if (inches == null || inches === '' || !Number.isFinite(numericInches)) {
    return {
      inches: null,
      soot: Number.isFinite(numericSoot) ? Math.min(7, Math.max(0, Math.round(numericSoot))) : parsedSoot ?? 0,
    }
  }

  const whole = Math.floor(numericInches)
  const fractionalSoot = Math.round((numericInches - whole) * 8)
  const nextInch = fractionalSoot >= 8 ? 1 : 0
  const inferredSoot = fractionalSoot >= 8 ? 0 : fractionalSoot
  const finalSoot = Number.isFinite(numericSoot) ? numericSoot : parsedSoot ?? inferredSoot

  return {
    inches: whole + nextInch,
    soot: Math.min(7, Math.max(0, Math.round(finalSoot))),
  }
}

function normalizeItemDimensions(item) {
  const height = normalizeDimensionParts(item.heightInches, item.heightSoot)
  const width = normalizeDimensionParts(item.widthInches, item.widthSoot)
  return {
    ...item,
    amount: normalizeAmount(item.amount),
    sizeLabel: normalizeSizeLabel(item.sizeLabel) ?? normalizeSizeLabel(item.brandName) ?? item.sizeLabel ?? null,
    heightInches: height.inches,
    heightSoot: height.soot,
    widthInches: width.inches,
    widthSoot: width.soot,
  }
}

function correctProductItem(item, productCounts) {
  const key = normalizeProductKey(item.brandName)
  if (!key) return null

  const correction = PRODUCT_CORRECTIONS.find(entry => entry.match.includes(key))
  if (!correction) return null
  const count = productCounts.get(correction.canonicalBrandName) ?? 0
  productCounts.set(correction.canonicalBrandName, count + 1)
  const knownLine = correction.knownLines?.[count]
  const correctedValue = (field, fallback) => {
    if (knownLine && Object.hasOwn(knownLine, field)) return knownLine[field]
    if (Object.hasOwn(correction, field)) return correction[field]
    return fallback
  }

  return {
    ...item,
    brandName: correction.canonicalBrandName,
    category: correctedValue('category', item.category),
    heightInches: correctedValue('heightInches', item.heightInches),
    heightSoot: correctedValue('heightSoot', item.heightSoot ?? 0),
    widthInches: correctedValue('widthInches', item.widthInches),
    widthSoot: correctedValue('widthSoot', item.widthSoot ?? 0),
    sizeLabel: correctedValue('sizeLabel', item.sizeLabel ?? inferBoardSizeLabel(item)),
    qty: correctedValue('qty', item.qty),
    amount: correctedValue('amount', item.amount ?? null),
    guaranteeYears: correctedValue('guaranteeYears', item.guaranteeYears),
  }
}

function normalizeScanData(data) {
  const normalized = normalizeCustomer(data)
  const productCounts = new Map()
  normalized.items = (Array.isArray(data.items) ? data.items : [])
    .map(item => normalizeItem(item, productCounts))
    .filter(item => {
      const name = item.brandName ?? ''
      if (!name) return false
      if (ACCESSORY_ITEM_RE.test(name)) return false
      return MAIN_PRODUCT_RE.test(name)
    })
  return normalized
}

function parseJSON(text) {
  const start = text.indexOf('{')
  if (start === -1) throw new Error('No JSON found in response')

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return JSON.parse(text.slice(start, i + 1))
  }

  throw new Error('Incomplete JSON in response')
}

function levenshteinAtMostTwo(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  const current = new Array(b.length + 1)

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    let rowMin = current[0]
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      )
      rowMin = Math.min(rowMin, current[j])
    }
    if (rowMin > 2) return 3
    previous.splice(0, previous.length, ...current)
  }

  return previous[b.length]
}

function correctNameToken(token) {
  const key = normalizeNameKey(token)
  if (!NAME_WORD_RE.test(token) || HONORIFICS.has(key)) return token

  if (NAME_DATA.ocrCorrections[key]) return NAME_DATA.ocrCorrections[key]

  let best = null
  let bestDistance = 3
  for (const length of [key.length, key.length - 1, key.length + 1]) {
    const candidates = NAME_DATA.buckets.get(length) ?? []
    for (const [candidateKey, candidateValue] of candidates) {
      const distance = levenshteinAtMostTwo(key, candidateKey)
      if (distance < bestDistance) {
        best = candidateValue
        bestDistance = distance
        if (distance === 0) return candidateValue
      }
    }
  }

  return best && bestDistance === 1 ? best : token
}

function correctCustomerName(customerName) {
  if (!customerName) return customerName
  const [namePart, ...rest] = customerName.split(',')
  const correctedNamePart = namePart
    .replace(/\bjee\b/gi, 'Ji')
    .replace(/\bji\b/gi, 'Ji')
    .replace(/\b[a-z][a-z'.-]{2,}\b/gi, correctNameToken)
  return [correctedNamePart.trim(), ...rest.map(correctPlaceSegment).filter(Boolean)].join(', ')
}

function correctPlaceSegment(segment) {
  const value = String(segment ?? '').trim()
  if (!value) return ''

  const key = normalizeNameKey(value)
  if (PLACE_DATA.ocrCorrections[key]) return PLACE_DATA.ocrCorrections[key]

  let best = null
  let bestDistance = 3
  for (const length of [key.length, key.length - 1, key.length + 1, key.length - 2, key.length + 2]) {
    const candidates = PLACE_DATA.buckets.get(length) ?? []
    for (const [candidateKey, candidateValue] of candidates) {
      const distance = levenshteinAtMostTwo(key, candidateKey)
      if (distance < bestDistance) {
        best = candidateValue
        bestDistance = distance
        if (distance === 0) return candidateValue
      }
    }
  }

  return best && bestDistance <= 2 ? best : value
}

function readJSON(url, fallback) {
  try {
    return JSON.parse(readFileSync(url, 'utf8'))
  } catch {
    return fallback
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizeCopies(value) {
  return Math.min(20, Math.max(1, Math.trunc(Number(value) || 1)))
}

function extensionForMediaType(mediaType) {
  switch (mediaType) {
    case 'application/pdf':
      return '.pdf'
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    default:
      return ''
  }
}

function decodeUploadedFile(file, index) {
  const mediaType = String(file?.mediaType ?? '').toLowerCase()
  const name = String(file?.name ?? `upload-${index + 1}`).trim() || `upload-${index + 1}`
  const rawData = String(file?.data ?? '')
  const data = rawData.includes(',') ? rawData.slice(rawData.indexOf(',') + 1) : rawData
  const cleanData = data.replace(/\s/g, '')

  if (!WHATSAPP_ALLOWED_MEDIA_TYPES.has(mediaType)) {
    throw new Error(`${name}: unsupported file type ${mediaType || 'unknown'}. Use PDF, JPG, PNG, WEBP, or GIF.`)
  }
  if (!cleanData || !/^[A-Za-z0-9+/]*={0,2}$/.test(cleanData)) {
    throw new Error(`${name}: invalid base64 file data`)
  }

  const expectedBytes = Math.floor((cleanData.replace(/=+$/, '').length * 3) / 4)
  if (expectedBytes > WHATSAPP_MAX_FILE_BYTES) {
    throw new Error(`${name}: file is too large. Maximum is ${Math.round(WHATSAPP_MAX_FILE_BYTES / 1024 / 1024)} MB.`)
  }

  const buffer = Buffer.from(cleanData, 'base64')
  if (!buffer.length) throw new Error(`${name}: empty file`)

  return { name, mediaType, data: cleanData, buffer }
}

async function launchPuppeteerBrowser() {
  const { default: puppeteer } = await import('puppeteer-core')
  if (!CHROME_PATH) {
    throw new Error('CHROME_PATH is required for puppeteer-core rendering')
  }

  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
    executablePath: CHROME_PATH,
  })
}

// Keep ONE Chromium alive and hand out a fresh page per job. Launching Chromium
// costs ~1-3s; opening a page on a warm browser costs ~50ms. This is the main
// reason printing felt slow — every job used to cold-start (and close) Chrome.
let sharedBrowserPromise = null

function browserIsAlive(browser) {
  try {
    return typeof browser.connected === 'boolean' ? browser.connected : browser.isConnected()
  } catch {
    return false
  }
}

async function getSharedBrowser() {
  if (sharedBrowserPromise) {
    try {
      const existing = await sharedBrowserPromise
      if (browserIsAlive(existing)) return existing
    } catch {
      /* launch failed earlier — fall through and relaunch */
    }
    sharedBrowserPromise = null
  }

  sharedBrowserPromise = launchPuppeteerBrowser().then((browser) => {
    // If Chrome dies/crashes, drop the cache so the next job relaunches it.
    browser.on('disconnected', () => {
      if (sharedBrowserPromise) sharedBrowserPromise = null
    })
    return browser
  })

  try {
    return await sharedBrowserPromise
  } catch (err) {
    sharedBrowserPromise = null
    throw err
  }
}

async function killSharedBrowser(browser) {
  sharedBrowserPromise = null
  try { browser.process()?.kill('SIGKILL') } catch { /* already dead */ }
  try { await browser.close() } catch { /* already dead */ }
}

/**
 * Returns a fresh page on the shared browser, health-checked first. A
 * long-lived headless Chrome can silently wedge (renderer hang) after being
 * reused across many jobs — page.newPage()/setContent() then hangs for the
 * full navigation timeout instead of failing fast, which used to surface to
 * users as "print failed" and fall back to the slower cloud queue. Probing
 * with a trivial setContent call first, and force-relaunching Chrome on
 * failure, converts that into a ~4s self-healing retry instead.
 */
async function getSharedPage() {
  let browser = await getSharedBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent('<!doctype html><html></html>', { timeout: 4000 })
    return page
  } catch (err) {
    console.warn(`[browser] health check failed (${err?.message ?? err}); relaunching Chrome`)
    await killSharedBrowser(browser)
    browser = await getSharedBrowser()
    return await browser.newPage()
  }
}

// Warm the browser at boot so the first real print is fast too. Best-effort.
async function warmUpBrowser() {
  if (!CHROME_PATH) return
  try {
    await getSharedBrowser()
    console.log('[browser] warmed up and ready')
  } catch (err) {
    console.warn(`[browser] warm-up skipped: ${err?.message ?? err}`)
  }
}

function findSumatraPdfPath() {
  const candidates = [
    'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
    'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe',
    `${process.env.LOCALAPPDATA || ''}\\SumatraPDF\\SumatraPDF.exe`,
    `${process.env.LOCALAPPDATA || ''}\\Programs\\SumatraPDF\\SumatraPDF.exe`,
  ].filter(Boolean)

  return candidates.find(candidate => existsSync(candidate)) || 'SumatraPDF.exe'
}

function selectDocumentPrinter({ kind, layout = 'a4' } = {}) {
  if (kind === 'guarantee' && layout === 'card') return COLOR_PRINTER
  if (kind === 'quotation') return COLOR_PRINTER
  return BW_PRINTER
}

function selectUploadPrinter(file) {
  if (file?.mediaType?.startsWith('image/')) return COLOR_PRINTER
  return BW_PRINTER
}

// A printer is "reachable" when it isn't stopped and isn't reporting that it's
// offline / can't connect to the device. (getPrintQueue is hoisted below.)
function printerIsReachable(p) {
  if (!p) return false
  if (p.state === 'stopped') return false
  const reasons = String(p.alert || '').toLowerCase()
  return !/offline|connecting-to-device|shutdown|unplugged|not-?responding/.test(reasons)
}

// If `preferred` is offline, fall back to any other online printer. Skips
// thermal/test devices and prefers the configured fallback printers when online.
async function pickReachablePrinter(preferred) {
  if (!PRINTER_AUTO_SELECT) return { printer: preferred, switched: false }
  try {
    const { printers } = await getPrintQueue()
    const byName = new Map(printers.map((p) => [p.name, p]))
    if (printerIsReachable(byName.get(preferred))) return { printer: preferred, switched: false }

    const skip = /thermal|test|fax|virtual|pdf/i
    const online = printers.filter((p) => p.name !== preferred && !skip.test(p.name) && printerIsReachable(p))
    if (!online.length) return { printer: preferred, switched: false }

    const ranked = [BW_FALLBACK_PRINTER, BW_PRINTER, COLOR_PRINTER, PRINT_PRINTER]
    const chosen = ranked.map((n) => online.find((p) => p.name === n)).find(Boolean) || online[0]
    return { printer: chosen.name, switched: true, from: preferred }
  } catch {
    return { printer: preferred, switched: false }
  }
}

function parseWhatsAppPrintMode(text) {
  const clean = String(text ?? '').trim().toLowerCase()
  if (!clean) return null
  if (/\bcp\b/.test(clean) || /\bcolor\b/.test(clean) || /\bcolour\b/.test(clean)) return 'color'
  if (/\bbw\b/.test(clean) || /\bb\/w\b/.test(clean) || /\bblack\b/.test(clean)) return 'bw'
  return null
}

function printerForWhatsAppPrintMode(mode, file) {
  if (mode === 'color') return COLOR_PRINTER
  if (mode === 'bw') return BW_PRINTER
  return selectUploadPrinter(file)
}

function printSettingsForWhatsAppPrinter(printer) {
  if (printer === COLOR_PRINTER) return WHATSAPP_COLOR_PRINT_SETTINGS
  if (printer === BW_PRINTER) return WHATSAPP_BW_PRINT_SETTINGS
  return []
}

function printSettingsForWhatsAppPrintMode(mode, printer) {
  if (mode === 'color') return WHATSAPP_COLOR_PRINT_SETTINGS
  if (mode === 'bw') return WHATSAPP_BW_PRINT_SETTINGS
  return printSettingsForWhatsAppPrinter(printer)
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout
        err.stderr = stderr
        reject(err)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function getWindowsPrinterHealth(printer) {
  const cache = printerHealthCache.get(printer)
  if (cache && Date.now() - cache.at < 15000) return cache.health

  if (process.platform !== 'win32') {
    return { ok: true, status: 'unknown', reason: 'non-windows' }
  }

  try {
    const script = [
      '$name=$env:SHIV_PRINTER_NAME',
      '$printer=Get-Printer -Name $name -ErrorAction Stop',
      '$cim=Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $name }',
      '[pscustomobject]@{',
      '  Name = $printer.Name',
      '  PrinterStatus = [string]$printer.PrinterStatus',
      '  JobCount = $printer.JobCount',
      '  DetectedErrorState = $cim.DetectedErrorState',
      '  ExtendedDetectedErrorState = $cim.ExtendedDetectedErrorState',
      '  WorkOffline = $cim.WorkOffline',
      '} | ConvertTo-Json -Compress',
    ].join('\n')
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
      env: { ...process.env, SHIV_PRINTER_NAME: printer },
      windowsHide: true,
    })
    const data = JSON.parse(stdout.trim())
    const status = String(data.PrinterStatus || 'Unknown')
    const detectedErrorState = Number(data.DetectedErrorState || 0)
    const workOffline = Boolean(data.WorkOffline)
    const readyStatuses = new Set(['Normal', 'Idle', 'Printing', 'Processing', 'WarmingUp'])
    const hasError = workOffline || !readyStatuses.has(status) || (detectedErrorState && detectedErrorState !== 2)
    const health = {
      ok: !hasError,
      status,
      jobCount: Number(data.JobCount || 0),
      detectedErrorState,
      extendedDetectedErrorState: Number(data.ExtendedDetectedErrorState || 0),
      workOffline,
      reason: hasError ? `status=${status}, detectedErrorState=${detectedErrorState || 'unknown'}` : null,
    }
    printerHealthCache.set(printer, { at: Date.now(), health })
    return health
  } catch (err) {
    const health = { ok: false, status: 'check-failed', reason: String(err.message ?? err) }
    printerHealthCache.set(printer, { at: Date.now(), health })
    return health
  }
}

function epsonPlainA4PrintTicketXml({ color = true } = {}) {
  const qualityOption = /^[-:_a-z0-9]+$/i.test(EPSON_A4_PRINT_QUALITY)
    ? EPSON_A4_PRINT_QUALITY
    : 'High'
  const qualityName = qualityOption.includes(':') ? qualityOption : `ns0000:${qualityOption}`

  return `<?xml version="1.0"?>
<psf:PrintTicket xmlns:psf="http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework" xmlns:psk="http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords" xmlns:ns0000="http://schema.epson.net/printschema/business/v100" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" version="1">
  <psf:Feature name="psk:PageInputBin"><psf:Option name="ns0000:AutoSheetFeeder"/></psf:Feature>
  <psf:Feature name="psk:PageMediaType"><psf:Option name="psk:Plain"/></psf:Feature>
  <psf:Feature name="psk:PageOutputColor"><psf:Option name="psk:${color ? 'Color' : 'Monochrome'}"/></psf:Feature>
  <psf:Feature name="psk:PageOutputQuality"><psf:Option name="${qualityName}"/></psf:Feature>
  <psf:Feature name="psk:PageMediaSize"><psf:Option name="psk:ISOA4"><psf:ScoredProperty name="psk:MediaSizeWidth"><psf:Value xsi:type="xsd:integer">210000</psf:Value></psf:ScoredProperty><psf:ScoredProperty name="psk:MediaSizeHeight"><psf:Value xsi:type="xsd:integer">297000</psf:Value></psf:ScoredProperty></psf:Option></psf:Feature>
  <psf:Feature name="psk:PageBorderless"><psf:Option name="psk:None"/></psf:Feature>
  <psf:Feature name="psk:PageOrientation"><psf:Option name="psk:Portrait"/></psf:Feature>
  <psf:Feature name="psk:JobDuplexAllDocumentsContiguously"><psf:Option name="psk:OneSided"/></psf:Feature>
  <psf:Feature name="psk:DocumentCollate"><psf:Option name="psk:Collated"/></psf:Feature>
  <psf:ParameterInit name="psk:JobCopiesAllDocuments"><psf:Value xsi:type="xsd:integer">1</psf:Value></psf:ParameterInit>
</psf:PrintTicket>`
}

async function prepareEpsonPlainA4ColorDefaults(printer, source = 'print') {
  if (!EPSON_DEFAULT_RESET_PLAIN_A4_COLOR || process.platform !== 'win32' || printer !== COLOR_PRINTER) return
  if (Date.now() - (preparedPlainA4Printers.get(printer) || 0) < 60000) return

  try {
    const script = [
      '$name=$env:SHIV_PRINTER_NAME',
      '$xml=$env:SHIV_PRINT_TICKET_XML',
      'Set-PrintConfiguration -PrinterName $name -PrintTicketXml $xml',
      'Set-PrintConfiguration -PrinterName $name -PaperSize A4 -Color $true -DuplexingMode OneSided',
      '$devmodePaths=@("HKCU:\\Printers\\DevModePerUser","HKCU:\\Printers\\DevModes2")',
      'foreach($path in $devmodePaths){$props=Get-ItemProperty -Path $path -ErrorAction SilentlyContinue;if($null -ne $props -and $null -ne $props.$name){$bytes=[byte[]]$props.$name.Clone();foreach($pair in @(@(76,1),@(78,9),@(80,2970),@(82,2100),@(86,1),@(88,261),@(102,2))){$value=[BitConverter]::GetBytes([int16]$pair[1]);$bytes[$pair[0]]=$value[0];$bytes[$pair[0]+1]=$value[1]};Set-ItemProperty -Path $path -Name $name -Value $bytes}}',
      '$config=Get-PrintConfiguration -PrinterName $name',
      '[pscustomobject]@{PrinterName=$config.PrinterName;PaperSize=[string]$config.PaperSize;Color=$config.Color;DuplexingMode=[string]$config.DuplexingMode} | ConvertTo-Json -Compress',
    ].join(';')
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
      env: {
        ...process.env,
        SHIV_PRINTER_NAME: printer,
        SHIV_PRINT_TICKET_XML: epsonPlainA4PrintTicketXml({ color: true }),
      },
      windowsHide: true,
    })
    preparedPlainA4Printers.set(printer, Date.now())
    console.log(`[${source}] prepared Epson defaults: ${stdout.trim()}`)
  } catch (err) {
    console.warn(`[${source}] failed to prepare Epson defaults`, err.message ?? err)
  }
}

async function prepareBwFallbackPrinter(printer, source = 'print') {
  if (!BW_FALLBACK_RESET_PLAIN_A4 || printer !== BW_FALLBACK_PRINTER) return
  await prepareEpsonPlainA4ColorDefaults(printer, source)
}

async function routeWhatsAppPrintJob(mode, file) {
  const primaryPrinter = printerForWhatsAppPrintMode(mode, file)
  if (mode !== 'bw') {
    // Color job → EPSON, but fall back to the HP (mono) if the EPSON is offline.
    return await routeColorPrinterOnError(primaryPrinter, printSettingsForWhatsAppPrintMode(mode, primaryPrinter), 'whatsapp-web')
  }

  return await routeBwPrinterOnError(primaryPrinter, WHATSAPP_BW_PRINT_SETTINGS, 'whatsapp-web')
}

// Mirror of routeBwPrinterOnError: if the color (EPSON) printer is unavailable,
// route the job to the HP printer instead (prints monochrome).
async function routeColorPrinterOnError(primaryPrinter, printSettings = [], source = 'print') {
  const primarySettings = printSettings ?? []
  if (!COLOR_FALLBACK_ON_ERROR || primaryPrinter !== COLOR_PRINTER || COLOR_FALLBACK_PRINTER === COLOR_PRINTER) {
    return { printer: primaryPrinter, printSettings: primarySettings, fallback: null }
  }

  const epsonHealth = await getWindowsPrinterHealth(COLOR_PRINTER)
  if (epsonHealth.ok) {
    return { printer: primaryPrinter, printSettings: primarySettings, fallback: null }
  }

  const fallback = {
    from: COLOR_PRINTER,
    to: COLOR_FALLBACK_PRINTER,
    reason: epsonHealth.reason || epsonHealth.status,
  }
  console.warn(`[${source}] Color printer unavailable; falling back to "${COLOR_FALLBACK_PRINTER}" with monochrome settings (${fallback.reason})`)
  return {
    printer: COLOR_FALLBACK_PRINTER,
    printSettings: COLOR_FALLBACK_PRINT_SETTINGS.length ? COLOR_FALLBACK_PRINT_SETTINGS : primarySettings,
    fallback,
  }
}

async function routeBwPrinterOnError(primaryPrinter, printSettings = [], source = 'print') {
  const primarySettings = printSettings ?? []
  if (!BW_FALLBACK_ON_ERROR || primaryPrinter !== BW_PRINTER || BW_FALLBACK_PRINTER === BW_PRINTER) {
    return {
      printer: primaryPrinter,
      printSettings: primarySettings,
      fallback: null,
    }
  }

  const hpHealth = await getWindowsPrinterHealth(BW_PRINTER)
  if (hpHealth.ok) {
    return {
      printer: primaryPrinter,
      printSettings: primarySettings,
      fallback: null,
    }
  }

  const fallback = {
    from: BW_PRINTER,
    to: BW_FALLBACK_PRINTER,
    reason: hpHealth.reason || hpHealth.status,
  }
  await prepareBwFallbackPrinter(BW_FALLBACK_PRINTER, source)
  console.warn(`[${source}] BW printer unavailable; falling back to "${BW_FALLBACK_PRINTER}" with monochrome settings (${fallback.reason})`)
  return {
    printer: BW_FALLBACK_PRINTER,
    printSettings: BW_FALLBACK_PRINT_SETTINGS.length ? BW_FALLBACK_PRINT_SETTINGS : primarySettings,
    fallback,
  }
}

function whatsappPrintCommandKey(jid, sender = '') {
  return `${jid}|${sender}`
}

function rememberWhatsAppPendingMedia(jid, sender, file) {
  const key = whatsappPrintCommandKey(jid, sender)
  const list = whatsappPendingMedia.get(key) || []
  list.push({ file, at: Date.now() })
  whatsappPendingMedia.set(key, list)
}

function flushWhatsAppPendingMedia(jid, sender) {
  const now = Date.now()
  const key = whatsappPrintCommandKey(jid, sender)
  const list = whatsappPendingMedia.get(key) || []
  whatsappPendingMedia.delete(key)
  return list.filter(e => now - e.at <= WHATSAPP_AUTO_PRINT_COMMAND_TTL_MS).map(e => e.file)
}

// ---- Serial print queue --------------------------------------------------
// Only ONE physical print job runs at a time. Without this, a newly-arrived
// job (e.g. another WhatsApp page) would spawn a concurrent SumatraPDF /
// Set-PrintConfiguration call that interrupts the job already spooling on the
// printer. Jobs are appended to the chain and executed strictly in order; a
// failure in one job never blocks the next.
let printChain = Promise.resolve()

function runPrintExclusive(label, fn) {
  const run = printChain.then(() => {
    if (label) console.log(`[print-queue] start ${label}`)
    return fn()
  })
  // Keep the chain alive across both success and failure, swallowing the
  // settled value so the next job starts cleanly. The real result/rejection is
  // returned to the caller via `run`.
  printChain = run.then(() => {}, () => {})
  if (label) {
    run.then(
      () => console.log(`[print-queue] done ${label}`),
      err => console.log(`[print-queue] failed ${label}: ${err?.message ?? err}`),
    )
  }
  return run
}

// Save a downloaded WhatsApp media file into the persistent "whatsapp Prints"
// folder and return its path. The print job runs from this copy.
async function saveWhatsAppPrintFile(file) {
  await mkdir(WHATSAPP_PRINTS_DIR, { recursive: true })
  const rawName = (file?.name || 'whatsapp').toString()
  const cleaned = rawName.replace(/[\\/:*?"<>|\r\n]+/g, '_').replace(/\s+/g, ' ').trim() || 'whatsapp'
  const hasExt = /\.[a-z0-9]{2,5}$/i.test(cleaned)
  const safeName = hasExt ? cleaned : `${cleaned}${extensionForMediaType(file.mediaType)}`
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const rand = Math.random().toString(16).slice(2, 6)
  const savedPath = join(WHATSAPP_PRINTS_DIR, `${stamp}-${rand}-${safeName}`)
  await writeFile(savedPath, file.buffer)
  return savedPath
}

async function printFileWithLp(filePath, copies, title, printer = PRINT_PRINTER, printSettings = []) {
  if (process.platform === 'win32') {
    return new Promise((ok, fail) => {
      const settings = [`${copies}x`, ...printSettings].join(',')
      const args = [
        '-print-settings',
        settings,
        '-print-to',
        printer,
        '-silent',
        '-exit-on-print',
        filePath,
      ]

      console.log(`[windows-print] printer="${printer}" settings="${settings}" file="${filePath}"`)
      // Time limit so a hung SumatraPDF can't block the serial print queue forever.
      execFile(SUMATRA_PDF_PATH, args, { windowsHide: true, timeout: 3 * 60 * 1000 }, (err, stdout, stderr) => {
        if (err) {
          fail(err)
          return
        }

        const output = [stdout, stderr].map(text => text?.trim()).filter(Boolean).join('\n')
        console.log(`[windows-print] ${title}`, output || `sent to ${printer}`)
        ok({ jobId: null, output })
      })
    })
  }

  // Build lp args: each printSettings entry becomes an -o flag
  const lpOptions = printSettings.flatMap(s => ['-o', s])
  const lpArgs = ['-d', printer, '-n', String(copies), '-t', title, ...lpOptions, filePath]
  console.log(`[lp-print] printer="${printer}" options="${lpOptions.join(' ')}" file="${filePath}"`)

  return new Promise((ok, fail) =>
    execFile('lp', lpArgs, (err, stdout) => {
      if (err) {
        fail(err)
        return
      }
      const output = stdout.trim()
      const jobId = output.match(/request id is (\S+)/)?.[1] ?? null
      console.log(`[lp-print] ${title}`, output)
      ok({ jobId, output })
    }),
  )
}

function shouldUseEpsonCardDevmode(isCard) {
  return process.platform === 'win32' && isCard && EPSON_CARD_PRINT_ENGINE === 'devmode'
}

function shouldUseCardImageEngine(isCard) {
  return process.platform === 'win32' && isCard && ['devmode', 'excel'].includes(EPSON_CARD_PRINT_ENGINE)
}

async function printCardImageWithDevmode(filePath, copies, title, printer = COLOR_PRINTER, { slot = 1, filePath2 = null } = {}) {
  if (!existsSync(EPSON_CARD_DEVMODE_PATH)) {
    throw new Error(`Missing Epson card DEVMODE file: ${EPSON_CARD_DEVMODE_PATH}. Run print-server/tools/capture-epson-card-devmode.ps1 first.`)
  }

  // Single card can go to either slot; a second image always lands in slot 2.
  const primaryLeft = slot === 2 ? EPSON_CARD_SLOT2_LEFT_MM : EPSON_CARD_SLOT_LEFT_MM
  const primaryTop = slot === 2 ? EPSON_CARD_SLOT2_TOP_MM : EPSON_CARD_SLOT_TOP_MM

  return new Promise((ok, fail) => {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      EPSON_CARD_GDI_SCRIPT,
      '-ImagePath',
      filePath,
      '-PrinterName',
      printer,
      '-DevmodeFile',
      EPSON_CARD_DEVMODE_PATH,
      '-Copies',
      String(copies),
      '-JobName',
      title,
      '-SlotLeftMm',
      String(primaryLeft),
      '-SlotTopMm',
      String(primaryTop),
      '-Slot2LeftMm',
      String(EPSON_CARD_SLOT2_LEFT_MM),
      '-Slot2TopMm',
      String(EPSON_CARD_SLOT2_TOP_MM),
      '-CardWidthMm',
      String(CARD_WIDTH_MM),
      '-CardHeightMm',
      String(CARD_HEIGHT_MM),
      '-OffsetXmm',
      String(EPSON_CARD_OFFSET_X_MM),
      '-OffsetYmm',
      String(EPSON_CARD_OFFSET_Y_MM),
      '-ScalePercent',
      String(EPSON_CARD_SCALE_PERCENT),
    ]
    if (filePath2) args.push('-ImagePath2', filePath2)

    console.log(`[windows-card-print] printer="${printer}" devmode="${EPSON_CARD_DEVMODE_PATH}" slot=${slot} file="${filePath}"${filePath2 ? ` file2="${filePath2}"` : ''}`)
    execFile('powershell.exe', args, { windowsHide: true, timeout: 120000 }, (err, stdout, stderr) => {
      const output = [stdout, stderr].map(text => text?.trim()).filter(Boolean).join('\n')
      if (err) {
        err.message = `${err.message}${output ? `\n${output}` : ''}`
        fail(err)
        return
      }

      console.log(`[windows-card-print] ${title}`, output || `sent to ${printer}`)
      ok({ jobId: null, output })
    })
  })
}

async function printCardImageWithExcel(filePath, copies, title, printer = COLOR_PRINTER) {
  return new Promise((ok, fail) => {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      EPSON_CARD_EXCEL_SCRIPT,
      '-ImagePath',
      filePath,
      '-PrinterName',
      printer,
      '-Copies',
      String(copies),
      '-JobName',
      title,
      '-OffsetXmm',
      String(EPSON_CARD_OFFSET_X_MM),
      '-OffsetYmm',
      String(EPSON_CARD_OFFSET_Y_MM),
      '-ScalePercent',
      String(EPSON_CARD_SCALE_PERCENT),
    ]

    console.log(`[windows-card-excel] printer="${printer}" offset="${EPSON_CARD_OFFSET_X_MM},${EPSON_CARD_OFFSET_Y_MM}mm" scale="${EPSON_CARD_SCALE_PERCENT}%" file="${filePath}"`)
    execFile('powershell.exe', args, { windowsHide: true, timeout: 180000 }, (err, stdout, stderr) => {
      const output = [stdout, stderr].map(text => text?.trim()).filter(Boolean).join('\n')
      if (err) {
        err.message = `${err.message}${output ? `\n${output}` : ''}`
        fail(err)
        return
      }

      console.log(`[windows-card-excel] ${title}`, output || `sent to ${printer}`)
      ok({ jobId: null, output })
    })
  })
}

async function printCardImage(filePath, copies, title, printer = COLOR_PRINTER, options = {}) {
  if (EPSON_CARD_PRINT_ENGINE === 'excel') {
    if (options.slot === 2 || options.filePath2) {
      console.warn('[windows-card-excel] slot selection / two-card printing is only supported by the devmode engine; printing slot 1 only')
    }
    return await printCardImageWithExcel(filePath, copies, title, printer)
  }
  return await printCardImageWithDevmode(filePath, copies, title, printer, options)
}

async function renderUploadedImagePdf(file) {
  let page
  try {
    page = await getSharedPage()
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 0; }
    html, body {
      width: 210mm;
      height: 297mm;
      margin: 0;
      background: white;
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    img {
      display: block;
      flex: none;
      object-fit: contain;
      image-orientation: from-image;
      width: 210mm;
      height: 297mm;
    }
  </style>
</head>
<body>
  <img id="print-image" src="data:${file.mediaType};base64,${file.data}" alt="${escapeHtml(file.name)}" />
</body>
</html>`
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const size = await page.evaluate(async () => {
      const img = document.getElementById('print-image')
      if (!img) return { width: 0, height: 0 }
      try {
        if (img.decode) await img.decode()
      } catch {}

      const width = img.naturalWidth || 0
      const height = img.naturalHeight || 0
      // Landscape image on portrait A4: turn it 90° so it fills the sheet
      // instead of printing as a thin strip across the middle.
      const rotated = width > height
      if (rotated) {
        img.style.width = '297mm'
        img.style.height = '210mm'
        img.style.transform = 'rotate(90deg)'
      }
      return { width, height, rotated }
    })
    console.log(`[image-pdf] ${file.name} ${size.width}x${size.height} fit=A4${size.rotated ? ' rotated=90' : ''}`)
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    })
  } finally {
    await page?.close().catch(() => {})
  }
}

function printUploadedFile(file, copies, printerOverride = null, printSettingsOverride = null) {
  return runPrintExclusive(
    `upload ${file?.name ?? 'file'}`,
    () => printUploadedFileImpl(file, copies, printerOverride, printSettingsOverride),
  )
}

// ── Drop-folder printing ─────────────────────────────────────────────────────
// Any PDF/image dropped into DROP_PRINT_DIR prints by itself, fitted to A4 with
// the orientation picked per page. "Color" subfolder → EPSON, "Black & White" →
// HP, the folder itself → auto (images color, PDFs B/W). Handled files are moved
// into _Printed / _Failed / _Not supported, grouped by day.
const DROP_PRINT_ENABLED = parseBoolean(process.env.DROP_PRINT_ENABLED ?? 'true')
const DROP_PRINT_DIR = process.env.DROP_PRINT_DIR || join(homedir(), 'Print Drop')
const DROP_PRINT_SUBFOLDERS = [['', null], ['Color', 'color'], ['Black & White', 'bw']]
const DROP_PRINT_MEDIA_TYPES = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}
const dropPrintSeen = new Map() // path -> "size:mtime" from the previous scan
const dropPrintWaiting = new Map() // path -> { name, reason, since }: held until a printer is back
const dropPrintRecent = [] // latest results, newest first, for /drop-print/status
let dropPrintScanning = false

// SumatraPDF auto-rotates each page to the paper unless portrait/landscape is forced.
function withoutForcedOrientation(settings) {
  return (settings ?? []).filter(setting => !/^(portrait|landscape)$/i.test(setting))
}

async function moveDropFile(src, folder, name) {
  const now = new Date()
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const dayDir = join(DROP_PRINT_DIR, folder, day)
  await mkdir(dayDir, { recursive: true })
  const time = now.toTimeString().slice(0, 8).replace(/:/g, '')
  const dest = join(dayDir, `${time}-${name}`)
  await rename(src, dest)
  return dest
}

// Explorer keeps the file locked while it is still copying in.
async function dropFileIsUnlocked(path) {
  try {
    const handle = await open(path, 'r+')
    await handle.close()
    return true
  } catch {
    return false
  }
}

function recordDropPrintResult(entry) {
  dropPrintRecent.unshift({ ...entry, at: new Date().toISOString() })
  dropPrintRecent.length = Math.min(dropPrintRecent.length, 50)
}

// The printer to use if `printer` fails mid-job, with settings suited to it.
function dropPrintAlternative(printer, mode) {
  if (printer === COLOR_PRINTER && COLOR_FALLBACK_PRINTER !== COLOR_PRINTER) {
    return { printer: COLOR_FALLBACK_PRINTER, printSettings: COLOR_FALLBACK_PRINT_SETTINGS }
  }
  if (printer === BW_PRINTER && BW_FALLBACK_PRINTER !== BW_PRINTER) {
    return {
      printer: BW_FALLBACK_PRINTER,
      printSettings: BW_FALLBACK_PRINTER === COLOR_PRINTER && mode === 'color' ? WHATSAPP_COLOR_PRINT_SETTINGS : BW_FALLBACK_PRINT_SETTINGS,
    }
  }
  return null
}

async function printDroppedFile({ path, name, mode }) {
  const mediaType = DROP_PRINT_MEDIA_TYPES[extname(name).toLowerCase()]
  if (!mediaType) {
    console.log(`[drop-print] not a PDF/image, skipped: ${name}`)
    await moveDropFile(path, '_Not supported', name).catch(() => {})
    recordDropPrintResult({ name, result: 'unsupported' })
    return
  }

  // Auto = photos in colour, PDFs in B/W. Resolving it up front lets the colour
  // and B/W fallback routes pick the other printer when the first is offline.
  const printMode = mode ?? (mediaType.startsWith('image/') ? 'color' : 'bw')
  const route = await routeWhatsAppPrintJob(printMode, { name, mediaType })
  const health = await getWindowsPrinterHealth(route.printer)
  if (!health.ok) {
    // Neither printer is usable: leave the file where it is and retry on later
    // scans, so it prints by itself as soon as a printer comes back.
    if (!dropPrintWaiting.has(path)) {
      console.warn(`[drop-print] no printer available for ${name}, waiting (${health.reason || health.status})`)
      dropPrintWaiting.set(path, { name, reason: health.reason || health.status, since: new Date().toISOString() })
    }
    return
  }
  dropPrintWaiting.delete(path)

  // Claim the file before printing so a server restart mid-print can't print it twice.
  const claimed = join(DROP_PRINT_DIR, '_Printing', `${Date.now()}-${name}`)
  try {
    await mkdir(join(DROP_PRINT_DIR, '_Printing'), { recursive: true })
    await rename(path, claimed)
  } catch (err) {
    console.warn(`[drop-print] could not pick up ${name}, will retry`, err?.message ?? err)
    return
  }

  let file
  try {
    const buffer = await readFile(claimed)
    file = { name, mediaType, buffer, data: buffer.toString('base64'), savedPath: claimed }
  } catch (err) {
    console.error(`[drop-print] could not read ${name}`, err?.message ?? err)
    await moveDropFile(claimed, '_Failed', name).catch(() => {})
    recordDropPrintResult({ name, result: 'failed', error: String(err?.message ?? err) })
    return
  }

  const attempts = [route]
  const alternative = dropPrintAlternative(route.printer, printMode)
  if (alternative) attempts.push({ ...alternative, fallback: { from: route.printer, to: alternative.printer, reason: 'print failed' } })

  let lastError = null
  for (const attempt of attempts) {
    try {
      if (attempt !== route) {
        const altHealth = await getWindowsPrinterHealth(attempt.printer)
        if (!altHealth.ok) break
        console.warn(`[drop-print] retrying ${name} on "${attempt.printer}"`)
      }
      const result = await printUploadedFile(file, 1, attempt.printer, withoutForcedOrientation(attempt.printSettings))
      const fallback = attempt.fallback || route.fallback || null
      console.log(`[drop-print] printed ${name} mode=${mode ?? 'auto'} printer="${result.printer}"${fallback ? ' fallback=true' : ''}`)
      await moveDropFile(claimed, '_Printed', name).catch(() => {})
      recordDropPrintResult({ name, result: 'printed', printer: result.printer, fallback })
      return
    } catch (err) {
      lastError = err
      printerHealthCache.delete(attempt.printer) // re-check this printer next time
      console.error(`[drop-print] failed to print ${name} on "${attempt.printer}"`, err?.message ?? err)
    }
  }

  await moveDropFile(claimed, '_Failed', name).catch(() => {})
  recordDropPrintResult({ name, result: 'failed', error: String(lastError?.message ?? lastError ?? 'no printer available') })
}

async function scanDropPrintFolder() {
  if (dropPrintScanning) return
  dropPrintScanning = true
  try {
    const ready = []
    const present = new Set()
    for (const [subfolder, mode] of DROP_PRINT_SUBFOLDERS) {
      const dir = join(DROP_PRINT_DIR, subfolder)
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isFile()) continue
        if (/^(~\$|\.)|\.(tmp|crdownload|part)$|^desktop\.ini$|^thumbs\.db$/i.test(entry.name)) continue
        const path = join(dir, entry.name)
        const info = await stat(path).catch(() => null)
        if (!info || info.size === 0) continue
        present.add(path)
        // Print only once size/mtime held steady across two scans (copy finished).
        const signature = `${info.size}:${info.mtimeMs}`
        if (dropPrintSeen.get(path) === signature && await dropFileIsUnlocked(path)) {
          ready.push({ path, name: entry.name, mode })
        }
        dropPrintSeen.set(path, signature)
      }
    }
    for (const path of dropPrintSeen.keys()) if (!present.has(path)) dropPrintSeen.delete(path)
    for (const path of dropPrintWaiting.keys()) if (!present.has(path)) dropPrintWaiting.delete(path)

    for (const item of ready) {
      dropPrintSeen.delete(item.path)
      await printDroppedFile(item)
    }
  } finally {
    dropPrintScanning = false
  }
}

async function startDropPrintFolder() {
  if (!DROP_PRINT_ENABLED) return
  try {
    for (const [subfolder] of DROP_PRINT_SUBFOLDERS) await mkdir(join(DROP_PRINT_DIR, subfolder), { recursive: true })
    // Anything still in _Printing was cut off by a restart: park it in _Failed
    // rather than risk printing it twice. Drop it in again to reprint.
    const leftovers = await readdir(join(DROP_PRINT_DIR, '_Printing')).catch(() => [])
    for (const name of leftovers) {
      await moveDropFile(join(DROP_PRINT_DIR, '_Printing', name), '_Failed', name.replace(/^\d+-/, '')).catch(() => {})
    }
  } catch (err) {
    console.warn('[drop-print] could not prepare folder', err?.message ?? err)
    return
  }
  setInterval(() => {
    scanDropPrintFolder().catch(err => console.warn('[drop-print] scan failed', err?.message ?? err))
  }, 2000)
  console.log(`   Drop-folder print: ${DROP_PRINT_DIR}`)
}

async function printUploadedFileImpl(file, copies, printerOverride = null, printSettingsOverride = null) {
  const primaryPrinter = printerOverride || selectUploadPrinter(file)
  const primaryPrintSettings = printSettingsOverride || printSettingsForWhatsAppPrinter(primaryPrinter)
  const route = await routeBwPrinterOnError(primaryPrinter, primaryPrintSettings, 'upload-print')
  const { printer, printSettings } = route
  if (printer === COLOR_PRINTER) await prepareEpsonPlainA4ColorDefaults(printer, 'upload-print')
  const extension = extensionForMediaType(file.mediaType)
  // If the file was already downloaded to the "whatsapp Prints" folder, print
  // from that stable copy and keep it; otherwise stage a temp copy and clean up.
  const savedPath = file.savedPath || null
  const sourcePath = savedPath || join(tmpdir(), `shiv-whatsapp-${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`)
  let printPath = sourcePath
  let renderedPdfPath = null

  try {
    if (!savedPath) await writeFile(sourcePath, file.buffer)

    // Images print directly (the printer driver scales them via the "fit"
    // setting). Only fall back to the Chrome-rendered A4 PDF wrapper when
    // direct printing is explicitly disabled.
    if (file.mediaType.startsWith('image/') && !WHATSAPP_IMAGE_DIRECT_PRINT) {
      const pdf = await renderUploadedImagePdf(file)
      renderedPdfPath = join(tmpdir(), `shiv-whatsapp-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`)
      await writeFile(renderedPdfPath, pdf)
      printPath = renderedPdfPath
    }

    const result = await printFileWithLp(printPath, copies, `WhatsApp ${file.name}`.slice(0, 80), printer, printSettings)
    return {
      name: file.name,
      mediaType: file.mediaType,
      printer,
      fallback: route.fallback,
      jobId: result.jobId,
    }
  } finally {
    if (!savedPath) await unlink(sourcePath).catch(() => {})
    if (renderedPdfPath) await unlink(renderedPdfPath).catch(() => {})
  }
}

function rememberWhatsAppMessageId(id) {
  if (!id) return false
  if (whatsappProcessedMessageIds.has(id)) return true
  whatsappProcessedMessageIds.add(id)
  if (whatsappProcessedMessageIds.size > 500) {
    const oldest = whatsappProcessedMessageIds.values().next().value
    whatsappProcessedMessageIds.delete(oldest)
  }
  saveWhatsAppProcessedMessageIds().catch(err => console.warn('[whatsapp-web] failed to save processed IDs', err.message ?? err))
  return false
}

function chatMatchesWhatsAppAutoPrintTarget(jid, name) {
  if (WHATSAPP_AUTO_PRINT_GROUP_ID) return jid === WHATSAPP_AUTO_PRINT_GROUP_ID
  const expected = normalizeNameKey(WHATSAPP_AUTO_PRINT_GROUP_NAME)
  const actual = normalizeNameKey(name || '')
  return Boolean(expected && actual && actual === expected)
}

function unwrapBaileysMessage(msg) {
  const m = msg.message
  if (!m) return null
  // WhatsApp wraps some message types — unwrap to get the actual content
  return (
    m.ephemeralMessage?.message ||
    m.viewOnceMessage?.message ||
    m.viewOnceMessageV2?.message?.viewOnceMessage?.message ||
    m.documentWithCaptionMessage?.message ||
    m.editedMessage?.message?.protocolMessage?.editedMessage ||
    m
  )
}

function getBaileysText(msg) {
  const m = unwrapBaileysMessage(msg)
  if (!m) return ''
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  )
}

function getBaileysMediaMimetype(msg) {
  const m = unwrapBaileysMessage(msg)
  if (!m) return null
  if (m.imageMessage) return (m.imageMessage.mimetype || 'image/jpeg').toLowerCase()
  if (m.documentMessage) {
    const mime = (m.documentMessage.mimetype || '').toLowerCase()
    if (mime) return mime
    // fall back to extension if mimetype missing
    const ext = (m.documentMessage.fileName || '').split('.').pop().toLowerCase()
    if (ext === 'pdf') return 'application/pdf'
    return 'application/octet-stream'
  }
  if (m.stickerMessage) return 'image/webp'
  return null
}

// Reply to a direct (1:1) WhatsApp message with the enquiry redirect, once per
// sender per cooldown. Skips our own outgoing messages and empty/system events.
async function maybeAutoReplyToDirectMessage(sock, jid, msg) {
  if (!WHATSAPP_AUTOREPLY_ENABLED) return
  if (msg.key?.fromMe) return          // don't reply to messages we sent
  if (!msg.message) return             // receipts / protocol events carry no content
  const messageId = msg.key?.id || ''
  if (messageId && rememberWhatsAppMessageId(messageId)) return  // already handled
  if (withinAutoReplyCooldown(jid)) return

  markAutoReplied(jid)
  try {
    await sock.sendMessage(jid, { text: WHATSAPP_AUTOREPLY_MESSAGE })
    console.log(`[whatsapp-autoreply] replied to ${jid}`)
  } catch (err) {
    whatsappRecentAutoReplyJids.delete(jid)
    console.error(`[whatsapp-autoreply] failed to reply to ${jid}`, err?.message ?? err)
  }
}

function isWhatsAppOrderCommand(text) {
  return /^\s*order\s*[.!]*\s*$/i.test(String(text ?? ''))
}

function rememberWhatsAppOrderImage(jid, sender, msg) {
  const now = Date.now()
  const list = (whatsappRecentOrderImages.get(jid) || [])
    .filter(entry => now - entry.at < WHATSAPP_ORDER_IMAGE_TTL_MS && entry.msg.key?.id !== msg.key?.id)
  list.push({ sender, msg, at: now })
  whatsappRecentOrderImages.set(jid, list.slice(-5))
  if (whatsappRecentOrderImages.size > 300) {
    for (const [key, entries] of whatsappRecentOrderImages) {
      if (!entries.some(entry => now - entry.at < WHATSAPP_ORDER_IMAGE_TTL_MS)) whatsappRecentOrderImages.delete(key)
    }
  }
}

// Latest recent image in the chat, preferring one sent by the same person.
function findRecentWhatsAppOrderImage(jid, sender) {
  const now = Date.now()
  const list = (whatsappRecentOrderImages.get(jid) || []).filter(entry => now - entry.at < WHATSAPP_ORDER_IMAGE_TTL_MS)
  for (let i = list.length - 1; i >= 0; i--) if (list[i].sender === sender) return list[i].msg
  return list.length ? list[list.length - 1].msg : null
}

async function extractOrderItemsFromImage(buffer, mediaType) {
  const response = await fetch(`${MESH_API_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MESH_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MESH_OCR_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: ORDER_OCR_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract the items from this handwritten bill.' },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${buffer.toString('base64')}`, detail: 'high' } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!response.ok) {
    throw new Error(`Mesh API ${response.status}: ${(await response.text()).slice(0, 300)}`)
  }
  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  const raw = Array.isArray(content) ? content.map(part => part?.text ?? '').join('\n') : String(content ?? '')
  // Strip code fences / bullets / numbering the model may add despite the prompt.
  return raw
    .split('\n')
    .map(line => line.replace(/^\s*(?:```\w*|[-*•]|\d+[.)])\s*/, '').trim())
    .filter(line => line && line !== '```' && !/^none$/i.test(line))
}

// Returns true when the message was an "order" command (handled here), false otherwise.
async function maybeHandleWhatsAppOrder(sock, msg, downloadMediaMessage) {
  if (!WHATSAPP_ORDER_OCR_ENABLED || !msg.message) return false
  const jid = msg.key.remoteJid || ''
  if (!/@(g\.us|s\.whatsapp\.net|lid)$/.test(jid)) return false

  const sender = msg.key.fromMe ? 'me' : (msg.key.participant || jid)
  const unwrapped = unwrapBaileysMessage(msg)
  if (!isWhatsAppOrderCommand(getBaileysText(msg))) {
    if (unwrapped?.imageMessage) rememberWhatsAppOrderImage(jid, sender, msg)
    return false
  }

  const messageId = msg.key.id || ''
  if (rememberWhatsAppMessageId(messageId)) return true
  console.log(`[whatsapp-order] "order" from=${sender} chat=${jid}`)

  // Which image: this message's own, the one it replies to, or a recent one in the chat.
  const quoted = unwrapped?.extendedTextMessage?.contextInfo
  let target = null
  if (unwrapped?.imageMessage) {
    target = unwrapped === msg.message ? msg : { ...msg, message: unwrapped }
  } else if (quoted?.quotedMessage?.imageMessage) {
    target = {
      key: { remoteJid: jid, id: quoted.stanzaId, participant: quoted.participant },
      message: { imageMessage: quoted.quotedMessage.imageMessage },
    }
  } else {
    const recent = findRecentWhatsAppOrderImage(jid, sender)
    if (recent) {
      const inner = unwrapBaileysMessage(recent)
      target = inner === recent.message ? recent : { ...recent, message: inner }
    }
  }

  const reply = text => sock.sendMessage(jid, { text }, { quoted: msg })
    .catch(err => console.error('[whatsapp-order] failed to send reply', err?.message ?? err))

  if (!target) {
    await reply('Send the bill photo with caption *order*, or reply to the photo with *order*.')
    return true
  }
  if (!MESH_API_KEY) {
    console.error('[whatsapp-order] MESH_API_KEY not set — cannot read bill')
    await reply('Bill reading is not set up yet (no API key on the shop PC).')
    return true
  }

  try {
    const buffer = await downloadMediaMessage(target, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage })
    if (!buffer?.length) throw new Error('empty image download')
    const mediaType = (target.message.imageMessage.mimetype || 'image/jpeg').split(';')[0].toLowerCase()
    const items = await extractOrderItemsFromImage(buffer, mediaType)
    console.log(`[whatsapp-order] extracted ${items.length} item(s) for chat=${jid}`)
    await reply(items.length ? items.join('\n') : 'No plywood, steel or telescopic items found in this bill.')
  } catch (err) {
    console.error('[whatsapp-order] failed', err?.message ?? err)
    await reply('Could not read this bill. Please send a clearer photo and try *order* again.')
  }
  return true
}

async function handleBaileysMessage(sock, msg, downloadMediaMessage) {
  // fromMe messages are intentionally NOT skipped: the shop owner often sends
  // images and the bw/cp command from the same account that hosts this WhatsApp
  // session, so their own media must buffer and their own commands must flush.
  const jid = msg.key.remoteJid || ''

  // "order" → read the bill photo and reply with the items (any chat, anyone).
  if (await maybeHandleWhatsAppOrder(sock, msg, downloadMediaMessage)) return

  // Direct 1:1 chats: auto-reply with the enquiry redirect, then stop. (Groups
  // fall through to the auto-print handling below.)
  if (jid.endsWith('@s.whatsapp.net')) {
    await maybeAutoReplyToDirectMessage(sock, jid, msg)
    return
  }

  if (!jid.endsWith('@g.us')) return

  // A message that failed to decrypt arrives as an empty stub; WhatsApp then
  // re-sends it with the SAME id. Don't remember the stub's id, or the real
  // (decrypted) retry would be dropped as a duplicate and never print.
  if (!msg.message) {
    console.log(`[whatsapp-web] group message ${msg.key.id || '?'} arrived without content (stub=${msg.messageStubType ?? '-'}), waiting for retry`)
    return
  }

  const messageId = msg.key.id || ''
  if (rememberWhatsAppMessageId(messageId)) return

  if (!whatsappGroupNameCache.has(jid)) {
    try {
      const meta = await sock.groupMetadata(jid)
      whatsappGroupNameCache.set(jid, meta.subject || '')
    } catch {
      whatsappGroupNameCache.set(jid, '')
    }
  }
  const groupName = whatsappGroupNameCache.get(jid) || ''
  if (!chatMatchesWhatsAppAutoPrintTarget(jid, groupName)) return

  const sender = msg.key.participant || jid
  const text = getBaileysText(msg)
  // A bw/cp command only applies to THIS message (its own caption) or, when sent
  // as a standalone text message, to media already buffered before it. It is NOT
  // remembered for future media — a command sent before any image must never
  // auto-print images that arrive later.
  const directPrintMode = parseWhatsAppPrintMode(text)

  const mediaType = getBaileysMediaMimetype(msg)
  console.log(`[whatsapp-web] group="${groupName}" msg=${messageId} keys=${Object.keys(unwrapBaileysMessage(msg) || {}).join(',')} media=${mediaType || '-'}`)

  if (!mediaType) {
    if (directPrintMode) {
      const pending = flushWhatsAppPendingMedia(jid, sender)
      if (pending.length > 0) {
        console.log(`[whatsapp-web] flushing ${pending.length} buffered media for sender="${sender}" mode="${directPrintMode}"`)
        // Print buffered media one at a time, in the order received. The shared
        // print queue already serializes execution, but iterating sequentially
        // also preserves page order.
        for (const file of pending) {
          try {
            const route = await routeWhatsAppPrintJob(directPrintMode, file)
            const result = await printUploadedFile(file, WHATSAPP_AUTO_PRINT_COPIES, route.printer, route.printSettings)
            whatsappWebState.lastPrint = {
              at: new Date().toISOString(), group: groupName, sender,
              name: file.name, mediaType: file.mediaType, printMode: directPrintMode,
              printer: result.printer, fallback: route.fallback, jobId: result.jobId,
            }
            whatsappWebState.lastError = null
            console.log(`[whatsapp-web] printed buffered ${file.name} mode="${directPrintMode}" from group="${groupName}" sender="${sender}" printer="${result.printer}"${route.fallback ? ' fallback=true' : ''}`)
          } catch (printErr) {
            console.error(`[whatsapp-web] failed to print buffered ${file.name}`, printErr)
          }
        }
      }
    }
    return
  }

  if (!WHATSAPP_AUTO_PRINT_MEDIA_TYPES.has(mediaType)) {
    console.log(`[whatsapp-web] skipped unsupported media type ${mediaType} from ${groupName}`)
    return
  }

  whatsappWebState.lastMessageAt = new Date().toISOString()

  // Build a synthetic msg with the unwrapped content for downloadMediaMessage
  const unwrapped = unwrapBaileysMessage(msg)
  const msgForDownload = unwrapped === msg.message
    ? msg
    : { ...msg, message: unwrapped }

  let buffer
  try {
    buffer = await downloadMediaMessage(msgForDownload, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage })
  } catch (dlErr) {
    console.error('[whatsapp-web] failed to download media', dlErr.message ?? dlErr)
    return
  }
  if (!buffer?.length) return

  const extension = extensionForMediaType(mediaType)
  const filename = unwrapped?.documentMessage?.fileName || `whatsapp-${Date.now()}${extension}`
  // Only this media's own caption can trigger an immediate print. Otherwise it is
  // buffered until a bw/cp command is sent. No stale/earlier command is applied.
  const printMode = directPrintMode || null

  const file = decodeUploadedFile({
    name: filename,
    mediaType,
    data: buffer.toString('base64'),
  }, 0)

  // Download to the persistent "whatsapp Prints" folder BEFORE queueing to print,
  // so the media is never lost even if it has to wait behind other jobs.
  try {
    file.savedPath = await saveWhatsAppPrintFile(file)
    console.log(`[whatsapp-web] saved ${file.mediaType} to "${file.savedPath}"`)
  } catch (saveErr) {
    console.error('[whatsapp-web] failed to save media to prints folder', saveErr.message ?? saveErr)
  }

  if (!printMode) {
    rememberWhatsAppPendingMedia(jid, sender, file)
    console.log(`[whatsapp-web] buffered ${mediaType} from group="${groupName}" sender="${sender}" waiting for cp/bw command`)
    return
  }

  try {
    const route = await routeWhatsAppPrintJob(printMode, file)
    const result = await printUploadedFile(file, WHATSAPP_AUTO_PRINT_COPIES, route.printer, route.printSettings)
    whatsappWebState.lastPrint = {
      at: new Date().toISOString(), group: groupName, sender,
      name: file.name, mediaType, printMode,
      printer: result.printer, fallback: route.fallback, jobId: result.jobId,
    }
    whatsappWebState.lastError = null
    console.log(`[whatsapp-web] printed ${file.name} mode="${printMode}" from group="${groupName}" sender="${sender}" printer="${result.printer}"${route.fallback ? ' fallback=true' : ''}`)
  } catch (err) {
    whatsappWebState.lastError = { at: new Date().toISOString(), error: String(err.message ?? err) }
    console.error('[whatsapp-web] auto print failed', err)
  }
}

async function startWhatsAppWebAutoPrint() {
  if (!WHATSAPP_AUTO_PRINT_ENABLED) {
    console.log('   WhatsApp Web auto-print: disabled')
    return
  }

  try {
    const {
      makeWASocket, useMultiFileAuthState, DisconnectReason,
      downloadMediaMessage, makeCacheableSignalKeyStore, fetchLatestBaileysVersion,
    } = await import('@whiskeysockets/baileys')
    const qrcode = await import('qrcode')

    // WhatsApp rejects outdated client versions with "Connection Failure" (405).
    // AUTO-REPAIR: fetch the current WA-web version before each connect (throttled
    // to once a minute) instead of the stale one bundled with Baileys, so when
    // WhatsApp pushes a breaking version bump the server self-heals on the next
    // reconnect — no manual restart. Falls back to the bundled default on error.
    let waVersion
    let lastVersionFetch = 0
    // Start with Baileys' bundled version (stable, matched to this build). Only flip
    // this on if WhatsApp rejects it with a 405 "Connection Failure" — then we pin
    // the fetched current version. Self-healing without destabilising normal use.
    let forceFetchedVersion = false
    async function refreshWaVersion() {
      if (waVersion && Date.now() - lastVersionFetch < 60_000) return
      try {
        const info = await fetchLatestBaileysVersion()
        if (info?.version) {
          waVersion = info.version
          lastVersionFetch = Date.now()
          console.log(`   WhatsApp Web: using WA version ${waVersion.join('.')}`)
        }
      } catch (err) {
        console.warn('[whatsapp-web] could not fetch latest WA version, using bundled:', err?.message ?? err)
      }
    }
    // Reassignable: on a real logout we wipe the auth folder and reload these so
    // the next connect() starts fresh and Baileys emits a new QR to re-scan.
    let { state, saveCreds } = await useMultiFileAuthState(WHATSAPP_WEB_AUTH_DIR)

    async function resetWhatsAppAuth() {
      try {
        await rm(WHATSAPP_WEB_AUTH_DIR, { recursive: true, force: true })
      } catch (err) {
        console.warn('[whatsapp-web] failed to clear auth dir', err.message ?? err)
      }
      const reloaded = await useMultiFileAuthState(WHATSAPP_WEB_AUTH_DIR)
      state = reloaded.state
      saveCreds = reloaded.saveCreds
    }

    const silentLogger = {
      level: 'silent',
      trace: () => {}, debug: () => {}, info: () => {},
      warn: () => {}, error: () => {}, fatal: () => {},
      child: () => silentLogger,
    }

    // Each connect() bumps the generation; a socket only schedules its own
    // reconnect if it's still the latest, so manual re-logins don't stack sockets.
    let connectGen = 0
    // Escalating backoff: repeated "Connection Failure" usually means WhatsApp is
    // rate-limiting us; hammering every few seconds only prolongs the block.
    let reconnectAttempts = 0

    async function connect() {
      const myGen = ++connectGen
      // Only fetch/pin a version if WhatsApp previously rejected the bundled one.
      if (forceFetchedVersion) {
        await refreshWaVersion()
        if (myGen !== connectGen) return // superseded while awaiting
      }
      const sock = makeWASocket({
        // Only pinned after a 405 version rejection; otherwise uses Baileys' bundled version.
        ...(forceFetchedVersion && waVersion ? { version: waVersion } : {}),
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
        },
        printQRInTerminal: false,
        logger: silentLogger,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        markOnlineOnConnect: false,
      })
      whatsappConnectingSock = sock

      sock.ev.on('creds.update', saveCreds)

      sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
          whatsappWebState.status = 'qr'
          whatsappWebState.qrDataUrl = await qrcode.toDataURL(qr).catch(() => null)
          whatsappWebState.lastError = null
          whatsappLastHealthy = Date.now()
          console.log('   WhatsApp Web auto-print: scan QR at /whatsapp-web')
        }
        if (connection === 'open') {
          whatsappSock = sock
          reconnectAttempts = 0
          whatsappLastHealthy = Date.now()
          whatsappWebState.status = 'ready'
          whatsappWebState.readyAt = whatsappWebState.readyAt || new Date().toISOString()
          whatsappWebState.qrDataUrl = null
          whatsappWebState.lastError = null
          console.log(`   WhatsApp Web auto-print: ready for group "${WHATSAPP_AUTO_PRINT_GROUP_NAME}"`)
        }
        if (connection === 'close') {
          if (whatsappSock === sock) whatsappSock = null
          const code = lastDisconnect?.error?.output?.statusCode
          const loggedOut = code === DisconnectReason.loggedOut
          whatsappWebState.status = loggedOut ? 'logged_out' : 'reconnecting'
          const errMsg = String(lastDisconnect?.error?.message ?? lastDisconnect?.error ?? '')
          whatsappWebState.lastError = lastDisconnect?.error
            ? { at: new Date().toISOString(), code, error: errMsg }
            : null
          // If WhatsApp rejects our client version (405 / "Connection Failure"),
          // switch to the fetched current WA-web version on the next reconnect.
          if (!forceFetchedVersion && !loggedOut && (code === 405 || /connection failure/i.test(errMsg))) {
            forceFetchedVersion = true
            console.log('[whatsapp-web] client version rejected — switching to fetched WA version')
          }
          console.log(`[whatsapp-web] disconnected code=${code}${loggedOut ? ', logged out — re-scan QR' : ', reconnecting...'}`)
          if (loggedOut) {
            whatsappGroupNameCache.clear()
            whatsappWebState.qrDataUrl = null
            whatsappWebState.readyAt = null
            // Wipe the dead session so the reconnect below produces a fresh QR.
            await resetWhatsAppAuth()
          }
          // Only reconnect if a newer connect() (e.g. a manual relogin) hasn't superseded us.
          if (myGen === connectGen) {
            reconnectAttempts = loggedOut ? 0 : reconnectAttempts + 1
            // 1s after a clean logout; otherwise back off 10s → 20s → … → 60s.
            const delay = loggedOut ? 1000 : Math.min(60_000, 10_000 * reconnectAttempts)
            setTimeout(() => { if (myGen === connectGen) connect() }, delay)
          }
        }
      })

      sock.ev.on('messages.upsert', ({ messages, type }) => {
        // 'notify' = real-time; 'append' = catchup after reconnect — process both,
        // but skip 'append' messages older than the command TTL (avoid reprinting old msgs)
        if (type !== 'notify' && type !== 'append') return
        const cutoff = type === 'append' ? Date.now() - WHATSAPP_AUTO_PRINT_COMMAND_TTL_MS : 0
        for (const msg of messages) {
          const msgTs = (msg.messageTimestamp ?? 0) * 1000
          if (cutoff > 0 && msgTs < cutoff) continue
          const rjid = msg.key?.remoteJid || ''
          if (!rjid.endsWith('@g.us') && rjid !== 'status@broadcast') {
            console.log(`[whatsapp-web] direct ${type} from=${rjid} fromMe=${!!msg.key?.fromMe} content=${msg.message ? Object.keys(msg.message).join(',') : 'none'}`)
          }
          handleBaileysMessage(sock, msg, downloadMediaMessage).catch(err => {
            console.error('[whatsapp-web] message handling error', err.message ?? err)
          })
        }
      })
    }

    // Clear the saved session and reconnect from scratch → a fresh QR to scan.
    whatsappRelogin = async () => {
      console.log('[whatsapp-web] manual relogin requested — clearing session')
      try { whatsappSock?.end?.(new Error('manual relogin')) } catch { /* ignore */ }
      whatsappSock = null
      whatsappWebState.status = 'starting'
      whatsappWebState.qrDataUrl = null
      whatsappWebState.readyAt = null
      whatsappGroupNameCache.clear()
      await resetWhatsAppAuth()
      connect()
    }

    // Reconnect but KEEP the saved session — recovers a stalled link with no re-scan.
    whatsappReconnect = async () => {
      try { whatsappSock?.end?.(new Error('reconnect')) } catch { /* ignore */ }
      whatsappSock = null
      connect()
    }

    connect()
  } catch (err) {
    whatsappWebState.status = 'error'
    whatsappWebState.lastError = { at: new Date().toISOString(), error: String(err.message ?? err) }
    console.error('[whatsapp-web] failed to start', err)
  }
}

// Turn a customer's stored mobile into a WhatsApp JID. Handles the common Indian
// formats: bare 10-digit local, a leading 0, a +country-code prefix, or an
// already-full 12-digit number. Returns null if it can't form a plausible number.
function customerMobileToWhatsAppJid(rawMobile) {
  let digits = String(rawMobile ?? '').replace(/\D/g, '')
  if (!digits) return null
  // Drop a single leading trunk 0 (e.g. 08709964141 -> 8709964141).
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  // Bare local number -> prepend the configured country code.
  if (digits.length === 10) digits = `${WHATSAPP_CUSTOMER_COUNTRY_CODE}${digits}`
  // Anything shorter than a country code + subscriber number is not dialable.
  if (digits.length < 11 || digits.length > 15) return null
  return `${digits}@s.whatsapp.net`
}

// Message the customer that their guarantee card is ready. Fire-and-forget:
// callers should not await print completion on this. Deduped by card number.
async function notifyCustomerGuaranteeReady(document) {
  if (!WHATSAPP_CUSTOMER_NOTIFY_ENABLED) return
  const number = document?.number ?? document?.id
  const mobile = document?.customer?.mobile
  const name = document?.customer?.name || ''
  if (!number) return
  if (whatsappNotifiedGuarantees.has(number)) return

  const jid = customerMobileToWhatsAppJid(mobile)
  if (!jid) {
    console.warn(`[whatsapp-notify] guarantee ${number}: no usable customer mobile ("${mobile ?? ''}") — skipped`)
    return
  }
  if (!whatsappSock || whatsappWebState.status !== 'ready') {
    console.warn(`[whatsapp-notify] guarantee ${number}: WhatsApp not connected (status=${whatsappWebState.status}) — skipped`)
    return
  }
  if (withinNotifyCooldown(jid)) {
    console.log(`[whatsapp-notify] guarantee ${number}: ${jid} messaged within the cooldown window — skipped`)
    whatsappNotifiedGuarantees.add(number)
    return
  }

  // Mark as notified BEFORE sending so a slow/failed send can't be retried into
  // a duplicate by a concurrent reprint. Roll back only on a hard send failure.
  whatsappNotifiedGuarantees.add(number)
  try {
    // Confirm the number is actually on WhatsApp before sending (avoids errors
    // and stray messages to non-WhatsApp numbers). Tolerate the check failing.
    try {
      const [check] = await whatsappSock.onWhatsApp(jid)
      if (check && check.exists === false) {
        console.warn(`[whatsapp-notify] guarantee ${number}: ${jid} is not on WhatsApp — skipped`)
        return
      }
    } catch { /* onWhatsApp check failed — proceed with the send anyway */ }

    await whatsappSock.sendMessage(jid, { text: buildGuaranteeMessage(name) })
    markJidNotified(jid)
    whatsappWebState.lastCustomerNotify = { at: new Date().toISOString(), number, jid, name }
    console.log(`[whatsapp-notify] sent guarantee-ready message for ${number} to ${jid}${name ? ` (${name})` : ''}`)
    await saveWhatsAppNotifiedGuarantees().catch(() => {})
  } catch (err) {
    whatsappNotifiedGuarantees.delete(number)
    whatsappWebState.lastError = { at: new Date().toISOString(), error: `notify ${number}: ${String(err?.message ?? err)}` }
    console.error(`[whatsapp-notify] failed to message customer for ${number}`, err?.message ?? err)
  }
}

// Send the guarantee-ready message to one mobile immediately — no dedupe, no
// print. Backs the "Generate" button and the diagnostic endpoint. Throws an
// Error with a user-facing message on any failure; resolves with the JID sent to.
async function sendGuaranteeWhatsAppTo(rawMobile, name = '') {
  const jid = customerMobileToWhatsAppJid(rawMobile)
  if (!jid) throw new Error(`Enter a valid mobile number (got "${rawMobile ?? ''}").`)
  if (!whatsappSock || whatsappWebState.status !== 'ready') {
    throw new Error(`WhatsApp is not connected on the shop computer (status: ${whatsappWebState.status}).`)
  }
  const message = buildGuaranteeMessage(name)
  if (withinNotifyCooldown(jid)) {
    console.log(`[whatsapp-notify] skipped ${jid} — messaged within the last cooldown window`)
    return { jid, message, skipped: true }
  }

  let existsCheck
  try {
    const [check] = await whatsappSock.onWhatsApp(jid)
    existsCheck = check
  } catch { /* existence check failed — proceed with the send anyway */ }
  if (existsCheck && existsCheck.exists === false) throw new Error(`${rawMobile} is not on WhatsApp.`)

  await whatsappSock.sendMessage(jid, { text: message })
  markJidNotified(jid)
  whatsappWebState.lastCustomerNotify = { at: new Date().toISOString(), jid, name, source: 'manual' }
  console.log(`[whatsapp-notify] sent guarantee message (manual) to ${jid}${name ? ` (${name})` : ''}`)
  return { jid, message, skipped: false }
}

function printDocumentPayload(payload, copies) {
  const kind = payload?.kind ?? 'quotation'
  return runPrintExclusive(`document ${kind}`, () => printDocumentPayloadImpl(payload, copies))
}

async function printDocumentPayloadImpl({ kind, quote, document, bill, layout = 'a4', printerOverride, slot, documents }, copies) {
  const documentKind = kind ?? 'quotation'
  // Card jobs may carry two documents (one per tray slot) via `documents`.
  const cardDocuments = Array.isArray(documents) && documents.length ? documents.slice(0, 2) : null
  if (documentKind === 'guarantee' && cardDocuments) document = document ?? cardDocuments[0]
  if (documentKind === 'guarantee' && !document) throw new Error('Missing guarantee document data')
  if (documentKind === 'bill' && !bill) throw new Error('Missing bill data')
  if (documentKind !== 'guarantee' && documentKind !== 'bill' && !quote) throw new Error('Missing quotation data')
  const primaryPrinter = printerOverride || selectDocumentPrinter({ kind: documentKind, layout })
  const isCard = documentKind === 'guarantee' && layout === 'card'
  // Bills print at best quality (print-quality=5 is the IPP "best" level)
  const billPrintSettings = parsePrintSettings(process.env.BILL_PRINT_SETTINGS || 'print-quality=5')
  const route = isCard
    ? { printer: primaryPrinter, printSettings: EPSON_CARD_PRINT_SETTINGS, fallback: null }
    : documentKind === 'quotation'
      ? { printer: primaryPrinter, printSettings: QUOTATION_PRINT_SETTINGS, fallback: null }
      : await routeBwPrinterOnError(primaryPrinter, documentKind === 'bill' ? billPrintSettings : [], `document-print:${documentKind}`)
  let { printer } = route
  // Auto-route away from an offline printer to any online one (cards need the
  // EPSON ID-card tray, so they are never re-routed).
  if (!isCard) {
    const picked = await pickReachablePrinter(printer)
    if (picked.switched) {
      console.log(`[auto-printer] "${picked.from}" offline → routing to "${picked.printer}"`)
      printer = picked.printer
    }
  }
  if (documentKind === 'quotation' && printer === COLOR_PRINTER) {
    await prepareEpsonPlainA4ColorDefaults(printer, 'document-print:quotation')
  }

  let page
  let tmp
  let tmp2
  try {
    const html = documentKind === 'guarantee'
      ? await buildGuaranteeHtml(document, layout)
      : documentKind === 'bill'
        ? buildBillHtml(bill)
        : await buildQuotationHtml(quote)
    page = await getSharedPage()

    // For bills: pin viewport to exactly 148×210mm at 96dpi so Puppeteer renders
    // at the same pixel dimensions as the in-app preview iframe (559×793px).
    if (documentKind === 'bill') {
      await page.setViewport({ width: 559, height: 793, deviceScaleFactor: 1 })
    }

    if (shouldUseCardImageEngine(isCard)) {
      const cardWidthPx = Math.ceil((CARD_WIDTH_MM / 25.4) * 96)
      const cardHeightPx = Math.ceil((CARD_HEIGHT_MM / 25.4) * 96)
      await page.setViewport({
        width: cardWidthPx,
        height: cardHeightPx,
        deviceScaleFactor: 4,
      })
      await page.setContent(html, { waitUntil: 'networkidle0' })
      const png = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: cardWidthPx, height: cardHeightPx },
      })
      tmp = join(tmpdir(), `shiv-card-${Date.now()}.png`)
      await writeFile(tmp, png)

      // Second document → second card rendered for slot 2 in the same pass
      const secondDocument = cardDocuments?.[1] ?? null
      if (secondDocument) {
        const html2 = await buildGuaranteeHtml(secondDocument, layout)
        await page.setContent(html2, { waitUntil: 'networkidle0' })
        const png2 = await page.screenshot({
          type: 'png',
          clip: { x: 0, y: 0, width: cardWidthPx, height: cardHeightPx },
        })
        tmp2 = join(tmpdir(), `shiv-card-${Date.now()}-slot2.png`)
        await writeFile(tmp2, png2)
      }

      const printResult = await printCardImage(tmp, copies, `Shiv ${documentKind}`, printer, {
        slot: Number(slot) === 2 ? 2 : 1,
        filePath2: tmp2 ?? null,
      })
      return {
        printer,
        fallback: route.fallback,
        jobId: printResult.jobId,
      }
    }

    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf(isCard
      ? {
          width: `${CARD_WIDTH_MM}mm`,
          height: `${CARD_HEIGHT_MM}mm`,
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
        }
      : documentKind === 'bill'
        ? { width: '148mm', height: '210mm', printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } }
        : { format: 'A4', printBackground: true })
    tmp = join(tmpdir(), `shiv-print-${Date.now()}.pdf`)
    await writeFile(tmp, pdf)
    const printResult = await printFileWithLp(tmp, copies, `Shiv ${documentKind}`, printer, route.printSettings)
    return {
      printer,
      fallback: route.fallback,
      jobId: printResult.jobId,
    }
  } finally {
    await page?.close().catch(() => {})
    if (tmp) await unlink(tmp).catch(() => {})
    if (tmp2) await unlink(tmp2).catch(() => {})
  }
}

// Report our current LAN URL(s) to the cloud so same-Wi-Fi tablets can find us
// without scanning the whole subnet. Best-effort: silently ignored if the cloud
// is unreachable or running an older build without the endpoint.
async function sendCloudHeartbeat() {
  if (!CLOUD_API_URL) return
  try {
    await cloudRequest('/api/printer-agents/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ printerId: PRINTER_AGENT_ID, lanUrls: localNetworkUrls(PORT) }),
    })
  } catch {
    /* best-effort presence beacon */
  }
}

async function cloudRequest(path, options = {}) {
  if (!CLOUD_API_URL) throw new Error('CLOUD_API_URL is not configured')
  const response = await fetch(`${CLOUD_API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(CLOUD_API_KEY ? { Authorization: `Bearer ${CLOUD_API_KEY}` } : {}),
      ...(options.headers ?? {}),
    },
  })
  const json = await response.json().catch(() => null)
  if (!response.ok || json?.ok === false) {
    throw new Error(json?.error ?? `Cloud API returned HTTP ${response.status}`)
  }
  return json
}

async function markCloudJob(path, body) {
  await cloudRequest(path, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

async function printCloudJob(job) {
  const copies = sanitizeCopies(job.copies)
  if (job.kind === 'quotation') {
    const quote = job.payload?.quote ?? job.payload
    return await printDocumentPayload({ kind: 'quotation', quote }, copies)
  }

  if (job.kind === 'guarantee') {
    const document = job.payload?.document ?? job.payload
    const layout = job.payload?.layout ?? 'a4'
    // A phone sends the same card job the counter does: the tray slot, and a
    // second card for slot 2 when two are printed together.
    const documents = Array.isArray(job.payload?.documents) && job.payload.documents.length
      ? job.payload.documents.slice(0, 2).map(doc => withGuaranteeQr(doc, null))
      : undefined
    const slot = job.payload?.slot === 2 ? 2 : layout === 'card' ? 1 : undefined
    const result = await printDocumentPayload({
      kind: 'guarantee', document: withGuaranteeQr(document, null), layout,
      ...(slot ? { slot } : {}), ...(documents ? { documents } : {}),
    }, copies)
    const told = new Set()
    for (const doc of documents ?? [document]) {
      const mobile = String(doc?.customer?.mobile ?? '').trim()
      if (mobile && told.has(mobile)) continue
      told.add(mobile)
      notifyCustomerGuaranteeReady(doc).catch(err =>
        console.error('[whatsapp-notify] unhandled', err?.message ?? err))
    }
    return result
  }

  if (job.kind === 'raw-file') {
    const files = Array.isArray(job.payload?.files) ? job.payload.files : [job.payload]
    const results = []
    for (let i = 0; i < files.length; i += 1) {
      results.push(await printUploadedFile(decodeUploadedFile(files[i], i), copies))
    }
    return { files: results }
  }

  throw new Error(`Unsupported cloud print job kind: ${job.kind}`)
}

let cloudPollRunning = false

async function pollCloudPrintJobs() {
  if (!CLOUD_API_URL || cloudPollRunning) return
  cloudPollRunning = true
  try {
    const response = await cloudRequest('/api/print-jobs/claim', {
      method: 'POST',
      body: JSON.stringify({ printerId: PRINTER_AGENT_ID, limit: 3 }),
    })
    const jobs = Array.isArray(response.jobs) ? response.jobs : []

    for (const job of jobs) {
      try {
        await markCloudJob(`/api/print-jobs/${job._id}/printing`, { printerId: PRINTER_AGENT_ID })
        await printCloudJob(job)
        await markCloudJob(`/api/print-jobs/${job._id}/complete`, { printerId: PRINTER_AGENT_ID })
        console.log(`[cloud-print] completed ${job._id}`)
      } catch (err) {
        console.error(`[cloud-print] failed ${job._id}`, err)
        await markCloudJob(`/api/print-jobs/${job._id}/fail`, {
          printerId: PRINTER_AGENT_ID,
          error: String(err.message ?? err),
        }).catch(markErr => console.error('[cloud-print] failed to mark failure', markErr))
      }
    }
  } catch (err) {
    const cause = err?.cause ? ` (${err.cause.code ?? ''} ${err.cause.message ?? err.cause})` : ''
    console.warn(`[cloud-print] poll failed: ${err.message ?? err}${cause}`)
  } finally {
    cloudPollRunning = false
  }
}

function buildWhatsAppPrintPage(publicUrl) {
  const uploadUrl = `${publicUrl}/whatsapp-print`
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Shiv WhatsApp Print</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f7f9;
      color: #151922;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    main {
      width: min(560px, 100%);
      background: white;
      border: 1px solid #dde2ea;
      border-radius: 8px;
      box-shadow: 0 16px 40px rgba(21, 25, 34, 0.10);
      padding: 22px;
    }
    h1 {
      font-size: 24px;
      line-height: 1.2;
      margin: 0 0 8px;
      letter-spacing: 0;
    }
    p {
      margin: 0 0 18px;
      color: #596273;
      line-height: 1.5;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 700;
      color: #303747;
      margin-bottom: 8px;
    }
    input[type="file"],
    input[type="number"] {
      width: 100%;
      border: 1px solid #cbd3df;
      border-radius: 6px;
      padding: 12px;
      font: inherit;
      background: #fff;
    }
    .row {
      display: grid;
      gap: 16px;
      margin-bottom: 16px;
    }
    button,
    a.button {
      width: 100%;
      border: 0;
      border-radius: 6px;
      background: #117a37;
      color: white;
      font: inherit;
      font-weight: 800;
      padding: 13px 16px;
      text-align: center;
      text-decoration: none;
      cursor: pointer;
    }
    button:disabled {
      cursor: wait;
      opacity: 0.65;
    }
    a.button {
      display: block;
      margin-top: 10px;
      background: #263244;
    }
    .status {
      min-height: 24px;
      margin-top: 14px;
      font-size: 14px;
      color: #303747;
      white-space: pre-wrap;
    }
    .error { color: #b42318; }
    .ok { color: #067647; }
    small {
      display: block;
      margin-top: 14px;
      color: #7a8392;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
  </style>
</head>
<body>
  <main>
    <h1>Shiv WhatsApp Print</h1>
    <p>Select photos or PDFs from WhatsApp and print them on the shop computer.</p>
    <form id="printForm">
      <div class="row">
        <div>
          <label for="files">Images or PDFs</label>
          <input id="files" name="files" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" multiple required />
        </div>
        <div>
          <label for="copies">Copies</label>
          <input id="copies" name="copies" type="number" min="1" max="20" value="1" />
        </div>
      </div>
      <button id="submitButton" type="submit">Print Selected Files</button>
      <a class="button" href="/whatsapp-print/share">Share This Link on WhatsApp</a>
      <div id="status" class="status"></div>
    </form>
    <small>Link: ${escapeHtml(uploadUrl)}<br />Allowed: PDF, JPG, PNG, WEBP, GIF. Max ${WHATSAPP_MAX_FILES} files, ${Math.round(WHATSAPP_MAX_FILE_BYTES / 1024 / 1024)} MB each.</small>
  </main>
  <script>
    const form = document.getElementById('printForm')
    const filesInput = document.getElementById('files')
    const copiesInput = document.getElementById('copies')
    const button = document.getElementById('submitButton')
    const status = document.getElementById('status')

    function readFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error(file.name + ': could not read file'))
        reader.onload = () => {
          const result = String(reader.result || '')
          resolve({
            name: file.name,
            mediaType: file.type || 'application/octet-stream',
            data: result.includes(',') ? result.slice(result.indexOf(',') + 1) : result,
          })
        }
        reader.readAsDataURL(file)
      })
    }

    form.addEventListener('submit', async event => {
      event.preventDefault()
      status.className = 'status'
      const selected = Array.from(filesInput.files || [])
      if (!selected.length) {
        status.className = 'status error'
        status.textContent = 'Select at least one file.'
        return
      }
      if (selected.length > ${WHATSAPP_MAX_FILES}) {
        status.className = 'status error'
        status.textContent = 'Select ${WHATSAPP_MAX_FILES} files or fewer.'
        return
      }

      button.disabled = true
      status.textContent = 'Reading files...'
      try {
        const files = await Promise.all(selected.map(readFile))
        status.textContent = 'Sending to printer...'
        const response = await fetch('/whatsapp-print/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files, copies: copiesInput.value }),
        })
        const json = await response.json().catch(() => null)
        if (!response.ok || !json || !json.ok) {
          throw new Error((json && json.error) || 'Print failed')
        }
        status.className = 'status ok'
        status.textContent = 'Printed ' + json.jobs.length + ' file(s).\\n' + json.jobs.map(job => job.name + (job.jobId ? ' - ' + job.jobId : '')).join('\\n')
        form.reset()
        copiesInput.value = '1'
      } catch (error) {
        status.className = 'status error'
        status.textContent = error && error.message ? error.message : String(error)
      } finally {
        button.disabled = false
      }
    })
  </script>
</body>
</html>`
}

async function writeJSON(url, value) {
  await writeFile(url, `${JSON.stringify(value, null, 2)}\n`)
}

function uniquePush(list, value) {
  const clean = String(value ?? '').trim()
  if (!clean) return false
  if (list.some(existing => normalizeNameKey(existing) === normalizeNameKey(clean))) return false
  list.push(clean)
  return true
}

function splitCustomerParts(value) {
  const parts = String(value ?? '').split(',').map(part => part.trim()).filter(Boolean)
  return {
    name: parts[0] ?? '',
    place: parts.slice(1).join(', '),
  }
}

function learnNameCorrections(beforeName, afterName) {
  const before = splitCustomerParts(beforeName).name
  const after = splitCustomerParts(afterName).name
  if (!before || !after || normalizeNameKey(before) === normalizeNameKey(after)) return []

  const learned = []
  const data = readJSON(NAME_CORRECTIONS_URL, { preferredNames: [], ocrCorrections: {} })
  const beforeTokens = before.match(/\b[a-z][a-z'.-]{2,}\b/gi) ?? []
  const afterTokens = after.match(/\b[a-z][a-z'.-]{2,}\b/gi) ?? []

  for (const token of afterTokens) uniquePush(data.preferredNames, titleCaseName(token))

  if (beforeTokens.length === afterTokens.length) {
    for (let i = 0; i < beforeTokens.length; i += 1) {
      const from = normalizeNameKey(beforeTokens[i])
      const to = titleCaseName(afterTokens[i])
      if (!from || HONORIFICS.has(from) || normalizeNameKey(to) === from) continue
      data.ocrCorrections[from] = to
      learned.push(`name:${from}->${to}`)
    }
  }

  return learned.length ? [{ url: NAME_CORRECTIONS_URL, data, learned }] : []
}

function learnPlaceCorrections(beforeData, afterData) {
  const beforePlace = beforeData.address || splitCustomerParts(beforeData.customerName).place
  const afterPlace = afterData.address || splitCustomerParts(afterData.customerName).place
  if (!beforePlace || !afterPlace || normalizeNameKey(beforePlace) === normalizeNameKey(afterPlace)) return []

  const data = readJSON(PLACE_CORRECTIONS_URL, { preferredPlaces: [], ocrCorrections: {} })
  uniquePush(data.preferredPlaces, afterPlace)
  data.ocrCorrections[normalizeNameKey(beforePlace)] = afterPlace
  return [{ url: PLACE_CORRECTIONS_URL, data, learned: [`place:${beforePlace}->${afterPlace}`] }]
}

function cleanedLearnedItem(item) {
  return {
    category: item.category ?? 'readymade-door',
    heightInches: item.heightInches ?? null,
    heightSoot: item.heightSoot ?? 0,
    widthInches: item.widthInches ?? null,
    widthSoot: item.widthSoot ?? 0,
    sizeLabel: item.sizeLabel ?? null,
    qty: item.qty ?? 1,
    amount: item.amount ?? null,
    guaranteeYears: item.guaranteeYears ?? 0,
  }
}

function itemChanged(beforeItem, afterItem) {
  return JSON.stringify(cleanedLearnedItem(beforeItem ?? {})) !== JSON.stringify(cleanedLearnedItem(afterItem ?? {})) ||
    normalizeProductKey(beforeItem?.brandName) !== normalizeProductKey(afterItem?.brandName)
}

function learnProductCorrections(beforeItems, afterItems) {
  const before = Array.isArray(beforeItems) ? beforeItems : []
  const after = Array.isArray(afterItems) ? afterItems : []
  const data = readJSON(PRODUCT_CORRECTIONS_URL, [])
  const learned = []

  for (let i = 0; i < after.length; i += 1) {
    const corrected = after[i]
    const original = before[i] ?? {}
    const correctedBrand = String(corrected?.brandName ?? '').trim()
    const originalBrand = String(original?.brandName ?? '').trim()
    if (!correctedBrand) continue
    if (originalBrand && !itemChanged(original, corrected)) continue

    const correctedKey = normalizeProductKey(correctedBrand)
    const originalKey = normalizeProductKey(originalBrand || correctedBrand)
    const brandChanged = normalizeProductKey(originalBrand) !== correctedKey
    if (originalBrand && !brandChanged) continue
    let entry = data.find(item => normalizeNameKey(item.canonicalBrandName) === normalizeNameKey(correctedBrand))

    if (!entry) {
      entry = {
        canonicalBrandName: correctedBrand,
        match: [correctedBrand],
        ...cleanedLearnedItem(corrected),
      }
      data.push(entry)
      learned.push(`product:new:${correctedBrand}`)
    } else {
      Object.assign(entry, cleanedLearnedItem(corrected))
    }

    entry.match = Array.isArray(entry.match) ? entry.match : []
    for (const match of [originalBrand, correctedBrand, originalKey, correctedKey]) {
      if (!match) continue
      if (!entry.match.some(existing => normalizeProductKey(existing) === normalizeProductKey(match))) {
        entry.match.push(match)
        learned.push(`product:match:${match}->${correctedBrand}`)
      }
    }
  }

  return learned.length ? [{ url: PRODUCT_CORRECTIONS_URL, data, learned }] : []
}

async function learnFromScan(beforeData, afterData) {
  const pending = [
    ...learnNameCorrections(beforeData.customerName, afterData.customerName),
    ...learnPlaceCorrections(beforeData, afterData),
    ...learnProductCorrections(beforeData.items, afterData.items),
  ]

  const learned = []
  for (const update of pending) {
    await writeJSON(update.url, update.data)
    learned.push(...update.learned)
  }

  if (learned.length) {
    await appendFile(SCAN_FEEDBACK_URL, `${JSON.stringify({ at: new Date().toISOString(), learned, before: beforeData, after: afterData })}\n`)
    NAME_DATA = loadNameData()
    PLACE_DATA = loadPlaceData()
    PRODUCT_CORRECTIONS = loadProductCorrections()
  }

  return learned
}

// ── Claude Sonnet: image → JSON directly ─────────────────────────────────────
async function scanWithClaude(image, mediaType) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const t0 = Date.now()
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: JSON_MAX_TOKENS,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
        { type: 'text', text: EXTRACT_PROMPT },
      ],
    }],
  })
  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  return { data: normalizeScanData(parseJSON(text)), ms: Date.now() - t0, provider: 'claude' }
}

// ── List installed printers ──────────────────────────────────────────────────
async function listInstalledPrinters() {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-Command',
      'Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress',
    ], { windowsHide: true })
    const parsed = JSON.parse(stdout.trim())
    return Array.isArray(parsed) ? parsed : [parsed]
  }
  // macOS / Linux: lpstat -a
  const { stdout } = await execFileAsync('lpstat', ['-a']).catch(() => ({ stdout: '' }))
  return stdout.trim().split('\n').map(l => l.split(' ')[0]).filter(Boolean)
}

// ── Live printer queue (jobs + printer state/alerts) ─────────────────────────
async function getCupsPrintQueue() {
  const printers = new Map() // name -> { name, state, alert, jobs: [] }

  // Printer states + alerts (e.g. "Alerts: media-jam-error")
  const { stdout: pOut } = await execFileAsync('lpstat', ['-l', '-p']).catch(() => ({ stdout: '' }))
  let current = null
  for (const line of pOut.split('\n')) {
    const m = line.match(/^printer (\S+) (is idle|now printing|disabled|is stopped)/)
    if (m) {
      const state = m[2].includes('printing') ? 'printing' : /disabled|stopped/.test(m[2]) ? 'stopped' : 'idle'
      current = { name: m[1], state, alert: null, jobs: [] }
      printers.set(m[1], current)
      continue
    }
    const a = line.match(/Alerts:\s*(.+)$/)
    if (a && current) {
      const alert = a[1].trim()
      current.alert = alert && alert !== 'none' ? alert : null
    }
  }

  // Active jobs: "PrinterName-503  user  94208  Fri Jun 19 16:27:08 2026"
  const { stdout: jOut } = await execFileAsync('lpstat', ['-o']).catch(() => ({ stdout: '' }))
  const jobs = []
  for (const raw of jOut.split('\n')) {
    const line = raw.trim()
    const m = line.match(/^(\S+)-(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/)
    if (!m) continue
    const [, printer, num, user, size, when] = m
    const job = { id: `${printer}-${num}`, number: Number(num), printer, user, sizeKb: Math.round(Number(size) / 1024), when: when.trim() }
    jobs.push(job)
    printers.get(printer)?.jobs.push(job)
  }

  return { platform: process.platform, printers: [...printers.values()], jobs }
}

async function getWindowsPrintQueue() {
  const script = `
$out = @()
Get-Printer | ForEach-Object {
  $p = $_
  $jobs = @(Get-PrintJob -PrinterName $p.Name -ErrorAction SilentlyContinue | ForEach-Object {
    [pscustomobject]@{ id = "$($p.Name)-$($_.Id)"; number = $_.Id; printer = $p.Name; user = $_.UserName; sizeKb = [math]::Round($_.Size/1024); status = "$($_.JobStatus)"; when = "$($_.SubmittedTime)" }
  })
  $alert = if ("$($p.PrinterStatus)" -match 'Error|Jam|Offline|PaperOut') { "$($p.PrinterStatus)" } else { $null }
  $out += [pscustomobject]@{ name = $p.Name; state = "$($p.PrinterStatus)"; alert = $alert; jobs = $jobs }
}
ConvertTo-Json @($out) -Depth 6 -Compress
`
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true })
  const parsed = JSON.parse((stdout || '').trim() || '[]')
  const printers = Array.isArray(parsed) ? parsed : [parsed]
  const jobs = printers.flatMap((p) => p.jobs ?? [])
  return { platform: 'win32', printers, jobs }
}

async function getPrintQueue() {
  return process.platform === 'win32' ? await getWindowsPrintQueue() : await getCupsPrintQueue()
}

app.get('/queue', async (_req, res) => {
  try {
    const queue = await getPrintQueue()
    res.json({ ok: true, ...queue })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) })
  }
})

app.post('/queue/cancel', async (req, res) => {
  try {
    if (process.platform === 'win32') {
      const printer = String(req.body?.printer ?? '').trim()
      const number = Number(req.body?.number)
      if (!printer || !Number.isFinite(number)) throw new Error('printer and number are required')
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', `Remove-PrintJob -PrinterName '${printer.replace(/'/g, "''")}' -ID ${number}`], { windowsHide: true })
    } else {
      const jobId = String(req.body?.jobId ?? '').trim()
      if (!jobId) throw new Error('jobId is required')
      await execFileAsync('cancel', [jobId])
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) })
  }
})

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/status', (req, res) => res.json({
  ok: true,
  server: 'Shiv Print Server',
  printer: PRINT_PRINTER,
  printers: {
    color: COLOR_PRINTER,
    quotation: COLOR_PRINTER,
    blackAndWhite: BW_PRINTER,
    blackAndWhiteFallback: BW_FALLBACK_PRINTER,
    blackAndWhiteFallbackOnError: BW_FALLBACK_ON_ERROR,
  },
  guaranteeQrBase: GUARANTEE_PUBLIC_URL || null,
  guaranteeQrSample: guaranteeCardUrl('GC-YYYY-XXXX', req),
}))

// GET /sync  — SSE stream; clients reconnect automatically on disconnect
app.get('/sync', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // prevent nginx buffering
  res.flushHeaders()

  // Immediately send the current state so the client can sync on connect
  const bills   = loadBillsJson()
  const catalog = loadCatalog()
  res.write(`event: connected\ndata: ${JSON.stringify({
    billCount:   bills?.length ?? 0,
    catalogSavedAt: catalog?._savedAt ?? null,
  })}\n\n`)

  _sseClients.add(res)

  // Heartbeat every 25s keeps the connection alive through NAT/proxies
  const heartbeat = setInterval(() => {
    try { res.write(`:heartbeat\n\n`) }
    catch { clearInterval(heartbeat); _sseClients.delete(res) }
  }, 25_000)

  req.on('close', () => { clearInterval(heartbeat); _sseClients.delete(res) })
})

app.get('/printers', async (_req, res) => {
  try {
    const list = await listInstalledPrinters()
    res.json({ ok: true, printers: list, default: PRINT_PRINTER })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

app.get('/scan-bill', (_req, res) => res.json({ ok: true, message: 'Use POST with { image, mediaType }. Scanner uses Claude only.' }))

// ── Scan Bill ─────────────────────────────────────────────────────────────────
app.post('/scan-bill', async (req, res) => {
  const { image, mediaType = 'image/jpeg' } = req.body
  if (!image) return res.status(400).json({ error: 'Missing image (base64)' })

  try {
    const result = await scanWithClaude(image, mediaType)
    console.log(`[scan-bill:claude] ${result.ms}ms`, JSON.stringify(result.data, null, 2))
    res.json({ ok: true, data: result.data, ms: result.ms })
  } catch (err) {
    console.error('[scan-bill error]', err)
    res.status(500).json({ error: String(err) })
  }
})

app.post('/scan-bill/learn', async (req, res) => {
  const { before, after } = req.body
  if (!before || !after) return res.status(400).json({ error: 'Missing before/after scan data' })

  try {
    const learned = await learnFromScan(before, after)
    const normalizedAfter = normalizeScanData(after)
    res.json({ ok: true, learned, data: normalizedAfter })
  } catch (err) {
    console.error('[scan-bill learn error]', err)
    res.status(500).json({ error: String(err) })
  }
})

// -- WhatsApp Upload Print ----------------------------------------------------
app.get('/whatsapp-print', (req, res) => {
  res.type('html').send(buildWhatsAppPrintPage(publicUrlFromRequest(req)))
})

app.get('/whatsapp-print/share', (req, res) => {
  const message = `Open this Shiv Hardware print link to send PDFs and images to the shop printer: ${publicUrlFromRequest(req)}/whatsapp-print`
  res.redirect(`https://wa.me/?text=${encodeURIComponent(message)}`)
})

app.get('/whatsapp-print/status', (req, res) => {
  res.json({
    ok: true,
    printer: PRINT_PRINTER,
    printers: {
      color: COLOR_PRINTER,
      blackAndWhite: BW_PRINTER,
      blackAndWhiteFallback: BW_FALLBACK_PRINTER,
      blackAndWhiteFallbackOnError: BW_FALLBACK_ON_ERROR,
    },
    link: `${publicUrlFromRequest(req)}/whatsapp-print`,
    allowedMediaTypes: [...WHATSAPP_ALLOWED_MEDIA_TYPES],
    maxFiles: WHATSAPP_MAX_FILES,
    maxFileMb: Math.round(WHATSAPP_MAX_FILE_BYTES / 1024 / 1024),
  })
})

function whatsappWebStatusPayload() {
  return {
    ok: true,
    ...whatsappWebState,
    printers: {
      color: COLOR_PRINTER,
      blackAndWhite: BW_PRINTER,
      blackAndWhiteFallback: BW_FALLBACK_PRINTER,
      blackAndWhiteFallbackOnError: BW_FALLBACK_ON_ERROR,
    },
    allowedMediaTypes: [...WHATSAPP_AUTO_PRINT_MEDIA_TYPES],
    authDirectory: WHATSAPP_WEB_AUTH_DIR,
  }
}

app.get('/drop-print/status', (_req, res) => {
  res.json({
    ok: true,
    enabled: DROP_PRINT_ENABLED,
    folder: DROP_PRINT_DIR,
    waiting: [...dropPrintWaiting.values()],
    recent: dropPrintRecent,
  })
})

app.get('/whatsapp-web/status', (_req, res) => {
  res.json(whatsappWebStatusPayload())
})

// Force a fresh login: clears the stored session and reconnects so a new QR is
// generated (use when the account is stuck reconnecting or you want to re-link).
app.post('/whatsapp-web/relogin', async (_req, res) => {
  try {
    await whatsappRelogin()
    res.json({ ok: true, status: whatsappWebState.status })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) })
  }
})

// Link by phone-number pairing code (more reliable than scanning the QR).
// POST { phone: "918092850954" } → returns an 8-char code to type into WhatsApp:
// Linked devices → Link a device → "Link with phone number instead".
app.post('/whatsapp-web/pair-code', async (req, res) => {
  const phone = String(req.body?.phone ?? req.query?.phone ?? '').replace(/\D/g, '')
  if (phone.length < 11) {
    return res.status(400).json({ ok: false, error: 'Send the WhatsApp number WITH country code, e.g. 918092850954' })
  }
  const sock = whatsappConnectingSock
  if (!sock) {
    return res.status(503).json({ ok: false, error: 'WhatsApp is not connecting yet — try again in a few seconds.' })
  }
  if (sock.authState?.creds?.registered) {
    return res.status(400).json({ ok: false, error: 'This account is already linked.' })
  }
  try {
    const code = await sock.requestPairingCode(phone)
    const pretty = code?.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
    console.log(`[whatsapp-web] pairing code for ${phone}: ${pretty}`)
    res.json({ ok: true, code: pretty })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) })
  }
})

// Send the guarantee-ready message to a customer's mobile on demand. Backs the
// "Generate" button in the guarantee builder (saving happens on the client).
app.post('/whatsapp-notify-customer', async (req, res) => {
  const mobile = String(req.body?.mobile ?? '').trim()
  const name = String(req.body?.name ?? '').trim()
  try {
    const result = await sendGuaranteeWhatsAppTo(mobile, name)
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err?.message ?? err) })
  }
})

// Same send path, kept for quick manual testing (GET or POST with ?mobile=&name=).
app.all('/whatsapp-web/test-notify', async (req, res) => {
  const mobile = String(req.body?.mobile ?? req.query?.mobile ?? '').trim()
  const name = String(req.body?.name ?? req.query?.name ?? '').trim()
  try {
    const result = await sendGuaranteeWhatsAppTo(mobile, name)
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err?.message ?? err) })
  }
})

app.get('/whatsapp-web/group/latest', (_req, res) => {
  const groups = [...whatsappGroupNameCache.entries()]
    .filter(([jid]) => chatMatchesWhatsAppAutoPrintTarget(jid, whatsappGroupNameCache.get(jid) || ''))
    .map(([jid, name]) => ({ jid, name }))
  res.json({
    ok: true,
    status: whatsappWebState.status,
    lastPrint: whatsappWebState.lastPrint,
    lastMessageAt: whatsappWebState.lastMessageAt,
    groups,
  })
})

app.get('/whatsapp-web', (_req, res) => {
  const status = whatsappWebStatusPayload()
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="8" />
  <title>Shiv WhatsApp Web Auto Print</title>
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center; font-family:Inter,Segoe UI,Arial,sans-serif; background:#f6f7f9; color:#111827; }
    main { width:min(92vw,520px); background:white; border:1px solid #e5e7eb; border-radius:8px; padding:24px; box-shadow:0 14px 40px rgba(15,23,42,.08); }
    h1 { margin:0 0 8px; font-size:22px; }
    dl { display:grid; grid-template-columns:140px 1fr; gap:8px 12px; margin:18px 0; }
    dt { color:#6b7280; }
    dd { margin:0; overflow-wrap:anywhere; }
    img { width:min(320px,100%); display:block; margin:18px auto 4px; image-rendering:pixelated; }
    pre { white-space:pre-wrap; background:#f3f4f6; border-radius:6px; padding:10px; overflow:auto; }
  </style>
</head>
<body>
  <main>
    <h1>WhatsApp Web Auto Print</h1>
    <dl>
      <dt>Status</dt><dd>${escapeHtml(status.status)}</dd>
      <dt>Group</dt><dd>${escapeHtml(status.groupName || status.groupId || 'not configured')}</dd>
      <dt>Copies</dt><dd>${escapeHtml(String(status.copies))}</dd>
      <dt>Last message</dt><dd>${escapeHtml(status.lastMessageAt || '-')}</dd>
      <dt>Last print</dt><dd>${escapeHtml(status.lastPrint ? `${status.lastPrint.name} -> ${status.lastPrint.printer}` : '-')}</dd>
    </dl>
    ${status.qrDataUrl ? `<img src="${status.qrDataUrl}" alt="WhatsApp QR code" /><p>Scan this QR from WhatsApp linked devices.</p>` : ''}
    ${status.lastError ? `<pre>${escapeHtml(JSON.stringify(status.lastError, null, 2))}</pre>` : ''}
  </main>
</body>
</html>`)
})

app.post('/whatsapp-print/jobs', async (req, res) => {
  const copies = sanitizeCopies(req.body?.copies)
  const rawFiles = Array.isArray(req.body?.files) ? req.body.files : []
  if (!rawFiles.length) return res.status(400).json({ error: 'Missing files' })
  if (rawFiles.length > WHATSAPP_MAX_FILES) return res.status(400).json({ error: `Maximum ${WHATSAPP_MAX_FILES} files allowed` })

  try {
    const files = rawFiles.map(decodeUploadedFile)
    const jobs = []
    for (const file of files) {
      jobs.push(await printUploadedFile(file, copies))
    }

    res.json({
      ok: true,
      printer: jobs[0]?.printer ?? PRINT_PRINTER,
      printers: {
        color: COLOR_PRINTER,
        blackAndWhite: BW_PRINTER,
        blackAndWhiteFallback: BW_FALLBACK_PRINTER,
        blackAndWhiteFallbackOnError: BW_FALLBACK_ON_ERROR,
      },
      copies,
      jobs,
    })
  } catch (err) {
    console.error('[whatsapp-print error]', err)
    res.status(500).json({ error: String(err.message ?? err) })
  }
})

// ── Print ─────────────────────────────────────────────────────────────────────
app.post('/print', async (req, res) => {
  const { kind, quote, document, bill, layout = 'a4', printer: printerOverride, slot, documents } = req.body
  const copies = sanitizeCopies(req.body.copies)
  if (kind === 'guarantee' && !document && !(Array.isArray(documents) && documents.length)) {
    return res.status(400).json({ error: 'Missing guarantee document data' })
  }
  if (kind === 'bill' && !bill) return res.status(400).json({ error: 'Missing bill data' })
  if (kind !== 'guarantee' && kind !== 'bill' && !quote) return res.status(400).json({ error: 'Missing quotation data' })

  try {
    // Attach the online-card QR URL so the printed guarantee carries a scannable QR.
    const printDocument = kind === 'guarantee' ? withGuaranteeQr(document, req) : document
    const printDocuments = kind === 'guarantee' && Array.isArray(documents)
      ? documents.map((d) => withGuaranteeQr(d, req))
      : documents
    const printResult = await printDocumentPayload({ kind, quote, document: printDocument, bill, layout, printerOverride, slot, documents: printDocuments }, copies)
    if (kind === 'bill' && bill) await saveBillToStore(bill)
    if (kind === 'guarantee') {
      // Fire-and-forget: message each card's customer that it's ready to collect.
      // Deduped by card number, so the A4 + PVC-card passes never double-send.
      const cards = [document, ...(Array.isArray(documents) ? documents : [])].filter(Boolean)
      for (const card of cards) {
        notifyCustomerGuaranteeReady(card).catch(err =>
          console.error('[whatsapp-notify] unhandled', err?.message ?? err))
      }
    }
    res.json({
      ok: true,
      printer: printResult.printer,
      fallback: printResult.fallback,
      jobId: printResult.jobId,
    })
  } catch (err) {
    console.error('[print error]', err)
    res.status(500).json({ error: String(err) })
  }
})

// ── Bills store ──────────────────────────────────────────────────────────────
// GET /bills                  -> all stored bills (newest first)
// GET /bills/:id              -> single bill by id
app.get('/bills', (_req, res) => {
  const bills = loadBillsFromStore().reverse()
  res.json({ ok: true, bills })
})

app.get('/bills/:id', (req, res) => {
  const bills = loadBillsFromStore()
  const bill = bills.find(b => b.id === req.params.id)
  if (!bill) return res.status(404).json({ ok: false, error: 'Bill not found' })
  res.json({ ok: true, bill })
})

// ── Catalog store ─────────────────────────────────────────────────────────────
// Stores hardwareCatalog + customCatalog + sets so the app survives a clear.
// GET  /catalog            -> { ok, catalog }
// POST /catalog            -> save full catalog snapshot
app.get('/catalog', (_req, res) => {
  const catalog = loadCatalog()
  if (!catalog) return res.json({ ok: true, catalog: null })
  res.json({ ok: true, catalog })
})

app.post('/catalog', async (req, res) => {
  const { hardwareCatalog, customCatalog, sets } = req.body ?? {}
  if (!hardwareCatalog && !customCatalog && !sets) {
    return res.status(400).json({ ok: false, error: 'Nothing to save' })
  }
  await saveCatalog({ hardwareCatalog, customCatalog, sets })
  res.json({ ok: true })
})

// ── Bills snapshot (full backup of all bills including drafts) ────────────────
// Separate from bills.jsonl which is an append-only print audit log.
// GET  /bills-store           -> { ok, bills: [...] }
// POST /bills-store           -> save full bills array
app.get('/bills-store', (_req, res) => {
  const bills = loadBillsJson()
  res.json({ ok: true, bills: bills ?? [] })
})

app.post('/bills-store', async (req, res) => {
  const { bills } = req.body ?? {}
  if (!Array.isArray(bills)) {
    return res.status(400).json({ ok: false, error: 'Missing bills array' })
  }
  await saveBillsJson(bills)
  res.json({ ok: true, count: bills.length })
})

// ── Guarantees snapshot ──────────────────────────────────────────────────────
// GET  /guarantees-store               -> { ok, guarantees: [...] }
// GET  /guarantees-store/:id           -> single guarantee card by id
// POST /guarantees-store               -> save full guarantees array
app.get('/guarantees-store', (_req, res) => {
  const guarantees = loadGuaranteesJson()
  res.json({ ok: true, guarantees: guarantees ?? [] })
})

app.get('/guarantees-store/:id', (req, res) => {
  const guarantees = loadGuaranteesJson() ?? []
  const card = guarantees.find((g) => g.id === req.params.id)
  if (!card) return res.status(404).json({ ok: false, error: 'Guarantee card not found' })
  res.json({ ok: true, guarantee: card })
})

app.post('/guarantees-store', async (req, res) => {
  const { guarantees } = req.body ?? {}
  if (!Array.isArray(guarantees)) {
    return res.status(400).json({ ok: false, error: 'Missing guarantees array' })
  }
  await saveGuaranteesJson(guarantees)
  res.json({ ok: true, count: guarantees.length })
})

// ── Public guarantee viewer (the QR target) ──────────────────────────────────
// GET  /guarantee/:number       -> mobile-friendly HTML view of the saved card
// GET  /guarantee/:number/pdf   -> PDF rendition of the same A4 card
// GET  /g/:number, /g/:number/pdf -> same as above, matching the Vercel
//   viewer's path. The QR keeps working on the shop LAN when no public
//   viewer is configured.
app.get('/guarantee/:number', (req, res) => {
  const card = findGuaranteeByNumber(req.params.number)
  if (!card) return res.status(404).type('html').send(
    '<!doctype html><p style="font-family:sans-serif;padding:24px">Guarantee card not found. ' +
    'It may have been printed from a different shop computer — ask at the counter.</p>'
  )
  res.type('html').send(buildMobileGuaranteePageHtml(card))
})

app.get('/guarantee/:number/pdf', async (req, res) => {
  const card = findGuaranteeByNumber(req.params.number)
  if (!card) return res.status(404).json({ ok: false, error: 'Guarantee card not found' })

  let page
  try {
    const html = await buildGuaranteeHtml(withGuaranteeQr(card, req), 'a4')
    page = await getSharedPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="guarantee-${card.number}.pdf"`)
    res.end(pdf)
  } catch (err) {
    console.error('[guarantee pdf error]', err)
    res.status(500).json({ error: String(err?.message ?? err) })
  } finally {
    await page?.close().catch(() => {})
  }
})

// Same handlers under the path the Vercel viewer uses, so the QR
// (which encodes `${PRINT_SERVER_URL}/g/<number>` by default) still
// resolves locally before the public URL is configured.
app.get('/g/:number', (req, res) => {
  const card = findGuaranteeByNumber(req.params.number)
  if (!card) return res.status(404).type('html').send(
    '<!doctype html><p style="font-family:sans-serif;padding:24px">Guarantee card not found. ' +
    'It may have been printed from a different shop computer — ask at the counter.</p>'
  )
  res.type('html').send(buildMobileGuaranteePageHtml(card))
})

// ── Render PNG ───────────────────────────────────────────────────────────────
app.post('/render-png', async (req, res) => {
  const { kind, quote, document, layout = 'a4' } = req.body
  const scale = Math.min(3, Math.max(1, Number(req.body.scale) || 2))
  if (kind === 'guarantee' && !document) return res.status(400).json({ error: 'Missing guarantee document data' })
  if (kind !== 'guarantee' && !quote) return res.status(400).json({ error: 'Missing quotation data' })

  let page
  try {
    const html = kind === 'guarantee'
      ? await buildGuaranteeHtml(withGuaranteeQr(document, req), layout)
      : await buildQuotationHtml(quote)
    page = await getSharedPage()
    const width = Math.round((210 / 25.4) * 96)
    const height = Math.round((297 / 25.4) * 96)
    await page.setViewport({ width, height, deviceScaleFactor: scale })
    await page.setContent(html, { waitUntil: 'networkidle0' })
    await page.emulateMediaType('print')
    const target = await page.$('.page')
    const box = target ? await target.boundingBox() : null
    if (!box) throw new Error('Failed to measure A4 page for PNG render')
    const png = await page.screenshot({ type: 'png', clip: box })
    res.json({ ok: true, image: png.toString('base64'), mime: 'image/png' })
  } catch (err) {
    console.error('[render-png error]', err)
    res.status(500).json({ error: String(err) })
  } finally {
    await page?.close().catch(() => {})
  }
})

// ── Live Delivery Tracking ──────────────────────────────────────────────────
// deliveries: Map<id, { driverName, lat, lng, startedAt, updatedAt, clients }>
const deliveries = new Map()

app.post('/delivery/start', (req, res) => {
  const id = Math.random().toString(36).slice(2, 10)
  deliveries.set(id, {
    id,
    driverName: String(req.body?.driverName ?? 'Driver'),
    lat: null, lng: null,
    startedAt: Date.now(), updatedAt: null,
    clients: new Set(),
  })
  res.json({ ok: true, id })
})

app.get('/delivery/:id', (req, res) => {
  const d = deliveries.get(req.params.id)
  if (!d) return res.status(404).json({ ok: false, error: 'not found' })
  const { id, driverName, lat, lng, startedAt, updatedAt } = d
  res.json({ ok: true, id, driverName, lat, lng, startedAt, updatedAt })
})

app.post('/delivery/:id/location', (req, res) => {
  const d = deliveries.get(req.params.id)
  if (!d) return res.status(404).json({ ok: false })
  d.lat = req.body?.lat; d.lng = req.body?.lng; d.updatedAt = Date.now()
  const msg = `data: ${JSON.stringify({ lat: d.lat, lng: d.lng, updatedAt: d.updatedAt })}\n\n`
  for (const c of d.clients) try { c.write(msg) } catch {}
  res.json({ ok: true })
})

app.get('/delivery/:id/stream', (req, res) => {
  const d = deliveries.get(req.params.id)
  if (!d) return res.status(404).json({ ok: false })
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  if (d.lat !== null) res.write(`data: ${JSON.stringify({ lat: d.lat, lng: d.lng, updatedAt: d.updatedAt })}\n\n`)
  d.clients.add(res)
  req.on('close', () => d.clients.delete(res))
})

app.post('/delivery/:id/stop', (req, res) => {
  const d = deliveries.get(req.params.id)
  if (!d) return res.status(404).json({ ok: false })
  const msg = `data: ${JSON.stringify({ stopped: true })}\n\n`
  for (const c of d.clients) try { c.write(msg); c.end() } catch {}
  deliveries.delete(req.params.id)
  res.json({ ok: true })
})

// Customer-facing tracking page (no app needed — works on any phone)
app.get('/track/:id', (req, res) => {
  const serverBase = PRINT_SERVER_PUBLIC_URL || `http://localhost:${PORT}`
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!doctype html><html><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Live Tracking — Shiv Hardware</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:system-ui,sans-serif;background:#f5f4f0;display:flex;flex-direction:column;height:100dvh}
    #topbar{background:#fff;border-bottom:1px solid #e5e7eb;padding:12px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0}
    #topbar img{width:36px;height:36px;border-radius:8px;object-fit:contain}
    #info{flex:1;min-width:0}
    #driver-name{font-size:14px;font-weight:700;color:#1c1917}
    .ic { width:1.1em; height:1.1em; vertical-align:-0.18em; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round }
    #status{font-size:12px;color:#78716c;margin-top:1px}
    #map{flex:1}
    #stopped-banner{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;align-items:center;justify-content:center}
    #stopped-banner div{background:#fff;border-radius:16px;padding:24px 28px;text-align:center;max-width:280px}
    #stopped-banner h2{font-size:18px;font-weight:700;margin-bottom:8px}
    #stopped-banner p{font-size:14px;color:#78716c}
  </style>
</head><body>
  <div id="topbar">
    <div id="info">
      <div id="driver-name">Loading…</div>
      <div id="status">Waiting for location…</div>
    </div>
  </div>
  <div id="map"></div>
  <div id="stopped-banner">
    <div>
      <h2>Delivery Complete</h2>
      <p>The driver has ended this delivery session.</p>
    </div>
  </div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const deliveryId = ${JSON.stringify(req.params.id)}
    const serverBase = ${JSON.stringify(serverBase)}

    // Init map
    const map = L.map('map', { zoomControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19
    }).addTo(map)

    const icon = L.divIcon({
      className: '',
      html: '<div style="width:40px;height:40px;border-radius:50%;background:#b9924b;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center"><svg width=20 height=20 viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></div>',
      iconSize: [40, 40], iconAnchor: [20, 20],
    })

    let marker = null
    let firstFix = true

    function updateLocation(lat, lng) {
      const ll = [lat, lng]
      if (!marker) { marker = L.marker(ll, { icon }).addTo(map) } else { marker.setLatLng(ll) }
      if (firstFix) { map.setView(ll, 16); firstFix = false } else { map.panTo(ll) }
      document.getElementById('status').textContent = 'Live · updated ' + new Date().toLocaleTimeString()
    }

    // Fetch driver info
    fetch(serverBase + '/delivery/' + deliveryId)
      .then(r => r.json()).then(d => {
        if (d.ok) {
          const driver = document.getElementById('driver-name')
          driver.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62L18.3 8.38A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg> '
          driver.append(d.driverName)
          if (d.lat) updateLocation(d.lat, d.lng)
        }
      }).catch(() => {})

    // SSE stream
    const es = new EventSource(serverBase + '/delivery/' + deliveryId + '/stream')
    es.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (data.stopped) {
        document.getElementById('stopped-banner').style.display = 'flex'
        es.close(); return
      }
      updateLocation(data.lat, data.lng)
    }
    es.onerror = () => { document.getElementById('status').textContent = 'Reconnecting…' }
  </script>
</body></html>`)
})

// Bill photo → guarantee cards, from a phone on the shop Wi-Fi (/cards).
registerCardScan(app)

app.listen(PORT, '0.0.0.0', () => {
  const networkUrls = localNetworkUrls(PORT)
  console.log(`\nShiv Print Server running`)
  console.log(`   Local:   http://localhost:${PORT}`)
  for (const url of networkUrls) console.log(`   Phone:   ${url}`)
  if (PRINT_SERVER_PUBLIC_URL) console.log(`   Public override: ${PRINT_SERVER_PUBLIC_URL}`)
  for (const url of networkUrls) console.log(`   WhatsApp print: ${url}/whatsapp-print`)
  console.log(`   Default printer: ${PRINT_PRINTER}`)
  console.log(`   Color/ID printer: ${COLOR_PRINTER}`)
  console.log(`   B/W laser printer: ${BW_PRINTER}`)
  console.log(`   Browser: ${CHROME_PATH ?? 'Puppeteer managed Chrome'}`)
  if (CLOUD_API_URL) {
    console.log(`   Cloud API: ${CLOUD_API_URL}`)
    console.log(`   Cloud printer agent: ${PRINTER_AGENT_ID}`)
    setInterval(pollCloudPrintJobs, CLOUD_POLL_INTERVAL_MS)
    pollCloudPrintJobs()
    setInterval(sendCloudHeartbeat, CLOUD_HEARTBEAT_INTERVAL_MS)
    sendCloudHeartbeat()
  } else {
    console.log('   Cloud polling: disabled')
  }
  startWhatsAppWebAutoPrint()
  // Watchdog: keep the linked WhatsApp session alive indefinitely. If it stays
  // stuck (not ready/qr/starting) for over 8 minutes, reconnect using the SAVED
  // session — no re-link. Skips 'logged_out' (that path already re-shows a QR).
  setInterval(() => {
    if (!WHATSAPP_AUTO_PRINT_ENABLED) return
    const st = whatsappWebState.status
    if (st === 'ready' || st === 'qr' || st === 'starting') { whatsappLastHealthy = Date.now(); return }
    if (st === 'logged_out') return
    if (Date.now() - whatsappLastHealthy > 8 * 60 * 1000) {
      whatsappLastHealthy = Date.now()
      console.log(`[whatsapp-web] watchdog: stuck at "${st}" — reconnecting with saved session`)
      whatsappReconnect().catch(err => console.error('[whatsapp-web] watchdog reconnect failed', err?.message ?? err))
    }
  }, 2 * 60 * 1000)
  prepareEpsonPlainA4ColorDefaults(COLOR_PRINTER, 'startup')
  warmUpBrowser()
  startDropPrintFolder()
  if (!process.env.ANTHROPIC_API_KEY) console.warn('Warning: ANTHROPIC_API_KEY not set')
  console.log()
})
