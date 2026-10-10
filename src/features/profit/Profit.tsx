import { useLive } from '../ledger/lib/cache'
import { Fragment, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, CircleAlert, Pencil, TrendingUp } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { useStore } from '../../lib/store'
import { PageHeader, Page, Card, DropDown } from '../../components/ui'
import { rupees } from '../ledger/lib/format'
import {
  byBill,
  byDay,
  byItem,
  gaps,
  leftOut,
  profitLines,
  purchasedItems,
  totalsOf,
  within,
  type CostOverride,
  type GapReason,
  type SameGoods,
  type ItemRow,
  type ProfitLine,
  type Totals,
} from '../../lib/profit'
import { SetCost } from './SetCost'
import { indiaToday } from '../../lib/businessDate'

/**
 * Profit, item by item and bill by bill.
 *
 * The shop keeps no stock ledger, so nothing here is a stock valuation. It is
 * the one thing the bills can honestly be asked: what did this go out at, what
 * did it come in at, and what is the difference. Where the second question has
 * no answer the line is not costed and not counted — it goes to Needs a cost,
 * with the reason, and the shop settles it there in a few seconds.
 *
 * Every figure on this page is goods only. Fare charged for delivery is shown
 * beside a bill but never added to its profit: the money goes to the toto.
 */

const pc = (n: number) => `${(n * 100).toFixed(1)}%`

/** A calendar day the way the bills carry it, "2026-09-17". */
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const monthOf = (d: Date) => ({
  from: isoDay(new Date(d.getFullYear(), d.getMonth(), 1)),
  to: isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
})

const VIEWS = [
  ['items', 'Items'],
  ['bills', 'Bills'],
  ['days', 'Days'],
  ['gaps', 'Needs a cost'],
] as const

const WHY: Record<GapReason, string> = {
  'never-bought': 'Never bought here',
  lump: 'Entered as one amount',
  'different-unit': 'Bought by a different unit',
  'rate-looks-wrong': 'Purchase rate looks wrong',
}

/** A figure that is a loss reads red; nothing else is coloured. */
const Money = ({ n, bold = false }: { n: number; bold?: boolean }) => (
  <span className={`tabular-nums ${bold ? 'font-semibold' : ''} ${n < 0 ? 'text-shiv-red' : ''}`}>
    {rupees(n)}
  </span>
)

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums">{value}</div>
      {note && <div className="text-xs text-muted">{note}</div>}
    </Card>
  )
}

/** The head of every table here: what sold, what it cost, what is left. */
const MoneyHead = () => (
  <>
    <th className="px-3 py-2 text-right">Sales</th>
    <th className="px-3 py-2 text-right">Cost</th>
    <th className="px-3 py-2 text-right">Profit</th>
    <th className="px-3 py-2 text-right">Margin</th>
  </>
)

const MoneyCells = ({ t }: { t: Totals }) => (
  <>
    <td className="px-3 py-2 text-right"><Money n={t.costedSales} /></td>
    <td className="px-3 py-2 text-right text-muted"><Money n={t.cost} /></td>
    <td className="px-3 py-2 text-right"><Money n={t.profit} bold /></td>
    <td className="px-3 py-2 text-right tabular-nums text-muted">{t.costedSales ? pc(t.margin) : '—'}</td>
  </>
)

