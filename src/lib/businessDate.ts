/**
 * The shop's calendar date, which is India's whatever the device says.
 *
 * `new Date().toISOString().slice(0, 10)` is the date in London: before 05:30
 * in the morning it is still yesterday there, so a bill written at 02:00 was
 * dated the day before — and on 1 April, in the year before. The device's own
 * clock is no better on a PC left on another time zone. Every "today" in the
 * panel comes from here.
 */
const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** YYYY-MM-DD in India for a moment (now by default). */
export function indiaDate(at: Date | number = Date.now()): string {
  const p = Object.fromEntries(parts.formatToParts(at).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/**
 * The working date: the day the counter is entering, picked under the shop's
 * name in the sidebar (WorkingDate). A day of old slips is typed with it set
 * back, and every new bill, voucher and form across the panel starts on it
 * instead of today. Kept in memory only, so a refresh is back on today.
 */
let working: string | null = null
const listeners = new Set<() => void>()

/** Sets the working date; null, or today itself, goes back to following the calendar. */
export function setWorkingDate(day: string | null) {
  const next = day && /^\d{4}-\d{2}-\d{2}$/.test(day) && day < indiaDate() ? day : null
  if (next === working) return
  working = next
  for (const fn of listeners) fn()
}

/** The day picked, or null while the panel is on today. */
export const workingDate = () => working

/** Calls back whenever the working date changes. Returns the way to stop. */
export function onWorkingDate(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Today in India, YYYY-MM-DD — or the working date, when one is picked. */
export const indiaToday = () => working ?? indiaDate()

/** Today in India as the books store a date: midnight UTC of that day. */
export const indiaTodayMs = () => Date.parse(`${indiaToday()}T00:00:00Z`)

/** This year in India. */
export const indiaYear = () => Number(indiaToday().slice(0, 4))
