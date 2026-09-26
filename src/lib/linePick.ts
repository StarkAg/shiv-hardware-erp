/**
 * What a line keeps when an item is picked onto it.
 *
 * A catalogue item remembers the rate and unit it was last sold at, and picking
 * it used to stamp those over the line — and, for an item with no rate saved,
 * set the amount to nothing. So renaming "1" Baffer" to "1" Buffer" on a line
 * already priced at 20 pieces lost the price.
 *
 * What the counter has typed on the line wins. The item's remembered figures
 * only fill what the line does not have yet; the unit stays whatever the line
 * was set to unless it is still the default, and can be changed afterwards.
 */
import { canonicalUnit } from '../../convex/lib/text'

export interface LineFigures {
  qty?: number
  unit?: string
  amount?: number
  rateSqft?: number
}

export interface Remembered {
  rate?: number
  unit?: string
  unitRates?: Record<string, number>
}

const DEFAULT_UNIT = 'Pc'

/** The key a unit's rate is kept under — "pkt", "PKT" and "Pkt." are one unit. */
export const unitKey = (unit: string | undefined) => canonicalUnit(unit || DEFAULT_UNIT)

/**
 * The remembered rate for one unit. An item saved before rates were kept per
 * unit has only its one `rate`, and that stands for every unit; once any unit
 * has its own figure, a unit without one has no rate rather than borrowing a
 * packet's price for a piece.
 */
export function rateForUnit(remembered: Remembered, unit: string | undefined): number {
  const byUnit = remembered.unitRates ?? {}
  if (!Object.keys(byUnit).length) return Number(remembered.rate) || 0
  return Number(byUnit[unitKey(unit)]) || 0
}

/** The per-unit rates with this unit's figure brought up to date. */
export function withUnitRate(unitRates: Record<string, number> | undefined, unit: string | undefined, rate: number): Record<string, number> {
  return { ...(unitRates ?? {}), [unitKey(unit)]: rate }
}

export function keepTyped(line: LineFigures, remembered: Remembered): Required<Pick<LineFigures, 'amount'>> & Pick<LineFigures, 'rateSqft' | 'unit'> {
  const qty = Number(line.qty) || 1
  const typedAmount = Number(line.amount) || 0
  const unit = line.unit && line.unit !== DEFAULT_UNIT
    ? line.unit
    : (remembered.unit || line.unit || DEFAULT_UNIT)
  const rate = rateForUnit(remembered, unit)

  if (typedAmount) {
    return { amount: typedAmount, rateSqft: line.rateSqft ?? Math.round((typedAmount / qty) * 100) / 100, unit }
  }
  if (rate) {
    return { amount: Math.round(rate * qty), rateSqft: rate, unit }
  }
  return { amount: 0, rateSqft: line.rateSqft, unit }
}
