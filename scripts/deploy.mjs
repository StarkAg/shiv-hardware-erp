#!/usr/bin/env node
// One deploy for everything the shop runs: works out what changed since each
// part was last deployed, shows the plan, then deploys only those parts.
//
//   npm run deploy                     plan, ask, deploy what changed
//   npm run deploy -- --dry-run        the plan only
//   npm run deploy -- --yes            no question (for scripts)
//   npm run deploy -- --only cash,qr   just these (changed or not)
//   npm run deploy -- --skip app       everything changed except these
//   npm run deploy -- --all            every part, changed or not (not the optional ones)
//   npm run deploy -- --list           the parts and where each one lives
//
// "Last deployed" is read from where each part actually lives, not from this
// machine, so it is right from the Mac and the shop PC alike: Vercel's latest
// production deployment (stamped with the commit it was built from), Railway's
// latest deployment, the latest desktop release on GitHub, the Quotation app
// installed on this PC. Convex keeps no such record, so its last deploy from
// here is kept in .deploy-state.json (an unknown one counts as changed;
// deploying the same functions again is harmless).
//
// Deploys what is committed and pushed: the tree must be clean and on main,
// and commits not yet on GitHub are pushed first (the panel site deploys from
// GitHub, and every stamp below names a commit others can see).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync, rmdirSync, cpSync, statSync, symlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir, hostname, platform } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STATE_FILE = join(ROOT, '.deploy-state.json')
const WIN = platform() === 'win32'
const SHOP_PC = hostname().toLowerCase() === 'hp'

// ── the parts ──────────────────────────────────────────────────────────────
// Folders are matched as git pathspecs. A Vercel site is always deployed with
// its project named outright: four of these folders are not linked to any
// project, and a plain `vercel --prod` there makes a new, wrong one.
const PANEL_SOURCES = ['src', 'public', 'index.html', 'counter.html', 'vite.config.ts', 'tailwind.config.js', 'postcss.config.js', 'package.json', 'package-lock.json', 'convex/_generated', 'tsconfig.json']
// The desktop app's shell: what only its installer can change. Everything
// else it shows is screens, which reach the installed app without one.
const QUOTATION_SHELL = ['electron', 'print-server/template.mjs', 'print-server/tools', 'print-server/data/epson-card.devmode', 'electron-builder.quotation.cjs', 'build']
const RAILWAY_PROJECT = '3204a621-3a84-4ad0-9960-d9195243d081'
const RELEASES_REPO = 'StarkAg/shiv-panel-releases'

