/**
 * Nightly copies of every Convex project on the team, kept on a Railway volume.
 *
 * Runs on Railway as its own service (convex-backups) with a volume at /data.
 * Every night at 03:00 India time it asks the Convex CLI for an export of each
 * project in PROJECTS, straight onto the volume: nothing passes through
 * anybody's computer. Each copy is opened and checked before anything older
 * is thrown away, and what happened is written to /data/status.json.
 *
 *   /data/<project>/daily/     tables, the last few nights
 *   /data/<project>/weekly/    tables and stored files, on Sundays
 *   /data/<project>/monthly/   tables on the 1st
 *
 * The Shiv Panel books also have their own job (backup-job/), which checks
 * what is inside a copy; this one only checks that a copy is whole.
 *
 * Commands, run from any folder with
 *   railway ssh -p 3204a621-3a84-4ad0-9960-d9195243d081 -e production -s convex-backups node backup.mjs <command>
 *
 *   serve                     what the service runs: wait for 03:00, back up, repeat
 *   run [full] [project ...]  back up now (full: with stored files); no project means all
 *   start [full] [project ...] the same, left running on the service: a large project
 *                             takes longer than a terminal link stays open. Follow it with `log`.
 *   log [lines]               the end of what `start` has written
 *   list [project]            every copy on the volume
 *   status                    how the last run went, project by project
 *   verify <file>             open a copy and count its tables and rows
 *   send <file>               a copy as base64 on stdout, for fetch.sh
 *
 * Needs CONVEX_OVERRIDE_ACCESS_TOKEN: an access token of a member of the team
 * (Convex dashboard, Team Settings, Access Tokens), set on this Railway
 * service and nowhere else. The CLI uses it in place of a login.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA = process.env.BACKUP_DIR ?? '/data'
const CONVEX = path.join(HERE, 'node_modules', '.bin', 'convex')
const TEAM = process.env.CONVEX_TEAM ?? 'harsh-agarwal'

// How many copies of each kind are kept, unless a project says otherwise.
// The volume is 5 GB, and the weekly copies carry every stored file (the
// shop's bill photos, GradeX's uploads), so only two of those are kept.
const KEEP = { daily: 7, weekly: 2, monthly: 6 }

/**
 * Every project on the team. `ref` is the deployment copied (prod unless the
 * project only has a dev one). GradeX is by far the largest, so it keeps
 * fewer copies; the rest are a few megabytes each.
 */
const PROJECTS = [
  { slug: 'gradex', keep: { daily: 2, weekly: 2, monthly: 2 } },
  { slug: 'shiv-hardware-panel' },
  { slug: 'shiv-ledger' },
  { slug: 'gridee-tokens-7e3ec' },
  { slug: 'finance-record' },
  { slug: 'gradex-bitm' },
  { slug: 'expenza' },
  { slug: 'confera' },
  { slug: 'srt-signature' },
  { slug: 'ventarc' },
  { slug: 'realdac', ref: 'dev' },
  { slug: 'nexora-os', ref: 'dev' },
]

// India does not change its clocks, so a fixed offset is exact.
const IST = 5.5 * 3_600_000
const RUN_AT_IST_HOUR = 3
// Room that must be left on the volume after a copy is written.
const SPARE_BYTES = 200 * 1024 * 1024

