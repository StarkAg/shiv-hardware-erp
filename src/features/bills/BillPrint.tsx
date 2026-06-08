// Bill print template — matches the physical handwritten shop bill format:
// notepad paper, bill# top-right, × item rows, P.T.O carry-forward, PAID stamp.

import type React from 'react'
import type { Bill, ProductCategory } from '../../lib/types'

// Short labels with thickness/size prefix first (used only in bill print)
const BILL_LABEL: Record<ProductCategory, string> = {
  'block-board-19': '19mm Block Board',
  'block-board-12': '12mm Block Board',
  'plywood-6':      '6mm Plywood',
  'flush-door':     'Flush Door',
  'readymade-door': 'Readymade Door',
  'aluminium-door': 'Aluminium Door',
  'window-2-track': '2-Track Window',
  'window-3-track': '3-Track Window',
  'hinge':          'Hinges',
  'screw':          'Screw',
  'aldrop':         'Aldrop',
  'handle':         'Handle',
  'tb':             'Tower Bolt',
  'fevicol':        'Fevicol',
  'mica':           'Mica',
  'tape':           'Abro Tape',
}

const PAGE_ITEMS = 14

const toProperCase = (s: string) =>
  s.replace(/\b\w/g, (c) => c.toUpperCase())

function formatDate(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

function chunk<T>(arr: T[], size: number): T[][] {
  const pages: T[][] = []
  for (let i = 0; i < arr.length; i += size) pages.push(arr.slice(i, i + size))
  if (pages.length === 0) pages.push([])
  return pages
}

export function BillPrint({ bill }: { bill: Bill }) {
  const pages = chunk(bill.items, PAGE_ITEMS)

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', color: '#111' }}>
      {pages.map((pageItems, pageIdx) => {
        const isLast = pageIdx === pages.length - 1
        const prevTotal = bill.items
          .slice(0, pageIdx * PAGE_ITEMS)
          .reduce((s, i) => s + (Number(i.amount) || 0), 0)
        const pageSubtotal = pageItems.reduce((s, i) => s + (Number(i.amount) || 0), 0)
        const runningTotal = prevTotal + pageSubtotal

        return (
          <div
            key={pageIdx}
            style={{
              position: 'relative',
              width: '148mm',
              minHeight: '210mm',
              margin: '0 auto',
              padding: '8mm 7mm 10mm',
              boxSizing: 'border-box',
              backgroundColor: '#fff',
              pageBreakAfter: isLast ? 'auto' : 'always',
            }}
          >
            {/* Top row: customer info (left) + bill number stamp (right) — same line */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '3mm' }}>
              {/* Customer name — page 1 only */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {pageIdx === 0 && bill.customerName && (
                  <>
                    <div style={{ fontWeight: 700, fontSize: '10.5pt' }}>M/s &nbsp;{toProperCase(bill.customerName)}</div>
                    {bill.customerPhone && (
                      <div style={{ fontWeight: 400, fontSize: '9pt', color: '#555', marginTop: '0.5mm' }}>
                        {bill.customerPhone}
                      </div>
                    )}
                    {bill.customerUid && (
                      <div style={{ fontWeight: 400, fontSize: '8.5pt', color: '#777', marginTop: '0.5mm' }}>
                        UID - {bill.customerUid}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Bill number stamp */}
              <div style={{
                flexShrink: 0,
                marginLeft: '3mm',
                fontSize: '11pt',
                fontWeight: 900,
                border: '1.5px solid #555',
                borderRadius: '2px',
                padding: '1.5mm 3mm',
                color: '#333',
                letterSpacing: '1px',
              }}>
                {bill.number}{pages.length > 1 ? `  (${pageIdx + 1})` : ''}
              </div>
            </div>

            {/* Carry-forward from previous page */}
            {prevTotal > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5pt', fontStyle: 'italic', color: '#555', marginBottom: '2mm', borderBottom: '0.5px solid #aaa', paddingBottom: '1mm' }}>
                <span>B/f (p.{pageIdx})</span>
                <span style={{ fontWeight: 700 }}>{prevTotal.toLocaleString('en-IN')}</span>
              </div>
            )}

            {/* Item rows — α(6) | product(34) | attributes(40) | qty(16) | amount(18) mm.
                The attributes cell auto-equalises brand/size/custom fields per item. */}
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '10pt' }}>
              <colgroup>
                <col style={{ width: '6mm' }} />   {/* α */}
                <col style={{ width: '34mm' }} />   {/* product */}
                <col style={{ width: '40mm' }} />   {/* attributes */}
                <col style={{ width: '16mm' }} />   {/* qty */}
                <col style={{ width: '18mm' }} />   {/* amount */}
              </colgroup>
              <tbody>
                {pageItems.map((item) => {
                  const isCatalog = !!item.category
                  const GAP = '4mm'
                  const cell: React.CSSProperties = { verticalAlign: 'top', paddingTop: '1.5mm', paddingBottom: '1.5mm' }
                  const attrs: string[] = []
                  if (item.brandName) attrs.push(item.brandName)
                  const size = item.sizeIn ? item.sizeIn : (item.heightIn && item.widthIn ? `${item.heightIn}×${item.widthIn}` : '')
                  if (size) attrs.push(size)
                  if (item.fieldValues) for (const v of Object.values(item.fieldValues)) if (v) attrs.push(String(v))
                  return (
                    <tr key={item.id}>
                      {/* handdrawn × bullet — mix-blend-mode:multiply removes white bg */}
                      <td style={{ ...cell }}>
                        <img
                          src="https://static.vecteezy.com/system/resources/previews/073/256/981/non_2x/handdrawn-multiplication-sign-scribble-symbol-vector.jpg"
                          style={{ width: '4mm', height: '4mm', display: 'block', mixBlendMode: 'multiply' }}
                          alt="x"
                        />
                      </td>

                      {isCatalog ? (
                        <>
                          {/* Product name */}
                          <td style={{ ...cell, lineHeight: 1.3, overflow: 'hidden' }}>
                            {BILL_LABEL[item.category!]}
                          </td>
                          {/* Attributes — equal-width columns */}
                          <td style={{ ...cell, paddingLeft: '3mm' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5mm' }}>
                              {attrs.map((a, i) => (
                                <span key={i} style={{ flex: 1, minWidth: 0, textAlign: 'center', color: '#555', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {a}
                                </span>
                              ))}
                            </div>
                          </td>
                        </>
                      ) : (
                        /* Free-text: spans product + attributes columns */
                        <td colSpan={2} style={{ ...cell, lineHeight: 1.3 }}>
                          {item.description || <span style={{ color: '#ccc' }}>—</span>}
                        </td>
                      )}

                      {/* Qty */}
                      <td style={{ ...cell, paddingLeft: GAP, color: '#555', whiteSpace: 'nowrap' }}>
                        {item.qty} {item.unit}
                      </td>
                      {/* Amount */}
                      <td style={{ ...cell, paddingLeft: GAP, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {item.amount ? item.amount.toLocaleString('en-IN') : ''}
                      </td>
                    </tr>
                  )
                })}
                {/* Blank filler rows */}
                {Array.from({ length: Math.max(0, 6 - pageItems.length) }).map((_, i) => (
                  <tr key={`blank-${i}`}>
                    <td style={{ paddingTop: '4mm' }} />
                    <td /><td /><td /><td />
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Bottom row: P.T.O. or Total */}
            <div style={{
              position: 'absolute',
              bottom: '10mm',
              left: '7mm',
              right: '7mm',
              borderTop: '1.5px solid #333',
              paddingTop: '2mm',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
            }}>
              {/* Left: P.T.O. or date */}
              <div style={{ fontSize: '9.5pt', color: '#444' }}>
                {!isLast ? (
                  <span style={{ fontStyle: 'italic', fontWeight: 700 }}>P.T.O</span>
                ) : (
                  <div>
                    <div style={{ fontSize: '9pt' }}>{formatDate(bill.date)}</div>
                    {bill.paid && (
                      <div style={{ fontSize: '9pt', color: '#555', textTransform: 'capitalize' }}>
                        {bill.paymentMode}
                        {bill.upiRef && <div style={{ fontSize: '8pt' }}>{bill.upiRef}</div>}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Right: running subtotal + final total */}
              <div style={{ textAlign: 'right' }}>
                {!isLast && (
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '1mm' }}>
                    {runningTotal.toLocaleString('en-IN')}
                  </div>
                )}
                {isLast && (
                  <>
                    {prevTotal > 0 && (
                      <div style={{ fontSize: '9.5pt', color: '#555', marginBottom: '0.5mm' }}>
                        {runningTotal.toLocaleString('en-IN')}
                      </div>
                    )}
                    <div style={{
                      fontSize: '12pt',
                      fontWeight: 900,
                      borderTop: '1.5px solid #111',
                      borderBottom: '3px double #111',
                      paddingTop: '1mm',
                      paddingBottom: '1mm',
                      minWidth: '24mm',
                    }}>
                      {bill.total.toLocaleString('en-IN')}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* PAID stamp */}
            {isLast && bill.paid && (
              <div style={{
                position: 'absolute',
                bottom: '30mm',
                left: '10mm',
                transform: 'rotate(-12deg)',
                border: '2.5px solid #cc0000',
                color: '#cc0000',
                fontWeight: 900,
                fontSize: '18pt',
                padding: '1mm 5mm',
                letterSpacing: '3px',
                opacity: 0.85,
                borderRadius: '2px',
                userSelect: 'none',
              }}>
                PAID
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
