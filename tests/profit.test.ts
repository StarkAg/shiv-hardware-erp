import { describe, expect, test } from 'vitest'
import {
  byBill,
  byDay,
  byItem,
  foldItemName,
  gaps,
  profitLines,
  purchasedItems,
  refOf,
  resolver,
  totalsOf,
  within,
} from '../src/lib/profit'
import type { Bill, BillItem } from '../src/lib/types'

let seq = 0
const line = (
  description: string,
  qty: number,
  amount: number,
  opts: { unit?: string; entry?: string } = {},
): BillItem =>
  ({
    id: `l${(seq += 1)}`,
    description,
    qty,
    unit: opts.unit ?? 'Pc',
    amount,
    ...(opts.entry ? { customEntryId: opts.entry } : {}),
  }) as BillItem

const bill = (kind: Bill['kind'], number: string, date: string, items: BillItem[], party = 'A Party'): Bill =>
  ({
    id: `b${number}`,
    number,
    date,
    kind,
    customerName: party,
    items,
    total: items.reduce((t, i) => t + i.amount, 0),
    paid: true,
  }) as Bill

/** Round to paise, the way every figure on the page is read. */
const p2 = (n: number) => Math.round(n * 100) / 100

describe('which item a line is', () => {
  test('a line picked from My Items is known by that entry, whatever it was renamed to', () => {
    expect(refOf({ description: '12mm S 8 X 4', customEntryId: 'abc' })).toBe(
      refOf({ description: '12mm SG 8 X 4', customEntryId: 'abc' }),
    )
  })

  test('a line typed freehand is known by its name, tidied but not interpreted', () => {
    expect(refOf({ description: '12mm SG 8 X 4' })).toBe(refOf({ description: '12mm sg  8x4' }))
    expect(foldItemName('30mm S 78 × 38')).toBe(foldItemName('30mm S 78x38'))
  })

  test('nothing about the shop is read into a name', () => {
    // SG and S are the one Signature, and the panel has no way of knowing it.
    // That is said in itemSame, not guessed here.
    expect(refOf({ description: '12mm SG 8 X 4' })).not.toBe(refOf({ description: '12mm S 8 X 4' }))
  })

  test('a chain of pairings comes to one answer from either end', () => {
    const resolve = resolver([
      { from: 'id:a', to: 'id:b' },
      { from: 'id:b', to: 'id:c' },
    ])
    expect(resolve('id:a')).toBe('id:c')
    expect(resolve('id:b')).toBe('id:c')
    expect(resolve('id:c')).toBe('id:c')
  })

  test('a pairing that points back at itself stops rather than hangs', () => {
    const resolve = resolver([
      { from: 'id:a', to: 'id:b' },
      { from: 'id:b', to: 'id:a' },
    ])
    expect(['id:a', 'id:b']).toContain(resolve('id:a'))
  })
})

describe('what a purchase really cost', () => {
  test('GST on the bill is part of what the stock cost', () => {
    // Purchase 58, Mahadev: 3,508.50 of Sunmica with 9% and 9% on top.
    const bills = [
      bill('purchase', '58', '2026-09-03', [
        line('Sunmica HR 8221 SF', 6, 3508.5),
        line('CGST 9%', 1, 315.77),
        line('SGST 9%', 1, 315.77),
      ]),
    ]
    expect(p2(purchasedItems(bills)[0].each)).toBe(690.01)
  })

  test('a discount off the bottom is shared over the goods', () => {
    // Purchase 90, Shree Shyam: 4,500 of Sunmica less 250.
    const bills = [
      bill('purchase', '90', '2026-09-14', [
        line('Sunmica HT 4284 NGN', 3, 2700),
        line('Sunmica HT 111 HDG', 1, 900),
        line('Sunmica HT 240 HDG', 1, 900),
        line('Discount', 1, -250),
      ]),
    ]
    const rates = new Map(purchasedItems(bills).map((i) => [i.name, p2(i.each)]))
    expect(rates.get('Sunmica HT 4284 NGN')).toBe(850)
    expect(rates.get('Sunmica HT 111 HDG')).toBe(850)
  })
})

