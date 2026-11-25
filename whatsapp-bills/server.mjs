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
 * machine: one bill at a time, a minute or three apart, at most a day's
 * worth, and each bill only once it has rested a while after its last save,
 * so one typed wrong can be put right or deleted before it goes.
 *
 * Nothing reaches a customer at night. Every send, Send now included, goes
 * between 9 am and 9 pm India time; one saved or asked for outside those hours
 * stays in the queue and goes from 9 am, oldest first, asked-for ones ahead.
 * The queue is the books themselves (what is due and not yet recorded as
 * sent), so a restart loses nothing; and a restart waits for a bill being
 * sent to finish and be recorded, so none goes twice.
 * The bill's own photos go as they are; a bill typed in the panel goes as a
 * picture of the printed bill, drawn here with the shop PC's own template.
 * The pages go first, then one message saying which bill they are.
 *
 * A customer who writes "hi" (hello, namaste...) to this number for the first
 * time gets the greeting and visiting card at once, the same as a new bill's
 * chat: the counter's QR (docs/whatsapp-hi-card.md) opens this chat with "Hi"
 * typed. Once per number, ever; never to a chat the owner has written to.
 *
 * The link is kept for good. It lives on the service's volume, so a restart
 * or an update picks it up again; a dropped connection is redialled for ever,
 * and a link stuck for ten minutes is redialled afresh. When WhatsApp says the
 * device is logged out, the old link is moved aside, not deleted, and a new QR
 * is shown, exactly as whatsapp-reminders does (since 25 Nov 2026). What ends the link for real is the owner removing it under Linked
 * devices, or his phone being off WhatsApp for about 14 days, which is
 * WhatsApp's own rule for every linked device.
 *
 * Environment (Railway variables):
 *   CONVEX_URL          the shop's deployment
 *   SHIV_DEVICE_TOKEN   this service's key: npx convex run --prod devices:issueServerKey '{"name":"whatsapp-bills"}'
 *   LOGIN_KEY           the secret in the /login link, so only the shop sees the QR
 *   AUTH_DIR            where the WhatsApp link is kept, on the service's volume (/data/auth)
 *                       (greeted.json beside it: the chats already greeted, see the hi-reply)
 *   BILL_WHATSAPP_REST_MIN, BILL_WHATSAPP_DAILY_MAX (10, 40)
 */
import http from 'node:http'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { keepSentMessages, memoryCache, useSqliteAuthState } from './auth-store.mjs'

const PORT = Number(process.env.PORT || 8080)
const AUTH_DIR = process.env.AUTH_DIR || '/data/auth'
const LOGIN_KEY = process.env.LOGIN_KEY || ''
const REST_MS = Number(process.env.BILL_WHATSAPP_REST_MIN || 10) * 60_000
const DAILY_MAX = Number(process.env.BILL_WHATSAPP_DAILY_MAX || 40)
/** The shop's visiting card, sent once to a number before its first bill. */
const CARD = fileURLToPath(new URL('./visiting-card.jpg', import.meta.url))
/** Every chat already greeted or already written to, kept beside the link on the volume. */
const KNOWN_FILE = join(dirname(AUTH_DIR), 'greeted.json')
/**
 * The two payment QRs Shiv Intro can send, each as the picture with its UPI
 * link under it, the way they are posted in the SHS Accounts group.
 */
const QRS = {
  shop: {
    file: fileURLToPath(new URL('./qr-shop.jpg', import.meta.url)),
    caption: ['upi://pay?pa=MSWIPE.2530091626717162%40MSWIPESBM&pn=SHIV%20HARDWARE%20STORE&cu=INR', 'Shiv Hardware Store - MSwipe'].join('\n\n'),
  },
  harsh: {
    file: fileURLToPath(new URL('./qr-harsh.jpg', import.meta.url)),
    caption: ['upi://pay?pa=HARSH4141%40PTAXIS&pn=HARSH%20AGARWAL&cu=INR', 'UPI Number - 8709964141', 'Harsh Agarwal'].join('\n\n'),
  },
}
/** The hours a customer can be sent anything, India time: never at night, the owner's rule. */
const HOURS = [9, 21]
const GAP_MS = [60_000, 180_000]
const COUNTRY = '91'

