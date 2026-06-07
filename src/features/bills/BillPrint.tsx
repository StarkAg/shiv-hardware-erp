// Bill print template — matches the physical handwritten shop bill format:
// notepad paper, bill# top-right, × item rows, P.T.O carry-forward, PAID stamp.

import type React from 'react'
import type { Bill } from '../../lib/types'
import { SHOP, CATEGORY_LABELS } from '../../lib/types'

const PAGE_ITEMS = 14

const toProperCase = (s: string) =>
  s.replace(/\b\w/g, (c) => c.toUpperCase())

function formatDate(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`
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
              // faint ruled lines
              backgroundImage: 'repeating-linear-gradient(transparent, transparent 7.8mm, #e8eef5 7.8mm, #e8eef5 8mm)',
              backgroundPositionY: '20mm',
            }}
          >
            {/* Bill number — top right, rubber-stamp style, sits in top padding above content */}
            <div style={{
              position: 'absolute',
              top: '1mm',
              right: '4mm',
              fontSize: '11pt',
              fontWeight: 900,
              border: '1.5px solid #555',
              borderRadius: '2px',
              padding: '0.5mm 3mm',
              color: '#333',
              letterSpacing: '1px',
            }}>
              {bill.number}{pages.length > 1 ? `  (${pageIdx + 1})` : ''}
            </div>

            {/* Page 1: customer name */}
            {pageIdx === 0 && bill.customerName && (
              <div style={{ marginBottom: '3mm', marginTop: '0mm', paddingRight: '18mm' }}>
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
              </div>
            )}

            {/* Carry-forward from previous page */}
            {prevTotal > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5pt', fontStyle: 'italic', color: '#555', marginBottom: '2mm', borderBottom: '0.5px solid #aaa', paddingBottom: '1mm' }}>
                <span>B/f (p.{pageIdx})</span>
                <span style={{ fontWeight: 700 }}>{prevTotal.toLocaleString('en-IN')}</span>
              </div>
            )}

            {/* Item rows */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10pt' }}>
              <tbody>
                {pageItems.map((item) => {
                  const isCatalog = !!item.category
                  const cell: React.CSSProperties = { verticalAlign: 'top', paddingTop: '1.5mm', paddingBottom: '1.5mm' }
                  return (
                    <tr key={item.id}>
                      {/* α bullet */}
                      <td style={{ ...cell, width: '6mm', color: '#333', fontWeight: 700 }}>α</td>

                      {isCatalog ? (
                        <>
                          {/* Product name */}
                          <td style={{ ...cell, lineHeight: 1.3 }}>
                            {CATEGORY_LABELS[item.category!]}
                          </td>
                          {/* Brand */}
                          <td style={{ ...cell, width: '22mm', color: '#444', whiteSpace: 'nowrap', paddingLeft: '2mm' }}>
                            {item.brandName ?? ''}
                          </td>
                          {/* Size */}
                          <td style={{ ...cell, width: '14mm', textAlign: 'center', color: '#555', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                            {item.heightIn}×{item.widthIn}
                          </td>
                        </>
                      ) : (
                        /* Free-text: description spans the three middle columns */
                        <td colSpan={3} style={{ ...cell, lineHeight: 1.3 }}>
                          {item.description || <span style={{ color: '#ccc' }}>—</span>}
                        </td>
                      )}

                      {/* Qty */}
                      <td style={{ ...cell, width: '14mm', textAlign: 'center', color: '#555', whiteSpace: 'nowrap' }}>
                        {item.qty} {item.unit}
                      </td>
                      {/* Amount */}
                      <td style={{ ...cell, width: '18mm', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {item.amount ? item.amount.toLocaleString('en-IN') : ''}
                      </td>
                    </tr>
                  )
                })}
                {/* Blank filler rows */}
                {Array.from({ length: Math.max(0, 6 - pageItems.length) }).map((_, i) => (
                  <tr key={`blank-${i}`}>
                    <td style={{ paddingTop: '4mm' }} />
                    <td /><td /><td /><td /><td />
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
                    {/* Shop contact */}
                    <div style={{ fontSize: '8pt', color: '#888', marginTop: '1mm' }}>
                      {SHOP.phones.map(p => p.number).join(' · ')}
                    </div>
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
