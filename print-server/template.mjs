// Pure HTML template — no React/Tailwind, no external deps.
// Mirrors the AluminiumPrint and QuotationPrint layouts exactly.

import { readFile } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ASSETS = resolve(__dir, '../public/assets')

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

function cardPage(body) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: 54mm 86mm; margin: 0; }
  html, body { width: 54mm; height: 86mm; margin: 0; background: #fff; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; overflow: hidden; }
</style>
</head><body>${body}</body></html>`
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
    // between them; the Type (brand) column takes the remaining space (1fr)
    // and truncates with an ellipsis instead of overlapping Size/Pcs/Rate.
    // Each row can carry its own thickness/size/qty (spreadsheet-style entry);
    // falls back to the document-level values when a row omits them.
    const itemRows = rows.map((item, i) => {
      const rowThickness = item.thickness || docThickness
      const rowSize = (item.height || item.width) ? cardSize(item.height, item.width) : docSizeStr
      const rowQty = item.qty ?? document.qty
      return `
        <div style="position:absolute;left:3mm;right:3mm;top:${(20.5 + i * 3.2).toFixed(1)}mm;display:grid;grid-template-columns:5.5mm 1fr 11mm 5mm 4.5mm;column-gap:1.3mm;align-items:baseline;font-size:4pt;line-height:1">
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(rowThickness)}</span>
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.brandName)}</span>
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(rowSize)}</span>
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(rowQty)} Pcs</span>
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right">${Number(item.amount) ? esc(Math.round(Number(item.amount))) : ''}</span>
        </div>`
    }).join('')

    return cardPage(`
        <div style="position:relative;width:54mm;height:86mm;overflow:hidden;font-family:Arial,sans-serif;color:#000">
          <div style="position:absolute;left:3mm;top:4mm;right:3mm;font-size:7pt;font-weight:600;line-height:1.18">
            <div style="white-space:nowrap;overflow:hidden">M/s ${esc(customer.name || '')}${customer.address ? `,${esc(customer.address)}` : ''}</div>
            <div>Mob - ${esc(customer.mobile || '')}</div>
            <div>UID - ${esc(customer.uid || 'N/A')}</div>
          </div>
          <div style="position:absolute;right:3mm;top:13.9mm;font-size:7pt;font-weight:500">${cardDate}</div>
          ${itemRows}
          ${totalAmount ? `
          <div style="position:absolute;right:3mm;top:76.8mm;display:inline-block;border-top:1pt solid #000;border-bottom:1pt solid #000;padding:0.8mm 0;font-size:7pt;font-weight:600;line-height:1">${esc(Math.round(totalAmount))}</div>` : ''}
        </div>
      `)
  }

  const letterhead = await b64('letterhead/shiv-letterhead.png')
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
      <div style="display:flex;justify-content:flex-end;margin-top:14mm">
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
  const items = Array.isArray(bill.items) ? bill.items : []
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

    const CELL = 'vertical-align:middle;padding-top:1.5mm;padding-bottom:1.5mm'
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
        .map(a => `<span style="flex:1;min-width:0;text-align:center;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a)}</span>`)
        .join('')
      return `<div style="display:flex;align-items:center;gap:1.5mm">${cells}</div>`
    }
    const rows = pageItems.map(item => {
      const isCatalog = !!item.category
      const productCols = isCatalog ? `
        <td style="${CELL};line-height:1.3">${esc(BILL_LABEL[item.category] ?? item.category)}</td>
        <td style="${CELL};padding-left:3mm">${attrCell(item)}</td>
      ` : `<td colspan="2" style="${CELL};line-height:1.3">${esc(item.description) || '<span style="color:#ccc">—</span>'}</td>`
      return `<tr>
        <td style="${CELL};color:#888;line-height:1.3">✕</td>
        ${productCols}
        <td style="${CELL};padding-left:4mm;color:#555;white-space:nowrap">${esc(item.qty)} ${esc(item.unit)}</td>
        <td style="${CELL};padding-left:4mm;text-align:right;font-weight:600;white-space:nowrap">${item.amount ? fmt(item.amount) : ''}</td>
      </tr>`
    }).join('')

    const blankRows = Array.from({ length: Math.max(0, 6 - pageItems.length) })
      .map(() => `<tr><td style="padding-top:4mm"></td><td></td><td></td><td></td><td></td></tr>`).join('')

    const bottomLeft = isLast
      ? `<div style="font-size:9pt;color:#444">${esc(formatDate(bill.date))}</div>`
      : `<span style="font-style:italic;font-weight:700;font-size:9.5pt;color:#444">P.T.O</span>`

    const bottomRight = isLast ? `
      <div style="text-align:right">
        ${prevTotal > 0 ? `<div style="font-size:9.5pt;color:#555;margin-bottom:0.5mm">${fmt(runningTotal)}</div>` : ''}
        <div style="font-size:12pt;font-weight:900;border-top:1.5px solid #111;border-bottom:3px double #111;padding-top:1mm;padding-bottom:1mm;min-width:24mm">${fmt(bill.total)}</div>
      </div>` : `<div style="font-size:10pt;font-weight:700">${fmt(runningTotal)}</div>`

    const breakStyle = isLast ? '' : 'page-break-after:always;'

    return `
    <div style="position:relative;width:148mm;min-height:210mm;margin:0 auto;padding:8mm 7mm 10mm;box-sizing:border-box;background-color:#fff;background-image:repeating-linear-gradient(transparent,transparent 7.8mm,#e8eef5 7.8mm,#e8eef5 8mm);background-position-y:22mm;${breakStyle}">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:7.5pt;letter-spacing:5px;color:#888;text-transform:uppercase;margin-bottom:2mm;padding-bottom:1mm;border-bottom:0.5px solid #bbb">
        <span>Estimate</span>
        <span>${esc(bill.number)}${pages.length > 1 ? ` (${pageIdx + 1})` : ''}</span>
      </div>
      <div style="margin-bottom:3mm">
        ${customerBlock}
      </div>
      ${carryForward}
      <table style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:10pt;border:none">
        <colgroup>
          <col style="width:6mm"><col style="width:34mm"><col style="width:40mm">
          <col style="width:16mm"><col style="width:18mm">
        </colgroup>
        <tbody>${rows}${blankRows}</tbody>
      </table>
      <div style="position:absolute;bottom:10mm;left:7mm;right:7mm;border-top:1.5px solid #333;padding-top:2mm;display:flex;justify-content:space-between;align-items:flex-end">
        ${bottomLeft}
        ${bottomRight}
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
