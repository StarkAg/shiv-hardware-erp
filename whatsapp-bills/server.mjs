/**
 * Shiv WhatsApp Bills: each sale bill to the customer's own chat, from the
 * shop owner's own WhatsApp (Railway service `whatsapp-bills`).
 *
 * The shop has always kept its bills on WhatsApp, each in the party's chat on
 * the owner's phone. This service is linked to that WhatsApp as one of its
 * linked devices (the QR on /login, scanned from the phone: WhatsApp,
 * Linked devices, Link a device), so what it sends shows in the owner's own
 * chats as sent by him. The shop PC's WhatsApp, a second number, keeps its
 * own work (auto-print, guarantee messages) and sends no bills.
 *
 * The books say what is due and keep what was sent (convex/billWhatsApp.ts):
 * final sales saved after the sending was switched on, to a customer with a
 * mobile, each once. Gently, because WhatsApp blocks numbers that send like a
 * machine: one bill at a time, a minute or three apart, in the day only, at
 * most a day's worth, and each bill only once it has rested a while after its
 * last save, so one typed wrong can be put right or deleted before it goes.
 * The bill's own photos go as they are; a bill typed in the panel goes as a
 * picture of the printed bill, drawn here with the shop PC's own template.
 *
 * Environment (Railway variables):
 *   CONVEX_URL          the shop's deployment
 *   SHIV_DEVICE_TOKEN   this service's key: npx convex run --prod devices:issueServerKey '{"name":"whatsapp-bills"}'
 *   LOGIN_KEY           the secret in the /login link, so only the shop sees the QR
 *   AUTH_DIR            where the WhatsApp link is kept, on the service's volume (/data/auth)
 *   BILL_WHATSAPP_REST_MIN, BILL_WHATSAPP_DAILY_MAX, BILL_WHATSAPP_HOURS (10, 40, 9-21)
 */
import http from 'node:http'
import { rm } from 'node:fs/promises'

const PORT = Number(process.env.PORT || 8080)
const AUTH_DIR = process.env.AUTH_DIR || '/data/auth'
const LOGIN_KEY = process.env.LOGIN_KEY || ''
const REST_MS = Number(process.env.BILL_WHATSAPP_REST_MIN || 10) * 60_000
const DAILY_MAX = Number(process.env.BILL_WHATSAPP_DAILY_MAX || 40)
const HOURS = String(process.env.BILL_WHATSAPP_HOURS || '9-21').split('-').map(Number)
const GAP_MS = [60_000, 180_000]
const COUNTRY = '91'

const state = { status: 'starting', qr: null, readyAt: null, me: null, lastError: null, lastSent: null }
let sock = null

const log = (...a) => console.log(new Date().toISOString(), ...a)

/* ── the WhatsApp link ───────────────────────────────────────────────────── */
const silent = { level: 'silent', trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent } }
let relogin = async () => {}

async function startWhatsApp() {
  const { makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys')
  const qrcode = await import('qrcode')
  let auth = await useMultiFileAuthState(AUTH_DIR)
  let gen = 0
  let attempts = 0
  let version = null

  async function connect() {
    const mine = ++gen
    const s = makeWASocket({
      ...(version ? { version } : {}),
      auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, silent) },
      printQRInTerminal: false,
      logger: silent,
      browser: ['Shiv Hardware Bills', 'Chrome', '1.0'],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      // The owner's phone keeps its notifications: this device never shows as online.
      markOnlineOnConnect: false,
    })
    s.ev.on('creds.update', () => { if (mine === gen) auth.saveCreds() })
    s.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (mine !== gen) return
      if (qr) {
        state.status = 'qr'
        state.qr = await qrcode.toDataURL(qr, { margin: 1, width: 320 }).catch(() => null)
      }
      if (connection === 'open') {
        sock = s
        attempts = 0
        state.status = 'ready'
        state.qr = null
        state.readyAt = new Date().toISOString()
        state.me = s.user?.id?.split(':')[0]?.split('@')[0] ?? null
        state.lastError = null
        log('[whatsapp] linked and ready as', state.me)
      }
      if (connection === 'close') {
        if (sock === s) sock = null
        const code = lastDisconnect?.error?.output?.statusCode
        const message = String(lastDisconnect?.error?.message ?? '')
        const loggedOut = code === DisconnectReason.loggedOut
        state.status = loggedOut ? 'logged_out' : 'reconnecting'
        state.lastError = message ? { at: new Date().toISOString(), code, message } : null
        // An old client version is refused with 405: the current one is fetched.
        if (!version && (code === 405 || /connection failure/i.test(message))) {
          version = (await fetchLatestBaileysVersion().catch(() => null))?.version ?? null
        }
        log(`[whatsapp] closed code=${code}${loggedOut ? ', logged out: scan the QR again' : ', reconnecting'}`)
        if (loggedOut) {
          await rm(AUTH_DIR, { recursive: true, force: true }).catch(() => {})
          auth = await useMultiFileAuthState(AUTH_DIR)
        }
        attempts = loggedOut ? 0 : attempts + 1
        setTimeout(() => { if (mine === gen) void connect() }, loggedOut ? 1000 : Math.min(60_000, 10_000 * attempts))
      }
    })
  }

  relogin = async () => {
    gen++
    try { sock?.end?.(new Error('relogin')) } catch { /* gone */ }
    sock = null
    state.status = 'starting'
    state.qr = null
    await rm(AUTH_DIR, { recursive: true, force: true }).catch(() => {})
    auth = await useMultiFileAuthState(AUTH_DIR)
    void connect()
  }

  void connect()
}