describe('profit on what went out', () => {
  // The board as it stands once the supplier's entry has been folded into the
  // shop's: one My Items id on both sides.
  const SG12 = 'e12sg84'
  const purchase = bill('purchase', '49', '2026-09-05', [
    line('12mm SG 8 X 4', 5, 9440, { entry: SG12 }),
  ])

  test('a sale is costed at the rate in force on the day', () => {
    const sale = bill('sale', '18', '2026-09-09', [line('12mm SG 8 X 4', 2, 6144, { entry: SG12 })])
    const [row] = profitLines([purchase, sale])
    expect(row.costEach).toBe(1888)
    expect(row.cost).toBe(3776)
    expect(row.sales - row.cost).toBe(2368)
    expect(row.dated).toBe('on-the-day')
  })

  test('a sale before the first purchase takes the earliest rate, and says so', () => {
    const sale = bill('sale', '105', '2026-08-24', [line('12mm SG 8 X 4', 3, 9216, { entry: SG12 })])
    const [row] = profitLines([purchase, sale])
    expect(row.costEach).toBe(1888)
    expect(row.dated).toBe('earliest')
  })

  test('a fare charged to the customer is neither sales nor profit', () => {
    const sale = bill('sale', '18', '2026-09-09', [
      line('12mm SG 8 X 4', 2, 6144, { entry: SG12 }),
      line('Fare', 1, 700),
    ])
    const lines = profitLines([purchase, sale])
    expect(lines).toHaveLength(1)
    expect(totalsOf(lines).sales).toBe(6144)
    expect(byBill(lines, [purchase, sale])[0].fare).toBe(700)
  })

  test('a goods return takes back both the sale and its cost', () => {
    const sale = bill('sale', '105', '2026-08-24', [line('12mm SG 8 X 4', 10, 30720, { entry: SG12 })])
    const back = bill('return', '107', '2026-09-04', [line('12mm SG 8 X 4', 3, 9216, { entry: SG12 })])
    const lines = profitLines([purchase, sale, back])
    const t = totalsOf(lines)
    expect(t.sales).toBe(30720 - 9216)
    expect(t.cost).toBe(1888 * 7)
    // The day the goods came back is a loss on its own.
    expect(byDay(lines).find((d) => d.date === '2026-09-04')?.profit).toBe(-(9216 - 1888 * 3))
  })

  test('margin is worked on the costed part, never on all the selling', () => {
    const sale = bill('sale', '18', '2026-09-09', [
      line('12mm SG 8 X 4', 2, 6144, { entry: SG12 }),
      line('Sunmica 1mm', 1, 1800),
    ])
    const t = totalsOf(profitLines([purchase, sale]))
    expect(t.sales).toBe(7944)
    expect(t.costedSales).toBe(6144)
    expect(t.margin).toBeCloseTo(2368 / 6144, 6)
    expect(t.coverage).toBeCloseTo(6144 / 7944, 6)
  })
})

describe('two entries the shop has said are one item', () => {
  // The 81×30 door: sold under two of the shop's own names, bought under a
  // third. The customer's two must both stand, so all three are paired.
  const SG = 'id:door-sg', S = 'id:door-s', BOUGHT = 'id:door-pf'
  const same = [
    { from: SG, to: S },
    { from: BOUGHT, to: S },
  ]
  const bills = [
    bill('purchase', '49', '2026-09-05', [
      line('30mm F.Door PF S 81 X 30', 2, 4050, { entry: 'door-pf' }),
    ]),
    bill('sale', '18', '2026-09-09', [line('30mm SG 81 X 30', 2, 6581, { entry: 'door-sg' })]),
    bill('sale', '53', '2026-09-13', [line('30mm S 81 X 30', 1, 2700, { entry: 'door-s' })]),
  ]

  test('unpaired, the sales have no cost at all', () => {
    expect(totalsOf(profitLines(bills)).costedSales).toBe(0)
  })

  test('paired, all three are one item and both sales are costed', () => {
    const lines = profitLines(bills, { same })
    const t = totalsOf(lines)
    expect(t.costedSales).toBe(9281)
    expect(t.cost).toBe(2025 * 3)
    expect(t.profit).toBe(9281 - 6075)
    expect(byItem(lines)).toHaveLength(1)
  })

  test('the row is named after the wording most of the selling used', () => {
    const [row] = byItem(profitLines(bills, { same }))
    expect(row.name).toBe('30mm SG 81 X 30')
    expect(row.names).toEqual(['30mm SG 81 X 30', '30mm S 81 X 30'])
  })
})

describe('lines that cannot honestly be costed', () => {
  test('a case bought is not a rate for a piece sold', () => {
    const bills = [
      bill('purchase', '19', '2026-09-09', [line('Abro Tape', 1, 2352, { unit: 'C/s', entry: 'tape' })]),
      bill('sale', '30', '2026-09-12', [line('Abro Tape', 12, 1440, { entry: 'tape' })]),
    ]
    const [row] = profitLines(bills)
    expect(row.gap).toBe('different-unit')
    expect(row.cost).toBe(0)
  })

  test('a board bought in Pc and sold as a Sheet is the same board', () => {
    const bills = [
      bill('purchase', '49', '2026-09-05', [line('12mm SG 8 X 4', 5, 9440, { entry: 'sg12' })]),
      bill('sale', '53', '2026-09-13', [line('12mm SG 8 X 4', 1, 2496, { unit: 'Sheet', entry: 'sg12' })]),
    ]
    expect(profitLines(bills)[0].gap).toBeUndefined()
  })

  test('a purchase rate a fraction of the selling rate is set aside, not believed', () => {
    // A Fevicol supplier's bill priced a 19mm board at 348.10 a sheet.
    const bills = [
      bill('purchase', '39', '2026-09-10', [line('19mm Solid Black Tiger 8 X 4', 4, 1392.4, { entry: 'bt' })]),
      bill('sale', '95', '2026-09-14', [line('19mm Solid Black Tiger 8 X 4', 10, 35200, { entry: 'bt' })]),
    ]
    const [row] = profitLines(bills)
    expect(row.gap).toBe('rate-looks-wrong')
    expect(row.cost).toBe(0)
    expect(gaps(profitLines(bills))[0].sales).toBe(35200)
  })

  test('a bill entered as one amount has no item to cost', () => {
    expect(profitLines([bill('sale', '77', '2026-09-12', [line('Bill', 1, 12000)])])[0].gap).toBe('lump')
  })

  test('something never bought here is listed, not guessed at', () => {
    const bills = [bill('sale', '53', '2026-09-13', [line('Sunmica 1mm', 75, 135000)])]
    expect(profitLines(bills)[0].gap).toBe('never-bought')
  })
})

