/**
 * The Shop WhatsApp (79705 50954), on Railway (service `whatsapp-reminders`).
 * It used to live in the shop PC's print server, so every send needed the PC
 * on; WhatsApp printing was retired (2026-10-30) and the rest moved here:
 *
 *   POST /send-document     a file or photo into a customer's chat, or the
 *                           shop's group (Share to WhatsApp in the panel)
 *   POST /send-text         a typed message into a customer's chat or the
 *                           shop's group (the Shiv Group phone app)
 *   POST /notify-guarantee  "your guarantee card is ready", once per card
 *   GET  /status            the link, with the QR while it needs a scan
 *   the auto-reply          a direct message gets the enquiry number, once an hour
 *   group printing          a photo or PDF in the shop group with bw / cp goes to
 *                           the shop PC's print server through the cloud print
 *                           queue (group-print.mjs, since 2026-11-25)
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
 *   REVIEW_URL            the Google review link put under GUARANTEE_MESSAGE ("off" for none)
 *   AUTOREPLY_MESSAGE     the reply to a direct message
 *   FROM_NUMBER  the only number allowed to send (917970550954)
 *   TO_NUMBER    who is reminded (918709964141)
 *   DATA_DIR     the service's volume (/data)
 */
import http from 'node:http'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { birthdaysOn, indiaDate, sentKey } from './dates.mjs'
import { createGroupPrinter } from './group-print.mjs'
import { keepSentMessages, memoryCache, useSqliteAuthState } from './auth-store.mjs'
import { createLinkWatch } from './link-watch.mjs'

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
/** The shop's Google review page, put under the card-ready text (REVIEW_URL to change it, "off" for none). */
const REVIEW_URL = (process.env.REVIEW_URL ?? 'https://search.google.com/local/writereview?placeid=ChIJzc6OLIvz9DkRx0lBBZ214Gg').trim()
const REVIEW_LINE = 'If you are happy with us, please rate Shiv Hardware Store on Google:'
const AUTOREPLY_MESSAGE = (process.env.AUTOREPLY_MESSAGE
  || 'For any enquiries contact 8092850954 on WhatsApp.').replace(/\\n/g, '\n')
const AUTOREPLY_EVERY_MS = 60 * 60_000
const NOTIFY_COOLDOWN_MS = 10 * 60_000
const BIRTHDAYS = JSON.parse(await readFile(new URL('./birthdays.json', import.meta.url), 'utf8'))

const state = { status: 'starting', qr: null, me: null, lastSent: null, readyAt: null, lastError: null, pairing: null }
let sock = null
// The connection being made, before it is open: a pairing code is asked on it.
let linking = null
// What WhatsApp may ask of us again (baileys.wiki, Troubleshooting): messages
// this device sent, for a retry; how often each was retried; and the shop
// group's details, so a group send does not fetch them every time.
const sentMessages = new Map()
const retryCounts = memoryCache()
const groupCache = memoryCache(5 * 60_000, 50)
let busy = false

const log = (...a) => console.log(new Date().toISOString(), ...a)
const silent = { level: 'silent', trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent } }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const groupPrint = createGroupPrinter({ dataDir: DATA_DIR, log, silent })

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
/** The shop group's details, fetched once and kept (cachedGroupMetadata). */
async function groupReady(jid) {
  if (!groupCache.get(jid)) groupCache.set(jid, await sock.groupMetadata(jid))
}

