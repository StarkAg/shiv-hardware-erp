/**
 * Nightly copies of the Shiv Panel books.
 *
 * Runs on Railway as its own service, with a volume at /data. Every night at
 * 02:00 India time it exports every table; on Sundays it takes the bill
 * photos too. Each copy is opened and checked before anything older is
 * thrown away, and every attempt — good or bad — is written back to the
 * books, so Home can say when the last good copy was taken.
 *
 *   /data/daily/     tables, the last 14 nights
 *   /data/monthly/   tables on the 1st, the last 24 months
 *   /data/weekly/    everything including photos, the last 4 Sundays
 *
 * Commands, run from any folder with
 *   railway ssh -p 3204a621-3a84-4ad0-9960-d9195243d081 -e production -s backups node backup.mjs <command>
 *
 *   serve                 what the service runs: wait for 02:00, back up, repeat
 *   run [full]            back up now
 *   list                  every copy on the volume
 *   verify <file>         open a copy and count its vouchers and accounts
 *   send <file>           a copy as base64 on stdout, for scripts/fetch-backup.sh
 *   restore <file> --replace-everything-in-the-books
 *                         put a copy back. This REPLACES every table.
 *
 * Needs CONVEX_DEPLOY_KEY: a production deploy key for sensible-panther-176,
 * set on this Railway service and nowhere else.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA = process.env.BACKUP_DIR ?? '/data'
const CONVEX = path.join(HERE, 'node_modules', '.bin', 'convex')
const KEEP = { daily: 14, monthly: 24, weekly: 4 }
// India does not change its clocks, so a fixed offset is exact.
const IST = 5.5 * 3_600_000
const RUN_AT_IST_HOUR = 2
// Room a full copy needs, with margin, before one is attempted.
const MIN_FREE_BYTES = 600 * 1024 * 1024

/**
 * What has to be in a copy before it counts as a backup.
 *
 * This used to be two tables — vouchers and ledgers — which meant a copy could
 * be missing the item list, every bill, the cash book or the whole attendance
 * register and still report itself healthy. A backup that is quietly missing
 * half the shop is worse than no backup, because it is trusted.
 *
 * These are the tables that cannot legitimately be empty in a working shop.
 * Anything that can be empty on an ordinary day — the pile, the print queue,
 * the trash — is deliberately not here, so a true empty never cries wolf.
 */
const MUST_HAVE = [
  'vouchers',        // the books
  'voucherEntries',  // the Dr/Cr behind them — balances are nothing without these
  'ledgers',         // the accounts
  'groups',          // the chart of accounts they hang from
  'voucherTypes',    // the series
  'bills',           // what the counter wrote
  'billLines',       // the lines on them
  'catalogStore',    // the item list
  'customers',
  'counters',        // the numbering — a restore without these repeats bill numbers
]

const log = (...a) => console.log(new Date().toISOString(), ...a)
const istNow = () => new Date(Date.now() + IST)

function sh(args, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(CONVEX, args, { cwd: HERE, env: process.env })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d; if (!quiet) process.stdout.write(d) })
    child.stderr.on('data', (d) => { err += d; if (!quiet) process.stderr.write(d) })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`convex ${args[0]} failed (${code}): ${(err || out).trim().slice(-400)}`)))
  })
}

/**
 * The rows of one table inside an export, read straight from the zip.
 *
 * Only the central directory at the end of the file is scanned, then the one
 * entry is inflated — a photo export runs to hundreds of megabytes and none
 * of that needs reading to know the vouchers are there.
 */