/* ── the books ───────────────────────────────────────────────────────────── */
let convex = null
let anyApi = null
async function books() {
  if (convex) return convex
  if (!process.env.CONVEX_URL || !process.env.SHIV_DEVICE_TOKEN) return null
  const { ConvexClient } = await import('convex/browser')
  anyApi = (await import('convex/server')).anyApi
  convex = new ConvexClient(process.env.CONVEX_URL)
  convex.setAuth(async () => process.env.SHIV_DEVICE_TOKEN)
  return convex
}

/* ── a typed bill, drawn as it prints ────────────────────────────────────── */
let browser = null
async function billPicture(bill) {
  const { buildBillHtml } = await import('./print-server/template.mjs')
  if (!browser?.connected) {
    const puppeteer = await import('puppeteer-core')
    browser = await puppeteer.default.launch({
      executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    })
  }
  const page = await browser.newPage()
  try {
    await page.setViewport({ width: 559, height: 793, deviceScaleFactor: 2 })
    await page.setContent(buildBillHtml(bill), { waitUntil: 'networkidle0', timeout: 30_000 })
    return Buffer.from(await page.screenshot({ type: 'jpeg', quality: 88, fullPage: true }))
  } finally {
    await page.close().catch(() => {})
  }
}

/* ── sending ─────────────────────────────────────────────────────────────── */
/** A mobile as WhatsApp addresses it; null when it cannot be one. */
function jidOf(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '')
  // Two numbers written together ("8340785465 / 9000000000"): the first.
  if (digits.length === 20) digits = digits.slice(0, 10)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length === 10) digits = `${COUNTRY}${digits}`
  if (digits.length < 11 || digits.length > 15) return null
  return `${digits}@s.whatsapp.net`
}

function caption(item) {
  const day = new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const amount = item.amount != null ? ` · ₹${Math.round(item.amount).toLocaleString('en-IN')}` : ''
  return `${item.name}\nBill ${item.label} · ${day}${amount}\nShiv Hardware Store`
}

const indiaHour = () => new Date(Date.now() + 19_800_000).getUTCHours()
let busy = false
let nextAt = 0

