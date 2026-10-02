#!/usr/bin/env node
// Copy of StarkAg/wip-backups/autosave.mjs, so npm run sync / deploy:convex work on a fresh clone.
// wip-backups: every 5 minutes, copy the uncommitted and unpushed work of every git repo
// on this computer to one private GitHub repo, so the other computer can see it and a
// deploy can refuse to run while it exists. Only changed files are sent, as a snapshot
// under <owner>/<repo>/<computer>; the project repos themselves are never written to.
//
//   node autosave.mjs install [folder ...] [--as name]   scan these folders (default: home) every 5 min
//   node autosave.mjs save-all                         what the schedule runs
//   node autosave.mjs save                             this repo only
//   node autosave.mjs start                            pull, then list what other computers have pending here
//   node autosave.mjs check [--force]                  exit 1 unless deploying this repo from here is safe
//   node autosave.mjs list                             every repo with work pending on any computer
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { homedir, hostname, platform } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_CENTRAL = 'https://github.com/StarkAg/wip-backups.git'
const CONFIG_PATH = process.env.WIP_CONFIG || join(homedir(), '.wip-backups.json')
const MANIFEST = '.wip.json'
const MAX_FILE = 10 << 20
const MAX_TOTAL = 100 << 20
const SCAN_BYTES = 2 << 20
const MAX_DEPTH = 6
const REDISCOVER_MS = 6 * 60 * 60 * 1000
const SKIP_DIRS = new Set(['node_modules', 'Library', 'AppData', 'Applications', 'venv', '.venv', 'Pods', 'build', 'dist', 'target', 'vendor'])
// Never copied, even to a private repo: one leaked backup repo would hold every project's keys.
const SECRET_PATH = /(^|\/)(\.env(\.[^/]*)?|[^/]*\.(pem|key|p12|pfx|keystore|jks)|id_(rsa|ed25519|ecdsa)[^/]*|[^/]*credentials[^/]*\.json|service[-_]?account[^/]*\.json|\.npmrc|\.netrc)$|(^|\/)secrets?\//i
const SECRET_TEXT = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bsk-(ant|proj)-[A-Za-z0-9_-]{20,}|\bsk_live_[A-Za-z0-9]{20,}|\brzp_live_[A-Za-z0-9]{10,}|\bxox[baprs]-[A-Za-z0-9-]{20,}/

