// Bill photo → guarantee-card previews → print, from a phone on the shop Wi-Fi.
//
//   GET  /cards                 the phone page (camera, previews, Print)
//   POST /cards/read            { image (base64), mediaType } → what the bill says
//   POST /cards/preview         { id, job } → PNG of every card, two to a pass
//   POST /cards/print           { id, job (≤2 cards), again? } → numbered, saved, printed
//   GET  /cards/file/:id/:name  the bill photo and preview PNGs of one scan
//
// The bill is read by Claude Code running on this PC under the shop's own Claude
// login (the subscription) — never the API key in .env, which is stripped from
// its environment. Cards are made by scripts/card-job.mjs, the same renderer,
// numbering, cloud save and Epson tray print as the desktop flow.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CARD_JOB = join(ROOT, 'scripts', 'card-job.mjs')
const JOBS = join(tmpdir(), 'shiv-card-scan')
const MODEL = process.env.CARD_SCAN_MODEL || 'sonnet'
const ID_RE = /^[a-z0-9-]{6,40}$/

// ── Claude Code on this PC ─────────────────────────────────────────────────
/** The newest claude.exe: CLAUDE_BIN, a standalone install, or the VS Code extension's. */
function findClaude() {
  if (process.env.CLAUDE_BIN && existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN
  const local = join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')
  if (existsSync(local)) return local
  const ext = join(homedir(), '.vscode', 'extensions')
  const version = (d) => (d.match(/(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1).map(Number)
  const newer = (a, b) => { const [x, y] = [version(a), version(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0 }
  try {
    for (const dir of readdirSync(ext).filter((d) => d.startsWith('anthropic.claude-code-')).sort(newer)) {
      const bin = join(ext, dir, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude')
      if (existsSync(bin)) return bin
    }
  } catch { /* no extensions folder */ }
  return null
}

/** Environment for Claude Code: the subscription login only, never an API key. */
function claudeEnv() {
  const env = { ...process.env }
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ELECTRON_RUN_AS_NODE', 'CLAUDECODE']) delete env[k]
  return env
}

function run(bin, args, { cwd, input, timeout, env }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env: env ?? process.env, windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), timeout)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: String(e) }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }) })
    if (input != null) child.stdin.end(input)
    else child.stdin.end()
  })
}

// ── What the shop sells with a guarantee ───────────────────────────────────
/** Catalog brands with their guarantee years, plus brands that only have a pre-printed back. */
function knownBrands() {
  const list = new Map()
  try {
    const walk = (o) => {
      if (Array.isArray(o)) return o.forEach(walk)
      if (o && typeof o === 'object') {
        if (typeof o.name === 'string' && o.guaranteeYears > 0) list.set(o.name.trim(), o.guaranteeYears)
        Object.values(o).forEach(walk)
      }
    }
    walk(JSON.parse(readFileSync(join(ROOT, 'print-server', 'data', 'catalog.json'), 'utf8')))
  } catch { /* no catalog */ }
  const firstWords = new Set([...list.keys()].map((n) => n.split(/\s+/)[0].toLowerCase()))
  try {
    for (const f of readdirSync(join(ROOT, '..', 'card-backs', 'images'))) {
      const m = f.match(/^(.+?)\s+(\d+)\s*Yrs\.png$/i)
      if (m && !firstWords.has(m[1].split(/\s+/)[0].toLowerCase())) list.set(m[1].replace(/^\w/, (c) => c.toUpperCase()), Number(m[2]))
    }
  } catch { /* no card-backs folder */ }
  return [...list].map(([name, years]) => `- ${name} — ${years} years`).join('\n')
}

const SCHEMA = {
  type: 'object',
  properties: {
    customer: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        mobile: { type: 'string' },
        uid: { type: 'string' },
      },
      required: ['name', 'mobile', 'uid'],
    },
    date: { type: 'string', description: 'YYYY-MM-DD or empty' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          brand: { type: 'string' },
          thickness: { type: 'string' },
          size: { type: 'string' },
          length: { type: 'string' },
          height: { type: 'string' },
          qty: { type: ['number', 'null'] },
          amount: { type: ['number', 'null'] },
          years: { type: 'integer' },
        },
        required: ['brand', 'thickness', 'size', 'length', 'height', 'qty', 'amount', 'years'],
      },
    },
    skipped: { type: 'array', items: { type: 'string' } },
    unsure: { type: 'array', items: { type: 'string' } },
  },
  required: ['customer', 'date', 'items', 'skipped', 'unsure'],
}

