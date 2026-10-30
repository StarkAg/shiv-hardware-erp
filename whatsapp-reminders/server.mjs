/**
 * Shiv WhatsApp Reminders: on each classmate's birthday, one message to the
 * owner's own chat at midnight India time, from the Shop WhatsApp (Railway
 * service `whatsapp-reminders`). See docs/whatsapp-numbers.md.
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
const BIRTHDAYS = JSON.parse(await readFile(new URL('./birthdays.json', import.meta.url), 'utf8'))

const state = { status: 'starting', qr: null, me: null, lastSent: null }
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

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
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
