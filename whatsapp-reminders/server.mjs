/**
 * The Shop WhatsApp (79705 50954), on Railway (service `whatsapp-reminders`).
 * It used to live in the shop PC's print server, so every send needed the PC
 * on; WhatsApp printing was retired (2026-10-30) and the rest moved here:
 *
 *   POST /send-document     a file or photo into a customer's chat, or the
 *                           shop's group (Share to WhatsApp in the panel)
 *   POST /notify-guarantee  "your guarantee card is ready", once per card
 *   GET  /status            the link, with the QR while it needs a scan
 *   the auto-reply          a direct message gets the enquiry number, once an hour
 *
 * The POSTs and /status answer only with SEND_KEY in `x-shop-key`. The panel
 * never holds it: it calls Convex (convex/shopWhatsApp.ts), which calls here.
 * The print server holds it too, for the message it sends when a card prints.
 *
 * And the birthday reminders: on each classmate's birthday, one message to the
 * owner's own chat at midnight India time. See docs/whatsapp-numbers.md.
 *
 * The list is birthdays.json, copied from GradeX (src/data/havelocBirthdays.js).
 *
 * Nothing goes from any number but FROM_NUMBER: a link to another WhatsApp stays
 * idle and says so on /login. The day the link is first made is not sent, so
 * linking sends nothing by surprise. A link down over midnight sends as soon as
 * it is back, that same day; what was sent is kept on the volume, so nothing goes
 * twice.
 *
 * Environment (Railway variables):
 *   LOGIN_KEY    the secret in the /login link
 *   SEND_KEY     the secret Convex and the print server send in x-shop-key
 *   SHOP_GROUP_ID         the shop's own group, for sends addressed to 'group'
 *   GUARANTEE_MESSAGE     the card-ready text; {name} is the customer's first name
 *   AUTOREPLY_MESSAGE     the reply to a direct message
 *   FROM_NUMBER  the only number allowed to send (917970550954)
 *   TO_NUMBER    who is reminded (918709964141)
 *   DATA_DIR     the service's volume (/data)
 */
import http from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { birthdaysOn, indiaDate, sentKey } from './dates.mjs'

const PORT = Number(process.env.PORT || 8080)
const LOGIN_KEY = process.env.LOGIN_KEY || ''
const FROM_NUMBER = process.env.FROM_NUMBER || ''
const TO_NUMBER = process.env.TO_NUMBER || ''
const DATA_DIR = process.env.DATA_DIR || '/data'
const AUTH_DIR = join(DATA_DIR, 'auth')
const SENT_FILE = join(DATA_DIR, 'sent.json')
const CARDS_FILE = join(DATA_DIR, 'guarantees-notified.json')
const SEND_KEY = process.env.SEND_KEY || ''
const SHOP_GROUP_ID = process.env.SHOP_GROUP_ID || ''
const GUARANTEE_MESSAGE = (process.env.GUARANTEE_MESSAGE
  || 'Hi {name},\n\nThank you for purchasing with us. Your guarantee card is processed, please collect it from the shop.').replace(/\\n/g, '\n')
const AUTOREPLY_MESSAGE = (process.env.AUTOREPLY_MESSAGE
  || 'For any enquiries contact 8092850954 on WhatsApp.').replace(/\\n/g, '\n')
const AUTOREPLY_EVERY_MS = 60 * 60_000
const NOTIFY_COOLDOWN_MS = 10 * 60_000
const BIRTHDAYS = JSON.parse(await readFile(new URL('./birthdays.json', import.meta.url), 'utf8'))

const state = { status: 'starting', qr: null, me: null, lastSent: null, readyAt: null, lastError: null }
let sock = null
let busy = false

const log = (...a) => console.log(new Date().toISOString(), ...a)
const silent = { level: 'silent', trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent } }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ── what was sent ───────────────────────────────────────────────────────── */
async function loadSent() {
  try { return JSON.parse(await readFile(SENT_FILE, 'utf8')) } catch { return { firstLinked: null, keys: [] } }
}
const saveSent = (sent) => writeFile(SENT_FILE, JSON.stringify(sent))