const config = (() => {
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) } catch { return {} }
})()
const writeConfig = () => writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`)
const clean = (s) => String(s).toLowerCase().replace(/[^a-z0-9._]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').replace(/\.lock$/, '-lock') || 'x'
const COMPUTER = clean(process.env.WIP_COMPUTER || config.computer || hostname().replace(/\.local$/i, ''))
const CENTRAL = process.env.WIP_BACKUPS_URL || config.central || DEFAULT_CENTRAL
// Per backup repo, so a test run against another URL never marks the real one as done.
const LAST = `refs/wip-backups/last-${createHash('sha1').update(CENTRAL).digest('hex').slice(0, 8)}`
const IDENTITY = { GIT_AUTHOR_NAME: 'wip-backups', GIT_AUTHOR_EMAIL: 'wip-backups@localhost', GIT_COMMITTER_NAME: 'wip-backups', GIT_COMMITTER_EMAIL: 'wip-backups@localhost' }

const stamp = () => new Date().toLocaleString('en-IN', { hour12: false })
const lines = (text) => (text ? text.split('\n').filter(Boolean) : [])
const git = (cwd, args, opts = {}) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 512 << 20, ...opts })
const out = (cwd, args, opts) => git(cwd, args, opts).trim()
const maybe = (cwd, args, opts) => {
  try { return out(cwd, args, opts) } catch { return null }
}
const errText = (e) => String(e?.stderr || e?.message || e).trim().split('\n').slice(-2).join(' ')

function withLock(path, fn, busy) {
  try {
    closeSync(openSync(path, 'wx'))
  } catch {
    if (Date.now() - statSync(path).mtimeMs < 10 * 60 * 1000) return busy()
    writeFileSync(path, '') // left behind by a crashed run
  }
  try { return fn() } finally { rmSync(path, { force: true }) }
}

// ── one repo ──────────────────────────────────────────────────────────────

/** owner/repo for GitHub, host/path elsewhere, local/<folder> with no remote. */
function slugOf(repo) {
  const url = maybe(repo, ['remote', 'get-url', 'origin'])
  const path = !url || /^(file:\/\/|\/|\.|[a-z]:[\\/])/i.test(url)
  const m = !path && url.match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?\/*$/i)
  const parts = m ? (m[1].toLowerCase() === 'github.com' ? m[2].split('/') : [m[1], ...m[2].split('/')])
    : ['local', basename(url ? url.replace(/[\\/]+$/, '').replace(/\.git$/, '') : repo)]
  return parts.filter(Boolean).map(clean).join('/')
}

/**
 * This computer's slot for a repo: the computer's name, or name--folder for a second
 * clone of the same repo on this computer (see discover), so clones never overwrite each other.
 */
function slotOf(repo) {
  const clone = config.clones?.[resolve(repo)]
  return clone ? `${COMPUTER}--${clone}` : COMPUTER
}

/** origin's default branch (origin/HEAD, else origin/main or origin/master), or null. */
function mainOf(repo) {
  return maybe(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']) ||
    ['origin/main', 'origin/master'].find((r) => maybe(repo, ['rev-parse', '--verify', '-q', r])) || null
}

/** Paths with status, from `git diff --name-status -z`. */
function nameStatus(text) {
  const parts = text.split('\0')
  const res = []
  for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i]) res.push({ status: parts[i][0], path: parts[i + 1] })
  return res
}

/** path -> { mode, blob } from `git ls-files -s -z` or `git ls-tree -r -z`. */
function entries(text, tree = false) {
  const map = new Map()
  for (const rec of text.split('\0')) {
    if (!rec) continue
    const tab = rec.indexOf('\t')
    const f = rec.slice(0, tab).split(' ')
    map.set(rec.slice(tab + 1), tree ? { mode: f[0], blob: f[2] } : { mode: f[0], blob: f[1] })
  }
  return map
}

function whySkip(repo, path, mode) {
  if (SECRET_PATH.test(path)) return 'secret file name'
  if (mode === '160000' || mode === '120000') return null
  let size
  try { size = statSync(join(repo, path)).size } catch { return null }
  if (size > MAX_FILE) return `over ${MAX_FILE >> 20} MB`
  if (size <= SCAN_BYTES) {
    const buf = readFileSync(join(repo, path))
    if (!buf.subarray(0, 8000).includes(0) && SECRET_TEXT.test(buf.toString('utf8'))) return 'contains a key'
  }
  return null
}

/** Copy this repo's uncommitted + unpushed work to CENTRAL. Returns a one-line result. */
function save(repo) {
  const gitDir = out(repo, ['rev-parse', '--absolute-git-dir'])
  return withLock(join(gitDir, 'wip-backups.lock'), () => saveLocked(repo, gitDir), () => 'another save is running')
}

function saveLocked(repo, gitDir) {
  const head = maybe(repo, ['rev-parse', '--verify', '-q', 'HEAD'])
  if (!head) return null
  const slug = slugOf(repo)
  const ref = `refs/heads/${slug}/${slotOf(repo)}`
  const last = maybe(repo, ['rev-parse', '--verify', '-q', LAST])
  const unpushed = lines(out(repo, ['rev-list', '--topo-order', 'HEAD', '--not', '--remotes=origin']))
  const base = unpushed.length ? maybe(repo, ['rev-parse', '--verify', '-q', `${unpushed.at(-1)}^`]) : head

  const work = join(gitDir, `wip-index-${process.pid}`)
  const snap = join(gitDir, `wip-snap-${process.pid}`)
  try {
    if (existsSync(join(gitDir, 'index'))) copyFileSync(join(gitDir, 'index'), work)
    const env = { ...process.env, GIT_INDEX_FILE: work }
    // Big untracked files are left out before `add`, so git never hashes them on every run.
    const tooBig = git(repo, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter((f) => {
      try { return f && statSync(join(repo, f)).size > MAX_FILE } catch { return false }
    })
    git(repo, ['add', '-A', '--', '.', ...tooBig.map((f) => `:(exclude,literal)${f}`)], { env })
    const staged = entries(git(repo, ['ls-files', '-s', '-z'], { env }))
    const changes = base
      ? nameStatus(git(repo, ['diff', '--cached', '--no-renames', '--name-status', '-z', base], { env }))
      : [...staged.keys()].map((path) => ({ status: 'A', path }))

    if (!changes.length && !unpushed.length) {
      if (!last) return null
      git(repo, ['push', '-q', CENTRAL, '--delete', ref])
      git(repo, ['update-ref', '-d', LAST])
      return 'all committed and pushed, removed its copy'
    }

    const keep = []
    const skipped = tooBig.map((path) => ({ path, why: `over ${MAX_FILE >> 20} MB` }))
    const deleted = []
    for (const { status, path } of changes) {
      if (status === 'D') { deleted.push(path); continue }
      const entry = staged.get(path)
      if (!entry) continue
      const why = whySkip(repo, path, entry.mode)
      if (why) skipped.push({ path, why })
      else keep.push({ path, ...entry, size: entry.mode === '160000' ? 0 : statSync(join(repo, path), { throwIfNoEntry: false })?.size ?? 0 })
    }
    keep.sort((a, b) => a.size - b.size)
    let total = 0
    const sent = keep.filter((f) => {
      total += f.size
      if (total <= MAX_TOTAL) return true
      skipped.push({ path: f.path, why: `over the ${MAX_TOTAL >> 20} MB total` })
      return false
    })

    const manifest = {
      repo: slug, computer: COMPUTER, folder: repo, at: new Date().toISOString(),
      branch: maybe(repo, ['rev-parse', '--abbrev-ref', 'HEAD']), head, base,
      unpushed: unpushed.slice(0, 30).map((sha) => out(repo, ['log', '-1', '--format=%h %s', sha])),
      deleted, skipped,
    }
    const manifestBlob = out(repo, ['hash-object', '-w', '--stdin'], { input: JSON.stringify({ ...manifest, at: undefined }, null, 2) })
    const senv = { ...process.env, GIT_INDEX_FILE: snap }
    const info = [...sent.map((f) => `${f.mode} ${f.blob}\t${f.path}`), `100644 ${manifestBlob}\t${MANIFEST}`].join('\0') + '\0'
    git(repo, ['update-index', '-z', '--add', '--index-info'], { env: senv, input: info })
    const tree = out(repo, ['write-tree'], { env: senv })
    if (last && maybe(repo, ['rev-parse', `${last}^{tree}`]) === tree) return 'no change since the last copy'

    // Parentless on purpose: only these files travel, never the project's history.
    const commit = out(repo, ['commit-tree', tree, '-m', `${slug} on ${COMPUTER}, ${manifest.at}`], { env: { ...process.env, ...IDENTITY } })
    git(repo, ['push', '-q', '-f', CENTRAL, `${commit}:${ref}`])
    git(repo, ['update-ref', LAST, commit])
    const bits = [`${sent.length} file(s)`]
    if (deleted.length) bits.push(`${deleted.length} deleted`)
    if (unpushed.length) bits.push(`${unpushed.length} unpushed commit(s)`)
    if (skipped.length) bits.push(`${skipped.length} left out`)
    return `copied ${bits.join(', ')}`
  } finally {
    rmSync(work, { force: true })
    rmSync(snap, { force: true })
  }
}

/** What other computers have for this repo that its main branch does not. */
function pending(repo) {
  const slug = slugOf(repo)
  for (const r of lines(out(repo, ['for-each-ref', '--format=%(refname)', 'refs/wip-others/']))) git(repo, ['update-ref', '-d', r])
  maybe(repo, ['fetch', '-q', '--no-tags', '--no-write-fetch-head', CENTRAL, `+refs/heads/${slug}/*:refs/wip-others/*`])
  const main = mainOf(repo) || 'HEAD'
  const mainFiles = entries(git(repo, ['ls-tree', '-r', '-z', main]), true)
  const res = []
  for (const ref of lines(out(repo, ['for-each-ref', '--format=%(refname)', 'refs/wip-others/']))) {
    const computer = ref.slice('refs/wip-others/'.length)
    if (computer.includes('/') || computer === slotOf(repo)) continue
    let manifest = {}
    try { manifest = JSON.parse(git(repo, ['show', `${ref}:${MANIFEST}`])) } catch {}
    const files = []
    for (const [path, { blob }] of entries(git(repo, ['ls-tree', '-r', '-z', ref]), true)) {
      if (path === MANIFEST) continue
      const inMain = mainFiles.get(path)
      if (!inMain) files.push(`A  ${path}`)
      else if (inMain.blob !== blob) files.push(`M  ${path}`)
    }
    for (const path of manifest.deleted ?? []) if (mainFiles.has(path)) files.push(`D  ${path}`)
    for (const { path, why } of manifest.skipped ?? []) files.push(`?  ${path}  (not copied: ${why})`)
    const when = out(repo, ['log', '-1', '--format=%cr', ref])
    if (files.length) res.push({ computer, ref, when, files, unpushed: manifest.unpushed ?? [], branch: manifest.branch })
  }
  return { main, list: res }
}

function showPending({ main, list }) {
  for (const p of list) {
    console.log(`\n${p.computer} has ${p.files.length} file(s) not in ${main} (copied ${p.when}${p.branch ? `, on ${p.branch}` : ''}):`)
    for (const f of p.files.slice(0, 30)) console.log(`  ${f}`)
    if (p.files.length > 30) console.log(`  … and ${p.files.length - 30} more`)
    if (p.unpushed.length) console.log(`  unpushed commits there: ${p.unpushed.slice(0, 5).join(' | ')}`)
    console.log(`  see one:   git show ${p.ref}:<file>`)
    console.log(`  take one:  git checkout ${p.ref} -- <file>`)
  }
}

function repoHere() {
  const top = maybe(process.cwd(), ['rev-parse', '--show-toplevel'])
  if (!top) {
    console.error('not inside a git repo')
    process.exit(2)
  }
  return resolve(top)
}

function start(repo) {
  if (maybe(repo, ['remote', 'get-url', 'origin'])) maybe(repo, ['fetch', '-q', '--prune', 'origin'])
  console.log(`${COMPUTER}: ${save(repo) ?? 'nothing uncommitted'}`)
  const main = mainOf(repo)
  const branch = out(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (main && branch === main.replace(/^origin\//, '')) {
    const [ahead, behind] = out(repo, ['rev-list', '--left-right', '--count', `HEAD...${main}`]).split(/\s+/).map(Number)
    if (behind && !ahead) {
      try {
        git(repo, ['merge', '-q', '--ff-only', main])
        console.log(`pulled ${behind} commit(s)`)
      } catch (e) {
        console.log(`could not pull ${behind} commit(s): ${errText(e)}`)
      }
    } else if (behind) console.log(`${branch} and ${main} have both moved (${ahead} here, ${behind} there): git pull and resolve`)
    else if (ahead) console.log(`${ahead} commit(s) here are not pushed: git push`)
    else console.log(`${branch} is up to date`)
  } else if (main) console.log(`on ${branch}, not ${main}: not pulling`)
  const p = pending(repo)
  if (p.list.length) showPending(p)
  else console.log('no other computer has work pending here')
}

function check(repo) {
  if (maybe(repo, ['remote', 'get-url', 'origin'])) git(repo, ['fetch', '-q', '--prune', 'origin'])
  const problems = []
  const dirty = lines(out(repo, ['status', '--porcelain']))
  if (dirty.length) problems.push(`${dirty.length} uncommitted file(s) here:\n${dirty.slice(0, 15).map((l) => `    ${l}`).join('\n')}`)
  const main = mainOf(repo)
  const branch = out(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (main) {
    if (branch !== main.replace(/^origin\//, '')) problems.push(`on branch ${branch}, not ${main}`)
    const [ahead, behind] = out(repo, ['rev-list', '--left-right', '--count', `HEAD...${main}`]).split(/\s+/).map(Number)
    if (behind) problems.push(`${behind} commit(s) on GitHub are not here: pull first`)
    if (ahead) problems.push(`${ahead} commit(s) here are not on GitHub: git push`)
  }
  const p = pending(repo)
  for (const o of p.list) problems.push(`${o.computer} has ${o.files.length} file(s) not in ${p.main} (copied ${o.when})`)
  if (!problems.length) return console.log('safe to deploy: committed, pushed, up to date, nothing pending on another computer')
  console.log('NOT safe to deploy from here:\n')
  for (const x of problems) console.log(`  - ${x}`)
  showPending(p)
  if (process.argv.includes('--force')) return console.log('\n--force: going ahead anyway')
  console.log('\nA deploy from here would ship without that work. Add --force to go ahead anyway.')
  process.exit(1)
}

// ── every repo on this computer ───────────────────────────────────────────

function discover(roots) {
  const found = []
  const walk = (dir, depth) => {
    let list
    try { list = readdirSync(dir, { withFileTypes: true }) } catch { return }
    if (list.some((e) => e.name === '.git' && e.isDirectory())) found.push(dir)
    if (depth >= MAX_DEPTH) return
    for (const e of list) {
      if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name) && !e.name.endsWith('.photoslibrary')) walk(join(dir, e.name), depth + 1)
    }
  }
  for (const root of roots) walk(resolve(root), 0)
  const skip = (config.exclude ?? []).map((p) => resolve(p))
  const repos = [...new Set(found)].filter((r) => !skip.some((x) => r === x || r.startsWith(x + '/') || r.startsWith(x + '\\'))).sort()

  // Two folders with the same origin: the one used most recently keeps the plain slot.
  const used = (r) => Math.max(...['index', 'HEAD'].map((f) => statSync(join(r, '.git', f), { throwIfNoEntry: false })?.mtimeMs ?? 0))
  const bySlug = new Map()
  for (const r of repos) bySlug.set(slugOf(r), [...(bySlug.get(slugOf(r)) ?? []), r])
  config.clones = {}
  for (const group of bySlug.values()) {
    if (group.length < 2) continue
    group.sort((a, b) => used(b) - used(a))
    for (const r of group.slice(1)) config.clones[r] = clean(basename(r) === basename(group[0]) ? `${basename(resolve(r, '..'))}-${basename(r)}` : basename(r))
  }
  return repos
}

/** Folders that look like old copies (…backup…), proposed for exclusion at install. */
function backupFolders(roots) {
  const res = new Set()
  for (const r of discover(roots)) {
    const parts = r.split(/[\\/]/)
    const i = parts.findIndex((p) => /backup/i.test(p))
    if (i >= 0) res.add(parts.slice(0, i + 1).join('/') || '/')
  }
  return [...res]
}

