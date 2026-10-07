import { useQuery } from 'convex/react'
import { Boxes, Plus, X } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Bill, BillItem, StockLine } from '../../lib/types'
import { isAmountOnlyLine, isRoundupLine } from '../../lib/types'

const uid = () => Math.random().toString(36).slice(2, 10)

/**
 * The bill's total, and what it moved on the shelf.
 *
 * Most days a bill goes in as its total and a photograph, not line by line —
 * but the plywood and the Fevicol are still counted. So a bill can say what
 * left (on a sale) or came in (on a purchase) without listing its goods:
 * pick the item from the stock list, type how many. It moves the stock the
 * same way a line would, and never prints or prices anything.
 */

type StockRow = { ref: string; name: string; stock: number; category?: string }

const GROUPS: { key: string; label: string }[] = [
  { key: 'ply', label: 'Plywood' },
  { key: 'door', label: 'Doors' },
  { key: 'other', label: 'Other' },
]

const isBillLine = (i: BillItem) => !!i.amountOnly && /^bill$/i.test(i.description.trim())

/** Goods typed line by line — then the lines are the total, not a typed figure. */
const hasGoodsLines = (items: BillItem[]) =>
  items.some((i) => i.description.trim() && !isAmountOnlyLine(i) && !isRoundupLine(i))

export function StockMoves({ bill, onChange }: { bill: Bill; onChange: (patch: Partial<Bill>) => void }) {
  const list = useQuery(api.inventory.seedList, {}) as StockRow[] | undefined
  const lines = bill.stock ?? []
  const kind = bill.kind ?? 'sale'
  const out = kind === 'sale'
  const billLine = bill.items.find(isBillLine)
  const showTotal = !hasGoodsLines(bill.items)

  function setTotal(raw: string) {
    const amount = raw === '' ? 0 : Math.max(0, Number(raw) || 0)
    if (billLine) {
      onChange({ items: bill.items.map((i) => (i.id === billLine.id ? { ...i, amount } : i)) })
      return
    }
    // The blank row a new bill opens with gives way to the total; a fare or
    // other charge already typed stays beside it.
    const kept = bill.items.filter((i) => i.description.trim() || Number(i.amount))
    onChange({
      items: [{ id: uid(), description: 'Bill', qty: 1, unit: 'Pc', amount, amountOnly: true }, ...kept],
    })
  }

  const setLines = (next: StockLine[]) => onChange({ stock: next.length ? next : undefined })
  const patchLine = (at: number, patch: Partial<StockLine>) =>
    setLines(lines.map((l, i) => (i === at ? { ...l, ...patch } : l)))

  function pick(at: number, ref: string) {
    const row = list?.find((r) => r.ref === ref)
    if (row) patchLine(at, { ref: row.ref, name: row.name })
  }

  const byRef = new Map((list ?? []).map((r) => [r.ref, r]))

  return (
    <div className="mt-3 rounded-lg border border-stone-300 p-3 dark:border-white/15">
      {showTotal && (
        <label className="mb-3 flex items-center gap-2">
          <span className="text-sm font-semibold text-stone-800 dark:text-stone-100">Bill total</span>
          <span className="ml-auto text-sm text-muted">₹</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            data-bill-nav="1"
            placeholder="0"
            value={billLine?.amount ? billLine.amount : ''}
            onChange={(e) => setTotal(e.target.value)}
            className="w-32 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-right text-base font-bold tabular-nums dark:border-white/10 dark:bg-stone-900 dark:text-white"
          />
        </label>
      )}

      <div className="flex items-center gap-2">
        <Boxes size={15} className="text-muted" aria-hidden="true" />
        <span className="text-xs font-bold uppercase tracking-wider text-muted">
          Stock {out ? 'out' : 'in'}
        </span>
        <span className="text-xs text-muted">
          {out ? '— taken off the shelf' : '— added to the shelf'}
        </span>
      </div>

      {lines.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {lines.map((l, at) => {
            const row = byRef.get(l.ref)
            const after = row ? row.stock + (out ? -1 : 1) * (Number(l.qty) || 0) : null
            return (
              <div key={at} className="flex items-center gap-2">
                <select
                  value={l.ref}
                  onChange={(e) => pick(at, e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-stone-900 dark:text-white"
                >
                  {!row && <option value={l.ref}>{l.name || 'Pick an item'}</option>}
                  {GROUPS.map((g) => {
                    const rows = (list ?? []).filter((r) => (r.category ?? 'other') === g.key)
                    return rows.length ? (
                      <optgroup key={g.key} label={g.label}>
                        {rows.map((r) => (
                          <option key={r.ref} value={r.ref}>{r.name} · {r.stock} in stock</option>
                        ))}
                      </optgroup>
                    ) : null
                  })}
                </select>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  data-bill-nav="1"
                  value={l.qty || ''}
                  placeholder="Qty"
                  onChange={(e) => patchLine(at, { qty: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-16 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-right text-sm tabular-nums dark:border-white/10 dark:bg-stone-900 dark:text-white"
                />
                <span
                  className={`w-14 shrink-0 text-right text-xs tabular-nums ${after !== null && after < 0 ? 'font-semibold text-red-600' : 'text-muted'}`}
                  title="Stock after this bill"
                >
                  {after === null ? '' : `→ ${after}`}
                </span>
                <button
                  type="button"
                  onClick={() => setLines(lines.filter((_, i) => i !== at))}
                  className="rounded p-1 text-muted hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-white/10"
                  aria-label={`Remove ${l.name || 'stock line'}`}
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <button
        type="button"
        disabled={!list?.length}
        onClick={() => {
          const first = list?.[0]
          if (first) setLines([...lines, { ref: first.ref, name: first.name, qty: 1 }])
        }}
        className="mt-2 flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-stone-100 hover:text-stone-700 disabled:opacity-40 dark:hover:bg-white/10"
      >
        <Plus size={13} /> Add stock item
      </button>
    </div>
  )
}