function readTable(file, table) {
  const want = `${table}/documents.jsonl`
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const tailLen = Math.min(size, 8 * 1024 * 1024)
    const tail = Buffer.alloc(tailLen)
    fs.readSync(fd, tail, 0, tailLen, size - tailLen)
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    if (eocd < 0) throw new Error('not a zip file')
    let cdOffset = tail.readUInt32LE(eocd + 16)
    let entries = tail.readUInt16LE(eocd + 10)
    // Zip64: the real figures sit in their own record just before.
    if (cdOffset === 0xffffffff || entries === 0xffff) {
      const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]), eocd)
      const z64 = Number(tail.readBigUInt64LE(loc + 8))
      const rec = z64 - (size - tailLen)
      entries = Number(tail.readBigUInt64LE(rec + 32))
      cdOffset = Number(tail.readBigUInt64LE(rec + 48))
    }
    let p = cdOffset - (size - tailLen)
    if (p < 0) throw new Error('zip directory is larger than expected')
    for (let i = 0; i < entries; i++) {
      if (tail.readUInt32LE(p) !== 0x02014b50) throw new Error('damaged zip directory')
      const method = tail.readUInt16LE(p + 10)
      let compressed = tail.readUInt32LE(p + 20)
      const nameLen = tail.readUInt16LE(p + 28)
      const extraLen = tail.readUInt16LE(p + 30)
      const commentLen = tail.readUInt16LE(p + 32)
      let local = tail.readUInt32LE(p + 42)
      const name = tail.toString('utf8', p + 46, p + 46 + nameLen)
      if (name === want) {
        // Zip64 sizes and offsets live in the extra field when the plain ones are full.
        let x = p + 46 + nameLen
        const end = x + extraLen
        while (x < end) {
          const id = tail.readUInt16LE(x)
          const len = tail.readUInt16LE(x + 2)
          if (id === 0x0001) {
            let q = x + 4
            if (tail.readUInt32LE(p + 24) === 0xffffffff) q += 8
            if (compressed === 0xffffffff) { compressed = Number(tail.readBigUInt64LE(q)); q += 8 }
            if (local === 0xffffffff) local = Number(tail.readBigUInt64LE(q))
          }
          x += 4 + len
        }
        const head = Buffer.alloc(30)
        fs.readSync(fd, head, 0, 30, local)
        const start = local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
        const body = Buffer.alloc(compressed)
        fs.readSync(fd, body, 0, compressed, start)
        return (method === 0 ? body : zlib.inflateRawSync(body)).toString('utf8')
      }
      p += 46 + nameLen + extraLen + commentLen
    }
    return null
  } finally {
    fs.closeSync(fd)
  }
}

/** How many rows one table has in a copy, or null when the table is not in it. */
function countRows(file, table) {
  const text = readTable(file, table)
  return text === null ? null : text.split('\n').filter((l) => l.trim()).length
}

/**
 * What the copy holds of the item list.
 *
 * Counted separately from the rows because the whole inventory lives inside a
 * single `catalogStore` document — so the row count is 1 whether the list has
 * two hundred items in it or none. That is exactly how the hardware list
 * emptied on 10 September 2026 without anything noticing: eight groups of
 * screw sizes, hinges and handles went, the row was still there, and every
 * backup that night and after reported itself healthy.
 */
function countInventory(file) {
  const text = readTable(file, 'catalogStore')
  if (!text) return null
  let items = 0
  let groups = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      items += (row.customCatalog ?? []).length
      groups += Object.keys(row.hardwareCatalog ?? {}).length
    } catch { /* a row we cannot read is one we cannot count */ }
  }
  return { items, groups }
}

/**
 * What the last copy held, so this one can be compared with it.
 *
 * A single small file on the volume rather than a query back to the books:
 * the point of this check is to notice when the books have lost something, and
 * asking the books how much they hold would answer with whatever they hold
 * now — which is the very figure in doubt.
 */
const MARK = () => path.join(DATA, 'last-contents.json')

function lastInventory() {
  try {
    return JSON.parse(fs.readFileSync(MARK(), 'utf8'))
  } catch {
    return null
  }
}

function rememberInventory(stock) {
  try {
    fs.writeFileSync(MARK(), JSON.stringify({ ...stock, at: Date.now() }))
  } catch (e) {
    log('could not note what this copy held:', e.message)
  }
}

function prune(dir, keep) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.zip')).sort()
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    fs.rmSync(path.join(dir, f))
    log('removed old copy', path.join(path.basename(dir), f))
  }
}