function repos() {
  if (!config.repos || Date.now() - (config.reposAt ?? 0) > REDISCOVER_MS) {
    config.repos = discover(config.roots?.length ? config.roots : [homedir()])
    config.reposAt = Date.now()
    writeConfig()
  }
  return config.repos.filter((r) => existsSync(join(r, '.git')))
}

function saveAll() {
  const lock = `${CONFIG_PATH}.lock`
  withLock(lock, () => {
    const t = Date.now()
    let copied = 0
    let failed = 0
    const all = repos()
    for (const repo of all) {
      try {
        const res = save(repo)
        if (res && res !== 'no change since the last copy') {
          console.log(`${stamp()}  ${repo}: ${res}`)
          if (res.startsWith('copied')) copied++
        }
      } catch (e) {
        failed++
        console.log(`${stamp()}  ${repo}: FAILED ${errText(e)}`)
      }
    }
    console.log(`${stamp()}  ${COMPUTER}: checked ${all.length} repos in ${Math.round((Date.now() - t) / 1000)}s, ${copied} copied, ${failed} failed`)
  }, () => console.log(`${stamp()}  another save-all is running`))
}

function list() {
  const byRepo = new Map()
  for (const row of lines(out(process.cwd(), ['ls-remote', '--heads', CENTRAL]))) {
    const name = row.split('\t')[1].replace('refs/heads/', '')
    const cut = name.lastIndexOf('/')
    if (cut < 0) continue
    const slug = name.slice(0, cut)
    byRepo.set(slug, [...(byRepo.get(slug) ?? []), name.slice(cut + 1)])
  }
  if (!byRepo.size) return console.log('nothing pending on any computer')
  const here = new Map((config.repos ?? []).map((r) => [maybe(r, ['config', '--get', 'remote.origin.url']) ? slugOf(r) : null, r]))
  for (const [slug, computers] of [...byRepo].sort()) {
    const others = computers.filter((c) => c !== COMPUTER)
    console.log(`${slug.padEnd(48)} ${computers.join(', ')}${others.length && here.get(slug) ? `   (cd "${here.get(slug)}" && node "${fileURLToPath(import.meta.url)}" start)` : ''}`)
  }
}