const prompt = () => `Open bill.jpg with the Read tool. It is a photo of a handwritten bill from Shiv Hardware Store, Ramgarh Cantt, Jharkhand. Return what goes on the customer's guarantee cards.

Customer
- name: the text after "M/s" (leave out "M/s"). Keep "Ji" if written, and the place after a comma if it is on the same line, e.g. "Ranjan Kumar Ranjan Ji, Napo Badkagaon". Use real Jharkhand place spellings.
  Always give your best full reading of the name and place, even when unsure (staff check it); say what is doubtful in "unsure".
- mobile: exactly 10 digits, only if every digit is clear; otherwise "". Never guess a digit.
- uid: Aadhaar/UID if written, else "".
- date: the bill's date as YYYY-MM-DD (bills write DD/MM/YY), else "". Today is ${new Date().toISOString().slice(0, 10)}; a bill is never dated after today.

Items: only goods that get a guarantee card — plywood, block board, doors and the brands below. Put everything else (hardware, Fevicol, handles, hinges, screws, labour, fare, transport) in "skipped" as short text.
For each item:
- brand: the matching name from this list. Bills abbreviate: "Sig" = Signature, "Sig Gold"/"SG" = Signature Gold, "Gold Club" = Signature Gold Club, "MS" = Milton Super, "DDLNT"/"DD LNT"/"DD Lam"/"3DMT" = DDoor 3D Lamination. A door's design code (e.g. "3DMT 158") goes after the brand: "DDoor 3D Lamination 158".
${knownBrands()}
  If nothing matches, write the brand as the bill does and set years 0.
- thickness: "19MM" for 18mm or 19mm (the shop prints 18mm as 19MM); otherwise as written, e.g. "12MM", "6MM"; "" for doors.
- size: exactly as the bill writes it. Feet such as 8x4 → "8 X 4"; never convert feet to inches. If the bill gives inches such as "82 4/8 x 35 4/8", put length "82 4/8", height "35 4/8" and size "". Otherwise length and height are "".
- qty: pieces/sheets (number). amount: that line's total in rupees, or null.
- years: the guarantee years for that brand from the list.
- unsure: very short notes (under 12 words each) on anything you could not read for certain, e.g. "Mobile last digit unclear". Empty if all is clear.`

async function readBill(dir) {
  const bin = findClaude()
  if (!bin) throw new Error('Claude Code is not installed on this PC')
  const args = [
    '-p', '--model', MODEL, '--output-format', 'json',
    '--tools', 'Read', '--allowedTools', 'Read',
    '--strict-mcp-config', '--setting-sources', 'project', '--no-session-persistence',
    '--json-schema', JSON.stringify(SCHEMA),
  ]
  const { code, out, err } = await run(bin, args, { cwd: dir, input: prompt(), timeout: 180_000, env: claudeEnv() })
  let res
  try { res = JSON.parse(out) } catch { throw new Error(`Claude did not answer (${code}): ${(err || out).slice(0, 300)}`) }
  if (res.is_error || !res.structured_output) throw new Error(String(res.result || res.subtype || 'Claude could not read the bill').slice(0, 300))
  return res.structured_output
}

// ── card-job ───────────────────────────────────────────────────────────────
async function cardJob(job, mode, outDir) {
  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, 'job.json')
  writeFileSync(file, JSON.stringify(job, null, 2))
  const { out, err } = await run(process.execPath, [CARD_JOB, file, `--${mode}`, '--json', '--out', outDir], { cwd: ROOT, timeout: 180_000 })
  const line = out.split(/\r?\n/).reverse().find((l) => l.startsWith('@@RESULT '))
  if (!line) throw new Error((err || out).trim().split(/\r?\n/).pop() || `card-job ${mode} failed`)
  const result = JSON.parse(line.slice(9))
  if (!result.ok) throw new Error(result.error)
  return result
}

