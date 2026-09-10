import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { rupees } from '../ledger/lib/format'
import { useLedgerTheme } from '../ledger/useLedgerTheme'
import '../ledger/ledger.css'

/**
 * What has been deleted, and how to get it back.
 *
 * On its own screen rather than folded into the day book: the day book is what
 * the shop did, and a bin sitting in the middle of it makes the day read as
 * though the deleted things were part of it.
 *
 * Deleting a bill puts it here whole and sends its ledger voucher to the
 * ledger's own trash, so the books stop showing an amount with no bill behind
 * it. Putting it back opens the bill; saving it re-posts the voucher.
 */
export function BillTrash() {
  const dark = useLedgerTheme()
  const navigate = useNavigate()
  const rows = useQuery(api.bills.trashList, {}) as any[] | undefined
  const restore = useMutation(api.bills.restore)
  const purge = useMutation(api.bills.purge)

  const when = (at: number) =>
    new Date(at).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })

  return (
    <div className={`ledger-root min-h-screen ${dark ? 'dark' : ''}`}>
      <div className="app">
        <div className="toolbar">
          <div className="count">
            {rows === undefined ? 'Loading…' : `${rows.length} deleted ${rows.length === 1 ? 'bill' : 'bills'}`}
          </div>
        </div>

        {rows !== undefined && rows.length === 0 ? (
          <div className="empty">Nothing has been deleted.</div>
        ) : (
          <div className="table-wrap">
            <div className="scroller">
              <table className="ledger">
                <thead>
                  <tr>
                    <th className="w-no">Bill</th>
                    <th>Party</th>
                    <th>Deleted</th>
                    <th className="num">Amount</th>
                    <th className="w-acts" />
                  </tr>
                </thead>
                <tbody>
                  {(rows ?? []).map((r) => (
                    <tr key={r._id}>
                      <td className="mono entryno" data-label="Bill">
                        {r.bill?.number ? `#${r.bill.number}` : '—'}
                        <div className="ref">{(r.bill?.items ?? []).length} lines</div>
                      </td>
                      <td className="particulars" data-label="Party">
                        {r.bill?.customerName || '—'}
                        {r.voucherRef && (
                          <div className="ref">{r.voucherRef} went to the ledger's trash</div>
                        )}
                      </td>
                      <td className="ref" data-label="Deleted">{when(r.deletedAt)}</td>
                      <td className="num" data-label="Amount">{rupees(r.bill?.total ?? 0)}</td>
                      <td className="rowacts" data-label="">
                        <button
                          className="xbtn"
                          aria-label="Put it back"
                          title="Put it back"
                          onClick={async () => {
                            const bill = await restore({ id: r._id })
                            // Opened straight away: a restored bill has to be
                            // saved again to put its voucher back in the books.
                            if (bill?.id) navigate(`/bills/${bill.id}`)
                          }}
                        >
                          ↩
                        </button>
                        <button
                          className="xbtn del"
                          aria-label="Delete for good"
                          title="Delete for good"
                          onClick={() => {
                            const pin = window.prompt('Delete this bill for good? Enter the code.')
                            if (pin) void purge({ id: r._id, pin })
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