function install(args) {
  const asAt = args.indexOf('--as')
  if (asAt >= 0) config.computer = clean(args.splice(asAt, 2)[1])
  config.computer ||= COMPUTER
  config.central ||= CENTRAL
  const roots = args.filter((a) => !a.startsWith('--')).map((a) => resolve(a))
  config.roots = roots.length ? roots : config.roots ?? [homedir()]
  if (!config.exclude) {
    config.exclude = backupFolders(config.roots)
    for (const x of config.exclude) console.log(`not backing up (looks like an old copy): ${x}`)
  }
  delete config.repos
  writeConfig()
  const found = repos()
  console.log(`${config.computer}: ${found.length} repos under ${config.roots.join(', ')}`)
  for (const [r, clone] of Object.entries(config.clones ?? {})) console.log(`second clone, own slot ${config.computer}--${clone}: ${r}`)
  console.log(`edit ${CONFIG_PATH} to change folders or exclusions`)

  const script = fileURLToPath(import.meta.url)
  if (platform() === 'darwin') {
    const label = 'com.wipbackups.autosave'
    const plist = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
    const log = join(homedir(), 'Library', 'Logs', 'wip-backups.log')
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
    writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>
    <string>${esc(process.execPath)}</string><string>${esc(script)}</string><string>save-all</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>${esc(log)}</string>
  <key>StandardErrorPath</key><string>${esc(log)}</string>
</dict></plist>
`)
    const uid = String(process.getuid())
    try { execFileSync('launchctl', ['bootout', `gui/${uid}`, plist], { stdio: 'ignore' }) } catch {}
    execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plist]) // RunAtLoad: first pass starts now
    console.log(`every 5 minutes, in the background\nlog: ${log}`)
  } else if (platform() === 'win32') {
    // Through wscript so no console window flashes up every 5 minutes.
    const dir = join(homedir(), '.wip-backups-run')
    mkdirSync(dir, { recursive: true })
    const vbs = join(dir, 'autosave.vbs')
    const log = join(dir, 'wip-backups.log')
    writeFileSync(vbs, `CreateObject("WScript.Shell").Run "cmd /c """"${process.execPath}"" ""${script}"" save-all >> ""${log}"" 2>&1""", 0, False\r\n`)
    execFileSync('schtasks', ['/Create', '/F', '/SC', 'MINUTE', '/MO', '5', '/TN', 'wip-backups', '/TR', `wscript.exe "${vbs}"`], { stdio: 'inherit' })
    console.log(`every 5 minutes, in the background\nlog: ${log}`)
    saveAll()
  } else {
    console.log(`add to crontab:  */5 * * * * "${process.execPath}" "${script}" save-all >> ~/wip-backups.log 2>&1`)
  }
}

// ── command line ──────────────────────────────────────────────────────────

const [cmd, ...rest] = process.argv.slice(2)
const commands = {
  install: () => install(rest),
  'save-all': saveAll,
  save: () => console.log(`${COMPUTER}: ${save(repoHere()) ?? 'nothing uncommitted'}`),
  start: () => start(repoHere()),
  check: () => check(repoHere()),
  list,
}
if (!commands[cmd]) {
  console.log('usage: node autosave.mjs install [folder ...] [--as name] | save-all | save | start | check [--force] | list')
  process.exit(2)
}
try {
  commands[cmd]()
} catch (e) {
  console.error(`${stamp()}  ${cmd} failed: ${errText(e)}`)
  process.exit(1)
}
