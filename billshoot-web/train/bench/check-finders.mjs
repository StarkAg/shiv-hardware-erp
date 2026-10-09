// src/finders.js on the graded photos, given its inputs as the app draws them:
// does it give what the reference runs gave, and how does its choice grade?
import fs from 'fs'
import sharp from 'sharp'
import * as ort from 'onnxruntime-node'
import { scanicCorners, docAlignerCorners, bestOf, SCANIC_SIDE, DOCALIGNER_SIDE } from '../../src/finders.js'

const js = JSON.parse(fs.readFileSync('out/js.json'))
const da = JSON.parse(fs.readFileSync('out/docaligner.json'))
const rows = fs.readFileSync('grades.txt', 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split(/\s+/))
const grade = Object.fromEntries(rows.map((r) => [r[0], r.slice(1).map(Number)]))
const DIGITAL = new Set(['a126', 'a68', 'a45', 'a32', 'a92', 'a55', 'a48', 'a49'])

const scanic = await ort.InferenceSession.create('node_modules/scanic-ml/dist/doccornernet_lean.ort')
const docal = await ort.InferenceSession.create('../../public/docaligner-lcnet100.onnx')

const dist = (a, b) => (a && b ? Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y))) : a || b ? 1 : 0)
const same = (a, b) => dist(a, b) < 1e-9

let dS = [], dD = [], pts = { camera: [], digital: [] }, t = { s: 0, d: 0, c: 0 }
for (const p of Object.keys(grade)) {
  const f = p + '.jpg'
  // As the app draws them: each model's input straight from the full picture.
  const rgba = async (img) => { const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) } }
  const { width: W, height: H } = await sharp(`../work/photos/${f}`).metadata()
  const frame = await rgba(sharp(`../work/photos/${f}`).resize(360, 480, { fit: 'fill' }))
  const sIn = await rgba(sharp(`../work/photos/${f}`).resize(SCANIC_SIDE, SCANIC_SIDE, { fit: 'fill' }))
  const full = await rgba(sharp(`../work/photos/${f}`))
  let t0 = performance.now()
  const s = await scanicCorners(ort, scanic, sIn); t.s += performance.now() - t0
  t0 = performance.now()
  const d = await docAlignerCorners(ort, docal, full); t.d += performance.now() - t0
  t0 = performance.now()
  const pick = bestOf(frame, [s, d]); t.c += performance.now() - t0
  const refS = js[f].scanic.score >= 0.5 ? js[f].scanic.corners : null
  dS.push(dist(s, refS)); dD.push(dist(d, da[f].lcnet100))
  // Grade the pick as the reference answer it matches (scanic = col 2, DocAligner small = col 3).
  const g = same(pick, s) ? grade[p][2] : grade[p][3]
  pts[DIGITAL.has(p) ? 'digital' : 'camera'].push(g)
}
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1]
const over = (a, v) => a.filter((x) => x > v).length
console.log(`scanic vs reference: median worst-corner ${(med(dS) * 100).toFixed(1)}%, ${over(dS, 0.04)} of 60 off by >4%`)
console.log(`DocAligner vs reference: median worst-corner ${(med(dD) * 100).toFixed(1)}%, ${over(dD, 0.04)} of 60 off by >4%`)
for (const [k, v] of Object.entries(pts)) console.log(`${k} (${v.length}): chosen answer right ${Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100)}%`)
console.log('ms per photo:', Object.fromEntries(Object.entries(t).map(([k, v]) => [k, +(v / 60).toFixed(1)])))
fs.writeFileSync('out/finders-diff.json', JSON.stringify(Object.keys(grade).map((p, i) => [p, dS[i], dD[i]])))