async function sendDocument({ mobile, data, fileName = 'file.pdf', mimetype = 'application/pdf', caption = '' }) {
  const buffer = Buffer.from(String(data ?? ''), 'base64')
  if (!buffer.length) throw new Error('Nothing to send.')
  await linked()
  let jid
  if (mobile === 'group') {
    if (!SHOP_GROUP_ID) throw new Error('No shop group is set (SHOP_GROUP_ID).')
    jid = SHOP_GROUP_ID
    await groupReady(jid)
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

/** A typed message into a chat, or the shop's group (`mobile: 'group'`). */
async function sendText({ mobile, text, replyTo }) {
  const body = String(text ?? '').trim()
  if (!body) throw new Error('Nothing to send.')
  if (body.length > 4000) throw new Error('The message is too long.')
  await linked()
  let jid
  if (mobile === 'group') {
    if (!SHOP_GROUP_ID) throw new Error('No shop group is set (SHOP_GROUP_ID).')
    jid = SHOP_GROUP_ID
    await groupReady(jid)
  } else {
    jid = chatOf(mobile)
    if (!jid) throw new Error(`Enter a valid mobile number (got "${mobile ?? ''}").`)
    await onWhatsApp(jid, mobile)
  }
  // replyTo { id, participant }: sent as a reply to that message (an order photo's typed lines).
  const quoted = replyTo?.id
    ? { key: { remoteJid: jid, id: String(replyTo.id), ...(replyTo.participant ? { participant: String(replyTo.participant) } : {}) }, message: { conversation: '' } }
    : undefined
  await sock.sendMessage(jid, { text: body }, quoted ? { quoted } : undefined)
  log(`[send] text (${body.length} chars) to ${jid}`)
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
  const text = GUARANTEE_MESSAGE.includes('{name}')
    ? GUARANTEE_MESSAGE.replace(/\{name\}/g, name || 'there')
    : `${name ? `Hi ${name},` : 'Hi,'}\n\n${GUARANTEE_MESSAGE}`
  // The review link goes under whatever text is set on Railway, once: not when
  // that text already carries a Google review link of its own.
  const hasOwn = /writereview|g\.page\/r\//i.test(text) || (REVIEW_URL && text.includes(REVIEW_URL))
  return !REVIEW_URL || REVIEW_URL === 'off' || hasOwn ? text : `${text}\n\n${REVIEW_LINE}\n${REVIEW_URL}`
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
  const baileys = await import('@whiskeysockets/baileys')
  const { makeWASocket, DisconnectReason, makeCacheableSignalKeyStore, fetchLatestBaileysVersion, downloadMediaMessage } = baileys
  const qrcode = await import('qrcode')
  await mkdir(DATA_DIR, { recursive: true })
  // The login in AUTH_DIR/session.db (auth-store.mjs), taken over from the old files.
  const auth = await useSqliteAuthState(AUTH_DIR, baileys, log)
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
      getMessage: async (key) => sentMessages.get(key.id),
      msgRetryCounterCache: retryCounts,
      cachedGroupMetadata: async (jid) => groupCache.get(jid),
    })
    linking = s
    keepSentMessages(s, sentMessages)
    // The group's details kept fresh as they change.
    const refreshGroup = (jid) => { if (jid?.endsWith('@g.us')) s.groupMetadata(jid).then((meta) => groupCache.set(jid, meta), () => {}) }
    s.ev.on('groups.update', (updates) => { for (const u of updates) refreshGroup(u.id) })
    s.ev.on('group-participants.update', (u) => refreshGroup(u.id))
    s.ev.on('creds.update', () => auth.saveCreds())
    s.ev.on('messages.upsert', ({ messages, type }) => {
      // 'append' is the catch-up after a reconnect: group prints only, never replies.
      if (type !== 'notify' && type !== 'append') return
      for (const msg of messages) {
        if (type === 'notify') void autoReply(msg)
        if (state.me === FROM_NUMBER || !FROM_NUMBER) void groupPrint.handle(s, downloadMediaMessage, msg, type)
      }
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
        state.pairing = null
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
        if (state.status !== 'logged_out') {
          // Right after a scan or a pairing code WhatsApp closes the connection on
          // purpose ("restart required", 515) and wants a new one at once
          // (baileys.wiki, QR code: "Keeping the connection alive").
          if (code === DisconnectReason.restartRequired) {
            attempts = 0
            setTimeout(() => void connect(), 250)
            return
          }
          attempts += 1
          setTimeout(() => void connect(), Math.min(60_000, 10_000 * attempts))
          return
        }
        // The phone removed this link, so its login is no good. It is moved
        // aside on the volume (kept, dated) and a fresh one started, so /login
        // shows a new QR to scan with nobody touching the volume by hand.
        const aside = `${AUTH_DIR}-logged-out-${new Date().toISOString().replace(/[:.]/g, '-')}`
        // If it cannot be moved, it stays logged out rather than redialling the dead login.
        auth.close?.()
        const moved = await rename(AUTH_DIR, aside).then(() => true, (err) => {
          log('[whatsapp] logged out, and the old login could not be moved:', err?.message ?? err)
          return false
        })
        if (!moved) return
        log(`[whatsapp] logged out; old login kept at ${aside}, asking for a new scan`)
        setTimeout(() => void startWhatsApp(), 2_000)
      }
    })
  }
  void connect()
}

