/**
 * Puts the Claude Code token on Railway's whatsapp-reminders service, so
 * "order" photos in the shop group are read there with the shop PC off
 * (order-read.mjs). The owner pastes the token from `claude setup-token`;
 * it is never shown, saved to disk or logged.
 *
 *   node scripts/set-claude-token.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const serviceDir = fileURLToPath(new URL('../whatsapp-reminders/', import.meta.url))

function readHidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt)
    const stdin = process.stdin
    let text = ''
    let timer = null
    if (stdin.isTTY) stdin.setRawMode(true)
    stdin.setEncoding('utf8')
    // A pasted token can come split over two lines (a wrapped copy), so a
    // line break does not end it: the input ends a second after the last
    // key or line, once a line break has come.
    const finish = (onData) => {
      stdin.removeListener('data', onData)
      if (stdin.isTTY) stdin.setRawMode(false)
      stdin.pause()
      process.stdout.write('\n')
      resolve(text)
    }
    stdin.on('data', function onData(chunk) {
      clearTimeout(timer)
      let broke = false
      for (const ch of chunk) {
        if (ch === '\u0003') process.exit(1) // Ctrl+C
        if (ch === '\r' || ch === '\n') { broke = true; continue }
        if (ch === '\u0008' || ch === '\u007f') text = text.slice(0, -1)
        else { text += ch; broke = false }
      }
      if (broke && text.trim()) timer = setTimeout(() => finish(onData), 1000)
    })
  })
}

// The Railway CLI: on PATH, else npm's folder, else through npx.
function railway(args) {
  const npmCmd = join(process.env.APPDATA || '', 'npm', 'railway.cmd')
  const tries = [['railway', args], ...(existsSync(npmCmd) ? [[npmCmd, args]] : []), ['npx', ['-y', '@railway/cli', ...args]]]
  for (const [cmd, a] of tries) {
    const run = spawnSync(cmd, a, { cwd: serviceDir, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', encoding: 'utf8' })
    if (run.error?.code === 'ENOENT' || /not recognized|not found/i.test(run.stderr || '')) continue
    return run
  }
  throw new Error('The Railway CLI was not found (npm i -g @railway/cli).')
}

const raw = await readHidden('Paste the Claude token (sk-ant-oat01-...), then press Enter: ')
// The same token pasted twice is kept once; two different ones are refused.
const copies = [...new Set(raw.replace(/\s/g, '').split('sk-ant-oat01-').filter(Boolean))]
const token = copies.length === 1 ? `sk-ant-oat01-${copies[0]}` : raw.replace(/\s/g, '')
// A whole token is about 108 characters; half of one (a paste cut at its line break) is refused.
if (!/^sk-ant-oat01-[\w-]{85,110}$/.test(token)) {
  console.error(`That is not a whole token from \`claude setup-token\` (sk-ant-oat01-..., got ${token.length} characters). Nothing was changed.`)
  process.exit(1)
}
const run = railway(['variables', '--service', 'whatsapp-reminders', '--set', `CLAUDE_CODE_OAUTH_TOKEN=${token}`])
if (run.status !== 0) {
  console.error('Railway did not take it:', String(run.stderr || run.stdout).replaceAll(token, '[token]').trim())
  process.exit(1)
}
console.log('Saved on Railway (whatsapp-reminders). The service restarts by itself; order photos are read there in a minute or two.')
