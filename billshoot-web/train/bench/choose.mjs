// Run two or three finders, keep the guess whose sides sit best on a real paper
// edge (crop.js edgeSupport), and score that choice against the hand grades.
import fs from 'fs'
import sharp from 'sharp'
import { edgeSupport, WHOLE } from '../../src/crop.js'

const js = JSON.parse(fs.readFileSync('out/js.json'))
const da = JSON.parse(fs.readFileSync('out/docaligner.json'))
const rows = fs.readFileSync('grades.txt', 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split(/\s+/))
const grade = Object.fromEntries(rows.map((r) => [r[0], r.slice(1).map(Number)]))
const IDX = { app: 0, ours: 1, scanic: 2, das: 3, dam: 4, dal: 5 }
const DIGITAL = new Set(['a126', 'a68', 'a45', 'a32', 'a92', 'a55', 'a48', 'a49'])

const get = {
  app: (f) => js[f + '.jpg'].app,
  ours: (f) => js[f + '.jpg'].ours,
  scanic: (f) => (js[f + '.jpg'].scanic.score >= 0.5 ? js[f + '.jpg'].scanic.corners : null),
  das: (f) => da[f + '.jpg'].lcnet100,
  dam: (f) => da[f + '.jpg'].fastvit_t8,
  dal: (f) => da[f + '.jpg'].fastvit_sa24,
}

function smooth(light, w, h) {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    let sum = 0, n = 0
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const yy = y + dy, xx = x + dx
      if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue
      sum += light[yy * w + xx]; n += 1
    }
    out[y * w + x] = sum / n
  }
  return out
}

const frames = {}
for (const p of Object.keys(grade)) {
  const { data, info } = await sharp(`../work/photos/${p}.jpg`).resize(360, 480, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true })
  const w = info.width, h = info.height, light = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i += 1) light[i] = Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2])
  frames[p] = { w, h, soft: smooth(light, w, h) }
}

const support = (p, q) => {
  const { w, h, soft } = frames[p]
  const { weakest, mean } = edgeSupport((q ?? WHOLE).map((c) => ({ x: c.x * (w - 1), y: c.y * (h - 1) })), soft, w, h)
  return 0.5 * weakest + 0.5 * mean
}

const combos = [['scanic'], ['scanic', 'das'], ['scanic', 'das', 'app'], ['scanic', 'app'], ['das', 'app'], ['scanic', 'dal'], ['scanic', 'das', 'dam']]
for (const set of [['camera', (p) => !DIGITAL.has(p)], ['digital', (p) => DIGITAL.has(p)], ['all', () => true]]) {
  const [label, keep] = set
  const ps = Object.keys(grade).filter(keep)
  const line = combos.map((c) => {
    let s = 0
    for (const p of ps) {
      let best = null
      for (const k of c) { const v = support(p, get[k](p)); if (!best || v > best.v + 1e-9) best = { k, v } }
      s += grade[p][IDX[best.k]]
    }
    return `${c.join('+')}: ${Math.round((s / ps.length) * 100)}%`
  })
  console.log(`${label} (${ps.length}):  ${line.join('   ')}`)
}
