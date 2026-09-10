/**
 * Finding a sheet of paper in a photograph, in plain pixels.
 *
 * This is the detector `scripts/scan.py` should have had. That one hunts for a
 * four-cornered contour — edges, contours, largest quad — which is the standard
 * recipe and is wrong for these bills: they are torn scraps of paper lying on a
 * printed floral cloth, so their edges are not straight, `approxPolyDP` never
 * returns four points, and the cloth's pattern floods the contour list. Run
 * over the photographs actually in the books it finds a sheet in one of nine.
 *
 * Paper is obvious on a colour photograph for a different reason: it is bright
 * AND it has almost no colour, while the cloth is both darker and dyed. Segment
 * on that pair, keep the largest blob, and read a rectangle off it. No straight
 * edges required, and it finds all nine.
 *
 * Nothing here touches the DOM, so it runs the same in a worker, on the main
 * thread, or under node against a dump of pixels — which is how it is tested
 * against the Python it replaces.
 */

/** Work at this size: big enough to see the sheet, small enough to be quick. */
export const DETECT_EDGE = 800;

/**
 * Bright and unsaturated, each judged against this photograph's own spread
 * rather than a fixed number — the light over a shop counter varies hugely and
 * a threshold that suits one bill blacks out the next.
 */
const VALUE_PERCENTILE = 70;
const VALUE_OF_BRIGHT = 0.8;
const SAT_PERCENTILE = 45;
const SAT_SPREAD = 1.6;
const SAT_CEILING = 60;

/** Below this share of the frame it is a highlight, not a sheet. */
const MIN_FILL = 0.1;
/** Above this it is the whole picture, which means the mask ran away. */
const MAX_FILL = 0.97;
/** How square the blob must be before its rectangle is worth trusting. */
const MIN_SQUARENESS = 0.6;

/** The blob is eaten away this many times over, looking for a squarer reading. */
const MAX_EROSIONS = 6;
const ERODE_RADIUS = 4; // a 9x9 square

/**
 * The value and saturation of every pixel, as bytes.
 *
 * Only these two channels of HSV are wanted and both fall straight out of the
 * max and min of the three primaries, so the hue — the expensive part, all
 * branches and divisions — is never computed.
 */
function valueAndSaturation({ data, width, height }) {
  const n = width * height;
  const value = new Uint8Array(n);
  const sat = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i += 1, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const hi = r > g ? (r > b ? r : b) : g > b ? g : b;
    const lo = r < g ? (r < b ? r : b) : g < b ? g : b;
    value[i] = hi;
    sat[i] = hi === 0 ? 0 : Math.round(((hi - lo) * 255) / hi);
  }
  return { value, sat };
}

/** The value at a percentile, off a 256-bin histogram rather than a sort. */
function percentile(bytes, p) {
  const bins = new Uint32Array(256);
  for (let i = 0; i < bytes.length; i += 1) bins[bytes[i]] += 1;
  const target = (bytes.length * p) / 100;
  let seen = 0;
  for (let v = 0; v < 256; v += 1) {
    seen += bins[v];
    if (seen >= target) return v;
  }
  return 255;
}

/**
 * A square morphological pass, done as two one-dimensional passes.
 *
 * A 7x7 square kernel separates into a horizontal 7 and a vertical 7, which
 * turns 49 reads per pixel into 14. On a phone, over a 800x600 mask, six
 * erosions deep, that difference is the difference between a shutter that
 * keeps up and one that does not.
 */
function morph(mask, width, height, radius, pick) {
  if (radius <= 0) return mask;
  const mid = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  // rows, then columns
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let hit = pick === 'max' ? 0 : 255;
      const from = Math.max(0, x - radius);
      const to = Math.min(width - 1, x + radius);
      for (let k = from; k <= to; k += 1) {
        const v = mask[y * width + k];
        if (pick === 'max' ? v > hit : v < hit) hit = v;
      }
      mid[y * width + x] = hit;
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let hit = pick === 'max' ? 0 : 255;
      const from = Math.max(0, y - radius);
      const to = Math.min(height - 1, y + radius);
      for (let k = from; k <= to; k += 1) {
        const v = mid[k * width + x];
        if (pick === 'max' ? v > hit : v < hit) hit = v;
      }
      out[y * width + x] = hit;
    }
  }
  return out;
}

