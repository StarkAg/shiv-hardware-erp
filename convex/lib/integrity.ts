/**
 * Verify Data, the way Tally has it: every rule the books must keep, checked
 * against everything in them. Run every night (convex/integrity.ts) and on
 * demand; what it finds is shown on the panel's home page until it is put
 * right.
 *
 * Pure: it is handed the tables and says what is wrong, so the same rules run
 * in the nightly check, in the tests, and over a copy of the books.
 *
 * Written after RCT-445 (14 Oct 2026): a bill left behind when its voucher
 * was deleted showed in the day book as "Posted" for an entry that was gone,
 * and nothing said so until someone noticed.
 */
import { fyOf, lastPostableDate, round2 } from './money'

export type Problem = {
  kind: string
  text: string
  /** Where in the panel to put it right. */
  link?: string
}

type Line = { voucherId: string; ledgerId: string; side: 'Dr' | 'Cr'; amount: number; date: number }
type Voucher = {
  _id: string; typeId: string; voucherNo: number; fy: string; date: number
  partyLedgerId: string; status: string; amount?: number; refNo?: string
}

export type Books = {
  vouchers: Voucher[]
  entries: Line[]
  ledgers: { _id: string; name: string }[]
  types: { _id: string; abbr: string }[]
  bills: any[]
  /** The check's own clock, so "a date after today" is testable. */
  now: number
}

const close = (a: number, b: number) => Math.abs(a - b) < 0.005

export function findProblems({ vouchers, entries, ledgers, types, bills, now }: Books): Problem[] {
  const problems: Problem[] = []
  const add = (kind: string, text: string, link?: string) => problems.push({ kind, text, ...(link ? { link } : {}) })

  const abbr = new Map(types.map((t) => [String(t._id), t.abbr]))
  const accounts = new Map(ledgers.map((l) => [String(l._id), l.name]))
  const byId = new Map(vouchers.map((v) => [String(v._id), v]))
  const label = (v: Voucher) => `${abbr.get(String(v.typeId)) ?? 'VCH'}-${String(v.voucherNo).padStart(4, '0')}`
  const who = (v: Voucher) => accounts.get(String(v.partyLedgerId)) ?? 'an account that is gone'
  const at = (v: Voucher) => `/bills/voucher/${v._id}`

  const linesOf = new Map<string, Line[]>()
  for (const line of entries) {
    const key = String(line.voucherId)
    if (!linesOf.has(key)) linesOf.set(key, [])
    linesOf.get(key)!.push(line)
  }

  // ── each voucher ────────────────────────────────────────────────────────
  const lastMoment = lastPostableDate(now)
  for (const v of vouchers) {
    const lines = linesOf.get(String(v._id)) ?? []
    const name = `${label(v)} (${who(v)})`

    if (!accounts.has(String(v.partyLedgerId))) add('account', `${label(v)} is against an account that no longer exists.`, at(v))
    if (v.fy !== fyOf(v.date)) add('year', `${name} is numbered in ${v.fy} but dated in ${fyOf(v.date)}.`, at(v))
    if (v.date > lastMoment) add('date', `${name} is dated after today.`, at(v))

    if (v.status !== 'final') {
      // Filed without an amount, or goods received: nothing in the books yet.
      if (lines.length) add('lines', `${name} has no amount yet but posts ${lines.length} lines.`, at(v))
      continue
    }
    if (!lines.length) {
      add('lines', `${name} has an amount but nothing posted in the books.`, at(v))
      continue
    }
    const net = round2(lines.reduce((t, l) => t + (l.side === 'Dr' ? l.amount : -l.amount), 0))
    if (!close(net, 0)) add('balance', `${name} does not balance — debit and credit differ by ${Math.abs(net)}.`, at(v))

    // The amount is what the voucher is for. A part-paid sale posts it as its
    // debits (Cash + the customer); one written in four lines posts it on the
    // party's biggest line. Either way it must be there.
    const party = lines.filter((l) => String(l.ledgerId) === String(v.partyLedgerId))
    if (!party.length) add('party', `${name} posts nothing to its own party.`, at(v))
    const debits = round2(lines.filter((l) => l.side === 'Dr').reduce((t, l) => t + l.amount, 0))
    const biggest = Math.max(0, ...party.map((l) => l.amount))
    if (typeof v.amount === 'number' && !close(v.amount, debits) && !close(v.amount, biggest)) {
      add('amount', `${name} says ${v.amount} but its lines post ${debits}.`, at(v))
    }

    for (const l of lines) {
      if (!accounts.has(String(l.ledgerId))) add('account', `${name} posts to an account that no longer exists.`, at(v))
      if (l.date !== v.date) add('date', `${name} has a line dated differently from the voucher.`, at(v))
    }
  }

  // Lines whose voucher is gone count in every balance and open nowhere.
  for (const [id, lines] of linesOf) {
    if (!byId.has(id)) add('lines', `${lines.length} lines in the books belong to a voucher that no longer exists.`)
  }

  // ── numbers ─────────────────────────────────────────────────────────────
  const numbered = new Map<string, Voucher>()
  for (const v of vouchers) {
    const key = `${v.typeId}|${v.fy}|${v.voucherNo}`
    const first = numbered.get(key)
    if (first) add('number', `${label(v)} ${v.fy} is used twice: ${who(first)} and ${who(v)}.`, at(v))
    else numbered.set(key, v)
  }

  // ── bills against the books ─────────────────────────────────────────────
  const byRef = new Map<string, Voucher[]>()
  for (const v of vouchers) {
    if (!v.refNo?.startsWith('BILL-')) continue
    if (!byRef.has(v.refNo)) byRef.set(v.refNo, [])
    byRef.get(v.refNo)!.push(v)
  }
  const billNumbers = new Set<string>()
  for (const b of bills) {
    if (!b?.id) continue
    const number = String(b.number ?? '')
    const name = `Bill ${number} (${b.customerName || 'no name'})`
    const link = `/bills/${b.id}`
    if (number) {
      if (billNumbers.has(number)) add('number', `Bill number ${number} is used twice.`, link)
      billNumbers.add(number)
    }
    if (b.kind === 'quotation') continue
    if (b.ledgerId && !accounts.has(String(b.ledgerId))) add('account', `${name} is for an account that no longer exists.`, link)

    // Its voucher: the one it names, or — for bills written before they named
    // one — the voucher carrying its BILL-n reference for the same party.
    let voucher: Voucher | undefined
    if (b.voucherId) {
      voucher = byId.get(String(b.voucherId))
      if (!voucher) {
        add('bill', `${name} says it is posted, but its voucher is not in the books.`, link)
        continue
      }
    } else {
      voucher = (byRef.get(`BILL-${number}`) ?? [])
        .find((v) => !b.ledgerId || String(v.partyLedgerId) === String(b.ledgerId))
      if (!voucher) {
        add('bill', `${name} is not in the books.`, link)
        continue
      }
    }
    if (voucher.status === 'final' && typeof b.total === 'number' && typeof voucher.amount === 'number' &&
        !close(b.total, voucher.amount)) {
      add('bill', `${name} totals ${b.total} but its voucher ${label(voucher)} says ${voucher.amount}.`, link)
    }
  }

  return problems
}
