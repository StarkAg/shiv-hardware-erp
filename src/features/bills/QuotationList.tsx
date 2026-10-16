import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Paperclip, ReceiptText, X } from 'lucide-react'
import { useStore } from '../../lib/store'
import Confirm from '../ledger/components/Confirm'
import { toast } from '../../components/Toast'
import type { Bill } from '../../lib/types'
import { isQuotation } from '../../lib/types'
import { rupees, shortDate } from '../ledger/lib/format'
import { useLedgerTheme } from '../ledger/useLedgerTheme'
import VoucherBillPreview from '../ledger/components/VoucherBillPreview'
import BillViewer from '../ledger/components/BillViewer'
import '../ledger/ledger.css'

/** "QTN-4" for Q-4, the way the day book labels it. */
const quoteLabel = (number: string | undefined) => `QTN-${String(number ?? '').replace(/^Q-/, '')}`

/**
 * Every quotation the shop has given, newest first.
 *
 * Quotations are never posted, so the books cannot list them; they live with
 * the bills. One taken up and converted is a sale now, and stays on this list
 * as "Sold" with the bill it became — so the list answers both "what have we
 * quoted" and "what came of it".
 */
export function QuotationList() {
  const dark = useLedgerTheme()
  const navigate = useNavigate()
  const bills = useStore((s) => s.bills)
  const [search, setSearch] = useState('')
  const [show, setShow] = useState<'open' | 'all'>('open')
  const [previewing, setPreviewing] = useState<Bill | null>(null)
  const [photos, setPhotos] = useState<Bill | null>(null)
  const deleteBill = useStore((s) => s.deleteBill)
  const [deleting, setDeleting] = useState<Bill | null>(null)

  // A visit order for the mechanic is a quotation without a price yet; it
  // belongs on the Work list, not here.
  const all = useMemo(
    () => bills
      .filter((b) => (isQuotation(b) && !b.workOrder) || b.fromQuote)
      .sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [bills],
  )
  const openCount = all.filter(isQuotation).length
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return all
      .filter((b) => show === 'all' || isQuotation(b))
      .filter((b) => !needle || [b.customerName, b.customerPhone, b.number, b.fromQuote, quoteLabel(b.fromQuote ?? b.number)]
        .some((v) => String(v ?? '').toLowerCase().includes(needle)))
  }, [all, search, show])

  const goods = (b: Bill) => b.items.filter((i) => i.description.trim() && !i.isRoundup && !i.amountOnly && !i.auto)

  return (
    <div className={`ledger-root min-h-screen ${dark ? 'dark' : ''}`}>
      <div className="app">
        <h1 className="pagetitle">Quotations</h1>
        <p className="hint mb-4">
          Prices given to customers. They sit on the customer&apos;s account but never in its balance, until converted to a sale.
        </p>
        <div className="toolbar">
          <input aria-label="Search quotations" placeholder="Search customer, phone or number" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className={`btn small${show === 'open' ? ' on' : ''}`} onClick={() => setShow('open')}>Open ({openCount})</button>
          <button className={`btn small${show === 'all' ? ' on' : ''}`} onClick={() => setShow('all')}>All ({all.length})</button>
          <button className="btn small" onClick={() => navigate('/bills?new=quotation')}>+ New quotation</button>
        </div>
        {!rows.length ? (
          <div className="empty">
            {search ? 'No quotations match.' : show === 'open' ? 'No open quotations.' : 'No quotations yet.'}
          </div>
        ) : (
          <div className="table-wrap"><div className="scroller">
            <table className="ledger">
              <thead>
                <tr>
                  <th className="w-date">Date</th>
                  <th className="w-no">Quotation</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th className="w-clip" />
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const open = isQuotation(b)
                  const lines = goods(b)
                  return (
                    <tr key={b.id} className={open ? '' : 'quote'}>
                      <td className="mono" data-label="Date">{shortDate(Date.parse(b.date))}</td>
                      <td className="mono entryno" data-label="Quotation">{quoteLabel(open ? b.number : b.fromQuote)}</td>
                      <td className="particulars" data-label="Customer">
                        {b.customerName || '—'}
                        {b.customerPhone && <div className="ref">{b.customerPhone}</div>}
                      </td>
                      <td className="particulars" data-label="Items">
                        {lines[0]?.description ?? '—'}
                        {lines.length > 1 && <div className="ref">+{lines.length - 1} more</div>}
                      </td>
                      <td className="num" data-label="Amount">{rupees(b.total)}</td>
                      <td data-label="Status">
                        {open ? 'Open' : <span className="ref">Sold · Bill {b.number}</span>}
                      </td>
                      <td className="w-clip" data-label="">
                        {!!b.attachments?.length && <button type="button" className="clip" aria-label="Preview quotation photos" onClick={() => setPhotos(b)}>
                          <Paperclip size={13} aria-hidden="true" />
                        </button>}
                        <button className="clip" onClick={() => setPreviewing(b)} aria-label="Show the quotation" title="Show">
                          <ReceiptText size={13} aria-hidden="true" />
                        </button>
                      </td>
                      <td className="rowacts" data-label="">
                        {open ? (
                          <>
                            <button className="btn small" onClick={() => navigate(`/bills/${b.id}`)}>Open</button>
                            <button className="btn small on" onClick={() => navigate(`/bills/${b.id}?convert=sale`)}>Convert to sale</button>
                            <button className="xbtn del" title="Delete this quotation" aria-label={`Delete ${quoteLabel(b.number)}`} onClick={() => setDeleting(b)}>
                              <X size={14} aria-hidden="true" />
                            </button>
                          </>
                        ) : (
                          <button className="btn small" onClick={() => navigate(`/bills/${b.id}`)}>Open bill</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div></div>
        )}
        {previewing && <VoucherBillPreview bill={previewing} onClose={() => setPreviewing(null)} />}
        {deleting && (
          <Confirm
            title={`Delete ${quoteLabel(deleting.number)}?`}
            body={`The quotation for ${deleting.customerName || 'this customer'} goes to the bill trash, where it can be restored.`}
            confirmLabel="Delete"
            danger
            onClose={() => setDeleting(null)}
            onConfirm={async () => {
              const b = deleting
              setDeleting(null)
              const gone = await deleteBill(b.id)
              toast(gone ? `${quoteLabel(b.number)} deleted` : 'Not deleted: the books could not be reached. Try again.', gone ? 'ok' : 'error')
            }}
          />
        )}
        {photos && <BillViewer voucher={{ party: photos.customerName, vchLabel: quoteLabel(photos.number), date: Date.parse(photos.date), attachmentUrls: photos.attachments }} onClose={() => setPhotos(null)} />}
      </div>
    </div>
  )
}
