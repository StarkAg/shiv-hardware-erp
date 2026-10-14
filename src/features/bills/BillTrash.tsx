import { useMemo, useState } from 'react'
import { Images, List, Lock, Paperclip, X } from 'lucide-react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { rupees, shortDate } from '../ledger/lib/format'
import { useLedgerTheme } from '../ledger/useLedgerTheme'
import Confirm from '../ledger/components/Confirm'
import BillViewer from '../ledger/components/BillViewer'
import { TableSkeleton } from '../ledger/components/Skeleton'
import '../ledger/ledger.css'

type TrashRow = NonNullable<ReturnType<typeof useQuery<typeof api.trash.all>>>[number]

// The Trash used to be kept on the device so it opened at once; with a code
// on it, a copy would show it without one. Any copy left from before goes.
try {
  for (const key of Object.keys(localStorage)) if (/^shivledger:q:.*:trash$/.test(key)) localStorage.removeItem(key)
} catch { /* nothing kept */ }

/**
 * The Trash asks for the code each time it is opened: the code stays only
 * while the page is open, so leaving it and coming back asks again.
 */
export function BillTrash() {
  const dark = useLedgerTheme()
  const [code, setCode] = useState<string | null>(null)
  if (code === null) return <TrashLock dark={dark} onOpen={setCode} />
  return <TrashBin code={code} />
}

function TrashLock({ dark, onOpen }: { dark: boolean; onOpen: (code: string) => void }) {
  const unlock = useMutation(api.trash.unlock)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await unlock({ pin: pin.trim() })
      onOpen(pin.trim())
    } catch (err) {
      setError((err as { data?: string })?.data || 'Wrong code.')
      setPin('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={`ledger-root min-h-screen ${dark ? 'dark' : ''}`}>
      <div className="app">
        <h1 className="pagetitle">Trash</h1>
        <form className="trash-lock" onSubmit={submit}>
          <Lock size={26} aria-hidden="true" />
          <label htmlFor="trash-code">Code to open the Trash</label>
          <input id="trash-code" type="password" inputMode="numeric" autoComplete="off" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn" type="submit" disabled={busy || !pin.trim()}>{busy ? 'Checking' : 'Open'}</button>
        </form>
      </div>
    </div>
  )
}

/** The panel and ledger share one bin; linked bills and vouchers appear once. */
function TrashBin({ code }: { code: string }) {
  const dark = useLedgerTheme()
  const rows = useQuery(api.trash.all, { pin: code })
  const restoreBill = useMutation(api.bills.restore)
  const restoreVoucher = useMutation(api.trash.restore)
  const purgeBill = useMutation(api.bills.purge)
  const [search, setSearch] = useState('')
  const [restoring, setRestoring] = useState<TrashRow | null>(null)
  const [purging, setPurging] = useState<TrashRow | null>(null)
  const [viewing, setViewing] = useState<TrashRow | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  // Every deleted bill's photos at once, to find one deleted by mistake by its look.
  const [allPhotos, setAllPhotos] = useState(false)
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (rows ?? []).filter(row => [row.label, row.party, row.refNo, row.type]
      .some(value => value.toLowerCase().includes(needle)))
  }, [rows, search])

  return (
    <div className={`ledger-root min-h-screen ${dark ? 'dark' : ''}`}>
      <div className="app">
        <h1 className="pagetitle">Trash</h1>
        <p className="hint mb-4">Deleted bills and vouchers. A bill and its linked accounting entry are restored together.</p>
        <div className="toolbar">
          <input aria-label="Search trash" placeholder="Search party, bill or voucher" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="count">{rows === undefined ? 'Loading…' : `${filtered.length} deleted entries`}</div>
          <div className="actions">
            <button className="btn ghost" onClick={() => setAllPhotos(!allPhotos)}>
              {allPhotos ? <><List aria-hidden="true" /> List</> : <><Images aria-hidden="true" /> All photos</>}
            </button>
          </div>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {rows === undefined ? <TableSkeleton cols={7} rows={5} wide={3} /> : !filtered.length ? (
          <div className="empty">{search ? 'No deleted entries match.' : 'Nothing has been deleted.'}</div>
        ) : allPhotos ? (
          <TrashPhotos rows={filtered} busy={busy !== null} onOpen={setViewing} onRestore={setRestoring} />
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

/**
 * Every deleted bill with photos, as cards of its pictures: the way to find
 * the one deleted by mistake is usually to recognise the paper. A card opens
 * the bill's photos full size, and restores it.
 */
function TrashPhotos({ rows, busy, onOpen, onRestore }: {
  rows: TrashRow[]
  busy: boolean
  onOpen: (row: TrashRow) => void
  onRestore: (row: TrashRow) => void
}) {
  const withPhotos = rows.filter((row) => row.attachmentUrls.some((a) => a.url || a.previewUrl))
  if (!withPhotos.length) return <div className="empty">No deleted entry has a photo.</div>
  return (
    <div className="trash-photos">
      {withPhotos.map((row) => (
        <div key={row._id} className="trash-card">
          <button className="trash-shots" onClick={() => onOpen(row)} aria-label={`View photos for ${row.label}`}>
            {row.attachmentUrls.slice(0, 4).map((a, i) => {
              const src = a.previewUrl || (/pdf/i.test(a.contentType ?? '') ? null : a.url)
              return src
                ? <img key={i} src={src} alt="" loading="lazy" decoding="async" />
                : <span key={i} className="trash-pdf">PDF</span>
            })}
            {row.attachmentUrls.length > 4 && <span className="trash-more">+{row.attachmentUrls.length - 4}</span>}
          </button>
          <div className="trash-meta">
            <b className="mono">{row.label}</b>
            <span>{row.party}</span>
            <span className="ref">{shortDate(row.date)} · {row.status === 'pending' ? 'Unpriced' : rupees(row.amount ?? 0)}</span>
            <span className="ref">Deleted {new Date(row.deletedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <button className="btn small" disabled={busy} onClick={() => onRestore(row)}>Restore</button>
        </div>
      ))}
    </div>
  )
}
