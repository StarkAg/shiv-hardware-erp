import { useEffect } from 'react'
import { useQuery } from 'convex/react'
import { Check, PackageCheck, TriangleAlert } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Bill, BillItem, CustomCatalogEntry } from '../../lib/types'
import { isAmountOnlyLine, isRoundupLine } from '../../lib/types'
import { foldName } from '../../../convex/lib/text'
import { useStore } from '../../lib/store'

/**
 * Deliveries on the bill screen.
 *
 * A Goods Received Note is written on the same screen as any voucher, with one
 * thing a bill does not have: who counted the goods. A purchase, in turn, can
 * say which deliveries it is the bill for, and is checked against them before
 * it is saved — quantities against what was counted, rates against what was
 * paid last time.
 */

export type DeliveryRow = {
  voucherId: string
  vchLabel: string
  date: number
  days: number
  partyLedgerId: string
  party: string
  receivedBy: string
  billedHere: boolean
  items: { description: string; qty: number; unit: string; rate: number; value: number; from: string | null }[]
  estimate: number
  unpricedLines: number
}

const OWNER = 'Harsh'

/** Who counted the goods in: the attendance list, and the owner. */
export function CheckedBy({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const staff = (useQuery(api.attendance.getStaff, {}) as string[] | undefined) ?? []
  const names = [...staff, OWNER].filter((n, i, all) => all.indexOf(n) === i)
  return (
    <div>
      <span className="mb-1 block text-xs font-semibold text-muted">Checked by</span>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Checked by">
        {names.map((name) => {
          const on = value === name
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(on ? '' : name)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                on
                  ? 'bg-shiv-green text-stone-950'
                  : 'bg-stone-200/70 text-stone-700 hover:bg-stone-300/70 dark:bg-white/10 dark:text-stone-300'
              }`}
            >
              {on && <Check size={12} className="-ml-0.5 mr-1 inline" />}
              {name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const goodsOf = (items: BillItem[]) =>
  items.filter((i) => String(i.description ?? '').trim() && !isRoundupLine(i) && !isAmountOnlyLine(i) && !i.auto)

const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const qtyText = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })
const shortDay = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })

let lineSeq = 0
const lineId = () => `grn${Date.now().toString(36)}${(lineSeq++).toString(36)}`

/**
 * The lines of the deliveries picked, added to the bill: a delivery's line
 * joins a line of the same item already there, otherwise it is added at the
 * rate its estimate used — what was last paid for it — or with no amount
 * where there is none, for the bill's rate to be typed in.
 */
/**
 * The My Items entry a delivery line is for, where the shop already knows.
 *
 * A delivery note records what arrived as plain words, so its lines used to
 * arrive on the bill attached to nothing — and a line attached to nothing has
 * no rate box, only a total. The shop's own two wordings for an item are
 * enough to find it: the name it is listed under, and the supplier spellings
 * already taught to it (`alsoKnownAs`, see convex/itemFold.ts).
 *
 * Matched on the exact fold and nothing looser. `foldName` sets aside case,
 * spacing, punctuation and the "M/s"; it does not guess. A near miss here
 * would quietly file a rate against the wrong item and go on doing it, which
 * is far worse than a line that simply asks for its total.
 */
function entryFor(description: string, catalog: CustomCatalogEntry[]) {
  const key = foldName(description)
  if (!key) return undefined
  return catalog.find(
    (e) => foldName(e.name) === key || (e.alsoKnownAs ?? []).some((a) => foldName(a) === key)
  )
}

export function withDeliveryLines(items: BillItem[], rows: DeliveryRow[], catalog: CustomCatalogEntry[]): BillItem[] {
  const out = items.filter((i) => String(i.description ?? '').trim() || Number(i.amount))
  for (const row of rows) {
    for (const line of row.items) {
      const key = foldName(line.description)
      const same = out.find((i) => foldName(i.description) === key && !i.auto)
      if (same) continue
      const entry = entryFor(line.description, catalog)
      const qty = line.qty || 1
      // The same figure the delivery's estimate was worked at, so the bill
      // opens at what it is expected to come to. A supplier's bill that says
      // otherwise is typed over, and the rate check then compares the typed
      // figure with the last one paid, as before.
      const rate = line.from && line.rate > 0 ? line.rate : 0
      out.push({
        id: lineId(),
        description: line.description,
        // What was counted stands: the delivery's own quantity and unit are
        // the record of what came through the door, not the item list's.
        qty,
        unit: line.unit || 'Pc',
        amount: rate ? Math.round(rate * qty) : 0,
        ...(rate ? { rateSqft: rate } : {}),
        ...(entry ? { customEntryId: entry.id } : {}),
      })
    }
  }
  return out.length ? out : items
}

/**
 * The day a bill against deliveries carries.
 *
 * A supplier's bill is dated when the goods went out, so a purchase written
 * against a delivery should carry the delivery's own date rather than the day
 * somebody got round to entering it — which is what it used to take, because
 * the form opened on today and nobody thought to change it. Entering last
 * week's bills on a Friday quietly dated the lot Friday, and the supplier's
 * statement then disagreed with the books by a week.
 *
 * With more than one delivery on the same bill it is the latest of them: goods
 * cannot be billed before they have arrived.
 *
 * The date is stored as YYYY-MM-DD in UTC, which is how `today()` in the
 * builder writes it, and GRN dates are stored as UTC day boundaries — so the
 * slice lands on the right day rather than a day either side of it.
 */
export function dateForDeliveries(rows: { date: number }[]): string | null {
  const days = rows.map((r) => r.date).filter((d) => Number.isFinite(d))
  if (!days.length) return null
  return new Date(Math.max(...days)).toISOString().slice(0, 10)
}

/** A purchase's "which deliveries is this the bill for". */
export function AgainstDeliveries({
  draft,
  setDraft,
  rows,
  ledgerId,
  pendingGrn,
  onPendingDone,
}: {
  draft: Bill
  setDraft: (fn: (d: Bill) => Bill) => void
  rows: DeliveryRow[] | undefined
  ledgerId?: string
  pendingGrn: string | null
  onPendingDone: () => void
}) {
  const { customCatalog } = useStore()
  // Arrived from "Enter bill" on a delivery: tick it and bring its lines in
  // once the deliveries have loaded.
  useEffect(() => {
    if (!pendingGrn || !rows) return
    const row = rows.find((r) => r.voucherId === pendingGrn)
    if (row) {
      setDraft((d) => ({
        ...d,
        customerName: d.customerName || row.party,
        grnIds: Array.from(new Set([...(d.grnIds ?? []), row.voucherId])),
        items: withDeliveryLines(d.items, [row], customCatalog),
        date: dateForDeliveries([row]) ?? d.date,
      }))
    }
    onPendingDone()
  }, [pendingGrn, rows, setDraft, onPendingDone, customCatalog])

  const linked = new Set(draft.grnIds ?? [])
  const mine = (rows ?? []).filter((r) => linked.has(r.voucherId) || (ledgerId && r.partyLedgerId === ledgerId))
  if (!mine.length) return null

  const byId = new Map((rows ?? []).map((r) => [r.voucherId, r]))
  /** The bill's date, once this set of deliveries is on it. */
  const dateFor = (ids: Set<string>, fallback: string) =>
    dateForDeliveries([...ids].map((id) => byId.get(id)).filter((r): r is DeliveryRow => Boolean(r)))
    ?? fallback

  const toggle = (row: DeliveryRow) =>
    setDraft((d) => {
      const ids = new Set(d.grnIds ?? [])
      if (ids.has(row.voucherId)) {
        ids.delete(row.voucherId)
        // Unticking the last one leaves the date where it is rather than
        // springing back to today: it may well have been typed by hand.
        return { ...d, grnIds: [...ids], date: dateFor(ids, d.date) }
      }
      ids.add(row.voucherId)
      return {
        ...d,
        grnIds: [...ids],
        items: withDeliveryLines(d.items, [row], customCatalog),
        date: dateFor(ids, d.date),
      }
    })

  return (
    <div className="rounded-xl border border-stone-300 p-3 dark:border-white/15">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
        <PackageCheck size={14} /> Bill for which delivery?
      </div>
      <div className="flex flex-col gap-1.5">
        {mine.map((row) => {
          const on = linked.has(row.voucherId)
          return (
            <button
              key={row.voucherId}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(row)}
              className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition ${
                on
                  ? 'border-shiv-green bg-shiv-green/10'
                  : 'border-stone-200 hover:bg-stone-50 dark:border-white/10 dark:hover:bg-white/5'
              }`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  on ? 'border-shiv-green bg-shiv-green text-stone-950' : 'border-stone-400'
                }`}
              >
                {on && <Check size={11} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-bold text-stone-900 dark:text-white">{row.vchLabel}</span>
                <span className="text-muted"> · {shortDay(row.date)}{row.receivedBy ? ` · checked by ${row.receivedBy}` : ''}</span>
                <span className="block truncate text-xs text-muted">
                  {row.items.map((i) => `${i.description} ${qtyText(i.qty)} ${i.unit}`).join(' · ') || 'no lines written'}
                </span>
              </span>
              {row.estimate > 0 && (
                <span className="shrink-0 text-xs text-muted">est. {money(row.estimate)}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * What does not agree between a bill and the deliveries it is for.
 *
 * Nothing here stops the save — a supplier may have sent a different grade,
 * or the rate may really have gone up — but each is said before saving and
 * kept on the voucher.
 */
export function deliveryChecks(bill: Bill, rows: DeliveryRow[] | undefined): string[] {
  const picked = (rows ?? []).filter((r) => (bill.grnIds ?? []).includes(r.voucherId))
  if (!picked.length) return []
  const out: string[] = []

  const received = new Map<string, { name: string; qty: number; unit: string; lastRate: number; grns: string[] }>()
  for (const row of picked) {
    for (const line of row.items) {
      const key = foldName(line.description)
      const had = received.get(key)
      const lastRate = line.from && line.from.startsWith('last paid') ? line.rate : 0
      if (had) {
        had.qty += line.qty
        had.grns.push(row.vchLabel)
        had.lastRate = had.lastRate || lastRate
      } else {
        received.set(key, { name: line.description, qty: line.qty, unit: line.unit, lastRate, grns: [row.vchLabel] })
      }
    }
  }

  const billed = new Map<string, { name: string; qty: number; unit: string; amount: number }>()
  for (const i of goodsOf(bill.items)) {
    const key = foldName(i.description)
    const had = billed.get(key)
    if (had) {
      had.qty += Number(i.qty) || 0
      had.amount += Number(i.amount) || 0
    } else {
      billed.set(key, { name: i.description.trim(), qty: Number(i.qty) || 0, unit: i.unit, amount: Number(i.amount) || 0 })
    }
  }

  for (const [key, b] of billed) {
    const r = received.get(key)
    if (!r) {
      out.push(`${b.name} is on the bill but was not received on ${picked.map((p) => p.vchLabel).join(', ')}`)
      continue
    }
    if (r.qty && Math.abs(b.qty - r.qty) > 0.001) {
      out.push(`${b.name}: billed ${qtyText(b.qty)} ${b.unit}, received ${qtyText(r.qty)} ${r.unit}`)
    }
    const rate = b.qty ? b.amount / b.qty : 0
    if (rate > 0 && r.lastRate > 0 && Math.abs(rate - r.lastRate) / r.lastRate > 0.01) {
      const pct = Math.round(((rate - r.lastRate) / r.lastRate) * 100)
      out.push(`${b.name}: ${money(rate)} a ${b.unit || 'piece'}, last paid ${money(r.lastRate)} (${pct > 0 ? '+' : ''}${pct}%)`)
    }
  }
  for (const [key, r] of received) {
    if (!billed.has(key)) out.push(`${r.name} was received on ${r.grns.join(', ')} but is not on this bill`)
  }
  return out
}

/** The checks, said before the second press of Save. */
export function ChecksNotice({ checks }: { checks: string[] }) {
  if (!checks.length) return null
  return (
    <div role="alert" className="rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <div className="mb-1 flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
        <TriangleAlert size={15} /> This bill does not match its delivery
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-stone-800 dark:text-stone-200">
        {checks.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <p className="mt-1.5 text-xs text-muted">Press Save again to save it with these noted on the voucher.</p>
    </div>
  )
}