const state = { status: 'starting', qr: null, readyAt: null, me: null, lastError: null, lastSent: null, pairing: null }
let sock = null
// The connection being made, before it is open: a pairing code is asked on it.
let linking = null
// Tony's number, the only one this service may be linked to by code.
const PAIR_NUMBER = String(process.env.FROM_NUMBER || '918092850954').replace(/\D/g, '')
// What WhatsApp may ask of us again (baileys.wiki, Troubleshooting): the
// messages this device sent, for a retry, and how often each was retried.
const sentMessages = new Map()
const retryCounts = memoryCache()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const log = (...a) => console.log(new Date().toISOString(), ...a)

/* ── the WhatsApp link ───────────────────────────────────────────────────── */
const silent = { level: 'silent', trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent } }
let relogin = async () => {}
let redial = () => {}
let since = Date.now()
const setStatus = (status) => { if (state.status !== status) since = Date.now(); state.status = status }
/** A link put aside rather than deleted, so a logout WhatsApp did not mean can be undone by hand. */
const putAside = () => rename(AUTH_DIR, `${AUTH_DIR}-${new Date().toISOString().replace(/[:.]/g, '-')}`).catch(() => {})

// The connection is made exactly as in whatsapp-reminders/server.mjs, which
// links and stays linked (owner's ask, 25 Nov 2026): Baileys' own WhatsApp Web
// version (the latest is fetched only if WhatsApp refuses it), a logout believed
// the first time and the old login moved aside for a fresh QR, and a redial
// after 10 s, 20 s, ... up to a minute otherwise. Before, this service fetched
// the latest version at every start and counted three 401s (a "conflict"
// among them) before giving up, and a scan on 25 Nov was thrown away that way.
let gen = 0

async function startWhatsApp() {
  const baileys = await import('@whiskeysockets/baileys')
  const { makeWASocket, DisconnectReason, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = baileys
  const qrcode = await import('qrcode')
  // The login in AUTH_DIR/session.db (auth-store.mjs), taken over from the old files.
  const auth = await useSqliteAuthState(AUTH_DIR, baileys, log)
  let attempts = 0
  let version = null

  async function connect() {
    const mine = ++gen
    const s = makeWASocket({
      ...(version ? { version } : {}),
      auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, silent) },
      logger: silent,
      browser: ['Shiv Hardware Bills', 'Chrome', '1.0'],
      syncFullHistory: false,
      // The owner's phone keeps its notifications: this device never shows as online.
      markOnlineOnConnect: false,
      getMessage: async (key) => sentMessages.get(key.id),
      msgRetryCounterCache: retryCounts,
    })
    linking = s
    keepSentMessages(s, sentMessages)
    s.ev.on('creds.update', () => auth.saveCreds())
    // A customer's hi, and the chats the owner writes to (the hi-reply, below).
    s.ev.on('messages.upsert', ({ messages, type }) => {
      if (mine !== gen) return
      for (const msg of messages) {
        if (type === 'notify' || msg.key?.fromMe) void onMessage(msg)
      }
    })
    s.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (mine !== gen) return
      if (qr) {
        setStatus('qr')
        state.qr = await qrcode.toDataURL(qr, { margin: 1, width: 320 }).catch(() => null)
      }
      if (connection === 'open') {
        sock = s
        attempts = 0
        setStatus('ready')
        state.qr = null
        state.pairing = null
        state.readyAt = new Date().toISOString()
        state.me = s.user?.id?.split(':')[0]?.split('@')[0] ?? null
        state.lastError = null
        log('[whatsapp] linked as', state.me)
      }
      if (connection === 'close') {
        if (sock === s) sock = null
        const code = lastDisconnect?.error?.output?.statusCode
        const message = String(lastDisconnect?.error?.message ?? '')
        setStatus(code === DisconnectReason.loggedOut ? 'logged_out' : 'reconnecting')
        state.lastError = message ? { at: new Date().toISOString(), code, message } : null
        if (!version && (code === 405 || /connection failure/i.test(message))) {
          version = (await fetchLatestBaileysVersion().catch(() => null))?.version ?? null
        }
        log(`[whatsapp] closed code=${code}${message ? ` (${message.slice(0, 120)})` : ''}`)
        if (state.status !== 'logged_out') {
          // Right after a scan or a pairing code WhatsApp closes the connection on
          // purpose ("restart required", 515) and wants a new one at once
          // (baileys.wiki, QR code: "Keeping the connection alive").
          if (code === DisconnectReason.restartRequired) {
            attempts = 0
            setTimeout(() => { if (mine === gen) void connect() }, 250)
            return
          }
          attempts += 1
          setTimeout(() => { if (mine === gen) void connect() }, Math.min(60_000, 10_000 * attempts))
          return
        }
        // The phone removed this link, so its login is no good. It is moved
        // aside (kept, dated) and a fresh one started, so /login shows a new QR.
        auth.close?.()
        await putAside()
        log('[whatsapp] logged out; old login put aside, asking for a new scan')
        setTimeout(() => { if (mine === gen) void startWhatsApp() }, 2_000)
      }
    })
  }

  relogin = async () => {
    gen++
    try { await sock?.logout?.() } catch { /* already gone */ }
    try { sock?.end?.(new Error('relogin')) } catch { /* gone */ }
    sock = null
    setStatus('starting')
    state.qr = null
    auth.close?.()
    await putAside()
    void startWhatsApp()
  }

  // Redial with the saved link, as a stuck connection needs.
  redial = () => {
    gen++
    try { sock?.end?.(new Error('redial')) } catch { /* gone */ }
    sock = null
    setStatus('reconnecting')
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
  // The walk-in account's name is the shop's own word for it, not the buyer's.
  const to = item.shared ? '' : `, ${item.name}`
  // A bill, a receipt or a quotation goes as its pages alone, no text: the
  // owner asked for that. A refund or a return still says what it is.
  if (!item.kind || item.kind === 'Sale' || item.kind === 'Receipt' || item.kind === 'Quotation') return ''
  return `Namaste${to}.\nHere is the ${item.kind.toLowerCase()} copy for online records.\n\n${item.kind} dated ${day}${amount}\nShiv Hardware Store`
}

