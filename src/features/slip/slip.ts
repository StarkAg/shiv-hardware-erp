/**
 * The shop's handwritten credit slip: a stamped number, the balance brought
 * forward, the items, and the new balance. Nothing here touches the books.
 */

export type SlipRow = {
  id: string
  item: string
  qty: string
  unit: string
  /** Only a help for working out the amount. The slip never prints a rate. */
  rate: string
  amount: string
}

export type Slip = {
  number: string
  previous: string
  rows: SlipRow[]
  note: string
}

export const DEFAULT_NOTE = 'P.TO'

export const newRow = (): SlipRow => ({
  id: Math.random().toString(36).slice(2),
  item: '',
  qty: '',
  unit: 'Pc',
  rate: '',
  amount: '',
})

const toNumber = (text: string) => {
  const value = Number(String(text).replace(/,/g, '').trim())
  return Number.isFinite(value) ? value : 0
}

const roundPaise = (value: number) => Math.round(value * 100) / 100

/** A figure the way it is written on the slip: no commas, no needless paise. */
export const slipFigure = (value: number) => String(roundPaise(value))

/** The amount a rate works out to, or '' while qty or rate is still missing. */
export const amountFromRate = (qty: string, rate: string) => {
  const worked = toNumber(qty) * toNumber(rate)
  return worked > 0 ? slipFigure(worked) : ''
}

/** Rows that go on paper: a row with neither an item nor an amount is still blank. */
export const printedRows = (rows: SlipRow[]) => rows.filter((row) => row.item.trim() || row.amount.trim())

export const slipTotal = (slip: Pick<Slip, 'previous' | 'rows'>) =>
  roundPaise(slip.rows.reduce((sum, row) => sum + toNumber(row.amount), toNumber(slip.previous)))

/** The numbering stamp prints at least two digits: 09. */
export const stampedNumber = (number: string) => String(number).trim().padStart(2, '0')

export const nextNumber = (number: string) => String((parseInt(number, 10) || 0) + 1)

/** Same input, same wobble: a slip must not change shape between preview and picture. */
export const wobble = (seed: number, spread: number) => {
  const raw = Math.sin(seed * 12.9898 + 4.1414) * 43758.5453
  return ((raw - Math.floor(raw)) * 2 - 1) * spread
}

/** The slip the shop wrote on 2 Nov 2026, shown until the first new one. */
export const FIRST_SLIP: Slip = {
  number: '9',
  previous: '29334',
  note: DEFAULT_NOTE,
  rows: (
    [
      ['10" Aldrop Acer Slide', '2', 'Set', '360'],
      ['6" Handle Silver', '4', 'Pc', '440'],
      ['6" FB Acer Slide', '2', 'Pc', '240'],
      ['Door Magnet', '2', 'Pc', '170'],
      ['Nut Bolt', '12', 'Pc', '72'],
      ['5" Hinges Acer Slide', '6', 'Pc', '588'],
      ['1 1/2" Screw SS (7)', '60', 'Pc', '90'],
      ['3/4" Screw SS (4)', '30', 'Pc', '25'],
      ['32x6 Screw Steel', '12', 'Pc', '15'],
      ['1 1/2" Gutka', '12', 'Pc', '5'],
    ] as const
  ).map(([item, qty, unit, amount]) => ({ ...newRow(), item, qty, unit, amount })),
}
