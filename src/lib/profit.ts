import { billCharges, billLines, type Bill, type BillItem } from './types'

/**
 * What the shop actually made on what it sold.
 *
 * There is no stock ledger here, and there never has been: goods come in on a
 * supplier's bill and go out on a customer's, and nothing in between says
 * which sheet was which. So profit is worked the only honest way available —
 * every line sold is matched to the rate that line's item was last bought at,
 * and the difference is the profit on it. A line whose item was never bought
 * through the panel has no cost, and is left out of the figure rather than
 * guessed at. The uncosted ones are listed instead, because a profit page that
 * quietly drops a third of the sales is worse than one that says so.
 *
 * Nothing here knows anything about the shop's goods.
 *
 * That is deliberate, and it is the second attempt. The first read the names —
 * that SG and S are both Signature, that "B.Board" and "F.Door" are words a
 * sale leaves out — and it worked, for Signature, until the next brand. Shop
 * knowledge written as regexes is knowledge only the person who wrote them can
 * change. So it lives as data now: an item is identified by the My Items entry
 * the line was picked from, two entries that are one item are said to be one
 * in `itemSame`, and what cannot be paired at all is priced by hand in
 * `itemCosts`. Names are compared only when a line was typed without picking
 * an item, and then only for case, spacing and punctuation.
 */

/* ------------------------------------------------------------------ */
/* which item a line is                                                */
/* ------------------------------------------------------------------ */

/**
 * A name with nothing but the flourishes taken off.
 *
 * Case, stray spaces, the various dashes and quote marks a phone keyboard
 * produces, and the spacing around a size — "8 X 4", "8x4" and "8 × 4" are one
 * size written three ways. No word is given a meaning here.
 */
