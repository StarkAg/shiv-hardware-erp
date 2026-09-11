import { useMemo, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { rupees, shortDate } from '../ledger/lib/format'
import { useLedgerTheme } from '../ledger/useLedgerTheme'
import Confirm from '../ledger/components/Confirm'
import BillViewer from '../ledger/components/BillViewer'
import { TableSkeleton } from '../ledger/components/Skeleton'
import '../ledger/ledger.css'

type TrashRow = NonNullable<ReturnType<typeof useQuery<typeof api.trash.all>>>[number]

/** The panel and ledger share one bin; linked bills and vouchers appear once. */
export function BillTrash() {
  const dark = useLedgerTheme()
  const rows = useQuery(api.trash.all, {})
  const restoreBill = useMutation(api.bills.restore)
  const restoreVoucher = useMutation(api.trash.restore)
  const purgeBill = useMutation(api.bills.purge)
  const [search, setSearch] = useState('')
  const [restoring, setRestoring] = useState<TrashRow | null>(null)
  const [purging, setPurging] = useState<TrashRow | null>(null)
  const [viewing, setViewing] = useState<TrashRow | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (rows ?? []).filter(row => [row.label, row.party, row.refNo, row.type]
      .some(value => value.toLowerCase().includes(needle)))
  }, [rows, search])

  return (
    <div className={`ledger-root min-h-screen ${dark ? 'dark' : ''}`}>
      <div className="app">
        <h1 className="mb-2 text-xl font-semibold">Trash</h1>
        <p className="hint mb-4">Deleted bills and vouchers. A bill and its linked accounting entry are restored together.</p>
        <div className="toolbar">
          <input aria-label="Search trash" placeholder="Search party, bill or voucher" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="count">{rows === undefined ? 'Loading…' : `${filtered.length} deleted entries`}</div>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {rows === undefined ? <TableSkeleton cols={7} rows={5} wide={3} /> : !filtered.length ? (
          <div className="empty">{search ? 'No deleted entries match.' : 'Nothing has been deleted.'}</div>
        ) : (
          <div className="table-wrap"><div className="scroller">
            <table className="ledger">
              <thead><tr><th>Date</th><th>Document</th><th>Party</th><th className="num">Amount</th><th>Deleted</th><th>Photos</th><th>Actions</th></tr></thead>
              <tbody>{filtered.map(row => (
                <tr key={row._id}>
                  <td className="mono" data-label="Date">{shortDate(row.date)}</td>
                  <td className="mono entryno" data-label="Document">
                    {row.label}<div className="ref">{row.type}</div>
                    {row.linkedVoucher && <div className="ref">Includes {row.linkedVoucher}</div>}
                  </td>
                  <td className="particulars" data-label="Party">{row.party}<div className="ref">{row.refNo}</div></td>
                  <td className="num" data-label="Amount">{row.status === 'pending' ? 'Unpriced' : rupees(row.amount ?? 0)}</td>
                  <td className="ref" data-label="Deleted">{new Date(row.deletedAt).toLocaleString('en-GB')}</td>
                  <td data-label="Photos">{row.attachmentUrls.length > 0 && <button className="clip" aria-label={`View photos for ${row.label}`} onClick={() => setViewing(row)}><Paperclip size={13} aria-hidden="true" /></button>}</td>
                  <td className="rowacts" data-label="Actions">
                    <button className="btn small" disabled={busy !== null} onClick={() => setRestoring(row)}>Restore</button>
                    {row.source === 'bill' && <button className="xbtn del" disabled={busy !== null} aria-label={`Permanently delete ${row.label}`} title="Delete for good" onClick={() => setPurging(row)}><X size={14} aria-hidden="true" /></button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div></div>
        )}
        {restoring && <Confirm
          title={`Restore ${restoring.label}?`}
          body={restoring.linkedVoucher ? 'The bill and its accounting voucher will return together, including the original ledger entries.' : 'The deleted document will return. Any saved accounting entries will affect the balances again.'}
          requireText={restoring.party}
          requireLabel="Type the party name to restore"
          confirmLabel="Restore"
          danger={false}
          onConfirm={async () => {
            if (restoring.source === 'bill') await restoreBill({ id: restoring._id })
            else await restoreVoucher({ id: restoring._id })
          }}
          onClose={() => setRestoring(null)}
        />}
        {purging?.source === 'bill' && <Confirm
          title={`Permanently delete ${purging.label}?`}
          body="The bill and its linked voucher go for good. This cannot be undone."
          confirmLabel="Delete for good"
          danger
          ask={{ label: 'Code', secret: true }}
          onConfirm={async (pin) => {
            setBusy(purging._id); setError('')
            try { await purgeBill({ id: purging._id, pin }) }
            finally { setBusy(null) }
          }}
          onClose={() => setPurging(null)}
        />}
        {viewing && <BillViewer voucher={{ ...viewing, vchLabel: viewing.label }} onClose={() => setViewing(null)} />}
      </div>
    </div>
  )
}
