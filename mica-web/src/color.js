/**
 * Reading a laminate's colour off a phone photo, and comparing two of them.
 *
 * A phone camera is no colour meter: it tints every shot to the room's light
 * and sets its own exposure. What it does see in the same frame is the white
 * paper of the catalog board (or the white sheet a customer's sample is laid
 * on), so the paper around the chip is the reference — every channel is
 * scaled until that paper reads as paper. Chips shot on different days under
 * different light then compare on the same footing.
 *
 * A sheet is seldom one colour — a wood grain is three or four browns, a
 * speckle a ground and its flecks — so it is kept as its main shades, each
 * with the share of the square it covers, plus how busy its pattern is. Two
 * chips are as alike as the effort it takes to turn one's shades into the
 * other's, measured in ΔE2000, the standard step of visible colour difference.
 */

/* ── colour spaces ─────────────────────────────────────────────────────── */

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

// D65 reference white.
const XN = 0.95047, YN = 1, ZN = 1.08883
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
const fInv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27))

/** Linear RGB (0–1) to CIE L*a*b*. */
export function linearToLab(r, g, b) {
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b
  const fx = f(x / XN), fy = f(y / YN), fz = f(z / ZN)
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

/** CIE L*a*b* to a CSS hex colour, for drawing a shade. */
export function labToHex({ L, a, b }) {
  const fy = (L + 16) / 116
  const x = XN * fInv(fy + a / 500), y = YN * fInv(fy), z = ZN * fInv(fy - b / 200)
  const lin = [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ]
  return '#' + lin.map((c) => Math.round(Math.min(1, Math.max(0, toSrgb(Math.max(0, c)))) * 255)
    .toString(16).padStart(2, '0')).join('')
}

/** ΔE2000 — how different two colours look; under 1 nobody can tell, over 5 they are plainly not the same. */
export function deltaE2000(p, q) {
  const rad = Math.PI / 180
  const C1 = Math.hypot(p.a, p.b), C2 = Math.hypot(q.a, q.b)
  const Cm = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)))
  const a1 = (1 + G) * p.a, a2 = (1 + G) * q.a
  const c1 = Math.hypot(a1, p.b), c2 = Math.hypot(a2, q.b)
  const h = (b, a) => { if (!b && !a) return 0; const d = Math.atan2(b, a) / rad; return d < 0 ? d + 360 : d }
  const h1 = h(p.b, a1), h2 = h(q.b, a2)
  const dL = q.L - p.L, dC = c2 - c1
  let dh = 0
  if (c1 * c2) dh = Math.abs(h2 - h1) <= 180 ? h2 - h1 : h2 - h1 > 180 ? h2 - h1 - 360 : h2 - h1 + 360
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin((dh * rad) / 2)
  const Lm = (p.L + q.L) / 2, cm = (c1 + c2) / 2
  let hm = h1 + h2
  if (c1 * c2) hm = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad)
    + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad)
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2)
  const SC = 1 + 0.045 * cm, SH = 1 + 0.015 * cm * T
  const RT = -2 * Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad)
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH))
}

const dE76 = (p, q) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b)

/* ── reading a square ──────────────────────────────────────────────────── */

const GRID = 64 // the square is read as GRID × GRID samples
const THUMB = 192 // the kept picture of the square, in pixels
const PAPER = 0.88 // the share of light good white paper gives back

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0 }

/** The pixel at (x, y) of an ImageData, as linear RGB. */
function px(data, width, x, y) {
  const i = (Math.round(y) * width + Math.round(x)) * 4
  return [toLinear(data[i] / 255), toLinear(data[i + 1] / 255), toLinear(data[i + 2] / 255)]
}

/**
 * The paper around the chip: a band just outside the square. Only light,
 * colourless samples count, and only if there are enough of them — a band
 * that runs into a neighbouring chip or the table must not be taken for white.
 */
function findWhite(data, width, height, box) {
  const inner = box.size * 0.56, outer = box.size * 0.78
  const cx = box.x + box.size / 2, cy = box.y + box.size / 2
  const seen = []
  const step = Math.max(1, Math.round(box.size / 80))
  for (let y = cy - outer; y <= cy + outer; y += step) {
    for (let x = cx - outer; x <= cx + outer; x += step) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      if (Math.abs(x - cx) < inner && Math.abs(y - cy) < inner) continue
      const [r, g, b] = px(data, width, x, y)
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const sr = toSrgb(r), sg = toSrgb(g), sb = toSrgb(b)
      const chroma = Math.max(sr, sg, sb) - Math.min(sr, sg, sb)
      seen.push({ r, g, b, lum, chroma })
    }
  }
  if (!seen.length) return null
  const bright = median(seen.map((s) => s.lum))
  const paper = seen.filter((s) => s.chroma < 0.14 && s.lum >= bright * 0.85 && s.lum > 0.12)
  if (paper.length < seen.length * 0.25) return null
  return { r: median(paper.map((p) => p.r)), g: median(paper.map((p) => p.g)), b: median(paper.map((p) => p.b)) }
}

