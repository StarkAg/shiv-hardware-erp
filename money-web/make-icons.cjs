// Draws the Shiv Money icons and writes them as PNGs (no image library).
// Signs colours: a black square, and three bars rising left to right on it,
// the last in the green that means money to come.
const fs = require('fs')
const zlib = require('zlib')

const INK = [14, 19, 24]
const WALL = [255, 255, 255]
const GREEN = [0, 122, 61]
const SS = 4

const box = (u, v, x0, y0, x1, y1) => u >= x0 && u <= x1 && v >= y0 && v <= y1

// Returns [r,g,b,a] for a point in a 0..1 square, so one drawing serves all sizes.
function paint(u, v, maskable) {
  const s = maskable ? 0.62 : 0.78
  const o = (1 - s) / 2
  const at = (x) => o + x * s
  if (!maskable && !box(u, v, 0.06, 0.06, 0.94, 0.94)) return [0, 0, 0, 0]
  // The bars stand on a base line.
  if (box(u, v, at(0.05), at(0.86), at(0.95), at(0.93))) return [...WALL, 1]
  const bars = [[0.08, 0.58, WALL], [0.38, 0.36, WALL], [0.68, 0.10, GREEN]]
  for (const [x, top, col] of bars) if (box(u, v, at(x), at(top), at(x + 0.24), at(0.86))) return [...col, 1]
  return [...INK, 1]
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
