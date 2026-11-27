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
 *
 * The same file is in whatsapp-reminders/: on Railway the Shop number reads the
 * photo itself (Claude Code installed in its Dockerfile, signed in by
 * CLAUDE_CODE_OAUTH_TOKEN), so it works with the PC off; this PC is the
 * fallback. Change one, copy it to the other.
 */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Claude's whole system prompt for a read: its answer is posted in the group word for word. */
export const ORDER_SYSTEM = [
  'You type out handwritten shop bills for a hardware and plywood shop. Open the image with the Read tool.',
  'Your answer is posted in a WhatsApp group exactly as you write it, so it holds the item lines and nothing else:',
  'no notes, no doubts, no explanations, no headings, no blank lines between items. When a word is hard to read, give your best reading and say nothing about it.',
].join('\n')

export const ORDER_PROMPT = (file) => [
  `Read the image file ${file}. It is a photo of a handwritten shop bill, order slip or estimate from a hardware and plywood shop in India.`,
  'Type out only what is bought from the suppliers: plywood and flush doors, sunmica, and 3D doors, each as below. Leave out every other item (WPC chowkat and WPC doors, Fevicol, tape, screws, hinges, handles, aldrops, TB, nails, nut bolts, rubber, fitting accessories and the rest).',
  'Plywood, boards and flush doors (a thickness in mm, a grade, a size): one line per bill line, in this form:',
  '<thickness> <grade> <size> - <pieces> pc',
  'Examples: "18mm MS Solid 7x4 - 5 pc", "12mm MS 7x4 - 5 pc", "19mm S 7x4 - 5 pc", "32mm SG 78x32 - 1 pc".',
  'The grade is rewritten the way the shop types it: SGC on the bill is typed SG; SG on the bill is typed S; S stays S. Other grade words (MS, Solid, BWP, Comm) stay as written. Keep the thickness and the size as written (30mm stays 30mm).',
  'Sunmica: the lines with a sunmica design number (a 3 or 4 digit number followed by finish letters such as CU, AMG, MLT, FR, SF, SM, HG). That is loose sunmica sheets (written mica, sunmica, laminate or lam) and doors made with a sunmica (a door code such as DDSM or DD SM, then the design number and finish, then the door size).',
  'Sunmica exactly in this form, one line per sunmica:',
  '<design number> <finish> - <total pieces> pc',
  'Examples: "9165 CU - 9 pc", "8221 FR - 4 pc", "9615 AMG - 7 pc".',
  'Drop door codes (DDSM), sizes and the words mica, sunmica or laminate. Add up the pieces of every line with the same design number and finish into one line: nine DDSM 9165 CU doors of different sizes, 1 pc each, are "9165 CU - 9 pc".',
  'Put a brand code in front only when one is written with the sunmica (PLK is Pulkari): "PLK 9615 AMG - 7 pc". Finish letters in capitals.',
  '3D doors (a door code such as DDLNT, then 3D and a number, then the size) are typed too, one line per door with its size: "3D 107 75x39 6/8 - 1 pc", "3D 139 74 6/8x39 6/8 - 1 pc". Drop the door code (DDLNT), write a space between 3D and its number, and write fractions with a slash after a space, as in 39 6/8. Look hard at the small raised digit of each fraction, it is the one most often misread: a 6 is a single stroke with a closed round loop at the bottom (it can look like a b); a 4 has an angle or a crossing line and no round loop. Read each fraction on its own; the doors on one slip have different sizes.',
  'Leave out rates, amounts, totals, the customer name, dates, phone numbers, headings and labour or delivery charges.',
  'Order of the answer: plywood and flush doors first, then sunmica, then 3D doors, each top to bottom as on the bill.',
  'If a quantity is missing, write the item alone. If the photo holds none of these, answer exactly: NONE',
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
  return lines.map(raisedFractions)
}

/**
 * The group reply for the lines read. Never the word "order" in it: the group
 * reads its own messages too (group-print.mjs).
 */
export function orderReply(lines) {
  return lines.length ? lines.join('\n') : 'Nothing to type out in this photo.'
}

const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']
const raise = (digits) => [...digits].map((d) => SUPERSCRIPT[d]).join('')

/** "75x39 6/8" -> "75x39⁶/⁸", the small raised fraction the staff type. */
export function raisedFractions(line) {
  return line.replace(/(\d) (\d{1,2})\/(\d{1,2})(?!\d)/g, (_, whole, top, bottom) => `${whole}${raise(top)}/${raise(bottom)}`)
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
export async function readOrderPhoto(buffer, mediaType, { env = process.env, model = env.ORDER_READ_MODEL || 'opus', timeoutMs = 180_000 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'shiv-order-'))
  try {
    const file = join(dir, `order${EXT[mediaType] ?? '.jpg'}`)
    await writeFile(file, buffer)
    const stdout = await new Promise((resolve, reject) => {
      execFile(findClaude(env), [
        '-p', ORDER_PROMPT(file),
        '--model', model,
        // Slim: only the Read tool, no MCP servers or settings, and a short
        // system prompt instead of Claude Code's own. A read costs about a
        // third as much ($0.06 of usage, not $0.19; measured 27 Nov 2026).
        '--tools', 'Read',
        '--allowedTools', 'Read',
        '--strict-mcp-config',
        '--setting-sources', '',
        '--system-prompt', ORDER_SYSTEM,
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
