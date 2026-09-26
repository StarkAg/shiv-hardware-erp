// Generates bill HTML — identical to print-server/template.mjs buildBillHtml.
// Used for the in-app preview (iframe srcdoc) so preview === printed output.

import type { Bill } from './types'
import { isRoundupLine, isAmountOnlyLine, billLines, billCharges } from './types'

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

/**
 * The name without the "M/s" the shop writes in front of it.
 *
 * Every document prints "M/s" itself, and many accounts were opened with it
 * already in the name — so the two ran together as "M/s M/s Pappu Jee". The
 * courtesy belongs to the document, not to the account.
 */
export function withoutCourtesy(name: string): string {
  return String(name ?? '').replace(/^\s*m\/s\.?\s+/i, '').trim()
}

/**
 * Proper case, and nothing else — the length never changes, so it can run on
 * every keystroke without the caret moving.
 *
 * An apostrophe is a word boundary as far as `\b` is concerned, which turned
 * "Louver's" into "Louver'S" and made the small s impossible to type. A letter
 * after an apostrophe only starts a word when a word follows it: O'Brien does,
 * the possessive in "Louver's" and the contraction in "don't" do not.
 */
export function toProperCase(s: string) {
  return s
    .replace(/(^|[^A-Za-z0-9'’])([a-z])/g, (_, before, ch) => before + ch.toUpperCase())
    .replace(/(['’])([a-z])([a-z]+)/g, (_, quote, first, rest) => quote + first.toUpperCase() + rest)
}

/**
 * How an item line is written on a bill: proper case, and board sizes always
 * spaced as "8 X 4" however they were typed (8x4, 8 x 4, 8×4).
 *
 * Applied at render, not on input — the stored text stays exactly as the
 * counter typed it, and the cursor never jumps mid-word.
 */
export function formatItemDescription(s: string): string {
  return toProperCase(s).replace(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/gi, '$1 X $2')
}

/**
 * Split a typed-out item line into the columns a catalog row fills.
 *
 *   "19mm / Solid Black Tiger / 8x4"  -> explicit, split on "/"
 *   "6mm Plywood Greenply 8x4"        -> brand found in the shop's brand list
 *   "Hinges 4 Inch"                   -> nothing certain, left whole
 *
 * Guessing the brand by word position does not work: "Solid Black Tiger" is one
 * brand and "Solid Black" is a description, and no pattern can tell them apart.
 * So the brand is only split off when the line says so explicitly, or when it
 * matches a brand already in the catalog. Otherwise the line stays intact —
 * a wrong column is worse than one wide column.
 *
 * NOTE: no longer used by the bill — typed lines now print exactly as written,
 * in one column. Kept for the scan/review flow, which still needs the split.
 */
export function parseItemLine(
  desc: string,
  knownBrands: string[] = [],
): { product: string; brand: string; size: string } {
  const text = formatItemDescription(desc ?? '').trim()
  if (!text) return { product: '', brand: '', size: '' }

  // Explicit "product / brand / size" wins over any inference.
  if (text.includes('/')) {
    const [product = '', brand = '', size = ''] = text.split('/').map(x => x.trim())
    return { product, brand, size }
  }

  const sizeMatch = text.match(/(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)\s*$/)
  const size = sizeMatch ? `${sizeMatch[1]} X ${sizeMatch[2]}` : ''
  const head = (sizeMatch ? text.slice(0, sizeMatch.index) : text).trim()

  // Longest match first, so "Solid Black Tiger" beats a stray "Tiger".
  const brand = [...knownBrands]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .find(b => new RegExp(`(^|\\s)${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i').test(head))

  if (!brand) return { product: head, brand: '', size }
  const product = head.replace(new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').replace(/\s+/g, ' ').trim()
  return { product, brand, size }
}

export function shortenBrand(name: string): string {
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
function attrCellFrom(attrs: string[]): string {
  if (attrs.length === 0) return ''
  // Left-aligned, not centred: a lone size centred in its column floats far
  // from the item it belongs to. It reads as a size for the row below it.
  const cells = attrs
    .map(a => `<span style="min-width:0;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a)}</span>`)
    .join('')
  return `<div style="display:flex;align-items:center;gap:3mm">${cells}</div>`
}

function attrCell(item: Bill['items'][number]): string {
  return attrCellFrom(itemAttrs(item))
}

/** ₹29,830 as "Twenty Nine Thousand Eight Hundred Thirty Rupees Only". */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`
}

/** Indian grouping: crore, lakh, thousand, hundred — not millions. */
export function rupeesInWords(amount: number): string {
  const n = Math.floor(Math.abs(Number(amount) || 0))
  if (n === 0) return 'Zero Rupees Only'
  const parts: string[] = []
  const crore = Math.floor(n / 10000000)
  const lakh = Math.floor((n % 10000000) / 100000)
  const thousand = Math.floor((n % 100000) / 1000)
  const hundred = Math.floor((n % 1000) / 100)
  const rest = n % 100
  if (crore) parts.push(`${twoDigits(crore)} Crore`)
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`)
  if (hundred) parts.push(`${ONES[hundred]} Hundred`)
  if (rest) parts.push(twoDigits(rest))
  return `${parts.join(' ')} Rupees Only`
}

/**
 * A receipt is not a bill.
 *
 * It has no goods on it and nothing to add up — it acknowledges money, so it
 * prints as an acknowledgement: who paid, how much, in words, how it was paid
 * and what it settles. Printing it through the estimate's item table produced
 * a bill with one odd line on it and a total that read as a demand for money
 * already in the drawer.
 */
function buildReceiptHtml(bill: Bill): string {
  const paying = bill.kind === 'payment'
  const discount = Math.max(0, Number(bill.discount) || 0)
  const settled = Number(bill.total) || 0
  const money = Math.max(0, settled - discount)
  const mode = bill.paymentMode === 'online' || bill.paymentMode === 'upi' ? 'Bank' : 'Cash'

  const row = (label: string, value: string) => `
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6mm;padding:1.4mm 0;border-bottom:0.5px dotted #bbb">
      <span style="color:#555;font-size:9.5pt">${esc(label)}</span>
      <span style="font-weight:700;font-size:10.5pt">${value}</span>
    </div>`

  return `<div style="position:relative;width:148mm;min-height:210mm;margin:0 auto;padding:10mm 9mm;box-sizing:border-box;background:#fff">
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:7.5pt;letter-spacing:5px;color:#888;text-transform:uppercase;padding-bottom:1.5mm;border-bottom:0.5px solid #bbb">
      <span>${paying ? 'Payment Voucher' : 'Receipt'}</span>
      <span>${esc(bill.number)}</span>
    </div>

    <div style="margin-top:8mm;font-size:10pt;line-height:1.9">
      <span style="color:#555">${paying ? 'Paid to' : 'Received with thanks from'}</span>
      <div style="font-weight:700;font-size:12.5pt;margin-top:1mm">M/s&nbsp;${esc(toProperCase(withoutCourtesy(bill.customerName) || '—'))}</div>
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
      ${row('Date', formatDate(bill.paidDate || bill.date))}
    </div>

    ${bill.notes ? `<div style="margin-top:5mm;font-size:9.5pt;color:#444;line-height:1.6">${esc(bill.notes)}</div>` : ''}

    <div style="position:absolute;bottom:14mm;right:9mm;text-align:center">
      <div style="width:46mm;border-top:0.5px solid #111;padding-top:1.5mm;font-size:9pt;color:#555">
        For Shiv Hardware Store
      </div>
    </div>
  </div>`
}

export function buildBillHtml(bill: Bill): string {
  // A receipt and a payment are money, not goods, and print as their own
  // document — one page, no item table, no running total.
  const pagesHtml = (bill.kind === 'receipt' || bill.kind === 'payment')
    ? buildReceiptHtml(bill)
    : buildEstimatePages(bill)
  return wrapPages(pagesHtml)
}

function buildEstimatePages(bill: Bill): string {
  const items = billLines(bill.items)
  const charges = billCharges(bill.items)
  const PAGE_ITEMS = 14
  const pages: typeof items[] = []
  for (let i = 0; i < items.length; i += PAGE_ITEMS) pages.push(items.slice(i, i + PAGE_ITEMS))
  if (pages.length === 0) pages.push([])

  const pagesHtml = pages.map((pageItems, pageIdx) => {
    const isLast = pageIdx === pages.length - 1
    const prevTotal = items.slice(0, pageIdx * PAGE_ITEMS).reduce((s, i) => s + (Number(i.amount) || 0), 0)
    const pageSubtotal = pageItems.reduce((s, i) => s + (Number(i.amount) || 0), 0)
    const runningTotal = prevTotal + pageSubtotal

    // Any one detail is enough to print the block — a bill can carry a ref with
    // no name (site delivery, counter sale against a PO).
    const hasCustomerInfo = !!(bill.customerName || bill.customerPhone || bill.customerUid || bill.ref)
    const customerBlock = pageIdx === 0 && hasCustomerInfo
      ? `<div style="flex:1;min-width:0">
          ${bill.customerName ? `<div style="font-weight:700;font-size:10.5pt">M/s&nbsp;${esc(toProperCase(withoutCourtesy(bill.customerName)))}</div>` : ''}
          ${bill.customerPhone ? `<div style="font-weight:400;font-size:9pt;color:#555;margin-top:0.5mm">${esc(bill.customerPhone)}</div>` : ''}
          ${bill.customerUid ? `<div style="font-weight:400;font-size:8.5pt;color:#777;margin-top:0.5mm">UID - ${esc(bill.customerUid)}</div>` : ''}
          ${bill.ref ? `<div style="font-weight:400;font-size:8.5pt;color:#777;margin-top:0.5mm">Ref - ${esc(bill.ref)}</div>` : ''}
        </div>`
      : '<div style="flex:1"></div>'

    const carryForward = prevTotal > 0
      ? `<div style="display:flex;justify-content:space-between;font-size:9.5pt;font-style:italic;color:#555;margin-bottom:2mm;border-bottom:0.5px solid #aaa;padding-bottom:1mm">
          <span>B/f (p.${pageIdx})</span><span style="font-weight:700">${fmt(prevTotal)}</span>
        </div>`
      : ''

    // Row padding stays tight: an estimate is read as a list, and airy rows
    // push items onto a second page for no gain.
    const CELL = 'vertical-align:middle;padding-top:0.8mm;padding-bottom:0.8mm'
    const rows = pageItems.map(item => {
      const isCatalog = !!item.category
      const productCols = isCatalog
        ? `<td style="${CELL};line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:38mm">${esc(BILL_LABEL[item.category!] ?? item.category)}</td>
           <td style="${CELL};padding-left:2mm">${attrCell(item)}</td>`
        : isRoundupLine(item)
          ? `<td colspan="2" style="${CELL};line-height:1.3"></td>`
        // A typed line stays exactly as the counter wrote it. Splitting off a
        // brand or a size guessed wrong often enough to be worse than one
        // wide column, and it pushed the size away from its own item.
        : `<td colspan="2" style="${CELL};line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${
            item.description?.trim()
              ? esc(formatItemDescription(item.description))
              : '<span style="color:#ccc">—</span>'
          }</td>`
      return `<tr>
        <td style="${CELL};color:#888;line-height:1.3">✕</td>
        ${productCols}
        <td style="${CELL};padding-left:4mm;color:#555;white-space:nowrap">${
          isRoundupLine(item) || isAmountOnlyLine(item) || !Number(item.qty)
            ? ''
            : `${esc(item.qty)} ${esc(item.unit)}`
        }</td>
        <td style="${CELL};padding-left:4mm;text-align:right;font-weight:600;white-space:nowrap${Number(item.amount) < 0 ? ';color:#b00' : ''}">${item.amount ? fmt(item.amount) : ''}</td>
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
    // then Total — read top to bottom in the order the figure is built.
    const hasCharges = isLast && charges.length > 0
    const bottomRight = isLast
      ? `<div style="text-align:right">
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
        </div>`
      : `<div style="font-size:10pt;font-weight:700">${fmt(runningTotal)}</div>`

    // Fare and round-off sit just above the total rule — a charge on the bill,
    // not one of the goods, and read right where the figure it changes is.
    // The goods come first as a Sub Total, so a fare reads as added to them.
    // On a bill of several pages the goods' figure used to print beside the
    // total instead — below the fare, as if it came after it.
    const subTotal = hasCharges
      ? `<div style="display:flex;justify-content:flex-end;align-items:baseline;gap:4mm;font-size:10pt;margin-bottom:1.5mm;border-top:0.5px solid #aaa;padding-top:1mm">
          <span style="color:#555">Sub Total</span>
          <span style="font-weight:700;min-width:24mm;text-align:right">${fmt(runningTotal)}</span>
        </div>`
      : ''
    const chargeLines = isLast
      ? subTotal + charges.map(c => `
          <div style="display:flex;justify-content:flex-end;align-items:baseline;gap:4mm;font-size:10pt;margin-bottom:1.5mm">
            <span style="color:#555">${esc(formatItemDescription(c.description))}</span>
            <span style="font-weight:600;min-width:24mm;text-align:right${Number(c.amount) < 0 ? ';color:#b00' : ''}">${fmt(Number(c.amount))}</span>
          </div>`).join('')
      : ''

    const breakStyle = isLast ? '' : 'page-break-after:always;'

    // The shop's bills are written on ruled paper and the printer draws that
    // ruling, so the preview draws it too — a preview that leaves it out is not
    // showing what comes off the printer. Same gradient as the print server's.
    return `<div style="position:relative;width:148mm;min-height:210mm;margin:0 auto;padding:8mm 7mm 10mm;box-sizing:border-box;background-color:#fff;background-image:repeating-linear-gradient(transparent,transparent 7.8mm,#e8eef5 7.8mm,#e8eef5 8mm);background-position-y:22mm;${breakStyle}">
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

  return pagesHtml
}

function wrapPages(pagesHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  @page { size: 148mm 210mm; margin: 0; }
  html, body { margin: 0; padding: 0; width: 148mm; background: white; font-family: Arial, sans-serif; color: #111; overflow: hidden; }
  table { border-collapse: collapse; }
  td, th { border: none; padding: 0; }
</style>
</head><body>${pagesHtml}</body></html>`
}
