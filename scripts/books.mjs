#!/usr/bin/env node
/**
 * The books from the command line: look a party up, find duplicates, merge,
 * bin a wrong entry, fix a date or an amount, add a discount.
 *
 * Built the day the duplicate customers were cleaned up by hand (2 Nov 2026):
 * what took an hour of one-off scripts is one line each here. It talks to the
 * deployment in .env.local with this PC's Convex login, and calls the shop's
 * own functions as one of the shop's trusted devices (the most recently used
 * Windows panel, or BOOKS_DEVICE=<id>), so every change is the same change the
 * panel would make: binned entries can be restored, history records it, and
 * the nightly check lists it for accepting.
 *
 *   npm run books -- find "harish kumar"         every entry, running balance, bill lines
 *   npm run books -- find 8409085535             by phone
 *   npm run books -- photos "bunty sharma"       saves the bill photos, prints the folder
 *   npm run books -- dupes                       likely duplicate customers
 *   npm run books -- merge <keep> <absorb>...    dry run; add --yes to do it
 *   npm run books -- bin <voucherId>...          to the bin (restorable)
 *   npm run books -- date <voucherId> 2026-07-17 ["note"]
 *   npm run books -- amount <voucherId> 274436 ["note"]
 *   npm run books -- discount <party> 736 2026-07-31 "why"
 *   npm run books -- run <module:function> '{"json":"args"}'
 *   npm run books -- pin device|ledger <new pin>
 *
 * A party is an id, a phone number, or words from its name (must match one).
 */
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'node_modules', 'convex', 'bin', 'main.js')
const run = promisify(execFile)

async function convex(args) {
  try {
    const { stdout } = await run(process.execPath, [CLI, ...args], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 })
    return stdout
  } catch (err) {
    const said = String(err.stderr || err.message).split('\n').filter((l) => /Error|error|✖/.test(l)).join('\n')
    throw new Error(said || String(err.message))
  }
}

const cache = new Map()
/** A whole table, a page of 8000 rows at most (the CLI's limit). */
function table(name) {
  if (!cache.has(name)) {
    cache.set(name, convex(['data', name, '--limit', '8000', '--format', 'jsonl']).then((out) =>
      out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l))))
  }
  return cache.get(name)
}

let deviceId = process.env.BOOKS_DEVICE
async function device() {
  if (deviceId) return deviceId
  const devices = await table('trustedDevices')
  const pick = devices.filter((d) => /Windows · Panel/.test(d.name ?? '')).sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))[0]
    ?? devices.sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))[0]
  if (!pick) throw new Error('No trusted device to act as.')
  return (deviceId = pick._id)
}

const parse = (out) => { try { return JSON.parse(out) } catch { return out.trim() } }
/** A shop function, called as a trusted device. */
const call = async (fn, args = {}) => parse(await convex(['run', fn, JSON.stringify(args), '--identity', JSON.stringify({ subject: await device() })]))
/** An internal function (merge:accounts and the like). */
const callInternal = async (fn, args = {}) => parse(await convex(['run', fn, JSON.stringify(args)]))

const day = (ms) => new Date(ms).toISOString().slice(0, 10)
const inr = (n) => `₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`
const side = (n) => (n > 0 ? `${inr(n)} owed to the shop` : n < 0 ? `${inr(n)} in his favour` : '₹0')
function dateArg(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '')
  if (!m) throw new Error(`Give the date as YYYY-MM-DD, not "${s}".`)
  return Date.UTC(+m[1], +m[2] - 1, +m[3])
}

async function parties(ref) {
  const ledgers = (await table('ledgers')).filter((l) => l.active !== false)
  const byId = ledgers.find((l) => l._id === ref)
  if (byId) return [byId]
  if (/^\d{10}$/.test(ref)) return ledgers.filter((l) => l.phone === ref)
  const words = ref.toLowerCase().split(/\s+/).filter(Boolean)
  return ledgers.filter((l) => words.every((w) => l.name.toLowerCase().includes(w)))
}
async function oneParty(ref) {
  const hits = await parties(ref)
  if (hits.length !== 1) throw new Error(hits.length ? `"${ref}" matches ${hits.length}: ${hits.map((l) => l.name).join('; ')}` : `No account matches "${ref}".`)
  return hits[0]
}

async function entriesOf(ledger) {
  const [vouchers, lines, types] = await Promise.all([table('vouchers'), table('voucherEntries'), table('voucherTypes')])
  const typeName = Object.fromEntries(types.map((t) => [t._id, t.name]))
  const byId = new Map(vouchers.map((v) => [v._id, v]))
  const mine = lines.filter((e) => e.ledgerId === ledger._id)
  const ids = [...new Set(mine.map((e) => e.voucherId))]
  return ids.map((id) => {
    const v = byId.get(id)
    const net = mine.filter((e) => e.voucherId === id).reduce((n, e) => n + (e.side === 'Dr' ? e.amount : -e.amount), 0)
    return { v, net, type: typeName[v?.typeId] ?? '?' }
  }).filter((x) => x.v).sort((a, b) => a.v.date - b.v.date)
}

