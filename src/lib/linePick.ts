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

export interface LineFigures {
  qty?: number
  unit?: string
  amount?: number
  rateSqft?: number
}

export interface Remembered {
  rate?: number
  unit?: string
}

const DEFAULT_UNIT = 'Pc'

export function keepTyped(line: LineFigures, remembered: Remembered): Required<Pick<LineFigures, 'amount'>> & Pick<LineFigures, 'rateSqft' | 'unit'> {
  const qty = Number(line.qty) || 1
  const typedAmount = Number(line.amount) || 0
  const rate = Number(remembered.rate) || 0

  const unit = line.unit && line.unit !== DEFAULT_UNIT
    ? line.unit
    : (remembered.unit || line.unit || DEFAULT_UNIT)

  if (typedAmount) {
    return { amount: typedAmount, rateSqft: line.rateSqft ?? Math.round((typedAmount / qty) * 100) / 100, unit }
  }
  if (rate) {
    return { amount: Math.round(rate * qty), rateSqft: rate, unit }
  }
  return { amount: 0, rateSqft: line.rateSqft, unit }
}
