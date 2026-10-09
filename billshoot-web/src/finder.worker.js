/**
 * The work that would stall the camera if done beside it: finding the page
 * in a frame (the trained page finder, see train/), and cutting a page out
 * of a full-size photo and laying it flat (crop.js).
 *
 * The finder is a small network run by onnxruntime-web on this phone, no
 * internet needed once the app is installed. Should it not load, the plain
 * light-and-edges finder in crop.js stands in.
 */
import * as ort from 'onnxruntime-web/wasm'
import { cornersOfMask, findPage, makePage } from './crop.js'

export const IN_W = 192, IN_H = 256 // what the finder was taught on (train/data.py)
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225]

ort.env.wasm.numThreads = 1 // threads need special site headers; one is fast enough for a 256-pixel frame

let session = null
const ready = (async () => {
  try {
    session = await ort.InferenceSession.create('/page-finder.onnx', { executionProviders: ['wasm'] })
  } catch (err) {
    console.warn('[billshoot] page finder did not load; using the plain one', err)
  }
})()

/** A small portrait frame (IN_W × IN_H, RGBA) → the page's corners as fractions, or null. */
async function find(small) {
  await ready
  if (!session) return findPage(small)
  const { data } = small
  const n = IN_W * IN_H
  const x = new Float32Array(3 * n)
  for (let i = 0, p = 0; i < n; i += 1, p += 4) {
    x[i] = (data[p] / 255 - MEAN[0]) / STD[0]
    x[n + i] = (data[p + 1] / 255 - MEAN[1]) / STD[1]
    x[2 * n + i] = (data[p + 2] / 255 - MEAN[2]) / STD[2]
  }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, IN_H, IN_W]) })
  const logits = out[session.outputNames[0]].data
  const mask = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) mask[i] = logits[i] > 0 ? 1 : 0
  return cornersOfMask(mask, IN_W, IN_H)
}

self.onmessage = async ({ data: msg }) => {
  try {
    if (msg.type === 'find') {
      const t0 = performance.now()
      const corners = await find(msg.small)
      self.postMessage({ id: msg.id, corners, ms: performance.now() - t0 })
    } else if (msg.type === 'page') {
      const page = makePage(msg.photo, msg.corners)
      self.postMessage({ id: msg.id, page }, [page.data.buffer])
    }
  } catch (err) {
    self.postMessage({ id: msg.id, error: String(err?.message || err) })
  }
}
