/**
 * The app's screens, from wherever the newest copy is.
 *
 * The installer carries one copy (dist/). A newer one reaches the app's data
 * folder two ways, and neither builds an installer or closes the app:
 *
 *   - the app takes it from the panel website, which serves the very same
 *     build a minute after a push (`fetchNewer`). This is how the apps on the
 *     other counters are updated;
 *   - on the shop PC a deploy copies it straight in (scripts/deploy.mjs,
 *     "screens only"), which is quicker still.
 *
 * Only a change to the shell itself (this folder, card printing) still needs
 * the installer.
 *
 *   <userData>/screens/current.json   { "dir": "<name>", "builtAt": <ms> }
 *   <userData>/screens/<name>/        a whole dist/, with its build.json
 *
 * build.json (vite.config.ts) says when a copy was built, from which commit,
 * and lists every file with its SHA-256.
 *
 * Nothing here needs Electron, so it can be run and tested with plain node.
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/** When a copy of the screens was built (ms; 0 for one from before build.json) and from which commit. */
function stamp(dir) {
  const built = readJson(path.join(dir, 'build.json'))
  return { builtAt: Number(built?.builtAt) || 0, commit: typeof built?.commit === 'string' ? built.commit : '' }
}

/**
 * The screens to show: the copy put in the data folder when it is newer than
 * the installer's own and its page is really there, else the installer's.
 * `refused` holds build times that failed to load this run.
 */
function pick({ packagedDir, userData, entry, refused = new Set() }) {
  const own = { dir: packagedDir, ...stamp(packagedDir), packaged: true }
  const home = path.join(userData, 'screens')
  const named = readJson(path.join(home, 'current.json'))
  // A plain folder name only: nothing in that file can point outside screens/.
  if (!named || typeof named.dir !== 'string' || !/^[\w.-]+$/.test(named.dir)) return own
  const dir = path.join(home, named.dir)
  const put = stamp(dir)
  if (!put.builtAt || put.builtAt <= own.builtAt || refused.has(put.builtAt)) return own
  if (!fs.existsSync(path.join(dir, entry))) return own
  return { dir, ...put, packaged: false }
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex')

/**
 * Takes the screens the website is serving, when they are newer than `have`
 * (what `pick` returns) and of another commit. Every file is checked against
 * the SHA-256 the site's build.json gives for it, and a file this app already
 * holds unchanged is copied rather than fetched, so little comes down the
 * wire. The copy is named in current.json only once it is whole.
 *
 * Returns the new copy's build time, or 0 when there was nothing to take or it
 * could not be taken whole (it is tried again at the next look).
 */
async function fetchNewer({ site, userData, have, refused = new Set(), fetch }) {
  const res = await fetch(`${site}/build.json?t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) return 0
  const remote = await res.json()
  const at = Number(remote?.builtAt) || 0
  if (!at || at <= have.builtAt || refused.has(at)) return 0
  if (remote.commit && remote.commit === have.commit) return 0
  if (!Array.isArray(remote.files) || !remote.files.length) return 0

  const home = path.join(userData, 'screens')
  const dir = path.join(home, String(at))
  const part = `${dir}.part`
  fs.rmSync(part, { recursive: true, force: true })
  try {
    for (const file of remote.files) {
      const parts = String(file?.path ?? '').split('/')
      // Only a plain path inside the copy: no drive, no way up, no empty part.
      if (parts.some((p) => !p || p === '.' || p === '..' || /[\\:\0]/.test(p))) throw new Error(`bad path ${file?.path}`)
      let data = null
      try {
        const held = fs.readFileSync(path.join(have.dir, ...parts))
        if (sha256(held) === file.sha256) data = held
      } catch { /* not held: fetched below */ }
      if (!data) {
        const got = await fetch(`${site}/${parts.map(encodeURIComponent).join('/')}`, { cache: 'no-store' })
        if (!got.ok) throw new Error(`${file.path}: ${got.status}`)
        data = Buffer.from(await got.arrayBuffer())
        // The site moved on to another build while this one was being taken.
        if (sha256(data) !== file.sha256) throw new Error(`${file.path} is not the file build.json lists`)
      }
      const dest = path.join(part, ...parts)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, data)
    }
    fs.writeFileSync(path.join(part, 'build.json'), JSON.stringify(remote))
    fs.rmSync(dir, { recursive: true, force: true })
    fs.renameSync(part, dir)
    fs.writeFileSync(path.join(home, 'current.json.part'), JSON.stringify({ dir: String(at), builtAt: at }))
    fs.renameSync(path.join(home, 'current.json.part'), path.join(home, 'current.json'))
    return at
  } catch {
    fs.rmSync(part, { recursive: true, force: true })
    return 0
  }
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

module.exports = { pick, watch, prune, fetchNewer }