function cleanJob(job) {
  const s = (v) => String(v ?? '').trim()
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(s(job?.date)) ? s(job.date) : undefined,
    customer: { name: s(job?.customer?.name), mobile: s(job?.customer?.mobile).replace(/\D/g, ''), uid: s(job?.customer?.uid) },
    whatsapp: false,
    cards: (job?.cards ?? []).map((c) => ({
      years: Number(c.years) || undefined,
      items: (c.items ?? []).map((it) => ({
        brand: s(it.brand), thickness: s(it.thickness), size: s(it.size), length: s(it.length), height: s(it.height),
        qty: it.qty === '' || it.qty == null ? null : Number(it.qty),
        amount: it.amount === '' || it.amount == null ? null : Number(it.amount),
      })),
    })),
  }
}

/** Old scans go after two days — the photos and previews are only needed while the customer waits. */
function sweep() {
  try {
    for (const d of readdirSync(JOBS)) {
      const p = join(JOBS, d)
      if (Date.now() - statSync(p).mtimeMs > 2 * 86_400_000) rmSync(p, { recursive: true, force: true })
    }
  } catch { /* nothing yet */ }
}

// ── routes ─────────────────────────────────────────────────────────────────
export function registerCardScan(app) {
  let printing = false
  const printed = new Map() // job hash → { at, numbers }

  app.get('/cards', (_req, res) => res.type('html').send(PAGE))

  app.post('/cards/read', async (req, res) => {
    const { image } = req.body ?? {}
    if (!image) return res.status(400).json({ ok: false, error: 'No photo' })
    sweep()
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const dir = join(JOBS, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'bill.jpg'), Buffer.from(String(image).replace(/^data:[^,]+,/, ''), 'base64'))
    const t0 = Date.now()
    try {
      const bill = await readBill(dir)
      writeFileSync(join(dir, 'bill.json'), JSON.stringify(bill, null, 2))
      console.log(`[cards] read ${id} in ${Date.now() - t0}ms: ${bill.customer?.name} · ${bill.items?.length} item(s)`)
      res.json({ ok: true, id, bill, ms: Date.now() - t0 })
    } catch (err) {
      console.error('[cards] read failed', err)
      res.status(500).json({ ok: false, id, error: String(err.message || err) })
    }
  })

  app.post('/cards/preview', async (req, res) => {
    const { id, job } = req.body ?? {}
    if (!ID_RE.test(String(id))) return res.status(400).json({ ok: false, error: 'Bad scan id' })
    const clean = cleanJob(job)
    if (!clean.cards.length) return res.json({ ok: true, cards: [] })
    const stamp = Date.now().toString(36)
    try {
      const cards = []
      for (let i = 0; i < clean.cards.length; i += 2) {
        const outDir = join(JOBS, id, `preview-${stamp}-${i / 2 + 1}`)
        const r = await cardJob({ ...clean, cards: clean.cards.slice(i, i + 2) }, 'preview', outDir)
        r.pngs.forEach((p, k) => cards.push({ url: `/cards/file/${id}/${outDir.split(/[\\/]/).pop()}/${p.split(/[\\/]/).pop()}`, years: r.years[k] }))
      }
      res.json({ ok: true, cards })
    } catch (err) {
      res.status(400).json({ ok: false, error: String(err.message || err) })
    }
  })

  app.post('/cards/print', async (req, res) => {
    const { id, job, again } = req.body ?? {}
    if (!ID_RE.test(String(id))) return res.status(400).json({ ok: false, error: 'Bad scan id' })
    const clean = cleanJob(job)
    if (!clean.cards.length || clean.cards.length > 2) return res.status(400).json({ ok: false, error: 'Print 1 or 2 cards at a time' })
    const hash = createHash('sha1').update(JSON.stringify(clean)).digest('hex')
    const before = printed.get(hash)
    if (before && !again) return res.status(409).json({ ok: false, already: before })
    if (printing) return res.status(423).json({ ok: false, error: 'The printer is busy with another card — try again in a moment' })
    printing = true
    try {
      const r = await cardJob(clean, 'print', join(JOBS, id, `print-${Date.now().toString(36)}`))
      printed.set(hash, { at: Date.now(), numbers: r.numbers })
      console.log(`[cards] printed ${r.numbers.join(' + ')} for ${clean.customer.name}`)
      res.json({ ok: true, numbers: r.numbers })
    } catch (err) {
      console.error('[cards] print failed', err)
      res.status(500).json({ ok: false, error: String(err.message || err) })
    } finally {
      printing = false
    }
  })

  app.get('/cards/file/:id/:sub?/:name', (req, res) => {
    const { id, sub, name } = req.params
    if (!ID_RE.test(id) || (sub && !/^[\w-]+$/.test(sub)) || !/^[\w.-]+\.(png|jpg)$/.test(name)) return res.sendStatus(404)
    const file = join(JOBS, id, ...(sub ? [sub] : []), name)
    if (!existsSync(file)) return res.sendStatus(404)
    res.sendFile(file)
  })
}

