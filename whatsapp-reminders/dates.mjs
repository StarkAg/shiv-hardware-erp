/** Today's date in India, whatever clock the service runs on. */
export function indiaDate(now = Date.now()) {
  const d = new Date(now + 19_800_000)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

/** Whose birthday it is on a date. A 29 Feb birthday falls on 28 Feb in other years. */
export function birthdaysOn(rows, { year, month, day }) {
  const leap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1
  return rows.filter((r) => (r.month === month && r.day === day)
    || (!leap && r.month === 2 && r.day === 29 && month === 2 && day === 28))
}

export const sentKey = (year, row) => `${year}:${row.id}`
