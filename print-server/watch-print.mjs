/**
 * Folders watched for files that print by themselves, where they are.
 *
 * Unlike the drop folder (DROP_PRINT_DIR), nothing is moved: a matching file
 * in, say, Downloads prints once and stays put. Which files were printed is
 * kept in data/watch-print-seen.json, so a restart never prints one twice.
 * The very first run only notes what is already there; from then on, every
 * new matching file prints, including any that came while the server was off.
 *
 * AUTO_PRINT_WATCH in .env: "folder|name pattern|mode" rules split by ";".
 *   folder   may start with ~ (the user's home)
 *   pattern  * and ? wildcards, case does not matter
 *   mode     bw | color | auto (photos colour, PDFs black and white)
 * "off" turns it off. Default: SBI's downloaded PDFs, black and white
 * (owner's ask, 25 Nov 2026):
 *   ~/Downloads|SBIDocument_*.pdf|bw
 */
import { readdir, readFile, stat, writeFile, open } from 'node:fs/promises'
import { join } from 'node:path'

export const DEFAULT_WATCH = '~/Downloads|SBIDocument_*.pdf|bw'

/** "*.pdf" as a whole-name, case-blind regular expression. */
export function globToRegExp(glob) {
  const body = String(glob).split('').map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('')
  return new RegExp(`^${body}$`, 'i')
}

/** The rules from AUTO_PRINT_WATCH. */
export function parseWatchList(value, home) {
  const text = String(value ?? DEFAULT_WATCH).trim()
  if (!text || /^(off|false|no|0)$/i.test(text)) return []
  const rules = []
  for (const entry of text.split(';')) {
    const [folder, pattern, mode = 'auto'] = entry.split('|').map((s) => s.trim())
    if (!folder || !pattern) continue
    const dir = folder.startsWith('~') ? join(home, folder.slice(1)) : folder
    const m = mode.toLowerCase()
    rules.push({ dir, pattern, match: globToRegExp(pattern), mode: m === 'bw' || m === 'color' ? m : null })
  }
  return rules
}

// Half-downloaded and hidden files never count.
const PARTIAL = /^(~\$|\.)|\.(tmp|crdownload|part|download)$/i

async function unlocked(path) {
  try {
    const handle = await open(path, 'r+')
    await handle.close()
    return true
  } catch {
    return false
  }
}

/**
 * Watches the folders and calls printFile({ path, name, mode }) once for each
 * new matching file, after its size has held steady over two looks (a download
 * still being written is left until it is done).
 */
export function createFolderWatcher({ rules, seenFile, printFile, canPrint = async () => true, log = console.log, intervalMs = 2000 }) {
  const waiting = new Set() // names held back while no printer is usable, said once each
  const steady = new Map() // path -> "size:mtime" at the previous look
  let seen = null // "path|size|mtime" of every file already handled
  let firstRun = false
  let scanning = false
  let timer = null

  async function loadSeen() {
    try {
      seen = new Set(JSON.parse(await readFile(seenFile, 'utf8')))
    } catch {
      seen = new Set()
      firstRun = true
    }
  }
  const saveSeen = () => writeFile(seenFile, JSON.stringify([...seen].slice(-2000))).catch(() => {})

  async function scan() {
    if (scanning) return
    scanning = true
    try {
      if (!seen) await loadSeen()
      const due = []
      const present = new Set()
      for (const rule of rules) {
        const entries = await readdir(rule.dir, { withFileTypes: true }).catch(() => [])
        for (const entry of entries) {
          if (!entry.isFile() || PARTIAL.test(entry.name) || !rule.match.test(entry.name)) continue
          const path = join(rule.dir, entry.name)
          const info = await stat(path).catch(() => null)
          if (!info || info.size === 0) continue
          const key = `${path}|${info.size}|${Math.round(info.mtimeMs)}`
          present.add(path)
          if (seen.has(key)) continue
          if (firstRun) { seen.add(key); continue }
          const signature = `${info.size}:${info.mtimeMs}`
          if (steady.get(path) === signature && await unlocked(path)) due.push({ path, name: entry.name, mode: rule.mode, key })
          steady.set(path, signature)
        }
      }
      for (const path of steady.keys()) if (!present.has(path)) steady.delete(path)
      if (firstRun) {
        firstRun = false
        log(`[watch-print] first look: ${seen.size} matching file(s) already there, left alone`)
        await saveSeen()
      }
      for (const item of due) {
        // No printer usable: leave it unnoted, so it prints once one is back.
        if (!(await canPrint(item))) {
          if (!waiting.has(item.key)) log(`[watch-print] ${item.name}: no printer available, waiting`)
          waiting.add(item.key)
          continue
        }
        waiting.delete(item.key)
        // Noted before printing, so a crash mid-print can never print it twice.
        seen.add(item.key)
        steady.delete(item.path)
        await saveSeen()
        try {
          await printFile(item)
        } catch (err) {
          log(`[watch-print] ${item.name}: not printed (${err?.message ?? err})`)
        }
      }
    } finally {
      scanning = false
    }
  }

  return {
    scan,
    start() {
      if (!rules.length || timer) return
      timer = setInterval(() => { scan().catch((err) => log(`[watch-print] look failed: ${err?.message ?? err}`)) }, intervalMs)
    },
    stop() { clearInterval(timer); timer = null },
  }
}