describe('costs the shop settles by hand', () => {
  const bills = [
    bill('purchase', '39', '2026-09-10', [
      line('Fevicol Marine NF 1 Kg', 24, 8384.98, { entry: 'fev1' }),
    ]),
    bill('sale', '95', '2026-09-14', [line('Fevicol Marine 20 Kg', 1, 5800, { entry: 'fev20' })]),
  ]
  const drum = refOf({ description: 'Fevicol Marine 20 Kg', customEntryId: 'fev20' })
  const pack = refOf({ description: 'Fevicol Marine NF 1 Kg', customEntryId: 'fev1' })

  test('a rate typed by hand is used as typed', () => {
    const [row] = profitLines(bills, { costs: [{ ref: drum, cost: 4200 }] })
    expect(row.source).toBe('typed')
    expect(row.cost).toBe(4200)
    expect(row.sales - row.cost).toBe(1600)
  })

  test('a typed rate is taken at its word even where a matched one would not be', () => {
    // Below the quarter that would set a matched rate aside: the shop said it.
    const [row] = profitLines(bills, { costs: [{ ref: drum, cost: 900 }] })
    expect(row.gap).toBeUndefined()
    expect(row.cost).toBe(900)
  })

  test('twenty packs make a drum, so a drum costs twenty times the pack', () => {
    const [row] = profitLines(bills, { costs: [{ ref: drum, sameAs: pack, per: 20 }] })
    expect(row.source).toBe('linked')
    expect(p2(row.cost)).toBe(p2(349.374166666 * 20))
    expect(row.cost).toBeGreaterThan(6900)
  })

  test('with nothing said about how many, one of those makes one of these', () => {
    const [row] = profitLines(bills, { costs: [{ ref: drum, sameAs: pack }] })
    expect(p2(row.cost)).toBe(349.37)
  })

  test('a pairing is not held to the unit, because it is deliberately another item', () => {
    const rows = profitLines(
      [
        bill('purchase', '19', '2026-09-09', [line('Abro Tape', 1, 2352, { unit: 'C/s', entry: 'case' })]),
        bill('sale', '30', '2026-09-12', [line('Abro Tape', 12, 1440, { entry: 'roll' })]),
      ],
      {
        costs: [
          {
            ref: refOf({ description: 'Abro Tape', customEntryId: 'roll' }),
            sameAs: refOf({ description: 'Abro Tape', customEntryId: 'case' }),
            per: 1 / 12,
          },
        ],
      },
    )
    expect(rows[0].gap).toBeUndefined()
    expect(p2(rows[0].cost)).toBe(2352)
  })
})

describe('adding it up', () => {
  const SG12 = 'sg12'
  const bills = [
    bill('purchase', '49', '2026-09-05', [line('12mm SG 8 X 4', 5, 9440, { entry: SG12 })]),
    bill('sale', '18', '2026-09-09', [line('12mm SG 8 X 4', 2, 6144, { entry: SG12 })], 'Sanjay Prasad'),
    bill('sale', '53', '2026-09-13', [
      line('12mm SG 8 X 4', 20, 49920, { entry: SG12 }),
      line('Sunmica 1mm', 5, 9000),
    ], 'WB'),
  ]
  const lines = profitLines(bills)

  test('an item gathers every line it sold on', () => {
    const row = byItem(lines).find((r) => r.ref === refOf({ description: '', customEntryId: SG12 }))!
    expect(row.qty).toBe(22)
    expect(row.profit).toBe(2368 + 12160)
    expect(row.lines).toBe(2)
  })

  test('a bill says how much of itself is measured', () => {
    const wb = byBill(lines, bills).find((b) => b.number === '53')!
    expect(wb.sales).toBe(58920)
    expect(wb.costedSales).toBe(49920)
    expect(wb.costedLines).toBe(1)
    expect(wb.lines).toBe(2)
    expect(wb.profit).toBe(12160)
  })

  test('days read newest first, and a period takes both ends', () => {
    expect(byDay(lines).map((d) => d.date)).toEqual(['2026-09-13', '2026-09-09'])
    expect(within(lines, '2026-09-13', '2026-09-13')).toHaveLength(2)
    expect(within(lines, '', '2026-09-09')).toHaveLength(1)
  })
})
