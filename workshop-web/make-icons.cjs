// Draws the two Workshop apps' icons and writes them as PNGs (no image library).
//
//   Shiv Workshop (Gopal & Bandhu):  a measuring rule on the shop's green.
//   Shiv Workshop Counter (the shop): an order sheet on its clipboard, on the shop's red.
//
// Different fields and different drawings, so the two are never mistaken for
// each other on a phone that has both; the parchment is the family's.
const fs = require('fs')
const zlib = require('zlib')

const PAGE = [243, 240, 234]    // parchment
const SS = 4

const rr = (x, y, cx, cy, w, h, r) => {
  const dx = Math.abs(x - cx) - (w / 2 - r)
  const dy = Math.abs(y - cy) - (h / 2 - r)
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0)
  return Math.min(Math.max(dx, dy), 0) + Math.sqrt(ox * ox + oy * oy) - r
}

/** The rule: a bar across the icon with marks along its top edge, every other one long. */
function rule(u, v, s, put, ink) {
  // Tilted a little, as a rule lies on a board.
  const a = -0.32
  const x = 0.5 + (u - 0.5) * Math.cos(a) - (v - 0.5) * Math.sin(a)
  const y = 0.5 + (u - 0.5) * Math.sin(a) + (v - 0.5) * Math.cos(a)
  const w = 0.80 * s, h = 0.26 * s
  if (rr(x, y, 0.5, 0.5, w, h, 0.04 * s) < 0) put(PAGE, 1)
  const top = 0.5 - h / 2
  for (let i = 0; i < 7; i++) {
    const cx = 0.5 - w / 2 + (w * (i + 1)) / 8
    const len = (i % 2 ? 0.07 : 0.12) * s
    if (rr(x, y, cx, top + len / 2 + 0.012 * s, 0.022 * s, len, 0.008 * s) < 0) put(ink, 1)
  }
}

/** The order sheet: a page with ruled lines under the clip that holds it. */
function sheet(u, v, s, put, ink) {
  const w = 0.50 * s, h = 0.64 * s
  if (rr(u, v, 0.5, 0.5 + 0.03 * s, w, h, 0.045 * s) < 0) put(PAGE, 1)
  for (const k of [-1, 0, 1, 2]) {
    const ly = 0.5 + 0.02 * s + k * 0.105 * s
    const lw = k === 2 ? w * 0.36 : w * 0.64
    if (rr(u, v, 0.5 - (w * 0.64 - lw) / 2, ly, lw, 0.034 * s, 0.017 * s) < 0) put(ink, 1)
  }
  // The clip, over the page's top edge.
  if (rr(u, v, 0.5, 0.5 + 0.03 * s - h / 2, w * 0.46, 0.11 * s, 0.03 * s) < 0) put(ink, 1)
}

const APPS = {
  workshop: { field: [26, 122, 74], ink: [16, 84, 50], draw: rule },
  counter: { field: [159, 29, 32], ink: [116, 18, 21], draw: sheet },
}

// Returns [r,g,b,a] for a point in a 0..1 square, so one drawing serves all sizes.
function paint(app, u, v, maskable) {
  const s = maskable ? 0.70 : 0.84
  const px = [0, 0, 0, 0]
  const put = (col, a) => {
    if (a <= 0) return
    px[0] = col[0] * a + px[0] * (1 - a)
    px[1] = col[1] * a + px[1] * (1 - a)
    px[2] = col[2] * a + px[2] * (1 - a)
    px[3] = a + px[3] * (1 - a)
  }
  if (maskable) put(app.field, 1)
  else if (rr(u, v, 0.5, 0.5, 1, 1, 0.22) < 0) put(app.field, 1)
  else return px
  app.draw(u, v, s, put, app.ink)
  return px
}

function render(app, size, maskable) {
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const p = paint(app, (x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, maskable)
          r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3]
        }
      }
      const n = SS * SS
      const i = (y * size + x) * 4
      buf[i] = a ? Math.round(r / a) : 0
      buf[i + 1] = a ? Math.round(g / a) : 0
      buf[i + 2] = a ? Math.round(b / a) : 0
      buf[i + 3] = Math.round((a / n) * 255)
    }
  }
  return buf
}

// ── PNG container ──────────────────────────────────────────────────────────
const CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return (buf) => {
    let c = -1
    for (const byte of buf) c = t[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
})()
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body))
  return Buffer.concat([len, body, crc])
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // no per-line filter; the images are tiny
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const [name, app] of Object.entries(APPS)) {
  for (const [file, size, maskable] of [
    ['icon-192.png', 192, false],
    ['icon-512.png', 512, false],
    ['icon-maskable-512.png', 512, true],
    ['apple-touch-icon.png', 180, true],
  ]) {
    const out = `public/${name}/${file}`
    fs.writeFileSync(out, png(size, render(app, size, maskable)))
    console.log(out.padEnd(42), size + 'px', maskable ? 'maskable' : '')
  }
}