/* ── the reminder ────────────────────────────────────────────────────────── */
// Emoji asked for by the owner (AGENTS.md), written as code points.
const message = (name) => `Happy Birthday ${name}! \u{1F389}\u{1F382}\u{1F973}\u{1F388}`

async function sendDue() {
  if (busy || !sock || state.status !== 'ready' || state.me !== FROM_NUMBER || !TO_NUMBER) return
  busy = true
  try {
    const today = indiaDate()
    const sent = await loadSent()
    const stamp = `${today.year}-${today.month}-${today.day}`
    if (!sent.firstLinked) {
      sent.firstLinked = stamp
      await saveSent(sent)
    }
    if (sent.firstLinked === stamp) return
    for (const row of birthdaysOn(BIRTHDAYS, today)) {
      const key = sentKey(today.year, row)
      if (sent.keys.includes(key)) continue
      await sock.sendMessage(`${TO_NUMBER}@s.whatsapp.net`, { text: message(row.name) })
      sent.keys.push(key)
      await saveSent(sent)
      state.lastSent = { at: new Date().toISOString(), name: row.name }
      log(`[reminders] sent ${row.name}`)
      await sleep(3_000 + Math.random() * 3_000)
    }
  } catch (err) {
    log('[reminders] failed:', err?.message ?? err)
  } finally {
    busy = false
  }
}

/* ── the shop's sends ─────────────────────────────────────────────────────── */
/** A mobile as typed on a bill or an account, as a WhatsApp chat id (India unless it says otherwise). */
function chatOf(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length === 10) digits = `91${digits}`
  if (digits.length < 11 || digits.length > 15) return null
  return `${digits}@s.whatsapp.net`
}

/** The link up and on the Shop number, waiting out a redial of a few seconds. */
async function linked() {
  for (let waited = 0; waited < 15_000 && ['starting', 'reconnecting'].includes(state.status); waited += 250) await sleep(250)
  if (!sock || state.status !== 'ready') throw new Error(`The Shop WhatsApp is not linked (status: ${state.status}).`)
  if (FROM_NUMBER && state.me !== FROM_NUMBER) throw new Error(`Linked to +${state.me}, not the Shop number.`)
}

async function onWhatsApp(jid, raw) {
  const [check] = await sock.onWhatsApp(jid).catch(() => [])
  if (check && check.exists === false) throw new Error(`${raw} is not on WhatsApp.`)
}

/** A file into a chat. A JPG or PNG goes as a photo, seen in the chat; anything else as a document. */
async function sendDocument({ mobile, data, fileName = 'file.pdf', mimetype = 'application/pdf', caption = '' }) {
  const buffer = Buffer.from(String(data ?? ''), 'base64')
  if (!buffer.length) throw new Error('Nothing to send.')
  await linked()
  let jid
  if (mobile === 'group') {
    if (!SHOP_GROUP_ID) throw new Error('No shop group is set (SHOP_GROUP_ID).')
    jid = SHOP_GROUP_ID
  } else {
    jid = chatOf(mobile)
    if (!jid) throw new Error(`Enter a valid mobile number (got "${mobile ?? ''}").`)
    await onWhatsApp(jid, mobile)
  }
  const content = /^image\/(jpeg|png)$/.test(mimetype)
    ? { image: buffer, mimetype }
    : { document: buffer, mimetype, fileName }
  await sock.sendMessage(jid, { ...content, ...(caption ? { caption } : {}) })
  log(`[send] ${fileName} (${buffer.length} bytes) to ${jid}`)
  return { jid }
}