const site = (id, dir, project, domain, label) => ({ id, kind: 'vercel', dir, project, domain, label, paths: [dir] })
const TARGETS = [
  { id: 'convex', kind: 'convex', label: 'Convex (cloud database + functions)', paths: ['convex'] },
  { id: 'cloud-api', kind: 'railway', service: 'cloud-api', upload: '.', label: 'Cloud API (Railway)', paths: ['cloud-api'] },
  { id: 'backups', kind: 'railway', service: 'backups', upload: 'backup-job', label: 'Nightly backups (Railway)', paths: ['backup-job'] },
  { id: 'bis', kind: 'railway', service: 'bis-lookup', upload: 'bis-lookup', label: 'BIS lookup (Railway)', paths: ['bis-lookup'] },
  { id: 'panel', kind: 'vercel-git', project: 'shiv-panel', domain: 'shiv-panel.vercel.app', label: 'Panel website', paths: PANEL_SOURCES },
  { id: 'counter', kind: 'vercel', project: 'shiv-counter', domain: 'shivhardware-counter.vercel.app', label: 'Counter website', paths: PANEL_SOURCES, build: 'counter' },
  site('cash', 'cash-web', 'cash-web', 'shivhardware-cash.vercel.app', 'Cashier'),
  site('sort', 'sort-web', 'sort-web', 'shivhardware-sort.vercel.app', 'Sort (naming)'),
  site('attendance', 'attendance-web', 'shivhardware-attendance', 'shivhardware-attendance.vercel.app', 'Attendance'),
  site('inventory', 'inventory-web', 'inventory-web', 'shivhardware-inventory.vercel.app', 'Inventory'),
  site('mica', 'mica-web', 'mica-web', 'shivhardware-mica.vercel.app', 'Mica Match'),
  site('orders', 'order-web', 'order-web', 'shivhardware-orders.vercel.app', 'Orders'),
  site('print', 'print-web', 'print-web', 'shivhardware-print.vercel.app', 'Shiv Print'),
  site('stock', 'stock-web', 'stock-web', 'shivhardware-stock.vercel.app', 'Stock'),
  site('voucher', 'voucher-web', 'shivhardware-voucher', 'shivhardware-voucher.vercel.app', 'Voucher'),
  site('qr', 'qr-redirect', 'gcvf', 'gcvf.vercel.app', 'Guarantee QR link'),
  site('khata', 'khata-web', 'shivhardware-khata', 'shivhardware-khata.vercel.app', 'Shiv Accounts (accounts to read)'),
  site('mechanic', 'mechanic-web', 'shivhardware-mechanic', 'shivhardware-mechanic.vercel.app', 'Shiv Mechanic (site sizes)'),
  { ...site('billshoot', 'billshoot-web', 'billshoot-web', 'shivhardware-billshoot.vercel.app', 'Bill Shoot'), optional: 'not live yet: its page model is still training' },
  { id: 'print-server', kind: 'print-server', label: 'Print server (shop PC)', paths: ['print-server'] },
  { id: 'quotation', kind: 'quotation', label: 'Shiv Counter app (shop PC)', paths: [...PANEL_SOURCES, 'electron', 'print-server/template.mjs', 'electron-builder.quotation.cjs'] },
  { id: 'app', kind: 'release', label: 'Shiv Hardware Panel app (counter PCs)', paths: [...PANEL_SOURCES, 'electron', 'print-server/template.mjs'] },
]

// ── small helpers ──────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const list = (name) => (args.includes(name) ? String(args[args.indexOf(name) + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : null)
const ONLY = list('--only')
const SKIP = list('--skip') ?? []
const YES = flag('--yes') || flag('-y')
const DRY = flag('--dry-run')
const ALL = flag('--all')

const c = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : String(s))
const bold = c(1), dim = c(2), green = c(32), red = c(31), yellow = c(33)
const log = (...a) => console.log(...a)