const dilate = (m, w, h, r) => morph(m, w, h, r, 'max');
const erode = (m, w, h, r) => morph(m, w, h, r, 'min');

/** Where paper is: bright, and barely coloured. */
export function paperMask(image) {
  const { width, height } = image;
  const { value, sat } = valueAndSaturation(image);
  const bright = percentile(value, VALUE_PERCENTILE) * VALUE_OF_BRIGHT;
  const dull = Math.max(percentile(sat, SAT_PERCENTILE) * SAT_SPREAD, SAT_CEILING);

  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = value[i] >= bright && sat[i] <= dull ? 255 : 0;
  }
  // Closing — dilate then erode — fills the writing back in, so a covered slip
  // reads as one blob and not a field of islands. Opening, the other way
  // round, then takes off the speckle the cloth throws up. Twice closed, once
  // opened, at a 7x7, which is what the Python does.
  let m = mask;
  for (let i = 0; i < 2; i += 1) m = erode(dilate(m, width, height, 3), width, height, 3);
  return dilate(erode(m, width, height, 3), width, height, 3);
}

/** The largest run of touching pixels, by flood fill. Returns its pixels. */
function largestBlob(mask, width, height) {
  const seen = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let best = null;

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    seen[start] = 1;
    const pixels = [];

    while (head < tail) {
      const at = queue[head];
      head += 1;
      const x = at % width;
      const y = (at - x) / width;
      pixels.push(at);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const to = ny * width + nx;
          if (mask[to] && !seen[to]) {
            seen[to] = 1;
            queue[tail] = to;
            tail += 1;
          }
        }
      }
    }
    if (!best || pixels.length > best.count) best = { count: pixels.length, pixels };
  }
  return best;
}

/** The convex hull of a set of points, lowest x first (Andrew's monotone chain). */
function hull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/**
 * The smallest rectangle that contains the hull, at any angle.
 *
 * Rotating calipers, in its simplest form: the minimum rectangle always has a
 * side flush with one of the hull's own edges, so trying each edge in turn and
 * keeping the smallest is exact, not an approximation.
 */
function minAreaRect(points) {
  const h = hull(points);
  if (h.length < 3) return null;
  let best = null;

  for (let i = 0; i < h.length; i += 1) {
    const [x1, y1] = h[i];
    const [x2, y2] = h[(i + 1) % h.length];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1e-6) continue;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, y] of h) {
      const u = x * ux + y * uy;
      const v = -x * uy + y * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      best = { area, ux, uy, minU, maxU, minV, maxV };
    }
  }
  if (!best) return null;

  const { ux, uy, minU, maxU, minV, maxV } = best;
  const at = (u, v) => [u * ux - v * uy, u * uy + v * ux];
  return {
    area: best.area,
    corners: [at(minU, minV), at(maxU, minV), at(maxU, maxV), at(minU, maxV)],
  };
}

/** Top-left, top-right, bottom-right, bottom-left — as scan.py orders them. */
export function orderCorners(quad) {
  const sum = quad.map(([x, y]) => x + y);
  const diff = quad.map(([x, y]) => x - y);
  const at = (list, pick) => quad[list.indexOf(pick(...list))];
  return [
    at(sum, Math.min),
    at(diff, Math.max),
    at(sum, Math.max),
    at(diff, Math.min),
  ];
}

/**
 * The sheet's four corners in the coordinates of the image handed in, or null.
 *
 * The blob is eaten away a step at a time and the squarest reading kept. Where
 * the cloth is pale it bridges the sheet to whatever else is bright in the
 * frame and the blob grows a limb; erosion snaps a limb well before it eats
 * through the sheet, so the roundest-cornered reading is the honest one. Each
 * candidate is then grown back by exactly what was eaten off it.
 */
