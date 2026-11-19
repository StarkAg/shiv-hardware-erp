#!/usr/bin/env node
/**
 * Publishes the Shiv Counter Android app so the phones offer it as an update.
 *
 *   npm run release:counter-android -- --notes "What changed, in one line"
 *
 * 1. Reads versionCode / versionName from shiv-counter/app/build.gradle.kts
 *    (raise both, commit and push first: GitHub builds the APK on that push).
 * 2. Finds the successful "Build Shiv Counter" run of a commit with that
 *    versionCode (waits for one still running) and downloads its APK.
 * 3. Makes the release `counter-v<versionCode>` on the public repo
 *    StarkAg/shiv-counter-releases with the APK attached. The app checks that
 *    repo's latest release when it opens (shiv-counter/.../Updater.kt).
 *
 * The phones' screens never need this: they come from the Counter website.
 * Only a change inside shiv-counter/ does. See docs/shiv-counter-android.md.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RELEASES = 'StarkAg/shiv-counter-releases'
const WORKFLOW = 'build-shiv-counter.yml'
const GRADLE = 'shiv-counter/app/build.gradle.kts'

const args = process.argv.slice(2)
const notesAt = args.indexOf('--notes')
const notes = notesAt >= 0 ? args[notesAt + 1] ?? '' : ''

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
const tag = `counter-v${here.code}`
console.log(`Shiv Counter ${here.name} (versionCode ${here.code})`)

// The releases repo: public, so a phone can download without a login.
if (run('gh', ['repo', 'view', RELEASES, '--json', 'name'], { quiet: true, allowFail: true }).status !== 0) {
  console.log(`Making ${RELEASES} (public, releases only)…`)
  run('gh', ['repo', 'create', RELEASES, '--public', '--add-readme',
    '--description', 'Shiv Counter Android app: each release is one APK. The app updates itself from here.'])
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
const runs = JSON.parse(run('gh', ['run', 'list', '--workflow', WORKFLOW, '--limit', '15',
  '--json', 'databaseId,headSha,status,conclusion'], { quiet: true }).stdout)
run('git', ['fetch', '-q', 'origin', 'main'], { quiet: true, allowFail: true })
let build = runs.find((r) => r.conclusion === 'success' && builtHere(r.headSha))
if (!build) {
  const going = runs.find((r) => r.status !== 'completed' && builtHere(r.headSha))
  if (!going) {
    throw new Error(`No GitHub build of versionCode ${here.code} yet. Commit and push ${GRADLE} (the push starts the build), then run this again.`)
  }
  console.log(`Waiting for build ${going.databaseId}…`)
  run('gh', ['run', 'watch', String(going.databaseId), '--exit-status', '--interval', '20'], { quiet: true })
  build = going
}

const dir = mkdtempSync(join(tmpdir(), 'shiv-counter-release-'))
try {
  run('gh', ['run', 'download', String(build.databaseId), '-n', 'shiv-counter', '-D', dir], { quiet: true })
  const apk = join(dir, 'Shiv_Counter.apk')
  if (!existsSync(apk)) throw new Error('The build has no Shiv_Counter.apk')
  run('gh', ['release', 'create', tag, `${apk}#Shiv_Counter.apk`, '--repo', RELEASES,
    '--title', `Shiv Counter ${here.name}`,
    '--notes', notes || `Shiv Counter ${here.name}.`], { quiet: true })
  console.log(`Released ${tag}: the phones offer it the next time the app opens (checked at most once an hour).`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
