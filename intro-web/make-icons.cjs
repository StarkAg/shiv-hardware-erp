// Draws the Shiv Intro icons and writes them as PNGs (no image library).
// A person and a plus in white on the Signs blue: a new customer, to be done.
const fs = require('fs')
const zlib = require('zlib')

const BLUE = [0, 84, 180]       // Signs blue: do this
const WHITE = [255, 255, 255]
const SS = 4

const rr = (x, y, cx, cy, w, h, r) => {
  const dx = Math.abs(x - cx) - (w / 2 - r)
  const dy = Math.abs(y - cy) - (h / 2 - r)
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0)
  return Math.min(Math.max(dx, dy), 0) + Math.sqrt(ox * ox + oy * oy) - r
}
const circle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r

// Returns [r,g,b,a] for a point in a 0..1 square, so one drawing serves all sizes.
function paint(u, v, maskable) {
  const s = maskable ? 0.70 : 0.84
  const px = [0, 0, 0, 0]
  const put = (col, a) => {
    if (a <= 0) return
    px[0] = col[0] * a + px[0] * (1 - a)
    px[1] = col[1] * a + px[1] * (1 - a)
    px[2] = col[2] * a + px[2] * (1 - a)
    px[3] = a + px[3] * (1 - a)
  }
  if (maskable) put(BLUE, 1)
  else if (rr(u, v, 0.5, 0.5, 1, 1, 0.22) < 0) put(BLUE, 1)
  // In a square of side s about the centre: the person to the left, the plus to the right.
  const x = (u - 0.5) / s + 0.5, y = (v - 0.5) / s + 0.5
  if (circle(x, y, 0.40, 0.33, 0.14) < 0) put(WHITE, 1)
  if (y > 0.55 && y < 0.80 && circle(x, y, 0.40, 0.80, 0.27) < 0) put(WHITE, 1)
  if (rr(x, y, 0.78, 0.45, 0.26, 0.075, 0.01) < 0 || rr(x, y, 0.78, 0.45, 0.075, 0.26, 0.01) < 0) put(WHITE, 1)
  return px
}

function render(size, maskable) {
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const p = paint((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, maskable)
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

for (const [file, size, maskable] of [
  ['public/icon-192.png', 192, false],
  ['public/icon-512.png', 512, false],
  ['public/icon-maskable-512.png', 512, true],
  ['public/apple-touch-icon.png', 180, true],
]) {
  fs.writeFileSync(file, png(size, render(size, maskable)))
  console.log(file.padEnd(32), size + 'px', maskable ? 'maskable' : '')
}
