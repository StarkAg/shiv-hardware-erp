/**
 * Order slips typed out for the shop group (owner's ask, 27 Nov 2026).
 * Sunmica lines only, as "PLK 9615 AMG - 7 pc" (owner, 27 Nov 2026).
 *
 * A bill or order slip photo posted in the shop group with "order" under it
 * (group-print.mjs, readOrder) comes here, to the shop PC. Claude Code on this
 * PC (the desktop app's own claude.exe, signed in once with `claude` then
 * /login) reads the handwriting, and its item lines go back to the group as a
 * reply to the photo, one per line: "<item as written> - <qty>", the way the
 * staff type orders ("PLK 9615 AMG - 7 pc"). No rates, amounts or totals.
 *
 * Not the Anthropic API: the owner asked for a Claude session on this PC.
 */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const ORDER_PROMPT = (file) => [
  `Read the image file ${file}. It is a photo of a handwritten shop bill, order slip or estimate from a hardware and plywood shop in India.`,
  'Type out only the sunmica lines (also written mica, laminate or lam): sheets with a design number. Leave out every other item (plywood, doors, Fevicol, screws, hinges, handles and the rest).',
  'One line per sunmica, top to bottom, exactly in this form:',
  '<brand> <design number> <finish> - <number of sheets> pc',
  'Examples: "PLK 9615 AMG - 7 pc", "PLK 9520 MLT - 4 pc", "PLK 8221 FR - 4 pc".',
  'The brand is the short code written (PLK is Pulkari); when no brand is written, use PLK. Drop the word mica, sunmica or laminate itself. Keep the design number and the finish letters (AMG, MLT, FR, SF, HG and so on) as written, in capitals.',
  'Leave out rates, amounts, totals, the customer name, dates, phone numbers, headings and labour or delivery charges.',
  'If a quantity is missing, write the sunmica alone. If the photo holds no sunmica, answer exactly: NONE',
  'Answer with the lines only: no other words, no numbering, no markdown.',
].join('\n')

/** The newest claude.exe: CLAUDE_EXE, else the desktop app's own copy, else `claude` on PATH. */
export function findClaude(env = process.env) {
  if (env.CLAUDE_EXE && existsSync(env.CLAUDE_EXE)) return env.CLAUDE_EXE
  const base = join(env.LOCALAPPDATA || '', 'Claude-Data')
  const found = []
  try {
    for (const data of readdirSync(base)) {
      const code = join(base, data, 'claude-code')
      if (!existsSync(code)) continue
      for (const version of readdirSync(code)) {
        for (const build of readdirSync(join(code, version))) {
          const exe = join(code, version, build, 'claude.exe')
          if (existsSync(exe)) found.push({ exe, at: statSync(exe).mtimeMs })
        }
      }
    }
  } catch { /* none here */ }
  found.sort((a, b) => b.at - a.at)
  return found[0]?.exe ?? 'claude'
}

/** The item lines Claude gave back, cleaned: no bullets, numbering or blank lines. */
export function orderLines(text) {
  const lines = String(text ?? '').split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/[`*]/g, '').trim())
    .filter(Boolean)
  if (lines.length === 1 && /^none\.?$/i.test(lines[0])) return []
  return lines
}

/**
 * The environment for claude.exe without the print server's API key: .env has
 * ANTHROPIC_API_KEY for other features, and Claude Code prefers it over the
 * PC's sign-in ("Invalid API key", first live test 27 Nov 2026).
 */
export function signedInEnv(env = process.env) {
  const out = { ...env }
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']) delete out[key]
  return out
}

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }

/** Reads one photo: its item lines, or throws. */
export async function readOrderPhoto(buffer, mediaType, { env = process.env, model = env.ORDER_READ_MODEL || 'sonnet', timeoutMs = 180_000 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'shiv-order-'))
  try {
    const file = join(dir, `order${EXT[mediaType] ?? '.jpg'}`)
    await writeFile(file, buffer)
    const stdout = await new Promise((resolve, reject) => {
      execFile(findClaude(env), [
        '-p', ORDER_PROMPT(file),
        '--model', model,
        '--allowedTools', 'Read',
        '--disallowedTools', 'Bash,Edit,Write,WebFetch,WebSearch,NotebookEdit',
      ], { cwd: dir, env: signedInEnv(env), timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out, errOut) => {
        if (err) reject(new Error(String(out || errOut || err.message).trim().slice(0, 300)))
        else resolve(out)
      })
    })
    if (/not logged in|please run \/login/i.test(stdout)) throw new Error('Claude on the shop PC is not signed in')
    return orderLines(stdout)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
