import { useLive } from '../ledger/lib/cache'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CreditCard, IndianRupee, Package, ReceiptText, type LucideIcon } from 'lucide-react'
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
 * tap on a quarter opens that voucher. What was entered on the day is written
 * on its lines, so the paper also shows where each kind of entry went.
 *
 * The arrows turn to the day before or after, the way the pile of old sheets
 * is leafed through. The day is kept in the address, so a reload stays on it.
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

type Line = {
  key: string
  party: string
  amount: number | null
  tag?: string
  item?: string
  /** The party's ledger, which the line opens. */
  to?: string
  partyId?: string
  /** A sale with no receipt of the same amount from the same party that day. */
  unpaid?: boolean
}

/**
 * Sales with nothing received for them that day.
 *
 * Each sale looks for a receipt of the same amount from the same party, and a
 * receipt answers for one sale only, so two ₹500 sales and one ₹500 receipt
 * leave one of them marked. A sale left over is still paid when the party's
 * other receipts that day add up to it: ₹11,384 sold and paid as ₹3,000 and
 * ₹8,384 is settled, not unpaid. A credit sale is meant to stay marked; the
 * mark is there so a cash sale whose receipt was never written is seen the
 * same day.
 */
function markUnpaid(sales: Line[] | undefined, receipts: Line[] | undefined) {
  const left = [...(receipts ?? [])]
  const unmatched: Line[] = []
  for (const sale of sales ?? []) {
    if (!(sale.amount && sale.amount > 0)) continue
    const at = left.findIndex((r) => r.partyId === sale.partyId && Math.abs((r.amount ?? 0) - sale.amount!) < 0.5)
    if (at === -1) unmatched.push(sale)
    else left.splice(at, 1)
  }
  // What is left, party by party: the receipts against the sales.
  const sum = (lines: Line[], party?: string) => lines.filter((l) => l.partyId === party).reduce((t, l) => t + (l.amount ?? 0), 0)
  for (const sale of unmatched) {
    if (sum(left, sale.partyId) + 0.5 < sum(unmatched, sale.partyId)) sale.unpaid = true
  }
}

/** Entries that belong on none of the four quarters: discounts, journals, expenses. */
const OTHER = 'Other'

/**
 * Where an entry is written on the sheet. Every kind lands somewhere — a page
 * that leaves entries off is a page nobody can trust.
 *
 * The four kinds go on their own quarters. The rest go where the counter would
 * write them by hand, marked so they read for what they are: goods that came
 * in before their bill on the purchases (GRN), carrying the first thing that
 * came since there is no amount yet; a goods return on the side it came from
 * or went back to (RET), taken off that quarter's total; a refund with the
 * payments (REF), since it is money handed out. Anything else is listed under
 * the sheet.
 */
function placeOf(v: { vchType: string; vchLabel: string; partyGroup?: string }): { type: string; tag?: string; minus?: boolean } {
  const supplier = v.partyGroup === 'Sundry Creditors'
  switch (v.vchType) {
    case 'Purchase': case 'Payment': case 'Receipt': case 'Sale':
      return { type: v.vchType }
    case 'Goods Received':
      return { type: 'Purchase', tag: 'GRN' }
    case 'Goods Return': case 'Purchase Return':
      return { type: supplier ? 'Purchase' : 'Sale', tag: 'RET', minus: true }
    case 'Refund':
      return { type: 'Payment', tag: 'REF' }
    default:
      return { type: OTHER, tag: v.vchLabel.split('-')[0] }
  }
}

/**
 * Where the money taken with a bill is written as well. A sale paid at the
 * counter is one entry, but on the sheet it is two lines — the sale, and the
 * cash received for it — so it is on the receipts too; a purchase paid on the
 * spot goes on the payments the same way.
 */
const PAID_ON: Record<string, string> = { Sale: 'Receipt', Purchase: 'Payment' }

