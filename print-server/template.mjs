// Pure HTML template — no React/Tailwind, no external deps.
// Mirrors the AluminiumPrint and QuotationPrint layouts exactly.

import { readFile } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ASSETS = resolve(__dir, '../public/assets')

async function b64(file) {
  const buf = await readFile(resolve(ASSETS, file))
  return `data:image/png;base64,${buf.toString('base64')}`
}

const GREEN = '#B9924B'
const RED = '#9F1D20'

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

export async function buildQuotationHtml(quote) {
  const lh = await b64('letterhead/shiv-letterhead.png')
  const { category, height, width, qty, rows, alu } = quote
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

  // Aluminium — show all 3 thicknesses
  if (alu) {
    return page(`${meta}<div style="padding:0 8mm">${buildAluTable(alu)}</div>`)
  }

  return page(`${meta}<div style="padding:0 8mm;color:#888">No data.</div>`)
}

function buildAluTable(alu) {
  const { thicknesses } = alu
  const cols = thicknesses.map(t => `
    <th colspan="2" class="center">${t.name}</th>`).join('')
  const doorRow = thicknesses.map(t =>
    `<td class="right">@${t.doorRate}</td><td class="right">${t.doorCost}</td>`).join('')
  const chaukRow = thicknesses.map(t =>
    `<td class="right">@${t.chaukhatRate}</td><td class="right">${t.chaukhatCost}</td>`).join('')
  const accRow = thicknesses.map(t =>
    `<td></td><td class="right">${t.accessories}</td>`).join('')
  const totalRow = thicknesses.map(t =>
    `<td></td><td class="right bold">${t.total}</td>`).join('')
  const decorRow = thicknesses.map(t =>
    `<td class="right">@${t.decorFilmRate}</td><td class="right">${t.decorFilm}</td>`).join('')
  const brownRow = thicknesses.map(t =>
    `<td class="right">@${t.brownCoatedRate}</td><td class="right">${t.brownCoated}</td>`).join('')

  return `<table>
    <thead><tr><th></th>${cols}</tr></thead>
    <tbody>
      <tr><td class="right">Door</td>${doorRow}</tr>
      <tr><td class="right">Chaukhat</td>${chaukRow}</tr>
      <tr><td class="right">Accessories</td>${accRow}</tr>
      <tr><td class="right bold">Total</td>${totalRow}</tr>
      <tr><td colspan="${thicknesses.length * 2 + 1}" class="bold" style="background:#f5f5f5">Add-ons</td></tr>
      <tr><td class="right">Décor Film</td>${decorRow}</tr>
      <tr><td class="right">Brown Coated</td>${brownRow}</tr>
    </tbody>
  </table>`
}