function git(...a) {
  const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${(r.stderr || r.stdout).trim()}`)
  return r.stdout.trim()
}

// npm, npx and railway are .cmd shims on Windows, which only start through the
// shell; everything else starts directly, so its arguments reach it untouched.
const SHIMS = new Set(['npm', 'npx', 'railway'])

/** Runs a command; resolves with its output, rejects with the tail of it. */
function run(cmd, cmdArgs, { cwd = ROOT, env, show = false, timeout = 20 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    // Through the shell the line is one string, so each argument is quoted into it.
    const viaShell = WIN && SHIMS.has(cmd)
    const quoted = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`)
    const child = viaShell
      ? spawn([cmd, ...cmdArgs].map(quoted).join(' '), { cwd, env: { ...process.env, ...env }, shell: true, windowsHide: true })
      : spawn(cmd, cmdArgs, { cwd, env: { ...process.env, ...env }, windowsHide: true })
    let out = ''
    const take = (d) => { out += d; if (show) process.stdout.write(d) }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${cmd} timed out`)) }, timeout)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`${cmd} ${cmdArgs.slice(0, 3).join(' ')} failed (${code}):\n${out.trim().split('\n').slice(-15).join('\n')}`))
    })
  })
}

function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}
const state = readJson(STATE_FILE, {})
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n')

/** The newest commit on HEAD at or before a time, or '' when history starts later. */
function commitAt(when) {
  if (!when) return ''
  try { return git('rev-list', '-1', `--before=${new Date(when).toISOString()}`, 'HEAD') } catch { return '' }
}

/** Files under a part's paths changed between a commit and HEAD. */
function changedSince(base, paths) {
  if (!base) return null // unknown: treated as changed
  try { git('cat-file', '-e', `${base}^{commit}`) } catch { return null }
  const out = git('diff', '--name-only', base, 'HEAD', '--', ...paths)
  return out ? out.split('\n') : []
}

// ── Vercel ─────────────────────────────────────────────────────────────────
const vercelAuthFile = [
  join(process.env.APPDATA ?? '', 'xdg.data', 'com.vercel.cli', 'auth.json'),
  join(homedir(), 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'),
  join(homedir(), '.local', 'share', 'com.vercel.cli', 'auth.json'),
].find((f) => existsSync(f))
// Read when needed, not at start: the CLI's login expires and is renewed by
// running the CLI (see refreshVercelLogin), which writes a new token here.
let VERCEL_TOKEN = vercelAuthFile ? readJson(vercelAuthFile)?.token : null
async function refreshVercelLogin() {
  await run('npx', ['vercel', 'whoami']).catch(() => {})
  if (vercelAuthFile) VERCEL_TOKEN = readJson(vercelAuthFile)?.token ?? VERCEL_TOKEN
}
const VERCEL_TEAM = readJson(join(ROOT, '.vercel', 'project.json'))?.orgId

async function vercelApi(path, init = {}) {
  if (!VERCEL_TOKEN) throw new Error('Vercel login not found — run `npx vercel login`')
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`https://api.vercel.com${path}${VERCEL_TEAM ? `${sep}teamId=${VERCEL_TEAM}` : ''}`, {
    ...init,
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json', ...init.headers },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Vercel ${path}: ${json?.error?.message ?? res.status}`)
  return json
}

const projectIds = new Map()
async function vercelProjectId(name) {
  if (!projectIds.has(name)) projectIds.set(name, (await vercelApi(`/v9/projects/${encodeURIComponent(name)}`)).id)
  return projectIds.get(name)
}

async function latestProduction(project) {
  const id = await vercelProjectId(project)
  const { deployments } = await vercelApi(`/v6/deployments?projectId=${id}&target=production&limit=10`)
  return deployments.find((d) => d.state === 'READY' || d.readyState === 'READY') ?? null
}

/** The commit a project's live production deployment was built from (stamped, from GitHub, or by its time). */
async function vercelBaseline(project) {
  const d = await latestProduction(project)
  if (!d) return { base: '', when: null }
  const sha = d.meta?.gitSha || d.meta?.githubCommitSha
  return { base: sha || commitAt(d.created), when: d.created, stamped: !!sha }
}

async function waitForDeployment(project, sha, { timeoutMs = 10 * 60_000 } = {}) {
  const id = await vercelProjectId(project)
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const { deployments } = await vercelApi(`/v6/deployments?projectId=${id}&target=production&limit=10`)
    const d = deployments.find((x) => (x.meta?.gitSha || x.meta?.githubCommitSha) === sha)
    const st = d?.state ?? d?.readyState
    if (st === 'READY') return d
    if (st === 'ERROR' || st === 'CANCELED') throw new Error(`deployment ${d.url} ${st}`)
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error(`no ready deployment of ${sha.slice(0, 7)} after ${Math.round(timeoutMs / 60000)} min`)
}

async function checkUp(domain) {
  const res = await fetch(`https://${domain}/`, { redirect: 'manual' }).catch((e) => ({ status: 0, statusText: e.message }))
  if (res.status === 0 || res.status >= 500) throw new Error(`https://${domain}/ answered ${res.status} ${res.statusText ?? ''}`)
  return res.status
}