/** A calendar day as the shop's clock has it, "2026-09-15". */
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Midnight at the start of that day, local time. */
const startOf = (day: string) => Date.parse(`${day}T00:00:00`)

/** The day `by` days from `day`. */
const shift = (day: string, by: number) => {
  const d = new Date(startOf(day))
  d.setDate(d.getDate() + by)
  return isoDay(d)
}

const validDay = (day: string | null) => !!day && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(startOf(day))

function Quarter({ index, lines }: { index: number; lines?: Line[] }) {
  const q = QUARTERS[index]
  const Icon = q.icon
  const navigate = useNavigate()
  const rows = lines ?? []
  const shown = rows.slice(0, LINES)
  const more = rows.length - shown.length
  const total = rows.reduce((t, r) => t + (r.amount ?? 0), 0)
  const fresh = `/bills?new=${q.kind}`

  // The quarter still opens a new voucher when tapped anywhere off its lines;
  // a line opens its party's account instead.
  return (
    <div
      onClick={() => navigate(fresh)}
      className={`group flex cursor-pointer flex-col border-dashed border-stone-300 p-4 transition-colors hover:bg-amber-50/60 ${FOLDS[index]}`}
    >
      <Link
        to={fresh}
        aria-label={`New ${q.title}`}
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-2 rounded pb-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-shiv-green"
      >
        <Icon size={16} className="text-stone-500" aria-hidden="true" />
        <span className="text-base font-bold text-stone-900">{q.title}</span>
        <span className="ml-auto rounded border border-stone-300 px-1.5 text-[11px] font-semibold text-stone-500">{q.key}</span>
      </Link>

      <ol className="flex-1" style={RULED}>
        {shown.map((r) => {
          const body = (
            <>
              <span className={`flex min-w-0 items-center gap-1.5 pb-1 ${r.item ? 'max-w-[50%] shrink-0' : ''}`}>
                {r.tag && (
                  <span className="shrink-0 rounded border border-amber-400 bg-amber-50 px-1 text-[10px] font-bold leading-4 text-amber-700">
                    {r.tag}
                  </span>
                )}
                <span className="truncate group-hover/line:underline">{r.party}</span>
              </span>
              {r.item ? (
                <span className="min-w-0 truncate pb-1 text-right text-stone-500" title={r.item}>{r.item}</span>
              ) : (
                <span className="shrink-0 pb-1 tabular-nums">{r.amount === null ? '—' : rupees(r.amount)}</span>
              )}
            </>
          )
          const tone = r.unpaid ? 'text-red-700 bg-red-50/70 hover:bg-red-100' : 'text-stone-800 hover:bg-amber-100'
          const cls = `group/line flex items-end justify-between gap-3 rounded-sm pl-9 pr-1 text-sm transition-colors ${tone}`
          return (
            <li key={r.key} style={{ height: LINE }}>
              {r.to ? (
                <Link
                  to={r.to}
                  onClick={(e) => e.stopPropagation()}
                  title={r.unpaid ? `${r.party} — no receipt of this amount today` : `Open ${r.party}'s account`}
                  className={`${cls} h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-shiv-green`}
                >
                  {body}
                </Link>
              ) : (
                <div className={`${cls} h-full`}>{body}</div>
              )}
            </li>
          )
        })}
      </ol>

      <div className="flex items-center justify-between border-t border-stone-400 pt-1 text-sm">
        <span className="text-xs text-stone-500">{more > 0 ? `+${more}` : ''}</span>
        <span className="font-bold tabular-nums text-stone-900">{rupees(total)}</span>
      </div>
    </div>
  )
}

