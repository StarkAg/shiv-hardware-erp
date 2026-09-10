// ── The register as a PDF ───────────────────────────────────────────────────
// Written by hand rather than with a library. The page is numbers, names and
// ruled lines, which is close to what a PDF content stream is made of anyway,
// and a shop phone on mobile data should not fetch a third of a megabyte of
// general-purpose typesetting to print one sheet.
//
// The point of it is iOS: a home-screen app cannot print, but it can hand a
// file to the share sheet, and AirPrint is on that sheet. A PDF is also the
// thing to send on WhatsApp or keep in Files, which is what usually happens to
// a day's register anyway.

const A4 = { w: 595.28, h: 841.89 }
const MARGIN = 42
const LEAD = 14           // one written line
const SIZE = 10           // body text
const COL2 = 310          // where the paid column starts
const AMT_W = 78          // the amount column, right-aligned into it

// Helvetica advance widths, per 1000 units, for what actually gets measured:
// figures are all one width in this family, which is why columns of them line
// up at all. Anything unmeasured falls back to the digit width.
const W = { ',': 278, '.': 278, ' ': 278, '-': 333 }
const digit = 556
const textWidth = (s, size) => {
  let n = 0
  for (const ch of String(s)) n += (W[ch] ?? digit)
  return (n / 1000) * size
}

// PDF strings are parenthesised, so those and the escape character have to be
// escaped. WinAnsi has no Devanagari and no rupee sign: anything outside
// Latin-1 is dropped rather than written as a wrong glyph.
const esc = (s) => String(s)
  .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
  .replace(/([\\()])/g, '\\$1')

