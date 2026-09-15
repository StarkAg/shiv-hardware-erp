import { Link } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { CreditCard, IndianRupee, Package, ReceiptText, type LucideIcon } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { convexEnabled } from '../../lib/convexSync'
import { rupees } from '../ledger/lib/format'
import { PageHeader } from '../../components/ui'

/**
 * The day's paper, as the shop keeps it by hand.
 *
 * At the counter an A4 sheet is folded into four, and each quarter holds one
 * kind of entry: purchases, payments to suppliers, receipts from customers,
 * and goods sent out. A new hand already knows that sheet. So this is the
 * sheet — ruled, folded, the same four quarters in the same places — and a
 * tap on a quarter opens that voucher. What was entered today is written on
 * its lines, so the paper also shows where each kind of entry went.
 */

type Kind = 'purchase' | 'payment' | 'receipt' | 'sale'

const QUARTERS: { kind: Kind; type: string; title: string; key: string; icon: LucideIcon }[] = [
  { kind: 'purchase', type: 'Purchase', title: 'Purchase', key: 'F9', icon: Package },
  { kind: 'payment', type: 'Payment', title: 'Payment', key: 'F5', icon: CreditCard },
  { kind: 'receipt', type: 'Receipt', title: 'Receipt', key: 'F6', icon: IndianRupee },
  { kind: 'sale', type: 'Sale', title: 'Sale', key: 'F8', icon: ReceiptText },
]

/** Where each quarter's fold lines fall: down the middle, and across it. */
const FOLDS = [
  'border-b md:border-r',
  'border-b',
  'border-b md:border-b-0 md:border-r',
  '',
]

const LINE = 28 // px between rules
const LINES = 12 // rules drawn on each quarter

/** Ruled paper: blue rules, and the red margin line down the left. */
const RULED: React.CSSProperties = {
  backgroundImage: [
    'linear-gradient(to right, transparent 26px, #f1b4b4 26px, #f1b4b4 27px, transparent 27px)',
    `repeating-linear-gradient(to bottom, transparent 0, transparent ${LINE - 1}px, #d5e1ee ${LINE - 1}px, #d5e1ee ${LINE}px)`,
  ].join(', '),
  minHeight: LINE * LINES,
}

type Line = { key: string; party: string; amount: number | null }

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function Quarter({ index, lines }: { index: number; lines?: Line[] }) {
  const q = QUARTERS[index]
  const Icon = q.icon
  const rows = lines ?? []
  const shown = rows.slice(0, LINES)
  const more = rows.length - shown.length
  const total = rows.reduce((t, r) => t + (r.amount ?? 0), 0)

  return (
    <Link
      to={`/bills?new=${q.kind}`}
      aria-label={`New ${q.title}`}
      className={`group flex flex-col border-dashed border-stone-300 p-4 transition-colors hover:bg-amber-50 focus:outline-none focus-visible:bg-amber-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-shiv-green ${FOLDS[index]}`}
    >
      <div className="flex items-center gap-2 pb-1">
        <Icon size={16} className="text-stone-500" aria-hidden="true" />
        <span className="text-base font-bold text-stone-900">{q.title}</span>
        <span className="ml-auto rounded border border-stone-300 px-1.5 text-[11px] font-semibold text-stone-500">{q.key}</span>
      </div>

      <ol className="flex-1" style={RULED}>
        {shown.map((r) => (
          <li
            key={r.key}
            className="flex items-end justify-between gap-3 pl-9 pr-1 text-sm text-stone-800"
            style={{ height: LINE }}
          >
            <span className="truncate pb-1">{r.party}</span>
            <span className="shrink-0 pb-1 tabular-nums">{r.amount === null ? '—' : rupees(r.amount)}</span>
          </li>
        ))}
      </ol>

      <div className="flex items-center justify-between border-t border-stone-400 pt-1 text-sm">
        <span className="text-xs text-stone-500">{more > 0 ? `+${more}` : ''}</span>
        <span className="font-bold tabular-nums text-stone-900">{rupees(total)}</span>
      </div>
    </Link>
  )
}

/** Today's vouchers, sorted onto their quarters in the order they were entered. */
function TodaysPaper() {
  const today = startOfToday()
  const vouchers = useQuery(api.reports.dayBook, { from: today, to: today + 86_399_999 })

  const byType = new Map<string, Line[]>()
  for (const v of [...(vouchers ?? [])].sort((a, b) => (a.createdAt ?? a.date) - (b.createdAt ?? b.date))) {
    const list = byType.get(v.vchType) ?? []
    list.push({ key: v._id, party: v.party, amount: v.status === 'pending' ? null : v.amount ?? null })
    byType.set(v.vchType, list)
  }

  return <Sheet lines={(i) => byType.get(QUARTERS[i].type)} />
}

function Sheet({ lines }: { lines: (index: number) => Line[] | undefined }) {
  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 overflow-hidden rounded-sm bg-[#fffdf8] shadow-md ring-1 ring-stone-300 md:grid-cols-2">
      {QUARTERS.map((q, i) => (
        <Quarter key={q.kind} index={i} lines={lines(i)} />
      ))}
    </div>
  )
}

export function DayPaper() {
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })
  return (
    <div>
      <PageHeader title="Day Paper" subtitle={date} />
      <div className="p-3 md:p-6">
        {/* The offline build has no deployment to ask, so it gets the blank sheet. */}
        {convexEnabled() ? <TodaysPaper /> : <Sheet lines={() => undefined} />}
      </div>
    </div>
  )
}
