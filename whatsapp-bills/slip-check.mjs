/**
 * Is this a supplier's bill slip? Asked of Claude, before a photo or PDF from a
 * supplier chat prints (owner, 28 Nov 2026).
 *
 * The chat's photos printed by a colour check (print-server/paper-check.mjs,
 * "no ai", 26 Nov 2026), and on 28 Nov it let four photos through that were
 * not bills while it held one back that may have been. So the owner asked for
 * Claude to decide, with the Claude token on Railway: only the handwritten
 * bill slips print, like the one he sent (a sheet headed "Shiv H/W Ramgarh",
 * the date, "9615 AMG - 7 @1000 = 7000", "9570 MLT - 4 @900 = 3600", the
 * total 10600).
 *
 * Claude Code is installed in the Dockerfile and signed in by
 * CLAUDE_CODE_OAUTH_TOKEN (a reference to whatsapp-reminders' own, so one
 * `node scripts/set-claude-token.mjs` keeps both). Without the token, or when
 * Claude cannot answer, the answer is null and the print server's colour check
 * decides, as before.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const SLIP_SYSTEM = [
  'You sort files a supplier sends a hardware and plywood shop on WhatsApp. Open the file with the Read tool.',
  'Answer with one word only: SLIP or OTHER.',
].join('\n')

export const SLIP_PROMPT = (file) => [
  `Read the file ${file}.`,
  'Answer SLIP when it is a bill, slip, estimate or delivery note for goods, written by hand or printed: a sheet of paper listing items (plywood, boards, doors, sunmica design numbers such as 9615 AMG, hardware) with quantities, and usually rates, amounts or a total. Often it is headed with the shop\'s name (Shiv Hardware, Shiv H/W, Ramgarh) and a date. A photo of such a sheet counts even when it is crooked, in shadow, or on a table.',
  'Answer OTHER for everything else: photos of goods, sheets, doors, vehicles, people or places, sunmica or design catalogues and swatches, price lists and rate cards, visiting cards, screenshots, bank or payment receipts (SBI, UPI, Paytm, PhonePe), forwarded pictures, greetings, and blank or unreadable pages.',
  'One word: SLIP or OTHER.',
].join('\n')

/** SLIP -> true, OTHER -> false, anything else -> null (could not tell). */
export function slipAnswer(text) {
  const word = String(text ?? '').trim().split(/\s+/).at(-1)?.replace(/[^a-z]/gi, '').toUpperCase()
  if (word === 'SLIP') return true
  if (word === 'OTHER') return false
  return null
}

/** The environment for claude without an API key: the OAuth token signs it in. */
function signedInEnv(env) {
  const out = { ...env }
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']) delete out[key]
  return out
}

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf' }

/**
 * true: a bill slip, print it; false: not one, leave it; null: no token, or no
 * clear answer (the colour check then decides).
 */
export async function isBillSlip(file, { env = process.env, model = env.SLIP_CHECK_MODEL || 'sonnet', timeoutMs = 120_000, claude = env.CLAUDE_EXE || 'claude' } = {}) {
  if (!env.CLAUDE_CODE_OAUTH_TOKEN && !env.CLAUDE_EXE) return null
  const dir = await mkdtemp(join(tmpdir(), 'shiv-slip-'))
  try {
    const path = join(dir, `file${EXT[file.mediaType] ?? '.jpg'}`)
    await writeFile(path, file.buffer)
    const stdout = await new Promise((resolve, reject) => {
      execFile(claude, [
        '-p', SLIP_PROMPT(path),
        '--model', model,
        // Slim, as order-read.mjs: only the Read tool and a short system prompt.
        '--tools', 'Read',
        '--allowedTools', 'Read',
        '--strict-mcp-config',
        '--setting-sources', '',
        '--system-prompt', SLIP_SYSTEM,
      ], { cwd: dir, env: signedInEnv(env), timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, out, errOut) => {
        if (err) reject(new Error(String(errOut || out || err.message).trim().split('\n').at(-1).slice(0, 200)))
        else resolve(out)
      })
    })
    return slipAnswer(stdout)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
