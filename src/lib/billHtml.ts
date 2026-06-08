// Generates bill HTML — identical to print-server/template.mjs buildBillHtml.
// Used for the in-app preview (iframe srcdoc) so preview === printed output.

import type { Bill } from './types'

const BILL_LABEL: Record<string, string> = {
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

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatDate(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function toProperCase(s: string) {
  return s.replace(/\b\w/g, c => c.toUpperCase())
}

function shortenBrand(name: string): string {
  if (!name || name.length <= 9) return name
  const words = name.trim().split(/\s+/)
  if (words.length < 2) return name
  return words.slice(0, -1).map(w => w[0]).join('') + ' ' + words[words.length - 1]
}

function fmt(n: number | null | undefined) {
  return Number(n || 0).toLocaleString('en-IN')
}

/** Collect an item's attributes (brand, size, custom field values) in order. */
function itemAttrs(item: Bill['items'][number]): string[] {
  const attrs: string[] = []
  if (item.brandName) attrs.push(shortenBrand(item.brandName))
  const size = item.sizeIn
    ? item.sizeIn
    : (item.heightIn && item.widthIn ? `${item.heightIn}×${item.widthIn}` : '')
  if (size) attrs.push(size)
  if (item.fieldValues) {
    for (const v of Object.values(item.fieldValues)) if (v) attrs.push(String(v))
  }
  return attrs
}

/** Middle cell: attributes spread to equal-width columns that auto-balance per item. */
function attrCell(item: Bill['items'][number]): string {
  const attrs = itemAttrs(item)
  if (attrs.length === 0) return ''
  const cells = attrs
    .map(a => `<span style="flex:1;min-width:0;text-align:center;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a)}</span>`)
    .join('')
  return `<div style="display:flex;align-items:center;gap:1.5mm">${cells}</div>`
}

export function buildBillHtml(bill: Bill): string {
  const items = bill.items ?? []
  const PAGE_ITEMS = 14
  const pages: typeof items[] = []
  for (let i = 0; i < items.length; i += PAGE_ITEMS) pages.push(items.slice(i, i + PAGE_ITEMS))
  if (pages.length === 0) pages.push([])

  const pagesHtml = pages.map((pageItems, pageIdx) => {
    const isLast = pageIdx === pages.length - 1
    const prevTotal = items.slice(0, pageIdx * PAGE_ITEMS).reduce((s, i) => s + (Number(i.amount) || 0), 0)
    const pageSubtotal = pageItems.reduce((s, i) => s + (Number(i.amount) || 0), 0)
    const runningTotal = prevTotal + pageSubtotal

    const customerBlock = pageIdx === 0 && bill.customerName
      ? `<div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:10.5pt">M/s &nbsp;${esc(toProperCase(bill.customerName))}</div>
          ${bill.customerPhone ? `<div style="font-weight:400;font-size:9pt;color:#555;margin-top:0.5mm">${esc(bill.customerPhone)}</div>` : ''}
          ${bill.customerUid ? `<div style="font-weight:400;font-size:8.5pt;color:#777;margin-top:0.5mm">UID - ${esc(bill.customerUid)}</div>` : ''}
        </div>`
      : '<div style="flex:1"></div>'

    const carryForward = prevTotal > 0
      ? `<div style="display:flex;justify-content:space-between;font-size:9.5pt;font-style:italic;color:#555;margin-bottom:2mm;border-bottom:0.5px solid #aaa;padding-bottom:1mm">
          <span>B/f (p.${pageIdx})</span><span style="font-weight:700">${fmt(prevTotal)}</span>
        </div>`
      : ''

    const CELL = 'vertical-align:middle;padding-top:1.5mm;padding-bottom:1.5mm'
    const rows = pageItems.map(item => {
      const isCatalog = !!item.category
      const productCols = isCatalog
        ? `<td style="${CELL};line-height:1.3">${esc(BILL_LABEL[item.category!] ?? item.category)}</td>
           <td style="${CELL};padding-left:3mm">${attrCell(item)}</td>`
        : `<td colspan="2" style="${CELL};line-height:1.3">${esc(item.description) || '<span style="color:#ccc">—</span>'}</td>`
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

    const bottomRight = isLast
      ? `<div style="text-align:right">
          ${prevTotal > 0 ? `<div style="font-size:9.5pt;color:#555;margin-bottom:0.5mm">${fmt(runningTotal)}</div>` : ''}
          <div style="font-size:12pt;font-weight:900;border-top:1.5px solid #111;border-bottom:3px double #111;padding-top:1mm;padding-bottom:1mm;min-width:24mm">${fmt(bill.total)}</div>
        </div>`
      : `<div style="font-size:10pt;font-weight:700">${fmt(runningTotal)}</div>`

    const breakStyle = isLast ? '' : 'page-break-after:always;'

    return `<div style="position:relative;width:148mm;min-height:210mm;margin:0 auto;padding:8mm 7mm 10mm;box-sizing:border-box;background-color:#fff;background-image:repeating-linear-gradient(transparent,transparent 7.8mm,#e8eef5 7.8mm,#e8eef5 8mm);background-position-y:22mm;${breakStyle}">
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

  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  @page { size: 148mm 210mm; margin: 0; }
  html, body { margin: 0; padding: 0; width: 148mm; background: white; font-family: Arial, sans-serif; color: #111; overflow: hidden; }
  table { border-collapse: collapse; }
  td, th { border: none; padding: 0; }
</style>
</head><body>${pagesHtml}</body></html>`
}