/* ── linking with a pairing code ─────────────────────────────────────────── */
// Instead of the QR: WhatsApp, Linked devices, Link a device, "Link with phone
// number instead", and the 8-character code shown on /login (baileys.wiki,
// "Pairing code"). Only FROM_NUMBER may be linked here.
async function requestPairing(raw) {
  let number = String(raw ?? '').replace(/\D/g, '')
  if (number.length === 10) number = `91${number}`
  if (number.length < 11 || number.length > 15) throw new Error('Enter the number with its country code, e.g. 917970550954.')
  if (FROM_NUMBER && number !== FROM_NUMBER) throw new Error(`Only +${FROM_NUMBER} can be linked here.`)
  if (state.status === 'ready') throw new Error('Already linked.')
  // A code can only be asked while WhatsApp is offering a QR.
  for (let waited = 0; waited < 20_000 && state.status !== 'qr'; waited += 250) await sleep(250)
  if (state.status !== 'qr' || !linking) throw new Error('WhatsApp is not ready to link yet. Try again in a moment.')
  if (linking.authState?.creds?.registered) throw new Error('A link is already being made.')
  const code = await linking.requestPairingCode(number)
  state.pairing = { number, code, at: Date.now() }
  log(`[whatsapp] pairing code asked for ${number}`)
  return code
}
const pairingShown = () => state.pairing && Date.now() - state.pairing.at < 3 * 60_000 ? state.pairing : null
const codeText = (code) => String(code).replace(/^(.{4})(.{4})$/, '$1-$2')

