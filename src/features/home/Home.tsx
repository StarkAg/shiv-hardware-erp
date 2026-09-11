import { Link } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useStore } from '../../lib/store'
import { convexEnabled } from '../../lib/convexSync'
import { rupees } from '../ledger/lib/format'
import { useLedgerTheme } from '../ledger/useLedgerTheme'
import { Bar } from '../ledger/components/Skeleton'
import { TradeByMonth, TopBalances } from './Charts'
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

/**
 * Everything that comes from the books.
 *
 * Split out because the offline build renders the router with no Convex client
 * at all, and a query hook with nothing to ask throws. Mounted only where
 * there is a deployment — the same split the guarantee screen already makes.
 */
function FromTheBooks() {
  const today = startOfToday()
  // One question, not six. Each of the old ones walked the whole ledger to
  // answer something the others had already read.
  const data = useQuery(api.reports.dashboard, { from: today, to: today + 86_399_999 })
  const review = useQuery(api.review.counts, {})
  const cashWaiting = useQuery(api.cash.unposted, {})
  const loading = data === undefined

  const waiting =
    (review?.unread ?? 0) + (review?.ready ?? 0) +
    (cashWaiting?.length ?? 0) + (data?.unpriced ?? 0)

  return (
    <>
      <div className="home-grid">
        <Figure label="Sales today" value={rupees(data?.day.sales ?? 0)} to="/bills" loading={loading} />
        <Figure label="Received today" value={rupees(data?.day.received ?? 0)} to="/bills" loading={loading} />
        <Figure label="Paid today" value={rupees(data?.day.paid ?? 0)} to="/bills" loading={loading} />
        <Figure label="Entries today" value={String(data?.day.entries ?? 0)} to="/bills" loading={loading} />
      </div>

      <div className="home-grid" style={{ marginTop: 12 }}>
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
        <div className="home-grid home-waiting">
          {(review?.unread ?? 0) > 0 && (
            <Figure label="Bills to read" value={String(review!.unread)} to="/ledger/bills" tone="attention" />
          )}
          {(review?.ready ?? 0) > 0 && (
            <Figure label="Bills to price" value={String(review!.ready)} to="/ledger/bills" tone="attention" />
          )}
          {(data?.unpriced ?? 0) > 0 && (
            <Figure label="Vouchers with no amount" value={String(data!.unpriced)} to="/ledger/bills" tone="attention" />
          )}
          {(cashWaiting?.length ?? 0) > 0 && (
            <Figure label="Cash notes without a party" value={String(cashWaiting!.length)} to="/cash-review" tone="attention" />
          )}
        </div>
      )}

      {!loading && (
        <div className="home-charts">
          <TradeByMonth months={data.months} />
          <div className="home-stack">
            <TopBalances title="Owes the shop most" rows={data.topOwing} side="customers" tone="sale" />
            <TopBalances title="Shop owes most" rows={data.topOwed} side="suppliers" tone="purchase" />
          </div>
        </div>
      )}
    </>
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
        {unposted > 0 && (
          <div className="home-grid" style={{ marginBottom: 12 }}>
            <Figure label="Bills not in the books" value={String(unposted)} to="/bills" tone="attention" />
          </div>
        )}
        {convexEnabled() ? (
          <FromTheBooks />
        ) : (
          <div className="home-grid">
            <Figure label="Bills on this PC" value={String(bills.length)} to="/bills" />
          </div>
        )}
      </div>
    </div>
  )
}