/** Removes a folder, retrying while Windows still holds it; never fails a deploy over it. */
function tidy(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) } catch { /* left for next time */ }
}

/**
 * HEAD checked out beside the repo (a git worktree) and built there, so a
 * build never picks up uncommitted edits. It borrows the repo's node_modules
 * through a link, which is taken away first when the copy is removed — the
 * link, never what it points at.
 */
const COMMITTED_TREE = join(ROOT, '.deploy-tree')
function dropCommittedTree() {
  try { rmdirSync(join(COMMITTED_TREE, 'node_modules')) } catch { /* no link there */ }
  try { git('worktree', 'remove', '--force', COMMITTED_TREE) } catch { /* not a worktree any more */ }
  if (existsSync(COMMITTED_TREE) && !existsSync(join(COMMITTED_TREE, 'node_modules'))) tidy(COMMITTED_TREE)
  try { git('worktree', 'prune') } catch { /* nothing to prune */ }
}
async function buildCommitted() {
  dropCommittedTree()
  git('worktree', 'add', '--detach', COMMITTED_TREE, 'HEAD')
  symlinkSync(join(ROOT, 'node_modules'), join(COMMITTED_TREE, 'node_modules'), 'junction')
  await run('npm', ['run', 'build'], { cwd: COMMITTED_TREE })
  return COMMITTED_TREE
}

async function deployVercel(t, sha) {
  const deployArgs = ['vercel', 'deploy', '--prod', '--yes', '--project', t.project, '--meta', `gitSha=${sha}`]
  if (t.build === 'counter') {
    // The counter is the panel's own build with counter.html as its index. It
    // is deployed from the repo with the folder named, not from inside it:
    // run from inside, Windows keeps the folder in use and it cannot be removed.
    //
    // Built from a clean copy of the commit (buildCommitted), not from the
    // working folder: what goes live is what is on GitHub, whatever somebody
    // has half-edited here.
    const out = join(ROOT, '.counter-dist')
    const tree = await buildCommitted()
    try {
      tidy(out)
      cpSync(join(tree, 'dist'), out, { recursive: true })
      cpSync(join(out, 'counter.html'), join(out, 'index.html'))
      await run('npx', [...deployArgs.slice(0, 2), '.counter-dist', ...deployArgs.slice(2)])
    } finally {
      tidy(out)
      dropCommittedTree()
    }
  } else {
    await run('npx', deployArgs, { cwd: t.dir ? join(ROOT, t.dir) : ROOT })
  }
  const d = await waitForDeployment(t.project, sha)
  // A production deploy takes the project's own domains; a shop domain set by
  // hand (shivhardware-*.vercel.app) has to be moved onto it every time.
  await vercelApi(`/v2/deployments/${d.uid}/aliases`, { method: 'POST', body: JSON.stringify({ alias: t.domain }) })
  await checkUp(t.domain)
  return `https://${t.domain}`
}

async function verifyVercelGit(t, sha) {
  const d = await waitForDeployment(t.project, sha)
  await checkUp(t.domain)
  return `https://${t.domain} (${d.url})`
}

// ── Railway ────────────────────────────────────────────────────────────────
const railwayUser = readJson(join(homedir(), '.railway', 'config.json'))?.user
const RAILWAY_TOKEN = railwayUser?.token || railwayUser?.accessToken

