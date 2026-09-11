import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useStore } from '../../lib/store'
import { rupees } from '../ledger/lib/format'
import { useLedgerTheme } from '../ledger/useLedgerTheme'
import { Bar } from '../ledger/components/Skeleton'
import '../ledger/ledger.css'

/**
 * How the shop is doing, and what is waiting.
 *
 * The panel opened on the quotation chooser — the first screen the first of
 * the two apps happened to have. What the counter actually wants on opening
 * is the day: what was sold, what is in the drawer, who owes what, and
 * whether anything did not go through.
 *
 * Every figure is a link to the screen that acts on it, and every figure here
 * is read from the books rather than kept separately, so nothing on this
 * screen can disagree with the ledger.
 */

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** The shop's cash and bank, out of the trial balance's own rows. */
function drawer(trial: { rows: { name: string; group: string; debit: number; credit: number }[] } | undefined) {
  const held = (trial?.rows ?? []).filter(
    (r) => r.group === 'Cash-in-Hand' || r.group === 'Bank Accounts',
  )
  return held.reduce((total, r) => total + r.debit - r.credit, 0)
}

function Figure({
  label,
  value,
  to,
  tone = 'plain',
  loading,
}: {
  label: string
  value: string
  to: string
  tone?: 'plain' | 'owed' | 'owing' | 'attention'
  loading?: boolean
}) {
  return (
    <Link to={to} className={`home-tile home-tile-${tone}`}>
      <span className="home-tile-label">{label}</span>
      <span className="home-tile-value">{loading ? <Bar w="60%" h={22} /> : value}</span>
    </Link>
  )
}

export function Home() {
  const dark = useLedgerTheme()
  const { bills } = useStore()

  const today = startOfToday()
  const book = useQuery(api.reports.dayBook, { from: today, to: today + 86_399_999 })
  const trial = useQuery(api.reports.trialBalance, {})
  const receivable = useQuery(api.reports.receivables, {})
  const payable = useQuery(api.reports.outstanding, {})
  const unreadPhotos = useQuery(api.review.unread, { limit: 50 })
  const cashWaiting = useQuery(api.cash.unposted, {})
  const printing = useQuery(api.printJobs.listPending, {})

  const day = useMemo(() => {
    const rows = book ?? []
    const sum = (prefix: string) =>
      rows.filter((r: any) => String(r.vchLabel ?? '').startsWith(prefix))
        .reduce((t: number, r: any) => t + (r.amount ?? 0), 0)
    return { sales: sum('SAL'), received: sum('RCT'), paid: sum('PAY'), entries: rows.length }
  }, [book])

  // A bill that failed to post lives on this PC only, so it is counted here
  // rather than queried — the server has never heard of it.
  const unposted = bills.filter((b) => b.postError).length

  const waiting =
    (unposted ? 1 : 0) +
    ((unreadPhotos?.length ?? 0) ? 1 : 0) +
    ((cashWaiting?.length ?? 0) ? 1 : 0) +
    ((printing?.length ?? 0) ? 1 : 0)

  return (
    <div className={`ledger-root min-h-screen ${dark ? 'dark' : ''}`}>
      <div className="app">
        <div className="home-grid">
          <Figure label="Sales today" value={rupees(day.sales)} to="/bills" loading={book === undefined} />
          <Figure label="Received today" value={rupees(day.received)} to="/bills" loading={book === undefined} />
          <Figure label="Cash and bank" value={rupees(drawer(trial))} to="/ledger/trial" loading={trial === undefined} />
          <Figure
            label="Owed to the shop"
            value={rupees(receivable?.totals.closing ?? 0)}
            to="/ledger/customers"
            tone="owed"
            loading={receivable === undefined}
          />
          <Figure
            label="Shop owes"
            value={rupees(payable?.totals.closing ?? 0)}
            to="/ledger/suppliers"
            tone="owing"
            loading={payable === undefined}
          />
          <Figure label="Entries today" value={String(day.entries)} to="/bills" loading={book === undefined} />
        </div>

        {waiting > 0 && (
          <div className="home-grid home-waiting">
            {unposted > 0 && (
              <Figure label="Bills not in the books" value={String(unposted)} to="/bills" tone="attention" />
            )}
            {(unreadPhotos?.length ?? 0) > 0 && (
              <Figure label="Photos to price" value={String(unreadPhotos!.length)} to="/ledger/bills" tone="attention" />
            )}
            {(cashWaiting?.length ?? 0) > 0 && (
              <Figure label="Cash notes without a party" value={String(cashWaiting!.length)} to="/cash-review" tone="attention" />
            )}
            {(printing?.length ?? 0) > 0 && (
              <Figure label="Waiting to print" value={String(printing!.length)} to="/printer-queue" tone="attention" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