const indiaHour = () => new Date(Date.now() + 19_800_000).getUTCHours()
const inHours = () => indiaHour() >= HOURS[0] && indiaHour() < HOURS[1]
let busy = false
let stopping = false
let nextAt = 0

/**
 * The way the shop greets a new number by hand: a smile, folded hands, then the
 * visiting card. The one place emoji are allowed (AGENTS.md), written as code points.
 */
async function greet(jid) {
  remember(jid)
  for (const text of ['\u{1F642}', '\u{1F64F}\u{1F3FB}']) {
    await sock.sendMessage(jid, { text })
    await new Promise((resolve) => setTimeout(resolve, 1_000 + Math.random() * 1_000))
  }
  await sock.sendMessage(jid, { image: await readFile(CARD) })
}

/* ── the hi-reply ────────────────────────────────────────────────────────── */
/*
 * A customer's first "hi" gets the greeting and card straight back. The chats
 * already greeted (by a bill, Shiv Intro or a hi) and every chat the owner has
 * written to are kept in KNOWN_FILE, so a number gets the card once, and the
 * owner's friends, family and running customers are not sent it once he has
 * written to them since this went live.
 */
const known = new Set()
let knownSaving = null
const loadKnown = readFile(KNOWN_FILE, 'utf8')
  .then((text) => { for (const id of JSON.parse(text)) known.add(id) }, () => {})
/** The number part of a chat id ("9180...@s.whatsapp.net", "1234:5@lid" → "1234@lid"). */
const chatKey = (jid) => {
  const [user = '', server = ''] = String(jid ?? '').split('@')
  const id = user.split(':')[0]
  return id ? (server === 'lid' ? `${id}@lid` : id) : ''
}
/** A personal chat's ids: WhatsApp may name it by number or by its private id (lid), or both. */
const keysOf = (key) => [key?.remoteJid, key?.remoteJidAlt]
  .filter((jid) => /@(s\.whatsapp\.net|lid)$/.test(jid ?? '')).map(chatKey).filter(Boolean)
function remember(...jids) {
  let added = false
  for (const id of jids.flatMap((jid) => (jid && typeof jid === 'object' ? keysOf(jid) : [chatKey(jid)]))) {
    if (id && !known.has(id)) { known.add(id); added = true }
  }
  if (added && !knownSaving) {
    knownSaving = setTimeout(() => {
      knownSaving = null
      writeFile(KNOWN_FILE, JSON.stringify([...known])).catch((err) => log('[hi] could not save:', err?.message ?? err))
    }, 2_000)
  }
}

