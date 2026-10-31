import { useLayoutEffect, useRef, useState } from 'react'
import { workingDate } from '../../lib/businessDate'
import { useMutation } from 'convex/react'
import { useLive } from '../ledger/lib/cache'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CreditCard, DoorClosed, DoorOpen, IndianRupee, Package, ReceiptText, type LucideIcon } from 'lucide-react'
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
 *
 * The sheet fills the window and never scrolls: each quarter writes as many
 * lines as fit and counts the rest ("+3"). A day the shop did not open can be
 * marked Shop closed here; that is the attendance app's own "Shop closed"
 * (every staff member marked C), so the two always agree.
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

/** Ruled paper: blue rules, and the red margin line down the left. */
const RULED: React.CSSProperties = {
  backgroundImage: [
    'linear-gradient(to right, transparent 26px, #f1b4b4 26px, #f1b4b4 27px, transparent 27px)',
    `repeating-linear-gradient(to bottom, transparent 0, transparent ${LINE - 1}px, #d5e1ee ${LINE - 1}px, #d5e1ee ${LINE}px)`,
  ].join(', '),
}

/** How many ruled lines fit in an element, kept up to date as it is resized. */
function useLinesThatFit<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [lines, setLines] = useState(8)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => setLines(Math.max(1, Math.floor(el.clientHeight / LINE)))
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  return [ref, lines] as const
}

/**
 * The height from an element's top to the bottom of the window, so what is in
 * it fits in one view whatever the header above it measures.
 */
function useFillWindow<T extends HTMLElement>(gap = 12) {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState<number>()
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current
      if (!el) return
      // On a phone the panel's nav sits along the foot, inside main's padding.
      const main = el.closest('main')
      const foot = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0
      setHeight(Math.max(360, Math.floor(window.innerHeight - el.getBoundingClientRect().top - foot - gap)))
    }
    measure()
    window.addEventListener('resize', measure)
    const watch = new ResizeObserver(measure)
    watch.observe(document.body)
    return () => { window.removeEventListener('resize', measure); watch.disconnect() }
  }, [gap])
  return [ref, height] as const
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
  /** Why this line is marked: a sale with no money for it, or money with no sale, that day. */
  unpaid?: string
}

/**
 * Sales and receipts that do not answer for each other that day.
 *
 * Each sale looks for a receipt of the same amount from the same party, and a
 * receipt answers for one sale only. What is left over is settled party by
 * party: a sale is paid when that party's other receipts that day add up to
 * it (11,384 sold, paid as 3,000 and 8,384), and a receipt is matched when
 * that party's other sales that day add up to it. Whatever is still short on
 * either side is marked: a sale with no money for it, or money with no sale
 * for it that day. A credit sale, or money paid against an older bill, is
 * meant to stay marked; the mark is there so a missing entry is seen the same
 * day.
 */