async function find(ref) {
  const hits = await parties(ref)
  if (!hits.length) return console.log(`No account matches "${ref}".`)
  const [billLines, bills] = await Promise.all([table('billLines'), table('bills')])
  for (const l of hits) {
    const opening = l.openingSide === 'Cr' ? -l.openingBalance : l.openingBalance
    console.log(`\n${l.name}   ${l.phone ?? 'no phone'}   ${l._id}`)
    if (opening) console.log(`  opening ${side(opening)}`)
    let bal = opening
    for (const { v, net, type } of await entriesOf(l)) {
      bal += net
      const photo = v.attachments?.length ? ' [photo]' : ''
      console.log(`  ${day(v.date)}  ${type.padEnd(12)} #${String(v.voucherNo).padEnd(5)} ${net >= 0 ? 'Dr' : 'Cr'} ${inr(net).padStart(10)}   bal ${side(bal)}   ${v.refNo ?? ''} ${v.narration ?? ''}${photo}   ${v._id}`)
      for (const b of billLines.filter((b) => b.voucherId === v._id).sort((a, b) => a.lineNo - b.lineNo)) console.log(`        · ${b.qty ?? ''} ${b.desc} ${b.amount}`)
      const bill = bills.map((r) => r.bill).find((b) => b?.voucherId === v._id)
      for (const it of bill?.items ?? []) if (it.description && !it.amountOnly) console.log(`        · ${it.qty ?? ''} ${it.unit ?? ''} ${it.description} ${it.amount}`)
    }
    console.log(`  NOW: ${side(bal)}`)
  }
}

async function photos(ref) {
  const l = await oneParty(ref)
  const shots = (await entriesOf(l)).flatMap(({ v, type }) => (v.attachments ?? []).map((a, i) => ({
    name: `${day(v.date)}_${type.replace(/\s/g, '')}${v.voucherNo}${i ? `_${i + 1}` : ''}`,
    id: typeof a === 'string' ? a : a.previewStorageId ?? a.storageId,
  })))
  if (!shots.length) return console.log(`${l.name}: no bill photos.`)
  const urls = await call('files:describe', { storageIds: shots.map((s) => s.id) })
  const dir = join(tmpdir(), 'shiv-books', l.name.replace(/[^A-Za-z0-9]+/g, '-'))
  mkdirSync(dir, { recursive: true })
  for (const s of shots) {
    const u = urls.find((x) => x.storageId === s.id)
    if (!u?.url) continue
    const ext = /png/.test(u.contentType ?? '') ? 'png' : /jpe?g/.test(u.contentType ?? '') ? 'jpg' : 'webp'
    writeFileSync(join(dir, `${s.name}.${ext}`), Buffer.from(await (await fetch(u.url)).arrayBuffer()))
  }
  console.log(`${shots.length} photos of ${l.name} in:\n${dir}`)
}

async function dupes() {
  const [ledgers, lines] = await Promise.all([table('ledgers'), table('voucherEntries')])
  const bal = {}
  for (const e of lines) bal[e.ledgerId] = (bal[e.ledgerId] ?? 0) + (e.side === 'Dr' ? e.amount : -e.amount)
  const norm = (s) => s.toLowerCase().replace(/m\/s\.?|\bshri\b|\bsri\b|\bjee\b|\bji\b|[.()&]/g, ' ').replace(/[^a-z0-9, ]/g, '').replace(/\s+/g, ' ').trim()
  const skel = (s) => s.replace(/[aeiouy\s]/g, '').replace(/(.)\1+/g, '$1')
  const rows = ledgers.filter((l) => l.active !== false).map((l) => ({ l, who: norm(l.name).split(',')[0].trim() }))
  const pairs = []
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i]; const b = rows[j]
    if (a.l.groupId !== b.l.groupId) continue
    const phone = a.l.phone && a.l.phone === b.l.phone
    const name = a.who.length > 3 && skel(a.who) === skel(b.who)
    if (phone || name) pairs.push([a.l, b.l, phone ? 'same phone' : 'similar name'])
  }
  const money = (l) => bal[l._id] ?? 0
  pairs.sort((x, y) => Math.abs(money(y[0])) + Math.abs(money(y[1])) - Math.abs(money(x[0])) - Math.abs(money(x[1])))
  for (const [a, b, why] of pairs) console.log(`- ${why}\n    ${a.name} [${a.phone ?? '-'}] ${side(money(a))}  ${a._id}\n    ${b.name} [${b.phone ?? '-'}] ${side(money(b))}  ${b._id}`)
  console.log(`\n${pairs.length} pairs, the most money first. Check with: npm run books -- find "<name>"`)
}