const log = (...a) => console.log(new Date().toISOString(), ...a)
const istNow = () => new Date(Date.now() + IST)
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`

function convex(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(CONVEX, args, { cwd: HERE, env: process.env })
    let out = ''
    // Kept short: a long download repaints its progress line thousands of times.
    const keep = (d) => { out = (out + d).slice(-4000) }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`convex ${args[0]} failed (${code}): ${out.trim().slice(-300)}`)))
  })
}

/**
 * The files inside an export and their sizes, read from the zip's directory.
 *
 * Only the directory at the end of the file is read: a copy with photos runs
 * to hundreds of megabytes, and none of that needs reading to know it is whole.
 * A download that was cut short has no directory, which is how it is caught.
 */
function zipEntries(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const tailLen = Math.min(size, 16 * 1024 * 1024)
    const tail = Buffer.alloc(tailLen)
    fs.readSync(fd, tail, 0, tailLen, size - tailLen)
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    if (eocd < 0) throw new Error('not a whole zip file')
    let cdOffset = tail.readUInt32LE(eocd + 16)
    let count = tail.readUInt16LE(eocd + 10)
    // Zip64: the real figures sit in their own record just before.
    if (cdOffset === 0xffffffff || count === 0xffff) {
      const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]), eocd)
      if (loc < 0) throw new Error('damaged zip directory')
      const rec = Number(tail.readBigUInt64LE(loc + 8)) - (size - tailLen)
      count = Number(tail.readBigUInt64LE(rec + 32))
      cdOffset = Number(tail.readBigUInt64LE(rec + 48))
    }
    let p = cdOffset - (size - tailLen)
    if (p < 0) throw new Error('zip directory is larger than expected')
    const entries = []
    for (let i = 0; i < count; i++) {
      if (tail.readUInt32LE(p) !== 0x02014b50) throw new Error('damaged zip directory')
      const nameLen = tail.readUInt16LE(p + 28)
      const extraLen = tail.readUInt16LE(p + 30)
      const commentLen = tail.readUInt16LE(p + 32)
      let compressed = tail.readUInt32LE(p + 20)
      let local = tail.readUInt32LE(p + 42)
      // Convex writes Zip64: the real size and offset are in the extra field
      // whenever the plain ones are full.
      let x = p + 46 + nameLen
      const end = x + extraLen
      while (x + 4 <= end) {
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
      entries.push({ name: tail.toString('utf8', p + 46, p + 46 + nameLen), method: tail.readUInt16LE(p + 10), compressed, local })
      p += 46 + nameLen + extraLen + commentLen
    }
    return entries
  } finally {
    fs.closeSync(fd)
  }
}

/** Rows in one table of a copy, for tables small enough to hold in memory. */
function countRows(file, entry) {
  if (entry.compressed > 64 * 1024 * 1024) return null
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(30)
    fs.readSync(fd, head, 0, 30, entry.local)
    const start = entry.local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
    const body = Buffer.alloc(entry.compressed)
    fs.readSync(fd, body, 0, entry.compressed, start)
    const text = entry.method === 0 ? body : zlib.inflateRawSync(body)
    // One row a line; the last line may or may not end with a newline.
    let rows = 0
    for (const byte of text) if (byte === 10) rows++
    if (text.length && text[text.length - 1] !== 10) rows++
    return rows
  } catch {
    return null
  } finally {
    fs.closeSync(fd)
  }
}

/** What a copy holds: how many tables, rows and stored files. Throws when it is not whole. */
function inspect(file) {
  const entries = zipEntries(file)
  const tables = entries.filter((e) => e.name.endsWith('/documents.jsonl') && !e.name.startsWith('_'))
  const stored = entries.filter((e) => e.name.startsWith('_storage/') && !e.name.endsWith('documents.jsonl'))
  let rows = 0
  for (const t of tables) rows += countRows(file, t) ?? 0
  return { tables: tables.length, rows, storedFiles: stored.length, bytes: fs.statSync(file).size }
}

const dirOf = (slug, kind) => path.join(DATA, slug, kind)
const copiesIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.zip')).sort() : [])

function freeBytes() {
  try {
    const s = fs.statfsSync(DATA)
    return Number(s.bavail) * Number(s.bsize)
  } catch {
    return Infinity
  }
}

/** Keep the newest `keep` copies in a folder. Called only after a new copy has been checked. */
function prune(dir, keep) {
  const files = copiesIn(dir)
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    fs.rmSync(path.join(dir, f), { force: true })
    log(`  dropped ${path.relative(DATA, path.join(dir, f))}`)
  }
}

/**
 * One copy of one project. Written under a temporary name and only given its
 * real name once it has been opened and checked, so a half-written file is
 * never mistaken for a backup.
 */
async function copyOne(project, kind, stamp) {
  const { slug, ref = 'prod' } = project
  const keep = { ...KEEP, ...project.keep }
  const dir = dirOf(slug, kind)
  fs.mkdirSync(dir, { recursive: true })
  const final = path.join(dir, `${stamp}.zip`)
  const tmp = `${final}.part`
  fs.rmSync(tmp, { force: true })

  // Room for a copy the size of the last one, and some to spare. When the
  // volume is short, the oldest copies of this kind go first, down to one:
  // a full volume must not stop the backups, but the last good copy stays
  // until a newer one has been checked.
  const last = copiesIn(dir).at(-1)
  const need = Math.ceil((last ? fs.statSync(path.join(dir, last)).size : 0) * 1.2) + SPARE_BYTES
  while (freeBytes() < need && copiesIn(dir).length > 1) {
    const oldest = copiesIn(dir)[0]
    fs.rmSync(path.join(dir, oldest), { force: true })
    log(`  short of room: dropped ${path.relative(DATA, path.join(dir, oldest))}`)
  }
  if (freeBytes() < need) throw new Error(`volume is short of room: ${mb(freeBytes())} free, ${mb(need)} wanted`)

  const args = ['export', '--deployment', `${TEAM}:${slug}:${ref}`, '--path', tmp]
  if (kind === 'weekly') args.push('--include-file-storage')
  await convex(args)
  if (!fs.existsSync(tmp)) throw new Error('the export wrote no file')
  let held
  try {
    held = inspect(tmp)
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw new Error(`the copy is not whole (${err.message})`)
  }
  fs.renameSync(tmp, final)
  prune(dir, keep[kind])
  return { file: path.relative(DATA, final), ...held }
}

/** Which kinds of copy a night calls for. */
function kindsFor(now, full) {
  if (full) return ['weekly']
  const kinds = [now.getUTCDay() === 0 ? 'weekly' : 'daily']
  if (now.getUTCDate() === 1) kinds.push('monthly')
  return kinds
}

async function run({ full = false, only = [] } = {}) {
  if (!process.env.CONVEX_OVERRIDE_ACCESS_TOKEN) throw new Error('CONVEX_OVERRIDE_ACCESS_TOKEN is not set on this service')
  const now = istNow()
  const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '')
  const kinds = kindsFor(now, full)
  const projects = only.length ? PROJECTS.filter((p) => only.includes(p.slug)) : PROJECTS
  if (only.length && projects.length !== only.length) throw new Error(`unknown project in: ${only.join(', ')}`)

  const status = readStatus()
  let failed = 0
  for (const project of projects) {
    for (const kind of kinds) {
      const started = Date.now()
      log(`      ${project.slug} ${kind}: asking Convex for the export`)
      try {
        const got = await copyOne(project, kind, stamp)
        log(`OK    ${project.slug} ${kind}: ${got.tables} tables, ${got.rows} rows${got.storedFiles ? `, ${got.storedFiles} files` : ''}, ${mb(got.bytes)} in ${Math.round((Date.now() - started) / 1000)}s`)
        status.projects[project.slug] = { ...status.projects[project.slug], [kind]: { ok: true, at: new Date().toISOString(), ...got } }
      } catch (err) {
        failed++
        log(`ERROR ${project.slug} ${kind}: ${err.message}`)
        status.projects[project.slug] = { ...status.projects[project.slug], [kind]: { ok: false, at: new Date().toISOString(), error: err.message, lastGood: status.projects[project.slug]?.[kind]?.ok ? status.projects[project.slug][kind] : status.projects[project.slug]?.[kind]?.lastGood } }
      }
      writeStatus(status)
    }
  }
  status.lastRun = { at: new Date().toISOString(), kinds, failed, freeAfter: mb(freeBytes()) }
  writeStatus(status)
  log(`done: ${projects.length * kinds.length - failed} copied, ${failed} failed, ${mb(freeBytes())} free`)
  return failed
}

/**
 * Start a run that outlives the terminal it was started from.
 *
 * `run` over `railway ssh` dies with the link, and the link does not last the
 * several minutes a large project's export takes: the first GradeX copy was
 * lost that way, with nothing written to say so.
 */
const RUN_LOG = () => path.join(DATA, 'run.log')
function start(args) {
  fs.mkdirSync(DATA, { recursive: true })
  const out = fs.openSync(RUN_LOG(), 'a')
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run', ...args], { cwd: HERE, env: process.env, detached: true, stdio: ['ignore', out, out] })
  child.unref()
  console.log(`started (pid ${child.pid}); follow it with: node backup.mjs log`)
}
function showLog(lines = 30) {
  if (!fs.existsSync(RUN_LOG())) { console.log('nothing has been started yet'); return }
  console.log(fs.readFileSync(RUN_LOG(), 'utf8').trimEnd().split('\n').slice(-lines).join('\n'))
}

const STATUS = () => path.join(DATA, 'status.json')
function readStatus() {
  try { return { projects: {}, ...JSON.parse(fs.readFileSync(STATUS(), 'utf8')) } } catch { return { projects: {} } }
}
function writeStatus(status) {
  fs.mkdirSync(DATA, { recursive: true })
  fs.writeFileSync(STATUS(), JSON.stringify(status, null, 2))
}

function list(slug) {
  for (const project of PROJECTS) {
    if (slug && project.slug !== slug) continue
    for (const kind of ['daily', 'weekly', 'monthly']) {
      for (const f of copiesIn(dirOf(project.slug, kind))) {
        const file = path.join(dirOf(project.slug, kind), f)
        console.log(`${path.relative(DATA, file).padEnd(60)} ${mb(fs.statSync(file).size).padStart(10)}`)
      }
    }
  }
  console.log(`free on the volume: ${mb(freeBytes())}`)
}

function showStatus() {
  const status = readStatus()
  if (status.lastRun) console.log(`last run ${status.lastRun.at}: ${status.lastRun.failed} failed, ${status.lastRun.freeAfter} free`)
  for (const project of PROJECTS) {
    const s = status.projects[project.slug]
    if (!s) { console.log(`${project.slug.padEnd(22)} no copy yet`); continue }
    for (const [kind, r] of Object.entries(s)) {
      console.log(`${project.slug.padEnd(22)} ${kind.padEnd(8)} ${r.ok ? `ok    ${r.at.slice(0, 16)}  ${r.tables} tables, ${r.rows} rows, ${mb(r.bytes)}` : `FAILED ${r.at.slice(0, 16)}  ${r.error}`}`)
    }
  }
}

/** Sleep until the next 03:00 India time, back up, and go round again. */
async function serve() {
  log(`convex-backups: ${PROJECTS.length} projects, every night at ${String(RUN_AT_IST_HOUR).padStart(2, '0')}:00 India time`)
  for (;;) {
    const now = istNow()
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RUN_AT_IST_HOUR))
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
    const wait = next - now
    log(`next run in ${(wait / 3_600_000).toFixed(1)} h`)
    await new Promise((r) => setTimeout(r, wait))
    try { await run() } catch (err) { log(`ERROR the run could not start: ${err.message}`) }
  }
}

const [command, ...rest] = process.argv.slice(2)
const inData = (f) => {
  const file = path.resolve(DATA, f)
  if (!file.startsWith(path.resolve(DATA) + path.sep)) throw new Error('not a file on the volume')
  return file
}
try {
  if (command === 'serve') await serve()
  else if (command === 'run') {
    const full = rest.includes('full')
    process.exitCode = (await run({ full, only: rest.filter((a) => a !== 'full') })) ? 1 : 0
  } else if (command === 'start') start(rest)
  else if (command === 'log') showLog(Number(rest[0]) || 30)
  else if (command === 'list') list(rest[0])
  else if (command === 'status') showStatus()
  else if (command === 'verify') console.log(JSON.stringify(inspect(fs.existsSync(rest[0]) ? rest[0] : inData(rest[0])), null, 2))
  else if (command === 'send') process.stdout.write(fs.readFileSync(inData(rest[0])).toString('base64'))
  else {
    console.error('usage: node backup.mjs serve | run [full] [project ...] | start [full] [project ...] | log [lines] | list [project] | status | verify <file> | send <file>')
    process.exitCode = 2
  }
} catch (err) {
  console.error(`ERROR ${err.message}`)
  process.exitCode = 1
}
