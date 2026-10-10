import { useLive } from '../ledger/lib/cache'
import { useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Printer, TriangleAlert } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { rupees } from '../ledger/lib/format'
import { useLedgerTheme } from '../ledger/useLedgerTheme'
import { TableSkeleton } from '../ledger/components/Skeleton'
import { useShortcuts } from '../../lib/useShortcuts'
import '../ledger/ledger.css'

/**
 * The cash register, one day at a time.
 *
 * The drawer is its own department and this screen keeps it that way: no
 * accounts, no posting, nothing of the books. What it does carry is the only
 * question the counter actually asks at the end of a day — does the drawer
 * match? — which the page could not answer before, because it read the notes
 * and ignored the opening figure and the evening count sitting beside them.
 *
 * Cash and bank are kept apart throughout. Only one of them is in the till, and
 * adding a phone transfer to the notes in the drawer produces a figure that
 * matches nothing anybody can count.
 */

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const step = (date: string, by: number) => {
  const [y, m, d] = date.split('-').map(Number)
  return isoDay(new Date(y, m - 1, d + by))
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Thursday, 18 Sep 2026" — the way a day is said, not a code. */
const spoken = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  const when = new Date(y, m - 1, d)
  return `${DAYS[when.getDay()]}, ${d} ${MONTHS[m - 1]} ${y}`
}