// ── the phone page ─────────────────────────────────────────────────────────
const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1c1917">
<title>Guarantee Cards</title>
<style>
  :root { --bg:#f5f5f4; --card:#fff; --ink:#1c1917; --muted:#78716c; --line:#e7e5e4; --accent:#b45309; --ok:#15803d; --bad:#b91c1c; --warn:#fef3c7; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0c0a09; --card:#1c1917; --ink:#f5f5f4; --muted:#a8a29e; --line:#292524; --accent:#f59e0b; --ok:#4ade80; --bad:#f87171; --warn:#422006; } }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; padding:16px 16px 120px; max-width:640px; margin-inline:auto }
  h1 { font-size:20px; margin:4px 0 16px }
  .big { display:flex; gap:10px }
  .btn { appearance:none; border:0; border-radius:12px; padding:14px 18px; font:600 16px system-ui; background:var(--ink); color:var(--bg); cursor:pointer }
  .btn.alt { background:var(--card); color:var(--ink); border:1px solid var(--line) }
  .btn.print { background:var(--accent); color:#fff; width:100%; font-size:18px; padding:16px }
  .btn:disabled { opacity:.5 }
  .big .btn { flex:1; padding:22px 10px; font-size:18px }
  .box { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px; margin:14px 0 }
  .muted { color:var(--muted); font-size:14px }
  .err { color:var(--bad); font-weight:600 }
  .ok { color:var(--ok); font-weight:700 }
  .warn { background:var(--warn); border-radius:10px; padding:10px 12px; font-size:14px; margin:10px 0 }
  label { display:block; font-size:13px; color:var(--muted); margin-top:8px }
  input, select { width:100%; font:16px system-ui; padding:10px; border-radius:9px; border:1px solid var(--line); background:var(--bg); color:var(--ink) }
  .row { display:grid; grid-template-columns:1fr 1fr; gap:8px }
  .row3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px }
  .item { border-top:1px dashed var(--line); padding-top:10px; margin-top:10px }
  .item.off { opacity:.55 }
  .slot { font-weight:700; margin:0 0 8px }
  .slot b { color:var(--accent) }
  .cards { display:grid; grid-template-columns:1fr 1fr; gap:10px }
  .cards img { width:100%; border-radius:8px; border:1px solid var(--line); background:#fff }
  .thumb { max-width:100%; max-height:220px; border-radius:10px; display:block; margin:auto }
  .spin { display:inline-block; width:18px; height:18px; border:3px solid var(--line); border-top-color:var(--accent); border-radius:50%; animation:s 1s linear infinite; vertical-align:-3px; margin-right:8px }
  @keyframes s { to { transform:rotate(360deg) } }
  .stale { opacity:.35 }
  .x { float:right; background:none; border:0; color:var(--bad); font:600 14px system-ui; cursor:pointer }
</style>
</head>
<body>
<h1>Guarantee Cards</h1>
<div class="big">
  <button class="btn" onclick="pick(true)">📷 Bill photo</button>
  <button class="btn alt" onclick="pick(false)">🖼 Gallery</button>
</div>
<input id="cam" type="file" accept="image/*" capture="environment" hidden>
<input id="gal" type="file" accept="image/*" hidden>
<div id="app"></div>
<script>
const $ = (s) => document.querySelector(s)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]))
let S = null // { id, photo, customer, date, items, skipped, unsure, previews, printed:{}, busy, msg }

function pick(camera) { (camera ? $('#cam') : $('#gal')).click() }
for (const el of [$('#cam'), $('#gal')]) el.onchange = () => { const f = el.files[0]; el.value = ''; if (f) start(f) }