async function report(result) {
  try {
    await sh(['run', 'backups:record', JSON.stringify(result)], { quiet: true })
  } catch (e) {
    log('could not write the result to the books:', e.message)
  }
}

export async function backup(full) {
  const kind = full ? 'full' : 'tables'
  const stamp = istNow().toISOString().slice(0, 16).replace('T', '-').replace(':', '')
  for (const d of ['daily', 'monthly', 'weekly', 'tmp']) fs.mkdirSync(path.join(DATA, d), { recursive: true })
  const tmp = path.join(DATA, 'tmp', `${stamp}-${kind}.zip`)
  try {
    // CONVEX_DEPLOYMENT is only for trying this on a logged-in machine.
    if (!process.env.CONVEX_DEPLOY_KEY && !process.env.CONVEX_DEPLOYMENT) {
      throw new Error('CONVEX_DEPLOY_KEY is not set on this service')
    }
    const { bavail, bsize } = fs.statfsSync(DATA)
    if (bavail * bsize < MIN_FREE_BYTES) throw new Error(`only ${Math.round((bavail * bsize) / 1048576)} MB free on the volume`)

    log(`backing up (${kind})`)
    await sh(['export', '--path', tmp, ...(full ? ['--include-file-storage'] : [])])

    // A copy that cannot be opened, or is missing part of the shop, is not a
    // backup — keep it aside for a look and leave the older good copies alone.
    const missing = MUST_HAVE.filter((t) => !countRows(tmp, t))
    if (missing.length) {
      throw new Error(`the copy is missing ${missing.join(', ')} — kept in tmp/ for inspection`)
    }
    const vouchers = countRows(tmp, 'vouchers')
    const ledgers = countRows(tmp, 'ledgers')

    /**
     * The item list is counted inside its row, not by rows.
     *
     * A warning rather than a refusal: the copy is an honest record of what
     * the books hold, and refusing to keep it because the shop lost something
     * would throw away the evidence. So it is saved either way and the drop is
     * said out loud, here and in the books, where Home can show it.
     */
    const stock = countInventory(tmp)
    const before = lastInventory()
    let warning
    if (stock && before && before.items > 0 && stock.items < before.items * 0.8) {
      warning = `the item list has dropped from ${before.items} to ${stock.items}`
    }
    if (stock && before && before.groups > 0 && stock.groups === 0) {
      warning = `${warning ? warning + '; ' : ''}the hardware list has gone from ${before.groups} groups to none`
    }
    if (warning) log('WARNING:', warning)
    if (stock) rememberInventory(stock)

    const bytes = fs.statSync(tmp).size
    const ist = istNow()
    let file
    if (full) {
      file = path.join('weekly', `${stamp}.zip`)
      fs.renameSync(tmp, path.join(DATA, file))
      prune(path.join(DATA, 'weekly'), KEEP.weekly)
    } else {
      file = path.join('daily', `${stamp}.zip`)
      fs.renameSync(tmp, path.join(DATA, file))
      if (ist.getUTCDate() === 1) {
        fs.copyFileSync(path.join(DATA, file), path.join(DATA, 'monthly', `${stamp}.zip`))
        prune(path.join(DATA, 'monthly'), KEEP.monthly)
      }
      prune(path.join(DATA, 'daily'), KEEP.daily)
    }
    log(`backed up ${file} — ${(bytes / 1048576).toFixed(1)} MB, ${vouchers} vouchers, `
      + `${ledgers} accounts, ${stock ? stock.items : '?'} items`)
    await report({ ok: true, kind, file, bytes, vouchers, ...(stock ? { items: stock.items } : {}), ...(warning ? { warning } : {}) })
    return true
  } catch (e) {
    log('BACKUP FAILED:', e.message)
    await report({ ok: false, kind, error: String(e.message).slice(0, 500) })
    return false
  }
}

/** Milliseconds until the next 02:00 India time. */
function untilNextRun() {
  const now = Date.now()
  const ist = new Date(now + IST)
  const next = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), RUN_AT_IST_HOUR) - IST
  return next > now ? next - now : next + 86_400_000 - now
}

