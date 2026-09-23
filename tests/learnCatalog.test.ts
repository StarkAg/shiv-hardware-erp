/// <reference types="vite/client" />
/**
 * A bill teaching the catalogue.
 *
 * The shop had billed 219 distinct items while the dropdown offered 54, so
 * every screw and every nail was typed out in full each time. These are the
 * rules that stop that happening again — and, just as important, the two
 * things the learning must never do: put a charge in the stock list, or let a
 * cost price become what the next sale opens at.
 */
import { describe, expect, it } from 'vitest'
import type { BillItem, CustomCatalogEntry } from '../src/lib/types'
import { RATES_KEPT, catalogChangesFor, isProductLine, unitRateOf } from '../src/lib/learnCatalog'

const line = (over: Partial<BillItem>): BillItem => ({
  id: 'l1', description: '', qty: 1, unit: 'Pc', amount: 0, ...over,
} as BillItem)

const screw = (over: Partial<BillItem> = {}) =>
  line({ description: '3" Screw SS (+)', qty: 100, unit: 'Pc', amount: 686, ...over })

const entry = (over: Partial<CustomCatalogEntry>): CustomCatalogEntry => ({
  id: 'c1', name: '3" Screw SS (+)', sizes: [], brands: [], ...over,
})

describe('a new item on a sale', () => {
  it('joins the catalogue', () => {
    const [c] = catalogChangesFor([screw()], [], 'sale')
    expect(c).toMatchObject({ op: 'add', name: '3" Screw SS (+)' })
  })

  it('brings its unit and the rate it was billed at', () => {
    const [c] = catalogChangesFor([screw()], [], 'sale')
    // 686 for 100 pieces is 6.86 each — the per-piece figure, not the line total.
    expect(c).toMatchObject({ unit: 'Pc', rate: 6.86, rates: [6.86] })
  })

  it('is added once however many lines of it the bill has', () => {
    const changes = catalogChangesFor([screw(), screw({ id: 'l2' })], [], 'sale')
    expect(changes.filter((c) => c.op === 'add')).toHaveLength(1)
  })

  it('does not care how the name was cased or spaced', () => {
    const known = [entry({})]
    const changes = catalogChangesFor([screw({ description: '3"  screw ss (+)' })], known, 'sale')
    expect(changes.every((c) => c.op === 'update')).toBe(true)
  })
})

describe('what is not stock', () => {
  /**
   * A fare, a round-off or a discount is a figure with a label. Letting these
   * in is how "Bill" ended up in the list priced at Rs 95,895.
   */
  it('keeps charges out of the catalogue', () => {
    const charges = [
      line({ description: 'Fare', amount: 200, amountOnly: true }),
      line({ description: 'RoundUp', amount: 2, isRoundup: true }),
      line({ description: 'Discount', amount: 50, isDiscount: true }),
    ]
    expect(catalogChangesFor(charges, [], 'sale')).toEqual([])
    expect(charges.every((l) => !isProductLine(l))).toBe(true)
  })

  it('ignores a line with nothing typed on it', () => {
    expect(catalogChangesFor([line({ description: '   ' })], [], 'sale')).toEqual([])
  })

  it('leaves a line that is already a catalogue item to its own controls', () => {
    expect(catalogChangesFor([screw({ customEntryId: 'c1' })], [], 'sale')).toEqual([])
  })
})

describe('a cost is not a price', () => {
  /**
   * The figure on a purchase is what the shop paid. It is worth keeping, so it
   * joins the list of rates offered on the row — but a default quietly set to
   * cost price sells the stock at cost.
   */
  it('never lets a purchase set the default rate', () => {
    for (const kind of ['purchase', 'grn'] as const) {
      const [c] = catalogChangesFor([screw()], [], kind)
      expect(c).toMatchObject({ op: 'add', rates: [6.86] })
      expect(c).not.toHaveProperty('rate')
    }
  })

  it('still records what was paid, so the figure is offered', () => {
    const [c] = catalogChangesFor([screw()], [entry({ rates: [5] })], 'purchase')
    expect(c).toMatchObject({ op: 'update', rates: [6.86, 5] })
    expect(c).not.toHaveProperty('rate')
  })

  it('does set the default on a sale', () => {
    const [c] = catalogChangesFor([screw()], [entry({ rate: 5, rates: [5] })], 'sale')
    expect(c).toMatchObject({ op: 'update', rate: 6.86, rates: [6.86, 5] })
  })
})

describe('an item the catalogue already knows', () => {
  it('moves the newest rate to the front without repeating it', () => {
    const [c] = catalogChangesFor([screw()], [entry({ rates: [6.86, 5] })], 'sale')
    expect((c as { rates: number[] }).rates).toEqual([6.86, 5])
  })

  it('keeps the list short enough to read', () => {
    const many = Array.from({ length: 20 }, (_, i) => i + 1)
    const [c] = catalogChangesFor([screw()], [entry({ rates: many })], 'sale')
    expect((c as { rates: number[] }).rates).toHaveLength(RATES_KEPT)
  })

  it('fills in a unit it never had', () => {
    const [c] = catalogChangesFor([screw()], [entry({ unit: undefined })], 'sale')
    expect(c).toMatchObject({ unit: 'Pc' })
  })

  it('does not overwrite a unit somebody chose', () => {
    const [c] = catalogChangesFor([screw({ unit: 'Pkt' })], [entry({ unit: 'Pc' })], 'sale')
    expect(c).not.toHaveProperty('unit')
  })

  it('says nothing at all when there is nothing to learn', () => {
    const noFigure = screw({ amount: 0 })
    expect(catalogChangesFor([noFigure], [entry({ unit: 'Pc' })], 'sale')).toEqual([])
  })
})

describe('the per-piece figure', () => {
  it('is the amount over the quantity', () => {
    expect(unitRateOf({ qty: 100, amount: 686 })).toBe(6.86)
  })

  it('is nothing when the line has no price or no quantity', () => {
    expect(unitRateOf({ qty: 0, amount: 686 })).toBe(0)
    expect(unitRateOf({ qty: 100, amount: 0 })).toBe(0)
  })

  it('does not invent paise beyond two places', () => {
    expect(unitRateOf({ qty: 3, amount: 10 })).toBe(3.33)
  })
})
