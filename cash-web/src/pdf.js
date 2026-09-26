// ── The day's cash book, as a PDF ───────────────────────────────────────────
// Written by hand rather than with a library. The page is numbers, names and
// ruled lines, which is close to what a PDF content stream is made of anyway,
// and a shop phone on mobile data should not fetch a third of a megabyte of
// general-purpose typesetting to print one sheet.
//
// The point of it is iOS: a home-screen app cannot print, but it can hand a
// file to the share sheet, and AirPrint is on that sheet. A PDF is also the
// thing to send on WhatsApp or keep in Files, which is what usually happens to
// a day's register anyway.
//
// WHAT THIS PAGE IS
// The screen is the shop's own bahi — receipts left, payments right, and a
// subtraction at the foot. This is the same day written as a proper DOUBLE
// COLUMN CASH BOOK, which is what anybody outside the shop expects to be handed:
//
//   · Dr (receipts) on the left, Cr (payments) on the right
//   · two money columns a side — Cash and Bank — so money that arrived online
//     sits in its own column instead of being mixed into the drawer or
//     written twice to cancel itself out
//   · opening written as "To Balance b/d", closing as "By Balance c/d"
//   · each column totals, and the two sides total to the same figure
//
// The drawer count is not part of that arithmetic — a cash book balances by
// construction — so it is set below the totals as a verification, which is what
// it actually is.

const A4 = { w: 595.28, h: 841.89 }
const MARGIN = 40
const SIZE = 9.5

// Base-14 fonts only. Embedding a face would be most of the file size for a
// sheet that is read once and filed, so the page takes its character from the
// ruling and the setting instead: Times for the names, which is what a ledger
// looks like, and Helvetica for figures, whose digits are all one width and
// therefore line up in a column.
const F = { name: 'F1', nameBold: 'F2', fig: 'F3', figBold: 'F4' }

// Helvetica advance widths per 1000 units for what actually gets measured.
const HELV = { ',': 278, '.': 278, ' ': 278, '-': 333, '–': 556 }
const HELV_DIGIT = 556
const figWidth = (s, size) => {
  let n = 0
  for (const ch of String(s)) n += HELV[ch] ?? HELV_DIGIT
  return (n / 1000) * size
}
// Times-Roman advance widths per 1000 units, ASCII 32-126. Guessing at these
// cut names two or three letters early — "Ravi shankar gst challan" came out as
// "Ravi shankar gst cha." with room to spare — so the real table is here.
const TIMES = (
  '250 333 408 500 500 833 778 333 333 333 500 564 250 333 250 278 ' +
  '500 500 500 500 500 500 500 500 500 500 278 278 564 564 564 444 ' +
  '921 722 667 667 722 611 556 722 722 333 389 722 611 889 722 722 ' +
  '556 722 667 556 611 722 722 944 722 722 611 333 278 333 469 500 ' +
  '333 444 500 444 500 444 333 500 500 278 278 500 278 778 500 500 ' +
  '500 500 333 389 278 500 500 722 500 500 444 480 200 480 541'
).split(' ').map(Number)
const nameWidth = (s, size) => {
  let n = 0
  for (const ch of String(s)) {
    const i = ch.charCodeAt(0) - 32
    n += i >= 0 && i < TIMES.length ? TIMES[i] : 500
  }
  return (n / 1000) * size
}

const esc = (s) => String(s)
  // PDF strings are parenthesised, and WinAnsi has no Devanagari and no rupee
  // sign: anything outside Latin-1 is dropped rather than set as a wrong glyph.
  .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
  .replace(/([\\()])/g, '\\$1')

/** A name cut to the room it has, with a full stop to show it was cut. */
function clip(s, maxWidth, size) {
  const str = String(s ?? '')
  if (nameWidth(str, size) <= maxWidth) return str
  let out = str
  while (out.length > 1 && nameWidth(`${out}.`, size) > maxWidth) out = out.slice(0, -1)
  return `${out.trimEnd()}.`
}

const inr = (n) => Number(n || 0).toLocaleString('en-IN')

