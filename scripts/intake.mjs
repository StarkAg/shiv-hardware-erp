#!/usr/bin/env node
/** Any task and local images -> this Codex chat -> site reply. No separate AI API. */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const jobsRoot = join(root, '.intake', 'jobs')
const siteRoot = join(root, 'intake-web')
const maxPhotos = 12
const maxBody = 48 * 1024 * 1024
const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }

function options(args) {
  const out = { _: [] }
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) { out._.push(args[i]); continue }
    const key = args[i].slice(2)
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Missing value for --${key}`)
    if (key === 'image') (out.image ??= []).push(args[++i])
    else out[key] = args[++i]
  }
  return out
}

function jobPath(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw Error('Invalid request ID')
  return join(jobsRoot, id, 'job.json')
}
async function readJob(id) { return JSON.parse(await readFile(jobPath(id), 'utf8')) }
async function saveJob(job) { await writeFile(jobPath(job.id), JSON.stringify(job, null, 2) + '\n') }
async function latestJob() {
  const ids = await readdir(jobsRoot).catch(() => [])
  const jobs = (await Promise.all(ids.map(id => readJob(id).catch(() => null)))).filter(Boolean)
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
}

function envUrl() {
  const text = readFile(join(root, '.env.local'), 'utf8')
  return text.then(data => {
    const url = data.match(/^VITE_CONVEX_URL=(.*)$/m)?.[1]?.trim()
    if (!url?.startsWith('https://')) throw Error('VITE_CONVEX_URL is missing from .env.local')
    return url.replace(/\/+$/, '')
  })
}

// This PC's server key from the trusted-device list (convex/devices.ts),
// SHIV_DEVICE_TOKEN in .env.local.
const deviceToken = readFile(join(root, '.env.local'), 'utf8')
  .then(data => data.match(/^SHIV_DEVICE_TOKEN=(.*)$/m)?.[1]?.trim() || '')
  .catch(() => '')

async function convex(url, type, path, args) {
  const token = await deviceToken
  const response = await fetch(`${url}/api/${type}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ path, args, format: 'json' }),
  })
  const result = await response.json()
  if (!response.ok || result.status !== 'success') throw Error(`${path}: ${result.errorMessage || JSON.stringify(result)}`)
  return result.value
}

function runCodex(thread, message) {
  return new Promise((done, fail) => {
    const args = ['queue', '--thread', thread, '--message', message]
    const child = spawn('codex', args, { cwd: root, shell: false })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    child.on('error', fail)
    child.on('close', code => code === 0 ? done(output.trim()) : fail(Error(output.trim() || `codex queue exited ${code}`)))
  })
}

function intakePrompt(job) {
  return [
    `Shiv task intake request ${job.id}. Any images are saved on this computer at the paths below. Read each one with the local view_image tool before interpreting it.`,
    ...job.photos.map((path, index) => `Image ${index + 1}: ${path}`),
    `User request: ${job.note || 'Interpret these images and use the current chat context to determine the requested task. Ask the user if the action is unclear.'}`,
    `Local request file: ${jobPath(job.id)}`,
    'Handle the user request in this chat using the available repo tools and CLIs. For supplier purchases or payments, this CLI has validate and post commands. Check existing records before changing them; an amount due is not a payment. If a required detail is unclear, ask in this chat.',
    `After finishing or when input is required, run: node scripts/intake.mjs reply --id ${job.id} --text "<concise result or specific question>". The site reads that reply. Also answer in this chat.`,
  ].join('\n')
}

