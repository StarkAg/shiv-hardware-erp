/**
 * The "Touch Green 7Yrs" card back (owner's ask, 26 Nov 2026), made from the
 * Grace 7Yrs back: same cream card, border and 7-year seal, with the GRACE
 * logo blended out and a Touch Green logo drawn in its place. The logo is the
 * shop's own drawing in the style the owner pointed at (a green leaf with
 * script lettering), not a copy of another brand's mark.
 *
 *   node scripts/make-touch-green-back.mjs
 *
 * Writes public/card-backs/touch-green-7yrs.jpg (print size, card + 3 mm
 * bleed) and touch-green-7yrs-thumb.jpg, and adds the design to
 * src/features/guarantee/cardBacks.json. Uses the print server's
 * @napi-rs/canvas and Windows' Segoe Script Bold.
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

const FONT = 'C:/Windows/Fonts/segoescb.ttf'
if (!GlobalFonts.registerFromPath(FONT, 'TG Script')) throw new Error(`could not load ${FONT}`)

const GREEN = '#0b6b33'
const DARK = '#07502a'
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

// 2. The leaf: a tilted leaf with a vein, "Touch" written across it in white.
const cx = W / 2
function leaf(x, y, len, wid, angle) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(-len / 2, 0)
  ctx.bezierCurveTo(-len / 4, -wid, len / 4, -wid * 0.95, len / 2, 0)
  ctx.bezierCurveTo(len / 4, wid * 0.95, -len / 4, wid, -len / 2, 0)
  ctx.closePath()
  ctx.fillStyle = GREEN
  ctx.fill()
  // stalk
  ctx.beginPath()
  ctx.moveTo(-len / 2, 0)
  ctx.quadraticCurveTo(-len / 2 - 40, 14, -len / 2 - 70, 40)
  ctx.lineWidth = 14
  ctx.lineCap = 'round'
  ctx.strokeStyle = GREEN
  ctx.stroke()
  // vein, a lighter line under the word
  ctx.beginPath()
  ctx.moveTo(-len / 2 + 40, wid * 0.42)
  ctx.quadraticCurveTo(0, wid * 0.55, len / 2 - 60, wid * 0.18)
  ctx.lineWidth = 6
  ctx.strokeStyle = '#3f9a5e'
  ctx.stroke()
  // the word
  ctx.fillStyle = '#ffffff'
  ctx.font = `${Math.round(wid * 0.95)}px "TG Script"`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('Touch', 0, -wid * 0.12)
  ctx.restore()
}
leaf(cx + 250, 360, 560, 120, -0.2)

// 3. "Green" in heavy green script, thickened with its own outline.
ctx.save()
ctx.font = '250px "TG Script"'
ctx.textAlign = 'center'
ctx.textBaseline = 'alphabetic'
ctx.lineJoin = 'round'
ctx.lineWidth = 16
ctx.strokeStyle = GREEN
ctx.fillStyle = GREEN
ctx.translate(cx - 60, 620)
ctx.rotate(-0.06)
ctx.strokeText('Green', 0, 0)
ctx.fillText('Green', 0, 0)
ctx.restore()

// An underline swash, as script logos have.
ctx.beginPath()
ctx.moveTo(cx - 330, 690)
ctx.bezierCurveTo(cx - 100, 672, cx + 220, 660, cx + 500, 615)
ctx.lineWidth = 12
ctx.lineCap = 'round'
ctx.strokeStyle = DARK
ctx.stroke()

// 4. Save the print JPEG and the preview, and list the design.
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
console.log(`touch-green-7yrs.jpg ${W}x${H}, ${list.length} card backs listed`)
