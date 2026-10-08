import { useState } from 'react'
import { Pencil, X } from 'lucide-react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useLedgerTheme } from '../ledger/useLedgerTheme'
import Confirm from '../ledger/components/Confirm'
import { TableSkeleton } from '../ledger/components/Skeleton'
import '../ledger/ledger.css'

type Row = NonNullable<ReturnType<typeof useQuery<typeof api.devices.list>>>[number]

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })

/**
 * Every device and server allowed into the books (convex/devices.ts). Removing
 * one asks the shop PIN; the removed device is refused on its next call and
 * has to be given the PIN again.
 */
export function TrustedDevices() {
  const dark = useLedgerTheme()
  const rows = useQuery(api.devices.list, {})
  const rename = useMutation(api.devices.rename)
  const remove = useMutation(api.devices.remove)
  const [renaming, setRenaming] = useState<Row | null>(null)
  const [removing, setRemoving] = useState<Row | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  return (
    <div className={`ledger-root min-h-screen ${dark ? 'dark' : ''}`}>
      <div className="app">
        <h1 className="pagetitle">Trusted devices</h1>
        <div className="toolbar">
          <div className="count">{rows === undefined ? 'Loading…' : `${rows.length} trusted`}</div>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {rows === undefined ? <TableSkeleton cols={5} rows={4} wide={1} /> : (
          <div className="table-wrap"><div className="scroller">
            <table className="ledger">
              <thead><tr><th>Name</th><th>App</th><th>Trusted</th><th>Last used</th><th>Actions</th></tr></thead>
              <tbody>{rows.map((row) => (
                <tr key={row._id}>
                  <td className="particulars" data-label="Name">
                    {row.name}
                    <div className="ref">{row.kind === 'server' ? 'Server' : row.isThis ? 'This device' : 'Device'}</div>
                  </td>
                  <td data-label="App">{row.app}</td>
                  <td className="ref" data-label="Trusted">{when(row.createdAt)}</td>
                  <td className="ref" data-label="Last used">{when(row.lastSeenAt)}</td>
                  <td className="rowacts" data-label="Actions">
                    <button className="xbtn" aria-label={`Rename ${row.name}`} title="Rename" onClick={() => { setName(row.name); setRenaming(row) }}>
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button className="xbtn del" aria-label={`Remove ${row.name}`} title="Remove" onClick={() => setRemoving(row)}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div></div>
        )}
        {renaming && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRenaming(null)}>
            <form
              className="w-full max-w-sm space-y-3 rounded-xl bg-white p-4 shadow-xl dark:bg-stone-900"
              onClick={(e) => e.stopPropagation()}
              onSubmit={async (e) => {
                e.preventDefault()
                setError('')
                try { await rename({ id: renaming._id as Id<'trustedDevices'>, name }); setRenaming(null) }
                catch (err) { setError(err instanceof Error ? err.message : String(err)) }
              }}
            >
              <label className="block text-sm font-semibold">
                Name
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-stone-300 bg-transparent px-3 py-2 dark:border-white/15" />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn ghost" onClick={() => setRenaming(null)}>Cancel</button>
                <button type="submit" className="btn" disabled={!name.trim()}>Save</button>
              </div>
            </form>
          </div>
        )}
        {removing && <Confirm
          title={`Remove ${removing.name}?`}
          body={removing.isThis ? 'This is the device you are using. It will ask for the PIN again.' : 'It will ask for the PIN again before it can reach the books.'}
          ask={{ label: 'Shop PIN', secret: true }}
          confirmLabel="Remove"
          danger
          onConfirm={async (pin) => { await remove({ id: removing._id as Id<'trustedDevices'>, pin }) }}
          onClose={() => setRemoving(null)}
        />}
      </div>
    </div>
  )
}