async function makeJob({ thread, note, photos }) {
  if (!thread || !/^[0-9a-f-]{36}$/.test(thread)) throw Error('A Codex chat ID is required')
  if (!Array.isArray(photos) || photos.length > maxPhotos) throw Error(`Choose at most ${maxPhotos} images`)
  if (!String(note || '').trim() && !photos.length) throw Error('Add a request or choose at least one image')
  const id = randomUUID()
  const dir = join(jobsRoot, id)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const paths = []
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i]
    const extension = extensions[photo.type]
    if (!extension) throw Error(`Unsupported image type: ${photo.type}`)
    const path = join(dir, `${String(i + 1).padStart(2, '0')}${extension}`)
    if (photo.path) await copyFile(photo.path, path)
    else await writeFile(path, photo.bytes, { mode: 0o600 })
    paths.push(path)
  }
  const job = { id, thread, note: String(note || '').slice(0, 3000), photos: paths, status: 'sending', createdAt: new Date().toISOString(), reply: '' }
  await saveJob(job)
  try {
    await runCodex(thread, intakePrompt(job))
    const current = await readJob(id)
    if (current.status === 'answered') return current
    job.status = 'sent'
  } catch (error) {
    job.status = 'failed'
    job.reply = String(error.message || error)
  }
  await saveJob(job)
  return job
}

async function retryJob(id) {
  const job = await readJob(id)
  if (job.status !== 'failed') throw Error('Only failed requests can be retried')
  job.status = 'sending'; job.reply = ''; await saveJob(job)
  try {
    await runCodex(job.thread, intakePrompt(job))
    const current = await readJob(id)
    if (current.status === 'answered') return current
    job.status = 'sent'
  }
  catch (error) { job.status = 'failed'; job.reply = String(error.message || error) }
  await saveJob(job)
  return job
}

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(body))
}

async function bodyJson(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBody) throw Error('Images exceed the 48 MB request limit')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function serve({ thread, port = '8787' }) {
  if (!thread || !/^[0-9a-f-]{36}$/.test(thread)) throw Error('Start with --thread <this Codex chat ID>')
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname
      if (req.method === 'POST' && path === '/submit') {
        const origin = req.headers.origin
        if (origin && origin !== `http://127.0.0.1:${port}`) throw Error('This request must come from the local intake page')
        if (!req.headers['content-type']?.startsWith('application/json')) throw Error('Expected JSON')
        const data = await bodyJson(req)
        const photos = (data.photos ?? []).map(photo => {
          if (typeof photo.data !== 'string') throw Error('Missing image data')
          const bytes = Buffer.from(photo.data, 'base64')
          if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw Error('Each image must be under 12 MB')
          const valid = photo.type === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8
            : photo.type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              : photo.type === 'image/webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' : false
          if (!valid) throw Error('Image content does not match its file type')
          return { type: photo.type, bytes }
        })
        const job = await makeJob({ thread, note: data.note, photos })
        return sendJson(res, job.status === 'sent' ? 201 : 502, { id: job.id, status: job.status, reply: job.reply })
      }
      if (req.method === 'POST' && /^\/retry\/[0-9a-f-]{36}$/.test(path)) {
        const origin = req.headers.origin
        if (origin && origin !== `http://127.0.0.1:${port}`) throw Error('This request must come from the local intake page')
        const job = await retryJob(path.slice(7))
        return sendJson(res, job.status === 'sent' ? 200 : 502, { id: job.id, status: job.status, reply: job.reply })
      }
      if (req.method === 'GET' && /^\/status\/[0-9a-f-]{36}$/.test(path)) {
        const job = await readJob(path.slice(8))
        return sendJson(res, 200, { id: job.id, status: job.status, reply: job.reply, createdAt: job.createdAt })
      }
      if (req.method === 'GET' && path === '/latest') {
        const job = await latestJob()
        return sendJson(res, 200, job ? { id: job.id, status: job.status, reply: job.reply, createdAt: job.createdAt } : null)
      }
      const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] }
      if (req.method === 'GET' && assets[path]) {
        const [file, type] = assets[path]
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'" })
        return res.end(await readFile(join(siteRoot, file)))
      }
      sendJson(res, 404, { error: 'Not found' })
    } catch (error) { sendJson(res, 400, { error: error.message || String(error) }) }
  })
  server.listen(Number(port), '127.0.0.1', () => console.log(`Shiv task intake: http://127.0.0.1:${port}`))
}

function money(value, label) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0 || Math.abs(Math.round(n * 100) - n * 100) > 0.000001) throw Error(`${label} must be a positive amount with at most two decimals`)
  return n
}

