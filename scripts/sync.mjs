// Two computers, one repo. Each computer's uncommitted work is copied to its own
// branch on GitHub (wip/<computer>), so the other computer can see it, and a deploy
// refuses to run while either computer holds work that main does not have.
//
//   node scripts/sync.mjs save      copy uncommitted + unpushed work to origin/wip/<computer>
//   node scripts/sync.mjs start     pull main, then list what the other computer has not committed
//   node scripts/sync.mjs check     exit 1 unless deploying from here is safe (--force to override)
//   node scripts/sync.mjs install   run `save` every 15 minutes on this computer
//
// `save` never touches the working tree, the real index or the current branch: it
// builds the snapshot in a throwaway index, so it is safe while other sessions edit.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, hostname, platform } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const MAIN = 'main'
const MAX_BYTES = 10 * 1024 * 1024 // keep big archives off GitHub
const NEVER = [':(exclude,glob)**/.env*', ':(exclude,glob)**/*.pem', ':(exclude,glob)**/*.key']

const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
const tryGit = (args, opts) => {
  try { return git(args, opts) } catch { return null }
}
const lines = (text) => (text ? text.split('\n').filter(Boolean) : [])
const stamp = () => new Date().toLocaleString('en-IN', { hour12: false })

const computer = (tryGit(['config', 'sync.machine']) || hostname().replace(/\.local$/i, ''))
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const OWN = `wip/${computer}`

/** The whole working tree as a tree object, built in a throwaway index. */
function snapshotTree() {
  const gitDir = git(['rev-parse', '--absolute-git-dir'])
  const index = join(gitDir, 'sync-index')
  if (existsSync(join(gitDir, 'index'))) copyFileSync(join(gitDir, 'index'), index)
  const env = { ...process.env, GIT_INDEX_FILE: index }
  try {
    git(['add', '-A', '--', '.', ...NEVER], { env })
    const added = lines(git(['diff', '--cached', '--name-only', '--diff-filter=A', 'HEAD'], { env }))
    const big = added.filter((f) => {
      try { return statSync(join(ROOT, f)).size > MAX_BYTES } catch { return false }
    })
    if (big.length) git(['rm', '--cached', '-q', '--', ...big], { env })
    return { tree: git(['write-tree'], { env }), big }
  } finally {
    rmSync(index, { force: true })
  }
}

function save() {
  const head = git(['rev-parse', 'HEAD'])
  const { tree, big } = snapshotTree()
  const remote = lines(git(['ls-remote', '--heads', 'origin', OWN]))[0]?.split(/\s+/)[0] ?? ''
  const pushed = tryGit(['rev-parse', '--verify', '-q', `origin/${MAIN}`]) &&
    tryGit(['merge-base', '--is-ancestor', head, `origin/${MAIN}`]) !== null

  if (tree === git(['rev-parse', 'HEAD^{tree}']) && pushed) {
    if (remote) git(['push', '-q', 'origin', '--delete', OWN])
    tryGit(['update-ref', '-d', 'refs/sync/last'])
    console.log(`${stamp()}  ${computer}: everything committed and pushed${remote ? `, removed ${OWN}` : ''}`)
    return
  }
  const last = tryGit(['rev-parse', '--verify', '-q', 'refs/sync/last'])
  if (last && last === remote && git(['rev-parse', `${last}^{tree}`]) === tree && git(['rev-parse', `${last}^`]) === head) {
    console.log(`${stamp()}  ${computer}: no change since the last copy`)
    return
  }
  const commit = git(['commit-tree', tree, '-p', head, '-m', `Uncommitted work on ${computer}, ${stamp()}`])
  git(['push', '-q', '-f', 'origin', `${commit}:refs/heads/${OWN}`])
  git(['update-ref', 'refs/sync/last', commit])
  console.log(`${stamp()}  ${computer}: copied uncommitted work to ${OWN}`)
  for (const f of big) console.log(`  left out (over ${MAX_BYTES >> 20} MB): ${f}`)
}

/** Files each other computer has changed that main does not have yet. */
function others() {
  const refs = lines(git(['for-each-ref', '--format=%(refname:short)|%(committerdate:relative)', 'refs/remotes/origin/wip/']))
  const out = []
  for (const row of refs) {
    const [ref, age] = row.split('|')
    if (ref === `origin/${OWN}`) continue
    const base = tryGit(['merge-base', `origin/${MAIN}`, ref])
    if (!base) continue
    const touched = lines(git(['diff', '--name-only', base, ref]))
    // Only what still differs from main: work already committed there is not at risk.
    const files = touched.length ? lines(git(['diff', '--name-status', `origin/${MAIN}`, ref, '--', ...touched])) : []
    if (files.length) out.push({ name: ref.replace('origin/wip/', ''), ref, age, files })
  }
  return out
}