/** k-means in L*a*b*, started from the most spread-out samples so the same photo always reads the same. */
function clusters(points, k) {
  if (!points.length) return []
  // The first centre is the middle lightness; each next one the sample farthest from those chosen.
  const byL = [...points].sort((p, q) => p.L - q.L)
  const centres = [byL[byL.length >> 1]]
  while (centres.length < k) {
    let best = null, far = -1
    for (const p of points) {
      const d = Math.min(...centres.map((c) => dE76(p, c)))
      if (d > far) { far = d; best = p }
    }
    if (far < 2) break
    centres.push(best)
  }
  let groups = []
  for (let it = 0; it < 14; it++) {
    groups = centres.map(() => ({ L: 0, a: 0, b: 0, n: 0 }))
    for (const p of points) {
      let at = 0, near = Infinity
      centres.forEach((c, i) => { const d = dE76(p, c); if (d < near) { near = d; at = i } })
      const g = groups[at]; g.L += p.L; g.a += p.a; g.b += p.b; g.n++
    }
    groups.forEach((g, i) => { if (g.n) centres[i] = { L: g.L / g.n, a: g.a / g.n, b: g.b / g.n } })
  }
  return centres.map((c, i) => ({ ...c, w: groups[i].n / points.length })).filter((c) => c.w > 0)
}

/** Shades closer than a just-noticeable step are one shade. */
function merge(shades) {
  const out = []
  for (const s of [...shades].sort((a, b) => b.w - a.w)) {
    const near = out.find((o) => deltaE2000(o, s) < 3)
    if (near) {
      const w = near.w + s.w
      near.L = (near.L * near.w + s.L * s.w) / w
      near.a = (near.a * near.w + s.a * s.w) / w
      near.b = (near.b * near.w + s.b * s.w) / w
      near.w = w
    } else out.push({ ...s })
  }
  const kept = out.filter((s) => s.w >= 0.04)
  const total = kept.reduce((t, s) => t + s.w, 0) || 1
  return kept.map((s) => ({ L: round(s.L), a: round(s.a), b: round(s.b), w: round(s.w / total, 3) }))
}

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d

/**
 * Reads the square `box` ({ x, y, size } in the canvas's pixels) of a photo.
 *
 * Returns its shades, how busy its pattern is, whether white paper was found
 * to correct it by, and a small corrected picture of the square to show.
 */
export function readSquare(canvas, box) {
  const { width, height } = canvas
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { data } = ctx.getImageData(0, 0, width, height)

  const white = findWhite(data, width, height, box)
  const gain = white ? [PAPER / white.r, PAPER / white.g, PAPER / white.b] : [1, 1, 1]

  // The square, less a thin edge where the chip meets the paper.
  const inset = box.size * 0.06
  const span = box.size - inset * 2
  const lab = []
  const grid = new Float64Array(GRID * GRID)
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = Math.min(width - 1, Math.max(0, box.x + inset + (i + 0.5) * span / GRID))
      const y = Math.min(height - 1, Math.max(0, box.y + inset + (j + 0.5) * span / GRID))
      const [r, g, b] = px(data, width, x, y).map((c, n) => Math.min(1, c * gain[n]))
      const c = linearToLab(r, g, b)
      lab.push(c)
      grid[j * GRID + i] = c.L
    }
  }

  // The square as it is kept and shown: corrected the same way, so every
  // picture in the list is on the same white.
  const thumb = document.createElement('canvas')
  thumb.width = thumb.height = THUMB
  const tctx = thumb.getContext('2d', { willReadFrequently: true })
  tctx.drawImage(canvas, box.x + inset, box.y + inset, span, span, 0, 0, THUMB, THUMB)
  const timg = tctx.getImageData(0, 0, THUMB, THUMB)
  for (let t = 0; t < timg.data.length; t += 4) {
    for (let n = 0; n < 3; n++) {
      timg.data[t + n] = Math.round(toSrgb(Math.min(1, toLinear(timg.data[t + n] / 255) * gain[n])) * 255)
    }
  }
  tctx.putImageData(timg, 0, 0)

  // Shine off a glossy sheet is the lamp, not the laminate: the brightest few
  // samples go — never more than 3% of them, and only near-white ones well
  // clear of the rest, so a light shade that is really there is never taken
  // for a reflection.
  const order = lab.map((c, i) => i).sort((i, j) => lab[i].L - lab[j].L)
  const mid = lab[order[order.length >> 1]].L
  const shine = new Set(order.slice(Math.ceil(order.length * 0.97))
    .filter((i) => lab[i].L > mid + 8 && Math.hypot(lab[i].a, lab[i].b) < 12))
  const kept = lab.filter((c, i) => !shine.has(i))

  // How busy the pattern is: the average step in lightness from one sample to
  // the next. A plain sheet reads near the camera's own grain, about 1; a wood
  // grain or a stone print several times that.
  let steps = 0, n = 0
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const here = grid[j * GRID + i]
      if (i + 1 < GRID) { steps += Math.abs(grid[j * GRID + i + 1] - here); n++ }
      if (j + 1 < GRID) { steps += Math.abs(grid[(j + 1) * GRID + i] - here); n++ }
    }
  }

  return {
    shades: merge(clusters(kept, 5)),
    texture: round(steps / n),
    corrected: Boolean(white),
    white: white ? labToHex(linearToLab(white.r, white.g, white.b)) : null,
    thumb,
  }
}