const foldLine = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')

function isoDate(value, label) {
  const date = new Date(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw Error(`${label} needs a valid YYYY-MM-DD date`)
  return value
}

function validate(manifest) {
  if (!manifest || typeof manifest !== 'object') throw Error('Manifest must be an object')
  if (!String(manifest.supplier || '').trim()) throw Error('supplier is required')
  const entries = []
  for (const [kind, list] of [['purchase', manifest.purchases ?? []], ['payment', manifest.payments ?? []]]) {
    if (!Array.isArray(list)) throw Error(`${kind}s must be an array`)
    for (const [index, entry] of list.entries()) {
      const label = `${kind} ${index + 1}`
      if (!String(entry.ref || '').trim()) throw Error(`${label} needs the supplier invoice or payment reference`)
      isoDate(entry.date, label)
      money(entry.total ?? entry.amount, label)
      if (kind === 'purchase') {
        if (entry.total === undefined) throw Error(`${label} needs total`)
        if (!Array.isArray(entry.items) || !entry.items.length) throw Error(`${label} needs item lines`)
        const sum = entry.items.reduce((total, item, i) => {
          if (!String(item.description || '').trim() || !(Number(item.qty) > 0)) throw Error(`${label} item ${i + 1} needs description and quantity`)
          const amount = money(item.amount, `${label} item ${i + 1}`)
          if (item.sqftRate !== undefined && item.sqft !== undefined && Math.abs(item.qty * item.sqft * item.sqftRate - amount) > 0.01) throw Error(`${label} item ${i + 1} square-foot calculation differs`)
          return total + amount
        }, 0)
        if (Math.abs(sum - entry.total) > 0.01) throw Error(`${label} line total ${sum} differs from ${entry.total}`)
      } else if (!['cash', 'online', 'upi'].includes(entry.mode)) throw Error(`${label} needs mode cash, online, or upi`)
      const photos = [entry.photo, ...(entry.photos ?? [])].filter(Boolean)
      if (!Array.isArray(entry.photos ?? [])) throw Error(`${label} photos must be an array`)
      for (const photo of photos) if (!existsSync(resolve(photo))) throw Error(`${label} photo not found: ${photo}`)
      entries.push({ kind, ...entry, ref: String(entry.ref).trim() })
    }
  }
  if (!entries.length) throw Error('Manifest has no purchases or payments')
  const keys = entries.map(e => `${e.kind}:${e.date}:${e.ref.toLowerCase()}`)
  if (new Set(keys).size !== keys.length) throw Error('Manifest repeats a reference')
  return entries.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'purchase' ? -1 : 1))
}

async function upload(url, path) {
  const extension = extname(path).toLowerCase()
  const type = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
  const target = await convex(url, 'mutation', 'files:generateUploadUrl', {})
  const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': type }, body: await readFile(path) })
  if (!response.ok) throw Error(`Image upload failed: ${response.status}`)
  const { storageId } = await response.json()
  if (!storageId) throw Error('Image upload returned no storage ID')
  return { storageId, kind: 'bill' }
}

