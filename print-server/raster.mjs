/**
 * A PDF or a photo, drawn into page pictures the size of the paper, and packed
 * as PWG raster: what a network printer prints straight off IPP with no
 * driver in between (ipp.mjs). The HP takes 8-bit grey (sgray_8) at 300 or
 * 600 dpi; a colour printer would take srgb_8.
 *
 *   renderPages(file, { dpi, paper, color, scale, orientation })  -> pages
 *   encodePwg(pages, { dpi, paper, copies })                        -> Buffer
 *   encodePclm(pages, { dpi, paper, color, stripHeight })           -> Buffer
 *
 * The HP aborts PWG raster (jobs 24 and 25, 25 Nov 2026) but prints PCLm,
 * which is what its own Windows driver sends, so PCLm goes first where a
 * printer takes it (direct-print.mjs).
 *
 * pdf.js (Mozilla) draws the PDF pages, @napi-rs/canvas holds the pictures;
 * both were already in node_modules for other uses.
 */
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { deflateSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const PDFJS_DIR = dirname(require.resolve('pdfjs-dist/package.json'))

/**
 * Paper sizes in millimetres, by their IPP names. Points and pixels are both
 * rounded DOWN, as the printers' own drivers do: the HP threw away a page sent
 * as 4961 x 7016 on 595 x 842 points (job 24, 25 Nov 2026), where its Windows
 * driver sends A4 as 4960 x 7015 at 600 dpi on 595 x 841.
 */
export const PAPER = {
  iso_a4_210x297mm: { w: 210, h: 297, points: [595, 841] },
  iso_a5_148x210mm: { w: 148, h: 210, points: [419, 595] },
  na_letter_8_5x11in: { w: 215.9, h: 279.4, points: [612, 792] },
}

let pdfjs = null
async function loadPdfjs() {
  if (!pdfjs) pdfjs = await import(pathToFileURL(join(PDFJS_DIR, 'legacy/build/pdf.mjs')).href)
  return pdfjs
}

/** The turn a JPEG's camera asks for (EXIF orientation), 1 when none. */
function jpegOrientation(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return 1
  let i = 2
  while (i + 4 < buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1]
    const len = buf.readUInt16BE(i + 2)
    if (marker === 0xe1 && buf.toString('latin1', i + 4, i + 10) === 'Exif\0\0') {
      const tiff = i + 10
      const le = buf.toString('latin1', tiff, tiff + 2) === 'II'
      const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o))
      const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o))
      const ifd = tiff + u32(tiff + 4)
      const count = u16(ifd)
      for (let n = 0; n < count; n += 1) {
        const entry = ifd + 2 + n * 12
        if (u16(entry) === 0x0112) return u16(entry + 8)
      }
      return 1
    }
    if (marker === 0xda) break
    i += 2 + len
  }
  return 1
}

/**
 * The paper as a white canvas, and where on it the content goes: fitted inside
 * the printer's margins and centred, turned a quarter when the content is
 * wider than tall on upright paper (or as `orientation` says).
 */
function layout(contentW, contentH, { dpi, paper, scale, orientation, marginMm }) {
  const size = PAPER[paper] ?? PAPER.iso_a4_210x297mm
  const pxW = Math.floor((size.w * 100 * dpi) / 2540)
  const pxH = Math.floor((size.h * 100 * dpi) / 2540)
  const turn = orientation === 'landscape' || (orientation !== 'portrait' && contentW > contentH)
  const w = turn ? contentH : contentW
  const h = turn ? contentW : contentH
  const margin = (marginMm / 25.4) * dpi
  const fits = Math.min((pxW - 2 * margin) / w, (pxH - 2 * margin) / h)
  const k = scale === 'noscale' ? 1 : scale === 'shrink' ? Math.min(1, fits) : fits
  return { pxW, pxH, turn, k, drawW: w * k, drawH: h * k }
}

function paperCanvas(pxW, pxH) {
  const canvas = createCanvas(pxW, pxH)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, pxW, pxH)
  return { canvas, ctx }
}