async function railwayDeployments() {
  if (!RAILWAY_TOKEN) throw new Error('Railway login not found — run `railway login`')
  const query = `query{project(id:"${RAILWAY_PROJECT}"){services{edges{node{name serviceInstances{edges{node{latestDeployment{status createdAt meta}}}}}}}}}`
  const res = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RAILWAY_TOKEN}` },
    body: JSON.stringify({ query }),
  })
  const json = await res.json()
  if (json.errors) throw new Error(`Railway: ${json.errors[0]?.message}`)
  const out = new Map()
  for (const { node } of json.data.project.services.edges) {
    out.set(node.name, node.serviceInstances.edges[0]?.node?.latestDeployment ?? null)
  }
  return out
}

async function deployRailway(t, sha) {
  const pathArgs = t.upload === '.' ? [] : [t.upload, '--path-as-root']
  // --ci streams the build and exits non-zero when it fails, so a broken build is a failure here.
  await run('railway', ['up', ...pathArgs, '--project', RAILWAY_PROJECT, '--service', t.service, '--environment', 'production', '--ci', '--message', `deploy@${sha.slice(0, 7)}`], { timeout: 30 * 60_000 })
  return `Railway ${t.service}`
}

// ── desktop and shop PC ────────────────────────────────────────────────────
// Shiv Counter (renamed from Shiv Quotation 2026-10-10). Same appId, so the
// installer upgrades in place: an existing install stays in the old folder.
const QUOTATION_DIR = ['Shiv Quotation', 'Shiv Counter']
  .map((name) => join(process.env.LOCALAPPDATA ?? '', 'Programs', name))
  .find((dir) => existsSync(join(dir, 'Shiv Counter.exe')) || existsSync(join(dir, 'Shiv Quotation.exe')))
  ?? join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Shiv Counter')

/**
 * Screens only: the build copied into the installed app's data folder, where
 * the app finds it (electron/screens.cjs). No installer, and the app stays
 * open: it asks to update, or shows the new screens when it next opens.
 */
async function pushQuotationScreens() {
  // The sites built from this same commit have already been type-checked.
  await run('npx', ['vite', 'build'], { timeout: 10 * 60_000 })
  const built = readJson(join(ROOT, 'dist', 'build.json'))
  if (!built?.builtAt) throw new Error('dist/build.json is missing after the build')
  const home = join(process.env.APPDATA ?? '', 'Shiv Quotation', 'screens')
  const name = String(built.builtAt)
  cpSync(join(ROOT, 'dist'), join(home, name), { recursive: true })
  // Written last and put in place whole: the app watches this file.
  writeFileSync(join(home, 'current.json.part'), JSON.stringify({ dir: name, builtAt: built.builtAt }))
  renameSync(join(home, 'current.json.part'), join(home, 'current.json'))
  return 'screens updated, no installer: the app asks to update (or shows them when next opened)'
}

async function deployQuotation(quick = false) {
  if (quick) return pushQuotationScreens()
  const env = { ELECTRON_RUN_AS_NODE: '' }
  await run('npm', ['run', 'dist:quotation'], { env, timeout: 30 * 60_000 })
  const version = readJson(join(ROOT, 'package.json')).version
  const setup = join(ROOT, 'release-quotation', `Shiv-Counter-Setup-${version}.exe`)
  const ps = (script) => run('powershell.exe', ['-NoProfile', '-Command', script])
  // Closed gracefully first, so a card being typed is not lost to a kill. The
  // `exit 0`: finding no app left to stop sets PowerShell's error flag, which
  // read as a failure and left the app closed and not reinstalled (2026-10-09).
  await ps(`Get-Process 'Shiv Counter','Shiv Quotation' -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }; Start-Sleep 3; Get-Process 'Shiv Counter','Shiv Quotation' -ErrorAction SilentlyContinue | Stop-Process -Force; exit 0`)
  await ps(`Start-Process -Wait '${setup}' -ArgumentList '/S'`)
  // ELECTRON_RUN_AS_NODE (set in some shells) makes the app exit at once.
  await ps(`Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; Start-Process '${join(QUOTATION_DIR, 'Shiv Counter.exe')}'`)
  return `installed ${version} and reopened`
}

async function latestRelease() {
  const r = spawnSync('gh', ['release', 'list', '--repo', RELEASES_REPO, '--limit', '10', '--json', 'tagName,publishedAt,isDraft'], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`gh: ${(r.stderr || '').trim() || 'not available'} — run \`gh auth login\``)
  return JSON.parse(r.stdout).find((x) => !x.isDraft) ?? null
}

