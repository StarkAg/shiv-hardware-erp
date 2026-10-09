// Runs the browser-side finders on every shop photo, as the app would:
//   app    — crop.js findPage on the 192x256 portrait frame (what is live now)
//   ours   — the page finder trained on the Mac, mask -> cornersOfMask
//   scanic — scanic-ml DocCornerNet LEAN, photo stretched to 224x224
// Writes js.json: { [file]: { app, ours, scanic: {corners, score} } }, corners as fractions of the photo.
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import * as ort from 'onnxruntime-node'
import { findPage, cornersOfMask } from '../../src/crop.js'

const PHOTOS = '../work/photos'
const IN_W = 192, IN_H = 256
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225]

const ours = await ort.InferenceSession.create('../work/model/page-finder.onnx')
const scanic = await ort.InferenceSession.create('node_modules/scanic-ml/dist/doccornernet_lean.ort')

const reorder = (q) => {
  let first = 0
  for (let i = 1; i < 4; i += 1) if (q[i].x + q[i].y < q[first].x + q[first].y) first = i
  return [0, 1, 2, 3].map((k) => q[(first + k) % 4])
}

async function smallFrame(file, w, h) {
  // The app turns a landscape picture a quarter clockwise, then stretches it to 192x256.
  const turned = w > h
  let img = sharp(file).rotate() // honour EXIF like a browser does
  if (turned) img = img.rotate(90)
  const { data } = await img.resize(IN_W, IN_H, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { small: { width: IN_W, height: IN_H, data: new Uint8ClampedArray(data) }, turned }
}

const back = (q, turned) => (q && turned ? reorder(q.map((p) => ({ x: p.y, y: 1 - p.x }))) : q)

async function runOurs(small) {
  const n = IN_W * IN_H, { data } = small
  const x = new Float32Array(3 * n)
  for (let i = 0, p = 0; i < n; i += 1, p += 4) {
    x[i] = (data[p] / 255 - MEAN[0]) / STD[0]
    x[n + i] = (data[p + 1] / 255 - MEAN[1]) / STD[1]
    x[2 * n + i] = (data[p + 2] / 255 - MEAN[2]) / STD[2]
  }
  const out = await ours.run({ [ours.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, IN_H, IN_W]) })
  const logits = out[ours.outputNames[0]].data
  const mask = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) mask[i] = logits[i] > 0 ? 1 : 0
  return cornersOfMask(mask, IN_W, IN_H)
}

async function runScanic(file) {
  const S = 224
  const { data } = await sharp(file).rotate().resize(S, S, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const x = new Float32Array(S * S * 3)
  for (let i = 0; i < S * S; i += 1) for (let c = 0; c < 3; c += 1) x[i * 3 + c] = (data[i * 3 + c] / 255 - MEAN[c]) / STD[c]
  const out = await scanic.run({ [scanic.inputNames[0]]: new ort.Tensor('float32', x, [1, S, S, 3]) })
  const k = out.coords.data, score = 1 / (1 + Math.exp(-out.score_logit.data[0]))
  return { corners: [0, 1, 2, 3].map((i) => ({ x: k[2 * i], y: k[2 * i + 1] })), score }
}

const files = fs.readdirSync(PHOTOS).filter((f) => f.endsWith('.jpg')).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))
const res = {}
const t = { app: 0, ours: 0, scanic: 0 }
for (const f of files) {
  const file = path.join(PHOTOS, f)
  const { width, height } = await sharp(file).rotate().metadata().then((m) => (m.orientation >= 5 ? { width: m.height, height: m.width } : m))
  const { small, turned } = await smallFrame(file, width, height)
  let t0 = performance.now()
  const app = back(findPage(small), turned); t.app += performance.now() - t0
  t0 = performance.now()
  const o = back(await runOurs(small), turned); t.ours += performance.now() - t0
  t0 = performance.now()
  const s = await runScanic(file); t.scanic += performance.now() - t0
  res[f] = { size: [width, height], app, ours: o, scanic: s }
}
fs.writeFileSync('out/js.json', JSON.stringify(res))
console.log(`${files.length} photos; ms/photo`, Object.fromEntries(Object.entries(t).map(([k, v]) => [k, +(v / files.length).toFixed(1)])))