/** Phone photos are huge; 2000px is plenty to read handwriting and quick to send. */
function shrink(file) {
  return new Promise((ok, bad) => {
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, 2000 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      ok(c.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => bad(new Error('Could not open that photo'))
    img.src = URL.createObjectURL(file)
  })
}

async function post(url, body) {
  const r = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({ ok:false, error:'No answer from the shop PC' }))
  j.status = r.status
  return j
}

async function start(file) {
  let photo
  try { photo = await shrink(file) } catch (e) { S = { msg:{ err:e.message } }; return draw() }
  S = { photo, busy:'Reading the bill…', t0:Date.now(), printed:{} }
  draw()
  const tick = setInterval(() => { if (S?.busy?.startsWith('Reading')) draw() ; else clearInterval(tick) }, 1000)
  const r = await post('/cards/read', { image: photo.split(',')[1], mediaType:'image/jpeg' })
  clearInterval(tick)
  if (!r.ok) { S.busy = null; S.msg = { err:'Could not read the bill: ' + r.error }; S.id = r.id; S.customer = { name:'', mobile:'', uid:'' }; S.items = []; S.skipped = []; S.unsure = []; return draw() }
  Object.assign(S, { id:r.id, customer:r.bill.customer, date:r.bill.date, items:r.bill.items, skipped:r.bill.skipped || [], unsure:r.bill.unsure || [], busy:null })
  preview()
}

/** One card per brand + period — each has its own pre-printed back. */
function cards() {
  const groups = []
  for (const it of S.items) {
    const years = Number(it.years) || 0
    if (!years || !it.brand.trim()) continue
    // A door's design code ("… 158") does not change which pre-printed card it goes on.
    const key = it.brand.trim().toLowerCase().replace(/(\s+\S*\d\S*)+$/, '') + '|' + years
    let g = groups.find((x) => x.key === key)
    if (!g) groups.push(g = { key, brand: it.brand.trim(), years, items: [] })
    g.items.push(it)
  }
  return groups
}
function job(list) {
  return { date: S.date, customer: S.customer, cards: list.map((g) => ({ years: g.years, items: g.items })) }
}

async function preview() {
  const list = cards()
  S.previews = null
  if (!list.length) { S.msg = { err:'No guarantee items found. Add one below.' }; return draw() }
  S.busy = 'Making card previews…'; S.msg = null; draw()
  const r = await post('/cards/preview', { id:S.id, job:job(list) })
  S.busy = null
  if (!r.ok) S.msg = { err:r.error }
  else S.previews = r.cards
  S.dirty = false
  draw()
}

async function print(pass, again) {
  const list = cards().slice(pass * 2, pass * 2 + 2)
  S.busy = 'Printing…'; S.msg = null; draw()
  const r = await post('/cards/print', { id:S.id, job:job(list), again: !!again })
  S.busy = null
  if (r.status === 409) {
    const mins = Math.round((Date.now() - r.already.at) / 60000)
    if (confirm('These cards were already printed ' + (mins ? mins + ' min ago' : 'just now') + ' (' + r.already.numbers.join(', ') + '). Print them AGAIN with new numbers?')) return print(pass, true)
    return draw()
  }
  if (!r.ok) S.msg = { err:'Print failed: ' + r.error }
  else { S.printed[pass] = r.numbers; S.msg = { ok:'Printed ' + r.numbers.join(' + ') + ' ✓' } }
  draw()
}

function set(path, v) {
  const [a, i, k] = path.split('.')
  if (a === 'items') S.items[i][k] = v
  else if (a === 'customer') S.customer[i] = v
  else S[a] = v
  // The form stays as typed; only the previews go stale until they are remade.
  if (!S.dirty) { S.dirty = true; draw() }
}
function addItem() { S.items.push({ brand:'', thickness:'19MM', size:'', length:'', height:'', qty:1, amount:null, years:0 }); S.dirty = true; draw() }
function delItem(i) { S.items.splice(i, 1); S.dirty = true; draw() }

function field(label, path, value, type = 'text', extra = '') {
  return '<label>' + label + '<input type="' + type + '" value="' + esc(value) + '" ' + extra + ' onchange="set(\\'' + path + '\\', this.value)"></label>'
}