/** The lines of a bill, or of an item, opened out underneath its row. */
function Lines({ rows, show }: { rows: ProfitLine[]; show: 'item' | 'bill' }) {
  return (
    <div className="space-y-1 px-3 py-2 text-xs">
      {rows.map((r, i) => (
        <div key={`${r.billId}:${r.name}:${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="min-w-0 flex-1 truncate">
            {show === 'bill' ? (
              <>
                <span className="font-medium">{r.name}</span>
                <span className="text-muted"> · {r.qty} {r.unit || 'Pc'}</span>
              </>
            ) : (
              <>
                <span className="font-medium">
                  {r.kind === 'return' ? 'Return' : 'Bill'} {r.number}
                </span>
                <span className="text-muted"> · {r.date} · {r.party || '—'} · {r.qty} {r.unit || 'Pc'}</span>
              </>
            )}
          </span>
          {r.gap ? (
            <span className="shrink-0 text-muted">
              {rupees(r.sales)} · {WHY[r.gap].toLowerCase()}
            </span>
          ) : (
            <span className="shrink-0 tabular-nums">
              {rupees(r.sales)} − {rupees(r.cost)} = <span className="font-semibold">{rupees(r.sales - r.cost)}</span>
              {r.dated === 'earliest' && <span className="text-muted"> · earliest rate</span>}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

export function Profit() {
  const bills = useStore((s) => s.bills)
  const saved = useLive(api.itemCosts.all, {}, 'item-costs')
  const paired = useLive(api.itemSame.all, {}, 'item-same')
  const masters = useLive(api.masters.all, {}, 'masters')
  const suppliers = useMemo(
    () => new Set((masters?.ledgers ?? []).filter((l: any) => l.groupName === 'Sundry Creditors').map((l: any) => String(l._id))),
    [masters],
  )
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<ItemRow | null>(null)
  const [sort, setSort] = useState('profit')

  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const view = (params.get('view') ?? 'items') as (typeof VIEWS)[number][0]

  const setParam = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) {
      if (v) merged.set(k, v)
      else merged.delete(k)
    }
    setParams(merged, { replace: true })
    setOpen(null)
  }

  const costs: CostOverride[] = useMemo(
    () => (saved ?? []).map((o) => ({ ref: o.ref, cost: o.cost, sameAs: o.sameAs, per: o.per })),
    [saved],
  )
  const same: SameGoods[] = useMemo(
    () => (paired ?? []).map((p) => ({ from: p.from, to: p.to })),
    [paired],
  )
  const savedByRef = useMemo(() => new Map((saved ?? []).map((o) => [o.ref, o])), [saved])
  const pairedByRef = useMemo(() => new Map((paired ?? []).map((p) => [p.from, p])), [paired])

  const all = useMemo(() => profitLines(bills, { costs, same, suppliers }), [bills, costs, same, suppliers])
  const lines = useMemo(() => within(all, from, to), [all, from, to])
  const purchases = useMemo(() => purchasedItems(bills, same), [bills, same])

  const totals = totalsOf(lines)
  const items = useMemo(() => {
    const rows = byItem(lines).filter((r) => !r.gap)
    const order: Record<string, (a: ItemRow, b: ItemRow) => number> = {
      profit: (a, b) => b.profit - a.profit,
      sales: (a, b) => b.costedSales - a.costedSales,
      margin: (a, b) => b.margin - a.margin,
      name: (a, b) => a.name.localeCompare(b.name),
    }
    return [...rows].sort(order[sort] ?? order.profit)
  }, [lines, sort])
  const billRows = useMemo(() => byBill(lines, bills), [lines, bills])
  const dayRows = useMemo(() => byDay(lines), [lines])
  const gapRows = useMemo(() => gaps(lines), [lines])
  const refused = useMemo(
    () => leftOut(bills.filter((b) => (!from || b.date >= from) && (!to || b.date <= to))),
    [bills, from, to],
  )

  // India's day, read as a local date so the month arithmetic below holds.
  const today = new Date(`${indiaToday()}T00:00:00`)
  const thisMonth = monthOf(today)
  const lastMonth = monthOf(new Date(today.getFullYear(), today.getMonth() - 1, 1))
  const periods: [string, string, string][] = [
    ['All', '', ''],
    ['This month', thisMonth.from, thisMonth.to],
    ['Last month', lastMonth.from, lastMonth.to],
    ['Today', isoDay(today), isoDay(today)],
  ]

  return (
    <>
      <PageHeader
        title="Profit"
        subtitle="What the shop made on what it sold. Goods only — fare is never counted."
      >
        <div className="flex flex-wrap items-end gap-2">
          {periods.map(([label, f, t]) => (
            <button
              key={label}
              onClick={() => setParam({ from: f, to: t })}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                from === f && to === t
                  ? 'bg-shiv-green text-stone-950'
                  : 'border border-stone-300 text-stone-600 hover:bg-stone-100 dark:border-white/15 dark:text-stone-300 dark:hover:bg-white/10'
              }`}
            >
              {label}
            </button>
          ))}
          <label className="ml-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setParam({ from: e.target.value })}
              className="rounded-lg border border-stone-300 bg-stone-50 px-2 py-1 text-xs dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setParam({ to: e.target.value })}
              className="rounded-lg border border-stone-300 bg-stone-50 px-2 py-1 text-xs dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
            />
          </label>
        </div>
      </PageHeader>

      <Page>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Figure label="Sold" value={rupees(totals.sales)} note={`${totals.lines} lines`} />
          <Figure label="Costed" value={rupees(totals.costedSales)} note={`${pc(totals.coverage)} of sales`} />
          <Figure label="Cost" value={rupees(totals.cost)} note={`${totals.costedLines} lines matched`} />
          <Figure label="Gross profit" value={rupees(totals.profit)} note="on the costed part" />
          <Figure label="Margin" value={totals.costedSales ? pc(totals.margin) : '—'} note="profit over costed sales" />
        </div>

        {refused.count > 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-50 px-4 py-3 text-sm dark:border-red-300/20 dark:bg-red-500/10">
            <CircleAlert size={16} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
            <p>
              {refused.count} {refused.count === 1 ? 'bill' : 'bills'} not in the books ({rupees(refused.value)}), not counted.
            </p>
          </div>
        )}

        {totals.coverage < 0.9 && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-50 px-4 py-3 text-sm dark:border-amber-300/20 dark:bg-amber-500/10">
            <CircleAlert size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p>
              {rupees(totals.sales - totals.costedSales)} of selling has no cost behind it, so no profit
              is shown on it. <button className="font-semibold underline" onClick={() => setParam({ view: 'gaps' })}>
                See what is missing
              </button>
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav className="flex flex-wrap gap-1">
            {VIEWS.map(([id, label]) => (
              <button
                key={id}
                onClick={() => setParam({ view: id })}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  view === id
                    ? 'bg-shiv-green text-stone-950'
                    : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/10'
                }`}
              >
                {label}
                {id === 'gaps' && gapRows.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-stone-900/10 px-1.5 py-0.5 text-[11px] dark:bg-white/15">
                    {gapRows.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
          {view === 'items' && (
            <div className="w-44">
              <DropDown
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'profit', label: 'Most profit' },
                  { value: 'sales', label: 'Most sold' },
                  { value: 'margin', label: 'Best margin' },
                  { value: 'name', label: 'By name' },
                ]}
              />
            </div>
          )}
        </div>

        <Card className="overflow-x-auto">
          {view === 'items' && (
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-card2 text-left text-xs uppercase text-muted dark:bg-white/5">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <MoneyHead />
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <Fragment key={row.ref}>
                    <tr
                      className="cursor-pointer border-t border-line hover:bg-stone-100/60 dark:border-white/10 dark:hover:bg-white/5"
                      onClick={() => setOpen(open === row.ref ? null : row.ref)}
                    >
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5">
                          {open === row.ref ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
                          <span className="font-medium">{row.name}</span>
                          {savedByRef.has(row.ref) || pairedByRef.has(row.ref) && (
                            <span className="rounded bg-shiv-green/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase">set by hand</span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.qty} {row.unit || 'Pc'}</td>
                      <MoneyCells t={row} />
                      <td className="px-3 py-2 text-right">
                        <button
                          className="rounded p-1 text-muted hover:bg-stone-200 dark:hover:bg-white/10"
                          onClick={(e) => { e.stopPropagation(); setEditing(row) }}
                          aria-label="Set the cost"
                          title="Set the cost"
                        >
                          <Pencil size={13} />
                        </button>
                      </td>
                    </tr>
                    {open === row.ref && (
                      <tr className="border-t border-line bg-card2/60 dark:border-white/10 dark:bg-white/5">
                        <td colSpan={7}>
                          {row.from && (
                            <p className="px-3 pt-2 text-xs text-muted">
                              Costed at {rupees(row.costEach ?? 0)} per {row.from.unit || 'Pc'} from{' '}
                              <span className="font-medium">{row.from.name}</span> — purchase {row.from.number},{' '}
                              {row.from.party}, {row.from.date}
                            </p>
                          )}
                          <Lines rows={row.rows} show="item" />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-muted">
                      Nothing with a known cost sold in these days.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {view === 'bills' && (
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-card2 text-left text-xs uppercase text-muted dark:bg-white/5">
                <tr>
                  <th className="px-3 py-2">Bill</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Party</th>
                  <MoneyHead />
                  <th className="px-3 py-2 text-right">Lines</th>
                </tr>
              </thead>
              <tbody>
                {billRows.map((row) => (
                  <Fragment key={row.billId}>
                    <tr
                      className="cursor-pointer border-t border-line hover:bg-stone-100/60 dark:border-white/10 dark:hover:bg-white/5"
                      onClick={() => setOpen(open === row.billId ? null : row.billId)}
                    >
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5 font-medium">
                          {open === row.billId ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
                          {row.kind === 'return' ? 'Return' : 'Bill'} {row.number}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted">{row.date}</td>
                      <td className="max-w-[16rem] truncate px-3 py-2">{row.party || '—'}</td>
                      <MoneyCells t={row} />
                      <td className="px-3 py-2 text-right tabular-nums text-muted">
                        {row.costedLines}/{row.lines}
                      </td>
                    </tr>
                    {open === row.billId && (
                      <tr className="border-t border-line bg-card2/60 dark:border-white/10 dark:bg-white/5">
                        <td colSpan={8}>
                          <Lines rows={row.rows} show="bill" />
                          {(row.fare > 0 || row.costedSales !== row.sales) && (
                            <p className="px-3 pb-2 text-xs text-muted">
                              {row.costedSales !== row.sales && `${rupees(row.sales - row.costedSales)} of this bill has no cost behind it. `}
                              {row.fare > 0 && `Fare charged ${rupees(row.fare)}, not counted as profit.`}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {!billRows.length && (
                  <tr><td colSpan={8} className="px-3 py-10 text-center text-muted">No bills in these days.</td></tr>
                )}
              </tbody>
            </table>
          )}

          {view === 'days' && (
            <table className="w-full min-w-[620px] text-sm">
              <thead className="bg-card2 text-left text-xs uppercase text-muted dark:bg-white/5">
                <tr>
                  <th className="px-3 py-2">Day</th>
                  <th className="px-3 py-2 text-right">Bills</th>
                  <MoneyHead />
                  <th className="px-3 py-2 text-right">Costed</th>
                </tr>
              </thead>
              <tbody>
                {dayRows.map((row) => (
                  <tr key={row.date} className="border-t border-line dark:border-white/10">
                    <td className="px-3 py-2 font-medium">{row.date}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{row.bills}</td>
                    <MoneyCells t={row} />
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{pc(row.coverage)}</td>
                  </tr>
                ))}
                {!dayRows.length && (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-muted">No bills in these days.</td></tr>
                )}
              </tbody>
            </table>
          )}

          {view === 'gaps' && (
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-card2 text-left text-xs uppercase text-muted dark:bg-white/5">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Sold for</th>
                  <th className="px-3 py-2">Why there is no cost</th>
                  <th className="w-24 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {gapRows.map((row) => (
                  <Fragment key={row.ref}>
                    <tr
                      className="cursor-pointer border-t border-line hover:bg-stone-100/60 dark:border-white/10 dark:hover:bg-white/5"
                      onClick={() => setOpen(open === row.ref ? null : row.ref)}
                    >
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5 font-medium">
                          {open === row.ref ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
                          {row.name}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.qty} {row.unit || 'Pc'}</td>
                      <td className="px-3 py-2 text-right"><Money n={row.sales} bold /></td>
                      <td className="px-3 py-2 text-muted">
                        {row.gap ? WHY[row.gap] : 'Some lines only'}
                        {row.gap === 'rate-looks-wrong' && row.rows[0]?.from && (
                          <> — bought at {rupees(row.rows[0].from.each)}, sold at {rupees(row.sales / (row.qty || 1))}</>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {row.gap !== 'lump' && (
                          <button
                            className="rounded-lg border border-stone-300 px-2 py-1 text-xs font-semibold hover:bg-stone-100 dark:border-white/15 dark:hover:bg-white/10"
                            onClick={(e) => { e.stopPropagation(); setEditing(row) }}
                          >
                            Set cost
                          </button>
                        )}
                      </td>
                    </tr>
                    {open === row.ref && (
                      <tr className="border-t border-line bg-card2/60 dark:border-white/10 dark:bg-white/5">
                        <td colSpan={5}><Lines rows={row.rows} show="item" /></td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {!gapRows.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-muted">
                      <TrendingUp size={20} className="mx-auto mb-2 opacity-50" />
                      Every line sold in these days has a cost behind it.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </Card>
      </Page>

      {editing && (
        <SetCost
          item={editing}
          purchases={purchases}
          current={savedByRef.get(editing.ref)}
          sameAs={pairedByRef.get(editing.ref)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
