// Pure HTML template — no React/Tailwind, no external deps.
// Mirrors the AluminiumPrint and QuotationPrint layouts exactly.

import { readFile } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import QRCode from 'qrcode'

const __dir = dirname(fileURLToPath(import.meta.url))
const ASSETS = resolve(__dir, '../public/assets')

// PVC ID-card geometry. The Epson L8050 clips a margin at the extreme card edge
// — a frame printed at 0mm comes out crooked/partial — so the usable print area
// is the card inset by CARD_SAFE_MM on every side. Card content anchors to that
// print area, never to the raw card edge.
export const CARD_W_MM = 54
export const CARD_H_MM = 86
export const CARD_SAFE_MM = 3
export const CARD_PRINT_W_MM = CARD_W_MM - CARD_SAFE_MM * 2  // 48mm
export const CARD_PRINT_H_MM = CARD_H_MM - CARD_SAFE_MM * 2  // 80mm
// The card's QR and the "SCAN TO VERIFY" line under it (4pt type, about 1.45mm tall).
export const CARD_QR_MM = 12
export const CARD_QR_LABEL_MM = 1.45
export const CARD_QR_GAP_MM = 0.5

// Inline SVG QR for the guarantee card's online view. Returns '' if there's no
// URL to encode (so the layout simply omits the QR rather than breaking).
async function qrSvg(value, sizeMm) {
  if (!value) return ''
  try {
    const svg = await QRCode.toString(String(value), {
      type: 'svg', margin: 0, errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
    return `<div style="width:${sizeMm}mm;height:${sizeMm}mm;line-height:0">${svg}</div>`
  } catch {
    return ''
  }
}

async function b64(file) {
  const buf = await readFile(resolve(ASSETS, file))
  const mime = file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${buf.toString('base64')}`
}

const GREEN = '#B9924B'
const RED = '#9F1D20'
const CATEGORY_LABELS = {
  'readymade-door': 'Readymade Door',
  'flush-door': 'Flush Door (Plain)',
  'plywood-6': 'Water Proof Plywood 6mm',
  'block-board-12': 'Water Proof Block Board 12mm',
  'block-board-19': 'Water Proof Block Board 19mm',
  'aluminium-door': 'Aluminium Door',
  'window-2-track': '2 Track Sliding Window',
  'window-3-track': '3 Track Sliding Window',
}
const GUARANTEE_TERMS = [
  'Guarantee is against borer/termite only, subject to proper installation and maintenance.',
  'Guarantee is not valid against water-logging, fire, physical/mechanical damage or misuse.',
  'This card must be produced at the time of any claim.',
  'Polish, fittings, glass and handles are not covered under guarantee.',
]

function coverageLabel(coverage) {
  return coverage === 'warranty' ? 'Warranty' : 'Guarantee'
}

const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

function shortenBrand(name) {
  if (!name || name.length <= 9) return name
  const words = name.trim().split(/\s+/)
  if (words.length < 2) return name
  return words.slice(0, -1).map(w => w[0]).join('') + ' ' + words[words.length - 1]
}

const formatDimension = dim => dim?.soot ? `${dim.inches} ${dim.soot}/8"` : dim?.inches ? `${dim.inches}"` : ''
const formatSize = (height, width) => [formatDimension(height), formatDimension(width)].filter(Boolean).join(' X ')
const legacyDimension = dim => dim?.soot ? `${dim.inches} ${dim.soot}/8"` : dim?.inches ? String(dim.inches) : ''
const legacyThickness = category => ({
  'readymade-door': '30 mm',
  'flush-door': '30 mm',
  'plywood-6': '6mm',
  'block-board-12': '12mm',
  'block-board-19': '19mm',
})[category] ?? ''
// Compact labels used on the PVC card overlay (legacy Excel style: "30MM")
const cardThickness = category => ({
  'readymade-door': '30MM',
  'flush-door': '30MM',
  'plywood-6': '6MM',
  'block-board-12': '12MM',
  'block-board-19': '19MM',
  'film-face-ply': '12MM',
})[category] ?? ''
// Size without inch marks, as on the old card: 79 4/8 X 44
const cardDimension = dim => dim?.soot ? `${dim.inches} ${dim.soot}/8` : dim?.inches ? String(dim.inches) : ''
const cardSize = (height, width) => [cardDimension(height), cardDimension(width)].filter(Boolean).join(' X ')
const legacyCategoryLabel = category => ({
  'readymade-door': 'Readymade Door Water Proof',
  'flush-door': 'Flush Door (Plain Door) Water Proof',
  'plywood-6': 'Water Proof Plywood',
  'block-board-12': 'Water Proof Block Board',
  'block-board-19': 'Water Proof Block Board',
})[category] ?? CATEGORY_LABELS[category] ?? category

const hasTwoGtyCols = cat => cat === 'flush-door' || cat === 'block-board-12' || cat === 'block-board-19'

const SECTION_CONFIG = {
  'block-board-12': {
    first: '1. Water Proof Ply',
    breaks: { Amron: '2. Semi Water Proof Ply', 'Assam Gold': '3. Commercial Ply' },
  },
  'block-board-19': {
    first: '1. Water Proof Block Board',
    breaks: { Amron: '2. Semi Water Proof Block Board', 'Assam Gold': '3. Commercial Ply Block Board' },
  },
}

const ROW_H = 6.39
const BRAND_START = 126.75
const SECTION_GAP = 3

function buildPrintItems(category, rows) {
  const cfg = SECTION_CONFIG[category]
  if (!cfg) return (rows ?? []).map((row, i) => ({ kind: 'brand', row, top: BRAND_START + i * ROW_H }))

  const items = []
  let top = BRAND_START - ROW_H

  items.push({ kind: 'section', label: cfg.first, top })
  top += ROW_H

  for (const row of (rows ?? [])) {
    const secLabel = cfg.breaks[row.brandName]
    if (secLabel) {
      top += SECTION_GAP
      items.push({ kind: 'section', label: secLabel, top })
      top += ROW_H
    }
    items.push({ kind: 'brand', row, top })
    top += ROW_H
  }

  return items
}

function page(body) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4 portrait; margin: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; }
  .page { width: 210mm; min-height: 297mm; background: #fff; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #000; padding: 4px 6px; font-size: 12px; }
  th { font-weight: 600; background: #f3f3f3; }
  .green { color: ${GREEN}; }
  .red { color: ${RED}; }
  .bold { font-weight: 700; }
  .right { text-align: right; }
  .center { text-align: center; }
</style>
</head><body><div class="page">${body}</div></body></html>`
}

/**
 * One line, never dots: a box marked data-fit holds its text in an inline-block
 * (fitInner). If the text is wider than the box, the font shrinks to fit (down
 * to 70%), then the rest is squeezed horizontally with scaleX — so any length
 * prints whole on one line. Runs in Puppeteer before the screenshot. Mirrors
 * fitLine() in src/lib/fitLine.ts (the on-screen preview); keep them in sync.
 */
const fitInner = (html) => `<span data-fit-inner style="display:inline-block;white-space:nowrap">${html}</span>`
const FIT_SCRIPT = `<script>
document.querySelectorAll('[data-fit]').forEach(function (box) {
  var inner = box.firstElementChild
  if (!inner) return
  // Fractional widths: offsetWidth/clientWidth round to whole px and let a
  // sub-pixel overflow through, which then gets clipped.
  var room = box.getBoundingClientRect().width
  var need = inner.getBoundingClientRect().width
  if (!room || need <= room) return
  var base = parseFloat(getComputedStyle(inner).fontSize)
  inner.style.fontSize = Math.max(base * 0.7, base * room / need) + 'px'
  need = inner.getBoundingClientRect().width
  if (need > room) {
    inner.style.transformOrigin = 'left center'
    inner.style.transform = 'scaleX(' + room / need + ')'
  }
})
</script>`

function cardPage(body) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: ${CARD_W_MM}mm ${CARD_H_MM}mm; margin: 0; }
  html, body { width: ${CARD_W_MM}mm; height: ${CARD_H_MM}mm; margin: 0; background: #fff; }
  /* Printer-safe print area: the card inset by CARD_SAFE_MM on every side. */
  :root { --card-safe: ${CARD_SAFE_MM}mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; overflow: hidden; }
</style>
</head><body>${body}${FIT_SCRIPT}</body></html>`
}

export async function buildQuotationHtml(quote) {
  if (quote.alu) return buildAluminiumHtml(quote)

  const header = await b64('aluminium/header-door.jpeg')
  const { category, height, width, rows } = quote
  const twoCol = hasTwoGtyCols(category)
  const tintRight = twoCol ? '2mm' : '32mm'
  const printItems = buildPrintItems(category, rows)
  const rowsHtml = printItems.map(item => {
    if (item.kind === 'section') {
      return `<div style="position:absolute;left:29mm;top:${item.top}mm;font-size:15pt;line-height:1.1;color:#00B0F0">${esc(item.label)}</div>`
    }
    const r = item.row
    const gty = Number(r.guaranteeYears)
    const isWarranty = r.coverage === 'warranty'
    const gtySpan = twoCol
      ? `<span class="guarantee">${gty && !isWarranty ? `${gty} Years` : ''}</span><span class="warranty">${gty && isWarranty ? `${gty} Years` : ''}</span>`
      : `<span class="guarantee">${gty ? `${gty} Years` : ''}</span>`
    const bgDiv = r.accentColor
      ? `<div style="position:absolute;top:0;bottom:0;left:29mm;right:${tintRight};background:${esc(r.accentColor)}"></div>`
      : ''
    return `
    <div class="legacy-row" style="top:${item.top}mm">
      ${bgDiv}
      <span class="rate">${esc(r.rate)}</span>
      <span class="brand">${esc(r.brandName)}</span>
      <span class="cost">${esc(Math.round(Number(r.cost) || 0))}</span>
      ${gtySpan}
    </div>`
  }).join('')

  return page(`
    <style>
      .page { position: relative; font-family: Arial, Helvetica, sans-serif; }
      .legacy-head { position:absolute; left:27.94mm; top:22.47mm; width:88.06mm; height:53.53mm; display:block; }
      .legacy-title { position:absolute; left:29mm; top:81.3mm; font-size:15pt; color:#00b050; }
      .legacy-info { position:absolute; font-size:15pt; line-height:1.1; }
      .legacy-line { position:absolute; left:29mm; top:107mm; border-top:1.5px solid #000; }
      .legacy-row { position:absolute; left:0; right:0; height:6.45mm; font-size:15pt; line-height:1.05; }
      .legacy-row span { position:absolute; white-space:nowrap; }
      .rate { left:31mm; }
      .brand { left:56.4mm; }
      .cost { left:127mm; }
      .guarantee { left:148mm; width:30mm; text-align:center; color:red; }
      .warranty { left:178mm; width:30mm; text-align:center; color:red; }
    </style>
    <div style="position:absolute;inset:0;${twoCol ? 'transform:translateX(-13mm)' : ''}">
    <img class="legacy-head" src="${header}" />
    <div class="legacy-title">${esc(legacyCategoryLabel(category))}</div>
    <div class="legacy-info" style="left:29mm;top:94.6mm">Thickness</div>
    <div class="legacy-info" style="left:108mm;top:94.6mm">Height</div>
    <div class="legacy-info" style="left:142mm;top:94.6mm">Width</div>
    <div style="position:absolute;left:29mm;top:100mm;height:7mm;right:${twoCol ? '2mm' : '34mm'};background:#FFFF00"></div>
    <div class="legacy-info" style="left:29mm;top:101.3mm">${esc(legacyThickness(category))}</div>
    <div class="legacy-info" style="left:102mm;top:101.3mm;width:21mm;text-align:right">${esc(legacyDimension(height))}</div>
    <div class="legacy-info" style="left:130mm;top:101.3mm;width:5mm;text-align:center">X</div>
    <div class="legacy-info" style="left:142mm;top:101.3mm">${esc(legacyDimension(width))}</div>
    <div class="legacy-line" style="right:${twoCol ? '2mm' : '34mm'}"></div>
    <div class="legacy-info" style="left:29mm;top:113.5mm">Rate</div>
    <div class="legacy-info" style="left:56.4mm;top:113.5mm">Brand</div>
    <div class="legacy-info" style="left:127mm;top:113.5mm">Cost</div>
    <div class="legacy-info" style="left:148mm;top:113.5mm;width:30mm;text-align:center">Guarantee</div>
    ${twoCol ? '<div class="legacy-info" style="left:178mm;top:113.5mm;width:30mm;text-align:center">Warranty</div>' : ''}
    ${rowsHtml}
    </div>`)
}

async function buildQuotationHtmlOld(quote) {
  if (quote.alu) return buildAluminiumHtml(quote)

  const lh = await b64('letterhead/shiv-letterhead.png')
  const { category, height, width, rows } = quote
  const date = new Date(quote.date).toLocaleDateString('en-GB')

  const dimStr = (d) => d.soot ? `${d.inches} ${d.soot}/8"` : `${d.inches}"`
  const sizeLabel = `${dimStr(height)} X ${dimStr(width)}`
  const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN')

  const LABELS = {
    'readymade-door': 'Readymade Door', 'flush-door': 'Flush Door (Plain)',
    'block-board-12': 'WP Block Board 12mm', 'block-board-19': 'WP Block Board 19mm',
    'aluminium-door': 'Aluminium Door', 'window-2-track': '2 Track Sliding Window',
    'window-3-track': '3 Track Sliding Window',
  }

  const meta = `
    <div style="padding:6mm 8mm 3mm">
      <img src="${lh}" style="width:100%;display:block;"/>
      <div style="display:flex;justify-content:space-between;border-bottom:2px solid #000;padding-bottom:4px;margin:4mm 0 3mm">
        <span style="font-size:18px;font-weight:700;color:${GREEN}">${LABELS[category] ?? category}</span>
        <div style="text-align:right;font-size:12px;line-height:1.6">
          <div><b>No: </b>${quote.number}</div>
          <div><b>Date: </b>${date}</div>
        </div>
      </div>
      ${quote.customer?.name ? `<div style="font-size:12px;margin-bottom:4px"><b>M/s </b>${quote.customer.name}${quote.customer.mobile ? ` &nbsp; <b>Mobile: </b>${quote.customer.mobile}` : ''}</div>` : ''}
      <div style="border:1px solid #ccc;background:#f9f9f9;padding:6px 10px;font-size:13px;margin-bottom:3mm">
        <b>Size:</b> ${sizeLabel} &nbsp; <b>Area:</b> ${quote.sqft.toFixed(2)} sqft
      </div>
    </div>`

  // Brand rate card (doors / plywood)
  if (rows && rows.length) {
    const rowsHtml = rows.map(r => `<tr${r.accentColor ? ` style="background:${esc(r.accentColor)}"` : ''}>
      <td class="bold">${esc(r.brandName)}</td>
      <td class="right">${esc(r.rate)}</td>
      <td class="right bold">${inr(r.cost)}</td>
      <td class="center ${r.guaranteeYears ? 'red bold' : ''}">${r.guaranteeYears ? `${coverageLabel(r.coverage)} ${r.guaranteeYears} Years` : '-'}</td>
    </tr>`).join('')
    const seals = [...new Set(rows.filter(r => r.guaranteeYears).map(r => r.guaranteeYears))].sort((a,b)=>a-b)
    const sealImgs = await Promise.all(seals.map(async y => {
      try {
        const s = await b64(`seals/seal-${y}yr.png`)
        return `<img src="${s}" style="height:22mm;margin-right:4px"/>`
      } catch { return '' }
    }))
    return page(`${meta}
      <div style="padding:0 8mm">
        <table>
          <thead><tr style="background:${GREEN};color:#fff">
            <th style="text-align:left">Brand</th><th class="right">Rate ₹/sqft</th>
            <th class="right">Cost</th><th class="center">Gty/Wty</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${quote.notes ? `<div style="margin-top:8px;font-size:11px"><b>Note: </b>${quote.notes}</div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:14mm">
          <div>${sealImgs.join('')}</div>
          <div style="text-align:center;font-size:12px">
            <div style="font-weight:700;margin-bottom:14mm">For Shiv Hardware Store</div>
            <div style="border-top:1px solid #000;padding-top:4px">Proprietor</div>
          </div>
        </div>
      </div>`)
  }

  return page(`${meta}<div style="padding:0 8mm;color:#888">No data.</div>`)
}

export async function buildGuaranteeHtml(document, layout = 'a4') {
  const date = new Date(document.date).toLocaleDateString('en-GB')
  const guaranteedRows = (document.items ?? []).filter(item => Number(item.guaranteeYears) > 0)
  const maxYears = Math.max(0, ...guaranteedRows.map(item => Number(item.guaranteeYears) || 0))
  const category = CATEGORY_LABELS[document.category] ?? document.category
  const size = formatSize(document.height, document.width) || '—'
  const seal = maxYears
    ? await b64(`seals/seal-${maxYears}yr.png`).catch(() => '')
    : ''

  if (layout === 'card') {
    // Overlay format for PRE-PRINTED PVC guarantee cards: the card already
    // carries the shop design; we only print the variable details, matching
    // the legacy Excel "Gaurantee Card Name Print" layout positions.
    const rows = (guaranteedRows.length ? guaranteedRows : (document.items ?? [])).slice(0, 5)
    const cardDate = new Date(document.date).toLocaleDateString('en-GB').replaceAll('/', '-')
    const docThickness = cardThickness(document.category)
    const docSizeStr = cardSize(document.height, document.width)
    const totalAmount = rows.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
    const customer = document.customer ?? {}
    // Item line at 4pt (Excel-style small print), everything else at 7pt.
    // A CSS grid keeps every row's columns aligned with a fixed, EQUAL gap
    // between them; the Type (brand) column takes the remaining space (1fr).
    // Every cell is data-fit: long text shrinks/squeezes to stay on one line,
    // never truncated and never overlapping Size/Pcs/Rate.
    // Each row can carry its own thickness/size/qty (spreadsheet-style entry);
    // falls back to the document-level values when a row omits them.
    const itemRows = rows.map((item, i) => {
      const rowThickness = item.thickness || docThickness
      const rowSize = (item.height || item.width) ? cardSize(item.height, item.width) : docSizeStr
      const rowQty = item.qty ?? document.qty
      return `
        <div style="position:absolute;left:${CARD_SAFE_MM}mm;right:${CARD_SAFE_MM}mm;top:${(20.5 + i * 3.2).toFixed(1)}mm;display:grid;grid-template-columns:5.5mm 1fr 11mm 5mm 4.5mm;column-gap:1.3mm;align-items:baseline;font-size:4pt;line-height:1">
          <span data-fit style="white-space:nowrap;overflow:hidden">${fitInner(esc(rowThickness))}</span>
          <span data-fit style="white-space:nowrap;overflow:hidden">${fitInner(esc(item.brandName))}</span>
          <span data-fit style="white-space:nowrap;overflow:hidden">${fitInner(esc(rowSize))}</span>
          <span data-fit style="white-space:nowrap;overflow:hidden">${fitInner(`${esc(rowQty)} Pcs`)}</span>
          <span data-fit style="white-space:nowrap;overflow:hidden;text-align:right">${fitInner(Number(item.amount) ? esc(Math.round(Number(item.amount))) : '')}</span>
        </div>`
    }).join('')

    // The QR with "SCAN TO VERIFY" under it; the pair ends on the print-area edge
    // (CARD_SAFE_MM above the card's bottom), so the QR keeps its full 12mm.
    const qrLabelTop = CARD_H_MM - CARD_SAFE_MM - CARD_QR_LABEL_MM
    const qrTop = qrLabelTop - CARD_QR_GAP_MM - CARD_QR_MM
    const cardQr = await qrSvg(document.qrUrl, CARD_QR_MM)
    return cardPage(`
        <div style="position:relative;width:${CARD_W_MM}mm;height:${CARD_H_MM}mm;overflow:hidden;font-family:Arial,sans-serif;color:#000">
          <div style="position:absolute;left:${CARD_SAFE_MM}mm;top:4mm;right:${CARD_SAFE_MM}mm;font-size:7pt;font-weight:600;line-height:1.18">
            <div data-fit style="white-space:nowrap;overflow:hidden">${fitInner(`M/s ${esc(customer.name || '')}${customer.address ? `,${esc(customer.address)}` : ''}`)}</div>
            <div data-fit style="white-space:nowrap;overflow:hidden">${fitInner(`Mob - ${esc(customer.mobile || '')}`)}</div>
            <div data-fit style="white-space:nowrap;overflow:hidden">${fitInner(`UID - ${esc(customer.uid || 'N/A')}`)}</div>
          </div>
          <div style="position:absolute;right:${CARD_SAFE_MM}mm;top:13.9mm;font-size:7pt;font-weight:500">${cardDate}</div>
          ${itemRows}
          ${totalAmount ? `
          <div style="position:absolute;right:${CARD_SAFE_MM}mm;top:76.8mm;display:inline-block;border-top:1pt solid #000;border-bottom:1pt solid #000;padding:0.8mm 0;font-size:7pt;font-weight:600;line-height:1">${esc(Math.round(totalAmount))}</div>` : ''}
          ${cardQr ? `<div style="position:absolute;left:${CARD_SAFE_MM}mm;top:${qrTop.toFixed(2)}mm">${cardQr}</div>
          <div data-fit style="position:absolute;left:${CARD_SAFE_MM}mm;top:${qrLabelTop.toFixed(2)}mm;width:${CARD_QR_MM}mm;white-space:nowrap;overflow:hidden;text-align:center;font-size:4pt;font-weight:700;letter-spacing:0.2pt;line-height:1">${fitInner('SCAN TO VERIFY')}</div>` : ''}
        </div>
      `)
  }

  const letterhead = await b64('letterhead/shiv-letterhead.png')
  const a4Qr = await qrSvg(document.qrUrl, 30)
  const rows = guaranteedRows.length
    ? guaranteedRows.map(item => `<tr>
        <td class="bold">${esc(item.brandName)}</td>
        <td class="center red bold">${esc(item.guaranteeYears)} Years</td>
      </tr>`).join('')
    : '<tr><td colspan="2" class="center" style="color:#888">No guaranteed brands for this product</td></tr>'

  return page(`
    <div style="padding:6mm 8mm 0"><img src="${letterhead}" style="width:100%;display:block"/></div>
    <div style="padding:3mm 12mm;font-family:Arial,sans-serif;font-size:13px">
      <div style="margin:1mm 0;text-align:center;font-size:16px;font-weight:700;letter-spacing:.08em;color:${GREEN}">GUARANTEE CARD</div>
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid #000;padding-bottom:2mm;font-size:12px">
        <span><b>Ref No:</b> ${esc(document.number)}</span>
        <span><b>Date:</b> ${date}</span>
      </div>
      <div style="margin-top:2mm;line-height:1.5">
        <div><b>M/s </b>${esc(document.customer?.name || '—')}</div>
        <div style="font-size:12px"><b>UID - </b>${esc(document.customer?.uid || 'N/A')} &nbsp;&nbsp;&nbsp; <b>Mobile - </b>${esc(document.customer?.mobile || 'N/A')}</div>
      </div>
      <div style="display:flex;gap:6mm;margin:3mm 0;border:1px solid #999;background:#f8fafc;padding:2mm 4mm">
        <b>${esc(category)}</b><span>Size: <b>${esc(size)}</b></span><span>Qty: <b>${esc(document.qty)}</b></span>
      </div>
      <table>
        <thead><tr style="background:${GREEN};color:#fff"><th style="text-align:left">Brand</th><th class="center" style="width:28%">Guarantee</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="display:flex;gap:5mm;margin-top:4mm">
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700;margin-bottom:1mm">Terms &amp; Conditions:</div>
          <ol style="padding-left:5mm;font-size:10.5px;line-height:1.35">${GUARANTEE_TERMS.map(term => `<li>${term}</li>`).join('')}</ol>
        </div>
        ${seal ? `<img src="${seal}" style="width:34mm;height:34mm;object-fit:contain"/>` : ''}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:14mm">
        <div style="text-align:center;font-size:9px">
          ${a4Qr}
          ${a4Qr ? `<div style="margin-top:1mm;color:#555">Scan to verify</div>` : ''}
        </div>
        <div style="text-align:center;font-size:12px">
          <div style="font-weight:700;margin-bottom:14mm">For Shiv Hardware Store</div>
          <div style="border-top:1px solid #000;padding:1mm 6mm 0">Proprietor</div>
        </div>
      </div>
    </div>`)
}

async function buildAluminiumHtml(quote) {
  const { category, height, width, alu } = quote
  const thicknesses = alu.thicknesses ?? []
  const selected = new Set(alu.addons ?? [])
  const isDoor = category === 'aluminium-door'
  const is2Track = category === 'window-2-track'
  const hasChaukhat = selected.has('Chaukhat')
  const hasAccessories = selected.has('Accessories')
  const hasSsNet = selected.has('SS Net')
  const hasDecorFilm = selected.has('Decor Film')
  const hasBrownCoated = selected.has('Brown Coated')
  const hasWindowSsNet = is2Track && hasSsNet
  const hasAnyWindowAddon = hasWindowSsNet || hasBrownCoated
  const aluExcelInches = dim => Number(dim?.inches || 0) + (Number(dim?.soot || 0) > 0 ? 1 : 0)
  const hIn = aluExcelInches(height)
  const wIn = aluExcelInches(width)
  const area = Math.round((hIn * wIn / 144) * 100) / 100
  const chaukhatRft = isDoor
    ? Math.max(Math.round(((hIn * 2 + wIn) / 12) * 100) / 100, 14.5)
    : Math.round(((hIn * 2 + wIn) / 12) * 100) / 100
  const dimStr = d => d.soot ? `${d.inches} ${d.soot}/8 ''` : `${d.inches} ''`
  const productTitle = isDoor
    ? `Bathroom Aluminium Door${hasChaukhat ? '<br>With Chaukhat' : ''}`
    : is2Track
      ? '2 Track Aluminium Sliding Window'
      : '3 Track Aluminium Sliding Window<br>With Half SS Net'
  const headerImage = await b64(isDoor ? 'aluminium/header-door.jpeg' : 'aluminium/header-window.jpg')
  const productImage = await b64(
    isDoor ? 'aluminium/door.png' : is2Track ? 'aluminium/window-2-track.jpeg' : 'aluminium/window-3-track.jpeg',
  )

  const pairCells = (rate, amount, rateVisible = true, amountClass = '') =>
    `<td class="${rateVisible ? 'shade right' : ''}">${rateVisible ? `@${esc(rate)}` : ''}</td><td class="right ${amountClass}">${esc(amount)}</td>`
  const row = (label, cells, labelClass = 'shade right') =>
    `<tr><td class="${labelClass}">${label}</td>${cells}</tr>`
  const addonHeader = '<tr><td colspan="7">Add-ons</td></tr>'

  let rows
  if (isDoor) {
    rows = row('Door', thicknesses.map(t => pairCells(t.doorRate, t.doorCost)).join(''))
    if (hasChaukhat) rows += row('Chaukhat', thicknesses.map(t => pairCells(t.chaukhatRate, t.chaukhatCost)).join(''))
    if (hasAccessories) rows += row('Accessories', thicknesses.map(t => pairCells('', t.accessories, false)).join(''))
    rows += row('Total', thicknesses.map(t => pairCells('', t.total, false, 'bold')).join(''))
    if (hasDecorFilm || hasBrownCoated) rows += addonHeader
    if (hasDecorFilm) rows += row('Décor Film', thicknesses.map(t => pairCells(t.decorFilmRate, t.decorFilm)).join(''))
    if (hasBrownCoated) rows += row('Brown Coated', thicknesses.map(t => pairCells(t.brownCoatedRate, t.brownCoated)).join(''))
  } else {
    rows = row('4 MM Clear &amp; Texture Glass', thicknesses.map(t => pairCells(t.doorRate, t.doorCost)).join(''))
    rows += row('4 MM Reflective Glass', thicknesses.map(t => {
      const rate = t.reflectiveRate ?? Number(t.doorRate || 0) + 20
      const amount = t.reflectiveCost ?? Math.round(area * rate)
      return pairCells(rate, amount)
    }).join(''))
    if (hasAnyWindowAddon) rows += addonHeader
    if (hasWindowSsNet) rows += row('SS Net', thicknesses.map(t => pairCells(50, t.accessories)).join(''))
    if (hasBrownCoated) rows += row('Brown Coated', thicknesses.map(t => pairCells(40, t.brownCoated)).join(''))
  }

  const diagramKind = isDoor ? 'door' : is2Track ? 'window2' : 'window3'
  const excelDiagram = {
    door: { groupW: 219, groupH: 318, imageX: 16, imageY: 12, imageW: 203, imageH: 306, hLineX: 15, hLineY: 0, hLineW: 202, vLineX: 0, vLineY: 13, vLineH: 305 },
    window2: { groupW: 237, groupH: 250, imageX: 16, imageY: 16, imageW: 221, imageH: 234, hLineX: 14, hLineY: 0, hLineW: 223, vLineX: 0, vLineY: 19, vLineH: 230 },
    window3: { groupW: 238, groupH: 262, imageX: 14, imageY: 15, imageW: 224, imageH: 248, hLineX: 15, hLineY: 0, hLineW: 223, vLineX: 0, vLineY: 16, vLineH: 243 },
  }
  const d = excelDiagram[diagramKind]
  const groupX = 42
  const groupY = 38
  const diagramW = groupX + d.groupW + 6
  const diagramH = groupY + d.groupH + 2
  const marker = diagramKind
  const diagram = `
    <div class="diagram" style="width:${diagramW}px;height:${diagramH}px">
      <img src="${productImage}" style="left:${groupX + d.imageX}px;top:${groupY + d.imageY}px;width:${d.imageW}px;height:${d.imageH}px">
      <svg width="${diagramW}" height="${diagramH}">
        <defs>
          <marker id="arrow-end-${marker}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#000"/></marker>
          <marker id="arrow-start-${marker}" markerWidth="7" markerHeight="7" refX="1" refY="3.5" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 Z" fill="#000"/></marker>
        </defs>
        <text x="${groupX + d.hLineX + d.hLineW / 2}" y="20" text-anchor="middle">${dimStr(width)}</text>
        <line x1="${groupX + d.hLineX}" y1="${groupY + d.hLineY}" x2="${groupX + d.hLineX + d.hLineW}" y2="${groupY + d.hLineY}" marker-start="url(#arrow-start-${marker})" marker-end="url(#arrow-end-${marker})"/>
        <text x="12" y="${groupY + d.vLineY + d.vLineH / 2}" text-anchor="middle">${dimStr(height)}</text>
        <line x1="${groupX + d.vLineX}" y1="${groupY + d.vLineY}" x2="${groupX + d.vLineX}" y2="${groupY + d.vLineY + d.vLineH}" marker-start="url(#arrow-start-${marker})" marker-end="url(#arrow-end-${marker})"/>
      </svg>
    </div>`

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  @page { size:A4 portrait; margin:0; }
  body { color:#000; background:#fff; }
  .page { width:210mm; min-height:297mm; background:#fff; }
  .sheet { width:160mm; margin:0 auto; padding-top:46mm; font-family:"Times New Roman",Times,serif; color:#000; }
  .header { display:flex; align-items:center; justify-content:space-between; gap:6mm; margin-bottom:1.5mm; }
  .header img { display:block; width:83.4mm; height:45mm; }
  .title { display:flex; align-items:center; width:64mm; min-height:11.5mm; border:2px solid #000; background:#d9d9d9; padding:4px 8px; font-size:14pt; line-height:1.05; }
  .content { font-size:14.5px; line-height:1.25; }
  table { width:100%; border-collapse:collapse; }
  .info { margin-bottom:2mm; border:2px solid #000; }
  .info td { border:2px solid #000; padding:2px 8px; }
  .info .label { width:22%; background:#d9d9d9; text-align:right; font-weight:600; }
  .compare { table-layout:fixed; border:2px solid #000; font-size:14.5px; }
  .compare th { border:1px solid #000; background:#d9d9d9; padding:4px 6px; font-weight:600; text-align:center; }
  .compare td { border:1px solid #000; padding:2px 6px; }
  .shade { background:#d9d9d9; }
  .right { text-align:right; }
  .center { text-align:center; }
  .bold { font-weight:700; }
  .diagram-wrap { display:flex; justify-content:center; margin-top:5mm; }
  .diagram { position:relative; }
  .diagram img { position:absolute; object-fit:fill; }
  .diagram svg { position:absolute; inset:0; overflow:visible; }
  .diagram text { font:17px "Times New Roman",Times,serif; }
  .diagram line { stroke:#000; stroke-width:1.6; }
</style></head><body><div class="page"><div class="sheet">
  <div class="header"><img src="${headerImage}"><div class="title"><div>${productTitle}</div></div></div>
  <div class="content">
    <table class="info"><tbody>
      <tr><td class="label">Size -</td><td class="center">${dimStr(height)}&nbsp; X &nbsp;${dimStr(width)}</td></tr>
      <tr><td class="label">Area -</td><td class="center">${area} Sqft</td></tr>
      ${isDoor && hasChaukhat ? `<tr><td class="label">Chaukhat -</td><td class="center">${chaukhatRft} Rft</td></tr>` : ''}
    </tbody></table>
    <table class="compare">
      <colgroup><col style="width:22%">${thicknesses.map(() => '<col style="width:9%"><col style="width:14.33%">').join('')}</colgroup>
      <thead><tr><th>Thickness -</th>${thicknesses.map(t => `<th colspan="2">${esc(t.name)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="diagram-wrap">${diagram}</div>
  </div>
</div></div></body></html>`
}

// ── Bill HTML ─────────────────────────────────────────────────────────────────
// Mirrors BillPrint.tsx exactly — same 148×210mm notepad layout, same columns.
export function buildBillHtml(bill) {
  // A receipt and a payment are money, not goods, and print as their own
  // document — one page, no item table, no running total.
  if (bill.kind === 'receipt' || bill.kind === 'payment') return buildReceiptHtml(bill)
  // A fare or round-off is not one of the goods: it is a charge on the whole
  // bill and prints just above the total. Mirrors billLines()/billCharges()
  // in src/lib/types.ts. Half-typed rows are not lines of the bill.
  const AMOUNT_ONLY_NAMES = /^(fare|cartage|freight|labour|labor|transport)$/i
  const isRoundup = i => !!(i.isRoundup || i.isDiscount)
  const isAmountOnly = i =>
    !!i.amountOnly || AMOUNT_ONLY_NAMES.test(String(i.description ?? '').trim())
  const isCharge = i => isRoundup(i) || isAmountOnly(i)

  const allLines = Array.isArray(bill.items) ? bill.items : []
  const items = allLines.filter(
    i => (String(i.description ?? '').trim() || Number(i.amount)) && !isCharge(i),
  )
  const charges = allLines
    .filter(i => isCharge(i) && Number(i.amount))
    .sort((a, b) => Number(isRoundup(a)) - Number(isRoundup(b)))

  const PAGE_ITEMS = 14
  const pages = []
  for (let i = 0; i < items.length; i += PAGE_ITEMS) pages.push(items.slice(i, i + PAGE_ITEMS))
  if (pages.length === 0) pages.push([])

  const BILL_LABEL = {
    'block-board-19': '19mm Block Board',
    'block-board-12': '12mm Block Board',
    'plywood-6':      '6mm Plywood',
    'flush-door':     'Flush Door',
    'readymade-door': 'Readymade Door',
    'hinge':          'Hinges',
    'screw':          'Screw',
    'aldrop':         'Aldrop',
    'handle':         'Handle',
    'tb':             'Tower Bolt',
    'fevicol':        'Fevicol',
    'mica':           'Mica',
    'tape':           'Abro Tape',
  }

  function formatDate(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
  }

  function toProperCase(s) {
    return String(s ?? '').replace(/\b\w/g, c => c.toUpperCase())
  }

  // Mirrors formatItemDescription in src/lib/billHtml.ts.
  function formatItemDescription(s) {
    return toProperCase(s).replace(/(\d+(?:\.\d+)?)\s*[x\u00d7]\s*(\d+(?:\.\d+)?)/gi, '$1 X $2')
  }


  function fmt(n) {
    return Number(n || 0).toLocaleString('en-IN')
  }

  const pagesHtml = pages.map((pageItems, pageIdx) => {
    const isLast = pageIdx === pages.length - 1
    const prevTotal = items.slice(0, pageIdx * PAGE_ITEMS).reduce((s, i) => s + (Number(i.amount) || 0), 0)
    const pageSubtotal = pageItems.reduce((s, i) => s + (Number(i.amount) || 0), 0)
    const runningTotal = prevTotal + pageSubtotal

    const customerBlock = pageIdx === 0 && bill.customerName ? `
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:10.5pt">M/s &nbsp;${esc(toProperCase(bill.customerName))}</div>
        ${bill.customerPhone ? `<div style="font-weight:400;font-size:9pt;color:#555;margin-top:0.5mm">${esc(bill.customerPhone)}</div>` : ''}
        ${bill.customerUid ? `<div style="font-weight:400;font-size:8.5pt;color:#777;margin-top:0.5mm">UID - ${esc(bill.customerUid)}</div>` : ''}
      </div>` : '<div style="flex:1"></div>'

    const carryForward = prevTotal > 0 ? `
      <div style="display:flex;justify-content:space-between;font-size:9.5pt;font-style:italic;color:#555;margin-bottom:2mm;border-bottom:0.5px solid #aaa;padding-bottom:1mm">
        <span>B/f (p.${pageIdx})</span><span style="font-weight:700">${fmt(prevTotal)}</span>
      </div>` : ''

    const CELL = 'vertical-align:middle;padding-top:0.8mm;padding-bottom:0.8mm'
    const itemAttrs = item => {
      const attrs = []
      if (item.brandName) attrs.push(shortenBrand(item.brandName))
      const size = item.sizeIn ? item.sizeIn : (item.heightIn && item.widthIn ? `${item.heightIn}×${item.widthIn}` : '')
      if (size) attrs.push(size)
      if (item.fieldValues) for (const v of Object.values(item.fieldValues)) if (v) attrs.push(String(v))
      return attrs
    }
    const attrCell = item => {
      const attrs = itemAttrs(item)
      if (attrs.length === 0) return ''
      const cells = attrs
        .map(a => `<span style="min-width:0;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a)}</span>`)
        .join('')
      return `<div style="display:flex;align-items:center;gap:3mm">${cells}</div>`
    }
    const rows = pageItems.map(item => {
      const isCatalog = !!item.category
      const productCols = isCatalog ? `
        <td style="${CELL};line-height:1.3">${esc(BILL_LABEL[item.category] ?? item.category)}</td>
        <td style="${CELL};padding-left:2mm">${attrCell(item)}</td>
      ` : isRoundup(item)
        ? `<td colspan="2" style="${CELL};line-height:1.3"></td>`
        : `<td colspan="2" style="${CELL};line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${
            String(item.description ?? '').trim()
              ? esc(formatItemDescription(item.description))
              : '<span style="color:#ccc">—</span>'
          }</td>`
      return `<tr>
        <td style="${CELL};color:#888;line-height:1.3">✕</td>
        ${productCols}
        <td style="${CELL};padding-left:4mm;color:#555;white-space:nowrap">${
          isRoundup(item) || isAmountOnly(item) || !Number(item.qty)
            ? ''
            : `${esc(item.qty)} ${esc(item.unit)}`
        }</td>
        <td style="${CELL};padding-left:4mm;text-align:right;font-weight:600;white-space:nowrap">${item.amount ? fmt(item.amount) : ''}</td>
      </tr>`
    }).join('')

    const blankRows = Array.from({ length: Math.max(0, 6 - pageItems.length) })
      .map(() => `<tr><td style="padding-top:4mm"></td><td></td><td></td><td></td><td></td></tr>`).join('')

    const bottomLeft = isLast
      ? `<div style="font-size:9pt;color:#444">${esc(formatDate(bill.date))}</div>`
      : `<span style="font-style:italic;font-weight:700;font-size:9.5pt;color:#444">P.T.O</span>`

    // Money taken against the bill, and what is still owed after it. A receipt
    // or a payment is the money itself, so there is nothing to take off it.
    const isMoneyVoucher = bill.kind === 'receipt' || bill.kind === 'payment'
    const received = isMoneyVoucher
      ? 0
      : Math.min(Math.max(Number(bill.paidAmount ?? (bill.paid ? bill.total : 0)) || 0, 0), Number(bill.total) || 0)
    const balance = (Number(bill.total) || 0) - received
    const receivedLabel = `${bill.kind === 'purchase' ? 'Paid' : 'Received'}${
      bill.paidDate && bill.paidDate !== bill.date ? ` ${formatDate(bill.paidDate)}` : ''
    }`

    // A fare or any other charge splits the foot into Sub Total, the charges,
    // then Total. Mirrors src/lib/billHtml.ts.
    const hasCharges = isLast && charges.length > 0
    const bottomRight = isLast ? `
      <div style="text-align:right">
        ${prevTotal > 0 && !hasCharges ? `<div style="font-size:9.5pt;color:#555;margin-bottom:0.5mm">${fmt(runningTotal)}</div>` : ''}
        <div style="font-size:12pt;font-weight:900;border-top:1.5px solid #111;${
          received > 0 ? '' : 'border-bottom:3px double #111;'
        }padding-top:1mm;padding-bottom:1mm;min-width:24mm">${
          hasCharges ? '<span style="font-size:9.5pt;font-weight:700;color:#555;margin-right:4mm">Total</span>' : ''
        }${fmt(bill.total)}</div>
        ${received > 0 ? `
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:4mm;font-size:9.5pt;color:#555;padding-top:1mm">
            <span>Less ${esc(receivedLabel)}</span><span style="font-weight:600">${fmt(received)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:4mm;font-size:11pt;font-weight:900;border-top:1.5px solid #111;border-bottom:3px double #111;padding-top:1mm;padding-bottom:1mm;margin-top:1mm">
            <span>Balance</span><span>${fmt(balance)}</span>
          </div>` : ''}
      </div>` : `<div style="font-size:10pt;font-weight:700">${fmt(runningTotal)}</div>`

    // Fare and round-off read just above the total rule: a charge on the bill,
    // next to the figure it changes, not buried among the goods.
    const subTotal = hasCharges ? `
          <div style="display:flex;justify-content:flex-end;align-items:baseline;gap:4mm;font-size:10pt;margin-bottom:1.5mm;border-top:0.5px solid #aaa;padding-top:1mm">
            <span style="color:#555">Sub Total</span>
            <span style="font-weight:700;min-width:24mm;text-align:right">${fmt(runningTotal)}</span>
          </div>` : ''
    const chargeLines = isLast
      ? subTotal + charges.map(c => `
          <div style="display:flex;justify-content:flex-end;align-items:baseline;gap:4mm;font-size:10pt;margin-bottom:1.5mm">
            <span style="color:#555">${esc(formatItemDescription(c.description))}</span>
            <span style="font-weight:600;min-width:24mm;text-align:right${Number(c.amount) < 0 ? ';color:#b00' : ''}">${fmt(Number(c.amount))}</span>
          </div>`).join('')
      : ''

    const breakStyle = isLast ? '' : 'page-break-after:always;'

    return `
    <div style="position:relative;width:148mm;min-height:210mm;margin:0 auto;padding:8mm 7mm 10mm;box-sizing:border-box;background-color:#fff;background-image:repeating-linear-gradient(transparent,transparent 7.8mm,#e8eef5 7.8mm,#e8eef5 8mm);background-position-y:22mm;${breakStyle}">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:7.5pt;letter-spacing:5px;color:#888;text-transform:uppercase;margin-bottom:2mm;padding-bottom:1mm;border-bottom:0.5px solid #bbb">
        <span>${bill.kind === 'return' ? 'Goods Return' : bill.kind === 'refund' ? 'Refund' : bill.kind === 'grn' ? 'Goods Received' : bill.kind === 'quotation' ? 'Quotation' : 'Estimate'}</span>
        <span>${esc(bill.number)}${pages.length > 1 ? ` (${pageIdx + 1})` : ''}</span>
      </div>
      <div style="margin-bottom:3mm">
        ${customerBlock}
      </div>
      ${carryForward}
      <table style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:10pt;border:none">
        <colgroup>
          <!-- The widths the bill has always been drawn at. They were written as
               millimetres summing to 114 of the table's 134, and the browser shared
               the missing 20mm out in proportion — so these percentages are those
               same drawn widths, stated outright rather than left to arithmetic. -->
          <col style="width:5.3%"><col style="width:29.8%"><col style="width:35.1%">
          <col style="width:14%"><col style="width:15.8%">
        </colgroup>
        <tbody>${rows}${blankRows}</tbody>
      </table>
      <div style="position:absolute;bottom:10mm;left:7mm;right:7mm">
        ${chargeLines}
        <div style="border-top:1.5px solid #333;padding-top:2mm;display:flex;justify-content:space-between;align-items:flex-end">
          ${bottomLeft}
          ${bottomRight}
        </div>
      </div>
    </div>`
  }).join('')

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page { size: 148mm 210mm; margin: 0; }
    html, body { margin: 0; padding: 0; width: 148mm; background: white; font-family: Arial, sans-serif; color: #111; }
    table { border-collapse: collapse; }
    td, th { border: none; padding: 0; }
  </style>
</head>
<body>${pagesHtml}</body>
</html>`
}

/**
 * A receipt is not a bill — identical to buildReceiptHtml in src/lib/billHtml.ts.
 *
 * It has no goods on it and nothing to add up, so it prints as an
 * acknowledgement of money rather than through the estimate's item table,
 * which produced a bill with one odd line and a total that read as a demand
 * for money already in the drawer.
 */
const RCT_ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const RCT_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function rctTwo(n) {
  if (n < 20) return RCT_ONES[n]
  return `${RCT_TENS[Math.floor(n / 10)]}${n % 10 ? ` ${RCT_ONES[n % 10]}` : ''}`
}

/** Indian grouping: crore, lakh, thousand, hundred — not millions. */
export function rupeesInWords(amount) {
  const n = Math.floor(Math.abs(Number(amount) || 0))
  if (n === 0) return 'Zero Rupees Only'
  const parts = []
  const crore = Math.floor(n / 10000000)
  const lakh = Math.floor((n % 10000000) / 100000)
  const thousand = Math.floor((n % 100000) / 1000)
  const hundred = Math.floor((n % 1000) / 100)
  const rest = n % 100
  if (crore) parts.push(`${rctTwo(crore)} Crore`)
  if (lakh) parts.push(`${rctTwo(lakh)} Lakh`)
  if (thousand) parts.push(`${rctTwo(thousand)} Thousand`)
  if (hundred) parts.push(`${RCT_ONES[hundred]} Hundred`)
  if (rest) parts.push(rctTwo(rest))
  return `${parts.join(' ')} Rupees Only`
}

export function buildReceiptHtml(bill) {
  const esc = v => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const fmt = n => Number(n || 0).toLocaleString('en-IN')
  const proper = s => String(s ?? '').replace(/\b\w/g, c => c.toUpperCase())
  const when = iso => {
    if (!iso) return ''
    const d = new Date(iso)
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  }

  const paying = bill.kind === 'payment'
  const discount = Math.max(0, Number(bill.discount) || 0)
  const settled = Number(bill.total) || 0
  const money = Math.max(0, settled - discount)
  const mode = bill.paymentMode === 'online' || bill.paymentMode === 'upi' ? 'Bank' : 'Cash'

  const row = (label, value) => `
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6mm;padding:1.4mm 0;border-bottom:0.5px dotted #bbb">
      <span style="color:#555;font-size:9.5pt">${esc(label)}</span>
      <span style="font-weight:700;font-size:10.5pt">${value}</span>
    </div>`

  const body = `<div style="position:relative;width:148mm;min-height:210mm;margin:0 auto;padding:10mm 9mm;box-sizing:border-box;background:#fff">
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:7.5pt;letter-spacing:5px;color:#888;text-transform:uppercase;padding-bottom:1.5mm;border-bottom:0.5px solid #bbb">
      <span>${paying ? 'Payment Voucher' : 'Receipt'}</span>
      <span>${esc(bill.number)}</span>
    </div>

    <div style="margin-top:8mm;font-size:10pt;line-height:1.9">
      <span style="color:#555">${paying ? 'Paid to' : 'Received with thanks from'}</span>
      <div style="font-weight:700;font-size:12.5pt;margin-top:1mm">M/s&nbsp;${esc(proper(bill.customerName || '—'))}</div>
      ${bill.customerPhone ? `<div style="font-size:9pt;color:#555">${esc(bill.customerPhone)}</div>` : ''}
    </div>

    <div style="margin-top:6mm;padding:4mm 5mm;border:1px solid #111;border-radius:1mm">
      <div style="font-size:9pt;color:#555;letter-spacing:1px;text-transform:uppercase">the sum of</div>
      <div style="font-size:16pt;font-weight:900;margin-top:1.5mm">₹${fmt(money)}</div>
      <div style="font-size:9.5pt;font-style:italic;color:#333;margin-top:1.5mm;line-height:1.5">
        ${esc(rupeesInWords(money))}
      </div>
    </div>

    <div style="margin-top:6mm">
      ${row(`By ${mode}`, `₹${fmt(money)}`)}
      ${discount > 0 ? row(paying ? 'Discount received' : 'Discount allowed', `₹${fmt(discount)}`) : ''}
      ${discount > 0 ? row('Settled against account', `₹${fmt(settled)}`) : ''}
      ${bill.ref ? row('Against', bill.ref) : ''}
      ${row('Date', when(bill.paidDate || bill.date))}
    </div>

    ${bill.notes ? `<div style="margin-top:5mm;font-size:9.5pt;color:#444;line-height:1.6">${esc(bill.notes)}</div>` : ''}

    <div style="position:absolute;bottom:14mm;right:9mm;text-align:center">
      <div style="width:46mm;border-top:0.5px solid #111;padding-top:1.5mm;font-size:9pt;color:#555">
        For Shiv Hardware Store
      </div>
    </div>
  </div>`

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page { size: 148mm 210mm; margin: 0; }
    html, body { margin: 0; padding: 0; width: 148mm; background: white; font-family: Arial, sans-serif; color: #111; }
  </style>
</head>
<body>${body}</body>
</html>`
}