/* The guarantee-ready message: once per card, and never twice to one chat inside ten minutes. */
const notifiedAt = new Map()
let cards = null
async function cardsSent() {
  if (!cards) {
    try { cards = new Set(JSON.parse(await readFile(CARDS_FILE, 'utf8'))) } catch { cards = new Set() }
  }
  return cards
}
const firstName = (raw) => {
  const first = String(raw ?? '').trim().split(/\s+/)[0] ?? ''
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : ''
}
function guaranteeText(raw) {
  const name = firstName(raw)
  if (GUARANTEE_MESSAGE.includes('{name}')) return GUARANTEE_MESSAGE.replace(/\{name\}/g, name || 'there')
  return `${name ? `Hi ${name},` : 'Hi,'}\n\n${GUARANTEE_MESSAGE}`
}
async function notifyGuarantee({ mobile, name = '', number = '' }) {
  const jid = chatOf(mobile)
  if (!jid) throw new Error(`Enter a valid mobile number (got "${mobile ?? ''}").`)
  const message = guaranteeText(name)
  const done = await cardsSent()
  const last = notifiedAt.get(jid)
  if ((number && done.has(String(number))) || (last && Date.now() - last < NOTIFY_COOLDOWN_MS)) {
    return { ok: true, jid, message, skipped: true }
  }
  await linked()
  await onWhatsApp(jid, mobile)
  await sock.sendMessage(jid, { text: message })
  notifiedAt.set(jid, Date.now())
  if (number) {
    done.add(String(number))
    await writeFile(CARDS_FILE, JSON.stringify([...done].slice(-3000))).catch(() => {})
  }
  log(`[guarantee] ${number || '-'} to ${jid}`)
  return { ok: true, jid, message }
}

/* The auto-reply: a direct message from a customer gets the enquiry number, once an hour. */
const repliedAt = new Map()
async function autoReply(msg) {
  const jid = msg.key?.remoteJid || ''
  if (!jid.endsWith('@s.whatsapp.net') || msg.key?.fromMe || !msg.message) return
  if (!sock || state.status !== 'ready' || (FROM_NUMBER && state.me !== FROM_NUMBER)) return
  const last = repliedAt.get(jid)
  if (last && Date.now() - last < AUTOREPLY_EVERY_MS) return
  repliedAt.set(jid, Date.now())
  try {
    await sock.sendMessage(jid, { text: AUTOREPLY_MESSAGE })
    log(`[autoreply] ${jid}`)
  } catch (err) {
    repliedAt.delete(jid)
    log('[autoreply] failed:', err?.message ?? err)
  }
}

/* ── the WhatsApp link ───────────────────────────────────────────────────── */
async function startWhatsApp() {
  const { makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys')
  const qrcode = await import('qrcode')
  await mkdir(DATA_DIR, { recursive: true })
  const auth = await useMultiFileAuthState(AUTH_DIR)
  let attempts = 0
  let version = null

  async function connect() {
    const s = makeWASocket({
      ...(version ? { version } : {}),
      auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, silent) },
      logger: silent,
      browser: ['Shiv Hardware Reminders', 'Chrome', '1.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    })
    s.ev.on('creds.update', () => auth.saveCreds())
    s.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return
      for (const msg of messages) void autoReply(msg)
    })
    s.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
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
        log('[whatsapp] linked as', state.me, state.me === FROM_NUMBER ? '' : `, not ${FROM_NUMBER}: nothing will be sent`)
      }
      if (connection === 'close') {
        if (sock === s) sock = null
        const code = lastDisconnect?.error?.output?.statusCode
        state.status = code === DisconnectReason.loggedOut ? 'logged_out' : 'reconnecting'
        if (!version && (code === 405 || /connection failure/i.test(String(lastDisconnect?.error?.message)))) {
          version = (await fetchLatestBaileysVersion().catch(() => null))?.version ?? null
        }
        log(`[whatsapp] closed code=${code}`)
        // A logged-out link is not retried: it needs a new scan, which is a restart with the old link moved off the volume by hand.
        if (state.status !== 'logged_out') {
          attempts += 1
          setTimeout(() => void connect(), Math.min(60_000, 10_000 * attempts))
        }
      }
    })
  }
  void connect()
}

