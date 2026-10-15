/** A displayed ₹/sq ft figure from a row's total and total covered area. */
export function rateFromAmount(amount: number | '', totalSqft: number): number | '' {
  if (amount === '' || Number(amount) === 0 || !(totalSqft > 0)) return ''
  return Math.round((Number(amount) / totalSqft) * 100) / 100
}
