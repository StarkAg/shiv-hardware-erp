/**
 * The app's screens, from wherever the newest copy is.
 *
 * The installer carries one copy (dist/). On the shop PC a deploy can also put
 * a newer one in the app's data folder (scripts/deploy.mjs, "screens only"),
 * so a change to the screens reaches the app in seconds: no installer is
 * built and the app stays open. Only a change to the shell itself (this
 * folder, card printing) still needs the installer.
 *
 *   <userData>/screens/current.json   { "dir": "<name>", "builtAt": <ms> }
 *   <userData>/screens/<name>/        a whole dist/, with its build.json
 *
 * Nothing here needs Electron, so it can be run and tested with plain node.
 */
const fs = require('node:fs')
const path = require('node:path')

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/** When a copy of the screens was built (ms), 0 for one from before build.json. */
function builtAt(dir) {
  return Number(readJson(path.join(dir, 'build.json'))?.builtAt) || 0
}

/**
 * The screens to show: the copy put in the data folder when it is newer than
 * the installer's own and its page is really there, else the installer's.
 * `refused` holds build times that failed to load this run.
 */
function pick({ packagedDir, userData, entry, refused = new Set() }) {
  const own = { dir: packagedDir, builtAt: builtAt(packagedDir), packaged: true }
  const home = path.join(userData, 'screens')
  const named = readJson(path.join(home, 'current.json'))
  // A plain folder name only: nothing in that file can point outside screens/.
  if (!named || typeof named.dir !== 'string' || !/^[\w.-]+$/.test(named.dir)) return own
  const dir = path.join(home, named.dir)
  const at = builtAt(dir)
  if (!at || at <= own.builtAt || refused.has(at)) return own
  if (!fs.existsSync(path.join(dir, entry))) return own
  return { dir, builtAt: at, packaged: false }
}

/** Calls back whenever a deploy names new screens. Returns the way to stop. */
function watch(userData, onChange) {
  const file = path.join(userData, 'screens', 'current.json')
  // Polled: the folder may not exist yet, and a rename over the file is one
  // change here where a watcher on the file itself would lose it.
  fs.watchFile(file, { interval: 1500 }, (now, was) => {
    if (now.mtimeMs !== was.mtimeMs) onChange()
  })
  return () => fs.unwatchFile(file)
}

/** Removes every copy of the screens but the ones named. */
function prune(userData, keep) {
  const home = path.join(userData, 'screens')
  let names = []
  try { names = fs.readdirSync(home, { withFileTypes: true }) } catch { return }
  const kept = new Set(keep.map((dir) => path.resolve(dir)))
  for (const entry of names) {
    const dir = path.join(home, entry.name)
    if (!entry.isDirectory() || kept.has(path.resolve(dir))) continue
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* still open somewhere; next time */ }
  }
}

module.exports = { pick, watch, prune, builtAt }