async function releaseApp() {
  if (!WIN) throw new Error('the Windows installer is built on Windows — run this part on the shop PC')
  const pkgFile = join(ROOT, 'package.json')
  const pkg = readJson(pkgFile)
  const [a, b, p] = pkg.version.split('.').map(Number)
  const version = `${a}.${b}.${p + 1}`
  // Only the version line changes, so the file keeps its formatting.
  writeFileSync(pkgFile, readFileSync(pkgFile, 'utf8').replace(`"version": "${pkg.version}"`, `"version": "${version}"`))
  git('add', 'package.json')
  git('commit', '-m', `Release v${version}`)
  // Another machine may have pushed while the earlier parts deployed.
  try { git('push', 'origin', 'main') } catch {
    git('pull', '--rebase', '-q', 'origin', 'main')
    git('push', 'origin', 'main')
  }
  const token = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' }).stdout.trim()
  await run('npm', ['run', 'release:win'], { env: { GH_TOKEN: token, ELECTRON_RUN_AS_NODE: '' }, timeout: 40 * 60_000 })
  // electron-builder publishes a draft; the counters' updater never sees a draft.
  await run('gh', ['release', 'edit', `v${version}`, '--repo', RELEASES_REPO, '--draft=false', '--latest'])
  return `v${version} published — counter PCs update on their next start`
}

async function checkPrintServer() {
  if (!SHOP_PC) return 'runs on the shop PC: `git pull` there (it reloads itself)'
  const res = await fetch('http://localhost:3333/status').catch(() => null)
  const json = await res?.json().catch(() => null)
  if (!json?.ok) throw new Error('print server not answering on localhost:3333')
  return 'running the pulled code (reloads itself)'
}