export function foldItemName(description: string | undefined | null): string {
  return String(description ?? '')
    .replace(/[×✕]/g, 'x') // emoji-ok: reads a typed cross
    .replace(/[“”″]/g, '"')
    .replace(/[‘’′]/g, "'")
    .toLowerCase()
    .replace(/(\d)\s*x\s*(\d)/g, '$1x$2')
    .replace(/[^a-z0-9x/+".' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * What a bill line points at.
 *
 * An item picked from My Items carries that entry's id, and the id is the
 * answer: it survives the line being renamed, and it is on all but a handful
 * of the lines in the books. A line typed freehand has only its name.
 */
export type ItemRef = string

export const refOf = (item: Pick<BillItem, 'description' | 'customEntryId'>): ItemRef =>
  item.customEntryId ? `id:${item.customEntryId}` : `name:${foldItemName(item.description)}`

/** Two entries the shop has said are one item. */
export interface SameGoods {
  from: ItemRef
  to: ItemRef
}

/**
 * One item may be pointed at another, and that one at a third — the shop adds
 * these one at a time as it meets them, not as a tidy tree. Following the
 * chain to its end gives every member of a group the same answer, whichever
 * end it was added from. A loop stops rather than hangs.
 */
export function resolver(same: SameGoods[] = []): (ref: ItemRef) => ItemRef {
  const next = new Map(same.map((s) => [s.from, s.to]))
  return (ref) => {
    let at = ref
    const seen = new Set<string>([at])
    for (;;) {
      const to = next.get(at)
      if (!to || seen.has(to)) return at
      seen.add(to)
      at = to
    }
  }
}

/**
 * A board counts the same whether the counter wrote Pc or Sheet, and whether
 * it wrote a unit at all. A case of tape against a piece of tape does not:
 * that is a rate for twelve against a rate for one, and taking one for the
 * other would show a loss on every roll.
 */
const PIECES = new Set(['', 'pc', 'pcs', 'piece', 'pieces', 'nos', 'no', 'sheet', 'sheets', 'sht'])
const unitKey = (unit: string | undefined | null) =>
  String(unit ?? '').trim().toLowerCase().replace(/\.$/, '')
export const sameUnit = (a: string | undefined, b: string | undefined) => {
  const x = unitKey(a)
  const y = unitKey(b)
  return x === y || (PIECES.has(x) && PIECES.has(y))
}

/* ------------------------------------------------------------------ */
/* what a purchase really cost                                         */
/* ------------------------------------------------------------------ */

/**
 * A supplier's bill is not only its goods lines. Mahadev adds 9% and 9% on
 * top; Shree Shyam takes ₹250 off the bottom; Hardware Home charges ₹96 to
 * send it. All three change what the stock in the godown cost, so they are
 * shared over the goods in proportion to what each line came to. A sheet
 * billed at ₹584.75 with GST on it cost ₹690.01, and that is the figure a
 * margin has to be worked against.
 */
function pricedLines(bill: Bill): { item: BillItem; qty: number; each: number }[] {
  const goods = billLines(bill.items ?? []).filter(
    (i) => Number(i.qty) > 0 && Number(i.amount) > 0,
  )
  const value = goods.reduce((sum, i) => sum + Number(i.amount), 0)
  if (!value) return []
  const extra = billCharges(bill.items ?? []).reduce((sum, i) => sum + Number(i.amount), 0)
  return goods.map((item) => {
    const amount = Number(item.amount)
    const qty = Number(item.qty)
    return { item, qty, each: (amount + extra * (amount / value)) / qty }
  })
}

export interface PurchaseRate {
  date: string
  each: number
  unit: string
  name: string
  number: string
  party: string
}

/** Every rate ever paid, by item, oldest first. */
export function costBook(bills: Bill[], same: SameGoods[] = []): Map<ItemRef, PurchaseRate[]> {
  const resolve = resolver(same)
  const book = new Map<ItemRef, PurchaseRate[]>()
  for (const bill of bills) {
    if (bill.kind !== 'purchase') continue
    for (const { item, each } of pricedLines(bill)) {
      const ref = resolve(refOf(item))
      const rates = book.get(ref) ?? []
      rates.push({
        date: bill.date,
        each,
        unit: item.unit ?? '',
        name: item.description,
        number: bill.number,
        party: bill.customerName ?? '',
      })
      book.set(ref, rates)
    }
  }
  for (const rates of book.values()) rates.sort((a, b) => a.date.localeCompare(b.date))
  return book
}

export interface PurchasedItem {
  ref: ItemRef
  /** The latest name it was billed under by a supplier. */
  name: string
  unit: string
  /** The last rate paid, charges and all. */
  each: number
  date: string
  party: string
  times: number
}

/** Everything the shop has ever bought, for choosing what a sold item is. */
export function purchasedItems(bills: Bill[], same: SameGoods[] = []): PurchasedItem[] {
  return Array.from(costBook(bills, same), ([ref, rates]) => {
    const last = rates[rates.length - 1]
    return {
      ref,
      name: last.name,
      unit: last.unit,
      each: last.each,
      date: last.date,
      party: last.party,
      times: rates.length,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * A cost typed by hand, or a sold item told what it is bought as.
 *
 * This is not the same as saying two things are one item, and the difference
 * matters. A 20 kg drum of Fevicol is not a 1 kg pack; it is twenty of them,
 * and `per` says so — the cost of one drum is twenty times the pack rate. Use
 * `itemSame` when two names are genuinely one thing, and this when one thing
 * is priced from another.
 */
export interface CostOverride {
  ref: ItemRef
  /** A rate the shop typed, per unit as sold. */
  cost?: number
  /** The item this one is bought as. */
  sameAs?: ItemRef
  /** How many of that item make one of this. One if not said. */
  per?: number
}

/**
 * A matched rate far under what the goods sell for is a typing slip.
 *
 * A Fevicol supplier's bill priced a 19mm board at ₹348.10 — a tenth of what
 * the board sells for — and taken at face value that one line shows ₹31,680
 * of profit that was never made. Nothing is deleted and nothing is guessed:
 * the line is set aside as needing a cost, with the two figures shown, and the
 * shop either types the right rate or accepts the one on the bill. This is a
 * doubt about a rate the panel found by itself, so it is never raised against
 * a rate the shop typed or an item the shop paired by hand.
 */
const LOOKS_WRONG = 0.25

export type GapReason = 'never-bought' | 'lump' | 'different-unit' | 'rate-looks-wrong'

export type CostSource = 'purchase' | 'linked' | 'typed'

export interface ProfitLine {
  billId: string
  number: string
  date: string
  kind: 'sale' | 'return'
  party: string
  ref: ItemRef
  name: string
  unit: string
  /** Negative on a goods return, so a return takes back what the sale added. */
  qty: number
  sales: number
  /** Nil until the cost is known; `gap` says why when it is not. */
  cost: number
  costEach?: number
  source?: CostSource
  from?: PurchaseRate
  /** Whether the rate used was in force on the day, or the earliest ever paid. */
  dated?: 'on-the-day' | 'earliest'
  gap?: GapReason
}

/** A line entered as a bare amount, with no item behind it to cost. */
const LUMP = /^(?:bill|goods|cash return)$/i

function rateFor(
  ref: ItemRef,
  date: string,
  book: Map<ItemRef, PurchaseRate[]>,
): { rate: PurchaseRate; dated: 'on-the-day' | 'earliest' } | null {
  const rates = book.get(ref)
  if (!rates?.length) return null
  const before = rates.filter((r) => r.date <= date)
  return before.length
    ? { rate: before[before.length - 1], dated: 'on-the-day' }
    : { rate: rates[0], dated: 'earliest' }
}

export interface Books {
  /** Entries the shop has said are one item. */
  same?: SameGoods[]
  /** Costs the shop has settled by hand. */
  costs?: CostOverride[]
}

/**
 * Every line of every bill, with the cost of what went out on it.
 *
 * Returns count backwards: a sheet that came back on the 4th takes its sale
 * and its cost off the 24th's profit, because the shop is no worse and no
 * better off than before it went out.
 */
export function profitLines(bills: Bill[], books: Books = {}): ProfitLine[] {
  const same = books.same ?? []
  const resolve = resolver(same)
  const book = costBook(bills, same)
  const overrides = new Map((books.costs ?? []).map((o) => [resolve(o.ref), o]))
  const out: ProfitLine[] = []

  for (const bill of bills) {
    const kind = bill.kind ?? 'sale'
    if (kind !== 'sale' && kind !== 'return') continue
    const sign = kind === 'return' ? -1 : 1

    for (const item of billLines(bill.items ?? [])) {
      const qty = Number(item.qty)
      const amount = Number(item.amount)
      if (!(qty > 0) || !(amount > 0)) continue
      const name = String(item.description ?? '').trim()

      const line: ProfitLine = {
        billId: bill.id,
        number: bill.number,
        date: bill.date,
        kind: kind as 'sale' | 'return',
        party: bill.customerName ?? '',
        ref: resolve(refOf(item)),
        name,
        unit: item.unit ?? '',
        qty: qty * sign,
        sales: amount * sign,
        cost: 0,
      }

      if (LUMP.test(name)) {
        out.push({ ...line, gap: 'lump' })
        continue
      }

      const override = overrides.get(line.ref)
      let each: number | undefined
      let source: CostSource | undefined
      let from: PurchaseRate | undefined
      let dated: 'on-the-day' | 'earliest' | undefined

      if (typeof override?.cost === 'number') {
        each = override.cost
        source = 'typed'
      } else {
        const lookup = override?.sameAs ? resolve(override.sameAs) : line.ref
        const found = rateFor(lookup, bill.date, book)
        if (found) {
          from = found.rate
          dated = found.dated
          if (override?.sameAs) {
            source = 'linked'
            // Twenty 1 kg packs make one 20 kg drum, so one drum costs twenty
            // times the pack rate.
            each = found.rate.each * (override.per && override.per > 0 ? override.per : 1)
          } else {
            source = 'purchase'
            each = found.rate.each
          }
        }
      }

      if (each === undefined) {
        out.push({ ...line, gap: 'never-bought' })
        continue
      }
      // Both checks below are on the panel's own guess. A rate the shop typed
      // is the shop's answer, and a paired item is deliberately another item —
      // a 1 kg pack against a 20 kg drum differs in unit and in rate by
      // design, and querying that would be arguing with the person who said
      // it. Only a rate the panel found by itself has to answer for itself.
      if (source === 'purchase' && from && !sameUnit(from.unit, line.unit)) {
        out.push({ ...line, gap: 'different-unit', costEach: each, from })
        continue
      }
      if (source === 'purchase' && each < (amount / qty) * LOOKS_WRONG) {
        out.push({ ...line, gap: 'rate-looks-wrong', costEach: each, from })
        continue
      }

      out.push({ ...line, cost: each * qty * sign, costEach: each, source, from, dated })
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || Number(a.number) - Number(b.number))
}

/* ------------------------------------------------------------------ */
/* adding it up                                                        */
/* ------------------------------------------------------------------ */

export interface Totals {
  /** Everything sold, costed or not. */
  sales: number
  /** The part of it whose cost is known — the only part a margin is true of. */
  costedSales: number
  cost: number
  profit: number
  /** Profit over costed sales. Never over all sales, which would be a lie. */
  margin: number
  /** How much of the selling is actually being measured. */
  coverage: number
  lines: number
  costedLines: number
}

const sum = (rows: ProfitLine[], pick: (r: ProfitLine) => number) =>
  rows.reduce((t, r) => t + pick(r), 0)

export function totalsOf(lines: ProfitLine[]): Totals {
  const costed = lines.filter((l) => !l.gap)
  const sales = sum(lines, (l) => l.sales)
  const costedSales = sum(costed, (l) => l.sales)
  const cost = sum(costed, (l) => l.cost)
  return {
    sales,
    costedSales,
    cost,
    profit: costedSales - cost,
    margin: costedSales ? (costedSales - cost) / costedSales : 0,
    coverage: sales ? costedSales / sales : 0,
    lines: lines.length,
    costedLines: costed.length,
  }
}

export interface ItemRow extends Totals {
  ref: ItemRef
  /** The name it is sold under; the one the shop will recognise. */
  name: string
  /** Every spelling it has been sold under, when there is more than one. */
  names: string[]
  unit: string
  qty: number
  costEach?: number
  from?: PurchaseRate
  gap?: GapReason
  lines: number
  /** The sale lines behind the row, for opening it out. */
  rows: ProfitLine[]
}

function group(lines: ProfitLine[], by: (l: ProfitLine) => string) {
  const groups = new Map<string, ProfitLine[]>()
  for (const line of lines) {
    const held = groups.get(by(line))
    if (held) held.push(line)
    else groups.set(by(line), [line])
  }
  return groups
}

/** Each item, what went out of it, and what it made. Biggest earner first. */
export function byItem(lines: ProfitLine[]): ItemRow[] {
  const rows: ItemRow[] = []
  for (const [ref, mine] of group(lines, (l) => l.ref)) {
    const names = Array.from(new Set(mine.map((r) => r.name)))
    const priced = mine.find((r) => r.costEach !== undefined)
    rows.push({
      ...totalsOf(mine),
      ref,
      // The name most of the selling was done under — by value, not by how
      // many times it was typed. Forty sheets billed as "19mm Solid S 8 X 4"
      // name the row; four billed "19mm Solid SG 8 X 4" do not.
      name: names
        .map((n) => ({ n, worth: mine.filter((r) => r.name === n).reduce((t, r) => t + r.sales, 0) }))
        .sort((a, b) => b.worth - a.worth)[0].n,
      names,
      unit: mine[0].unit,
      qty: mine.reduce((t, r) => t + r.qty, 0),
      costEach: priced?.costEach,
      from: priced?.from,
      gap: mine.every((r) => r.gap) ? mine[0].gap : undefined,
      lines: mine.length,
      rows: mine,
    })
  }
  return rows.sort((a, b) => b.profit - a.profit || b.sales - a.sales)
}

export interface BillRow extends Totals {
  billId: string
  number: string
  date: string
  kind: 'sale' | 'return'
  party: string
  /** Charged to the customer for delivery. Never counted as profit. */
  fare: number
  rows: ProfitLine[]
}

const FARE = /^(?:fare|cartage|freight|transport)$/i

/** Each bill, and what the shop made on it. Newest first. */
export function byBill(lines: ProfitLine[], bills: Bill[]): BillRow[] {
  const fareOf = new Map(
    bills.map((b) => [
      b.id,
      billCharges(b.items ?? [])
        .filter((i) => FARE.test(String(i.description ?? '').trim()))
        .reduce((t, i) => t + Number(i.amount), 0),
    ]),
  )
  return Array.from(group(lines, (l) => l.billId), ([billId, rows]) => ({
    ...totalsOf(rows),
    billId,
    number: rows[0].number,
    date: rows[0].date,
    kind: rows[0].kind,
    party: rows[0].party,
    fare: fareOf.get(billId) ?? 0,
    rows,
  })).sort((a, b) => b.date.localeCompare(a.date) || Number(b.number) - Number(a.number))
}

export interface DayRow extends Totals {
  date: string
  bills: number
}

/** Each day's trading. */
export function byDay(lines: ProfitLine[]): DayRow[] {
  return Array.from(group(lines, (l) => l.date), ([date, rows]) => ({
    ...totalsOf(rows),
    date,
    bills: new Set(rows.map((r) => r.billId)).size,
  })).sort((a, b) => b.date.localeCompare(a.date))
}

/** What is being sold with no cost behind it, dearest first. */
export function gaps(lines: ProfitLine[]): ItemRow[] {
  return byItem(lines.filter((l) => l.gap)).sort((a, b) => b.sales - a.sales)
}

/** Only the bills written between two days, both ends included. */
export const within = (lines: ProfitLine[], from: string, to: string) =>
  lines.filter((l) => (!from || l.date >= from) && (!to || l.date <= to))
