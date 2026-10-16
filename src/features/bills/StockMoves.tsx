import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from 'convex/react'
import { useLive } from '../ledger/lib/cache'
import { Boxes, Check, ChevronDown, Plus, X } from 'lucide-react'
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
 *
 * An item the list does not have is written in at the foot of the same list
 * ("Write a new item"): it joins the stock list with nothing on the shelf, so
 * a sale of it shows below nil until its real count is entered in Inventory.
 */


type StockRow = { ref: string; name: string; stock: number; category?: string }

const GROUPS: { key: string; label: string }[] = [
  { key: 'ply', label: 'Plywood' },
  { key: 'door', label: 'Doors' },
  { key: 'other', label: 'Other' },
]

/**
 * "12mm Signature Gold 7 x 4" is grouped under its company, "Signature Gold":
 * the list splits by company so a sheet is found without reading every size of
 * every brand. Signature comes first (Signature, then Signature Gold), the
 * other companies follow A to Z; inside a company the thinnest sheet leads. A
 * name not written that way stays under its category.
 */
const SIZED = /^(\d+(?:\.\d+)?)\s*mm\s+(.*?)\s+\d+(?:\.\d+)?\s*[x×]\s*\d/i
type Section = { key: string; title: string; rows: StockRow[] }
const bySize = (a: StockRow, b: StockRow) =>
  (Number(a.name.match(SIZED)?.[1]) || Infinity) - (Number(b.name.match(SIZED)?.[1]) || Infinity)
  || a.name.localeCompare(b.name, undefined, { numeric: true })
