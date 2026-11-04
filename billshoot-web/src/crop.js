/**
 * Finding the bill in a photo and laying it flat.
 *
 * A bill is light paper on a darker counter, so the paper is found by how
 * light and how grey each pixel is: the smallest of its three channels is
 * high on paper (white, or cream under shop light) and low on wood, cloth or
 * a brown table, whose blue is weak. The lightest large patch near the middle
 * is the page; the four corners are the biggest four-sided shape that fits
 * its outline, so a page held at a slant still gives its real corners.
 *
 * The page is then cut out along those corners and straightened (a
 * perspective warp), and its colours are evened so the paper reads white and
 * the ink keeps its colour.
 *
 * Plain functions on pixel buffers ({ data, width, height }, RGBA), so the
 * same code runs in the worker and in the tests.
 */

/** Detection works on a small copy; this is its longest side. */
export const DETECT_SIDE = 480
/** The cut-out page is kept at most this big on its longest side. */
export const PAGE_SIDE = 2400

/* ── finding the page ─────────────────────────────────────────────────── */

/** Otsu: the threshold that best splits a histogram in two. */
function otsu(hist, total) {
  let sum = 0
  for (let i = 0; i < 256; i += 1) sum += i * hist[i]
  let sumB = 0, wB = 0, best = 0, at = 128
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) { best = between; at = t }
  }
  return at
}

/** Grow (or, with `on` false, shrink) the marked area by one pixel each way, r times. */
function morph(mask, w, h, r, on) {
  let src = mask
  for (let pass = 0; pass < r; pass += 1) {
    const out = new Uint8Array(w * h)
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = y * w + x
        let v = src[i]
        if (on ? !v : v) {
          const l = x > 0 ? src[i - 1] : src[i], rr = x < w - 1 ? src[i + 1] : src[i]
          const u = y > 0 ? src[i - w] : src[i], d = y < h - 1 ? src[i + w] : src[i]
          v = on ? (l | rr | u | d) : (l & rr & u & d)
        }
        out[i] = v
      }
    }
    src = out
  }
  return src
}

/** The patch of paper most likely to be the page: big, and near the middle. */
function pagePatch(mask, w, h) {
  const label = new Int32Array(w * h)
  const stack = new Int32Array(w * h)
  let best = null, next = 0
  for (let start = 0; start < w * h; start += 1) {
    if (!mask[start] || label[start]) continue
    next += 1
    let top = 0, area = 0, sx = 0, sy = 0
    stack[top++] = start
    label[start] = next
    while (top) {
      const i = stack[--top]
      area += 1
      const x = i % w, y = (i - x) / w
      sx += x; sy += y
      if (x > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = next; stack[top++] = i - 1 }
      if (x < w - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = next; stack[top++] = i + 1 }
      if (y > 0 && mask[i - w] && !label[i - w]) { label[i - w] = next; stack[top++] = i - w }
      if (y < h - 1 && mask[i + w] && !label[i + w]) { label[i + w] = next; stack[top++] = i + w }
    }
    const dx = sx / area / w - 0.5, dy = sy / area / h - 0.5
    const score = area * (1 - Math.min(0.8, Math.hypot(dx, dy)))
    if (!best || score > best.score) best = { id: next, area, score }
  }
  return best && { label, ...best }
}

function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x) }

