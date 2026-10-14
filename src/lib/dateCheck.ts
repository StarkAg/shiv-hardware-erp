/**
 * A date checked before it goes into the books.
 *
 * After today: refused, as the books refuse it (convex/lib/entries.ts) — said
 * here first, in words, rather than as a server error. In an earlier financial
 * year: asked about once, because it is usually a mistyped year (a sale typed
 * as 2016 sat in the books unnoticed), and only sometimes an old bill being
 * entered on purpose.
 */

const DAY = 86_400_000
const IST = 19_800_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10-14" or a timestamp, as midnight UTC of that day — how the books keep dates. */
const asDay = (date: string | number) =>
  typeof date === 'number' ? date : Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`)

const words = (ms: number) => {
  const d = new Date(ms)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Today in India, as midnight UTC of that day. */
const todayIst = (now = Date.now()) => Math.floor((now + IST) / DAY) * DAY

/** 1 April of the financial year today is in. */
const yearStart = (now = Date.now()) => {
  const d = new Date(todayIst(now))
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1
  return Date.UTC(y, 3, 1)
}

/** What is wrong with a date for the books, if anything. */
export function dateProblem(date: string | number, now = Date.now()): { refuse?: string; ask?: string } {
  const ms = asDay(date)
  if (!Number.isFinite(ms)) return { refuse: 'Choose a valid date.' }
  if (ms > todayIst(now) + DAY - 1) return { refuse: `${words(ms)} is after today. Check the day and the year.` }
  if (ms < yearStart(now)) {
    const start = new Date(yearStart(now)).getUTCFullYear()
    return { ask: `${words(ms)} is before this financial year (from 1 Apr ${start}). Is the year right?` }
  }
  return {}
}

/** Says what is wrong and returns false, or asks and returns the answer. True for a good date. */
export function confirmPostingDate(date: string | number): boolean {
  const { refuse, ask } = dateProblem(date)
  if (refuse) { window.alert(refuse); return false }
  if (ask) return window.confirm(`${ask}\n\nPress OK to save it with this date.`)
  return true
}