class Content {
  constructor() { this.ops = [] }
  text(x, y, s, { size = SIZE, bold = false, gray = 0, rgb } = {}) {
    const str = esc(s)
    if (!str) return this
    this.ops.push(rgb ? `${rgb.join(' ')} rg` : `${gray} g`)
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${str}) Tj ET`)
    return this
  }
  right(xRight, y, s, opts = {}) {
    return this.text(xRight - textWidth(s, opts.size ?? SIZE), y, s, opts)
  }
  line(x1, y, x2, { width = 1, gray = 0 } = {}) {
    this.ops.push(`${gray} G ${width} w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`)
    return this
  }
  vline(x, y1, y2, { width = 0.5, gray = 0.75 } = {}) {
    this.ops.push(`${gray} G ${width} w ${x.toFixed(2)} ${y1.toFixed(2)} m ${x.toFixed(2)} ${y2.toFixed(2)} l S`)
    return this
  }
  rect(x, y, w, h, rgb) {
    this.ops.push(`${rgb.join(' ')} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`)
    return this
  }
  toString() { return this.ops.join('\n') }
}

const YELLOW = [0.98, 0.93, 0.55]
const ORANGE = [0.99, 0.85, 0.68]
const RED = [0.62, 0.11, 0.13]
const INK = [0.12, 0.16, 0.27]

/** One entry line: its wash, the amount, the equals, the name. */
function entryLine(c, x0, y, e, { paid, colRight }) {
  const amtRight = x0 + AMT_W
  const w = colRight - (x0 - 4)
  if (e.dealer) c.rect(x0 - 4, y - 3.5, w, LEAD - 1, ORANGE)
  else if (e.online) c.rect(x0 - 4, y - 3.5, w, LEAD - 1, YELLOW)
  const rgb = paid ? RED : INK
  c.right(amtRight, y, e.amount, { bold: true, rgb })
  c.text(amtRight + 6, y, '=', { size: 8, gray: 0.45 })
  c.text(amtRight + 16, y, e.name, { rgb })
}

/**
 * Build the sheet. `data` is the page as the report already worked it out —
 * this only draws it, so the two cannot disagree about the arithmetic.
 */
export function registerPdf(data) {
  const { dateLabel, opening, ins, outs, dealerPaid, received, paid, book, counted, diff } = data
  const c = new Content()
  let y = A4.h - MARGIN

  c.right(A4.w - MARGIN, y, dateLabel, { bold: true, size: 11, gray: 0.35 })
  y -= LEAD + 6

  // The balance brought in, above the rule, with no column headings — the page
  // does not name its sides and neither does this.
  c.right(MARGIN + AMT_W, y, opening, { bold: true, size: 11 })
  c.text(MARGIN + AMT_W + 6, y, '=', { size: 8, gray: 0.45 })
  c.text(MARGIN + AMT_W + 16, y, 'O/B', { bold: true, size: 11 })
  y -= 6
  c.line(MARGIN, y, A4.w - MARGIN, { width: 1.2 })

  const top = y - LEAD
  const LEFT_RIGHT = COL2 - 20              // where the received column ends
  const PAID_RIGHT = A4.w - MARGIN          // and the paid column

  // Each column runs its own lines and closes with its own total, with the rule
  // sitting under the last line it adds up.
  const column = (x0, list, paid, total, colRight) => {
    let yy = top
    for (const e of list) { entryLine(c, x0, yy, e, { paid, colRight }); yy -= LEAD }
    c.line(x0 - 4, yy + LEAD - 5, x0 + AMT_W, { width: 1.2 })
    const totalY = yy - 2
    c.right(x0 + AMT_W, totalY, total, { bold: true, size: 11, rgb: paid ? RED : INK })
    return totalY
  }

  const receivedY = column(MARGIN, ins, false, received, LEFT_RIGHT)
  const paidY = column(COL2, outs, true, paid, PAID_RIGHT)
  c.vline(COL2 - 14, top + LEAD - 2, Math.min(receivedY, paidY) - 4)

  // The subtraction carries on down the received column, a written line a step.
  let ty = receivedY - LEAD
  c.right(MARGIN + AMT_W, ty, paid, { bold: true, size: 11 })
  c.line(MARGIN - 4, ty - 5, MARGIN + AMT_W, { width: 1.2 })
  ty -= LEAD
  c.right(MARGIN + AMT_W, ty, book, { bold: true, size: 11 })
  if (counted != null) {
    ty -= LEAD
    c.right(MARGIN + AMT_W, ty, counted, { bold: true, size: 11 })
    c.line(MARGIN - 4, ty - 5, MARGIN + AMT_W, { width: 1.2 })
    ty -= LEAD
    c.right(MARGIN + AMT_W, ty, diff.amount, { bold: true, size: 11, rgb: diff.ok ? [0.1, 0.48, 0.29] : RED })
    // The book writes this in Hindi; a PDF font that ships everywhere cannot
    // set Devanagari, so it says the same thing in the same place in English.
    c.text(MARGIN + AMT_W + 10, ty, diff.word, { size: 9, gray: 0.35 })
  }

  // Online paid to a dealer: never cash, so it sits at the foot on its own.
  if (dealerPaid.length) {
    let dy = MARGIN + LEAD * (dealerPaid.length + 2)
    c.text(COL2, dy, 'ONLINE PAYMENT', { size: 8, bold: true, rgb: [0.64, 0.27, 0.03] })
    dy -= LEAD
    for (const e of dealerPaid) {
      entryLine(c, COL2, dy, { ...e, dealer: false, online: true }, { paid: true, colRight: A4.w - MARGIN })
      dy -= LEAD
    }
    c.line(COL2 - 4, dy + LEAD - 5, COL2 + AMT_W, { width: 1.2 })
    c.right(COL2 + AMT_W, dy - 2, data.dealerTotal, { bold: true, size: 11, rgb: RED })
  }

  return assemble(c.toString())
}

/** Wrap a content stream in the smallest PDF that carries it. */
function assemble(stream) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] `
      + '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ]

  let out = '%PDF-1.4\n'
  const offsets = [0]
  objs.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })

  // The cross-reference table is byte offsets into the file, so it has to be
  // built from the string as it actually stands, not from a guess at lengths.
  const startxref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objs.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`

  // Latin-1: every byte written above is one byte on disk, which is what the
  // offsets above were counted in.
  const bytes = new Uint8Array(out.length)
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
  return bytes
}