/** One day's vouchers, sorted onto their quarters in the order they were entered. */
function PaperFor({ day }: { day: string }) {
  const from = startOf(day)
  const vouchers = useLive(api.reports.dayBook, { from, to: from + 86_399_999 }, `daypaper:${from}`)

  const byType = new Map<string, Line[]>()
  for (const v of [...(vouchers ?? [])].sort((a, b) => (a.createdAt ?? a.date) - (b.createdAt ?? b.date))) {
    const place = placeOf(v)
    const type = place.type
    const amount = v.status === 'final' && v.amount != null ? (place.minus ? -v.amount : v.amount) : null
    const list = byType.get(type) ?? []
    const to = v.partyLedgerId
      ? `/ledger/${v.partyGroup === 'Sundry Creditors' ? 'suppliers' : 'customers'}/${v.partyLedgerId}`
      : undefined
    list.push({
      to,
      partyId: v.partyLedgerId,
      key: v._id,
      party: v.party,
      amount,
      tag: place.tag,
      item: v.firstItem ? `${v.firstItem.text}${v.firstItem.more > 0 ? ` +${v.firstItem.more}` : ''}` : undefined,
    })
    byType.set(type, list)

    const paidOn = PAID_ON[v.vchType]
    if (paidOn && v.status === 'final' && v.settled > 0) {
      const paid = byType.get(paidOn) ?? []
      paid.push({ key: `${v._id}-paid`, party: v.party, amount: v.settled, to, partyId: v.partyLedgerId })
      byType.set(paidOn, paid)
    }
  }

  markUnpaid(byType.get('Sale'), byType.get('Receipt'))

  return (
    <>
      <Sheet lines={(i) => byType.get(QUARTERS[i].type)} />
      <Others lines={byType.get(OTHER)} />
    </>
  )
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

/** The day's other entries, under the sheet — only when there are any. */
function Others({ lines }: { lines?: Line[] }) {
  if (!lines?.length) return null
  return (
    <div className="mx-auto mt-3 max-w-5xl rounded-sm bg-[#fffdf8] p-4 shadow-sm ring-1 ring-stone-300">
      <div className="pb-1 text-sm font-bold text-stone-900">Other entries</div>
      <ul className="divide-y divide-dashed divide-stone-200">
        {lines.map((r) => (
          <li key={r.key}>
            <Link
              to={r.to ?? '#'}
              className="flex items-center gap-2 rounded-sm px-1 py-1.5 text-sm text-stone-800 hover:bg-amber-100"
            >
              {r.tag && (
                <span className="shrink-0 rounded border border-stone-300 px-1 text-[10px] font-bold leading-4 text-stone-600">{r.tag}</span>
              )}
              <span className="min-w-0 flex-1 truncate">{r.party}</span>
              <span className="shrink-0 tabular-nums">{r.amount === null ? '—' : rupees(r.amount)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

const ARROW =
  'flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700'

export function DayPaper() {
  const [params, setParams] = useSearchParams()
  const today = isoDay(new Date())
  const asked = params.get('date')
  // A day later than today has no paper yet, and a mistyped one is today's.
  const day = validDay(asked) && asked! <= today ? asked! : today
  const onToday = day === today

  const go = (next: string) => {
    if (next > today) return
    setParams(next === today ? {} : { date: next }, { replace: true })
  }

  const label = new Date(startOf(day)).toLocaleDateString('en-GB', {
    weekday: 'long', day: '2-digit', month: 'short', year: 'numeric',
  })

  return (
    <div>
      <PageHeader
        title="Day Paper"
        subtitle={onToday ? `Today · ${label}` : label}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" className={ARROW} onClick={() => go(shift(day, -1))} aria-label="Previous day" title="Previous day">
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            {!onToday && (
              <button
                type="button"
                className="h-9 rounded-lg border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-700 hover:bg-stone-100 dark:border-white/15 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
                onClick={() => go(today)}
              >
                Today
              </button>
            )}
            <button type="button" className={ARROW} onClick={() => go(shift(day, 1))} disabled={onToday} aria-label="Next day" title="Next day">
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        }
      />
      <div className="p-3 md:p-6">
        {/* The offline build has no deployment to ask, so it gets the blank sheet. */}
        {convexEnabled() ? <PaperFor day={day} /> : <Sheet lines={() => undefined} />}
      </div>
    </div>
  )
}