async function post(manifest, entries) {
  if (manifest.requestId) await readJob(manifest.requestId)
  const url = await envUrl()
  const firstDay = entries[0].date
  const lastDay = entries[entries.length - 1].date
  const [masters, snapshot, dayBook] = await Promise.all([
    convex(url, 'query', 'masters:all', {}), convex(url, 'query', 'bills:get', {}),
    convex(url, 'query', 'reports:dayBook', { from: Date.parse(`${firstDay}T00:00:00Z`), to: Date.parse(`${lastDay}T23:59:59Z`) }),
  ])
  const supplier = masters.ledgers.find(l => l.name.toLowerCase() === manifest.supplier.trim().toLowerCase() && l.groupName === 'Sundry Creditors')
  if (!supplier) throw Error(`Supplier account not found in Sundry Creditors: ${manifest.supplier}`)
  const bills = snapshot?.bills ?? []
  const outputs = []
  for (const entry of entries) {
    const amount = Number(entry.total ?? entry.amount)
    if (entry.kind === 'purchase' && entry.existingBillNumber) {
      const existing = bills.find(b => String(b.number) === String(entry.existingBillNumber) && b.kind === 'purchase' && (b.ledgerId === supplier._id || String(b.customerName || '').toLowerCase() === supplier.name.toLowerCase()))
      if (!existing) throw Error(`Existing purchase bill ${entry.existingBillNumber} was not found for ${supplier.name}`)
      if (Number(existing.total) !== amount || existing.date !== entry.date) throw Error(`Existing purchase bill ${entry.existingBillNumber} has a different date or total`)
      const already = existing.ref === entry.ref && existing.items?.length === entry.items.length && entry.items.every((item, i) => existing.items[i]?.qty === Number(item.qty) && existing.items[i]?.amount === Number(item.amount) && foldLine(existing.items[i]?.description) === foldLine(item.description))
      if (already) { outputs.push({ kind: entry.kind, ref: entry.ref, amount, bill: existing.number, status: 'already reconciled' }); continue }
      const lump = existing.items?.length === 1 && /^(bill|goods|amount|balance)$/i.test(String(existing.items[0]?.description || '').trim())
      if (!lump) throw Error(`Existing purchase bill ${entry.existingBillNumber} already has item detail; review it manually before replacing lines`)
      const key = createHash('sha256').update(`${supplier._id}:reconcile:${existing.id}`).digest('hex').slice(0, 24)
      const attachments = await Promise.all([entry.photo, ...(entry.photos ?? [])].filter(Boolean).map(path => upload(url, resolve(path))))
      const items = entry.items.map((item, index) => ({
        id: `${key}-${index}`, description: item.description, qty: Number(item.qty), unit: item.unit || 'Pc', amount: Number(item.amount),
        ...(item.sqft !== undefined ? { sqft: Number(item.sqft), sqftRate: Number(item.sqftRate), rateSqft: Number(item.amount) / Number(item.qty) } : {}),
      }))
      const bill = { ...existing, ref: entry.ref, notes: entry.note || `Supplier invoices ${entry.ref}`, items }
      const result = await convex(url, 'mutation', 'billLedger:postBill', { bill, attachments, keepAsBill: true })
      bills.splice(bills.indexOf(existing), 1, result.bill)
      outputs.push({ kind: entry.kind, ref: entry.ref, amount, bill: result.number, status: 'reconciled' })
      console.log(`purchase ${entry.ref}: bill ${result.number} ${amount} reconciled`)
      continue
    }
    const duplicate = bills.find(b => b.kind === entry.kind && (b.ledgerId === supplier._id || String(b.customerName || '').toLowerCase() === supplier.name.toLowerCase()) && b.date === entry.date && String(b.ref || '').trim().toLowerCase() === entry.ref.toLowerCase())
    if (duplicate) {
      if (Number(duplicate.total) !== amount) throw Error(`Existing ${entry.kind} ${entry.ref} has a different total`)
      outputs.push({ kind: entry.kind, ref: entry.ref, amount, bill: duplicate.number, status: 'already posted' })
      continue
    }
    const sameDayAmount = dayBook.find(row => row.partyLedgerId === supplier._id && row.vchType.toLowerCase() === entry.kind && new Date(row.date).toISOString().slice(0, 10) === entry.date && Number(row.amount) === amount)
    if (sameDayAmount && !entry.allowSimilar) throw Error(`${entry.kind} ${entry.ref} resembles existing ${sameDayAmount.vchLabel} on the same day for the same amount; review it before posting, or set allowSimilar: true in the manifest`)
    const key = createHash('sha256').update(`${supplier._id}:${entry.kind}:${entry.date}:${entry.ref.toLowerCase()}`).digest('hex').slice(0, 24)
    const attachments = await Promise.all([entry.photo, ...(entry.photos ?? [])].filter(Boolean).map(path => upload(url, resolve(path))))
    const items = entry.kind === 'purchase' ? entry.items.map((item, index) => ({
      id: `${key}-${index}`, description: item.description, qty: Number(item.qty), unit: item.unit || 'Pc', amount: Number(item.amount),
      ...(item.sqft !== undefined ? { sqft: Number(item.sqft), sqftRate: Number(item.sqftRate), rateSqft: Number(item.amount) / Number(item.qty) } : {}),
    })) : []
    const bill = {
      id: `purchase-pipeline-${key}`, number: '', kind: entry.kind, date: entry.date,
      customerName: supplier.name, ref: entry.ref, items, total: amount, paid: false,
      paidAmount: 0, paymentMode: entry.mode || 'cash',
      ...(entry.kind === 'payment' ? { moneyAmount: amount } : {}),
      notes: entry.note || `${entry.kind === 'purchase' ? 'Supplier invoice' : 'Payment reference'} ${entry.ref}`,
    }
    const result = await convex(url, 'mutation', 'billLedger:postBill', { bill, attachments, keepAsBill: true })
    bills.push(result.bill)
    outputs.push({ kind: entry.kind, ref: entry.ref, amount, bill: result.number, status: 'posted' })
    console.log(`${entry.kind} ${entry.ref}: ${result.number} ${amount} posted`)
  }
  const ledger = await convex(url, 'query', 'reports:ledger', { ledgerId: supplier._id })
  const reply = `${outputs.length} entries checked for ${supplier.name}. ${outputs.map(o => `${o.kind} ${o.ref}: ${o.status} (bill ${o.bill}, INR ${o.amount})`).join('; ')}. Closing balance: INR ${ledger.closing} ${ledger.closingSide}.`
  if (manifest.requestId) {
    const job = await readJob(manifest.requestId)
    job.status = 'answered'
    job.reply = reply
    await saveJob(job)
  }
  return { outputs, closing: ledger.closing, closingSide: ledger.closingSide, reply }
}