// ── what each part last deployed ───────────────────────────────────────────
async function baselines() {
  const out = new Map()
  let railway = null
  const railwayOnce = async () => (railway ??= await railwayDeployments())
  await Promise.all(TARGETS.map(async (t) => {
    try {
      if (t.kind === 'vercel' || t.kind === 'vercel-git') {
        out.set(t.id, await vercelBaseline(t.project))
      } else if (t.kind === 'railway') {
        const d = (await railwayOnce()).get(t.service)
        const sha = String(d?.meta?.deploymentMessage ?? '').match(/deploy@([0-9a-f]{7,40})/)?.[1]
        out.set(t.id, { base: sha ? git('rev-parse', sha) : commitAt(d?.createdAt), when: d?.createdAt, stamped: !!sha })
      } else if (t.kind === 'convex') {
        out.set(t.id, { base: state.convex?.sha ?? '', when: state.convex?.at, stamped: !!state.convex })
      } else if (t.kind === 'quotation') {
        const asar = join(QUOTATION_DIR, 'resources', 'app.asar')
        if (!SHOP_PC || !existsSync(asar)) out.set(t.id, { skip: 'only on the shop PC, where it is installed' })
        else {
          // The commit installed by this script when it is the installed build;
          // a build installed by hand is dated by the file, which can only over-count.
          const when = statSync(asar).mtime
          const mine = state.quotation && Math.abs(new Date(state.quotation.at) - when) < 10 * 60_000
          // Screens put in since that install count as deployed too. And when the
          // installed shell takes screens and nothing of the shell has changed
          // since, screens are all this deploy needs: no installer.
          const pushed = mine ? state.quotationScreens : null
          const shell = mine && state.quotation.screens ? changedSince(state.quotation.sha, QUOTATION_SHELL) : null
          out.set(t.id, {
            base: pushed?.sha ?? (mine ? state.quotation.sha : commitAt(when)),
            when: pushed?.at ?? when,
            stamped: mine,
            quick: Array.isArray(shell) && shell.length === 0,
          })
        }
      } else if (t.kind === 'release') {
        const r = await latestRelease()
        out.set(t.id, { base: commitAt(r?.publishedAt), when: r?.publishedAt, note: r?.tagName })
      } else if (t.kind === 'print-server') {
        out.set(t.id, { base: state['print-server']?.sha ?? '', when: state['print-server']?.at })
      }
    } catch (err) {
      out.set(t.id, t.optional ? { skip: t.optional } : { error: err.message })
    }
  }))
  return out
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  if (flag('--list')) {
    for (const t of TARGETS) log(`${bold(t.id.padEnd(13))} ${t.label}${t.domain ? dim(`  https://${t.domain}`) : ''}${t.optional ? yellow(`  (optional: ${t.optional})`) : ''}`)
    return
  }
  for (const id of [...(ONLY ?? []), ...SKIP]) {
    if (!TARGETS.some((t) => t.id === id)) throw new Error(`no part called "${id}" — see --list`)
  }

  // Committed, on main and on GitHub, so every stamp names a commit anyone can check out.
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  if (branch !== 'main') throw new Error(`on ${branch}; deploys go from main`)
  // Uncommitted edits hold back only the parts they would go into. A site
  // uploads its own folder; the panel site and the counter are built from the
  // commit itself (GitHub, or a clean copy), so nothing here reaches them.
  const dirtyFiles = git('status', '--porcelain', '--untracked-files=no').split('\n')
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, '')).filter(Boolean)
  const dirtyFor = (t) => (t.kind === 'vercel-git' || t.build === 'counter' || t.kind === 'print-server'
    ? []
    : dirtyFiles.filter((f) => t.paths.some((p) => f === p || f.startsWith(`${p}/`))))
  if (dirtyFiles.length) log(yellow(`(uncommitted here: ${dirtyFiles.join(', ')} — parts they would go into are held back)`))
  git('fetch', '-q', 'origin', 'main')
  const behind = Number(git('rev-list', '--count', 'HEAD..origin/main'))
  if (behind) throw new Error(`GitHub has ${behind} commit(s) this copy lacks — pull first`)
  const ahead = Number(git('rev-list', '--count', 'origin/main..HEAD'))
  const sha = git('rev-parse', 'HEAD')

  log(dim(`Reading what each part last deployed…`))
  await refreshVercelLogin()
  const base = await baselines()

  const plan = TARGETS.map((t) => {
    const b = base.get(t.id) ?? {}
    const named = ONLY?.includes(t.id)
    let files = b.error || b.skip ? [] : changedSince(b.base, t.paths)
    let action
    if (SKIP.includes(t.id)) action = 'skip'
    else if (ONLY && !named) action = 'skip'
    else if (b.skip) action = 'n/a'
    else if (b.error) action = 'error'
    else if (dirtyFor(t).length) { action = 'held'; b.held = `uncommitted: ${dirtyFor(t).join(', ')}` }
    else if (t.optional && !named) action = files === null || files.length ? 'optional' : 'up to date'
    else if (named || ALL || files === null || files.length) action = 'deploy'
    else action = 'up to date'
    // The panel site deploys itself from GitHub; for it "deploy" means push and wait.
    if (action === 'deploy' && t.kind === 'vercel-git' && !ahead && !(files === null || files.length)) action = 'up to date'
    return { t, b, files, action }
  })

  log('')
  log(bold('Part'.padEnd(13)) + bold('Last deployed'.padEnd(31)) + bold('Changed'.padEnd(10)) + bold('Action'))
  for (const { t, b, files, action } of plan) {
    const when = b.when ? new Date(b.when).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
    const changed = b.error || b.skip ? '—' : files === null ? 'unknown' : String(files.length)
    const tint = action === 'deploy' ? green : action === 'error' ? red : action === 'optional' || action === 'held' ? yellow : dim
    const why = b.error ?? b.skip ?? b.held ?? (action === 'optional' ? t.optional : b.quick && action === 'deploy' ? 'screens only: no installer' : '') ?? ''
    log(`${t.id.padEnd(13)}${(when + (b.note ? ` ${b.note}` : '')).slice(0, 30).padEnd(31)}${changed.padEnd(10)}${tint(action)}${why ? dim(`  ${why}`) : ''}`)
  }
  const todo = plan.filter((p) => p.action === 'deploy')
  log('')
  if (ahead) log(`${yellow('push')} ${ahead} commit(s) to GitHub first`)
  if (!todo.length) { log(green('Nothing to deploy — every part is up to date.')); return }
  log(`Deploying ${bold(todo.map((p) => p.t.id).join(', '))} at ${sha.slice(0, 7)}.`)
  if (DRY) return
  if (!YES) {
    if (!process.stdin.isTTY) throw new Error('not a terminal: pass --yes to deploy without asking')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = (await rl.question('Go ahead? [y/N] ')).trim().toLowerCase()
    rl.close()
    if (answer !== 'y' && answer !== 'yes') { log('Nothing deployed.'); return }
  }

  if (ahead) { git('push', 'origin', 'main'); log(green(`OK pushed ${ahead} commit(s)`)) }

  // Backends first (a site may need a new function), then the sites, then the
  // apps — the desktop release last, as it adds a commit of its own.
  const order = ['convex', 'railway', 'print-server', 'vercel', 'vercel-git', 'quotation', 'release']
  const results = []
  const runOne = async ({ t, b }) => {
    const started = Date.now()
    try {
      let where
      if (t.kind === 'convex') { await run('npm', ['run', 'deploy:convex'], { timeout: 15 * 60_000 }); where = 'Convex prod' }
      else if (t.kind === 'railway') where = await deployRailway(t, sha)
      else if (t.kind === 'vercel') where = await deployVercel(t, sha)
      else if (t.kind === 'vercel-git') where = await verifyVercelGit(t, sha)
      else if (t.kind === 'quotation') where = await deployQuotation(b.quick)
      else if (t.kind === 'release') where = await releaseApp()
      else if (t.kind === 'print-server') where = await checkPrintServer()
      if (t.kind === 'quotation' && b.quick) { state.quotationScreens = { sha, at: new Date().toISOString() }; saveState() }
      else if (t.kind === 'quotation') { state.quotation = { sha, at: new Date().toISOString(), screens: true }; delete state.quotationScreens; saveState() }
      else if (['convex', 'print-server'].includes(t.kind)) { state[t.id] = { sha, at: new Date().toISOString() }; saveState() }
      results.push({ t, ok: true, where, secs: Math.round((Date.now() - started) / 1000) })
      log(`${green('OK')} ${t.id.padEnd(13)} ${where} ${dim(`${Math.round((Date.now() - started) / 1000)}s`)}`)
    } catch (err) {
      results.push({ t, ok: false, where: err.message, secs: Math.round((Date.now() - started) / 1000) })
      log(`${red('ERROR')} ${t.id.padEnd(13)} ${err.message.split('\n')[0]}`)
    }
  }
  for (const kind of order) {
    const group = todo.filter((p) => p.t.kind === kind)
    // Sites go three at a time; everything else one by one.
    const width = kind === 'vercel' ? 3 : 1
    for (let i = 0; i < group.length; i += width) await Promise.all(group.slice(i, i + width).map(runOne))
  }

  const failed = results.filter((r) => !r.ok)
  log('')
  if (!failed.length) { log(green(bold(`All ${results.length} deployed.`))); return }
  log(red(bold(`${failed.length} of ${results.length} failed:`)))
  for (const r of failed) log(`${red(r.t.id)}\n${r.where.split('\n').map((l) => `  ${l}`).join('\n')}`)
  process.exitCode = 1
}

main().catch((err) => { console.error(red(`ERROR ${err.message}`)); process.exitCode = 1 })
