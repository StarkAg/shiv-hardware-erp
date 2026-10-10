import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Exercise a COPY of the supervisor with a fake server. Never starts, stops,
// prints from, or sends WhatsApp through the real shop server.
const dir = resolve('.probe', `print-runner-${process.pid}`)
mkdirSync(dir, { recursive: true })
copyFileSync('print-server/run.mjs', resolve(dir, 'run.mjs'))
const source = "import {appendFileSync} from 'node:fs';appendFileSync('starts.jsonl',JSON.stringify({pid:process.pid,at:Date.now()})+'\\n');setInterval(()=>{},1000);"
writeFileSync(resolve(dir, 'server.mjs'), source)
const starts = () => existsSync(resolve(dir, 'starts.jsonl')) ? readFileSync(resolve(dir, 'starts.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((s) => JSON.parse(s)) : []
const wait = (ms) => new Promise((done) => setTimeout(done, ms))
async function until(fn, timeout = 12000) {
  const end = Date.now() + timeout
  while (!fn()) { assert(Date.now() < end, 'Supervisor did not restart in time'); await wait(100) }
}
let log = ''
const runner = spawn(process.execPath, ['run.mjs'], { cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
runner.stdout.on('data', (s) => { log += s })
runner.stderr.on('data', (s) => { log += s })
try {
  await until(() => starts().length === 1)
  readFileSync(resolve(dir, 'server.mjs'))
  await wait(4500)
  assert.equal(starts().length, 1, 'Reading server code must not restart it')
  writeFileSync(resolve(dir, 'server.mjs'), source + '\n// Actual edit\n')
  await until(() => starts().length === 2)
  const second = starts()[1].pid
  process.kill(second)
  await until(() => starts().length === 3)
  assert(log.includes('server.mjs changed'))
  assert(log.includes('restarting in 5s'))
  console.log('PASS: supervisor ignores reads, restarts after a code edit, and recovers from a child crash.')
} finally {
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/pid', String(runner.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* already stopped */ }
  } else {
    runner.kill('SIGTERM')
  }
}