/** The clock time a note was written, which is the only order cash has. */
const clock = (ms: number) => {
  const t = new Date(ms)
  const h = t.getHours()
  return `${((h + 11) % 12) + 1}:${String(t.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

type Row = {
  entryId: string
  kind: 'in' | 'out'
  mode: 'cash' | 'online'
  name: string
  amount: number
  dealer: boolean
  at: number
}

type Day = {
  date: string
  rows: Row[]
  cash: { opening: number; in: number; out: number; expected: number }
  bank: { opening: number; in: number; out: number; closing: number }
  close: { counted: number; shut: boolean; at: number } | null
  difference: number | null
  hasOpening: boolean
  count: number
  near: { first: string | null; last: string | null }
}

export function CashReview() {
  const dark = useLedgerTheme()
  const today = useMemo(() => isoDay(new Date()), [])
  const [date, setDate] = useState(today)
  const [find, setFind] = useState('')

  const day = useLive(api.cash.forDay, { date }, `cash:${date}`) as Day | undefined

  // The arrows stop where the register does, rather than paging into empty
  // dates for ever.
  const atStart = !!day?.near.first && date <= day.near.first
  const atEnd = date >= today
  const back = () => !atStart && setDate((d) => step(d, -1))
  const forward = () => !atEnd && setDate((d) => step(d, 1))

  // A day is a step, not a form to fill in. The hook keeps these from firing
  // while the cursor is in the search box.
  useShortcuts({ ArrowLeft: back, ArrowRight: forward })

  /**
   * What was in the drawer after each note.
   *
   * Counted on the cash rows only and always on the whole day, never on what
   * the search has left on screen — a running total that skipped the rows you
   * filtered out would be a column of wrong numbers.
   */
  const running = useMemo(() => {
    const out = new Map<string, number>()
    let held = day?.cash.opening ?? 0
    for (const row of day?.rows ?? []) {
      if (row.mode !== 'online') held += row.kind === 'in' ? row.amount : -row.amount
      out.set(row.entryId, held)
    }
    return out
  }, [day])

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase()
    if (!q || !day) return day?.rows ?? []
    return day.rows.filter((r) => r.name.toLowerCase().includes(q))
  }, [day, find])

  return (
    <div className={`ledger-root min-h-screen ${dark ? 'dark' : ''}`}>
      <div className="app">
        <div className="cash-head no-print">
          <h1 className="pagetitle">Cash</h1>
          <button className="btn ghost small" onClick={() => window.print()}>
            <Printer size={14} aria-hidden="true" /> Print
          </button>
        </div>

        <div className="cash-day">
          <button className="xbtn" aria-label="The day before" disabled={atStart} onClick={back}>
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <div className="cash-day-name">
            <b>{spoken(date)}</b>
            {date !== today && (
              <button className="btn small ghost no-print" onClick={() => setDate(today)}>
                Today
              </button>
            )}
          </div>
          <button className="xbtn" aria-label="The day after" disabled={atEnd} onClick={forward}>
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>

        {day && (
          <div className="cash-panels">
            {/* The till. Opening, what moved, what should be there, what was. */}
            <section className="cash-panel">
              <h2>In the drawer</h2>
              <dl>
                <div><dt>Opening</dt><dd>{day.hasOpening ? rupees(day.cash.opening) : '—'}</dd></div>
                <div><dt>In</dt><dd className="pos">{rupees(day.cash.in)}</dd></div>
                <div><dt>Out</dt><dd className="neg">{rupees(day.cash.out)}</dd></div>
                <div className="rule"><dt>Should be</dt><dd><b>{rupees(day.cash.expected)}</b></dd></div>
                <div>
                  <dt>Counted</dt>
                  <dd>{day.close && !day.close.shut ? rupees(day.close.counted) : '—'}</dd>
                </div>
              </dl>
              {day.close?.shut ? (
                <p className="cash-verdict">The shop did not open.</p>
              ) : day.difference === null ? (
                <p className="cash-verdict waiting">Not counted yet.</p>
              ) : day.difference === 0 ? (
                <p className="cash-verdict ok">
                  <Check size={15} aria-hidden="true" /> The drawer balanced.
                </p>
              ) : (
                <p className="cash-verdict bad">
                  <TriangleAlert size={15} aria-hidden="true" />
                  {day.difference > 0
                    ? `${rupees(day.difference)} more in the drawer than there should be.`
                    : `${rupees(-day.difference)} short.`}
                </p>
              )}
            </section>

            {/* Kept apart: none of this is in the till to be counted. */}
            <section className="cash-panel">
              <h2>Bank</h2>
              <dl>
                <div><dt>Opening</dt><dd>{day.hasOpening ? rupees(day.bank.opening) : '—'}</dd></div>
                <div><dt>In</dt><dd className="pos">{rupees(day.bank.in)}</dd></div>
                <div><dt>Out</dt><dd className="neg">{rupees(day.bank.out)}</dd></div>
                <div className="rule"><dt>Closing</dt><dd><b>{rupees(day.bank.closing)}</b></dd></div>
              </dl>
              <p className="cash-verdict">
                {day.bank.in || day.bank.out
                  ? 'Phone and card, not in the till.'
                  : 'Nothing through the bank today.'}
              </p>
            </section>
          </div>
        )}

        {day && day.count > 6 && (
          <input
            className="cash-find no-print"
            placeholder="Find a name in this day…"
            value={find}
            onChange={(e) => setFind(e.target.value)}
          />
        )}

        {day === undefined ? (
          <TableSkeleton cols={5} rows={6} wide={1} />
        ) : !shown.length ? (
          <div className="empty">
            {find.trim()
              ? `Nothing on this day matches "${find.trim()}".`
              : 'Nothing was written in the drawer on this day.'}
          </div>
        ) : (
          <div className="table-wrap"><div className="scroller">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Name</th>
                  <th className="num">In</th>
                  <th className="num">Out</th>
                  <th className="num">In drawer</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.entryId} className={row.mode === 'online' ? 'viabank' : ''}>
                    <td className="mono" data-label="Time">{clock(row.at)}</td>
                    <td className="particulars" data-label="Name">
                      {row.name || '—'}
                      {(row.mode === 'online' || row.dealer) && (
                        <div className="ref">
                          {[row.mode === 'online' && 'Bank', row.dealer && 'Dealer']
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="num pos" data-label="In">
                      {row.kind === 'in' ? rupees(row.amount) : ''}
                    </td>
                    <td className="num neg" data-label="Out">
                      {row.kind === 'out' ? rupees(row.amount) : ''}
                    </td>
                    {/* Blank on a bank row: it never entered the drawer. */}
                    <td className="num mono" data-label="In drawer">
                      {row.mode === 'online' ? '' : rupees(running.get(row.entryId) ?? 0)}
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