function stockSections(list: StockRow[]): Section[] {
  const out: Section[] = []
  for (const g of GROUPS) {
    const rows = list.filter((r) => (r.category ?? 'other') === g.key)
    const brands = new Map<string, StockRow[]>()
    const plain: StockRow[] = []
    for (const r of rows) {
      const brand = g.key === 'other' ? null : r.name.match(SIZED)?.[2]
      if (brand) brands.set(brand, [...(brands.get(brand) ?? []), r])
      else plain.push(r)
    }
    const rank = (brand: string) => (/^signature/i.test(brand) ? 0 : 1)
    const ordered = [...brands.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    for (const [brand, rs] of ordered) {
      out.push({ key: `${g.key}:${brand}`, title: g.key === 'ply' ? brand : `${g.label} · ${brand}`, rows: rs.sort(bySize) })
    }
    if (plain.length) out.push({ key: `${g.key}:`, title: g.label, rows: plain.sort(bySize) })
  }
  return out
}

/**
 * The stock list as a dropdown of our own: the browser's own menu cannot make
 * a company's name larger than its sizes, which is what finding a sheet needs.
 */
function StockPicker({ value, fallback, list, onPick, onNew }: {
  value: string
  fallback: string
  list: StockRow[]
  onPick: (ref: string) => void
  onNew: () => void
}) {
  const [open, setOpen] = useState(false)
  const [find, setFind] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const sections = useMemo(() => {
    const q = find.trim().toLowerCase()
    const rows = q ? list.filter((r) => q.split(/\s+/).every((w) => r.name.toLowerCase().includes(w))) : list
    return stockSections(rows)
  }, [list, find])
  const chosen = list.find((r) => r.ref === value)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    box.current?.querySelector('[data-chosen="1"]')?.scrollIntoView({ block: 'center' })
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const close = () => { setOpen(false); setFind('') }
  return (
    <div ref={box} className="relative min-w-0 flex-1" onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); close() } }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-left text-sm dark:border-white/10 dark:bg-stone-900 dark:text-white"
      >
        <span className="min-w-0 flex-1 truncate">{chosen ? chosen.name : fallback || 'Pick an item'}</span>
        <ChevronDown size={15} className="shrink-0 text-muted" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-lg border border-stone-300 bg-white shadow-2xl dark:border-white/15 dark:bg-stone-900">
          <input
            autoFocus
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Find, e.g. 12 sig 7"
            aria-label="Find a stock item"
            className="w-full border-b border-stone-200 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/10 dark:text-white"
          />
          <div role="listbox" className="max-h-[60vh] overflow-y-auto">
            {sections.map((sec) => (
              <div key={sec.key}>
                <div className="sticky top-0 z-10 border-y border-stone-200 bg-stone-100 px-3 py-1.5 text-base font-extrabold tracking-wide text-stone-900 dark:border-white/10 dark:bg-stone-800 dark:text-white">
                  {sec.title}
                </div>
                {sec.rows.map((r) => (
                  <button
                    key={r.ref}
                    type="button"
                    role="option"
                    aria-selected={r.ref === value}
                    data-chosen={r.ref === value ? '1' : undefined}
                    onClick={() => { onPick(r.ref); close() }}
                    className={`flex w-full min-w-0 items-baseline gap-2 px-4 py-2 text-left text-[15px] hover:bg-stone-100 dark:hover:bg-white/10 ${r.ref === value ? 'bg-shiv-green/20 font-semibold' : 'text-stone-700 dark:text-stone-200'}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className={`shrink-0 text-xs tabular-nums ${r.stock <= 0 ? 'font-semibold text-red-600' : 'text-muted'}`}>{r.stock} in stock</span>
                  </button>
                ))}
              </div>
            ))}
            {!sections.length && <div className="px-3 py-3 text-sm text-muted">Nothing like that in the list.</div>}
            <button type="button" onClick={() => { close(); onNew() }}
              className="flex w-full items-center gap-2 border-t border-stone-200 px-3 py-2.5 text-left text-sm font-semibold text-shiv-green dark:border-white/10">
              <Plus size={14} aria-hidden="true" /> Write a new item
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const isBillLine = (i: BillItem) => !!i.amountOnly && /^bill$/i.test(i.description.trim())

/** Goods typed line by line — then the lines are the total, not a typed figure. */
const hasGoodsLines = (items: BillItem[]) =>
  items.some((i) => i.description.trim() && !isAmountOnlyLine(i) && !isRoundupLine(i))

/**
 * Which way this bill moves the shelf, the way the stock count reads it: a sale
 * or a return to a supplier takes off; a purchase, a delivery or a customer's
 * return puts on.
 */
export const stockGoesOut = (kind: Bill['kind'], partyGroup?: string) =>
  (kind ?? 'sale') === 'sale' || ((kind ?? 'sale') === 'return' && partyGroup === 'Sundry Creditors')

export function StockMoves({ bill, out, onChange }: {
  bill: Bill
  /** Whether the stock leaves the shelf — see `stockGoesOut`. */
  out: boolean
  onChange: (patch: Partial<Bill>) => void
}) {
  const list = useLive(api.inventory.seedList, {}, 'inventory:seed') as StockRow[] | undefined
  // A saved bill is already in the shelf counts; this is what it took off or put on.
  const counted = useLive(api.inventory.countedForBill, { billId: bill.id }, `inventory:bill:${bill.id}`) as Record<string, number> | undefined
  const lines = bill.stock ?? []
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
  // Stock after this bill, line by line: the count without this bill, then
  // each line in turn, so an item on two lines comes off once for both.
  const running = new Map<string, number>()
  const afterOf = lines.map((l) => {
    const row = byRef.get(l.ref)
    if (!row) return null
    const moved = (running.get(l.ref) ?? 0) + (out ? -1 : 1) * (Number(l.qty) || 0)
    running.set(l.ref, moved)
    return row.stock - (counted?.[l.ref] ?? 0) + moved
  })

  // The row whose item is being written in rather than picked, and what is typed.
  const addFromBill = useMutation(api.inventory.addFromBill)
  const [writing, setWriting] = useState<{ at: number; name: string; busy: boolean; error: string } | null>(null)
  async function addWritten() {
    if (!writing || writing.busy || !writing.name.trim()) return
    setWriting({ ...writing, busy: true, error: '' })
    try {
      const made = await addFromBill({ name: writing.name })
      patchLine(writing.at, { ref: made.ref, name: made.name })
      setWriting(null)
    } catch (err) {
      const said = typeof (err as { data?: unknown })?.data === 'string' ? (err as { data: string }).data : 'Could not add the item. Check the connection and try again.'
      setWriting((now) => (now ? { ...now, busy: false, error: said } : now))
    }
  }

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

      {/* Most bills move no counted stock: until one does, this is a single
          small link, not a heading, a sentence and a button. */}
      {lines.length > 0 && (
      <div className="flex items-center gap-2">
        <Boxes size={15} className="text-muted" aria-hidden="true" />
        <span className="text-xs font-bold uppercase tracking-wider text-muted">
          Stock {out ? 'out' : 'in'}
        </span>
        <span className="text-xs text-muted">
          {out ? '— taken off the shelf' : '— added to the shelf'}
        </span>
      </div>
      )}

      {lines.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {lines.map((l, at) => {
            const after = afterOf[at]
            return (
              <div key={at} className="flex items-center gap-2">
                {writing?.at === at ? (
                  // Written rather than picked: Enter (or the tick) adds it to the stock list.
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-1">
                      <input
                        type="text"
                        autoFocus
                        value={writing.name}
                        maxLength={100}
                        disabled={writing.busy}
                        placeholder="New item, e.g. 12mm Signature 7 x 3"
                        aria-label="New stock item"
                        onChange={(e) => setWriting({ ...writing, name: e.target.value, error: '' })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void addWritten() }
                          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setWriting(null) }
                        }}
                        className="min-w-0 flex-1 rounded-lg border border-shiv-green bg-white px-2 py-1.5 text-sm outline-none dark:bg-stone-900 dark:text-white"
                      />
                      <button type="button" onClick={() => void addWritten()} disabled={writing.busy || !writing.name.trim()}
                        className="rounded-lg bg-shiv-green p-1.5 text-stone-950 disabled:opacity-40" aria-label="Add this item to the stock list" title="Add to the stock list">
                        <Check size={15} />
                      </button>
                      <button type="button" onClick={() => setWriting(null)} disabled={writing.busy}
                        className="rounded p-1.5 text-muted hover:bg-stone-100 dark:hover:bg-white/10" aria-label="Pick from the list instead" title="Pick from the list instead">
                        <X size={15} />
                      </button>
                    </span>
                    {writing.error && <span role="alert" className="text-xs font-semibold text-red-600">{writing.error}</span>}
                  </span>
                ) : (
                <StockPicker
                  value={l.ref}
                  fallback={l.name}
                  list={list ?? []}
                  onPick={(ref) => pick(at, ref)}
                  onNew={() => setWriting({ at, name: '', busy: false, error: '' })}
                />
                )}
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
        <Plus size={13} /> {lines.length ? 'Add stock item' : out ? 'Stock out' : 'Stock in'}
      </button>
    </div>
  )
}
