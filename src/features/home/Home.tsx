import { useState } from 'react'
import { useMutation } from 'convex/react'
import { useLive } from '../ledger/lib/cache'
import { Link } from 'react-router-dom'
import { api } from '../../../convex/_generated/api'
import { useStore } from '../../lib/store'
import { convexEnabled } from '../../lib/convexSync'
import { rupees } from '../ledger/lib/format'
import { useLedgerTheme } from '../ledger/useLedgerTheme'
import { Bar } from '../ledger/components/Skeleton'
import { SalesTrajectory, TopBalances } from './Charts'
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

/** "18 Sep, 2:00 am" */
const when = (ms: number) =>
  new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/** "3 days ago" */
const since = (ms: number) => {
  const hours = Math.floor((Date.now() - ms) / 3_600_000)
  return hours < 48 ? `${hours} hours ago` : `${Math.floor(hours / 24)} days ago`
}

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function Figure({
  label,
  value,
  to,
  tone = 'plain',
  loading,
  note,
}: {
  label: string
  value: string
  to: string
  tone?: 'plain' | 'owed' | 'owing' | 'attention'
  loading?: boolean
  /** One line under the figure: what it compares with, or since when. */
  note?: string
}) {
  const content = <>
    <span className="home-tile-label">{label}</span>
    <span className="home-tile-value">{loading ? <Bar w="60%" h={22} /> : value}</span>
    {note && !loading && <span className="home-tile-note">{note}</span>}
  </>
  if (to.startsWith('https://')) return (
    <a href={to} target="_blank" rel="noopener noreferrer" className={`home-tile home-tile-${tone}`}>
      {content}
    </a>
  )
  return (
    <Link to={to} className={`home-tile home-tile-${tone}`}>
      {content}
    </Link>
  )
}

/**
 * Everything that comes from the books.
 *
 * Split out because the offline build renders the router with no Convex client
 * at all, and a query hook with nothing to ask throws. Mounted only where
 * there is a deployment — the same split the guarantee screen already makes.
 */
/** This month from its 1st, and last month from its 1st to the same day, as local midnights. */
function monthSpans(today: number) {
  const d = new Date(today)
  const monthFrom = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const lastMonthFrom = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime()
  // The same day last month, or that month's last day when it is shorter.
  const lastDay = new Date(d.getFullYear(), d.getMonth(), 0).getDate()
  const lastMonthTo = new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), lastDay)).getTime() + 86_399_999
  return { monthFrom, lastMonthFrom, lastMonthTo }
}

const dayMonth = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const monthName = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { month: 'long' })
const daysSince = (date: number) => Math.max(0, Math.floor((Date.now() - date) / 86_400_000))

/** "₹1,20,000 · 18% more than Oct to the 6th" */
function against(now: number, then: number, lastMonth: string) {
  if (!then) return `${lastMonth} to this day: nothing`
  const change = Math.round(((now - then) / then) * 100)
  if (change === 0) return `Same as ${lastMonth} to this day`
  return `${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} than ${lastMonth} to this day (${rupees(then)})`
}

