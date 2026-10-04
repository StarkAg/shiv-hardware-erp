// No emojis anywhere in the project: screens, printed bills, generated HTML,
// WhatsApp text. They draw differently on every phone, browser and printer.
// Use an icon instead (lucide-react in the panel, an inline SVG in the small
// apps and in HTML strings).
//
// Lists every tracked line that holds one. A line that has to name one, such
// as a parser that turns a typed "✕" into "x", ends with the comment emoji-ok.
//
//   npm run check:emoji
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const TEXT = /\.(tsx?|jsx?|mjs|cjs|html|css|json|ps1|cmd|vbs)$/
const SKIP = /(^|\/)(node_modules|dist|build|release|android|backups)\/|package-lock\.json$/
// Pictographs, dingbats (✓ ✕ ★), misc symbols (☀ ☁ ⚠) and the emoji variation
// selector. © ® ™ are plain text and stay allowed.
const EMOJI = /(?![©®™])[\p{Extended_Pictographic}\u{2600}-\u{27BF}\u{FE0F}]/u

const files = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => TEXT.test(f) && !SKIP.test(f))

let found = 0
for (const file of files) {
  let text
  try { text = readFileSync(file, 'utf8') } catch { continue }
  text.split('\n').forEach((line, i) => {
    if (!EMOJI.test(line) || line.includes('emoji-ok')) return
    found++
    console.log(`${file}:${i + 1}  ${line.trim().slice(0, 120)}`)
  })
}

if (found) {
  console.log(`\n${found} line${found === 1 ? '' : 's'} with an emoji. Use an icon instead.`)
  process.exit(1)
}
console.log('No emojis.')