function newest(dir) {
  try {
    const files = fs.readdirSync(path.join(DATA, dir)).filter((f) => f.endsWith('.zip')).sort()
    return files.length ? fs.statSync(path.join(DATA, dir, files.at(-1))).mtimeMs : 0
  } catch {
    return 0
  }
}

async function serve() {
  log(`backups: volume ${DATA}; nightly at 0${RUN_AT_IST_HOUR}:00 IST`)
  // After a redeploy or a crash, catch up rather than wait for tonight.
  if (Date.now() - newest('daily') > 26 * 3_600_000) await backup(false)
  if (Date.now() - newest('weekly') > 8 * 86_400_000) await backup(true)
  for (;;) {
    const wait = untilNextRun()
    log(`next backup in ${(wait / 3_600_000).toFixed(1)} h`)
    await new Promise((r) => setTimeout(r, wait))
    await backup(false)
    // Sunday, India time.
    if (istNow().getUTCDay() === 0) await backup(true)
  }
}

function list() {
  for (const dir of ['daily', 'weekly', 'monthly', 'tmp']) {
    let files = []
    try { files = fs.readdirSync(path.join(DATA, dir)).sort() } catch { /* none yet */ }
    console.log(`${dir}/ (${files.length})`)
    for (const f of files) {
      const s = fs.statSync(path.join(DATA, dir, f))
      console.log(`  ${f}  ${(s.size / 1048576).toFixed(1)} MB`)
    }
  }
  const { bavail, bsize, blocks } = fs.statfsSync(DATA)
  console.log(`free ${(bavail * bsize / 1073741824).toFixed(2)} GB of ${(blocks * bsize / 1073741824).toFixed(2)} GB`)
}

/** Resolve a name given on the command line to a file on the volume, and nowhere else. */
function onVolume(name) {
  const full = path.resolve(DATA, String(name ?? ''))
  if (!full.startsWith(path.resolve(DATA) + path.sep) || !fs.existsSync(full)) {
    throw new Error(`no such backup: ${name} (see: node backup.mjs list)`)
  }
  return full
}

const [cmd, ...args] = process.argv.slice(2)
try {
  if (cmd === 'serve') await serve()
  else if (cmd === 'run') process.exit((await backup(args[0] === 'full')) ? 0 : 1)
  else if (cmd === 'list') list()
  else if (cmd === 'verify') {
    // Any zip, on the volume or not — for checking a copy fetched to another machine.
    const file = fs.existsSync(String(args[0])) ? String(args[0]) : onVolume(args[0])
    const missing = MUST_HAVE.filter((t) => !countRows(file, t))
    const stock = countInventory(file)
    console.log(`${file}`)
    for (const t of MUST_HAVE) console.log(`  ${String(countRows(file, t) ?? 'MISSING').padStart(7)}  ${t}`)
    console.log(`  ${String(stock ? stock.items : 'MISSING').padStart(7)}  inventory items`)
    console.log(`  ${String(stock ? stock.groups : 'MISSING').padStart(7)}  hardware groups`)
    if (missing.length) console.log(`\nMISSING: ${missing.join(', ')}`)
    process.exit(missing.length ? 1 : 0)
  }
  else if (cmd === 'send') process.stdout.write(fs.readFileSync(onVolume(args[0])).toString('base64'))
  else if (cmd === 'restore') {
    const file = onVolume(args[0])
    if (args[1] !== '--replace-everything-in-the-books') {
      console.error('This replaces every table in the live books with the copy. Add --replace-everything-in-the-books to go ahead.')
      process.exit(2)
    }
    // Take a copy of how things stand right now first, so a restore can itself be undone.
    if (!(await backup(false))) throw new Error('could not back up the current books first — not restoring')
    await sh(['import', '--replace-all', '-y', file])
    log(`restored ${args[0]}`)
  } else {
    console.error('usage: node backup.mjs serve | run [full] | list | verify <file> | send <file> | restore <file> --replace-everything-in-the-books')
    process.exit(2)
  }
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
