#!/usr/bin/env node
/**
 * Publishes one of the shop's Android apps so the phones offer it as an update.
 *
 *   npm run release:android -- --app counter --notes "What changed, in one line"
 *   npm run release:android -- --app order   --notes "..."
 *   (npm run release:counter-android -- --notes "..." is the counter's)
 *
 * 1. Reads versionCode / versionName from <app folder>/app/build.gradle.kts
 *    (raise both, commit and push first: GitHub builds the APK on that push).
 * 2. Finds the successful GitHub build of a commit with that versionCode
 *    (waits for one still running) and downloads its APK.
 * 3. Makes the release `<tag prefix><versionCode>` on the app's public releases
 *    repo with the APK attached. The app checks that repo's latest release when
 *    it opens (Updater.kt in each app).
 *
 * See docs/shiv-counter-android.md and docs/shiv-order-android.md.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = 'StarkAg/shiv-hardware-erp'
const APPS = {
  counter: {
    title: 'Shiv Counter', dir: 'shiv-counter', apk: 'Shiv_Counter.apk', artifact: 'shiv-counter',
    workflow: 'build-shiv-counter.yml', releases: 'StarkAg/shiv-counter-releases', prefix: 'counter-v',
  },
  order: {
    title: 'Shiv Order', dir: 'shiv-order', apk: 'Shiv_Order.apk', artifact: 'shiv-order',
    workflow: 'build-shiv-order.yml', releases: 'StarkAg/shiv-order-releases', prefix: 'order-v',
  },
}

const args = process.argv.slice(2)
const notesAt = args.indexOf('--notes')
const notes = notesAt >= 0 ? args[notesAt + 1] ?? '' : ''
const appAt = args.indexOf('--app')
const app = APPS[appAt >= 0 ? args[appAt + 1] : '']
if (!app) throw new Error(`Say which app: --app ${Object.keys(APPS).join(' | --app ')}`)
const RELEASES = app.releases
const WORKFLOW = app.workflow
const GRADLE = `${app.dir}/app/build.gradle.kts`

function run(cmd, cmdArgs, { quiet = false, allowFail = false } = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', shell: false })
  if (r.status !== 0 && !allowFail) {
    throw new Error(`${cmd} ${cmdArgs.join(' ')}\n${(r.stderr || r.stdout || '').trim()}`)
  }
  if (!quiet && r.stdout?.trim()) console.log(r.stdout.trim())
  return r
}

function versionOf(text) {
  const code = /versionCode\s*=\s*(\d+)/.exec(text)?.[1]
  const name = /versionName\s*=\s*"([^"]+)"/.exec(text)?.[1]
  return code ? { code: Number(code), name: name ?? code } : null
}

const here = versionOf(readFileSync(join(ROOT, GRADLE), 'utf8'))
if (!here) throw new Error(`No versionCode in ${GRADLE}`)
const tag = `${app.prefix}${here.code}`
console.log(`${app.title} ${here.name} (versionCode ${here.code})`)

// The releases repo: public, so a phone can download without a login.
if (run('gh', ['repo', 'view', RELEASES, '--json', 'name'], { quiet: true, allowFail: true }).status !== 0) {
  console.log(`Making ${RELEASES} (public, releases only)…`)
  run('gh', ['repo', 'create', RELEASES, '--public', '--add-readme',
    '--description', `${app.title} Android app: each release is one APK. The app updates itself from here.`])
}

if (run('gh', ['release', 'view', tag, '--repo', RELEASES, '--json', 'tagName'], { quiet: true, allowFail: true }).status === 0) {
  console.log(`${tag} is already released. To release a change, raise versionCode in ${GRADLE}, push, then run this again.`)
  process.exit(0)
}

// A build of a commit carrying this versionCode.
function builtHere(sha) {
  const r = run('git', ['show', `${sha}:${GRADLE}`], { quiet: true, allowFail: true })
  return r.status === 0 && versionOf(r.stdout)?.code === here.code
}
const runs = JSON.parse(run('gh', ['run', 'list', '--repo', SOURCE, '--workflow', WORKFLOW, '--limit', '15',
  '--json', 'databaseId,headSha,status,conclusion'], { quiet: true }).stdout)
run('git', ['fetch', '-q', 'origin', 'main'], { quiet: true, allowFail: true })
let build = runs.find((r) => r.conclusion === 'success' && builtHere(r.headSha))
if (!build) {
  const going = runs.find((r) => r.status !== 'completed' && builtHere(r.headSha))
  if (!going) {
    throw new Error(`No GitHub build of versionCode ${here.code} yet. Commit and push ${GRADLE} (the push starts the build), then run this again.`)
  }
  console.log(`Waiting for build ${going.databaseId}…`)
  run('gh', ['run', 'watch', String(going.databaseId), '--repo', SOURCE, '--exit-status', '--interval', '20'], { quiet: true })
  build = going
}

const dir = mkdtempSync(join(tmpdir(), `${app.dir}-release-`))
try {
  run('gh', ['run', 'download', String(build.databaseId), '--repo', SOURCE, '-n', app.artifact, '-D', dir], { quiet: true })
  const apk = join(dir, app.apk)
  if (!existsSync(apk)) throw new Error(`The build has no ${app.apk}`)
  run('gh', ['release', 'create', tag, `${apk}#${app.apk}`, '--repo', RELEASES,
    '--title', `${app.title} ${here.name}`,
    '--notes', notes || `${app.title} ${here.name}.`], { quiet: true })
  console.log(`Released ${tag}: the phones offer it the next time the app opens (checked at most every 5 minutes).`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
