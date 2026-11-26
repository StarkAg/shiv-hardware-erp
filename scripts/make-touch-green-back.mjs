/**
 * The "Touch Green 7Yrs" card back (owner's ask, 26 Nov 2026), made from the
 * Grace 7Yrs back: same cream card, border and 7-year seal, with the GRACE
 * logo blended out and TOUCH GREEN written in its place in green Arial Black,
 * no logo (the owner's choice, after a first try with a leaf logo).
 *
 *   node scripts/make-touch-green-back.mjs
 *
 * Writes public/card-backs/touch-green-7yrs.jpg (print size, card + 3 mm
 * bleed) and touch-green-7yrs-thumb.jpg, and adds the design to
 * src/features/guarantee/cardBacks.json. Uses the print server's
 * @napi-rs/canvas and Windows' Arial Black.
 *
 * scripts/export-card-backs.ps1 rebuilds public/card-backs from the Mac's
 * card-backs/out PNGs and would drop this one: run this again after it.
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const require = createRequire(join(root, 'print-server', 'package.json'))
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas')

const FONT = 'C:/Windows/Fonts/ariblk.ttf'
if (!GlobalFonts.registerFromPath(FONT, 'TG Arial Black')) throw new Error(`could not load ${FONT}`)

const GREEN = '#0b6b33'
const TEXT = 'TOUCH GREEN'
const base = await loadImage(readFileSync(join(root, 'public/card-backs/grace-7yrs.jpg')))
const W = base.width
const H = base.height
const canvas = createCanvas(W, H)
const ctx = canvas.getContext('2d')
ctx.drawImage(base, 0, 0)

// 1. Blend out the GRACE logo: each column between the clean rows above and
// below it, so the card's soft cream shading carries on unbroken.
const box = { x0: 240, x1: 1460, y0: 345, y1: 680 }
const img = ctx.getImageData(0, 0, W, H)
const d = img.data
for (let x = box.x0; x <= box.x1; x += 1) {
  const top = (box.y0 * W + x) * 4
  const bottom = (box.y1 * W + x) * 4
  for (let y = box.y0 + 1; y < box.y1; y += 1) {
    const t = (y - box.y0) / (box.y1 - box.y0)
    const k = (y * W + x) * 4
    for (let c = 0; c < 3; c += 1) d[k + c] = Math.round(d[top + c] * (1 - t) + d[bottom + c] * t)
  }
}
ctx.putImageData(img, 0, 0)

// 2. TOUCH GREEN across the width GRACE had (x 285 to 1412), centred on its line.
const width = 1130
let size = 200
ctx.font = `${size}px "TG Arial Black"`
size = Math.floor((size * width) / ctx.measureText(TEXT).width)
ctx.font = `${size}px "TG Arial Black"`
ctx.fillStyle = GREEN
ctx.textAlign = 'center'
ctx.textBaseline = 'middle'
ctx.fillText(TEXT, W / 2, 490)

// 3. Save the print JPEG and the preview, and list the design.
const out = join(root, 'public/card-backs')
writeFileSync(join(out, 'touch-green-7yrs.jpg'), canvas.toBuffer('image/jpeg', 92))
const tw = 260
const th = Math.round((H * tw) / W)
const thumb = createCanvas(tw, th)
thumb.getContext('2d').drawImage(canvas, 0, 0, tw, th)
writeFileSync(join(out, 'touch-green-7yrs-thumb.jpg'), thumb.toBuffer('image/jpeg', 85))

const listFile = join(root, 'src/features/guarantee/cardBacks.json')
const list = JSON.parse(readFileSync(listFile, 'utf8')).filter((b) => b.file !== 'touch-green-7yrs.jpg')
list.push({ name: 'Touch Green 7Yrs', file: 'touch-green-7yrs.jpg', thumb: 'touch-green-7yrs-thumb.jpg', years: 7 })
list.sort((a, b) => a.name.localeCompare(b.name))
// In the layout export-card-backs.ps1 writes (PowerShell's ConvertTo-Json), so only the new entry shows as changed.
writeFileSync(listFile, `${JSON.stringify(list, null, 4).replace(/": /g, '":  ')}\n`)
console.log(`touch-green-7yrs.jpg ${W}x${H}, ${TEXT} at ${size}px, ${list.length} card backs listed`)
