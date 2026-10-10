import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ClipboardList, FileText, RotateCcw, ShieldCheck, Truck } from 'lucide-react'
import { useStore } from '../../lib/store'
import type { Bill } from '../../lib/types'

/**
 * The sales marked at the counter for something still to do: a guarantee card
 * to make, or work to carry out. A sale is put on a list by its toggle in the
 * sale form and comes off when it is marked done (a card made from the bill
 * marks itself). Done ones stay below, so a slip can be undone.
 */
type ListKind = 'guarantee' | 'delivery'

const LISTS: Record<ListKind, {
  title: string
  empty: string
  doneLabel: string
  flag: (b: Bill) => boolean
  doneAt: (b: Bill) => number | undefined
  setDone: (b: Bill, at: number | undefined) => Bill
}> = {
  guarantee: {
    title: 'Guarantee list',
    empty: 'No sale is waiting for a guarantee card. Switch on "Guarantee card" in a sale to list it here.',
    doneLabel: 'Done',
    flag: (b) => !!b.guaranteeCard,
    doneAt: (b) => b.guaranteeDoneAt,
    setDone: (b, at) => ({ ...b, guaranteeDoneAt: at }),
  },
  delivery: {
    title: 'Delivery',
    empty: 'Every sale has been delivered. Untick "Delivered" in a sale whose goods go later to list it here.',
    doneLabel: 'Delivered',
    flag: (b) => !!b.undelivered,
    doneAt: (b) => b.deliveredAt,
    setDone: (b, at) => ({ ...b, deliveredAt: at }),
  },
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

export function GuaranteeList() { return <MarkedSales kind="guarantee" /> }
export function DeliveryList() { return <MarkedSales kind="delivery" /> }

function MarkedSales({ kind }: { kind: ListKind }) {
  const list = LISTS[kind]
  const navigate = useNavigate()
  const { bills, saveBill } = useStore()
  const [showDone, setShowDone] = useState(false)
  const [showIgnored, setShowIgnored] = useState(false)
  // Only the Guarantee list can set a sale aside for now.
  const ignoredAt = (b: Bill) => (kind === 'guarantee' ? b.guaranteeIgnoredAt : undefined)

  const { pending, ignored, done } = useMemo(() => {
    const marked = bills.filter((b) => (b.kind ?? 'sale') === 'sale' && list.flag(b))
    return {
      // Oldest first: the one that has waited longest is at the top.
      pending: marked.filter((b) => !list.doneAt(b) && !ignoredAt(b)).sort((a, b) => a.date.localeCompare(b.date)),
      ignored: marked.filter((b) => !list.doneAt(b) && ignoredAt(b)).sort((a, b) => (ignoredAt(b) ?? 0) - (ignoredAt(a) ?? 0)),
      done: marked.filter((b) => list.doneAt(b)).sort((a, b) => (list.doneAt(b) ?? 0) - (list.doneAt(a) ?? 0)),
    }
  }, [bills, list])

  const row = (b: Bill, isDone: boolean) => (
    <div
      key={b.id}
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-stone-100 px-4 py-3 last:border-b-0 dark:border-white/5 ${isDone ? 'opacity-60' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-muted">#{b.number}</span>
          <span className="truncate font-semibold text-stone-900 dark:text-stone-100">{b.customerName || 'Cash sale'}</span>
          {b.customerPhone && <span className="text-xs text-muted">{b.customerPhone}</span>}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted">
          {fmtDate(b.date)} · {money(b.total)} · {b.items.map((it) => it.brandName || it.description).filter(Boolean).slice(0, 3).join(', ') || `${b.items.length} item(s)`}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {kind === 'guarantee' && !isDone && (
          <button
            type="button"
            onClick={() => navigate(`/guarantee/bill/${b.id}`, { state: { returnTo: '/guarantee/list' } })}
            className="flex items-center gap-1.5 rounded-lg bg-shiv-green px-3 py-1.5 text-xs font-bold text-stone-950 hover:brightness-95"
          >
            <ShieldCheck size={14} /> Make card
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate(`/bills/${b.id}`)}
          className="flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 dark:border-white/10 dark:text-stone-200 dark:hover:bg-white/5"
        >
          <FileText size={14} /> Bill
        </button>
        {kind === 'guarantee' && !isDone && (
          <button
            type="button"
            onClick={() => saveBill({ ...b, guaranteeIgnoredAt: b.guaranteeIgnoredAt ? undefined : Date.now() })}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-muted hover:bg-stone-50 hover:text-stone-700 dark:hover:bg-white/5 dark:hover:text-stone-200"
          >
            {b.guaranteeIgnoredAt ? 'Bring back' : 'Ignore for now'}
          </button>
        )}
        <button
          type="button"
          onClick={() => saveBill(list.setDone(b, isDone ? undefined : Date.now()))}
          className="flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 dark:border-white/10 dark:text-stone-200 dark:hover:bg-white/5"
        >
          {isDone ? <><RotateCcw size={14} /> Not {list.doneLabel.toLowerCase()}</> : <><Check size={14} /> {list.doneLabel}</>}
        </button>
      </div>
    </div>
  )

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col p-3 md:p-4">
      <div className="mb-3 flex items-center gap-2">
        {kind === 'guarantee' ? <ShieldCheck size={20} className="text-shiv-green" />
          : kind === 'delivery' ? <Truck size={20} className="text-shiv-green" />
          : <ClipboardList size={20} className="text-shiv-green" />}
        <h1 className="text-lg font-bold text-stone-900 dark:text-stone-100">{list.title}</h1>
        <span className="ml-auto rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-bold text-stone-700 dark:bg-white/10 dark:text-stone-200">
          {pending.length} to do
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-white/10 dark:bg-stone-900">
        {pending.length ? pending.map((b) => row(b, false)) : (
          <p className="px-4 py-10 text-center text-sm text-muted">{list.empty}</p>
        )}
      </div>

      {ignored.length > 0 && (
        <div className="mt-4">
          <button type="button" onClick={() => setShowIgnored((v) => !v)} className="mb-2 text-xs font-semibold text-muted hover:text-stone-700 dark:hover:text-stone-200">
            {showIgnored ? 'Hide' : 'Show'} ignored for now ({ignored.length})
          </button>
          {showIgnored && (
            <div className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-white/10 dark:bg-stone-900">
              {ignored.map((b) => row(b, false))}
            </div>
          )}
        </div>
      )}

      {done.length > 0 && (
        <div className="mt-4">
          <button type="button" onClick={() => setShowDone((v) => !v)} className="mb-2 text-xs font-semibold text-muted hover:text-stone-700 dark:hover:text-stone-200">
            {showDone ? 'Hide' : 'Show'} done ({done.length})
          </button>
          {showDone && (
            <div className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-white/10 dark:bg-stone-900">
              {done.map((b) => row(b, true))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