async function main() {
  const [command, ...raw] = process.argv.slice(2)
  const opt = options(raw)
  if (command === 'serve') return serve(opt)
  if (command === 'submit') {
    const photos = await Promise.all((opt.image ?? []).map(async path => ({ path: resolve(path), type: ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' })[extname(path).toLowerCase()] })))
    const job = await makeJob({ thread: opt.thread, note: opt.note, photos })
    console.log(JSON.stringify({ id: job.id, status: job.status, reply: job.reply }))
    if (job.status === 'failed') process.exitCode = 1
    return
  }
  if (command === 'retry') {
    const job = await retryJob(opt.id)
    console.log(JSON.stringify({ id: job.id, status: job.status, reply: job.reply }))
    if (job.status === 'failed') process.exitCode = 1
    return
  }
  if (command === 'status') { console.log(JSON.stringify(await readJob(opt.id), null, 2)); return }
  if (command === 'reply') {
    if (!opt.text?.trim()) throw Error('--text is required')
    const job = await readJob(opt.id)
    job.status = 'answered'; job.reply = opt.text.trim(); await saveJob(job)
    console.log(`Reply saved for ${job.id}`); return
  }
  if (command === 'validate' || command === 'post') {
    if (!opt.manifest) throw Error('--manifest <file.json> is required')
    const manifest = JSON.parse(await readFile(resolve(opt.manifest), 'utf8'))
    const entries = validate(manifest)
    if (command === 'validate') { console.log(JSON.stringify({ supplier: manifest.supplier, entries: entries.map(e => ({ kind: e.kind, ref: e.ref, date: e.date, total: e.total ?? e.amount, items: e.items?.length ?? 0, photos: Number(Boolean(e.photo)) + (e.photos?.length ?? 0), existingBillNumber: e.existingBillNumber })) }, null, 2)); return }
    console.log(JSON.stringify(await post(manifest, entries), null, 2)); return
  }
  console.log('Usage: npm run intake -- <serve --thread UUID [--port 8787] | submit --thread UUID --image FILE [--image FILE] [--note TEXT] | retry --id UUID | status --id UUID | validate --manifest FILE | post --manifest FILE | reply --id UUID --text TEXT>')
  if (command) process.exitCode = 1
}

main().catch(error => { console.error(error.message || String(error)); process.exitCode = 1 })