/** RGBA pixels as 8-bit grey (or packed RGB), the bytes PWG raster carries. */
function toRaster(ctx, pxW, pxH, color) {
  const rgba = ctx.getImageData(0, 0, pxW, pxH).data
  if (color) {
    const out = Buffer.allocUnsafe(pxW * pxH * 3)
    for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) {
      out[o] = rgba[i]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i + 2]
    }
    return out
  }
  const out = Buffer.allocUnsafe(pxW * pxH)
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 1) {
    // Rec. 601 luma, in integers.
    out[o] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8
  }
  return out
}

/**
 * The pages of a file as rasters the size of the paper.
 * `file` is { buffer, mediaType }.
 */
export async function renderPages(file, {
  dpi = 300, paper = 'iso_a4_210x297mm', color = false, scale = 'fit', orientation = null, marginMm = 4.23,
} = {}) {
  const opts = { dpi, paper, scale, orientation, marginMm }
  const pages = []

  if (file.mediaType === 'application/pdf') {
    const { getDocument } = await loadPdfjs()
    const doc = await getDocument({
      data: new Uint8Array(file.buffer),
      standardFontDataUrl: `${join(PDFJS_DIR, 'standard_fonts')}/`,
      cMapUrl: `${join(PDFJS_DIR, 'cmaps')}/`,
      cMapPacked: true,
      isEvalSupported: false,
      verbosity: 0,
    }).promise
    try {
      for (let n = 1; n <= doc.numPages; n += 1) {
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        // Content measured in printer pixels at scale 1: PDF points -> dpi.
        const pt = dpi / 72
        const L = layout(base.width * pt, base.height * pt, opts)
        const viewport = page.getViewport({ scale: pt * L.k, rotation: L.turn ? 90 : 0 })
        const { canvas, ctx } = paperCanvas(L.pxW, L.pxH)
        const x = Math.round((L.pxW - viewport.width) / 2)
        const y = Math.round((L.pxH - viewport.height) / 2)
        await page.render({ canvasContext: ctx, viewport, transform: [1, 0, 0, 1, x, y], background: '#fff' }).promise
        pages.push({ width: L.pxW, height: L.pxH, data: toRaster(ctx, L.pxW, L.pxH, color) })
        page.cleanup()
        canvas.width = 0
      }
    } finally {
      await doc.destroy()
    }
    return pages
  }

  // A photo: drawn upright (EXIF), fitted to the paper.
  const image = await loadImage(file.buffer)
  const orient = file.mediaType === 'image/jpeg' ? jpegOrientation(file.buffer) : 1
  const sideways = orient >= 5
  const srcW = sideways ? image.height : image.width
  const srcH = sideways ? image.width : image.height
  const L = layout(srcW, srcH, { ...opts, scale: scale === 'noscale' ? 'shrink' : scale })
  const { canvas, ctx } = paperCanvas(L.pxW, L.pxH)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(L.pxW / 2, L.pxH / 2)
  if (L.turn) ctx.rotate(Math.PI / 2)
  // EXIF: 3 = upside down, 6 = turn right, 8 = turn left; mirrored ones (2,4,5,7) flip too.
  const turnBy = { 3: Math.PI, 4: Math.PI, 5: Math.PI / 2, 6: Math.PI / 2, 7: -Math.PI / 2, 8: -Math.PI / 2 }[orient] ?? 0
  if (turnBy) ctx.rotate(turnBy)
  if ([2, 4, 5, 7].includes(orient)) ctx.scale(-1, 1)
  // drawW/drawH are in the paper's frame after the layout turn; undo it for the image's own frame.
  const w = L.turn ? L.drawH : L.drawW
  const h = L.turn ? L.drawW : L.drawH
  const [iw, ih] = sideways ? [h, w] : [w, h]
  ctx.drawImage(image, -iw / 2, -ih / 2, iw, ih)
  pages.push({ width: L.pxW, height: L.pxH, data: toRaster(ctx, L.pxW, L.pxH, color) })
  canvas.width = 0
  return pages
}

