// Runs server.mjs and keeps it running: restarts it when its code changes on
// disk (a `git pull`, an edit) and when it dies.
//
// This replaces `node --watch server.mjs`. On Windows the watcher behind --watch
// is told when a file is READ as well as when it is written (the last-access
// time moves, at most once an hour), and --watch takes that for an edit. So
// anything that read server.mjs, template.mjs or a file in node_modules — a
// search, a build, a virus scan — restarted the print server, and the restart,
// reading its own node_modules, restarted it a few more times: 106 restarts in
// three days, each dropping the WhatsApp link and refusing the counter for a
// while ("Cannot reach print server", 2026-10-10). Here a restart needs a
// file's size or modified time to have actually changed.
import { spawn, execFile } from 'child_process'
import { readdirSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const DIR = dirname(fileURLToPath(import.meta.url))
const SELF = basename(fileURLToPath(import.meta.url))
const POLL_MS = 2000

const pad = (n) => String(n).padStart(2, '0')
function log(text) {
  const d = new Date()
  console.log(`[${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}] ${text}`)
}

// The server's own code: every .mjs beside this one. A stat does not count as
// a read, so looking never moves the access time the old watcher tripped on.
function snapshot() {
  const files = {}
  for (const name of readdirSync(DIR)) {
    if (!name.endsWith('.mjs') || name === SELF) continue
    try {
      const s = statSync(join(DIR, name))
      files[name] = `${s.mtimeMs}:${s.size}`
    } catch { /* deleted between the listing and the stat */ }
  }
  return files
}

const changedFiles = (from, to) =>
  [...new Set([...Object.keys(from), ...Object.keys(to)])].filter((name) => from[name] !== to[name])

let child = null
let loaded = {}          // the code the running server was started from
let restarting = false   // we stopped it ourselves, to load new code
let quickDeaths = 0
let retryTimer = null

function start() {
  clearTimeout(retryTimer)
  retryTimer = null
  loaded = snapshot()
  const startedAt = Date.now()
  child = spawn(process.execPath, ['server.mjs'], { cwd: DIR, stdio: 'inherit', windowsHide: true })
  child.once('exit', (code) => {
    child = null
    if (restarting) {
      restarting = false
      start()
      return
    }
    // Died on its own. One that keeps dying at once (the port is taken, a file
    // caught half-saved) is retried ever more slowly: 5s, 10s, … up to a minute.
    if (Date.now() - startedAt >= 30_000) quickDeaths = 0
    const wait = Math.min(60_000, 5000 * 2 ** quickDeaths++)
    log(`Shiv Print Server exited (code ${code}), restarting in ${wait / 1000}s`)
    retryTimer = setTimeout(start, wait)
  })
}

// Windows: the whole tree, so the Chrome it opened for printing goes with it
// and is not left running with nobody to close it.
function stop() {
  if (!child) return
  const running = child
  if (process.platform !== 'win32') return void running.kill()
  execFile('taskkill', ['/pid', String(running.pid), '/T', '/F'], (err) => {
    if (err && child === running) running.kill()
  })
}

let seen = null
setInterval(() => {
  const now = snapshot()
  const changed = changedFiles(loaded, now)
  if (!changed.length) { seen = null; return }
  // A pull writes several files and an editor may write one twice: go only
  // once two looks in a row agree.
  const key = JSON.stringify(now)
  if (key !== seen) { seen = key; return }
  seen = null
  if (restarting) return
  log(`Shiv Print Server restarting: ${changed.join(', ')} changed`)
  quickDeaths = 0
  if (child) { restarting = true; stop() } else start()
}, POLL_MS)

for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(signal, () => {
    clearTimeout(retryTimer)
    stop()
    setTimeout(() => process.exit(0), 500)
  })
}

start()
