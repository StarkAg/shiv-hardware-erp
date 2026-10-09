/**
 * The work that would stall the camera if done beside it: finding the page
 * in a frame, and cutting a page out of a full-size photo and laying it flat
 * (crop.js).
 *
 * The finders are two small ready-made networks (finders.js) run by
 * onnxruntime-web on this phone, no internet needed once the app is
 * installed. Should neither load, the plain light-and-edges finder in crop.js
 * stands in.
 */
import * as ort from 'onnxruntime-web/wasm'
import { WHOLE, findPage, makePage } from './crop.js'
import { DOCALIGNER_MODEL, SCANIC_MODEL, bestOf, docAlignerCorners, scanicCorners } from './finders.js'

ort.env.wasm.numThreads = 1 // threads need special site headers; one is fast enough for these small inputs

const load = (url) => ort.InferenceSession.create(url, { executionProviders: ['wasm'] }).catch((err) => {
  console.warn('[billshoot] finder did not load; doing without it', url, err)
  return null
})
const scanic = load(SCANIC_MODEL)
const docAligner = load(DOCALIGNER_MODEL)

/** The live outline: scanic alone, quick enough for every look. */
async function findLive(input) {
  const s = await scanic
  return s ? scanicCorners(ort, s, input) : findPage(input)
}

/**
 * A photo taken: both finders, and the answer whose sides sit best on a real
 * paper edge. Either one saying "no page" offers the whole photo instead.
 */
async function findShot({ input, frame, photo }) {
  const [s, d] = await Promise.all([scanic, docAligner])
  if (!s && !d) return findPage(frame)
  const answers = []
  if (s) answers.push(await scanicCorners(ort, s, input))
  if (d) answers.push(await docAlignerCorners(ort, d, photo))
  return bestOf(frame, answers)
}

self.onmessage = async ({ data: msg }) => {
  try {
    if (msg.type === 'find') {
      const t0 = performance.now()
      const corners = await findLive(msg.input)
      self.postMessage({ id: msg.id, corners, ms: performance.now() - t0 })
    } else if (msg.type === 'shot') {
      const corners = await findShot(msg)
      const page = makePage(msg.photo, corners ?? WHOLE)
      self.postMessage({ id: msg.id, corners, page }, [page.data.buffer])
    } else if (msg.type === 'page') {
      const page = makePage(msg.photo, msg.corners)
      self.postMessage({ id: msg.id, page }, [page.data.buffer])
    }
  } catch (err) {
    self.postMessage({ id: msg.id, error: String(err?.message || err) })
  }
}