function markUnmatched(sales: Line[] | undefined, receipts: Line[] | undefined) {
  const leftReceipts = [...(receipts ?? [])].filter((r) => r.amount && r.amount > 0)
  const leftSales: Line[] = []
  for (const sale of sales ?? []) {
    if (!(sale.amount && sale.amount > 0)) continue
    const at = leftReceipts.findIndex((r) => r.partyId === sale.partyId && Math.abs((r.amount ?? 0) - sale.amount!) < 0.5)
    if (at === -1) leftSales.push(sale)
    else leftReceipts.splice(at, 1)
  }
  const sum = (lines: Line[], party?: string) => lines.filter((l) => l.partyId === party).reduce((t, l) => t + (l.amount ?? 0), 0)
  for (const sale of leftSales) {
    if (sum(leftReceipts, sale.partyId) + 0.5 < sum(leftSales, sale.partyId)) sale.unpaid = 'No receipt for this sale today'
  }
  for (const receipt of leftReceipts) {
    if (sum(leftSales, receipt.partyId) + 0.5 < sum(leftReceipts, receipt.partyId)) receipt.unpaid = 'No sale for this receipt today'
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
    case 'Advance':
      return { type: supplier ? 'Payment' : 'Receipt', tag: 'ADV' }
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
  const [ruled, fit] = useLinesThatFit<HTMLOListElement>()
  const shown = rows.slice(0, fit)
  const more = rows.length - shown.length
  const total = rows.reduce((t, r) => t + (r.amount ?? 0), 0)
  const fresh = `/bills?new=${q.kind}`

  // The quarter still opens a new voucher when tapped anywhere off its lines;
  // a line opens its party's account instead.
  return (
    <div
      onClick={() => navigate(fresh)}
      className={`group flex min-h-0 cursor-pointer flex-col border-dashed border-stone-300 p-3 transition-colors hover:bg-amber-50/60 ${FOLDS[index]}`}
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

      <ol ref={ruled} className="min-h-0 flex-1 overflow-hidden" style={RULED}>
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
          // Red: a sale not paid for, or a bill with no price on it yet.
          const unpriced = r.amount === null
          const tone = r.unpaid || unpriced ? 'text-red-700 bg-red-50/70 hover:bg-red-100' : 'text-stone-800 hover:bg-amber-100'
          const cls = `group/line flex items-end justify-between gap-3 rounded-sm pl-9 pr-1 text-sm transition-colors ${tone}`
          return (
            <li key={r.key} style={{ height: LINE }}>
              {r.to ? (
                <Link
                  to={r.to}
                  onClick={(e) => e.stopPropagation()}
                  title={r.unpaid ? `${r.party}: ${r.unpaid}` : unpriced ? `${r.party}: not priced yet` : `Open ${r.party}'s account`}
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
        <span className="text-xs font-semibold text-stone-500" title={more > 0 ? `${more} more not shown; open the Day Book for all of them` : undefined}>{more > 0 ? `+${more} more` : ''}</span>
        <span className="font-bold tabular-nums text-stone-900">{rupees(total)}</span>
      </div>
    </div>
  )
}

/** One day's vouchers, sorted onto their quarters in the order they were entered. */
function PaperFor({ day }: { day: string }) {
  const { closed } = useShopClosed(day)
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

  markUnmatched(byType.get('Sale'), byType.get('Receipt'))

  return (
    <>
      <Sheet lines={(i) => byType.get(QUARTERS[i].type)} closed={closed} />
      <Others lines={byType.get(OTHER)} />
    </>
  )
}

function Sheet({ lines, closed }: { lines: (index: number) => Line[] | undefined; closed?: boolean }) {
  return (
    <div className="relative mx-auto grid min-h-0 w-full max-w-5xl flex-1 grid-cols-2 grid-rows-2 overflow-hidden rounded-sm bg-[#fffdf8] shadow-md ring-1 ring-stone-300">
      {QUARTERS.map((q, i) => (
        <Quarter key={q.kind} index={i} lines={lines(i)} />
      ))}
      {/* Crossed out corner to corner, the way a closed day's sheet is cut by hand. */}
      {closed && (
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
            <line x1="0" y1="0" x2="100" y2="100" stroke="#b91c1c" strokeOpacity="0.75" strokeWidth="3" vectorEffect="non-scaling-stroke" />
            <line x1="100" y1="0" x2="0" y2="100" stroke="#b91c1c" strokeOpacity="0.75" strokeWidth="3" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-md border-2 border-red-700/70 bg-[#fffdf8] px-4 py-1.5 text-2xl font-black uppercase tracking-[0.2em] text-red-700 md:text-4xl">
              Shop closed
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The day's other entries, under the sheet, only when there are any: one row
 * of chips, so the sheet keeps its one view. What does not fit is counted.
 */
function Others({ lines }: { lines?: Line[] }) {
  if (!lines?.length) return null
  const shown = lines.slice(0, 6)
  const more = lines.length - shown.length
  return (
    <div className="mx-auto mt-2 flex w-full max-w-5xl flex-none items-center gap-2 overflow-hidden rounded-sm bg-[#fffdf8] px-3 py-1.5 shadow-sm ring-1 ring-stone-300">
      <span className="shrink-0 text-sm font-bold text-stone-900">Other</span>
      {shown.map((r) => (
        <Link
          key={r.key}
          to={r.to ?? '#'}
          className={`flex min-w-0 shrink items-center gap-1.5 rounded border px-1.5 py-0.5 text-xs ${r.amount === null ? 'border-red-200 bg-red-50/70 text-red-700 hover:bg-red-100' : 'border-stone-200 text-stone-800 hover:bg-amber-100'}`}
        >
          {r.tag && <span className="shrink-0 text-[10px] font-bold text-stone-500">{r.tag}</span>}
          <span className="min-w-0 truncate">{r.party}</span>
          <span className="shrink-0 tabular-nums">{r.amount === null ? '—' : rupees(r.amount)}</span>
        </Link>
      ))}
      {more > 0 && <span className="shrink-0 text-xs font-semibold text-stone-500">+{more}</span>}
    </div>
  )
}

/**
 * Whether the shop was shut that day, from attendance: every staff member
 * marked C. A Tuesday is the weekly day off, so it is shut unless it was
 * opened (Mark open) or someone is marked on it, the attendance app's own rule.
 *
 * Marking a day closed marks every staff member C (the attendance app's "Shop
 * closed"). Opening a Tuesday says so on the day and leaves the marks for the
 * attendance app; opening any other day clears its C marks to be filled in.
 * A day with anyone already marked present asks before it is closed.
 */
const isTuesday = (day: string) => new Date(startOf(day)).getDay() === 2

function useShopClosed(day: string) {
  const staff = useLive(api.attendance.getStaff, {}, 'attendance-staff') as string[] | undefined
  const month = useLive(api.attendance.getMonth, { month: day.slice(0, 7) }, `attendance-month:${day.slice(0, 7)}`) as { date: string; marks: Record<string, string>; shopOpen?: boolean }[] | undefined
  const setDay = useMutation(api.attendance.setDay)
  const setShopOpen = useMutation(api.attendance.setShopOpen)
  const row = month?.find((d) => d.date === day)
  const marks = row?.marks ?? {}
  const tue = isTuesday(day)
  const ready = staff !== undefined && month !== undefined
  const closed = ready && staff.length > 0 && !(tue && row?.shopOpen)
    && staff.every((name) => marks[name] === 'C' || (tue && !marks[name]))
  const marked = Object.values(marks).filter((m) => m === 'P' || m === 'H').length
  const toggle = async () => {
    if (!ready) return
    if (closed) {
      if (tue) { await setShopOpen({ date: day, open: true }); return }
      if (!window.confirm('Mark the shop open on this day? Attendance for the day is cleared, to be marked again.')) return
      await setDay({ date: day, marks: {} })
      return
    }
    if (marked > 0 && !window.confirm(`${marked} staff ${marked === 1 ? 'is' : 'are'} marked present on this day. Mark the shop closed anyway?`)) return
    await setDay({ date: day, marks: Object.fromEntries(staff.map((name) => [name, 'C'])) })
    if (tue && row?.shopOpen) await setShopOpen({ date: day, open: false })
  }
  return { ready, closed, tue, toggle }
}

/** Marks the day Shop closed, or open again. Only with a deployment to write to. */
function ShopClosedButton({ day }: { day: string }) {
  const shop = useShopClosed(day)
  const [busy, setBusy] = useState(false)
  const toggle = async () => {
    setBusy(true)
    try { await shop.toggle() } catch (err) { window.alert(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) }
  }
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={!shop.ready || busy}
      title={shop.closed
        ? (shop.tue ? 'Tuesdays are closed. The shop opened on this one' : 'The shop was open on this day after all')
        : 'Mark every staff member C for this day, as the attendance app does'}
      className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold disabled:opacity-50 ${shop.closed
        ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-400/40 dark:bg-red-950/40 dark:text-red-200'
        : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100 dark:border-white/15 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700'}`}
    >
      {shop.closed ? <DoorOpen size={16} aria-hidden="true" /> : <DoorClosed size={16} aria-hidden="true" />}
      {shop.closed ? 'Mark open' : 'Shop closed'}
    </button>
  )
}

const ARROW =
  'flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700'

export function DayPaper() {
  const [params, setParams] = useSearchParams()
  const today = isoDay(new Date())
  const asked = params.get('date')
  // A day later than today has no paper yet, and a mistyped one is today's.
  // Opened without a day, it shows the working date picked in the sidebar.
  const day = validDay(asked) && asked! <= today ? asked! : (workingDate() ?? today)
  const onToday = day === today

  const go = (next: string) => {
    if (next > today) return
    setParams(next === today ? {} : { date: next }, { replace: true })
  }

  const label = new Date(startOf(day)).toLocaleDateString('en-GB', {
    weekday: 'long', day: '2-digit', month: 'short', year: 'numeric',
  })
  const [fill, height] = useFillWindow<HTMLDivElement>()

  return (
    <div>
      <PageHeader
        title="Day Paper"
        subtitle={onToday ? `Today · ${label}` : label}
        actions={
          <div className="flex items-center gap-2">
            {convexEnabled() && <ShopClosedButton day={day} />}
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
      <div ref={fill} className="flex flex-col overflow-hidden px-3 pt-3 md:px-6 md:pt-4" style={{ height }}>
        {/* The offline build has no deployment to ask, so it gets the blank sheet. */}
        {convexEnabled() ? <PaperFor day={day} /> : <Sheet lines={() => undefined} />}
      </div>
    </div>
  )
}
