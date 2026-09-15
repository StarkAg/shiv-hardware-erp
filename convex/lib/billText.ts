import { canonicalUnit, properItem, properText } from './text'

/**
 * A bill in the shop's writing: the party in proper case, every line's name
 * with codes in capitals, and one spelling per unit.
 *
 * Applied when a bill is posted, not on every sync. A bill being typed is
 * pushed every couple of seconds, and tidying it then would take the space
 * off the end of a word while it is still being written.
 */
export function tidyBill<T>(bill: T): T {
  if (!bill || typeof bill !== 'object') return bill
  const b = bill as Record<string, any>
  const out: Record<string, any> = { ...b }
  if (typeof b.customerName === 'string') out.customerName = properText(b.customerName)
  if (Array.isArray(b.items)) {
    out.items = b.items.map((item: any) => {
      if (!item || typeof item !== 'object') return item
      const line = { ...item }
      if (typeof item.description === 'string') line.description = properItem(item.description)
      if (typeof item.unit === 'string' && item.unit) line.unit = canonicalUnit(item.unit)
      return line
    })
  }
  return out as T
}