function draw() {
  const a = $('#app')
  if (!S) { a.innerHTML = '<p class="muted" style="margin-top:20px">Take a photo of the bill. The cards are ready to check in about 20 seconds.</p>'; return }
  let h = ''
  if (S.photo) h += '<div class="box"><img class="thumb" src="' + S.photo + '"></div>'
  if (S.busy) h += '<div class="box"><span class="spin"></span>' + S.busy + (S.busy.startsWith('Reading') ? ' ' + Math.round((Date.now() - S.t0) / 1000) + 's' : '') + '</div>'
  if (S.msg?.err) h += '<div class="box err">' + esc(S.msg.err) + '</div>'
  if (S.msg?.ok) h += '<div class="box ok">' + esc(S.msg.ok) + '</div>'
  if (S.unsure?.length) h += '<div class="warn"><b>Check:</b> ' + S.unsure.map(esc).join(' · ') + '</div>'

  if (S.customer && !S.busy?.startsWith('Reading')) {
    const list = cards()
    // Previews, two to a pass — the tray holds two cards.
    if (S.dirty) h += '<button class="btn print" onclick="preview()"' + (S.busy ? ' disabled' : '') + '>↻ Update preview</button>'
    if (S.previews) {
      for (let p = 0; p * 2 < list.length; p++) {
        const pair = list.slice(p * 2, p * 2 + 2)
        h += '<div class="box' + (S.dirty ? ' stale' : '') + '">'
        if (list.length > 2) h += '<p class="muted">Print ' + (p + 1) + ' of ' + Math.ceil(list.length / 2) + '</p>'
        pair.forEach((g, k) => { h += '<p class="slot">Slot ' + (k + 1) + ' → put the <b>' + esc(g.brand) + ' · ' + g.years + ' Yrs</b> card</p>' })
        h += '<div class="cards">' + pair.map((g, k) => '<img src="' + S.previews[p * 2 + k]?.url + '">').join('') + '</div><br>'
        h += S.printed[p]
          ? '<p class="ok">Printed ' + S.printed[p].join(' + ') + ' ✓</p><button class="btn alt" onclick="print(' + p + ', true)"' + (S.busy ? ' disabled' : '') + '>Print again</button>'
          : '<button class="btn print" onclick="print(' + p + ')"' + (S.busy || S.dirty ? ' disabled' : '') + '>🖨 Print ' + (pair.length === 2 ? 'both cards' : 'card') + '</button>'
        h += '</div>'
      }
    }

    h += '<div class="box"><b>Customer</b>'
    h += field('Name', 'customer.name', S.customer.name)
    h += '<div class="row">' + field('Mobile', 'customer.mobile', S.customer.mobile, 'tel', 'inputmode="numeric"') + field('UID', 'customer.uid', S.customer.uid) + '</div>'
    h += field('Date', 'date', S.date, 'date')
    h += '</div>'

    h += '<div class="box"><b>Items on the cards</b>'
    S.items.forEach((it, i) => {
      h += '<div class="item' + (Number(it.years) ? '' : ' off') + '"><button class="x" onclick="delItem(' + i + ')">Remove</button>'
      h += field('Brand', 'items.' + i + '.brand', it.brand)
      h += '<div class="row3">' + field('Thickness', 'items.' + i + '.thickness', it.thickness) + field('Size (feet)', 'items.' + i + '.size', it.size) + field('Years', 'items.' + i + '.years', it.years, 'number', 'inputmode="numeric"') + '</div>'
      if (it.length || it.height || !it.size) h += '<div class="row">' + field('Length (inches)', 'items.' + i + '.length', it.length) + field('Height (inches)', 'items.' + i + '.height', it.height) + '</div>'
      h += '<div class="row">' + field('Qty', 'items.' + i + '.qty', it.qty ?? '', 'number', 'inputmode="numeric"') + field('Amount ₹', 'items.' + i + '.amount', it.amount ?? '', 'number', 'inputmode="decimal"') + '</div>'
      if (!Number(it.years)) h += '<p class="muted">No guarantee years — not on a card. Set years to add it.</p>'
      h += '</div>'
    })
    h += '<br><button class="btn alt" onclick="addItem()">+ Add item</button></div>'
    if (S.skipped?.length) h += '<p class="muted">Not on cards: ' + S.skipped.map(esc).join(', ') + '</p>'
  }
  a.innerHTML = h
}
draw()
</script>
</body>
</html>`
