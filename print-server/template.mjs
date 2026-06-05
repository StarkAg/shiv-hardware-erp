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

const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

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
const legacyCategoryLabel = category => ({
  'readymade-door': 'Readymade Door',
  'flush-door': 'Flush Door ( Plain Door )',
  'plywood-6': 'Water Proof Plywood',
  'block-board-12': 'Water Proof Block Board',
  'block-board-19': 'Water Proof Block Board',
})[category] ?? CATEGORY_LABELS[category] ?? category

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
  @page { size: 86mm 54mm; margin: 0; }
  html, body { width: 86mm; height: 54mm; margin: 0; background: #fff; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; overflow: hidden; }
</style>
</head><body>${body}</body></html>`
}

export async function buildQuotationHtml(quote) {
  if (quote.alu) return buildAluminiumHtml(quote)

  const header = await b64('letterhead/legacy-quotation-header.png')
  const { category, height, width, qty, rows } = quote
  const quantity = qty ?? quote.qty ?? 1
  const rowsHtml = (rows ?? []).map((r, index) => `
    <div class="legacy-row" style="top:${126.75 + index * 6.39}mm">
      <span class="rate">${esc(r.rate)}</span>
      <span class="brand">${esc(r.brandName)}</span>
      <span class="cost">${esc(Math.round(Number(r.cost) || 0))}</span>
      <span class="guarantee">${Number(r.guaranteeYears) ? `${esc(r.guaranteeYears)} Years` : ''}</span>
    </div>`).join('')

  return page(`
    <style>
      .page { position: relative; font-family: Arial, Helvetica, sans-serif; }
      .legacy-head { position:absolute; left:27.94mm; top:22.47mm; width:88.06mm; height:53.53mm; display:block; }
      .legacy-title { position:absolute; left:29mm; top:81.3mm; font-size:15pt; color:#00b050; }
      .legacy-info { position:absolute; font-size:15pt; line-height:1.1; }
      .legacy-line { position:absolute; left:29mm; top:107mm; width:153mm; border-top:1.5px solid #000; }
      .legacy-row { position:absolute; left:0; right:0; height:6.45mm; font-size:15pt; line-height:1.05; }
      .legacy-row span { position:absolute; white-space:nowrap; }
      .rate { left:31mm; }
      .brand { left:56.4mm; }
      .cost { left:127mm; }
      .guarantee { left:157.65mm; color:red; }
    </style>
    <img class="legacy-head" src="${header}" />
    <div class="legacy-title">${esc(legacyCategoryLabel(category))}</div>
    <div class="legacy-info" style="left:29mm;top:94.6mm">Thickness</div>
    <div class="legacy-info" style="left:100mm;top:94.6mm">Height</div>
    <div class="legacy-info" style="left:127mm;top:94.6mm">Width</div>
    <div class="legacy-info" style="left:155mm;top:94.6mm">Quantity</div>
    <div class="legacy-info" style="left:29mm;top:101.3mm">${esc(legacyThickness(category))}</div>
    <div class="legacy-info" style="left:94mm;top:101.3mm;width:21mm;text-align:right">${esc(legacyDimension(height))}</div>
    <div class="legacy-info" style="left:120mm;top:101.3mm;width:5mm;text-align:center">X</div>
    <div class="legacy-info" style="left:127mm;top:101.3mm">${esc(legacyDimension(width))}</div>
    <div class="legacy-info" style="left:155.5mm;top:101.3mm">${esc(quantity)}</div>
    <div class="legacy-line"></div>
    <div class="legacy-info" style="left:29mm;top:113.5mm">Rate</div>
    <div class="legacy-info" style="left:56.4mm;top:113.5mm">Brand</div>
    <div class="legacy-info" style="left:127mm;top:113.5mm">Cost</div>
    <div class="legacy-info" style="left:156mm;top:113.5mm">Guarantee</div>
    ${rowsHtml}`)
}

async function buildQuotationHtmlOld(quote) {
  if (quote.alu) return buildAluminiumHtml(quote)

  const lh = await b64('letterhead/shiv-letterhead.png')
  const { category, height, width, qty, rows } = quote
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
        <b>Size:</b> ${sizeLabel} &nbsp; <b>Area:</b> ${quote.sqft.toFixed(2)} sqft &nbsp; <b>Qty:</b> ${qty}
      </div>
    </div>`

  // Brand rate card (doors / plywood)
  if (rows && rows.length) {
    const rowsHtml = rows.map(r => `<tr>
      <td class="bold">${r.brandName}</td>
      <td class="right">${r.rate}</td>
      <td class="right bold">${inr(r.cost)}</td>
      <td class="center ${r.guaranteeYears ? 'red bold' : ''}">${r.guaranteeYears ? `${r.guaranteeYears} Years` : '—'}</td>
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
            <th class="right">Cost</th><th class="center">Guarantee</th>
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
    const logo = await b64('letterhead/shiv-logo.png')
    const primary = guaranteedRows[0]
    return cardPage(`
        <div style="position:relative;width:86mm;height:54mm;overflow:hidden;border:1.5px solid #000;border-radius:3mm;padding:4mm 5mm;font-family:Arial,sans-serif">
          <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #000;padding-bottom:2mm">
            <div style="display:flex;align-items:center;gap:2mm">
              <img src="${logo}" style="width:10mm;height:10mm;object-fit:contain"/>
              <div>
                <div style="font-size:12px;font-weight:700;line-height:1">Shiv Hardware Store</div>
                <div style="font-size:7px;font-weight:600;line-height:1.2">Shivaji Road, Near Gandhi Highschool, Ramgarh Cantt - 829122</div>
              </div>
            </div>
            ${seal ? `<img src="${seal}" style="width:14mm;height:14mm;object-fit:contain"/>` : ''}
          </div>
          <div style="margin-top:2mm;text-align:center;font-size:12px;font-weight:700;letter-spacing:.08em;color:${GREEN}">GUARANTEE CARD</div>
          <div style="margin-top:2mm;display:grid;grid-template-columns:1fr 1fr;gap:1mm 3mm;font-size:8px;line-height:1.2">
            <div><b>Ref:</b> ${esc(document.number)}</div>
            <div><b>Date:</b> ${date}</div>
            <div style="grid-column:span 2"><b>M/s:</b> ${esc(document.customer?.name || '-')}</div>
            <div><b>UID:</b> ${esc(document.customer?.uid || 'N/A')}</div>
            <div><b>Mobile:</b> ${esc(document.customer?.mobile || 'N/A')}</div>
            <div style="grid-column:span 2"><b>Product:</b> ${esc(category)}</div>
            <div style="grid-column:span 2"><b>Size:</b> ${esc(size)} | <b>Qty:</b> ${esc(document.qty)}</div>
            <div style="grid-column:span 2"><b>Brand:</b> ${esc(primary?.brandName || '-')}</div>
          </div>
          <div style="position:absolute;bottom:4mm;left:5mm;right:5mm;display:flex;align-items:flex-end;justify-content:space-between">
            <div style="font-size:10px;font-weight:700;color:${RED}">${maxYears ? `${maxYears} Years` : 'No Guarantee'}</div>
            <div style="width:25mm;border-top:1px solid #000;padding-top:1mm;text-align:center;font-size:7px">Proprietor</div>
          </div>
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
  const { category, height, width, qty, alu } = quote
  const thicknesses = alu.thicknesses ?? []
  const selected = new Set(alu.addons ?? [])
  const isDoor = category === 'aluminium-door'
  const is2Track = category === 'window-2-track'
  const hasChaukhat = selected.has('Chaukhat')
  const hasAccessories = selected.has('Accessories')
  const hasSsNet = selected.has('SS Net')
  const hasDecorFilm = selected.has('Decor Film')
  const hasBrownCoated = selected.has('Brown Coated')
  const hasAnyExtraAddon = hasSsNet || hasDecorFilm || hasBrownCoated
  const hIn = Number(height.inches || 0) + Number(height.soot || 0) / 8
  const wIn = Number(width.inches || 0) + Number(width.soot || 0) / 8
  const area = Math.round((hIn * wIn / 144) * 100) / 100
  const chaukhatRft = isDoor
    ? Math.max(Math.round(((hIn * 2 + wIn) / 12) * 100) / 100, 14.5)
    : Math.round(((hIn * 2 + wIn) / 12) * 100) / 100
  const dimStr = d => d.soot ? `${d.inches} ${d.soot}/8 ''` : `${d.inches} ''`
  const productTitle = isDoor
    ? `Bathroom Aluminium Door${hasChaukhat ? '<br>With Chaukhat' : ''}`
    : is2Track
      ? '2 Track Aluminium Sliding Window'
      : `3 Track Aluminium Sliding Window${hasSsNet ? '<br>With Half SS Net' : ''}`
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
    rows += row('Total', thicknesses.map(t => pairCells('', `${t.total}${qty > 1 ? ` ×${qty}` : ''}`, false, 'bold')).join(''))
    if (hasDecorFilm || hasBrownCoated) rows += addonHeader
    if (hasDecorFilm) rows += row('Décor Film', thicknesses.map(t => pairCells(t.decorFilmRate, t.decorFilm)).join(''))
    if (hasBrownCoated) rows += row('Brown Coated', thicknesses.map(t => pairCells(t.brownCoatedRate, t.brownCoated)).join(''))
  } else {
    rows = row('Glass', thicknesses.map(t => pairCells(t.doorRate, t.doorCost)).join(''))
    if (hasChaukhat) rows += row('Chaukhat', thicknesses.map(t => pairCells(t.chaukhatRate, t.chaukhatCost)).join(''))
    rows += row('Total', thicknesses.map(t => pairCells('', t.total, false, 'bold')).join(''), 'shade right bold')
    if (hasAnyExtraAddon) rows += addonHeader
    if (hasSsNet) rows += row('SS Net', thicknesses.map(t => pairCells(50, t.accessories)).join(''))
    if (hasDecorFilm) rows += row('Décor Film', thicknesses.map(t => pairCells(30, t.decorFilm)).join(''))
    if (hasBrownCoated) rows += row('Brown Coated', thicknesses.map(t => pairCells(40, t.brownCoated)).join(''))
  }

  const imgW = isDoor ? 112 : 152
  const imgH = isDoor ? 240 : 152
  const margin = isDoor ? 32 : 34
  const diagramW = imgW + margin * 2
  const diagramH = imgH + margin * 2
  const marker = isDoor ? 'door' : 'window'
  const diagram = `
    <div class="diagram" style="width:${diagramW}px;height:${diagramH}px">
      <img src="${productImage}" style="left:${margin}px;top:${margin}px;width:${imgW}px;height:${imgH}px">
      <svg width="${diagramW}" height="${diagramH}">
        <defs>
          <marker id="arrow-end-${marker}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#000"/></marker>
          <marker id="arrow-start-${marker}" markerWidth="7" markerHeight="7" refX="1" refY="3.5" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 Z" fill="#000"/></marker>
        </defs>
        <text x="${margin + imgW / 2}" y="18" text-anchor="middle">${dimStr(width)}</text>
        <line x1="${margin}" y1="28" x2="${margin + imgW}" y2="28" marker-start="url(#arrow-start-${marker})" marker-end="url(#arrow-end-${marker})"/>
        <text x="18" y="${margin + imgH / 2}" text-anchor="middle" transform="rotate(-90,18,${margin + imgH / 2})">${dimStr(height)}</text>
        <line x1="28" y1="${margin}" x2="28" y2="${margin + imgH}" marker-start="url(#arrow-start-${marker})" marker-end="url(#arrow-end-${marker})"/>
      </svg>
    </div>`

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  @page { size:A4 portrait; margin:0; }
  body { color:#000; background:#fff; }
  .page { width:210mm; min-height:297mm; background:#fff; }
  .sheet { width:160mm; margin:0 auto; padding-top:24mm; font-family:"Times New Roman",Times,serif; color:#000; }
  .header { display:flex; align-items:center; justify-content:space-between; gap:6mm; margin-bottom:4mm; }
  .header img { display:block; width:86mm; }
  .title { display:flex; align-items:center; width:68mm; min-height:13mm; border:2px solid #000; background:#d9d9d9; padding:4px 8px; font-size:14px; line-height:1.25; }
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
  .diagram img { position:absolute; object-fit:contain; }
  .diagram svg { position:absolute; inset:0; overflow:visible; }
  .diagram text { font:17px "Times New Roman",Times,serif; }
  .diagram line { stroke:#000; stroke-width:1.6; }
</style></head><body><div class="page"><div class="sheet">
  <div class="header"><img src="${headerImage}"><div class="title"><div>${productTitle}</div></div></div>
  <div class="content">
    <table class="info"><tbody>
      <tr><td class="label">Size -</td><td class="center">${dimStr(height)}&nbsp; X &nbsp;${dimStr(width)}</td></tr>
      <tr><td class="label">Area -</td><td class="center">${area} Sqft</td></tr>
      ${hasChaukhat ? `<tr><td class="label">Chaukhat -</td><td class="center">${chaukhatRft} Rft</td></tr>` : ''}
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