/* ── the login page ──────────────────────────────────────────────────────── */
const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp Reminders</title><meta http-equiv="refresh" content="5">
<style>body{margin:0;font:17px/1.4 system-ui,sans-serif;background:#fff;color:#111;display:flex;justify-content:center}
main{max-width:420px;padding:24px 16px;text-align:center}h1{font-size:22px;margin:0 0 8px}img{width:280px;max-width:100%;border:4px solid #111}
.ok{color:#137333;font-weight:700}.wait{background:#ffcc00;padding:6px 10px;display:inline-block}.bad{color:#b3202a;font-weight:700}</style></head><body><main><h1>WhatsApp Reminders</h1>${body}</main></body></html>`

function loginPage() {
  if (state.status === 'ready' && state.me !== FROM_NUMBER) return page(`<p class="bad">Linked to +${state.me}, not +${FROM_NUMBER}. Nothing will be sent.</p>`)
  if (state.status === 'ready') return page(`<p class="ok">Linked to +${state.me}</p>${state.lastSent ? `<p>Last sent: ${state.lastSent.name}, ${state.lastSent.at}</p>` : ''}`)
  if (state.status === 'qr' && state.qr) return page(`<p>On the phone with +${FROM_NUMBER}: WhatsApp, Settings, Linked devices, Link a device. Scan this.</p><img alt="QR to link WhatsApp" src="${state.qr}">`)
  return page(`<p class="wait">${state.status === 'logged_out' ? 'Unlinked' : 'Connecting'}</p>`)
}

/** A request body as JSON, refused past 25 MB (a PDF statement is well under). */
function bodyOf(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 25 * 1024 * 1024) { reject(new Error('Too large.')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { reject(new Error('Not JSON.')) } })
    req.on('error', reject)
  })
}
const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}
const ROUTES = {
  'POST /send-document': async (req) => ({ ok: true, ...(await sendDocument(await bodyOf(req))) }),
  'POST /notify-guarantee': async (req) => notifyGuarantee(await bodyOf(req)),
  'GET /status': async () => ({
    ok: true, status: state.status, me: state.me, readyAt: state.readyAt,
    qrDataUrl: state.status === 'qr' ? state.qr : null, lastError: state.lastError,
  }),
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const route = ROUTES[`${req.method} ${url.pathname}`]
  if (route) {
    if (!SEND_KEY || req.headers['x-shop-key'] !== SEND_KEY) return json(res, 401, { ok: false, error: 'Not allowed.' })
    try {
      return json(res, 200, await route(req))
    } catch (err) {
      state.lastError = { at: new Date().toISOString(), error: String(err?.message ?? err) }
      return json(res, 400, { ok: false, error: String(err?.message ?? err) })
    }
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ok: true, status: state.status, me: state.me, allowed: state.me === FROM_NUMBER }))
    return
  }
  if (url.pathname === '/login' && LOGIN_KEY && url.searchParams.get('key') === LOGIN_KEY) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(loginPage())
    return
  }
  res.writeHead(404)
  res.end()
}).listen(PORT, () => log(`WhatsApp Reminders on :${PORT}`))

void startWhatsApp().catch((err) => { state.status = 'error'; log('[whatsapp] could not start', err) })
setInterval(() => { void sendDue() }, 30_000)

process.on('unhandledRejection', (err) => log('[process] unhandled', err?.message ?? err))
process.on('uncaughtException', (err) => log('[process] uncaught', err?.message ?? err))
process.on('SIGTERM', async () => {
  for (let waited = 0; busy && waited < 25_000; waited += 500) await sleep(500)
  try { sock?.end?.(undefined) } catch { /* gone */ }
  setTimeout(() => process.exit(0), 1000)
})