function showOthers(list) {
  for (const o of list) {
    console.log(`\n${o.name} has ${o.files.length} file(s) not in ${MAIN} (copied ${o.age}):`)
    for (const f of o.files.slice(0, 25)) console.log(`  ${f}`)
    if (o.files.length > 25) console.log(`  … and ${o.files.length - 25} more`)
    console.log(`  see one:   git diff origin/${MAIN} ${o.ref} -- <file>`)
    console.log(`  take one:  git checkout ${o.ref} -- <file>`)
  }
}

function start() {
  git(['fetch', '-q', '--prune', 'origin'])
  save()
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch === MAIN) {
    const [ahead, behind] = git(['rev-list', '--left-right', '--count', `${MAIN}...origin/${MAIN}`]).split(/\s+/).map(Number)
    if (behind && !ahead) {
      try {
        git(['merge', '-q', '--ff-only', `origin/${MAIN}`])
        console.log(`pulled ${behind} commit(s) into ${MAIN}`)
      } catch (e) {
        console.log(`could not pull ${behind} commit(s): ${String(e.stderr || e.message).trim()}`)
      }
    } else if (behind && ahead) {
      console.log(`${MAIN} and origin/${MAIN} have both moved (${ahead} here, ${behind} there): run git pull and resolve`)
    } else if (ahead) {
      console.log(`${ahead} commit(s) here are not pushed: git push`)
    } else {
      console.log(`${MAIN} is up to date`)
    }
  } else {
    console.log(`on branch ${branch}, not ${MAIN}: not pulling`)
  }
  const list = others()
  if (list.length) showOthers(list)
  else console.log('the other computer has nothing uncommitted')
}

function check() {
  git(['fetch', '-q', '--prune', 'origin'])
  const problems = []
  const dirty = lines(git(['status', '--porcelain']))
  if (dirty.length) problems.push(`${dirty.length} uncommitted file(s) here:\n${dirty.slice(0, 15).map((l) => `  ${l}`).join('\n')}`)
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch !== MAIN) problems.push(`on branch ${branch}, not ${MAIN}`)
  const [ahead, behind] = git(['rev-list', '--left-right', '--count', `HEAD...origin/${MAIN}`]).split(/\s+/).map(Number)
  if (behind) problems.push(`${behind} commit(s) on GitHub are not here: npm run sync`)
  if (ahead) problems.push(`${ahead} commit(s) here are not on GitHub: git push`)
  const list = others()
  for (const o of list) problems.push(`${o.name} has ${o.files.length} uncommitted file(s) (copied ${o.age})`)

  if (!problems.length) return console.log('safe to deploy: committed, pushed, up to date, nothing pending elsewhere')
  console.log('NOT safe to deploy from here:\n')
  for (const p of problems) console.log(`- ${p}`)
  showOthers(list)
  if (process.argv.includes('--force')) return console.log('\n--force given: deploying anyway')
  console.log('\nA deploy from here would ship without that work (a Convex deploy deletes functions it does not have).')
  process.exit(1)
}

function install() {
  const script = join(ROOT, 'scripts', 'sync.mjs')
  if (platform() === 'darwin') {
    const label = 'com.shivpanel.autosave'
    const plist = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
    const log = join(homedir(), 'Library', 'Logs', 'shiv-panel-autosave.log')
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
    writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>
    <string>${esc(process.execPath)}</string><string>${esc(script)}</string><string>save</string>
  </array>
  <key>WorkingDirectory</key><string>${esc(ROOT)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${esc(log)}</string>
  <key>StandardErrorPath</key><string>${esc(log)}</string>
</dict></plist>
`)
    const uid = String(process.getuid())
    try { execFileSync('launchctl', ['bootout', `gui/${uid}`, plist], { stdio: 'ignore' }) } catch {}
    execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plist])
    console.log(`every 15 minutes this Mac copies uncommitted work to ${OWN}\nlog: ${log}`)
  } else if (platform() === 'win32') {
    // Through wscript so no console window flashes up every 15 minutes.
    const vbs = join(git(['rev-parse', '--absolute-git-dir']), 'sync-autosave.vbs')
    const log = join(ROOT, '.git', 'sync-autosave.log')
    writeFileSync(vbs, `CreateObject("WScript.Shell").Run "cmd /c """"${process.execPath}"" ""${script}"" save >> ""${log}"" 2>&1""", 0, False\r\n`)
    execFileSync('schtasks', ['/Create', '/F', '/SC', 'MINUTE', '/MO', '15', '/TN', 'Shiv Panel autosave', '/TR', `wscript.exe "${vbs}"`], { stdio: 'inherit' })
    console.log(`every 15 minutes this PC copies uncommitted work to ${OWN}\nlog: ${log}`)
  } else {
    console.log(`add to cron: */15 * * * * cd "${ROOT}" && "${process.execPath}" "${script}" save`)
    return
  }
  save()
}

const commands = { save, start, check, install }
const run = commands[process.argv[2]]
if (!run) {
  console.log('usage: node scripts/sync.mjs save | start | check [--force] | install')
  process.exit(2)
}
try {
  run()
} catch (e) {
  console.error(`${stamp()}  sync ${process.argv[2]} failed: ${String(e.stderr || e.message).trim()}`)
  process.exit(1)
}
