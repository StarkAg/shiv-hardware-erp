// Draws the Price List icons and writes them as PNGs (no image library):
// a white price tag on the Signs blue, the same drawing as public/icon.svg.
const fs = require('fs')
const zlib = require('zlib')

const BLUE = [0, 84, 180]
const WHITE = [255, 255, 255]
const SS = 4

// Inside the tag, in the icon's 0..100 units, after turning the point back by
// 45° about the middle (the SVG turns the tag the other way).
function inTag(x, y) {
  const a = Math.PI / 4
  const dx = x - 50, dy = y - 50
  const tx = 50 + dx * Math.cos(a) - dy * Math.sin(a)
  const ty = 50 + dx * Math.sin(a) + dy * Math.cos(a)
  if (tx >= 32 && tx <= 80 && ty >= 34 && ty <= 66) {
    const hole = Math.hypot(tx - 36, ty - 50) <= 4.5
    const line1 = tx >= 46 && tx <= 72 && ty >= 44 && ty <= 48
    const line2 = tx >= 46 && tx <= 64 && ty >= 52 && ty <= 56
    return !(hole || line1 || line2)
  }
  // The point: from (18,50) out to the body's left edge.
  if (tx >= 18 && tx < 32) return Math.abs(ty - 50) <= ((tx - 18) / 14) * 16
  return false
}

function paint(u, v, maskable) {
  // A maskable icon is cut to a circle by the phone: the drawing shrinks to its middle.
  const s = maskable ? 0.78 : 1
  const x = 50 + (u * 100 - 50) / s, y = 50 + (v * 100 - 50) / s
  return inTag(x, y) ? WHITE : BLUE
}

function render(size, maskable) {
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const p = paint((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, maskable)
          r += p[0]; g += p[1]; b += p[2]
        }
      }
      const n = SS * SS, i = (y * size + x) * 4
      buf[i] = Math.round(r / n); buf[i + 1] = Math.round(g / n); buf[i + 2] = Math.round(b / n); buf[i + 3] = 255
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
