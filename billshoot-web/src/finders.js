/**
 * The two ready-made page finders, and how one of their answers is chosen.
 *
 * Tried on 60 of the shop's own bill photos against the finder trained here
 * and the plain light-and-edges one (train/README.md, "Choosing the finder"):
 *
 *   - scanic's corner model (DocCornerNet LEAN, MIT, 1.9 MB) was the best on
 *     its own, and fast enough to outline the page live;
 *   - DocAligner's small heatmap model (lcnet100, Apache-2.0, 4.8 MB) is right
 *     on many of the photos scanic gets wrong, and finds a page running out
 *     of the picture once the photo is given a border;
 *   - asking both and keeping the answer whose four sides sit best on a real
 *     paper edge (edgeSupport) was right more often than either.
 *
 * Plain functions over RGBA frames ({ width, height, data }) and an
 * onnxruntime namespace, so the worker and train/work/bench run the same code.
 */
import { WHOLE, edgeSupport, orderCorners } from './crop.js'

export const SCANIC_MODEL = '/scanic-corners.ort'
export const DOCALIGNER_MODEL = '/docaligner-lcnet100.onnx'

const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225]

export const SCANIC_SIDE = 224
export const DOCALIGNER_SIDE = 256

/**
 * DocAligner's input: the full-size photo (RGBA) on a black border 12% of its
 * longer side — so a corner just out of the picture can still be found —
 * read at 256×256 the way OpenCV's linear resize reads it, as the corners
 * these finders were judged on were found (train/work/bench).
 */
function docAlignerInput({ width: w, height: h, data }) {
  const pad = Math.floor(0.12 * Math.max(w, h))
  const bw = w + 2 * pad, bh = h + 2 * pad
  const S = DOCALIGNER_SIDE
  const out = new Float32Array(3 * S * S)
  const px = (x, y, c) => {
    x -= pad; y -= pad
    return x < 0 || y < 0 || x >= w || y >= h ? 0 : data[(y * w + x) * 4 + c]
  }
  for (let oy = 0; oy < S; oy += 1) {
    const fy = Math.min(bh - 1, Math.max(0, (oy + 0.5) * bh / S - 0.5))
    const y0 = Math.floor(fy), y1 = Math.min(bh - 1, y0 + 1), ty = fy - y0
    for (let ox = 0; ox < S; ox += 1) {
      const fx = Math.min(bw - 1, Math.max(0, (ox + 0.5) * bw / S - 0.5))
      const x0 = Math.floor(fx), x1 = Math.min(bw - 1, x0 + 1), tx = fx - x0
      // Taught on OpenCV's blue-green-red order.
      for (let c = 0; c < 3; c += 1) {
        const v = (px(x0, y0, c) * (1 - tx) + px(x1, y0, c) * tx) * (1 - ty) + (px(x0, y1, c) * (1 - tx) + px(x1, y1, c) * tx) * ty
        out[(2 - c) * S * S + oy * S + ox] = Math.round(v) / 255
      }
    }
  }
  return { x: out, pad, bw, bh }
}

/** scanic: the picture stretched to 224×224 (RGBA), NHWC RGB; corners top-left first, or null when unsure. */
export async function scanicCorners(ort, session, { data }) {
  const S = SCANIC_SIDE
  const x = new Float32Array(S * S * 3)
  for (let i = 0; i < S * S; i += 1) for (let c = 0; c < 3; c += 1) x[i * 3 + c] = (data[i * 4 + c] / 255 - MEAN[c]) / STD[c]
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', x, [1, S, S, 3]) })
  const k = out.coords.data
  const score = 1 / (1 + Math.exp(-out.score_logit.data[0]))
  if (score < 0.5) return null
  return [0, 1, 2, 3].map((i) => ({ x: k[2 * i], y: k[2 * i + 1] }))
}

/**
 * DocAligner on a full-size photo (RGBA): each of its four heatmaps names one
 * corner, at the middle of its largest bright patch. Corners as fractions of
 * the photo, top-left first; null unless all four are found.
 */
export async function docAlignerCorners(ort, session, photo) {
  const S = DOCALIGNER_SIDE
  const { x, pad, bw, bh } = docAlignerInput(photo)
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, S, S]) })
  const heat = out[session.outputNames[0]]
  const [, k, hh, hw] = heat.dims
  const pts = []
  for (let c = 0; c < Math.min(4, k); c += 1) {
    const p = brightestPatch(heat.data.subarray(c * hh * hw, (c + 1) * hh * hw), hw, hh, 0.3)
    if (!p) return null
    // Heatmap → bordered photo → the photo itself, as fractions.
    pts.push({ x: (p.x / hw * bw - pad) / photo.width, y: (p.y / hh * bh - pad) / photo.height })
  }
  return orderCorners(pts)
}

/** The middle of the largest patch of a heatmap above `cut`, in heatmap pixels, or null. */
function brightestPatch(h, w, ht, cut) {
  const seen = new Uint8Array(w * ht)
  let best = null
  const stack = []
  for (let i = 0; i < w * ht; i += 1) {
    if (seen[i] || h[i] < cut) continue
    let area = 0, sx = 0, sy = 0
    stack.push(i); seen[i] = 1
    while (stack.length) {
      const j = stack.pop(), x = j % w, y = (j - x) / w
      area += 1; sx += x + 0.5; sy += y + 0.5
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= ht) continue
        const m = yy * w + xx
        if (!seen[m] && h[m] >= cut) { seen[m] = 1; stack.push(m) }
      }
    }
    if (!best || area > best.area) best = { area, x: sx / area, y: sy / area }
  }
  return best
}

/** How paper-like each pixel is, softened 3×3 — what edgeSupport reads. */
function softLight({ width: w, height: h, data }) {
  const light = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i += 1) light[i] = Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
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

/**
 * Of several answers (corners as fractions, or null for "the whole photo"),
 * the one whose sides best sit on a real paper edge. Earlier answers win ties.
 */
export function bestOf(frame, answers) {
  const soft = softLight(frame)
  const { width: w, height: h } = frame
  let best = null
  for (const q of answers) {
    const px = (q ?? WHOLE).map((p) => ({ x: p.x * (w - 1), y: p.y * (h - 1) }))
    const { weakest, mean } = edgeSupport(px, soft, w, h)
    const score = 0.5 * weakest + 0.5 * mean
    if (!best || score > best.score + 1e-9) best = { q, score }
  }
  return best.q
}
