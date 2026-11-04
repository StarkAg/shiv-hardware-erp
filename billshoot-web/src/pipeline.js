/**
 * From camera frame to the shared picture, on the main thread's side: frames
 * are made small for the finder, photos are handed to the worker to be cut
 * out, and the cut-out pages are laid one under another (crop.js layout).
 */
import { SHEET, WHOLE, layout } from './crop.js'
import { SCANIC_SIDE } from './finders.js'

const worker = new Worker(new URL('./finder.worker.js', import.meta.url), { type: 'module' })
let nextId = 0
const waiting = new Map()
worker.onmessage = ({ data }) => {
  const done = waiting.get(data.id)
  if (!done) return
  waiting.delete(data.id)
  if (data.error) done.reject(new Error(data.error))
  else done.resolve(data)
}
function ask(msg, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    waiting.set(id, { resolve, reject })
    worker.postMessage({ ...msg, id }, transfer)
  })
}

/** A picture (video, image or canvas) stretched to w×h, as RGBA, turned a quarter clockwise if asked. */
function imageOf(source, sw, sh, w, h, turn = false) {
  const c = new OffscreenCanvasOr(w, h)
  const x = c.getContext('2d', { willReadFrequently: true })
  x.imageSmoothingEnabled = true
  x.imageSmoothingQuality = 'medium' // as scanic draws its own input
  if (turn) {
    x.translate(w, 0); x.rotate(Math.PI / 2)
    x.drawImage(source, 0, 0, sw, sh, 0, 0, h, w)
  } else {
    x.drawImage(source, 0, 0, sw, sh, 0, 0, w, h)
  }
  return x.getImageData(0, 0, w, h)
}

/**
 * Where the page is in the live picture (a video of size w×h), as fractions
 * of it — for the outline only. The finder was judged on upright pictures, so
 * a landscape one is turned a quarter first and the corners turned back.
 */
export async function findIn(source, w, h) {
  const turned = w > h
  const input = imageOf(source, w, h, SCANIC_SIDE, SCANIC_SIDE, turned)
  const { corners, ms } = await ask({ type: 'find', input }, [input.data.buffer])
  if (!corners) return { corners: null, ms }
  // Turned clockwise, a point (u, v) of the frame was (v, 1 − u) of the picture.
  return { corners: turned ? reorder(corners.map((p) => ({ x: p.y, y: 1 - p.x }))) : corners, ms }
}

/** Corners back into reading order (top-left first, clockwise) after a turn. */
function reorder(q) {
  let first = 0
  for (let i = 1; i < 4; i += 1) if (q[i].x + q[i].y < q[first].x + q[first].y) first = i
  return [0, 1, 2, 3].map((k) => q[(first + k) % 4])
}

function OffscreenCanvasOr(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return c
}

export const canvasOf = (w, h) => {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return c
}

export function toBlob(canvas, quality = 0.9) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No picture'))), 'image/jpeg', quality))
}

/**
 * A photo taken (canvas): its page found by both finders and cut out flat in
 * one trip to the worker. The corners are null when the whole photo is used.
 */
export async function shotPage(photo) {
  const { width: w, height: h } = photo
  const input = imageOf(photo, w, h, SCANIC_SIDE, SCANIC_SIDE)
  // What edgeSupport reads to choose between the finders' answers.
  const frame = w > h ? imageOf(photo, w, h, 480, 360) : imageOf(photo, w, h, 360, 480)
  const full = photo.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h)
  const { corners, page } = await ask({ type: 'shot', input, frame, photo: full }, [input.data.buffer, frame.data.buffer, full.data.buffer])
  const c = canvasOf(page.width, page.height)
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(page.data.buffer), page.width, page.height), 0, 0)
  return { corners, page: c }
}

/** A photo (canvas) cut along `corners` (or whole) into a flat, cleaned page canvas. */
export async function cutPage(photo, corners) {
  const x = photo.getContext('2d', { willReadFrequently: true })
  const data = x.getImageData(0, 0, photo.width, photo.height)
  const { page } = await ask({ type: 'page', photo: data, corners: corners ?? WHOLE }, [data.data.buffer])
  const c = canvasOf(page.width, page.height)
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(page.data.buffer), page.width, page.height), 0, 0)
  return c
}

/** A canvas turned a quarter clockwise. */
export function turnRight(src) {
  const c = canvasOf(src.height, src.width)
  const x = c.getContext('2d')
  x.translate(c.width, 0); x.rotate(Math.PI / 2)
  x.drawImage(src, 0, 0)
  return c
}

// Big enough to read, small enough for every phone to draw and share.
const MAX_PIXELS = 14e6
// A picture goes to the group inside a request, and WhatsApp itself takes 16 MB.
const MAX_BYTES = 9e6

/** The pages laid one under another on one picture, as a JPEG blob. */
export async function sheetOf(pages) {
  const bitmaps = await Promise.all(pages.map((p) => createImageBitmap(p.blob)))
  const plan = layout(bitmaps.map((b) => ({ w: b.width, h: b.height })))
  const s = Math.min(1, Math.sqrt(MAX_PIXELS / (plan.width * plan.height)))
  const c = canvasOf(Math.round(plan.width * s), Math.round(plan.height * s))
  const x = c.getContext('2d')
  x.fillStyle = SHEET.background
  x.fillRect(0, 0, c.width, c.height)
  x.imageSmoothingQuality = 'high'
  bitmaps.forEach((b, i) => {
    const r = plan.spots[i]
    x.drawImage(b, r.x * s, r.y * s, r.w * s, r.h * s)
    b.close?.()
  })
  for (const quality of [0.88, 0.8, 0.7]) {
    const blob = await toBlob(c, quality)
    if (blob.size <= MAX_BYTES) return blob
  }
  return toBlob(c, 0.6)
}