/* ── PWG raster (PWG 5102.4) ─────────────────────────────────────────────── */

const WHITE = 0xff

/** One line, PWG-packed: runs of a repeated pixel, and stretches of differing ones. */
function packLine(line, bpp, out) {
  const n = line.length / bpp
  let i = 0
  const same = (a, b) => {
    for (let k = 0; k < bpp; k += 1) if (line[a * bpp + k] !== line[b * bpp + k]) return false
    return true
  }
  while (i < n) {
    // A run of the same pixel, up to 128.
    let run = 1
    while (i + run < n && run < 128 && same(i, i + run)) run += 1
    if (run > 1) {
      out.push(run - 1)
      for (let k = 0; k < bpp; k += 1) out.push(line[i * bpp + k])
      i += run
      continue
    }
    // A stretch of differing pixels, up to 128, ending before the next run.
    let lit = 1
    while (i + lit < n && lit < 128 && !(i + lit + 1 < n && same(i + lit, i + lit + 1))) lit += 1
    if (lit === 1) {
      out.push(0)
      for (let k = 0; k < bpp; k += 1) out.push(line[i * bpp + k])
    } else {
      out.push(257 - lit)
      for (let p = 0; p < lit * bpp; p += 1) out.push(line[i * bpp + p])
    }
    i += lit
  }
}

function header(page, { dpi, paper, totalPages, color }) {
  const h = Buffer.alloc(1796)
  const size = PAPER[paper] ?? PAPER.iso_a4_210x297mm
  const bpp = color ? 3 : 1
  const u32 = (offset, value) => h.writeUInt32BE(value >>> 0, offset)
  const str = (offset, value) => h.write(value, offset, 63, 'utf8')
  str(0, 'PwgRaster') // MediaClass
  u32(276, dpi); u32(280, dpi) // HWResolution
  u32(340, 1) // NumCopies (the job's copies do the rest)
  u32(352, size.points[0]); u32(356, size.points[1]) // PageSize, points
  u32(372, page.width); u32(376, page.height) // cupsWidth, cupsHeight
  u32(384, 8); u32(388, 8 * bpp) // bits per colour, per pixel
  u32(392, page.width * bpp) // bytes per line
  u32(396, 0) // chunky
  u32(400, color ? 19 : 18) // sRGB (19) or sGray (18)
  u32(420, bpp) // cupsNumColors
  u32(452, totalPages) // TotalPageCount
  u32(456, 1); u32(460, 1) // CrossFeedTransform, FeedTransform
  u32(472, page.width); u32(476, page.height) // ImageBox right, bottom
  str(1732, paper) // cupsPageSizeName
  return h
}

/** The pages as one PWG raster stream. */
export function encodePwg(pages, { dpi = 300, paper = 'iso_a4_210x297mm', color = false } = {}) {
  const bpp = color ? 3 : 1
  const chunks = [Buffer.from('RaS2', 'latin1')]
  for (const page of pages) {
    chunks.push(header(page, { dpi, paper, totalPages: pages.length, color }))
    const stride = page.width * bpp
    const out = []
    let y = 0
    while (y < page.height) {
      const line = page.data.subarray(y * stride, (y + 1) * stride)
      // Lines the same as this one, up to 256, go as one.
      let repeat = 1
      while (y + repeat < page.height && repeat < 256 && line.equals(page.data.subarray((y + repeat) * stride, (y + repeat + 1) * stride))) repeat += 1
      out.push(repeat - 1)
      // A blank line packs to a handful of bytes; skip the pixel-by-pixel pass.
      if (line[0] === WHITE && line.every((v) => v === WHITE)) {
        let left = page.width
        while (left > 0) {
          const run = Math.min(128, left)
          out.push(run - 1)
          for (let k = 0; k < bpp; k += 1) out.push(WHITE)
          left -= run
        }
      } else {
        packLine(line, bpp, out)
      }
      y += repeat
    }
    chunks.push(Buffer.from(out))
  }
  return Buffer.concat(chunks)
}

