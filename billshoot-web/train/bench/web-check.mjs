// The app's own runtime (onnxruntime-web, wasm) on both models: loads, and answers as onnxruntime-node did.
import fs from 'fs'
import sharp from 'sharp'
import * as web from '../../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs'
import * as node from 'onnxruntime-node'
import { scanicCorners, docAlignerCorners } from '../../src/finders.js'
web.env.wasm.numThreads = 1
const s1 = await web.InferenceSession.create(fs.readFileSync('../../public/scanic-corners.ort'))
const d1 = await web.InferenceSession.create(fs.readFileSync('../../public/docaligner-lcnet100.onnx'))
const s2 = await node.InferenceSession.create('../../public/scanic-corners.ort')
const d2 = await node.InferenceSession.create('../../public/docaligner-lcnet100.onnx')
const rgba = async (img) => { const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) } }
let worst = 0
for (const p of ['a1', 'a61', 'a102', 'a140', 'a235']) {
  const f = `../work/photos/${p}.jpg`
  const input = await rgba(sharp(f).resize(224, 224, { fit: 'fill' }))
  const full = await rgba(sharp(f))
  const pairs = [[await scanicCorners(web, s1, input), await scanicCorners(node, s2, input)], [await docAlignerCorners(web, d1, full), await docAlignerCorners(node, d2, full)]]
  for (const [a, b] of pairs) {
    if (!a !== !b) { worst = 1; continue }
    if (a) worst = Math.max(worst, ...a.map((q, i) => Math.hypot(q.x - b[i].x, q.y - b[i].y)))
  }
}
console.log('largest corner difference, web vs node:', worst.toExponential(2))