/** Words a greeting is made of; at least one must be a greeting itself (GREETS). */
const GREETS = new Set(['hi', 'ram', 'hii', 'hey', 'hy', 'hai', 'hello', 'helo', 'hlo', 'hlw', 'hallo', 'namaste', 'namastey', 'namaskar',
  'pranam', 'gm', 'morning', 'afternoon', 'evening', 'नमस्ते', 'नमस्कार', 'प्रणाम', 'हाय', 'हेलो', 'हैलो', 'राम'])
const HI_WORDS = new Set([...GREETS, 'good', 'jai', 'shri', 'sri', 'sir', 'ji', 'bhaiya', 'bhai', 'uncle', 'there',
  'shiv', 'hardware', 'store', 'जय', 'श्री', 'जी'])
/** "Hi", "Hiii sir", "Hello Shiv Hardware", "नमस्ते जी": a greeting and nothing more. */
function isHi(text) {
  const words = String(text ?? '').toLowerCase()
    .replace(/[^\p{L}\p{M}\s]/gu, ' ').split(/\s+/).filter(Boolean)
    // "hiiii", "heyyy", "hellooo": a letter held down is the same word.
    .map((word) => word.replace(/(\p{L})\1{2,}/gu, '$1'))
  return words.length > 0 && words.length <= 5 && words.every((word) => HI_WORDS.has(word)) && words.some((word) => GREETS.has(word))
}
const textOf = (message) => message?.conversation ?? message?.extendedTextMessage?.text ?? ''

/** What comes in: the owner's own writing marks a chat as his; a customer's first hi is greeted. */
async function onMessage(msg) {
  const keys = keysOf(msg.key)
  if (!keys.length) return
  await loadKnown
  if (msg.key.fromMe) { remember(msg.key); return }
  // Paused by the owner: HI_REPLY=off on Railway. Delete the variable to turn it back on.
  if (process.env.HI_REPLY === 'off') return
  if (!msg.message || !sock || state.status !== 'ready' || stopping) return
  if (keys.some((id) => known.has(id))) return
  // A hi from hours ago, delivered when the link came back, is left to the owner.
  const at = Number(msg.messageTimestamp ?? 0) * 1000
  if (at && Date.now() - at > 6 * 60 * 60_000) return
  if (!isHi(textOf(msg.message))) return
  try {
    await new Promise((resolve) => setTimeout(resolve, 1_500 + Math.random() * 1_500))
    if (keys.some((id) => known.has(id))) return
    remember(msg.key)
    await greet(msg.key.remoteJid)
    log(`[hi] greeted ${msg.key.remoteJidAlt ?? msg.key.remoteJid}`)
  } catch (err) {
    log('[hi] failed:', err?.message ?? err)
  }
}

/**
 * Shiv Intro's Send button (convex/shivIntro.ts): whichever were ticked, the
 * greeting and card and either QR, in that order, to one customer at a time,
 * taking turns with the bills. A person pressed it, so
 * it does not wait for the bills' gap; outside the hours it waits like they do.
 */
async function sendIntro() {
  if (busy || stopping || !sock || state.status !== 'ready' || !inHours()) return
  const db = await books().catch(() => null)
  if (!db) return
  busy = true
  let item = null
  const record = (status, reason) => db.mutation(anyApi.shivIntro.recordSend, { id: item.id, status, ...(reason ? { reason } : {}) })
  try {
    const [next] = await db.query(anyApi.shivIntro.toSend, {})
    if (!next) return
    if (!(await db.mutation(anyApi.shivIntro.claimSend, { id: next.id }))) return
    item = next
    const jid = jidOf(item.phone)
    if (!jid) { await record('skipped', `not a mobile number: ${item.phone}`); return }
    try {
      const [check] = await sock.onWhatsApp(jid)
      if (check && check.exists === false) { await record('skipped'); return }
    } catch { /* the check failed: send anyway */ }
    const what = item.what?.length ? item.what : ['card']
    for (const [i, part] of what.entries()) {
      if (i) await new Promise((resolve) => setTimeout(resolve, 1_000 + Math.random() * 1_000))
      if (part === 'card') await greet(jid)
      else if (QRS[part]) await sock.sendMessage(jid, { image: await readFile(QRS[part].file), caption: QRS[part].caption })
    }
    await record('sent')
    log(`[intro] ${what.join(' + ')} sent to ${item.name}`)
  } catch (err) {
    log('[intro]', item?.name ?? 'check', 'failed:', err?.message ?? err)
    if (item) await record('failed', String(err?.message ?? err)).catch(() => {})
  } finally {
    busy = false
  }
  // Anyone else already waiting goes next, not at the next tick.
  if (item) setTimeout(() => { void sendIntro() }, 2_000)
}