/* ── PCLm (the PDF-shaped raster of the Mopria / Wi-Fi Direct Print spec) ─── */

/**
 * The pages as PCLm: a PDF 1.7 whose every page is a stack of strips, each a
 * Flate-packed picture `stripHeight` lines tall, placed top to bottom. Laid
 * out as the HP's own driver lays it out (its output, 25 Nov 2026): the page,
 * its drawing, its strips, then the page list and catalogue at the end.
 */
export function encodePclm(pages, { dpi = 600, paper = 'iso_a4_210x297mm', color = false, stripHeight = 64 } = {}) {
  const size = PAPER[paper] ?? PAPER.iso_a4_210x297mm
  const bpp = color ? 3 : 1
  const parts = []
  let offset = 0
  const offsets = []
  const put = (chunk) => {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'latin1') : chunk
    parts.push(buf)
    offset += buf.length
  }
  const object = (num, dict, stream = null) => {
    offsets[num] = offset
    put(`${num} 0 obj\n${dict}\n`)
    if (stream) {
      put('stream\n')
      put(stream)
      put('\nendstream\n')
    }
    put('endobj\n')
  }

  put('%PDF-1.7\n%PCLm 1.0\n')
  let next = 3 // 1 = catalogue, 2 = page list
  const kids = []
  const scale = (72 / dpi).toFixed(6)
  for (const page of pages) {
    const stride = page.width * bpp
    const strips = Math.ceil(page.height / stripHeight)
    const pageNum = next
    const contentNum = next + 1
    const firstImage = next + 2
    next += 2 + strips
    kids.push(pageNum)

    const names = []
    let drawing = `${scale} 0 0 ${scale} 0 0 cm\n`
    for (let s = 0; s < strips; s += 1) {
      const top = s * stripHeight
      const rows = Math.min(stripHeight, page.height - top)
      // PDF counts up from the bottom of the page.
      drawing += `q\n${page.width} 0 0 ${rows} 0 ${page.height - top - rows} cm\n/Image${s} Do Q\n`
      names.push(`/Image${s} ${firstImage + s} 0 R`)
    }
    const content = Buffer.from(drawing, 'latin1')
    object(pageNum, `<<\n/Type /Page\n/Parent 2 0 R\n/Resources <<\n/XObject <<\n${names.join('\n')}\n>>\n>>\n/MediaBox [ 0 0 ${size.points[0]} ${size.points[1]} ]\n/Contents [ ${contentNum} 0 R ]\n>>`)
    object(contentNum, `<<\n/Length ${content.length}\n>>`, content)
    for (let s = 0; s < strips; s += 1) {
      const top = s * stripHeight
      const rows = Math.min(stripHeight, page.height - top)
      const packed = deflateSync(page.data.subarray(top * stride, (top + rows) * stride), { level: 1 })
      object(firstImage + s, `<<\n/Width ${page.width}\n/ColorSpace /${color ? 'DeviceRGB' : 'DeviceGray'}\n/Height ${rows}\n/Filter /FlateDecode\n/Subtype /Image\n/Length ${packed.length}\n/Type /XObject\n/BitsPerComponent 8\n>>`, packed)
    }
  }
  object(2, `<<\n/Type /Pages\n/Kids [ ${kids.map((k) => `${k} 0 R`).join(' ')} ]\n/Count ${kids.length}\n>>`)
  object(1, '<<\n/Type /Catalog\n/Pages 2 0 R\n>>')

  const xref = offset
  let table = `xref\n0 ${next}\n0000000000 65535 f \n`
  for (let n = 1; n < next; n += 1) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  put(table)
  put(`trailer\n<<\n/Root 1 0 R\n/Size ${next}\n>>\nstartxref\n${xref}\n%%EOF\n`)
  return Buffer.concat(parts)
}