export function findSheet(image) {
  const { width, height } = image;
  const mask = paperMask(image);
  const frame = width * height;
  let best = null;

  for (let eaten = 0; eaten <= MAX_EROSIONS; eaten += 1) {
    const m = eaten === 0 ? mask : erode(mask, width, height, ERODE_RADIUS * eaten);
    const blob = largestBlob(m, width, height);
    if (!blob) break;
    const fill = blob.count / frame;
    if (fill < MIN_FILL) break;

    const points = blob.pixels.map((at) => {
      const x = at % width;
      return [x, (at - x) / width];
    });
    const rect = minAreaRect(points);
    if (!rect) continue;
    const squareness = blob.count / Math.max(rect.area, 1);
    if (!best || squareness > best.squareness) {
      best = { squareness, corners: rect.corners, fill, eaten };
    }
  }

  if (!best || best.squareness < MIN_SQUARENESS) return null;
  if (best.fill > MAX_FILL) return null;

  // Give back exactly what the erosion took off, then clamp into the frame.
  const grow = ERODE_RADIUS * best.eaten;
  const cx = best.corners.reduce((t, c) => t + c[0], 0) / 4;
  const cy = best.corners.reduce((t, c) => t + c[1], 0) / 4;
  const out = best.corners.map(([x, y]) => {
    const d = Math.hypot(x - cx, y - cy) || 1;
    return [
      Math.min(width - 1, Math.max(0, x + ((x - cx) / d) * grow)),
      Math.min(height - 1, Math.max(0, y + ((y - cy) / d) * grow)),
    ];
  });
  return { corners: orderCorners(out), squareness: best.squareness, fill: best.fill };
}

/**
 * Solves the eight unknowns of a perspective transform by plain elimination.
 *
 * Eight equations, eight unknowns, once per photograph — a library for this
 * would weigh more than the arithmetic does.
 */
function solve8(rows) {
  const n = 8;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    }
    if (Math.abs(rows[pivot][col]) < 1e-10) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const lead = rows[col][col];
    for (let c = col; c <= n; c += 1) rows[col][c] /= lead;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = rows[r][col];
      if (!f) continue;
      for (let c = col; c <= n; c += 1) rows[r][c] -= f * rows[col][c];
    }
  }
  return rows.map((r) => r[n]);
}

/**
 * The transform taking the four destination corners back to the four source
 * corners — the inverse direction, because warping is done by asking, for each
 * pixel of the output, where in the photograph it came from. Going forwards
 * would leave holes wherever the source stretches.
 */
function homography(dst, src) {
  const rows = [];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = dst[i];
    const [u, v] = src[i];
    rows.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u]);
    rows.push([0, 0, 0, x, y, 1, -x * v, -y * v, v]);
  }
  const h = solve8(rows);
  return h && [...h, 1];
}

/** The size a warped sheet should come out, from the length of its own sides. */
export function sheetSize(corners, cap) {
  const [tl, tr, br, bl] = corners;
  const span = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let w = Math.round(Math.max(span(br, bl), span(tr, tl)));
  let h = Math.round(Math.max(span(tr, br), span(tl, bl)));
  if (cap) {
    const k = Math.min(1, cap / Math.max(w, h));
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
  }
  return { width: w, height: h };
}

/**
 * The sheet, squared up: the quadrilateral it occupies in the photograph
 * redrawn as a rectangle, sampled bilinearly so the writing does not crawl.
 */
export function warp(image, corners, size) {
  const { width, height } = size;
  const src = image.data;
  const sw = image.width;
  const sh = image.height;
  const out = new Uint8ClampedArray(width * height * 4);
  const h = homography(
    [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
    corners
  );
  if (!h) return null;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const w = h[6] * x + h[7] * y + h[8];
      const u = (h[0] * x + h[1] * y + h[2]) / w;
      const v = (h[3] * x + h[4] * y + h[5]) / w;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const p = (y * width + x) * 4;
      if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) {
        out[p] = out[p + 1] = out[p + 2] = 255;   // off the photograph: paper white
        out[p + 3] = 255;
        continue;
      }
      const fx = u - x0;
      const fy = v - y0;
      const a = (y0 * sw + x0) * 4;
      const b = a + 4;
      const c = a + sw * 4;
      const d = c + 4;
      for (let k = 0; k < 3; k += 1) {
        const top = src[a + k] + (src[b + k] - src[a + k]) * fx;
        const bottom = src[c + k] + (src[d + k] - src[c + k]) * fx;
        out[p + k] = top + (bottom - top) * fy;
      }
      out[p + 3] = 255;
    }
  }
  return { data: out, width, height };
}