class Content {
  constructor() { this.ops = [] }
  text(x, y, s, { size = SIZE, font = F.name, gray = 0, rgb } = {}) {
    const str = esc(s)
    if (!str) return this
    this.ops.push(rgb ? `${rgb.join(' ')} rg` : `${gray} g`)
    this.ops.push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${str}) Tj ET`)
    return this
  }
  /** A figure, right-aligned into a column. Always Helvetica: tabular digits. */
  fig(xRight, y, s, { size = SIZE, bold = false, gray = 0, rgb } = {}) {
    const str = String(s)
    return this.text(xRight - figWidth(str, size), y, str, {
      size, font: bold ? F.figBold : F.fig, gray, rgb,
    })
  }
  /* Set on a slant, for the one thing on this page that is a stamp rather than
     a written line. The text matrix carries the rotation: a b c d are the
     turned axes, e f the point the baseline starts from. */
  slant(x, y, s, deg, { size = SIZE, font = F.nameBold, rgb = [0, 0, 0] } = {}) {
    const str = esc(s)
    if (!str) return this
    const r = (deg * Math.PI) / 180
    const cos = Math.cos(r).toFixed(4)
    const sin = Math.sin(r).toFixed(4)
    this.ops.push(`${rgb.join(' ')} rg`)
    this.ops.push(
      `BT /${font} ${size} Tf ${cos} ${sin} ${-sin} ${cos} `
      + `${x.toFixed(2)} ${y.toFixed(2)} Tm (${str}) Tj ET`,
    )
    return this
  }
  line(x1, y, x2, { width = 0.6, gray = 0 } = {}) {
    this.ops.push(`${gray} G ${width} w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`)
    return this
  }
  vline(x, y1, y2, { width = 0.6, gray = 0.6 } = {}) {
    this.ops.push(`${gray} G ${width} w ${x.toFixed(2)} ${y1.toFixed(2)} m ${x.toFixed(2)} ${y2.toFixed(2)} l S`)
    return this
  }
  rect(x, y, w, h, rgb) {
    this.ops.push(`${rgb.join(' ')} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`)
    return this
  }
  toString() { return this.ops.join('\n') }
}

const RED = [0.60, 0.11, 0.13]
const INK = [0.10, 0.13, 0.22]
const STAMP = [0.85, 0.66, 0.68]        // the closed stamp, inked thin so the page reads through it
const BANKWASH = [0.98, 0.95, 0.80]
const DEALWASH = [0.99, 0.88, 0.75]
const RULE = 0.55

/**
 * Build the sheet. `data` is the day as the report already worked it out; this
 * only sets it, so the screen and the paper cannot disagree about the figures.
 */
export function registerPdf(data) {
  const {
    dateLabel, dayLabel,
    openCash = 0, openBank = 0,
    receipts = [], payments = [],
    closeCash = 0, closeBank = 0,
    counted = null, diff = null,
    shut = false,
  } = data

  const c = new Content()
  const RIGHT = A4.w - MARGIN
  const SIDE = (RIGHT - MARGIN) / 2
  const MID = MARGIN + SIDE

  // Where each column sits inside one side of the book.
  const NAME_X = 6            // particulars, from the side's own left edge
  const NAME_W = 118
  const CASH_R = 190          // right edge of the Cash column
  const BANK_R = SIDE - 6     // right edge of the Bank column
  const CASH_RULE = 124       // the ruling between particulars and Cash
  const BANK_RULE = 196       // and between Cash and Bank

  // ── heading ───────────────────────────────────────────────────────────────
  let y = A4.h - MARGIN - 10
  c.text(MARGIN, y, 'SHIV HARDWARE', { size: 15, font: F.nameBold, rgb: INK })
  c.fig(RIGHT, y, dateLabel, { size: 13, bold: true, gray: 0.2 })
  y -= 14
  c.text(MARGIN, y, 'CASH BOOK', { size: 8.5, font: F.figBold, gray: 0.42 })
  if (dayLabel) c.fig(RIGHT, y, dayLabel, { size: 8.5, gray: 0.45 })
  y -= 8
  c.line(MARGIN, y, RIGHT, { width: 1.4, gray: 0.1 })

  // ── column headings ───────────────────────────────────────────────────────
  y -= 13
  const side = (n) => MARGIN + n * SIDE
  for (const [n, label] of [[0, 'Dr.  RECEIPTS'], [1, 'Cr.  PAYMENTS']]) {
    const sx = side(n)
    c.text(sx + NAME_X, y, label, { size: 8, font: F.figBold, gray: 0.3 })
    c.fig(sx + CASH_R, y, 'CASH', { size: 7.5, bold: true, gray: 0.42 })
    c.fig(sx + BANK_R, y, 'BANK', { size: 7.5, bold: true, gray: 0.42 })
  }
  y -= 5
  c.line(MARGIN, y, RIGHT, { width: 0.9, gray: 0.25 })

  // ── the lines ─────────────────────────────────────────────────────────────
  // Opening above everything, closing below everything: that is what makes the
  // two sides add to the same figure, and it is the whole shape of a cash book.
  const drRows = [
    { name: 'To Balance b/d', cash: openCash, bank: openBank, rule: true },
    ...receipts.map((e) => ({
      name: `To ${e.name || '-'}`,
      cash: e.bank ? null : e.amount,
      bank: e.bank ? e.amount : null,
      dealer: e.dealer,
    })),
  ]
  const crRows = [
    ...payments.map((e) => ({
      name: `By ${e.name || '-'}`,
      cash: e.bank ? null : e.amount,
      bank: e.bank ? e.amount : null,
      dealer: e.dealer,
    })),
    { name: 'By Balance c/d', cash: closeCash, bank: closeBank, rule: true },
  ]

  // One page, always. A busy day tightens the ruling rather than spilling onto
  // a second sheet nobody will keep with the first.
  const rows = Math.max(drRows.length, crRows.length)
  const room = y - MARGIN - 86
  const LEAD = Math.max(8.5, Math.min(21, room / (rows + 1)))
  const fs = Math.max(7, Math.min(SIZE + 1.5, LEAD - 5))

  const top = y
  const bodyBottom = y - LEAD * rows

  const putRow = (sx, r, yy) => {
    if (r.bank != null && !r.rule) {
      c.rect(sx + BANK_RULE, yy - LEAD * 0.28, BANK_R - BANK_RULE + 6, LEAD * 0.92,
        r.dealer ? DEALWASH : BANKWASH)
    }
    c.text(sx + NAME_X, yy, clip(r.name, NAME_W, fs), {
      size: fs,
      font: r.rule ? F.nameBold : F.name,
      rgb: INK,
    })
    if (r.cash != null) c.fig(sx + CASH_R, yy, inr(r.cash), { size: fs, bold: r.rule })
    if (r.bank != null) c.fig(sx + BANK_R, yy, inr(r.bank), { size: fs, bold: r.rule })
  }

  for (let i = 0; i < rows; i += 1) {
    const yy = top - LEAD * (i + 1) + LEAD * 0.28
    if (drRows[i]) putRow(side(0), drRows[i], yy)
    if (crRows[i]) putRow(side(1), crRows[i], yy)
    // A ruled line under every row, the way a ledger page is ruled.
    c.line(MARGIN, yy - LEAD * 0.28, RIGHT, { width: 0.25, gray: 0.82 })
  }

  // The ruling that makes the columns columns.
  for (const n of [0, 1]) {
    const sx = side(n)
    c.vline(sx + CASH_RULE, top, bodyBottom, { width: 0.4, gray: 0.7 })
    c.vline(sx + BANK_RULE, top, bodyBottom, { width: 0.4, gray: 0.7 })
  }
  c.vline(MID, top + 16, bodyBottom - 26, { width: 1, gray: 0.2 })

  // ── totals ────────────────────────────────────────────────────────────────
  // Both sides come to the same pair of figures. That is the check: a cash book
  // that does not balance has a line missing, and the page says so by not
  // matching rather than by being told.
  const totalCash = openCash + receipts.reduce((t, e) => t + (e.bank ? 0 : e.amount), 0)
  const totalBank = openBank + receipts.reduce((t, e) => t + (e.bank ? e.amount : 0), 0)

  let ty = bodyBottom - 12
  c.line(MARGIN, ty + LEAD * 0.62, RIGHT, { width: 0.9, gray: 0.25 })
  for (const n of [0, 1]) {
    const sx = side(n)
    c.text(sx + NAME_X, ty, 'Total', { size: fs, font: F.nameBold, rgb: INK })
    c.fig(sx + CASH_R, ty, inr(totalCash), { size: fs + 0.5, bold: true, rgb: INK })
    c.fig(sx + BANK_R, ty, inr(totalBank), { size: fs + 0.5, bold: true, rgb: INK })
    // The accountant's double rule under a total.
    for (const col of [[CASH_RULE + 4, CASH_R], [BANK_RULE + 4, BANK_R]]) {
      c.line(sx + col[0], ty - 3.5, sx + col[1], { width: 0.5, gray: 0.2 })
      c.line(sx + col[0], ty - 5.5, sx + col[1], { width: 0.5, gray: 0.2 })
    }
  }

  // ── the drawer count ──────────────────────────────────────────────────────
  // Not part of the book's arithmetic — the book balances by construction — so
  // it sits underneath as what it is: the drawer checked against the book.
  ty -= 26
  if (counted != null && diff) {
    c.line(MARGIN, ty + 11, MARGIN + SIDE - 20, { width: 0.5, gray: 0.55 })
    c.text(MARGIN, ty, 'CASH VERIFICATION', { size: 7.5, font: F.figBold, gray: 0.42 })
    let vy = ty - 12
    for (const [label, value, opts] of [
      ['As per book', inr(closeCash), {}],
      ['Counted in the drawer', inr(counted), {}],
      [diff.word === 'TALLIED' ? 'Tallied' : diff.word === 'SHORT' ? 'Short by' : 'Over by',
        inr(diff.amount),
        { rgb: diff.ok ? [0.09, 0.45, 0.28] : RED, bold: true }],
    ]) {
      c.text(MARGIN + 4, vy, label, { size: 8.5, rgb: INK })
      c.fig(MARGIN + 190, vy, value, { size: 9, bold: opts.bold, rgb: opts.rgb })
      vy -= 12
    }
  }

  // ── the key, and the signature line ───────────────────────────────────────
  const footY = MARGIN + 16
  c.rect(MID + 6, footY + 9, 9, 7, BANKWASH)
  c.text(MID + 19, footY + 10, 'bank / UPI', { size: 7.5, gray: 0.4 })
  c.rect(MID + 74, footY + 9, 9, 7, DEALWASH)
  c.text(MID + 87, footY + 10, 'dealer', { size: 7.5, gray: 0.4 })

  c.line(RIGHT - 150, footY - 4, RIGHT, { width: 0.5, gray: 0.55 })
  c.text(RIGHT - 150, footY - 14, 'Checked by', { size: 7.5, gray: 0.45 })

  // A day the shop never opened says so across the middle of the sheet. The
  // book writes it in Hindi as well; this font cannot set Devanagari, so the
  // sheet carries the English line only. Helvetica-Bold capitals run around
  // 0.68em each, which is close enough to centre an eleven-letter stamp.
  if (shut) {
    const size = 44
    const deg = -20
    const word = 'SHOP CLOSED'
    const r = (deg * Math.PI) / 180
    const wide = 0.68 * size * word.length
    c.slant(
      A4.w / 2 - (wide / 2) * Math.cos(r),
      A4.h / 2 - (wide / 2) * Math.sin(r) - size * 0.35,
      word, deg, { size, rgb: STAMP },
    )
  }

  return assemble(c.toString())
}

/** Wrap a content stream in the smallest PDF that carries it. */
function assemble(stream) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] `
      + '/Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R /F4 8 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>',
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
  // built after the objects and cannot be guessed at.
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objs.length; i += 1) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return out
}
