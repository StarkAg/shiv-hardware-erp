import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { rupees, shortDate } from '../ledger/lib/format'
import { useLedgerTheme } from '../ledger/useLedgerTheme'
import { TableSkeleton } from '../ledger/components/Skeleton'
import '../ledger/ledger.css'

/**
 * The drawer notes the books could not take.
 *
 * Not in the menu. The Cash screen is a day's register now, read-only, because
 * posting is not something the shop wants to do while reading the day — but
 * these notes still have to be given an account by somebody, so the screen that
 * does it keeps its own address rather than being deleted with the old view.
 *
 * Everything the counter writes on the cash page posts itself as a Receipt or
 * a Payment. What lands here is the one thing the counter cannot decide: whose
 * account a name belongs to. Nothing is invented — a note stays out of the
 * balances until somebody says where it goes.
 */
export function CashPending() {
  const dark = useLedgerTheme()
  const rows = useQuery(api.cash.unposted, {})
  const masters = useQuery(api.masters.all, {})
  const assign = useMutation(api.cash.assign)
  const postBacklog = useMutation(api.cash.postBacklog)

  const [choice, setChoice] = useState<Record<string, string>>({})
  const [choosing, setChoosing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [said, setSaid] = useState('')

  const parties = useMemo(
    () => [...(masters?.ledgers ?? [])].sort((a: any, b: any) => a.name.localeCompare(b.name)),
    [masters],
  )
  const partyNames = useMemo(
    () => new Map(parties.map((party: any) => [String(party._id), party.name])),
    [parties],
  )

  async function run(entryId: string, work: () => Promise<unknown>) {
    setBusy(entryId); setError(''); setSaid('')
    try { await work() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(null) }
  }

  return (
    <div className={`ledger-root min-h-screen ${dark ? 'dark' : ''}`}>
      <div className="app">
        <h1 className="pagetitle">Cash waiting on an account</h1>
        <div className="toolbar">
          <div className="count">
            {rows === undefined ? 'Loading…' : `${rows.length} waiting`}
          </div>
          <div className="actions">
            <button
              className="btn ghost"
              disabled={busy !== null}
              onClick={() => run('backlog', async () => {
                const res = await postBacklog({})
                setSaid(`${res.posted} posted, ${res.waiting} still need an account.`)
              })}
            >
              Post what can post
            </button>
          </div>
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        {said && <p className="hint" role="status">{said}</p>}

        {rows === undefined ? <TableSkeleton cols={6} rows={5} wide={2} /> : !rows.length ? (
          <div className="empty">Every drawer note is in the books.</div>
        ) : (
          <div className="table-wrap"><div className="scroller">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Note</th>
                  <th>Held up by</th>
                  <th className="num">Amount</th>
                  <th>Account</th>
                  <th className="w-acts" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any) => (
                  <tr key={row.entryId} className="unposted">
                    <td className="mono" data-label="Date">{shortDate(Date.parse(`${row.date}T00:00:00Z`))}</td>
                    <td className="particulars" data-label="Note">
                      {row.name || '—'}
                      <div className="ref">{row.kind === 'in' ? 'Received' : 'Paid'} · {row.mode === 'online' ? 'Bank' : 'Cash'}{row.dealer ? ' · dealer' : ''}</div>
                    </td>
                    <td className="ref" data-label="Held up by">{row.why}</td>
                    <td className="num" data-label="Amount">{rupees(row.amount)}</td>
                    <td data-label="Account">
                      {choosing === row.entryId ? (
                        <select autoFocus aria-label={`Account for ${row.name || row.entryId}`}
                          value={choice[row.entryId] ?? ''}
                          onChange={(e) => setChoice((c) => ({ ...c, [row.entryId]: e.target.value }))}>
                          <option value="">Choose account…</option>
                          {parties.map((l: any) => (
                            <option key={l._id} value={l._id}>{l.name}</option>
                          ))}
                        </select>
                      ) : (
                        <button type="button" className="btn small ghost" aria-label={`Choose account for ${row.name || row.entryId}`}
                          onClick={() => setChoosing(row.entryId)}>
                          {partyNames.get(choice[row.entryId]) || 'Choose account…'}
                        </button>
                      )}
                    </td>
                    <td className="rowacts">
                      <button
                        className="btn small"
                        disabled={busy !== null || !choice[row.entryId]}
                        onClick={() => run(row.entryId, () => assign({
                          entryId: row.entryId,
                          ledgerId: choice[row.entryId] as never,
                        }))}
                      >
                        Post
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        )}
      </div>
    </div>
  )
}