/** Send goes the moment it is pressed: the books tell this service at once. */
async function listenForIntros() {
  const db = await books().catch(() => null)
  if (!db) return
  db.onUpdate(anyApi.shivIntro.toSend, {}, (rows) => { if (rows?.length) void sendIntro() },
    (err) => log('[intro] listening failed:', err?.message ?? err))
}

async function sendDue() {
  if (busy || stopping || !sock || state.status !== 'ready') return
  // Outside the hours everything waits in the queue, Send now too.
  if (!inHours()) return
  const db = await books().catch(() => null)
  if (!db) return
  busy = true
  let item = null
  // A quotation has no voucher: its sending is recorded against its bill.
  const record = (status, extra = {}) => db.mutation(anyApi.billWhatsApp.record,
    { ...(item.billId ? { billId: item.billId } : { voucherId: item.voucherId }), status, ...extra })
  try {
    const due = await db.query(anyApi.billWhatsApp.due, { before: Date.now() - REST_MS, limit: 1 })
    if (!due?.items?.length || due.sentToday >= DAILY_MAX) return
    item = due.items[0]
    // A person pressing Send now is intentional: it can go while the regular
    // schedule is off and without waiting for its gap, but in the hours only.
    if (!item.onDemand && (!due.on || Date.now() < nextAt)) return
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

    // A number this sender has not written to before is greeted.
    if (item.newChat) {
      await greet(jid)
      await new Promise((resolve) => setTimeout(resolve, 2_000 + Math.random() * 2_000))
    }

    // Every page of the bill, then (a refund or a return only) the line saying
    // what it is, as its own message after them: a note on the first photo
    // read as being about that page alone.
    for (const m of media) {
      await sock.sendMessage(jid, m)
      await new Promise((resolve) => setTimeout(resolve, 2_000 + Math.random() * 2_000))
    }
    const note = caption(item)
    if (note) await sock.sendMessage(jid, { text: note })
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

/* ── linking with a pairing code ─────────────────────────────────────────── */
// Instead of the QR: WhatsApp, Linked devices, Link a device, "Link with phone
// number instead", and the 8-character code shown on /login (baileys.wiki,
// "Pairing code"). Only PAIR_NUMBER (Tony's) may be linked here.
async function requestPairing(raw) {
  let number = String(raw ?? '').replace(/\D/g, '')
  if (number.length === 10) number = `91${number}`
  if (number.length < 11 || number.length > 15) throw new Error(`Enter the number with its country code, e.g. ${PAIR_NUMBER}.`)
  if (PAIR_NUMBER && number !== PAIR_NUMBER) throw new Error(`Only +${PAIR_NUMBER} can be linked here.`)
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
<title>WhatsApp Bills</title>${refresh ? '<meta http-equiv="refresh" content="5">' : ''}
<style>body{margin:0;font:17px/1.4 system-ui,sans-serif;background:#fff;color:#111;display:flex;justify-content:center}
main{max-width:420px;padding:24px 16px;text-align:center}h1{font-size:22px;margin:0 0 8px}img{width:280px;max-width:100%;border:4px solid #111}
.ok{color:#137333;font-weight:700}.wait{background:#ffcc00;padding:6px 10px;display:inline-block}small{color:#555}
form{margin-top:28px}button{font:inherit;padding:10px 16px;border:2px solid #b3202a;color:#b3202a;background:#fff}
.bad{color:#b3202a;font-weight:700}.code{font:700 40px/1.2 ui-monospace,monospace;letter-spacing:.08em;border:4px solid #111;padding:12px 16px;display:inline-block}
input{font:inherit;padding:10px;border:2px solid #111;width:220px}button.go{border-color:#0b57d0;color:#fff;background:#0b57d0}</style></head><body><main>${body}</main></body></html>`

function loginPage(key) {
  const head = '<h1>WhatsApp Bills</h1>'
  const pairing = pairingShown()
  if (state.status !== 'ready' && pairing) {
    return page(`${head}<p>On the phone with +${pairing.number}: WhatsApp, Settings, Linked devices, Link a device, <b>Link with phone number instead</b>. Enter this code:</p><p class="code">${codeText(pairing.code)}</p><p><small>It works for about 3 minutes. <a href="/pair?key=${encodeURIComponent(key)}">Ask for a new one</a></small></p>`)
  }
  if (state.status === 'ready') {
    return page(`${head}<p class="ok">Linked to +${state.me ?? ''}</p>
<p><small>Since ${state.readyAt ?? ''}${state.lastSent ? `<br>Last bill sent: ${state.lastSent.label}, ${state.lastSent.name}, ${state.lastSent.at}` : ''}</small></p>
<form method="post" action="/logout?key=${encodeURIComponent(key)}"><button>Unlink this WhatsApp</button></form>`)
  }
  if (state.status === 'qr' && state.qr) {
    return page(`${head}<p>On the shop owner's phone: WhatsApp, Settings, Linked devices, Link a device. Scan this.</p><img alt="QR to link WhatsApp" src="${state.qr}"><p><a href="/pair?key=${encodeURIComponent(key)}">Link with phone number instead</a></p>`)
  }
  return page(`${head}<p class="wait">${state.status === 'logged_out' ? 'Unlinked. A new QR is coming.' : 'Connecting'}</p>`)
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const keyOk = LOGIN_KEY && url.searchParams.get('key') === LOGIN_KEY
  if (url.pathname === '/health') {
    // Read by the panel's WhatsApp page: whether the link is up, and to which number.
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ok: true, status: state.status, me: state.status === 'ready' ? state.me : null, since: state.readyAt, hours: HOURS, dailyMax: DAILY_MAX, restMin: REST_MS / 60_000 }))
    return
  }
  if (!keyOk) { res.writeHead(404); res.end(); return }
  if (url.pathname === '/login' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(loginPage(url.searchParams.get('key')))
    return
  }
  if (url.pathname === '/pair') {
    const form = (error = '') => page(`<h1>WhatsApp Bills</h1><p>Link with a code instead of the QR. The phone number to link:</p>${error ? `<p class="bad">${error}</p>` : ''}<form method="post" action="/pair?key=${encodeURIComponent(LOGIN_KEY)}"><p><input name="number" inputmode="numeric" value="${PAIR_NUMBER}"></p><p><button class="go">Get the code</button></p></form><p><small><a href="/login?key=${encodeURIComponent(LOGIN_KEY)}">Back to the QR</a></small></p>`, false)
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
void startWhatsApp().catch((err) => { setStatus('error'); state.lastError = { message: String(err?.message ?? err) }; log('[whatsapp] could not start', err) })
setInterval(() => { void sendDue() }, 30_000)
setInterval(() => { void sendIntro() }, 30_000)
void listenForIntros()

// Watchdog: a link that is neither up nor waiting for a scan for ten minutes
// is redialled with the saved link, never thrown away.
setInterval(() => {
  if (['ready', 'qr', 'logged_out'].includes(state.status)) return
  if (Date.now() - since > 10 * 60_000) {
    log(`[whatsapp] watchdog: "${state.status}" for ten minutes, redialling with the saved link`)
    since = Date.now()
    redial()
  }
}, 60_000)

// Nothing WhatsApp throws stops the service.
process.on('unhandledRejection', (err) => log('[process] unhandled', err?.message ?? err))
process.on('uncaughtException', (err) => log('[process] uncaught', err?.message ?? err))

// An update or a restart: no new bill is started, one being sent is finished
// and recorded (railway.json gives it a minute), so it neither goes half nor
// goes again; then the connection is closed, never logged out, so the saved
// link is there when the service comes back.
process.on('SIGTERM', async () => {
  stopping = true
  log(`[process] stopping${busy ? ' once the bill being sent is recorded' : ''}; the WhatsApp link stays saved`)
  for (let waited = 0; busy && waited < 50_000; waited += 500) await new Promise((resolve) => setTimeout(resolve, 500))
  try { sock?.end?.(undefined) } catch { /* gone */ }
  setTimeout(() => process.exit(0), 1500)
})
