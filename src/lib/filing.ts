/**
 * Where each physical bill goes.
 *
 * The shop has a few thousand loose slips and a table with numbered cards on
 * it. A card is a slot: the app says "12" and the bill goes on the pile wearing
 * card 12. When a customer's bundle is lifted off into their folder the card
 * is free again.
 *
 * The obvious arrangement — one card per customer — does not survive contact
 * with the pile. It only works while the shop has fewer customers than cards,
 * and nobody knows whether that is true until the sorting is well under way.
 * Meet one customer more than there are cards and there is nowhere to put the
 * bill, which happens a few hundred slips in, with every card already holding
 * a live pile.
 *
 * So the sort is done the way a post office does it, in two passes. The
 * customers are split into **buckets** first, each bucket small enough that its
 * customers are guaranteed to fit on the cards. Sweep one throws every bill
 * into its bucket; sweep two takes one bucket at a time and splits it into
 * customer piles. Two passes over the paper, and it cannot jam.
 *
 * The second pass buys something the one-card-per-customer arrangement can
 * never have. A bucket holds every bill of every customer in it — the split is
 * by customer, so no bill of theirs is anywhere else. The moment a bucket's
 * second sweep ends, those customers are finished, and their bundles can be
 * stapled with no possibility of a straggler turning up at slip 1,900.
 *
 * Nothing here talks to the database. It is given what each customer holds and
 * how many cards are on the table, and it answers with the plan.
 */

/** One customer and how many of their bills are waiting to be sorted. */
export type PartyLoad = {
  partyLedgerId: string
  /** Shown back to the shop when the plan is explained; never sorted on. */
  name?: string
  bills: number
}

export type Bucket = {
  bucket: number
  parties: string[]
  bills: number
}

export type Plan = {
  buckets: Bucket[]
  /** Cards on the table, as the shop counted them. */
  slotCount: number
  /**
   * True when every customer fits on the cards at once, so sweep one is
   * skipped entirely and the paper is handled once instead of twice.
   */
  oneSweep: boolean
  parties: number
  bills: number
  /** The fullest sweep-two pile, which is what one sitting actually costs. */
  largestBucket: number
}

/**
 * How many bills one sweep-two pile should hold before it stops being an
 * afternoon's work. Advisory: it raises the number of buckets when the paper
 * would otherwise stack up, and it cannot push past the number of cards.
 */
const COMFORTABLE_PILE = 150

/**
 * A customer is never split across buckets, so a single very busy customer can
 * carry a bucket past the comfortable size on their own. That is not a fault to
 * correct — their bills have to be in one place to be stapled.
 */
export function planBuckets(parties: PartyLoad[], slotCount: number): Plan {
  if (!Number.isInteger(slotCount) || slotCount < 2) {
    throw new Error('Lay out at least two cards')
  }

  const loads = parties.filter((p) => p.bills > 0)
  const bills = loads.reduce((n, p) => n + p.bills, 0)

  if (!loads.length) {
    return { buckets: [], slotCount, oneSweep: true, parties: 0, bills: 0, largestBucket: 0 }
  }

  // Everyone fits on the table at once: no bucketing, one pass over the paper.
  if (loads.length <= slotCount) {
    const only: Bucket = {
      bucket: 1,
      parties: ordered(loads).map((p) => p.partyLedgerId),
      bills,
    }
    return {
      buckets: [only],
      slotCount,
      oneSweep: true,
      parties: loads.length,
      bills,
      largestBucket: bills,
    }
  }

  // Two sweeps can hold slotCount buckets of slotCount customers each, and no
  // more. Beyond that the answer is more cards, not a third sweep — say so
  // rather than producing a plan that jams halfway through.
  if (loads.length > slotCount * slotCount) {
    throw new Error(
      `${loads.length} parties will not sort on ${slotCount} cards — lay out at least ${Math.ceil(Math.sqrt(loads.length))}`,
    )
  }

  const need = Math.ceil(loads.length / slotCount)
  const comfortable = Math.ceil(bills / COMFORTABLE_PILE)
  const count = Math.min(slotCount, Math.max(need, comfortable))

  const buckets: Bucket[] = Array.from({ length: count }, (_, i) => ({
    bucket: i + 1,
    parties: [],
    bills: 0,
  }))

  // Biggest customers placed first, each onto the lightest bucket still able to
  // take another customer. Placing the big ones last is what leaves a bucket
  // twice the size of its neighbours.
  for (const party of ordered(loads)) {
    let best: Bucket | undefined
    for (const b of buckets) {
      if (b.parties.length >= slotCount) continue
      if (!best || b.bills < best.bills) best = b
    }
    // Unreachable while count * slotCount >= loads.length, which the bucket
    // count above guarantees. Thrown rather than dropping a customer's bills.
    if (!best) throw new Error('Ran out of room while planning — count the cards again')
    best.parties.push(party.partyLedgerId)
    best.bills += party.bills
  }

  return {
    buckets,
    slotCount,
    oneSweep: false,
    parties: loads.length,
    bills,
    largestBucket: buckets.reduce((n, b) => Math.max(n, b.bills), 0),
  }
}

/**
 * Busiest first, and ties broken by id so the same pile always plans the same
 * way — a plan that shuffled between two runs would be impossible to check.
 */
function ordered(loads: PartyLoad[]): PartyLoad[] {
  return [...loads].sort(
    (a, b) => b.bills - a.bills || (a.partyLedgerId < b.partyLedgerId ? -1 : 1),
  )
}

/** Which bucket each customer was put in. */
export function bucketOf(plan: Plan): Map<string, number> {
  const map = new Map<string, number>()
  for (const b of plan.buckets) for (const id of b.parties) map.set(id, b.bucket)
  return map
}

/**
 * Which card a bill goes on, given the piles already standing.
 *
 * A customer keeps the card they were given until their bundle is lifted off,
 * so the bills of one customer land together however scattered they were in the
 * stack. A customer not yet on the table takes the lowest free card — lowest so
 * the piles fill from one end of the table and the eye knows where to look.
 */
export function slotFor(
  partyLedgerId: string,
  held: Map<string, number>,
  slotCount: number,
): number {
  const already = held.get(partyLedgerId)
  if (already !== undefined) return already

  const taken = new Set(held.values())
  for (let card = 1; card <= slotCount; card += 1) {
    if (!taken.has(card)) return card
  }
  // The bucket was planned to fit the cards, so this means the plan and the
  // table have drifted apart — a card cleared without its bundle being filed,
  // most likely.
  throw new Error('Every card is holding a pile — file a bundle before going on')
}

/* ------------------------------------------------------------------ */
/* stack letters                                                       */
/* ------------------------------------------------------------------ */

/**
 * "A", "B" … "Z", "AA", "AB". The letters on the cards that sit on top of each
 * stack of paper, counted from zero.
 */
export function stackLabel(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error('A stack is counted from zero')
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

/** The inverse: "A" is 0, "Z" is 25, "AA" is 26. */
export function stackIndex(label: string): number {
  const clean = label.trim().toUpperCase()
  if (!/^[A-Z]+$/.test(clean)) throw new Error(`"${label}" is not a stack letter`)
  let n = 0
  for (const ch of clean) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/**
 * The stack before this one. "A" has none, so it keeps its own — slips nudged
 * off the front of the first stack have nowhere earlier to go, and they are
 * physically in that stack whatever the app calls them.
 */
export function previousStack(label: string): string {
  const i = stackIndex(label)
  return i <= 0 ? label : stackLabel(i - 1)
}
