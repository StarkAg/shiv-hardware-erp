import { describe, expect, test } from 'vitest'
import {
  bucketOf,
  planBuckets,
  previousStack,
  slotFor,
  stackIndex,
  stackLabel,
  type PartyLoad,
} from '../src/lib/filing'

const parties = (counts: number[]): PartyLoad[] =>
  counts.map((bills, i) => ({ partyLedgerId: `p${String(i).padStart(4, '0')}`, bills }))

/** Every customer placed exactly once, and no bucket wider than the table. */
const wellFormed = (loads: PartyLoad[], slotCount: number) => {
  const plan = planBuckets(loads, slotCount)
  const seen = plan.buckets.flatMap((b) => b.parties)
  expect(new Set(seen).size).toBe(seen.length)
  expect(seen.sort()).toEqual(loads.filter((p) => p.bills > 0).map((p) => p.partyLedgerId).sort())
  for (const b of plan.buckets) expect(b.parties.length).toBeLessThanOrEqual(slotCount)
  expect(plan.buckets.length).toBeLessThanOrEqual(slotCount)
  return plan
}

describe('planBuckets', () => {
  test('everyone fits on the cards: one sweep, no bucketing', () => {
    const plan = wellFormed(parties(Array(28).fill(5)), 40)
    expect(plan.oneSweep).toBe(true)
    expect(plan.buckets).toHaveLength(1)
    expect(plan.bills).toBe(140)
  })

  test('exactly as many parties as cards still fits in one sweep', () => {
    expect(wellFormed(parties(Array(40).fill(3)), 40).oneSweep).toBe(true)
  })

  test('one party more than there are cards forces the second sweep', () => {
    const plan = wellFormed(parties(Array(41).fill(3)), 40)
    expect(plan.oneSweep).toBe(false)
    expect(plan.buckets.length).toBeGreaterThan(1)
  })

  test('the real shape: ~150 parties, 2,000 bills, 40 cards', () => {
    // A long tail, as a shop actually has — a few regulars and many one-offs.
    const counts = [180, 140, 95, 80, 70, 60, 55, 50, 45, 40]
    while (counts.length < 150) counts.push(counts.length < 60 ? 20 : 4)
    const plan = wellFormed(parties(counts), 40)
    expect(plan.parties).toBe(150)
    expect(plan.oneSweep).toBe(false)
    // Each sweep-two pile is one sitting's work, not an afternoon's.
    expect(plan.largestBucket).toBeLessThan(400)
  })

  test('parties with no bills waiting are left out of the plan', () => {
    const plan = wellFormed([...parties([5, 3]), { partyLedgerId: 'pZ', bills: 0 }], 10)
    expect(plan.parties).toBe(2)
    expect(plan.buckets.flatMap((b) => b.parties)).not.toContain('pZ')
  })

  test('nothing to sort', () => {
    const plan = planBuckets([], 40)
    expect(plan.buckets).toHaveLength(0)
    expect(plan.bills).toBe(0)
  })
})

describe('what the plan refuses to do', () => {
  test('too many parties for the cards is refused, not quietly jammed', () => {
    // 40 cards can carry 40 buckets of 40; 1,601 parties cannot be sorted.
    expect(() => planBuckets(parties(Array(1601).fill(1)), 40)).toThrow(/lay out at least/i)
  })

  test('the refusal says how many cards would do', () => {
    expect(() => planBuckets(parties(Array(500).fill(1)), 20)).toThrow(/at least 23/)
  })

  test('a table with fewer than two cards is not a table', () => {
    expect(() => planBuckets(parties([1, 2]), 1)).toThrow(/at least two cards/i)
  })
})

describe('balance', () => {
  test('one enormous customer is not split, even though it unbalances a bucket', () => {
    const plan = wellFormed(parties([300, ...Array(99).fill(17)]), 20)
    const big = plan.buckets.find((b) => b.parties.includes('p0000'))!
    expect(big.bills).toBeGreaterThanOrEqual(300)
    // Their bills must all be in one place, or the bundle can never be stapled.
    expect(plan.buckets.filter((b) => b.parties.includes('p0000'))).toHaveLength(1)
  })

  test('piles come out roughly even when no single customer dominates', () => {
    const plan = wellFormed(parties(Array(120).fill(10)), 20)
    const sizes = plan.buckets.map((b) => b.bills)
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(20)
  })

  test('the same pile always plans the same way', () => {
    const loads = parties([9, 4, 9, 2, 7, 4, 1, 9])
    expect(planBuckets(loads, 3)).toEqual(planBuckets([...loads].reverse(), 3))
  })
})

describe('bucketOf', () => {
  test('answers which bucket a customer was put in', () => {
    const plan = planBuckets(parties(Array(50).fill(4)), 10)
    const map = bucketOf(plan)
    expect(map.size).toBe(50)
    for (const b of plan.buckets) {
      for (const id of b.parties) expect(map.get(id)).toBe(b.bucket)
    }
  })
})

describe('slotFor', () => {
  test('a customer already on the table keeps their card', () => {
    expect(slotFor('b', new Map([['a', 1], ['b', 2]]), 40)).toBe(2)
  })

  test('a new customer takes the lowest free card', () => {
    expect(slotFor('c', new Map([['a', 1], ['b', 2]]), 40)).toBe(3)
  })

  test('a card freed by a filed bundle is reused before any higher one', () => {
    expect(slotFor('d', new Map([['a', 1], ['c', 3]]), 40)).toBe(2)
  })

  test('a full table is refused rather than overwriting a live pile', () => {
    const held = new Map([['a', 1], ['b', 2], ['c', 3]])
    expect(() => slotFor('d', held, 3)).toThrow(/file a bundle/i)
  })

  test('bills scattered through the stack land on one card', () => {
    // The stack order is arbitrary; the cards are what gather a customer up.
    const stack = ['a', 'b', 'a', 'c', 'b', 'a', 'd', 'c']
    const held = new Map<string, number>()
    const given = stack.map((party) => {
      const card = slotFor(party, held, 4)
      held.set(party, card)
      return card
    })
    expect(given).toEqual([1, 2, 1, 3, 2, 1, 4, 3])
  })
})

describe('stack letters', () => {
  test('counts up through the alphabet and past it', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(stackLabel)).toEqual([
      'A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA',
    ])
  })

  test('the letter and its number are inverses', () => {
    for (let i = 0; i < 200; i += 1) expect(stackIndex(stackLabel(i))).toBe(i)
  })

  test('reads a letter typed in lower case or with spaces', () => {
    expect(stackIndex(' b ')).toBe(1)
  })

  test('the stack before this one', () => {
    expect(previousStack('B')).toBe('A')
    // Past Z is where the naive arithmetic went wrong: AA steps back to Z.
    expect(previousStack('AA')).toBe('Z')
    // The first stack has nothing before it, so it keeps its own letter —
    // those slips are physically in it whatever the app calls them.
    expect(previousStack('A')).toBe('A')
  })

  test('nonsense is refused rather than silently relabelling paper', () => {
    expect(() => stackIndex('A1')).toThrow(/not a stack letter/)
    expect(() => stackLabel(-1)).toThrow(/counted from zero/)
  })
})