/** Convex hull, counter-clockwise (monotone chain). */
export function hull(points) {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (p.length < 3) return p
  const lower = [], upper = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  for (let i = p.length - 1; i >= 0; i -= 1) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

const triangle = (a, b, c) => Math.abs(cross(a, b, c)) / 2

/** The biggest four-cornered shape with its corners on the hull. */
export function biggestQuad(h) {
  if (h.length <= 4) return h.length === 4 ? h : null
  // A hull of a few hundred points is thinned to 64, evenly round it; the
  // corners it loses are a pixel or two off on the small copy.
  const pts = h.length > 64 ? Array.from({ length: 64 }, (_, i) => h[Math.floor((i * h.length) / 64)]) : h
  const n = pts.length
  let best = 0, quad = null
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      // The best corner each side of the diagonal i–j, found independently.
      let left = 0, li = -1
      for (let k = i + 1; k < j; k += 1) { const a = triangle(pts[i], pts[j], pts[k]); if (a > left) { left = a; li = k } }
      let right = 0, ri = -1
      for (let k = j + 1; k < n + i; k += 1) { const a = triangle(pts[i], pts[j], pts[k % n]); if (a > right) { right = a; ri = k % n } }
      if (li < 0 || ri < 0) continue
      if (left + right > best) { best = left + right; quad = [pts[i], pts[li], pts[j], pts[ri]] }
    }
  }
  return quad
}

/** Corners in reading order: top-left, top-right, bottom-right, bottom-left. */
export function orderCorners(q) {
  const cx = q.reduce((s, p) => s + p.x, 0) / 4, cy = q.reduce((s, p) => s + p.y, 0) / 4
  const round = [...q].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  // Sorted by angle with y down, this runs clockwise on screen; start at the top-left.
  let first = 0
  for (let i = 1; i < 4; i += 1) if (round[i].x + round[i].y < round[first].x + round[first].y) first = i
  return [0, 1, 2, 3].map((k) => round[(first + k) % 4])
}

export function quadArea(q) {
  let a = 0
  for (let i = 0; i < q.length; i += 1) { const p = q[i], r = q[(i + 1) % q.length]; a += p.x * r.y - r.x * p.y }
  return Math.abs(a) / 2
}

/** How paper-like each pixel is: its smallest channel, high on white or cream paper, low on wood and cloth. */
function lightness({ data, width: w, height: h }) {
  const light = new Uint8Array(w * h)
  for (let i = 0, p = 0; i < w * h; i += 1, p += 4) light[i] = Math.min(data[p], data[p + 1], data[p + 2])
  return light
}

/** A 3×3 average, so one pen stroke or speck does not decide an edge. */
function smooth(light, w, h) {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0, n = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          sum += light[yy * w + xx]; n += 1
        }
      }
      out[y * w + x] = sum / n
    }
  }
  return out
}

/** Paper (1) and not paper (0) at one cut-off, with the gaps writing leaves in it closed. */
function paperAt(light, w, h, cut, close) {
  let mask = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i += 1) mask[i] = light[i] > cut ? 1 : 0
  mask = morph(morph(mask, w, h, close, true), w, h, close, false)
  return morph(morph(mask, w, h, 1, false), w, h, 1, true)
}

/** The page's corners in a paper mask, in pixels, or null. */
function cornersIn(mask, w, h) {
  const patch = pagePatch(mask, w, h)
  if (!patch || patch.area < w * h * 0.08) return null
  // The patch's outline: its first and last pixel on every row and column.
  const edge = []
  for (let y = 0; y < h; y += 1) {
    let a = -1, b = -1
    for (let x = 0; x < w; x += 1) if (patch.label[y * w + x] === patch.id) { if (a < 0) a = x; b = x }
    if (a >= 0) edge.push({ x: a, y }, { x: b + 1, y })
  }
  for (let x = 0; x < w; x += 1) {
    let a = -1, b = -1
    for (let y = 0; y < h; y += 1) if (patch.label[y * w + x] === patch.id) { if (a < 0) a = y; b = y }
    if (a >= 0) edge.push({ x, y: a }, { x, y: b + 1 })
  }
  const quad = biggestQuad(hull(edge))
  if (!quad) return null
  const area = quadArea(quad)
  // Paper filling the whole frame, or a sliver: no page told apart from the rest.
  if (area < w * h * 0.1 || area > w * h * 0.97) return null
  return orderCorners(quad)
}

/**
 * How well a four-cornered shape sits on a real page's edge: along each side,
 * the share of points with paper just inside and something darker just
 * outside. A side lying on the photo's border (the page runs out of the
 * picture) counts as seen. Returns the weakest side and the average.
 */
