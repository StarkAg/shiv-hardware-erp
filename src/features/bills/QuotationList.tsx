import { Fragment, useMemo, useState } from 'react'
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
import BillViewer, { photoStrip } from '../ledger/components/BillViewer'
import '../ledger/ledger.css'

/** "QTN-4" for Q-4, the way the day book labels it. */
const quoteLabel = (number: string | undefined) => `QTN-${String(number ?? '').replace(/^Q-/, '')}`

/** An open quotation older than this is worth a phone call: still wanted, or gone elsewhere? */
const STALE_DAYS = 30
const DAY = 86_400_000

const daysOld = (b: Bill) => Math.max(0, Math.floor((Date.now() - Date.parse(b.date)) / DAY))
const ageLabel = (d: number) => (d === 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} days ago` : `${Math.round(d / 30)} months ago`)
const monthOf = (b: Bill) => new Date(Date.parse(b.date)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

type Show = 'open' | 'stale' | 'sold' | 'all'

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
  const [show, setShow] = useState<Show>('open')
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
  const sum = (list: Bill[]) => list.reduce((t, b) => t + (b.total || 0), 0)
  const open = all.filter(isQuotation)
  const sold = all.filter((b) => !isQuotation(b))
  const stale = open.filter((b) => daysOld(b) > STALE_DAYS)
  // Of every quotation given, how many became a sale.
  const converted = all.length ? Math.round((sold.length / all.length) * 100) : 0

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return all
      .filter((b) =>
        show === 'all' ? true
          : show === 'sold' ? !isQuotation(b)
            : show === 'stale' ? isQuotation(b) && daysOld(b) > STALE_DAYS
              : isQuotation(b))
      .filter((b) => !needle || [b.customerName, b.customerPhone, b.number, b.fromQuote, quoteLabel(b.fromQuote ?? b.number),
        ...b.items.map((i) => i.description)]
        .some((v) => String(v ?? '').toLowerCase().includes(needle)))
  }, [all, search, show])

  const goods = (b: Bill) => b.items.filter((i) => i.description.trim() && !i.isRoundup && !i.amountOnly && !i.auto)

  return (
    <div className={`ledger-root min-h-screen ${dark ? 'dark' : ''}`}>
      <div className="app">
        <h1 className="pagetitle">Quotations</h1>
        <p className="hint mb-4">
          Prices given to customers. They sit on the customer&apos;s account but never in its balance, until converted to a sale.
          Click a row to see the quotation.
        </p>
        {/* The four figures are also the filter: pressing one shows those. */}
        <div className="summary">
          <button type="button" className={`card total${show === 'open' ? ' on' : ''}`} onClick={() => setShow('open')}>
            <span className="card-name">Open</span>
            <span className="card-amt">{rupees(sum(open))}</span>
            <span className="card-meta">{open.length} quotation{open.length === 1 ? '' : 's'} waiting on the customer</span>
          </button>
          <button type="button" className={`card${show === 'stale' ? ' on' : ''}${stale.length ? ' qtn-attention' : ''}`} onClick={() => setShow('stale')}>
            <span className="card-name">Over {STALE_DAYS} days</span>
            <span className="card-amt">{stale.length}</span>
            <span className="card-meta">{stale.length ? `${rupees(sum(stale))} open, worth a call` : 'none left waiting'}</span>
          </button>
          <button type="button" className={`card${show === 'sold' ? ' on' : ''}`} onClick={() => setShow('sold')}>
            <span className="card-name">Became a sale</span>
            <span className="card-amt">{rupees(sum(sold))}</span>
            <span className="card-meta">{sold.length} of {all.length} · {converted}% converted</span>
          </button>
          <button type="button" className={`card${show === 'all' ? ' on' : ''}`} onClick={() => setShow('all')}>
            <span className="card-name">All quotations</span>
            <span className="card-amt">{all.length}</span>
            <span className="card-meta">{rupees(sum(all))} quoted in all</span>
          </button>
        </div>
        <div className="toolbar">
          <input aria-label="Search quotations" className="qtn-search" placeholder="Search customer, phone, number or item" value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="count">{rows.length} shown</span>
          <button className="btn small on" onClick={() => navigate('/bills?new=quotation')}>+ New quotation</button>
        </div>
        {!rows.length ? (
          <div className="empty">
            {search ? 'No quotations match.'
              : show === 'open' ? 'No open quotations.'
                : show === 'stale' ? `No open quotation is older than ${STALE_DAYS} days.`
                  : show === 'sold' ? 'No quotation has become a sale yet.'
                    : 'No quotations yet.'}
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
                {rows.map((b, at) => {
                  const isOpen = isQuotation(b)
                  const lines = goods(b)
                  const age = daysOld(b)
                  const month = monthOf(b)
                  const newMonth = at === 0 || monthOf(rows[at - 1]) !== month
                  return (
                    <Fragment key={b.id}>
                      {newMonth && (
                        <tr className="qtn-month"><td colSpan={8}>{month}</td></tr>
                      )}
                      <tr className={`qtn-row${isOpen ? '' : ' quote'}`} onClick={(e) => {
                        // The row shows the quotation; its buttons do their own thing.
                        if (!(e.target as HTMLElement).closest('button, a')) setPreviewing(b)
                      }}>
                        <td className="mono" data-label="Date">
                          {shortDate(Date.parse(b.date))}
                          <div className={`qtn-age${isOpen && age > STALE_DAYS ? ' stale' : ''}`}>{ageLabel(age)}</div>
                        </td>
                        <td className="mono entryno" data-label="Quotation">{quoteLabel(isOpen ? b.number : b.fromQuote)}</td>
                        <td className="particulars" data-label="Customer">
                          <span className="qtn-name">{b.customerName || '—'}</span>
                          {b.customerPhone && <div className="ref">{b.customerPhone}</div>}
                        </td>
                        <td className="particulars" data-label="Items">
                          {lines.slice(0, 2).map((l, i) => <div key={i} className={i ? 'ref' : undefined}>{l.description}</div>)}
                          {lines.length > 2 && <div className="ref">+{lines.length - 2} more</div>}
                          {!lines.length && '—'}
                        </td>
                        <td className="num qtn-amt" data-label="Amount">{rupees(b.total)}</td>
                        <td data-label="Status">
                          {isOpen
                            ? <span className={`qtn-status${age > STALE_DAYS ? ' stale' : ''}`}>{age > STALE_DAYS ? 'Open · old' : 'Open'}</span>
                            : <span className="qtn-status sold">Sold · Bill {b.number}</span>}
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
                          {isOpen ? (
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
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div></div>
        )}
        {previewing && (() => {
          // The arrows leaf through the list as it stands (search and Open/All).
          const at = rows.findIndex((b) => b.id === previewing.id)
          const label = quoteLabel(isQuotation(previewing) ? previewing.number : previewing.fromQuote)
          return (
            <VoucherBillPreview
              key={previewing.id}
              bill={previewing}
              title={label}
              onClose={() => setPreviewing(null)}
              step={at < 0 ? null : {
                prev: at > 0 ? () => setPreviewing(rows[at - 1]) : null,
                next: at < rows.length - 1 ? () => setPreviewing(rows[at + 1]) : null,
                at: `${at + 1} of ${rows.length}`,
              }}
            />
          )
        })()}
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
        {/* Every photo of the list as it stands, opened at the row clicked:
            the arrows go on to the next quotation's. */}
        {photos && <BillViewer voucher={photoStrip(
          rows.map((b) => ({
            key: b.id,
            vchType: 'Quotation',
            vchLabel: quoteLabel(isQuotation(b) ? b.number : b.fromQuote),
            date: Date.parse(b.date),
            party: b.customerName,
            amount: b.total,
            attachmentUrls: b.attachments,
          })),
          photos.id,
          'Quotations',
        )} onClose={() => setPhotos(null)} />}
      </div>
    </div>
  )
}