/* ── comparing two chips ───────────────────────────────────────────────── */

/**
 * How far apart two chips are, in ΔE2000 — the least colour change, weighed
 * by area, that turns one's shades into the other's (an earth mover's
 * distance, solved greedily: with five shades a side it is near enough).
 * A difference in how busy the patterns are is added on top, so a plain
 * sheet is not offered for a wood grain of the same browns.
 */
export function distance(a, b) {
  const left = a.shades.map((s) => ({ ...s, m: s.w }))
  const right = b.shades.map((s) => ({ ...s, m: s.w }))
  const pairs = []
  left.forEach((p, i) => right.forEach((q, j) => pairs.push({ i, j, d: deltaE2000(p, q) })))
  pairs.sort((x, y) => x.d - y.d)
  let cost = 0, moved = 0
  for (const { i, j, d } of pairs) {
    const m = Math.min(left[i].m, right[j].m)
    if (m <= 0) continue
    left[i].m -= m; right[j].m -= m
    cost += m * d; moved += m
  }
  const colour = moved ? cost / moved : Infinity
  return round(colour + 0.6 * Math.abs((a.texture ?? 0) - (b.texture ?? 0)))
}

/** What a distance means at the counter. */
export function verdict(d) {
  if (d < 2) return { word: 'Very close', tone: 'good' }
  if (d < 4) return { word: 'Close', tone: 'good' }
  if (d < 7) return { word: 'Similar', tone: 'fair' }
  return { word: 'Different', tone: 'poor' }
}

/** Nearest chips to a reading, best first. */
export function nearest(reading, chips, limit = 8) {
  return chips
    .map((chip) => ({ chip, d: distance(reading, chip) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, limit)
}

/**
 * A distance as a likeness out of 100, the way the counter thinks of it: a
 * difference nobody sees (ΔE under 1) is about 96%, a close match (2) about
 * 86%, plainly different (7 and up) a third or less.
 */
export const similarity = (d) => Math.round(100 / (1 + (d / 5) ** 2))

/** The shade covering most of the square. */
const main = (r) => r.shades.reduce((m, s) => (s.w > m.w ? s : m), r.shades[0])

/**
 * What is different about B, in the words a customer would use: lighter or
 * darker, warmer or cooler, redder or greener, brighter or duller, and
 * whether the pattern is busier. Only differences big enough to see are said.
 */
export function difference(a, b) {
  if (!a?.shades.length || !b?.shades.length) return []
  const p = main(a), q = main(b)
  const said = []
  const amount = (n) => (n > 6 ? 'much ' : n > 3 ? '' : 'a little ')
  const dL = q.L - p.L
  if (Math.abs(dL) > 1.5) said.push(`${amount(Math.abs(dL))}${dL > 0 ? 'lighter' : 'darker'}`)
  // Each axis is said from where the colours sit on it: a green that loses
  // some of its green is "less green", not "redder".
  const db = q.b - p.b
  if (Math.abs(db) > 1.5) {
    const word = db > 0
      ? (p.b < 0 && q.b <= 0 ? 'less blue' : 'warmer (more yellow)')
      : (p.b > 0 && q.b >= 0 ? 'less yellow' : 'cooler (more blue)')
    said.push(`${amount(Math.abs(db))}${word}`)
  }
  const da = q.a - p.a
  if (Math.abs(da) > 1.5) {
    const word = da > 0
      ? (p.a < 0 && q.a <= 0 ? 'less green' : 'redder')
      : (p.a > 0 && q.a >= 0 ? 'less red' : 'greener')
    said.push(`${amount(Math.abs(da))}${word}`)
  }
  const dC = Math.hypot(q.a, q.b) - Math.hypot(p.a, p.b)
  if (Math.abs(dC) > 2) said.push(`${amount(Math.abs(dC))}${dC > 0 ? 'brighter in colour' : 'duller'}`)
  const dT = (b.texture ?? 0) - (a.texture ?? 0)
  if (Math.abs(dT) > 1.5) said.push(dT > 0 ? 'a busier pattern' : 'a plainer pattern')
  if (Math.abs(a.shades.length - b.shades.length) >= 2) said.push(b.shades.length > a.shades.length ? 'more shades in it' : 'fewer shades in it')
  return said
}