export function edgeSupport(q, light, w, h) {
  const reach = Math.max(2, Math.round(Math.max(w, h) / 120))
  const at = (x, y) => light[Math.round(y) * w + Math.round(x)]
  const inside = (x, y) => x >= 0 && y >= 0 && x <= w - 1 && y <= h - 1
  const sides = []
  for (let k = 0; k < 4; k += 1) {
    const a = q[k], b = q[(k + 1) % 4]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    // Corners run clockwise on screen, so (dy, −dx) points out of the page.
    const nx = (b.y - a.y) / len, ny = -(b.x - a.x) / len
    let seen = 0
    const N = 24
    for (let i = 0; i < N; i += 1) {
      const t = (i + 0.5) / N
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t
      let best = -255, offFrame = false
      for (const d of [reach, reach * 2]) {
        const ix = x - nx * d, iy = y - ny * d, ox = x + nx * d, oy = y + ny * d
        if (!inside(ox, oy)) { offFrame = true; continue }
        if (!inside(ix, iy)) continue
        best = Math.max(best, at(ix, iy) - at(ox, oy))
      }
      if (best > 12) seen += 1
      else if (offFrame && best === -255) seen += 0.8
    }
    sides.push(seen / N)
  }
  return { weakest: Math.min(...sides), mean: sides.reduce((s, v) => s + v, 0) / 4 }
}

/**
 * The page's corners on a small photo, as fractions of its width and height
 * (so they apply to the full-size photo unchanged), or null when no page
 * stands out — then the whole photo is used.
 *
 * One cut-off between paper and not-paper is not enough: a grey desk top or
 * the light parts of a patterned rug read as light as the paper and join
 * onto it. So several are tried — the photo's own best split and stricter
 * ones — each also with thin joins between paper and background broken; the
 * outline whose four sides best sit on a real paper edge is the page.
 */
export function findPage(img) {
  const { width: w, height: h } = img
  const light = lightness(img)
  const hist = new Uint32Array(256)
  for (const v of light) hist[v] += 1
  const t0 = otsu(hist, w * h)
  const soft = smooth(light, w, h)
  const close = Math.max(1, Math.round(Math.max(w, h) / 160))
  const brk = Math.max(2, Math.round(Math.max(w, h) / 80))
  let best = null
  for (const lift of [0, 0.15, 0.3, 0.45, 0.6]) {
    const base = paperAt(light, w, h, t0 + (255 - t0) * lift, close)
    for (const open of [0, brk, brk * 2]) {
      const mask = open ? morph(morph(base, w, h, open, false), w, h, open, true) : base
      const q = cornersIn(mask, w, h)
      if (!q) continue
      const { weakest, mean } = edgeSupport(q, soft, w, h)
      const score = 0.5 * weakest + 0.5 * mean + 0.05 * (quadArea(q) / (w * h))
      if (!best || score > best.score) best = { q, score }
    }
  }
  if (!best || best.score < 0.35) return null
  return best.q.map((p) => ({ x: p.x / w, y: p.y / h }))
}

/** The whole photo, as corners. */
export const WHOLE = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]

/* ── laying it flat ───────────────────────────────────────────────────── */

/**
 * The mapping from the unit square onto a four-cornered shape (Heckbert):
 * (0,0)→q[0], (1,0)→q[1], (1,1)→q[2], (0,1)→q[3].
 */