/* ── the login page ──────────────────────────────────────────────────────── */
const page = (body, refresh = true) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp Reminders</title>${refresh ? '<meta http-equiv="refresh" content="5">' : ''}
<style>body{margin:0;font:17px/1.4 system-ui,sans-serif;background:#fff;color:#111;display:flex;justify-content:center}
main{max-width:420px;padding:24px 16px;text-align:center}h1{font-size:22px;margin:0 0 8px}img{width:280px;max-width:100%;border:4px solid #111}
.ok{color:#137333;font-weight:700}.wait{background:#ffcc00;padding:6px 10px;display:inline-block}.bad{color:#b3202a;font-weight:700}
.code{font:700 40px/1.2 ui-monospace,monospace;letter-spacing:.08em;border:4px solid #111;padding:12px 16px;display:inline-block}
input{font:inherit;padding:10px;border:2px solid #111;width:220px}button{font:inherit;padding:10px 16px;border:2px solid #0b57d0;color:#fff;background:#0b57d0}</style></head><body><main><h1>WhatsApp Reminders</h1>${body}</main></body></html>`

function loginPage(key) {
  const pairing = pairingShown()
  if (state.status !== 'ready' && pairing) return page(`<p>On the phone with +${pairing.number}: WhatsApp, Settings, Linked devices, Link a device, <b>Link with phone number instead</b>. Enter this code:</p><p class="code">${codeText(pairing.code)}</p><p><small>It works for about 3 minutes. <a href="/pair?key=${encodeURIComponent(key)}">Ask for a new one</a></small></p>`)
  if (state.status === 'ready' && state.me !== FROM_NUMBER) return page(`<p class="bad">Linked to +${state.me}, not +${FROM_NUMBER}. Nothing will be sent.</p>`)
  if (state.status === 'ready') return page(`<p class="ok">Linked to +${state.me}</p>${state.lastSent ? `<p>Last sent: ${state.lastSent.name}, ${state.lastSent.at}</p>` : ''}`)
  if (state.status === 'qr' && state.qr) return page(`<p>On the phone with +${FROM_NUMBER}: WhatsApp, Settings, Linked devices, Link a device. Scan this.</p><img alt="QR to link WhatsApp" src="${state.qr}"><p><a href="/pair?key=${encodeURIComponent(key)}">Link with phone number instead</a></p>`)
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
  'POST /send-text': async (req) => ({ ok: true, ...(await sendText(await bodyOf(req))) }),
  'POST /notify-guarantee': async (req) => notifyGuarantee(await bodyOf(req)),
  'GET /status': async () => ({
    ok: true, status: state.status, me: state.me, readyAt: state.readyAt,
    qrDataUrl: state.status === 'qr' ? state.qr : null, lastError: state.lastError,
    groupPrint: groupPrint.state,
    linkWatch: linkWatch.state,
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
    res.end(loginPage(LOGIN_KEY))
    return
  }
  if (url.pathname === '/pair' && LOGIN_KEY && url.searchParams.get('key') === LOGIN_KEY) {
    const form = (error = '') => page(`<p>Link with a code instead of the QR. The phone number to link:</p>${error ? `<p class="bad">${error}</p>` : ''}<form method="post" action="/pair?key=${encodeURIComponent(LOGIN_KEY)}"><p><input name="number" inputmode="numeric" value="${FROM_NUMBER}" placeholder="917970550954"></p><p><button>Get the code</button></p></form><p><small><a href="/login?key=${encodeURIComponent(LOGIN_KEY)}">Back to the QR</a></small></p>`, false)
    if (req.method === 'POST') {
      try {
        const body = await new Promise((resolve, reject) => { let t = ''; req.on('data', (c) => { t += c; if (t.length > 2000) req.destroy() }); req.on('end', () => resolve(t)); req.on('error', reject) })
        await requestPairing(new URLSearchParams(body).get('number'))
        res.writeHead(303, { location: `/login?key=${encodeURIComponent(LOGIN_KEY)}` })
        res.end()
      } catch (err) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(form(String(err?.message ?? err)))
      }
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(form())
    return
  }
  res.writeHead(404)
  res.end()
}).listen(PORT, () => log(`WhatsApp Reminders on :${PORT}`))

void startWhatsApp().catch((err) => { state.status = 'error'; log('[whatsapp] could not start', err) })
setInterval(() => { void sendDue() }, 30_000)

// Tony's number (whatsapp-bills) watched from here: the owner hears when it
// has been unlinked for 10 minutes (link-watch.mjs). ALERT_TO defaults to
// TO_NUMBER, the owner's own chat.
const linkWatch = createLinkWatch({
  env: { ...process.env, ALERT_TO: process.env.ALERT_TO || TO_NUMBER },
  send: (jid, text) => sock.sendMessage(jid, { text }),
  canSend: () => !!sock && state.status === 'ready' && (!FROM_NUMBER || state.me === FROM_NUMBER),
  log,
})
linkWatch.start()

process.on('unhandledRejection', (err) => log('[process] unhandled', err?.message ?? err))
process.on('uncaughtException', (err) => log('[process] uncaught', err?.message ?? err))
process.on('SIGTERM', async () => {
  for (let waited = 0; busy && waited < 25_000; waited += 500) await sleep(500)
  try { sock?.end?.(undefined) } catch { /* gone */ }
  setTimeout(() => process.exit(0), 1000)
})