function FromTheBooks() {
  const today = startOfToday()
  const spans = monthSpans(today)
  // One question, not six. Each of the old ones walked the whole ledger to
  // answer something the others had already read.
  const data = useLive(api.reports.dashboard, { from: today, to: today + 86_399_999, months: 12, ...spans }, `dashboard:v2:${today}`)
  const review = useLive(api.review.counts, {}, 'review:counts')
  const backup = useLive(api.backups.latest, {}, 'backups:latest')
  // A night is missed if the last good copy is more than a day and a half old.
  const backupLate = backup !== undefined &&
    (!backup.lastGood || Date.now() - backup.lastGood.at > 36 * 3_600_000)
  const loading = data === undefined

  const waiting =
    (review?.unread ?? 0) + (review?.ready ?? 0) +
    (data?.unpriced ?? 0) + (backupLate ? 1 : 0)

  // The day's sales are typed up after the day, so how far behind that is
  // matters more than today's figures, which sit at zero until it is done.
  const lastSale = data?.last.sale ?? null
  const behind = lastSale === null ? null : daysSince(lastSale)
  const typedToday = (data?.day.entries ?? 0) > 0
  const lastMonthWord = new Date(spans.lastMonthFrom).toLocaleDateString('en-IN', { month: 'short' })

  return (
    <>
      {!loading && behind !== null && behind > 1 && (
        <Link to="/day" className="home-behind">
          <b>Books written up to {dayMonth(lastSale!)}, {behind} days behind</b>
          <span>
            Last receipt {data.last.receipt ? dayMonth(data.last.receipt) : 'none'}
            {' · '}last payment {data.last.payment ? dayMonth(data.last.payment) : 'none'}
          </span>
        </Link>
      )}

      {typedToday && (
        <>
          <h2 className="home-head">Today</h2>
          <div className="home-grid">
            <Figure label="Sales" value={rupees(data!.day.sales)} to="/day" />
            <Figure label="Received" value={rupees(data!.day.received)} to="/day" />
            <Figure label="Paid" value={rupees(data!.day.paid)} to="/day" />
          </div>
        </>
      )}

      <h2 className="home-head">{monthName(today)} so far</h2>
      <div className="home-grid">
        <Figure label="Sales" value={rupees(data?.month?.sales ?? 0)} to="/day" loading={loading}
          note={data?.month && data.lastMonth ? against(data.month.sales, data.lastMonth.sales, lastMonthWord) : undefined} />
        <Figure label="Received" value={rupees(data?.month?.received ?? 0)} to="/day" loading={loading}
          note={data?.lastMonth ? `${lastMonthWord} to this day: ${rupees(data.lastMonth.received)}` : undefined} />
        <Figure label="Paid" value={rupees(data?.month?.paid ?? 0)} to="/day" loading={loading}
          note={data?.lastMonth ? `${lastMonthWord} to this day: ${rupees(data.lastMonth.paid)}` : undefined} />
      </div>

      <h2 className="home-head">Owed</h2>
      <div className="home-grid">
        <Figure label="Owed to the shop" value={rupees(data?.receivable ?? 0)} to="/ledger/customers" tone="owed" loading={loading} />
        <Figure label="Shop owes" value={rupees(data?.payable ?? 0)} to="/ledger/suppliers" tone="owing" loading={loading} />
        {/* Money held with no bill behind it. The party reports net this into
            the figure beside it, which leaves both true of nobody. */}
        {(data?.customerCredit ?? 0) > 0 && (
          <Figure label="Customer credit held" value={rupees(data!.customerCredit)} to="/ledger/customers" tone="attention" />
        )}
        {(data?.supplierAdvance ?? 0) > 0 && (
          <Figure label="Paid ahead to suppliers" value={rupees(data!.supplierAdvance)} to="/ledger/suppliers" tone="attention" />
        )}
      </div>

      {waiting > 0 && (
        <>
        <h2 className="home-head">Waiting</h2>
        <div className="home-grid">
          {(review?.unread ?? 0) > 0 && (
            <Figure label="Bills to read" value={String(review!.unread)} to="https://shivhardware-sort.vercel.app/" tone="attention" />
          )}
          {(review?.ready ?? 0) > 0 && (
            <Figure label="Bills to price" value={String(review!.ready)} to="https://shivhardware-sort.vercel.app/" tone="attention" />
          )}
          {(data?.unpriced ?? 0) > 0 && (
            <Figure label="Bills with no amount" value={String(data!.unpriced)} to="/day" tone="attention"
              note={data!.unpricedSince ? `Oldest from ${dayMonth(data!.unpricedSince)}` : undefined} />
          )}
          {backupLate && (
            <Figure
              label={backup?.lastGood ? 'Backup missed' : 'No backup yet'}
              value={backup?.lastGood ? since(backup.lastGood.at) : '—'}
              to="/home"
              tone="attention"
            />
          )}
        </div>
        </>
      )}

      {!loading && (
        <>
          {/* Sales month by month and where they are heading, then who to ring
              first and how long their money has sat. A projection of next month
              was here with a range too wide to act on (₹4L to ₹24L), and a chart
              of sales less purchases that the supplier's old history swamped. */}
          <div style={{ marginTop: 18 }}>
            <SalesTrajectory months={data.months} writtenTo={data.last.sale} />
          </div>
          <div className="home-charts">
            <TopBalances title="Owes the shop most" rows={data.topOwing} side="customers" tone="sale" />
            <TopBalances title="Shop owes most" rows={data.topOwed} side="suppliers" tone="purchase" />
          </div>

          {backup?.lastGood && (
            <p className={`home-backup${backupLate ? ' late' : ''}`}>
              Last backup {when(backup.lastGood.at)}
              {backup.lastFull ? ` · photos ${when(backup.lastFull.at)}` : ''}
            </p>
          )}
        </>
      )}
    </>
  )
}

/**
 * What last night's Verify Data found (convex/integrity.ts), in red at the top
 * of the home page until a check finds nothing. Each line opens the bill or
 * voucher to put right; "Check again" runs it there and then.
 */
function BooksCheck() {
  const report = useLive(api.integrity.latest, {}, 'integrity-latest')
  const runNow = useMutation(api.integrity.runNow)
  const [checking, setChecking] = useState(false)
  if (!report || report.problems.length === 0) return null
  const again = async () => {
    setChecking(true)
    try { await runNow({}) } finally { setChecking(false) }
  }
  return (
    <section className="books-check" role="alert">
      <div className="books-check-head">
        <b>{report.problems.length === 1 ? '1 problem in the books' : `${report.problems.length} problems in the books`}</b>
        <span>Checked {when(report.at)}</span>
        <button className="btn ghost" onClick={again} disabled={checking}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>
      <ul>
        {report.problems.map((p, i) => (
          <li key={i}>{p.link ? <Link to={p.link}>{p.text}</Link> : p.text}</li>
        ))}
      </ul>
    </section>
  )
}

export function Home() {
  const dark = useLedgerTheme()
  const { bills } = useStore()

  // A bill that failed to post lives on this PC only, so it is counted here
  // rather than queried — the server has never heard of it.
  const unposted = bills.filter((b) => b.postError).length

  return (
    <div className={`ledger-root min-h-screen ${dark ? 'dark' : ''}`}>
      <div className="app">
        {convexEnabled() && <BooksCheck />}
        {unposted > 0 && (
          <div className="home-grid" style={{ marginBottom: 12 }}>
            <Figure label="Bills not in the books" value={String(unposted)} to="/day" tone="attention" />
          </div>
        )}
        {convexEnabled() ? (
          <FromTheBooks />
        ) : (
          <div className="home-grid">
            <Figure label="Bills on this PC" value={String(bills.length)} to="/day" />
          </div>
        )}
      </div>
    </div>
  )
}