export function squareToQuad(q) {
  const [p0, p1, p2, p3] = q
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y
  let g = 0, h = 0
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1
    g = (dx3 * dy2 - dx2 * dy3) / den
    h = (dx1 * dy3 - dx3 * dy1) / den
  }
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x, c = p0.x
  const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y, f = p0.y
  return (u, v) => {
    const z = g * u + h * v + 1
    return { x: (a * u + b * v + c) / z, y: (d * u + e * v + f) / z }
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/** How big the flattened page comes out, from the corners in pixels. */
export function pageSize(q) {
  let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]))
  let h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]))
  const s = Math.min(1, PAGE_SIDE / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

/** Corners pulled a hair inwards, so no edge of counter shows past the paper. */
function inset(q, by) {
  const cx = q.reduce((s, p) => s + p.x, 0) / 4, cy = q.reduce((s, p) => s + p.y, 0) / 4
  return q.map((p) => ({ x: p.x + (cx - p.x) * by, y: p.y + (cy - p.y) * by }))
}

/**
 * The page cut out along `corners` (fractions of the photo) and straightened.
 * Returns an RGBA buffer.
 */
export function flatten(photo, corners, { trim = 0.006 } = {}) {
  const { data, width: W, height: H } = photo
  const px = corners.map((p) => ({ x: p.x * W, y: p.y * H }))
  const q = corners === WHOLE ? px : inset(px, trim)
  const { w, h } = pageSize(q)
  const map = squareToQuad(q)
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y += 1) {
    const v = (y + 0.5) / h
    for (let x = 0; x < w; x += 1) {
      const s = map((x + 0.5) / w, v)
      // Bilinear: the four photo pixels around the point, weighted.
      const fx = Math.min(W - 1.001, Math.max(0, s.x - 0.5)), fy = Math.min(H - 1.001, Math.max(0, s.y - 0.5))
      const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0
      const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4
      const o = (y * w + x) * 4
      for (let c = 0; c < 3; c += 1) {
        const top = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * ax
        const bot = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * ax
        out[o + c] = top + (bot - top) * ay
      }
      out[o + 3] = 255
    }
  }
  return { data: out, width: w, height: h }
}

/**
 * A photo's page: cut along its corners and nothing else, every colour as the
 * camera saw it (owner's ask, 4 Nov 2026).
 */
export function makePage(photo, corners) {
  return flatten(photo, corners)
}

/* ── the pages, one under another ─────────────────────────────────────── */

export const SHEET = { column: 1080, gap: 14, margin: 0, background: '#ffffff' }

/**
 * Where each page goes on the shared picture. Up to three pages run down one
 * column, as a bill's pages are laid on the counter; more go into two columns
 * (three past eight), read down the first column, then the next — so the
 * picture stays a shape a phone screen and WhatsApp show well.
 */
export function layout(sizes, sheet = SHEET) {
  const n = sizes.length
  const cols = n <= 3 ? 1 : n <= 8 ? 2 : 3
  const per = Math.ceil(n / cols)
  const { column: cw, gap, margin } = sheet
  const spots = []
  const heights = []
  for (let c = 0; c < cols; c += 1) {
    let y = margin
    for (let k = c * per; k < Math.min(n, (c + 1) * per); k += 1) {
      const h = Math.round((sizes[k].h / sizes[k].w) * cw)
      spots[k] = { x: margin + c * (cw + gap), y, w: cw, h }
      y += h + gap
    }
    heights.push(y - gap + margin)
  }
  return { spots, width: margin * 2 + cols * cw + (cols - 1) * gap, height: Math.max(margin * 2, ...heights) }
}

/** The plain way: the photo's own best split, no checking. Kept for comparing. */
export function simplePage(img) {
  const { width: w, height: h } = img
  const light = lightness(img)
  const hist = new Uint32Array(256)
  for (const v of light) hist[v] += 1
  const q = cornersIn(paperAt(light, w, h, otsu(hist, w * h), Math.max(1, Math.round(Math.max(w, h) / 160))), w, h)
  return q && q.map((p) => ({ x: p.x / w, y: p.y / h }))
}

/**
 * The page's corners from a mask of which pixels are page (1) — what the
 * trained finder draws — as fractions, or null when there is no page, or it
 * fills the whole frame (then the whole photo is used).
 */
export function cornersOfMask(mask, w, h) {
  const q = cornersIn(mask, w, h)
  return q && q.map((p) => ({ x: p.x / w, y: p.y / h }))
}