async function sendDue() {
  if (busy || Date.now() < nextAt || !sock || state.status !== 'ready') return
  const [fromHour, toHour] = HOURS
  const hour = indiaHour()
  if (hour < fromHour || hour >= toHour) return
  const db = await books().catch(() => null)
  if (!db) return
  busy = true
  let item = null
  const record = (status, extra = {}) => db.mutation(anyApi.billWhatsApp.record, { voucherId: item.voucherId, status, ...extra })
  try {
    const due = await db.query(anyApi.billWhatsApp.due, { before: Date.now() - REST_MS, limit: 1 })
    if (!due?.on || !due.items?.length || due.sentToday >= DAILY_MAX) return
    item = due.items[0]
    const jid = jidOf(item.phone)
    if (!jid) { await record('skipped', { reason: `not a mobile number: ${item.phone}` }); return }
    try {
      const [check] = await sock.onWhatsApp(jid)
      if (check && check.exists === false) { await record('skipped', { to: jid, reason: 'not on WhatsApp' }); return }
    } catch { /* the check failed: send anyway */ }

    const media = []
    for (const photo of item.photos) {
      const res = await fetch(photo.url)
      if (!res.ok) throw new Error(`a photo could not be fetched (${res.status})`)
      const data = Buffer.from(await res.arrayBuffer())
      media.push(/pdf/i.test(photo.contentType ?? '')
        ? { document: data, mimetype: 'application/pdf', fileName: `${item.label}.pdf` }
        : { image: data })
    }
    if (!media.length && item.bill) media.push({ image: await billPicture(item.bill) })
    if (!media.length) { await record('skipped', { reason: 'nothing to send' }); return }

    for (const [i, m] of media.entries()) {
      await sock.sendMessage(jid, i === 0 ? { ...m, caption: caption(item) } : m)
      if (i < media.length - 1) await new Promise((resolve) => setTimeout(resolve, 2_000 + Math.random() * 2_000))
    }
    await record('sent', { to: jid })
    state.lastSent = { at: new Date().toISOString(), label: item.label, name: item.name }
    log(`[bills] sent ${item.label} to ${item.name}, ${media.length} ${media.length === 1 ? 'page' : 'pages'}`)
    nextAt = Date.now() + GAP_MS[0] + Math.random() * (GAP_MS[1] - GAP_MS[0])
  } catch (err) {
    log(`[bills] ${item?.label ?? 'check'} failed:`, err?.message ?? err)
    if (item) await record('failed', { reason: String(err?.message ?? err) }).catch(() => {})
    nextAt = Date.now() + 5 * 60_000
  } finally {
    busy = false
  }
}

/* ── the login page ──────────────────────────────────────────────────────── */
const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp Bills</title><meta http-equiv="refresh" content="5">
<style>body{margin:0;font:17px/1.4 system-ui,sans-serif;background:#fff;color:#111;display:flex;justify-content:center}
main{max-width:420px;padding:24px 16px;text-align:center}h1{font-size:22px;margin:0 0 8px}img{width:280px;max-width:100%;border:4px solid #111}
.ok{color:#137333;font-weight:700}.wait{background:#ffcc00;padding:6px 10px;display:inline-block}small{color:#555}
form{margin-top:28px}button{font:inherit;padding:10px 16px;border:2px solid #b3202a;color:#b3202a;background:#fff}</style></head><body><main>${body}</main></body></html>`

function loginPage(key) {
  const head = '<h1>WhatsApp Bills</h1>'
  if (state.status === 'ready') {
    return page(`${head}<p class="ok">Linked to +${state.me ?? ''}</p>
<p><small>Since ${state.readyAt ?? ''}${state.lastSent ? `<br>Last bill sent: ${state.lastSent.label}, ${state.lastSent.name}, ${state.lastSent.at}` : ''}</small></p>
<form method="post" action="/logout?key=${encodeURIComponent(key)}"><button>Unlink this WhatsApp</button></form>`)
  }
  if (state.status === 'qr' && state.qr) {
    return page(`${head}<p>On the shop owner's phone: WhatsApp, Settings, Linked devices, Link a device. Scan this.</p><img alt="QR to link WhatsApp" src="${state.qr}">`)
  }
  return page(`${head}<p class="wait">${state.status === 'logged_out' ? 'Unlinked. A new QR is coming.' : 'Connecting'}</p>`)
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const keyOk = LOGIN_KEY && url.searchParams.get('key') === LOGIN_KEY
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, status: state.status }))
    return
  }
  if (!keyOk) { res.writeHead(404); res.end(); return }
  if (url.pathname === '/login' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(loginPage(url.searchParams.get('key')))
    return
  }
  if (url.pathname === '/logout' && req.method === 'POST') {
    void relogin()
    res.writeHead(303, { location: `/login?key=${encodeURIComponent(LOGIN_KEY)}` })
    res.end()
    return
  }
  res.writeHead(404)
  res.end()
}).listen(PORT, () => log(`WhatsApp Bills on :${PORT}; ${HOURS.join('-')}h, at most ${DAILY_MAX} a day, after ${REST_MS / 60_000} min`))

if (!LOGIN_KEY) log('LOGIN_KEY is not set: the login page answers nobody')
void startWhatsApp().catch((err) => { state.status = 'error'; state.lastError = { message: String(err?.message ?? err) }; log('[whatsapp] could not start', err) })
setInterval(() => { void sendDue() }, 30_000)