async function merge(refs, yes) {
  if (refs.length < 2) throw new Error('merge <keep> <absorb> [<absorb>...]')
  const keep = await oneParty(refs[0])
  const pairs = []
  for (const r of refs.slice(1)) pairs.push({ keep: keep._id, absorb: (await oneParty(r))._id })
  const out = await callInternal('merge:accounts', { pairs, dryRun: !yes })
  for (const m of out.merged) console.log(`${yes ? 'Merged' : 'Would merge'} ${m.absorbed} → ${m.kept}: ${m.vouchers} vouchers, ${m.entries} lines, opening ${m.opening}`)
  if (!yes) console.log('Dry run. Add --yes to do it.')
}

async function voucher(id) {
  const v = (await table('vouchers')).find((x) => x._id === id)
  if (!v) throw new Error(`No voucher ${id}. Ids are shown by: npm run books -- find "<name>"`)
  return v
}

const [cmd, ...rest] = process.argv.slice(2)
const yes = rest.includes('--yes')
const args = rest.filter((a) => a !== '--yes')

try {
  switch (cmd) {
    case 'find': await find(args.join(' ')); break
    case 'photos': await photos(args.join(' ')); break
    case 'dupes': await dupes(); break
    case 'merge': await merge(args, yes); break
    case 'bin':
      for (const id of args) { await voucher(id); await call('vouchers:remove', { id }); console.log(`Binned ${id}`) }
      break
    case 'date': {
      const [id, when, ...note] = args
      await voucher(id)
      await call('vouchers:update', { id, date: dateArg(when), ...(note.length ? { narration: note.join(' ') } : {}) })
      console.log(`${id} now dated ${when}`)
      break
    }
    case 'amount': {
      const [id, amount, ...note] = args
      const v = await voucher(id)
      const lines = (await table('voucherEntries')).filter((e) => e.voucherId === id)
      const other = lines.find((e) => e.ledgerId !== v.partyLedgerId)
      if (lines.length !== 2 || !other) throw new Error('Only a two-line entry can be changed here; a bill is changed in the panel.')
      await call('vouchers:edit', { id, date: v.date, partyLedgerId: v.partyLedgerId, accountLedgerId: other.ledgerId, amount: Number(amount), narration: note.length ? note.join(' ') : v.narration })
      console.log(`${id} now ${inr(Number(amount))}`)
      break
    }
    case 'discount': {
      const [ref, amount, when, ...note] = args
      const party = await oneParty(ref)
      const account = (await table('ledgers')).find((l) => l.name === 'Discount Allowed')
      if (!account) throw new Error('No "Discount Allowed" account in the books.')
      const id = await call('vouchers:createGoodsReturn', { date: dateArg(when), partyLedgerId: party._id, returnLedgerId: account._id, amount: Number(amount), typeName: 'Discount', narration: note.join(' ') || undefined })
      console.log(`Discount ${inr(Number(amount))} on ${party.name}, ${when}: ${id}`)
      break
    }
    case 'run': {
      const [fn, json] = args
      console.log(JSON.stringify(await call(fn, json ? JSON.parse(json) : {}), null, 2))
      break
    }
    case 'pin': {
      const [which, pin] = args
      const name = { device: 'DEVICE_PIN', ledger: 'LEDGER_PIN' }[which]
      if (!name || !pin) throw new Error('pin device <new>   (the PIN a phone or PC types once)\npin ledger <new>   (the PIN for deleting and emptying the bin)')
      await convex(['env', 'set', name, pin])
      console.log(`${name} changed. Devices already trusted stay trusted; new ones need the new PIN.`)
      break
    }
    default:
      console.log(`npm run books -- find <party>              every entry, running balance
npm run books -- photos <party>            save the bill photos
npm run books -- dupes                     likely duplicate customers
npm run books -- merge <keep> <absorb>...  dry run; --yes to do it
npm run books -- bin <voucherId>...        to the bin (restorable)
npm run books -- date <voucherId> YYYY-MM-DD ["note"]
npm run books -- amount <voucherId> <amount> ["note"]
npm run books -- discount <party> <amount> YYYY-MM-DD "why"
npm run books -- run <module:function> '<json>'
npm run books -- pin device|ledger <new pin>
A party is an id, a 10-digit phone, or words from its name.`)
  }
} catch (err) {
  console.error(err.message ?? err)
  process.exit(1)
}
